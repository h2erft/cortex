# The bus link: one adapter, owned by the controller, shared by every screen

Since 1.7.1-beta.5 the RS-485 adapter belongs to the **controller**, not to whichever browser opened
Bus scan first.

## What changed

| | Before | Now |
|---|---|---|
| Who opens the adapter | The first screen to press Connect | The controller (`appliance/buslink.js`) |
| What other screens saw | "Link down", or "in use by another session" | The same status as everyone |
| Connect / Disconnect | Only meant *this screen* | A switch kept on the controller (`data/bus-link.json`); any technician's device flips it for everyone |
| Bytes on the bus | Only the screen holding the adapter saw them | Every screen with Bus scan open sees them |
| Live polling | A browser tab, with the controller as fallback | Always the controller (`busmaster.js`) |
| After a restart | A screen had to come back | The controller reconnects and polls by itself |

## The three states

1. **Connected** (`on`): the controller has the adapter open and is **listening only**. Connecting never
   transmits. This is safe with a real LG central on the bus.
2. **Polling** (`master`, the existing master-mode flag): Cortex is the bus master on this site and the
   controller asks the units itself. Started by *guided setup* / *start poll loop*, stopped by *stop
   polling*. Never switch this on while a real LG central is connected.
3. **Bus tools on one screen** (`driver`): discover, raw frames and the other technician tools need one
   screen to talk on the wire. That screen borrows it (**Use bus tools on this screen**); the controller
   stops polling until it is handed back. One screen at a time. It is handed back by **Done**, by
   closing or reloading the tab, after a minute with the tab in the background, after five minutes
   without transmitting, or when another technician presses **Take over**.

The controller polls exactly when: connected **and** master **and** units exist **and** no screen has
the tools. There is never more than one master talking.

## API

- `GET /api/bus` → `{ on, open, opening, error, serial, driver, master, polling, alive, holder, units, … }`.
  The same object rides along in `GET /api/units` (`bus`) and, shortened, in `/health`.
- `POST /api/bus { on: true|false, serial? }` connects / disconnects. `POST /api/bus { release: true }`
  takes the wire back from a screen.
- `ws /bus`: every client receives the bytes heard and `{ bus: {…, mine, waiting} }` whenever the
  status changes. Text `{ take: true, force? }` / `{ release: true }` borrows / returns the wire. Binary
  frames are written to the bus **only** from the screen that holds it.

## Upgrading

A site that was polling keeps its adapter connected. A site that was only listening (a real LG central
is the master) starts disconnected: press **Connect adapter** once, on any screen.

Tests: `tests/buslink.test.js` (the link itself), `tests/bus-shared.test.js` (a real controller, a
pretend adapter, two technicians' browsers).
