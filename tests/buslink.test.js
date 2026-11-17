// The shared bus link (appliance/buslink.js): one adapter, owned by the controller, shared by every screen.
// A pretend serial port stands in for the adapter; the real poll loop (busmaster.js) runs through it.
//   node tests/buslink.test.js
const { createLink, cleanSerial } = require('../appliance/buslink'), { createMaster, readQuery, ck } = require('../appliance/busmaster');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fakePort() { const L = {}, p = { isOpen: true, sent: [], on: (e, f) => { (L[e] = L[e] || []).push(f); }, emit: (e, x) => (L[e] || []).forEach(f => f(x)),
  write: (b, cb) => { p.sent.push([...b]); if (p.onWrite) p.onWrite([...b]); if (cb) cb(); }, drain: (cb) => cb && cb(), close: (cb) => { p.isOpen = false; p.emit('close'); if (cb) cb(); } }; return p; }
function world(o) { o = o || {}; const w = { ports: [], saved: o.saved || null, changes: 0, heard: 0, failOpen: !!o.failOpen, opens: [] };
  w.link = createLink({ open: async (ser) => { w.opens.push(ser); if (w.failOpen) throw new Error('No such file or directory'); const p = fakePort(); w.ports.push(p); return p; },
    load: () => w.saved, save: (x) => { w.saved = x; }, onBytes: (b) => { w.heard += b.length; }, onChange: () => { w.changes++; }, retryMs: 40, leaseIdle: o.leaseIdle });
  w.port = () => w.ports[w.ports.length - 1]; return w; }
(async () => {
  try {
    eq('line settings are cleaned', [cleanSerial({ baud: 9600, parity: 'even', stop: 2, data: 7 }), cleanSerial({ baud: 1234, parity: 'x', stop: 9, data: 3 }), cleanSerial(null)],
      [{ baud: 9600, parity: 'even', stop: 2, data: 7 }, { baud: 4800, parity: 'none', stop: 1, data: 8 }, { baud: 4800, parity: 'none', stop: 1, data: 8 }]);
    // --- the shared switch
    let w = world(); w.link.start(); await sleep(10);
    eq('a new controller starts disconnected and opens nothing', [w.link.info().on, w.link.info().open, w.ports.length], [false, false, 0]);
    w.link.setOn(true); await sleep(10);
    eq('Connect opens the adapter and is remembered on the controller', [w.link.info().on, w.link.info().open, w.saved.on, w.port().sent.length], [true, true, true, 0]);
    w.port().emit('data', Buffer.from([1, 2, 3])); eq('bytes heard are passed on', w.heard, 3);
    w.link.setOn(true); await sleep(10); eq('Connect again does not open a second time', w.ports.length, 1);
    w.link.setOn(false); await sleep(10);
    eq('Disconnect closes it and is remembered', [w.link.info().on, w.link.info().open, w.saved.on, w.ports[0].isOpen], [false, false, false, false]);
    let w2 = world({ saved: { on: true, serial: { baud: 9600 } } }); w2.link.start(); await sleep(10);
    eq('after a restart it reconnects by itself with the saved line settings', [w2.link.info().open, w2.opens[0].baud], [true, 9600]);
    w2.link.setOn(true, { baud: 4800 }); await sleep(10); eq('changing the line settings reopens the adapter', [w2.ports.length, w2.ports[0].isOpen, w2.opens[1].baud, w2.link.info().open], [2, false, 4800, true]);
    // --- adapter trouble
    let w3 = world({ failOpen: true }); w3.link.setOn(true); await sleep(10);
    eq('a missing adapter is reported, not thrown', [w3.link.info().open, /could not open the adapter/.test(w3.link.info().error)], [false, true]);
    w3.failOpen = false; await sleep(120); eq('and it keeps trying until the adapter is there', [w3.link.info().open, w3.link.info().error], [true, null]);
    w3.port().isOpen = false; w3.port().emit('close'); eq('an unplugged adapter shows as not connected', [w3.link.info().open, w3.link.info().error], [false, 'the adapter was disconnected']);
    await sleep(120); eq('and comes back when it is plugged in again', w3.link.info().open, true);
    w3.link.setOn(false); await sleep(120); eq('nothing reopens after Disconnect', [w3.link.info().open, w3.ports.filter(p => p.isOpen).length], [false, 0]);
    // --- one screen at a time may use the bus tools
    w = world(); w.link.setOn(true); await sleep(10); const A = { n: 'A' }, B = { n: 'B' };
    eq('a screen that only listens cannot transmit', [w.link.write(A, [0x80]), w.port().sent.length], [false, 0]);
    eq('a screen takes the bus tools', [w.link.take(A).ok, w.link.info().driver, w.link.write(A, [0x80, 0x00]), w.port().sent], [true, true, true, [[0x80, 0x00]]]);
    eq('a second screen is told it is in use', [w.link.take(B).ok, w.link.take(B).inUse, w.link.write(B, [1])], [false, true, false]);
    eq('the second screen can take over on purpose', [w.link.take(B, true).prev === A, w.link.write(A, [1]), w.link.write(B, [2])], [true, false, true]);
    eq('only the holder can hand it back; anyone can force it', [w.link.release(A), w.link.release(B), w.link.take(A).ok, w.link.release(), w.link.info().driver], [false, true, true, true, false]);
    eq('no tools without the adapter', (() => { const x = world(); return x.link.take(A).ok; })(), false);
    let w4 = world({ leaseIdle: 30 }); w4.link.setOn(true); await sleep(10); w4.link.take(A); await sleep(60); w4.link.tick();
    eq('a screen that goes quiet loses the bus tools', w4.link.info().driver, false);
    // --- the controller's own loop shares the adapter and stays off the wire while a screen uses the tools
    w = world(); w.link.setOn(true); await sleep(10); const port = w.port(); let units = [{ id: 1, addr: 5 }], patched = 0;
    const reply = (a) => { const f = [0x10, 0x01, 0xA0, 0x40, a, 0, 0x04, 0x18, 0x60, 0, 0, 0, 0, 0, 0]; f.push(ck(f, 15)); return f; };
    port.onWrite = (b) => { if (b[0] === 0x80 && b.length === 8) setTimeout(() => port.emit('data', Buffer.from(reply(b[3]))), 5); };
    const M = createMaster({ openPort: async () => w.link.facade(), getUnits: () => units, patchUnits: (p) => { patched += p.length; }, drain: () => [], oduAddrs: () => [], onOdu() {}, log() {} });
    M.start(); await sleep(800);
    eq('the controller polls through the shared adapter', [patched > 0, JSON.stringify(port.sent[0]) === JSON.stringify(readQuery(5)), port.isOpen], [true, true, true]);
    w.link.take(A); await M.stop(); const n = port.sent.length; await sleep(120);
    eq('when a screen takes the tools the controller goes quiet and the adapter stays open', [M.state.active, port.sent.length === n, port.isOpen, w.link.info().open], [false, true, true, true]);
    let threw = ''; try { w.link.facade(); } catch (e) { threw = e.message; } eq('the loop cannot start while a screen has the wire', threw, 'a screen is using the bus tools');
    w.link.release(A); M.start(); await sleep(800); eq('handed back: the controller polls again', port.sent.length > n, true);
    w.link.setOn(false); await sleep(2800); eq('Disconnect stops the loop too', [M.state.active, port.isOpen], [false, false]);
    // --- a schedule's frames
    w = world(); w.link.setOn(true); await sleep(10); const fast = () => Promise.resolve();
    eq('a schedule transmits through the shared adapter, each frame three times', [await w.link.transmit([[1, 2], [3, 4]], fast), w.port().sent.length], [true, 6]);
    w.link.take(A); eq('but never while a screen uses the tools, and never when disconnected', [await w.link.transmit([[1]], fast), await world().link.transmit([[1]], fast)], [false, false]);
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
