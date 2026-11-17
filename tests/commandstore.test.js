// Shared Cortex Command data on the home controller: revisions, conflicts, what is and is not kept.
//   node tests/commandstore.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const { createCommandStore, cleanDoc } = require('../appliance/commandstore');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdstore-')), file = path.join(dir, 'command-data.json');
let t = 1000; const mk = () => createCommandStore({ file, now: () => t });
const doc = (n) => ({ sites: [{ id: 's1', name: n, addr: '10.0.0.5:8080' }], techs: [], grants: [], audit: [], acks: {}, snooze: {}, acct: { user: 'will', name: 'Will', passhash: 'abc', recovery: 'CORTEX-SECRET-1234' } });
let s = mk();
eq('empty at first', s.get(), { ok: true, rev: 0, ts: 0, doc: null });
eq('first save', s.put({ base: 0, doc: doc('A') }).body, { ok: true, rev: 1, ts: 1000 });
eq('recovery code never stored', [JSON.stringify(s.get().doc).includes('SECRET'), s.get().doc.acct], [false, { user: 'will', name: 'Will', passhash: 'abc' }]);
t = 2000; eq('save from the right revision', s.put({ base: 1, doc: doc('B') }).body.rev, 2);
const c = s.put({ base: 1, doc: doc('STALE') }); eq('stale save refused with the current copy', [c.status, c.body.conflict, c.body.rev, c.body.doc.sites[0].name], [409, true, 2, 'B']);
eq('nothing changed by the refused save', s.get().doc.sites[0].name, 'B');
eq('save with no base always lands (restore from a backup)', s.put({ doc: doc('C') }).body.rev, 3);
eq('survives a restart', [mk().get().rev, mk().get().doc.sites[0].name], [3, 'C']);
eq('junk refused', [s.put({ doc: null }).status, s.put({ doc: [] }).status, s.put({ doc: { sites: 'x' } }).status, s.put({}).status], [400, 400, 400, 400]);
const big = doc('big'); big.sites[0].log = new Array(3000).fill({ t: 1, by: 'x', m: 'y'.repeat(100) });
eq('too large refused', s.put({ base: 3, doc: big }).status, 413);
eq('clean: drops bad sites and unknown keys', cleanDoc({ sites: [{ id: 's1' }, null, { name: 'no id' }], evil: 1, techs: 'x' }), { sites: [{ id: 's1' }], techs: [], grants: [], audit: [], acks: {}, snooze: {} });
fs.writeFileSync(file, '{broken'); eq('a damaged file starts empty instead of crashing', mk().get().rev, 0);
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
