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

# semver compare that matches server.js: a plain x.y.z (stable) outranks the same x.y.z with a
# pre-release suffix (1.4.4 > 1.4.4-beta.1). sort -V gets this backwards, so we use node. Prints newer|older|same.
vercmp(){ node -e 'const f=v=>{const m=String(v).trim().replace(/^v/,"").match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);return m?[+m[1],+m[2],+m[3],m[4]||"~"]:[0,0,0,"~"];};const a=f(process.argv[1]),b=f(process.argv[2]);let c=0;for(let i=0;i<3;i++){if(a[i]!==b[i]){c=a[i]-b[i];break;}}if(!c)c=a[3]===b[3]?0:(a[3]==="~"?1:(b[3]==="~"?-1:(a[3]<b[3]?-1:1)));process.stdout.write(c>0?"newer":c<0?"older":"same");' "$1" "$2"; }

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

# Update channel: 'stable' (default) ignores pre-releases; 'beta' also accepts alpha/beta/rc.
# Written by the UI toggle (server.js -> $DATA/update-channel). Default stable if the file is absent.
# NOTE: the file usually does NOT exist (it is only created when someone flips the Beta toggle). Reading
# it must never fail the script: under `set -euo pipefail` a failed read here used to abort the whole
# updater on every box that had never touched the toggle — i.e. no more updates, silently, forever.
CHAN="stable"
if [ -r "$DATA/update-channel" ]; then
  CHAN="$( (tr -d '[:space:]' < "$DATA/update-channel" | tr 'A-Z' 'a-z') 2>/dev/null || true )"
fi
[ "$CHAN" = "beta" ] || CHAN="stable"

# ACCEPT_OCTET makes the GitHub asset API return the file bytes (not JSON metadata).
ACCEPT_OCTET=()
if [ -n "${CORTEX_UPDATE_REPO:-}" ]; then
  # --- GitHub API mode -------------------------------------------------------
  ACCEPT_OCTET=(-H "Accept: application/octet-stream")
  API="${CORTEX_UPDATE_API_BASE:-https://api.github.com}/repos/${CORTEX_UPDATE_REPO}"
  if [ "$CHAN" = "beta" ]; then
    # beta channel: look at ALL non-draft releases and pick the newest tag (pre-releases included).
    log "update channel: beta (pre-releases accepted)"
    if ! curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" --max-time 60 "$API/releases?per_page=30" -o "$TMP/rels.json"; then
      log "GitHub release list failed for $CORTEX_UPDATE_REPO — leaving $CUR running"; exit 0
    fi
    WANT=""
    while read -r tag; do
      [ -n "$tag" ] || continue
      if [ -z "$WANT" ] || [ "$(vercmp "$tag" "$WANT")" = "newer" ]; then WANT="$tag"; fi
    done < <(jq -r '.[]|select(.draft==false)|.tag_name' "$TMP/rels.json" | sed 's/^v//')
    if [ -z "$WANT" ]; then log "beta channel: no releases found — leaving $CUR running"; exit 0; fi
    jq --arg t "$WANT" 'map(select(.draft==false))|map(select((.tag_name|ltrimstr("v"))==$t))[0]' "$TMP/rels.json" > "$TMP/rel.json"
  else
    # stable channel: GitHub's "latest" endpoint already excludes pre-releases.
    if ! curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" --max-time 60 "$API/releases/latest" -o "$TMP/rel.json"; then
      log "GitHub release lookup failed for $CORTEX_UPDATE_REPO — leaving $CUR running"; exit 0
    fi
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

# --- is it actually newer? (full semver incl. pre-release suffix) -------------
REL_CMP="$(vercmp "$NEW" "$CUR")"
if [ "$REL_CMP" = "same" ]; then
  log "already on $CUR — up to date"
  exit 0
fi
if [ "$REL_CMP" = "older" ]; then
  log "running $CUR is newer than available $NEW — not downgrading"
  exit 0
fi
# --- don't retry a build that already failed here -------------------------------
# If $NEW was installed before and did not come up healthy, we rolled back. Without this check the
# timer would re-activate the same bad build every 30 minutes — restarting Cortex (and dropping the
# bus) each time, forever. Skip it until a DIFFERENT build is published (new version or new
# checksum), or until someone forces it:  sudo CORTEX_UPDATE_FORCE=1 /opt/cortex/current/cortex-update.sh
FAILED="$DATA/update-failed"
if [ -z "${CORTEX_UPDATE_FORCE:-}" ] && [ -f "$FAILED" ] && [ "$(cat "$FAILED" 2>/dev/null)" = "$NEW $SHA" ]; then
  log "skipping $NEW — it failed its health check on this box earlier (waiting for a newer build)"
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
  chmod +x "$REL/$NEW.partial/cortex-update.sh" 2>/dev/null || true   # ensure the updater stays executable
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

# --- reconcile system config shipped in the release (sudoers for UI power control) ----
# Lets privilege/policy changes ride in over OTA. Validated before install; never fatal.
if [ -f "$REL/$NEW/cortex.sudoers" ] && command -v visudo >/dev/null 2>&1; then
  if visudo -cf "$REL/$NEW/cortex.sudoers" >/dev/null 2>&1; then
    install -m 0440 "$REL/$NEW/cortex.sudoers" /etc/sudoers.d/cortex 2>/dev/null \
      && log "sudoers rule reconciled" || true
  else
    log "shipped sudoers failed validation — skipping"
  fi
fi

# --- reconcile systemd units shipped in the release (service/timer fixes ride OTA) ----
U_CHANGED=0
for u in cortex-appliance.service cortex-updater.service cortex-updater.timer; do
  if [ -f "$REL/$NEW/$u" ] && ! cmp -s "$REL/$NEW/$u" "/etc/systemd/system/$u" 2>/dev/null; then
    cp -f "$REL/$NEW/$u" "/etc/systemd/system/$u" && U_CHANGED=1 && log "updated unit $u"
  fi
done
[ "$U_CHANGED" = 1 ] && { systemctl daemon-reload 2>/dev/null || true; }

# --- activate: atomic symlink flip + restart ---------------------------------
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
log "activating $NEW (previous: ${PREV:-none})"
ln -sfn "$REL/$NEW" "$ROOT/current.tmp"
mv -Tf "$ROOT/current.tmp" "$ROOT/current"      # rename = atomic swap
systemctl restart cortex-appliance

# --- health check, with rollback ---------------------------------------------
ok=""
for i in $(seq 1 40); do
  sleep 1
  # ".running" is the version the process loaded when it STARTED (new in 1.5.0). ".version" is read from
  # disk through the 'current' symlink, so an old process that somehow survived the restart would
  # report the new number; prefer the one that can't be fooled.
  v="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/version" 2>/dev/null | jq -r '.running // .version // empty' 2>/dev/null || true)"
  if [ "$v" = "$NEW" ]; then ok=1; break; fi
done

if [ -n "$ok" ]; then
  log "update OK — now running $NEW"
  rm -f "$FAILED"
  # prune old releases, keeping the newest $KEEP (never the live one)
  live="$(basename "$(readlink -f "$ROOT/current")")"
  # shellcheck disable=SC2012
  { ls -1 "$REL" 2>/dev/null | grep -vx "$live" | sort -V | head -n -"$KEEP" || true; } | while read -r old; do
    if [ -n "$old" ]; then log "pruning old release $old"; rm -rf "${REL:?}/$old"; fi
  done
  exit 0
fi

log "NEW BUILD $NEW UNHEALTHY — rolling back to ${PREV:-previous}"
printf '%s %s\n' "$NEW" "$SHA" > "$FAILED" 2>/dev/null || true     # remember it so the timer doesn't retry this build
if [ -n "${PREV:-}" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$ROOT/current.tmp"; mv -Tf "$ROOT/current.tmp" "$ROOT/current"
  systemctl restart cortex-appliance
  log "rolled back to $(cat "$ROOT/current/VERSION" 2>/dev/null)"
  rm -rf "${REL:?}/$NEW"                                            # a forced retry downloads it fresh
else
  log "no previous release to roll back to — leaving $NEW; check journalctl -u cortex-appliance"
fi
exit 1
