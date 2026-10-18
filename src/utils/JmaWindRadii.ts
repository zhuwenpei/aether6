/**
 * JMA / Digital-Typhoon style wind-area geometry.
 *
 * JMA wind areas are rendered as true circles whose centres can be displaced.
 * JMA uses 30-kt and 50-kt wind areas. Major-land interaction can contract/shift the
 * analysed circle, while tiny isolated islands are ignored for quadrant-scale squeeze.
 */

export type WindQuadrants = { ne: number; se: number; sw: number; nw: number };
export type JmaWindAreaLevel = "strong" | "storm"; // 30 kt / 50 kt

export interface JmaWindCircleInput {
  lat: number;
  lon: number;
  vmaxCmaMs: number;
  landed: boolean;
  radii: WindQuadrants;
  level: JmaWindAreaLevel;
}

export interface JmaWindCircleGeometry {
  visible: boolean;
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  landFraction: number;
  oceanShiftKm: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Convert AETHER/CMA-like 2-minute vmax to JMA 10-minute knots for wind-area eligibility. */
export function getJmaTenMinuteWindKt(vmaxCmaMs: number): number {
  return Math.max(0, Number(vmaxCmaMs) || 0) * 0.952 * 1.943844492;
}

/** Strict JMA publication threshold: 30 kt strong-wind area / 50 kt storm-wind area. */
export function meetsJmaWindAreaThreshold(vmaxCmaMs: number, level: JmaWindAreaLevel): boolean {
  return getJmaTenMinuteWindKt(vmaxCmaMs) >= (level === "strong" ? 30 : 50);
}

function isMinorIslandWindSqueezeIgnored(lat: number, lon: number): boolean {
  const ryukyu = lat >= 23.0 && lat <= 30.7 && lon >= 122.8 && lon <= 131.4;
  const marianas = lat >= 12.0 && lat <= 21.3 && lon >= 143.0 && lon <= 147.8;
  const palauYap = lat >= 6.0 && lat <= 10.5 && lon >= 133.0 && lon <= 139.5;
  const chuukPohnpei = lat >= 5.0 && lat <= 8.8 && lon >= 150.5 && lon <= 159.5;
  return ryukyu || marianas || palauYap || chuukPohnpei;
}

function movePoint(lat: number, lon: number, eastKm: number, northKm: number) {
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + northKm / 111.12,
    lon: lon + eastKm / (111.12 * cosLat)
  };
}

/**
 * Compute the circle that best represents the four directional extents and,
 * after landfall, diagnose which side of the circulation is still over water.
 * `isLandAt` is injected so map/video can use the same coastline source.
 */
export function calculateJmaWindCircleGeometry(
  input: JmaWindCircleInput,
  isLandAt: (lat: number, lon: number) => boolean
): JmaWindCircleGeometry {
  const { lat, lon, vmaxCmaMs, landed, radii: q, level } = input;

  // A tiny isolated island (Okinawa/Guam/Marianas etc.) is not large enough to erase or
  // materially squeeze an analysed quadrant-scale wind area. Major-land interaction is handled
  // below from sampled land fraction rather than hiding the JMA wind circles outright.
  const effectiveLanded = landed && !isMinorIslandWindSqueezeIgnored(lat, lon);

  const vals = [q.ne, q.se, q.sw, q.nw].filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) {
    return { visible: false, centerLat: lat, centerLon: lon, radiusKm: 0, landFraction: 0, oceanShiftKm: 0 };
  }

  // JMA 10-minute wind used for the published 30 kt / 50 kt wind areas.
  const jmaKt = getJmaTenMinuteWindKt(vmaxCmaMs);
  const thresholdKt = level === "strong" ? 30 : 50;
  if (!meetsJmaWindAreaThreshold(vmaxCmaMs, level)) {
    return { visible: false, centerLat: lat, centerLon: lon, radiusKm: 0, landFraction: 0, oceanShiftKm: 0 };
  }

  // CMA force-7 is >=13.9 m/s, while JMA's strong-wind area is >=30 kt (~15.4 m/s,
  // 10-min mean). Therefore the JMA outer wind area should generally sit *inside* the CMA
  // force-7 footprint, not outside it. JMA 50 kt is likewise tighter than CMA force-10.
  // These are threshold-geometry conversions only; asymmetry remains supplied by the model.
  const thresholdGeometryScale = level === "strong" ? 0.88 : 0.84;
  const rawRadiusKm = (vals.reduce((a, b) => a + b, 0) / vals.length) * thresholdGeometryScale;
  if (rawRadiusKm < 8) {
    return { visible: false, centerLat: lat, centerLon: lon, radiusKm: 0, landFraction: 0, oceanShiftKm: 0 };
  }

  const scaledQuadrant = (v: number) => (Number.isFinite(v) && v > 0 ? v * thresholdGeometryScale : rawRadiusKm);
  const east = (scaledQuadrant(q.ne) + scaledQuadrant(q.se)) * 0.5;
  const west = (scaledQuadrant(q.nw) + scaledQuadrant(q.sw)) * 0.5;
  const north = (scaledQuadrant(q.ne) + scaledQuadrant(q.nw)) * 0.5;
  const south = (scaledQuadrant(q.se) + scaledQuadrant(q.sw)) * 0.5;

  // JMA position tables represent an asymmetric wind area as a *single displaced circle*.
  // Geometrically, the centre shift is exactly half of the difference between opposite
  // long/short extents.  Keep that 0.5 relationship here; any extra post-landfall shift
  // is diagnosed separately below from the surviving ocean sectors.
  let offsetEastKm = (east - west) * 0.50;
  let offsetNorthKm = (north - south) * 0.50;
  let radiusKm = rawRadiusKm;
  let landFraction = 0;
  let oceanShiftKm = 0;

  if (effectiveLanded) {
    // Diagnose land contact across the *current* wind area rather than using
    // elapsed landfall time.  Inner samples get slightly more weight because
    // friction near the core destroys the strong-wind footprint fastest.
    const radialFractions = [0.30, 0.52, 0.74, 0.94];
    const radialWeights = [1.35, 1.15, 0.95, 0.75];
    const azimuthCount = 24;
    let landWeight = 0;
    let totalWeight = 0;
    let oceanEast = 0;
    let oceanNorth = 0;
    let oceanWeight = 0;

    for (let i = 0; i < azimuthCount; i++) {
      const theta = (i / azimuthCount) * Math.PI * 2;
      const dirEast = Math.sin(theta);
      const dirNorth = Math.cos(theta);
      for (let r = 0; r < radialFractions.length; r++) {
        const frac = radialFractions[r];
        const weight = radialWeights[r];
        const p = movePoint(lat, lon, dirEast * rawRadiusKm * frac, dirNorth * rawRadiusKm * frac);
        const land = !isMinorIslandWindSqueezeIgnored(p.lat, p.lon) && isLandAt(p.lat, p.lon);
        totalWeight += weight;
        if (land) {
          landWeight += weight;
        } else {
          // Outer surviving marine sectors are especially representative of
          // the remaining strong-wind area after coastal landfall.
          const waterWeight = weight * (0.65 + frac * 0.9);
          oceanEast += dirEast * waterWeight;
          oceanNorth += dirNorth * waterWeight;
          oceanWeight += waterWeight;
        }
      }
    }

    landFraction = totalWeight > 0 ? clamp(landWeight / totalWeight, 0, 1) : 0;
    const friction = smoothstep(0.06, 0.90, landFraction);

    // The model radii already shrink through land friction.  This display-side
    // contraction only represents the loss of a coherent JMA-reportable wind
    // area, so it is moderate and geometry-driven rather than time-driven.
    const nearThreshold = smoothstep(thresholdKt, thresholdKt + (level === "strong" ? 12 : 15), jmaKt);
    const thresholdScale = 0.58 + 0.42 * nearThreshold;
    const landScale = 1.0 - 0.26 * friction;
    radiusKm *= thresholdScale * landScale;

    // Shift the circle further toward surviving oceanic circulation.  This is
    // intentionally based on sampled water sectors, not a hard-coded east/west
    // direction, so landfalls on China, Taiwan, Japan, Luzon, etc. behave alike.
    const oceanMag = Math.hypot(oceanEast, oceanNorth);
    if (oceanWeight > 0 && oceanMag > 1e-6) {
      const oceanUnitEast = oceanEast / oceanMag;
      const oceanUnitNorth = oceanNorth / oceanMag;
      oceanShiftKm = radiusKm * (0.12 + 0.37 * friction);
      offsetEastKm += oceanUnitEast * oceanShiftKm;
      offsetNorthKm += oceanUnitNorth * oceanShiftKm;
    }
  }

  // Keep the displaced centre physically plausible: the storm centre should
  // remain within the displayed wind circle even for a strongly coastal case.
  const maxOffset = radiusKm * (effectiveLanded ? 0.72 : 0.50);
  const offsetMag = Math.hypot(offsetEastKm, offsetNorthKm);
  if (offsetMag > maxOffset && offsetMag > 0) {
    const s = maxOffset / offsetMag;
    offsetEastKm *= s;
    offsetNorthKm *= s;
  }

  // No fixed post-landfall lifetime.  A tiny residual radius is treated as no
  // meaningful reportable strong-wind area and is therefore omitted.
  const minReportableRadiusKm = level === "strong" ? 14 : 10;
  if (radiusKm < minReportableRadiusKm) {
    return { visible: false, centerLat: lat, centerLon: lon, radiusKm: 0, landFraction, oceanShiftKm };
  }

  const shifted = movePoint(lat, lon, offsetEastKm, offsetNorthKm);
  return {
    visible: true,
    centerLat: shifted.lat,
    centerLon: shifted.lon,
    radiusKm,
    landFraction,
    oceanShiftKm
  };
}
