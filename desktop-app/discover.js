'use strict';
/* Finding Cortex controllers on the local network.
 *
 * Two ways, tried together:
 *   1. the name every controller announces: cortex.local (and any address the app already knows);
 *   2. asking each address on this PC's own network "are you Cortex?" (GET /health, a read-only page).
 *
 * Only private, local networks are searched, and only the 254 addresses around each of this PC's own
 * addresses. Nothing is sent that could change anything. Plain Node; tested by tests/desktop-app.test.js.
 */
const PORTS = [80, 8080];
function isPrivate(ip) { const p = String(ip).split('.').map(Number); if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }
/* os.networkInterfaces() -> the /24 prefixes worth searching, e.g. ["192.168.1"]. Tailscale's 100.64/10 is
   left out: it is not a local network and its neighbours are not /24 siblings. */
function subnets(ifaces) { const out = new Set();
  for (const list of Object.values(ifaces || {})) for (const a of list || []) {
    if (!a || a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue; const p = String(a.address).split('.');
    if (!isPrivate(a.address) || +p[0] === 100) continue; out.add(p.slice(0, 3).join('.')); }
  return [...out].slice(0, 4); }
function hosts(prefixes) { const out = []; for (const pre of prefixes) for (let i = 1; i <= 254; i++) out.push(pre + '.' + i); return out; }
/* Is this /health answer a Cortex controller? New builds say app:"cortex"; older ones are known by their shape. */
function identify(j) { if (!j || typeof j !== 'object' || j.ok !== true || typeof j.version !== 'string') return null;
  if (j.app !== 'cortex' && !('serial' in j && 'port' in j && 'configured' in j)) return null;
  return { name: typeof j.name === 'string' && j.name ? j.name.slice(0, 80) : 'Cortex', version: j.version.slice(0, 40), configured: j.configured !== false,
    id: typeof j.id === 'string' && /^[a-f0-9]{16}$/.test(j.id) ? j.id : null, port: +j.port || 8080, port80: j.port80 === true,
    lan: (Array.isArray(j.lan) ? j.lan : []).filter(a => typeof a === 'string' && isPrivate(a) && +a.split('.')[0] !== 100).slice(0, 4),
    https: j.https && j.https.active ? { port: j.https.port, trusted: !!j.https.trusted, name: j.https.name || null } : null }; }
function cleanAddress(a) { let s = String(a || '').trim().replace(/\/+$/, ''); if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  let u; try { u = new URL(s); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  return u.protocol + '//' + u.host; }
async function probe(base, fetchImpl, timeoutMs) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs || 900);
  try { const r = await fetchImpl(base + '/health', { signal: ctl.signal, redirect: 'error', cache: 'no-store' }); if (!r.ok) return null; const id = identify(await r.json()); return id ? Object.assign({ url: base }, id) : null; }
  catch (_) { return null; } finally { clearTimeout(to); } }
/* One entry per controller. The same box answers on port 80 and 8080, and as cortex.local as well as by
   address: keep the port-80 address, and drop the cortex.local entry when the box was also found by address. */
function tidy(hits) {
  const byHost = new Map();
  for (const c of hits) { const u = new URL(c.url), cur = byHost.get(u.hostname); if (!cur || (u.port === '' && new URL(cur.url).port !== '')) byHost.set(u.hostname, c); }
  const all = [...byHost.values()], isIp = (c) => /^\d+\.\d+\.\d+\.\d+$/.test(new URL(c.url).hostname);
  const ips = all.filter(isIp), names = all.filter(c => !isIp(c));
  return ips.concat(names.filter(n => !ips.some(c => c.name === n.name && c.version === n.version)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url, undefined, { numeric: true }));
}
/* scan({ ifaces, fetch, known, onFound, onProgress, cancelled, timeout, concurrency }) -> [{ url, name, version, configured, https }] */
async function scan(o) {
  const hits = [], add = (c) => { if (!c) return; hits.push(c); if (o.onFound) o.onFound(tidy(hits)); };
  const first = [...new Set(['http://cortex.local', 'http://cortex.local:8080'].concat((o.known || []).map(cleanAddress).filter(Boolean)))];
  await Promise.all(first.map(b => probe(b, o.fetch, 2500).then(add)));
  const list = []; for (const h of hosts(subnets(o.ifaces))) for (const p of PORTS) list.push('http://' + h + (p === 80 ? '' : ':' + p));
  let i = 0, done = 0; const total = list.length, workers = [];
  const work = async () => { while (i < list.length) { if (o.cancelled && o.cancelled()) return; const b = list[i++]; add(await probe(b, o.fetch, o.timeout || 900)); done++; if (o.onProgress && done % 16 === 0) o.onProgress(done, total); } };
  for (let w = 0; w < Math.min(o.concurrency || 64, list.length); w++) workers.push(work());
  await Promise.all(workers); if (o.onProgress) o.onProgress(total, total);
  return tidy(hits);
}
module.exports = { subnets, hosts, identify, cleanAddress, probe, scan, tidy, isPrivate, PORTS };
