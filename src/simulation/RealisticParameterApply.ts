/** R189: three-hour parameter-node edit; preserve original wind circles and RMW. */
import type {Typhoon,SimulationConfig} from '../types';
import {calculateStationReadings} from './Engine';
import {buildThreeHourlyParameters,makeParameterSnapshot,type ParameterOffset} from './RealisticParameterGeometry';
export interface ParameterProgress{completed:number;total:number;message:string}
export interface ParameterResult{typhoon:Typhoon;maximumOffsetKm:number;averageOffsetKm:number}
const yieldMain=()=>new Promise<void>(r=>setTimeout(r,0));
const verify=(signal?:AbortSignal)=>{if(signal?.aborted)throw Error('已取消参数真实化，原始历史未被修改。');};
export function baselineParameterHistory(ty:Typhoon):Typhoon['history']{
 const journal=ty.realisticMotion;
 if(!journal)return ty.history;
 return ty.history.map((fix,i)=>{
  const prior=journal.original[i];
  if(!prior||Math.abs(prior.simHour-fix.simHour)>1e-5)return fix;
  if(journal.version===1)return {...fix,...prior};
  const current=prior as Extract<typeof journal,{version:2}>['original'][number];
  const rebuilt:Record<string,unknown>={...fix,...current.values,lat:current.lat,lon:current.lon};
  for(const [key,radius] of Object.entries(current.radii))rebuilt[key]={...(fix as unknown as Record<string,unknown>)[key] as object,...radius};
  return rebuilt as unknown as typeof fix;
 });
}
const clearIssues=<T extends Typhoon['history'][number]>(h:T):T=>({...h,forecastPath:[],preSimulationReference:undefined,preSimulationReferenceCleared:undefined});
async function rebuildStations(history:Typhoon['history'],config:SimulationConfig,
 onProgress?:(p:ParameterProgress)=>void,signal?:AbortSignal){
 let previous:Typhoon['stationReadings']=undefined;
 for(let i=0;i<history.length;i++){
  verify(signal);const h=history[i];
  const station=calculateStationReadings(h.lat,h.lon,h.vmax,h.pmin,h.rmw,h.r7,h.r10,h.r12,
   previous,h.casualties??0,h.eyeRadiusKm,h.eyeClearance,{...h,config});
  history[i]={...h,stationReadings:station};previous=station;
  if(i%12===0||i===history.length-1){onProgress?.({completed:i+1,total:history.length,message:'正在重新计算逐小时气象站诊断'});await yieldMain();}
 }
}
export async function prepareRealisticParameters(ty:Typhoon,config:SimulationConfig,
 offset:ParameterOffset,seed:string,onProgress?:(p:ParameterProgress)=>void,signal?:AbortSignal,
 isLandAt?:(lat:number,lon:number)=>boolean):Promise<ParameterResult>{
 verify(signal);const baseline=baselineParameterHistory(ty);
 if(baseline.length<7||baseline.at(-1)!.simHour-baseline[0].simHour<6)throw Error('至少需要 6 小时的台风历史。');
 const edited=buildThreeHourlyParameters(baseline,seed,offset,isLandAt).map(clearIssues);
 await rebuildStations(edited,config,onProgress,signal);verify(signal);
 const original=baseline.map(makeParameterSnapshot);
 const km=edited.map((p,i)=>Math.hypot((p.lat-baseline[i].lat)*111.12,
   (((p.lon-baseline[i].lon+540)%360+360)%360-180)*111.12*Math.cos(p.lat*Math.PI/180)));
 const tail=edited.at(-1)!;
 // Normally preserve the cyclone's live wind circles exactly as they were before
 // applying this action, even if playback state differs from the last snapshot.
 // An earlier R188 journal may already contain modified radii: when reapplying,
 // restore the ORIGINAL unmodified radii from that journal instead.
 const originalWind=ty.realisticMotion ? baseline.at(-1)! : ty;
 return {typhoon:{...ty,history:edited,lat:tail.lat,lon:tail.lon,vmax:tail.vmax,pmin:tail.pmin,
  speed:tail.speed,direction:tail.direction,
  rmw:originalWind.rmw??tail.rmw,r7:originalWind.r7??tail.r7,
  r10:originalWind.r10??tail.r10,r12:originalWind.r12??tail.r12,
  stationReadings:tail.stationReadings,
  realisticMotion:{version:2,seed,strength:offset,original},
  historyRevision:(ty.historyRevision??0)+1,forecastPath:[],preSimulationReference:undefined},
  maximumOffsetKm:Math.max(...km),averageOffsetKm:km.reduce((x,y)=>x+y,0)/km.length};
}
export async function undoRealisticParameters(ty:Typhoon,config:SimulationConfig,
 onProgress?:(p:ParameterProgress)=>void,signal?:AbortSignal):Promise<Typhoon>{
 if(!ty.realisticMotion)throw Error('没有可撤销的参数真实化记录。');
 const history=baselineParameterHistory(ty).map(clearIssues);
 await rebuildStations(history,config,onProgress,signal);verify(signal);
 const last=history.at(-1)!;
 return {...ty,history,lat:last.lat,lon:last.lon,vmax:last.vmax,pmin:last.pmin,
   speed:last.speed,direction:last.direction,rmw:last.rmw,r7:last.r7,r10:last.r10,r12:last.r12,
   stationReadings:last.stationReadings,realisticMotion:undefined,
   historyRevision:(ty.historyRevision??0)+1,forecastPath:[],preSimulationReference:undefined};
}
