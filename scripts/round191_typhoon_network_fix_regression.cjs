/* Round191 — real-source and real-archive regressions; executes without npm install. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..'),get=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const output=[];const test=(name,f)=>{try{f();console.log('PASS',name);output.push({name,status:'PASS'})}catch(e){console.log('FAIL',name,e.message);output.push({name,status:'FAIL',error:e.message})}};
const stub=()=>{};
const src=get('src/utils/TyphoonNetworkData.ts');
const transpiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ex={};
vm.runInNewContext(transpiled,{exports:ex,require:()=>({getWindForceCategory:()=>8,materializeForecastPath:()=>[]})});
const {cmaBoundedNetworkHistory,previousCmaPublicHour}=ex;
const radii={ne:220,se:160,sw:200,nw:140};
const storm={simHour:30,lat:20,lon:140,vmax:40,pmin:950,direction:320,speed:22,rmw:30,r7:radii,r10:radii,r12:radii,history:Array.from({length:31},(_,h)=>({simHour:h,lat:10+h*.1,lon:140+h*.1,vmax:22+h*.4,pmin:990-h,speed:22,direction:320,rmw:30,r7:radii,r10:radii,r12:radii}))};
const start=new Date(Date.UTC(2023,6,27,9)); // China Standard Time 2023-07-27 17:00
for(const [now,expected] of [[0,[0]],[3,[0,3]],[5,[0,3]],[6,[0,3,6]],[7,[0,3,6]],[9,[0,3,6,9]],[29,Array.from({length:10},(_,i)=>i*3)]]){
 test(`CMA 02/05/08/11/14/17/20/23 cutoff at t=${now}`,()=>assert.deepEqual(Array.from(cmaBoundedNetworkHistory(storm,start,now),x=>x.simHour),expected));
}
test('CMA hour never exceeds current or history',()=>{
 for(let h=0;h<=30;h+=.5){const track=cmaBoundedNetworkHistory(storm,start,h);assert(track.every(f=>f.simHour<=h+1e-6 && f.simHour<=30+1e-6));}
});
test('unaligned genesis uses exact Beijing schedule',()=>{
 const late=new Date(Date.UTC(2023,6,27,10)); // Beijing 18:00, next 20:00 at h=2
 assert.deepEqual(Array.from(cmaBoundedNetworkHistory(storm,late,9),x=>x.simHour),[0,2,5,8]);
});
test('late unrecorded future points never appended',()=>{
 const truncated={...storm,history:storm.history.slice(0,26)};
 assert.deepEqual(Array.from(cmaBoundedNetworkHistory(truncated,start,30),x=>x.simHour).at(-1),24);
});
test('CMA capping never mutates the original physical history',()=>{
 const before=JSON.stringify(storm);cmaBoundedNetworkHistory(storm,start,29.8);assert.equal(JSON.stringify(storm),before);
});
const page=get('src/components/TyphoonNetworkSimulator.tsx');
const css=get('src/components/TyphoonNetworkSimulator.css');
for(const file of ['src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/components/ForecastImageModal.tsx','src/App.tsx']){
 test('TS/TSX syntax '+file,()=>{const ast=ts.createSourceFile(file,get(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(x=>x.messageText).join('; '));});
}
test('two native geographically anchored popups',()=>{assert(page.includes('L.popup(')&&page.includes('popup.setLatLng([fix.lat,fix.lon])'));assert(page.includes('BMap.InfoWindow(')&&page.includes('bm.openInfoWindow(info,point)'));assert(!page.includes('tn-popup-shell'));});
test('native triangle tip targets the exact point',()=>assert(page.includes('offset:L.point(0,0)')));
test('opaque readable popup style defeats global theme',()=>{
 for(const token of ['#root .tn-map .leaflet-popup.tn-map-popup .leaflet-popup-content-wrapper','color:#151515!important','background:#fff!important','backdrop-filter:none!important'])assert(css.includes(token),token);
});
test('reference return does not restart 16x animation',()=>{
 assert(page.includes("if(stage==='reference'){setStage('map');}else onClose()"));
 assert(!page.includes('setFrame(0);setPicked'));
 assert(page.includes("setStage('reference');setPlaying(false);"));
 assert(page.includes('  },[]);'));
});
test('bottom simulator timeline overlay removed',()=>{assert(!page.includes('tn-progress-text'));assert(!page.includes('tn-popup-shell'));});
test('pure strength-colored focus dot, not multiring icon',()=>{
 assert(page.includes('L.circleMarker([fix.lat,fix.lon],{radius:NETWORK_DOT_RADIUS_PX,color:'));assert(!page.includes('tn-eye-rings'));
 assert(page.includes('new BMap.Marker(toBaiduPoint(BMap,p.lon,p.lat),{icon})'));
});
test('all three map providers use sea-only rings',()=>{
 assert.equal((page.match(/shouldDrawNetworkWindRadii\(/g)||[]).length,4);
 assert(page.includes('checkPointOnLandGeoJson(fix.lat,fix.lon)'));
});
test('CMA bounded track drives map, forecast and ticker',()=>{
 assert(page.includes('const history=cmaBoundedNetworkHistory(storm,startDate,currentHour)'));
 assert(page.includes('const issue=history[history.length-1]'));
 assert(page.includes('const latest=product?.history[product.history.length-1]'));
});
test('no modified unrelated physics or forecasts',()=>{assert(!page.includes('setTyphoons('));assert(page.includes('drawNmcForecastProductCooperative('));});
// Extract the pure renderer implementation without needing Leaflet, React or dependencies.
const a=page.indexOf('export function windRing('),b=page.indexOf('const encode=',a);
const geoJs=ts.transpileModule(page.slice(a,b),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let isLand=false,haveGeo=true;const geox={};
vm.runInNewContext(geoJs,{exports:geox,landGeoJson:{features:[1]},checkPointOnLandGeoJson:()=>isLand});
const fix={lat:22,lon:140,r7:{ne:250,se:100,sw:180,nw:320},r10:radii,r12:radii,landed:false};
test('all 4 quadrant boundaries are exact parallels or meridians',()=>{
 const nodes=geox.windRing(fix,'r7');assert.equal(nodes.length,484);
 // Every junction is stored twice (end previous arc/start next arc), and is axis-aligned.
 for(const [from,to,axis] of [[120,121,'lat'],[241,242,'lon'],[362,363,'lat'],[483,0,'lon']]){
   const a=nodes[from],b=nodes[to];assert(Math.abs(a[axis==='lat'?0:1]-b[axis==='lat'?0:1])<1e-7,`${from}->${to} ${axis}`);
 }
});
test('landfall skips rings even when original quadrant radii nonzero',()=>{
 assert.equal(geox.shouldDrawNetworkWindRadii(fix),true);
 // module reads a stub snapshot; use local mock to exercise land inference.
 const geoRequire=(id)=>({landGeoJson:{features:[1]},checkPointOnLandGeoJson:()=>true});
 const landed={};vm.runInNewContext(geoJs,{exports:landed,landGeoJson:{features:[1]},checkPointOnLandGeoJson:()=>true});
 assert.equal(landed.shouldDrawNetworkWindRadii(fix),false);
});
test('prior landed flag is not sticky once center returns to water with coastline ready',()=>{
 assert.equal(geox.shouldDrawNetworkWindRadii({...fix,landed:true}),true);
});
test('land without radius never shows rings',()=>{
 assert.equal(geox.shouldDrawNetworkWindRadii({...fix,r7:{ne:0,se:0,sw:0,nw:0},r10:{ne:0,se:0,sw:0,nw:0},r12:{ne:0,se:0,sw:0,nw:0}}),false);
});
const failed=output.filter(x=>x.status==='FAIL');
const report={round:191,tests:output.length,passed:output.length-failed.length,failed:failed.length,results:output,generated:new Date().toISOString()};
fs.writeFileSync(path.join(root,'ROUND191_VALIDATION.json'),JSON.stringify(report,null,2));
console.log(`R191 ${report.passed}/${report.tests} PASS`);
if(failed.length)process.exitCode=1;
