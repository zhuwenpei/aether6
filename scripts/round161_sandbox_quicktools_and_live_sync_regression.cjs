'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const load=file=>{
 const raw=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,Math,Number,Array,Object,Set,Map,Date,Error});
 return module.exports;
};
const interventions=load('src/simulation/ForecastSandboxInterventions.ts');
const {issuePreSimulationReference,rebasePreSimulationReference,blendPreSimulationForecast}=load('src/simulation/PreSimulationReference.ts');
const makeStorm=()=>({id:'sandbox-01',name:'检验台风',simHour:80,lat:19,lon:136,
  active:true,dissipated:false,vmax:58,pmin:925,rmw:25,
  ewrcState:'none',ewrcProgress:0,ewrcIsFailure:false,ewrcFailureMode:'none',
  damageOrigin:'none',coreRebuildScar:0,structuralDamagePenaltyFactor:1,
  r7:{ne:300,nw:270,se:280,sw:260},r10:{ne:170,nw:170,se:170,sw:170},r12:{ne:90,nw:90,se:90,sw:90},
  history:[{simHour:80}]});
const capture=[];const info=(m,l)=>capture.push([m,l]);
const apply=(type,option,storm=makeStorm())=>interventions.applyForecastSandboxIntervention(storm,type,option,info);
assert.strictEqual(apply('ewrc','auto').forcedEWRC,'auto');
assert.strictEqual(apply('ewrc','failure').manualEwrcOutcomeOverride,'failure');
assert.strictEqual(apply('ewrc','success').manualEwrcOutcomeOverride,'success');
assert.strictEqual(apply('dry_air','core').forcedDryAir,'core');
assert.strictEqual(apply('dry_air','periphery').forcedDryAir,'periphery');
assert.strictEqual(apply('shear','35').forcedShear,35);
assert.strictEqual(apply('rapid_intensify','eri').forcedRapidIntensificationMode,'eri');
assert.strictEqual(apply('rapid_intensify','uri').forcedRapidIntensificationMode,'uri');
const cleaned=interventions.clearForecastSandboxPenalties({...makeStorm(),forcedDryAir:'core',forcedShear:30,
  ewrcFailurePenaltyHours:8,damageOrigin:'ewrc_failure',dryAirIntrusion:.7},info);
assert.strictEqual(cleaned.forcedDryAir,undefined);
assert.strictEqual(cleaned.forcedShear,undefined);
assert.strictEqual(cleaned.dryAirIntrusion,0);
assert.strictEqual(cleaned.ewrcFailurePenaltyHours,0);
// Compare copied transition core with live engine's source: prevents hidden sandbox drift.
const app=fs.readFileSync('src/App.tsx','utf8');
const shared=fs.readFileSync('src/simulation/ForecastSandboxInterventions.ts','utf8');
const coreStart='if (type === "ewrc") {';
const origStart=app.indexOf(coreStart,app.indexOf('const handleApplyInfluence ='));
const origEnd=app.indexOf('          return nextTy;\n        }\n        return ty;',origStart);
const original=app.slice(origStart,origEnd).replace(/\s+/g,'');
const copied=shared.slice(shared.indexOf(coreStart),shared.indexOf('  return nextTy;\n}',shared.indexOf(coreStart))).replace(/\s+/g,'');
assert.strictEqual(copied,original,'sandbox physical intervention rules diverged from live simulator');
const radii=n=>({ne:n,nw:n,se:n,sw:n});
const fixes=[0,1,2,3,4,5,6,7,8,9,10,11,12].map(h=>({leadHour:h,lat:18+h*.3,lon:135+h*.17,
  vmax:55-h/2,pmin:925+h,speed:24,rmw:30,category:'TY',landed:false,dissipated:false,
  r7:radii(320),r10:radii(160),r12:radii(75)}));
const guidance={version:1,stormId:'sandbox-01',issueHour:80,authority:.995,completedLeadHour:12,fixes};
const installed={...makeStorm(),preSimulationReference:guidance,history:[{simHour:79},{simHour:80,preSimulationReference:guidance}]};
for(let future=80;future<=91;future++){
 const currentFix=fixes[future-80];
 const later={...installed,simHour:future,lat:currentFix.lat,lon:currentFix.lon,history:[...installed.history,{simHour:future}]};
 const inherited=issuePreSimulationReference(later,future);
 assert(inherited&&inherited.issueHour===80,'future hour lost approved reference: '+future);
 const rebased=rebasePreSimulationReference(inherited,future,later);
 const baseline=Array.from({length:Math.max(1,12-(future-80))},(_,i)=>({simHour:i,lat:later.lat+.3*i,lon:later.lon+.17*i,vmax:28,pmin:980,speed:38,category:'热带风暴'}));
 const guided=blendPreSimulationForecast(baseline,rebased,12);
 if(future<91)assert(guided[1]?.preSimulationGuided,'next hour failed to apply guide: '+future);
 assert.strictEqual(guided[0]?.lat,later.lat,'authoritative forecast origin drifted');
}
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
assert(engine.includes('const guidance=issuePreSimulationReference(typhoon, Number(typhoon.simHour))'),'live preview ignores guidance');
assert(engine.includes('!!issuePreSimulationReference(updatedTy, nextHour)'),'new hour still reuses last operational forecast preview');
assert(engine.includes('blendPreSimulationForecast(base,rebased,targetHours,{'),'overlay forecast path not regenerated from reference');
assert(app.includes('typhoonsRef.current;')&&app.includes('updateTyphoons(updated);'),'confirmed guide not synchronously published to live refs');
assert(app.includes('preSimulationReference:reference,forecastPath:[]'),'confirmed guidance missing top-level inheritance');
assert(app.includes('onCancel={leaveForecastPreSimulation}'),'cancel still leaves old drawing page open');
for(const state of ['setDrawerOpen(false)','setForecastModalOpen(false)','setIsInfluenceModalOpen(false)','setPlacementMode("none")'])
 assert(app.includes(state),'exit missing modal cleanup: '+state);
const ui=fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8');
const tools=fs.readFileSync('src/components/ForecastSandboxTools.tsx','utf8');
assert(ui.includes('<ForecastSandboxTools')&&ui.includes('applyForecastSandboxIntervention')&&ui.includes('clearForecastSandboxPenalties'));
for(const label of ['目标风速','目标风圈','冷空气南下','冷水区','眼墙置换','风切变','干空气','爆发增强'])
 assert(tools.includes(label),'quick tools missing '+label);
assert(ui.includes('viewportId="forecast-gis-viewport"'));
assert(app.includes('drawerId="control-drawer-sidebar"')&&ui.includes('viewportId="forecast-gis-viewport"'),'Round163 isolated forecast map/drawer changed');
assert(fs.readFileSync('src/components/ControlDrawer.tsx','utf8').includes('id={drawerId}'));
assert(fs.readFileSync('src/components/MapView.tsx','utf8').includes('id={viewportId}'));
console.log('ROUND161 PASS: live-equivalent sandbox intervention transitions; current+11h inherited guidance, no stale live overlay, synchronous confirmation, clean exit, unique map viewport and quick controls.');
