# What the outside LGAP reference kit tells us — digest for Cortex

*Written 2026-11-14. Audience: whoever works on Cortex next.*

The operator was given a large reverse-engineering kit for LG Multi V buses by an outside
collaborator: ten bus chapters, a nine-chapter firmware-decode method guide, ~30 Python tools with
tests, lookup tables and sample captures. **The kit is not in this repo and must not be committed
here** (this repo is public and the kit is someone else's work). Ask the operator to attach it when
you need the originals. This file is our own digest: what in it matters to Cortex, what has already
been folded into the code, and what has not.

Confidence words are the kit's own: **Field-verified** (seen on live equipment), **Verified**
(checked another way), **Likely**, **Candidate** (unproven).

Chapter names used below: 01 bus overview · 02 module link (LGMV service UART) · 03 indoor A/B bus ·
04 CEN/LGAP · 05 control and safety · 06 unknowns · 07 firmware versions · 08 LGMV software ·
09 LGMV modules · 10 Multi V 5 records.

---

## 1. The big picture (ch.01)

A Multi V system is several separate serial buses. Cortex speaks exactly one of them.

| Bus | Wire | Speed | Framing | Cortex |
|---|---|---|---|---|
| **CEN / central control (LGAP)** | RS-485 pair on the ODU terminal board | 4800 8N1 | 8-byte requests, 9/16/64-byte replies, checksum = sum XOR 0x55 | **This is Cortex's bus** |
| Indoor A/B (ODU ↔ indoor units, HR boxes) | RS-485 pair | 9600 8N1 | `0x56` envelope, 4-byte addresses, key/value items, CRC-16/XMODEM | not spoken |
| Module link (LGMV service port) | 4-pin logic-level header on the ODU main board | 2400 8N1 | `02 <len> <type> …`, CRC-8 (CRC-16 on two types) | `uart-sniffer.html` listens raw only |
| ODU A/B (main ↔ sub outdoor units) | RS-485 pair | 1200 8N1 | `02 len type` | not spoken |
| Wired remote | single wire | ~104 bps | 13-byte frames | not spoken |

Facts worth remembering:
- **The main outdoor unit answers on CEN for itself and for every indoor unit.** A reply about an
  indoor unit is the ODU's cached copy, not a live read of that unit. (Field-verified)
- CEN carries **no heat-recovery-box data**. That lives on the module link and the indoor A/B bus.
- Two masters on one RS-485 pair corrupt each other. If a real LG central is polling, listen only.

## 2. CEN frames — what Cortex had right, and what changed in v1.6.0-beta.6 (ch.04)

The command number is in **byte 0 bits 3–6**: `0x80` cmd0, `0xA0` cmd4, `0xA8` cmd5, `0xB8` cmd7,
`0xC8` cmd9, `0xF0` cmd14. Byte 2 is always `0xA0` (a routing marker, not the command).

### cmd0 — status read and control (`80 00 A0 addr b4 b5 b6 ck`)

| Byte | Bits | Meaning | In Cortex |
|---|---|---|---|
| 0 | bit 2 | +0.5 °C | yes |
| 4 | bit 0 | power | yes |
| 4 | bit 1 | **EXE** — set = write, clear = read (a write with EXE clear is ignored) | yes |
| 4 | bit 2 | **remote-controller lock** = Cortex's "Hard lock" | yes (beta.3) |
| 5 | bits 0–2 | mode: 0 cool, 1 dry, 2 fan, 3 auto, 4 heat | yes |
| 5 | bit 3 | **swing** | **fixed in beta.6** (was never sent) |
| 5 | bits 4–6 | fan: 1 low, 2 med, 3 high, **4 auto**, 5 quiet, 6 power | **4 added in beta.6**; 5/6 display-only |
| 5 | bit 7 | **filter-sign reset, one-shot** | never set; **stripped from replayed bytes in beta.6** |
| 6 | low nibble | setpoint − 15 °C | yes |

Behaviour notes (Field-verified unless marked):
- The reply to a write already shows the new values — **that is the ODU's cache**. The unit's own
  values can replace them seconds later. Verify a write **at least 15 s** after sending.
- Units enforce **18–30 °C**. A lower setpoint is echoed once, then corrected.
- Auto is commanded as mode 3. A unit **reports 3 on its cooling side and 7 on its heating side** —
  both mean "Auto". (Verified)
- Mode 5 is not a normal mode; 6 and 7 are accepted with unknown meaning. Don't command them.
- Fan 0 is rejected. Fan 5/6 acceptance differs by model.
- There is **no second (heat) setpoint in cmd0**. Dual setpoint rides cmd5.

### The 16-byte indoor-unit reply (`10 flags A0 type addr err mode set room pin pout eevL eevH cap load ck`)

| Byte | Meaning | In Cortex |
|---|---|---|
| 1 | bit 0 power · bit 1 connected · **bit 2 remote lock** · bit 7 +0.5 °C | yes |
| 3 | unit type / source byte (meaning open) | stored as `utype`, not shown |
| 5 | error code, plain decimal | yes |
| 6 | mode (0–2) · swing (3) · fan (4–6) · bit 7 is *not* a reliable filter flag | yes (swing new in beta.6) |
| 7 | low nibble + 15 = setpoint °C | yes |
| 8, 9, 10 | room, pipe-in, pipe-out: °C = (192 − code) / 3 (a close fit to the unit's real table) | yes |
| 11–12 | **indoor EEV position, pulses, little-endian** (about 40 = closed) | **shown from beta.6** |
| 13 | **capacity, kBtu/h** (7, 12, 15, 18, 24, 28, 36 seen) | **shown from beta.6** |
| 14 | system-load value — the same for every indoor unit on one outdoor system *in the same sweep* | stored (`sysLoad`); grouping not built yet |

### cmd4 — dimension locks and setpoint limits (`A0 00 A0 addr b4 b5 b6 ck`)

- b4 bit 1 = setpoint (temp) lock, bit 2 = fan lock, bit 3 = mode lock — matches Cortex's own live
  decode of 2026-11-13.
- **b5 and b6 are the lower and upper setpoint limits**: lower = (b5 low nibble) + 15 °C with b5
  bit 7 always set, upper = b6 + 15 °C. (Field-verified.) Whether it is one band for every mode is open.
- Reply is **9 bytes**: `09 20 A0 type addr r5 r6 r7 ck`, r5 = b4 with bit 0 cleared, r6 = b5 low
  7 bits, r7 = b6. It mirrors what was just sent; it does **not** reveal what was there before.
- **There is no read-only cmd4.** Even an all-zero cmd4 overwrites the ODU's staged lock/limit
  bytes for that unit and sets/clears a per-unit flag from header bit 2 (`A0` vs `A4`). A real
  central re-sends cmd4 right after each cmd0, per unit, about every 90 s.
- The ODU forwards a changed cmd4 to the indoor unit within about a second (ch.03).
- **The dimension-lock state cannot be read back over CEN.** Only the hard lock can (reply byte 1
  bit 2). On the indoor A/B bus the unit reports it in key `193`.

### cmd14 — outdoor-unit pages (`F0 C0 A0 odu page 00 00 ck` → 64 bytes `40 70 A0 C0 odu page …`)

- **Bytes 5 and 6 must be 0.** Non-zero byte 5 is stored as an action selector (`0xAA` triggers a
  diagnostic action); byte 6 bits drive oil return. Address `0xFF` is every ODU — never use it.
- Even the zero form clears a central's oil-return override if one was set (harmless when Cortex is
  the only master).
- Page 0 = main unit; request 1 or 2 → reply page 2 = first sub unit; 3, 4 = more subs; 5 = fault
  table; 0x30–0x3C = indoor-unit inventory (type/address pairs) — **not used by Cortex yet**.
- Byte map (Multi V IV, family byte 7 = `0x0E`): 8/9 firmware major/minor · 10 error · 11/12 target
  high/low pressure · 15 mode + sub count · 16–19 inverter target/actual Hz · 20/21 fans ·
  22 outdoor air · 23/24 high/low pressure · 25 suction · 26/27 discharge · 28 liquid pipe ·
  32/33 subcooler in/out · 34–39 EEVs (×8 pulses) · 40–45 currents/voltages · **53 connected
  indoor-unit count** · 58–61 flag bits. Sensor bytes go through 256-entry lookup tables
  (embedded in `cortex.html` as `ODU_T`). Cortex's `decodeOduPage()` is a port of the kit's decoder
  and is tested byte-for-byte against the kit's own output.
- Space ODU queries about a second apart. (Candidate)

### Frames that look like reads but are writes (ch.04 §5, ch.05 §4)

| Frame | Verdict |
|---|---|
| cmd0, EXE clear | read-only |
| cmd14, bytes 5–6 zero, one address | read-only (see oil-return caveat) |
| cmd4 (`A0`/`A4`) | **always a write** |
| cmd5 (`A8`), any length | **always a write** |
| cmd7 (`B8`), cmd9 (`C8`), the 13-byte `0D` frame | **always a write** — Cortex never sends these |
| anything to address `0xFF` | broadcast to every ODU — never |

### How a real LG central behaves (AC Smart IV, passively observed)

- cmd0 to every indoor address about **every 90 s**, cmd4 right after it. ODU pages 0, 2, 5 every
  few minutes. A zero-payload cmd9 to every ODU about every 530 s. Device-type polls `80 A3`,
  `80 B0`, `80 B2` that nothing answers on an indoor-only chain.
- **Correction to our own notes:** on 2026-11-13 we concluded the appliance bridge was "dropping
  ~70 % of bytes" because a two-minute capture held ~15 KB. That was wrong. The bus simply is not
  busy — a central talks to each unit once per ~90 s, so ~130 bytes/s is the real traffic. The
  "missing" lock frames were never sent as one-shots; the central just changes cmd4 byte 4 on that
  unit's next 90-second visit.

## 3. Error codes seen on CEN (ch.04 §9)

Plain decimal in the indoor reply byte 5 and ODU page byte 10.
104 = main ODU lost its sub unit · 204 = HR-box communication error (every unit behind that box
shows it, then powers off) · 206 = duplicate HR-box address · 53 = probably indoor↔outdoor comms
loss (Candidate). The ODU's own display shows `10 × fault + (chassis slot + 1)`, so the last digit
says which chassis (1 main, 2 first sub…).

## 4. The other buses — what the kit gives us for later

- **Module link / LGMV port (ch.02, 08, 09).** 2400 8N1, frames `02 <len> <type>`, CRC-8 with
  reflected polynomial 0x85 (CRC-16/XMODEM on types 0x65/0x66). The PC sends two harmless 14-byte
  requests (`02 0E 01…` hello, `02 0E 02…` "next cycle"); the ODU answers a cycle about every
  6.5 s: 0x65 main ODU, 0x66 sub ODU, 0x69 summary, 0x6A one per indoor unit, 0x6E one per HR box,
  0x6B end. Unpolled, it beacons a product frame 0x64. The kit maps these and ships the same
  lookup tables. **This answered our "UART frontier" question** — `uart-sniffer.html` got a real decoder
  from it in v1.6.0-beta.7 (see `docs/UART_SERVICE_PORT.md`), tested against the kit's own decoder.
  LGMV's "IDU Control" Start/Stop writes a byte for *every* indoor unit — never press it on a live
  site. ODU-control frames (compressor/fan/EEV overrides) have no release frame: bench only.
- **Indoor A/B bus (ch.03).** The only place HR-box data, the real dimension-lock readback (key
  `193`), fan running step (`1C4`) and installer settings live. Needs a second adapter at 9600.
- **Firmware versions (ch.07).** ODU firmware major/minor is in ODU page 0 bytes 8/9 — Cortex
  shows it. Multi V IV HR 29.0/30.0/31.0 share the same CEN framing.
- **Firmware-decode guide (separate nine-chapter method guide).** How to turn a vendor image into
  a verified disassembly, identify the chips, and read the configuration EEPROM. Method only — it
  ships no images. Not needed for anything on the current backlog.
- **Multi V 5 (ch.10).** Different record formats; software-profile coverage only. Cortex's ODU
  tables are Multi V IV. Out of scope until a Multi V 5 site exists.

## 5. Safety rules we adopted from ch.05

1. Passive first. Never transmit while another master is on the pair.
2. One unit at a time when trying something new; someone watching the unit.
3. Build every write from a **fresh read** of that unit, changing only the intended field.
4. A reply is not proof (ODU cache) — verify from a later read and at the thermostat.
5. Never cmd5/cmd7/cmd9/`0D`, never cmd14 with non-zero bytes 5–6, never address `0xFF`.

## 6. Known disagreements still open

- **cmd5 (dual setpoint) — RESOLVED on paper 2026-11-14.** Cortex's old `cmd5SetpointBytes()` and
  the kit disagreed on byte 5, the limit order and the commit strobes. Re-reading the ACP's own
  builder (section 7) showed the kit was right on every point; Cortex's builder was rewritten to
  match. It has still never been captured on a wire or sent to a unit, and every unit seen reports
  2-set as unavailable, so it stays behind the armed debug tool.
- **Temp lock semantics.** Bit 1 of cmd4 byte 4 plus the limit band is confirmed on the wire; what
  every indoor model does with it (hard lock of the setpoint vs clamp to the band) is not.
- **Louver direction.** The ACP puts a louver-direction number in the high nibble of cmd4 byte 4
  (section 7). What values mean which vane position is unknown; Cortex sends 0.
- **Hard lock** was confirmed working on site on 2026-11-14; the dimension locks were sent
  correctly from beta.5 but the on-site result for *unlock* was not reported back yet.

## 7. What the ACP's own firmware says (read 2026-11-14)

Independent of the kit: the operator's own ACP control-engine binary (32-bit ARM Linux ELF, not
stripped — **not in this repo**) was disassembled with `tools/armdis.py`. Because every database
column is compared against the strings "ON"/"OFF" and the SQL text names the columns, the frame
builders can be read almost like source. Three builders were read end to end.

**`ap_mkchksum(buf, n)`** — sum of n bytes, XOR 0x55, low byte. (Returns 0x55 for n = 0.)

**`FindAcCmd4SendData` — the cmd4 frame**

| Byte | Built as |
|---|---|
| 0 | `0xA4` if the global `address_lock_flag` is set, else `0xA0` — so header bit 2 = **address lock** |
| 1, 2, 3 | `00`, `A0`, address |
| 4 | **bit 0 always set** (`orr #1` — it is *not* power) · bit 1 = `settemplock` · bit 2 = `fanlock` · bit 3 = `modelock` · **high nibble = `louverdirec`** |
| 5 | `0x80 | (settemp_llim − 15)` |
| 6 | `(settemp_ulim − 15) & 0x0F` |
| 7 | `ap_mkchksum(buf, 7)` |

Cortex changed in beta.6 to always set byte 4 bit 0 (it used to copy the unit's power state).

**`FindAcExeCmd5SendData` — the cmd5 frame** (it sends when `exe_cmd5='ON'` or `exe_cmd6='ON'`
with a retry count of 10)

| Byte | Built as |
|---|---|
| 0–4 | `A8 00 A0 addr 10` |
| 5 | bit 0 = global `cmd5flag` is "ON" (the kit's "2-set auto" flag) · bit 7 = this unit's limits trigger is "ON" → **commit strobe, limits group** |
| 6, 7, 8, 9 | `cool_upper_lim`, `cool_lower_lim`, `heat_upper_lim`, `heat_lower_lim` — whole °C in bits 0–6, bit 7 = +0.5 (the debug print `ac.cool_upper_lim = %s` anchors byte 6) |
| 10 | cool setpoint whole °C · bit 7 = `exe_cmd5` is "ON" → **commit strobe, setpoint group** |
| 11 | heat setpoint whole °C · bit 7 = `occupied` is "ON" |
| 12 | cool tenths << 4 \| heat tenths |
| 14 | `ap_mkchksum(buf, 14)` |
| 15 | `ap_mkchksum(buf, 15) + 1` (a `+2` variant exists in the strings, as the kit says) |

Database defaults in the same binary: cool limits 10.0–37.5, heat limits 4.0–32.0, deadband 2.0,
single setpoint limits 18.0–30.0.

**`FindAcExeSendData` — the cmd0 frame.** Fan strings map to byte 5 high nibble as LOW `0x10`,
MED `0x20`, HIGH `0x30`, **AUTO `0x40`**, LLOW `0x50` (super low); a `SUPHIGH` string exists too.
Byte 4 gets `orr #4` for the remote lock. Agrees with the kit's fan table and with Cortex beta.6.

The same binary's table schemas list per-unit columns `swing`, `lock`, `filter`, `louverdirec`,
`modelock`, `fanlock`, `settemplock`, `settemp_llim`, `settemp_ulim`, `lev`, `capa`, `oil_alarm`,
`twoset_avail`, `occ_sensor_avail`, `remocon_override`, `deadband` — a useful checklist of what the
real controller tracks.

Other functions worth reading next if a question comes up: `ProcessRxDataFromAC` (how the ACP
parses the 16-byte reply), `ProcessRxDataFromACCmd5` (the cmd5 reply), `FindAcCmdESendData` (the
ODU page poll), `ProcessRxDataFromAC_20byte` (a 20-byte reply variant Cortex does not know about).


## 8. Second pass over the LG controller's software (read 2026-11-15)

The file is a raw dump of the controller's `engine/` folder: about 60 programs, a handful of small
databases, shell scripts and Modbus maps. Several programs are damaged in the dump; the main comms
program (`CommProc`) and the address search (`AddressSearch`) are intact with symbols and were
decompiled with Ghidra. **Nothing from the dump is in this repo.**

### 8.1 Outdoor page request bytes 5–6 are a write channel (`FindAcCmdESendData`)

Frame: `F0 C0 A0 <odu> <page> <b5> <b6> ck`. LG's controller fills b5 from a per-unit `exe_index` and b6
from the matching column:

| b5 | b6 is the new value for |
|---|---|
| 0 | nothing (plain read) — except on page 0, see below |
| 1 | `target_high_pressure` |
| 2 | `target_low_pressure` |
| 3 | `target_super_heat` |
| 4 | `target_sub_cool` |
| 5 | `err_clear_unit` |
| 6 | `err_clear_number` |
| 8 (with b6 = 1) | sent on page 0 during the first three minutes after midnight; purpose not established |

On a plain page-0 read, b6 bit 1 is set when `oil_return_by_acs = true` in the controller's config, and
b6 bit 0 is set during the configured `oil_return_hour` (and the hour after) if the unit is not already
in oil return — a scheduled forced oil return.

This names the "action selector" the kit warned about. **Cortex sends `00 00` and must keep doing so.**
The same function counts unanswered polls per outdoor unit and raises error 242 at 31.

### 8.2 cmd9, header `C8` — outdoor "demand" / cycle control (`FindCycleControlExeSendData`)

`C8 C0 A0 <odu> 00 <b5> <b6> ck`, built from table `odu_demand`:

| Byte | Bits |
|---|---|
| 5 | bit 7 `night_LN_flag`, bit 6 `night_LN_oper` (night low-noise), bits 0–3 `ability_enhance_step` |
| 6 | bits 0–4 `target_pressure_step`, bit 6 `add_defrost`, bit 7 `remove_snow` |

The reply (`ProcessRxDataFromODU_demand`) is 16 bytes; the controller reads byte 9 and byte 10's low
nibble and bit 7. The same step values come back in outdoor page 0 bytes 56–57, which Cortex decodes
since beta.6. **Still on the never-send list.**

### 8.3 Outdoor page 5 = fault-detection table (`ProcessRxDataFromODUPage5_fdd`)

Bytes 8–37 are stored in order as: `Total_Error_NUMBER`, `Fdd_Error_TYPE`, `RT_Error_TYPE_1..5`,
`RT_Error_CODE_n_1..3` for n = 1..5 (the middle byte of each triple is printed in hex), then
`Fdd_Module_AD_VALUE_1..8`. The controller stores the numbers without interpreting them, so their meaning
is still open.

### 8.4 Indoor 16-byte reply, bits the kit left open (`ProcessRxDataFromAC`)

- Byte 7 bit 7 → column `filter`; byte 7 bit 4 → column `oil_alarm`. (Kit chapter 06 item 2 listed both
  as unknown.)
- Byte 5 = 0xAD is rewritten to 0 before use.
- Byte 13 → `capa`, byte 14 → `capa_sum`. So the "system load" byte is the controller's name for summed
  capacity, which is why it is shared across one system and drifts.
- Bytes 11–12 → `lev` (EEV), read as one 16-bit value.

### 8.5 Indoor-unit inventory (`AddressSearch` → `ProcessAddressDataFromODU`)

Requests pages 0x30–0x32 with bytes 5–6 zero. For each page: **byte 15 = number of entries in that page**
(rejected if over 22), pairs from byte 16 as (type, address); type < 0x70 updates the indoor table,
0x70–0x7F the ventilator table. Page 0 byte 53 is the connected count. This confirms Cortex's grouping
source and corrected which byte it uses for the per-page count.

### 8.6 Other things the controller does (not explored further)

- It sees 20-byte outdoor↔indoor packets on its bus and logs them (`idu_log.log`).
- `super4_onboarding` pushes `.mot` firmware files to Multi V IV outdoor units; `odu_sync` syncs files to
  the outdoor MICOM. Not something Cortex should ever attempt.
- Feature list visible in table and program names: peak / demand control (rotating units to cap running
  capacity), time-limit control, setback, auto changeover with a dead band, interlock with digital
  inputs/outputs, fire-alarm stop, filter-sign reset, weather fetch, Modbus maps for chillers / AHUs.
- The dump also holds the site's own bus map (128 indoor and 14 outdoor addresses) and daily energy
  tables. Those are site data and were not copied anywhere.


## 9. Re-read of the kit against Cortex (2026-11-15)

| Kit says | Where | Cortex before | Now |
|---|---|---|---|
| Indoor reply bytes 8–10 are the same raw codes as the service-port 0x6A record: room = TBL-AIR, pipes = TBL-PIPE; the straight line is only an approximation | ch.02 §9, ch.04 §3.2 | `(192 − code) / 3` for all three | air / pipe curves (beta.9). LG's controller holds the identical pipe table |
| Space cmd14 requests by a second or more (Candidate) | ch.04 §4.6 | 0.7 s | 1.1 s |
| 0x69 = per-unit communication counters | ch.02 §8 | guessed "setpoint × 2" | relabelled |
| Filter-sign reset = cmd0 byte 5 bit 7 with EXE set and the unit's current settings | ch.05 §1.1 | not offered | **added in beta.10**: staff-only button, shown only while the sign is up, one-shot flag |
| A write's immediate reply is the outdoor unit's cache; verify 15 s later | ch.04 §3.3 | 8 s hold after a command | **15 s from beta.10** |
| Pages 0x33–0x3C list indoor addresses in groups of 13 | ch.04 §4.3 | unused | unused (0x30–0x32 is enough) |
| Page 0 bytes 49–51 look like a power-meter path (Candidate) | ch.06 G2 #9 | not decoded | not decoded |
| A real central polls each indoor unit about every 90 s, sends cmd4 after every cmd0, and a zero cmd9 burst about every 530 s | ch.04 §7 | Cortex polls faster, sends cmd4 only on a lock change, never cmd9 | unchanged, by design |

Kit open questions the controller-software pass (§8) answered: G2 #2 (reply byte 7 bits 4 and 7) and part
of #9 (several page-0 flag bits have names in the controller's `odu_demand` table).

## 10. Remaining kit chapters and Multi V S (read 2026-11-15)

Chapters read this pass: 01 (bus overview), 03 (indoor A/B bus), 05 (all of it), 06 (A and G), 07
(firmware versions), 10 (Multi V 5 records), 02 §5 (product codes, other generations), plus the nine
firmware-analysis chapters (image formats through reading chips). Chapter 08 (LGMV software) and
the bridge part of 09 (LGMV modules, §9) were read; the rest of 09 is hardware detail of LG's two modules
and was skimmed by heading.

### 10.1 What changed in Cortex

| Finding | Source | Cortex |
|---|---|---|
| The LG controller keeps a 22-entry outdoor family table (page byte 7) and picks one of three page parsers from it. One parser serves 0x0E Multi V IV, 0x11, 0x12, 0x13 Water IV, 0x14 Multi V S and 0x15 Multi V 5; 0x0F/0x10 gas heat pump has its own; everything else uses an older one | controller `ProcessRxDataFromODU`, `get_odu_type_text`; kit decoder accepts 0x0E, 0x11–0x14 | `ODU_FAMS` / `oduFam()`; other layouts show a notice instead of numbers |
| Multi V S is one inverter compressor, no sub frames; 024–053 heat pumps have a hot gas bypass valve | LG Multi V S outdoor service manual | `comps:1` hides compressor 2 everywhere on the Cycle page |
| An indoor unit with no fault of its own shows the outdoor unit's code when that code is 21 or more (A/B key `04B`) | ch.03 §11.3 | hint on the error page when several units share such a code |
| The outdoor unit parks an idle indoor valve by direct command at 40 pulses (`062 = 4`); LG's manual gives the same 40 for thermo-off units | ch.03 §11.4; Multi V S manual tables 3 and 5 | already the rule since beta.7 (≤60 pulses = closed by the controller) |

### 10.2 Worth knowing, nothing to change

- **Room temperature on the bus is the unit's control sensor**: return air, or the wall remote's sensor
  when the installer set "Temp Sense Location" that way (A/B key `186` = CEN reply byte 8). A room
  reading that disagrees with a thermometer at the return grille may be a remote-sensor unit.
- Auto readback 3 / 7 is frozen while a unit is off, and an auto unit reads as fan for its first
  25–40 s. Cortex already shows both as Auto.
- At 100 °C discharge the outdoor unit asks every indoor unit to lower its cooling superheat target by
  about 2 K (A/B key `042`), releasing below 95 °C. Indoor valves opening together on a hot day is the
  system protecting the compressor.
- HR boxes change a pipe from cool to heat by going off first and waiting several minutes.
- Service port product codes for Multi V S: `0x32` (1200 or 2400 baud), `0x33`, `0x37`, `0x3A`, `0x38`,
  `0x39`, `0x3B`. Their page layout is a different family from the Multi V IV one the UART page decodes.
- Outdoor firmware 29.0, 30.0 and 31.0 behave the same on the central bus. Version is page 0 bytes 8–9,
  which Cortex already shows.
- Multi V 5 over the service port uses 9600 baud and different records; chapter 10 maps some of them.
  Nothing there applies to the central bus.
- **LG's Wi-Fi service module is a plain TCP pipe**: it makes an open network named `LGE_MV-xx-xx-xx`,
  and the outdoor unit's service stream is at `192.168.1.1:9999`, one client at a time. Without being
  asked, a healthy module sends the short ID frame about four times a second. The kit's own advice for a
  weak or far-away module is a small computer beside the outdoor unit that holds that one session and
  shares it. A Cortex controller with a Wi-Fi radio could be that computer, which would put LGMV-grade
  data (real pressures, HR boxes) on the Cortex screen with no cable to the service port. Not built.
- LGMV-Business "IDU Control" Start/Stop sends a byte for **every** indoor unit, ticked or not, with a
  default of off and 22 °C. Never press it on a live site.
- LG's Modbus gateways are translators onto this same bus, with the same mode numbers. A Modbus face for
  Cortex would be a mapping job, not a protocol job.

### 10.3 Still open for Multi V S

- No capture from a real Multi V S. The family byte, the shared page map and the single compressor come
  from LG's software and manual, not from a wire.
- Whether the sensor curves (pressure, pipe, discharge) are the same tables as Multi V IV.
- Thresholds in the Cycle-page checks and the rule-based diagnosis are Multi V IV values.
- Multi V S heat recovery uses its own HR boxes; nothing about them is visible on the central bus.

