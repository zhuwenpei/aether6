const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
for(const needle of [
  'const geometryRef=smoothReference(ref)',
  'const deltaCross=crossKm-previousCross',
  'modelTimingOffsetKm+referenceStepKm*(modelSpeedFactor-1)',
  'constrainGuidanceTurnToBaselineCurvature',
  'previous,curvatureLimited,previousGeometryReference,currentGeometryReference,referenceStepKm,22',
  'previousMember,memberCurvatureLimited,parentPrevious,cp,parentStepKm,50'
]) if(!src.includes(needle)) throw new Error(`missing curvature-integrated guidance guard: ${needle}`);
if(src.includes('base.lat+(geom.ny*crossKm+geom.ty*alongKm)/111.12')) throw new Error('model centre returned to absolute rotating-offset reprojection');
if(src.includes('cp.lat+(g.ny*crossKm+g.ty*alongKm)/111.12')) throw new Error('ensemble member returned to absolute rotating-offset reprojection');

const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},reportDiagnostics:true,fileName:'AetherEnsembleGuidance.ts'});
const syntax=(out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
if(syntax.length) throw new Error(`transpile error: ${syntax.map(d=>d.messageText).join('; ')}`);
const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{
    const f=i/Math.max(1,n);
    return {lat:storm.lat+i*.12+(k-3.5)*.13*Math.sin(f*Math.PI*2.8),lon:storm.lon+i*.22+(k-3.5)*.08*Math.sin(f*Math.PI*2.2)};
  })}));
}
const mod={exports:{}};
function req(id){
  if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};
  if(id.includes('SynopticEnvironment'))return{getSynopticEnvironmentState:()=>({rh700:72,shear:10,sst:29,ohc:85,scores:{dryAir:.08}})};
  if(id.includes('NaturalEarthLoader'))return{checkPointOnProductLandGeoJson:()=>false};
  if(id.endsWith('/Engine')||id.includes('./Engine'))return{getLandMetrics:()=>({isLand:false,elevation:0,landName:'海洋'}),getProceduralElevation:()=>0};
  return{};
}
new Function('require','module','exports',out.outputText)(req,mod,mod.exports);
function bearing(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;const y=Math.sin(dl)*Math.cos(p2);const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360;}
function delta(a,b){let d=((b-a+540)%360)-180;return d===-180?180:d;}
function kmPerLon(lat){return 111.12*Math.max(.18,Math.cos(lat*Math.PI/180));}
function dist(a,b){return Math.hypot((b.lat-a.lat)*111.12,(b.lon-a.lon)*kmPerLon((a.lat+b.lat)*.5));}
const storm={id:'T',lat:14.5,lon:128.5,vmax:48,pmin:945,rmw:26};
const reference=[];let lat=storm.lat,lon=storm.lon;
for(let h=0;h<=168;h+=3){
  if(h){
    if(h<42){lat+=.17;lon-=.04;}
    else if(h<78){lat+=.16;lon-=.10;}
    else if(h<114){lat+=.12;lon+=.01;}
    else {lat+=.08;lon+=.18;}
  }
  reference.push({simHour:h,lat,lon,vmax:48-.12*h,pmin:945+.28*h});
}
let worstSameSignTurn=0,worstMaxStepTurn=0,minEndSpread=Infinity;
for(let seedIndex=0;seedIndex<128;seedIndex++){
  const centers=mod.exports.buildAetherCenterGuidance(storm,0,[storm],`round51-${seedIndex}`,reference,168);
  for(const center of centers){
    let sameRun=0,lastSign=0;
    for(let i=2;i<center.track.length;i++){
      const turn=delta(bearing(center.track[i-2],center.track[i-1]),bearing(center.track[i-1],center.track[i]));
      worstMaxStepTurn=Math.max(worstMaxStepTurn,Math.abs(turn));
      const sign=Math.sign(turn);
      if(sign&&sign===lastSign)sameRun+=Math.abs(turn);else sameRun=Math.abs(turn);
      if(sign)lastSign=sign;
      worstSameSignTurn=Math.max(worstSameSignTurn,sameRun);
    }
  }
  const end=centers.map(c=>c.track[c.track.length-1]);
  const mean={lat:end.reduce((a,p)=>a+p.lat,0)/end.length,lon:end.reduce((a,p)=>a+p.lon,0)/end.length};
  const rms=Math.sqrt(end.reduce((a,p)=>a+dist(p,mean)**2,0)/end.length);
  minEndSpread=Math.min(minEndSpread,rms);
}
if(worstSameSignTurn>=155) throw new Error(`model guidance can still accumulate semicircle curvature: ${worstSameSignTurn.toFixed(1)} deg`);
if(worstMaxStepTurn>38) throw new Error(`model guidance contains an excessive node turn: ${worstMaxStepTurn.toFixed(1)} deg`);
if(minEndSpread<40) throw new Error(`curvature fix collapsed model spread: ${minEndSpread.toFixed(1)} km RMS`);
console.log('Round 51 guidance curvature regression: PASS',`maxSameSignTurn=${worstSameSignTurn.toFixed(1)}deg`,`maxNodeTurn=${worstMaxStepTurn.toFixed(1)}deg`,`minEndSpread=${minEndSpread.toFixed(1)}km RMS`);
