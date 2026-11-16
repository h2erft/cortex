# The outdoor unit's service port (the "LGMV port") — how to test it with Cortex

*2026-11-15, v1.6.0-beta.7. Tool: `uart-sniffer.html` (also served by the appliance; link in the Bus Scan
debug view). Status: the decoder matches an independent reference decoder byte-for-byte on recorded
frames, and its framing, checks, lookup tables and request behaviour were cross-checked against LG's
own LGMV program — but it **has not yet been run against a real outdoor unit by us.***

## What this port is, in plain words

The outdoor unit has a small 4-pin plug on its main board. LG's laptop program **LGMV** plugs in there.
It is a different wire from the central-control bus Cortex normally uses, and it carries much more:
both refrigerant pressures, every outdoor temperature sensor, compressor speed, all the valve
positions, every indoor unit and every heat-recovery box.

How it talks:

- Speed **2400 baud, 8 data bits, no parity, 1 stop bit**.
- Left alone, the unit just repeats a short "who I am" message about four times a second
  (model code, firmware version, how many indoor units and HR boxes it has).
- It only sends the real data when asked. LGMV asks with two tiny fixed messages, and it never
  speaks first: each time it hears "who I am" it answers ("hello" the first two times, "send the next
  round" after that), and each time a round ends it answers "send the next round" again.
  A round takes about 7 seconds.

So there are two ways to use the Cortex page:

1. **Listen only** (default). You will see the "who I am" message — enough to prove the wiring and
   speed are right. If LGMV is polling at the same time on a splitter, you see everything it sees.
2. **Ask for live data** (a tick box). Cortex answers the unit exactly the way LGMV does and shows
   the data. The page cannot send anything else, and it only sends right after the unit has spoken.

## Two kinds of module (both carry the exact same frames)

LG makes two interface modules; they are two ways of reaching the same service UART, not two protocols.

- **Wi-Fi module** (model PLGMVW100, "Mobile LGMV"). It makes its own open Wi-Fi network named
  `LGE_MV-xx-xx-xx` and is a transparent TCP bridge at **192.168.1.1 port 9999**. One connection at a
  time. A browser can't open a raw TCP socket, so Cortex reaches it through a tiny bridge:
  1. Close LGMV-Business (the module allows only one connection).
  2. Join the module's Wi-Fi (`LGE_MV-…`, open network).
  3. In the Cortex folder on that laptop: `node tools/uart-wifi-bridge.js`
  4. Open `http://localhost:8899` — the UART tool loads there and connects to the module itself.
  (The bridge only moves bytes; the browser still transmits nothing unless you tick "Ask the outdoor
  unit for live data", and then only LGMV's two monitoring requests.)
- **Wired USB module** (or an isolated USB-TTL adapter). Shows up as a COM port; use **Connect USB…**
  in the tool and pick the port.

In Cortex itself there is an experimental **UART** page (technician view) with the same tool embedded;
the USB path works there directly, and the Wi-Fi path works there too if the bridge is running.

## What you need (wired)

- **Best:** LG's own USB LGMV module/cable. It is electrically isolated and shows up as a COM port.
  Set its DIP switch for Multi V II–IV (switch 4 ON, the rest OFF) **with USB unplugged**.
- **Or:** an **isolated** USB-to-TTL serial adapter. A bare (non-isolated) adapter ties your laptop's
  ground to the outdoor unit's electronics — don't.
- A laptop with Chrome or Edge.

Header pins (reference says "likely — confirm with a meter before using your own adapter"):
pin 1 = data **into** the outdoor unit, pin 2 = data **out of** the outdoor unit, pin 3 = +5 V from
the unit, pin 4 = ground. For listen-only with your own adapter: ground to pin 4, adapter RX to pin 2,
nothing else. **Never** connect the adapter's power pin to pin 3. A second, similar-looking factory
programming connector exists on the board — do not plug into that one.

## Steps

1. Close LGMV if it is open (the port serves one program at a time).
2. Open `uart-sniffer.html` in Chrome/Edge (from the Cortex folder, or the link in Cortex's Bus Scan
   debug view when the page is opened as a local file or over https).
3. Leave **Baud 2400 · Data 8 · Parity none · Stop 1**. Click **Connect…** and pick the COM port.
4. Within a second the **Outdoor unit — decoded** card should show a line like
   *Product code 0x1E · main: capacity 18, firmware 31.0 · 3 indoor units · 1 HR box*.
   - Nothing at all → wrong COM port, cable not seated, or outdoor unit off.
   - Bytes but "failed check" keeps climbing → wrong baud or DIP switch.
5. Press **● Start recording** (so we keep the raw bytes whatever happens).
6. Tick **Ask the outdoor unit for live data** and confirm. Within ~10 seconds the tables fill in:
   outdoor main/sub, indoor units, HR boxes.
7. Compare a few numbers with gauges or with LGMV's own screen: high/low pressure, suction and
   discharge temperature, compressor Hz, one indoor unit's EEV. Write down anything that disagrees.
8. Untick the box, stop recording, download the **timestamped hex log**, and send it in.

Things that are normal: a few "failed check" counts while it first syncs; the firmware/ID line
going quiet while live data is flowing (the unit stops the ID beacon while it is being polled and
resumes about 30 s after polling stops).

## What the page will and will not do

- It sends only `02 0E 01 … B3` (hello) and `02 0E 02 … 26` (next round). Both are what LGMV sends
  while simply monitoring. The code refuses to write anything else, and it only sends in reply to a
  valid 0x64 or 0x6B frame from the unit — a silent or garbled line gets nothing from us.
- It will **not** send LGMV's "IDU Control", outdoor-unit control or EEV frames. Those are writes
  that touch every indoor unit or override compressor/valves; they are deliberately not implemented.
- Layouts are for **Multi V IV**. Heat pump and heat recovery use the *same* outdoor-unit decoder
  inside LGMV, so both are covered. On another family, treat every number as unverified.
- Pressures/saturation temperatures assume **R410A**. LGMV carries three more table sets and picks one
  by refrigerant (by their numbers: R22-class, R32, R134a). Not selectable here yet.

## Technical map (for whoever maintains the decoder)

Frame: `02 <total length> <type> <payload…> <check>`. Check = CRC-16/XMODEM big-endian (2 bytes) for
types 0x65–0x68, CRC-8 with reflected polynomial 0x85, init 0 (1 byte) for all others.

| Type | Len | Content | Decoder |
|---|---|---|---|
| 0x64 | 31 | product record: byte 3 model code; four 6-byte unit blocks from byte 4 (capacity, firmware major, minor, 3 EEPROM bytes); byte 28 indoor count; byte 29 HR-box count | `decodeProduct` |
| 0x65 / 0x66–0x68 | 67 | main / sub outdoor unit (byte map below) | `decodeOduFrame` |
| 0x69 | 4 + N | indoor-unit communication counters, one byte per unit | shown as "Comm count" |
| 0x6A | 17 | one indoor unit: byte 3 index, 4 type/lock, 5 on/mode/fan, 6 capacity, 7–8 EEV, 9 room, 10 pipe in, 11 pipe out, 12 error, 14 central address | `decodeIdu` |
| 0x6E | 22 | one HR box (address 0x41 = box 1), one of four port pages per frame | `decodeHr` |
| 0x6B | 14 | end of cycle: control step numbers, discharge target | `decodeStep` |
| 0x01 / 0x02 | 14 | PC → unit: hello / next cycle | `LGMV_HELLO`, `LGMV_POLL` |

Outdoor frame bytes: 3 mode (bits 0–1) · 4/5 inverter 1 target/actual Hz · 7 inverter 2 Hz ·
8/9/10 fan target/1/2 (×10 rpm) · 0x12 valve bits · 0x14–0x19 EEVs main, sub, subcool, VI1, VI2, EQ
(×8 pulses) · 0x1A outdoor air · 0x1B high pressure (also condensing temp) · 0x1C low pressure (also
evaporating temp) · 0x1D suction · 0x1E/0x1F discharge 1/2 · 0x21–0x23 heat-exchanger temps ·
0x24/0x25 subcooler in/out · 0x26 liquid · 0x2B/0x2C inverter 1 input A (÷5) / V (×5) · 0x33 inverter 1
phase A (÷5) · 0x3B/0x3C DC link 1/2 (×5 V) · 0x3D/0x3E IPM temps (signed °C).
Sensor bytes index the same 256-entry tables Cortex uses for the central-bus outdoor pages.

Tests: `node tests/uart.test.js`.

## What LGMV itself confirmed (2026-11-15)

Read from LGMV-Business with Ghidra (helper scripts in `tools/ghidra/`; no decompiled code is kept here):

- **Checks.** A received frame is accepted if *either* the CRC-8 (reflected 0x85) *or* the
  CRC-16/XMODEM matches; the page now does the same. Requests always use the CRC-8.
- **Frame types handled** for Multi V IV: 0x64, 0x65–0x68, 0x69, 0x6A, 0x6B, 0x6E, 0x6F, plus
  0x29, 0x2C, 0x42–0x46 (black-box / history pages we do not decode).
- **Heat pump = heat recovery.** The two parser classes share the same handlers for 0x64, 0x65–0x68
  and 0x6B. The HR-box page (0x6E) simply never arrives on a heat pump.
- **Lookup tables.** LGMV's air, pipe, suction, discharge, high/low pressure and condensing/evaporating
  tables for the default refrigerant are number-for-number the ones this page uses.
- **Requests.** Every request is 14 bytes `02 0E <type> <arg> 0…0 <crc8>`. Monitoring uses types 1 and
  2 only, sent as described above. Other types exist (3 = history page, 0x20 = serial number,
  0x10/0x11 = another mode) and are **not** implemented.
- **Indoor frame (0x6A).** Byte 4 low nibble = unit type; byte 5 bits 0–2 mode, bit 3 running,
  bits 4–5 fan (4–6 on some models); byte 6 capacity; 7–8 EEV; 9 room; 10/11 pipe in/out; 12 error;
  14 central address (LGMV shows it in hex). LGMV also shows pipe-out minus pipe-in — now a column.
- **Comm-counter frame (0x69).** One byte per indoor unit, in LGMV's index order (the same index as byte 3 of
  the 0x6A records). It is that unit's communication counter (LGMV's "comm count"): a raw number that ticks
  up, wrapping at 256, as the outdoor unit processes records from that unit — about once every 10 s in one
  capture. A counter that has stopped does not by itself prove a dead link. (Our earlier guess of
  "setpoint × 2" was wrong; the reference kit's chapter 02 §8 has this.) LG's manual uses the same counter
  for CH53: the unit whose count is not increasing is the one not talking.

## Still open

- Not yet proven on a live unit by us (first on-site run = the checklist above).
- Outdoor-frame (0x65) field *names* have not been checked against LGMV one by one. LGMV's handler
  files values by grid row/column rather than by name, so that needs its cycle-view table definitions
  too. Offsets 3–0x10 are read in the order the kit lists; nothing contradicted the kit.
- Refrigerant selection for non-R410A systems; the 0x6F page; black-box pages.
