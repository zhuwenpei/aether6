const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.27','version must be 5.2.27');
const source=read('src/simulation/AetherEnsembleGuidance.ts');
const mapSource=read('src/components/MapView.tsx');
assert(source.includes('export function buildAetherCenterTrackGuidance'),'geometry-only live guidance export missing');
assert(mapSource.includes('buildAetherCenterTrackGuidance('),'live map must use geometry-only guidance');
assert(!mapSource.includes('buildAetherCenterGuidance('),'live map must not call full intensity guidance');
assert(mapSource.includes('强度在生成集系图时计算'),'live tooltip must state deferred intensity calculation');
assert(source.includes('vmax:Number.NaN,pmin:Number.NaN'),'path-only points must not pretend to contain calculated intensity');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
const counters={env:0,land:0,distance:0,core:0};
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map(name=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{const f=i/n;return{lat:storm.lat+6*f,lon:storm.lon+4*f}})}));
}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>{counters.env++;return{rh700:75,shear:8,sst:29,ohc:90,scores:{dryAir:.05}}}};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.includes('Engine'))return{
    getLandMetrics:()=>{counters.land++;return{isLand:false,elevation:0}},
    getProceduralElevation:()=>0,
    getDistanceToLand:()=>{counters.distance++;return 8},
    getCoreSurfaceInteractionMetrics:()=>{counters.core++;return{landFraction:0,mountainFraction:0,meanLandElevation:0,maxElevation:0,frictionIndex:0,frictionAsymmetry:0,blockingIndex:0,dominantBearingDeg:0}}
  };
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const M=mod.exports;
const config={newEnvironmentPhysicsEnabled:true,maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true};
const storm={id:'P',lat:15,lon:135,vmax:42,pmin:970,rmw:30,history:[],configSnapshot:config};
const ref=Array.from({length:21},(_,i)=>({simHour:i*6,lat:15+i*.3,lon:135+i*.2,vmax:42+i*.2,pmin:970-i*.3,lowLevelVortexIntegrity:.85}));
const path=M.buildAetherCenterTrackGuidance(storm,0,[storm],'r76',ref,120,config);
assert(path.length===8&&path.every(m=>m.track.length>2),'path-only guidance failed to produce tracks');
assert(path.every(m=>Number.isNaN(m.maxVmax)&&Number.isNaN(m.minPmin)),'path-only guidance exposed calculated intensity summary');
assert(path.every(m=>m.track.every(p=>Number.isNaN(p.vmax)&&Number.isNaN(p.pmin))),'path-only points exposed calculated intensity');
assert(counters.env===0&&counters.land===0&&counters.distance===0&&counters.core===0,`live path-only guidance touched intensity/terrain chain ${JSON.stringify(counters)}`);

const before={...counters};
const full=M.buildAetherCenterGuidance(storm,0,[storm],'r76',ref,120,config);
assert(full.some(m=>Number.isFinite(m.maxVmax)&&Number.isFinite(m.minPmin)),'full product guidance no longer computes intensity');
assert(counters.env>before.env || counters.land>before.land,'full product guidance did not enter intensity/environment calculation');
console.log('Round 76 live path-only regression: PASS',`live counters=${JSON.stringify(before)}`,`full env=${counters.env} land=${counters.land}`);
