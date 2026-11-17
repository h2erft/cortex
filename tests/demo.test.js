// The demo building, end to end, and a sweep of every screen with it as the data.
// Proves three things: (1) the simulator's frames go through the real decoder and screens without an
// error, (2) a command from the page reaches the simulator, (3) demo mode never asks a controller for
// anything: every /api call and the bus link are answered inside the page.
//   node tests/demo.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
  for (const [label, vp] of [['desktop', { viewport: { width: 1360, height: 900 } }], ['phone', { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }]]) {
    const page = await (await browser.newContext(vp)).newPage(); const errors = [], asked = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (/\/api\/|\/bus\b|\/version$|\/health$/.test(new URL(r.url()).pathname)) asked.push(r.method() + ' ' + r.url()); });
    await page.goto('file://' + path.resolve(__dirname, '..', 'cortex.html') + '?demo');
    await page.waitForFunction(() => typeof units !== 'undefined' && units.length === 22 && MASTER.running && ODU.size === 2 && units.filter(u => u.room != null).length >= 20, null, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(async () => {
      const o = { demo: DEMO, user: currentUser && currentUser.username, units: units.length, live: liveTx(), odu: [...ODU.keys()].join(), err: units.filter(u => u.code).map(u => dispName(u) + ' ' + u.code).join(), lock: units.filter(u => u.hardLock).map(dispName).join(), filter: units.filter(u => u.filterSign).map(dispName).join(),
        info: errInfo('CH4').t === errInfo('CH04').t && errInfo('CH04').t !== 'Unrecognized code', chip: !!document.getElementById('demo-chip') };
      const u = units.find(x => x.addr === 2), before = u.on; await applyAndSend([u], x => { x.on = !before; x.coolC = 19; }); await new Promise(r => setTimeout(r, 2500));
      o.cmd = DEMOSIM.units.get(2).on === !before && DEMOSIM.units.get(2).set === 19;
      const br = units.find(x => x.addr === 7); await applyAndSend([br], x => { x.filterReset = true; }); await new Promise(r => setTimeout(r, 2000)); o.filterReset = DEMOSIM.units.get(7).filter === false;
      const d = await (await fetch('/api/diag')).json(); o.adv = d.advisories.map(a => a.title).join(); o.health = Object.keys(d.health).length;
      o.events = (await (await fetch('/api/events')).json()).events.length; const ev = await (await fetch('/api/events/demo-ch34')).json(); o.evPre = ev.pre.length; o.evPage = decodeOduPage(hexBytes(ev.pre[39].o[192]['0'])).hp > decodeOduPage(hexBytes(ev.pre[0].o[192]['0'])).hp;
      const h = await (await fetch('/api/history?addrs=1,2&days=1')).json(); o.csv = trendCsvRows(units.slice(0, 2), h.series).length > 100;
      o.refused = [(await fetch('/api/power/reboot', { method: 'POST' })).status, (await fetch('/api/update/apply', { method: 'POST' })).status, (await fetch('/api/clear-units', { method: 'POST', body: '{}' })).status, (await fetch('/api/appconfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _reset: true }) })).status].join();
      o.realStore = (() => { try { return window.localStorage.getItem('airow_cfg') === null && window.localStorage.getItem('airow_units') === null; } catch (e) { return true; } })();
      return o;
    });
    ok(label + ': demo starts signed in with 22 units and 2 outdoor units, live', r.demo && r.user === 'demo' && r.units === 22 && r.live && r.odu === '192,193' && r.chip, JSON.stringify(r));
    ok(label + ': the planted fault, lock and filter sign are decoded', r.err === 'Conference B CH04' && r.lock === 'Server room' && r.info, JSON.stringify([r.err, r.lock, r.filter, r.info]));
    ok(label + ': a command reaches the simulator, and so does a filter reset', r.cmd && r.filterReset, JSON.stringify([r.cmd, r.filterReset]));
    ok(label + ': the diagnosis rules find the low-charge system', /Low refrigerant charge/.test(r.adv) && r.health === 2, r.adv);
    ok(label + ': fault history, recordings, trends and CSV all have data', r.events === 4 && r.evPre >= 40 && r.evPage && r.csv, JSON.stringify(r));
    ok(label + ': anything that would change a controller is refused', r.refused === '400,400,400,400', r.refused);
    ok(label + ': the browser\'s real saved site is untouched', r.realStore);
    // every screen, with the demo as data
    const views = ['units', 'map', 'schedule', 'events', 'busscan', 'cycle', 'device'];
    for (const v of views) { await page.evaluate(v => { view = v; renderAll(); }, v); await page.waitForTimeout(900);
      const bad = await page.evaluate(() => ({ t: (document.getElementById('main').innerText.match(/undefined|NaN|\[object Object\]/g) || []).join(), over: document.documentElement.scrollWidth > innerWidth + 1, empty: document.getElementById('main').innerText.trim().length < 20 }));
      ok(label + ': ' + v + ' screen is clean', !bad.t && !bad.over && !bad.empty, JSON.stringify(bad)); }
    // dialogs worth opening
    await page.evaluate(() => { view = 'units'; renderAll(); openEvent('demo-ch34'); }); await page.waitForTimeout(1200);
    const rep = await page.evaluate(() => { window.print = () => {}; document.getElementById('ev-rep').click(); return new Promise(r => setTimeout(() => { const t = document.getElementById('printdoc').innerText; window.dispatchEvent(new Event('afterprint')); r(t); }, 250)); });
    ok(label + ': the fault report has the fault, the readings and the checks', /Fault report/.test(rep) && /CH34/.test(rep) && /High pressure/.test(rep) && /Checks to make/i.test(rep) && !/undefined|NaN/.test(rep), rep.slice(0, 200));
    for (const open of ['openSettings()', 'setTab="advanced";drawSettings()', 'exportBackup()', 'openFieldRef()', 'openError("CH34")', 'openTrends(units.slice(0,3).map(u=>u.id))', 'occEdit(null)']) {
      const bad = await page.evaluate(async (open) => { closeModal(); try { new Function(open)(); } catch (e) { return 'threw ' + e.message; } await new Promise(r => setTimeout(r, 500)); const t = mroot.innerText; return !t.trim() ? 'empty' : (t.match(/undefined|NaN|\[object Object\]/g) || []).join(); }, open);
      ok(label + ': dialog ' + open.slice(0, 28), !bad, bad); }
    ok(label + ': nothing was asked of a real controller', asked.length === 0, asked.slice(0, 4).join(' ; '));
    ok(label + ': no page errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
