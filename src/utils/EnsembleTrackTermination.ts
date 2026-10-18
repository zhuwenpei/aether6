import type { AetherGuidanceMember, AetherGuidancePoint } from "../simulation/AetherEnsembleGuidance";
export type EnsembleTrackEndMode = "operational" | "residual";
type TrackId = {id?:string;modelId?:string;memberNumber?:number};
export function stableResidualHash01(track: Partial<TrackId>,salt="current|post5"):number {
  const key=`${track.id||""}|${track.modelId||""}|${track.memberNumber??0}|${salt}`;
  let h=2166136261>>>0;
  for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;
  return (h>>>0)/4294967295;
}
/** Matches the two pre-existing ensemble termination policies, including interpolation of residual cutoff. */
export function terminateEnsembleTrack(track:readonly AetherGuidancePoint[], horizon:number,
  mode:EnsembleTrackEndMode="operational",identity:Partial<TrackId>={},salt="current"):AetherGuidancePoint[]{
  const valid=track.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&
    (Number.isFinite(p.leadHour)?p.leadHour:p.simHour)<=horizon+1e-6);
  if(valid.length<2)return [...valid];
  if(mode==="operational"){
    const i=valid.findIndex((p,j)=>j>0&&(p.vmax<15||(p as any).terminated===true));
    return i<0?[...valid]:valid.slice(0,i+1);
  }
  const i=valid.findIndex((p,j)=>j>0&&p.vmax<=5);
  if(i<0)return [...valid];
  const lead=(p:AetherGuidancePoint)=>Number.isFinite(p.leadHour)?p.leadHour:p.simHour;
  const cutoff=Math.min(horizon,lead(valid[i])+14+10*stableResidualHash01(identity,`${salt}|post5`));
  const result:AetherGuidancePoint[]=[];
  for(const p of valid){
    if(lead(p)<=cutoff+1e-6){result.push(p);continue;}
    const prev=result.at(-1);
    if(prev&&cutoff>lead(prev)+1e-6){
      const t=Math.max(0,Math.min(1,(cutoff-lead(prev))/(lead(p)-lead(prev))));
      const mix=(a:number,b:number)=>a+(b-a)*t;
      result.push({...p,lat:mix(prev.lat,p.lat),lon:mix(prev.lon,p.lon),vmax:mix(prev.vmax,p.vmax),
        pmin:mix(prev.pmin,p.pmin),speed:Number.isFinite(prev.speed)&&Number.isFinite(p.speed)?mix(prev.speed,p.speed):p.speed,
        leadHour:cutoff,simHour:cutoff});
    }
    break;
  }
  return result.length?result:[valid[0]];
}
