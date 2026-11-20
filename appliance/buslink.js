/*
 * Cortex bus link — the ONE owner of the RS-485 adapter, on the controller.
 *
 * Before 1.7.1-beta.5 whichever browser opened Bus scan first held the adapter, and every other
 * screen saw "link down". Now the controller holds it:
 *   - "Connect" / "Disconnect" is a switch kept here (and on disk), so every screen and app sees the
 *     same thing and any technician's device can flip it;
 *   - every screen that listens gets the same bytes;
 *   - the controller's own poll loop (busmaster.js) talks through facade();
 *   - ONE screen at a time may borrow the wire for the technician tools (discover, raw frames): the
 *     "driver". While there is a driver the controller's loop stays off the bus, so there is never
 *     more than one master talking. A driver that goes quiet for LEASE_IDLE loses the wire.
 *
 * Opening the adapter only LISTENS. Nothing here transmits by itself.
 * Plain Node; the serial port is supplied by the caller. Tested by tests/buslink.test.js.
 */
'use strict';
const LEASE_IDLE = 5 * 60000;
const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
function cleanSerial(s) { s = s || {};
  return { baud: BAUDS.includes(+s.baud) ? +s.baud : 4800, parity: ['none', 'even', 'odd'].includes(s.parity) ? s.parity : 'none', stop: +s.stop === 2 ? 2 : 1, data: +s.data === 7 ? 7 : 8 }; }

/* createLink(io)
 *   io.open(serial)   -> Promise<port>  (serialport-like: write(buf,cb), drain(cb), on('data'|'error'|'close'), close(cb), isOpen)
 *   io.load()         -> { on, serial } or null        io.save({ on, serial })
 *   io.onTx(buf)      (optional) every frame sent
 *   io.onBytes(buf)   every byte heard                 io.onChange()   something in info() changed
 *   io.log(text)      io.retryMs   io.leaseIdle
 */
function createLink(io) {
  const saved = (io.load && io.load()) || {};
  const S = { on: !!saved.on, serial: cleanSerial(saved.serial), port: null, opening: false, error: null, driver: null, driverAt: 0, tx: false };
  const taps = new Set(); let retryT = null, gen = 0;
  const log = (t) => { try { if (io.log) io.log(t); } catch (_) {} };
  const changed = () => { try { if (io.onChange) io.onChange(); } catch (_) {} };
  const persist = () => { try { if (io.save) io.save({ on: S.on, serial: S.serial }); } catch (e) { log('could not save the link setting: ' + e.message); } };
  function retry() { if (retryT || !S.on) return; retryT = setTimeout(() => { retryT = null; open(); }, io.retryMs || 5000); if (retryT.unref) retryT.unref(); }
  function open() {
    if (!S.on || S.port || S.opening) return; S.opening = true; const g = ++gen;
    Promise.resolve().then(() => io.open(S.serial)).then((port) => {
      if (g !== gen || !S.on) { try { port.close(() => {}); } catch (_) {} return; }       // switched off (or re-set) while it was opening
      S.opening = false; S.port = port; S.error = null;
      port.on('data', (buf) => { try { if (io.onBytes) io.onBytes(buf); } catch (_) {} for (const t of taps) t.emit('data', buf); });
      port.on('error', (e) => { S.error = (e && e.message) || 'adapter error'; for (const t of [...taps]) t.emit('error', e); });
      port.on('close', () => { if (S.port !== port) return; S.port = null; S.driver = null; for (const t of [...taps]) t.emit('close');
        if (S.on) { S.error = S.error || 'the adapter was disconnected'; log('adapter closed: ' + S.error); retry(); } changed(); });
      log('adapter open (listening)'); changed();
    }, (e) => { if (g !== gen) return; S.opening = false; S.error = 'could not open the adapter: ' + ((e && e.message) || e); retry(); changed(); });
  }
  function shut() { gen++; clearTimeout(retryT); retryT = null; S.opening = false; const p = S.port; S.port = null; S.driver = null;
    for (const t of [...taps]) t.emit('close');
    if (p) { try { if (p.isOpen !== false) p.close(() => {}); } catch (_) {} } }
  /* The shared switch. `serial` (optional) changes the line settings; a change reopens the adapter. */
  function setOn(on, serial) {
    on = !!on; const ser = serial ? cleanSerial(serial) : S.serial, serCh = JSON.stringify(ser) !== JSON.stringify(S.serial);
    if (on === S.on && !serCh) { if (on && !S.port) open(); return info(); }
    S.serial = ser; S.on = on; S.error = null; persist();
    if (!on || serCh) shut();
    if (on) open(); else log('adapter disconnected by a technician');
    changed(); return info();
  }
  /* Borrow the wire for the technician tools. `who` is any object naming the screen. */
  function take(who, force) {
    if (!S.port) return { ok: false, err: 'the adapter is not connected' };
    if (S.driver && S.driver !== who && !force) return { ok: false, inUse: true, err: 'another screen is using the bus tools' };
    const prev = S.driver && S.driver !== who ? S.driver : null; S.driver = who; S.driverAt = Date.now(); changed(); return { ok: true, prev };
  }
  function release(who) { if (!S.driver || (who && S.driver !== who)) return false; S.driver = null; changed(); return true; }
  const tx = (b) => { try { if (io.onTx) io.onTx(Buffer.from(b)); } catch (_) {} };
  function write(who, buf) { if (!S.port || !who || S.driver !== who) return false; S.driverAt = Date.now(); try { S.port.write(Buffer.from(buf)); tx(buf); return true; } catch (_) { return false; } }
  function tick() { if (S.driver && Date.now() - S.driverAt > (io.leaseIdle || LEASE_IDLE)) { log('bus tools idle: handed back to the controller'); release(); } if (S.on && !S.port && !S.opening) retry(); }
  /* The controller's own loop talks through this. It never closes the real adapter. */
  function facade() {
    const p = S.port; if (!p || S.driver) throw new Error(S.driver ? 'a screen is using the bus tools' : 'the adapter is not connected');
    const L = { data: [], error: [], close: [] }, t = { emit: (ev, x) => L[ev].slice().forEach(f => { try { f(x); } catch (_) {} }) }; taps.add(t);
    const live = () => S.port === p && taps.has(t) && p.isOpen !== false, dead = new Error('port closed');
    return { get isOpen() { return live(); }, on: (ev, f) => { if (L[ev]) L[ev].push(f); },
      write: (b, cb) => (live() && !S.driver ? (tx(b), p.write(b, cb)) : cb && cb(dead)), drain: (cb) => (live() ? p.drain(cb) : cb && cb(dead)),
      close: (cb) => { taps.delete(t); if (cb) cb(); } };
  }
  /* A schedule's frames when nothing is polling: each frame three times, with room for the replies. */
  async function transmit(frames, wait) {
    if (!S.port || S.driver || S.tx || !frames || !frames.length) return false; S.tx = true; const p = S.port, sleep = wait || ((ms) => new Promise(r => setTimeout(r, ms)));
    try { for (const f of frames) { for (let i = 0; i < 3; i++) { if (S.port !== p || S.driver) return false;
          tx(f); await new Promise((res, rej) => p.write(Buffer.from(f), (e) => e ? rej(e) : p.drain((e2) => e2 ? rej(e2) : res()))); await sleep(350); } await sleep(250); }
      return true; } finally { S.tx = false; }
  }
  const info = () => ({ on: S.on, open: !!S.port, opening: S.opening, error: S.on ? S.error : null, serial: S.serial, driver: !!S.driver });
  return { state: S, start: open, setOn, take, release, write, tick, facade, transmit, info, stop: shut };
}
module.exports = { createLink, cleanSerial, LEASE_IDLE };
