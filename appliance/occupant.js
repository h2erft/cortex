'use strict';
/* Occupant view: a one-room page for the people who sit in the room (a condo owner, a tenant).
 *
 * Off unless an admin turns it on (appconfig.occupant.on). Each room is a link with a long random key;
 * whoever has the link can see that room's units and nudge them inside the limits the admin chose,
 * and nothing else. With the feature off, or with a key that is not on the list, every call answers 404
 * and says nothing about the site.
 *
 * This file only decides and validates. It never touches the bus: an accepted change is handed to
 * queue(), the same short-lived command queue every Cortex screen uses.
 *
 *   createOccupant({ getCfg, getUnits, queue, ready, now })
 *     getCfg()   -> the shared app config (or null)
 *     getUnits() -> current unit records
 *     queue(addr, state)  hand one command to whoever is running the bus
 *     ready()    -> true when something is running the bus and will pick the command up
 */
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HARD_LO = 16, HARD_HI = 30, GAP_MS = 1500;

function cleanRooms(list) {
  const out = [], seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== 'object' || !KEY_RE.test(String(r.key || '')) || seen.has(r.key)) continue;
    const addrs = [...new Set((Array.isArray(r.addrs) ? r.addrs : []).map(Number).filter(a => Number.isInteger(a) && a >= 0 && a <= 0xFE))].slice(0, 16);
    if (!addrs.length) continue;
    let lo = Number(r.loC), hi = Number(r.hiC);
    if (!isFinite(lo)) lo = 20; if (!isFinite(hi)) hi = 26;
    lo = Math.max(HARD_LO, Math.min(HARD_HI, Math.round(lo))); hi = Math.max(lo, Math.min(HARD_HI, Math.round(hi)));
    seen.add(r.key);
    out.push({ id: String(r.id || r.key.slice(0, 8)), key: r.key, name: String(r.name || 'Room').slice(0, 60), addrs, loC: lo, hiC: hi, power: r.power !== false, mode: r.mode === true });
  }
  return out;
}

function createOccupant(io) {
  const now = io.now || Date.now, last = new Map();
  const cfgOf = () => { const c = io.getCfg() || {}; const o = c.occupant; return (o && o.on === true) ? { cfg: c, rooms: cleanRooms(o.rooms) } : null; };
  const find = (key) => { const C = cfgOf(); if (!C || !KEY_RE.test(String(key || ''))) return null; const room = C.rooms.find(r => r.key === key); return room ? { cfg: C.cfg, room } : null; };
  const nameOf = (cfg, u) => { const m = cfg.unitMeta && cfg.unitMeta[u.name]; const l = String(u.label || '').trim(); return (m && m.alias) || ((!l || /^Addr 0x/i.test(l)) ? 'Unit ' + u.id : l); };
  const gone = { status: 404, body: { err: 'not available' } };

  function state(key) {
    const F = find(key); if (!F) return gone;
    const { cfg, room } = F, all = io.getUnits() || [];
    const units = room.addrs.map(a => all.find(u => u && u.addr === a)).filter(Boolean).map(u => {
      const heat = u.mode === 'heat', set = heat ? u.heatC : u.coolC;
      return { addr: u.addr, name: nameOf(cfg, u), on: !!u.on, mode: u.mode || 'cool', roomF: typeof u.room === 'number' ? u.room : null, setC: typeof set === 'number' ? set : null,
        offline: !!u.offline, fault: !!(u.err && u.code), fan: u.fan || null };
    });
    return { status: 200, body: { ok: true, name: room.name, site: (cfg.site && cfg.site.name) || '', unit: (cfg.site && cfg.site.unit) === 'C' ? 'C' : 'F', loC: room.loC, hiC: room.hiC, power: room.power, mode: room.mode, ready: !!io.ready(), units } };
  }

  function command(key, b) {
    const F = find(key); if (!F) return gone;
    const { room } = F; b = b || {};
    const t = now(); if (t - (last.get(key) || 0) < GAP_MS) return { status: 429, body: { err: 'One change at a time. Try again in a moment.' } };
    if (!io.ready()) return { status: 503, body: { err: 'The building controller is not connected to the equipment right now. Try again in a few minutes.' } };
    const st = {};
    if (typeof b.on === 'boolean') { if (!room.power) return { status: 403, body: { err: 'Turning the unit on or off is not allowed from this page.' } }; st.on = b.on; }
    if (b.setC != null) { const v = Number(b.setC); if (!isFinite(v)) return { status: 400, body: { err: 'bad temperature' } };
      const c = Math.max(room.loC, Math.min(room.hiC, Math.round(v * 2) / 2)); st.coolC = c; st.heatC = c; }
    if (b.mode != null) { if (!room.mode || !['cool', 'heat', 'fan', 'auto', 'dry'].includes(b.mode)) return { status: 403, body: { err: 'Changing the mode is not allowed from this page.' } }; st.mode = b.mode; }
    if (!Object.keys(st).length) return { status: 400, body: { err: 'nothing to change' } };
    let addrs = room.addrs;
    if (b.addr != null) { const a = Number(b.addr); if (!room.addrs.includes(a)) return { status: 403, body: { err: 'That unit is not part of this room.' } }; addrs = [a]; }
    const all = io.getUnits() || [], known = addrs.filter(a => all.some(u => u && u.addr === a && !u.offline));
    if (!known.length) return { status: 409, body: { err: 'The unit is not answering right now.' } };
    last.set(key, t);
    known.forEach(a => io.queue(a, Object.assign({}, st)));
    return { status: 200, body: { ok: true, sent: known.length, setC: st.coolC != null ? st.coolC : undefined } };
  }
  return { state, command };
}
module.exports = { createOccupant, cleanRooms, KEY_RE };
