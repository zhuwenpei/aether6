/**
 * AETHER NMC-style path/probability product — Round137 replacement renderer.
 * Independent of the JMA / wind-field / precipitation renderers.
 * Design grid and typography follow the user's 1295 × 1103 reference plates.
 * This is a SIMULATED chart, not a document issued or approved by NMC/CMA.
 */
import { getAgencyIntensity, getWindForceCategory } from '../simulation/Engine';
import { getSimulationBeijingDate } from '../simulation/CmaOperationalClock';
/** Official NMC history fixes requested for this plate (Beijing time; 05 excluded). */
export const NMC_HISTORY_HOURS = [2, 8, 11, 14, 17, 20, 23] as const;
export function isNmcHistoryFix(startDate: Date, simHour: number): boolean {
  const d = getSimulationBeijingDate(startDate, simHour);
  return d.getUTCMinutes() === 0 && NMC_HISTORY_HOURS.includes(d.getUTCHours() as typeof NMC_HISTORY_HOURS[number]);
}
import { strokeProductCoastlineRing } from './ProductCoastlineDrawing';
import { buildNmcGeoFrame, nmcProjectPoint } from './NmcMapViewport';
import { shouldDrawNmcRiver } from './NmcOptionalGeography';

export type NmcChartPoint = {
  lat: number; lon: number; vmax: number; simHour: number;
  category?: string; dissipated?: boolean;
};

export type NmcChartOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  typhoonName: string;
  typhoonNumber: string;
  ordinalNumber: string | number;
  issueDate: Date;
  forecastHours: number;
  issueHour: number;
  startDate: Date;
  current: NmcChartPoint;
  history: NmcChartPoint[];
  forecast: NmcChartPoint[];
  /** Common raw-physics advisory end shared with JMA, independent of NMC-only intensity styling. */
  issuedEndHour?: number;
  landGeoJson: any;
  /** The same fine, CLOSED coastline polygons are used for NMC land fill,
   * coastline outlines and masking the separately sourced China tint. */
  coastlineGeoJson?: any;
  countriesGeoJson?: any;
  provinceGeoJson?: any;
  riversGeoJson?: any;
  overlayNationalBorders?: boolean;
  overlayChinaProvinces?: boolean;
  overlayRivers?: boolean;
  chinaLandTint?: boolean;
  showInfoBoxes: boolean;
  showCenterBox: boolean;
  showForecastBox: boolean;
};

type XY = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
const BASE_W = 1295;
const BASE_H = 1103;
const MAP: Rect = { x: 22, y: 102, w: 1248, h: 819 };
const BLACK = '#151515';
const PALETTE = {
  ocean: '#dff0fa', land: '#fffdf9', continent: '#ffebcf',
  border: '#959ba0', grid: '#c5c9cb', cone: 'rgba(114,77,95,0.49)',
  td: '#ffd619', ts: '#143cff', sts: '#12962a', ty: '#ff9e28',
  sty: '#f500e6', super: '#f30716', et: '#929292',
  track: '#ef00d2', blue: '#00118f', green: '#04aa18'
};
const font = (px: number, bold = false) => `${bold ? '700' : '400'} ${px}px 'Microsoft YaHei','Noto Sans CJK SC','PingFang SC',sans-serif`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const valid = (p: NmcChartPoint) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.simHour);
const dayClock = (d: Date) => `${d.getDate()}日${String(d.getHours()).padStart(2, '0')}时`;
const nextDate = (d: Date, h: number) => new Date(d.getTime() + h * 3600000);

/** The physical engine serializes ET as a Chinese TyphoonCategory enum value. */
export function isNmcExtratropical(kind?: string): boolean {
  return kind === 'ET' || kind === '温带气旋' || kind === 'extratropical_cyclone';
}
function category(vmax: number, kind?: string) {
  if (isNmcExtratropical(kind)) return { name: '温带气旋', color: PALETTE.et };
  if (kind === 'RL' || kind === 'DS') return { name: '残留低压', color: PALETTE.et };
  if (vmax < 17.2) return { name: '热带低压', color: PALETTE.td };
  if (vmax < 24.5) return { name: '热带风暴', color: PALETTE.ts };
  if (vmax < 32.7) return { name: '强热带风暴', color: PALETTE.sts };
  if (vmax < 41.5) return { name: '台风', color: PALETTE.ty };
  if (vmax < 51.0) return { name: '强台风', color: PALETTE.sty };
  return { name: '超强台风', color: PALETTE.super };
}
function classification(vmax: number, kind?: string) {
  const name = category(vmax, kind).name;
  return name.endsWith('气旋') || name.endsWith('低压') || name === '残留低压' ? name : `${name}级`;
}
/** All NMC information boxes use the CMA public wind-speed bins, including
 * points whose underlying vmax was set by the NMC-only manual peak control.
 * The control changes physical forecast COPY intensity; it must never bypass
 * the separate public reporting/grade conversion at drawing time. */
function cmaNmcAssessment(vmax: number, kind?: string) {
  const reported = getAgencyIntensity(vmax, 'CMA', 'public').value;
  const publishedWind = Math.round(reported);
  return {
    wind: publishedWind,
    force: getWindForceCategory(publishedWind),
    name: classification(publishedWind, kind),
    color: category(publishedWind, kind).color
  };
}
/** Constant-time wrapping: the old while loops could hang on Infinity / huge GeoJSON coordinates. */
export function unwrappedLon(lon: number, center: number): number {
  if (!Number.isFinite(lon) || !Number.isFinite(center)) return NaN;
  return ((lon - center + 180) % 360 + 360) % 360 - 180 + center;
}
function pin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, border = '#fff', borderWidth = 0.6) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  if (border && borderWidth > 0) { ctx.strokeStyle = border; ctx.lineWidth = borderWidth; ctx.stroke(); }
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function drawAgencyStyleHeader(ctx: CanvasRenderingContext2D, o: NmcChartOptions) {
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 0.9; ctx.strokeRect(5.5, 5.5, 1285, 1091.5);
  // Before tropical-storm naming, a TD must never be titled as numbered 台风.
  const heading = o.current.category === '热带低压' || o.current.category === 'TD' || o.current.vmax < 17.2
    ? '热带低压' : `今年第${o.ordinalNumber}号台风 “${o.typhoonName}”`;
  const title = `${heading} 未来${o.forecastHours}小时路径概率预报图`;
  ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = font(29); ctx.fillText(title, 635, 34, 1030);
  const end = nextDate(o.issueDate, o.forecastHours);
  ctx.font = font(25);
  const sameMonth = o.issueDate.getFullYear() === end.getFullYear() && o.issueDate.getMonth() === end.getMonth();
  const endText = sameMonth ? dayClock(end) : (o.issueDate.getFullYear() === end.getFullYear() ? `${end.getMonth()+1}月${dayClock(end)}` : `${end.getFullYear()}年${end.getMonth()+1}月${dayClock(end)}`);
  ctx.fillText(`${o.issueDate.getFullYear()}年${o.issueDate.getMonth()+1}月${dayClock(o.issueDate)}—${endText}（北京时）`, 635, 72, 1035);
  ctx.textAlign = 'right'; ctx.font = '400 43px Arial, sans-serif';
  ctx.fillStyle = PALETTE.green; ctx.fillText('WMC', 1261, 56);
}
function drawMapLogo(ctx: CanvasRenderingContext2D) {
  // Decorative blue weather mark occupying the same upper-left map slot as
  // the agency logo in the reference; deliberately NOT an official agency seal.
  ctx.save(); ctx.translate(76, 156);
  ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.fillStyle = '#fffaf0'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#2480c4'; ctx.stroke();
  ctx.rotate(-0.3);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(-5 + i*4, -12 + i*13, 25-i*4, 9-i*1.2, -0.35, 0.5, Math.PI*1.65);
    ctx.strokeStyle = ['#5bafcf','#2769a9','#0a379a'][i]; ctx.lineWidth = 5.5; ctx.stroke();
  }
  ctx.restore();
}
/** Build exactly the same projected closed rings for fills, tints and shorelines. */
function tracePolygonRings(
  ctx: CanvasRenderingContext2D,
  rings: number[][][],
  project: (lat:number,lon:number)=>XY,
  centerLon: number
): void {
  for (const ring of rings || []) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let started = false, vertices = 0;
    for (const coordinate of ring) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) { started = false; continue; }
      const [lon, lat] = coordinate;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat)>90) { started=false; continue; }
      const p = project(lat, unwrappedLon(lon, centerLon));
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { started=false; continue; }
      if (!started) { ctx.moveTo(p.x,p.y); started=true; }
      else ctx.lineTo(p.x,p.y);
      vertices++;
    }
    if (started && vertices >= 3) ctx.closePath();
  }
}
/** Render a bounded land mask ONCE; never construct a single enormous clip path.
 * Optional geography is composited using destination-in, outside the main
 * canvas state machine. Raster resolution is capped at 2x the base plate,
 * even for very large exports (both canvases together <= ~27 MB).
 * The generator yields so the caller can abort between individual features. */
function createNmcOverlaySurface(o:NmcChartOptions) {
  if (typeof document === 'undefined') return null;
  const factor=Math.min(2,Math.max(1,o.width/BASE_W));
  const w=Math.round(MAP.w*factor),h=Math.round(MAP.h*factor);
  try {
    const mask=document.createElement('canvas'),overlay=document.createElement('canvas');
    mask.width=overlay.width=w;mask.height=overlay.height=h;
    const mc=mask.getContext('2d'),oc=overlay.getContext('2d');
    if (!mc||!oc) {mask.width=mask.height=overlay.width=overlay.height=0;return null;}
    mc.setTransform(factor,0,0,factor,-MAP.x*factor,-MAP.y*factor);
    oc.setTransform(factor,0,0,factor,-MAP.x*factor,-MAP.y*factor);
    return {mask,overlay,mc,oc,factor,dispose(){mask.width=mask.height=overlay.width=overlay.height=0;}};
  } catch { return null; }
}
function paintPolygon(ctx: CanvasRenderingContext2D, rings: number[][][], project: (lat:number,lon:number)=>XY, centerLon: number, fill?: string, stroke?: string, weight = .62) {
  if (!rings?.length) return;
  if (fill) {
    ctx.beginPath();
    tracePolygonRings(ctx, rings, project, centerLon);
    ctx.fillStyle = fill;
    ctx.fill('evenodd');
  }
  if (stroke) {
    ctx.strokeStyle = stroke; ctx.lineWidth = weight;
    // Skip only artificial source-plate joining edges; genuine coastlines come
    // from precisely the same fine polygons used by the land fill above.
    for (const ring of rings) {
      strokeProductCoastlineRing(ctx, ring, (lat, lon) => project(lat, unwrappedLon(lon, centerLon)));
    }
  }
}
/** Round182: identical vector geometry, but split the work into bounded chunks.
 * A generator keeps synchronous callers compatible while an async exporter can
 * yield to the browser between geographic layers and allow cancellation. */
function* drawBaseMapSteps(ctx: CanvasRenderingContext2D, o: NmcChartOptions, frame: ReturnType<typeof buildNmcGeoFrame>, project: (lat:number,lon:number)=>XY, onWarning?: (message:string)=>void): Generator<void> {
  ctx.save();
  let overlaySurface:ReturnType<typeof createNmcOverlaySurface>=null;
  try { ctx.beginPath(); ctx.rect(MAP.x, MAP.y, MAP.w, MAP.h); ctx.clip();
  ctx.fillStyle = PALETTE.ocean; ctx.fillRect(MAP.x, MAP.y, MAP.w, MAP.h);
  const centerLon = (frame.minLon + frame.maxLon) / 2;
  const visibleBbox = (f: any) => {
    const b = f?.properties?.BBOX || f?.bbox;
    if (!b || b.length < 4) return true;
    if (b[3] < frame.minLat-1 || b[1] > frame.maxLat+1) return false;
    const min = unwrappedLon(b[0], centerLon), max = unwrappedLon(b[2], centerLon);
    return max < min || !(max < frame.minLon-1 || min > frame.maxLon+1);
  };
  // Round180: the fill AND coastline outline must use the SAME fine coastline
  // polygons. The legacy wide land plate is only a fallback for old/test callers.
  const landFeatures = o.coastlineGeoJson?.features?.length
    ? o.coastlineGeoJson.features
    : o.landGeoJson?.features?.length ? o.landGeoJson.features : (o.countriesGeoJson?.features || []);
  const drawFeature = (f: any, fill?:string, stroke?:string, width = .62, target=ctx) => {
    const g = f?.geometry;
    if (!g || !visibleBbox(f)) return;
    if (g.type === 'Polygon') paintPolygon(target, g.coordinates, project, centerLon, fill, stroke, width);
    if (g.type === 'MultiPolygon') for (const poly of g.coordinates) paintPolygon(target, poly, project, centerLon, fill, stroke, width);
  };
  const startedAt=typeof performance!=='undefined'?performance.now():Date.now();
  let lastYield=startedAt;
  const elapsed=()=> (typeof performance!=='undefined'?performance.now():Date.now())-startedAt;
  const timeToYield=(count:number,limit:number)=>{
    const now=typeof performance!=='undefined'?performance.now():Date.now();
    if(now-lastYield>10 || count%limit===0){lastYield=now;return true;}
    return false;
  };
  // Overlay layers are optional: after the budget expires we still finish the
  // base coastline, forecast and labels instead of delivering a blank chart.
  let warnedBudget = false;
  const withinOptionalBudget=()=> {
    const ok=elapsed()<6000;
    if(!ok && !warnedBudget){
      warnedBudget=true;
      onWarning?.('NMC 地理叠加超过时间预算，部分图层已跳过');
    }
    return ok;
  };
  const trace=(phase:string)=>{
    try{if(typeof window!=='undefined' &&
      ((window as any).__AETHER_NMC_TRACE || window.localStorage?.getItem('AETHER_NMC_TRACE')==='1'))
      console.info(`[AETHER/NMC] ${phase}: ${Math.round(elapsed())} ms`);}catch{/* privacy/storage disabled */}
  };
  const overlays=(o.chinaLandTint!==false || o.overlayNationalBorders!==false) && o.countriesGeoJson?.features?.length
    ? createNmcOverlaySurface(o):null;
  overlaySurface=overlays;
  if (!overlays && o.countriesGeoJson?.features?.length &&
     (o.chinaLandTint!==false || o.overlayNationalBorders!==false)) {
    onWarning?.('NMC 设备内存不足，已跳过部分地理叠加层');
  }
  if(overlays){
    let maskCount=0;
    for(const feature of landFeatures){
      drawFeature(feature,'#fff',undefined,.62,overlays.mc);
      if(timeToYield(++maskCount,12)) yield;
    }
    trace('land mask ready');
  }
  let processed = 0;
  for (const feature of landFeatures) {
    drawFeature(feature, PALETTE.land);
    if (timeToYield(++processed,24)) yield;
  }
  yield;

  // China tint: paint a separate country layer, mask it by the already-painted
  // fine land UNION (not even-odd XOR), and composite it ONCE. The old code
  // constructed a 95k-vertex clip path across yields and hung on some GPUs.
  if (o.chinaLandTint !== false && overlays && withinOptionalBudget()) {
    const tintCountries = o.countriesGeoJson.features.filter((feature: any) => {
      const pr = feature?.properties || {};
      const name = String(pr.ADMIN || pr.NAME || '');
      return /^(China|Hong Kong|Macao|Macau|Taiwan)$/i.test(name) && visibleBbox(feature);
    });
    if (tintCountries.length) {
      for (const feature of tintCountries) {
        drawFeature(feature,PALETTE.continent,undefined,.62,overlays.oc);
        if(timeToYield(++processed,12)) yield;
      }
      overlays.oc.save();
      overlays.oc.setTransform(1,0,0,1,0,0);
      overlays.oc.globalCompositeOperation='destination-in';
      overlays.oc.drawImage(overlays.mask,0,0);
      overlays.oc.restore();
      ctx.drawImage(overlays.overlay,MAP.x,MAP.y,MAP.w,MAP.h);
      overlays.oc.save();overlays.oc.setTransform(1,0,0,1,0,0);
      overlays.oc.clearRect(0,0,overlays.overlay.width,overlays.overlay.height);
      overlays.oc.restore();
      trace('China tint completed');
    }
  }
  // Grid lines are dashed, low-contrast, and laid across land and sea.
  ctx.lineWidth = .7; ctx.strokeStyle = PALETTE.grid; ctx.setLineDash([4, 3]);
  for (let lon = Math.ceil(frame.minLon/5)*5; lon <= frame.maxLon; lon += 5) {
    const x = project(frame.minLat, lon).x;
    ctx.beginPath(); ctx.moveTo(x, MAP.y); ctx.lineTo(x, MAP.y+MAP.h); ctx.stroke();
  }
  for (let lat = Math.ceil(frame.minLat/5)*5; lat <= frame.maxLat; lat += 5) {
    const y = project(lat, frame.minLon).y;
    ctx.beginPath(); ctx.moveTo(MAP.x, y); ctx.lineTo(MAP.x+MAP.w, y); ctx.stroke();
  }
  ctx.setLineDash([]);
  // National borders must also be masked, but never clip the main context
  // with one giant multipolygon. Reuse the bounded mask above.
  if (o.overlayNationalBorders !== false && overlays && withinOptionalBudget()) {
    processed=0;
    for (const feature of o.countriesGeoJson.features) {
      drawFeature(feature,undefined,'#9d9fa0',.54,overlays.oc);
      if(timeToYield(++processed,16)) yield;
      if(!withinOptionalBudget())break;
    }
    overlays.oc.save();
    overlays.oc.setTransform(1,0,0,1,0,0);
    overlays.oc.globalCompositeOperation='destination-in';
    overlays.oc.drawImage(overlays.mask,0,0);
    overlays.oc.restore();
    ctx.drawImage(overlays.overlay,MAP.x,MAP.y,MAP.w,MAP.h);
    trace('national borders completed');
  }
  overlays?.dispose();overlaySurface=null;
  // Paint the genuine fine coastline last, keeping a consistent exterior edge.
  processed = 0;
  for (const feature of landFeatures) {
    drawFeature(feature, undefined, '#888c8e', .8);
    if (timeToYield(++processed,24)) yield;
  }
  yield;
  // R205: independent bounded budgets for provinces and hydrography. The old
  // 6s clock started before land/coastline/tint/national borders; on busy
  // devices it could already be exhausted when these LAST layers started,
  // causing valid loaded vectors to silently disappear from the image.
  const detailLayerBudgetMs=2350;
  const detailLayerAllowed=(started:number,name:string)=>{
    const ok=(typeof performance!=='undefined'?performance.now():Date.now())-started<detailLayerBudgetMs;
    if(!ok)onWarning?.(`NMC ${name}要素过密，已截断该图层以保护绘图性能`);
    return ok;
  };
  // Province and hydrographic source data are optional real-world vectors.
  // Do not manufacture administrative boundaries when the data is unavailable.
  if (o.overlayChinaProvinces && o.provinceGeoJson?.features) {
    const detailStarted=typeof performance!=='undefined'?performance.now():Date.now();
    processed = 0;
    for (const feature of o.provinceGeoJson.features) {
      if (!visibleBbox(feature)) continue;
      const g=feature.geometry;
      const drawLines=(lines:number[][][])=>{
        ctx.beginPath();
        for(const line of lines){let started=false;let lastX=NaN;
          for(const coord of line){if(!Array.isArray(coord)||!Number.isFinite(coord[0])||!Number.isFinite(coord[1])){started=false;continue;}
            const point=project(coord[1],unwrappedLon(coord[0],centerLon));
            if(!Number.isFinite(point.x)||!Number.isFinite(point.y)){started=false;continue;}
            if(!started || Math.abs(point.x-lastX)>MAP.w*.55) ctx.moveTo(point.x,point.y);
            else ctx.lineTo(point.x,point.y);
            lastX=point.x;started=true;
          }
        }
        ctx.strokeStyle='#b6a6a1';ctx.lineWidth=.52;ctx.stroke();
      };
      if(g?.type==='Polygon') drawLines(g.coordinates);
      if(g?.type==='MultiPolygon') for(const poly of g.coordinates) drawLines(poly);
      if(g?.type==='LineString') drawLines([g.coordinates]);
      if(g?.type==='MultiLineString') drawLines(g.coordinates);
      if (timeToYield(++processed,12)) yield;
      if(!detailLayerAllowed(detailStarted,'省界'))break;
    }
  }
  if (o.overlayRivers && o.riversGeoJson?.features) {
    const detailStarted=typeof performance!=='undefined'?performance.now():Date.now();
    ctx.strokeStyle='#58b5d3';ctx.lineWidth=.85;ctx.lineCap='round';
    processed = 0;
    for(const feature of o.riversGeoJson.features){
      // Spatially reject off-map streams BEFORE evaluating thousands of vertices.
      // The retained stream lines still use every original coordinate unchanged.
      if (!visibleBbox(feature)) continue;
      if (!shouldDrawNmcRiver(feature)) continue;
      if (timeToYield(++processed,24)) yield;
      if(!detailLayerAllowed(detailStarted,'水系'))break;
      const g=feature.geometry;if(!g)continue;
      const lines:number[][][]=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      for(const line of lines){ctx.beginPath();let started=false,lastX=NaN;
        for(const coord of line){if(!Array.isArray(coord)||!Number.isFinite(coord[0])||!Number.isFinite(coord[1])){started=false;continue;}
          const point=project(coord[1],unwrappedLon(coord[0],centerLon));
          if(!Number.isFinite(point.x)||!Number.isFinite(point.y)){started=false;continue;}
          if(!started||Math.abs(point.x-lastX)>MAP.w*.55)ctx.moveTo(point.x,point.y);else ctx.lineTo(point.x,point.y);
          started=true;lastX=point.x;
        }ctx.stroke();
      }
    }
  }

  const cities = [
    ['北京',39.90,116.40],['平壤',39.02,125.75],['首尔',37.57,126.98],
    ['东京',35.68,139.69],['上海',31.23,121.47],['台北',25.03,121.56],
    ['马尼拉',14.60,120.98],['塞班',15.18,145.76],['阿加尼亚',13.47,144.75],
    ['梅莱凯奥克',7.50,134.62],['帕利基尔',6.92,158.16],['马朱罗',7.09,171.38],
    ['那霸',26.21,127.68],['广州',23.13,113.26],['海口',20.02,110.35],
    ['莫斯科',55.75,37.61]
  ] as const;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = font(13);
  for (const [name, lat, lon] of cities) {
    const p = project(lat, unwrappedLon(lon, centerLon));
    if (p.x < MAP.x+12 || p.x > MAP.x+MAP.w-30 || p.y < MAP.y+13 || p.y > MAP.y+MAP.h-12) continue;
    pin(ctx, p.x, p.y, 4.1, '#ef0000', 'white');
    ctx.fillStyle = BLACK; ctx.fillText(name, p.x+5, p.y-11);
  }
  } finally { overlaySurface?.dispose();ctx.restore(); }
}
function drawBaseMap(ctx: CanvasRenderingContext2D, o: NmcChartOptions, frame: ReturnType<typeof buildNmcGeoFrame>, project: (lat:number,lon:number)=>XY) {
  for (const _ of drawBaseMapSteps(ctx,o,frame,project)) { /* legacy synchronous API */ }
}
function drawGridMargins(ctx: CanvasRenderingContext2D, frame: ReturnType<typeof buildNmcGeoFrame>, project: (lat:number,lon:number)=>XY) {
  ctx.fillStyle = '#232323'; ctx.textBaseline = 'middle';
  for (let lon = Math.ceil(frame.minLon/5)*5; lon <= frame.maxLon; lon += 5) {
    const x = project(frame.minLat, lon).x;
    if (x < MAP.x+16 || x > MAP.x+MAP.w-12) continue;
    ctx.font = '14px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillText(`${((lon%360)+360)%360}° E`, x, 931);
  }
  for (let lat = Math.ceil(frame.minLat/5)*5; lat <= frame.maxLat; lat += 5) {
    const y = project(lat, frame.minLon).y;
    if (y < MAP.y+14 || y > MAP.y+MAP.h-10) continue;
    ctx.save(); ctx.translate(1280, y); ctx.rotate(-Math.PI/2);
    ctx.textAlign = 'center'; ctx.font = '14px Georgia,serif';
    ctx.fillText(`${Math.abs(lat)}° ${lat>=0?'N':'S'}`, 0, 0); ctx.restore();
  }
  ctx.strokeStyle = '#707070'; ctx.lineWidth = .8; ctx.strokeRect(MAP.x+.4, MAP.y+.4, MAP.w-.8, MAP.h-.8);
}
/** Shared probability-envelope geometry for rasterization AND callout exclusion. */
/** NMC official callout cadence: 12-hourly through 72h, then 24-hourly.
 * The centreline and uncertainty tube use exactly the SAME issued fixes.
 */
export function nmcOperationalLeadHours(maxLead:number):number[]{
  const result=[0];
  for(let h=12;h<=maxLead+1e-6;h+=h<72?12:24)result.push(h);
  return result;
}
function nmcStraightFixes(track:NmcChartPoint[], issueHour:number):NmcChartPoint[]{
  if(!track.length)return [];
  const last=track[track.length-1];
  const leads=nmcOperationalLeadHours(last.simHour-issueHour);
  const result=leads.map(lead=>interpolateForecastPoint(track,issueHour+lead)).filter((p):p is NmcChartPoint=>!!p);
  if(result.length && Math.abs(result[result.length-1].simHour-last.simHour)>1e-5)result.push(last);
  return result;
}
/** R212: retain the late narrowing while making the cone widen smoothly from T+0.
 * A weakly curved tropical path should not develop a bulbous 96-120h cap.
 * Keep 0-60h entirely unchanged and retain the original cone for paths
 * already reaching midlatitudes/the westerly flow. Centreline and intensity are unchanged. */
export function nmcPreWesterliesConeFactor(track:readonly NmcChartPoint[],lead:number):number {
  if(!track.length || !Number.isFinite(lead) || lead<=60) return 1;
  const maxLatitude=Math.max(...track.map(p=>Math.abs(p.lat)));
  if(!Number.isFinite(maxLatitude) || maxLatitude>=30) return 1;
  // Taper the late-width correction with a smoothstep rather than a linear
  // ramp. Both ends have zero slope, preventing a visible kink at 60/120h.
  // The actual radius still grows monotonically at every forecast lead.
  const t=Math.max(0,Math.min(1,(lead-60)/60));
  const smooth=t*t*(3-2*t);
  return 1-0.20*smooth;
}
/** Smooth, monotonic uncertainty radius in kilometres. The small early-width
 * component approaches 30km asymptotically instead of jumping from 0 to 30km
 * immediately after T+0; the later 360km term supplies the gradual broadening. */
export function nmcUncertaintyRadiusKm(track:readonly NmcChartPoint[],lead:number):number {
  const h=clamp(Number.isFinite(lead)?lead:0,0,120);
  if(h<=0)return 0;
  const base=30*(1-Math.exp(-h/8))+360*Math.pow(h/120,1.27);
  return base*nmcPreWesterliesConeFactor(track,h);
}
function getNmcConeSections(track:NmcChartPoint[],project:(lat:number,lon:number)=>XY,wrap:(lon:number)=>number,issueHour:number):NmcCalloutCircle[] {
  return track.map((p,i)=>{
    const prev=track[Math.max(0,i-1)],next=track[Math.min(track.length-1,i+1)];
    const xy=project(p.lat,wrap(p.lon));
    const a=project(prev.lat,wrap(prev.lon)),b=project(next.lat,wrap(next.lon));
    const len=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;
    const lead=clamp(p.simHour-issueHour,0,120);
    const km=nmcUncertaintyRadiusKm(track,lead);
    const lonPx=Math.abs(project(p.lat,wrap(p.lon)+1).x-xy.x);
    const latPx=Math.abs(project(p.lat+1,wrap(p.lon)).y-xy.y);
    const latR=km/111.12*latPx;
    const lonR=km/(111.12*Math.max(.35,Math.cos(p.lat*Math.PI/180)))*lonPx;
    return {x:xy.x,y:xy.y,r:Math.hypot(nx*lonR,ny*latR)};
  });
}
function renderEnvelope(ctx: CanvasRenderingContext2D, track: NmcChartPoint[], project: (lat:number,lon:number)=>XY, wrap: (lon:number)=>number, issueHour: number) {
  if (track.length < 2) return;
  // Round139: rasterize the uncertainty *union* into an opaque mask, then
  // composite once. A self-intersecting polygon creates spikes / slivers on a
  // sharp recurvature, and semi-transparent overlapping stamps darken the
  // cone. The mask avoids BOTH issues. Its final round disk guarantees a
  // genuinely round cap, independent of the final path tangent.
  const mask = document.createElement('canvas');
  mask.width = MAP.w;
  mask.height = MAP.h;
  const brush = mask.getContext('2d');
  if (!brush) return;
  brush.translate(-MAP.x, -MAP.y);
  brush.fillStyle = '#724d5f'; // exact opaque RGB of PALETTE.cone
  const stations=getNmcConeSections(track,project,wrap,issueHour);
  // Closely spaced circles produce a continuously varying-width swept tube.
  // Because the opaque mask is painted just once onto the final map, there
  // are no darker seams where circles overlap and no acute triangle at T+120h.
  for(let i=1;i<stations.length;i++){
    const a=stations[i-1],b=stations[i];
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/3));
    for(let j=i===1?0:1;j<=steps;j++){
      const t=j/steps;
      const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,r=a.r+(b.r-a.r)*t;
      if(r<=0)continue;
      brush.beginPath();brush.arc(x,y,r,0,Math.PI*2);brush.fill();
    }
  }
  ctx.save();
  ctx.globalAlpha=.49;
  ctx.drawImage(mask,MAP.x,MAP.y);
  ctx.restore();
}
function drawHistory(ctx: CanvasRenderingContext2D, o:NmcChartOptions, project:(lat:number,lon:number)=>XY, wrap:(lon:number)=>number) {
  const track = o.history.filter(p=>valid(p)&&p.simHour<=o.issueHour).sort((a,b)=>a.simHour-b.simHour);
  if (track.length) {
    ctx.beginPath(); track.forEach((p,i)=>{ const a=project(p.lat,wrap(p.lon)); if(i)ctx.lineTo(a.x,a.y); else ctx.moveTo(a.x,a.y); });
    ctx.strokeStyle = '#ee677d'; ctx.lineWidth = 1.7; ctx.stroke();
  }
  // 3-hour observed dots. If the archive uses a different step, still render
  // key analysis points; a cloud of ten-minute dots hides the track.
  let lastHour = -Infinity;
  for (let i=0;i<track.length;i++) {
    const p=track[i];
    if (!isNmcHistoryFix(o.startDate,p.simHour)) continue;
    if (Math.abs(p.simHour-lastHour)<0.01) continue;
    const a=project(p.lat,wrap(p.lon)); pin(ctx,a.x,a.y,5.4,cmaNmcAssessment(p.vmax,p.category).color,'',0);
    lastHour=p.simHour;
  }
}
function interpolateForecastPoint(track:NmcChartPoint[], hour:number): NmcChartPoint|null {
  if (track.length===0) return null;
  if (hour>track[track.length-1].simHour+1e-5) return null;
  for (let i=1;i<track.length;i++) {
    if (track[i].simHour + 1e-6 < hour) continue;
    const prev=track[i-1], next=track[i];
    const t=clamp((hour-prev.simHour)/Math.max(1e-8,next.simHour-prev.simHour),0,1);
    let delta=next.lon-prev.lon;
    if(delta>180)delta-=360;else if(delta<-180)delta+=360;
    return {lat:prev.lat+(next.lat-prev.lat)*t,lon:prev.lon+delta*t,vmax:prev.vmax+(next.vmax-prev.vmax)*t,simHour:hour,category:isNmcExtratropical(next.category) && t>1e-6 ? next.category : t<0.5?prev.category:next.category};
  }
  return track[0].simHour===hour?track[0]:null;
}
/** Round146: NMC issues at twelve-hour forecast fixes. If a previously
 * reportable storm drops to CMA force 7 or lower between fixes, retain the
 * NEXT issued fix as the terminal point, then stop the centreline, symbols,
 * probability envelope and labels together. A genesis TD is allowed to
 * strengthen rather than being incorrectly terminated at T+0. */
export function selectNmcIssuedForecast(
  current: NmcChartPoint, forecast: NmcChartPoint[], issueHour: number, maxHours: number
): NmcChartPoint[] {
  const ordered = forecast.filter(valid).filter(p => p.simHour > issueHour + 1e-6)
    .sort((a,b)=>a.simHour-b.simHour);
  if (isNmcExtratropical(current.category) || !ordered.length) return [current];
  const all = [current, ...ordered];
  const maxLead = Math.min(maxHours, Math.max(0, ordered[ordered.length-1].simHour - issueHour));
  let terminal = maxLead;
  // First ET advisory is terminal; ET must not be treated as an ordinary
  // tropical wind category (its numerical wind may still exceed force 7).
  // Use the actual first ET forecast fix, NOT a later scheduled tropical fix.
  const firstEt = ordered.find(p => isNmcExtratropical(p.category));
  if (firstEt) terminal = Math.min(terminal, firstEt.simHour - issueHour);
  let wasStorm = cmaNmcAssessment(current.vmax, current.category).force > 7;
  for (let lead = 12; lead <= terminal + 1e-6; lead += 12) {
    const fix = interpolateForecastPoint(all, issueHour + lead);
    if (!fix) break;
    const displayedForce = cmaNmcAssessment(fix.vmax, fix.category).force;
    // An explicitly predicted ET can retain a weakening tropical segment
    // through the first transition fix; otherwise the old force-7 stop would
    // erase the ET symbol and legend before they are ever drawn.
    // A genuinely dissipated/remnant cyclone still terminates normally.
    if ((fix.category === 'DS' || fix.category === 'RL' || fix.dissipated) ||
        (!firstEt && wasStorm && displayedForce <= 7)) {
      terminal = lead;
      break;
    }
    if (displayedForce > 7) wasStorm = true;
  }
  const finalHour = issueHour + terminal;
  const selected = [current, ...ordered.filter(p => p.simHour < finalHour - 1e-6)];
  const terminalPoint = interpolateForecastPoint(all, finalHour);
  if (terminalPoint && terminalPoint.simHour > selected[selected.length-1].simHour + 1e-6) selected.push(terminalPoint);
  return selected;
}

/** Image-only strength retargeting must not change the published advisory
 * duration. The common operational terminal issue was already diagnosed from
 * the same raw forecast supplied to the JMA chart. */
function nmcIssuedPointsForChart(o:NmcChartOptions):NmcChartPoint[]{
  if(!Number.isFinite(o.issuedEndHour))return selectNmcIssuedForecast(o.current,o.forecast,o.issueHour,o.forecastHours);
  const terminal=Math.min(o.issueHour+o.forecastHours,Number(o.issuedEndHour));
  if(terminal<=o.issueHour+1e-6)return [o.current];
  const ordered=o.forecast.filter(valid).filter(p=>p.simHour>o.issueHour+1e-6)
    .sort((a,b)=>a.simHour-b.simHour);
  const all=[o.current,...ordered];
  const kept=[o.current,...ordered.filter(p=>p.simHour<=terminal+1e-6)];
  const last=interpolateForecastPoint(all,terminal);
  if(last && last.simHour>kept[kept.length-1].simHour+1e-6)kept.push(last);
  return kept;
}
function drawForecast(ctx:CanvasRenderingContext2D, o:NmcChartOptions, project:(lat:number,lon:number)=>XY, wrap:(lon:number)=>number) {
  const original=nmcIssuedPointsForChart(o);
  const pts=nmcStraightFixes(original,o.issueHour);
  if(pts.length<=1) return pts;
  renderEnvelope(ctx,pts,project,wrap,o.issueHour);
  ctx.beginPath(); pts.forEach((p,i)=>{const a=project(p.lat,wrap(p.lon));if(i)ctx.lineTo(a.x,a.y);else ctx.moveTo(a.x,a.y);});
  ctx.strokeStyle = PALETTE.track;ctx.lineWidth=2.4;ctx.stroke();
  const plottedFixHours = new Set<number>();
  for(const lead of nmcOperationalLeadHours(pts[pts.length-1].simHour-o.issueHour).slice(1)){
    const hour=o.issueHour+lead;
    const pt=interpolateForecastPoint(pts,hour); if (!pt)continue;
    const a=project(pt.lat,wrap(pt.lon));pin(ctx,a.x,a.y,5.4,cmaNmcAssessment(pt.vmax,pt.category).color,'',0);
    plottedFixHours.add(Math.round(hour * 1000));
  }
  // Even an irregularly terminated track must end EXACTLY at a symbol.
  const last=pts[pts.length-1];
  if (!plottedFixHours.has(Math.round(last.simHour * 1000))) {
    const a=project(last.lat,wrap(last.lon));
    pin(ctx,a.x,a.y,5.4,cmaNmcAssessment(last.vmax,last.category).color,'',0);
  }
  const cur=project(o.current.lat,wrap(o.current.lon)); pin(ctx,cur.x,cur.y,6.2,cmaNmcAssessment(o.current.vmax,o.current.category).color,'',0);
  // Round165: no secondary magenta name/number beside the plotted cyclone track.
  // Keep the official header, point symbols, path and callout labels intact.
  return pts;
}

type ForecastLabel = {p:XY; lines:[string,string,string]; w:number; h:number; lead:number; box:Rect; route:XY[]};
export type NmcCalloutAnchor = { x: number; y: number; width: number; lead: number };
export type NmcCalloutBox = { lead: number; x: number; y: number; w: number; h: number; side: 'left'|'right'; route?: XY[] };
export type NmcCalloutSegment = { a: XY; b: XY };
export type NmcCalloutCircle = { x: number; y: number; r: number };
export type NmcCalloutObstacles = { history?: NmcCalloutSegment[]; forecast?: NmcCalloutSegment[]; cone?: NmcCalloutCircle[] };

/** Round141: geometry-constrained labeling, independent of canvas resolution.
 * Unlike the former greedy nearest-location strategy, candidates are ordered
 * first by forbidden-overlap count, then line crossings, then aesthetic cost.
 * The connector originates inside the cone by definition; its initial exit
 * is permitted, but its return into the cone is penalized.
 */
/** Round143: structured, straight-only NMC callouts.
 * A finite set of orderly outer/inner slots is shared by all fixes.  The beam
 * matcher chooses long leaders when space is tight; it never constructs elbows.
 * All constraints are expressed in chart pixels, so preview and PNG agree.
 */
const LABEL_H = 76;
const LABEL_GAP=12;
type Candidate = NmcCalloutBox & {id:number;route:XY[]; sideId:0|1|2|3; slot:number; baseCost:number};
function rectanglesOverlap(a:Rect,b:Rect,gap=0){
  return a.x < b.x+b.w+gap && b.x < a.x+a.w+gap &&
    a.y < b.y+b.h+gap && b.y < a.y+a.h+gap;
}
function rectContains(rect:Rect,point:XY,pad=0){
  return point.x>=rect.x-pad && point.x<=rect.x+rect.w+pad &&
    point.y>=rect.y-pad && point.y<=rect.y+rect.h+pad;
}
function lineIntersectsLine(a:XY,b:XY,c:XY,d:XY){
  const cross=(p:XY,q:XY,r:XY)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
  return ac*ad < -1e-5 && ca*cb < -1e-5;
}
function distanceToSegment(p:XY,a:XY,b:XY){
  const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
  if(len2<1e-6)return Math.hypot(p.x-a.x,p.y-a.y);
  const t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/len2,0,1);
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function lineHitsRect(a:XY,b:XY,box:Rect,pad=0){
  if(rectContains(box,a,pad)||rectContains(box,b,pad))return true;
  const x=box.x-pad,y=box.y-pad,w=box.w+2*pad,h=box.h+2*pad;
  const corners=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  return corners.some((p,i)=>lineIntersectsLine(a,b,p,corners[(i+1)%4]));
}
function rectIntersectsCircle(rect:Rect,circle:NmcCalloutCircle,pad=0){
  const x=clamp(circle.x,rect.x-pad,rect.x+rect.w+pad);
  const y=clamp(circle.y,rect.y-pad,rect.y+rect.h+pad);
  return Math.hypot(x-circle.x,y-circle.y)<circle.r+pad;
}
function calloutConnector(anchor:XY,box:Rect):XY{
  const midX=box.x+box.w/2,midY=box.y+box.h/2;
  const dx=anchor.x-midX,dy=anchor.y-midY;
  const scale=Math.max(Math.abs(dx)/(box.w/2),Math.abs(dy)/(box.h/2),1e-9);
  return {x:midX+dx/scale,y:midY+dy/scale};
}
function routeSegments(route:XY[]):NmcCalloutSegment[]{
  return route.slice(1).map((p,i)=>({a:route[i],b:p}));
}
function routeLength(route:XY[]){
  return Math.hypot(route[1].x-route[0].x,route[1].y-route[0].y);
}
function routeBlockedByPath(route:XY[],path:NmcCalloutSegment[],own:XY){
  let count=0;
  for(const segment of path){
    if(!lineIntersectsLine(route[0],route[1],segment.a,segment.b))continue;
    // The joined path segments at the annotated fix are unavoidable.
    if(distanceToSegment(own,segment.a,segment.b)<4)continue;
    count++;
  }
  return count;
}
function routeConeReentry(route:XY[],cone:NmcCalloutCircle[]){
  if(!cone.length)return 0;
  let outside=false,reentry=0;
  const sampleStride=Math.max(1,Math.ceil(cone.length/22));
  const circles=cone.filter((_,i)=>i%sampleStride===0||i===cone.length-1);
  const count=Math.min(36,Math.max(2,Math.ceil(routeLength(route)/22)));
  for(let i=0;i<=count;i++){
    const t=i/count,x=route[0].x+(route[1].x-route[0].x)*t,y=route[0].y+(route[1].y-route[0].y)*t;
    const inside=circles.some(c=>Math.abs(c.x-x)<c.r+4&&Math.abs(c.y-y)<c.r+4&&Math.hypot(c.x-x,c.y-y)<c.r+4);
    if(!inside)outside=true;
    else if(outside)reentry++;
  }
  return reentry;
}
function checkBoxAgainstSegments(box:Rect,path:NmcCalloutSegment[],pad=9){
  return path.some(seg=>lineHitsRect(seg.a,seg.b,box,pad));
}
/** Round157: chart-relative balanced slots, inspired by operational NMC plots.
 * The previous fixed edge rails made a compact track use extremely long leaders
 * on one side and short ones on the other.  Place coherent evenly spaced slots
 * around the ACTUAL forecast envelope first; preserve chart-edge slots as a
 * fallback for extremely broad or boundary-hugging paths.
 */
function adaptiveChartSlots(w:number,anchors:NmcCalloutAnchor[],cone:NmcCalloutCircle[]):ReturnType<typeof chartSlots>{
  const slots:ReturnType<typeof chartSlots>=[];
  if(!anchors.length)return slots;
  const clampX=(x:number)=>clamp(x,36,1256-w);
  const clampY=(y:number)=>clamp(y,222,910-LABEL_H);
  const xs=anchors.map(a=>a.x),ys=anchors.map(a=>a.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  // Ignore a few far-flung outer cone disks when placing the main label ring;
  // the detailed cone intersection checks below still reject covered boxes.
  const nearCone=cone.filter(c=>c.r<=120);
  const cMinX=nearCone.length?Math.min(...nearCone.map(c=>c.x-c.r)):minX;
  const cMaxX=nearCone.length?Math.max(...nearCone.map(c=>c.x+c.r)):maxX;
  const cMinY=nearCone.length?Math.min(...nearCone.map(c=>c.y-c.r)):minY;
  const cMaxY=nearCone.length?Math.max(...nearCone.map(c=>c.y+c.r)):maxY;
  const outerLeft=clampX(Math.min(minX,cMinX)-w-46);
  const outerRight=clampX(Math.max(maxX,cMaxX)+49);
  const top=clampY(Math.min(minY,cMinY)-LABEL_H-52);
  const bottom=clampY(Math.max(maxY,cMaxY)+50);
  const spread=(low:number,high:number,count:number)=>Array.from({length:count},(_,i)=>
    count===1?(low+high)/2:low+(high-low)*i/(count-1));
  const yMid=clampY((minY+maxY)/2-LABEL_H/2);
  // Operational NMC layouts reserve one full label height plus clear space
  // for each slot. A dense 8-slot range of 200px forced overflow to remote
  // edge rails even when the central ocean had ample usable area.
  const ySpan=Math.max(450,maxY-minY+155);
  const yLow=clampY(yMid-ySpan/2);
  const yHigh=clampY(yMid+ySpan/2);
  const xMid=(minX+maxX)/2;
  const xSpan=Math.max(570,maxX-minX+160);
  const xLow=clampX(xMid-xSpan/2);
  const xHigh=clampX(xMid+xSpan/2);
  const add=(x:number,y:number,sideId:0|1|2|3,slot:number)=>{
    x=clampX(x);y=clampY(y);
    if((x<137&&y<219)||(x+w>1042&&y<206))return;
    if(slots.some(p=>p.sideId===sideId && Math.abs(p.x-x)<3&&Math.abs(p.y-y)<3))return;
    slots.push({x,y,sideId,slot});
  };
  // First lane of each region shares regular spacing; secondary lane permits
  // offset staggering, NEVER random ad-hoc box positions.
  for(let i=0;i<6;i++){
    const ys=spread(yLow,yHigh,6);
    add(outerLeft,ys[i],3,i);
    add(outerRight,ys[i],1,i);
    const xx=spread(xLow,xHigh,6);
    add(xx[i],top,0,i);
    add(xx[i],bottom,2,i);
  }
  for(let i=0;i<5;i++){
    const ys=spread(yLow+22,yHigh-22,5);
    add(outerLeft-125,ys[i],3,8+i);
    add(outerRight+125,ys[i],1,8+i);
    const xx=spread(xLow+23,xHigh-23,5);
    add(xx[i],top-94,0,8+i);
    add(xx[i],bottom+94,2,8+i);
  }
  return slots;
}

/** Outer slots follow clockwise map edges; inner rows are only used where the
 * outer ring lacks room.  Every slot is on a repeatable graphic grid. */
function chartSlots(w:number):Array<{x:number;y:number;sideId:0|1|2|3;slot:number}>{
  const slots:Array<{x:number;y:number;sideId:0|1|2|3;slot:number}>=[];
  const add=(x:number,y:number,sideId:0|1|2|3,slot:number)=>{
    if(x<34||x+w>1258||y<217||y+LABEL_H>911)return;
    if((x<137&&y<219)||(x+w>1042&&y<206))return;
    slots.push({x,y,sideId,slot});
  };
  // Ordered top and bottom bands (staggering only when secondary band is used).
  for(const [row,y] of [ [0,234],[1,332] ]){
    for(let i=0;i<8;i++)add(56+i*150+(row?62:0),y,0,i+row*8);
  }
  for(const [row,y] of [[0,824],[1,724]]){
    for(let i=0;i<8;i++)add(56+i*150+(row?62:0),y,2,i+row*8);
  }
  // Ordered western and eastern sidebands (no forced one-column layout).
  for(const [column,x] of [[0,42],[1,206]]){
    for(let i=0;i<7;i++)add(x,250+i*89+(column?24:0),3,i+column*7);
  }
  for(const [column,x] of [[0,1242-w],[1,1038-w]]){
    for(let i=0;i<7;i++)add(x,250+i*89+(column?24:0),1,i+column*7);
  }
  return slots;
}
function sameLineCrowding(a:XY,b:XY,c:XY,d:XY){
  // Lines can overlap without a proper crossing. Also discourage almost
  // superimposed lines that become indistinguishable after PNG downscaling.
  const min=Math.min(distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b));
  return min<5;
}

export function planNmcCallouts(anchors:NmcCalloutAnchor[],obstacles:NmcCalloutObstacles={},useAdaptive=true):NmcCalloutBox[]{
  if(!anchors.length)return [];
  const ordered=[...anchors].sort((a,b)=>a.lead-b.lead);
  const forecast=obstacles.forecast?.length?obstacles.forecast:ordered.slice(1).map((p,i)=>({a:{x:ordered[i].x,y:ordered[i].y},b:{x:p.x,y:p.y}}));
  const path=[...(obstacles.history||[]),...forecast];
  const cone=obstacles.cone||[];
  const candidates=new Map<number,Candidate[]>();
  let nextCandidateId=0;
  for(const anchor of ordered){
    const here={x:anchor.x,y:anchor.y};
    const slots=useAdaptive
      ? [...adaptiveChartSlots(anchor.width,ordered,cone), ...chartSlots(anchor.width)]
      : chartSlots(anchor.width);
    const options:Candidate[]=[];
    for(const s of slots){
      const box:Rect={x:s.x,y:s.y,w:anchor.width,h:LABEL_H};
      if(rectContains(box,here,18))continue;
      const end=calloutConnector(here,box);
      const route=[here,end]; // straight line only, by construction
      const len=routeLength(route);
      const pathCover=checkBoxAgainstSegments(box,path,11);
      const coneCover=cone.some(c=>rectIntersectsCircle(box,c,11));
      const markerCover=ordered.some(a=>rectContains(box,{x:a.x,y:a.y},12));
      const crossings=routeBlockedByPath(route,path,here);
      const reentry=routeConeReentry(route,cone);
      const leadAngle=Math.atan2(box.y+LABEL_H/2-here.y,box.x+box.w/2-here.x);
      const fromX=here.x-ordered.reduce((sum,a)=>sum+a.x,0)/ordered.length;
      const fromY=here.y-ordered.reduce((sum,a)=>sum+a.y,0)/ordered.length;
      const outward=Math.cos(leadAngle)*fromX+Math.sin(leadAngle)*fromY;
      const baseCost=(pathCover?26000:0)+(coneCover?22000:0)+(markerCover?35000:0)+
        crossings*8000+reentry*4200+
        (len<94?(94-len)*32:0)+len*.58+
        (outward<0?Math.min(320,-outward*.9):0)+
        // Only use second bands when all primary slots are obstructed.
        ((s.sideId===0||s.sideId===2?s.slot>=8:s.slot>=7)?1300:0) +
        // Favor comparable connector lengths, not a random mix of tiny and
        // extremely long labels around the forecast centreline.
        // Prefer compact reference-style outward connectors, rather than
        // pushing every box ~245px away and crossing half the map.
        Math.max(0,len-340)*3.5;
      options.push({id:nextCandidateId++,x:box.x,y:box.y,w:box.w,h:box.h,lead:anchor.lead,
        side:box.x+box.w/2<here.x?'left':'right',route,sideId:s.sideId,slot:s.slot,baseCost});
    }
    // Take the best options from ALL FOUR regions, not only the nearest side.
    const shortlist:Candidate[]=[];
    for(const region of [0,1,2,3]){
      const group=options.filter(c=>c.sideId===region).sort((a,b)=>a.baseCost-b.baseCost||a.slot-b.slot);
      shortlist.push(...group.slice(0,10));
    }
    candidates.set(anchor.lead,shortlist.sort((a,b)=>a.baseCost-b.baseCost||a.sideId-b.sideId||a.slot-b.slot));
  }
  const rawConflict=(a:Candidate,b:Candidate):number=>{
    if(rectanglesOverlap(a,b,LABEL_GAP))return Infinity;
    if(lineHitsRect(a.route[0],a.route[1],b,4)||lineHitsRect(b.route[0],b.route[1],a,4))return Infinity;
    if(lineIntersectsLine(a.route[0],a.route[1],b.route[0],b.route[1]))return Infinity;
    // A leader grazing a second leader often looks like a crossing at mobile sizes.
    let penalty=sameLineCrowding(a.route[0],a.route[1],b.route[0],b.route[1])?1200:0;
    // Enforce a coherent connector-length rhythm across the full perimeter.
    // Pairwise comparison is symmetric and independent of side, so the search
    // cannot hide one very short leader among much longer neighbouring leaders.
    penalty += Math.max(0, Math.abs(routeLength(a.route)-routeLength(b.route))-160)*1.4;
    // Adjacent issue times should share a visual rhythm rather than having one
    // card hugging its point and the next card several hundred pixels away.
    if(Math.abs(a.lead-b.lead)===12){
      penalty += Math.max(0, Math.abs(routeLength(a.route)-routeLength(b.route))-180)*2;
    }
    if(a.sideId===b.sideId){
      // Equally spaced local rows/columns are easier to follow than unequal
      // gaps or two boxes fighting for the same horizontal reading band.
      const axisDelta=(a.sideId===0||a.sideId===2)?Math.abs(a.x-b.x):Math.abs(a.y-b.y);
      const ideal=(a.sideId===0||a.sideId===2)?Math.max(a.w,b.w)+18:LABEL_H+21;
      if(axisDelta<ideal)penalty+=(ideal-axisDelta)*6;
      const positionA=(a.sideId===0||a.sideId===2)?a.x:a.y;
      const positionB=(b.sideId===0||b.sideId===2)?b.x:b.y;
      const axisA=(a.sideId===0||a.sideId===2)?a.route[0].x:a.route[0].y;
      const axisB=(b.sideId===0||b.sideId===2)?b.route[0].x:b.route[0].y;
      if((positionA-positionB)*(axisA-axisB)<0)penalty+=1500;
    }
    return penalty;
  };
  // Cache pairwise geometry once. This optimizer is only run when the user
  // explicitly generates an NMC plate; a dense 120-hour chart otherwise
  // spends most of its time re-evaluating identical segment intersections.
  const pairCosts=new Map<number,number>();
  const conflict=(a:Candidate,b:Candidate):number=>{
    const low=Math.min(a.id,b.id),high=Math.max(a.id,b.id);
    const key=low*nextCandidateId+high;
    if(pairCosts.has(key))return pairCosts.get(key)!;
    const value=rawConflict(a,b);
    pairCosts.set(key,value);
    return value;
  };
  type State={items:Candidate[];cost:number};
  const solve=(order:NmcCalloutAnchor[],width:number):State|null=>{
    let beam:State[]=[{items:[],cost:0}];
    for(const anchor of order){
      const next:State[]=[];
      const options=candidates.get(anchor.lead)||[];
      for(const state of beam)for(const candidate of options){
        let extra=0;
        for(const item of state.items){
          const value=conflict(item,candidate);
          if(!Number.isFinite(value)){extra=Infinity;break;}
          extra+=value;
        }
        if(!Number.isFinite(extra))continue;
        next.push({items:[...state.items,candidate],cost:state.cost+candidate.baseCost+extra});
      }
      if(!next.length)return null;
      next.sort((a,b)=>a.cost-b.cost);
      // Retain multiple distinct branch geometries, not dozens of equivalent
      // branches differing only by tiny offsets along the same edge.
      const seen=new Set<string>();const trimmed:State[]=[];
      for(const entry of next){
        const key=entry.items.map(c=>c.lead+':'+c.sideId+'/'+c.slot).join('|');
        if(seen.has(key))continue;
        seen.add(key);trimmed.push(entry);
        if(trimmed.length>=width)break;
      }
      beam=trimmed;
    }
    return beam[0]||null;
  };
  // Constrained centers first, then chronological/reverse passes. Longer
  // leaders are naturally selected when a closer slot causes crossings.
  const tight=[...ordered].sort((a,b)=>(candidates.get(a.lead)?.length||0)-(candidates.get(b.lead)?.length||0)||a.lead-b.lead);
  const tries=[tight,ordered,[...ordered].reverse()];
  let best:State|null=null;
  for(const order of tries){
    const found=solve(order,24);
    if(found&&(!best||found.cost<best.cost))best=found;
  }
  if(!best && useAdaptive){
    // The operational chart-relative ring is preferred, but the original
    // larger perimeter has proven zero-crossing solutions for broad tracks.
    // Before relaxing ANY line constraint, retry that legacy candidate space.
    return planNmcCallouts(anchors,obstacles,false);
  }
  if(!best){
    // There are maps with almost coincident forecast fixes. Never silently
    // drop an information box when the zero-crossing search is exhausted.
    // Fallback still forbids box collisions and straight-leader bends; only
    // line crossings may be reluctantly admitted as an absolute last resort.
    const chosen:Candidate[]=[];
    for(const anchor of tight){
      const choices=candidates.get(anchor.lead)||[];
      let bestCandidate:Candidate|undefined;
      let bestScore=Infinity;
      for(const candidate of choices){
        if(chosen.some(o=>rectanglesOverlap(o,candidate,LABEL_GAP)))continue;
        let penalty=candidate.baseCost;
        for(const previous of chosen){
          if(lineIntersectsLine(candidate.route[0],candidate.route[1],previous.route[0],previous.route[1]))penalty+=100000;
          if(lineHitsRect(candidate.route[0],candidate.route[1],previous,4)||lineHitsRect(previous.route[0],previous.route[1],candidate,4))penalty+=25000;
          if(sameLineCrowding(candidate.route[0],candidate.route[1],previous.route[0],previous.route[1]))penalty+=3500;
        }
        if(penalty<bestScore){bestScore=penalty;bestCandidate=candidate;}
      }
      if(bestCandidate)chosen.push(bestCandidate);
    }
    best={items:chosen,cost:Infinity};
  }
  const byLead=new Map(best.items.map(c=>[c.lead,c]));
  return anchors.flatMap(a=>{
    const b=byLead.get(a.lead);
    return b?[{lead:a.lead,x:b.x,y:b.y,w:b.w,h:b.h,side:b.side,route:b.route}]:[];
  });
}
function layoutLabels(ctx:CanvasRenderingContext2D, o:NmcChartOptions, pts:NmcChartPoint[], project:(lat:number,lon:number)=>XY, wrap:(lon:number)=>number) {
  const items:ForecastLabel[]=[];
  const labelHours:number[]=[];
  if(o.showInfoBoxes && o.showCenterBox)labelHours.push(0);
  if(o.showInfoBoxes && o.showForecastBox && pts.length>1){
    const lastLead=Math.min(o.forecastHours,pts[pts.length-1].simHour-o.issueHour);
    labelHours.push(...nmcOperationalLeadHours(lastLead).slice(1));
    // Include a non-standard final advisory fix when 7-grade termination
    // falls between scheduled issues; never omit the terminal box.
    if(lastLead>0 && !labelHours.some(h=>Math.abs(h-lastLead)<1e-5))labelHours.push(lastLead);
  }
  labelHours.sort((a,b)=>a-b);
  for(const lead of labelHours) {
    const pt=lead===0?o.current:interpolateForecastPoint(pts,o.issueHour+lead);
    if(!pt)continue;
    const date=nextDate(o.issueDate,lead);
    const published = cmaNmcAssessment(pt.vmax, pt.category);
    const lines:[string,string,string]=[dayClock(date),`${published.wind}m/s,${published.wind >= 62 ? "17级以上" : `${published.force}级`}`,published.name];
    ctx.font=font(18);
    const w=Math.max(132,...lines.map(line=>ctx.measureText(line).width+24));
    const p=project(pt.lat,wrap(pt.lon));
    items.push({p,lines,w,h:76,lead,route:[],box:{x:0,y:0,w,h:76}});
  }
  if(!items.length)return;
  const observed=o.history.filter(p=>valid(p)&&p.simHour<=o.issueHour).sort((a,b)=>a.simHour-b.simHour);
  const history=observed.slice(1).map((p,i)=>({a:project(observed[i].lat,wrap(observed[i].lon)),b:project(p.lat,wrap(p.lon))}));
  const straight=nmcStraightFixes(pts,o.issueHour);
  const forecast=straight.slice(1).map((p,i)=>({a:project(straight[i].lat,wrap(straight[i].lon)),b:project(p.lat,wrap(p.lon))}));
  // Match the opaque union cone used by the renderer instead of substituting
  // a different uncertainty estimate only for label placement.
  const cone=forecast.length ? getNmcConeSections(straight,project,wrap,o.issueHour) : [];
  const boxes=planNmcCallouts(items.map(item=>({x:item.p.x,y:item.p.y,width:item.w,lead:item.lead})),{history,forecast,cone});
  for(const item of items){
    const b=boxes.find(rect=>rect.lead===item.lead);
    if(b){item.box={x:b.x,y:b.y,w:b.w,h:b.h};item.route=b.route||[item.p,calloutConnector(item.p,item.box)];}
  }
  // Leaders first, boxes afterward. Rounded ends and slight translucency
  // keep thin black indicators legible without dominating the magenta path.
  ctx.save();ctx.lineWidth=1.05;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle='#34373b';ctx.setLineDash([]);
  for(const item of items){
    const route=item.route;
    if(route.length<2)continue;
    ctx.beginPath();ctx.moveTo(route[0].x,route[0].y);
    for(let i=1;i<route.length;i++)ctx.lineTo(route[i].x,route[i].y);
    ctx.stroke();
  }
  for(const item of items){
    const r=item.box;rounded(ctx,r.x,r.y,r.w,r.h,6);
    // Reference callouts reveal coastlines and grid through a pale blue-white fill.
    ctx.fillStyle='rgba(239,248,252,.78)';ctx.fill();
    ctx.strokeStyle='#46545a';ctx.lineWidth=1.1;ctx.stroke();
    ctx.fillStyle=BLACK;ctx.font=font(18);
    ctx.textAlign='center';ctx.textBaseline='middle';
    item.lines.forEach((line,i)=>ctx.fillText(line,r.x+r.w/2,r.y+15+i*23,r.w-9));
  }
  ctx.restore();
}
function drawLegend(ctx: CanvasRenderingContext2D, forecast: NmcChartPoint[]) {
  const etLegend = forecast.some(p=>isNmcExtratropical(p.category));
  const box:Rect = etLegend ? {x:5,y:958,w:1285,h:136} : {x:5,y:969,w:1285,h:108};
  ctx.fillStyle='#fff';ctx.fillRect(box.x,box.y,box.w,box.h);
  ctx.strokeStyle='#333';ctx.lineWidth=.9;ctx.strokeRect(box.x+.5,box.y+.5,box.w-1,box.h-1);
  ctx.beginPath();ctx.moveTo(1085,box.y);ctx.lineTo(1085,box.y+box.h);ctx.stroke();
  ctx.fillStyle=BLACK;ctx.font=font(20);ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText('图例:',23,1000);
  ctx.fillStyle=PALETTE.cone;ctx.beginPath();ctx.ellipse(109,996,11,8,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=BLACK;ctx.font=font(18);
  ctx.fillText('台风中心未来可能经过的区域，并不表示台风大小及影响范围,灾害性天气也可能出现在阴影区以外',130,998,934);
  const list=[
    {text:'热带低压(10.8~17.1m/s)',color:PALETTE.td},
    {text:'热带风暴(17.2~24.4m/s)',color:PALETTE.ts},
    {text:'强热带风暴(24.5~32.6m/s)',color:PALETTE.sts},
    {text:'台风(32.7~41.4m/s)',color:PALETTE.ty},
    {text:'强台风(41.5~50.9m/s)',color:PALETTE.sty},
    {text:'超强台风(≥51m/s)',color:PALETTE.super},
  ];
  ctx.font=font(18);
  list.forEach((cat,i)=>{
    const x=107+(i%3)*330,y=1026+Math.floor(i/3)*33;
    pin(ctx,x,y,6.5,cat.color,'white');ctx.fillStyle=BLACK;ctx.fillText(cat.text,x+11,y);
  });
  if(forecast.some(p=>isNmcExtratropical(p.category))) {
    // Dedicated third legend row; the six tropical categories stay at their
    // original coordinates for non-ET advisories.
    ctx.fillStyle='#fff';ctx.fillRect(72,1072,268,21);
    pin(ctx,107,1082,6.5,PALETTE.et);ctx.fillStyle=BLACK;ctx.font=font(16);ctx.fillText('温带气旋',120,1082);
  }
  ctx.font=font(17);ctx.fillStyle='#222';ctx.fillText('模拟产品，仅供娱乐',1096,1033,193);
}

/** The same base-map, forecast and label stages are shared by preview/export.
 * The cooperative form yields between vector batches, so an expensive mainland
 * coastline can never monopolize the UI until the PNG encoder is reached. */
function prepareNmcDrawing(o: NmcChartOptions) {
  const canvas = o.canvas;
  const width = Math.max(320, Math.round(o.width));
  const height = Math.round(width * BASE_H / BASE_W);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  if (canvas.width !== width || canvas.height !== height) throw new Error('NMC 画布分配失败，请调低分辨率');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NMC 画布内存不足，请调低分辨率');
  ctx.setTransform(width / BASE_W, 0, 0, width / BASE_W, 0, 0);
  const terminated = nmcIssuedPointsForChart(o);
  drawAgencyStyleHeader(ctx, o);
  const history = o.history.filter(valid);
  const forecast = terminated.slice(1);
  const frame = buildNmcGeoFrame(o.current, history, forecast,
    o.coastlineGeoJson?.features?.length ? o.coastlineGeoJson : o.landGeoJson,
    MAP, o.countriesGeoJson);
  const centerLon = (frame.minLon + frame.maxLon) / 2;
  const wrap = (lon:number) => unwrappedLon(lon, centerLon);
  const project = (lat:number,lon:number): XY => nmcProjectPoint(lat,lon,frame,MAP);
  return { ctx, history, forecast, frame, wrap, project };
}
function finishNmcDrawing(o: NmcChartOptions, state: ReturnType<typeof prepareNmcDrawing>) {
  const {ctx, forecast, frame, project, wrap} = state;
  ctx.save(); ctx.beginPath(); ctx.rect(MAP.x,MAP.y,MAP.w,MAP.h); ctx.clip();
  drawHistory(ctx,o,project,wrap);
  const pts=drawForecast(ctx,{...o,forecast},project,wrap);
  layoutLabels(ctx,o,pts,project,wrap);
  ctx.restore();
  drawMapLogo(ctx);
  ctx.fillStyle=PALETTE.blue;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=font(26,true);ctx.fillText('晚风气象台',1165,131,210);
  ctx.font=font(21,true);ctx.fillText(`${o.issueDate.getMonth()+1}月${o.issueDate.getDate()}日${String((o.issueDate.getHours()+1)%24).padStart(2,'0')}时制作`,1165,161,205);
  drawGridMargins(ctx,frame,project);
  drawLegend(ctx,forecast);
  ctx.setTransform(1,0,0,1,0,0);
}

/** Kept synchronous for existing standalone renderers and legacy tests. */
export function drawNmcForecastProduct(o: NmcChartOptions) {
  const state=prepareNmcDrawing(o);
  drawBaseMap(state.ctx,o,state.frame,state.project);
  finishNmcDrawing(o,state);
}

/** Browser-friendly NMC rendering, with cancellable vector passes.
 * Unlike a timeout around synchronous drawing, cancellation actually stops
 * the geometry before the next batch and never encodes a partial white image. */
export async function drawNmcForecastProductCooperative(
  o: NmcChartOptions,
  options: {signal?: AbortSignal; onProgress?: (progress:number)=>void;
    onWarning?: (message:string)=>void;maxDurationMs?:number;safeFallback?:boolean} = {}
): Promise<void> {
  let contextLost=false;
  const onContextLost=(event:Event)=>{event.preventDefault();contextLost=true;};
  o.canvas.addEventListener?.('contextlost',onContextLost);
  try {
  const cancelled = () => {
    if (options.signal?.aborted) throw new DOMException('Generation cancelled','AbortError');
    if (contextLost) throw new Error('NMC 绘图上下文丢失，请降低分辨率后重试');
  };
  cancelled();
  const state=prepareNmcDrawing(o);
  const steps=drawBaseMapSteps(state.ctx,o,state.frame,state.project,options.onWarning);
  let count=0, lastReported=0;
  const start=typeof performance!=='undefined'?performance.now():Date.now();
  const maxDuration=options.maxDurationMs ?? (o.width<=900?12_000:20_000);
  const exceeded=()=> (typeof performance!=='undefined'?performance.now():Date.now())-start>maxDuration;
  // requestAnimationFrame is intentionally used rather than many microtasks:
  // microtasks do not let browsers paint, process taps, or release old bitmaps.
  const yieldToBrowser = () => new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve,0);
  });
  try {
    for (const _ of steps) {
      cancelled();
      if(exceeded())throw new Error('AETHER_NMC_OVERLAY_TIMEOUT');
      count++;
      if (count % 2 === 0) {
        const progress=Math.min(76, 12 + Math.floor(count * .42));
        if (progress-lastReported >= 4) { options.onProgress?.(progress); lastReported=progress; }
        await yieldToBrowser();
        cancelled();
      }
    }
  } catch(error) {
    // One attempt only. A stalled optional layer may be dropped, but the
    // forecast/historical tracks must still render and remain downloadable.
    if(error instanceof Error&&error.message==='AETHER_NMC_OVERLAY_TIMEOUT' && !options.safeFallback &&
      (o.chinaLandTint!==false||o.overlayNationalBorders!==false||o.overlayChinaProvinces||o.overlayRivers)) {
      steps.return(undefined);
      options.onWarning?.('叠加层耗时过长，已为你关闭叠加层并出图');
      return drawNmcForecastProductCooperative({...o,chinaLandTint:false,overlayNationalBorders:false,
        overlayChinaProvinces:false,overlayRivers:false},{...options,safeFallback:true,maxDurationMs:Math.max(20_000,maxDuration)});
    }
    throw error;
  } finally {
    steps.return(undefined);
  }
  cancelled();
  options.onProgress?.(79);
  await yieldToBrowser();
  cancelled();
  finishNmcDrawing(o,state);
  cancelled();
  options.onProgress?.(89);
  } finally { o.canvas.removeEventListener?.('contextlost',onContextLost); }
}

/** Cheap validation: a completed NMC plate MUST have green WMC header ink.
 * A context may exist on memory-starved mobile GPUs while returning empty or
 * cleared pixels. Detect it before saving what would become an all-white PNG. */
export function hasNmcRenderedContent(canvas: HTMLCanvasElement): boolean {
  if(canvas.width < 320 || canvas.height < 250) return false;
  const ctx=canvas.getContext('2d');
  if (!ctx) return false;
  const scale=canvas.width / BASE_W;
  const x=Math.floor(1150*scale), y=Math.floor(25*scale);
  const w=Math.min(canvas.width-x,Math.max(1,Math.ceil(116*scale)));
  const h=Math.min(canvas.height-y,Math.max(1,Math.ceil(39*scale)));
  try {
    const pixels=ctx.getImageData(x,y,w,h).data;
    for(let i=0;i<pixels.length;i+=4) {
      if(pixels[i] < 70 && pixels[i+1] > 90 && pixels[i+1] > pixels[i]*1.7 && pixels[i+2] < 110 && pixels[i+3]>160) return true;
    }
  } catch { return false; }
  return false;
}
