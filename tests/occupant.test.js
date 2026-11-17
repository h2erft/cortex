// Occupant view rules. No bus, no server: only the decisions in appliance/occupant.js.
//   node tests/occupant.test.js
const { createOccupant, cleanRooms } = require('../appliance/occupant');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
const KEY = 'abcdefghijklmnop1234', KEY2 = 'zyxwvutsrqponmlk9876';
let cfg, units, sent, ready, t;
const reset = () => { t = 100000; sent = []; ready = true;
  cfg = { site: { name: 'Tower', unit: 'F' }, unitMeta: { AC_UNIT_11: { alias: 'Unit 4B living' } },
    occupant: { on: true, rooms: [{ id: 'r1', key: KEY, name: 'Apartment 4B', addrs: [0x11, 0x12], loC: 20, hiC: 25 }, { id: 'r2', key: KEY2, name: 'Lobby', addrs: [0x20], loC: 21, hiC: 23, power: false }] } };
  units = [{ id: 1, addr: 0x11, name: 'AC_UNIT_11', on: true, mode: 'cool', room: 74, coolC: 23, heatC: 20, hardLock: true, errLog: [1] }, { id: 2, addr: 0x12, name: 'AC_UNIT_12', label: 'Bedroom', on: false, mode: 'heat', room: 70, coolC: 24, heatC: 21 },
    { id: 3, addr: 0x20, name: 'AC_UNIT_20', on: true, mode: 'cool', room: 72, coolC: 22 }, { id: 4, addr: 0x30, name: 'AC_UNIT_30', on: true, mode: 'cool', room: 72, coolC: 22 }]; };
const mk = () => createOccupant({ getCfg: () => cfg, getUnits: () => units, queue: (a, s) => sent.push([a, s]), ready: () => ready, now: () => t });

reset(); let o = mk();
// off by default / off when switched off / unknown key: all the same 404, nothing leaks
cfg.occupant.on = false; eq('off -> 404', o.state(KEY).status, 404); eq('off -> no command', o.command(KEY, { setC: 22 }).status, 404); eq('off sends nothing', sent.length, 0);
delete cfg.occupant; eq('never set up -> 404', o.state(KEY).status, 404);
reset(); o = mk();
eq('unknown key', o.state('abcdefghijklmnop0000').status, 404); eq('junk key', o.state('../../etc').status, 404); eq('empty key', o.state('').status, 404);
// state: only this room's units, only what an occupant needs
let s = o.state(KEY).body;
eq('room name', [s.name, s.site, s.unit, s.loC, s.hiC, s.power], ['Apartment 4B', 'Tower', 'F', 20, 25, true]);
eq('room units', s.units.map(u => [u.addr, u.name, u.on, u.setC, u.roomF]), [[17, 'Unit 4B living', true, 23, 74], [18, 'Bedroom', false, 21, 70]]);
eq('no extra fields', Object.keys(s.units[0]).sort().join(), 'addr,fan,fault,mode,name,offline,on,roomF,setC');
// commands: clamped to the room's limits, only this room's units
eq('set inside', [o.command(KEY, { setC: 22.5 }).body.setC, sent.map(x => x[0]).join(), sent[0][1]], [22.5, '17,18', { coolC: 22.5, heatC: 22.5 }]);
sent = []; t += 5000; eq('set too low is clamped', [o.command(KEY, { setC: 10 }).body.setC, sent[0][1].coolC], [20, 20]);
sent = []; t += 5000; eq('set too high is clamped', o.command(KEY, { setC: 99 }).body.setC, 25);
sent = []; t += 5000; eq('one unit', [o.command(KEY, { addr: 0x12, on: true }).status, sent], [200, [[18, { on: true }]]]);
sent = []; t += 5000; eq('other room unit refused', [o.command(KEY, { addr: 0x20, on: false }).status, sent.length], [403, 0]);
t += 5000; eq('unit outside every room refused', [o.command(KEY, { addr: 0x30, setC: 22 }).status, sent.length], [403, 0]);
t += 5000; eq('mode refused unless allowed', [o.command(KEY, { mode: 'heat' }).status, sent.length], [403, 0]);
t += 5000; eq('power refused when not allowed', [o.command(KEY2, { on: false }).status, sent.length], [403, 0]);
t += 5000; eq('nothing to change', o.command(KEY, {}).status, 400);
t += 5000; eq('bad temperature', o.command(KEY, { setC: 'hot' }).status, 400);
// extra fields never pass through (locks, filter reset, anything else)
sent = []; t += 5000; o.command(KEY, { setC: 22, hardLock: false, filterReset: true, fan: 'high', c4b5: 0x8F }); eq('only on/set pass through', Object.keys(sent[0][1]).sort().join(), 'coolC,heatC');
// rate limit and readiness
sent = []; t += 5000; o.command(KEY, { setC: 22 }); eq('second change too soon', o.command(KEY, { setC: 23 }).status, 429);
t += 5000; ready = false; sent = []; eq('controller not connected', [o.command(KEY, { setC: 22 }).status, sent.length], [503, 0]); ready = true;
t += 5000; units[0].offline = true; units[1].offline = true; eq('unit not answering', o.command(KEY, { setC: 22 }).status, 409);
// room list cleaning
eq('clean rooms', cleanRooms([{ key: 'short', addrs: [1] }, { key: KEY, addrs: [] }, { key: KEY, addrs: [1, 1, 999, 'x', 2], loC: 5, hiC: 99, name: 'A' }, { key: KEY, addrs: [3] }, null]).map(r => [r.addrs, r.loC, r.hiC]), [[[1, 2], 16, 30]]);
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
