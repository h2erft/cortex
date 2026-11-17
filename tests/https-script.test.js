// appliance/cortex-https.sh, run for real against a pretend `tailscale` and temp folders.
// Checks when it fetches a trusted certificate, when it renews, and that it never replaces a
// certificate it did not make. Needs bash, openssl and jq (all present on a controller).
//   node tests/https-script.test.js
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
let fail = 0; const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail++; console.log('FAIL ' + name + (detail ? '\n   ' + detail : '')); } };
const have = (c) => spawnSync('bash', ['-c', 'command -v ' + c]).status === 0;
if (!have('openssl') || !have('jq')) { console.log('skipped: needs openssl and jq\n\nall passed'); process.exit(0); }
const SCRIPT = path.resolve(__dirname, '..', 'appliance', 'cortex-https.sh'), NAME = 'cortex-box.tail1234.ts.net';
function world(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chttps-')), data = path.join(root, 'data'), tls = path.join(data, 'tls'), bin = path.join(root, 'bin');
  fs.mkdirSync(tls, { recursive: true }); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(data, 'appliance.env'), opts.env || 'CORTEX_PORT=8080\n#CORTEX_HTTPS=0\n');
  // a private CA stands in for Let's Encrypt
  execFileSync('bash', ['-c', `cd "${root}" && openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout ca.key -out ca.pem -subj "/CN=Test CA" 2>/dev/null`]);
  const days = opts.issueDays || 90;
  fs.writeFileSync(path.join(bin, 'tailscale'), `#!/usr/bin/env bash
if [ "$1" = status ]; then echo '{"BackendState":"${opts.state || 'Running'}","Self":{"DNSName":"${opts.dns === undefined ? NAME + '.' : opts.dns}"}}'; exit 0; fi
if [ "$1" = cert ]; then echo called >> "${root}/calls"; ${opts.certFails ? 'echo "500 Internal Server Error: your Tailscale account does not support getting TLS certs"; exit 1' : `
  while [ $# -gt 0 ]; do case "$1" in --cert-file) C="$2"; shift 2;; --key-file) K="$2"; shift 2;; *) N="$1"; shift;; esac; done
  openssl req -newkey rsa:2048 -nodes -keyout "$K" -out "${root}/req.csr" -subj "/CN=$N" 2>/dev/null
  printf 'subjectAltName=DNS:%s' "$N" > "${root}/ext"
  openssl x509 -req -in "${root}/req.csr" -CA "${root}/ca.pem" -CAkey "${root}/ca.key" -CAcreateserial -days ${days} -extfile "${root}/ext" -out "$C" 2>/dev/null; exit 0`}; fi
exit 1
`, { mode: 0o755 });
  const selfSigned = (cn) => execFileSync('bash', ['-c', `openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout "${tls}/key.pem" -out "${tls}/cert.pem" -subj "/CN=${cn}" -addext "subjectAltName=DNS:${cn},DNS:${cn}.local" 2>/dev/null`]);
  const run = () => spawnSync('bash', [SCRIPT], { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH, CORTEX_ROOT: root, CORTEX_DATA: data, CORTEX_USER: os.userInfo().username }), encoding: 'utf8' });
  const info = () => { try { const t = execFileSync('openssl', ['x509', '-in', path.join(tls, 'cert.pem'), '-noout', '-subject', '-issuer', '-ext', 'subjectAltName'], { encoding: 'utf8' }); return t.replace(/\s+/g, ' '); } catch (e) { return ''; } };
  const calls = () => { try { return fs.readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').length; } catch (e) { return 0; } };
  const log = () => { try { return fs.readFileSync(path.join(data, 'update.log'), 'utf8'); } catch (e) { return ''; } };
  return { root, tls, selfSigned, run, info, calls, log, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
// 1. self-signed + Tailscale ready -> trusted certificate fetched, self-signed kept aside, key matches
let w = world({}); w.selfSigned('cortex'); let r = w.run();
ok('fetches a trusted certificate over a self-signed one', r.status === 0 && /DNS:cortex-box\.tail1234\.ts\.net/.test(w.info()) && /Test CA/.test(w.info()) && w.calls() === 1, w.info() + r.stderr);
ok('keeps the self-signed pair aside', fs.existsSync(path.join(w.tls, 'cert.selfsigned.pem')) && fs.existsSync(path.join(w.tls, 'key.selfsigned.pem')));
ok('key is private and matches the certificate', (fs.statSync(path.join(w.tls, 'key.pem')).mode & 0o077) === 0 && execFileSync('bash', ['-c', `[ "$(openssl x509 -in "${w.tls}/cert.pem" -noout -pubkey | openssl sha256)" = "$(openssl pkey -in "${w.tls}/key.pem" -pubout | openssl sha256)" ] && echo same`], { encoding: 'utf8' }).trim() === 'same');
ok('says so in the log', /trusted certificate installed for cortex-box\.tail1234\.ts\.net \(https:\/\/cortex-box\.tail1234\.ts\.net:8443\)/.test(w.log()), w.log());
// 2. run again: still good -> does not ask again
w.run(); w.run(); ok('does not fetch again while the certificate is good', w.calls() === 1); w.done();
// 3. its own certificate with under 30 days left -> renews
w = world({ issueDays: 10 }); w.selfSigned('cortex'); w.run(); w.run(); ok('renews its own certificate when under 30 days remain', w.calls() === 2); w.done();
// 4. somebody else's certificate -> never touched, never asks
w = world({}); execFileSync('bash', ['-c', `cd "${w.root}" && openssl req -newkey rsa:2048 -nodes -keyout "${w.tls}/key.pem" -out r.csr -subj "/CN=hvac.example.com" 2>/dev/null && printf 'subjectAltName=DNS:hvac.example.com' > e && openssl x509 -req -in r.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 300 -extfile e -out "${w.tls}/cert.pem" 2>/dev/null`]);
const before = fs.readFileSync(path.join(w.tls, 'cert.pem'), 'utf8'); w.run(); w.run();
ok('never replaces a certificate it did not make', fs.readFileSync(path.join(w.tls, 'cert.pem'), 'utf8') === before && w.calls() === 0 && (w.log().match(/did not make/g) || []).length === 1, w.log()); w.done();
// 5. tailnet does not allow certificates -> keeps self-signed, explains once
w = world({ certFails: true }); w.selfSigned('cortex'); const ss = w.info(); w.run(); w.run(); w.run();
ok('keeps the self-signed certificate when Tailscale refuses, and explains once', w.info() === ss && (w.log().match(/HTTPS Certificates/g) || []).length === 1, w.log()); w.done();
// 6. https switched off, Tailscale stopped, no tailnet name -> does nothing
for (const [name, o] of [['https switched off', { env: 'CORTEX_HTTPS=0\n' }], ['Tailscale not running', { state: 'Stopped' }], ['no tailnet name', { dns: '' }], ['a name that is not a tailnet name', { dns: 'evil.example.com.' }]]) {
  w = world(o); w.selfSigned('cortex'); const b4 = w.info(); const rr = w.run(); ok('does nothing when ' + name, rr.status === 0 && w.info() === b4 && w.calls() === 0); w.done(); }
// 7. no certificate at all yet -> still fetches
w = world({}); w.run(); ok('fetches when there is no certificate yet', /Test CA/.test(w.info()) && w.calls() === 1, w.info()); w.done();
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
