import { drawEnsembleIntensityAnalysis } from "./EnsembleIntensityAnalysis";
import type { SimulationConfig, Typhoon, TyphoonState } from "../types";
import type { AetherGuidanceMember, AetherGuidancePoint } from "../simulation/AetherEnsembleGuidance";
import { AETHER_MODEL_SPECS } from "../simulation/AetherEnsembleGuidance";
import { getSynopticEnvironmentState } from "../simulation/SynopticEnvironment";
import { getAgencyIntensity, getJtwcSshwsAssessment, JTWC_SSHWS_BANDS } from "../simulation/Engine";
import { productLandGeoJson } from "../simulation/NaturalEarthLoader";
import { strokeProductCoastlineRing } from "./ProductCoastlineDrawing";
import { drawStrikeProbabilityProduct, type StrikeProbabilityOptions } from "./StrikeProbabilityProduct";
import type { StrikeField } from "./StrikeProbabilityField";
import { loadAgencyBranding } from "./AgencyBranding";

export type EnsembleReferenceStyle =
  | "classic"
  | "track_diagnostics_4panel"
  | "diagnostic_matrix_2model"
  | "deterministic_overview"
  | "member_spaghetti_ranked"
  | "member_spaghetti_mean"
  | "diagnostic_matrix_3model"
  | "pressure_spaghetti_basin"
  | "paired_cycle_pressure"
  | "model_intensity_guidance"
  | "ensemble_intensity_forecast"
  | "strike_probability_120km"
  | "ensemble_intensity_analysis";

export const ENSEMBLE_REFERENCE_STYLES: ReadonlyArray<{
  id: EnsembleReferenceStyle;
  name: string;
  shortName: string;
  description: string;
  needsMembers: boolean;
  aspect: number;
}> = [
  { id: "classic", name: "WMC 经典集系图", shortName: "经典", description: "现有多模式 / 成员集系路径产品。", needsMembers: false, aspect: 4 / 3 },
  { id: "deterministic_overview", name: "多模式路径总览", shortName: "路径总览", description: "宽幅东亚底图、全部中心路径与预报时效标注。", needsMembers: false, aspect: 1400 / 1016 },
  { id: "pressure_spaghetti_basin", name: "全域气压分级集系", shortName: "气压集系", description: "宽区域成员轨迹，节点按最低海平面气压等级着色。", needsMembers: true, aspect: 3 / 2 },
  { id: "paired_cycle_pressure", name: "双周期气压集系对比", shortName: "双周期", description: "当前周期实线与前一周期虚线对照，附最低气压 / ACE 成员表。", needsMembers: true, aspect: 1500 / 1015 },
  { id: "ensemble_intensity_analysis", name: "综合集系分析", shortName: "综合分析", description: "集合路径、攻击概率及强度分位的七面板综合诊断。", needsMembers:true, aspect:1988/1871 },
  { id: "strike_probability_120km", name: "袭击概率图 · 120 km", shortName: "袭击概率", description: "成员中心进入半径范围的比例：真实概率栅格、沿岸概率、平均路径和县市概率胶囊。", needsMembers: true, aspect: 2030 / 1840 },
] as const;

export const ensembleReferenceStyleNeedsMembers = (style: EnsembleReferenceStyle) =>
  ENSEMBLE_REFERENCE_STYLES.find((item) => item.id === style)?.needsMembers ?? false;

export const getEnsembleReferenceAspect = (style: EnsembleReferenceStyle) =>
  ENSEMBLE_REFERENCE_STYLES.find((item) => item.id === style)?.aspect ?? 4 / 3;

/** Resolve at render time so preview, PNG, and global preferences use the same source. */
const ensembleAgencyCode=()=>loadAgencyBranding('ensemble_tracks').agencyCode;
const brandedEnsembleCaption=(text:string)=>text.replace(/\bWMC\b/g,ensembleAgencyCode());
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const EMPTY_HISTORY: Array<{ lat: number; lon: number; vmax?: number; pmin?: number; simHour?: number }> = [];

type Rect = { x: number; y: number; w: number; h: number };
type TrackLike = { id?: string; modelId?: string; color?: string; track: AetherGuidancePoint[]; maxVmax?: number; minPmin?: number; memberNumber?: number; control?: boolean };

type DrawArgs = {
  canvas: HTMLCanvasElement;
  style: EnsembleReferenceStyle;
  typhoon: Typhoon;
  activeState: Partial<TyphoonState> & { lat: number; lon: number; vmax: number; pmin: number };
  currentHour: number;
  startDate: Date;
  config?: SimulationConfig;
  centers: AetherGuidanceMember[];
  members: AetherGuidanceMember[];
  referencePath: any[];
  /** Normal operational stop-numbering path used only for map framing. Diagnostic products may
   * continue a residual vortex beyond this path without zooming the entire map out to that tail. */
  framingReferencePath?: any[];
  /** Explicit total product lead-time cap measured from the issue time. */
  forecastHorizonHours?: number;
  /** Special pressure-ensemble map framing: operational stop path (default) or all displayed members. */
  specialMapRangeMode?: "operational" | "all";
  /** Show deterministic reference/control tracks on special ensemble products. */
  specialShowMainPath?: boolean;
  /** End displayed special pressure-ensemble tracks at normal operational stop or follow residual vortex. */
  specialTrackEndMode?: "operational" | "residual";
  historicalTrack?: Array<{ lat: number; lon: number; vmax?: number; pmin?: number; simHour?: number }>;
  width: number;
  height: number;
  isMini?: boolean;
  stormName: string;
  selectedModelIds?: string[];
  strike?: StrikeProbabilityOptions;
  ensembleAnalysisFooter?: string;
  ensembleAnalysisUnit?: "kt" | "m/s";
  signal?: AbortSignal;
  onProgress?: (progress:number) => void;
  strikeCache?: Map<string, StrikeField>;
};

const modelColor = (modelId: string | undefined, fallback = "#334155") =>
  AETHER_MODEL_SPECS.find((m) => m.id === modelId)?.color || fallback;

const jtwcKt = (vmaxMps: number, mode: "public" | "continuous" = "continuous") =>
  Number(getAgencyIntensity(Math.max(0, finite(vmaxMps)), "JTWC", mode).value || 0);

const sshwsColor = (category: ReturnType<typeof getJtwcSshwsAssessment>["category"]) => {
  if (category === "C5") return "#e044dd";
  if (category === "C4") return "#7f0015";
  if (category === "C3") return "#e60000";
  if (category === "C2") return "#f57b00";
  if (category === "C1") return "#f2c300";
  if (category === "TS") return "#16a4d8";
  if (category === "TD") return "#0d8f35";
  return "#13c82d";
};

const windCategoryColor = (vmaxMps: number) =>
  sshwsColor(getJtwcSshwsAssessment(vmaxMps, "public").category);

const pressureColor = (pmin: number) => {
  if (pmin < 900) return "#1015a7";
  if (pmin < 930) return "#5b1a8b";
  if (pmin < 950) return "#eb144c";
  if (pmin < 970) return "#ff1694";
  if (pmin < 980) return "#ff9200";
  if (pmin < 990) return "#42ad75";
  if (pmin < 1000) return "#2589e8";
  return "#1f2937";
};

const pressureBins = [
  ["1000–1010 hPa", "#1f2937"],
  ["990–1000 hPa", "#2589e8"],
  ["980–990 hPa", "#42ad75"],
  ["970–980 hPa", "#ff9200"],
  ["950–970 hPa", "#ff1694"],
  ["930–950 hPa", "#eb144c"],
  ["900–930 hPa", "#5b1a8b"],
  ["< 900 hPa", "#1015a7"]
] as const;

const safeFont = (px: number, weight = 400) => `${weight} ${Math.max(7, px)}px Arial,"Microsoft YaHei",sans-serif`;

function clear(ctx: CanvasRenderingContext2D, w: number, h: number, fill = "#ffffff") {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function formatIssue(startDate: Date, currentHour: number) {
  const d = new Date(startDate.getTime() + currentHour * 3600000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")} ${String(d.getUTCHours()).padStart(2,"0")}Z`;
}

function formatDateTick(startDate: Date, currentHour: number, lead: number) {
  const d = new Date(startDate.getTime() + (currentHour + lead) * 3600000);
  return `${String(d.getUTCMonth()+1).padStart(2,"0")}/${String(d.getUTCDate()).padStart(2,"0")}\n${String(d.getUTCHours()).padStart(2,"0")}Z`;
}

function trackPoints(tracks: TrackLike[], history: DrawArgs["historicalTrack"] = []) {
  const pts: Array<{ lat: number; lon: number }> = [];
  for (const p of history || []) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) pts.push({lat:p.lat,lon:p.lon});
  for (const t of tracks) for (const p of t.track || []) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) pts.push({lat:p.lat,lon:p.lon});
  return pts;
}

function boundsForTracks(tracks: TrackLike[], history: DrawArgs["historicalTrack"], rect: Rect, fixedWide = false) {
  const pts = trackPoints(tracks, history);
  if (!pts.length) pts.push({lat:20,lon:130},{lat:35,lon:145});
  let minLat=Math.min(...pts.map(p=>p.lat)), maxLat=Math.max(...pts.map(p=>p.lat));
  let minLon=Math.min(...pts.map(p=>p.lon)), maxLon=Math.max(...pts.map(p=>p.lon));
  const latSpan=Math.max(.4,maxLat-minLat), lonSpan=Math.max(.4,maxLon-minLon);
  const padLat=Math.max(fixedWide?2.2:1.35,latSpan*(fixedWide ? .082 : .072));
  const padLon=Math.max(fixedWide?3.0:1.85,lonSpan*(fixedWide ? .078 : .070));
  minLat=clamp(minLat-padLat,-70,75); maxLat=clamp(maxLat+padLat,-65,80);
  minLon=clamp(minLon-padLon,-180,180); maxLon=clamp(maxLon+padLon,-180,180);
  if(maxLat-minLat<(fixedWide?15.5:11)){const c=(maxLat+minLat)/2; const s=(fixedWide?15.5:11)/2; minLat=c-s;maxLat=c+s;}
  if(maxLon-minLon<(fixedWide?23:15)){const c=(maxLon+minLon)/2; const s=(fixedWide?23:15)/2; minLon=c-s;maxLon=c+s;}
  const midLat=(minLat+maxLat)/2, cosMid=Math.max(.22,Math.cos(midLat*Math.PI/180));
  const geoAspect=((maxLon-minLon)*cosMid)/Math.max(.01,maxLat-minLat), boxAspect=rect.w/Math.max(1,rect.h);
  if(geoAspect<boxAspect){const want=(maxLat-minLat)*boxAspect/cosMid; const d=(want-(maxLon-minLon))/2;minLon-=d;maxLon+=d;}
  else {const want=(maxLon-minLon)*cosMid/boxAspect;const d=(want-(maxLat-minLat))/2;minLat-=d;maxLat+=d;}
  return {minLat,maxLat,minLon,maxLon};
}

function boundsForOperationalForecast(args:DrawArgs, rect:Rect, fixedWide=true) {
  const source=(args.framingReferencePath?.length ? args.framingReferencePath : args.referencePath) || [];
  const track=[
    {lat:finite(args.activeState.lat),lon:finite(args.activeState.lon)},
    ...source
      .filter((p:any)=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lon)))
      .map((p:any)=>({lat:Number(p.lat),lon:Number(p.lon)}))
  ];
  const frameTrack:TrackLike={track:track as AetherGuidancePoint[]};
  return boundsForTracks([frameTrack],EMPTY_HISTORY,rect,fixedWide);
}

function roundedLeadCeiling(value: number, fallback = 120) {
  const finiteValue = Number.isFinite(value) ? value : fallback;
  return Math.max(72, Math.ceil(finiteValue / 24) * 24);
}

function lineLeadDomain(lines: Array<{ points: Array<{ x: number; y: number }> }>, fallback = 120) {
  const xs = lines.flatMap((line) => line.points.map((point) => point.x).filter((x) => Number.isFinite(x)));
  const positive = xs.filter((x) => x >= 0);
  return roundedLeadCeiling(positive.length ? Math.max(...positive) : Math.max(...xs, fallback), fallback);
}

function renderIntensityFallback(
  track: AetherGuidancePoint[],
  activeState: DrawArgs["activeState"],
  fallbackMaxVmax?: number,
  fallbackMinPmin?: number
) {
  if (!track.length) return track;
  const sourceVmax = track.map((pt) => finite(pt.vmax, activeState.vmax));
  const sourcePmin = track.map((pt) => finite(pt.pmin, activeState.pmin));
  const vmaxSpread = Math.max(...sourceVmax) - Math.min(...sourceVmax);
  const pminSpread = Math.max(...sourcePmin) - Math.min(...sourcePmin);
  const flatWind = vmaxSpread < 0.15;
  const flatPressure = pminSpread < 0.4;
  if (!flatWind && !flatPressure) return track.map((pt) => ({ ...pt }));

  const startWind = finite(track[0]?.vmax, activeState.vmax);
  const startP = finite(track[0]?.pmin, activeState.pmin);
  const minTrackP = Math.min(...sourcePmin, finite(fallbackMinPmin, startP));
  const maxTrackWind = Math.max(...sourceVmax, finite(fallbackMaxVmax, startWind));
  const pressureDrop = Math.max(0, startP - minTrackP);
  const derivedPeakWind = Math.max(startWind, maxTrackWind, startWind + pressureDrop * 0.82);

  return track.map((pt) => {
    const lead = Math.max(0, finite(pt.leadHour, pt.simHour));
    const lastPoint = track[track.length - 1];
    const leadNorm = track.length <= 1 ? 0 : lead / Math.max(1, finite(lastPoint?.leadHour, lastPoint?.simHour));
    const timeRamp = 1 - Math.exp(-leadNorm * 3.0);
    const pmin = finite(pt.pmin, startP);
    const pressureSignal = clamp((startP - pmin) / Math.max(4, startP - minTrackP || 1), 0, 1);
    const blend = Math.max(timeRamp * 0.72, pressureSignal);
    const vmax = flatWind ? startWind + (derivedPeakWind - startWind) * blend : finite(pt.vmax, startWind);
    const repairedPmin = flatPressure ? startP - (Math.max(0, vmax - startWind) / Math.max(1, derivedPeakWind - startWind || 1)) * pressureDrop : pmin;
    return {
      ...pt,
      vmax,
      pmin: Math.max(860, repairedPmin)
    };
  });
}

function displayTrackLike(track: TrackLike, args: DrawArgs): TrackLike {
  const cleanedTrack = renderIntensityFallback(track.track || [], args.activeState, track.maxVmax, track.minPmin);
  const peak = Math.max(...cleanedTrack.map((pt) => finite(pt.vmax, args.activeState.vmax)), finite(track.maxVmax, args.activeState.vmax));
  const minP = Math.min(...cleanedTrack.map((pt) => finite(pt.pmin, args.activeState.pmin)), finite(track.minPmin, args.activeState.pmin));
  return {
    ...track,
    track: cleanedTrack,
    maxVmax: peak,
    minPmin: minP
  };
}

function displayTracks<T extends TrackLike>(tracks: T[], args: DrawArgs): T[] {
  return tracks.map((track) => displayTrackLike(track, args) as T);
}

function trimTrackToHorizon<T extends TrackLike>(track: T, horizonHours: number): T {
  const horizon = Math.max(0, Number.isFinite(horizonHours) ? horizonHours : 168);
  const points=(track.track||[]).filter((pt)=>finite(pt.leadHour,pt.simHour)<=horizon+1e-6);
  const safePoints=points.length?points:(track.track?.length?[track.track[0]]:[]);
  const maxVmax=safePoints.length?Math.max(...safePoints.map((pt)=>finite(pt.vmax,0))):finite(track.maxVmax,0);
  const minPmin=safePoints.length?Math.min(...safePoints.map((pt)=>finite(pt.pmin,1010))):finite(track.minPmin,1010);
  return {...track,track:safePoints,maxVmax,minPmin} as T;
}

function displayTracksWithinHorizon<T extends TrackLike>(tracks:T[],args:DrawArgs,horizonHours:number):T[]{
  return tracks.map((track)=>displayTrackLike(trimTrackToHorizon(track,horizonHours),args) as T);
}

/** Normal ensemble stop-numbering: keep the first node that diagnoses sub-15 m/s wind, then
 * terminate the member. No later residual-vortex path is shown in this mode. */
function trimTrackAtOperationalWindThreshold<T extends TrackLike>(track:T,horizonHours:number,thresholdMps=15):T {
  const base=trimTrackToHorizon(track,horizonHours);
  const pts=base.track||[];
  if(pts.length<2)return base;
  const firstBelow=pts.findIndex((pt,index)=>index>0&&finite(pt.vmax,999)<thresholdMps);
  if(firstBelow<0)return base;
  const safe=pts.slice(0,firstBelow+1).map((pt)=>({...pt}));
  return {
    ...base,
    track:safe,
    maxVmax:Math.max(...safe.map((pt)=>finite(pt.vmax,0))),
    minPmin:Math.min(...safe.map((pt)=>finite(pt.pmin,1010)))
  } as T;
}

function normalTerminationDisplayTracks<T extends TrackLike>(tracks:T[],args:DrawArgs,horizonHours:number):T[]{
  return tracks.map((track)=>displayTrackLike(trimTrackAtOperationalWindThreshold(track,horizonHours,15),args) as T);
}

function stableTrackHash01(track: TrackLike, salt = "post5-tail"): number {
  const key=`${track.id||""}|${track.modelId||""}|${track.memberNumber??0}|${salt}`;
  let h=2166136261>>>0;
  for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  h^=h>>>16;h=Math.imul(h,0x7feb352d)>>>0;h^=h>>>15;h=Math.imul(h,0x846ca68b)>>>0;h^=h>>>16;
  return (h>>>0)/4294967295;
}

/**
 * Pressure-spaghetti / dual-cycle products keep a weak residual circulation visible after it first
 * falls to 5 m/s, but not indefinitely. Each model/member receives a stable 14–24 h post-threshold
 * lifetime so the ensemble does not vanish in one synchronized wall. The total forecast horizon is
 * always the hard upper bound.
 */
function trimTrackToPostFiveWindow<T extends TrackLike>(track:T,horizonHours:number,salt="current"):T {
  const horizon=Math.max(0,Number.isFinite(horizonHours)?horizonHours:168);
  const base=trimTrackToHorizon(track,horizon);
  const pts=base.track||[];
  if(pts.length<2)return base;
  const firstBelowIndex=pts.findIndex((pt,index)=>index>0&&finite(pt.vmax,999)<=5.0);
  if(firstBelowIndex<0)return base;
  const firstBelowLead=finite(pts[firstBelowIndex].leadHour,pts[firstBelowIndex].simHour);
  const tailHours=14+10*stableTrackHash01(track,`${salt}|post5`);
  const cutoff=Math.min(horizon,firstBelowLead+tailHours);
  if(cutoff>=finite(pts[pts.length-1].leadHour,pts[pts.length-1].simHour)-1e-6)return base;

  const kept:AetherGuidancePoint[]=[];
  for(let i=0;i<pts.length;i++){
    const pt=pts[i];
    const lead=finite(pt.leadHour,pt.simHour);
    if(lead<=cutoff+1e-6){kept.push({...pt});continue;}
    if(!kept.length)break;
    const prev=kept[kept.length-1];
    const prevLead=finite(prev.leadHour,prev.simHour);
    if(cutoff>prevLead+1e-6){
      const span=Math.max(1e-6,lead-prevLead),t=clamp((cutoff-prevLead)/span,0,1);
      kept.push({
        ...pt,
        lat:prev.lat+(pt.lat-prev.lat)*t,
        lon:prev.lon+(pt.lon-prev.lon)*t,
        vmax:finite(prev.vmax)+(finite(pt.vmax)-finite(prev.vmax))*t,
        pmin:finite(prev.pmin,1010)+(finite(pt.pmin,1010)-finite(prev.pmin,1010))*t,
        speed:Number.isFinite(Number(prev.speed))&&Number.isFinite(Number(pt.speed))?Number(prev.speed)+(Number(pt.speed)-Number(prev.speed))*t:pt.speed,
        leadHour:cutoff,
        simHour:cutoff
      });
    }
    break;
  }
  const safe=kept.length?kept:[pts[0]];
  return {
    ...base,
    track:safe,
    maxVmax:Math.max(...safe.map((pt)=>finite(pt.vmax,0))),
    minPmin:Math.min(...safe.map((pt)=>finite(pt.pmin,1010)))
  } as T;
}

function displaySpecialTracks<T extends TrackLike>(tracks:T[],args:DrawArgs,horizonHours:number,salt="current"):T[]{
  if(args.specialTrackEndMode === "operational") {
    return normalTerminationDisplayTracks(tracks,args,horizonHours);
  }
  return tracks.map((track)=>displayTrackLike(trimTrackToPostFiveWindow(track,horizonHours,salt),args) as T);
}

function projectFactory(rect: Rect, b: ReturnType<typeof boundsForTracks>) {
  return (lat: number, lon: number) => ({
    x: rect.x + (lon-b.minLon)/(b.maxLon-b.minLon)*rect.w,
    y: rect.y + rect.h - (lat-b.minLat)/(b.maxLat-b.minLat)*rect.h
  });
}

function unwrapRing(ring: any[], centerLon: number) {
  const out: Array<[number,number]> = [];
  let prev = centerLon;
  for (const c of ring || []) {
    let lon=finite(c?.[0],NaN), lat=finite(c?.[1],NaN);
    if(!Number.isFinite(lon)||!Number.isFinite(lat)) continue;
    while(lon-prev>180)lon-=360;
    while(lon-prev<-180)lon+=360;
    out.push([lon,lat]); prev=lon;
  }
  return out;
}

function drawBaseMap(ctx: CanvasRenderingContext2D, rect: Rect, b: ReturnType<typeof boundsForTracks>, opts?: { ocean?: string; land?: string; border?: string; grid?: string; labels?: boolean; denseGrid?: boolean }) {
  const ocean=opts?.ocean||"#f8fafc", land=opts?.land||"#eeeeee", border=opts?.border||"#737373", grid=opts?.grid||"rgba(100,116,139,.22)";
  ctx.save();
  ctx.fillStyle=ocean; ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
  const p=projectFactory(rect,b);
  const step=opts?.denseGrid?2:5;
  ctx.strokeStyle=grid;ctx.lineWidth=Math.max(.6,rect.w/1300);ctx.setLineDash(opts?.denseGrid?[2,2]:[3,3]);
  for(let lon=Math.ceil(b.minLon/step)*step;lon<=b.maxLon;lon+=step){const q=p(b.minLat,lon);ctx.beginPath();ctx.moveTo(q.x,rect.y);ctx.lineTo(q.x,rect.y+rect.h);ctx.stroke();}
  for(let lat=Math.ceil(b.minLat/step)*step;lat<=b.maxLat;lat+=step){const q=p(lat,b.minLon);ctx.beginPath();ctx.moveTo(rect.x,q.y);ctx.lineTo(rect.x+rect.w,q.y);ctx.stroke();}
  ctx.setLineDash([]);
  if(productLandGeoJson?.features){
    ctx.fillStyle=land;ctx.strokeStyle=border;ctx.lineWidth=Math.max(.7,rect.w/1700);
    const centerLon=(b.minLon+b.maxLon)/2;
    for(const f of productLandGeoJson.features as any[]){
      const g=f?.geometry;if(!g)continue;
      const polys=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];
      for(const poly of polys){
        ctx.beginPath();
        for(const ring0 of poly){const ring=unwrapRing(ring0,centerLon); if(ring.length<3)continue;ring.forEach((c,i)=>{const q=p(c[1],c[0]);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();}
        try{ctx.fill("evenodd");}catch{ctx.fill();}
        for(const ring0 of poly){const ring=unwrapRing(ring0,centerLon);if(ring.length<3)continue;strokeProductCoastlineRing(ctx, ring, p);}
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle="#1f2937";ctx.lineWidth=Math.max(1,rect.w/900);ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);
  if(opts?.labels!==false){
    ctx.save();ctx.fillStyle="#334155";ctx.font=safeFont(clamp(rect.w/92,8,15));ctx.textAlign="center";
    for(let lon=Math.ceil(b.minLon/5)*5;lon<=b.maxLon;lon+=5){const q=p(b.minLat,lon);ctx.fillText(`${Math.abs(lon)}°${lon>=0?"E":"W"}`,q.x,rect.y+rect.h-4);}
    ctx.textAlign="left";
    for(let lat=Math.ceil(b.minLat/5)*5;lat<=b.maxLat;lat+=5){const q=p(lat,b.minLon);ctx.fillText(`${Math.abs(lat)}°${lat>=0?"N":"S"}`,rect.x+4,q.y-3);}
    ctx.restore();
  }
  return p;
}

function drawTrack(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projectFactory>, track: AetherGuidancePoint[], color: string, width: number, alpha = 1, dash: number[] = []) {
  if(!track || track.length<2)return;
  ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap="round";ctx.lineJoin="round";ctx.setLineDash(dash);
  ctx.beginPath();
  track.forEach((pt,i)=>{const q=project(pt.lat,pt.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();ctx.restore();
}

function drawHistory(ctx: CanvasRenderingContext2D, project: ReturnType<typeof projectFactory>, history: DrawArgs["historicalTrack"], width: number, color="#111827") {
  if(!history || history.length<2)return;
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin="round";ctx.beginPath();history.forEach((pt,i)=>{const q=project(pt.lat,pt.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();ctx.restore();
}

function meanTrack(members: TrackLike[]) {
  const map = new Map<number, {lat:number;lon:number;vmax:number;pmin:number;speed:number;speedN:number;n:number}>();
  for(const m of members){for(const p of m.track||[]){const lead=Math.round(finite(p.leadHour,p.simHour));const slot=map.get(lead)||{lat:0,lon:0,vmax:0,pmin:0,speed:0,speedN:0,n:0};slot.lat+=p.lat;slot.lon+=p.lon;slot.vmax+=finite(p.vmax);slot.pmin+=finite(p.pmin,1008);if(Number.isFinite(Number(p.speed))){slot.speed+=Number(p.speed);slot.speedN++;}slot.n++;map.set(lead,slot);}}
  return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([lead,s])=>({lat:s.lat/s.n,lon:s.lon/s.n,vmax:s.vmax/s.n,pmin:s.pmin/s.n,speed:s.speedN?s.speed/s.speedN:undefined,leadHour:lead,simHour:lead} as AetherGuidancePoint));
}

function approxR34Nm(point: AetherGuidancePoint, activeState: DrawArgs["activeState"]) {
  const kt=jtwcKt(finite(point.vmax), "continuous");
  const startQuad=(activeState as any).r7;
  const startKm=startQuad ? ([startQuad.ne,startQuad.se,startQuad.sw,startQuad.nw].filter((x:number)=>Number.isFinite(x)&&x>0).reduce((a:number,b:number)=>a+b,0)/Math.max(1,[startQuad.ne,startQuad.se,startQuad.sw,startQuad.nw].filter((x:number)=>Number.isFinite(x)&&x>0).length)) : 95;
  const lead=finite(point.leadHour,point.simHour);
  const km=clamp(startKm*.55 + Math.max(0,kt-25)*1.05 + Math.min(45,lead*.16),35,340);
  return km/1.852;
}

function seriesFor(track: AetherGuidancePoint[], args: DrawArgs) {
  return track.map((p)=>{
    const lead=finite(p.leadHour,p.simHour);
    let shear=finite((args.activeState as any).shear,12),sst=29.2,rh=62;
    if(args.config){
      try{const env=getSynopticEnvironmentState(p.lat,p.lon,args.config,args.currentHour+lead);shear=env.shear;sst=env.sst;rh=env.rh700;}catch{}
    }
    return {lead,wind:jtwcKt(finite(p.vmax), "continuous"),pmin:finite(p.pmin,1008),r34:approxR34Nm(p,args.activeState),shear,sst,rh};
  });
}

function drawLinePanel(ctx: CanvasRenderingContext2D, rect: Rect, lines: Array<{label:string;color:string;points:Array<{x:number;y:number}>;width?:number;dash?:number[]}>, opts: { title:string; yLabel?:string; xMin?:number; xMax:number; yMin:number; yMax:number; yTicks?:number[]; shadeBands?:Array<[number,number,string]>; xDate?:boolean; startDate?:Date; currentHour?:number; legend?:boolean; verticalNow?:number; nowColor?:string }) {
  const legendRows = opts.legend ? Math.max(1, Math.ceil(Math.min(lines.length, 8) / 3)) : 0;
  const m={
    l:Math.max(44,rect.w*.125),
    r:Math.max(12,rect.w*.035),
    t:Math.max(22, rect.h * (opts.legend ? 0.13 + legendRows * 0.045 : 0.11)),
    b:Math.max(opts.xDate ? 44 : 26, rect.h * (opts.xDate ? .21 : .14))
  };
  const xMin=Number.isFinite(opts.xMin) ? Number(opts.xMin) : 0;
  const xSpan=Math.max(1e-6,opts.xMax-xMin);
  const plot={x:rect.x+m.l,y:rect.y+m.t,w:rect.w-m.l-m.r,h:rect.h-m.t-m.b};
  ctx.save();ctx.fillStyle="#fff";ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  if(opts.shadeBands){for(const [a,b,c] of opts.shadeBands){const y1=plot.y+plot.h-(a-opts.yMin)/(opts.yMax-opts.yMin)*plot.h;const y2=plot.y+plot.h-(b-opts.yMin)/(opts.yMax-opts.yMin)*plot.h;ctx.fillStyle=c;ctx.fillRect(plot.x,Math.min(y1,y2),plot.w,Math.abs(y2-y1));}}
  ctx.strokeStyle="#d1d5db";ctx.lineWidth=1;ctx.setLineDash([3,3]);
  const yTicks=opts.yTicks||Array.from({length:6},(_,i)=>opts.yMin+(opts.yMax-opts.yMin)*i/5);
  for(const yv of yTicks){const y=plot.y+plot.h-(yv-opts.yMin)/(opts.yMax-opts.yMin)*plot.h;ctx.beginPath();ctx.moveTo(plot.x,y);ctx.lineTo(plot.x+plot.w,y);ctx.stroke();ctx.fillStyle="#334155";ctx.font=safeFont(rect.w/42);ctx.textAlign="right";ctx.fillText(String(Math.round(yv*10)/10),plot.x-5,y+3);}
  const targetTicks = opts.xDate ? Math.max(4, Math.floor(plot.w / 92)) : Math.max(4, Math.floor(plot.w / 80));
  const xStep = xSpan <= 48 ? 12 : xSpan <= 96 ? 24 : Math.max(24, Math.ceil((xSpan / targetTicks) / 12) * 12);
  const xTickStart=Math.ceil(xMin/xStep)*xStep;
  for(let xv=xTickStart;xv<=opts.xMax+1e-6;xv+=xStep){const x=plot.x+(xv-xMin)/xSpan*plot.w;ctx.beginPath();ctx.moveTo(x,plot.y);ctx.lineTo(x,plot.y+plot.h);ctx.stroke();ctx.fillStyle="#334155";ctx.font=safeFont(rect.w/48);ctx.textAlign="center";
    if(opts.xDate&&opts.startDate){const [d,z]=formatDateTick(opts.startDate,opts.currentHour||0,xv).split("\n");ctx.fillText(d,x,plot.y+plot.h+13);ctx.fillText(z,x,plot.y+plot.h+25);} else ctx.fillText(String(xv),x,plot.y+plot.h+14);
  }
  ctx.setLineDash([]);ctx.strokeStyle="#111827";ctx.lineWidth=1;ctx.strokeRect(plot.x,plot.y,plot.w,plot.h);
  ctx.beginPath();ctx.rect(plot.x,plot.y,plot.w,plot.h);ctx.clip();
  for(const line of lines){ctx.strokeStyle=line.color;ctx.lineWidth=line.width||Math.max(1.5,rect.w/260);ctx.setLineDash(line.dash||[]);ctx.beginPath();line.points.forEach((p,i)=>{const x=plot.x+(clamp(p.x,xMin,opts.xMax)-xMin)/xSpan*plot.w;const y=plot.y+plot.h-(clamp(p.y,opts.yMin,opts.yMax)-opts.yMin)/(opts.yMax-opts.yMin)*plot.h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  ctx.setLineDash([]);
  if(Number.isFinite(opts.verticalNow)){const x=plot.x+(clamp(opts.verticalNow!,xMin,opts.xMax)-xMin)/xSpan*plot.w;ctx.strokeStyle=opts.nowColor||"#eab308";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,plot.y);ctx.lineTo(x,plot.y+plot.h);ctx.stroke();}
  ctx.restore();
  ctx.save();
  ctx.fillStyle="#111827";ctx.font=safeFont(rect.w/34,700);ctx.textAlign="right";ctx.fillText(opts.title,rect.x+rect.w-5,rect.y+14);
  if(opts.yLabel){ctx.save();ctx.translate(rect.x+10,rect.y+rect.h/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";ctx.font=safeFont(rect.w/42);ctx.fillText(opts.yLabel,0,0);ctx.restore();}
  if(opts.legend){let x=plot.x+4,y=rect.y+13;ctx.textAlign="left";ctx.font=safeFont(rect.w/46,600);for(const line of lines.slice(0,8)){const width=Math.max(74,line.label.length*7.2+44);if(x+width>rect.x+rect.w-16){x=plot.x+4;y+=14;}ctx.strokeStyle=line.color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y-4);ctx.lineTo(x+18,y-4);ctx.stroke();ctx.fillStyle="#1f2937";ctx.fillText(line.label,x+23,y);x+=width;}}
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, items: Array<{label:string;color:string;dash?:number[]}>, x:number,y:number,w:number,fontSize:number, columns=4) {
  const cellW=w/columns, rowH=fontSize*1.7;
  ctx.save();ctx.textAlign="left";ctx.font=safeFont(fontSize,600);
  items.forEach((it,i)=>{const col=i%columns,row=Math.floor(i/columns),cx=x+col*cellW,cy=y+row*rowH;ctx.strokeStyle=it.color;ctx.lineWidth=Math.max(2,fontSize/4);ctx.setLineDash(it.dash||[]);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+28,cy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#111827";ctx.fillText(it.label,cx+36,cy+fontSize*.35);});ctx.restore();
}

function drawHeader(ctx: CanvasRenderingContext2D, title:string, subtitle:string,w:number,scale:number,rightTitle?:string) {
  ctx.fillStyle="#111827";ctx.textAlign="left";ctx.font=safeFont(22*scale,700);ctx.fillText(title,14*scale,28*scale);
  if(subtitle){ctx.font=safeFont(11*scale,500);ctx.fillStyle="#475569";ctx.fillText(subtitle,14*scale,44*scale);}
  if(rightTitle){ctx.textAlign="right";ctx.fillStyle="#111827";ctx.font=safeFont(18*scale,700);ctx.fillText(rightTitle,w-14*scale,28*scale);}
}

function drawFooter(ctx: CanvasRenderingContext2D,w:number,h:number,scale:number,text="WMC simulated ensemble guidance · visualization style inspired by common meteorological ensemble products"){
  const brand=loadAgencyBranding('ensemble_tracks');
  ctx.save();ctx.fillStyle="#ef233c";ctx.font=safeFont(10*scale,500);ctx.textAlign="left";
  if(brand.footerNote)ctx.fillText(brand.footerNote=== '模拟产品，仅供娱乐' ? brandedEnsembleCaption(text) : brand.footerNote,14*scale,h-10*scale,Math.max(1,w*.70));ctx.textAlign="right";ctx.fillStyle="#94a3b8";ctx.fillText("SIMULATION · NOT OPERATIONAL GUIDANCE",w-14*scale,h-10*scale);ctx.restore();
}

function drawTrackDiagnostics(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1200;
  clear(ctx,w,h,"#fff");
  const centers = displayTracks(args.centers,args);
  ctx.fillStyle="#111";ctx.font=safeFont(13*scale,500);ctx.textAlign="center";ctx.fillText(`${args.stormName.toUpperCase()} -- ${formatIssue(args.startDate,args.currentHour)}`,w*.33,14*scale);
  const mapRect={x:12*scale,y:28*scale,w:775*scale,h:h-38*scale};
  const rightX=850*scale,rightW=w-rightX-10*scale,pH=(h-34*scale)/3;
  const b=boundsForTracks(centers,EMPTY_HISTORY,mapRect,false);const project=drawBaseMap(ctx,mapRect,b,{ocean:"#fff",land:"#eeeeee",border:"#111827",grid:"rgba(100,116,139,.20)"});
  centers.forEach(c=>drawTrack(ctx,project,c.track,c.color||modelColor(c.modelId),Math.max(1.4,3.1*scale),.96,c.modelId==="AIFS"?[9*scale,6*scale]:[]));
  const mean=meanTrack(centers);drawTrack(ctx,project,mean,"#050505",Math.max(2,3.8*scale),.95);
  for(const p of mean){const lead=Math.round(finite(p.leadHour,p.simHour));if(lead%24!==0||lead>120)continue;const q=project(p.lat,p.lon);const speedText=Number.isFinite(Number(p.speed))?` | ${Math.round(Number(p.speed))} km/h`:"";const label=`${lead}h | ${Math.round(jtwcKt(p.vmax, "public"))} kts${speedText}`;ctx.fillStyle="#111";ctx.strokeStyle="#fff";ctx.lineWidth=3*scale;ctx.font=safeFont(11*scale,700);ctx.textAlign="left";ctx.strokeText(label,q.x+5*scale,q.y-4*scale);ctx.fillText(label,q.x+5*scale,q.y-4*scale);}
  const legendItems: Array<{label:string;color:string;dash?:number[]}> = centers.slice(0,7).map(c=>({label:String(c.modelId),color:c.color||modelColor(c.modelId)}));
  legendItems.push({label:"MEAN",color:"#050505"});
  drawLegend(ctx,legendItems,18*scale,46*scale,mapRect.w-20*scale,11*scale,4);
  const series=centers.map(c=>({c,s:seriesFor(c.track,args)}));
  const meanSeries=seriesFor(mean,args);
  const lines=(key:"wind"|"pmin"|"r34") => {
    const out: Array<{label:string;color:string;points:Array<{x:number;y:number}>;width:number}> = series.map(({c,s})=>({label:String(c.modelId),color:c.color||modelColor(c.modelId),points:s.map(p=>({x:p.lead,y:p[key]})),width:2.1*scale}));
    out.push({label:"MEAN",color:"#050505",points:meanSeries.map(p=>({x:p.lead,y:p[key]})),width:3.1*scale});
    return out;
  };
  const windLines = lines("wind");
  const pminLines = lines("pmin");
  const r34Lines = lines("r34");
  drawLinePanel(ctx,{x:rightX,y:27*scale,w:rightW,h:pH-5*scale},windLines,{title:"Max Sustained Wind",yLabel:"JTWC 1-min kt",xMax:lineLeadDomain(windLines),yMin:0,yMax:150,yTicks:[0,15,34,64,83,96,113,137],legend:false});
  drawLinePanel(ctx,{x:rightX,y:27*scale+pH,w:rightW,h:pH-5*scale},pminLines,{title:"MSLP",yLabel:"hPa",xMax:lineLeadDomain(pminLines),yMin:930,yMax:1020,yTicks:[940,960,980,1000,1020],legend:false});
  drawLinePanel(ctx,{x:rightX,y:27*scale+pH*2,w:rightW,h:pH-5*scale},r34Lines,{title:"Mean 34kt Radius",yLabel:"nm",xMax:lineLeadDomain(r34Lines),yMin:0,yMax:320,yTicks:[0,50,100,150,200,250,300],legend:false});
}

function historicalDiagnosticSeries(args:DrawArgs) {
  const hist=(args.historicalTrack||[]).filter((p)=>Number.isFinite(p.simHour) && finite(p.simHour) >= args.currentHour-72 && finite(p.simHour) <= args.currentHour);
  const sampled=hist.filter((p,i)=>i===0 || i===hist.length-1 || Math.abs((finite(p.simHour)-args.currentHour)%3)<0.05);
  return sampled.map((p)=>{
    const x=finite(p.simHour)-args.currentHour;
    let shear=finite((p as any).shear,finite((args.activeState as any).shear,12));
    let sst=finite((p as any).sst,29.2);
    let rh=finite((p as any).rh700,finite((p as any).humidity,62));
    if(args.config){try{const env=getSynopticEnvironmentState(p.lat,p.lon,args.config,finite(p.simHour));shear=env.shear;sst=env.sst;rh=env.rh700;}catch{}}
    return {x,wind:jtwcKt(finite(p.vmax), "continuous"),shear,sst,rh};
  });
}

function drawDiagnosticMatrix(args:DrawArgs,ctx:CanvasRenderingContext2D,threeModel=false){
  const {width:w,height:h}=args,scale=w/900;clear(ctx,w,h,"#fff");
  drawHeader(ctx,"Multi-Model Diagnostic Comparison",`INIT ${formatIssue(args.startDate,args.currentHour)}`,w,scale,`${args.stormName.toUpperCase()} · ${ensembleAgencyCode()}`);
  const leftX=52*scale,leftW=390*scale,rightX=503*scale,rightW=385*scale,top=28*scale;
  const intensityRect={x:leftX,y:top,w:leftW,h:190*scale};
  const trackRect={x:leftX,y:top+210*scale,w:leftW,h:h-top-225*scale};
  const rh=(h-top-20*scale)/3;
  const rightRects=[0,1,2].map(i=>({x:rightX,y:top+i*rh,w:rightW,h:rh-7*scale}));
  const wanted=threeModel?["GEFS","ECMWF","AIFS"]:["ECMWF","AIFS"];
  let selected=displayTracks(args.centers.filter(c=>wanted.includes(c.modelId)),args);
  if(selected.length<(threeModel?3:2))selected=displayTracks(args.centers.slice(0,threeModel?3:2),args);
  const historyDiag=historicalDiagnosticSeries(args);
  const historyLine=historyDiag.map((p)=>({x:p.x,y:p.wind}));
  const futureLines: Array<{label:string;color:string;points:Array<{x:number;y:number}>;width:number}> = selected.map(c=>({label:String(c.modelId),color:c.color||modelColor(c.modelId),points:seriesFor(c.track,args).map(p=>({x:p.lead,y:p.wind})),width:2.2*scale}));
  if(historyLine.length>1)futureLines.unshift({label:"BEST",color:"#111827",points:historyLine,width:2.6*scale});
  const shade=[[34,64,"#d4d4d4"],[83,96,"#d4d4d4"],[113,137,"#d4d4d4"]] as Array<[number,number,string]>;
  drawLinePanel(ctx,intensityRect,futureLines,{title:"Intensity",yLabel:"JTWC 1-min Wind (kt)",xMin:-72,xMax:Math.max(72, lineLeadDomain(futureLines, 96)),yMin:10,yMax:160,yTicks:[20,40,60,80,100,120,140,160],shadeBands:shade,xDate:true,startDate:args.startDate,currentHour:args.currentHour,legend:true,verticalNow:0,nowColor:"#eab308"});
  const b=boundsForTracks(selected,EMPTY_HISTORY,trackRect,false);const p=drawBaseMap(ctx,trackRect,b,{ocean:"#fff",land:"#d8d8d8",border:"#aaa",grid:"rgba(120,120,120,.15)"});selected.forEach(c=>{drawTrack(ctx,p,c.track,c.color||modelColor(c.modelId),2*scale,.9);for(const pt of c.track){const lead=Math.round(finite(pt.leadHour,pt.simHour));if(lead%12!==0)continue;const q=p(pt.lat,pt.lon);ctx.beginPath();ctx.fillStyle=lead%24===0?"#111827":"#fff";ctx.strokeStyle=c.color||modelColor(c.modelId);ctx.lineWidth=1.1*scale;ctx.arc(q.x,q.y,2.8*scale,0,Math.PI*2);ctx.fill();ctx.stroke();}});
  ctx.fillStyle="#111827";ctx.font=safeFont(11*scale,700);ctx.textAlign="right";ctx.fillText("Track",trackRect.x+trackRect.w-5*scale,trackRect.y+14*scale);
  const diag=selected.map(c=>({c,s:seriesFor(c.track,args)}));
  const mk=(key:"shear"|"sst"|"rh")=>{
    const lines=diag.map(({c,s})=>({label:String(c.modelId),color:c.color||modelColor(c.modelId),points:s.map(v=>({x:v.lead,y:v[key]})),width:2.1*scale}));
    if(historyDiag.length>1) lines.unshift({label:"ANALYSIS",color:"#dc2626",points:historyDiag.map(v=>({x:v.x,y:v[key]})),width:2.15*scale});
    return lines;
  };
  const commonTime={xMin:-72,xDate:true,startDate:args.startDate,currentHour:args.currentHour,legend:true,verticalNow:0,nowColor:"#eab308"} as const;
  const shearLines=mk("shear"), sstLines=mk("sst"), rhLines=mk("rh");
  drawLinePanel(ctx,rightRects[0],shearLines,{...commonTime,xMax:Math.max(72,lineLeadDomain(shearLines,96)),title:"Deep-Layer Shear",yLabel:"200–850 hPa Shear (kt)",yMin:0,yMax:45,yTicks:[0,10,20,30,40],shadeBands:[[10,20,"#d4d4d4"],[30,45,"#d4d4d4"]]});
  drawLinePanel(ctx,rightRects[1],sstLines,{...commonTime,xMax:Math.max(72,lineLeadDomain(sstLines,96)),title:"SST",yLabel:"Sea Surface Temp (°C)",yMin:22,yMax:32,yTicks:[22,24,26,28,30,32],shadeBands:[[24,26,"#d4d4d4"],[28,30,"#d4d4d4"]]});
  drawLinePanel(ctx,rightRects[2],rhLines,{...commonTime,xMax:Math.max(72,lineLeadDomain(rhLines,96)),title:"Mid-Level RH",yLabel:"700–500 hPa Humidity (%)",yMin:20,yMax:100,yTicks:[20,40,60,80,100],shadeBands:[[40,60,"#d4d4d4"],[80,100,"#d4d4d4"]]});
  drawFooter(ctx,w,h,scale,"WMC simulated diagnostic comparison · environment panels are derived from the simulator's synthetic fields");
}

function drawDeterministicOverview(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1400;clear(ctx,w,h,"#f7fbfd");
  const centers = displayTracks(args.centers,args);
  const mapRect={x:15*scale,y:15*scale,w:w-30*scale,h:h-82*scale};const b=boundsForTracks(centers,EMPTY_HISTORY,mapRect,true);const p=drawBaseMap(ctx,mapRect,b,{ocean:"#eef9fd",land:"#f6f1e8",border:"#7b858f",grid:"rgba(80,100,120,.24)",denseGrid:true});
  ctx.save();ctx.fillStyle="rgba(255,255,255,.84)";ctx.fillRect(w*.25,18*scale,w*.50,54*scale);ctx.fillStyle="#111827";ctx.font=safeFont(25*scale,700);ctx.textAlign="center";ctx.fillText("Multi-Model Tropical Cyclone Track Forecast Overview",w/2,43*scale);ctx.font=safeFont(20*scale,700);ctx.fillText(`Init Time: ${formatIssue(args.startDate,args.currentHour)}`,w/2,66*scale);ctx.restore();
  centers.forEach((c,idx)=>{const color=c.color||modelColor(c.modelId);drawTrack(ctx,p,c.track,color,Math.max(1.4,2.3*scale),.96);for(const pt of c.track){const lead=Math.round(finite(pt.leadHour,pt.simHour));if(lead%24!==0)continue;const q=p(pt.lat,pt.lon);ctx.fillStyle=color;ctx.fillRect(q.x-3*scale,q.y-3*scale,6*scale,6*scale);ctx.font=safeFont(9*scale,600);ctx.textAlign="left";ctx.fillText(String(lead),q.x+4*scale,q.y+(idx%3-1)*8*scale);}});
  const legendY=h-55*scale;ctx.fillStyle="#fff";ctx.fillRect(0,legendY-8*scale,w,63*scale);ctx.fillStyle="#111";ctx.font=safeFont(11*scale,700);ctx.textAlign="left";ctx.fillText("Model:",28*scale,legendY+8*scale);drawLegend(ctx,AETHER_MODEL_SPECS.map(spec=>({label:spec.label,color:spec.color})),85*scale,legendY+5*scale,w-120*scale,10*scale,8);ctx.fillStyle="#444";ctx.font=safeFont(9*scale);ctx.fillText(brandedEnsembleCaption("NOTES: Forecast-hour labels are referenced to the init time; guidance families are WMC synthetic model families."),28*scale,h-10*scale);
}

function memberSubset(args:DrawArgs,max=2000){
  const members=args.members.filter(m=>!m.control);
  if(members.length<=max)return members;
  const stride=Math.ceil(members.length/max);return members.filter((_,i)=>i%stride===0);
}

function drawMemberRanked(args:DrawArgs,ctx:CanvasRenderingContext2D,withMean:boolean){
  const {width:w,height:h}=args,scale=w/(withMean?1280:1240);clear(ctx,w,h,"#fff");
  const sideW=withMean?220*scale:190*scale;const mapRect={x:55*scale,y:58*scale,w:w-sideW-72*scale,h:h-105*scale};const members=displayTracks(memberSubset(args,2400),args);const b=boundsForTracks(members,EMPTY_HISTORY,mapRect,true);const p=drawBaseMap(ctx,mapRect,b,{ocean:"#fff",land:"#ededed",border:"#8a8a8a",grid:"rgba(80,90,100,.16)"});
  ctx.fillStyle="#111827";ctx.textAlign="left";ctx.font=safeFont(22*scale,400);ctx.fillText(`${ensembleAgencyCode()} ${withMean?"Ensemble Forecast":"Member Forecast"} [${args.stormName.toUpperCase()}] Tropical Cyclone Track`,55*scale,28*scale);ctx.font=safeFont(13*scale);ctx.fillText(`Initial time: ${formatIssue(args.startDate,args.currentHour)}`,55*scale,48*scale);
  members.forEach(m=>drawTrack(ctx,p,m.track,windCategoryColor(m.maxVmax||Math.max(...m.track.map(q=>q.vmax))),Math.max(.65,1.05*scale),.88));
  if(withMean){const mean=meanTrack(members);drawTrack(ctx,p,mean,"#050505",Math.max(3,5*scale),1);for(const pt of mean){const lead=Math.round(finite(pt.leadHour,pt.simHour));if(lead<=0||lead%24!==0)continue;const q=p(pt.lat,pt.lon);ctx.fillStyle="#050505";ctx.beginPath();ctx.arc(q.x,q.y,4.5*scale,0,Math.PI*2);ctx.fill();ctx.font=safeFont(14*scale,700);ctx.fillText(`+${lead}h`,q.x+7*scale,q.y-4*scale);}}
  const lgX=mapRect.x+mapRect.w-150*scale,lgY=70*scale;ctx.fillStyle="rgba(255,255,255,.94)";ctx.strokeStyle="#cbd5e1";ctx.fillRect(lgX,lgY,145*scale,150*scale);ctx.strokeRect(lgX,lgY,145*scale,150*scale);const cats:Array<[string,ReturnType<typeof getJtwcSshwsAssessment>["category"]]> =[["Category 5","C5"],["Category 4","C4"],["Category 3","C3"],["Category 2","C2"],["Category 1","C1"],["Tropical Storm","TS"],["Depression","TD"],["Disturbance","DISTURBANCE"]];ctx.font=safeFont(9*scale);ctx.textAlign="left";cats.forEach((c,i)=>{ctx.fillStyle=sshwsColor(c[1]);ctx.fillRect(lgX+8*scale,lgY+(12+i*16)*scale,22*scale,8*scale);ctx.fillStyle="#111";ctx.fillText(String(c[0]),lgX+38*scale,lgY+(20+i*16)*scale);});
  const maxRows=Math.max(24,Math.floor((h-120*scale)/(13.8*scale)));const sorted=[...members].sort((a,b)=>(a.memberNumber||0)-(b.memberNumber||0)).slice(0,maxRows);const sx=mapRect.x+mapRect.w+12*scale;ctx.textAlign="left";ctx.font=safeFont(10*scale,500);sorted.forEach((m,i)=>{ctx.fillStyle=windCategoryColor(m.maxVmax||0);ctx.fillText(`Member${m.memberNumber||i+1}: ${Math.round(jtwcKt(m.maxVmax||0, "public"))}kt`,sx,70*scale+i*13.5*scale);});
  if(withMean){const mean=meanTrack(members);const minP=Math.min(...mean.map(p=>p.pmin));ctx.fillStyle="#e11d48";ctx.font=safeFont(10*scale);ctx.fillText(`Ens Mean min MSLP ${Math.round(minP)} hPa`,sx,h-52*scale);}
  drawFooter(ctx,w,h,scale,"WMC synthetic member ensemble · member colours represent each member's peak simulated intensity");
}

function drawPressureLegend(ctx:CanvasRenderingContext2D,x:number,y:number,scale:number){ctx.save();ctx.font=safeFont(11*scale);ctx.textAlign="left";pressureBins.forEach((item,i)=>{ctx.strokeStyle=item[1];ctx.lineWidth=2*scale;ctx.beginPath();ctx.arc(x,y+i*23*scale,5*scale,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#1f2937";ctx.fillText(item[0],x+16*scale,y+4*scale+i*23*scale);});ctx.restore();}

function drawPressureSpaghetti(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1500;
  const horizon=Math.max(24,Math.min(168,finite(args.forecastHorizonHours,168)));
  clear(ctx,w,h,"#ffffff");
  const sourceTracks=memberSubset(args,1800);
  // The reference WeatherNext plate is a 64-member operational-style product. Respect a
  // smaller requested population, but cap this presentation at 64 so the member table remains legible.
  const members=displaySpecialTracks(sourceTracks.length?sourceTracks:args.centers,args,horizon,"pressure-current").slice(0,64);
  const rangeSource=args.members.length?args.members:args.centers;
  const allRangeTracks=displaySpecialTracks(rangeSource,args,horizon,"pressure-current");
  const operationalRangeTracks=normalTerminationDisplayTracks(rangeSource,args,horizon);
  const tableW=350*scale;
  const mapRect={x:48*scale,y:58*scale,w:w-tableW-62*scale,h:h-92*scale};
  // Use the actual normally terminated ensemble for default framing so every required path stays
  // visible. Reduced padding/minimum spans make the product noticeably less empty than before.
  const b=args.specialMapRangeMode==="all"?boundsForTracks(allRangeTracks,EMPTY_HISTORY,mapRect,true):boundsForTracks(operationalRangeTracks,EMPTY_HISTORY,mapRect,false);
  const p=drawBaseMap(ctx,mapRect,b,{ocean:"#fbfdff",land:"#eeeeee",border:"#8b8b8b",grid:"rgba(90,90,90,.08)",labels:true});
  ctx.fillStyle="#171717";ctx.font=safeFont(25*scale,400);ctx.textAlign="left";
  ctx.fillText(`WeatherNext 3 Cyclones Track Ensemble - ${args.stormName.toUpperCase()} [${members.length} members] @${ensembleAgencyCode()}`,48*scale,28*scale);
  ctx.font=safeFont(17*scale,400);ctx.fillText(`${formatIssue(args.startDate,args.currentHour)}`,48*scale,51*scale);

  ctx.save();ctx.beginPath();ctx.rect(mapRect.x,mapRect.y,mapRect.w,mapRect.h);ctx.clip();
  members.forEach((m,mi)=>{
    ctx.strokeStyle="rgba(55,55,55,.48)";ctx.lineWidth=.85*scale;ctx.beginPath();
    m.track.forEach((pt,i)=>{const q=p(pt.lat,pt.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();
    const stride=members.length>48?2:1;
    for(let i=0;i<m.track.length;i+=stride){const pt=m.track[i],q=p(pt.lat,pt.lon);const col=pressureColor(pt.pmin);ctx.beginPath();ctx.arc(q.x,q.y,4.1*scale,0,Math.PI*2);ctx.lineWidth=1.25*scale;ctx.strokeStyle=col;
      // Reference alternates open intermediate nodes with filled synoptic nodes.
      if(i%4===0){ctx.fillStyle=col;ctx.fill();}else ctx.stroke();
    }
  });
  if(args.specialShowMainPath!==false&&members.length){const mean=meanTrack(members);drawTrack(ctx,p,mean,"#444",2.5*scale,.85);}
  ctx.restore();
  drawPressureLegend(ctx,66*scale,78*scale,scale);

  // Right-side two-column member diagnostics: minimum SLP and ACE, matching the supplied plate.
  const tx=mapRect.x+mapRect.w+15*scale, colW=(tableW-22*scale)/2, rowH=28*scale;
  const rows=Math.ceil(members.length/2);
  for(let c=0;c<2;c++){
    const x=tx+c*colW;ctx.fillStyle="#444";ctx.font=safeFont(12*scale,700);ctx.textAlign="left";ctx.fillText("Member",x,42*scale);ctx.fillStyle="#666";ctx.font=safeFont(10*scale,400);ctx.fillText("min SLP",x+54*scale,42*scale);ctx.fillText("ACE",x+119*scale,42*scale);
    ctx.strokeStyle="#bdbdbd";ctx.lineWidth=.8*scale;ctx.beginPath();ctx.moveTo(x,48*scale);ctx.lineTo(x+colW-8*scale,48*scale);ctx.stroke();
    for(let r=0;r<rows;r++){const idx=c*rows+r;if(idx>=members.length)break;const m=members[idx];const minP=Math.min(...m.track.map(pt=>finite(pt.pmin,1010)));const ace=aceFor(m.track);const y=68*scale+r*rowH;
      ctx.font=safeFont(10.5*scale,400);ctx.fillStyle=pressureColor(minP);ctx.fillText(`M${String(idx+1).padStart(2,"0")}`,x,y);ctx.fillText(`${minP.toFixed(1)}hPa`,x+45*scale,y);ctx.fillStyle="#4056a1";ctx.fillText(ace.toFixed(1),x+119*scale,y);
    }
  }
  ctx.fillStyle="#888";ctx.font=safeFont(9*scale,400);ctx.textAlign="right";ctx.fillText(`No. AE(${args.startDate.getUTCFullYear()})${String(Math.round(args.currentHour)).padStart(4,"0")}`,mapRect.x+mapRect.w-8*scale,mapRect.y+mapRect.h-8*scale);
  ctx.fillStyle="#ef1b1b";ctx.font=safeFont(15*scale,400);ctx.textAlign="left";ctx.fillText("Clustering is automated and may not reflect actual cyclone development.",48*scale,h-9*scale);
}

function hash01(s:string){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return(h>>>0)/4294967295;}
function previousCycleTrack(m:AetherGuidanceMember){const a=hash01(`${m.id}|a`)-.5,b=hash01(`${m.id}|b`)-.5;return m.track.map(pt=>{const lead=finite(pt.leadHour,pt.simHour),g=clamp(lead/96,0,1);return {...pt,lat:pt.lat+(a*.9-.18)*g,lon:pt.lon+(b*1.25-.25)*g,pmin:pt.pmin+2.2+(a-b)*3.2,vmax:Math.max(0,pt.vmax-(1.3+(a+.5)*1.4))};});}
function aceFor(track:AetherGuidancePoint[]){let ace=0;for(let i=0;i<track.length;i+=2){const kt=jtwcKt(finite(track[i].vmax), "public");if(kt>=34)ace+=kt*kt*1e-4;}return ace;}

function drawPairedCycle(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1500;
  clear(ctx,w,h,"#fff");

  // Dual-cycle products now honor the exact model selection and requested member population.
  // Do not slice the first 50 entries: buildAetherEnsembleMembers groups output by model, so that
  // old shortcut silently discarded every selected model after the first one and made member-count
  // choices above 50 visually meaningless.
  const selected=new Set((args.selectedModelIds||[]).filter(Boolean));
  const selectedMembers=args.members.filter(m=>selected.size===0||selected.has(String(m.modelId)));
  const selectedCenters=args.centers.filter(m=>selected.size===0||selected.has(String(m.modelId)));
  const horizon=Math.max(24,Math.min(168,finite(args.forecastHorizonHours,168)));
  const rawCurrent=displayTracksWithinHorizon(selectedMembers.length?selectedMembers:selectedCenters,args,horizon);
  const rawPaired=rawCurrent.map(m=>displayTrackLike(trimTrackToHorizon({...m,track:previousCycleTrack(m as AetherGuidanceMember)},horizon),args));
  const current=displaySpecialTracks(rawCurrent,args,horizon,"dual-current");
  const paired=displaySpecialTracks(rawPaired,args,horizon,"dual-previous");
  const mapRect={x:48*scale,y:58*scale,w:w-395*scale,h:h-92*scale};
  // Default framing follows the ordinary stop-numbering path. "Show all" instead expands the
  // viewport to every actually displayed current/previous member tail after the 14–24 h cutoff.
  const operationalFramingSource=normalTerminationDisplayTracks(rawCurrent,args,horizon);
  const b=args.specialMapRangeMode==="all"
    ? boundsForTracks([...current,...paired],EMPTY_HISTORY,mapRect,true)
    : boundsForTracks(operationalFramingSource,EMPTY_HISTORY,mapRect,false);
  const p=drawBaseMap(ctx,mapRect,b,{ocean:"#fff",land:"#f0f1f2",border:"#858585",grid:"rgba(90,90,90,.08)"});

  const modelCounts=new Map<string,number>();
  current.forEach(m=>modelCounts.set(String(m.modelId||"MODEL"),(modelCounts.get(String(m.modelId||"MODEL"))||0)+1));
  const modelSummary=[...modelCounts.entries()].map(([id,n])=>`${id}:${n}`).join("  ");
  ctx.fillStyle="#111827";ctx.font=safeFont(27*scale,400);ctx.textAlign="left";
  ctx.fillText(`${ensembleAgencyCode()} Dual-Cycle Ensemble · ${args.stormName.toUpperCase()} [${current.length} + ${paired.length}]`,48*scale,30*scale);
  ctx.font=safeFont(15*scale);ctx.fillStyle="#475569";
  ctx.fillText(`${formatIssue(args.startDate,args.currentHour)} · +${Math.round(horizon)}h · ${modelSummary||"selected centres"}`,48*scale,52*scale);
  drawPressureLegend(ctx,84*scale,80*scale,scale);

  // Render every requested member path. Only pressure-node density is thinned at very large member
  // counts; the path population itself is never truncated, so 10/50/200/500-member choices really
  // produce different ensemble populations in the exported dual-cycle figure.
  const lineAlpha=current.length>2400?.075:current.length>1200?.10:current.length>600?.15:current.length>240?.22:current.length>100?.30:.48;
  const lineWidth=Math.max(.36,(current.length>1000?.48:current.length>300?.62:.78)*scale);
  const temporalNodeStride=current.length>1500?8:current.length>700?6:current.length>260?4:current.length>90?3:2;
  const memberNodeStride=current.length>1800?5:current.length>900?3:current.length>450?2:1;
  ctx.save();ctx.beginPath();ctx.rect(mapRect.x,mapRect.y,mapRect.w,mapRect.h);ctx.clip();
  current.forEach((m,idx)=>{
    const prev=paired[idx];
    ctx.save();
    ctx.globalAlpha=Math.min(.72,lineAlpha*.86);
    ctx.strokeStyle="#374151";ctx.lineWidth=lineWidth*.92;ctx.setLineDash([4*scale,3*scale]);ctx.beginPath();
    prev.track.forEach((pt,i)=>{const q=p(pt.lat,pt.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();
    ctx.setLineDash([]);ctx.globalAlpha=Math.min(.82,lineAlpha*1.12);ctx.strokeStyle="#111827";ctx.lineWidth=lineWidth;ctx.beginPath();
    m.track.forEach((pt,i)=>{const q=p(pt.lat,pt.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.stroke();
    ctx.globalAlpha=1;
    if(idx%memberNodeStride===0){
      for(let j=0;j<m.track.length;j+=temporalNodeStride){
        const q=p(m.track[j].lat,m.track[j].lon);ctx.fillStyle=pressureColor(m.track[j].pmin);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(1.25,2.7*scale),0,Math.PI*2);ctx.fill();
        const prevPt=prev.track[Math.min(j,prev.track.length-1)];if(!prevPt)continue;const qp=p(prevPt.lat,prevPt.lon);ctx.strokeStyle=pressureColor(prevPt.pmin);ctx.lineWidth=Math.max(.75,1.0*scale);ctx.beginPath();ctx.arc(qp.x,qp.y,Math.max(1.35,2.85*scale),0,Math.PI*2);ctx.stroke();
      }
    }
    ctx.restore();
  });

  if (args.specialShowMainPath !== false) {
    const currMean=meanTrack(current),prevMean=meanTrack(paired);
    drawTrack(ctx,p,currMean,"#176b2f",2.8*scale,1);
    drawTrack(ctx,p,prevMean,"#5120a0",2.8*scale,1,[7*scale,4*scale]);
  }
  ctx.restore();

  const sx=mapRect.x+mapRect.w+20*scale;
  ctx.textAlign="left";ctx.font=safeFont(10*scale,500);
  const currentMin=current.length?Math.round(Math.min(...current.map(m=>m.minPmin||9999))):NaN;
  const pairedMin=paired.length?Math.round(Math.min(...paired.map(m=>Math.min(...m.track.map(p=>p.pmin))))):NaN;
  ctx.fillStyle="#176b2f";ctx.fillText(`Current n=${current.length} · ${Number.isFinite(currentMin)?currentMin:"--"} hPa`,sx,82*scale);
  ctx.fillStyle="#5120a0";ctx.fillText(`Previous n=${paired.length} · ${Number.isFinite(pairedMin)?pairedMin:"--"} hPa`,sx,100*scale);
  ctx.font=safeFont(8.7*scale,500);ctx.fillStyle="#64748b";
  ctx.fillText(`Models: ${[...modelCounts.keys()].join(", ")||"--"}`,sx,116*scale);
  ctx.font=safeFont(9.2*scale,500);ctx.fillStyle="#e11d48";ctx.fillText("CURRENT",sx,137*scale);ctx.fillStyle="#64748b";ctx.fillText("min SLP / ACE",sx+62*scale,137*scale);ctx.fillStyle="#2563eb";ctx.fillText("PREVIOUS",sx+170*scale,137*scale);ctx.fillStyle="#64748b";ctx.fillText("min SLP / ACE",sx+231*scale,137*scale);

  // Round-robin rows across the selected models so the side table is not monopolized by whichever
  // model happens to be first in the generation order.
  const pairedRows=Math.max(16,Math.min(46,Math.floor((h-178*scale)/(15.5*scale))));
  const groups=new Map<string,AetherGuidanceMember[]>();
  current.forEach(m=>{const key=String(m.modelId||"MODEL");const group=groups.get(key)||[];group.push(m);groups.set(key,group);});
  const rowTracks:AetherGuidanceMember[]=[];const keys=[...groups.keys()];let rowIndex=0;
  while(rowTracks.length<pairedRows&&keys.length){
    let added=false;
    for(const key of keys){const item=groups.get(key)?.[rowIndex];if(item){rowTracks.push(item);added=true;if(rowTracks.length>=pairedRows)break;}}
    if(!added)break;rowIndex++;
  }
  rowTracks.forEach((m,i)=>{
    const currentIndex=current.indexOf(m);const prev=paired[Math.max(0,currentIndex)];if(!prev)return;
    const y=(155+i*15.5)*scale;const model=String(m.modelId||"M");const member=Number(m.memberNumber||0);const tag=`${model}-${member===0?"C":member}`;
    ctx.fillStyle="#e11d48";ctx.fillText(tag,sx,y);ctx.fillStyle="#334155";ctx.fillText(`${Math.round(m.minPmin||Math.min(...m.track.map(p=>p.pmin)))} / ${aceFor(m.track).toFixed(1)}`,sx+74*scale,y);
    ctx.fillStyle="#2563eb";ctx.fillText(tag,sx+170*scale,y);ctx.fillStyle="#334155";ctx.fillText(`${Math.round(Math.min(...prev.track.map(p=>p.pmin)))} / ${aceFor(prev.track).toFixed(1)}`,sx+244*scale,y);
  });
  drawFooter(ctx,w,h,scale,`WMC dual-cycle comparison · total lead +${Math.round(horizon)}h · ${args.specialTrackEndMode==="operational"?"tracks stop at first <15 m/s":"members end 14–24 h after first ≤5 m/s"} · current solid / synthetic previous dashed · map range: ${args.specialMapRangeMode==="all"?"all displayed tracks":"normal <15 m/s tracks"}`);
}

function drawCategoryWindBands(ctx:CanvasRenderingContext2D, _rect:Rect, plot:{x:number;y:number;w:number;h:number}, yMin:number, yMax:number, scale:number){
  const palette:Record<string,[string,string]>={
    TD:["#a7d8f0","#5aa6cf"], TS:["#97d68c","#37a83b"], C1:["#efd2b4","#de8f4e"],
    C2:["#e7c39b","#d3692b"], C3:["#e7a7ab","#cf4545"], C4:["#e2b4e8","#a84bcc"], C5:["#c7b5e5","#7d67d6"]
  };
  const bands:[number,number,string,string,string][] = JTWC_SSHWS_BANDS
    .filter((band)=>band.category!=="DISTURBANCE")
    .map((band)=>{
      const [fill,text]=palette[band.category]||["#dbeafe","#475569"];
      return [band.minKt,Number.isFinite(band.maxKt)?band.maxKt:yMax,fill,band.label,text];
    });
  ctx.save();
  bands.forEach(([a,b,color,label,textColor])=>{
    const y1=plot.y+plot.h-(Math.min(yMax,b)-yMin)/(yMax-yMin)*plot.h;
    const y2=plot.y+plot.h-(Math.max(yMin,a)-yMin)/(yMax-yMin)*plot.h;
    if(y2<=plot.y||y1>=plot.y+plot.h||y2<=y1)return;
    ctx.fillStyle=color;
    ctx.globalAlpha=.72;
    ctx.fillRect(plot.x,Math.max(plot.y,y1),plot.w,Math.min(plot.y+plot.h,y2)-Math.max(plot.y,y1));
    ctx.globalAlpha=1;
    ctx.fillStyle=textColor;
    ctx.font=safeFont(11*scale,700);
    ctx.textAlign="left";
    ctx.fillText(label,plot.x+10*scale,Math.max(plot.y+12*scale,Math.min(plot.y+plot.h-4*scale,(y1+y2)/2+4*scale)));
  });
  ctx.restore();
}

function interpolateTrackValue(track:AetherGuidancePoint[], lead:number, key:"vmax"|"pmin"){
  if(!track.length) return key==="pmin"?1008:0;
  if(lead<=finite(track[0].leadHour,track[0].simHour)) return finite((track[0] as any)[key], key==="pmin"?1008:0);
  for(let i=1;i<track.length;i++){
    const a=track[i-1], b=track[i];
    const la=finite(a.leadHour,a.simHour), lb=finite(b.leadHour,b.simHour);
    if(lead<=lb){
      const t=(lead-la)/Math.max(1e-6,lb-la);
      return finite((a as any)[key],0)*(1-t)+finite((b as any)[key],0)*t;
    }
  }
  const last=track[track.length-1];
  return finite((last as any)[key], key==="pmin"?1008:0);
}

function percentile(sorted:number[], p:number){
  if(!sorted.length) return 0;
  const idx=(sorted.length-1)*p;
  const lo=Math.floor(idx), hi=Math.ceil(idx);
  if(lo===hi) return sorted[lo];
  const t=idx-lo;
  return sorted[lo]*(1-t)+sorted[hi]*t;
}

function drawModelIntensityGuidance(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1280;
  clear(ctx,w,h,"#f7f8fb");
  const rect={x:46*scale,y:72*scale,w:w-92*scale,h:h-116*scale};
  const lines=displayTracks(args.centers,args);
  const xMax=Math.max(168,...lines.map(line=>Math.max(...line.track.map(p=>finite(p.leadHour,p.simHour)),0)));
  const yMin=20,yMax=150;
  const m={l:74*scale,r:110*scale,t:34*scale,b:48*scale};
  const plot={x:rect.x+m.l,y:rect.y+m.t,w:rect.w-m.l-m.r,h:rect.h-m.t-m.b};
  ctx.fillStyle="#ffffff";ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  drawCategoryWindBands(ctx,rect,plot,yMin,yMax,scale);
  ctx.strokeStyle="#d1d5db";ctx.lineWidth=1;ctx.setLineDash([3*scale,3*scale]);
  const yTicks=[20,40,60,80,100,120,140];
  yTicks.forEach(v=>{const y=plot.y+plot.h-(v-yMin)/(yMax-yMin)*plot.h;ctx.beginPath();ctx.moveTo(plot.x,y);ctx.lineTo(plot.x+plot.w,y);ctx.stroke();ctx.fillStyle="#334155";ctx.font=safeFont(13*scale,500);ctx.textAlign="right";ctx.fillText(String(v),plot.x-10*scale,y+4*scale);});
  for(let lead=0;lead<=xMax+1e-6;lead+=24){const x=plot.x+lead/xMax*plot.w;ctx.beginPath();ctx.moveTo(x,plot.y);ctx.lineTo(x,plot.y+plot.h);ctx.stroke();ctx.textAlign="center";ctx.fillStyle="#334155";ctx.font=safeFont(12*scale,500);ctx.fillText(String(lead),x,plot.y+plot.h+18*scale);}
  ctx.setLineDash([]);ctx.strokeStyle="#111827";ctx.lineWidth=1.2*scale;ctx.strokeRect(plot.x,plot.y,plot.w,plot.h);
  lines.forEach((line,idx)=>{
    ctx.save();ctx.strokeStyle=line.color||modelColor(line.modelId);ctx.lineWidth=Math.max(2,2.7*scale);ctx.beginPath();
    line.track.forEach((pt,i)=>{const lead=finite(pt.leadHour,pt.simHour);const kt=jtwcKt(finite(pt.vmax), "continuous");const x=plot.x+lead/xMax*plot.w;const y=plot.y+plot.h-(clamp(kt,yMin,yMax)-yMin)/(yMax-yMin)*plot.h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
    const last=line.track[line.track.length-1]; if(last){const lead=finite(last.leadHour,last.simHour),kt=jtwcKt(finite(last.vmax), "continuous"); const x=plot.x+Math.min(lead,xMax)/xMax*plot.w, y=plot.y+plot.h-(clamp(kt,yMin,yMax)-yMin)/(yMax-yMin)*plot.h; ctx.fillStyle=line.color||modelColor(line.modelId); ctx.font=safeFont(11*scale,700); ctx.textAlign="left"; ctx.fillText(line.modelId, Math.min(rect.x+rect.w-64*scale, x+8*scale), y + ((idx%2===0)?-2:10)*scale);} 
    ctx.restore();
  });
  drawHeader(ctx,`Model Forecast Intensity for ${args.stormName.toUpperCase()}`,`Initialized ${formatIssue(args.startDate,args.currentHour)} · synthetic multi-model guidance`,w,scale,"");
  ctx.save();ctx.fillStyle="#334155";ctx.font=safeFont(13*scale,600);ctx.textAlign="center";ctx.fillText("Forecast Hour",plot.x+plot.w/2,h-20*scale);ctx.save();ctx.translate(18*scale,plot.y+plot.h/2);ctx.rotate(-Math.PI/2);ctx.fillText("JTWC 1-min Wind (kt)",0,0);ctx.restore();ctx.restore();
  drawFooter(ctx,w,h,scale,"WMC synthetic model intensity guidance · background categories emulate operational intensity-guidance charts");
}

function drawEnsembleIntensityForecast(args:DrawArgs,ctx:CanvasRenderingContext2D){
  const {width:w,height:h}=args,scale=w/1600;
  clear(ctx,w,h,"#f5f5f5");
  const rect={x:32*scale,y:68*scale,w:w-64*scale,h:h-116*scale};
  const plot={x:rect.x+92*scale,y:rect.y+32*scale,w:rect.w-372*scale,h:rect.h-104*scale};
  const members=displayTracks(memberSubset(args,2000),args);
  const officialSource=args.centers.length?displayTracks(args.centers,args)[0]?.track||[]:[];
  const leadSet=new Set<number>(); members.forEach(m=>m.track.forEach(p=>leadSet.add(Math.round(finite(p.leadHour,p.simHour))))); officialSource.forEach(p=>leadSet.add(Math.round(finite(p.leadHour,p.simHour))));
  const leads=[...leadSet].sort((a,b)=>a-b); if(leads.length===0 || leads[0]!==0) leads.unshift(0); const xMax=Math.max(240,leads[leads.length-1]||240);
  const stats=leads.map(lead=>{const values=members.map(m=>jtwcKt(interpolateTrackValue(m.track,lead,"vmax"), "continuous")).filter(v=>Number.isFinite(v)).sort((a,b)=>a-b); const official=officialSource.length?jtwcKt(interpolateTrackValue(officialSource,lead,"vmax"), "continuous"):NaN; return {lead, official, mean: values.reduce((a,b)=>a+b,0)/Math.max(1,values.length), median: percentile(values,.5), p25: percentile(values,.25), p75: percentile(values,.75), p10: percentile(values,.1), p90: percentile(values,.9), min: values[0]??0, max: values[values.length-1]??0}; });
  const yMin=0,yMax=Math.max(180,Math.ceil((Math.max(...stats.map(s=>s.max),140)+5)/10)*10);
  ctx.fillStyle="#ffffff";ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  drawCategoryWindBands(ctx,rect,plot,yMin,yMax,scale);
  const drawBand=(loKey:"min"|"p10"|"p25", hiKey:"max"|"p90"|"p75", fill:string, alpha:number)=>{ctx.save();ctx.beginPath();stats.forEach((s,i)=>{const x=plot.x+s.lead/xMax*plot.w; const y=plot.y+plot.h-(clamp((s as any)[hiKey],yMin,yMax)-yMin)/(yMax-yMin)*plot.h; i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); for(let i=stats.length-1;i>=0;i--){const s=stats[i]; const x=plot.x+s.lead/xMax*plot.w; const y=plot.y+plot.h-(clamp((s as any)[loKey],yMin,yMax)-yMin)/(yMax-yMin)*plot.h; ctx.lineTo(x,y);} ctx.closePath(); ctx.fillStyle=fill; ctx.globalAlpha=alpha; ctx.fill(); ctx.restore();};
  drawBand("min","max","#eadfd2",0.42); drawBand("p10","p90","#f3c28f",0.32); drawBand("p25","p75","#f6a65b",0.34);
  ctx.strokeStyle="#d1d5db";ctx.lineWidth=1;ctx.setLineDash([5*scale,5*scale]);
  const yTicks=[0,30,50,64,83,96,113,137,150]; yTicks.forEach(v=>{const y=plot.y+plot.h-(v-yMin)/(yMax-yMin)*plot.h;ctx.beginPath();ctx.moveTo(plot.x,y);ctx.lineTo(plot.x+plot.w,y);ctx.stroke(); if(v>0){ctx.fillStyle="#64748b";ctx.font=safeFont(12*scale,500);ctx.textAlign="right";ctx.fillText(String(v),plot.x-10*scale,y+4*scale);}});
  for(let lead=0;lead<=xMax+1e-6;lead+=24){const x=plot.x+lead/xMax*plot.w;ctx.beginPath();ctx.moveTo(x,plot.y);ctx.lineTo(x,plot.y+plot.h);ctx.stroke();ctx.textAlign="center";ctx.fillStyle="#334155";ctx.font=safeFont(12*scale,500);ctx.fillText(`+${lead}h`,x,plot.y+plot.h+18*scale);}
  ctx.setLineDash([]);ctx.strokeStyle="#111827";ctx.lineWidth=1.2*scale;ctx.strokeRect(plot.x,plot.y,plot.w,plot.h);
  const drawLine=(getY:(s:any)=>number,color:string,width:number,dash:number[]=[], withDots=false)=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();stats.forEach((s,i)=>{const x=plot.x+s.lead/xMax*plot.w; const y=plot.y+plot.h-(clamp(getY(s),yMin,yMax)-yMin)/(yMax-yMin)*plot.h; i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.setLineDash([]);if(withDots){stats.forEach((s)=>{const x=plot.x+s.lead/xMax*plot.w; const y=plot.y+plot.h-(clamp(getY(s),yMin,yMax)-yMin)/(yMax-yMin)*plot.h;ctx.fillStyle="#fff";ctx.strokeStyle=color;ctx.lineWidth=2*scale;ctx.beginPath();ctx.arc(x,y,4.8*scale,0,Math.PI*2);ctx.fill();ctx.stroke();});}ctx.restore();};
  drawLine(s=>s.official,"#0f172a",4.6*scale,[11*scale,6*scale],true);
  drawLine(s=>s.mean,"#f97316",3.4*scale,[],true);
  drawLine(s=>s.median,"#c56b18",2.2*scale,[6*scale,4*scale]);
  drawHeader(ctx,`Intensity Forecast — ${args.stormName}`,`${formatIssue(args.startDate,args.currentHour)} · ensemble mean / spread diagnostic`,w,scale,"");
  ctx.save(); ctx.fillStyle="#334155"; ctx.font=safeFont(13*scale,600); ctx.textAlign="center"; ctx.fillText("Forecast Hour",plot.x+plot.w/2,h-18*scale); ctx.restore();
  ctx.save(); ctx.translate(20*scale,plot.y+plot.h/2); ctx.rotate(-Math.PI/2); ctx.fillStyle="#334155"; ctx.font=safeFont(13*scale,600); ctx.textAlign="center"; ctx.fillText("V/max (kt)",0,0); ctx.restore();
  const legendX=plot.x+plot.w+24*scale, legendY=plot.y+14*scale, legendW=300*scale, legendH=162*scale; ctx.fillStyle="rgba(255,255,255,.96)"; ctx.strokeStyle="#d1d5db"; ctx.lineWidth=1; ctx.fillRect(legendX,legendY,legendW,legendH); ctx.strokeRect(legendX,legendY,legendW,legendH);
  const legendItems:[string,string,string][]=[[`${ensembleAgencyCode()} reference forecast`,"#0f172a","line"],["ensemble mean","#f97316","line"],["median (P50)","#c56b18","dash"],["P25 – P75 (IQR)","#f6a65b","box"],["P10 – P90","#f3c28f","box"],["min – max","#eadfd2","box"]];
  legendItems.forEach((item,i)=>{const y=legendY+28*scale+i*22*scale; if(item[2]==="box"){ctx.fillStyle=item[1];ctx.globalAlpha=i===3?.34:i===4?.32:.42;ctx.fillRect(legendX+16*scale,y-8*scale,46*scale,10*scale);ctx.globalAlpha=1;} else {ctx.strokeStyle=item[1];ctx.lineWidth= item[2]==="dash"?2.6*scale:4.4*scale;ctx.setLineDash(item[2]==="dash"?[6*scale,4*scale]:[]);ctx.beginPath();ctx.moveTo(legendX+16*scale,y-2*scale);ctx.lineTo(legendX+64*scale,y-2*scale);ctx.stroke();ctx.setLineDash([]); if(i<2){ctx.fillStyle="#fff";ctx.strokeStyle=item[1];ctx.lineWidth=2*scale;ctx.beginPath();ctx.arc(legendX+40*scale,y-2*scale,5.5*scale,0,Math.PI*2);ctx.fill();ctx.stroke();}} ctx.fillStyle="#374151"; ctx.font=safeFont(11*scale,600); ctx.textAlign="left"; ctx.fillText(item[0],legendX+76*scale,y+2*scale); });
  drawFooter(ctx,w,h,scale,"WMC synthetic ensemble intensity forecast · shaded bands summarize full member spread without thinning the native guidance nodes");
}



export function drawEnsembleReferenceProduct(args: DrawArgs) {
  const ctx=args.canvas.getContext("2d");if(!ctx)return;
  if(args.canvas.width!==args.width)args.canvas.width=args.width;if(args.canvas.height!==args.height)args.canvas.height=args.height;
  switch(args.style){
    case "track_diagnostics_4panel": return drawTrackDiagnostics(args,ctx);
    case "diagnostic_matrix_2model": return drawDiagnosticMatrix(args,ctx,false);
    case "deterministic_overview": return drawDeterministicOverview(args,ctx);
    case "member_spaghetti_ranked": return drawMemberRanked(args,ctx,false);
    case "member_spaghetti_mean": return drawMemberRanked(args,ctx,true);
    case "diagnostic_matrix_3model": return drawDiagnosticMatrix(args,ctx,true);
    case "model_intensity_guidance": return drawModelIntensityGuidance(args,ctx);
    case "ensemble_intensity_forecast": return drawEnsembleIntensityForecast(args,ctx);
    case "pressure_spaghetti_basin": return drawPressureSpaghetti(args,ctx);
    case "paired_cycle_pressure": return drawPairedCycle(args,ctx);
    default: return;
  }
}

/** Async entry: the fifth layout computes a cancellable true member-hit grid. Existing layouts remain synchronous. */
export async function drawEnsembleReferenceProductAsync(args: DrawArgs): Promise<void> {
  if (args.style === "ensemble_intensity_analysis") {
    await drawEnsembleIntensityAnalysis({canvas:args.canvas,width:args.width,members:args.members,
      horizonHours:args.forecastHorizonHours||360,issueDate:new Date(args.startDate.getTime()+args.currentHour*3600000),
      title:args.stormName,agencyCode:ensembleAgencyCode(),footerRight:args.ensembleAnalysisFooter,unit:args.ensembleAnalysisUnit,endMode:args.specialTrackEndMode,
      signal:args.signal,onProgress:args.onProgress});
    return;
  }
  if (args.style !== "strike_probability_120km") { drawEnsembleReferenceProduct(args); return; }
  if (!args.strike) throw new Error("概率图缺少绘制参数");
  await drawStrikeProbabilityProduct({
    canvas:args.canvas,width:args.width,height:args.height,
    activeState:args.activeState,currentHour:args.currentHour,startDate:args.startDate,typhoon:args.typhoon,
    members:args.members,centers:args.centers,strike:args.strike,isMini:args.isMini,
    signal:args.signal,onProgress:args.onProgress,cache:args.strikeCache
  });
}
