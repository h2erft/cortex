#!/usr/bin/env bash
# Cortex one-command bootstrap — turns a fresh Ubuntu/Debian mini PC into a Cortex appliance,
# pulling everything from GitHub. Run on the box:
#
#   curl -fsSL https://raw.githubusercontent.com/YOUR-GH-USER/cortex/main/appliance/bootstrap.sh | sudo bash
#
# It clones the repo and runs the installer. After this, updates are automatic (OTA) —
# you never run this again unless you're re-imaging the box.
set -euo pipefail

# Which repo/branch to pull. Override without editing the file:
#   curl ... | sudo CORTEX_REPO=https://github.com/me/cortex.git bash
REPO="${CORTEX_REPO:-https://github.com/YOUR-GH-USER/cortex.git}"
BRANCH="${CORTEX_BRANCH:-main}"
SRC="${CORTEX_SRC:-/opt/cortex-src}"

# Private repo? Pass a GitHub token (a read-only fine-grained PAT is enough). It's used only
# for the clone/fetch and then scrubbed from the git remote so it is never left on disk:
#   curl -H "Authorization: token <PAT>" -fsSL <raw bootstrap url> | sudo CORTEX_REPO=... CORTEX_TOKEN=<PAT> bash
CLEAN_REPO="$REPO"
AUTH_REPO="$REPO"
if [ -n "${CORTEX_TOKEN:-}" ]; then
  AUTH_REPO="$(printf '%s' "$REPO" | sed -E "s#https://github.com/#https://x-access-token:${CORTEX_TOKEN}@github.com/#")"
fi

if [ "$(id -u)" -ne 0 ]; then echo "run with sudo: ... | sudo bash" >&2; exit 1; fi
echo "== Cortex bootstrap =="
echo "   repo:   $REPO ($BRANCH)"

apt-get update
apt-get install -y git

if [ -d "$SRC/.git" ]; then
  echo "== updating existing checkout in $SRC =="
  git -C "$SRC" remote set-url origin "$AUTH_REPO"
  git -C "$SRC" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC" reset --hard "origin/$BRANCH"
  git -C "$SRC" remote set-url origin "$CLEAN_REPO"   # scrub token from disk
else
  echo "== cloning into $SRC =="
  rm -rf "$SRC"
  git clone --depth 1 -b "$BRANCH" "$AUTH_REPO" "$SRC"
  git -C "$SRC" remote set-url origin "$CLEAN_REPO"   # scrub token from disk
fi

cd "$SRC/appliance"
echo "== running installer =="
bash install.sh
