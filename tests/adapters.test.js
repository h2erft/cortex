// Multi-channel USB RS-485 adapters (the Waveshare "USB TO 4CH RS485", CH344 chip): each channel is listed by
// its stable name with a channel number, Cortex never guesses which channel the LG bus is on, and a
// technician can put the LG bus on one channel and Rheem / Ruud systems on the others.
//   node tests/adapters.test.js
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const A = require('../appliance/adapters');
let fail = 0; const ok = (n, c, d) => { if (c) console.log('ok   ' + n); else { fail++; console.log('FAIL ' + n + (d ? '\n   ' + d : '')); } };
const Q = ['-if04', '-if00', '-if06', '-if02'].map(x => 'usb-1a86_USB_Quad_Serial_BC046F1234' + x);
let d = A.describe(Q);
ok('the four channels of a CH344 adapter are numbered in terminal order', d.map(x => x.name.slice(-2) + ':' + x.channel).join() === '00:1,02:2,04:3,06:4' && d.every(x => x.channels === 4), JSON.stringify(d));
ok('and named so a person can pick one', d[1].label === 'Waveshare 4-channel RS485 (CH344) · channel 2 of 4', d[1].label);
d = A.describe(Q.concat(['usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0', 'usb-FTDI_Quad_RS232-HS-if01-port0', 'usb-FTDI_Quad_RS232-HS-if00-port0', 'usb-Acme_Thing-if00']));
ok('single adapters carry no channel number; FTDI multi-port ones are numbered too', d.find(x => /CP2102/.test(x.name)).label === 'USB RS485 adapter (CP210x)' && d.filter(x => /FTDI/.test(x.name)).map(x => x.channel).join() === '1,2' && d.find(x => /Acme/.test(x.name)).label === 'Acme Thing', JSON.stringify(d.map(x => x.label)));
d = A.describe(Q.concat(Q.map(n => n.replace('1234', '9876'))));
ok('two of the same adapter are told apart by serial number', d.length === 8 && /no\. 1234$/.test(d[0].label) && /no\. 9876$/.test(d[4].label), d[0].label + ' / ' + d[4].label);
ok('an empty or missing folder is no adapters', A.describe([]).length === 0 && A.list('/nonexistent-dir').length === 0);

(async () => {
  const PORT = 18477, ROOT = path.join(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-adp-')), dir = path.join(tmp, 'by-id'); fs.mkdirSync(dir);
  Q.forEach((n, i) => { const f = path.join(tmp, 'ttyACM' + i); fs.writeFileSync(f, ''); fs.symlinkSync(f, path.join(dir, n)); });
  const srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: path.join(tmp, 'data'), CORTEX_SERIAL: path.join(tmp, 'nothing-here'), CORTEX_SERIAL_DIR: dir }) });
  const J = (p, body) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {} }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => { try { res({ status: x.statusCode, j: JSON.parse(s) }); } catch (e) { rej(e); } }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  try {
    for (let i = 0; i < 60; i++) { try { await J('/health'); break; } catch (_) { await new Promise(r => setTimeout(r, 250)); } }
    let r = await J('/api/bus'); ok('with four channels and none chosen, Cortex does not guess one for the LG bus', r.j.adapter && r.j.adapter.present === false && r.j.adapter.choices === 4 && !/channel/.test(r.j.adapter.label), JSON.stringify(r.j.adapter));
    r = await J('/api/econet/ports'); ok('the controller lists each channel', r.j.ports.length === 4 && /channel 3 of 4/.test(r.j.ports[2].label) && r.j.ports.every(p => !p.usedBy), JSON.stringify(r.j.ports.map(p => p.label)));
    const ch = r.j.ports.map(p => p.path);
    r = await J('/api/serial-ports'); ok('the setup wizard gets the same named channels', r.j.ports.slice(0, 4).every((p, i) => p.path === ch[i] && /channel/.test(p.label)), JSON.stringify(r.j.ports));
    r = await J('/api/bus', { adapter: ch[1] }); ok('a technician puts the LG bus on channel 2', r.status === 200 && r.j.adapter.path === ch[1] && /channel 2 of 4/.test(r.j.adapter.label) && r.j.adapter.present, JSON.stringify(r.j.adapter || r.j));
    ok('and that survives a restart (saved by its stable name)', JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'config.json'), 'utf8')).serial === ch[1]);
    r = await J('/api/bus', { adapter: '/dev/ttyS0' }); ok('an adapter that is not plugged in is refused', r.status === 400, JSON.stringify(r.j));
    r = await J('/api/econet/systems', { name: 'Heat pump', kind: 'hvac', port: ch[2], on: false }); ok('a Rheem / Ruud system goes on channel 3', r.status === 200, JSON.stringify(r.j));
    r = await J('/api/bus', { adapter: ch[2] }); ok('the LG bus cannot then be moved onto that channel', r.status === 400 && /Heat pump/.test(r.j.err), JSON.stringify(r.j));
    r = await J('/api/econet/ports'); ok('the list shows who uses each channel', r.j.ports[1].lg === true && r.j.ports[2].usedBy === 'Heat pump' && !r.j.ports[0].usedBy && !r.j.ports[3].usedBy, JSON.stringify(r.j.ports.map(p => [p.lg, p.usedBy])));
    // --- the picker in Bus scan
    let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
    const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }), BASE = 'http://127.0.0.1:' + PORT;
    try {
      const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
      const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); return { cfg, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username }; }); await seed.context().close(); await J('/api/appconfig', site.cfg);
      const ctx = await browser.newContext({ viewport: { width: 1320, height: 1000 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, site.tech);
      const P = await ctx.newPage(), errs = []; P.on('pageerror', e => errs.push(String(e))); await P.goto(BASE + '/'); await P.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 20000 });
      await P.evaluate(() => { busBrand = 'lg'; view = 'busscan'; renderAll(); }); await P.waitForSelector('#bus-adp', { timeout: 10000 });
      ok('Bus scan names the adapter and channel the LG bus is on', /channel 2 of 4/.test(await P.textContent('#bus-adp-txt')));
      await P.click('#bus-adp'); await P.waitForSelector('#adp-list'); const txt = await P.evaluate(() => document.querySelector('.modal').innerText);
      ok('the picker lists all four channels and marks the one a Rheem / Ruud system uses', (txt.match(/channel \d of 4/g) || []).length === 4 && /Heat pump/.test(txt) && await P.evaluate(() => document.querySelectorAll('input[name="adp"]:disabled').length === 1 && document.querySelector('input[name="adp"]:checked').value.endsWith('-if02')), txt.slice(0, 400));
      if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + 'adapter-pick.png' });
      await P.click('input[name="adp"][value$="-if06"]'); await P.click('#adp-save'); await P.waitForFunction(() => /channel 4 of 4/.test((document.getElementById('bus-adp-txt') || {}).textContent || ''), null, { timeout: 8000 });
      ok('choosing channel 4 moves the LG bus there', (await J('/api/bus')).j.adapter.path === ch[3] && errs.length === 0, errs.join(' | '));
    } finally { await browser.close(); }
  } catch (e) { ok('server test ran', false, String(e && e.stack || e)); }
  srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
