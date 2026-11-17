# Occupant view

A one-room page for the people who use the room: a condo owner, a tenant. **Off by default.**

## Turning it on

Settings ▸ Advanced ▸ **Room pages for occupants**. Turn it on, then **Manage rooms ▸ Add a room**:

1. Name the room (the occupant sees this name).
2. Tick the units in it (up to 16).
3. Set the lowest and highest temperature they may choose.
4. Choose whether they may turn the unit on and off.

Each room gets a link: `https://<controller>/room.html#<key>`. **Copy link** and give it to the people in
that room. **New link** replaces the key (the old link stops working), for when someone moves out.

## What the occupant can do

See the room temperature and the setpoint, move the setpoint up or down inside the range, and (if
allowed) turn the unit on or off. Nothing else: no other rooms, no mode or fan (unless a later version
allows it), no schedules, faults, locks or settings.

## How it is kept small

- With the switch off, `/api/room/…` answers 404 for every key, as if the feature did not exist.
- A key that is not on the list also answers 404.
- The controller, not the page, enforces the limits (`appliance/occupant.js`): the temperature is clamped
  to the room's range, only that room's units are accepted, only on/off and setpoint pass through, and
  changes are limited to one every 1.5 seconds.
- A change joins the same short-lived queue as a command from any Cortex screen. If Cortex is not
  running the bus, the occupant is told to try again later; nothing is stored up.

## What it is not

It is a convenience, not a security boundary. The link is the only key and there is no password. Like the
rest of a controller's pages, it works for anyone who can reach the controller on the network. If
occupants are on the same network as the controller they can also reach the Cortex sign-in page. For a
building where that matters, put the controller on its own network and publish only what you intend.

Rules are covered by `tests/occupant.test.js`.
