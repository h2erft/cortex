# Cortex appliance — run it on the N95 mini PC

This turns your N95 mini PC into a plug-in Cortex controller. It boots, starts Cortex by
itself, owns the RS485 adapter, survives crashes and power loss, updates itself over the
internet, and you reach it from any phone or laptop — on the shop/site LAN or remotely
over Tailscale.

**The shape, in one breath:** a tiny program on the N95 serves the same Cortex web UI you
already have and holds the serial port open 24/7 (way more reliable than a browser). It
runs on any mini PC. Low maintenance, hard to knock over, and you can push new versions
without driving to the site.

---

## Part A — First-time setup of a new N95 (do this once, on the bench)

**1. Put Linux on it.** Install **Ubuntu Server 24.04** or **minimal Debian 12** on the
N95 (no desktop needed). A USB stick made with Rufus/balenaEtcher and 20 minutes does it.
During install, create yourself a login and enable OpenSSH so you can reach it over the
network.

**2. Copy the Cortex folder onto it.** USB stick, or from your PC:
```
scp -r Cortex you@<n95-ip>:~/
```

**3. Run the installer** (one command, ~10 min — it pulls Node, Tailscale, the firewall,
and sets everything up):
```
cd ~/Cortex/appliance
sudo bash install.sh
```

**4. Join your private network (Tailscale)** so you can reach this box from anywhere
without opening it to the internet:
```
sudo tailscale up
```
Follow the link it prints, log in, done. The N95 now has a permanent private IP on your
tailnet.

**5. Open Cortex** from your phone or laptop:
- On the same LAN: `http://<n95-ip>:8080`
- From anywhere (Tailscale): `http://<n95-tailscale-ip>:8080`

That's a working appliance. Everything below is tuning and deployment.

---

## Part B — Point it at the RS485 adapter

The backend opens `/dev/ttyUSB0` by default. Plug in your Waveshare USB-RS485 adapter and
check where it landed:
```
ls -l /dev/serial/by-id/
```
If it's not `ttyUSB0`, or you want to name this site, edit the settings file:
```
sudo nano /opt/cortex/data/appliance.env
```
```
CORTEX_PORT=8080
CORTEX_SERIAL=/dev/ttyUSB0      <- change if needed
CORTEX_NAME=Maple Street Office  <- shows up in the fleet console
```
Then:
```
sudo systemctl restart cortex-appliance
```
In Cortex → **Bus scan → Connect adapter**. In appliance mode there's no browser port
picker — the backend owns the port and the frames just start flowing. Bus is **4800 8N1**.

---

## Part C — Drop it on a site

1. Mount the N95 near the LG RS485 trunk; wire the adapter's A/B to the bus (same two
   wires the old ACP used).
2. Give it internet — the site's LAN (DHCP is fine) or a cheap LTE hotspot. It only needs
   outbound internet; nothing is exposed inbound except over Tailscale.
3. Power it. It auto-starts Cortex on boot. Confirm from your phone over Tailscale.
4. **Lock it down** once Tailscale works — close the LAN port so only your tailnet can
   reach it:
   ```
   sudo ufw delete allow 8080/tcp
   ```
5. Add the site to the **Command Center** (fleet console): its Tailscale URL,
   e.g. `http://100.x.y.z:8080`.

The box now runs headless. Reboots, power blips, and crashes all self-recover.

---

## Part D — Over-the-air updates (push new Cortex versions from your desk)

**How it works:** each appliance checks a small `manifest.json` file on a web address you
control, every ~30 minutes. When the manifest names a newer version, the appliance
downloads it, verifies its fingerprint, installs it, and flips to it in an instant. If the
new build doesn't come up healthy, it **automatically rolls back** to the previous version.
A bad update can't strand a site.

### One-time: pick where updates live
You need any plain web address that can serve two files. Easiest options:
- a **GitHub Release** (free; upload the two files as release assets), or
- an **S3 / Cloudflare R2 bucket** with public read, or
- a small always-on box on your tailnet serving a folder.

Whatever you pick, you'll upload two files to it: `cortex-<version>.tgz` and
`manifest.json`.

### One-time per appliance: turn OTA on
On each N95:
```
sudo nano /opt/cortex/data/update.conf
```
```
CORTEX_UPDATE_MANIFEST=https://your-host/cortex/manifest.json
```
That's it. (Leave it blank to disable OTA on a box.)

### Every time you ship a new version
On your dev machine, in the Cortex folder:
```
bash appliance/release.sh 1.1.0 https://your-host/cortex
```
(Use a version number **higher** than the last one — `1.1.0`, `1.2.0`, etc. Appliances
only ever move forward.)

It builds two files in `appliance/dist/`:
- `cortex-1.1.0.tgz` — the new build
- `manifest.json` — the pointer

**Upload both** to `https://your-host/cortex/`. Within ~30 minutes every appliance picks
it up, verifies it, installs it, and rolls back on its own if anything's wrong. Done — no
site visit.

### Checking / forcing an update
On an appliance:
```
sudo /opt/cortex/current/cortex-update.sh     # check & apply right now
cat /opt/cortex/data/update.log               # what the updater has done
journalctl -u cortex-updater -f               # live updater log
```

---

## What's in this folder
- `server.js` — the backend: serves the Cortex UI, bridges the RS485 adapter to the browser, reports `/health` and `/version`.
- `VERSION` — the running version (source of truth; OTA bumps this).
- `package.json` / `package-lock.json` — dependencies (express, ws, serialport).
- `cortex-appliance.service` — systemd unit: auto-start, auto-restart, sandboxed, runs the `current` release.
- `cortex-update.sh` — the OTA updater (download → verify → atomic swap → health-check → rollback).
- `cortex-updater.service` / `cortex-updater.timer` — run the updater every ~30 min.
- `install.sh` — one-shot installer (Node, Tailscale, firewall, service, updater, atomic layout).
- `release.sh` — build a new versioned release + manifest to upload.

## Layout on the N95 (so you know where things are)
```
/opt/cortex/
  current -> releases/1.0.0     # symlink to the live version; OTA just repoints this
  releases/
    1.0.0/                      # each version in its own folder (old ones kept for rollback)
  data/                         # survives updates
    appliance.env               # port, serial device, site name
    update.conf                 # OTA manifest URL
    update.log                  # OTA history
```

## Handy commands
```
systemctl status cortex-appliance         # is it running?
journalctl -u cortex-appliance -f         # live app log
systemctl restart cortex-appliance        # restart after editing settings
cat /opt/cortex/current/VERSION           # what version is live
```
