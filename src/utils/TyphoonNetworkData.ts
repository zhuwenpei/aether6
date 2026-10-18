/**
 * Round190. Read-only 3-hour typhoon-web presentation data.
 * The track/advisories shown here are SIMULATED, not official agency forecasts.
 * No mutations are performed on the physical engine, histories or archive.
 */
import type { Typhoon, TyphoonState, SimulationConfig } from '../types';
import { getWindForceCategory, materializeForecastPath } from '../simulation/Engine';

export type NetworkFix = Pick<TyphoonState, 'lat'|'lon'|'vmax'|'pmin'|'speed'|'direction'|'rmw'|'r7'|'r10'|'r12'|'simHour'> & {
  category?: string; landed?: boolean; dissipated?: boolean;
};
export type NetworkForecast = { agency: '中国'|'日本'|'美国'|'韩国'; color: string; fixes: NetworkFix[] };
export type NetworkProduct = { history: NetworkFix[]; issue: NetworkFix; forecasts: NetworkForecast[]; maxHour: number };

const interpolate = (a:number,b:number,t:number) => a+(b-a)*t;
const angular = (a:number,b:number,t:number) => ((a + ((((b-a+540)%360)+360)%360-180)*t)%360+360)%360;
const normLon = (lon:number) => ((lon+180)%360+360)%360-180;
const interpLon = (a:number,b:number,t:number) => normLon(a+((((b-a+540)%360)+360)%360-180)*t);
export const NETWORK_FORECAST_STYLE = [
  {agency:'中国' as const, color:'#fa19da', offset:0},
  {agency:'日本' as const, color:'#a97a07', offset:1},
  {agency:'美国' as const, color:'#07b5f4', offset:2},
  {agency:'韩国' as const, color:'#05ea30', offset:3}
];

/** Interpolation is used ONLY to sample the pre-existing physical history at three-hour playback fixes. */
export function sampleNetworkFix(history: readonly NetworkFix[], hour:number): NetworkFix {
  if (!history.length) throw new Error('台风历史数据为空');
  let low=0, high=history.length-1;
  while (low<high) { const mid=(low+high)>>1; if (history[mid].simHour<hour) low=mid+1; else high=mid; }
  const right=history[low];
  const left=history[Math.max(0,low-1)];
  if (Math.abs(right.simHour-hour)<1e-6 || low===0) return {...right,simHour:right.simHour};
  if (hour>=right.simHour) return {...right,simHour:right.simHour};
  const t=Math.max(0,Math.min(1,(hour-left.simHour)/Math.max(.001,right.simHour-left.simHour)));
  const lerpRadii=(key:'r7'|'r10'|'r12')=>({ne:interpolate(left[key]?.ne??0,right[key]?.ne??0,t),se:interpolate(left[key]?.se??0,right[key]?.se??0,t),sw:interpolate(left[key]?.sw??0,right[key]?.sw??0,t),nw:interpolate(left[key]?.nw??0,right[key]?.nw??0,t)});
  return {
    ...left,simHour:hour,lat:interpolate(left.lat,right.lat,t),lon:interpLon(left.lon,right.lon,t),
    vmax:interpolate(left.vmax,right.vmax,t),pmin:interpolate(left.pmin,right.pmin,t),
    speed:interpolate(left.speed,right.speed,t),direction:angular(left.direction,right.direction,t),
    rmw:interpolate(left.rmw,right.rmw,t),r7:lerpRadii('r7'),r10:lerpRadii('r10'),r12:lerpRadii('r12')
  };
}
export function threeHourlyNetworkHistory(storm:Typhoon):NetworkFix[]{
  const valid=(storm.history||[]).filter(p=>Number.isFinite(p.simHour)&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax)).sort((a,b)=>a.simHour-b.simHour);
  if (!valid.length) return [{...storm,simHour:Number.isFinite(storm.simHour)?storm.simHour:0}];
  const first=valid[0].simHour, last=valid[valid.length-1].simHour;
  const hours=[first];
  for(let h=Math.ceil((first+1e-6)/3)*3;h<last-1e-6;h+=3){if(h>first+1e-6)hours.push(h);}
  if(last>first+1e-6)hours.push(last);
  return hours.map(h=>sampleNetworkFix(valid,h));
}
/** Official CMA public time slots in China Standard Time: 02,05,08,11,14,17,20,23.
 * This is a timestamp alignment for the SIMULATED view; it does NOT imply an official CMA advisory.
 * The returned hour never exceeds the selected/current hour or available history. */
export function previousCmaPublicHour(startDate:Date, currentHour:number, lastRecordedHour:number):number {
  const safeCurrent=Number.isFinite(currentHour)?currentHour:0;
  const safeLast=Number.isFinite(lastRecordedHour)?lastRecordedHour:safeCurrent;
  const available=Math.min(safeCurrent,safeLast);
  const beijingHours=startDate.getTime()/3600000+available+8;
  const remainder=((beijingHours-2)%3+3)%3;
  // Tiny tolerance prevents floating point rounding from moving exact 02/05/... times back by 3h.
  return available-(remainder<1e-7 || 3-remainder<1e-7 ? 0 : remainder);
}

/** Use current/prior CMA-slot positions only, including a genesis fix when already available.
 * No late terminal fix is appended between public slots. Does not change simulation history. */
export function cmaBoundedNetworkHistory(storm:Typhoon, startDate:Date, currentHour:number):NetworkFix[] {
  const valid=(storm.history||[]).filter(p=>Number.isFinite(p.simHour)&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Number.isFinite(p.vmax))
    .slice().sort((a,b)=>a.simHour-b.simHour);
  if(!valid.length){
    const sole={...storm,simHour:Number.isFinite(storm.simHour)?storm.simHour:0} as NetworkFix;
    return sole.simHour<=currentHour+1e-7?[{...sole,vmax:toCmaPublishedWindSpeed(sole.vmax)}]:[];
  }
  const first=valid[0].simHour;
  const cap=previousCmaPublicHour(startDate,currentHour,valid[valid.length-1].simHour);
  if(cap<first-1e-7){
    // Genesis can occur outside an advisory slot: show only genesis if that time is not in the future.
    return first<=currentHour+1e-7?[{...valid[0],vmax:toCmaPublishedWindSpeed(valid[0].vmax)}]:[];
  }
  const result:NetworkFix[]=[{...valid[0]}];
  const startBj=startDate.getTime()/3600000+first+8;
  const nextSlotDelta=((2-startBj)%3+3)%3;
  let h=first+(nextSlotDelta<1e-7?3:nextSlotDelta);
  for(;h<=cap+1e-7;h+=3){
    const fix=sampleNetworkFix(valid,h);
    if(fix.simHour<=currentHour+1e-7 && fix.simHour<=valid[valid.length-1].simHour+1e-7)result.push(fix);
  }
  return result.map(fix=>({...fix,vmax:toCmaPublishedWindSpeed(fix.vmax)}));
}

/** R193: color key sampled against the uploaded Petal reference (not agency colors).
 * Reference: 6-grade dots green; 8-grade dots deep blue; 10-grade orange;
 * 12/13-grade dots red; 14/15-grade pink. The highest grade is purple.
 * Only genuine weak dissipated/remnant fixes may be neutral gray; never let a
 * stale category label override an actual strong recorded wind speed. */
export const NETWORK_STRENGTH_LEGEND = [
  {min: 0, max: 17.2, color: '#00ce3a', label: '7级及以下'},
  {min: 17.2, max: 24.5, color: '#0639f5', label: '8—9级'},
  {min: 24.5, max: 32.7, color: '#ff8b12', label: '10—11级'},
  {min: 32.7, max: 41.5, color: '#ff161d', label: '12—13级'},
  {min: 41.5, max: 51, color: '#eb08dd', label: '14—15级'},
  {min: 51, max: Infinity, color: '#8320d6', label: '16级及以上'}
] as const;
export function networkPointColor(vmax:number, category?:string):string {
  if (!Number.isFinite(vmax) || vmax < 0) return '#8e8e8e';
  if (vmax < 17.2 && (category === '温带气旋'||category === '已消散'||category === '残留低压')) return '#8e8e8e';
  return NETWORK_STRENGTH_LEGEND.find(entry=>vmax>=entry.min&&vmax<entry.max)?.color||'#8e8e8e';
}

/** The only vertices of a displayed track must be the actual visible dots.
 * Forecasters compute each 3h, but visible fixes follow the CMA lead sequence:
 * unmarked intermediate 3h fixes must never bend the displayed line.
 * Render ONE independent straight segment between adjacent visible dots. */
export type NetworkSegment = { from: NetworkFix; to: NetworkFix; color: string };
export function networkHistorySegments(history: readonly NetworkFix[]): NetworkSegment[] {
  const result: NetworkSegment[] = [];
  for(let i=1;i<history.length;i++){
    result.push({from:history[i-1],to:history[i],color:networkPointColor(history[i].vmax,history[i].category)});
  }
  return result;
}
/** CMA forecast validity anchors, common to all simulated agencies.
 * CMA uses 6-hour fixes in the shorter forecast range and 12-hour fixes
 * for the extended forecast; prominent captions are shown at main reference hours.
 * Keep the computed finer 3h forecast series internal; never draw intermediate
 * visible corners between the officially styled CMA lead nodes. */
export const NETWORK_CMA_FORECAST_LEADS=[6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120] as const;
export function networkVisibleForecastFixes(forecast: NetworkForecast, issue?:NetworkFix): NetworkFix[] {
  if(!forecast.fixes.length)return [];
  const issueHour=issue?.simHour??(forecast.fixes[0].simHour-3);
  return forecast.fixes.filter(p=>NETWORK_CMA_FORECAST_LEADS.some(h=>Math.abs(p.simHour-issueHour-h)<1e-6));
}
export function networkForecastSegments(issue:NetworkFix,forecast:NetworkForecast):NetworkSegment[]{
  const visible=networkVisibleForecastFixes(forecast,issue);
  const result:NetworkSegment[]=[];
  let previous=issue;
  for (const current of visible) {
    result.push({from:previous,to:current,color:forecast.color});
    previous=current;
  }
  return result;
}
/** CMA-publication-style representative whole-m/s values seen in CMA bulletins.
 * This only discretises SIMULATED CMA-labelled network products; it never fetches
 * or claims official advisories, and never changes physical storm histories.
 * Keep a broad span for strong systems rather than rounding to a uniform 5m/s grid. */
export const CMA_PUBLIC_WIND_SPEED_LEVELS_MPS = [
  0, 5, 8, 10, 12, 15, 18, 20, 23, 25, 28, 30, 33, 35, 38, 40,
  42, 45, 48, 50, 52, 55, 58, 60, 62, 65, 68, 70, 75, 80, 85
] as const;
export function toCmaPublishedWindSpeed(vmax:number):number {
  if(!Number.isFinite(vmax))return 0;
  const speed=Math.max(0,vmax);
  if(speed>=85)return Math.round(speed/5)*5;
  // A stable upward tie-break avoids a counterintuitive weakening at midpoints.
  let best:number=CMA_PUBLIC_WIND_SPEED_LEVELS_MPS[0];
  for(const level of CMA_PUBLIC_WIND_SPEED_LEVELS_MPS){
    if(Math.abs(speed-level)<=Math.abs(speed-best))best=level;
  }
  return best;
}
export const networkWindForce = (vmax:number) => getWindForceCategory(vmax);

export function buildNetworkForecasts(issue:NetworkFix, storm:Typhoon, config?:SimulationConfig):NetworkForecast[]{
  if(!config||issue.dissipated)return [];
  const seed={...storm,...issue,history:(storm.history||[]).filter(x=>x.simHour<=issue.simHour),simHour:issue.simHour,forecastPath:[]} as Typhoon;
  const raw=materializeForecastPath(seed,config,120,undefined,false);
  const source=raw.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&Number.isFinite(x.simHour)&&x.simHour>0);
  const leadHours:Array<number>=[];
  for(let h=3;h<=120;h+=3)leadHours.push(h);
  const sampled=leadHours.filter(h=>source.some(x=>x.simHour>=h-1e-6)).map(h=> {
    const byTime=[{...issue,simHour:0},...source].sort((a,b)=>a.simHour-b.simHour) as NetworkFix[];
    return sampleNetworkFix(byTime,h);
  });
  return NETWORK_FORECAST_STYLE.map(style=>({agency:style.agency,color:style.color,fixes:sampled.map(p=>{
    const lead=p.simHour;
    // Agency-dependent, lead-time-growing *deterministic* guidance differences.
    // Forecast thermodynamics (including the entry peak aspiration) come from
    // materializeForecastPath. That physical path supplies >= 85% of intensity;
    // agency deviations depend on steering, lead time and system maturity.
    // Neither raw physical history nor the main simulator is rewritten.
    const spread=Math.min(1,Math.pow(lead/96,0.8));
    const direction=(issue.direction||0)*Math.PI/180;
    const forwardBiasKm=(style.offset-1.5)*11*spread;
    const lateralBiasKm=(style.offset-1.5)*27*spread+
      Math.sin(lead/34+style.offset*1.65)*(6+12*spread)*spread;
    const northKm=forwardBiasKm*Math.cos(direction)-lateralBiasKm*Math.sin(direction);
    const eastKm=forwardBiasKm*Math.sin(direction)+lateralBiasKm*Math.cos(direction);
    const lat=p.lat+northKm/111.2;
    const lon=normLon(p.lon+eastKm/(111.2*Math.max(.2,Math.cos(p.lat*Math.PI/180))));
    const maturity=Math.min(1,Math.max(0,(lead-6)/54));
    const agencyBias=[0,-2.0,2.7,-1.2][style.offset];
    const rawVmax=Math.max(0,0.92*p.vmax+0.08*issue.vmax+agencyBias*maturity+
      (style.offset-1.5)*Math.sin(lead/35)*1.15*spread);
    // China: public discrete CMA values. Foreign simulated agencies keep
    // their own continuous response to the same high-weight model reference.
    const vmax=style.agency==='中国'?toCmaPublishedWindSpeed(rawVmax):rawVmax;
    return {...p,lat,lon,vmax,pmin:Math.max(850,p.pmin-(vmax-p.vmax)*1.2),simHour:issue.simHour+lead};
  })}));
}
