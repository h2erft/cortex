// The bus belongs to the controller, and every screen shares it. A real controller, a pretend adapter with
// two pretend indoor units behind it (tests/helpers/bus-sim.py), and two technicians' browsers.
//   node tests/bus-shared.test.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const PORT = 18131, BASE = 'http://localhost:' + PORT, ROOT = path.resolve(__dirname, '..');
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), data = fs.mkdtempSync(path.join(os.tmpdir(), 'cbus-')), countF = path.join(data, 'sim-bytes');
const J = async (p, o) => (await fetch(BASE + p, o)).json(), post = (p, b, m) => J(p, { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const heard = () => { try { return +fs.readFileSync(countF, 'utf8') || 0; } catch (_) { return 0; } };
const until = async (f, ms) => { const t0 = Date.now(); let v; while (!(v = await f()) && Date.now() - t0 < (ms || 8000)) await sleep(150); return v; };
(async () => {
  let srv, sim, browser, dev;
  const start = () => { srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: dev }) });
    return until(async () => { try { return (await fetch(BASE + '/health')).ok; } catch (_) { return false; } }, 15000); };
  try {
    sim = spawn('python3', [path.join(__dirname, 'helpers', 'bus-sim.py'), countF, '5', '6'], { stdio: ['ignore', 'pipe', 'inherit'] });
    dev = await new Promise((res, rej) => { sim.stdout.once('data', d => res(String(d).trim())); setTimeout(() => rej(new Error('no pretend adapter')), 5000); });
    await start(); await post('/api/config', { name: 'Shared Bus Test' });
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    // a site with two units and a technician account, borrowed from the demo building's shape
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)), tech = cfg.users.find(u => roleCaps(u.role).tech) || cfg.users[0];
      const us = DEMOSRV.units.slice(0, 2).map((u, i) => Object.assign(JSON.parse(JSON.stringify(u)), { id: i + 1, addr: 5 + i, err: false, code: null, offline: false })); return { cfg, user: tech.username, tech: roleCaps(tech.role).tech, units: us }; });
    await seed.context().close();
    ok('test site: has a technician account', site.tech === true, site.user);
    await post('/api/appconfig', site.cfg); await post('/api/units', { units: site.units }, 'PUT');
    let b0 = await J('/api/bus'); ok('a fresh controller: adapter not connected, nothing transmitted', b0.on === false && b0.open === false && heard() === 0, JSON.stringify(b0));
    const open = async () => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, site.user);
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(BASE + '/'); await p.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser && typeof session !== 'undefined' && session.tech, null, { timeout: 20000 });
      await p.evaluate(() => { view = 'busscan'; renderAll(); }); await p.waitForSelector('#bus-con, #bus-dis'); return p; };
    const A = await open(), B = await open();
    const st = (p) => p.evaluate(() => ({ con: !!document.getElementById('bus-con'), dis: !!document.getElementById('bus-dis'), take: (document.getElementById('bus-take') || {}).textContent || '', give: !!document.getElementById('bus-give'),
      txt: (document.getElementById('bus-link-txt') || {}).textContent || '', pill: document.getElementById('bus-label').textContent, seen: bus.addrs.size, port: !!bus.port, stop: !!document.getElementById('m-stop') }));
    let a = await st(A), b = await st(B);
    ok('both screens start with the same answer: not connected', a.con && b.con && /not connected/.test(a.txt) && /not connected/.test(b.txt) && /Bus offline/.test(b.pill), JSON.stringify([a, b]));
    // --- one technician connects; the other screen follows without touching anything
    await A.click('#bus-con'); b = await until(async () => { const x = await st(B); return x.dis && /listening/.test(x.txt) ? x : null; }); a = await st(A);
    ok('Connect on one screen shows as connected on the other', !!b && a.dis && /listening/.test(a.txt), JSON.stringify([a, await st(B)]));
    ok('the top light on the other screen says connected, not offline', !!b && /Bus connected/.test(b.pill), b && b.pill);
    b0 = await J('/api/bus'); ok('connecting only listens: nothing was transmitted and nothing polls', b0.on && b0.open && !b0.polling && heard() === 0, JSON.stringify(b0) + ' heard ' + heard());
    // --- live polling is the controller's job
    await A.click('#m-start'); b = await until(async () => { const x = await st(B); return /controller polling 2 units/.test(x.txt) && /Live/.test(x.pill) ? x : null; }, 12000); a = await st(A);
    ok('Start polling: the controller polls, and both screens say so', !!b && /controller polling 2 units/.test(a.txt) && !a.port && !b.port && heard() > 0, JSON.stringify([a, await st(B)]));
    ok('a screen that never connected sees the units answering (bus scan is visible everywhere)', !!(await until(async () => (await st(B)).seen >= 2)), JSON.stringify(await st(B)));
    const u = await J('/api/units'); ok('units are live for everyone', u.masterAlive === true && u.bus.polling === true && u.units.every(x => x.offline === false));
    // --- the technician tools: one screen at a time, and the controller steps off the wire
    await B.click('#bus-take'); b = await until(async () => { const x = await st(B); return x.give && x.port ? x : null; }); a = await until(async () => { const x = await st(A); return /in use on another screen/.test(x.txt) ? x : null; });
    b0 = await J('/api/bus'); ok('Use bus tools: this screen gets the wire, the other screen is told, the controller stops polling', !!b && !!a && b0.holder === 'screen' && b0.polling === false && /Take over/.test(a.take), JSON.stringify([a, b, b0]));
    ok('the adapter still shows connected on both while the tools are in use', (await st(A)).dis && (await st(B)).dis);
    await A.click('#bus-take'); a = await until(async () => { const x = await st(A); return x.give && x.port ? x : null; }); b = await until(async () => { const x = await st(B); return !x.port && !x.give ? x : null; });
    ok('another technician can take over; the first screen lets go', !!a && !!b, JSON.stringify([await st(A), await st(B)]));
    await A.click('#bus-give'); b0 = await until(async () => { const x = await J('/api/bus'); return x.polling && x.holder === 'controller' ? x : null; }, 10000);
    ok('Done: handed back, and the controller polls again by itself', !!b0 && !(await st(A)).port, JSON.stringify(await J('/api/bus')));
    // --- a screen that vanishes while holding the tools does not keep the wire
    await B.click('#bus-take'); await until(async () => (await st(B)).port); await B.context().close();
    b0 = await until(async () => { const x = await J('/api/bus'); return x.polling ? x : null; }, 10000); ok('closing the tab that had the tools gives the wire back', !!b0, JSON.stringify(await J('/api/bus')));
    // --- any technician can disconnect, from any device; it sticks across a restart
    const C = await open(); a = await st(C); ok('a screen opened later reads the same status straight away', a.dis && /controller polling/.test(a.txt), JSON.stringify(a));
    await C.click('#bus-dis'); a = await until(async () => { const x = await st(A); return x.con && /not connected/.test(x.txt) ? x : null; });
    b0 = await J('/api/bus'); await sleep(3200); const quiet = heard(); await sleep(2500);
    ok('Disconnect from one device shows on the others, and the wire goes silent', !!a && !b0.on && !b0.open && !b0.polling && heard() === quiet && /Bus offline/.test((await st(A)).pill), JSON.stringify([a, b0]));
    srv.kill(); await sleep(500); await start(); b0 = await J('/api/bus'); ok('still disconnected after the controller restarts', b0.on === false && b0.open === false);
    await post('/api/bus', { on: true }); await until(async () => (await J('/api/bus')).polling, 10000); srv.kill(); await sleep(500); await start();
    b0 = await until(async () => { const x = await J('/api/bus'); return x.polling ? x : null; }, 12000); ok('connected and polling again after a restart, with no browser open', !!b0 && b0.on && b0.master, JSON.stringify(await J('/api/bus')));
    ok('no page errors', A.errs.concat(C.errs).length === 0, A.errs.concat(C.errs).join('|'));
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  finally { try { srv.kill(); } catch (_) {} try { sim.kill(); } catch (_) {} if (browser) await browser.close().catch(() => {}); fs.rmSync(data, { recursive: true, force: true }); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
