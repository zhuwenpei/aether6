'use strict';
/** Round175: a manually lifted NMC peak must not collapse to the old
 * pre-simulation's exact wind at the following advisory fixes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const pth='src/simulation/NmcIntensityGuidance.ts';
const source=fs.readFileSync(pth,'utf8');
const trans=ts.transpileModule(source,{fileName:pth,reportDiagnostics:true,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
assert.equal((trans.diagnostics||[]).filter(d=>d.category===1).length,0);
const mod={exports:{}};
vm.runInNewContext(trans.outputText,{module:mod,exports:mod.exports,require:()=>{throw Error('unexpected import');},
 Math,Number,Map,Set,Array,Error,RangeError});
const {shapeNmcPeakIntensity:shape}=mod.exports;
const fix=(time,wind,props={})=>({simHour:time,lat:17+time*.12,lon:146-time*.2,
 vmax:wind,pmin:1012-wind*1.22,speed:18,category:wind>=51?'超强台风':
 wind>=41.5?'强台风':wind>=32.7?'台风':wind>=24.5?'强热带风暴':
 wind>=17.2?'热带风暴':'热带低压',landed:false,...props});
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
const assertPreserved=(raw,actual,target)=>{
 assert.equal(actual.length,raw.length);
 assert(near(Math.max(raw[0].vmax,...actual.map(x=>x.vmax)),target),'specified max is exact');
 for(let i=0;i<actual.length;i++){
  for(const key of ['simHour','lat','lon','landed'])assert.equal(actual[i][key],raw[i][key],key+' mutated');
  assert(near(actual[i].pmin,raw[i].pmin+(raw[i].vmax-actual[i].vmax)*1.15),'pressure mismatch');
  assert(actual[i].vmax<=target+1e-5,'target cap exceeded');
  if(i){const dt=actual[i].simHour-actual[i-1].simHour;
   assert(actual[i].vmax<=actual[i-1].vmax+dt*1.1+1e-5,'unphysical fast RI');
   assert(actual[i].vmax>=actual[i-1].vmax-dt*1.65-1e-5,'unphysical weakening');
   if(actual[i].landed)assert(actual[i].vmax<=actual[i-1].vmax+1e-5,'inland intensification');
  }
 }
};
// Representative NMC screenshot: reportable +36h peak is lifted to 52 m/s,
// but the baseline later crosses old sandbox 30 / 20 / 15 m/s data.
const imageTrack=[18,25,38,42,42,30,20,15,15].map((v,i)=>fix(i*12,v,{
 preSimulationGuided:true,landed:i>=6}));
const originalWinds=imageTrack.map(x=>x.vmax);
const raised=shape(imageTrack,52,18);
assertPreserved(imageTrack,raised,52);
assert(raised[5].vmax>45 && raised[5].vmax>imageTrack[5].vmax+10,
 'post-peak 12h must not rapidly fall to the unraised sandbox intensity');
assert(raised[6].vmax>40 && raised[6].vmax>imageTrack[6].vmax+15,
 'post-peak 24h must keep the raised circulation rather than exact old fix');
assert(raised[7].vmax>32 && raised[7].vmax>imageTrack[7].vmax+15,
 'post-landfall 36h may weaken but never snap to the original 15m/s');
for(let i=5;i<=7;i++){
 assert(raised[i].vmax<=raised[i-1].vmax+1e-6,'post-peak forecast should decline, not rebound');
 const dt=raised[i].simHour-raised[i-1].simHour;
 assert((raised[i-1].vmax-raised[i].vmax)/dt<.75,'post-peak decay still too fast');
}
assert.deepEqual(imageTrack.map(x=>x.vmax),originalWinds,'source forecast mutated');
// A real, *slow* sandbox decay (58 -> 45 m/s) should retain its timing after
// peak lifting, without abandoning the additional intensity in later fixes.
const slow=[35,45,54,58,58,57,56,55,52,49,45].map((v,i)=>fix(i*6,v,{preSimulationGuided:true}));
const slowRaised=shape(slow,70,35);
assertPreserved(slow,slowRaised,70);
const idx=slowRaised.findIndex(q=>near(q.vmax,70));
assert(idx>=0 && idx<slowRaised.length-2);
for(let i=idx+1;i<slowRaised.length;i++){
 const drop=slowRaised[i-1].vmax-slowRaised[i].vmax;
 assert(drop<=Math.max(0,slow[i-1].vmax-slow[i].vmax)+1e-5,
  'slow sandbox weakening should not be accelerated after peak lifting');
}
assert(slowRaised.at(-1).vmax>slow.at(-1).vmax+7,'raised peak prematurely converged to old sandbox wind');
// Unguided physics must still be allowed to decline fast in destructive shear;
// lowering a forecast maximum must not activate the raised-peak persistence.
const damaged=[28,40,52,55,40,25,20,20].map((v,i)=>fix(i*12,v));
const damagedResult=shape(damaged,60,28);
assert(damagedResult[5].vmax<damagedResult[3].vmax-20,'unguided real collapse falsely smoothed');
const lowered=shape([18,28,40,50,58,52,30,15].map((v,i)=>fix(i*12,v,{preSimulationGuided:true})),48,18);
assert(near(Math.max(18,...lowered.map(x=>x.vmax)),48),'lower cap must remain exact');
// Even a sandbox-guided product may really suffer new severe core damage;
// manual peak shaping must not erase that independent meteorology.
const severe=imageTrack.map(p=>({...p}));
severe[5].isStructureDamaged=true;
severe[6].shear=38;
const severeRaised=shape(severe,52,18);
assert(severeRaised[5].vmax<raised[5].vmax-5,'explicit structural damage must remain eligible for rapid decline');
assert(severeRaised[6].vmax<raised[6].vmax-5,'extreme shear must remain eligible for rapid decline');
// NMC-only: the user-facing slider must still invoke this postprocessor AFTER
// the materialized (including pre-simulation) physical forecast.
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
assert(modal.includes('const applyImagePeak = nmcCustomPeakEnabled;'));
assert(modal.includes('shapeNmcPeakIntensity(limitedForecast,requestedPeak,Number(issue.vmax))'));
assert(modal.indexOf('materializeProductForecast(issueStorm')<modal.indexOf('shapeNmcPeakIntensity(limitedForecast'));
assert(!fs.readFileSync('src/simulation/PreSimulationReference.ts','utf8').includes('shapeNmcPeakIntensity'));
console.log('ROUND175 PASS: manual peak sustained across 12/24/36h fixes, slow guided weakening, no snapback, landfall bounds, natural damage exempt, product-only exact target');
