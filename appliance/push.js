/* Cortex — Web Push (browser / phone notifications) with no dependencies.
 *
 * Implements RFC 8291 (message encryption, aes128gcm) and RFC 8292 (VAPID) on Node's crypto.
 * The controller keeps one VAPID key pair and the list of subscribed browsers in <DATA>/push.json.
 * Browsers only allow push on a secure page (https with a trusted certificate, or localhost), so
 * this does nothing until Cortex is opened over HTTPS — see docs/NOTIFICATIONS.md.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64u = (b) => Buffer.from(b).toString('base64url');
const SUBJECT = 'https://github.com/h2erft/cortex';

function vapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { jwk, pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])) };
}
function vapidHeader(endpoint, keys, nowMs) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600, sub: SUBJECT }));
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}
// RFC 8291 §3.4. `t` lets a test pin the sender key and salt.
function encrypt(sub, payload, t) {
  const ua = Buffer.from(sub.keys.p256dh, 'base64url'), auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  if (t && t.priv) ecdh.setPrivateKey(t.priv); else ecdh.generateKeys();
  const as = ecdh.getPublicKey(), secret = ecdh.computeSecret(ua), salt = (t && t.salt) || crypto.randomBytes(16);
  const hk = (s, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
  const ikm = hk(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
}
function validSub(s) {
  try { return !!(s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1200 && s.keys
    && Buffer.from(s.keys.p256dh, 'base64url').length === 65 && Buffer.from(s.keys.auth, 'base64url').length === 16); } catch (_) { return false; }
}

function createPush(opts) {
  const FILE = path.join(opts.dataDir, 'push.json'), log = opts.log || (() => {}), doFetch = opts.fetch || fetch;
  let st; try { st = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { st = null; }
  if (!st || !st.keys || !st.keys.jwk) { st = { keys: vapidKeys(), subs: [] }; save(); }
  if (!Array.isArray(st.subs)) st.subs = [];
  function save() { try { fs.mkdirSync(opts.dataDir, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(tmp, FILE); } catch (e) { log('could not save: ' + e.message); } }
  /* kinds: which of this controller's own alerts the device wants (omit to keep what it had; a new device
     that only asks for fleet alerts gets none of them). opt.fleet: Cortex Command's fleet alerts, kept
     separately so the Cortex page and the Command page on one device do not overwrite each other. */
  function subscribe(sub, who, kinds, opt) {
    if (!validSub(sub)) return false;
    const prev = st.subs.find(s => s.endpoint === sub.endpoint), hasFleet = opt && typeof opt.fleet === 'boolean';
    const k = Array.isArray(kinds) ? kinds.filter(x => typeof x === 'string').slice(0, 8) : (kinds === undefined && prev) ? prev.kinds : (kinds === undefined && hasFleet) ? [] : null;
    const fleet = hasFleet ? opt.fleet : !!(prev && prev.fleet);
    st.subs = st.subs.filter(s => s.endpoint !== sub.endpoint);
    if (hasFleet && !fleet && Array.isArray(k) && !k.length) { save(); return true; }      // nothing left that this device wants
    st.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, user: String(who || (prev && prev.user) || '').slice(0, 60), kinds: k, fleet, at: Date.now() });
    if (st.subs.length > 60) st.subs = st.subs.slice(-60);
    save(); return true;
  }
  function unsubscribe(endpoint) { const n = st.subs.length; st.subs = st.subs.filter(s => s.endpoint !== endpoint); if (st.subs.length !== n) save(); return n !== st.subs.length; }
  async function sendOne(s, msg) {
    const body = encrypt(s, JSON.stringify(msg));
    const r = await doFetch(s.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(10000),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: vapidHeader(s.endpoint, st.keys) } });
    if (r.status === 404 || r.status === 410) { unsubscribe(s.endpoint); return 'gone'; }
    return r.ok ? 'sent' : ('http ' + r.status);
  }
  // kind: 'fault' | 'silent' | 'diag' | 'test' | 'fleet'. A subscription with no `kinds` list gets every site alert; 'fleet' goes only to devices that asked for it.
  async function send(msg, kind, onlyEndpoint) {
    const out = { sent: 0, failed: 0, gone: 0, errors: [] };
    for (const s of st.subs.slice()) {
      if (onlyEndpoint && s.endpoint !== onlyEndpoint) continue;
      if (kind === 'fleet') { if (!s.fleet) continue; } else if (kind !== 'test' && s.kinds && !s.kinds.includes(kind)) continue;
      try { const r = await sendOne(s, msg); if (r === 'sent') out.sent++; else if (r === 'gone') out.gone++; else { out.failed++; out.errors.push(r); } }
      catch (e) { out.failed++; out.errors.push(e.message); }
    }
    if (out.failed) log('push: ' + out.failed + ' failed (' + out.errors.slice(0, 2).join('; ') + ')');
    return out;
  }
  return { publicKey: () => st.keys.pub, subscribe, unsubscribe, send, count: () => st.subs.length, has: (ep) => st.subs.some(s => s.endpoint === ep),
    fleetCount: () => st.subs.filter(s => s.fleet).length, info: (ep) => { const s = st.subs.find(x => x.endpoint === ep); return s ? { fleet: !!s.fleet, kinds: s.kinds } : null; } };
}

// The service worker the browser installs. Kept tiny: show the notification, open Cortex on tap.
const SW_JS = `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(_){d={body:e.data?e.data.text():''};}
  e.waitUntil(self.registration.showNotification(d.title||'Cortex',{body:d.body||'',tag:d.tag||undefined,renotify:!!d.tag,icon:'/icon-256.png',badge:'/icon-256.png',data:{url:d.url||'/'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c){c.navigate&&c.navigate(url);return c.focus();}}return self.clients.openWindow(url);}));});
`;
module.exports = { createPush, encrypt, vapidHeader, vapidKeys, validSub, SW_JS };
