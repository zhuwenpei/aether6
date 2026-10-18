'use strict';
/** Root regression: a timeline copied from the main simulation may contain
 * no wind above 42m/s, yet the ordinary deterministic issue solver can have
 * a solitary 60m/s pulse. Such a pulse must not replace an archived observation.
 */
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const src=file=>fs.readFileSync(file,'utf8');
const compile=(code,name)=>ts.transpileModule(code,{fileName:name,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(file,modules={}) {
 const m={exports:{}};
 vm.runInNewContext(compile(src(file),file),{module:m,exports:m.exports,
   require:k=>{if(k in modules)return modules[k];throw Error('unexpected module: '+k)},
   Math,Number,Map,Set,Error,RangeError,Array,Object});
 return m.exports;
}
const physics=load('src/simulation/PreSimulationReference.ts');
const nmc=load('src/utils/NmcForecastProduct.ts',{
 '../simulation/Engine':{getAgencyIntensity:v=>({value:v}),getWindForceCategory:v=>v>=17.2?8:7},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:()=>new Date()},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing:()=>{}},
 './NmcMapViewport':{buildNmcGeoFrame:()=>({}),nmcProjectPoint:()=>({})},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>true}
});
const radii={ne:100,se:100,sw:100,nw:100};
const mk=(h,wind)=>({simHour:h,lat:15+h*.12,lon:140-h*.18,vmax:wind,
 pmin:1006-wind,category:wind>=41.5?'强台风':wind>=32.7?'台风':wind>=24.5?'强热带风暴':wind>=17.2?'热带风暴':'热带低压',
 speed:22,direction:303,rmw:26,landed:false,dissipated:false,r7:radii,r10:radii,r12:radii});
const hist=Array.from({length:121},(_,h)=>mk(h,h<=72?12+30*h/72:42-27*(h-72)/48));
assert(Math.max(...hist.map(h=>h.vmax))<=42);
const storm={id:'R177',history:hist};
const ref=physics.buildPreSimulationReference(storm,0,'main-history');
assert.equal(ref.origin,'main-history');
const fakePulse=hist.map(p=>p.simHour===72?{...p,vmax:60}:p);
assert.equal(fakePulse.find(p=>p.simHour===72).vmax,60);
const copied=physics.mainHistoryForecastFixes(ref,0,hist[0],120);
assert(copied && copied.length===121,'full recorded period must be replayable');
for(let h=0;h<=120;h++){
 assert.equal(copied[h].leadHour,h);
 assert(Math.abs(copied[h].vmax-hist[h].vmax)<1e-9,'recorded wind changed at '+h);
 assert(Math.abs(copied[h].lat-hist[h].lat)<1e-9,'recorded latitude changed at '+h);
 assert(Math.abs(copied[h].lon-hist[h].lon)<1e-9,'recorded longitude changed at '+h);
}
assert.equal(copied[72].vmax,42,'phantom single 60m/s fix survived the exact historical route');
assert(Math.max(...copied.map(f=>f.vmax))<=42);
// NMC's 12/24h reporting cadence is a read-only interpolation of these facts.
const issued=nmc.selectNmcIssuedForecast({lat:hist[0].lat,lon:hist[0].lon,vmax:hist[0].vmax,simHour:0,category:hist[0].category},
 copied.slice(1).map(p=>({...p,simHour:p.leadHour})),0,120);
assert(Math.max(...issued.map(f=>f.vmax))<=42,'NMC published cadence manufactured 60m/s');
assert(issued.some(f=>f.simHour===72 && f.vmax===42),'NMC 72h bulletin does not use recorded 42m/s');
// Opening a later historical forecast must begin at the matching observed hour.
const replay=physics.mainHistoryForecastFixes(ref,24,hist[24],96);
assert(replay && replay.length===97);
assert.equal(replay[0].vmax,hist[24].vmax);
assert.equal(replay[48].vmax,42);
assert.equal(replay.at(-1).vmax,hist[120].vmax);
// A shifted or edited issue state cannot masquerade as archived observations.
assert.equal(physics.mainHistoryForecastFixes(ref,0,{...hist[0],lon:hist[0].lon+2},120),undefined);
assert.equal(physics.mainHistoryForecastFixes(ref,0,{...hist[0],vmax:30},120),undefined);
assert.equal(physics.mainHistoryForecastFixes(physics.buildPreSimulationReference(storm,0),0,hist[0],120),undefined,
 'regular sandbox paths must continue ordinary physics-guided blending');
// Coverage must never extrapolate/extend beyond the actually recorded period.
const short=physics.mainHistoryForecastFixes(ref,60,hist[60],120);
assert(short && short.at(-1).leadHour===60 && short.at(-1).vmax===hist[120].vmax);
const source=src('src/simulation/Engine.ts');
// Execute the REAL exported Engine materialization function in isolation.
// The regular model is rigged to emit an hourly single-point 60m/s spike at 72h.
// A 120-hour archive must bypass it entirely, not merely clip the end result.
const tree=ts.createSourceFile('Engine.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
const decl=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='materializeForecastPath');
assert(decl,'Engine materializer not found');
const code=compile(decl.getText(tree)+'\nmodule.exports.materializeForecastPath=materializeForecastPath;','extracted.ts');
let ordinaryCalls=0;
const foreign={exports:{}};
vm.runInNewContext(code,{module:foreign,exports:foreign.exports,
 issuePreSimulationReference:physics.issuePreSimulationReference,
 mainHistoryForecastFixes:physics.mainHistoryForecastFixes,
 rebasePreSimulationReference:physics.rebasePreSimulationReference,
 blendPreSimulationForecast:physics.blendPreSimulationForecast,
 calculateForecastTrackPath:()=>{ordinaryCalls++;return fakePulse},
 calculateForecastPath:()=>{ordinaryCalls++;return fakePulse},
 landGeoJson:undefined,checkPointOnLandGeoJson:()=>false,
 TyphoonCategory:{TD:'热带低压',TS:'热带风暴',STS:'强热带风暴',TY:'台风',STY:'强台风',SuperTY:'超强台风',ET:'温带气旋',RL:'残留低压',DS:'已消散'},
 Number,Math,Array,Object}, {filename:'Engine:materializeForecastPath'});
const model=foreign.exports.materializeForecastPath;
const stormAtZero={...hist[0],id:'R177',history:[{...hist[0],preSimulationReference:ref}],preSimulationReference:ref};
const official=model(stormAtZero,{},120,[]);
assert.equal(ordinaryCalls,0,'a completed historical timeline must bypass speculative model integration');
assert.equal(official.length,121);
assert.equal(official.find(f=>f.simHour===72).vmax,42,'real Engine materializer leaked the model-only 60m/s spike');
assert(Math.max(...official.map(f=>f.vmax))<=42);
assert(official.every(f=>f.preSimulationGuided),'archived output must be labelled as guided');
// A replay forecast issued at +24h still reads hour 72 as lead 48.
const stormAt24={...hist[24],id:'R177',history:[{...hist[0],preSimulationReference:ref},hist[24]],preSimulationReference:ref};
const replayed=model(stormAt24,{},96,[]);
assert.equal(replayed.find(f=>f.simHour===48).vmax,42);
assert.equal(ordinaryCalls,0);
// Non-main references still need the regular solver and unchanged blending.
const sandbox=physics.buildPreSimulationReference(storm,0);
const ordinary=model({...stormAtZero,preSimulationReference:sandbox,history:[{...hist[0],preSimulationReference:sandbox}]},{},120,[]);
assert(ordinaryCalls>0,'regular sandbox mode was unintentionally made an exact history replay');
assert(ordinary.length>0);
// When less than 120h is recorded, the materializer must retain observed
// prefix and let the ordinary model resume after it; no invented data at 0-60h.
const shortRef={...ref,completedLeadHour:60,fixes:ref.fixes.filter(f=>f.leadHour<=60)};
const shortModel=model({...stormAtZero,preSimulationReference:shortRef,
 history:[{...hist[0],preSimulationReference:shortRef}]},{},120,[]);
assert(shortModel.find(f=>f.simHour===60).vmax===hist[60].vmax);
assert(shortModel.find(f=>f.simHour===72),'missing continuation after recorded data');
assert(shortModel.find(f=>f.simHour===72).vmax!==undefined);

assert(source.includes('const observed = stored && mainHistoryForecastFixes(stored,issueHour,typhoon,targetHours);'));
assert(source.includes('if(observedForecast?.length && (observedForecast.at(-1)!.simHour>=targetHours-1e-5'));
assert(source.indexOf('if(observedForecast?.length && (observedForecast.at(-1)!.simHour>=targetHours-1e-5') < source.indexOf('const raw = calculateForecastPath(typhoon, config, targetHours, false,'),
 'full archived coverage must bypass the second independent forecast computation');
const app=src('src/App.tsx');
assert(app.includes("copyMainHistoryToForecast(storm)"));
const modal=src('src/components/ForecastImageModal.tsx');
assert(modal.includes("exactMainHistory = copiedMainHistory"));
assert(modal.includes('&& !exactMainHistory'),'NMC genesis modifier must not rewrite measured winds');
assert(modal.includes('const applyImagePeak = nmcCustomPeakEnabled;'));
console.log('ROUND177 PASS: main-history point-for-point replay, phantom 60m/s eliminated at h72, NMC 12/24h issues, historical reissue, stale-state rejection, normal sandbox isolation');
