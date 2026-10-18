import type { SimulationConfig, Typhoon } from "../types";
import {
  calculateHurricaneTrackerGuidanceTracks,
  type HurricaneTrackerModelTrack
} from "./HurricaneTrackerPort";
import { getSynopticEnvironmentState } from "./SynopticEnvironment";
import {
  getLandMetrics, getProceduralElevation, getDistanceToLand, getCoreSurfaceInteractionMetrics,
  type CoreSurfaceInteractionMetrics
} from "./Engine";
import { checkPointOnProductLandGeoJson } from "./NaturalEarthLoader";

/**
 * AETHER deterministic / ensemble guidance.
 *
 * Design goals:
 *  - the operational AETHER forecast shown on the live map is the immutable reference trajectory;
 *  - eight labelled guidance families depart from that same trajectory smoothly (never by pointwise jitter);
 *  - Hurricane Tracker's recovered StormModel family still contributes relative steering spread, but its
 *    flat-world displacement is low-pass filtered and bounded so it cannot create loops/teleports;
 *  - ensemble members use coherent along/cross-track error modes and coherent intensity/timing errors.
 *
 * These are simulated guidance families, not downloaded ECMWF/GFS products.
 */
export interface AetherModelSpec {
  id: "WNV3" | "FNV3" | "ECMWF" | "AIFS" | "GEFS" | "AIGEPS" | "HGEFS" | "GEM";
  label: string;
  color: string;
  sourceIndex: number;
  /** signed cross-track displacement reached near the end of the forecast */
  crossTrackBiasKm: number;
  /** coherent translation-speed bias relative to the AETHER reference */
  alongTrackScale: number;
  /** deterministic peak-intensity bias (m/s) */
  intensityBiasMps: number;
  /** deterministic peak-timing shift (hours) */
  intensityTimingHours: number;
  /** ensemble positional-spread multiplier */
  spreadScale: number;
  /** ensemble intensity-spread multiplier */
  intensitySpreadScale: number;
  /** low-frequency curvature term for model-to-model separation */
  curvatureKm: number;
}

export const AETHER_MODEL_SPECS: readonly AetherModelSpec[] = [
  { id:"WNV3", label:"WNV3", color:"#ff1616", sourceIndex:0, crossTrackBiasKm:  72, alongTrackScale:1.080, intensityBiasMps: 1.4, intensityTimingHours:-1, spreadScale:1.18, intensitySpreadScale:0.92, curvatureKm: 26 },
  { id:"FNV3", label:"FNV3", color:"#7d147d", sourceIndex:1, crossTrackBiasKm:  32, alongTrackScale:1.035, intensityBiasMps: 0.6, intensityTimingHours: 0, spreadScale:1.08, intensitySpreadScale:0.90, curvatureKm:-18 },
  { id:"ECMWF",label:"ECMWF",color:"#16a516", sourceIndex:2, crossTrackBiasKm: -44, alongTrackScale:.955, intensityBiasMps:-0.4, intensityTimingHours: 2, spreadScale:0.98, intensitySpreadScale:0.88, curvatureKm:-34 },
  { id:"AIFS", label:"AIFS", color:"#ff9e16", sourceIndex:3, crossTrackBiasKm: -18, alongTrackScale:1.015, intensityBiasMps: 0.3, intensityTimingHours: 0, spreadScale:1.02, intensitySpreadScale:0.84, curvatureKm: 22 },
  { id:"GEFS", label:"GEFS", color:"#142cff", sourceIndex:4, crossTrackBiasKm:  88, alongTrackScale:1.105, intensityBiasMps:-0.6, intensityTimingHours: 3, spreadScale:1.28, intensitySpreadScale:0.98, curvatureKm: 38 },
  { id:"AIGEPS",label:"AIGEPS",color:"#f41de0", sourceIndex:5, crossTrackBiasKm: -82, alongTrackScale:1.060, intensityBiasMps: 0.8, intensityTimingHours:-2, spreadScale:1.22, intensitySpreadScale:0.92, curvatureKm:-44 },
  { id:"HGEFS",label:"HGEFS",color:"#20d8d8", sourceIndex:6, crossTrackBiasKm:  14, alongTrackScale:.910, intensityBiasMps:-0.8, intensityTimingHours: 2, spreadScale:1.14, intensitySpreadScale:1.00, curvatureKm: 18 },
  { id:"GEM",  label:"GEM",  color:"#b9f23b", sourceIndex:7, crossTrackBiasKm: -28, alongTrackScale:.985, intensityBiasMps:-1.1, intensityTimingHours: 3, spreadScale:1.18, intensitySpreadScale:1.02, curvatureKm:-24 }
] as const;

export interface AetherGuidancePoint {
  lat:number; lon:number; vmax:number; pmin:number; simHour:number; leadHour:number;
  /** diagnosed translation speed from actual 3-hour geographic displacement */
  speed?:number;
  /** translation bearing, degrees clockwise from north */
  direction?:number;
  landed?:boolean;
  remnantVortex?:boolean;
  lowLevelVortexIntegrity?:number;
  warmWaterHoursAfterSea?:number;
  /** 0..1 dry-air impact perceived by this model/member at this lead time. */
  dryAirIndex?:number;
}
export interface AetherGuidanceMember {
  id:string;
  modelId:AetherModelSpec["id"];
  color:string;
  control:boolean;
  memberNumber:number;
  maxVmax:number;
  minPmin:number;
  track:AetherGuidancePoint[];
}

/**
 * Guidance products intentionally preserve the native 3-hour nodes as a polyline.  Earlier builds
 * applied display-only corner cutting here; that made members look like hand-drawn curves and hid
 * the actual forecast nodes.  Keep the compatibility export, but do not alter geometry.
 */
export function smoothGuidanceTrackForDisplay<T extends { lat:number; lon:number }>(track: readonly T[], passes=2): T[] {
  return [...track];
}

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const kmPerLon=(lat:number)=>111.12*Math.max(.18,Math.cos(lat*Math.PI/180));
const smoothstep=(x:number)=>{const t=clamp(x,0,1);return t*t*(3-2*t);};
function hash32(input:string){let h=2166136261>>>0;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;return h>>>0;}
function rng(seed:string){let s=hash32(seed)||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
function normal(rand:()=>number){const u=Math.max(1e-9,rand()),v=Math.max(1e-9,rand());return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

interface IssueRegime {
  splitStart:number;
  splitPeak:number;
  consensusStart:number;
  splitAmplitudeKm:number;
  /** 0..1 issue-specific strength of a coherent synoptic-regime split. */
  regimeStrength:number;
  /** 0..1 amount of ordinary long-range uncertainty retained even without a distinct split. */
  longRangeUncertainty:number;
  axisEast:number;
  axisNorth:number;
  polarity:number;
  remergeStrength:number;
  memberRemergeStrength:number;
  /** Shared ridge/trough timing and competing steering-flow diagnoses for this issue. */
  signature:string;
  troughArrivalHour:number;
  steeringAmplitudeKmH:number;
  steeringTurnEast:number;
  steeringTurnNorth:number;
}

interface TrackVerificationRegime {
  /** 0..1: recent analysed positions and headings overlap earlier issued forecasts. */
  overlapConfidence:number;
  /** 0..1: a persistent large heading-regime error, not a same-direction translation offset. */
  directionalMismatch:number;
  /** Multiplier applied to ordinary member displacement spread. */
  spreadScale:number;
  /** Multiplier applied to low-frequency path bending / regime switching. */
  swayScale:number;
  verifiedHours:number;
}

function angleDifferenceDeg(a:number,b:number){
  return Math.abs((((a-b)+540)%360)-180);
}

function historyStateAtOrBefore(history:readonly any[]|undefined,targetHour:number){
  if(!history?.length)return undefined;
  let lo=0,hi=history.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(Number(history[mid]?.simHour)<=targetHour+1e-6)lo=mid+1;else hi=mid;}
  return history[Math.max(0,lo-1)];
}

function forecastPointAtLead(path:readonly any[]|undefined,lead:number){
  if(!path?.length)return undefined;
  let best=path[0],bestErr=Math.abs(Number(best?.simHour||0)-lead);
  for(let i=1;i<path.length;i++){const e=Math.abs(Number(path[i]?.simHour||0)-lead);if(e<bestErr){best=path[i];bestErr=e;}}
  return bestErr<=4.1?best:undefined;
}

/**
 * Diagnose whether the current analysed track has been following earlier forecast *direction*.
 * A parallel/same-heading position error does not trigger extra spread. Only a stable, persistent
 * heading-regime miss (for example, a forecast continuing west while the analysed cyclone has
 * clearly recurved northeast) opens the ensemble plume and increases low-frequency track sway.
 * Conversely, repeated position + heading overlap gradually contracts the plume as verification
 * evidence accumulates.
 */
function buildTrackVerificationRegime(storm:Partial<Typhoon>,currentHour:number):TrackVerificationRegime {
  const history=(storm.history||[]) as any[];
  if(history.length<4||currentHour<5.5)return{overlapConfidence:0,directionalMismatch:0,spreadScale:1,swayScale:1,verifiedHours:0};
  const now=historyStateAtOrBefore(history,currentHour) || storm;
  const p3=historyStateAtOrBefore(history,currentHour-3);
  const p6=historyStateAtOrBefore(history,currentHour-6);
  if(!p6)return{overlapConfidence:0,directionalMismatch:0,spreadScale:1,swayScale:1,verifiedHours:0};
  const d6=guidanceDistanceKm(p6 as any,now as any);
  if(d6<22)return{overlapConfidence:0,directionalMismatch:0,spreadScale:1,swayScale:1,verifiedHours:0};
  const actualHeading=guidanceBearingDeg(p6 as any,now as any);
  let stableHeadingGate=1;
  if(p3){
    const hA=guidanceDistanceKm(p6 as any,p3 as any)>8?guidanceBearingDeg(p6 as any,p3 as any):actualHeading;
    const hB=guidanceDistanceKm(p3 as any,now as any)>8?guidanceBearingDeg(p3 as any,now as any):actualHeading;
    const wobble=angleDifferenceDeg(hA,hB);
    stableHeadingGate=1-smoothstep((wobble-20)/34);
  }
  const lookbacks=[6,12,18,24];
  let overlapSum=0,mismatchSum=0,weightSum=0,mismatchVotes=0,verifiedHours=0;
  for(const lookback of lookbacks){
    if(currentHour<lookback-1e-6)continue;
    const issue=historyStateAtOrBefore(history,currentHour-lookback);
    const fp=forecastPointAtLead(issue?.forecastPath,lookback);
    const fpPrev=forecastPointAtLead(issue?.forecastPath,Math.max(0,lookback-3));
    if(!fp||!fpPrev)continue;
    const posErr=guidanceDistanceKm(fp as any,now as any);
    const forecastHeading=guidanceBearingDeg(fpPrev as any,fp as any);
    const dirErr=angleDifferenceDeg(actualHeading,forecastHeading);
    const positionScore=1-smoothstep((posErr-24)/105);
    const directionScore=1-smoothstep((dirErr-8)/24);
    const overlap=clamp(positionScore*directionScore,0,1);
    const mismatch=stableHeadingGate*smoothstep((dirErr-24)/34);
    const w=lookback<=12?1:lookback<=18?.82:.68;
    overlapSum+=overlap*w;
    mismatchSum+=mismatch*w;
    weightSum+=w;
    verifiedHours=Math.max(verifiedHours,lookback);
    if(mismatch>.48)mismatchVotes++;
  }
  if(weightSum<=0)return{overlapConfidence:0,directionalMismatch:0,spreadScale:1,swayScale:1,verifiedHours:0};
  const evidence=clamp(weightSum/2.5,0,1);
  const overlapConfidence=clamp((overlapSum/weightSum)*evidence,0,1);
  let directionalMismatch=clamp((mismatchSum/weightSum)*evidence,0,1);
  // One noisy three-hour kink is not a "large-direction" failure. Require persistence unless the
  // diagnosed miss is already very large and the analysed heading itself is stable.
  if(mismatchVotes<2)directionalMismatch*=.48;
  directionalMismatch*=stableHeadingGate;
  const spreadScale=clamp(1-.30*overlapConfidence+.64*directionalMismatch,.68,1.72);
  const swayScale=clamp(1-.14*overlapConfidence+1.02*directionalMismatch,.82,2.05);
  return{overlapConfidence,directionalMismatch,spreadScale,swayScale,verifiedHours};
}

function buildIssueRegime(seed:string,currentHour:number,storm:Partial<Typhoon>,horizon:number):IssueRegime {
  const rand=rng(`${seed}|SYNOPTIC-REGIME|${Math.floor(currentHour/6)}|${Math.round(Number(storm.lat||0)*2)}|${Math.round(Number(storm.lon||0)*2)}`);
  const wpac=Number(storm.lon||0)>=105&&Number(storm.lon||0)<=165&&Number(storm.lat||0)>=5&&Number(storm.lat||0)<=42;
  // A major synoptic bifurcation must NOT be manufactured every cycle.  Most issues have only
  // weak-to-moderate regime disagreement; a smaller fraction develop a pronounced westward-vs-
  // recurvature split.  The deterministic draw keeps repeated rendering of one issue identical.
  const regimeClass=rand();
  const genesisUncertainty=clamp((20-Number(storm.vmax||0))/15,0,1);
  let regimeStrength=regimeClass<.24
    ? .05+.17*rand()                 // quiet / high-consensus issue
    : regimeClass<.76
      ? .22+.38*rand()               // ordinary model disagreement
      : .62+.38*rand();              // genuine high-impact bifurcation
  // A newly formed depression has a poorly constrained circulation centre and steering depth. Even
  // an otherwise "quiet" synoptic issue therefore cannot be treated as high-consensus yet.
  regimeStrength=clamp(regimeStrength+genesisUncertainty*(.20+.28*rand()),.05,1);
  const longRangeUncertainty=.78+.34*rand()+.18*genesisUncertainty;
  // Mature cyclones usually separate after day 1-2. Genesis guidance can bifurcate almost
  // immediately, including a different large-scale heading, then either converge or stay split.
  const matureSplitStart=18+28*rand();
  const genesisSplitStart=2+10*rand();
  const splitStart=matureSplitStart+(genesisSplitStart-matureSplitStart)*(.82*genesisUncertainty);
  const splitPeak=Math.min(horizon*.82,splitStart+(34+42*rand())*(1-.35*genesisUncertainty));
  const consensusStart=Math.min(horizon*.94,splitPeak+18+36*rand());
  const splitAmplitudeKm=(105+240*rand()+58*genesisSpreadFactor(Number(storm.vmax||0)))*regimeStrength*(1+.62*genesisUncertainty);
  // In the WNP, one of the most common high-impact regime disagreements is "more poleward/
  // recurving" versus "flatter/westward/landward". Do not force that pattern every cycle: a
  // deterministic issue-time polarity occasionally reverses it, and outside the WNP the axis is
  // allowed to rotate freely.
  const angle=wpac
    ? (42+22*(rand()-.5))*Math.PI/180
    : rand()*Math.PI*2;
  const axisEast=Math.cos(angle);
  const axisNorth=Math.sin(angle);
  const polarity=rand()<.70?1:-1;
  // Only some issues exhibit a strong late consensus collapse. In most cases long-range spread
  // remains appreciable, consistent with uncertainty generally increasing with lead time.
  const strongRemerge=rand()<(.18+.26*regimeStrength);
  const remergeStrength=strongRemerge ? .42+.38*rand() : .04+.24*rand();
  const memberRemergeStrength=strongRemerge ? .24+.42*rand() : .02+.20*rand();
  return {
    splitStart,splitPeak,consensusStart,splitAmplitudeKm,regimeStrength,longRangeUncertainty,
    axisEast,axisNorth,polarity,remergeStrength,memberRemergeStrength,
    signature:`${seed}|${Math.floor(currentHour/6)}|${Math.round(Number(storm.lat||0)*2)}|${Math.round(Number(storm.lon||0)*2)}`,
    troughArrivalHour:26+72*rand(),
    steeringAmplitudeKmH:(3.4+4.8*rand())*(.38+.90*regimeStrength),
    // An uncertain subtropical-ridge edge vs trough approach can turn a westward track
    // poleward/recurving, or keep it flatter. These are *flow* perturbations integrated in time.
    steeringTurnEast:wpac?(.42+.40*rand()):(rand()-.5)*1.6,
    steeringTurnNorth:wpac?(.64+.36*rand()):(rand()-.5)*1.6
  };
}

function splitMergeEnvelope(lead:number,horizon:number,regime:IssueRegime) {
  const rise=smoothstep((lead-regime.splitStart)/Math.max(6,regime.splitPeak-regime.splitStart));
  const merge=smoothstep((lead-regime.consensusStart)/Math.max(12,horizon-regime.consensusStart));
  // Lead-dependent growth is explicit: even a quiet issue can acquire some medium/long-range
  // separation, while a true regime split grows much faster.  Optional late convergence is then
  // applied only to the coherent split component.
  const leadGrowth=.34+.66*smoothstep((lead-12)/Math.max(24,horizon*.58));
  return rise*leadGrowth*(1-regime.remergeStrength*merge);
}

function isAiFamily(id:AetherModelSpec["id"]){return id==="AIFS"||id==="AIGEPS";}

const MODEL_SCENARIO_CACHE=new Map<string,number>();
function modelScenarioCoefficient(id:AetherModelSpec["id"],lead:number,horizon:number,regime:IssueRegime) {
  // Institutions do not belong to permanently opposite camps: each issue predicts the
  // synoptic ridge / trough with its own diagnosis, correlated within related families.
  // This represents synthetic structural uncertainty, not their actual operational output.
  const key=`${regime.signature}|${id}|${regime.polarity}`;
  let initial=MODEL_SCENARIO_CACHE.get(key);
  if(initial===undefined){
    const family=id==="AIFS"||id==="AIGEPS"?"ai":id==="ECMWF"?"ec":
      id==="GEFS"||id==="HGEFS"?"gefs":id==="WNV3"||id==="FNV3"?"regional":"gem";
    const familyDraw=rng(`${regime.signature}|ridge-trough|${family}`)();
    const modelDraw=rng(`${regime.signature}|steering-analysis|${id}`)();
    const branch=(familyDraw<.50?-1:1)*(.65+.35*modelDraw);
    const independent=(modelDraw-.5)*.48;
    initial=clamp(branch+independent,-1.30,1.30)*regime.polarity;
    MODEL_SCENARIO_CACHE.set(key,initial);
    while(MODEL_SCENARIO_CACHE.size>128)MODEL_SCENARIO_CACHE.delete(MODEL_SCENARIO_CACHE.keys().next().value!);
  }
  const convergence=smoothstep((lead-regime.consensusStart)/Math.max(12,horizon-regime.consensusStart));
  return initial*(1-regime.remergeStrength*convergence);
}

/** Differential integrated steering from uncertain subtropical ridge/trough timing.
 * The sign can reverse a member's mean east/west or north/south heading relative to
 * its parent track, rather than only displacing a parallel track sideways. */
function steeringVelocityKmH(coeff:number,lead:number,onset:number,regime:IssueRegime) {
  const onsetGate=smoothstep((lead-onset)/26);
  const troughGate=smoothstep((lead-regime.troughArrivalHour)/30);
  const scale=coeff*regime.steeringAmplitudeKmH*onsetGate;
  return {east:scale*(regime.steeringTurnEast*(.36+.64*troughGate)-.36*(1-troughGate)),
    north:scale*regime.steeringTurnNorth*(.42+.58*troughGate)};
}

function scenarioVectorKm(id:AetherModelSpec["id"],lead:number,horizon:number,regime:IssueRegime) {
  const envelope=splitMergeEnvelope(lead,horizon,regime);
  const coeff=modelScenarioCoefficient(id,lead,horizon,regime);
  const amplitude=regime.splitAmplitudeKm*envelope*coeff;
  return {east:regime.axisEast*amplitude,north:regime.axisNorth*amplitude};
}

interface CompiledDryRegion {
  minLat:number;maxLat:number;minLon:number;maxLon:number;
  cLat:number;cLon:number;radiusKm:number;intensity:number;softness:number;
  points:Array<{lat:number;lon:number}>;
}
interface CompiledShearRegion {
  minLat:number;maxLat:number;minLon:number;maxLon:number;
  cLat:number;cLon:number;radiusKm:number;shearKt:number;softness:number;
  points:Array<{lat:number;lon:number}>;
}
const dryRegionCompileCache=new WeakMap<object,Map<string,CompiledDryRegion[]>>();
const shearRegionCompileCache=new WeakMap<object,Map<string,CompiledShearRegion[]>>();

function pointInPolygon(lat:number,lon:number,points:Array<{lat:number;lon:number}>){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if(((a.lat>lat)!==(b.lat>lat))&&(lon<(b.lon-a.lon)*(lat-a.lat)/Math.max(1e-9,b.lat-a.lat)+a.lon))inside=!inside;
  }
  return inside;
}

function perturbRegionPoints(points:Array<{lat:number;lon:number}>,key:string,spread:number){
  if(!spread||!key)return {points,cLat:points.reduce((s,p)=>s+p.lat,0)/points.length,cLon:points.reduce((s,p)=>s+p.lon,0)/points.length,intensityScale:1};
  const r=rng(key);
  const cLat=points.reduce((sum,p)=>sum+p.lat,0)/points.length,cLon=points.reduce((sum,p)=>sum+p.lon,0)/points.length;
  const dLat=normal(r)*.34*spread,dLon=normal(r)*.42*spread;
  const size=clamp(1+normal(r)*.13*spread,.72,1.32);
  const intensityScale=clamp(1+normal(r)*.13*spread,.70,1.34);
  return {points:points.map(p=>({lat:cLat+(p.lat-cLat)*size+dLat,lon:cLon+(p.lon-cLon)*size+dLon})),cLat:cLat+dLat,cLon:cLon+dLon,intensityScale};
}

function compileDryRegions(config?:SimulationConfig,perturbSeed="",spread=0):CompiledDryRegion[]{
  const source=(config?.manualDryAirRegions||[]) as unknown as object;
  const cacheKey=
    `${perturbSeed}|${spread}`;
  let cached=dryRegionCompileCache.get(source)?.get(cacheKey);
  if(cached)return cached;
  const compiled=(config?.manualDryAirRegions||[]).flatMap((region,idx)=>{
    const raw=(region.points||[]).map(p=>({lat:Number(p.lat),lon:Number(p.lon)})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
    if(raw.length<3)return [];
    const pert=perturbRegionPoints(raw,`${perturbSeed}|DRY|${region.id||idx}`,spread);
    const points=pert.points,cLat=pert.cLat,cLon=pert.cLon;
    const cosLat=Math.max(.3,Math.cos(cLat*Math.PI/180));
    const radiusKm=Math.max(80,...points.map(p=>Math.hypot((p.lat-cLat)*111.12,(p.lon-cLon)*111.12*cosLat)));
    return [{minLat:Math.min(...points.map(p=>p.lat)),maxLat:Math.max(...points.map(p=>p.lat)),minLon:Math.min(...points.map(p=>p.lon)),maxLon:Math.max(...points.map(p=>p.lon)),cLat,cLon,radiusKm,intensity:clamp(Number(region.intensity||.72)*pert.intensityScale,.12,1),softness:clamp(Number(region.softness??.58),.18,.95),points}];
  });
  let bucket=dryRegionCompileCache.get(source);
  if(!bucket){bucket=new Map();dryRegionCompileCache.set(source,bucket);}
  bucket.set(cacheKey,compiled);
  return compiled;
}
function compileShearRegions(config?:SimulationConfig,perturbSeed="",spread=0):CompiledShearRegion[]{
  const source=(config?.manualShearRegions||[]) as unknown as object;
  const cacheKey=
    `${perturbSeed}|${spread}`;
  let cached=shearRegionCompileCache.get(source)?.get(cacheKey);
  if(cached)return cached;
  const compiled=(config?.manualShearRegions||[]).flatMap((region,idx)=>{
    const raw=(region.points||[]).map(p=>({lat:Number(p.lat),lon:Number(p.lon)})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
    if(raw.length<3)return [];
    const pert=perturbRegionPoints(raw,`${perturbSeed}|SHEAR|${region.id||idx}`,spread);
    const points=pert.points,cLat=pert.cLat,cLon=pert.cLon;
    const cosLat=Math.max(.3,Math.cos(cLat*Math.PI/180));
    const radiusKm=Math.max(80,...points.map(p=>Math.hypot((p.lat-cLat)*111.12,(p.lon-cLon)*111.12*cosLat)));
    return [{minLat:Math.min(...points.map(p=>p.lat)),maxLat:Math.max(...points.map(p=>p.lat)),minLon:Math.min(...points.map(p=>p.lon)),maxLon:Math.max(...points.map(p=>p.lon)),cLat,cLon,radiusKm,shearKt:clamp(Number(region.shearKt||30)*pert.intensityScale,15,60),softness:clamp(Number(region.softness??.58),.18,.95),points}];
  });
  let bucket=shearRegionCompileCache.get(source);
  if(!bucket){bucket=new Map();shearRegionCompileCache.set(source,bucket);}
  bucket.set(cacheKey,compiled);
  return compiled;
}

function manualDrySeverity(lat:number,lon:number,regions:CompiledDryRegion[]) {
  let best=0;
  for(const r of regions){
    if(lat<r.minLat||lat>r.maxLat||lon<r.minLon||lon>r.maxLon||!pointInPolygon(lat,lon,r.points))continue;
    const cosLat=Math.max(.3,Math.cos(lat*Math.PI/180));
    const dist=Math.hypot((lat-r.cLat)*111.12,(lon-r.cLon)*111.12*cosLat);
    const core=Math.max(0,1-dist/r.radiusKm);
    best=Math.max(best,r.intensity*(.32+.68*Math.pow(core,.50+r.softness*.60)));
  }
  return clamp(best,0,1);
}
function manualShearKt(lat:number,lon:number,regions:CompiledShearRegion[]) {
  let best=0;
  for(const r of regions){
    if(lat<r.minLat||lat>r.maxLat||lon<r.minLon||lon>r.maxLon||!pointInPolygon(lat,lon,r.points))continue;
    const cosLat=Math.max(.3,Math.cos(lat*Math.PI/180));
    const dist=Math.hypot((lat-r.cLat)*111.12,(lon-r.cLon)*111.12*cosLat);
    const core=Math.pow(Math.max(0,1-dist/r.radiusKm),.55+r.softness*.65);
    best=Math.max(best,15+(r.shearKt-15)*(.70+.30*core));
  }
  return Math.max(0,best);
}

interface GuidanceEnvironment {dry:number;rh:number;shear:number;sst:number;ohc:number;manualDry:number;manualShear:number;}

function makeEnvironmentSampler(config:SimulationConfig|undefined,storm:Partial<Typhoon>,perturbSeed="",spread=0){
  const regions=compileDryRegions(config,perturbSeed,spread);
  const shearRegions=compileShearRegions(config,perturbSeed,spread);
  const cache=new Map<string,GuidanceEnvironment>();
  const existingDry=clamp(.30*Number(storm.dryAirIntrusion||0)+.48*Number(storm.dryAirCoreExposure||0)+.22*Number(storm.dryAirCoreConnection||0),0,1);
  return (lat:number,lon:number,simHour:number):GuidanceEnvironment=>{
    const qLat=Math.round(lat*2)/2,qLon=Math.round(lon*2)/2,qHour=Math.round(simHour/6)*6;
    const key=`${qLat}|${qLon}|${qHour}`;
    let dry=existingDry*.45,rh=clamp(78-40*existingDry,38,86),shear=Math.max(0,Number(storm.shear||0)),sst=29,ohc=70;
    const cached=cache.get(key);
    if(cached){
      // Cache only the synoptic/base environment. Manual polygons are sampled at the
      // member's exact position below so their perturbed geometry is never double-applied.
      dry=cached.dry;rh=cached.rh;shear=cached.shear;sst=cached.sst;ohc=cached.ohc;
    } else {
      if(config){
        if(config.newEnvironmentPhysicsEnabled!==false){
          const env=getSynopticEnvironmentState(qLat,qLon,config,qHour);
          const humidityDeficit=clamp((62-env.rh700)/34,0,1);
          dry=clamp(.62*env.scores.dryAir+.38*humidityDeficit,0,1);
          rh=env.rh700;
          shear=env.shear;
          sst=env.sst;
          ohc=env.ohc;
        } else {
          dry=clamp(Number(config.dryAirStrength||0)/1.45,0,1);
          rh=clamp(80-42*dry,34,86);
        }
      }
      cache.set(key,{dry,rh,shear,sst,ohc,manualDry:0,manualShear:0});
    }
    const manual=manualDrySeverity(lat,lon,regions),manualShear=manualShearKt(lat,lon,shearRegions);
    return {
      dry:clamp(1-(1-dry)*(1-manual*.94),0,1),
      // Manual dry-air polygons lower the mid-level RH seen by the member in the same direction
      // as the live ventilation calculation. Keep a physical RH field instead of inferring it
      // later from the composite dry index so ventilation damage stays aligned with the live model.
      rh:clamp(rh-manual*30,24,92),
      shear:Math.max(shear,manualShear),
      sst,ohc,manualDry:manual,manualShear
    };
  };
}

function sampleSmoothKnots(values:number[], f:number){
  if(values.length<2)return values[0]||0;
  const x=clamp(f,0,1)*(values.length-1),i=Math.floor(x),t=x-i;
  const p0=values[Math.max(0,i-1)],p1=values[Math.min(values.length-1,i)],p2=values[Math.min(values.length-1,i+1)],p3=values[Math.min(values.length-1,i+2)];
  const t2=t*t,t3=t2*t;
  return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
}

function sampleLinearKnots(values:number[], f:number){
  if(values.length<2)return values[0]||0;
  const x=clamp(f,0,1)*(values.length-1),i=Math.floor(x),t=x-i;
  const a=values[Math.min(i,values.length-1)],b=values[Math.min(i+1,values.length-1)];
  return a+(b-a)*t;
}

function cumulativeKnots(rand:()=>number,length:number,stepScale:number){
  const values:number[]=[0];
  let value=0;
  for(let i=1;i<length;i++){
    value=clamp(value+normal(rand)*stepScale,-2.2*stepScale,2.2*stepScale);
    values.push(value);
  }
  return values;
}

interface RefPoint {
  lat:number;lon:number;vmax:number;pmin:number;lead:number;
  landed:boolean;
  remnantVortex:boolean;
  lowLevelVortexIntegrity:number;
  warmWaterHoursAfterSea:number;
}
function normalizeReference(storm:Partial<Typhoon>, reference:any[], currentHour:number, horizon:number):RefPoint[] {
  const src=(reference||[]).map((p:any,i:number)=>({
    lat:Number(p.lat), lon:Number(p.lon), vmax:Number.isFinite(Number(p.vmax))?Number(p.vmax):Number(storm.vmax||0),
    pmin:Number.isFinite(Number(p.pmin))?Number(p.pmin):Number(storm.pmin||1010), raw:Number.isFinite(Number(p.simHour))?Number(p.simHour):NaN, i,
    landed:!!p.landed,
    remnantVortex:!!p.remnantVortex,
    lowLevelVortexIntegrity:clamp(Number(p.lowLevelVortexIntegrity ?? storm.lowLevelVortexIntegrity ?? 0.56),0,1),
    warmWaterHoursAfterSea:Math.max(0,Number(p.warmWaterHoursAfterSea ?? storm.warmWaterHoursAfterSea ?? 0))
  })).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  const finite=src.map(p=>p.raw).filter(Number.isFinite) as number[];
  const minRaw=finite.length?Math.min(...finite):0,maxRaw=finite.length?Math.max(...finite):0;
  // calculateForecastPath()/stored forecastPath use 0..N lead hours. Some exported/historical
  // snapshots instead use absolute simulation hours. Detect the whole path once, not point-by-point.
  const looksLead = finite.length>0 && minRaw<=6.01 && maxRaw<=horizon+24;
  const looksAbsolute = finite.length>0 && !looksLead && minRaw>=currentHour-6.01 && maxRaw-currentHour<=horizon+24;
  const pts:RefPoint[]=[{
    lat:Number(storm.lat||0),lon:Number(storm.lon||0),vmax:Number(storm.vmax||0),pmin:Number(storm.pmin||1010),lead:0,
    landed:!!storm.landed,
    remnantVortex:Number(storm.vmax||0)<17.2 && Number(storm.lowLevelVortexIntegrity ?? 0.56)>0.18,
    lowLevelVortexIntegrity:clamp(Number(storm.lowLevelVortexIntegrity ?? 0.56),0,1),
    warmWaterHoursAfterSea:Math.max(0,Number(storm.warmWaterHoursAfterSea ?? 0))
  }];
  src.forEach((p,idx)=>{
    let lead:number;
    if(Number.isFinite(p.raw)) lead=looksAbsolute?p.raw-currentHour:p.raw;
    else lead=((idx+1)/Math.max(1,src.length))*horizon;
    const l=clamp(Number(lead),0,horizon);
    if(l<1e-6 && Math.hypot(p.lat-pts[0].lat,(p.lon-pts[0].lon)*Math.cos(p.lat*Math.PI/180))<.05) return;
    pts.push({lat:p.lat,lon:p.lon,vmax:p.vmax,pmin:p.pmin,lead:l,landed:p.landed,remnantVortex:p.remnantVortex,lowLevelVortexIntegrity:p.lowLevelVortexIntegrity,warmWaterHoursAfterSea:p.warmWaterHoursAfterSea});
  });
  pts.sort((a,b)=>a.lead-b.lead);
  const dedup:RefPoint[]=[];
  for(const p of pts){const last=dedup[dedup.length-1];if(last&&Math.abs(last.lead-p.lead)<1e-6)dedup[dedup.length-1]=p;else dedup.push(p);}
  // Preserve the deterministic forecast's exact lead-time progression. In particular, a manual
  // large-scale forecast route may intentionally slow or nearly stall the deterministic path via
  // waypoint-spacing tempo. Ensemble guidance must inherit that already-resolved translation
  // clock, rather than smoothing it away or re-interpreting the raw drawn points independently.
  return dedup;
}

function interpolateRef(points:RefPoint[], lead:number):RefPoint {
  const target=clamp(lead,0,points[points.length-1]?.lead??0);
  if(!points.length) return {lat:0,lon:0,vmax:0,pmin:1010,lead:target,landed:false,remnantVortex:false,lowLevelVortexIntegrity:.4,warmWaterHoursAfterSea:0};
  if(target<=points[0].lead) return {...points[0],lead:target};
  for(let i=1;i<points.length;i++) if(target<=points[i].lead+1e-6){const a=points[i-1],b=points[i],t=clamp((target-a.lead)/Math.max(1e-6,b.lead-a.lead),0,1);return{lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,vmax:a.vmax+(b.vmax-a.vmax)*t,pmin:a.pmin+(b.pmin-a.pmin)*t,lead:target,landed:t<.5?a.landed:b.landed,remnantVortex:t<.5?a.remnantVortex:b.remnantVortex,lowLevelVortexIntegrity:a.lowLevelVortexIntegrity+(b.lowLevelVortexIntegrity-a.lowLevelVortexIntegrity)*t,warmWaterHoursAfterSea:a.warmWaterHoursAfterSea+(b.warmWaterHoursAfterSea-a.warmWaterHoursAfterSea)*t};}
  return {...points[points.length-1],lead:target};
}

function tangentNormal(points:RefPoint[],lead:number){
  const a=interpolateRef(points,Math.max(0,lead-6)),b=interpolateRef(points,Math.min(points[points.length-1]?.lead??lead+6,lead+6));
  const meanLat=(a.lat+b.lat)*.5,dx=(b.lon-a.lon)*kmPerLon(meanLat),dy=(b.lat-a.lat)*111.12,mag=Math.hypot(dx,dy)||1;
  return {tx:dx/mag,ty:dy/mag,nx:-dy/mag,ny:dx/mag};
}
function rawTrackPoint(track:any[],f:number){if(!track?.length)return null;const pos=clamp(f,0,1)*Math.max(0,track.length-1),i0=Math.floor(pos),i1=Math.min(track.length-1,i0+1),t=pos-i0;return{lat:track[i0].lat+(track[i1].lat-track[i0].lat)*t,lon:track[i0].lon+(track[i1].lon-track[i0].lon)*t};}
function smoothReference(points:RefPoint[]):RefPoint[] {
  if(points.length<=2) return points;
  const maxLead=points[points.length-1].lead;
  const dense:RefPoint[]=[];
  for(let lead=0;lead<=maxLead+1e-6;lead+=3){dense.push(interpolateRef(points,Math.min(maxLead,lead)));}
  if(Math.abs(dense[dense.length-1].lead-maxLead)>1e-6)dense.push(interpolateRef(points,maxLead));
  const smoothed=dense.map((p,i,arr)=>{
    if(i===0||i===arr.length-1) return {...p};
    const a=arr[i-1],b=arr[i],c=arr[i+1];
    return {
      lead:p.lead,
      lat:a.lat*0.20+b.lat*0.60+c.lat*0.20,
      lon:a.lon*0.20+b.lon*0.60+c.lon*0.20,
      vmax:a.vmax*0.15+b.vmax*0.70+c.vmax*0.15,
      pmin:a.pmin*0.15+b.pmin*0.70+c.pmin*0.15,
      landed:b.landed,
      remnantVortex:b.remnantVortex,
      lowLevelVortexIntegrity:a.lowLevelVortexIntegrity*0.15+b.lowLevelVortexIntegrity*0.70+c.lowLevelVortexIntegrity*0.15,
      warmWaterHoursAfterSea:a.warmWaterHoursAfterSea*0.15+b.warmWaterHoursAfterSea*0.70+c.warmWaterHoursAfterSea*0.15,
    };
  });
  smoothed[0]={...points[0],lead:0};
  smoothed[smoothed.length-1]={...points[points.length-1]};
  return smoothed;
}

function guidanceDistanceKm(a:{lat:number;lon:number},b:{lat:number;lon:number}) {
  const r=6371.0088;
  const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*r*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
}
function guidanceBearingDeg(a:{lat:number;lon:number},b:{lat:number;lon:number}) {
  const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;
  const y=Math.sin(dl)*Math.cos(p2);
  const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

/**
 * Couple one ensemble geometry step to the already-computed baseline translation distance.
 * The baseline is the deterministic forecast for model centres, and the model-centre track for
 * individual members. This is deliberately downstream of calculateForecastPath(): a user-drawn
 * large-scale route affects deterministic translation first, then every ensemble path inherits
 * that slowed/accelerated clock and only adds a bounded model/member speed error.
 */
function coupleGuidanceStepToBaseline(
  previous:{lat:number;lon:number},
  candidate:{lat:number;lon:number},
  baselineStepKm:number,
  relativeSpeedFactor:number,
  allowanceFraction:number
):{lat:number;lon:number} {
  const candidateStepKm=guidanceDistanceKm(previous,candidate);
  if(!Number.isFinite(candidateStepKm)||candidateStepKm<1e-6)return candidate;
  const baseline=Math.max(0,Number.isFinite(baselineStepKm)?baselineStepKm:0);
  const speedFactor=clamp(relativeSpeedFactor,.55,1.45);
  const desiredStep=baseline*speedFactor;
  // Translation timing is intentionally a downstream constraint: the deterministic reference
  // (already affected by the hand-drawn large-scale path) sets the clock first. Model/member
  // differences are then expressed as a clear relative speed bias around that clock. Near a true
  // reference stall the coupling approaches 100%, so ensemble geometry cannot run through it.
  const stallCoupling=1-smoothstep((baseline-1.5)/18);
  const coupling=.86+.125*stallCoupling;
  const allowance=Math.max(stallCoupling>.72?.20:.45,desiredStep*allowanceFraction*(1-.58*stallCoupling));
  const minStep=Math.max(0,desiredStep-allowance);
  const maxStep=desiredStep+allowance;
  const blended=candidateStepKm*(1-coupling)+desiredStep*coupling;
  const targetStep=clamp(blended,minStep,maxStep);
  const ratio=targetStep/candidateStepKm;
  const meanLat=(previous.lat+candidate.lat)*.5;
  const dx=(candidate.lon-previous.lon)*kmPerLon(meanLat);
  const dy=(candidate.lat-previous.lat)*111.12;
  return {
    lat:previous.lat+(dy*ratio)/111.12,
    lon:previous.lon+(dx*ratio)/kmPerLon(meanLat)
  };
}
function signedHeadingDeltaDeg(fromDeg:number,toDeg:number) {
  let d=((toDeg-fromDeg+540)%360)-180;
  if(d===-180)d=180;
  return d;
}

/**
 * Prevent a guidance step from orbiting around / doubling back across its baseline trajectory.
 *
 * Large cross-track spread is still allowed: this only constrains the *instantaneous 3-hour
 * heading* relative to the already-computed deterministic/model baseline.  A member can remain
 * hundreds of kilometres to either side and can build a genuine recurvature over many nodes, but
 * it cannot spend successive nodes travelling mostly backwards and draw the large semicircles that
 * appeared when a rotating local normal vector combined with a large cross-track displacement.
 */
function constrainGuidanceStepToBaselineHeading(
  previous:{lat:number;lon:number},
  candidate:{lat:number;lon:number},
  baselinePrevious:{lat:number;lon:number},
  baselineCurrent:{lat:number;lon:number},
  baselineStepKm:number,
  maxDeviationDeg:number
):{lat:number;lon:number} {
  const stepKm=guidanceDistanceKm(previous,candidate);
  if(stepKm<1e-6||baselineStepKm<0.75)return candidate;
  const baselineHeading=guidanceBearingDeg(baselinePrevious,baselineCurrent);
  const candidateHeading=guidanceBearingDeg(previous,candidate);
  const error=signedHeadingDeltaDeg(baselineHeading,candidateHeading);
  const allowed=clamp(maxDeviationDeg,18,82);
  if(Math.abs(error)<=allowed)return candidate;
  const limited=(baselineHeading+Math.sign(error)*allowed+360)%360;
  const a=limited*Math.PI/180;
  const east=Math.sin(a)*stepKm;
  const north=Math.cos(a)*stepKm;
  return {
    lat:previous.lat+north/111.12,
    lon:previous.lon+east/kmPerLon(previous.lat)
  };
}

/**
 * Remove node-scale triangular hooks from model-centre guidance without curve interpolation.
 * The output remains the native 3-hour polyline: only an individual candidate heading is capped
 * when it would abruptly reverse the previous bend. Genuine broad recurvature survives because
 * it accumulates across successive nodes instead of leaving and re-entering the track in one step.
 */
/**
 * Bound the *extra curvature* of a guidance path relative to its parent forecast. A heading-only
 * corridor is insufficient: a path can stay within that corridor at every 3-hour node yet keep
 * turning the same way for 24-48 hours and draw an artificial semicircle. This limiter preserves
 * the candidate step length and broad model separation, but only allows the model/member to add a
 * modest amount of curvature on top of the parent track's own turn at each node.
 */
function constrainGuidanceTurnToBaselineCurvature(
  track:AetherGuidancePoint[],
  candidate:{lat:number;lon:number},
  baselineOlder:{lat:number;lon:number},
  baselinePrevious:{lat:number;lon:number},
  baselineCurrent:{lat:number;lon:number},
  maxExtraTurnDeg:number
):{lat:number;lon:number} {
  if(track.length<2)return candidate;
  const prev=track[track.length-1],prev2=track[track.length-2];
  const candidateStep=guidanceDistanceKm(prev,candidate);
  const previousStep=guidanceDistanceKm(prev2,prev);
  const baselinePreviousStep=guidanceDistanceKm(baselineOlder,baselinePrevious);
  const baselineCurrentStep=guidanceDistanceKm(baselinePrevious,baselineCurrent);
  if(candidateStep<.75||previousStep<.75||baselinePreviousStep<.75||baselineCurrentStep<.75)return candidate;
  const previousHeading=guidanceBearingDeg(prev2,prev);
  const candidateHeading=guidanceBearingDeg(prev,candidate);
  const rawTurn=signedHeadingDeltaDeg(previousHeading,candidateHeading);
  const baselineOldHeading=guidanceBearingDeg(baselineOlder,baselinePrevious);
  const baselineHeading=guidanceBearingDeg(baselinePrevious,baselineCurrent);
  const baselineTurn=signedHeadingDeltaDeg(baselineOldHeading,baselineHeading);
  const extraTurn=signedHeadingDeltaDeg(baselineTurn,rawTurn);
  const limitedExtra=clamp(extraTurn,-Math.abs(maxExtraTurnDeg),Math.abs(maxExtraTurnDeg));
  if(Math.abs(extraTurn-limitedExtra)<1e-6)return candidate;
  const limitedTurn=baselineTurn+limitedExtra;
  const limitedHeading=(previousHeading+limitedTurn+360)%360;
  const a=limitedHeading*Math.PI/180;
  const east=Math.sin(a)*candidateStep;
  const north=Math.cos(a)*candidateStep;
  return {
    lat:prev.lat+north/111.12,
    lon:prev.lon+east/kmPerLon(prev.lat)
  };
}

function constrainCenterPolylineKink(
  track:AetherGuidancePoint[],
  candidate:{lat:number;lon:number},
  baselineStepKm:number
):{lat:number;lon:number} {
  if(track.length<2)return candidate;
  const prev=track[track.length-1],prev2=track[track.length-2];
  const prevStep=guidanceDistanceKm(prev2,prev);
  const candidateStep=guidanceDistanceKm(prev,candidate);
  // Preserve deliberate route-induced stalls. Direction is ill-defined when either adjacent step
  // is tiny, and forcing a bearing there can itself manufacture a hook when motion resumes.
  if(prevStep<1.0||candidateStep<1.0||baselineStepKm<0.65)return candidate;

  const previousHeading=guidanceBearingDeg(prev2,prev);
  const candidateHeading=guidanceBearingDeg(prev,candidate);
  const rawTurn=signedHeadingDeltaDeg(previousHeading,candidateHeading);
  // A TC can recurve substantially, but a 3-hour centre node should not make a 60-150 degree
  // excursion and immediately return. Faster translation receives a slightly tighter geometric
  // turn cap because the equivalent curvature radius is already larger.
  let maxTurnDeg=24-4*smoothstep((Math.max(prevStep,baselineStepKm)-28)/48);
  maxTurnDeg=clamp(maxTurnDeg,20,24);

  if(track.length>=3){
    const prev3=track[track.length-3];
    const olderHeading=guidanceBearingDeg(prev3,prev2);
    const previousTurn=signedHeadingDeltaDeg(olderHeading,previousHeading);
    // Opposite-sign consecutive sharp turns are the characteristic small-triangle artefact.
    // Strongly suppress only that reversal; same-sign turning remains free to build recurvature.
    if(previousTurn*rawTurn<0&&Math.abs(previousTurn)>14&&Math.abs(rawTurn)>14){
      maxTurnDeg=Math.min(maxTurnDeg,10+Math.min(6,Math.abs(previousTurn)*.16));
    }
  }
  if(Math.abs(rawTurn)<=maxTurnDeg)return candidate;

  const limitedHeading=(previousHeading+Math.sign(rawTurn)*maxTurnDeg+360)%360;
  const a=limitedHeading*Math.PI/180;
  const east=Math.sin(a)*candidateStep;
  const north=Math.cos(a)*candidateStep;
  return {
    lat:prev.lat+north/111.12,
    lon:prev.lon+east/kmPerLon(prev.lat)
  };
}

function diagnoseTranslation(track:AetherGuidancePoint[]) {
  if(track.length<2) return track.map((p)=>({...p,speed:Number.isFinite(p.speed)?p.speed:0,direction:Number.isFinite(p.direction)?p.direction:0}));
  const rawSpeed:number[]=new Array(track.length).fill(0);
  const rawDir:number[]=new Array(track.length).fill(0);
  for(let i=1;i<track.length;i++){
    const dt=Math.max(.25,Math.abs(track[i].leadHour-track[i-1].leadHour));
    rawSpeed[i]=guidanceDistanceKm(track[i-1],track[i])/dt;
    rawDir[i]=guidanceBearingDeg(track[i-1],track[i]);
  }
  rawSpeed[0]=rawSpeed[1];rawDir[0]=rawDir[1];
  return track.map((p,i)=>{
    // Keep only light diagnostic smoothing so deliberate model/member speed differences and
    // route-induced stalls remain visible. These speeds never feed back into track geometry.
    const prev=rawSpeed[Math.max(0,i-1)],cur=rawSpeed[i],next=rawSpeed[Math.min(rawSpeed.length-1,i+1)];
    const localFloor=Math.min(prev,next);
    const sharpSlowdown=cur<localFloor*.58;
    const speed=clamp(sharpSlowdown ? cur*.90+(prev+next)*.05 : prev*.10+cur*.80+next*.10,0,90);
    return {...p,speed,direction:rawDir[i]};
  });
}
function summariseTrack(modelId:AetherModelSpec["id"], track:AetherGuidancePoint[]) {
  const diagnosedTrack=diagnoseTranslation(track);
  return {
    track: diagnosedTrack,
    maxVmax: Math.max(...diagnosedTrack.map((p)=>p.vmax)),
    minPmin: Math.min(...diagnosedTrack.map((p)=>p.pmin)),
  };
}

function getGuidanceLandMetrics(lat:number, lon:number, config:SimulationConfig|undefined, useProductCoastline:boolean) {
  const base=getLandMetrics(lat,lon,config?.coastlineSource,true);
  if(!useProductCoastline)return base;
  const isLand=checkPointOnProductLandGeoJson(lat,lon);
  if(!isLand)return {isLand:false,elevation:0,landName:"海洋"};
  return {
    isLand:true,
    elevation:base.isLand?base.elevation:getProceduralElevation(lat,lon),
    landName:base.isLand?base.landName:"产品海岸线陆地"
  };
}


const GUIDANCE_ZERO_SURFACE:CoreSurfaceInteractionMetrics={landFraction:0,mountainFraction:0,meanLandElevation:0,maxElevation:0,frictionIndex:0,frictionAsymmetry:0,blockingIndex:0,dominantBearingDeg:0};
const guidanceCoreSurfaceCache=new Map<string,CoreSurfaceInteractionMetrics>();

/**
 * Lightweight counterpart of Engine.getCoreSurfaceInteractionMetrics for the eight synchronous
 * centre-guidance tracks drawn on the live map. It samples the same inner/outer core concept at
 * eight azimuths and uses the coarse terrain cache. Explicit ensemble members still use the full
 * Engine sampler. This keeps Taiwan/high-mountain blocking visible without doing 33 fresh terrain
 * lookups for every model node on the UI thread.
 */
function getFastGuidanceCoreSurfaceInteraction(
  lat:number,lon:number,safeRmw:number,vmax:number,source:string|undefined,center:{isLand:boolean;elevation:number}
):CoreSurfaceInteractionMetrics {
  const innerRadius=Math.max(18,Math.min(105,safeRmw*.88));
  const outerRadius=Math.max(innerRadius+10,Math.min(165,safeRmw*1.55));
  const cosLat=Math.max(.22,Math.cos(lat*Math.PI/180));
  const sectorCount=8;
  const innerElev:number[]=new Array(sectorCount).fill(0);
  const outerElev:number[]=new Array(sectorCount).fill(0);
  const innerLand:boolean[]=new Array(sectorCount).fill(false);
  const outerLand:boolean[]=new Array(sectorCount).fill(false);
  let weightedLand=center.isLand?.12:0;
  let weightedMountain=center.isLand&&center.elevation>=650?.12:0;
  let weightedElevation=center.isLand?.12*center.elevation:0;
  let elevationWeight=center.isLand?.12:0;
  let maxElevation=center.isLand?center.elevation:0;
  const radii=[innerRadius,outerRadius],ringWeights=[.58,.30];
  for(let ring=0;ring<2;ring++){
    const perPoint=ringWeights[ring]/sectorCount;
    for(let i=0;i<sectorCount;i++){
      const a=i*Math.PI*2/sectorCount;
      const m=getLandMetrics(lat+radii[ring]*Math.cos(a)/111.12,lon+radii[ring]*Math.sin(a)/(111.12*cosLat),source,true);
      if(ring===0){innerLand[i]=m.isLand;innerElev[i]=m.isLand?Number(m.elevation||0):0;}
      else {outerLand[i]=m.isLand;outerElev[i]=m.isLand?Number(m.elevation||0):0;}
      if(!m.isLand)continue;
      const elev=Number(m.elevation||0);
      weightedLand+=perPoint;elevationWeight+=perPoint;weightedElevation+=perPoint*elev;
      if(elev>=650)weightedMountain+=perPoint;
      maxElevation=Math.max(maxElevation,elev);
    }
  }
  let dragX=0,dragY=0,dragTotal=0,blocking=0;
  for(let i=0;i<sectorCount;i++){
    if(!innerLand[i]&&!outerLand[i])continue;
    const meanElev=.58*innerElev[i]+.42*outerElev[i];
    const relief=Math.abs(outerElev[i]-innerElev[i])/Math.max(12,outerRadius-innerRadius);
    const rugged=smoothstep((relief-2)/18);
    const elevGate=smoothstep((meanElev-180)/1600);
    const landShare=(innerLand[i]?.64:0)+(outerLand[i]?.36:0);
    const drag=landShare*(.00425+.00135*rugged+.00075*elevGate);
    const a=i*Math.PI*2/sectorCount;
    dragX+=drag*Math.sin(a);dragY+=drag*Math.cos(a);dragTotal+=drag;
    blocking+=(.88/sectorCount)*landShare*(.58*elevGate+.42*rugged);
  }
  const windWork=clamp(vmax/50,.32,1.35);
  const meanElev=elevationWeight>1e-8?weightedElevation/elevationWeight:0;
  const roughnessBoost=.82+.18*smoothstep((meanElev-120)/1680);
  const frictionIndex=clamp(weightedLand*1.34*roughnessBoost*windWork,0,1);
  return {
    landFraction:clamp(weightedLand,0,1),mountainFraction:clamp(weightedMountain,0,1),
    meanLandElevation:meanElev,maxElevation,
    frictionIndex,
    frictionAsymmetry:clamp(dragTotal>1e-8?Math.hypot(dragX,dragY)/dragTotal:0,0,1),
    blockingIndex:clamp(blocking*clamp(1.08-Math.max(0,vmax-25)/190,.68,1.08),0,1),
    dominantBearingDeg:dragTotal>1e-8?((Math.atan2(dragX,dragY)*180/Math.PI)+360)%360:0
  };
}

function getGuidanceCoreSurfaceInteraction(
  lat:number,lon:number,rmwKm:number,vmax:number,config:SimulationConfig|undefined,fastCentre=false,
  knownCenter?:{isLand:boolean;elevation:number}
):CoreSurfaceInteractionMetrics {
  const source=config?.coastlineSource;
  const safeRmw=clamp(Number.isFinite(rmwKm)?rmwKm:30,16,105);
  const outerRadiusKm=Math.max(safeRmw*.58+22,Math.min(165,safeRmw*1.55));
  const center=fastCentre&&knownCenter?knownCenter:getLandMetrics(lat,lon,source,true);

  // Centre guidance is rebuilt synchronously by MapView. Restore the 5.2.21 performance profile:
  // while the centre remains over water, do not run any RMW terrain-sector diagnosis on the UI
  // thread. Explicit ensemble members below still use the full near-coast sampler, so landfall
  // spread/damage remains physically detailed where it matters in the ensemble product.
  if(fastCentre&&!center.isLand)return GUIDANCE_ZERO_SURFACE;

  // Explicit members are calculated asynchronously. For them, retain inner-core coastal contact,
  // but avoid the 33-point Engine sampler when the entire outer core is safely offshore.
  if(!fastCentre&&!center.isLand && typeof getDistanceToLand==="function"){
    const coastDistanceKm=Math.max(0,getDistanceToLand(lat,lon,source,true)*111.12);
    if(coastDistanceKm>outerRadiusKm+32)return GUIDANCE_ZERO_SURFACE;
  }

  // Centre guidance is synchronous UI work, so it has a coarser cache. Explicit ensemble members
  // retain the denser cache and the full Engine terrain sampler below.
  const key=`${fastCentre?"C":"M"}|${Math.round(lat*(fastCentre?12:25))}|${Math.round(lon*(fastCentre?12:25))}|${Math.round(safeRmw/(fastCentre?5:3))}|${Math.round(vmax/(fastCentre?5:3))}|${source||"default"}`;
  const cached=guidanceCoreSurfaceCache.get(key);
  if(cached)return cached;

  let result:CoreSurfaceInteractionMetrics;
  if(fastCentre){
    result=getFastGuidanceCoreSurfaceInteraction(lat,lon,safeRmw,vmax,source,center);
  }else if(typeof getCoreSurfaceInteractionMetrics==="function"){
    result=getCoreSurfaceInteractionMetrics(lat,lon,safeRmw,vmax,source);
  }else{
    if(!center.isLand)return GUIDANCE_ZERO_SURFACE;
    const elevationGate=smoothstep((Number(center.elevation||0)-120)/1680);
    result={
      landFraction:.52,
      mountainFraction:Number(center.elevation||0)>=650?.34:0,
      meanLandElevation:Number(center.elevation||0),maxElevation:Number(center.elevation||0),
      frictionIndex:clamp(.48+.30*elevationGate,0,1),frictionAsymmetry:.18,
      blockingIndex:clamp(.44*elevationGate,0,1),dominantBearingDeg:0
    };
  }
  guidanceCoreSurfaceCache.set(key,result);
  if(guidanceCoreSurfaceCache.size>4096){
    const first=guidanceCoreSurfaceCache.keys().next().value;if(first)guidanceCoreSurfaceCache.delete(first);
  }
  return result;
}

/**
 * Strong forecast-peak guidance without collapsing ensemble spread. The configured peak produces
 * one common additive intensity translation at each lead time; members are never individually
 * clipped toward the target. Therefore model/member differences at the same lead are retained.
 */
function applyForecastPeakTranslation(
  members:AetherGuidanceMember[], storm:Typhoon, currentHour:number, referencePath:any[], horizon:number, config:SimulationConfig|undefined
):AetherGuidanceMember[]{
  const target=config?.forecastPeakIntensityEnabled?Number(config.forecastPeakIntensityReference):NaN;
  if(!Number.isFinite(target)||!members.length)return members;
  const ref=normalizeReference(storm,referencePath,currentHour,horizon);
  const future=ref.filter((p)=>p.lead>0&&p.lead<=horizon+1e-6);
  if(!future.length)return members;
  const referencePeak=Math.max(...future.map((p)=>Number(p.vmax||0)));
  // ~92% of the gap is transferred to the entire ensemble distribution. This is deliberately
  // much stronger than the old indirect deterministic-reference coupling, but remains a soft
  // aspiration rather than a hard cap.
  const commonPeakShift=clamp((clamp(target,5,110)-referencePeak)*.92,-42,42);
  if(Math.abs(commonPeakShift)<.03)return members;

  return members.map((member)=>{
    const translated=member.track.map((pt)=>{
      if(pt.leadHour<=0)return pt;
      const refPt=interpolateRef(ref,clamp(pt.leadHour,0,horizon));
      const ramp=smoothstep(pt.leadHour/18);
      // Common lead-time gate only: never inspect this member's own anomaly when deciding how
      // much to translate, which is what preserves the existing intensity dispersion.
      const tropicalGate=.32+.68*smoothstep((Number(refPt.vmax||0)-12)/24);
      const delta=commonPeakShift*ramp*tropicalGate;
      const vmax=Math.max(3.5,pt.vmax+delta);
      const pmin=pressureFromIntensityOffset(pt.pmin,pt.vmax,vmax);
      return {...pt,vmax,pmin};
    });
    const summary=summariseTrack(member.modelId,translated);
    return {...member,track:summary.track,maxVmax:summary.maxVmax,minPmin:summary.minPmin};
  });
}

function configuredGuidanceTargetIntensity(config:SimulationConfig|undefined, initialVmax:number):number|null {
  // When the dedicated forecast-peak override is OFF, the live simulator's manually configured
  // intensity target remains the governing soft envelope for guidance. This applies in both
  // directions: a target below the analysis requests gradual weakening, while a higher target
  // constrains how quickly / how far ensemble members may outrun the target-aware deterministic
  // solution. 115 m/s and above is playground mode in the live Engine and must not become a hidden
  // forecast ceiling.
  if(config?.forecastPeakIntensityEnabled || !config?.maxIntensityLimitEnabled)return null;
  const target=Number(config.maxIntensityLimit);
  if(!Number.isFinite(target) || target>=115)return null;
  return clamp(target,3.5,110);
}

function guidanceTargetDecayDurationHours(initialVmax:number,targetVmax:number,env:GuidanceEnvironment,landed:boolean):number {
  const gap=Math.abs(initialVmax-targetVmax);
  const intensityFactor=clamp((initialVmax-32.7)/40,0,1);
  const environmentalAdversity=clamp(
    0.32*clamp((env.shear-12)/22,0,1)+
    0.26*clamp(env.dry,0,1)+
    0.24*clamp((27-env.sst)/4,0,1)+
    (landed?0.34:0),0,1
  );
  // Weakening targets react faster in hostile conditions; strengthening targets establish their
  // envelope more slowly when the environment cannot support rapid organisation. This is only the
  // response time of the user target -- the actual member still follows its own SST/shear/dry-air,
  // terrain and structural-memory physics.
  const strengthening=targetVmax>initialVmax;
  const resistance=strengthening
    ? 1.02+0.40*environmentalAdversity+0.08*intensityFactor
    : 1.18-0.34*environmentalAdversity+0.12*intensityFactor;
  return clamp((10+0.66*gap+8*intensityFactor)*resistance,8,72);
}

function guidanceTargetErrorScale(leadHour:number,horizon:number,isExtremeTail=false):number {
  // Only the *interpretation error of the configured target* contracts with lead time. Intrinsic
  // member physics (peak bias, RI response, dry-air mixing, terrain damage, etc.) must retain
  // its own spread and is intentionally NOT multiplied by this factor. This keeps the requested
  // convergence toward the simulator target without collapsing the ensemble into one intensity.
  const contraction=smoothstep((leadHour-18)/Math.max(42,Math.min(108,horizon-18)));
  const floor=isExtremeTail?.76:.38;
  return 1-(1-floor)*contraction;
}

function guidanceTargetTailEnvelope(leadHour:number):number {
  return .22+.78*smoothstep((leadHour-12)/72);
}

function applyGuidanceTargetDecay(
  candidate:number,prevVmax:number,initialVmax:number,targetVmax:number|null,leadHour:number,durationHours:number,responseScale:number
):number {
  if(targetVmax==null || leadHour<=0)return candidate;
  const progress=clamp(leadHour/Math.max(3,durationHours),0,1);
  const desired=targetVmax+(initialVmax-targetVmax)*Math.pow(1-progress,1.55);
  // The target is an evolving upper/weakening envelope rather than a hard clip. For a target above
  // the analysed wind this prevents an ensemble member from unrealistically sprinting to (or far
  // beyond) the requested peak before the deterministic/physical solution can support it. For a
  // lowered target the identical equation produces the gradual weakening behaviour already used by
  // the live simulator. Members below the envelope are never artificially intensified by this term.
  const previousExcess=Math.max(0,prevVmax-desired);
  const candidateExcess=Math.max(0,candidate-desired);
  const terminalExcess=progress>=0.98?Math.max(0,candidate-targetVmax):0;
  const pull=Math.max(
    previousExcess*(0.10+0.15*progress),
    candidateExcess*(0.15+0.19*progress),
    terminalExcess*0.22
  )*clamp(responseScale,0.02,1.60);
  // A strengthening target is a soft forecast envelope, not a deterministic ceiling. Keep enough
  // authority to pull the distribution toward the configured target, while still allowing the
  // physically supported upper tail to remain several m/s above it. Lowered targets retain the
  // stronger live-simulator-like weakening authority.
  const strengtheningAuthority=targetVmax>initialVmax+.35?(0.38+0.09*progress):1;
  return candidate-pull*strengtheningAuthority;
}

function genesisSpreadFactor(vmax:number) {
  const developing=clamp((23-vmax)/14,0,1);
  const depression=clamp((17.2-vmax)/8.5,0,1);
  return 1 + .88*developing + .46*depression;
}

function manualForecastIntensityTarget(config:SimulationConfig|undefined,leadHour:number):number|null {
  if(!config?.manualForecastRouteEnabled||!config?.manualForecastIntensityEnabled)return null;
  const pts=(config.manualForecastIntensityCurve||[])
    .map(p=>({lead:Number(p.leadHour),v:Number(p.vmax)}))
    .filter(p=>Number.isFinite(p.lead)&&Number.isFinite(p.v))
    .sort((a,b)=>a.lead-b.lead);
  if(!pts.length)return null;
  const lead=Math.max(0,Number(leadHour)||0);
  if(lead<=pts[0].lead)return clamp(pts[0].v,5,85);
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];
    if(lead<=b.lead+1e-6){
      const t=clamp((lead-a.lead)/Math.max(1e-6,b.lead-a.lead),0,1);
      return clamp(a.v+(b.v-a.v)*t,5,85);
    }
  }
  return clamp(pts[pts.length-1].v,5,85);
}

function guidanceIntensityBlend(f:number) {
  const spinUp = smoothstep((f - 0.05) / 0.22);
  const fadeTail = 1 - 0.18 * smoothstep((f - 0.88) / 0.10);
  return spinUp * fadeTail;
}

function peakIntensitySpreadMps(initialVmax:number, lead:number) {
  const genesisUncertainty = clamp((30-initialVmax)/18,0,1);
  const depressionExtra = clamp((17.2-initialVmax)/9,0,1);
  return 2.6 + 6.8*genesisUncertainty + 4.6*depressionExtra + 2.6*smoothstep((lead-36)/84);
}

/** Do not interpret a newly analysed, environmentally viable depression/TS as an obligatory decay case.
 * A temporary *early-lead* prior prevents every model collapsing immediately after issuance;
 * poor SST, strong shear, documented core dry-air exposure and land disable this safeguard.
 * This is an uncertainty prior, not a new deterministic intensification forecast. */
function earlyTropicalStormDevelopment(storm:Partial<Typhoon>, config:SimulationConfig|undefined,
  env:GuidanceEnvironment):number {
  const wind=Number(storm.vmax||0);
  if(wind<5||wind>=26||storm.landed||Number(config?.intensificationRate??1)<=0)return 0;
  const forecastPeakRef=config?.forecastPeakIntensityEnabled && Number.isFinite(Number(config?.forecastPeakIntensityReference))
    ? Number(config.forecastPeakIntensityReference) : null;
  const limit=forecastPeakRef != null ? forecastPeakRef : (config?.maxIntensityLimitEnabled && config?.maxIntensityLimit != null
    ? Number(config.maxIntensityLimit) : 95);
  if(limit<=wind+0.5)return 0;
  const sst=smoothstep((env.sst-26.5)/1.6);
  const shear=1-smoothstep((env.shear-14)/12);
  const dryness=1-smoothstep((Math.max(env.dry,Number(storm.dryAirCoreExposure||0))-0.32)/0.46);
  const weakVortexGate=.56+.44*smoothstep((wind-5)/12.2);
  const integrityGate=.62+.38*clamp(Number(storm.lowLevelVortexIntegrity??.58),0,1);
  return clamp(sst*shear*dryness*weakVortexGate*integrityGate*clamp(Number(config?.intensificationRate??1),0,1),0,1);
}
function keepViableGenesisFromInstantCollapse(vmax:number,lead:number,initialVmax:number,
  support:number,weakBranch:boolean):number {
  if(support<0.35||lead<=0||lead>30||weakBranch)return vmax;
  const floor=initialVmax-0.35-0.024*lead+1.10*support*smoothstep(lead/18);
  const fade=1-smoothstep((lead-21)/9);
  return Math.max(vmax,initialVmax+(floor-initialVmax)*fade-(1-fade)*2.8);
}

function maxSixHourRise(prevVmax:number, referenceStep:number, rateScale:number, remnantBoost=0) {
  // Six-hour intensity changes in the ensemble should not simply inherit the fastest deterministic
  // AETHER intensification rate. Most members represent ordinary organization; only the upper tail
  // of the rate distribution should retain a credible RI-like response. The cap also tightens once
  // an already intense core is established, preventing 50-60 m/s storms from climbing several
  // metres per second every six hours for days at a time.
  // Genesis-stage members need room for both failed organization and genuinely fast development.
  // The old 2.25 m/s shelf strongly clipped the positive tail and made fresh TD ensembles look
  // systematically too weak even when the deterministic environment supported strengthening.
  const structuralCap = prevVmax < 10 ? 3.15 : prevVmax < 17.2 ? 3.55 : prevVmax < 32.7 ? 2.85 : prevVmax < 51 ? 2.45 : 1.75;
  const riAllowance = clamp((referenceStep-3.4)/4.8,0,1)*0.95;
  return (structuralCap + riAllowance + remnantBoost) * clamp(rateScale,0.54,1.16);
}

function maxSixHourFall(prevVmax:number, landed:boolean, weakeningScale:number) {
  const base = landed ? (prevVmax>45?10.5:prevVmax>25?8.0:5.6) : (prevVmax>45?6.2:4.8);
  return base * clamp(weakeningScale,0.72,1.42);
}

function pressureFromIntensityOffset(basePmin:number, baseVmax:number, vmax:number, pressureNoise=0) {
  const delta=vmax-baseVmax;
  return clamp(basePmin-delta*(delta>=0?1.42:1.05)+pressureNoise,0,1045);
}

function remnantFloor(point:RefPoint|AetherGuidancePoint, survival:number) {
  const integrity=clamp(Number(point.lowLevelVortexIntegrity??.35),0,1);
  return 5.0 + 8.8*integrity*clamp(survival,.35,1.25);
}


/**
 * Ensemble structural-damage memory deliberately mirrors the live Engine terrain lifecycle.
 * The guidance track still runs at 3 h cadence, but the forcing terms, thresholds and recovery
 * time-scales below are the same physical concepts used by the 10-minute simulator: sampled
 * inner-core drag, one-sided friction, orographic blocking, rebuild scar and the persistent
 * hollow-core memory created by a destructive mountain crossing.
 */
interface GuidanceStructuralDamageState {
  structuralSeverity:number;
  coreRebuildScar:number;
  terrainHollowCoreMemory:number;
  terrainFrictionWork:number;
  terrainBlockingMemory:number;
  terrainFrictionAsymmetry:number;
  warmWaterHoursAfterSea:number;
  recentLand:boolean;
  landHours:number;
  structuralDamageHours:number;
}

interface GuidanceStructuralDamageStep {
  terrainMemory:number;
  totalStructuralMemory:number;
  structuralPenaltyFactor:number;
  coreRebuildScar:number;
  terrainHollowCoreMemory:number;
  directIntensityLossMps:number;
  coreDisrupted:boolean;
  lowLevelIntegrityScale:number;
}

function summariseGuidanceStructuralDamage(state:GuidanceStructuralDamageState,directIntensityLossMps=0):GuidanceStructuralDamageStep {
  const terrainMemory=clamp(Math.max(
    state.terrainHollowCoreMemory,
    state.terrainBlockingMemory,
    .78*state.coreRebuildScar,
    .72*state.structuralSeverity,
    clamp(state.terrainFrictionWork/18,0,1)*.44
  ),0,1);
  const structuralPenaltyFactor=clamp((1-.82*state.structuralSeverity)*(1-.48*state.coreRebuildScar)*(1-.50*state.terrainHollowCoreMemory),.035,1);
  const totalStructuralMemory=clamp(1-(1-terrainMemory)*(1-state.structuralSeverity),0,1);
  const lowLevelIntegrityScale=clamp(1-.48*state.structuralSeverity-.34*state.coreRebuildScar-.52*state.terrainHollowCoreMemory,.08,1);
  return {
    terrainMemory,totalStructuralMemory,structuralPenaltyFactor,
    coreRebuildScar:state.coreRebuildScar,terrainHollowCoreMemory:state.terrainHollowCoreMemory,
    directIntensityLossMps,coreDisrupted:state.structuralSeverity>=.56||state.terrainHollowCoreMemory>=.34,
    lowLevelIntegrityScale
  };
}

function createGuidanceStructuralDamageState(storm:Partial<Typhoon>):GuidanceStructuralDamageState {
  const structuralSeverity=clamp(Math.max(
    1-Number(storm.structuralDamagePenaltyFactor??1),
    storm.isCoreDisrupted?.68:0,
    storm.isStructureDamaged?.12:0
  ),0,1);
  return {
    structuralSeverity,
    coreRebuildScar:clamp(Number(storm.coreRebuildScar||0),0,1),
    terrainHollowCoreMemory:clamp(Number(storm.terrainHollowCoreMemory||0),0,1),
    terrainFrictionWork:Math.max(0,Number(storm.terrainFrictionWork||0)),
    terrainBlockingMemory:clamp(Number(storm.terrainBlockingMemory||0),0,1),
    terrainFrictionAsymmetry:clamp(Number(storm.terrainFrictionAsymmetry||0),0,1),
    warmWaterHoursAfterSea:Math.max(0,Number(storm.warmWaterHoursAfterSea||0)),
    recentLand:!!storm.landed||Number(storm.warmWaterHoursAfterSea||0)>0||Number(storm.terrainFrictionWork||0)>.08||Number(storm.coreRebuildScar||0)>.08||Number(storm.terrainHollowCoreMemory||0)>.04,
    landHours:storm.landed?Math.max(3,Number(storm.landHours||0)):0,
    structuralDamageHours:Math.max(0,Number(storm.structuralDamageHours||0))
  };
}

function guidanceRmwKm(storm:Partial<Typhoon>,vmax:number,scale=1):number {
  const initialV=Math.max(12,Number(storm.vmax||vmax||25));
  const analysed=clamp(Number(storm.rmw||30),14,105);
  // Preserve the analysed RMW but allow the usual broadening as a member weakens. This is only
  // used to place the same inner/outer terrain-sampling rings as the live Engine.
  return clamp(analysed*Math.sqrt(initialV/Math.max(12,vmax))*clamp(scale,.82,1.22),14,110);
}

function stepGuidanceStructuralDamage(
  state:GuidanceStructuralDamageState,
  interaction:CoreSurfaceInteractionMetrics,
  centerLanded:boolean,
  env:GuidanceEnvironment,
  vmax:number,
  dtHours:number,
  frictionScale:number,
  baseCoreCompactness:number,
  baseEyewallIntegrity:number
):GuidanceStructuralDamageStep {
  if(dtHours<=0)return summariseGuidanceStructuralDamage(state,0);
  const dt=dtHours;
  const instantaneousAsym=clamp(interaction.frictionAsymmetry,0,1);
  const instantaneousBlocking=clamp(interaction.blockingIndex,0,1);
  state.terrainFrictionAsymmetry+=(instantaneousAsym-state.terrainFrictionAsymmetry)*
    (1-Math.exp(-dt/(instantaneousAsym>state.terrainFrictionAsymmetry?1.2:7.0)));
  state.terrainBlockingMemory+=(instantaneousBlocking-state.terrainBlockingMemory)*
    (1-Math.exp(-dt/(instantaneousBlocking>state.terrainBlockingMemory?1.4:9.0)));
  state.terrainFrictionAsymmetry=clamp(state.terrainFrictionAsymmetry,0,1);
  state.terrainBlockingMemory=clamp(state.terrainBlockingMemory,0,1);

  const coreContact=interaction.landFraction>=.018||interaction.frictionIndex>=.018||interaction.blockingIndex>=.018||centerLanded;
  const inferredCompactness=clamp(.45*baseCoreCompactness+.55*smoothstep((vmax-24)/34),0,1);
  const inferredEyewall=clamp(.35*baseEyewallIntegrity+.65*smoothstep((vmax-27)/30),0,1);
  const established=vmax>=27&&(inferredCompactness>=.46||inferredEyewall>=.40||state.coreRebuildScar>.12||state.terrainHollowCoreMemory>.06);
  let directIntensityLossMps=0;

  if(coreContact){
    state.warmWaterHoursAfterSea=0;
    state.recentLand=true;
    state.landHours=centerLanded?Math.min(120,state.landHours+dt):0;
    if(established||state.structuralSeverity>.06||state.coreRebuildScar>.08||state.terrainHollowCoreMemory>.04){
      state.structuralDamageHours+=dt;
      state.terrainFrictionWork=Math.min(96,state.terrainFrictionWork+dt*(.72*interaction.frictionIndex+.28*interaction.blockingIndex));
      const resilience=.86+.30*inferredCompactness+.18*inferredEyewall;
      const frictionForcing=clamp(interaction.frictionIndex/Math.max(.6,resilience),0,1);
      const blockingForcing=clamp(interaction.blockingIndex*(.72+.28*clamp((vmax-20)/45,0,1)),0,1);
      const partialContact=clamp(4*interaction.landFraction*(1-interaction.landFraction)+.22*interaction.landFraction,0,1);
      const asymmetricForcing=clamp(state.terrainFrictionAsymmetry*(.48+.52*partialContact),0,1);
      const highTerrainGate=smoothstep((interaction.maxElevation-700)/1500);
      const mountainCoverageGate=smoothstep((interaction.mountainFraction-.035)/.30);
      const deepCoreLandGate=smoothstep((interaction.landFraction-.075)/.52);
      const mountainShock=clamp(.46*highTerrainGate+.30*mountainCoverageGate+.24*deepCoreLandGate,0,1);
      const damageRate=clamp(.078*frictionForcing+.165*blockingForcing+.058*asymmetricForcing+.105*mountainShock,0,1);
      state.structuralSeverity=clamp(1-(1-state.structuralSeverity)*Math.exp(-damageRate*dt),0,1);
      const scarRate=clamp(.018*frictionForcing+.072*blockingForcing+.027*asymmetricForcing+.060*mountainShock,0,1);
      state.coreRebuildScar=clamp(1-(1-state.coreRebuildScar)*Math.exp(-scarRate*dt),0,1);

      const hollowScore=clamp(.48*state.terrainBlockingMemory+.22*interaction.mountainFraction+.22*state.structuralSeverity+.18*mountainShock-.10*state.terrainFrictionAsymmetry,0,1);
      const hollowForcing=clamp(
        .34*state.terrainBlockingMemory+.20*interaction.mountainFraction+.18*highTerrainGate+
        .12*deepCoreLandGate+.10*state.structuralSeverity+.06*state.terrainFrictionAsymmetry,0,1
      );
      const destructiveMountainStrike=established&&interaction.maxElevation>=780&&interaction.mountainFraction>=.045&&
        interaction.landFraction>=.075&&hollowForcing>=.28&&(hollowScore>=.34||state.terrainBlockingMemory>=.22||mountainShock>=.52);
      if(destructiveMountainStrike){
        const irreversibleRate=.17+.46*hollowForcing+.12*mountainShock;
        state.terrainHollowCoreMemory=clamp(1-(1-state.terrainHollowCoreMemory)*Math.exp(-irreversibleRate*dt),0,1);
      }
      // Additional inner-core friction/blocking loss. A compact intense cyclone crossing a high
      // island must be able to lose a full category within one or two 3-h guidance nodes; the
      // ordinary centre-point land decay alone was far too weak for Taiwan-scale terrain.
      const intensityLoad=.58+.78*smoothstep((vmax-20)/36);
      directIntensityLossMps=dt*clamp(frictionScale,.72,1.35)*intensityLoad*clamp(
        .055*frictionForcing+.155*blockingForcing+.080*interaction.mountainFraction+
        .120*state.terrainHollowCoreMemory+.115*mountainShock,0,.92
      );
    }
  }else{
    state.landHours=0;
    state.terrainFrictionWork*=Math.exp(-dt/42);
    const hadMemory=state.structuralSeverity>.025||state.coreRebuildScar>.025||state.terrainFrictionWork>.08||state.terrainBlockingMemory>.04||state.terrainHollowCoreMemory>.04;
    if(hadMemory){
      if(env.sst>=26.0)state.warmWaterHoursAfterSea+=dt*(env.sst>=28.5?1:.72);
      else state.warmWaterHoursAfterSea=Math.max(0,state.warmWaterHoursAfterSea-.20*dt);
      const warmSupport=clamp((env.sst-26.2)/3.2,0,1);
      const ohcSupport=clamp(env.ohc/100,0,1);
      const humiditySupport=clamp((env.rh-50)/30,0,1);
      const shearSupport=1-clamp((env.shear-8)/22,0,1);
      const recoverySupport=clamp(.31*warmSupport+.23*ohcSupport+.19*humiditySupport+.16*shearSupport+.11*.90,0,1);
      const warmBoost=smoothstep((state.warmWaterHoursAfterSea-4)/12);
      const recoveryDelay=smoothstep((state.warmWaterHoursAfterSea-8)/16);
      const recoveryTau=Math.max(10,34-12*recoverySupport-4*warmBoost+11*state.structuralSeverity+10*state.coreRebuildScar);
      state.structuralSeverity*=Math.exp(-dt*recoveryDelay/recoveryTau);
      const scarTau=Math.max(38,66-16*recoverySupport-8*warmBoost);
      state.coreRebuildScar*=Math.exp(-dt*recoveryDelay/scarTau);
      // A severed mountain-crossing inner ring is quasi-persistent. While that ring is rebuilding,
      // frictional imbalance and collapsed inflow continue to weaken the circulation for several
      // hours after the centre has returned to water; do not snap back to the parent ocean track.
      const postLandGate=1-smoothstep((state.warmWaterHoursAfterSea-4)/30);
      const collapseMemory=clamp(Math.max(state.terrainHollowCoreMemory,.72*state.coreRebuildScar,.68*state.structuralSeverity,.62*state.terrainBlockingMemory),0,1);
      const postLandIntensity=.52+.72*smoothstep((vmax-22)/34);
      directIntensityLossMps=dt*postLandGate*collapseMemory*postLandIntensity*.72;
      // Deliberately no ordinary warm-water decay of terrainHollowCoreMemory. The live Engine treats
      // a severed mountain-crossing inner ring as quasi-persistent unless an explicit rebuild acts.
      if(state.warmWaterHoursAfterSea>102&&state.structuralSeverity<.05&&state.coreRebuildScar<.085&&state.terrainFrictionWork<.08&&state.terrainHollowCoreMemory<.04){
        state.recentLand=false;
        state.structuralDamageHours=0;
      }
    }else{
      state.warmWaterHoursAfterSea=0;
      state.recentLand=state.terrainHollowCoreMemory>=.04;
    }
  }

  return summariseGuidanceStructuralDamage(state,directIntensityLossMps);
}

function applyGuidanceVentilationScar(
  state:GuidanceStructuralDamageState, dryMemory:number, shear:number, rh:number, vmax:number, dtHours:number
){
  const shearStress=clamp((shear-16)/18,0,1);
  const humidityStress=clamp((55-rh)/25,0,1);
  const ventilation=clamp(Math.max(dryMemory*.92,shearStress*.86),0,1);
  const target=clamp(.58*ventilation+.22*shearStress+.20*humidityStress,0,1);
  const established=vmax>=27;
  if(established&&target>.42){
    const tau=10-5*clamp((target-.30)/.70,0,1);
    state.coreRebuildScar+=Math.max(0,target-state.coreRebuildScar)*clamp(dtHours/Math.max(3.5,tau),0,1);
    if(target>.78&&dryMemory>.44&&ventilation>.66){
      state.structuralSeverity=Math.max(state.structuralSeverity,clamp(.16+.34*target,0,1));
    }
  }
  state.coreRebuildScar=clamp(state.coreRebuildScar,0,1);
  state.structuralSeverity=clamp(state.structuralSeverity,0,1);
}

function buildAetherCenterGuidanceRaw(storm:Typhoon,currentHour:number,scene:readonly Partial<Typhoon>[],seed:string,referencePath:any[],horizon=168,configOverride?:SimulationConfig,useProductCoastline=false,pathOnly=false):AetherGuidanceMember[]{
  const ref=normalizeReference(storm,referencePath,currentHour,horizon);
  // Keep the exact deterministic reference for position/timing, including manual-route stalls.
  // A separately smoothed copy is used ONLY to define the local tangent/normal frame. This avoids
  // rotating a model's already accumulated cross-track displacement around every small reference
  // bend while leaving the deterministic speed clock completely untouched.
  const geometryRef=smoothReference(ref);
  const earlySpreadBoost=genesisSpreadFactor(Number(storm.vmax||0));
  const effectiveHorizon=Math.max(6,Math.min(horizon,ref[ref.length-1]?.lead||horizon));
  const config=configOverride||storm.configSnapshot;
  const issueRegime=buildIssueRegime(seed,currentHour,storm,effectiveHorizon);
  const raw=calculateHurricaneTrackerGuidanceTracks(storm,currentHour,scene,seed,referencePath,effectiveHorizon);
  const gfs=raw.find(r=>r.spec.name==="GFS")||raw[0];
  const sharedRand=rng(`${seed}|CENTER|SHARED|${Math.floor(currentHour/6)}`);
  const sharedCrossKnots=cumulativeKnots(sharedRand,6,.34);
  const sharedAlongKnots=cumulativeKnots(sharedRand,6,.27);
  // Round 4's smoothly correlated issue-wide displacement survives alongside the later
  // integrated ridge/trough steering. Shape perturbations are GEOMETRY ONLY.
  const legacySharedCross=Array.from({length:6},(_,k)=>k===0?0:normal(sharedRand)*.65);
  const legacySharedAlong=Array.from({length:6},(_,k)=>k===0?0:normal(sharedRand)*.55);
  const legacySharedPhase=sharedRand()*Math.PI*2;
  return AETHER_MODEL_SPECS.map((spec,modelIdx)=>{
    // Live-map guidance is geometry-only. Do not even construct the environmental/intensity
    // sampler there; full thermodynamic/terrain intensity integration is deferred until a product
    // actually requests ensemble guidance.
    const sampleEnvironment=pathOnly ? null : makeEnvironmentSampler(config,storm,`${seed}|ENV-CENTER|${spec.id}|${Math.floor(currentHour/6)}`,.55);
    const source:HurricaneTrackerModelTrack|undefined=raw[spec.sourceIndex%Math.max(1,raw.length)];
    const n=Math.max(1,Math.ceil(effectiveHorizon/3));
    const track:AetherGuidancePoint[]=[];
    let smoothCross=0,smoothAlong=0,prevAppliedCross=0,prevAppliedAlong=0;
    // Translation-speed disagreement is integrated as a bounded timing offset instead of scaling
    // every parent displacement forever. This keeps model speed differences visible without
    // allowing a day-5/7 model to drift hundreds of kilometres purely because of a persistent
    // multiplicative speed bias.
    let modelTimingOffsetKm=0;
    // Each guidance family receives a deterministic synoptic-shape signature. It is stable for
    // the issue time but has several broad bends/timing regimes, avoiding eight near-straight
    // spokes that converge into the old "mop" appearance.
    const modelRand=rng(`${seed}|CENTER|${spec.id}|${Math.floor(currentHour/6)}`);
    // Model translation errors are relative to the deterministic path's already-resolved speed.
    // Use an independent RNG so changing speed spread never changes intensity/dry-air draws.
    const modelSpeedRand=rng(`${seed}|CENTER-SPEED|${spec.id}|${Math.floor(currentHour/6)}`);
    const modelSpeedBias=clamp(spec.alongTrackScale+normal(modelSpeedRand)*.032,.81,1.21);
    const modelSpeedKnots=cumulativeKnots(modelSpeedRand,6,.095);
    let integratedEast=0,integratedNorth=0;
    const steeringOnset=issueRegime.troughArrivalHour-29+(modelRand()-.5)*35;
    const steeringTiming=clamp(normal(modelRand)*13,-24,24);
    const centerCrossKnots=cumulativeKnots(modelRand,6,.30);
    const centerAlongKnots=cumulativeKnots(modelRand,6,.23);
    // Independent RNG: geometry port MUST NOT advance newer intensity / dry-air draws.
    const legacyModelRand=rng(`${seed}|LEGACY-GEOMETRY|CENTER|${spec.id}|${Math.floor(currentHour/6)}`);
    const legacyModelCross=Array.from({length:6},(_,k)=>k===0?0:normal(legacyModelRand)*.55);
    const legacyModelAlong=Array.from({length:6},(_,k)=>k===0?0:normal(legacyModelRand)*.45);
    const legacyModelPhase=legacyModelRand()*Math.PI*2;
    const regimeStart=.28+.30*modelRand();
    const regimeSign=modelRand()<.5?-1:1;
    // Independent model-regime bends are muted on high-consensus issues and become more visible
    // when the issue itself supports genuine synoptic ambiguity.
    const regimeKm=regimeSign*(18+34*modelRand())*(.28+.72*issueRegime.regimeStrength);
    // Intensity guidance must disagree in more than a small additive bias. Each model family gets
    // its own onset timing, intensification rate, peak potential, weakening response and offshore
    // re-intensification efficiency. Most family rates are intentionally a little slower than the
    // deterministic AETHER reference so a rapidly deepening control forecast does not drag every
    // ensemble member to the same extreme peak within the first 2-3 days.
    // Keep ensemble members thermodynamically synchronized with the live simulator: still
    // dispersed, but no longer biased toward slower strengthening than the deterministic run.
    const centerGenesisUncertainty=clamp((20-Number(storm.vmax||0))/15,0,1);
    const centerGenesisRateNoise=pathOnly?0:clamp(normal(modelRand),-1.8,1.8);
    const modelIntensityRateScale=pathOnly ? 1 : clamp(
      0.84+modelRand()*0.22+spec.intensityBiasMps*0.010+centerGenesisUncertainty*(.08+.105*centerGenesisRateNoise),
      0.62,1.32
    );
    const modelWeakeningScale=pathOnly ? 1 : clamp(0.78+modelRand()*0.46,0.68,1.34);
    const modelPeakBias=pathOnly ? 0 : spec.intensityBiasMps+
      clamp(normal(modelRand),-1.8,1.8)*peakIntensitySpreadMps(Number(storm.vmax||0),effectiveHorizon)*0.60+
      centerGenesisUncertainty*(1.4+clamp(normal(modelRand),-1.8,1.8)*2.3);
    const modelTimingShift=pathOnly ? 0 : spec.intensityTimingHours+clamp(normal(modelRand)*5.5,-12,12);
    const modelRecoveryScale=pathOnly ? 1 : clamp(0.55+modelRand()*1.05,0.50,1.60);
    const modelRemnantSurvival=pathOnly ? 1 : clamp(0.58+modelRand()*0.52,0.50,1.10);
    const modelDrySensitivity=pathOnly ? 1 : clamp(.72+.58*modelRand(),.62,1.36);
    const modelDryBias=pathOnly ? 0 : clamp(normal(modelRand)*.10,-.18,.18);
    let modelDryMemory=pathOnly ? 0 : clamp(.30*Number(storm.dryAirIntrusion||0)+.52*Number(storm.dryAirCoreExposure||0)+.18*Number(storm.dryAirCoreConnection||0),0,1);
    const modelStructuralDamage=createGuidanceStructuralDamageState(storm);
    let modelTerrainDamageMemory=summariseGuidanceStructuralDamage(modelStructuralDamage).terrainMemory;
    let modelVentilationDamageMemory=pathOnly ? 0 : clamp(Math.max(modelDryMemory*.72,Number(storm.structuralDisorganization||0)*.78),0,1);
    const genesisEnvironment=pathOnly ? null : sampleEnvironment!(storm.lat,storm.lon,currentHour);
    const genesisSupport=pathOnly ? 0 : earlyTropicalStormDevelopment(storm,config,genesisEnvironment!);
    const configuredTargetVmax=pathOnly ? null : configuredGuidanceTargetIntensity(config,Number(storm.vmax||0));
    const modelTargetRand=rng(`${seed}|CENTER-TARGET|${spec.id}|${Math.floor(currentHour/6)}`);
    const modelTargetResponse=pathOnly ? 1 : clamp(1+normal(modelTargetRand)*.14,.68,1.34);
    const modelTargetDuration=(pathOnly||configuredTargetVmax==null)?0:
      guidanceTargetDecayDurationHours(Number(storm.vmax||0),configuredTargetVmax,genesisEnvironment!,!!storm.landed)*
      clamp(1+normal(modelTargetRand)*.12,.72,1.32);
    const modelTerrainRand=rng(`${seed}|CENTER-TERRAIN|${spec.id}|${Math.floor(currentHour/6)}`);
    const modelTerrainFrictionScale=pathOnly ? 1 : clamp(1+normal(modelTerrainRand)*.10,.76,1.28);
    const modelRmwScale=pathOnly ? 1 : clamp(1+normal(modelTerrainRand)*.05,.88,1.14);
    let modelSeaHoursAfterLand=modelStructuralDamage.warmWaterHoursAfterSea;
    let modelRecentLand=modelStructuralDamage.recentLand;
    let modelLandHours=modelStructuralDamage.landHours;
    for(let i=0;i<=n;i++){
      const lead=Math.min(effectiveHorizon,i*3),f=lead/Math.max(1,effectiveHorizon),grow=smoothstep(Math.pow(f,.83));
      const base=interpolateRef(ref,lead),geom=tangentNormal(geometryRef,lead);
      const rp=rawTrackPoint(source?.track||[],f),gp=rawTrackPoint(gfs?.track||[],f);
      let rawCross=0,rawAlong=0;
      if(rp&&gp){const dx=(rp.lon-gp.lon)*kmPerLon(base.lat),dy=(rp.lat-gp.lat)*111.12;rawCross=dx*geom.nx+dy*geom.ny;rawAlong=dx*geom.tx+dy*geom.ty;}
      const rawCap=34+lead*0.92;
      rawCross=clamp(rawCross,-rawCap,rawCap);rawAlong=clamp(rawAlong,-rawCap*.7,rawCap*.7);
      // Low-pass the recovered Unity displacement so flat-world numerical quirks never create
      // zig-zags on a geographic product.
      smoothCross=i===0?0:smoothCross*.76+rawCross*.24;
      smoothAlong=i===0?0:smoothAlong*.80+rawAlong*.20;
      const phase=(modelIdx/AETHER_MODEL_SPECS.length)*Math.PI*2;
      const curve=spec.curvatureKm*Math.sin(Math.PI*f)*Math.sin(Math.PI*.55*f+phase*.18);
      const leadUncertaintyGain=1+(.08+.18*issueRegime.longRangeUncertainty)*smoothstep((lead-18)/Math.max(24,effectiveHorizon*.56));
      const shapeScale=(16+lead*.28)*spec.spreadScale*earlySpreadBoost*leadUncertaintyGain;
      // Most synoptic bending is shared by all guidance families because they sample the same
      // steering environment.  Model-specific departures remain, but no family gets a completely
      // independent trajectory skeleton.  This prevents the visually implausible situation where
      // eight centres fan far apart while every model internally acts as if the steering is certain.
      const sharedCross=sampleLinearKnots(sharedCrossKnots,f)*shapeScale*.34;
      const modelCross=sampleLinearKnots(centerCrossKnots,f)*shapeScale*.28;
      // Recover the old independent, broad smooth bends (not the old intensity formula).
      // Their amplitude follows the diagnosed issue uncertainty, rather than forcing a
      // high-dispersion split at every issue. No discontinuity at the analysis point.
      const legacyGain=.40+.57*issueRegime.regimeStrength;
      const legacyCross=(sampleSmoothKnots(legacySharedCross,f)*.34+
        sampleSmoothKnots(legacyModelCross,f)*.28+
        .055*Math.sin(2*Math.PI*f+legacySharedPhase)*smoothstep(lead/12)+
        .065*Math.sin(2*Math.PI*f+legacyModelPhase)*smoothstep(lead/12))*shapeScale*legacyGain;
      const legacyAlong=(sampleSmoothKnots(legacySharedAlong,f)*.12+
        sampleSmoothKnots(legacyModelAlong,f)*.10)*shapeScale*legacyGain;
      const synopticShape=sharedCross+modelCross+legacyCross;
      const sharedAlong=sampleLinearKnots(sharedAlongKnots,f)*shapeScale*.12;
      const modelAlong=sampleLinearKnots(centerAlongKnots,f)*shapeScale*.10;
      const regime=regimeKm*smoothstep((f-regimeStart)/Math.max(.12,1-regimeStart));
      const scenario=scenarioVectorKm(spec.id,lead,effectiveHorizon,issueRegime);
      const steeringCoeff=modelScenarioCoefficient(spec.id,lead,effectiveHorizon,issueRegime);
      const steering=steeringVelocityKmH(steeringCoeff,lead,steeringOnset+steeringTiming,issueRegime);
      const steeringStep=Math.max(0,lead-(i?Math.min(effectiveHorizon,(i-1)*3):0));
      integratedEast+=steering.east*steeringStep;
      integratedNorth+=steering.north*steeringStep;
      const steeringCross=integratedEast*geom.nx+integratedNorth*geom.ny;
      const steeringAlong=integratedEast*geom.tx+integratedNorth*geom.ty;
      const scenarioCross=scenario.east*geom.nx+scenario.north*geom.ny;
      const scenarioAlong=scenario.east*geom.tx+scenario.north*geom.ty;
      let crossKm=grow*(spec.crossTrackBiasKm+curve)+smoothCross*.34*grow+synopticShape*grow+regime*.58*grow+scenarioCross+steeringCross;
      if(spec.id==="AIFS"||spec.id==="FNV3") crossKm *= 1.08;
      let alongKm=smoothAlong*.24*grow+(sharedAlong+modelAlong+legacyAlong)*grow+scenarioAlong+steeringAlong;
      if(spec.id==="AIFS"||spec.id==="FNV3") alongKm *= 1.04;
      // Even when there is no distinct two-regime split, ordinary synoptic uncertainty generally
      // grows with forecast range. Keep that background tendency separate from the optional regime
      // bifurcation so a quiet issue can remain compact early yet still broaden by day 4-7.
      const farRangeScale=1+(.10+.12*issueRegime.longRangeUncertainty)*smoothstep((lead-42)/Math.max(30,effectiveHorizon-42));
      crossKm*=farRangeScale;
      alongKm*=1+(farRangeScale-1)*.72;
      // Guidance centres may turn at a 3-h node, but the offset itself must evolve on a time scale
      // compatible with the deterministic translation speed.  The old lead-only cap could still
      // permit a 30-60 km sideways jump while the parent track was moving only a few kilometres,
      // which is how broad left/right semicircles were manufactured.  This rate limit does NOT
      // change the target spread; it only takes multiple 3-hour nodes to reach a distant lobe.
      const previousLead=Math.min(effectiveHorizon,Math.max(0,(i-1)*3));
      const previousReference=interpolateRef(ref,previousLead);
      const olderGeometryReference=interpolateRef(geometryRef,Math.max(0,lead-6));
      const previousGeometryReference=interpolateRef(geometryRef,previousLead);
      const currentGeometryReference=interpolateRef(geometryRef,lead);
      const referenceStepKm=i>0?guidanceDistanceKm(previousReference,base):0;
      const legacyCrossCap=27+lead*.22,legacyAlongCap=25+lead*.19;
      const maxCrossStep=i>0
        ? Math.min(legacyCrossCap,Math.max(4.5,5.0+referenceStepKm*.58))
        : legacyCrossCap;
      const maxAlongStep=i>0
        ? Math.min(legacyAlongCap,Math.max(6.0,6.5+referenceStepKm*.78))
        : legacyAlongCap;
      const previousCross=prevAppliedCross,previousAlong=prevAppliedAlong;
      crossKm=clamp(crossKm,previousCross-maxCrossStep,previousCross+maxCrossStep);
      alongKm=clamp(alongKm,previousAlong-maxAlongStep,previousAlong+maxAlongStep);
      const consensusBlend=smoothstep((f-.22)/.68);
      crossKm*=1-(0.08+0.12*consensusBlend);
      alongKm*=1-(0.06+0.10*consensusBlend);
      const deltaCross=crossKm-previousCross;
      let deltaAlong=alongKm-previousAlong;
      prevAppliedCross=crossKm;prevAppliedAlong=alongKm;

      let lat=base.lat,lon=base.lon;
      if(track.length&&i>0){
        const previous=track[track.length-1];
        const modelSpeedFactor=clamp(modelSpeedBias+sampleSmoothKnots(modelSpeedKnots,f),.72,1.30);
        const meanLat=(previousReference.lat+base.lat)*.5;
        const baselineEast=(base.lon-previousReference.lon)*kmPerLon(meanLat);
        const baselineNorth=(base.lat-previousReference.lat)*111.12;
        const previousTimingOffset=modelTimingOffsetKm;
        const timingLimit=Math.min(140,20+lead*.80);
        modelTimingOffsetKm=clamp(
          modelTimingOffsetKm+referenceStepKm*(modelSpeedFactor-1),
          -timingLimit,timingLimit
        );
        const speedTimingDelta=modelTimingOffsetKm-previousTimingOffset;
        const desiredForward=referenceStepKm+speedTimingDelta;
        // Along-track structural errors can alter timing further, but they may not reverse the
        // centre relative to the deterministic forecast. A true deterministic stall still
        // propagates to the ensemble because both timing integration and perturbation are gated.
        const minimumForward=referenceStepKm>1.2?Math.max(.15,referenceStepKm*.18):0;
        deltaAlong=Math.max(deltaAlong,minimumForward-desiredForward);
        const stallGate=.04+.96*smoothstep((referenceStepKm-.5)/14);
        const east=baselineEast+
          geom.tx*speedTimingDelta+
          stallGate*(geom.nx*deltaCross+geom.tx*deltaAlong);
        const north=baselineNorth+
          geom.ty*speedTimingDelta+
          stallGate*(geom.ny*deltaCross+geom.ty*deltaAlong);
        const incremental={
          lat:previous.lat+north/111.12,
          lon:previous.lon+east/kmPerLon(previous.lat)
        };
        const deKinked=constrainCenterPolylineKink(track,incremental,referenceStepKm);
        const curvatureLimited=constrainGuidanceTurnToBaselineCurvature(
          track,deKinked,olderGeometryReference,previousGeometryReference,currentGeometryReference,6
        );
        const corridor=constrainGuidanceStepToBaselineHeading(
          previous,curvatureLimited,previousGeometryReference,currentGeometryReference,referenceStepKm,22
        );
        lat=corridor.lat;lon=corridor.lon;
      }
      if(pathOnly){
        // Geometry-only live guidance: no member/model intensity, pressure, environmental sampling,
        // terrain-core scan, damage memory or target-intensity work is performed here. The values are
        // intentionally NaN so downstream live-map code cannot accidentally present them as a
        // calculated ensemble intensity. Full values are populated only by product generation.
        track.push({lat,lon,vmax:Number.NaN,pmin:Number.NaN,simHour:currentHour+lead,leadHour:lead});
        continue;
      }
      const env=sampleEnvironment!(lat,lon,currentHour+lead);
      // Land interaction belongs to the guidance position itself, not the deterministic parent
      // track. This is essential when one model crosses Taiwan/Luzon while another remains at sea.
      const localLand = getGuidanceLandMetrics(lat, lon, config, useProductCoastline);
      const guidanceLanded = !!localLand.isLand;
      modelLandHours = guidanceLanded ? Math.min(120, modelLandHours + (track.length ? 3 : 0)) : 0;
      const perceivedDry=clamp(env.dry*modelDrySensitivity+modelDryBias,0,1);
      const dryAlpha=perceivedDry>modelDryMemory?.46:.24;
      modelDryMemory+= (perceivedDry-modelDryMemory)*dryAlpha;
      const modelTerrainVmax=track.length?track[track.length-1].vmax:Number(storm.vmax||0);
      const modelCoreInteraction=getGuidanceCoreSurfaceInteraction(
        lat,lon,guidanceRmwKm(storm,modelTerrainVmax,modelRmwScale),Math.max(10,modelTerrainVmax),config,true,localLand
      );
      let modelStructuralStep=stepGuidanceStructuralDamage(
        modelStructuralDamage,modelCoreInteraction,guidanceLanded,env,modelTerrainVmax,track.length?3:0,
        modelTerrainFrictionScale,Number(storm.coreCompactness??.55),Number(storm.eyewallIntegrity??.50)
      );
      modelSeaHoursAfterLand=modelStructuralDamage.warmWaterHoursAfterSea;
      modelRecentLand=modelStructuralDamage.recentLand;
      modelLandHours=modelStructuralDamage.landHours;
      const shearStressNow=clamp((env.shear-15)/24,0,1);
      const ventTarget=clamp(Math.max(modelDryMemory*.88,shearStressNow*.82)-.10,0,1);
      if(ventTarget>modelVentilationDamageMemory) modelVentilationDamageMemory+=(ventTarget-modelVentilationDamageMemory)*.38;
      else modelVentilationDamageMemory*=Math.exp(-3/(72+84*modelVentilationDamageMemory));
      applyGuidanceVentilationScar(modelStructuralDamage,modelDryMemory,env.shear,env.rh,modelTerrainVmax,track.length?3:0);
      modelStructuralStep=summariseGuidanceStructuralDamage(modelStructuralDamage,modelStructuralStep.directIntensityLossMps);
      modelTerrainDamageMemory=modelStructuralStep.terrainMemory;
      const modelDamageMemory=clamp(1-(1-modelStructuralStep.totalStructuralMemory)*(1-modelVentilationDamageMemory),0,1);
      // Model intensity differences have both amplitude and timing components. Near t=0 all
      // guidance must begin from the same analysed cyclone state.
      const intensityShift=modelTimingShift*guidanceIntensityBlend(f)*grow;
      const shifted=interpolateRef(ref,clamp(lead+intensityShift,0,effectiveHorizon));
      const shiftedPrev=interpolateRef(ref,clamp(Math.max(0,lead-3)+intensityShift,0,effectiveHorizon));
      const mature=Math.sin(Math.PI*clamp(f,0,1));
      const biasBlend=guidanceIntensityBlend(f);
      let vmax=Number(storm.vmax||0);
      if(track.length){
        const prevV=track[track.length-1].vmax;
        const refStep=shifted.vmax-shiftedPrev.vmax;
        const dryGrowthFactor=clamp(1-.30*modelDryMemory,.58,1);
        const baseIntegrity=clamp(Number(shifted.lowLevelVortexIntegrity??.4),0,1);
        const integrity=clamp(baseIntegrity*modelStructuralStep.lowLevelIntegrityScale,0.04,1);
        const landMemorySignal=guidanceLanded
          ? 1
          : (modelRecentLand || shifted.warmWaterHoursAfterSea>0)
            ? clamp((0.86-integrity)/0.42,0,1)
            : 0;
        const rawTendencyScale=refStep>=0?modelIntensityRateScale*dryGrowthFactor:modelWeakeningScale*(.94+.24*modelDryMemory);
        const damageGrowthBrake=refStep>=0
          ? Math.min(.30+.70*(1-modelDamageMemory),modelStructuralStep.structuralPenaltyFactor)
          : 1;
        const tendencyScale=(rawTendencyScale*damageGrowthBrake)*(1-0.52*landMemorySignal)+1*(0.52*landMemorySignal);
        vmax=prevV+refStep*tendencyScale;
        const modelTargetErrorScale=configuredTargetVmax==null?1:guidanceTargetErrorScale(lead,effectiveHorizon,false);
        const peakTarget=shifted.vmax+(modelPeakBias*(0.30+0.70*mature)*biasBlend*modelTargetErrorScale)*(1-0.58*landMemorySignal)*(1-.72*modelDamageMemory);
        vmax+=(peakTarget-vmax)*(0.08+0.09*biasBlend);

        const dryPenalty=Math.max(0,modelDryMemory-.50)*(0.50+1.35*smoothstep((prevV-24)/34))*(env.manualDry>.15?1.20:1)*smoothstep((prevV-32.7)/9);
        vmax-=dryPenalty;
        vmax-=modelStructuralStep.directIntensityLossMps;

        if(guidanceLanded){
          modelRecentLand=modelStructuralDamage.recentLand;
          modelSeaHoursAfterLand=modelStructuralDamage.warmWaterHoursAfterSea;
          vmax-= (1-integrity)*(0.85+0.95*(1-integrity));
          const terrainExposure = clamp(Number(localLand.elevation || 0) / 2200, 0, 1);
          const mountainSeverity=clamp(Math.max(
            terrainExposure,modelCoreInteraction.blockingIndex,modelCoreInteraction.mountainFraction*1.85,
            smoothstep((modelCoreInteraction.maxElevation-650)/1650)
          ),0,1);
          const landDecay = (0.60 + 1.75 * terrainExposure) * (0.56 + 0.78 * smoothstep((prevV - 20) / 36)) *
            (0.72 + 0.28 * smoothstep(modelLandHours / 9)) * modelTerrainFrictionScale * (1+.72*mountainSeverity);
          vmax -= landDecay;
        }else if(modelRecentLand || shifted.warmWaterHoursAfterSea>0){
          modelSeaHoursAfterLand=Math.max(modelStructuralDamage.warmWaterHoursAfterSea,shifted.warmWaterHoursAfterSea);
          const recoveryGate=smoothstep((modelSeaHoursAfterLand-12)/42);
          const recoveryDelta=Math.max(0,modelRecoveryScale-0.70)*.85*recoveryGate*(0.30+0.70*integrity)*Math.pow(1-modelDamageMemory,1.35);
          vmax+=recoveryDelta;
          const landLock=Math.max(clamp((0.80-integrity)/0.34,0,1),modelTerrainDamageMemory*.92,modelDamageMemory*.58);
          // Never use the deterministic parent as an upward shortcut around the model's own
          // mountain/dry/shear memory. During the first day back over water, severe terrain damage
          // can continue to collapse the vortex and strongly suppress any inherited strengthening.
          if(vmax>shifted.vmax) vmax=shifted.vmax+(vmax-shifted.vmax)*(1-0.62*landLock);
          const postMountainGate=(1-smoothstep((modelSeaHoursAfterLand-5)/30))*landLock;
          if(vmax>prevV) vmax=prevV+(vmax-prevV)*(1-.86*postMountainGate);
          if(modelSeaHoursAfterLand>108 && modelTerrainDamageMemory<.12 && modelDamageMemory<.16) modelRecentLand=false;
        }

        if(shifted.remnantVortex || prevV<17.2){
          vmax=Math.max(vmax,remnantFloor(shifted,modelRemnantSurvival));
        }
        const remnantBoost=!guidanceLanded && (shifted.remnantVortex||modelSeaHoursAfterLand>3)?0.55*modelRecoveryScale*(1-modelDamageMemory):0;
        vmax=applyGuidanceTargetDecay(vmax,prevV,Number(storm.vmax||0),configuredTargetVmax,lead,modelTargetDuration,modelTargetResponse);
        const postTerrainLock=clamp(Math.max(modelTerrainDamageMemory,modelDamageMemory*.82),0,1)*
          (guidanceLanded?1:(1-smoothstep((modelSeaHoursAfterLand-5)/34)));
        const riseCap=maxSixHourRise(prevV,refStep*2,modelIntensityRateScale,remnantBoost)*0.66*(1-.78*postTerrainLock);
        const terrainWeakeningActive=guidanceLanded || (modelRecentLand&&postTerrainLock>.24);
        const fallCap=maxSixHourFall(prevV,terrainWeakeningActive,modelWeakeningScale)*(.54+.12*postTerrainLock);
        vmax=clamp(vmax,prevV-fallCap,prevV+Math.max(.18,riseCap));
        // Keep the initial weakening tail possible; do not apply a categorical TS floor.
        const weakBranch=(modelIdx===2 || modelIdx===6);
        vmax=keepViableGenesisFromInstantCollapse(vmax,lead,Number(storm.vmax||0),genesisSupport,weakBranch);
        if(!guidanceLanded && Number(storm.vmax||0)<17.2 && lead>0 && lead<=42 && genesisSupport>.25){
          const genesisEnvelope=1-.62*smoothstep((lead-27)/15);
          const developmentLift=genesisSupport*centerGenesisUncertainty*(.24+.30*smoothstep(lead/18))*genesisEnvelope;
          vmax+=developmentLift*(weakBranch?.22:1);
        }
      }
      // Manual intensity guidance shifts the whole model family toward the authored scenario without
      // collapsing model-to-model anomalies. Use the deterministic/reference departure as a common
      // correction rather than pulling every centre directly onto the same curve.
      const manualIntensity=manualForecastIntensityTarget(config,lead);
      if(manualIntensity!==null&&lead>0){
        const commonManualDelta=manualIntensity-shifted.vmax;
        const authority=(.28+.12*smoothstep(lead/30))*(guidanceLanded?.55:1);
        vmax+=commonManualDelta*authority;
      }
      vmax=Math.max(3.5,vmax);
      const pmin=pressureFromIntensityOffset(shifted.pmin,shifted.vmax,vmax);
      track.push({lat,lon,vmax,pmin,simHour:currentHour+lead,leadHour:lead,landed:guidanceLanded,remnantVortex:shifted.remnantVortex||vmax<17.2,lowLevelVortexIntegrity:clamp(Number(shifted.lowLevelVortexIntegrity??.4)*modelStructuralStep.lowLevelIntegrityScale,.04,1),warmWaterHoursAfterSea:modelSeaHoursAfterLand,dryAirIndex:modelDryMemory});
    }
    if(pathOnly){
      const geometryTrack=diagnoseTranslation(track);
      return{id:spec.id,modelId:spec.id,color:spec.color,control:true,memberNumber:0,maxVmax:Number.NaN,minPmin:Number.NaN,track:geometryTrack};
    }
    const summary=summariseTrack(spec.id,track);
    return{id:spec.id,modelId:spec.id,color:spec.color,control:true,memberNumber:0,maxVmax:summary.maxVmax,minPmin:summary.minPmin,track:summary.track};
  });
}

function interpolateGuidance(track:AetherGuidancePoint[],lead:number){
  if(!track.length)return null;if(lead<=track[0].leadHour)return track[0];for(let i=1;i<track.length;i++)if(lead<=track[i].leadHour){const a=track[i-1],b=track[i],t=(lead-a.leadHour)/Math.max(1e-6,b.leadHour-a.leadHour);return{...a,lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,vmax:a.vmax+(b.vmax-a.vmax)*t,pmin:a.pmin+(b.pmin-a.pmin)*t,leadHour:lead,simHour:a.simHour+(b.simHour-a.simHour)*t,landed:t<.5?!!a.landed:!!b.landed,remnantVortex:t<.5?!!a.remnantVortex:!!b.remnantVortex,lowLevelVortexIntegrity:Number(a.lowLevelVortexIntegrity??.4)+(Number(b.lowLevelVortexIntegrity??.4)-Number(a.lowLevelVortexIntegrity??.4))*t,warmWaterHoursAfterSea:Number(a.warmWaterHoursAfterSea??0)+(Number(b.warmWaterHoursAfterSea??0)-Number(a.warmWaterHoursAfterSea??0))*t};}return track[track.length-1];
}

export function buildAetherCenterGuidance(
  storm:Typhoon,currentHour:number,scene:readonly Partial<Typhoon>[],seed:string,referencePath:any[],horizon=168,
  configOverride?:SimulationConfig,useProductCoastline=false
):AetherGuidanceMember[]{
  const raw=buildAetherCenterGuidanceRaw(storm,currentHour,scene,seed,referencePath,horizon,configOverride,useProductCoastline,false);
  return applyForecastPeakTranslation(raw,storm,currentHour,referencePath,horizon,configOverride||storm.configSnapshot);
}

/**
 * Lightweight centre-track guidance for the live simulation map.
 *
 * This intentionally computes geometry and translation only. Model/ensemble intensity, pressure,
 * terrain damage, ventilation scars and related thermodynamic fields are deferred until the user
 * explicitly generates an ensemble product. Keeping this separate prevents 3-hour live-map refresh
 * cycles and timeline scrubbing from paying the full ensemble-intensity cost.
 */
export function buildAetherCenterTrackGuidance(
  storm:Typhoon,currentHour:number,scene:readonly Partial<Typhoon>[],seed:string,referencePath:any[],horizon=168,
  configOverride?:SimulationConfig
):AetherGuidanceMember[]{
  return buildAetherCenterGuidanceRaw(storm,currentHour,scene,seed,referencePath,horizon,configOverride,false,true);
}

export async function buildAetherEnsembleMembers(opts:{storm:Typhoon;currentHour:number;scene:readonly Partial<Typhoon>[];seed:string;referencePath:any[];selectedModelIds:string[];membersPerModel:number;horizon?:number;config?:SimulationConfig;useProductCoastline?:boolean;signal?:AbortSignal;onProgress?:(done:number,total:number,stage:string)=>void;}):Promise<AetherGuidanceMember[]>{
  const horizon=opts.horizon??168;
  const config=opts.config||opts.storm.configSnapshot;
  const allCenters=buildAetherCenterGuidanceRaw(opts.storm,opts.currentHour,opts.scene,opts.seed,opts.referencePath,horizon,config,!!opts.useProductCoastline);
  const centers=allCenters.filter(c=>opts.selectedModelIds.includes(c.modelId));
  const issueRegime=buildIssueRegime(opts.seed,opts.currentHour,opts.storm,horizon);
  const verification=buildTrackVerificationRegime(opts.storm,opts.currentHour);

  // Intra-model uncertainty cannot remain narrow when the deterministic model families disagree.
  // Use the full eight-centre RMS spread as a dynamic floor, then allow that floor to shrink again
  // when the model centres themselves converge later in the forecast.
  const centerSpreadByIndex=Array.from({length:Math.max(1,...allCenters.map(c=>c.track.length))},(_,i)=>{
    const pts=allCenters.map(c=>c.track[Math.min(i,c.track.length-1)]).filter(Boolean);
    if(pts.length<2)return 0;
    const meanLat=pts.reduce((a,p)=>a+p.lat,0)/pts.length;
    const meanLon=pts.reduce((a,p)=>a+p.lon,0)/pts.length;
    const lonKm=kmPerLon(meanLat);
    return Math.sqrt(pts.reduce((acc,p)=>acc+Math.pow((p.lat-meanLat)*111.12,2)+Math.pow((p.lon-meanLon)*lonKm,2),0)/pts.length);
  });

  const specs=new Map(AETHER_MODEL_SPECS.map(s=>[s.id,s]));
  const total=centers.length*opts.membersPerModel;
  let done=0;
  const output:AetherGuidanceMember[]=[];
  const memberGenesisBoost=genesisSpreadFactor(Number(opts.storm.vmax||0));

  for(const center of centers){
    const spec=specs.get(center.modelId)!;
    const geometry=center.track.map((cp,i)=>{
      const a=center.track[Math.max(0,i-1)],b=center.track[Math.min(center.track.length-1,i+1)];
      const dx=(b.lon-a.lon)*kmPerLon((a.lat+b.lat)*.5),dy=(b.lat-a.lat)*111.12,mag=Math.hypot(dx,dy)||1;
      return{tx:dx/mag,ty:dy/mag,nx:-dy/mag,ny:dx/mag};
    });

    for(let m=0;m<opts.membersPerModel;m++){
      if(opts.signal?.aborted) throw new DOMException("Ensemble generation cancelled","AbortError");
      if(m===0){
        const track=center.track.map(p=>({...p}));
        const summary=summariseTrack(center.modelId,track);
        output.push({...center,id:`${center.modelId}-CTRL`,control:true,memberNumber:0,track:summary.track,maxVmax:summary.maxVmax,minPmin:summary.minPmin});
        done++;
      }else{
        const rand=rng(`${opts.seed}|${center.modelId}|${m}|${opts.currentHour}`);
        // Geometry owns an independent deterministic random stream. Terrain/intensity physics may
        // consume additional random draws in future releases without silently changing the member
        // track plume. This preserves coherent path spread while other physics evolves independently.
        const pathRand=rng(`${opts.seed}|PATH-GEOMETRY|${center.modelId}|${m}|${opts.currentHour}`);
        const sampleEnvironment=makeEnvironmentSampler(config,opts.storm,`${opts.seed}|ENV-MEMBER|${center.modelId}|${m}|${Math.floor(opts.currentHour/6)}`,1.0);
        const crossKnots=cumulativeKnots(pathRand,7,.46);
        const alongKnots=cumulativeKnots(pathRand,7,.37);
        // Preserve the old version's smoothly turning per-member trajectory signature.
        // It supplements, rather than replaces, new coherent scenario clusters.
        const legacyMemberRand=rng(`${opts.seed}|LEGACY-GEOMETRY|${center.modelId}|${m}|${opts.currentHour}`);
        const legacyCrossKnots=Array.from({length:7},(_,i)=>i===0?0:normal(legacyMemberRand));
        const legacyAlongKnots=Array.from({length:7},(_,i)=>i===0?0:normal(legacyMemberRand));
        const legacyPhase=legacyMemberRand()*Math.PI*2;
        const intensityKnots=Array.from({length:6},(_,i)=>i===0?0:normal(rand));
        const zTiming=normal(pathRand),zPressure=normal(rand),zRate=normal(rand),zPeak=normal(rand),zWeakening=normal(rand),zRecovery=normal(rand),zResidual=normal(rand),zDry=normal(rand);
        const zInitialCross=normal(pathRand),zInitialAlong=normal(pathRand);
        const initialVmax=Number(opts.storm.vmax||0);
        const memberGenesisUncertainty=clamp((20-initialVmax)/15,0,1);
        // Genesis members receive materially wider translation/heading uncertainty. This is coherent
        // per member (not jitter), so a TD can legitimately choose a different broad direction.
        const memberSpeedBias=clamp(1+normal(pathRand)*(.135+.095*memberGenesisUncertainty),.52,1.52);
        const memberSpeedKnots=cumulativeKnots(pathRand,6,.092+.060*memberGenesisUncertainty);
        const branchPick=pathRand(),branchSign=pathRand()<.5?-1:1;
        const branchChance=clamp((.19+.49*issueRegime.regimeStrength+.18*memberGenesisUncertainty)*(.96+.30*verification.directionalMismatch),.12,.94);
        const branchAmplitude=(.16+.34*pathRand())*branchSign*(.74+.50*issueRegime.longRangeUncertainty)*(1+.42*memberGenesisUncertainty)*verification.swayScale;
        const branchStart=(.14+.46*pathRand())*(1-.58*memberGenesisUncertainty);

        // Scenario-cluster membership is persistent in time. A member can sit in its parent model's
        // regime, jump to the competing regime, bridge the two, or be a low-probability outlier.
        // This produces distinct lobes rather than a uniformly filled fan.
        const clusterPick=pathRand();
        const clusterNoise=clamp(normal(pathRand)*.20,-.47,.47);
        const clusterOutlier=(pathRand()<.5?-1:1)*(.58+.60*pathRand());
        const alternateFamily:AetherModelSpec["id"] = isAiFamily(spec.id)?"GEFS":"AIFS";

        const developmentPick=rand();
        let memberRateScale=clamp(0.82+0.16*zRate+memberGenesisUncertainty*(.08+.18*zRate),0.34,1.42);
        // Round 75: restore a little more physically plausible intensity diversity after the 5.2.24
        // target-envelope work. The target still controls the distribution mean, not each member.
        let memberPeakBias=clamp(zPeak,-2.35,2.35)*peakIntensitySpreadMps(initialVmax,horizon)*1.14;
        if(initialVmax<25){
          const weakCut=.16+.08*memberGenesisUncertainty;
          const strongCut=.92-.18*memberGenesisUncertainty;
          if(developmentPick<weakCut){memberRateScale*=.66-.10*memberGenesisUncertainty;memberPeakBias-=2.4+(3.5+3.0*memberGenesisUncertainty)*rand();}
          else if(developmentPick>strongCut){memberRateScale*=1.16+.14*memberGenesisUncertainty;memberPeakBias+=2.5+(4.0+4.0*memberGenesisUncertainty)*rand();}
        }
        memberRateScale=clamp(memberRateScale,.24,1.46);
        const memberWeakeningScale=clamp(0.96+0.20*zWeakening,0.58,1.48);
        const memberRecoveryScale=clamp(0.78+0.30*zRecovery,0.20,1.65);
        const memberRemnantSurvival=clamp(0.78+0.22*zResidual,0.34,1.25);
        const memberDrySensitivity=clamp(.76+.24*zDry,.48,1.42);
        const memberDryBias=clamp(normal(rand)*.12,-.24,.24);
        let memberDryMemory=clamp(.30*Number(opts.storm.dryAirIntrusion||0)+.52*Number(opts.storm.dryAirCoreExposure||0)+.18*Number(opts.storm.dryAirCoreConnection||0),0,1);
        const memberStructuralDamage=createGuidanceStructuralDamageState(opts.storm);
        let memberTerrainDamageMemory=summariseGuidanceStructuralDamage(memberStructuralDamage).terrainMemory;
        let memberVentilationDamageMemory=clamp(Math.max(
          memberDryMemory*.72,
          Number(opts.storm.structuralDisorganization||0)*.78,
        ),0,1);
        const memberGenesisEnvironment=sampleEnvironment(opts.storm.lat,opts.storm.lon,opts.currentHour);
        const memberGenesisSupport=earlyTropicalStormDevelopment(opts.storm,config,memberGenesisEnvironment);
        const memberTargetVmax=configuredGuidanceTargetIntensity(config,initialVmax);
        const memberTargetRand=rng(`${opts.seed}|MEMBER-TARGET|${center.modelId}|${m}|${Math.floor(opts.currentHour/6)}`);
        const targetResistancePick=memberTargetRand();
        const targetTailPick=memberTargetRand();
        // Keep only a few deliberately extreme target-response members. Ordinary members share the
        // same target-aware forecast tendency with realistic response scatter; ~7% form a high
        // tail (slower response / positive peak error) and ~7% a low tail (faster response /
        // negative peak error). The tail members are still subject to their own terrain, dry-air,
        // shear and structural-damage penalties, so these are not synthetic hard outliers.
        const memberTargetTail=memberTargetVmax==null?0:(targetTailPick<.07?1:targetTailPick>.93?-1:0);
        const memberTargetTailMagnitude=memberTargetTail>0
          ? (5.5+3.5*memberTargetRand())
          : memberTargetTail<0
            ? (4.0+3.5*memberTargetRand())
            : 0;
        const memberTargetTailBias=memberTargetTail*memberTargetTailMagnitude*(.62+.14*spec.intensitySpreadScale);
        const memberEffectiveTargetVmax=memberTargetVmax==null?null:
          clamp(memberTargetVmax+memberTargetTail*memberTargetTailMagnitude,3.5,110);
        // Members do not perceive a manually configured target with identical precision. This is a
        // target-specific error (not generic intensity noise), so it contracts with lead time while
        // the member's environmental/structural intensity spread remains fully active.
        const memberTargetInterpretationBias=memberTargetVmax==null?0:clamp(
          normal(memberTargetRand)*(2.8+1.8*spec.intensitySpreadScale),-9.5,9.5
        );
        if(memberTargetTail>0){
          memberRateScale=clamp(memberRateScale*1.12,.28,1.24);
          memberPeakBias+=3.0+.40*memberTargetTailMagnitude;
        }else if(memberTargetTail<0){
          memberRateScale=clamp(memberRateScale*.90,.26,1.18);
          memberPeakBias-=2.0+.30*memberTargetTailMagnitude;
        }
        const memberTargetDissent=memberTargetTail>0
          ? .64+.18*(1-targetResistancePick)
          : 0;
        const targetResponseBase=memberTargetTail>0?.22:memberTargetTail<0?1.32:(.90+.20*targetResistancePick);
        const memberTargetResponse=clamp(targetResponseBase+normal(memberTargetRand)*.13,.20,1.52);
        const targetDurationScatter=memberTargetTail>0
          ? (1.18+.30*memberTargetRand())
          : memberTargetTail<0
            ? (.68+.24*memberTargetRand())
            : clamp(1+normal(memberTargetRand)*.15,.72,1.34);
        const memberTargetDuration=memberEffectiveTargetVmax==null?0:
          guidanceTargetDecayDurationHours(initialVmax,memberEffectiveTargetVmax,memberGenesisEnvironment,!!opts.storm.landed)*targetDurationScatter;
        const memberTerrainRand=rng(`${opts.seed}|MEMBER-TERRAIN|${center.modelId}|${m}|${Math.floor(opts.currentHour/6)}`);
        const memberTerrainFrictionScale=clamp(1+normal(memberTerrainRand)*.14,.68,1.38);
        const memberRmwScale=clamp(1+normal(memberTerrainRand)*.075,.82,1.22);

        const track:AetherGuidancePoint[]=[];
        let prevCross=0,prevAlong=0;
        let integratedMemberEast=0,integratedMemberNorth=0;
        const memberSteeringCoeff=clusterPick<.56?modelScenarioCoefficient(spec.id,horizon,horizon,issueRegime):
          clusterPick<.77?modelScenarioCoefficient(alternateFamily,horizon,horizon,issueRegime):
          clusterPick<.93?0.5*(modelScenarioCoefficient(spec.id,horizon,horizon,issueRegime)+
            modelScenarioCoefficient(alternateFamily,horizon,horizon,issueRegime)):
            (pathRand()<.5?-1:1)*(0.95+.78*pathRand());
        const memberSteeringOnset=issueRegime.troughArrivalHour-29+normal(pathRand)*(20+9*verification.directionalMismatch);
        const memberSteeringAmplitude=clamp((.76+.48*normal(pathRand))*verification.swayScale,.20,2.70);
        let memberSeaHoursAfterLand=memberStructuralDamage.warmWaterHoursAfterSea;
        let memberRecentLand=memberStructuralDamage.recentLand;
        let memberLandHours=memberStructuralDamage.landHours;
        let memberTimingOffsetKm=0;

        for(let i=0;i<center.track.length;i++){
          const cp=center.track[i],g=geometry[i],f=cp.leadHour/Math.max(1,horizon),grow=Math.pow(clamp(f,0,1),.86);
          const interModelSpread=centerSpreadByIndex[Math.min(i,centerSpreadByIndex.length-1)]||0;
          const lateMerge=smoothstep((cp.leadHour-issueRegime.consensusStart)/Math.max(12,horizon-issueRegime.consensusStart));
          // Spread grows against *absolute lead time*, not lead/horizon. Otherwise a 6-12 h member
          // perturbation becomes almost invisible on a 120/168 h product. All members still share
          // the exact analysed centre at t=0, but by 6-24 h a realistic small steering/initial-
          // condition spread is already present. Long-range background uncertainty has a hard floor
          // so a quiet issue cannot collapse into an implausibly tidy brush at day 4-7.
          const spreadActivation=smoothstep(cp.leadHour/Math.max(7.5,18-10.5*memberGenesisUncertainty));
          const spreadContraction=Math.max(.80,1-issueRegime.memberRemergeStrength*lateMerge*.29);
          const farLeadGrowth=1+(.16+.31*issueRegime.longRangeUncertainty)*smoothstep((cp.leadHour-24)/Math.max(24,horizon*.52));
          // Real ensemble spread is not a simple expanding fan. Keep early members separated by
          // small analysis uncertainty, then amplify only when synoptic regime uncertainty grows.
          // The previous quadratic growth made every quiet case turn into a brush after day 4.
          const nonlinearLeadGrowth=(0.42+0.58*smoothstep((cp.leadHour-24)/Math.max(24,horizon*.42)));
          const legacySpread=(18+cp.leadHour*1.49+.0074*cp.leadHour*cp.leadHour)*spec.spreadScale*spreadActivation*memberGenesisBoost;
          const baselineSigma=(13+cp.leadHour*.63+0.0029*cp.leadHour*cp.leadHour)*spec.spreadScale*spreadActivation*memberGenesisBoost*spreadContraction*farLeadGrowth*nonlinearLeadGrowth+
            legacySpread*(.14+.17*issueRegime.regimeStrength)*spreadContraction;
          const disagreementGate=smoothstep(cp.leadHour/Math.max(8,18-9.5*memberGenesisUncertainty));
          const disagreementFloor=interModelSpread*(0.65+0.15*spec.spreadScale)*(0.86+0.17*memberGenesisBoost)*disagreementGate*spreadContraction;
          const minimumSynopticSpread=(9+cp.leadHour*.54+0.0037*cp.leadHour*cp.leadHour)*spreadActivation*(.98+0.19*memberGenesisBoost)*(1+.48*memberGenesisUncertainty);
          // Verification-aware spread: repeated overlap with earlier forecasts contracts the plume
          // over successive cycles. A persistent large-direction miss expands it. A parallel
          // same-heading offset has little effect because it scores neither as overlap nor as a
          // directional regime failure.
          const sigmaKm=Math.max(baselineSigma,disagreementFloor,minimumSynopticSpread)*verification.spreadScale;

          // Coherent piecewise synoptic errors, not decorative sine waves.  Members may change
          // regime at a 3-h node, but they should not wiggle north/south simply to look less tidy.
          const legacyShapeGate=smoothstep(cp.leadHour/12)*(.36+.34*issueRegime.regimeStrength)*
            (1+.46*verification.directionalMismatch);
          const synopticCross=.87*sampleLinearKnots(crossKnots,f)+legacyShapeGate*(
            .72*sampleSmoothKnots(legacyCrossKnots,f)+
            .18*Math.sin(2*Math.PI*f+legacyPhase)+.12*Math.sin(4*Math.PI*f+legacyPhase*.53));
          const synopticAlong=.77*sampleLinearKnots(alongKnots,f)+legacyShapeGate*(
            .70*sampleSmoothKnots(legacyAlongKnots,f)+.22*Math.sin(2*Math.PI*f+legacyPhase*.71));

          const modelCoeff=modelScenarioCoefficient(spec.id,cp.leadHour,horizon,issueRegime);
          const alternateCoeff=modelScenarioCoefficient(alternateFamily,cp.leadHour,horizon,issueRegime);
          let memberCoeff:number;
          if(clusterPick<.58)memberCoeff=modelCoeff+clusterNoise;
          else if(clusterPick<.78)memberCoeff=alternateCoeff+clusterNoise*.65;
          else if(clusterPick<.94)memberCoeff=(modelCoeff+alternateCoeff)*.5+clusterNoise*.45;
          else memberCoeff=modelCoeff+clusterOutlier;
          const scenarioEnvelope=issueRegime.splitAmplitudeKm*splitMergeEnvelope(cp.leadHour,horizon,issueRegime);
          const deltaCoeff=memberCoeff-modelCoeff;
          const scenarioEast=issueRegime.axisEast*scenarioEnvelope*deltaCoeff;
          const scenarioNorth=issueRegime.axisNorth*scenarioEnvelope*deltaCoeff;
          // Persistent synoptic steering disagreement changes the path's *direction*, including
          // the poleward/recurvature decision. Integrate the differing winds, not a final-point fan.
          const familyWind=steeringVelocityKmH(modelCoeff,cp.leadHour,
            issueRegime.troughArrivalHour-29,issueRegime);
          const memberWind=steeringVelocityKmH(memberSteeringCoeff*memberSteeringAmplitude,
            cp.leadHour,memberSteeringOnset,issueRegime);
          const dt=i?Math.max(0,cp.leadHour-center.track[i-1].leadHour):0;
          integratedMemberEast+=(memberWind.east-familyWind.east)*dt;
          integratedMemberNorth+=(memberWind.north-familyWind.north)*dt;
          const scenarioCross=(scenarioEast+integratedMemberEast)*g.nx+
            (scenarioNorth+integratedMemberNorth)*g.ny;
          const scenarioAlong=(scenarioEast+integratedMemberEast)*g.tx+
            (scenarioNorth+integratedMemberNorth)*g.ty;

          // Independent synoptic timing errors are finite episodes, not one-way radial divergence.
          // Some members therefore separate for 1-3 days and later return toward the consensus.
          const branchOn=smoothstep((f-branchStart)/.16);
          const branchOff=1-(.42+.30*issueRegime.regimeStrength)*smoothstep((f-(branchStart+.34))/.24);
          const branchPulse=branchPick>branchChance?0:branchAmplitude*branchOn*branchOff;
          const secondaryBranch=(branchPick>branchChance*.36&&branchPick<branchChance*.76
            ? (branchAmplitude*.48)*smoothstep((f-(branchStart*.82))/.18)*(1-.42*lateMerge)
            : 0);
          // A small persistent heading/speed-analysis perturbation makes the first 6-24 h fan
          // visible without creating a fake instantaneous jump at t=0. It then blends into the
          // synoptic perturbations, so tracks bend independently rather than remaining parallel.
          const earlyHeading=(crossKnots[1]*.22+crossKnots[2]*.09)*minimumSynopticSpread +
            zInitialCross*(9+4.5*memberGenesisBoost+15*memberGenesisUncertainty);
          const earlySpeed=(alongKnots[1]*.18+alongKnots[2]*.07)*minimumSynopticSpread +
            zInitialAlong*(5.5+3.5*memberGenesisBoost+8*memberGenesisUncertainty);
          const earlyPulse=spreadActivation*(1-.42*smoothstep((cp.leadHour-30)/42));
          let crossKm=sigmaKm*(synopticCross+branchPulse+secondaryBranch)+scenarioCross+earlyHeading*earlyPulse;
          let alongKm=sigmaKm*.64*synopticAlong+scenarioAlong+earlySpeed*earlyPulse;

          const parentStepKm=i>0?guidanceDistanceKm(center.track[i-1],cp):0;
          const legacyMemberCrossCap=31+cp.leadHour*.25,legacyMemberAlongCap=28+cp.leadHour*.22;
          const maxCrossStep=i>0
            ? Math.min(legacyMemberCrossCap,Math.max(6.2,7.2+parentStepKm*.77))
            : legacyMemberCrossCap;
          const maxAlongStep=i>0
            ? Math.min(legacyMemberAlongCap,Math.max(7.6,8.2+parentStepKm*.93))
            : legacyMemberAlongCap;
          const previousCross=prevCross,previousAlong=prevAlong;
          crossKm=clamp(crossKm,previousCross-maxCrossStep,previousCross+maxCrossStep);
          alongKm=clamp(alongKm,previousAlong-maxAlongStep,previousAlong+maxAlongStep);
          const deltaCross=crossKm-previousCross;
          let deltaAlong=alongKm-previousAlong;
          prevCross=crossKm;prevAlong=alongKm;

          let memberLat=cp.lat,memberLon=cp.lon;
          if(track.length&&i>0){
            const previousMember=track[track.length-1];
            const parentPrevious=center.track[i-1];
            const memberSpeedFactor=clamp(memberSpeedBias+sampleSmoothKnots(memberSpeedKnots,f),.55,1.46);
            const meanLat=(parentPrevious.lat+cp.lat)*.5;
            const parentEast=(cp.lon-parentPrevious.lon)*kmPerLon(meanLat);
            const parentNorth=(cp.lat-parentPrevious.lat)*111.12;
            const previousTimingOffset=memberTimingOffsetKm;
            const timingLimit=Math.min(165,22+cp.leadHour*.90);
            memberTimingOffsetKm=clamp(
              memberTimingOffsetKm+parentStepKm*(memberSpeedFactor-1),
              -timingLimit,timingLimit
            );
            const speedTimingDelta=memberTimingOffsetKm-previousTimingOffset;
            const desiredForward=parentStepKm+speedTimingDelta;
            const minimumForward=parentStepKm>1.2?Math.max(.12,parentStepKm*.12):0;
            deltaAlong=Math.max(deltaAlong,minimumForward-desiredForward);
            const stallGate=.04+.96*smoothstep((parentStepKm-.5)/14);
            const east=parentEast+
              g.tx*speedTimingDelta+
              stallGate*(g.nx*deltaCross+g.tx*deltaAlong);
            const north=parentNorth+
              g.ty*speedTimingDelta+
              stallGate*(g.ny*deltaCross+g.ty*deltaAlong);
            const incremental={
              lat:previousMember.lat+north/111.12,
              lon:previousMember.lon+east/kmPerLon(previousMember.lat)
            };
            const memberCurvatureLimited=i>=2
              ? constrainGuidanceTurnToBaselineCurvature(
                  track,incremental,center.track[i-2],parentPrevious,cp,14
                )
              : incremental;
            const corridor=constrainGuidanceStepToBaselineHeading(
              previousMember,memberCurvatureLimited,parentPrevious,cp,parentStepKm,50
            );
            memberLat=corridor.lat;memberLon=corridor.lon;
          }
          const env=sampleEnvironment(memberLat,memberLon,opts.currentHour+cp.leadHour);
          const manualSpreadSignal=clamp(Math.max(env.manualDry*.96,(env.manualShear-15)/28),0,1);
          if(manualSpreadSignal>0.04&&track.length&&i>0){
            const spreadGate=.26+.74*smoothstep((cp.leadHour-6)/42);
            const driftCrossKm=(normal(pathRand)*(5.5+28*manualSpreadSignal)+memberDryBias*7*env.manualDry)*spreadGate;
            const driftAlongKm=normal(pathRand)*(2.2+12*manualSpreadSignal)*spreadGate;
            memberLat+=(g.nx*driftCrossKm+g.tx*driftAlongKm)/111.12;
            memberLon+=(g.ny*driftCrossKm+g.ty*driftAlongKm)/kmPerLon(memberLat);
          }
          const memberLand = getGuidanceLandMetrics(memberLat, memberLon, config, !!opts.useProductCoastline);
          const memberLanded = !!memberLand.isLand;
          memberLandHours = memberLanded ? Math.min(120, memberLandHours + (track.length ? 3 : 0)) : 0;
          const perceivedDry=clamp(env.dry*memberDrySensitivity+memberDryBias,0,1);
          const dryAlpha=perceivedDry>memberDryMemory?.48:.22;
          memberDryMemory+=(perceivedDry-memberDryMemory)*dryAlpha;
          const memberTerrainVmax=track.length?track[track.length-1].vmax:initialVmax;
          const memberCoreInteraction=getGuidanceCoreSurfaceInteraction(
            memberLat,memberLon,guidanceRmwKm(opts.storm,memberTerrainVmax,memberRmwScale),Math.max(10,memberTerrainVmax),config
          );
          let memberStructuralStep=stepGuidanceStructuralDamage(
            memberStructuralDamage,memberCoreInteraction,memberLanded,env,memberTerrainVmax,track.length?3:0,
            memberTerrainFrictionScale,Number(opts.storm.coreCompactness??.55),Number(opts.storm.eyewallIntegrity??.50)
          );
          memberSeaHoursAfterLand=memberStructuralDamage.warmWaterHoursAfterSea;
          memberRecentLand=memberStructuralDamage.recentLand;
          memberLandHours=memberStructuralDamage.landHours;
          const memberShearStress=clamp((env.shear-15)/24,0,1);
          const memberVentTarget=clamp(Math.max(memberDryMemory*.90,memberShearStress*.84)-.10,0,1);
          if(memberVentTarget>memberVentilationDamageMemory) memberVentilationDamageMemory+=(memberVentTarget-memberVentilationDamageMemory)*.40;
          else memberVentilationDamageMemory*=Math.exp(-3/(78+90*memberVentilationDamageMemory));
          applyGuidanceVentilationScar(memberStructuralDamage,memberDryMemory,env.shear,env.rh,memberTerrainVmax,track.length?3:0);
          memberStructuralStep=summariseGuidanceStructuralDamage(memberStructuralDamage,memberStructuralStep.directIntensityLossMps);
          memberTerrainDamageMemory=memberStructuralStep.terrainMemory;
          const memberDamageMemory=clamp(1-(1-memberStructuralStep.totalStructuralMemory)*(1-memberVentilationDamageMemory),0,1);

          const timingShift=clamp(zTiming*9.0*grow+sampleLinearKnots(alongKnots,f)*2.2*grow,-20,20);
          const timed=interpolateGuidance(center.track,clamp(cp.leadHour+timingShift,0,horizon))||cp;
          const timedPrev=interpolateGuidance(center.track,clamp(Math.max(0,cp.leadHour-3)+timingShift,0,horizon))||timed;
          const intensitySigma=(0.62+cp.leadHour*.029)*spec.intensitySpreadScale*(0.92+0.08*memberGenesisBoost)*
            (1+1.20*memberGenesisUncertainty*(1-.45*smoothstep((cp.leadHour-36)/54)));
          let vmax=timed.vmax;

          if(track.length){
            const prevV=track[track.length-1].vmax;
            const centerStep=timed.vmax-timedPrev.vmax;
            // A small target-dissent branch discounts only the parent centre's target-driven
            // weakening signal. Its own terrain/dry-air/shear penalties remain untouched.
            const inheritedCenterStep=centerStep<0?centerStep*(1-.98*memberTargetDissent):centerStep;
            const dryGrowthFactor=clamp(1-.34*memberDryMemory,.50,1);
            const baseIntegrity=clamp(Number(timed.lowLevelVortexIntegrity??.35),0,1);
            const integrity=clamp(baseIntegrity*memberStructuralStep.lowLevelIntegrityScale,0.04,1);
            const landMemorySignal=memberLanded
              ? 1
              : (memberRecentLand || Number(timed.warmWaterHoursAfterSea||0)>0)
                ? clamp((0.86-integrity)/0.42,0,1)
                : 0;
            const rawTendencyScale=inheritedCenterStep>=0?memberRateScale*dryGrowthFactor:memberWeakeningScale*(.92+.30*memberDryMemory);
            const damageGrowthBrake=inheritedCenterStep>=0
              ? Math.min(.28+.72*(1-memberDamageMemory),memberStructuralStep.structuralPenaltyFactor)
              : 1;
            const tendencyScale=(rawTendencyScale*damageGrowthBrake)*(1-0.48*landMemorySignal)+1*(0.48*landMemorySignal);
            vmax=prevV+inheritedCenterStep*tendencyScale;

            const phaseEnvelope=guidanceIntensityBlend(f)*(0.34+0.66*Math.sin(Math.PI*clamp(f,0,1)));
            const targetErrorScale=memberTargetVmax==null?1:
              guidanceTargetErrorScale(cp.leadHour,horizon,memberTargetTail!==0);
            // Do not shrink the member's intrinsic physical spread just because a target intensity
            // exists. Only the separate target-interpretation bias contracts with lead time.
            const intensityError=intensitySigma*sampleSmoothKnots(intensityKnots,f);
            const dissentLift=memberTargetDissent*Math.max(0,initialVmax-timed.vmax)*(.86+.10*guidanceIntensityBlend(f));
            const tailBias=memberTargetTailBias*guidanceTargetTailEnvelope(cp.leadHour)*
              (1-.54*landMemorySignal)*(1-.64*memberDamageMemory);
            const peakTarget=timed.vmax+dissentLift+
              (memberPeakBias*phaseEnvelope+intensityError+tailBias)*
              (1-0.52*landMemorySignal)*(1-.72*memberDamageMemory);
            vmax+=(peakTarget-vmax)*(0.06+0.10*grow);

            // Ambient synoptic dry air acts even when no manual polygon exists. Manual dry-air
            // regions strengthen the same term. Different members perceive/mix that dry air with
            // different efficiency, producing genuine intensity disagreement.
            const dryPenalty=Math.max(0,memberDryMemory-.44)*(0.48+1.72*smoothstep((prevV-22)/36))*(env.manualDry>.15?(1.34+.12*env.manualDry):1)*smoothstep((prevV-32.7)/9);
            vmax-=dryPenalty;
            vmax-=memberStructuralStep.directIntensityLossMps;

            if(memberLanded){
              memberRecentLand=memberStructuralDamage.recentLand;memberSeaHoursAfterLand=memberStructuralDamage.warmWaterHoursAfterSea;
              vmax-= (1-integrity)*(0.75+0.85*(1-integrity));
              const terrainExposure = clamp(Number(memberLand.elevation || 0) / 2200, 0, 1);
              const mountainSeverity=clamp(Math.max(
                terrainExposure,memberCoreInteraction.blockingIndex,memberCoreInteraction.mountainFraction*1.90,
                smoothstep((memberCoreInteraction.maxElevation-650)/1650)
              ),0,1);
              const landDecay = (0.58 + 1.82 * terrainExposure) * (0.54 + 0.82 * smoothstep((prevV - 20) / 36)) *
                (0.70 + 0.30 * smoothstep(memberLandHours / 9)) * memberTerrainFrictionScale * (1+.78*mountainSeverity);
              vmax -= landDecay;
            }else if(memberRecentLand||Number(timed.warmWaterHoursAfterSea||0)>0){
              memberSeaHoursAfterLand=Math.max(memberStructuralDamage.warmWaterHoursAfterSea,Number(timed.warmWaterHoursAfterSea||0));
              const recoveryGate=smoothstep((memberSeaHoursAfterLand-12)/45);
              vmax+=Math.max(0,memberRecoveryScale-.55)*.92*recoveryGate*(0.28+0.72*integrity)*Math.pow(1-memberDamageMemory,1.40);
              const landLock=Math.max(clamp((0.80-integrity)/0.34,0,1),memberTerrainDamageMemory*.97,memberDamageMemory*.66);
              if(vmax>timed.vmax) vmax=timed.vmax+(vmax-timed.vmax)*(1-0.62*landLock);
              const postMountainGate=(1-smoothstep((memberSeaHoursAfterLand-5)/30))*landLock;
              if(vmax>prevV) vmax=prevV+(vmax-prevV)*(1-.88*postMountainGate);
              if(memberSeaHoursAfterLand>114 && memberTerrainDamageMemory<.12 && memberDamageMemory<.16)memberRecentLand=false;
            }

            if(timed.remnantVortex||prevV<17.2)vmax=Math.max(vmax,remnantFloor(timed,memberRemnantSurvival));
            const remnantBoost=!memberLanded&&(timed.remnantVortex||memberSeaHoursAfterLand>3)?0.70*memberRecoveryScale*(1-memberDamageMemory):0;
            const memberLeadTarget=memberEffectiveTargetVmax==null?null:clamp(
              memberEffectiveTargetVmax+memberTargetInterpretationBias*targetErrorScale,3.5,110
            );
            vmax=applyGuidanceTargetDecay(vmax,prevV,initialVmax,memberLeadTarget,cp.leadHour,memberTargetDuration,memberTargetResponse);
            if(memberTargetTail!==0 && memberEffectiveTargetVmax!=null){
              const tailEnvelope=guidanceTargetTailEnvelope(cp.leadHour);
              if(memberTargetTail>0 && vmax<memberEffectiveTargetVmax && !memberLanded){
                const favorableTailSupport=clamp(
                  .38+.24*clamp((env.sst-26.5)/2.8,0,1)+.20*clamp((16-env.shear)/11,0,1)+.18*clamp((env.rh-52)/28,0,1),
                  .30,1
                )*(1-.78*memberDamageMemory);
                vmax+=(memberEffectiveTargetVmax-vmax)*(.080+.140*tailEnvelope)*favorableTailSupport;
              }else if(memberTargetTail<0 && vmax>memberEffectiveTargetVmax){
                const lowTailAuthority=(.05+.07*tailEnvelope)*(.72+.28*memberWeakeningScale);
                vmax+=(memberEffectiveTargetVmax-vmax)*lowTailAuthority;
              }
            }

            const postTerrainLock=clamp(Math.max(memberTerrainDamageMemory,memberDamageMemory*.84),0,1)*
              (memberLanded?1:(1-smoothstep((memberSeaHoursAfterLand-5)/36)));
            const riseCap=maxSixHourRise(prevV,inheritedCenterStep*2,memberRateScale,remnantBoost)*0.54*
              (memberTargetTail>0?1.25:1)*(1-.80*postTerrainLock);
            const terrainWeakeningActive=memberLanded || (memberRecentLand&&postTerrainLock>.22);
            const fallCap=maxSixHourFall(prevV,terrainWeakeningActive,memberWeakeningScale)*(.54+.14*postTerrainLock)*(memberTargetTail<0?1.18:1);
            vmax=clamp(vmax,prevV-fallCap,prevV+Math.max(.16,riseCap));
            const weakGenesisBranch=developmentPick<(.16+.08*memberGenesisUncertainty);
            const strongGenesisBranch=developmentPick>(.92-.18*memberGenesisUncertainty);
            vmax=keepViableGenesisFromInstantCollapse(vmax,cp.leadHour,initialVmax,
              memberGenesisSupport,weakGenesisBranch);
            if(!memberLanded && initialVmax<17.2 && cp.leadHour>0 && cp.leadHour<=42 && memberGenesisSupport>.25){
              const genesisEnvelope=1-.62*smoothstep((cp.leadHour-27)/15);
              const developmentLift=memberGenesisSupport*memberGenesisUncertainty*(.20+.34*smoothstep(cp.leadHour/18))*genesisEnvelope;
              vmax+=developmentLift*(weakGenesisBranch?.10:strongGenesisBranch?1.55:(.72+.34*developmentPick));
            }
          }

          // Preserve the ensemble's physical/intensity dispersion while giving the hand-authored
          // curve a moderately high common-reference weight. Because the correction is based on the
          // parent centre rather than this member's own error, upper/lower tails remain distinct.
          const memberManualIntensity=manualForecastIntensityTarget(config,cp.leadHour);
          if(memberManualIntensity!==null&&cp.leadHour>0){
            const commonManualDelta=memberManualIntensity-timed.vmax;
            vmax+=commonManualDelta*(.24+.10*smoothstep(cp.leadHour/30))*(memberLanded?.52:1);
          }

          vmax=Math.max(3.5,vmax);
          const pmin=pressureFromIntensityOffset(timed.pmin,timed.vmax,vmax,zPressure*(.62+1.82*grow));
          track.push({
            lat:memberLat,lon:memberLon,vmax,pmin,simHour:cp.simHour,leadHour:cp.leadHour,
            landed:memberLanded,remnantVortex:!!timed.remnantVortex||vmax<17.2,
            lowLevelVortexIntegrity:clamp(Number(timed.lowLevelVortexIntegrity??.4)*memberStructuralStep.lowLevelIntegrityScale,.04,1),warmWaterHoursAfterSea:memberSeaHoursAfterLand,
            dryAirIndex:memberDryMemory
          });
        }

        const summary=summariseTrack(center.modelId,track);
        output.push({id:`${center.modelId}-M${String(m).padStart(3,"0")}`,modelId:center.modelId,color:center.color,control:false,memberNumber:m,maxVmax:summary.maxVmax,minPmin:summary.minPmin,track:summary.track});
        done++;
      }
      if(done%25===0||done===total){
        opts.onProgress?.(done,total,`${center.modelId} ${Math.min(m+1,opts.membersPerModel)}/${opts.membersPerModel}`);
        await new Promise<void>(r=>setTimeout(r,0));
      }
    }
  }
  return applyForecastPeakTranslation(output,opts.storm,opts.currentHour,opts.referencePath,horizon,config);
}

export const AETHER_ENSEMBLE_MEMBER_COUNTS=[10,15,20,25,30,40,50,75,100,150,200,300,400,500,750,1000] as const;
