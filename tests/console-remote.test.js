// Remote access switched on from the dashboard (with a pretend `tailscale`), and the controller console:
// its own password kept on the controller, lock-out after wrong tries, commands run with a working folder.
//   node tests/console-remote.test.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const PORT = 18497, BASE = 'http://localhost:' + PORT, ROOT = path.resolve(__dirname, '..');
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms)), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccon-')), data = path.join(tmp, 'data'), bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
const J = async (p, b) => { const r = await fetch(BASE + p, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}); const j = await r.json(); j._status = r.status; return j; };
const until = async (f, ms) => { const t0 = Date.now(); let v; while (!(v = await f()) && Date.now() - t0 < (ms || 8000)) await sleep(200); return v; };
// a pretend tailscale: signed out until the file "approved" appears
fs.writeFileSync(path.join(bin, 'tailscale'), `#!/bin/bash
S="${tmp}/ts-state"; [ -f "$S" ] || echo NeedsLogin > "$S"
case "$1" in
  status) st=$(cat "$S"); if [ "$st" = Running ]; then echo '{"BackendState":"Running","Self":{"DNSName":"cortex-test.example-net.ts.net.","TailscaleIPs":["100.64.0.9"]},"CurrentTailnet":{"Name":"example-net"}}'; else echo "{\\"BackendState\\":\\"$st\\",\\"Self\\":{}}"; fi ;;
  up) echo "$@" >> "${tmp}/ts-calls"; echo "To authenticate, visit:" >&2; echo "    https://login.tailscale.com/a/abc123def" >&2; for i in $(seq 1 100); do [ -f "${tmp}/approved" ] && { echo Running > "$S"; exit 0; }; sleep 0.2; done; exit 1 ;;
  down) echo Stopped > "$S" ;;
esac
`, { mode: 0o755 });
(async () => {
  let srv, browser;
  try {
    srv = spawn('node', ['appliance/server.js'], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CORTEX_HTTP80: '0', CORTEX_HTTPS: '0', CORTEX_PORT: String(PORT), CORTEX_DIR: ROOT, CORTEX_DATA: data, CORTEX_SERIAL: path.join(tmp, 'none'), CORTEX_SERIAL_DIR: path.join(tmp, 'none-dir') }) });
    await until(async () => { try { return (await fetch(BASE + '/health')).ok; } catch (_) { return false; } }, 15000);
    // --- remote access
    let r = await J('/api/remote'); ok('before: Tailscale is installed but signed out', r.installed && !r.up && r.state === 'NeedsLogin' && !r.authUrl, JSON.stringify(r));
    r = await J('/api/remote', { on: true }); ok('turning it on starts Tailscale and hands back the sign-in page', !r.up && r.authUrl === 'https://login.tailscale.com/a/abc123def' && r.starting, JSON.stringify(r));
    ok('the service user is made the operator on the way', /up --operator=cortex/.test(fs.readFileSync(path.join(tmp, 'ts-calls'), 'utf8')));
    fs.writeFileSync(path.join(tmp, 'approved'), '1');
    r = await until(async () => { const x = await J('/api/remote'); return x.up ? x : null; }, 8000);
    ok('once approved it shows as on, with its name and address', !!r && r.name === 'cortex-test.example-net.ts.net' && r.ip === '100.64.0.9' && !r.authUrl && !r.error, JSON.stringify(r));
    r = await J('/api/remote', { on: false }); ok('and it can be turned off again', r._status === 200 && !r.up && r.state === 'Stopped', JSON.stringify(r));
    // --- the same from the dashboard
    let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
    browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
    const seed = await (await browser.newContext()).newPage(); await seed.goto(BASE + '/cortex.html?demo'); await seed.waitForFunction(() => typeof DEMOSRV !== 'undefined' && DEMOSRV.cfg && DEMOSRV.units && DEMOSRV.units.length, null, { timeout: 15000 });
    const site = await seed.evaluate(() => { const cfg = JSON.parse(JSON.stringify(DEMOSRV.cfg)); return { cfg, tech: (cfg.users.find(u => roleCaps(u.role).tech) || {}).username }; }); await seed.context().close(); await J('/api/appconfig', site.cfg);
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }); await ctx.addInitScript((u) => { try { localStorage.setItem('airow_session', JSON.stringify({ username: u, loginAt: Date.now(), last: Date.now() })); } catch (_) {} }, site.tech);
    const P = await ctx.newPage(), errs = []; P.on('pageerror', e => errs.push(String(e))); P.on('dialog', d => d.accept()); await P.goto(BASE + '/'); await P.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser, null, { timeout: 20000 });
    fs.rmSync(path.join(tmp, 'approved'), { force: true }); fs.writeFileSync(path.join(tmp, 'ts-state'), 'NeedsLogin');
    await P.evaluate(() => openRemote()); await P.waitForSelector('[data-remote="on"]'); await P.click('[data-remote="on"]');
    await P.waitForSelector('#remote-box a[href^="https://login.tailscale.com/"]', { timeout: 10000 });
    ok('the dashboard shows the sign-in page to open', /approve this controller/i.test(await P.textContent('#remote-box')));
    fs.writeFileSync(path.join(tmp, 'approved'), '1'); await P.waitForFunction(() => /Remote access is on/.test(document.getElementById('remote-box').textContent), null, { timeout: 12000 });
    ok('and turns green by itself once approved', /cortex-test\.example-net\.ts\.net/.test(await P.textContent('#remote-box')));
    if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + 'remote.png' });
    await P.evaluate(() => closeModal()); await P.evaluate(() => openConsole()); await P.waitForSelector('#cs-new');
    await P.fill('#cs-new', 'correct horse battery'); await P.fill('#cs-new2', 'correct horse battery'); await P.click('#cs-set'); await P.waitForSelector('#cs-in');
    await P.fill('#cs-in', 'echo from-the-page-$((2+3))'); await P.press('#cs-in', 'Enter'); await P.waitForFunction(() => /from-the-page-5/.test(document.getElementById('cs-out').textContent), null, { timeout: 8000 });
    ok('the console window sets its password, opens, and runs a command', true);
    if (process.env.SHOTS) await P.screenshot({ path: process.env.SHOTS + 'console.png' });
    await P.click('#cs-end'); ok('no page errors', errs.length === 0, errs.join(' | '));
    fs.rmSync(path.join(data, 'console.json'), { force: true });
    // --- the console
    r = await J('/api/console'); ok('the console starts with no password set', r.set === false && r.locked === false, JSON.stringify(r));
    r = await J('/api/console/run', { token: 'nope', cmd: 'id' }); ok('no command runs without a session', r._status === 403);
    r = await J('/api/console/open', { password: 'anything' }); ok('and no session opens before a password exists', r._status === 403);
    r = await J('/api/console/password', { password: 'short' }); ok('a short password is refused', r._status === 400);
    r = await J('/api/console/password', { password: 'correct horse battery' }); ok('the first person sets the password', r.ok === true);
    const doc = JSON.parse(fs.readFileSync(path.join(data, 'console.json'), 'utf8'));
    ok('it is stored hashed, on the controller, not in the shared settings', !!doc.hash && doc.hash.length === 64 && !JSON.stringify(doc).includes('correct horse') && (fs.statSync(path.join(data, 'console.json')).mode & 0o077) === 0 && fs.readdirSync(data).filter(f => f !== 'console.json' && fs.statSync(path.join(data, f)).isFile()).every(f => !fs.readFileSync(path.join(data, f), 'utf8').includes(doc.hash)), JSON.stringify(Object.keys(doc)));
    r = await J('/api/console/password', { password: 'another long password' }); ok('changing it needs the old one', r._status === 403);
    r = await J('/api/console/open', { password: 'wrong wrong wrong' }); ok('a wrong password opens nothing', r._status === 403 && !r.token);
    r = await J('/api/console/open', { password: 'correct horse battery' }); const tok = r.token; ok('the right one opens a session', r.ok && typeof tok === 'string' && tok.length >= 40);
    r = await J('/api/console/run', { token: tok, cmd: 'echo hello-$((6*7)); echo oops >&2; exit 3' }); ok('a command runs and its output and exit code come back', /hello-42/.test(r.out) && /oops/.test(r.out) && r.code === 3 && !/__CORTEX/.test(r.out), JSON.stringify(r));
    r = await J('/api/console/run', { token: tok, cmd: 'cd /tmp' }); const r2 = await J('/api/console/run', { token: tok, cmd: 'pwd' });
    ok('the working folder carries from one command to the next', r.cwd === '/tmp' && r2.out.trim() === '/tmp', JSON.stringify([r.cwd, r2.out]));
    r = await J('/api/console/close', { token: tok }); r = await J('/api/console/run', { token: tok, cmd: 'id' }); ok('closing the session ends it', r._status === 403);
    for (let i = 0; i < 5; i++) await J('/api/console/open', { password: 'guess number ' + i });
    r = await J('/api/console/open', { password: 'correct horse battery' }); ok('five wrong tries lock the console, even for the right password', r._status === 429, JSON.stringify(r));
    ok('and the status says so', (await J('/api/console')).locked === true);
  } catch (e) { ok('test ran', false, String(e && e.stack || e)); }
  if (browser) await browser.close().catch(() => {}); if (srv) srv.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
})();
