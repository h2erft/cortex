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
4. **Lock it down** once Tailscale works — close the LAN ports so only your tailnet can
   reach it:
   ```
   sudo ufw delete allow 8080/tcp
   sudo ufw delete allow 8443/tcp     # the optional https port (Part E)
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
If a new build does not come up healthy the updater rolls back and **skips that build** until a
different one is published. To make it try the same build again:
```
sudo CORTEX_UPDATE_FORCE=1 /opt/cortex/current/cortex-update.sh
```

### Stable and beta channels
Appliances follow **stable** releases by default. Settings → Updates → *Beta testing* switches a
box to also take pre-releases (`-beta.N`, `-rc.N`). Turning it off returns to stable at the next
stable release that is newer than what is installed.

### What lives on the box
Everything a site needs is under `/opt/cortex/data/` and survives updates: settings
(`appconfig.json`), the unit list (`units.json`), trend history (`history/`), floor plans
(`floorplans/`). Each settings file has a `.bak` copy of the last good save.

---

## Part E — Secure access over HTTPS (optional)

**You do not need this for Cortex to work.** Out of the box the appliance serves plain `http` on
port 8080, and that never changes. HTTPS is an *extra* door you can open next to it:

- it is **off** until you turn it on,
- turning it on does **not** turn http off, and nothing redirects — if https ever misbehaves, the
  normal `http://cortex.local:8080` address still works, so you cannot lock yourself out,
- if the certificate is missing or broken, Cortex logs the reason, shows it in **Device health**,
  and carries on serving http.

Why bother: browsers only allow a few features on secure pages. The one that matters here is
**"Use my location"** (Settings → Advanced → Site location) — it works once you open Cortex over
`https://`. Over plain http you type the coordinates in by hand instead.

### Turn it on (two steps)
1. Edit the settings file and remove the `#` in front of `CORTEX_HTTPS=1`
   (add the line if your file is older and doesn't have it):
   ```
   sudo nano /opt/cortex/data/appliance.env
   ```
   ```
   CORTEX_HTTPS=1
   CORTEX_HTTPS_PORT=8443      <- optional; 8443 is the default
   ```
2. Restart Cortex:
   ```
   sudo systemctl restart cortex-appliance
   ```
Now open `https://cortex.local:8443`. In Cortex, the **Device health** button (top right, next to
Settings — technicians and admins) shows *Secure access (HTTPS): On*, the port, and when the
certificate expires.

To turn it back off, put the `#` back (or set `CORTEX_HTTPS=0`) and restart.

**Firewall:** `install.sh` sets up `ufw` the **first** time it runs and leaves an already-active
firewall alone after that (so a site you locked down to Tailscale stays locked down). When
`CORTEX_HTTPS=1` is set it adds the https port. To make it rebuild the rules from scratch, run
`sudo CORTEX_RESET_FIREWALL=1 bash install.sh`. If this box has only ever been updated over the
air since before v1.5.0, open the https port once by hand:
```
sudo ufw allow 8443/tcp
```
(and when you lock a site down to Tailscale-only, close it again with `sudo ufw delete allow 8443/tcp`,
the same way as port 8080.)

### The browser warning (self-signed certificate)
The installer creates a **self-signed** certificate in `/opt/cortex/data/tls/` (`cert.pem` +
`key.pem`), valid for the box's name, `<name>.local` and `localhost`. "Self-signed" means the box
vouches for itself — the connection is encrypted, but your browser has no outside authority to
check it against, so the first visit shows a warning like *"Your connection is not private"*.
That is expected. Click **Advanced → Proceed** (wording varies by browser); you do it once per
browser. If you would rather have no warning at all, use the Tailscale route below.

If the box has no certificate yet (it was installed before this feature and only updated over the
air), Cortex makes the same self-signed one by itself the first time it starts with
`CORTEX_HTTPS=1`. An existing `cert.pem` / `key.pem` is **never** overwritten — not by the
installer, not by Cortex, not by an update.

### A trusted certificate with Tailscale (no browser warning)
If the box is on your tailnet, Tailscale can issue a real, browser-trusted certificate for its
tailnet name (something like `cortex.your-tailnet.ts.net`).

1. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**
   (one-time, for the whole tailnet).
2. On the box, find its full name and ask for the certificate, writing it straight to where
   Cortex looks:
   ```
   tailscale status --json | jq -r '.Self.DNSName'    # the box's full tailnet name (ignore the trailing dot)
   sudo tailscale cert \
     --cert-file /opt/cortex/data/tls/cert.pem \
     --key-file  /opt/cortex/data/tls/key.pem \
     cortex.your-tailnet.ts.net
   sudo chown cortex:cortex /opt/cortex/data/tls/cert.pem /opt/cortex/data/tls/key.pem
   sudo chmod 600 /opt/cortex/data/tls/key.pem
   sudo systemctl restart cortex-appliance
   ```
   (This replaces the self-signed pair — that is fine, you are the one doing it. Move the old two
   files aside first if you want to keep them.)
3. Open `https://cortex.your-tailnet.ts.net:8443` from any device on your tailnet — no warning.

These certificates expire after about 90 days. Re-run the `tailscale cert` command and restart
Cortex to renew; Device health shows the expiry date so it doesn't sneak up on you. The
certificate only matches the tailnet name, so `https://cortex.local:8443` on the LAN will warn
again — use the tailnet name, or plain http, there.

Any other certificate works the same way: put the certificate (with its chain) at
`/opt/cortex/data/tls/cert.pem` and the private key at `/opt/cortex/data/tls/key.pem`, make both
readable by the `cortex` user, and restart. (`CORTEX_TLS_CERT` / `CORTEX_TLS_KEY` in
`appliance.env` point Cortex at different paths if you need that; they must be under
`/opt/cortex/data` or another place the service may read.)

### If https doesn't come up
```
journalctl -u cortex-appliance -n 30      # look for a line starting "HTTPS"
```
Device health shows the same reason. The usual causes: the key isn't readable by the `cortex`
user (see the `chown` above), the port is already in use, or the firewall port is closed. Plain
http keeps working while you sort it out.

---

## What's in this folder
- `server.js` — the backend: serves the Cortex UI, bridges the RS485 adapter to the browser, reports `/health` and `/version`; optionally also serves https (Part E) and stores building-map floor plans.
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
    appliance.env               # port, serial device, site name, optional CORTEX_HTTPS=1
    update.conf                 # OTA manifest URL
    update.log                  # OTA history
    appconfig.json              # shared setup: users, schedules, unit names, floor-plan positions
    floorplans/                 # building-map pictures uploaded from the UI (one file per group)
    tls/cert.pem, tls/key.pem   # https certificate (self-signed by default; never overwritten)
```

## Handy commands
```
systemctl status cortex-appliance         # is it running?
journalctl -u cortex-appliance -f         # live app log
systemctl restart cortex-appliance        # restart after editing settings
cat /opt/cortex/current/VERSION           # what version is live
```
