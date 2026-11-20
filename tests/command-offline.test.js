// Cortex Command must tell "this computer lost its connection" apart from "a building went offline".
// When the computer is offline, or every building fails in the same pass, nothing is marked offline and
// nobody is alerted. A single building must miss two looks in a row before it is called offline.
//   node tests/command-offline.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('cortex_command', JSON.stringify({ sites: [{ id: 'a', name: 'Alpha', loc: '', addr: 'alpha.test:8080' }, { id: 'b', name: 'Bravo', loc: '', addr: 'bravo.test:8080' }, { id: 'c', name: 'No address', loc: '', addr: '' }], techs: [], grants: [], audit: [] }));
    localStorage.setItem('cortex_cmd_acct', JSON.stringify({ user: 'owner', name: 'Owner One', passhash: 'x' }));
    localStorage.setItem('cortex_cmd_prefs_owner', JSON.stringify({ briefing: false, autorefresh: false })); sessionStorage.setItem('cortex_cmd_in', '1');
    window.DOWN = new Set(); window.NET = true; Object.defineProperty(navigator, 'onLine', { get: () => window.NET });
    window.fetch = async (url) => { const u = new URL(url); if (!/\.test$/.test(u.hostname)) throw new Error('blocked'); if (!window.NET || window.DOWN.has(u.hostname.split('.')[0])) throw new TypeError('Failed to fetch');
      const body = u.pathname === '/health' ? { ok: true, version: '1.7.1' } : u.pathname === '/api/units' ? { units: [] } : u.pathname === '/api/events' ? { events: [] } : {};
      return { ok: true, json: async () => body }; };
  });
  await page.goto('file://' + path.resolve(__dirname, '..', 'command-center.html')); await page.waitForTimeout(1500);
  const pass = (down, net) => page.evaluate(async ([down, net]) => { window.DOWN = new Set(down); window.NET = net; await pollAllSites();
    return { a: DB.sites[0].online, b: DB.sites[1].online, self: SELF.off, banner: (document.getElementById('self-off') || {}).innerText || '', alerts: DB.audit.filter(x => /^Alert:/.test(x.m)).map(x => x.m).join(' | ') }; }, [down, net]);
  let r = await pass([], true); ok('both buildings answer: online, no banner', r.a === true && r.b === true && !r.self && !r.banner && !r.alerts, JSON.stringify(r));
  r = await pass([], false); ok('this computer goes offline: buildings keep their status, a banner says why, no alert', r.a === true && r.b === true && r.self && /This computer is offline/.test(r.banner) && !r.alerts, JSON.stringify(r));
  r = await pass([], false); r = await pass([], false); ok('it stays that way however long the computer is offline', r.a === true && r.b === true && !r.alerts, JSON.stringify(r));
  r = await pass([], true); ok('back on line: the banner goes and nothing is reported', r.a === true && r.b === true && !r.self && !r.banner && !r.alerts, JSON.stringify(r));
  r = await pass(['alpha', 'bravo'], true); ok('every building failing at once is treated as this side\'s connection (Tailscale, VPN): no alert', r.a === true && r.b === true && r.self && /can’t reach any building/.test(r.banner) && !r.alerts, JSON.stringify(r));
  r = await pass([], true);
  r = await pass(['alpha'], true); ok('one building missing one look is not yet offline', r.a === true && r.b === true && !r.self && !r.alerts, JSON.stringify(r));
  r = await pass(['alpha'], true); ok('missing two looks in a row: shown offline, but nobody is told yet (15 minutes by default)', r.a === false && r.b === true && !r.alerts, JSON.stringify(r));
  r = await pass(['alpha'], true); r = await pass(['alpha'], true); ok('still nothing a few looks later', !r.alerts, JSON.stringify(r));
  await page.evaluate(() => { DB.sites[0].offSince = Date.now() - 16 * 60000; });
  r = await pass(['alpha'], true); ok('once it has been offline for 15 minutes, one alert', /Alpha has been offline for 16 min/.test(r.alerts) && !/Bravo/.test(r.alerts) && (r.alerts.match(/offline/g) || []).length === 1, JSON.stringify(r));
  r = await pass(['alpha'], true); ok('and only one', (r.alerts.match(/offline/g) || []).length === 1, r.alerts);
  r = await pass(['alpha'], false); ok('the computer dropping out afterwards does not take Bravo down too', r.a === false && r.b === true && r.self && (r.alerts.match(/offline/g) || []).length === 1, JSON.stringify(r));
  r = await pass([], true); ok('Alpha answering again is online at once', r.a === true && r.b === true && !r.self);
  // "immediately" tells you on the second missed look; switching the kind off tells you nothing
  await page.evaluate(() => { PREFS.offlineAfterMin = 0; DB.audit = []; }); r = await pass(['bravo'], true); r = await pass(['bravo'], true);
  ok('set to immediately, the alert comes with the second missed look', /Bravo went offline/.test(r.alerts), JSON.stringify(r));
  r = await pass([], true); await page.evaluate(() => { PREFS.nOffline = false; DB.audit = []; }); r = await pass(['bravo'], true); r = await pass(['bravo'], true);
  ok('with "a controller goes offline" switched off, nothing is said', r.b === false && !r.alerts, JSON.stringify(r));
  // a building that was already offline and already reported before Command was closed is not reported again on start
  ok('a restart of Command does not repeat an offline alert', await page.evaluate(() => { PREFS.nOffline = true; PREFS.offlineAfterMin = 15; const s = DB.sites[1]; s.online = false; s.offSince = Date.now() - 3600000; s.offTold = Date.now() - 3000000; offlineDue.prime(); return offlineDue(Date.now()).length === 0 && !!s.offTold; }));
  ok('one that went offline while Command was closed starts its wait at start-up', await page.evaluate(() => { const s = DB.sites[0]; s.online = false; delete s.offSince; delete s.offTold; offlineDue.prime(); return offlineDue(Date.now()).length === 0 && !!s.offSince; }));
  // advisories and silent units are off unless asked for
  ok('advisories and "a unit stopped answering" are off by default; errors are on', await page.evaluate(() => PREF_DEFAULTS.nAdvisory === false && PREF_DEFAULTS.nSilent === false && PREF_DEFAULTS.nError === true && PREF_DEFAULTS.offlineAfterMin === 15));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
