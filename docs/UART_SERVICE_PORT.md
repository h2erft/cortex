# The outdoor unit's service port (the "LGMV port") — how to test it with Cortex

*2026-11-15, v1.6.0-beta.7. Tool: `uart-sniffer.html` (also served by the appliance; link in the Bus Scan
debug view). Status: the decoder matches an independent reference decoder byte-for-byte on recorded
frames, but **has not yet been run against a real outdoor unit by us.***

## What this port is, in plain words

The outdoor unit has a small 4-pin plug on its main board. LG's laptop program **LGMV** plugs in there.
It is a different wire from the central-control bus Cortex normally uses, and it carries much more:
both refrigerant pressures, every outdoor temperature sensor, compressor speed, all the valve
positions, every indoor unit and every heat-recovery box.

How it talks:

- Speed **2400 baud, 8 data bits, no parity, 1 stop bit**.
- Left alone, the unit just repeats a short "who I am" message about four times a second
  (model code, firmware version, how many indoor units and HR boxes it has).
- It only sends the real data when asked. LGMV asks with two tiny fixed messages: a "hello" once,
  then "send the next round" after each round. A round takes about 7 seconds.

So there are two ways to use the Cortex page:

1. **Listen only** (default). You will see the "who I am" message — enough to prove the wiring and
   speed are right. If LGMV is polling at the same time on a splitter, you see everything it sees.
2. **Ask for live data** (a tick box). Cortex sends the same two messages LGMV sends and shows the
   answers. The page cannot send anything else.

## What you need

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
  while simply monitoring. The code refuses to write anything else.
- It will **not** send LGMV's "IDU Control", outdoor-unit control or EEV frames. Those are writes
  that touch every indoor unit or override compressor/valves; they are deliberately not implemented.
- Layouts are for **Multi V IV** (the reference was verified on Multi V IV heat recovery; heat pump
  shares the frame types). On another family, treat every number as unverified.

## Technical map (for whoever maintains the decoder)

Frame: `02 <total length> <type> <payload…> <check>`. Check = CRC-16/XMODEM big-endian (2 bytes) for
types 0x65–0x68, CRC-8 with reflected polynomial 0x85, init 0 (1 byte) for all others.

| Type | Len | Content | Decoder |
|---|---|---|---|
| 0x64 | 31 | product record: byte 3 model code; four 6-byte unit blocks from byte 4 (capacity, firmware major, minor, 3 EEPROM bytes); byte 28 indoor count; byte 29 HR-box count | `decodeProduct` |
| 0x65 / 0x66–0x68 | 67 | main / sub outdoor unit (byte map below) | `decodeOduFrame` |
| 0x69 | 32 | system summary — **not mapped** | stored raw |
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

## Still open

- Not yet proven on a live unit by us (first on-site run = the checklist above).
- 0x69 summary frame and several bytes of 0x6A / 0x65 are unmapped.
- Heat-pump (non-HR) systems: same frame family, not separately verified.
- LG's own decoder in LGMV-Business.exe (parser classes `Sync4ProtocolParser`, `Super4ProtocolParser`,
  `IDU4ProtocolParser`, `HRU4ProtocolParser`) would confirm every field and fill the gaps. A prepared
  Ghidra project for that exists on the operator's other PC — see `docs/NEXT_AGENT_GUIDE.md` §8.
