/* Cortex Command's updater: the same idea as the controller's.
 *
 * Every Cortex release on GitHub that includes a Command installer also carries a small file,
 * command-manifest.json: { version, file, sha256 }. This module looks at the list of releases, picks
 * the one this install should be on, and says whether it is newer than what is running.
 *   - Stable channel: the newest release that is NOT marked "pre-release".
 *   - Beta testing on: the newest release of any kind.
 * Nothing here touches Electron, so it can be tested with plain Node.
 */
const crypto = require('crypto');

function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return { n: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.').map(x => (/^\d+$/.test(x) ? +x : x)) : null };
}
/* -1 if a is older than b, 0 if equal, 1 if newer. A pre-release is older than its final version. */
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b); if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (!x.pre && !y.pre) return 0; if (!x.pre) return 1; if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]; if (p === undefined) return -1; if (q === undefined) return 1; if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
    if (typeof p === 'number') return -1; if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
/* Which program this is. The same release carries more than one installer (Cortex Command, and the
   Cortex desktop app); each looks only for its own manifest and its own installer name. */
let PRODUCT = { manifest: 'command-manifest.json', file: /^Cortex-Command-Setup-[0-9A-Za-z.+-]+\.exe$/ };
function product(p) { PRODUCT = Object.assign({}, PRODUCT, p); return PRODUCT; }
/* releases: GitHub's /releases list. Returns { version, tag, manifestUrl, prerelease, notesUrl } or null. */
function pickRelease(releases, beta) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || (r.prerelease && !beta)) continue;
    const man = (r.assets || []).find(a => a && a.name === PRODUCT.manifest); if (!man) continue;
    const ver = String(r.tag_name || '').replace(/^v/, ''); if (!parseVer(ver)) continue;
    if (!best || cmpVer(ver, best.version) > 0) best = { version: ver, tag: r.tag_name, manifestUrl: man.browser_download_url, prerelease: !!r.prerelease, notesUrl: r.html_url, assets: r.assets };
  }
  return best;
}
/* Decide what to do. current: running version. Returns { state, ... }. */
function decide(current, releases, beta) {
  const pick = pickRelease(releases, beta);
  if (!pick) return { state: 'none', reason: 'No release with an installer for this program was found on this channel.' };
  if (cmpVer(pick.version, current) <= 0) return { state: 'current', latest: pick.version };
  return { state: 'available', latest: pick.version, pick };
}
/* The installer named by a manifest must be one of that release's own files, from GitHub. */
function installerUrl(pick, manifest) {
  if (!manifest || typeof manifest.file !== 'string' || !/^[0-9a-f]{64}$/i.test(String(manifest.sha256 || ''))) return null;
  if (!PRODUCT.file.test(manifest.file)) return null;
  const a = (pick.assets || []).find(x => x && x.name === manifest.file); if (!a) return null;
  return /^https:\/\/github\.com\//.test(a.browser_download_url) ? a.browser_download_url : null;
}
/* Which channel a fresh install starts on. Someone who installed a pre-release is a beta tester already:
   on the stable channel they would be told "nothing published" until the next stable release. */
function defaultBeta(version) { const v = parseVer(version); return !!(v && v.pre); }
/* Turning Beta testing off while running a pre-release. Two honest choices, the same two a controller
   offers: go back to the newest stable release (an older version), or stay on this beta and hear only
   about stable releases from now on.
   -> { onBeta, current, stable: pick|null, canRevert, stableIsNewer } */
function leaveBeta(current, releases) {
  const cur = parseVer(current), stable = pickRelease(releases, false);
  const onBeta = !!(cur && cur.pre), c = stable ? cmpVer(stable.version, current) : 0;
  return { onBeta, current, stable, canRevert: !!(onBeta && stable && c < 0), stableIsNewer: !!(stable && c > 0) };
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { parseVer, cmpVer, pickRelease, decide, installerUrl, sha256, defaultBeta, leaveBeta, product };
