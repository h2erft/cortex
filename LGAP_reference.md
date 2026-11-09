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
  (4800 8N1)**. *CONFIRMED on the wire.*
- A controller maps each physical channel to a protocol in its config. LGAP runs on the
  AC/AHU channels. *CONFIRMED.*
- Chillers and water systems use **MODBUS** on a *separate* channel (typically 9600 or
  19200 8N1). That is a different protocol on a different pair of wires — do not mix it with
  the indoor LGAP bus.

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
  b6   : NOT the setpoint — a separate field; preserve the last-seen value
  ck   : checksum(frame, 7)
```
This is the controller's state broadcast. It carries power/mode/fan only — **not** the
setpoint. Note that in this frame `b4 bit1` is the *change* flag, **not** a lock bit (locks
live in the cmd4 control frame, §4c) — do not confuse the two.

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

### 4e. Unit response / telemetry frame
When a unit replies, the controller decodes it into these fields (the order the firmware's
monitor-update writes them):

`mode, fan, swing, lock, settemp, roomtemp, oper, exe, err, affect, louverdirec (swing
position), modelock, fanlock, settemplock, settemp_llim, settemp_ulim, limit_exe,
pipe_intemp, pipe_outtemp, lev (EEV step), capa, capa_sum` — plus `oil_alarm` and `filter`
on some unit types.

So a reply is **full telemetry**: room temperature, both pipe temperatures, EEV level,
capacity, error code, filter sign, and current mode/fan/lock state.
- mode / fan / lock values decode with the **same codes as the command side** (§5).
- Temperatures almost certainly use the command-side encoding (§3): `roomtemp` to 0.1°,
  pipe temps as whole °C.
- `err` is a raw number; the `CHxx` labels (§6) are the standard LG mapping.

The exact byte **offsets** of this frame live one layer down in the receive parser and are
best pinned from a single real reply capture (§9) rather than more static analysis.

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

## 8. Open questions
- **AUTO fan code** — the "AUTO" fan token's numeric wire value hasn't been read.
- **cmd5 byte 13** (reserved/mode) — set to 0 until its purpose is confirmed.
- **cmd4 header for lock transmit** — the lock→bit mapping (§4c) is known, but the full
  A0/A4 cmd4 frame header needs one real capture before locks can be transmitted safely.
- **cmd6 vs cmd5 field split** — which fields belong to which command.
- **cmd7 (AHU)** — the AHU command frame is not decoded.
- **Obedience** — the one thing static analysis can't answer: whether a real indoor unit
  actually acts on a cmd5 sent by a third-party controller. Needs one real-site transmit
  test with the original controller disconnected.

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
