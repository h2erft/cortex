#!/usr/bin/env bash
# Cortex release builder — run this on your dev machine (or wherever the Cortex folder is)
# to cut a new version for OTA.
#
#   bash appliance/release.sh <version> <base-url>
#     <version>   e.g. 0.2.0   (must be > the version you last shipped)
#     <base-url>  where you'll upload the .tgz, e.g. https://downloads.airow.co/cortex
#
# It produces, in appliance/dist/:
#   cortex-<version>.tgz   the release payload (upload this)
#   manifest.json          the pointer the appliances read (upload this too)
#
# Then upload BOTH files to <base-url>/ and the fleet picks up the update within ~30 min.
set -euo pipefail

VER="${1:-}"
BASE="${2:-}"
if [ -z "$VER" ] || [ -z "$BASE" ]; then
  echo "usage: bash appliance/release.sh <version> <base-url>" >&2
  echo "   e.g: bash appliance/release.sh 0.2.0 https://downloads.airow.co/cortex" >&2
  exit 1
fi
BASE="${BASE%/}"  # strip trailing slash

HERE="$(cd "$(dirname "$0")" && pwd)"   # the appliance/ folder
UIDIR="$(cd "$HERE/.." && pwd)"         # the Cortex/ folder (UI lives here)
OUT="$HERE/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

echo "== building Cortex release $VER =="

# 1) stamp VERSION (source of truth)
printf '%s\n' "$VER" > "$HERE/VERSION"

# 2) stage exactly what a release contains
cp "$HERE/server.js" "$HERE/package.json" "$HERE/VERSION" "$HERE/cortex-update.sh" "$HERE/cortex.sudoers" "$HERE/cortex-appliance.service" "$HERE/cortex-updater.service" "$HERE/cortex-updater.timer" "$STAGE/"
[ -f "$HERE/package-lock.json" ] && cp "$HERE/package-lock.json" "$STAGE/" || true
for f in cortex.html command-center.html setup.html LGAP_reference.md; do
  if   [ -f "$UIDIR/$f" ]; then cp "$UIDIR/$f" "$STAGE/"
  elif [ -f "$HERE/$f"  ]; then cp "$HERE/$f"  "$STAGE/"
  else echo "   ! warning: $f not found — release will not include it" >&2; fi
done
chmod +x "$STAGE/cortex-update.sh"

# 3) tarball (deterministic-ish: sorted, no mtimes drift that matters)
TGZ="$OUT/cortex-$VER.tgz"
tar -czf "$TGZ" -C "$STAGE" .
SHA="$(sha256sum "$TGZ" | cut -d' ' -f1)"

# 4) manifest
cat > "$OUT/manifest.json" <<JSON
{
  "version": "$VER",
  "url": "$BASE/cortex-$VER.tgz",
  "sha256": "$SHA",
  "released": "$(date -Is)",
  "notes": ""
}
JSON

echo
echo "== release $VER built =="
echo "  payload : $TGZ"
echo "  sha256  : $SHA"
echo "  manifest: $OUT/manifest.json"
echo
echo "Next: upload BOTH files to  $BASE/"
echo "  - cortex-$VER.tgz"
echo "  - manifest.json   (overwrites the previous one; this is what triggers the update)"
