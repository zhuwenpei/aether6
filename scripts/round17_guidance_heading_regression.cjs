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
function req(id){if(id.includes('HurricaneTrackerPort'))return{calculateHurricaneTrackerGuidanceTracks:rawGuidance};return{};}
new Function('require','module','exports',js)(req,mod,mod.exports);
const api=mod.exports;
const storm={id:'T',lat:15,lon:130,vmax:32,pmin:975,rmw:35};
const reference=Array.from({length:29},(_,i)=>{const f=i/28;return{simHour:i*6,lat:15+17*f+1.2*Math.sin(f*Math.PI),lon:130+25*f,vmax:32+14*Math.sin(Math.PI*f),pmin:975-20*Math.sin(Math.PI*f)}});

const quietRef=Array.from({length:29},(_,i)=>{const f=i/28;return{simHour:i*6,lat:17+f*.6,lon:131-7*f,vmax:40,pmin:960};});
(async()=>{
 let bestCenter=0,bestMember=0,bestSeed='';
 for(let k=0;k<10;k++){
  const seed='regime-'+k;
  const cs=api.buildAetherCenterGuidance({...storm,lat:17,lon:131,vmax:40},0,[storm],seed,quietRef,168);
  const headings=cs.map(c=>{const p=c.track.at(-1),q=c.track[c.track.length-9];return Math.atan2((p.lat-q.lat)*111,(p.lon-q.lon)*100)});
  let delta=0;for(const a of headings)for(const b of headings)delta=Math.max(delta,Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))));
  if(delta>bestCenter){bestCenter=delta;bestSeed=seed;}
  if(k===3){const ens=await api.buildAetherEnsembleMembers({storm:{...storm,lat:17,lon:131,vmax:40},currentHour:0,scene:[storm],seed,referencePath:quietRef,selectedModelIds:['ECMWF'],membersPerModel:50,horizon:168});
   const angles=ens.map(c=>{const p=c.track.at(-1),q=c.track[c.track.length-9];return Math.atan2((p.lat-q.lat)*111,(p.lon-q.lon)*100)});
   for(const a of angles)for(const b of angles)bestMember=Math.max(bestMember,Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))));
  }
 }
 if(bestCenter*180/Math.PI<12)throw Error('No meaningful model-to-model heading disagreement');
 if(bestMember*180/Math.PI<12)throw Error('No within-institution heading disagreement');
 console.log('round17_guidance_heading_regression: PASS',JSON.stringify({modelHeadingSpanDeg:+(bestCenter*180/Math.PI).toFixed(1),memberHeadingSpanDeg:+(bestMember*180/Math.PI).toFixed(1)}));
})().catch(e=>{console.error(e);process.exitCode=1});
