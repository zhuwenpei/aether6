const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.25','version must be 5.2.25');
const source=read('src/simulation/AetherEnsembleGuidance.ts');
assert(source.includes('guidanceTargetErrorScale'),'time-contracting target error envelope missing');
assert(source.includes('targetTailPick<.07')&&source.includes('targetTailPick>.93'),'rare high/low target tails missing');
assert(source.includes('target>=115'),'playground target must not become forecast ceiling');
assert(!source.includes('initialVmax<=target+0.35'),'simulation target still only applies to weakening cases');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map(name=>({spec:{name},track:Array.from({length:n+1},(_,i)=>({lat:15+i*.08,lon:130+i*.16}))}));
}
function load(){
  const mod={exports:{}};
  function req(id){
    if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
    if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:76,shear:8,sst:29.4,ohc:100,scores:{dryAir:.03}})};
    if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
    if(id.endsWith('/Engine')||id.includes('./Engine'))return{
      getLandMetrics:()=>({isLand:false,elevation:0,landName:''}),
      getProceduralElevation:()=>0,
      getCoreSurfaceInteractionMetrics:()=>({landFraction:0,mountainFraction:0,meanLandElevation:0,maxElevation:0,frictionIndex:0,frictionAsymmetry:0,blockingIndex:0,dominantBearingDeg:0})
    };
    return{};
  }
  new Function('require','module','exports',js)(req,mod,mod.exports);
  return mod.exports;
}
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))]};
const nearest=(m,h)=>m.track.reduce((a,b)=>Math.abs(b.leadHour-h)<Math.abs(a.leadHour-h)?b:a);
const medAbs=(vals,target)=>q(vals.map(v=>Math.abs(v-target)),.5);

(async()=>{
  const {buildAetherEnsembleMembers}=load();
  const horizon=120,target=70,initial=35;
  const config={newEnvironmentPhysicsEnabled:true,ewrcTrigger:'off',maxIntensityLimitEnabled:true,maxIntensityLimit:target,autoAdjustIntensity:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true,intensificationRate:1};
  const storm={id:'T',lat:15,lon:130,vmax:initial,pmin:985,rmw:38,shear:8,coreCompactness:.65,eyewallIntegrity:.65,lowLevelVortexIntegrity:.75,configSnapshot:config};
  // Deliberately use an over-strong parent reference. With forecast-peak override OFF the live
  // simulation target must still pull ensemble guidance back toward 70 m/s without clipping it.
  const reference=Array.from({length:21},(_,i)=>{const h=i*6;const v=initial+(82-initial)*Math.min(1,h/84);return{simHour:h,lat:15+h*.0133,lon:130+h*.0266,vmax:v,pmin:985-(v-initial)*1.3,lowLevelVortexIntegrity:.8};});
  const args={storm,currentHour:0,scene:[storm],seed:'round73-target',referencePath:reference,selectedModelIds:['ECMWF','AIFS','GEFS','GEM'],membersPerModel:60,horizon,config};
  const guided=await buildAetherEnsembleMembers(args);
  const members=guided.filter(m=>!m.control);
  const peaks=members.map(m=>m.maxVmax);
  const p10=q(peaks,.10),p50=q(peaks,.50),p90=q(peaks,.90),lo=Math.min(...peaks),hi=Math.max(...peaks);
  const highExtremeCount=peaks.filter(v=>v>=target+5).length;
  const lowExtremeCount=peaks.filter(v=>v<=target-8).length;
  assert(p50>=66&&p50<=72.5,`simulation target does not anchor ensemble peak: p50=${p50}`);
  assert(p90-p10>=4.0,`target constraint collapsed realistic spread: p10=${p10} p90=${p90}`);
  assert(lowExtremeCount>=3,`too few low-tail target cases: count=${lowExtremeCount} min=${lo}`);
  assert(highExtremeCount>=3,`too few high-tail target cases: count=${highExtremeCount} max=${hi}`);

  const errors=[24,48,72,120].map(h=>{
    const vals=members.map(m=>nearest(m,h).vmax);
    return medAbs(vals,target);
  });
  assert(errors[0]>errors[1]&&errors[1]>errors[2]&&errors[2]>errors[3],`target error does not contract with time: ${errors.map(v=>v.toFixed(2)).join(' > ')}`);

  const noTargetConfig={...config,maxIntensityLimitEnabled:false};
  const noTargetStorm={...storm,configSnapshot:noTargetConfig};
  const free=await buildAetherEnsembleMembers({...args,storm:noTargetStorm,config:noTargetConfig,seed:'round73-target'});
  const freePeaks=free.filter(m=>!m.control).map(m=>m.maxVmax);
  assert(q(freePeaks,.90)>p90+2.0,`simulation target no longer constrains upper ensemble tail at all: guided90=${p90} free90=${q(freePeaks,.90)}`);

  // Preserve the earlier lowered-target behaviour as well: most members weaken progressively, but
  // the distribution remains nonzero and is not hard-clipped to the requested value.
  const weakTarget=40,weakInitial=60;
  const weakConfig={...config,maxIntensityLimit:weakTarget};
  const weakStorm={...storm,vmax:weakInitial,pmin:945,configSnapshot:weakConfig};
  const weakRef=Array.from({length:21},(_,i)=>{const h=i*6;const v=weakInitial-18*Math.min(1,h/84);return{simHour:h,lat:15+h*.0133,lon:130+h*.0266,vmax:v,pmin:945+(weakInitial-v)*1.15,lowLevelVortexIntegrity:.8};});
  const weak=await buildAetherEnsembleMembers({...args,storm:weakStorm,config:weakConfig,referencePath:weakRef,seed:'round73-weak',selectedModelIds:['ECMWF'],membersPerModel:60});
  const weakMembers=weak.filter(m=>!m.control),weak120=weakMembers.map(m=>nearest(m,120).vmax);
  assert(q(weak120,.50)>=37&&q(weak120,.50)<=42.5,`lowered target no longer produces gradual weakening: p50=${q(weak120,.50)}`);
  assert(q(weak120,.90)-q(weak120,.10)>=2.0,`lowered-target ensemble lost dispersion: range=${q(weak120,.90)-q(weak120,.10)}`);

  console.log('Round 73 target-guidance convergence regression: PASS',
    `peak p10/p50/p90=${p10.toFixed(1)}/${p50.toFixed(1)}/${p90.toFixed(1)} m/s`,
    `extremes=${lo.toFixed(1)}..${hi.toFixed(1)} m/s (low/high counts ${lowExtremeCount}/${highExtremeCount})`,
    `target errors 24/48/72/120h=${errors.map(v=>v.toFixed(1)).join('/')}`);
})().catch(e=>{console.error(e);process.exit(1)});
