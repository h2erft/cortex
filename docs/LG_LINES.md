# More than one LG line

Some buildings have several separate LG communication wires. LG's own central controller has a port for
each. Cortex does the same: each wire is an **LG line** with its own adapter (or its own channel of a
multi-channel adapter, see `ADAPTERS.md`) and its own poll loop. All lines are read at the same time, and
every unit appears together in the dashboard.

## Setting it up

Everything is on one page: Bus scan ▸ **LG channels**.

1. **Line 1** is the LG bus Cortex always had. **Choose adapter** on its row picks its channel.
2. **Add another LG line** for each further wire: name it, pick a free adapter or channel. It connects
   and only listens.
3. Make sure live polling is on. It is one switch for the whole site.
4. **Search every channel for units.** The controller asks every address on channel 1, then channel 2
   without the addresses that already answered, and so on. Units already in Cortex are not asked
   again. One bar and one time-left figure cover all channels (`POST /api/lg-lines/search-all`).
5. **Add N new units to Cortex.** Each lands in "New units" on the channel that found it.

**Search** on a single row asks every address on that one wire, including addresses Cortex has on
other channels. Use it to find a unit that is recorded on the wrong channel, or two units sharing an
address. The **Live data** box shows what is said on every channel, or on one (`GET /api/lg-traffic`).

## Rules

- **Addresses are unique across the whole building.** Cortex knows a unit by its address, exactly as
  LG's controller does. If the search finds an address that is already in Cortex on another line, it
  says so. If it is the same unit and it really is on this wire, use "move it here". If it is a second
  unit with the same address, change one unit's address at the unit.
- **One master per wire.** Never search or poll a wire that still has an LG central controller on it.
- Connecting a line only listens. Cortex talks on it only while live polling is on.

## What happens where

- `u.bus` on a unit is its line id (2 and up). No `bus` means line 1.
- Commands, schedules and All on/off are queued by address; each line's loop sends only its own units'.
- The bus tools on a screen (discover, raw frames) work on line 1. An extra line is searched by the
  controller (`POST /api/lg-lines/:id/scan`).
- Removing a line keeps its units; they show as not responding until deleted or moved.
- Settings are in `data/lg-lines.json`. API: `GET/POST /api/lg-lines`, `DELETE /api/lg-lines/:id`.

## Not done yet

- Outdoor units (since beta.14): Outdoor / cycle ▸ **Find outdoor units** runs on the controller, on every
  line at once (`POST /api/odu/find`, `/api/odu/read`). Found addresses are kept in `data/odu-addrs.json`.
- Not yet proven on a real multi-line site.
