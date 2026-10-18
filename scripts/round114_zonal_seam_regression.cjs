const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
assert.equal(pkg.version,'6.0.37','ROUND114 package version mismatch');
const fieldSrc=fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const filterSrc=fs.readFileSync('src/simulation/WindFieldArtifactFilter.ts','utf8');
const mapSrc=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
assert(fieldSrc.includes('smooth01((tcBackgroundGate - 0.46) / 0.46)'), 'far-field-only pre-solver marine floor gate missing');
assert(fieldSrc.includes('smooth01((restoreGate - 0.42) / 0.50)'), 'far-field-only post-solver marine floor gate missing');
assert(fieldSrc.includes('suppressZonalResidualSeams({'), 'zonal residual seam filter is not connected');
assert(filterSrc.includes('residualExcess < 0.55'), 'anti-bleed residual guard missing');
assert(filterSrc.includes("[[-3, 0.75], [-2, 1.0], [2, 1.0], [3, 0.75]]"), 'multi-row seam reference missing');
assert(!mapSrc.includes('async function detectExtrema('), 'non-TC H/L extrema calculation returned');
assert.equal((mapSrc.match(/fillText\("L"/g)||[]).length,1,'only primary TC L marker should remain');
assert(mapSrc.includes('const rasterW = Math.max(MAP.w, Math.round(mapW));'), 'full-resolution raster lost');

const js=ts.transpileModule(filterSrc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};
vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`,{module:m,exports:m.exports,require,Math,Float32Array,Uint8Array,console});
const filter=m.exports.suppressZonalResidualSeams;
function make(){const nx=81,ny=61,n=nx*ny;return{nx,ny,n,u:new Float32Array(n),v:new Float32Array(n),ru:new Float32Array(n),rv:new Float32Array(n),land:new Uint8Array(n),elig:new Float32Array(n)}}
// Smooth radial reference + smooth physical residual must not be altered.
{
 const a=make();
 for(let j=0;j<a.ny;j++)for(let i=0;i<a.nx;i++){
  const k=j*a.nx+i,x=i-40,y=j-30,r=Math.hypot(x,y),ang=Math.atan2(y,x)+Math.PI/2;
  const base=9+14*Math.exp(-Math.pow((r-11)/10,2)); const extra=2.5*Math.exp(-Math.pow((r-18)/13,2));
  a.ru[k]=Math.cos(ang)*base;a.rv[k]=Math.sin(ang)*base;a.u[k]=a.ru[k]+Math.cos(ang)*extra;a.v[k]=a.rv[k]+Math.sin(ang)*extra;a.elig[k]=1;
 }
 const bu=new Float32Array(a.u),bv=new Float32Array(a.v);filter({nx:a.nx,ny:a.ny,u:a.u,v:a.v,referenceU:a.ru,referenceV:a.rv,landMask:a.land,eligibility:a.elig});
 let max=0;for(let k=0;k<a.n;k++)max=Math.max(max,Math.hypot(a.u[k]-bu[k],a.v[k]-bv[k]));
 assert(max<0.12,`smooth radial field was modified: ${max}`);
}
// Three-row positive stripe must be strongly reduced without bleeding into clean rows.
let positiveAfter=0, positiveBefore=0, positiveOutside=0;
{
 const a=make();
 for(let j=0;j<a.ny;j++)for(let i=0;i<a.nx;i++){const k=j*a.nx+i;a.ru[k]=10;a.rv[k]=2;a.u[k]=10;a.v[k]=2;a.elig[k]=1;}
 for(let j=23;j<=25;j++)for(let i=12;i<=56;i++)a.u[j*a.nx+i]+=6;
 let n=0;for(let j=23;j<=25;j++)for(let i=12;i<=56;i++){const k=j*a.nx+i;positiveBefore+=Math.hypot(a.u[k]-a.ru[k],a.v[k]-a.rv[k]);n++;}positiveBefore/=n;
 filter({nx:a.nx,ny:a.ny,u:a.u,v:a.v,referenceU:a.ru,referenceV:a.rv,landMask:a.land,eligibility:a.elig});
 for(let j=23;j<=25;j++)for(let i=12;i<=56;i++){const k=j*a.nx+i;positiveAfter+=Math.hypot(a.u[k]-a.ru[k],a.v[k]-a.rv[k]);}positiveAfter/=n;
 for(let j=0;j<a.ny;j++)for(let i=0;i<a.nx;i++){if(j>=23&&j<=25&&i>=12&&i<=56)continue;const k=j*a.nx+i;positiveOutside=Math.max(positiveOutside,Math.hypot(a.u[k]-a.ru[k],a.v[k]-a.rv[k]));}
 assert(positiveAfter<positiveBefore*0.38,`positive seam not sufficiently reduced: ${positiveBefore} -> ${positiveAfter}`);
 assert(positiveOutside<0.05,`positive seam repair bled into clean field: ${positiveOutside}`);
}
// Two-row negative/low-wind seam must also be repaired.
let negativeAfter=0,negativeBefore=0;
{
 const a=make();
 for(let j=0;j<a.ny;j++)for(let i=0;i<a.nx;i++){const k=j*a.nx+i;a.ru[k]=12;a.rv[k]=3;a.u[k]=12;a.v[k]=3;a.elig[k]=1;}
 for(let j=28;j<=29;j++)for(let i=10;i<=65;i++){const k=j*a.nx+i,sp=Math.hypot(a.u[k],a.v[k]);a.u[k]-=5*a.u[k]/sp;a.v[k]-=5*a.v[k]/sp;}
 let n=0;for(let j=28;j<=29;j++)for(let i=10;i<=65;i++){const k=j*a.nx+i;negativeBefore+=Math.hypot(a.u[k]-a.ru[k],a.v[k]-a.rv[k]);n++;}negativeBefore/=n;
 filter({nx:a.nx,ny:a.ny,u:a.u,v:a.v,referenceU:a.ru,referenceV:a.rv,landMask:a.land,eligibility:a.elig});
 for(let j=28;j<=29;j++)for(let i=10;i<=65;i++){const k=j*a.nx+i;negativeAfter+=Math.hypot(a.u[k]-a.ru[k],a.v[k]-a.rv[k]);}negativeAfter/=n;
 assert(negativeAfter<negativeBefore*0.22,`negative seam not sufficiently reduced: ${negativeBefore} -> ${negativeAfter}`);
}
console.log('ROUND114 zonal seam regression: PASS');
console.log(JSON.stringify({positiveBeforeMs:+positiveBefore.toFixed(3),positiveAfterMs:+positiveAfter.toFixed(3),positiveOutsideMs:+positiveOutside.toFixed(3),negativeBeforeMs:+negativeBefore.toFixed(3),negativeAfterMs:+negativeAfter.toFixed(3),radialPreserved:true}));
