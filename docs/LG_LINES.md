# More than one LG line

Some buildings have several separate LG communication wires. LG's own central controller has a port for
each. Cortex does the same: each wire is an **LG line** with its own adapter (or its own channel of a
multi-channel adapter, see `ADAPTERS.md`) and its own poll loop. All lines are read at the same time, and
every unit appears together in the dashboard.

## Setting it up

1. **Line 1** is the LG bus Cortex always had. Bus scan ▸ LG line 1 ▸ **Choose adapter…** picks its channel.
2. Bus scan ▸ LG line 1 ▸ **Add another LG line…** Name it, pick a free adapter or channel. It connects
   and only listens.
3. Make sure live polling is on (line 1 ▸ start polling). It is one switch for the whole site.
4. Open the new line's tab ▸ **Find units on this line**. The controller asks each address on that wire
   once. Units already known keep updating meanwhile.
5. **Add N new units to Cortex.** They land in "New units", on that line. Name and group them as usual.

Repeat 2 to 5 for each wire.

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

- A raw byte view and an outdoor-unit finder for extra lines. Outdoor addresses can be entered by hand;
  every line tries a known outdoor address until one gets the answer.
- Not yet proven on a real multi-line site.
