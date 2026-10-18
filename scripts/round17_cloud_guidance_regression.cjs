/** Run without installed node_modules: transpile only the simulation modules under test. */
const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const assert=(x,m)=>{if(!x)throw Error(m)};
const compile=(filename,imports={})=>{
 const src=fs.readFileSync(filename,'utf8');
 const {outputText,diagnostics}=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert(!diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error),`transpile ${filename}`);
 const mod={exports:{}};
 new Function('exports','module','require',outputText)(mod.exports,mod,id=>{if(id in imports)return imports[id];throw Error(`Unexpected require ${id}`)});
 return mod.exports;
};
const dynamics=compile('src/simulation/ConvectiveDynamics.ts');
const h=compile('src/simulation/HurricaneTrackerPort.ts',{'./ConvectiveDynamics':dynamics});
const base={id:'round17',lat:17,lon:131,vmax:70,pmin:920,dvorakTNumber:6.7,
 deepConvectiveCoverage:.91,eyewallWrapProgress:.88,eyewallIntegrity:.90,eyeFormationMemory:.9,
 eyeClearance:.87,eyeRadiusKm:19,coreCompactness:.86,broadMoisturePlatform:.82,
 moistureReservoir:.83,innerCoreMoisture:.79,rainbandDominance:.87,
 convectiveBurstIndex:.45,shear:8,shearDir:240,coreGeometryContinuity:.97};
const landing={...base,vmax:44,dvorakTNumber:4.8,landed:true,landHours:6,
 terrainCoreLandFraction:.88,terrainBlockingMemory:.68,terrainHollowCoreMemory:.52,
 terrainInteractionBearingDeg:290,coreGeometryContinuity:.38,landfallOuterRainbandIndex:.92,
 dryAirIntrusion:.66,dryAirCoreExposure:.54,drySlotBearingDeg:290};
const replacement={...base,ewrcState:'max_decay',ewrcProgress:.65,
 secondaryEyewallStrength:.84,convectiveBurstIndex:.37};
const centerKm=h.getHurricaneTrackerCloudParameters(base);
function sample(storm,t,angle,r=.48){
 const R=760;return h.sampleHurricaneTrackerCloud(storm,storm.lat+R*r*Math.sin(angle)/111.12,
 storm.lon+R*r*Math.cos(angle)/(111.12*Math.cos(storm.lat*Math.PI/180)),t,'ir','round17-test');
}
const a=dynamics.getConvectiveField(base,120,'round17-test');
const b=dynamics.getConvectiveField(base,124,'round17-test');
let change=0;for(let i=0;i<a.updraft.length;i++)change+=Math.abs(a.updraft[i]-b.updraft[i]);
assert(change/a.updraft.length>.0001,'updraft remains frozen between forecast times');
const ocean=[],land=[],ewrc=[];
for(let k=0;k<24;k++){
 const angle=2*Math.PI*k/24;
 ocean.push(sample(base,120,angle));land.push(sample(landing,126,angle));
 ewrc.push(sample(replacement,120,angle,.16));
}
const mean=(v)=>v.reduce((x,y)=>x+y,0)/v.length;
const oceanDensity=mean(ocean.map(s=>s.density)),landDensity=mean(land.map(s=>s.density));
assert(oceanDensity>.06,'mature typhoon outer rainbands too weak');
assert(landDensity>.035,'landfall destroys all outer rainband coverage');
assert(land.some(s=>s.brightnessTemperatureC < -45),'landfall rainband cloud tops all grey');
assert(land.every(s=>Number.isFinite(s.brightnessTemperatureC)),'land IR contains NaNs');
assert(ewrc.some(s=>Number.isFinite(s.density)),'replacement rendering missing');
// The same snapshot and time must be deterministic even after a different time is evaluated.
const first=sample(base,120,1.23),later=sample(base,121,1.23),repeat=sample(base,120,1.23);
assert(first.density===repeat.density&&first.brightnessTemperatureC===repeat.brightnessTemperatureC,
 'cloud output depends on render order');
console.log('round17_cloud_guidance_regression: PASS',JSON.stringify({
 tracerMeanChange:+(change/a.updraft.length).toFixed(4),oceanOuterDensity:+oceanDensity.toFixed(3),
 landOuterDensity:+landDensity.toFixed(3),landColdPixels:land.filter(s=>s.brightnessTemperatureC < -45).length,
 temporalCloudDelta:+Math.abs(first.density-later.density).toFixed(4),ewrcCoreTemp:+mean(ewrc.map(s=>s.brightnessTemperatureC)).toFixed(1)
}));
