// Fleet watch: what it reports, what it stays quiet about, and that fleet alerts only reach devices that asked.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createFleetWatch, cleanSites, cleanUrl } = require('../appliance/fleetwatch');
const { createPush } = require('../appliance/push');
let fail = 0; const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
(async () => {
  ok('addresses are reduced to an origin', cleanUrl('10.0.0.5:8080/x?y=1') === 'http://10.0.0.5:8080' && cleanUrl('https://a.ts.net/') === 'https://a.ts.net' && cleanUrl('ftp://x') === '' && cleanUrl('javascript:alert(1)') === '');
  ok('site list is cleaned and capped', cleanSites([{ id: 'a', name: 'A', url: 'h1' }, { id: 'a', url: 'h2' }, { id: 'b' }, null, 7]).length === 1 && cleanSites(new Array(80).fill(0).map((_, i) => ({ id: 's' + i, url: 'h' + i }))).length === 50);

  const world = { a: { up: true, units: [{ addr: 1 }, { addr: 2 }], adv: [] }, b: { up: true, units: [{ addr: 1 }], adv: [] } }, calls = [];
  const fake = async (url) => { calls.push(url); const u = new URL(url), w = world[u.hostname]; if (!w || !w.up) throw new Error('down');
    const body = u.pathname === '/health' ? { ok: true } : u.pathname === '/api/units' ? { units: w.units } : u.pathname === '/api/diag' ? { advisories: w.adv } : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxfleet-')); let clock = 1e12, wanted = true; const notes = [];
  const fw = createFleetWatch({ dataDir: dir, fetch: fake, now: () => clock, wanted: () => wanted, notify: n => notes.push(n.site.id + ': ' + n.text) });
  const step = async () => { clock += 60000; return fw.run(); };
  ok('nothing to watch, nothing fetched', await fw.run() === 0 && calls.length === 0);
  fw.setSites([{ id: 'a', name: 'Alpha', url: 'http://a' }, { id: 'b', name: 'Beta', url: 'b' }]);
  await step(); ok('first look only records state', notes.length === 0 && fw.state().a.online === true && fw.state().a.err === 0);
  ok('only read-only paths are requested', calls.every(u => /\/(health|api\/units|api\/diag)$/.test(u)));
  await step(); ok('no change, no alert', notes.length === 0);
  world.a.units[0].code = 'CH104'; await step(); ok('new fault', notes.join() === 'a: 1 unit in error');
  await step(); ok('same fault is not repeated', notes.length === 1);
  world.a.units[1].offline = true; world.a.adv = [{ title: 'x' }, { title: 'old', cleared: 5 }]; await step();
  ok('silent unit and advisory in one message', notes[1] === 'a: a unit stopped answering; new diagnosis advisory');
  world.b.up = false; await step(); ok('one missed look is not an outage', notes.length === 2);
  await step(); ok('two in a row is', notes[2] === 'b: went offline (the controller is not answering)');
  await step(); ok('outage reported once', notes.length === 3);
  world.b.up = true; world.b.units[0].err = 5; await step(); ok('back online, without re-reporting what changed meanwhile', notes[3] === 'b: is back online' && notes.length === 4);
  delete world.a.units[0].code; await step(); world.a.units[0].code = 'CH05'; await step(); ok('a fault that cleared and came back is new again', notes[4] === 'a: 1 unit in error');
  wanted = false; world.a.up = false; await step(); await step(); ok('idle while no device is subscribed', notes.length === 5);
  wanted = true; clock += 3600000; await fw.run(); await step(); ok('after a long pause the first look is silent', notes.length === 5);
  world.c = { up: false }; fw.setSites(fw.sites().concat([{ id: 'c', name: 'Never up', url: 'c' }])); await step(); await step(); await step();
  ok('a building never seen online does not alert', !notes.some(n => /^c:/.test(n)));
  ok('state survives a restart; removed sites are forgotten', createFleetWatch({ dataDir: dir, fetch: fake }).sites().length === 3 && (fw.setSites([{ id: 'a', url: 'a' }]), Object.keys(fw.state()).join() === 'a'));

  // push: the fleet flag is separate from the site-alert kinds
  const rx = (n) => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); return { endpoint: 'https://push.example/' + n, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }; };
  const sent = [], p = createPush({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cxfp-')), fetch: async (url) => { sent.push(url.split('/').pop()); return { ok: true, status: 201 }; } });
  const both = rx('both'), cmd = rx('cmd'), site = rx('site');
  p.subscribe(both, 'will', ['fault']); p.subscribe(both, 'will', undefined, { fleet: true });       // Cortex first, then Command
  p.subscribe(cmd, 'will', undefined, { fleet: true }); p.subscribe(site, 'tech');
  ok('Command does not overwrite the Cortex choices', JSON.stringify(p.info(both.endpoint)) === '{"fleet":true,"kinds":["fault"]}' && p.fleetCount() === 2);
  await p.send({ title: 't' }, 'fleet'); ok('fleet alerts go only to devices that asked', sent.sort().join() === 'both,cmd'); sent.length = 0;
  await p.send({ title: 't' }, 'fault'); ok('a Command-only device gets no site alerts', sent.sort().join() === 'both,site'); sent.length = 0;
  p.subscribe(both, 'will', ['fault', 'diag']); ok('Cortex re-sync keeps the fleet flag', p.info(both.endpoint).fleet === true && p.info(both.endpoint).kinds.length === 2);
  p.subscribe(cmd, 'will', undefined, { fleet: false }); p.subscribe(both, 'will', undefined, { fleet: false });
  ok('turning fleet off removes a Command-only device and keeps the other', p.info(cmd.endpoint) === null && p.info(both.endpoint).fleet === false && p.count() === 2);
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
