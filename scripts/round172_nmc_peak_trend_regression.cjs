'use strict';
/** Round172: hard NMC peak must not invent a post-peak collapse in favorable
 * offshore/pre-simulation-guided growth. Execute in the source root. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const source=fs.readFileSync('src/simulation/NmcIntensityGuidance.ts','utf8');
const result=ts.transpileModule(source,{fileName:'src/simulation/NmcIntensityGuidance.ts',reportDiagnostics:true,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
assert.equal(result.diagnostics.filter(d=>d.category===1).length,0);
const mod={exports:{}};
new Function('module','exports','require',result.outputText)(mod,mod.exports,()=>{throw Error('unexpected import');});
const {shapeNmcPeakIntensity}=mod.exports;
const p=(h,v,extra={})=>({simHour:h,lat:10+h/12,lon:130-h/6,vmax:v,pmin:1010-v*1.2,
 category:'台风',landed:false,...extra});
const solve=(array,target,issue=array[0].vmax)=>shapeNmcPeakIntensity(array,target,issue);
const check=(before,after,target,issue=before[0].vmax)=>{
 assert.equal(after.length,before.length);
 assert.equal(Math.max(issue,...after.map(p=>p.vmax)),target,'exact hard peak');
 for(let i=0;i<after.length;i++){
  for(const k of ['lat','lon','simHour','landed'])assert.equal(after[i][k],before[i][k],`forecast ${k} must not change`);
  assert(after[i].vmax<=target+1e-5,'peak ceiling');
  if(i>0){const dt=after[i].simHour-after[i-1].simHour;
   assert(after[i].vmax<=after[i-1].vmax+1.10001*dt,'growth cap');
   assert(after[i].vmax>=after[i-1].vmax-1.65001*dt,'loss cap');
   if(after[i].landed)assert(after[i].vmax<=after[i-1].vmax+1e-6,'inland growth');
  }
 }
};
// A physically strengthening 120-hour typhoon, as in the user's pre-simulated
// Philippines -> South China Sea scenario: the target MUST be a ceiling, not a
// clock-time deadline after which intensity is artificially dragged downward.
const hours=Array.from({length:21},(_,i)=>i*6);
const growing=hours.map(h=>p(h,27+Math.min(45,h*.40),{preSimulationGuided:true}));
const sustained=solve(growing,60);check(growing,sustained,60);
const firstPeak=sustained.findIndex(q=>q.vmax>=59.999);
assert(firstPeak>0 && firstPeak<sustained.length-1,'needs an actual post-peak span');
for(let i=firstPeak+1;i<sustained.length;i++)
 assert(sustained[i].vmax>=sustained[i-1].vmax-1e-7,`no false ocean collapse at ${sustained[i].simHour}h`);
// The user's issue shows a strong local peak followed by favorable-water
// rebuilding. A time-warped life cycle must not amplify native dips or suppress
// rebuilding, irrespective of the chosen reportable peak fix.
const offshore=[28,38,48,56,54,53,54,55,55,55].map((v,i)=>p(i*12,v,{preSimulationGuided:true}));
const offshoreAfter=solve(offshore,60);check(offshore,offshoreAfter,60);
for(let i=4;i<offshoreAfter.length;i++){
 const rawDelta=offshore[i].vmax-offshore[i-1].vmax;
 const changedDelta=offshoreAfter[i].vmax-offshoreAfter[i-1].vmax;
 assert(Math.abs(changedDelta-rawDelta)<1e-5,`do not magnify post-peak physical change at ${offshore[i].simHour}h`);
}
assert(offshoreAfter[5].vmax>=57,'originally near-steady offshore typhoon may not crash');
// When the original physical solution is genuinely weakening (e.g. shear),
// preserve that deterioration instead of forcing an indefinitely strong storm.
const damaged=[28,40,52,55,40,25,20,20].map((v,i)=>p(i*12,v));
const damagedAfter=solve(damaged,60);check(damaged,damagedAfter,60);
assert(damagedAfter[5].vmax<damagedAfter[3].vmax-20,'genuine large native weakening still survives');
// Reducing an over-predicted maximum should simply enforce a ceiling, not
// inject a negative correction that reverses the pre-peak strengthening trend.
const high=[28,33,40,47,55,60,63,65,67,70].map((v,i)=>p(i*12,v));
const lowered=solve(high,48);check(high,lowered,48);
for(let i=1;i<lowered.length;i++)assert(lowered[i].vmax>=lowered[i-1].vmax-1e-7,'capping must not create spurious weakening');
// Philippines crossing: no artificial intensification at inland fixes; real
// post-landfall re-intensification over open ocean remains permitted.
const crossing=[28,33,35,34,34,38,43,49,53,58,62,65,67].map((v,i)=>p(i*6,v,{landed:i===5||i===6}));
const crossed=solve(crossing,60);check(crossing,crossed,60);
assert(crossed[7].vmax>=crossed[6].vmax,'re-intensification after emerging over the sea survives');
// External contract: the NMC-only postprocessor runs after the pre-simulation
// forecast and does not alter ordinary/JMA physics or storm state.
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
assert(modal.indexOf('limitNmcGenesisPeak(rawForecast')<modal.indexOf('shapeNmcPeakIntensity(limitedForecast'));
assert(source.includes('const peakCorrection=Math.max(0,target-peakOriginalWind);'));
assert(!source.includes('sourceTime=t<=peakTime'),'historic time-warp interpolation reintroduced');
assert.throws(()=>solve([p(0,18),p(12,21)],75),/无法|达到/,'unachievable target must still fail explicitly');
console.log('ROUND172 PASS: hard peak, no invented ocean weakening, pre-simulation growth, genuine decay, lower-peak clipping, Philippines inland/coast recovery, route preservation');
