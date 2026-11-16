/*
 * Cortex schedule runner — runs on the appliance, so schedules fire with no browser open.
 *
 * Before 1.7.0-beta.2 schedules were evaluated by the dashboard tab that was connected to the
 * equipment; close the tab and nothing ran. This module evaluates the same schedule objects
 * (CFG.schedules in appconfig.json) on the controller itself, every 20 s:
 *   - a dashboard is connected and polling  -> the command is queued for it (same path as a
 *     command from a phone), so there is still exactly one writer on the bus;
 *   - nobody is connected                    -> the appliance opens the adapter itself, sends the
 *     command frames, and closes it again.
 * It only ever transmits when Cortex was left running as the bus master (the "master mode" flag
 * the dashboard sets when the poll loop starts and clears when someone stops it). A site where
 * Cortex is only listening next to a real LG central is never written to from here.
 *
 * Pure helpers are exported for tests (tests/scheduler.test.js); nothing in this file touches the
 * serial port — the caller passes a `transmit` function.
 */
'use strict';

const MODELO = { cool: 0, dry: 1, fan: 2, auto: 3, heat: 4 };
const FANHI = { low: 1, med: 2, high: 3, auto: 4 };
const GRACE_MIN = 10;                       // a run may start up to this many minutes late
const TREESEP = ' ▸ ';

function cksum(b) { let s = 0; for (let i = 0; i < 7; i++) s = (s + b[i]) & 0xff; return s ^ 0x55; }

/* The same cmd0 write the dashboard builds (cortex.html cmdBytesFor) — kept byte-identical; the
   test suite compares the two. */
function cmd0Bytes(u) {
  const seen5 = (u.d5 != null ? u.d5 : 0x33) & 0x7F;
  const fanN = FANHI[u.fan] != null ? FANHI[u.fan] : ((u.fanRaw != null ? u.fanRaw : (seen5 >> 4)) & 7);
  const modeN = MODELO[u.mode] != null ? MODELO[u.mode] : (seen5 & 0x07);
  const b5 = (fanN << 4) | (u.swing ? 0x08 : 0) | modeN | (u.filterReset === true ? 0x80 : 0);   // bit 7 = filter-sign reset, one-shot, only when explicitly asked
  let b0 = u.b0 || 0x80, b6;
  if ((b0 & 0x78) !== 0 || !(b0 & 0x80)) b0 = 0x80;
  const setC = (u.mode === 'heat' ? u.heatC : u.coolC);
  if (setC != null && isFinite(setC)) {
    const whole = Math.max(15, Math.min(30, Math.round(setC * 2) / 2)), intp = Math.floor(whole);
    b6 = Math.max(0, Math.min(15, intp - 15));
    b0 &= ~0x04;
    if (whole - intp >= 0.5 && intp < 30) b0 |= 0x04;
  } else {
    b6 = (u.d6 != null ? u.d6 : 0x06);
  }
  const b4 = (u.on ? 1 : 0) | 2 | (u.hardLock ? 0x04 : 0);
  const b = [b0, 0x00, 0xA0, u.addr & 0xFF, b4, b5, b6, 0]; b[7] = cksum(b); return b;
}

/* Wall-clock parts at the SITE, not on the controller (which usually runs in UTC). */
function localParts(now, tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
  } catch (_) {
    parts = new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now);
  }
  const g = (t) => (parts.find(p => p.type === t) || {}).value;
  const y = +g('year'), mo = +g('month'), d = +g('day');
  return { y, mo, d, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')),
    min: (+g('hour') % 24) * 60 + (+g('minute')), dim: new Date(y, mo, 0).getDate() };
}
function nthMatches(s, p) {
  const nth = s.nth || 'every';
  if (nth === 'every') return true;
  if (nth === 'last') return p.d + 7 > p.dim;
  return Math.floor((p.d - 1) / 7) + 1 === parseInt(nth, 10);
}
/* Returns the run key ("2026-11-16 07:00") when schedule s should run now, else null. */
function dueKey(s, now, tz) {
  if (!s || !s.enabled) return null;
  const m = /^(\d\d):(\d\d)$/.exec(s.time || ''); if (!m) return null;
  const p = localParts(now, tz), late = p.min - (+m[1] * 60 + +m[2]);
  if (late < 0 || late > GRACE_MIN) return null;
  if (!(Array.isArray(s.days) && s.days.includes(p.dow))) return null;
  if (!nthMatches(s, p)) return null;
  return p.y + '-' + String(p.mo).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') + ' ' + s.time;
}
const grpOf = (u) => (u.grp && String(u.grp).trim()) || 'Ungrouped';
const subOf = (u) => (u.subgrp && String(u.subgrp).trim()) || 'General';
function targets(s, units) {
  const t = s.target || {};
  if (t.type === 'all') return units.slice();
  if (t.type === 'unit') return units.filter(u => u.id === t.val);
  if (t.type === 'group') return units.filter(u => grpOf(u) === t.val);
  if (t.type === 'sub') return units.filter(u => grpOf(u) + TREESEP + subOf(u) === t.val);
  return [];
}
/* Apply a schedule's action to a unit record (in place), exactly as the dashboard does. */
function applyAction(u, a, unit) {
  a = a || {};
  if (a.power) u.on = a.power === 'on';
  if (a.mode && MODELO[a.mode] != null) u.mode = a.mode;
  if (a.fan && a.fan !== 'auto' && FANHI[a.fan] != null) u.fan = a.fan;
  if (a.sp != null && isFinite(a.sp)) {
    const c = Math.max(15, Math.min(30, Math.round((unit === 'C' ? +a.sp : (+a.sp - 32) * 5 / 9) * 2) / 2));
    u.coolC = c; u.heatC = c;
  }
  const act = u.mode === 'heat' ? u.heatC : u.coolC;
  if (act != null && isFinite(act)) u.sp = Math.round(act * 9 / 5 + 32);
  return u;
}
function condOk(s, outdoor) {
  if (!s.cond || !s.cond.op) return true;
  if (outdoor == null || !isFinite(outdoor)) return false;        // no weather reading -> a weather-conditioned run does not fire
  if (s.cond.op === 'above') return outdoor > s.cond.temp;
  if (s.cond.op === 'below') return outdoor < s.cond.temp;
  return true;
}

/*
 * createRunner({ getConfig, getUnits, masterAlive, masterMode, queue, transmit, commitUnits,
 *                getOutdoor, loadFired, saveFired, log })
 *   queue(addr, state)            -> hand a command to the connected dashboard
 *   transmit(list of byte arrays) -> Promise<boolean>; put frames on the bus directly
 *   commitUnits(changedUnits)     -> persist the new state of those units
 */
function createRunner(io) {
  let running = false;
  const history = [];                                              // newest first, for /api/sched
  const note = (e) => { history.unshift(Object.assign({ at: new Date().toISOString() }, e)); if (history.length > 40) history.pop(); if (io.log) io.log(e); };
  async function tick(now) {
    if (running) return; running = true;
    try {
      const cfg = io.getConfig() || {}, list = Array.isArray(cfg.schedules) ? cfg.schedules : [];
      if (!list.length) return;
      const tz = cfg.site && cfg.site.tz, siteUnit = (cfg.site && cfg.site.unit) === 'C' ? 'C' : 'F';
      const fired = io.loadFired() || {};
      for (const s of list) {
        const key = dueKey(s, now || new Date(), tz);
        if (!key || fired[s.id] === key) continue;
        const unit = (s.unit === 'C' || s.unit === 'F') ? s.unit : siteUnit;
        let outdoor = null;
        if (s.cond && s.cond.op) { try { outdoor = await io.getOutdoor(cfg, unit); } catch (_) { outdoor = null; } }
        if (!condOk(s, outdoor)) continue;                           // re-checked every tick inside the grace window
        const units = io.getUnits() || [], tgt = targets(s, units);
        if (!tgt.length) { fired[s.id] = key; io.saveFired(fired); note({ id: s.id, name: s.name, result: 'no-units' }); continue; }
        if (io.masterAlive()) {
          tgt.forEach(u => { const c = applyAction(Object.assign({}, u), s.action, unit);
            io.queue(u.addr, { on: !!c.on, mode: c.mode, fan: c.fan, swing: !!c.swing, coolC: c.coolC, heatC: c.heatC }); });
          fired[s.id] = key; io.saveFired(fired);
          note({ id: s.id, name: s.name, result: 'queued', units: tgt.length });
          if (s.once && io.disableSchedule) io.disableSchedule(s.id);
          continue;
        }
        if (!io.masterMode()) {                                     // Cortex is not the bus master here — never write
          fired[s.id] = key; io.saveFired(fired);
          note({ id: s.id, name: s.name, result: 'skipped-not-master', units: tgt.length });
          continue;
        }
        const changed = tgt.map(u => applyAction(Object.assign({}, u), s.action, unit));
        const frames = changed.map(cmd0Bytes);
        let ok = false; try { ok = await io.transmit(frames); } catch (e) { ok = false; note({ id: s.id, name: s.name, result: 'error', err: String(e && e.message || e) }); }
        if (ok) { io.commitUnits(changed); fired[s.id] = key; io.saveFired(fired); note({ id: s.id, name: s.name, result: 'sent', units: tgt.length }); if (s.once && io.disableSchedule) io.disableSchedule(s.id); }
        // not ok (adapter busy / missing): leave it un-fired so the next tick inside the grace window retries
      }
    } finally { running = false; }
  }
  return { tick, history };
}

module.exports = { cmd0Bytes, cksum, localParts, dueKey, targets, applyAction, condOk, createRunner, GRACE_MIN };
