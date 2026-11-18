/*
 * EcoNet systems — one RS-485 adapter per Rheem / Ruud system, run by the controller.
 *
 * Each system has three steps, each a switch kept on the controller:
 *   1. on    : the adapter is open and Cortex LISTENS. It decodes what the thermostat and equipment
 *              already say to each other. Nothing is transmitted.
 *   2. talk  : Cortex also asks for values itself, and may send changes a person makes.
 *              It never transmits until it has heard at least one good message on this adapter,
 *              which proves the wiring, the speed and the checksum are right.
 *   3. a change (setpoint, mode ...) is sent only when a person asks, and only for values on the
 *      allowed list in econet.js, inside their limits.
 *
 * Cortex speaks only when the wire has been quiet for a moment, one question at a time.
 * Plain Node; the serial port is supplied by the caller. Tested by tests/econet.test.js.
 */
'use strict';
const E = require('./econet');
const QUIET = 60, GAP = 180, ANSWER_WAIT = 700, EVERY = 30000, SLOW_EVERY = 10 * 60000, STALE = 5 * 60000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* createSystem(cfg, io)
 *   cfg : { id, name, kind, port, on, talk, src }
 *   io.open(port, serial) -> Promise<port>   io.onChange()   io.log(text)   io.now()   io.every / io.retryMs (tests)
 */
function createSystem(cfg, io) {
  const K = E.KINDS[cfg.kind]; if (!K) throw new Error('unknown kind of equipment');
  const src = E.okAddr(cfg.src) ? cfg.src : E.ADDR.WIFI, now = () => (io.now ? io.now() : Date.now());
  const S = { port: null, opening: false, error: null, closed: false, heard: 0, junk: 0, lastRx: 0, lastTx: 0, lastAnswer: 0, sent: 0, unanswered: 0, cycleAt: 0, slowAt: 0, busy: false };
  const values = new Map(), frames = [], asked = new Map(), absent = new Map(), queue = []; let waiting = null, retryT = null, loopT = null, gen = 0;
  const changed = () => { try { if (io.onChange) io.onChange(); } catch (_) {} };
  const log = (t) => { try { if (io.log) io.log('[' + cfg.name + '] ' + t); } catch (_) {} };
  const key = (at, n) => at + ':' + n;
  function note(dir, f, what) { frames.unshift({ at: now(), dir, from: f.src, to: f.dst, cmd: f.cmd, what: what || '', hex: E.hex(E.frame(f.dst, f.src, f.cmd, f.data)) }); if (frames.length > 200) frames.pop(); }
  function store(at, name, item, how) { if (!item || item.type === 'raw') return;
    const v = { type: item.type, value: item.value == null ? null : item.value, text: item.text == null ? null : item.text, at: now(), how }; values.set(key(at, name), v); }
  /* Every good message on the wire, ours or anybody's. */
  function onFrame(f) {
    S.heard++; S.lastRx = now();
    if (f.src === src) return;                                   // our own words echoed back by the adapter
    if (f.cmd === E.CMD.READ) { const r = E.readNames(f.data); if (r && r.cls === 2) asked.set(f.src + '>' + f.dst, { names: r.names, at: now() }); note('rx', f, r ? 'asks ' + r.names.join(', ') : 'asks'); return; }
    if (f.cmd === E.CMD.WRITE) { const w = E.parseWrite(f.data); note('rx', f, w ? 'sets ' + w.name + ' = ' + w.value : 'sets'); return; }
    if (f.cmd === E.CMD.ACK || f.cmd === E.CMD.NAK) {
      const mine = waiting && f.dst === src && f.src === waiting.dst;
      if (mine) { const w = waiting; waiting = null; clearTimeout(w.timer); S.lastAnswer = now(); S.unanswered = 0;
        if (f.cmd === E.CMD.NAK) { note('rx', f, 'says no'); w.done({ ok: false, err: 'the equipment refused' }); return; }
        if (w.names) { const items = E.parseAnswer(f.data, w.names.length);
          if (items) { items.forEach((it, i) => store(f.src, w.names[i], it, 'asked')); note('rx', f, 'answers ' + w.names.join(', ')); w.done({ ok: true, items }); changed(); }
          else { note('rx', f, 'answer did not add up'); w.done({ ok: false, err: 'the answer did not add up' }); } }
        else { note('rx', f, 'done'); w.done({ ok: true }); }
        return; }
      // somebody else's answer: learn from it for free
      const q = asked.get(f.dst + '>' + f.src);
      if (q && f.cmd === E.CMD.ACK && now() - q.at < 2000) { asked.delete(f.dst + '>' + f.src); const items = E.parseAnswer(f.data, q.names.length);
        if (items) { items.forEach((it, i) => store(f.src, q.names[i], it, 'heard')); note('rx', f, 'answers ' + q.names.join(', ')); changed(); return; } }
      note('rx', f, f.cmd === E.CMD.NAK ? 'says no' : 'answers');
      return; }
    note('rx', f, 'command ' + f.cmd);
  }
  const parser = E.createParser(onFrame, (n) => { S.junk += n; });
  /* ---- the adapter ---- */
  function retry() { if (retryT || S.closed || !cfg.on) return; retryT = setTimeout(() => { retryT = null; open(); }, io.retryMs || 5000); if (retryT.unref) retryT.unref(); }
  function open() { if (S.closed || !cfg.on || S.port || S.opening) return; S.opening = true; const g = ++gen;
    Promise.resolve().then(() => io.open(cfg.port, E.SERIAL)).then((port) => {
      if (g !== gen || S.closed || !cfg.on) { try { port.close(() => {}); } catch (_) {} return; }
      S.opening = false; S.port = port; S.error = null; parser.reset();
      port.on('data', (buf) => { const t = now(); if (parser.pending && t - S.lastByte > 150) parser.reset(); S.lastByte = t; parser.push(buf); });
      port.on('error', (e) => { S.error = (e && e.message) || 'adapter error'; });
      port.on('close', () => { if (S.port !== port) return; S.port = null; fail('the adapter closed'); if (!S.closed && cfg.on) { S.error = S.error || 'the adapter was disconnected'; retry(); } changed(); });
      log('adapter open (listening)'); changed();
    }, (e) => { if (g !== gen) return; S.opening = false; S.error = 'could not open the adapter: ' + ((e && e.message) || e); retry(); changed(); });
    changed(); }
  function fail(why) { if (waiting) { const w = waiting; waiting = null; clearTimeout(w.timer); w.done({ ok: false, err: why }); } while (queue.length) queue.shift().done({ ok: false, err: why }); }
  /* ---- speaking ---- */
  const mayTalk = () => !!(S.port && cfg.on && cfg.talk && S.heard > 0);
  function ask(job) { return new Promise((done) => { if (!mayTalk()) return done({ ok: false, err: !S.port ? 'the adapter is not connected' : !cfg.talk ? 'Cortex is only listening on this system' : 'nothing has been heard from the equipment yet' });
      if (queue.length > 60) return done({ ok: false, err: 'too much waiting to be sent' }); job.done = done; if (job.first) queue.unshift(job); else queue.push(job); pump(); }); }
  async function pump() { if (S.busy) return; S.busy = true;
    try { while (queue.length && mayTalk()) {
        while (waiting) await sleep(15);
        for (;;) { const t = now(), q = QUIET - (t - S.lastRx), g = GAP - (t - S.lastTx); if (q <= 0 && g <= 0) break; await sleep(Math.max(5, Math.min(60, Math.max(q, g)))); if (!mayTalk()) break; }   // wait for a quiet wire
        if (!mayTalk()) break; const job = queue.shift(), p = S.port;
        waiting = { dst: job.dst, names: job.names || null, done: job.done, timer: setTimeout(() => { if (waiting && waiting.done === job.done) { waiting = null; S.unanswered++; job.done({ ok: false, err: 'no answer' }); } }, ANSWER_WAIT) };
        S.lastTx = now(); S.sent++; note('tx', E.parseFrame(job.bytes), job.what);
        try { await new Promise((res, rej) => p.write(Buffer.from(job.bytes), (e) => e ? rej(e) : res())); } catch (e) { const w = waiting; waiting = null; if (w) { clearTimeout(w.timer); w.done({ ok: false, err: 'could not send: ' + e.message }); } } } }
    finally { S.busy = false; }
    if (!mayTalk()) fail('stopped'); }
  const read = (at, names, first) => ask({ dst: at, names, bytes: E.readFrame(at, src, names), what: 'asks ' + names.join(', '), first });
  /* One round of questions: everything on the list, a few names at a time, device by device. */
  async function cycle() { const t = now(), slow = t - S.slowAt > SLOW_EVERY; if (slow) S.slowAt = t; S.cycleAt = t;
    const by = new Map(); for (const p of K.points) { if (p.slow && !slow) continue; if (!by.has(p.at)) by.set(p.at, []); by.get(p.at).push(p.n); }
    for (const [at, names] of by) { if ((absent.get(at) || 0) >= 3 && !slow) continue;       // a device this system does not have (no furnace, no outdoor unit): ask again only now and then
      for (let i = 0; i < names.length; i += E.MAX_NAMES) { if (!mayTalk()) return; const r = await read(at, names.slice(i, i + E.MAX_NAMES));
        if (r.ok) absent.set(at, 0); else if (r.err === 'no answer') { absent.set(at, (absent.get(at) || 0) + 1); break; } } } }
  let cycling = false;
  function tick() { if (S.closed) return; if (cfg.on && !S.port && !S.opening) retry();
    if (!mayTalk() || cycling) return; if (now() - S.cycleAt < (io.every || EVERY)) return;
    cycling = true; cycle().catch(() => {}).then(() => { cycling = false; changed(); }); }
  /* A change a person asked for. Checked against the allowed list, sent ahead of the routine questions, then read back. */
  async function write(name, value) { const c = E.checkWrite(cfg.kind, name, value); if (!c.ok) return c;
    const r = await ask({ dst: c.at, bytes: E.writeFrame(c.at, src, name, c.value, c.isChoice), what: 'sets ' + name + ' = ' + c.value, first: true });
    if (!r.ok) return r; log('set ' + name + ' = ' + c.value);
    setTimeout(() => { if (mayTalk()) read(c.at, [name], true); }, 1200); return { ok: true, value: c.value }; }
  /* A technician asking for any one value by name. */
  async function readOne(name, at) { if (!E.okName(name)) return { ok: false, err: 'a value name is 1 to 8 letters, digits or _' }; at = E.okAddr(at) ? at : K.main;
    const r = await read(at, [name], true); if (!r.ok) return r; const it = r.items[0]; return { ok: true, name, at, item: it }; }
  function setFlags(o) { let ch = false;
    if (typeof o.talk === 'boolean' && o.talk !== cfg.talk) { cfg.talk = o.talk; ch = true; if (!cfg.talk) fail('Cortex is only listening on this system'); }
    if (typeof o.on === 'boolean' && o.on !== cfg.on) { cfg.on = o.on; ch = true; if (cfg.on) open(); else shut(); }
    if (ch) changed(); return ch; }
  function shut() { gen++; clearTimeout(retryT); retryT = null; S.opening = false; const p = S.port; S.port = null; fail('the adapter was disconnected'); if (p) { try { p.close(() => {}); } catch (_) {} } S.error = null; }
  function start() { open(); loopT = setInterval(tick, io.tickMs || 1000); if (loopT.unref) loopT.unref(); }
  function stop() { S.closed = true; clearInterval(loopT); shut(); }
  /* What every screen is shown. */
  function info() { const t = now(), vals = {};
    for (const p of K.points) { const v = values.get(key(p.at, p.n)); if (!v || v.type === 'none') continue;
      vals[p.n] = { v: v.type === 'num' ? (v.value == null ? null : Math.round(v.value * 100) / 100) : v.value, text: v.type === 'num' ? null : (p.options && v.value != null && p.options[v.value] != null ? p.options[v.value] : v.text), age: Math.round((t - v.at) / 1000), stale: t - v.at > STALE }; }
    const alarms = ['ALARM_01', 'ALARM_02', 'ALARM_03', 'ALARM_04'].map(n => vals[n] && !vals[n].stale ? vals[n].text : null).filter(a => a && !/^(none|no alarm|-+)?$/i.test(a));
    return { id: cfg.id, name: cfg.name, group: cfg.group || '', sub: cfg.sub || '', kind: cfg.kind, kindLabel: K.label, port: cfg.port, on: !!cfg.on, talk: !!cfg.talk, open: !!S.port, opening: S.opening, error: cfg.on ? S.error : null,
      heard: S.heard, hearing: !!S.lastRx && t - S.lastRx < 15000, answering: !!S.lastAnswer && t - S.lastAnswer < 90000, sent: S.sent, unanswered: S.unanswered, junk: S.junk,
      state: !cfg.on ? 'off' : !S.port ? (S.error ? 'problem' : 'opening') : !S.heard ? 'silent' : !cfg.talk ? 'listening' : (S.lastAnswer && t - S.lastAnswer < 90000 ? 'live' : (S.sent > 3 ? 'unanswered' : 'starting')), values: vals, alarms }; }
  return { cfg, start, stop, setFlags, write, readOne, info, frames: () => frames.slice(0, 120), state: S, tick, cycle };
}
module.exports = { createSystem };
