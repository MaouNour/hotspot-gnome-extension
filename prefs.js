import Gio from "gi://Gio";
import GdkPixbuf from "gi://GdkPixbuf";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import * as Hotspot from "./createApHelper.js";

export default class HotspotToggleprefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("Hotspot"),
      icon_name: "network-wireless-hotspot-symbolic",
    });
    window.add(page);

    if (!Hotspot.isCreateApInstalled() || !Hotspot.isHelperInstalled()) {
      const warnGroup = new Adw.PreferencesGroup();
      page.add(warnGroup);
      const warnRow = new Adw.ActionRow({
        title: _("Setup needed"),
        subtitle: !Hotspot.isCreateApInstalled()
          ? _("create_ap is not installed. See README.md.")
          : _("Run install-helper.sh once with sudo before this will work. See README.md."),
      });
      warnGroup.add(warnRow);
    }

    // ---- Basics ----
    const basicsGroup = new Adw.PreferencesGroup({ title: _("Hotspot") });
    page.add(basicsGroup);

    const ssidRow = new Adw.EntryRow({ title: _("Network name (SSID)") });
    ssidRow.set_text(settings.get_string("ssid"));
    settings.bind("ssid", ssidRow, "text", Gio.SettingsBindFlags.DEFAULT);
    basicsGroup.add(ssidRow);

    const passRow = new Adw.PasswordEntryRow({ title: _("Password") });
    passRow.set_text(settings.get_string("password"));
    settings.bind("password", passRow, "text", Gio.SettingsBindFlags.DEFAULT);
    basicsGroup.add(passRow);

    const genPassButton = new Gtk.Button({
      icon_name: "view-refresh-symbolic",
      valign: Gtk.Align.CENTER,
      tooltip_text: _("Generate a random password"),
    });
    genPassButton.connect("clicked", () => {
      passRow.set_text(Hotspot.randomPassword(12));
    });
    passRow.add_suffix(genPassButton);

    const pskRow = new Adw.SwitchRow({
      title: _("Raw PSK"),
      subtitle: _(
        "Treat password above as a 64 hex-digit pre-shared key instead of a passphrase (create_ap --psk)",
      ),
    });
    settings.bind("psk-mode", pskRow, "active", Gio.SettingsBindFlags.DEFAULT);
    basicsGroup.add(pskRow);

    const hiddenRow = new Adw.SwitchRow({
      title: _("Hidden network"),
      subtitle: _("Don't broadcast the SSID (create_ap --hidden)"),
    });
    settings.bind("hidden", hiddenRow, "active", Gio.SettingsBindFlags.DEFAULT);
    basicsGroup.add(hiddenRow);

    // ---- QR code ----
    const qrGroup = new Adw.PreferencesGroup({
      title: _("Share"),
      description: _("Scan with a phone camera to join the hotspot"),
    });
    page.add(qrGroup);

    const qrRow = new Adw.ActionRow({ title: _("QR code") });
    const qrButton = new Gtk.Button({ label: _("Show QR Code"), valign: Gtk.Align.CENTER });
    qrRow.add_suffix(qrButton);
    qrGroup.add(qrRow);
    qrButton.connect("clicked", () => this._showQrDialog(window, settings));

    // ---- Radio ----
    const advGroup = new Adw.PreferencesGroup({ title: _("Radio") });
    page.add(advGroup);

    const wpaRow = new Adw.ComboRow({
      title: _("WPA version"),
      model: Gtk.StringList.new(["WPA", "WPA2", "WPA + WPA2"]),
    });
    const wpaMap = ["1", "2", "1+2"];
    wpaRow.selected = Math.max(0, wpaMap.indexOf(settings.get_string("wpa-version")));
    wpaRow.connect("notify::selected", () => {
      settings.set_string("wpa-version", wpaMap[wpaRow.selected]);
    });
    advGroup.add(wpaRow);

    const bandRow = new Adw.ComboRow({
      title: _("Frequency band"),
      model: Gtk.StringList.new(["2.4 GHz", "5 GHz"]),
    });
    const bandMap = ["2.4", "5"];
    bandRow.selected = Math.max(0, bandMap.indexOf(settings.get_string("band")));
    bandRow.connect("notify::selected", () => {
      settings.set_string("band", bandMap[bandRow.selected]);
    });
    advGroup.add(bandRow);

    const channelRow = new Adw.SpinRow({
      title: _("Channel"),
      adjustment: new Gtk.Adjustment({ lower: 1, upper: 165, step_increment: 1 }),
    });
    channelRow.value = settings.get_int("channel");
    settings.bind("channel", channelRow, "value", Gio.SettingsBindFlags.DEFAULT);
    advGroup.add(channelRow);

    const macRow = new Adw.EntryRow({ title: _("MAC address (optional)") });
    macRow.set_text(settings.get_string("mac-address"));
    settings.bind("mac-address", macRow, "text", Gio.SettingsBindFlags.DEFAULT);
    advGroup.add(macRow);

    const isolateRow = new Adw.SwitchRow({
      title: _("Isolate clients"),
      subtitle: _("create_ap --isolate-clients"),
    });
    settings.bind("isolate-clients", isolateRow, "active", Gio.SettingsBindFlags.DEFAULT);
    advGroup.add(isolateRow);

    // ---- Device / concurrent mode ----
    const deviceGroup = new Adw.PreferencesGroup({
      title: _("Device"),
      description: _(
        "Leave \"Internet from\" set to the same WiFi card (or empty) to keep using WiFi as a client while hosting the hotspot on the same card — that's create_ap's virtual-interface mode.",
      ),
    });
    page.add(deviceGroup);

    const allIfaces = Hotspot.listAllInterfaces();
    const wifiIfaces = Hotspot.listWifiInterfaces();

    const ifaceRow = new Adw.ComboRow({
      title: _("WiFi interface (hosts the hotspot)"),
      model: Gtk.StringList.new(["(auto)", ...wifiIfaces]),
    });
    {
      const items = ["(auto)", ...wifiIfaces];
      const current = settings.get_string("wifi-interface");
      const idx = items.indexOf(current);
      ifaceRow.selected = idx === -1 ? 0 : idx;
      ifaceRow.connect("notify::selected", () => {
        const sel = items[ifaceRow.selected];
        settings.set_string("wifi-interface", sel === "(auto)" ? "" : sel);
      });
    }
    deviceGroup.add(ifaceRow);

    const internetRow = new Adw.ComboRow({
      title: _("Internet from"),
      model: Gtk.StringList.new([
        "(same WiFi card — concurrent mode)",
        "none (no internet sharing)",
        ...allIfaces,
      ]),
    });
    {
      const items = ["", "none", ...allIfaces];
      const current = settings.get_string("internet-interface");
      const idx = items.indexOf(current);
      internetRow.selected = idx === -1 ? 0 : idx;
      internetRow.connect("notify::selected", () => {
        settings.set_string("internet-interface", items[internetRow.selected]);
      });
    }
    deviceGroup.add(internetRow);

    const novirtRow = new Adw.SwitchRow({
      title: _("Disable virtual interface (--no-virt)"),
      subtitle: _("Only enable this if your card can't do AP + client at once"),
    });
    settings.bind("no-virt", novirtRow, "active", Gio.SettingsBindFlags.DEFAULT);
    deviceGroup.add(novirtRow);

    const autostartRow = new Adw.SwitchRow({
      title: _("Turn on automatically"),
      subtitle: _("Start the hotspot when the extension loads (e.g. at login)"),
    });
    settings.bind("autostart", autostartRow, "active", Gio.SettingsBindFlags.DEFAULT);
    deviceGroup.add(autostartRow);

    // ---- Apply ----
    const applyGroup = new Adw.PreferencesGroup({
      description: _(
        'Changes here take effect next time you toggle the hotspot on. Use "Apply Now" to restart it immediately with the new settings.',
      ),
    });
    page.add(applyGroup);
    const applyRow = new Adw.ActionRow({ title: _("Apply changes to the running hotspot") });
    const applyButton = new Gtk.Button({
      label: _("Apply Now"),
      valign: Gtk.Align.CENTER,
      css_classes: ["suggested-action"],
    });
    applyRow.add_suffix(applyButton);
    applyGroup.add(applyRow);

    applyButton.connect("clicked", async () => {
      applyButton.sensitive = false;
      try {
        let ifname = settings.get_string("wifi-interface");
        if (!ifname) ifname = Hotspot.defaultWifiInterface();
        if (!ifname) throw new Error(_("No WiFi interface found"));
        // pkexec will prompt for a password here (once, or every
        // time, unless the "hotspot" polkit group is set up).
        await Hotspot.start({
          ifname,
          internet: settings.get_string("internet-interface"),
          ssid: settings.get_string("ssid") || "hotspot",
          password: settings.get_string("password"),
          pskMode: settings.get_boolean("psk-mode"),
          hidden: settings.get_boolean("hidden"),
          wpaVersion: settings.get_string("wpa-version"),
          band: settings.get_string("band"),
          channel: settings.get_int("channel"),
          mac: settings.get_string("mac-address"),
          noVirt: settings.get_boolean("no-virt"),
          isolateClients: settings.get_boolean("isolate-clients"),
        });
        this._toast(window, _("Hotspot settings applied"));
      } catch (e) {
        this._toast(window, _("Failed to apply: %s").format(e.message));
      } finally {
        applyButton.sensitive = true;
      }
    });
  }

  _toast(window, text) {
    if (window.add_toast) window.add_toast(new Adw.Toast({ title: text, timeout: 4 }));
  }

  async _showQrDialog(window, settings) {
    const text = Hotspot.wifiQrString({
      ssid: settings.get_string("ssid"),
      password: settings.get_string("password"),
      hidden: settings.get_boolean("hidden"),
    });

    const dialog = new Adw.Window({
      title: _("Hotspot QR Code"),
      modal: true,
      transient_for: window,
      default_width: 300,
      default_height: 340,
    });
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 18,
      margin_bottom: 18,
      margin_start: 18,
      margin_end: 18,
    });
    dialog.set_content(box);

    const pngBytes = await Hotspot.renderQrPng(text);
    if (pngBytes) {
      const loader = GdkPixbuf.PixbufLoader.new();
      loader.write(pngBytes);
      loader.close();
      const pixbuf = loader.get_pixbuf();
      const picture = Gtk.Picture.new_for_pixbuf(pixbuf);
      picture.content_fit = Gtk.ContentFit.CONTAIN;
      box.append(picture);
    } else {
      const label = new Gtk.Label({
        label: _(
          'Install "qrencode" to generate a scannable QR code.\nShowing the raw WiFi string instead:',
        ),
        wrap: true,
      });
      box.append(label);
      const entry = new Gtk.Entry({ text, editable: false });
      box.append(entry);
    }
    const closeButton = new Gtk.Button({
      label: _("Close"),
      halign: Gtk.Align.CENTER,
      css_classes: ["suggested-action"],
    });
    closeButton.connect("clicked", () => dialog.close());
    box.append(closeButton);
    dialog.present();
  }
}
