#!/usr/bin/env bash
# Cortex: keep the https certificate useful for remote access, with nobody having to touch the box.
#
# Runs as root at the start of every updater tick (about every 30 minutes). Never fatal, never loud.
#
# What it does:
#   - Nothing at all if https was switched off (CORTEX_HTTPS=0 in appliance.env).
#   - Makes sure the https port is open where the plain port already is.
#   - If this box is on Tailscale AND the tailnet allows HTTPS certificates, fetches a real, trusted
#     certificate for the box's tailnet name and renews it when it has under 30 days left. With that,
#     https://<box>.<tailnet>.ts.net:<port> opens with no warning and phone alerts work.
#   - Otherwise leaves the built-in self-signed certificate in place.
#
# What it never does: replace a certificate somebody else put there. It only replaces (a) a self-signed
# certificate, or (b) a certificate for this box's own tailnet name, which is one it fetched earlier.
#
# The server notices the new files by itself and starts using them; nothing is restarted.
set -u
ROOT="${CORTEX_ROOT:-/opt/cortex}"
DATA="${CORTEX_DATA:-$ROOT/data}"
TLS="$DATA/tls"
LOG="$DATA/update.log"
OWNER="${CORTEX_USER:-cortex}"
RENEW_DAYS=30
log(){ printf '%s https: %s\n' "$(date -Is)" "$*" >> "$LOG" 2>/dev/null || true; }
once(){ # log a message only when it changes, so a standing condition is not repeated every 30 minutes
  local f="$TLS/.last-note"; [ "$(cat "$f" 2>/dev/null)" = "$*" ] && return 0; printf '%s' "$*" > "$f" 2>/dev/null || true; log "$*"; }

ENVF="$DATA/appliance.env"
if grep -qiE '^[[:space:]]*CORTEX_HTTPS=(0|off|false|no)[[:space:]]*$' "$ENVF" 2>/dev/null; then exit 0; fi
PORT="$(sed -n 's/^[[:space:]]*CORTEX_HTTPS_PORT=\([0-9][0-9]*\).*/\1/p' "$ENVF" 2>/dev/null | tail -n1)"; PORT="${PORT:-8443}"
mkdir -p "$TLS" 2>/dev/null || exit 0

# --- firewall: https follows the plain port. LAN-open boxes get it on the LAN; Tailscale-only boxes on Tailscale only.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  if ! ufw status 2>/dev/null | grep -Eq "^$PORT(/tcp)? "; then
    if ufw status 2>/dev/null | grep -Eq '^8080/tcp +ALLOW +Anywhere'; then ufw allow "$PORT"/tcp >/dev/null 2>&1 && log "firewall: opened https port $PORT"
    else ufw allow in on tailscale0 to any port "$PORT" proto tcp >/dev/null 2>&1 && log "firewall: opened https port $PORT on Tailscale only"; fi
  fi
fi

command -v tailscale >/dev/null 2>&1 || exit 0
command -v openssl >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
ST="$(tailscale status --json 2>/dev/null)" || exit 0
[ "$(printf '%s' "$ST" | jq -r '.BackendState // empty' 2>/dev/null)" = "Running" ] || exit 0
NAME="$(printf '%s' "$ST" | jq -r '.Self.DNSName // empty' 2>/dev/null | sed 's/\.$//')"
case "$NAME" in *.ts.net) ;; *) exit 0 ;; esac
printf '%s' "$NAME" | grep -Eq '^[A-Za-z0-9.-]+$' || exit 0

CERT="$TLS/cert.pem"; KEY="$TLS/key.pem"
if [ -s "$CERT" ]; then
  SUBJ="$(openssl x509 -in "$CERT" -noout -subject 2>/dev/null | sed 's/^subject= *//')"
  ISS="$(openssl x509 -in "$CERT" -noout -issuer 2>/dev/null | sed 's/^issuer= *//')"
  MINE=0
  openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$NAME\b" && MINE=1
  if [ "$MINE" = 1 ]; then
    openssl x509 -in "$CERT" -noout -checkend $((RENEW_DAYS*86400)) >/dev/null 2>&1 && exit 0     # ours, and still good
  elif [ -n "$SUBJ" ] && [ "$SUBJ" != "$ISS" ]; then
    once "a certificate that Cortex did not make is installed; leaving it alone"; exit 0
  fi
fi

TMP="$(mktemp -d "$TLS/.new.XXXXXX" 2>/dev/null)" || exit 0
trap 'rm -rf "$TMP"' EXIT
if ! tailscale cert --cert-file "$TMP/cert.pem" --key-file "$TMP/key.pem" "$NAME" >"$TMP/out" 2>&1; then
  once "could not get a trusted certificate for $NAME ($(tr '\n' ' ' < "$TMP/out" | cut -c1-160)). Turn on MagicDNS and HTTPS Certificates in the Tailscale admin console (DNS page). Using the self-signed certificate meanwhile."
  exit 0
fi
# sanity: a real pair, for this name, key matches the certificate
openssl x509 -in "$TMP/cert.pem" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$NAME\b" || { once "the fetched certificate is not for $NAME; ignored"; exit 0; }
A="$(openssl x509 -in "$TMP/cert.pem" -noout -pubkey 2>/dev/null | openssl sha256 2>/dev/null)"
B="$(openssl pkey -in "$TMP/key.pem" -pubout 2>/dev/null | openssl sha256 2>/dev/null)"
[ -n "$A" ] && [ "$A" = "$B" ] || { once "the fetched certificate and key do not match; ignored"; exit 0; }
chmod 600 "$TMP/key.pem"; chmod 644 "$TMP/cert.pem"
chown "$OWNER":"$OWNER" "$TMP/key.pem" "$TMP/cert.pem" 2>/dev/null || true
[ -s "$CERT" ] && [ ! -e "$TLS/cert.selfsigned.pem" ] && [ "${MINE:-0}" = 0 ] && { cp -p "$CERT" "$TLS/cert.selfsigned.pem" 2>/dev/null; cp -p "$KEY" "$TLS/key.selfsigned.pem" 2>/dev/null; }
mv -f "$TMP/key.pem" "$KEY" && mv -f "$TMP/cert.pem" "$CERT" || { once "could not install the new certificate"; exit 0; }
printf '%s' "$NAME" > "$TLS/.tailscale-name" 2>/dev/null || true
rm -f "$TLS/.last-note"
log "trusted certificate installed for $NAME (https://$NAME:$PORT)"
exit 0
