// Cortex for Windows: the app's own pages (find, can't reach, settings), clicked like a person would,
// with a stand-in for the app behind them. Fails on any page error or blank screen.
//   node tests/desktop-ui.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const SHOTS = process.env.SHOTS || '';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
  const FILE = 'file://' + path.resolve(__dirname, '..', 'desktop-app', 'finder.html');
  async function open(query, world, vp) {
    const page = await (await browser.newContext(vp || { viewport: { width: 980, height: 760 } })).newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(String(e)));
    await page.addInitScript((w) => {
      const o = Object.assign({ beta: false, background: true, autoStart: false, autoUpdate: true, notify: true, kinds: { fault: true, silent: true, cleared: false, advisory: true, offline: true } }, w.options || {});
      let findCb = () => {}; window.__calls = []; const st = { controllers: w.controllers || [], current: w.current || null };
      window.cortexApp = { info: async () => ({ version: w.version || '1.7.1', options: o, update: window.__upd || w.update || { state: 'current' }, controllers: st.controllers, current: st.current, status: w.status || null, via: w.via || null }),
        setOptions: async x => { window.__calls.push('set ' + JSON.stringify(x)); if (x.kinds) Object.assign(o.kinds, x.kinds); for (const k in x) if (k !== 'kinds') o[k] = x[k]; return o; },
        findStart: async () => { window.__calls.push('find'); const found = w.found || []; let d = 0; const t = setInterval(() => { d += 127; const done = d >= 508; findCb({ running: !done, done: Math.min(d, 508), total: 508, found: found.slice(0, done ? found.length : Math.min(found.length, Math.floor(d / 200))) }); if (done) clearInterval(t); }, 120); return {}; },
        findStop: async () => true, onFind: fn => { findCb = fn; },
        connect: async url => { window.__calls.push('connect ' + url); return (w.reachable || []).some(u => url.indexOf(u) >= 0) ? { ok: true } : { ok: false, err: 'Nothing at ' + url + ' answered as a Cortex controller.' }; },
        forget: async url => { st.controllers = st.controllers.filter(c => c.url !== url); if (st.current === url) st.current = null; return st; }, open: async () => { window.__calls.push('open'); return true; },
        retry: async () => { window.__calls.push('retry'); return { ok: false }; }, phone: async () => w.phone || { name: null, remote: null, local: null },
        testNotify: async () => { window.__calls.push('test'); return true; }, checkUpdate: async () => { window.__calls.push('check'); return { state: 'current' }; }, installUpdate: async () => { window.__calls.push('install'); return true; },
        leaveBeta: async () => w.leave, revertToStable: async () => { window.__calls.push('revert'); o.beta = false; window.__upd = { state: 'ready', latest: '1.7.1', revert: true }; return window.__upd; }, onUpdate: () => {} };
    }, world);
    await page.goto(FILE + (query || '')); return page;
  }
  const text = p => p.evaluate(() => document.getElementById('main').innerText);
  const calls = p => p.evaluate(() => window.__calls.join(' | '));
  const shot = async (p, n) => { if (SHOTS) { await p.waitForTimeout(350); await p.screenshot({ path: SHOTS + n + '.png' }); } };
  // --- first run: searching, then two controllers found
  const two = [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices', version: '1.7.1', configured: true }, { url: 'http://192.168.1.77:8080', name: 'New controller', version: '1.7.1', configured: false }];
  let p = await open('', { found: two, reachable: ['192.168.1.50'] }); await p.waitForTimeout(250);
  // the search page must not be rebuilt on every progress tick (that replayed its fade-in: the flashing)
  await p.evaluate(() => { window.__card = document.querySelector('#main .card'); window.__built = 0; new MutationObserver(m => { window.__built += m.filter(x => x.target.id === 'main').length; }).observe(document.getElementById('main'), { childList: true }); });
  ok('starts searching by itself', /Looking for Cortex on your network/.test(await text(p)) && /find/.test(await calls(p))); await shot(p, 'd1-searching');
  await p.waitForTimeout(1200); let t = await text(p);
  ok('progress only moves the bar; the page is rebuilt just when the list changes', await p.evaluate(() => window.__built) <= 2, 'rebuilt ' + await p.evaluate(() => window.__built) + ' times');
  ok('rebuilds during a search do not replay the fade-in', await p.evaluate(() => getComputedStyle(document.querySelector('#main .card')).animationName === 'none'));
  ok('lists what it found', /Found 2 Cortex controllers/.test(t) && /Harbor Point Offices/.test(t) && /192\.168\.1\.50/.test(t) && /not set up yet/.test(t) && /Set up/.test(t), t.slice(0, 300)); await shot(p, 'd2-found');
  await p.click('[data-connect="http://192.168.1.50"]'); await p.waitForTimeout(200); ok('Connect asks the app to connect', /connect http:\/\/192\.168\.1\.50/.test(await calls(p)));
  await p.fill('#addr', 'abc'); await p.click('#manual'); await p.waitForTimeout(200); ok('a wrong address explains itself', /answered as a Cortex controller/.test(await text(p)) && await p.evaluate(() => document.getElementById('addr').value === 'abc'));
  await p.fill('#addr', ''); await p.click('#manual'); ok('an empty address asks for one', /Type the controller's address/.test(await text(p)));
  ok('find: no page errors', p.errors.length === 0, p.errors.join('|')); await p.close();
  // --- nothing found, with a saved controller
  p = await open('', { found: [], controllers: [{ url: 'http://10.4.224.52', name: 'Lobby Tower' }], current: 'http://10.4.224.52' }); await p.waitForTimeout(1500); t = await text(p);
  ok('nothing found: says so, gives things to check, keeps saved ones', /No Cortex controller found/.test(t) && /Things to check/i.test(t) && /Lobby Tower/.test(t) && /Search again/.test(t), t.slice(0, 200)); await shot(p, 'd3-none');
  ok('the Open Cortex button shows when a controller is saved', await p.evaluate(() => !document.getElementById('back').classList.contains('hide')));
  await p.click('[data-forget="http://10.4.224.52"]'); await p.waitForTimeout(200); ok('Forget removes it', !/Lobby Tower/.test(await text(p)) && await p.evaluate(() => document.getElementById('back').classList.contains('hide')));
  await p.click('#again'); await p.waitForTimeout(200); ok('Search again searches again', (await calls(p)).split('find').length === 3); ok('none: no page errors', p.errors.length === 0, p.errors.join('|')); await p.close();
  // --- can't reach it
  p = await open('?view=lost&addr=' + encodeURIComponent('http://192.168.1.50'), { controllers: [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices' }], current: 'http://192.168.1.50', found: two }); await p.waitForTimeout(400); t = await text(p);
  ok("can't reach: names the address and counts down", /Can't reach Cortex/.test(t) && /192\.168\.1\.50/.test(t) && /Trying again in \d+ seconds/.test(t), t.slice(0, 200)); await shot(p, 'd4-lost');
  await p.click('#retry'); await p.waitForTimeout(200); ok('Try now tries every address of the controller', /retry/.test(await calls(p)) && /building network and the secure remote address/.test(await text(p)));
  await p.click('#search'); await p.waitForTimeout(300); ok('Search the network goes to the search', /Looking for Cortex|Found/.test(await text(p))); ok('lost: no page errors', p.errors.length === 0, p.errors.join('|')); await p.close();
  // --- settings
  p = await open('?view=settings', { controllers: [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices' }], current: 'http://192.168.1.50', status: { up: true, on: 17, total: 22 } }); await p.waitForTimeout(400); t = await text(p);
  ok('settings: shows controller, notifications, app, updates', /Harbor Point Offices/.test(t) && /17 of 22 units on/.test(t) && /Tell me when something needs attention/.test(t) && /Start with Windows/.test(t) && /Version 1\.7\.1/.test(t) && /Beta testing/.test(t), t.slice(0, 200)); await shot(p, 'd5-settings');
  await p.click('[data-sw="k:cleared"]'); await p.click('[data-sw="autoStart"]'); await p.click('[data-sw="beta"]'); await p.click('#test'); await p.click('#check'); await p.waitForTimeout(300);
  ok('switches and buttons reach the app', (await calls(p)) === 'set {"kinds":{"cleared":true}} | set {"autoStart":true} | set {"beta":true} | test | check', await calls(p));
  await p.click('[data-sw="notify"]'); await p.waitForTimeout(150); ok('turning notifications off hides the kinds', await p.evaluate(() => !document.querySelector('[data-sw="k:fault"]').offsetParent));
  await p.click('#back'); ok('Open Cortex goes back to the controller', /open$/.test(await calls(p))); ok('settings: no page errors', p.errors.length === 0, p.errors.join('|')); await p.close();
  // --- leaving beta on a beta build
  p = await open('?view=settings', { version: '1.7.2-beta.1', options: { beta: true }, leave: { ok: true, onBeta: true, current: '1.7.2-beta.1', stable: '1.7.1', canRevert: true, stableIsNewer: false } }); await p.waitForTimeout(300);
  await p.click('[data-sw="beta"]'); await p.waitForTimeout(400); t = await text(p);
  ok('leaving beta offers go back or stay, and changes nothing yet', /Go back to stable v1\.7\.1/.test(t) && /Stay on this beta/.test(t) && (await calls(p)) === '', t.slice(-300)); await shot(p, 'd6-leave-beta');
  await p.click('[data-leave="revert"]'); await p.waitForTimeout(400); ok('Go back downloads stable and offers the restart', (await calls(p)) === 'revert' && /Restart Cortex to go back/.test(await text(p)) && await p.evaluate(() => !!document.getElementById('install')));
  ok('leave beta: no page errors', p.errors.length === 0, p.errors.join('|')); await p.close();
  // --- on your phone
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>';
  p = await open('?view=phone', { controllers: [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices' }], current: 'http://192.168.1.50', phone: { name: 'Harbor Point Offices', remote: { url: 'https://harbor.example-net.ts.net:8443/', svg }, local: { url: 'http://192.168.1.50/', svg } } }); await p.waitForTimeout(400); t = await text(p);
  ok('phone page: both links, each with a code, and how to add the icon', /Harbor Point Offices on your phone/.test(t) && /harbor\.example-net\.ts\.net:8443/.test(t) && /192\.168\.1\.50/.test(t) && /Add to Home Screen/.test(t) && /Tailscale/.test(t) && await p.evaluate(() => document.querySelectorAll('.qr svg').length === 2), t.slice(0, 300)); await shot(p, 'd7-phone');
  await p.close(); p = await open('?view=phone', { controllers: [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices' }], current: 'http://192.168.1.50', phone: { name: 'Harbor Point Offices', remote: null, local: { url: 'http://192.168.1.50/', svg } } }); await p.waitForTimeout(400); t = await text(p);
  ok('phone page: says so when there is no secure link', /No secure link yet/.test(t) && /In the building only/i.test(t) && await p.evaluate(() => document.querySelectorAll('.qr svg').length === 1)); await p.close();
  p = await open('?view=phone', {}); await p.waitForTimeout(400); ok('phone page: nothing connected yet', /Connect to a controller first/.test(await text(p)) && p.errors.length === 0, p.errors.join('|')); await p.close();
  p = await open('?view=settings', { controllers: [{ url: 'http://192.168.1.50', name: 'Harbor Point Offices', local: ['http://192.168.1.50'], remote: 'https://harbor.example-net.ts.net:8443' }], current: 'http://192.168.1.50', via: 'remote', status: { up: true, on: 3, total: 9 } }); await p.waitForTimeout(300); t = await text(p);
  ok('settings say how it is connected and that it switches by itself', /over the secure remote address/.test(t) && /secure address when it is not/.test(t), t.slice(0, 300)); await p.close();
  // --- a narrow window
  p = await open('', { found: two }, { viewport: { width: 430, height: 700 } }); await p.waitForTimeout(1500);
  ok('fits a narrow window', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await p.close();
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
