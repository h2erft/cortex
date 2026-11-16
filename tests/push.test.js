// Web Push: encryption round-trip (RFC 8291), VAPID signature (RFC 8292), subscription store.
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { createPush, encrypt, vapidHeader, vapidKeys, validSub } = require('../appliance/push');
let fail = 0; const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
const hk = (s, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
function receiver() { const e = crypto.createECDH('prime256v1'); e.generateKeys(); const auth = crypto.randomBytes(16);
  return { e, auth, sub: { endpoint: 'https://push.example/abc', keys: { p256dh: e.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } }; }
function decrypt(rx, body) {              // written from the RFC, independently of encrypt()
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const secret = rx.e.computeSecret(as), ikm = hk(rx.auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), rx.e.getPublicKey(), as]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return { rs, idlen, text: pt.subarray(0, pt.length - 1).toString(), pad: pt[pt.length - 1] };
}
(async () => {
  const rx = receiver(), out = decrypt(rx, encrypt(rx.sub, '{"title":"Cortex","body":"CH104"}'));
  ok('round-trip payload', out.text === '{"title":"Cortex","body":"CH104"}'); ok('record size 4096, key id 65, last-record pad', out.rs === 4096 && out.idlen === 65 && out.pad === 2);
  const k = vapidKeys(), h = vapidHeader('https://fcm.googleapis.com/fcm/send/x', k, 1e12), m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  const pubRaw = Buffer.from(m[4], 'base64url'), pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pubRaw.subarray(1, 33).toString('base64url'), y: pubRaw.subarray(33).toString('base64url') }, format: 'jwk' });
  ok('VAPID signature verifies', crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
  const claims = JSON.parse(Buffer.from(m[2], 'base64url')); ok('VAPID audience is the push origin', claims.aud === 'https://fcm.googleapis.com' && claims.exp === 1e9 + 43200);
  ok('rejects http endpoint', !validSub({ endpoint: 'http://x', keys: rx.sub.keys })); ok('rejects short key', !validSub({ endpoint: 'https://x', keys: { p256dh: 'AAAA', auth: rx.sub.keys.auth } }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxpush-')), calls = [];
  const fake = async (url, o) => { calls.push({ url, o }); return { ok: !/gone/.test(url), status: /gone/.test(url) ? 410 : 201 }; };
  const p = createPush({ dataDir: dir, fetch: fake }); const rx2 = receiver(); rx2.sub.endpoint = 'https://push.example/gone'; const rx3 = receiver(); rx3.sub.endpoint = 'https://push.example/onlyfaults';
  ok('subscribe', p.subscribe(rx.sub, 'will') && p.subscribe(rx2.sub, 'will') && p.subscribe(rx3.sub, 'tech', ['fault']) && p.count() === 3);
  const r = await p.send({ title: 'a', body: 'b' }, 'diag');
  ok('kind filter + dead subscription removed', r.sent === 1 && r.gone === 1 && p.count() === 2 && calls.length === 2);
  ok('message decrypts at the receiver', JSON.parse(decrypt(rx, calls[0].o.body).text).body === 'b' && calls[0].o.headers['Content-Encoding'] === 'aes128gcm');
  ok('keys survive a restart', createPush({ dataDir: dir, fetch: fake }).publicKey() === p.publicKey());
  console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
})();
