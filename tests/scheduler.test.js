// Tests for the appliance schedule runner (appliance/scheduler.js). Nothing touches a serial port.
//   node tests/scheduler.test.js
const S = require('../appliance/scheduler');
const H = b => b.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
let fail = 0; const t = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };

// frame builder: the community-confirmed 22 C frame, plus half degree, off, heat, hard lock
t('cmd0 22C cool high', H(S.cmd0Bytes({ addr: 0x31, on: true, mode: 'cool', fan: 'high', coolC: 22, heatC: 20 })), '80 00 A0 31 03 30 07 DE');
t('cmd0 half degree', H(S.cmd0Bytes({ addr: 0x31, on: true, mode: 'cool', fan: 'high', coolC: 22.5 })).slice(0, 2), '84');
t('cmd0 off keeps EXE', S.cmd0Bytes({ addr: 0x10, on: false, mode: 'heat', fan: 'low', heatC: 21 })[4], 2);
t('cmd0 heat uses heatC', S.cmd0Bytes({ addr: 0x10, on: true, mode: 'heat', fan: 'low', coolC: 24, heatC: 21 })[6], 6);
t('cmd0 hard lock bit', S.cmd0Bytes({ addr: 0x10, on: true, mode: 'cool', fan: 'low', coolC: 24, hardLock: true })[4], 7);
t('cmd0 checksum', (() => { const b = S.cmd0Bytes({ addr: 0x5E, on: true, mode: 'auto', fan: 'med', coolC: 23 }); return b[7] === S.cksum(b); })(), true);

// due logic in the SITE time zone (Mon 2026-11-16 07:03 in Denver = 14:03 UTC)
const now = new Date('2026-11-16T14:03:00Z'), tz = 'America/Denver';
const base = { id: 'a', enabled: true, time: '07:00', days: [1, 2, 3, 4, 5], action: { power: 'on' }, target: { type: 'all' } };
t('due in site tz', S.dueKey(base, now, tz), '2026-11-16 07:00');
t('not due in UTC reading', S.dueKey(base, now, 'UTC'), null);
t('not due before time', S.dueKey(Object.assign({}, base, { time: '07:05' }), now, tz), null);
t('not due after grace', S.dueKey(Object.assign({}, base, { time: '06:50' }), now, tz), null);
t('wrong weekday', S.dueKey(Object.assign({}, base, { days: [0, 6] }), now, tz), null);
t('disabled', S.dueKey(Object.assign({}, base, { enabled: false }), now, tz), null);
t('3rd Monday matches', S.dueKey(Object.assign({}, base, { nth: '3' }), now, tz), '2026-11-16 07:00');
t('2nd Monday does not', S.dueKey(Object.assign({}, base, { nth: '2' }), now, tz), null);

// action + targets
const units = [{ id: 1, addr: 0x11, grp: 'Main', subgrp: 'A', on: false, mode: 'cool', fan: 'low', coolC: 24, heatC: 20 },
               { id: 2, addr: 0x12, grp: 'Main', subgrp: '', on: false, mode: 'heat', fan: 'low', coolC: 24, heatC: 20 },
               { id: 3, addr: 0x21, grp: 'Annex', on: true, mode: 'cool', fan: 'high', coolC: 22, heatC: 20 }];
t('targets group', S.targets({ target: { type: 'group', val: 'Main' } }, units).map(u => u.id), [1, 2]);
t('targets sub', S.targets({ target: { type: 'sub', val: 'Main ▸ General' } }, units).map(u => u.id), [2]);
t('action 72F', (() => { const u = S.applyAction(Object.assign({}, units[0]), { power: 'on', mode: 'cool', sp: 72 }, 'F'); return [u.on, u.coolC, u.sp]; })(), [true, 22, 72]);
t('action ignores auto fan', S.applyAction(Object.assign({}, units[0]), { fan: 'auto' }, 'F').fan, 'low');
t('cond below', [S.condOk({ cond: { op: 'below', temp: 30 } }, 25), S.condOk({ cond: { op: 'below', temp: 30 } }, 35), S.condOk({ cond: { op: 'below', temp: 30 } }, null)], [true, false, false]);

// runner: who sends, and that a run happens exactly once
(async () => {
  const mk = (over) => { const st = { fired: {}, queued: [], sent: [], committed: [] };
    const io = Object.assign({ getConfig: () => ({ site: { tz }, schedules: [Object.assign({}, base, { action: { power: 'on', sp: 72 }, unit: 'F' })] }), getUnits: () => units,
      masterAlive: () => false, masterMode: () => true, queue: (a, s) => st.queued.push([a, s]), transmit: async (f) => { st.sent.push(...f); return true; },
      commitUnits: (c) => st.committed.push(...c), getOutdoor: async () => 40, loadFired: () => st.fired, saveFired: (f) => { st.fired = f; } }, over);
    return { st, r: S.createRunner(io) }; };
  let x = mk({}); await x.r.tick(now); await x.r.tick(now);
  t('direct: 3 frames once', x.st.sent.length, 3);
  t('direct: first frame', H(x.st.sent[0]), H(S.cmd0Bytes({ addr: 0x11, on: true, mode: 'cool', fan: 'low', coolC: 22, heatC: 22 })));
  t('direct: state saved', x.st.committed.map(u => [u.id, u.on, u.coolC]), [[1, true, 22], [2, true, 22], [3, true, 22]]);
  t('direct: history', x.r.history[0].result, 'sent');
  x = mk({ masterAlive: () => true }); await x.r.tick(now);
  t('screen connected: queued not sent', [x.st.queued.length, x.st.sent.length], [3, 0]);
  x = mk({ masterMode: () => false }); await x.r.tick(now);
  t('not bus master: nothing written', [x.st.queued.length, x.st.sent.length, x.r.history[0].result], [0, 0, 'skipped-not-master']);
  x = mk({ transmit: async () => false }); await x.r.tick(now);
  t('adapter busy: retried later', Object.keys(x.st.fired).length, 0);
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
