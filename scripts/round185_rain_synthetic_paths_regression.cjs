/** Synthetic-path rainfall diagnostic (not a substitute for real Engine 25-run integration).
 * Uses the genuine PrecipitationModel, cleaned ETOPO, approximate proxy footprint.
 * Emphasizes seed dependence and fixed-location repeat rates. */
const fs=require('fs'),vm=require('vm'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const load=f=>{const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,atob,Math,console},{timeout:30000});return m.exports;};
const {getEtopoTerrainElevation}=load('src/simulation/EtopoTerrain.ts');
const {computeTyphoonPrecipitation}=load('src/simulation/PrecipitationModel.ts');
const sites=[{name:'温州近岸',lat:28.8,lon:121.1},{name:'浙闽近岸',lat:27.5,lon:120.4}];
const land=(lat,lon)=>Number(getEtopoTerrainElevation(lat,lon)??0)>0;
const rainAt=(state,lat,lon,seed)=>{
 if(!land(lat,lon))return 0;
 const d=.5, h=(la,lo)=>getEtopoTerrainElevation(la,lo)||0;
 const slopeEast=(h(lat,lon+d)-h(lat,lon-d))/(2*d*111.12*Math.max(.2,Math.cos(lat*Math.PI/180)));
 const slopeNorth=(h(lat+d,lon)-h(lat-d,lon))/(2*d*111.12);
 const val=computeTyphoonPrecipitation(state,lat,lon,{config:{seed:String(seed)},isLand:true,elevation:h(lat,lon),terrainSlopeEast:slopeEast,terrainSlopeNorth:slopeNorth,coastDistanceKm:35});
 return Number(val.rate)||0;
};
const result=[];
for(const site of sites){
 let high=0;const ratios=[];const totals=[];
 for(const targetLat of [25,27,29,31,33])for(const seed of [19,211,907,2201,5711]){
  let total=0;const ring=Array(12).fill(0);
  for(let hour=0;hour<24;hour++){
   const state={id:`RAIN-${targetLat}`,lat:targetLat-2.4+hour*.21,lon:125.2-hour*.24,
    vmax:46,pmin:955,rmw:40,simHour:hour,speed:27,direction:315,landed:false};
   total+=rainAt(state,site.lat,site.lon,seed);
   for(let a=0;a<12;a++){
    const angle=2*Math.PI*a/12,r=.75;
    ring[a]+=rainAt(state,site.lat+r*Math.sin(angle),site.lon+r*Math.cos(angle)/Math.max(.3,Math.cos(site.lat*Math.PI/180)),seed);
   }
  }
  const landRing=ring.filter(v=>v>0);if(!landRing.length)continue;
  const sorted=[...landRing].sort((a,b)=>a-b),med=(sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2;
  const ratio=total/Math.max(.01,med);ratios.push(ratio);totals.push(total);
  if(ratio>2.5)high++;
 }
 const sorted=[...ratios].sort((a,b)=>a-b);const med=sorted[Math.floor(sorted.length/2)]??0;
 result.push({site:site.name,n:ratios.length,medianRatio:+med.toFixed(3),over2_5:high,recurrence:+(high/ratios.length).toFixed(3),totalRange:[+Math.min(...totals).toFixed(1),+Math.max(...totals).toFixed(1)]});
}
console.log(JSON.stringify({method:'synthetic rainfall, ETOPO proxy footprint (not full engine)',result},null,2));
if(result.some(s=>s.medianRatio>=1.8||s.recurrence>=.35)){console.error('NOT ACCEPTED: synthetic ratio/recurrence target fails');process.exitCode=1;}
