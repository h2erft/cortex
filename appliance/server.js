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
 * Optional HTTPS (opt-in, additive — plain http above keeps working exactly as before):
 *   CORTEX_HTTPS       1 to ALSO serve https + wss  (default off)
 *   CORTEX_HTTPS_PORT  https port                   (default 8443)
 *   CORTEX_TLS_CERT / CORTEX_TLS_KEY  PEM files     (default <CORTEX_DATA>/tls/cert.pem, key.pem)
 *
 * Site-specific settings (name, serial device) live in <CORTEX_DATA>/config.json and are
 * edited from the browser setup wizard — no SSH needed. The env values above are just the
 * defaults used until the wizard writes that file.
 */
const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { execFile, execFileSync } = require('child_process');

// Live bus-activity counters, updated by the serial bridge below, reported by /api/device.
const busRx = { bytes: 0, last: 0, active: false };
const lgLines = new Map();
const L0 = { cfg: { id: 0, name: 'LG line 1' }, scan: null, found: new Map() };     // the first LG line, for the unit search
let searchAll = null, lgReady = false;   // searchAll: { at, order:[line ids], i, endedAt, skipped }
/* What is said on every LG line, newest last, for the Bus scan page: each thing sent, and each burst heard (bytes that
   arrive within 40 ms of each other are one burst). A small ring; nothing is written to disk. */
const traffic = { seq: 0, ring: [], pend: new Map() };
function trafficPush(line, dir, buf) { traffic.ring.push({ n: ++traffic.seq, t: Date.now(), line, dir, hex: Buffer.from(buf).toString('hex') }); if (traffic.ring.length > 600) traffic.ring.splice(0, traffic.ring.length - 600); }
function trafficRx(line, buf) { let p = traffic.pend.get(line); if (!p) { p = { parts: [], timer: null }; traffic.pend.set(line, p); }
  p.parts.push(Buffer.from(buf)); clearTimeout(p.timer); p.timer = setTimeout(() => { const all = Buffer.concat(p.parts); p.parts = []; trafficPush(line, 'rx', all.length > 96 ? all.subarray(0, 96) : all); }, 40); }
const trafficOn = () => Date.now() - (traffic.watchAt || 0) < 15000;       // only collected while a screen is looking          // extra LG lines, each on its own adapter (see "more than one LG line" below)

const PORT   = parseInt(process.env.CORTEX_PORT || '8080', 10);
const SERIAL = process.env.CORTEX_SERIAL || '/dev/ttyUSB0';
const DIR    = process.env.CORTEX_DIR || __dirname;
const DATA   = process.env.CORTEX_DATA || path.join(DIR, '..', 'data');
const CONFIG = path.join(DATA, 'config.json');

try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}

// Crash-safe file handling. A power cut in the middle of a plain writeFile leaves a half-written
// (corrupt) file — for appconfig.json that would mean every login and schedule gone. So: write to a
// temp file, fsync it, keep the previous good copy as <file>.bak, then rename (atomic on Linux).
// Reads fall back to the .bak if the main file is missing or unreadable.
function writeFileAtomic(p, text) {
  const tmp = p + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { const cur = fs.readFileSync(p, 'utf8'); JSON.parse(cur); fs.writeFileSync(p + '.bak', cur); } catch (_) {}   // only a GOOD copy becomes the backup
  fs.renameSync(tmp, p);
}
function readJsonSafe(p) {
  for (const f of [p, p + '.bak']) {
    try { const t = fs.readFileSync(f, 'utf8'); if (t.trim()) return JSON.parse(t); } catch (_) {}
  }
  return null;
}

// Version is the single source of truth for OTA. A successful update writes a new
// VERSION file into the release, so /health reports the running build automatically.
function readVersion() {
  try { return fs.readFileSync(path.join(DIR, 'VERSION'), 'utf8').trim() || '0.0.0'; }
  catch (_) { return '0.0.0'; }
}

// The version this PROCESS started with. /version also reports it as "running" so the updater's
// health check can tell a freshly started build from an old process that is still answering.
const BOOT_VERSION = readVersion();

// Site config: config.json wins, env is the fallback. 'configured' drives the setup wizard.
function readConfig() {
  const c = readJsonSafe(CONFIG) || {};
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
  writeFileAtomic(CONFIG, JSON.stringify(out, null, 2));
  return out;
}

// HTTPS status, filled in by startHttps() at the bottom of this file and reported by /api/device.
const httpsState = {
  // On unless switched off (CORTEX_HTTPS=0). From 1.7.1: https is the default so remote access is encrypted and
  // phone alerts can work; plain http stays exactly as it was. Before 1.7.1 it was opt-in (CORTEX_HTTPS=1).
  enabled: !/^(0|false|no|off)$/i.test(String(process.env.CORTEX_HTTPS || '').trim()),
  active: false,
  port: parseInt(process.env.CORTEX_HTTPS_PORT || '8443', 10) || 8443,
  error: null,
  cert: null,
};

const app = express();
// The shared app config (users, schedules, unit names, floor-plan positions) is one JSON document;
// 32kb was tight once a site has many units, and an over-limit save failed silently in the browser.
app.use(express.json({ limit: '256kb' }));
const cors = (res) => res.set('Access-Control-Allow-Origin', '*');

// Anything that CHANGES the controller (save config, reboot, start an update, queue a command) must
// come from a page this appliance served. Without this, any web page open in a browser on the same
// network could quietly POST to http://cortex.local:8080/api/power/shutdown. Reads stay open (the
// fleet console polls /health from a local file).
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;                                   // same-origin GET/form posts and non-browser tools send none
  // behind a reverse proxy (nginx, tailscale serve) the Host header may be the proxy's inner address —
  // the original host then arrives in X-Forwarded-Host, which a hostile web page cannot set.
  try { const h = new URL(o).host; return h === req.headers.host || h === String(req.headers['x-forwarded-host'] || '').split(',')[0].trim(); }
  catch (_) { return false; }
}
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!sameOrigin(req)) return res.status(403).json({ err: 'cross-site request refused' });
  next();
});

// Health / version — read fresh each call so the fleet console sees live values.
app.get('/health', (_req, res) => {
  const c = readConfig();
  cors(res);
  res.json({ ok: true, app: 'cortex', id: controllerId(), serial: c.serial, port: PORT, port80: typeof port80 !== 'undefined' ? port80.active : false, version: readVersion(), running: BOOT_VERSION, name: c.name, configured: c.configured,
    bus: (() => { const i = busInfo(); return { on: i.on, open: i.open, polling: i.polling, holder: i.holder }; })(),
    lan: lanAddrs(),                // this box's addresses on the building network, so an app or phone that came in over the secure address can find the local one
    https: { active: httpsState.active, port: httpsState.port, trusted: !!(httpsState.cert && !httpsState.cert.selfSigned), name: (httpsState.cert && httpsState.cert.name) || null } });
});
app.get('/version', (_req, res) => {
  cors(res);
  res.json({ version: readVersion(), running: BOOT_VERSION, name: readConfig().name });
});

// Live hardware vitals, read from the OS. The browser shows these on the Device health page;
// when Cortex runs as a bare file (no backend) this endpoint isn't reachable, so the page shows
// "unavailable" instead of inventing numbers.
function readCpuTempC() {
  // x86 mini-PCs expose temp under /sys/class/hwmon/*/temp*_input or thermal_zone*/temp (milli°C).
  const tries = [];
  try { for (const z of fs.readdirSync('/sys/class/thermal')) if (z.startsWith('thermal_zone')) tries.push('/sys/class/thermal/' + z + '/temp'); } catch (_) {}
  try { for (const h of fs.readdirSync('/sys/class/hwmon')) { const d = '/sys/class/hwmon/' + h; for (const f of fs.readdirSync(d)) if (/^temp\d+_input$/.test(f)) tries.push(d + '/' + f); } } catch (_) {}
  for (const p of tries) { try { const v = parseInt(fs.readFileSync(p, 'utf8').trim(), 10); if (isFinite(v) && v > 0) return Math.round(v / 1000); } catch (_) {} }
  return null;
}
function osPretty() {
  try { const m = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="?([^"\n]+)/); if (m) return m[1]; } catch (_) {}
  return os.type() + ' ' + os.release();
}
function diskPct() {
  return new Promise((resolve) => {
    execFile('df', ['-kP', DIR], { timeout: 2500 }, (err, out) => {
      if (err) return resolve(null);
      try { const l = out.trim().split('\n'); const c = l[l.length - 1].split(/\s+/); const pct = parseInt(c[4], 10); resolve(isFinite(pct) ? pct : null); }
      catch (_) { resolve(null); }
    });
  });
}
// This box's own addresses on the building network (never Tailscale's, never public ones).
function lanAddrs() {
  const out = [];
  try { for (const [name, list] of Object.entries(os.networkInterfaces())) { if (/^(tailscale|docker|veth|br-|virbr|lo)/.test(name)) continue;
      for (const a of list || []) { if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue; const p = a.address.split('.').map(Number);
        if (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)) out.push(a.address); } } } catch (_) {}
  return out.slice(0, 4);
}
// A random name for this one controller, made once. It lets the Windows app be sure that the box answering at the
// local address and the box answering at the secure address are the same controller before it switches between them.
let _cid = null;
function controllerId() {
  if (_cid) return _cid; const f = path.join(DATA, 'controller-id');
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{16}$/.test(v)) return (_cid = v); } catch (_) {}
  _cid = crypto.randomBytes(8).toString('hex'); try { fs.writeFileSync(f, _cid + '\n'); } catch (_) {}
  return _cid;
}
function tailscaleIp() {
  try { const t = os.networkInterfaces().tailscale0 || []; const a = t.find(x => x.family === 'IPv4' || x.family === 4); return a ? a.address : null; }
  catch (_) { return null; }
}
function lastUpdateLine() {
  try { const l = fs.readFileSync(path.join(DATA, 'update.log'), 'utf8').trim().split('\n'); return l[l.length - 1] || null; }
  catch (_) { return null; }
}
app.get('/api/device', async (_req, res) => {
  cors(res);
  const cpus = os.cpus() || [];
  const load1 = os.loadavg()[0];
  const cpuPct = cpus.length ? Math.min(100, Math.round((load1 / cpus.length) * 100)) : null;
  const memPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  const up = os.uptime();
  const upStr = up >= 86400 ? Math.floor(up / 86400) + 'd ' + Math.floor((up % 86400) / 3600) + 'h'
              : up >= 3600  ? Math.floor(up / 3600) + 'h ' + Math.floor((up % 3600) / 60) + 'm'
              : Math.floor(up / 60) + 'm';
  let disk = null; try { disk = await diskPct(); } catch (_) {}
  const serialNow = resolveSerial();
  const serialPresent = (() => { try { return fs.existsSync(serialNow); } catch (_) { return false; } })();
  res.json({
    live: true,
    host: os.hostname(),
    os: osPretty(),
    uptime: upStr,
    cpu: cpuPct,
    temp: readCpuTempC(),           // null when the platform exposes no sensor
    mem: memPct,
    disk: disk,                     // null if df failed
    cores: cpus.length,
    serial: serialNow,
    serialPresent,                  // does the adapter device exist right now?
    tailscale: tailscaleIp(),       // this box's Tailscale address, or null when Tailscale isn't up
    masterAlive: masterAlive(),     // is a dashboard currently polling the equipment?
    lastUpdate: lastUpdateLine(),   // newest line of the updater's log
    busActive: busRx.active,
    busBytes: busRx.bytes,
    busLastMs: busRx.last ? (Date.now() - busRx.last) : null,
    version: readVersion(),
    port: PORT,
    https: httpsState,              // { enabled, active, port, error, cert:{ subject, validTo, selfSigned } }
  });
});

// --- setup wizard API ---------------------------------------------------------
// List serial adapters the OS can see, so the wizard offers a dropdown.
app.get('/api/serial-ports', async (_req, res) => {
  cors(res);
  try {
    // the stable names first (they survive a replug, and say which channel of a multi-channel adapter), then anything else the OS lists
    const stable = ADAPTERS.list(), have = new Set(stable.map(a => a.dev)), ports = await SerialPort.list().catch(() => []);
    res.json({ ports: stable.map(a => ({ path: a.path, label: a.label, manufacturer: '', serialNumber: '', channel: a.channel, channels: a.channels }))
      .concat(ports.filter(p => !have.has(p.path)).map(p => ({ path: p.path, manufacturer: p.manufacturer || '', serialNumber: p.serialNumber || '' }))) });
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
// Full semver-ish compare incl. pre-release suffix. Returns + if a>b, - if a<b, 0 if equal.
// A version with NO suffix (stable) outranks the same x.y.z WITH a suffix (1.4.4 > 1.4.4-beta.1).
function verParts(v){ const m=String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/); return m?[+m[1],+m[2],+m[3],m[4]||'~']:[0,0,0,'~']; }
// Compare the pre-release suffix dot-part by dot-part, numeric parts numerically so beta.10 > beta.9
// (a plain string compare put beta.9 above beta.10). '~' is the no-suffix sentinel: stable outranks any pre-release.
function cmpSuffix(a,b){ if(a===b) return 0; if(a==='~') return 1; if(b==='~') return -1;
  const pa=a.split('.'), pb=b.split('.');
  for(let i=0;i<Math.max(pa.length,pb.length);i++){ const x=pa[i], y=pb[i];
    if(x===undefined) return -1; if(y===undefined) return 1;      // shorter pre-release precedes (semver)
    const nx=/^\d+$/.test(x), ny=/^\d+$/.test(y);
    if(nx&&ny){ if(+x!==+y) return +x<+y?-1:1; } else if(x!==y) return x<y?-1:1; }
  return 0; }
function cmpVer(a,b){ const x=verParts(a),y=verParts(b);
  for(let i=0;i<3;i++){ if(x[i]!==y[i]) return x[i]-y[i]; }
  return cmpSuffix(x[3],y[3]); }
function isNewer(cur, next){ return cmpVer(next, cur) > 0; }

// --- update channel: 'stable' (default) or 'beta' (also accepts pre-releases) --
// A plain file the root updater also reads, so the browser toggle and the OTA script agree.
const CHANFILE = path.join(DATA, 'update-channel');
function readChannel(){ try { return (fs.readFileSync(CHANFILE,'utf8').trim().toLowerCase()==='beta') ? 'beta' : 'stable'; } catch(_){ return 'stable'; } }
app.get('/api/update-channel', (_req, res) => { cors(res); res.json({ channel: readChannel() }); });
app.post('/api/update-channel', (req, res) => { cors(res);
  const ch = (req.body && String(req.body.channel||'').toLowerCase() === 'beta') ? 'beta' : 'stable';
  try { fs.writeFileSync(CHANFILE, ch + '\n'); updCache = null; res.json({ ok: true, channel: ch }); }
  catch (e) { res.status(500).json({ err: e.message }); }
});
// GitHub allows only 60 anonymous API calls an hour per address, and a slow or blocked connection
// must never hang this request — so every lookup has a timeout and the answer is reused for 5 minutes
// (the "Check for updates" button passes ?fresh=1 to skip the cache).
const UPD_TTL = 5 * 60 * 1000;
let updCache = null;                                     // { key, at, body }
const ghFetch = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
app.get('/api/update/check', async (req, res) => {
  cors(res);
  const current = readVersion();
  const conf = readUpdateConf();
  const headers = { 'User-Agent': 'cortex-appliance' };
  if (conf.CORTEX_UPDATE_TOKEN) headers.Authorization = 'Bearer ' + conf.CORTEX_UPDATE_TOKEN;
  const channel = readChannel();
  const key = current + '|' + channel + '|' + (conf.CORTEX_UPDATE_REPO || conf.CORTEX_UPDATE_MANIFEST || '');
  if (!req.query.fresh && updCache && updCache.key === key && Date.now() - updCache.at < UPD_TTL) return res.json(updCache.body);
  try {
    let latest = '', notes = '', prerelease = false;
    if (conf.CORTEX_UPDATE_REPO) {
      // GitHub API mode — same path the updater uses (works with private repos + fine-grained tokens)
      const base = `https://api.github.com/repos/${conf.CORTEX_UPDATE_REPO}`;
      if (channel === 'beta') {
        // beta channel: consider ALL non-draft releases (pre-releases included), newest wins
        const r = await ghFetch(`${base}/releases?per_page=30`, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
        if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
        const list = (await r.json()).filter(x => x && !x.draft)
          .sort((a, b) => cmpVer((b.tag_name||'').replace(/^v/,''), (a.tag_name||'').replace(/^v/,'')));
        const top = list[0];
        latest = ((top && top.tag_name) || '').replace(/^v/, ''); notes = (top && (top.body || top.name)) || ''; prerelease = !!(top && top.prerelease);
      } else {
        // stable channel: GitHub's "latest" excludes pre-releases automatically
        const r = await ghFetch(`${base}/releases/latest`, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
        if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
        const j = await r.json(); latest = (j.tag_name || '').replace(/^v/, ''); notes = j.body || j.name || '';
      }
    } else if (conf.CORTEX_UPDATE_MANIFEST) {
      const r = await ghFetch(conf.CORTEX_UPDATE_MANIFEST, { headers, redirect: 'follow' });
      if (!r.ok) throw new Error('manifest HTTP ' + r.status);
      const m = await r.json();
      latest = m.version || ''; notes = m.notes || '';
    } else {
      return res.json({ current, channel, configured: false, updateAvailable: false });
    }
    // Revert-to-stable: when the box is on the stable channel but running a pre-release that is
    // AHEAD of the latest stable (e.g. left the beta channel after testing a beta), offer to move
    // back to that stable build. Suppressed once the user has chosen to keep the beta (dismissal
    // records the version they kept); a genuinely newer stable still notifies via updateAvailable.
    let revertStable = null;
    if (channel === 'stable' && latest && /-/.test(current) && cmpVer(latest, current) < 0) {
      let dismissed = ''; try { dismissed = fs.readFileSync(path.join(DATA,'revert-dismissed'),'utf8').trim(); } catch(_){}
      if (dismissed !== current) revertStable = latest;
    }
    const body = { current, latest, channel, prerelease, configured: true, updateAvailable: isNewer(current, latest),
                   revertStable, notes, checkedAt: new Date().toISOString() };
    updCache = { key, at: Date.now(), body };
    res.json(body);
  } catch (e) {
    const msg = (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) ? 'the update server did not answer in time (no internet?)' : e.message;
    res.json({ current, channel, configured: true, updateAvailable: false, error: msg });
  }
});

// --- shared app config (site identity + user accounts) ------------------------
// Stored on the appliance so EVERY browser/computer sees the same setup + logins:
// first visit runs the wizard once; everyone after gets the login screen.
const APPCFG = path.join(DATA, 'appconfig.json');
// Every save carries the revision (_rev) the browser started from. If another screen saved in the
// meantime the numbers differ and we answer 409 with the current config instead of letting a stale
// screen silently wipe the newer changes (a user someone just added, a schedule, a floor plan).
// A body with no _rev (first-time setup, restore from backup, factory reset) is always accepted.
app.get('/api/appconfig', (_req, res) => {
  cors(res);
  res.set('Cache-Control', 'no-store');
  res.json(readJsonSafe(APPCFG) || {});
});
app.post('/api/appconfig', (req, res) => {
  cors(res);
  const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  try {
    const cur = readJsonSafe(APPCFG) || {};
    const curRev = Number(cur._rev) || 0;
    if (cur.provisioned && typeof b._rev === 'number' && b._rev !== curRev) {
      return res.status(409).json({ conflict: true, config: cur });
    }
    // A set-up controller is never replaced by an empty / half-formed document by accident (a bad
    // request, a bug, a stray tool). Wiping it takes the explicit factory-reset flag; the previous
    // config stays on disk as appconfig.json.bak either way.
    if (cur.provisioned && !b.provisioned) {
      if (b._reset !== true) return res.status(400).json({ err: 'refusing to replace a configured site with an empty config' });
      writeFileAtomic(APPCFG, JSON.stringify({ _rev: curRev + 1 }, null, 2));
      return res.json({ ok: true, reset: true, _rev: curRev + 1 });
    }
    delete b._reset;
    b._rev = curRev + 1;
    writeFileAtomic(APPCFG, JSON.stringify(b, null, 2));
    res.json({ ok: true, _rev: b._rev });
  } catch (e) { res.status(500).json({ err: e.message }); }
});

// --- shared unit list + command relay ------------------------------------------
// The unit list used to live only in the browser that ran the bus scan, so a second computer or a
// phone opened an empty dashboard. Now the list (and each unit's last known state) is kept here:
//   * the dashboard that is connected to the equipment ("the master screen") pushes fresh readings;
//   * every other screen reads them, and sends its commands to /api/cmd, which the master screen
//     picks up on its next pass and puts on the bus.
// Same revision rule as the config above, so two screens can't silently overwrite each other.
const UNITSF = path.join(DATA, 'units.json');
let unitsDoc = (() => { const d = readJsonSafe(UNITSF); return (d && Array.isArray(d.units)) ? d : { rev: 0, ts: 0, units: [] }; })();
let unitsDirty = false, unitsFlushT = null, masterAt = 0;
function masterAlive() { return Date.now() - masterAt < 30000 || (typeof busMaster !== 'undefined' && busMaster && busMaster.alive()) || [...lgLines.values()].some(L => L.master && L.master.alive()); }
function flushUnits() {
  if (unitsFlushT) { clearTimeout(unitsFlushT); unitsFlushT = null; }
  if (!unitsDirty) return;
  unitsDirty = false;
  try { writeFileAtomic(UNITSF, JSON.stringify(unitsDoc)); } catch (e) { console.error('units save failed:', e.message); }
}
app.get('/api/units', (_req, res) => {
  cors(res);
  res.set('Cache-Control', 'no-store');
  res.json({ rev: unitsDoc.rev, ts: unitsDoc.ts, units: unitsDoc.units, masterAlive: masterAlive(), pending: cmdQueue.length, sched: true, bus: busInfo() });
});
app.put('/api/units', express.json({ limit: '2mb' }), (req, res) => {
  cors(res);
  const b = req.body || {};
  if (!Array.isArray(b.units) || b.units.length > 512) return res.status(400).json({ err: 'units must be a list' });
  // A screen that is polling line 1 itself sends its readings every pass. With more LG lines the controller is
  // updating the other lines' units at the same moment, so that screen's copy of THOSE is always a little old:
  // take its line-1 units, keep the controller's own record of every unit on another line.
  const far = (b.live && b.master && lgLines.size) ? new Map(unitsDoc.units.filter(u => u && u.bus && lgLines.has(u.bus)).map(u => [u.addr, u])) : null;
  // A person's edit (a rename, a regroup) made while the controller is polling: the list has moved on since their
  // screen last read it, but only by readings. Keep their edit and lay the controller's newer readings over it,
  // instead of refusing it. Only a real clash, where somebody else changed the list itself, is still refused.
  let merged = null;
  if (!far && typeof b.base === 'number' && b.base !== unitsDoc.rev) {
    if (b.live || b.base < structRev) return res.status(409).json({ conflict: true, rev: unitsDoc.rev, ts: unitsDoc.ts, units: unitsDoc.units });
    const cur = new Map(unitsDoc.units.map(u => [u && u.addr, u]));
    merged = b.units.map(u => { const s0 = u && cur.get(u.addr); if (!s0) return u; const n = Object.assign({}, u); for (const k of liveKeys) if (k in s0) n[k] = s0[k]; return n; });
  }
  if (b.master) masterAt = Date.now();
  unitsDoc = { rev: unitsDoc.rev + 1, ts: Date.now(), units: merged || (far ? b.units.map(u => (u && far.get(u.addr)) || u) : b.units) };
  if (!b.live) structRev = unitsDoc.rev;
  if (b.master) { histSample(); recorder.sample(unitsDoc.units); }
  unitsDirty = true;
  // Live readings arrive every few seconds; don't hammer the disk with them. Layout changes
  // (add / remove / regroup) are written straight away.
  if (b.live) { if (!unitsFlushT) unitsFlushT = setTimeout(flushUnits, 15000); }
  else flushUnits();
  res.json({ ok: true, rev: unitsDoc.rev });
});
// --- trend history ---------------------------------------------------------------
// A real log, replacing the old made-up sample charts: every 5 minutes, while a screen is polling the
// equipment, one line is appended to <DATA>/history/<UTC date>.ndjson with each unit's room temp,
// setpoint, on/off and error code. About 35 days are kept. Appending one short line is cheap and
// can't corrupt earlier data.
const HISTDIR = path.join(DATA, 'history');
const HIST_EVERY = 5 * 60 * 1000, HIST_KEEP_DAYS = 35;
let histLast = 0, histPruned = 0;
const histFile = (t) => path.join(HISTDIR, new Date(t).toISOString().slice(0, 10) + '.ndjson');
function histSample() {
  const now = Date.now();
  if (now - histLast < HIST_EVERY) return;
  const s = {};
  for (const u of unitsDoc.units) {
    if (!u || typeof u.addr !== 'number' || u.offline || !u.seen || now - u.seen > 120000) continue;   // only units that answered recently
    const set = (u.mode === 'heat' ? u.heatC : u.coolC);
    s[u.addr] = [u.room == null ? null : u.room, typeof set === 'number' ? set : null, u.on ? 1 : 0,
                 u.err && u.code ? String(u.code) : 0, u.pipeIn == null ? null : u.pipeIn, u.pipeOut == null ? null : u.pipeOut, u.eev == null ? null : u.eev];
  }
  if (!Object.keys(s).length) return;
  histLast = now;
  try {
    fs.mkdirSync(HISTDIR, { recursive: true });
    fs.appendFileSync(histFile(now), JSON.stringify({ t: now, s }) + '\n');
    if (now - histPruned > 6 * 3600 * 1000) {            // drop day-files older than the keep window
      histPruned = now;
      const cutoff = new Date(now - HIST_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
      for (const f of fs.readdirSync(HISTDIR)) if (/^\d{4}-\d\d-\d\d\.ndjson$/.test(f) && f.slice(0, 10) < cutoff) { try { fs.unlinkSync(path.join(HISTDIR, f)); } catch (_) {} }
    }
  } catch (e) { console.error('history append failed:', e.message); }
}
// GET /api/history?addrs=16,17&days=7  ->  { series: { "16": [[t, roomF, setC, on, err, pipeIn, pipeOut], ...] } }
app.get('/api/history', (req, res) => {
  cors(res);
  res.set('Cache-Control', 'no-store');
  const want = new Set(String(req.query.addrs || '').split(',').map(x => parseInt(x, 10)).filter(x => Number.isInteger(x) && x >= 0 && x <= 0xFE).slice(0, 32));
  const days = Math.max(1, Math.min(31, parseInt(req.query.days, 10) || 1));
  const now = Date.now(), from = now - days * 86400000, series = {};
  for (const a of want) series[a] = [];
  if (want.size) {
    for (let d = days + 1; d >= 0; d--) {
      let txt; try { txt = fs.readFileSync(histFile(now - d * 86400000), 'utf8'); } catch (_) { continue; }
      for (const line of txt.split('\n')) {
        if (!line) continue;
        let o; try { o = JSON.parse(line); } catch (_) { continue; }   // a torn last line is skipped, not fatal
        if (!o || o.t < from || !o.s) continue;
        for (const a of want) { const v = o.s[a]; if (v) series[a].push([o.t].concat(v)); }
      }
    }
  }
  res.json({ from, to: now, every: HIST_EVERY, series });
});

// Commands from screens that are not connected to the equipment. Short-lived by design: a command
// nobody picked up within a minute is dropped rather than firing unexpectedly much later.
let cmdQueue = [], cmdSeq = 0;
// Which LG line a unit is on (0 = the first line), and the queued commands for one line.
const lineOfAddr = (addr) => { const u = unitsDoc.units.find(x => x && x.addr === addr); return u && u.bus && lgLines.has(u.bus) ? u.bus : 0; };
function drainFor(line) { const now = Date.now(), keep = [], out = []; for (const c of cmdQueue) { if (now - c.ts >= CMD_TTL) continue; (lineOfAddr(c.addr) === line ? out : keep).push(c); } cmdQueue = keep; return out; }
const CMD_TTL = 60000;
app.post('/api/cmd', (req, res) => {
  cors(res);
  const b = req.body || {};
  const addr = Number(b.addr);
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xFE || !b.state || typeof b.state !== 'object') return res.status(400).json({ err: 'need addr (0-254) and state' });
  const st = b.state, out = {};
  if (typeof st.on === 'boolean') out.on = st.on;
  if (['cool', 'heat', 'auto', 'dry', 'fan'].includes(st.mode)) out.mode = st.mode;
  if (['low', 'med', 'high', 'auto'].includes(st.fan)) out.fan = st.fan;
  for (const k of ['coolC', 'heatC']) if (typeof st[k] === 'number' && isFinite(st[k]) && st[k] >= 10 && st[k] <= 35) out[k] = st[k];
  for (const k of ['swing', 'twoset', 'modeLock', 'fanLock', 'tempLock', 'hardLock', 'rangeLock']) if (typeof st[k] === 'boolean') out[k] = st[k];
  if (st.filterReset === true) out.filterReset = true;                // one-shot filter-sign reset (cmd0 byte 5 bit 7)
  // cmd4 setpoint-limit band bytes (b5 = 0x80|(lower-15), b6 = upper-15) set in a unit's Locks section
  if (Number.isInteger(st.c4b5) && st.c4b5 >= 0x80 && st.c4b5 <= 0x8F) out.c4b5 = st.c4b5;
  if (Number.isInteger(st.c4b6) && st.c4b6 >= 0 && st.c4b6 <= 0x0F) out.c4b6 = st.c4b6;
  cmdQueue = cmdQueue.filter(c => Date.now() - c.ts < CMD_TTL && c.addr !== addr);    // newest command per unit wins
  cmdQueue.push({ id: ++cmdSeq, ts: Date.now(), addr, state: out });
  res.json({ ok: true, queued: cmdQueue.length, masterAlive: masterAlive() });
});
app.post('/api/cmd/drain', (_req, res) => {            // called by the master screen on every pass
  cors(res);
  masterAt = Date.now();
  res.json({ cmds: drainFor(0) });                    // a screen only ever drives the first LG line; the other lines' commands wait for their own loops
});

// --- shared Cortex Command data (Command ▸ Settings ▸ Sync). See commandstore.js. ---
// Reading is open like the rest of the read API; saving goes through the same-origin rule above, so only
// Command opened from this controller, or the Command Windows app, can change it.
const { createCommandStore } = require('./commandstore');
const commandStore = createCommandStore({ file: path.join(DATA, 'command-data.json') });
app.get('/api/command-data', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json(commandStore.get()); });
app.put('/api/command-data', (req, res) => { cors(res); const r = commandStore.put(req.body); res.status(r.status).json(r.body); });

// --- occupant view: a one-room page for the people in the room. Off unless an admin turns it on. ---
// All rules live in occupant.js (limits, which units, rate limit). An accepted change joins the same
// short-lived queue as a command from any Cortex screen, so nothing here talks to the bus directly.
const { createOccupant } = require('./occupant');
const occupant = createOccupant({ getCfg: () => readJsonSafe(APPCFG), getUnits: () => unitsDoc.units, ready: () => masterAlive(),
  queue: (addr, state) => { cmdQueue = cmdQueue.filter(c => Date.now() - c.ts < CMD_TTL && c.addr !== addr); cmdQueue.push({ id: ++cmdSeq, ts: Date.now(), addr, state }); } });
app.get('/api/room/:key', (req, res) => { res.set('Cache-Control', 'no-store'); const r = occupant.state(req.params.key); res.status(r.status).json(r.body); });
app.post('/api/room/:key', (req, res) => { res.set('Cache-Control', 'no-store'); const r = occupant.command(req.params.key, req.body); res.status(r.status).json(r.body); });

// --- floor-plan images (building map) -------------------------------------------
// The picture for a map group is far too big for appconfig.json, so each one is a file under
// <DATA>/floorplans/<id>.<ext>. Positions of the units stay in the shared app config. The browser
// downscales before uploading; we still cap the size, accept raster image types only (no SVG —
// it can carry script), check the file's magic bytes, and only ever use a sanitized id as the name.
const FPDIR = path.join(DATA, 'floorplans');
const FP_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FP_MIME  = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const fpId = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(s)) ? s : null;
function fpFind(id) {
  for (const ext of Object.keys(FP_MIME)) { const p = path.join(FPDIR, id + '.' + ext); if (fs.existsSync(p)) return { p, ext }; }
  return null;
}
function fpSniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
app.put('/api/floorplan/:id', express.raw({ type: Object.keys(FP_TYPES), limit: '6mb' }), (req, res) => {
  cors(res);
  const id = fpId(req.params.id);
  if (!id) return res.status(400).json({ err: 'bad id' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ err: 'send a JPEG, PNG or WebP image' });
  const ext = fpSniff(req.body);
  if (!ext) return res.status(415).json({ err: 'not a JPEG, PNG or WebP image' });
  try {
    fs.mkdirSync(FPDIR, { recursive: true });
    const old = fpFind(id);
    const dest = path.join(FPDIR, id + '.' + ext);
    fs.writeFileSync(dest + '.tmp', req.body);
    fs.renameSync(dest + '.tmp', dest);
    if (old && old.p !== dest) { try { fs.unlinkSync(old.p); } catch (_) {} }
    res.json({ ok: true, id, bytes: req.body.length, type: FP_MIME[ext] });
  } catch (e) { res.status(500).json({ err: e.message }); }
});
app.get('/api/floorplan/:id', (req, res) => {
  cors(res);
  const id = fpId(req.params.id);
  const f = id && fpFind(id);
  if (!f) return res.status(404).json({ err: 'not found' });
  res.set('Content-Type', FP_MIME[f.ext]);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');   // the browser adds ?v=<stamp> when it changes
  fs.createReadStream(f.p).on('error', () => res.status(500).end()).pipe(res);
});
app.delete('/api/floorplan/:id', (req, res) => {
  cors(res);
  const id = fpId(req.params.id);
  if (!id) return res.status(400).json({ err: 'bad id' });
  const f = fpFind(id);
  if (f) { try { fs.unlinkSync(f.p); } catch (e) { return res.status(500).json({ err: e.message }); } }
  res.json({ ok: true, removed: !!f });
});

// --- power control ------------------------------------------------------------
// Reboot / shut down the appliance from the UI (owner/admin only — the UI gates this).
// Needs root, so it shells out via sudo; install.sh + the updater drop a scoped sudoers
// rule (/etc/sudoers.d/cortex) allowing exactly `systemctl reboot` / `systemctl poweroff`.
function powerAction(kind, res) {
  cors(res);
  const arg = kind === 'reboot' ? 'reboot' : 'poweroff';
  // respond first so the browser gets an ack before the box goes down
  res.json({ ok: true, action: arg });
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', arg], (err) => {
      if (err) console.error('power ' + arg + ' failed:', err.message);
    });
  }, 500);
}
/* --- remote access (Tailscale) from the dashboard -------------------------------------------------
   Turning it on runs `tailscale up`. The first time, Tailscale answers with a sign-in link: the dashboard shows
   it (and a QR code), the owner opens it on any device and approves, and the controller joins their tailnet.
   Nobody needs a keyboard on the controller. The service user is made Tailscale's operator on the way, so
   later starts and stops need no sudo. */
const { spawn: spawnProc } = require('child_process'), cryptoMod = require('crypto');
const run = (cmd, args, ms) => new Promise((resolve) => { execFile(cmd, args, { timeout: ms || 6000, maxBuffer: 1 << 20 }, (err, out, er) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(out || ''), err: String(er || (err && err.message) || '') })); });
const remote = { job: null, url: null, error: null, at: 0, wasUp: false };
async function remoteState() {
  const st = await run('tailscale', ['status', '--json'], 5000); let j = null; try { j = JSON.parse(st.out); } catch (_) {}
  if (!j) return { installed: !/ENOENT|not found/i.test(st.err), state: 'unknown', error: /ENOENT|not found/i.test(st.err) ? null : (st.err.trim().split('\n')[0] || null) };
  const self = j.Self || {}, state = j.BackendState || 'unknown', up = state === 'Running';
  if (up && !remote.wasUp) { remote.wasUp = true; remote.url = null; remote.error = null; execFile('sudo', ['-n', 'systemctl', 'start', 'cortex-updater.service'], () => {}); }   // fetch the https certificate now, not in half an hour
  if (!up) remote.wasUp = false;
  return { installed: true, state, up, authUrl: (!up && (j.AuthURL || remote.url)) || null, name: String(self.DNSName || '').replace(/\.$/, '') || null, ip: (self.TailscaleIPs || [])[0] || null,
    starting: !!remote.job, error: up ? null : remote.error, tailnet: (j.CurrentTailnet && j.CurrentTailnet.Name) || null }; }
function remoteUp() { if (remote.job) return; remote.error = null; remote.url = null; remote.at = Date.now();
  const start = (viaSudo) => { const args = ['up', '--operator=cortex'], p = viaSudo ? spawnProc('sudo', ['-n', '/usr/bin/tailscale'].concat(args)) : spawnProc('tailscale', args); let buf = '';
    remote.job = p; const eat = (d) => { buf += String(d); const m = /https:\/\/login\.tailscale\.com\/[^\s]+/.exec(buf); if (m) remote.url = m[0]; };
    p.stdout.on('data', eat); p.stderr.on('data', eat);
    p.on('error', (e) => { if (remote.job === p) { remote.job = null; remote.error = e.message; } });
    p.on('exit', (code) => { if (remote.job !== p) return; remote.job = null;
      if (code && !viaSudo && /access denied|must be root|permission denied|operator/i.test(buf)) return start(true);                    // not the operator yet: once, through the scoped sudo rule
      if (code) remote.error = /a password is required|not allowed|sudo:/i.test(buf) ? 'this controller has not been updated to allow that yet. Run the updater once, or run “sudo tailscale up” on the controller' : (buf.trim().split('\n').pop() || ('tailscale up ended with code ' + code)); });
    setTimeout(() => { if (remote.job === p) { try { p.kill(); } catch (_) {} } }, 15 * 60000); };
  start(false); }
app.get('/api/remote', async (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json(await remoteState()); });
app.post('/api/remote', async (req, res) => { cors(res); const b = req.body || {};
  if (b.on === true) { const st = await remoteState(); if (!st.installed) return res.status(409).json({ err: 'Tailscale is not installed on this controller' }); if (!st.up) remoteUp(); await new Promise(r => setTimeout(r, 2500)); return res.json(await remoteState()); }
  if (b.on === false) { if (remote.job) { try { remote.job.kill(); } catch (_) {} remote.job = null; } let r = await run('tailscale', ['down'], 8000); if (r.code) r = await run('sudo', ['-n', '/usr/bin/tailscale', 'down'], 8000);
    if (r.code) return res.status(500).json({ err: (r.err || r.out).trim().split('\n').pop() || 'could not stop Tailscale' }); return res.json(await remoteState()); }
  res.status(400).json({ err: 'need on: true or false' }); });

/* --- the controller's own console ------------------------------------------------------------------
   A way to run commands on the controller from the dashboard, for the rare job that needs it. Everything else in
   Cortex trusts whoever can reach it; this does not. It has its own password, kept here on the controller (scrypt),
   never in the shared settings, so the dashboard's open settings API cannot be used to get in. Whoever sets the
   password first owns it; changing it needs the old one. Five wrong tries lock it for five minutes. Commands run as
   the unprivileged service user, one at a time, with a time limit, and every command is written to the log. */
const CONF = path.join(DATA, 'console.json'), cons = { tokens: new Map(), fails: 0, lockedUntil: 0, cwd: os.homedir && fs.existsSync(DATA) ? DATA : '/' };
const consDoc = () => readJsonSafe(CONF) || null;
const consHash = (pw, salt) => cryptoMod.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32).toString('hex');
const consCheck = (pw) => { const d = consDoc(); if (!d || !d.hash) return false; const a = Buffer.from(consHash(pw, d.salt), 'hex'), b = Buffer.from(d.hash, 'hex'); return a.length === b.length && cryptoMod.timingSafeEqual(a, b); };
const consLocked = () => Date.now() < cons.lockedUntil;
const consFail = () => { if (++cons.fails >= 5) { cons.fails = 0; cons.lockedUntil = Date.now() + 5 * 60000; console.log('console: locked for 5 minutes after wrong passwords'); } };
const consTok = (t) => { const x = cons.tokens.get(String(t || '')); if (!x || Date.now() - x.last > 15 * 60000) { cons.tokens.delete(String(t || '')); return null; } x.last = Date.now(); return x; };
app.get('/api/console', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ set: !!(consDoc() || {}).hash, locked: consLocked(), user: (() => { try { return os.userInfo().username; } catch (_) { return ''; } })() }); });
app.post('/api/console/password', (req, res) => { cors(res); const b = req.body || {}, d = consDoc(), pw = String(b.password || '');
  if (consLocked()) return res.status(429).json({ err: 'too many wrong tries. Wait five minutes' });
  if (pw.length < 10) return res.status(400).json({ err: 'use at least 10 characters' });
  if (d && d.hash && !consCheck(b.old)) { consFail(); return res.status(403).json({ err: 'the current console password is wrong' }); }
  const salt = cryptoMod.randomBytes(16).toString('hex'); try { writeFileAtomic(CONF, JSON.stringify({ salt, hash: consHash(pw, salt), at: Date.now() })); fs.chmodSync(CONF, 0o600); } catch (e) { return res.status(500).json({ err: e.message }); }
  cons.tokens.clear(); console.log('console: password ' + (d && d.hash ? 'changed' : 'set')); res.json({ ok: true }); });
app.post('/api/console/open', (req, res) => { cors(res); if (consLocked()) return res.status(429).json({ err: 'too many wrong tries. Wait five minutes' });
  if (!consCheck((req.body || {}).password)) { consFail(); return res.status(403).json({ err: 'wrong console password' }); }
  cons.fails = 0; const t = cryptoMod.randomBytes(24).toString('hex'); cons.tokens.set(t, { last: Date.now() }); console.log('console: opened'); res.json({ ok: true, token: t, cwd: cons.cwd }); });
app.post('/api/console/run', (req, res) => { cors(res); const b = req.body || {}; if (!consTok(b.token)) return res.status(403).json({ err: 'the console session has ended. Enter the console password again' });
  const cmd = String(b.cmd || '').slice(0, 2000); if (!cmd.trim()) return res.json({ out: '', code: 0, cwd: cons.cwd }); if (cons.busy) return res.status(409).json({ err: 'a command is still running' });
  cons.busy = true; console.log('console: $ ' + cmd.replace(/\s+/g, ' ').slice(0, 300));
  const MARK = '__CORTEX_CWD__', p = spawnProc('bash', ['-c', cmd + '\nprintf "\\n' + MARK + '%s" "$PWD"'], { cwd: fs.existsSync(cons.cwd) ? cons.cwd : '/', env: Object.assign({}, process.env, { TERM: 'dumb', NO_COLOR: '1', LC_ALL: 'C.UTF-8' }) });
  let out = '', done = false; const eat = (d) => { if (out.length < 400000) out += String(d); }; p.stdout.on('data', eat); p.stderr.on('data', eat);
  const end = (code, note) => { if (done) return; done = true; cons.busy = false; clearTimeout(kill);
    const i = out.lastIndexOf(MARK); if (i >= 0) { const d = out.slice(i + MARK.length).trim(); if (d && fs.existsSync(d)) cons.cwd = d; out = out.slice(0, i).replace(/\n$/, ''); }
    res.json({ out: out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') + (note || ''), code, cwd: cons.cwd }); };
  const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} end(124, '\n[stopped: a command may run for two minutes at most]'); }, 120000);
  p.on('error', (e) => end(127, String(e.message))); p.on('exit', (code) => setTimeout(() => end(code == null ? 1 : code), 30)); });
app.post('/api/console/close', (req, res) => { cors(res); cons.tokens.delete(String((req.body || {}).token || '')); res.json({ ok: true }); });

app.post('/api/power/reboot',   (_req, res) => powerAction('reboot', res));
app.post('/api/power/shutdown', (_req, res) => powerAction('poweroff', res));

// Trigger an update now — runs the SEPARATE updater unit (its own cgroup) so it survives the
// service restart it performs. The updater does the usual verify + atomic swap + rollback.
app.post('/api/update/apply', (_req, res) => {
  cors(res);
  res.json({ ok: true, started: true });
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'start', 'cortex-updater.service'], (err) => {
      if (err) console.error('update apply failed:', err.message);
    });
  }, 300);
});
// Leave the beta channel and move back to the latest stable, even though it is "older" than the
// running pre-release. Switches the channel to stable and drops a one-shot flag the updater honors.
app.post('/api/update/revert', (_req, res) => {
  cors(res);
  try {
    fs.writeFileSync(CHANFILE, 'stable\n');
    fs.writeFileSync(path.join(DATA, 'revert-to-stable'), new Date().toISOString() + '\n');
    try { fs.unlinkSync(path.join(DATA, 'revert-dismissed')); } catch(_){}
    updCache = null;
  } catch (e) { return res.status(500).json({ err: e.message }); }
  res.json({ ok: true, started: true });
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'start', 'cortex-updater.service'], (err) => {
      if (err) console.error('update revert failed:', err.message);
    });
  }, 300);
});
// Keep the current beta build: stay on the stable channel (so no more beta notifications) but stop
// prompting to revert. Records the version kept; a newer STABLE than this still notifies normally.
app.post('/api/update/keep-beta', (_req, res) => {
  cors(res);
  try { fs.writeFileSync(path.join(DATA, 'revert-dismissed'), readVersion() + '\n'); updCache = null; res.json({ ok: true }); }
  catch (e) { res.status(500).json({ err: e.message }); }
});

// --- first-run redirect -------------------------------------------------------
// An unconfigured box sends you straight to the setup wizard; once named, '/' is the app.
const pwa = require('./pwa');
app.get('/manifest.webmanifest', (_req, res) => { res.type('application/manifest+json').json(pwa.manifest(readConfig().name)); });
app.get('/icon-256.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400').type('png').send(pwa.ICON_PNG); });
app.get('/', (_req, res, next) => {
  const app2 = readJsonSafe(APPCFG);
  if (!readConfig().configured && !(app2 && app2.provisioned) && fs.existsSync(path.join(DIR, 'setup.html'))) {
    return res.redirect('/setup.html');
  }
  next();
});

// The pages themselves: always revalidated (so an update shows up on the next load instead of the
// browser serving last week's copy from its cache) and sent gzip-compressed (the dashboard is one
// ~300 kB file; compressed it is about a quarter of that, which matters over a remote link).
const zlib = require('zlib');
const htmlCache = new Map();                             // file -> { mtimeMs, size, etag, raw, gz }
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let p = req.path === '/' ? '/cortex.html' : req.path;
  if (/^\/[A-Za-z0-9._-]+$/.test(p) && !/\.[A-Za-z0-9]+$/.test(p)) p += '.html';
  if (!/^\/[A-Za-z0-9._-]+\.html$/.test(p)) return next();
  const f = path.join(DIR, p.slice(1));
  let st; try { st = fs.statSync(f); } catch (_) { return next(); }
  let c = htmlCache.get(f);
  if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
    try { const raw = fs.readFileSync(f); c = { mtimeMs: st.mtimeMs, size: st.size, raw, gz: zlib.gzipSync(raw, { level: 9 }),
      etag: '"' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20) + '"' }; htmlCache.set(f, c); }
    catch (_) { return next(); }
  }
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': c.etag, 'Vary': 'Accept-Encoding',
            'X-Content-Type-Options': 'nosniff' });
  if (req.headers['if-none-match'] === c.etag) return res.status(304).end();
  const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (gz) res.set('Content-Encoding', 'gzip');
  if (req.method === 'HEAD') return res.end();
  res.end(gz ? c.gz : c.raw);
});

app.use(express.static(DIR, { index: 'cortex.html', extensions: ['html'] }));

const { createLink } = require('./buslink');
const server = http.createServer(app);

// The bus is a single physical port. The controller owns it (buslink.js) and shares it with every screen.
let busMaster = null;

// USB adapters don't always come back with the same name after a replug or reboot (ttyUSB0 can
// become ttyUSB1). If the configured device is gone and exactly ONE USB serial adapter is plugged
// in, use that one instead of failing until someone edits the config.
// A multi-channel adapter is several ports at once, each possibly a different bus: Cortex never guesses
// between them. Someone has to say which channel the LG bus is on (Bus scan ▸ Choose adapter).
const ADAPTERS = require('./adapters');
function resolveSerial() {
  const want = readConfig().serial;
  try { if (fs.existsSync(want)) return want; } catch (_) {}
  try { const ids = ADAPTERS.list(); if (ids.length === 1) return ids[0].dev; } catch (_) {}
  return want;
}

// --- the bus link: the controller owns the adapter; every screen shares it (buslink.js) ------
const LINKF = path.join(DATA, 'bus-link.json');
const busClients = new Set();
const link = createLink({
  open: (ser) => new Promise((resolve, reject) => { const dev = resolveSerial();
    const eco = typeof ecoSystems !== 'undefined' ? [...ecoSystems.values()].find(x => x.cfg.on && realDev(x.cfg.port) === realDev(dev)) : null;
    if (eco) return reject(new Error('that adapter belongs to the Rheem/Ruud system “' + eco.cfg.name + '”. Set the LG adapter in the controller settings'));
    const sp = new SerialPort({ path: dev, baudRate: ser.baud, parity: ser.parity, stopBits: ser.stop, dataBits: ser.data }, (err) => err ? reject(err) : resolve(sp)); }),
  // a site that was already polling before this version keeps its adapter connected
  load: () => readJsonSafe(LINKF) || { on: (() => { try { return fs.readFileSync(path.join(DATA, 'master-mode'), 'utf8').trim() === '1'; } catch (_) { return false; } })() },
  save: (o) => writeFileAtomic(LINKF, JSON.stringify(o)),
  onTx: (buf) => { if (trafficOn()) trafficPush(0, 'tx', buf); },
  onBytes: (buf) => { busRx.bytes += buf.length; busRx.last = Date.now(); if (trafficOn()) trafficRx(0, buf); for (const ws of busClients) { if (ws.readyState === 1) { try { ws.send(buf); } catch (_) {} } } },
  onChange: () => { busRx.active = !!link.state.port; if (typeof superviseBus === 'function') superviseBus(); busTell(); },
  log: (t) => console.log('buslink:', t),
});
/* What every screen and app is told about the bus. */
function busInfo() { const i = link.info(), poll = !!(busMaster && busMaster.state.active);
  return Object.assign(i, { master: masterMode(), polling: poll, alive: !!(busMaster && busMaster.alive()), holder: i.driver ? 'screen' : (poll ? 'controller' : null),
    pollError: (busMaster && busMaster.state.error) || null, bytes: busRx.bytes, lastMs: busRx.last ? Date.now() - busRx.last : null, units: unitsDoc.units.length, screens: busClients.size, adapter: busAdapter(), lines: [...lgLines.values()].map(lgInfo),
    line1: lgReady ? { units: unitsDoc.units.filter(u => u && !u.bus).length, scan: scanInfo(L0), found: foundList(L0), passMs: busMaster ? busMaster.state.passMs : 0 } : null, search: lgReady ? searchAllInfo() : null }); }
// which adapter the LG bus is set to use, in words
function busAdapter() { const dev = resolveSerial(), r = (() => { try { return fs.realpathSync(dev); } catch (_) { return dev; } })(), all = ADAPTERS.list(), a = all.find(x => x.dev === r);
  return { path: a ? a.path : dev, label: a ? a.label : dev, present: (() => { try { return fs.existsSync(dev); } catch (_) { return false; } })(), choices: all.length }; }
function busTell() { const i = busInfo(), poll = i.polling;
  for (const ws of busClients) { if (ws.readyState !== 1) continue;
    // "mine" only once the controller's own loop is really off the wire, so two masters never overlap
    try { ws.send(JSON.stringify({ bus: Object.assign({}, i, { mine: link.state.driver === ws && !poll, waiting: link.state.driver === ws && poll }) })); } catch (_) {} } }
// The same bridge is attached to the plain-http server and, when enabled, the https one (wss://).
function attachBus(srv) {
 const wss = new WebSocketServer({ server: srv, path: '/bus',
   verifyClient: (info) => sameOrigin(info.req) });          // only pages this appliance served may listen to or drive the bus
 // Heartbeat: a laptop that went to sleep or dropped off Wi-Fi never sends a close. Ping every 15 s and
 // drop any screen that didn't answer the previous ping; if it was using the bus tools, the wire is freed.
 const beat = setInterval(() => {
   for (const ws of wss.clients) {
     if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
     ws.isAlive = false; try { ws.ping(); } catch (_) {}
   }
 }, 15000);
 wss.on('close', () => clearInterval(beat));
 wss.on('connection', (ws) => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  busClients.add(ws); busTell();
  ws.on('message', (msg, isBinary) => {
    if (isBinary) { link.write(ws, msg); return; }            // bytes are accepted only from the one screen using the bus tools
    let m; try { m = JSON.parse(String(msg)); } catch (_) { return; }
    if (m && m.take) { const r = link.take(ws, m.force === true);
      if (!r.ok) { try { ws.send(JSON.stringify({ lease: false, err: r.err, inUse: !!r.inUse })); } catch (_) {} }
      else if (r.prev && r.prev.readyState === 1) { try { r.prev.send(JSON.stringify({ lease: false, taken: true })); } catch (_) {} } }
    else if (m && m.release) link.release(ws);
  });
  const bye = () => { if (!busClients.delete(ws)) return; link.release(ws); busTell(); };
  ws.on('close', bye); ws.on('error', bye);
 });
 return wss;
}
attachBus(server);

// --- schedules that run without a browser ------------------------------------------
// See scheduler.js. The dashboard tells us whether Cortex is the bus master on this site
// (POST /api/master-mode when the poll loop starts / is stopped by a person); only then may the
// appliance transmit on its own.
const scheduler = require('./scheduler');
const MASTERF = path.join(DATA, 'master-mode'), FIREDF = path.join(DATA, 'sched-fired.json');
const masterMode = () => { try { return fs.readFileSync(MASTERF, 'utf8').trim() === '1'; } catch (_) { return false; } };
app.get('/api/master-mode', (_req, res) => { cors(res); res.json({ on: masterMode() }); });
app.post('/api/master-mode', (req, res) => { cors(res);
  try { const on = !!(req.body && req.body.on); fs.writeFileSync(MASTERF, on ? '1\n' : '0\n');
    if (on && !link.state.on) link.setOn(true);                 // starting live polling implies connecting the adapter
    superviseBus(); busTell(); res.json({ ok: true, on: masterMode(), bus: busInfo() }); }
  catch (e) { res.status(500).json({ err: e.message }); } });
// The shared switch. Any technician's screen can flip it; every screen and app reads the same answer.
//   POST { on: true|false, serial?: { baud, parity, stop, data } }   connect / disconnect the adapter
//   POST { release: true }                                           take the wire back from a screen using the bus tools
app.get('/api/bus', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json(busInfo()); });
app.post('/api/bus', (req, res) => { cors(res); const b = req.body || {};
  try { if (b.release === true) { const d = link.state.driver; if (link.release() && d && d.readyState === 1) { try { d.send(JSON.stringify({ lease: false, taken: true })); } catch (_) {} } }
    if (typeof b.adapter === 'string') {                              // move the LG bus to another adapter, or another channel of the same one
      const a = ADAPTERS.list().find(x => x.path === b.adapter); if (!a) return res.status(400).json({ err: 'that adapter is not plugged into the controller' });
      const eco = [...ecoSystems.values()].find(x => realDev(x.cfg.port) === a.dev); if (eco) return res.status(400).json({ err: 'that adapter is used by the Rheem / Ruud system “' + eco.cfg.name + '”' });
      const oth = [...lgLines.values()].find(L => realDev(L.cfg.port) === a.dev); if (oth) return res.status(400).json({ err: 'that adapter is used by “' + oth.cfg.name + '”' });
      if (realDev(resolveSerial()) !== a.dev || readConfig().serial !== a.path) { const was = link.state.on; if (was) link.setOn(false); writeConfig({ serial: a.path }); console.log('buslink: LG bus adapter set to ' + a.label); if (was && typeof b.on !== 'boolean') link.setOn(true); } }
    if (typeof b.on === 'boolean') link.setOn(b.on, b.serial && typeof b.serial === 'object' ? b.serial : null);
    superviseBus(); busTell(); res.json(Object.assign({ ok: true }, busInfo())); }
  catch (e) { res.status(500).json({ err: e.message }); } });
// --- EcoNet (Rheem / Ruud): one adapter per system, alongside the LG bus (econet.js, econetlink.js) ---
const ECO = require('./econet'), { createSystem: createEcoSystem } = require('./econetlink');
const ECOF = path.join(DATA, 'econet.json'), ecoSystems = new Map(), ECO_MAX = 8;
const realDev = (p) => { try { return fs.realpathSync(p); } catch (_) { return String(p || ''); } };
const ecoSave = () => { try { writeFileAtomic(ECOF, JSON.stringify({ systems: [...ecoSystems.values()].map(x => x.cfg) })); } catch (e) { console.error('econet save failed:', e.message); } };
function ecoStart(cfg) {
  const sys = createEcoSystem(cfg, { log: (t) => console.log('econet:', t),
    open: (port, ser) => new Promise((resolve, reject) => {
      if (link.state.on && realDev(port) === realDev(resolveSerial())) return reject(new Error('that adapter is the one the LG bus is using'));
      { const oth = [...lgLines.values()].find(L => realDev(L.cfg.port) === realDev(port)); if (oth) return reject(new Error('that adapter is used by “' + oth.cfg.name + '”')); }
      const sp = new SerialPort({ path: port, baudRate: ser.baud, parity: ser.parity, stopBits: ser.stop, dataBits: ser.data }, (err) => err ? reject(err) : resolve(sp)); }) });
  ecoSystems.set(cfg.id, sys); sys.start(); return sys; }
function ecoClean(b, old) { b = b || {};
  const name = String(b.name == null ? (old ? old.name : '') : b.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60), kind = old ? old.kind : b.kind, port = String(b.port == null ? (old ? old.port : '') : b.port).trim();
  if (!name) return { err: 'give the system a name' }; if (!ECO.KINDS[kind]) return { err: 'pick the kind of equipment' };
  if ((!/^\/dev\/[A-Za-z0-9._\/:+@-]{1,200}$/.test(port) || port.includes('..')) && !ADAPTERS.list().some(a => a.path === port)) return { err: 'pick the adapter' };
  for (const x of ecoSystems.values()) if ((!old || x.cfg.id !== old.id) && realDev(x.cfg.port) === realDev(port)) return { err: 'that adapter is already used by “' + x.cfg.name + '”' };
  const tidy = (v, prev) => String(v == null ? (prev || '') : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  return { cfg: { id: old ? old.id : crypto.randomBytes(4).toString('hex'), name, kind, port, group: tidy(b.group, old && old.group), sub: tidy(b.sub, old && old.sub), on: typeof b.on === 'boolean' ? b.on : (old ? !!old.on : true), talk: typeof b.talk === 'boolean' ? b.talk : (old ? !!old.talk : false), src: ECO.ADDR.WIFI } }; }
(() => { const j = readJsonSafe(ECOF); for (const c of (j && Array.isArray(j.systems) ? j.systems : []).slice(0, ECO_MAX)) { try { if (c && ECO.KINDS[c.kind] && c.id) ecoStart(c); } catch (e) { console.error('econet: could not start', c && c.name, e.message); } } })();
app.get('/api/econet', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ systems: [...ecoSystems.values()].map(x => x.info()) }); });
app.get('/api/econet/catalog', (_req, res) => { cors(res); res.json({ kinds: ECO.KINDS }); });
// The USB serial adapters plugged into this controller, by their stable names, and who uses each.
app.get('/api/econet/ports', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); const out = [], lg = realDev(resolveSerial());
  try { for (const a of ADAPTERS.list()) { const used = [...ecoSystems.values()].find(x => realDev(x.cfg.port) === a.dev);
      const ll = [...lgLines.values()].find(L => realDev(L.cfg.port) === a.dev);
      out.push({ path: a.path, label: a.label, model: a.model, channel: a.channel, channels: a.channels, dev: a.dev, usedBy: used ? used.cfg.name : ll ? ll.cfg.name : (a.dev === lg && link.state.on ? 'the LG bus' : null), eco: !!used, lgLine: ll ? ll.cfg.id : 0, lg: a.dev === lg }); } } catch (_) {}
  res.json({ ports: out }); });
app.post('/api/econet/systems', (req, res) => { cors(res); const b = req.body || {}, old = b.id ? ecoSystems.get(String(b.id)) : null;
  if (b.id && !old) return res.status(404).json({ err: 'no such system' }); if (!old && ecoSystems.size >= ECO_MAX) return res.status(400).json({ err: 'at most ' + ECO_MAX + ' systems on one controller' });
  const c = ecoClean(b, old && old.cfg); if (c.err) return res.status(400).json({ err: c.err });
  if (old && (old.cfg.port !== c.cfg.port)) { old.stop(); ecoSystems.delete(old.cfg.id); ecoStart(c.cfg); }                 // a different adapter: start afresh
  else if (old) { old.cfg.name = c.cfg.name; old.cfg.group = c.cfg.group; old.cfg.sub = c.cfg.sub; old.setFlags({ on: c.cfg.on, talk: c.cfg.talk }); }
  else ecoStart(c.cfg);
  ecoSave(); res.json({ ok: true, system: ecoSystems.get(c.cfg.id).info() }); });
app.delete('/api/econet/systems/:id', (req, res) => { cors(res); const x = ecoSystems.get(req.params.id); if (!x) return res.status(404).json({ err: 'no such system' }); x.stop(); ecoSystems.delete(req.params.id); ecoSave(); try { recorder.external('econet', req.params.id, x.cfg.name, [], null); } catch (_) {} res.json({ ok: true }); });
app.post('/api/econet/systems/:id/write', async (req, res) => { cors(res); const x = ecoSystems.get(req.params.id); if (!x) return res.status(404).json({ err: 'no such system' });
  const b = req.body || {}; try { const r = await x.write(String(b.name || ''), b.value); res.status(r.ok ? 200 : 409).json(r); } catch (e) { res.status(500).json({ ok: false, err: e.message }); } });
app.post('/api/econet/systems/:id/read', async (req, res) => { cors(res); const x = ecoSystems.get(req.params.id); if (!x) return res.status(404).json({ err: 'no such system' });
  const b = req.body || {}; try { const r = await x.readOne(String(b.name || '').toUpperCase(), Number(b.at)); res.status(r.ok ? 200 : 409).json(r); } catch (e) { res.status(500).json({ ok: false, err: e.message }); } });
app.get('/api/econet/systems/:id/frames', (req, res) => { cors(res); res.set('Cache-Control', 'no-store'); const x = ecoSystems.get(req.params.id); if (!x) return res.status(404).json({ err: 'no such system' }); res.json({ frames: x.frames() }); });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Put a schedule's frames on the bus ourselves, through the shared adapter, when nothing is polling.
async function schedTransmit(frames) {
  if (!frames.length) return false;
  const by = new Map(); for (const f of frames) { const l = lineOfAddr(f[3]); if (!by.has(l)) by.set(l, []); by.get(l).push(f); }   // each frame goes out on the wire its unit is on
  let ok = true;
  for (const [l, fs] of by) { const L = l ? lgLines.get(l) : null, m = L ? L.master : busMaster, lk = L ? L.link : link;
    if (m && m.state.active) { ok = false; continue; }
    ok = (await lk.transmit(fs, wait)) && ok; }
  return ok;
}
let wxCache = { at: 0, key: '', temp: null };
async function schedOutdoor(cfg, unit) {
  const site = cfg.site || {};
  if (cfg.wxOverride != null && isFinite(cfg.wxOverride)) return +cfg.wxOverride;
  if (site.lat == null || site.lon == null) return null;
  const key = site.lat + ',' + site.lon + ',' + unit;
  if (wxCache.key === key && Date.now() - wxCache.at < 15 * 60000) return wxCache.temp;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lon}&current=temperature_2m&temperature_unit=${unit === 'C' ? 'celsius' : 'fahrenheit'}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json(), t = j && j.current && j.current.temperature_2m;
  wxCache = { at: Date.now(), key, temp: (typeof t === 'number') ? t : null };
  return wxCache.temp;
}
const schedRunner = scheduler.createRunner({
  getConfig: () => readJsonSafe(APPCFG) || {},
  getUnits: () => unitsDoc.units,
  masterAlive, masterMode,
  queue: (addr, state) => { cmdQueue = cmdQueue.filter(c => Date.now() - c.ts < CMD_TTL && c.addr !== addr); cmdQueue.push({ id: ++cmdSeq, ts: Date.now(), addr, state }); },
  transmit: schedTransmit,
  commitUnits: (changed) => {
    const by = new Map(changed.map(u => [u.id, u]));
    unitsDoc = { rev: unitsDoc.rev + 1, ts: Date.now(), units: unitsDoc.units.map(u => by.has(u.id) ? by.get(u.id) : u) };
    unitsDirty = true; flushUnits();
  },
  getOutdoor: schedOutdoor,
  disableSchedule: (id) => { try { const c = readJsonSafe(APPCFG) || {}; const s0 = (c.schedules || []).find(x => x.id === id); if (!s0) return;
    s0.enabled = false; c._rev = (Number(c._rev) || 0) + 1; writeFileAtomic(APPCFG, JSON.stringify(c, null, 2)); } catch (e) { console.error('schedule disable failed:', e.message); } },
  loadFired: () => readJsonSafe(FIREDF) || {},
  saveFired: (f) => { try { writeFileAtomic(FIREDF, JSON.stringify(f)); } catch (_) {} },
  log: (e) => console.log('schedule:', JSON.stringify(e)),
});
// --- alerts: one place that fans a message out to the webhook and to subscribed browsers / phones ---
const { createPush, SW_JS } = require('./push');
const push = createPush({ dataDir: DATA, log: (t) => console.log(t) });
function alertOut(kind, text, ev, url) {
  const cfg = readJsonSafe(APPCFG) || {};
  const site = (cfg.site && cfg.site.name) || readConfig().name || 'Cortex';
  const hook = cfg.alertUrl;
  if (typeof hook === 'string' && /^https?:\/\//i.test(hook)) {     // optional webhook (Home Assistant, ntfy, anything that takes a POST)
    fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Title': 'Cortex alert' },
      body: JSON.stringify({ site, kind, text: site + ': ' + text, message: site + ': ' + text, title: 'Cortex alert', event: ev }), signal: AbortSignal.timeout(8000) }).catch(e => console.error('alert webhook failed:', e.message));
  }
  if (push.count()) push.send({ title: site, body: text, tag: kind + ':' + (ev && (ev.key || ev.addr) != null ? (ev.key || ev.addr) : ''), url: url || '/' }, kind).catch(e => console.error('push failed:', e.message));
}
// What a phone shows when the secure address cannot be reached (no internet, Tailscale off): the service worker
// keeps this page, and it offers the building-network address instead. See docs/REMOTE_AND_LOCAL.md.
app.get('/offline.html', (_req, res) => {
  const c = readConfig(), p80 = typeof port80 !== 'undefined' && port80.active, esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const links = lanAddrs().map(ip => 'http://' + ip + (p80 ? '' : ':' + PORT)).concat(['http://cortex.local' + (p80 ? '' : ':' + PORT)]);
  res.set('Cache-Control', 'no-cache').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cortex</title>
<style>html,body{margin:0;height:100%;background:#0f1318;color:#e7ebf0;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.w{max-width:440px;margin:0 auto;padding:44px 22px}h1{font-size:22px;margin:18px 0 6px}p{color:#9aa4b2;margin:8px 0}
img{width:64px;height:64px;border-radius:16px}a.b{display:block;text-align:center;text-decoration:none;font-weight:650;border-radius:12px;padding:14px;margin-top:12px;background:#0e7c66;color:#fff}a.b.s{background:none;border:1px solid #27303b;color:#e7ebf0}small{color:#6b7585;display:block;margin-top:4px;font-weight:400}#st{margin-top:22px;font-size:14px}</style></head>
<body><div class="w"><img src="/icon-256.png" alt=""><h1>Can't reach ${esc(c.name || 'Cortex')} over the secure link</h1>
<p>This phone has no route to the controller right now. That usually means no internet, or Tailscale is switched off on this phone.</p>
<p><b style="color:#e7ebf0">In the building?</b> Join its Wi-Fi and open Cortex directly:</p>
${links.map((u, i) => `<a class="b${i ? ' s' : ''}" href="${esc(u)}/">Open on the building network<small>${esc(u.replace(/^http:\/\//, ''))}</small></a>`).join('')}
<p id="st">Still trying the secure link…</p></div>
<script>setInterval(function(){fetch('/health',{cache:'no-store'}).then(function(r){if(r.ok)location.replace('/');}).catch(function(){});},5000);</script></body></html>`);
});
app.get('/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache').type('application/javascript').send(SW_JS); });
app.get('/api/push', (req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ key: push.publicKey(), devices: push.count(), subscribed: req.query.endpoint ? push.has(String(req.query.endpoint)) : undefined, fleet: req.query.endpoint ? !!(push.info(String(req.query.endpoint)) || {}).fleet : undefined }); });
app.post('/api/push/subscribe', (req, res) => { cors(res); const b = req.body || {}; if (!push.subscribe(b.subscription, b.user, b.kinds, typeof b.fleet === 'boolean' ? { fleet: b.fleet } : undefined)) return res.status(400).json({ err: 'bad subscription' }); res.json({ ok: true, devices: push.count() }); });
app.post('/api/push/unsubscribe', (req, res) => { cors(res); push.unsubscribe(String((req.body || {}).endpoint || '')); res.json({ ok: true, devices: push.count() }); });
app.post('/api/push/test', async (req, res) => { cors(res); const ep = String((req.body || {}).endpoint || ''); if (!ep || !push.has(ep)) return res.status(400).json({ err: 'this device is not subscribed' });
  const cfg = readJsonSafe(APPCFG) || {}; const site = (cfg.site && cfg.site.name) || readConfig().name || 'Cortex';
  res.json(await push.send({ title: site, body: 'Test notification from Cortex. Alerts will look like this.', tag: 'test', url: '/' }, 'test', ep)); });
// --- fleet watch: Cortex Command's alerts while the Command page is closed -------------------------
// Command (served from this controller) saves its list of buildings here; this controller then looks at
// each one about once a minute, read-only, and pushes a notification when one changes. See fleetwatch.js.
const { createFleetWatch } = require('./fleetwatch');
const fleetWatch = createFleetWatch({ dataDir: DATA, log: (t) => console.log(t), wanted: () => push.fleetCount() > 0,
  notify: ({ site, text }) => { push.send({ title: site.name, body: text.charAt(0).toUpperCase() + text.slice(1), tag: 'fleet:' + site.id, url: '/command-center.html' }, 'fleet').catch(e => console.error('fleet push failed:', e.message)); } });
fleetWatch.start();
app.get('/api/fleet', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ ok: true, sites: fleetWatch.sites(), state: fleetWatch.state(), devices: push.fleetCount() }); });
app.post('/api/fleet', (req, res) => { cors(res); const n = fleetWatch.setSites((req.body || {}).sites); res.json({ ok: true, sites: n }); });
app.post('/api/fleet/test', async (req, res) => { cors(res); const ep = String((req.body || {}).endpoint || ''); if (!ep || !push.has(ep)) return res.status(400).json({ err: 'this device is not subscribed' });
  res.json(await push.send({ title: 'Cortex Command', body: 'Test alert. Building alerts will look like this, even with Command closed.', tag: 'test', url: '/command-center.html' }, 'test', ep)); });
app.get('/command-icon-256.png', (_req, res) => { res.set('Cache-Control', 'public, max-age=86400').type('png').send(pwa.CMD_ICON_PNG); });
app.get('/command.webmanifest', (_req, res) => { const m = pwa.manifest('Cortex Command'); res.type('application/manifest+json').json(Object.assign({}, m, { name: 'Cortex Command', short_name: 'Command', start_url: '/command-center.html', id: '/command-center.html', background_color: '#0f1a24', theme_color: '#0f1a24', icons: [{ src: '/command-icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any maskable' }] })); });
// --- clear unit data: start the unit list over without a factory reset ------------------------------
// Logins, site settings, schedules, floor-plan pictures, notification devices and update settings are
// not touched here (the page clears the unit-related parts of its own config). The equipment is not
// touched either: nothing is sent on the bus. The body must carry confirm:"CLEAR".
app.post('/api/clear-units', (req, res) => {
  cors(res);
  const b = req.body || {};
  if (b.confirm !== 'CLEAR') return res.status(400).json({ err: 'confirm must be CLEAR' });
  const had = unitsDoc.units.length;
  cmdQueue = [];
  unitsDoc = { rev: unitsDoc.rev + 1, ts: Date.now(), units: [] }; unitsDirty = true; flushUnits();
  const done = ['units'].concat(recorder.clear({ odu: !!b.odu, events: !!b.events, history: !!b.history }));
  // The controller reads outdoor units from the addresses saved in the site config. Empty that list here,
  // in the same step, or its next pass would read the outdoor units again and bring them straight back.
  let cfgRev = null;
  if (b.odu) { try { const cur = readJsonSafe(APPCFG) || {}; if (cur.provisioned) { cur.oduAddrs = []; cur._rev = (Number(cur._rev) || 0) + 1; writeFileAtomic(APPCFG, JSON.stringify(cur, null, 2)); cfgRev = cur._rev; } } catch (e) { console.error('could not clear outdoor addresses:', e.message); } }
  if (b.history) histLast = 0;
  if (b.events) { try { diagWatch.clear(); done.push('advisories'); } catch (_) {} }
  console.log('unit data cleared: ' + done.join(', ') + ' (' + had + ' units removed)');
  res.json({ ok: true, rev: unitsDoc.rev, removed: had, cleared: done, cfgRev });
});

// --- per-user preferences, kept on the controller so they follow the person to any device ---------
const PREFSF = path.join(DATA, 'prefs.json');
let prefsDoc = readJsonSafe(PREFSF) || {};
const prefKey = (u) => String(u || '').toLowerCase().replace(/[^a-z0-9_.@-]/g, '').slice(0, 64);
app.get('/api/prefs', (req, res) => { cors(res); res.set('Cache-Control', 'no-store'); const k = prefKey(req.query.user); res.json(k && prefsDoc[k] ? prefsDoc[k] : { ts: 0, prefs: null }); });
app.post('/api/prefs', (req, res) => { cors(res); const b = req.body || {}, k = prefKey(b.user);
  if (!k || !b.prefs || typeof b.prefs !== 'object' || JSON.stringify(b.prefs).length > 20000) return res.status(400).json({ err: 'bad prefs' });
  prefsDoc[k] = { ts: Date.now(), prefs: b.prefs }; try { writeFileAtomic(PREFSF, JSON.stringify(prefsDoc)); } catch (e) { return res.status(500).json({ err: e.message }); }
  res.json({ ok: true, ts: prefsDoc[k].ts }); });
// --- recorder: rolling buffer, fault events with the 10 minutes before, outdoor trends ----------
const { createRecorder } = require('./recorder');
const recorder = createRecorder({ dataDir: DATA, log: (t) => console.log('recorder:', t),
  notify: (ev) => {
    if (ev.brand) { alertOut(ev.kind === 'silent' ? 'silent' : 'fault', (ev.name || 'A system') + (ev.kind === 'silent' ? ' stopped answering' : ' alarm: ' + ev.code), ev, '/#events'); return; }   // equipment that is not on the LG bus
    const what = ev.kind === 'silent' ? 'stopped responding' : ('error ' + ev.code);
    alertOut(ev.kind === 'silent' ? 'silent' : 'fault', `${ev.kind === 'odu' ? 'Outdoor unit' : (ev.name || 'Unit')} 0x${ev.addr.toString(16).toUpperCase()} ${what}`, ev, '/#events');
  } });
app.post('/api/odu', (req, res) => { cors(res);                // pages read by the dashboard that holds the adapter
  const pages = (req.body && Array.isArray(req.body.pages)) ? req.body.pages.slice(0, 16) : [];
  for (const h of pages) if (typeof h === 'string' && /^[0-9a-f]{128}$/i.test(h)) recorder.onOdu(Buffer.from(h, 'hex'));
  res.json({ ok: true }); });
// Rheem / Ruud alarms join the same fault history and the same notifications as everything else.
// An alarm is opened when a system reports it and closed when it stops reporting it. While a system cannot be
// heard its alarms are left as they were (nobody knows), and after three minutes of no answers that is itself recorded.
const ecoDown = new Map();
function ecoWatch() { const t = Date.now();
  for (const x of ecoSystems.values()) { let i; try { i = x.info(); } catch (_) { continue; }
    const fresh = i.state === 'live' || (i.state === 'listening' && i.values.ALARM_01 && !i.values.ALARM_01.stale);
    const bad = i.on && i.talk && ['unanswered', 'problem', 'silent'].includes(i.state);
    if (bad) { if (!ecoDown.has(i.id)) ecoDown.set(i.id, t); } else ecoDown.delete(i.id);
    const down = bad && t - ecoDown.get(i.id) > 3 * 60000, open = recorder.events().filter(e => !e.cleared && e.key === 'econet:' + i.id);
    let list;
    if (fresh) { const snap = {}; for (const k of Object.keys(i.values)) { const v = i.values[k]; if (!v.stale) snap[k] = v.text != null ? v.text : v.v; }
      list = (i.alarms || []).map(a => ({ code: a, snap })); }
    else if (down) list = open.filter(e => e.kind !== 'silent').map(e => ({ code: e.code })).concat([{ code: 'No answer', kind: 'silent' }]);
    else continue;
    try { recorder.external('econet', i.id, i.name, list, { sysKind: i.kind }, t); } catch (e) { console.error('econet events:', e.message); } } }
setInterval(ecoWatch, 5000);
app.get('/api/odu', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ odu: recorder.oduState(), poller: Object.assign(pollerInfo(), { active: pollerInfo().active || [...lgLines.values()].some(L => L.master.state.active) }), cleared: recorder.oduClearedAt(), find: oduFindInfo(), members: invInfo(), addrs: oduAddrsAll(), lineOf: Object.fromEntries(oduLine) }); });
// --- cycle diagnosis on the controller: persistent findings become advisories ------------------------
const { createDiagWatch } = require('./diagwatch');
const diagWatch = createDiagWatch({ dataDir: DATA, htmlPath: fs.existsSync(path.join(DIR, 'cortex.html')) ? path.join(DIR, 'cortex.html') : path.join(DIR, '..', 'cortex.html'), log: (t) => console.log('diagnosis:', t),
  getUnits: () => unitsDoc.units, getOdu: () => recorder.oduState(),
  notify: (a) => alertOut('diag', `${a.lvl === 'likely' ? 'Likely' : 'Possible'}: ${a.title} (outdoor unit 0x${a.addr.toString(16).toUpperCase()}, ${a.hit} of ${a.total} signs)`, a, '/#events') });
diagWatch.start();
app.get('/api/diag', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ advisories: diagWatch.list(), health: diagWatch.health(), state: diagWatch.state() }); });
app.get('/api/events', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ events: recorder.events() }); });
app.get('/api/events/:id', (req, res) => { cors(res); const d = recorder.event(req.params.id); if (!d) return res.status(404).json({ err: 'no such event' }); res.json(d); });
app.get('/api/history/odu', (req, res) => { cors(res); res.set('Cache-Control', 'no-store');
  const addr = parseInt(req.query.addr, 10), days = Math.max(1, Math.min(31, parseInt(req.query.days, 10) || 1));
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xFE) return res.status(400).json({ err: 'addr' });
  res.json({ addr, days, rows: recorder.oduHistory(addr, days) }); });

// --- the poll loop, on the controller ----------------------------------------------
// Runs whenever Cortex is the bus master on this site and no dashboard holds the adapter, so the
// equipment is watched (and faults are recorded) with every browser closed. See busmaster.js.
const { createMaster } = require('./busmaster');

const liveKeys = new Set();                  // every field the poll loops write: readings and state, never names or groups
let structRev = unitsDoc.rev;                            // the revision at which a person last changed the list itself
function patchUnits(patches) {
  if (!patches || !patches.length) return;
  for (const p of patches) for (const k in p.fields) liveKeys.add(k);
  if ([...liveKeys].some(k => k === 'code')) liveKeys.add('errLog');
  const by = new Map(patches.map(p => [p.addr, p.fields])); let ch = false;
  const units = unitsDoc.units.map(u => { const f = u && by.get(u.addr); if (!f) return u;
    const n = Object.assign({}, u, f);
    if ('code' in f && (f.code || null) !== (u.code || null)) {             // same fault history the dashboard keeps
      const L = Array.isArray(u.errLog) ? u.errLog.map(x => Object.assign({}, x)) : [], t = Date.now();
      if (u.code) { const e = L.find(x => x.code === u.code && !x.cleared); if (e) e.cleared = t; }
      if (f.code) L.unshift({ code: f.code, at: t, cleared: 0 });
      n.errLog = L.slice(0, 20); }
    ch = true; return n; });
  if (!ch) return;
  unitsDoc = { rev: unitsDoc.rev + 1, ts: Date.now(), units };
  unitsDirty = true; if (!unitsFlushT) unitsFlushT = setTimeout(flushUnits, 15000);
}
busMaster = createMaster({
  openPort: async () => link.facade(),                         // the shared adapter; the loop never opens or closes the real port
  getUnits: () => unitsDoc.units.filter(u => u && !u.bus),       // units on another LG line are asked by that line's own loop
  patchUnits,
  drain: () => drainFor(0),
  oduAddrs: () => oduAddrsFor(0),
  scanNext: (n) => scanNextFor(L0, n), onScanReply: (a, p) => onScanReplyFor(L0, a, p),
  oduScanNext: (n) => oduScanNext(0, n), onOduFound: (a) => oduFound(0, a), oduWanted: () => oduNow || invPending(0),
  inventoryNext: () => inventoryNext(0), onInventory: (a, fr) => onInventory(0, a, fr),
  onOdu: (f) => { oduOnLine(f[4], 0); recorder.onOdu(f); },
  onPass: passDone,
  onEnd: () => { pollerEndedAt = Date.now(); setTimeout(() => { superviseBus(); busTell(); }, 0); },
  log: (t) => console.log('busmaster:', t),
});
// Outdoor units: nobody says which line one is on, so every line asks for an address until one of them gets an answer.
const oduLine = new Map();
// Outdoor addresses the controller found or was asked to read itself, kept beside the ones saved from a screen.
const ODUAF = path.join(DATA, 'odu-addrs.json');
const oduOwn = new Set(((readJsonSafe(ODUAF) || {}).addrs || []).filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF));
{ const l = (readJsonSafe(ODUAF) || {}).lines; if (l && typeof l === 'object') for (const k of Object.keys(l)) if (Number.isInteger(+k) && Number.isInteger(l[k])) oduLine.set(+k, l[k]); }   // which line each one is on survives a restart
let oduSaveT = null;
const oduOwnSave = () => { clearTimeout(oduSaveT); oduSaveT = setTimeout(() => { try { writeFileAtomic(ODUAF, JSON.stringify({ addrs: [...oduOwn].sort((a, b) => a - b), lines: Object.fromEntries(oduLine) })); } catch (_) {} }, 500); };
const oduOnLine = (a, line) => { if (oduLine.get(a) !== line) { oduLine.set(a, line); oduOwnSave(); } };
function oduAddrsAll() { const c = readJsonSafe(APPCFG) || {}; return [...new Set((Array.isArray(c.oduAddrs) ? c.oduAddrs : []).concat([...oduOwn]))].filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF); }
function oduAddrsFor(line) { return oduAddrsAll().filter(a => !oduLine.has(a) || oduLine.get(a) === line); }
/* Find outdoor units from the controller, on every LG line at once: the read-only monitor page, asked of each
   address in turn. Any screen can start it; no screen has to hold the adapter. */
let oduFind = null;                          // { at, per: Map(line -> {cur, done}), found: Set }
const oduLinesNow = () => [0].concat([...lgLines.keys()]).filter(l => { const m = l ? lgLines.get(l).master : busMaster, lk = l ? lgLines.get(l).link : link; return lk.state.port && (l ? true : !lk.state.driver) && m; });
function oduScanNext(line, n) { const F = oduFind; if (!F) return []; const st = F.per.get(line); if (!st || st.done) return [];
  const out = []; while (out.length < n && st.cur <= SCAN_MAX) { const a = st.cur++; if (!F.found.has(a)) out.push(a); }
  if (!out.length) { st.done = true; if ([...F.per.values()].every(x => x.done)) { F.endedAt = Date.now(); console.log('outdoor search finished: ' + F.found.size + ' found'); } }
  return out; }
function oduFound(line, a) { oduOnLine(a, line); if (!oduOwn.has(a)) { oduOwn.add(a); oduOwnSave(); } if (oduFind) oduFind.found.add(a); }
const oduFindInfo = () => { const F = oduFind; if (!F) return null; const per = [...F.per.values()]; return { running: !F.endedAt, asked: per.reduce((s, x) => s + Math.min(SCAN_MAX + 1, x.cur), 0), total: per.length * (SCAN_MAX + 1), lines: per.length, found: [...F.found].sort((a, b) => a - b), at: F.at }; };
app.post('/api/odu/find', (req, res) => { cors(res); const b = req.body || {};
  if (b.stop === true) { if (oduFind && !oduFind.endedAt) { oduFind.per.forEach(x => { x.done = true; }); oduFind.endedAt = Date.now(); } return res.json({ ok: true, find: oduFindInfo() }); }
  if (!masterMode()) return res.status(409).json({ err: 'live polling is off. Start it first: Cortex only talks on a line when it is the master on this site' });
  const lines = oduLinesNow(); if (!lines.length) return res.status(409).json({ err: 'no LG line is connected' });
  oduFind = { at: Date.now(), per: new Map(lines.map(l => [l, { cur: 0, done: false }])), found: new Set(), endedAt: 0 }; superviseBus(); res.json({ ok: true, find: oduFindInfo() }); });
// Read one outdoor unit now, by its central-control address: it joins the list every line tries, and the next pass reads it.
let oduNow = false;
app.post('/api/odu/read', (req, res) => { cors(res); const a = Number((req.body || {}).addr);
  if (!Number.isInteger(a) || a < 0 || a > 0xFE) return res.status(400).json({ err: 'need the outdoor unit address (0-254)' });
  if (!masterMode()) return res.status(409).json({ err: 'live polling is off' });
  if (!oduOwn.has(a)) { oduOwn.add(a); oduOwnSave(); } oduLine.delete(a); oduNow = true; setTimeout(() => { oduNow = false; }, 20000);
  if (busMaster) busMaster.state.oduAt = 0; for (const L of lgLines.values()) L.master.state.oduAt = 0; superviseBus(); res.json({ ok: true }); });
/* Which indoor units belong to which outdoor unit: each outdoor unit is asked for its own list, on the line it is
   on (an outdoor unit whose line is not known yet is asked on every line). Run here so it reaches every line. */
let oduInv = null;      // { at, lines, q: Map(line -> [addr]), res: Map(addr -> { want:Set, tried:Set, frames, line }), endedAt }
const invDone = (r) => !!r.frames || [...r.want].every(l => r.tried.has(l));
function inventoryNext(line) { const J = oduInv; if (!J || J.endedAt) return null; const q = J.q.get(line) || [];
  while (q.length) { const a = q.shift(); if (!J.res.get(a).frames) return a; J.res.get(a).tried.add(line); } invCheck(); return null; }
function onInventory(line, a, frames) { const J = oduInv; if (!J) return; const r = J.res.get(a); if (!r) return; r.tried.add(line);
  if (frames && frames.length && !r.frames) { r.frames = frames.map(f => Buffer.from(f).toString('hex')); r.line = line; oduOnLine(a, line); }
  else if (!r.frames && !r.widened && J.lines.length > r.want.size) { r.widened = true;                       // no answer where we thought it was: it may have been moved, so try the other lines too
    for (const l of J.lines) if (!r.want.has(l)) { r.want.add(l); J.q.get(l).push(a); } superviseBus(); }
  invCheck(); }
function invCheck() { const J = oduInv; if (J && !J.endedAt && [...J.res.values()].every(invDone)) { J.endedAt = Date.now(); console.log('outdoor unit lists read: ' + [...J.res.values()].filter(r => r.frames).length + ' of ' + J.res.size + ' answered'); } }
const invPending = (line) => !!(oduInv && !oduInv.endedAt && (oduInv.q.get(line) || []).length);
const invInfo = () => { const J = oduInv; if (!J) return null; const rs = [...J.res.entries()]; return { running: !J.endedAt, at: J.at, lines: J.lines.length, done: rs.filter(([, r]) => invDone(r)).length, total: rs.length,
  plan: rs.map(([a, r]) => ({ odu: a, line: r.line == null ? null : r.line, asked: [...r.tried], pages: r.frames || null, pending: !invDone(r) })) }; };
app.post('/api/odu/members', (req, res) => { cors(res); const b = req.body || {};
  if (b.stop === true) { if (oduInv && !oduInv.endedAt) oduInv.endedAt = Date.now(); return res.json({ ok: true, members: invInfo() }); }
  if (!masterMode()) return res.status(409).json({ err: 'live polling is off. Start it first: Cortex only talks on a line when it is the master on this site' });
  const lines = oduLinesNow(); if (!lines.length) return res.status(409).json({ err: 'no LG line is free for the controller to use' });
  const addrs = [...new Set((Array.isArray(b.addrs) ? b.addrs : oduAddrsAll()).map(Number).filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF))].slice(0, 64);
  if (!addrs.length) return res.status(400).json({ err: 'find the outdoor units first' });
  const J = { at: Date.now(), lines, q: new Map(lines.map(l => [l, []])), res: new Map(), endedAt: 0 };
  for (const a of addrs) { const known = oduLine.has(a) && lines.includes(oduLine.get(a)) ? [oduLine.get(a)] : lines; J.res.set(a, { want: new Set(known), tried: new Set(), frames: null, line: null }); known.forEach(l => J.q.get(l).push(a)); }
  oduInv = J; setTimeout(() => { if (oduInv === J && !J.endedAt) J.endedAt = Date.now(); }, 6 * 60000); superviseBus(); res.json({ ok: true, members: invInfo() }); });
app.post('/api/odu/forget', (req, res) => { cors(res); const a = Number((req.body || {}).addr); if (oduOwn.delete(a)) oduOwnSave(); oduLine.delete(a); res.json({ ok: true }); });
let passAt = 0;
function passDone() { if (Date.now() - passAt < 2000) return; passAt = Date.now(); histSample(); recorder.sample(unitsDoc.units); }   // several lines finish passes; the history is sampled once

/* --- more than one LG line --------------------------------------------------------------------------
   A big building can have several separate LG wires (LG's own central controller has several ports). Each
   extra line gets its own adapter, or its own channel of a multi-channel adapter, and its own poll loop,
   so all of them are read at the same time. A unit says which line it is on with `bus` (absent = the first
   line). Addresses must be unique across the whole building, exactly as LG's controller requires, because
   everything else in Cortex knows a unit by its address.
   The first line keeps the technician bus tools. An extra line finds its units with a search run here on
   the controller: the same safe read the poll loop sends, to each address in turn. */
const LGLF = path.join(DATA, 'lg-lines.json'), LG_MAX = 7;
const SCAN_MAX = Math.max(1, Math.min(0xFE, parseInt(process.env.CORTEX_SCAN_MAX, 10) || 0xFE));      // highest address a search asks (tests shorten it)
/* Looking for units on a line. The first line is searched the same way as the others, so one search can walk every
   channel in turn: channel 1, then channel 2 without the addresses channel 1 answered on, and so on. */
const lineObj = (id) => id ? lgLines.get(id) : L0;
const lineUnits = (id) => id ? lgUnits(id) : unitsDoc.units.filter(u => u && !u.bus);
function scanBegin(L, skip) { const own = new Set(lineUnits(L.cfg.id).map(u => u.addr)), sk = new Set(skip || []); let total = 0; for (let a = 0; a <= SCAN_MAX; a++) if (!own.has(a) && !sk.has(a)) total++;
  L.found.clear(); L.scan = { at: Date.now(), cur: 0, asked: 0, probed: 0, total, done: false, skip: sk }; }
function scanNextFor(L, n) { const sc = L.scan; if (!sc || sc.done) return []; const mine = new Set(lineUnits(L.cfg.id).map(u => u.addr)), out = [];
  while (out.length < n && sc.cur <= SCAN_MAX) { const a = sc.cur++; if (mine.has(a) || sc.skip.has(a)) { sc.asked++; continue; } out.push(a); }
  if (!out.length && sc.cur > SCAN_MAX) { sc.done = true; sc.endedAt = Date.now(); console.log('lg line ' + (L.cfg.id || 1) + ': search finished, ' + L.found.size + ' answered'); searchAllStep(L.cfg.id); busTell(); }
  return out; }
function onScanReplyFor(L, a, p) { const sc = L.scan; if (!sc) return; sc.asked++; sc.probed++;
  if (p) { const ex = unitsDoc.units.find(u => u && u.addr === a); L.found.set(a, { addr: a, on: !!p.on, mode: p.mode, room: p.room, settemp: p.settemp, err: p.err || 0, onLine: ex ? (ex.bus && lgLines.has(ex.bus) ? ex.bus : 1) : 0, unit: ex ? (ex.label || ex.name || '') : '' }); } }
const scanInfo = (L) => { const sc = L.scan; return sc ? { running: !sc.done, asked: Math.min(SCAN_MAX + 1, sc.asked), total: SCAN_MAX + 1, probed: sc.probed, toProbe: sc.total, startedAt: sc.at } : null; };
const foundList = (L) => [...L.found.values()].sort((x, y) => x.addr - y.addr);
// One search across every connected channel, one channel at a time.
lgReady = true;
const lineReady = (id) => { const lk = id ? (lgLines.get(id) || {}).link : link; return !!(lk && lk.state.port && (id ? true : !lk.state.driver)); };
function searchAllSkip(id) { const sk = new Set(unitsDoc.units.filter(u => u && (id ? u.bus !== id : !!u.bus)).map(u => u.addr));       // units Cortex already has on another line
  for (const o of searchAll.order.slice(0, searchAll.i)) for (const a of lineObj(o).found.keys()) sk.add(a); return sk; }                    // and everything earlier channels just answered on
function searchAllStep(doneId) { const J = searchAll; if (!J || J.endedAt || J.order[J.i] !== doneId) return;
  J.i++; while (J.i < J.order.length && !(lineObj(J.order[J.i]) && lineReady(J.order[J.i]))) J.i++;
  if (J.i >= J.order.length) { J.endedAt = Date.now(); console.log('search of every channel finished'); return; }
  scanBegin(lineObj(J.order[J.i]), searchAllSkip(J.order[J.i])); setTimeout(() => superviseBus(), 0); }
function searchAllInfo() { const J = searchAll; if (!J) return null; let probed = 0, toProbe = 0;
  const rows = J.order.map((id, k) => { const L = lineObj(id), sc = L && L.scan; if (!L) return null; let tot, done;
    if (k < J.i || (k === J.i && sc)) { tot = sc ? sc.total : 0; done = sc ? sc.probed : 0; if (k < J.i) done = tot; }
    else { const own = new Set(lineUnits(id).map(u => u.addr)), sk = searchAllSkipPreview(id, k); tot = 0; for (let a = 0; a <= SCAN_MAX; a++) if (!own.has(a) && !sk.has(a)) tot++; done = 0; }
    probed += done; toProbe += tot; return { id, name: L.cfg.name, state: J.endedAt || k < J.i ? 'done' : k === J.i ? 'now' : 'next', done, total: tot, found: k <= J.i ? L.found.size : 0 }; }).filter(Boolean);
  const el = (J.endedAt || Date.now()) - J.at, per = probed > 3 ? el / probed : 520;
  return { running: !J.endedAt, at: J.at, rows, probed, toProbe, etaMs: J.endedAt ? 0 : Math.round(per * Math.max(0, toProbe - probed)), elapsedMs: el, skipped: J.skipped }; }
function searchAllSkipPreview(id, k) { const sk = new Set(unitsDoc.units.filter(u => u && (id ? u.bus !== id : !!u.bus)).map(u => u.addr)); for (const o of searchAll.order.slice(0, k)) { const L = lineObj(o); if (L) for (const a of L.found.keys()) sk.add(a); } return sk; }
app.post('/api/lg-lines/search-all', (req, res) => { cors(res); const b = req.body || {};
  if (b.stop === true) { if (searchAll && !searchAll.endedAt) { searchAll.endedAt = Date.now(); const L = lineObj(searchAll.order[searchAll.i]); if (L && L.scan) { L.scan.done = true; L.scan.endedAt = Date.now(); } } busTell(); return res.json({ ok: true, search: searchAllInfo() }); }
  if (b.clear === true) { for (const L of [L0].concat([...lgLines.values()])) { L.found.clear(); if (L.scan && L.scan.done) L.scan = null; } if (searchAll && searchAll.endedAt) searchAll = null; busTell(); return res.json({ ok: true }); }
  if (!masterMode()) return res.status(409).json({ err: 'live polling is off. Start it first: Cortex only talks on a line when it is the master on this site' });
  const all = [0].concat([...lgLines.keys()].sort((x, y) => x - y)), order = all.filter(lineReady);
  if (!order.length) return res.status(409).json({ err: link.state.driver ? 'a screen is using the bus tools on line 1. Hand the adapter back to the controller first' : 'no LG channel is connected' });
  for (const L of [L0].concat([...lgLines.values()])) { L.found.clear(); L.scan = null; }
  searchAll = { at: Date.now(), order, i: 0, endedAt: 0, skipped: all.filter(x => !order.includes(x)) };
  scanBegin(lineObj(order[0]), searchAllSkip(order[0])); superviseBus(); busTell(); res.json({ ok: true, search: searchAllInfo() }); });
// What is being said on the lines right now (see `traffic`).
app.get('/api/lg-traffic', (req, res) => { cors(res); res.set('Cache-Control', 'no-store'); traffic.watchAt = Date.now();
  const since = Number(req.query.since) || 0, line = req.query.line === undefined || req.query.line === 'all' ? null : Number(req.query.line);
  const rows = traffic.ring.filter(r => r.n > since && (line == null || r.line === line)).slice(-200);
  res.json({ seq: traffic.seq, rows }); });
const lgSave = () => { try { writeFileAtomic(LGLF, JSON.stringify({ lines: [...lgLines.values()].map(L => L.cfg) }, null, 2)); } catch (e) { console.error('lg lines: could not save:', e.message); } };
const lgUnits = (id) => unitsDoc.units.filter(u => u && u.bus === id);
function lgStart(cfg) {
  const L = { cfg, rx: { bytes: 0, last: 0 }, scan: null, found: new Map(), endedAt: 0 };
  L.link = createLink({
    open: (ser) => new Promise((resolve, reject) => {
      if (link.state.on && realDev(cfg.port) === realDev(resolveSerial())) return reject(new Error('that adapter is the one the first LG line is using'));
      const eco = [...ecoSystems.values()].find(x => x.cfg.on && realDev(x.cfg.port) === realDev(cfg.port)); if (eco) return reject(new Error('that adapter belongs to the Rheem / Ruud system “' + eco.cfg.name + '”'));
      const sp = new SerialPort({ path: cfg.port, baudRate: ser.baud, parity: ser.parity, stopBits: ser.stop, dataBits: ser.data }, (err) => err ? reject(err) : resolve(sp)); }),
    load: () => ({ on: cfg.on !== false, serial: link.state.serial }),          // an LG line uses the LG line settings
    save: (o) => { cfg.on = !!o.on; lgSave(); },
    onBytes: (buf) => { L.rx.bytes += buf.length; L.rx.last = Date.now(); if (trafficOn()) trafficRx(cfg.id, buf); },
    onTx: (buf) => { if (trafficOn()) trafficPush(cfg.id, 'tx', buf); },
    onChange: () => { if (typeof superviseBus === 'function') superviseBus(); busTell(); },
    log: (t) => console.log('lg line ' + cfg.id + ':', t),
  });
  L.master = createMaster({
    openPort: async () => L.link.facade(),
    getUnits: () => lgUnits(cfg.id),
    patchUnits,
    drain: () => drainFor(cfg.id),
    oduAddrs: () => oduAddrsFor(cfg.id),
    oduScanNext: (n) => oduScanNext(cfg.id, n), onOduFound: (a) => oduFound(cfg.id, a), oduWanted: () => oduNow || invPending(cfg.id),
    inventoryNext: () => inventoryNext(cfg.id), onInventory: (a, fr) => onInventory(cfg.id, a, fr),
    onOdu: (f) => { oduOnLine(f[4], cfg.id); recorder.onOdu(f); },
    onPass: passDone,
    onEnd: () => { L.endedAt = Date.now(); setTimeout(() => { superviseBus(); busTell(); }, 0); },
    scanNext: (n) => scanNextFor(L, n), onScanReply: (a, p) => onScanReplyFor(L, a, p),
    log: (t) => console.log('lg line ' + cfg.id + ':', t),
  });
  lgLines.set(cfg.id, L); L.link.start(); return L;
}
function lgInfo(L) { const i = L.link.info(), S = L.master.state, a = ADAPTERS.list().find(x => x.dev === realDev(L.cfg.port));
  return { id: L.cfg.id, name: L.cfg.name, port: L.cfg.port, label: a ? a.label : L.cfg.port, present: !!a || (() => { try { return fs.existsSync(L.cfg.port); } catch (_) { return false; } })(),
    on: i.on, open: i.open, opening: i.opening, error: i.error || (S.error && !S.active ? S.error : null), polling: S.active, alive: L.master.alive(), passMs: S.passMs, units: lgUnits(L.cfg.id).length,
    bytes: L.rx.bytes, lastMs: L.rx.last ? Date.now() - L.rx.last : null,
    scan: scanInfo(L), found: foundList(L) }; }
(() => { const j = readJsonSafe(LGLF); for (const c of (j && Array.isArray(j.lines) ? j.lines : []).slice(0, LG_MAX)) { try { if (c && Number.isInteger(c.id) && c.id >= 2 && typeof c.port === 'string') lgStart(c); } catch (e) { console.error('lg lines: could not start', c && c.name, e.message); } } })();
app.get('/api/lg-lines', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ lines: [...lgLines.values()].map(lgInfo), first: { adapter: busAdapter(), units: unitsDoc.units.filter(u => u && !u.bus).length } }); });
app.post('/api/lg-lines', (req, res) => { cors(res); const b = req.body || {}, old = b.id != null ? lgLines.get(Number(b.id)) : null;
  if (b.id != null && !old) return res.status(404).json({ err: 'no such line' });
  const tidy = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (old) { if (typeof b.name === 'string' && tidy(b.name)) old.cfg.name = tidy(b.name);
    if (typeof b.on === 'boolean') { old.link.setOn(b.on, link.state.serial); if (!b.on) old.scan = null; }
    lgSave(); superviseBus(); busTell(); return res.json({ ok: true, line: lgInfo(old) }); }
  if (lgLines.size >= LG_MAX) return res.status(400).json({ err: 'at most ' + (LG_MAX + 1) + ' LG lines on one controller' });
  const a = ADAPTERS.list().find(x => x.path === b.port); if (!a) return res.status(400).json({ err: 'pick an adapter that is plugged into the controller' });
  if (a.dev === realDev(resolveSerial())) return res.status(400).json({ err: 'that adapter is the one the first LG line uses' });
  const eco = [...ecoSystems.values()].find(x => realDev(x.cfg.port) === a.dev); if (eco) return res.status(400).json({ err: 'that adapter is used by the Rheem / Ruud system “' + eco.cfg.name + '”' });
  const oth = [...lgLines.values()].find(L => realDev(L.cfg.port) === a.dev); if (oth) return res.status(400).json({ err: 'that adapter is used by “' + oth.cfg.name + '”' });
  let id = 2; while (lgLines.has(id)) id++;
  const L = lgStart({ id, name: tidy(b.name) || ('LG line ' + id), port: a.path, on: b.on !== false }); lgSave(); superviseBus(); busTell();
  res.json({ ok: true, line: lgInfo(L) }); });
app.delete('/api/lg-lines/:id', async (req, res) => { cors(res); const id = Number(req.params.id), L = lgLines.get(id); if (!L) return res.status(404).json({ err: 'no such line' });
  L.scan = null; try { await L.master.stop(); } catch (_) {} L.link.stop(); lgLines.delete(id); lgSave();
  patchUnits(unitsDoc.units.filter(u => u && u.bus === id).map(u => ({ addr: u.addr, fields: { offline: true } })));       // its units stay, but nothing asks them any more
  busTell(); res.json({ ok: true }); });
// Look for units on a line. This transmits (the safe read, to each address), so it needs Cortex to be the master on this site.
app.post('/api/lg-lines/:id/scan', (req, res) => { cors(res); const L = lgLines.get(Number(req.params.id)); if (!L) return res.status(404).json({ err: 'no such line' });
  const b = req.body || {};
  if (b.stop === true) { if (L.scan) { L.scan.done = true; L.scan.endedAt = Date.now(); } busTell(); return res.json({ ok: true, line: lgInfo(L) }); }
  if (b.clear === true) { L.found.clear(); if (L.scan && L.scan.done) L.scan = null; busTell(); return res.json({ ok: true, line: lgInfo(L) }); }
  if (!masterMode()) return res.status(409).json({ err: 'live polling is off. Start it first: Cortex only talks on a line when it is the master on this site' });
  if (!L.link.state.port) return res.status(409).json({ err: 'connect this line’s adapter first' });
  scanBegin(L, null); superviseBus(); busTell(); res.json({ ok: true, line: lgInfo(L) }); });
function pollerInfo() { const S = busMaster.state; return { active: S.active, alive: busMaster.alive(), passMs: S.passMs, lastPassAt: S.lastPassAt, passes: S.passes, error: S.error, masterMode: masterMode() }; }
let pollerEndedAt = 0;
// Supervisor: the controller polls exactly when the adapter is connected, Cortex is the bus master on this
// site, there are units to ask, and no screen is using the bus tools. Anything else: stay off the wire.
function superviseBus() {
  if (!busMaster) return;
  const oduBusy = () => oduNow || (oduFind && !oduFind.endedAt) || invPending(0);
  const want = !!link.state.port && !link.state.driver && masterMode() && (unitsDoc.units.some(u => u && !u.bus) || oduBusy() || (L0.scan && !L0.scan.done));
  if (busMaster.state.active) { if (!want && !busMaster.state.stopping) busMaster.stop().then(() => busTell(), () => {}); return; }
  if (!want) return;
  if (busMaster.state.error && Date.now() - pollerEndedAt < 15000) return;      // failing: try again shortly, not in a tight loop
  busMaster.start(); busTell();
}
const superviseFirst = superviseBus;
// every line by the same rule; an extra line also runs while it is searching for its units
superviseBus = function () { superviseFirst();
  for (const L of lgLines.values()) { const m = L.master, want = !!L.link.state.port && masterMode() && (lgUnits(L.cfg.id).length > 0 || (L.scan && !L.scan.done) || oduNow || (oduFind && !oduFind.endedAt) || invPending(L.cfg.id));
    if (m.state.active) { if (!want && !m.state.stopping) m.stop().then(() => busTell(), () => {}); continue; }
    if (!want) continue; if (m.state.error && Date.now() - L.endedAt < 15000) continue;
    m.start(); busTell(); } };
setInterval(() => { link.tick(); for (const L of lgLines.values()) L.link.tick(); superviseBus(); }, 2000);
link.start();
setInterval(() => { schedRunner.tick().catch(e => console.error('schedule tick failed:', e && e.message)); }, 20000);
app.get('/api/sched', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store');
  res.json({ server: true, masterMode: masterMode(), masterAlive: masterAlive(), history: schedRunner.history }); });

server.listen(PORT, () => console.log(`Cortex appliance listening on :${PORT}  (serial ${resolveSerial()})`));

// Also answer on the standard web port, so the address works without ":8080" and from networks whose
// firewall only lets ordinary web traffic through (the way an LG ACP is reached). Same app, same bus
// bridge. Needs the service's CAP_NET_BIND_SERVICE (shipped in the unit file); if the port cannot be
// opened for any reason the controller carries on exactly as before on CORTEX_PORT.
const port80 = { want: process.env.CORTEX_HTTP80 !== '0' && PORT !== 80, active: false, error: null };
if (port80.want) {
  const plain = http.createServer(app);
  plain.on('error', (e) => { port80.active = false; port80.error = e.code || e.message; console.log('port 80 not available (' + port80.error + '); still serving on :' + PORT); });
  // the bus bridge is attached only once the port is really open: attached earlier, a refused port
  // surfaces as an unhandled error on the bridge and takes the whole controller down
  plain.listen(80, () => { attachBus(plain); port80.active = true; port80.error = null; console.log('Cortex appliance also listening on :80'); });
}

// Save the latest unit readings before the service stops (an update or a reboot), and never let a
// stray promise rejection take the whole controller down.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { flushUnits(); } catch (_) {} try { recorder.flush(); } catch (_) {} process.exit(0); });
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e && e.message ? e.message : e));

// --- optional HTTPS -------------------------------------------------------------
// ON BY DEFAULT (since 1.7.1) and ADDITIVE. Nothing here can take the plain-http listener above down: it is already
// started, there is no redirect, and every failure below is caught, logged and reported in
// /api/device (-> Device health) instead of thrown. Turn it off with CORTEX_HTTPS=0 in
// <DATA>/appliance.env. The certificate is whatever sits at <DATA>/tls/cert.pem + key.pem:
// install.sh makes a self-signed one, or drop a real one there (e.g. from `tailscale cert`).
// If HTTPS is enabled and NO certificate exists yet (a box that only ever updated over the air),
// we try once to make the same self-signed one; an existing cert or key is never overwritten.
function startHttps() {
  if (!httpsState.enabled) return;
  const certP = process.env.CORTEX_TLS_CERT || path.join(DATA, 'tls', 'cert.pem');
  const keyP  = process.env.CORTEX_TLS_KEY  || path.join(DATA, 'tls', 'key.pem');
  try {
    if (!fs.existsSync(certP) && !fs.existsSync(keyP)) {
      const hn = (os.hostname() || 'cortex').replace(/[^A-Za-z0-9.-]/g, '') || 'cortex';
      fs.mkdirSync(path.dirname(certP), { recursive: true });
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
        '-keyout', keyP, '-out', certP, '-subj', '/CN=' + hn,
        '-addext', `subjectAltName=DNS:${hn},DNS:${hn}.local,DNS:localhost,IP:127.0.0.1`], { stdio: 'ignore', timeout: 60000 });
      try { fs.chmodSync(keyP, 0o600); } catch (_) {}
      console.log('HTTPS: generated a self-signed certificate at ' + certP);
    }
    const cert = fs.readFileSync(certP), key = fs.readFileSync(keyP);
    const describe = (pem) => { try { const x = new crypto.X509Certificate(pem);
        const names = String(x.subjectAltName || '').split(',').map(t => t.trim()).filter(t => /^DNS:/.test(t)).map(t => t.slice(4));
        httpsState.cert = { subject: String(x.subject || '').replace(/\n/g, ', '), validTo: new Date(x.validTo).toISOString(), selfSigned: x.issuer === x.subject,
          name: names.find(n => /\.ts\.net$/i.test(n)) || null };          // the address this certificate is trusted for (a Tailscale name), if any
      } catch (_) {} };
    describe(cert);
    const tls = https.createServer({ cert, key }, app);
    tls.on('error', (e) => { httpsState.active = false; httpsState.error = e.message; console.error('HTTPS disabled (http still serving):', e.message); });
    tls.listen(httpsState.port, () => { attachBus(tls); httpsState.active = true; httpsState.error = null; console.log(`Cortex appliance also listening on https :${httpsState.port}`); });
    // A new certificate (cortex-https.sh fetches and renews a trusted one) is picked up without a restart.
    let seen = ''; try { seen = fs.statSync(certP).mtimeMs + ':' + fs.statSync(keyP).mtimeMs; } catch (_) {}
    const reload = setInterval(() => { try { const now = fs.statSync(certP).mtimeMs + ':' + fs.statSync(keyP).mtimeMs; if (now === seen) return;
        const c2 = fs.readFileSync(certP), k2 = fs.readFileSync(keyP); tls.setSecureContext({ cert: c2, key: k2 }); seen = now; describe(c2);
        console.log('HTTPS: now using the updated certificate' + (httpsState.cert && httpsState.cert.name ? ' for ' + httpsState.cert.name : '')); } catch (e) { /* half-written pair: try again next time */ } }, 60000);
    if (reload.unref) reload.unref();
  } catch (e) {
    httpsState.active = false;
    httpsState.error = (e.code === 'ENOENT' && /openssl/.test(String(e.path || e.message))) ? 'no certificate, and openssl is not installed to make one'
      : (e.code === 'ENOENT' ? 'certificate or key file missing' : e.message);
    console.error('HTTPS not started (http still serving):', httpsState.error);
  }
}
startHttps();
