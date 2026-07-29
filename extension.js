import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Hotspot from './createApHelper.js';

const POLL_SECONDS = 3;
const ICON_ON = 'network-wireless-hotspot-symbolic';
const ICON_OFF = 'network-wireless-disabled-symbolic';

const HotspotToggle = GObject.registerClass(
class HotspotToggle extends QuickMenuToggle {
    _init(extensionObject, settings) {
        super._init({
            title: _('Hotspot'),
            iconName: ICON_OFF,
            toggleMode: true,
        });

        this._extensionObject = extensionObject;
        this._settings = settings;
        this._busy = false;
        this._refreshing = false;
        this._syncingFromStatus = false;
        this._lastKnownActive = false;
        this._lastActionTime = 0;

        this.menu.setHeader(ICON_ON, _('WiFi Hotspot'), _('Loading…'));

        this._statusItem = new PopupMenu.PopupMenuItem(_('Status: unknown'), {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this._clientsItem = new PopupMenu.PopupMenuItem(_('Connected devices: —'), {reactive: false});
        this.menu.addMenuItem(this._clientsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Hotspot Settings…'), () => {
            this._extensionObject.openPreferences();
            Main.overview.hide();
            Main.panel.closeQuickSettings();
        });

        this.connect('clicked', () => this._onClicked());
        this.refresh();
    }

    _onClicked() {
        // Defensive guard #1: refresh() sets `this.checked` from the real
        // status every poll. If that property assignment ever causes this
        // 'clicked' handler to fire too (some St.Button-based toggles do
        // this), we must not treat it as a real user click, or we'd end up
        // restarting the hotspot every poll cycle forever — which is
        // exactly the "appears/disappears every ~5s, no password prompt
        // because auth is cached" symptom.
        if (this._syncingFromStatus) return;
        if (this._busy) return;

        const wantOn = this.checked;

        // Defensive guard #2: if the requested state already matches what
        // we last observed as the real, live status, there's nothing to
        // do — don't restart an already-running (or already-stopped)
        // hotspot just because something re-emitted 'clicked'.
        if (wantOn === this._lastKnownActive) return;

        // Defensive guard #3: hard cooldown between actual start/stop
        // actions. Even if guards #1/#2 somehow don't catch a spurious
        // re-trigger, this makes a tight restart loop physically
        // impossible.
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastActionTime < 4000) return;
        this._lastActionTime = now;

        this._busy = true;
        this._runToggle(wantOn).finally(() => {
            this._busy = false;
        });
    }

    async _runToggle(wantOn) {
        if (!Hotspot.isCreateApInstalled()) {
            Main.notifyError(_('Hotspot'), _('create_ap is not installed. See the extension README.'));
            await this.refresh();
            return;
        }
        if (!Hotspot.isHelperInstalled()) {
            Main.notifyError(_('Hotspot'), _('Run install-helper.sh once (see README) before using this toggle.'));
            await this.refresh();
            return;
        }

        let ifname = this._settings.get_string('wifi-interface');
        if (!ifname)
            ifname = Hotspot.defaultWifiInterface();

        try {
            if (wantOn) {
                if (!ifname)
                    throw new Error(_('No WiFi interface found'));

                // pkexec pops up the system password dialog here the first
                // time (or every time, unless the user is in the "hotspot"
                // polkit-bypass group set up by install-helper.sh).
                await Hotspot.start({
                    ifname,
                    internet: this._settings.get_string('internet-interface'),
                    ssid: this._settings.get_string('ssid') || `${GLib.get_host_name()}-hotspot`,
                    password: this._settings.get_string('password'),
                    pskMode: this._settings.get_boolean('psk-mode'),
                    hidden: this._settings.get_boolean('hidden'),
                    wpaVersion: this._settings.get_string('wpa-version'),
                    band: this._settings.get_string('band'),
                    channel: this._settings.get_int('channel'),
                    mac: this._settings.get_string('mac-address'),
                    noVirt: this._settings.get_boolean('no-virt'),
                    isolateClients: this._settings.get_boolean('isolate-clients'),
                });
            } else {
                await Hotspot.stop(ifname);
            }
        } catch (e) {
            logError(e, 'hotspot-toggle');
            Main.notifyError(_('Hotspot'), e.message);
        } finally {
            // create_ap needs a beat to actually bring the interface up/down.
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this.refresh();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async refresh() {
        // Never let two refreshes overlap (e.g. a slow `iw` call from one
        // poll tick still running when the next tick fires) — that's
        // another way stale/duplicate state could end up driving spurious
        // actions.
        if (this._refreshing) return;
        this._refreshing = true;

        let status;
        try {
            status = Hotspot.getStatus();
            const clients = status.active ? await Hotspot.countClients(status.ap_iface) : 0;
            this._applyStatus(status, clients);
        } finally {
            this._refreshing = false;
        }
    }

    _applyStatus(status, clients) {
        this._lastKnownActive = !!status.active;

        // Setting `checked` here is programmatic, not a user click. Guard
        // #1 in _onClicked() checks this flag so that even if the toggle
        // widget internally treats a `checked` assignment like a click,
        // it can never cascade into a restart loop.
        this._syncingFromStatus = true;
        this.checked = !!status.active;
        this._syncingFromStatus = false;

        this.iconName = status.active ? ICON_ON : ICON_OFF;

        const displaySsid = status.ssid || this._settings.get_string('ssid') || _('Hotspot');
        this.title = displaySsid;
        this.subtitle = status.active ? _('On') : _('Off');

        this.menu.setHeader(ICON_ON, displaySsid, status.active ? _('Hotspot is on') : _('Hotspot is off'));
        this._statusItem.label.text = status.active
            ? _('Status: On (%s)').format(status.ap_iface || status.ifname || '')
            : _('Status: Off');
        this._clientsItem.label.text = status.active
            ? _('Connected devices: %d').format(clients)
            : _('Connected devices: —');
    }
});

const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends SystemIndicator {
    _init(extensionObject, settings) {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = ICON_OFF;

        this._toggle = new HotspotToggle(extensionObject, settings);
        this._toggle.bind_property('icon-name',
            this._indicator, 'icon_name',
            GObject.BindingFlags.SYNC_CREATE);
        this._toggle.bind_property('checked',
            this._indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        this.quickSettingsItems.push(this._toggle);
    }
});

export default class HotspotToggleExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new HotspotIndicator(this, this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._indicator._toggle.refresh();
            return GLib.SOURCE_CONTINUE;
        });

        if (this._settings.get_boolean('autostart'))
            this._indicator._toggle._runToggle(true);
    }

    disable() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
