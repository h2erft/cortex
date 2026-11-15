// Regression test for the OTA version comparator (the suffix bug that ranked beta.9 above beta.10).
// Mirrors cmpVer/cmpSuffix in appliance/server.js.   node tests/version.test.js
const verParts=v=>{const m=String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);return m?[+m[1],+m[2],+m[3],m[4]||'~']:[0,0,0,'~'];};
function cmpSuffix(a,b){ if(a===b)return 0; if(a==='~')return 1; if(b==='~')return -1;
  const pa=a.split('.'),pb=b.split('.');
  for(let i=0;i<Math.max(pa.length,pb.length);i++){ const x=pa[i],y=pb[i];
    if(x===undefined)return -1; if(y===undefined)return 1;
    const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
    if(nx&&ny){ if(+x!==+y)return +x<+y?-1:1; } else if(x!==y)return x<y?-1:1; } return 0; }
function cmpVer(a,b){ const x=verParts(a),y=verParts(b); for(let i=0;i<3;i++){ if(x[i]!==y[i])return x[i]-y[i]; } return cmpSuffix(x[3],y[3]); }
const C=[['1.6.0-beta.10','1.6.0-beta.9',1],['1.6.0-beta.9','1.6.0-beta.10',-1],['1.6.1-beta.1','1.6.0-beta.9',1],
  ['1.6.1-beta.1','1.6.0-beta.10',1],['1.6.0','1.6.0-beta.1',1],['1.6.0-beta.2','1.6.0-beta.10',-1],
  ['1.6.0-beta.9','1.6.0-beta.9',0],['1.7.0','1.6.9',1],['1.6.0-rc.1','1.6.0-beta.9',1]];
let fail=0; for(const [a,b,w] of C){ const g=Math.sign(cmpVer(a,b)); if(g===w)console.log('ok   '+a+' vs '+b+' = '+g); else {fail++;console.log('FAIL '+a+' vs '+b+' = '+g+' want '+w);} }
console.log(fail?`\n${fail} FAILED`:'\nall passed'); process.exit(fail?1:0);
