/*
 * EcoNet (Rheem / Ruud) — the wire format and the list of data points Cortex knows.
 *
 * Written for Cortex from how the bus behaves; no code is taken from any other project. The protocol
 * was worked out by the esphome-econet community (github.com/esphome-econet/esphome-econet), whose
 * research made this possible. See docs/ECONET.md.
 *
 * The bus: RS-485, 38400 baud, 8 data bits, no parity, 1 stop bit, on the equipment's RJ11 service port.
 * Unlike LG's bus there is no single master: the thermostat, the equipment and the Wi-Fi module all
 * ask each other questions. Cortex joins as one more voice, using the Wi-Fi module's address.
 *
 * A message:
 *   80 <dst hi mid lo> 00   80 <src hi mid lo> 00   <len> 00 00 <command>   <len bytes of data>   <crc lo> <crc hi>
 *   crc = CRC-16/ARC (reflected 0xA001, start 0) over everything before it.
 * Commands: 0x1E read, 0x1F write, 0x06 "here is your answer / done", 0x15 "no".
 * Every value has an 8-letter name (SPT, COOLSETP, WHTRSETP ...).
 *
 * Pure functions only; the serial port lives in econetlink.js. Tested by tests/econet.test.js.
 */
'use strict';
const CMD = { ACK: 0x06, NAK: 0x15, READ: 0x1E, WRITE: 0x1F };
const TYPE = { NUM: 0, TEXT: 1, ENUM: 2, RAW: 4, NONE: 21 };
const HEAD = 14, NAME = 8, MAX_NAMES = 10;      // 10 names per question keeps every answer comfortably inside one message
const SERIAL = { baud: 38400, parity: 'none', stop: 1, data: 8 };
const ADDR = { WIFI: 0x340, THERMOSTAT: 0x380, FURNACE: 0x1C0, OUTDOOR: 0x400, TANKLESS: 0x1040, ELECTRIC_TANK: 0x1200, HEAT_PUMP_WH: 0x1280 };

function crc16(bytes, n) { let c = 0; n = n == null ? bytes.length : n;
  for (let i = 0; i < n; i++) { c ^= bytes[i]; for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xA001) : (c >>> 1); }
  return c & 0xFFFF; }
const addrBytes = (a) => [0x80, (a >>> 16) & 0xFF, (a >>> 8) & 0xFF, a & 0xFF, 0x00];
const okAddr = (a) => Number.isInteger(a) && a > 0 && a <= 0xFFFFFF;
const okName = (s) => typeof s === 'string' && /^[A-Z0-9_]{1,8}$/.test(s);
function nameBytes(s) { const o = []; for (let i = 0; i < NAME; i++) o.push(i < s.length ? s.charCodeAt(i) : 0); return o; }
function nameFrom(b, at) { let s = ''; for (let i = 0; i < NAME; i++) { const c = b[at + i]; if (c > 32 && c < 127) s += String.fromCharCode(c); } return s; }
function floatBytes(v) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, false); return [d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3)]; }
function floatFrom(b, at) { const d = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) d.setUint8(i, b[at + i]); return d.getFloat32(0, false); }

/* ---- building messages ---- */
function frame(dst, src, cmd, data) {
  if (!okAddr(dst) || !okAddr(src)) throw new Error('bad address'); data = data || [];
  if (data.length > 255) throw new Error('too much data for one message');
  const f = addrBytes(dst).concat(addrBytes(src), [data.length, 0, 0, cmd & 0xFF], data), c = crc16(f); f.push(c & 0xFF, c >>> 8); return f; }
/* "Tell me these values." Several names in one question (class 2). */
function readFrame(dst, src, names) {
  if (!Array.isArray(names) || !names.length || names.length > 25 || !names.every(okName)) throw new Error('bad value names');
  const d = [2, 1]; for (const n of names) d.push(0, 0, ...nameBytes(n)); return frame(dst, src, CMD.READ, d); }
/* "Set this value." A number, or the number of a choice in a list. */
function writeFrame(dst, src, name, value, isChoice) {
  if (!okName(name) || typeof value !== 'number' || !isFinite(value)) throw new Error('bad value');
  return frame(dst, src, CMD.WRITE, [1, 1, isChoice ? TYPE.ENUM : TYPE.NUM, 1, 0, 0, ...nameBytes(name), ...floatBytes(value)]); }

/* ---- reading messages ---- */
/* One checked message from the start of `b`, or null. -> { dst, src, cmd, data, len } */
function parseFrame(b) {
  if (b.length < HEAD + 2 || b[0] !== 0x80 || b[5] !== 0x80) return null;
  const n = b[10], total = HEAD + n + 2; if (b.length < total) return null;
  const c = b[HEAD + n] | (b[HEAD + n + 1] << 8); if (c !== crc16(b, HEAD + n)) return null;
  return { dst: (b[1] << 16) | (b[2] << 8) | b[3], src: (b[6] << 16) | (b[7] << 8) | b[8], cmd: b[13], data: Array.from(b.slice(HEAD, HEAD + n)), len: total }; }
/* Bytes arrive in pieces and other things talk on the wire: feed everything in, get whole checked messages out. */
function createParser(onFrame, onJunk) { let buf = [];
  const junk = (n) => { if (n > 0 && onJunk) onJunk(n); };
  return { push(bytes) { for (const x of bytes) buf.push(x);
      for (;;) { let keep = -1, hit = false;
        for (let i = 0; i + 6 <= buf.length || (keep < 0 && i < buf.length); i++) {
          if (buf[i] !== 0x80) continue;
          if (i + HEAD + 2 > buf.length) { if (i + 5 >= buf.length || buf[i + 5] === 0x80) { if (keep < 0) keep = i; } continue; }   // too short to judge yet
          if (buf[i + 5] !== 0x80) continue;
          const total = HEAD + buf[i + 10] + 2;
          if (i + total > buf.length) { if (keep < 0) keep = i; continue; }                // maybe a message still arriving; keep looking past it
          const f = parseFrame(buf.slice(i, i + total)); if (!f) continue;
          junk(i); buf.splice(0, i + total); onFrame(f); hit = true; break; }
        if (hit) continue;
        if (keep < 0) { junk(buf.length); buf = []; } else if (keep > 0) { junk(keep); buf.splice(0, keep); }
        if (buf.length > 600) { junk(buf.length - 300); buf.splice(0, buf.length - 300); }
        return; } },
    reset() { junk(buf.length); buf = []; }, get pending() { return buf.length; } }; }
/* The names asked for in a read. */
function readNames(data) { const out = []; if (!data || data.length < 2) return null; const cls = data[0] & 0x7F; if (data[1] !== 1 || (cls !== 1 && cls !== 2)) return null;
  for (let i = 4; i + NAME <= data.length; i += NAME + 2) { const n = nameFrom(data, i); if (n) out.push(n); }
  return out.length ? { cls, names: out } : null; }
/* One value out of an answer. -> { type, value, text } or null */
function parseItem(p) {
  if (!p || p.length < 1) return null; const t = p[0] & 0x7F;
  if (t === TYPE.NUM) { if (p.length !== 7) return null; const v = floatFrom(p, 3); return { type: 'num', value: isFinite(v) ? v : null }; }
  if (t === TYPE.TEXT) { if (p.length < 3) return null; return { type: 'text', text: String.fromCharCode(...p.slice(3).filter(c => c >= 32 && c < 127)).trim() }; }
  if (t === TYPE.ENUM) { if (p.length < 5 || p[4] !== p.length - 5) return null; return { type: 'enum', value: p[3], text: String.fromCharCode(...p.slice(5).filter(c => c >= 32 && c < 127)).trim() }; }
  if (t === TYPE.NONE) return { type: 'none' };
  return { type: 'raw', raw: Array.from(p) }; }
/* The values in an answer to a several-name question, in the order they were asked. null if it does not add up. */
function parseAnswer(data, count) { const out = []; let i = 0;
  while (i < data.length) { const n = data[i]; if (!n || i + 1 + n > data.length) return null; out.push(parseItem(data.slice(i + 1, i + 1 + n))); i += n + 1; }
  return out.length === count ? out : null; }
/* What a write asks for. -> { name, value, isChoice } or null */
function parseWrite(data) { if (!data || data.length !== 6 + NAME + 4 || (data[0] & 0x7F) !== 1 || data[1] !== 1) return null; const t = data[2] & 0x7F; if (t !== TYPE.NUM && t !== TYPE.ENUM) return null;
  return { name: nameFrom(data, 6), value: floatFrom(data, 6 + NAME), isChoice: t === TYPE.ENUM }; }
/* Building an answer: used by the pretend equipment in tests and the demo. */
function itemBytes(v) { let p;
  if (v == null || v.type === 'none') p = [TYPE.NONE];
  else if (v.type === 'num') p = [TYPE.NUM, 0, 0, ...floatBytes(v.value)];
  else if (v.type === 'text') p = [TYPE.TEXT, 0, 0, ...[...String(v.text)].map(c => c.charCodeAt(0))];
  else { const t = [...String(v.text || '')].map(c => c.charCodeAt(0)); p = [TYPE.ENUM, 0, 0, v.value & 0xFF, t.length, ...t]; }
  return [p.length, ...p]; }
const answerFrame = (dst, src, values) => frame(dst, src, CMD.ACK, [].concat(...values.map(itemBytes)));
const hex = (b) => Array.from(b).map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/* ---- what Cortex knows how to show and change, per kind of equipment ----
   n = the value's name on the bus; at = which device answers for it; w = how it may be changed. Temperatures are °F on the bus. */
const T = ADDR.THERMOSTAT, O = ADDR.OUTDOOR, F = ADDR.FURNACE;
const num = (n, label, unit, o) => Object.assign({ n, label, unit: unit || '', kind: 'num' }, o || {});
const pick = (n, label, options, o) => Object.assign({ n, label, kind: 'enum', options }, o || {});
const txt = (n, label, o) => Object.assign({ n, label, kind: 'text', slow: true }, o || {});
const ALARMS = [num('ALRMALRT', 'Active alarms', '', { group: 'alarms' }), txt('ALARM_01', 'Alarm 1', { group: 'alarms', slow: false }), txt('ALARM_02', 'Alarm 2', { group: 'alarms', slow: false }),
  txt('ALARM_03', 'Alarm 3', { group: 'alarms', slow: false }), txt('ALARM_04', 'Alarm 4', { group: 'alarms', slow: false }), txt('ALARMH01', 'Last alarm', { group: 'alarms' }), txt('ALARMH02', 'Alarm before that', { group: 'alarms' })];
const WH_COMMON = [
  num('WHTRSETP', 'Water temperature setting', '°F', { group: 'main', role: 'setpoint', w: { min: 90, max: 140, step: 1 } }),
  pick('WHTRENAB', 'Water heater', { 0: 'Off', 1: 'On' }, { group: 'main', role: 'power', w: true }),
  txt('PRODMODN', 'Model number', { group: 'about' }), txt('PRODSERN', 'Serial number', { group: 'about' })];
const TANK = [
  num('UPHTRTMP', 'Upper tank temperature', '°F', { group: 'main', role: 'temp' }), num('LOHTRTMP', 'Lower tank temperature', '°F', { group: 'readings' }),
  num('HOTWATER', 'Hot water available', '%', { group: 'main' }), num('POWRWATT', 'Power', 'W', { group: 'readings' }),
  pick('WHTRMODE', 'Doing now', null, { group: 'main', role: 'action' }), pick('HEATCTRL', 'Heating element', null, { group: 'readings' }),
  pick('VACA_NET', 'Vacation', { 0: 'Off', 1: 'Timed', 2: 'Permanent' }, { group: 'settings', w: true }),
  num('HRSUPHTR', 'Upper element run time', 'h', { group: 'readings', slow: true }), num('HRSLOHTR', 'Lower element run time', 'h', { group: 'readings', slow: true })];
const KINDS = {
  hvac: { label: 'Heating & cooling system', main: T, points: [
    num('SPT', 'Room temperature', '°F', { at: T, group: 'main', role: 'temp' }),
    num('HEATSETP', 'Heat to', '°F', { at: T, group: 'main', role: 'heat', w: { min: 50, max: 90, step: 0.5 } }),
    num('COOLSETP', 'Cool to', '°F', { at: T, group: 'main', role: 'cool', w: { min: 50, max: 90, step: 0.5 } }),
    pick('STATMODE', 'Mode', { 0: 'Heat', 1: 'Cool', 2: 'Auto', 3: 'Fan only', 4: 'Off' }, { at: T, group: 'main', role: 'mode', w: true }),
    pick('HVACMODE', 'Doing now', { 0: 'Idle', 1: 'Fan', 2: 'Cooling (low)', 3: 'Cooling (high)', 4: 'Heating (low)', 5: 'Heating (high)' }, { at: T, group: 'main', role: 'action' }),
    pick('SCHEDULE', 'Follow the thermostat schedule', { 0: 'No', 1: 'Yes' }, { at: T, group: 'main', role: 'schedule', w: true }),
    pick('STAT_FAN', 'Fan (while following the schedule)', { 0: 'Auto', 1: 'Speed 1 (low)', 2: 'Speed 2', 3: 'Speed 3 (medium)', 4: 'Speed 4', 5: 'Speed 5 (high)' }, { at: T, group: 'main', role: 'fan', w: true }),
    pick('STATNFAN', 'Fan (when not following the schedule)', { 0: 'Auto', 1: 'Speed 1 (low)', 2: 'Speed 2', 3: 'Speed 3 (medium)', 4: 'Speed 4', 5: 'Speed 5 (high)' }, { at: T, group: 'main', role: 'fan2', w: true }),
    num('RELH7005', 'Humidity', '%', { at: T, group: 'main', role: 'humidity' }),
    num('DHUMSETP', 'Dehumidify to', '%', { at: T, group: 'settings', w: { min: 10, max: 80, step: 1 } }),
    pick('DHUMENAB', 'Dehumidification', { 0: 'Off', 1: 'On' }, { at: T, group: 'settings', w: true }),
    pick('AUTOMODE', 'Auto mode is', null, { at: T, group: 'readings' }),
    num('F_ACTCFM', 'Airflow', 'CFM', { at: T, group: 'air' }), num('F_ACTRPM', 'Blower speed', 'RPM', { at: T, group: 'air' }), num('STATIC_P', 'Static pressure', 'in. w.c.', { at: T, group: 'air' }),
    num('TEMP_LAT', 'Supply air temperature', '°F', { at: T, group: 'air' }), num('TEMP_RAT', 'Return air temperature', '°F', { at: T, group: 'air' }), num('ECM_WATT', 'Blower power', 'W', { at: T, group: 'air' }),
    pick('FAN_MODE', 'Fan run time', { 0: 'Continuous', 1: '10 min each hour', 2: '20 min each hour', 3: '30 min each hour', 4: '40 min each hour' }, { at: T, group: 'settings', slow: true, w: true }),
    num('TEMPOFFS', 'Temperature offset', '°F', { at: T, group: 'settings', slow: true }), num('DEADBAND', 'Dead band', '°F', { at: T, group: 'settings', slow: true }),
    num('TEMP_OAT', 'Outdoor air temperature', '°F', { at: O, group: 'outdoor' }), num('PRES_SUC', 'Suction pressure', 'psi', { at: O, group: 'outdoor' }), num('PRES_LIQ', 'Liquid pressure', 'psi', { at: O, group: 'outdoor' }),
    num('TEMP_OST', 'Suction line temperature', '°F', { at: O, group: 'outdoor' }), num('TEMP_SST', 'Saturated suction temperature', '°F', { at: O, group: 'outdoor' }), num('TEMP_OLT', 'Liquid line temperature', '°F', { at: O, group: 'outdoor' }),
    num('TEMP_EVP', 'Outdoor coil temperature', '°F', { at: O, group: 'outdoor' }), num('EXVSUPER', 'Superheat', '°F', { at: O, group: 'outdoor' }), num('EXACTUAL', 'Expansion valve', '%', { at: O, group: 'outdoor' }),
    num('ISCSPEED', 'Compressor speed', '', { at: O, group: 'outdoor' }), num('IS_COMPC', 'Compressor current', 'A', { at: O, group: 'outdoor' }), num('ISACINPV', 'Outdoor unit voltage', 'V', { at: O, group: 'outdoor' }),
    num('ODU_POWR', 'Outdoor unit power', 'W', { at: O, group: 'outdoor' }), num('LOCKTIMR', 'Lockout timer', 's', { at: O, group: 'outdoor' }),
    num('FURNSTMP', 'Furnace supply air temperature', '°F', { at: F, group: 'furnace' }), num('FURNRTMP', 'Furnace return air temperature', '°F', { at: F, group: 'furnace' }),
    txt('PRODMODN', 'Outdoor unit model', { at: O, group: 'about' }), txt('PRODSERN', 'Outdoor unit serial', { at: O, group: 'about' })].concat(ALARMS.map(a => Object.assign({ at: T }, a))) },
  hpwh: { label: 'Heat pump water heater', main: ADDR.HEAT_PUMP_WH, points: WH_COMMON.concat(TANK, [
    pick('WHTRCNFG', 'Mode', { 0: 'Off', 1: 'Eco', 2: 'Heat pump', 3: 'High demand', 4: 'Electric' }, { group: 'main', role: 'mode', w: true }),
    num('AMBIENTT', 'Air temperature', '°F', { group: 'readings' }), num('EVAPTEMP', 'Evaporator temperature', '°F', { group: 'readings' }), num('SUCTIONT', 'Suction temperature', '°F', { group: 'readings' }),
    num('DISCTEMP', 'Discharge temperature', '°F', { group: 'readings' }), pick('COMP_RLY', 'Compressor', null, { group: 'readings' }), pick('FAN_CTRL', 'Fan', null, { group: 'readings' }),
    num('TOTALKWH', 'Energy used', 'kWh', { group: 'readings', slow: true }), num('HRS_COMP', 'Compressor run time', 'h', { group: 'readings', slow: true })], ALARMS) },
  etwh: { label: 'Electric tank water heater', main: ADDR.ELECTRIC_TANK, points: WH_COMMON.concat(TANK, [
    pick('WHTRCNFG', 'Mode', { 0: 'Energy saver', 1: 'Performance' }, { group: 'main', role: 'mode', w: true })], ALARMS) },
  tankless: { label: 'Tankless water heater', main: ADDR.TANKLESS, points: WH_COMMON.concat([
    num('TEMP_OUT', 'Outlet temperature', '°F', { group: 'main', role: 'temp' }), num('TEMP__IN', 'Inlet temperature', '°F', { group: 'readings' }), num('FLOWRATE', 'Flow', '', { group: 'main' }),
    num('WTR_USED', 'Water used', '', { group: 'readings', slow: true }), num('WTR_BTUS', 'Heat used', 'BTU', { group: 'readings', slow: true }), num('IGNCYCLS', 'Ignition cycles', '', { group: 'readings', slow: true })], ALARMS) },
};
for (const k of Object.keys(KINDS)) KINDS[k].points.forEach(p => { if (!p.at) p.at = KINDS[k].main; });
const pointOf = (kind, name, at) => { const K = KINDS[kind]; return (K && K.points.find(p => p.n === name && (at == null || p.at === at))) || null; };
/* Is this change allowed? -> { ok, value, isChoice, at } or { ok:false, err } */
function checkWrite(kind, name, value) { const p = pointOf(kind, name); if (!p || !p.w) return { ok: false, err: 'that value cannot be changed from Cortex' };
  const v = Number(value); if (!isFinite(v)) return { ok: false, err: 'not a number' };
  if (p.kind === 'enum') { if (!p.options || !Object.prototype.hasOwnProperty.call(p.options, String(v))) return { ok: false, err: 'not one of the choices' }; return { ok: true, value: v, isChoice: true, at: p.at }; }
  if (v < p.w.min || v > p.w.max) return { ok: false, err: 'outside ' + p.w.min + ' to ' + p.w.max + (p.unit ? ' ' + p.unit : '') };
  return { ok: true, value: Math.round(v / p.w.step) * p.w.step, isChoice: false, at: p.at }; }

module.exports = { CMD, TYPE, ADDR, SERIAL, KINDS, MAX_NAMES, crc16, frame, readFrame, writeFrame, answerFrame, parseFrame, createParser, readNames, parseItem, parseAnswer, parseWrite, pointOf, checkWrite, okName, okAddr, hex };
