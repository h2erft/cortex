'use strict';
/* A link as a QR picture (an SVG string), for the "On your phone" page. Uses the MIT-licensed
   QR Code Generator by Kazuhiko Arase, kept unchanged in qr-lib.js. */
const lib = require('./qr-lib');
function modules(text) { const q = lib(0, 'M'); q.addData(String(text)); q.make(); const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) { let row = ''; for (let c = 0; c < n; c++) row += q.isDark(r, c) ? '1' : '0'; rows.push(row); } return rows; }
function svg(text) { const rows = modules(text), n = rows.length, q = 4, size = n + q * 2; let d = '';
  rows.forEach((row, r) => { for (let c = 0; c < n; c++) if (row[c] === '1') d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z'; });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>'; }
module.exports = { modules, svg };
