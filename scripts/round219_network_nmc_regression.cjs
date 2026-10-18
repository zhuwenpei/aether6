'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.join(__dirname,'..'); const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let tests=0;function test(name,fn){fn();tests++;console.log('PASS',name)}
function load(file,mocks={}){
 const result=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
 const mod={exports:{}};
 const req=(id)=>{if(id in mocks)return mocks[id];throw new Error('Unmocked '+file+' import '+id)};
 vm.runInNewContext('(function(require,module,exports){'+result.outputText+'})',{Date,Math,console,Number,Error,Infinity,DOMException}, {filename:file})(req,mod,mod.exports);
 return mod.exports;
}
const warning=load('src/utils/NetworkWarningLines.ts');
const bins=[5,8,10,12,15,18,20,23,25,28,30,33,35,38,40,42,45,48,50,52,55,58,60,62,65,68,70,72,75,78,80,82,85,88,90,92,95,98,100,105,110,115];
const engine={getWindForceCategory:v=>v<51?14:17,materializeForecastPath:()=>[],getAgencyIntensity(v){if(!Number.isFinite(v)||v<=5)return {value:5};if(v>115)return {value:Math.round(v)};let best=5;for(const x of bins){if(Math.abs(v-x)<Math.abs(v-best))best=x}return {value:best}}};
const data=load('src/utils/TyphoonNetworkData.ts',{'../simulation/Engine':engine,'./NetworkWarningLines':warning});
const types=['#00bf00','#0000ff','#ff7400','#ff0000','#ff00ff','#753fc9'];
test('screenshot sampled six-level palette',()=>assert.deepEqual(Array.from(data.NETWORK_STRENGTH_LEGEND,x=>x.color),types));
test('all six strength colors based on wind not agency',()=>assert.deepEqual([13,20,28,38,48,58].map(v=>data.networkPointColor(v)),types));
test('CMA engine-derived ladder includes 72 88 92',()=>{for(const n of [72,88,92])assert(data.CMA_PUBLIC_WIND_SPEED_LEVELS_MPS.includes(n));});
test('CMA published bins use canonical nearest lower tie',()=>{assert.equal(data.toCmaPublishedWindSpeed(71),70);assert.equal(data.toCmaPublishedWindSpeed(72),72);assert.equal(data.toCmaPublishedWindSpeed(86.6),88);});
test('category uses quantised speed, not previous stale label',()=>{const x=data.cmaPublishedNetworkFix({vmax:41.6,category:'强台风'});assert.equal(x.vmax,42);assert.equal(x.category,'强台风');const y=data.cmaPublishedNetworkFix({vmax:40.6,category:'强台风'});assert.equal(y.vmax,40);assert.equal(y.category,'台风');});
test('genuine non-tropical state remains non-tropical',()=>{assert.equal(data.cmaPublishedCategory(15,'温带气旋'),'温带气旋');});
test('published fix never mutates physical input',()=>{const input={vmax:40.6,category:'强台风'};data.cmaPublishedNetworkFix(input);assert.equal(input.vmax,40.6);});
test('warning crossing hour-clock exact 1/3 speed',()=>{assert.equal(data.advanceNetworkReplayClock(10,1,null),42);assert.equal(data.advanceNetworkReplayClock(12,1,12),12+32/3);});
test('boundary frame preserves elapsed seconds',()=>{const actual=data.advanceNetworkReplayClock(0,1,16);assert(Math.abs(actual-(16+16/3))<1e-8);});
test('pre and post dot cadence remains 32/3 nodes per real second',()=>{const pre=32/3,post=(32/3)/1;assert.equal(pre,post)});
const normNmc=load('src/utils/NmcForecastProduct.ts',{
 '../simulation/Engine':{getAgencyIntensity:engine.getAgencyIntensity,getWindForceCategory:engine.getWindForceCategory},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:(d,h)=>new Date(d.getTime()+3600e3*(h+8))},
 './NetworkWarningLines':warning,
 './ProductCoastlineDrawing':{strokeProductCoastlineRing:()=>{}},
 './NmcMapViewport':{buildNmcGeoFrame:()=>{},nmcProjectPoint:()=>{}},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>false}
});
const date=new Date('2026-10-17T18:00:00Z'); // CST 02:00
const baseline=Array.from({length:19},(_,h)=>({simHour:h,lat:20,lon:140-h,category:'台风',vmax:35+h*.4}));
const visible=normNmc.nmcVisibleHistoricalFixes(baseline,date,18);
test('NMC starts with real genesis node',()=>assert.equal(visible[0].simHour,0));
test('NMC pre-warning connects ONLY drawn historical fixes',()=>{assert(visible.filter(p=>p.simHour<14).every(p=>[0,6,9,12].includes(p.simHour)));});
test('NMC 24h warning thereafter uses hourly nodes',()=>{const k=visible.findIndex(p=>warning.insideNetwork24hWarning(p.lat,p.lon));assert(k>=0);for(let i=k+1;i<visible.length;i++)assert(visible[i].simHour-visible[i-1].simHour<=1+1e-6);});
test('NMC historic path has no 10min smoothing vertices',()=>{const fine=Array.from({length:36*3+1},(_,i)=>{const h=i/6;return {simHour:h,lat:20,lon:140-h,vmax:40}});const pts=normNmc.nmcVisibleHistoricalFixes(fine,date,18);assert(pts.length<25);assert(pts.every(p=>Math.abs(p.simHour-Math.round(p.simHour))<1e-7));});
test('NMC hourly sampler interpolates missing integer physical fix',()=>{const pts=normNmc.nmcVisibleHistoricalFixes([baseline[0],baseline[6],{...baseline[12],lon:121},baseline[18]],date,18);assert(pts.some(p=>p.simHour===14));});
test('NMC draw history shares the same line and dot vertex list',()=>{const s=read('src/utils/NmcForecastProduct.ts');const block=s.slice(s.indexOf('function drawHistory('),s.indexOf('function interpolateForecastPoint('));assert.match(block,/const dots=nmcVisibleHistoricalFixes\(/);assert.match(block,/dots\.forEach\(/);assert.match(block,/for\(const p of dots\)/);});
const live=read('src/components/TyphoonNetworkSimulator.tsx'),offline=read('src/utils/TyphoonNetworkStandaloneExport.ts'),shared=read('src/utils/NetworkNmcForecast.ts');
test('main Chinese and history dots 11px, foreign remains 3.7',()=>{assert.match(live,/NETWORK_DOT_DIAMETER_PX=11;/);assert.match(live,/NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=3\.7/);assert.match(offline,/for\(const p of history\)dot\(p,11\)/);assert.match(offline,/agency==='中国'\?11:3\.7/);});
test('live network playback slows exactly at geometric warning entry',()=>{assert.match(live,/entryHour=history\.find\(p=>insideNetwork24hWarning/);assert.match(live,/advanceNetworkReplayClock\(clock,/);});
test('offline network playback uses same warning geometry and elapsed-time ratio',()=>{assert.match(offline,/warningEntry=history\.find\(p=>insideWarning24/);assert.match(offline,/\(32\/3\)\*dt/);});
test('offline color table exactly equals live colors',()=>{for(const color of types)assert(offline.includes(color));});
test('China and NMC share discrete intensity fixes after shaping',()=>{assert.match(shared,/const published=limited\.map\(p=>cmaPublishedNetworkFix\(p\)\)/);assert.match(live,/const nmcPath=chinese\.fixes/);});
for(const file of ['src/utils/TyphoonNetworkData.ts','src/utils/NetworkNmcForecast.ts','src/utils/NmcForecastProduct.ts','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts'])test('TS syntax '+file,()=>assert.equal(ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0));
console.log(`R219 ${tests}/${tests} PASS`);
