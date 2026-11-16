# Taking over Cortex — start here

*Written 2026-11-14, updated 2026-11-15 at v1.6.0-beta.7, for the next agent or person picking this up cold.*

Read this page fully before touching anything. Then skim `docs/KIT_FINDINGS.md` (protocol facts)
and the CURRENT STATE block at the top of `docs/HANDOFF.md` (history). `LGAP_reference.md` is the
public protocol spec; `CHANGELOG.md` says what each version changed.

## 1. What this is, in five lines

- Cortex replaces LG's ACP / AC Smart central controller for Multi V VRF systems. It talks LGAP on
  the central-control RS-485 pair (4800 8N1).
- `cortex.html` is the whole app (one file, ~3,700 lines of JS inside it). `appliance/server.js`
  serves it from a mini PC, stores shared state, and bridges the USB RS-485 adapter to the browser
  over a WebSocket. The server never interprets bus bytes — the browser does all protocol work.
- One browser tab is the **master screen**: it holds the adapter and runs the poll loop. Other
  screens (phones) send commands through the appliance (`/api/cmd`), and the master screen drains
  and transmits them.
- Two modes on the wire: **listening** beside a real LG central (never transmit), or **master**
  (the LG central is unplugged and Cortex polls).
- The operator is an HVAC professional, not a programmer. Explain protocol things in short, plain
  steps. He tests on real equipment himself and reports back.

## 2. Rules that are not negotiable

1. **Never transmit while a real LG central is on the bus.** Check `MASTER.running` is false before
   and after anything you do in his browser while he is tapped beside a central.
2. **Never send** cmd5, cmd7, cmd9, the `0D` frame, cmd14 with non-zero bytes 5–6, or anything to
   address `0xFF`. cmd4 is sent only as part of a unit Send, only when Cortex is the sole master.
3. **You do not put frames on his bus by hand.** Change the code, ship a beta, let him press the
   button. If a one-off frame would genuinely help, show him the exact bytes and get a yes first.
4. This repo is **public**. No personal names, addresses, site names or customer data in any file.
   The outside reference kit is private third-party work — never commit its files.
5. Don't publish what you haven't run. `node tests/protocol.test.js` must pass before every push.

## 3. How to ship a beta (the whole procedure)

```bash
cd cortex
# 1. make the change in cortex.html (and server.js only if the appliance itself must change)
# 2. syntax + regression test
L=$(grep -n "</script>" cortex.html | head -1 | cut -d: -f1)
sed -n "498,$((L-1))p" cortex.html > /tmp/c.js && node --check /tmp/c.js
node --check appliance/server.js
node tests/protocol.test.js              # must print "all passed"
node tests/uart.test.js                  # service-port decoder, must print "all passed"
# 3. version + notes
printf '1.6.0-beta.N\n' > appliance/VERSION
#    add a section at the top of CHANGELOG.md
# 4. commit and push to main
git add -A && git commit -m "Release v1.6.0-beta.N: <what>" && git push origin main
```

Then the operator publishes it — you cannot (the session can push commits but not tags/releases):

> GitHub → Releases → Draft a new release → tag `v1.6.0-beta.N` (create on publish) → tick
> **Set as a pre-release** → paste the notes → Publish.

**He does not need to attach any files.** The `release` GitHub Action runs on the new tag, builds
`cortex-<ver>.tgz` + `manifest.json` from the tagged commit, stamps `VERSION` from the tag name and
attaches both. (On beta.4/beta.5 he uploaded files by hand as well; harmless, but unnecessary.)
A box on the beta channel installs it on its next updater pass (~30 min) or from Settings ▸ Updates.

Always give him release notes in plain language with the message that says the beta is ready.
The tag must be newer than the last one — check with `git ls-remote --tags origin | tail`.

## 4. Where things are in `cortex.html`

Search for these names; line numbers drift.

| What | Function / symbol |
|---|---|
| Build the cmd0 control frame | `cmdBytesFor(addr, o, change)` |
| Build the cmd4 lock + limits frame | `cmd4BytesFor(addr, o)`, `bandLo/bandHi/bandKnown` |
| Decode a 16-byte unit reply | `parseReply(f)` → `applyReplyToUnit(p)` |
| Byte stream → frames (all lengths) | `ingestBytes(bytes)` |
| Handlers per frame kind | `handleDecoded` (8-byte master frames), `handleReply16`, `handleCmd4Reply`, `oduStore` |
| Outdoor-unit decode + tables + UI | `decodeOduPage`, `ODU_T`, `oduUnits`, `oduSection`, `masterOduPage`, `masterOduRead` |
| Master poll loop | `masterPoll`, `masterLoopRun`, `masterDiscover`, `busExclusive` (one talker at a time) |
| Transmit one unit's state | `txUnitRaw(u)` (cmd0 ×5, then cmd4 ×3) |
| Unit drawer UI | `drawDrawer(u)`; staged state is `pend`; `snap(u)`, `pendDirty(u)` |
| Technician cycle view | `renderCycle()` |
| Bus scan / debug view | `renderBusScan()`, `busLogRow(d)` |
| Per-unit runtime facts (not saved) | `rt(addr)` → `{seen, miss, ok, hold, lastRx, lockAck…}` |
| Mode / fan code tables | `MODELO`, `FANHI` (commands), `FANCODE`, `BMODE` (decode) |
| Protocol notes in code | the big comment starting `/* ===== LGAP — decoded from the ACP's OWN firmware` |

Adding a field to a unit that a phone must be able to change means touching **all** of: the
default in `makeDiscoveredUnit` and the migration loop near `if(u.tempLock==null)`, `snap`,
`pendDirty`, the apply line in the drawer's Send handler, the two relay lists (`/api/cmd` POST body
and `relayDrain`), **and the whitelist in `appliance/server.js` `/api/cmd`** (it silently drops
unknown keys — that is how `hardLock` got lost from relayed commands until beta.6).

## 5. Looking at his live system

When he says you have access, his Cortex tab is driven with the browser tools. Useful read-only
checks (page globals):

```js
MASTER.running                                   // is this tab transmitting?
units.find(u => u.addr === 0xC9)                 // a unit's saved + live state
rt(0xC9)                                         // lastRx, lockAck, hold
bus.raw.slice(-40)                               // recent decoded frames; "TX …" lines are ours
bus.hexdump.slice(-200).join(" ")                // raw bytes, the source of truth
[...ODU.values()].map(o => oduUnits(o))          // decoded outdoor units
MASTER.log.slice(0, 30)                          // master-mode log, newest first
```

A real central visits each unit only about every 90 seconds, so when listening, hold a state for
two minutes before deciding a frame "didn't appear".

## 6. What is verified and what is not (as of beta.6)

| Item | Status |
|---|---|
| cmd0 power/mode/fan/setpoint control | working on site |
| Hard lock (cmd0 byte 4 bit 2) | working on site, 2026-11-14 |
| Dimension locks set (cmd4) | frames correct per live decode + outside reference; operator said they "seem to work" |
| Dimension lock **clear** on a unit locked by the old central (0xC9) | fix shipped in beta.5; **result not reported yet — ask** |
| Everything new in beta.6 | passes the offline test against reference frames; **not yet run on real equipment** |
| cmd5 dual setpoint | layout now firmware-exact (KIT_FINDINGS §7) but **never sent to a unit** — armed debug tool only |

First thing to do on the next site visit — the beta.6 checklist, one item at a time:
1. Listening beside the LG central: do room temperatures and wall-thermostat changes now show up
   within ~90 s? Does the Cycle view's Outdoor units section fill in by itself?
2. As master: Swing on/off moves the louver; fan Auto takes; a unit left in Quiet stays in Quiet
   after an unrelated Send.
3. As master: open a unit, set limits (say 68–74 °F), Temp lock on, Send → "Outdoor unit confirmed
   these locks" appears; the thermostat refuses setpoints outside the range. Then clear and confirm.
4. As master: Cycle ▸ Find outdoor units (or type the ODU address) → values look sane against the
   gauges / LGMV. Report anything implausible with the raw page bytes (`ODU.get(addr).pages`).
5. From a phone (not the master screen): toggle Hard lock → it reaches the unit.

## 7. Backlog, in the order I would do it

**A. Close out what is in flight**
1. Get the beta.6 checklist results; fix what the real equipment disagrees with.
2. When 1.6 is solid, cut **v1.6.0 stable** (same procedure, tag without a suffix, *not* a pre-release).

**B. Small, safe, high value**
3. **Write verification.** After a Send, compare the unit's reply ≥15 s later with what was sent and
   show "applied ✓" / "unit kept its own setting" in the drawer. (The immediate reply is only the
   ODU's cache.) `rt(addr).txAt` and `R.hold` are already there.
4. **Group units by outdoor system automatically.** Reply byte 14 (`u.sysLoad`) is equal for all
   units of one ODU within a single sweep, and ODU page 0 byte 53 is the unit count — offer
   "assign these N units to Outdoor unit X". The ODU inventory pages 0x30–0x32 list (type, address)
   pairs directly; decode those first, it is the cleaner source.
5. **Outdoor unit error and alerts.** `decodeOduPage().err` and the page-5 fault table are decoded
   but only displayed. Feed them into the existing alert/err-log path; add 104/204/206/53 texts.
6. **Trend the outdoor unit.** The appliance already logs room/pipe history (`/api/history` in
   `server.js`); add high/low pressure, discharge, compressor Hz per ODU.
7. **Filter-sign reset button** (tech only): cmd0 with EXE and byte 5 bit 7, carrying the unit's
   current settings. The bit is deliberately stripped everywhere today; add one explicit path.
8. **Second-master guard.** While Cortex is master, an 8-byte frame with byte 0 bit 7 set that
   Cortex did not just send means another controller is on the pair → stop the loop and alert.
   First find out whether his adapter echoes its own transmit (some do), or this will false-alarm.

**C. Bigger pieces**
9. **Multi-channel support** (the operator asked): one appliance, several adapters, one bus object
   per channel. Today `bus` and `MASTER` are singletons and `server.js` bridges one serial port.
   Central addresses are unique across an ACP's channels, so units need only a `ch` field (exists).
10. **LGMV-port decoder — built in beta.7, needs its first live run.** `uart-sniffer.html` now
    decodes the service port (product record, outdoor main/sub, indoor units, HR boxes) and can
    optionally send LGMV's two monitoring requests. `docs/UART_SERVICE_PORT.md` has the operator's
    step-by-step and the byte map. Next: get his recorded hex log from a real unit, fix whatever
    disagrees with LGMV/gauges, then bring the data into Cortex itself (the appliance would need a
    second serial port bridged the same way `/bus` is; the browser-side decoder can be lifted as-is).
11. **cmd5 / dual setpoint.** The frame layout is settled from the ACP's own builder (KIT_FINDINGS
    §7). What is missing is a 2-set-capable unit to try it on: one unit, operator watching, via the
    armed debug tool, then read the cmd5 reply (`10 28 A0 …`, kit ch.04 §6.4) — Cortex does not
    decode that reply yet. Only after that works should dual setpoint join the normal Send.
12. **Indoor A/B bus listener** (9600, `0x56` frames) for heat-recovery boxes and true lock
    read-back. New adapter, new decoder; ch.03 of the kit is the map.

**Not worth doing:** chasing "byte loss" in the bridge (there is none — see KIT_FINDINGS §2);
anything from the firmware-decode guide (no open question needs it); Multi V 5 records.

## 8. Reading LG's own code when the wire can't answer

Two sources exist outside this repo — ask the operator to attach them:
- **The outside LGAP kit** (docs + Python tools + tables). `docs/KIT_FINDINGS.md` is the digest.
- **His ACP's control-engine image** (he uploads it as a file named `engine`, ~52 MB). It is a flash
  dump that starts with an SQLite database and contains ~46 ARM ELF programs. The one that matters
  holds the symbol `FindAcCmd5SendData`; it is **not stripped**, so functions have real names.

```bash
python3 - <<'PY'                      # carve the ELF that contains the builders
import re; d=open('engine','rb').read()
offs=[m.start() for m in re.finditer(b'\x7fELF',d)]; i=d.find(b'FindAcCmd5SendData')
a=max(o for o in offs if o<i); b=min(o for o in offs if o>i); open('eng.elf','wb').write(d[a:b])
PY
pip install capstone
python3 tools/armdis.py eng.elf --list Find          # what builders exist
python3 tools/armdis.py eng.elf FindAcCmd4SendData   # annotated disassembly
```

How to read a builder: find the `strb rX, [rBUF, #n]` instructions (byte n of the frame), then walk
back to see what was OR-ed in and which "ON"/"OFF" comparison guards it. Fields of the per-unit
struct sit 8 bytes apart in SELECT-column order; anchor on a debug `printf` that names a column.
State every claim as *proven* (you can point at the instruction) or *guess*.

**REA / Ghidra on LGMV-Business.exe.** A separate session prepared a finished Ghidra 12.2 project
for LG's LGMV-Business.exe (32-bit Qt program) and a handoff note, `LGMV-REA-HANDOFF.md`, in a folder
named `LGMV-business` on **one of the operator's PCs**. The note has the exact 5-minute rebuild
(stage the two Ghidra zip parts + project zip + exe, install Java 25, `npm i -g rea-agents`, point
`REA_GHIDRA_PROJECT_PATH` at the project, query with the `rea` CLI). Status on 2026-11-15 — **done once, and here is the way that works:**
- Stage `ghidra_12.2…zip.part1`, `.part2`, `LGMV-ghidra-project.zip` (and the exe) from that folder
  with the device file tools (two calls; ~660 MB), `cat` the parts, unzip, `apt-get update &&
  apt-get install openjdk-25-jdk-headless`, then use `tools/ghidra/*.java` with `analyzeHeadless
  -process -noanalysis -readOnly` (see `tools/ghidra/README.md`). ~5 minutes to set up, ~10 s a query.
- Do **not** drive the REA server on his PC through the bridge: every call that touches Ghidra
  outlives the bridge's 80-second limit and the server restarts. REA itself is not needed.
- The binary is stripped. Find things through strings (`…ProtocolParser / protocolType`,
  `…::initTableInfo`, `makeTx…Packet`, `===CRC error===`) and the `X::vftable` symbols.
  Multi V IV: `Super4ProtocolParser` (heat pump) and `Sync4ProtocolParser` (heat recovery) share
  page handlers at vtable +0x104 (0x64), +0x108 (0x65–68), +0x10C (0x6B); request builder +0xA0;
  `IDU4ProtocolParser` +0x34 (0x6A) / +0x38 (0x69); `HRU4ProtocolParser` +0x2C (0x6E).
- Findings are in `docs/UART_SERVICE_PORT.md` ("What LGMV itself confirmed"). Left to do there:
  name-check the 0x65 fields (needs the cycle-view grid definitions: the handler files values by
  row/column id), the 0x6F page, which setting selects the refrigerant table set.
- Never commit decompiler output or LG's files.
The firmware-engine reading earlier in this section was done with capstone, no REA needed.

## 1.7.0-beta.2 addendum (2026-11-15) — read before touching schedules, grouping or the cycle page

- **Schedules run in `appliance/scheduler.js`** (pure helpers + `createRunner`), wired in `server.js`
  after `attachBus(server)`. Browser `schTick` now only runs for `file://` demo copies. The appliance
  transmits by itself only when `DATA/master-mode` is `1` (the dashboard posts `/api/master-mode` from
  `busAuto()`); with a master screen alive it queues to `/api/cmd` instead. `cmd0Bytes` there must stay
  byte-identical to `cmdBytesFor` in `cortex.html`. `scheduler.js` is listed explicitly in
  `release.yml` and `release.sh` — a new appliance file must be added to both or OTA breaks.
  **Unverified on equipment:** direct transmit (3 × cmd0 per unit, 350 ms apart).
- **ODU → IDU membership** comes from cmd14 pages 0x30–0x32 (`masterOduInventory`,
  `decodeOduInventory`): byte 11 = count, (type, address) pairs from byte 16. The outside reference
  grades this "likely"; first live result decides whether auto-grouping stays on in guided setup.
  Reply byte 14 is a load value — never group by it again.
- **Still browser-driven:** the poll loop, trends and outdoor-unit reads only run while a dashboard
  holds the adapter. Moving the master loop into the appliance is the next architectural step (it
  would also give the cycle page data on every screen and make alerts/push possible).
- Cycle page: `renderCycle` → `oduCards` / `oduDiagrams` / `iduSection`; styles are the `.cy-*` rules.
- `tip(html)` renders the "i" popover; `row()` moves any description longer than ~56 characters into one.
- `siteGen()` / `siteCaps()` gate auto fan and dual setpoints (family 0x0E or 4800 baud = generation 4).

## 1.7.0-beta.3 addendum (2026-11-15) — the controller is now the master

- **`appliance/busmaster.js`** is the poll loop on the appliance (same rules as `masterLoopRun` in
  `cortex.html`): cmd0 reads, queued commands (cmd0 ×5 + cmd4 ×3), cmd14 pages 0/subs/5 once a minute.
  `server.js` starts it from a 10 s supervisor when `master-mode` is `1`, nothing holds the adapter and
  15 s have passed since a dashboard left; a `/bus` WebSocket connection makes it stop first.
  `masterAlive()` is true while it runs, so other screens relay commands through `/api/cmd` as before.
  Its frame builders must stay byte-identical to the dashboard's (`tests/busmaster.test.js`,
  `tests/scheduler.test.js`, `tests/protocol.test.js` hold the reference frames).
- **`appliance/recorder.js`**: 12-minute ring (15 s samples), fault events in `DATA/events/` (index +
  one JSON per event, 30 days), outdoor trend log `DATA/history/odu-<date>.ndjson` (raw pages, 35 days).
  Outdoor pages are stored raw; the dashboard decodes them (`decodeOduPage`). Endpoints: `/api/odu`,
  `/api/events`, `/api/events/:id`, `/api/history/odu`. The dashboard that holds the adapter posts its
  pages to `/api/odu` so recording works in both modes.
- New appliance files must be added to **both** `release.yml` and `release.sh` (now: scheduler,
  busmaster, recorder, pwa).
- Cycle page help text (`CY_HELP`) and the checks (`oduAdvice`, `cyTone`) come from LG's "Typical
  Operating Values — Multi V IV" and protection-control tables in the Multi V advanced service class
  deck the operator supplied. Do not commit those PDFs.
- Still open: verify the controller loop and the 0x30 inventory on site; gen-5 family codes; HRU data
  (service port only); real push notifications need HTTPS — the webhook is the supported route today.

## 9. Things that will bite you

- `cortex.html` is one long file with long lines. Edit with exact-match replacements and re-run the
  syntax check every time; a stray backtick breaks the whole app silently.
- Top-level `let/const` in the page are visible to the test via `page.evaluate`; keep new protocol
  helpers as plain top-level functions so `tests/protocol.test.js` can call them.
- `applyReplyToUnit` ignores control fields while `rt(addr).hold` is in the future (right after a
  Send). Sensors still update. Don't "fix" that.
- The dimension locks cannot be read back over this bus. After a restart Cortex shows what it last
  *commanded*, or what it last heard an LG central command — never what the unit "says".
- Stored temperatures on a unit (`room`, `pipeIn`, `pipeOut`) are °F; setpoints (`coolC`, `heatC`)
  and everything in `decodeOduPage` are °C. Convert at the display edge.
- The operator sometimes numbers betas himself. The tag he publishes wins; the Action stamps the
  version from the tag, not from `appliance/VERSION`.

## 1.7.0-beta.4 / beta.5 addendum (2026-11-15)

- beta.4: phone layout (slide-out nav under 860 px, bottom-sheet modals). The phone CSS block sits at the
  **end** of the main `<style>` so it wins over later component rules — keep it last.
- beta.5: `oduDiagram()` was redrawn. Layout constants are at the top of the function; pipes are drawn in
  the direction of flow (the dash animation follows path direction). SVG parts get help by adding
  `class="cy-ti" data-tip=…` (the tooltip engine matches `.ii,.cy-ti`).
- SVG gotcha: `transform-origin:center` on an element inside an SVG whose viewBox does not start at 0,0
  rotates around the wrong point. Use `transform-origin:0 0` with a centred viewBox (see `fanSvg`).
- `LG_CHARGE` / `chargeBand()` hold LG's charge-determination ranges (psig / °F). `ERRORS` entries may
  carry `chk` (field check) and `lv` (`comm` | `auto`, see `ERR_LEVELS`).
- LG's software stores its cycle-view pictures as Qt resources inside the executable. They were looked at
  for component placement only. Do not commit them or trace them.
