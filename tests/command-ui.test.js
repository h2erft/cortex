// Cortex Command, clicked the way a person clicks it: every header button, every tab and every Settings
// section, as the Windows app and as a browser copy. Fails on any page error or any blank screen.
// (v1.7.0-beta.16 shipped with the gear button blanking Settings: the click event was taken for a section name.)
//   node tests/command-ui.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
  for (const mode of ['app', 'browser']) for (const [size, vp] of [['desktop', { viewport: { width: 1200, height: 800 } }], ['phone', { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }]]) {
    const label = mode + ' ' + size, page = await (await browser.newContext(vp)).newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript((isApp) => {
      localStorage.setItem('cortex_command', JSON.stringify({ sites: [{ id: 's1', name: 'Test Building', loc: 'Town', addr: '' }], techs: [{ id: 't1', name: 'Tech One', assigned: ['s1'] }], grants: [], audit: [] }));
      localStorage.setItem('cortex_cmd_acct', JSON.stringify({ user: 'owner', name: 'Owner One', passhash: 'x' }));
      localStorage.setItem('cortex_cmd_prefs_owner', JSON.stringify({ briefing: false })); sessionStorage.setItem('cortex_cmd_in', '1');
      if (isApp) { const o = { beta: true, background: true, autoStart: false, autoUpdate: true };
        window.cmdApp = { info: async () => ({ version: '1.7.0', options: o, update: { state: 'current', latest: '1.7.0', checkedAt: Date.now() }, platform: 'win32' }), setOptions: async x => Object.assign(o, x), checkUpdate: async () => ({ state: 'current' }), installUpdate: async () => true, onUpdate: () => {}, notify: async () => true, show: async () => true, controller: async () => ({ ok: false, status: 0, err: 'offline' }) }; }
    }, mode === 'app');
    await page.goto('file://' + path.resolve(__dirname, '..', 'command-center.html')); await page.waitForTimeout(1500);
    const text = id => page.evaluate(id => { const e = document.getElementById(id); return e ? e.innerText.trim().length : -1; }, id);
    const wipe = () => page.evaluate(() => { document.getElementById('tab-settings').innerHTML = ''; });
    // the gear first, on a fresh page: this is the path that was blank
    await page.click('#settings'); await page.waitForTimeout(300); ok(label + ': gear button opens Settings', await text('tab-settings') > 200);
    await page.click('.tab[data-tab="sites"]'); await wipe(); await page.click('.tab[data-tab="settings"]'); await page.waitForTimeout(300); ok(label + ': Settings tab still works after the gear', await text('tab-settings') > 200);
    for (const sec of await page.evaluate(() => SET_SECS.map(x => x[0]))) { await page.evaluate(() => { document.querySelector('.setbody').innerHTML = ''; }); await page.click('[data-sec="' + sec + '"]'); await page.waitForTimeout(200); ok(label + ': Settings section ' + sec, await page.evaluate(() => document.querySelector('.setbody').innerText.trim().length) > 60); }
    for (const t of ['sites', 'alerts', 'techs', 'audit']) { await page.click('.tab[data-tab="' + t + '"]'); await page.waitForTimeout(250); ok(label + ': tab ' + t, await text('tab-' + t) >= (t === 'audit' ? 0 : 10) && await page.evaluate(t => !document.getElementById('tab-' + t).classList.contains('hide'), t)); }
    await page.click('#brief'); await page.waitForTimeout(300); ok(label + ': briefing button opens the briefing', await page.evaluate(() => !!document.querySelector('.brief-t'))); await page.evaluate(() => closeModal());
    for (const sel of ['[data-detail="s1"]', '[data-edit="s1"]', '#add-building']) { await page.click('.tab[data-tab="sites"]'); await page.click(sel); await page.waitForTimeout(250); ok(label + ': ' + sel + ' opens a dialog', await page.evaluate(() => document.getElementById('scrim').classList.contains('show') && document.getElementById('modal').innerText.trim().length > 30)); await page.evaluate(() => closeModal()); }
    await page.evaluate(() => { openSettings({ not: 'a section' }); }); ok(label + ': a bad section name falls back instead of going blank', await text('tab-settings') > 200);
    await page.click('#logout'); await page.waitForTimeout(250); ok(label + ': sign out shows the sign-in screen without junk', await page.evaluate(() => document.getElementById('login').style.display !== 'none' && !/\[object/.test(document.getElementById('login-card').innerText)));
    ok(label + ': no page errors', errors.length === 0, [...new Set(errors)].join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
