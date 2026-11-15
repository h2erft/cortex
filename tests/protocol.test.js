// Offline protocol regression test for cortex.html. No bus, no appliance, nothing is transmitted.
// It loads the real page in headless Chrome and calls the page's own encode/decode functions
// against reference frames (LG CEN/LGAP: checksum = sum XOR 0x55).
//
//   node tests/protocol.test.js
//
// Needs the `playwright` npm package and a Chrome/Chromium binary (set CHROME=/path if not /usr/bin/google-chrome).
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const hex = s => s.trim().split(/\s+/).map(x => parseInt(x, 16));
const STREAM = [   // a central controller polling 4 indoor units and one outdoor unit (cmd4+reply, cmd0+reply, cmd14 pages)
  'a0 00 a0 01 01 84 0b 84', '09 20 a0 40 01 00 04 0b 4c',
  '80 00 a0 01 00 10 05 63', '10 02 a0 40 01 00 10 05 7f 8a 85 28 00 4c 60 3f',
  'a0 00 a0 02 01 83 09 9a', '09 20 a0 40 02 00 03 09 42',
  '80 00 a0 02 01 30 07 0f', '10 03 a0 40 02 00 30 07 7d 80 7d 28 00 12 60 15',
  '84 00 a0 03 01 30 05 08', '10 83 a0 40 03 00 30 05 81 98 87 28 00 36 60 5c',
  'f0 c0 a0 01 00 00 00 04',
  '40 70 a0 c0 01 00 82 0e 1d 00 00 61 57 00 96 21 29 29 00 00 1a 1a 5a 61 52 67 a4 dc 73 58 1f 4a b0 a7 04 f3 05 08 01 01 15 62 00 60 84 87 01 01 44 00 00 00 50 04 2d 0e 00 00 82 03 46 0a 00 91',
  'f0 c0 a0 01 02 00 00 06',
  '40 70 a0 c0 01 02 82 0e 1d 00 00 00 00 00 00 21 29 29 00 00 1a 1a 5e 61 53 61 a6 dc 70 5a 2c 4a b1 8e 04 f3 06 08 01 01 15 62 00 61 85 88 01 01 40 00 00 00 54 06 2d 0e 00 00 82 03 46 0a 00 26',
].map(hex);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'cortex.html'));
  await page.waitForTimeout(800);

  const r = await page.evaluate((STREAM) => {
    const H = b => b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    const out = {};
    // ---- cmd0 control frame (byte5: bits0-2 mode, bit3 swing, bits4-6 fan, bit7 kept 0)
    const base = { on: true, mode: 'cool', fan: 'med', swing: false, coolC: 22, heatC: 22 };
    out.c0_basic = H(cmdBytesFor(0x31, base));
    out.c0_swing = H(cmdBytesFor(0x31, { ...base, swing: true }));
    out.c0_fanAuto = H(cmdBytesFor(0x31, { ...base, fan: 'auto' }));
    out.c0_quietKept = H(cmdBytesFor(0x31, { ...base, fan: 'quiet', fanRaw: 5 }));
    out.c0_hardLock = H(cmdBytesFor(0x31, { ...base, hardLock: true }));
    out.c0_half = H(cmdBytesFor(0x31, { ...base, coolC: 22.5 }));
    out.c0_filterBitDropped = H(cmdBytesFor(0x31, { on: true, mode: 'mode6', fan: 'fan7', d5: 0xF6, coolC: 22 }));
    out.c0_read = H(cmdBytesFor(0x31, base, false));
    // ---- cmd4 locks + limits
    out.c4_none = H(cmd4BytesFor(0xC9, { on: true }));
    out.c4_mode = H(cmd4BytesFor(0x5E, { on: true, modeLock: true, c4b5: 0x85, c4b6: 0x08 }));   // range unlocked -> learned band dropped, full 15-30 sent
    out.c4_all = H(cmd4BytesFor(0x5E, { on: true, modeLock: true, fanLock: true, tempLock: true, rangeLock: true, c4b5: 0x85, c4b6: 0x08 }));
    out.c4_band = H(cmd4BytesFor(0x01, { on: true, tempLock: true, rangeLock: true, limLo: 19, limHi: 26 }));
    out.c4_rangeoff = H(cmd4BytesFor(0x01, { on: true, rangeLock: false, limLo: 19, limHi: 26 }));   // limits ignored when range unlocked
    out.c4_unitOff = H(cmd4BytesFor(0x10, { on: false, modeLock: true }));     // byte4 bit0 is always 1 in the ACP's builder, not "power"
    // ---- cmd5 (debug tool only): layout rebuilt from the ACP engine binary
    out.c5 = H(cmd5SetpointBytes(0x31, 24.5, 20, { twoset: true }));
    const d5 = decodeCmd5(cmd5SetpointBytes(0x31, 24.5, 20, { twoset: true }));
    out.c5dec = { cool: d5.coolC, heat: d5.heatC, twoset: d5.twoset, cl: d5.commitLimits, cs: d5.commitSetpoints, occ: d5.occupied, lim: d5.limits.join(',') };
    // ---- 16-byte reply
    const p = parseReply([0x10,0x03,0xA0,0x40,0x2D,0x00,0x10,0x05,0x81,0x9E,0x87,0x28,0x00,0x0C,0x24,0x66]);
    out.reply = { addr: p.addr, on: p.on, mode: p.mode, fan: p.fan, set: p.settemp, room: p.room, pin: p.pipeIn, pout: p.pipeOut, eev: p.eev, cap: p.cap, load: p.group, lock: p.remoteLock, swing: p.swing };
    const p7 = parseReply([0x10,0x07,0xA0,0x40,0x2D,0x00,0x4F,0x05,0x81,0x9E,0x87,0x28,0x00,0x0C,0x24,0]);
    out.reply7 = { mode: p7.mode, side: p7.autoSide, fan: p7.fan, swing: p7.swing, lock: p7.remoteLock };
    // ---- passive stream: split awkwardly across chunks, with junk between frames
    bus.proto = 'lg';
    units.length = 0;
    [1, 2, 3].forEach((a, i) => units.push({ id: 900 + i, addr: a, name: 'T' + a, on: false, mode: 'cool', fan: 'low', coolC: 24, heatC: 20, d5: 0x33, d6: 6 }));
    const flat = []; STREAM.forEach((f, i) => { if (i === 4) flat.push(0x00, 0xFF); flat.push(...f); });
    for (let i = 0; i < flat.length; i += 7) ingestBytes(new Uint8Array(flat.slice(i, i + 7)));
    const U = a => units.find(u => u.addr === a);
    out.u1 = { on: U(1).on, mode: U(1).mode, fan: U(1).fan, cool: U(1).coolC, room: U(1).room, eev: U(1).eev, cap: U(1).capK, b5: U(1).c4b5, b6: U(1).c4b6, lo: bandLo(U(1)), hi: bandHi(U(1)) };
    out.u2 = { on: U(2).on, fan: U(2).fan, cool: U(2).coolC, lo: bandLo(U(2)), hi: bandHi(U(2)) };
    out.u3 = { on: U(3).on, cool: U(3).coolC };
    out.ack1 = rt(1).lockAck ? { b4: rt(1).lockAck.b4, b5: rt(1).lockAck.b5, b6: rt(1).lockAck.b6 } : null;
    const o = ODU.get(1); const us = o ? oduUnits(o) : [];
    const pick = u => u && ({ fw: u.fw, mode: u.mode, err: u.err, hp: u.hp, lp: u.lp, cond: u.cond, evap: u.evap, suct: u.suct, d1: u.disch1, d2: u.disch2, liq: u.liq, air: u.air, t1: u.inv1Target, hz1: u.inv1Hz, e1: u.eev1, e2: u.eev2, esc: u.eevSc, idus: u.idus, sh: u.sh, sc: u.sc, ratio: u.ratio, subs: u.subs, v1: u.inv1V, dc1: u.dc1, hpT: u.hpTarget, fan1: u.fan1 });
    out.oduMain = pick(us[0]); out.oduSub = pick(us[1]); out.oduPages = o ? Object.keys(o.pages).join(',') : '';
    out.oduHtml = oduSection().length > 500;
    out.logTypes = [...new Set(bus.log.map(d => d.type))].sort().join(',');
    return out;
  }, STREAM);
  await browser.close();

  const want = {
    c0_basic: '80 00 A0 31 03 20 07 2E', c0_swing: '80 00 A0 31 03 28 07 D6', c0_fanAuto: '80 00 A0 31 03 40 07 CE',
    c0_quietKept: '80 00 A0 31 03 50 07 FE', c0_hardLock: '80 00 A0 31 07 20 07 2A', c0_half: '84 00 A0 31 03 20 07 2A',
    c0_filterBitDropped: '80 00 A0 31 03 76 07 84', c0_read: '80 00 A0 31 01 20 07 2C',
    c4_none: 'A0 00 A0 C9 01 83 0F C9', c4_mode: 'A0 00 A0 5E 09 83 0F 6C', c4_all: 'A0 00 A0 5E 0F 85 08 6F', c4_band: 'A0 00 A0 01 03 84 0B 86', c4_rangeoff: 'A0 00 A0 01 01 83 0F 81', c4_unitOff: 'A0 00 A0 10 09 83 0F BE',
    c5: 'A8 00 A0 31 10 01 A5 0A 20 04 98 94 50 00 8C 31', c5dec: { cool: 24.5, heat: 20, twoset: true, cl: false, cs: true, occ: true, lim: '37.5,10,32,4' },
    reply: { addr: 0x2D, on: true, mode: 'cool', fan: 'low', set: 20, room: 21, pin: 11.3, pout: 19, eev: 40, cap: 12, load: 0x24, lock: false, swing: false },
    reply7: { mode: 'auto', side: 'heat', fan: 'auto', swing: true, lock: true },
    u1: { on: false, mode: 'cool', fan: 'low', cool: 20, room: 71, eev: 40, cap: 76, b5: 0x84, b6: 0x0B, lo: 19, hi: 26 },
    u2: { on: true, fan: 'high', cool: 22, lo: 18, hi: 24 }, u3: { on: true, cool: 20.5 },
    ack1: { b4: 0x00, b5: 0x04, b6: 0x0B },
    oduMain: { fw: '29.0', mode: 'cool', err: 0, hp: 2337, lp: 739, cond: 40.4, evap: 1.7, suct: 14.3, d1: 80, d2: 41, liq: 24.6, air: 34.3, t1: 41, hz1: 41, e1: 32, e2: 1944, esc: 40, idus: 4, sh: 12.6, sc: 15.8, ratio: 2.9, subs: 1, v1: 490, dc1: 660, hpT: 2337, fan1: 260 },
    oduSub: { fw: '29.0', mode: 'cool', err: 0, hp: 2337, lp: 752, cond: 40.4, evap: 2.2, suct: 16.3, d1: 78, d2: 41, liq: 25.7, air: 32.7, t1: 41, hz1: 41, e1: 32, e2: 1944, esc: 48, idus: 6, sh: 14.1, sc: 14.7, ratio: 2.86, subs: 1, v1: 490, dc1: 665, hpT: 0, fan1: 260 },
    oduPages: '0,2', oduHtml: true, logTypes: 'cmd,cmd4,lockack,reply,scan',
  };
  let fail = 0;
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(r[k]), b = JSON.stringify(want[k]);
    if (a === b) console.log('ok   ' + k); else { fail++; console.log('FAIL ' + k + '\n   got  ' + a + '\n   want ' + b); }
  }
  if (errors.length) { fail++; console.log('PAGE ERRORS:\n' + errors.join('\n')); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})();
