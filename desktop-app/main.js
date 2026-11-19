/* Cortex for Windows. For the people who use a building's Cortex every day.
 *
 * It does four things a browser tab cannot:
 *   - finds the Cortex controller on the local network, so nobody has to know an address;
 *   - opens it in its own window, from the Start menu or desktop like any program;
 *   - keeps watching from the tray and raises a Windows notification when a unit faults, stops
 *     answering, or the controller cannot be reached (no https or browser permission needed);
 *   - updates itself;
 *   - uses the building network when this PC is on it and the secure (Tailscale) address when it is not,
 *     switching by itself (route.js), so a laptop taken home keeps working.
 *
 * It only ever READS from a controller on its own (GET /health, /api/units, /api/events, /api/diag).
 * Anything that changes the building happens in the controller's own page, by the person using it.
 */
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, Notification, nativeImage, session, powerMonitor, net } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process');
const U = require('./updater'), D = require('./discover'), W = require('./watch'), R = require('./route'), QR = require('./qr');
U.product({ manifest: 'cortex-desktop-manifest.json', file: /^Cortex-Setup-[0-9A-Za-z.+-]+\.exe$/ });

const REPO = 'h2erft/cortex';
const OPT_FILE = () => path.join(app.getPath('userData'), 'app-options.json');
let win = null, tray = null, quitting = false;
let opts = { beta: null, background: true, autoStart: false, autoUpdate: true, notify: true, kinds: { fault: true, silent: true, cleared: false, advisory: true, offline: true }, controllers: [], current: null, bounds: null };
let upd = { state: 'idle', current: app.getVersion(), latest: null, error: null, checkedAt: 0, file: null, progress: 0 };
let snap = null, misses = 0, metaAt = 0, meta = {}, finding = null;
let active = null, via = null, routing = null, carry = null;          // the address in use right now, and how it is reached ('local' | 'remote')

function loadOpts() { try { const j = JSON.parse(fs.readFileSync(OPT_FILE(), 'utf8')); opts = Object.assign(opts, j, { kinds: Object.assign({}, opts.kinds, j.kinds || {}) }); } catch (_) {}
  if (typeof opts.beta !== 'boolean') opts.beta = U.defaultBeta(app.getVersion());
  opts.controllers = (Array.isArray(opts.controllers) ? opts.controllers : []).filter(c => c && D.cleanAddress(c.url)).slice(0, 20);
  if (opts.current && !opts.controllers.some(c => c.url === opts.current)) opts.current = null; }
function saveOpts() { try { fs.writeFileSync(OPT_FILE(), JSON.stringify(opts)); } catch (_) {} }
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
const isFinder = (url) => String(url || '').startsWith('file://');
const sendWin = (ch, v) => { if (win && !win.isDestroyed() && isFinder(win.webContents.getURL())) win.webContents.send(ch, v); };
function setUpd(p) { upd = Object.assign({}, upd, p); sendWin('update:state', upd); }
const publicOpts = () => ({ beta: opts.beta, background: opts.background, autoStart: opts.autoStart, autoUpdate: opts.autoUpdate, notify: opts.notify, kinds: opts.kinds });

/* ---- window ---- */
function finder(view, extra) { if (!win) return; win.loadFile(path.join(__dirname, 'finder.html'), { query: Object.assign({ view: view || 'find' }, extra || {}) }); }
/* ---- which address: building network first, the secure address when that does not answer ---- */
const entry = () => opts.controllers.find(c => c.url === opts.current) || null;
const addr = () => active || opts.current;
const originOf = (u) => { try { return new URL(u).origin; } catch (_) { return ''; } };
function route() {
  if (!opts.current) return Promise.resolve(null); if (routing) return routing; const cur = opts.current;
  const job = routing = (async () => { const e = entry(); if (!e) return null;
    const r = await R.choose(e, (b, ms) => D.probe(b, nodeFetch, ms)); if (cur !== opts.current) return null;
    if (r) { if (R.learn(e, r.hit, r.base)) saveOpts(); r.changed = r.base !== active; active = r.base; via = r.via; }
    return r; })().catch(() => null).finally(() => { if (routing === job) routing = null; });
  return job;
}
const showingController = () => { if (!win || win.isDestroyed()) return false; const u = win.webContents.getURL(); return !!u && (!isFinder(u) || /[?&]view=lost\b/.test(u)); };
/* Try the other address. True when the app moved to a different one (the window follows if it was showing the controller). */
async function reroute() { const was = active, r = await route(); if (!r || r.base === was) return false;
  if (showingController()) win.loadURL(r.base + '/').catch(() => {});
  trayMenu(); return true; }
/* Signing in is remembered per address by the browser engine. So that switching address does not ask the person to
   sign in again, the sign-in for THIS controller is carried over (only ever between addresses route() has confirmed
   are the same controller). */
async function grabSession() { if (!win || win.isDestroyed() || !opts.current) return; const u = win.webContents.getURL(); if (isFinder(u) || originOf(u) !== originOf(addr())) return;
  try { const v = await win.webContents.executeJavaScript('(()=>{try{return localStorage.getItem("airow_session")}catch(e){return null}})()', true); const got = typeof v === 'string' ? v : null;
    if (!got && carry && carry.session && carry.ctl === opts.current && carry.origin !== originOf(u)) return;          // mid-switch: the new address has not been given the sign-in yet
    carry = { ctl: opts.current, origin: originOf(u), session: got }; } catch (_) {} }
async function giveSession(u) { const c = carry; if (!c || !c.session || c.ctl !== opts.current || c.origin === originOf(u) || originOf(u) !== originOf(addr())) return false;
  try { return !!(await win.webContents.executeJavaScript('(()=>{try{if(localStorage.getItem("airow_session"))return false;localStorage.setItem("airow_session",' + JSON.stringify(c.session) + ');return true}catch(e){return false}})()', true)); } catch (_) { return false; } }
async function openController() { if (!win) return; if (!opts.current) return finder('find'); if (!active) await route(); if (!win || !opts.current) return; win.loadURL(addr() + '/').catch(() => {}); }
function show() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function createWindow() {
  const b = opts.bounds || {};
  win = new BrowserWindow({ width: b.width || 1320, height: b.height || 860, x: b.x, y: b.y, minWidth: 420, minHeight: 560, show: false, icon: icon(), backgroundColor: '#0f141a', title: 'Cortex',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
  buildMenu();
  if (opts.current) openController(); else finder('find');
  win.once('ready-to-show', () => { if (!(process.argv.includes('--hidden') && opts.background)) win.show(); });
  // The controller could not be loaded: show our own page, which keeps trying and offers to search again.
  // First see whether its other address answers (this PC may have left, or come back to, the building network).
  win.webContents.on('did-fail-load', async (_e, code, _desc, url, isMain) => { if (!isMain || isFinder(url) || code === -3) return;
    active = null; const r = await route(); if (!win) return;
    if (r && originOf(r.base) !== originOf(url)) { trayMenu(); return win.loadURL(r.base + '/').catch(() => {}); }
    finder('lost', { addr: opts.current || url }); });
  win.webContents.on('did-finish-load', async () => { const u = win.webContents.getURL(); if (isFinder(u)) return;
    if (await giveSession(u)) { carry = null; if (win && !win.isDestroyed()) win.webContents.reload(); return; } grabSession(); });
  // Links: stay inside the controller we connected to; everything else opens in the normal browser.
  const sameSite = (url) => { try { const h = new URL(url).host; return !!opts.current && [addr()].concat(R.candidates(entry())).some(b => new URL(b).host === h); } catch (_) { return false; } };
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (isFinder(url) || sameSite(url)) return; e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(snap && snap.up ? 'Cortex — ' + snap.name + (via === 'remote' ? ' (secure remote connection)' : '') : 'Cortex'); });
  win.on('close', (e) => { try { opts.bounds = win.getNormalBounds(); saveOpts(); } catch (_) {} if (!quitting && opts.background) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}
function buildMenu() {
  const zoom = (d) => { if (win) win.webContents.setZoomLevel(d === 0 ? 0 : win.webContents.getZoomLevel() + d); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Cortex', submenu: [{ label: 'Open Cortex', accelerator: 'CmdOrCtrl+H', click: () => { show(); openController(); } }, { label: 'Reload', accelerator: 'F5', click: () => win && win.webContents.reload() }, { type: 'separator' },
      { label: 'Find controllers…', click: () => { show(); finder('find'); } }, { label: 'App settings…', accelerator: 'CmdOrCtrl+,', click: () => { show(); finder('settings'); } }, { type: 'separator' }, { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }] },
    { label: 'View', submenu: [{ label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) }, { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) }, { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Full screen' }] },
    { label: 'Help', submenu: [{ label: 'Check for updates', click: () => { show(); finder('settings'); check(true); } }, { label: 'About Cortex', click: () => { show(); finder('settings'); } }] }]));
}
function trayMenu() { if (!tray) return;
  const line = !opts.current ? 'No controller chosen yet' : (snap && snap.up ? snap.name + ': ' + snap.on + ' of ' + snap.total + ' on' + (snap.errors ? ', ' + snap.errors + ' in error' : '') + (via === 'remote' ? ' · secure remote connection' : via === 'local' ? ' · building network' : '') : 'Not connected');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: line, enabled: false }, { type: 'separator' }, { label: 'Open Cortex', click: () => { show(); if (win && isFinder(win.webContents.getURL()) && opts.current) openController(); } },
    { label: 'Find controllers…', click: () => { show(); finder('find'); } }, { label: 'App settings…', click: () => { show(); finder('settings'); } }, { label: 'Check for updates', click: () => check(true) }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
  tray.setToolTip(W.tooltip(snap)); }
function makeTray() { try { tray = new Tray(icon().resize({ width: 16, height: 16 })); } catch (_) { return; } tray.on('click', show); trayMenu(); }
function applyAutoStart() { try { app.setLoginItemSettings({ openAtLogin: !!opts.autoStart, args: ['--hidden'] }); } catch (_) {} }
function notify(n) { if (!opts.notify || !Notification.isSupported()) return false; const x = new Notification({ title: n.title, body: n.body, icon: icon() }); x.on('click', () => { show(); if (win && isFinder(win.webContents.getURL()) && opts.current) openController(); }); x.show(); return true; }

/* ---- watching the controller (read-only) ---- */
const nodeFetch = (url, o) => fetch(url, Object.assign({ headers: { 'User-Agent': 'CortexDesktop/' + app.getVersion() } }, o || {}));
async function getCtl(pathname, ms) { const r = await nodeFetch(addr() + pathname, { signal: AbortSignal.timeout(ms || 6000), cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
let looking = false;
async function look() {
  if (looking || !opts.current) { if (!opts.current) { snap = null; trayMenu(); } return; } looking = true; const base = opts.current;
  let raw = null;
  try { const health = await getCtl('/health'), hit = D.identify(health); if (!hit) throw new Error('not cortex');
    const e = entry(); if (e && R.same(e, hit) && R.learn(e, hit, addr())) saveOpts();
    const [units, events, diag] = await Promise.all([getCtl('/api/units').catch(() => ({ units: [] })), getCtl('/api/events').catch(() => ({ events: [] })), getCtl('/api/diag').catch(() => ({ advisories: [] }))]);
    if (Date.now() - metaAt > 600000) { try { const c = await getCtl('/api/appconfig'); meta = (c && c.unitMeta) || {}; metaAt = Date.now(); } catch (_) {} }   // only the unit names are kept
    raw = { health, units, events, diag, meta };
  } catch (_) {}
  looking = false; if (base !== opts.current) return;                 // the person switched controllers meanwhile
  if (!raw && await reroute()) return look();                         // its other address answers: carry on there
  if (raw && via === 'remote' && !(win && !win.isDestroyed() && win.isFocused())) { if (await reroute()) return look(); }   // back in the building: return to the local address, but never under someone's hands
  if (!raw) { let online = true; try { online = net.isOnline(); } catch (_) {} if (!online) { trayMenu(); return; } }   // this PC has no network at all: that is not the controller's fault, so no miss is counted and nobody is told
  grabSession();
  const cur = W.snapshot(raw); misses = cur.up ? 0 : misses + 1;
  const notes = W.diff(snap, cur, misses, opts.kinds); notes.slice(0, 4).forEach(notify);
  if (!cur.up && snap) { cur.name = snap.name; cur.told = !!snap.told || notes.some(n => n.kind === 'offline'); if (snap.up && misses < 2) { trayMenu(); return; } }   // one missed look is not an outage yet
  if (cur.up) { const c = opts.controllers.find(x => x.url === base); if (c && c.name !== cur.name) { c.name = cur.name; saveOpts(); } }
  snap = cur; trayMenu();
}

/* ---- finding controllers ---- */
async function findStart() {
  if (finding) finding.cancel = true; const job = finding = { cancel: false, found: [], done: 0, total: 0, running: true };
  const push = () => sendWin('find:progress', { running: job.running, done: job.done, total: job.total, found: job.found });
  push();
  try { job.found = await D.scan({ ifaces: os.networkInterfaces(), fetch: nodeFetch, known: opts.controllers.map(c => c.url), cancelled: () => job.cancel,
    onFound: (l) => { job.found = l; push(); }, onProgress: (d, t) => { job.done = d; job.total = t; push(); } }); } catch (_) {}
  job.running = false; if (finding === job) push(); return { found: job.found };
}
async function connect(url) {
  const base = D.cleanAddress(url); if (!base) return { ok: false, err: 'That does not look like an address. Try something like 192.168.1.50' };
  const hit = await D.probe(base, nodeFetch, 5000);
  if (!hit) return { ok: false, err: 'Nothing at ' + base.replace(/^https?:\/\//, '') + ' answered as a Cortex controller. Check the address, and that this PC is on the same network.' };
  let c = opts.controllers.find(x => x.url === base); if (c) c.name = hit.name; else { c = { url: base, name: hit.name }; opts.controllers.unshift(c); }
  if (c.id && hit.id && c.id !== hit.id) { c.local = []; c.remote = null; }                         // a different controller now lives at this address
  R.learn(c, hit, base); opts.current = base; active = base; via = R.isLocal(base) ? 'local' : 'remote'; carry = null; saveOpts(); snap = null; misses = 0; metaAt = 0; meta = {}; if (finding) finding.cancel = true;
  openController(); look(); return { ok: true, name: hit.name };
}

/* ---- updater (same rules as Cortex Command; see command-app/updater.js) ---- */
async function getJson(url) { const r = await fetch(url, { headers: { 'User-Agent': 'CortexDesktop/' + app.getVersion(), Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('GitHub answered ' + r.status); return r.json(); }
const releases = () => getJson('https://api.github.com/repos/' + REPO + '/releases?per_page=30');
let checking = false;
async function check(manual) {
  if (checking || upd.state === 'downloading') return upd; checking = true;
  try { setUpd({ state: upd.state === 'ready' ? 'ready' : 'checking', error: null });
    const d = U.decide(app.getVersion(), await releases(), !!opts.beta);
    if (d.state !== 'available') { if (upd.state !== 'ready') setUpd({ state: d.state === 'current' ? 'current' : 'none', latest: d.latest || null, checkedAt: Date.now(), error: null }); return upd; }
    if (upd.state === 'ready' && upd.latest === d.latest && upd.file && fs.existsSync(upd.file)) { setUpd({ checkedAt: Date.now() }); return upd; }
    setUpd({ state: 'available', latest: d.latest, checkedAt: Date.now(), revert: false });
    if (opts.autoUpdate || manual) await download(d.pick);
  } catch (e) { if (upd.state !== 'ready') setUpd({ state: 'error', error: String(e.message || e), checkedAt: Date.now() }); }
  finally { checking = false; }
  return upd;
}
async function download(pick) {
  setUpd({ state: 'downloading', progress: 0 });
  const man = await getJson(pick.manifestUrl), url = U.installerUrl(pick, man);
  if (!url) throw new Error('The release does not list a valid installer.');
  const r = await fetch(url, { headers: { 'User-Agent': 'CortexDesktop/' + app.getVersion() }, signal: AbortSignal.timeout(15 * 60000) }); if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (U.sha256(buf) !== String(man.sha256).toLowerCase()) throw new Error('The download did not match its checksum, so it was thrown away.');
  const file = path.join(os.tmpdir(), man.file); fs.writeFileSync(file, buf);
  setUpd({ state: 'ready', file, latest: pick.version, progress: 100 });
  if (Notification.isSupported()) new Notification({ title: 'Cortex update ready', body: 'Version ' + pick.version + ' installs the next time Cortex is restarted.', icon: icon() }).show();
}
function install() {
  if (upd.state !== 'ready' || !upd.file || !fs.existsSync(upd.file)) return false;
  try { spawn(upd.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { setUpd({ state: 'error', error: 'Could not start the installer: ' + e.message }); return false; }
  quitting = true; setTimeout(() => app.quit(), 400); return true;
}

/* ---- wiring ---- */
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    app.setAppUserModelId('com.airow.cortex');
    loadOpts(); applyAutoStart(); makeTray();
    // The controller's page is ordinary web content: it may show notifications and go full screen, nothing else.
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications' || perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
    createWindow();
    const own = (fn) => (e, ...a) => (e.senderFrame && isFinder(e.senderFrame.url)) ? fn(...a) : null;      // only the app's own pages may ask
    ipcMain.handle('app:info', own(() => ({ version: app.getVersion(), options: publicOpts(), update: upd, controllers: opts.controllers, current: opts.current, status: snap, via: opts.current ? via : null, active: opts.current ? addr() : null })));
    ipcMain.handle('phone:info', own(() => { const e = entry(), L = R.phoneLinks(e), one = (u) => u ? { url: u + '/', svg: QR.svg(u + '/') } : null; return { name: e ? e.name : null, remote: one(L.remote), local: one(L.local) }; }));
    ipcMain.handle('app:options', own((o) => { o = o || {};
      for (const k of ['beta', 'background', 'autoStart', 'autoUpdate', 'notify']) if (typeof o[k] === 'boolean') opts[k] = o[k];
      if (o.kinds && typeof o.kinds === 'object') for (const k of Object.keys(opts.kinds)) if (typeof o.kinds[k] === 'boolean') opts.kinds[k] = o.kinds[k];
      saveOpts(); applyAutoStart(); if (typeof o.beta === 'boolean') check(false); return publicOpts(); }));
    ipcMain.handle('find:start', own(() => findStart()));
    ipcMain.handle('find:stop', own(() => { if (finding) finding.cancel = true; return true; }));
    ipcMain.handle('find:connect', own((url) => connect(url)));
    ipcMain.handle('find:retry', own(async () => { active = null; const r = await route(); if (!r) return { ok: false }; openController(); look(); return { ok: true, via: r.via }; }));
    ipcMain.handle('find:forget', own((url) => { opts.controllers = opts.controllers.filter(c => c.url !== url); if (opts.current === url) { opts.current = null; snap = null; active = null; via = null; carry = null; } saveOpts(); trayMenu(); return { controllers: opts.controllers, current: opts.current }; }));
    ipcMain.handle('app:open', own(() => { openController(); return true; }));
    ipcMain.handle('app:test-notify', own(() => { const was = opts.notify; opts.notify = true; const ok = notify({ title: 'Cortex notifications are working', body: 'This is what an alert from your building will look like.' }); opts.notify = was; return ok; }));
    ipcMain.handle('update:check', own(() => check(true)));
    ipcMain.handle('update:install', own(() => install()));
    ipcMain.handle('update:leave-beta', own(async () => { try { const L = U.leaveBeta(app.getVersion(), await releases()); return { ok: true, onBeta: L.onBeta, current: L.current, stable: L.stable ? L.stable.version : null, canRevert: L.canRevert, stableIsNewer: L.stableIsNewer }; } catch (e) { return { ok: false, err: String(e.message || e) }; } }));
    ipcMain.handle('update:revert', own(async () => { if (checking || upd.state === 'downloading') return upd; checking = true;
      try { const L = U.leaveBeta(app.getVersion(), await releases()); if (!L.canRevert) { setUpd({ state: 'error', error: 'There is no older stable release to go back to.' }); return upd; }
        opts.beta = false; saveOpts(); await download(L.stable); setUpd({ revert: true }); }
      catch (e) { setUpd({ state: 'error', error: String(e.message || e), checkedAt: Date.now() }); } finally { checking = false; }
      return upd; }));
    setTimeout(look, 3000); setInterval(look, 30000);
    try { powerMonitor.on('resume', () => setTimeout(async () => { await reroute(); look(); }, 4000)); } catch (_) {}   // the lid opens somewhere else: find the address that works here
    setTimeout(() => check(false), 20000); setInterval(() => check(false), 6 * 3600000);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!opts.background) app.quit(); });
  app.on('activate', show);
}
