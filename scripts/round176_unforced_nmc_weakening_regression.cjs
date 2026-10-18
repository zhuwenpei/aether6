'use strict';
/** Round176: no manual peak is required for a confirmed pre-simulation to
 * remain authoritative during its measured near-steady / slow decay period. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const source=fs.readFileSync('src/simulation/PreSimulationReference.ts','utf8');
const transpiled=ts.transpileModule(source,{fileName:'PreSimulationReference.ts',reportDiagnostics:true,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
assert(!transpiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error));
const moduleObj={exports:{}};
vm.runInNewContext(transpiled.outputText,{module:moduleObj,exports:moduleObj.exports,
 require:()=>{throw Error('Unexpected runtime import');},Math,Number,Map,Set,Array,Object,Error,Infinity});
const {buildPreSimulationReference,blendPreSimulationForecast}=moduleObj.exports;
const radii={ne:100,se:100,sw:100,nw:100};
const category=v=>v>=51?'超强台风':v>=41.5?'强台风':v>=32.7?'台风':v>=24.5?'强热带风暴':v>=17.2?'热带风暴':'热带低压';
const fix=(hour,wind,props={})=>({simHour:hour,lat:18+hour*.075,lon:145-hour*.11,
 vmax:wind,pmin:1010-wind*1.2,speed:17,category:category(wind),landed:false,dissipated:false,
 rmw:24,r7:radii,r10:radii,r12:radii,...props});
// Confirmed sandbox reaches 60 m/s then stays near the same intensity.
const referenceHistory=Array.from({length:121},(_,hour)=>
  fix(hour,hour<=72?12+hour*(48/72):60-(hour-72)*.05));
const reference=buildPreSimulationReference({id:'R176',history:referenceHistory},0);
// Unguided deterministic forecast then drops precipitously on the same route.
// This is *not* evidence of independent injury: no structure/shear/core flags.
const raw=Array.from({length:41},(_,i)=>{
 const hour=i*3;
 return fix(hour,hour<=72?12+hour*(48/72):60-(hour-72)*1.15);
});
const sample=(data,hour)=>data.find(p=>p.simHour===hour);
for(const intensityPolicy of ['adaptive','round164']){
 const guided=blendPreSimulationForecast(raw,reference,120,{intensityPolicy,isLandAt:()=>false});
 assert.equal(guided.length,raw.length,'must not alter forecast time horizon');
 for(const hour of [72,84,96,108,120]){
  assert(Number.isFinite(sample(guided,hour).lat)&&Number.isFinite(sample(guided,hour).lon),'route must remain finite');
 }
 assert(sample(guided,96).vmax>50,
   `ordinary weakening improperly overruled confirmed sandbox (${intensityPolicy}): ${sample(guided,96).vmax}`);
 assert(sample(guided,120).vmax>44,'slow sandbox weakening must not collapse at 120h');
 assert(sample(guided,96).vmax>sample(raw,96).vmax+18,'ordinary wind-speed decline must not itself become damage evidence');
 for(let hour=75;hour<=120;hour+=3){
   assert(sample(guided,hour).vmax>=sample(guided,hour-3).vmax-1.8,
     `artificial 3h decay spike at ${hour}h under ${intensityPolicy}`);
 }
}
// Actual newly damaged warm core *does* override an older optimistic branch.
for(const evidence of [
 {isStructureDamaged:true},
 {shear:38},
 {dryAirIntrusion:.88},
 {coldAirWarmCoreDestroyed:true},
 {extrTransition:.91}
]){
 const injured=raw.map(p=>p.simHour>=78?{...p,...evidence}:p);
 const result=blendPreSimulationForecast(injured,reference,120,{isLandAt:()=>false});
 assert(sample(result,96).vmax<sample(raw,96).vmax+4,
  `new independent physical injury (${Object.keys(evidence)}) was masked: ${sample(result,96).vmax}`);
}
// Earlier user-forced damage at issue-hour still overrides stale guidance.
const forced=blendPreSimulationForecast(raw,reference,120,{isLandAt:()=>false,
 liveIssue:{forcedShear:38}});
assert(sample(forced,12).vmax<=sample(raw,12).vmax+2,
  'active forced wind shear must override stale branch at issuance');
// No confirmed reference means the deterministic forecast remains untouched.
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
assert(engine.includes('const guided=reference?blendPreSimulationForecast(raw,reference,targetHours,'));
// Disabled manual peak continues to bypass the peak-specific NMC adjustment.
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
assert(modal.includes('const applyImagePeak = nmcCustomPeakEnabled;'));
assert(modal.includes(': limitedForecast;'));
assert(source.includes('const newCoreFailure='));
assert(!source.includes('p.vmax<previousBase.vmax-.42*deltaT'),
 'wind-speed divergence may not masquerade as explicitly diagnosed structural damage');
console.log('ROUND176 PASS: unmodified NMC/manual-off sandbox slow weakening, both intensity policies, damage/shear/dry-air/ET exemptions, historic model authority');
