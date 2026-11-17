// Rheem / Ruud (EcoNet) end to end: a real controller, a pretend EcoNet system on a pretend adapter
// (tests/helpers/econet-sim.py, written separately from Cortex's own encoder), and a technician's browser.
//   node tests/econet-ui.test.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const PORT = 18141, BASE = 'http://localhost:' + PORT, ROOT = path.resolve(__dirname, '..'), SHOTS = process.env.SHOTS || '';
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), data = fs.mkdtempSync(path.join(os.tmpdir(), 'ceco-')), logF = path.join(data, 'sim-writes');
const J = async (p, o) => (await fetch(BASE + p, o)).json(), post = (p, b, m) => J(p, { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const writes = () => { try { return fs.readFileSync(logF, 'utf8').trim().split('\n').filter(Boolean); } catch (_) { return []; } };
const until = async (f, ms) => { const t0 = Date.now(); let v; while (!(v = await f()) && Date.now() - t0 < (ms || 9000)) await sleep(200); return v; };
(async () => {
  let srv, sim, browser;
  const start = () => { srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: '/dev/null' }) });
    return until(async () => { try { return (await fetch(BASE + '/health')).ok; } catch (_) { return false; } }, 15000); };
  try {
    sim = spawn('python3', [path.join(__dirname, 'helpers', 'econet-sim.py'), logF], { stdio: ['ignore', 'pipe', 'inherit'] });
    const dev = await new Promise((res, rej) => { sim.stdout.once('data', d => res(String(d).trim())); setTimeout(() => rej(new Error('no pretend adapter')), 5000); });
    await start(); await post('/api/config', { name: 'EcoNet Test' });
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); return { cfg, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username, plain: (cfg.users.find(u => !roleCaps(u.role).tech && !roleCaps(u.role).admin) || {}).username }; });
    await seed.context().close(); await post('/api/appconfig', site.cfg);
    // --- the API: add a system; it starts by listening only
    ok('nothing configured: no systems, and the API says so', (await J('/api/econet')).systems.length === 0);
    let r = await post('/api/econet/systems', { name: 'Front office', kind: 'hvac', port: dev });
    ok('a system is added in listening-only mode', r.ok && r.system.on === true && r.system.talk === false, JSON.stringify(r));
    ok('bad requests are refused', (await post('/api/econet/systems', { name: 'x', kind: 'boiler', port: dev })).err && (await post('/api/econet/systems', { name: 'x', kind: 'hvac', port: 'COM1; rm -rf' })).err && /already used/.test((await post('/api/econet/systems', { name: 'Second', kind: 'hvac', port: dev })).err));
    const id = r.system.id; let s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.state === 'listening' && x.values.TEMP_OAT ? x : null; });
    ok('listening: it overhears the outdoor temperature without sending anything', !!s && s.values.TEMP_OAT.v === 88.2 && s.sent === 0 && !s.values.SPT, JSON.stringify(s && { st: s.state, v: s.values, sent: s.sent }));
    ok('a change is refused while listening', (await post('/api/econet/systems/' + id + '/write', { name: 'COOLSETP', value: 72 })).ok === false && writes().length === 0);
    // --- the page
    const open = async (user) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, user);
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(BASE + '/'); await p.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 20000 });
      await p.waitForFunction(() => !document.getElementById('nav-econet').classList.contains('hide'), null, { timeout: 8000 }).catch(() => {}); return p; };
    const P = await open(site.tech); await P.click('#nav-econet'); await P.waitForSelector('.eco'); let t = await P.evaluate(() => document.querySelector('.eco').textContent);
    ok('the page shows the system as listening only, with what it overheard', /Front office/.test(t) && /Listening only/.test(t) && /only listening/.test(t) && /88\.2/.test(t), t.slice(0, 400));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco1-listening.png' });
    await P.click('button[data-ecot="talk"]'); await P.waitForSelector('#eco-talk-go'); t = await P.evaluate(() => document.querySelector('.modal').innerText);
    ok('letting Cortex talk asks first, and warns about a fitted Wi-Fi module', /Wi-Fi module/.test(t) && /unplug it first/.test(t) && /has heard \d+ good message/.test(t), t.slice(0, 300));
    await P.click('#eco-talk-go'); s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.state === 'live' && x.values.SPT && x.values.F_ACTCFM && x.alarms.length ? x : null; }, 15000);
    ok('talking: live readings from the thermostat', !!s && s.values.SPT.v === 71.6 && s.values.COOLSETP.v === 74 && s.values.STATMODE.text === 'Cool' && s.alarms[0] === 'T101 Filter reminder', JSON.stringify(s && s.values));
    await until(async () => /71\.6/.test(await P.evaluate(() => document.querySelector('.eco').innerText)), 8000); t = await P.evaluate(() => document.querySelector('.eco').innerText);
    ok('the card shows room temperature, what it is doing, humidity, setpoints and the alarm', /71\.6°/.test(t) && /Cooling \(low\)/.test(t) && /44% humidity/.test(t) && /Cool to/.test(t) && /74 °F/.test(t) && /Filter reminder/.test(t) && /Live/.test(t), t.slice(0, 500));
    t = await P.evaluate(() => document.querySelector('.eco').textContent);
    ok('readings the equipment has are listed; ones it lacks are not', /Airflow/.test(t) && /812/.test(t) && /Suction pressure/.test(t) && !/Static pressure/.test(t));
    if (SHOTS) { await P.evaluate(() => { const d = document.querySelector('.eco details'); if (d) d.open = true; }); await P.screenshot({ path: SHOTS + 'eco2-live.png' }); }
    // --- changes
    const plus = 'button[data-n="COOLSETP"][data-d="1"]'; await P.click(plus); await P.click(plus);
    ok('two taps on + send ONE change, to the right value', !!(await until(async () => writes().length === 1 && writes()[0] === 'COOLSETP 75')), JSON.stringify(writes()));
    s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.values.COOLSETP.v === 75 ? x : null; }); ok('the new setting is read back from the equipment', !!s);
    await P.click('button[data-n="STATMODE"][data-v="0"]'); ok('a mode button sends the mode', !!(await until(async () => writes().includes('STATMODE 0'))), JSON.stringify(writes()));
    r = await post('/api/econet/systems/' + id + '/write', { name: 'COOLSETP', value: 120 }); const r2 = await post('/api/econet/systems/' + id + '/write', { name: 'RESETDEV', value: 1 });
    ok('a setting outside its limits, or a value not on the allowed list, never reaches the wire', r.ok === false && r2.ok === false && writes().length === 2, JSON.stringify([r, r2, writes()]));
    r = await post('/api/econet/systems/' + id + '/read', { name: 'PRODMODN', at: 0x400 }); ok('a technician can read any value by name', r.ok && r.item.text === 'RA1736AJ1NA', JSON.stringify(r));
    const fr = (await J('/api/econet/systems/' + id + '/frames')).frames; ok('the message log names who said what', fr.some(f => f.dir === 'tx' && /asks/.test(f.what)) && fr.some(f => f.from === 0x380 && /answers/.test(f.what)) && fr.every(f => /^80 /.test(f.hex)));
    // --- an ordinary user sees and controls it, but gets no setup tools
    if (site.plain) { const Q = await open(site.plain); await Q.click('#nav-econet'); await Q.waitForSelector('.eco'); t = await Q.evaluate(() => document.getElementById('main').innerText);
      ok('a non-technician sees the system and its controls, not the setup tools', /Front office/.test(t) && /Cool to/.test(t) && !/Add a system/.test(t) && !/Let Cortex talk|listening only\b.*TECH/i.test(t) && await Q.evaluate(() => !document.querySelector('.eco-tools')), t.slice(0, 300)); ok('no page errors (user)', Q.errs.length === 0, Q.errs.join('|')); await Q.context().close(); }
    // --- it survives a restart, and removal closes it
    srv.kill(); await sleep(500); await start(); s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x && x.state === 'live' ? x : null; }, 15000);
    ok('after a controller restart the system comes back live by itself', !!s && s.name === 'Front office' && s.talk === true);
    await post('/api/econet/systems', { id, talk: false }); await sleep(1500); const n = (await J('/api/econet')).systems[0].sent; await sleep(2500);
    ok('back to listening only: Cortex goes silent', (await J('/api/econet')).systems[0].sent === n && (await J('/api/econet')).systems[0].state === 'listening');
    await J('/api/econet/systems/' + id, { method: 'DELETE' }); ok('removed', (await J('/api/econet')).systems.length === 0);
    ok('the LG side is untouched', (await J('/api/bus')).on === false);
    ok('no page errors', P.errs.length === 0, P.errs.join('|'));
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  finally { try { srv.kill(); } catch (_) {} try { sim.kill(); } catch (_) {} if (browser) await browser.close().catch(() => {}); fs.rmSync(data, { recursive: true, force: true }); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
