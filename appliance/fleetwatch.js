/* Fleet watch: lets Cortex Command raise alerts while nobody has it open.
 *
 * Command is a page; a page cannot do anything once it is closed. A controller is always on. So the
 * controller Command was opened from keeps Command's list of buildings and looks at each one about once
 * a minute, with the same three read-only requests Command itself makes (/health, /api/units,
 * /api/diag). When a building's state changes it hands a short message to notify(), which the server
 * sends as a push notification to devices that asked for fleet alerts.
 *
 * It only reads. It never sends a command to another controller, and it does nothing at all while no
 * device is subscribed (opts.wanted() is false).
 */
const fs = require('fs'), path = require('path');

const EVERY = 60000;          // one look per building per minute
const FAILS = 2;              // a building must miss two looks in a row before it is called offline
const STALE = 10 * 60000;     // after a gap this long, the next look only records state (no alerts for old news)

function cleanUrl(u) {
  u = String(u || '').trim(); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) { if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return ''; u = 'http://' + u; }
  try { const x = new URL(u); if (x.protocol !== 'http:' && x.protocol !== 'https:') return ''; return x.origin; } catch (_) { return ''; }
}
function cleanSites(list) {
  const out = [], seen = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    if (!s || typeof s !== 'object') continue;
    const id = String(s.id || '').slice(0, 40), url = cleanUrl(s.url); if (!id || !url || seen.has(id)) continue;
    seen.add(id); out.push({ id, name: String(s.name || id).slice(0, 80), url }); if (out.length >= 50) break;
  }
  return out;
}

function createFleetWatch(opts) {
  const FILE = path.join(opts.dataDir, 'fleet.json'), now = opts.now || Date.now, log = opts.log || (() => {});
  const doFetch = opts.fetch || fetch, notify = opts.notify || (() => {}), wanted = opts.wanted || (() => true);
  let st; try { st = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { st = null; }
  if (!st || !Array.isArray(st.sites)) st = { sites: [], state: {} };
  if (!st.state || typeof st.state !== 'object') st.state = {};
  let timer = null, busy = false, lastRun = 0;
  // What to tell the person about (chosen in Command's settings). Until Command says otherwise: offline after 15 minutes
  // and units in error; advisories and "a unit stopped answering" only when asked for.
  const O = () => Object.assign({ offlineMin: 15, offline: true, error: true, silent: false, advisory: false }, st.opts || {});
  function save() { try { fs.mkdirSync(opts.dataDir, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st)); fs.renameSync(tmp, FILE); } catch (e) { log('fleet: could not save: ' + e.message); } }
  async function getJ(url) { const r = await doFetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }

  /* One look at one building. Returns { up, err, silent, adv } or { up:false }. */
  async function look(s) {
    try { const h = await getJ(s.url + '/health'); if (!h || !h.ok) return { up: false }; } catch (_) { return { up: false }; }
    const o = { up: true, err: null, silent: null, adv: null };
    try { const u = (await getJ(s.url + '/api/units')).units || []; o.err = u.filter(x => x.err || x.code).length; o.silent = u.filter(x => x.offline).length; } catch (_) {}
    try { const d = await getJ(s.url + '/api/diag'); o.adv = (d.advisories || []).filter(a => !a.cleared).length; } catch (_) {}
    return o;
  }
  /* Compare with what was seen last time and say what is new. A count that could not be read keeps its old value. */
  function changes(s, prev, cur) {
    const msgs = [], p = prev || {}, next = Object.assign({}, p, { at: now() });
    if (!cur.up) {
      next.fails = (p.fails || 0) + 1;
      // Told only once it has BEEN offline for the chosen time, so a restart at the site or a short drop says nothing.
      if (next.fails >= FAILS && p.online !== false) { next.online = false; next.offAt = now(); next.offTell = p.online === true; next.offTold = false; }
      if (next.online === false && next.offTell && !next.offTold && now() - (next.offAt || now()) >= O().offlineMin * 60000) { next.offTold = true;
        if (O().offline) msgs.push(O().offlineMin ? 'has been offline for ' + (O().offlineMin >= 60 ? Math.round(O().offlineMin / 6) / 10 + ' h' : O().offlineMin + ' min') + ' (the controller is not answering)' : 'went offline (the controller is not answering)'); }
      return { next, msgs };
    }
    next.fails = 0; next.online = true;
    if (p.online === false && p.offTold && O().offline) msgs.push('is back online');          // only if its going offline was reported
    delete next.offAt; delete next.offTell; delete next.offTold;
    for (const k of ['err', 'silent', 'adv']) if (cur[k] != null) next[k] = cur[k];
    if (prev && p.online !== false) {
      if (O().error && cur.err != null && cur.err > (p.err || 0)) msgs.push(cur.err + ' unit' + (cur.err > 1 ? 's' : '') + ' in error');
      if (O().silent && cur.silent != null && cur.silent > (p.silent || 0)) msgs.push(cur.silent > 1 ? cur.silent + ' units are not answering' : 'a unit stopped answering');
      if (O().advisory && cur.adv != null && cur.adv > (p.adv || 0)) msgs.push('new diagnosis advisory');
    }
    return { next, msgs };
  }
  async function run() {
    if (busy || !st.sites.length || !wanted()) return 0;
    busy = true; let sent = 0;
    try {
      const fresh = now() - lastRun > STALE && lastRun !== 0;      // long pause (nobody subscribed): do not report what happened meanwhile
      const looks = await Promise.all(st.sites.map(look));
      st.sites.forEach((s, i) => {
        const prev = fresh ? null : st.state[s.id], r = changes(s, prev, looks[i]);
        st.state[s.id] = r.next;
        if (r.msgs.length) { sent++; try { notify({ site: s, text: r.msgs.join('; ') }); } catch (e) { log('fleet: notify failed: ' + e.message); } }
      });
      lastRun = now(); save();
    } finally { busy = false; }
    return sent;
  }
  function setSites(list, o) {
    if (o && typeof o === 'object') st.opts = { offlineMin: Math.max(0, Math.min(1440, Number(o.offlineMin) || 0)), offline: o.offline !== false, error: o.error !== false, silent: o.silent === true, advisory: o.advisory === true };
    st.sites = cleanSites(list); const ids = new Set(st.sites.map(s => s.id));
    for (const k of Object.keys(st.state)) if (!ids.has(k)) delete st.state[k];
    save(); return st.sites.length;
  }
  return { run, setSites, opts: O, sites: () => st.sites.slice(), state: () => Object.assign({}, st.state),
    start() { if (!timer) { timer = setInterval(() => run().catch(e => log('fleet: ' + e.message)), EVERY); if (timer.unref) timer.unref(); } },
    stop() { if (timer) clearInterval(timer); timer = null; } };
}

module.exports = { createFleetWatch, cleanSites, cleanUrl, EVERY, FAILS };
