# LGAP — LG Air-conditioning Protocol Reference

An unofficial, reverse-engineered reference for **LGAP**, the RS485 protocol LG's central
controllers (ACP, AC Smart) use to talk to indoor VRF/VRV units. It exists so Cortex — and
anyone else doing interoperability work on their own LG equipment — can speak the bus
directly instead of being locked to LG's controllers.

> **Status / disclaimer.** This is not official LG documentation and is not affiliated with
> or endorsed by LG. It was derived by analyzing a central controller's own control engine
> and by capturing live traffic on a bus of LG equipment. Field offsets marked below as
> *likely* or *guess* are not guaranteed. Use it on equipment you own or service, at your
> own risk.

**Confidence tags used throughout:**
- **CONFIRMED** — read directly from the controller's firmware code, or observed on the wire.
- **LIKELY** — strongly implied by the code/data but not independently verified.
- **GUESS** — convention only, not yet proven.
- **FIELD-VERIFIED** — reported by an outside party who has successfully replicated the bus on
  live Multi V IV hardware (Nov 2026). Cross-checked against our firmware findings where possible.

---

## 0. Community corrections (FIELD-VERIFIED, Nov 2026)
A reader who has driven real indoor units from a non-LG master supplied the following. Several
items **supersede earlier guesses** here; where they do, the old section carries a pointer up to
this one. One concrete frame they gave — write addr 0x31, on, cool, fan 3, 22 °C:
`80 00 A0 31 03 30 07 DE` — checksum-validates with our own `(sum mod 256) XOR 0x55`, which
independently confirms both the checksum and the setpoint encoding below.

**Frame header (request byte 0).** Byte 0 is a *command header*, not a fixed marker:
`bit7 = request`, `bits3-6 = command number`, `bit2 = +0.5 °C`. So `0x80` = cmd 0
(status/control), `0xA0` = cmd 4, `0xF0` = cmd 14 (ODU page query). **Byte 2 is always `0xA0`
and is NOT the command number.**

**Write strobe + setpoint in the basic frame.** Request `byte4 bit1 = EXE` (write strobe):
clear = read, set = bytes 4–6 are applied. When writing: power = `b4 bit0`, mode = `b5 bits0-2`,
fan = `b5 bits4-6`, **setpoint = `b6` = °C − 15** (so 22 °C → `0x07`; half-degree rides the
`bit2` of byte 0). This means the plain 8-byte cmd 0 frame **does** carry the setpoint — it is the
safe way to set temperature. (Supersedes §4a's "b6 is not the setpoint" and the cmd5-only story.)

**16-byte reply — on-the-wire layout.** `[0]` length `0x10`; `[1]` flags (`bit0` on, `bit7`
+0.5 °C); `[4]` address; `[5]` error code (plain decimal — `0x68` = 104, not BCD); `[6]` mode
(bits0-2) + fan (bits4-6); `[7]` setpoint − 15 (low nibble); `[8]/[9]/[10]` room / pipe-in /
pipe-out; `[11:12]` indoor EEV position (little-endian), **not** temps; `[14]` system/ODU group
id. (Supersedes the §4e offsets, which were read from the ACP's *parsed struct*, not the wire —
Cortex reads the wire, so it uses this layout.)

**Temperatures:** `°C = (192 − code) / 3`. Matches LG's own readout ~99 % of the time, within
1 °C otherwise (the real table bends slightly at the extremes).

**Who answers:** you are **not** talking to the indoor unit — the **main ODU answers for every
IDU on its system from a cached copy**. Power the main ODU off and that whole system goes silent.
A reply reflects the ODU cache, so a command shows up immediately; re-read ~15 s later to see what
the unit actually accepted. Group IDUs by reply `[14]`: within one sweep it's the same for every
IDU on a system.

**Discovery:** there is **no special discovery frame**. Sweep cmd 0 *reads* (EXE clear, bytes
4–6 zero) across addresses 0–255 with about a 1 s timeout; unused addresses simply don't answer
(silence is the only "no").

### ⚠ Safety — do not skip this
- **Don't be a second master.** If an ACP or AC Smart is on the bus, **only listen**. Two masters
  collide and you corrupt its polling.
- **Some "polls" are writes.** cmd 4 (`0xA0`), cmd 5 (`0xA8`) and cmd 9 (`0xC8`) **cannot be sent
  read-only — even an all-zero payload overwrites stored settings.** cmd 4 also wipes the central
  controller's per-unit settings, and the reply won't show what was there before. For blind
  discovery stick to **cmd 0 with EXE clear**, or cmd 14 with bytes 5 and 6 zero.
- **Never use address `0xFF`** — it is a broadcast to every ODU.

Cortex implements all three guards: discovery only emits cmd 0 reads, it refuses to blind-sweep a
write command, and it never addresses `0xFF`.

---

## Contents
1. [Physical bus](#1-physical-bus)
2. [How a frame is built (checksum)](#2-how-a-frame-is-built-checksum)
3. [Temperature encoding](#3-temperature-encoding)
4. [Frame types](#4-frame-types)
   - [4a. Basic state frame (8 bytes)](#4a-basic-state-frame--8-bytes)
   - [4b. Setpoint command "cmd5" (16 bytes)](#4b-setpoint-command-cmd5--16-bytes)
   - [4c. Control command "cmd4" + locks](#4c-control-command-cmd4--locks)
   - [4d. Control command "cmd6" (16 bytes)](#4d-control-command-cmd6--16-bytes)
   - [4e. Unit response / telemetry frame](#4e-unit-response--telemetry-frame)
   - [4f. Poll / roll-call frames](#4f-poll--roll-call-frames)
5. [Mode, fan, and lock codes](#5-mode-fan-and-lock-codes)
6. [Error codes (CHxx)](#6-error-codes-chxx)
7. [Data model](#7-data-model)
8. [Open questions](#8-open-questions)
9. [How to capture real frames yourself](#9-how-to-capture-real-frames-yourself)

---

## 1. Physical bus
- The indoor / central-control bus is **RS485, 4800 baud, 8 data bits, no parity, 1 stop bit
  (4800 8N1)**. *CONFIRMED on the wire AND in firmware.*
- **Baud is set in firmware** by `rs485_open()` (comm daemon): it writes termios `c_cflag`
  with a per-port-type baud. The supported speeds are exactly the standard termios set —
  **B1200, B4800, B9600, B38400** (B19200 also selectable). There is **no 3600** — it is not
  a valid termios baud and the hardware cannot be set to it. For the LGAP AC port the code
  selects **B4800** (`c_cflag = 0x8b0 | 0x0C` = CLOCAL|CREAD|CS8|B4800).
- A controller maps each physical channel to a protocol in its config (`/mnt/flash/config.ini`;
  ch1 = `/dev/ttymxc2`). LGAP runs on the AC/AHU channels. *CONFIRMED.*
- Chillers and water systems use **MODBUS** on a *separate* channel at **9600 8N1**
  (`rs485_open_modbus`, config `MOD_PORT.BAUDRATE='9600'`, protocol `LGMODBUS`). Different
  protocol, different wires — do not mix it with the indoor LGAP bus. (A 9600 reading on the
  wrong channel is the likely source of any "it's not 4800" confusion.)

Every indoor unit has a **bus address** (one byte). Commands are addressed to a single unit;
the controller also broadcasts state and polls the bus to discover who is present.

## 2. How a frame is built (checksum)
Every LGAP frame ends in a checksum. The algorithm (CONFIRMED) is:

```
checksum(buf, n) = ( (sum of bytes buf[0 .. n-1]) XOR 0x55 ) & 0xFF
```

That's it: add up the bytes before the checksum, XOR with `0x55`, keep the low 8 bits. The
16-byte command frames carry **two** checksums (see cmd5 below) — one over the first 14
bytes and a second, `+1`, over the first 15.

## 3. Temperature encoding
Temperatures on the wire are **Celsius with 0.1° resolution** (Fahrenheit is display-only in
the controller). A temperature is split into a whole part and a tenths part:

- **Whole °C** lives in a byte masked with `& 0x7F` (low 7 bits). The top bit (`0x80`) of a
  limit byte means "add 0.5°".
- **Tenths** (0–9, i.e. ×0.1 °C) are packed a nibble at a time — e.g. cmd5 byte 12 is
  `(cool_tenths << 4) | heat_tenths`.

Worked example (from cmd5): cool **23.5 °C**, heat **20.0 °C** →
whole bytes `0x17` (23) and `0x14` (20), tenths nibble byte `0x50` (cool .5, heat .0).

**Sensor readings (room / pipe) use a different encoding** — not the limit/setpoint format above.
A sensor byte decodes as **`°C = (192 − code) / 3`** (FIELD-VERIFIED, §0), accurate to ~1 °C.
Setpoints in a cmd 0 frame are the simple **°C − 15** form (§0/§4a).

## 4. Frame types
LGAP is a set of numbered commands (cmd4, cmd5, cmd6, cmd7, …). A single indoor unit is
driven by **more than one** frame type: a lightweight state broadcast plus heavier per-unit
control frames.

### 4a. Basic state frame — 8 bytes
*CONFIRMED on the wire.*
```
80 00 A0 addr b4 b5 b6 ck
  80   : frame marker for the basic state broadcast
  addr : target unit address
  b4   : bit0 = power (1 = on)
         bit1 = "change" flag (controller sends 03/02 once, then settles to 01/00)
  b5   : HIGH nibble = FAN  (see §5)
         LOW  nibble = MODE (see §5)
  b6   : setpoint = °C − 15 on a WRITE (EXE set); e.g. 22°C → 0x07. Half-degree = byte0 bit2.
         On a read, or a power/mode/fan-only write, preserve the last-seen value.
  ck   : checksum(frame, 7)
```
This is the controller's state/control frame (cmd 0). **Correction (FIELD-VERIFIED, §0):** earlier
this doc said b6 was "not the setpoint." It is — a cmd 0 write carries the setpoint in b6 (°C − 15),
and `b4 bit1` is the **EXE write strobe** (clear = read, set = apply bytes 4–6). In this frame `b4
bit1` is *not* a lock bit (locks live in the cmd4 control frame, §4c) — do not confuse the two.

### 4b. Setpoint command "cmd5" — 16 bytes
*CONFIRMED — read from the firmware builder `CopyControlData_to_sendControlacCmd5`.* This is
the main setpoint/mode command.
```
[0]  A8            frame marker for cmd5  (basic frame = 80; cmd5/cmd6 = A8)
[1]  00
[2]  A0
[3]  addr          unit address
[4]  10            cmd5 sub-id
[5]  flags         bit0 = power ON; remaining bits carry mode/lock state
[6]  cool lower limit  ┐
[7]  cool upper limit  │  each byte: (byte & 0x7F) °C, + 0.5° if top bit (0x80) set
[8]  heat lower limit  │
[9]  heat upper limit  ┘
[10] cool setpoint, whole °C   (& 0x7F)
[11] heat setpoint, whole °C   (& 0x7F)
[12] (cool_tenths << 4) | heat_tenths     tenths = ×0.1 °C
[13] reserved / mode          (set 0 until proven)
[14] checksum(buf, 14)                 = (sum[0..13] ^ 0x55) & 0xFF
[15] (checksum(buf, 15) + 1) & 0xFF    = ((sum[0..14] ^ 0x55) + 1) & 0xFF
```
Key points:
- **Two checksums** — byte 14 over the first 14 bytes, byte 15 over the first 15 bytes **+1**.
- Cool and heat setpoints are stored **separately** — dual-setpoint ("twoset") is native to
  the protocol, not a controller add-on.
- Verified round-trip: cool 23.5 / heat 20 →
  `A8 00 A0 A7 10 01 95 99 12 16 17 14 50 00 84 01`.

### 4c. Control command "cmd4" + locks
*Builder `FindAcCmd4SendData`.* A control command with marker **A0 / A4** (not 80). This is
where the function **locks** live.

`byte4` carries the lock bits — set when a lock is ON, cleared when OFF. Bit mapping
(high confidence, from the firmware's column order and struct offsets):

| Bit  | Mask   | Meaning          |
|------|--------|------------------|
| bit3 | `0x08` | **MODE lock**    |
| bit2 | `0x04` | **FAN lock**     |
| bit1 | `0x02` | **SET-TEMP lock**|
| bit0 | `0x01` | power on         |

Important: these lock bits belong to the **cmd4 (A0/A4)** control frame, **not** the 8-byte
`80` state frame — where the same bit1 position is the "change" flag. The two frames are
different; lock bits must never be OR'd into the `80` frame (it would corrupt the change
flag). Transmitting locks therefore requires sending a cmd4 frame; its full header has not
yet been confirmed on the wire (see §8).

### 4d. Control command "cmd6" — 16 bytes
*Builder confirmed.* A second per-unit control frame, a sibling of cmd5: same **A8** marker,
same limit encoding in bytes 6–9, same whole/tenths temperature bytes 10–12, and the same
dual checksum. The controller tracks `exe_cmd5` and `exe_cmd6` as **separate** pending
actions per unit, so a unit can have a cmd5 *and* a cmd6 queued at once. cmd5 is the
setpoint/mode command; cmd6 appears to carry occupancy / setback / sensor-affect settings
(based on the surrounding fields and `affect='SENSOR'` / occupancy data). The exact split of
which field belongs to cmd5 vs cmd6 is still being pinned down; both are sent the same way.

### 4e. Unit response / telemetry frame — DECODED FROM FIRMWARE
> **Correction (FIELD-VERIFIED, §0):** the offsets below were read from the ACP's *parsed
> struct*, which is **not** the on-wire byte order. For decoding raw bus bytes (what Cortex does)
> use the **on-wire layout in §0** — `[5]` = error, `[6]` = mode+fan, `[7]` = setpoint−15,
> `[8/9/10]` = room/pipe-in/pipe-out, `[11:12]` = EEV, `[14]` = system group. The struct view
> below is kept for reference against the firmware.

The AC reply parser `ProcessRxDataFromAC` (control engine) gives the ACP's internal struct layout
of the **16-byte** indoor-unit reply.

**Integrity (CONFIRMED):** `ProcessRxDataFromAC` validates the reply with
`byte[15] == ap_mkchksum(buf, 15)`, i.e. the reply checksum is the **same family as commands**:
**byte[15] = (sum of bytes [0..14]) XOR 0x55**. It is *not* a CRC-16. (A CRC-16/XMODEM does
exist at a lower packet layer — `CheckRecvPacket` on the 64-byte transport packet — but the
AC reply itself is sum-XOR-0x55 at [15]. Validate AC replies that way.) A reply that fails the
checksum triggers an `rs485_tcflush` and is dropped; a short/absent reply = "No Response".

**Field map (CONFIRMED — byte offsets within the 16-byte reply):**

| Byte | Field | Decode |
|------|-------|--------|
| 0 | frame header | reply marker |
| 1 | flags / locks | bit2 (0x04) tested as a lock bit |
| 2–3 | header | |
| **4** | **unit address** | the responding unit's address (reply's address lives at [4], not [3]) |
| **5** | **set temp** | whole °C; the value **0xAD is a sentinel** meaning "none", normalized to 0 |
| **6** | **mode** | **low 3 bits**: 0 cool · 1 dry · 2 fan · 3 auto · 4 heat (same codes as §5) |
| **7** | **fan + flag** | **low nibble = fan** (1 low · 2 med · 3 high, §5); **bit7** is a separate flag (swing / fan-auto) |
| **8** | **room temp** | raw sensor index → °C via a calibration table built by `InitRoomTemp` (table is static float literals in the control binary; not yet extracted — show raw or calibrate from a capture) |
| **9** | **pipe inlet temp** | raw → same table family |
| **A** | **pipe outlet temp** | raw → same table family |
| **B–C** | 16-bit value | `(byte[C] << 8) | byte[B]` — capacity or EEV step |
| D | byte field | (capacity / level) |
| E | byte field | likely `err` (→ CHxx, §6) |
| **15** | **checksum** | `(sum[0..14]) XOR 0x55` |

So **mode, fan, and set temp decode exactly today** (bytes 5/6/7). **Room and pipe temps**
need the `InitRoomTemp` calibration table (next extraction) or a quick on-site calibration
(note the stat's room reading, compare to byte[8]).

### 4f. Poll / roll-call frames
On a bus with **no** indoor units answering, a controller just calls roll. Those sweep
frames (long runs of `FF`, and headers like `FE BF… / 36 7E… / F0 FC… / 3E 7E…`) are
**polls, not commands** — they do not match the command formats above. A real setpoint
command only appears on the wire when a real unit is present to receive it.

## 5. Mode, fan, and lock codes
*Mode/fan CONFIRMED from the firmware converter that maps the controller's mode string to a
wire code.*

**Mode** (low 3 bits of the mode field):

| Mode | Code |
|------|------|
| Cool | 0 |
| Dry  | 1 |
| Fan  | 2 |
| Auto | 3 |
| Heat | 4 |

**Fan speed** — the controller stores fan as tokens `fan1`…`fan6`; the **digit is the
speed code**:

| Fan   | Code |
|-------|------|
| Low   | 1 |
| Mid   | 2 |
| High  | 3 |
| (higher for multi-speed units) | 4–6 |
| Auto  | separate "AUTO" token (numeric value not yet read) |

> Watch out: the controller also has mode **string** tables (COOL/HEAT/AUTO in enum order
> 0/1/2) used for its UI/database. Those are **not** the wire codes — use the table above.

**Locks** — bits in the cmd4 control frame; see §4c.

## 6. Error codes (CHxx)
> **Note (FIELD-VERIFIED, §0):** on the wire the error is **reply byte 5**, a **plain decimal**
> code (not BCD) — the same number shown on the unit. Examples reported from the field:
> **104** = main ODU lost its sub-unit, **204 / 206** = HR-box comm error / duplicate HR address.
> Use the service manual for the specific model; the `CHxx` table below is the common convention.

`err` in a reply is a raw number; LG's standard `CHxx` labels map as follows (the common
set; not exhaustive):

| Code | Meaning |
|------|---------|
| CH01 | Indoor air / remote sensor |
| CH02 | Indoor pipe (inlet) sensor |
| CH03 | Remote controller comms |
| CH04 | Condensate drain / float |
| CH05 | Indoor ↔ outdoor comms lost |
| CH06 | Indoor pipe (outlet) sensor |
| CH07 | Mode conflict |
| CH09 | Indoor PCB EEPROM |
| CH10 | Indoor fan motor comms |
| CH21 | Inverter overcurrent (IPM) |
| CH22 | DC link over-voltage |
| CH27 | High-pressure trip |
| CH53 | Address duplication / comms |
| CH150 | Discharge superheat |
| CH151 | Pressure difference low |
| CH200 | Auto pipe search failed |
| CH242 | No reply at this address (unit offline / not present) |

## 7. Data model
The controller keeps unit state in an SQLite `ac` table. Two shapes exist:

- **Monitor / live:** `ac(Address, ProductType, StartStop, Lock, Mode, FanSpeed, Affect,
  Swing, SetTemp, FilterSign, UserMode, RoomTemp, Alarm)` — `Mode` and `FanSpeed` are the
  INTEGER wire codes from §5.
- **Control / engine:** `addr, mode, fan, swing, lock, modelock, fanlock,
  templock/settemplock, settemp, settemp_llim/ulim, cool_settemp, heat_settemp,
  cool_upper/lower, heat_upper/lower, deadband, twoset_automode, twoset_avail, occupied,
  occ_cool_settemp, occ_heat_settemp, occ_mode/fan/oper, occ_sensor_avail/val, peak_mode,
  exe_cmd5, exe_cmd6, oper, affect, roomtemp, pipe_intemp/pipe_outtemp, abs`.

To command a unit, the engine sets `exe_cmd5='ON'` (with a repeat count) on that address,
then builds and sends the cmd5 frame. In other words, `exe_cmd5` means "a setpoint/mode
command is pending for this unit."

## 7b. Master / central-controller operation (how the ACP drives the bus)
*From the comm daemon: `SendPacketID`, `SetSendPacket`, `WriteCommBlock`, `ReadCommBlock`,
`CheckRecvPacket`, `rs485_*`.* The ACP is the **single bus master** — it addresses one unit at
a time, sends, then waits for that unit's reply. Nothing else may drive the bus; to take over,
the original ACP must be physically disconnected.

Per-unit transaction (`SendPacketID(id, addr, cmd, …)`):
1. **Build** the outgoing packet for that unit — a **64-byte** slot. `SetSendPacket` writes the
   **address into byte [3]**, command nibbles into [6] (high)/[7]/[8], and lays the buffer out
   as blocks: three 16-byte command blocks (each ending in the sum-XOR-0x55 `+1` checksum, §2)
   plus a trailing **32-bit CRC** over the first 60 bytes in bytes [60..63] (`gen_crc_table`/
   `update_crc`).
2. **Transmit** the packet (`WriteCommBlock` → `rs485_tx1`/`writen`).
3. **Turnaround delay**, then **read the reply** (`ReadCommBlock` → loops `rs485_rx1` until it
   has bytes or hits a per-try limit). The reply is expected to be **exactly 16 bytes**; fewer
   = "No Response! From ID". `SendPacketID` in the slow/probe path even does a full `sleep(1s)`
   between write and read — discovery is deliberately unhurried.
4. **Validate** the 16-byte reply — AC replies use `byte[15] = (sum[0..14]) XOR 0x55` (see §4e). A valid,
   non-zero reply means the unit exists and carries its telemetry.

Discovery = run that transaction across the address range; every address that returns a valid
16-byte reply is a present unit. There is also `SendBroadCastStream` (broadcast) and
`SendGroupsPacket` (group) for non-addressed sends.

Timing notes (the practical part): RS485 is half-duplex, so the master must finish sending,
let the line turn around, then listen. The firmware has a configurable **packet delay (default
20 ms)** and reads the reply with its own timeout/retry loop rather than a fixed wait. In
practice on a USB-RS485 adapter you need a short inter-frame gap and a generous read timeout
(tens to a few hundred ms) — too short and you miss the reply (the "set delay to 150 ms so
bytes could be received" symptom); plenty long is fine because the master sets the pace.

## 8. Open questions
- **AUTO fan code** — the "AUTO" fan token's numeric wire value hasn't been read.
- **cmd5 byte 13** (reserved/mode) — set to 0 until its purpose is confirmed.
- **cmd4 header for lock transmit** — the lock→bit mapping (§4c) is known, but the full
  A0/A4 cmd4 frame header needs one real capture before locks can be transmitted safely.
- **cmd6 vs cmd5 field split** — which fields belong to which command.
- **cmd7 (AHU)** — the AHU command frame is not decoded.
- **Obedience** — **ANSWERED (FIELD-VERIFIED, §0):** indoor units *do* act on a non-LG master.
  Every field takes on the first send; read addr 0x31 = `80 00 A0 31 00 00 00 04`, write on/cool/
  fan3/22 °C = `80 00 A0 31 03 30 07 DE`. Re-read ~15 s later to see what the unit accepted.
- **Discovery** — **ANSWERED (§0):** no special frame; sweep cmd 0 reads, silence = absent.
- **Setpoint on the wire** — **ANSWERED (§0):** cmd 0 byte 6 = °C − 15; use it instead of cmd 5
  for ordinary temperature changes.

## 9. How to capture real frames yourself
With root access to an LG ACP controller, raw frame logging is **built in**:

- The control engine logs every indoor/outdoor packet as hex to `/mnt/flash/idu_log.log`
  and to the serial console `/dev/tty0` (look for markers `===got odu->idu packet==` /
  `===got idu->odu packet==`).
- It is gated by a flag file: `/mnt/flash/485log.sys` must **contain the value `1`** (an
  empty/`touch`ed file is off). The flag is read at engine startup.

```sh
echo 1 > /mnt/flash/485log.sys     # enable (must be the digit 1, not an empty file)
# the flag is read at engine start — restart the control process or reboot, then
# change ONE unit / ONE setting (e.g. set cool 72) from the controller's UI/schedule
tail -n 200 /mnt/flash/idu_log.log # the cmd5/cmd6 frame it sent
rm /mnt/flash/485log.sys           # disable logging
```

That shows the real frame the controller sends — the cleanest way to confirm headers,
mode/fan nibbles, and lock bits. Alternatively, at a live site, change one setting at a time
on the controller and capture the bus with any RS485 sniffer at **4800 8N1** (commands are
A8-marked).

---

*Derived from static analysis of an LG central-control engine image and live-bus captures.
Corrections and additions welcome.*
