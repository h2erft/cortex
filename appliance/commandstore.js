'use strict';
/* Shared Cortex Command data.
 *
 * Cortex Command keeps its building list, technicians, access grants, notes and alert acknowledgements
 * in the browser or app it runs in. Turning on "sync" in Command stores one copy here, on a controller
 * the owner picks as home, so the office PC, a laptop and a phone all show the same thing.
 *
 * One document, one revision number. A save must say which revision it started from; if another
 * computer saved in between, the save is refused with the current copy so nothing is silently lost.
 *
 *   createCommandStore({ file, fs, now }) -> { get(), put(body) }
 */
const MAX_BYTES = 240 * 1024;

function cleanDoc(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (!Array.isArray(d.sites) || d.sites.length > 500) return null;
  const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
  const out = { sites: d.sites.filter(s => s && typeof s === 'object' && typeof s.id === 'string'), techs: arr(d.techs, 500), grants: arr(d.grants, 2000), audit: arr(d.audit, 200), acks: obj(d.acks), snooze: obj(d.snooze) };
  if (d.acct && typeof d.acct === 'object' && typeof d.acct.user === 'string' && typeof d.acct.passhash === 'string')
    out.acct = { user: d.acct.user.slice(0, 80), name: String(d.acct.name || '').slice(0, 80), passhash: d.acct.passhash.slice(0, 80) };   // never the recovery code
  return out;
}

function createCommandStore(opts) {
  const fs = opts.fs || require('fs'), now = opts.now || Date.now, file = opts.file;
  let cur = { rev: 0, ts: 0, doc: null };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j.rev === 'number' && j.doc) cur = { rev: j.rev, ts: j.ts || 0, doc: j.doc }; } catch (_) {}
  const get = () => ({ ok: true, rev: cur.rev, ts: cur.ts, doc: cur.doc });
  function put(b) {
    b = b || {};
    const doc = cleanDoc(b.doc);
    if (!doc) return { status: 400, body: { err: 'not a Cortex Command document' } };
    const text = JSON.stringify(doc);
    if (Buffer.byteLength(text) > MAX_BYTES) return { status: 413, body: { err: 'too large to sync (over 240 KB). Shorten service logs or notes.' } };
    if (typeof b.base === 'number' && b.base !== cur.rev) return { status: 409, body: { conflict: true, rev: cur.rev, ts: cur.ts, doc: cur.doc } };
    const next = { rev: cur.rev + 1, ts: now(), doc };
    try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, file); }
    catch (e) { return { status: 500, body: { err: 'could not save: ' + e.message } }; }
    cur = next;
    return { status: 200, body: { ok: true, rev: cur.rev, ts: cur.ts } };
  }
  return { get, put };
}
module.exports = { createCommandStore, cleanDoc, MAX_BYTES };
