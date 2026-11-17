# Cortex — a self-hosted replacement for LG central HVAC controllers

Cortex replaces LG's ACP / AC Smart central controllers. A small mini-PC on site speaks LG's **LGAP**
protocol directly over the RS485 bus and runs the whole indoor-unit fleet: power, mode, fan, setpoints,
locks and schedules. It watches the equipment by itself, records faults with the readings around them,
and helps a technician find the cause. You reach it from any browser on the LAN, or remotely over
Tailscale. No cloud, no per-controller license, no vendor lock-in.

**Cortex Command** is the companion console: every building you look after on one screen, in a browser
or as a Windows app.

**Cortex for Windows** is a small app for the people in the building: it finds the controller on the
network, opens it like any program, and raises a Windows notification when something needs attention.
See [docs/DESKTOP_APP.md](docs/DESKTOP_APP.md).

> **Status: v1.7.0, stable.** Cortex runs a live LG Multi V IV system as a drop-in central controller.
> Discovery, control, locks, schedules, unattended polling, outdoor unit readings and fault recording
> have all run on real equipment. Some newer parts have had limited real-world use so far; the
> [changelog](CHANGELOG.md) says which. Protocol notes: [LGAP_reference.md](LGAP_reference.md).

Every picture below comes from the **demo building** that ships inside Cortex: pretend equipment,
real screens. You can open it yourself from the sign-in screen.

---

## Day to day

**Dashboard.** Every indoor unit at a glance: what it is set to, the room temperature, mode, locks and
faults, grouped your way, with site weather on top. Customers see names, never bus addresses.

![Dashboard](docs/img/01-dashboard.png)

**Unit control.** Power, mode, fan, swing, setpoint and locks for one unit. Technicians also see the bus
address, the raw frames and a command preview.

![Unit control](docs/img/02-unit-control.png)

**Many units at once, and locks that show what is set.** Select units and change them together. Each
lock button shows locked, unlocked or "1 of 4 locked"; a tap flips it, and one tap unlocks or locks
everything.

![Locks](docs/img/03-locks.png)

**Schedules.** On/off, mode, fan and setpoint by time and day, with nth-weekday recurrence and weather
conditions. The controller runs them with every browser closed.

![Schedules](docs/img/12-schedule.png)

**Building map.** Every unit drawn with its live state. Upload a floor plan per group and drag units
onto it.

![Building map](docs/img/13-map.png)

**Trends.** One reading per unit every five minutes, kept about a month, with a CSV download.

![Trends](docs/img/14-trends.png)

**Backup by section.** Choose what goes in the file, and restore only the parts you tick.

![Backup](docs/img/15-backup.png)

**On a phone.** The same screens, laid out for one hand, plus an optional one-room page for occupants.

![Phone layout and the occupant page](docs/img/16-phone.png)

---

## Finding the fault

**Outdoor unit and refrigerant cycle.** Live pressures, temperatures, compressors, fans and valves for
each outdoor unit, a charge check, a health score, and cycle diagnosis that raises advisories in plain
language ("Low refrigerant charge: 4 of 6 signs").

![Outdoor unit and cycle](docs/img/04-outdoor-cycle.png)

**Refrigerant diagram.** The same readings drawn on the circuit, with every indoor unit's pipe
temperatures and valve position.

![Refrigerant diagram](docs/img/05-refrigerant-diagram.png)

**Error reference.** What each code means, what to do, how LG's controller reacts, checked against LG's
Multi V IV, Multi V S and Multi V 5 service manuals.

![Error page](docs/img/06-error-page.png)

**Step-by-step diagnosis.** A short list of yes/no checks for the common codes, using live readings
where Cortex has them.

![Diagnose step by step](docs/img/07-diagnose.png)

**Field reference with drawings.** Which pins to measure, which wire is which colour, and what the
reading should be: thermistors, pressure sensors, EEV coils, fan motors, the inverter board, the
compressor, the 4-way valve.

![Field reference drawings](docs/img/08-drawings.png)

**Fault history.** Every fault and every unit that went silent, with a 30-day timeline and open
advisories.

![Fault history](docs/img/09-fault-history.png)

**The recording behind each fault.** Readings from ten minutes before to a few minutes after, one sample
about every 15 seconds.

![Fault recording](docs/img/10-fault-recording.png)

**Fault report.** One printable page (or a PDF) with the code, the readings before it, the charts, a
tick-box checklist and room for notes.

<img src="docs/img/11-fault-report.png" alt="Fault report" width="520">

---

## Cortex Command

One console for every building. It reads from each building's controller and never sends a command to
the heating and cooling. Details: [docs/COMMAND_APP.md](docs/COMMAND_APP.md).

**Buildings.** A card per building with live figures, a ring for on / off / error / silent, and the
last 24 hours drawn across it.

![Buildings](docs/img/20-command-buildings.png)

**Daily briefing.** The first sign-in of the day: what needs attention, what is already in hand, what
changed since you were last here.

![Daily briefing](docs/img/21-command-briefing.png)

**Alerts.** Acknowledge an alert with a note, snooze a building, and see which units keep faulting.

![Alerts](docs/img/22-command-alerts.png)

**Building details.** Trends over 24 hours or 7 days, health per outdoor unit, notes, a service log, and
a printable 30-day report for the customer.

![Building details](docs/img/23-command-details.png)

**Find any unit.** One search box across every building: a room name, a code such as CH05, "offline",
"filter".

![Unit search](docs/img/24-command-search.png)

**Controller software.** Every controller's version in one list. The Windows app can start a
controller's update from here.

![Controller software](docs/img/25-command-controllers.png)

---

## Features

**Control**
- **Direct LGAP control** of power, mode, fan, swing and setpoint over RS485. No ACP or AC Smart needed.
- **Every wall-controller lock:** Mode, Fan, Temp, Hard, and a temperature-range lock with a settable
  minimum and maximum. The Hard lock is read back from each unit.
- **Filter sign reset** from the unit's panel.
- **Batch changes** to any selection of units.
- **Schedules** with nth-weekday recurrence and weather conditions, run by the controller itself.
- **Site setpoint limits** that customers and schedules cannot go past.

**Watching the building**
- **The controller polls by itself.** No browser has to stay open. It reconnects and resumes after a
  reboot, an update or an adapter blip.
- **Fault recorder.** Every fault is saved with the readings from before and after.
- **Trends** for every unit and every outdoor unit, kept about a month, with CSV download.
- **Alerts on a phone** for faults, silent units and advisories (needs HTTPS turned on; see
  [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)).
- **Background re-discovery** offers to add units that appear later, such as after a remodel.

**Diagnosis**
- **Outdoor unit pages decoded** for Multi V IV: pressures, temperatures, superheat, subcooling,
  compressors, fans, valves, electrical readings. Multi V S and Multi V 5 are supported from LG's
  documents and have not yet been seen on live equipment.
- **Cycle diagnosis, charge check and a health score** per system.
- **Guided checks, an error reference and service drawings.**
- **Printable fault reports.**
- **Bus scan and master tools** for technicians: a live, readable view of the RS485 bus with raw frames.

**Running a site**
- **Three audiences.** Customers see names and temperatures; bus addresses, raw frames and the cycle
  pages appear only for technicians. Logins with roles (customer, admin, technician, owner).
- **Your own layout.** Groups and subgroups, renaming, floor plans.
- **Backup and restore by section:** site details, logins, units, schedules, floor plans, preferences.
- **Clear unit data** without a factory reset.
- **Updates over the air,** verified, with automatic rollback, a stable and a beta channel, and a way
  back from beta to stable.
- **Demo building** for training and showing customers. Nothing in it reaches real equipment. See
  [docs/DEMO_BUILDING.md](docs/DEMO_BUILDING.md).
- **Occupant view,** off by default: a link per room that lets the people in it adjust the temperature
  inside limits you set. See [docs/OCCUPANT_VIEW.md](docs/OCCUPANT_VIEW.md).
- **Optional HTTPS,** device health, live local weather, a built-in protocol reference.

**Cortex Command**
- Building cards, daily briefing, alerts with acknowledge and snooze, repeat offenders, unit search,
  notes and service logs, customer reports.
- **Sync between computers** through a controller you choose.
- **Windows app** that installs like any program, updates itself, keeps watching from the tray and
  raises Windows notifications. Download `Cortex-Command-Setup-<version>.exe` from the
  [latest release](https://github.com/h2erft/cortex/releases/latest).

### What to know before relying on it
- Sign-in keeps casual users out of settings; it is not network security. Anyone who can reach a
  controller on the network can reach its data. Keep controllers on a private network or Tailscale.
- Never run Cortex as bus master while an LG central controller is polling the same bus.
- Only Multi V IV outdoor units have been confirmed on live equipment.

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
curl -fsSL https://raw.githubusercontent.com/h2erft/cortex/main/appliance/bootstrap.sh | sudo bash
```
That pulls this repo and runs the installer — Node, the Cortex service, a firewall, Tailscale,
`cortex.local` on the network, and automatic over-the-air updates. (~10 minutes.)

### 4. Open it
From any phone or laptop on the same network:
```
http://cortex.local
```
(or the controller's IP address; `:8080` on the end also works).
The setup wizard walks you through naming the site and picking the adapter. For remote access,
run `sudo tailscale up` on the box and reach it at its Tailscale IP from anywhere.

Full details, the OTA release flow, and troubleshooting are in
**[appliance/README-appliance.md](appliance/README-appliance.md)**.

---

## How it works
- **`cortex.html`** is the controller's whole interface, one file. It also contains the demo building.
- **`command-center.html`** is Cortex Command. **`command-app/`** wraps it as the Windows app.
- **`desktop-app/`** is Cortex for Windows, the app for a building's own users.
- **`room.html`** is the occupant page.
- **`appliance/`** is the mini-PC backend: the serial bridge, the poller that runs the bus by itself,
  the scheduler, the fault recorder, diagnosis, notifications, the installer and the updater.
- **`tests/`** has eighteen suites. They run the real pages in a headless browser against reference
  frames and the built-in simulator; nothing is transmitted on a real bus.
- **`LGAP_reference.md`** is the decoded protocol: bus, framing, checksums, command and reply layouts.
- **`docs/`** has the guides linked above, plus developer notes in `HANDOFF.md` and
  `NEXT_AGENT_GUIDE.md`.

## Contributing
This is interoperability work on equipment we own. The most useful contributions are **real LGAP bus
captures**, especially from outdoor unit families other than Multi V IV, and corrections to the error
reference from LG manuals. See [LGAP_reference.md](LGAP_reference.md).

## Releases
Tag a version and push it. A GitHub Action builds the controller update and the Cortex Command
installer and attaches both to the release. Controllers and Command installs pick it up by themselves.
```
git tag vX.Y.Z && git push origin vX.Y.Z
```
A tag with a suffix (`vX.Y.Z-beta.N`) is a **pre-release**; only controllers and Command installs with
*Beta testing* on take those. Release history: [CHANGELOG.md](CHANGELOG.md).

*Cortex by AIROW. Not affiliated with or endorsed by LG.*
