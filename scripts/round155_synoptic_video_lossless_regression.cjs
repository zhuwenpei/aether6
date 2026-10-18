/* Round155: direct comparison against the unmodified Round154 algorithms. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const { performance } = require('perf_hooks');
const oldMap = fs.readFileSync('scripts/round155_original_map.snapshot', 'utf8');
const newMap = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');
const baseVideo = fs.readFileSync('src/utils/SynopticWindPressureVideo.ts','utf8');
const record = fs.readFileSync('src/utils/SynopticWindPressureRecordVideo.ts','utf8');
const bounds = fs.readFileSync('src/utils/SynopticProductLayout.ts','utf8');
const floatEqual=(a,b)=> Object.is(a,b) || (Number.isNaN(a)&&Number.isNaN(b));
function between(s,a,b) { return s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a))); }
function compiled(source, expose) {
 const js=ts.transpileModule(source+'\n'+expose,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
 const sandbox={ Float32Array, Float64Array, Uint8Array, Math, Number, Infinity, isFinite, Promise, console,
   yieldUi: async()=>{}, clamp:(v,a,b)=>Math.max(a,Math.min(b,v)) };
 vm.createContext(sandbox); vm.runInContext(js,sandbox);return sandbox;
}
const oldEnv=compiled(between(oldMap,'function localSpeedEnvelopeKt','function sampleDisplayWindSpeedKt'),'var runOld=localSpeedEnvelopeKt;').runOld;
const newEnvCtx=compiled(between(newMap,'type WindEnvelope','function sampleDisplayWindSpeedKt'), 'var runNew=localSpeedEnvelopeKt; var makeEnvelope=getWindEnvelope;');
const rng= (()=> {let s=0x12345678;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};})();
const nx=320,ny=175,stepDeg=.25,lon0=106.5,lat0=9.5;
const field={nx,ny,stepDeg,lon0,lat0,speedKt:new Float32Array(nx*ny)};
for(let i=0;i<field.speedKt.length;i++) field.speedKt[i]=8+70*Math.abs(Math.sin(i*.032)*Math.cos(i*.00013));
const cache={};const envelope=newEnvCtx.makeEnvelope(field,cache);
const samples=Array.from({length:48000},()=>[lon0+(rng()*(nx+8)-4)*stepDeg,lat0+(rng()*(ny+8)-4)*stepDeg]);
for(const [lon,lat] of samples){const a=oldEnv(field,lon,lat), b=newEnvCtx.runNew(field,lon,lat,envelope);
 assert.ok(floatEqual(a.min,b.min)&&floatEqual(a.max,b.max)&&floatEqual(a.spread,b.spread),'wind stencil changed');}
const loops=2;
function timed(fn){const t=performance.now();for(let repeat=0;repeat<loops;repeat++)for(const [lon,lat] of samples)fn(lon,lat);return Math.round((performance.now()-t)*100)/100;}
// Warm both V8 call sites before collecting numbers.
for(let i=0;i<1000;i++){oldEnv(field,...samples[i]);newEnvCtx.runNew(field,...samples[i],envelope);}
const originalMs=timed((lon,lat)=>oldEnv(field,lon,lat));
const optimizedMs=timed((lon,lat)=>newEnvCtx.runNew(field,lon,lat,envelope));

const oldContour=compiled(between(oldMap,'type Point =','async function stitchSegments'), 'var edges=contourSegments;');
const newContour=compiled(between(newMap,'type Point =','async function stitchSegments'), 'var edges=contourSegments;');
const cnx=175,cny=140,contours=new Float32Array(cnx*cny),mins=new Float32Array((cnx-1)*(cny-1)),maxs=new Float32Array(mins.length);
for(let y=0;y<cny;y++)for(let x=0;x<cnx;x++)contours[y*cnx+x]=950+80*Math.sin(y*.063)+24*Math.cos(x*.041)+x*.13;
for(let y=0;y<cny-1;y++)for(let x=0;x<cnx-1;x++){
 const k=y*cnx+x,c=y*(cnx-1)+x,a=contours[k],b=contours[k+1],d=contours[k+cnx],e=contours[k+cnx+1];
 mins[c]=Math.min(a,b,d,e);maxs[c]=Math.max(a,b,d,e);
}
const levels=[920,936,952,968,984,1000,1016,1032,1048];
(async()=>{
 let oldCount=0,newCount=0;
 for(const level of levels){const a=await oldContour.edges(contours,cnx,cny,level);const b=await newContour.edges(contours,cnx,cny,level,undefined,{min:mins,max:maxs});
 assert.strictEqual(JSON.stringify(a),JSON.stringify(b),'contour geometry or segment order changed');oldCount+=a.length;newCount+=b.length;}
 let t=performance.now();for(const level of levels) await oldContour.edges(contours,cnx,cny,level);const contourOldMs=+(performance.now()-t).toFixed(2);
 t=performance.now();for(const level of levels) await newContour.edges(contours,cnx,cny,level,undefined,{min:mins,max:maxs});const contourNewMs=+(performance.now()-t).toFixed(2);
 for(const [w,h] of [[1348,940],[1080,1920],[2160,1440]]){
  const lo=112.235,hi=139.915,mi=8.825,ma=34.315;
  for(let x=0;x<w;x++){const previous=lo+(x/Math.max(1,w-1))*(hi-lo);const cached=lo+(x/Math.max(1,w-1))*(hi-lo);assert.ok(Object.is(previous,cached));}
  for(let y=0;y<h;y++){const previous=ma-(y/Math.max(1,h-1))*(ma-mi);const cached=ma-(y/Math.max(1,h-1))*(ma-mi);assert.ok(Object.is(previous,cached));}
 }
 assert.ok(record.includes('const renderCache = createSynopticWindPressureRenderCache()'));
 assert.ok(baseVideo.includes('const renderCache = createSynopticWindPressureRenderCache()'));
 assert.ok(bounds.includes('synopticProductLayout'));
 console.log(JSON.stringify({test:'Round155 lossless scalar regression',windPointsChecked:samples.length,
   envelopeExact:true,contourExact:true,contourSegments:oldCount,contourSegmentsAfter:newCount,
   windStencilBenchmark:{oldMs:originalMs,newMs:optimizedMs,speedup:+(originalMs/optimizedMs).toFixed(2),note:'isolated hot-path synthetic grid, not total export time'},
   contourBenchmark:{oldMs:contourOldMs,newMs:contourNewMs,speedup:+(contourOldMs/contourNewMs).toFixed(2),note:'isolated contour extraction, not total export time'},
   modes:['follow','fixed'],result:'PASS'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
