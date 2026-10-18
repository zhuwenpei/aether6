import type { Typhoon, TyphoonState } from "../types";
import { calculateStationReadings, calculateStationStormSurge } from "../simulation/Engine";
import { getTyphoonNamingSimHour, PRE_NAMING_TD_LABEL } from "./TyphoonDisplayName";

export type StationChartMetric = "wind" | "pressure" | "precipitation" | "surge";

export interface StationReportOptions {
  showMaxWind: boolean;
  showMaxGust: boolean;
  showMinPressure: boolean;
  showMaxSurge: boolean;
  showCasualties: boolean;
  showCityName: boolean;
  chartCount: 1 | 2 | 3;
  charts: StationChartMetric[];
}

export interface StationReportPoint {
  simHour: number;
  date: Date;
  wind: number;
  gust: number;
  pressure: number;
  precipitation: number;
  surge: number;
  casualties: number;
}

export interface StationReportDataset {
  station: { id: string; name: string; lat: number; lon: number; temporary?: boolean; sourceName?: string };
  typhoonName: string;
  officialTyphoonName: string;
  namingHour: number | null;
  /** Observation target for each storm, preserved when the season report merges histories. */
  observedStorms?: Array<{ firstHour: number; lastHour: number; officialName: string; namingHour: number | null }>;
  points: StationReportPoint[];
  firstHour: number;
  currentHour: number;
  startDate: Date;
}

export const DEFAULT_STATION_REPORT_OPTIONS: StationReportOptions = {
  showMaxWind: true,
  showMaxGust: true,
  showMinPressure: true,
  showMaxSurge: true,
  showCasualties: true,
  showCityName: true,
  chartCount: 3,
  charts: ["wind", "pressure", "precipitation"]
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function interpolateNumber(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Build one shared station dataset for the detail page and report image.
 * Station observations are re-diagnosed with calculateStationReadings for every historical
 * cyclone state, so the current multi-mechanism precipitation model is used everywhere rather
 * than only in the rainfall-map product. Stored casualties are retained because casualties are
 * a simulation accounting field, not a meteorological diagnostic.
 */
export function buildStationReportDataset(
  station: StationReportDataset["station"],
  typhoon: Typhoon,
  startDate: Date
): StationReportDataset {
  const currentHour = Number.isFinite(typhoon.simHour) ? typhoon.simHour : 0;
  const states = [...(typhoon.history || [])]
    .filter((h: TyphoonState) => Number.isFinite(h?.simHour) && h.simHour <= currentHour + 1e-6)
    .sort((a, b) => a.simHour - b.simHour);

  if (!states.length) {
    states.push({ ...(typhoon as any), simHour: currentHour } as TyphoonState);
  }

  const points: StationReportPoint[] = [];
  let previous: any[] | undefined;
  // A station can have a user-facing alias from the detail page.  Historical stationReadings,
  // however, are keyed by the station's original simulation name.  Keeping those identities
  // separate prevents the report/video rebuild from missing the stored casualty allocation and
  // silently replacing it with the default single-station value of zero.
  const sourceName = station.sourceName || station.name;
  const diagnosticStation = { name: sourceName, lat: station.lat, lon: station.lon, threshold: 0 };
  let lastKnownCasualties = 0;
  for (const state of states) {
    const stored = state.stationReadings?.find((r: any) => r.name === sourceName || r.name === station.name);
    let row: any = stored?.diagnosticVersion === "round124-eye-v2" ? { ...stored } : undefined;
    if (!row) {
      try {
        row = calculateStationReadings(
          Number(state.lat), Number(state.lon), Number(state.vmax), Number(state.pmin), Number(state.rmw || 35),
          state.r7, state.r10, state.r12, previous, 0,
          state.eyeRadiusKm, state.eyeClearance,
          { ...state, simHour: state.simHour, config: (state as any).configSnapshot } as any,
          [diagnosticStation]
        )[0];
      } catch {
        row = undefined;
      }
    }
    if (!row && stored) row = stored;
    if (!row) continue;

    // Casualties are an accounting field, not a meteorological diagnostic.  Prefer the persisted
    // per-station allocation from the simulation history; if an old/renamed sample has no matching
    // reading, carry forward the last known cumulative value rather than resetting the chart/report
    // to zero while wind/rain/surge are being re-diagnosed.
    if (stored && Number.isFinite(Number((stored as any).casualties))) {
      lastKnownCasualties = Math.max(lastKnownCasualties, Number((stored as any).casualties));
    }
    row.casualties = Math.max(lastKnownCasualties, Number(row.casualties || 0));

    const surge = Math.max(
      Number(row.stormSurge || 0),
      calculateStationStormSurge(
        diagnosticStation, state.lat, state.lon, state.pmin, state.rmw || 35, state.r7,
        Number(row.windSpeed || 0), Number(row.pressure || 1013), state as any
      )
    );
    const wind = Math.max(0, Number(row.windSpeed || 0));
    const fallbackGust = wind * (1.16 + 0.18 * Math.min(1, wind / 38));
    const gust = Math.max(wind, Number.isFinite(Number(row.gustSpeed)) ? Number(row.gustSpeed) : fallbackGust);

    points.push({
      simHour: Number(state.simHour),
      date: new Date(startDate.getTime() + Number(state.simHour) * 3600000),
      wind,
      gust,
      pressure: Number(row.pressure || 1013),
      precipitation: Math.max(0, Number(row.precipitation || 0)),
      surge: Math.max(0, Number(surge || 0)),
      casualties: Math.max(0, Number(row.casualties || 0))
    });
    previous = [row];
  }

  return {
    station,
    typhoonName: typhoon.name || "无名",
    officialTyphoonName: typhoon.name || "无名",
    namingHour: getTyphoonNamingSimHour(typhoon, startDate),
    points,
    firstHour: points[0]?.simHour ?? 0,
    currentHour: points[points.length - 1]?.simHour ?? currentHour,
    startDate
  };
}

/** Resolve the observed cyclone at a report frame instead of losing its naming latch
 * when several archived tracks are merged into a whole-season station dataset. */
export function getStationReportObservationTarget(dataset: StationReportDataset, playbackHour: number): string {
  const storms = dataset.observedStorms;
  if (storms?.length) {
    // If histories overlap, use the most recently formed system valid at this hour.
    const storm = [...storms].reverse().find((item) =>
      playbackHour + 1e-6 >= item.firstHour && playbackHour <= item.lastHour + 1e-6
    );
    if (!storm) return "整个风季";
    return storm.namingHour !== null && playbackHour + 1e-6 >= storm.namingHour
      ? storm.officialName : PRE_NAMING_TD_LABEL;
  }
  if (dataset.officialTyphoonName === "整个风季") return "整个风季";
  return dataset.namingHour !== null && playbackHour + 1e-6 >= dataset.namingHour
    ? dataset.officialTyphoonName : PRE_NAMING_TD_LABEL;
}

export function interpolateStationReportPoint(dataset: StationReportDataset, playbackHour: number): StationReportPoint | null {
  const pts = dataset.points;
  if (!pts.length) return null;
  if (playbackHour <= pts[0].simHour) return { ...pts[0], date: new Date(pts[0].date) };
  if (playbackHour >= pts[pts.length - 1].simHour) return { ...pts[pts.length - 1], date: new Date(pts[pts.length - 1].date) };
  let i = 1;
  while (i < pts.length && pts[i].simHour < playbackHour) i++;
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i)];
  const t = clamp((playbackHour - a.simHour) / Math.max(1e-6, b.simHour - a.simHour), 0, 1);
  return {
    simHour: playbackHour,
    date: new Date(dataset.startDate.getTime() + playbackHour * 3600000),
    wind: interpolateNumber(a.wind, b.wind, t),
    gust: interpolateNumber(a.gust, b.gust, t),
    pressure: interpolateNumber(a.pressure, b.pressure, t),
    precipitation: interpolateNumber(a.precipitation, b.precipitation, t),
    surge: interpolateNumber(a.surge, b.surge, t),
    casualties: Math.round(interpolateNumber(a.casualties, b.casualties, t))
  };
}

function visiblePoints(dataset: StationReportDataset, playbackHour: number) {
  const pts = dataset.points.filter((p) => p.simHour <= playbackHour + 1e-7).map((p) => ({ ...p }));
  const interp = interpolateStationReportPoint(dataset, playbackHour);
  if (interp && (!pts.length || Math.abs(pts[pts.length - 1].simHour - interp.simHour) > 1e-6)) pts.push(interp);
  return pts;
}

function stationSeed(name: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Small deterministic display-only sub-hour texture. Both still image and video call this
// renderer, so the same time/station always produces exactly the same micro-variation.
function visualJitter(t: number, seed: number) {
  return (
    Math.sin(t * 2.17 + seed * 11.3) * 0.46 +
    Math.cos(t * 4.91 - seed * 7.7) * 0.29 +
    Math.sin(t * 10.37 + seed * 5.9) * 0.17 +
    Math.cos(t * 19.13 - seed * 3.1) * 0.08
  );
}

function formatTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function drawSmoothLine(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) { ctx.lineTo(points[0].x + 0.01, points[0].y); ctx.stroke(); return; }
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function getPanelGeometry(px: number, py: number, pw: number, ph: number, scale: number) {
  const left = px + 82 * scale;
  const right = px + pw - 24 * scale;
  const top = py + 54 * scale;
  const bottom = py + ph - 42 * scale;
  return { left, right, top, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, scale: number) {
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeRect(px, py, pw, ph);
}

function drawPanelGrid(ctx: CanvasRenderingContext2D, g: ReturnType<typeof getPanelGeometry>, scale: number) {
  ctx.strokeStyle = "#e8edf3";
  ctx.lineWidth = 1 * scale;
  for (let i = 0; i <= 4; i++) {
    const y = g.top + (g.height * i) / 4;
    ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke();
  }
}

function displayWind(point: StationReportPoint, seed: number) {
  const a = Math.min(0.26, 0.011 * Math.max(5, point.wind));
  return Math.max(0, point.wind + visualJitter(point.simHour, seed) * a);
}
function displayGust(point: StationReportPoint, seed: number) {
  const a = Math.min(0.30, 0.009 * Math.max(7, point.gust));
  return Math.max(displayWind(point, seed), point.gust + visualJitter(point.simHour + 0.37, seed + 0.19) * a);
}
function displayPressure(point: StationReportPoint, seed: number) {
  return point.pressure + visualJitter(point.simHour + 0.63, seed + 0.47) * 0.04;
}

function drawTimelineTicks(
  ctx: CanvasRenderingContext2D,
  plotLeft: number,
  axisY: number,
  data: StationReportPoint[],
  stepW: number,
  scale: number
) {
  if (!data.length) return;
  ctx.fillStyle = "#475569";
  ctx.font = `bold ${Math.round(13 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const stride = Math.max(1, Math.ceil(data.length / 7));
  const indices = new Set<number>();
  for (let i = 0; i < data.length; i += stride) indices.add(i);
  indices.add(data.length - 1);
  [...indices].sort((a, b) => a - b).forEach((i) => {
    const d = data[i];
    const x = plotLeft + i * stepW;
    ctx.strokeStyle = "#64748b"; ctx.lineWidth = 1.2 * scale;
    ctx.beginPath(); ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 6 * scale); ctx.stroke();
    const dayStr = d.date.getUTCDate().toString().padStart(2, "0");
    const hourStr = d.date.getUTCHours().toString().padStart(2, "0");
    ctx.textAlign = i === 0 ? "left" : i === data.length - 1 ? "right" : "center";
    ctx.fillText(`${dayStr} ${hourStr}:00`, x, axisY + 8 * scale);
  });
}

function drawWindPanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, data: StationReportPoint[], scale: number, seed: number) {
  const g = getPanelGeometry(px, py, pw, ph, scale);
  const maxWind = Math.max(...data.map(d => displayWind(d, seed)), 0);
  const maxGust = Math.max(...data.map(d => displayGust(d, seed)), maxWind, 1);
  const maxAxis = Math.max(15, Math.ceil((maxGust * 1.12) / 5) * 5);
  const stepW = g.width / Math.max(1, data.length - 1);
  drawPanelFrame(ctx, px, py, pw, ph, scale); drawPanelGrid(ctx, g, scale);

  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.fillText("Wind Speed (m/s)", g.left, py + 25 * scale);

  const legendFont = `bold ${Math.round(15 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.font = legendFont;
  const meanText = "Mean Wind", gustText = "Gust", swatch = 24 * scale, gap = 8 * scale, itemGap = 22 * scale;
  const meanW = swatch + gap + ctx.measureText(meanText).width;
  const gustW = swatch + gap + ctx.measureText(gustText).width;
  let lx = g.right - meanW - itemGap - gustW, ly = py + 25 * scale;
  ctx.strokeStyle = "#111827"; ctx.lineWidth = 3 * scale; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + swatch, ly); ctx.stroke();
  ctx.fillStyle = "#1e293b"; ctx.fillText(meanText, lx + swatch + gap, ly);
  lx += meanW + itemGap;
  ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 2.4 * scale; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + swatch, ly); ctx.stroke();
  ctx.fillStyle = "#1e293b"; ctx.fillText(gustText, lx + swatch + gap, ly);

  ctx.font = `bold ${Math.round(14 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillStyle = "#334155"; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round(maxAxis * (1 - i / 4))), g.left - 12 * scale, g.top + g.height * i / 4);
  const yFor = (v: number) => g.bottom - (Math.max(0, v) / maxAxis) * g.height;
  const drawLine = (getter: (d: StationReportPoint) => number, color: string, width: number, dots: boolean) => {
    ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.width, g.height); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width * scale; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    data.forEach((d, i) => { const x = g.left + i * stepW, y = yFor(getter(d)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
    if (dots) { ctx.fillStyle = color; data.forEach((d, i) => { if (data.length > 160 && i % 2) return; ctx.beginPath(); ctx.arc(g.left + i * stepW, yFor(getter(d)), 3.2 * scale, 0, Math.PI * 2); ctx.fill(); }); }
    ctx.restore();
  };
  drawLine(d => displayGust(d, seed), "#dc2626", 2.2, false);
  drawLine(d => displayWind(d, seed), "#111827", 3.0, true);
  drawTimelineTicks(ctx, g.left, g.bottom, data, stepW, scale);
}

function drawPressurePanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, data: StationReportPoint[], scale: number, seed: number) {
  const g = getPanelGeometry(px, py, pw, ph, scale);
  const vals = data.map(d => displayPressure(d, seed));
  const maxP = Math.max(...vals, 1013), minP = Math.min(...vals, 1013);
  const maxPAxis = Math.max(1020, Math.ceil((maxP + 2) / 5) * 5);
  const minPAxis = Math.floor((minP - 4) / 5) * 5;
  const rangeP = Math.max(15, maxPAxis - minPAxis);
  const stepW = g.width / Math.max(1, data.length - 1);
  drawPanelFrame(ctx, px, py, pw, ph, scale); drawPanelGrid(ctx, g, scale);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillText("Pressure (hPa)", g.left, py + 25 * scale);
  const label = "Sea-level Pressure"; ctx.font = `bold ${Math.round(15 * scale)}px "Times New Roman", "Songti SC", serif`;
  const swatch = 24 * scale, gap = 8 * scale, itemW = swatch + gap + ctx.measureText(label).width, lx = g.right - itemW, ly = py + 25 * scale;
  ctx.strokeStyle = "#111827"; ctx.lineWidth = 3 * scale; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + swatch, ly); ctx.stroke(); ctx.fillStyle = "#1e293b"; ctx.fillText(label, lx + swatch + gap, ly);
  ctx.font = `bold ${Math.round(14 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillStyle = "#334155"; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round(maxPAxis - rangeP * i / 4)), g.left - 12 * scale, g.top + g.height * i / 4);
  const yFor = (v: number) => g.bottom - ((v - minPAxis) / rangeP) * g.height;
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.width, g.height); ctx.clip(); ctx.strokeStyle = "#111827"; ctx.lineWidth = 3 * scale; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
  data.forEach((d, i) => { const x = g.left + i * stepW, y = yFor(displayPressure(d, seed)); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  ctx.fillStyle = "#111827"; data.forEach((d, i) => { if (data.length > 160 && i % 2) return; ctx.beginPath(); ctx.arc(g.left + i * stepW, yFor(displayPressure(d, seed)), 3.2 * scale, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
  drawTimelineTicks(ctx, g.left, g.bottom, data, stepW, scale);
}

function drawPrecipitationPanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, data: StationReportPoint[], scale: number) {
  const g = getPanelGeometry(px, py, pw, ph, scale);
  const peak = Math.max(...data.map(d => Number(d.precipitation || 0)), 1);
  const maxPrecip = Math.max(10, Math.ceil((peak * 1.12) / 5) * 5);
  const stepW = g.width / Math.max(1, data.length - 1);
  drawPanelFrame(ctx, px, py, pw, ph, scale); drawPanelGrid(ctx, g, scale);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillText("Precipitation (mm/h)", g.left, py + 25 * scale);
  ctx.font = `bold ${Math.round(14 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillStyle = "#334155"; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) ctx.fillText(String(Math.round(maxPrecip * (1 - i / 4))), g.left - 12 * scale, g.top + g.height * i / 4);
  const barW = Math.max(2.5 * scale, Math.min(10 * scale, stepW * 0.72));
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.width, g.height); ctx.clip();
  data.forEach((d, i) => { const val = Math.max(0, Number(d.precipitation || 0)); if (val <= 0) return; const bh = (val / maxPrecip) * g.height; ctx.fillStyle = "#2563eb"; ctx.fillRect(g.left + i * stepW - barW / 2, g.bottom - bh, barW, bh); }); ctx.restore();
  drawTimelineTicks(ctx, g.left, g.bottom, data, stepW, scale);
}

function drawSurgePanel(ctx: CanvasRenderingContext2D, px: number, py: number, pw: number, ph: number, data: StationReportPoint[], scale: number) {
  const g = getPanelGeometry(px, py, pw, ph, scale);
  const peak = Math.max(...data.map(d => Number(d.surge || 0)), 0.1);
  const maxAxis = Math.max(0.5, Math.ceil((peak * 1.15) * 2) / 2);
  const stepW = g.width / Math.max(1, data.length - 1);
  drawPanelFrame(ctx, px, py, pw, ph, scale); drawPanelGrid(ctx, g, scale);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillText("Storm Surge (m)", g.left, py + 25 * scale);
  const label = "Storm Surge"; ctx.font = `bold ${Math.round(15 * scale)}px "Times New Roman", "Songti SC", serif`;
  const swatch = 24 * scale, gap = 8 * scale, itemW = swatch + gap + ctx.measureText(label).width, lx = g.right - itemW, ly = py + 25 * scale;
  ctx.strokeStyle = "#111827"; ctx.lineWidth = 3 * scale; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + swatch, ly); ctx.stroke(); ctx.fillStyle = "#1e293b"; ctx.fillText(label, lx + swatch + gap, ly);
  ctx.font = `bold ${Math.round(14 * scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillStyle = "#334155"; ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) ctx.fillText((maxAxis * (1 - i / 4)).toFixed(1), g.left - 12 * scale, g.top + g.height * i / 4);
  const yFor = (v: number) => g.bottom - (Math.max(0, v) / maxAxis) * g.height;
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.width, g.height); ctx.clip(); ctx.strokeStyle = "#111827"; ctx.lineWidth = 3 * scale; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
  data.forEach((d, i) => { const x = g.left + i * stepW, y = yFor(d.surge); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  ctx.fillStyle = "#111827"; data.forEach((d, i) => { if (data.length > 160 && i % 2) return; ctx.beginPath(); ctx.arc(g.left + i * stepW, yFor(d.surge), 3.2 * scale, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
  drawTimelineTicks(ctx, g.left, g.bottom, data, stepW, scale);
}

/**
 * 3.5.9 restores the 3.5.7 station-report visual grammar.  The only new visual
 * element is Storm Surge, intentionally drawn as the same framed line-chart style.
 * In 3.6.1 its curve/markers use neutral black to match the requested report convention.
 *
 * For video frames the currently revealed point is always placed at the RIGHT edge.
 * The time axis therefore expands/zooms out as playback advances instead of drawing
 * into a pre-reserved future timeline.
 */
export function drawStationReportCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dataset: StationReportDataset,
  options: StationReportOptions,
  playbackHour: number = dataset.currentHour
) {
  const clampedHour = clamp(playbackHour, dataset.firstHour, dataset.currentHour);
  const data = visiblePoints(dataset, clampedHour);
  const current = data[data.length - 1] || dataset.points[dataset.points.length - 1];
  if (!current) return;
  const station = dataset.station;
  const scale = width / 1920;
  const seed = stationSeed(`${station.name}:${station.lat.toFixed(3)}:${station.lon.toFixed(3)}`);
  const serifFont = `"Times New Roman", "Songti SC", "Noto Serif CJK SC", serif`;

  ctx.save();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 3 * scale; ctx.strokeRect(20 * scale, 20 * scale, width - 40 * scale, height - 40 * scale);

  const maxWindSpeed = Math.max(...data.map(d => displayWind(d, seed)), 0);
  const maxGustSpeed = Math.max(...data.map(d => displayGust(d, seed)), 0);
  const minPressure = Math.min(...data.map(d => displayPressure(d, seed)), 1013);
  const maxStormSurge = Math.max(...data.map(d => d.surge || 0), 0);
  const stationCasualties = Math.max(...data.map(d => d.casualties || 0), 0);

  const padX = 90 * scale;
  let curY = 48 * scale;
  ctx.fillStyle = "#0f172a"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = `bold ${Math.round(40 * scale)}px ${serifFont}`;
  ctx.fillText(`${station.name}气象站`, width / 2, curY);
  curY += 54 * scale;
  ctx.font = `${Math.round(19 * scale)}px ${serifFont}`; ctx.fillStyle = "#334155";
  const place = options.showCityName ? `Location: ${station.lon.toFixed(2)}°E, ${station.lat.toFixed(2)}°N` : "Location: hidden";
  const displayTyphoonName = getStationReportObservationTarget(dataset, clampedHour);
  ctx.fillText(`${place}   |   Typhoon: ${displayTyphoonName}`, width / 2, curY);
  curY += 36 * scale;
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1.2 * scale; ctx.beginPath(); ctx.moveTo(padX, curY); ctx.lineTo(width - padX, curY); ctx.stroke();
  curY += 22 * scale;

  const summaryParts: string[] = [];
  if (options.showMaxWind) summaryParts.push(`Max Wind ${maxWindSpeed.toFixed(1)} m/s`);
  if (options.showMaxGust) summaryParts.push(`Max Gust ${maxGustSpeed.toFixed(1)} m/s`);
  if (options.showMinPressure) summaryParts.push(`Min Pressure ${minPressure.toFixed(1)} hPa`);
  if (options.showMaxSurge) summaryParts.push(`Max Storm Surge ${maxStormSurge.toFixed(2)} m`);
  ctx.fillStyle = "#111827"; ctx.font = `600 ${Math.round(21 * scale)}px ${serifFont}`;
  const firstSummary = summaryParts.slice(0, 2).join("   |   ");
  const secondSummary = summaryParts.slice(2).join("   |   ");
  if (firstSummary) { ctx.fillText(firstSummary, width / 2, curY); curY += 31 * scale; }
  if (secondSummary) { ctx.fillText(secondSummary, width / 2, curY); curY += 31 * scale; }
  if (options.showCasualties) {
    ctx.fillStyle = stationCasualties > 0 ? "#7f1d1d" : "#334155";
    ctx.font = `${Math.round(18 * scale)}px ${serifFont}`;
    ctx.fillText(`Estimated Casualties: ${Math.round(stationCasualties)}`, width / 2, curY); curY += 28 * scale;
  }
  curY += 12 * scale;

  const plotLeft = 140 * scale;
  const plotRight = options.showCasualties ? width - 140 * scale : width - 80 * scale;
  const plotWidth = plotRight - plotLeft;
  const plotTop = curY;
  const plotBottom = height - 75 * scale;
  const availableH = Math.max(120 * scale, plotBottom - plotTop);
  const chartCount = clamp(options.chartCount || 1, 1, 3) as 1 | 2 | 3;
  const activeMetrics = Array.from({ length: chartCount }, (_, i) => options.charts[i] || DEFAULT_STATION_REPORT_OPTIONS.charts[i] || "wind");
  const panelGap = 36 * scale;
  const panelH = (availableH - panelGap * (chartCount - 1)) / chartCount;
  let panelY = plotTop;
  for (const metric of activeMetrics) {
    if (metric === "wind") drawWindPanel(ctx, plotLeft, panelY, plotWidth, panelH, data, scale, seed);
    else if (metric === "pressure") drawPressurePanel(ctx, plotLeft, panelY, plotWidth, panelH, data, scale, seed);
    else if (metric === "precipitation") drawPrecipitationPanel(ctx, plotLeft, panelY, plotWidth, panelH, data, scale);
    else drawSurgePanel(ctx, plotLeft, panelY, plotWidth, panelH, data, scale);
    panelY += panelH + panelGap;
  }
  ctx.restore();
}

export function getStationReportCanvasDimensions(
  resolution: "720p" | "1080p" | "2K" | "4K",
  aspect: "16:9" | "4:3" | "1:1" | "9:16"
) {
  const baseHeight = resolution === "720p" ? 720 : resolution === "1080p" ? 1080 : resolution === "2K" ? 1440 : 2160;
  const ratio = aspect === "16:9" ? 16 / 9 : aspect === "4:3" ? 4 / 3 : aspect === "1:1" ? 1 : 9 / 16;
  let height = baseHeight;
  let width = Math.round(height * ratio);
  // Keep mobile/iOS canvases within the broadly supported 4096 px edge while preserving aspect.
  if (Math.max(width, height) > 4096) {
    const k = 4096 / Math.max(width, height);
    width = Math.floor(width * k);
    height = Math.floor(height * k);
  }
  if (width % 2) width -= 1;
  if (height % 2) height -= 1;
  return { width: Math.max(2, width), height: Math.max(2, height) };
}

/**
 * Build a station time series across every cyclone in one simulated season. Cyclone histories use
 * absolute season hours in 3.7.1, so datasets can be merged without inventing per-storm clocks.
 */
export function buildSeasonStationReportDataset(
  station: StationReportDataset["station"],
  typhoons: Typhoon[],
  startDate: Date
): StationReportDataset {
  const ordered = [...typhoons]
    .filter((ty) => (ty.history || []).length > 0)
    .sort((a, b) => Number(a.history?.[0]?.simHour ?? a.seasonStartHour ?? 0) - Number(b.history?.[0]?.simHour ?? b.seasonStartHour ?? 0));
  const merged: StationReportPoint[] = [];
  const observedStorms: NonNullable<StationReportDataset["observedStorms"]> = [];
  let casualtyOffset = 0;

  for (const ty of ordered) {
    const lastHour = ty.history?.[ty.history.length - 1]?.simHour ?? ty.simHour ?? 0;
    // Use the complete simulated history even if the UI is currently rewound to an earlier hour.
    const fullStateTyphoon = { ...ty, simHour: lastHour } as Typhoon;
    const ds = buildStationReportDataset(station, fullStateTyphoon, startDate);
    observedStorms.push({
      firstHour: ds.firstHour, lastHour: ds.currentHour,
      officialName: ds.officialTyphoonName, namingHour: ds.namingHour
    });
    let stormMaxCasualties = 0;
    for (const point of ds.points) {
      stormMaxCasualties = Math.max(stormMaxCasualties, point.casualties);
      merged.push({ ...point, casualties: casualtyOffset + point.casualties });
    }
    casualtyOffset += stormMaxCasualties;
  }

  merged.sort((a, b) => a.simHour - b.simHour);
  const deduped: StationReportPoint[] = [];
  for (const p of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.simHour - p.simHour) < 1e-6) {
      // Sequential seasons should rarely overlap; if they do, retain the more hazardous observation.
      if (p.wind + p.gust + p.precipitation > prev.wind + prev.gust + prev.precipitation) deduped[deduped.length - 1] = p;
    } else deduped.push(p);
  }

  return {
    station,
    typhoonName: "整个风季",
    officialTyphoonName: "整个风季",
    namingHour: null,
    observedStorms,
    points: deduped,
    firstHour: deduped[0]?.simHour ?? 0,
    currentHour: deduped[deduped.length - 1]?.simHour ?? 0,
    startDate
  };
}

/**
 * Select a season time range and adapt visual sampling to the available chart width. Source data
 * remain untouched. Each bucket preserves first/last plus gust/rain/pressure/surge extrema, so long
 * ranges stay readable without flattening hazardous peaks or packing thousands of rainfall bars.
 */
export function selectStationReportRange(
  dataset: StationReportDataset,
  startHour: number,
  endHour: number,
  targetPoints: number = 240
): StationReportDataset {
  const lo = Math.min(startHour, endHour);
  const hi = Math.max(startHour, endHour);
  const raw = dataset.points.filter((p) => p.simHour >= lo - 1e-6 && p.simHour <= hi + 1e-6);
  if (raw.length <= Math.max(24, targetPoints)) {
    return { ...dataset, points: raw, firstHour: lo, currentHour: hi };
  }

  const bucketCount = Math.max(6, Math.floor(targetPoints / 5));
  const span = Math.max(1e-6, hi - lo);
  const selected = new Map<number, StationReportPoint>();
  const keep = (p: StationReportPoint | undefined) => { if (p) selected.set(p.simHour, p); };
  keep(raw[0]); keep(raw[raw.length - 1]);

  for (let b = 0; b < bucketCount; b++) {
    const b0 = lo + span * b / bucketCount;
    const b1 = lo + span * (b + 1) / bucketCount;
    const pts = raw.filter((p) => p.simHour >= b0 && (b === bucketCount - 1 ? p.simHour <= b1 : p.simHour < b1));
    if (!pts.length) continue;
    keep(pts[0]); keep(pts[pts.length - 1]);
    keep(pts.reduce((a, p) => p.gust > a.gust ? p : a));
    keep(pts.reduce((a, p) => p.precipitation > a.precipitation ? p : a));
    keep(pts.reduce((a, p) => p.pressure < a.pressure ? p : a));
    keep(pts.reduce((a, p) => p.surge > a.surge ? p : a));
  }

  return {
    ...dataset,
    points: [...selected.values()].sort((a, b) => a.simHour - b.simHour),
    firstHour: lo,
    currentHour: hi
  };
}
