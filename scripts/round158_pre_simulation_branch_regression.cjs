'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source=fs.readFileSync('src/simulation/PreSimulationReference.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const m={exports:{}};vm.runInNewContext(js,{module:m,exports:m.exports,Math,Number,Error});
const {buildPreSimulationReference,preSimulationFixAt,blendPreSimulationForecast,issuePreSimulationReference}=m.exports;
const r=(n)=>({ne:n,se:n-2,sw:n-4,nw:n-6});
const base={id:'TC-42',name:'测试',simHour:60,lat:22,lon:133,vmax:37,pmin:982,speed:23,rmw:26,direction:300,r7:r(230),r10:r(90),r12:r(40),category:'TY',landed:false,dissipated:false};
const snapshot=(hour,lat,vmax,spd,landed=false)=>({...base,simHour:hour,lat,lon:133-(hour-60)*.2,vmax,pmin:1000-vmax*.84,speed:spd,landed,category:landed?'TS':'TY',r7:r(235-(hour-60)*6),r10:r(90-(hour-60)*2),r12:r(40),rmw:26,lowLevelVortexIntegrity:.8});
const storm={...base,history:[snapshot(59,21.5,35,23),snapshot(60,22,37,23),snapshot(61,22.1,37.2,17),snapshot(62,22.2,36.4,13,true),snapshot(63,22.3,34,12,true)]};
const ref=buildPreSimulationReference(storm,60);
assert.strictEqual(ref.issueHour,60);assert.strictEqual(ref.completedLeadHour,3);
assert.strictEqual(ref.authority,0.995);assert.strictEqual(ref.fixes.length,4);
assert.strictEqual(ref.fixes[1].speed,17);assert.strictEqual(ref.fixes[2].landed,true);
const mid=preSimulationFixAt(ref,1.5);assert(Math.abs(mid.vmax-36.8)<1e-7);assert.strictEqual(mid.r7.ne,ref.fixes[1].r7.ne,'radii publication must be stepwise');
// Round165: guidance owns the geographic route, not the old hourly speed or
// a near-100% intensity setpoint. Test with an ordinary forecast starting at
// the same observed centre and a physically plausible native displacement.
const arbitrary=[0,1,2,3,4].map(h=>({simHour:h,lat:22+h*.1,lon:133-h*.2,vmax:h?60:37,pmin:h?910:968,speed:30,category:'台风',landed:h>=2}));
const guided=blendPreSimulationForecast(arbitrary,ref,4,{isLandAt:(_,lon)=>lon<=132.6});
assert(guided[1].lat>22 && guided[1].lat<22.3,'geographic route not preserved');
assert(guided[1].vmax<arbitrary[1].vmax,'the physical wind solver was not constrained at all');
assert(guided[1].vmax>=ref.fixes[1].vmax,'intensity should not blindly copy the sandbox wind');
assert(guided[1].speed>0,'wind-translation speed must come from adjusted track displacement');
assert(guided[1].r7.ne>0,'wind radii should follow the spatial reference');
assert(guided[4].vmax<=guided[3].vmax+1e-5,'post-branch inland wind must not jump');
const rescued=blendPreSimulationForecast(arbitrary.slice(0,1),ref,12);
assert(rescued.some(p=>p.simHour===3),'the sandbox must be honored when ordinary guidance stops early');
const shortHorizon=blendPreSimulationForecast(arbitrary.slice(0,1),ref,2);
assert(shortHorizon.every(p=>p.simHour<=2),'cannot extend beyond requested forecast product horizon');
const dissipating={...ref,fixes:ref.fixes.map((p,i)=>i===ref.fixes.length-1?{...p,dissipated:true}:p)};
assert(blendPreSimulationForecast(arbitrary,dissipating).every(p=>p.simHour<=3),'sandbox dissipation must stop operational guidance');
assert.strictEqual(issuePreSimulationReference({...storm,history:storm.history.map(h=>h.simHour===60?{...h,preSimulationReference:ref}:h)},61).issueHour,60,'saved reference must follow later issue times');
assert(issuePreSimulationReference({...storm,history:storm.history.map(h=>h.simHour===60?{...h,preSimulationReference:ref}:h)},60),'issue reference not found');
const restored=JSON.parse(JSON.stringify(storm.history.map(h=>h.simHour===60?{...h,preSimulationReference:ref}:h)));
assert(restored[1].preSimulationReference.fixes[2].r10.ne===ref.fixes[2].r10.ne,'archive JSON roundtrip lost guidance');
// The real archive verifier must accept an issue-bound forecast branch and reject mismatched hours.
const archiveJs=ts.transpileModule(fs.readFileSync('src/utils/SimulationArchive.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const arc={exports:{}};vm.runInNewContext(archiveJs,{module:arc,exports:arc.exports,Date,Math,Number,JSON,Error,Set,Object,Array,RegExp});
const stateWithReference={...storm.history[1],preSimulationReference:ref};
const data={typhoons:[{...storm,history:[storm.history[0],stateWithReference,storm.history[2],storm.history[3],storm.history[4]]}],
  eventLogs:[],config:{seed:'test'},layers:{},currentHour:60,maxHour:63,totalSimMinutes:3600,
  startDate:'2026-07-01T00:00:00.000Z',seasonEnded:false,speed:8,prngState:123,
  timelineCollapsed:false,genesisPos:{lat:22,lon:133}};
assert(arc.exports.validateSimulationArchiveData(data).typhoons[0].history[1].preSimulationReference,
  'archive failed to accept a valid saved pre-simulation');
const bad=JSON.parse(JSON.stringify(data));bad.typhoons[0].history[1].preSimulationReference.issueHour=61;
assert.throws(()=>arc.exports.validateSimulationArchiveData(bad),/预模拟预报/,'archive accepted misbound pre-simulation');
const app=fs.readFileSync('src/App.tsx','utf8');const ui=fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8');const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
assert(app.includes('onClick={beginForecastPreSimulation}')&&app.includes('preSimulationReference:reference'),'missing UI or historical binding');
assert(ui.includes('speed:8')&&ui.includes("liveForecastMode:'off'")&&ui.includes('onConfirm(ref,copy?')&&ui.includes('useState(false)'),'sandbox 8x / initially paused physics binding missing');
assert(engine.includes('const shelfTarget = 17.72')&&engine.includes('const residenceBudgetHours')&&engine.includes('forecastPlainTsShelfMemory'),'forecast 18 m/s land shelf was removed');
assert(engine.includes('issuePreSimulationReference(typhoon, issueHour)')&&engine.includes('blendPreSimulationForecast(raw,reference,targetHours,{'),'forecast materialization ignores issue reference');
console.log('ROUND159 COMPAT PASS: historical forward guidance, 8x isolated sandbox, path/intensity/speed/radii guiding, archived JSON and 18m/s shelf.');
