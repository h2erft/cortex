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
  enabled: /^(1|true|yes|on)$/i.test(String(process.env.CORTEX_HTTPS || '').trim()),
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
  res.json({ ok: true, serial: c.serial, port: PORT, version: readVersion(), running: BOOT_VERSION, name: c.name, configured: c.configured });
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
function masterAlive() { return Date.now() - masterAt < 30000 || (typeof busMaster !== 'undefined' && busMaster && busMaster.alive()); }
function flushUnits() {
  if (unitsFlushT) { clearTimeout(unitsFlushT); unitsFlushT = null; }
  if (!unitsDirty) return;
  unitsDirty = false;
  try { writeFileAtomic(UNITSF, JSON.stringify(unitsDoc)); } catch (e) { console.error('units save failed:', e.message); }
}
app.get('/api/units', (_req, res) => {
  cors(res);
  res.set('Cache-Control', 'no-store');
  res.json({ rev: unitsDoc.rev, ts: unitsDoc.ts, units: unitsDoc.units, masterAlive: masterAlive(), pending: cmdQueue.length, sched: true });
});
app.put('/api/units', express.json({ limit: '2mb' }), (req, res) => {
  cors(res);
  const b = req.body || {};
  if (!Array.isArray(b.units) || b.units.length > 512) return res.status(400).json({ err: 'units must be a list' });
  if (typeof b.base === 'number' && b.base !== unitsDoc.rev) {
    return res.status(409).json({ conflict: true, rev: unitsDoc.rev, ts: unitsDoc.ts, units: unitsDoc.units });
  }
  if (b.master) masterAt = Date.now();
  unitsDoc = { rev: unitsDoc.rev + 1, ts: Date.now(), units: b.units };
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
  const now = Date.now(), out = cmdQueue.filter(c => now - c.ts < CMD_TTL);
  cmdQueue = [];
  res.json({ cmds: out });
});

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

const server = http.createServer(app);

// One serial consumer at a time — the bus is a single physical port (shared by http AND https).
let busy = false, lastScreenLeft = 0, busMaster = null;

// USB adapters don't always come back with the same name after a replug or reboot (ttyUSB0 can
// become ttyUSB1). If the configured device is gone and exactly ONE USB serial adapter is plugged
// in, use that one instead of failing until someone edits the config.
function resolveSerial() {
  const want = readConfig().serial;
  try { if (fs.existsSync(want)) return want; } catch (_) {}
  try {
    const dir = '/dev/serial/by-id';
    const ids = fs.readdirSync(dir);
    if (ids.length === 1) return fs.realpathSync(path.join(dir, ids[0]));
  } catch (_) {}
  return want;
}

// The same bridge is attached to the plain-http server and, when enabled, the https one (wss://).
function attachBus(srv) {
 const wss = new WebSocketServer({ server: srv, path: '/bus',
   verifyClient: (info) => sameOrigin(info.req) });          // only pages this appliance served may drive the bus
 // Heartbeat: a laptop that went to sleep or dropped off Wi-Fi never sends a close, and used to
 // leave the serial port marked "in use" until the service was restarted. Ping every 15 s and drop
 // any screen that didn't answer the previous ping, which frees the port for the next one.
 const beat = setInterval(() => {
   for (const ws of wss.clients) {
     if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} continue; }
     ws.isAlive = false; try { ws.ping(); } catch (_) {}
   }
 }, 15000);
 wss.on('close', () => clearInterval(beat));
 wss.on('connection', async (ws, req) => {
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  if (busMaster && busMaster.state.active) { try { await busMaster.stop(); } catch (_) {} }   // a dashboard wants the adapter: the controller's own loop lets go
  if (ws.readyState !== 1) return;
  if (busy) { try { ws.send(JSON.stringify({ err: 'serial already in use by another session' })); } catch (_) {} ws.close(); return; }
  const u = new URL(req.url, 'http://x');
  const serial = resolveSerial();                             // read fresh: wizard changes apply here
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
  let opened = false;
  port.on('open',  () => { opened = true; busRx.active = true; try { ws.send(JSON.stringify({ ok: true, port: serial, baud })); } catch (_) {} });
  port.on('error', (e) => {
    try { ws.send(JSON.stringify({ err: opened ? e.message : ('could not open the adapter at ' + serial + ' — ' + e.message) })); } catch (_) {}
    if (!opened) { try { ws.close(); } catch (_) {} }           // open failed: release the port flag right away
  });
  // adapter unplugged (or the port closed under us): tell the screen and free the port
  port.on('close', () => { if (ws.readyState === 1) { try { ws.send(JSON.stringify({ err: 'the adapter was disconnected' })); } catch (_) {} try { ws.close(); } catch (_) {} } });
  port.on('data',  (buf) => { busRx.bytes += buf.length; busRx.last = Date.now(); if (ws.readyState === 1) ws.send(buf); }); // bytes -> browser (binary)
  ws.on('message', (msg, isBinary) => { if (isBinary && port.writable) port.write(Buffer.from(msg)); }); // browser -> bytes

  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; busy = false; busRx.active = false; lastScreenLeft = Date.now(); try { if (port.isOpen) port.close(() => {}); } catch (_) {} };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
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
  try { fs.writeFileSync(MASTERF, (req.body && req.body.on) ? '1\n' : '0\n'); if (!(req.body && req.body.on) && busMaster) busMaster.stop(); res.json({ ok: true, on: masterMode() }); }
  catch (e) { res.status(500).json({ err: e.message }); } });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// Put frames on the bus ourselves: open the adapter, send each frame three times, close it.
async function schedTransmit(frames) {
  if (busy || !frames.length) return false;
  busy = true;
  let port = null;
  try {
    port = await new Promise((resolve, reject) => {
      const sp = new SerialPort({ path: resolveSerial(), baudRate: 4800, parity: 'none', stopBits: 1, dataBits: 8 }, (err) => err ? reject(err) : resolve(sp));
    });
    port.on('error', () => {});
    await wait(300);
    for (const f of frames) {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve, reject) => port.write(Buffer.from(f), (e) => e ? reject(e) : port.drain((e2) => e2 ? reject(e2) : resolve())));
        await wait(350);                                         // leave room for the outdoor unit's 16-byte reply
      }
      await wait(250);
    }
    return true;
  } finally {
    try { if (port && port.isOpen) await new Promise(r => port.close(() => r())); } catch (_) {}
    busy = false;
  }
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
app.get('/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache').type('application/javascript').send(SW_JS); });
app.get('/api/push', (req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ key: push.publicKey(), devices: push.count(), subscribed: req.query.endpoint ? push.has(String(req.query.endpoint)) : undefined }); });
app.post('/api/push/subscribe', (req, res) => { cors(res); const b = req.body || {}; if (!push.subscribe(b.subscription, b.user, b.kinds)) return res.status(400).json({ err: 'bad subscription' }); res.json({ ok: true, devices: push.count() }); });
app.post('/api/push/unsubscribe', (req, res) => { cors(res); push.unsubscribe(String((req.body || {}).endpoint || '')); res.json({ ok: true, devices: push.count() }); });
app.post('/api/push/test', async (req, res) => { cors(res); const ep = String((req.body || {}).endpoint || ''); if (!ep || !push.has(ep)) return res.status(400).json({ err: 'this device is not subscribed' });
  const cfg = readJsonSafe(APPCFG) || {}; const site = (cfg.site && cfg.site.name) || readConfig().name || 'Cortex';
  res.json(await push.send({ title: site, body: 'Test notification from Cortex. Alerts will look like this.', tag: 'test', url: '/' }, 'test', ep)); });
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
    const what = ev.kind === 'silent' ? 'stopped responding' : ('error ' + ev.code);
    alertOut(ev.kind === 'silent' ? 'silent' : 'fault', `${ev.kind === 'odu' ? 'Outdoor unit' : (ev.name || 'Unit')} 0x${ev.addr.toString(16).toUpperCase()} ${what}`, ev, '/#events');
  } });
app.post('/api/odu', (req, res) => { cors(res);                // pages read by the dashboard that holds the adapter
  const pages = (req.body && Array.isArray(req.body.pages)) ? req.body.pages.slice(0, 16) : [];
  for (const h of pages) if (typeof h === 'string' && /^[0-9a-f]{128}$/i.test(h)) recorder.onOdu(Buffer.from(h, 'hex'));
  res.json({ ok: true }); });
app.get('/api/odu', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store'); res.json({ odu: recorder.oduState(), poller: pollerInfo() }); });
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
function patchUnits(patches) {
  if (!patches || !patches.length) return;
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
  openPort: () => new Promise((resolve, reject) => { const sp = new SerialPort({ path: resolveSerial(), baudRate: 4800, parity: 'none', stopBits: 1, dataBits: 8 }, (err) => err ? reject(err) : resolve(sp)); }),
  getUnits: () => unitsDoc.units,
  patchUnits,
  drain: () => { const now = Date.now(), out = cmdQueue.filter(c => now - c.ts < CMD_TTL); cmdQueue = []; return out; },
  oduAddrs: () => { const c = readJsonSafe(APPCFG) || {}; return Array.isArray(c.oduAddrs) ? c.oduAddrs.filter(a => Number.isInteger(a) && a >= 0 && a < 0xFF) : []; },
  onOdu: (f) => recorder.onOdu(f),
  onPass: () => { histSample(); recorder.sample(unitsDoc.units); },
  onBytes: (n) => { busRx.bytes += n; busRx.last = Date.now(); },
  onEnd: () => { busy = false; busRx.active = false; pollerEndedAt = Date.now(); },
  log: (t) => console.log('busmaster:', t),
});
function pollerInfo() { const S = busMaster.state; return { active: S.active, alive: busMaster.alive(), passMs: S.passMs, lastPassAt: S.lastPassAt, passes: S.passes, error: S.error, masterMode: masterMode() }; }
let pollerEndedAt = 0;
setInterval(() => {                                           // supervisor: take the bus when it is ours and nobody else has it
  if (busMaster.state.active || busy || !masterMode()) return;
  if (!unitsDoc.units.length || Date.now() - lastScreenLeft < 15000) return;
  if (busMaster.state.error && Date.now() - pollerEndedAt < 60000) return;      // adapter missing or failing: try again in a minute, not every 10 s   // give a reloading dashboard a moment to come back first
  busy = true; busRx.active = true; busMaster.start();
}, 10000);
setInterval(() => { schedRunner.tick().catch(e => console.error('schedule tick failed:', e && e.message)); }, 20000);
app.get('/api/sched', (_req, res) => { cors(res); res.set('Cache-Control', 'no-store');
  res.json({ server: true, masterMode: masterMode(), masterAlive: masterAlive(), history: schedRunner.history }); });

server.listen(PORT, () => console.log(`Cortex appliance listening on :${PORT}  (serial ${resolveSerial()})`));

// Save the latest unit readings before the service stops (an update or a reboot), and never let a
// stray promise rejection take the whole controller down.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { flushUnits(); } catch (_) {} try { recorder.flush(); } catch (_) {} process.exit(0); });
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e && e.message ? e.message : e));

// --- optional HTTPS -------------------------------------------------------------
// OPT-IN and ADDITIVE. Nothing here can take the plain-http listener above down: it is already
// started, there is no redirect, and every failure below is caught, logged and reported in
// /api/device (-> Device health) instead of thrown. Turn it on with CORTEX_HTTPS=1 in
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
    try {
      const x = new crypto.X509Certificate(cert);
      httpsState.cert = { subject: String(x.subject || '').replace(/\n/g, ', '), validTo: new Date(x.validTo).toISOString(), selfSigned: x.issuer === x.subject };
    } catch (_) {}
    const tls = https.createServer({ cert, key }, app);
    attachBus(tls);
    tls.on('error', (e) => { httpsState.active = false; httpsState.error = e.message; console.error('HTTPS disabled (http still serving):', e.message); });
    tls.listen(httpsState.port, () => { httpsState.active = true; httpsState.error = null; console.log(`Cortex appliance also listening on https :${httpsState.port}`); });
  } catch (e) {
    httpsState.active = false;
    httpsState.error = (e.code === 'ENOENT' && /openssl/.test(String(e.path || e.message))) ? 'no certificate, and openssl is not installed to make one'
      : (e.code === 'ENOENT' ? 'certificate or key file missing' : e.message);
    console.error('HTTPS not started (http still serving):', httpsState.error);
  }
}
startHttps();
