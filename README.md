**WiFi Hotspot Toggle — GNOME Shell extension (create_ap edition)**  
A Quick Settings toggle to turn your create_ap hotspot on/off, showing the  
   
 hotspot name and connection state, plus a preferences window (the cog icon  
   
 next to the extension in **Extensions**) to configure SSID, password,  
   
 hidden/visible, WPA version, band/channel, MAC, and a QR code for sharing  
   
 the password.  
This uses **create_ap** specifically (not plain NetworkManager hotspot  
   
 mode) because it's the only reliable way to host an AP *and* stay connected  
   
 to WiFi as a client on the same card at the same time, via its virtual  
   
 interface feature.  
**The privilege problem, and how this solves it**  
create_ap needs root — it drives hostapd, dnsmasq, and iptables  
   
 directly. A GNOME Shell extension (and its prefs window) run as your normal  
   
 desktop user, with no root access. So:  
1. A small root-owned helper script, gnome-hotspot-helper, is installed to  
 /usr/local/bin/. It validates its inputs strictly and then supervises  
 create_ap as a **transient systemd unit**  
   
 (gnome-hotspot-<interface>.service) rather than a hand-managed daemon.  
2. The extension calls that helper through **pkexec**, which pops up  
   
 GNOME's normal graphical password prompt.  
3. install-helper.sh (run once, with sudo) installs the helper and a  
   
 polkit policy + rule: anyone in the **sudo** ** or ** **wheel** ** group** (the  
   
 normal admin group on Debian/Ubuntu or Fedora/Arch respectively — i.e.  
   
 just you, on a typical single-user desktop) gets instant, no-password  
   
 authorization to run it. This mirrors the polkit setup used by the  
 [linux-wifi-hotspot  
   
 project rather than inventing a bespoke group.](https://github.com/lakinduakash/linux-wifi-hotspot "https://github.com/lakinduakash/linux-wifi-hotspot")  
No plaintext sudo passwords are ever handled by the extension itself —  
   
 pkexec and polkit do all of that, the same mechanism GNOME itself uses for  
   
 things like installing software or changing system time.  
**Why systemd, not a hand-rolled daemon**  
Earlier versions of this helper used create_ap --daemon plus a pidfile,  
   
 and tore down old instances with pkill before restarting. That's  
   
 inherently racy: a "stop" could return before the old process tree was  
   
 fully gone, so a fast toggle could stack a second create_ap on top of the  
   
 first — which is exactly the duplicate-process symptom you'd see in  
   
 htop/btop.  
Systemd fixes this structurally instead of heuristically:  
- systemctl stop <unit>**blocks** until the entire cgroup (both of  
   
 create_ap's own processes, hostapd, dnsmasq — everything) is confirmed  
   
 dead, escalating to SIGKILL on a timeout if needed.  
- systemd-run --unit=<name> --collect**refuses** to start a second  
   
 instance under the same unit name while one is still active.  
- The live on/off state the extension displays comes straight from  
 systemctl is-active <unit> — a real-time, authoritative read, not a  
   
 status file that could go stale if e.g. hostapd crashed on its own.  
So two create_ap processes for one hotspot isn't just "prevented if the  
   
 bash logic happens to run correctly" anymore — it's not something that can  
   
 happen given how systemd unit names work.  
**Install**  
**1. Install create_ap (if you haven't already)**  
git clone https://github.com/MaouNour/Hotspot-Access-point-On-Linux.git ./create_ap  
 cd create_ap  
 sudo make install  
   
Dependencies (Debian/Ubuntu): util-linux procps hostapd iproute2 iw haveged dnsmasq iptables  
**2. Install the root helper + polkit rule (one time, with sudo)**  
sudo ./install-helper.sh  
   
This installs /usr/local/bin/gnome-hotspot-helper and the polkit policy +  
   
 rule. If your user is already in the sudo or wheel group (typical for a  
   
 single-user desktop), toggling the hotspot never prompts for a password. If  
   
 not, you'll get a password prompt each time (cached briefly by polkit).  
**3. Install the extension itself**  
mkdir -p ~/.local/share/gnome-shell/extensions/hotspot-toggle@maounour  
 cp extension.js prefs.js createApHelper.js metadata.json ~/.local/share/gnome-shell/extensions/hotspot-toggle@maounour/  
 cp -r schemas ~/.local/share/gnome-shell/extensions/hotspot-toggle@maounourl/  
 glib-compile-schemas ~/.local/share/gnome-shell/extensions/hotspot-toggle@maounour/schemas/  
 gnome-extensions enable hotspot-toggle@maounour  
   
- **X11**: Alt+F2, type r, Enter, to reload GNOME Shell.  
- **Wayland**: log out and back in.  
Optional, for the QR code feature: sudo apt install qrencode (or dnf install qrencode). If missing, the QR dialog just shows the raw WIFI:...  
   
 string to copy instead.  
**Using it**  
- Click the hotspot icon in Quick Settings to flip it on/off. The **first**  
 **  
 time** (or every time, if you skipped the group setup) this pops up a  
   
 password prompt — that's pkexec asking permission to run create_ap as  
   
 root, not the extension asking for your WiFi password.  
- Expand the tile's menu for status, a rough connected-device count, and  
 **Hotspot Settings…**, which opens the same window as the cog icon in  
   
 Extensions.  
- In preferences: SSID, password (+ random-password button), hidden, raw-PSK  
   
 mode, WPA version, band/channel, MAC, which WiFi interface hosts the AP,  
   
 and what to share internet from.  
- **"Internet from" left on the same WiFi card (the default)** is the  
   
 concurrent mode you asked for: create_ap spins up a virtual AP interface  
   
 so the physical card keeps its existing WiFi connection while also hosting  
   
 the hotspot, sharing that connection's internet via NAT. Set it to none  
   
 for an isolated AP with no internet sharing, or to a wired interface to  
   
 share that instead. Only flip **"Disable virtual interface"** on if your  
   
 card's driver can't do AP+STA concurrently.  
- **Apply Now** in preferences restarts the hotspot immediately with  
   
 whatever's currently in the form.  
**Feature mapping to **create_ap ** flags**  
| | |  
|-|-|  
| **create_ap flag** | **Here** |   
| SSID / passphrase | SSID + Password fields |   
| -w | WPA version dropdown (WPA / WPA2 / WPA+WPA2) |   
| --psk | "Raw PSK" switch |   
| --hidden | Hidden network switch |   
| --mac | MAC address field |   
| -c | Channel spinner |   
| --freq-band | Frequency band dropdown |   
| --isolate-clients | Isolate clients switch |   
| --no-virt | "Disable virtual interface" switch (off by default — you want the virtual interface for concurrent AP+STA) |   
| -n / internet sharing | "Internet from" dropdown (same card / none / another interface) |   
| n/a | QR code button to share SSID/password by scanning |   
| --mac-filter | Not implemented — extend gnome-hotspot-helper if you need an ACL |   
   
**How status/permissions are split (for anyone auditing this)**  
- **Start/stop** → pkexec gnome-hotspot-helper start|stop ... → needs  
   
 authorization (password, or free pass if you're in sudo/wheel).  
- **Status** → systemctl is-active gnome-hotspot-<iface>.service, queried  
   
 directly, no pkexec, no caching, no going stale — it's whatever systemd  
   
 currently thinks the unit's state is.  
- **Interface listing / SSID metadata** → /sys/class/net directly, and a  
   
 small world-readable /run/gnome-hotspot-toggle/status.json the helper  
   
 writes after each start (display info only — never the on/off truth).  
- The helper script is installed root:root 0755 and pinned to its exact  
   
 path in the polkit .policy file via the  
 org.freedesktop.policykit.exec.path annotation, which is what lets  
 pkexec /usr/local/bin/gnome-hotspot-helper resolve to our custom,  
   
 narrowly-scoped action instead of requiring "run any command as root."  
   
 Every argument the helper receives is validated (interface must exist,  
   
 SSID/password length and charset checks, channel/band/MAC format checks)  
   
 before it's ever handed to create_ap.  
**Troubleshooting: duplicate create_ap processes / it flapping every few seconds**  
Older versions of this helper hand-managed create_ap --daemon with a  
   
 pidfile and pkill-based cleanup, which was racy: a "stop" could return  
   
 before the old process tree was fully gone, letting a second create_ap  
   
 stack on top of the first. The current version instead runs create_ap  
   
 under a **transient systemd unit** (gnome-hotspot-<iface>.service);  
   
 systemctl stop blocks until the whole cgroup is confirmed dead, and  
   
 systemd-run --unit=X --collect refuses to double-start under the same  
   
 name. See "Why systemd, not a hand-rolled daemon" above for the full  
   
 reasoning. This isn't a heuristic fix — duplication is no longer something  
   
 the code path can produce.  
If you're upgrading from an older copy and have stragglers left over from  
   
 before, clear them once:  
sudo pkill -f 'create_ap.*<your-wifi-iface>'  
   
then re-run sudo ./install-helper.sh to install the new helper + polkit  
   
 files, and reload the shell (Alt+F2 r on X11, or log out/in on  
   
 Wayland).  
**Known limitations**  
- MAC filtering (accept/deny ACLs) isn't implemented.  
- Connected-device count comes from iw dev <iface> station dump,  
   
 best-effort; shows 0 if iw can't read it without root on your system.  
- Requires a WiFi card/driver that supports AP mode (and, for the default  
   
 concurrent mode, AP+STA at once — most modern chipsets do).  
- Targets the GNOME 45+ ESM extension API (gi:// imports, QuickMenuToggle,  
 Adw.PreferencesWindow). Older GNOME versions use the legacy imports.*  
   
 API and won't load this as-is — say the word if you need a port.  
