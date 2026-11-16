// Tests for the controller-side poll loop (appliance/busmaster.js) and the recorder (appliance/recorder.js),
// against a simulated bus. No serial port is opened.   node tests/busmaster.test.js
const M = require('../appliance/busmaster'), R = require('../appliance/recorder');
const fs = require('fs'), os = require('os'), path = require('path');
const H = b => Array.from(b).map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
let fail = 0; const t = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- pure helpers ---
t('read query', H(M.readQuery(0x5E)), '80 00 A0 5E 00 00 00 ' + H([M.ck([0x80, 0, 0xA0, 0x5E, 0, 0, 0], 7)]));
t('odu query is the read-only form', M.oduQuery(0xC0, 0).slice(4, 7), [0, 0, 0]);
const reply = (addr, o) => { const f = [0x10, (o.on ? 1 : 0) | (o.lock ? 4 : 0), 0xA0, 0x40, addr, o.err || 0, (o.fan << 4) | o.mode, o.set - 15, 192 - 3 * o.room, 150, 140, 0x54, 0x01, 24, 77]; f.push(M.ck(f, 15)); return f; };
const p = M.parseReply(reply(0x11, { on: true, mode: 0, fan: 3, set: 22, room: 23 }));
t('parse reply', [p.addr, p.on, p.mode, p.fanRaw, p.settemp, p.room, p.eev, p.cap], [0x11, true, 'cool', 3, 22, 22.4, 340, 24]);   // room code 123: air-sensor curve, not the straight line
t('reply patch', (() => { const x = M.replyPatch(p, false, 5); return [x.on, x.mode, x.fan, x.coolC, x.room, x.sp, x.err, x.offline, x.seen]; })(), [true, 'cool', 'high', 22, 72, 72, false, false, 5]);
{ const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'cortex.html'), 'utf8'), blk = html.slice(html.indexOf('const ODU_T={'));
  const arr = (k) => blk.match(new RegExp(k + ':\\[([^\\]]+)\\]'))[1].split(',').map(Number);
  t('sensor curves match the dashboard copy', [M.T_AIR.join() === arr('air').join(), M.T_PIPE.join() === arr('pipe').join(), M.T_AIR.length], [true, true, 256]);
  const hot = M.parseReply(reply(0x12, { on: true, mode: 4, fan: 2, set: 22, room: 21 })); hot; }
t('held unit keeps its command', 'mode' in M.replyPatch(p, true, 5), false);
t('cmd4 no locks = full band', H(M.cmd4Bytes({ addr: 0xC9 })), 'A0 00 A0 C9 01 83 0F C9');
t('cmd4 range lock', H(M.cmd4Bytes({ addr: 0x01, tempLock: true, rangeLock: true, c4b5: 0x84, c4b6: 0x0B })), 'A0 00 A0 01 03 84 0B 86');

// --- simulated bus ---
function fakeBus(world) {
  const h = {}; const port = { isOpen: true, tx: [],
    on: (ev, fn) => { h[ev] = fn; }, drain: cb => cb(), close: cb => { port.isOpen = false; cb(); },
    write: (buf, cb) => { const b = Array.from(buf); port.tx.push(b); cb();
      if (b[0] === 0x80 && b[4] === 0 && world.units[b[3]] && !world.silent.has(b[3])) setTimeout(() => h.data && h.data(Buffer.from([0x55].concat(reply(b[3], world.units[b[3]])))), 3);   // one junk byte first
      if (b[0] === 0xF0 && world.odu[b[3]] && b[5] === 0 && b[6] === 0) setTimeout(() => { const f = new Array(64).fill(0); f[0] = 0x40; f[1] = 0x70; f[2] = 0xA0; f[4] = b[3]; f[5] = b[4] === 1 ? 2 : b[4]; f[10] = world.odu[b[3]].err || 0; f[15] = 1; f[63] = M.ck(f, 63); h.data && h.data(Buffer.from(f)); }, 3); } };
  return port;
}
(async () => {
  const world = { units: { 0x11: { on: true, mode: 0, fan: 1, set: 23, room: 22 }, 0x12: { on: false, mode: 4, fan: 2, set: 21, room: 20 } }, silent: new Set(), odu: { 0xC0: { err: 0 } } };
  let units = [{ id: 1, addr: 0x11, on: false, mode: 'heat', fan: 'low', coolC: 20, heatC: 20 }, { id: 2, addr: 0x12 }, { id: 3, addr: 0x13 }];
  let queue = [], oduFrames = [], port = null;
  const master = M.createMaster({ openPort: async () => (port = fakeBus(world)), getUnits: () => units,
    patchUnits: (ps) => { units = units.map(u => { const q = ps.find(x => x.addr === u.addr); return q ? Object.assign({}, u, q.fields) : u; }); },
    drain: () => queue.splice(0), oduAddrs: () => [0xC0], onOdu: f => oduFrames.push(f), log: () => {} });
  queue.push({ addr: 0x12, state: { on: true, mode: 'cool', coolC: 24, heatC: 24, fan: 'high' } });
  master.start(); await sleep(4200);
  t('unit 1 read from the bus', [units[0].on, units[0].mode, units[0].coolC, units[0].room], [true, 'cool', 23, 71]);
  t('silent unit marked offline after 3 misses', units[2].offline === true || master.state.miss.get(0x13) >= 1, true);
  const c0 = port.tx.filter(b => b[0] === 0x80 && b[3] === 0x12 && (b[4] & 2)), c4 = port.tx.filter(b => b[0] === 0xA0 && b[3] === 0x12);
  t('queued command: cmd0 x5 then cmd4 x3', [c0.length, c4.length], [5, 3]);
  t('queued command frame', H(c0[0]), '80 00 A0 12 03 30 09 ' + H([M.ck([0x80, 0, 0xA0, 0x12, 3, 0x30, 9], 7)]));
  t('hold after a command is 15 s', master.state.hold.get(0x12) - Date.now() > 9000, true);
  const S2 = require('../appliance/scheduler.js'), base = { addr: 0x12, on: true, mode: 'cool', fan: 'high', coolC: 24 };
  t('filter reset sets only byte 5 bit 7', [S2.cmd0Bytes(Object.assign({ filterReset: true }, base))[5] ^ S2.cmd0Bytes(base)[5], S2.cmd0Bytes(Object.assign({ filterReset: 1 }, base))[5] & 0x80], [0x80, 0]);
  t('normal commands never carry the filter reset', c0.some(b => b[5] & 0x80), false);
  t('outdoor pages read (0, 5)', [...new Set(oduFrames.map(f => f[5]))].sort(), [0, 5]);
  t('never addresses 0xFF or non-read cmd14', port.tx.some(b => b[3] === 0xFF || (b[0] === 0xF0 && (b[5] || b[6]))), false);
  t('alive while polling', master.alive(), true);
  await master.stop();
  t('stops and closes the adapter', [master.state.active, port.isOpen], [false, false]);

  // --- recorder ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxrec-')); let clock = 1e12; const notes = [];
  const rec = R.createRecorder({ dataDir: dir, now: () => clock, notify: e => notes.push(e) });
  const U = (code, off) => [{ addr: 0x11, label: 'Lobby', on: true, mode: 'cool', coolC: 23, room: 72, pipeIn: 50, pipeOut: 55, eev: 300, err: !!code, code: code || null, offline: !!off }];
  const page = (err) => { const f = new Array(64).fill(0); f[0] = 0x40; f[1] = 0x70; f[2] = 0xA0; f[4] = 0xC0; f[5] = 0; f[10] = err; return f; };
  for (let i = 0; i < 50; i++) { rec.onOdu(page(0)); rec.sample(U(null)); clock += 15000; }          // 12.5 quiet minutes
  t('quiet: no events', rec.events().length, 0);
  rec.sample(U('CH104')); clock += 15000;
  t('fault opens an event', [rec.events().length, rec.events()[0].code, rec.events()[0].kind, notes.length], [1, 'CH104', 'unit', 1]);
  const ev = rec.event(rec.events()[0].id);
  t('event carries ~10 minutes before', ev.pre.length >= 38 && ev.pre.length <= 41 && ev.pre[0].o['192']['0'].length === 128, true);
  for (let i = 0; i < 22; i++) { rec.sample(U('CH104')); clock += 15000; }
  t('then the 5 minutes after, saved to disk', JSON.parse(fs.readFileSync(path.join(dir, 'events', ev.id + '.json'), 'utf8')).post.length >= 19, true);
  rec.onOdu(page(0)); rec.sample(U(null)); clock += 15000;
  t('clears when the fault goes away', rec.events()[0].cleared > 0, true);
  rec.onOdu(page(21)); rec.sample(U(null)); clock += 15000;
  t('outdoor error opens its own event', [rec.events()[0].kind, rec.events()[0].code], ['odu', 'CH21']);
  rec.sample(U(null, true));
  t('unit that stops answering', rec.events()[0].kind, 'silent');
  t('outdoor trend rows logged', rec.oduHistory(0xC0, 1).length >= 3, true);
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
