/* Cortex Command desktop app. A window around command-center.html, plus the things a web page cannot do:
 * install like a normal Windows program, update itself, keep watching the buildings from the tray after
 * the window is closed, and raise Windows notifications. */
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process');
const U = require('./updater');

const REPO = 'h2erft/cortex';
const OPT_FILE = () => path.join(app.getPath('userData'), 'app-options.json');
let win = null, tray = null, quitting = false;
let opts = { beta: false, background: true, autoStart: false, autoUpdate: true };
let upd = { state: 'idle', current: app.getVersion(), latest: null, error: null, checkedAt: 0, file: null, progress: 0 };

function loadOpts() { try { opts = Object.assign(opts, JSON.parse(fs.readFileSync(OPT_FILE(), 'utf8'))); } catch (_) {} }
function saveOpts() { try { fs.writeFileSync(OPT_FILE(), JSON.stringify(opts)); } catch (_) {} }
function send() { if (win && !win.isDestroyed()) win.webContents.send('update:state', upd); }
function setUpd(p) { upd = Object.assign({}, upd, p); send(); }
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'icon.png'));

function show() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 420, minHeight: 560, show: false, autoHideMenuBar: true, icon: icon(), backgroundColor: '#0f141a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'command-center.html'));
  win.once('ready-to-show', () => win.show());
  // "Open dashboard" and every other link opens in the normal browser, never inside this window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  win.on('close', (e) => { if (!quitting && opts.background) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}
function makeTray() {
  try { tray = new Tray(icon().resize({ width: 16, height: 16 })); } catch (_) { return; }
  tray.setToolTip('Cortex Command');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Cortex Command', click: show }, { label: 'Check for updates', click: () => check(true) }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
  tray.on('click', show);
}
function applyAutoStart() { try { app.setLoginItemSettings({ openAtLogin: !!opts.autoStart, args: ['--hidden'] }); } catch (_) {} }

/* ---- updater ---- */
async function getJson(url) { const r = await fetch(url, { headers: { 'User-Agent': 'CortexCommand/' + app.getVersion(), Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('GitHub answered ' + r.status); return r.json(); }
let checking = false;
async function check(manual) {
  if (checking || upd.state === 'downloading') return upd; checking = true;
  try {
    setUpd({ state: upd.state === 'ready' ? 'ready' : 'checking', error: null });
    const rel = await getJson('https://api.github.com/repos/' + REPO + '/releases?per_page=30');
    const d = U.decide(app.getVersion(), rel, !!opts.beta);
    if (d.state !== 'available') { if (upd.state !== 'ready') setUpd({ state: d.state === 'current' ? 'current' : 'none', latest: d.latest || null, checkedAt: Date.now(), error: d.reason || null }); return upd; }
    if (upd.state === 'ready' && upd.latest === d.latest && upd.file && fs.existsSync(upd.file)) { setUpd({ checkedAt: Date.now() }); return upd; }
    setUpd({ state: 'available', latest: d.latest, checkedAt: Date.now(), notesUrl: d.pick.notesUrl });
    if (opts.autoUpdate || manual) await download(d.pick);
  } catch (e) { if (upd.state !== 'ready') setUpd({ state: 'error', error: String(e.message || e), checkedAt: Date.now() }); }
  finally { checking = false; }
  return upd;
}
async function download(pick) {
  setUpd({ state: 'downloading', progress: 0 });
  const man = await getJson(pick.manifestUrl), url = U.installerUrl(pick, man);
  if (!url) throw new Error('The release does not list a valid installer.');
  const r = await fetch(url, { headers: { 'User-Agent': 'CortexCommand/' + app.getVersion() }, signal: AbortSignal.timeout(15 * 60000) }); if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (U.sha256(buf) !== String(man.sha256).toLowerCase()) throw new Error('The download did not match its checksum, so it was thrown away.');
  const file = path.join(os.tmpdir(), man.file); fs.writeFileSync(file, buf);
  setUpd({ state: 'ready', file, latest: pick.version, progress: 100 });
  if (Notification.isSupported()) new Notification({ title: 'Cortex Command update ready', body: 'Version ' + pick.version + ' is downloaded. Restart Cortex Command to install it.' }).show();
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
    app.setAppUserModelId('com.airow.cortexcommand');
    loadOpts(); applyAutoStart(); makeTray();
    createWindow(); if (process.argv.includes('--hidden') && opts.background) win.once('ready-to-show', () => win.hide());
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), options: opts, update: upd, platform: process.platform }));
    ipcMain.handle('app:options', (_e, o) => { for (const k of ['beta', 'background', 'autoStart', 'autoUpdate']) if (o && typeof o[k] === 'boolean') opts[k] = o[k]; saveOpts(); applyAutoStart(); if (o && typeof o.beta === 'boolean') check(false); return opts; });
    ipcMain.handle('update:check', () => check(true));
    ipcMain.handle('update:install', () => install());
    ipcMain.handle('app:show', () => { show(); return true; });
    ipcMain.handle('app:notify', (_e, n) => { if (!Notification.isSupported()) return false; const x = new Notification({ title: n.title, body: n.body, icon: icon() }); x.on('click', show); x.show(); return true; });
    setTimeout(() => check(false), 15000); setInterval(() => check(false), 6 * 3600000);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!opts.background) app.quit(); });
  app.on('activate', show);
}
