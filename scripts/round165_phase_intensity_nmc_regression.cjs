'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const src=fs.readFileSync('src/simulation/PreSimulationReference.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
assert.equal(js.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const m={exports:{}};vm.runInNewContext(js.outputText,{module:m,exports:m.exports,Math,Number,Error,Set});
const {buildPreSimulationReference,blendPreSimulationForecast,rebasePreSimulationReference,
  coarsenEarlyGenesisIntensity}=m.exports;
const radius=n=>({ne:n,se:n,sw:n,nw:n});
const snapshot=(h,lon,v,land=false)=>({simHour:h,lat:20,lon,vmax:v,pmin:1010-1.4*v,
  speed:55.5,rmw:35,direction:90,category:'台风',landed:land,dissipated:false,
  r7:radius(180),r10:radius(90),r12:radius(30)});
const ref=buildPreSimulationReference({id:'speed-test',history:Array.from({length:13},(_,h)=>snapshot(h,120+h*.5,40+h*.35))},0);
function model(pace,maxH=12,wind=43){return Array.from({length:maxH+1},(_,h)=>({...snapshot(h,120+h*pace,wind,false),speed:pace*111}));}
const fast=blendPreSimulationForecast(model(.75),ref,12);
const slow=blendPreSimulationForecast(model(.30),ref,12);
const near=(a,b,eps=.018)=>assert(Math.abs(a-b)<=eps,`${a} ≉ ${b}`);
near(fast[4].lon,123);
near(slow[4].lon,121.2);
near(fast[8].lon,126);
near(fast[9].lon,126.75);
near(fast[12].lon,129);
for(const track of [fast,slow])for(let i=1;i<track.length;i++){
  assert(track[i].lon>=track[i-1].lon-1e-5,'forecast path moved BACKWARDS toward the old hourly guide');
  near(track[i].lon-track[i-1].lon,track===fast?.75:.30,.06);
}
// Displaced real centres must follow the nearest spatial PHASE, not the old time.
const ahead=rebasePreSimulationReference(ref,4,{lat:20,lon:123.5});
assert(ahead&&ahead.fixes.length>1);
near(ahead.fixes[0].lon,123.5);
assert(ahead.fixes[1].lon>ahead.fixes[0].lon,'reissue rewound to an earlier reference fix');
const behind=rebasePreSimulationReference(ref,5,{lat:20,lon:121.4});
assert(behind&&behind.fixes[1].lon>behind.fixes[0].lon);
assert.equal(rebasePreSimulationReference(ref,4,{lat:40,lon:140}),undefined,'remote branch must not teleport across basins');
// Intensity and pressure are matched to the actual spatial point reached.
assert(slow[4].vmax<fast[4].vmax,'intensity was taken from the equal clock hour, not the spatial fix');
assert(slow[4].vmax>40,'spatial sampling lost ordinary physical intensity entirely');
const landRef=buildPreSimulationReference({id:'land-test',history:[
  snapshot(0,120,45,false),snapshot(1,120.7,44,false),snapshot(2,121.4,41,true),snapshot(3,122.1,38,true),snapshot(4,122.8,35,true)
]},0);
const raw=model(.7,6,62);raw[0].vmax=45;raw[0].pmin=947;
const guided=blendPreSimulationForecast(raw,landRef,6,{isLandAt:(_,lon)=>lon>=121.4});
assert(guided[1].vmax<50,'pre-simulation still overrides intensity with near-100% weight or creates sea RI');
assert(guided[2].vmax<=guided[1].vmax,'landfall created extra strengthening');
assert(guided[3].vmax<=guided[2].vmax,'inland forecast spontaneously intensified');
assert(guided[4].vmax<=guided[3].vmax,'inland forecast has a phantom spike');
assert(guided[3].pmin>=guided[2].pmin,'inland pressure deepened as wind weakened');
const extraordinary={...landRef,fixes:landRef.fixes.map(f=>({...f,vmax:f.leadHour===3?50:f.vmax}))};
const approved=blendPreSimulationForecast(raw,extraordinary,6,{isLandAt:(_,lon)=>lon>=121.4});
assert(approved[3].vmax>approved[2].vmax+2,'genuine sandbox onshore intensification was suppressed');
// Genesis forecast intensity is a coarse outlook, NOT a smooth-upgraded live run.
const pulses=[18,36,20,46,34,50,45].map((v,i)=>({...snapshot(i*3,120+i*.5,v),vmax:v}));
const early=coarsenEarlyGenesisIntensity(pulses,0,18);
assert(early[1].vmax<pulses[1].vmax-4,'genesis forecast was implausibly precise about the first RI pulse');
assert(early[3].vmax<pulses[3].vmax,'genesis forecast retained an unsupported nearshore burst');
assert.deepEqual(early.map(p=>p.lon),pulses.map(p=>p.lon),'genesis adjustment modified the path');
assert.strictEqual(coarsenEarlyGenesisIntensity(pulses,30,18),pulses,'mature forecast must be untouched');
assert.strictEqual(coarsenEarlyGenesisIntensity(pulses,0,40),pulses,'already mature typhoon must be untouched');
const nmc=fs.readFileSync('src/utils/NmcForecastProduct.ts','utf8');
assert(!nmc.includes('ctx.fillText(`${o.typhoonName} (${o.typhoonNumber})`'),'obsolete purple plotted name/number still present');
assert(nmc.includes('typhoonName}” 未来${o.forecastHours}'),'NMC title removed by accident');
assert(nmc.includes('layoutLabels(ctx,o,pts,project,wrap)'), 'NMC forecast callouts removed by accident');
console.log('ROUND165 PASS: fast/slow along-track phase, no rewind at reference exhaustion, spatial reissue, reduced/physical wind, genesis coarsening, NMC label removal');
