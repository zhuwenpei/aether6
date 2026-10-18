const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const pkg=JSON.parse(read('package.json'));
assert(['5.2.26','5.2.27'].includes(pkg.version),'version must be 5.2.26/5.2.27');
const source=read('src/simulation/AetherEnsembleGuidance.ts');
const mapSource=read('src/components/MapView.tsx');
assert(!/ewrc/i.test(source),'future ensemble EWRC/replacement logic must be fully removed');
assert(source.includes('buildTrackVerificationRegime'),'track-verification spread regime missing');
assert(source.includes('directionalMismatch'),'large-direction verification signal missing');
assert(source.includes('fastCentre&&!center.isLand'),'synchronous ocean centre guidance must skip core terrain sampling');
assert(source.includes('done%25===0'),'large ensemble generation must yield to the UI at least every 25 members');
assert(!/guidanceKey[\s\S]{0,900}ewrcProgress/.test(mapSource),'Map guidance cache must not churn on EWRC progress');

const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
const zeroCore=()=>({landFraction:0,mountainFraction:0,meanLandElevation:0,maxElevation:0,frictionIndex:0,frictionAsymmetry:0,blockingIndex:0,dominantBearingDeg:0});
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{const f=i/n;return{lat:storm.lat+10*f+1.2*Math.sin(Math.PI*f),lon:storm.lon+5*f+.8*Math.sin(Math.PI*f)}})}));
}
function load(kind='ocean',counters={}){
  const mod={exports:{}};
  function req(id){
    if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
    if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:76,shear:8,sst:29.3,ohc:96,scores:{dryAir:.04}})};
    if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
    if(id.includes('Engine'))return{
      getLandMetrics:(lat,lon)=>{counters.land=(counters.land||0)+1;const land=kind==='mountain'&&lon>=120.0&&lon<=121.85&&lat>=22.7&&lat<=24.5;return{isLand:land,elevation:land?((lon>=120.55&&lon<=121.35)?2800:900):0,landName:land?'Taiwan':'ocean'}},
      getProceduralElevation:()=>2800,
      getDistanceToLand:(lat,lon)=>{counters.distance=(counters.distance||0)+1;return kind==='mountain'&&lon>=119.7&&lon<=122.1?.03:8},
      getCoreSurfaceInteractionMetrics:(lat,lon)=>{counters.fullCore=(counters.fullCore||0)+1;if(kind!=='mountain'||lon<119.7||lon>122.1||lat<22.5||lat>24.7)return zeroCore();return{landFraction:.61,mountainFraction:.49,meanLandElevation:1800,maxElevation:3200,frictionIndex:.83,frictionAsymmetry:.44,blockingIndex:.80,dominantBearingDeg:270}}
    };
    return{};
  }
  new Function('require','module','exports',js)(req,mod,mod.exports);
  return mod.exports;
}
function dest(lat,lon,bearing,km){const a=bearing*Math.PI/180;return{lat:lat+km*Math.cos(a)/111.12,lon:lon+km*Math.sin(a)/(111.12*Math.cos(lat*Math.PI/180))};}
function history(kind){
  const hist=[],current=24;
  for(let h=0;h<=current;h+=3){
    const p=dest(20,125,45,h/3*25),st={simHour:h,lat:p.lat,lon:p.lon,forecastPath:[]},lead=current-h;
    if(lead>=6&&kind!=='neutral'){
      const now=dest(20,125,45,current/3*25);
      if(kind==='overlap'){
        const prev=dest(20,125,45,(current-3)/3*25);st.forecastPath=[{simHour:lead-3,...prev},{simHour:lead,...now}];
      }else if(kind==='mismatch'){
        // Forecast ending westward while actual motion is a stable NE turn.
        const prev=dest(now.lat,now.lon,90,25);st.forecastPath=[{simHour:lead-3,...prev},{simHour:lead,...now}];
      }else if(kind==='parallel'){
        // Large position error but identical NE heading: this must NOT open the plume.
        const off=dest(now.lat,now.lon,135,100),prev=dest(off.lat,off.lon,225,25);st.forecastPath=[{simHour:lead-3,...prev},{simHour:lead,...off}];
      }
    }
    hist.push(st);
  }
  const n=hist[hist.length-1];return{history:hist,lat:n.lat,lon:n.lon};
}
const nearest=(m,h)=>m.track.reduce((a,b)=>Math.abs(b.leadHour-h)<Math.abs(a.leadHour-h)?b:a);
const q=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)]};
const distance=(a,b)=>Math.hypot((a.lat-b.lat)*111.12,(a.lon-b.lon)*111.12*Math.cos(a.lat*Math.PI/180));

(async()=>{
  // Performance: live-map centre guidance over open ocean must not call distance-to-land or full
  // 33-point core sampler. This is the key 5.2.21-vs-5.2.25 regression that caused 3-h stalls.
  const perf={};const P=load('ocean',perf);
  const pStorm={id:'P',lat:15,lon:135,vmax:38,pmin:978,rmw:32,history:[]};
  const pRef=Array.from({length:29},(_,i)=>({simHour:i*6,lat:15+i*.2,lon:135+i*.1,vmax:38,pmin:978,lowLevelVortexIntegrity:.8}));
  P.buildAetherCenterGuidance(pStorm,0,[pStorm],'perf',pRef,168,{});
  assert((perf.fullCore||0)===0,`live centre guidance still invoked full terrain core sampler ${perf.fullCore} times`);
  assert((perf.distance||0)===0,`live centre guidance still invoked coast-distance scans ${perf.distance} times`);

  // Verification-dependent path spread. Same storm/seed/reference: only prior forecast verification differs.
  const M=load('ocean',{}),config={newEnvironmentPhysicsEnabled:true,maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true};
  const spreads={};
  for(const kind of ['neutral','overlap','parallel','mismatch']){
    const hh=history(kind),storm={id:'V',...hh,vmax:38,pmin:980,rmw:35,lowLevelVortexIntegrity:.8,configSnapshot:config};
    const ref=Array.from({length:21},(_,i)=>({simHour:i*6,lat:storm.lat+10*i/20,lon:storm.lon+5*i/20,vmax:46,pmin:968,lowLevelVortexIntegrity:.8}));
    const all=await M.buildAetherEnsembleMembers({storm,currentHour:24,scene:[storm],seed:'verify-r75',referencePath:ref,selectedModelIds:['AIFS'],membersPerModel:50,horizon:120,config});
    const control=all.find(x=>x.control),members=all.filter(x=>!x.control),cp=nearest(control,120),d=members.map(m=>distance(nearest(m,120),cp));
    spreads[kind]={p50:q(d,.5),p90:q(d,.9)};
  }
  assert(spreads.overlap.p50<spreads.neutral.p50*.90,`verified overlap did not contract plume: ${JSON.stringify(spreads)}`);
  assert(spreads.mismatch.p50>spreads.neutral.p50*1.25&&spreads.mismatch.p90>spreads.neutral.p90*1.25,`persistent heading failure did not widen/sway plume: ${JSON.stringify(spreads)}`);
  assert(spreads.parallel.p90<spreads.mismatch.p90*.80,`same-heading spatial offset incorrectly treated as direction failure: ${JSON.stringify(spreads)}`);

  // Taiwan-like mountain crossing: a ~52 m/s member must suffer major inner-core loss and retain it
  // for the first offshore nodes instead of emerging near its landfall intensity.
  const T=load('mountain',{}),tConfig={newEnvironmentPhysicsEnabled:true,maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false,landDecayEnabled:true};
  const tStorm={id:'TW',lat:23.55,lon:122.4,vmax:52,pmin:940,rmw:24,coreCompactness:.82,eyewallIntegrity:.86,lowLevelVortexIntegrity:.92,history:[],configSnapshot:tConfig};
  const tRef=Array.from({length:17},(_,i)=>({simHour:i*3,lat:23.55,lon:122.4-.15*i*3,vmax:52,pmin:940,lowLevelVortexIntegrity:.92}));
  const allT=await T.buildAetherEnsembleMembers({storm:tStorm,currentHour:0,scene:[tStorm],seed:'taiwan-r75',referencePath:tRef,selectedModelIds:['AIFS'],membersPerModel:50,horizon:48,config:tConfig});
  const tm=allT.filter(x=>!x.control);
  const med=h=>q(tm.map(m=>nearest(m,h).vmax),.5);
  const exit18=med(18),off24=med(24);
  assert(exit18<36,`Taiwan mountain crossing remains too strong at west-coast exit: median=${exit18.toFixed(1)} m/s`);
  assert(off24<38,`post-mountain damage memory recovers too quickly offshore: median=${off24.toFixed(1)} m/s`);
  assert(52-exit18>12,`mountain-crossing intensity loss is too small: ${exit18.toFixed(1)} m/s`);

  console.log('Round 75 dynamic spread/performance/mountain regression: PASS',
    `spread p50 neutral/overlap/parallel/mismatch=${['neutral','overlap','parallel','mismatch'].map(k=>spreads[k].p50.toFixed(0)).join('/') }km`,
    `p90=${['neutral','overlap','parallel','mismatch'].map(k=>spreads[k].p90.toFixed(0)).join('/')}km`,
    `Taiwan median exit/+6h=${exit18.toFixed(1)}/${off24.toFixed(1)}m/s`,
    `live fullCore=${perf.fullCore||0} distance=${perf.distance||0}`);
})().catch(e=>{console.error(e);process.exit(1)});
