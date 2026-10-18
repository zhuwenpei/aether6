/**
 * Low-resolution, time-evolved convective tracer for on-demand synthetic satellite products.
 * Moisture and updraft energy are semi-Lagrangian advected around the analysed vortex and
 * forced by moisture supply, radial convergence, shear, dry intrusion and land/orography.
 * This is a parameterized cloud model, NOT numerical weather prediction or real observations.
 * The resolved tracer is shared by all pixels of one product; no per-pixel random blobs,
 * frozen landfall fragments or stationary convective tiles are generated.
 */
import type { Typhoon } from "../types";
const limit = (v: number, lo=0, hi=1) => Math.max(lo, Math.min(hi,v));
const N=60, CELLS=N*N, EXTENT=1.08;
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;};
const rnd=(x:number,y:number,s:number)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^s;h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
function noise(x:number,y:number,seed:number){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);const a=rnd(ix,iy,seed),b=rnd(ix+1,iy,seed),c=rnd(ix,iy+1,seed),d=rnd(ix+1,iy+1,seed);return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}
const bearing=(deg:number)=>((deg-90)*Math.PI/180);
const sector=(angle:number,reference:number)=>0.5+0.5*Math.cos(Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference)));
const idx=(x:number,y:number)=>y*N+x;
function bilinear(arr:Float32Array,x:number,y:number){
 const gx=limit((x/EXTENT+1)*0.5*(N-1),0,N-1.001),gy=limit((y/EXTENT+1)*0.5*(N-1),0,N-1.001);
 const i=Math.floor(gx),j=Math.floor(gy),u=gx-i,v=gy-j;
 const a=arr[idx(i,j)],b=arr[idx(i+1,j)],c=arr[idx(i,j+1)],d=arr[idx(i+1,j+1)];
 return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}
export interface ConvectiveField { moisture:Float32Array; updraft:Float32Array; hour:number; }
const CACHE=new Map<string,ConvectiveField>();
/** One deterministic, bounded integration per output time / storm snapshot, not per image pixel. */
export function getConvectiveField(storm:Partial<Typhoon>,hour:number,seed:string):ConvectiveField {
 const n=(v:unknown)=>Number(v)||0;
 const key=[seed,storm.id,Math.round(hour*2)/2,n(storm.vmax).toFixed(1),n(storm.lat).toFixed(2),n(storm.lon).toFixed(2),
  n(storm.broadMoisturePlatform).toFixed(2),n(storm.moistureReservoir).toFixed(2),
  n(storm.innerCoreMoisture).toFixed(2),n(storm.rainbandDominance).toFixed(2),n(storm.dryAirIntrusion).toFixed(2),
  n(storm.dryAirCoreExposure).toFixed(2),n(storm.shear).toFixed(1),n(storm.shearDir).toFixed(0),
  n(storm.landHours).toFixed(1),n(storm.terrainCoreLandFraction).toFixed(2),n(storm.terrainBlockingMemory).toFixed(2),
  n(storm.terrainInteractionBearingDeg).toFixed(0),n(storm.drySlotBearingDeg).toFixed(0),n(storm.convectiveBurstIndex).toFixed(2)].join('|');
 const cached=CACHE.get(key);if(cached)return cached;
 const stableSeed=hash(`${seed}|${storm.id||'storm'}|convection`);
 const land=limit(Math.max(n(storm.terrainCoreLandFraction),storm.landed?0.30:0)+0.45*n(storm.terrainBlockingMemory));
 const dry=limit(0.4*n(storm.dryAirIntrusion)+0.6*n(storm.dryAirCoreExposure));
 const moist=limit(.44*(n(storm.broadMoisturePlatform)||.55)+
   .39*(n(storm.moistureReservoir)||.55)+.17*(n(storm.innerCoreMoisture)||.55));
 const activity=limit(n(storm.rainbandDominance)||0.55);
 const burst=limit(n(storm.convectiveBurstIndex));
 const shear=limit(n(storm.shear)/38),shearRad=bearing(n(storm.shearDir)||270);
 const terrainRad=bearing(n(storm.terrainInteractionBearingDeg)||225),dryRad=bearing(n(storm.drySlotBearingDeg)||270);
 const dt=0.75,steps=12;
 let humidity=new Float32Array(CELLS),energy=new Float32Array(CELLS);
 const start=hour-steps*dt;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  const x=(i/(N-1)*2-1)*EXTENT,y=(j/(N-1)*2-1)*EXTENT,r=Math.hypot(x,y);
  // Seed an evolving scalar field, not static ellipses or predetermined convective-cell positions.
  const a=noise(x*7+start*.095,y*7-start*.071,stableSeed+7);
  const b=noise(x*17-start*.17,y*17+start*.125,stableSeed+19);
  humidity[idx(i,j)]=limit(moist*.75+.22*a+.12*b-.12*r);
  energy[idx(i,j)]=limit(.16+.25*a+.18*b+.19*activity-.10*r);
 }
 for(let step=0;step<steps;step++){
  const nextHumidity=new Float32Array(CELLS),nextEnergy=new Float32Array(CELLS);
  const t=start+step*dt;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   const x=(i/(N-1)*2-1)*EXTENT,y=(j/(N-1)*2-1)*EXTENT,r=Math.hypot(x,y),theta=Math.atan2(y,x);
   const terrainSide=sector(theta,terrainRad),drySide=sector(theta,dryRad);
   // Angular advection speeds decrease with radius; radial inflow increases where vortex
   // convergence and moist convection persist. Shear displaces the moist field downshear.
   const angular=(0.14+0.16*Math.exp(-r*3))*(storm.lat!==undefined&&storm.lat<0?-1:1);
   const inflow=(.012+.014*activity)*Math.exp(-r*1.8);
   const vx=-angular*y-inflow*x/(r+.03)+shear*.014*Math.cos(shearRad)+land*.014*Math.cos(terrainRad+Math.PI);
   const vy=angular*x-inflow*y/(r+.03)+shear*.014*Math.sin(shearRad)+land*.014*Math.sin(terrainRad+Math.PI);
   const hx=bilinear(humidity,x-vx*dt,y-vy*dt),ex=bilinear(energy,x-vx*dt,y-vy*dt);
   // Dry intrusions advect with the flow, while orographic enhancement can sustain outer
   // rainbands even as friction destroys the eyewall and the central moisture reservoir.
   const bandRegion=limit((r-.10)/.18)*limit((1.08-r)/.25);
   const inner=Math.exp(-Math.pow(r/.24,2));
   const terrainUplift=land*terrainSide*bandRegion*(.17+.15*moist);
   const drying=dry*drySide*(.045+.065*limit((r-.12)/.30))+land*inner*.085;
   const supply=(.20+.55*moist)*bandRegion*.044+terrainUplift*.10;
   const h=limit(hx+dt*(supply-drying-.035*ex+.026*(moist-hx)));
   const forcing=(.055+.085*activity)*h*bandRegion + .12*terrainUplift + .06*burst*h*Math.exp(-Math.pow((r-.19)/.13,2));
   const decay=(.055+.05*dry*drySide+.12*land*inner)*ex;
   const stochastic=noise(x*11+t*.08,y*11-t*.065,stableSeed+41);
   const e=limit(ex+dt*(forcing-decay+.027*(stochastic-.5)*bandRegion));
   nextHumidity[idx(i,j)]=h;nextEnergy[idx(i,j)]=e;
  }
  humidity=nextHumidity;energy=nextEnergy;
 }
 const result={moisture:humidity,updraft:energy,hour};CACHE.set(key,result);
 while(CACHE.size>8)CACHE.delete(CACHE.keys().next().value!);
 return result;
}
export function sampleConvectiveField(field:ConvectiveField,x:number,y:number){
 return {moisture:bilinear(field.moisture,x,y),updraft:bilinear(field.updraft,x,y)};
}
