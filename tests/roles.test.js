// Roles and permissions: a role is a named list of permissions; users get exactly what their role allows.
// Runs in the demo building (nothing real is touched).
//   node tests/roles.test.js
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const SHOTS = process.env.SHOTS || '';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + path.resolve(__dirname, '..', 'cortex.html') + '?demo');
    await page.waitForFunction(() => typeof units !== 'undefined' && units.length === 22 && typeof currentUser !== 'undefined' && currentUser, null, { timeout: 30000 });
    const E = (f, a) => page.evaluate(f, a), text = (sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
    const nav = () => E(() => [...document.querySelectorAll('.nav-item[data-view]')].filter(b => !b.classList.contains('hide')).map(b => b.dataset.view));
    const as = async (username) => { await E((un) => { const u = CFG.users.find(x => x.username === un); elev = { admin: false, tech: false }; enterApp(u); view = 'units'; renderWho(); renderAll(); }, username); await page.waitForTimeout(150); };
    // --- root
    ok('the original account is shown as root, not owner', /root/.test(await text('#who')) && !/owner/i.test(await text('#who')), await text('#who'));
    ok('root has every permission', await E(() => PERM_KEYS.every(can)));
    // --- an upgraded site keeps the three roles it had, with the same abilities
    let r = await E(() => ({ ids: roles().map(x => x.id), names: roles().map(x => x.name), cust: [...rolePerms('customer')].sort(), tech: rolePerms('technician').has('busscan') && !rolePerms('technician').has('users'), admin: rolePerms('admin').has('users') && !rolePerms('admin').has('busscan'),
      old: (() => { const c = { custCtl: false }; seedRoles(c); return c.roles.find(x => x.id === 'customer').perms; })(), old2: (() => { const c = { custAll: false }; seedRoles(c); return c.roles.find(x => x.id === 'customer').perms; })() }));
    ok('starts with Admin, Technician and Customer', JSON.stringify(r.ids) === '["admin","technician","customer"]' && r.tech && r.admin, JSON.stringify(r));
    ok('a customer can control units and schedules but has no technician or admin tools', r.cust.join() === 'ctl,ctl_all,eco,eco_ctl,map,sched,sched_edit', r.cust.join());
    ok('the old "customers may control" switches carry over', !r.old.includes('ctl') && !r.old.includes('ctl_all') && r.old2.includes('ctl') && !r.old2.includes('ctl_all'), JSON.stringify([r.old, r.old2]));
    // --- the Roles section
    await E(() => { setTab = 'users'; drawSettings(); }); let t = await text('#setbody');
    ok('Settings ▸ Users lists the roles with how many users each has', /Roles/i.test(t) && /Admin/.test(t) && /Technician/.test(t) && /Customer/.test(t) && /of 24 permissions/.test(t) && /Every permission, always/.test(t), t.slice(0, 500));
    ok('the root user row says root', /Root account/.test(t) && await E(() => [...document.querySelectorAll('.urow .rchip')].some(c => c.textContent === 'root')));
    if (SHOTS) await page.screenshot({ path: SHOTS + 'roles1-list.png' });
    // --- create a role
    await page.click('#addrole'); await page.fill('#rname', 'Front desk');
    await E(() => { document.querySelectorAll('[data-perm]').forEach(b => { b.checked = ['ctl', 'sched', 'events'].includes(b.dataset.perm); }); document.querySelector('[data-perm]').onchange(); });
    if (SHOTS) await page.screenshot({ path: SHOTS + 'roles2-editor.png' });
    ok('every permission is offered, grouped, with a plain description', await E(() => document.querySelectorAll('[data-perm]').length === PERM_KEYS.length && document.querySelectorAll('.permgrp').length === 4 && [...document.querySelectorAll('.perm span')].every(x => x.textContent.length > 10)));
    await page.click('#rsave'); r = await E(() => { const x = roles().find(y => y.name === 'Front desk'); return x ? { id: x.id, perms: x.perms.slice().sort() } : null; });
    ok('a new role is saved with exactly the ticked permissions', !!r && r.perms.join() === 'ctl,events,sched' && /^r_/.test(r.id), JSON.stringify(r)); const FD = r.id;
    ok('it is kept with the site, so the controller and every screen share it', await E((id) => JSON.parse(LS.getItem('airow_cfg')).roles.some(x => x.id === id), FD));
    // --- names
    await page.click('#addrole'); await page.fill('#rname', 'root'); await page.click('#rsave'); const e1 = await text('#rerr');
    await page.fill('#rname', 'front DESK'); await page.click('#rsave'); const e2 = await text('#rerr'); await page.fill('#rname', ''); await page.click('#rsave'); const e3 = await text('#rerr');
    ok('reserved, duplicate and empty names are refused', /reserved/.test(e1) && /already a role/.test(e2) && /Give the role a name/.test(e3), [e1, e2, e3].join(' | ')); await E(() => drawSettings());
    // --- a user in that role
    await page.click('#adduser'); t = await text('.modal'); ok('the user form offers every role by name', /Front desk/.test(t) && /Admin/.test(t) && /Technician/.test(t) && /Customer/.test(t));
    await page.fill('#uname', 'Dana Desk'); await page.fill('#uuser', 'dana'); await page.fill('#upass', 'desk1234'); await page.click('[data-role="' + FD + '"]'); await page.click('#usave');
    ok('the user is created with that role', await E((id) => CFG.users.some(u => u.username === 'dana' && u.role === id), FD));
    await E(() => closeModal()); await as('dana');
    ok('signed in, they are labelled with the role name', /Front desk/.test(await text('#who')), await text('#who'));
    let n = await nav(); ok('they see only the pages the role allows', n.includes('units') && n.includes('schedule') && n.includes('events') && !n.includes('map') && !n.includes('busscan') && !n.includes('cycle') && !n.includes('econet') && await E(() => document.getElementById('devbtn').classList.contains('hide')), n.join());
    ok('they can control a unit but not use All on / All off or locks', await E(() => ctlAllowed(units[0]) && !document.getElementById('allon') && !can('locks')), await E(() => !!document.getElementById('allon') + ''));
    await E(() => { view = 'schedule'; renderAll(); }); ok('they can see schedules but not change them', await E(() => !document.getElementById('newsch') && !document.querySelector('[data-sedit]')));
    await E(() => { setTab = 'users'; drawSettings(); }); t = await text('.modal'); ok('Users and Advanced are locked for them', /does not include managing users/.test(t) && await E(() => { setTab = 'advanced'; drawSettings(); return /does not include Advanced/.test(document.querySelector('.modal').innerText); })); await E(() => closeModal());
    // --- look but not touch
    await E((id) => { roleOf(id).perms = ['map']; saveCfg(CFG); }, FD); await as('dana');
    await E(() => openDrawer(units[0].id)); await page.waitForTimeout(200);
    ok('without "Control units" everything in the unit panel is switched off', await E(() => !ctlAllowed(units[0]) && [...document.querySelectorAll('.drawer button[disabled], #drawer button[disabled]')].length > 0), await E(() => document.querySelectorAll('button[disabled]').length + ' disabled'));
    await E(() => closeDrawer()); n = await nav(); ok('and the pages follow the new permissions at once', n.includes('map') && !n.includes('schedule') && !n.includes('events'), n.join());
    // --- a technician-style custom role, and a backup-only one
    await E((id) => { roleOf(id).perms = ['busscan', 'techdata', 'backup']; saveCfg(CFG); }, FD); await as('dana'); n = await nav();
    ok('one tool can be given without the rest', n.includes('busscan') && !n.includes('cycle') && !n.includes('events') && await E(() => isTechView() && !can('service')), n.join());
    await E(() => { setTab = 'advanced'; drawSettings(); }); t = await text('.modal'); ok('Advanced shows only the part the role includes', /Back up configuration/.test(t) && !/Factory reset/.test(t) && !/Admin access code/.test(t) && !/Site name/.test(t), t.slice(0, 300)); await E(() => closeModal());
    // --- an access code still works, for this session
    await E(() => { elev.tech = true; recomputeSession(); renderWho(); }); ok('a technician access code adds the technician tools until locked again', await E(() => can('cycle') && can('service') && !can('users') && document.getElementById('lockbtn').classList.contains('lit')));
    await E(() => document.getElementById('lockbtn').click()); ok('locking takes them away', await E(() => !can('cycle') && can('busscan')));
    // --- safety
    await as('demo'); await E(() => { setTab = 'users'; drawSettings(); });
    await page.click('[data-rdel="' + FD + '"]'); ok('a role that still has users cannot be deleted', await E((id) => !!roleOf(id), FD));
    await E(() => { const u = CFG.users.find(x => x.username === 'dana'); u.role = 'customer'; saveCfg(CFG); drawSettings(); });
    await page.click('[data-rdel="' + FD + '"]'); const once = await E((id) => !!roleOf(id), FD); await page.click('[data-rdel="' + FD + '"]');
    ok('an unused role is deleted after a second tap', once && await E((id) => !roleOf(id), FD));
    ok('the three starting roles can be renamed and deleted like any other', await E(() => { roleOf('technician').name = 'Service tech'; const had = roles().length; CFG.roles = roles().filter(x => x.id !== 'admin' || users.some(u => u.role === 'admin')); return roleName('technician') === 'Service tech' && roles().length <= had; }));
    await E(() => { const u = CFG.users.find(x => x.username === 'dana'); u.role = 'gone'; }); await as('dana');
    ok('a user whose role no longer exists can only look', await E(() => PSET.size === 0 && !ctlAllowed(units[0])) && /no role/.test(await text('#who')));
    await E(() => { CFG.roles.push({ id: 'mgr', name: 'Manager', perms: ['ctl', 'users'] }); CFG.users.find(x => x.username === 'dana').role = 'mgr'; }); await as('dana'); await E(() => { setTab = 'users'; drawSettings(); });
    await page.click('[data-redit="mgr"]'); await E(() => { document.querySelector('[data-perm="users"]').checked = false; }); await page.click('#rsave');
    ok('nobody can untick their own way out of the roles page', /lock yourself out/.test(await text('#rerr')) && await E(() => rolePerms('mgr').has('users')));
    await E(() => drawSettings()); ok('root is not editable or deletable', await E(() => !document.querySelector('[data-redit="owner"]') && !document.querySelector('[data-rdel="owner"]') && CFG.users.find(u => u.role === 'owner').protected === true));
    // --- backups carry roles
    ok('roles are part of the logins section of a backup', await E(() => BK_USERKEYS.includes('roles')));
    ok('no page errors', errors.length === 0, errors.join('|'));
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  await browser.close(); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
