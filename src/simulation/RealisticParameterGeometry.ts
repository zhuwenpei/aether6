/** R189: Three-hour parameter nodes; original wind circles and RMW are immutable.
 * No former multi-hour course regimes, speed-budget optimization, or future
 * velocity injection. The physical simulation history keeps its hourly clock.
 */
export type ParameterOffset = 'low' | 'mid' | 'high';
export type ParameterFix = {
  simHour:number;lat:number;lon:number;vmax:number;pmin:number;speed:number;direction:number;
  landed?:boolean;
};
export const PARAMETER_NODE_HOURS=3;
/** Public meteorological and structural readings. Counters, event times,
 * probabilistic state, accumulated damage and physical integration memories
 * are deliberately excluded: reinterpolating those corrupts model physics.
 * RMW is retained ONLY for compatibility with R188 version-2 undo journals.
 * Never resample/interpolate RMW or the r7/r10/r12 wind-circle quadrants. */
export const PARAMETER_FIELDS=[
 'vmax','pmin','speed','direction','rmw','eyeRadiusKm','eyeClearance',
 'eyewallIntegrity','eyeWarmCore','eyeAsymmetry','eyeObstruction',
 'coreCompactness','deepConvectiveCoverage','lowLevelVortexIntegrity',
 'moistureReservoir','innerCoreMoisture','moistEnvelopeIntegrity',
 'rainbandDominance','circulationExpansion','extrTransition',
 'outflowEfficiency','secondaryEyewallStrength', 'convectiveBurstIndex',
 'marineMoistureLink','northeastCloudTailStrength','warmConveyorBeltStrength'
] as const;
export const RADII_FIELDS=['r7','r10','r12'] as const;
/** Wind circles (all four quadrants) and maximum-wind radius are read-only in R189. */
export const PRESERVED_WIND_FIELDS=['rmw',...RADII_FIELDS] as const;
export const QUADRANTS=['ne','se','sw','nw'] as const;
const RAD=Math.PI/180;
const amplitudes:Record<ParameterOffset,number>={low:1.25,mid:2.7,high:4.5};
function shortestLongitude(from:number,to:number){return ((to-from+540)%360+360)%360-180;}
function interpolate(a:number,b:number,t:number,circular=false){
 return a+(circular?((b-a+540)%360+360)%360-180:b-a)*t;
}
function randomGenerator(seed:string){let v=2166136261;for(let i=0;i<seed.length;i++)v=Math.imul(v^seed.charCodeAt(i),16777619);
 return ()=>{v^=v<<13;v^=v>>>17;v^=v<<5;return (v>>>0)/4294967296;};}
function numberAt(obj:Record<string,unknown>,key:string){const value=obj[key];return typeof value==='number'&&Number.isFinite(value)?value:undefined;}
const blendField=(a:Record<string,unknown>,b:Record<string,unknown>,key:string,t:number)=>{
 const left=numberAt(a,key),right=numberAt(b,key);
 if(left===undefined||right===undefined)return undefined;
 const result=interpolate(left,right,t,key==='direction');
 return key==='direction'?(result+360)%360:result;
};
export function threeHourlyNodes<T extends ParameterFix>(history:readonly T[]):number[]{
 if(history.length<2)return history.length?[history[0].simHour]:[];
 const first=history[0].simHour,last=history[history.length-1].simHour;
 const nodes=[first];
 for(let h=first+PARAMETER_NODE_HOURS;h<last-1e-7;h+=PARAMETER_NODE_HOURS)nodes.push(h);
 if(last>first+1e-7)nodes.push(last);
 return nodes;
}
function snapshotAt<T extends ParameterFix>(history:readonly T[],hour:number,seek:{index:number}):T{
 while(seek.index+1<history.length-1&&history[seek.index+1].simHour<hour)seek.index++;
 const before=history[seek.index],after=history[Math.min(history.length-1,seek.index+1)];
 const ratio=Math.max(0,Math.min(1,(hour-before.simHour)/Math.max(1e-8,after.simHour-before.simHour)));
 const result={...(ratio>=1-1e-7?after:before),simHour:hour,lat:before.lat+(after.lat-before.lat)*ratio,
  lon:before.lon+shortestLongitude(before.lon,after.lon)*ratio} as T;
 const rec=result as Record<string,unknown>,a=before as Record<string,unknown>,b=after as Record<string,unknown>;
 // No wind-radius edits, including at fractional source hours. The final
 // hourly map keeps every original fix.rmw and fix.r7/r10/r12 exactly as saved.
 for(const key of PARAMETER_FIELDS){if(key==='rmw')continue;const value=blendField(a,b,key,ratio);if(value!==undefined)rec[key]=value;}
 return result;
}
/** Take source readings at exact three-hour times, perturb only the THREE-HOUR
 * position knots, then linearly interpolate every intervening hourly record.
 * Returns fresh objects; input history remains immutable for cancellation/undo. */
export function buildThreeHourlyParameters<T extends ParameterFix>(history:readonly T[],seed:string,
 offset:ParameterOffset='mid',isLandAt?:(lat:number,lon:number)=>boolean):T[]{
 if(history.length<3||history.some((p,i)=>![p.simHour,p.lat,p.lon,p.vmax,p.pmin,p.speed,p.direction].every(Number.isFinite)||
    (i>0&&p.simHour<=history[i-1].simHour)))throw Error('历史数据存在无效节点或时间倒序。');
 const times=threeHourlyNodes(history),cursor={index:0};
 const nodes=times.map(h=>snapshotAt(history,h,cursor));
 const rand=randomGenerator(seed+':three-hour-fixes');
 for(let k=1;k<nodes.length-1;k++){
  const cur=nodes[k],prev=nodes[k-1],next=nodes[k+1];
  // Exact generation/terminal positions and nearby coastline transitions are pinned.
  if(cur.landed!==prev.landed||cur.landed!==next.landed)continue;
  const north=(next.lat-prev.lat)*111.12;
  const east=shortestLongitude(prev.lon,next.lon)*111.12*Math.cos(cur.lat*RAD);
  const length=Math.hypot(north,east);
  if(length<.4)continue;
  const envelope=Math.min(1,length/25),km=(rand()*2-1)*amplitudes[offset]*envelope;
  const lat=cur.lat+km*east/length/111.12;
  const lon=cur.lon-km*north/length/(111.12*Math.max(.18,Math.cos(cur.lat*RAD)));
  if(Math.abs(lat)>85)continue;
  if(isLandAt&&isLandAt(lat,lon)!==isLandAt(cur.lat,cur.lon))continue;
  nodes[k]={...cur,lat,lon};
 }
 let seg=0;
 return history.map(h=>{
  while(seg+2<times.length&&h.simHour>times[seg+1]+1e-7)seg++;
  const a=nodes[seg],b=nodes[Math.min(seg+1,nodes.length-1)];
  const t=Math.max(0,Math.min(1,(h.simHour-a.simHour)/Math.max(1e-8,b.simHour-a.simHour)));
  const out={...h,lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+shortestLongitude(a.lon,b.lon)*t} as T;
  const rec=out as Record<string,unknown>,left=a as Record<string,unknown>,right=b as Record<string,unknown>;
  for(const key of PARAMETER_FIELDS){if(key==='rmw')continue;const v=blendField(left,right,key,t);if(v!==undefined)rec[key]=v;}
  // out starts with {...h}: leave rmw and all wind-circle quadrant objects
  // untouched even between three-hour parameter nodes.
  return out;
 });
}
/** Small reversible payload rather than a duplicate of weather station histories. */
export function makeParameterSnapshot(fix:ParameterFix){
 const values:Record<string,number>={};
 for(const key of PARAMETER_FIELDS){const value=numberAt(fix as unknown as Record<string,unknown>,key);if(value!==undefined)values[key]=value;}
 const radii:Record<string,Record<string,number>>={};
 for(const key of RADII_FIELDS){const r=(fix as unknown as Record<string,unknown>)[key] as Record<string,unknown>|undefined;if(!r)continue;
  const quadrants:Record<string,number>={};for(const q of QUADRANTS){const v=numberAt(r,q);if(v!==undefined)quadrants[q]=v;}
  radii[key]=quadrants;
 }
 return {simHour:fix.simHour,lat:fix.lat,lon:fix.lon,values,radii};
}
