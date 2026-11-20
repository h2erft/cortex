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
    const d1 = await sim(1, [5, 6, 7, 'o20']), d2 = await sim(2, [9, 10, 5, 7, 'o33']);   // 5 and 7 answer on both wires             // address 5 answers on both wires: a clash to be reported
    const names = ['-if00', '-if02', '-if04', '-if06'].map(x => 'usb-1a86_USB_Quad_Serial_TEST001234' + x), spare = path.join(tmp, 'spare'); fs.writeFileSync(spare, '');
    [d1, d2, spare, spare + '2'].forEach((t, i) => { if (i === 3) fs.writeFileSync(t, ''); fs.symlinkSync(t, path.join(dir, names[i])); });
    const ch = names.map(n => path.join(dir, n));
    srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: ch[0], CORTEX_SERIAL_DIR: dir, CORTEX_SCAN_MAX: '40' }) });
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
    // --- one search across every channel, driven from the Bus scan page
    let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); return { cfg, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username }; }); await seed.context().close(); await post('/api/appconfig', site.cfg);
    const ctx = await browser.newContext({ viewport: { width: 1320, height: 1000 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, site.tech);
    const P = await ctx.newPage(), errs = []; P.on('pageerror', e => errs.push(String(e))); P.on('dialog', d => d.accept()); await P.goto(BASE + '/'); await P.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && units.length === 2, null, { timeout: 20000 });
    await P.evaluate(() => { view = 'busscan'; renderAll(); }); await P.waitForSelector('#lgch-search', { timeout: 10000 });
    let txt = await P.evaluate(() => document.getElementById('lgch').innerText);
    ok('Bus scan shows every LG channel on one page', /LG line 1/.test(txt) && /North wing/.test(txt) && /channel 2 of 4/.test(txt) && /2 units on 2 channels/i.test(txt) && await P.evaluate(() => !document.querySelector('#bus-brand button[data-bb^="lg:"]')), txt.slice(0, 500));
    await P.click('#lgch-add'); await P.waitForSelector('#lgl-p'); const opts = await P.evaluate(() => [...document.querySelectorAll('#lgl-p option')].map(o => (o.disabled ? 'x ' : 'ok ') + o.textContent));
    ok('adding a line offers only the free channels', opts.length === 4 && /^x .*LG line 1/.test(opts[0]) && /^x .*North wing/.test(opts[1]) && /^ok /.test(opts[2]) && /^ok /.test(opts[3]), opts.join(' || '));
    await P.evaluate(() => closeModal()); await P.click('#lgch-search');
    let seen = []; const S = await until(async () => { const x = (await J('/api/bus')).search; if (x) seen.push([x.rows.map(q => q.state).join(), x.etaMs, x.probed + '/' + x.toProbe].join(' ')); return x && !x.running ? x : null; }, 120000);
    r = await J('/api/bus');
    ok('the search walks channel 1, then channel 2', !!S && seen.some(q => /^now,next/.test(q)) && seen.some(q => /^done,now/.test(q)) && S.rows.every(q => q.state === 'done'), seen.filter((q, k) => k % 6 === 0).join(' | '));
    ok('channel 1 finds its new unit; units already in Cortex are not asked again', r.line1.found.map(f => f.addr).join() === '7', JSON.stringify(r.line1.found));
    ok('channel 2 skips every address channel 1 answered on, and finds only its own', r.lines[0].found.map(f => f.addr).join() === '9,10', JSON.stringify(r.lines[0].found));
    ok('the time left counts all channels and runs down', (() => { const e = seen.map(q => +q.split(' ')[1]).filter(x => x > 0); return e.length > 3 && e[e.length - 1] < e[1] && S.toProbe === (41 - 2) + (41 - 2 - 1); })(), 'to ask: ' + (S && S.toProbe) + ' · ' + seen.slice(0, 3).join(' | '));
    ok('the units already known kept updating during the search', (await J('/api/units')).units.every(x => !x.offline));
    await P.waitForFunction(() => /Search finished/i.test((document.getElementById('lgch') || {}).innerText || '') && document.getElementById('lgch-imp'), null, { timeout: 15000 }); txt = await P.evaluate(() => document.getElementById('lgch').innerText);
    ok('the page lists what each channel found', /Search finished/i.test(txt) && /Add 3 new units/i.test(txt) && /0x07[^]*LG line 1/.test(txt) && /0x09[^]*North wing/.test(txt), txt.slice(0, 900));
    await P.waitForFunction(() => document.querySelectorAll('#lgt-rows > div').length > 5, null, { timeout: 10000 });
    const feed = await P.evaluate(() => document.getElementById('lgt-rows').innerText);
    ok('the live data box shows traffic from every channel by default', /LG line 1/.test(feed) && /North wing/.test(feed) && /Ask 0x0[56]/i.test(feed) && /Answer from/.test(feed), feed.slice(0, 400));
    await P.click('#lgt-ch button[data-lgt="2"]'); await P.waitForTimeout(3500); const feed2 = await P.evaluate(() => document.getElementById('lgt-rows').innerText);
    ok('picking a channel isolates its traffic', !/LG line 1/.test(feed2) && feed2.length > 20, feed2.slice(0, 300));
    await P.click('#lgt-ch button[data-lgt="all"]');
    if (process.env.SHOTS) { await P.waitForTimeout(1500); await P.screenshot({ path: process.env.SHOTS + 'lg-line.png', fullPage: true }); }
    await P.click('#lgch-imp');
    u = await until(async () => { const x = (await J('/api/units')).units; return x.length === 5 ? x : null; }, 10000);
    ok('the new units are added on the channel that found them', !!u && u.filter(x => x.bus === id).map(x => x.addr).sort().join() === '10,9' && u.filter(x => !x.bus).map(x => x.addr).sort().join() === '5,6,7', JSON.stringify(u && u.map(x => [x.addr, x.bus])));
    // --- searching one channel by itself asks every address, so a clash with another channel shows up
    r = await post('/api/lg-lines/' + id + '/scan', {}); ok('one channel can be searched by itself', r.ok && r.line.scan && r.line.scan.running, JSON.stringify(r));
    const L = await until(async () => { const x = (await J('/api/lg-lines')).lines[0]; return x.scan && !x.scan.running ? x : null; }, 120000);
    ok('and reports addresses that Cortex has on another channel', !!L && L.found.map(f => f.addr + ':' + f.onLine).join() === '5:1,7:1', JSON.stringify(L && L.found));
    await post('/api/lg-lines/search-all', { clear: true });
    u = await until(async () => { const x = (await J('/api/units')).units; return x.length === 5 && x.every(y => !y.offline && y.room != null) ? x : null; }, 15000);
    ok('both lines are polled at the same time: all five units live', !!u, JSON.stringify((await J('/api/units')).units.map(x => [x.addr, x.bus, x.offline])));
    r = await J('/api/lg-lines'); ok('the line reports polling its two units', r.lines[0].polling && r.lines[0].units === 2 && r.first.units === 3, JSON.stringify(r.lines[0]));
    txt = await until(async () => { const x = await P.evaluate(() => { updateBusHealth(); return document.getElementById('bus-label').textContent; }); return /All 2 buses online/.test(x) ? x : null; }, 12000);
    ok('the header light counts both LG lines', !!txt, await P.evaluate(() => document.getElementById('bus-label').textContent + ' ' + JSON.stringify(busList())));
    ok('the channels table shows both polling', await until(async () => P.evaluate(() => { const t = document.getElementById('lgch').innerText; return (t.match(/Polling/g) || []).length === 2 && /5 units on 2 channels/i.test(t); }), 12000));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    r = await J('/api/bus'); ok('every screen is told about every line', Array.isArray(r.lines) && r.lines.length === 1 && r.lines[0].open && r.polling, JSON.stringify(r.lines));
    // --- outdoor units: the controller searches every line itself; no screen holds the adapter
    await P.evaluate(() => { view = 'cycle'; renderAll(); }); await P.waitForSelector('#odu-sfind', { timeout: 20000 });
    ok('the Outdoor page offers Read and Find without a screen holding the adapter', await P.evaluate(() => !!document.getElementById('odu-sread') && /Find outdoor units/.test(document.getElementById('odu-sfind').textContent)));
    await P.click('#odu-sfind'); r = await until(async () => { const x = (await J('/api/odu')).find; return x && !x.running ? x : null; }, 240000);
    ok('the search finds the outdoor unit on each wire', !!r && r.found.join() === '20,33' && r.lines === 2, JSON.stringify(r));
    r = await J('/api/odu'); ok('and remembers which line each one is on, and keeps reading them', r.lineOf['20'] === 0 && r.lineOf['33'] === 2 && r.addrs.includes(20) && r.addrs.includes(33) && !!r.odu['20'] && !!r.odu['33'], JSON.stringify([r.lineOf, r.addrs, Object.keys(r.odu)]));
    ok('units kept updating during the outdoor search', (await J('/api/units')).units.every(x => !x.offline));
    // --- which indoor units belong to which outdoor unit: asked by the controller on the right wire, with retries
    await P.evaluate(() => { view = 'cycle'; renderAll(); }); await P.waitForSelector('#odu-group');
    await P.click('#odu-group'); await P.waitForFunction(() => /Group by outdoor unit/.test((document.querySelector('.modal') || {}).innerText || '') && document.querySelectorAll('.cy-plan').length >= 2, null, { timeout: 200000 });
    const gp = await P.evaluate(() => document.querySelector('.modal').innerText); r = (await J('/api/odu')).members;
    const p20 = r.plan.find(x => x.odu === 20), p33 = r.plan.find(x => x.odu === 33);
    ok('each outdoor unit is asked on its own line and answers, even when its first reply is missed', !!p20 && !!p33 && p20.line === 0 && p33.line === 2 && !!p20.pages && !!p33.pages, JSON.stringify(r.plan.map(x => [x.odu, x.line, !!x.pages])));
    ok('the screen shows both lists and leaves no unit on those wires unclaimed', /Outdoor unit 0x14[^]*reports 3 indoor units/.test(gp) && /Outdoor unit 0x21[^]*reports 4 indoor units/.test(gp) && !/Not claimed/.test(gp), gp.slice(0, 700));
    await P.evaluate(() => closeModal());
    await P.evaluate(() => { view = 'busscan'; busBrand = 'lg:2'; renderAll(); });
    // --- a command for a unit on line 2 goes out on wire 2 only
    const seq0 = (await J('/api/lg-traffic')).seq; await sleep(500);
    await post('/api/cmd', { addr: 9, state: { on: true, mode: 'cool', coolC: 21 } });
    await sleep(6000); const tr = (await J('/api/lg-traffic?since=' + seq0)).rows.filter(x => x.dir === 'tx' && x.hex.slice(6, 8) === '09' && x.hex.slice(0, 2) === '80');
    const on2 = tr.filter(x => x.line === 2), on1 = tr.filter(x => x.line === 0);
    ok('a command for a unit on line 2 is sent on wire 2 only', on1.length === 0 && new Set(on2.map(x => x.hex)).size >= 2 && (await J('/api/units')).units.find(x => x.addr === 9).on === true, 'line 1: ' + on1.length + ', line 2: ' + on2.length + ' frames, ' + new Set(on2.map(x => x.hex)).size + ' different');
    r = (await J('/api/lg-traffic?line=0')).rows; ok('the traffic of one channel can be read by itself, with what was sent and what was heard', r.length > 4 && r.every(x => x.line === 0) && r.some(x => x.dir === 'tx') && r.some(x => x.dir === 'rx' && x.hex.length >= 32), JSON.stringify(r.slice(-3)));
    // --- an edit made while polling is kept, with the controller's newer readings laid over it
    { const a0 = await J('/api/units'); await sleep(3500); const b0 = await J('/api/units');
      const mine = a0.units.map(x => x.addr === 6 ? Object.assign({}, x, { grp: 'Renamed group', room: -99 }) : x), rr = await post('/api/units', { base: a0.rev, units: mine }, 'PUT'), c0 = (await J('/api/units')).units.find(x => x.addr === 6);
      ok('renaming a group while the controller is polling is kept, not thrown away', b0.rev > a0.rev && rr._status === 200 && c0.grp === 'Renamed group' && c0.room !== -99, JSON.stringify([a0.rev, b0.rev, rr._status, c0.grp, c0.room])); }
    // --- disconnecting line 2 leaves line 1 alone
    r = await post('/api/lg-lines', { id, on: false }); await sleep(1500); const q2 = heard(2); await sleep(4000);
    ok('disconnecting line 2 stops all traffic on that wire', r.ok && r.line.on === false && heard(2) === q2, q2 + ' ' + heard(2));
    ok('while line 1 carries on', (await J('/api/bus')).polling === true);
    ok('the choice is saved', JSON.parse(fs.readFileSync(path.join(data, 'lg-lines.json'), 'utf8')).lines[0].on === false);
    r = await post('/api/lg-lines/' + id, {}, 'DELETE'); u = (await J('/api/units')).units;
    ok('removing the line keeps its units but marks them not responding', r.ok && u.length === 5 && u.filter(x => x.bus === id).every(x => x.offline) && (await J('/api/lg-lines')).lines.length === 0, JSON.stringify(u.map(x => [x.addr, x.offline])));
    const hh = heard(1); await sleep(4000); ok('the first line never asks for the removed line\'s units', (await J('/api/units')).units.filter(x => !x.bus).every(x => !x.offline) && heard(1) > hh);
  } catch (e) { ok('test ran', false, String(e && e.stack || e)); }
  if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); sims.forEach(s => s.kill()); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
