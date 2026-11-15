// Offline test for the LG service-port (LGMV port) decoder in uart-sniffer.html. Nothing is transmitted.
//   node tests/uart.test.js
// Frames are a short recorded-style cycle (2400 8N1, 02 <len> <type> … <crc>); expected values were
// produced by an independent reference decoder for the same bytes.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const hex = s => s.trim().split(/\s+/).map(x => parseInt(x, 16));
const RX = [
  '02 1f 64 1e 12 1f 00 4a 0c 0a 0e 1f 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 03 01 f3',
  '02 43 65 41 25 25 00 00 08 08 08 62 57 00 00 96 00 42 01 c3 04 f3 06 01 01 08 7b 62 57 6b cd e7 00 4e 48 4c a8 73 4d a4 00 03 40 15 63 00 62 00 00 00 00 43 00 00 00 00 00 00 00 87 8a 63 1f a1 00 27 51',
  '02 43 66 40 25 25 00 00 08 08 08 00 00 00 00 96 00 42 01 c3 04 f3 06 01 01 08 75 61 58 61 ce e0 00 5d 46 4c a7 64 51 a4 00 03 40 14 64 00 63 00 00 00 00 40 00 00 00 00 00 00 00 88 8b 5f 24 bd 00 75 ff',
  '02 20 69 2e 28 38 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 19',
  '02 11 6a 01 00 1d 18 8c 00 80 a4 a7 00 00 32 02 74',
  '02 11 6a 02 00 00 18 28 00 85 96 a9 00 00 33 04 d8',
  '02 11 6a 03 00 3d 18 9c 00 85 a9 a8 00 00 3c 02 9d',
  '02 16 6e 41 03 00 0c 55 76 ac aa 01 02 03 00 00 00 00 00 00 00 c3',
  '02 0e 6b 02 08 01 01 08 3a 00 00 00 00 5a',
].map(hex);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'uart-sniffer.html')); await page.waitForTimeout(400);
  const r = await page.evaluate((RX) => {
    const S = window.__sniff, H = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
    const flat = [0xFF, 0x02]; RX.forEach((f, i) => { if (i === 3) flat.push(0x02, 0x05, 0x00); flat.push(...f); });   // junk + a false start mixed in
    for (let i = 0; i < flat.length; i += 5) S.ingest(new Uint8Array(flat.slice(i, i + 5)));
    S.renderDecoded();
    const r1 = x => Math.round(x * 10) / 10, F = c => Math.round((c * 1.8 + 32) * 100) / 100, psi = k => Math.round(k * 0.1450377 * 100) / 100;
    const m = S.LG.odu[0x65], s = S.LG.odu[0x66], i1 = S.LG.idu[1], i3 = S.LG.idu[3], b = S.LG.hr[1];
    return {
      hello: H(S.LGMV_HELLO), poll: H(S.LGMV_POLL), frames: S.LG.frames, census: Object.keys(S.LG.census).sort().join(','),
      product: [S.LG.product.product, S.LG.product.idus, S.LG.product.hrs, S.LG.product.units.map(u => u.unit + ':' + u.capacity + ':' + u.fw).join('|'), S.LG.product.units[0].eeprom].join(' '),
      main: { mode: m.mode, t: m.inv1Target, hz: m.inv1Hz, fan: m.fan1, sub: m.eevSub, sc: m.eevSc, air: F(m.air), hp: psi(m.hp), cond: F(m.cond), lp: psi(m.lp), evap: F(m.evap), suct: F(m.suct), d1: F(m.disch1), d2: F(m.disch2), liq: F(m.liq), scIn: F(m.scIn), v: m.inv1V, dc: m.dc1, ipm: F(m.ipm1), a: m.inv1A, pa: m.inv1PhaseA, vs: m.valveSuction },
      sub: { mode: s.mode, air: F(s.air), hp: psi(s.hp), suct: F(s.suct), d1: F(s.disch1), dc2: s.dc2 },
      idu1: { addr: i1.addr, on: i1.on, mode: i1.mode, fan: i1.fan, cap: i1.capacity, eev: i1.eev, room: F(i1.room), pin: F(i1.pipeIn), pout: F(i1.pipeOut), err: i1.err },
      idu3: { addr: i3.addr, fan: i3.fan, eev: i3.eev }, idu2on: S.LG.idu[2].on,
      hr: { eev: b.eevSc, pipes: b.pipes.join('/'), liq: r1(b.liqIn), scIn: r1(b.scIn), scOut: r1(b.scOut), ports: JSON.stringify(b.ports), set: b.setIdus },
      step: [S.LG.step.comp, S.LG.step.fan, S.LG.step.eev, S.LG.step.scEev, S.LG.step.dischTargetC].join(','),
      html: document.getElementById('dec').innerHTML.includes('High pressure') && document.getElementById('dec').innerHTML.includes('HR box'),
      pollDisabled: document.getElementById('poll').disabled, sum: [1, 2, 3, 4].map(i => S.LG.sum[i]).join(','), dT: i1.dT,
      quiet: [0x64, 0x6b, 0x65].map(t => S.pollReplyFor(t)).join(','),
      seq: (S.setPolling(true), [0x64, 0x64, 0x64, 0x65, 0x6a, 0x6b, 0x64].map(t => { const r = S.pollReplyFor(t); return r ? r[2] : 0; }).join('')),
      either: S.lgmvCrcOk(new Uint8Array([0x02, 0x05, 0x10, 0x00, 0x00])) === false,
    };
  }, RX);
  await browser.close();
  const want = {
    hello: '02 0e 01 00 00 00 00 00 00 00 00 00 00 b3', poll: '02 0e 02 00 00 00 00 00 00 00 00 00 00 26', frames: 9, census: '64,65,66,69,6A,6B,6E',
    product: '30 3 1 main:18:31.0|sub 1:14:31.0 74.12.10',
    main: { mode: 'COOL', t: 37, hz: 37, fan: 80, sub: 1944, sc: 48, air: 72.32, hp: 343.59, cond: 105.62, lp: 116.61, evap: 39.38, suct: 55.22, d1: 127.4, d2: 84.2, liq: 103.46, scIn: 43.88, v: 495, dc: 675, ipm: 210.2, a: 4.2, pa: 13.4, vs: 1 },
    sub: { mode: 'OFF', air: 75.92, hp: 338.95, suct: 61.34, d1: 125.6, dc2: 695 },
    idu1: { addr: 50, on: 1, mode: 5, fan: 1, cap: 24, eev: 140, room: 69.44, pin: 46.4, pout: 44.42, err: 0 },
    idu3: { addr: 60, fan: 3, eev: 156 }, idu2on: 0,
    hr: { eev: 96, pipes: 'COOL/COOL/COOL/COOL', liq: 23.5, scIn: 5.2, scOut: 5.9, ports: '{"1":[1,2,3]}', set: 3 },
    step: '2,8,1,1,58', html: true, pollDisabled: true, sum: '46,40,56,0', dT: -1.1, quiet: ',,', seq: '1120022', either: true,
  };
  let fail = 0;
  for (const k of Object.keys(want)) { const a = JSON.stringify(r[k]), b = JSON.stringify(want[k]); if (a === b) console.log('ok   ' + k); else { fail++; console.log('FAIL ' + k + '\n   got  ' + a + '\n   want ' + b); } }
  if (errors.length) { fail++; console.log('PAGE ERRORS:\n' + errors.join('\n')); }
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
