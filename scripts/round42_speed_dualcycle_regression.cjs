const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');

const engineSrc=fs.readFileSync('src/simulation/Engine.ts','utf8');
if(!engineSrc.includes('strongestStallEffect') || !engineSrc.includes('runLength === 2 ? 0.76')) throw new Error('forecast spacing stall sensitivity missing');
if(!engineSrc.includes('const guidedMag = physicalMag * Math.max(0.10, Math.min(1.30, speedBlend))')) throw new Error('forecast route speed range still over-clamped');
if(!engineSrc.includes('const routeMinScale = hasManualForecastFramework ? Math.max(0.16')) throw new Error('legacy forecast speed floor still erases route slowdown or ignores validated hand-route state');

const productSrc=fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');
const pairedStart=productSrc.indexOf('function drawPairedCycle');
const pairedEnd=productSrc.indexOf('function drawCategoryWindBands',pairedStart);
const paired=productSrc.slice(pairedStart,pairedEnd);
if(!paired.includes('selectedMembers=args.members.filter')) throw new Error('dual-cycle model filtering missing');
if(paired.includes('.slice(0,50)')) throw new Error('dual-cycle still hard-capped to first 50 members');

const src=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>({lat:storm.lat+i*.15+(k-3)*.01,lon:storm.lon+i*.23+(k-3)*.01}))}));
}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:72,shear:10,sst:29,ohc:85,scores:{dryAir:.08}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),getProceduralElevation:()=>0};
  return{};
}
new Function('require','module','exports',js)(req,mod,mod.exports);
const api=mod.exports;
const storm={id:'T',lat:15,lon:130,vmax:35,pmin:970,rmw:30};
const reference=[];let lat=15,lon=130;
for(let h=0;h<=120;h+=3){
  if(h>0){const stalled=h>=39&&h<=57;lat+=stalled?.006:.18;lon+=stalled?.008:.25;}
  reference.push({simHour:h,lat,lon,vmax:35,pmin:970});
}
const centers=api.buildAetherCenterGuidance(storm,0,[storm],'round42-speed',reference,120);
const speedAt=(track,h)=>track.find(p=>p.leadHour===h)?.speed;
const normal=centers.map(c=>speedAt(c.track,84)).filter(Number.isFinite);
const stalled=centers.map(c=>speedAt(c.track,48)).filter(Number.isFinite);
if(Math.max(...normal)-Math.min(...normal)<2.2) throw new Error('model translation-speed differences remain too small');
if(Math.max(...stalled)>1.5) throw new Error('model centres do not inherit deterministic stall strongly enough');

(async()=>{
  const members=await api.buildAetherEnsembleMembers({storm,currentHour:0,scene:[storm],seed:'round42-speed',referencePath:reference,selectedModelIds:['ECMWF'],membersPerModel:80,horizon:120});
  const pert=members.filter(m=>!m.control);
  const memberNormal=pert.map(m=>speedAt(m.track,84)).filter(Number.isFinite).sort((a,b)=>a-b);
  const memberStall=pert.map(m=>speedAt(m.track,48)).filter(Number.isFinite).sort((a,b)=>a-b);
  const q=(arr,p)=>arr[Math.floor((arr.length-1)*p)];
  if(q(memberNormal,.9)-q(memberNormal,.1)<2.2) throw new Error('member translation-speed spread remains too small');
  if(q(memberStall,.9)>1.5) throw new Error('members run through route-induced stall');
  console.log('round42_speed_dualcycle_regression: PASS',
    `modelSpeedRange=${(Math.max(...normal)-Math.min(...normal)).toFixed(1)}km/h`,
    `memberP10P90=${q(memberNormal,.1).toFixed(1)}-${q(memberNormal,.9).toFixed(1)}km/h`,
    `stallMax=${Math.max(...stalled).toFixed(2)}km/h`);
})().catch(e=>{console.error(e);process.exit(1)});
