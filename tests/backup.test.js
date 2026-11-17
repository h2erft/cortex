// Backup and restore: any subset of sections can be saved, and any backup (new or old format,
// whatever it holds) restores only what was ticked and leaves the rest alone. Nothing is transmitted.
//   node tests/backup.test.js
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'cortex.html')); await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const out = {};
    const cfgA = { provisioned: true, _rev: 7, site: { name: 'A', unit: 'F' }, gen: '4', baud: 4800, protocols: ['lg'], spMinF: 68, adminPin: '1111', techPin: '2222', recovery: { q: 'x', a: 'y' },
      users: [{ id: 1, name: 'Owner A', username: 'a', passhash: 'ha', role: 'owner' }], unitMeta: { 129: { tag: 'x' } }, oduAddrs: [192], ignoreAddrs: [5],
      schedules: [{ id: 's1', name: 'Weekdays' }], floorplans: { F1: { id: 'fp1', pos: {} } } };
    const cfgB = { provisioned: true, _rev: 3, site: { name: 'B', unit: 'C' }, gen: '5', baud: 9600, protocols: ['lg'], spMaxF: 80, adminPin: '9999',
      users: [{ id: 1, name: 'Owner B', username: 'b', passhash: 'hb', role: 'owner' }], unitMeta: {}, oduAddrs: [193], schedules: [{ id: 's9', name: 'Night' }], floorplans: {} };
    const unitsA = [{ id: 1, addr: 129, name: 'Lobby' }], all = { site: true, users: true, units: true, schedules: true, floorplans: true, prefs: true };
    const full = backupBuild(all, cfgA, unitsA, { theme: 'dark' }, { fp1: 'data:image/png;base64,AA==' });
    out.full_parts = Object.keys(full.parts).sort().join(',');
    out.full_no_rev = JSON.stringify(full).includes('_rev') === false;
    // one section only
    const onlySched = backupBuild({ schedules: true }, cfgA, unitsA, {}, {});
    out.one_parts = Object.keys(onlySched.parts).join(',');
    const P1 = backupParts(onlySched);
    out.one_avail = Object.keys(P1.parts).join(',');
    const ap1 = backupApply(cfgB, P1.parts, all);                      // ticking everything restores only what the file has
    out.one_sched = ap1.cfg.schedules[0].name; out.one_site_kept = ap1.cfg.site.name; out.one_users_kept = ap1.cfg.users[0].username;
    out.one_units = ap1.units; out.one_prefs = ap1.prefs; out.one_gen_kept = ap1.cfg.gen;
    // full file, restore only units
    const PF = backupParts(JSON.parse(JSON.stringify(full)));
    const ap2 = backupApply(cfgB, PF.parts, { units: true });
    out.u_units = ap2.units[0].name; out.u_odu = ap2.cfg.oduAddrs.join(); out.u_ign = (ap2.cfg.ignoreAddrs || []).join(); out.u_site = ap2.cfg.site.name; out.u_sched = ap2.cfg.schedules[0].name; out.u_users = ap2.cfg.users[0].username;
    // full restore replaces the site section outright (B's spMaxF goes, A's spMinF arrives)
    const ap3 = backupApply(cfgB, PF.parts, all);
    out.f_site = ap3.cfg.site.name; out.f_min = ap3.cfg.spMinF; out.f_max = ap3.cfg.spMaxF === undefined; out.f_user = ap3.cfg.users[0].username; out.f_pin = ap3.cfg.techPin;
    out.f_fp = Object.keys(ap3.cfg.floorplans).join(); out.f_prefs = ap3.prefs.theme; out.f_rev = ap3.cfg._rev === undefined; out.f_prov = ap3.cfg.provisioned;
    out.f_pure = cfgB.site.name;                                       // the input was not touched
    // version 1 file (one lump)
    const v1 = { _cortex: 'backup', v: 1, ts: '2026-01-02T00:00:00Z', cfg: cfgA, units: unitsA, settings: { theme: 'light' } };
    const PV = backupParts(v1);
    out.v1_avail = Object.keys(PV.parts).sort().join(','); out.v1_site = PV.site; out.v1_ts = PV.ts.slice(0, 10);
    const ap4 = backupApply(cfgB, PV.parts, { users: true });
    out.v1_users = ap4.cfg.users[0].username; out.v1_site_kept = ap4.cfg.site.name; out.v1_pin = ap4.cfg.adminPin;
    // junk and damage
    out.junk = [backupParts(null), backupParts({}), backupParts({ _cortex: 'backup', parts: {} }), backupParts({ _cortex: 'backup', parts: { users: { users: [] }, units: { list: 'no' }, site: [] } }), backupParts([1, 2])].map(x => x === null).join();
    const partial = backupParts({ _cortex: 'backup', v: 2, parts: { users: { users: [{ username: 'z' }] }, schedules: { list: [] }, prefs: {} } });
    out.partial = Object.keys(partial.parts).join(',');
    // a users section with no owner still leaves someone in charge
    const noOwner = backupApply(cfgB, { users: { users: [{ id: 4, username: 't', passhash: 'h', role: 'tech' }] } }, { users: true });
    out.owner_kept = noOwner.cfg.users[0].role;
    return out;
  });
  await browser.close();
  const want = { full_parts: 'floorplans,prefs,schedules,site,units,users', full_no_rev: true, one_parts: 'schedules', one_avail: 'schedules', one_sched: 'Weekdays', one_site_kept: 'B', one_users_kept: 'b', one_units: null, one_prefs: null, one_gen_kept: '5',
    u_units: 'Lobby', u_odu: '192', u_ign: '5', u_site: 'B', u_sched: 'Night', u_users: 'b',
    f_site: 'A', f_min: 68, f_max: true, f_user: 'a', f_pin: '2222', f_fp: 'F1', f_prefs: 'dark', f_rev: true, f_prov: true, f_pure: 'B',
    v1_avail: 'floorplans,prefs,schedules,site,units,users', v1_site: 'A', v1_ts: '2026-01-02', v1_users: 'a', v1_site_kept: 'B', v1_pin: '1111',
    junk: 'true,true,true,true,true', partial: 'schedules', owner_kept: 'owner' };
  let fail = 0;
  for (const k of Object.keys(want)) { const a = JSON.stringify(r[k]), b = JSON.stringify(want[k]); if (a === b) console.log('ok   ' + k); else { fail++; console.log('FAIL ' + k + '\n   got  ' + a + '\n   want ' + b); } }
  if (errors.length) { fail++; console.log('PAGE ERRORS:\n' + errors.join('\n')); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
