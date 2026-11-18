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
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); const us = DEMOSRV.units.slice(0, 2).map((u, i) => Object.assign(JSON.parse(JSON.stringify(u)), { id: i + 1, addr: 5 + i, err: false, code: null, offline: false }));
      return { cfg, units: us, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username, plain: (cfg.users.find(u => !roleCaps(u.role).tech && !roleCaps(u.role).admin) || {}).username }; });
    await seed.context().close(); await post('/api/appconfig', site.cfg);
    // --- the API: add a system; it starts by listening only
    ok('nothing configured: no systems, and the API says so', (await J('/api/econet')).systems.length === 0);
    let r = await post('/api/econet/systems', { name: 'Front office', kind: 'hvac', port: dev });
    ok('a system is added in listening-only mode', r.ok && r.system.on === true && r.system.talk === false, JSON.stringify(r));
    ok('bad requests are refused', (await post('/api/econet/systems', { name: 'x', kind: 'boiler', port: dev })).err && (await post('/api/econet/systems', { name: 'x', kind: 'hvac', port: 'COM1; rm -rf' })).err && /already used/.test((await post('/api/econet/systems', { name: 'Second', kind: 'hvac', port: dev })).err));
    const id = r.system.id; let s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.state === 'listening' && x.values.TEMP_OAT ? x : null; });
    ok('listening: it overhears the outdoor temperature without sending anything', !!s && s.values.TEMP_OAT.v === 88.2 && s.sent === 0 && !s.values.SPT, JSON.stringify(s && { st: s.state, v: s.values, sent: s.sent }));
    ok('a change is refused while listening', (await post('/api/econet/systems/' + id + '/write', { name: 'COOLSETP', value: 72 })).ok === false && writes().length === 0);
    // --- two LG units on the same controller, so the building has two makes
    await post('/api/units', { units: site.units }, 'PUT');
    // --- the page: no separate tab; the system is a unit among the others
    const open = async (user) => { const ctx = await browser.newContext({ viewport: { width: 1320, height: 1000 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, user);
      const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); await p.goto(BASE + '/'); await p.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 20000 });
      await p.waitForSelector('.card[data-id^="e:"]', { timeout: 15000 }).catch(() => {}); return p; };
    const P = await open(site.tech), T = (sel) => P.evaluate((q) => (document.querySelector(q) || {}).textContent || '', sel);
    ok('there is no separate Rheem / Ruud tab any more', await P.evaluate(() => !document.getElementById('nav-econet') && ![...document.querySelectorAll('.nav-item')].some(b => /Rheem/.test(b.textContent))));
    let t = await T('#listwrap');
    ok('the Rheem / Ruud system is a card on Indoor units beside the LG units', await P.evaluate(() => document.querySelectorAll('.card[data-id^="e:"]').length === 1 && document.querySelectorAll('.card[data-id]').length === 3) && /Front office/.test(t) && /Heating & cooling system/.test(t) && /Listening only/.test(t), t.slice(0, 300));
    ok('the tiles and "All units" count every make', /3/.test(await P.evaluate(() => [...document.querySelectorAll('.tile')].pop().querySelector('.n').textContent)));
    ok('with two makes there is a manufacturer filter and a split switch', await P.evaluate(() => [...document.querySelectorAll('#brandseg button')].map(b => b.textContent).join('|') === 'All makes|LG|Rheem / Ruud' && !!document.getElementById('brandsplit')));
    await P.click('#brandseg button[data-b="econet"]'); ok('filter: Rheem / Ruud only', await P.evaluate(() => document.querySelectorAll('.card[data-id]').length === 1 && document.querySelector('.card[data-id]').dataset.id.startsWith('e:')));
    await P.click('#brandseg button[data-b="lg"]'); ok('filter: LG only', await P.evaluate(() => document.querySelectorAll('.card[data-id]').length === 2 && !document.querySelector('.card[data-id^="e:"]')));
    await P.click('#brandseg button[data-b="all"]'); ok('together by default: no manufacturer headings', await P.evaluate(() => !document.querySelector('.brand-h') && document.querySelectorAll('.card[data-id]').length === 3));
    await P.click('#brandsplit'); ok('split: each manufacturer gets its own section', await P.evaluate(() => [...document.querySelectorAll('.brand-h')].map(h => h.dataset.brand).join() === 'lg,econet' && document.querySelectorAll('.card[data-id]').length === 3));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco1-units-split.png' });
    await P.click('#brandsplit');
    ok('All on / All off and Select leave the other make alone', await P.evaluate(() => { const e = ecoUnits()[0]; return !ctlAllowed(e) && allU().filter(ctlAllowed).length === 2; }));
    // --- the unit panel
    await P.click('.card[data-id^="e:"]'); await P.waitForSelector('#eco-modal .eco'); t = await T('#eco-modal');
    ok('tapping the card opens its panel: listening only, with what it overheard', /Listening only/.test(t) && /only listening/.test(t) && /88\.2/.test(t), t.slice(0, 400));
    await P.click('#eco-modal button[data-ecot="talk"]'); await P.waitForSelector('#eco-talk-go'); t = await P.evaluate(() => document.querySelector('.modal').innerText);
    ok('letting Cortex talk asks first, and warns about a fitted Wi-Fi module', /Wi-Fi module/.test(t) && /unplug it first/.test(t) && /has heard \d+ good message/.test(t), t.slice(0, 300));
    await P.click('#eco-talk-go'); s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.state === 'live' && x.values.SPT && x.values.F_ACTCFM && x.alarms.length ? x : null; }, 15000);
    ok('talking: live readings from the thermostat', !!s && s.values.SPT.v === 71.6 && s.values.COOLSETP.v === 74 && s.values.STATMODE.text === 'Cool' && s.alarms[0] === 'A021_A Restricted Airflow', JSON.stringify(s && s.values));
    await until(async () => /A021_A/.test(await T('.card[data-id^="e:"]')), 15000); t = await T('.card[data-id^="e:"]');
    ok('the card on Indoor units goes live by itself: set to, room, mode, alarm', /74/.test(t) && /72/.test(t) && /Cool/.test(t) && /A021_A/.test(t) && /Restricted airflow/i.test(t), t);
    ok('an alarm counts in the Errors tile', await P.evaluate(() => counts().err === 1));
    await P.click('.card[data-id^="e:"]'); await P.waitForSelector('#eco-modal .eco'); await until(async () => /71\.6/.test(await T('#eco-modal')), 8000); t = await T('#eco-modal');
    ok('the panel shows room temperature, what it is doing, humidity, setpoints and the alarm', /71\.6°/.test(t) && /Cooling \(low\)/.test(t) && /44% humidity/.test(t) && /Cool to/.test(t) && /74 °F/.test(t) && /Restricted airflow/i.test(t) && /Live/.test(t), t.slice(0, 500));
    ok('readings the equipment has are listed; ones it lacks are not', /Airflow/.test(t) && /812/.test(t) && /Suction pressure/.test(t) && !/Static pressure/.test(t));
    if (SHOTS) { await P.evaluate(() => { const d = document.querySelector('.eco details'); if (d) d.open = true; }); await P.screenshot({ path: SHOTS + 'eco2-panel.png' }); }
    // --- the alarm has a guide, reaches Fault history and the bell, and the header light speaks for every bus
    await P.click('#eco-modal [data-ecoerr]'); await P.waitForFunction(() => /Restricted airflow/i.test(document.querySelector('.modal').innerText)); t = await P.evaluate(() => document.querySelector('.modal').innerText);
    ok('tapping the alarm opens its guide: what it means, what to do, a drawing, Rheem\'s own page', /A021_A/.test(t) && /filter/i.test(t) && /Look it up on Rheem/.test(t) && !/Look it up on LG/.test(t) && await P.evaluate(() => !!document.querySelector('.modal svg')), t.slice(0, 300));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco-guide.png' });
    await P.keyboard.press('Escape'); await P.keyboard.press('Escape');
    const ev = await until(async () => { const e = (await J('/api/events')).events.find(x => x.brand === 'econet'); return e || null; }, 12000);
    ok('the alarm is recorded in Fault history with the system\'s name', !!ev && /A021_A/.test(ev.code) && ev.kind === 'sys' && !ev.cleared && !!ev.name, JSON.stringify(ev));
    ok('the bell lists it', await P.evaluate(() => buildAlerts().some(a => a.code === 'R:A021_A')));
    t = await P.evaluate(() => { updateBusHealth(); return document.getElementById('bus-label').textContent + '|' + busList().map(b => b.id === 'lg' ? 'lg' : b.up).join(); });
    ok('the header light counts every bus', /bus/i.test(t), t);
    await P.click('#bus-health'); await P.waitForSelector('#buspop [data-busview]'); const bp = await T('#buspop'); ok('clicking it names each bus and its state', /LG bus/.test(bp) && /Rheem \/ Ruud/.test(bp) && /buses/.test(bp), bp);
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco-buspop.png' }); await P.evaluate(() => busPopClose());
    await P.click('.card[data-id^="e:"]'); await P.waitForSelector('#eco-modal .eco');
    // --- changes
    const plus = '#eco-modal button[data-n="COOLSETP"][data-d="1"]'; await P.click(plus); await P.click(plus);
    ok('two taps on + send ONE change, to the right value', !!(await until(async () => writes().length === 1 && writes()[0] === 'COOLSETP 75')), JSON.stringify(writes()));
    s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.values.COOLSETP.v === 75 ? x : null; }); ok('the new setting is read back from the equipment', !!s);
    await P.click('#eco-modal button[data-n="STATMODE"][data-v="0"]'); ok('a mode button sends the mode', !!(await until(async () => writes().includes('STATMODE 0'))), JSON.stringify(writes()));
    r = await post('/api/econet/systems/' + id + '/write', { name: 'COOLSETP', value: 120 }); const r2 = await post('/api/econet/systems/' + id + '/write', { name: 'RESETDEV', value: 1 });
    ok('a setting outside its limits, or a value not on the allowed list, never reaches the wire', r.ok === false && r2.ok === false && writes().length === 2, JSON.stringify([r, r2, writes()]));
    r = await post('/api/econet/systems/' + id + '/read', { name: 'PRODMODN', at: 0x400 }); ok('a technician can read any value by name', r.ok && r.item.text === 'RA1736AJ1NA', JSON.stringify(r));
    const fr = (await J('/api/econet/systems/' + id + '/frames')).frames; ok('the message log names who said what', fr.some(f => f.dir === 'tx' && /asks/.test(f.what)) && fr.some(f => f.from === 0x380 && /answers/.test(f.what)) && fr.every(f => /^80 /.test(f.hex)));
    // --- its group, and the map
    await P.fill('#eco-grp', 'Lobby wing'); await P.click('#eco-grp-save'); s = await until(async () => { const x = (await J('/api/econet')).systems[0]; return x.group === 'Lobby wing' ? x : null; });
    ok('it can be put in a group, kept on the controller', !!s); await P.evaluate(() => closeModal());
    ok('and then sits under that group on Indoor units', !!(await until(async () => P.evaluate(() => [...document.querySelectorAll('.section-h .st')].some(x => /Lobby wing/.test(x.textContent)) && [...document.querySelectorAll('#group-nav .nav-item')].some(x => /Lobby wing/.test(x.textContent))))));
    await P.evaluate(() => { view = 'map'; renderAll(); }); t = await T('#main');
    ok('the Building map shows it with the LG units', await P.evaluate(() => document.querySelectorAll('.umtile[data-id]').length === 3 && document.querySelectorAll('.umtile[data-id^="e:"]').length === 1) && /Lobby wing/.test(t) && /Front office/.test(t), t.slice(0, 300));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco3-map.png' });
    await P.click('.umtile[data-id^="e:"]'); ok('tapping it on the map opens the same panel', !!(await P.waitForSelector('#eco-modal .eco', { timeout: 4000 }).catch(() => null))); await P.evaluate(() => closeModal());
    // --- live bus data, like LG
    await P.evaluate(() => { view = 'busscan'; renderAll(); }); await P.waitForSelector('#bus-brand');
    ok('Bus scan offers each wire: the LG bus and the Rheem / Ruud system', await P.evaluate(() => [...document.querySelectorAll('#bus-brand button')].map(b => b.textContent).join('|') === 'LG bus|Rheem / Ruud · Front office' && !!document.getElementById('bus-con')));
    await P.click('#bus-brand button:nth-child(2)'); await P.waitForSelector('#ecobus-rows tr.tx', { timeout: 8000 }).catch(() => {}); t = await T('#main');
    ok('the Rheem / Ruud live view lists messages with who is talking', /Live bus · Rheem \/ Ruud/.test(t) && /Thermostat/.test(t) && /Outdoor unit/.test(t) && /asks/.test(t) && /38400 8N1/.test(t) && await P.evaluate(() => document.querySelectorAll('#ecobus-rows tr').length > 3 && !!document.querySelector('#ecobus-rows tr.tx')), t.slice(0, 300));
    const first = await P.evaluate(() => document.querySelector('#ecobus-rows tr td').textContent); await sleep(4500);
    ok('it keeps updating by itself', await P.evaluate((f) => document.querySelector('#ecobus-rows tr td').textContent !== f, first));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco4-bus.png' });
    await P.click('#bus-brand button:nth-child(1)'); ok('and switches back to the LG bus', !!(await P.waitForSelector('#bus-con, #bus-dis', { timeout: 4000 }).catch(() => null)));
    // --- Settings ▸ Equipment
    await P.evaluate(() => { setTab = 'equipment'; drawSettings(); }); t = await T('#setbody');
    ok('Settings ▸ Equipment lists the makes: both set up, the rest coming soon', /LG/.test(t) && /2 indoor units/.test(t) && /Rheem \/ Ruud/.test(t) && /1 system: Front office/.test(t) && /Manage/.test(t) && /Coming soon/.test(t) && !/not set up/.test(t), t.slice(0, 500));
    if (SHOTS) await P.screenshot({ path: SHOTS + 'eco5-equipment.png' });
    await P.click('[data-eq="econet"]'); ok('Manage opens the Rheem / Ruud setup page', !!(await P.waitForSelector('#eco-add', { timeout: 4000 }).catch(() => null)) && /Rheem \/ Ruud setup/.test(await T('#main')));
    // --- an ordinary user sees and controls it, but gets no setup tools
    if (site.plain) { const Q = await open(site.plain); await Q.click('.card[data-id^="e:"]'); await Q.waitForSelector('#eco-modal .eco'); t = await Q.evaluate(() => document.querySelector('#eco-modal').innerText);
      ok('a non-technician sees the system as a unit and can control it, with no setup tools', /Cool to/.test(t) && await Q.evaluate(() => !document.querySelector('.eco-tools') && !document.getElementById('eco-grp') && !document.querySelector('#eco-modal button[data-n="COOLSETP"]').disabled), t.slice(0, 300));
      await Q.evaluate(() => { closeModal(); setTab = 'equipment'; drawSettings(); }); ok('and has no Equipment settings', await Q.evaluate(() => ![...document.querySelectorAll('.tab')].some(b => /Equipment/.test(b.textContent))));
      ok('no page errors (user)', Q.errs.length === 0, Q.errs.join('|')); await Q.context().close(); }
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
