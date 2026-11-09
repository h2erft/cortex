# Cortex — by AIROW

A self-hosted replacement for LG ACP central controllers. Cortex talks the LG LGAP RS485
protocol directly, so a small mini PC on the site runs the whole indoor-unit fleet —
power, mode, fan, dual setpoints, locks — from a web UI you reach on the LAN or remotely
over Tailscale. No cloud, no per-controller license.

## What's here
- **`cortex.html`** — the controller UI (works two ways: served by the appliance backend, or opened straight from a file with Web Serial for bench work).
- **`command-center.html`** — the fleet console: all your sites in one place, with live health.
- **`setup.html`** — the appliance's first-run setup wizard (name the site, pick the adapter).
- **`appliance/`** — everything that turns a mini PC into a plug-in Cortex box: the backend, the installer, and over-the-air updates. See **[appliance/README-appliance.md](appliance/README-appliance.md)**.
- **`LGAP_reference.md`** — the decoded LGAP protocol (frames, checksums, mode/fan codes, locks), from analysis of LG's own ACP firmware.

## Install on a mini PC (short version)
On a fresh Ubuntu Server / Debian box:
```
curl -fsSL https://raw.githubusercontent.com/YOUR-GH-USER/cortex/main/appliance/bootstrap.sh | sudo bash
```
Then open `http://cortex.local:8080` and follow the setup wizard. Full steps and the
over-the-air update flow are in [appliance/README-appliance.md](appliance/README-appliance.md).

## Releases / OTA
Tag a version and push it — the GitHub Action builds the release payload and manifest, and
every appliance pointed at this repo picks it up automatically:
```
git tag v1.1.0 && git push origin v1.1.0
```
