#!/usr/bin/env bash
# Cortex OTA updater — pull-based, verified, atomic, self-rolling-back.
#
# How it works, in plain terms:
#   1. Reads a manifest (a tiny JSON file) from a URL you control.
#   2. If the manifest names a NEWER version than what's running, downloads that
#      release, checks its fingerprint (sha256) so a corrupt/tampered file is rejected.
#   3. Unpacks it into its own folder and builds its dependencies.
#   4. Flips the 'current' symlink to the new release and restarts Cortex — instant swap.
#   5. Health-checks the new build. If it doesn't come up healthy, it flips back to the
#      previous release and restarts. A bad update can't take a site down.
#
# Runs as root from cortex-updater.timer. Safe to run by hand: `sudo cortex-update`
# Does nothing (exit 0) if no update URL is set or no newer version exists.
set -euo pipefail

ROOT="${CORTEX_ROOT:-/opt/cortex}"   # overridable for testing; production default /opt/cortex
REL=$ROOT/releases
DATA=$ROOT/data
CONF=$DATA/update.conf
LOG=$DATA/update.log
PORT="$(grep -oE 'CORTEX_PORT=[0-9]+' "$DATA/appliance.env" 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
KEEP=3  # how many old releases to retain for rollback

log(){ printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG" >&2; }
need(){ command -v "$1" >/dev/null 2>&1 || { log "missing dependency: $1"; exit 1; }; }
need curl; need jq; need sha256sum; need tar; need node; need systemctl

# --- config -------------------------------------------------------------------
# update.conf is a shell fragment. Point at updates one of two ways:
#   GitHub (recommended — works with PRIVATE repos + fine-grained tokens):
#     CORTEX_UPDATE_REPO=owner/repo
#     CORTEX_UPDATE_TOKEN=github_pat_...   # fine-grained, Contents: Read. Omit for a public repo.
#   Any static host serving the files directly:
#     CORTEX_UPDATE_MANIFEST=https://host/path/manifest.json
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF" || true

# Token header. For GitHub it authenticates api.github.com; curl drops it on the cross-host
# redirect to the signed asset URL (which self-authenticates) — never use --location-trusted.
AUTH=()
[ -n "${CORTEX_UPDATE_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${CORTEX_UPDATE_TOKEN}")

CUR="$(cat "$ROOT/current/VERSION" 2>/dev/null || echo 0.0.0)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ACCEPT_OCTET makes the GitHub asset API return the file bytes (not JSON metadata).
ACCEPT_OCTET=()
if [ -n "${CORTEX_UPDATE_REPO:-}" ]; then
  # --- GitHub API mode -------------------------------------------------------
  ACCEPT_OCTET=(-H "Accept: application/octet-stream")
  API="${CORTEX_UPDATE_API_BASE:-https://api.github.com}/repos/${CORTEX_UPDATE_REPO}"
  if ! curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" --max-time 60 "$API/releases/latest" -o "$TMP/rel.json"; then
    log "GitHub release lookup failed for $CORTEX_UPDATE_REPO — leaving $CUR running"; exit 0
  fi
  NEW="$(jq -r '.tag_name // empty' "$TMP/rel.json" | sed 's/^v//')"
  MANURL="$(jq -r '.assets[]? | select(.name=="manifest.json") | .url' "$TMP/rel.json" | head -1)"
  TGZURL="$(jq -r '.assets[]? | select(.name|endswith(".tgz")) | .url' "$TMP/rel.json" | head -1)"
  if [ -z "$NEW" ] || [ -z "$MANURL" ] || [ -z "$TGZURL" ]; then
    log "latest release has no tag or is missing its manifest.json/.tgz assets — ignoring"; exit 0
  fi
  if ! curl -fsSL "${AUTH[@]}" "${ACCEPT_OCTET[@]}" --max-time 60 "$MANURL" -o "$TMP/manifest.json"; then
    log "manifest asset download failed — leaving $CUR running"; exit 0
  fi
  SHA="$(jq -r '.sha256 // empty' "$TMP/manifest.json")"
elif [ -n "${CORTEX_UPDATE_MANIFEST:-}" ]; then
  # --- static-host mode: manifest.json carries version/url/sha256 directly ----
  if ! curl -fsSL "${AUTH[@]}" --max-time 60 "$CORTEX_UPDATE_MANIFEST" -o "$TMP/manifest.json"; then
    log "manifest fetch failed from $CORTEX_UPDATE_MANIFEST — leaving $CUR running"; exit 0
  fi
  NEW="$(jq -r '.version // empty' "$TMP/manifest.json")"
  TGZURL="$(jq -r '.url // empty'  "$TMP/manifest.json")"
  SHA="$(jq -r '.sha256 // empty'  "$TMP/manifest.json")"
else
  log "no CORTEX_UPDATE_REPO or CORTEX_UPDATE_MANIFEST set in $CONF — nothing to do"; exit 0
fi
if [ -z "$NEW" ] || [ -z "$TGZURL" ] || [ -z "$SHA" ]; then
  log "update info incomplete (version/url/sha256) — ignoring"; exit 0
fi

# --- is it actually newer? (semver-ish, via sort -V) --------------------------
if [ "$NEW" = "$CUR" ]; then
  log "already on $CUR — up to date"
  exit 0
fi
top="$(printf '%s\n%s\n' "$CUR" "$NEW" | sort -V | tail -1)"
if [ "$top" != "$NEW" ]; then
  log "running $CUR is newer than manifest $NEW — not downgrading"
  exit 0
fi
if [ -d "$REL/$NEW" ]; then
  log "release $NEW already unpacked — will re-activate it"
else
  log "update available: $CUR -> $NEW  (downloading)"

  # --- download + verify ------------------------------------------------------
  if ! curl -fsSL "${AUTH[@]}" "${ACCEPT_OCTET[@]}" --max-time 600 "$TGZURL" -o "$TMP/pkg.tgz"; then
    log "download failed from $TGZURL — leaving $CUR running"
    exit 0
  fi
  got="$(sha256sum "$TMP/pkg.tgz" | cut -d' ' -f1)"
  if [ "$got" != "$SHA" ]; then
    log "CHECKSUM MISMATCH (want $SHA, got $got) — rejecting download"
    exit 1
  fi
  log "checksum ok ($SHA)"

  # --- unpack into its own release dir ---------------------------------------
  mkdir -p "$TMP/x"
  tar -xzf "$TMP/pkg.tgz" -C "$TMP/x"
  # the tarball's top level is the release contents (server.js, package.json, VERSION, *.html)
  SRC="$TMP/x"
  [ -f "$SRC/server.js" ] || SRC="$(dirname "$(find "$TMP/x" -name server.js -print -quit)")"
  [ -f "$SRC/server.js" ] || { log "tarball has no server.js — rejecting"; exit 1; }
  # sanity: the VERSION inside must match the manifest
  insideV="$(cat "$SRC/VERSION" 2>/dev/null || echo '')"
  if [ "$insideV" != "$NEW" ]; then
    log "tarball VERSION ($insideV) != manifest ($NEW) — rejecting"
    exit 1
  fi

  mkdir -p "$REL"
  rm -rf "$REL/$NEW.partial" "$REL/$NEW"
  cp -a "$SRC" "$REL/$NEW.partial"
  # build deps for THIS machine's arch (serialport is native)
  if [ -f "$REL/$NEW.partial/package.json" ]; then
    log "installing dependencies for $NEW"
    if ! ( cd "$REL/$NEW.partial" && npm ci --omit=dev >>"$LOG" 2>&1 ); then
      ( cd "$REL/$NEW.partial" && npm install --omit=dev >>"$LOG" 2>&1 ) || { log "npm install failed — rejecting $NEW"; rm -rf "$REL/$NEW.partial"; exit 1; }
    fi
  fi
  mv -T "$REL/$NEW.partial" "$REL/$NEW"
  chown -R cortex:cortex "$REL/$NEW" 2>/dev/null || true
fi

# --- activate: atomic symlink flip + restart ---------------------------------
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
log "activating $NEW (previous: ${PREV:-none})"
ln -sfn "$REL/$NEW" "$ROOT/current.tmp"
mv -Tf "$ROOT/current.tmp" "$ROOT/current"      # rename = atomic swap
systemctl restart cortex-appliance

# --- health check, with rollback ---------------------------------------------
ok=""
for i in $(seq 1 20); do
  sleep 1
  v="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/version" 2>/dev/null | jq -r '.version // empty' || true)"
  if [ "$v" = "$NEW" ]; then ok=1; break; fi
done

if [ -n "$ok" ]; then
  log "update OK — now running $NEW"
  # prune old releases, keeping the newest $KEEP (never the live one)
  live="$(basename "$(readlink -f "$ROOT/current")")"
  # shellcheck disable=SC2012
  ls -1 "$REL" 2>/dev/null | grep -vx "$live" | sort -V | head -n -"$KEEP" | while read -r old; do
    [ -n "$old" ] && { log "pruning old release $old"; rm -rf "${REL:?}/$old"; }
  done
  exit 0
fi

log "NEW BUILD $NEW UNHEALTHY — rolling back to ${PREV:-previous}"
if [ -n "${PREV:-}" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$ROOT/current.tmp"; mv -Tf "$ROOT/current.tmp" "$ROOT/current"
  systemctl restart cortex-appliance
  log "rolled back to $(cat "$ROOT/current/VERSION" 2>/dev/null)"
else
  log "no previous release to roll back to — leaving $NEW; check journalctl -u cortex-appliance"
fi
exit 1
