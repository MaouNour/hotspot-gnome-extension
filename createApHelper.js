// createApHelper.js
// Talks to /usr/local/bin/gnome-hotspot-helper (installed by install-helper.sh)
// via `pkexec` for start/stop, since create_ap needs root to drive hostapd/
// dnsmasq/iptables and to create the virtual AP interface that lets you host
// a hotspot while staying connected as a WiFi client on the same card.
//
// Status is read directly from a world-readable JSON file the helper writes
// (/run/gnome-hotspot-toggle/status.json) so polling the UI never triggers
// a pkexec prompt — only actually turning the hotspot on/off does.

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

/** Is the helper + polkit policy installed? */
export function isHelperInstalled() {
    return GLib.file_test(HELPER, GLib.FileTest.IS_EXECUTABLE);
}

export function isCreateApInstalled() {
    return GLib.find_program_in_path('create_ap') !== null;
}

/** List WiFi device interface names using unprivileged `iw`/sysfs, no nmcli/root needed. */
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
        // ignore, return whatever we found (possibly empty)
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

/** Read the world-readable status file the root helper maintains. No pkexec needed. */
export function getStatus() {
    try {
        const [ok, contents] = GLib.file_get_contents(STATUS_FILE);
        if (!ok) return {active: false};
        const text = new TextDecoder().decode(contents);
        return JSON.parse(text);
    } catch (e) {
        return {active: false};
    }
}

/** Best-effort connected-client count; works without root on most drivers. */
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
 * internet: '' (same as ifname, concurrent AP+STA), 'none', or another iface.
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
