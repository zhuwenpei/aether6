'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const text=p=>fs.readFileSync(p,'utf8');
const load=p=>{
 const result=ts.transpileModule(text(p),{fileName:p,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const m={exports:{}};vm.runInNewContext(result.outputText,{module:m,exports:m.exports,Math,Number,Map,Set,WeakMap,Error});return m.exports;
};
const {buildPreSimulationReference,blendPreSimulationForecast}=load('src/simulation/PreSimulationReference.ts');
const {limitNmcGenesisPeak,shapeNmcPeakIntensity}=load('src/simulation/NmcIntensityGuidance.ts');
const {enhancedEyeRefinementStrength}=load('src/simulation/IntactEyewallRefinement.ts');
const r=n=>({ne:n,nw:n,sw:n,se:n});
const s=(h,v)=>({simHour:h,lat:20,lon:120+.32*h,vmax:v,pmin:1010-v*1.35,
 category:'台风',speed:36,landed:false,dissipated:false,direction:90,rmw:28,r7:r(100),r10:r(45),r12:r(15)});
const sandbox=Array.from({length:37},(_,h)=>s(h,40+Math.min(h*.7,18)));
const ordinary=Array.from({length:37},(_,h)=>s(h,40-Math.min(h*.23,7)));
const ref=buildPreSimulationReference({id:'live-stress',history:sandbox},0);
const nonStress=blendPreSimulationForecast(ordinary,ref,36);
const coreStress=blendPreSimulationForecast(ordinary,ref,36,{liveIssue:{forcedDryAir:'core',dryAirCoreExposure:.86,dryAirPenaltyHours:25}});
for(const lead of [6,12,18,24]){
 assert(coreStress[lead].vmax<=ordinary[lead].vmax+.2,'live core intrusion was overwritten at '+lead);
 assert(coreStress[lead].pmin>=nonStress[lead].pmin,'dry-air veto must not deepen MSLP');
}
assert(nonStress[18].vmax>ordinary[18].vmax+4,'pre-simulation has lost its valid strength influence');
const noEpisode=blendPreSimulationForecast(ordinary,ref,36,{liveIssue:{forcedDryAir:undefined}});
assert(noEpisode[18].vmax>coreStress[18].vmax+4,'core episode is not prioritized over stored sandbox');
// Round176: falling model wind by itself is not independent evidence of a damaged
// core. Require the solver's actual structure-damage diagnosis for this veto.
const spontaneous=ordinary.map((p,h)=>({...p,vmax:h<=11?40:h<=18?40-1.8*(h-11):27.4,
 isStructureDamaged:h>=12}));
const deteriorated=blendPreSimulationForecast(spontaneous,ref,36);
assert(deteriorated[18].vmax<nonStress[18].vmax-4,'diagnosed physical core damage must suppress sandbox boost');
const nonDamaged=spontaneous.map(({isStructureDamaged,...p})=>p);
const expectedGuided=blendPreSimulationForecast(nonDamaged,ref,36);
assert(expectedGuided[18].vmax>deteriorated[18].vmax+4,'mere ordinary wind drop incorrectly tagged as core damage');
const genesis=[18,20,27,42,56,66,54,35,48,51].map((w,i)=>({...s(i*6,w),category:'热带风暴'}));
const capped=limitNmcGenesisPeak(genesis,0,18);
assert(Math.max(...capped.map(p=>p.vmax))<=62,'early NMC forecast should not predict extreme >62m/s peak');
assert(capped[5].vmax<genesis[5].vmax-8,'initial RI burst not capped');
assert(capped[7].vmax<=genesis[7].vmax+1e-6,'old gaussian dip/recovery smoothing was not removed');
assert.strictEqual(limitNmcGenesisPeak(genesis,48,18),genesis,'mature issue must remain unaffected');
const shaped=shapeNmcPeakIntensity(genesis,48);
assert(Math.max(...shaped.map(p=>p.vmax))<=49,'user target peak was not enforced');
assert(Math.max(...shaped.map(p=>p.vmax))>46,'user peak should be approached, not merely clipped');
assert(shaped[0].vmax===genesis[0].vmax,'current analysis must remain unchanged');
assert(shaped.every((p,i)=>p.simHour===genesis[i].simHour&&p.lat===genesis[i].lat&&p.lon===genesis[i].lon),'NMC-only intensity changed route/time');
for(let i=1;i<shaped.length;i++){
 const dt=shaped[i].simHour-shaped[i-1].simHour;
 assert(shaped[i].vmax<=shaped[i-1].vmax+1.11*dt,'peak customization creates instantaneous RI');
 assert(shaped[i].vmax>=shaped[i-1].vmax-1.66*dt,'peak customization creates crash');
}
const oldRejected={vmax:46,lat:20,lon:140,eyeType:'small_round',eyePhase:'clear',eyewallIntegrity:.62,
 eyeClearance:.23,eyeObstruction:.72,eyeAsymmetry:.61,eyewallWrapProgress:.56,eyewallOpenSectorFraction:.29};
assert(enhancedEyeRefinementStrength(oldRejected)>.8,'rounded eye threshold did not relax');
assert(enhancedEyeRefinementStrength({...oldRejected,eyeType:'none'})===0,'rounded eye invented a storm eye');
const modal=text('src/components/ForecastImageModal.tsx'),engine=text('src/simulation/Engine.ts');
assert(!modal.includes('coarsenNmcGenesisIntensity')&&!engine.includes('limitNmcGenesisPeak'));
assert(modal.includes('shapeNmcPeakIntensity(limitedForecast')&&modal.includes('checked={nmcCustomPeakEnabled}'));
assert(modal.includes('const commonIssued = selectNmcIssuedForecast('),'NMC/JMA issued terminal horizon divergence');
assert(modal.includes('const rawForecast = operationalForecast;'),'JMA has stray residual extension beyond NMC');
assert(modal.includes('nmcCoarseIntensity ? \'adaptive\' : \'round164\''),'legacy strength mode unexpectedly removed');
console.log('ROUND169 PASS: live core intervention beats reference, physical deterioration veto, NMC-only genesis cap, peak lifecycle, common JMA/NMC issue, relaxed opt-in eye');
