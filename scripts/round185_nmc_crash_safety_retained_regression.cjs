'use strict';
/** Targeted bridge regression: preserve Round184 chart style with Round185 NMC crash fixes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const nmc=read('src/utils/NmcForecastProduct.ts');
const viewport=read('src/utils/NmcMapViewport.ts');
const loader=read('src/utils/NmcOptionalGeography.ts');
const modal=read('src/components/ForecastImageModal.tsx');
function compile(text,name) {
 const sf=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.equal(sf.parseDiagnostics.length,0,sf.parseDiagnostics.map(d=>d.messageText).join(' '));
 return ts.transpileModule(text,{fileName:name,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}
function loadModule(text,name,modules={}) {
 const module={exports:{}};
 new Function('module','exports','require',compile(text,name))(module,module.exports,id=>{
  assert(id in modules,`mock not found ${id}`);return modules[id];
 });return module.exports;
}
const geo=loadModule(viewport,'NmcMapViewport.ts');
const nmcModule=loadModule(nmc,'NmcForecastProduct.ts',{
 '../simulation/Engine':{getAgencyIntensity:v=>({value:v}),getWindForceCategory:v=>v},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:(d)=>d},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing(){}},
 './NmcMapViewport':geo,'./NmcOptionalGeography':{shouldDrawNmcRiver:()=>false}
});
for(const wrap of [geo.nmcUnwrapLongitude,nmcModule.unwrappedLon]) {
 for(const v of [Infinity,-Infinity,NaN]) assert(Number.isNaN(wrap(v,120)));
 assert(Number.isNaN(wrap(120,Infinity)));
 for(const v of [1e7,-1e7,1e9,-1e9]){
  const p=wrap(v,120);assert(Number.isFinite(p));assert(p>=-61&&p<=301);
 }
 const t=Date.now();for(let i=0;i<20000;i++)wrap(1e9+i,115);
 assert(Date.now()-t<1000,'wrapping must not use unbounded while loops');
}
assert(nmc.includes("globalCompositeOperation='destination-in'"));
assert(!nmc.includes("ctx.clip('evenodd')"));
assert(nmc.includes('onContextLost')&&nmc.includes('AETHER_NMC_OVERLAY_TIMEOUT'));
assert(nmc.includes('overlaySurface?.dispose()'));
assert(nmc.includes('onWarning?.('));
assert(nmc.includes('timeToYield')&&nmc.includes('withinOptionalBudget'));
assert(nmc.includes("ctx.fillText('WMC', 1261, 56)"));
assert(nmc.includes("ctx.fillText('晚风气象台',1165,131,210)"));
assert(!/NMC_STYLE_SPECS|styleVersion|nmc2019|nmc2024/.test(nmc));
assert(modal.includes('onWarning: (message) => { if (!isMini) setGenerationStatus(message); }'));
async function testGeoLoader(fetchMock,kind,expectedCallCount=1) {
 let calls=0;
 const original=global.fetch;
 global.fetch=async (...args)=>{calls++;return fetchMock(...args)};
 try{
  const mod=loadModule(loader,'NmcOptionalGeography.ts');
  const data=await mod.loadNmcOptionalGeography(kind==='province',kind==='river');
  const second=await mod.loadNmcOptionalGeography(kind==='province',kind==='river');
  assert.equal(calls,expectedCallCount,'failed/missing file should not retry indefinitely');
  return {data,second};
 } finally {global.fetch=original;}
}
const success=(value)=>({ok:true,headers:{get:()=> 'application/geo+json'},text:async()=>JSON.stringify(value)});
const feature={type:'Feature',geometry:{type:'LineString',coordinates:[[120,20],[121,21]]},properties:{}};
(async()=>{
 // R205: local province failure now tries two bounded public mirrors.
 const html=await testGeoLoader(async()=>({ok:true,headers:{get:()=> 'text/html'},text:async()=>'<html>index</html>'}),'province',3);
 assert(html.data.errors.join('').includes('省界已跳过'));assert.equal(html.data.provinces,null);
 const missing=await testGeoLoader(async()=>({ok:false,status:404}),'province',3);
 assert(missing.data.errors.join('').includes('404'));
 const invalid=await testGeoLoader(async()=>success({features:[{...feature,geometry:{type:'LineString',coordinates:[[10000000,20]]}}]}),'river');
 assert(invalid.data.errors.join('').includes('地理坐标或体量无效'));
 const valid=await testGeoLoader(async()=>success({features:[feature]}),'river');
 assert.equal(valid.data.errors.length,0);assert.equal(valid.second.rivers.features.length,1);
 // Request that stays pending must abort after the loader's fixed 2-second limit.
 const before=Date.now();
 const timeout=await testGeoLoader(async(_url,{signal})=>new Promise((_ok,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error('timed out')), {once:true});
  }),'province',3);
 assert(timeout.data.errors.length>0);
 assert(Date.now()-before>=10_000 && Date.now()-before<14_000);
 console.log('ROUND185 NMC CRASH RETENTION: PASS — Round184 style, nonfinite/huge longitude, offscreen mask, watchdog, SPA HTML/404/bad-coordinates/timeout degraded and cached');
})().catch(e=>{console.error(e);process.exitCode=1;});
