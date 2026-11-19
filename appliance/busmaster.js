/*
 * Cortex bus master — the poll loop, running on the appliance.
 *
 * Until 1.7.0-beta.3 the equipment was only polled while a dashboard tab held the adapter: close
 * the tab and live readings, trends and fault capture all stopped. This module is the same loop the
 * dashboard runs (cortex.html masterLoopRun), on the controller, so the site is watched around the
 * clock:
 *   - read every known indoor unit (safe cmd0 read) and decode its 16-byte reply;
 *   - send commands queued by any screen or by a schedule (cmd0 x5, then the cmd4 lock frame x3);
 *   - re-read each known outdoor unit's monitor pages about once a minute (read-only cmd14).
 * It runs ONLY while Cortex is the bus master on this site (the master-mode flag) and nothing else
 * holds the adapter, and it lets go at once when a dashboard asks for the port.
 *
 * Never sent from here: address 0xFF, cmd5/cmd7/cmd9, or cmd14 with non-zero bytes 5-6.
 * Pure helpers are exported for tests; the serial port is supplied by the caller.
 */
'use strict';
const { cmd0Bytes } = require('./scheduler');

const MODE_BY_CODE = { 0: 'cool', 1: 'dry', 2: 'fan', 3: 'auto', 4: 'heat', 7: 'auto' };
const FAN_BY_CODE = { 1: 'low', 2: 'med', 3: 'high', 4: 'auto', 5: 'quiet', 6: 'power' };
const TURNAROUND = 30, REPLY_WAIT = 1000, ODU_EVERY = 60000, MIN_PASS = 2500, SCAN_WAIT = 450, SCAN_STEP = 16;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ck(b, n) { let s = 0; for (let i = 0; i < n; i++) s = (s + b[i]) & 0xff; return (s ^ 0x55) & 0xff; }
function readQuery(addr) { const q = [0x80, 0x00, 0xA0, addr & 0xFF, 0, 0, 0]; q.push(ck(q, 7)); return q; }
function oduQuery(addr, page) { const q = [0xF0, 0xC0, 0xA0, addr & 0xFF, page & 0xFF, 0x00, 0x00]; q.push(ck(q, 7)); return q; }
function findReply16(rx, addr) {
  for (let i = 0; i + 16 <= rx.length; i++) if (rx[i + 4] === addr) { const f = rx.slice(i, i + 16); if (ck(f, 15) === f[15]) return f; }
  return null;
}
function findOduPage(rx, addr) {
  for (let i = 0; i + 64 <= rx.length; i++) if (rx[i] === 0x40 && rx[i + 1] === 0x70 && rx[i + 2] === 0xA0 && rx[i + 4] === addr) { const f = rx.slice(i, i + 64); if (ck(f, 63) === f[63]) return f; }
  return null;
}
// Thermistor curves (tenths of a degree C per raw code), identical to ODU_T.air / ODU_T.pipe in cortex.html —
// tests/busmaster.test.js fails if the two copies ever differ. Room uses the air curve, pipes the pipe curve.
const T_AIR = [2200,2144,1771,1578,1449,1355,1280,1219,1168,1123,1084,1049,1017,989,963,938,916,895,876,857,840,823,808,793,779,765,752,740,728,717,706,695,685,675,665,655,646,637,629,620,612,604,596,589,581,574,567,560,553,547,540,534,527,521,515,509,503,497,492,486,481,475,470,464,459,454,449,444,439,434,429,425,420,415,411,406,402,397,393,388,384,380,375,371,367,363,359,355,351,347,343,339,335,331,327,323,320,316,312,308,305,301,297,294,290,286,283,279,276,272,269,265,262,258,255,251,248,244,241,238,234,231,228,224,221,218,214,211,208,204,201,198,194,191,188,185,181,178,175,172,168,165,162,159,155,152,149,146,142,139,136,133,130,126,123,120,116,113,110,107,103,100,97,94,90,87,84,80,77,74,70,67,63,60,57,53,50,46,43,39,36,32,29,25,21,18,14,11,7,3,-1,-4,-8,-12,-16,-20,-24,-28,-32,-36,-40,-44,-48,-52,-56,-61,-65,-69,-74,-78,-83,-88,-92,-97,-102,-107,-112,-117,-122,-128,-133,-138,-144,-150,-156,-162,-168,-174,-181,-187,-194,-201,-209,-216,-224,-232,-240,-249,-258,-268,-278,-289,-300,-312,-325,-339,-354,-371,-389,-410,-435,-463,-499,-548,-626,-1000];
const T_PIPE = [2200,2249,1847,1640,1503,1403,1324,1259,1204,1157,1116,1079,1046,1015,988,962,939,917,896,877,859,842,825,810,795,781,767,754,742,730,718,707,696,686,676,666,656,647,638,629,621,612,604,596,589,581,574,566,559,552,546,539,532,526,519,513,507,501,495,489,484,478,472,467,461,456,451,446,441,435,430,425,421,416,411,406,402,397,392,388,383,379,374,370,366,361,357,353,349,345,341,336,332,328,324,320,317,313,309,305,301,297,293,290,286,282,278,275,271,267,264,260,257,253,249,246,242,239,235,232,228,225,221,218,214,211,208,204,201,197,194,191,187,184,180,177,174,170,167,164,160,157,154,150,147,143,140,137,133,130,127,123,120,117,113,110,107,103,100,97,93,90,86,83,80,76,73,69,66,62,59,55,52,48,45,41,38,34,31,27,23,20,16,12,9,5,1,-2,-6,-10,-14,-18,-22,-26,-30,-34,-38,-42,-46,-50,-54,-58,-63,-67,-71,-76,-80,-85,-89,-94,-99,-103,-108,-113,-118,-123,-128,-133,-139,-144,-150,-155,-161,-167,-173,-179,-185,-192,-199,-205,-212,-220,-227,-235,-243,-251,-260,-269,-278,-288,-298,-309,-321,-333,-346,-360,-376,-393,-412,-433,-458,-487,-523,-573,-652,-1000];
const inRange = (raw, lo, hi, tbl) => { const v = tbl[raw] / 10; return (raw !== 0xFF && isFinite(v) && v >= lo && v <= hi) ? v : null; };
/* Same decode as cortex.html parseReply. */
function parseReply(f) {
  const mraw = f[6] & 7, fraw = (f[6] >> 4) & 7;
  return { addr: f[4], on: (f[1] & 1) === 1, remoteLock: (f[1] & 0x04) === 0x04, modeRaw: mraw, fanRaw: fraw,
    mode: MODE_BY_CODE[mraw] || ('mode' + mraw), swing: (f[6] & 0x08) !== 0,
    settemp: 15 + (f[7] & 0x0f) + ((f[1] & 0x80) ? 0.5 : 0), err: f[5] === 0xAD ? 0 : f[5],
    filter: (f[7] & 0x80) !== 0, oilAlarm: (f[7] & 0x10) !== 0,   // reply byte 7: bit 7 filter sign, bit 4 oil alarm (LG controller's own column names)
    room: inRange(f[8], -10, 50, T_AIR), pipeIn: inRange(f[9], -40, 110, T_PIPE), pipeOut: inRange(f[10], -40, 110, T_PIPE),
    eev: f[11] | (f[12] << 8), cap: f[13], load: f[14], autoSide: mraw === 7 ? 'heat' : (mraw === 3 ? 'cool' : null) };
}
const toF = (c) => Math.round(c * 9 / 5 + 32);
/* The fields a reply changes on a unit record (same rules as cortex.html applyReplyToUnit). */
function replyPatch(p, held, now) {
  const o = {};
  if (!held) {
    o.mode = p.mode; o.on = !!p.on; o.fan = FAN_BY_CODE[p.fanRaw] || 'auto'; o.fanRaw = p.fanRaw; o.swing = !!p.swing;
    o.coolC = p.settemp; o.heatC = p.settemp; o.d5 = (p.fanRaw << 4) | (p.swing ? 0x08 : 0) | p.modeRaw; o.hardLock = !!p.remoteLock;
    o.sp = toF(p.settemp);
  }
  o.room = p.room != null ? toF(p.room) : null;
  if (p.pipeIn != null) o.pipeIn = toF(p.pipeIn);
  if (p.pipeOut != null) o.pipeOut = toF(p.pipeOut);
  o.err = !!p.err; o.code = p.err ? ('CH' + String(p.err).padStart(2, '0')) : null;   // CH04, not CH4: the same name the error reference uses
  o.eev = p.eev; o.capK = p.cap; o.sysLoad = p.load; o.autoSide = p.autoSide; o.filterSign = !!p.filter; o.oilAlarm = !!p.oilAlarm;
  o.offline = false; o.seen = now;
  return o;
}
/* cmd4 lock frame — byte-identical to cortex.html cmd4BytesFor. */
function cmd4Bytes(u) {
  const bandLo = u.c4b5 != null ? ((u.c4b5 & 0x0F) + 15) : 18, bandHi = u.c4b6 != null ? ((u.c4b6 & 0x0F) + 15) : 30;
  const lo = u.rangeLock ? Math.max(18, Math.min(30, bandLo)) : 18, hi = u.rangeLock ? Math.max(lo, Math.min(30, bandHi)) : 30;
  const b4 = 0x01 | (u.tempLock ? 0x02 : 0) | (u.fanLock ? 0x04 : 0) | (u.modeLock ? 0x08 : 0);
  const b = [0xA0, 0x00, 0xA0, u.addr & 0xFF, b4, 0x80 | (lo - 15), (hi - 15) & 0x0F, 0]; b[7] = ck(b, 7); return b;
}
const CMD_KEYS = ['on', 'mode', 'fan', 'swing', 'coolC', 'heatC', 'twoset', 'modeLock', 'fanLock', 'tempLock', 'hardLock', 'rangeLock', 'c4b5', 'c4b6'];
function commandPatch(state) {
  const o = {}; CMD_KEYS.forEach(k => { if (state[k] !== undefined && state[k] !== null) o[k] = state[k]; });
  return o;
}

/*
 * createMaster(io)
 *   io.openPort()            -> Promise<port> (serialport-like: write(buf,cb), drain(cb), on('data'), close(cb), isOpen)
 *   io.getUnits()            -> current unit records
 *   io.patchUnits([{addr, fields}])   merge live fields into the stored records
 *   io.drain()               -> queued commands [{addr, state}]
 *   io.oduAddrs()            -> outdoor unit addresses to read
 *   io.onOdu(frame)          one 64-byte monitor page
 *   io.onPass(ms)            end of every pass
 *   io.scanNext(n)           (optional) up to n addresses to look for new units at, a few per pass; [] when no search is on
 *   io.onScanReply(addr, reply|null)   what that address answered (the same safe cmd0 read as polling)
 *   io.log(text)
 */
function createMaster(io) {
  const S = { active: false, stopping: false, port: null, rx: [], passMs: 0, lastPassAt: 0, startedAt: 0, oduAt: 0, miss: new Map(), hold: new Map(), error: null, passes: 0 };
  let done = null;
  const write = (bytes) => new Promise((resolve, reject) => { const p = S.port; if (!p || !p.isOpen) return reject(new Error('port closed'));
    p.write(Buffer.from(bytes), (e) => e ? reject(e) : p.drain((e2) => e2 ? reject(e2) : resolve())); });
  async function exchange(tx, finder, timeout) {
    S.rx = []; await write(tx);
    const t0 = Date.now(); let hit = null;
    while (!S.stopping && Date.now() - t0 < TURNAROUND + timeout) { hit = finder(S.rx); if (hit) break; await sleep(8); }
    if (hit) await sleep(TURNAROUND);
    return hit;
  }
  async function sendCommand(u) {
    const basic = cmd0Bytes(u), lock = cmd4Bytes(u);
    for (let i = 0; i < 5 && !S.stopping; i++) { await write(basic); await sleep(140); }
    for (let i = 0; i < 3 && !S.stopping; i++) { await write(lock); await sleep(140); }
    S.hold.set(u.addr, Date.now() + 15000);   // early replies are the outdoor unit's cached copy of the command (kit ch.04 §3.3)
  }
  async function drainCommands() {
    const cmds = io.drain() || []; if (!cmds.length) return;
    const units = io.getUnits();
    for (const c of cmds) {
      if (S.stopping) break;
      const u = units.find(x => x.addr === c.addr); if (!u || !c.state || c.addr === 0xFF) continue;
      const fields = commandPatch(c.state), next = Object.assign({}, u, fields);
      if (c.state.filterReset === true) next.filterReset = true;   // one-shot: rides this frame only, never stored on the unit
      const act = next.mode === 'heat' ? next.heatC : next.coolC; if (act != null && isFinite(act)) fields.sp = toF(act);
      try { await sendCommand(next); io.patchUnits([{ addr: u.addr, fields }]); io.log('command sent to 0x' + u.addr.toString(16)); }
      catch (e) { io.log('command to 0x' + u.addr.toString(16) + ' failed: ' + e.message); }
    }
  }
  async function readOdu(addr) {
    if (addr === 0xFF || addr < 0 || addr > 0xFE) return;
    const p0 = await exchange(oduQuery(addr, 0), rx => findOduPage(rx, addr), REPLY_WAIT); if (!p0) return;
    io.onOdu(p0);
    const subs = Math.min(3, p0[15] >> 5);
    for (let p = 2; p < subs + 2 && !S.stopping; p++) { await sleep(1100); const f = await exchange(oduQuery(addr, p), rx => findOduPage(rx, addr), REPLY_WAIT); if (f) io.onOdu(f); }
    if (S.stopping) return;
    await sleep(1100); const f5 = await exchange(oduQuery(addr, 5), rx => findOduPage(rx, addr), REPLY_WAIT); if (f5) io.onOdu(f5);
  }
  async function loop() {
    while (!S.stopping) {
      const t0 = Date.now(), patches = [];
      const addrs = (io.getUnits() || []).map(u => u.addr).filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF);
      const probes = io.scanNext ? (io.scanNext(SCAN_STEP) || []).filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF) : [];
      if (!addrs.length && !probes.length) { await sleep(1000); continue; }
      for (const a of addrs) {
        if (S.stopping) break;
        const f = await exchange(readQuery(a), rx => findReply16(rx, a), REPLY_WAIT);
        if (f) { S.miss.set(a, 0); patches.push({ addr: a, fields: replyPatch(parseReply(f), (S.hold.get(a) || 0) > Date.now(), Date.now()) }); }
        else { const m = (S.miss.get(a) || 0) + 1; S.miss.set(a, m); if (m >= 3) patches.push({ addr: a, fields: { offline: true } }); }
        await sleep(TURNAROUND);
        if (patches.length >= 8) io.patchUnits(patches.splice(0));       // keep other screens fresh on a big site
      }
      if (patches.length) io.patchUnits(patches);
      // a search for new units: a few addresses each pass, so the units already known keep updating meanwhile
      for (const a of probes) { if (S.stopping) break;
        const f = await exchange(readQuery(a), rx => findReply16(rx, a), SCAN_WAIT);
        try { io.onScanReply(a, f ? parseReply(f) : null); } catch (_) {}
        await sleep(TURNAROUND); }
      if (S.stopping) break;
      await drainCommands();
      if (!S.stopping && Date.now() - S.oduAt > ODU_EVERY) { S.oduAt = Date.now();
        for (const oa of (io.oduAddrs() || [])) { if (S.stopping) break; await readOdu(oa); await sleep(TURNAROUND); } }
      S.passMs = Date.now() - t0; S.lastPassAt = Date.now(); S.passes++;
      if (io.onPass) io.onPass(S.passMs);
      if (S.passMs < MIN_PASS && !S.stopping && !probes.length) await sleep(MIN_PASS - S.passMs);
    }
  }
  async function start() {
    if (S.active) return false;
    S.active = true; S.stopping = false; S.error = null; S.startedAt = Date.now(); S.oduAt = 0;
    done = (async () => {
      try {
        S.port = await io.openPort();
        S.port.on('data', (buf) => { for (const x of buf) S.rx.push(x); if (S.rx.length > 4096) S.rx.splice(0, S.rx.length - 1024); if (io.onBytes) io.onBytes(buf.length); });
        S.port.on('error', (e) => { S.error = e.message; S.stopping = true; });
        S.port.on('close', () => { S.stopping = true; });
        io.log('poll loop started on the controller');
        await sleep(300);
        await loop();
      } catch (e) { S.error = e.message; io.log('poll loop stopped: ' + e.message); }
      finally {
        try { if (S.port && S.port.isOpen) await new Promise(r => S.port.close(() => r())); } catch (_) {}
        S.port = null; S.active = false; S.stopping = false;
        io.log('poll loop ended');
        if (io.onEnd) io.onEnd();
      }
    })();
    return true;
  }
  async function stop() { if (!S.active) return; S.stopping = true; try { await done; } catch (_) {} }
  const alive = () => S.active && !S.stopping && (S.lastPassAt ? Date.now() - S.lastPassAt < Math.max(45000, S.passMs * 3) : Date.now() - S.startedAt < 60000);
  return { start, stop, alive, state: S };
}

module.exports = { T_AIR, T_PIPE, createMaster, parseReply, replyPatch, cmd4Bytes, commandPatch, readQuery, oduQuery, findReply16, findOduPage, ck };
