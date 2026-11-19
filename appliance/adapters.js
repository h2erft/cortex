'use strict';
/* The USB serial adapters plugged into this controller, described so a person can pick the right one.

   Linux gives every USB serial port a stable name under /dev/serial/by-id that does not change when it is
   replugged or the controller restarts (ttyUSB0 / ttyACM0 can swap). An adapter with several RS-485 channels,
   such as the Waveshare "USB TO 4CH RS485" (CH344 chip), shows up as several of those names that differ only
   in their interface number: ...-if00, -if02, -if04, -if06. Each one is its own independent wire, so each can
   carry a different bus (the LG bus on one, a Rheem / Ruud system on another). They are numbered here in
   interface order, which is the order the terminals are numbered on the case. */
const fs = require('fs'), path = require('path');
const KNOWN = [
  [/^1a86_USB_Quad_Serial/i, 'Waveshare 4-channel RS485 (CH344)'],
  [/^1a86_USB_Dual_Serial/i, '2-channel RS485 (CH342)'],
  [/^1a86_USB_Single_Serial|^1a86_USB_Serial|^1a86_USB2\.0-Ser/i, 'USB RS485 adapter (CH34x)'],
  [/^FTDI_Quad_RS232-HS|^FTDI_FT4232/i, '4-channel serial adapter (FT4232)'],
  [/^FTDI_Dual_RS232-HS|^FTDI_FT2232/i, '2-channel serial adapter (FT2232)'],
  [/^FTDI_/i, 'USB RS485 adapter (FTDI)'],
  [/^Silicon_Labs_CP210/i, 'USB RS485 adapter (CP210x)'],
  [/^Prolific_/i, 'USB serial adapter (Prolific)'],
];
/* names: the file names in /dev/serial/by-id.  ->  [{ name, device, model, channel, channels, label }] in a steady order */
function describe(names) {
  const rows = (names || []).filter(n => typeof n === 'string' && n).map(n => {
    const m = /^(?:usb-)?(.*?)-if(\d+)(?:-port(\d+))?$/i.exec(n), device = m ? m[1] : n.replace(/^usb-/, '');
    return { name: n, device, iface: m ? parseInt(m[2], 10) * 100 + (m[3] ? parseInt(m[3], 10) : 0) : 0 };
  });
  const groups = new Map(); for (const r of rows) { if (!groups.has(r.device)) groups.set(r.device, []); groups.get(r.device).push(r); }
  const modelOf = d => { const k = KNOWN.find(k => k[0].test(d)); return k ? k[1] : null; }, seen = new Map(), twins = new Set();   // two of the same adapter: tell them apart by serial number
  for (const d of groups.keys()) { const m = modelOf(d); if (!m) continue; if (seen.has(m)) twins.add(m); seen.set(m, 1); }
  const out = [];
  for (const dev of [...groups.keys()].sort()) {
    const g = groups.get(dev).sort((a, b) => a.iface - b.iface || a.name.localeCompare(b.name));
    const known = KNOWN.find(k => k[0].test(dev)), model = known ? known[1] : dev.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const serial = (/_([A-Za-z0-9]{6,})$/.exec(dev) || [])[1] || '';
    g.forEach((r, i) => out.push({ name: r.name, device: dev, model, channel: g.length > 1 ? i + 1 : 0, channels: g.length,
      label: model + (g.length > 1 ? ' · channel ' + (i + 1) + ' of ' + g.length : '') + (twins.has(model) && serial ? ' · no. ' + serial.slice(-4) : '') }));
  }
  return out;
}
function list(dir) {
  dir = dir || process.env.CORTEX_SERIAL_DIR || '/dev/serial/by-id';
  let names = []; try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return describe(names).map(a => { const p = path.join(dir, a.name); let dev = p; try { dev = fs.realpathSync(p); } catch (_) {} return Object.assign(a, { path: p, dev }); });
}
module.exports = { describe, list, KNOWN };
