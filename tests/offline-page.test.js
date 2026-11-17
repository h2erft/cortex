// The controller's side of "local or secure, whichever works":
//   - /health names the controller (id) and its building-network addresses, so the Windows app can switch;
//   - the service worker keeps /offline.html, and a phone that cannot reach the controller is shown it,
//     with the building-network link, then goes back by itself when the controller answers again.
// Runs a real controller on a spare port and a real browser.
//   node tests/offline-page.test.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const PORT = 18123, BASE = 'http://localhost:' + PORT, ROOT = path.resolve(__dirname, '..');
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'coff-'));
const start = () => spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: '/dev/null' }) });
const up = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) return r.json(); } catch (_) {} await new Promise(r => setTimeout(r, 200)); } throw new Error('controller did not start'); };
(async () => {
  let srv = start(), browser;
  try {
    const h = await up();
    ok('/health carries a controller id and its building-network addresses', /^[a-f0-9]{16}$/.test(h.id) && Array.isArray(h.lan) && h.lan.every(a => /^(10|172|192)\./.test(a)), JSON.stringify(h));
    ok('the id is kept', (await (await fetch(BASE + '/health')).json()).id === h.id && fs.readFileSync(path.join(data, 'controller-id'), 'utf8').trim() === h.id);
    const off = await (await fetch(BASE + '/offline.html')).text();
    ok('the kept page offers the building-network address', /Open on the building network/.test(off) && /http:\/\/cortex\.local:18123\//.test(off) && h.lan.every(a => off.includes('http://' + a + ':' + PORT + '/')));
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const page = await (await browser.newContext()).newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '/');
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100)); });
    await page.reload(); ok('with the controller reachable, Cortex itself loads', /Cortex/.test(await page.title()) && !/secure link/.test(await page.evaluate(() => document.body.innerText)));
    srv.kill(); await new Promise(r => setTimeout(r, 600));
    await page.goto(BASE + '/').catch(() => {}); const t = await page.evaluate(() => document.body.innerText);
    ok('with the controller unreachable, the kept page is shown with the local link', /Can't reach/.test(t) && /Open on the building network/.test(t) && await page.evaluate(() => [...document.querySelectorAll('a.b')].every(a => /^http:\/\//.test(a.href))), t.slice(0, 200));
    srv = start(); await up(); await page.waitForFunction(() => !/Can't reach/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    ok('it returns to Cortex by itself when the controller answers again', !/Can't reach/.test(await page.evaluate(() => document.body.innerText)));
    ok('no page errors', errs.length === 0, errs.join('|'));
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  finally { try { srv.kill(); } catch (_) {} if (browser) await browser.close(); fs.rmSync(data, { recursive: true, force: true }); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
