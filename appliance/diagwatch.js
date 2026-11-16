/* Cortex — cycle diagnosis on the controller.
 *
 * The rules live in cortex.html (one copy, so the screen and the controller can never disagree).
 * This module lifts that block out of the page, runs it in a sandbox against the controller's own
 * unit list and the latest outdoor pages, and turns a finding that PERSISTS into an advisory:
 * it must be present on HOLD consecutive checks (about ten minutes) before it is raised, and absent
 * for the same number before it clears. Nothing here can stop the controller: every failure is
 * caught and reported through state().
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BEGIN = 'const ODU_T=', END = 'function oduDiagrams(';
const HOLD = 10, EVERY = 60000, FRESH = 4 * 60000, KEEP = 30 * 86400000, MAX = 400;

function loadRules(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8'), a = html.indexOf(BEGIN), b = html.indexOf(END, a);
  if (a < 0 || b < 0) throw new Error('diagnosis block not found in the dashboard file');
  const box = { units: [], settings: { unit: 'F' }, WEATHER: { live: false, now: null }, console,
    ue: (s) => String(s == null ? '' : s), dispName: (u) => u.name || ('0x' + Number(u.addr).toString(16).toUpperCase()),
    hx: (n) => '0x' + Number(n).toString(16).toUpperCase().padStart(2, '0'), tip: () => '', toast: () => {}, navigator: {}, location: { protocol: 'http:' },
    // the block has a few page-only statements at top level (timers, listeners); give them harmless stand-ins
    setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {}, clearTimeout: () => {}, fetch: () => Promise.reject(new Error('no network in the sandbox')),
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, matchMedia: () => ({ matches: false }) };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(html.slice(a, b) + '\n;globalThis.__dx={cycleDiagnose,sysHealth,oduUnits,ODU};', box, { timeout: 4000 });
  if (!box.__dx || typeof box.__dx.cycleDiagnose !== 'function') throw new Error('diagnosis block did not load');
  return box;
}

function createDiagWatch(opts) {
  const FILE = path.join(opts.dataDir, 'advisories.json'), now = opts.now || Date.now, log = opts.log || (() => {});
  let box = null, err = null, list = [], lastRun = 0, timer = null;
  const seen = new Map();                                  // key -> { hit, miss, f }
  const health = {};                                       // addr -> { score, at }
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(d)) list = d; } catch (_) {}
  try { box = loadRules(opts.htmlPath); } catch (e) { err = e.message; log('diagnosis disabled: ' + e.message); }
  function save() { try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, FILE); } catch (e) { log('could not save advisories: ' + e.message); } }
  function run() {
    if (!box) return; const t = now(); lastRun = t;
    let present = new Set(), changed = false;
    try {
      const odu = opts.getOdu() || {}; box.units = opts.getUnits() || []; box.__dx.ODU.clear();
      for (const k of Object.keys(odu)) { const o = odu[k], addr = Number(k); if (!o || t - o.at > FRESH) continue;
        const pages = {}; for (const p of Object.keys(o.pages || {})) { const h = o.pages[p]; const hs = typeof h === 'string' ? h : (h && typeof h.hex === 'string' ? h.hex : null); const f = hs ? [...Buffer.from(hs, 'hex')] : (h && h.f) || h; if (f && f.length === 64) pages[p] = { f, at: o.at }; }
        const entry = { addr, pages }; box.__dx.ODU.set(addr, entry);
        const d = box.__dx.cycleDiagnose(entry); const hs = box.__dx.sysHealth(entry); if (hs != null) health[addr] = { score: hs, at: t };
        for (const f of d.list) { const key = addr + ':' + f.id; present.add(key); const s = seen.get(key) || { hit: 0, miss: 0 }; s.hit++; s.miss = 0; s.f = f; s.addr = addr; seen.set(key, s); }
      }
    } catch (e) { err = e.message; log('diagnosis run failed: ' + e.message); return; }
    err = null;
    for (const [key, s] of seen) {
      if (!present.has(key)) { s.miss++; s.hit = 0; }
      const open = list.find(a => a.key === key && !a.cleared);
      if (s.hit >= HOLD && !open) {
        const strip = (h) => String(h).replace(/<[^>]+>/g, '');
        const a = { id: new Date(t).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + key.replace(/[^0-9a-z]/gi, ''), key, at: t, last: t, cleared: 0, addr: s.addr, who: s.f.who == null ? null : s.f.who,
          title: strip(s.f.title), lvl: s.f.lvl, hit: s.f.hit, total: s.f.total, signs: s.f.signs.filter(x => x.hit).map(x => strip(x.t) + (x.now ? ' (' + strip(x.now) + ')' : '')), what: strip(s.f.what), todo: strip(s.f.todo) };
        list.unshift(a); changed = true;
        if (opts.notify) { try { opts.notify(a); } catch (_) {} }
      } else if (open) {
        if (present.has(key)) { open.last = t; if (s.f.lvl === 'likely' && open.lvl !== 'likely') { open.lvl = 'likely'; changed = true; } open.hit = s.f.hit; }
        else if (s.miss >= HOLD) { open.cleared = t; changed = true; }
      }
      if (s.miss > HOLD * 3) seen.delete(key);
    }
    const n = list.length; list = list.filter(a => t - a.at < KEEP).slice(0, MAX); if (changed || list.length !== n) save();
  }
  function start() { if (!timer && box) { timer = setInterval(() => { try { run(); } catch (e) { err = e.message; } }, EVERY); if (timer.unref) timer.unref(); } }
  function clear() { list = []; seen.clear(); for (const k of Object.keys(health)) delete health[k]; save(); }
  return { run, start, clear, stop: () => { if (timer) clearInterval(timer); timer = null; }, list: () => list, health: () => health,
    state: () => ({ enabled: !!box, error: err, lastRun, holdChecks: HOLD, everyMs: EVERY }) };
}
module.exports = { createDiagWatch, loadRules, HOLD };
