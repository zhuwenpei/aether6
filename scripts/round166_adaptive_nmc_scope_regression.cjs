'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const vm=require('node:vm');
const load=file=>{
 const x=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal(x.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const m={exports:{}};vm.runInNewContext(x.outputText,{module:m,exports:m.exports,Number,Math,Set,Map});return m.exports;
};
const {buildPreSimulationReference,blendPreSimulationForecast}=load('src/simulation/PreSimulationReference.ts');
const {limitNmcGenesisPeak}=load('src/simulation/NmcIntensityGuidance.ts');
const circle=n=>({ne:n,se:n,sw:n,nw:n});
const fix=(h,lat,lon,vmax)=>({simHour:h,lat,lon,vmax,pmin:1010-1.45*vmax,speed:55.5,
  landed:false,dissipated:false,rmw:30,direction:90,category:'强台风',r7:circle(180),r10:circle(95),r12:circle(40)});
const w=[39,40,42,44,46,48,50,49,46,43,41];
const ref=buildPreSimulationReference({id:'flex',history:w.map((v,h)=>fix(h,20,120+.5*h,v))},0);
const raw=w.map((v,h)=>fix(h,20+(h?Math.min(.24,.12+.02*h):0),120+.5*h,
  h===0?39:(h<7?52:Math.max(40,52-(h-7)*3))));
const guided=blendPreSimulationForecast(raw,ref,10);
// The physical core is displaced N of guidance, then returns to it gradually.
assert(guided[2].lat>20.005,'northward physical deviation should not be snapped to the line');
assert(guided[2].lat<raw[2].lat,'north deviation should not replace sandbox path');
assert(guided[6].lat<guided[2].lat,'lateral bias should decay instead of returning in one step');
for(let i=1;i<guided.length;i++){
 assert(guided[i].lon>=guided[i-1].lon-1e-6,'cross-track recentering rewound along-track phase');
 assert(Math.abs(guided[i].lat-guided[i-1].lat)<.1,'cross-track correction snapped south');
}
// Stronger ordinary core is not forced down and then back up during the
// sandbox's approach to a later peak. Peak leg remains a plausible plateau.
const peakRaw=w.map((v,h)=>fix(h,20,120+.5*h,h===0?39:(h<8?55:Math.max(38,55-(h-8)*3))));
const peak=blendPreSimulationForecast(peakRaw,ref,10);
const earlyDip=peak.slice(2,7).some((p,i,a)=>i>0&&p.vmax<a[i-1].vmax-2);
assert(!earlyDip,'forecast made an unphysical temporary wind dip before the later sandbox peak');
assert(peak[6].vmax>ref.fixes[6].vmax-2,'pre-simulation overrode a stronger physical core');
assert(peak[9].vmax<peak[6].vmax,'forecast must start weakening near the sandbox weakening segment');
const legacy=blendPreSimulationForecast(peakRaw,ref,10,{intensityPolicy:'round164'});
assert(Math.abs(legacy[3].vmax-ref.fixes[3].vmax)<Math.abs(peak[3].vmax-ref.fixes[3].vmax),
 'NMC legacy-off mode should retain Round164 near-total sandbox intensity authority');
assert(Math.abs(legacy[3].vmax-ref.fixes[3].vmax)<1,'legacy mode did not use Round164 weighting');
assert(legacy[3].lon===peak[3].lon,'intensity switch changed forecast path');
const pulse=[18,22,26,32,48,62,70,40,26,37,49,50,49].map((v,i)=>fix(i*6,20,120+i*.2,v));
const conservative=limitNmcGenesisPeak(pulse,0,18);
assert(conservative[6].vmax<pulse[6].vmax-10,'NMC depicted a clairvoyant genesis RI burst');
assert(conservative[8].vmax<=pulse[8].vmax+1e-5,'old NMC temporal smoothing must be removed: dry-air crash should remain');
assert(conservative[10].vmax<=pulse[10].vmax+1e-5,'old NMC low-pass recovery smoothing must be removed');
assert(conservative[6].vmax>conservative[3].vmax,'NMC suppressed gradual intensification');
assert(Math.max(...conservative.map(p=>p.vmax))<=62,'early NMC peak exceeded conservative cap');
assert.strictEqual(limitNmcGenesisPeak(pulse,48,18),pulse,'mature genesis age should not change product');
assert(Math.max(...limitNmcGenesisPeak(pulse,0,40).map(p=>p.vmax))<=62,'a mature but newly formed cyclone still has peak uncertainty');
assert.deepEqual(conservative.map(p=>p.lon),pulse.map(p=>p.lon),'NMC coarse toggle changed spatial route');
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
assert(!engine.includes('coarsenEarlyGenesisIntensity('),'old coarse intensity leaked into all forecast products');
assert(!engine.includes('limitNmcGenesisPeak'),'NMC product tuning leaked into Engine');
assert(modal.includes('limitNmcGenesisPeak(rawForecast'),'NMC image generation omitted its isolated early-peak filter');
assert(modal.includes('nmcCoarseIntensity ? \'adaptive\' : \'round164\''),'NMC checkbox not wired to Round164 policy');
assert(modal.includes('imageStyle === "standard" && ('),'NMC UI regression');
assert(modal.includes('checked={nmcCoarseIntensity}'),'missing NMC product checkbox');
assert(modal.includes('setPreviewRefreshToken(0)'),'NMC switch should invalidate old preview');
assert(!modal.includes('limitNmcGenesisPeak(path'),'non-NMC forecast path is being postprocessed');
console.log('ROUND166 PASS: northward drift smooth return, early peak plateau, Round164 intensity toggle, NMC-only conservative genesis peak and scope isolation');
