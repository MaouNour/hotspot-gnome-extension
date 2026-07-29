#!/bin/bash
# install-helper.sh — one-time root setup for the hotspot extension.
# Run this once with sudo. It:
#   1. installs the root helper script the extension calls via pkexec
#      (validates input, then supervises create_ap as a systemd transient unit)
#   2. installs the polkit policy + sudo/wheel-group bypass rule
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run this with sudo: sudo ./install-helper.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Checking create_ap is installed..."
if ! command -v create_ap >/dev/null 2>&1; then
    cat <<'EOF'
create_ap was not found on PATH.
Install it first, e.g.:

    git clone https://github.com/oblique/create_ap
    cd create_ap
    sudo make install

Dependencies (Debian/Ubuntu): util-linux procps hostapd iproute2 iw \
  haveged dnsmasq iptables

Re-run this script after installing create_ap.
EOF
    exit 1
fi
echo "    found: $(command -v create_ap)"

echo "==> Checking systemd is available..."
command -v systemd-run >/dev/null 2>&1 || { echo "systemd-run not found; this helper requires systemd."; exit 1; }
echo "    ok"

echo "==> Installing root helper to /usr/local/bin/gnome-hotspot-helper"
install -o root -g root -m 0755 "$SCRIPT_DIR/bin/gnome-hotspot-helper" /usr/local/bin/gnome-hotspot-helper

echo "==> Installing polkit policy"
install -o root -g root -m 0644 "$SCRIPT_DIR/polkit/local.hotspot-toggle.policy" /usr/share/polkit-1/actions/local.hotspot-toggle.policy

echo "==> Installing polkit sudo/wheel-group bypass rule"
install -o root -g root -m 0644 "$SCRIPT_DIR/polkit/49-hotspot-toggle.rules" /etc/polkit-1/rules.d/49-hotspot-toggle.rules

if id -nG "${SUDO_USER:-root}" 2>/dev/null | grep -qwE 'sudo|wheel'; then
    echo "==> ${SUDO_USER:-root} is already in sudo/wheel — toggling the hotspot won't prompt for a password."
else
    echo "==> Note: ${SUDO_USER:-your user} is not in the sudo/wheel group, so toggling the hotspot"
    echo "    will ask for an admin password each time (cached briefly by polkit)."
fi

systemctl restart polkit 2>/dev/null || service polkit restart 2>/dev/null || true

echo "==> Done."
