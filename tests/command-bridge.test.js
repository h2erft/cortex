// The Command desktop app's allow-list for requests to controllers. No network.
//   node tests/command-bridge.test.js
const { plan, send, cleanBase } = require('../command-app/bridge');
let fail = 0; const eq = (name, got, want) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + '\n   got  ' + a + '\n   want ' + b); } };
eq('base forms', ['10.0.0.5:8080', 'http://site.ts.net/', 'https://x:8443/path?q', 'ftp://x', 'javascript:alert(1)', 'http://user:pw@x', ''].map(cleanBase), ['http://10.0.0.5:8080', 'http://site.ts.net', 'https://x:8443', null, null, null, null]);
eq('update apply allowed', plan({ base: '10.0.0.5:8080', method: 'post', path: '/api/update/apply' }), { url: 'http://10.0.0.5:8080/api/update/apply', method: 'POST', body: '{}' });
eq('sync save allowed', plan({ base: 'http://h', method: 'PUT', path: '/api/command-data', body: { base: 1, doc: { sites: [] } } }).url, 'http://h/api/command-data');
eq('read allowed', plan({ base: 'http://h', path: '/api/update/check' }), { url: 'http://h/api/update/check', method: 'GET' });
const no = (r) => !!plan(r).err;
eq('everything else refused', [
  no({ base: 'http://h', method: 'POST', path: '/api/cmd' }), no({ base: 'http://h', method: 'POST', path: '/api/power/reboot' }), no({ base: 'http://h', method: 'POST', path: '/api/appconfig' }),
  no({ base: 'http://h', method: 'PUT', path: '/api/units' }), no({ base: 'http://h', method: 'POST', path: '/api/update/apply/../cmd' }), no({ base: 'http://h', method: 'POST', path: '/api/update/apply?x=1' }),
  no({ base: 'http://h', method: 'DELETE', path: '/api/command-data' }), no({ base: 'http://h', method: 'POST', path: '/api/clear-units' }), no({ base: 'http://h', method: 'POST', path: '/api/update/revert' }),
  no({ base: '', method: 'GET', path: '/health' }), no({ base: 'file:///etc', method: 'GET', path: '/health' }), no({})], new Array(12).fill(true));
(async () => {
  let seen = null;
  const r = await send({ base: 'h:8080', method: 'POST', path: '/api/update/apply' }, async (url, o) => { seen = [url, o.method, o.body, Object.keys(o.headers).join(), o.redirect]; return { ok: true, status: 200, json: async () => ({ ok: true, started: true }) }; });
  eq('send passes the planned request and never an Origin', [r, seen], [{ ok: true, status: 200, json: { ok: true, started: true } }, ['http://h:8080/api/update/apply', 'POST', '{}', 'Content-Type', 'error']]);
  let called = false; const bad = await send({ base: 'h', method: 'POST', path: '/api/cmd' }, async () => { called = true; });
  eq('refused request is never sent', [bad.ok, called], [false, false]);
  const down = await send({ base: 'h', path: '/health' }, async () => { throw new Error('ECONNREFUSED'); });
  eq('unreachable controller', [down.ok, down.err], [false, 'could not reach the controller']);
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
