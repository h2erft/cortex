// Controller-side cycle diagnosis: rules are lifted from cortex.html and must persist before alerting.
const fs = require('fs'), os = require('os'), path = require('path');
const { createDiagWatch, loadRules, HOLD } = require('../appliance/diagwatch');
let fail = 0; const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
const html = path.join(__dirname, '..', 'cortex.html');
const page = (hz) => { const f = new Array(64).fill(0); f[0] = 0x40; f[1] = 0x70; f[2] = 0xA0; f[4] = 0xC0; f[6] = 0; f[7] = 0x0E; f[15] = 1; f[17] = hz; f[23] = 120; f[24] = 90; f[22] = 120; return Buffer.from(f).toString('hex'); };
const mk = (id, o) => Object.assign({ id, addr: id, name: 'Unit ' + id, odu: 0xC0, on: true, offline: false, mode: 'cool', room: 24, coolC: 22, pipeIn: 11, pipeOut: 14, eev: 340 }, o);
(async () => {
  const box = loadRules(html); ok('rules load from the dashboard file', typeof box.__dx.cycleDiagnose === 'function');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxdiag-')); let t = 1e12, units, sent = [];
  const w = createDiagWatch({ dataDir: dir, htmlPath: html, now: () => t, getUnits: () => units, getOdu: () => ({ 192: { at: t, pages: { 0: { hex: page(40), at: t } } } }), notify: a => { if (/blocked/.test(a.title)) sent.push(a); } });
  const blk = () => w.list().filter(a => /blocked/.test(a.title));   // the synthetic outdoor page is not a believable cycle, so only the indoor rule is asserted
  ok('enabled', w.state().enabled);
  // a unit that is satisfied: EEV parked at 40 and room-temperature pipes is NOT a blockage
  units = [mk(1), mk(2), mk(3), mk(9, { room: 22, coolC: 23, pipeIn: 21.6, pipeOut: 21.9, eev: 40 })];
  for (let i = 0; i < HOLD + 2; i++) { t += 60000; w.run(); }
  ok('parked EEV (40 pls, satisfied) raises nothing', sent.length === 0 && blk().length === 0);
  // calling, valve driven open, pipes still at room temperature: that is the blocked picture
  units[3] = mk(9, { room: 26, coolC: 22, pipeIn: 25.4, pipeOut: 25.8, eev: 96 });
  for (let i = 0; i < HOLD - 1; i++) { t += 60000; w.run(); }
  ok('not raised before it has persisted', sent.length === 0);
  t += 60000; w.run();
  ok('raised once after ' + HOLD + ' checks', sent.length === 1 && /fully blocked/.test(sent[0].title) && sent[0].who === 9 && !/</.test(sent[0].title + sent[0].todo));
  for (let i = 0; i < 5; i++) { t += 60000; w.run(); } ok('not raised twice', sent.length === 1 && blk()[0].last === t);
  units[3] = mk(9);
  for (let i = 0; i < HOLD; i++) { t += 60000; w.run(); }
  ok('clears after it has gone', blk()[0].cleared === t && JSON.parse(fs.readFileSync(path.join(dir, 'advisories.json'), 'utf8')).some(a => /blocked/.test(a.title) && a.cleared));
  const bad = createDiagWatch({ dataDir: dir, htmlPath: path.join(dir, 'missing.html'), getUnits: () => [], getOdu: () => ({}) });
  ok('missing dashboard file disables it without throwing', bad.state().enabled === false && !!bad.state().error && (bad.run(), true));
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
