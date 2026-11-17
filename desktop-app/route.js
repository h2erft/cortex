'use strict';
/* Which address to use for a controller: the building network when this PC is on it, the secure
 * (Tailscale) address when it is not.
 *
 * A saved controller is { url, name, id, local: [..], remote }. `url` is the address the person picked.
 * `local` and `remote` are learned from the controller's own /health answer, so a controller found on
 * the office network also knows its secure address, and one added by its secure address also knows its
 * office address. Before switching, the answer at the other address must be the SAME controller (its id,
 * or its name on controllers too old to have an id): at home, 192.168.1.50 can be somebody's printer.
 * Plain Node; tested by tests/desktop-app.test.js.
 */
const D = require('./discover');
const hostOf = (base) => { try { return new URL(base).hostname; } catch (_) { return ''; } };
/* On the building network: plain http to a private address, cortex.local, or a bare machine name. */
function isLocal(base) { const h = hostOf(base); if (!/^http:\/\//i.test(String(base)) || !h) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return D.isPrivate(h) && +h.split('.')[0] !== 100;
  return /\.local$/i.test(h) || !h.includes('.'); }
const uniq = (a) => [...new Set(a.filter(Boolean))];
/* Fold what a controller says about itself into its saved entry. Returns true when something changed. */
function learn(entry, hit, via) {
  if (!entry || !hit) return false; const before = JSON.stringify(entry);
  if (hit.id) entry.id = hit.id; if (hit.name) entry.name = hit.name;
  const local = (hit.lan || []).map(ip => 'http://' + ip + (hit.port80 ? '' : ':' + hit.port));
  if (via && isLocal(via)) local.unshift(via);                       // the address that just worked comes first
  if (local.length) entry.local = uniq(local.concat(entry.local || [])).filter(u => D.cleanAddress(u) === u && isLocal(u)).slice(0, 4);
  const h = hit.https;
  if (h && h.trusted && typeof h.name === 'string' && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(h.name) && +h.port > 0) entry.remote = 'https://' + h.name.toLowerCase() + (+h.port === 443 ? '' : ':' + (+h.port));
  return JSON.stringify(entry) !== before;
}
/* Every address worth trying, building network first. */
function candidates(entry) { if (!entry) return [];
  const all = uniq([entry.url].concat(entry.local || [], [entry.remote]));
  return all.filter(isLocal).concat(all.filter(u => !isLocal(u))); }
function same(entry, hit) { if (!entry || !hit) return false; if (entry.id && hit.id) return entry.id === hit.id; return !!entry.name && entry.name === hit.name; }
/* choose(entry, probe) -> { base, hit, via: 'local' | 'remote' } or null.  probe(base, ms) -> hit or null.
   All addresses are asked at once; the first one IN ORDER that is this controller wins, so the building
   network is preferred whenever it answers. `fresh` (a controller just picked by hand) skips the identity check
   for its own url. */
async function choose(entry, probe, o) {
  const list = candidates(entry), tries = list.map(b => Promise.resolve(probe(b, isLocal(b) ? (o && o.localMs) || 2000 : (o && o.remoteMs) || 6000)).catch(() => null));
  for (let i = 0; i < list.length; i++) { const hit = await tries[i]; if (!hit) continue;
    if (!entry.id && !entry.name) return { base: list[i], hit, via: isLocal(list[i]) ? 'local' : 'remote' };
    if (same(entry, hit)) return { base: list[i], hit, via: isLocal(list[i]) ? 'local' : 'remote' }; }
  return null;
}
/* The two links a phone can use. */
function phoneLinks(entry) { if (!entry) return { remote: null, local: null }; const c = candidates(entry);
  return { remote: entry.remote || c.find(u => /^https:/i.test(u)) || null, local: c.find(u => isLocal(u) && /^\d/.test(hostOf(u))) || c.find(isLocal) || null }; }
module.exports = { isLocal, learn, candidates, same, choose, phoneLinks };
