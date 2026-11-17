// The Cortex desktop app's two brains: finding controllers on the network, and deciding what to notify.
// No network: every request goes to a pretend network defined here.
//   node tests/desktop-app.test.js
const D = require('../desktop-app/discover'), W = require('../desktop-app/watch');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
// --- discovery
const ifaces = { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], eth: [{ address: '192.168.1.40', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
  wifi: [{ address: '10.4.24.9', family: 'IPv4', internal: false }], ts: [{ address: '100.84.2.17', family: 'IPv4', internal: false }], pub: [{ address: '8.8.4.4', family: 'IPv4', internal: false }] };
eq('searches only this PC\'s private local networks', D.subnets(ifaces), ['192.168.1', '10.4.24']);
eq('254 addresses per network', [D.hosts(['192.168.1']).length, D.hosts(['192.168.1'])[0], D.hosts(['192.168.1'])[253]], [254, '192.168.1.1', '192.168.1.254']);
eq('recognises a controller, new and old', [D.identify({ ok: true, app: 'cortex', version: '1.7.1', name: 'Lobby Tower' }).name, D.identify({ ok: true, version: '1.6.0', serial: '/dev/ttyUSB0', port: 8080, configured: true, name: '' }).name, D.identify({ ok: true, version: '1.7.1', app: 'cortex', https: { active: true, port: 8443, trusted: true, name: 'x.ts.net' } }).https], ['Lobby Tower', 'Cortex', { port: 8443, trusted: true, name: 'x.ts.net' }]);
eq('ignores everything else', [D.identify({ ok: true }), D.identify({ ok: true, version: '2.0' }), D.identify({ status: 'ok', version: '1' }), D.identify('<html>'), D.identify(null), D.identify({ ok: false, app: 'cortex', version: '1' })], [null, null, null, null, null, null]);
eq('addresses typed by hand', ['10.4.224.52', 'cortex.local:8080/', 'https://box.ts.net:8443/x', 'ftp://x', 'javascript:alert(1)', 'http://u:p@x', '  '].map(D.cleanAddress), ['http://10.4.224.52', 'http://cortex.local:8080', 'https://box.ts.net:8443', null, null, null, null]);
const net = { 'http://192.168.1.50/health': { ok: true, app: 'cortex', version: '1.7.1', name: 'Harbor Point' }, 'http://192.168.1.50:8080/health': { ok: true, app: 'cortex', version: '1.7.1', name: 'Harbor Point' },
  'http://cortex.local/health': { ok: true, app: 'cortex', version: '1.7.1', name: 'Harbor Point' }, 'http://10.4.24.77:8080/health': { ok: true, version: '1.6.0', serial: 'x', port: 8080, configured: true, name: 'Annex' },
  'http://192.168.1.1/health': { router: true }, 'http://192.168.1.9/health': 'not json' };
const asked = []; const fakeFetch = async (url) => { asked.push(url); if (!(url in net)) throw new Error('refused'); const v = net[url]; return { ok: true, json: async () => { if (typeof v === 'string') throw new Error('bad json'); return v; } }; };
(async () => {
  let progress = 0, live = 0; const found = await D.scan({ ifaces, fetch: fakeFetch, onProgress: (d, t) => { progress = d / t; }, onFound: (l) => { live = l.length; }, timeout: 50 });
  eq('finds each controller once, by address', found.map(c => [c.name, c.url, c.version]), [['Annex', 'http://10.4.24.77:8080', '1.6.0'], ['Harbor Point', 'http://192.168.1.50', '1.7.1']]);
  eq('asked only /health, only on local networks and cortex.local', [asked.every(u => /\/health$/.test(u)), asked.every(u => /^http:\/\/(192\.168\.1\.|10\.4\.24\.|cortex\.local)/.test(u)), asked.length, progress, live >= 2], [true, true, 2 + 254 * 2 * 2, 1, true]);
  const only = await D.scan({ ifaces: {}, fetch: fakeFetch, known: ['192.168.1.50'] }); eq('with no local network still tries cortex.local and known addresses', only.map(c => c.url), ['http://192.168.1.50']);
  let n = 0; await D.scan({ ifaces, fetch: async () => { n++; throw new Error('x'); }, cancelled: () => n > 100, timeout: 20 }); eq('a cancelled search stops early', n < 300, true);
  // --- watching
  const units = { units: [{ id: 1, addr: 4, name: 'AC_UNIT_04', on: true }, { id: 2, addr: 5, name: 'AC_UNIT_05', label: 'Lab', on: false }, { id: 3, addr: 6, name: 'AC_UNIT_06', offline: true }] }, meta = { AC_UNIT_04: { alias: 'Conference B' } };
  const S = (events, adv) => W.snapshot({ health: { name: 'Harbor Point', version: '1.7.1' }, units, meta, events: { events }, diag: { advisories: adv || [] } });
  const e1 = { id: 'a', kind: 'unit', addr: 4, code: 'CH04', at: 1 }, e2 = { id: 'b', kind: 'silent', addr: 6, at: 2 }, e3 = { id: 'c', kind: 'odu', addr: 192, code: 'CH34', at: 3 };
  eq('snapshot counts and names', [S([e1]).total, S([e1]).on, S([e1]).silent, S([e1, { id: 'z', cleared: 5 }]).events.map(e => e.where)], [3, 1, 1, ['Conference B']]);
  eq('first look is silent', W.diff(null, S([e1, e2]), 0), []);
  eq('a new fault', W.diff(S([]), S([e1]), 0).map(n => n.title), ['Conference B has a fault (CH04)']);
  eq('a silent unit and an outdoor fault', W.diff(S([e1]), S([e1, e2, e3]), 0).map(n => n.title), ['Outdoor unit 0xC0 has a fault (CH34)', 'Unit 3 stopped answering']);
  eq('nothing new, nothing said', W.diff(S([e1, e2]), S([e1, e2]), 0), []);
  eq('a cleared fault', W.diff(S([e1]), S([]), 0).map(n => n.title), ['Conference B fault cleared']);
  eq('many at once become one notice', W.diff(S([]), S([1, 2, 3, 4, 5].map(i => ({ id: 'm' + i, kind: 'unit', addr: 4, code: 'CH05', at: i }))), 0).map(n => n.title), ['5 new faults']);
  eq('a new advisory', W.diff(S([]), S([], [{ key: '192:lowcharge', title: 'Low refrigerant charge', lvl: 'likely' }]), 0).map(n => n.title), ['Likely: Low refrigerant charge']);
  eq('kinds can be switched off', W.diff(S([]), S([e1, e2], [{ key: 'k', title: 'T', lvl: 'possible' }]), 0, { fault: false, advisory: false }).map(n => n.kind), ['silent']);
  const down = W.snapshot(null);
  eq('unreachable is announced on the second miss only', [W.diff(S([]), down, 1).length, W.diff(S([]), down, 2).map(n => n.title), W.diff(S([]), down, 3).length], [0, ['Cortex is not answering'], 0]);
  eq('coming back is announced only if the outage was, and old faults are not replayed', [W.diff(Object.assign({}, down, { told: true }), S([e1]), 0).map(n => n.title), W.diff(down, S([e1]), 0)], [['Cortex is back'], []]);
  eq('tray tooltip', [W.tooltip(S([e1])), W.tooltip(down)], ['Cortex — Harbor Point\n1 of 3 units on · 1 not answering', 'Cortex — not connected']);
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
