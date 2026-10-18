/** Round158: an issue-hour-specific branch forecast. Never mutate the authoritative simulation. */
import type { Typhoon, TyphoonState, TyphoonCategory } from '../types';

export type PreSimulationFix = {
  leadHour: number;
  lat: number; lon: number; vmax: number; pmin: number;
  direction: number; speed: number; rmw: number;
  r7: TyphoonState['r7']; r10: TyphoonState['r10']; r12: TyphoonState['r12'];
  category: TyphoonCategory; landed: boolean; dissipated: boolean;
  lowLevelVortexIntegrity?: number; extrTransition?: number;
  eyeType?: TyphoonState['eyeType']; eyePhase?: TyphoonState['eyePhase'];
  ewrcState?: TyphoonState['ewrcState']; ewrcProgress?: number;
  dryAirIntrusion?: number; moistureReservoir?: number; shear?: number;
  isStructureDamaged?: boolean; structuralDamageHours?: number;
  warmWaterHoursAfterSea?: number;
};
export type PreSimulationReference = {
  version: 1;
  stormId: string;
  issueHour: number;
  authority: number;
  /** Exact already-executed main timeline, not a forecast sandbox hypothesis. */
  origin?: 'main-history';
  completedLeadHour: number;
  fixes: PreSimulationFix[];
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const copyRadii = (r: TyphoonState['r7']) => ({ne:r.ne,se:r.se,sw:r.sw,nw:r.nw});
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

/** The latest confirmed branch applies forward in authoritative simulation time.
 * A newer issue supersedes older branches. A branch can only guide the portion
 * it actually simulated; once its last fix is passed, normal forecasting resumes.
 * Historical playback is time-local, never reads a future branch.
 */
export function issuePreSimulationReference(storm: Typhoon, hour: number): PreSimulationReference | undefined {
  if (!Number.isFinite(hour)) return undefined;
  const candidates:PreSimulationReference[]=[];
  const own=storm.preSimulationReference;
  if(own)candidates.push(own);
  for(const state of storm.history||[]){
    if(state.simHour>hour+1e-5)break;
    if(state.preSimulationReference)candidates.push(state.preSimulationReference);
  }
  // A route redraw or explicit Clear stores a historical cancellation marker.
  // It invalidates earlier guidance in the future only; playback before the
  // marker still sees its original reference. A newer approved branch wins.
  let latestClear=-Infinity;
  for(const state of storm.history||[]){
    if(state.simHour>hour+1e-5)break;
    if(state.preSimulationReferenceCleared===true)
      latestClear=Math.max(latestClear,state.simHour);
  }
  const issued=candidates.filter(ref=>ref.version===1 && ref.stormId===storm.id &&
    ref.issueHour<=hour+1e-5 && ref.issueHour>=latestClear-1e-5 && ref.fixes.length>1 &&
    // Same-hour cancellation wins unless a fresh branch was explicitly approved
    // after it, in which case its history record clears the cancellation flag.
    !(Math.abs(ref.issueHour-latestClear)<1e-5 &&
      (storm.history||[]).some(h=>Math.abs(h.simHour-latestClear)<1e-5 && h.preSimulationReferenceCleared===true)));
  issued.sort((a,b)=>b.issueHour-a.issueHour);
  // A newer branch supersedes its predecessor permanently, even if that
  // newer branch has since run out of recorded future hours. Never revive
  // an older trajectory after the user explicitly replaced it.
  const latest=issued[0];
  // A slower real storm may still occupy the geographically simulated branch
  // after the sandbox clock has expired. Keep a bounded reissue window here;
  // rebasePreSimulationReference then checks the REAL storm location, so stale
  // or remote tracks still cannot influence a forecast.
  const extra=latest ? Math.min(48,Math.max(12,latest.completedLeadHour*.5)) : 0;
  return latest && latest.completedLeadHour+extra>=hour-latest.issueHour-1e-5 ? latest : undefined;
}

/** Reissue a branch at the cyclone's actual LOCATION, not at the old clock
 * index. A faster/slower cyclone can already be farther ahead/behind on the
 * reference polyline. Restarting it at the reference's old issue-hour position
 * causes a visibly backwards (or forwards) corrective teleport.
 *
 * Reject remote/stale branches rather than steering across hundreds of km of
 * coastline. Reanchor small cross-track differences smoothly without shifting
 * the geographically simulated future landfall as a rigid unit.
 */
export function rebasePreSimulationReference(ref:PreSimulationReference, hour:number, current:{lat:number;lon:number}):PreSimulationReference | undefined {
  const timeLead=Math.max(0,hour-ref.issueHour);
  if(!ref.fixes?.length || !Number.isFinite(current.lat) || !Number.isFinite(current.lon))return undefined;
  const near=preSimulationFixNearPosition(ref,current,timeLead);
  const phaseTolerance=Math.min(48,Math.max(24,ref.completedLeadHour*.5));
  if(!near || Math.abs(near.leadHour-timeLead)>phaseTolerance || trackDistanceKm(near,current)>180)return undefined;
  const latOffset=current.lat-near.lat;
  const lonOffset=((current.lon-near.lon+540)%360)-180;
  const fixes:PreSimulationFix[]=[{...near,leadHour:0,lat:current.lat,lon:current.lon}];
  let travelled=0;
  let previous=near;
  for(const f of ref.fixes){
    if(f.leadHour<=near.leadHour+1e-5)continue;
    travelled+=trackDistanceKm(previous,f);
    previous=f;
    const taper=Math.pow(Math.max(0,1-travelled/400),2);
    fixes.push({...f,leadHour:f.leadHour-near.leadHour,
      lat:clamp(f.lat+latOffset*taper,-85,85),lon:f.lon+lonOffset*taper});
  }
  if(fixes.length<2)return undefined;
  return {...ref,issueHour:hour,completedLeadHour:fixes[fixes.length-1].leadHour,fixes};
}

const trackDistanceKm=(a:{lat:number;lon:number},b:{lat:number;lon:number})=>{
  const dy=(b.lat-a.lat)*111.12;
  const dx=(((b.lon-a.lon+540)%360)-180)*111.12*Math.max(.1,Math.cos((a.lat+b.lat)*Math.PI/360));
  return Math.hypot(dx,dy);
};

/** Preserve 3-hour operational wind-circle snapshots; do not fabricate future analyses. */
export function buildPreSimulationReference(storm: Typhoon, issueHour: number, origin?: 'main-history'): PreSimulationReference {
  if(!Number.isFinite(issueHour)) throw new Error('无效预报起报时刻');
  const source = [...(storm.history||[])].filter(s=>s.simHour>=issueHour-1e-5).sort((a,b)=>a.simHour-b.simHour);
  const fixes:PreSimulationFix[]=[];
  for(const s of source){
    const lead = s.simHour-issueHour;
    // Issue 0h and published 1-hour records; never interpolate radii between their issuance hours.
    if(lead < -1e-5 || Math.abs(lead-Math.round(lead))>1e-4)continue;
    if(![s.lat,s.lon,s.vmax,s.pmin,s.speed].every(finite))continue;
    fixes.push({leadHour:Math.round(lead),lat:s.lat,lon:s.lon,vmax:s.vmax,pmin:s.pmin,
      direction:s.direction,speed:s.speed,rmw:s.rmw,
      r7:copyRadii(s.r7),r10:copyRadii(s.r10),r12:copyRadii(s.r12),
      category:s.category,landed:s.landed,dissipated:s.dissipated,
      lowLevelVortexIntegrity:s.lowLevelVortexIntegrity,extrTransition:s.extrTransition,
      eyeType:s.eyeType,eyePhase:s.eyePhase,ewrcState:s.ewrcState,ewrcProgress:s.ewrcProgress,
      dryAirIntrusion:s.dryAirIntrusion,moistureReservoir:s.moistureReservoir,shear:s.shear,
      isStructureDamaged:s.isStructureDamaged,structuralDamageHours:s.structuralDamageHours,
      warmWaterHoursAfterSea:s.warmWaterHoursAfterSea});
  }
  if(fixes.length<2 || fixes[0].leadHour!==0 || fixes[fixes.length-1].leadHour<1)
    throw new Error('至少运行一个完整模拟小时才能作为预报参考');
  return {version:1,stormId:storm.id,issueHour,authority:0.995,
    ...(origin?{origin}:{}),completedLeadHour:fixes[fixes.length-1].leadHour,fixes};
}

/** Round179: after a full main-simulation run, copy the WHOLE observed
 * timeline, independent of the UI's current playback cursor. A reference
 * issued at the cursor (e.g. +179h) cannot serve a chart for +24h, and it
 * discards observations that were already recorded before that cursor.
 *
 * Replacing guidance also removes obsolete per-hour issuance/cancellation
 * markers and cached speculative geometry, which would otherwise override
 * the single, authoritative historical reference on later playback frames.
 * No actual observation or core physical state is changed.
 */
export function copyMainHistoryToForecast(storm:Typhoon):Typhoon {
  const first=storm.history?.[0];
  if(!first)throw new Error('尚无可复制的主模拟历史');
  const reference=buildPreSimulationReference(storm,first.simHour,'main-history');
  const history=storm.history.map((h,i)=>{
    const {preSimulationReference:_previous,preSimulationReferenceCleared:_cancelled,
      forecastPath:_speculative,...actual}=h;
    return i===0 ? {...actual,forecastPath:[],preSimulationReference:reference,
      preSimulationReferenceCleared:false} : {...actual,forecastPath:[]};
  });
  return {...storm,history,preSimulationReference:reference,forecastPath:[]};
}

export function preSimulationFixAt(ref:PreSimulationReference, lead:number):PreSimulationFix|undefined {
  if(!ref?.fixes?.length || lead<0 || lead>ref.completedLeadHour+1e-5)return undefined;
  const fixes=ref.fixes;
  let lo=0,hi=fixes.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(fixes[mid].leadHour<lead)lo=mid+1;else hi=mid;}
  const b=fixes[lo],a=fixes[Math.max(0,lo-1)];
  if(!a || a===b || Math.abs(b.leadHour-lead)<1e-5)return b;
  const t=clamp((lead-a.leadHour)/(b.leadHour-a.leadHour),0,1);
  const mix=(k:keyof Pick<PreSimulationFix,'lat'|'lon'|'vmax'|'pmin'|'direction'|'speed'|'rmw'>)=>{
    if(k==='direction') {const diff=((b[k]-a[k]+540)%360)-180;return (a[k]+diff*t+360)%360;}
    if(k==='lon'){const diff=((b[k]-a[k]+540)%360)-180;return a[k]+diff*t;}
    return a[k]*(1-t)+b[k]*t;
  };
  // Size is held to the last issued wind-circle analysis, not interpolated continuously.
  return {...(t<1?a:b),leadHour:lead,lat:mix('lat'),lon:mix('lon'),vmax:mix('vmax'),
    pmin:mix('pmin'),direction:mix('direction'),speed:mix('speed'),rmw:mix('rmw')};
}

/** Round177: a timeline explicitly copied from the *completed main simulation*
 * is already an observation. Re-running a second deterministic solver and then
 * projecting its travelled distance onto this route is a category mistake: it
 * can create a phantom isolated RI spike even when the actual archived maximum
 * is much lower. Replay the recorded fixes at their exact issuance-relative
 * hours; interpolate only between two existing neighbouring observations.
 *
 * Normal sandbox guidance deliberately does NOT take this shortcut. It still
 * blends with the live physical solver and can respond to new interventions.
 * A copied main history is used only while the issued cyclone still matches
 * the archived state; edited/repositioned storms fall back to normal physics.
 */
export function mainHistoryForecastFixes(
  ref:PreSimulationReference, issueHour:number,
  issue:{lat:number;lon:number;vmax:number}, maxHours=120
): PreSimulationFix[] | undefined {
  if(ref?.origin!=='main-history' || !Number.isFinite(issueHour) || !Number.isFinite(maxHours))return undefined;
  const offset=issueHour-ref.issueHour;
  const start=preSimulationFixAt(ref,offset);
  if(!start || offset<0 || ref.completedLeadHour-offset<1-1e-5 ||
    trackDistanceKm(start,issue)>15 || Math.abs(start.vmax-issue.vmax)>1.5)return undefined;
  const last=Math.min(Math.max(0,maxHours),ref.completedLeadHour-offset);
  const fixes:PreSimulationFix[]=[];
  for(let lead=0;lead<=last+1e-5;lead++){
    const observation=preSimulationFixAt(ref,offset+lead);
    if(!observation)break;
    fixes.push({...observation,leadHour:lead});
    if(observation.dissipated)break;
  }
  // Retain an irregular final observed hour rather than fabricate any future.
  if(fixes.length && !fixes[fixes.length-1].dissipated && last>fixes[fixes.length-1].leadHour+1e-5){
    const end=preSimulationFixAt(ref,offset+last);
    if(end)fixes.push({...end,leadHour:last});
  }
  return fixes.length>=2?fixes:undefined;
}

/** Match a simulated intensity/structure fix to a MAP LOCATION, never to the
 * forecast point's time index. Project onto the reference polyline (including
 * intermediate 1-hour fixes), with a weak ordered-branch tie-break for loopbacks.
 * No extrapolation beyond the physically simulated portion of the branch.
 */
export function preSimulationFixNearPosition(
  ref:PreSimulationReference, position:{lat:number;lon:number}, nearLead?:number
):PreSimulationFix|undefined {
  if(!ref?.fixes?.length)return undefined;
  const fixes=ref.fixes;
  if(fixes.length===1)return {...fixes[0]};
  let bestLead=fixes[0].leadHour, bestScore=Infinity;
  for(let i=1;i<fixes.length;i++){
    const a=fixes[i-1],b=fixes[i];
    const latitude=(a.lat+b.lat+position.lat)/3;
    const kmLon=111.12*Math.max(.1,Math.cos(latitude*Math.PI/180));
    const x=(((b.lon-a.lon+540)%360)-180)*kmLon;
    const y=(b.lat-a.lat)*111.12;
    const px=(((position.lon-a.lon+540)%360)-180)*kmLon;
    const py=(position.lat-a.lat)*111.12;
    const t=clamp((px*x+py*y)/Math.max(1e-8,x*x+y*y),0,1);
    const lead=a.leadHour+(b.leadHour-a.leadHour)*t;
    const distanceSquared=(px-x*t)**2+(py-y*t)**2;
    // Only disambiguate genuinely overlapping track segments: 0.3 km / hour.
    const tieBreak=Number.isFinite(nearLead)?Math.pow((lead-nearLead!)*.3,2):0;
    const score=distanceSquared+tieBreak;
    if(score<bestScore){bestScore=score;bestLead=lead;}
  }
  return preSimulationFixAt(ref,bestLead);
}

/** Preserve terminal cyclone type, but diagnose tropical intensity from the wind
 * actually shown on the same map node (including the ordinary-path handoff). */
function categoryForWind(vmax:number,original:TyphoonCategory):TyphoonCategory {
  if(!Number.isFinite(vmax) || original===('温带气旋' as TyphoonCategory) ||
    original===('残留低压' as TyphoonCategory) || original===('已消散' as TyphoonCategory))return original;
  return (vmax>=51?'超强台风':vmax>=41.5?'强台风'
    :vmax>=32.7?'台风':vmax>=24.5?'强热带风暴'
    :vmax>=17.2?'热带风暴':'热带低压') as TyphoonCategory;
}

/** Sample actual, already-simulated fixes by arc length. This is a spatial
 * parametrization, not a request for observations beyond the sandbox horizon.
 */
function sampleReferenceDistance(ref:PreSimulationReference, cumulative:number[], km:number):PreSimulationFix {
  const fixes=ref.fixes;
  if(km<=0)return {...fixes[0]};
  const end=cumulative[cumulative.length-1];
  if(km>=end)return {...fixes[fixes.length-1]};
  let i=1;
  while(i<cumulative.length-1 && cumulative[i]<km)i++;
  const a=fixes[i-1],b=fixes[i];
  const t=clamp((km-cumulative[i-1])/Math.max(1e-7,cumulative[i]-cumulative[i-1]),0,1);
  return preSimulationFixAt(ref,a.leadHour+(b.leadHour-a.leadHour)*t)!;
}

/** Guard the DISPLAYED displacement as well as the internal phase step.
 * Otherwise even a small lateral bias can add 5-15 km to a 120 km/h
 * capped along-track step and draw an unrealistic one-node jump.
 */
function capGuidedStep(previous:{lat:number;lon:number}|undefined,target:{lat:number;lon:number},dt:number){
  if(!previous)return target;
  const travelled=trackDistanceKm(previous,target);
  const allowance=120*Math.max(.00001,dt);
  if(travelled<=allowance)return target;
  const f=allowance/Math.max(1e-8,travelled);
  return {lat:previous.lat+(target.lat-previous.lat)*f,
    lon:previous.lon+(((target.lon-previous.lon+540)%360)-180)*f};
}

/** Pre-simulation geometry is a high-confidence ROUTE, not a timetable.
 * Advance monotonically by the ordinary forecast's physically computed travel
 * distance, so speed differences appear as coherent along-track phase offsets.
 * Wind, pressure and structure are associated with the spatial fix reached.
 * After the last measured spatial fix, preserve the ordinary model's subsequent
 * displacement increments from that junction. Never fade the centre back to
 * the unshifted ordinary or time-indexed pre-simulation track.
 *
 * Intensity is a strong spatial observation blended with the thermodynamic
 * solver and subject to independent coastline, realistic rate and plateau guards. The branch can authorize genuine
 * coast/RI changes it actually simulated, but blending cannot manufacture a
 * stronger landfall or an unobserved explosive wind increase.
 */
export function blendPreSimulationForecast<T extends {lat:number;lon:number;vmax:number;pmin:number;simHour:number;speed:number;category:TyphoonCategory;landed?:boolean}>(
    base:T[],ref:PreSimulationReference,maxHours=120,
    options?:{isLandAt?:(lat:number,lon:number)=>boolean|undefined; intensityPolicy?:'adaptive'|'round164';
      liveIssue?:{forcedDryAir?:string;forcedShear?:number;dryAirCoreExposure?:number;dryAirIntrusion?:number;
        dryAirPenaltyHours?:number;shearPenaltyHours?:number;isStructureDamaged?:boolean;dryAirRecoveryHours?:number}}):T[]{
  if(!ref?.fixes?.length || ref.fixes.length<2 || !base.length)return base;
  const route=ref.fixes;
  const cumulative=[0];
  for(let i=1;i<route.length;i++)cumulative.push(cumulative[i-1]+trackDistanceKm(route[i-1],route[i]));
  const total=cumulative[cumulative.length-1];
  if(total<1e-5)return base;
  // An approved sandbox is a meaningful spatial intensity constraint, not merely
  // a cosmetic route overlay. The normal physical forecast can still stay above
  // it on an early peak, and the land/RI continuity guards run AFTER blending.
  const legacyRound164=options?.intensityPolicy==='round164';
  // Genesis-specific uncertainty is a choice of NMC drawing mode ONLY.
  // Ordinary/JMA/JTWC/ensemble forecasts keep their normal physical blend.
  const intensityWeight=legacyRound164?clamp(ref.authority,0,.9995):clamp(ref.authority*.82,0,.82);
  // The currently simulated vortex and its user interventions supersede an
  // older sandbox trajectory. A core dry-air or severe-shear event imposed AFTER
  // the sandbox was recorded must not be undone by a high reference weight.
  const issue=options?.liveIssue;
  const issuedCore=issue?.forcedDryAir==='core';
  const issuedShear=Number(issue?.forcedShear||0)>=25;
  const issuedCoreDry=Number(issue?.dryAirCoreExposure||0)>=.43;
  const newDryIntrusion=Math.max(0,Number(issue?.dryAirIntrusion||0)-Number(route[0].dryAirIntrusion||0));
  const severeIssue=issuedCore||issuedShear||issuedCoreDry||newDryIntrusion>=.42;
  const issueStressHours=Math.max(18,Number(issue?.dryAirPenaltyHours||0)+12,
    Number(issue?.shearPenaltyHours||0)+12, issuedCore?30:0, issuedShear?25:0, issuedCoreDry?22:0);
  const stressAt=(lead:number)=> severeIssue
    ?clamp((issueStressHours+9-lead)/9,0,1):0;
  const last=route[route.length-1];
  // Remember the GEOGRAPHICAL onset of the first clear weakening after the
  // branch maximum. A physically stronger deterministic storm may attain that
  // maximum early and remain at a plateau until the branch's actual weakening
  // area; an old hourly intensity index must not force a dip/rebound first.
  const peakWind=Math.max(...route.map(f=>f.vmax));
  const peakIndex=route.findIndex(f=>f.vmax>=peakWind-1e-5);
  const declineIndex=route.findIndex((f,i)=>i>peakIndex && f.vmax<=peakWind-2);
  const declineKm=declineIndex>=0?cumulative[declineIndex]:total;
  const limit=Math.min(maxHours,last.dissipated?last.leadHour:Infinity);
  const existing=base.filter(p=>p.simHour<=limit+1e-5);
  const seen=new Set(existing.map(p=>Math.round(p.simHour*1000)));
  const nodes:Array<{point:T;native:boolean}>=existing.map(point=>({point,native:false}));
  // If the ordinary run dissipated early, retain measured 3h branch fixes only
  // after its final node; their track segments, not an invented future position,
  // provide the remaining motion. No ordinary node is overwritten here.
  const lastNormalHour=existing.at(-1)?.simHour??0;
  for(const fix of route){
    if(fix.leadHour>limit+1e-5)break;
    if(fix.leadHour<=lastNormalHour+1e-5)continue;
    // If the CURRENT physical forecast ends early under active damaging
    // intervention, the old branch must never resurrect a dissipated vortex.
    if(severeIssue)continue;
    if(fix.leadHour!==0 && fix.leadHour%3!==0 && fix!==last)continue;
    if(seen.has(Math.round(fix.leadHour*1000)))continue;
    seen.add(Math.round(fix.leadHour*1000));
    nodes.push({native:true,point:{lat:fix.lat,lon:fix.lon,vmax:fix.vmax,pmin:fix.pmin,
      simHour:fix.leadHour,speed:fix.speed,category:fix.category,landed:fix.landed,
      rmw:fix.rmw,r7:copyRadii(fix.r7),r10:copyRadii(fix.r10),r12:copyRadii(fix.r12),
      eyeType:fix.eyeType,eyePhase:fix.eyePhase,
      ewrcState:fix.ewrcState,ewrcProgress:fix.ewrcProgress,
      dryAirIntrusion:fix.dryAirIntrusion,moistureReservoir:fix.moistureReservoir,
      shear:fix.shear,isStructureDamaged:fix.isStructureDamaged,
      structuralDamageHours:fix.structuralDamageHours,
      warmWaterHoursAfterSea:fix.warmWaterHoursAfterSea,
      lowLevelVortexIntegrity:fix.lowLevelVortexIntegrity,extrTransition:fix.extrTransition,
      remnantVortex:fix.vmax<17.2&&!fix.dissipated,preSimulationGuided:true} as unknown as T});
  }
  nodes.sort((a,b)=>a.point.simHour-b.point.simHour);
  type Extra={rmw?:number;r7?:PreSimulationFix['r7'];r10?:PreSimulationFix['r10'];r12?:PreSimulationFix['r12'];
    remnantVortex?:boolean;preSimulationGuided?:boolean};
  const guided:T[]=[];
  let distance=0;
  let previousBase:T|undefined;
  let previousMatched:PreSimulationFix|undefined;
  let exit:({lat:number;lon:number;vmax:number;pmin:number;time:number;baseLat:number;baseLon:number;baseWind:number;basePressure:number})|undefined;
  for(const {point:p,native} of nodes){
    if(p.simHour<=1e-6){
      guided.push(p);
      previousBase=p;
      previousMatched=sampleReferenceDistance(ref,cumulative,0);
      continue;
    }
    const deltaT=Math.max(1e-5,p.simHour-(previousBase?.simHour??0));
    const previousDistance=distance;
    // Full-physics positions are the realized storm motion, not a speed display
    // that can disagree with the measured track after curvature/rounding.
    const baseStep=previousBase?trackDistanceKm(previousBase,p):Math.max(0,p.speed)*deltaT;
    const move=native?Math.max(0,p.speed)*deltaT:Math.min(baseStep,120*deltaT);
    distance+=move;
    const crossing=distance>=total-1e-6;
    if(crossing && !exit){
      const ratio=clamp((total-previousDistance)/Math.max(1e-6,distance-previousDistance),0,1);
      const prev=previousBase??p;
      const baseLat=prev.lat+(p.lat-prev.lat)*ratio;
      const baseLon=prev.lon+(((p.lon-prev.lon+540)%360)-180)*ratio;
      const baseWind=Number.isFinite(p.vmax)&&Number.isFinite(prev.vmax)
        ?prev.vmax+(p.vmax-prev.vmax)*ratio:last.vmax;
      const basePressure=Number.isFinite(p.pmin)&&Number.isFinite(prev.pmin)
        ?prev.pmin+(p.pmin-prev.pmin)*ratio:last.pmin;
      // Solve the junction intensity at its actual crossing time, not at
      // the OLD pre-simulation clock hour. Never create an instant RI step.
      const crossingTime=prev.simHour+deltaT*ratio;
      const junctionLand=options?.isLandAt?.(last.lat,last.lon)??last.landed;
      const weight=(junctionLand&&!legacyRound164?intensityWeight*.72:intensityWeight) *
        (1-stressAt(crossingTime)*.98);
      const blendedWind=Number.isFinite(baseWind)?baseWind*(1-weight)+last.vmax*weight:last.vmax;
      const prevOut=guided.at(-1);
      const refGain=previousMatched?last.vmax-previousMatched.vmax:0;
      const permittedLandGain=junctionLand&&last.landed?Math.max(0,refGain):0;
      const junctionCeiling=prevOut
        ?prevOut.vmax+(junctionLand?permittedLandGain:
          (refGain>2?Math.max(2.6,refGain):1.15)*Math.max(0,crossingTime-prev.simHour))
        :blendedWind;
      let junctionWind=Math.min(blendedWind,junctionCeiling);
      if(!legacyRound164 && !junctionLand && prevOut){
        // Do not abruptly discard an early-arriving intense vortex exactly
        // where the sandbox's final recorded spatial fix is crossed.
        junctionWind=Math.max(junctionWind,prevOut.vmax-2.5*Math.max(.01,crossingTime-prev.simHour));
      }
      let junctionPressure=Number.isFinite(basePressure)
        ?basePressure*(1-weight)+last.pmin*weight:last.pmin;
      junctionPressure+=(blendedWind-junctionWind)*1.15;
      if(junctionLand&&prevOut?.landed&&junctionWind<=prevOut.vmax)
        junctionPressure=Math.max(junctionPressure,prevOut.pmin);
      exit={lat:last.lat,lon:last.lon,vmax:junctionWind,pmin:junctionPressure,
        time:crossingTime,baseLat,baseLon,baseWind,basePressure};
    }
    if(exit && distance>total+1e-5){
      // Translate the REAL subsequent base displacements to the endpoint, rather
      // than dragging points backwards to the old guidance issue-hour index.
      let lat=clamp(exit.lat+(p.lat-exit.baseLat),-85,85);
      let lon=exit.lon+(((p.lon-exit.baseLon+540)%360)-180);
      const continuous=capGuidedStep(guided.at(-1),{lat,lon},deltaT);
      lat=continuous.lat;lon=continuous.lon;
      const duration=p.simHour-exit.time;
      const fade=clamp(1-duration/18,0,1);
      let wind=Number.isFinite(p.vmax)?p.vmax+(exit.vmax-exit.baseWind)*fade:p.vmax;
      let pressure=Number.isFinite(p.pmin)?p.pmin+(exit.pmin-exit.basePressure)*fade:p.pmin;
      const previous=guided.at(-1);
      const land=options?.isLandAt?.(lat,lon) ?? (!!p.landed || (!!last.landed&&fade>.5));
      if(previous&&Number.isFinite(wind)){
        const maxRise=land
          ?(previous.landed?-.50:0)*Math.max(1e-5,p.simHour-previous.simHour)
          :(duration<=18?1.35:2.5)*Math.max(1e-5,p.simHour-previous.simHour);
        const ceiling=previous.vmax+maxRise;
        if(wind>ceiling){pressure+=(wind-ceiling)*1.15;wind=ceiling;}
        if(land&&previous.landed&&wind<=previous.vmax)pressure=Math.max(pressure,previous.pmin);
      }
      // If the ordinary forecast outruns the branch spatial endpoint, it must
      // still honor its observed weakening at forecast LEAD times that were
      // actually simulated. The old exit fade could reintroduce an old peak.
      if(declineIndex>=0 &&
         p.simHour>=route[declineIndex].leadHour-1e-5 &&
         p.simHour<=last.leadHour+1e-5 && stressAt(p.simHour)<.15){
        const confirmed=preSimulationFixAt(ref,p.simHour);
        if(confirmed && wind>confirmed.vmax+.75){
          pressure+=(wind-confirmed.vmax-.75)*1.15;
          wind=confirmed.vmax+.75;
        }
      }
      const adjusted={...p,lat,lon,vmax:wind,pmin:pressure,landed:land,
        speed:previous?trackDistanceKm(previous,{lat,lon})/Math.max(1e-5,p.simHour-previous.simHour):p.speed,
        category:categoryForWind(wind,p.category)} as T;
      guided.push(adjusted);
      previousBase=p;
      previousMatched=last;
      continue;
    }
    // The maximum path authority is geographical; travel distance (not h)
    // determines which segment and intensity profile is appropriate.
    const spatial=sampleReferenceDistance(ref,cumulative,Math.min(distance,total));
    // High-authority ROUTE with limited cross-track flexibility. A cyclone
    // displaced to the north can first run a little north of the sandbox,
    // then steer gradually south onto it over several hundred kilometres.
    // The taper becomes zero at the last actual sandbox fix, keeping the
    // ordinary-physics continuation continuous. Along-track phase remains
    // determined solely by real travelled distance, never by old timestamps.
    const toEnd=Math.max(0,total-distance);
    const taperFromStart=Math.pow(clamp(1-distance/520,0,1),1.45);
    const taperAtEnd=clamp(toEnd/Math.min(180,Math.max(30,total*.35)),0,1);
    const rawLat=(p.lat-spatial.lat)*111.12;
    const rawLon=(((p.lon-spatial.lon+540)%360)-180)*111.12*Math.max(.1,Math.cos(spatial.lat*Math.PI/180));
    const rawMagnitude=Math.hypot(rawLat,rawLon);
    const offsetScale=(native?0:.34*taperFromStart*taperAtEnd)*Math.min(1,90/Math.max(1,rawMagnitude));
    const limited=capGuidedStep(guided.at(-1),{
      lat:spatial.lat+(p.lat-spatial.lat)*offsetScale,
      lon:spatial.lon+(((p.lon-spatial.lon+540)%360)-180)*offsetScale
    },deltaT);
    const lat=limited.lat,lon=limited.lon;
    const matched=preSimulationFixNearPosition(ref,{lat,lon},spatial.leadHour)??spatial;
    const isLand=options?.isLandAt?.(lat,lon)??matched.landed;
    const previous=guided.at(-1);
    // Round176: a declining ordinary *wind speed* is NOT evidence of fresh
    // structural damage. The old inference (ordinary drop >0.42 m/s/h while
    // the sandbox was steady) disabled 94% of the approved reference's weight
    // precisely when the reference was most needed. It produced false NMC
    // 60 -> 33 -> 15 m/s cliffs even with a confirmed, slowly weakening run.
    // Only an independent, explicitly diagnosed core/environmental failure
    // can override the sandbox, not the discrepancy we are trying to resolve.
    const physical=p as T & {isStructureDamaged?:boolean;
      coldAirWarmCoreDestroyed?:boolean;extrTransition?:number;
      shear?:number;dryAirIntrusion?:number};
    const newCoreFailure=!!physical.isStructureDamaged && !matched.isStructureDamaged;
    const newWarmCoreFailure=!!physical.coldAirWarmCoreDestroyed && !matched.dissipated;
    const newExtraTropicalTransition=Number(physical.extrTransition||0)>=.80 &&
      Number(matched.extrTransition||0)<.65;
    const newExtremeShear=Number(physical.shear||0)>=28 && Number(matched.shear||0)<25;
    const newExtremeDryAir=Number(physical.dryAirIntrusion||0)>=.70 &&
      Number(matched.dryAirIntrusion||0)<.50;
    const physicalDamage=(!native && (newCoreFailure || newWarmCoreFailure ||
      newExtraTropicalTransition || newExtremeShear || newExtremeDryAir)) ? .96 : 0;
    const activeStress=Math.max(stressAt(p.simHour),physicalDamage);
    // Spatial guidance controls the route, but a live core intervention vetoes
    // intensity recovery until the ordinary forecast has actually recovered.
    const weight=(isLand&&!legacyRound164?intensityWeight*.72:intensityWeight) *
      (1-activeStress*.98);
    const mix=(baseValue:number,guideValue:number)=>Number.isFinite(baseValue)
      ?baseValue*(1-weight)+guideValue*weight:guideValue;
    let vmax=native?matched.vmax:mix(p.vmax,matched.vmax);
    let pmin=native?matched.pmin:mix(p.pmin,matched.pmin);
    if(activeStress>.001 && !native && Number.isFinite(p.vmax)){
      // An explicit real-time stress response always wins over older sandbox
      // strengthening; pressure must follow the same suppressed intensity.
      const physicalCeiling=p.vmax+Math.max(0,matched.vmax-p.vmax)*(.02*(1-activeStress));
      if(vmax>physicalCeiling){pmin+=(vmax-physicalCeiling)*1.15;vmax=physicalCeiling;}
    }
    if(previous && legacyRound164 && isLand && (previous.landed || !matched.landed)){
      // Round164 strength calculation (legacy NMC switch): near-full branch
      // authority with only the original spatial landfall gain guard.
      const approvedGain=previousMatched?.landed && matched.landed
        ?Math.max(0,matched.vmax-previousMatched.vmax):0;
      const capped=Math.min(vmax,previous.vmax+approvedGain);
      pmin+=Math.max(0,vmax-capped)*1.15;
      vmax=capped;
    }
    if(previous && !legacyRound164){
      const referenceGain=previousMatched?matched.vmax-previousMatched.vmax:0;
      const approvedLandGain=matched.landed?Math.max(0,referenceGain):0;
      const landWeakening=matched.landed
        ? Math.min(-.35*deltaT,referenceGain*.50)
        : -.65*deltaT;
      const before=vmax;
      if(activeStress<.15 && !isLand && !native && distance<declineKm-1e-5 &&
          previous.vmax>matched.vmax+1.8 && p.vmax>=previous.vmax-6 &&
          previous.vmax>=Math.min(peakWind-1,matched.vmax+3.5)){
        // An earlier physically supported peak may persist rather than being
        // pulled DOWN to the slower pre-simulation intensification timetable.
        // Stop this support at the geographical start of sandbox weakening,
        // on actual land, or if ordinary physics shows serious deterioration.
        vmax=Math.max(vmax,previous.vmax-.15*deltaT);
      }
      if(isLand){
        // Same geographical shore segment must not steal offshore RI. Carry
        // at least part of the measured inland weakening as the core decays.
        vmax=Math.min(vmax,previous.vmax+approvedLandGain+landWeakening);
      }else if(!isLand){
        // Do not turn a smooth sandbox trend into an unsolicited explosive
        // forecast increase; a sandbox RI episode is explicitly exempt.
        const permittedRate=referenceGain/Math.max(.01,matched.leadHour-(previousMatched?.leadHour??0));
        const maxRate=permittedRate>=1.5?Math.max(2.6,permittedRate+.35):1.15;
        vmax=Math.min(vmax,previous.vmax+maxRate*deltaT);
      }
      pmin+=(before-vmax)*1.15;
      if(isLand&&previous.landed&&vmax<=previous.vmax)
        pmin=Math.max(pmin,previous.pmin);
    }
    // Once the approved branch has begun a measured post-peak decline, its
    // hourly strength is an upper bound for the *same forecast lead*. Purely
    // spatial matching can lag behind a slower/looped reference track and used
    // to resurrect the old 70 m/s plateau long after the sandbox reached 58.
    // Do not amplify a weaker physical solution or veto new real-time damage.
    if(!native && declineIndex>=0 &&
       p.simHour>=route[declineIndex].leadHour-1e-5 &&
       p.simHour<=last.leadHour+1e-5 && activeStress<.15){
      const confirmed=preSimulationFixAt(ref,p.simHour);
      if(confirmed && Number.isFinite(confirmed.vmax)){
        const safeCeiling=confirmed.vmax+0.75;
        if(vmax>safeCeiling){pmin+=(vmax-safeCeiling)*1.15;vmax=safeCeiling;}
      }
    }
    const category=categoryForWind(vmax,matched.category);
    const radiiFactor=matched.vmax>0?Math.min(1,Math.sqrt(Math.max(0,vmax)/matched.vmax)):1;
    const radii=(r:PreSimulationFix['r7'])=>({ne:r.ne*radiiFactor,se:r.se*radiiFactor,sw:r.sw*radiiFactor,nw:r.nw*radiiFactor});
    const out={...p,lat,lon,vmax,pmin,
      speed:previous?trackDistanceKm(previous,{lat,lon})/Math.max(1e-5,p.simHour-previous.simHour):p.speed,
      category,landed:isLand,
      rmw:matched.rmw,r7:radii(matched.r7),r10:radii(matched.r10),r12:radii(matched.r12),
      eyeType:matched.eyeType,eyePhase:matched.eyePhase,
      ewrcState:matched.ewrcState,ewrcProgress:matched.ewrcProgress,
      dryAirIntrusion:matched.dryAirIntrusion,moistureReservoir:matched.moistureReservoir,
      shear:matched.shear,isStructureDamaged:matched.isStructureDamaged,
      structuralDamageHours:matched.structuralDamageHours,
      warmWaterHoursAfterSea:matched.warmWaterHoursAfterSea,
      lowLevelVortexIntegrity:matched.lowLevelVortexIntegrity,
      extrTransition:matched.extrTransition,
      remnantVortex:vmax<17.2&&!matched.dissipated,preSimulationGuided:true} as T & Extra;
    guided.push(out);
    if(exit){exit.vmax=vmax;exit.pmin=pmin;}
    previousBase=p;
    previousMatched=matched;
  }
  return guided;
}

/** At genesis the first deterministic intensity outlook must not look like an
 * omniscient replay of short-lived pulses or an unobserved near-shore RI burst.
 * Apply a modest low-pass to published FULL intensity points only. Actual storm
 * physics, spatial path, forecast speed and independently generated ensemble
 * members are untouched. The constraint fades as lead time increases.
 */
export function coarsenEarlyGenesisIntensity<T extends {simHour:number;vmax:number;pmin:number;category:TyphoonCategory;landed?:boolean}>(
  forecast:T[], genesisAgeHours:number, currentWind:number
):T[]{
  if(!Number.isFinite(genesisAgeHours)||genesisAgeHours>=24||currentWind>=32.7||forecast.length<3)return forecast;
  let filtered=forecast[0].vmax;
  let previousHour=forecast[0].simHour;
  return forecast.map((p,i)=>{
    if(!i||!Number.isFinite(p.vmax))return p;
    const dt=Math.max(1e-5,p.simHour-previousHour);
    const youngFactor=clamp((36-p.simHour)/36,0,1)*clamp((24-genesisAgeHours)/24,0,1);
    const alpha=1-Math.exp(-dt/(2+7*youngFactor));
    const raw=filtered+(p.vmax-filtered)*alpha;
    // Prevent an unstable model pulse at genesis from appearing as a precise
    // prediction of a short-duration explosive event.
    const maxGrowth=(1.2+0.8*(1-youngFactor))*dt;
    const next=Math.min(raw,filtered+maxGrowth);
    const newWind=p.vmax*(1-youngFactor)+next*youngFactor;
    const pressure=p.pmin+(p.vmax-newWind)*1.15;
    filtered=newWind;
    previousHour=p.simHour;
    return {...p,vmax:newWind,pmin:pressure,category:categoryForWind(newWind,p.category)};
  });
}
