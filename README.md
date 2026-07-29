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
 /usr/local/bin/. It validates its inputs strictly and then calls  
 create_ap for you.  
2. The extension calls that helper through **pkexec**, which pops up  
   
 GNOME's normal graphical password prompt. Type your password, it runs.  
3. install-helper.sh (run once, with sudo) also sets up a **hotspot**  
 **  
 group** and a polkit rule saying "members of this group can run the  
   
 helper with no prompt at all." Add yourself to it and, after logging out  
   
 and back in, toggling the hotspot never asks for a password again.  
No plaintext sudo passwords are ever handled by the extension itself —  
   
 pkexec and polkit do all of that, the same mechanism GNOME itself uses for  
   
 things like installing software or changing system time.  
**Install**  
**1. Install create_ap (if you haven't already)**  
git clone [https://github.com/MaouNour/Hotspot-Access-point-On-Linux.git](https://github.com/MaouNour/Hotspot-Access-point-On-Linux.git "https://github.com/MaouNour/Hotspot-Access-point-On-Linux.git") ./create_ap  
 cd create_ap  
 sudo make install  
   
Dependencies (Debian/Ubuntu): util-linux procps hostapd iproute2 iw haveged dnsmasq iptables  
**2. Install the root helper + polkit rule (one time, with sudo)**  
sudo ./install-helper.sh  
   
This installs /usr/local/bin/gnome-hotspot-helper, the polkit policy, and  
   
 the hotspot group bypass rule, and offers to add your user to that group.  
   
 **Log out and back in** afterwards if you want the no-password bypass to  
   
 take effect (group membership only applies to new login sessions).  
**3. Install the extension itself**  
mkdir -p ~/.local/share/gnome-shell/extensions/hotspot-toggle@local  
 cp extension.js prefs.js createApHelper.js metadata.json ~/.local/share/gnome-shell/extensions/hotspot-toggle@local/  
 cp -r schemas ~/.local/share/gnome-shell/extensions/hotspot-toggle@local/  
 glib-compile-schemas ~/.local/share/gnome-shell/extensions/hotspot-toggle@local/schemas/  
 gnome-extensions enable hotspot-toggle@local  
   
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
   
 authorization (password, or free pass if you're in the hotspot group).  
- **Status/interface listing/polling** → reads /run/gnome-hotspot-toggle/status.json  
   
 (world-readable, written by the root helper) and /sys/class/net directly.  
   
 No pkexec calls happen on every poll — only on actual toggles — so you  
   
 won't get spammed with prompts every few seconds.  
- The helper script is installed root:root 0755 and pinned to its exact  
   
 path in the polkit .policy file via the  
 org.freedesktop.policykit.exec.path annotation, which is what lets  
 pkexec /usr/local/bin/gnome-hotspot-helper resolve to our custom,  
   
 narrowly-scoped action instead of requiring "run any command as root."  
   
 Every argument the helper receives is validated (interface must exist,  
   
 SSID/password length and charset checks, channel/band/MAC format checks)  
   
 before it's ever handed to create_ap.  
**Troubleshooting: duplicate create_ap processes**  
If you see more than one create_ap process for the same interface in  
   
 htop/btop, it's from an older copy of the helper — the current  
   
 gnome-hotspot-helper serializes every start/stop through a single lock  
   
 (/run/gnome-hotspot-toggle/lock) and, before starting a new instance,  
   
 actively verifies the old one is fully dead (retrying create_ap --stop,  
   
 then pkill as a fallback) rather than just sleeping a second and hoping.  
   
 Re-run sudo ./install-helper.sh to pick up the fix, and if you already  
   
 have stragglers, clear them once with:  
sudo pkill -f 'create_ap.*<your-wifi-iface>'  
   
**Troubleshooting: hotspot process appears/disappears every few seconds (only via the UI)**  
If toggling from the terminal (sudo create_ap ...) was rock solid but the  
   
 same settings via the extension caused a create_ap process to balloon in  
   
 memory and restart every ~5 seconds, with no repeated password prompt — that  
   
 was the extension's own status-polling loop (every 3s) accidentally  
   
 re-triggering a restart, silently, because polkit's auth_admin_keep caches  
   
 the authorization for a few minutes so you wouldn't see it asking again.  
extension.js now has three independent guards against this:  
1. refresh() marks its own programmatic checked assignment with a  
 _syncingFromStatus flag, and the click handler ignores clicks while  
   
 that flag is set.  
2. The click handler no-ops if the requested state already matches the last  
   
 known real status (nothing to restart).  
3. A hard 4-second cooldown between actual start/stop actions makes a tight  
   
 restart loop impossible even if something upstream still manages to  
   
 re-fire the click handler.  
Update to the latest extension.js and reload the shell (Alt+F2 r on  
   
 X11, or log out/in on Wayland) to pick this up.  
**Known limitations**  
- MAC filtering (accept/deny ACLs) isn't implemented.  
- Connected-device count comes from iw dev <iface> station dump,  
   
 best-effort; shows 0 if iw can't read it without root on your system.  
- Requires a WiFi card/driver that supports AP mode (and, for the default  
   
 concurrent mode, AP+STA at once — most modern chipsets do).  
- Targets the GNOME 45+ ESM extension API (gi:// imports, QuickMenuToggle,  
 Adw.PreferencesWindow). Older GNOME versions use the legacy imports.*  
   
 API and won't load this as-is — say the word if you need a port.  
