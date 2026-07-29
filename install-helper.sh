#!/bin/bash
# install-helper.sh — one-time root setup for the hotspot extension.
# Run this once with sudo. It:
#   1. installs the root helper script the extension calls via pkexec
#   2. installs the polkit policy + group-bypass rule
#   3. creates a "hotspot" group and (optionally) adds you to it so future
#      toggles don't prompt for a password at all
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

    git clone https://github.com/MaouNour/Hotspot-Access-point-On-Linux.git ./create_ap
    cd create_ap
    sudo make install

Dependencies (Debian/Ubuntu): util-linux procps hostapd iproute2 iw \
  haveged dnsmasq iptables

Re-run this script after installing create_ap.
EOF
  exit 1
fi
echo "    found: $(command -v create_ap)"

echo "==> Installing root helper to /usr/local/bin/gnome-hotspot-helper"
install -o root -g root -m 0755 "$SCRIPT_DIR/bin/gnome-hotspot-helper" /usr/local/bin/gnome-hotspot-helper

echo "==> Installing polkit policy"
install -o root -g root -m 0644 "$SCRIPT_DIR/polkit/local.hotspot-toggle.policy" /usr/share/polkit-1/actions/local.hotspot-toggle.policy

echo "==> Installing polkit group-bypass rule"
install -o root -g root -m 0644 "$SCRIPT_DIR/polkit/49-hotspot-toggle.rules" /etc/polkit-1/rules.d/49-hotspot-toggle.rules

echo "==> Creating 'hotspot' group (if missing)"
groupadd -f hotspot

TARGET_USER="${SUDO_USER:-}"
if [[ -n "$TARGET_USER" ]]; then
  read -r -p "Add user '$TARGET_USER' to the 'hotspot' group so toggling never asks for a password? [Y/n] " reply
  reply=${reply:-Y}
  if [[ "$reply" =~ ^[Yy] ]]; then
    usermod -aG hotspot "$TARGET_USER"
    echo "    Added. Log out and back in for it to take effect."
  else
    echo "    Skipped — you'll get a password prompt (cached briefly) each time you toggle the hotspot."
  fi
else
  echo "    Could not detect the invoking user (SUDO_USER unset)."
  echo "    Add yourself manually: sudo usermod -aG hotspot \$USER, then log out/in."
fi

systemctl restart polkit 2>/dev/null || service polkit restart 2>/dev/null || true

echo "==> Done."
