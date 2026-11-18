// Alarms from equipment that is not on the LG bus (Rheem / Ruud today) go into the same fault history.
//   node tests/recorder-external.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const { createRecorder } = require('../appliance/recorder');
let fail = 0; const ok = (n, c, d) => { if (c) console.log('ok   ' + n); else { fail++; console.log('FAIL ' + n + (d ? '\n   ' + d : '')); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-rec-')), told = [];
const mk = () => createRecorder({ dataDir: dir, notify: (e) => told.push(e.kind + ':' + e.code) });
let r = mk(); const idx = () => JSON.parse(fs.readFileSync(path.join(dir, 'events', 'index.json'), 'utf8'));
r.external('econet', 's1', 'Front office', [{ code: 'A021_A Restricted Airflow', snap: { SPT: 72 } }], { sysKind: 'hvac' }, 1000);
let e = idx(); ok('a new alarm opens one event and notifies once', e.length === 1 && e[0].brand === 'econet' && e[0].kind === 'sys' && e[0].name === 'Front office' && e[0].addr === null && !e[0].cleared && told.join() === 'sys:A021_A Restricted Airflow', JSON.stringify(e));
r.external('econet', 's1', 'Front office', [{ code: 'A021_A Restricted Airflow' }], { sysKind: 'hvac' }, 2000);
ok('the same alarm seen again does not open a second event', idx().length === 1 && told.length === 1);
ok('what the system was reporting is kept with the event', JSON.parse(fs.readFileSync(path.join(dir, 'events', e[0].id + '.json'), 'utf8')).snap.SPT === 72);
r.external('econet', 's1', 'Front office', [{ code: 'A021_A Restricted Airflow' }, { code: 'No answer', kind: 'silent' }], { sysKind: 'hvac' }, 3000);
e = idx(); ok('going quiet is its own event, of the silent kind', e.length === 2 && e.some(x => x.kind === 'silent' && !x.cleared) && told[1] === 'silent:No answer', JSON.stringify(e));
r.external('econet', 's2', 'Water heater', [{ code: 'A107' }], { sysKind: 'hpwh' }, 3500);
r = mk();                                                                        // a restart must not forget what is open
r.external('econet', 's1', 'Front office', [], { sysKind: 'hvac' }, 4000);
e = idx(); ok('when the alarms go away their events close, and only that system\'s', e.filter(x => x.key === 'econet:s1').every(x => x.cleared === 4000) && e.filter(x => x.key === 'econet:s2').every(x => !x.cleared) && e.length === 3, JSON.stringify(e));
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
