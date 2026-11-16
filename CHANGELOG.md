# Changelog

All notable changes to Cortex. Dates are when the work landed on `main`.

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
