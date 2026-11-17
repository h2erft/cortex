// EcoNet (Rheem / Ruud): the wire format (appliance/econet.js) and a system's runtime (appliance/econetlink.js),
// against pretend equipment on a pretend adapter.
//   node tests/econet.test.js
const E = require('../appliance/econet'), { createSystem } = require('../appliance/econetlink');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/* Pretend equipment: answers reads and accepts writes for the devices it is given. */
function fakeBus(devices) { const L = {}, p = { isOpen: true, sent: [], writes: [], on: (e, f) => { (L[e] = L[e] || []).push(f); }, emit: (e, x) => (L[e] || []).forEach(f => f(x)),
    say: (bytes) => p.emit('data', Buffer.from(bytes)), close: (cb) => { p.isOpen = false; p.emit('close'); if (cb) cb(); },
    write: (b, cb) => { const f = E.parseFrame([...b]); p.sent.push(f); if (cb) cb(); if (!f || p.deaf) return; const dev = devices[f.dst]; if (!dev) return;
      setTimeout(() => { if (f.cmd === E.CMD.READ) { const r = E.readNames(f.data); p.say(E.answerFrame(f.src, f.dst, r.names.map(n => dev[n] || null))); }
        else if (f.cmd === E.CMD.WRITE) { const w = E.parseWrite(f.data); p.writes.push(w); if (w.name === 'NOPE') return p.say(E.frame(f.src, f.dst, E.CMD.NAK, []));
          const cur = dev[w.name]; if (cur) dev[w.name] = cur.type === 'enum' ? { type: 'enum', value: w.value, text: 'choice ' + w.value } : { type: 'num', value: w.value }; p.say(E.frame(f.src, f.dst, E.CMD.ACK, [])); } }, 8); } }; return p; }
const N = (v) => ({ type: 'num', value: v }), C = (v, t) => ({ type: 'enum', value: v, text: t }), X = (t) => ({ type: 'text', text: t });
(async () => {
  try {
    // --- the wire format
    eq('checksum is CRC-16/ARC', E.crc16([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]).toString(16), 'bb3d');
    const rf = E.readFrame(0x380, 0x340, ['SPT', 'COOLSETP']);
    eq('a question: addresses, length, command, names padded to 8', [E.hex(rf.slice(0, 14)), rf.length, E.hex(rf.slice(14, 26))], ['80 00 03 80 00 80 00 03 40 00 16 00 00 1E', 38, '02 01 00 00 53 50 54 00 00 00 00 00']);
    eq('it reads back', [E.parseFrame(rf).dst, E.parseFrame(rf).src, E.readNames(E.parseFrame(rf).data)], [0x380, 0x340, { cls: 2, names: ['SPT', 'COOLSETP'] }]);
    const bad = rf.slice(); bad[20] ^= 1; eq('a damaged message is refused', E.parseFrame(bad), null);
    const wf = E.writeFrame(0x380, 0x340, 'COOLSETP', 74.5, false);
    eq('a change: 1 1 type 1 0 0, name, number', [E.hex(E.parseFrame(wf).data.slice(0, 6)), E.parseWrite(E.parseFrame(wf).data)], ['01 01 00 01 00 00', { name: 'COOLSETP', value: 74.5, isChoice: false }]);
    eq('a choice is marked as a choice', E.parseWrite(E.parseFrame(E.writeFrame(0x380, 0x340, 'STATMODE', 1, true)).data), { name: 'STATMODE', value: 1, isChoice: true });
    const af = E.answerFrame(0x340, 0x380, [N(72.5), C(1, 'Cool    '), X('RH3VZ36 '), null]);
    eq('an answer: number, choice, text, not supported', E.parseAnswer(E.parseFrame(af).data, 4), [{ type: 'num', value: 72.5 }, { type: 'enum', value: 1, text: 'Cool' }, { type: 'text', text: 'RH3VZ36' }, { type: 'none' }]);
    eq('an answer with the wrong number of values is refused', E.parseAnswer(E.parseFrame(af).data, 3), null);
    const got = []; const ps = E.createParser(f => got.push(f.cmd)); const stream = [0x11, 0x80, 0x22].concat(rf, [0x00], wf);
    for (let i = 0; i < stream.length; i += 7) ps.push(stream.slice(i, i + 7));
    eq('messages are found in a broken-up stream with noise around them', got, [E.CMD.READ, E.CMD.WRITE]);
    for (const [name, f] of [['an address of zero', () => E.frame(0, 0x340, 6, [])], ['a bad value name', () => E.readFrame(0x380, 0x340, ['lower'])], ['too many names', () => E.readFrame(0x380, 0x340, Array(26).fill('SPT'))], ['a value that is not a number', () => E.writeFrame(0x380, 0x340, 'SPT', NaN)]])
      eq('refuses to build ' + name, (() => { try { f(); return 'built'; } catch (e) { return 'refused'; } })(), 'refused');
    // --- what may be changed
    eq('changes are limited to the allowed list and its limits', [E.checkWrite('hvac', 'COOLSETP', 74).ok, E.checkWrite('hvac', 'COOLSETP', 95).ok, E.checkWrite('hvac', 'SPT', 70).ok, E.checkWrite('hvac', 'STATMODE', 4).ok, E.checkWrite('hvac', 'STATMODE', 9).ok, E.checkWrite('hvac', 'RESETDEV', 1).ok,
      E.checkWrite('hpwh', 'WHTRSETP', 120).ok, E.checkWrite('hpwh', 'WHTRSETP', 160).ok, E.checkWrite('tankless', 'WHTRENAB', 0).ok, E.checkWrite('hvac', 'COOLSETP', 'x').ok], [true, false, false, true, false, false, true, false, true, false]);
    eq('a setting is rounded to its step', E.checkWrite('hvac', 'COOLSETP', 74.26).value, 74.5);
    eq('every kind has a main device, and every value a name the bus accepts', Object.keys(E.KINDS).map(k => E.okAddr(E.KINDS[k].main) && E.KINDS[k].points.every(p => E.okName(p.n) && E.okAddr(p.at))), [true, true, true, true]);
    // --- a system: listening first
    const stat = { SPT: N(71.6), HEATSETP: N(68), COOLSETP: N(74), STATMODE: C(1, 'Cooling'), HVACMODE: C(2, 'Low Cool'), SCHEDULE: C(0, 'Off'), STAT_FAN: C(0, 'Auto'), STATNFAN: C(0, 'Auto'), RELH7005: N(44), ALRMALRT: N(1), ALARM_01: X('A123 Low pressure'), ALARM_02: X('') };
    const odu = { TEMP_OAT: N(88.2), PRES_SUC: N(131) };
    let bus = fakeBus({ 0x380: stat, 0x400: odu }), opened = [], changes = 0;
    const mk = (cfg) => createSystem(Object.assign({ id: 's1', name: 'Office', kind: 'hvac', port: '/dev/x', on: true, talk: false }, cfg), { open: async (port, ser) => { opened.push([port, ser.baud]); if (bus.missing) throw new Error('No such file'); return bus; }, onChange: () => { changes++; }, every: 120, tickMs: 20, retryMs: 40 });
    let sys = mk(); sys.start(); await sleep(60);
    eq('opens its own adapter at 38400', [opened[0], sys.info().open, sys.info().state], [['/dev/x', 38400], true, 'silent']);
    await sleep(200); eq('listening: nothing is transmitted', bus.sent.length, 0);
    bus.say(E.readFrame(0x400, 0x380, ['TEMP_OAT', 'PRES_SUC'])); bus.say(E.answerFrame(0x380, 0x400, [N(88.2), N(131)])); await sleep(30);
    let i = sys.info(); eq('it learns from what the thermostat and outdoor unit say to each other', [i.state, i.heard, i.values.TEMP_OAT.v, i.values.PRES_SUC.v, bus.sent.length], ['listening', 2, 88.2, 131, 0]);
    eq('a change is refused while only listening', (await sys.write('COOLSETP', 72)).ok, false);
    // --- allowed to talk
    sys.setFlags({ talk: true }); await sleep(900); i = sys.info();
    eq('talking: asks for its list a few names at a time and shows the answers', [i.state, i.values.SPT.v, i.values.COOLSETP.v, i.values.STATMODE.text, i.values.HVACMODE.text, i.alarms, bus.sent.every(f => f.cmd === E.CMD.READ && f.src === 0x340 && E.readNames(f.data).names.length <= 10)],
      ['live', 71.6, 74, 'Cool', 'Cooling (low)', ['A123 Low pressure'], true]);
    eq('values the equipment does not have are left out, not shown as zero', [i.values.F_ACTCFM === undefined, i.values.DHUMSETP === undefined], [true, true]);
    let r = await sys.write('COOLSETP', 72); await sleep(1500);
    eq('a change is sent once, to the thermostat, and read back', [r.ok, bus.writes, sys.info().values.COOLSETP.v], [true, [{ name: 'COOLSETP', value: 72, isChoice: false }], 72]);
    r = await sys.write('STATMODE', 4); eq('a choice is sent as a choice', [r.ok, bus.writes[1]], [true, { name: 'STATMODE', value: 4, isChoice: true }]);
    eq('a change outside the limits never reaches the wire', [(await sys.write('COOLSETP', 40)).ok, (await sys.write('RESETDEV', 1)).ok, bus.writes.length], [false, false, 2]);
    r = await sys.readOne('SW_VERSN', 0x380); eq('a technician can ask for any one value by name', [r.ok, r.item.type], [true, 'none']);
    eq('a bad name is refused before sending', (await sys.readOne('bad name')).ok, false);
    // --- trouble
    bus.deaf = true; const before = sys.state.unanswered; await sleep(1700); eq('no answer is counted, not fatal', [sys.state.unanswered > before, sys.info().open], [true, true]); bus.deaf = false;
    sys.setFlags({ talk: false }); await sleep(100); const n = bus.sent.length; await sleep(400); eq('back to listening: silent again', bus.sent.length, n);
    bus.close(); await sleep(20); eq('an unplugged adapter shows as a problem', [sys.info().open, sys.info().state], [false, 'problem']);
    bus = fakeBus({ 0x380: stat }); await sleep(150); eq('and reconnects when it is back', sys.info().open, true);
    sys.setFlags({ on: false }); await sleep(120); eq('switched off: adapter closed, stays closed', [sys.info().state, bus.isOpen], ['off', false]); sys.stop();
    // --- never talks into silence
    bus = fakeBus({ 0x380: stat }); sys = mk({ talk: true }); sys.start(); await sleep(500);
    eq('allowed to talk but nothing heard yet: stays silent', [bus.sent.length, sys.info().state, (await sys.write('COOLSETP', 72)).ok], [0, 'silent', false]);
    bus.say([0x80, 0x00, 0x12, 0x34]); await sleep(250); bus.say([0x55, 0x80, 0x01]); await sleep(250); eq('noise is not a message', [bus.sent.length, sys.state.junk > 0], [0, true]); sys.stop();
    // --- a water heater
    const tank = { WHTRSETP: N(120), WHTRENAB: C(1, 'Enabled'), WHTRCNFG: C(2, 'Heat Pump'), UPHTRTMP: N(118.4), HOTWATER: N(66) };
    bus = fakeBus({ 0x1280: tank }); sys = mk({ kind: 'hpwh', talk: true }); sys.start(); await sleep(60); bus.say(E.answerFrame(0x999, 0x1280, [N(1)])); await sleep(700); i = sys.info();
    eq('a heat pump water heater: asks its own address and shows the tank', [i.state, i.values.WHTRSETP.v, i.values.WHTRCNFG.text, i.values.UPHTRTMP.v, bus.sent.every(f => f.dst === 0x1280)], ['live', 120, 'Heat pump', 118.4, true]);
    r = await sys.write('WHTRSETP', 125); eq('its setting can be changed within limits', [r.ok, (await sys.write('WHTRSETP', 150)).ok, bus.writes.length], [true, false, 1]); sys.stop();
    eq('an unknown kind of equipment is refused', (() => { try { createSystem({ kind: 'boiler' }, {}); return 'made'; } catch (e) { return 'refused'; } })(), 'refused');
  } catch (e) { fail++; console.log('FAIL crashed: ' + (e.stack || e)); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
