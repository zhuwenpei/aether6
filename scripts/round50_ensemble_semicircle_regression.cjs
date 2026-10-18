const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
for(const needle of [
  'constrainGuidanceStepToBaselineHeading',
  'referenceStepKm*.58',
  'parentStepKm*.72',
  'previous,curvatureLimited,previousGeometryReference,currentGeometryReference,referenceStepKm,22',
  'previousMember,memberCurvatureLimited,parentPrevious,cp,parentStepKm,50'
]) if(!src.includes(needle)) throw new Error(`missing semicircle guard: ${needle}`);

const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},reportDiagnostics:true,fileName:'AetherEnsembleGuidance.ts'});
const syntax=(out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
if(syntax.length) throw new Error(`transpile error: ${syntax.map(d=>d.messageText).join('; ')}`);

const names=['ICON','GFS','GFS2','GFS3','EURO','EURO2','EURO3','HMNI'];
function rawGuidance(storm,currentHour,scene,seed,reference,horizon){
  const n=Math.round(horizon/6);
  return names.map((name,k)=>({spec:{name},track:Array.from({length:n+1},(_,i)=>{
    const f=i/Math.max(1,n);
    return {
      lat:storm.lat+i*.10+(k-3.5)*.10*Math.sin(f*Math.PI*2.6),
      lon:storm.lon+i*.22+(k-3.5)*.06*Math.sin(f*Math.PI*1.7)
    };
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

function kmPerLon(lat){return 111.12*Math.max(.18,Math.cos(lat*Math.PI/180));}
function dist(a,b){return Math.hypot((b.lat-a.lat)*111.12,(b.lon-a.lon)*kmPerLon((a.lat+b.lat)*.5));}
function bearing(a,b){const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;const y=Math.sin(dl)*Math.cos(p2);const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360;}
function delta(a,b){let d=((b-a+540)%360)-180;return d===-180?180:d;}

let worstDeviation=0;
let minimumEndSpread=Infinity;
for(let seedIndex=0;seedIndex<16;seedIndex++){
  const storm={id:'T',lat:16,lon:131,vmax:45,pmin:950,rmw:28};
  const reference=[]; let lat=16,lon=131;
  for(let h=0;h<=168;h+=3){
    if(h){ const turn=Math.max(0,h-54)/114; lat+=.12+.17*turn; lon+=.32-.23*turn; }
    reference.push({simHour:h,lat,lon,vmax:45-0.08*h,pmin:950+0.25*h});
  }
  const centers=mod.exports.buildAetherCenterGuidance(storm,0,[storm],`round50-${seedIndex}`,reference,168);
  for(const center of centers){
    for(let i=1;i<center.track.length;i++){
      const refStep=dist(reference[i-1],reference[i]);
      if(refStep<.75) continue;
      worstDeviation=Math.max(worstDeviation,Math.abs(delta(
        bearing(reference[i-1],reference[i]),
        bearing(center.track[i-1],center.track[i])
      )));
    }
  }
  const end=centers.map(c=>c.track[c.track.length-1]);
  const mean={lat:end.reduce((a,p)=>a+p.lat,0)/end.length,lon:end.reduce((a,p)=>a+p.lon,0)/end.length};
  const rms=Math.sqrt(end.reduce((a,p)=>a+dist(p,mean)**2,0)/end.length);
  minimumEndSpread=Math.min(minimumEndSpread,rms);
}
if(worstDeviation>38.5) throw new Error(`centre track can still swing backward into a semicircle: ${worstDeviation.toFixed(1)} deg`);
// The anti-loop guard must not collapse the eight model centres onto the reference path.
if(minimumEndSpread<45) throw new Error(`model-centre spread collapsed while fixing semicircles: ${minimumEndSpread.toFixed(1)} km RMS`);
console.log('Round 50 ensemble semicircle regression: PASS',`maxBaselineHeadingError=${worstDeviation.toFixed(1)}deg`,`minEndSpread=${minimumEndSpread.toFixed(1)}km RMS`);
