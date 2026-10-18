const fs=require('fs'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js'),vm=require('vm'),assert=require('assert');
const {performance}=require('perf_hooks');
function load(file,expose){const s=fs.readFileSync(file,'utf8');const start=s.indexOf('function cubic('),end=s.indexOf('function hash01(',start);assert(start>=0&&end>start);
 const js=ts.transpileModule(s.slice(start,end)+'\n'+expose,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
 const c={Math,Number,Array,Float32Array,Float64Array,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};vm.createContext(c);vm.runInContext(js,c);return c;}
const old=load('scripts/round156_map_before.snapshot','var baseline=sampleWindVectorAndSpeedAtLonLat;');
const modern=load('src/utils/SynopticWindPressureMap.ts','var direct=sampleWindVectorAndSpeedAtLonLat;var prepared=sampleRasterVectorAndSpeed;var axis=createRasterAxis;');
const nx=257,ny=179,field={nx,ny,lon0:111.25,lat0:6.5,stepDeg:.125,u10:new Float32Array(nx*ny),v10:new Float32Array(nx*ny),speedKt:new Float32Array(nx*ny)};
for(let i=0;i<field.u10.length;i++){const u=55*Math.sin(i*.007)+3*Math.cos(i*.73),v=43*Math.cos(i*.004)+2*Math.sin(i*.83);
field.u10[i]=u;field.v10[i]=v;field.speedKt[i]=Math.hypot(u,v)*1.943844;}
let seed=0x11223344;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const xs=Array.from({length:810},()=>field.lon0+(rand()*(nx+16)-8)*field.stepDeg);
const ys=Array.from({length:670},()=>field.lat0+(rand()*(ny+16)-8)*field.stepDeg);
const cx=xs.map(v=>modern.axis((v-field.lon0)/field.stepDeg,nx));
const cy=ys.map(v=>modern.axis((v-field.lat0)/field.stepDeg,ny));
const sampleCount=105000;
const samples=Array.from({length:sampleCount},()=>[(rand()*xs.length)|0,(rand()*ys.length)|0]);
for(const [xi,yi] of samples){const a=old.baseline(field,xs[xi],ys[yi]);const b=modern.prepared(field,cx[xi],cy[yi]);
 for(const key of ['u','v','speedKt'])assert(Object.is(a[key],b[key]),`bicubic mismatch: ${key} ${a[key]} vs ${b[key]}`);
 assert(Object.is(Math.hypot(a.u,a.v),b.speedMs));
}
function timed(fn){let checksum=0;for(let warm=0;warm<2;warm++)for(let i=0;i<7000;i++)checksum+=fn(samples[i]).speedKt;
 const t=performance.now();for(let rep=0;rep<3;rep++)for(const pair of samples)checksum+=fn(pair).speedKt;return {ms:+(performance.now()-t).toFixed(2),checksum};}
const oldTime=timed(([x,y])=>old.baseline(field,xs[x],ys[y]));
const modernTime=timed(([x,y])=>modern.prepared(field,cx[x],cy[y]));
assert(Math.abs(oldTime.checksum-modernTime.checksum)<=Math.abs(oldTime.checksum)*1e-12);
console.log(JSON.stringify({result:'PASS',sampleCount,exact:true,speedBench:{oldMs:oldTime.ms,newMs:modernTime.ms,ratio:+(oldTime.ms/modernTime.ms).toFixed(2),description:'isolated u/v bicubic kernel, not entire field chart'}}));
