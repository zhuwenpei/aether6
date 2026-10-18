/** Real Round185 geometry/noise regression. Standalone TS transpilation uses local or global TS. */
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const load=(f)=>{
  const src=fs.readFileSync(path.join(__dirname,'../',f),'utf8');
  const compiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const m={exports:{}};
  vm.runInNewContext(compiled,{module:m,exports:m.exports,atob,console,Math,Uint16Array,Uint8Array,Float32Array},{timeout:30000,filename:f});
  return m.exports;
};
const terrain=load('src/simulation/EtopoTerrain.ts');
const model=load('src/simulation/PrecipitationModel.ts');
const raw=terrain.getEtopoTerrainGrid(false),clean=terrain.getEtopoTerrainGrid(true), cols=361,rows=281;
assert.equal(raw.length,cols*rows);assert.equal(clean.length,raw.length);
const median=a=>{const b=[...a].sort((x,y)=>x-y);return (b[b.length/2|0]+b[(b.length-1)/2|0])/2;};
let before=0,after=0,rawCoast=0,cleanCoast=0,coasts=0;
for(let y=1;y<rows-1;y++)for(let x=1;x<cols-1;x++){
  const i=y*cols+x,ns=[i-cols-1,i-cols,i-cols+1,i-1,i+1,i+cols-1,i+cols,i+cols+1];
  const flagged=(a)=>a[i]-median(ns.map(k=>a[k]))>1100 && ns.filter(k=>a[k]===0).length>=2;
  if(flagged(raw))before++;if(flagged(clean))after++;
  if((raw[i]===0)!==(raw[i+1]===0)){
    coasts++;const spacing=27.8*Math.max(.15,Math.cos((y*.25-10)*Math.PI/180));
    if(Math.abs(raw[i]-raw[i+1])/spacing>34)rawCoast++;
    if(Math.abs(clean[i]-clean[i+1])/spacing>34)cleanCoast++;
  }
}
assert.ok(before>700);assert.equal(after,0,'cleaned terrain must have no raw-pattern isolated peaks');
assert.ok(cleanCoast/coasts<.1,`raw-zero coastline jump ratio is ${(cleanCoast/coasts).toFixed(3)}`);
const regions=[['台湾中央山脉',21,25,120,122.5],['吕宋山脉',15,19,120,123],['日本阿尔卑斯',34,37,134,139]];
const peaks=regions.map(([label,lat1,lat2,lon1,lon2])=>{
  let old=0,now=0;
  for(let y=Math.round((lat1+10)*4);y<=Math.round((lat2+10)*4);y++)
    for(let x=Math.round((lon1-90)*4);x<=Math.round((lon2-90)*4);x++){
      const i=y*cols+x;old=Math.max(old,raw[i]);now=Math.max(now,clean[i]);
    }
  return {label,old,now,retained:+(100*now/old).toFixed(1)};
});
const noise=(seed)=>Array.from({length:900},(_,i)=>model.rainfallLatticeHash(i%30,Math.floor(i/30),2,model.rainfallNoiseSeed(seed,'TYPHOON-X')));
const noiseA=noise('101'), noiseA2=noise('101'),noiseB=noise('202');
assert.deepEqual(noiseA,noiseA2,'identical seed must be bitwise stable');
const corr=(a,b)=>{
 const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;
 let xy=0,xx=0,yy=0;for(let i=0;i<a.length;i++){const da=a[i]-ma,db=b[i]-mb;xy+=da*db;xx+=da*da;yy+=db*db;}
 return xy/Math.sqrt(xx*yy);
};
const correlation=corr(noiseA,noiseB);assert.ok(Math.abs(correlation)<.2,'different seed lattice noise must decorrelate');
const config={seed:'101'};
const state={id:'TYPHOON-X',lat:26.3,lon:122,vmax:48,pmin:958,rmw:42,simHour:20,speed:14,direction:300};
const args=[state,27,120.25,{config,isLand:true,elevation:450,terrainSlopeEast:6,terrainSlopeNorth:8,coastDistanceKm:45}];
const a=model.computeTyphoonPrecipitation(...args);
const b=model.computeTyphoonPrecipitation(...args);
assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),'same seed and inputs should repeat exactly');
const other=model.computeTyphoonPrecipitation(state,27,120.25,{...args[3],config:{seed:'202'}});
assert.notEqual(a.rate,other.rate,'different seeds should yield different precipitation');
console.log(JSON.stringify({status:'PASS',spikes:{before,after},coastalCliff:{before:rawCoast,after:cleanCoast,total:coasts,remainingRatio:+(cleanCoast/coasts).toFixed(4)},peaks,noiseCorrelation:+correlation.toFixed(4),rate:[a.rate,other.rate]},null,2));
if(peaks.some(p=>p.retained<70))console.warn('NOT ACCEPTED: mountain peak preservation >=70% fails; needs verified relief data.');
