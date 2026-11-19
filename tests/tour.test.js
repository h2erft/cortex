// The welcome tutorial: shown once to a newly added person, skippable at every step, replayable, and it only
// talks about pages that person may open.
//   node tests/tour.test.js
const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
  for (const [size, vp] of [['desktop', { viewport: { width: 1280, height: 860 } }], ['phone', { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }]]) {
    const P = await (await browser.newContext(vp)).newPage(), errs = []; P.on('pageerror', e => errs.push(String(e)));
    await P.goto('file://' + path.resolve(__dirname, '..', 'cortex.html') + '?demo'); await P.waitForFunction(() => typeof units !== 'undefined' && units.length === 22 && currentUser, null, { timeout: 30000 });
    await P.evaluate(() => { delete settings.tourSeen; });
    ok(size + ': only a person added since the tutorial existed is due one, and only once', await P.evaluate(() => { const u = CFG.users[0], had = u.tour; let r = [tourDue(u)]; u.tour = true; r.push(tourDue(u)); settings.tourSeen = 1; r.push(tourDue(u)); delete settings.tourSeen; if (!had) delete u.tour; return r.join(); }) === 'false,true,false');
    await P.evaluate(() => tourStart()); await P.waitForSelector('#tour-card');
    const card = () => P.evaluate(() => ({ t: document.querySelector('#tour-card h4').textContent, n: document.querySelector('.tour-n').textContent, skip: !!document.getElementById('tour-skip'), hole: (() => { const r = document.getElementById('tour-hole').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
      inView: (() => { const r = document.getElementById('tour-card').getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })() }));
    let c = await card(); const total = +c.n.split(' of ')[1];
    ok(size + ': it opens with a welcome and a Skip button', /Welcome/.test(c.t) && c.skip && c.n.startsWith('1 of') && total >= 8, JSON.stringify(c));
    const seen = [c.t]; let allIn = c.inView, pointed = 0;
    for (let i = 1; i < total; i++) { await P.click('#tour-next'); await P.waitForTimeout(900); c = await card(); seen.push(c.t); allIn = allIn && c.inView; if (c.hole[0] > 10) pointed++; if (process.env.SHOTS && (i === 1 || i === 3)) await P.screenshot({ path: process.env.SHOTS + 'tour-' + size + '-' + i + '.png' }); }
    ok(size + ': every step keeps its card on the screen', allIn, seen.join(' | '));
    ok(size + ': most steps point at something real on the page', pointed >= total - 4, pointed + ' of ' + total);
    ok(size + ': it walks through units, menu, alerts and settings and ends', /Your units/.test(seen.join()) && /The menu/.test(seen.join()) && /Alerts/.test(seen.join()) && /Settings/.test(seen.join()) && /That’s it/.test(seen[seen.length - 1]) && !c.skip, seen.join(' | '));
    await P.click('#tour-next'); await P.waitForTimeout(200);
    ok(size + ': Done closes it and remembers it was seen', await P.evaluate(() => !document.getElementById('tour-card') && !!settings.tourSeen && view === 'units' && !document.body.classList.contains('nav-open')));
    // skipping from the first card, and Escape
    await P.evaluate(() => { delete settings.tourSeen; tourStart(); }); await P.waitForSelector('#tour-skip'); await P.click('#tour-skip');
    ok(size + ': Skip on the first card closes it for good', await P.evaluate(() => !document.getElementById('tour-card') && !!settings.tourSeen));
    await P.evaluate(() => tourStart()); await P.waitForSelector('#tour-card'); await P.click('#tour-next'); await P.keyboard.press('Escape');
    ok(size + ': Escape closes it too, and the page underneath works again', await P.evaluate(() => !document.getElementById('tour-veil')));
    // someone who may not see the map, schedules or fault history is not told about them
    const few = await P.evaluate(() => { const real = can; window.can = k => !['map', 'sched', 'events'].includes(k) && real(k); try { can = window.can; } catch (_) {} const t = tourSteps().map(s => s.t).join('|'); try { can = real; } catch (_) {} return t; });
    ok(size + ': steps follow what the person is allowed to open', !/Building map|Schedule|Fault history/.test(few) && /Your units/.test(few), few);
    ok(size + ': no page errors', errs.length === 0, errs.join(' | ')); await P.context().close();
  }
  await browser.close(); console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
