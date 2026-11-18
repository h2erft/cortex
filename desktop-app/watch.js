'use strict';
/* What is worth telling someone about. Compares the last look at a controller with this one and returns
 * the notifications to raise. Read-only: everything comes from the controller's own /health, /api/units,
 * /api/events and /api/diag. Plain Node; tested by tests/desktop-app.test.js.
 */
const hex = (a) => '0x' + Number(a).toString(16).toUpperCase().padStart(2, '0');
function unitName(units, meta, addr) { const u = (units || []).find(x => x && x.addr === addr); if (!u) return 'Unit ' + hex(addr);
  const m = meta && meta[u.name], l = String(u.label || '').trim(); return (m && m.alias) || ((!l || /^Addr 0x/i.test(l)) ? 'Unit ' + (u.id != null ? u.id : hex(addr)) : l); }
/* A Rheem / Ruud alarm arrives as its full text; the code word at the front is enough for a notification. */
function tag(t) { const m = /\b[AST][ _-]?\d{3}(?:[ _-]?[OAFCSZ]\b)?/i.exec(String(t || '')); return m ? m[0].toUpperCase() : 'alarm'; }
/* raw answers -> a small picture of the site */
function snapshot(r) {
  if (!r || !r.health) return { up: false };
  const units = (r.units && r.units.units) || [], meta = r.meta || {};
  const ev = ((r.events && r.events.events) || []).filter(e => e && !e.cleared).map(e => ({ id: String(e.id != null ? e.id : e.kind + e.addr + '@' + e.at), kind: e.kind, code: e.brand ? tag(e.code) : (e.code || null), addr: e.addr,
    where: e.brand ? String(e.name || 'Rheem / Ruud system') : e.kind === 'odu' ? 'Outdoor unit ' + hex(e.addr) : unitName(units, meta, e.addr) }));
  const adv = ((r.diag && r.diag.advisories) || []).filter(a => a && !a.cleared).map(a => ({ id: String(a.key || a.id || a.title), title: String(a.title || ''), lvl: a.lvl }));
  return { up: true, name: r.health.name || 'Cortex', version: r.health.version, total: units.length, on: units.filter(u => u.on && !u.offline).length, errors: units.filter(u => (u.err || u.code) && !u.offline).length,
    silent: units.filter(u => u.offline).length, events: ev, adv };
}
/* prev, cur: snapshots; misses: how many looks in a row failed -> [{ title, body, kind }] */
function diff(prev, cur, misses, kinds) {
  const out = [], want = (k) => !kinds || kinds[k] !== false;
  if (!prev) return out;                                             // the first look only sets the baseline
  if (!cur.up) { if (prev.up && misses === 2 && want('offline')) out.push({ kind: 'offline', title: 'Cortex is not answering', body: 'The controller for ' + (prev.name || 'this building') + ' cannot be reached from this PC.' }); return out; }
  if (!prev.up) { if (prev.told && want('offline')) out.push({ kind: 'offline', title: 'Cortex is back', body: cur.name + ' is answering again.' }); return out; }   // back after an outage: baseline again, do not replay old faults
  const had = new Set(prev.events.map(e => e.id)), now = new Set(cur.events.map(e => e.id));
  const fresh = cur.events.filter(e => !had.has(e.id));
  const faults = fresh.filter(e => e.kind !== 'silent'), silent = fresh.filter(e => e.kind === 'silent');
  if (want('fault')) { if (faults.length > 3) out.push({ kind: 'fault', title: faults.length + ' new faults', body: faults.slice(0, 3).map(e => e.where + (e.code ? ' ' + e.code : '')).join(', ') + ' and ' + (faults.length - 3) + ' more.' });
    else faults.forEach(e => out.push({ kind: 'fault', title: e.where + ' has a fault' + (e.code ? ' (' + e.code + ')' : ''), body: 'Open Cortex to see what it means and what to check.' })); }
  if (want('silent')) { if (silent.length > 3) out.push({ kind: 'silent', title: silent.length + ' units stopped answering', body: silent.slice(0, 3).map(e => e.where).join(', ') + ' and ' + (silent.length - 3) + ' more.' });
    else silent.forEach(e => out.push({ kind: 'silent', title: e.where + ' stopped answering', body: 'The controller can no longer reach this unit.' })); }
  if (want('cleared')) { const gone = prev.events.filter(e => !now.has(e.id) && e.kind !== 'silent'); if (gone.length) out.push({ kind: 'cleared', title: gone.length === 1 ? gone[0].where + ' fault cleared' : gone.length + ' faults cleared', body: gone.length === 1 ? (gone[0].code || 'The fault') + ' is no longer active.' : gone.slice(0, 4).map(e => e.where).join(', ') }); }
  if (want('advisory')) { const hadA = new Set(prev.adv.map(a => a.id)); cur.adv.filter(a => !hadA.has(a.id)).forEach(a => out.push({ kind: 'advisory', title: (a.lvl === 'likely' ? 'Likely: ' : 'Possible: ') + a.title, body: 'Cortex noticed a pattern in the system readings. Open Cortex for the details.' })); }
  return out;
}
function tooltip(s) { if (!s || !s.up) return 'Cortex — not connected'; return 'Cortex — ' + s.name + '\n' + s.on + ' of ' + s.total + ' units on' + (s.errors ? ' · ' + s.errors + ' in error' : '') + (s.silent ? ' · ' + s.silent + ' not answering' : ''); }
module.exports = { snapshot, diff, tooltip, unitName };
