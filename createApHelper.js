// createApHelper.js
// Talks to /usr/local/bin/gnome-hotspot-helper (installed by install-helper.sh)
// via `pkexec` for start/stop. The helper supervises create_ap as a
// transient systemd unit (gnome-hotspot-<iface>.service) instead of hand-
// rolled daemon/pidfile bookkeeping, so start/stop are structurally
// single-instance: `systemctl stop` blocks until the whole process tree is
// confirmed dead, and `systemd-run --unit=X --collect` refuses to double-
// start under the same name.
//
// Status is read two ways, neither requiring another pkexec round-trip:
//  - the *live* on/off truth comes straight from `systemctl is-active`,
//    which any local user can query read-only.
//  - display metadata (SSID, which interface actually ended up hosting the
//    AP, etc) comes from a world-readable JSON file the helper writes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HELPER = '/usr/local/bin/gnome-hotspot-helper';
const STATUS_FILE = '/run/gnome-hotspot-toggle/status.json';

export function runCommand(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, null, (proc_, res) => {
            try {
                const [, stdout, stderr] = proc_.communicate_utf8_finish(res);
                if (!proc_.get_successful()) {
                    reject(new Error((stderr || stdout || 'command failed').trim()));
                    return;
                }
                resolve((stdout || '').trim());
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** Like runCommand, but a non-zero exit is a normal outcome (used for
 * `systemctl is-active`, which exits non-zero for "inactive"/"failed" and
 * still needs its stdout read). */
function runCommandTolerant(argv) {
    return new Promise((resolve) => {
        let proc;
        try {
            proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
        } catch (e) {
            resolve('');
            return;
        }
        proc.communicate_utf8_async(null, null, (proc_, res) => {
            try {
                const [, stdout] = proc_.communicate_utf8_finish(res);
                resolve((stdout || '').trim());
            } catch (e) {
                resolve('');
            }
        });
    });
}

export function isHelperInstalled() {
    return GLib.file_test(HELPER, GLib.FileTest.IS_EXECUTABLE);
}

export function isCreateApInstalled() {
    return GLib.find_program_in_path('create_ap') !== null;
}

export function isSystemdAvailable() {
    return GLib.find_program_in_path('systemd-run') !== null;
}

export function unitNameFor(ifname) {
    return `gnome-hotspot-${ifname}.service`;
}

export function listWifiInterfaces() {
    const ifaces = [];
    try {
        const dir = Gio.File.new_for_path('/sys/class/net');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (GLib.file_test(`/sys/class/net/${name}/wireless`, GLib.FileTest.IS_DIR) ||
                GLib.file_test(`/sys/class/net/${name}/phy80211`, GLib.FileTest.EXISTS))
                ifaces.push(name);
        }
    } catch (e) {
        // ignore
    }
    return ifaces;
}

export function listAllInterfaces() {
    const ifaces = [];
    try {
        const dir = Gio.File.new_for_path('/sys/class/net');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (name !== 'lo')
                ifaces.push(name);
        }
    } catch (e) {
        // ignore
    }
    return ifaces;
}

export function defaultWifiInterface() {
    const ifaces = listWifiInterfaces();
    return ifaces.length ? ifaces[0] : null;
}

function readMetadata() {
    try {
        const [ok, contents] = GLib.file_get_contents(STATUS_FILE);
        if (!ok) return {};
        return JSON.parse(new TextDecoder().decode(contents));
    } catch (e) {
        return {};
    }
}

/**
 * Live status for a given interface. `active` comes straight from systemd
 * (the actual source of truth), never from a file that could go stale if
 * e.g. hostapd crashed without us being told.
 */
export async function getStatus(ifname) {
    if (!ifname) return {active: false};
    const unit = unitNameFor(ifname);
    const state = await runCommandTolerant(['systemctl', 'is-active', unit]);
    const active = state === 'active' || state === 'activating';

    if (!active && await nmIsActive(ifname)) {
        const ssid = await runCommandTolerant(
            ['nmcli', '-g', '802-11-wireless.ssid', 'connection', 'show', nmConnectionName(ifname)]);
        return {active: true, ifname, ap_iface: ifname, ssid, internet: '', backend: BACKEND_NM};
    }

    const meta = readMetadata();
    const metaMatchesUnit = meta.unit === unit;

    return {
        active,
        ifname,
        ap_iface: metaMatchesUnit ? meta.ap_iface : ifname,
        ssid: metaMatchesUnit ? meta.ssid : '',
        internet: metaMatchesUnit ? meta.internet : '',
    };
}

export async function countClients(apIface) {
    if (!apIface) return 0;
    try {
        const out = await runCommand(['iw', 'dev', apIface, 'station', 'dump']);
        return (out.match(/^Station /gm) || []).length;
    } catch (e) {
        return 0;
    }
}

/**
 * Start the hotspot. opts: { ifname, internet, ssid, password, pskMode,
 * hidden, wpaVersion, band, channel, mac, noVirt, isolateClients }
 */
export async function start(opts) {
    const args = [
        'pkexec', HELPER, 'start',
        '--ifname', opts.ifname,
        '--internet', opts.internet || opts.ifname,
        '--ssid', opts.ssid,
        '--password', opts.password || '',
        '--channel', String(opts.channel || 1),
        '--wpa', opts.wpaVersion || '2',
        '--band', opts.band || '2.4',
        '--hidden', opts.hidden ? '1' : '0',
        '--psk', opts.pskMode ? '1' : '0',
        '--no-virt', opts.noVirt ? '1' : '0',
        '--isolate', opts.isolateClients ? '1' : '0',
    ];
    if (opts.mac)
        args.push('--mac', opts.mac);

    return runCommand(args);
}

export async function stop(ifname) {
    return runCommand(['pkexec', HELPER, 'stop', '--ifname', ifname]);
}

// ---------------------------------------------------------------------------
// NetworkManager backend (optional alternative to create_ap).
//
// Uses `nmcli` to create a temporary (memory-only) AP-mode connection with
// ipv4.method=shared, which is the same mechanism GNOME Settings' own
// "Turn On Wi-Fi Hotspot" uses. No root helper / pkexec is involved; whether
// polkit prompts is up to NetworkManager's own policy.
// ---------------------------------------------------------------------------

export const BACKEND_CREATE_AP = 'create_ap';
export const BACKEND_NM = 'networkmanager';

export function isNmcliInstalled() {
    return GLib.find_program_in_path('nmcli') !== null;
}

export function nmConnectionName(ifname) {
    return `hotspot-toggle-${ifname}`;
}

export async function nmIsActive(ifname) {
    if (!ifname) return false;
    const out = await runCommandTolerant(
        ['nmcli', '-t', '-f', 'NAME', 'connection', 'show', '--active']);
    const name = nmConnectionName(ifname);
    return out.split('\n').some(line => line.trim() === name);
}

async function isCreateApUnitActive(ifname) {
    if (!ifname) return false;
    const state = await runCommandTolerant(['systemctl', 'is-active', unitNameFor(ifname)]);
    return state === 'active' || state === 'activating';
}

export async function nmStart(opts) {
    const ifname = opts.ifname;
    const ssid = opts.ssid;
    const password = opts.password || '';
    const wpa = opts.wpaVersion || '2';
    const band = opts.band || '2.4';
    const channel = opts.channel || 1;
    const name = nmConnectionName(ifname);

    // Same sanity checks the root helper does for create_ap.
    if (!ssid || ssid.length > 32)
        throw new Error('SSID must be 1-32 chars');
    if (opts.pskMode) {
        if (!/^[0-9a-fA-F]{64}$/.test(password))
            throw new Error('raw PSK must be exactly 64 hex digits');
    } else if (password && (password.length < 8 || password.length > 63)) {
        throw new Error('password must be 8-63 chars');
    }

    // Remove any previous instance so new settings always apply.
    await runCommandTolerant(['nmcli', 'connection', 'delete', 'id', name]);

    const args = [
        'nmcli', 'connection', 'add', 'save', 'no',
        'type', 'wifi',
        'ifname', ifname,
        'con-name', name,
        'autoconnect', 'no',
        'ssid', ssid,
        '802-11-wireless.mode', 'ap',
        '802-11-wireless.band', band === '5' ? 'a' : 'bg',
        '802-11-wireless.channel', String(channel),
        '802-11-wireless.hidden', opts.hidden ? 'yes' : 'no',
        'ipv4.method', 'shared',
        'ipv6.method', 'ignore',
    ];
    if (opts.mac)
        args.push('802-11-wireless.cloned-mac-address', opts.mac);
    if (password) {
        const proto = wpa === '1' ? 'wpa' : wpa === '1+2' ? 'wpa,rsn' : 'rsn';
        args.push('wifi-sec.key-mgmt', 'wpa-psk',
            'wifi-sec.psk', password,
            'wifi-sec.proto', proto);
        if (proto === 'rsn')
            args.push('wifi-sec.pairwise', 'ccmp', 'wifi-sec.group', 'ccmp');
    }

    await runCommand(args);

    if (opts.isolateClients) {
        // Only newer NetworkManager versions know this property; ignore failure.
        await runCommandTolerant(
            ['nmcli', 'connection', 'modify', name, '802-11-wireless.ap-isolation', 'yes']);
    }

    try {
        await runCommand(['nmcli', 'connection', 'up', 'id', name, 'ifname', ifname]);
    } catch (e) {
        await runCommandTolerant(['nmcli', 'connection', 'delete', 'id', name]);
        throw e;
    }
    return 'started';
}

export async function nmStop(ifname) {
    await runCommandTolerant(['nmcli', 'connection', 'down', 'id', nmConnectionName(ifname)]);
    await runCommandTolerant(['nmcli', 'connection', 'delete', 'id', nmConnectionName(ifname)]);
    return 'stopped';
}

/** Start with the chosen backend, first making sure the other backend isn't
 * already running on the same interface. */
export async function startHotspot(backend, opts) {
    if (backend === BACKEND_NM) {
        if (await isCreateApUnitActive(opts.ifname))
            await stop(opts.ifname);
        return nmStart(opts);
    }
    if (await nmIsActive(opts.ifname))
        await nmStop(opts.ifname);
    return start(opts);
}

/** Stop whichever backend is currently running on this interface. */
export async function stopHotspot(ifname) {
    if (await nmIsActive(ifname))
        return nmStop(ifname);
    return stop(ifname);
}

export function wifiQrString({ssid, password, hidden}) {
    const esc = s => String(s).replace(/([\\;,:"])/g, '\\$1');
    const T = password ? 'WPA' : 'nopass';
    return `WIFI:T:${T};S:${esc(ssid)};P:${password ? esc(password) : ''};H:${hidden ? 'true' : 'false'};;`;
}

export async function renderQrPng(text) {
    try {
        const proc = new Gio.Subprocess({
            argv: ['qrencode', '-t', 'PNG', '-o', '-', '-s', '8', text],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        const [, stdout] = await new Promise((resolve, reject) => {
            proc.communicate_async(null, null, (proc_, res) => {
                try {
                    resolve(proc_.communicate_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
        if (!proc.get_successful()) return null;
        return stdout.get_data();
    } catch (e) {
        return null;
    }
}

export function randomPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < length; i++)
        out += chars[GLib.random_int_range(0, chars.length)];
    return out;
}
