#!/usr/bin/env bash
# Cortex appliance installer — run as root on a fresh minimal Debian/Ubuntu on the N95.
#   sudo bash install.sh
# Idempotent: safe to re-run. Sets up the atomic releases/current layout, the service,
# and the OTA updater timer.
set -euo pipefail

ROOT=/opt/cortex
REL=$ROOT/releases
DATA=$ROOT/data
HERE="$(cd "$(dirname "$0")" && pwd)"
UIDIR="$(cd "$HERE/.." && pwd)"
VER="$(cat "$HERE/VERSION" 2>/dev/null || echo 0.1.0)"
echo "== Cortex appliance install (version $VER) =="

# 1) base packages + Node 20 (NodeSource) + tools (jq for OTA, build tools for serialport native module)
apt-get update
apt-get install -y curl ca-certificates ufw unattended-upgrades build-essential jq git avahi-daemon
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 2) Tailscale (secure remote access, no open ports) — install before the firewall step
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# 3) dedicated, no-login service user + serial access
id cortex >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin cortex
usermod -aG dialout cortex

# 3b) stable name on the LAN so customers bookmark http://cortex.local:8080 (never an IP).
# Avahi (mDNS) advertises <hostname>.local; set hostname to CORTEX_HOSTNAME or 'cortex'.
HN="${CORTEX_HOSTNAME:-cortex}"
hostnamectl set-hostname "$HN" 2>/dev/null || true
if ! grep -qE "^127\.0\.1\.1[[:space:]]+$HN" /etc/hosts 2>/dev/null; then
  printf '127.0.1.1\t%s\n' "$HN" >> /etc/hosts
fi
systemctl enable --now avahi-daemon 2>/dev/null || true

# 4) lay down release $VER and point 'current' at it
mkdir -p "$REL/$VER" "$DATA"
cp -f "$HERE/server.js" "$HERE/package.json" "$HERE/VERSION" "$HERE/cortex-update.sh" "$REL/$VER"/
[ -f "$HERE/package-lock.json" ] && cp -f "$HERE/package-lock.json" "$REL/$VER"/ || true
[ -f "$HERE/cortex.sudoers" ] && cp -f "$HERE/cortex.sudoers" "$REL/$VER"/ || true
cp -f "$HERE/cortex-appliance.service" "$HERE/cortex-updater.service" "$HERE/cortex-updater.timer" "$REL/$VER"/ 2>/dev/null || true
chmod +x "$REL/$VER/cortex-update.sh"
for f in cortex.html command-center.html setup.html LGAP_reference.md; do
  [ -f "$UIDIR/$f" ] && cp -f "$UIDIR/$f" "$REL/$VER"/ || true
  [ -f "$HERE/$f"  ] && cp -f "$HERE/$f"  "$REL/$VER"/ || true
done
( cd "$REL/$VER" && { npm ci --omit=dev || npm install --omit=dev; } )
ln -sfn "$REL/$VER" "$ROOT/current"

# 5) config files in the persistent data dir (survive updates)
if [ ! -f "$DATA/appliance.env" ]; then
  cat > "$DATA/appliance.env" <<'ENV'
# Cortex appliance settings. Edit, then: systemctl restart cortex-appliance
CORTEX_PORT=8080
CORTEX_SERIAL=/dev/ttyUSB0
# A friendly name for this site, shown in the fleet console:
CORTEX_NAME=
ENV
fi
if [ ! -f "$DATA/update.conf" ]; then
  # Auto-fill the repo from the clone this installer ran out of, so OTA works out of the box
  # for a public repo with zero extra steps (private repos still need a token below).
  REPO_SLUG="$(git -C "$UIDIR" config --get remote.origin.url 2>/dev/null \
    | sed -E 's#(git@github.com:|https://[^/]*github.com/)##; s#\.git$##' | grep -E '^[^/]+/[^/]+$' || true)"
  cat > "$DATA/update.conf" <<CONF
# OTA via GitHub (recommended — works with public AND private repos). Set your repo:
#   CORTEX_UPDATE_REPO=YOUR-GH-USER/cortex
# Leave blank to disable OTA on this appliance.  (auto-filled from the install source below)
CORTEX_UPDATE_REPO=${REPO_SLUG}

# PRIVATE repo only: a fine-grained GitHub token with Contents: Read on that repo.
# Leave blank for a public repo.
CORTEX_UPDATE_TOKEN=

# Alternative to CORTEX_UPDATE_REPO: a static host serving manifest.json directly.
#   CORTEX_UPDATE_MANIFEST=https://host/path/manifest.json
CONF
fi
chown -R cortex:cortex "$ROOT"

# 6) systemd: the appliance service + the OTA updater timer
cp -f "$HERE/cortex-appliance.service" "$HERE/cortex-updater.service" "$HERE/cortex-updater.timer" /etc/systemd/system/
systemctl daemon-reload
# enable at boot, and RESTART so a re-install over a running box picks up the new server.js
# (enable --now only starts a stopped unit; it won't reload code into an already-running one).
systemctl enable cortex-appliance
systemctl restart cortex-appliance
systemctl enable --now cortex-updater.timer

# 6b) sudoers: let the service reboot/power off the box from the UI (scoped, validated)
if [ -f "$HERE/cortex.sudoers" ] && visudo -cf "$HERE/cortex.sudoers" >/dev/null 2>&1; then
  install -m 0440 "$HERE/cortex.sudoers" /etc/sudoers.d/cortex
fi

# 7) lockdown: firewall + automatic security updates
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp                 # SSH on the LAN (tighten/remove once Tailscale SSH is set up)
ufw allow in on tailscale0 to any port 8080 proto tcp 2>/dev/null || true  # Cortex over Tailscale
ufw allow 8080/tcp               # Cortex on the LAN during setup; see step 4 below to lock down
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo
echo "== Done — Cortex $VER is running =="
echo "1) Open Cortex in a browser:   http://$HN.local:8080   (bookmark this)"
echo "   ...or by IP if .local doesn't resolve:   http://<this-device-ip>:8080"
echo "   First visit walks you through naming the site and picking the adapter."
echo "2) (your remote access) Join your tailnet:   tailscale up"
echo "3) OTA updates: auto-configured from your repo. (Private repo? add a token: nano $DATA/update.conf )"
echo "4) Lock down to Tailscale-only later:  ufw delete allow 8080/tcp"
echo
echo "Logs:     journalctl -u cortex-appliance -f"
echo "Updates:  journalctl -u cortex-updater -f     (or:  cat $DATA/update.log )"
echo "Update now (manual):   sudo /opt/cortex/current/cortex-update.sh"
