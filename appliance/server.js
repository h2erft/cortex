/* Cortex appliance backend — AIROW.
 * Serves the Cortex UI and bridges the RS485 adapter to the browser over a WebSocket.
 * The browser never touches the serial port in appliance mode; this process owns it,
 * which is far more reliable for 24/7 operation than Web Serial.
 *
 * Config via environment (set in the systemd unit):
 *   CORTEX_PORT    TCP port to serve on            (default 8080)
 *   CORTEX_SERIAL  default serial device            (default /dev/ttyUSB0)
 *   CORTEX_DIR     folder of static files           (default this file's folder)
 *   CORTEX_DATA    persistent data dir              (default <CORTEX_DIR>/../data)
 *
 * Site-specific settings (name, serial device) live in <CORTEX_DATA>/config.json and are
 * edited from the browser setup wizard — no SSH needed. The env values above are just the
 * defaults used until the wizard writes that file.
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const path = require('path');
const fs   = require('fs');

const PORT   = parseInt(process.env.CORTEX_PORT || '8080', 10);
const SERIAL = process.env.CORTEX_SERIAL || '/dev/ttyUSB0';
const DIR    = process.env.CORTEX_DIR || __dirname;
const DATA   = process.env.CORTEX_DATA || path.join(DIR, '..', 'data');
const CONFIG = path.join(DATA, 'config.json');

try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}

// Version is the single source of truth for OTA. A successful update writes a new
// VERSION file into the release, so /health reports the running build automatically.
function readVersion() {
  try { return fs.readFileSync(path.join(DIR, 'VERSION'), 'utf8').trim() || '0.0.0'; }
  catch (_) { return '0.0.0'; }
}

// Site config: config.json wins, env is the fallback. 'configured' drives the setup wizard.
function readConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (_) {}
  const name   = (typeof c.name   === 'string' && c.name.trim())   ? c.name.trim()   : (process.env.CORTEX_NAME || '');
  const serial = (typeof c.serial === 'string' && c.serial.trim()) ? c.serial.trim() : SERIAL;
  return { name, serial, configured: !!name };
}
function writeConfig(next) {
  const cur = readConfig();
  const out = {
    name:   typeof next.name   === 'string' ? next.name.trim()   : cur.name,
    serial: typeof next.serial === 'string' ? next.serial.trim() : cur.serial,
  };
  fs.writeFileSync(CONFIG, JSON.stringify(out, null, 2));
  return out;
}

const app = express();
app.use(express.json({ limit: '32kb' }));
const cors = (res) => res.set('Access-Control-Allow-Origin', '*');

// Health / version — read fresh each call so the fleet console sees live values.
app.get('/health', (_req, res) => {
  const c = readConfig();
  cors(res);
  res.json({ ok: true, serial: c.serial, port: PORT, version: readVersion(), name: c.name, configured: c.configured });
});
app.get('/version', (_req, res) => {
  cors(res);
  res.json({ version: readVersion(), name: readConfig().name });
});

// --- setup wizard API ---------------------------------------------------------
// List serial adapters the OS can see, so the wizard offers a dropdown.
app.get('/api/serial-ports', async (_req, res) => {
  cors(res);
  try {
    const ports = await SerialPort.list();
    res.json({ ports: ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '', serialNumber: p.serialNumber || '' })) });
  } catch (e) {
    res.json({ ports: [], err: e.message });
  }
});
// Current config (for prefilling the wizard).
app.get('/api/config', (_req, res) => { cors(res); res.json(readConfig()); });
// Save config from the wizard. Writes config.json; takes effect on the next bus connect.
app.post('/api/config', (req, res) => {
  cors(res);
  const b = req.body || {};
  if (b.name !== undefined && typeof b.name !== 'string')     return res.status(400).json({ err: 'name must be a string' });
  if (b.serial !== undefined && typeof b.serial !== 'string') return res.status(400).json({ err: 'serial must be a string' });
  try { res.json({ ok: true, config: writeConfig(b) }); }
  catch (e) { res.status(500).json({ err: e.message }); }
});

// --- OTA update check ---------------------------------------------------------
// Reads the manifest URL (+ optional private-repo token) from data/update.conf, fetches
// the manifest server-side, and reports whether a newer version is available. Done in the
// backend so the token never touches the browser and there's no CORS issue.
function readUpdateConf() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(DATA, 'update.conf'), 'utf8').split('\n')) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch (_) {}
  return out;
}
function isNewer(cur, next) {               // true if next > cur (semver-ish, 3 parts)
  const a = String(cur).split('.').map(n => parseInt(n, 10) || 0);
  const b = String(next).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((b[i]||0) > (a[i]||0)) return true; if ((b[i]||0) < (a[i]||0)) return false; }
  return false;
}
app.get('/api/update/check', async (_req, res) => {
  cors(res);
  const current = readVersion();
  const conf = readUpdateConf();
  const headers = { 'User-Agent': 'cortex-appliance' };
  if (conf.CORTEX_UPDATE_TOKEN) headers.Authorization = 'Bearer ' + conf.CORTEX_UPDATE_TOKEN;
  try {
    let latest = '', notes = '';
    if (conf.CORTEX_UPDATE_REPO) {
      // GitHub API mode — same path the updater uses (works with private repos + fine-grained tokens)
      const r = await fetch(`https://api.github.com/repos/${conf.CORTEX_UPDATE_REPO}/releases/latest`,
        { headers: { ...headers, Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
      latest = ((await r.json()).tag_name || '').replace(/^v/, '');
    } else if (conf.CORTEX_UPDATE_MANIFEST) {
      const r = await fetch(conf.CORTEX_UPDATE_MANIFEST, { headers, redirect: 'follow' });
      if (!r.ok) throw new Error('manifest HTTP ' + r.status);
      const m = await r.json();
      latest = m.version || ''; notes = m.notes || '';
    } else {
      return res.json({ current, configured: false, updateAvailable: false });
    }
    res.json({ current, latest, configured: true, updateAvailable: isNewer(current, latest),
               notes, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.json({ current, configured: true, updateAvailable: false, error: e.message });
  }
});

// --- first-run redirect -------------------------------------------------------
// An unconfigured box sends you straight to the setup wizard; once named, '/' is the app.
app.get('/', (_req, res, next) => {
  if (!readConfig().configured && fs.existsSync(path.join(DIR, 'setup.html'))) {
    return res.redirect('/setup.html');
  }
  next();
});

app.use(express.static(DIR, { index: 'cortex.html', extensions: ['html'] }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/bus' });

// One serial consumer at a time — the bus is a single physical port.
let busy = false;

wss.on('connection', (ws, req) => {
  if (busy) { try { ws.send(JSON.stringify({ err: 'serial already in use by another session' })); } catch (_) {} ws.close(); return; }
  const u = new URL(req.url, 'http://x');
  const serial = readConfig().serial;                         // read fresh: wizard changes apply here
  const baud   = parseInt(u.searchParams.get('baud') || '4800', 10);
  const parity = u.searchParams.get('parity') || 'none';
  const stop   = parseInt(u.searchParams.get('stop') || '1', 10);
  const data   = parseInt(u.searchParams.get('data') || '8', 10);

  let port;
  try {
    port = new SerialPort({ path: serial, baudRate: baud, parity, stopBits: stop, dataBits: data });
  } catch (e) {
    try { ws.send(JSON.stringify({ err: 'open failed: ' + e.message })); } catch (_) {}
    ws.close(); return;
  }
  busy = true;
  port.on('open',  () => { try { ws.send(JSON.stringify({ ok: true, port: serial, baud })); } catch (_) {} });
  port.on('error', (e) => { try { ws.send(JSON.stringify({ err: e.message })); } catch (_) {} });
  port.on('data',  (buf) => { if (ws.readyState === 1) ws.send(buf); });        // bytes -> browser (binary)
  ws.on('message', (msg, isBinary) => { if (isBinary && port.writable) port.write(Buffer.from(msg)); }); // browser -> bytes

  const cleanup = () => { busy = false; try { if (port.isOpen) port.close(() => {}); } catch (_) {} };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, () => console.log(`Cortex appliance listening on :${PORT}  (serial ${readConfig().serial})`));
