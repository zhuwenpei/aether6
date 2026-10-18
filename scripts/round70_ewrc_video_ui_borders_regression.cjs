const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=(p)=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};

const pkg=JSON.parse(read('package.json'));
assert(pkg.version==='5.2.21','version must be 5.2.21');

const modal=read('src/components/VideoExportModal.tsx');
assert(modal.includes('setConfig({ ...DEFAULT_EXPORT_CONFIG, ...values })'),'built-in preset must rebuild from defaults');
assert(modal.includes('setConfig({ ...DEFAULT_EXPORT_CONFIG, ...parsed })'),'custom preset must rebuild from defaults');
assert(modal.includes('projectionBasemapIsOffline'),'projection UI availability guard missing');
assert(modal.includes('video-export-main')&&modal.includes('video-export-config-column'),'video export responsive layout classes missing');

const renderer=read('src/utils/VideoRenderEngine.ts');
assert(renderer.includes('canUseOfflineVideoReprojection'),'render-engine projection hard guard missing');
assert(renderer.includes('projectionAllowed && !!exportConfig.jmaNorthPolarStereographicProjection'),'polar projection is not basemap-gated');
assert(renderer.includes('projectionAllowed && !!exportConfig.jmaAzimuthalEqualAreaProjection'),'LAEA projection is not basemap-gated');

const css=read('src/index.css');
assert(css.includes('scale:.94'),'global button press shrink missing');
assert(css.includes('cubic-bezier(.20,1.62,.32,1)'),'button release spring/overshoot missing');
assert(css.includes('@media (max-width:1279px)')&&css.includes('.video-export-main'),'video export stacked overflow guard missing');

const loader=read('src/simulation/NaturalEarthLoader.ts');
assert(loader.includes('product_countries_highdetail_v3.geojson'),'high-detail product border plate is not loaded');
const borders=JSON.parse(read('public/data/product_countries_highdetail_v3.geojson'));
function verts(g){if(!g)return 0;const c=g.coordinates||[];if(g.type==='Polygon')return c.reduce((n,r)=>n+r.length,0);if(g.type==='MultiPolygon')return c.reduce((n,p)=>n+p.reduce((m,r)=>m+r.length,0),0);return 0;}
const vertexCount=borders.features.reduce((n,f)=>n+verts(f.geometry),0);
assert(vertexCount>25000,`high-detail border plate unexpectedly coarse: ${vertexCount} vertices`);
assert((borders.aether_meta?.detail_codes||[]).length>=5,'high-detail Natural Earth overlay metadata missing');

const source=read('src/simulation/AetherEnsembleGuidance.ts');
assert(source.includes('ewrcDurationHours?:number'),'EWRC duration diagnostic missing');
assert(source.includes('ewrcIntensityLossMps?:number'),'EWRC intensity-loss diagnostic missing');
assert(source.includes('ewrcFailureProbability?:number'),'EWRC failure probability diagnostic missing');
assert(source.includes('buildGuidanceEwrcIssueProfile'),'issue-correlated EWRC profile missing');
assert(source.includes('rh=env.rh700'),'EWRC environment must carry physical RH');
assert(source.includes('(.75-envQuality)*.40'),'live-like EWRC failure formula missing');
assert(source.includes('shear>25||sst<25||(dry>.62&&shear>17)'),'live-like severe EWRC failure gates missing');

// Numeric EWRC smoke test: the same forecast issue must be strongly correlated in outcome,
// while member onset/duration still vary. This guards against returning to independent coin flips.
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){const n=Math.round(horizon/6);return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{const f=i/n;return{lat:16+8*f+(k-3)*.04*Math.sin(Math.PI*f),lon:132+10*f+(k-3)*.04*Math.sin(Math.PI*f)}})}));}
let hostile=false;
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>hostile?({rh700:46,shear:22,sst:26.4,ohc:42,scores:{dryAir:.5}}):({rh700:78,shear:8,sst:29.5,ohc:95,scores:{dryAir:.04}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),getProceduralElevation:()=>0};
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const api=mod.exports;
const config={newEnvironmentPhysicsEnabled:true,ewrcTrigger:'auto',maxIntensityLimitEnabled:false,forecastPeakIntensityEnabled:false};
const storm={id:'EW',lat:16,lon:132,vmax:60,pmin:930,rmw:25,shear:8,configSnapshot:config};
const reference=Array.from({length:29},(_,i)=>{const lead=i*6;const v=60+(lead<=72?lead/72*13:13-(lead-72)/96*5);return{simHour:lead,lat:16+8*(lead/168),lon:132+10*(lead/168),vmax:v,pmin:930-(v-60)*1.5};});
function outcomeStats(members){
  const pert=members.filter(m=>!m.control);
  const triggered=pert.filter(m=>m.track.some(p=>p.ewrcTriggerLead!==undefined));
  const starts=triggered.map(m=>m.track.find(p=>p.ewrcTriggerLead!==undefined)?.ewrcTriggerLead).filter(Number.isFinite);
  const durations=triggered.map(m=>m.track.find(p=>Number.isFinite(p.ewrcDurationHours))?.ewrcDurationHours).filter(Number.isFinite);
  const outcomes=triggered.map(m=>[...m.track].reverse().find(p=>p.ewrcOpinion==='success'||p.ewrcOpinion==='failure')?.ewrcOpinion).filter(Boolean);
  const success=outcomes.filter(x=>x==='success').length, failure=outcomes.filter(x=>x==='failure').length;
  return{pert,triggered,starts,durations,outcomes,success,failure};
}
(async()=>{
  hostile=false;
  const fav=outcomeStats(await api.buildAetherEnsembleMembers({storm,currentHour:0,scene:[storm],seed:'ewrc-1',referencePath:reference,selectedModelIds:['ECMWF'],membersPerModel:50,horizon:168,config}));
  assert(fav.triggered.length>20,'favourable major-typhoon case produced too few EWRC members');
  assert(new Set(fav.starts).size>2,'EWRC start time has no member spread');
  assert(new Set(fav.durations.map(v=>Math.round(v*10))).size>2,'EWRC duration has no member spread');
  if(fav.outcomes.length>10){const minority=Math.min(fav.success,fav.failure)/fav.outcomes.length;assert(minority<.20,`EWRC outcome fragmented too much in one issue: ${fav.success}/${fav.failure}`);}
  hostile=true;
  const bad=outcomeStats(await api.buildAetherEnsembleMembers({storm:{...storm,shear:22},currentHour:0,scene:[storm],seed:'ewrc-1',referencePath:reference,selectedModelIds:['ECMWF'],membersPerModel:50,horizon:168,config}));
  if(bad.outcomes.length>10){const minority=Math.min(bad.success,bad.failure)/bad.outcomes.length;assert(minority<.20,`hostile EWRC outcome fragmented too much in one issue: ${bad.success}/${bad.failure}`);}
  console.log('Round 70 EWRC / video UI / border detail regression: PASS',`borders=${vertexCount}v`,`fav=${fav.success}/${fav.failure}`,`hostile=${bad.success}/${bad.failure}`);
})().catch(e=>{console.error(e);process.exit(1)});
