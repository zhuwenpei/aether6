const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.23','version must be 5.2.23');
const engine=read('src/simulation/Engine.ts');
const source=read('src/simulation/AetherEnsembleGuidance.ts');
assert(engine.includes('export function getCoreSurfaceInteractionMetrics'),'live Engine core-surface sampler is not shared with guidance');
assert(source.includes('getGuidanceCoreSurfaceInteraction'),'guidance does not consume the shared inner-core terrain diagnosis');
assert(source.includes('destructiveMountainStrike'),'ensemble high-mountain core-destruction gate missing');
assert(source.includes('terrainHollowCoreMemory'),'ensemble hollow-core damage memory missing');
assert(source.includes('applyGuidanceVentilationScar'),'dry/shear/EWRC structural scar coupling missing');
assert(source.includes('lowLevelIntegrityScale'),'member-specific low-level-vortex damage penalty missing');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map(name=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{const f=i/n;return{lat:18+2*f,lon:118+8*f}})}));
}
function load(mountain){
  const mod={exports:{}};
  function coreTerrain(lat,lon){
    if(mountain&&lon>=120&&lon<=123.8&&lat>=17&&lat<=22.5){
      return {landFraction:.56,mountainFraction:.42,meanLandElevation:1450,maxElevation:2450,frictionIndex:.72,frictionAsymmetry:.46,blockingIndex:.70,dominantBearingDeg:90};
    }
    return {landFraction:0,mountainFraction:0,meanLandElevation:0,maxElevation:0,frictionIndex:0,frictionAsymmetry:0,blockingIndex:0,dominantBearingDeg:0};
  }
  function req(id){
    if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
    if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:78,shear:7,sst:29.5,ohc:100,scores:{dryAir:.03}})};
    if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:(lat,lon)=>mountain&&lon>=120&&lon<=123.8};
    if(id.endsWith('/Engine')||id.includes('./Engine'))return{
      getLandMetrics:(lat,lon)=>({isLand:mountain&&lon>=120&&lon<=123.8,elevation:mountain&&lon>=120&&lon<=123.8?1900:0,landName:'test'}),
      getProceduralElevation:()=>1900,
      getCoreSurfaceInteractionMetrics:coreTerrain
    };
    return{};
  }
  new Function('require','module','exports',js)(req,mod,mod.exports);
  return mod.exports;
}
const config={newEnvironmentPhysicsEnabled:true,ewrcTrigger:'off',maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true};
const storm={id:'M',lat:18,lon:118,vmax:58,pmin:938,rmw:24,shear:7,coreCompactness:.80,eyewallIntegrity:.86,lowLevelVortexIntegrity:.90,configSnapshot:config};
const reference=Array.from({length:29},(_,i)=>{const h=i*6;const v=58+Math.min(h,48)*.08-Math.max(0,h-72)*.015;return{simHour:h,lat:18+2*h/168,lon:118+8*h/168,vmax:v,pmin:938-h*.04,lowLevelVortexIntegrity:.90};});
const members=x=>x.filter(m=>!m.control);
function medianAt(arr,h,key){
  const vals=members(arr).map(m=>m.track.reduce((a,b)=>Math.abs(b.leadHour-h)<Math.abs(a.leadHour-h)?b:a)[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  return vals[Math.floor(vals.length/2)];
}
(async()=>{
  const args={storm,currentHour:0,scene:[storm],seed:'terrain-sync',referencePath:reference,selectedModelIds:['ECMWF'],membersPerModel:40,horizon:168,config};
  const ocean=await load(false).buildAetherEnsembleMembers(args);
  const mountain=await load(true).buildAetherEnsembleMembers(args);
  const ocean72=medianAt(ocean,72,'vmax'), mountain72=medianAt(mountain,72,'vmax');
  const ocean120=medianAt(ocean,120,'vmax'), mountain120=medianAt(mountain,120,'vmax');
  const integrity96=medianAt(mountain,96,'lowLevelVortexIntegrity');
  assert(ocean72-mountain72>10,`high-mountain destruction too weak at 72 h: ocean=${ocean72} mountain=${mountain72}`);
  assert(ocean120-mountain120>8,`terrain/rebuild memory recovers too quickly by 120 h: ocean=${ocean120} mountain=${mountain120}`);
  assert(integrity96<.55,`low-level-vortex integrity did not retain mountain damage: ${integrity96}`);
  console.log('Round 72 ensemble damage synchronization regression: PASS',`72hDelta=${(ocean72-mountain72).toFixed(1)}m/s`,`120hDelta=${(ocean120-mountain120).toFixed(1)}m/s`,`integrity96=${integrity96.toFixed(2)}`);
})().catch(e=>{console.error(e);process.exit(1)});
