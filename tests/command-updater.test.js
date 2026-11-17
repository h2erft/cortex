// Cortex Command's updater logic: which release it picks on each channel, and what it refuses.
const U = require('../command-app/updater');
let fail = 0; const ok = (n, c) => { console.log((c ? 'ok   ' : 'FAIL ') + n); if (!c) fail++; };
const rel = (tag, pre, files, draft) => ({ tag_name: tag, prerelease: !!pre, draft: !!draft, html_url: 'https://github.com/h2erft/cortex/releases/tag/' + tag,
  assets: (files || []).map(n => ({ name: n, browser_download_url: 'https://github.com/h2erft/cortex/releases/download/' + tag + '/' + n })) });
const M = 'command-manifest.json', X = v => 'Cortex-Command-Setup-' + v + '.exe';
ok('version order', U.cmpVer('1.7.0', '1.6.9') === 1 && U.cmpVer('1.7.0-beta.2', '1.7.0') === -1 && U.cmpVer('1.7.0-beta.10', '1.7.0-beta.9') === 1 && U.cmpVer('v1.7.0', '1.7.0') === 0 && U.cmpVer('1.7.0-beta.2', '1.7.0-alpha.9') === 1 && U.cmpVer('1.10.0', '1.9.9') === 1);
const list = [rel('v1.8.0-beta.2', true, [M, X('1.8.0-beta.2')]), rel('v1.8.0-beta.1', true, [M, X('1.8.0-beta.1')]), rel('v1.7.0', false, [M, X('1.7.0')]), rel('v1.6.0', false, ['cortex-1.6.0.tgz']), rel('v9.9.9', false, [M], true)];
ok('stable channel ignores pre-releases and drafts', U.pickRelease(list, false).version === '1.7.0');
ok('beta channel takes the newest of any kind', U.pickRelease(list, true).version === '1.8.0-beta.2');
ok('a release without a Command installer is skipped', U.pickRelease([rel('v1.6.0', false, ['cortex-1.6.0.tgz'])], false) === null);
ok('newer is offered', U.decide('1.7.0-beta.14', list, false).state === 'available' && U.decide('1.7.0-beta.14', list, false).latest === '1.7.0');
ok('same or older is not', U.decide('1.7.0', list, false).state === 'current' && U.decide('1.8.0', list, true).state === 'current');
ok('beta user on a newer beta is not pulled back to stable', U.decide('1.8.0-beta.2', list, false).state === 'current');
ok('nothing published yet', U.decide('1.7.0', [], true).state === 'none');
const pick = U.pickRelease(list, false), sha = 'a'.repeat(64);
ok('installer url comes from that release', U.installerUrl(pick, { file: X('1.7.0'), sha256: sha }) === 'https://github.com/h2erft/cortex/releases/download/v1.7.0/' + X('1.7.0'));
ok('manifest naming a file the release does not have is refused', U.installerUrl(pick, { file: X('6.6.6'), sha256: sha }) === null);
ok('odd file names and bad checksums are refused', U.installerUrl(pick, { file: '../evil.exe', sha256: sha }) === null && U.installerUrl(pick, { file: X('1.7.0'), sha256: 'nope' }) === null && U.installerUrl(pick, null) === null);
const off = U.pickRelease([{ tag_name: 'v2.0.0', assets: [{ name: M, browser_download_url: 'https://github.com/x/' + M }, { name: X('2.0.0'), browser_download_url: 'https://evil.example/' + X('2.0.0') }] }], false);
ok('an installer hosted anywhere but GitHub is refused', U.installerUrl(off, { file: X('2.0.0'), sha256: sha }) === null);
ok('checksum', U.sha256(Buffer.from('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
ok('a pre-release install starts on the beta channel, a stable install on stable', U.defaultBeta('1.7.0-beta.15') === true && U.defaultBeta('1.7.0') === false && U.defaultBeta('junk') === false);
// the situation that hid updates: a beta install on the stable channel while only pre-releases exist
ok('beta install + stable channel + only pre-releases published = nothing offered', U.decide('1.7.0-beta.15', [{ tag_name: 'v1.7.0-beta.16', prerelease: true, assets: [{ name: M, browser_download_url: 'https://github.com/x/' + M }] }], false).state === 'none');
ok('same install on the beta channel is offered beta.16', U.decide('1.7.0-beta.15', [{ tag_name: 'v1.7.0-beta.16', prerelease: true, assets: [{ name: M, browser_download_url: 'https://github.com/x/' + M }] }], U.defaultBeta('1.7.0-beta.15')).latest === '1.7.0-beta.16');
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
