# Cortex developer hand-off notes

Running engineering log for whoever works on Cortex next (protocol findings, history, lessons).
Moved out of `cortex.html` in v1.5.0 so it is no longer shipped to every browser. Newest protocol
facts live in `LGAP_reference.md`; where the two disagree, the reference wins.

```text
==========================================================================================
  CORTEX HANDOFF NOTES  —  READ THIS FIRST (written for the next Claude session)
==========================================================================================
  If you are a new Claude session picking this up: this is interoperability work on the
  operator's own LG VRF equipment. Everything you need is here. Update this block whenever
  something is confirmed.

  WHO / HOW TO WORK WITH THEM
  - the operator is hands-on with HVAC but asks that controls / protocol topics be explained
    step by step in very plain language. Short steps, one change at a time.
  - Project history: started in a chat on Opus 4.8. That chat was paused on 2026-11-07 by
    an automated safety filter (false positive — this is interoperability work on LG
    equipment the operator services, not an attack). Continued the same day in a new chat with
    Claude Opus 5.5, which wrote these notes. Work has continued since across Fable 5.2 and
    Opus 4.8 sessions — the model in use changes; the Co-Authored-By line on commits follows it.

  CURRENT STATE (2026-11-13)
  - Repo is PUBLIC (github.com/h2erft/cortex). Latest STABLE = v1.5.0. Latest BETA = v1.6.0-beta.1.
    The operator cuts releases himself (the session credential pushes branches but 403s on tags).
  - Appliance + OTA in production on his N95 box (hostname cortex). Stable + beta update channels;
    Settings > Updates > "Beta testing" opts a box into pre-releases.
  - Shared state lives on the appliance (units.json / appconfig.json / history/) and mirrors to
    every browser; the connected "master" screen runs the poll loop + schedules.
  - NONE of the 1.5/1.6 work has run on a real LG bus/hardware yet — all verified on a simulated
    LGAP bus + staged appliance (test tooling lives in-session under /home/claude/sim, NOT in repo).
  - NEW tool: uart-sniffer.html (read-only Web Serial bus listener) — see the 2026-11-11→13 entry.

  WHAT CORTEX IS
  - A Raspberry Pi (or laptop + Chrome) replacement for the LG ACP / AC Smart central
    controller on Multi V IV systems. It talks LGAP over the central-control RS485 bus.
  - cortex.html          = single-building controller (customer side). Web Serial for the bus.
  - command-center.html  = multi-site fleet console (owner). Demo data only so far.
  - All state lives in browser localStorage. Remote access: Tailscale.
  - DEPLOYMENT (chosen 2026-11-07): locked-down LINUX APPLIANCE on an N95 mini PC, NOT a
    custom OS and NOT a Windows app. See Cortex/appliance/ — server.js (Node: serves the UI
    + bridges the RS485 adapter over a WebSocket so the browser no longer needs Web Serial),
    cortex-appliance.service (systemd), install.sh (Debian setup + ufw + Tailscale + auto-
    updates), README-appliance.md. cortex.html auto-detects: served over http -> backend
    bridge (busConnectBackend); file:// -> Web Serial.
  - APPLIANCE + OTA DONE (2026-11-08, v1.0.0): Cortex/appliance/ is deploy-ready for the N95
    (x86-64 Debian/Ubuntu). Atomic layout: /opt/cortex/{releases/<ver>, current->symlink,
    data/{appliance.env,update.conf,update.log}}. server.js reads VERSION file; exposes
    /health + /version. OTA = cortex-update.sh + cortex-updater.timer (every ~30min): pulls
    manifest.json {version,url,sha256}, semver-gates (never downgrades), sha256-verifies,
    npm ci, flips current symlink, restarts, health-checks /version, AUTO-ROLLS-BACK to prev
    release if unhealthy (keeps last 3). release.sh <ver> <base-url> builds the tgz+manifest
    to upload. All 3 paths tested end-to-end (upgrade / bad-checksum reject / bad-build
    rollback). OTA host NOT yet chosen by the operator (GitHub Release / S3-R2 / tailnet box) -
    update.conf ships blank = OTA off until he pastes a manifest URL. Next ideas: move state
    browser->SQLite on appliance; add update notes/version to fleet console health poll.
  - 2026-11-08 GITHUB + ZERO-SSH-CONFIG: repo-ified (README.md, .gitignore, top of Cortex/).
    GitHub Action .github/workflows/release.yml: push tag vX.Y.Z -> builds tgz+manifest ->
    publishes Release. Appliance update.conf points at releases/latest/download/manifest.json
    (auto-follows newest). appliance/bootstrap.sh = one-liner first install (clones repo+runs
    install.sh); REPO placeholder YOUR-GH-USER/cortex. install.sh now sets hostname 'cortex' +
    avahi-daemon => customers bookmark http://cortex.local:8080 (no IP, no SSH). SETUP WIZARD:
    server.js reads site config from /opt/cortex/data/config.json (name+serial), NOT env;
    endpoints GET/POST /api/config, GET /api/serial-ports; unconfigured '/' 302->/setup.html;
    setup.html = first-run wizard (name site, pick adapter). serial change applies on next bus
    connect, no restart. the operator's GH user/repo NOT yet known -> placeholders to fill in 2 spots
    (update.conf URL + bootstrap one-liner). Public repo recommended for tokenless OTA.
  - 2026-11-08 PRIVATE + SCRUB: operator chose a PRIVATE GitHub repo for now (public later).
    Private OTA supported: update.conf has CORTEX_UPDATE_TOKEN (fine-grained PAT, Contents:
    Read); cortex-update.sh sends it as a Bearer header on manifest+asset curls (AUTH array;
    cross-host redirect drops it, signed URL self-auths — never --location-trusted).
    bootstrap.sh takes CORTEX_TOKEN, injects into clone URL, then scrubs it from the git remote
    (no token on disk). PERSONAL INFO SCRUBBED from all repo files for public-readiness: real
    name, location, and demo site IDs genericized. AIROW de-branded from the main UI (header,
    wizard, recovery-code prefix all "Cortex"); AIROW retained only in Settings>About ("Made by")
    and the credits easter-egg. LGAP_reference.md rewritten as a
    clean public protocol spec (TOC, worked examples, error table, capture how-to). GitHub NOT
    yet linked to the Claude session (list_repos: no account) - operator must connect GitHub in
    claude.ai settings, then add_repo(push) + push, OR push themselves. Private-token OTA verified.
  - 2026-11-08 LIVE ON GITHUB + FIRST BOX DEPLOYED (repo github.com/h2erft/cortex, PRIVATE):
    * Pushed everything from the Claude session via add_repo(push)+clone+push. NOTE: the session
      credential pushes BRANCHES but 403s on TAGS — operator cuts releases himself (GitHub UI:
      Releases > Draft > new tag vX.Y.Z > Publish). GitHub Action (.github/workflows/release.yml)
      builds the tgz+manifest on tag push.
    * WORKFLOW BUG FIXED: 'gh release create' errors if the release already exists (UI-created),
      so assets never attached -> 404. Now: if release exists -> 'gh release upload --clobber',
      else create. Idempotent; UI-create + Action both work.
    * OTA DELIVERY REWRITTEN TO USE GITHUB API (big one): fine-grained PATs authenticate against
      api.github.com but NOT the github.com/.../releases/latest/download/ browser URLs on PRIVATE
      repos (404). So cortex-update.sh + server.js /api/update/check now hit the API:
      GET api.github.com/repos/REPO/releases/latest, read .tag_name for version, pull the
      manifest.json + .tgz via their .assets[].url with 'Accept: application/octet-stream' (+Bearer
      token; curl -L drops the header on the cross-host redirect to the signed URL, which self-auths).
      update.conf is now CORTEX_UPDATE_REPO=owner/repo (+ CORTEX_UPDATE_TOKEN for private);
      static CORTEX_UPDATE_MANIFEST=<url> mode still supported. CORTEX_UPDATE_API_BASE overrides
      api host for testing. A broken updater can't fix itself, so bootstrap the new one once via:
      curl ...api.github.com/repos/REPO/contents/appliance/cortex-update.sh?ref=main (Accept: raw).
    * FIELD SETUP GOTCHAS (fresh Ubuntu Server N95): (a) installer-written netplan may have no
      dhcp4 -> only lo gets an IP; fix: write /etc/netplan/01-cortex.yaml {ethernets: enpX: dhcp4:
      true} + netplan apply. (b) RTC can be hours behind -> apt refuses "Release not valid yet" and
      install.sh aborts; fix: timedatectl set-ntp false; set-time 'UTC'; set-ntp true. (c) install:
      token-clone repo -> cd appliance -> sudo bash install.sh (idempotent).
    * STATE AS OF TONIGHT: first box (hostname cortex) is running v1.1.2 via OTA,
      self-healing timer active; v1.1.1 release=mock-era UI, v1.1.2=empty-units + real update page.
      cortex.html loadUnits() returns [] (no demo seed). Updates page auto-calls /api/update/check.
  - 2026-11-09 MASTER-MODE FIRMWARE DIG (comm daemon bins2/f88a2ccf_33363456.elf, NOT stripped,
    has debug_info — function names intact!). Findings (see LGAP_reference.md §1, §4e, §7b):
    * BAUD = 4800 CONFIRMED in firmware. rs485_open() sets termios c_cflag=0x8b0|baudbits;
      LGAP AC port = B4800 (0x8bc). Supported bauds: B1200/B4800/B9600/B38400(/B19200). 3600 is
      NOT a termios baud — impossible. MODBUS/chiller channel = 9600 (separate). The LG rep's
      "3600" is wrong; likely confusion with the 9600 modbus channel.
    * MASTER TRANSACTION: SendPacketID(id,addr,...) -> SetSendPacket builds a 64-BYTE query
      (addr at BYTE[3], cmd nibbles at [6]hi/[7]/[8]; three 16-byte blocks each sum-XOR-0x55 +1
      checksummed, + 32-bit CRC over first 60B in [60..63]) -> WriteCommBlock -> turnaround ->
      ReadCommBlock expects EXACTLY 16 bytes (else "No Response") -> CheckRecvPacket.
    * REPLY = 16 bytes, integrity = CRC-16/XMODEM (poly 0x1021, init 0) over [0..13], big-endian
      [14]=hi [15]=lo. NOT the sum checksum! This is almost certainly why addr 12 "read wrong" —
      Cortex wasn't treating replies as CRC16 16-byte frames. all-zero reply = absent.
    * TIMING: half-duplex; firmware packet delay default 20ms; ReadCommBlock loops rs485_rx1 with
      its own timeout/retry; probe path even sleep(1s) between write and read. His 150ms need fits.
    * STILL NEED A CAPTURE to lock: exact 64-byte query opcode bytes + the telemetry FIELD OFFSETS
      within the 16-byte reply. Plan: build backend master poll loop (continuous, configurable
      turnaround+timeout, discovery sweep, CRC16 reply validation, raw TX/RX log, command inject).
      Recommend sniffing the real ACP's discovery+poll first to nail query+offsets so it works 1st try.
    * Analysis tooling: /home/claude/work/dis.py (capstone+pyelftools fn disassembler; host objdump
      has NO arm support). ELF base vaddr via PT_LOAD segs. control_ac=bins2/4f2fdd00_36345344.elf.
  - 2026-11-09 v1.2.0 (public-launch build): repo going PUBLIC; history squashed clean.
    * SHARED SETUP/ACCOUNTS: config (CFG: site + user accounts) now stored on the appliance
      (DATA/appconfig.json; GET/POST /api/appconfig), not just per-browser localStorage. boot()
      is async: fetches server CFG first -> a NEW browser/computer gets the LOGIN screen, not the
      first-run wizard (that was the bug). saveCfg() also POSTs up. Migration: a browser that has
      local CFG but server has none pushes it up on next load (so open Cortex once on the browser
      you set up on). file:// demo still falls back to localStorage.
    * POWER CONTROLS: Settings > Advanced has Restart / Power off (admin). Backend POST
      /api/power/reboot|shutdown -> `sudo -n systemctl reboot|poweroff`. Privilege via scoped
      /etc/sudoers.d/cortex (appliance/cortex.sudoers), installed by install.sh AND reconciled by
      cortex-update.sh on each OTA (validated w/ visudo -c) — so it reaches already-deployed boxes.
    * PROTOCOL DOC IN-APP: Settings > About > "Protocol reference" opens LGAP_reference.md
      (served at /LGAP_reference.md; shipped in the release) rendered via a tiny md renderer
      (mdLite). About version now pulls from /version (was hardcoded).
    * TECH-INVISIBLE: there is no shared presence/online indicator, so a tech session is already
      invisible to the customer; only actual unit-state changes would show. KEEP it that way when
      units eventually move to shared backend state (don't broadcast "who is online"/"tech did X").
    * (v1.3.0) MASTER/CC MODE (beta) SHIPPED: browser-side poll loop reusing the /bus bridge
      (TX via bus.port.writable; RX via a MASTER.tap hook in ingestBytes). Tech > Bus > Debug >
      "Master / CC mode": editable query (AA=addr placeholder; default "80 00 A0 AA 01 00 00",
      auto-appends sum ck for the 8-byte form), scan range lo..hi, turnaround+reply-wait timing,
      Discover / Start poll loop / Import found / Save capture. Reply validated with crc16xmodem
      (0x1021/init0) over [0..13] vs [14:15]; unverified replies still logged. EVERY frame logged
      (m-log) + downloadMasterLog() -> cortex-master-capture.txt. KINKS/UNCONFIRMED: exact query
      opcode (we send a guess) + reply field offsets — need an on-wire capture to lock.
      Old `ctrl` stub object/functions left in place but unused (dead code; ok).
    * NEXT: use the capture to fix the real query bytes + reply field map; then move UNITS to
      shared backend state so all browsers see the same discovered units.
  - 2026-11-09 v1.4.0 REPLY PARSER DECODED (big) + README w/ real screenshots:
    * Re-dug engine. DBs are config/schedule/modbus-register maps (JHISTORY=modbus regs, not
      telemetry); bigdb_x*.sqlite corrupt from carve; schedule `ac.abs` lists commissioned addrs
      (0..255 spread). No stored raw replies. BUT found the REPLY PARSER: control_ac
      ProcessRxDataFromAC (0x3e198). CONFIRMED 16-byte AC reply field map (see LGAP_reference §4e):
      [4]=addr [5]=settemp°C(0xAD=none) [6]=mode(low3) [7]=fan(low nibble)+bit7 flag
      [8]=roomtemp(raw→InitRoomTemp float table) [9]=pipe-in [A]=pipe-out [B:C]=16bit(cap/EEV)
      [E]~err [15]=checksum=(sum[0..14])XOR0x55. **Reply checksum is sum-XOR-0x55, NOT CRC16**
      (CRC16/CheckRecvPacket is a lower 64-byte transport layer). CORRECTED master-mode: now
      validates replies with lgapCk and parseReply() decodes mode/fan/settemp exactly; import
      applies decoded state to units. Room/pipe temps still raw (InitRoomTemp table @0x25d68 is
      static float literals, extractable next, or calibrate from capture).
    * README.md rewritten with a real screenshot gallery (docs/img/01..06 png) rendered via
      playwright+google-chrome (/home/claude/work/shots.py: seed localStorage cfg/units, inject
      a classic script tag to switch module-scoped view/elev/busView since page.evaluate cannot
      reach them; .card-main=unit card) + full self-install guide (Ubuntu + bootstrap one-liner).
    * STILL NEED on-wire capture for: exact discovery QUERY bytes, and room-temp table values.
  - 2026-11-10 COMMUNITY CORRECTIONS (FIELD-VERIFIED by an outside replicator; see LGAP_reference §0):
    * Their write frame `80 00 A0 31 03 30 07 DE` (on/cool/fan3/22°C) checksum-validates with our
      lgapCk → independently confirms checksum AND setpoint encoding. Adopted:
    * SETPOINT IS IN THE BASIC cmd0 FRAME: b6 = °C-15 (22°C→0x07); half-degree = b0 bit2. Supersedes
      the old "b6 not setpoint / cmd5-only" story. cmdBytesFor() now encodes b6 from setC; SP_CONFIRMED
      = true; decodeFrame sets d.setC=f[6]+15. txUnit now sends ONLY cmd0 (dropped the auto cmd5 blast).
    * BYTE0 is a CMD HEADER: bit7=request, bits3-6=cmd#, bit2=+0.5°C. 0x80=cmd0, 0xA0=cmd4, 0xF0=cmd14.
      byte2 always 0xA0 (not the cmd). byte4 bit1 = EXE write-strobe (clear=read).
    * REPLY WIRE LAYOUT (differs from our firmware STRUCT offsets — wire is authoritative since Cortex
      reads the wire): [0]=0x10 len [1]=flags(bit0 on,bit7 +0.5) [4]=addr [5]=ERROR(decimal) [6]=mode
      (b0-2)+fan(b4-6) [7]=setpt-15(low nib) [8/9/10]=room/pipe-in/pipe-out [11:12]=EEV(LE) [14]=sys grp.
      parseReply() rewritten to this. Temp formula C=(192-code)/3. Errors decimal (0x68=104; 204/206=HR).
    * ODU answers for all its IDUs from cache (power off main ODU → system silent). Group by reply[14].
    * DISCOVERY: no special frame — sweep cmd0 READS, ~1s timeout, silence=absent. MASTER.timeout 200→1000,
      query default →"80 00 A0 AA 00 00 00", hi default 0xFF→0xFE.
    * SAFETY (implemented): never send 0xFF (broadcast); isSafeReadQuery() refuses blind-sweeping a write
      cmd (cmd4/5/9 overwrite settings even with zero payload; cmd4 wipes central's per-unit settings);
      cmd5 (0xA8) is destructive → never auto-sent, armed-tool only. "Don't be a second master" warning
      in the master panel. STILL want one real capture to confirm reply[14] grouping + room-temp accuracy.
  - 2026-11-09 v1.4.0 FIXES/FEATURES (pre-publish batch, reported from a live 1.1.2 box):
    * LAYOUT BUG FIXED: off-canvas .drawer was position:absolute + translateX(102%) → created
      horizontal overflow (blank right-scroll area; closed drawer visible when scrolled). Fix:
      .drawer/.scrim → position:fixed, added visibility:hidden (show→visible), and
      html,body{overflow-x:hidden}.
    * EXEC-PERMISSION BUG (why OTA/auto-update silently failed + "cannot execute cortex-update.sh
      Permission denied"): the GitHub Action tarball didn't preserve +x. Fixed: git now tracks all
      appliance/*.sh as 100755; updater chmod+x the new cortex-update.sh after extract; Action
      chmod+x in staging; cortex-updater.service ExecStart=/bin/bash ... (robust). UNBLOCK a stuck
      box with: sudo bash /opt/cortex/current/cortex-update.sh
    * SITE NAME in header now real (renderWho sets #site-name from CFG.site.name, else /version name).
    * UPDATES moved into Settings (new "⬇ Updates" tab, loadSettingsUpdates) with DOWNLOAD & INSTALL
      NOW (POST /api/update/apply → sudo systemctl start cortex-updater.service, a SEPARATE cgroup so
      it survives the restart it triggers; sudoers updated) and SKIP THIS VERSION (localStorage
      airow_skipver). Old nav Updates item left in place too.
    * BUS SCAN serial settings editable (tech): baud/data/parity/stop selects in the connbar →
      bus.serial override via effSerial(); used by both Web-Serial and backend-WS connect. For
      Multi V 5 / other buses. Resets on protocol change.
  - SEND setpoint: Bus scan (tech) now has a "Send setpoint (cmd5)" tool — single or dual
    (cool+heat) °C, transmits, with editable cmd/flags bytes.
  - 2026-11-08 UI: the NORMAL unit controls now transmit for real whenever the adapter is
    connected (liveTx no longer requires tech) — change power/mode/fan or setpoint and Send
    puts BOTH the 8-byte basic frame AND the 16-byte cmd5 on the bus (txUnit). Units carry
    cool/heat setpoints in °C (coolC/heatC), a twoset flag, and mode/fan/temp locks; all are
    shown on cards + drawer. Bus scan is split Live | Debug (busView); Debug is the cyber
    byte zone. "🔍 Scan for new units" (busScanNew) ADDS new bus addresses only and never
    drops an existing unit (even offline/CH242) — removal is per-unit via the drawer's
    "Remove unit". Locks are stored/shown but not yet mapped to exact cmd5 flag bits.
  - Hardware: Waveshare isolated USB-RS485 (FT232). Spare ACP + AC Smart 5 for bench tests.
  - Shared write-up for an outside contact (no Cortex/site names, by request):
    https://claude.ai/artifact/PG8QonDDG1Yg9E9m594zA8

  SAFETY RULES (keep these)
  - Listen first. Only ONE master per bus: unplug the LG CC from a channel before Cortex
    transmits or runs Controller mode. Keep the CC labeled for a 30-second swap back.
  - Adapter termination resistor OFF when tapping a live bus.
  - Test after hours; customer/owner sign-off before replacing a CC on a customer site.

  - 2026-11-11 → 13  v1.5.0 STABLE + v1.6.0-beta.1 + UART SNIFFER (Fable 5.2 / Opus 4.8 sessions):
    * v1.5.0 (stable): building MAP with floor-plan images + top-down LG-style unit graphics;
      customer vs technician visibility; SHARED unit list/live state on the appliance (every
      screen mirrors the connected one, commands relay through it); revisioned config saves
      (409 on stale); bus arbitration (command vs poll never overlap); early-exit polling
      (~2.6s/pass vs ~14.5s); auto-reconnect/auto-resume; worker-timer schedules w/ 10-min
      catch-up; "No response" detection; atomic crash-safe saves; real trends (NDJSON history)
      + real error log + real force-poll (fake data removed); no built-in PINs + login throttle;
      same-origin/CSRF guards; gzip+ETag UI. Plus the updater fix below.
    * UPDATER BUG (shipped in beta.2/beta.3, fixed in 1.5.0): cortex-update.sh aborted under
      set -euo pipefail when DATA/update-channel was missing -> a box that never touched the Beta
      toggle stopped updating forever. Fix: default to stable if the file is absent. Also: skip a
      build that failed its health check until a different one ships (CORTEX_UPDATE_FORCE=1
      overrides); install.sh only resets ufw on first run (CORTEX_RESET_FIREWALL=1 to force).
    * v1.6.0-beta.1: auto mode = single setpoint by default (Multi V; cool+heat toggle still there,
      stacked so the panel can't overflow sideways); map updates immediately on mode/fan change;
      floor plans: rotate a placed unit (90°, persists across moves), snap-strength slider +
      snap-off, image preview (zoom to inspect, rotate baked in) before saving; bus-scan folded
      into ONE view (removed the Live/Debug toggle AND the raw TX "basic"/"setpoint" senders —
      discovery stays read-only, control a unit from its own page); per-unit "Watch" filter narrows
      the activity feed + a saved capture to 1-2 addresses; header logo animates during a scan;
      group-rename pencils always visible (touch-friendly), not hover-only.
    * TEST TOOLING (in-session only, NOT in repo, /home/claude/sim): pty LGAP simulator + staged
      appliance harness + Playwright suites (t_server/t_ws/t_e2e/t_flows/t_stress/t_proto/t_ota/
      t_newui). ~220 checks green on the 1.6.0-beta.1 code. Recreate if you need them.
    * UART SNIFFER (uart-sniffer.html — NEW, in repo, served by the appliance, linked from the
      bus-scan debug view): standalone, Cortex-styled, runs in Chrome/Edge via the Web Serial API.
      Open on a laptop (file://) or over https — Web Serial needs a secure context, so NOT plain
      http://cortex.local. READ-ONLY by design (never opens the writable stream / getWriter). Live
      hex+ASCII, configurable baud/parity/stop, a structure helper (most-common-byte gap +
      autocorrelation to tell when the baud looks right and guess frame length), capture to raw
      .bin + timestamped hex log, and markers to line up against an LGMV CSV export. Pure-logic
      funcs exposed as window.__sniff for testing.
  - 2026-11-13  RESEARCH DIRECTION — richer data sources beyond the LGAP central bus. This is all
    the LEGITIMATE interoperability path: observe the operator's OWN equipment, correlate, replicate.
    * ODU UART = the LGMV service port on the outdoor-unit main PCB, straight off the main MICOM.
      Far richer than the CEN/LGAP bus Cortex uses today: the whole refrigeration cycle (pressures,
      discharge/pipe temps, every EEV position, target/actual compressor Hz, electrical, per-IDU +
      HRU data). This is what the sniffer targets. CAVEAT: it is a DIFFERENT, UNDOCUMENTED protocol
      from LGAP and is ODU-family-specific — none of Cortex's LGAP decode carries over; it's its
      own reverse-engineering job per generation. Electrically it's ordinary UART (the LGMV dongle
      is a CP210x USB-UART bridge). Decode plan: run LGMV while passively sniffing, then line raw
      bytes up against LGMV's labeled CSV export (ground truth). Start with Multi V IV (MV4). Baud
      is not published — try 38400/115200/57600/19200/9600; the structure helper flags a good one.
    * LGMV control scope (documented): IDU on/off, mode, setpoint, fan, temp-limit (LGMV Business
      "IDU control"). EEVs + compressor normally run on the ODU's own fuzzy control (hold superheat
      ~3°C / subcool ~15°C); LGMV shows them read-only. They ARE driven to known states by the
      documented SERVICE MODES: Integrated Test Run (ITR/Fd7), vacuum mode, pump-down, auto-charge.
      Free-form "set EEV = N pulses / compressor = N Hz" is not publicly documented. Path to it:
      sniff LGMV running those modes on the operator's own gear, then replicate the frames.
    * IDU wired-remote bus (CN-REMO on the indoor-unit PCB) is already community-decoded (JanM321
      esphome-lg-controller: 13-byte status msg every ~20s) — lower-hanging per-room data than ODU UART.
    * EEPROM dumps (CH341A programmer, SOIC8 clip, 24-series I2C / 25-series SPI) are a SEPARATE
      data source = STORED config/history on the board, NOT the live stream and NOT the locked MICOM
      firmware. Mind the cheap CH341A's 3.3V issue on 3.3V chips; de-energize the ODU before clipping.
    * LATS IMPORT idea (parse an LG LATS .xls design -> editable system + validation + charge calc):
      prototype built (lats.html, in-session only, NOT in repo) then SHELVED by the operator as too
      much for now. Don't resume unless he asks. LATS exports a .xls engineering report; the native
      project file is proprietary. Multi V 5 limits + the charge formula are captured in that prototype.

  BUS / FRAME FORMAT  (confidence: CONFIRMED / LIKELY / GUESS)
  - Serial 4800 8N1                                                     CONFIRMED
  - Every frame is 8 bytes:  b0 b1 A0 addr b4 b5 b6 ck                  CONFIRMED
  - ck = (sum of b0..b6) & 0xFF, XOR 0x55                               CONFIRMED
  - Addresses seen on a live bus: 0x81-0xD3 plus 0x25.
  - Frame types by b0 b1:
      80 00 / 84 00  CC -> unit "state" frame, repeated every sweep. Also carries changes.
                     (80 vs 84 is fixed per address; meaning unknown. Preserve it.)
      80 B0 / 80 B2  poll frames, payload all zeros.
      80 A3 / 84 A3  same payload as 80 00, sent occasionally. Meaning unknown.
      A0 00          unit status reply (b4=09, b5=8x, b6). b6 here did NOT follow the
                     command's b6 after a change — it is not the setpoint.
      F0 C0 / C8 C0  scan / system frames, unknown.
      09 20 A0 00 87 08 05 08  seen 4x, unknown.

  THE COMMAND (decoded from the operator's 2026-11-07 capture at the CC)
  - A change is just the 80/84 00 frame with b4 bit1 set:
      b4 = 03 (on + change) or 02 (off + change), sent ONCE; then the CC goes back to
      sending 01 (on) / 00 (off) every sweep.                           CONFIRMED
  - b5 LOW nibble = MODE:  cool=0, dry=1, fan=2, auto=3, heat=4 — ALL CONFIRMED 2026-11-08
      from the firmware mode->code strcmp chain (@0x380c8). MODELO now matches.
  - b5 HIGH nibble = FAN:  low=1, med=2, high=3 — CONFIRMED 2026-11-08 (AC stores fan as
      "fan1".."fan6"; the digit IS the speed code). "AUTO" fan is a separate token (code TBD).
  - b6 = NOT the setpoint. SOLVED 2026-11-07 by disassembling the ACP firmware: the
      8-byte basic frame carries only power/mode/fan. The setpoint travels in a
      SEPARATE 16-byte "cmd5" frame (see SETPOINT below). Cortex preserves last-seen b6.
  - Swing: no data yet.

  SETPOINT — SOLVED 2026-11-07 from firmware (UpdateMonitorCmd5 / ProcessRxDataFromACCmd5
  in the control-engine ELF; constants read straight out of the binary):
  - Temperature rides a 16-byte "cmd5" frame, checksum same rule over the first 15 bytes.
  - byte10 & 0x7F = COOLING setpoint whole °C ; byte11 & 0x7F = HEATING setpoint whole °C
    (LG keeps cool & heat setpoints SEPARATELY).
  - byte12 high nibble (0-9) = cool decimal, low nibble (0-9) = heat decimal;
    setpoint °C = whole + decimal * 0.1  (0.1°C resolution, multiplier 0.1 confirmed in code).
  - bytes 6-9 = temp limits: (byte & 0x7F)°C + (top bit ? 0.5 : 0).
  - Simpler status frames encode a setpoint as (nibble + 15) °C for the 15-30°C range.
  - Wire is CELSIUS. Code: decodeCmd5() + cmd5SetpointBytes() in cortex.html.
  - HEADER — SOLVED 2026-11-08 by disassembling the builder CopyControlData_to_sendControlacCmd5
    (ELF elf_36345344, func @0x343b0). The outgoing cmd5 is FULLY known now, no guessing:
      [0]=A8 (mvn #0x57)  [1]=00  [2]=A0  [3]=addr  [4]=10 (cmd5 id)  [5]=flags(bit0=power on)
      [6..9]=limits (cool lo/hi, heat lo/hi): (byte&0x7F)degC + (top bit ? 0.5 : 0)
      [10]=cool whole degC &0x7F   [11]=heat whole degC &0x7F   [12]=(cool_dec<<4)|heat_dec
      [13]=reserved/mode
      [14]=ap_mkchksum(buf,14)=(sum[0..13]^0x55)&0xFF
      [15]=(ap_mkchksum(buf,15)+1)&0xFF
    cmd5 marker is A8 (NOT the 80 of the basic frame). TWO checksums (14 and 15). ap_mkchksum
    (func @0x21674) = (sum ^ 0x55) & 0xFF — verified in code, == our lgapCk.
    Cortex's cmd5SetpointBytes() now builds this exactly. Verified round-trip:
      cool 23.5 / heat 20 -> A8 00 A0 A7 10 01 95 99 12 16 17 14 50 00 84 01.
    LAST STEP IS JUST A REAL-UNIT SANITY TX (does the unit obey) — the bytes are certain.

  FIRMWARE FINDINGS (2026-11-07, from the ACP's own control software, pulled off the unit)
  - Confirms the wire protocol works in CELSIUS. Every setpoint is stored in degC
    (indoor range ~4-37.5 degC); Fahrenheit is a display-only conversion (flag_fahrenheit,
    getTemperature_F2C). Cortex should hold temps in degC internally and convert for the UI.
  - LGAP is a set of NUMBERED commands: cmd5, cmd6, cmd7, cmd9... The basic 8-byte frame
    (power/mode/fan) is one of them. The ac DB tracks exe_cmd5 / exe_cmd6 as SEPARATE
    per-unit actions -> the setpoint rides a 16-byte cmd5 frame, NOT the basic frame.
    That is why b6 never tracked temperature. DISASSEMBLED the control engine (capstone)
    and extracted the exact cmd5 temperature encoding — see the SETPOINT block above.
  - Indoor-unit field model (from the 'ac' table): addr, mode (COOL/HEAT/AUTO/DRY/FAN),
    fan (LOW/MID/HIGH/AUTO), swing, modelock/fanlock/settemplock, settemp, roomtemp,
    pipe_intemp/pipe_outtemp, louverdirec, deadband, twoset_automode (dual setpoint),
    cool_settemp/heat_settemp, cool/heat limits, occupied, remocon_override.
  - Ports: config.ini (/mnt/flash/config.ini) assigns each RS485 channel to a protocol:
    AHU_LGAP (LG's own) for indoor/AHU, MODBUS for chillers + some water systems. LGAP
    bus is on a ttymxc/ttyS port; there is also a /dev/acp node (major 222/224 drivers).
  - Confirms cycle view is NOT on this bus (no outdoor/cycle refs in the indoor LGAP code).
  - The engine dump arrived as a ~52MB blob (SQLite DBs + ARM ELF binaries + XML). The key
    binaries: ahu_cont_comm / acsmart / control_ac. objdump here had no ARM support; a
    future session wanting exact cmd5/6 bytes could pip install capstone and disassemble
    Text2LGAP_ahu_cmd7, OR (cleaner) just do the setpoint-only wire capture.

  2026-11-08 SESSION — THE FIRMWARE IS THE SOURCE OF TRUTH (big lesson, read this)
  - We spent most of a session trying to CAPTURE a real setpoint command off the bench ACP.
    It cannot work: the operator's bench ACP has NO indoor units on it, so the ACP only POLLS
    empty addresses (roll call) and NEVER emits a real cmd5 setpoint command (nobody to
    command). All those captures were the 128-unit poll sweep, not commands. Do NOT send
    him down this path again. A setpoint command on the wire requires a real IDU present.
  - Serial-capture gotchas we burned hours on (so you don't): (a) CoolTerm defaults to 9600;
    the LG bus is 4800 -> 2x/4x byte "smear". (b) Web Serial in Chrome CHOKES on this noisy
    2-wire RS485 line (RXD lights then dies) - CoolTerm's native FTDI driver is fine; this is
    why the appliance backend (serialport lib) exists. (c) A COM port is single-owner: CoolTerm
    and Cortex can't both hold it. (d) Parity/databits mismatch leaves structure but mangles
    values (tell: a constant low-bit pattern in the address field every frame). Adapter = FT232R
    on COM9. Even at 4800 8N1/8E1/8O1 the bench poll frames (FE BF.. / 36 7E.. / F0 FC.. / 3E 7E..)
    never matched the documented 80 00 A0 format or validated a checksum - consistent with
    "this is unit-less poll traffic in a different frame type", not the command frame.
  - WHAT THE FIRMWARE ACTUALLY SAYS (control-engine ELF, strings + ARM disasm, confirmed):
    * Setpoints live in a SQLite 'ac' table as cool_settemp / heat_settemp, stored as degC
      with ONE decimal (%.1f). Dual-setpoint is real: twoset_automode, twoset_avail, deadband.
    * To command a unit the engine sets exe_cmd5='ON', exe_cmd5_cnt='10' on that addr, then
      CopyControlData_to_sendControlacCmd5() copies the control-data struct into rs485buf_tx
      and ap_mkchksum stamps the checksum. So the cmd5 TEMPERATURE bytes we already encode are
      correct; the header bytes come from that struct (runtime state), not literal constants.
    * cmd5 vs cmd6 are SEPARATE per-unit actions (exe_cmd5 / exe_cmd6). cmd5 carries setpoint.
    * SQL seen: "UPDATE ac SET cool_settemp=%.1f, exe_cmd5='ON', exe_cmd5_cnt='10' WHERE addr=%s"
      and the heat_settemp twin. This is the authoritative setpoint path.
  - 2026-11-08 FIRMWARE CONFIRMS (all from static analysis, no wire needed):
    * MODE codes: cool=0 dry=1 fan=2 auto=3 heat=4 (strcmp chain @0x380c8). In Cortex MODELO.
    * FAN codes: low=1 med=2 high=3 (fanN token digit = speed). In Cortex FANHI.
    * LOCK bits in the cmd4 control frame byte4: modelock=0x08, fanlock=0x04, settemplock=0x02,
      power=0x01 (from SELECT col order modelock,fanlock,settemplock + struct offsets). Locks
      are stored/shown in Cortex; not yet transmitted (unsure if they also ride the 80 frame).
    * cmd6 is a sibling 16-byte A8 frame (second per-unit control; occupancy/setback-ish).
  - RECOMMENDED NEXT MOVE (cheap, honest): don't capture. Either (a) get the cmd5 frame layout
    from the operator's outside collaborator (he pulled it from this same firmware) and cross-check,
    or (b) at a REAL site, have Cortex TX its firmware-derived cmd5 to ONE unit, CC unplugged,
    and watch the unit obey. One of those closes the header-byte gap for good.

  HISTORY / LESSONS
  - The first decode (by the earlier chat) had mode in the HIGH nibble (auto=1, cool=2,
    heat=3) and setpoint = degC-15. That was wrong: the high nibble is FAN. So Cortex's
    earlier "cool" commands actually went out as auto mode + med fan, and "heat" as
    auto + HIGH fan. That probably explains the "fan went high" result.
  - Lesson: only trust byte meanings from a controlled change made at the real CC
    (one unit, one setting, written down), never from steady-state traffic.

  CAPTURE 2026-11-07 (bus_capture_1794089122388.txt)
  - A7 at CC: cool, low fan, 64F, on, swing clear -> 80 00 A0 A7 03 10 05 8A, then 01 10 05
  - A6 at CC: heat, med fan, 80F, on, swing clear -> 80 00 A0 A6 03 24 06 A6, then 01 24 06
  - Later in the same capture A6 went 02 34 06 (OFF, heat, fan high) twice. the operator did
    not mention doing this. Ask him: was it him, a CC schedule, or something else?

  NEXT STEPS
  1. DONE 2026-11-08: cmd5 header fully recovered from the firmware builder (see SETPOINT block).
     Cortex's cmd5SetpointBytes() is firmware-exact. Only remaining: a single real-unit sanity
     TX at a live site (CC unplugged) to confirm the unit obeys. No more bench captures needed.
  2. Fan high / auto, and dry / fan modes, to fill in the remaining mode/fan GUESS rows.
  3. Wire decodeCmd5()/cmd5SetpointBytes() into the UI (show cool+heat setpoints; send).
  4. Bench test TX on the spare ACP / one unit after hours, CC unplugged.
  5. Cycle view (outdoor-unit temps/pressures) is NOT on the CC bus as far as the operator knows —
     the LG CC has never been able to show it; it lives on a different bus. Don't assume the
     CC bus can provide it. (The earlier chat knew this; corrected 2026-11-07.) --> this is exactly
     the gap the ODU UART / LGMV-port work (2026-11-13 entry) is meant to fill.
  6. UART FRONTIER (current focus): collect a real Multi V IV ODU-UART capture WITH a matching LGMV
     CSV export running at the same time (use uart-sniffer.html + its markers). That paired data is
     the thing everything downstream needs — no decoder can be built without it. Once captured,
     correlate bytes->labels and start an MV4 ODU-UART decoder (separate from the LGAP decoder).
==========================================================================================
```
