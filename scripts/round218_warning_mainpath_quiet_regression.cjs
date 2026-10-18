'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let tests=0;async function check(label,fn){await fn();tests++;console.log('PASS',label)}
function load(rel,mocks={}){const src=read(rel),mod={exports:{}};const result=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const req=p=>{if(p in mocks)return mocks[p];throw Error('Unexpected import: '+p)};
vm.runInNewContext('(function(require,module,exports){'+result.outputText+'})',{DOMException,Math,console,Date,Number}, {filename:rel})(req,mod,mod.exports);return mod.exports}
async function main(){
 const w=load('src/utils/NetworkWarningLines.ts');
 await check('warning line has 6 + 4 WGS84 control points',()=>{assert.equal(w.NETWORK_WARNING_24H.length,6);assert.equal(w.NETWORK_WARNING_48H.length,4);});
 await check('inside/outside across boundary and latitude interpolations',()=>{assert.equal(w.insideNetwork24hWarning(18,118),true);assert.equal(w.insideNetwork24hWarning(18,121),false);assert.equal(w.insideNetwork24hWarning(30,126),true);assert.equal(w.insideNetwork24hWarning(30,128),false);assert.equal(w.insideNetwork24hWarning(-2,100),false);});
 const td=load('src/utils/TyphoonNetworkData.ts',{'../simulation/Engine':{getWindForceCategory:()=>12,materializeForecastPath:()=>[],getAgencyIntensity:v=>({value:Math.max(5,[5,8,10,12,15,18,20,23,25,28,30,33,35,38,40,42,45,48,50,52,55,58,60,62,65,68,70,72,75,78,80,82,85,88,90,92,95,98,100,105,110,115].reduce((best,x)=>Math.abs(x-v)<Math.abs(best-v)?x:best,5))})},'./NetworkWarningLines':w});
 const storm={id:'R218',name:'Test',simHour:18,history:Array.from({length:19},(_,h)=>({simHour:h,lat:18,lon:122-h*.4,vmax:37+h*.22,pmin:970-h, speed:20,direction:270,r7:{ne:30,se:30,sw:30,nw:30},r10:{ne:0,se:0,sw:0,nw:0},r12:{ne:0,se:0,sw:0,nw:0}}))};
 await check('no crossing preserves CMA 3-hour history',()=>{const orig={...storm,history:storm.history.map(x=>({...x,lon:134}))};const fixes=td.warningAdaptiveNetworkHistory(orig,new Date('2026-10-18T00:00:00Z'),18);assert.equal(fixes.some((p,i)=>i>0&&p.simHour-fixes[i-1].simHour===1),false)});
 await check('crossing changes to 1-hour real historical positions with CMA wind tiers',()=>{const fixes=td.warningAdaptiveNetworkHistory(storm,new Date('2026-10-18T00:00:00Z'),18);const idx=fixes.findIndex(p=>w.insideNetwork24hWarning(p.lat,p.lon));assert(idx>=0);assert(fixes.slice(idx+1).every((p,i)=>p.simHour-fixes[idx+i].simHour===1));assert(fixes.every(p=>td.CMA_PUBLIC_WIND_SPEED_LEVELS_MPS.includes(p.vmax)));assert.equal(fixes.at(-1).simHour,18)});
 await check('never samples future fixes',()=>{const fixes=td.warningAdaptiveNetworkHistory(storm,new Date('2026-10-18T00:00:00Z'),13);assert(fixes.every(p=>p.simHour<=13));});
 const specs=['WNV3','FNV3','ECMWF','AIFS','GEFS','AIGEPS','HGEFS','GEM'].map(id=>({id}));
 const shown=[];
 const agency=load('src/utils/NetworkAgencyEnsemble.ts',{'../simulation/Engine':{getLandMetrics:()=>({isLand:false}),materializeForecastPath:(_s,_c,h)=>{assert.equal(h,168);return []}},
 '../simulation/AetherEnsembleGuidance':{AETHER_MODEL_SPECS:specs,buildAetherCenterGuidance:(_s,_h,_scene,_seed,_path,horizon)=>{assert.equal(horizon,168);return specs.map(s=>({modelId:s.id,control:true,track:[3,6,9,12].map(leadHour=>({lat:20+leadHour/100,lon:130-leadHour/100,leadHour,vmax:39-leadHour/3,pmin:965+leadHour/3,landed:leadHour>=9}))}))}},
 '../simulation/NaturalEarthLoader':{loadProductNaturalEarthData:async()=>false,checkPointOnProductLandGeoJson:()=>false,productLandGeoJson:null},
 './TyphoonNetworkData':{NETWORK_FORECAST_STYLE:[{agency:'中国',color:'red'},{agency:'日本',color:'gold'},{agency:'美国',color:'blue'},{agency:'韩国',color:'green'}]}});
 await check('fixed 3 unique main paths, excluding WNV3 and FNV3',()=>{const a=agency.selectNetworkAgencyModels(storm,{seed:'test'}),b=agency.selectNetworkAgencyModels(storm,{seed:'test'});assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));assert.equal(new Set(a.map(x=>x.modelId)).size,3);assert(a.every(x=>x.modelId!=='WNV3'&&x.modelId!=='FNV3'));assert(a.every(x=>!('memberIndex' in x)));});
 await check('allowed 6 main models include GEM and exclude WNV3/FNV3',()=>{const ids=agency.NETWORK_ALLOWED_MAIN_MODELS.map(s=>s.id).sort();assert.deepEqual(JSON.parse(JSON.stringify(ids)),['AIFS','AIGEPS','ECMWF','GEFS','GEM','HGEFS'].sort());});
 await check('GEM model can actually be assigned on at least one stable storm seed',()=>{const seen=new Set();for(let i=0;i<100;i++)for(const p of agency.selectNetworkAgencyModels(storm,{seed:'test'+i}))seen.add(p.modelId);assert(seen.has('GEM'));});
 await check('main forecast consumes control instead of plume member',async()=>{const issue={...storm.history.at(-1)},china={agency:'中国',color:'red',fixes:[3,6,9,12].map(h=>({...issue,simHour:issue.simHour+h,vmax:38-h*.3}))};const results=await agency.buildNetworkForecastsWithEnsemble(issue,storm,{seed:'test',coastlineSource:'naturalEarth'},china);assert.equal(results.length,4);assert.equal(results[0],china);assert(results.slice(1).every(f=>f.sourceModelId&&f.fixes.length>0));assert(results.slice(1).every(f=>f.fixes[2].vmax<=f.fixes[1].vmax));});
 const component=read('src/components/TyphoonNetworkSimulator.tsx');const entry=read('src/components/NetworkEntrySettings.tsx');const offline=read('src/utils/TyphoonNetworkStandaloneExport.ts');
 await check('live warning lines share map SVG and provider reprojection',()=>{assert(component.includes('NETWORK_WARNING_24H'));assert(component.includes('NETWORK_WARNING_48H'));assert(component.includes('displayPoint(lon,lat)'));});
 await check('R219 replay clock shifts from 32h/s to 32/3h/s after warning crossing',()=>{assert.match(component,/advanceNetworkReplayClock\(clock,/);assert.match(component,/requestAnimationFrame\(step\)/);assert.match(offline,/requestAnimationFrame\(step\)/);assert.match(offline,/\(32\/3\)\*dt/);});
 await check('offline map warning lines embedded and red/yellow styled',()=>{assert(offline.includes('warningLines:{h24:NETWORK_WARNING_24H,h48:NETWORK_WARNING_48H}'));assert(offline.includes("'#e1162d'"));assert(offline.includes("'#f9e12a'"));});
 await check('quiet mode password, consent, and reversible toggle',()=>{assert(entry.includes("quietPassword!=='110908'"));assert(entry.includes('quietAcknowledged'));assert(entry.includes('setQuietSimulationHints(false)'));assert(entry.includes('免责声明'));});
 await check('simulation provenance stays visible in map/export',()=>{assert(component.includes('tn-map-simulation-mark'));assert(offline.includes('虚拟模拟 · 非官方预报'));});
 for(const file of ['src/utils/NetworkWarningLines.ts','src/utils/NetworkAgencyEnsemble.ts','src/utils/TyphoonNetworkData.ts','src/components/NetworkEntrySettings.tsx','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts']){
 await check('parses '+file,()=>{const sf=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(sf.parseDiagnostics.length,0)});
 }
 console.log(`R218 ${tests}/${tests} PASS`);
}
main().catch(err=>{console.error(err);process.exitCode=1});
