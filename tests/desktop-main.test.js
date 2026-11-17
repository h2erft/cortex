// Cortex for Windows, the real main.js, run against a pretend Electron and a pretend network:
// does it open the building-network address in the office, the secure one at home, and move between them?
//   node tests/desktop-main.test.js
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmain-')), LOCAL = 'http://192.168.1.50', REMOTE = 'https://harbor.example-net.ts.net:8443';
fs.writeFileSync(path.join(dir, 'app-options.json'), JSON.stringify({ controllers: [{ url: LOCAL, name: 'Harbor Point', id: 'aaaaaaaaaaaaaaaa', local: [LOCAL], remote: REMOTE }], current: LOCAL, beta: false, autoUpdate: false }));
if (!fs.existsSync(path.join(__dirname, '..', 'desktop-app', 'updater.js'))) fs.copyFileSync(path.join(__dirname, '..', 'command-app', 'updater.js'), path.join(__dirname, '..', 'desktop-app', 'updater.js'));
const handlers = {}, loads = [], wcOn = {}; let focused = true, url = '', store = {};
const wc = { on: (e, f) => { wcOn[e] = f; }, getURL: () => url, send() {}, setWindowOpenHandler() {}, reload: () => { loads.push('reload'); setTimeout(() => wcOn['did-finish-load'](), 0); }, setZoomLevel() {}, getZoomLevel: () => 0,
  executeJavaScript: async (js) => { const o = new URL(url).origin, ls = store[o] = store[o] || {}; return new Function('localStorage', 'return ' + js)({ getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } }); } };
class BrowserWindow { constructor() { this.webContents = wc; } once() {} on() {} isDestroyed() { return false; } isFocused() { return focused; } isMinimized() { return false; } show() {} focus() {} setTitle() {} getNormalBounds() { return {}; }
  loadFile(f, o) { url = 'file://' + f + '?view=' + o.query.view; loads.push('finder:' + o.query.view); return Promise.resolve(); }
  loadURL(u) { loads.push(u); const b = u.replace(/\/$/, ''); if (up[b]) { url = u; setTimeout(() => wcOn['did-finish-load'](), 0); return Promise.resolve(); } setTimeout(() => wcOn['did-fail-load']({}, -105, '', u, true), 0); return Promise.reject(new Error('x')); } }
const electron = { app: { getPath: () => dir, getVersion: () => '1.7.1', requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), setAppUserModelId() {}, setLoginItemSettings() {}, quit() {} }, BrowserWindow,
  Tray: class { on() {} setContextMenu() {} setToolTip() {} }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x }, shell: {}, ipcMain: { handle: (k, f) => { handlers[k] = f; } },
  Notification: Object.assign(class { on() {} show() {} }, { isSupported: () => false }), nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, session: { defaultSession: { setPermissionRequestHandler() {} } }, powerMonitor: { on() {} } };
const load = Module._load; Module._load = function (req, ...a) { return req === 'electron' ? electron : load.call(this, req, ...a); };
const health = { ok: true, app: 'cortex', version: '1.7.1', name: 'Harbor Point', id: 'aaaaaaaaaaaaaaaa', port: 8080, port80: true, lan: ['192.168.1.50'], configured: true, https: { active: true, port: 8443, trusted: true, name: 'harbor.example-net.ts.net' } };
let up = {};
global.fetch = async (u) => { const m = /^(https?:\/\/[^/]+)(\/.*)$/.exec(String(u)); if (!m || !up[m[1]]) throw new Error('unreachable');
  const body = m[2] === '/health' ? up[m[1]] : m[2] === '/api/units' ? { units: [] } : m[2] === '/api/events' ? { events: [] } : m[2] === '/api/diag' ? { advisories: [] } : {}; return { ok: true, json: async () => body }; };
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout; let lookFn = null;
global.setInterval = (f, ms) => { if (ms === 30000) lookFn = f; return { unref() {} }; };                     // the 30 s look is run by hand below
global.setTimeout = (f, ms, ...a) => (ms >= 3000 ? { unref() {} } : realSetTimeout(f, ms, ...a));
const wait = (ms) => new Promise(r => realSetTimeout(r, ms || 60)), ev = { senderFrame: { get url() { return 'file:///x/finder.html'; } } }, last = () => loads[loads.length - 1];
(async () => {
  try {
    // 1. at home: the office address is silent, the secure one answers
    up = { [REMOTE]: health }; store[new URL(LOCAL).origin] = {}; 
    require('../desktop-app/main.js'); await wait(2400);
    eq('at home it opens the secure address', last(), REMOTE + '/');
    eq('and says how it is connected', (await handlers['app:info'](ev)).via, 'remote');
    // 2. signed in there; back in the office with the window in use: stays put
    store[new URL(REMOTE).origin].airow_session = '{"username":"pat"}'; up = { [LOCAL]: health, [REMOTE]: health }; focused = true; await lookFn(); await wait();
    eq('back in the office but in use: it does not reload under your hands', last(), REMOTE + '/');
    // 3. window not in use: moves to the building network and brings the sign-in along
    focused = false; await lookFn(); await wait(200);
    eq('window idle: it moves to the building network', loads.slice(-2), [LOCAL + '/', 'reload']);
    eq('the sign-in came along', store[new URL(LOCAL).origin].airow_session, '{"username":"pat"}');
    eq('now local', (await handlers['app:info'](ev)).via, 'local');
    // 4. taken home while running: local dies, secure answers
    up = { [REMOTE]: health }; focused = true; await lookFn(); await wait(2400);
    eq('taken home while running: it moves to the secure address', last(), REMOTE + '/');
    // 5. everything down: the can't-reach page; then it comes back
    up = {}; url = REMOTE + '/'; await wcOn['did-fail-load']({}, -105, '', REMOTE + '/', true); await wait(100);
    eq('nothing answers: the can\'t-reach page', last(), 'finder:lost');
    up = { [LOCAL]: health }; eq('Try now finds whichever address works', [(await handlers['find:retry'](ev)).ok, (await wait(100), last())], [true, LOCAL + '/']);
    // 6. somebody else's device at the office address is not opened
    up = { [LOCAL]: Object.assign({}, health, { id: 'bbbbbbbbbbbbbbbb', name: 'Other' }) }; eq('a different controller at that address is refused', (await handlers['find:retry'](ev)).ok, false);
    const P = await handlers['phone:info'](ev); eq('phone links come with codes', [P.remote.url, P.local.url, /^<svg/.test(P.remote.svg)], [REMOTE + '/', LOCAL + '/', true]);
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  fs.rmSync(dir, { recursive: true, force: true }); console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
