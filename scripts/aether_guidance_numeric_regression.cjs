const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{
    const f=i/n, lead=i*6, baseLat=15+17*f+1.2*Math.sin(f*Math.PI),baseLon=130+25*f;
    return {lat:baseLat+(k-1)*0.16*Math.sin(Math.PI*f),lon:baseLon+(k-1)*0.12*Math.sin(Math.PI*f)};
  })}));
}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:72,shear:10,sst:29,ohc:85,scores:{dryAir:.08}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{
    getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),
    getProceduralElevation:()=>0
  };
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const api=mod.exports;
const storm={id:'T',lat:15,lon:130,vmax:32,pmin:975,rmw:35};
const reference=Array.from({length:29},(_,i)=>{const f=i/28;return{simHour:i*6,lat:15+17*f+1.2*Math.sin(f*Math.PI),lon:130+25*f,vmax:32+14*Math.sin(Math.PI*f),pmin:975-20*Math.sin(Math.PI*f)}});
const centers=api.buildAetherCenterGuidance(storm,120,[storm],'seed',reference,168);
if(centers.length!==8)throw new Error('center family count');
for(const c of centers){
  if(Math.hypot(c.track[0].lat-storm.lat,c.track[0].lon-storm.lon)>.08)throw new Error(`${c.id} does not start at analysis`);
  if(c.track.at(-1).lon<148)throw new Error(`${c.id} lead-hour normalization collapsed to wrong end`);
  for(let i=1;i<c.track.length;i++){const a=c.track[i-1],b=c.track[i],km=Math.hypot((b.lat-a.lat)*111,(b.lon-a.lon)*100);if(km>850)throw new Error(`${c.id} path jump ${km}`);}
  if(!(c.maxVmax>30&&c.minPmin<990))throw new Error(`${c.id} intensity forecast missing`);
}
const ends=centers.map(c=>c.track.at(-1));const lonRange=Math.max(...ends.map(p=>p.lon))-Math.min(...ends.map(p=>p.lon));const latRange=Math.max(...ends.map(p=>p.lat))-Math.min(...ends.map(p=>p.lat));
if(lonRange<.2&&latRange<.2)throw new Error('model centers do not differentiate');
(async()=>{
 const members=await api.buildAetherEnsembleMembers({storm,currentHour:120,scene:[storm],seed:'seed',referencePath:reference,selectedModelIds:['ECMWF','GEFS'],membersPerModel:50,horizon:168});
 if(members.length!==100)throw new Error('member count');
 const controls=members.filter(m=>m.control); if(controls.length!==2)throw new Error('control count');
 for(const ctrl of controls){const cen=centers.find(c=>c.modelId===ctrl.modelId);if(!cen)throw new Error('center missing');const d=Math.hypot(ctrl.track.at(-1).lat-cen.track.at(-1).lat,ctrl.track.at(-1).lon-cen.track.at(-1).lon);if(d>1e-9)throw new Error('control not identical to model center');}
 const pert=members.filter(m=>!m.control); const endSpread=Math.max(...pert.map(m=>Math.hypot((m.track.at(-1).lat-controls[0].track.at(-1).lat)*111,(m.track.at(-1).lon-controls[0].track.at(-1).lon)*100)));
 if(endSpread<80)throw new Error('member spread too small');
 // When deterministic model centres disagree, no selected model is allowed to retain an
 // implausibly razor-thin plume.  Check this at an intermediate lead where the old bug was most
 // visible rather than only at the very end of the forecast.
 const leadIndex=16; // 96 h at 6-hourly output
 const centerPts=centers.map(c=>c.track[leadIndex]);
 const meanLat=centerPts.reduce((a,p)=>a+p.lat,0)/centerPts.length,meanLon=centerPts.reduce((a,p)=>a+p.lon,0)/centerPts.length;
 const interRms=Math.sqrt(centerPts.reduce((a,p)=>a+Math.pow((p.lat-meanLat)*111,2)+Math.pow((p.lon-meanLon)*100,2),0)/centerPts.length);
 for(const ctrl of controls){
   const group=members.filter(m=>m.modelId===ctrl.modelId&&!m.control);
   const cp=ctrl.track[leadIndex];
   const memberRms=Math.sqrt(group.reduce((a,m)=>{const p=m.track[leadIndex];return a+Math.pow((p.lat-cp.lat)*111,2)+Math.pow((p.lon-cp.lon)*100,2)},0)/Math.max(1,group.length));
   if(interRms>35&&memberRms<Math.max(16,interRms*.35))throw new Error(`${ctrl.modelId} plume unrealistically tight under model disagreement: ${memberRms.toFixed(1)} vs ${interRms.toFixed(1)} km`);
 }
 console.log('aether_guidance_numeric_regression: PASS',`centers=${centers.length}`,`members=${members.length}`,`endSpread=${endSpread.toFixed(0)}km`);
})().catch(e=>{console.error(e);process.exit(1)});
