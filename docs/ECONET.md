# Rheem / Ruud (EcoNet) in Cortex

Since 1.7.1-beta.6 a Cortex controller can also read and control Rheem / Ruud equipment that speaks
**EcoNet**, alongside the LG bus.

**Not yet tested on real equipment.** Everything here was tested against a simulator. The first real
system should be brought up in listening-only mode, which cannot affect it.

## Credit and licensing

The EcoNet protocol was worked out by the [esphome-econet](https://github.com/esphome-econet/esphome-econet)
community. Cortex's implementation (`appliance/econet.js`, `appliance/econetlink.js`) was written for
Cortex from how the bus behaves. No code from that project is included: its C++ is GPLv3 and Cortex is
not. If anything here is ever adapted from their code rather than from wire behaviour, that changes.

## What is supported

| Kind | Main device address | Shown and controlled |
|---|---|---|
| Heating & cooling system (EcoNet thermostat + air handler / furnace / outdoor unit) | thermostat `0x380`, outdoor unit `0x400`, furnace `0x1C0` | room temperature, mode, heat / cool setpoints, fan, schedule on/off, humidity, airflow, outdoor pressures and temperatures, alarms |
| Heat pump water heater | `0x1280` | setpoint, on/off, mode, tank temperatures, hot water available, alarms |
| Electric tank water heater | `0x1200` | setpoint, on/off, mode, tank temperatures, alarms |
| Tankless water heater | `0x1040` | setpoint, on/off, inlet / outlet temperature, flow, alarms |

Multi-zone HVAC is not handled yet. A value the equipment does not have is simply left out.

## The bus, in short

- RS-485, **38400 baud, 8 data bits, no parity, 1 stop bit**, on the equipment's RJ11 service port.
- **One bus per system.** Each thermostat-and-equipment set, and each water heater, is its own bus, so
  each needs its own USB RS-485 adapter on the controller. (LG is one bus for a whole building.)
- There is no single master. The thermostat, the equipment and Rheem's Wi-Fi module all ask each other
  questions. Cortex joins as one more voice, using the Wi-Fi module's address `0x340`. **If a Rheem
  EcoNet Wi-Fi module is fitted, unplug it before letting Cortex talk**: two devices must not share an
  address.
- A message: `80 <dst ×3> 00  80 <src ×3> 00  <len> 00 00 <command>  <data>  <crc lo> <crc hi>`, with
  CRC-16/ARC. Commands: `1E` read, `1F` write, `06` answer / done, `15` refused. Every value has a name
  of up to 8 characters (`SPT`, `COOLSETP`, `WHTRSETP` …).

## Wiring (from the esphome-econet hardware guide)

RJ11 plug: **pin 4 (red) → A**, **pin 3 (green) → B**, **pin 5 (black) → GND**. Leave the 12 V pin
unconnected. Phone cords often reverse the colour order between their two ends, so check against the
plug. Swapped A and B is the usual reason nothing is heard.

## Bringing a system up

1. Plug the adapter into the controller and wire it to the service port.
2. **Rheem / Ruud ▸ Add a system**: name, kind, adapter. It starts **listening only**: Cortex opens the
   adapter and decodes what the thermostat and equipment already say to each other. Nothing is sent.
3. Watch **Messages**. Valid messages here prove the wiring, speed and checksum. If it stays empty,
   swap A and B.
4. **Let Cortex talk on this bus**: Cortex asks for its list of values about every 30 seconds and can
   send changes. It refuses to transmit until it has heard at least one valid message.
5. Changes (setpoint, mode, fan …) are sent only when someone makes one, only for values on the allowed
   list in `econet.js`, inside their limits. Device resets and alarm clears are not on that list.

## How it is built

- `appliance/econet.js`: the message format and the list of values per kind (pure functions).
- `appliance/econetlink.js`: one system: its adapter, listening, asking, changing.
- `appliance/server.js`: `data/econet.json` (the systems), and the API:
  `GET /api/econet`, `GET /api/econet/catalog`, `GET /api/econet/ports`, `POST /api/econet/systems`,
  `DELETE /api/econet/systems/:id`, `POST …/:id/write`, `POST …/:id/read`, `GET …/:id/frames`.
- The LG link refuses an adapter that belongs to an EcoNet system and the other way round. With more
  than one adapter plugged in, set the LG adapter by its stable name in the controller settings.
- `cortex.html`: the **Rheem / Ruud** page. Everyone signed in can see and control a system;
  adding, connecting and the message tools are technician-only.

Not done yet: alarms in Fault history and notifications, schedules, the fleet console (Cortex Command),
multi-zone, backup of the system list.

Tests: `tests/econet.test.js`, `tests/econet-ui.test.js` (with `tests/helpers/econet-sim.py`, a
simulator written separately from Cortex's encoder so the two check each other).
