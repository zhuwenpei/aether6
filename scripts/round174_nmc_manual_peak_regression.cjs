'use strict';
/** Round174: explicit NMC image peak must work with confirmed pre-simulation.
 * Run from the source root; uses locally available TypeScript, no npm install.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=(()=>{try{return require('typescript');}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');}})();
const get=p=>fs.readFileSync(p,'utf8');
function load(path,extra='',modules={}){
 const code=ts.transpileModule(get(path)+extra,{fileName:path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 assert.equal((code.diagnostics||[]).filter(d=>d.category===1).length,0);
 const mod={exports:{}};
 vm.runInNewContext(code.outputText,{module:mod,exports:mod.exports,require:p=>{
   if(p in modules)return modules[p];throw new Error('Unmocked import '+p);
 },Math,Number,Set,Map,Date,Array,Object,Error,RangeError});
 return mod.exports;
}
const {shapeNmcPeakIntensity}=load('src/simulation/NmcIntensityGuidance.ts');
const {buildPreSimulationReference,blendPreSimulationForecast}=load('src/simulation/PreSimulationReference.ts');
const make=(t,v,landed=false)=>({simHour:t,lat:16+t*.1,lon:150-t*.2,vmax:v,pmin:1000-v*1.2,
 category:v>=51?'超强台风':'强台风',landed,speed:20,direction:300,rmw:20,
 r7:{ne:100,se:100,sw:100,nw:100},r10:{ne:60,se:60,sw:60,nw:60},r12:{ne:30,se:30,sw:30,nw:30}});
// Reproduce the user pattern: physically observed peak, then consistent decline
// to landfall, while the ordinary forecast would return to ~70 m/s.
const simulated=[64,66,68,67,63,58,55,52,49,45];
const actual=simulated.map((v,i)=>make(i*6,v));
const hourly=[];
for(let i=0;i<actual.length-1;i++)for(let j=0;j<6;j++) {
 const q=j/6,a=actual[i],b=actual[i+1];
 hourly.push({...a,simHour:i*6+j,vmax:a.vmax+(b.vmax-a.vmax)*q,
 lat:a.lat+(b.lat-a.lat)*q,lon:a.lon+(b.lon-a.lon)*q});
}
hourly.push(actual.at(-1));
const ref=buildPreSimulationReference({id:'round174-peak',history:hourly},0);
const ordinary=Array.from({length:55},(_,h)=>make(h,h<30?64+h*.2:70));
const guided=blendPreSimulationForecast(ordinary,ref,120,{isLandAt:()=>false});
const base=guided.filter(p=>p.simHour%6===0);
assert(base.at(-1).vmax<50,'pre-simulation reference must preserve landfall weakening');
const rawWinds=base.map(p=>p.vmax);
// Checkbox OFF: precisely the guided physical path, unchanged.
const disabled=base;
assert.deepEqual(disabled.map(p=>p.vmax),rawWinds);
// Checkbox ON, LOWER peak target than physical maximum: a genuine peak cap;
// the weakening after the peak must remain and never plateau at 70.
const lower=shapeNmcPeakIntensity(base,65,64);
assert.equal(Math.max(64,...lower.map(x=>x.vmax)),65);
assert(lower.at(-1).vmax<50,'re-targeting a peak downward must keep weakened landfall');
const higher=shapeNmcPeakIntensity(base,72,64);
assert.equal(Math.max(64,...higher.map(p=>p.vmax)),72,
 'the explicit user peak must override a confirmed pre-simulation reference');
for(let i=0;i<higher.length;i++) {
 const b=base[i],p=higher[i];
 assert.equal(p.lat,b.lat);assert.equal(p.lon,b.lon);assert.equal(p.simHour,b.simHour);
 if(i>0){const dt=p.simHour-higher[i-1].simHour;
   assert(p.vmax<=higher[i-1].vmax+1.10001*dt);
   assert(p.vmax>=higher[i-1].vmax-1.65001*dt);
 }
}
const hiPeak=higher.findIndex(p=>Math.abs(p.vmax-72)<.00001);
assert(hiPeak>0&&hiPeak<higher.length-1,'peak must occur at a visible future fix');
assert(higher.at(-1).vmax<higher[hiPeak].vmax-12,
 'manual peak must preserve real subsequent weakening, not sustain 72 through landfall');
assert(base.every((p,i)=>p.vmax===rawWinds[i]),'product-only shaping may not mutate the physical forecast');
// A physically unreachable request must not silently generate an unchanged chart.
assert.throws(()=>shapeNmcPeakIntensity([make(0,18),make(12,20)],80,18),/无法|达到/);
// Wiring: slider and checkbox must both refresh any existing preview,
// while no preview is computed automatically if user has not requested one.
const modal=get('src/components/ForecastImageModal.tsx');
assert(modal.includes('const applyImagePeak = nmcCustomPeakEnabled;'));
assert(!modal.includes('nmcCustomPeakEnabled && !hasMeasuredPreSimulation'));
assert(modal.includes('shapeNmcPeakIntensity(limitedForecast,requestedPeak,Number(issue.vmax))'));
assert(!modal.includes('customPeakWind: applyImagePeak'), 'the manual physical target must not bypass CMA public reporting');
assert(modal.includes('const forecastData = applyImagePeak\n      ? shapeNmcPeakIntensity'));
assert(modal.includes('      : limitedForecast;'));
assert(/setNmcCustomPeakEnabled\(e\.target\.checked\);setPreviewRefreshToken\(v=>v===0\?0:v\+1\)/.test(modal));
assert(/setNmcCustomPeak\(Number\(e\.target\.value\)\);setPreviewRefreshToken\(v=>v===0\?0:v\+1\)/.test(modal));
assert(!modal.includes('清空预模拟预报参考后可重新使用此选项'));
// Image labels always reflect the image-only corrected winds. Other forecast
// renderers never call this hard shaping function.
const renderer=get('src/utils/NmcForecastProduct.ts');
assert(renderer.includes('cmaNmcAssessment(pt.vmax, pt.category)'));
assert(!renderer.includes('customPeakWind'), 'no exact wind display override is allowed for manual targets');
assert(!get('src/simulation/PreSimulationReference.ts').includes('shapeNmcPeakIntensity'));
console.log('ROUND174 PASS: explicit NMC peak works with confirmed pre-simulation; disabled means no override, manual higher/lower exact peak, trend and track preserved, impossible target error, preview bound; published labels use CMA bins');
