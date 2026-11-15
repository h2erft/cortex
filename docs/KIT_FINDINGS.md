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
  lookup tables. **This answers most of our "UART frontier" question** — `uart-sniffer.html` could
  grow a real decoder from ch.02 without the paired LGMV capture we thought we needed.
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
