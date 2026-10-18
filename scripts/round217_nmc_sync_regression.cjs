'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');let count=0;
function test(name,fn){fn();console.log('PASS '+name);count++}
for(const file of ['src/utils/NetworkNmcForecast.ts','src/utils/NetworkAgencyEnsemble.ts','src/components/NetworkEntrySettings.tsx','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkStandaloneExport.ts'])
 test('parses '+file,()=>assert.equal(ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0));
const forecast = Array.from({length:40},(_,i)=>({lat:17+i*.1,lon:130-i*.13,vmax:38+i*.45,pmin:975-i*.5,simHour:(i+1)*3,category:'台风',landed:false}));
let shapeCalled=0,capCalled=0;const nmcEnv={exports:{},Math,Number,Infinity,Error,RangeError,console,require(mod){
 if(mod==='../simulation/Engine')return {materializeForecastPath:(seed,cfg,h)=>forecast.filter(p=>p.simHour<=h)};
 if(mod==='../simulation/PreSimulationReference')return {issuePreSimulationReference:()=>null};
 if(mod==='../simulation/NmcIntensityGuidance')return {limitNmcGenesisPeak:arr=>{capCalled++;return arr},shapeNmcPeakIntensity:(arr,target)=>{shapeCalled++;return arr.map(p=>({...p,vmax:target,pmin:900}))}};
 if(mod==='./NmcForecastProduct')return {selectNmcIssuedForecast:(cur,arr,issue,h)=>[cur,...arr.filter(p=>p.simHour<=issue+h)]};
 if(mod==='./TyphoonNetworkData')return {NETWORK_FORECAST_STYLE:[{agency:'中国',color:'#fa19da'}],sampleNetworkFix:(arr,h)=>({...arr[arr.length-1],simHour:h})};
 throw Error('unexpected import '+mod);
}};
vm.runInNewContext(ts.transpileModule(read('src/utils/NetworkNmcForecast.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,nmcEnv);
const build=nmcEnv.exports.buildSharedNetworkNmcForecast;
const issue={simHour:24,lat:17,lon:130,vmax:35,pmin:975},storm={history:[{...issue,simHour:0},{...issue}],...issue};
const options={forecastHours:72,nmcCustomPeakEnabled:true,nmcCustomPeak:56,nmcCoarseIntensity:true};
let common;
test('one NMC materialization produces China and image intensities',()=>{common=build(storm,issue,{},options);assert.equal(common.china.fixes.length,24);assert.equal(common.china.fixes[0].vmax,56);assert.equal(shapeCalled,1);assert.equal(capCalled,1);assert.equal(common.issuedEndHour,96);});
test('NMC toggle off leaves native forecast peak and NO second reshaping',()=>{const raw=build(storm,issue,{}, {...options,nmcCustomPeakEnabled:false,nmcCoarseIntensity:false});assert.equal(raw.china.fixes[0].vmax,forecast[0].vmax);assert.equal(shapeCalled,1)});
const specs=['WNV3','FNV3','ECMWF','AIFS','GEFS','AIGEPS','HGEFS','GEM'].map(id=>({id}));
const agencyEnv={exports:{},Math,Number,DOMException,console,require(mod){
 if(mod==='../simulation/Engine')return {materializeForecastPath:()=>[],getLandMetrics:()=>({isLand:false})};
 if(mod==='../simulation/AetherEnsembleGuidance')return {AETHER_MODEL_SPECS:specs,buildAetherEnsembleMembers:async()=>[]};
 if(mod==='../simulation/NaturalEarthLoader')return {loadProductNaturalEarthData:async()=>false,checkPointOnProductLandGeoJson:()=>false,productLandGeoJson:null};
 if(mod==='./TyphoonNetworkData')return {NETWORK_FORECAST_STYLE:[]};throw Error(mod);
}};
vm.runInNewContext(ts.transpileModule(read('src/utils/NetworkAgencyEnsemble.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,agencyEnv);
const physical=agencyEnv.exports.physicalAgencyFixes;
const reference=Array.from({length:5},(_,i)=>({...issue,simHour:issue.simHour+3*(i+1),vmax:60,pmin:920}));
const members=[{lat:17,lon:129,vmax:40,pmin:970,leadHour:3,landed:false},{lat:17.5,lon:128,vmax:44,pmin:960,leadHour:6,landed:true},{lat:18,lon:127,vmax:49,pmin:950,leadHour:9,landed:false}];
test('82 percent NMC intensity guidance on sea',()=>{const out=physical(members,issue,{},()=>false,reference);assert.equal(out[0].vmax,56);});
test('post-landfall cannot re-intensify even when a member returns offshore',()=>{const out=physical(members,issue,{},()=>false,reference);assert(out[1].vmax<=out[0].vmax);assert(out[2].vmax<=out[1].vmax);assert(out[2].pmin>=out[1].pmin)});
test('without NMC reference agency retains its independent physical intensity',()=>{const out=physical(members,issue,{},()=>false);assert.equal(out[0].vmax,40)});
const ui=read('src/components/NetworkEntrySettings.tsx'),component=read('src/components/TyphoonNetworkSimulator.tsx');
test('entry does not add independent peak config/slider',()=>{assert(!ui.includes('setPeak'));assert(!ui.includes('forecastPeakIntensityEnabled:true'));});
test('network NMC image and CMA use the exact same original fixes',()=>{assert.match(component,/const nmcPath=chinese\.fixes/);assert.match(component,/forecast:nmcPath,issuedEndHour:nmc\.issuedEndHour/);assert.match(component,/buildNetworkForecastsWithEnsemble\(nmc\.issue,storm,config,chinese/);});
test('point and stroke halfway between R215 and R216',()=>{assert.match(component,/NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=3\.7/);assert.match(component,/weight:f\.agency==='中国'\?2\.3:1\.4/);assert.match(read('src/utils/TyphoonNetworkStandaloneExport.ts'),/agency==='中国'\?8\.8:3\.7/)});
console.log(`R217 ${count}/${count} PASS`);
