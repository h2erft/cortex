'use strict';
/* What the Command page may ask the desktop app to send to a building's controller.
 *
 * A controller refuses changes from web pages it did not serve (cross-site rule in server.js), so the
 * browser version of Command can only look. The installed app can do two more things on the owner's
 * behalf, and only these: start a controller's own update, and save or read the shared Command data.
 * Anything else is refused here before a request is made. Plain Node; tested by tests/command-bridge.test.js.
 */
const ALLOW = {
  GET: ['/health', '/api/update/check', '/api/command-data'],
  POST: ['/api/update/apply'],
  PUT: ['/api/command-data']
};
function cleanBase(u) {
  let s = String(u || '').trim(); if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;   // some other scheme (ftp://, file://): never guess
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) && !/^https?:/i.test(s)) return null;               // javascript:, data:, mailto:
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  let url; try { url = new URL(s); } catch (_) { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.protocol + '//' + url.host;
}
/* -> { url, method, body } or { err } */
function plan(req) {
  req = req || {};
  const method = String(req.method || 'GET').toUpperCase(), base = cleanBase(req.base), path = String(req.path || '');
  if (!base) return { err: 'not a controller address' };
  if (!ALLOW[method] || !ALLOW[method].includes(path)) return { err: 'not something Cortex Command may ask a controller to do' };
  let body;
  if (method !== 'GET') { try { body = JSON.stringify(req.body == null ? {} : req.body); } catch (_) { return { err: 'bad request body' }; } if (body.length > 300 * 1024) return { err: 'too large' }; }
  return { url: base + path, method, body };
}
async function send(req, fetchImpl, timeoutMs) {
  const p = plan(req); if (p.err) return { ok: false, status: 0, err: p.err };
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs || 10000);
  try {
    const r = await (fetchImpl || fetch)(p.url, { method: p.method, body: p.body, headers: p.body ? { 'Content-Type': 'application/json' } : {}, signal: ctl.signal, redirect: 'error' });
    let json = null; try { json = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, json };
  } catch (e) { return { ok: false, status: 0, err: e && e.name === 'AbortError' ? 'the controller did not answer in time' : 'could not reach the controller' }; }
  finally { clearTimeout(to); }
}
module.exports = { plan, send, cleanBase, ALLOW };
