import type { Typhoon, TyphoonState } from "../types";
import { TyphoonCategory } from "../types";
import { getJtwcSshwsAssessment } from "../simulation/Engine";
import { productLandGeoJson } from "../simulation/NaturalEarthLoader";
import { strokeProductCoastlineRing } from "./ProductCoastlineDrawing";
import { drawBlueMarble2004Equirectangular, drawBlueMarble2004Mercator } from "./BlueMarble2004";
import { createPlateCarreeProjector } from "./MapProjection";

type WikiTrackPoint = TyphoonState & { _wikiLon?: number };

type WikiTrackRenderOptions = {
  signal?: AbortSignal;
  /** Match the brighter, deep-blue Blue Marble tonality commonly used by Wikimedia track maps. */
  referenceColorGrade?: boolean;
  /** Preview mode stays offline with the detailed bundled coastline; export mode fetches Blue Marble 2004 GIBS imagery. */
  highQualityBasemap?: boolean;
  /** Optional Plate Carrée / equirectangular projection. */
  useEquirectangularProjection?: boolean;
};

const WIKI_COLORS = {
  disturbance: "#1591DE",
  td: "#6EC1EA",
  ts: "#4DFFFF",
  c1: "#FFFFD9",
  c2: "#FFD98C",
  c3: "#FF9E59",
  c4: "#FF738A",
  c5: "#A188FC"
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function mercatorYNorm(lat: number) {
  const safe = clamp(lat, -85.05112878, 85.05112878);
  const rad = safe * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function inverseMercatorLat(normY: number) {
  const y = clamp(normY, 0, 1);
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

function unwrapLon(lon: number, anchor: number) {
  let v = lon;
  while (v - anchor > 180) v -= 360;
  while (v - anchor < -180) v += 360;
  return v;
}

function sampleSixHourlyTrack(typhoon: Typhoon): WikiTrackPoint[] {
  const source = (typhoon.history?.length ? typhoon.history : [{
    ...typhoon,
    simHour: Number(typhoon.simHour || 0)
  } as TyphoonState])
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon) && Number.isFinite(h.simHour))
    .slice()
    .sort((a, b) => a.simHour - b.simHour);
  if (!source.length) return [];
  if (source.length === 1) return [{ ...source[0] }];

  const first = source[0].simHour;
  const last = source[source.length - 1].simHour;
  const chosen: TyphoonState[] = [];
  let cursor = 0;
  const pushUnique = (state: TyphoonState) => {
    const prev = chosen[chosen.length - 1];
    if (!prev || Math.abs(prev.simHour - state.simHour) > 1e-5) chosen.push(state);
  };
  pushUnique(source[0]);
  for (let target = first + 6; target < last - 1e-6; target += 6) {
    while (cursor + 1 < source.length && source[cursor + 1].simHour <= target) cursor++;
    const a = source[cursor];
    const b = source[Math.min(source.length - 1, cursor + 1)];
    const pick = Math.abs(a.simHour - target) <= Math.abs(b.simHour - target) ? a : b;
    pushUnique(pick);
  }
  pushUnique(source[source.length - 1]);

  const anchor = chosen[0]?.lon ?? 0;
  return chosen.map((p) => ({ ...p, _wikiLon: unwrapLon(p.lon, anchor) }));
}

function intensityColor(vmaxMps: number) {
  // Wiki C1-C5 markers are SSHWS categories based on JTWC 1-minute sustained wind, not a direct
  // conversion of AETHER's internal CMA-like 2-minute m/s value.
  switch (getJtwcSshwsAssessment(vmaxMps, "public").category) {
    case "C5": return WIKI_COLORS.c5;
    case "C4": return WIKI_COLORS.c4;
    case "C3": return WIKI_COLORS.c3;
    case "C2": return WIKI_COLORS.c2;
    case "C1": return WIKI_COLORS.c1;
    case "TS": return WIKI_COLORS.ts;
    case "TD": return WIKI_COLORS.td;
    default: return WIKI_COLORS.disturbance;
  }
}

function isSubtropical(point: WikiTrackPoint) {
  const anyPoint = point as any;
  const mode = String(anyPoint.structureMode || "").toLowerCase();
  return anyPoint.subtropical === true || mode.includes("subtropical");
}

function pointNature(point: WikiTrackPoint): "circle" | "square" | "triangle" {
  if (isSubtropical(point)) return "square";
  const sshws = getJtwcSshwsAssessment(Number(point.vmax || 0), "public").category;
  const weakOrDepression = sshws === "DISTURBANCE" || sshws === "TD";
  if (
    point.category === TyphoonCategory.ET ||
    point.category === TyphoonCategory.RL ||
    point.category === TyphoonCategory.DS ||
    Number(point.extrTransition || 0) >= 0.82 ||
    Number(point.etHours || 0) > 0 ||
    (point as any).remnantVortex === true ||
    weakOrDepression
  ) return "triangle";
  return "circle";
}

function paintNaturalEarthFallback(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: (lat: number, lon: number) => { x: number; y: number },
  centerLon: number
) {
  ctx.fillStyle = "#08083c";
  ctx.fillRect(0, 0, width, height);
  const geo = productLandGeoJson as any;
  if (!geo?.features?.length) return;
  ctx.save();
  ctx.fillStyle = "#315c21";
  ctx.strokeStyle = "rgba(220,232,210,.36)";
  ctx.lineWidth = Math.max(0.6, width / 3200);
  const drawRing = (ring: any[]) => {
    // Use the bundled detailed product coastline directly. The retired point-thinned preview
    // created long angular chords across bays/islands and was the source of the conspicuous rough
    // coastline seen in several offline products.
    const detailedRing = ring || [];
    let started = false;
    let prevX = 0;
    ctx.beginPath();
    for (const coord of detailedRing) {
      const lon0 = Number(coord?.[0]);
      const lat = Number(coord?.[1]);
      if (!Number.isFinite(lon0) || !Number.isFinite(lat)) continue;
      const lon = unwrapLon(lon0, centerLon);
      const p = project(lat, lon);
      if (started && Math.abs(p.x - prevX) > width * 0.55) {
        started = false;
        continue;
      }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
      prevX = p.x;
    }
    if (started) {
      ctx.closePath();
      ctx.fill();
      strokeProductCoastlineRing(ctx, detailedRing, (lat, lon) => project(lat, unwrapLon(lon, centerLon)));
    }
  };
  for (const f of geo.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "Polygon") (g.coordinates || []).slice(0, 1).forEach(drawRing);
    else if (g.type === "MultiPolygon") (g.coordinates || []).forEach((poly: any) => (poly || []).slice(0, 1).forEach(drawRing));
  }
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shape: "circle" | "square" | "triangle",
  color: string,
  radius: number
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,.20)";
  ctx.lineWidth = Math.max(0.45, radius * 0.12);
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  } else if (shape === "square") {
    ctx.rect(x - radius * 0.88, y - radius * 0.88, radius * 1.76, radius * 1.76);
  } else {
    ctx.moveTo(x, y - radius * 1.08);
    ctx.lineTo(x + radius * 0.98, y + radius * 0.78);
    ctx.lineTo(x - radius * 0.98, y + radius * 0.78);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Wikipedia/Wikimedia tropical-cyclone track-map style.
 * - NASA Blue Marble 2004 imagery (BlueMarble_NextGeneration via NASA GIBS) with the original AETHER Wiki color grade
 * - straight 6-hourly best-track-style segments
 * - new WikiProject Weather/TC intensity palette
 * - shape conveys cyclone nature: tropical circle, subtropical square, ET/remnant/disturbance triangle
 */
export async function drawWikiTrackMap(
  canvas: HTMLCanvasElement,
  typhoon: Typhoon,
  options: WikiTrackRenderOptions = {}
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const points = sampleSixHourlyTrack(typhoon);
  if (!points.length) {
    ctx.fillStyle = "#08083c";
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const lons = points.map((p) => Number(p._wikiLon ?? p.lon));
  const lats = points.map((p) => Number(p.lat));
  let minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const centerLon = (minLon + maxLon) / 2;
  let project: (lat: number, lonInput: number) => { x: number; y: number };
  let viewZoom = 3;
  let centerLatForBasemap = 0;
  let plateCarreeScale = 1;
  let markerPixelsPerDegree = 1;

  if (options.useEquirectangularProjection) {
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let lonSpan = Math.max(4, maxLon - minLon) * 1.24;
    let latSpan = Math.max(4, maxLat - minLat) * 1.24;
    centerLatForBasemap = (minLat + maxLat) / 2;
    plateCarreeScale = Math.max(1e-6, Math.min(width / lonSpan, height / latSpan));
    markerPixelsPerDegree = plateCarreeScale;
    const plate = createPlateCarreeProjector(centerLatForBasemap, centerLon, plateCarreeScale, width, height);
    project = plate.project;
  } else {
    const ys = points.map((p) => mercatorYNorm(p.lat));
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    let lonSpan = Math.max(4, maxLon - minLon);
    let ySpan = Math.max(0.012, maxY - minY);
    const centerY = (minY + maxY) / 2;
    lonSpan *= 1.24;
    ySpan *= 1.24;
    const xNormSpan = lonSpan / 360;
    const targetZoom = Math.log2(Math.max(1e-6, Math.min(
      width / (256 * xNormSpan),
      height / (256 * ySpan)
    )));
    viewZoom = clamp(targetZoom, 2.25, 8.0);
    const worldSize = 256 * Math.pow(2, viewZoom);
    // Wiki symbols represent an approximately fixed geographic footprint.  Scaling from the
    // projected pixels-per-degree makes a zoomed-out map use smaller symbols and a zoomed-in map
    // use larger symbols, instead of tying marker size to export pixel dimensions.
    markerPixelsPerDegree = worldSize / 360;
    const centerXNorm = (centerLon + 180) / 360;
    const centerWorldX = centerXNorm * worldSize;
    const centerWorldY = centerY * worldSize;
    centerLatForBasemap = inverseMercatorLat(centerY);
    project = (lat: number, lonInput: number) => {
      const lon = unwrapLon(lonInput, centerLon);
      const x = ((lon + 180) / 360) * worldSize;
      const y = mercatorYNorm(lat) * worldSize;
      return { x: width / 2 + (x - centerWorldX), y: height / 2 + (y - centerWorldY) };
    };
  }

  // Always establish a deterministic local fallback first, so a failed tile request never yields a blank report.
  paintNaturalEarthFallback(ctx, width, height, project, centerLon);
  if (options.signal?.aborted) return;

  // Preview remains offline but uses the detailed bundled coastline. Only a requested full-resolution generation
  // fetches the Blue Marble 2004 photographic basemap; both modes continue to draw the same track.
  if (options.highQualityBasemap) {
    const useReferenceGrade = options.referenceColorGrade !== false;
    if (useReferenceGrade) {
      ctx.save();
      ctx.filter = "brightness(1.16) contrast(1.04) saturate(1.42)";
    }
    if (options.useEquirectangularProjection) {
      await drawBlueMarble2004Equirectangular(ctx, width, height, centerLatForBasemap, centerLon, plateCarreeScale, true);
    } else {
      // GIBS already returns 512px imagery for each logical 256px tile. Rendering one source zoom
      // below the fitted logical zoom gives roughly 1:1 source pixels at export resolution while
      // reducing WMS request count by about 4x-16x versus the old +1/+2 zoom request storm.
      const complete = await drawBlueMarble2004Mercator(ctx, width, height, centerLatForBasemap, centerLon, viewZoom, -1, true);
      // If the low-request source level could not form a complete atomic plate, retry once at the
      // fitted Mercator source zoom. The complete Natural-Earth fallback stays visible until one
      // entire Blue Marble plate succeeds, so Wiki export can never finish as a half-loaded map.
      if (!complete && !options.signal?.aborted) {
        await drawBlueMarble2004Mercator(ctx, width, height, centerLatForBasemap, centerLon, viewZoom, 0, true);
      }
    }
    if (useReferenceGrade) ctx.restore();
    if (options.signal?.aborted) return;
    if (useReferenceGrade) {
      ctx.save();
      // Wikipedia track maps generally use a deeper navy ocean and noticeably greener/brighter
      // land than raw Blue Marble.  Keep the grade deterministic and global (no local masks), but
      // separate the vegetation lift from the navy-ocean lift so the result stays closer to the
      // reference without washing coastlines into cyan.
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(42, 112, 18, 0.13)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(0, 0, 48, 0.38)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    ctx.fillStyle = "rgba(1, 7, 28, .025)";
    ctx.fillRect(0, 0, width, height);
  }

  const screenPoints = points.map((p) => ({ p, xy: project(p.lat, Number(p._wikiLon ?? p.lon)) }));
  // Keep symbol sizes consistent with the default-resolution export even when the user
  // raises the output resolution.  Higher clarity should increase detail, not inflate markers.
  const defaultVisualScale = clamp(Math.min(width / 1280, height / 720), 0.45, 1);
  const lineWidth = clamp(Math.min(width, height) / 470, 1.45, 5.4);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.96)";
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  screenPoints.forEach(({ xy }, i) => i === 0 ? ctx.moveTo(xy.x, xy.y) : ctx.lineTo(xy.x, xy.y));
  ctx.stroke();
  ctx.restore();

  // Fixed geographic symbol footprint (~0.46° radius) rather than a fixed fraction of the image.
  // Keep the Wiki symbols readable on basin-wide products without allowing high-resolution exports
  // to turn them into oversized dots. 5.2.20 slightly raises both the nominal footprint and floor.
  const markerRadius = clamp(markerPixelsPerDegree * 0.50, 5.8, 18.2);
  for (const { p, xy } of screenPoints) {
    drawMarker(ctx, xy.x, xy.y, pointNature(p), intensityColor(Number(p.vmax || 0)), markerRadius);
  }
}

export const WIKI_TRACK_INTENSITY_COLORS = WIKI_COLORS;
