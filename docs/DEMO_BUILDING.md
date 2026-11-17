# The demo building

A pretend site built into Cortex, for training a new technician and for showing a customer around.

## Opening and leaving it

- Sign-in screen: **Open the demo building**.
- First-time setup screen: **Open the demo building** (nothing is set up).
- Settings ▸ Advanced ▸ **Demo building ▸ Open**.
- Or add `?demo` to the address.

A dark chip at the bottom says "Demo building" the whole time. **Exit demo** on the chip (or closing the
tab) puts everything back. The demo lives in one browser tab; other tabs and other people are not affected.

## What is in it

"Harbor Point Offices": 22 indoor units on two floors and two outdoor units.

| Planted | Where | What it shows |
|---|---|---|
| A live fault, CH04 | Conference B | Error card, alert bell, the error page, step-by-step diagnosis |
| A unit that stopped answering | Storage | "Silent" handling |
| Filter sign | Break room | The "Filter cleaned" reset (it works: the sign goes out) |
| Hard lock | Server room | Lock read-back and the lock buttons |
| A system short of refrigerant | Outdoor unit 0xC1 (2nd floor) | Cycle diagnosis flags "Low refrigerant charge", lower health score |
| A recorded high-pressure trip, CH34 | Fault history, two days ago | The recording with a condenser fan slowing to a stop, and the printable fault report |
| Three schedules, trends, 30 days of outdoor history | | Schedule, Trends, CSV download |

Commands work: turn a unit off or change its setpoint and the pretend unit obeys and its room
temperature drifts accordingly.

## Why it is safe

In demo mode three things are replaced inside the page, before anything else runs:

1. **Storage.** The page uses a memory store instead of the browser's saved site, so your real setup in
   that browser is never read or changed.
2. **The controller.** Every `/api/…` call is answered by `demoApi()` inside the page. None reaches a
   controller. Reboot, update, factory reset and "clear unit data" answer "switched off in the demo".
   (Opened from a controller, the demo reads that controller's version number once, to show it. That is
   the only request.)
3. **The bus.** The "adapter" is `DEMOSIM`, a simulator that answers Cortex's own poll and command frames
   with correctly formed LGAP replies. The WebSocket to a controller and Web Serial are both blocked.

Because the simulator speaks real frames, everything on screen comes from the same decoder, diagnosis
rules and drawings used on a real site.

## For whoever works on it next

- All of it is in `cortex.html` under "Demo building": `DEMO_ROOMS`, `DEMOSIM` (units, tick, frames),
  `demoPage()` (one outdoor page from plain numbers), `DEMOSRV` (events, history, advisories), `demoApi()`.
- `DEMO`, `IS_FILE` and `LS` are defined at the very top of the script. Use `LS`, never `localStorage`,
  and `IS_FILE`, never `location.protocol==="file:"`, or the demo will leak into real storage or behave
  like a bare file.
- `tests/demo.test.js` runs the demo on desktop and phone, sends commands, opens every screen and the main
  dialogs, and fails if any screen shows `undefined`, overflows, throws, or if a single request is made
  to a controller. It doubles as the all-screens regression test.
