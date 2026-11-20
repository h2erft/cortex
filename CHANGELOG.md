# Changelog

All notable changes to Cortex. Dates are when the work landed on `main`.

## Unreleased — on `main`, not yet tagged

_Sits on top of v1.7.1-beta.18. Changes `cortex.html`. Give it a version number when you cut the next release._

A full sweep of Cortex and Cortex Command: all 31 test suites pass, every page and settings
tab was checked for text spilling out of its box and for script errors at desktop, tablet and
phone widths, and both server bundles pass a syntax check. One real issue turned up and is fixed.

**Fixed**
- **Cortex: the on/off toggle switches spilled a few pixels past the right edge of their row on
  phone widths.** The cause was the invisible larger tap area around each switch extending past the
  edge; it now grows taller instead of wider, so the touch target stays generous without pushing the
  row over. Affected the Display, Updates and Advanced settings rows.

## v1.7.1-beta.18 — 2026-11-20 (Command header on small screens)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.17. Changes `command-center.html`._

**Fixed**
- **Command: the top bar ran off the right edge on a narrow window or phone,** cutting off the sign-out
  button. On small screens the "signed in as" chip is hidden and the title truncates, so the briefing,
  settings and sign-out buttons always fit. (The tab row and the settings section list were already
  horizontal scroll strips — those were never clipped.)

## v1.7.1-beta.17 — 2026-11-20 (settings page, role colours, calmer Command)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.16. Changes `cortex.html`,
`command-center.html`, `appliance/server.js`, `appliance/busmaster.js`, `appliance/fleetwatch.js`, tests._

**Cortex**
- **Asking every outdoor unit for its indoor units got few answers.** They were asked back to back.
  Now one outdoor unit is asked per pass, after a quiet moment on the wire, with a longer wait for the
  reply, and any that stay quiet are asked a second time at the end. Asking all takes longer but
  behaves like asking one at a time.
- **Settings is a page, not a popup.** Tabs run down the side; wide screens show two columns. The Layout
  tab shows each outdoor unit's indoor units as a card, side by side.
- **Every role has its own colour.** People get their role's accent colour by default (set it in the role
  editor); anyone can still choose their own in Settings ▸ Display, or go back to the role colour.
  Thirteen colours to choose from.
- **The big outdoor temperature comes from the outdoor units.** By default it is the average of the
  outdoor units' own air sensors. Settings ▸ Display can switch it to one sensor or the weather service.
  With no fresh sensor reading it falls back to the weather service.
- **Refrigerant diagram moved inside an outdoor unit.** The separate diagram page is gone: open an
  outdoor unit's tile and switch between Data and Refrigerant diagram there.
- **Menu:** long group names wrap instead of being cut off, and the menu's edge can be dragged wider or
  narrower (double-click to reset). The width is remembered per person.
- **Fault history no longer jumps to the top.** It refreshes quietly, redraws only when the list of
  faults changes, and keeps its place and any advisories that were open.

**Command**
- **Choose what interrupts you** (Settings ▸ Alerts): a controller offline, a unit in error, a unit that
  stopped answering, a new diagnosis advisory. The last two are now off unless switched on. Everything
  still shows on the Alerts tab. The same choices apply to alerts sent to a phone.
- **A controller is reported offline only after it has been offline for a while:** 15 minutes unless
  changed, from immediately up to 24 hours. Starting or quitting Command, a restart at the site, or a
  short drop says nothing. "Back online" is only said if "offline" was.
- Windows notifications are gathered and sent at most once every two minutes.
- **Acknowledge several alerts at once:** tick alerts or Select all, then Acknowledge selected, with one
  optional note for all of them.
- **Roles:** add, rename and delete roles, pick a colour and tick what each may do, and give each person
  a role. Command still has one sign-in (the owner), so a role is the record of what each person is
  trusted with until people get their own sign-in.
- Thirteen accent colours. Buttons at the foot of a window (the daily briefing's "Start the day") have
  proper spacing.

## v1.7.1-beta.16 — 2026-11-20 (one page for every LG channel, outdoor tiles, remote access and console from the dashboard)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.15. Changes `appliance/server.js`,
`appliance/busmaster.js`, `appliance/buslink.js`, `appliance/cortex.sudoers`, `appliance/install.sh`,
`appliance/cortex-update.sh`, `cortex.html`; adds `docs/CONSOLE_AND_REMOTE.md`, `tests/console-remote.test.js`._

**Bus scan**
- **Every LG channel is on one page.** A table of the channels (state, adapter, units, pass time) with
  connect, search, rename and remove on each row. The separate tab per line is gone.
- **Search every channel for units.** One button: the controller asks every address on channel 1, then
  moves to channel 2 and skips the addresses that already answered, and so on. Units already in Cortex
  are not asked again. One progress bar and one time-left figure cover all the channels.
- **Live data from every channel.** One box shows what the controller sends and hears on all channels,
  in plain words with the raw bytes. Pick a channel to see only that wire. Pause to read.

**Outdoor / cycle**
- **Outdoor units are tiles**, like indoor units: state, mode, the two pressures, outdoor air,
  compressor speed, health, and how many indoor units it has. Tapping one opens everything it reports.
- **Its indoor units are listed directly under it**, not all together at the bottom of the page.
- **Find this one** and **Ask it for its indoor units** work on the address typed in the box, so one
  outdoor unit can be found or asked without asking all of them again.
- **Grouping asks each outdoor unit only on its own channel.** The channel each outdoor unit is on is
  now remembered across restarts. If it does not answer there, the other channels are tried. The result
  window says which channel each one was asked on, and flags a list that came through incomplete.

**Fixed**
- **Renaming or regrouping while the controller is polling was thrown away.** The controller refused any
  edit made since the screen's last refresh, which with several lines polling was nearly always. An
  edit is now kept and the controller's newer readings are laid over it.
- **Text no longer spills out of its box.** Long adapter names, addresses and host names wrap or shrink
  inside their tiles (Device health showed it most). Device health shows the adapter's plain name.

**Added**
- **Remote access is switched on from the dashboard,** in the setup wizard and in Settings ▸ Advanced.
  The controller runs `tailscale up` itself and shows Tailscale's sign-in page to approve. No keyboard on
  the controller. The https certificate is fetched right after.
- **Controller console** (Settings ▸ Advanced): run commands on the controller from the dashboard. It
  has its own password, stored hashed on the controller and checked there; five wrong tries lock it for
  five minutes; commands run as the unprivileged service user, one at a time, for up to two minutes;
  every command is logged.

**Know before using**
- The console is not a root shell. `sudo` works only for: restarting Cortex, reading its log, reboot
  and power off, starting the updater, and Tailscale up and down.
- Existing controllers get the new sudo rules when they install this update. If "turn remote access on"
  says the controller has not been updated to allow it, run the updater once more.
- Anyone who can reach the dashboard before a console password is set can set it. Set it straight away
  on a controller you intend to use it on.

## v1.7.1-beta.15 — 2026-11-19 (grouping by outdoor unit on every line; welcome tutorial)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.14. Changes `appliance/server.js`,
`appliance/busmaster.js`, `cortex.html`; adds `tests/tour.test.js`._

**Fixed**
- **Group by outdoor unit reaches every LG line.** It used to ask only on the wire the screen held, so
  outdoor units on other lines did not answer and their indoor units showed as unclaimed. The controller
  now asks each outdoor unit on the line it is on (or on every line, if that is not known yet).
- **Outdoor units that miss a reply are asked again.** Each list page is asked up to three times, a
  little over a second apart.
- **Outdoor units the controller found are included.** Ones found with the new Find button were missing
  from the grouping list.

**Changed**
- **The Group by outdoor unit button is always shown.** When it cannot run, pressing it says why and
  what to do. It no longer needs a screen to hold the adapter.
- Unclaimed units show which line they are on and why a unit can end up unclaimed.

**Added**
- **Welcome tutorial.** A person added from now on gets a one-minute, skippable walk around the screen
  at their first sign-in: units, search, the menu, map, schedule, fault history, the bus light, alerts
  and settings. It only covers pages that person may open, is remembered per person across devices, and
  can be replayed from Settings ▸ About ▸ Show the tutorial. People who already had an account are not
  shown it unless they ask.

## v1.7.1-beta.14 — 2026-11-19 (find and read outdoor units from the controller)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.13. Changes `appliance/server.js`,
`appliance/busmaster.js`, `cortex.html`, tests._

**Fixed**
- **Outdoor / cycle: Read and Find outdoor units are back, and no longer need a screen to hold the
  adapter.** The controller does both itself, on every connected LG line at once. Find asks each address
  for the read-only monitor page (about three minutes) while the indoor units keep updating; what
  answers is remembered, with the line it is on, and read about once a minute from then on. Read asks
  one address now on every line.

**Still from a screen holding line 1:** grouping the indoor units by outdoor unit.

## v1.7.1-beta.13 — 2026-11-19 (several LG lines at once)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.12. Changes `appliance/server.js`,
`appliance/busmaster.js`, `cortex.html`; adds `docs/LG_LINES.md`, `tests/lg-lines.test.js`._

**Added**
- **More than one LG line.** A building with several separate LG wires gives each wire its own adapter,
  or its own channel of a multi-channel adapter. The controller runs one poll loop per line, all at the
  same time, and every unit shows in the same lists, map, schedules and fault history. Up to 8 lines.
  Bus scan ▸ LG line 1 ▸ **Add another LG line…**
- **Find units on a line.** Each extra line has its own page in Bus scan with a search the controller
  runs itself: it asks each address on that wire once (about two minutes) while the units already known
  keep updating, then offers to add what answered. An address that is already in Cortex on another line
  is flagged, with a one-click move if the unit really is on this wire.
- **The header bus light counts every LG line** ("All 4 buses online", "1 bus offline"), and its popup
  names each line.

**Changed**
- A command, a schedule or All on/off reaches each unit on the wire that unit is on.
- The bus tools on a screen (discover, raw frames, the screen's own polling) work on LG line 1 only and
  no longer touch units that are on another line.
- Outdoor units: each line asks for a known outdoor address until one line gets the answer, then only
  that line keeps asking.

**Rules and limits**
- Every indoor unit in the building needs its own address across all lines, as with LG's own central
  controller. Two different units sharing an address must be re-addressed at the unit.
- Live polling is one switch for the whole site: every line follows it.
- Extra lines have no raw byte view and no outdoor-unit finder yet; enter outdoor addresses by hand on
  the Outdoor page.
- Tested against simulated wires, not yet on a real multi-line LG site.

## v1.7.1-beta.10 to beta.12 — 2026-11-19 (multi-channel RS-485 adapters; Command: no false "offline", its own icon)

_Published in three steps: beta.10 the phone status bar, beta.11 the Command fixes and icon, beta.12 the
multi-channel adapters._


_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.9. Changes `command-center.html`,
`command-app/icon.png`, `desktop-app/main.js`, `appliance/pwa.js`, `appliance/server.js`, `cortex.html`,
`tests/command-offline.test.js`; adds `appliance/adapters.js`, `docs/ADAPTERS.md`, `tests/adapters.test.js`._

**Fixed**
- **Command no longer calls every building offline when the computer running it loses its connection.**
  When that computer is offline, or every building fails in the same look (internet or Tailscale down on
  this side), no building is marked offline and no alert or notification is raised. A strip across the
  top says the trouble is on this computer and the statuses are the last known ones. Command catches up
  by itself when the connection returns. A single building must now miss two looks in a row (about 40
  seconds) before it is called offline.
- **Cortex for Windows** no longer counts a PC with no network as the controller not answering.
- **Phone: the strip behind the clock and battery follows the theme.** After beta.9 it stayed light in
  dark mode. It now takes the header's colour in light and dark, and follows the phone when the theme
  is set to automatic.

**Changed**
- **Cortex Command has its own icon and logo:** the Cortex brain on a dark tile inside a ring of three
  buildings, so it can be told apart from Cortex on a desktop, taskbar and home screen.

**Known limit:** if every building really is offline at the same moment while this computer is online,
Command shows the "can't reach any building" strip instead of alerting.

**Added: multi-channel RS-485 adapters**
- **Multi-channel USB RS-485 adapters, starting with the Waveshare USB TO 4CH RS485 (CH344).** Each
  channel is listed by name and number ("channel 2 of 4", matching the terminal numbers on the case), so
  one adapter can carry the LG bus on one channel and Rheem / Ruud systems on the others. FTDI 2- and
  4-port adapters are numbered the same way. Two identical adapters are told apart by serial number.
- **Bus scan ▸ Choose adapter…** A technician can now pick which adapter or channel the LG bus is on from
  the dashboard. Before, this could only be set on the first-run setup page. The bus reconnects on the
  new adapter by itself.

**Changed: adapters**
- Adapters are saved by their stable name, so a replug or restart cannot swap channels.
- Cortex does not guess between the channels of a multi-channel adapter. A channel in use by a
  Rheem / Ruud system cannot be given to the LG bus, and the other way round.

**Not verified on real hardware:** the adapter itself, and that the first port is terminals A1/B1.

## v1.7.1-beta.9 — 2026-11-19 (phone: blurred header)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.8. Changes `cortex.html`._

**Fixed**
- **Phone: the top of the page could look blurred on Indoor units.** Cortex has no blur of its own; iOS
  lays one over the top of the screen when the whole page scrolls or stretches. On a phone the page is
  now pinned so only the list inside it scrolls, and a pull past the end stays inside the list.
  Confirmed on an iPhone.

## v1.7.1-beta.8 — 2026-11-18 (one home for every manufacturer)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.7. Changes `cortex.html`,
`appliance/server.js`, `appliance/econetlink.js`, `tests/econet-ui.test.js`._

**Changed**
- **Rheem / Ruud systems are units like any other.** The separate Rheem / Ruud tab is gone. Each system
  is a card on Indoor units and a tile or marker on the Building map, in whatever group it is given,
  and counts in the Running / Off / Errors tiles. Tapping it opens its panel.
- **Manufacturer filter and split.** When a building has more than one make, Indoor units gets
  "All makes / LG / Rheem / Ruud" and a switch between mixing the makes in your groups and giving each
  make its own section.
- **Bus scan shows any wire.** A switch at the top picks the LG bus or a Rheem / Ruud system's bus,
  with live messages, who is talking, and the connect / listen / talk controls.
- **Settings ▸ Equipment** lists every make: set up (with Manage), not set up (with Set up now), or
  coming soon. The Rheem / Ruud setup page is reached from there.

**Added**
- A Rheem / Ruud system can be given a group and sub-group, kept on the controller.

**Not changed yet**: All on / All off, Select and schedules still act on LG units only; Rheem / Ruud
systems are changed from their own panel.

### Also in v1.7.1-beta.8: one light for every bus, Rheem / Ruud fault guides

_Published as part of v1.7.1-beta.8. Changes `cortex.html`,
`command-center.html`, `appliance/server.js`, `appliance/recorder.js`, `desktop-app/watch.js`, tests._

**Added**
- **Rheem / Ruud fault guides.** 157 alarm, alert and reminder codes (thermostat and system, air
  handler, furnace, outdoor unit, heat pump water heater) each have what it means, what to do, a field
  check, and for most a step-by-step diagnosis, in the same window as the LG codes. Six new drawings:
  EcoNet control wiring, checking a temperature sensor, where the air goes, the condensate drain and
  float switch, how a gas furnace lights, and the parts of a heat pump water heater. A code Cortex has
  no guide for still opens a window saying so. Code names come from Rheem's EcoNet help pages and the
  water heater manual; the explanations and drawings are Cortex's own, and each guide links to Rheem's
  page for the exact procedure.
- **Rheem / Ruud alarms in Fault history, the bell, notifications and Command.** The controller records
  each alarm when it appears and closes it when it goes away, and records a system that stops answering
  for three minutes. They raise the same push and webhook alerts as LG faults. Command and the Windows
  app name them by the system's name and code.
- **One bus light for every bus.** The header light now speaks for the LG bus and every Rheem / Ruud
  system: "All 3 buses online", or "1 bus offline" in red. Clicking it lists each bus with a plain
  status and why it is down; users who may see technical data also get the serial details, and users
  who may open Bus scan get a View button to that bus. A site with only the LG bus reads as before.

**Changed**
- **The technician ("lab") look follows light and dark mode.** Its colours are variables with a light
  and a dark palette, instead of always being dark.
- A Rheem / Ruud card shows the alarm's code and name instead of only "Alarm"; tapping it opens the guide.

**Not verified on real equipment:** the exact text a Rheem / Ruud system reports for an alarm. The
guides are found by the code word (for example `A021_A`) anywhere in that text.

## v1.7.1-beta.7 — 2026-11-18 (roles you define: name a role, tick its permissions)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.6. Changes `cortex.html`. New:
`docs/ROLES.md`, `tests/roles.test.js`._

**Added**
- **Create, rename, edit, copy and delete roles** in Settings ▸ Users. A role is a name plus a tick for
  each of 24 permissions: controlling units, All on / All off, locks, editing units, service notes,
  technical details, each page, each technician tool, and each administration task separately.
- **Users take their permissions from their role.** Change a role and every user with it changes, on
  every screen, without signing in again.
- Roles are saved with the site and included in backups.

**Changed**
- **The owner account is now shown as "root".** It always has every permission and cannot be edited or
  deleted.
- Admin, Technician and Customer become ordinary editable roles with the same abilities they had. The
  two "Allow customer…" switches in Advanced settings are carried into the Customer role and removed.
- Advanced settings shows only the parts a role includes (for example backup without factory reset).

## v1.7.1-beta.6 — 2026-11-17 (Rheem / Ruud EcoNet equipment as a second system)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.5. Changes `appliance/server.js`,
`cortex.html`. New: `appliance/econet.js`, `appliance/econetlink.js`, `docs/ECONET.md`,
`tests/econet.test.js`, `tests/econet-ui.test.js`, `tests/helpers/econet-sim.py`._

**Added**
- **Rheem / Ruud equipment over EcoNet.** A controller can now also read and control EcoNet heating
  & cooling systems (thermostat, air handler / furnace, outdoor unit), heat pump water heaters, electric
  tank water heaters and tankless water heaters. Each system uses its own USB RS-485 adapter (38400
  baud) on the equipment's RJ11 service port, alongside the LG bus.
- **Rheem / Ruud page.** Room or tank temperature, what the system is doing, mode, setpoints, fan,
  humidity, alarms, and the equipment readings it reports. Technicians add systems, pick the adapter,
  see every message on the bus, and can read any value by name.
- **Brought up in steps.** A new system only listens. Cortex transmits only after a technician allows
  it, and never before it has heard a valid message. Changes are limited to an allowed list with limits.

The protocol was worked out by the esphome-econet community; Cortex's code for it is its own.

**Not yet tested on real equipment.** Not done yet: EcoNet alarms in Fault history and notifications,
schedules, Cortex Command, multi-zone systems.

## v1.7.1-beta.5 — 2026-11-17 (the bus adapter belongs to the controller; every screen shares it)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.4. Changes `appliance/server.js`,
`cortex.html`, `appliance/install.sh`. New: `appliance/buslink.js`, `docs/BUS_LINK.md`,
`tests/buslink.test.js`, `tests/bus-shared.test.js`, `tests/helpers/bus-sim.py`._

**Changed**
- **The adapter is owned by the controller, not by one browser.** Before, the first screen to connect
  held the adapter and every other screen showed the bus as down. Now Connect / Disconnect is a switch
  kept on the controller: every screen and app shows the same status, and any technician can flip it
  from any device. It survives restarts.
- **Every screen with Bus scan open sees the frames and the units answering**, not only one.
- **Live polling is always done by the controller.** No browser tab has to stay open, and none takes the
  adapter by itself any more.
- **Technician tools borrow the wire.** Discover, guided setup and raw frames take it for one screen
  ("Use bus tools on this screen"); the controller pauses its polling meanwhile and resumes when it is
  handed back, the tab closes or goes to the background, or another technician takes over.
- Connecting only listens. Nothing is transmitted until polling is started, as before.

**Fixed**
- `install.sh` copied only `server.js`, not the other server modules.

**Upgrading**: a site that was polling stays connected. A site that only listens to a real LG central
starts disconnected: press Connect adapter once.

**Not yet tested on a real bus.** Tested against a simulated adapter with two browsers.

## v1.7.1-beta.4 — 2026-11-17 (the Windows app switches between the building network and the secure address by itself; phone links)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.3. Changes `desktop-app/*`,
`appliance/server.js`, `appliance/push.js`, `cortex.html`. New: `desktop-app/route.js`, `qr.js`,
`qr-lib.js` (MIT QR Code Generator by Kazuhiko Arase, unchanged), `docs/REMOTE_AND_LOCAL.md`,
`tests/offline-page.test.js`._

**Added**
- **Cortex for Windows uses the building network when it can and the secure address when it cannot.**
  It learns both addresses from the controller, prefers the building network, and switches by itself:
  at start, when the controller stops answering, and when the PC wakes up somewhere else. A laptop
  taken home connects over the secure address; back in the office it returns to the local one. The
  sign-in is carried over. Before switching it checks that the other address really is the same
  controller (`id` in `/health`).
- **On your phone** page in the app: QR codes for the secure link and the building-only link, with the
  steps to add Cortex to the home screen.
- **A phone that cannot reach the secure address is offered the building network.** On https, Cortex
  keeps a small page that appears instead of a browser error, with a button to open the local address;
  it goes back by itself when the secure link works again.
- `/health` now reports `id` and `lan`.

**Fixed**
- **The app's search page flashed while searching.** It was rebuilt on every progress update, which
  replayed its fade-in several times a second. Progress now only moves the bar.

**Not yet tested on real hardware**: the switching on a real laptop moved between networks, and the
kept page on a real iPhone and Android phone.

## v1.7.1-beta.3 — 2026-11-17 (a renamed tailnet gets a new certificate by itself; the secure link uses the right name)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.2. Changes `appliance/cortex-https.sh`,
`cortex.html`._

**Fixed**
- **Renaming the tailnet left the controller with a certificate for the old name, for good.** The
  certificate helper only recognised its own certificate by the box's *current* Tailscale name, so after
  a rename it took its own certificate for somebody else's and refused to replace it. It now remembers
  the name it fetched for, sees the rename, and fetches a certificate for the new name on its next run
  (within about 30 minutes). A certificate somebody else installed is still never touched.
- **The secure link in Device health pointed at the wrong name.** It reused whatever address the page
  was opened with (often the IP), which a trusted certificate never matches, so the browser warned.
  It now links to the certificate's own name, and says a browser that already accepted a warning
  needs a restart to show the padlock.

## v1.7.1-beta.2 — 2026-11-17 (Cortex Command can use a secure address; the certificate arrives right after an update)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.1-beta.1. Changes `command-center.html`,
`appliance/cortex-update.sh`._

**Fixed**
- **Cortex Command could not use an https address.** Saving a building removed `https://` from its
  address, so Command talked plain http to the secure port and the building showed as offline. A secure
  address is now kept as typed, and an address ending in `:8443` with nothing in front is taken to mean
  https. The help text under the address box said to leave the prefix off; it now shows a secure example.
  Found on a live controller: the certificate was trusted and the address opened in a browser, but
  Command said "not answering".

**Changed**
- A controller fetches its trusted certificate straight after an update, instead of at the next update
  check up to 30 minutes later.

## v1.7.1-beta.1 — 2026-11-17 (Cortex for Windows; https on by default with automatic trusted certificates)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0. Changes `appliance/server.js`,
`cortex-update.sh`, `install.sh`, `cortex.html`, `command-app/updater.js`, both workflows; adds
`appliance/cortex-https.sh`, `desktop-app/`, `docs/DESKTOP_APP.md`, and tests `https-script`,
`desktop-app`, `desktop-ui`._

**Added**
- **Cortex for Windows**, an app for the people in the building. Each release now also carries
  `Cortex-Setup-<version>.exe`.
  - **Finds the controller by itself:** searches the PC's own network and lists every Cortex controller
    by name. One click connects; it remembers. An address can also be typed.
  - **Opens Cortex in its own window** from the Start menu or desktop.
  - **Windows notifications with no https:** a unit faults, a unit stops answering, a new advisory, the
    controller cannot be reached. Each kind has its own switch, and there is a test button.
  - Stays by the clock after the window is closed, optional start with Windows, a "Can't reach Cortex"
    page that keeps retrying, zoom, and the same self-updater and Beta testing switch as Command.
  - By itself the app only reads from the controller. See `docs/DESKTOP_APP.md`.
- **Trusted https certificates, fetched automatically.** A controller on Tailscale gets a real
  certificate for its tailnet name and renews it before it expires, with nothing to do on the box. The
  tailnet needs MagicDNS and HTTPS Certificates turned on once (Tailscale admin console ▸ DNS). With
  that, the `https://…ts.net:8443` address opens with no warning and phone alerts can be turned on.
- `/health` now says `app: "cortex"` and reports https status; Device health shows the secure address.

**Changed**
- **https is on by default** (port 8443), next to plain http, which is unchanged and never redirects.
  Before, it had to be switched on by editing a file. Controllers that never had it on start serving it
  after this update, with the self-signed certificate until a trusted one is available. Turn it off with
  `CORTEX_HTTPS=0` in `appliance.env`.
- A new certificate is picked up without restarting Cortex.
- The firewall rule for the https port is added to match the plain port: open on the LAN where the LAN
  already reaches Cortex, Tailscale-only where the box was locked down.
- Settings ▸ Notifications on a plain http page now points to the Windows app.

**Safety**
- The certificate helper never replaces a certificate it did not make (only a self-signed one, or one
  for the box's own tailnet name), keeps the self-signed pair aside, and checks the new certificate and
  key match before installing them.

**Not verified**
- Nothing here has run on a real controller or a real Windows PC. The certificate helper was tested
  against a pretend `tailscale` command; the app's network search and notifications against a pretend
  network; the app's pages in a browser with a stand-in for the app. The installer build is checked by
  GitHub.

## v1.7.0 — 2026-11-16 (stable: watches the building by itself, diagnoses, and comes with Cortex Command)

**Stable release. Publish as a normal GitHub release (not a pre-release).** It is the same code as
v1.7.0-beta.16 apart from the version number and three Cortex Command changes (below). Controllers on the stable
channel move here from v1.6.0. The sixteen beta entries below have the detail.

What 1.7 adds to 1.6:

- **The controller works with every browser closed.** It polls the equipment itself, runs schedules,
  records faults with the readings from before and after, and keeps trend history across restarts and
  updates.
- **Outdoor unit and refrigerant cycle.** Live pressures, temperatures, compressors, fans and valves, a
  refrigerant diagram, a charge check, cycle diagnosis with plain-language advisories, and a health score
  per system.
- **Guided fault finding.** Step-by-step checks for the common codes, a field reference, and drawings of
  the plugs, pins and wire colours to measure. The error reference was checked against LG's Multi V IV,
  Multi V S and Multi V 5 service manuals. A printable fault report.
- **Alerts on a phone** (needs HTTPS turned on) for faults, silent units and advisories.
- **Everyday control.** Lock buttons that show what is set, unlock or lock everything in one tap, filter
  sign reset, a phone layout, and reaching Cortex on the standard web port.
- **Looking after a site.** Backup and restore by section, clear unit data without a factory reset, an
  update that shows when it has finished, trends to CSV, a demo building for training, and an optional
  page for occupants (off unless you turn it on).
- **Cortex Command.** One console for every building: cards with live figures and trends, a daily
  briefing, alerts with acknowledge and snooze, search across every unit, notes and service logs, customer
  reports, sync between computers, and a Windows app that updates itself.

Three changes since beta.16, all in Cortex Command. Turning Beta testing off on a beta install now asks
what you want, as a controller does: go back to the latest stable release, or stay on this beta and be
offered only stable releases from then on. Then two fixes. The gear button in the header opened a blank Settings
page (and left the Settings tab blank until Command was reopened); it opens Settings again, and an
unknown section can no longer blank the page. And a Cortex Command install made from a pre-release now follows pre-releases by
default. Before, it sat on the stable channel, where no installer had been published yet, so it never
offered an update until Beta testing was switched on by hand.

Not in the stable build: the experimental outdoor-unit service-port (UART / LGMV) page. It stays in
pre-release builds.

**Tested on a live site during the betas:** discovery, control, locks, schedules, the controller polling
by itself, outdoor unit pages on Multi V IV, fault recording, updates between betas.

**Built and tested here, not yet confirmed on real equipment or a real PC:** filter sign reset; Multi V S
and Multi V 5 handling (only Multi V IV has been seen); phone push delivery; the standard web port under
the installed service; clear unit data; the new lock buttons; occupant view; the Windows app's installer,
tray, self-update, sync and "start update"; the service drawings against real boards. If any of these
misbehave, the fix ships as 1.7.1.

## v1.7.0-beta.16 — 2026-11-16 (demo building, occupant view, fault report; Command sync, search, acknowledgements)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.15. Changes `cortex.html`, `command-center.html`, `appliance/server.js`,
`busmaster.js`, `recorder.js`, `command-app/`; adds `room.html`, `appliance/occupant.js`,
`appliance/commandstore.js`, `command-app/bridge.js`, `docs/DEMO_BUILDING.md`, `docs/OCCUPANT_VIEW.md`,
and tests `backup`, `occupant`, `commandstore`, `command-bridge`, `demo`._

### Cortex

**Added**
- **Demo building.** A pretend site (22 units, two outdoor units, a live fault, a low-charge system, a
  recorded high-pressure trip, schedules, trends) for training and showing customers. Open it from the
  sign-in screen, first-time setup, Settings ▸ Advanced, or `?demo`. It runs inside one browser tab:
  nothing is saved, nothing is sent to a controller or to equipment. See `docs/DEMO_BUILDING.md`.
- **Fault report.** Fault history ▸ a fault ▸ **Fault report** prints one document (or saves a PDF): the
  code and what it means, the readings just before it, charts around it, the checks to make with tick
  boxes, and space for notes and a signature.
- **Trends to CSV.** The Trends dialog has a **CSV** button: every reading and every column, in the
  temperature unit you use.
- **Occupant view (off by default).** Settings ▸ Advanced ▸ Room pages for occupants. Make a link for a
  room; whoever has it sees that room and can adjust the temperature inside limits you set. Off means
  off: every link answers "not available". See `docs/OCCUPANT_VIEW.md`.
- **Screens feel alive.** Screens ease in, headline numbers count up, buttons give under a press, a
  changed setpoint bumps, a sent command gets a tick. One switch turns it all off (Settings ▸ Display ▸
  Animations), and it follows the system's "reduce motion" setting.

**Changed**
- **Locks show what is set, and a tap flips it.** In the multi-unit dialog each lock button shows locked,
  unlocked or "2 of 8 locked"; tap to switch. New **Unlock everything** and **Lock everything**. The
  single-unit buttons say locked / unlocked the same way. Hard lock is read back from every unit on
  every poll. Mode, Fan and Temp locks cannot be read from a thermostat, so they show what Cortex last
  sent.
- **Backup lets you choose what goes in the file:** site details and limits, logins and access codes,
  units, schedules, floor plans (now with the pictures), display preferences. **Restore** shows what a
  file holds and brings back only the parts you tick; everything else is left alone. Older backup files
  still restore.

**Fixed**
- **Error codes 1 to 9 were not recognised when they came from live equipment.** A unit reporting
  error 4 was labelled "CH4", which the error reference does not know, so the error page said
  "Unrecognized code" and offered no diagnosis. Codes are now CH04-style everywhere (page, controller
  poller, fault recorder), and old "CH4" records are read as CH04.
- **Error reference corrected against LG's Multi V S and Multi V IV service manuals.** CH27 was described
  as a high-pressure trip; it is a PSC/PFC fault on the inverter's input stage. CH59 is "a smaller frame
  is set as main". CH71 is the converter-side current sensor. CH105 names the right boards for each
  generation. CH116 (oil level sensor) added. CH35, CH36, CH46, CH51, CH60 gained LG's thresholds and
  checks. CH38 is flagged as not in LG's tables. CH242 explains the outdoor display's different meaning.
- **Hydro kit codes checked against LG's Multi V 5 service manual, Multi V Water IV manual and hydro kit
  installation manual.** CH12 was listed as an indoor "middle pipe sensor"; LG's Multi V tables give 12
  as the hydro kit's inverter PCB fault. CH17 (hydro kit water inlet sensor) was missing and is added.
  CH15 gained LG's 185 °F (85 °C) limit, CH14 and CH16 say what LG says, CH08 names the plug (CN-TH4).

### Cortex Command

**Added**
- **Sync between computers.** Settings ▸ Sync. One copy of your buildings, notes, technicians, grants and
  acknowledgements lives on a controller you choose; every Command pointed at it matches. A new computer
  can pick everything up from the first screen.
- **Find any unit.** The Buildings search box now searches every unit in every building: a room name, a
  code such as CH05, "offline", "filter".
- **Acknowledge and snooze.** Mark an alert as seen, with a note; snooze a building for 1, 4 or 24 hours
  or until 7 am. Acknowledged alerts stop counting as new, the Alerts tab shows how many are new, and the
  briefing lists them under "Already in hand" and "Snoozed". An acknowledgement clears itself when the
  fault clears.
- **Repeat offenders.** Alerts tab: the units and outdoor units that faulted most in 30 days.
- **Building notes and a service log.** Site contact, how to get in, equipment, and dated visit entries,
  in each building's Details.
- **Building report.** Details ▸ **Report** prints a one-page 30-day summary for a customer: time online,
  faults and how long they took to clear, a day-by-day strip, open advisories, service visits.
- **Controller software.** Settings ▸ Controller software lists every controller's version and whether an
  update is waiting. The Windows app can start the update (one or all); a browser copy offers Open.
- Unit names from each building are used everywhere (alerts, briefing, details) instead of bus names.
- Motion: cards and numbers ease in when a tab opens, windows twinkle, dialogs pop.

**Changed**
- Settings ▸ Appearance: the colour choice is a row of colour circles, as in Cortex.
- Command keeps a daily roll-up of each building for 120 days (for the report), as well as the 7 days of
  15-minute samples.

### Not verified
- Windows app: sync and "start update" go through the app's own sender, which has unit tests but has not
  been run on Windows.
- Occupant view, lock buttons and the fault report were tested against the built-in simulator and a local
  controller, not real equipment.

## v1.7.0-beta.15 — 2026-11-16 (Cortex Command: Windows app with its own updates, daily briefing, richer buildings)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.14. Changes `command-center.html`,
`.github/workflows/release.yml`; adds `command-app/`, `.github/workflows/command-build.yml`,
`docs/COMMAND_APP.md`._

**Added**
- **Cortex Command installs like a Windows program.** Each release now carries
  `Cortex-Command-Setup-<version>.exe`: Start menu and desktop shortcut, no administrator prompt.
  - **Its own updater**, working like the controller's: checks GitHub for a newer release, downloads
    and checksum-verifies the installer in the background, then offers "Restart now". **Beta testing**
    switch in Settings: off = stable releases only, on = pre-releases too.
  - **Keeps watching from the tray** after the window is closed, and raises **Windows notifications**
    when a building goes offline or comes back, a unit goes into error or stops answering, or a new
    advisory appears. Optional start with Windows.
  - Settings ▸ Backup and data ▸ Download / Restore moves everything from the browser version.
- **Daily briefing.** The first sign-in of each day opens one screen, grouped by building: what needs
  attention (offline controllers, units in error, silent units, diagnosis advisories, low system
  health), what changed since you were last here (new faults, faults that cleared, outages), things
  worth knowing (filters due, controller updates) and temporary access ending today. The sun button in
  the header reopens it. Per-user switch, and a setting for when "the day" starts.
- **Building cards carry more.** A picture for each building (its own skyline, with windows lit in
  proportion to units running and the last 24 hours drawn across it), a ring showing units on / off /
  in error / silent, and figures for units on, errors, health, time online over 7 days, advisories and
  silent units. A card says when its controller is behind the newest version in the fleet.
- **Building details.** A new Details button: units on, cooling / heating split, average room
  temperature, outdoor units, filters due, locked units, health per outdoor unit, current errors and
  advisories, and trend charts over 24 hours or 7 days (units on, errors, health, room temperature)
  plus faults per day for 30 days.
- **History.** Command saves one sample per building every 15 minutes while it is running and keeps
  7 days, on this computer. That is what the trend lines and the "online" figure come from.
- **The Cortex logo, animated,** in the header (it sparks while Command is reading the buildings), on
  the sign-in screen, in the briefing and in About. Switch it off in Settings ▸ Appearance.

**Changed**
- **Settings is a page now, not a dialog,** with sections: Appearance, Buildings view, Alerts, Daily
  briefing, Sign-in and security, App and updates, Backup and data, About. The theme button left the
  header and lives in Appearance.
- Large dialogs (briefing, building details) are wider on a desktop.

**Not verified**
- The Windows app has not been run on Windows: not the installer, tray, notifications or a real
  update. The page was tested in a browser with a stand-in for the app. See `docs/COMMAND_APP.md`.
- The installer is not code-signed, so Windows SmartScreen will warn on first run.

## v1.7.0-beta.14 — 2026-11-16 (clear unit data without a factory reset)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.13. Changes `cortex.html`,
`appliance/server.js`, `appliance/recorder.js`, `appliance/diagwatch.js`._

**Added**
- **Settings ▸ Advanced ▸ Clear unit data.** Forgets every known unit (addresses, names, groups, types,
  map positions, service notes) on the controller and on every screen, so the unit list can be built
  again from a Bus scan. Admins only; you type CLEAR to confirm.
  - Tick boxes for what else goes: outdoor unit data, trend history, fault history and advisories (all
    on by default), and schedules (off by default).
  - Kept: logins, site settings, floor-plan pictures, notification devices, update settings, per-user
    preferences.
  - Nothing is sent to the equipment. Units keep running as they are, including any locks.
  - Another screen that still holds the old list cannot put it back: its next save is refused and it
    picks up the empty list.
  - **Outdoor unit data is cleared everywhere, and stays cleared.** With that box ticked the controller
    forgets the outdoor units it found and their readings, stops reading them (its saved list of outdoor
    addresses is emptied in the same step), ignores any reading that was already on its way back, and
    other open screens drop their copy the next time they look. The Outdoor / cycle page is empty until
    you run "Find outdoor units" again.

## v1.7.0-beta.13 — 2026-11-16 (reach Cortex on the standard web port)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.12. Changes `appliance/server.js`,
`appliance/cortex-appliance.service`, `appliance/cortex-update.sh`, `appliance/install.sh`._

**Added**
- **Cortex also answers on port 80**, so `http://<controller address>` works with no `:8080`. This is how
  an LG ACP is reached, and it matters on sites with two networks where the firewall between them only
  passes ordinary web traffic. Port 8080 keeps working exactly as before.
  - The service gets permission to open port 80 without running as root (one line in the unit file,
    delivered by the update).
  - The update opens port 80 in the controller's own firewall only where the LAN could already reach
    8080. A controller that was locked down to Tailscale-only is left alone.
  - Set `CORTEX_HTTP80=0` in `data/appliance.env` to turn it off.
  - `/health` reports `port80: true` when it is open.

**Fixed**
- If the optional https port could not be opened (already in use, say), the whole controller stopped
  instead of carrying on over http. Found while testing the port 80 listener, which had the same flaw.

**Good to know**
- `cortex.local` only resolves from the same network as the controller. From another network, use the
  controller's IP address.
- Port 80 could not be tested under systemd here. If it does not open after the update, the controller
  logs "port 80 not available" and keeps serving on 8080.

## v1.7.0-beta.12 — 2026-11-15 (service drawings, updates you can see finish, nothing lost across one)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.11. Changes `cortex.html`,
`appliance/recorder.js`._

**Added**
- **The page reloads itself when an update is done.** Press Update (or Revert to stable) and a small
  banner follows it: downloading and installing, then "the controller is restarting", then the page
  reloads on the new version and says so. Before, an open Settings dialog blocked the reload, so the
  screen never showed the update had finished. If the new version fails its start-up check and the
  controller rolls back, the banner says that instead.
- **Outdoor data is back straight after a restart.** The controller now saves the last outdoor pages
  (with the time each was really read) when it stops and every five minutes, and loads them at start.
  The Cycle page used to be empty until the first new read.
- **The ten minutes before a fault survive a restart.** A fault's record includes the ten minutes of
  readings before it. That buffer lived only in memory, so a fault soon after an update had almost no
  "before" data. It is now saved and reloaded.

**Fixed**
- **Fault list after a restart.** A fault that cleared while the controller was restarting stayed
  "active" for ever, and a fault that appeared during the restart was never recorded. On the first look
  at each unit after a start, the list is now brought in line with what is true; a fault that is simply
  still there is not reported a second time.
- Screen sweep (every view and dialog, desktop and phone):
  - Building map, "no units", "no outdoor data" and "no faults" notes broke a sentence into columns
    wherever it contained bold text.
  - The Alerts dialog still said phone notifications were not available.
  - "Not enough running time" spilled out of the health ring.
  - The weather card pointed at a Settings tab that does not exist (it is Settings ▸ Advanced).
  - On a phone, small buttons, text links and switches were about 24 px tall; they now have a
    finger-sized tap area.

**Diagnostics: drawings and an accuracy pass**
- **Ten service drawings**, drawn for Cortex from the wire colours, pin numbers and readings LG
  publishes. They appear in the Field reference, on the error page of each code they help with
  ("Show the drawing"), and inside the step-by-step walkthrough on the step that asks for that
  measurement. On a phone, tap a drawing to enlarge it.
  - 6-wire expansion valve coil: white, yellow, orange, blue, red, brown; which pairs read 300 Ω and 150 Ω.
  - 5-wire expansion valve coil: 104 Ω across, 52 Ω to the red common, and the Multi V S variant.
  - Indoor valve plug on the board (CN-LEV) in factory wire order, and LG's yellow/blue swap test that
    tells a stuck valve from a blocked pipe.
  - Indoor fan motor plug: what each of the seven positions is, its voltage, and the ohm check.
  - Temperature sensors: resistance at 32, 77 and 185 °F for air, pipe and discharge sensors.
  - Pressure sensors: red 5 V, white signal, black ground, the volts-to-psi line for each, red plug
    = high, blue plug = low.
  - Outdoor control terminal block: SODU, IDU, CEN, dry contact, and where each pair goes.
  - Inverter power stage: the six readings, lead polarity, 28 kΩ compressor board / 35 kΩ fan board.
  - Compressor windings and insulation, plus the peak-voltage check with the red, blue and yellow leads.
  - 4-way valve: which way the hot gas goes in cooling and in heating.
- **Outdoor main board plug list** (Multi V IV): which CN number each sensor, valve and heater uses.
- Field reference has a row of jump buttons and new sections: pressure sensors, inverter board,
  compressor, 4-way valve, board plugs.
- **Pressure-sensor walkthrough (CH42, CH43) tells you the voltage to expect** from the pressure Cortex
  is showing right now.
- **Corrections found by checking every walkthrough against LG's pages:**
  - CH52: a dark comm LED on the inverter board means check its noise filter and fuse, then the board.
    Cortex said to reseat the cable first.
  - CH10: the supply check now names the pins (308 V DC on pin 1, 15 V DC on pin 5, both to pin 4) and
    the ohm check includes the two readings that must be open.
  - CH151: coil check now gives LG's insulation figure (over 100 MΩ to the valve body).
  - Inverter check now carries the actual numbers instead of "per the service manual".
  - EEPROM step: the chip's notch lines up with the arrow on the socket.
  - **CH54 (outdoor power phase error) was missing** and is added.
- Where LG gives no wire colour (the indoor fan motor plug) or no board map (the outdoor main board),
  Cortex says so and does not guess.

**What an update keeps (checked this pass)**
- On the controller's disk, outside the part an update replaces: units and their names and groups,
  settings and users, schedules, per-user preferences, indoor trend history, outdoor trend history,
  fault records, diagnosis advisories, floor plans, notification subscriptions, Command's building list.
- In each browser: sign-in, theme and that device's choices.
- Not kept, on purpose: a command that was queued but not yet sent when the controller stopped (send it
  again), and the count toward a ten-minute diagnosis advisory (it starts counting again).

## v1.7.0-beta.11 — 2026-11-15 (Cortex Command on a phone, alerts while it is closed)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.10. Changes `command-center.html`,
`appliance/server.js`, `appliance/push.js`; adds `appliance/fleetwatch.js`._

**Added**
- **Cortex Command fits a phone.** The header no longer runs off the screen, the tabs scroll sideways
  instead of wrapping, building cards stack in one column, dialogs open as a sheet from the bottom that
  scrolls, buttons are finger-sized, and the page respects the notch and home bar.
- **Command can be added to the Home Screen** as its own app ("Command"), separate from Cortex.
- **Alerts while Command is closed.** A closed page cannot watch anything, so the controller Command is
  opened from does it. Command hands that controller the list of buildings (name and address only); the
  controller looks at each one about once a minute and sends a push notification when a building goes
  offline or comes back, a unit goes into error or stops answering, or a new diagnosis advisory appears.
  Turn it on per device in Command ▸ Settings ▸ "Alerts while Command is closed"; there is a test button.
  - Read-only: the watcher makes the same three requests Command makes (`/health`, `/api/units`,
    `/api/diag`). It never sends a command to another controller.
  - A building must miss two looks in a row before it is called offline, each change is reported once,
    and a building that has never been seen online does not alert.
  - It does nothing while no device has the alerts turned on.

**Changed**
- Command's settings dialog keeps its scroll position when a switch is flipped.
- A device's Command alerts and its Cortex site alerts are stored separately, so turning one on or off
  in one page no longer affects the other.

**Needs**
- The same as Cortex notifications: Command must be opened from a controller's **https** address
  (see `docs/NOTIFICATIONS.md`). Opened as a file, or over plain http from another device, the browser
  will not allow push. On iPhone and iPad, add Command to the Home Screen first.
- The watching controller must be able to reach the other buildings' addresses itself.

**Not verified**
- Push delivery to a real phone. The watcher, the subscription handling and the page were tested here
  against a local controller; an actual notification needs your https setup.

## v1.7.0-beta.10 — 2026-11-15 (filter reset, 15-second hold, Multi V S groundwork)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.9. Changes `cortex.html`,
`appliance/busmaster.js`, `appliance/scheduler.js`, `appliance/server.js`._

**Added**
- **Filter sign reset.** When an indoor unit raises its clean-filter sign, staff see a "Filter cleaned —
  reset sign" button in that unit's panel (two taps). It sends one ordinary command to that unit with
  the unit's current settings plus the reset flag (cmd0 byte 5 bit 7). The flag rides that one send
  only: it is never stored on the unit, never saved, and no schedule or group command can carry it.
  Works from a browser that holds the adapter and through the controller.
- **Outdoor family names.** The outdoor header now says what the unit is (Multi V IV, Multi V S,
  Multi V 5, …) instead of only "family 0x0E". The table is the LG controller's own list of 22 families.
- **Multi V S groundwork.** LG's controller reads Multi V S (family 0x14) with the same page map as
  Multi V IV, so Cortex now does too, and treats it as a one-compressor unit: the diagram, data tiles,
  sub cards and state chips drop the second compressor. Field reference gains a Multi V S section
  (protection limits by size, targets, oil return and defrost valve positions) from LG's service manual.
- **Families Cortex cannot decode say so.** Older Multi V generations and gas heat pumps pack the page
  differently. Cortex used to decode them with the Multi V IV map, which would have shown wrong numbers;
  it now shows a short notice and no readings. Indoor control is unaffected.
- Error pages: when two or more indoor units show the same code of 21 or higher, the page says the code
  is the outdoor unit's, handed down to indoor units with no fault of their own.

**Changed**
- **The hold after a command is 15 s (was 8 s)**, in the browser and the controller. For the first
  seconds after a write the outdoor unit answers from its own copy of the command; the indoor unit's
  real state follows. A shorter hold could show a setting flip back and forth.
- A site is treated as "generation 5" (auto fan, two setpoints) when an outdoor unit reports the
  Multi V 5 family, not only when the bus runs at 9600 baud.

**Not verified**
- No Multi V S, Multi V 5 or older-generation unit has been on a Cortex bus. Family handling follows
  LG's controller software and the reference kit; the Cycle-page checks still use Multi V IV numbers.
- Filter reset has not been sent to a real unit by Cortex yet. The bit is confirmed in the kit on both
  buses; first use should be on one unit with someone watching it.

## v1.7.0-beta.9 — 2026-11-15 (re-read of the reference kit)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.8. Changes `cortex.html`,
`appliance/busmaster.js`, `uart-sniffer.html`._

**Fixed**
- **Indoor temperatures were decoded with a straight line; the units report thermistor codes.** Room
  temperature now uses the air-sensor curve and pipe-in / pipe-out the pipe-sensor curve — the same
  tables Cortex already used for the outdoor unit. The kit says so in two places, and LG's controller
  uses the identical pipe table. Effect on what you see: room reads about 1 °F lower than before around
  70 °F; a cooling coil about 2 °F lower; **a heating coil 8–30 °F higher** (a pipe at 120 °F used to
  show about 111 °F, one at 160 °F about 129 °F). Trend lines step at the update for that reason.
- Outdoor page reads are now spaced 1.1 s apart (was 0.7 s), following the kit's timing note.

**Changed**
- UART page: the 0x69 frame is each indoor unit's **communication counter**, not "setpoint × 2" as
  guessed earlier. Column renamed "Comm count".
- CH104 and CH204 pages and the CH104 walkthrough now include what was seen in field tests (104 appears
  about two minutes after a sub frame loses power, with a first-stage code before it; 204 hits every
  unit behind one HR box together).

**Not changed**
- Read: chapters 02 (§8–11), 04, 05 and 06-G of the kit, its tables and census notes. Not read line by
  line: chapters 01, 03 (indoor A/B bus), 07–10 and the kit's Python tools and tests, which cover buses
  Cortex does not use.

## v1.7.0-beta.8 — 2026-11-15 (second pass over the LG controller's own software)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.7. Changes `cortex.html`, `appliance/busmaster.js`._

**Fixed**
- **Cycle diagnosis mixed °F with °C.** Unit records keep room and pipe temperatures in °F, and the
  indoor rules (EEV blocked, low / over charge signs, "calling for cooling") compared them as if they
  were °C. Every indoor rule in beta.6 and beta.7 was therefore wrong on real data: thresholds were about
  half as wide as intended, the "calling" test was always true, and readings were shown double-converted.
  The rules now convert first. `tests/diagwatch.test.js` uses the real units so this cannot slip back.
- **Group by outdoor unit:** each inventory page's entry count is byte 15 (that is the byte LG's
  controller reads); byte 11 is the total. Cortex used the total for every page, which could read
  leftover bytes as units on a part-filled page. Ventilators (type 0x70–0x7F) are now marked.

**New, from LG's controller software**
- Indoor reply byte 7: **bit 7 = filter sign, bit 4 = oil alarm** (the controller's own column names).
  Shown as pills in the indoor table on Outdoor / cycle. Error value 0xAD is treated as "no error", as
  LG's controller does.
- Outdoor page 5 is the unit's **fault-detection table** (total, type, five entries of type + 3-byte
  code, eight module readings). The "fault table has entries" pill now has an (i) listing them raw.
- CH242 text notes that the controller raises it itself after 31 unanswered outdoor polls.

**Learned, deliberately not used** (written up in `docs/KIT_FINDINGS.md` §8)
- What bytes 5 and 6 of the outdoor page request do on LG's controller: they are a write channel
  (target pressures, target superheat / subcooling, error clear, scheduled oil return). Cortex keeps
  sending zeros.
- The `C8` frame (cmd9): night low-noise, target pressure step, capacity boost step, snow removal,
  extra defrost. Cortex still never sends it.

## v1.7.0-beta.7 — 2026-11-15 (notifications · controller-side diagnosis · health report · Command)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.6. Changes `cortex.html`,
`command-center.html`, `appliance/server.js`; adds `appliance/push.js` and `appliance/diagwatch.js`._

**Fixed**
- Cycle diagnosis: an opened finding closed by itself after a few seconds (the page re-renders when new
  outdoor readings arrive). Open findings now stay open.
- Cycle diagnosis: a unit that is satisfied parks its EEV near 40 pulses with room-temperature pipes; that
  was being reported as "EEV fully blocked". The rule now needs the unit to be calling for cooling with
  its valve driven open (above 60 pulses), and parked units are left out of the charge averages.

**New**
- **Diagnosis runs on the controller.** `diagwatch.js` lifts the rule block out of `cortex.html` (one
  copy of the rules) and runs it once a minute. A pattern present for ten checks becomes an advisory in
  Fault history, raises an alert, and clears after ten checks without it.
- **Push notifications** to browsers and phones (`push.js`, no dependencies), chosen per person and per
  device in Settings ▸ Notifications: error codes, units that stop answering, diagnosis advisories.
  Needs https with a trusted certificate — see `docs/NOTIFICATIONS.md`. The webhook still works without it.
- **System health report** per outdoor unit from the recorded log (24 h / 7 d / 30 d): grade, share of
  running time inside LG's ranges, averages and ranges, most common out-of-range readings, drift, faults
  and advisories, with a stated confidence that grows with the amount of data.
- **Refrigerant diagram:** sub frames are drawn as summary cards (compressors, discharge, fans, pressures,
  superheat, EEVs, coil) instead of a line of text; clicking an indoor unit opens its controls.
- **Preferences follow the person.** Per-user settings are mirrored to the controller (`/api/prefs`) and
  picked up on any device. New: text size, animations on/off, which view Outdoor / cycle opens on, more
  start pages.
- **Cortex Command:** building cards and the Alerts tab now show live data from each controller (units
  on / in error / silent, active faults, diagnosis advisories, health score, real 30-day fault history);
  a pop-up and optional beep when a building raises an alert; sign-out after inactivity; accent colour and
  text size; preferences are now really per user (they were being saved under one shared key).

**Not done / unverified**
- Push has not been delivered to a real phone yet. Controller-side diagnosis is tested offline only.
- Thresholds are still LG's published numbers.
- The kit files and the ACP engine were not re-read in this pass.

## v1.7.0-beta.6 — 2026-11-15 (diagnosis: guided checks · cycle diagnosis · more outdoor data)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.5. Changes `cortex.html` only._

- **Guided diagnosis.** Error pages for 50 codes get a "Diagnose step by step" button: one check at a
  time in the order LG's flowcharts use, with what Cortex can already see beside the question (pressures,
  fan speeds, volts, unit counts), a likely-cause card when a check fails, and "Copy notes" for the ticket.
- **Cycle diagnosis.** A rule set that counts how many signs of a known fault pattern are present: low
  charge, overcharge (cooling and heating), indoor EEV partly / fully blocked (per unit), outdoor unit
  re-breathing hot air, and three "a sensor is lying" checks. Patterns come from the cycle-diagnosis
  guides built into LG's service software; wording is ours. Charge patterns pause when units heat and
  cool at once. Flagged indoor units get a marker on the refrigerant diagram.
- **Health score** per system (rough guide, 0–100) on the outdoor unit header.
- **More outdoor data from the same pages** (was being read but not decoded): upper / lower coil
  temperatures, vapor-injection EEVs, oil-equalising EEV, fan amps, inverter phase amps, heat sink raw
  values, fan step, and 16 on/off states (hot gas bypass, variable path, suction injection, receiver
  in / out, crankcase heaters, oil level sensors, cooling fan, split defrost, snow removal, backup).
  **Decoded from a reference table; not yet checked against equipment.**
- **Error reference** now covers every code LG's software lists for Multi V IV heat pump and heat
  recovery (82 entries). CH105 corrected to fan PCB comms.
- **Field reference**: thermistor resistance for any temperature (pipe / air / discharge), and LG's
  test-run pass ranges for Multi V IV.
- Not done: the cycle-diagnosis rules run in the browser, so they do not raise alerts while no screen is
  open; thresholds are LG's published ones and have not been tuned on a live system.

## v1.7.0-beta.5 — 2026-11-15 (refrigerant diagram rework · charge check · field reference)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.4. Changes `cortex.html` only._

- **Outdoor fan animation fixed.** The blades were rotating around the icon's corner (SVG
  `transform-origin:center` resolves against the view box, whose origin is not the icon centre), so the
  fan swung out of its tile. It now spins in place, with four blades and a shroud ring.
- **Refrigerant diagram redrawn** after studying the cycle view in LG's service software for Multi V IV
  heat pump and heat recovery. The outdoor unit now shows the split coil with both main EEVs, the
  subcooler and its EEV, the 4-way valve, the accumulator, both compressors with their own discharge
  temperatures, and where the pressure / temperature sensors sit. Heat-recovery systems get three pipes
  (liquid, high-pressure gas, low-pressure gas) and each indoor unit's pipes follow that unit's own mode.
  Sub frames are summarised in a line each. Every part has hover / tap help. The drawing is our own.
- **Charge check** (button on each outdoor unit): compares live readings with LG's refrigerant charge
  determination ranges for today's outdoor temperature band, in cooling or heating.
- **Field reference** (button on the cycle page): fault-level behaviour, comm-bus voltages, thermistor
  and EEV resistances, fan-motor check, protection limits, separated-frame piping limits and oil traps,
  HR box addressing and port capacity.
- **Error reference** grew from 31 to 56 codes, each can carry a field check and how LG's logic reacts.
  Corrected: CH22 is AC input over-current (was "DC link over-voltage"), CH45 is the outdoor coil pipe
  sensor (was "compressor overload").
- The "another Cortex screen is already connected" message now says whether it is the controller's own
  poller or another screen, and that nothing is wrong.
- Not verified on equipment: the diagram's flow directions on a heat-recovery system in mixed mode are
  inferred from each unit's mode, because HR box valve states are not on this bus.

## v1.7.0-beta.4 — 2026-11-15 (phone layout)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.3. Changes `cortex.html` only._

- **Phone layout.** Below 860 px the side menu becomes a slide-out panel behind a ☰ button (before, the
  menu was simply hidden, so a phone could not change page). The header keeps only menu, bus status,
  alerts, sign out and settings; site name, signed-in user, theme and device health move into the menu.
- Dialogs open as bottom sheets, the unit drawer is full-width, summary tiles sit two-up, the
  outdoor-unit cards and fault timeline no longer run off the right edge, and form fields are 16 px so
  iOS does not zoom when you tap them. Notch / home-bar safe areas are respected.
- **Settings ▸ About ▸ Phone app** explains how to add Cortex to a home screen.
- Not changed: the refrigerant diagram and the bus-scan tables still scroll sideways on a phone.

## v1.7.0-beta.3 — 2026-11-15 (controller polls by itself · fault recorder · cycle page help)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.2. Adds `appliance/busmaster.js`,
`appliance/recorder.js`, `appliance/pwa.js`; changes `server.js`, `scheduler.js`, `cortex.html`._

- **The controller now polls the equipment itself** (`appliance/busmaster.js`) whenever Cortex is the
  bus master and no dashboard holds the adapter: live readings, commands from any screen, schedules and
  outdoor-unit reads keep going with every browser closed. It hands the adapter over the moment a
  dashboard connects from Bus scan, and takes it back about 25 s after that screen leaves.
- **Fault history with pre-fault recording** (`appliance/recorder.js`, new *Fault history* page for
  admins and technicians). Every indoor error code, outdoor error and unit that stops answering is
  logged on a 30-day timeline. Each record keeps the **10 minutes of readings before the fault** and
  the 5 minutes after (a sample about every 15 s: every indoor unit plus every outdoor unit's pages),
  with charts and a downloadable file.
- **Outdoor-unit trends.** Raw outdoor pages are logged every 5 minutes for 35 days; each outdoor unit
  has a *Trends* button (pressures, temperatures, compressors, superheat/subcooling, EEVs, fans,
  inverter amps) for main and sub units. Indoor trend rows now also carry the EEV position.
- **Outdoor / cycle page.** Main and sub units sit side by side, each with its own colour; systems are
  numbered and colour-banded. Compressors are animated scrolls whose speed follows the Hz; fans spin
  with rpm. Every reading has an "i" explaining what the part is, what it is controlling and what normal
  looks like (cooling, heating, defrost), and a *Worth a look* box compares running values with LG's
  Typical Operating Values for Multi V IV. Outdoor data now shows on every screen, not only the one
  holding the adapter.
- **Schedules:** new *Repeat* tick box — untick it and the schedule runs once, then switches itself off.
- **Fault alerts:** Settings ▸ *Fault alerts* posts each new fault to a web address (Home Assistant
  webhook, ntfy, …). Cortex can also be added to a phone's home screen (manifest + icon).
- Tests: `tests/busmaster.test.js` (poll loop and recorder against a simulated bus).

**Not yet verified on equipment:** the controller's own poll loop, and the 0x30 inventory pages.

## v1.7.0-beta.2 — 2026-11-15 (schedules without a browser · group by outdoor unit · new cycle page)

_Beta — publish as a GitHub **pre-release**. Builds on v1.7.0-beta.1. Changes `cortex.html`,
`appliance/server.js`, and adds `appliance/scheduler.js`._

- **Schedules now run on the controller itself**, with every browser closed (`appliance/scheduler.js`).
  If a dashboard is connected it is handed the command; if nobody is, the controller opens the adapter,
  sends, and closes it. It only transmits when Cortex was left running the bus (set by the poll loop),
  never on a site where Cortex is just listening. Times use the site's time zone; the Schedule page
  shows ready/waiting and the last runs.
- **Group by outdoor unit.** Each outdoor unit is asked for its own list of indoor units (monitor pages
  0x30–0x32) and units are grouped under the outdoor unit they belong to. Runs at the end of guided
  setup and from Outdoor / cycle ▸ *Group by outdoor unit* (shows the lists before applying). Import no
  longer groups by reply byte 14, a load value that drifts during a sweep (the cause of extra groups).
- **Outdoor / cycle page rebuilt.** Outdoor units first, as colour-coded panels (high side, low side,
  compressors incl. inverter 2 volts/amps/DC link, fans/valves/heat exchanger) with out-of-range
  readings flagged; indoor units below, grouped by outdoor unit; and a new animated **refrigerant
  diagram** view with live values.
- **Multi-select control panel.** "Set & send" on a selection opens the same style panel as a single
  unit (power, mode, fan, swing, setpoint, locks); only what you touch is sent.
- **Equipment generation.** Auto fan speed and separate cool/heat setpoints in Auto are hidden on
  generation-4 systems; Settings ▸ *Equipment generation* overrides the detection.
- **Calmer screens.** Long explanations moved behind small "i" icons across settings, locks, bus scan,
  schedules and the cycle page.
- **Bus status light is clickable.** Technicians get a live bus panel (link, serial, poll pass, frames);
  everyone else gets a plain explanation and what to do when the bus is offline.
- **Bus scan page** restyled end to end in the Master/CC terminal look.
- Newly discovered units default to **Fan coil unit**. In-service lock is technician-only.
- Fixed: signing out showed "[object PointerEvent]" on the login screen.
- Tests: `tests/scheduler.test.js` (frame builder, time-zone due logic, who-sends rules).

**Not yet verified on equipment:** the controller-side schedule transmit and the 0x30 inventory pages.

## v1.7.0-beta.1 — 2026-11-15 (UART track resumes · fix leaving the beta channel)

_Beta — publish as a GitHub **pre-release**. First build of the 1.7.0 line, on top of 1.6.0 stable._

- **Experimental UART service-port page is back** (it appears in pre-release builds only, hidden in
  stable). Read an outdoor unit's LGMV service port over USB or the Wi-Fi module + bridge — see
  `docs/UART_SERVICE_PORT.md`.
- **Leaving the beta channel now does something.** Before, turning Beta testing off while running a
  newer pre-release silently showed "up to date" and never went back. Now Settings → Updates offers:
  - **Go back to stable vX** — a verified downgrade to the latest stable (auto-rollback like any update), or
  - **Stay on this beta** — keep the current build; you’re then notified only about new **stable**
    releases, never betas.
  New endpoints `/api/update/revert` and `/api/update/keep-beta`; `/api/update/check` reports
  `revertStable`; the updater honors a one-shot revert flag and permits that single downgrade.

## v1.6.0 — 2026-11-15 (first stable release)

**Cortex is a working, field-validated drop-in replacement for LG's ACP / AC Smart central
controllers.** On a live Multi V IV system it discovers indoor units, decodes their state, and
controls power, mode, fan, dual cool/heat setpoints and every remote-controller lock directly
over LGAP — no ACP, no per-controller license, no cloud.

Highlights since the 1.5.x line:
- **Remote-controller locks, confirmed on site:** Mode / Fan / Temp and the hard (whole-wall)
  lock, plus a separate **Temp range** lock with a settable min–max bounded to the thermostat's
  own 64–86 °F / 18–30 °C. Temp lock blocks all changes; the range only limits movement while
  temp is unlocked. Entered in input boxes, explained in plain language in the unit panel.
- **Passive reply decode, outdoor-unit CEN pages, and protocol fixes** from the beta line.
- **Update page shows release notes**, and the OTA version comparator now orders pre-releases
  correctly (beta.10 > beta.9).
- **Brain logo as the browser tab / bookmark icon.**
- **Setup wizard** opens with a bit more attitude.

The experimental outdoor-unit service-port (UART / LGMV) tool is **not** in this stable build; it
continues on the 1.7.0-beta track.

## v1.6.0-beta.10 — 2026-11-15 (bookmark/tab icon)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.9._

- **Brain logo now shows as the browser tab and bookmark icon** (favicon), using the same artwork as
  the in-app logo — a white brain on the Cortex green, legible on light and dark bookmark bars. Added to
  the controller, Command Center, Setup and the UART tool pages. It's a self-contained SVG, no extra file.

## v1.6.0-beta.9 — 2026-11-15 (release notes on the update page · experimental UART page · Wi-Fi module support)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.8._

- **The update page now shows the release notes** for an available version (pulled from the GitHub
  release body), in a scrollable box, on both the main Updates view and Settings → Updates. The
  appliance reads the release body instead of just the title.
- **Experimental UART page in Cortex.** A new technician-only nav item, **🔌 UART**, marked
  **EXPERIMENTAL** next to the title. It embeds the service-port tool so UART work has its own page and
  the rest of Cortex keeps working as a plain central controller. (The CEN-bus Outdoor / cycle page is
  unchanged.)
- **Wi-Fi LGMV module supported.** The outdoor-unit service port can now be read through LG's Wi-Fi
  module (a TCP bridge at 192.168.1.1:9999 on its own `LGE_MV-…` network) via a new zero-dependency
  bridge, `tools/uart-wifi-bridge.js`, which also serves the tool page. The UART tool gained a
  **Connect over Wi-Fi** option alongside **Connect USB…**. Verified end-to-end against a simulated
  module: frames decode and polling sends LGMV's own two requests through the bridge.
- Reverse-engineered LG's LGMV-Business to confirm the Wi-Fi/USB connection details (see
  `docs/UART_SERVICE_PORT.md`); the module is a byte-for-byte transparent bridge, so the beta.7 decoder
  works over either transport unchanged.

## v1.6.0-beta.8 — 2026-11-15 (temp-range lock + clearer lock behavior)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.7. Changes `cortex.html` and
`appliance/server.js`._

On-site testing confirmed the locks work (C9): Temp lock blocks every temperature change at the wall,
and a set range limits movement only while temp is unlocked. This release makes that explicit and adds
a dedicated range control.

- **New "Temp range" lock**, separate from Temp lock, in a unit's Locks section:
  - Locked → the wall thermostat may only be set between the two values you enter.
  - Unlocked → no range limit (Cortex sends the thermostat's full 64–86 °F / 18–30 °C band).
- **Range is set with input boxes** now, not a dropdown. Bounded to the thermostat's own range,
  64–86 °F (18–30 °C); enter values in whichever unit the app is set to.
- **Clearer wording.** The Locks section now spells out that Temp lock blocks all temperature changes,
  while the range only limits movement when its lock is on (and notes when Temp lock overrides it).
- A learned/narrower band on a unit shows the range lock as on, with that band filled in.
- `server.js` passes the new `rangeLock` flag through the relay.
- Tests updated (`node tests/protocol.test.js`): range off now sends the full 18–30 °C band; range on
  sends the chosen band.

## v1.6.0-beta.7 — 2026-11-15 (outdoor-unit service port decoder)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.6. Only `uart-sniffer.html` and
docs changed; Cortex itself (`cortex.html`, `server.js`) is identical to beta.6._

- **The UART Sniffer now understands the outdoor unit's service port** (the plug LG's LGMV uses):
  2400 baud, and it decodes the unit's ID record (model code, firmware, indoor/HR-box counts), the
  outdoor main and sub units (pressures, every temperature sensor, superheat/subcooling, compressor
  Hz, fans, all EEVs, voltages/currents), every indoor unit (state, EEV, room/pipe temps, error,
  central address) and every heat-recovery box (pipe modes, subcool EEV, temps, which indoor units
  are on which port). Multi V IV layouts; °F/psi or °C/kPa.
- **Optional "Ask the outdoor unit for live data".** Off by default. When ticked (with a confirm) it
  answers the unit the way LGMV does — "hello" to its first two ID frames, then "next round" — and
  nothing else. It never transmits unless the unit has just sent a valid frame. Without the tick the
  page only listens.
- **Cross-checked against LGMV itself**: frame checks (either CRC is accepted, as LGMV does), the
  frame types, the request frames and all lookup tables match. Heat pump and heat recovery Multi V IV
  share one outdoor-unit layout, so both are covered. Indoor table gained "Out − in" and the
  per-unit byte from the 0x69 page.
- Default baud is now 2400 (the old page guessed 38400).
- Fixed: adding a marker during a recording threw an error and did nothing.
- New `docs/UART_SERVICE_PORT.md`: what to plug in, step by step, and the byte map.
- `tools/ghidra/`: read-only Ghidra headless helper scripts used for the cross-check.
- Decoder checked byte-for-byte against an independent reference decoder (`node tests/uart.test.js`).
  **Not yet run on a real outdoor unit.**

## v1.6.0-beta.6 — 2026-11-14 (reads what the units say, outdoor-unit data, protocol fixes)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.5._

Everything here came from checking Cortex's encode/decode line by line against an outside,
field-verified LGAP reference. Offline regression test added: `node tests/protocol.test.js`.

**New**
- **Cortex now reads the indoor units' own replies while it is only listening.** Tapped beside a
  real LG central, Cortex used to decode the central's commands but ignored every 16-byte unit
  reply — so it never showed real room temperature, error codes or changes made at the wall. It
  now decodes them (and the 9-byte lock reply, and outdoor-unit pages) straight off the wire.
- **Outdoor-unit data** (technician **Cycle** view, beta): pressures, saturation/suction/discharge/
  liquid temperatures, superheat, subcooling, compressor Hz, EEV positions, voltages, defrost / oil
  return, firmware version, per main and sub unit. Fills in by itself when an LG central is polling;
  when Cortex is the master, enter the outdoor unit's central address (or **Find outdoor units**)
  and it re-reads about once a minute. Read-only request (cmd14, bytes 5–6 zero, never address FF).
  Tables are for Multi V IV — treat other families as approximate.
- **Setpoint limits** in a unit's Locks section — the low/high range the wall thermostat may use
  while Temp lock is on (cmd4 bytes 5–6). A band learned from an LG central is kept.
- **Lock confirmation.** The outdoor unit answers every lock command; Cortex now reads that reply
  and shows "Outdoor unit confirmed these locks" in the unit drawer.
- **Indoor EEV position and capacity** shown per unit (Cycle table + drawer), and which side
  (heating/cooling) an Auto unit is working on.

**Fixed**
- **Swing was never sent.** The Swing switch changed nothing on the bus, and every Send quietly
  turned swing *off*. It now rides byte 5 bit 3 and is read back from the unit.
- **Fan "Auto" is a real command now** (code 4). Before, picking Auto re-sent the unit's last
  speed. Quiet (5) and Power (6) are shown by name and re-sent unchanged.
- **Auto units no longer show as "mode7".** A unit reports 7 while Auto is on its heating side.
- **A filter-sign reset can't be replayed by accident** — the one-shot bit (byte 5 bit 7) is
  stripped from any last-seen byte Cortex re-sends.
- **Hard lock and setpoint limits now survive the relay** from a phone/second screen (the
  appliance's command filter was dropping `hardLock`). *This one is a `server.js` change.*
- **Lock command matches LG's own builder exactly.** Reading the ACP's firmware showed cmd4 byte 4
  bit 0 is always 1 (Cortex had been copying the unit's power state into it).
- The dual-setpoint (cmd5) frame in the technician debug tool was rebuilt from the ACP's firmware:
  correct limit order and the two commit strobes it was missing. Still debug-only, never auto-sent.
- Setpoint floor default is 18 °C / 64 °F (the units enforce 18–30 °C).
- The UART sniffer page is now included in the appliance build (its link was a 404 on the box).

## v1.6.0-beta.5 — 2026-11-14 (dimension locks work without a learned template)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.3/4._

Fixes Mode/Fan/Temp lock (and unlock) on a channel where Cortex is the master and no ACP is present
— the common deployment. Found on-site: a unit (0xC9) stayed mode-locked because Cortex skipped the
cmd4 lock frame for any unit whose setpoint-limit band it hadn't learned from an ACP, so the unlock
was never transmitted.

- **Cortex now always sends the cmd4 lock frame**, using each unit's learned limit band when it has
  one and otherwise a safe default of the full **15–30 °C** range. This lets locks be both set and
  **cleared** on an ACP-free bus. Since Cortex only transmits as the sole master (no ACP to clobber),
  it is authoritative and this is safe.
- Because the dimension-lock state can't be read back over CEN (only the hard lock can), hitting Send
  asserts the unit's lock state as shown in Cortex; a unit whose band hasn't been learned gets the
  default 15–30 °C band (only matters while Temp lock is engaged — a note is logged).
- No change to the hard lock (cmd0) or the decoders from beta.3.

## v1.6.0-beta.3 — 2026-11-14 (hard lock + lock-decode corrections)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.2._

Cross-checked the lock work against a field-verified LGAP reference kit and corrected two things,
plus added the "hard lock."

- **Hard lock (whole wall-controller lock) now works.** It is the cmd0 **remote-controller lock**
  (cmd0 byte 4, bit `0x04`), sent with EXE on the control frame Cortex already uses — not a cmd4
  bit, which is why toggling it alone showed no cmd4 change on 2026-11-13. New **Hard** toggle in
  the unit's Locks row, alongside Mode / Fan / Temp.
- **Fixed a beta.2 regression:** beta.2 removed the cmd0 byte-4 `0x04` lock decode on the assumption
  it tracked mode. The reference (field-verified: lock on/off tested, reply byte 1 bit 2 confirms)
  shows that bit *is* the remote lock. Restored, and the lock now reflects when set at the wall or
  the ACP.
- Dimension locks (Mode/Fan/Temp via cmd4) are unchanged from beta.2 and confirmed correct; the
  reference also confirms cmd4 bytes 5–6 are the **setpoint-limit band** (lower = `(b5 & 0x0F)+15`,
  upper = `b6+15`), so replaying each unit's own bytes 5–6 — which beta.2 already does — is right.
- Docs updated (CHANGELOG, LGAP reference §4c, in-file protocol notes).
- `server.js` still unchanged (byte-transparent bridge; the state relay carries the new `hardLock`
  field through as-is).

## v1.6.0-beta.2 — 2026-11-13 (working wall-controller locks)

_Beta — publish as a GitHub **pre-release**. Builds on v1.6.0-beta.1._

**Locks now actually work.** Previously the Mode/Fan/Temp lock buttons only changed Cortex's own
screen — no lock command was ever put on the bus, so the wall thermostats were never locked. The LG
lock command was reverse-engineered live from a running ACP (unit 0x5E, each lock isolated on the
wire 2026-11-13) and is now implemented.

- **Cortex sends the lock command (cmd4).** Locks ride a distinct `A0 00 A0 addr b4 b5 b6` frame —
  byte 4 bits: `0x02` temp · `0x04` fan · `0x08` mode (plus `0x01` power). Cortex emits it right
  after the normal control frame when you Send a unit.
- **Locks set at the wall or the ACP now show up in Cortex.** Incoming cmd4 frames are decoded, so
  the lock chips reflect reality instead of guessing (this was the "changes don't reflect" issue).
- **Safe by design.** A cmd4 overwrites a unit's stored settings if sent with the wrong payload, so
  Cortex replays each unit's *own* observed `b5/b6` and **never sends cmd4 blind** — if it hasn't yet
  seen the ACP address a unit, it logs a warning and skips the lock rather than risk the unit. Let
  Cortex watch the bus alongside the ACP once to learn each unit's template.
- Fixed a wrong decode: the `80`-frame's byte-4 `0x04` bit was being shown as a lock — it tracks
  mode, not a lock. Locks are read only from cmd4 now.
- _Known gap:_ the ACP's separate "hard lock" produced no change in this frame and isn't handled yet.
- Appliance bumped to serve this UI; `server.js` is unchanged (the serial bridge is byte-transparent,
  so the browser-built lock frame reaches the adapter as-is).

## v1.6.0-beta.1 — 2026-11-12 (controls polish, debug cleanup, floor-plan placement)

_Beta — publish as a GitHub **pre-release**. Builds on stable v1.5.0._

**Controls**
- **Auto mode now uses a single setpoint** by default (Multi V units take one target in auto). You
  can still switch a unit to separate cool + heat with the toggle under Locks — in any mode.
- The **dual cool/heat setpoints are stacked** so the control panel no longer runs wider than the
  panel (no more sideways scrollbar).
- Changing a unit's **mode or fan now updates the building map immediately**, not only after the
  next poll.

**Building map**
- **Rotate a placed unit** — each unit on a floor plan has a ↻ handle in Edit layout to turn it 90°
  at a time, so it can sit on any wall.
- **Snap control** — a Coarse↔Fine grid slider, and a **Snap to grid** switch you can turn off for
  free, exact placement.
- **Preview a floor-plan picture before saving it** — after you pick an image you can zoom in to
  check it and rotate it to the right orientation, then "Use this picture". The rotation is baked
  into the saved plan.

**Bus scan (technician)**
- **One view instead of a Live/Debug toggle.** Everything for monitoring and debugging is on one
  page: the units-on-the-bus table, the live activity feed, Master/CC mode, the raw monitor and the
  capture tools.
- **Removed the raw "TX basic command" and "TX setpoint" senders.** Control a unit from its own
  page once it's imported; discovery and scanning stay read-only.
- **Watch one or two units.** Tick **👁 Watch** on a row to narrow the activity feed — and a saved
  capture — to just those units. Handy for following one unit on a busy bus. One set of capture
  controls now, not two.

**Other**
- The **header logo plays its animation while a bus scan is running.**
- **Group rename is easier to find** — the ✎ pencils next to a group and subgroup in the sidebar
  are always visible now (and work on touchscreens), not only on hover.

## v1.5.0 — 2026-11-11 (stable: building map, shared live state, reliability round)

_First stable release of the 1.5 line. Everything from `beta.1`–`beta.3` (below) plus a full
audit: things that looked like they worked but did not now really work, the controller state is
shared by every screen, and the updater bug that shipped in `beta.2`/`beta.3` is fixed._

**Read this if you run a beta.** `beta.2` and `beta.3` have an updater bug: a box that has never
touched Settings → Updates → *Beta testing* stops checking for updates. Either flip that switch
once (on, then off again is fine) or re-run `install.sh` from a fresh checkout. 1.4.x boxes are
not affected and update to 1.5.0 by themselves.

### Fixed — things that were broken
- **Group changes and All on / All off now really reach the units.** They changed the screen but
  never transmitted. All on / off asks first.
- **Commands and polling no longer talk over each other** on the bus; a command waits for the
  poll in flight, and a late poll reply can no longer undo a command just sent.
- **The updater** no longer stops when the channel file is missing; a build that fails its health
  check is rolled back *and skipped* until a different build is published (no restart loop;
  `CORTEX_UPDATE_FORCE=1` retries it); the health check waits for the *running* version.
- **Factory reset** really resets (type RESET) instead of loading demo units.
- **Re-running setup** keeps unit names, groups, schedules, floor plans, limits and location.
- A removed unit stays removed (ignore list) instead of being re-added by re-discovery.
- A missing pipe sensor shows "no reading" instead of −21°C.
- A dropped screen no longer leaves the adapter stuck "in use" (15 s heartbeat frees it).
- Pre-release tags are now published as GitHub pre-releases by the workflow.
- `install.sh` no longer resets the firewall on every run (only the first time, or with
  `CORTEX_RESET_FIREWALL=1`), so a site locked down to Tailscale stays locked down.

### New — reliability
- **One unit list for every screen.** Units, live readings and settings live on the appliance;
  phones and other browsers mirror the screen that is connected to the equipment ("Live") and
  send commands through it. Before, each browser had its own list.
- **Two screens can't overwrite each other's settings** — saves are revision-checked and a stale
  screen adopts the newer settings instead.
- **Auto-reconnect and auto-resume**: after a reboot, update or adapter blip the connected screen
  reconnects and resumes polling by itself. Screens reload themselves after an update.
- **Background tabs keep working** — timers run in a worker so a hidden tab is not throttled.
- **Schedules catch up** — a schedule missed by up to 10 minutes (reload, reconnect) still runs,
  once. Only the connected screen fires schedules.
- **"No response" detection** — a unit that stops answering is flagged on its tile, in alerts and
  in the control panel.
- **Crash-safe saves** — settings and units are written atomically with a last-good backup.

### New — faster
- A full pass of the bus takes about 2.6 s for 14 units instead of about 14.5 s (polling moves on
  as soon as a unit answers).
- The page is sent compressed and revalidated (about 100 kB instead of 316 kB on the wire); fonts
  no longer block first paint.

### New — real data instead of placeholders
- **Trends** are real: the appliance logs each unit every 5 minutes (35 days kept).
- **Error history**, **Poll this unit now**, last raw frames and reply statistics in the
  technician section are real. The made-up runtime / energy numbers are gone.
- Device health shows the real Tailscale address, live link and last update.

### Security
- **No built-in PINs.** The published default codes are gone; access codes are set in the setup
  wizard and changed in Settings. Wrong-code and wrong-password attempts are rate limited.
- The **"Re-run setup" link is gone from the login screen** (anyone could wipe a site with it).
- Requests from other websites to the control and settings endpoints are refused.
- Users: unique usernames, minimum password length, no default password, can't delete yourself.

### Changed
- Fan **Auto** is no longer offered in the control panel, group change or schedules — its bus
  code is not confirmed. A unit already in auto still displays correctly.
- Customer logins can be made view-only (Settings → Advanced → *Allow customer control*).
- Setpoint limits are clamped to 61–86°F with min below max.
- Developer notes moved out of `cortex.html` into `docs/HANDOFF.md`.

### Known limits
- Polling and schedules still run in the browser screen that is connected to the equipment — keep
  one screen open on site. Moving this into the appliance service is the next step.
- Logins are checked in the browser; treat the LAN as trusted or lock the box to Tailscale.
- This release was verified against a simulated LGAP bus and a staged appliance (217 automated
  checks), not yet on a live building.

## v1.5.0 beta notes (building map + animated units)

_Minor version bump — new building map, animated units, and the beta update channel.
`v1.5.0-beta.1` added the building map + graphics; `beta.2` adds the top-down LG-style graphics
on every view, the unit-type refresh fix, and the beta update channel; `beta.3` is the
"remember who is looking" round — customer vs technician views, tile polish, easy rename, the
Cortex brain mark + loader, floor plans on the map, and opt-in HTTPS. Publish as a GitHub
**pre-release**; drop the suffix for a full `v1.5.0` once it checks out on the box._

### beta.3

**Customer vs technician views**
- Bus address, channel, bus name and outdoor-system id are **gone from the unit tiles, list rows,
  section headers and map** for everyone. A technician sees them inside the unit's control panel
  (header line + Technician section); a customer never does.
- **Command preview** (the hex frames) is now technician-only, alongside pipe-in / pipe-out temps,
  raw frames and error history.
- The Send button reads **Send** / **Send again** for customers; technicians still see the target
  (`Send command → 0x15`, and the red live-bus version). Customer notices and toasts use plain
  words ("Connected to the equipment — Send changes the real unit right away").
- A unit nobody has named shows as **"Unit N"** instead of "Addr 0x17".
- Customers no longer get: the per-user *Bus address* card toggle (removed), the *System
  (physical)* group-by, the Settings → *Layout* wiring tab, the protocol reference, the ODU count
  on the summary tile, or the "new unit found at 0x…" prompt (it waits for a technician/admin).
  Technicians can search units by address.

**Unit tiles**
- Redesigned tile: **Set to** and **Room** are the same size and weight, each labelled; mode, fan
  and lock are matching chips; faults sit in one red note; names wrap to two lines. Consistent in
  comfortable and compact density, when off, in error, and for dual (cool / heat) setpoints.

**Rename**
- **Pencil next to the unit name** in the control panel — type, Enter. Any signed-in user can
  rename (even while a unit is locked for service); tiles, map and panel update immediately. Also
  in *Organize → Name & tags*.

**Device health**
- New **header button** (top right, next to Settings) for technicians and admins; the
  Settings → Advanced "Open" row is gone. The *Start page* option only lists Device health for
  those roles.

**Cortex brain mark + "Cortex is thinking…" loader**
- New logo: a geometric top-down brain. Calm in the header, login and setup wizard; fully animated
  (pulse, halo, sparks travelling in and out along its leads) as the loader.
- The loader covers the page while the app starts, and appears on Device health, update checks,
  floor-plan processing, and — prominently, with the progress bar and time left — during bus
  scans in the wizard and the Bus scan view. `brainLoader(size, label)` drops it in anywhere.
  Motion is disabled under the OS "reduce motion" setting.

**Building map: floor plans**
- Technicians/admins get an explicit **Edit layout** mode: add a floor-plan picture to any
  group ▸ subgroup, then drag units from a tray onto it (mouse or touch, snap to grid). Outside
  edit mode nothing moves and a tap opens the control panel as before; a group without a picture
  keeps the tile grid.
- Pictures are shrunk in the browser, then stored on the appliance (`/api/floorplan/:id`, files
  under `data/floorplans/`, JPEG/PNG/WebP only); positions live in the shared config so every
  browser sees the same layout. Opened as a bare file, pictures stay in that browser.
- Renaming a group or subgroup carries its floor plan along.

**HTTPS (opt-in)**
- `CORTEX_HTTPS=1` in `data/appliance.env` makes the appliance **also** serve https + wss (default
  port 8443). Plain http is untouched and there is no redirect, so it cannot lock a box out.
- The installer creates a self-signed certificate (hostname, hostname.local, localhost) if none
  exists and never overwrites one; a certificate you drop in (e.g. from `tailscale cert`) is used
  as is. Device health shows whether https is running, the port and the certificate expiry.
- "Use my location" works when Cortex is opened over https. See `appliance/README-appliance.md`,
  Part E.

**Fixes & housekeeping**
- Shared-config save limit raised from 32 kB to 256 kB (a large site could silently fail to save).
- Fan-only mode chip now has its colour; names and tags are HTML-escaped wherever they are shown.
- Settings → Layout lists units under their real outdoor systems (was hard-wired to two demo names).

**Building map & live unit graphics**
- Redesigned the indoor-unit graphic as a **top-down** SVG that matches real LG unit types
  (wall mount, 4-way / 1-way cassette, ducted, floor standing, ceiling suspended) so it lines up
  with a top-down floor plan.
- Each unit **animates its live state**: airflow leaves the body in the directions that type
  actually blows (4-way = all sides, wall/1-way/ducted = one side, ceiling = both ends,
  floor = upward), colored by mode, speed set by fan, with a flashing fault dot + error code.
- The animated graphic now appears **everywhere a unit shows** — building map, group/unit grid
  cards, and the control drawer.
- Set a unit's **type** from its control panel (tech/admin); the graphic updates immediately.

**Setup, manufacturer & controller**
- Manufacturer locked to **LG**; other brands show "Coming soon" (no way to select them yet).
- New wizard step for **LG system generation** — Gen 4 (4800 baud) or Gen 5 (9600 baud) — feeding
  the bus baud rate; a tech can still set baud manually.
- **Device health** moved out of the sidebar into Settings → Advanced.
- Admins can **rename the site** from the UI.
- "Use my location" now detects a non-secure (plain-http appliance) context and guides to manual
  latitude/longitude entry instead of failing silently.

**Updates / OTA**
- New **update channel** — Settings → Updates → *Beta testing* (admin only). Off by default:
  appliances only auto-update to **stable** releases (GitHub "latest" already skips pre-releases,
  so existing customer boxes never pull a beta). Turn it on for a test box to also receive
  alpha / beta / rc builds.
- Updater and the in-app check now compare full semver including the pre-release suffix, so a beta
  box correctly promotes to the final stable (`1.4.4` supersedes `1.4.4-beta.1`).

**Known / next**
- Backend (always-on) scheduling — needs testing on the box against the live bus.
- Floor plans: pinch-zoom / pan for large drawings, and including the pictures in Backup (today a
  backup keeps the unit positions but not the image files).
- New groups still take the outdoor system's name ("System #3") until a technician renames them.
- HTTPS is opt-in and manual to enable; certificate renewal for the Tailscale route is manual.
- Unit lists still live in each browser; moving them to the appliance is the next step so names,
  types and groups match everywhere without a re-import.
- Real push/email alerting is not yet wired.
- Verify on the wire: the ODU/system grouping byte and whether ODU faults reach indoor replies.

## v1.4.3 — 2026-11-11 (controller validation + big feature round)

**Protocol & master mode (field-validated on a live Multi V IV, 14 indoor units)**
- Setpoint is sent in the basic cmd0 frame (byte 6 = °C − 15); Cortex no longer auto-sends the
  destructive cmd5 frame. Replies decode to error, mode/fan, setpoint, room/pipe temps, valve
  position, and system group. Temperatures use `C = (192 − code) / 3`.
- Safety guards: discovery sends read-only frames only, refuses to blind-sweep a write command,
  never addresses `0xFF`, and warns against running alongside a real LG central.
- One-tap **guided setup**, fixed the "phantom units" bug (one bus master at a time + reply
  address validation), **background re-discovery** with a prompt to add newly found units, a
  live scan countdown, and button tooltips.
- Expanded **error-code reference** to the real Multi V codes (incl. CH36, CH104, CH151,
  CH204/206) with a safe fallback for unknown codes.
- Schedule/master **collision guard**: polling pauses while a schedule transmits.

**Organization**
- 2-level **group → subgroup** tree in the sidebar (collapsible, rename, move units), separate
  from the physical outdoor-unit grouping.
- Multi-select **delete** and **move** for units; import drawer/ID bug fixed; imported units
  show live room temps.

**Schedules**
- Start empty; a real engine now **fires bus commands** at the set time.
- **nth-weekday** recurrence (1st–5th / last of the month) and **outdoor-temperature
  conditions** backed by live weather.

**Weather & device health**
- Live local weather (Open-Meteo) from the site location (geolocate or enter coordinates).
- Device health reads **real OS vitals** (CPU, memory, disk, temperature, uptime, bus activity)
  via a new `/api/device` endpoint; shows "unavailable" off the appliance instead of fake data.

**Accounts, sessions & settings**
- Sessions persist across refresh with an admin-set **idle auto-logout** (15 min–8 h or never).
- Command-center first-run setup wizard + recovery code (replaced the hardcoded demo login).
- New settings: setpoint limits, backup/restore, 12/24-hour clock, start page, outdoor-temp
  test override, real site location.
- Real header **bus-health light** (green healthy / red problem / grey offline).

## v1.4.2 — 2026-11-10
De-brand of the main UI to "Cortex", protocol-reference corrections, and the first batch of
master-mode decode fixes.

## v1.4.1 — 2026-11-10
De-branded main UI (AIROW retained only in About/credits), OTA auto-config in the installer,
working power buttons, and fresh-install setup.

## v1.4.0 — 2026-11-10
Reply-parser decode from the ACP firmware, README with real screenshots, layout and
update-flow fixes.

## v1.3.0 and earlier
Initial appliance + UI, LGAP decode from firmware, master/CC mode beta, GitHub + OTA setup.

---

*Cortex by AIROW. Not affiliated with or endorsed by LG.*
