# Cortex — a self-hosted replacement for LG central HVAC controllers

Cortex replaces LG's ACP / AC Smart central controllers. It speaks the LG **LGAP** protocol
directly over the RS485 bus, so a small mini-PC on-site runs the whole indoor-unit fleet —
power, mode, fan, dual setpoints, locks — from a clean web UI you reach on the LAN or
remotely over Tailscale. No cloud, no per-controller license, no vendor lock-in.

> **Status:** working appliance + UI; the LGAP **master/controller** mode is in beta while we
> finish decoding the discovery query and the room-temp calibration. Reverse-engineering notes
> are in **[LGAP_reference.md](LGAP_reference.md)** — contributions welcome.

---

## What it looks like

**First-run setup wizard** — name the site, pick the RS485 adapter. Runs once; after that
everyone gets a login screen.

![Setup wizard](docs/img/01-setup-wizard.png)

**Dashboard** — every indoor unit at a glance: mode, setpoint, room temp, locks, faults,
grouped by system. This is the screen a maintenance tech or a customer uses day to day.

![Dashboard](docs/img/02-dashboard.png)

**Unit control** — tap a unit for power, mode, fan, dual cool/heat setpoints, and per-function
locks.

![Unit control](docs/img/03-unit-control.png)

**Bus scan (live)** — a readable, real-time view of what's happening on the RS485 bus.

![Bus scan live](docs/img/04-bus-live.png)

**Master / CC mode + debug tools** — the byte-level workshop: Cortex drives the bus like the
LG controller (discover units, poll replies, send commands), with raw TX/RX logging.

![Master mode](docs/img/05-master-mode.png)

**Settings / About** — remote access, power controls, and the full LGAP protocol reference
built right into the app.

![Settings and About](docs/img/06-settings-about.png)

---

## Install it yourself

You need a small always-on PC (a cheap N95/N100 mini-PC is ideal), a **USB-to-RS485 adapter**
(e.g. a Waveshare), and about 20 minutes.

### 1. Put Linux on the mini-PC
1. Download **Ubuntu Server 24.04 LTS** (or Debian 12).
2. Flash it to a USB stick with [balenaEtcher](https://etcher.balena.io/) or Rufus.
3. Boot the mini-PC from the stick and install. When asked, create your login and **tick
   “Install OpenSSH server”** so you can reach it from your laptop.

### 2. Find it on the network
After it reboots, from your laptop:
```
ssh <your-login>@<mini-pc-ip>
```
(Your router's device list shows the IP.) If the wired port didn't get an address, set it to
DHCP: `sudo nano /etc/netplan/01-cortex.yaml` →
```
network:
  version: 2
  ethernets:
    enp2s0:            # your adapter name from `ip a`
      dhcp4: true
```
then `sudo netplan apply`.

### 3. One command installs everything
```
curl -fsSL https://raw.githubusercontent.com/YOUR-GH-USER/cortex/main/appliance/bootstrap.sh | sudo bash
```
That pulls this repo and runs the installer — Node, the Cortex service, a firewall, Tailscale,
`cortex.local` on the network, and automatic over-the-air updates. (~10 minutes.)

### 4. Open it
From any phone or laptop on the same network:
```
http://cortex.local:8080
```
The setup wizard walks you through naming the site and picking the adapter. For remote access,
run `sudo tailscale up` on the box and reach it at its Tailscale IP from anywhere.

Full details, the OTA release flow, and troubleshooting are in
**[appliance/README-appliance.md](appliance/README-appliance.md)**.

---

## How it works
- **`cortex.html`** — the controller UI (served by the appliance, or openable as a file for a demo).
- **`command-center.html`** — the fleet console: all your sites in one place with live health.
- **`appliance/`** — the mini-PC backend (serial bridge, systemd service, installer, OTA).
- **`LGAP_reference.md`** — the decoded LGAP protocol: bus, framing, checksums, command and
  reply layouts, mode/fan codes, and the open questions.

## Contributing
This is interoperability work on equipment we own. The most useful contributions right now are
**real LGAP bus captures** (especially an ACP discovering + polling indoor units) and anything
you know about the LGAP reply layout. See [LGAP_reference.md](LGAP_reference.md).

## Releases / OTA
Tag a version and push it — a GitHub Action builds the release, and every deployed appliance
pulls it automatically (verified, with auto-rollback):
```
git tag v1.4.0 && git push origin v1.4.0
```

*Cortex by AIROW. Not affiliated with or endorsed by LG.*
