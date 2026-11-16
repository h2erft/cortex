/*
 * Cortex recorder — keeps the evidence.
 *
 *  - a rolling buffer of the last ~12 minutes of every unit's readings and every outdoor unit's raw
 *    monitor pages (one sample about every 15 s);
 *  - when a fault appears (an indoor unit's error code, an outdoor unit's error, or a unit that stops
 *    answering) an EVENT is written with the 10 minutes that led up to it, then the 5 minutes after;
 *    the event is closed when the fault clears. Events are kept 30 days;
 *  - outdoor-unit trend log: raw monitor pages every 5 minutes (history/odu-<date>.ndjson), 35 days.
 *
 * Outdoor pages are stored RAW (hex). The dashboard decodes them with its lookup tables, so a better
 * table later re-reads old data correctly.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SAMPLE_EVERY = 15000, RING_MS = 12 * 60000, PRE_MS = 10 * 60000, POST_MS = 5 * 60000;
const EVENT_KEEP_DAYS = 30, ODU_EVERY = 5 * 60000, ODU_KEEP_DAYS = 35, MAX_EVENTS = 600;
const hex = (f) => Buffer.from(f).toString('hex');

function unitRow(u) {            // compact: [addr, on, mode, setC, roomF, pipeInF, pipeOutF, eev, code, offline, fan]
  const set = (u.mode === 'heat' ? u.heatC : u.coolC);
  return [u.addr, u.on ? 1 : 0, u.mode || '', typeof set === 'number' ? set : null, u.room == null ? null : u.room,
    u.pipeIn == null ? null : u.pipeIn, u.pipeOut == null ? null : u.pipeOut, u.eev == null ? null : u.eev,
    (u.err && u.code) ? String(u.code) : 0, u.offline ? 1 : 0, u.fan || ''];
}

function createRecorder(opts) {
  const DATA = opts.dataDir, EVDIR = path.join(DATA, 'events'), HIST = path.join(DATA, 'history'), INDEX = path.join(EVDIR, 'index.json');
  const now = opts.now || (() => Date.now());
  const odu = new Map();                        // addr -> { pages: {page: {hex, at}}, at }
  let ring = [], lastSample = 0, lastOduLog = 0, lastPrune = 0;
  const started = { units: new Set(), odu: new Set() };   // addresses already reconciled since start
  let prev = null;                              // { units: Map(addr -> {code, offline}), odu: Map(addr -> err) }
  let index = (() => { try { const j = JSON.parse(fs.readFileSync(INDEX, 'utf8')); return Array.isArray(j) ? j : []; } catch (_) { return []; } })();
  const open = new Map();                       // event id -> { doc, until }
  /* What lives only in memory is written to disk when the controller stops (an update restarts it) and
     every few minutes, then read back at start: the last outdoor pages, with their real read times, and
     the last ten minutes of samples that a new fault's "before" data comes from. */
  const STATE = path.join(DATA, 'recorder-state.json'); let lastState = 0;
  function saveState() { try { fs.mkdirSync(DATA, { recursive: true }); const o = {}; for (const [a, v] of odu) o[a] = v;
    fs.writeFileSync(STATE + '.tmp', JSON.stringify({ at: now(), odu: o, ring })); fs.renameSync(STATE + '.tmp', STATE); } catch (e) { if (opts.log) opts.log('state save failed: ' + e.message); } }
  try { const j = JSON.parse(fs.readFileSync(STATE, 'utf8')), t = now();
    for (const a of Object.keys(j.odu || {})) { const v = j.odu[a]; if (v && v.pages && typeof v.pages === 'object') odu.set(+a, { pages: v.pages, at: +v.at || 0 }); }
    if (Array.isArray(j.ring)) ring = j.ring.filter(x => x && typeof x.t === 'number' && x.t <= t && t - x.t <= RING_MS);
  } catch (_) {}
  const openFor = (kind, addr) => index.find(m => !m.cleared && m.kind === kind && m.addr === addr);
  /* First look at a unit or outdoor unit since start: bring the fault list in line with what is true now.
     Without this a fault that cleared while the controller was restarting stayed "active" for ever, and
     one that appeared during the restart was never recorded. */
  function reconcileUnit(a, c, t) {
    const e = openFor('unit', a); if (e && e.code !== c.code) clearEvents('unit', a, t);
    if (c.code && !(e && e.code === c.code)) openEvent('unit', a, c.code, c.name, t);
    const q = openFor('silent', a); if (q && !c.offline) clearEvents('silent', a, t); if (!q && c.offline) openEvent('silent', a, null, c.name, t);
  }
  function reconcileOdu(a, err, t) {
    const code = err ? 'CH' + err : null, e = openFor('odu', a); if (e && e.code !== code) clearEvents('odu', a, t);
    if (code && !(e && e.code === code)) openEvent('odu', a, code, 'Outdoor unit', t);
  }
  const saveIndex = () => { try { fs.mkdirSync(EVDIR, { recursive: true }); fs.writeFileSync(INDEX + '.tmp', JSON.stringify(index)); fs.renameSync(INDEX + '.tmp', INDEX); } catch (e) { if (opts.log) opts.log('event index save failed: ' + e.message); } };
  const saveDoc = (doc) => { try { fs.mkdirSync(EVDIR, { recursive: true }); fs.writeFileSync(path.join(EVDIR, doc.id + '.json'), JSON.stringify(doc)); } catch (e) { if (opts.log) opts.log('event save failed: ' + e.message); } };

  function onOdu(frame) {                        // one 64-byte monitor page (from the controller's loop or pushed by a dashboard)
    const f = Array.from(frame); if (f.length !== 64) return;
    let o = odu.get(f[4]); if (!o) { o = { pages: {}, at: 0 }; odu.set(f[4], o); }
    o.pages[f[5]] = { hex: hex(f), at: now() }; o.at = now();
  }
  function oduSnapshot(maxAge) {
    const out = {}, t = now();
    for (const [a, o] of odu) { const pg = {}; for (const k of Object.keys(o.pages)) if (!maxAge || t - o.pages[k].at < maxAge) pg[k] = o.pages[k].hex; if (Object.keys(pg).length) out[a] = pg; }
    return out;
  }
  function openEvent(kind, addr, code, name, t) {
    const id = new Date(t).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + kind[0] + addr.toString(16).padStart(2, '0');
    const meta = { id, at: t, kind, addr, code: code || null, name: name || '', cleared: 0 };
    const doc = Object.assign({}, meta, { pre: ring.filter(s => t - s.t <= PRE_MS), post: [] });
    index.unshift(meta); if (index.length > MAX_EVENTS) index.length = MAX_EVENTS;
    open.set(id, { doc, until: t + POST_MS });
    saveDoc(doc); saveIndex();
    if (opts.notify) { try { opts.notify(meta); } catch (_) {} }
    return meta;
  }
  function clearEvents(kind, addr, t) {
    let ch = false;
    for (const m of index) if (!m.cleared && m.kind === kind && m.addr === addr) { m.cleared = t; ch = true; const o = open.get(m.id); if (o) o.doc.cleared = t;
      else { try { const p = path.join(EVDIR, m.id + '.json'), d = JSON.parse(fs.readFileSync(p, 'utf8')); d.cleared = t; fs.writeFileSync(p, JSON.stringify(d)); } catch (_) {} } }
    if (ch) saveIndex();
  }
  /* Call whenever fresh unit readings exist. Takes a sample at most every SAMPLE_EVERY. */
  function sample(units, force) {
    const t = now(); if (!force && t - lastSample < SAMPLE_EVERY) return false;
    lastSample = t;
    const live = (units || []).filter(u => u && typeof u.addr === 'number');
    const s = { t, u: live.map(unitRow), o: oduSnapshot(3 * 60000) };
    // --- fault edges (compared with the previous sample) ---
    const cur = { units: new Map(live.map(u => [u.addr, { code: (u.err && u.code) ? String(u.code) : null, offline: !!u.offline, name: u.label || u.name || '' }])), odu: new Map() };
    for (const a of Object.keys(s.o)) { const p0 = s.o[a]['0']; if (p0) cur.odu.set(+a, parseInt(p0.substr(20, 2), 16)); }   // main page byte 10 = error
    const seen = prev || { units: new Map(), odu: new Map() };
    for (const [a, c] of cur.units) { const p = seen.units.get(a); if (!p) { if (!started.units.has(a)) { started.units.add(a); reconcileUnit(a, c, t); } continue; }
      if (c.code && c.code !== p.code) openEvent('unit', a, c.code, c.name, t);
      if (!c.code && p.code) clearEvents('unit', a, t);
      if (c.offline && !p.offline) openEvent('silent', a, null, c.name, t);
      if (!c.offline && p.offline) clearEvents('silent', a, t); }
    for (const [a, e] of cur.odu) { const p = seen.odu.get(a); if (p === undefined) { if (!started.odu.has(a)) { started.odu.add(a); reconcileOdu(a, e, t); } continue; }
      if (e && e !== p) openEvent('odu', a, 'CH' + e, 'Outdoor unit', t);
      if (!e && p) clearEvents('odu', a, t); }
    if (prev) for (const [a, p] of prev.odu) if (!cur.odu.has(a)) cur.odu.set(a, p);      // outdoor page went stale for a moment: remember its last error so its return is not a "new" fault
    prev = cur;
    ring.push(s); while (ring.length && t - ring[0].t > RING_MS) ring.shift();
    // --- keep recording after a fault, then finish the file ---
    for (const [id, o] of open) { if (t > o.doc.at) o.doc.post.push(s); if (t >= o.until) { saveDoc(o.doc); open.delete(id); } }
    // --- outdoor trend log ---
    if (t - lastOduLog >= ODU_EVERY && Object.keys(s.o).length) { lastOduLog = t;
      try { fs.mkdirSync(HIST, { recursive: true }); fs.appendFileSync(path.join(HIST, 'odu-' + new Date(t).toISOString().slice(0, 10) + '.ndjson'), JSON.stringify({ t, o: s.o }) + '\n'); } catch (e) { if (opts.log) opts.log('outdoor trend append failed: ' + e.message); } }
    if (t - lastPrune > 6 * 3600000) { lastPrune = t; prune(t); }
    if (t - lastState > 5 * 60000) { lastState = t; saveState(); }
    return true;
  }
  function prune(t) {
    const cut = t - EVENT_KEEP_DAYS * 86400000, old = index.filter(m => m.at < cut);
    if (old.length) { index = index.filter(m => m.at >= cut); for (const m of old) { try { fs.unlinkSync(path.join(EVDIR, m.id + '.json')); } catch (_) {} } saveIndex(); }
    const day = new Date(t - ODU_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    try { for (const f of fs.readdirSync(HIST)) { const m = /^odu-(\d{4}-\d\d-\d\d)\.ndjson$/.exec(f); if (m && m[1] < day) { try { fs.unlinkSync(path.join(HIST, f)); } catch (_) {} } } } catch (_) {}
  }
  function oduState() { const out = {}; for (const [a, o] of odu) out[a] = { at: o.at, pages: o.pages }; return out; }
  function events() { return index; }
  function event(id) {
    if (!/^[0-9a-z-]{8,40}$/.test(String(id))) return null;
    const o = open.get(id); if (o) return o.doc;
    try { return JSON.parse(fs.readFileSync(path.join(EVDIR, id + '.json'), 'utf8')); } catch (_) { return null; }
  }
  function oduHistory(addr, days) {
    const t = now(), from = t - days * 86400000, rows = [];
    for (let d = days + 1; d >= 0; d--) {
      let txt; try { txt = fs.readFileSync(path.join(HIST, 'odu-' + new Date(t - d * 86400000).toISOString().slice(0, 10) + '.ndjson'), 'utf8'); } catch (_) { continue; }
      for (const line of txt.split('\n')) { if (!line) continue; let o; try { o = JSON.parse(line); } catch (_) { continue; }
        if (o && o.t >= from && o.o && o.o[addr]) rows.push([o.t, o.o[addr]]); }
    }
    return rows;
  }
  function flush() { for (const o of open.values()) saveDoc(o.doc); saveState(); }
  /* Start over without a factory reset. what: { odu, events, history } - each one optional.
     Always forgets the live picture (previous sample, pre-fault buffer) so nothing old is compared with new units. */
  function clear(what) {
    what = what || {}; const done = [];
    ring = []; prev = null; started.units.clear(); started.odu.clear(); lastSample = 0;
    if (what.odu) { odu.clear(); lastOduLog = 0; done.push('odu'); }
    if (what.events) { open.clear(); index.length = 0; try { for (const f of fs.readdirSync(EVDIR)) fs.rmSync(path.join(EVDIR, f), { force: true }); } catch (_) {} done.push('events'); }
    if (what.history) { try { for (const f of fs.readdirSync(HIST)) if (/\.ndjson$/.test(f)) fs.rmSync(path.join(HIST, f), { force: true }); } catch (_) {} done.push('history'); }
    saveState(); return done;
  }
  return { onOdu, oduSnapshot, oduState, sample, events, event, oduHistory, flush, clear, ring: () => ring };
}

module.exports = { createRecorder, unitRow, PRE_MS, POST_MS };
