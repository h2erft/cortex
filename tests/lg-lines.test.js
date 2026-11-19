// More than one LG line: a real controller, two pretend adapters (two separate wires) with different
// units behind each, both polled at the same time. A unit search on the second line, units that say
// which line they are on, and commands that go out on the right wire only.
//   node tests/lg-lines.test.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const PORT = 18491, BASE = 'http://localhost:' + PORT, ROOT = path.resolve(__dirname, '..');
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clg-')), data = path.join(tmp, 'data'), dir = path.join(tmp, 'by-id'); fs.mkdirSync(dir);
const J = async (p, o) => { const r = await fetch(BASE + p, o); const j = await r.json(); j._status = r.status; return j; }, post = (p, b, m) => J(p, { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const until = async (f, ms) => { const t0 = Date.now(); let v; while (!(v = await f()) && Date.now() - t0 < (ms || 8000)) await sleep(200); return v; };
const sims = [], heard = (i) => { try { return +fs.readFileSync(path.join(tmp, 'count' + i), 'utf8') || 0; } catch (_) { return 0; } };
const sim = (i, addrs) => new Promise((res, rej) => { const s = spawn('python3', [path.join(__dirname, 'helpers', 'bus-sim.py'), path.join(tmp, 'count' + i)].concat(addrs.map(String)), { stdio: ['ignore', 'pipe', 'inherit'] }); sims.push(s);
  s.stdout.once('data', d => res(String(d).trim())); setTimeout(() => rej(new Error('no pretend adapter')), 5000); });
const unit = (id, addr, extra) => Object.assign({ id, addr, name: 'U' + addr, label: 'Unit ' + addr, group: 'G', grp: 'G', kind: 'fcu', on: false, mode: 'cool', fan: 'auto', sp: 72, coolC: 22, heatC: 22, room: null, offline: true }, extra || {});
(async () => {
  let srv, browser;
  try {
    const d1 = await sim(1, [5, 6, 'o20']), d2 = await sim(2, [9, 10, 5, 'o33']);             // address 5 answers on both wires: a clash to be reported
    const names = ['-if00', '-if02', '-if04', '-if06'].map(x => 'usb-1a86_USB_Quad_Serial_TEST001234' + x), spare = path.join(tmp, 'spare'); fs.writeFileSync(spare, '');
    [d1, d2, spare, spare + '2'].forEach((t, i) => { if (i === 3) fs.writeFileSync(t, ''); fs.symlinkSync(t, path.join(dir, names[i])); });
    const ch = names.map(n => path.join(dir, n));
    srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: ch[0], CORTEX_SERIAL_DIR: dir }) });
    await until(async () => { try { return (await fetch(BASE + '/health')).ok; } catch (_) { return false; } }, 15000);
    await post('/api/units', { units: [unit(1, 5), unit(2, 6)] }, 'PUT');
    let r = await J('/api/lg-lines'); ok('a site starts with one LG line', r.lines.length === 0 && r.first.units === 2, JSON.stringify(r));
    r = await post('/api/lg-lines', { port: ch[0] }); ok('a second line cannot take the first line\'s adapter', r._status === 400 && /first LG line/.test(r.err), JSON.stringify(r));
    r = await post('/api/lg-lines', { port: '/dev/ttyS9' }); ok('nor an adapter that is not there', r._status === 400);
    r = await post('/api/lg-lines', { port: ch[1], name: 'North wing' }); const id = r.line && r.line.id;
    ok('a second LG line is added on channel 2', r.ok && id === 2 && r.line.name === 'North wing' && /channel 2 of 4/.test(r.line.label) && r.line.on === true, JSON.stringify(r));
    r = await post('/api/lg-lines', { port: ch[1] }); ok('two lines cannot share a channel', r._status === 400 && /North wing/.test(r.err), JSON.stringify(r));
    await until(async () => (await J('/api/lg-lines')).lines[0].open, 6000);
    ok('adding a line only listens: nothing was sent on either wire', heard(1) === 0 && heard(2) === 0, heard(1) + ' ' + heard(2));
    r = await post('/api/lg-lines/' + id + '/scan', {}); ok('a search is refused until Cortex is the master on this site', r._status === 409, JSON.stringify(r));
    // --- live polling on: the first line polls its own two units only
    await post('/api/bus', { on: true }); await post('/api/master-mode', { on: true });
    let u = await until(async () => { const x = (await J('/api/units')).units; return x.every(y => !y.offline) ? x : null; }, 12000);
    ok('the first line reads its units', !!u && heard(1) > 0, JSON.stringify(u && u.map(x => x.offline)));
    ok('and the second wire is still silent: it has no units and no search', heard(2) === 0, String(heard(2)));
    // --- search the second line
    r = await post('/api/lg-lines/' + id + '/scan', {}); ok('the search starts', r.ok && r.line.scan && r.line.scan.running, JSON.stringify(r));
    const L = await until(async () => { const x = (await J('/api/lg-lines')).lines[0]; return x.scan && !x.scan.running ? x : null; }, 240000);
    ok('the search finds the units on that wire', !!L && L.found.map(f => f.addr).join() === '5,9,10', JSON.stringify(L && L.found));
    ok('and reports the address that is already in Cortex on the first line', !!L && L.found[0].onLine === 1 && L.found[1].onLine === 0, JSON.stringify(L && L.found));
    ok('the first line kept updating during the search', (await J('/api/units')).units.every(x => !x.offline));
    // --- the screen imports the new units onto line 2
    let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); return { cfg, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username }; }); await seed.context().close(); await post('/api/appconfig', site.cfg);
    const ctx = await browser.newContext({ viewport: { width: 1320, height: 1000 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, site.tech);
    const P = await ctx.newPage(), errs = []; P.on('pageerror', e => errs.push(String(e))); P.on('dialog', d => d.accept()); await P.goto(BASE + '/'); await P.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && units.length === 2, null, { timeout: 20000 });
    await P.evaluate(() => { view = 'busscan'; renderAll(); }); await P.waitForSelector('#bus-brand button[data-bb="lg:2"]', { timeout: 10000 });
    ok('Bus scan shows a tab for each LG line', await P.evaluate(() => [...document.querySelectorAll('#bus-brand button')].map(b => b.textContent).join('|')) === 'LG line 1|North wing');
    await P.click('#bus-addline'); await P.waitForSelector('#lgl-p'); const opts = await P.evaluate(() => [...document.querySelectorAll('#lgl-p option')].map(o => (o.disabled ? 'x ' : 'ok ') + o.textContent));
    ok('adding a line offers only the free channels', opts.length === 4 && /^x .*LG line 1/.test(opts[0]) && /^x .*North wing/.test(opts[1]) && /^ok /.test(opts[2]) && /^ok /.test(opts[3]), opts.join(' || '));
    await P.evaluate(() => closeModal()); await P.click('#bus-brand button[data-bb="lg:2"]'); await P.waitForSelector('#lgl-imp');
    let txt = await P.evaluate(() => document.getElementById('main').innerText);
    ok('the line page lists what the search found and flags the clash', /Add 2 new units/.test(txt) && /Already in Cortex/.test(txt) && /0x09/i.test(txt) && /channel 2 of 4/.test(txt), txt.slice(0, 600));
    if (process.env.SHOTS) { await P.waitForTimeout(900); await P.screenshot({ path: process.env.SHOTS + 'lg-line.png', fullPage: true }); }
    await P.click('#lgl-imp');
    u = await until(async () => { const x = (await J('/api/units')).units; return x.length === 4 ? x : null; }, 10000);
    ok('the new units are added on line 2, with addresses and line recorded', !!u && u.filter(x => x.bus === id).map(x => x.addr).sort().join() === '10,9' && u.filter(x => !x.bus).length === 2, JSON.stringify(u && u.map(x => [x.addr, x.bus])));
    u = await until(async () => { const x = (await J('/api/units')).units; return x.length === 4 && x.every(y => !y.offline && y.room != null) ? x : null; }, 15000);
    ok('both lines are polled at the same time: all four units live', !!u, JSON.stringify((await J('/api/units')).units.map(x => [x.addr, x.bus, x.offline])));
    r = await J('/api/lg-lines'); ok('the line reports polling its two units', r.lines[0].polling && r.lines[0].units === 2 && r.first.units === 2, JSON.stringify(r.lines[0]));
    txt = await until(async () => { const x = await P.evaluate(() => { updateBusHealth(); return document.getElementById('bus-label').textContent; }); return /All 2 buses online/.test(x) ? x : null; }, 12000);
    ok('the header light counts both LG lines', !!txt, await P.evaluate(() => document.getElementById('bus-label').textContent + ' ' + JSON.stringify(busList())));
    ok('the line page shows its units and that it is polling', await until(async () => P.evaluate(() => { renderBusScan(); return /Polling/.test(document.getElementById('lgl-state').textContent) && document.querySelectorAll('[data-lglu]').length === 2; }), 8000));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    r = await J('/api/bus'); ok('every screen is told about every line', Array.isArray(r.lines) && r.lines.length === 1 && r.lines[0].open && r.polling, JSON.stringify(r.lines));
    // --- outdoor units: the controller searches every line itself; no screen holds the adapter
    await P.evaluate(() => { view = 'cycle'; renderAll(); }); await P.waitForSelector('#odu-sfind', { timeout: 20000 });
    ok('the Outdoor page offers Read and Find without a screen holding the adapter', await P.evaluate(() => !!document.getElementById('odu-sread') && /Find outdoor units/.test(document.getElementById('odu-sfind').textContent)));
    await P.click('#odu-sfind'); r = await until(async () => { const x = (await J('/api/odu')).find; return x && !x.running ? x : null; }, 240000);
    ok('the search finds the outdoor unit on each wire', !!r && r.found.join() === '20,33' && r.lines === 2, JSON.stringify(r));
    r = await J('/api/odu'); ok('and remembers which line each one is on, and keeps reading them', r.lineOf['20'] === 0 && r.lineOf['33'] === 2 && r.addrs.includes(20) && r.addrs.includes(33) && !!r.odu['20'] && !!r.odu['33'], JSON.stringify([r.lineOf, r.addrs, Object.keys(r.odu)]));
    ok('units kept updating during the outdoor search', (await J('/api/units')).units.every(x => !x.offline));
    await P.evaluate(() => { view = 'busscan'; busBrand = 'lg:2'; renderAll(); });
    // --- a command for a unit on line 2 goes out on wire 2 only
    await sleep(3000); const h1 = heard(1), h2 = heard(2), passes = async () => { await sleep(100); return [heard(1), heard(2)]; };
    await post('/api/cmd', { addr: 9, state: { on: true, mode: 'cool', coolC: 21 } });
    await sleep(6000); const g1 = heard(1) - h1, g2 = heard(2) - h2;
    // wire 1 hears only whole passes of two 8-byte reads; wire 2 hears its reads plus the command's 8 frames
    ok('a command for a unit on line 2 is sent on wire 2 only', g1 % 16 === 0 && g2 - g1 >= 40 && (await J('/api/units')).units.find(x => x.addr === 9).on === true, 'wire 1 +' + g1 + ', wire 2 +' + g2);
    // --- disconnecting line 2 leaves line 1 alone
    r = await post('/api/lg-lines', { id, on: false }); await sleep(1500); const q2 = heard(2); await sleep(4000);
    ok('disconnecting line 2 stops all traffic on that wire', r.ok && r.line.on === false && heard(2) === q2, q2 + ' ' + heard(2));
    ok('while line 1 carries on', (await J('/api/bus')).polling === true);
    ok('the choice is saved', JSON.parse(fs.readFileSync(path.join(data, 'lg-lines.json'), 'utf8')).lines[0].on === false);
    r = await post('/api/lg-lines/' + id, {}, 'DELETE'); u = (await J('/api/units')).units;
    ok('removing the line keeps its units but marks them not responding', r.ok && u.length === 4 && u.filter(x => x.bus === id).every(x => x.offline) && (await J('/api/lg-lines')).lines.length === 0, JSON.stringify(u.map(x => [x.addr, x.offline])));
    const hh = heard(1); await sleep(4000); ok('the first line never asks for the removed line\'s units', (await J('/api/units')).units.filter(x => !x.bus).every(x => !x.offline) && heard(1) > hh);
  } catch (e) { ok('test ran', false, String(e && e.stack || e)); }
  if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); sims.forEach(s => s.kill()); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
