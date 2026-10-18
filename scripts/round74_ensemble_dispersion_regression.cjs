const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.25','version must be 5.2.25');
const source=read('src/simulation/AetherEnsembleGuidance.ts');
assert(source.includes('|PATH-GEOMETRY|'),'ensemble geometry must use an independent deterministic RNG stream');
assert(!source.includes('intensitySigma*targetErrorScale'),'target convergence must not suppress intrinsic member intensity noise');
assert(!source.includes('memberPeakBias*phaseEnvelope*targetErrorScale'),'target convergence must not suppress intrinsic member peak bias');
assert(source.includes('memberTargetInterpretationBias*targetErrorScale'),'target-specific error must still contract with lead time');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{
    const f=i/n;
    return {lat:16+15*f+1.8*Math.sin(Math.PI*f)+(k-3.5)*.08*Math.sin(Math.PI*f),lon:126-7*f+2.2*Math.sin(Math.PI*f)+(k-3.5)*.06*Math.sin(Math.PI*f)};
  })}));
}
function load(){
  const mod={exports:{}};
  function req(id){
    if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
    if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:73,shear:9,sst:29.2,ohc:95,scores:{dryAir:.04}})};
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
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)]};
const nearest=(m,h)=>m.track.reduce((a,b)=>Math.abs(b.leadHour-h)<Math.abs(a.leadHour-h)?b:a);
(async()=>{
  const {buildAetherEnsembleMembers}=load();
  const horizon=120,target=70,initial=35;
  const config={newEnvironmentPhysicsEnabled:true,ewrcTrigger:'off',maxIntensityLimitEnabled:true,maxIntensityLimit:target,autoAdjustIntensity:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true,intensificationRate:1};
  const storm={id:'T',lat:16,lon:126,vmax:initial,pmin:985,rmw:38,shear:9,coreCompactness:.65,eyewallIntegrity:.65,lowLevelVortexIntegrity:.75,configSnapshot:config};
  const reference=Array.from({length:21},(_,i)=>{const h=i*6,f=i/20,v=initial+(78-initial)*Math.min(1,h/84);return{simHour:h,lat:16+15*f+1.8*Math.sin(Math.PI*f),lon:126-7*f+2.2*Math.sin(Math.PI*f),vmax:v,pmin:985-(v-initial)*1.3,lowLevelVortexIntegrity:.8};});
  const all=await buildAetherEnsembleMembers({storm,currentHour:0,scene:[storm],seed:'round74-dispersion',referencePath:reference,selectedModelIds:['AIFS'],membersPerModel:50,horizon,config});
  const control=all.find(m=>m.control),members=all.filter(m=>!m.control);
  assert(control&&members.length===49,`expected WeatherNext-style 49 perturbation members, got ${members.length}`);
  const radialStats=(h)=>{
    const c=nearest(control,h);
    const xs=[],ys=[],rad=[];
    for(const m of members){const p=nearest(m,h),x=(p.lon-c.lon)*100,y=(p.lat-c.lat)*111;xs.push(x);ys.push(y);rad.push(Math.hypot(x,y));}
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
    const rms=Math.sqrt(xs.reduce((a,x,i)=>a+(x-mx)**2+(ys[i]-my)**2,0)/xs.length);
    return {rms,p50:q(rad,.50),p90:q(rad,.90),max:Math.max(...rad)};
  };
  const s72=radialStats(72),s120=radialStats(120);
  assert(s72.rms>=115,`72 h path plume collapsed: RMS=${s72.rms.toFixed(1)} km`);
  assert(s120.rms>=190&&s120.p90>=320,`120 h path plume too narrow: RMS=${s120.rms.toFixed(1)} p90=${s120.p90.toFixed(1)} km`);
  assert(s120.max<=760,`path plume became dominated by an implausible single outlier: max=${s120.max.toFixed(1)} km`);

  const peaks=members.map(m=>m.maxVmax),mins=members.map(m=>m.minPmin);
  const p10=q(peaks,.10),p50=q(peaks,.50),p90=q(peaks,.90);
  assert(p50>=65&&p50<=73,`target-centred median drifted away: p50=${p50.toFixed(1)} m/s`);
  assert(p90-p10>=9.5,`intensity spread collapsed: p10/p90=${p10.toFixed(1)}/${p90.toFixed(1)} m/s`);
  assert(Math.max(...mins)-Math.min(...mins)>=18,`pressure spread collapsed: range=${(Math.max(...mins)-Math.min(...mins)).toFixed(1)} hPa`);
  const high=peaks.filter(v=>v>=target+5).length,low=peaks.filter(v=>v<=target-8).length;
  assert(high>=2&&low>=2,`extreme high/low cases missing: high=${high} low=${low}`);
  console.log('Round 74 ensemble-dispersion regression: PASS',
    `path RMS 72/120h=${s72.rms.toFixed(0)}/${s120.rms.toFixed(0)} km`,
    `120h p50/p90=${s120.p50.toFixed(0)}/${s120.p90.toFixed(0)} km`,
    `peak p10/p50/p90=${p10.toFixed(1)}/${p50.toFixed(1)}/${p90.toFixed(1)} m/s`,
    `extreme high/low=${high}/${low}`);
})().catch(e=>{console.error(e);process.exit(1)});
