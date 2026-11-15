#!/usr/bin/env node
/*
 * Cortex UART Wi-Fi bridge  —  lets a browser read the LG Wi-Fi LGMV module.
 *
 * The Wi-Fi module is a transparent TCP bridge to the outdoor unit's service UART:
 * it is 192.168.1.1 port 9999 on its own open Wi-Fi network (LGE_MV-xx-xx-xx), and
 * every byte of the 02 <len> <type> ... service frames crosses it unchanged
 * (field-verified; see docs/UART_SERVICE_PORT.md). A browser can't open a raw TCP
 * socket, so this tiny server does it and relays the bytes over a WebSocket. It also
 * serves the UART tool page, so one command and one URL are all you need.
 *
 * No npm packages — only Node's built-ins.
 *
 *   1. Close LGMV-Business (the module allows ONE connection at a time).
 *   2. Join the module's Wi-Fi (LGE_MV-..., open network).
 *   3. node tools/uart-wifi-bridge.js
 *   4. Open http://localhost:8899 in Chrome or Edge.
 *
 * Options (environment variables):
 *   MODULE_HOST   outdoor-unit module address   (default 192.168.1.1)
 *   MODULE_PORT   its TCP port                   (default 9999)
 *   PORT          local port for this bridge     (default 8899)
 *
 * This bridge only moves bytes. It never injects anything of its own onto the bus;
 * the only thing the browser ever transmits is LGMV's two monitoring requests, and
 * only when you tick "Ask the outdoor unit for live data" in the page.
 */
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODULE_HOST = process.env.MODULE_HOST || '192.168.1.1';
const MODULE_PORT = parseInt(process.env.MODULE_PORT || '9999', 10);
const PORT = parseInt(process.env.PORT || '8899', 10);
const PAGE = path.join(__dirname, '..', 'uart-sniffer.html');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/uart-sniffer.html' || req.url.split('?')[0] === '/index.html')) {
    fs.readFile(PAGE, (err, buf) => {
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('uart-sniffer.html not found next to the Cortex folder: ' + err.message); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
});

// ---- minimal WebSocket server (RFC 6455), binary frames only ----
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  let tcp = null, closed = false, inbuf = Buffer.alloc(0);
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  const shut = (why) => {
    if (closed) return; closed = true;
    if (why) log('closing:', why);
    try { socket.end(); } catch (_) {}
    try { if (tcp) tcp.destroy(); } catch (_) {}
  };

  // connect to the module
  log(`browser connected — opening ${MODULE_HOST}:${MODULE_PORT}`);
  tcp = net.connect(MODULE_PORT, MODULE_HOST, () => log('module connected — relaying'));
  tcp.on('data', (d) => { if (!closed) socket.write(encodeFrame(d)); });
  tcp.on('error', (e) => { log('module error:', e.message); shut('module error'); });
  tcp.on('close', () => shut('module closed'));

  // frames from the browser -> the module
  socket.on('data', (chunk) => {
    inbuf = Buffer.concat([inbuf, chunk]);
    for (;;) {
      const f = decodeFrame(inbuf);
      if (!f) break;
      inbuf = f.rest;
      if (f.opcode === 0x8) { shut('browser closed'); return; }       // close
      if (f.opcode === 0x9) { socket.write(encodeFrame(f.payload, 0xA)); continue; } // ping->pong
      if ((f.opcode === 0x1 || f.opcode === 0x2) && f.payload.length && tcp && !tcp.destroyed) tcp.write(f.payload);
    }
  });
  socket.on('error', () => shut('socket error'));
  socket.on('close', () => shut('socket closed'));
});

function encodeFrame(payload, opcode) {
  opcode = opcode || 0x2;                       // binary
  const len = payload.length; let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.from([0x80 | opcode, 126, (len >> 8) & 0xff, len & 0xff]); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127;
         header.writeUInt32BE(Math.floor(len / 0x100000000), 2); header.writeUInt32BE(len >>> 0, 6); }
  return Buffer.concat([header, payload]);
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = buf.readUInt32BE(2) * 0x100000000 + buf.readUInt32BE(6); off = 10; }
  let mask = null;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.slice(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { opcode, payload, rest: buf.slice(off + len) };
}

server.listen(PORT, () => {
  console.log(`Cortex UART Wi-Fi bridge`);
  console.log(`  open   http://localhost:${PORT}`);
  console.log(`  module ${MODULE_HOST}:${MODULE_PORT}  (join the module's LGE_MV-… Wi-Fi first, and close LGMV-Business)`);
});
