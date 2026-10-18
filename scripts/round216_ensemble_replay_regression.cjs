'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const base=path.join(__dirname,'..'), read=f=>fs.readFileSync(path.join(base,f),'utf8');let n=0;
function test(name,fn){fn();console.log('PASS',name);n++}
for(const f of ['src/utils/NetworkAgencyEnsemble.ts','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts','src/utils/TyphoonNetworkReferenceRaster.ts']){
 test('parses '+f,()=>assert.equal(ts.createSourceFile(f,read(f),ts.ScriptTarget.Latest,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0));
}
const code=ts.transpileModule(read('src/utils/NetworkAgencyEnsemble.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const specs=['WNV3','FNV3','ECMWF','AIFS','GEFS','AIGEPS','HGEFS','GEM'].map(id=>({id}));
const env={exports:{},Math,Number,console,DOMException,require(name){
 if(name==='../simulation/Engine')return {getLandMetrics:()=>({isLand:false}),materializeForecastPath:()=>[]};
 if(name==='../simulation/AetherEnsembleGuidance')return {AETHER_MODEL_SPECS:specs,buildAetherEnsembleMembers:async()=>[]};
 if(name==='../simulation/NaturalEarthLoader')return {loadProductNaturalEarthData:async()=>false,checkPointOnProductLandGeoJson:()=>false,productLandGeoJson:null};
 if(name==='./TyphoonNetworkData')return {NETWORK_FORECAST_STYLE:[{agency:'中国',color:'#fa0'},{agency:'日本',color:'#a97a07'},{agency:'美国',color:'#07b5f4'},{agency:'韩国',color:'#05ea30'}],buildNetworkForecasts:()=>[{agency:'中国',color:'#fa0',fixes:[]}]};
 throw Error('Unexpected '+name);
}};vm.runInNewContext(code,env,{filename:'NetworkAgencyEnsemble.cjs'});
const {selectNetworkAgencyModels,physicalAgencyFixes}=env.exports;
const storm={id:'storm-2026',name:'typhoon',lat:20,lon:130},cfg={seed:'r216'};
test('one stable unique random model per foreign agency',()=>{
 const a=selectNetworkAgencyModels(storm,cfg),b=selectNetworkAgencyModels(storm,{...cfg});
 assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
 assert.equal(a.length,3);assert.deepEqual(Array.from(a.map(x=>x.agency)),['日本','美国','韩国']);
 assert.equal(new Set(a.map(x=>x.modelId)).size,3);assert(a.every(x=>x.memberIndex===1||x.memberIndex===2));
});
test('agency assignment does not depend on forecast issue hour',()=>{
 const a=selectNetworkAgencyModels({...storm,simHour:30},cfg),b=selectNetworkAgencyModels({...storm,simHour:90},cfg);
 assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
});
const fix={lat:18,lon:130,vmax:40,pmin:960,simHour:66,speed:20,direction:300};
const member=[{lat:18,lon:130,vmax:40,pmin:960,leadHour:0},{lat:18.2,lon:129.6,vmax:45.3,pmin:950.6,leadHour:3,landed:false},
 {lat:18.6,lon:129.3,vmax:49.1,pmin:943,leadHour:6,landed:true},{lat:18.8,lon:128.8,vmax:51.8,pmin:940,leadHour:9,landed:true},
 {lat:19.1,lon:128.5,vmax:52.5,pmin:939,leadHour:12,landed:true},{lat:19.4,lon:128.2,vmax:46.7,pmin:956,leadHour:15,landed:false}];
test('3-hour nodes only, landfall gate denies inland strengthening and deepening',()=>{
 const out=physicalAgencyFixes(member,fix,cfg,()=>false);
 assert.deepEqual(Array.from(out.map(x=>x.simHour)),[69,72,75,78,81]);
 assert.equal(out[0].vmax,45);assert(out[1].vmax<out[0].vmax);
 for(let i=2;i<4;i++){assert(out[i].vmax<=out[i-1].vmax);assert(out[i].pmin>=out[i-1].pmin);}
 assert.equal(out[4].vmax,47);assert.equal(out[4].landed,false);
});
test('geographic land checks override a falsely ocean model fix',()=>{
 const out=physicalAgencyFixes(member.map(p=>({...p,landed:false})),fix,cfg,(lat)=>lat>18.5&&lat<19.2);
 assert(out[1].vmax<out[0].vmax);assert(out[2].vmax<out[1].vmax);
});
test('no mutation of source issue or member array',()=>{
 const before=JSON.stringify([fix,member]);physicalAgencyFixes(member,fix,cfg,()=>false);assert.equal(JSON.stringify([fix,member]),before);
});
const component=read('src/components/TyphoonNetworkSimulator.tsx');
test('UI uses async real ensemble for forecast, not old synthetic foreign series',()=>{
 assert.match(component,/await buildNetworkForecastsWithEnsemble\(issue,storm,config,controller\.current\.signal,/);
 assert.match(component,/buildNetworkForecasts\(issue,storm,config,true\)\.filter\(item=>item\.agency==='中国'\)/);
});
test('fixed replay zoom/pan avoids per-frame changing fractional setView',()=>{
 assert.match(component,/playbackZoomRef=useRef<number\|null>\(null\)/);
 assert.match(component,/playbackZoomRef\.current===null/);
 assert.match(component,/map\.panTo\(currentPoint,\{animate:false,noMoveStart:true\}\)/);
 assert.doesNotMatch(component,/map\.setView\(currentPoint,networkReplayZoomForWidth/);
});
test('dot outlines up, non-CMA dots and dashed paths down',()=>{
 assert.match(component,/NETWORK_HISTORY_DOT_STROKE_PX=0\.65/);
 assert.match(component,/NETWORK_CMA_DOT_STROKE_PX=0\.65/);
 assert.match(component,/NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=3\.4/);
 assert.match(component,/weight:f\.agency==='中国'\?2\.3:1\.25/);
 assert.match(read('src/utils/TyphoonNetworkStandaloneExport.ts'),/dot\(p,f\.agency==='中国'\?8\.8:3\.4\)/);
});
console.log(`R216 ${n}/${n} PASS`);
