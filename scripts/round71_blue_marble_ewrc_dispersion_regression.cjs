const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=(p)=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};

const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.22','version must be 5.2.22');

const modal=read('src/components/VideoExportModal.tsx');
assert(modal.includes('config.baseMap === "blueMarble" || isLocalVectorBasemap(config.baseMap)'),'Blue Marble missing from projection-safe UI guard');
assert(modal.includes('Blue Marble 2002、Blue Marble 2004 开放'),'projection support hint does not name both Blue Marble versions');
assert(modal.includes('nextBase === "blueMarble" || isLocalVectorBasemap(nextBase)'),'switching to Blue Marble still clears projection flags');

const renderer=read('src/utils/VideoRenderEngine.ts');
assert(renderer.includes('function canUseVideoReprojection'),'video render projection guard missing');
assert(renderer.includes('baseMap === "blueMarble"'),'Blue Marble missing from render-engine projection allowlist');
assert(renderer.includes('drawBlueMarble2002LambertAzimuthalEqualArea'),'Blue Marble 2002 LAEA renderer missing');
assert(renderer.includes('drawBlueMarble2002NorthPolarStereographic'),'Blue Marble 2002 polar renderer missing');
assert(renderer.includes('drawBlueMarble2004LambertAzimuthalEqualArea'),'Blue Marble 2004 LAEA renderer missing');
assert(renderer.includes('drawBlueMarble2004NorthPolarStereographic'),'Blue Marble 2004 polar renderer missing');

const source=read('src/simulation/AetherEnsembleGuidance.ts');
assert(source.includes('Only the success/failure stochastic background is shared'),'EWRC outcome-only correlation contract missing');
assert(source.includes('const occurrenceQuantile=clamp(.035+.93*rand()'),'EWRC occurrence timing is still issue-locked');
assert(source.includes('durationNoise:rand()'),'EWRC duration dispersion is still issue-locked');
assert(source.includes('weakenNoise:rand()'),'EWRC intensity-loss dispersion is still issue-locked');
assert(source.includes('outcomeQuantile:clamp(shared.outcomeQuantile'),'EWRC outcome background is not shared');
assert(!source.includes('shared.durationNoise'),'EWRC duration still incorrectly shares issue noise');
assert(!source.includes('shared.weakenNoise'),'EWRC weakening still incorrectly shares issue noise');

// Numeric smoke test: outcomes stay clustered within one controlled forecast issue, while onset,
// duration and intensity loss retain clear member spread.
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){const n=Math.round(horizon/6);return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{const f=i/n;return{lat:16+8*f+(k-3)*.04*Math.sin(Math.PI*f),lon:132+10*f+(k-3)*.04*Math.sin(Math.PI*f)}})}));}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:78,shear:8,sst:29.5,ohc:95,scores:{dryAir:.04}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),getProceduralElevation:()=>0};
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const api=mod.exports;
const config={newEnvironmentPhysicsEnabled:true,ewrcTrigger:'auto',maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false};
const storm={id:'EW',lat:16,lon:132,vmax:60,pmin:930,rmw:25,shear:8,configSnapshot:config};
const reference=Array.from({length:29},(_,i)=>{const lead=i*6;const v=60+(lead<=72?lead/72*13:13-(lead-72)/96*5);return{simHour:lead,lat:16+8*(lead/168),lon:132+10*(lead/168),vmax:v,pmin:930-(v-60)*1.5};});
function values(members,key){return members.filter(m=>!m.control).map(m=>m.track.find(p=>Number.isFinite(p[key]))?.[key]).filter(Number.isFinite);}
function finalOutcomes(members){return members.filter(m=>!m.control).map(m=>[...m.track].reverse().find(p=>p.ewrcOpinion==='success'||p.ewrcOpinion==='failure')?.ewrcOpinion).filter(Boolean);}
(async()=>{
  const members=await api.buildAetherEnsembleMembers({storm,currentHour:0,scene:[storm],seed:'ewrc-2',referencePath:reference,selectedModelIds:['ECMWF'],membersPerModel:75,horizon:168,config});
  const starts=values(members,'ewrcTriggerLead');
  const durations=values(members,'ewrcDurationHours');
  const losses=values(members,'ewrcIntensityLossMps');
  const outcomes=finalOutcomes(members);
  assert(starts.length>25,'too few EWRC members in smoke test');
  const startUnique=new Set(starts.map(v=>Math.round(v))).size;
  const durationUnique=new Set(durations.map(v=>Math.round(v*10))).size;
  const lossUnique=new Set(losses.map(v=>Math.round(v*10))).size;
  assert(startUnique>=6,`EWRC onset spread still too constrained: ${startUnique}`);
  assert(durationUnique>=8,`EWRC duration spread still too constrained: ${durationUnique}`);
  assert(lossUnique>=8,`EWRC intensity-loss spread still too constrained: ${lossUnique}`);
  const success=outcomes.filter(x=>x==='success').length, failure=outcomes.filter(x=>x==='failure').length;
  if(outcomes.length>15){const minority=Math.min(success,failure)/outcomes.length;assert(minority<.22,`controlled EWRC outcomes fragmented too much: ${success}/${failure}`);}
  console.log('Round 71 Blue Marble / EWRC dispersion regression: PASS',`starts=${startUnique}`,`durations=${durationUnique}`,`losses=${lossUnique}`,`outcomes=${success}/${failure}`);
})().catch(e=>{console.error(e);process.exit(1)});
