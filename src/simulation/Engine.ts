import { issuePreSimulationReference, rebasePreSimulationReference, blendPreSimulationForecast, mainHistoryForecastFixes } from "./PreSimulationReference";
import { advanceDrawnTrack } from "./DrawnTrack";
import { makeHourlyHistorySeed } from "../utils/HistorySnapshot";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typhoon, TyphoonState, TyphoonCategory, SimulationConfig, EventLog, StationReading } from "../types";
import { loadGSHHGFullData, getGSHHGFullLandMasses, GSHHGLandMass } from "./GSHHGData";
import { landGeoJson, countriesGeoJson, checkPointOnLandGeoJson, getLandfallCountryGeoJson, getDistanceToLandGeoJson, hasLandBoundaryWithinKmGeoJson } from "./NaturalEarthLoader";
import { computeTyphoonPrecipitation, estimateDvorakTNumber, type PrecipitationStateLike } from "./PrecipitationModel";
import { getEtopoTerrainElevation, getEtopoTerrainDiagnostics } from "./EtopoTerrain";
import { isCmaTyphoonProductTime } from "./CmaOperationalClock";
import { computeEyeBrightnessTarget, eyeBrightnessRelaxationHours } from "./EyeThermodynamics";
import { getDisasterCapabilityProfile } from "../utils/DisasterPreparednessModel";
import { getSynopticAtmosState, getSynopticOceanState, getSynopticSteering, getSynopticWind, getSynopticWesterlyLiveContribution } from "./SynopticEnvironment";
import { resolveCirculationSizeTransition, shouldUseExactCirculationTransitionAnalysis } from "./CirculationSizeTransition";
import { getColdAirCenterContactHour } from "./ColdAirTiming";
export { checkPointOnLandGeoJson, getLandfallCountryGeoJson, getDistanceToLandGeoJson };

// Automatically trigger GSHHS_f_L1 loading on module initialization
loadGSHHGFullData();

/**
 * Real historical wind radii reference table for 7, 10, 12-level winds based on max wind speed (vmax in m/s)
 */
export function getStandardAverageWindRadii(vmax: number): { r7: number; r10: number; r12: number } {
  // GB/T 28591: force 7 starts at 13.9 m/s. Older simulator versions incorrectly waited
  // until 17.2 m/s (force 8), which suppressed valid force-7 wind areas in stronger TDs.
  if (vmax < 13.9) {
    return { r7: 0, r10: 0, r12: 0 };
  } else if (vmax < 17.2) { // 7级 (13.9 - 17.1 m/s)
    const t = (vmax - 13.9) / (17.2 - 13.9);
    return { r7: Math.round(105 + 70 * clamp01(t)), r10: 0, r12: 0 };
  } else if (vmax < 20.8) { // 8级 (17.2 - 20.7 m/s)
    return { r7: 180, r10: 0, r12: 0 };
  } else if (vmax < 24.5) { // 9级 (20.8 - 24.4 m/s)
    return { r7: 200, r10: 0, r12: 0 };
  } else if (vmax < 28.5) { // 10级 (24.5 - 28.4 m/s)
    return { r7: 230, r10: 70, r12: 0 };
  } else if (vmax < 32.7) { // 11级 (28.5 - 32.6 m/s)
    return { r7: 260, r10: 100, r12: 0 };
  } else if (vmax < 37.0) { // 12级 (32.7 - 36.9 m/s)
    return { r7: 315, r10: 120, r12: 50 };
  } else if (vmax < 41.5) { // 13级 (37.0 - 41.4 m/s)
    return { r7: 335, r10: 135, r12: 70 };
  } else if (vmax < 46.2) { // 14级 (41.5 - 46.1 m/s)
    return { r7: 350, r10: 145, r12: 80 };
  } else if (vmax < 51.0) { // 15级 (46.2 - 50.9 m/s)
    return { r7: 370, r10: 155, r12: 90 };
  } else if (vmax < 56.1) { // 16级 (51.0 - 56.0 m/s)
    return { r7: 375, r10: 160, r12: 95 };
  } else if (vmax <= 68.0) { // 17级及部分17级以上 (56.1 - 68.0 m/s)
    return { r7: 380, r10: 165, r12: 100 };
  } else { // 18级及以上 (> 68 m/s)
    const extra = vmax - 68.0;
    return {
      r7: Math.round(380 + extra * 1.5),
      r10: Math.round(165 + extra * 1.0),
      r12: Math.round(100 + extra * 0.8)
    };
  }
}

function circulationPreferenceScale(vmax: number, config: SimulationConfig | undefined, targetLevel: 7 | 10 | 12): number {
  const refKm = Math.max(0, Number(config?.circulationSizeReferenceKm ?? 320));
  const ratio = refKm / 380;
  if (ratio <= 1e-9) return 0;
  const intensityBlend = 0.28 + 0.72 * clamp01((vmax - 17.2) / (62 - 17.2));
  const outerScale = Math.pow(ratio, intensityBlend);
  if (targetLevel === 7) return outerScale;
  if (targetLevel === 10) return Math.pow(outerScale, 0.58);
  return Math.pow(outerScale, 0.38);
}

/** Adjust only the live visual wind envelope when the user edits a manual size reference.
 * The next ten-minute physics step recomputes exact terrain/shear quadrants; archived snapshots
 * are deliberately never rewritten. This avoids a paused UI falsely retaining the old radius. */
export function reweightLiveWindRadiiForPreference(ty: Typhoon, before: SimulationConfig, after: SimulationConfig): Typhoon {
  const scale = (radii: Typhoon["r7"], level: 7 | 10 | 12) => {
    const oldScale = circulationPreferenceScale(ty.vmax, before, level);
    const newScale = circulationPreferenceScale(ty.vmax, after, level);
    const factor = newScale / Math.max(0.001, oldScale);
    const result = { ...radii };
    for (const quadrant of ["ne", "se", "sw", "nw"] as const) {
      result[quadrant] = Math.round(Math.max(0, radii[quadrant] * factor));
    }
    return result;
  };
  return { ...ty, r7: scale(ty.r7, 7), r10: scale(ty.r10, 10), r12: scale(ty.r12, 12) };
}

function circulationPreferenceIndices(config: SimulationConfig | undefined): { broad: number; compact: number } {
  const refKm = Math.max(0, Number(config?.circulationSizeReferenceKm ?? 320));
  return {
    broad: clamp01((refKm - 380) / 260),
    compact: clamp01((380 - refKm) / 230),
  };
}

// Seed-based PRNG
export class SeededRandom {
  private state: number;

  constructor(seedStr: string) {
    this.state = this.hashString(seedStr);
  }

  /** Exact checkpoint; hourly PRNG fast-forward is not equivalent to actual consumed draws. */
  public getState(): number { return this.state; }
  public setState(state: number): void {
    if (!Number.isSafeInteger(state) || state < 0) throw new Error('Invalid PRNG checkpoint');
    this.state = state;
  }

  private hashString(str: string): number {
    let hash = 0;
    if (str.length === 0) return 123456789;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash) || 123456789;
  }

  public next(): number {
    // Standard LCG or simple sine hash
    const x = Math.sin(this.state++) * 10000;
    return x - Math.floor(x);
  }

  public nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const MIN_CYCLONE_INTENSITY_MS = 5.0;

/** Great-circle distance used to audit that displayed translation matches actual map displacement. */
function greatCircleDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}



type CompiledManualDryAirRegion = {
  polygon: [number, number][];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  centroidLat: number;
  centroidLon: number;
  radiusKm: number;
  softness: number;
  intensity: number;
};

// Manual dry-air polygons are static after the user presses Save. The old implementation rebuilt
// every polygon array, centroid and radius on every 10-minute live step and again for every forecast
// hour. Large hand-drawn regions therefore produced visible hitches exactly when a storm entered
// them. Cache the immutable geometry by region object and keep only the cheap point/bbox test in the
// hot loop.
const manualDryAirGeometryCache = new WeakMap<object, CompiledManualDryAirRegion>();

function compileManualDryAirRegion(region: NonNullable<SimulationConfig["manualDryAirRegions"]>[number]): CompiledManualDryAirRegion | null {
  const cached = manualDryAirGeometryCache.get(region as object);
  if (cached) return cached;
  const points = region?.points || [];
  if (points.length < 3) return null;
  let sumLat = 0, sumLon = 0;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const polygon: [number, number][] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    polygon[i] = [p.lat, p.lon];
    sumLat += p.lat; sumLon += p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const centroidLat = sumLat / points.length;
  const centroidLon = sumLon / points.length;
  const cosCentroid = Math.max(0.3, Math.cos(centroidLat * Math.PI / 180));
  let radiusKm = 80;
  for (const p of points) {
    radiusKm = Math.max(radiusKm, Math.hypot(
      (p.lat - centroidLat) * 111.12,
      (p.lon - centroidLon) * 111.12 * cosCentroid
    ));
  }
  const compiled: CompiledManualDryAirRegion = {
    polygon,
    bbox: { minLat, maxLat, minLon, maxLon },
    centroidLat,
    centroidLon,
    radiusKm,
    softness: Math.max(0.18, Math.min(0.95, Number(region.softness ?? 0.58))),
    intensity: Math.max(0, Math.min(1, Number(region.intensity || 0.72)))
  };
  manualDryAirGeometryCache.set(region as object, compiled);
  return compiled;
}

function getManualDryAirRegionSeverity(config: SimulationConfig | undefined, lat: number, lon: number): number {
  const regions = config?.manualDryAirRegions || [];
  if (!regions.length) return 0;
  let maxSeverity = 0;
  const cosLat = Math.max(0.3, Math.cos(lat * Math.PI / 180));
  for (const region of regions) {
    const compiled = compileManualDryAirRegion(region);
    if (!compiled) continue;
    const b = compiled.bbox;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    if (!checkPointInPolygon(lat, lon, compiled.polygon, b)) continue;
    const distKm = Math.hypot(
      (lat - compiled.centroidLat) * 111.12,
      (lon - compiled.centroidLon) * 111.12 * cosLat
    );
    const shapeFactor = Math.max(0, 1 - distKm / compiled.radiusKm);
    // A polygon denotes an air mass, not a radial point source. Even near its hand-drawn edge a
    // cyclone that is geometrically inside it must ingest some dry air; the centroid weighting
    // only controls how much stronger the intrusion becomes toward the heart of the region.
    const severity = compiled.intensity * (0.32 + 0.68 * Math.pow(shapeFactor, 0.50 + compiled.softness * 0.60));
    if (severity > maxSeverity) maxSeverity = severity;
    if (maxSeverity >= 0.995) break;
  }
  return Math.max(0, Math.min(1, maxSeverity));
}


type CompiledManualShearRegion = {
  polygon: [number, number][];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  centroidLat: number;
  centroidLon: number;
  radiusKm: number;
  softness: number;
  shearKt: number;
};

const manualShearGeometryCache = new WeakMap<object, CompiledManualShearRegion>();

function compileManualShearRegion(region: NonNullable<SimulationConfig["manualShearRegions"]>[number]): CompiledManualShearRegion | null {
  const cached = manualShearGeometryCache.get(region as object);
  if (cached) return cached;
  const points = region?.points || [];
  if (points.length < 3) return null;
  let sumLat = 0, sumLon = 0;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const polygon: [number, number][] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    polygon[i] = [pt.lat, pt.lon];
    sumLat += pt.lat; sumLon += pt.lon;
    minLat = Math.min(minLat, pt.lat); maxLat = Math.max(maxLat, pt.lat);
    minLon = Math.min(minLon, pt.lon); maxLon = Math.max(maxLon, pt.lon);
  }
  const centroidLat = sumLat / points.length, centroidLon = sumLon / points.length;
  const cosCentroid = Math.max(0.3, Math.cos(centroidLat * Math.PI / 180));
  let radiusKm = 80;
  for (const pt of points) radiusKm = Math.max(radiusKm, Math.hypot((pt.lat - centroidLat) * 111.12, (pt.lon - centroidLon) * 111.12 * cosCentroid));
  const compiled: CompiledManualShearRegion = {
    polygon, bbox: { minLat, maxLat, minLon, maxLon }, centroidLat, centroidLon, radiusKm,
    softness: Math.max(0.18, Math.min(0.95, Number(region.softness ?? 0.58))),
    shearKt: Math.max(15, Math.min(60, Number(region.shearKt || 30)))
  };
  manualShearGeometryCache.set(region as object, compiled);
  return compiled;
}

function getManualShearRegionInfluence(config: SimulationConfig | undefined, lat: number, lon: number): { shearKt: number; severity: number } {
  const regions = config?.manualShearRegions || [];
  if (!regions.length) return { shearKt: 0, severity: 0 };
  let bestKt = 0, bestSeverity = 0;
  const cosLat = Math.max(0.3, Math.cos(lat * Math.PI / 180));
  for (const region of regions) {
    const compiled = compileManualShearRegion(region);
    if (!compiled) continue;
    const b = compiled.bbox;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    if (!checkPointInPolygon(lat, lon, compiled.polygon, b)) continue;
    const distKm = Math.hypot((lat - compiled.centroidLat) * 111.12, (lon - compiled.centroidLon) * 111.12 * cosLat);
    const shape = Math.max(0, 1 - distKm / compiled.radiusKm);
    const core = Math.pow(shape, 0.55 + compiled.softness * 0.65);
    // Keep the whole polygon meaningfully hostile while making its inner portion strongest.
    const localKt = 15 + (compiled.shearKt - 15) * (0.70 + 0.30 * core);
    if (localKt > bestKt) { bestKt = localKt; bestSeverity = clamp01((localKt - 15) / 30); }
  }
  return { shearKt: bestKt, severity: bestSeverity };
}

/**
 * Backward-compatible name used by older callers. The cadence is now explicitly the CMA/NMC
 * public typhoon-path clock: 02/05/08/11/14/17/20/23 Beijing time.
 */
export function isThreeHourlySynopticTime(startDate: Date | undefined, simHour: number): boolean {
  return isCmaTyphoonProductTime(startDate, simHour);
}

/**
 * Small isolated islands should not squeeze the analysed wind field. Their land area is far too
 * small to remove a quadrant-scale boundary-layer wind footprint, although they may still affect
 * a station located directly on the island. Major islands (Taiwan/Luzon/Hainan/Japan main islands)
 * deliberately remain outside this mask.
 */
export function isMinorIslandWindSqueezeIgnored(lat: number, lon: number): boolean {
  const ryukyu = lat >= 23.0 && lat <= 30.7 && lon >= 122.8 && lon <= 131.4;
  const marianas = lat >= 12.0 && lat <= 21.3 && lon >= 143.0 && lon <= 147.8;
  const palauYap = lat >= 6.0 && lat <= 10.5 && lon >= 133.0 && lon <= 139.5;
  const chuukPohnpei = lat >= 5.0 && lat <= 8.8 && lon >= 150.5 && lon <= 159.5;
  return ryukyu || marianas || palauYap || chuukPohnpei;
}

/**
 * Small-island filter used specifically for operational landfall records and EWRC disruption.
 * Unlike the wind-squeeze mask, this intentionally ignores only island groups that are too small
 * to be treated as a synoptic-scale landfall/core-disruption event. Major Philippine islands,
 * Taiwan, Hainan, Chongming and the Japanese main islands remain reportable/disruptive.
 */
export function isMinorIslandOperationalIgnored(lat: number, lon: number): boolean {
  const ryukyu = lat >= 23.1 && lat <= 30.9 && lon >= 123.0 && lon <= 131.8;
  const marianasGuam = lat >= 11.2 && lat <= 21.6 && lon >= 142.2 && lon <= 148.2;
  const hawaiiSigned = lat >= 18.2 && lat <= 22.8 && lon >= -161.2 && lon <= -154.0;
  const hawaii360 = lat >= 18.2 && lat <= 22.8 && lon >= 198.8 && lon <= 206.0;
  return ryukyu || marianasGuam || hawaiiSigned || hawaii360;
}

export function shouldHideCmaWindRadiiAfterLandfall(state: { lat: number; lon: number; landed?: boolean } | null | undefined): boolean {
  return !!state?.landed && !isMinorIslandOperationalIgnored(state.lat, state.lon);
}

/** Slightly larger proximity box so an EWRC is not failed merely by grazing a tiny island group. */
function isMinorIslandOperationalInfluenceZone(lat: number, lon: number): boolean {
  const ryukyu = lat >= 22.8 && lat <= 31.2 && lon >= 122.6 && lon <= 132.2;
  const marianasGuam = lat >= 10.7 && lat <= 22.0 && lon >= 141.7 && lon <= 148.7;
  const hawaiiSigned = lat >= 17.8 && lat <= 23.2 && lon >= -161.7 && lon <= -153.5;
  const hawaii360 = lat >= 17.8 && lat <= 23.2 && lon >= 198.3 && lon <= 206.5;
  return ryukyu || marianasGuam || hawaiiSigned || hawaii360;
}

/** Round-120 compatibility helper retained for old regression/history readers. It is no longer the
 * authoritative Round-121 translation-speed mask. Major Philippine islands, Taiwan, Hainan and
 * Japan's main islands were previously excluded from this small-island mask; Round 121 instead
 * uses the positive whitelist in getForecastSpeedSlowdownLandContext(). */
function isMinorIslandForecastSpeedIgnored(lat: number, lon: number): boolean {
  const palauYap = lat >= 5.0 && lat <= 11.0 && lon >= 132.5 && lon <= 140.2;
  const micronesia = lat >= 4.0 && lat <= 10.5 && lon >= 149.5 && lon <= 164.5;
  const marshalls = lat >= 4.0 && lat <= 14.8 && lon >= 164.0 && lon <= 173.5;
  return isMinorIslandOperationalIgnored(lat, lon) || palauYap || micronesia || marshalls;
}

function isMinorIslandForecastSpeedInfluenceZone(lat: number, lon: number): boolean {
  const ryukyu = lat >= 21.8 && lat <= 32.2 && lon >= 121.6 && lon <= 133.1;
  const marianas = lat >= 9.8 && lat <= 23.0 && lon >= 140.7 && lon <= 149.7;
  const palauYap = lat >= 3.8 && lat <= 12.2 && lon >= 131.2 && lon <= 141.5;
  const micronesia = lat >= 2.8 && lat <= 11.8 && lon >= 148.0 && lon <= 166.0;
  const marshalls = lat >= 2.8 && lat <= 16.0 && lon >= 162.5 && lon <= 175.0;
  const hawaiiSigned = lat >= 16.8 && lat <= 24.2 && lon >= -162.7 && lon <= -152.0;
  const hawaii360 = lat >= 16.8 && lat <= 24.2 && lon >= 197.3 && lon <= 208.0;
  return ryukyu || marianas || palauYap || micronesia || marshalls || hawaiiSigned || hawaii360;
}

const forecastMeaningfulLandDistanceCache = new Map<string, number>();

/** @deprecated Round 121 uses getForecastSpeedSlowdownLandContext(); kept for Round-120 source compatibility. */
function getForecastMeaningfulLandContext(
  lat: number,
  lon: number,
  coastlineSource?: string,
  includeDistance: boolean = true
): { isLand: boolean; distanceKm: number } {
  const rawLand = getLandMetrics(lat, lon, coastlineSource, true).isLand;
  const meaningfulLand = rawLand && !isMinorIslandForecastSpeedIgnored(lat, lon);
  if (meaningfulLand) return { isLand: true, distanceKm: 0 };

  // Round130: live geometry products only consume `.isLand`.  Before this guard, that boolean
  // call still computed nearest-coast distance and could launch a 15 x 16 radial search inside
  // Ryukyu/Marianas/Micronesia influence boxes.  At the 3-hour forecast issue cadence this was a
  // major source of the long synchronous stalls seen offshore.  Distance-aware legacy callers can
  // keep the historical behaviour by leaving includeDistance at its default true.
  if (!includeDistance) return { isLand: false, distanceKm: 999 };

  const rawDistanceKm = Math.max(0, getDistanceToLand(lat, lon, coastlineSource, true) * 111.12);
  // Outside a small-island influence zone, the ordinary nearest-coast query is authoritative.
  if (!isMinorIslandForecastSpeedInfluenceZone(lat, lon)) {
    return { isLand: false, distanceKm: rawDistanceKm };
  }

  const key = `${coastlineSource || "default"}|${Math.round(lat * 8)}|${Math.round(lon * 8)}`;
  const cached = forecastMeaningfulLandDistanceCache.get(key);
  if (cached !== undefined) return { isLand: false, distanceKm: cached };

  // The nearest raw coastline may be the tiny island beneath/beside the cyclone. Search outward
  // coarsely for a *meaningful* landmass. This is only invoked in the island-chain boxes above, so
  // normal forecast integration keeps the original fast distance path.
  let best = 560;
  const directions = 16;
  for (let radiusKm = 35; radiusKm <= 525 && best >= 560; radiusKm += 35) {
    for (let d = 0; d < directions; d++) {
      const angle = d * Math.PI * 2 / directions;
      const testLat = lat + (radiusKm * Math.cos(angle)) / 111.12;
      const cosLat = Math.max(0.18, Math.cos(testLat * Math.PI / 180));
      const testLon = lon + (radiusKm * Math.sin(angle)) / (111.12 * cosLat);
      const metrics = getLandMetrics(testLat, testLon, coastlineSource, true);
      if (metrics.isLand && !isMinorIslandForecastSpeedIgnored(testLat, testLon)) {
        best = radiusKm;
        break;
      }
    }
  }
  if (best >= 560) best = Math.max(560, rawDistanceKm);
  forecastMeaningfulLandDistanceCache.set(key, best);
  if (forecastMeaningfulLandDistanceCache.size > 1600) {
    const first = forecastMeaningfulLandDistanceCache.keys().next().value;
    if (first) forecastMeaningfulLandDistanceCache.delete(first);
  }
  return { isLand: false, distanceKm: best };
}


/**
 * Round 121 translation-speed slowdown geography.
 *
 * The near-shore / post-landfall speed calibration is intentionally narrower than the physical
 * land model. Only the Eurasian mainland plus Taiwan, Hainan and the Philippine archipelago are
 * allowed to trigger the -5 km/h coastal/post-land rule. Japan, the Ryukyus, Indonesia/Borneo,
 * Papua New Guinea, Australia, Pacific islands and other detached islands remain fully active for
 * terrain/intensity physics but are treated as open ocean by this *translation-speed-only* mask.
 *
 * We compile the already-loaded country plate into a small whitelist of polygon components. The
 * component filter matters for Russia (exclude Sakhalin/Kurils) and Malaysia (keep only the Malay
 * Peninsula). China keeps its mainland polygon plus the separate Hainan polygon. Philippines and
 * Taiwan are explicitly included as complete island groups.
 */
type ForecastSpeedSlowdownPolygon = {
  name: string;
  rings: number[][][];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

const FORECAST_SPEED_EURASIAN_MAINLAND_COUNTRIES = new Set([
  "Kazakhstan", "Cambodia", "Thailand", "Laos", "Myanmar", "Vietnam",
  "North Korea", "South Korea", "Mongolia", "India", "Bangladesh", "Bhutan",
  "Nepal", "Pakistan"
]);

let forecastSpeedSlowdownCountrySource: any = null;
let forecastSpeedSlowdownPolygons: ForecastSpeedSlowdownPolygon[] = [];
const forecastSpeedSlowdownLandCache = new Map<string, { isLand: boolean; distanceKm: number }>();

function normalizeForecastSpeedLon(lon: number): number {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function getForecastSpeedPolygonBBox(rings: number[][][]): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const ring of rings) {
    for (const point of ring) {
      if (!point || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
  }
  return { minLat, maxLat, minLon, maxLon };
}

function isForecastSpeedSlowdownComponent(name: string, bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number }): boolean {
  if (name === "Taiwan" || name === "Philippines") return true;
  if (FORECAST_SPEED_EURASIAN_MAINLAND_COUNTRIES.has(name)) return true;

  if (name === "China") {
    const isMainland = bbox.maxLat >= 24.0 && (bbox.maxLon - bbox.minLon) >= 12.0;
    const isHainan = bbox.minLat >= 17.0 && bbox.maxLat <= 21.2 && bbox.minLon >= 107.5 && bbox.maxLon <= 112.2;
    return isMainland || isHainan;
  }

  if (name === "Russia") {
    // The large 85E..180E polygon is the Asian mainland. A small wrapped Chukotka piece west of
    // -175E is the same mainland split by the dateline. Sakhalin/Kuril/Arctic island components
    // are deliberately excluded.
    const broadMainland = (bbox.maxLon - bbox.minLon) >= 30.0 && (bbox.maxLat - bbox.minLat) >= 12.0;
    const wrappedChukotka = bbox.minLon <= -179.5 && bbox.maxLon <= -174.0 && bbox.minLat >= 63.0 && bbox.maxLat <= 70.5;
    return broadMainland || wrappedChukotka;
  }

  if (name === "Malaysia") {
    // Keep only Peninsular Malaysia, which is contiguous with the Eurasian mainland; Borneo is not.
    return bbox.maxLon <= 108.0;
  }

  return false;
}

function getForecastSpeedSlowdownPolygons(): ForecastSpeedSlowdownPolygon[] {
  if (!countriesGeoJson?.features) return [];
  if (forecastSpeedSlowdownCountrySource === countriesGeoJson && forecastSpeedSlowdownPolygons.length) {
    return forecastSpeedSlowdownPolygons;
  }

  const compiled: ForecastSpeedSlowdownPolygon[] = [];
  for (const feature of countriesGeoJson.features as any[]) {
    const props = feature?.properties || {};
    const name = String(props.NAME || props.ADMIN || props.NAME_LONG || "").trim();
    const geom = feature?.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const polygons: number[][][][] = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const rings of polygons) {
      const bbox = getForecastSpeedPolygonBBox(rings);
      if (!isForecastSpeedSlowdownComponent(name, bbox)) continue;
      compiled.push({ name, rings, bbox });
    }
  }

  forecastSpeedSlowdownCountrySource = countriesGeoJson;
  forecastSpeedSlowdownPolygons = compiled;
  forecastSpeedSlowdownLandCache.clear();
  return compiled;
}

function unwrapForecastSpeedLon(lon: number, referenceLon: number): number {
  let value = lon;
  while (value - referenceLon > 180) value -= 360;
  while (value - referenceLon < -180) value += 360;
  return value;
}

function isPointInForecastSpeedRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (!a || !b) continue;
    const xi = unwrapForecastSpeedLon(Number(a[0]), lon), yi = Number(a[1]);
    const xj = unwrapForecastSpeedLon(Number(b[0]), lon), yj = Number(b[1]);
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInForecastSpeedPolygon(lat: number, lon: number, polygon: ForecastSpeedSlowdownPolygon): boolean {
  if (!polygon.rings.length) return false;
  const queryLon = normalizeForecastSpeedLon(lon);
  const box = polygon.bbox;
  const lonNearBox = queryLon >= box.minLon - 1e-8 && queryLon <= box.maxLon + 1e-8;
  if (lat < box.minLat || lat > box.maxLat || !lonNearBox) return false;
  if (!isPointInForecastSpeedRing(lat, queryLon, polygon.rings[0])) return false;
  for (let i = 1; i < polygon.rings.length; i++) {
    if (isPointInForecastSpeedRing(lat, queryLon, polygon.rings[i])) return false;
  }
  return true;
}

function distanceKmToForecastSpeedSegment(
  lat: number, lon: number,
  a: number[], b: number[]
): number {
  const cosLat = Math.max(0.12, Math.cos(lat * Math.PI / 180));
  const ax = (unwrapForecastSpeedLon(Number(a[0]), lon) - lon) * 111.12 * cosLat;
  const ay = (Number(a[1]) - lat) * 111.12;
  const bx = (unwrapForecastSpeedLon(Number(b[0]), lon) - lon) * 111.12 * cosLat;
  const by = (Number(b[1]) - lat) * 111.12;
  const vx = bx - ax, vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq > 1e-9 ? -(ax * vx + ay * vy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + vx * t, ay + vy * t);
}

function getForecastSpeedSlowdownLandContext(lat: number, lon: number): { isLand: boolean; distanceKm: number } {
  const queryLon = normalizeForecastSpeedLon(lon);
  const key = `${Math.round(lat * 8)}|${Math.round(queryLon * 8)}`;
  // Compile/rebind first so an early pre-load cache entry cannot survive after country geometry loads.
  const polygons = getForecastSpeedSlowdownPolygons();
  const cached = forecastSpeedSlowdownLandCache.get(key);
  if (cached) return cached;

  if (!polygons.length) {
    // Country geometry normally loads before forecasts are available. If it is still unavailable,
    // fail open-ocean rather than accidentally re-enabling slowdown around Japan/Indonesia/etc.
    const empty = { isLand: false, distanceKm: 999 };
    forecastSpeedSlowdownLandCache.set(key, empty);
    return empty;
  }

  for (const polygon of polygons) {
    if (isPointInForecastSpeedPolygon(lat, queryLon, polygon)) {
      const result = { isLand: true, distanceKm: 0 };
      forecastSpeedSlowdownLandCache.set(key, result);
      return result;
    }
  }

  let bestKm = 999;
  // Only distances up to ~560 km can influence the 460 km transition. Bbox rejection keeps this
  // cheap even though it uses exact selected-country coastlines rather than the all-land distance.
  const latPad = 5.2;
  const lonPad = 5.2 / Math.max(0.20, Math.cos(lat * Math.PI / 180));
  for (const polygon of polygons) {
    const box = polygon.bbox;
    if (lat < box.minLat - latPad || lat > box.maxLat + latPad) continue;
    if (queryLon < box.minLon - lonPad || queryLon > box.maxLon + lonPad) continue;
    const outer = polygon.rings[0] || [];
    for (let i = 0; i < outer.length - 1; i++) {
      const d = distanceKmToForecastSpeedSegment(lat, queryLon, outer[i], outer[i + 1]);
      if (d < bestKm) bestKm = d;
    }
  }

  const result = { isLand: false, distanceKm: bestKm };
  forecastSpeedSlowdownLandCache.set(key, result);
  if (forecastSpeedSlowdownLandCache.size > 3000) {
    const first = forecastSpeedSlowdownLandCache.keys().next().value;
    if (first) forecastSpeedSlowdownLandCache.delete(first);
  }
  return result;
}

/**
 * Playground mode is intentionally derived from the target-intensity control rather than
 * persisted as a second toggle. Lowering the target below 115 m/s therefore exits the mode
 * immediately and restores the ordinary physical constraints.
 */
export function isPlaygroundMode(config: Partial<SimulationConfig> | undefined): boolean {
  return !!config?.maxIntensityLimitEnabled && (config.maxIntensityLimit ?? 0) >= 115;
}

function isAnyIntensityReferenceActive(config: Partial<SimulationConfig> | undefined): boolean {
  return !!config?.maxIntensityLimitEnabled && !isPlaygroundMode(config);
}

function isAutomaticPeakIntensityActive(config: Partial<SimulationConfig> | undefined): boolean {
  return !!config?.maxIntensityLimitEnabled && !!config?.autoAdjustIntensity && !isPlaygroundMode(config);
}

function isTargetIntensityCapActive(config: Partial<SimulationConfig> | undefined): boolean {
  return !!config?.maxIntensityLimitEnabled && !config?.autoAdjustIntensity && !isPlaygroundMode(config);
}

/** Forecast-only lifetime peak aspiration. Unlike maxIntensityLimit this is never a hard cap and
 * never changes the live simulation directly. It biases deterministic forecast thermodynamics;
 * ensemble families then retain their existing independent intensity spread around that reference. */
function getForecastPeakIntensityReference(config: Partial<SimulationConfig> | undefined): number | null {
  if (!config?.forecastPeakIntensityEnabled) return null;
  const value = Number(config.forecastPeakIntensityReference);
  return Number.isFinite(value) ? Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(110, value)) : null;
}

/** Interpolate the user-authored forecast-intensity curve. The curve is only meaningful while the
 * manual forecast framework itself is enabled; disabling the route therefore also disables the
 * attached intensity guidance without deleting the user's saved edits. */
type NormalizedForecastIntensityPoint = { leadHour: number; vmax: number };
const manualForecastIntensityCurveCache = new WeakMap<object, NormalizedForecastIntensityPoint[]>();

function getNormalizedManualForecastIntensityCurve(
  config: Partial<SimulationConfig> | undefined
): NormalizedForecastIntensityPoint[] {
  const source = config?.manualForecastIntensityCurve;
  if (!source?.length) return [];
  const cached = manualForecastIntensityCurveCache.get(source as unknown as object);
  if (cached) return cached;
  const points = source
    .map((p) => ({ leadHour: Number(p.leadHour), vmax: Number(p.vmax) }))
    .filter((p) => Number.isFinite(p.leadHour) && Number.isFinite(p.vmax))
    .sort((a, b) => a.leadHour - b.leadHour);
  manualForecastIntensityCurveCache.set(source as unknown as object, points);
  return points;
}

function getManualForecastIntensityTarget(
  config: Partial<SimulationConfig> | undefined,
  leadHour: number
): number | null {
  if (!config?.manualForecastRouteEnabled || !config?.manualForecastIntensityEnabled) return null;
  const points = getNormalizedManualForecastIntensityCurve(config);
  if (!points.length) return null;
  const lead = Math.max(0, Number(leadHour) || 0);
  if (lead <= points[0].leadHour) return Math.max(5, Math.min(85, points[0].vmax));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (lead <= b.leadHour + 1e-6) {
      const t = Math.max(0, Math.min(1, (lead - a.leadHour) / Math.max(1e-6, b.leadHour - a.leadHour)));
      return Math.max(5, Math.min(85, a.vmax + (b.vmax - a.vmax) * t));
    }
  }
  return Math.max(5, Math.min(85, points[points.length - 1].vmax));
}

/**
 * In automatic mode the slider is a lifetime peak aspiration, not an hourly setpoint.
 * The actual target follows thermodynamic support, the current inner-core lifecycle and
 * successful eyewall-replacement history.  The first successful ERC gets the strongest
 * post-cycle peak opportunity; later cycles usually broaden the vortex and receive a small
 * diminishing-return penalty, but a genuinely improving environment can offset it.
 */
function diagnoseAutomaticPeakTarget(params: {
  configuredPeak: number;
  environmentalMPI: number;
  vmax: number;
  sst: number;
  ohc: number;
  rh: number;
  shear: number;
  outflowEfficiency: number;
  convectiveSuppression: number;
  ewrcState: Typhoon["ewrcState"];
  ewrcCount: number;
  successfulEwrcCount: number;
  circulationExpansion: number;
  rapidIntensifying: boolean;
  coreCompactness: number;
  damageSeverity: number;
  extremeIntensityHours: number;
}): number {
  const {
    configuredPeak, environmentalMPI, vmax, sst, ohc, rh, shear, outflowEfficiency,
    convectiveSuppression, ewrcState, ewrcCount, successfulEwrcCount,
    circulationExpansion, rapidIntensifying, coreCompactness, damageSeverity,
    extremeIntensityHours
  } = params;

  const oceanSupport = clamp01((sst - 26.0) / 3.2) * (0.55 + 0.45 * clamp01(ohc / 105));
  const shearSupport = clamp01((18.5 - shear) / 13.0);
  const moistureSupport = clamp01((rh - 50) / 30);
  const ventilationSupport = clamp01(
    0.31 * oceanSupport +
    0.24 * shearSupport +
    0.18 * moistureSupport +
    0.15 * outflowEfficiency +
    0.12 * (1 - convectiveSuppression)
  );

  // Before the first successful ERC, do not hard-lock the cyclone below its eventual peak:
  // observational climatology includes storms that are already near peak when an ERC begins.
  // A small pre-first-cycle bias merely makes the first successful replacement/reintensification
  // a common lifetime-peak opportunity rather than a deterministic rule.
  let lifecycleFactor = 1.0;
  if (successfulEwrcCount <= 0 && configuredPeak >= 55 && ewrcCount <= 1) {
    lifecycleFactor = 0.94 + 0.045 * ventilationSupport + (rapidIntensifying ? 0.035 : 0);
  }
  if (ewrcState === "forming" || ewrcState === "max_decay") {
    // During the active replacement itself, the inner maximum normally stops intensifying and
    // then weakens while the secondary maximum contracts. The lifetime-peak controller therefore
    // cannot keep asking the storm to strengthen through an active double-eyewall exchange.
    lifecycleFactor *= 0.89;
  } else if (ewrcState === "recovering_success" && successfulEwrcCount <= 1) {
    lifecycleFactor = Math.max(lifecycleFactor, 0.985 + 0.015 * ventilationSupport);
  }

  // Subsequent successful ERCs normally enlarge RMW / broaden the wind field and often recover
  // to a similar or slightly lower Vmax. Keep this probabilistic/continuous rather than a hard rule.
  if (successfulEwrcCount >= 2) {
    const cyclePenalty = Math.min(0.11,
      0.018 * (successfulEwrcCount - 1) + 0.018 * clamp01(circulationExpansion / 1.5));
    const exceptionalEnvironmentRelief = 0.045 * smoothstep01((ventilationSupport - 0.82) / 0.16);
    lifecycleFactor *= 1 - Math.max(0, cyclePenalty - exceptionalEnvironmentRelief);
  }

  // >65 m/s requires sustained exceptional support.  This is a residence penalty, not a hard
  // maximum: deep warm water, low shear and a moist/ventilated compact core can hold the peak.
  const extremeRequested = smoothstep01((configuredPeak - 63) / 8);
  const extremeEnvironmentDeficit = clamp01((0.88 - ventilationSupport) / 0.34);
  const residenceFatigue = smoothstep01((extremeIntensityHours - 5) / 16);
  const extremeMaintenanceFactor = 1 - extremeRequested *
    (0.045 * extremeEnvironmentDeficit + 0.055 * extremeEnvironmentDeficit * residenceFatigue);

  const structureFactor = 1 - 0.10 * damageSeverity -
    0.035 * clamp01((0.52 - coreCompactness) / 0.42);

  const aspirationalPeak = configuredPeak * lifecycleFactor * extremeMaintenanceFactor * structureFactor;
  // The environment remains authoritative: a requested lifetime peak is never injected as energy.
  // Give only a tiny 0.6 m/s numerical allowance so the controller does not chatter around equality.
  return Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(aspirationalPeak, environmentalMPI + 0.6));
}

type SocietalExposureProfile = {
  populationDensity: number;
  infrastructureResilience: number;
  warningCapacity: number;
  evacuationCapacity: number;
  responseCapacity: number;
  warningReliability: number;
  responseDelayHours: number;
};

/**
 * Coarse regional exposure is combined with the shared warning/disaster-capability model. The
 * public bulletin system and casualty calculation therefore see the same institutional delays,
 * dissemination limits and evacuation capacity instead of using two unrelated country tables.
 */
function getSocietalExposureProfile(lat: number, lon: number): SocietalExposureProfile {
  const countryHint = getLandfallCountryGeoJson(lat, lon)?.country || "";
  const capability = getDisasterCapabilityProfile(lat, lon, countryHint);
  let populationDensity = 130;
  if (lat >= 21.5 && lat <= 25.6 && lon >= 119.3 && lon <= 122.6) populationDensity = 620;
  else if (lat >= 30.0 && lat <= 45.8 && lon >= 129.0 && lon <= 146.0) populationDensity = 330;
  else if (lat >= 33.0 && lat <= 39.2 && lon >= 124.0 && lon <= 131.0) populationDensity = 520;
  else if (/越南|vietnam/i.test(countryHint) || (lat >= 8.0 && lat <= 23.5 && lon >= 102.0 && lon <= 109.1)) populationDensity = 310;
  else if (/菲律宾|philippines/i.test(countryHint) || (lat >= 4.5 && lat <= 20.5 && lon >= 116.0 && lon <= 127.5)) populationDensity = 390;
  else if (/中国|china/i.test(countryHint) || (lat >= 18.0 && lat <= 41.5 && lon >= 106.0 && lon <= 123.5)) populationDensity = 520;

  const warningCapacity = clamp01(
    0.52 * capability.warningReliability +
    0.28 * capability.disseminationSpeed +
    0.20 * capability.classificationAccuracy
  );
  const responseDelayHours = Math.max(0,
    capability.bulletinDelayHours +
    2.8 * (1 - capability.disseminationSpeed) +
    2.2 * (1 - capability.responseCapacity)
  );
  return {
    populationDensity,
    infrastructureResilience: capability.infrastructureResilience,
    warningCapacity,
    evacuationCapacity: capability.evacuationCapacity,
    responseCapacity: capability.responseCapacity,
    warningReliability: capability.warningReliability,
    responseDelayHours
  };
}

function angularDifferenceDeg(a: number, b: number): number {
  let d = Math.abs(((a - b + 540) % 360) - 180);
  if (!Number.isFinite(d)) d = 0;
  return d;
}

const simulationConfigSnapshotCache = new WeakMap<SimulationConfig, SimulationConfig>();
const snapshotSimulationConfig = (config: SimulationConfig): SimulationConfig => {
  const cached = simulationConfigSnapshotCache.get(config);
  if (cached) return cached;
  // SimulationConfig objects are treated immutably by the React state layer. Reuse one deep-enough
  // history snapshot for the same config identity instead of allocating the same large config and
  // route arrays every archived hour. Historical values remain bit-for-bit identical/read-only.
  const snapshot: SimulationConfig = {
    ...config,
    categoryColors: config.categoryColors ? { ...config.categoryColors } : config.categoryColors,
    manualForecastRoute: config.manualForecastRoute?.map((p) => ({ lat: p.lat, lon: p.lon })) || [],
    manualForecastIntensityCurve: config.manualForecastIntensityCurve?.map((p) => ({ leadHour: p.leadHour, vmax: p.vmax })) || [],
    manualDryAirRegions: config.manualDryAirRegions?.map((r) => ({ ...r, points: r.points.map((p) => ({ lat: p.lat, lon: p.lon })) })) || [],
    manualShearRegions: config.manualShearRegions?.map((r) => ({ ...r, points: r.points.map((p) => ({ lat: p.lat, lon: p.lon })) })) || [],
    drawnTrackRoute: config.drawnTrackRoute?.map((p) => ({ lat: p.lat, lon: p.lon })) || []
  };
  simulationConfigSnapshotCache.set(config, snapshot);
  return snapshot;
};

// Smooth pulse used for externally imposed dry-air/shear episodes.  It avoids the old
// square-wave behavior: onset is gradual, the disruption peaks after several hours,
// and the vortex is allowed to reorganize as the episode ends.
function interventionPulse(remainingHours: number | undefined, totalHours: number | undefined): number {
  if (!totalHours || totalHours <= 0) return 0.08;
  const remaining = remainingHours ?? totalHours;
  const elapsed = Math.max(0, totalHours - remaining);
  const p = clamp01(elapsed / totalHours);

  // A disruption is rarely a square-wave forcing.  Dry-air ventilation, vortex tilt and
  // failed eyewall replacement usually need time to damage the core, accelerate once the
  // circulation loses symmetry, and then taper as the vortex either reorganizes or decays.
  // This skewed bell therefore produces the requested slow -> fast -> slow response.
  const bell = Math.pow(Math.max(0, Math.sin(Math.PI * p)), 1.48);
  const delayedSpinUp = 0.72 + 0.28 * smoothstep01(p / 0.34);
  const longTail = 0.92 + 0.08 * smoothstep01((1.0 - p) / 0.22);
  return 0.025 + 0.975 * bell * delayedSpinUp * longTail;
}

function environmentalAdversity(sst: number, shearKt: number, rh700: number, isLand: boolean): number {
  const shearTerm = clamp01((shearKt - 10.0) / 24.0);
  const dryTerm = clamp01((68.0 - rh700) / 32.0);
  const coolTerm = clamp01((27.0 - sst) / 3.0);
  const landTerm = isLand ? 0.8 : 0.0;
  return Math.max(0, Math.min(2.2, shearTerm * 0.85 + dryTerm * 0.65 + coolTerm * 0.55 + landTerm));
}

function effectiveDryAirStrength(lat: number, lon: number, config: SimulationConfig, simHour: number, rh700: number): number {
  if (!config.newEnvironmentPhysicsEnabled) return Math.max(0, config.dryAirStrength || 0);
  const env = getSynopticAtmosState(lat, lon, config, simHour);
  const humidityDeficit = clamp01((63 - rh700) / 35);
  return Math.max(0, Math.min(1.8, 1.15 * env.scores.dryAir + 0.55 * humidityDeficit));
}

function effectiveWesterlyDepth(lat: number, lon: number, config: SimulationConfig, simHour: number): number {
  if (!config.newEnvironmentPhysicsEnabled) {
    return config.westerliesEnabled
      ? clamp01((lat - ((config.westerliesLat ?? 30) - 4)) / 14)
      : 0;
  }
  const env = getSynopticAtmosState(lat, lon, config, simHour);
  return clamp01(Math.max(env.scores.westerlyJet, env.scores.midLatWesterlies * 0.88, env.scores.westerlyTrough * 0.72));
}


function smoothstep01(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}


interface BinaryCycloneInteraction {
  u: number;
  v: number;
  inducedShearKt: number;
  strength: number;
  partnerId?: string;
  partnerDistanceKm?: number;
  intensityTendency: number;
}

const NO_BINARY_CYCLONE_INTERACTION: BinaryCycloneInteraction = Object.freeze({
  u: 0, v: 0, inducedShearKt: 0, strength: 0, intensityTendency: 0
});

function meanWindRadius7(ty: Typhoon): number {
  const r = ty.r7;
  if (!r) return Math.max(90, ty.vmax * 4.6);
  const vals = [r.ne, r.se, r.sw, r.nw].filter((v) => Number.isFinite(v) && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Math.max(90, ty.vmax * 4.6);
}

/**
 * Direct binary/multi-cyclone interaction diagnosed from all simultaneously active vortices.
 * The formulation keeps the classic mutual cyclonic rotation at close range, adds a weaker
 * three-dimensional shear/repelling branch at 1000-1800 km, and weights displacement by the
 * counterpart circulation so a strong storm is not unrealistically slung around a weak TD.
 */
function diagnoseBinaryCycloneInteractions(typhoons: Typhoon[]): Map<string, BinaryCycloneInteraction> | null {
  // The common case is one active cyclone. Avoid allocating/filtering a Map on every 10-minute
  // physics step when binary interaction is mathematically impossible.
  if (typhoons.length < 2) return null;
  const active: Typhoon[] = [];
  for (const ty of typhoons) {
    if (ty.active && !ty.dissipated && ty.vmax >= MIN_CYCLONE_INTENSITY_MS) active.push(ty);
  }
  if (active.length < 2) return null;
  const result = new Map<string, BinaryCycloneInteraction>();
  for (const t of active) result.set(t.id, { u: 0, v: 0, inducedShearKt: 0, strength: 0, intensityTendency: 0 });

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const d = greatCircleDistanceKm(a.lat, a.lon, b.lat, b.lon);
      if (!Number.isFinite(d) || d < 1 || d > 1900) continue;
      const midLat = (a.lat + b.lat) * 0.5 * Math.PI / 180;
      const dx = (b.lon - a.lon) * 111.12 * Math.max(0.22, Math.cos(midLat));
      const dy = (b.lat - a.lat) * 111.12;
      const planar = Math.max(1, Math.hypot(dx, dy));
      const ex = dx / planar, ey = dy / planar;
      // Counter-clockwise/cyclonic tangent around the pair midpoint in the Northern Hemisphere.
      const tx = -ey, ty = ex;
      const ra = meanWindRadius7(a), rb = meanWindRadius7(b);
      const ca = Math.max(6, a.vmax) * Math.sqrt(Math.max(70, ra));
      const cb = Math.max(6, b.vmax) * Math.sqrt(Math.max(70, rb));
      const csum = Math.max(1, ca + cb);
      const closeGate = 1 - smoothstep01((d - 280) / 1180);      // fades by ~1460 km
      const directGate = 1 - smoothstep01((d - 420) / 650);      // strongest below ~1000 km
      const far3dGate = smoothstep01((d - 900) / 260) * (1 - smoothstep01((d - 1750) / 180));
      const intensityScale = clamp01((a.vmax + b.vmax - 24) / 86);
      const sizeScale = clamp01((ra + rb - 180) / 620);
      const interactionStrength = clamp01(closeGate * (0.48 + 0.34 * intensityScale + 0.18 * sizeScale) + 0.22 * far3dGate);
      if (interactionStrength <= 0.005) continue;

      const orbitBase = Math.min(8.6, (1.3 + 7.0 * Math.pow(directGate, 1.15)) * (0.72 + 0.45 * intensityScale));
      const attractBase = Math.min(2.4, 2.4 * Math.pow(Math.max(0, (760 - d) / 620), 1.15));
      const repelBase = 0.85 * far3dGate * (0.45 + 0.55 * intensityScale);
      const weightA = cb / csum;
      const weightB = ca / csum;
      const aDiag = result.get(a.id)!;
      const bDiag = result.get(b.id)!;
      // A moves tangent+inward toward B; B receives the equal geometric counterpart, but the
      // weaker circulation moves more because its partner contributes a larger share of csum.
      aDiag.u += (tx * orbitBase + ex * attractBase - ex * repelBase) * weightA;
      aDiag.v += (ty * orbitBase + ey * attractBase - ey * repelBase) * weightA;
      bDiag.u += (-tx * orbitBase - ex * attractBase + ex * repelBase) * weightB;
      bDiag.v += (-ty * orbitBase - ey * attractBase + ey * repelBase) * weightB;

      const shearBase = Math.min(24, (3.0 + 18.0 * directGate + 4.0 * far3dGate) * (0.45 + 0.55 * intensityScale));
      aDiag.inducedShearKt += shearBase * clamp01(cb / (0.70 * ca + cb));
      bDiag.inducedShearKt += shearBase * clamp01(ca / (0.70 * cb + ca));
      aDiag.strength = Math.max(aDiag.strength, interactionStrength);
      bDiag.strength = Math.max(bDiag.strength, interactionStrength);
      // Close binary interaction mainly ventilates/tilts the core. A dominant cyclone may later
      // recover or absorb the smaller vortex, but the approach itself is not free intensification.
      aDiag.intensityTendency -= 0.03 + 0.19 * directGate * clamp01(cb / ca);
      bDiag.intensityTendency -= 0.03 + 0.19 * directGate * clamp01(ca / cb);
      if ((aDiag.partnerDistanceKm ?? Infinity) > d) { aDiag.partnerDistanceKm = d; aDiag.partnerId = b.id; }
      if ((bDiag.partnerDistanceKm ?? Infinity) > d) { bDiag.partnerDistanceKm = d; bDiag.partnerId = a.id; }
    }
  }
  for (const diag of result.values()) {
    diag.inducedShearKt = Math.min(28, diag.inducedShearKt);
    const mag = Math.hypot(diag.u, diag.v);
    if (mag > 9.5) { diag.u *= 9.5 / mag; diag.v *= 9.5 / mag; }
    diag.intensityTendency = Math.max(-0.55, diag.intensityTendency);
  }
  return result;
}

function findNearestHistoryStateByHour(history: TyphoonState[] | undefined, targetHour: number): TyphoonState | undefined {
  if (!history?.length) return undefined;
  // Histories are appended in strictly increasing simulation-hour order. Binary lookup preserves
  // the former reduce() semantics exactly (including choosing the earlier state on an exact tie)
  // without rescanning the whole cyclone lifetime every 10-minute physics step.
  let lo = 0;
  let hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (Number(history[mid].simHour) < targetHour) lo = mid + 1;
    else hi = mid;
  }
  if (lo <= 0) return history[0];
  if (lo >= history.length) return history[history.length - 1];
  const before = history[lo - 1];
  const after = history[lo];
  const beforeDiff = Math.abs(Number(before.simHour) - targetHour);
  const afterDiff = Math.abs(Number(after.simHour) - targetHour);
  return afterDiff < beforeDiff ? after : before;
}

function getHistoryIntensityChange(history: TyphoonState[] | undefined, currentVmax: number, currentHour: number, lookbackHours: number): number {
  if (!history?.length) return 0;
  const targetHour = currentHour - lookbackHours;
  let sample = history[0];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].simHour <= targetHour + 0.01) {
      sample = history[i];
      break;
    }
  }
  return currentVmax - sample.vmax;
}

function episodeWave(seed: string, elapsedHours: number, simHour: number, amplitude: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const phase = (Math.abs(h) % 360) * Math.PI / 180;
  const slow = Math.sin(phase + elapsedHours * 0.72 + simHour * 0.045);
  const medium = Math.sin(phase * 1.7 + elapsedHours * 1.63);
  return 1 + amplitude * (0.68 * slow + 0.32 * medium);
}

function rapidProfileShape(progress: number): number {
  const p = clamp01(progress);
  // Mean near 1.0, but with a broad mid-episode maximum.  This keeps 24 h-equivalent
  // RI/ERI rates meaningful while avoiding straight-line intensity traces.
  return 0.78 + 0.40 * Math.pow(Math.sin(Math.PI * p), 1.28);
}

// 3.6.6: URI remains the same finite 25 h intervention, but its hourly intensification
// envelope is 1.3x the pre-3.6.6 calibration. Keep these values centralized so the live
// engine and 120 h forecast mirror cannot drift apart.
const URI_RATE_MULTIPLIER = 1.3;
const URI_RATE_MIN = 1.75 * URI_RATE_MULTIPLIER;
const URI_RATE_MAX = 1.82 * URI_RATE_MULTIPLIER;
const URI_RATE_CENTER = 1.785 * URI_RATE_MULTIPLIER;
const URI_RATE_SWING = 0.035 * URI_RATE_MULTIPLIER;

/**
 * Ventilation-style atmosphere stress. Dry air becomes much more damaging when shear
 * can actually transport it into the inner core; otherwise it primarily steals growth.
 * Absolute loss scales upward with an already-intense vortex, while warm deep water and
 * a still-weak circulation provide a buffer against peripheral dry-air / moderate shear.
 */
function getAtmosphericStress(
  vmax: number,
  sst: number,
  ohc: number,
  rh700: number,
  shearKt: number,
  speedKmh: number,
  configuredDryStrength: number = 0
) {
  const intensity = smoothstep01((vmax - 20.0) / 48.0);
  const oceanSupport = clamp01((sst - 26.4) / 2.8) * (0.55 + 0.45 * clamp01(ohc / 110.0));
  const dryDeficit = Math.max(clamp01((67.0 - rh700) / 34.0), clamp01(configuredDryStrength / 1.8) * 0.72);
  const shearStress = clamp01((shearKt - 8.0) / 25.0);
  // Tang/Emanuel-style interaction: shear + entropy deficit is substantially worse than either alone.
  const ventilation = clamp01(0.24 * dryDeficit + 0.28 * shearStress + 0.78 * dryDeficit * shearStress);
  const weakWarmBuffer = (1.0 - 0.78 * intensity) * oceanSupport;
  const decayThreshold = Math.max(0.34, Math.min(0.78, 0.61 + 0.17 * weakWarmBuffer - 0.18 * intensity));
  const excessVentilation = Math.max(0, ventilation - decayThreshold) / Math.max(0.12, 1.0 - decayThreshold);
  // Stronger systems lose more m/s per hour once the inner core is ventilated, even though
  // a modest structural-resilience term keeps this from being a simplistic proportional crash.
  const absoluteImpact = (0.34 + 1.10 * intensity) * (1.0 - 0.14 * intensity);
  // Dry-air ventilation should primarily stop development below Chinese force 12. Above that
  // threshold, Dvorak-style structural integrity becomes increasingly important and inner-core
  // ventilation is allowed to produce a much larger absolute weakening response. Shear-only
  // weakening remains available at lower intensities.
  const dvorakDryGate = smoothstep01((vmax - 32.7) / 10.0);
  const dryDrivenFraction = clamp01((dryDeficit * (0.45 + 0.55 * shearStress)) / Math.max(0.08, ventilation));
  const lowIntensityDryProtection = 1.0 - 0.88 * dryDrivenFraction * (1.0 - dvorakDryGate);
  const ventilationDecay = -0.62 * Math.pow(excessVentilation, 1.22) * absoluteImpact * Math.max(0.08, lowIntensityDryProtection);

  // User-requested motion-relative shear begins above 28 km/h. It is deliberately mild for
  // ordinary strengthening but strongly suppresses the probability of a new RI episode.
  const motionStress = smoothstep01((speedKmh - 28.0) / 20.0);
  const motionGrowthFactor = 1.0 - 0.16 * motionStress;
  const riProbabilityFactor = speedKmh <= 28.0 ? 1.0 : Math.max(0.08, 1.0 - 0.90 * smoothstep01((speedKmh - 28.0) / 16.0));

  // Below the weakening threshold, moderate dry air / shear mainly suppresses growth.
  const growthSuppression = clamp01(0.58 * ventilation + 0.18 * dryDeficit + 0.12 * shearStress);
  return { intensity, oceanSupport, dryDeficit, shearStress, ventilation, ventilationDecay, growthSuppression, motionStress, motionGrowthFactor, riProbabilityFactor };
}

// Bounding box / simplified polygon representing mainlands & islands
export interface LandMass {
  name: string;
  isMountain: boolean;
  maxElevation: number; // meters
  polygon: [number, number][]; // [lat, lon]
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

// Helper to calculate bounding box for fast spatial indexing
function withBBox(land: LandMass): LandMass {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of land.polygon) {
    if (p[0] < minLat) minLat = p[0];
    if (p[0] > maxLat) maxLat = p[0];
    if (p[1] < minLon) minLon = p[1];
    if (p[1] > maxLon) maxLon = p[1];
  }
  return { ...land, bbox: { minLat, maxLat, minLon, maxLon } };
}

// Dynamic getter for GSHHG FULL Resolution (f) Level 1 landmasses
export function getGSHHGFullLandArray(): LandMass[] {
  const masses = getGSHHGFullLandMasses();
  return masses.map((m) => ({
    name: m.name || `GSHHS_f_L1_${m.id}`,
    isMountain: m.isMountain,
    maxElevation: m.maxElevation,
    polygon: m.polygon,
    bbox: m.bbox
  }));
}

export const PACIFIC_OCEAN_LAND: LandMass[] = new Proxy([] as LandMass[], {
  get(target, prop, receiver) {
    const arr = getGSHHGFullLandArray();
    if (prop === "length") return arr.length;
    if (prop === "forEach") return arr.forEach.bind(arr);
    if (prop === "map") return arr.map.bind(arr);
    if (prop === "some") return arr.some.bind(arr);
    if (prop === "filter") return arr.filter.bind(arr);
    if (prop === "find") return arr.find.bind(arr);
    if (typeof prop === "symbol" || !isNaN(Number(prop))) {
      return Reflect.get(arr, prop, receiver);
    }
    return Reflect.get(arr, prop, receiver);
  }
});

export const EAST_ASIA_LAND = PACIFIC_OCEAN_LAND;

// Retired hand-drawn coastline polygons removed. Rendering and product maps use detailed Natural Earth geometry.


// Optimized Helper: Bounding-box pre-filtering + Point in Polygon algorithm
export function checkPointInPolygon(lat: number, lon: number, polygon: [number, number][], bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number }): boolean {
  if (bbox) {
    if (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLon || lon > bbox.maxLon) {
      return false;
    }
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];

    const intersect = ((yi > lat) !== (yj > lat))
        && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates high-precision geographic elevation (meters) based on real East Asia topography.
 * Combines distance ratio curves with major mountain range ridges and high-frequency deterministic fractal noise.
 */
function getPreciseElevation(
  lat: number,
  lon: number,
  landName: string,
  baseElevation: number,
  distRatio: number
): number {
  let peakAdded = 0;

  // 1. Taiwan Central Mountain Range (中央山脉) - peaks up to 3952m
  if (lat >= 21.8 && lat <= 25.5 && lon >= 120.0 && lon <= 122.2) {
    const distToRidge = distToSegment(lat, lon, 22.0, 120.8, 25.3, 121.6);
    if (distToRidge < 0.6) {
      const ridgeFactor = 1.0 - (distToRidge / 0.6);
      peakAdded = Math.max(peakAdded, 3952 * ridgeFactor * Math.sin(Math.PI * (lat - 21.8) / 3.7));
    }
  }

  // 2. Mt. Fuji & Japanese Alps (日本阿尔卑斯山脉与富士山) - 3776m and 2800m
  if (lat >= 33.5 && lat <= 38.0 && lon >= 135.0 && lon <= 140.5) {
    const distToFuji = Math.sqrt(Math.pow(lat - 35.36, 2) + Math.pow(lon - 138.73, 2));
    if (distToFuji < 0.3) {
      const fujiFactor = 1.0 - (distToFuji / 0.3);
      peakAdded = Math.max(peakAdded, 3776 * fujiFactor);
    }

    const distToAlps = distToSegment(lat, lon, 35.0, 137.5, 36.8, 138.0);
    if (distToAlps < 0.5) {
      const alpsFactor = 1.0 - (distToAlps / 0.5);
      peakAdded = Math.max(peakAdded, 2800 * alpsFactor);
    }
  }

  // 3. Fujian Wuyi Mountains (武夷山脉) - peaks up to 2158m
  if (lat >= 24.5 && lat <= 28.5 && lon >= 115.5 && lon <= 119.5) {
    const distToWuyi = distToSegment(lat, lon, 25.5, 116.5, 28.2, 118.5);
    if (distToWuyi < 0.8) {
      const wuyiFactor = 1.0 - (distToWuyi / 0.8);
      peakAdded = Math.max(peakAdded, 2158 * wuyiFactor * Math.sin(Math.PI * (lat - 24.5) / 4.0));
    }
  }

  // 4. Luzon Cordillera Central (吕宋岛科迪勒拉山脉) - up to 2928m
  if (lat >= 15.0 && lat <= 19.0 && lon >= 119.8 && lon <= 122.5) {
    const distToCordillera = distToSegment(lat, lon, 15.8, 120.8, 18.5, 121.0);
    if (distToCordillera < 0.6) {
      const cordFactor = 1.0 - (distToCordillera / 0.6);
      peakAdded = Math.max(peakAdded, 2928 * cordFactor);
    }
  }

  // 5. Hainan Wuzhi Mountain (海南五指山) - up to 1840m
  if (lat >= 18.2 && lat <= 20.2 && lon >= 108.5 && lon <= 111.0) {
    const distToWuzhi = Math.sqrt(Math.pow(lat - 18.9, 2) + Math.pow(lon - 109.7, 2));
    if (distToWuzhi < 0.5) {
      const wuzhiFactor = 1.0 - (distToWuzhi / 0.5);
      peakAdded = Math.max(peakAdded, 1840 * wuzhiFactor);
    }
  }

  // 6. Korean Taebaek Mountains (朝鲜半岛太白山脉) - up to 1915m
  if (lat >= 34.5 && lat <= 41.5 && lon >= 126.5 && lon <= 130.0) {
    const distToTaebaek = distToSegment(lat, lon, 35.5, 128.8, 40.5, 127.5);
    if (distToTaebaek < 0.7) {
      const taebaekFactor = 1.0 - (distToTaebaek / 0.7);
      peakAdded = Math.max(peakAdded, 1915 * taebaekFactor);
    }
  }

  // 7. Mindanao Mt. Apo (棉兰老岛阿波火山) - up to 2954m
  if (lat >= 5.5 && lat <= 9.0 && lon >= 124.0 && lon <= 126.8) {
    const distToApo = Math.sqrt(Math.pow(lat - 7.0, 2) + Math.pow(lon - 125.4, 2));
    if (distToApo < 0.4) {
      const apoFactor = 1.0 - (distToApo / 0.4);
      peakAdded = Math.max(peakAdded, 2954 * apoFactor);
    }
  }

  // 7b. Palau Islands Peak - up to 242m
  if (lat >= 7.0 && lat <= 7.8 && lon >= 134.0 && lon <= 135.0) {
    const distToPalau = Math.sqrt(Math.pow(lat - 7.4, 2) + Math.pow(lon - 134.5, 2));
    if (distToPalau < 0.2) {
      const palauFactor = 1.0 - (distToPalau / 0.2);
      peakAdded = Math.max(peakAdded, 242 * palauFactor);
    }
  }

  // 7c. Yap Islands Peak - up to 178m
  if (lat >= 9.1 && lat <= 9.8 && lon >= 137.7 && lon <= 138.5) {
    const distToYap = Math.sqrt(Math.pow(lat - 9.5, 2) + Math.pow(lon - 138.1, 2));
    if (distToYap < 0.2) {
      const yapFactor = 1.0 - (distToYap / 0.2);
      peakAdded = Math.max(peakAdded, 178 * yapFactor);
    }
  }

  // 7d. Chuuk Islands Peak - up to 443m
  if (lat >= 7.0 && lat <= 7.7 && lon >= 151.4 && lon <= 152.2) {
    const distToChuuk = Math.sqrt(Math.pow(lat - 7.3, 2) + Math.pow(lon - 151.8, 2));
    if (distToChuuk < 0.25) {
      const chuukFactor = 1.0 - (distToChuuk / 0.25);
      peakAdded = Math.max(peakAdded, 443 * chuukFactor);
    }
  }

  // 7e. Nanling Mountains (华南沿海屏障南岭山脉) - up to 1902m (石坑崆)
  if (lat >= 24.0 && lat <= 26.5 && lon >= 110.0 && lon <= 114.5) {
    const distToNanling = distToSegment(lat, lon, 24.5, 110.5, 25.5, 114.0);
    if (distToNanling < 0.7) {
      const nanlingFactor = 1.0 - (distToNanling / 0.7);
      peakAdded = Math.max(peakAdded, 1902 * nanlingFactor);
    }
  }

  // 7f. Mount Tai (山东泰山) - up to 1545m
  if (lat >= 35.8 && lat <= 36.6 && lon >= 116.8 && lon <= 117.6) {
    const distToTai = Math.sqrt(Math.pow(lat - 36.25, 2) + Math.pow(lon - 117.1, 2));
    if (distToTai < 0.3) {
      const taiFactor = 1.0 - (distToTai / 0.3);
      peakAdded = Math.max(peakAdded, 1545 * taiFactor);
    }
  }

  // 7g. Mount Asahi (日本北海道旭岳) - up to 2291m
  if (lat >= 43.0 && lat <= 44.2 && lon >= 142.0 && lon <= 143.5) {
    const distToAsahi = Math.sqrt(Math.pow(lat - 43.66, 2) + Math.pow(lon - 142.85, 2));
    if (distToAsahi < 0.45) {
      const asahiFactor = 1.0 - (distToAsahi / 0.45);
      peakAdded = Math.max(peakAdded, 2291 * asahiFactor);
    }
  }

  // Combine base estimation and mountain peaks
  let elevation = Math.max(baseElevation, peakAdded);

  // 8. Add high-frequency terrain noise (simulates ravines, hills, and valleys)
  const f1 = Math.sin(lat * 37.3) * Math.sin(lon * 43.1) * 110;
  const f2 = Math.cos(lat * 79.7) * Math.sin(lon * 83.2) * 55;
  const f3 = Math.sin(lat * 183.5) * Math.cos(lon * 194.2) * 20;
  const localNoise = f1 + f2 + f3;

  // Fade out noise near the shores to ensure beaches/harbors are flat
  const fadeFactor = Math.min(distRatio * 5.0, 1.0);
  elevation += localNoise * fadeFactor;

  return Math.max(10, Math.round(elevation));
}

// 1. Precise, procedural mountain elevation profiles for West Pacific landmasses
const PROCEDURAL_MOUNTAIN_RANGES = [
  // Taiwan (Central Mountain Range) - Peaks up to 3952m
  { name: "Central Mountain Range (Taiwan)", peakLat: 23.8, peakLon: 121.0, maxElevation: 3952, radiusX: 0.8, radiusY: 1.8 },
  // Hainan (Wuzhi Mountain) - Peaks up to 1867m
  { name: "Wuzhi Mountain (Hainan)", peakLat: 18.9, peakLon: 109.7, maxElevation: 1867, radiusX: 0.7, radiusY: 0.5 },
  // Luzon Central Mountains (Philippines) - Peaks up to 2928m
  { name: "Cordillera Central (Luzon)", peakLat: 16.8, peakLon: 121.0, maxElevation: 2928, radiusX: 0.9, radiusY: 2.2 },
  // Honshu Alps & Fuji (Japan) - Peaks up to 3776m
  { name: "Japanese Alps & Mt Fuji (Honshu)", peakLat: 35.8, peakLon: 138.2, maxElevation: 3776, radiusX: 2.5, radiusY: 3.5 },
  // Jeju Island (Mount Hallasan) - Peaks up to 1947m
  { name: "Mt Hallasan (Jeju)", peakLat: 33.36, peakLon: 126.53, maxElevation: 1947, radiusX: 0.25, radiusY: 0.15 },
  // Korean Peninsula (Taebaek Mountains) - Peaks up to 1708m
  { name: "Taebaek Mountains", peakLat: 37.8, peakLon: 128.5, maxElevation: 1708, radiusX: 1.2, radiusY: 2.5 },
  // Kyushu Mountains (Japan) - Peaks up to 1700m
  { name: "Kyushu Mountains", peakLat: 32.4, peakLon: 130.8, maxElevation: 1700, radiusX: 0.8, radiusY: 1.0 },
  // Hokkaido Mountains (Japan) - Peaks up to 2291m
  { name: "Hokkaido Mountains", peakLat: 43.4, peakLon: 142.5, maxElevation: 2291, radiusX: 1.5, radiusY: 1.5 },
  // Mindanao (Mount Apo) - Peaks up to 2954m
  { name: "Mt Apo (Mindanao)", peakLat: 7.0, peakLon: 125.2, maxElevation: 2954, radiusX: 1.0, radiusY: 1.2 },
  // Sumatra (Barisan Mountains) - Peaks up to 3800m
  { name: "Barisan Mountains (Sumatra)", peakLat: -1.0, peakLon: 101.0, maxElevation: 3800, radiusX: 3.0, radiusY: 6.0 },
  // Southeast China (Wuyi Mountains) - Peaks up to 2158m
  { name: "Wuyi Mountains", peakLat: 27.5, peakLon: 117.5, maxElevation: 2158, radiusX: 2.5, radiusY: 3.0 },
  // South China (Nanling Mountains) - Peaks up to 1900m
  { name: "Nanling Mountains", peakLat: 25.0, peakLon: 113.0, maxElevation: 1900, radiusX: 3.0, radiusY: 2.0 },
  // Kamchatka Peninsula (Klyuchevskaya Sopka) - Peaks up to 4750m
  { name: "Kamchatka Volcanoes", peakLat: 56.0, peakLon: 160.5, maxElevation: 4750, radiusX: 2.0, radiusY: 5.0 }
];

/**
 * Legacy API name retained for compatibility. Terrain now comes from a coarse 0.25°
 * western-North-Pacific grid derived from NOAA/NCEI ETOPO1 relief.  The old hand-built
 * Gaussian mountain list is used only as a fallback outside the embedded terrain domain.
 */
export function getProceduralElevation(lat: number, lon: number): number {
  const etopo = getEtopoTerrainElevation(lat, lon);
  if (etopo !== null) {
    // Never replace a valid zero-height ETOPO/ocean cell with an invented 100 m mountain.
    return landGeoJson?.features && !checkPointOnLandGeoJson(lat, lon) ? 0 : Math.round(etopo);
  }

  let elevation = 100;
  for (const range of PROCEDURAL_MOUNTAIN_RANGES) {
    const dx = (lon - range.peakLon) / range.radiusX;
    const dy = (lat - range.peakLat) / range.radiusY;
    const distSq = dx * dx + dy * dy;
    if (distSq < 1.0) {
      const currentElevation = range.maxElevation * Math.exp(-distSq * 1.5);
      if (currentElevation > elevation) elevation = currentElevation;
    }
  }
  return Math.round(elevation);
}

// Get filtered landmasses based on GSHHG Full Resolution (f) dataset
export function getFilteredLandMasses(coastlineSource?: string): LandMass[] {
  return getGSHHGFullLandArray();
}

interface CoastalCity {
  n: string;
  p: string;
  c: string;
  lat: number;
  lon: number;
}

const COASTAL_CITIES: CoastalCity[] = [
  // Special Administrative Regions
  { n: "香港", p: "特别行政区", c: "中国", lat: 22.32, lon: 114.17 },
  { n: "澳门", p: "特别行政区", c: "中国", lat: 22.19, lon: 113.54 },

  // Hainan
  { n: "海口市", p: "海南省", c: "中国", lat: 20.03, lon: 110.33 },
  { n: "文昌市", p: "海南省", c: "中国", lat: 19.61, lon: 110.79 },
  { n: "琼海市", p: "海南省", c: "中国", lat: 19.24, lon: 110.47 },
  { n: "万宁市", p: "海南省", c: "中国", lat: 18.80, lon: 110.39 },
  { n: "陵水县", p: "海南省", c: "中国", lat: 18.48, lon: 110.04 },
  { n: "三亚市", p: "海南省", c: "中国", lat: 18.25, lon: 109.51 },
  { n: "东方市", p: "海南省", c: "中国", lat: 19.10, lon: 108.65 },
  { n: "儋州市", p: "海南省", c: "中国", lat: 19.52, lon: 109.57 },

  // Guangdong
  { n: "徐闻县", p: "广东省", c: "中国", lat: 20.33, lon: 110.18 },
  { n: "雷州市", p: "广东省", c: "中国", lat: 20.91, lon: 110.10 },
  { n: "湛江市", p: "广东省", c: "中国", lat: 21.27, lon: 110.36 },
  { n: "吴川市", p: "广东省", c: "中国", lat: 21.44, lon: 110.78 },
  { n: "茂名市", p: "广东省", c: "中国", lat: 21.66, lon: 110.92 },
  { n: "阳西县", p: "广东省", c: "中国", lat: 21.75, lon: 111.62 },
  { n: "阳江市", p: "广东省", c: "中国", lat: 21.85, lon: 111.98 },
  { n: "台山市", p: "广东省", c: "中国", lat: 21.93, lon: 112.79 },
  { n: "珠海市", p: "广东省", c: "中国", lat: 22.27, lon: 113.58 },
  { n: "中山市", p: "广东省", c: "中国", lat: 22.52, lon: 113.52 },
  { n: "广州市(南沙)", p: "广东省", c: "中国", lat: 22.71, lon: 113.60 },
  { n: "深圳市", p: "广东省", c: "中国", lat: 22.54, lon: 114.06 },
  { n: "惠州市", p: "广东省", c: "中国", lat: 22.75, lon: 114.45 },
  { n: "海丰县", p: "广东省", c: "中国", lat: 22.97, lon: 115.33 },
  { n: "汕尾市", p: "广东省", c: "中国", lat: 22.78, lon: 115.36 },
  { n: "陆丰市", p: "广东省", c: "中国", lat: 22.94, lon: 115.65 },
  { n: "惠来县", p: "广东省", c: "中国", lat: 23.03, lon: 116.29 },
  { n: "汕头市", p: "广东省", c: "中国", lat: 23.35, lon: 116.68 },
  { n: "潮州市", p: "广东省", c: "中国", lat: 23.66, lon: 116.63 },

  // Guangxi
  { n: "北海市", p: "广西壮族自治区", c: "中国", lat: 21.48, lon: 109.12 },
  { n: "钦州市", p: "广西壮族自治区", c: "中国", lat: 21.95, lon: 108.62 },
  { n: "防城港市", p: "广西壮族自治区", c: "中国", lat: 21.61, lon: 108.35 },

  // Fujian
  { n: "诏安县", p: "福建省", c: "中国", lat: 23.72, lon: 117.17 },
  { n: "东山县", p: "福建省", c: "中国", lat: 23.70, lon: 117.43 },
  { n: "漳浦县", p: "福建省", c: "中国", lat: 24.12, lon: 117.61 },
  { n: "龙海区", p: "福建省", c: "中国", lat: 24.44, lon: 117.81 },
  { n: "厦门市", p: "福建省", c: "中国", lat: 24.48, lon: 118.09 },
  { n: "晋江市", p: "福建省", c: "中国", lat: 24.58, lon: 118.55 },
  { n: "石狮市", p: "福建省", c: "中国", lat: 24.73, lon: 118.65 },
  { n: "泉州市", p: "福建省", c: "中国", lat: 24.87, lon: 118.68 },
  { n: "莆田市", p: "福建省", c: "中国", lat: 25.43, lon: 119.01 },
  { n: "平潭县", p: "福建省", c: "中国", lat: 25.50, lon: 119.79 },
  { n: "福清市", p: "福建省", c: "中国", lat: 25.72, lon: 119.38 },
  { n: "长乐区", p: "福建省", c: "中国", lat: 25.96, lon: 119.52 },
  { n: "福州市", p: "福建省", c: "中国", lat: 26.07, lon: 119.30 },
  { n: "连江县", p: "福建省", c: "中国", lat: 26.20, lon: 119.54 },
  { n: "罗源县", p: "福建省", c: "中国", lat: 26.48, lon: 119.55 },
  { n: "宁德市", p: "福建省", c: "中国", lat: 26.66, lon: 119.52 },
  { n: "霞浦县", p: "福建省", c: "中国", lat: 26.88, lon: 120.00 },
  { n: "福鼎市", p: "福建省", c: "中国", lat: 27.32, lon: 120.21 },

  // Zhejiang
  { n: "苍南县", p: "浙江省", c: "中国", lat: 27.52, lon: 120.40 },
  { n: "平阳县", p: "浙江省", c: "中国", lat: 27.66, lon: 120.55 },
  { n: "瑞安市", p: "浙江省", c: "中国", lat: 27.78, lon: 120.65 },
  { n: "温州市", p: "浙江省", c: "中国", lat: 27.99, lon: 120.70 },
  { n: "乐清市", p: "浙江省", c: "中国", lat: 28.12, lon: 120.96 },
  { n: "玉环市", p: "浙江省", c: "中国", lat: 28.13, lon: 121.12 },
  { n: "温岭市", p: "浙江省", c: "中国", lat: 28.36, lon: 121.36 },
  { n: "台州市", p: "浙江省", c: "中国", lat: 28.66, lon: 121.42 },
  { n: "三门县", p: "浙江省", c: "中国", lat: 29.11, lon: 121.39 },
  { n: "象山县", p: "浙江省", c: "中国", lat: 29.48, lon: 121.87 },
  { n: "宁波市", p: "浙江省", c: "中国", lat: 29.87, lon: 121.54 },
  { n: "舟山市", p: "浙江省", c: "中国", lat: 29.99, lon: 122.21 },
  { n: "平湖市", p: "浙江省", c: "中国", lat: 30.68, lon: 121.02 },

  // Shanghai
  { n: "金山区", p: "上海市", c: "中国", lat: 30.74, lon: 121.34 },
  { n: "奉贤区", p: "上海市", c: "中国", lat: 30.91, lon: 121.47 },
  { n: "浦东新区", p: "上海市", c: "中国", lat: 31.22, lon: 121.54 },
  { n: "上海市", p: "上海市", c: "中国", lat: 31.23, lon: 121.47 },
  { n: "崇明区", p: "上海市", c: "中国", lat: 31.62, lon: 121.40 },

  // Jiangsu
  { n: "启东市", p: "江苏省", c: "中国", lat: 31.81, lon: 121.66 },
  { n: "盐城市", p: "江苏省", c: "中国", lat: 33.35, lon: 120.16 },
  { n: "连云港市", p: "江苏省", c: "中国", lat: 34.60, lon: 119.22 },

  // Shandong
  { n: "日照市", p: "山东省", c: "中国", lat: 35.42, lon: 119.52 },
  { n: "青岛市", p: "山东省", c: "中国", lat: 36.07, lon: 120.38 },
  { n: "威海市", p: "山东省", c: "中国", lat: 37.50, lon: 122.12 },
  { n: "烟台市", p: "山东省", c: "中国", lat: 37.54, lon: 121.39 },

  // North
  { n: "滨海新区", p: "天津市", c: "中国", lat: 39.03, lon: 117.68 },
  { n: "秦皇岛市", p: "河北省", c: "中国", lat: 39.94, lon: 119.60 },
  { n: "大连市", p: "辽宁省", c: "中国", lat: 38.91, lon: 121.61 },

  // Taiwan
  { n: "恒春镇", p: "台湾省", c: "中国", lat: 22.00, lon: 120.74 },
  { n: "高雄市", p: "台湾省", c: "中国", lat: 22.63, lon: 120.30 },
  { n: "台东县", p: "台湾省", c: "中国", lat: 22.76, lon: 121.15 },
  { n: "台南市", p: "台湾省", c: "中国", lat: 23.00, lon: 120.23 },
  { n: "澎湖县", p: "台湾省", c: "中国", lat: 23.57, lon: 119.57 },
  { n: "花莲县", p: "台湾省", c: "中国", lat: 23.98, lon: 121.61 },
  { n: "台中市", p: "台湾省", c: "中国", lat: 24.15, lon: 120.68 },
  { n: "宜兰县", p: "台湾省", c: "中国", lat: 24.76, lon: 121.76 },
  { n: "台北市", p: "台湾省", c: "中国", lat: 25.03, lon: 121.57 },
  { n: "基隆市", p: "台湾省", c: "中国", lat: 25.13, lon: 121.74 },

  // Japan
  { n: "石垣市", p: "冲绳县", c: "日本", lat: 24.34, lon: 124.16 },
  { n: "宫古岛市", p: "冲绳县", c: "日本", lat: 24.81, lon: 125.28 },
  { n: "那霸市", p: "冲绳县", c: "日本", lat: 26.21, lon: 127.68 },
  { n: "奄美市", p: "鹿儿岛县", c: "日本", lat: 28.37, lon: 129.49 },
  { n: "屋久岛町", p: "鹿儿岛县", c: "日本", lat: 30.34, lon: 130.51 },
  { n: "鹿儿岛市", p: "鹿儿岛县", c: "日本", lat: 31.60, lon: 130.56 },
  { n: "宫崎市", p: "宫崎县", c: "日本", lat: 31.91, lon: 131.42 },
  { n: "长崎市", p: "长崎县", c: "日本", lat: 32.75, lon: 129.87 },
  { n: "土佐清水市", p: "高知县", c: "日本", lat: 32.78, lon: 132.95 },
  { n: "熊本市", p: "熊本县", c: "日本", lat: 32.80, lon: 130.70 },
  { n: "高知市", p: "高知县", c: "日本", lat: 33.56, lon: 133.53 },
  { n: "福冈市", p: "福冈县", c: "日本", lat: 33.59, lon: 130.40 },
  { n: "松山市", p: "爱媛县", c: "日本", lat: 33.84, lon: 132.76 },
  { n: "串本町(潮岬)", p: "和歌山县", c: "日本", lat: 33.43, lon: 135.78 },
  { n: "和歌山市", p: "和歌山县", c: "日本", lat: 34.23, lon: 135.17 },
  { n: "广岛市", p: "广岛县", c: "日本", lat: 34.38, lon: 132.45 },
  { n: "大阪市", p: "大阪府", c: "日本", lat: 34.69, lon: 135.50 },
  { n: "神户市", p: "兵库县", c: "日本", lat: 34.69, lon: 135.19 },
  { n: "静冈市", p: "静冈县", c: "日本", lat: 34.98, lon: 138.38 },
  { n: "馆山市", p: "千叶县", c: "日本", lat: 34.99, lon: 139.86 },
  { n: "横滨市", p: "神奈川县", c: "日本", lat: 35.44, lon: 139.63 },
  { n: "东京", p: "东京都", c: "日本", lat: 35.68, lon: 139.65 },
  { n: "仙台市", p: "宫城县", c: "日本", lat: 38.27, lon: 140.87 },
  { n: "函馆市", p: "北海道", c: "日本", lat: 41.77, lon: 140.72 },

  // Korea
  { n: "西归浦市", p: "济州特别自治道", c: "韩国", lat: 33.25, lon: 126.56 },
  { n: "济州市", p: "济州特别自治道", c: "韩国", lat: 33.50, lon: 126.53 },
  { n: "木浦市", p: "全罗南道", c: "韩国", lat: 34.81, lon: 126.39 },
  { n: "丽水市", p: "全罗南道", c: "韩国", lat: 34.76, lon: 127.66 },
  { n: "统营市", p: "庆尚南道", c: "韩国", lat: 34.85, lon: 128.42 },
  { n: "昌原市", p: "庆尚南道", c: "韩国", lat: 35.15, lon: 128.68 },
  { n: "釜山市", p: "广域市", c: "韩国", lat: 35.18, lon: 129.08 },
  { n: "蔚山市", p: "广域市", c: "韩国", lat: 35.54, lon: 129.31 },
  { n: "浦项市", p: "庆尚北道", c: "韩国", lat: 36.02, lon: 129.37 },
  { n: "江陵市", p: "江原道", c: "韩国", lat: 37.75, lon: 128.90 },
  { n: "束草市", p: "江原道", c: "韩国", lat: 38.20, lon: 128.59 },
  { n: "仁川广域市", p: "广域市", c: "韩国", lat: 37.45, lon: 126.70 },
  { n: "首尔", p: "特别市", c: "韩国", lat: 37.57, lon: 126.98 },

  // Philippines — denser coastal catalogue avoids reporting every Luzon landfall as Manila/Aparri.
  { n: "巴士古镇", p: "巴坦群岛省", c: "菲律宾", lat: 20.45, lon: 121.97 },
  { n: "阿帕里镇", p: "卡加延省", c: "菲律宾", lat: 18.36, lon: 121.64 },
  { n: "土格加劳市", p: "卡加延省", c: "菲律宾", lat: 17.61, lon: 121.73 },
  { n: "佬沃市", p: "北伊罗戈省", c: "菲律宾", lat: 18.20, lon: 120.59 },
  { n: "维甘市", p: "南伊罗戈省", c: "菲律宾", lat: 17.57, lon: 120.39 },
  { n: "圣费尔南多市", p: "拉乌尼翁省", c: "菲律宾", lat: 16.62, lon: 120.32 },
  { n: "卡西古兰镇", p: "奥罗拉省", c: "菲律宾", lat: 16.28, lon: 122.12 },
  { n: "巴莱尔镇", p: "奥罗拉省", c: "菲律宾", lat: 15.76, lon: 121.56 },
  { n: "因凡塔镇", p: "奎松省", c: "菲律宾", lat: 14.74, lon: 121.65 },
  { n: "达特镇", p: "北甘马粦省", c: "菲律宾", lat: 14.11, lon: 122.95 },
  { n: "黎牙实比市", p: "阿尔拜省", c: "菲律宾", lat: 13.14, lon: 123.74 },
  { n: "维拉克镇", p: "卡坦端内斯省", c: "菲律宾", lat: 13.58, lon: 124.23 },
  { n: "卡塔曼镇", p: "北萨马省", c: "菲律宾", lat: 12.50, lon: 124.64 },
  { n: "塔克洛班市", p: "莱特省", c: "菲律宾", lat: 11.24, lon: 125.00 },
  { n: "苏里高市", p: "北苏里高省", c: "菲律宾", lat: 9.79, lon: 125.49 },
  { n: "马尼拉市", p: "大马尼拉区", c: "菲律宾", lat: 14.60, lon: 120.98 },

  // Vietnam
  { n: "下龙市", p: "广宁省", c: "越南", lat: 20.95, lon: 107.08 },
  { n: "海防市", p: "直辖市", c: "越南", lat: 20.84, lon: 106.69 },
  { n: "清化市", p: "清化省", c: "越南", lat: 19.81, lon: 105.78 },
  { n: "荣市", p: "乂安省", c: "越南", lat: 18.67, lon: 105.69 },
  { n: "顺化市", p: "直辖市", c: "越南", lat: 16.46, lon: 107.59 },
  { n: "岘港市", p: "直辖市", c: "越南", lat: 16.05, lon: 108.20 },
  { n: "广义市", p: "广义省", c: "越南", lat: 15.12, lon: 108.81 },
  { n: "归仁市", p: "嘉莱省", c: "越南", lat: 13.78, lon: 109.22 },
  { n: "芽庄市", p: "庆和省", c: "越南", lat: 12.25, lon: 109.19 },

  // Micronesian islands: naming only; these islands are intentionally ignored by wind-circle squeeze.
  { n: "阿加尼亚", p: "关岛", c: "美国", lat: 13.47, lon: 144.75 }
];

function getClosestCity(lat: number, lon: number, filterCountry: string, filterProvince?: string): string {
  let bestCity: typeof COASTAL_CITIES[0] | null = null;
  let minDist = Number.POSITIVE_INFINITY;
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));

  for (const c of COASTAL_CITIES) {
    if (filterCountry && c.c !== filterCountry) continue;
    if (filterProvince && c.p !== filterProvince) continue;
    const dLat = c.lat - lat;
    const dLon = (c.lon - lon) * cosLat;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < minDist) { minDist = dist; bestCity = c; }
  }

  // Never jump across borders just because a filtered catalogue happens to be sparse.
  // Beyond ~360 km, report a province/country coastal sector instead of a misleading city.
  const approxKm = Math.sqrt(minDist) * 111.12;
  if (!bestCity || approxKm > 360) {
    if (filterProvince) return `${filterCountry || ""}${filterProvince}沿海`;
    if (filterCountry) return `${filterCountry}沿海`;
    return "沿海地区";
  }

  if (bestCity.c === "中国") {
    if (bestCity.p === "特别行政区") return `中国${bestCity.n}特别行政区`;
    if (bestCity.p === "台湾省") return `中国台湾省${bestCity.n}`;
    return `中国${bestCity.p}${bestCity.n}`;
  }
  if (bestCity.c === "美国" && bestCity.p === "关岛") return `关岛${bestCity.n}`;
  return `${bestCity.c}${bestCity.p}${bestCity.n}`;
}

function normalizeLandCountry(country: string): string {
  const raw = (country || "").trim();
  const lower = raw.toLowerCase();
  if (["china", "中国", "中华人民共和国", "people's republic of china"].includes(lower) || raw === "中华人民共和国") return "中国";
  if (["taiwan", "taiwan, province of china", "台湾", "中國台灣"].includes(lower) || raw.includes("台湾")) return "中国";
  if (["japan", "日本"].includes(lower)) return "日本";
  if (["south korea", "republic of korea", "korea, republic of", "韩国", "韓國"].includes(lower)) return "韩国";
  if (["north korea", "democratic people's republic of korea", "朝鲜", "朝鮮"].includes(lower)) return "朝鲜";
  if (["philippines", "the philippines", "菲律宾", "菲律賓"].includes(lower)) return "菲律宾";
  if (["vietnam", "viet nam", "越南"].includes(lower)) return "越南";
  if (lower === "guam" || raw === "关岛" || raw === "關島") return "关岛";
  return raw;
}

// OSM Nominatim Reverse Geocoding Cache & Fetcher
const osmLocationCache = new Map<string, string>();

export async function fetchOsmCityName(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (osmLocationCache.has(key)) {
    return osmLocationCache.get(key)!;
  }

  const fallback = getDetailedLandName(lat, lon, "", "");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    // Increase zoom to 12 for better city/district precision
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&accept-language=zh-CN`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TyphoonSim/2.0 (Meteorological-Simulation-App)' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.address) {
        const addr = data.address;
        const state = addr.state || addr.province || addr.region || addr.municipality || "";
        const city = addr.city || addr.county || addr.town || addr.municipality || addr.district || addr.suburb || "";
        let osmName = "";
        
        if (state && city) {
          // Special handling for municipalities like Shanghai
          if (state.endsWith('市') && city.endsWith('区')) {
             osmName = `${state}${city}`;
          } else {
             osmName = state.includes(city) ? state : `${state}${city}`;
          }
        } else if (city) {
          osmName = city;
        } else if (state) {
          osmName = state;
        } else if (data.display_name) {
          osmName = data.display_name.split(",")[0];
        }

        if (osmName) {
          // Clean up common redundant suffixes for cleaner display
          osmName = osmName.replace(/中华人民共和国/g, '');
          osmLocationCache.set(key, osmName);
          return osmName;
        }
      }
    }
  } catch (e) {
    // Silent catch, fallback
  }

  osmLocationCache.set(key, fallback);
  return fallback;
}

// Centralized highly precise resolver for refined landfall naming in the Northwest Pacific

// City-level label for temporary diagnostic stations and report diagnostic grids.
// Deliberately avoid district/county/suburb labels: every land station in the UI is named only
// to city level, while ocean diagnostics retain the generic buoy/ocean label.
const osmStationNameCache = new Map<string, string>();
function compactCityLabel(raw: string): string {
  let name = String(raw || "").replace(/中华人民共和国/g, "").replace(/^中国/, "").trim();
  if (!name) return "";
  if (/^(北京市|上海市|天津市|重庆市)$/.test(name)) return name.replace(/市$/, "");
  name = name.replace(/[（(].*?[）)]/g, "").trim();
  const cityMatch = name.match(/([^省自治区特别行政区州盟县区旗]{1,14}?)市/);
  if (cityMatch) return cityMatch[1];
  return name.replace(/(?:特别行政区|自治州|地区|县|区|镇|乡|街道|村|市)$/g, "").trim();
}

export async function fetchOsmStationName(lat: number, lon: number, coastlineSource?: string): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = osmStationNameCache.get(key);
  if (cached) return cached;

  const metrics = getLandMetrics(lat, lon, coastlineSource);
  if (!metrics.isLand) {
    osmStationNameCache.set(key, "洋面站点");
    return "洋面站点";
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    // zoom=10 intentionally asks Nominatim for municipality/city context instead of a district.
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=zh-CN`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TyphoonSim/4.3.16 (Meteorological-Simulation-App)' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const a = data?.address || {};
      // Resolve the *parent city*, never a county/district.  Nominatim may return e.g.
      // state="上海市" + city_district="长宁区"; using the district as a fallback created
      // fake labels such as "长宁(市)".  Direct-controlled municipalities are therefore
      // taken from state/municipality first, while ordinary prefectures use city/town.
      const state = String(a.state || a.province || "").trim();
      const municipalityState = /^(北京市|上海市|天津市|重庆市)$/.test(state) ? state : "";
      const city = municipalityState || a.city || a.municipality || a.town || "";
      const compact = compactCityLabel(city);
      if (compact) {
        osmStationNameCache.set(key, compact);
        return compact;
      }
    }
  } catch (_) {}

  // Offline/network-failure fallback: use the nearest built-in *city* station first.  This is
  // safer than administrative bounding boxes around the Pearl River Delta, where Shenzhen and
  // Hong Kong overlap at coarse map resolution.
  let nearestCity = "";
  let nearestKm = Number.POSITIVE_INFINITY;
  const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  for (const station of WEATHER_STATIONS_DATA) {
    const dy = (station.lat - lat) * 111.12;
    const dx = (station.lon - lon) * 111.12 * cosLat;
    const km = Math.hypot(dx, dy);
    if (km < nearestKm) { nearestKm = km; nearestCity = station.name; }
  }
  if (nearestCity && nearestKm <= 300) {
    const compact = compactCityLabel(nearestCity) || nearestCity;
    osmStationNameCache.set(key, compact);
    return compact;
  }
  const fallback = getDetailedLandName(lat, lon, "", "") || "临时站点";
  const compact = compactCityLabel(fallback.split(/[，,]/)[0]) || "临时站点";
  osmStationNameCache.set(key, compact);
  return compact;
}


export interface StationAdministrativeArea {
  city: string;
  district: string;
  province: string;
  country: string;
  /** Stable public-area key. Any double-clicks resolved into the same district share this key. */
  key: string;
  /** Representative administrative coordinate used by district-level warnings/transport/events. */
  centerLat: number;
  centerLon: number;
  /** Human-readable administrative scope, e.g. “上海市长宁区”. */
  displayName: string;
  source: "nominatim" | "fallback";
}

const osmStationAdminAreaCache = new Map<string, StationAdministrativeArea>();
const osmStationAdminAreaByKey = new Map<string, StationAdministrativeArea>();

function compactAdminPart(raw: unknown): string {
  return String(raw || "")
    .replace(/中华人民共和国/g, "")
    .replace(/^中国/, "")
    .replace(/[（(].*?[）)]/g, "")
    .trim();
}

function adminCityDisplay(cityRaw: string): string {
  const city = compactCityLabel(cityRaw) || compactAdminPart(cityRaw) || "未知城市";
  const noSuffix = new Set(["香港", "澳门", "东京", "大阪", "那霸", "鹿儿岛", "福冈", "长崎", "高知", "名古屋", "横滨", "首尔", "釜山", "济州", "仁川", "马尼拉", "宿务", "岘港", "胡志明"]);
  if (noSuffix.has(city)) return city;
  if (/市$/.test(cityRaw)) return cityRaw;
  if (/^[\u4e00-\u9fff]{2,10}$/.test(city) && !/(?:区|县|州|盟|旗)$/.test(city)) return `${city}市`;
  return city;
}

/**
 * Resolve the public administrative area for a diagnostic point.
 * Point meteorological values remain tied to the exact click coordinate; this representative
 * district/borough coordinate is only for shared warning, airport/transport and emergency-news state.
 */
export async function fetchOsmStationAdministrativeArea(lat: number, lon: number, coastlineSource?: string): Promise<StationAdministrativeArea> {
  const coordKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = osmStationAdminAreaCache.get(coordKey);
  if (cached) return cached;

  const metrics = getLandMetrics(lat, lon, coastlineSource);
  if (!metrics.isLand) {
    const ocean: StationAdministrativeArea = {
      city: "洋面站点", district: "洋面站点", province: "", country: "",
      key: `ocean:${lat.toFixed(2)},${lon.toFixed(2)}`, centerLat: lat, centerLon: lon,
      displayName: "洋面站点", source: "fallback"
    };
    osmStationAdminAreaCache.set(coordKey, ocean);
    return ocean;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3800);
    // zoom=12 generally resolves a borough/county/city-district rather than a street or POI.
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1&accept-language=zh-CN`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TyphoonSim/4.3.16 (Meteorological-Simulation-App)' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const a = data?.address || {};
      const country = compactAdminPart(a.country || "");
      const province = compactAdminPart(a.state || a.province || "");
      const municipalityState = /^(北京市|上海市|天津市|重庆市)$/.test(province) ? province : "";
      const cityRaw = compactAdminPart(municipalityState || a.city || a.municipality || a.prefecture || a.town || "");
      const city = compactCityLabel(cityRaw) || compactCityLabel(await fetchOsmStationName(lat, lon, coastlineSource));
      // County/city_district are preferred. `suburb` is intentionally last: it is often a
      // neighbourhood and would make two clicks in the same administrative district disagree.
      let district = compactAdminPart(a.city_district || a.district || a.county || a.borough || "");
      if (!district) district = compactAdminPart(a.suburb || "");
      if (!district || district === cityRaw || district === city || district === province) district = city ? `${adminCityDisplay(city)}全市` : "所在行政区";

      let centerLat = lat;
      let centerLon = lon;
      const bb = Array.isArray(data?.boundingbox) ? data.boundingbox.map(Number) : [];
      if (bb.length === 4 && bb.every(Number.isFinite)) {
        const [south, north, west, east] = bb;
        // Reject country/province-size boxes; a district representative should stay local.
        if (Math.abs(north - south) <= 2.2 && Math.abs(east - west) <= 2.8) {
          centerLat = (south + north) / 2;
          centerLon = (west + east) / 2;
        }
      }
      const cityDisplay = adminCityDisplay(city || cityRaw || "未知城市");
      // Nominatim occasionally returns a district label already prefixed with the municipality
      // (e.g. "上海市长宁区"). Strip only that parent prefix to avoid UI strings such as
      // "上海市上海市长宁区" while keeping the true district name intact.
      let districtDisplay = district;
      for (const prefix of [cityDisplay, cityRaw, city].filter(Boolean)) {
        if (districtDisplay.startsWith(prefix) && districtDisplay.length > prefix.length) {
          districtDisplay = districtDisplay.slice(prefix.length);
          break;
        }
      }
      const displayName = district.includes("全市") ? cityDisplay : `${cityDisplay}${districtDisplay}`;
      const key = `${country}|${province}|${cityDisplay}|${district}`;
      // Once a district has acquired a representative centre in this session, all later clicks in
      // that district reuse it so public status cannot drift with the exact double-click point.
      const known = osmStationAdminAreaByKey.get(key);
      const area: StationAdministrativeArea = known || {
        city: city || compactCityLabel(cityDisplay), district, province, country, key,
        centerLat, centerLon, displayName, source: "nominatim"
      };
      osmStationAdminAreaByKey.set(key, area);
      osmStationAdminAreaCache.set(coordKey, area);
      return area;
    }
  } catch (_) {}

  const city = await fetchOsmStationName(lat, lon, coastlineSource).catch(() => "临时站点");
  const cityDisplay = adminCityDisplay(city);
  const key = `fallback|${cityDisplay}`;
  const known = osmStationAdminAreaByKey.get(key);
  const area: StationAdministrativeArea = known || {
    city: compactCityLabel(city) || city,
    district: `${cityDisplay}全市`, province: "", country: "", key,
    centerLat: lat, centerLon: lon, displayName: cityDisplay, source: "fallback"
  };
  osmStationAdminAreaByKey.set(key, area);
  osmStationAdminAreaCache.set(coordKey, area);
  return area;
}

export function getDetailedLandName(lat: number, lon: number, country: string, admin: string): string {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (osmLocationCache.has(cacheKey)) return osmLocationCache.get(cacheKey)!;

  const normCountry = normalizeLandCountry(country);
  const normAdmin = (admin || "").trim();

  // High-resolution regional gates are applied before broad country boxes.
  if (lat >= 22.15 && lat <= 22.56 && lon >= 113.80 && lon <= 114.40) return getClosestCity(lat, lon, "中国", "特别行政区");
  if (lat >= 22.08 && lat <= 22.25 && lon >= 113.48 && lon <= 113.65) return getClosestCity(lat, lon, "中国", "特别行政区");
  if (lat >= 21.8 && lat <= 25.4 && lon >= 120.0 && lon <= 122.2) return getClosestCity(lat, lon, "中国", "台湾省");
  if (lat >= 23.5 && lat <= 27.5 && lon >= 117.0 && lon <= 119.9) return getClosestCity(lat, lon, "中国", "福建省");
  if (lat >= 30.65 && lat <= 31.88 && lon >= 120.85 && lon <= 122.3) return getClosestCity(lat, lon, "中国", "上海市");
  if (lat >= 27.1 && lat < 30.65 && lon >= 120.0 && lon <= 122.8) return getClosestCity(lat, lon, "中国", "浙江省");
  if (lat >= 20.0 && lat <= 23.8 && lon >= 109.5 && lon <= 117.2) return getClosestCity(lat, lon, "中国", "广东省");
  if (lat >= 18.0 && lat <= 20.2 && lon >= 108.5 && lon <= 111.1) return getClosestCity(lat, lon, "中国", "海南省");

  // Prefer a country supplied by the coastline/reverse-geocoder over coarse coordinate boxes.
  // This prevents nearby island coasts (for example Tsushima/Kyushu vs Korea) from being snapped
  // across an international boundary.
  if (normCountry === "朝鲜") return `朝鲜${normAdmin || ""}沿海`;
  if (normCountry === "韩国") return getClosestCity(lat, lon, "韩国");
  if (normCountry === "日本") return getClosestCity(lat, lon, "日本");
  if (normCountry === "菲律宾") return getClosestCity(lat, lon, "菲律宾");
  if (normCountry === "越南") return getClosestCity(lat, lon, "越南");
  if (normCountry === "关岛") return getClosestCity(lat, lon, "美国", "关岛");

  // Coordinate-only fallbacks are deliberately conservative and only run when the upstream
  // country label is unavailable.
  if (!normCountry) {
    const tsushima = lat >= 34.0 && lat <= 34.75 && lon >= 129.0 && lon <= 129.75;
    const jeju = lat >= 33.0 && lat <= 33.75 && lon >= 125.7 && lon <= 127.4;
    const koreaMain = lat >= 34.4 && lat <= 38.8 && lon >= 124.8 && lon <= 129.8 && !tsushima;
    if (tsushima) return getClosestCity(lat, lon, "日本");
    if (jeju || koreaMain) return getClosestCity(lat, lon, "韩国");
    if (lon >= 123.0 && lon <= 146.0 && lat >= 24.0 && lat <= 46.0) return getClosestCity(lat, lon, "日本");
    if (lat >= 4.5 && lat <= 21.2 && lon >= 116.0 && lon <= 127.0) return getClosestCity(lat, lon, "菲律宾");
    if (lat >= 8.2 && lat <= 22.2 && lon >= 102.0 && lon <= 110.2) return getClosestCity(lat, lon, "越南");
    if (lat >= 13.15 && lat <= 13.75 && lon >= 144.55 && lon <= 145.05) return getClosestCity(lat, lon, "美国", "关岛");
  }

  if (normCountry === "中国") {
    // When Natural Earth gives an administrative label outside the hand-tuned coastal boxes,
    // keep it rather than snapping to an unrelated Chinese city.
    if (normAdmin) return `中国${normAdmin}${normAdmin.endsWith("沿海") ? "" : "沿海"}`;
    return getClosestCity(lat, lon, "中国");
  }

  if (normCountry && normCountry !== "陆地" && normCountry !== "Land") {
    return `${normCountry}${normAdmin ? normAdmin : ""}${(normAdmin || normCountry).endsWith("沿海") ? "" : "沿海"}`;
  }
  if (normAdmin) return `${normAdmin}沿海`;
  return "沿海地区";
}

const landMetricsCache = new Map<string, { isLand: boolean; elevation: number; landName: string }>();
// All branches (including land fast-return paths) share the same bounded FIFO cache.
function storeLandMetrics(key: string, value: { isLand: boolean; elevation: number; landName: string }): void {
  landMetricsCache.delete(key);
  landMetricsCache.set(key, value);
  if (landMetricsCache.size > 20000) {
    const oldest = landMetricsCache.keys().next().value as string;
    landMetricsCache.delete(oldest);
  }
}

const distToLandCache = new Map<string, number>();
// Exact-input memoization for the two expensive multi-point terrain samplers.  Keys use
// the original JS numeric values rather than rounded coordinates, so cache hits cannot
// change spatial precision or simulation results.
const elevationRadiusCache = new Map<string, { maxElevation: number; isLandContact: boolean; landCoverage: number }>();
const landCoverageCache = new Map<string, number>();
const TERRAIN_SAMPLE_RINGS = [0.4, 0.7, 1.0] as const;
const OCTANT_SAMPLE_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315].map((angleDeg) => {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { angleDeg, cos: Math.cos(angleRad), sin: Math.sin(angleRad) };
});

export function clearLandMetricsCache() {
  landMetricsCache.clear();
  distToLandCache.clear();
  elevationRadiusCache.clear();
  landCoverageCache.clear();
  coreSurfaceInteractionCache.clear();
}

// Get land fraction and elevation
export function getLandMetrics(lat: number, lon: number, coastlineSource?: string, fastMode: boolean = false): { isLand: boolean; elevation: number; landName: string } {
  const scale = fastMode ? 10 : 50;
  const key = `${Math.round(lat * scale)}_${Math.round(lon * scale)}_${coastlineSource || "default"}_${landGeoJson ? "1" : "0"}_${fastMode ? "F" : "N"}`;
  const cached = landMetricsCache.get(key);
  if (cached) return cached;

  let result: { isLand: boolean; elevation: number; landName: string };

  // Priority check using Natural Earth GeoJSON if loaded
  if (landGeoJson) {
    const isLand = checkPointOnLandGeoJson(lat, lon);
    if (isLand) {
      const countryInfo = getLandfallCountryGeoJson(lat, lon);
      const rawCountry = countryInfo ? countryInfo.country : "陆地";
      const rawAdmin = countryInfo ? countryInfo.admin : "";
      const landName = getDetailedLandName(lat, lon, rawCountry, rawAdmin);
      const elevation = getProceduralElevation(lat, lon);
      result = { isLand: true, elevation, landName };
      storeLandMetrics(key, result);
      return result;
    }
  }

  // Fallback check on GSHHG bounding grids & polygons
  const lands = getFilteredLandMasses(coastlineSource);
  for (const land of lands) {
    if (checkPointInPolygon(lat, lon, land.polygon, land.bbox)) {
      // Calculate distance to polygon boundary as a proxy for elevation ramping up in central mountains
      let minDist = 999;
      const polyLen = land.polygon.length;
      const step = polyLen > 10000 ? 50 : (polyLen > 1000 ? 10 : 1);
      for (let i = 0; i < polyLen; i += step) {
        const p1 = land.polygon[i];
        const p2 = land.polygon[(i + step) % polyLen];
        if (Math.abs(p1[0] - lat) > 2.0 && Math.abs(p2[0] - lat) > 2.0) continue;
        if (Math.abs(p1[1] - lon) > 2.0 && Math.abs(p2[1] - lon) > 2.0) continue;
        const dist = distToSegment(lat, lon, p1[0], p1[1], p2[0], p2[1]);
        if (dist < minDist) minDist = dist;
      }
      
      const distRatio = Math.min(minDist / 1.5, 1.0); // 1.5 degrees is max slope distance
      const baseElevation = land.isMountain ? land.maxElevation * distRatio : 100;
      const elevation = getPreciseElevation(lat, lon, land.name, baseElevation, distRatio);
      const landName = getDetailedLandName(lat, lon, land.name, "");
      result = { isLand: true, elevation, landName };
      storeLandMetrics(key, result);
      return result;
    }
  }
  result = { isLand: false, elevation: 0, landName: "海洋" };
  storeLandMetrics(key, result);
  return result;
}

// Sample terrain elevation across the entire 12-level wind circle (r12) area
export function getMaxElevationInRadius(lat: number, lon: number, radiusKm: number, coastlineSource?: string): { maxElevation: number; isLandContact: boolean; landCoverage: number } {
  const cacheKey = `${lat}|${lon}|${radiusKm}|${coastlineSource || "default"}|${landGeoJson ? 1 : 0}`;
  const cached = elevationRadiusCache.get(cacheKey);
  if (cached) return cached;

  const centerMetrics = getLandMetrics(lat, lon, coastlineSource);
  let maxElevation = centerMetrics.elevation;
  let isLandContact = centerMetrics.isLand;
  let landPoints = centerMetrics.isLand ? 1 : 0;
  
  const sampleRadius = Math.max(20, radiusKm);
  // Deep-ocean proof fast-path: if the centre is ocean and the exact coastline-edge index contains
  // no boundary anywhere inside a rectangle enclosing the whole sample disk, every terrain sample
  // below must also be ocean. This removes 24 redundant land tests per call without approximating
  // the near-coast result.
  if (!centerMetrics.isLand && landGeoJson && !hasLandBoundaryWithinKmGeoJson(lat, lon, sampleRadius + 2)) {
    const result = { maxElevation: 0, isLandContact: false, landCoverage: 0 };
    elevationRadiusCache.set(cacheKey, result);
    if (elevationRadiusCache.size > 12000) {
      const firstKey = elevationRadiusCache.keys().next().value;
      if (firstKey) elevationRadiusCache.delete(firstKey);
    }
    return result;
  }

  const cosLat = Math.cos((lat * Math.PI) / 180);
  let totalSamples = 1 + TERRAIN_SAMPLE_RINGS.length * OCTANT_SAMPLE_DIRECTIONS.length;
  
  for (const ring of TERRAIN_SAMPLE_RINGS) {
    const r = sampleRadius * ring;
    for (const direction of OCTANT_SAMPLE_DIRECTIONS) {
      const dLat = (r * direction.cos) / 111.12;
      const dLon = (r * direction.sin) / (111.12 * cosLat);
      const m = getLandMetrics(lat + dLat, lon + dLon, coastlineSource);
      if (m.isLand) {
        isLandContact = true;
        landPoints++;
        if (m.elevation > maxElevation) {
          maxElevation = m.elevation;
        }
      }
    }
  }
  
  const landCoverage = landPoints / totalSamples;
  const result = { maxElevation, isLandContact, landCoverage };
  elevationRadiusCache.set(cacheKey, result);
  if (elevationRadiusCache.size > 12000) {
    const firstKey = elevationRadiusCache.keys().next().value;
    if (firstKey) elevationRadiusCache.delete(firstKey);
  }
  return result;
}

// Get minimum distance to any land polygon (in degrees)

export function getLandCoverage(lat: number, lon: number, radiusKm: number, coastlineSource?: string): number {
  if (radiusKm <= 0) return 0;
  const cacheKey = `${lat}|${lon}|${radiusKm}|${coastlineSource || "default"}|${landGeoJson ? 1 : 0}`;
  const cached = landCoverageCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Same proof fast-path as the terrain sampler.  The actual ring is sampled at 0.7 * radiusKm;
  // querying the full radius is intentionally conservative and can only fall back to the old path.
  if (landGeoJson && !checkPointOnLandGeoJson(lat, lon) && !hasLandBoundaryWithinKmGeoJson(lat, lon, radiusKm + 2)) {
    landCoverageCache.set(cacheKey, 0);
    if (landCoverageCache.size > 12000) {
      const firstKey = landCoverageCache.keys().next().value;
      if (firstKey) landCoverageCache.delete(firstKey);
    }
    return 0;
  }

  let landPoints = 0;
  const totalPoints = 16;
  for (let i = 0; i < totalPoints; i++) {
    const angle = (i / totalPoints) * Math.PI * 2;
    const r = radiusKm * 0.7; // sample at 70% of radius
    const dLat = (r * Math.cos(angle)) / 111.0;
    const dLon = (r * Math.sin(angle)) / (111.0 * Math.cos(lat * Math.PI / 180));
    if (getLandMetrics(lat + dLat, lon + dLon, coastlineSource).isLand) {
      landPoints++;
    }
  }
  const coverage = landPoints / totalPoints;
  landCoverageCache.set(cacheKey, coverage);
  if (landCoverageCache.size > 12000) {
    const firstKey = landCoverageCache.keys().next().value;
    if (firstKey) landCoverageCache.delete(firstKey);
  }
  return coverage;
}

/**
 * Physically informed inner-core land/terrain interaction diagnosis.
 *
 * This deliberately does NOT key off island names.  It samples the actual simulated terrain
 * beneath the RMW/inner-core circulation and diagnoses three mechanisms documented in landfall
 * studies: (1) excess boundary-layer drag over land, (2) wavenumber-1 drag asymmetry where only
 * part of the core is over rough land, and (3) orographic blocking/ruggedness.  A mountain scrape
 * can therefore damage only one side of the eyewall while a flat-land crossing still accumulates
 * frictional damage even with little terrain blocking.
 */
export interface CoreSurfaceInteractionMetrics {
  landFraction: number;
  mountainFraction: number;
  meanLandElevation: number;
  maxElevation: number;
  frictionIndex: number;
  frictionAsymmetry: number;
  blockingIndex: number;
  dominantBearingDeg: number;
}

const coreSurfaceInteractionCache = new Map<string, CoreSurfaceInteractionMetrics>();

export function getCoreSurfaceInteractionMetrics(
  lat: number,
  lon: number,
  rmwKm: number,
  vmaxMs: number,
  coastlineSource?: string
): CoreSurfaceInteractionMetrics {
  const safeRmw = Math.max(16, Math.min(105, Number.isFinite(rmwKm) ? rmwKm : 30));
  const innerRadius = Math.max(18, Math.min(105, safeRmw * 0.88));
  const outerRadius = Math.max(innerRadius + 10, Math.min(165, safeRmw * 1.55));
  const cacheKey = `${lat}|${lon}|${innerRadius}|${outerRadius}|${Math.round(vmaxMs * 10)}|${coastlineSource || "default"}|${landGeoJson ? 1 : 0}`;
  const cached = coreSurfaceInteractionCache.get(cacheKey);
  if (cached) return cached;

  const sectorCount = 16;
  const ringRadii = [innerRadius, outerRadius];
  const ringWeights = [0.58, 0.30];
  const centerWeight = 0.12;
  const cosLat = Math.max(0.22, Math.cos((lat * Math.PI) / 180));
  const seaDragCoefficient = 0.0023; // representative high-wind marine C_D (Kepert 2025)

  let weightedLand = 0;
  let weightedMountain = 0;
  let weightedElevation = 0;
  let weightedLandForElevation = 0;
  let weightedDragCoefficient = seaDragCoefficient;
  let maxElevation = 0;
  let sectorDragX = 0;
  let sectorDragY = 0;
  let sectorDragTotal = 0;
  let blockingWeighted = 0;

  const center = getLandMetrics(lat, lon, coastlineSource);
  if (!center.isLand && landGeoJson && !hasLandBoundaryWithinKmGeoJson(lat, lon, outerRadius + 2)) {
    const result: CoreSurfaceInteractionMetrics = {
      landFraction: 0,
      mountainFraction: 0,
      meanLandElevation: 0,
      maxElevation: 0,
      frictionIndex: 0,
      frictionAsymmetry: 0,
      blockingIndex: 0,
      dominantBearingDeg: 0
    };
    coreSurfaceInteractionCache.set(cacheKey, result);
    if (coreSurfaceInteractionCache.size > 10000) {
      const firstKey = coreSurfaceInteractionCache.keys().next().value;
      if (firstKey) coreSurfaceInteractionCache.delete(firstKey);
    }
    return result;
  }

  if (center.isLand) {
    const centerElevGate = smoothstep01((center.elevation - 120) / 1680);
    const centerCd = 0.00655 + 0.00120 * centerElevGate; // rough-land C_D centred near the documented ~0.0075 value
    weightedLand += centerWeight;
    weightedElevation += centerWeight * center.elevation;
    weightedLandForElevation += centerWeight;
    weightedDragCoefficient += centerWeight * (centerCd - seaDragCoefficient);
    maxElevation = Math.max(maxElevation, center.elevation);
    if (center.elevation >= 650) weightedMountain += centerWeight;
    blockingWeighted += centerWeight * centerElevGate;
  }

  const innerElevationBySector: number[] = new Array(sectorCount).fill(0);
  const outerElevationBySector: number[] = new Array(sectorCount).fill(0);
  const innerLandBySector: boolean[] = new Array(sectorCount).fill(false);
  const outerLandBySector: boolean[] = new Array(sectorCount).fill(false);

  for (let ringIndex = 0; ringIndex < ringRadii.length; ringIndex++) {
    const radiusKm = ringRadii[ringIndex];
    const perPointWeight = ringWeights[ringIndex] / sectorCount;
    for (let i = 0; i < sectorCount; i++) {
      const bearingRad = (i / sectorCount) * Math.PI * 2;
      const dLat = (radiusKm * Math.cos(bearingRad)) / 111.12;
      const dLon = (radiusKm * Math.sin(bearingRad)) / (111.12 * cosLat);
      const m = getLandMetrics(lat + dLat, lon + dLon, coastlineSource);
      if (ringIndex === 0) {
        innerElevationBySector[i] = m.isLand ? m.elevation : 0;
        innerLandBySector[i] = m.isLand;
      } else {
        outerElevationBySector[i] = m.isLand ? m.elevation : 0;
        outerLandBySector[i] = m.isLand;
      }
      if (!m.isLand) continue;

      const elevationGate = smoothstep01((m.elevation - 120) / 1680);
      // Land roughness is represented as a conservative aerodynamic drag excess. Terrain height
      // alone is not used as a magic damage switch; local radial relief below adds the rugged term.
      weightedLand += perPointWeight;
      weightedElevation += perPointWeight * m.elevation;
      weightedLandForElevation += perPointWeight;
      maxElevation = Math.max(maxElevation, m.elevation);
      if (m.elevation >= 650) weightedMountain += perPointWeight;
      const baseLandCd = 0.00655 + 0.00120 * elevationGate;
      weightedDragCoefficient += perPointWeight * (baseLandCd - seaDragCoefficient);
    }
  }

  // Radial relief is a proxy for unresolved hill/ridge roughness and for flow encountering a
  // terrain barrier across the eyewall.  It is evaluated sector by sector so grazing a mountain
  // ridge creates a one-sided response instead of a binary whole-vortex penalty.
  for (let i = 0; i < sectorCount; i++) {
    const innerElev = innerElevationBySector[i];
    const outerElev = outerElevationBySector[i];
    const anyLand = innerLandBySector[i] || outerLandBySector[i];
    if (!anyLand) continue;
    const meanElev = 0.58 * innerElev + 0.42 * outerElev;
    const radialReliefPerKm = Math.abs(outerElev - innerElev) / Math.max(12, outerRadius - innerRadius);
    const ruggedness = smoothstep01((radialReliefPerKm - 2.0) / 18.0);
    const elevationGate = smoothstep01((meanElev - 180) / 1600);
    const sectorLandFraction = (innerLandBySector[i] ? 0.64 : 0) + (outerLandBySector[i] ? 0.36 : 0);
    const sectorDragExcess = sectorLandFraction * (0.00425 + 0.00135 * ruggedness + 0.00075 * elevationGate);
    const bearingRad = (i / sectorCount) * Math.PI * 2;
    sectorDragX += sectorDragExcess * Math.sin(bearingRad);
    sectorDragY += sectorDragExcess * Math.cos(bearingRad);
    sectorDragTotal += sectorDragExcess;

    const mountainBarrier = sectorLandFraction * clamp01(0.58 * elevationGate + 0.42 * ruggedness);
    blockingWeighted += (0.88 / sectorCount) * mountainBarrier;
  }

  const meanCdExcess = Math.max(0, weightedDragCoefficient - seaDragCoefficient);
  // Dissipation scales with drag and wind speed.  This is a normalized structural forcing index,
  // not a replacement for the intensity decay calculation elsewhere in the engine.
  const windWorkFactor = Math.max(0.32, Math.min(1.35, vmaxMs / 50.0));
  const frictionIndex = clamp01((meanCdExcess / 0.0056) * windWorkFactor);
  const frictionAsymmetry = clamp01(sectorDragTotal > 1e-8
    ? Math.hypot(sectorDragX, sectorDragY) / sectorDragTotal
    : 0);

  // Stronger low-level flow is somewhat harder to block, while high/rugged terrain retains a
  // strong effect.  The dependence is smooth and geography-agnostic.
  const flowThroughFactor = Math.max(0.68, Math.min(1.08, 1.08 - Math.max(0, vmaxMs - 25) / 190));
  const blockingIndex = clamp01(blockingWeighted * flowThroughFactor);
  const dominantBearingDeg = sectorDragTotal > 1e-8
    ? ((Math.atan2(sectorDragX, sectorDragY) * 180 / Math.PI) + 360) % 360
    : 0;

  const result: CoreSurfaceInteractionMetrics = {
    landFraction: clamp01(weightedLand),
    mountainFraction: clamp01(weightedMountain),
    meanLandElevation: weightedLandForElevation > 1e-8 ? weightedElevation / weightedLandForElevation : 0,
    maxElevation,
    frictionIndex,
    frictionAsymmetry,
    blockingIndex,
    dominantBearingDeg
  };
  coreSurfaceInteractionCache.set(cacheKey, result);
  if (coreSurfaceInteractionCache.size > 10000) {
    const firstKey = coreSurfaceInteractionCache.keys().next().value;
    if (firstKey) coreSurfaceInteractionCache.delete(firstKey);
  }
  return result;
}

export function getDistanceToLand(lat: number, lon: number, coastlineSource?: string, fastMode: boolean = false): number {
  if (getLandMetrics(lat, lon, coastlineSource, fastMode).isLand) return 0;
  const scale = fastMode ? 10 : 50;
  const key = `${Math.round(lat * scale)}_${Math.round(lon * scale)}_${coastlineSource || "default"}_${fastMode ? "F" : "N"}`;
  const cached = distToLandCache.get(key);
  if (cached !== undefined) return cached;

  let minDistance = 999;
  if (landGeoJson) {
    minDistance = getDistanceToLandGeoJson(lat, lon);
  } else {
    const lands = getFilteredLandMasses(coastlineSource);
    for (const land of lands) {
      // Bounding box pre-filter to skip distant landmasses instantly.  Reuse the static
      // polygon bbox instead of rebuilding it on every distance query.
      let bbox = land.bbox;
      if (!bbox) {
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        for (let i = 0; i < land.polygon.length; i++) {
          const point = land.polygon[i];
          if (point[0] < minLat) minLat = point[0];
          if (point[0] > maxLat) maxLat = point[0];
          if (point[1] < minLon) minLon = point[1];
          if (point[1] > maxLon) maxLon = point[1];
        }
        bbox = { minLat, maxLat, minLon, maxLon };
        land.bbox = bbox;
      }
      if (lat < bbox.minLat - minDistance || lat > bbox.maxLat + minDistance ||
          lon < bbox.minLon - minDistance || lon > bbox.maxLon + minDistance) {
        continue;
      }

      const polyLen = land.polygon.length;
      const step = polyLen > 10000 ? 50 : (polyLen > 1000 ? 10 : 1);
      for (let i = 0; i < polyLen; i += step) {
        const p1 = land.polygon[i];
        const p2 = land.polygon[(i + step) % polyLen];
        if (Math.abs(p1[0] - lat) > minDistance && Math.abs(p2[0] - lat) > minDistance) continue;
        if (Math.abs(p1[1] - lon) > minDistance && Math.abs(p2[1] - lon) > minDistance) continue;
        const dist = distToSegment(lat, lon, p1[0], p1[1], p2[0], p2[1]);
        if (dist < minDistance) {
          minDistance = dist;
        }
      }
    }
  }
  distToLandCache.set(key, minDistance);
  if (distToLandCache.size > 10000) {
    const firstKey = distToLandCache.keys().next().value;
    if (firstKey) distToLandCache.delete(firstKey);
  }
  return minDistance;
}

function distToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Convert wind speed m/s to central pressure hPa using interpolation:
// 18 m/s -> 997 hPa
// 68 m/s -> 901 hPa
export function calculatePressure(vmax: number): number {
  if (vmax <= 18.0) {
    // Interpolate between 0 m/s (1012 hPa) and 18 m/s (997 hPa)
    return Math.max(0, Math.round(1012 - 15 * (vmax / 18.0)));
  } else if (vmax <= 68.0) {
    // Interpolate between 18 m/s (997 hPa) and 68 m/s (901 hPa)
    return Math.max(0, Math.round(997 - 1.92 * (vmax - 18.0)));
  } else {
    // Extrapolate for vmax > 68 m/s (up to 80 m/s which is 878 hPa)
    return Math.max(0, Math.round(901 - 1.92 * (vmax - 68.0)));
  }
}

// Check if the 10-level wind circle touches land
export function checkWindCircleTouchLand(lat: number, lon: number, r10: { ne: number; se: number; sw: number; nw: number }, coastlineSource?: string): boolean {
  if (!r10 || r10.ne <= 0) return false;
  
  // Angles: 0(N), 45(NE), 90(E), 135(SE), 180(S), 225(SW), 270(W), 315(NW)
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const direction of OCTANT_SAMPLE_DIRECTIONS) {
    const angleDeg = direction.angleDeg;
    let r_km = r10.ne;
    if (angleDeg >= 0 && angleDeg < 90) r_km = r10.ne;
    else if (angleDeg >= 90 && angleDeg < 180) r_km = r10.se;
    else if (angleDeg >= 180 && angleDeg < 270) r_km = r10.sw;
    else r_km = r10.nw;
    
    const dLat = (r_km * direction.cos) / 111.12;
    const dLon = (r_km * direction.sin) / (111.12 * cosLat);
    
    const testLat = lat + dLat;
    const testLon = lon + dLon;
    const testMetrics = getLandMetrics(testLat, testLon, coastlineSource);
    if (testMetrics.isLand) {
      return true;
    }
  }
  return false;
}

// --- Procedural Atmospheric/Oceanic Fields ---

// SST Field Model
export function getSST(lat: number, lon: number, config: SimulationConfig, simHour: number = 0): number {
  if (config.newEnvironmentPhysicsEnabled) return getSynopticOceanState(lat, lon, config, simHour).sst;
  // Normalize longitude to standard [-180, 180] range for consistent field models
  let normLon = lon;
  while (normLon < -180) normLon += 360;
  while (normLon > 180) normLon -= 360;

  // Requirement 3: Global zoned SST based on presets
  let baseSST = config.sstBase !== undefined ? config.sstBase : 30.5;
  
  let gradient = config.sstNorthSouthGradient !== undefined ? config.sstNorthSouthGradient : 1.0;
  const pivotLat = config.sstPivotLat !== undefined ? config.sstPivotLat : 29.3;
  
  if (lat > pivotLat) {
    // 1. Calculate drop at pivot using slightly reduced gradient (south of 29.3 gap narrowing)
    const southGradient = gradient * 0.82; 
    const pivotDrop = (0.17 * (pivotLat - 15) + 0.003 * Math.pow(pivotLat - 15, 2)) * southGradient;
    
    // 2. Rapid drop north of pivotLat
    const northDist = lat - pivotLat;
    const rapidDrop = (0.75 * northDist + 0.05 * Math.pow(northDist, 1.85)) * gradient;
    
    baseSST -= (pivotDrop + rapidDrop);
  } else if (lat > 15) {
    // South of 29.3: Slightly narrowed N-S gradient as requested
    const southGradient = gradient * 0.82;
    baseSST -= (0.17 * (lat - 15) + 0.003 * Math.pow(lat - 15, 2)) * southGradient;
  } else {
    // Equatorial regions stay very warm
    baseSST -= 0.06 * (15 - lat);
  }
  
  // Longitude gradient (warmer east, cooler near Chinese mainland)
  const lonOffset = normLon - 137;
  baseSST -= 0.0008 * Math.pow(lonOffset, 2); // Slightly wider warm pool
  if (normLon < 120) {
    baseSST -= 0.04 * (120 - normLon); // subtle shelf cooling
  }

  // Add warm pool boost (Intensified for September peak)
  if (config.warmPoolEnabled && lat >= 6 && lat <= 22 && normLon >= 120 && normLon <= 155) {
    // 2D gaussian-like warm pool spike
    const dLat = (lat - 14.5) / 7;
    const dLon = (normLon - 138) / 15;
    const poolSpike = 1.2 * Math.exp(-(dLat*dLat + dLon*dLon));
    baseSST += poolSpike;
  }

  // Add cold eddy penalty
  if (config.coldEddyEnabled) {
    // Cold eddy around 21°N, 128°E
    const dLat = (lat - 21) / 2.5;
    const dLon = (normLon - 128) / 2.5;
    const eddyDip = 1.6 * Math.exp(-(dLat*dLat + dLon*dLon));
    baseSST -= eddyDip;
  }

  // Add global anomaly
  baseSST += config.sstAnomaly;

  return Math.max(10, Math.min(32.0, baseSST));
}

/**
 * Soft upper-ocean mixing penalty for the shallow East China/Yellow Sea shelf. This is not a
 * geographic hard cap: faster-moving or unusually high-OHC storms can resist it, while large,
 * intense and slow cyclones cool their own inflow more efficiently. The penalty is intentionally
 * strongest only after the cyclone is already around 60+ m/s.
 */
function getEastChinaShelfMixingStress(
  lat: number, lon: number, vmax: number, translationKmh: number, meanR7Km: number, ohc: number
): number {
  let xlon = lon;
  while (xlon < -180) xlon += 360;
  while (xlon > 180) xlon -= 360;
  if (lat < 22.5 || lat > 36.0 || xlon < 118.0 || xlon > 130.0) return 0;

  // Continental-shelf influence is strongest west of the Okinawa Trough and tapers smoothly
  // eastward; the Yellow Sea/Bohai side is even shallower.
  const westShelf = clamp01((129.2 - xlon) / 5.0);
  const latitudeGate = clamp01(Math.min((lat - 22.5) / 3.0, (36.0 - lat) / 2.5, 1));
  const yellowSeaBoost = lat >= 30.0 && xlon <= 126.5 ? 0.16 : 0;
  const shelfGeometry = clamp01(smoothstep01(westShelf) * latitudeGate + yellowSeaBoost);
  if (shelfGeometry <= 0) return 0;

  const intenseGate = smoothstep01(clamp01((vmax - 54.0) / 12.0));
  const extremeGate = smoothstep01(clamp01((vmax - 60.0) / 8.0));
  const slowMixing = 0.45 + 0.55 * (1 - smoothstep01(clamp01((translationKmh - 14.0) / 24.0)));
  const sizeMixing = 0.62 + 0.38 * smoothstep01(clamp01((meanR7Km - 180.0) / 260.0));
  const ohcRelief = 1 - 0.72 * smoothstep01(clamp01((ohc - 55.0) / 70.0));
  return clamp01(shelfGeometry * (0.56 * intenseGate + 0.44 * extremeGate) * slowMixing * sizeMixing * ohcRelief);
}

// Ocean Heat Content (OHC) Field Model
export function getOHC(lat: number, lon: number, config: SimulationConfig, actualSST?: number, simHour: number = 0): number {
  if (config.newEnvironmentPhysicsEnabled) return getSynopticOceanState(lat, lon, config, simHour).ohc;
  let normLon = lon;
  while (normLon < -180) normLon += 360;
  while (normLon > 180) normLon -= 360;

  const sst = actualSST !== undefined ? actualSST : getSST(lat, normLon, config, simHour);
  if (sst < 26.0) return 0;

  // Base OHC proportional to (SST - 26)
  let baseOHC = (sst - 26.0) * 25.0 * config.ohcScale;

  // Warm Pool has deep thermocline, boosting OHC significantly
  if (config.warmPoolEnabled && lat >= 8 && lat <= 22 && normLon >= 125 && normLon <= 152) {
    const distFromCenter = Math.sqrt(Math.pow((lat - 15) / 7, 2) + Math.pow((normLon - 138) / 13, 2));
    if (distFromCenter < 1.0) {
      baseOHC += 55 * (1.0 - distFromCenter);
    }
  }

  return Math.max(0, Math.min(210, baseOHC));
}

// 200-850 hPa Vertical Wind Shear Field Model (Western North Pacific Climatology)
export function getShear(lat: number, lon: number, config: SimulationConfig, simHour: number = 0): number {
  if (config.newEnvironmentPhysicsEnabled) return getSynopticAtmosState(lat, lon, config, simHour).shear;
  let normLon = lon;
  while (normLon < -180) normLon += 360;
  while (normLon > 180) normLon -= 360;

  const preset = config.shearPreset || 'global_low';
  let baseShear = 8.0;

  if (preset === 'global_low') {
    // Global Low shear baseline (favorable for tropical development 8-14 kt)
    const troughLat = 18.0;
    const distTrough = Math.abs(lat - troughLat);
    baseShear = 6.0 + Math.min(10.0, distTrough * 0.4);

    // Jet stream band to the north
    const jetLat = config.westerliesLat || 32.0;
    if (lat > jetLat - 6.0) {
      const jetDist = Math.abs(lat - jetLat);
      const jetBand = Math.exp(-Math.pow(jetDist / 4.5, 2));
      const jetTail = lat > jetLat ? (lat - jetLat) * 0.8 : 0;
      baseShear += jetBand * 28.0 * (config.westerliesStrength || 1.0) + jetTail;
    }
  } else {
    // Realistic monthly shear distribution
    let monsoonTroughLat = 20.0;
    let jetLat = 38.0;
    let jetPeakShear = 35.0;
    let tuttCells: Array<{ lat: number; lon: number; rLat: number; rLon: number; boost: number }> = [];
    let neMonsoonActive = false;

    switch (preset) {
      case 'january':
        monsoonTroughLat = 5.0;
        jetLat = 25.0;
        jetPeakShear = 48.0;
        neMonsoonActive = true;
        break;
      case 'february':
        monsoonTroughLat = 5.0;
        jetLat = 26.0;
        jetPeakShear = 46.0;
        neMonsoonActive = true;
        break;
      case 'march':
        monsoonTroughLat = 6.0;
        jetLat = 28.0;
        jetPeakShear = 42.0;
        neMonsoonActive = true;
        break;
      case 'april':
        monsoonTroughLat = 8.0;
        jetLat = 30.0;
        jetPeakShear = 38.0;
        break;
      case 'may':
        monsoonTroughLat = 12.0;
        jetLat = 33.0;
        jetPeakShear = 35.0;
        tuttCells = [{ lat: 18.0, lon: 155.0, rLat: 4.0, rLon: 7.0, boost: 16.0 }];
        break;
      case 'june':
        monsoonTroughLat = 18.0;
        jetLat = 39.0;
        jetPeakShear = 32.0;
        tuttCells = [
          { lat: 20.0, lon: 152.0, rLat: 4.5, rLon: 8.0, boost: 18.0 },
          { lat: 24.0, lon: 168.0, rLat: 3.5, rLon: 6.0, boost: 15.0 }
        ];
        break;
      case 'july':
        monsoonTroughLat = 22.0;
        jetLat = 45.0;
        jetPeakShear = 30.0;
        tuttCells = [
          { lat: 22.0, lon: 150.0, rLat: 5.0, rLon: 9.0, boost: 20.0 },
          { lat: 26.0, lon: 166.0, rLat: 4.0, rLon: 7.0, boost: 18.0 }
        ];
        break;
      case 'august':
        monsoonTroughLat = 25.0;
        jetLat = 47.0;
        jetPeakShear = 28.0;
        tuttCells = [
          { lat: 24.0, lon: 148.0, rLat: 5.0, rLon: 10.0, boost: 22.0 },
          { lat: 28.0, lon: 165.0, rLat: 4.0, rLon: 8.0, boost: 18.0 }
        ];
        break;
      case 'september':
        monsoonTroughLat = 20.0;
        jetLat = 41.0;
        jetPeakShear = 34.0;
        tuttCells = [
          { lat: 21.0, lon: 152.0, rLat: 4.5, rLon: 8.0, boost: 18.0 }
        ];
        break;
      case 'october':
        monsoonTroughLat = 15.0;
        jetLat = 35.0;
        jetPeakShear = 38.0;
        neMonsoonActive = true;
        break;
      case 'november':
        monsoonTroughLat = 10.0;
        jetLat = 28.0;
        jetPeakShear = 42.0;
        neMonsoonActive = true;
        break;
      case 'december':
        monsoonTroughLat = 6.0;
        jetLat = 26.0;
        jetPeakShear = 46.0;
        neMonsoonActive = true;
        break;
    }

    // A. Monsoon trough low-shear belt (5 - 12 kt in main trough)
    const distTrough = Math.abs(lat - monsoonTroughLat);
    baseShear = 5.5 + Math.min(10.0, distTrough * 0.45);

    // B. Subtropical Westerly Jet Stream Band (Narrow zonal Gaussian band)
    const jetDist = Math.abs(lat - jetLat);
    const jetFactor = Math.exp(-Math.pow(jetDist / 4.5, 2));
    const jetTail = lat > jetLat ? (lat - jetLat) * 0.7 : 0;
    baseShear += jetFactor * jetPeakShear + jetTail;

    // C. TUTT Cold Low Cells (Discrete high shear pockets in Northwest Pacific)
    for (const cell of tuttCells) {
      const dLat = (lat - cell.lat) / cell.rLat;
      const dLon = (normLon - cell.lon) / cell.rLon;
      const cellDist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (cellDist < 1.0) {
        baseShear += cell.boost * (1.0 - cellDist * cellDist);
      }
    }

    // D. Winter Northeast Monsoon Surge (SCS & East of Philippines high shear)
    if (neMonsoonActive && lat >= 10.0 && lat <= 22.0 && normLon >= 110.0 && normLon <= 126.0) {
      const surgeFactor = Math.sin(((lat - 10.0) / 12.0) * Math.PI) * Math.sin(((normLon - 110.0) / 16.0) * Math.PI);
      baseShear += Math.max(0, surgeFactor * 18.0);
    }
  }

  // Adjust by Subtropical High (Core of ridge is anticyclonic with light shear)
  if (config.subtropicalHighEnabled) {
    const subHighLat = config.subtropicalHighLat || 24.5;
    const subHighLon = config.subtropicalHighLon || 135.0;
    const distSubHigh = Math.sqrt(Math.pow((lat - subHighLat) / 7.0, 2) + Math.pow((normLon - subHighLon) / 14.0, 2));
    if (distSubHigh < 1.0) {
      // Light shear (4-8 kt) near ridge core
      baseShear = baseShear * (0.5 + 0.5 * distSubHigh);
    }
  }

  // Apply user scale slider
  return Math.max(2.0, Math.min(65.0, baseShear * (config.shearScale ?? 1.0)));
}

// Mid-level (700 hPa) Relative Humidity Field Model
export function getRH700(lat: number, lon: number, config: SimulationConfig, simHour: number = 0): number {
  if (config.newEnvironmentPhysicsEnabled) return getSynopticAtmosState(lat, lon, config, simHour).rh700;
  // Tropical zones are moist (70-85%), Subtropical High is dry (40-55%)
  let baseRH = 75.0;

  // Subtropical High dry zone
  if (config.subtropicalHighEnabled) {
    const subHighLat = config.subtropicalHighLat;
    const subHighLon = config.subtropicalHighLon;
    const dLat = (lat - subHighLat) / 6.0;
    const dLon = (lon - subHighLon) / 12.0;
    const dist = Math.sqrt(dLat*dLat + dLon*dLon);
    if (dist < 1.5) {
      const dryEffect = (1.5 - dist) / 1.5;
      baseRH -= 32.0 * dryEffect;
    }
  }

  // Dry continental air from the Northwest (Siberian high runoff / dry air intrusion)
  if (config.dryAirEnabled && lat > 25 && lon < 125) {
    const contInfluence = Math.min((lat - 25) / 15, 1.0) * Math.min((125 - lon) / 15, 1.0);
    baseRH -= 28 * contInfluence;
  }

  return Math.max(15, Math.min(95, baseRH * config.humidityScale));
}

// 500 hPa Geopotential Height (gpm) Model
export function getGeopotentialHeight500(lat: number, lon: number, config: SimulationConfig, simHour: number = 0): number {
  if (config.newEnvironmentPhysicsEnabled) return Math.round(getSynopticAtmosState(lat, lon, config, simHour).h500);
  // Standard standard atmospheric gradient: 5880 gpm near tropics, drops northwards
  let baseGpm = 5880;

  // Latitudinal drop
  if (lat > 20) {
    baseGpm -= 4.2 * (lat - 20) + 0.15 * Math.pow(lat - 20, 2);
  } else {
    baseGpm += 0.5 * (20 - lat);
  }

  // Subtropical High ridge amplification (represented as a 5880+ gpm high pressure core)
  if (config.subtropicalHighEnabled) {
    const subHighLat = config.subtropicalHighLat;
    const subHighLon = config.subtropicalHighLon;
    const strength = config.subtropicalHighStrength;
    const westExtend = config.subtropicalHighWestExtent;

    // Subtropical high is an elongated ellipsoid stretching from subHighLon westwards
    const nsSize = config.subtropicalHighNSSize !== undefined ? config.subtropicalHighNSSize : 1.0;
    const ewSize = config.subtropicalHighEWSize !== undefined ? config.subtropicalHighEWSize : 1.0;
    const dLat = (lat - subHighLat) / (5.0 * nsSize);
    
    // Model elongation westwards. East-west span is independent from the west-ridge anchor:
    // westExtend controls where the flat ridge reaches, while ewSize controls how broadly the
    // 5880-gpm envelope decays on either longitudinal flank.
    let dLon = 0;
    if (lon > subHighLon) {
      dLon = (lon - subHighLon) / (8.0 * ewSize);
    } else if (lon >= westExtend) {
      dLon = 0; // flat ridge top
    } else {
      dLon = (westExtend - lon) / (6.0 * ewSize);
    }

    const dist = Math.sqrt(dLat*dLat + dLon*dLon);
    if (dist < 1.8) {
      const heightBonus = 35 * strength * (1.8 - dist) / 1.8;
      baseGpm += heightBonus;
    }
  }

  // Westerlies trough disturbance (cuts into the heights)
  if (config.westerliesEnabled) {
    const troughLon = config.westerliesTroughLon ?? 115.0;
    const depth = config.westerliesTroughDepth ?? 1.0;
    const westLat = config.westerliesLat ?? 30.0;

    if (lat > westLat - 8) {
      // Trough is a wave-like dip: sin/cos shape
      const dLon = lon - troughLon;
      // Trough amplitude peaks at westerliesLat and fades south
      const amplitude = 32 * depth * Math.exp(-Math.pow((lat - westLat)/6, 2));
      const wave = Math.cos((dLon * Math.PI) / 35.0); // wave period 70 degrees
      if (wave > 0) {
        // Trough cuts heights, ridge ahead increases them slightly
        baseGpm -= amplitude * wave;
      } else {
        baseGpm -= amplitude * wave * 0.4;
      }
    }
  }

  return Math.round(baseGpm);
}

// Helper to calculate raw westerlies vector push on typhoon (in m/s)
export function getWesterliesSteeringVector(lat: number, lon: number, config: SimulationConfig): { u: number; v: number } {
  if (!config.westerliesEnabled || (config.westerliesStrength ?? 1.0) <= 0) {
    return { u: 0, v: 0 };
  }
  const westerliesLat = config.westerliesLat ?? 30.0;
  const strength = config.westerliesStrength ?? 1.0;

  if (lat <= westerliesLat - 8.0) {
    return { u: 0, v: 0 };
  }

  const deltaLat = lat - (westerliesLat - 8.0);
  const ratio = Math.max(0, Math.min(1.0, deltaLat / 8.0));
  const smoothRatio = ratio * ratio * (3 - 2 * ratio);
  const uRamp = (5.0 + Math.max(0, lat - westerliesLat) * 1.8) * smoothRatio * strength;

  const troughLon = config.westerliesTroughLon ?? 115.0;
  const depth = config.westerliesTroughDepth ?? 1.0;
  const dLon = lon - troughLon;
  const vWave = Math.sin((dLon * Math.PI) / 35.0) * 10.0 * depth * Math.exp(-Math.pow((lat - westerliesLat) / 8.0, 2));

  return { u: uRamp, v: vWave };
}

function configuredSeasonMonth(config: SimulationConfig): number {
  const name = String(config.shearPreset || "july").toLowerCase();
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const idx = months.indexOf(name);
  return idx >= 0 ? idx + 1 : 7;
}

// Environmental steering flow (U, V) in m/s at levels 850, 500, 200 hPa
export function getEnvironmentalWind(level: 850 | 500 | 200, lat: number, lon: number, config: SimulationConfig, simHour: number = 0, allowSynoptic: boolean = true): { u: number; v: number } {
  if (config.newEnvironmentPhysicsEnabled && allowSynoptic) return getSynopticWind(level, lat, lon, config, simHour);
  let u = 0;
  let v = 0;

    // A. Westerlies Flow (west to east flow, U > 0, peaks in upper levels like 200 hPa)
    if (config.westerliesEnabled && (config.westerliesStrength ?? 1.0) > 0) {
      const westerliesLat = config.westerliesLat ?? 30.0;
      const strength = config.westerliesStrength ?? 1.0;

      // Altitude factor for westerlies
      let levelFactor = 1.0;
      if (level === 200) levelFactor = 1.8; // stronger jet stream
      if (level === 850) levelFactor = 0.4; // surface friction

      // Westerlies transition zone: starts 8° south of westerliesLat
      const transitionZone = 8.0; 
      if (lat > westerliesLat - transitionZone) {
        const deltaLat = lat - (westerliesLat - transitionZone);
        const ratio = Math.max(0, Math.min(1.0, deltaLat / transitionZone));
        // Gradually increase from 0 to full strength as it approaches the jet axis
        const smoothRatio = ratio * ratio * (3 - 2 * ratio);
        const rampFlow = (6.0 + Math.max(0, lat - westerliesLat) * 1.5) * smoothRatio * strength; 
        u += rampFlow * levelFactor;
      }

      // Westerlies Trough creates wave-like steering: V < 0 behind trough, V > 0 in front of trough
      const troughLon = config.westerliesTroughLon ?? 115.0;
      const depth = config.westerliesTroughDepth ?? 1.0;
      if (lat > westerliesLat - 8.0) { // start trough influence as typhoon approaches westerlies
        const dLon = lon - troughLon;
        const waveFactor = Math.sin((dLon * Math.PI) / 35.0) * 12.0 * depth * levelFactor;
        v += waveFactor * Math.exp(-Math.pow((lat - westerliesLat) / 8.0, 2));
      }
    }

  // B. Subtropical High Circulation (Clockwise flow around the ridge + boundary suppression)
  if (config.subtropicalHighEnabled) {
    const subHighLat = config.subtropicalHighLat;
    const subHighLon = config.subtropicalHighLon;
    const strength = config.subtropicalHighStrength;
    const westExtend = config.subtropicalHighWestExtent;

    // Standard high is at 500hPa, stronger at 500/850, weaker/reversed at 200 hPa (warm core high has outflow)
    let highFactor = 1.0;
    if (level === 200) highFactor = -0.3; // divergent outflow at upper level
    if (level === 850) highFactor = 0.8;

    // Define distance to ridge line
    const dLat = lat - subHighLat;
    let dLon = 0;
    if (lon > subHighLon) {
      dLon = lon - subHighLon;
    } else if (lon >= westExtend) {
      dLon = 0; // flat ridge
    } else {
      dLon = lon - westExtend;
    }

    const nsSize = config.subtropicalHighNSSize !== undefined ? config.subtropicalHighNSSize : 1.0;
    const ewSize = config.subtropicalHighEWSize !== undefined ? config.subtropicalHighEWSize : 1.0;
    const latRadius = 6.0 * nsSize;
    const lonRadius = 15.0 * ewSize;

    const rSq = Math.pow(dLat / latRadius, 2) + Math.pow(dLon / lonRadius, 2);
    if (rSq < 20.0) {
      const r = Math.sqrt(rSq);
      // Wind profile: 0 at center, peaks at r=1 (5880 gpm edge), decays outwards
      const windProfile = r * Math.exp(1 - r) * 14.0 * strength * highFactor;

      // Directions
      const angle = Math.atan2(dLat * (lonRadius / latRadius), dLon);
      // Clockwise rotation around ridge perimeter
      let subHighU = Math.sin(angle) * windProfile;
      let subHighV = -Math.cos(angle) * windProfile;

      // Requirement 5 & 6: Remove rigid "wall" hacks and artificial turning.
      // Just rely on the geostrophic wind flow. Natural beta drift and westerlies will govern the escape.
      u += subHighU;
      v += subHighV;
    }
  }

  // C. Monsoon Trough & Easterly Waves at low level (850 hPa)
  if (level === 850) {
    if (config.monsoonTroughEnabled) {
      // Seasonal monsoon migration.  The low-level convergence axis reaches its northernmost WNP
      // position in Jul-Aug and retreats equatorward in boreal winter.  A gentle longitude tilt
      // keeps the band from becoming a rigid horizontal stripe.
      const month = configuredSeasonMonth(config);
      const annual = Math.cos(((month - 8) / 12) * Math.PI * 2);
      const seasonalAxis = 9.5 + 4.3 * annual + 1.8 * clamp01((lon - 112) / 38)
        + 0.8 * Math.sin((lon - 118) * Math.PI / 100 + simHour * 0.008);
      const band = Math.exp(-Math.pow((lat - seasonalAxis) / 5.2, 2));
      const summerWeight = clamp01((annual + 0.20) / 1.20);
      const winterWeight = 1 - summerWeight;
      // Summer southwest/westerly monsoon, winter northeast monsoon.  The seasonal location and
      // direction now affect steering itself, not only the diagnostic wind product.
      u += band * (5.0 * summerWeight - 3.1 * winterWeight);
      v += band * (2.0 * summerWeight - 2.4 * winterWeight);
    }
    
    if (config.eastWaveEnabled && lat < 18) {
      // Wave disturbance propagating west: Easterly waves.  A held joystick handle is now a
      // persistent visual/control-state indicator, so only an *active drag* may enter this legacy
      // phase coupling.  Otherwise a non-centred display would unintentionally alter the
      // environmental easterly-wave field after release.
      const activeJoystickDx = config.joystickDragging ? config.joystickDx : 0;
      const wave = Math.sin((lon - 0.5 * activeJoystickDx) * 0.3) * 2.5;
      v += wave;
      u -= 1.5; // background easterlies booster
    }
  } else if (level === 500) {
    // Background tropical easterlies (trade winds) south of sub-high
    if (lat < 18) {
      u -= 3.5;
    }
  }

  return { u, v };
}

// Compute aggregate steering flow wind based on typhoon intensity weights
export function getSteeringFlow(lat: number, lon: number, vmax: number, config: SimulationConfig, isManualSteering?: boolean, simHour: number = 0, fullSynopticSteering: boolean = false): { u: number; v: number } {
  if (config.newEnvironmentPhysicsEnabled && fullSynopticSteering) {
    return getSynopticSteering(lat, lon, vmax, config, simHour);
  }
  if (config.newEnvironmentPhysicsEnabled) {
    // A/B isolation is strict in live/manual mode: do not leak any legacy ridge/monsoon/trade-wind
    // steering into the new system. Per the 3.7.8 test contract only the new *westerly* field may
    // perturb user-operated/live motion; all other new steering is forecast/automatic-path only.
    const synW = getSynopticWesterlyLiveContribution(lat, lon, config, simHour);
    const gate = smoothstep01((lat - 23.5) / 17.0);
    return { u: synW.u * gate * 0.42, v: synW.v * gate * 0.42 };
  }
  // Aggregate steering flow is vertically weighted based on typhoon intensity:
  // Weaker systems (TD, TS) are controlled by low-to-mid levels (850, 700 hPa)
  // Stronger systems (TY, SuperTY) are governed by deeper layer average (850 to 200 hPa)
  
  // Weights (smoothly interpolating from vmax = 10 to 60 m/s)
  // We approximate 700 hPa as the average of 850 and 500 hPa for simplification
  const t = Math.min(Math.max((vmax - 15) / 45, 0.0), 1.0); // 0 at weak, 1 at strong

  // Weak system weights
  const w850_weak = 0.45;
  const w500_weak = 0.55; // represents mid-levels 700-500 hPa
  const w200_weak = 0.00;

  // Strong system weights
  const w850_strong = 0.15;
  const w500_strong = 0.60;
  const w200_strong = 0.25;

  const w850 = w850_weak * (1 - t) + w850_strong * t;
  const w500 = w500_weak * (1 - t) + w500_strong * t;
  const w200 = w200_weak * (1 - t) + w200_strong * t;

  const wind850 = getEnvironmentalWind(850, lat, lon, config, simHour, false);
  const wind500 = getEnvironmentalWind(500, lat, lon, config, simHour, false);
  const wind200 = getEnvironmentalWind(200, lat, lon, config, simHour, false);

  let u = wind850.u * w850 + wind500.u * w500 + wind200.u * w200;
  let v = wind850.v * w850 + wind500.v * w500 + wind200.v * w200;

  // Subtropical High Core Barrier & Breakthrough Physics
  if (config.subtropicalHighEnabled && config.subtropicalHighStrength > 0) {
    const subHighLat = config.subtropicalHighLat;
    const subHighLon = config.subtropicalHighLon;
    const westExtend = config.subtropicalHighWestExtent;
    const strength = config.subtropicalHighStrength;

    const nsSize = config.subtropicalHighNSSize !== undefined ? config.subtropicalHighNSSize : 1.0;
    const ewSize = config.subtropicalHighEWSize !== undefined ? config.subtropicalHighEWSize : 1.0;
    const dLat = (lat - subHighLat) / (6.0 * nsSize);
    let dLon = 0;
    if (lon > subHighLon) {
      dLon = (lon - subHighLon) / (12.0 * ewSize);
    } else if (lon >= westExtend) {
      dLon = 0;
    } else {
      dLon = (lon - westExtend) / (10.0 * ewSize);
    }
    const r = Math.sqrt(dLat * dLat + dLon * dLon);

    // If cyclone approaches Subtropical High core interior (r < 1.25)
    if (r < 1.25) {
      // Breakthrough Check:
      // High-intensity Super Typhoon (vmax >= 55 m/s) has a tiny ~2% chance of fracturing/breaking through the high,
      // or if a deep westerly trough (depth > 0.90) cuts a breach in the high,
      // or if the user is manually operating the virtual joystick.
      let canBreakthrough = false;
      if (isManualSteering) {
        canBreakthrough = true;
      } else if (config.westerliesTroughDepth > 0.90 && lat > subHighLat - 2.0) {
        canBreakthrough = true;
      } else if (vmax >= 55.0) {
        // Deterministic roll based on coordinates/vmax
        const rollVal = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233 + vmax * 3.14159)) % 1.0;
        if (rollVal < 0.02) {
          canBreakthrough = true;
        }
      }

      if (!canBreakthrough) {
        // Repel from core, forcing cyclone to slide smoothly along the outer 5880 gpm edge
        const pushFactor = Math.pow((1.25 - r) / 1.25, 1.2) * 8.5 * strength;
        const angle = Math.atan2(dLat * 1.5, dLon);
        u += Math.cos(angle) * pushFactor;
        v += Math.sin(angle) * pushFactor;
      }
    }
  }


  return { u, v };
}

// --- Typhoon Core Engine ---

export class TyphoonEngine {
  private prng: SeededRandom;

  private seedStr: string;
  constructor(seedStr: string) {
    this.seedStr = seedStr;
    this.prng = new SeededRandom(seedStr);
  }
  public capturePrngState(): number { return this.prng.getState(); }
  public restorePrngState(state: number): void { this.prng.setState(state); }
  public syncPrngToHour(hour: number) {
    this.prng = new SeededRandom(this.seedStr);
    const steps = Math.floor(hour * 6); // 6 steps per hour
    for (let i = 0; i < steps; i++) {
       // Burn steps to catch up
       this.prng.next(); 
    }
  }

  // Generate an initial beautiful typhoon named "夜澜"
  public createDefaultTyphoon(id: string, name: string, lat: number, lon: number, config: SimulationConfig, requestedInitialVmax = 15.0): Typhoon {
    const initialVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(30, Number.isFinite(requestedInitialVmax) ? requestedInitialVmax : 15.0));
    // A manually spawned 18 m/s disturbance/TD should have a short organisation period instead
    // of receiving a positive thermodynamic tendency on the very first integration step.
    const genesisIntensityHoldHours = initialVmax >= 17.5 && initialVmax <= 18.5 ? 3.0 : 0;
    const initialPmin = calculatePressure(initialVmax);
    const sizeFactor = 1.0; // medium size
    const maxR7Limit = 550;

    const r7 = { ne: 0, se: 0, sw: 0, nw: 0 };
    const r10 = { ne: 0, se: 0, sw: 0, nw: 0 };
    const r12 = { ne: 0, se: 0, sw: 0, nw: 0 };

    const readings = calculateStationReadings(lat, lon, initialVmax, initialPmin, 38, r7, r10, r12, undefined, 0, undefined, undefined, { direction: 300, speed: 15, simHour: 0, config });

    return {
      id,
      name,
      lat,
      lon,
      vmax: initialVmax,
      genesisIntensityReference: initialVmax,
      genesisIntensityHoldHours,
      pmin: initialPmin,
      direction: 315, // NW
      speed: 15,
      rmw: 38,
      r7,
      r10,
      r12,
      active: true,
      category: TyphoonCategory.TD,
      officialNamingHour: undefined,
      hasBeenOfficiallyNamed: false,
      landed: false,
      dissipated: false,
      extrTransition: 0,
      coldAirWarmCoreDamage: 0,
      coldAirWarmCoreDestroyed: false,
      ewrcState: "none",
      ewrcProgress: 0,
      rapidIntensifying: false,
      maxR7Limit,
      circulationExpansion: 0,
      openOceanEnergyHours: 0,
      moistureReservoir: 0.96,
      dryAirWrapFraction: 0,
      moistEnvelopeIntegrity: 0.62,
      innerCoreMoisture: 0.72,
      eyewallOpenSectorFraction: 0.08,
      deepConvectiveCoverage: 0.22,
      lowLevelVortexIntegrity: 0.48,
      postPeakEnvelopeMemory: 0.10,
      peakVmaxMemory: initialVmax,
      successfulEwrcCount: 0,
      autoIntensityTarget: config.maxIntensityLimit ?? 70,
      extremeIntensityHours: 0,
      dryAirLifecyclePhase: "moist_protected",
      dryAirVentilationIndex: 0,
      dryAirCoreConnection: 0,
      dryAirReMoistening: 0,
      dryAirConvectiveArcBearingDeg: 0,
      eyewallColdPoolMemory: 0,
      westerlyInteractionHours: 0,
      westerlyRainMemory: 0,
      northeastCloudTailStrength: 0,
      warmConveyorBeltStrength: 0,
      northeastCloudStripping: 0,
      llccExposure: 0,
      asymmetricReburstStrength: 0,
      asymmetricReburstBearingDeg: 0,
      ewrcStandoffStrength: 0,
      giantEyeOuterWallMemory: 0,
      brownOceanBurstIndex: 0,
      landfallOuterRainbandIndex: 0,
      coreGeometryContinuity: 0.94,
      dvorakTNumber: estimateDvorakTNumber(initialVmax),
      marineMoistureLink: 0,
      binaryInteractionStrength: 0,
      binaryInducedShearKt: 0,
      binaryMergerRecoveryHours: 0,
      absorbedCycloneCount: 0,
      upwellingHours: 0,
      eyeType: "none",
      eyePhase: "none",
      eyeRadiusKm: 0,
      eyeClearance: 0,
      eyeBrightnessTempC: -38,
      eyeObstruction: 0.92,
      eyewallIntegrity: 0.08,
      eyewallWrapProgress: 0.02,
      eyeFormationMemory: 0,
      secondaryEyewallStrength: 0,
      eyeWarmCore: 0.08,
      eyeAsymmetry: 0.38,
      structuralState: 1,
      structureMode: "tropical_depression",
      coreCompactness: 0.18,
      convectiveBurstIndex: 0.12,
      rainbandDominance: 0.72,
      outflowEfficiency: 0.46,
      coreRebuildScar: 0,
      terrainHollowCoreMemory: 0,
      terrainHollowCoreBearingDeg: 0,
      damageOrigin: "none",
      terrainDamageMorphology: undefined,
      ewrcFailureMode: "none",
      broadMoisturePlatform: 0.18,
      preparednessIndex: 0.24,
      forecastSurpriseIndex: 0,
      warningLeadHours: 0,
      isManualSteering: false,
      lastVelocityU: 0,
      lastVelocityV: 0,
      stationReadings: readings,
      history: [
        {
          lat,
          lon,
          vmax: initialVmax,
          genesisIntensityReference: initialVmax,
          genesisIntensityHoldHours,
          pmin: initialPmin,
          direction: 315,
          speed: 15,
          rmw: 38,
          r7,
          r10,
          r12,
          category: TyphoonCategory.TD,
          officialNamingHour: undefined,
          hasBeenOfficiallyNamed: false,
          simHour: 0,
          landed: false,
          dissipated: false,
          extrTransition: 0,
          coldAirWarmCoreDamage: 0,
          coldAirWarmCoreDestroyed: false,
          ewrcState: "none",
          ewrcProgress: 0,
          rapidIntensifying: false,
          maxR7Limit,
          circulationExpansion: 0,
          openOceanEnergyHours: 0,
          moistureReservoir: 0.96,
          dryAirWrapFraction: 0,
          moistEnvelopeIntegrity: 0.62,
          innerCoreMoisture: 0.72,
          eyewallOpenSectorFraction: 0.08,
          deepConvectiveCoverage: 0.22,
          lowLevelVortexIntegrity: 0.48,
          postPeakEnvelopeMemory: 0.10,
          peakVmaxMemory: initialVmax,
          successfulEwrcCount: 0,
          autoIntensityTarget: config.maxIntensityLimit ?? 70,
          extremeIntensityHours: 0,
          dryAirLifecyclePhase: "moist_protected",
          dryAirVentilationIndex: 0,
          dryAirCoreConnection: 0,
          dryAirReMoistening: 0,
          dryAirConvectiveArcBearingDeg: 0,
          eyewallColdPoolMemory: 0,
          westerlyInteractionHours: 0,
          westerlyRainMemory: 0,
          northeastCloudTailStrength: 0,
          warmConveyorBeltStrength: 0,
          northeastCloudStripping: 0,
          llccExposure: 0,
          asymmetricReburstStrength: 0,
          asymmetricReburstBearingDeg: 0,
          ewrcStandoffStrength: 0,
          giantEyeOuterWallMemory: 0,
          brownOceanBurstIndex: 0,
          landfallOuterRainbandIndex: 0,
          coreGeometryContinuity: 0.94,
          dvorakTNumber: estimateDvorakTNumber(initialVmax),
          marineMoistureLink: 0,
          binaryInteractionStrength: 0,
          binaryInducedShearKt: 0,
          binaryMergerRecoveryHours: 0,
          absorbedCycloneCount: 0,
          upwellingHours: 0,
          eyeType: "none",
          eyePhase: "none",
          eyeRadiusKm: 0,
          eyeClearance: 0,
          eyeBrightnessTempC: -38,
          eyeObstruction: 0.92,
          eyewallIntegrity: 0.08,
          eyewallWrapProgress: 0.02,
          eyeFormationMemory: 0,
          secondaryEyewallStrength: 0,
          eyeWarmCore: 0.08,
          eyeAsymmetry: 0.38,
          structuralState: 1,
          structureMode: "tropical_depression",
          coreCompactness: 0.18,
          convectiveBurstIndex: 0.12,
          rainbandDominance: 0.72,
          outflowEfficiency: 0.46,
          coreRebuildScar: 0,
          terrainHollowCoreMemory: 0,
          terrainHollowCoreBearingDeg: 0,
          damageOrigin: "none",
          ewrcFailureMode: "none",
          broadMoisturePlatform: 0.18,
          preparednessIndex: 0.24,
          forecastSurpriseIndex: 0,
          warningLeadHours: 0,
          stationReadings: readings,
          configSnapshot: snapshotSimulationConfig(config)
        }
      ]
    };
  }

  // Update simulation step (advances by simStepMins, default is 10 minutes)
  public stepSimulation(
    typhoons: Typhoon[],
    config: SimulationConfig,
    currentSimHourFloat: number,
    startDate?: Date,
    options?: { liveForecastMode?: "full" | "preview" | "off" }
  ): { updatedTyphoons: Typhoon[]; logs: EventLog[] } {
    // Runtime callers can completely suppress forecast work while no forecast-derived map layer is
    // visible.  "preview" uses a 3-hour geometry-only integrator; the default "full" preserves
    // historical/test behaviour for non-UI callers.  Formal products are materialized separately.
    const liveForecastMode = options?.liveForecastMode ?? "full";
    const circulationTransition = resolveCirculationSizeTransition(config, currentSimHourFloat);
    const effectiveCirculationReference = circulationTransition.referenceKm;
    const exactCirculationTransitionAnalysis = shouldUseExactCirculationTransitionAnalysis(
      circulationTransition,
      currentSimHourFloat,
      3
    );
    // Round146: the *target reference* may evolve at 10-minute physics resolution,
    // but published R7/R10/R12 are 3-hour analyses. A timed user adjustment must
    // never bypass the issuance clock and animate the visible wind-area boundary.
    if (Math.abs(effectiveCirculationReference - Number(config.circulationSizeReferenceKm ?? 320)) > 1e-6) {
      // Preserve the requested target/start/from metadata, but expose only the time-resolved
      // effective reference to the physics below. This prevents a 72 h request from being
      // consumed as the final target during the first 0-3 h wind-area issuance.
      config = { ...config, circulationSizeReferenceKm: effectiveCirculationReference };
    }
    const logs: EventLog[] = [];
    const updatedTyphoons: Typhoon[] = [];
    const binaryInteractions = diagnoseBinaryCycloneInteractions(typhoons);

    for (let index = 0; index < typhoons.length; index++) {
      const ty = typhoons[index];
      const playgroundMode = isPlaygroundMode(config);
      if (!ty.active || ty.dissipated) {
        // A completed wind-season cyclone is immutable archival data. Reusing the same object
        // avoids allocating one replacement object per archived storm on every 10-minute physics
        // step (and prevents needless downstream rerenders/GC) while preserving the legacy
        // normalization path for unusual inactive-but-not-yet-archived states.
        if (!ty.active && ty.dissipated && (!ty.forecastPath || ty.forecastPath.length === 0)) {
          updatedTyphoons.push(ty);
        } else {
          updatedTyphoons.push({ ...ty, forecastPath: [], active: false, dissipated: true });
        }
        continue;
      }

      const currentSimHour = Math.floor(currentSimHourFloat + 0.001); // Stable integer hour
      let hasBeenOfficiallyNamed = !!ty.hasBeenOfficiallyNamed;
      let officialNamingHour = Number.isFinite(Number(ty.officialNamingHour)) ? Number(ty.officialNamingHour) : undefined;

      // Check current land metrics
      const landCheck = getLandMetrics(ty.lat, ty.lon, config?.coastlineSource);

      // --- 1. Path steering calculation ---
      const steering = getSteeringFlow(ty.lat, ty.lon, ty.vmax, config, false, currentSimHourFloat, false);
      const binaryInteraction: BinaryCycloneInteraction = binaryInteractions?.get(ty.id) || NO_BINARY_CYCLONE_INTERACTION;
      // Merger-induced tilt does not disappear in the first frame after the weaker circulation is
      // marked absorbed. Carry a decaying residual of the diagnosed binary shear through the
      // reorganization window; this supports the observed/expected sequence of a brief convective
      // pulse followed by ventilation/weakening before the combined vortex axisymmetrizes.
      const binaryMergerRecoveryPrior = Math.max(0, ty.binaryMergerRecoveryHours ?? 0);
      const binaryResidualShearKt = binaryMergerRecoveryPrior > 0
        ? Math.min(18, Math.max(0, ty.binaryInducedShearKt ?? 0) *
            (0.58 + 0.42 * clamp01(binaryMergerRecoveryPrior / 28.0)))
        : 0;
      const binaryEffectiveShearKt = Math.max(binaryInteraction.inducedShearKt, binaryResidualShearKt);
      // Fujiwhara / multi-vortex interaction is applied as an environmental-motion anomaly, not
      // as a replacement for synoptic steering. This keeps user/manual control and the large-scale
      // ridge/trough flow intact while allowing close vortices to orbit, attract/repel and shear.
      if (!ty.isManualSteering) {
        steering.u += binaryInteraction.u;
        steering.v += binaryInteraction.v;
      }

      // C. Declare variables for state tracking early to avoid reference errors
      let isStructureDamaged = ty.isStructureDamaged || false;
      let passedTaiwanCentral = ty.passedTaiwanCentral || false;
      let passedLuzonMountains = ty.passedLuzonMountains || false;
      let structuralDamagePenaltyFactor = ty.structuralDamagePenaltyFactor !== undefined ? ty.structuralDamagePenaltyFactor : 1.0;
      let coreRebuildScar = clamp01(ty.coreRebuildScar ?? 0);
      // 3.3.15: severe mountain crossings may destroy the *old* closed inner-core ring.  Keep that
      // memory separate from the ordinary recoverable scar so warm water cannot rebuild a pristine
      // eye in one or two model steps.  Only the explicit user core-rebuild burst is allowed to
      // remove this memory.
      let terrainHollowCoreMemory = clamp01(ty.terrainHollowCoreMemory ?? 0);
      let terrainHollowCoreBearingDeg = Number.isFinite(ty.terrainHollowCoreBearingDeg as number)
        ? (ty.terrainHollowCoreBearingDeg as number)
        : (ty.terrainInteractionBearingDeg ?? 0);
      let damageOrigin: Typhoon["damageOrigin"] = ty.damageOrigin ?? "none";
      let terrainDamageMorphology: Typhoon["terrainDamageMorphology"] = ty.terrainDamageMorphology;
      let ewrcFailureMode: Typhoon["ewrcFailureMode"] = ty.ewrcFailureMode ?? "none";
      let coreCompactness = clamp01(ty.coreCompactness ?? (ty.vmax >= 32.7 ? 0.55 : 0.30));
      let convectiveBurstIndex = clamp01(ty.convectiveBurstIndex ?? 0.18);
      let rainbandDominance = clamp01(ty.rainbandDominance ?? 0.48);
      let outflowEfficiency = clamp01(ty.outflowEfficiency ?? 0.55);
      let broadMoisturePlatform = clamp01(ty.broadMoisturePlatform ?? 0.20);
      let dryAirIntrusion = clamp01(ty.dryAirIntrusion ?? 0);
      // Separate environmental/peripheral dryness from actual inner-core penetration. A mature
      // moist envelope can keep the eye/eyewall intact for hours even while dry air wraps around
      // the outer circulation; only inner-core exposure should shred the CDO/eyewall.
      let dryAirCoreExposure = clamp01(ty.dryAirCoreExposure ?? 0);
      let dryAirWrapFraction = clamp01(ty.dryAirWrapFraction ?? Math.min(0.35, dryAirIntrusion * 0.45));
      let moistEnvelopeIntegrity = clamp01(ty.moistEnvelopeIntegrity ?? (ty.vmax >= 32.7 ? 0.76 : 0.54));
      let innerCoreMoisture = clamp01(ty.innerCoreMoisture ?? (ty.vmax >= 32.7 ? 0.82 : 0.64));
      let eyewallOpenSectorFraction = clamp01(ty.eyewallOpenSectorFraction ?? 0.08);
      let deepConvectiveCoverage = clamp01(ty.deepConvectiveCoverage ?? (ty.vmax >= 32.7 ? 0.68 : 0.34));
      let lowLevelVortexIntegrity = clamp01(ty.lowLevelVortexIntegrity ?? 0.58);
      let postPeakEnvelopeMemory = clamp01(ty.postPeakEnvelopeMemory ?? 0.10);
      let peakVmaxMemory = Math.max(ty.vmax, ty.peakVmaxMemory ?? ty.vmax);
      let successfulEwrcCount = Math.max(0, ty.successfulEwrcCount ?? 0);
      // Declare lifecycle flags before the thermodynamic/automatic-target diagnostics so no
      // temporal-dead-zone read can occur during the first integration step.
      let rapidIntensifying = ty.rapidIntensifying;
      let ewrcState = ty.ewrcState;
      let autoIntensityTarget = Math.max(MIN_CYCLONE_INTENSITY_MS, ty.autoIntensityTarget ?? (config.maxIntensityLimit ?? 70));
      let extremeIntensityHours = Math.max(0, ty.extremeIntensityHours ?? 0);
      let dryAirLifecyclePhase: Typhoon["dryAirLifecyclePhase"] = ty.dryAirLifecyclePhase ?? "moist_protected";
      let dryAirVentilationIndex = clamp01(ty.dryAirVentilationIndex ?? 0);
      let dryAirCoreConnection = clamp01(ty.dryAirCoreConnection ?? 0);
      let dryAirReMoistening = clamp01(ty.dryAirReMoistening ?? 0);
      let dryAirConvectiveArcBearingDeg = Number.isFinite(ty.dryAirConvectiveArcBearingDeg as number)
        ? (ty.dryAirConvectiveArcBearingDeg as number)
        : (((ty.drySlotBearingDeg ?? ((ty.shearDir ?? ty.direction ?? 0) + 150)) + 175) % 360);
      let eyewallColdPoolMemory = clamp01(ty.eyewallColdPoolMemory ?? 0);
      let moistCoreProtection = clamp01(ty.moistCoreProtection ?? (ty.vmax >= 32.7 ? 0.68 : 0.38));
      let dryErosionHours = Math.max(0, ty.dryErosionHours ?? 0);
      let dryRecoveryHours = Math.max(0, ty.dryRecoveryHours ?? 0);
      let drySlotBearingDeg = Number.isFinite(ty.drySlotBearingDeg as number)
        ? (ty.drySlotBearingDeg as number)
        : (((ty.shearDir ?? ty.direction ?? 0) + 150) % 360);
      let rebuiltCoreDiameterKm = Math.max(0, ty.rebuiltCoreDiameterKm ?? 0);
      let convectiveSuppression = clamp01(ty.convectiveSuppression ?? 0);
      let structuralDisorganization = clamp01(ty.structuralDisorganization ?? 0);
      // 3.3.10 terrain-friction diagnostics are persisted so a partial mountain scrape or a flat
      // land crossing leaves a physically continuous structural memory after the centre returns
      // over water. terrainFrictionWork is an equivalent exposure-hours accumulator; the other
      // fields are normalized 0..1 diagnostics from the sampled inner-core surface.
      let terrainFrictionWork = Math.max(0, ty.terrainFrictionWork ?? 0);
      let terrainBlockingMemory = clamp01(ty.terrainBlockingMemory ?? 0);
      let terrainFrictionAsymmetry = clamp01(ty.terrainFrictionAsymmetry ?? 0);
      let terrainCoreLandFraction = clamp01(ty.terrainCoreLandFraction ?? 0);
      let terrainMountainFraction = clamp01(ty.terrainMountainFraction ?? 0);
      let terrainMaxCoreElevation = Math.max(0, ty.terrainMaxCoreElevation ?? 0);
      let terrainInteractionBearingDeg = Number.isFinite(ty.terrainInteractionBearingDeg as number)
        ? (ty.terrainInteractionBearingDeg as number)
        : 0;
      let cdoDiameterKm = Math.max(0, ty.cdoDiameterKm ?? 0);
      let coastalCoreInfluence = clamp01(ty.coastalCoreInfluence ?? 0);
      let coldWaterExposureHours = Math.max(0, ty.coldWaterExposureHours ?? 0);
      let coldWaterTsShelfHours = Math.max(0, ty.coldWaterTsShelfHours ?? 0);
      let coldWaterTsShelfMemory = clamp01(ty.coldWaterTsShelfMemory ?? 0);
      let westerlyInteractionHours = Math.max(0, ty.westerlyInteractionHours ?? 0);
      let westerlyRainMemory = clamp01(ty.westerlyRainMemory ?? 0);
      let northeastCloudTailStrength = clamp01(ty.northeastCloudTailStrength ?? 0);
      let warmConveyorBeltStrength = clamp01(ty.warmConveyorBeltStrength ?? 0);
      let northeastCloudStripping = clamp01(ty.northeastCloudStripping ?? 0);
      let llccExposure = clamp01(ty.llccExposure ?? 0);
      let asymmetricReburstStrength = clamp01(ty.asymmetricReburstStrength ?? 0);
      let asymmetricReburstBearingDeg = Number.isFinite(ty.asymmetricReburstBearingDeg as number)
        ? (ty.asymmetricReburstBearingDeg as number)
        : (((ty.shearDir ?? ty.direction ?? 0) + 115) % 360);
      let ewrcStandoffStrength = clamp01(ty.ewrcStandoffStrength ?? 0);
      let giantEyeOuterWallMemory = clamp01(ty.giantEyeOuterWallMemory ?? 0);
      let brownOceanBurstIndex = clamp01(ty.brownOceanBurstIndex ?? 0);
      let landfallOuterRainbandIndex = clamp01(ty.landfallOuterRainbandIndex ?? 0);
      let coreGeometryContinuity = clamp01(ty.coreGeometryContinuity ?? 0.92);
      let postDryAirBurstSuppressionHours = Math.max(0, ty.postDryAirBurstSuppressionHours ?? 0);
      // A pre-TC squall line is an episodic event, not a permanent radial precipitation term.
      // Persist the one-shot decision so history/replay cannot respawn it every step.
      let preStormSquallEvaluated = !!ty.preStormSquallEvaluated;
      let preStormSquallStartHour = ty.preStormSquallStartHour;
      let preStormSquallDurationHours = ty.preStormSquallDurationHours;
      let preStormSquallBearingOffsetDeg = ty.preStormSquallBearingOffsetDeg;
      let preStormSquallSpeedKmh = ty.preStormSquallSpeedKmh;
      let structureMode: Typhoon["structureMode"] = ty.structureMode ?? (ty.vmax < 17.2 ? "tropical_depression" : ty.vmax < 32.7 ? "rainband_dominant" : "loose_cdo");
      let maxLandElevationPassed = ty.maxLandElevationPassed || 0;
      let structuralDamageHours = ty.structuralDamageHours || 0;
      let warmWaterHoursAfterSea = ty.warmWaterHoursAfterSea || 0;
      let landHours = ty.landHours || 0;
      let landContactHours = ty.landContactHours || 0;
      let r10LandContactHours = ty.r10LandContactHours || 0;
      let forcedDecayStartVmax = ty.forcedDecayStartVmax;
      let forcedDecayTargetVmax = ty.forcedDecayTargetVmax;
      let forcedDecayElapsedHours = ty.forcedDecayElapsedHours || 0;
      let forcedDecayDuration = ty.forcedDecayDuration;
      let forcedDecayIsContinuous = ty.forcedDecayIsContinuous;
      let penaltyRecoveryActive = !!ty.penaltyRecoveryActive;
      let penaltyRecoveryElapsedHours = Math.max(0, ty.penaltyRecoveryElapsedHours ?? 0);
      let penaltyRecoveryTotalHours = Math.max(1, ty.penaltyRecoveryTotalHours ?? 18);
      let penaltyRecoveryStage: Typhoon["penaltyRecoveryStage"] = ty.penaltyRecoveryStage ?? "purging";
      let preparednessIndex = clamp01(ty.preparednessIndex ?? 0.24);
      let forecastSurpriseIndex = clamp01(ty.forecastSurpriseIndex ?? 0);
      let warningLeadHours = Math.max(0, ty.warningLeadHours ?? 0);

      // B. Beta-Drift (coriolis effect on vortex, creates slight NW shift)
      let betaU = 0;
      let betaV = 0;
      if (config.betaDriftEnabled) {
        // Requirement 5 & 6: Beta drift influenced by actual size (r7) and lat
        const scale = config.betaDriftScale;
        const r7avg = ty.r7 && ty.r7.ne > 0 ? (ty.r7.ne + ty.r7.nw + ty.r7.sw + ty.r7.se) / 4.0 : (ty.vmax * 5.8 + 30);
        const sizeFactor = Math.max(0.3, Math.min(2.0, r7avg / 250.0));
        betaU = -0.5 * scale * sizeFactor * (1.0 + Math.sin((ty.lat * Math.PI)/180));
        betaV = 0.7 * scale * sizeFactor * (1.0 + Math.sin((ty.lat * Math.PI)/180));
      }

      // C. User Virtual Joystick input
      let joyU = 0;
      let joyV = 0;
      
      // Track manual steering state
      let isManualSteering = ty.isManualSteering || false;
      let lastVelocityU = ty.lastVelocityU || 0;
      let lastVelocityV = ty.lastVelocityV || 0;

      const isDragging = config.controlMode !== "draw" && (config.joystickDragging || false);
      // Default/hold mode preserves the established manual velocity after release, matching the
      // non-centred on-screen handle. In return-to-centre mode, a cyclone that has already entered
      // manual-steering state must interpret the centred joystick as an explicit zero manual motion
      // vector. Do NOT restore the pre-adjustment retained velocity and do NOT silently jump back to
      // the environmental minimum-speed branch. A cyclone that has never been manually steered still
      // follows the normal environmental flow.
      if (!isDragging && config.joystickReturnToCenter && isManualSteering) {
        lastVelocityU = 0;
        lastVelocityV = 0;
      }
      const heldJoystickActive = !isDragging && isManualSteering && !config.joystickReturnToCenter &&
        Math.hypot(config.joystickDx || 0, config.joystickDy || 0) >= 0.02;
      const effectiveDx = (isDragging || heldJoystickActive) ? config.joystickDx : 0;
      const effectiveDy = (isDragging || heldJoystickActive) ? config.joystickDy : 0;

      // Westerlies no longer inject an extra eastward/manual steering vector. Instead they only
      // change the response of the joystick itself: ordinary flow = 100% sensitivity, embedded
      // jet = up to 200%. Returning the stick toward centre therefore always reduces translation
      // speed normally, and moving south out of the westerlies continuously restores 100%.
      const manualWesterlyDepth = effectiveWesterlyDepth(ty.lat, ty.lon, config, ty.simHour);
      const joystickJetGate = config.newEnvironmentPhysicsEnabled
        ? smoothstep01((manualWesterlyDepth - 0.14) / 0.66)
        : (config.westerliesEnabled ? smoothstep01((ty.lat - ((config.westerliesLat ?? 30) - 8)) / 18) : 0);
      const joystickSensitivityBoost = 1.0 + joystickJetGate;

      if (effectiveDx !== 0 || effectiveDy !== 0) {
        // sensitivity converts joystick offset (-1 to +1) to steering speed (m/s)
        const speedMultiplier = config.joystickStrength * config.joystickSensitivity * joystickSensitivityBoost * 4.5;
        joyU = effectiveDx * speedMultiplier;
        joyV = effectiveDy * speedMultiplier;
        
        isManualSteering = true;
      }

      // E. Small repeatable random noise
      let noiseU = 0;
      let noiseV = 0;
      if (config.randomNoise > 0) {
        noiseU = this.prng.nextRange(-1.0, 1.0) * config.randomNoise * 0.8;
        noiseV = this.prng.nextRange(-1.0, 1.0) * config.randomNoise * 0.8;
      }

      // Environmental background steering vector
      const envU = steering.u + betaU + noiseU;
      const envV = steering.v + betaV + noiseV;

      // Aggregate steering flow vectors (in m/s)
      let u_agg: number;
      let v_agg: number;

      if (effectiveDx !== 0 || effectiveDy !== 0) {
        // Active manual steering is authoritative. The westerlies affect joystick sensitivity
        // above, not direction or a hidden eastward push vector.
        u_agg = joyU;
        v_agg = joyV;
        lastVelocityU = u_agg;
        lastVelocityV = v_agg;
        isManualSteering = true;
      } else if (isManualSteering) {
        // Hold mode keeps the last manual velocity. Return-to-centre mode has already replaced
        // lastVelocityU/V with an explicit zero vector above, so the centred handle means 0 km/h.
        u_agg = lastVelocityU;
        v_agg = lastVelocityV;
      } else {
        // Standard environmental steering flow
        u_agg = envU;
        v_agg = envV;
        lastVelocityU = envU;
        lastVelocityV = envV;
        isManualSteering = false;
      }

      // Westerlies active check (only when westerlies are enabled and typhoon is near/in the westerlies zone)
      const wLat = config.westerliesLat ?? 30.0;
      const liveWesterlyDepth = manualWesterlyDepth;
      const isWesterliesZone = config.newEnvironmentPhysicsEnabled
        ? liveWesterlyDepth > 0.14
        : (config.westerliesEnabled && (config.westerliesStrength ?? 1.0) > 0 && ty.lat > wLat - 8.0);

      // Calculate movement speed (km/h)
      // New live mode intentionally ignores the old subtropical-high geometry. These constants
      // are only neutral speed-envelope geography, not steering from the new ridge field.
      const subHighLatLive = config.newEnvironmentPhysicsEnabled ? 28 : (config.subtropicalHighLat ?? 28);
      const subHighWestLive = config.newEnvironmentPhysicsEnabled ? 125 : (config.subtropicalHighWestExtent ?? 125);
      const isFarOceanLive = ty.lon > 140.0 && Math.abs(ty.lat - subHighLatLive) > 7.0 && ty.lon > subHighWestLive + 10;

      let speedMps = Math.hypot(u_agg, v_agg);
      let speedKmh = speedMps * 3.6;

      if (speedKmh < (isFarOceanLive ? 15.0 : 18.0) && speedKmh > 0 && !isManualSteering) {
          const targetMin = isFarOceanLive ? 15.0 : 18.0;
          const scale = targetMin / speedKmh;
          u_agg *= scale;
          v_agg *= scale;
          speedKmh = targetMin;
      }
      if (!isWesterliesZone && !isManualSteering) {
        if (isFarOceanLive) {
          const targetMin = 15.0;
          const targetMax = 20.0;
          if (speedKmh < targetMin && speedKmh > 0) {
            const scale = targetMin / speedKmh;
            u_agg *= scale;
            v_agg *= scale;
            speedKmh = targetMin;
          } else if (speedKmh > targetMax) {
            const scale = targetMax / speedKmh;
            u_agg *= scale;
            v_agg *= scale;
            speedKmh = targetMax;
          }
        } else {
          const targetMin = 18.0;
          const targetMax = 28.0;
          if (speedKmh < targetMin && speedKmh > 0) {
            const scale = targetMin / speedKmh;
            u_agg *= scale;
            v_agg *= scale;
            speedKmh = targetMin;
          } else if (speedKmh > targetMax) {
            const scale = targetMax / speedKmh;
            u_agg *= scale;
            v_agg *= scale;
            speedKmh = targetMax;
          }
        }

        if (speedKmh > 32.0) {
          const scale = 32.0 / speedKmh;
          u_agg *= scale;
          v_agg *= scale;
          speedKmh = 32.0;
        }
      } else if (isWesterliesZone) {
        // Do not manufacture a due-east acceleration merely because the cyclone entered the
        // westerlies. Environmental steering already contains the resolved synoptic jet. Manual
        // control receives only the smooth 100→200% sensitivity boost above.
        // Cap only the vector magnitude. Never clamp one axis independently.
        const westerlyCapKmh = 60.0;
        if (speedKmh > westerlyCapKmh) {
          const scale = westerlyCapKmh / speedKmh;
          u_agg *= scale;
          v_agg *= scale;
          speedKmh = westerlyCapKmh;
        }
      }

      // Update lastVelocityU and lastVelocityV
      lastVelocityU = u_agg;
      lastVelocityV = v_agg;

      // Convert m/s steering velocity to coordinates changes (degrees/hour)
      // 1 degree of latitude ≈ 111,111 meters.
      // 1 degree of longitude ≈ 111,111 * cos(lat) meters.
      const latSpeedDegHour = (v_agg * 3600.0) / 111111.0;
      const lonSpeedDegHour = (u_agg * 3600.0) / (111111.0 * Math.cos((ty.lat * Math.PI) / 180));

      let dirDegrees = Math.round((Math.atan2(u_agg, v_agg) * 180.0) / Math.PI);
      if (dirDegrees < 0) dirDegrees += 360;

      // Update positions for 10 minutes step (1/6 of an hour)
      const stepFraction = 1.0 / 6.0;
      if (ty.vmax >= 65.0) extremeIntensityHours = Math.min(96, extremeIntensityHours + stepFraction);
      else extremeIntensityHours = Math.max(0, extremeIntensityHours - 0.35 * stepFraction);
      if (penaltyRecoveryActive) {
        penaltyRecoveryElapsedHours = Math.min(penaltyRecoveryTotalHours, penaltyRecoveryElapsedHours + stepFraction);
        const recoveryProgress = clamp01(penaltyRecoveryElapsedHours / penaltyRecoveryTotalHours);
        penaltyRecoveryStage = recoveryProgress < 0.30 ? "purging" : recoveryProgress < 0.68 ? "realigning" : "rebuilding";
      }
      let newLat = ty.lat + latSpeedDegHour * stepFraction;
      let newLon = ty.lon + lonSpeedDegHour * stepFraction;
      // Drawn-track mode is authoritative for the LIVE cyclone, not merely a forecast bias.
      // Arc-length progress belongs to each cyclone and is saved in its hourly snapshots.
      const drawnStep = config.controlMode === "draw" && ty.active && !ty.dissipated
        ? advanceDrawnTrack(config.drawnTrackRoute || [], ty.drawnRouteProgressKm ?? 0, config.drawnTrackSpeedKmh ?? 20, stepFraction)
        : null;
      if (drawnStep) {
        newLat = drawnStep.lat;
        newLon = drawnStep.lon;
        dirDegrees = drawnStep.direction;
        u_agg = Math.sin(dirDegrees * Math.PI / 180) * drawnStep.speedKmh / 3.6;
        v_agg = Math.cos(dirDegrees * Math.PI / 180) * drawnStep.speedKmh / 3.6;
        lastVelocityU = u_agg;
        lastVelocityV = v_agg;
        isManualSteering = false;
      }

      // Expanded simulation domain. The previous 95E..180E / 0..55N clamp coincided with the
      // old small coastline plate and could physically pin both manual and environmental motion.
      newLat = Math.max(-20, Math.min(88, newLat));
      newLon = Math.max(65, Math.min(220, newLon));

      // Audit translation against the actual great-circle displacement of this 10-minute step.
      // This makes the status-card number, history CSV and map track use the same realized motion
      // even at very low speeds or high latitude, instead of reporting only the pre-projection vector.
      const actualStepDistanceKm = greatCircleDistanceKm(ty.lat, ty.lon, newLat, newLon);
      const actualMotionSpeedKmh = actualStepDistanceKm / Math.max(1e-6, stepFraction);
      if (Number.isFinite(actualMotionSpeedKmh)) speedKmh = actualMotionSpeedKmh;

      // --- 2. Intensity Engine (vmax and pmin) ---
      const metrics = getLandMetrics(newLat, newLon, config?.coastlineSource);
      let sstVal = getSST(newLat, newLon, config, currentSimHourFloat);
      // Playground mode adds an explicit +5 C ocean-energy anomaly.
      if (playgroundMode) sstVal += 5.0;
      const forcedColdWaterTemperature = Number(ty.forcedColdWaterTemperatureC);
      const forcedColdWaterStartHour = Number(ty.forcedColdWaterStartHour);
      const forcedColdWaterEndHour = Number(ty.forcedColdWaterEndHour);
      const forcedColdWaterActive = !metrics.isLand && Number.isFinite(forcedColdWaterTemperature) && Number.isFinite(forcedColdWaterStartHour) && Number.isFinite(forcedColdWaterEndHour)
        && currentSimHourFloat >= forcedColdWaterStartHour - 1e-6 && currentSimHourFloat <= forcedColdWaterEndHour + 1e-6;
      if (forcedColdWaterActive) sstVal = Math.max(0, Math.min(30, forcedColdWaterTemperature));
      
      // Safety guards for simulation parameters
      if (isNaN(sstVal)) sstVal = 28.0;
      let ohcValPre = getOHC(newLat, newLon, config, sstVal, currentSimHourFloat);
      if (isNaN(ohcValPre)) ohcValPre = 50.0;

      // Guard against NaN in positions or intensity to prevent simulation freezing/crashing
      if (isNaN(newLat) || isNaN(newLon) || isNaN(ty.vmax)) {
        console.error(`Simulation encountered NaN for typhoon ${ty.id}. Forcing reset.`);
        newLat = ty.lat || 15;
        newLon = ty.lon || 135;
        updatedTyphoons.push({ ...ty, dissipated: true, active: false });
        continue;
      }

      if (metrics.isLand) {
        landHours += stepFraction;
      } else {
        landHours = 0;
      }

      // 3.3.7 coastal inner-core coupling. A perfectly symmetric, full-sized CDO is primarily an
      // open-ocean structure. Well before the centre crosses the shoreline, roughness/moisture-flux
      // contrast and partial core contact with land favour an eccentric compact core or a broader,
      // lower-efficiency cloud shield. Use both centre-to-land distance and actual 110-km land
      // coverage so tiny islands do not exert the same influence as a mainland/mountain coastline.
      const centreDistanceToLandKm = metrics.isLand
        ? 0
        : getDistanceToLand(newLat, newLon, config?.coastlineSource, true) * 111.12;
      const coastalCoreLandCoverage = getLandCoverage(newLat, newLon, 110, config?.coastlineSource);
      const distanceCoastalInfluence = metrics.isLand
        ? 1
        : smoothstep01((340 - centreDistanceToLandKm) / 285);
      const instantaneousCoastalCoreInfluence = clamp01(
        distanceCoastalInfluence * (0.52 + 0.48 * clamp01(coastalCoreLandCoverage / 0.22))
      );
      coastalCoreInfluence += (instantaneousCoastalCoreInfluence - coastalCoreInfluence) *
        clamp01(stepFraction / (instantaneousCoastalCoreInfluence > coastalCoreInfluence ? 1.8 : 5.5));
      coastalCoreInfluence = clamp01(coastalCoreInfluence);

      // C. Terrain/land structural interaction from sampled boundary-layer friction and terrain.
      //
      // 3.3.10 removes the old geography-specific damage targets (e.g. named-island bonuses and
      // random morphology selection).  Damage is now accumulated from the actual simulated surface
      // beneath the inner core: land roughness increases boundary-layer drag, one-sided land/sea
      // contact creates a wavenumber-1 friction asymmetry, and high/rugged terrain adds blocking.
      // This means a mountain graze can partially open/displace one side of the eyewall, while a
      // flat-land crossing still leaves measurable damage that persists after the centre exits.
      let structuralDamageSeverity = clamp01(Math.max(
        1.0 - structuralDamagePenaltyFactor,
        ty.isCoreDisrupted ? 0.68 : 0.0,
        (isStructureDamaged && (ty.isCoreDisrupted || coreRebuildScar > 0.30)) ? 0.12 : 0.0,
        ["penalty_failure", "recovering_failure"].includes(ty.ewrcState || "none") || ty.ewrcIsFailure ? 0.38 : 0.0
      ));

      // "Core damage" is only meaningful after a coherent inner core exists. A loose TD/TS can
      // still experience ordinary land intensity decay, but it cannot lose an eyewall that never
      // existed. Existing damage memory remains active even after the organized core weakens.
      const establishedCoreAtStepStart =
        ty.vmax >= 27.0 &&
        (
          coreCompactness >= 0.46 ||
          (ty.eyewallIntegrity ?? 0) >= 0.40 ||
          ["tightening_core", "mature_eyewall", "ewrc_double", "post_ewrc_broad"].includes(structureMode || "")
        );

      const coreSurfaceInteraction = getCoreSurfaceInteractionMetrics(
        newLat, newLon, ty.rmw || 30, Math.max(10, ty.vmax), config?.coastlineSource
      );
      terrainCoreLandFraction = coreSurfaceInteraction.landFraction;
      terrainMountainFraction = coreSurfaceInteraction.mountainFraction;
      terrainMaxCoreElevation = coreSurfaceInteraction.maxElevation;
      terrainInteractionBearingDeg = coreSurfaceInteraction.dominantBearingDeg;

      const instantaneousFrictionAsymmetry = coreSurfaceInteraction.frictionAsymmetry;
      const instantaneousBlocking = coreSurfaceInteraction.blockingIndex;
      terrainFrictionAsymmetry += (instantaneousFrictionAsymmetry - terrainFrictionAsymmetry) *
        (1 - Math.exp(-stepFraction / (instantaneousFrictionAsymmetry > terrainFrictionAsymmetry ? 1.2 : 7.0)));
      terrainBlockingMemory += (instantaneousBlocking - terrainBlockingMemory) *
        (1 - Math.exp(-stepFraction / (instantaneousBlocking > terrainBlockingMemory ? 1.4 : 9.0)));
      terrainFrictionAsymmetry = clamp01(terrainFrictionAsymmetry);
      terrainBlockingMemory = clamp01(terrainBlockingMemory);

      const coreSurfaceContact =
        coreSurfaceInteraction.landFraction >= 0.018 ||
        coreSurfaceInteraction.frictionIndex >= 0.018 ||
        coreSurfaceInteraction.blockingIndex >= 0.018 ||
        metrics.isLand;

      if (coreSurfaceContact && !penaltyRecoveryActive) {
        warmWaterHoursAfterSea = 0;

        // Retain old regional flags only for backwards-compatible reports/history. They no longer
        // contribute any extra damage; all damage magnitudes below come from sampled terrain.
        if (coreSurfaceInteraction.maxElevation > maxLandElevationPassed) maxLandElevationPassed = coreSurfaceInteraction.maxElevation;
        if (newLat >= 21.5 && newLat <= 25.5 && newLon >= 119.5 && newLon <= 122.5 && coreSurfaceInteraction.maxElevation > 1500) passedTaiwanCentral = true;
        if (newLat >= 12.0 && newLat <= 19.5 && newLon >= 119.0 && newLon <= 124.0 && coreSurfaceInteraction.maxElevation > 700) passedLuzonMountains = true;

        if (establishedCoreAtStepStart || structuralDamageSeverity > 0.06 || coreRebuildScar > 0.08) {
          structuralDamageHours += stepFraction;
          terrainFrictionWork = Math.min(96, terrainFrictionWork + stepFraction * (
            0.72 * coreSurfaceInteraction.frictionIndex +
            0.28 * coreSurfaceInteraction.blockingIndex
          ));

          // Fractional kinetic-energy dissipation in the boundary layer scales approximately with
          // drag and wind speed. A compact coherent eyewall is somewhat more resilient, so the
          // normalized forcing is divided by a modest organization factor rather than using Vmax
          // itself as a binary damage switch.
          const organizationResilience = 0.86 +
            0.30 * clamp01(coreCompactness) +
            0.18 * clamp01(ty.eyewallIntegrity ?? 0.45);
          const frictionForcing = clamp01(coreSurfaceInteraction.frictionIndex / organizationResilience);
          const blockingForcing = clamp01(
            coreSurfaceInteraction.blockingIndex *
            (0.72 + 0.28 * clamp01((ty.vmax - 20) / 45))
          );
          // Roughness contrast is most disruptive when only part of the inner core is over land:
          // this is the physical mountain/coast "scrape" case rather than a whole-vortex switch.
          const partialContactGate = clamp01(4.0 * terrainCoreLandFraction * (1.0 - terrainCoreLandFraction) + 0.22 * terrainCoreLandFraction);
          const asymmetricForcing = clamp01(terrainFrictionAsymmetry * (0.48 + 0.52 * partialContactGate));

          const damageRatePerHour = clamp01(
            0.075 * frictionForcing +
            0.145 * blockingForcing +
            0.055 * asymmetricForcing
          );
          structuralDamageSeverity = clamp01(
            1.0 - (1.0 - structuralDamageSeverity) * Math.exp(-damageRatePerHour * stepFraction)
          );

          // A slower structural scar represents the time needed to rebuild a compact angular-
          // momentum/eyewall ring after the immediate frictional forcing has ended. Flat land can
          // leave a scar; high/rugged terrain creates a larger one.
          const scarRatePerHour = clamp01(
            0.016 * frictionForcing +
            0.062 * blockingForcing +
            0.026 * asymmetricForcing
          );
          coreRebuildScar = clamp01(
            1.0 - (1.0 - coreRebuildScar) * Math.exp(-scarRatePerHour * stepFraction)
          );
          damageOrigin = damageOrigin === "none" || damageOrigin === "terrain" ? "terrain" : "mixed";

          // Morphology is diagnosed deterministically from the same physical forcing. No random
          // draw is used: one-sided friction/terrain contact preferentially displaces the convective
          // core; deep, broad mountain blocking can hollow/break an established eyewall; flat-land
          // friction primarily clouds the eye and loosens the inner-core ring.
          const hollowScore = clamp01(
            0.50 * terrainBlockingMemory +
            0.24 * terrainMountainFraction +
            0.26 * structuralDamageSeverity -
            0.16 * terrainFrictionAsymmetry
          );
          const displacementScore = clamp01(
            0.58 * terrainFrictionAsymmetry +
            0.22 * terrainBlockingMemory +
            0.20 * partialContactGate
          );

          // Severe mountain-core destruction is a different process from ordinary recoverable
          // roughness damage.  Once a substantial fraction of an established eyewall is forced
          // across high/rugged terrain, the old closed low-level ring can be physically severed.
          // This memory is geography-agnostic: Taiwan-like crossings score highly because the
          // sampled inner core actually encounters high mountains and strong blocking, not because
          // the storm entered a named box.  A glancing scrape can still remain partial.
          const highTerrainGate = smoothstep01((coreSurfaceInteraction.maxElevation - 850) / 1550);
          const mountainCoverageGate = smoothstep01((terrainMountainFraction - 0.055) / 0.34);
          const deepCoreLandGate = smoothstep01((terrainCoreLandFraction - 0.10) / 0.58);
          const hollowDestructionForcing = clamp01(
            0.34 * terrainBlockingMemory +
            0.20 * terrainMountainFraction +
            0.18 * highTerrainGate +
            0.12 * deepCoreLandGate +
            0.10 * structuralDamageSeverity +
            0.06 * terrainFrictionAsymmetry
          );
          const destructiveMountainCoreStrike = establishedCoreAtStepStart &&
            coreSurfaceInteraction.maxElevation >= 900 && terrainMountainFraction >= 0.065 &&
            terrainCoreLandFraction >= 0.10 && hollowDestructionForcing >= 0.34 &&
            (hollowScore >= 0.43 || terrainBlockingMemory >= 0.27);
          if (destructiveMountainCoreStrike) {
            const irreversibleRatePerHour = 0.13 + 0.38 * hollowDestructionForcing;
            terrainHollowCoreMemory = clamp01(
              1.0 - (1.0 - terrainHollowCoreMemory) * Math.exp(-irreversibleRatePerHour * stepFraction)
            );
            terrainHollowCoreBearingDeg = coreSurfaceInteraction.dominantBearingDeg;
          }

          if (structuralDamageSeverity >= 0.20 || coreRebuildScar >= 0.14 || terrainHollowCoreMemory >= 0.14) {
            if (terrainHollowCoreMemory >= 0.14 || (hollowScore >= 0.52 && (ty.eyewallIntegrity ?? 0) >= 0.46)) {
              terrainDamageMorphology = "hollow_bands";
            } else if (displacementScore >= 0.43 && terrainCoreLandFraction < 0.82) {
              terrainDamageMorphology = "displaced_core";
            } else {
              terrainDamageMorphology = "clogged_loose";
            }
          }

          const wasDamaged = isStructureDamaged;
          isStructureDamaged = (establishedCoreAtStepStart &&
            (structuralDamageSeverity >= 0.20 || coreRebuildScar >= 0.30)) || terrainHollowCoreMemory >= 0.14;
          ty.isCoreDisrupted = (establishedCoreAtStepStart &&
            (structuralDamageSeverity >= 0.58 || (hollowScore >= 0.62 && structuralDamageSeverity >= 0.42))) ||
            terrainHollowCoreMemory >= 0.36;
          structuralDamagePenaltyFactor = clamp01(1.0 - 0.82 * structuralDamageSeverity);

          if (!wasDamaged && isStructureDamaged) {
            logs.push({
              id: `damage-start-${ty.id}-${currentSimHour}`,
              time: new Date(),
              simHour: currentSimHour,
              type: "danger",
              message: `⛰️ 核心结构受损：${ty.name} 的内核陆地覆盖约${Math.round(terrainCoreLandFraction * 100)}%，边界层摩擦不对称${Math.round(terrainFrictionAsymmetry * 100)}%，地形阻塞${Math.round(terrainBlockingMemory * 100)}%。损伤由实际内核地表采样连续积分，擦山会偏侧破坏，平原登陆也会留下摩擦性结构损伤。`
            });
          }
        }
      } else {
        // Once the whole inner core has cleared land/terrain, friction forcing stops immediately,
        // but the damaged vortex does not snap back. Warm ocean, humidity and low shear rebuild the
        // closed secondary circulation over many hours; the terrain scar decays even more slowly.
        terrainFrictionWork *= Math.exp(-stepFraction / 42.0);
        const hadDamageMemory = structuralDamageSeverity > 0.025 || coreRebuildScar > 0.025 || terrainFrictionWork > 0.08 ||
          terrainBlockingMemory > 0.04 || terrainHollowCoreMemory > 0.04;
        if (hadDamageMemory) {
          if (!metrics.isLand && sstVal >= 28.5) warmWaterHoursAfterSea += stepFraction;
          else warmWaterHoursAfterSea = Math.max(0, warmWaterHoursAfterSea - 0.45 * stepFraction);

          const recoveryRh = getRH700(newLat, newLon, config, currentSimHourFloat);
          const recoveryShear = getShear(newLat, newLon, config, currentSimHourFloat);
          const warmSupport = metrics.isLand ? 0.20 : clamp01((sstVal - 26.2) / 3.2);
          const ohcSupport = metrics.isLand ? 0.12 : clamp01(ohcValPre / 100.0);
          const humiditySupport = clamp01((recoveryRh - 50.0) / 30.0);
          const shearSupport = 1.0 - clamp01((recoveryShear - 8.0) / 22.0);
          const storedMoistureSupport = clamp01(ty.moistureReservoir ?? 0.90);
          const recoverySupport = clamp01(0.31 * warmSupport + 0.23 * ohcSupport + 0.19 * humiditySupport + 0.16 * shearSupport + 0.11 * storedMoistureSupport);
          const warmWaterBoost = smoothstep01((warmWaterHoursAfterSea - 2.0) / 10.0);
          let recoveryTau = Math.max(8.5, 31.0 - 13.0 * recoverySupport - 5.0 * warmWaterBoost + 9.0 * structuralDamageSeverity + 8.0 * coreRebuildScar);
          const manualRecoveryProgress = penaltyRecoveryActive ? clamp01(penaltyRecoveryElapsedHours / penaltyRecoveryTotalHours) : 0;
          const manualRecoveryAssist = penaltyRecoveryActive ? (0.35 + 0.65 * smoothstep01(manualRecoveryProgress)) : 0;
          if (penaltyRecoveryActive && ty.penaltyRecoveryTerrain) {
            recoveryTau *= metrics.isLand ? (0.72 - 0.18 * manualRecoveryAssist) : (0.52 - 0.16 * manualRecoveryAssist);
          }
          structuralDamageSeverity *= Math.exp(-stepFraction / Math.max(3.8, recoveryTau));
          const scarTauBase = damageOrigin === "shear_dry" ? 86.0 : damageOrigin === "ewrc_failure" ? 66.0 : damageOrigin === "terrain" ? 58.0 : 72.0;
          let scarTau = Math.max(32.0, scarTauBase - 18.0 * recoverySupport - 10.0 * warmWaterBoost);
          if (penaltyRecoveryActive) scarTau *= metrics.isLand ? (0.66 - 0.12 * manualRecoveryAssist) : (0.42 - 0.10 * manualRecoveryAssist);
          coreRebuildScar *= Math.exp(-stepFraction / Math.max(8.0, scarTau));

          // Ordinary warm-water recovery may heal drag/blocking damage, but it cannot silently
          // recreate the old eyewall after a diagnosed hollow-core mountain crossing.  Only the
          // explicit manual RI/ERI/URI core-rebuild sequence is permitted to remove this memory.
          if (penaltyRecoveryActive && ty.penaltyRecoveryTerrain && terrainHollowCoreMemory > 0) {
            // The manual rebuild is the only path allowed to erase a severe hollow-core scar,
            // but even an explicit intervention cannot close a coherent eyewall while the old
            // centre is still being forced across substantial land/high terrain. Hold the hollow
            // memory until the inner core has materially cleared the barrier, then rebuild it over
            // several hours rather than deleting it at the first offshore step.
            const terrainStillForcingCore = metrics.isLand || terrainCoreLandFraction > 0.085 ||
              terrainMountainFraction > 0.035 || terrainBlockingMemory > 0.22;
            if (!terrainStillForcingCore) {
              const hollowRepairProgress = smoothstep01(Math.max(0, manualRecoveryProgress - 0.08) / 0.92);
              const hollowRepairTau = Math.max(3.4, 8.2 - 4.0 * hollowRepairProgress);
              terrainHollowCoreMemory *= Math.exp(-stepFraction / hollowRepairTau);
            }
          }

          structuralDamagePenaltyFactor = clamp01(1.0 - 0.82 * structuralDamageSeverity);
          isStructureDamaged = (establishedCoreAtStepStart && (structuralDamageSeverity >= 0.18 || coreRebuildScar >= 0.34)) ||
            terrainHollowCoreMemory >= 0.12;
          ty.isCoreDisrupted = structuralDamageSeverity >= 0.56 || terrainHollowCoreMemory >= 0.34;

          if (!isStructureDamaged && structuralDamageSeverity < 0.050 && coreRebuildScar < 0.085 &&
              terrainFrictionWork < 0.08 && terrainHollowCoreMemory < 0.04) {
            const hadTerrainDamage = maxLandElevationPassed > 0 || structuralDamageHours > 0;
            structuralDamageSeverity = 0;
            structuralDamagePenaltyFactor = 1.0;
            ty.isCoreDisrupted = false;
            if (hadTerrainDamage) {
              logs.push({
                id: `damage-cleared-${ty.id}-${currentSimHour}`,
                time: new Date(),
                simHour: currentSimHour,
                type: "info",
                message: `🌀 中心重新整合：${ty.name} 的地表摩擦/地形阻塞损伤记忆已基本消退，低层环流与眼墙连续性恢复。`
              });
            }
            passedTaiwanCentral = false;
            passedLuzonMountains = false;
            maxLandElevationPassed = 0;
            structuralDamageHours = 0;
            terrainFrictionWork = 0;
            terrainBlockingMemory = 0;
            terrainFrictionAsymmetry = 0;
            coreRebuildScar = 0;
            damageOrigin = "none";
            terrainDamageMorphology = undefined;
            ewrcFailureMode = "none";
          }
        } else {
          structuralDamageHours = 0;
          warmWaterHoursAfterSea = 0;
          terrainFrictionWork = 0;
          isStructureDamaged = terrainHollowCoreMemory >= 0.12;
          structuralDamagePenaltyFactor = 1.0;
          ty.isCoreDisrupted = terrainHollowCoreMemory >= 0.34;
          if (terrainHollowCoreMemory >= 0.12) {
            damageOrigin = damageOrigin === "none" ? "terrain" : damageOrigin;
            terrainDamageMorphology = "hollow_bands";
          }
        }
      }

      if (penaltyRecoveryActive && penaltyRecoveryElapsedHours >= penaltyRecoveryTotalHours) {
        const terrainRebuildBlocked = !!ty.penaltyRecoveryTerrain && terrainHollowCoreMemory >= 0.04 &&
          (metrics.isLand || terrainCoreLandFraction > 0.055 || terrainMountainFraction > 0.025 || terrainBlockingMemory > 0.16);
        if (terrainRebuildBlocked) {
          // Keep the intervention in the rebuilding stage until the circulation has actually
          // cleared the terrain. This prevents a user-triggered burst from becoming a magic
          // shield against an ongoing mountain crossing.
          penaltyRecoveryElapsedHours = Math.max(0, penaltyRecoveryTotalHours - stepFraction);
          penaltyRecoveryStage = "rebuilding";
        } else {
          penaltyRecoveryActive = false;
          penaltyRecoveryStage = "rebuilding";
          coreRebuildScar = Math.min(coreRebuildScar, 0.065);
          structuralDamagePenaltyFactor = Math.max(structuralDamagePenaltyFactor, 0.975);
          structuralDamageHours = 0;
          terrainFrictionWork = 0;
          terrainBlockingMemory = 0;
          terrainFrictionAsymmetry = 0;
          terrainHollowCoreMemory = 0;
          terrainHollowCoreBearingDeg = 0;
          terrainCoreLandFraction = 0;
          terrainMountainFraction = 0;
          terrainMaxCoreElevation = 0;
          maxLandElevationPassed = 0;
          passedTaiwanCentral = false;
          passedLuzonMountains = false;
          damageOrigin = "none";
          terrainDamageMorphology = undefined;
          isStructureDamaged = false;
          ty.isCoreDisrupted = false;
          ty.isEyeClogged = false;
          logs.push({
            id: `penalty-recovery-complete-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "success",
            message: `🛡️ 惩罚恢复完成：${ty.name} 已完成干空气排出、涡旋重新对齐与内核重建；后续重新受到真实风切、干空气或山地作用时仍会再次受损。`
          });
        }
      }

      // D. Calculate Wind Radii (R7, R10, R12)
      // Operational analysis cadence: wind radii are published/recomputed only on the 3-hour
      // CMA/NMC public typhoon-path cycle (02/05/08/11/14/17/20/23 Beijing time). Landfall or intensity changes
      // between cycles do not silently create an unscheduled new wind-area analysis.
      let r7 = ty.r7;
      let r10 = ty.r10;
      let r12 = ty.r12;
      
      const isExactlyOnThreeHour = isThreeHourlySynopticTime(startDate, currentSimHourFloat);
      const needRecalcRadii = isExactlyOnThreeHour || !ty.r7 || !ty.r10 || !ty.r12;
      // Operational wind-area analyses update on the 3-hour cycle, but the vortex does not resize
      // instantaneously. Each analysis moves roughly half way toward the diagnosed target, so a
      // manual size change develops over successive 3-hour analyses instead of jumping in one frame.
      const transitionWindRadii = (previous: any, target: any, alpha = 0.52) => {
        const out: any = { ne: 0, se: 0, sw: 0, nw: 0 };
        for (const q of ["ne", "se", "sw", "nw"] as const) {
          const a = Math.max(0, Number(previous?.[q] ?? 0));
          const b = Math.max(0, Number(target?.[q] ?? 0));
          let v = a + (b - a) * alpha;
          if (b <= 0 && v < 12) v = 0;
          if (a <= 0 && b > 0) v = Math.max(10, b * alpha);
          out[q] = Math.max(0, Math.round(v));
        }
        return out;
      };

      if (needRecalcRadii) {
        let r10Boost = 0;
        let r12Boost = 0;
        if (ty.ewrcState === "recovering_success") {
          // Upon EWRC success, 10 and 12-level wind circles expand dynamically
          r10Boost = 0.08;
          r12Boost = 0.12;
        } else if (ty.rapidIntensifying) {
          r10Boost = 0.05;
          r12Boost = 0.08;
        }

        // Requirement 2: Structural damage mechanism no longer affects wind radii
        let structureDamageR7Scale = 1.0;
        let structureDamageR10R12Scale = 1.0;

        r7 = this.calculateWindRadii(newLat, newLon, ty.vmax, 1.0 * structureDamageR7Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false);
        
        // Global 85% adjustment for R10 and R12
        const globalScale1012 = 0.85;

        const shrink = (r: { ne: number; se: number; sw: number; nw: number }) => ({
          ne: Math.round(r.ne * 0.68),
          se: Math.round(r.se * 0.68),
          sw: Math.round(r.sw * 0.68),
          nw: Math.round(r.nw * 0.68)
        });

        const r10_raw = ty.vmax >= 24.5 ? shrink(this.calculateWindRadii(newLat, newLon, ty.vmax, Math.max(0.40, (0.65 + r10Boost) * 1.15) * globalScale1012 * structureDamageR10R12Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false)) : { ne: 0, se: 0, sw: 0, nw: 0 };
        r10 = { ne: Math.round(r10_raw.ne * 1.01 * 1.10), se: Math.round(r10_raw.se * 1.01 * 1.10), sw: Math.round(r10_raw.sw * 1.01 * 1.10), nw: Math.round(r10_raw.nw * 1.01 * 1.10) };
        const r12_raw = ty.vmax >= 32.7 ? shrink(this.calculateWindRadii(newLat, newLon, ty.vmax, Math.max(0.25, 0.42 + r12Boost) * globalScale1012 * structureDamageR10R12Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false)) : { ne: 0, se: 0, sw: 0, nw: 0 };
        r12 = { ne: Math.round(r12_raw.ne * 0.90 * 1.10), se: Math.round(r12_raw.se * 0.90 * 1.10), sw: Math.round(r12_raw.sw * 0.90 * 1.10), nw: Math.round(r12_raw.nw * 0.90 * 1.10) };

        // Enforce physical gap hierarchy across all 4 quadrants: 12级 < 10级 < 7级, and difference >= 25km
        const quadrants = ["ne", "se", "sw", "nw"] as const;
        for (const q of quadrants) {
          if (r10[q] > 0) {
            r10[q] = Math.min(r10[q], Math.max(15, r7[q] - 25));
          }
          if (r12[q] > 0) {
            const maxAllowedR12 = r10[q] > 0 ? (r10[q] - 25) : (r7[q] - 50);
            r12[q] = Math.min(r12[q], Math.max(15, maxAllowedR12));
          }
        }
        const priorLowLevelVortex = clamp01(ty.lowLevelVortexIntegrity ?? 0.56);
        const priorEnvelopeMemory = clamp01(ty.postPeakEnvelopeMemory ?? 0.10);
        const previousR7Mean = ty.r7 ? (ty.r7.ne + ty.r7.se + ty.r7.sw + ty.r7.nw) / 4 : 0;
        const targetR7Mean = (r7.ne + r7.se + r7.sw + r7.nw) / 4;
        // Outer gale winds have much more inertia than the eyewall.  During post-peak dry-air
        // erosion / landfall, retain the analysed R7 footprint over several synoptic cycles while
        // R10/R12 contract normally. This is a structural memory, not an artificial Vmax floor.
        const r7TransitionAlpha = exactCirculationTransitionAnalysis
          ? 1
          : targetR7Mean < previousR7Mean && priorLowLevelVortex > 0.42
            ? clamp01(0.18 + 0.24 * (1 - priorLowLevelVortex) + 0.10 * (1 - priorEnvelopeMemory))
            : 0.52;
        const manualSizeTransitionAlpha = exactCirculationTransitionAnalysis ? 1 : 0.52;
        r7 = transitionWindRadii(ty.r7, r7, r7TransitionAlpha);
        r10 = transitionWindRadii(ty.r10, r10, manualSizeTransitionAlpha);
        r12 = transitionWindRadii(ty.r12, r12, manualSizeTransitionAlpha);

        // A higher-force wind area cannot survive the three-hour interpolation after the
        // cyclone's *actual* maximum wind has fallen below that threshold.  Previously a
        // decaying r10/r12 memory left force-10 circles on force-8 storms and force-12 circles
        // on force-10/11 storms. Appearance/growth can still evolve on the 3-hour cycle;
        // physically impossible higher-force areas are removed immediately.
        if (ty.vmax < 13.9) r7 = { ne: 0, se: 0, sw: 0, nw: 0 };
        if (ty.vmax < 24.5) r10 = { ne: 0, se: 0, sw: 0, nw: 0 };
        if (ty.vmax < 32.7) r12 = { ne: 0, se: 0, sw: 0, nw: 0 };
      } else {
        // The last published 3-hour analysis must remain byte-for-byte stable.
        // Force eligibility is reconsidered at the next issue time, not after
        // every 10-minute intensity fluctuation or landfall substep.
        r7 = ty.r7 || { ne: 0, se: 0, sw: 0, nw: 0 };
        r10 = ty.r10 || { ne: 0, se: 0, sw: 0, nw: 0 };
        r12 = ty.r12 || { ne: 0, se: 0, sw: 0, nw: 0 };
      }

      const r7TouchesLand = checkWindCircleTouchLand(newLat, newLon, r7, config?.coastlineSource);
      const r10TouchesLand = checkWindCircleTouchLand(newLat, newLon, r10, config?.coastlineSource);

      if (metrics.isLand || r7TouchesLand) {
        landContactHours += stepFraction;
      } else {
        landContactHours = Math.max(0, landContactHours - stepFraction * 2.0);
      }

      if (r10TouchesLand) {
        r10LandContactHours += stepFraction;
      } else {
        r10LandContactHours = Math.max(0, r10LandContactHours - stepFraction * 2.0);
      }

      // Cold Water Upwelling & Spinning In Place Mechanism (冷水上翻与原地打转机制)
      let isSpinningInPlace = false;
      if (ty.history.length >= 6) {
        const recentPoints = ty.history.slice(-6);
        let maxDist = 0;
        const lastPt = recentPoints[recentPoints.length - 1];
        for (const pt of recentPoints) {
          const dLat = pt.lat - lastPt.lat;
          const dLon = (pt.lon - lastPt.lon) * Math.cos((lastPt.lat * Math.PI)/180);
          const dist = Math.sqrt(dLat*dLat + dLon*dLon);
          if (dist > maxDist) maxDist = dist;
        }
        // If moved less than 0.6 degrees (~66km) within 6 hours, it is spinning/looping in place
        if (maxDist < 0.6) {
          isSpinningInPlace = true;
        }
      }

      // Track upwelling hours
      let upwellingHours = ty.upwellingHours || 0;
      let consecutiveUpwellingHours = ty.consecutiveUpwellingHours || 0;
      let upwellingPersistentPenaltyHours = ty.upwellingPersistentPenaltyHours || 0;
      let currentCasualties = ty.casualties || 0;

      // Dynamic warning/preparedness state. Forecast lead improves actionable preparation, while
      // a sudden heading/speed change or an unforecast approach temporarily increases surprise.
      // These quantities affect casualty vulnerability; they do not alter the storm physics.
      const previousSixHour = findNearestHistoryStateByHour(ty.history, currentSimHourFloat - 6);
      const headingJump = previousSixHour ? angularDifferenceDeg(ty.direction, previousSixHour.direction ?? ty.direction) : 0;
      const speedJump = previousSixHour ? Math.abs(speedKmh - (previousSixHour.speed ?? speedKmh)) : 0;
      const motionSurprise = clamp01(Math.max((headingJump - 15) / 60, (speedJump - 7) / 22));

      let nextForecastLandfallLead = Infinity;
      const preparednessForecastPath = liveForecastMode === "off" ? [] : (ty.forecastPath || []);
      for (const fp of preparednessForecastPath) {
        if ((fp.simHour ?? 0) <= 0 || (fp.simHour ?? 0) > 72) continue;
        const fm = getLandMetrics(fp.lat, fp.lon, config?.coastlineSource);
        if (fm.isLand && !isMinorIslandOperationalIgnored(fp.lat, fp.lon)) {
          nextForecastLandfallLead = Math.min(nextForecastLandfallLead, fp.simHour);
        }
      }
      warningLeadHours = Number.isFinite(nextForecastLandfallLead) ? nextForecastLandfallLead : 0;
      const societalNow = getSocietalExposureProfile(newLat, newLon);
      const projectedThreat = Number.isFinite(nextForecastLandfallLead);
      if (projectedThreat) {
        // Warning and civil-defense latency consumes useful lead time before households actually
        // receive and act on the forecast. Lower-capacity profiles therefore prepare both later
        // and more slowly, matching the same profile used by station bulletins.
        const actionableLeadHours = Math.max(0, nextForecastLandfallLead - societalNow.responseDelayHours);
        const leadUtility = clamp01((actionableLeadHours - 3) / 45);
        const desiredPreparedness = clamp01(
          0.14 + 0.44 * societalNow.warningCapacity + 0.18 * societalNow.evacuationCapacity +
          0.12 * societalNow.responseCapacity + 0.18 * leadUtility
        );
        const prepTau = 18 - 7 * societalNow.warningCapacity +
          4.5 * (1 - societalNow.responseCapacity) + 0.55 * societalNow.responseDelayHours;
        preparednessIndex += (desiredPreparedness - preparednessIndex) * clamp01(stepFraction / Math.max(5, prepTau));
      } else {
        // Preparedness does not instantly vanish after a warning; it relaxes slowly.
        preparednessIndex += (0.18 - preparednessIndex) * clamp01(stepFraction / 48);
      }

      const unforecastActualThreat = (metrics.isLand || r7TouchesLand) && !projectedThreat;
      const surpriseTarget = clamp01(Math.max(motionSurprise, unforecastActualThreat ? 0.90 : 0));
      if (surpriseTarget > forecastSurpriseIndex) {
        forecastSurpriseIndex += (surpriseTarget - forecastSurpriseIndex) * clamp01(stepFraction / 2.2);
      } else {
        forecastSurpriseIndex *= Math.exp(-stepFraction / 18.0);
      }
      preparednessIndex = clamp01(preparednessIndex * (1.0 - 0.34 * forecastSurpriseIndex));
      let ewrcCooldownHours = ty.ewrcCooldownHours || 0;
      
      if (ewrcCooldownHours > 0) {
        ewrcCooldownHours = Math.max(0, ewrcCooldownHours - stepFraction);
      }

      if (upwellingPersistentPenaltyHours > 0) {
        upwellingPersistentPenaltyHours = Math.max(0, upwellingPersistentPenaltyHours - stepFraction);
      }

      const avgPositiveRadius = (quad?: { ne:number; se:number; sw:number; nw:number }) => {
        const vals = quad ? [quad.ne, quad.se, quad.sw, quad.nw].filter((v) => Number.isFinite(v) && v > 0) : [];
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      };
      const r10MeanKm = avgPositiveRadius(ty.r10 as any);
      const r12MeanKm = avgPositiveRadius(ty.r12 as any);
      const r7MeanKm = avgPositiveRadius(ty.r7 as any);
      const slowMotionFactor = clamp01((18.0 - speedKmh) / 18.0);
      const windMixingFactor = clamp01((ty.vmax - 18.0) / 38.0);
      const extremeWindFactor = clamp01((ty.vmax - 42.0) / 22.0);
      const innerWindFootprint = Math.max(Number(ty.rmw || 18) * 1.2, r12MeanKm || r10MeanKm || (r7MeanKm * 0.46));
      // Wind-driven mixing remains important, but translation controls residence time over the
      // same water column. A fast intense typhoon should not cool a deep warm pool as if it were
      // stationary for days. Deep OHC further buffers surface cooling without disabling mixing.
      // Residence over the same water column drops rapidly once the cyclone translates at a
      // normal 15-25 km/h pace. This prevents a healthy, moving major typhoon from manufacturing a
      // quasi-stationary cold wake beneath itself. Deep OHC strongly buffers the remaining mixing.
      const translationResidence = 0.06 + 0.94 * (1 - smoothstep01((speedKmh - 5.0) / 20.0));
      const deepOhcProtection = clamp01((ohcValPre - 25.0) / 80.0);
      const stirringFactor = translationResidence * (0.42 + 0.70 * windMixingFactor + 0.30 * extremeWindFactor) * Math.max(0.70, Math.min(1.50, 0.70 + innerWindFootprint / 105.0));
      const isUpwellingActive = !metrics.isLand && ty.vmax >= 24.0 &&
        (speedKmh < 18.5 || (ty.vmax >= 55.0 && speedKmh < 21.5)) && stirringFactor >= 0.20;
      if (isUpwellingActive) {
        // Effective residence over the same water column grows slowly for translating storms and
        // rapidly for stalled/looping storms. This prevents a 20-25 km/h open-ocean cyclone from
        // accumulating the same cold wake as a nearly stationary cyclone.
        const residenceAccumulation = translationResidence * Math.max(0.15, Math.min(1.8, 0.35 + 0.75 * stirringFactor));
        upwellingHours += stepFraction * residenceAccumulation;
        consecutiveUpwellingHours += stepFraction * translationResidence;
      } else {
        if (consecutiveUpwellingHours >= 18 && slowMotionFactor >= 0.45) {
          upwellingPersistentPenaltyHours = 30 + this.prng.nextRange(0, 10);
          logs.push({
            id: `upwelling-penalty-start-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "warning",
            message: `⚠️ 能量耗损：${ty.name} 此前长时间受冷水上翻影响，底层结构受损，其增强能力在未来约 30-40 小时内将被明显限制。`
          });
        }
        upwellingHours = Math.max(0, upwellingHours - stepFraction * 1.35);
        consecutiveUpwellingHours = 0;
      }

      let upwellingCooling = 0.0;
      let coldWaterDecay = 0.0;
      let upwellingStressFactor = 0.0;
      if (isUpwellingActive) {
        const slownessFactor = Math.pow(clamp01((16.0 - speedKmh) / 16.0), 0.82);
        const upwellingFactor = 1.0 + 0.30 * (r10MeanKm > 0 ? 1 : 0) + 0.22 * (r12MeanKm > 0 ? 1 : 0);
        const intensityFactor = Math.pow(Math.max(1.0, ty.vmax / 24.0), 1.25);
        const nonLinearTime = Math.pow(upwellingHours + 0.7, 1.08);
        const churningFactor = (0.48 + 0.38 * slownessFactor + 0.44 * windMixingFactor + 0.30 * extremeWindFactor) * upwellingFactor;
        const ohcCoolingEfficiency = 1.0 - 0.74 * deepOhcProtection;
        const upwellingCoolingRate = 0.032 * intensityFactor * churningFactor * config.airSeaCoupling * translationResidence * ohcCoolingEfficiency;
        const maxCooling = 0.55 + 2.40 * translationResidence * (1.0 - 0.58 * deepOhcProtection);
        upwellingCooling = Math.min(maxCooling, nonLinearTime * upwellingCoolingRate);
        const decayAccel = 1.0 + 0.30 * Math.pow(upwellingHours, 0.92);
        coldWaterDecay = upwellingCooling * 0.020 * decayAccel * (1.0 + 0.20 * slownessFactor + 0.15 * windMixingFactor);
        if (sstVal - upwellingCooling < 26.5) {
          const sstDeficit = 26.5 - (sstVal - upwellingCooling);
          coldWaterDecay += 0.016 * Math.pow(sstDeficit, 1.05);
        }
        const userAdjustment = Math.max(0.0, config.upwellingFactor !== undefined ? (1.0 + config.upwellingFactor / 100) : 1.0);
        coldWaterDecay *= userAdjustment;
        upwellingCooling *= userAdjustment;
        upwellingStressFactor = clamp01(upwellingCooling / 4.2 + windMixingFactor * 0.14 * translationResidence);
        sstVal = Math.max(13, sstVal - upwellingCooling);

        const isUpwellingSignificant = upwellingCooling >= 1.2;
        if (isUpwellingSignificant && !ty.upwellingLogged) {
          ty.upwellingLogged = true;
          logs.push({
            id: `upwelling-start-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "warning",
            message: `❄️ 冷水上翻：${ty.name} 中心附近极强风区持续搅动海水，表层海温骤降 ${upwellingCooling.toFixed(1)}℃ (降至 ${sstVal.toFixed(1)}℃)。移速 ${speedKmh.toFixed(1)} km/h、强度 ${ty.vmax.toFixed(1)} m/s，台风能量供应受阻，开始明显减弱。`
          });
        }
      }

      if ((!isUpwellingActive || upwellingCooling < 1.2) && ty.upwellingLogged) {
        ty.upwellingLogged = false;
        logs.push({
          id: `upwelling-end-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "success",
          message: `🌊 摆脱冷水区：${ty.name} 移速增加或离开原地打转区域，摆脱了自激发的冷水上翻，环境海温及发展势头有所回升。`
        });
      }

      // A user-forced cold-water patch is an absolute local SST boundary condition for its
      // requested duration. Natural upwelling may cool below it only after the event ends; while
      // active, the slider temperature is the value consumed by intensity/OHC physics.
      if (forcedColdWaterActive) sstVal = Math.max(0, Math.min(30, forcedColdWaterTemperature));
      const rawOhcAfterMixing = getOHC(newLat, newLon, config, sstVal, currentSimHourFloat);
      // Surface cooling does not instantaneously erase the whole warm-layer heat content. Preserve
      // most of the pre-mixing OHC and let the explicit cold-water stress represent the wake.
      const ohcVal = config.newEnvironmentPhysicsEnabled
        ? rawOhcAfterMixing
        : Math.max(rawOhcAfterMixing, ohcValPre * (1.0 - 0.12 * clamp01(upwellingCooling / 3.0)));
      const backgroundShearVal = getShear(newLat, newLon, config, currentSimHourFloat);
      const manualShearInfluence = getManualShearRegionInfluence(config, newLat, newLon);
      let shearVal = Math.max(backgroundShearVal, manualShearInfluence.shearKt);
      if (ty.forcedShear !== undefined) {
        const shearPulse = interventionPulse(ty.shearPenaltyHours, ty.shearPenaltyTotalHours);
        const coupling = 0.08 + 0.92 * shearPulse;
        shearVal = backgroundShearVal + (ty.forcedShear - backgroundShearVal) * coupling;
      }
      // Playground mode suppresses the ambient/background shear penalty, but an explicit
      // user-applied shear intervention remains authoritative. This lets the user deliberately
      // interrupt playground auto-ERI without changing the default "favorable ocean" behavior.
      if (playgroundMode && ty.forcedShear === undefined) shearVal = 0.0;
      // Nearby tropical vortices impose a genuine three-dimensional shear environment. Keep an
      // explicit manual shear intervention authoritative, otherwise add the diagnosed binary VWS
      // plus any decaying post-merger tilt retained during structural reorganization.
      if (!playgroundMode || ty.forcedShear !== undefined) {
        shearVal = Math.min(90, shearVal + binaryEffectiveShearKt);
      }

      let rhVal = getRH700(newLat, newLon, config, currentSimHourFloat);
      if (ty.forcedDryAir) {
        const dryPulse = interventionPulse(ty.dryAirPenaltyHours, ty.dryAirPenaltyTotalHours);
        const targetRh = ty.forcedDryAir === "core" ? 34.0 : 48.0;
        const intrusion = (ty.forcedDryAir === "core" ? 0.08 : 0.05) + dryPulse * (ty.forcedDryAir === "core" ? 0.82 : 0.65);
        rhVal = Math.max(22.0, rhVal - Math.max(0, rhVal - targetRh) * intrusion);
      }

      // "Cancel all penalties" follows a finite recovery envelope: moist convection flushes the
      // residual low-entropy air first, while vortex realignment to low effective shear is slower.
      const penaltyRecoveryProgress = penaltyRecoveryActive ? clamp01(penaltyRecoveryElapsedHours / penaltyRecoveryTotalHours) : 0;
      const dryPurgeBlend = penaltyRecoveryActive && ty.penaltyRecoveryDryAir
        ? smoothstep01(penaltyRecoveryElapsedHours / Math.max(2.5, Math.min(7.0, penaltyRecoveryTotalHours * 0.32)))
        : 0;
      const shearRealignBlend = penaltyRecoveryActive && ty.penaltyRecoveryShear
        ? smoothstep01(Math.max(0, penaltyRecoveryElapsedHours - 1.5) / Math.max(4.0, Math.min(10.0, penaltyRecoveryTotalHours * 0.42)))
        : 0;
      if (dryPurgeBlend > 0) rhVal += (82.0 - rhVal) * 0.88 * dryPurgeBlend;
      if (shearRealignBlend > 0 && !playgroundMode) shearVal += (4.5 - shearVal) * 0.92 * shearRealignBlend;
      const environmentDryAirStrength = effectiveDryAirStrength(newLat, newLon, config, currentSimHourFloat, rhVal);

      // Persistent environmental ventilation / cold-water memory. NOAA/AOML guidance and
      // observational work support treating cold wakes, dry-air ventilation and shear as processes
      // that first suppress convection and exhaust stored moist entropy, not as instantaneous switches.
      const coldWaterStress = metrics.isLand ? 0 : clamp01(Math.max(
        (26.5 - sstVal) / 3.4,
        upwellingCooling / 2.5,
        consecutiveUpwellingHours / 18.0
      ));
      // 2.6.3: entering the mid-latitude westerlies is a transition, not an on/off convective
      // kill switch.  Ventilation increases over a broad latitude band and the moist vortex has
      // several hours of inertia before its deep convection becomes strongly sheared.
      const westerlyDepth = effectiveWesterlyDepth(newLat, newLon, config, currentSimHourFloat);
      const westerlyRegimeActive = config.newEnvironmentPhysicsEnabled
        ? westerlyDepth > 0.14
        : !!config.westerliesEnabled;
      const westerlyStress = clamp01(
        smoothstep01(westerlyDepth) * (0.30 + 0.50 * clamp01((shearVal - 10.0) / 24.0))
      );
      const priorEtTransition = clamp01(ty.extrTransition ?? 0);
      // Landfall also creates a moisture-source asymmetry: air parcels circulating over land lose
      // direct oceanic moisture/enthalpy supply, so the land-side inflow can act as a low-entropy
      // tongue even when the free-tropospheric RH field itself is not exceptionally dry.
      const landMoistureSourceLoss = clamp01(
        coreSurfaceInteraction.landFraction *
        // Land removes the direct surface moisture source immediately, but the *air mass* inside a
        // large tropical vortex does not dry on the same clock.  Let the land-side entropy deficit
        // build over roughly half a day instead of saturating in only a few hours; otherwise the dry
        // intrusion subsystem quietly cancels the longer reservoir lifetime below.
        (0.18 + 0.82 * smoothstep01(Math.max(0, landHours) / 24.0)) *
        (0.42 + 0.58 * (1 - clamp01(ty.moistureReservoir ?? 0.96)))
      );
      const naturalDryTarget = clamp01(
        0.52 * clamp01((58.0 - rhVal) / 26.0) +
        0.38 * clamp01((shearVal - 12.0) / 22.0) +
        0.22 * landMoistureSourceLoss
      );
      const forcedDryTarget = ty.forcedDryAir === "core" ? 1.0 : ty.forcedDryAir === "periphery" ? 0.62 : 0;
      const dryTarget = Math.max(naturalDryTarget, forcedDryTarget);
      const dryTau = dryTarget > dryAirIntrusion ? 5.5 : (sstVal >= 27.0 && rhVal >= 62 && shearVal <= 13 ? 15.0 : 28.0);
      dryAirIntrusion += (dryTarget - dryAirIntrusion) * clamp01(stepFraction / dryTau);
      dryAirIntrusion = clamp01(dryAirIntrusion);

      // Two-stage dry-air ventilation model. "dryAirIntrusion" describes the environment/outer
      // vortex. "dryAirCoreExposure" only rises after ventilation overcomes the moist inner envelope.
      // This reproduces the observed sequence: dry slot wraps around a still-intact eye -> one or
      // more eyewall sectors erode -> ragged/leaf-like core -> later a much smaller loose core may
      // rebuild while the broad outer circulation remains.
      const preMoistureReservoir = clamp01(ty.moistureReservoir ?? 0.96);
      const previousEyewallIntegrity = clamp01(ty.eyewallIntegrity ?? (ty.vmax >= 32.7 ? 0.66 : 0.30));
      const previousInnerCoreMoisture = clamp01(ty.innerCoreMoisture ?? innerCoreMoisture);
      const meanR7DryLifecycle = ty.r7
        ? Math.max(0, (ty.r7.ne + ty.r7.se + ty.r7.sw + ty.r7.nw) / 4)
        : 0;
      const dryEnvelopeSizeGate = clamp01((meanR7DryLifecycle - 120) / 360);
      const coreVentilation = clamp01(
        0.62 * clamp01((shearVal - 9.0) / 20.0) +
        0.38 * clamp01((57.0 - rhVal) / 27.0)
      );

      // 3.3.14: ventilation is not just "dry RH". Following the Tang-Emanuel framework, the
      // damaging pathway requires BOTH a mid-level entropy deficit and a transport mechanism
      // (normally vertical shear). Warm deep water and a moist, vigorous inner core buffer the
      // intrusion by rapidly restoring boundary-layer entropy. This is a normalized proxy rather
      // than a claim to calculate full thermodynamic entropy from the simplified environment.
      const midlevelEntropyDeficitProxy = clamp01((64.0 - rhVal) / 36.0);
      const shearTransportProxy = clamp01((shearVal - 5.0) / 25.0);
      const thermodynamicRechargeProxy = clamp01(
        0.34 * clamp01((sstVal - 25.5) / 4.0) +
        0.26 * clamp01(ohcVal / 120.0) +
        0.22 * preMoistureReservoir +
        0.18 * outflowEfficiency
      );
      let ventilationIndexTarget = clamp01(
        (0.12 + 0.88 * shearTransportProxy) *
        midlevelEntropyDeficitProxy *
        (1.16 - 0.42 * thermodynamicRechargeProxy)
      );
      if (ty.forcedDryAir === "core") ventilationIndexTarget = Math.max(ventilationIndexTarget, 0.88);
      else if (ty.forcedDryAir === "periphery") ventilationIndexTarget = Math.max(ventilationIndexTarget, 0.48);
      dryAirVentilationIndex += (ventilationIndexTarget - dryAirVentilationIndex) *
        (1 - Math.exp(-stepFraction / (ventilationIndexTarget > dryAirVentilationIndex ? 3.8 : 11.5)));
      dryAirVentilationIndex = clamp01(dryAirVentilationIndex);

      // Environmental dryness first wraps cyclonically around the rainband/moist-envelope
      // barrier. Organized rainbands are not merely decoration: their moist ascent can partly
      // shield the core from ambient dry air, so a broad mature vortex may remain protected until
      // that barrier is eroded. This protection is continuous, not a named-storm exception.
      const rainbandMoistureShield = clamp01(
        moistEnvelopeIntegrity * (0.54 + 0.46 * rainbandDominance) *
        (0.58 + 0.42 * preMoistureReservoir)
      );
      const dryWrapTarget = clamp01(
        dryAirIntrusion *
        (0.36 + 0.42 * coreVentilation + 0.12 * clamp01((shearVal - 12.0) / 22.0) + 0.10 * dryEnvelopeSizeGate) *
        (0.86 + 0.14 * clamp01(ty.circulationExpansion ?? 0)) *
        (1 - 0.20 * rainbandMoistureShield)
      );
      dryAirWrapFraction += (dryWrapTarget - dryAirWrapFraction) *
        (1 - Math.exp(-stepFraction / (dryWrapTarget > dryAirWrapFraction ? 6.5 : 19.0)));
      dryAirWrapFraction = clamp01(dryAirWrapFraction);

      let moistEnvelopeTarget = clamp01(
        0.10 + 0.27 * preMoistureReservoir + 0.18 * rainbandDominance +
        0.16 * broadMoisturePlatform + 0.15 * dryEnvelopeSizeGate +
        0.12 * previousEyewallIntegrity + 0.08 * outflowEfficiency -
        0.38 * dryAirWrapFraction * coreVentilation -
        0.12 * clamp01((shearVal - 18.0) / 18.0)
      );
      if (metrics.isLand) {
        // Inland moisture persistence: the deep humid envelope survives much longer than the
        // surface wind core. Plains/basins with a broad residual circulation can keep advecting
        // marine/monsoonal vapour for one to several days, so do not collapse the envelope during
        // the first 12-24 h inland. Terrain/dry-air terms below can still destroy it rapidly when
        // there is an actual physical driver.
        moistEnvelopeTarget *= clamp01(0.998 - 0.0014 * Math.min(96, landHours));
      }
      const envelopeTau = moistEnvelopeTarget < moistEnvelopeIntegrity
        ? (metrics.isLand ? (36.0 + 16.0 * dryEnvelopeSizeGate) : (8.0 + 7.0 * dryEnvelopeSizeGate))
        : (15.0 + 8.0 * dryAirWrapFraction);
      moistEnvelopeIntegrity += (moistEnvelopeTarget - moistEnvelopeIntegrity) *
        (1 - Math.exp(-stepFraction / envelopeTau));
      moistEnvelopeIntegrity = clamp01(moistEnvelopeIntegrity);

      let coreProtectionTarget = clamp01(
        0.08 + 0.23 * previousEyewallIntegrity + 0.18 * coreCompactness +
        0.18 * preMoistureReservoir + 0.18 * moistEnvelopeIntegrity +
        0.12 * previousInnerCoreMoisture + 0.07 * outflowEfficiency -
        0.12 * coreVentilation - 0.08 * dryAirIntrusion -
        0.14 * dryAirWrapFraction * coreVentilation
      );
      if (ty.forcedDryAir === "core") coreProtectionTarget *= 0.46;
      else if (ty.forcedDryAir === "periphery") coreProtectionTarget = Math.max(coreProtectionTarget, 0.60);
      moistCoreProtection += (coreProtectionTarget - moistCoreProtection) *
        clamp01(stepFraction / (coreProtectionTarget < moistCoreProtection ? 6.5 : 11.5));
      moistCoreProtection = clamp01(moistCoreProtection);

      // Breaching has a threshold/hysteresis character. A coherent wrapped dry slot can coexist
      // with a clear eye until the moist envelope and protected inner-core humidity both give way.
      const envelopeBreachGate = smoothstep01(clamp01((dryAirWrapFraction - 0.24) / 0.60)) *
        smoothstep01(clamp01((0.72 - moistEnvelopeIntegrity) / 0.58));

      // 3.3.14 distinguishes "dry air exists nearby" from "the dry tongue is dynamically connected
      // to the eyewall". A continuous connection requires a wrapped slot, shear-assisted ventilation
      // and a sufficiently eroded moist envelope. This lets an inner core temporarily isolate and
      // re-moisten itself even while dry air is still obvious elsewhere in the circulation.
      let coreConnectionTarget = clamp01(
        dryAirWrapFraction *
        (0.16 + 0.84 * dryAirVentilationIndex) *
        (0.12 + 0.88 * envelopeBreachGate) *
        (0.72 + 0.28 * eyewallOpenSectorFraction) *
        (1 - 0.18 * rainbandMoistureShield) +
        0.14 * landMoistureSourceLoss * (0.35 + 0.65 * terrainCoreLandFraction)
      );
      if (ty.forcedDryAir === "core") coreConnectionTarget = Math.max(coreConnectionTarget, 0.92);
      else if (ty.forcedDryAir === "periphery") coreConnectionTarget = Math.min(coreConnectionTarget, 0.36);
      dryAirCoreConnection += (coreConnectionTarget - dryAirCoreConnection) *
        (1 - Math.exp(-stepFraction / (coreConnectionTarget > dryAirCoreConnection ? 3.6 : 8.5)));
      dryAirCoreConnection = clamp01(dryAirCoreConnection);

      // A cyclone does not literally "pump dry air out". Over warm ocean it can instead isolate the
      // dry tongue, recharge low-entropy boundary-layer air with surface enthalpy fluxes, and fire
      // repeated moist-side convective bursts that re-saturate portions of the inner core. This
      // recovery can fail if the environmental dry tongue stays connected under persistent shear.
      const warmOceanRechargeGate = metrics.isLand ? 0 : clamp01(
        0.34 * clamp01((sstVal - 26.2) / 3.0) +
        0.26 * clamp01(ohcVal / 105.0) +
        0.22 * preMoistureReservoir +
        0.18 * lowLevelVortexIntegrity
      );
      let reMoisteningTarget = clamp01(
        warmOceanRechargeGate *
        (0.26 + 0.26 * moistCoreProtection + 0.18 * outflowEfficiency +
         0.16 * previousInnerCoreMoisture + 0.14 * convectiveBurstIndex) *
        (1.0 - 0.78 * dryAirCoreConnection) *
        clamp01((0.16 + dryAirCoreExposure + 0.30 * dryAirWrapFraction) / 0.90)
      );
      if (dryAirVentilationIndex > 0.72) reMoisteningTarget *= 0.62;
      if (ty.forcedDryAir) reMoisteningTarget *= ty.forcedDryAir === "core" ? 0.10 : 0.48;
      dryAirReMoistening += (reMoisteningTarget - dryAirReMoistening) *
        (1 - Math.exp(-stepFraction / (reMoisteningTarget > dryAirReMoistening ? 3.2 : 5.5)));
      dryAirReMoistening = clamp01(dryAirReMoistening);

      let coreDryTarget = dryAirIntrusion *
        (0.06 + 0.60 * coreVentilation + 0.30 * dryAirVentilationIndex) *
        (0.10 + 0.66 * envelopeBreachGate + 0.24 * dryAirCoreConnection) *
        (1.0 - 0.72 * moistCoreProtection);
      // Successful isolation/re-moistening lowers core exposure, but cannot erase a still-connected
      // dry tongue in one step. This permits the observed "attempt to recover -> re-erode" cycles.
      coreDryTarget -= 0.46 * dryAirReMoistening * (1.0 - 0.70 * dryAirCoreConnection);
      if (ty.forcedDryAir === "core") coreDryTarget = Math.max(coreDryTarget, 0.90);
      if (ty.forcedDryAir === "periphery") coreDryTarget = Math.min(coreDryTarget, 0.28);
      if (dryAirWrapFraction > 0.72 && dryAirVentilationIndex > 0.58 && moistEnvelopeIntegrity < 0.40) {
        coreDryTarget = Math.max(coreDryTarget, 0.48 + 0.32 * dryAirVentilationIndex);
      }
      coreDryTarget = clamp01(coreDryTarget);
      const previousDryCoreExposure = dryAirCoreExposure;
      const coreDryTau = coreDryTarget > dryAirCoreExposure
        ? 4.6
        : Math.max(6.5, 13.5 - 6.0 * dryAirReMoistening);
      dryAirCoreExposure += (coreDryTarget - dryAirCoreExposure) *
        (1 - Math.exp(-stepFraction / coreDryTau));
      dryAirCoreExposure = clamp01(dryAirCoreExposure);

      // Evaporation of heavy eyewall rain into a ventilated/dry layer can create a shallow,
      // low-entropy cold pool just beneath/outside the eyewall. Its outer edge becomes a
      // convergence focus for an inner rainband while the original eyewall inflow is partly
      // starved. Keep this as a memory state so the response can outlive a single convective
      // burst rather than behaving like an instantaneous visual effect.
      const coldPoolGenerationTarget = clamp01(
        dryAirCoreExposure *
        (0.18 + 0.82 * dryAirVentilationIndex) *
        (0.30 + 0.42 * previousEyewallIntegrity + 0.28 * convectiveBurstIndex) *
        (0.54 + 0.46 * Math.max(rainbandDominance, deepConvectiveCoverage))
      );
      const coldPoolRecoveryRelief = clamp01(
        dryAirReMoistening * (1 - 0.72 * dryAirCoreConnection) *
        (0.45 + 0.55 * thermodynamicRechargeProxy)
      );
      const coldPoolTarget = clamp01(coldPoolGenerationTarget * (1 - 0.56 * coldPoolRecoveryRelief));
      eyewallColdPoolMemory += (coldPoolTarget - eyewallColdPoolMemory) *
        (1 - Math.exp(-stepFraction / (coldPoolTarget > eyewallColdPoolMemory ? 2.8 : 7.5)));
      eyewallColdPoolMemory = clamp01(eyewallColdPoolMemory);

      const innerCoreMoistureTarget = clamp01(
        preMoistureReservoir *
        (0.24 + 0.46 * moistEnvelopeIntegrity + 0.30 * moistCoreProtection) *
        (1.0 - 0.82 * dryAirCoreExposure) *
        (1.0 - 0.14 * westerlyStress) *
        (metrics.isLand ? clamp01(0.998 - 0.0023 * Math.min(84, landHours)) : 1.0) +
        0.22 * dryAirReMoistening * (1.0 - 0.64 * dryAirCoreConnection)
      );
      innerCoreMoisture += (innerCoreMoistureTarget - innerCoreMoisture) *
        (1 - Math.exp(-stepFraction / (innerCoreMoistureTarget < innerCoreMoisture
          ? (metrics.isLand ? 28.0 : 6.8)
          : Math.max(6.2, 13.5 - 5.0 * dryAirReMoistening))));
      innerCoreMoisture = clamp01(innerCoreMoisture);

      const openSectorTarget = clamp01(
        0.02 + 0.58 * dryAirCoreExposure +
        0.18 * dryAirWrapFraction * (1.0 - moistEnvelopeIntegrity) +
        0.18 * dryAirCoreConnection +
        0.11 * eyewallColdPoolMemory +
        0.18 * clamp01((shearVal - 12.0) / 22.0) +
        0.10 * priorEtTransition -
        0.24 * dryAirReMoistening * (1.0 - 0.55 * dryAirCoreConnection) +
        // Terrain friction opens the eyewall continuously: one-sided land/sea roughness mainly
        // creates an open/displaced sector, while broad mountain blocking can break a larger arc.
        0.30 * terrainFrictionAsymmetry * (0.35 + 0.65 * terrainCoreLandFraction) +
        0.34 * terrainBlockingMemory +
        0.18 * clamp01(1.0 - structuralDamagePenaltyFactor) -
        0.38 * previousEyewallIntegrity - 0.12 * innerCoreMoisture
      );
      eyewallOpenSectorFraction += (openSectorTarget - eyewallOpenSectorFraction) *
        (1 - Math.exp(-stepFraction / (openSectorTarget > eyewallOpenSectorFraction ? 3.4 : 10.5)));
      eyewallOpenSectorFraction = clamp01(eyewallOpenSectorFraction);

      const dryCoreExposureTendency = dryAirCoreExposure - previousDryCoreExposure;
      const activeDryRecovery = dryAirReMoistening > 0.30 && dryCoreExposureTendency <= 0.002 &&
        dryAirCoreConnection < 0.62 && !metrics.isLand;
      if (dryAirCoreExposure >= 0.28 && !activeDryRecovery) {
        dryErosionHours += stepFraction;
        dryRecoveryHours = Math.max(0, dryRecoveryHours - 0.45 * stepFraction);
      } else {
        dryErosionHours = Math.max(0, dryErosionHours - stepFraction * (activeDryRecovery ? 0.34 : 0.20));
        if (activeDryRecovery || postDryAirBurstSuppressionHours > 0 || (ty.dryAirCoreExposure ?? 0) > 0.34) {
          dryRecoveryHours += stepFraction * (activeDryRecovery ? 1.0 : 0.55);
        } else {
          dryRecoveryHours = Math.max(0, dryRecoveryHours - stepFraction * 0.35);
        }
      }

      // Keep one slowly evolving dry-slot bearing so enhanced-IR scenes do not jump sectors every
      // 10 minutes. While the environmental tongue remains connected to the core, its bearing is
      // anchored to the ventilating/shear side. Once isolated, the remnant dry pocket is advected
      // cyclonically around the vortex while moist-side bursts work on its trailing edge.
      let environmentalSlotTargetDeg = (((ty.shearDir ?? ty.direction ?? 0) + 145 +
        12 * Math.sin((currentSimHourFloat + index * 3.1) * Math.PI / 18)) % 360 + 360) % 360;
      if (terrainCoreLandFraction > 0.08) {
        // When a substantial part of the inflow traverses land, the land-side low-entropy inflow
        // competes with the free-tropospheric shear ventilation direction.
        const landDryBearing = ((terrainInteractionBearingDeg % 360) + 360) % 360;
        const landDryBlend = clamp01(0.65 * terrainCoreLandFraction + 0.35 * landMoistureSourceLoss);
        const landDryDelta = ((landDryBearing - environmentalSlotTargetDeg + 540) % 360) - 180;
        environmentalSlotTargetDeg = (environmentalSlotTargetDeg + landDryDelta * landDryBlend + 360) % 360;
      }
      const slotConnectionWeight = clamp01(0.16 + 0.84 * dryAirCoreConnection);
      const slotDelta = ((environmentalSlotTargetDeg - drySlotBearingDeg + 540) % 360) - 180;
      const cycloneRotationSign = newLat >= 0 ? -1 : 1;
      drySlotBearingDeg = (
        drySlotBearingDeg +
        slotDelta * clamp01(stepFraction / (5.5 + 5.5 * (1 - slotConnectionWeight))) * slotConnectionWeight +
        cycloneRotationSign * (3.0 + 6.5 * dryAirReMoistening) * (1 - slotConnectionWeight) * stepFraction
      );
      drySlotBearingDeg = ((drySlotBearingDeg % 360) + 360) % 360;

      // Dominant cold-cloud / convective arc. During ventilation it sits on the moist side opposite
      // the dry tongue. Near landfall, a strong frictional asymmetry can rotate that preferred arc
      // toward the offshore/moist convergence sector. The bearing changes continuously rather than
      // jumping between hard-coded quadrants.
      let convectiveArcTargetDeg = (drySlotBearingDeg + 172 +
        16 * clamp01((shearVal - 8.0) / 24.0) * cycloneRotationSign) % 360;
      if (terrainCoreLandFraction > 0.10 && terrainFrictionAsymmetry > 0.14) {
        const terrainMoistSide = (terrainInteractionBearingDeg + 165) % 360;
        const terrainBlend = clamp01(
          terrainCoreLandFraction * (0.35 + 0.65 * terrainFrictionAsymmetry) +
          0.30 * terrainBlockingMemory
        );
        const arcDelta = ((terrainMoistSide - convectiveArcTargetDeg + 540) % 360) - 180;
        convectiveArcTargetDeg += arcDelta * terrainBlend;
      }
      const convectiveArcDelta = ((convectiveArcTargetDeg - dryAirConvectiveArcBearingDeg + 540) % 360) - 180;
      dryAirConvectiveArcBearingDeg = (
        dryAirConvectiveArcBearingDeg + convectiveArcDelta * clamp01(stepFraction / 4.8)
      );
      dryAirConvectiveArcBearingDeg = ((dryAirConvectiveArcBearingDeg % 360) + 360) % 360;

      if (dryAirCoreExposure > 0.38 && dryErosionHours > 1.5) postDryAirBurstSuppressionHours = Math.max(postDryAirBurstSuppressionHours, 36.0);
      else postDryAirBurstSuppressionHours = Math.max(0, postDryAirBurstSuppressionHours - stepFraction);
      // Westerly interaction ventilates the vortex, but inherited tropical moisture is not
      // exhausted as quickly as the compact eyewall. Keep a longer thermodynamic memory so
      // 25-100 mm/24 h rain shields can survive well into recurvature/ET.
      const environmentalReservoirStress = clamp01(Math.max(coldWaterStress, 0.50 * westerlyStress, 0.70 * dryAirIntrusion + 0.22 * dryAirCoreExposure));
      if (coldWaterStress > 0.12) coldWaterExposureHours += stepFraction;
      else coldWaterExposureHours = Math.max(0, coldWaterExposureHours - stepFraction * 0.6);

      // Column moisture / ocean-enthalpy reservoir. Once the center moves inland the direct
      // beneath-center ocean source is lost, but a broad intact circulation may retain a limited
      // offshore marine moisture link through the still-oceanic inflow sectors. Returning the
      // center to warm ocean recharges the reservoir gradually rather than instantly.
      let moistureReservoir = clamp01(ty.moistureReservoir ?? 0.96);
      let marineMoistureLink = clamp01(ty.marineMoistureLink ?? 0);
      const moistureFootprintRadius = Math.max(170, Math.min(540, meanR7DryLifecycle > 0 ? meanR7DryLifecycle * 1.05 : 240));
      const moistureFootprintLandFraction = getLandCoverage(newLat, newLon, moistureFootprintRadius, config?.coastlineSource);
      const moistureFootprintSeaOverlap = clamp01(1 - moistureFootprintLandFraction);
      const centrePlainnessForMarineLink = clamp01(
        1 - Math.max(terrainMountainFraction * 1.15, terrainBlockingMemory, clamp01((terrainMaxCoreElevation - 500) / 1200))
      );
      const broadMarineFetchGate = clamp01((meanR7DryLifecycle - 150) / 300);
      const marineLinkTarget = metrics.isLand
        ? clamp01(
            moistureFootprintSeaOverlap * (0.30 + 0.70 * broadMarineFetchGate) *
            (0.32 + 0.68 * lowLevelVortexIntegrity) * centrePlainnessForMarineLink *
            (0.64 + 0.36 * moistEnvelopeIntegrity)
          )
        : 0;
      const marineLinkTau = marineLinkTarget > marineMoistureLink ? 2.8 : (metrics.isLand ? 13.0 : 3.5);
      marineMoistureLink += (marineLinkTarget - marineMoistureLink) * (1 - Math.exp(-stepFraction / marineLinkTau));
      marineMoistureLink = clamp01(marineMoistureLink);
      if (metrics.isLand) {
        // Separate wind-core decay from column-moisture decay. Surface flux loss and roughness can
        // weaken Vmax rapidly, while a large/humid vortex continues importing and recycling water
        // vapour over plains and hills. A landfalling cyclone carries a deep precipitable-water
        // column inland and may keep receiving low-level environmental/monsoonal moisture even
        // after direct ocean surface fluxes underneath the centre are gone. Do not consume that
        // reservoir on the same timescale as the surface wind core.
        const broadLandMoistureMemory = clamp01(
          0.30 * broadMoisturePlatform +
          0.22 * clamp01(postPeakEnvelopeMemory) +
          0.22 * clamp01((rhVal - 52.0) / 36.0) +
          0.26 * clamp01((meanR7DryLifecycle - 150.0) / 360.0)
        );
        const environmentalLandMoistureSupport = clamp01(
          0.46 * clamp01((rhVal - 48.0) / 38.0) +
          0.22 * broadMoisturePlatform +
          0.16 * clamp01(postPeakEnvelopeMemory) +
          0.16 * clamp01((meanR7DryLifecycle - 120.0) / 390.0) +
          0.20 * marineMoistureLink
        );
        const convectiveConsumption = clamp01((ty.vmax - 28.0) / 42.0);
        // Further inland-moisture persistence tuning: typical low-relief/humid e-folding is now
        // roughly 75-115 h. Strong convection still consumes the reservoir faster, while dry air,
        // terrain breakup and weakening circulation reduce the support terms organically. This
        // avoids the common failure mode where heavy rain is confined to the shoreline despite a
        // broad, still-coherent tropical moisture plume moving inland.
        const depletionTau = Math.max(94.0,
          112.0 + 44.0 * broadLandMoistureMemory + 30.0 * environmentalLandMoistureSupport -
          3.0 * convectiveConsumption
        );
        // Environmental inflow supplies a higher but still state-dependent soft floor. It is not a
        // permanent source: the floor falls automatically as RH, circulation size and post-peak
        // envelope memory deteriorate.
        const advectedLandReservoirFloor = clamp01(
          0.30 + 0.38 * environmentalLandMoistureSupport + 0.24 * broadLandMoistureMemory +
          0.18 * marineMoistureLink
        );
        if (moistureReservoir > advectedLandReservoirFloor) {
          moistureReservoir = advectedLandReservoirFloor +
            (moistureReservoir - advectedLandReservoirFloor) * Math.exp(-stepFraction / depletionTau);
        } else if (environmentalLandMoistureSupport > 0.48) {
          moistureReservoir += (advectedLandReservoirFloor - moistureReservoir) *
            clamp01(stepFraction / 44.0);
        }
      } else {
        const marineSupply = clamp01(
          0.36 + 0.34 * clamp01((sstVal - 25.5) / 4.0) + 0.18 * clamp01(ohcVal / 110.0) + 0.12 * clamp01((rhVal - 50.0) / 35.0)
        );
        if (environmentalReservoirStress > 0.10) {
          // Cold water / westerlies / dry ventilation consume the pre-existing moist-entropy store.
          // The reservoir provides several hours of inertia before full environmental weakening appears.
          // Cold water primarily shuts down the *recharge* first. The pre-existing moist-entropy
          // column then drains over a multi-day thermodynamic timescale; this avoids an abrupt
          // intensity collapse when the centre first crosses the 26-27 C isotherm.
          const depletionTau = Math.max(44.0, 96.0 - 40.0 * environmentalReservoirStress);
          moistureReservoir *= Math.exp(-stepFraction / depletionTau);
          if (environmentalReservoirStress < 0.28 && marineSupply > moistureReservoir) {
            moistureReservoir += (marineSupply - moistureReservoir) * clamp01(stepFraction / 54.0);
          }
        } else {
          const rechargeAlpha = clamp01(stepFraction / 10.0);
          moistureReservoir += (marineSupply - moistureReservoir) * rechargeAlpha;
        }
      }
      moistureReservoir = clamp01(moistureReservoir);
      const reserveExhaustion = smoothstep01((0.78 - moistureReservoir) / 0.62);
      const coldExposureMaturity = smoothstep01((coldWaterExposureHours - 6.0) / 36.0);
      // Effective cold-water suppression follows the requested physical sequence: supply decreases ->
      // stored moisture is consumed -> convective bursts become less frequent -> the core degrades.
      const effectiveColdWaterStress = coldWaterStress * clamp01(
        0.035 + 0.20 * coldExposureMaturity + 0.48 * reserveExhaustion
      );

      // Peak-envelope and low-level-vortex memory.  The OTT lifecycle sequence shows that an
      // intense oceanic cyclone can lose its compact CDO/eyewall while retaining a very broad,
      // coherent low-level vortex and one or two vigorous feeder bands for another day or more.
      // This state is intentionally decoupled from Vmax and warm-core/eye quality.
      peakVmaxMemory = Math.max(peakVmaxMemory, ty.vmax);
      const peakIntensityMemoryGate = clamp01((peakVmaxMemory - 30.0) / 32.0);
      const peakSizeMemoryGate = clamp01((meanR7DryLifecycle - 180.0) / 300.0);
      const nearPeakFraction = peakVmaxMemory > 0 ? clamp01(ty.vmax / peakVmaxMemory) : 0;
      const envelopeBuildTarget = clamp01(
        0.08 + 0.44 * peakIntensityMemoryGate + 0.26 * peakSizeMemoryGate +
        0.16 * clamp01(ty.circulationExpansion ?? 0) + 0.12 * broadMoisturePlatform
      );
      if (!metrics.isLand && nearPeakFraction >= 0.72) {
        postPeakEnvelopeMemory += (envelopeBuildTarget - postPeakEnvelopeMemory) *
          (1 - Math.exp(-stepFraction / 8.0));
      } else {
        const residualEnvelopeTarget = clamp01(
          0.10 + 0.28 * peakSizeMemoryGate + 0.18 * clamp01(ty.circulationExpansion ?? 0) +
          0.10 * broadMoisturePlatform
        );
        const envelopeDecayTau = 50.0 + 28.0 * peakSizeMemoryGate + 18.0 * clamp01(ty.circulationExpansion ?? 0);
        postPeakEnvelopeMemory += (residualEnvelopeTarget - postPeakEnvelopeMemory) *
          (1 - Math.exp(-stepFraction / envelopeDecayTau));
      }
      postPeakEnvelopeMemory = clamp01(postPeakEnvelopeMemory);

      const lowLevelTerrainStress = metrics.isLand
        ? clamp01(Math.max(0, metrics.elevation - 350) / 1650.0)
        : 0;
      const lowLevelVortexTarget = clamp01(
        0.12 + 0.22 * clamp01((ty.vmax - 10.0) / 24.0) +
        0.26 * peakSizeMemoryGate + 0.20 * postPeakEnvelopeMemory +
        0.14 * clamp01(ty.circulationExpansion ?? 0) + 0.10 * moistureReservoir -
        0.22 * lowLevelTerrainStress - 0.08 * priorEtTransition
      );
      const lowLevelTau = lowLevelVortexTarget < lowLevelVortexIntegrity
        ? (32.0 + 32.0 * peakSizeMemoryGate)
        : 10.0;
      lowLevelVortexIntegrity += (lowLevelVortexTarget - lowLevelVortexIntegrity) *
        (1 - Math.exp(-stepFraction / lowLevelTau));
      lowLevelVortexIntegrity = clamp01(lowLevelVortexIntegrity);

      // 3.3.2 westerly-transition rainfall memory. Observed ET does not simply switch tropical
      // convection off: the compact core weakens first, while poleward/slantwise ascent and a
      // warm-frontal cloud shield can stay productive for roughly a day or longer. Carry a
      // moisture/organization memory independently from Vmax so strong rain fades moderately,
      // while <=100 mm/24 h rain survives substantially longer.
      const meanR7ForWesterlies = ty.r7
        ? Math.max(0, (ty.r7.ne + ty.r7.se + ty.r7.sw + ty.r7.nw) / 4)
        : 0;
      const westerlySizeMemoryGate = clamp01((meanR7ForWesterlies - 180) / 300);
      const westerlyEntrySignal = clamp01(Math.max(
        westerlyStress,
        config.newEnvironmentPhysicsEnabled
          ? 0.78 * effectiveWesterlyDepth(newLat, newLon, config, ty.simHour + stepFraction)
          : (config.westerliesEnabled ? 0.78 * clamp01((newLat - ((config.westerliesLat ?? 30) - 2.8)) / 8.5) : 0)
      ));
      if (westerlyEntrySignal > 0.08) {
        const wasNewInteraction = westerlyInteractionHours < 0.35;
        westerlyInteractionHours = Math.min(96, westerlyInteractionHours + stepFraction * (0.55 + 0.70 * westerlyEntrySignal));
        const inheritedRainPotential = clamp01(
          0.20 + 0.34 * moistureReservoir + 0.17 * broadMoisturePlatform +
          0.13 * westerlySizeMemoryGate + 0.16 * clamp01((ty.vmax - 17.2) / 38.0)
        );
        if (wasNewInteraction) westerlyRainMemory = Math.max(westerlyRainMemory, inheritedRainPotential);
        const matureRainMemoryTarget = clamp01(
          0.12 + 0.38 * moistureReservoir + 0.16 * broadMoisturePlatform +
          0.15 * westerlySizeMemoryGate + 0.12 * clamp01((rhVal - 50) / 35) +
          0.07 * clamp01((ty.vmax - 17.2) / 36)
        );
        const rainMemoryTau = matureRainMemoryTarget >= westerlyRainMemory
          ? 5.5
          : (24 + 18 * westerlySizeMemoryGate + 8 * broadMoisturePlatform);
        westerlyRainMemory += (matureRainMemoryTarget - westerlyRainMemory) *
          (1 - Math.exp(-stepFraction / rainMemoryTau));

        // The northeast tail should not appear as an instant geometric append. It spins up over
        // several hours after the storm meets the baroclinic zone, then decays slowly as a
        // stratiform/warm-conveyor-belt remnant even after deep convection weakens.
        const tailSpinup = smoothstep01(clamp01((westerlyInteractionHours - 1.5) / 10.0));
        const tailTarget = clamp01(
          tailSpinup * westerlyEntrySignal *
          (0.38 + 0.25 * moistureReservoir + 0.16 * westerlySizeMemoryGate +
           0.13 * broadMoisturePlatform + 0.08 * clamp01((shearVal - 12) / 20))
        );
        const tailTau = tailTarget >= northeastCloudTailStrength ? 5.5 : (19 + 11 * westerlySizeMemoryGate);
        northeastCloudTailStrength += (tailTarget - northeastCloudTailStrength) *
          (1 - Math.exp(-stepFraction / tailTau));
      } else {
        westerlyInteractionHours = Math.max(0, westerlyInteractionHours - 0.35 * stepFraction);
        westerlyRainMemory *= Math.exp(-stepFraction / 36.0);
        northeastCloudTailStrength *= Math.exp(-stepFraction / 24.0);
      }
      westerlyRainMemory = clamp01(westerlyRainMemory);
      northeastCloudTailStrength = clamp01(northeastCloudTailStrength);

      // Explicit baroclinic-cloud morphology. The WCB/frontal tail and the stripping of the old
      // tropical canopy are separate prognostic quantities so ET can evolve continuously instead
      // of replacing one cloud texture with another in a single frame.
      const wcbTarget = clamp01(
        westerlyEntrySignal * (0.30 + 0.38 * westerlyRainMemory + 0.18 * moistureReservoir +
          0.14 * clamp01((shearVal - 10) / 22)) *
        smoothstep01(clamp01((westerlyInteractionHours + 1.0) / 9.0))
      );
      warmConveyorBeltStrength += (wcbTarget - warmConveyorBeltStrength) *
        (1 - Math.exp(-stepFraction / (wcbTarget > warmConveyorBeltStrength ? 5.5 : 24.0)));
      warmConveyorBeltStrength = clamp01(warmConveyorBeltStrength);

      const strippingTarget = clamp01(
        westerlyStress * (0.34 + 0.42 * clamp01((shearVal - 14) / 20) + 0.24 * priorEtTransition) *
        (0.72 + 0.28 * (1 - coreCompactness))
      );
      northeastCloudStripping += (strippingTarget - northeastCloudStripping) *
        (1 - Math.exp(-stepFraction / (strippingTarget > northeastCloudStripping ? 4.0 : 18.0)));
      northeastCloudStripping = clamp01(northeastCloudStripping);

      const llccExposureTarget = clamp01(
        0.48 * clamp01((shearVal - 16.0) / 18.0) +
        0.32 * (1 - deepConvectiveCoverage) + 0.20 * structuralDisorganization -
        0.24 * coreCompactness - 0.12 * clamp01((ty.vmax - 34.0) / 30.0)
      );
      llccExposure += (llccExposureTarget - llccExposure) *
        (1 - Math.exp(-stepFraction / (llccExposureTarget > llccExposure ? 3.5 : 10.0)));
      llccExposure = clamp01(llccExposure);

      // Use the previously integrated outer-eyewall amplitude here. The current-step eye-model
      // value is diagnosed later, so referencing it here would create a temporal-dead-zone and,
      // more importantly, would break structural continuity across sub-hour steps.
      const priorSecondaryEyewall = clamp01(ty.secondaryEyewallStrength ?? 0);
      const standoffTarget = ewrcFailureMode === "inner_collapse_outer_stalls"
        ? clamp01(0.54 + 0.36 * coreRebuildScar + 0.18 * priorSecondaryEyewall)
        : (ewrcFailureMode === "double_eyewall_decay" ? clamp01(0.32 + 0.42 * coreRebuildScar) :
          ((ewrcState === "forming" || ewrcState === "max_decay") && priorSecondaryEyewall > 0.45 ? 0.42 * priorSecondaryEyewall : 0));
      ewrcStandoffStrength += (standoffTarget - ewrcStandoffStrength) *
        (1 - Math.exp(-stepFraction / (standoffTarget > ewrcStandoffStrength ? 3.5 : 30.0)));
      ewrcStandoffStrength = clamp01(ewrcStandoffStrength);

      const giantEyeTarget = ewrcFailureMode === "inner_collapse_outer_stalls"
        ? clamp01((ewrcStandoffStrength - 0.32) / 0.52) *
          clamp01(0.54 + 0.30 * (ty.circulationExpansion ?? 0) + 0.22 * rainbandDominance)
        : 0;
      giantEyeOuterWallMemory += (giantEyeTarget - giantEyeOuterWallMemory) *
        (1 - Math.exp(-stepFraction / (giantEyeTarget > giantEyeOuterWallMemory ? 6.0 : 54.0)));
      giantEyeOuterWallMemory = clamp01(giantEyeOuterWallMemory);

      const outerBandTarget = metrics.isLand
        ? clamp01((0.18 + 0.52 * rainbandDominance + 0.26 * moistureReservoir + 0.18 * postPeakEnvelopeMemory) *
            smoothstep01(clamp01((landHours + 0.5) / 6.0)) * (1 - 0.45 * terrainBlockingMemory))
        : 0;
      landfallOuterRainbandIndex += (outerBandTarget - landfallOuterRainbandIndex) *
        (1 - Math.exp(-stepFraction / (outerBandTarget > landfallOuterRainbandIndex ? 3.0 : 13.0)));
      landfallOuterRainbandIndex = clamp01(landfallOuterRainbandIndex);

      const physicalGeometryDriver = clamp01(Math.max(
        terrainBlockingMemory, terrainHollowCoreMemory, dryAirCoreExposure * 0.80,
        ewrcStandoffStrength * 0.88, westerlyStress * 0.58, structuralDisorganization * 0.70
      ));
      const continuityTarget = clamp01(0.96 - 0.52 * physicalGeometryDriver);
      coreGeometryContinuity += (continuityTarget - coreGeometryContinuity) *
        (1 - Math.exp(-stepFraction / (continuityTarget < coreGeometryContinuity ? 5.0 : 14.0)));
      coreGeometryContinuity = clamp01(coreGeometryContinuity);

      const recoveryDryStrength = environmentDryAirStrength * (1.0 - 0.95 * dryPurgeBlend);
      const atmosphericStress = getAtmosphericStress(
        ty.vmax, sstVal, ohcVal, rhVal, shearVal, speedKmh, recoveryDryStrength
      );
      convectiveSuppression = clamp01(
        0.54 * effectiveColdWaterStress + 0.24 * westerlyStress +
        // Peripheral dryness mostly suppresses future growth. The large deep-convective penalty
        // is reserved for a genuinely connected/ventilated dry tongue and actual core exposure.
        0.14 * dryAirIntrusion + 0.32 * dryAirCoreExposure +
        0.16 * dryAirCoreConnection + 0.16 * dryAirVentilationIndex +
        0.20 * atmosphericStress.ventilation + 0.16 * clamp01((shearVal - 14.0) / 20.0) -
        0.08 * dryAirReMoistening * (1 - 0.65 * dryAirCoreConnection) -
        // Retained moist entropy only offsets the westerly part of the suppression; it cannot
        // erase a genuine dry-core or cold-water penalty.
        0.10 * westerlyRainMemory * westerlyEntrySignal * (1 - 0.70 * dryAirCoreExposure)
      );
      const disorganizationTarget = clamp01(
        // Replace the old center-on-land timer with sampled inner-core roughness/blocking. A flat
        // mainland crossing becomes progressively disorganized through friction; a mountain graze
        // can produce large asymmetry even while the geometric center remains offshore.
        0.34 * coreSurfaceInteraction.frictionIndex +
        0.44 * terrainBlockingMemory +
        0.28 * terrainFrictionAsymmetry * (0.30 + 0.70 * terrainCoreLandFraction) +
        0.22 * clamp01(1.0 - structuralDamagePenaltyFactor) +
        0.08 * dryAirIntrusion + 0.42 * dryAirCoreExposure +
        0.18 * dryAirCoreConnection + 0.12 * dryAirVentilationIndex +
        0.06 * eyewallColdPoolMemory -
        0.08 * dryAirReMoistening * (1 - 0.60 * dryAirCoreConnection) +
        0.15 * westerlyStress + 0.20 * atmosphericStress.ventilation
      );
      structuralDisorganization += (disorganizationTarget - structuralDisorganization) *
        clamp01(stepFraction / (disorganizationTarget > structuralDisorganization ? 4.5 : 18.0));
      structuralDisorganization = clamp01(structuralDisorganization);

      // Deep-convective *coverage* is different from peak burst intensity. Dry-air attack normally
      // changes a symmetric CDO into a lopsided collection of very cold towers before those towers
      // disappear altogether. Retaining this separate state prevents an unrealistic binary
      // "perfect CDO -> no convection" transition and drives cloud/rainfall morphology.
      const deepCoverageIntensityGate = clamp01((ty.vmax - 13.9) / 38.0);
      let deepCoverageTarget = clamp01(
        0.08 + 0.30 * deepCoverageIntensityGate + 0.26 * innerCoreMoisture +
        0.15 * previousEyewallIntegrity + 0.10 * convectiveBurstIndex +
        // Re-moistening first restores one or two vigorous arcs, not a full symmetric CDO.
        // Keep the global-coverage boost modest; the azimuthal renderers use the dedicated
        // convective-arc bearing to place the bursts on the surviving moist side.
        0.08 * dryAirReMoistening +
        0.12 * rainbandDominance - 0.36 * convectiveSuppression -
        0.22 * eyewallOpenSectorFraction - 0.10 * structuralDisorganization -
        0.05 * dryAirCoreConnection - 0.05 * eyewallColdPoolMemory -
        // Near a coastline, deep convection can stay vigorous but its *azimuthal coverage* normally
        // becomes less uniform before landfall. This preserves hot towers without allowing a
        // perfectly filled circular CDO to spin up against the shoreline.
        coastalCoreInfluence * (0.08 + 0.10 * rainbandDominance + 0.08 * broadMoisturePlatform)
      );
      // The simulator's default intensity is Dvorak-derived. Therefore a 15/16/17-force system
      // cannot visually degrade into a weak-TD cloud field merely because shear/westerlies are
      // present. The floor preserves enough cold-cloud/deep-convective area for the analysed
      // intensity while still allowing strong azimuthal asymmetry, stripping and frontalization.
      if (ty.vmax >= 32.7 && terrainHollowCoreMemory < 0.55) {
        let dvorakIntensityFloor = clamp01(
          0.24 + 0.34 * clamp01((ty.vmax - 32.7) / 28.0) -
          0.12 * priorEtTransition - 0.08 * terrainBlockingMemory
        );
        // 3.7.5: Dvorak/IR intensity does not require a matching low-level precipitation area.
        // When dry air is physically connected to the core, allow deep-cloud coverage to collapse
        // even while Vmax/IR presentation retains memory of the previously intense cyclone.
        const ventilationCoverageRetention = clamp01(
          1 - 0.52 * dryAirCoreExposure - 0.30 * dryAirCoreConnection -
          0.18 * eyewallOpenSectorFraction + 0.28 * dryAirReMoistening
        );
        dvorakIntensityFloor *= 0.18 + 0.82 * ventilationCoverageRetention;
        deepCoverageTarget = Math.max(deepCoverageTarget, dvorakIntensityFloor);
      }
      const deepCoverageTau = deepCoverageTarget < deepConvectiveCoverage
        ? (3.8 + 4.8 * innerCoreMoisture)
        : (6.0 + 5.0 * coreRebuildScar);
      deepConvectiveCoverage += (deepCoverageTarget - deepConvectiveCoverage) *
        (1 - Math.exp(-stepFraction / deepCoverageTau));
      deepConvectiveCoverage = clamp01(deepConvectiveCoverage);

      // Dry-air lifecycle classifier. The phase is deliberately based on envelope/core states, not
      // latitude or a named storm, so the same sequence can emerge in any cyclone with comparable
      // ventilation: wrapped outer slot -> single-sector eyewall breach -> asymmetric collapse ->
      // broad residual vortex -> intermittent small-core reorganization if moisture returns.
      const warmSeaRecoveryGate = !metrics.isLand && sstVal >= 27.0 && rhVal >= 58 && shearVal <= 19;
      const dryRecoveryAttempt = warmSeaRecoveryGate && dryAirReMoistening >= 0.30 &&
        dryAirCoreConnection < 0.64 && dryCoreExposureTendency <= 0.004 && dryRecoveryHours >= 0.6;
      if (dryRecoveryAttempt && dryAirCoreExposure < 0.50) {
        // Recovery can begin before the core is fully moist again. Satellite imagery commonly
        // shows repeated hot-tower arcs nibbling into a dry slot while the eyewall is still open.
        dryAirLifecyclePhase = "reorganizing";
      } else if (dryAirCoreExposure < 0.10 && dryAirWrapFraction < 0.24 && moistEnvelopeIntegrity > 0.58) {
        dryAirLifecyclePhase = dryRecoveryHours > 1.0 && coreRebuildScar > 0.16 ? "reorganizing" : "moist_protected";
      } else if (dryAirCoreExposure < 0.22 && dryAirWrapFraction >= 0.22) {
        dryAirLifecyclePhase = "outer_wrap";
      } else if (dryAirCoreExposure < 0.48 && eyewallOpenSectorFraction < 0.58 && deepConvectiveCoverage > 0.28) {
        dryAirLifecyclePhase = "eyewall_breach";
      } else if (dryAirCoreExposure >= 0.42 && deepConvectiveCoverage >= 0.16) {
        dryAirLifecyclePhase = "asymmetric_collapse";
      } else if (lowLevelVortexIntegrity > 0.50 && deepConvectiveCoverage < 0.18 && ty.vmax < 25.0) {
        dryAirLifecyclePhase = "residual_vortex";
      }

      // Pre-TC squall-line episode: evaluate once while an organized, moist cyclone is
      // approaching a coastline. Observational climatology over China finds these in only a
      // minority of landfalling TCs and with lifetimes of only a few hours. A failed draw is
      // persisted too, preventing a new line from appearing every 10-minute step.
      if (!preStormSquallEvaluated && !metrics.isLand && ty.vmax >= 19.5) {
        const coastDistanceKm = getDistanceToLand(newLat, newLon, config?.coastlineSource, true) * 111.12;
        const previousCoastDistanceKm = landCheck.isLand
          ? 0
          : getDistanceToLand(ty.lat, ty.lon, config?.coastlineSource, true) * 111.12;
        const approachingCoast = coastDistanceKm < previousCoastDistanceKm + 2.0;
        const inFormationWindow = coastDistanceKm >= 70 && coastDistanceKm <= 520 &&
          (approachingCoast || coastDistanceKm <= 260);
        if (inFormationWindow) {
          preStormSquallEvaluated = true;
          const moistureSupport = clamp01((moistureReservoir - 0.42) / 0.48);
          const shearSupport = clamp01((shearVal - 5.0) / 18.0) * (1.0 - 0.55 * clamp01((shearVal - 24.0) / 14.0));
          const occurrenceProbability = clamp01(0.31 + 0.14 * moistureSupport + 0.06 * shearSupport);
          if (this.prng.next() < occurrenceProbability) {
            preStormSquallStartHour = currentSimHourFloat;
            preStormSquallDurationHours = 3.2 + 1.7 * this.prng.next();
            preStormSquallBearingOffsetDeg = 24 + 24 * this.prng.next();
            preStormSquallSpeedKmh = 40 + 16 * this.prng.next();
          }
        }
      }
      // Once the centre itself has reached land, no new *pre*-TC line may be generated.
      if (metrics.isLand && !preStormSquallEvaluated) preStormSquallEvaluated = true;

      // Natural shear/dry-air ventilation leaves a structural memory even after instantaneous
      // humidity/shear improve. It is strongest when a tilted vortex actually ventilates low-entropy
      // air into the core, not from dry air or shear in isolation.
      const ventilationScarTarget = clamp01(
        0.58 * atmosphericStress.ventilation +
        0.22 * clamp01((shearVal - 16.0) / 18.0) +
        0.20 * clamp01((55.0 - rhVal) / 25.0)
      );
      if (!playgroundMode && establishedCoreAtStepStart && ventilationScarTarget > 0.42) {
        const scarGainTau = 10.0 - 5.0 * clamp01((ventilationScarTarget - 0.30) / 0.70);
        coreRebuildScar += Math.max(0, ventilationScarTarget - coreRebuildScar) * clamp01(stepFraction / scarGainTau);
        damageOrigin = damageOrigin === "none" || damageOrigin === "shear_dry" ? "shear_dry" : "mixed";
        if (ventilationScarTarget > 0.78 && dryAirCoreExposure > 0.44 && atmosphericStress.ventilation > 0.66) {
          isStructureDamaged = true;
          structuralDamagePenaltyFactor = Math.min(structuralDamagePenaltyFactor, 0.92 - 0.24 * ventilationScarTarget);
        }
      }

      // Environment rating score (-1 to 1)
      let sstScore = 0;
      if (sstVal >= 26.5) {
        sstScore = Math.max(-1.0, Math.min(1.0, (sstVal - 26.5) / 2.0));
      } else {
        // Cold water weakens typhoon more severely
        sstScore = Math.max(-1.5, (sstVal - 26.5) / 1.5);
      }
      const ohcScore = Math.max(0.0, Math.min(1.0, ohcVal / 100.0));
      const rhScore = Math.max(-1.0, Math.min(1.0, (rhVal - 50.0) / 35.0));
      
      // Non-linear realistic regime-based vertical wind shear penalty (Requirement 7)
      let shearPenalty = 0.0;
      if (shearVal > 10.0) {
        shearPenalty = Math.min(1.5, Math.pow((shearVal - 10.0) / 16.0, 1.4));
      }

      // Low Peak Intensity Limit Factor & Adverse Climate Multiplier (Requirement 3)
      const configuredPeakLimit = isAnyIntensityReferenceActive(config) ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 95;
      let lowPeakFactor = 1.0;
      let adverseClimateMultiplier = 1.0;
      if (isAnyIntensityReferenceActive(config) && configuredPeakLimit < 70) {
        lowPeakFactor = Math.max(0.25, configuredPeakLimit / 70.0);
        adverseClimateMultiplier = 1.0 / lowPeakFactor;
      }

      // Requirement 9: Smarter peak intensity setting mechanism (Ambition Factor)
      let ambitionFactor = 1.0;
      if (isTargetIntensityCapActive(config) && config.maxIntensityLimit && config.maxIntensityLimit > 50) {
        ambitionFactor = Math.max(1.0, config.maxIntensityLimit / 50.0);
        // Reduce moderate shear penalty
        if (shearVal < 15.0) {
          shearPenalty /= (ambitionFactor * 1.5);
        }
      }

      // Enhance shear penalty if peak limit is low (Requirement 3)
      shearPenalty *= adverseClimateMultiplier;
      
      // Calculate land fraction/elevation penalty
      let landPenalty = 0.0;
      let terrainPenalty = 0.0;
      if (metrics.isLand) {
        landPenalty = 0.90 * adverseClimateMultiplier; // Increased land penalty for low peak limit
        if (config.terrainDecayEnabled && metrics.elevation > 0) {
          let elevationScale = 4800.0; // Slightly reduced scale for slightly stronger elevation decay
          let terrainMulti = 0.55 * adverseClimateMultiplier; // Increased
          // Luzon mountain decay bonus: still far below Taiwan's abrupt orographic penalty,
          // but stronger than v1.4 so Sierra Madre/Cordillera crossings measurably accelerate weakening.
          if (newLat >= 12 && newLat <= 19 && newLon >= 119 && newLon <= 123) {
            elevationScale = 11800.0;
            terrainMulti = 0.048 * adverseClimateMultiplier;
          }
          // Substantially weaken Hainan mountain decay bonus (Hainan: 18-20.5N, 108.5-111.5E)
          if (newLat >= 18 && newLat <= 20.5 && newLon >= 108.5 && newLon <= 111.5) {
            elevationScale = 19000.0;
            terrainMulti = 0.0035 * adverseClimateMultiplier;
          }
          // Substantially weaken Taiwan mountain decay bonus (Taiwan: 21.5-25.5N, 119.5-122.5E)
          if (newLat >= 21.5 && newLat <= 25.5 && newLon >= 119.5 && newLon <= 122.5) {
            elevationScale = 3650.0;
            terrainMulti = 0.50 * adverseClimateMultiplier; 
          }
          
          terrainPenalty = (metrics.elevation / elevationScale) * terrainMulti; 
          // Guard against infinity/NaN in terrain calculation
          if (isNaN(terrainPenalty) || !isFinite(terrainPenalty)) terrainPenalty = 0;
        }
      }

      // Outflow channel rating (based on altitude / latitude). Upper-level exhaust is treated
      // separately from moisture: a very moist cyclone can rain prodigiously while remaining
      // broad/loose if mass evacuation aloft is inefficient.
      let outflowScore = 0.35;
      if (newLat > 12 && newLat < 28) outflowScore += 0.25; // optimal outflow channel region
      outflowScore *= config.outflowScale;
      const shearOutflowLoss = 0.34 * clamp01((shearVal - 12.0) / 22.0);
      const outflowTarget = clamp01((outflowScore - 0.10) / 0.62 - shearOutflowLoss);
      outflowEfficiency += (outflowTarget - outflowEfficiency) * clamp01(stepFraction / (outflowTarget < outflowEfficiency ? 3.0 : 7.0));
      const moistColumn = clamp01((rhVal - 58.0) / 24.0) * clamp01(0.35 + 0.65 * moistureReservoir);
      const poorExhaust = clamp01((0.66 - outflowEfficiency) / 0.52);
      const broadPlatformTarget = clamp01(moistColumn * poorExhaust * (0.62 + 0.38 * clamp01(ohcVal / 95.0)));
      broadMoisturePlatform += (broadPlatformTarget - broadMoisturePlatform) * clamp01(stepFraction / (broadPlatformTarget > broadMoisturePlatform ? 6.0 : 13.0));

      // Aggregated favorable environmental rating
      let favScore = (0.35 * sstScore) + (0.18 * ohcScore) + (0.17 * rhScore) + (0.12 * outflowScore);
      favScore -= (0.35 * shearPenalty);
      
      // Dry air core intrusion mechanism (50% impact for normal intact core)
      let dryAirPenalty = 0;
      if (environmentDryAirStrength > 0) {
        dryAirPenalty = environmentDryAirStrength * 0.24 * adverseClimateMultiplier;
        if (penaltyRecoveryActive && ty.penaltyRecoveryDryAir) dryAirPenalty *= 1.0 - 0.92 * dryPurgeBlend;
        if (!ty.isStructureDamaged || ty.vmax >= 35.0) {
          dryAirPenalty *= 0.82; // Background dry air mainly suppresses growth until it is ventilated into the core
        }
        if (isTargetIntensityCapActive(config) && environmentDryAirStrength < 1.2) {
          dryAirPenalty /= (ambitionFactor * 1.2);
        }
        favScore -= dryAirPenalty;
      }

      // Manual Dry Air, Wind Shear and Rapid Intensification overrides are handled in the unified Master Controller at the end of the physics step.
      
      // Decays
      if (config.landDecayEnabled) {
        favScore -= landPenalty + terrainPenalty;
      }
      
      if (westerlyDepth > 0.22) {
        favScore -= 0.4 * adverseClimateMultiplier * smoothstep01(westerlyDepth); // dynamic mid-latitude interaction penalty
      }

      // Current intensity velocity delta (m/s change per hour)
      // --- NEW PHYSICALLY-BASED INTENSITY ENGINE ---
      
      // Sync parameters for Cloud Rendering (Requirement 4)
      ty.shear = shearVal;
      // Diagnose the deep-layer shear vector from the same environmental steering fields used by
      // the simulator. Rainfall/cloud asymmetry can then respond to a meteorological shear direction
      // instead of the old fixed ``track + 135°`` visual placeholder.
      const env850ForShear = getEnvironmentalWind(850, newLat, newLon, config, currentSimHourFloat);
      const env200ForShear = getEnvironmentalWind(200, newLat, newLon, config, currentSimHourFloat);
      const shearU = env200ForShear.u - env850ForShear.u;
      const shearV = env200ForShear.v - env850ForShear.v;
      const diagnosedShearVector = Math.hypot(shearU, shearV);
      ty.shearDir = diagnosedShearVector > 0.35
        ? ((Math.atan2(shearU, shearV) * 180 / Math.PI) + 360) % 360
        : (ty.direction + 135) % 360;
      ty.upwellingIntensity = Math.min(1.0, upwellingCooling / 5.0);

      // Determine structuralState (Requirement 4)
      if (ty.vmax < 17.2 && !ty.landed) {
        ty.structuralState = 1; // Tropical Disturbance
      } else if (ty.isStructureDamaged) {
        ty.structuralState = 7; // Center Structure Damaged
      } else if (ty.landed) {
        ty.structuralState = 6; // Landfall Weakening
      } else if (ty.ewrcState === "recovering_failure") {
        ty.structuralState = 5; // Failed ERC
      } else if (ty.ewrcState !== "none" && ty.ewrcState !== "completed") {
        ty.structuralState = 4; // Normal ERC
      } else if (upwellingCooling > 1.2) {
        ty.structuralState = 3; // Cold water upwelling suppression
      } else {
        ty.structuralState = 2; // Normal Strengthening
      }

      // 1. Calculate Maximum Potential Intensity (MPI) based on SST and OHC
      // Warm water supports higher maximum intensity.
      const sstFactor = Math.max(0, sstVal - 15);
      let baseMPI = 16.0 + 3.6 * Math.pow(sstFactor, 1.22) * (1.0 + ohcVal / 180.0); 
      
      // Numerical safety guard for baseMPI
      if (isNaN(baseMPI) || !isFinite(baseMPI)) baseMPI = 60.0;
      
      // 2. Adjust potential based on vertical wind shear, humidity (RH), and outflow channels
      // Non-linear realistic regime-based vertical wind shear MPI reduction (Requirement 7)
      let shearReduction = 0;
      if (shearVal < 10.0) {
        shearReduction = 0.02 * (shearVal / 10.0);
      } else if (shearVal < 20.0) {
        const frac = (shearVal - 10.0) / 10.0;
        shearReduction = 0.02 + 0.23 * Math.pow(frac, 1.5);
      } else if (shearVal < 32.0) {
        const frac = (shearVal - 20.0) / 12.0;
        shearReduction = 0.25 + 0.40 * Math.pow(frac, 1.2);
      } else {
        const excess = Math.min(20.0, shearVal - 32.0);
        shearReduction = 0.65 + 0.20 * (excess / 20.0);
      }
      // Moderate shear or peripheral dry air should first reduce development efficiency rather than
      // forcing every weak storm into rapid weakening. Inner-core ventilation is handled separately.
      shearReduction *= (0.60 + 0.40 * atmosphericStress.intensity) * (1.0 - 0.20 * (1.0 - atmosphericStress.intensity) * atmosphericStress.oceanSupport);
      const rhPenalty = atmosphericStress.dryDeficit * (0.30 + 0.50 * atmosphericStress.intensity);
      const rhFactor = Math.max(0.50, 1.0 - 0.52 * rhPenalty);
      const outflowFactor = Math.max(0.65, Math.min(1.35, outflowScore * 2.2)); // outflow channel boosts it
      
      let environmentalMPI = baseMPI * (1.0 - shearReduction) * rhFactor * outflowFactor;
      if (!playgroundMode && broadMoisturePlatform > 0.16) {
        // Moist but poorly ventilated storms preferentially grow a broad circulation/rain shield.
        // They can still strengthen, but peak-wind conversion becomes inefficient and a soft
        // thermodynamic/structural ceiling appears well below the warm-ocean MPI.
        const broadVortexCeiling = 43.0 + 27.0 * outflowEfficiency + 8.0 * (1.0 - broadMoisturePlatform) + 4.0 * clamp01((sstVal - 28.0) / 2.5);
        const ceilingBlend = smoothstep01((broadMoisturePlatform - 0.16) / 0.54);
        environmentalMPI = environmentalMPI * (1.0 - 0.36 * ceilingBlend) + Math.min(environmentalMPI, broadVortexCeiling) * (0.36 * ceilingBlend);
      }
      if (!playgroundMode && !metrics.isLand) {
        // Warm, deep ocean with low ventilation must be able to sustain a major typhoon. The old
        // combination of OHC depletion + broad-vortex soft ceiling could hold an otherwise healthy
        // storm near 50–55 m/s even with a 70 m/s target. This is a thermodynamic *potential* floor,
        // not a forced wind floor: the cyclone still needs positive development/RI to approach it.
        // It also remains continuous and environment-driven, so cold/sheared/dry water receives no boost.
        const warmOceanSupport = clamp01(
          0.54 * clamp01((sstVal - 27.0) / 2.8) +
          0.46 * clamp01((ohcVal - 45.0) / 85.0)
        );
        const cleanAtmosphereSupport = clamp01(
          0.42 * clamp01((16.0 - shearVal) / 11.0) +
          0.34 * clamp01((rhVal - 58.0) / 24.0) +
          0.24 * clamp01(outflowEfficiency)
        );
        const majorTyphoonSupport = warmOceanSupport * cleanAtmosphereSupport *
          (1.0 - 0.18 * clamp01(broadMoisturePlatform));
        if (majorTyphoonSupport > 0.20) {
          const supportedPotential = 59.0 + 21.0 * majorTyphoonSupport;
          environmentalMPI = Math.max(environmentalMPI, supportedPotential);
        }
      }
      if (playgroundMode) {
        // No hard or soft maximum-intensity ceiling in playground mode. Keep finite growth room
        // for the numerical tendency calculation while allowing intensity to rise without a cap.
        environmentalMPI = Math.max(environmentalMPI, ty.vmax + Math.max(80.0, baseMPI * 0.75));
      }

      if (isAutomaticPeakIntensityActive(config)) {
        const automaticDamageSeverity = clamp01(Math.max(
          coreRebuildScar,
          terrainHollowCoreMemory,
          1 - structuralDamagePenaltyFactor,
          0.55 * structuralDisorganization
        ));
        let diagnosedAutoTarget = diagnoseAutomaticPeakTarget({
          configuredPeak: Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70),
          environmentalMPI,
          vmax: ty.vmax,
          sst: sstVal,
          ohc: ohcVal,
          rh: rhVal,
          shear: shearVal,
          outflowEfficiency,
          convectiveSuppression,
          ewrcState: ewrcState ?? "none",
          ewrcCount: ty.ewrcCount ?? 0,
          successfulEwrcCount,
          circulationExpansion: ty.circulationExpansion ?? 0,
          rapidIntensifying,
          coreCompactness,
          damageSeverity: automaticDamageSeverity,
          extremeIntensityHours
        });
        if (ewrcState === "forming" || ewrcState === "max_decay") {
          diagnosedAutoTarget = Math.min(diagnosedAutoTarget, ty.vmax);
        }
        // The target itself has lifecycle inertia. Environmental MPI can collapse immediately if
        // the atmosphere/ocean turns hostile, but an ERC/structure-driven aspiration should not
        // jump several m/s in one 10-minute step. Falling adjustments are faster than rising ones.
        const autoTargetTauHours = diagnosedAutoTarget < autoIntensityTarget ? 2.8 : 5.8;
        const autoTargetAlpha = 1 - Math.exp(-stepFraction / autoTargetTauHours);
        autoIntensityTarget += (diagnosedAutoTarget - autoIntensityTarget) * autoTargetAlpha;
        autoIntensityTarget = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(config.maxIntensityLimit ?? 70, autoIntensityTarget));
        // Automatic mode never injects energy to chase the slider. It only supplies a physically
        // attainable ceiling to the existing thermodynamic/MPI relaxation.
        environmentalMPI = Math.min(environmentalMPI, autoIntensityTarget);
      } else {
        autoIntensityTarget = Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70);
      }

      // Extratropical Transition (ET) Weakening Slowdown (New Requirement)
      // Gradually reduce overall weakening speed as the system transitions northwards into the baroclinic zone
      let etSlowdownFactor = 1.0;
      const etDepth = config.newEnvironmentPhysicsEnabled
        ? smoothstep01(clamp01(westerlyDepth / 0.78))
        : Math.min(Math.max(0, (newLat - ((config.westerliesLat ?? 30.0) - 2.0)) / 12.0), 1.0);
      if (westerlyRegimeActive && etDepth > 0.02) {
        etSlowdownFactor = 1.0 - (etDepth * 0.42 + 0.18 * priorEtTransition);
        etSlowdownFactor = Math.max(0.36, etSlowdownFactor);
      }

      // Check if intercepted by the selected-system westerlies and moving rapidly (>40 km/h).
      const isInterceptedByFastWesterlies = westerlyRegimeActive &&
                                            (config.newEnvironmentPhysicsEnabled ? westerlyDepth > 0.24 : newLat >= (config.westerliesLat ?? 30.0) - 3.0) &&
                                            (speedKmh > 40.0);

      // 3. Raw change rate is determined continuously relative to MPI
      const maxLimit = isTargetIntensityCapActive(config) ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 95;
      let vmaxDeltaPerHour = 0;
      if (ty.vmax < environmentalMPI) {
        // Strengthening rate: the user control scales a physically constrained relaxation toward MPI.
        // A value of 0 now truly suppresses positive development; 100% keeps the calibrated baseline,
        // while >100% increases response non-linearly without producing square-wave jumps.
        const rate = Math.max(0, Math.min(2.0, config.intensificationRate ?? 1.0));
        const rateResponse = Math.pow(rate, 0.88);
        const g_v = 1.5 / (1.0 + Math.pow(ty.vmax / 50.0, 1.2));
        const growthRoom = environmentalMPI - ty.vmax;
        const envFavorability = Math.max(0.05, favScore + 0.5);
        const baseCoeff = 0.50 * rateResponse;
        vmaxDeltaPerHour = baseCoeff * envFavorability * Math.sqrt(growthRoom) * g_v;

        // Keep the original calibrated energy-response scale and low-peak adjustment.
        vmaxDeltaPerHour *= 0.54 * lowPeakFactor;

        // Natural intensification has a regime-dependent ceiling.  Favorable environments permit
        // faster deepening, but ordinary strengthening remains well below forced-RI extremes.
        const favorableBoost = clamp01((sstVal - 27.0) / 2.5) * clamp01((12.0 - shearVal) / 8.0) * clamp01((rhVal - 62.0) / 18.0);
        const maxAllowedIntensificationRate = (0.72 + 0.34 * favorableBoost) * rateResponse;
        vmaxDeltaPerHour = Math.min(maxAllowedIntensificationRate, vmaxDeltaPerHour);
        if (ty.vmax < 18.0) vmaxDeltaPerHour *= 0.5;

        // Slow down intensification as typhoon approaches peak potential; once at peak, fluctuate within +/-0.4 m/s
        if (growthRoom < 3.0) {
          const approachFactor = Math.max(0.1, (1.0 - Math.exp(-growthRoom / 1.5)));
          vmaxDeltaPerHour *= approachFactor;
          if (growthRoom < 0.6) {
            // Fluctuate within +/-0.4 m/s when at peak intensity
            const peakFluctuation = Math.sin((ty.history?.length || 0) * 0.7 + (ty.lat * 3.1)) * 0.4;
            vmaxDeltaPerHour += peakFluctuation;
          }
        }

        // Non-linear deceleration as typhoon approaches user-configured maximum intensity limit
        if (isTargetIntensityCapActive(config) && ty.vmax < maxLimit) {
          const growthToLimit = maxLimit - ty.vmax;
          if (growthToLimit > 0 && growthToLimit < 18.0) {
            const p = Math.max(0.0, growthToLimit / 18.0);
            const limitApproachFactor = 0.25 + 0.75 * Math.pow(Math.sin(p * Math.PI / 2), 0.85);
            vmaxDeltaPerHour *= limitApproachFactor;
          }
        }

        // Apply persistent upwelling penalty (Weakened impact)
        if (upwellingPersistentPenaltyHours > 0) {
          vmaxDeltaPerHour *= 0.7;
        }

        // Apply structural damage penalty and the slower "rebuild scar" left by terrain/ventilation.
        vmaxDeltaPerHour *= structuralDamagePenaltyFactor;
        vmaxDeltaPerHour *= 1.0 - 0.48 * coreRebuildScar;
        vmaxDeltaPerHour *= 1.0 - 0.46 * broadMoisturePlatform;
      } else {
        // Weakening rate: proportional to how much we exceed MPI
        const excess = ty.vmax - environmentalMPI;
        // Reduced constant penalty and scaling to avoid sudden drops on sea
        // Added a cap to the weakening rate to prevent "sudden crash" behavior on open water
        // Base weakening rate adjusted by ET slowdown factor (Requirement)
        vmaxDeltaPerHour = Math.max(-3.2, -0.08 * excess - 0.25);
        if (vmaxDeltaPerHour < 0) {
          vmaxDeltaPerHour *= etSlowdownFactor;
        }
      }

      // Ventilation response: below the ventilation threshold, dry air/shear predominantly
      // suppresses positive growth. Once low-entropy air is mixed into the inner core, an
      // intensity-dependent absolute weakening term appears. Fast motion >28 km/h adds only
      // a mild growth penalty here; its much larger effect is on RI probability below.
      if (vmaxDeltaPerHour > 0) {
        vmaxDeltaPerHour *= Math.max(0.12, 1.0 - 0.72 * atmosphericStress.growthSuppression);
        vmaxDeltaPerHour *= atmosphericStress.motionGrowthFactor;
      }
      if (atmosphericStress.ventilationDecay < 0) {
        vmaxDeltaPerHour += atmosphericStress.ventilationDecay;
      }
      if (binaryInteraction.strength > 0.01) {
        // Direct TC-TC interaction usually tilts/ventilates the inner core before any merger.
        // The term is modest because most of the intensity response already enters through VWS.
        vmaxDeltaPerHour += binaryInteraction.intensityTendency;
      }
      const mergerRecoveryBeforeStep = binaryMergerRecoveryPrior;
      const binaryMergerRecoveryHours = Math.max(0, mergerRecoveryBeforeStep - stepFraction);
      if (mergerRecoveryBeforeStep > 0) {
        // A just-merged vortex does not instantly become a clean stronger cyclone. The imported
        // vorticity/moisture can briefly energise convection at collision time, while the following
        // 12-30 h carry a weak, decaying tilt/ventilation penalty as the combined core axisymmetrizes.
        const mergerDisorder = clamp01(mergerRecoveryBeforeStep / 28.0);
        vmaxDeltaPerHour -= 0.035 + 0.14 * mergerDisorder;
      }

      // 2. High-intensity typhoons have much higher SST requirements
      const requiredSST = 26.5 + Math.max(0, (ty.vmax - 17.2) / 50.8) * 2.5; 
      if (sstVal < requiredSST) {
        const sstDeficit = requiredSST - sstVal;
        const intensityScale = Math.pow(ty.vmax / 17.2, 1.5);
        let sstPenalty = 0.35 * sstDeficit * intensityScale;
        
        // Rapid translation in westerlies prevents low SST decay via baroclinic energy coupling
        if (isInterceptedByFastWesterlies) {
          sstPenalty *= 0.15; // 85% reduction in SST-deficit decay speed
        }
        
        // Apply ET slowdown (baroclinic energy support)
        if (sstPenalty > 0) {
          sstPenalty *= etSlowdownFactor;
        }
        
        const coldDecayRelease = 0.010 + 0.10 * coldExposureMaturity + 0.27 * reserveExhaustion;
        vmaxDeltaPerHour -= sstPenalty * coldDecayRelease;

        if (ty.vmax > 32.7 && sstVal < requiredSST - 0.5) {
          let sstLimitDecay = -0.2 * sstDeficit * (ty.vmax / 32.7);
          if (isInterceptedByFastWesterlies) {
            sstLimitDecay *= 0.15;
          }
          if (sstLimitDecay < 0) {
            sstLimitDecay *= etSlowdownFactor;
          }
          vmaxDeltaPerHour = Math.min(sstLimitDecay * (0.07 + 0.38 * reserveExhaustion), vmaxDeltaPerHour);
        }
      }

      // Westerlies interaction decay. New mode uses its own evolving jet/trough score and never
      // reads the legacy straight-band latitude/strength controls.
      if (westerlyRegimeActive && (config.newEnvironmentPhysicsEnabled ? westerlyDepth > 0.20 : newLat >= (config.westerliesLat ?? 30) - 3)) {
        const depth = config.newEnvironmentPhysicsEnabled
          ? smoothstep01(clamp01(westerlyDepth / 0.82))
          : Math.min((newLat - ((config.westerliesLat ?? 30) - 3.0)) / 10.0, 1.0);
        let westerliesDecay = 0.35;
        if (ty.vmax > 28.4) {
          // Strong decay above 10级 (28.4 m/s)
          westerliesDecay = 1.8 + (ty.vmax - 28.4) * 0.15;
        } else if (ty.vmax >= 13.9) {
          // Slower decay in 7-10级 range (13.9 - 28.4 m/s)
          westerliesDecay = 0.15 + (ty.vmax - 13.9) * 0.11;
        } else {
          // Extremely slow decay below 7级
          westerliesDecay = 0.05;
        }
        
        // Rapid translation also shields the core from dry air/shear erosion of westerlies
        if (isInterceptedByFastWesterlies) {
          westerliesDecay *= 0.25; // 75% reduction
        }
        
        // ET slowdown also applies to westerlies-induced decay
        if (westerliesDecay > 0) {
          westerliesDecay *= etSlowdownFactor;
        }
        
        const westerlyRelease = 0.22 + 0.78 * reserveExhaustion;
        if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= Math.max(0.08, 1.0 - 0.78 * westerlyStress);
        vmaxDeltaPerHour -= westerliesDecay * depth * westerlyRelease;
      }

      // Cold-water upwelling suppression now responds to the eyewall wind-driven stirring as well as slow motion.
      if (!metrics.isLand && (speedKmh < 14.0 || upwellingCooling > 0.15)) {
        const slownessFactor = clamp01((16.0 - speedKmh) / 16.0);
        const strengthFactor = Math.max(1.0, ty.vmax / 23.0);
        const immediatePenalty = 0.085 * Math.max(slownessFactor, upwellingStressFactor) * strengthFactor * (config.airSeaCoupling ?? 0.5) * 2.4;
        const coldRelease = 0.010 + 0.12 * coldExposureMaturity + 0.30 * reserveExhaustion;
        const totalDecay = Math.max(immediatePenalty, coldWaterDecay) * coldRelease;
        if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= Math.max(0.08, 1.0 - 0.86 * Math.max(effectiveColdWaterStress, upwellingStressFactor));
        vmaxDeltaPerHour -= totalDecay * etSlowdownFactor;
      }
      
      // Enforce physical constraints from environment: force decay if SST <= 26.5 and trying to grow
      if (sstVal <= 26.5) {
        const deficit = Math.max(0.1, 26.5 - sstVal);
        if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= Math.max(0.05, 1.0 - 0.88 * effectiveColdWaterStress);
        const coldRelease = 0.010 + 0.12 * coldExposureMaturity + 0.32 * reserveExhaustion;
        vmaxDeltaPerHour -= Math.min(0.86, (0.07 + deficit * 0.20) * coldRelease) * etSlowdownFactor;
      }

      // Convection cannot freely exploit high SST when the column is ventilated/dry or the storm
      // is traversing cold water/westerlies. Positive tendencies are preferentially suppressed;
      // strong dry-air intrusion also produces a modest, intensity-dependent erosion.
      if (vmaxDeltaPerHour > 0) {
        vmaxDeltaPerHour *= Math.max(0.04, 1.0 - 0.82 * convectiveSuppression);
        if (postDryAirBurstSuppressionHours > 0) vmaxDeltaPerHour *= 0.58 + 0.42 * (1.0 - dryAirIntrusion);
        // After a dry-core collapse, warm water first restores the moist envelope and scattered
        // bursts; it does not instantly recreate a closed eyewall.  Intensification efficiency
        // therefore follows the slow structural recovery states.  Once the core is moist/closed
        // again this factor naturally returns to ~1 without a fixed recovery timer.
        if (dryAirCoreExposure > 0.10 || dryRecoveryHours > 0.5 || dryAirLifecyclePhase === "reorganizing") {
          const rebuildEfficiency = clamp01(
            0.22 + 0.34 * innerCoreMoisture + 0.20 * deepConvectiveCoverage +
            0.16 * moistEnvelopeIntegrity + 0.08 * (1 - eyewallOpenSectorFraction)
          );
          vmaxDeltaPerHour *= 0.36 + 0.64 * rebuildEfficiency;
        }
      }
      if (dryAirIntrusion > 0.24 || dryAirCoreExposure > 0.12) {
        const dryIntensityLoad = smoothstep01((ty.vmax - 20.0) / 45.0);
        // 3.3.4: a peripheral wrapped dry slot is first and foremost an *intensification stopper*.
        // Direct wind decay waits for a breached moist envelope / open eyewall sector.  This keeps
        // peak-intensity storms coherent for several hours after the first dry slot appears, then
        // allows a much sharper but still progressive fall once one quadrant of the eyewall fails.
        const dryCoreDeficit = clamp01(1.0 - innerCoreMoisture);
        const erosiveDryLoad = clamp01(
          0.05 * dryAirIntrusion +
          0.52 * dryAirCoreExposure +
          0.30 * eyewallOpenSectorFraction +
          0.13 * dryCoreDeficit
        );
        const breachRelease = 0.16 + 0.84 * smoothstep01(clamp01(
          0.58 * dryAirCoreExposure + 0.42 * eyewallOpenSectorFraction
        ));
        vmaxDeltaPerHour -= (0.014 + 0.22 * dryIntensityLoad) * erosiveDryLoad *
          breachRelease * (0.34 + 0.66 * atmosphericStress.ventilation);

        // Once a low-entropy tongue is dynamically connected to the inner core under appreciable
        // shear, ventilation must do more than merely cancel positive intensification. Add a
        // bounded direct spin-down that ramps in only after a genuine core breach; a peripheral
        // dry slot by itself remains mostly an organization/intensification penalty.
        const connectedVentilationBreakdown = clamp01(
          smoothstep01((dryAirCoreConnection - 0.34) / 0.56) *
          (0.38 + 0.62 * dryAirVentilationIndex) *
          (0.36 + 0.64 * clamp01((shearVal - 9.0) / 24.0)) *
          (0.42 + 0.58 * dryAirCoreExposure)
        );
        if (connectedVentilationBreakdown > 0.04) {
          const coreSpinDown = (0.08 + 0.50 * dryIntensityLoad) * connectedVentilationBreakdown;
          vmaxDeltaPerHour -= Math.min(0.62, coreSpinDown);
          coreRebuildScar = Math.max(coreRebuildScar, 0.22 + 0.48 * connectedVentilationBreakdown);
          damageOrigin = damageOrigin === "none" || damageOrigin === "shear_dry" ? "shear_dry" : "mixed";
        }
      }
      if (postDryAirBurstSuppressionHours > 0 && dryAirCoreExposure < 0.24 && !metrics.isLand) {
        // A post-intrusion vortex commonly rebuilds unevenly: shallow bursts and partial eyewall
        // closure make wind/rain pulse rather than returning to a smooth, explosive strengthening
        // curve. Keep the oscillation small and deterministic so replay remains reproducible.
        const postDryWindPulse = Math.sin((currentSimHourFloat + ty.lat * 0.11 + ty.lon * 0.035) * Math.PI / 2.2);
        vmaxDeltaPerHour += 0.045 * postDryWindPulse * (0.45 + 0.55 * moistureReservoir);
      }

      // Requirement 6 & Requirement 8: Atmospheric Peak Fluctuation & Non-Linear Forced Decay
      
      // Calculate a small downward-only atmospheric fluctuation when approaching maxLimit. The exact target is a hard upper bound.
      let envPeakOffset = 0;
      if (isTargetIntensityCapActive(config) && ty.vmax >= maxLimit - 2.0) {
        const timePhase = Math.sin((currentSimHour + (ty.id.charCodeAt(0) || 0)) * 0.22) * 0.35 + (this.prng.next() - 0.5) * 0.1;
        envPeakOffset = Math.max(-0.4, Math.min(0.4, timePhase));
      }
      const effectiveMaxLimit = Math.min(maxLimit, maxLimit + envPeakOffset);
      const speedFactor = config.speed || 1.0;

      if (isTargetIntensityCapActive(config) && ty.vmax > effectiveMaxLimit) {
         // Lowering the target below the current intensity must take precedence over any
         // automatically/previously forced RI/ERI state. Preserve a smooth physical decay path,
         // but remove the forcing source so it cannot re-arm on the next step.
         ty.rapidIntensifying = false;
         ty.playgroundAutoERI = false;
         delete ty.forcedRapidIntensification;
         delete ty.forcedRapidIntensificationMode;
         ty.rapidEpisodeAbortRequested = true;
         ty.rapidTriggerCooldownHours = Math.max(ty.rapidTriggerCooldownHours || 0, 24);
         const targetChanged = forcedDecayTargetVmax !== maxLimit || forcedDecayStartVmax === undefined;
         // Restart the relaxation if the user changes the target materially.  Do not restart merely because
         // an adverse environment makes the cyclone briefly stronger/weaker than the original start value.
         if (targetChanged) {
           forcedDecayStartVmax = ty.vmax;
           forcedDecayTargetVmax = maxLimit;
           forcedDecayElapsedHours = 0;

           const decayGap = Math.max(0.1, ty.vmax - maxLimit);
           const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
           const intensity = clamp01((ty.vmax - 20.0) / 50.0);
           const favorableResistance = 1.0 + (1.0 - clamp01(adversity / 1.4)) * 0.28;
           let dur = (10.0 + decayGap * 0.72 + intensity * 8.0) * favorableResistance;
           if (metrics.isLand) dur *= 0.66;
           forcedDecayDuration = Math.max(8.0, Math.min(54.0, dur));
           forcedDecayIsContinuous = true;
         }

         forcedDecayElapsedHours += stepFraction;
         const dur = Math.max(1.0, forcedDecayDuration || 18.0);
         const startV = Math.max(maxLimit + 0.1, forcedDecayStartVmax ?? ty.vmax);
         const deltaV = Math.max(0.1, startV - maxLimit);
         const p = clamp01(forcedDecayElapsedHours / dur);

         // Ease-out target trajectory: weakening begins promptly but naturally slows as the requested
         // intensity is approached instead of maintaining a fixed rate all the way to the boundary.
         const remainingFraction = Math.pow(Math.max(0, 1.0 - p), 1.58);
         const desiredV = maxLimit + deltaV * remainingFraction;
         let targetDecayRate = Math.max(0.04, (ty.vmax - desiredV) / Math.max(stepFraction, 1 / 60));

         const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
         const intensity = clamp01((ty.vmax - 18.0) / 55.0);
         const physicalCap = metrics.isLand
           ? 2.35
           : Math.min(1.75, 0.62 + adversity * 0.48 + intensity * 0.30);
         targetDecayRate = Math.min(physicalCap, targetDecayRate);

         // The target is an upper-bound request, not an instantaneous intensity overwrite.  Stronger
         // environmental/land weakening is retained; otherwise the smooth relaxation controls the rate.
         vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, -targetDecayRate);
      } else {
         forcedDecayStartVmax = undefined;
         forcedDecayTargetVmax = undefined;
         forcedDecayElapsedHours = 0;
         forcedDecayDuration = undefined;
         forcedDecayIsContinuous = false;

         if (isTargetIntensityCapActive(config)) {
           const distanceToLimit = effectiveMaxLimit - ty.vmax;
           if (distanceToLimit <= 0.6) {
             // Reached max intensity range: fluctuate smoothly below the requested target, never above it.
             const targetFluctuationVmax = maxLimit - 0.20 + Math.sin((currentSimHour * 0.35) + (ty.id.charCodeAt(0) || 0)) * 0.20;
             const diff = targetFluctuationVmax - ty.vmax;
             vmaxDeltaPerHour = Math.max(-0.8, Math.min(0.8, diff * 2.0)) / speedFactor;
           } else if (vmaxDeltaPerHour > 0 && distanceToLimit < 2.5) {
             // Gently cushion near final boundary only (within 2.5 m/s) to prevent overshooting
             const approachFactor = Math.max(0.35, distanceToLimit / 2.5); 
             vmaxDeltaPerHour *= approachFactor;
           }
         }
      }

      // Add seeded natural fluctuation (deterministic noise based on PRNG)
      const prngNoise = (this.prng.next() - 0.5) * 0.25; // small fluctuation
      vmaxDeltaPerHour += prngNoise;

      if (ty.manualForcedDecay) {
        if (ty.vmax > ty.manualForcedDecay.targetVmax) {
          if (ty.manualForcedDecay.startVmax === undefined) {
            ty.manualForcedDecay.startVmax = ty.vmax;
            ty.manualForcedDecay.elapsedHours = 0;
          }
          ty.manualForcedDecay.elapsedHours = (ty.manualForcedDecay.elapsedHours || 0) + stepFraction;
          const progress = Math.min(1.0, ty.manualForcedDecay.elapsedHours / ty.manualForcedDecay.duration);
          
          const deltaV = ty.manualForcedDecay.startVmax - ty.manualForcedDecay.targetVmax;
          const rate = deltaV / ty.manualForcedDecay.duration;
          vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, -rate);
          
          if (progress >= 1.0) {
            delete ty.manualForcedDecay;
          }
        } else {
          delete ty.manualForcedDecay;
        }
      }

      // Apply Structural Damage Intensity Penalty
      if (isStructureDamaged && !metrics.isLand) {
        // During the user-requested recovery sequence the old mountain flags are no longer an
        // active intensity-growth penalty. The remaining scar still controls gradual structural
        // reorganization through the coupled structure model.
        const maxElev = penaltyRecoveryActive ? 0 : ((ty as any).maxLandElevationPassed ?? 0);
        const landHrs = penaltyRecoveryActive ? 0 : ((ty as any).landHoursPassed ?? 0);
        const upwHrs = penaltyRecoveryActive ? 0 : ((ty as any).upwellingPersistentPenaltyHours ?? 0);
        if (maxElev > 500 || landHrs > 4 || upwHrs > 6) {
          const growthMultiplier = warmWaterHoursAfterSea >= 6.0 ? 0.80 : 0.20;
          if (vmaxDeltaPerHour > 0) {
            vmaxDeltaPerHour *= growthMultiplier;
          }
        }
      }

      // Landfall Decay Mechanism (New Model)
      // Calculates based on coverage, terrain elevation across the 12-level wind circle, and non-linear intensity scaling
      // Requirement 2: Increase decay when scraping high terrain land (trigger even if 7-level wind circle touches)
      if (metrics.isLand || r10TouchesLand || r7TouchesLand) {
         let coverage = 0;
         if (metrics.isLand) coverage = 1.0;
         else if (r10TouchesLand && r10) coverage = getLandCoverage(newLat, newLon, (r10.ne + r10.nw + r10.sw + r10.se)/4, config?.coastlineSource);
         else if (r7TouchesLand && r7) coverage = getLandCoverage(newLat, newLon, (r7.ne + r7.nw + r7.sw + r7.se)/4, config?.coastlineSource) * 0.3; // r7 coverage has less impact

         // Sample terrain elevation across the entire 12-level wind circle (r12) area
         // Requirement 2: Increase scraping high terrain land effect. Sample using r7 radius if scraping to catch the mountains.
         const r12Radius = (r12 && r12.ne > 0) ? (r12.ne + r12.nw + r12.se + r12.sw)/4 : (r10 ? (r10.ne + r10.nw)/2 * 0.7 : 35);
         const searchRadius = r7TouchesLand ? ((r7.ne + r7.nw + r7.se + r7.sw)/4) : r12Radius;
         const terrainSample = getMaxElevationInRadius(newLat, newLon, searchRadius, config?.coastlineSource);
         const maxElevation = terrainSample.maxElevation;

         // Non-linear decay scaling: High-intensity typhoons decay rapidly upon landfall due to loss of warm ocean moisture.
         // When dropping below category 12 (32.7m/s), decay continues at realistic speeds (0.8 - 1.8 m/s per hour) rather than stalling.
         // Below category 8 (< 17.2m/s), decay accelerates significantly to quickly dissipate tropical lows into remnants.
         let intensityFactor = 0.6;
         if (ty.vmax > 32.7) {
            intensityFactor = 1.2 + 1.8 * Math.pow((ty.vmax - 32.7) / 25.0, 0.9);
         } else if (ty.vmax > 17.2) {
            // Speed up weakening for 8-9 level tropical storms over land (17.2 - 24.4 m/s)
            const tFactor = (ty.vmax - 17.2) / 15.5;
            if (ty.vmax <= 24.5) {
               intensityFactor = 1.0 + 0.65 * tFactor;
            } else {
               intensityFactor = 0.6 + 0.8 * tFactor;
            }
         } else {
            // Speed up weakening for storms below level 8 (17.2m/s) over land
            intensityFactor = 1.05 + 0.65 * (1.0 - ty.vmax / 17.2);
         }
         // 深入内陆水汽供应不足后减弱速度加快
         const deepInlandFactor = 1.0 + Math.min(1.5, landHours / 18.0);

         // High-elevation terrain impact (Requirement 4: Reduced multipliers)
         let elevationScale = 11000.0;
         let terrainMulti = 0.09;
         let luzonFactor = 1.0;
         if (newLat >= 12 && newLat <= 19 && newLon >= 119 && newLon <= 123) {
            // Luzon still disrupts compact eyewalls, but its explicit mountain-assisted *intensity*
            // decay is moderated relative to v1.9. Terrain mostly changes structure while ordinary
            // land friction/loss of enthalpy continues to weaken the storm.
            elevationScale = 21500.0;
            terrainMulti = 0.055;
            luzonFactor = 1.0;
         }
         if (newLat >= 18 && newLat <= 20.5 && newLon >= 108.5 && newLon <= 111.5) {
            // Hainan (drastically cut Wuzhi Mountain extra decay)
            elevationScale = 48000.0;
            terrainMulti = 0.0035;
         }
         // Taiwan mountain decay bonus: slightly reduced so near-shore ocean feeding is not overwhelmed
         if (newLat >= 21.5 && newLat <= 25.5 && newLon >= 119.5 && newLon <= 122.5) {
            // Taiwan Central Mountain Range
            elevationScale = 5900.0; 
            terrainMulti = 0.50; 
            if (ty.vmax > 30.0) {
              const taiwanShred = 1.0 + Math.pow((ty.vmax - 30.0) / 12.0, 1.2) * 0.30;
              terrainMulti *= taiwanShred;
            }
         }

         // Durational scaling: terrain height effect increases over continuous contact up to a cap
         const durationScale = Math.min(1.0, landContactHours / 24.0);
         const r10DurationFactor = Math.min(1.2, r10LandContactHours / 16.0);
         const elevationEffectMultiplier = (1.0 + 0.6 * Math.pow(durationScale, 1.25)) * (1.0 + r10DurationFactor * 0.5);
         const adjustedTerrainMulti = terrainMulti * elevationEffectMultiplier;

         const elevationFactor = Math.pow(maxElevation / elevationScale, 0.95);
         const r10FrictionMultiplier = 1.0 + 0.4 * Math.min(1.0, r10LandContactHours / 12.0);
         const mountainBarrier = clamp01((maxElevation - 250.0) / 1750.0);
         const inTaiwanBarrier = newLat >= 21.5 && newLat <= 25.5 && newLon >= 119.5 && newLon <= 122.5;
         const inLuzonBarrier = newLat >= 12 && newLat <= 19.5 && newLon >= 119 && newLon <= 124;
         const barrierStrength = inTaiwanBarrier ? 0.72 : inLuzonBarrier ? 0.27 : 0.24;
         const coreMountainShock = 1.0 + mountainBarrier * barrierStrength * (0.62 + 0.38 * clamp01((ty.vmax - 24.0) / 36.0));
         // The Visayas/Mindanao are a fragmented but rough land surface: crossing multiple islands
         // adds boundary-layer drag even without the Luzon/Taiwan mountain-barrier shock.
         const inCentralSouthPhilippines = newLat >= 5.0 && newLat < 15.0 && newLon >= 117.0 && newLon <= 127.5;
         const philippineIslandFriction = inCentralSouthPhilippines
           ? (metrics.isLand ? 1.14 : (r10TouchesLand || r7TouchesLand ? 1.06 : 1.0))
           : 1.0;
         const baseLandDecay = (0.85 + elevationFactor * adjustedTerrainMulti) * intensityFactor * deepInlandFactor * r10FrictionMultiplier * luzonFactor * coreMountainShock * philippineIslandFriction;
         
         // Sea Wind Circle Gain Logic: 
         // If part of the wind circle is still over the sea, reduce the landfall decay.
          // This is to simulate the "island effect" (Taiwan, Hainan) where the sea continues to provide energy.
          const seaCoverage = 1.0 - coverage;
          // The more core the wind circles are on the sea, the slower the weakening.
          // We use the r10 coverage as a proxy for "core" sea contact.
          const coreSeaCoverage = 1.0 - (r10TouchesLand ? getLandCoverage(newLat, newLon, (r10.ne + r10.nw)/2, config?.coastlineSource) : 0);
          const seaGainFactor = Math.max(0.4, 1.0 - (seaCoverage * 0.5 + coreSeaCoverage * 0.35));
          
          const finalLandDecay = baseLandDecay * coverage * seaGainFactor;
          
          // Casualty impact model: exposure × hazard × vulnerability × preparedness/surprise.
          // Population alone is insufficient: resilient infrastructure, warning lead and evacuation
          // substantially reduce fatality risk, while an unexpected turn into an inadequately warned
          // area increases it. These are broad simulation priors rather than real-time demographic data.
          if (ty.vmax > 17 && (metrics.isLand || r7TouchesLand)) {
             const societal = getSocietalExposureProfile(newLat, newLon);
             const basePopDensity = societal.populationDensity;

             const windHazard = Math.pow(clamp01((ty.vmax - 17) / 48), 2.6) * (1.0 + 1.5 * clamp01((ty.vmax - 40) / 35));
             const slowFactor = clamp01((30 - speedKmh) / 22);
             const terrainFlood = 1.0 + 1.25 * clamp01((maxElevation - 150) / 1600);
             const rainFloodHazard = clamp01((ty.vmax - 18) / 42) * (0.45 + 0.95 * slowFactor) * terrainFlood;
             const avgR7 = Math.max(30, r7 ? (r7.ne + r7.nw + r7.se + r7.sw) / 4 : 30);
             const surgeProxy = clamp01((ty.vmax - 28) / 35) * clamp01(avgR7 / 260);

             const footprintArea = Math.PI * avgR7 * avgR7;
             // Count mostly newly affected population as the cyclone translates, while slow movers
             // retain a smaller continuing flood-exposure contribution.
             const translatedKm = Math.max(0.5, speedKmh * stepFraction);
             const newExposureFraction = Math.max(0.012, Math.min(0.15, translatedKm / Math.max(60, 2 * avgR7)));
             const floodPersistenceFraction = 0.010 + 0.025 * slowFactor;
             const effectiveExposure = footprintArea * coverage * basePopDensity * (newExposureFraction + floodPersistenceFraction * rainFloodHazard);

             const infrastructureVulnerability = Math.max(0.20, Math.min(0.95,
               1.05 - 0.68 * societal.infrastructureResilience - 0.16 * societal.evacuationCapacity
             ));
             // Preparation can only be converted into protection to the degree that warnings are
             // disseminated reliably and emergency actions are actually executed. This is where
             // delayed/missed/under-reported warnings feed through to simulated casualties.
             const institutionalWarningLoss = clamp01(
               0.42 * (1 - societal.warningReliability) +
               0.33 * (1 - societal.responseCapacity) +
               0.25 * clamp01(societal.responseDelayHours / 7.0)
             );
             const effectivePreparedness = preparednessIndex * (1 - 0.58 * institutionalWarningLoss);
             const warningProtection = Math.max(0.22, Math.min(1.0, 1.0 - 0.72 * effectivePreparedness));
             const responseDelayPenalty = 1.0 + 0.48 * institutionalWarningLoss;
             const surprisePenalty = (1.0 + 1.35 * forecastSurpriseIndex) * responseDelayPenalty;
             const compoundHazard = 0.52 * windHazard + 0.36 * rainFloodHazard + 0.12 * surgeProxy;

             const casualtiesThisStep =
               effectiveExposure * compoundHazard * infrastructureVulnerability * warningProtection * surprisePenalty *
               0.0000032;
             currentCasualties += Math.max(0, casualtiesThisStep);
          }

          if (config.landDecayEnabled && finalLandDecay > 0) {
             let effectiveDecay = finalLandDecay;

             // 台风水汽供应机制：中低层水汽充足(相对湿度 rhVal >= 55%)时，强水汽输送提供持续潜热释放，但陆地摩擦依然占主导
             const moistureSupply = Math.max(0.0, Math.min(1.0, (rhVal - 50.0) / 40.0));
             const moistureReduction = 0.25 * moistureSupply;
             effectiveDecay *= (1.0 - moistureReduction);
             
             // ET slowdown also applies to landfall decay as baroclinic energy can sustain transitioning systems
             effectiveDecay *= etSlowdownFactor;

             if (metrics.isLand) {
                const landfallAdjustmentFactor = Math.max(0.01, 1.0 + (config.landfallDecayAdjustment ?? 0.0));
                effectiveDecay *= landfallAdjustmentFactor;

                // 3.3.2 broad-vortex inland shelf. The shelf is no longer a generic "plain"
                // bonus: it requires a genuinely large gale-force circulation (roughly >=380 km
                // mean R7), because a broad vortex has a much larger angular-momentum reservoir
                // and a larger fraction of its circulation can remain coupled to moist/coastal air.
                // Low hills are allowed as well as plains, while true mountainous/ridge terrain
                // still destroys the shelf. This follows fractional-land/size-dependent decay logic
                // rather than locking any named region or storm to 18 m/s.
                const avgR7ForShelf = r7 ? Math.max(0, (r7.ne + r7.se + r7.sw + r7.nw) / 4) : 0;
                const terrainDiag = getEtopoTerrainDiagnostics(newLat, newLon);
                const plainFactor = terrainDiag?.plainScore ?? clamp01((620 - metrics.elevation) / 520);
                const lowerYangtzeSupport = terrainDiag?.lowerYangtzePlainSupport ?? 0;
                const northChinaSupport = terrainDiag?.northChinaPlainSupport ?? 0;
                const namedPlainSupport = Math.max(lowerYangtzeSupport, northChinaSupport);
                const rollingHillSupport = terrainDiag
                  ? clamp01((1050 - terrainDiag.elevation) / 900) *
                    clamp01((760 - terrainDiag.localReliefM) / 620) *
                    (1 - 0.52 * terrainDiag.ridgeExposure)
                  : clamp01((900 - metrics.elevation) / 760);
                const lowReliefSupport = Math.max(plainFactor, 0.76 * rollingHillSupport, 0.90 * namedPlainSupport);
                // 3.3.24 residual-vortex shelf: Kaplan-DeMaria-style decay is asymptotic, so the
                // lower-wind stage should slow even for a moderate-size vortex when a coherent moist
                // low-level circulation survives.  Size helps, but it is no longer a >=350 km gate.
                // The result is a *transient soft shelf* near 18 m/s, not a universal hard lock.
                const circulationSizeSupport = avgR7ForShelf > 0
                  ? smoothstep01(clamp01((avgR7ForShelf - 145) / 235))
                  : 0.18;
                const residualCirculationSupport = clamp01(
                  0.44 * circulationSizeSupport +
                  0.34 * lowLevelVortexIntegrity +
                  0.22 * postPeakEnvelopeMemory
                );
                const columnMoistureSupport = clamp01((rhVal - 50) / 32) * clamp01((moistureReservoir - 0.18) / 0.72);
                const benignShearSupport = clamp01((23 - shearVal) / 13.0);
                const dryAirSupport = 1 - clamp01((dryAirIntrusion - 0.18) / 0.62);
                const shelfSupport = clamp01(
                  lowReliefSupport * residualCirculationSupport *
                  (0.42 + 0.58 * columnMoistureSupport) *
                  (0.48 + 0.52 * benignShearSupport) *
                  (0.54 + 0.46 * dryAirSupport) *
                  (0.92 + 0.12 * namedPlainSupport)
                );
                if (ty.vmax < 20.0 && ty.vmax >= 15.0 && shelfSupport > 0.12) {
                  const shelfTarget = 17.85 + 0.95 * shelfSupport + 0.08 * namedPlainSupport;
                  const excess = Math.max(0, ty.vmax - shelfTarget);
                  const belowShelf = Math.max(0, shelfTarget - ty.vmax);
                  const shelfDecay = Math.max(
                    0.0035,
                    0.008 + 0.052 * (1 - shelfSupport) + 0.030 * excess + 0.002 * Math.min(1.6, belowShelf)
                  );
                  const shelfEngagement = clamp01((20.0 - ty.vmax) / 1.55) *
                    smoothstep01(clamp01((shelfSupport - 0.08) / 0.42));
                  const cappedDecay = Math.min(effectiveDecay, shelfDecay);
                  effectiveDecay = effectiveDecay * (1.0 - shelfEngagement) + cappedDecay * shelfEngagement;
                }

                // If center is on land, decay dominates.
                vmaxDeltaPerHour = -effectiveDecay;
             } else {
                const proximityAdjustmentFactor = Math.max(0.01, 1.0 + (config.landProximityDecayAdjustment ?? 0.0));
                effectiveDecay *= proximityAdjustmentFactor;
                
                // In the South China Sea (semi-enclosed), dampen the land proximity penalty slightly
                if (newLon > 110 && newLon < 120 && newLat > 10 && newLat < 22) {
                  effectiveDecay *= 0.65;
                }

                // If center is still on sea, land decay is a penalty but we ensure it doesn't cause a "crash"
                // We use a non-linear combination: take the worse of (env decay) and (land decay), 
                // then add a small portion of the other to avoid discontinuity.
                const envDelta = vmaxDeltaPerHour;
                // Scraping detection: if it's been touching land for >3 hours but center is still not on land
                // it's likely scraping rather than a direct approach. Increase the decay.
                let scrapingMultiplier = 0.75; 
                if (landContactHours > 3.0) {
                    const scrapeIntensity = Math.min(1.0, (landContactHours - 3.0) / 6.0);
                    scrapingMultiplier = 0.75 + 0.65 * scrapeIntensity; // Up to 1.4x effectiveDecay
                }
                const landDelta = -effectiveDecay * scrapingMultiplier; 
                
                if (envDelta < 0) {
                   // Both are negative, take the more negative one plus a fraction of the other
                   vmaxDeltaPerHour = Math.min(envDelta, landDelta) + Math.max(envDelta, landDelta) * 0.2;
                } else {
                   // Environmental is positive, land is negative
                   vmaxDeltaPerHour = envDelta + landDelta;
                }
                
                // Final safety cap for open-water proximity weakening
                vmaxDeltaPerHour = Math.max(-10.5, vmaxDeltaPerHour);
             }
          }
       }
       
       // Ordinary intensification is not a ruler-straight ramp.  Convective bursts, eyewall
       // organization and boundary-layer recovery produce multi-hour fluctuations even in a
       // broadly steady environment.  Use deterministic low-frequency variability plus a short
       // tendency memory so the curve meanders smoothly rather than jittering every 10 minutes.
       if (vmaxDeltaPerHour > 0) {
         const normalWave = episodeWave(`${ty.id}-normal`, currentSimHourFloat, currentSimHour, 0.14);
         const desiredRate = Math.max(0, vmaxDeltaPerHour * Math.max(0.72, Math.min(1.28, normalWave)));
         const prevRate = Number.isFinite(ty.intensityRateMemory as number) ? (ty.intensityRateMemory as number) : desiredRate;
         const memoryAlpha = clamp01(stepFraction / 1.35);
         const smoothedRate = prevRate + (desiredRate - prevRate) * memoryAlpha;
         ty.intensityRateMemory = smoothedRate;
         vmaxDeltaPerHour = 0.64 * desiredRate + 0.36 * smoothedRate;
       } else {
         // Do not let a favorable-period memory mask genuine weakening; decay the memory quickly.
         ty.intensityRateMemory = (ty.intensityRateMemory ?? 0) * 0.72;
       }

       // Normal mode keeps the calibrated cap. Playground deliberately removes the upper ceiling.
       vmaxDeltaPerHour = playgroundMode ? Math.max(-12.5, vmaxDeltaPerHour) : Math.max(-12.5, Math.min(2.2, vmaxDeltaPerHour));
       
       // Dynamic states
       // rapidIntensifying / ewrcState are initialized near the persistent structural state above
       // because the automatic-peak diagnostic needs them earlier in this same integration step.
       let ewrcProgress = ty.ewrcProgress;
       let ewrcDuration = ty.ewrcDuration ?? 12;
       let ewrcWeakenAmount = ty.ewrcWeakenAmount ?? 6;
       let ewrcColdWakeHours = ty.ewrcColdWakeHours ?? 0;
       let ewrcL12LandHours = ty.ewrcL12LandHours ?? 0;
       let ewrcStartVmax = ty.ewrcStartVmax ?? ty.vmax;
       const carriedRmwCeiling = (ty.giantEyeOuterWallMemory ?? 0) > 0.12 ? 175.0 : 90.0;
       let ewrcStartRmw = Math.max(8.0, Math.min(carriedRmwCeiling, ty.ewrcStartRmw ?? ty.rmw ?? 30));
       let ewrcExtraAdjust = ty.ewrcExtraAdjust ?? 0;
       let ewrcRecoveryDuration = ty.ewrcRecoveryDuration ?? 12;
       // Ordinary tropical cores stay within the normal RMW envelope. Failed ERCs can retain a
       // stalled, much farther-out wind maximum for many hours (Winnie/Khanun-like broad-eye state),
       // so do not truncate that structural memory back to 90 km at the start of every step.
       let rmw = Math.max(8.0, Math.min(carriedRmwCeiling, ty.rmw || 30));

       // Playground: over water, ERI is the default continuous regime. Episodes remain finite
       // so the rate can pulse naturally; after one finishes the next ocean step starts another.
       // On land the automatic ERI rolls out and ordinary landfall weakening takes over.
       const manualRapidHostility =
         !!ty.forcedDryAir ||
         (ty.forcedShear !== undefined && ty.forcedShear > 15.0);
       const playgroundSeaERI =
         playgroundMode &&
         !metrics.isLand &&
         !ty.playgroundAutoERIPaused &&
         !manualRapidHostility;
       if (playgroundSeaERI) {
         ty.playgroundAutoERI = true;
         ty.forcedRapidIntensification = true;
         ty.forcedRapidIntensificationMode = "eri";
         ty.rapidIntensificationMode = "eri";
         rapidIntensifying = true;
         // Do not erase a user/environment abort request once it has begun. The auto episode
         // may resume only after the hostile intervention is removed and the current exit completes.
         if (!ty.rapidEpisodeAbortRequested) ty.rapidEpisodeAbortRequested = false;
       } else if (ty.playgroundAutoERI) {
         ty.playgroundAutoERI = false;
         delete ty.forcedRapidIntensification;
         delete ty.forcedRapidIntensificationMode;
         if (rapidIntensifying) ty.rapidEpisodeAbortRequested = true;
       }
       // Leaving playground mode resets only the *pause latch* so a later deliberate re-entry
       // once again gets the documented default ocean auto-ERI behavior.
       if (!playgroundMode && ty.playgroundAutoERIPaused) {
         ty.playgroundAutoERIPaused = false;
       }
 
       // A. Natural Rapid Intensification (RI) trigger.
       // RI is a relatively uncommon *episode*, not a per-timestep coin flip.  The old
       // implementation evaluated a ~20% probability every physics step, which made RI
       // appear far too often at high simulation speeds.  We now require a sustained
       // favorable preconditioning window and use an hourly hazard converted to the
       // current fractional timestep.  A cooldown also prevents immediate repeat RI.
       const rapidCooldown = Math.max(0, (ty.rapidTriggerCooldownHours || 0) - stepFraction);
       ty.rapidTriggerCooldownHours = rapidCooldown;
       const naturallyFavorableForRi =
         config.rapidIntensifyEnabled &&
         !rapidIntensifying &&
         !ty.rapidEpisodeAbortRequested &&
         vmaxDeltaPerHour > 0.68 &&
         ty.vmax >= 27.0 && ty.vmax <= 60.0 &&
         !metrics.isLand && landContactHours < 0.15 &&
         ewrcState === "none" &&
         sstVal >= 28.2 && ohcVal >= 72.0 &&
         shearVal < 10.5 && rhVal > 70.0 &&
         atmosphericStress.ventilation < 0.39 &&
         atmosphericStress.motionStress < 0.42;

       if (naturallyFavorableForRi) {
         ty.rapidFavorableHours = Math.min(48, (ty.rapidFavorableHours || 0) + stepFraction);
       } else {
         // Preconditioning should be lost gradually, rather than reset by one noisy step.
         ty.rapidFavorableHours = Math.max(0, (ty.rapidFavorableHours || 0) - stepFraction * 1.8);
       }

       if (naturallyFavorableForRi && rapidCooldown <= 0 && (ty.rapidFavorableHours || 0) >= 10.0) {
         const ohcSupport = clamp01((ohcVal - 72) / 75);
         const shearSupport = clamp01((10.5 - shearVal) / 6.5);
         const moistureSupport = clamp01((rhVal - 70) / 16);
         const growthSupport = clamp01((vmaxDeltaPerHour - 0.68) / 0.60);
         // RI onset is rare even in a favorable environment.  The sustained
         // preconditioning requirement above does most of the gating; this
         // remaining hourly hazard is deliberately low so normal favorable
         // intensification is much more common than an automatic RI episode.
         const hourlyHazard = (0.0014 + 0.0018 * ohcSupport + 0.0015 * shearSupport + 0.0012 * moistureSupport + 0.0009 * growthSupport) * atmosphericStress.riProbabilityFactor;
         const stepProbability = 1 - Math.pow(1 - Math.min(0.0055, Math.max(0, hourlyHazard)), Math.max(0.01, stepFraction));
         if (this.prng.next() < stepProbability) {
           rapidIntensifying = true;
           ty.rapidIntensificationMode = "ri";
           ty.rapidEpisodeElapsedHours = 0;
           const extended = this.prng.next() < 0.06;
           ty.rapidEpisodeDurationHours = extended
             ? 24.0 + this.prng.nextRange(0, 10.0)
             : 12.0 + this.prng.nextRange(0, 11.0);
           ty.rapidEpisodeTarget24h = 15.0 + this.prng.nextRange(0, 6.5);
           ty.rapidEpisodeStartRate = Math.max(0, vmaxDeltaPerHour);
           ty.rapidEpisodeLastRate = Math.max(0, vmaxDeltaPerHour);
           ty.rapidEpisodeExitHours = 0;
           ty.rapidEpisodeExitDuration = undefined;
           ty.rapidEpisodeAbortRequested = false;
           ty.rapidFavorableHours = 0;
         }
       }

       // Backward compatibility for saves created before the RI/ERI episode-state fields existed.
       if (rapidIntensifying && !ty.rapidEpisodeDurationHours) {
         ty.rapidIntensificationMode = ty.rapidIntensificationMode || "ri";
         ty.rapidEpisodeElapsedHours = 0;
         ty.rapidEpisodeDurationHours = 18.0;
         ty.rapidEpisodeTarget24h = 18.0;
         ty.rapidEpisodeStartRate = Math.max(0, vmaxDeltaPerHour);
         ty.rapidEpisodeLastRate = Math.max(0, vmaxDeltaPerHour);
       }
 
      // B. Eyewall Replacement Cycle (EWRC)
      // Requirement 7: Prohibit EWRC near coast; env-based duration (12-18h / 24-36h / 19-25h); failure penalty logic
      let ewrcFailureRestoredVmax: number | null = null;
      const minorIslandEWRCZone = isMinorIslandOperationalInfluenceZone(newLat, newLon);
      const meaningfulEWRCGroundContact = metrics.isLand && !isMinorIslandOperationalIgnored(newLat, newLon);
      const isNearCoastForEWRC = meaningfulEWRCGroundContact || (!minorIslandEWRCZone && landContactHours > 1.5);
      
      if (playgroundMode) {
        // Playground mode explicitly suppresses secondary-eyewall replacement and clears any
        // in-progress/manual cycle so lowering the target later returns cleanly to normal physics.
        ewrcState = "none";
        ewrcProgress = 0;
        ewrcCooldownHours = 0;
        ty.ewrcIsFailure = false;
        ty.ewrcFailurePenaltyHours = 0;
        ty.ewrcPenaltyTotalHours = 0;
        ty.secondaryEyewallStrength = 0;
        delete ty.forcedEWRC;
        delete ty.manualEwrcOutcomeOverride;
      }
      // `forcedEWRC` is only a one-shot request that starts a new cycle.  The separate manual
      // outcome lock survives after that request is consumed, so the physics engine cannot later
      // reverse an explicit user success/failure decision during the same EWRC episode.
      const manualEwrcOutcomeOverride = playgroundMode ? undefined : ty.manualEwrcOutcomeOverride;
      const forcedEWRCOutcome = playgroundMode ? undefined : ty.forcedEWRC;
      const hasForcedEWRC = forcedEWRCOutcome !== undefined;
      if (hasForcedEWRC) {
        ewrcState = "none";
        ewrcCooldownHours = 0;
      }
      if (manualEwrcOutcomeOverride && (ewrcState === "forming" || ewrcState === "max_decay" || ewrcState === "recovering_success" || ewrcState === "recovering_failure" || ewrcState === "penalty_failure")) {
        ty.ewrcIsFailure = manualEwrcOutcomeOverride === "failure";
      }
      
      if (!playgroundMode && (hasForcedEWRC || (config.ewrcTrigger !== "off" && !isNearCoastForEWRC && ewrcCooldownHours <= 0))) {
        const canForce = config.ewrcTrigger === "force" && ewrcState === "none" && ty.vmax >= 55.0;
        
        // Treat EWRC occurrence as an hourly hazard, not a per-model-step probability. The old
        // ~8-14% probability every ~10 minutes made almost every cyclone hit an ERC as soon as it
        // reached ~55 m/s, repeatedly forcing “center structure repair” and creating an artificial
        // intensity wall. Typical major-hurricane cycles now occur on multi-day timescales, with
        // frequency increasing smoothly at extreme intensity. An explicit user-forced RI burst is
        // allowed to finish before an automatic ERC can interrupt it.
        const ewrcHourlyHazard = ty.vmax >= 55.0
          ? Math.min(0.045, 0.012 + Math.max(0, ty.vmax - 55.0) * 0.0012)
          : 0.0;
        const ewrcStepProbability = 1 - Math.pow(1 - ewrcHourlyHazard, Math.max(0.01, stepFraction));
        const canAuto = config.ewrcTrigger === "auto" && ewrcState === "none" && ty.vmax >= 55.0 &&
          vmaxDeltaPerHour > 0 && !ty.forcedRapidIntensification && this.prng.next() < ewrcStepProbability;

        if (hasForcedEWRC || canForce || canAuto) {
          const envQuality = Math.max(0, Math.min(1.0, (sstVal - 26.0) / 3.0 - shearVal / 22.0 + rhVal / 200.0));
          
          ewrcState = "forming";
          ewrcProgress = 0;
          
          // EWRC duration responds to environment and vortex intensity.  A successful replacement
          // in clean open-ocean conditions is faster; disrupted/failed cycles linger longer.
          const intensityLoad = clamp01((ty.vmax - 50.0) / 25.0);
          let dur = 18.0 + this.prng.next() * 7.0 + intensityLoad * 3.0;
          if (envQuality >= 0.82) {
            dur = 14.0 + this.prng.next() * 6.0 + intensityLoad * 2.0;
          } else if (envQuality < 0.35 || isNearCoastForEWRC) {
            dur = 24.0 + this.prng.next() * 10.0 + intensityLoad * 3.0;
          }
          if (forcedEWRCOutcome === "failure") dur *= 1.10;
          ewrcDuration = Math.max(14.0, Math.min(38.0, dur));
          ewrcWeakenAmount = 3.5 + intensityLoad * 3.5 + (1.0 - envQuality) * 3.0 + this.prng.next() * 1.8;
          ewrcColdWakeHours = 0;
          ewrcL12LandHours = 0;
          ewrcStartVmax = ty.vmax;
          ewrcStartRmw = Math.max(8.0, Math.min(90.0, ty.rmw || rmw || 30));
          ewrcExtraAdjust = 0;
          ewrcFailureMode = "none";
          ewrcRecoveryDuration = 8.0 + this.prng.next() * 6.0;
          
          if (hasForcedEWRC && forcedEWRCOutcome !== "auto") {
            const userLockedOutcome = manualEwrcOutcomeOverride ?? forcedEWRCOutcome;
            ty.ewrcIsFailure = userLockedOutcome === "failure";
            delete ty.forcedEWRC;
          } else if (manualEwrcOutcomeOverride) {
            ty.ewrcIsFailure = manualEwrcOutcomeOverride === "failure";
          } else {
            // Pre-determine failure chance based on environment (mostly success in favorable open ocean)
            let failProb = 0.10 + Math.max(0, (0.75 - envQuality) * 0.4);
            if (isNearCoastForEWRC || ewrcL12LandHours > 0) failProb += 0.40;
            if (shearVal > 18.0) failProb += 0.25;
            
            ty.ewrcIsFailure = (this.prng.next() < failProb);
            if (hasForcedEWRC) delete ty.forcedEWRC;
          }
          ty.ewrcCount = (ty.ewrcCount || 0) + 1;
          
          logs.push({
            id: `ewrc-start-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "warning",
            message: `🌀 眼墙置换启动：${ty.name} 达到 ${getWindForceCategory(ty.vmax)} 级，启动第 ${(ty.ewrcCount)} 次眼墙置换 (EWRC)。预计周期 ${ewrcDuration.toFixed(1)}h，外围风圈收缩，强度暂时回落。`
          });
        }
      }

      if (ewrcState === "forming" || ewrcState === "max_decay") {
        ewrcProgress += stepFraction / ewrcDuration;
        
        // Continuous, phase-dependent intensity response during replacement.  Weakening is modest
        // while the outer eyewall first forms, strongest around the double-eyewall transition, then
        // eases as the new primary eyewall contracts.
        const ewrcPhasePulse = 0.45 + 0.85 * Math.pow(Math.sin(Math.PI * clamp01(ewrcProgress)), 1.25);
        const weakenRate = (ewrcWeakenAmount / ewrcDuration) * ewrcPhasePulse;
        vmaxDeltaPerHour -= weakenRate;

        // Track Cold Water Upwelling time during EWRC
        if (coldWaterDecay > 0.02 && upwellingCooling > 0.9 && ohcVal < 70.0) {
          ewrcColdWakeHours += stepFraction;
        } else {
          ewrcColdWakeHours = Math.max(0, ewrcColdWakeHours - stepFraction * 0.35);
        }
        
        // Track land scraping / contact during EWRC
        const isCoreLandScraping = meaningfulEWRCGroundContact || (!minorIslandEWRCZone && landContactHours > 1.0);
        if (isCoreLandScraping) {
          ewrcL12LandHours += stepFraction;
        }
        
        // The old inner maximum stays dominant early; later the contracting secondary maximum
        // becomes primary at a larger radius. A complete ERC usually leaves a broader RMW instead
        // of resetting every storm to an unrealistically tiny 16-22 km ring.
        const ewrcStartRadius = Math.max(8.0, Math.min(90.0, ewrcStartRmw));
        const replacementExpansion = 1.34 + 0.26 * clamp01((ewrcStartVmax - 45) / 25);
        if (ewrcProgress < 0.52) {
          if (ewrcState !== "forming") { ewrcState = "forming"; }
          const p = smoothstep01(ewrcProgress / 0.52);
          const rmwTarget = ewrcStartRadius * (1.0 + 0.18 * p);
          rmw += (rmwTarget - rmw) * clamp01(stepFraction / 2.8);
        } else {
          if (ewrcState !== "max_decay") { ewrcState = "max_decay"; }
          const p = smoothstep01((ewrcProgress - 0.52) / 0.48);
          const takeoverTarget = ewrcStartRadius * (1.18 + (replacementExpansion - 1.18) * p);
          rmw += (takeoverTarget - rmw) * clamp01(stepFraction / 2.2);
        }
        rmw = Math.max(8.0, Math.min(90.0, rmw));
        
        const isSevereLandFail = isCoreLandScraping && ewrcProgress >= 0.1;
        const isSevereShearFail = shearVal > 25.0 && ewrcProgress >= 0.1;
        const isSevereVentilationFail = ewrcProgress >= 0.1 && dryAirCoreConnection > 0.58 &&
          dryAirVentilationIndex > 0.54 && (shearVal > 17.0 || dryAirCoreExposure > 0.62);
        const isSevereSSTFail = sstVal < 25.0 && ewrcProgress >= 0.1;
        const isColdWaterFail = (ewrcColdWakeHours / ewrcDuration >= 0.55) && ewrcProgress >= 0.18;

        const automaticFailureAllowed = manualEwrcOutcomeOverride !== "success";
        if (automaticFailureAllowed && (isSevereLandFail || isSevereShearFail || isSevereVentilationFail || isSevereSSTFail || isColdWaterFail)) {
          const envQuality = Math.max(0, Math.min(1.0, (sstVal - 26.0) / 3.0 - shearVal / 22.0 + rhVal / 200.0));
          ewrcState = "penalty_failure";
          const failurePhase = clamp01(ewrcProgress);
          if (isSevereVentilationFail) {
            ewrcFailureMode = failurePhase < 0.52 ? "outer_ring_fractures" : "double_eyewall_decay";
          } else if (isSevereShearFail) {
            ewrcFailureMode = failurePhase < 0.62 ? "outer_ring_fractures" : "double_eyewall_decay";
          } else if (isSevereLandFail) {
            ewrcFailureMode = failurePhase < 0.45 ? "outer_ring_fractures" : "inner_collapse_outer_stalls";
          } else if (isSevereSSTFail || isColdWaterFail) {
            ewrcFailureMode = failurePhase >= 0.55 ? "inner_collapse_outer_stalls" : "double_eyewall_decay";
          } else {
            ewrcFailureMode = "double_eyewall_decay";
          }
          ewrcProgress = 0;
          const ewrcScarTarget = ewrcFailureMode === "inner_collapse_outer_stalls" ? 0.68 : ewrcFailureMode === "outer_ring_fractures" ? 0.54 : 0.62;
          coreRebuildScar = Math.max(coreRebuildScar, ewrcScarTarget);
          damageOrigin = damageOrigin === "none" || damageOrigin === "ewrc_failure" ? "ewrc_failure" : "mixed";
          
          // Failed replacement produces a prolonged structural penalty rather than an instantaneous
          // wind-speed cliff.  The intensity loss is integrated continuously below.
          const intensityRatio = Math.max(1.0, ty.vmax / 38.0);
          ty.ewrcPenaltyTotalHours = Math.min(34.0, (12.0 + (1.0 - envQuality) * 13.0) * Math.pow(intensityRatio, 0.55));
          ty.ewrcFailurePenaltyHours = 0;
          const expectedLoss = Math.min(13.0, 3.5 + (1.0 - envQuality) * 5.0 + clamp01((ty.vmax - 40.0) / 30.0) * 4.0);
          
          let failReason = "核心接触陆地地形受损";
          if (isSevereVentilationFail) failReason = `干空气-风切通风贯穿内核（连接度${Math.round(dryAirCoreConnection*100)}%）`;
          else if (isSevereShearFail) failReason = `强风切(${Math.round(shearVal)}kt)撕裂外围眼墙`;
          else if (isSevereSSTFail) failReason = `低海温(${sstVal.toFixed(1)}℃)潜热供给不足`;
          else if (isColdWaterFail) failReason = `冷水上翻强烈`;

          logs.push({
            id: `ewrc-fail-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "danger",
            message: `🌀 置换宣告崩溃：${ty.name} 由于【${failReason}】，双眼墙结构无法完成接替。预计未来 ${ty.ewrcPenaltyTotalHours.toFixed(1)}h 持续受抑，累计强度损失可达约 ${expectedLoss.toFixed(1)}m/s，随后进入缓慢重组。`
          });
        } else if (ewrcProgress >= 1.0) {
          const envQuality = Math.max(0, Math.min(1.0, (sstVal - 26.0) / 3.0 - shearVal / 22.0 + rhVal / 200.0));
          ewrcProgress = 0;
          
          const cycleIsFailure = manualEwrcOutcomeOverride
            ? manualEwrcOutcomeOverride === "failure"
            : !!ty.ewrcIsFailure;
          ty.ewrcIsFailure = cycleIsFailure;

          if (!cycleIsFailure) {
            successfulEwrcCount += 1;
            ewrcState = "recovering_success";
            ewrcFailureMode = "none";

            // A successful EWRC has just established a coherent replacement eyewall.  Older builds
            // could keep a generic `isStructureDamaged`/coreRebuildScar latch alive across this
            // transition (especially when RI/ERI overlapped the final replacement hours), causing
            // an otherwise healthy storm to enter the “中心结构修复中” penalty immediately after a
            // successful cycle.  Preserve *real* independent damage, but retire stale reorganization
            // memory when no terrain/core-ventilation failure is physically present.
            const independentCoreDamageAfterEwrc =
              !!ty.isCoreDisrupted ||
              metrics.isLand || terrainCoreLandFraction > 0.085 || terrainMountainFraction > 0.035 ||
              terrainHollowCoreMemory >= 0.12 ||
              ty.forcedDryAir === "core" ||
              (ty.forcedShear !== undefined && ty.forcedShear >= 26.0) ||
              (ventilationScarTarget >= 0.80 && dryAirCoreExposure >= 0.48) ||
              structuralDamagePenaltyFactor <= 0.72;
            if (!independentCoreDamageAfterEwrc) {
              isStructureDamaged = false;
              ty.isStructureDamaged = false;
              ty.isCoreDisrupted = false;
              structuralDamagePenaltyFactor = Math.max(structuralDamagePenaltyFactor, 0.965);
              // A small residual is retained for smooth eye/RMW geometry, but it stays below the
              // dynamical damage thresholds and therefore cannot masquerade as a damage penalty.
              coreRebuildScar = Math.min(coreRebuildScar, 0.26);
              if (damageOrigin === "ewrc_failure") damageOrigin = "none";
              if (damageOrigin === "shear_dry" && ventilationScarTarget < 0.58 && dryAirCoreExposure < 0.32) {
                damageOrigin = "none";
              }
              if (!penaltyRecoveryActive && !ty.forcedDryAir && ty.forcedShear === undefined) {
                delete ty.cloggedRecoveryHours;
                delete ty.cloggedRecoveryTotalHours;
              }
            }

            const intensityLoad = clamp01((ty.vmax - 45.0) / 30.0);
            ewrcRecoveryDuration = Math.max(10.0, Math.min(24.0, 10.0 + (1.0 - envQuality) * 8.0 + intensityLoad * 4.0));
            let extraRise = 1.0 + envQuality * 2.8 + this.prng.next() * 1.2;
            if (isAutomaticPeakIntensityActive(config)) {
              // The first successful replacement commonly has the best lifetime-peak opportunity.
              // Later cycles preferentially broaden the vortex and recover a similar/slightly lower
              // Vmax, unless the environment has genuinely improved. This remains probabilistic.
              const cycleRecoveryFactor = successfulEwrcCount <= 1
                ? (1.04 + 0.06 * envQuality)
                : Math.max(0.70, 1.0 - 0.075 * (successfulEwrcCount - 1) + 0.05 * envQuality);
              extraRise *= cycleRecoveryFactor;
            }
            if (isTargetIntensityCapActive(config) && config.maxIntensityLimit) {
              const target = config.maxIntensityLimit;
              const gap = Math.max(0, target - ty.vmax);
              extraRise = Math.min(extraRise, Math.max(0.8, gap * 0.20));
            }
            const recoverableLoss = ewrcWeakenAmount * (0.45 + 0.25 * envQuality);
            ewrcExtraAdjust = Math.min(0.72, (recoverableLoss + extraRise) / ewrcRecoveryDuration);
            
            logs.push({
              id: `ewrc-success-${ty.id}-${currentSimHour}`,
              time: new Date(),
              simHour: currentSimHour,
              type: "success",
              message: `🌀 置换宣告成功：${ty.name} 第 ${ty.ewrcCount || 1} 次眼墙置换完成，新主眼墙开始收缩并重新轴对称化。预计未来 ${ewrcRecoveryDuration.toFixed(1)}h 逐步恢复，环境允许时可额外增强约 ${extraRise.toFixed(1)}m/s。`
            });
          } else {
            // Failure: no clean replacement. A late-cycle failure is classified by how the
            // secondary ring behaves rather than treated as one generic collapse.
            ewrcState = "penalty_failure";
            if (shearVal >= 21.0 || rhVal < 50.0) ewrcFailureMode = "double_eyewall_decay";
            else if (outflowEfficiency < 0.43) ewrcFailureMode = "outer_ring_fractures";
            else ewrcFailureMode = "inner_collapse_outer_stalls";
            coreRebuildScar = Math.max(coreRebuildScar, ewrcFailureMode === "inner_collapse_outer_stalls" ? 0.66 : 0.56);
            damageOrigin = damageOrigin === "none" || damageOrigin === "ewrc_failure" ? "ewrc_failure" : "mixed";
            
            // Failed replacement transitions into a continuous structural-decay phase.
            const intensityRatio = Math.max(1.0, ty.vmax / 38.0);
            ty.ewrcPenaltyTotalHours = Math.min(34.0, (12.0 + (1.0 - envQuality) * 13.0) * Math.pow(intensityRatio, 0.55));
            ty.ewrcFailurePenaltyHours = 0;
            const expectedLoss = Math.min(13.0, 3.5 + (1.0 - envQuality) * 5.0 + clamp01((ty.vmax - 40.0) / 30.0) * 4.0);
            
            logs.push({
              id: `ewrc-failed-${ty.id}-${currentSimHour}`,
              time: new Date(),
              simHour: currentSimHour,
              type: "danger",
              message: `🌀 置换宣告失败：${ty.name} 第 ${ty.ewrcCount || 1} 次置换未能建立稳定的新主眼墙。未来约 ${ty.ewrcPenaltyTotalHours.toFixed(1)}h 将持续受抑，预计累计损失约 ${expectedLoss.toFixed(1)}m/s，而非瞬时跳降。`
            });
          }
        }
      } else if (ewrcState === "recovering_success") {
        ewrcProgress += stepFraction / ewrcRecoveryDuration;
        vmaxDeltaPerHour += ewrcExtraAdjust;
        // After takeover the new primary wall contracts, but normally remains wider than the old
        // pre-ERC eyewall. This creates a real eye/RMW size cycle rather than a fixed eye.
        const recoveryP = smoothstep01(clamp01(ewrcProgress));
        const postEwrcRmwTarget = Math.max(10.0, Math.min(80.0, ewrcStartRmw * (1.36 - 0.12 * recoveryP)));
        rmw += (postEwrcRmwTarget - rmw) * clamp01(stepFraction / 4.5);
        
        if (ewrcProgress >= 1.0) {
          ewrcState = "none";
          ewrcProgress = 0;
          ewrcCooldownHours = 36.0;
          ty.ewrcIsFailure = false;
          delete ty.manualEwrcOutcomeOverride;
          logs.push({
            id: `ewrc-recovery-done-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "info",
            message: `🌀 结构稳定：${ty.name} 眼墙置换成功后的恢复期结束，风场结构进入成熟阶段。`
          });
        }
      } else if (ewrcState === "recovering_failure" || ewrcState === "penalty_failure") {
        const totalPenalty = ty.ewrcPenaltyTotalHours || 12.0;
        let penaltyHours = (ty.ewrcFailurePenaltyHours || 0) + stepFraction;
        ty.ewrcFailurePenaltyHours = penaltyHours;

        // Failed EWRC: delayed structural decay with a broad peak, modulated by the current
        // environment.  This replaces the old constant-rate penalty and avoids abrupt transitions.
        const currentV = Math.max(24.0, ty.vmax);
        const intensityFactor = 0.85 + 0.45 * clamp01((currentV - 30.0) / 40.0);
        const penaltyProgress = clamp01(penaltyHours / Math.max(1.0, totalPenalty));
        const failurePulse = 0.08 + 1.04 * Math.pow(Math.max(0, Math.sin(Math.PI * penaltyProgress)), 1.46);
        const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
        const failureDecayRate = -(0.22 + adversity * 0.20) * intensityFactor * failurePulse;

        vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, failureDecayRate);
        ty.isEyeClogged = true;
        ty.isStructureDamaged = true;
        isStructureDamaged = true;

        if (penaltyHours >= totalPenalty) {
          ewrcState = "none";
          ewrcProgress = 0;
          ewrcCooldownHours = 36.0;
          ty.ewrcIsFailure = false;
          delete ty.forcedEWRC;
          delete ty.manualEwrcOutcomeOverride;
          ty.ewrcFailurePenaltyHours = 0;
          ty.ewrcPenaltyTotalHours = 0;
          
          // Initiate gradual structure recovery phase with core destruction inertia (scaled by intensity)
          ty.cloggedRecoveryTotalHours = Math.min(48.0, 28.0 * Math.max(1.0, ty.vmax / 45.0));
          ty.cloggedRecoveryHours = 0.0;
          
          logs.push({
            id: `ewrc-penalty-done-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "info",
            message: `🌀 惩罚期结束：${ty.name} 置换失败后的 ${totalPenalty.toFixed(1)}h 核心区抑制期结束，中心风眼结构开始缓慢重塑，台风增强速度将随结构稳固逐渐上升恢复。`
          });
        }
      }

      // --- Master Manual Intervention, Penalty, and Gradual Recovery System ---

      // Persistently inject user-drawn dry-air polygons into the *live* simulation. Forecast
      // guidance already sampled these regions, but the main integration loop never refreshed the
      // corresponding dry-air penalty state, so saved polygons could appear to do nothing. While a
      // centre remains inside a polygon, keep the episode alive and continuously feed the same
      // structural/dryness state variables that the rest of the intensity/structure model uses.
      const manualDryAirSeverity = getManualDryAirRegionSeverity(config, newLat, newLon);
      const manualRegionSource = (ty as any).manualDryAirRegionActive === true;
      const ewrcDryWindow = ewrcState === "forming" || ewrcState === "max_decay" || ewrcState === "recovering_success" || ewrcState === "recovering_failure" || ewrcState === "penalty_failure";
      const structureIntegrity = clamp01(
        0.34 * previousEyewallIntegrity + 0.26 * coreCompactness +
        0.20 * (1.0 - coreRebuildScar) + 0.20 * (1.0 - structuralDisorganization)
      );
      const dryStructureVulnerability = clamp01(1.0 - structureIntegrity);
      // Every real entry produces at least some entrainment. A damaged vortex is easier to ventilate,
      // while EWRC opens a particularly efficient pathway between the environment and the inner core.
      const effectiveManualDry = clamp01(manualDryAirSeverity * (0.94 + 0.74 * dryStructureVulnerability) * (ewrcDryWindow ? 1.40 : 1.0));
      if (effectiveManualDry > 0.015) {
        if (!manualRegionSource) {
          const coreChance = ewrcDryWindow
            ? clamp01(0.70 + 0.20 * effectiveManualDry + 0.10 * dryStructureVulnerability)
            : clamp01(0.08 + 0.56 * effectiveManualDry + 0.28 * dryStructureVulnerability);
          (ty as any).manualDryAirCoreLatch = this.prng.next() < coreChance;
        }
        const regionForcesCore = ty.forcedDryAir === "core" || (ty as any).manualDryAirCoreLatch === true || effectiveManualDry >= (ewrcDryWindow ? 0.34 : 0.76);
        const regionType = regionForcesCore ? "core" : "periphery";
        if (!ty.forcedDryAir || manualRegionSource || (regionType === "core" && ty.forcedDryAir !== "core")) ty.forcedDryAir = regionType;
        const pulseHours = regionForcesCore ? 5.0 + effectiveManualDry * 8.8 : 3.0 + effectiveManualDry * 6.2;
        const totalHours = regionForcesCore ? 22.0 + effectiveManualDry * 22.0 : 12.0 + effectiveManualDry * 14.0;
        ty.dryAirPenaltyTotalHours = Math.max(Number(ty.dryAirPenaltyTotalHours || 0), totalHours);
        ty.dryAirPenaltyHours = Math.max(Number(ty.dryAirPenaltyHours || 0), pulseHours);
        dryAirIntrusion = Math.max(dryAirIntrusion, 0.20 + effectiveManualDry * 0.82);
        dryAirCoreExposure = Math.max(dryAirCoreExposure, regionForcesCore ? 0.42 + effectiveManualDry * 0.50 : 0.14 + effectiveManualDry * 0.32);
        dryAirWrapFraction = Math.max(dryAirWrapFraction, 0.16 + effectiveManualDry * (ewrcDryWindow ? 0.62 : 0.50));
        structuralDisorganization = Math.max(structuralDisorganization, 0.12 + effectiveManualDry * (0.18 + 0.18 * dryStructureVulnerability));
        (ty as any).manualDryAirRegionActive = true;
        (ty as any).manualDryAirRegionSeverity = effectiveManualDry;
      } else if (manualRegionSource) {
        (ty as any).manualDryAirRegionActive = false;
        (ty as any).manualDryAirRegionSeverity = 0;
        delete (ty as any).manualDryAirCoreLatch;
      }

      // User-drawn strong-shear polygons participate in the same persistent intervention system as
      // hand-drawn dry air. The instantaneous environmental shear was already raised before the
      // intensity calculation; this keeps a structural-memory tail after the centre leaves the area.
      const manualShearRegionSource = (ty as any).manualShearRegionActive === true;
      if (manualShearInfluence.shearKt > 15.1) {
        ty.forcedShear = Math.max(Number(ty.forcedShear || 0), manualShearInfluence.shearKt);
        const shearPulseHours = 5.5 + 8.5 * manualShearInfluence.severity;
        const shearTotalHours = 22.0 + 22.0 * manualShearInfluence.severity;
        ty.shearPenaltyTotalHours = Math.max(Number(ty.shearPenaltyTotalHours || 0), shearTotalHours);
        ty.shearPenaltyHours = Math.max(Number(ty.shearPenaltyHours || 0), shearPulseHours);
        (ty as any).manualShearRegionActive = true;
      } else if (manualShearRegionSource) {
        (ty as any).manualShearRegionActive = false;
      }
      
      let forcedDecayTotal = 0;

      // Scheduled cold-air outbreak. The selected arrival hour is the actual centre encounter:
      // the wind-product strong-wind front and the intensity response use the same clock. The
      // weakening response is intentionally nonlinear and fast: it begins gently at contact, then
      // accelerates sharply to full effect over roughly two simulated hours. After the surge core
      // passes, direct forcing fades; any structural damage already produced recovers separately.
      const coldAirStrength = Number(ty.forcedColdAirStrength || 0);
      const coldAirArrivalHour = Number(ty.forcedColdAirArrivalHour);
      const coldAirScheduled = coldAirStrength >= 1 && coldAirStrength <= 3 && Number.isFinite(coldAirArrivalHour);
      const coldAirCenterContactHour = coldAirScheduled ? getColdAirCenterContactHour(coldAirArrivalHour) : Number.POSITIVE_INFINITY;
      const coldAirExposure = coldAirScheduled ? currentSimHourFloat - coldAirCenterContactHour : -Infinity;
      const coldAirDurationHours = coldAirScheduled ? [0, 18, 26, 34][coldAirStrength] : 0;
      const coldAirAttackPhase = coldAirExposure >= 0 ? clamp01((coldAirExposure + 0.20) / 1.90) : 0;
      const coldAirOnset = Math.pow(coldAirAttackPhase, 2.15);
      const coldAirRelease = coldAirExposure >= 0
        ? 1 - smoothstep01((coldAirExposure - (coldAirDurationHours - 10)) / 10)
        : 0;
      const coldAirPulse = coldAirScheduled && coldAirExposure >= 0 && coldAirExposure <= coldAirDurationHours
        ? clamp01(coldAirOnset * coldAirRelease)
        : 0;
      // Stage-3 cyclone weakening remains at the calibrated 80% thermodynamic/structural load.
      // This response scale is independent of the corrected ~32 kt wind-field target.
      const coldAirImpactScale = coldAirStrength === 3 ? 0.80 : 1.0;
      const coldAirEffectPulse = coldAirPulse * coldAirImpactScale;
      const coldAirActive = coldAirEffectPulse > 0.01;
      let coldAirWarmCoreDamage = clamp01(Number(ty.coldAirWarmCoreDamage || 0));
      let coldAirWarmCoreDestroyed = !!ty.coldAirWarmCoreDestroyed;
      if (coldAirScheduled) {
        ty.coldAirExposureHours = Math.max(0, coldAirExposure);
      }
      if (coldAirStrength === 3 && coldAirActive && !coldAirWarmCoreDestroyed) {
        // ROUND103: a strong outbreak can physically erase the tropical warm-core reservoir.
        // Damage accumulates over several hours of core exposure; it is not an instantaneous switch.
        // Once the warm core is gone the state is irreversible: cancelling the forcing later does
        // not recreate a tropical heat engine.
        const warmCoreAttack = coldAirEffectPulse * (0.82 + 0.18 * smoothstep01((ty.vmax - 17.2) / 38.0));
        coldAirWarmCoreDamage = clamp01(coldAirWarmCoreDamage + warmCoreAttack * stepFraction / 7.6);
        if (coldAirWarmCoreDamage >= 0.965) {
          coldAirWarmCoreDamage = 1;
          coldAirWarmCoreDestroyed = true;
          ty.coldAirWarmCoreDestroyed = true;
          ty.isEyeClogged = true;
          ty.isStructureDamaged = true;
          isStructureDamaged = true;
          coreRebuildScar = Math.max(coreRebuildScar, 0.92);
          structuralDisorganization = Math.max(structuralDisorganization, 0.96);
          convectiveSuppression = Math.max(convectiveSuppression, 0.96);
          delete ty.forcedRapidIntensification;
          delete ty.forcedRapidIntensificationMode;
          ty.rapidEpisodeAbortRequested = true;
          logs.push({
            id: `cold-air-warm-core-destroyed-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "danger",
            message: `❄️ 暖心被摧毁：${ty.name} 遭 32 kt 强冷空气持续侵入后热带暖心彻底瓦解，闭合台风涡旋随即崩解为残留低压云团；不会进入副热带或温带气旋阶段，之后仅按既有减弱速度继续消散。`
          });
        }
      } else if (!coldAirWarmCoreDestroyed && coldAirWarmCoreDamage > 0 && !coldAirActive) {
        // Partial cooling may recover if the warm core was not fully destroyed.
        coldAirWarmCoreDamage = Math.max(0, coldAirWarmCoreDamage - stepFraction / 72.0);
      }
      ty.coldAirWarmCoreDamage = coldAirWarmCoreDamage;
      ty.coldAirWarmCoreDestroyed = coldAirWarmCoreDestroyed || undefined;
      if (coldAirActive) {
        const pulse = coldAirEffectPulse;
        const intensityLoad = smoothstep01((ty.vmax - 22) / 40);
        const baseLoss = [0, 0.85, 1.75, 3.20][coldAirStrength];
        forcedDecayTotal -= baseLoss * (0.72 + 0.55 * intensityLoad) * pulse;
        convectiveSuppression = Math.max(convectiveSuppression, [0, 0.38, 0.64, 0.88][coldAirStrength] * pulse);
        structuralDisorganization = Math.max(structuralDisorganization, [0, 0.24, 0.48, 0.78][coldAirStrength] * pulse);
        if (coldAirStrength >= 2 && pulse > 0.35) {
          ty.isEyeClogged = true;
          isStructureDamaged = true;
          ty.isStructureDamaged = true;
          const scarTarget = (coldAirStrength === 3 ? 0.84 : 0.58) * coldAirImpactScale;
          coreRebuildScar += Math.max(0, scarTarget - coreRebuildScar) * clamp01(stepFraction / (coldAirStrength === 3 ? 2.0 : 4.0));
          damageOrigin = damageOrigin === "none" || damageOrigin === "shear_dry" ? "shear_dry" : "mixed";
        }
        if (coldAirStrength === 3 && pulse > 0.28) {
          dryAirIntrusion = Math.max(dryAirIntrusion, (0.58 + 0.30 * coldAirPulse) * coldAirImpactScale);
          dryAirCoreExposure = Math.max(dryAirCoreExposure, (0.50 + 0.35 * coldAirPulse) * coldAirImpactScale);
        }
      }

      // 1. Dry Air Manual Penalty
      if (ty.forcedDryAir) {
        const isCore = ty.forcedDryAir === "core";
        if (ty.dryAirPenaltyHours === undefined || ty.dryAirPenaltyHours === null || !ty.dryAirPenaltyTotalHours) {
          const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
          const backgroundMoisture = clamp01((getRH700(newLat, newLon, config, currentSimHourFloat) - 45.0) / 35.0);
          const durationBase = isCore ? 22.0 : 18.0;
          const durationSpread = isCore ? 12.0 : 10.0;
          // A powerful warm-core vortex can spend roughly two days ventilating/reorganizing; a weak
          // system reacts much less violently even when its LLCC becomes exposed.
          const total = durationBase + durationSpread * (0.18 + 0.62 * intensityLoad + 0.20 * backgroundMoisture);
          ty.dryAirPenaltyTotalHours = Math.max(isCore ? 32.0 : 28.0, Math.min(isCore ? 52.0 : 48.0, total));
          ty.dryAirPenaltyHours = ty.dryAirPenaltyTotalHours;
        }

        const pulse = interventionPulse(ty.dryAirPenaltyHours, ty.dryAirPenaltyTotalHours);
        const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
        const structuralVulnerability = ty.isStructureDamaged ? 1.18 : 1.0;
        const shearSynergy = 1.0 + clamp01((shearVal - 12.0) / 20.0) * 0.42;
        const dryContrast = clamp01((64.0 - rhVal) / 30.0);
        const warmOceanBuffer = 1.0 - (1.0 - intensityLoad) * atmosphericStress.oceanSupport * (isCore ? 0.28 : 0.62);
        // Absolute loss rises strongly with intensity: ~28 m/s core intrusion is typically a slow
        // multi-day erosion, while a 60+ m/s vortex can lose around twenty m/s over ~48 h if dry
        // air is continuously mixed into the eyewall. Peripheral entrainment is much gentler.
        const baseRate = isCore
          ? 0.048 + 0.28 * intensityLoad
          : 0.014 + 0.10 * intensityLoad;
        const dvorakDryDecayGate = smoothstep01((ty.vmax - 32.7) / 9.0);
        const dryAirRate = -baseRate * (0.20 + 0.80 * pulse) * (0.76 + 0.42 * dryContrast) * structuralVulnerability * shearSynergy * warmOceanBuffer * dvorakDryDecayGate;
        forcedDecayTotal += dryAirRate;

        if (isCore && pulse > 0.45 && establishedCoreAtStepStart && dvorakDryDecayGate > 0.04) {
          ty.isEyeClogged = true;
          dryAirIntrusion = Math.max(dryAirIntrusion, 0.62 + 0.28 * pulse);
          convectiveSuppression = Math.max(convectiveSuppression, 0.60 + 0.25 * pulse);
          isStructureDamaged = coreRebuildScar > 0.34 || dryAirIntrusion > 0.78;
          const dryScarTarget = clamp01(0.48 + 0.34 * intensityLoad + 0.18 * pulse);
          coreRebuildScar += Math.max(0, dryScarTarget - coreRebuildScar) * clamp01(stepFraction / 5.5);
          damageOrigin = damageOrigin === "none" || damageOrigin === "shear_dry" ? "shear_dry" : "mixed";
        }

        ty.dryAirPenaltyHours = Math.max(0, ty.dryAirPenaltyHours - stepFraction);

        if (ty.dryAirPenaltyHours <= 0) {
          const totalH = ty.dryAirPenaltyTotalHours || (isCore ? 24 : 34);
          delete ty.forcedDryAir;
          delete ty.dryAirPenaltyHours;
          delete ty.dryAirPenaltyTotalHours;
          const recovery = isCore
            ? Math.min(42.0, 20.0 + ty.vmax * 0.24)
            : Math.min(24.0, 10.0 + ty.vmax * 0.12);
          ty.cloggedRecoveryTotalHours = recovery;
          ty.cloggedRecoveryHours = 0.0;
          logs.push({
            id: `dry-air-done-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "info",
            message: `🍂 干空气干扰结束：${ty.name} 经历约 ${totalH.toFixed(0)}h 的${isCore ? "核心侵入" : "外围卷入"}后，低熵空气影响开始消退；核心将在约 ${recovery.toFixed(0)}h 内逐步重新组织。`
          });
        }
      }
      
      // 2. Wind Shear Manual Penalty
      if (ty.forcedShear !== undefined && ty.forcedShear > 15.0) {
        if (ty.shearPenaltyHours === undefined || ty.shearPenaltyHours === null || !ty.shearPenaltyTotalHours) {
          const shearSeverity = clamp01((ty.forcedShear - 16.0) / 22.0);
          const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
          const total = 16.0 + shearSeverity * 14.0 + intensityLoad * 8.0;
          ty.shearPenaltyTotalHours = Math.max(16.0, Math.min(38.0, total));
          ty.shearPenaltyHours = ty.shearPenaltyTotalHours;
        }
        
        const pulse = interventionPulse(ty.shearPenaltyHours, ty.shearPenaltyTotalHours);
        const shearSeverity = clamp01((ty.forcedShear - 15.0) / 22.0);
        const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
        const moistureVulnerability = 0.78 + clamp01((62.0 - rhVal) / 28.0) * 0.42;
        const structureVulnerability = ty.isStructureDamaged ? 1.18 : 1.0;
        const warmWeakBuffer = 1.0 - (1.0 - intensityLoad) * atmosphericStress.oceanSupport * 0.52;
        // Moderate shear can merely suppress development in a weak, warm-water system. Severe shear
        // or the same shear acting on an intense expanded vortex produces a larger absolute wind loss.
        const shearStructuralRate = -(0.022 + 0.34 * Math.pow(shearSeverity, 1.35) * (0.38 + 0.98 * intensityLoad)) * (0.20 + 0.80 * pulse) * moistureVulnerability * structureVulnerability * warmWeakBuffer;
        forcedDecayTotal += shearStructuralRate;

        if (pulse > 0.40 && ty.forcedShear >= 22.0 && establishedCoreAtStepStart) {
          ty.isEyeClogged = true;
          ty.isStructureDamaged = true;
          isStructureDamaged = true;
          const shearScarTarget = clamp01(0.38 + 0.46 * shearSeverity + 0.12 * intensityLoad);
          coreRebuildScar += Math.max(0, shearScarTarget - coreRebuildScar) * clamp01(stepFraction / 5.0);
          damageOrigin = damageOrigin === "none" || damageOrigin === "shear_dry" ? "shear_dry" : "mixed";
        }

        ty.shearPenaltyHours = Math.max(0, ty.shearPenaltyHours - stepFraction);

        if (ty.shearPenaltyHours <= 0) {
          const totalH = ty.shearPenaltyTotalHours || 18;
          const severity = clamp01((ty.forcedShear - 15.0) / 22.0);
          delete ty.forcedShear;
          delete ty.shearPenaltyHours;
          delete ty.shearPenaltyTotalHours;
          const recovery = Math.min(40.0, 14.0 + severity * 14.0 + ty.vmax * 0.16);
          ty.cloggedRecoveryTotalHours = recovery;
          ty.cloggedRecoveryHours = 0.0;
          logs.push({
            id: `shear-done-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "info",
            message: `⚡ 风切变压制结束：${ty.name} 经历约 ${totalH.toFixed(0)}h 的垂直风切变后，涡旋倾斜与对流非对称逐步减弱；核心预计需约 ${recovery.toFixed(0)}h 重整。`
          });
        }
      }

      // Prohibit Rapid Intensification during active ventilation/shear/EWRC failure. Cold-air
      // suppression is pulse-scaled so the requested slow-then-fast onset remains visible instead
      // of snapping instantly to a full hard floor on the first contact step.
      const otherEnvironmentalSuppressionActive = !!ty.forcedDryAir || (ty.forcedShear !== undefined && ty.forcedShear > 15.0) || ewrcState === "penalty_failure" || ty.ewrcIsFailure;
      const otherHardEnvironmentalSuppression = ty.forcedDryAir === "core" || (ty.forcedShear !== undefined && ty.forcedShear >= 26.0) || ewrcState === "penalty_failure" || !!ty.ewrcIsFailure;
      const isEnvironmentalSuppressionActive = coldAirActive || otherEnvironmentalSuppressionActive;
      const isHardEnvironmentalSuppression = otherHardEnvironmentalSuppression || (coldAirStrength >= 2 && coldAirEffectPulse >= 0.72);

      if (isEnvironmentalSuppressionActive) {
        if (vmaxDeltaPerHour > 0) {
          // Cold air progressively removes favourable oceanic intensification as its intrusion
          // deepens. Other legacy hard suppressors retain their original behaviour.
          if (coldAirActive) {
            const positiveBlock = clamp01([0, 0.55, 0.88, 1.00][coldAirStrength] * coldAirEffectPulse);
            vmaxDeltaPerHour *= 1 - positiveBlock;
          }
          if (otherEnvironmentalSuppressionActive) {
            vmaxDeltaPerHour *= otherHardEnvironmentalSuppression ? 0.0 : 0.08;
          }
        }
        if (forcedDecayTotal < 0) vmaxDeltaPerHour += forcedDecayTotal;

        let suppressionFloor = 0.0;
        if (coldAirActive) {
          suppressionFloor = Math.max(suppressionFloor, [0, 0.35, 0.95, 1.80][coldAirStrength] * coldAirEffectPulse);
        }
        if (otherHardEnvironmentalSuppression) {
          const hardForNonDryReason = (ty.forcedShear !== undefined && ty.forcedShear >= 26.0) || ewrcState === "penalty_failure" || !!ty.ewrcIsFailure;
          if (hardForNonDryReason) suppressionFloor = Math.max(suppressionFloor, 0.012);
          if (ty.forcedDryAir === "core") {
            const p = interventionPulse(ty.dryAirPenaltyHours, ty.dryAirPenaltyTotalHours);
            const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
            const dvorakDryDecayGate = smoothstep01((ty.vmax - 32.7) / 9.0);
            suppressionFloor = Math.max(suppressionFloor, (0.014 + 0.18 * intensityLoad * p) * dvorakDryDecayGate);
          }
          if (ty.forcedShear !== undefined && ty.forcedShear >= 26.0) {
            const p = interventionPulse(ty.shearPenaltyHours, ty.shearPenaltyTotalHours);
            const severity = clamp01((ty.forcedShear - 20.0) / 20.0);
            const intensityLoad = smoothstep01((ty.vmax - 24.0) / 42.0);
            suppressionFloor = Math.max(suppressionFloor, 0.015 + 0.11 * severity * (0.35 + intensityLoad) * p);
          }
          if (ewrcState === "penalty_failure" || ty.ewrcIsFailure) suppressionFloor = Math.max(suppressionFloor, 0.20);
        }
        if (suppressionFloor > 0) vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, -suppressionFloor);
      } else if (forcedDecayTotal < 0) {
        vmaxDeltaPerHour += forcedDecayTotal;
      }
      // 3. Unified RI / ERI episode engine (natural + manual).
      // Manual mode only chooses the class; actual hourly gain is a smooth, fluctuating
      // realization of the corresponding 24-h envelope rather than a fixed straight line.
      const requestedRapidMode = ty.forcedRapidIntensification
        ? (ty.forcedRapidIntensificationMode || ty.rapidIntensificationMode || "ri")
        : (ty.rapidIntensificationMode || "ri");
      // Normal poleward ET may still undergo a user-requested/passive baroclinic burst.  This is
      // physically distinct from tropical RI: once the cyclone has entered the hybrid/subtropical
      // stage, manual burst requests are reinterpreted as baroclinic-assisted deepening.  The only
      // irreversible prohibition is the ROUND103 cold-air warm-core-destruction latch.
      const manualEtBurst = !!ty.forcedRapidIntensification && !coldAirWarmCoreDestroyed &&
        (priorEtTransition >= 0.34 || ty.category === TyphoonCategory.ET);

      const initializeRapidEpisode = (mode: "ri" | "eri" | "uri", isManual: boolean) => {
        rapidIntensifying = true;
        ty.rapidIntensificationMode = mode;
        ty.rapidEpisodeElapsedHours = 0;
        ty.rapidEpisodeExitHours = 0;
        ty.rapidEpisodeExitDuration = undefined;
        ty.rapidEpisodeAbortRequested = false;
        ty.rapidEpisodeStartRate = Math.max(0, vmaxDeltaPerHour);
        ty.rapidEpisodeLastRate = Math.max(0, vmaxDeltaPerHour);

        if (mode === "uri") {
          // User-requested ultra-rapid burst: the established URI envelope, accelerated by 1.3x in 3.6.6.
          // The actual rate oscillates inside URI_RATE_MIN..URI_RATE_MAX after a 2 h ramp-in and exits over 2 h.
          ty.rapidEpisodeDurationHours = 25.0;
          ty.rapidEpisodeTarget24h = 24.0 * this.prng.nextRange(URI_RATE_MIN, URI_RATE_MAX);
        } else if (mode === "eri") {
          // ERI: typically ~24-30 m/s CMA-equivalent / 24 h, lasting 10-20 h.
          // A very small tail permits record-class bursts without making them routine.
          ty.rapidEpisodeDurationHours = 10.0 + this.prng.nextRange(0, 10.0);
          ty.rapidEpisodeTarget24h = this.prng.next() < 0.035
            ? 38.0 + this.prng.nextRange(0, 11.0)
            : 24.0 + this.prng.nextRange(0, 6.0);
        } else {
          // RI: common operational envelope ~15-22 m/s CMA-equivalent / 24 h.
          // Most episodes last 12-24 h; only a small fraction persist 24-36 h.
          const extended = this.prng.next() < (isManual ? 0.07 : 0.09);
          ty.rapidEpisodeDurationHours = extended
            ? 24.0 + this.prng.nextRange(0, 12.0)
            : 12.0 + this.prng.nextRange(0, 12.0);
          ty.rapidEpisodeTarget24h = 15.0 + this.prng.nextRange(0, 7.0);
        }
      };

      // A manual RI/ERI request can take over from an automatically triggered RI episode.
      if (ty.forcedRapidIntensification && !ty.rapidEpisodeAbortRequested) {
        const modeChanged = ty.rapidIntensificationMode !== requestedRapidMode;
        if (!rapidIntensifying || !ty.rapidEpisodeDurationHours || modeChanged) {
          initializeRapidEpisode(requestedRapidMode, true);
        }
      }

      const landInterference = metrics.isLand || landContactHours > 0.35 || r10LandContactHours > 0.65;
      const coldWakeInterference = sstVal < 26.3 ||
        ((upwellingCooling > 1.25 || consecutiveUpwellingHours > 8.0) && ohcVal < 70.0);
      const dryInterference = !!ty.forcedDryAir || atmosphericStress.ventilation > 0.66 || rhVal < 53.0;
      const shearInterference = (ty.forcedShear !== undefined && ty.forcedShear > 15.0) || shearVal >= 21.0;
      const manualCoreRebuildBurst = penaltyRecoveryActive;
      const structuralInterference = ewrcState === "penalty_failure" || !!ty.ewrcIsFailure ||
        (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) ||
        (!manualCoreRebuildBurst && isStructureDamaged && structuralDamagePenaltyFactor < 0.76);
      const targetCapInterference = !manualEtBurst && isTargetIntensityCapActive(config) && ty.vmax >= maxLimit - 0.15;
      const naturalDevelopmentDisabled =
        !ty.forcedRapidIntensification &&
        (!config.rapidIntensifyEnabled || Math.max(0, config.intensificationRate ?? 1.0) <= 0.03);

      // Tropical RI should roll over as the cyclone becomes subtropical, while an explicitly
      // requested baroclinic burst remains available on the normal poleward-transition path.
      const etRapidInterference = coldAirWarmCoreDestroyed || (!ty.forcedRapidIntensification && priorEtTransition >= 0.34);
      if (rapidIntensifying && !playgroundSeaERI && !manualEtBurst && (landInterference || coldWakeInterference || dryInterference || shearInterference || structuralInterference || targetCapInterference || naturalDevelopmentDisabled || etRapidInterference)) {
        ty.rapidEpisodeAbortRequested = true;
      }

      if (rapidIntensifying && ty.rapidEpisodeDurationHours && ty.rapidEpisodeTarget24h) {
        const baselineRate = vmaxDeltaPerHour;
        const mode = ty.rapidIntensificationMode || "ri";

        if (ty.rapidEpisodeAbortRequested) {
          // Adverse factors do not switch RI off like a light.  The convective burst contribution
          // collapses over ~2-6 h; severe land/core ventilation ends it faster, while marginal
          // shear/upwelling produces a slower rollover.
          const severity = Math.max(
            landInterference ? 0.95 : 0,
            ty.forcedDryAir === "core" ? 1.0 : ty.forcedDryAir === "periphery" ? 0.55 : 0,
            ty.forcedShear !== undefined ? clamp01((ty.forcedShear - 15) / 20) : 0,
            coldWakeInterference ? clamp01(0.45 + upwellingCooling / 4.0) : 0,
            structuralInterference ? 1.0 : 0,
            shearInterference ? clamp01((shearVal - 17) / 16) : 0,
            dryInterference ? clamp01((58 - rhVal) / 18) : 0,
            targetCapInterference ? 0.72 : 0,
            naturalDevelopmentDisabled ? 0.45 : 0
          );
          if (!ty.rapidEpisodeExitDuration) {
            ty.rapidEpisodeExitDuration = Math.max(2.0, Math.min(5.8, 5.7 - 3.4 * severity));
            ty.rapidEpisodeExitHours = 0;
          }
          ty.rapidEpisodeExitHours = (ty.rapidEpisodeExitHours || 0) + stepFraction;
          const q = smoothstep01((ty.rapidEpisodeExitHours || 0) / Math.max(0.5, ty.rapidEpisodeExitDuration));
          const lastRapidRate = Math.max(baselineRate, ty.rapidEpisodeLastRate ?? baselineRate);
          vmaxDeltaPerHour = baselineRate + (lastRapidRate - baselineRate) * (1.0 - q);

          if ((ty.rapidEpisodeExitHours || 0) >= ty.rapidEpisodeExitDuration) {
            rapidIntensifying = false;
            delete ty.forcedRapidIntensification;
            delete ty.forcedRapidIntensificationMode;
            delete ty.rapidEpisodeDurationHours;
            delete ty.rapidEpisodeTarget24h;
            delete ty.rapidEpisodeStartRate;
            delete ty.rapidEpisodeLastRate;
            delete ty.rapidEpisodeElapsedHours;
            delete ty.rapidEpisodeExitHours;
            delete ty.rapidEpisodeExitDuration;
            delete ty.rapidEpisodeAbortRequested;
            delete ty.rapidIntensificationMode;
            ty.rapidFavorableHours = 0;
            ty.rapidTriggerCooldownHours = 30.0 + this.prng.nextRange(0, 20.0);
            vmaxDeltaPerHour = baselineRate;
          }
        } else {
          ty.rapidEpisodeElapsedHours = (ty.rapidEpisodeElapsedHours || 0) + stepFraction;
          const elapsed = ty.rapidEpisodeElapsedHours;
          const duration = Math.max(4.0, ty.rapidEpisodeDurationHours);
          const p = clamp01(elapsed / duration);
          const meanRate = ty.rapidEpisodeTarget24h / 24.0;
          const shape = mode === "uri" ? 1.0 : rapidProfileShape(p);
          const wave = mode === "uri"
            ? 1.0
            : episodeWave(`${ty.id}-${mode}`, elapsed, currentSimHour, mode === "eri" ? 0.15 : 0.11);
          const thermodynamicSupport = mode === "uri" ? 1.0 : Math.max(0.84, Math.min(1.10,
            0.90 + 0.08 * clamp01((sstVal - 27.0) / 2.5) + 0.07 * clamp01(ohcVal / 120.0) + 0.05 * clamp01((rhVal - 62.0) / 20.0) - 0.08 * clamp01((shearVal - 8.0) / 12.0)
          ));
          let rapidTargetRate = meanRate * shape * wave * thermodynamicSupport * (mode === "uri" ? 1.0 : (1.0 - 0.10 * atmosphericStress.motionStress));

          if (manualEtBurst) {
            // In a subtropical/extratropical cyclone the burst is driven by baroclinic conversion,
            // not a recovering tropical heat engine.  Keep it strong enough to represent rapid
            // cyclogenesis, but well below the tropical URI envelope and tied to the westerly zone.
            const baroclinicBurstSupport = clamp01(
              0.34 * westerlyStress +
              0.26 * clamp01((speedKmh - 18.0) / 34.0) +
              0.22 * clamp01((shearVal - 10.0) / 22.0) +
              0.18 * smoothstep01(priorEtTransition)
            );
            const baroclinicClassRate = mode === "uri" ? 0.92 : mode === "eri" ? 0.70 : 0.46;
            rapidTargetRate = baroclinicClassRate * shape * wave * (0.72 + 0.58 * baroclinicBurstSupport);
          } else if (mode === "uri") {
            const dynamicUri = URI_RATE_CENTER + URI_RATE_SWING * Math.sin((elapsed + ty.lat * 0.11 + ty.lon * 0.03) * Math.PI / 1.7);
            rapidTargetRate = Math.max(URI_RATE_MIN, Math.min(URI_RATE_MAX, 0.55 * rapidTargetRate + 0.45 * dynamicUri));
          } else if (mode === "ri") rapidTargetRate = Math.max(0.56, Math.min(1.08, rapidTargetRate));
          else rapidTargetRate = Math.max(0.92, Math.min(2.12, rapidTargetRate));

          const rampInHours = mode === "uri" ? 2.0 : Math.min(3.2, duration * 0.22);
          const rampOutHours = mode === "uri" ? 0.0 : Math.min(3.8, duration * 0.24);
          const rampIn = smoothstep01(elapsed / Math.max(0.5, rampInHours));
          const rampOut = mode === "uri" ? 1.0 : smoothstep01((duration - elapsed) / Math.max(0.5, rampOutHours));
          const envelope = Math.min(rampIn, rampOut);
          const startRate = ty.rapidEpisodeStartRate ?? Math.max(0, baselineRate);
          const blendedRapidRate = startRate + (rapidTargetRate - startRate) * envelope;
          vmaxDeltaPerHour = Math.max(baselineRate, blendedRapidRate);

          if (!manualEtBurst && isTargetIntensityCapActive(config)) {
            const gap = Math.max(0, maxLimit - ty.vmax);
            const capFade = smoothstep01(gap / 7.0);
            vmaxDeltaPerHour = baselineRate + Math.max(0, vmaxDeltaPerHour - baselineRate) * capFade;
          }

          const rapidPositiveCeiling = mode === "uri" ? URI_RATE_MAX : 2.2;
          vmaxDeltaPerHour = Math.max(-12.5, Math.min(rapidPositiveCeiling, vmaxDeltaPerHour));
          ty.rapidEpisodeLastRate = vmaxDeltaPerHour;
          if (manualEtBurst) {
            rmw = Math.min(165.0, rmw + (mode === "uri" ? 0.26 : mode === "eri" ? 0.20 : 0.14) * stepFraction * envelope);
          } else {
            rmw = Math.max(8.0, rmw - (mode === "uri" ? 0.30 : mode === "eri" ? 0.24 : 0.17) * stepFraction * envelope);
          }

          if (elapsed >= duration) {
            if (mode === "uri") {
              // Preserve the last ultra-rapid contribution and hand it to the existing smooth-abort
              // path; exactly two hours are used for the return to the environmental tendency.
              ty.rapidEpisodeAbortRequested = true;
              ty.rapidEpisodeExitHours = 0;
              ty.rapidEpisodeExitDuration = 2.0;
              delete ty.forcedRapidIntensification;
              delete ty.forcedRapidIntensificationMode;
            } else {
              // rampOut reaches zero at the endpoint, so returning to the ordinary tendency is continuous.
              rapidIntensifying = false;
              delete ty.forcedRapidIntensification;
              delete ty.forcedRapidIntensificationMode;
              delete ty.rapidEpisodeDurationHours;
              delete ty.rapidEpisodeTarget24h;
              delete ty.rapidEpisodeStartRate;
              delete ty.rapidEpisodeLastRate;
              delete ty.rapidEpisodeElapsedHours;
              delete ty.rapidEpisodeExitHours;
              delete ty.rapidEpisodeExitDuration;
              delete ty.rapidEpisodeAbortRequested;
              delete ty.rapidIntensificationMode;
              ty.rapidFavorableHours = 0;
              ty.rapidTriggerCooldownHours = 30.0 + this.prng.nextRange(0, 20.0);
              vmaxDeltaPerHour = baselineRate;
            }
          }
        }
      }

      // 4. Gradual Recovery Phase (渐进式增强恢复)
      if (ty.cloggedRecoveryHours !== undefined && ty.cloggedRecoveryTotalHours !== undefined) {
        if (ty.forcedRapidIntensification) {
          // Forced rapid intensification overrides recovery smoothing completely.
          delete ty.cloggedRecoveryHours;
          delete ty.cloggedRecoveryTotalHours;
        } else if (isEnvironmentalSuppressionActive) {
          // A new ventilation/shear/failure episode pauses structural recovery instead of letting the
          // previous recovery timer silently finish underneath an ongoing hostile intervention.
          ty.cloggedRecoveryHours = Math.max(0, ty.cloggedRecoveryHours);
        } else if (ty.cloggedRecoveryHours < ty.cloggedRecoveryTotalHours) {
          ty.cloggedRecoveryHours += stepFraction;
          const recoveryRatio = Math.min(1.0, ty.cloggedRecoveryHours / ty.cloggedRecoveryTotalHours);
          
          // Smooth ease-in curve for gradual recovery of intensification rate back to original speed.
          const smoothFactor = recoveryRatio * recoveryRatio * (3 - 2 * recoveryRatio);
          if (vmaxDeltaPerHour > 0) {
            vmaxDeltaPerHour *= smoothFactor;
          }
          
          // Partially restore structural integrity visually.
          if (recoveryRatio >= 0.5) {
            ty.isEyeClogged = false;
          }
        } else {
          // The short visual clog timer can finish while a dynamical structural scar remains.
          // Shear/dry-air/terrain/EWRC damage therefore cannot instantly recreate the old tight core.
          ty.isEyeClogged = false;
          const scarStillDynamical = coreRebuildScar >= 0.18 || structuralDamageSeverity >= 0.12 || terrainHollowCoreMemory >= 0.12;
          ty.isStructureDamaged = scarStillDynamical;
          isStructureDamaged = scarStillDynamical;
          if (!scarStillDynamical && ewrcFailureMode !== "none") ewrcFailureMode = "none";
          delete ty.cloggedRecoveryHours;
          delete ty.cloggedRecoveryTotalHours;
        }
      }

      // --- Coupled Vortex Architecture Model ---
      // Compactness is intentionally path-dependent. Plenty of moisture can support enormous
      // convective/rainband coverage without producing a tight inner core when outflow is poor,
      // the vortex is tilted, or a prior terrain/EWRC event left a structural scar.
      const architectureIntensity = clamp01((ty.vmax - 16.0) / 48.0);
      const lowShearOrganization = 1.0 - clamp01((shearVal - 8.0) / 24.0);
      const terrainHollowing = Math.max(
        terrainHollowCoreMemory,
        (damageOrigin === "terrain" || damageOrigin === "mixed") && terrainDamageMorphology === "hollow_bands"
          ? coreRebuildScar
          : 0
      );
      const terrainClogging = (damageOrigin === "terrain" || damageOrigin === "mixed") && terrainDamageMorphology === "clogged_loose"
        ? coreRebuildScar
        : 0;
      const terrainDisplacement = (damageOrigin === "terrain" || damageOrigin === "mixed") && terrainDamageMorphology === "displaced_core"
        ? coreRebuildScar
        : 0;
      const ewrcScar = damageOrigin === "ewrc_failure" || ewrcFailureMode !== "none" ? coreRebuildScar : 0;
      const sizePreference = circulationPreferenceIndices(config);
      const dvorakTNumber = estimateDvorakTNumber(ty.vmax);
      const actualR7MeanForStructure = ty.r7 && ty.r7.ne > 0
        ? (ty.r7.ne + ty.r7.se + ty.r7.sw + ty.r7.nw) / 4
        : Math.max(90, ty.vmax * 5.0);
      const expectedR7ForIntensity = getStandardAverageWindRadii(ty.vmax).r7 || Math.max(120, ty.vmax * 5.0);
      const actualBroadWindField = clamp01((actualR7MeanForStructure / Math.max(120, expectedR7ForIntensity) - 0.92) / 0.55);
      const actualCompactWindField = clamp01((0.98 - actualR7MeanForStructure / Math.max(120, expectedR7ForIntensity)) / 0.38);
      const dvorakOrganization = clamp01((dvorakTNumber - 3.0) / 3.5);
      // Dvorak intensity is the simulator's analysed intensity language, so a healthy high-T
      // cyclone must also look like a high-T cyclone. These floors never override explicit
      // physical disruption (land, strong shear/dry-air breach, failed EWRC or terrain scars).
      const dvorakEyeMaturity = smoothstep01((dvorakTNumber - 4.4) / 2.4);
      const dvorakMajorEyeMaturity = smoothstep01((dvorakTNumber - 5.7) / 1.3);
      const dvorakExplicitDisruption = metrics.isLand || priorEtTransition >= 0.40 ||
        ewrcState === "forming" || ewrcState === "max_decay" || ewrcState === "penalty_failure" || ewrcState === "recovering_failure" ||
        terrainHollowCoreMemory >= 0.16 || coreRebuildScar >= 0.50 || structuralDamageSeverity >= 0.55 ||
        dryAirCoreExposure >= 0.48 || eyewallOpenSectorFraction >= 0.40 || shearVal >= 25 ||
        binaryInteraction.inducedShearKt >= 10;
      const dvorakStructureFloorEligible = !dvorakExplicitDisruption;
      let compactnessTarget = clamp01(
        0.10 + 0.58 * architectureIntensity + 0.18 * outflowEfficiency + 0.12 * lowShearOrganization
        - 0.48 * coreRebuildScar - 0.42 * broadMoisturePlatform - 0.22 * atmosphericStress.ventilation
        - 0.34 * dryAirCoreExposure - 0.12 * eyewallColdPoolMemory - 0.50 * terrainHollowCoreMemory
        + 0.11 * sizePreference.compact - 0.14 * sizePreference.broad
      );
      // Couple satellite/Dvorak organization to the *actual* wind-field size. A broad intense
      // cyclone keeps a complete but less pinched core; a compact intense cyclone concentrates
      // the eyewall. Weak broad vortices instead favor sparse bands/loose CDO structure.
      if (dvorakTNumber >= 4.0 && coreRebuildScar < 0.48 && terrainHollowCoreMemory < 0.18) {
        const dvorakFloor = 0.46 + 0.20 * dvorakOrganization + 0.13 * actualCompactWindField - 0.07 * actualBroadWindField;
        compactnessTarget = Math.max(compactnessTarget, dvorakFloor);
      } else if (dvorakTNumber < 3.5 && actualBroadWindField > 0.35) {
        compactnessTarget = Math.min(compactnessTarget, 0.42 - 0.10 * actualBroadWindField);
      }
      if (rapidIntensifying && coreRebuildScar < 0.28 && broadMoisturePlatform < 0.38) compactnessTarget += 0.18;
      if (penaltyRecoveryActive) compactnessTarget += 0.22 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.30) / 0.70);
      if (manualCoreRebuildBurst) compactnessTarget += 0.30 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.22) / 0.78);
      if (ewrcState === "forming" || ewrcState === "max_decay") compactnessTarget *= 0.78;
      if (ewrcState === "penalty_failure" || ewrcState === "recovering_failure") compactnessTarget *= 0.58;
      if (terrainHollowing > 0.35) compactnessTarget *= 0.72;
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
        // The old inner-core ring is gone. Favor a broad low-level vortex plus annular fragments;
        // warm water can strengthen the circulation but may not recreate a compact eye by itself.
        compactnessTarget = Math.min(compactnessTarget, Math.max(0.22, 0.48 - 0.20 * terrainHollowCoreMemory));
      }
      // After a meaningful dry-air intrusion has eased, recovery starts as a small loose core,
      // but it is no longer held under a fixed timer-only ceiling. If the dry tongue becomes
      // isolated, warm-ocean re-moistening persists and the eyewall starts closing, the ceiling
      // relaxes continuously and a genuinely recovered storm may rebuild a mature core.
      const postDryLooseCore = dryAirCoreExposure < 0.34 && dryRecoveryHours >= 0.6 &&
        postDryAirBurstSuppressionHours > 0 && !metrics.isLand && sstVal >= 26.8 && shearVal <= 18.0;
      if (postDryLooseCore) {
        const dryReorganizationQuality = clamp01(
          0.30 * dryAirReMoistening +
          0.24 * innerCoreMoisture +
          0.18 * moistEnvelopeIntegrity +
          0.16 * (1 - dryAirCoreConnection) +
          0.12 * (1 - eyewallOpenSectorFraction)
        );
        const recoveryCompactnessCeiling = 0.42 + 0.40 * smoothstep01((dryReorganizationQuality - 0.30) / 0.58);
        compactnessTarget = Math.min(compactnessTarget, recoveryCompactnessCeiling);
      }
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
        // A mountain-hollowed vortex may retain a broad circulation, but a compact symmetric
        // convective core cannot regenerate in one hourly output.  Recovery requires the same
        // slowly decaying hollow-core memory (or the explicit rebuild intervention).
        const hollowCompactnessCeiling = 0.23 + 0.18 * (1 - terrainHollowCoreMemory);
        compactnessTarget = Math.min(compactnessTarget, hollowCompactnessCeiling);
      }
      if (coastalCoreInfluence > 0.06 && !metrics.isLand) {
        // Coastal organization has two common outcomes: a genuinely small/tight inner core, or a
        // much broader but lower-efficiency core. What should be suppressed is the third, least
        // realistic outcome: a large, perfectly symmetric and extremely tight CDO beside land.
        const coastalBroadPreference = clamp01(
          0.46 * broadMoisturePlatform + 0.30 * rainbandDominance + 0.24 * sizePreference.broad
        );
        const coastalCompactnessCeiling = 0.80 - coastalCoreInfluence * (0.06 + 0.24 * coastalBroadPreference);
        compactnessTarget = Math.min(compactnessTarget, coastalCompactnessCeiling);
      }
      compactnessTarget = clamp01(compactnessTarget);
      coreCompactness += (compactnessTarget - coreCompactness) * clamp01(stepFraction / (compactnessTarget < coreCompactness ? 3.3 : 9.5 + 8.0 * coreRebuildScar));

      const bandTarget = clamp01(
        0.16 + 0.52 * (1.0 - coreCompactness) + 0.48 * broadMoisturePlatform + 0.34 * coreRebuildScar
        + 0.12 * dryAirIntrusion + 0.22 * dryAirCoreExposure + 0.20 * eyewallColdPoolMemory
        + 0.18 * clamp01((shearVal - 12.0) / 18.0) + 0.12 * clamp01((moistureReservoir - 0.70) / 0.30)
        + 0.14 * sizePreference.broad - 0.07 * sizePreference.compact
        + 0.18 * actualBroadWindField - 0.12 * actualCompactWindField * dvorakOrganization
        + 0.32 * terrainHollowCoreMemory
      );
      rainbandDominance += (bandTarget - rainbandDominance) * clamp01(stepFraction / (bandTarget > rainbandDominance ? 5.0 : 10.0));

      // Convective bursts are transient. In a rapidly deepening cyclone they can temporarily fill
      // an otherwise forming eye with very cold cloud tops before subsidence clears/open the eye.
      const burstClock = 0.5 + 0.5 * Math.sin((currentSimHourFloat + ty.lat * 0.17 + ty.lon * 0.07) * Math.PI / 2.7);
      const burstPotential = clamp01(
        (0.18 + 0.38 * clamp01((sstVal - 27.0) / 2.5) + 0.24 * moistureReservoir + 0.28 * innerCoreMoisture)
        * (0.42 + 0.58 * lowShearOrganization)
        * (0.58 + 0.42 * burstClock)
      );
      let burstTarget = burstPotential * (0.18 + 0.34 * rainbandDominance);
      burstTarget += 0.20 * dvorakOrganization * actualCompactWindField * lowShearOrganization;
      if (dvorakTNumber < 3.5 && actualCompactWindField > 0.30 && moistureReservoir > 0.68) {
        // Small weak vortices bifurcate between benign/water-dominated systems and compact
        // convective rain-makers; favorable moisture selects the latter without inflating Vmax.
        burstTarget += 0.18 * actualCompactWindField * lowShearOrganization * innerCoreMoisture;
      }
      if (penaltyRecoveryActive) {
        // Recovery starts with moist convective bursts that flush/recycle low-entropy air, then
        // transitions toward vortex alignment and a closing compact inner core.
        const purgePulse = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, penaltyRecoveryProgress / 0.62))), 0.72);
        burstTarget += 0.30 + 0.52 * purgePulse;
      }
      if (rapidIntensifying) burstTarget += 0.38 + (ty.rapidIntensificationMode === "uri" ? 0.24 : ty.rapidIntensificationMode === "eri" ? 0.16 : 0);
      if (manualCoreRebuildBurst) {
        // Reconstruction is intentionally two-stage: an early central hot-tower outbreak purges
        // the damaged core, then the burst relaxes so subsidence can reopen a coherent eye.
        const rebuildBurstPulse = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, penaltyRecoveryProgress / 0.78))), 0.62);
        burstTarget += 0.34 + 0.58 * rebuildBurstPulse;
      }
      if (ty.vmax < 24.5) burstTarget += 0.14 * (1.0 - coreCompactness);
      if (metrics.isLand && moistureReservoir > 0.45) burstTarget += 0.12 * rainbandDominance;
      burstTarget *= Math.max(0.04, 1.0 - 0.88 * convectiveSuppression);
      if (postDryAirBurstSuppressionHours > 0) {
        // Connected ventilation is first an area-mean weakening process. Recovery towers are only
        // reintroduced after the lifecycle has actually entered reorganization; collapse itself
        // must not create a compensating giant moist-side burst.
        const dryRecoveryPulse = 0.5 + 0.5 * Math.sin((currentSimHourFloat + ty.lon * 0.07) * Math.PI / 2.8);
        burstTarget *= 0.22 + 0.28 * innerCoreMoisture + 0.16 * dryRecoveryPulse;
        if (dryAirLifecyclePhase === "reorganizing") {
          burstTarget += 0.14 * dryAirReMoistening * dryRecoveryPulse * (1.0 - 0.78 * dryAirCoreConnection);
        }
      }
      if (dryAirLifecyclePhase === "eyewall_breach") {
        burstTarget *= 0.88;
      } else if (dryAirLifecyclePhase === "asymmetric_collapse" || dryAirLifecyclePhase === "residual_vortex") {
        burstTarget *= 0.62;
      } else if (dryAirLifecyclePhase === "reorganizing") {
        burstTarget += 0.10 * dryAirReMoistening * (0.55 + 0.45 * innerCoreMoisture);
      }
      burstTarget = clamp01(burstTarget);
      convectiveBurstIndex += (burstTarget - convectiveBurstIndex) * clamp01(stepFraction / (burstTarget > convectiveBurstIndex ? 1.2 : 2.8));

      // One-sided convective recovery rotates around the LLCC before wrapping into a new core.
      // This is especially common after ventilation/weakening; it is intentionally a moving lobe,
      // not a fixed shear-side patch.
      const reburstRecoveryGate = dryAirLifecyclePhase === "reorganizing"
        ? clamp01(dryAirReMoistening * (1 - 0.72 * dryAirCoreConnection) * (0.55 + 0.45 * innerCoreMoisture))
        : 0;
      const reburstTarget = clamp01(
        0.40 * reburstRecoveryGate +
        0.22 * convectiveBurstIndex * reburstRecoveryGate * clamp01((0.58 - deepConvectiveCoverage) / 0.46) +
        0.08 * reburstRecoveryGate * clamp01((moistureReservoir - 0.55) / 0.40) -
        0.34 * convectiveSuppression - 0.24 * terrainBlockingMemory
      );
      asymmetricReburstStrength += (reburstTarget - asymmetricReburstStrength) *
        (1 - Math.exp(-stepFraction / (reburstTarget > asymmetricReburstStrength ? 1.8 : 6.5)));
      asymmetricReburstStrength = clamp01(asymmetricReburstStrength);
      if (asymmetricReburstStrength > 0.04) {
        const wrapRateDegPerHour = 12 + 20 * coreCompactness + 9 * asymmetricReburstStrength;
        asymmetricReburstBearingDeg = (asymmetricReburstBearingDeg + wrapRateDegPerHour * stepFraction) % 360;
      }

      // Rare "brown-ocean" localized burst: only moist, low-relief land with a coherent residual
      // vortex is eligible. It boosts a small convective sector, never rebuilds an
      // oceanic symmetric eyewall by itself.
      const brownOceanEnvironment = metrics.isLand && moistureReservoir > 0.58 && rhVal > 61 &&
        terrainMountainFraction < 0.16 && terrainBlockingMemory < 0.30 && shearVal < 19 &&
        lowLevelVortexIntegrity > 0.48 && ty.vmax >= 15.0;
      if (brownOceanEnvironment && brownOceanBurstIndex < 0.08 && this.prng.next() < 0.010 * stepFraction) {
        brownOceanBurstIndex = 0.72 + 0.22 * this.prng.next();
        asymmetricReburstBearingDeg = (ty.direction + (this.prng.next() * 140 - 70) + 360) % 360;
      } else {
        brownOceanBurstIndex *= Math.exp(-stepFraction / (brownOceanEnvironment ? 3.8 : 1.8));
      }
      brownOceanBurstIndex = clamp01(brownOceanBurstIndex);

      // Morphology scene classifier. Dvorak cloud patterns are used as qualitative structural
      // analogues; CMG/CDG/W-ring labels describe enhanced-IR cloud-top/ring scenes rather than
      // claiming a separate official Dvorak pattern family.
      const rebuildingAfterDry = postDryLooseCore;
      // Open-ocean mature CDOs remain in the familiar ~100-150 km range. Near land the dense
      // core is intentionally bifurcated: compact systems preferentially retain a 45-95 km small
      // inner core, while broad/moist systems can carry a 125-180 km but less efficient and more
      // asymmetric cloud shield. This prevents a full-size, perfectly symmetric high-efficiency CDO
      // from being newly constructed immediately beside a coastline.
      {
        // 3.3.15: CDO/core size is a prognostic structural quantity, not a per-step lookup.
        // Earlier versions recomputed the diameter directly from the coastal small/broad preference
        // and used a hard 32.7 m/s switch. Crossing either threshold could therefore make the core
        // visibly collapse in a single 10-minute step even though no physical disruption occurred.
        // Build a target, then relax toward it with mechanism-dependent time scales.
        const cdoIntensitySupport = smoothstep01((ty.vmax - 24.0) / 10.5);
        // 3.7.5: RI is no longer treated as a permission to enlarge the dense inner core. Size-RI
        // observations show the opposite tendency for RMW/inner-core size. Very intense storms can
        // still possess a broad cloud canopy, but rapid strengthening itself favours compactification.
        const matureBroadCoreSupport = clamp01(smoothstep01((ty.vmax - 55.0) / 6.5));
        const moderateCoreRegime = clamp01(1 - matureBroadCoreSupport) *
          smoothstep01((ty.vmax - 39.0) / 10.0);
        const compactModeratePreference = clamp01(
          0.62 * coreCompactness + 0.22 * sizePreference.compact - 0.20 * broadMoisturePlatform +
          (rapidIntensifying ? 0.22 : 0)
        );
        let openOceanCdoDiameter = Math.max(88, Math.min(150,
          98 + 24 * (1 - coreCompactness) + 17 * rainbandDominance + 9 * (1 - moistCoreProtection)));
        if (moderateCoreRegime > 0.12) {
          const compactBranch = smoothstep01((compactModeratePreference - 0.48) / 0.34);
          const moderateCompactDiameter = Math.max(58, Math.min(104,
            62 + 34 * coreCompactness + 8 * clamp01((ty.vmax - 43) / 15)));
          // A loose moderate-intensity core may remain spatially broad, but it is not allowed to
          // masquerade as a mature dense CDO.  The precipitation model separately lowers the
          // convective efficiency of this branch.
          const moderateLooseDiameter = Math.max(104, Math.min(154,
            112 + 19 * rainbandDominance + 18 * (1 - coreCompactness)));
          const moderateTarget = moderateLooseDiameter * (1 - compactBranch) + moderateCompactDiameter * compactBranch;
          const blend = 0.66 * moderateCoreRegime;
          openOceanCdoDiameter = openOceanCdoDiameter * (1 - blend) + moderateTarget * blend;
        }
        const coastalBroadPreference = clamp01(
          0.46 * broadMoisturePlatform + 0.30 * rainbandDominance + 0.24 * sizePreference.broad
        );
        const coastalSmallPreference = clamp01(
          0.58 * coreCompactness + 0.24 * sizePreference.compact - 0.32 * coastalBroadPreference
        );
        const coastalSmallCoreDiameter = Math.max(45, Math.min(95,
          48 + 42 * coreCompactness + 8 * clamp01((ty.vmax - 32.7) / 28)));
        const coastalBroadCoreDiameter = Math.max(125, Math.min(180,
          126 + 30 * coastalBroadPreference + 16 * rainbandDominance));
        const smallCoreBlend = smoothstep01((coastalSmallPreference - 0.34) / 0.36);
        let cdoTargetKm = openOceanCdoDiameter * (1 - coastalCoreInfluence) +
          (coastalBroadCoreDiameter * (1 - smallCoreBlend) + coastalSmallCoreDiameter * smallCoreBlend) * coastalCoreInfluence;
        // IR canopy size is allowed to lag inner-core contraction, but RI cannot make the CDO/core
        // target grow simply because the storm is strengthening. Existing broad anvils may persist;
        // new dense-core growth waits until RI has ended or another explicit size-growth mechanism acts.
        const previousCdoForRiGuard = Math.max(0, ty.cdoDiameterKm ?? cdoDiameterKm ?? 0);
        if (rapidIntensifying && previousCdoForRiGuard > 0) {
          cdoTargetKm = Math.min(cdoTargetKm, previousCdoForRiGuard);
        }
        // Below typhoon strength the dense overcast contracts gradually into a loose convective
        // core instead of disappearing at one categorical wind threshold.
        cdoTargetKm *= 0.58 + 0.42 * cdoIntensitySupport;
        if (ty.vmax < 17.2) {
          cdoTargetKm *= metrics.isLand ? 0.46 : 0.72;
        }
        if (ty.vmax < 13.9 && metrics.isLand) cdoTargetKm = 0;
        // A healthy T4.5+ cyclone cannot retain a tiny/fragmented central overcast merely because
        // old morphology memory lagged the analysed wind. The floor grows toward a broad, coherent
        // major-typhoon CDO while preserving naturally smaller compact-core storms.
        if (dvorakStructureFloorEligible && dvorakTNumber >= 4.5) {
          const dvorakCdoFloorKm = 92 + 24 * dvorakEyeMaturity + 14 * actualBroadWindField - 5 * actualCompactWindField;
          cdoTargetKm = Math.max(cdoTargetKm, dvorakCdoFloorKm);
        }

        const previousCdo = Math.max(0, ty.cdoDiameterKm ?? cdoDiameterKm ?? 0);
        const priorCompactness = clamp01(ty.coreCompactness ?? coreCompactness);
        const compactificationRate = Math.max(0, (coreCompactness - priorCompactness) / Math.max(stepFraction, 1e-6));
        // 3.3.17: do not reference the eye-model EWRC recovery flag declared later in this
        // function.  In 3.3.15/3.3.16 that temporal-dead-zone reference threw a ReferenceError
        // on the very first 10-minute integration step, which App correctly interpreted as a
        // simulation failure and immediately paused playback.  Diagnose the same state locally
        // from the already-available EWRC state instead.
        const cdoEwrcSuccessRecovery = ewrcState === "recovering_success";
        const hasPhysicalContractionDriver = rapidIntensifying || manualCoreRebuildBurst ||
          compactificationRate > 0.025 || cdoEwrcSuccessRecovery;

        if (metrics.isLand) {
          // Landfall destroys continuity rather than instantly manufacturing a tiny healthy CDO.
          // Severe hollow damage keeps a broad fragmented envelope; ordinary land contact allows
          // only slow contraction of the remnant dense cloud shield.
          const landDecay = 0.012 + 0.020 * smoothstep01(landHours / 7) + 0.018 * structuralDamageSeverity;
          cdoTargetKm = Math.min(cdoTargetKm, Math.max(34, previousCdo * (1 - stepFraction * landDecay)));
          if (terrainHollowCoreMemory >= 0.12) {
            cdoTargetKm = Math.max(cdoTargetKm, Math.min(previousCdo || 110, 92 + 32 * terrainHollowCoreMemory));
          }
        }

        if (previousCdo > 0) {
          let tauHours: number;
          if (cdoTargetKm < previousCdo) {
            // No diagnosed tightening mechanism => contraction must be slow. Nearshore geometry
            // alone may make the target smaller, but cannot collapse the core in one frame.
            tauHours = hasPhysicalContractionDriver ? (manualCoreRebuildBurst ? 4.5 : rapidIntensifying ? 6.0 : 8.5) : 20.0;
            if (!hasPhysicalContractionDriver && coastalCoreInfluence > 0.05) {
              tauHours = Math.max(tauHours, 26.0 + 12.0 * coastalCoreInfluence + 10.0 * coreGeometryContinuity);
            }
            if (terrainHollowCoreMemory >= 0.12 && !manualCoreRebuildBurst) {
              tauHours = Math.max(tauHours, 30.0 + 18.0 * terrainHollowCoreMemory);
            }
          } else {
            tauHours = manualCoreRebuildBurst ? 5.5 :
              (terrainHollowCoreMemory >= 0.12 ? 22.0 + 18.0 * terrainHollowCoreMemory : 9.5);
          }
          const alpha = 1 - Math.exp(-stepFraction / Math.max(2.5, tauHours));
          cdoDiameterKm = previousCdo + (cdoTargetKm - previousCdo) * alpha;

          // Geometry continuity is an explicit lower bound on unsupported contraction. This is the
          // near-coast fix for the historical one-frame 120 km -> 60 km style collapse.
          if (cdoTargetKm < previousCdo && !hasPhysicalContractionDriver) {
            const unsupportedTau = 28.0 + 18.0 * coastalCoreInfluence + 20.0 * terrainHollowCoreMemory;
            const continuityFloor = previousCdo * Math.exp(-stepFraction / unsupportedTau);
            cdoDiameterKm = Math.max(cdoDiameterKm, continuityFloor);
          }
        } else {
          const coreReformationBlocked = !manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12;
          if (coreReformationBlocked) {
            // Keep the centre hollow/fragmented; rainbands and broken eyewall arcs are rendered by
            // their own prognostic states. Do not synthesize a complete CDO in one hour.
            cdoDiameterKm = 0;
          } else {
            const formationTau = coastalCoreInfluence > 0.05 ? 14.0 + 8.0 * coastalCoreInfluence : 9.5;
            cdoDiameterKm = cdoTargetKm * (1 - Math.exp(-stepFraction / formationTau));
          }
        }
        if (cdoDiameterKm < 8 && cdoTargetKm <= 0) cdoDiameterKm = 0;
        cdoDiameterKm = Math.max(0, Math.min(giantEyeOuterWallMemory > 0.20 ? 245 : 190, cdoDiameterKm));
      }
      // Post-dry rebuilding starts as a genuinely small 20-50 km convective core embedded in a
      // much larger circulation. It must survive for many hours before a new 100-150 km mature CDO
      // can be classified again.
      const rebuiltCoreTargetKm = rebuildingAfterDry
        ? Math.max(20, Math.min(44,
          20 + 11 * coreCompactness + 9 * dryAirReMoistening + 4 * Math.min(1, dryRecoveryHours / 18)))
        : 0;
      rebuiltCoreDiameterKm += (rebuiltCoreTargetKm - rebuiltCoreDiameterKm) *
        clamp01(stepFraction / (rebuiltCoreTargetKm > rebuiltCoreDiameterKm ? 6.0 : 12.0));
      rebuiltCoreDiameterKm = Math.max(0, Math.min(50, rebuiltCoreDiameterKm));

      const previousEyeRadiusForScene = Math.max(0, ty.eyeRadiusKm ?? 0);
      const previousEyeClearanceForScene = clamp01(ty.eyeClearance ?? 0);
      const previousEyeAsymmetryForScene = clamp01(ty.eyeAsymmetry ?? 0.25);

      if (coldAirWarmCoreDestroyed) structureMode = "cold_air_remnant_low";
      else if (priorEtTransition >= 0.82) structureMode = "extratropical_cyclone";
      else if (priorEtTransition >= 0.72) structureMode = "extratropical_transition";
      else if (priorEtTransition >= 0.34) structureMode = "subtropical_cyclone";
      else if (warmConveyorBeltStrength > 0.58 && northeastCloudTailStrength > 0.40) structureMode = "warm_conveyor_frontal_tail";
      else if (ty.vmax < 17.2) structureMode = "tropical_depression";
      else if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.30 && deepConvectiveCoverage > 0.30) structureMode = "terrain_hollow_fragmented_eyewall";
      else if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) structureMode = "terrain_hollow_bands";
      else if (brownOceanBurstIndex > 0.32) structureMode = "brown_ocean_local_burst";
      else if (metrics.isLand && ty.vmax >= 32.7 && marineMoistureLink > 0.18 &&
        terrainMountainFraction < 0.16 && terrainBlockingMemory < 0.34 &&
        lowLevelVortexIntegrity > 0.56 && (ty.eyewallIntegrity ?? 0.45) > 0.38 && deepConvectiveCoverage > 0.46) {
        // Large, still-coherent cyclone over plains: the center is inland, but a meaningful part
        // of the circulation still taps ocean moisture. Keep a damaged but recognisable CDO.
        structureMode = "landfall_intact_cdo";
      }
      else if (metrics.isLand && ty.vmax >= 28.5 && lowLevelVortexIntegrity > 0.42 &&
        (terrainFrictionAsymmetry > 0.25 || eyewallOpenSectorFraction > 0.24 || structuralDisorganization > 0.34)) {
        structureMode = "landfall_broken_eyewall";
      }
      else if (metrics.isLand && landfallOuterRainbandIndex > 0.56 && rainbandDominance > 0.55) structureMode = "landfall_outer_rainbands";
      else if (metrics.isLand && (terrainFrictionAsymmetry > 0.38 || previousEyeAsymmetryForScene > 0.48) && lowLevelVortexIntegrity > 0.38) structureMode = "landfall_displaced_convection";
      else if (metrics.isLand && landHours >= 4.0 && structuralDisorganization > 0.32 && lowLevelVortexIntegrity < 0.72) structureMode = "landfall_disintegrating";
      else if (binaryMergerRecoveryHours > 0.4) structureMode = "binary_merger_reorganizing";
      else if (giantEyeOuterWallMemory > 0.36) structureMode = "giant_outer_eyewall";
      else if (ewrcStandoffStrength > 0.44 && ewrcFailureMode !== "none") structureMode = "failed_ewrc_standoff";
      else if (ewrcState === "forming" || ewrcState === "max_decay") structureMode = "ewrc_double";
      else if (binaryInteraction.strength > 0.28 && binaryInteraction.inducedShearKt > 7.5 && structuralDisorganization > 0.20) structureMode = "binary_interaction_sheared";
      else if (dryAirLifecyclePhase === "residual_vortex" && lowLevelVortexIntegrity > 0.50 && deepConvectiveCoverage < 0.18) structureMode = "incense_coil";
      else if (dryAirLifecyclePhase === "asymmetric_collapse" && dryAirCoreExposure > 0.48 && deepConvectiveCoverage < 0.34) structureMode = "dry_leaf";
      else if (convectiveBurstIndex > 0.52 && shearVal > 18 && llccExposure > 0.16) structureMode = "sheared_convective_burst";
      else if (dvorakTNumber >= 3.5 && convectiveBurstIndex > 0.46 && previousEyeClearanceForScene < 0.20 &&
        (shearVal > 18 || eyewallOpenSectorFraction > 0.28 || coreRebuildScar > 0.32)) structureMode = "failed_eye_opening";
      else if (dvorakTNumber >= 4.0 && convectiveBurstIndex > 0.50 && shearVal < 15 &&
        innerCoreMoisture > 0.66 && previousEyeClearanceForScene >= 0.10 && previousEyeClearanceForScene < 0.62 &&
        eyewallOpenSectorFraction < 0.26) structureMode = "reburst_eye_opening";
      else if (asymmetricReburstStrength > 0.58 && deepConvectiveCoverage < 0.68) structureMode = "asymmetric_reburst_wrap";
      else if (asymmetricReburstStrength > 0.34 && deepConvectiveCoverage >= 0.50 && previousEyeClearanceForScene > 0.16) structureMode = "reburst_eye_opening";
      else if (rebuildingAfterDry || dryAirLifecyclePhase === "reorganizing") structureMode = "dry_rebuilding_core";
      else if (dryAirLifecyclePhase === "outer_wrap" || dryAirLifecyclePhase === "eyewall_breach") structureMode = "dry_slot_eroding";
      else if (llccExposure > 0.62 && (ty.vmax < 32.7 || shearVal > 24)) structureMode = "exposed_llcc";
      else if (northeastCloudStripping > 0.52 && westerlyStress > 0.46) structureMode = "westerly_cloud_stripped";
      else if (westerlyStress > 0.58 && shearVal > 18 && (config.newEnvironmentPhysicsEnabled ? westerlyDepth > 0.42 : newLat >= (config.westerliesLat ?? 30) - 1.0) && structuralDisorganization > 0.30) structureMode = "westerly_sheared";
      else if (effectiveColdWaterStress > 0.48 && moistureReservoir < 0.60 && convectiveSuppression > 0.42) structureMode = "moisture_starved_decay";
      else if ((metrics.isLand || ((damageOrigin === "terrain" || damageOrigin === "mixed") && coreRebuildScar > 0.32)) && terrainHollowing > 0.34) structureMode = "terrain_hollow_bands";
      else if ((metrics.isLand || ((damageOrigin === "terrain" || damageOrigin === "mixed") && coreRebuildScar > 0.24)) && terrainDisplacement > 0.24) structureMode = "terrain_displaced_core";
      else if ((metrics.isLand || ((damageOrigin === "terrain" || damageOrigin === "mixed") && coreRebuildScar > 0.20)) && terrainClogging > 0.20) structureMode = "terrain_clogged_loose";
      else if ((ewrcFailureMode !== "none" || ewrcScar > 0.42) && rainbandDominance > 0.52) structureMode = "post_ewrc_broad";
      else if ((damageOrigin === "shear_dry" || damageOrigin === "mixed") && coreRebuildScar > 0.42) {
        structureMode = coreCompactness > 0.36 ? "sheared_small_core" : "rainband_dominant";
      } else if (broadMoisturePlatform > 0.43 && rainbandDominance > 0.55) structureMode = "moisture_loaded_broad";
      else if (!metrics.isLand && coastalCoreInfluence > 0.34 && ty.vmax >= 32.7) {
        structureMode = (cdoDiameterKm < 105 && coreCompactness > 0.54) ? "tightening_core" : "loose_cdo";
      }
      else if (!metrics.isLand && !rapidIntensifying && ty.vmax < 58.0 && cdoDiameterKm >= 104) structureMode = "loose_cdo";
      else if (ty.vmax >= 49 && previousEyeRadiusForScene > 24 && previousEyeClearanceForScene > 0.52 && cdoDiameterKm >= 112 && coreCompactness < 0.82) structureMode = "mature_disk_large_eye";
      // Dvorak-consistent healthy-core fallback. Put this ahead of generic ragged/burst labels so
      // a T6.5-T7 analysis cannot remain an irregular pinhole simply because old eye asymmetry
      // memory is still decaying. Explicit physical disruption cases above still win.
      else if (dvorakStructureFloorEligible && dvorakTNumber >= 6.5 && coreCompactness > 0.66) structureMode = "dvorak_w_ring";
      else if (dvorakStructureFloorEligible && dvorakTNumber >= 5.6 && coreCompactness > 0.58) structureMode = "dvorak_cmg";
      else if (dvorakStructureFloorEligible && dvorakTNumber >= 4.8 && cdoDiameterKm >= 92) structureMode = "dvorak_cdg";
      else if (ty.vmax >= 50 && previousEyeRadiusForScene > 0 && previousEyeRadiusForScene <= 14 && previousEyeAsymmetryForScene > 0.24 && coreCompactness > 0.76 &&
        (shearVal > 18 || dryAirCoreExposure > 0.28 || eyewallOpenSectorFraction > 0.24 || coreRebuildScar > 0.30)) structureMode = "intense_irregular_pinhole";
      else if (ty.vmax >= 36 && previousEyeRadiusForScene >= 15 && previousEyeClearanceForScene >= 0.18 && previousEyeClearanceForScene < 0.58 && rainbandDominance > 0.42 && llccExposure < 0.48) structureMode = "ragged_banding_eye";
      else if (convectiveBurstIndex > 0.66) structureMode = "convective_burst";
      else if (coastalCoreInfluence < 0.20 && ty.vmax >= 52 && coreCompactness > 0.78 && convectiveSuppression < 0.24 && previousEyeClearanceForScene > 0.50) structureMode = "dvorak_w_ring";
      else if (coastalCoreInfluence < 0.24 && ty.vmax >= 45 && coreCompactness > 0.68 && convectiveSuppression < 0.32) structureMode = "dvorak_cmg";
      else if (coastalCoreInfluence < 0.30 && ty.vmax >= 38 && coreCompactness > 0.58 && convectiveSuppression < 0.40) structureMode = "dvorak_cdg";
      else if (coastalCoreInfluence < 0.34 && ty.vmax >= 30.0 && cdoDiameterKm >= 92 && cdoDiameterKm <= 150 && coreCompactness < 0.72) structureMode = "cdo_mature";
      else if (coreCompactness > 0.72 && architectureIntensity > 0.56) structureMode = vmaxDeltaPerHour > 0.10 ? "tightening_core" : "mature_eyewall";
      else if (rainbandDominance > 0.66 || ty.vmax < 32.7) structureMode = "rainband_dominant";
      else structureMode = "loose_cdo";

      // --- Continuous RMW / Eye-Scale Lifecycle (3.3.25) ---
      // RMW is not a fixed 16-22 km number. Eye-formation aircraft climatology has a median RMW
      // near 34 km, with broad scatter; intensifying compact storms tend to contract, while weak/
      // broad vortices and post-ERC storms tend to have larger RMW. Active ERC phases are handled
      // above because the dominant wind maximum migrates from the inner to the outer eyewall.
      if (ewrcState !== "forming" && ewrcState !== "max_decay" && ewrcState !== "recovering_success") {
        // 3.7.5: most RMW contraction occurs early; at major-typhoon intensity the preferred
        // RMW flattens instead of shrinking linearly with every additional m/s of Vmax.
        const rmwIntensityClimo = ty.vmax <= 49
          ? Math.max(20, Math.min(52, 46 - 0.40 * (ty.vmax - 30)))
          : Math.max(20, Math.min(40, 38.4 - 0.08 * (ty.vmax - 49)));
        const rmwSizeFactor = 1
          + 0.34 * clamp01(ty.circulationExpansion ?? 0)
          + 0.18 * sizePreference.broad
          + 0.14 * clamp01(rainbandDominance)
          + 0.10 * clamp01(broadMoisturePlatform)
          - 0.16 * sizePreference.compact
          - 0.15 * clamp01(coreCompactness);
        let rmwTarget = rmwIntensityClimo * rmwSizeFactor;

        // Symmetric strengthening is an inner-core tightening process. Broad outer circulation,
        // moisture platform or rainbands may still expand, but they are not allowed to make RMW
        // grow while Vmax is increasing. RI contracts toward a compact equilibrium and then the
        // RMW can stabilize while intensity continues to rise.
        const developmentRate = vmaxDeltaPerHour;
        if (developmentRate > 0.05) {
          const strengtheningEquilibrium = rmwIntensityClimo * (rapidIntensifying
            ? (0.82 + 0.06 * (1 - clamp01(coreCompactness)))
            : (0.92 + 0.04 * (1 - clamp01(coreCompactness))));
          rmwTarget = Math.min(rmwTarget, strengtheningEquilibrium, rmw);
        } else if (developmentRate < -0.20) {
          rmwTarget *= 1.06 + 0.12 * clamp01(-developmentRate / 1.5);
        }
        if (metrics.isLand) rmwTarget *= 1.05 + 0.16 * structuralDisorganization;
        if (terrainHollowCoreMemory >= 0.12) rmwTarget *= 1.10 + 0.18 * terrainHollowCoreMemory;

        // Poleward structural conversion moves the wind maximum away from the compact tropical
        // eyewall before true frontal ET is complete.  This creates a genuine subtropical stage:
        // broad peripheral maximum first, then a frontal wind maximum after cold-core conversion.
        const subtropicalRmwPhase = smoothstep01((priorEtTransition - 0.28) / 0.34) *
          (1 - smoothstep01((priorEtTransition - 0.72) / 0.18));
        const extratropicalRmwPhase = smoothstep01((priorEtTransition - 0.66) / 0.30);
        rmwTarget *= 1 + 0.72 * subtropicalRmwPhase + 0.52 * extratropicalRmwPhase;

        // Failed replacement can leave a quasi-stationary outer eyewall instead of the usual
        // inward-contracting replacement wall. Let the maximum-wind ring migrate continuously
        // toward that outer wall while the giant-eye memory is active; the long decay time below
        // prevents an abrupt snap back to a compact core when the failure signal weakens.
        if (giantEyeOuterWallMemory > 0.10) {
          rmwTarget = Math.max(rmwTarget, 70 + 85 * giantEyeOuterWallMemory);
        } else if (ewrcStandoffStrength > 0.18) {
          rmwTarget = Math.max(rmwTarget, 54 + 42 * ewrcStandoffStrength);
        }
        const phaseRmwCeiling = priorEtTransition >= 0.28 ? (priorEtTransition >= 0.72 ? 155.0 : 135.0) : 78.0;
        const rmwTargetCeiling = giantEyeOuterWallMemory > 0.10 ? 165.0 : (ewrcStandoffStrength > 0.18 ? 112.0 : phaseRmwCeiling);
        rmwTarget = Math.max(10, Math.min(rmwTargetCeiling, rmwTarget));
        const rmwTauHours = rmwTarget < rmw
          ? (giantEyeOuterWallMemory > 0.10 ? 30.0 : (rapidIntensifying ? 5.5 : 9.0))
          : (giantEyeOuterWallMemory > 0.10 ? 16.0 : (metrics.isLand ? 7.5 : 11.0));
        const rmwAlpha = 1 - Math.exp(-stepFraction / rmwTauHours);
        rmw += (rmwTarget - rmw) * rmwAlpha;
        const phaseRmwStateCeiling = priorEtTransition >= 0.28 ? (priorEtTransition >= 0.72 ? 165.0 : 145.0) : 90.0;
        const rmwStateCeiling = giantEyeOuterWallMemory > 0.10 ? 175.0 : (ewrcStandoffStrength > 0.18 ? 120.0 : phaseRmwStateCeiling);
        rmw = Math.max(8.0, Math.min(rmwStateCeiling, rmw));
      }

      // 3.6.6 exact-target safety before eye/eyewall diagnostics: a manual RI/ERI/URI burst
      // near the configured target must not make structural diagnostics observe a transient
      // above-target intensity even when the final state would otherwise be clamped later.
      if (isTargetIntensityCapActive(config) && maxLimit !== undefined && vmaxDeltaPerHour > 0) {
        const preStructureTargetGap = maxLimit - ty.vmax;
        vmaxDeltaPerHour = preStructureTargetGap <= 0
          ? 0
          : Math.min(vmaxDeltaPerHour, preStructureTargetGap / Math.max(stepFraction, 1e-6));
      }

      // --- Continuous Eye / Eyewall Structure Model ---
      // The eye is not inferred from wind speed alone.  It is a slowly evolving thermodynamic and
      // structural subsystem that responds to vortex intensity, moisture, shear, land friction and
      // the current eyewall-replacement phase.  All variables are persisted into history so replay,
      // satellite rendering and later diagnostics see the structure that actually existed at the time.
      const relaxEyeState = (previous: number | undefined, target: number, tauHours: number): number => {
        const prev = Number.isFinite(previous as number) ? (previous as number) : target;
        const alpha = clamp01(stepFraction / Math.max(0.5, tauHours));
        return prev + (target - prev) * alpha;
      };

      const predictedEyeVmax = Math.max(0, ty.vmax + vmaxDeltaPerHour * stepFraction);
      const eyeIntensity = clamp01((predictedEyeVmax - 31.0) / 32.0);
      const sstEyeSupport = clamp01((sstVal - 25.8) / 3.2);
      const ohcEyeSupport = clamp01(ohcVal / 105.0);
      const moistureEyeSupport = clamp01((rhVal - 48.0) / 34.0);
      const oceanEyeSupport = 0.58 * sstEyeSupport + 0.42 * ohcEyeSupport;

      let shearEyeStress = clamp01((shearVal - 8.0) / 20.0);
      let dryEyeStress = clamp01(
        0.10 * clamp01((58.0 - rhVal) / 28.0) +
        0.58 * dryAirCoreExposure +
        0.24 * eyewallOpenSectorFraction +
        0.12 * (1.0 - innerCoreMoisture)
      );
      const hadOrganizedEyeBeforeLandfall = ty.vmax >= 40.0 && ((ty.eyeClearance ?? 0) >= 0.42 || ty.eyePhase === "clear" || ty.eyeType === "small_round" || ty.eyeType === "large_round");
      const eyePersistenceHours = hadOrganizedEyeBeforeLandfall ? 6.5 + 2.0 * clamp01((ty.vmax - 40.0) / 30.0) : 2.5;
      const centerLandEyeRamp = metrics.isLand
        ? smoothstep01((landHours - 0.8) / Math.max(1.5, eyePersistenceHours - 0.8))
        : 0;
      const sampledFrictionEyeRamp = smoothstep01((structuralDamageHours - 0.25) / Math.max(1.5, eyePersistenceHours - 0.5)) *
        clamp01(0.22 + 0.78 * terrainCoreLandFraction);
      const landEyeRamp = Math.max(centerLandEyeRamp, sampledFrictionEyeRamp);
      // The current land/sea roughness forcing stops once the whole core clears the coast; the
      // residual post-exit damage is handled separately by damageEyeStress/coreRebuildScar.
      let landEyeStress = clamp01(
        landEyeRamp *
        (0.60 + 0.34 * coreSurfaceInteraction.frictionIndex + 0.30 * (1.0 - moistureReservoir))
      );
      const terrainEyeStress = clamp01(
        0.48 * coreSurfaceInteraction.blockingIndex +
        0.32 * terrainBlockingMemory +
        0.20 * terrainFrictionAsymmetry * (0.30 + 0.70 * terrainCoreLandFraction)
      );
      // Core damage is continuous, not binary.  A partially disrupted eyewall can retain a visible
      // eye while becoming more asymmetric/cloud-filled; the stress then relaxes gradually offshore.
      const damageEyeStress = clamp01(Math.max(
        ty.isCoreDisrupted ? 0.92 : 0.0,
        (isStructureDamaged || ty.isStructureDamaged) ? 0.30 : 0.0,
        1.0 - structuralDamagePenaltyFactor
      ));
      // Poor upper-level exhaust traps cirrus/deep convection over the core.  This
      // explicitly couples the configurable outflow efficiency into eye morphology,
      // so a storm with strong surface winds can still develop a cloud-filled/blocked eye.
      const outflowEyeStress = clamp01((0.92 - (config.outflowScale ?? 1.0)) / 0.62);

      if (ty.forcedDryAir === "core") dryEyeStress = clamp01(dryEyeStress + 0.38);
      else if (ty.forcedDryAir === "periphery") dryEyeStress = clamp01(dryEyeStress + 0.05);
      if (ty.forcedShear !== undefined && ty.forcedShear > 15.0) {
        shearEyeStress = Math.max(shearEyeStress, clamp01((ty.forcedShear - 15.0) / 22.0));
      }

      const ewrcForming = ewrcState === "forming" || ewrcState === "max_decay";
      const ewrcSuccessRecovery = ewrcState === "recovering_success";
      const ewrcFailure = ewrcState === "penalty_failure" || ewrcState === "recovering_failure" || !!ty.ewrcIsFailure;
      const normalizedEwrcProgress = clamp01(ewrcProgress || 0);
      // An intact outer wall takes over with a wider eye. The secondary ring is no longer a
      // second eyewall after success; keep the size memory while the single wall contracts.
      // Environmental destruction still prevents an automatically pristine eye.
      const postEwrcEyeEnvironment = clamp01(
        smoothstep01((predictedEyeVmax - 38) / 14) *
        (1 - shearEyeStress) * (1 - dryEyeStress) * (1 - landEyeStress) *
        (1 - clamp01(coreRebuildScar))
      );
      const recentSuccessfulEye = (ewrcSuccessRecovery ||
        (successfulEwrcCount > 0 && ewrcCooldownHours > 12 && ewrcFailureMode === "none"))
        ? postEwrcEyeEnvironment : 0;

      let secondaryEyewallTarget = 0.0;
      if (ewrcForming) {
        // Outer convection first consolidates, peaks around the double-eyewall stage, and becomes
        // the new primary eyewall late in the cycle.
        secondaryEyewallTarget = clamp01(0.10 + 1.12 * Math.sin(Math.PI * Math.min(0.92, normalizedEwrcProgress + 0.08)));
      } else if (ewrcSuccessRecovery) {
        secondaryEyewallTarget = Math.max(0.06, 0.78 * (1.0 - normalizedEwrcProgress));
      } else if (ewrcFailure) {
        secondaryEyewallTarget = 0.20 * (1.0 - clamp01((ty.ewrcFailurePenaltyHours || 0) / Math.max(1, ty.ewrcPenaltyTotalHours || 12)));
        // Failed ERCs can persist as a real double-eyewall standoff. In the inner-collapse /
        // outer-stall branch the outer wall remains convectively active instead of vanishing as
        // soon as the formal EWRC state leaves `forming`.
        if (ewrcStandoffStrength > 0.12) {
          secondaryEyewallTarget = Math.max(secondaryEyewallTarget, 0.28 + 0.62 * ewrcStandoffStrength);
        }
      }
      const secondaryEyewallStrength = clamp01(relaxEyeState(
        ty.secondaryEyewallStrength,
        secondaryEyewallTarget,
        secondaryEyewallTarget > (ty.secondaryEyewallStrength ?? 0) ? 2.8 : 5.5
      ));

      let integrityTarget = 0.10
        + 0.69 * eyeIntensity
        + 0.11 * oceanEyeSupport
        + 0.08 * moistureEyeSupport
        - 0.34 * shearEyeStress
        - 0.23 * dryEyeStress
        - 0.20 * eyewallOpenSectorFraction
        + 0.10 * innerCoreMoisture
        + 0.06 * deepConvectiveCoverage
        - 0.50 * landEyeStress
        - 0.18 * terrainEyeStress
        - 0.28 * damageEyeStress
        - 0.22 * outflowEyeStress
        + 0.18 * coreCompactness
        - 0.30 * coreRebuildScar
        - 0.20 * broadMoisturePlatform
        - 0.30 * priorEtTransition
        - 0.13 * coastalCoreInfluence;
      if (ewrcForming) integrityTarget -= 0.10 + 0.24 * secondaryEyewallStrength;
      if (ewrcSuccessRecovery) integrityTarget += 0.16 * normalizedEwrcProgress;
      if (ewrcFailure) integrityTarget -= 0.28;
      if (manualCoreRebuildBurst) integrityTarget += 0.34 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.28) / 0.72);
      // 4.1.2 Dvorak consistency: Vmax-derived T-number constrains how organized the *wind-bearing*
      // eyewall can look, but never forces a clean eye through severe shear, dry intrusion or
      // terrain damage. Broad intense storms retain a larger robust ring; compact intense storms
      // concentrate that organization into a tighter eyewall.
      const dvorakHostility = clamp01(Math.max(
        0.84 * shearEyeStress,
        0.78 * dryEyeStress,
        0.92 * terrainEyeStress,
        0.86 * damageEyeStress,
        0.82 * priorEtTransition
      ));
      if (dvorakTNumber >= 4.0 && !ewrcFailure && priorEtTransition < 0.55) {
        const sizeOrganization = 0.05 * actualBroadWindField + 0.10 * actualCompactWindField;
        const dvorakFloor = (0.42 + 0.34 * dvorakOrganization + sizeOrganization) * (1 - 0.78 * dvorakHostility);
        integrityTarget = Math.max(integrityTarget, dvorakFloor);
      } else if (dvorakTNumber < 3.5 && actualBroadWindField > 0.25) {
        // Weak, broad systems normally present loose curved bands rather than a falsely solid ring.
        integrityTarget = Math.min(integrityTarget, 0.40 + 0.10 * dvorakOrganization);
      }
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
        integrityTarget = Math.min(integrityTarget, Math.max(0.16, 0.42 - 0.18 * terrainHollowCoreMemory));
      }
      // Mesoscale organization is never perfectly steady. Use deterministic multi-period pulses so
      // replay/save remains reproducible while weak/sheared/ventilated storms spend appreciable time
      // with broken arcs instead of snapping to an unrealistically perfect annulus.
      const structurePhaseSeed = (ty.id?.length || 1) * 0.47 + ty.lat * 0.031 + ty.lon * 0.017;
      const structurePulse = 0.58 * Math.sin((currentSimHourFloat + structurePhaseSeed) * Math.PI / 3.7)
        + 0.42 * Math.sin((currentSimHourFloat * 0.57 + structurePhaseSeed * 1.9) * Math.PI / 4.9);
      const structureInstability = clamp01(
        0.18 + 0.34 * shearEyeStress + 0.28 * dryEyeStress + 0.24 * eyewallOpenSectorFraction +
        0.22 * coreRebuildScar + 0.18 * (1 - innerCoreMoisture) + 0.14 * coastalCoreInfluence
      );
      integrityTarget -= Math.max(0, structurePulse) * 0.15 * structureInstability;
      if (predictedEyeVmax < 31.5) integrityTarget *= clamp01((predictedEyeVmax - 20.0) / 11.5);
      integrityTarget = clamp01(integrityTarget);
      const eyewallIntegrity = clamp01(relaxEyeState(
        ty.eyewallIntegrity, integrityTarget, integrityTarget < (ty.eyewallIntegrity ?? integrityTarget) ? 2.8 : 5.8
      ));

      let warmCoreTarget = 0.08
        + 0.67 * eyeIntensity
        + 0.18 * eyewallIntegrity
        + 0.14 * oceanEyeSupport
        - 0.24 * shearEyeStress
        - 0.15 * dryEyeStress
        - 0.08 * eyewallOpenSectorFraction
        + 0.08 * innerCoreMoisture
        - 0.43 * landEyeStress
        - 0.18 * terrainEyeStress
        - 0.18 * damageEyeStress
        - 0.10 * outflowEyeStress
        - 0.42 * priorEtTransition
        - 0.24 * smoothstep01((priorEtTransition - 0.28) / 0.34)
        - 0.22 * smoothstep01((priorEtTransition - 0.68) / 0.26);
      // During replacement the old warm, dry eye typically moistens/cools before a new subsiding eye
      // is established; successful recovery then rebuilds the warm core progressively.
      if (ewrcForming) warmCoreTarget -= 0.18 + 0.18 * secondaryEyewallStrength;
      if (ewrcSuccessRecovery) warmCoreTarget += 0.18 * normalizedEwrcProgress;
      if (ewrcFailure) warmCoreTarget -= 0.24;
      if (manualCoreRebuildBurst) warmCoreTarget += 0.24 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.38) / 0.62);
      // Strong-cold-air warm-core damage acts directly on the thermodynamic core. Partial damage can
      // recover, but the fully destroyed state is irreversible and cannot be rebuilt by RI/ERI.
      warmCoreTarget *= 1 - 0.94 * coldAirWarmCoreDamage;
      if (coldAirWarmCoreDestroyed) warmCoreTarget = Math.min(warmCoreTarget, 0.025);
      warmCoreTarget = clamp01(warmCoreTarget);
      const eyeWarmCore = clamp01(relaxEyeState(ty.eyeWarmCore, warmCoreTarget, warmCoreTarget < (ty.eyeWarmCore ?? warmCoreTarget) ? 2.2 : 6.0));

      let asymmetryTarget = 0.05
        + 0.54 * shearEyeStress
        + 0.34 * landEyeStress
        + 0.15 * terrainEyeStress
        + 0.20 * dryEyeStress
        + 0.34 * eyewallOpenSectorFraction
        + 0.25 * damageEyeStress
        + 0.14 * outflowEyeStress
        + 0.18 * (1.0 - eyewallIntegrity)
        + 0.30 * priorEtTransition
        + 0.30 * coastalCoreInfluence;
      asymmetryTarget += Math.max(0, structurePulse) * (0.08 + 0.18 * structureInstability);
      if (ewrcFailure) asymmetryTarget += 0.18;
      if (structureMode === "failed_eye_opening") asymmetryTarget += 0.18;
      if (structureMode === "sheared_convective_burst") asymmetryTarget += 0.24;
      if (structureMode === "binary_interaction_sheared") asymmetryTarget += 0.16 * binaryInteraction.strength;
      if (structureMode === "landfall_broken_eyewall") asymmetryTarget += 0.15;
      if (terrainDamageMorphology === "displaced_core") asymmetryTarget += 0.22 * terrainDisplacement;
      if (terrainDamageMorphology === "clogged_loose") asymmetryTarget += 0.07 * terrainClogging;
      if (ewrcSuccessRecovery) asymmetryTarget -= 0.16 * normalizedEwrcProgress;
      if (manualCoreRebuildBurst) asymmetryTarget -= 0.30 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.30) / 0.70);
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
        asymmetryTarget = Math.max(asymmetryTarget, 0.38 + 0.34 * terrainHollowCoreMemory);
      }
      if (dvorakStructureFloorEligible && dvorakTNumber >= 5.0) {
        const dvorakAsymmetryCeiling = Math.max(0.10, 0.30 - 0.18 * dvorakMajorEyeMaturity + 0.05 * actualBroadWindField);
        asymmetryTarget = Math.min(asymmetryTarget, dvorakAsymmetryCeiling);
      }
      const eyeAsymmetry = clamp01(relaxEyeState(ty.eyeAsymmetry, clamp01(asymmetryTarget), 3.5));

      let obstructionTarget = 0.12
        + 0.36 * (1.0 - eyewallIntegrity)
        + 0.24 * shearEyeStress
        + 0.19 * dryEyeStress
        + 0.18 * eyewallOpenSectorFraction * (1.0 - 0.55 * innerCoreMoisture)
        + 0.39 * landEyeStress
        + 0.15 * terrainEyeStress
        + 0.30 * damageEyeStress
        + 0.34 * outflowEyeStress
        + 0.28 * secondaryEyewallStrength
        + 0.40 * convectiveBurstIndex
        + 0.18 * broadMoisturePlatform
        + 0.16 * coreRebuildScar
        + 0.22 * priorEtTransition
        + 0.08 * coastalCoreInfluence;
      obstructionTarget += Math.max(0, -structurePulse) * (0.06 + 0.16 * structureInstability);
      if (ty.isEyeClogged) obstructionTarget += 0.18;
      if (terrainDamageMorphology === "clogged_loose") obstructionTarget += 0.26 * terrainClogging;
      if (terrainDamageMorphology === "displaced_core") obstructionTarget += 0.12 * terrainDisplacement;
      if (ewrcForming) obstructionTarget += 0.18 + 0.17 * secondaryEyewallStrength;
      if (ewrcSuccessRecovery) obstructionTarget -= 0.26 * normalizedEwrcProgress;
      if (ewrcFailure) obstructionTarget += 0.26;
      if (structureMode === "failed_eye_opening") obstructionTarget += 0.24;
      if (structureMode === "sheared_convective_burst") obstructionTarget += 0.16;
      if (structureMode === "landfall_broken_eyewall") obstructionTarget += 0.14;
      if (structureMode === "binary_merger_reorganizing") obstructionTarget += 0.18;
      if (manualCoreRebuildBurst) obstructionTarget -= 0.38 * smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.48) / 0.52);
      if (dvorakStructureFloorEligible && dvorakTNumber >= 5.0) {
        const dvorakObstructionCeiling = Math.max(0.10, 0.40 - 0.25 * dvorakMajorEyeMaturity + 0.05 * actualBroadWindField);
        obstructionTarget = Math.min(obstructionTarget, dvorakObstructionCeiling);
      }
      obstructionTarget = clamp01(obstructionTarget);
      const eyeObstruction = clamp01(relaxEyeState(
        ty.eyeObstruction, obstructionTarget, obstructionTarget > (ty.eyeObstruction ?? obstructionTarget) ? 2.4 : 6.5
      ));

      // Eye formation has memory: a TC-strength vortex must first wrap a coherent eyewall/rainband
      // around the centre and sustain that organization. A transient wind maximum or one convective
      // burst is not enough to create a clear eye.
      let wrapTarget = clamp01(
        0.08 + 0.31 * deepConvectiveCoverage + 0.24 * coreCompactness + 0.17 * innerCoreMoisture +
        0.12 * outflowEfficiency + 0.12 * oceanEyeSupport + 0.08 * eyeIntensity -
        0.28 * shearEyeStress - 0.24 * dryEyeStress - 0.28 * eyewallOpenSectorFraction -
        0.20 * coreRebuildScar - 0.22 * landEyeStress
      );
      if (predictedEyeVmax < 24.5) wrapTarget *= clamp01((predictedEyeVmax - 13.9) / 10.6);
      if (ewrcForming) wrapTarget *= 0.62 + 0.25 * secondaryEyewallStrength;
      if (ewrcFailure) wrapTarget *= 0.45;
      // Bursts help close the ring, but very strong bursts temporarily cloud-fill the centre.
      wrapTarget = clamp01(wrapTarget + 0.11 * convectiveBurstIndex * (1 - 0.55 * shearEyeStress));
      if (dvorakStructureFloorEligible && dvorakTNumber >= 5.0) {
        wrapTarget = Math.max(wrapTarget, 0.54 + 0.34 * dvorakEyeMaturity);
      }
      const eyewallWrapProgress = clamp01(relaxEyeState(
        ty.eyewallWrapProgress, wrapTarget, wrapTarget > (ty.eyewallWrapProgress ?? 0.02) ? 6.5 : 3.6
      ));
      const openingEnvironment = clamp01(
        0.34 * eyewallWrapProgress + 0.22 * eyewallIntegrity + 0.15 * eyeWarmCore +
        0.12 * innerCoreMoisture + 0.10 * coreCompactness + 0.07 * outflowEfficiency -
        0.18 * shearEyeStress - 0.14 * dryEyeStress - 0.20 * eyewallOpenSectorFraction - 0.16 * coreRebuildScar
      );
      const formationEligible = predictedEyeVmax >= 30.0 && eyewallWrapProgress >= 0.48 && eyewallIntegrity >= 0.38;
      let formationTarget = formationEligible
        ? Math.max(clamp01((openingEnvironment - 0.34) / 0.52), recentSuccessfulEye * 0.74)
        : 0;
      if (dvorakStructureFloorEligible && dvorakTNumber >= 5.2 && predictedEyeVmax >= 36) {
        formationTarget = Math.max(formationTarget, 0.42 + 0.40 * dvorakMajorEyeMaturity);
      }
      const eyeFormationMemory = clamp01(relaxEyeState(
        ty.eyeFormationMemory, formationTarget, formationTarget > (ty.eyeFormationMemory ?? 0) ? 8.5 : 4.0
      ));

      let clearanceTarget = 0.0;
      if (predictedEyeVmax >= 31.5 && (eyeFormationMemory >= 0.24 || recentSuccessfulEye > 0.42)) {
        clearanceTarget = (0.06 + 0.88 * eyeIntensity)
          * (0.30 + 0.70 * eyewallIntegrity)
          * (1.0 - 0.80 * eyeObstruction)
          * (1.0 - 0.34 * eyeAsymmetry)
          * (0.72 + 0.28 * eyeWarmCore);
        if (ewrcForming) clearanceTarget *= Math.max(0.10, 0.55 - 0.38 * secondaryEyewallStrength);
        if (ewrcSuccessRecovery) {
          // The moat has merged into one eye after takeover: the old 0.35 multiplier made a
          // healthy, newly replaced high-intensity eye inexplicably cloud-filled for many hours.
          clearanceTarget *= 0.76 + 0.24 * normalizedEwrcProgress;
          clearanceTarget = Math.max(clearanceTarget,
            recentSuccessfulEye * (0.73 + 0.13 * normalizedEwrcProgress));
        }
        if (ewrcFailure) clearanceTarget *= 0.18;
        // Deep convective bursts can temporarily cloud-fill the circulation centre even during RI.
        // During a manual damaged-core rebuild the early burst still fills the center, but once the
        // eyewall has realigned the same intervention transitions to subsidence/eye reopening.
        const rebuildEyeOpening = manualCoreRebuildBurst
          ? smoothstep01(Math.max(0, penaltyRecoveryProgress - 0.48) / 0.52)
          : 0;
        clearanceTarget *= Math.max(0.08, 1.0 - 0.86 * convectiveBurstIndex * (1.0 - 0.82 * rebuildEyeOpening));
        if (manualCoreRebuildBurst) clearanceTarget += 0.34 * eyeIntensity * rebuildEyeOpening;
        // A single dry-breached eyewall sector makes the eye eccentric/ragged before it fully
        // clouds over. Preserve some warm-eye visibility while reducing geometric symmetry.
        clearanceTarget *= Math.max(0.24, 1.0 - 0.52 * eyewallOpenSectorFraction);
        if (structureMode === "terrain_hollow_bands") clearanceTarget *= 0.56;
        if (structureMode === "terrain_clogged_loose") clearanceTarget *= 0.28;
        if (structureMode === "terrain_displaced_core") clearanceTarget *= 0.44;
        if (structureMode === "dry_slot_eroding") clearanceTarget *= 0.82 - 0.34 * dryAirCoreExposure;
        if (structureMode === "dry_leaf" || structureMode === "incense_coil") clearanceTarget *= 0.24;
        if (structureMode === "dry_rebuilding_core") clearanceTarget *= 0.38;
        if (structureMode === "failed_eye_opening") clearanceTarget *= 0.18;
        if (structureMode === "sheared_convective_burst") clearanceTarget *= 0.34;
        if (structureMode === "binary_interaction_sheared") clearanceTarget *= 0.52;
        if (structureMode === "binary_merger_reorganizing") clearanceTarget *= 0.28;
        if (structureMode === "landfall_broken_eyewall") clearanceTarget *= 0.40;
        if (structureMode === "landfall_intact_cdo") clearanceTarget *= 0.72;
        if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
          clearanceTarget = Math.min(clearanceTarget, 0.06 + 0.08 * (1 - terrainHollowCoreMemory));
        }
        // Near-shore eyes can remain visible, but are less likely to be perfectly clean/round.
        clearanceTarget *= 1.0 - 0.22 * coastalCoreInfluence;
        clearanceTarget *= 1.0 - 0.74 * priorEtTransition;
        const eyeOpeningGate = smoothstep01(clamp01((eyeFormationMemory - 0.24) / 0.58)) *
          smoothstep01(clamp01((eyewallWrapProgress - 0.42) / 0.48));
        clearanceTarget *= Math.max(eyeOpeningGate, recentSuccessfulEye * 0.90);
      }
      if (dvorakStructureFloorEligible && dvorakTNumber >= 5.4 && eyeFormationMemory >= 0.20) {
        const dvorakClearanceFloor = Math.max(0.30, 0.36 + 0.38 * dvorakMajorEyeMaturity - 0.08 * actualBroadWindField);
        clearanceTarget = Math.max(clearanceTarget, dvorakClearanceFloor);
      }
      clearanceTarget = clamp01(clearanceTarget);
      const eyeClearance = clamp01(relaxEyeState(
        ty.eyeClearance, clearanceTarget, clearanceTarget < (ty.eyeClearance ?? clearanceTarget) ? 2.4 : 5.2
      ));

      // Eye-radius evolution follows the observed RMW/eye lifecycle instead of being almost
      // fixed and systematically too small. Global IR climatology gives a mean eye radius near
      // 26 km, while newly formed aircraft-observed eyes commonly have ~33 km diameter. Eyes tend
      // to contract during symmetric intensification, broaden with vortex growth/weakening, and
      // expand markedly through successful eyewall replacement before contracting again.
      let radiusTarget = 0.0;
      if (predictedEyeVmax >= 31.5 && (eyeFormationMemory >= 0.24 || recentSuccessfulEye > 0.42)) {
        const matureEyeGeometry = 0.52
          + 0.18 * (1.0 - coreCompactness)
          + 0.11 * (1.0 - eyewallIntegrity)
          + 0.08 * eyeAsymmetry
          + 0.07 * clamp01(ty.circulationExpansion ?? 0);
        radiusTarget = rmw * matureEyeGeometry;
        radiusTarget *= 1.0 + 0.12 * actualBroadWindField - 0.10 * actualCompactWindField;
        if (dvorakTNumber >= 5.0 && actualBroadWindField > 0.35) {
          radiusTarget = Math.max(radiusTarget, Math.min(50, 0.48 * rmw + 8 * actualBroadWindField));
        }

        // Ordinary intensification contracts the eye. Pinhole eyes are intentionally rare: they
        // require an exceptionally compact, clean, rapidly intensifying core, not merely Vmax>48.
        if (vmaxDeltaPerHour > 0.18 && !ewrcForming && !ewrcSuccessRecovery) {
          radiusTarget *= 0.90 - 0.08 * clamp01(vmaxDeltaPerHour / 1.4);
        } else if (vmaxDeltaPerHour < -0.18 && !ewrcForming) {
          radiusTarget *= 1.04 + 0.10 * clamp01(-vmaxDeltaPerHour / 1.2);
        }
        const pinholeRegime = rapidIntensifying && predictedEyeVmax >= 58.0 && rmw <= 21.0 &&
          coreCompactness > 0.90 && eyewallIntegrity > 0.80 && coreRebuildScar < 0.14 &&
          broadMoisturePlatform < 0.22 && eyeAsymmetry < 0.22;
        if (pinholeRegime) radiusTarget = Math.max(4.0, Math.min(10.5, rmw * 0.34));

        if (ewrcForming) {
          // The old eye becomes less clean while the secondary ring grows; geometric size can
          // increase even before the new wall fully takes over.
          radiusTarget *= 1.02 + 0.30 * secondaryEyewallStrength;
        }
        if (ewrcSuccessRecovery) {
          // ERC observations: the new primary wind maximum normally lies outside the former
          // inner eyewall; the resulting eye is broader, then contracts gradually.
          radiusTarget = Math.max(radiusTarget * (1.22 + 0.18 * (1.0 - normalizedEwrcProgress)),
            Math.min(52, rmw * (0.78 - 0.08 * normalizedEwrcProgress)) * recentSuccessfulEye);
        } else if (recentSuccessfulEye > 0.25) {
          // Maintain the post-cycle size for a while without making large eyes permanent.
          radiusTarget = Math.max(radiusTarget,
            Math.min(50, rmw * 0.66) * recentSuccessfulEye);
        }
        // Round157: a failed replacement can strand a LARGE OUTER eyewall,
        // but it does not create an equally large clear inner eye. Previously
        // forcing the eye radius toward RMW (or 38+82*outer-wall memory) could
        // generate 160-250 km wide artificial eye holes during dry-air failure.
        // Preserve the separate outer-wall memory/rainbands; do not reclassify
        // that radius as the inner wind-free eye.
        const damagedEye = ewrcFailure || ewrcFailureMode !== "none" ||
          dryAirCoreExposure > 0.28 || eyewallOpenSectorFraction > 0.30;
        if (damagedEye) {
          const baselineEye = previousEyeRadiusForScene > 2
            ? Math.min(previousEyeRadiusForScene, 37)
            : Math.min(rmw * 0.53, 30);
          radiusTarget = Math.min(radiusTarget, Math.max(11,baselineEye));
        }
        if (structureMode === "terrain_hollow_bands" || structureMode === "terrain_hollow_fragmented_eyewall") {
          radiusTarget = Math.max(radiusTarget, rmw * (0.80 + 0.48 * terrainHollowing));
        }
        if (structureMode === "terrain_clogged_loose") radiusTarget *= 0.94 + 0.14 * terrainClogging;
        if (structureMode === "terrain_displaced_core") radiusTarget *= 1.02 + 0.16 * terrainDisplacement;
        if (structureMode === "moisture_loaded_broad") radiusTarget *= 1.08 + 0.22 * broadMoisturePlatform;

        // Never allow *failed* eyewall replacement to enlarge the diagnosed
        // eye aperture. Outlying external wind maxima are still modeled as
        // secondary rings, rather than a 100+ km clear central void.
        const radiusCeiling = damagedEye ? 38.0 : 55.0;
        radiusTarget = pinholeRegime
          ? Math.max(4.0, radiusTarget)
          : Math.max(7.0, Math.min(radiusCeiling, radiusTarget));
      }
      const previousEyeRadius = Math.max(0, ty.eyeRadiusKm ?? 0);
      let eyeRadiusTau = radiusTarget > previousEyeRadius
        ? (ewrcForming || ewrcSuccessRecovery ? 3.8 : 6.0)
        : (rapidIntensifying ? 5.0 : 8.0);
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) {
        eyeRadiusTau = Math.max(eyeRadiusTau, 16.0 + 10.0 * terrainHollowCoreMemory);
      }
      if (ewrcFailure || dryAirCoreExposure > 0.28 || eyewallOpenSectorFraction > 0.30) {
        // Structure damage obscures/closes the existing eye; it cannot hold an
        // inflated calm aperture open for another 12–24 h.
        eyeRadiusTau = Math.min(eyeRadiusTau, 4.0);
      }
      if (coastalCoreInfluence > 0.05 && radiusTarget < previousEyeRadius && !rapidIntensifying && !ewrcForming) {
        eyeRadiusTau = Math.max(eyeRadiusTau, 12.0 + 10.0 * coastalCoreInfluence);
      }
      const relaxedEyeRadius = relaxEyeState(ty.eyeRadiusKm, radiusTarget, eyeRadiusTau);
      const eyeRadiusKm = predictedEyeVmax < 31.5
        ? Math.max(0, relaxedEyeRadius * Math.exp(-stepFraction / (terrainHollowCoreMemory >= 0.12 ? 15.0 : (coastalCoreInfluence > 0.05 ? 9.0 : 5.5))))
        : Math.max(0, relaxedEyeRadius);

      // Simulated geostationary-IR brightness is controlled primarily by cloud clearance/subsidence,
      // not a monotonic wind-speed lookup. Strong convective bursts can make the centre very cold and
      // opaque immediately before a warm eye opens as burst activity subsides.
      const brightnessTarget = computeEyeBrightnessTarget({
        predictedEyeVmax,
        eyeWarmCore,
        eyeClearance,
        eyeObstruction,
        convectiveBurstIndex,
        secondaryEyewallStrength,
        landEyeStress,
        dryAirCoreExposure,
        structureMode
      });
      const eyeBrightnessTempC = relaxEyeState(
        ty.eyeBrightnessTempC,
        brightnessTarget,
        eyeBrightnessRelaxationHours(ty.eyeBrightnessTempC, brightnessTarget, predictedEyeVmax, eyeClearance)
      );

      const previousClearance = ty.eyeClearance ?? 0;
      let eyePhase: Typhoon["eyePhase"] = "none";
      if (predictedEyeVmax < 31.5 || eyewallIntegrity < 0.12 ||
          (eyeFormationMemory < 0.18 && recentSuccessfulEye < 0.42) || eyewallWrapProgress < 0.34) {
        eyePhase = "none";
      } else if (ewrcForming && secondaryEyewallStrength >= 0.43) {
        eyePhase = "replacement_double";
      } else if (ewrcForming) {
        eyePhase = "replacement_inner";
      } else if (ewrcSuccessRecovery) {
        eyePhase = "replacement_new";
      } else if (ewrcFailure || eyeObstruction >= 0.74) {
        eyePhase = "blocked";
      } else if (eyeClearance >= 0.64 && eyewallIntegrity >= 0.55) {
        eyePhase = "clear";
      } else if (eyeClearance >= 0.22 && eyeClearance > previousClearance + 0.015) {
        eyePhase = "opening";
      } else if (eyeClearance < previousClearance - 0.015 && previousClearance >= 0.22) {
        eyePhase = "clouding";
      } else if (eyeClearance >= 0.16) {
        eyePhase = "forming";
      } else {
        eyePhase = "ragged";
      }

      // A terrain-hollowed centre is not a newly re-opened meteorological eye.  Keep the
      // satellite/precipitation architecture explicitly broken until the user requests the
      // dedicated core-rebuild burst.
      if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12 && predictedEyeVmax >= 24.5) {
        eyePhase = "ragged";
      }

      let eyeType: Typhoon["eyeType"] = "none";
      if (eyePhase !== "none") {
        if (!manualCoreRebuildBurst && terrainHollowCoreMemory >= 0.12) eyeType = "broken";
        else if (ewrcFailureMode === "inner_collapse_outer_stalls" && eyeRadiusKm > rmw * 0.9) eyeType = "large_round";
        else if (ewrcFailure || eyewallIntegrity < 0.25) eyeType = "broken";
        else if (eyeObstruction > 0.68 || landEyeStress > 0.55 || eyewallOpenSectorFraction > 0.58) eyeType = "gap";
        else if (eyeAsymmetry > 0.55 || shearEyeStress > 0.60 || eyewallOpenSectorFraction > 0.34) eyeType = "eccentric";
        else if (eyeClearance > 0.60 && eyeRadiusKm <= 16.5) eyeType = "small_round";
        else if (eyeClearance > 0.52) eyeType = "large_round";
        else eyeType = "irregular";
      }

      ty.secondaryEyewallStrength = secondaryEyewallStrength;
      ty.eyewallIntegrity = eyewallIntegrity;
      ty.eyewallWrapProgress = eyewallWrapProgress;
      ty.eyeFormationMemory = eyeFormationMemory;
      ty.eyeWarmCore = eyeWarmCore;
      ty.eyeAsymmetry = eyeAsymmetry;
      ty.eyeObstruction = eyeObstruction;
      ty.eyeClearance = eyeClearance;
      ty.eyeRadiusKm = eyeRadiusKm;
      ty.eyeBrightnessTempC = eyeBrightnessTempC;
      ty.eyePhase = eyePhase;
      ty.eyeType = eyeType;
      ty.isEyeClogged = eyePhase === "blocked" || (eyeObstruction > 0.76 && predictedEyeVmax >= 30.0);
      ty.structureMode = structureMode;
      ty.coreCompactness = clamp01(coreCompactness);
      ty.convectiveBurstIndex = clamp01(convectiveBurstIndex);
      ty.rainbandDominance = clamp01(rainbandDominance);
      ty.outflowEfficiency = clamp01(outflowEfficiency);
      ty.coreRebuildScar = clamp01(coreRebuildScar);
      ty.terrainHollowCoreMemory = clamp01(terrainHollowCoreMemory);
      ty.terrainHollowCoreBearingDeg = ((terrainHollowCoreBearingDeg % 360) + 360) % 360;
      ty.damageOrigin = damageOrigin;
      ty.ewrcFailureMode = ewrcFailureMode;
      ty.broadMoisturePlatform = clamp01(broadMoisturePlatform);
      ty.coastalCoreInfluence = clamp01(coastalCoreInfluence);
      ty.warmConveyorBeltStrength = clamp01(warmConveyorBeltStrength);
      ty.northeastCloudStripping = clamp01(northeastCloudStripping);
      ty.llccExposure = clamp01(llccExposure);
      ty.asymmetricReburstStrength = clamp01(asymmetricReburstStrength);
      ty.asymmetricReburstBearingDeg = ((asymmetricReburstBearingDeg % 360) + 360) % 360;
      ty.ewrcStandoffStrength = clamp01(ewrcStandoffStrength);
      ty.giantEyeOuterWallMemory = clamp01(giantEyeOuterWallMemory);
      ty.brownOceanBurstIndex = clamp01(brownOceanBurstIndex);
      ty.landfallOuterRainbandIndex = clamp01(landfallOuterRainbandIndex);
      ty.coreGeometryContinuity = clamp01(coreGeometryContinuity);
      ty.terrainFrictionWork = Math.max(0, terrainFrictionWork);
      ty.terrainBlockingMemory = clamp01(terrainBlockingMemory);
      ty.terrainFrictionAsymmetry = clamp01(terrainFrictionAsymmetry);
      ty.terrainCoreLandFraction = clamp01(terrainCoreLandFraction);
      ty.terrainMountainFraction = clamp01(terrainMountainFraction);
      ty.terrainMaxCoreElevation = Math.max(0, terrainMaxCoreElevation);
      ty.terrainInteractionBearingDeg = ((terrainInteractionBearingDeg % 360) + 360) % 360;
      ty.dryAirWrapFraction = clamp01(dryAirWrapFraction);
      ty.moistEnvelopeIntegrity = clamp01(moistEnvelopeIntegrity);
      ty.innerCoreMoisture = clamp01(innerCoreMoisture);
      ty.eyewallOpenSectorFraction = clamp01(eyewallOpenSectorFraction);
      ty.deepConvectiveCoverage = clamp01(deepConvectiveCoverage);
      ty.lowLevelVortexIntegrity = clamp01(lowLevelVortexIntegrity);
      ty.postPeakEnvelopeMemory = clamp01(postPeakEnvelopeMemory);
      ty.peakVmaxMemory = peakVmaxMemory;
      ty.dryAirLifecyclePhase = dryAirLifecyclePhase;
      ty.dryAirVentilationIndex = clamp01(dryAirVentilationIndex);
      ty.dryAirCoreConnection = clamp01(dryAirCoreConnection);
      ty.dryAirReMoistening = clamp01(dryAirReMoistening);
      ty.dryAirConvectiveArcBearingDeg = ((dryAirConvectiveArcBearingDeg % 360) + 360) % 360;
      ty.eyewallColdPoolMemory = clamp01(eyewallColdPoolMemory);

      // Refresh the coarse structural class from the *current* local EWRC/eye state.  The previous
      // legacy assignment occurred before EWRC transitions and could lag one simulation step.
      if (predictedEyeVmax < 17.2 && !metrics.isLand) ty.structuralState = 1;
      else if (isStructureDamaged || ty.isStructureDamaged || ewrcFailure) ty.structuralState = ewrcFailure ? 5 : 7;
      else if (metrics.isLand) ty.structuralState = 6;
      else if (ewrcForming || ewrcSuccessRecovery) ty.structuralState = 4;
      else if (upwellingCooling > 1.2) ty.structuralState = 3;
      else ty.structuralState = 2;

      // A disrupted or cloud-filled core does not create an extra arbitrary wind penalty, but it does
      // reduce how efficiently favorable thermodynamics can be converted to further intensification.
      // Environmental weakening calculated above remains untouched.
      if (vmaxDeltaPerHour > 0 && predictedEyeVmax >= 31.5) {
        const organizationEfficiency = 0.70 + 0.30 * eyewallIntegrity;
        const obstructionEfficiency = 1.0 - 0.25 * clamp01((eyeObstruction - 0.25) / 0.75);
        const asymmetryEfficiency = 1.0 - 0.14 * eyeAsymmetry;
        vmaxDeltaPerHour *= organizationEfficiency * obstructionEfficiency * asymmetryEfficiency;
      }

      // C. Extratropical Transition (ET / 温带化)
      // ET is a finite-time structural conversion, not a hard latitude switch.  The previous model
      // waited until the centre was already close to / north of the nominal westerly axis before it
      // could build a strong ET target, so otherwise realistic recurving storms often completed ET
      // several degrees too far poleward.  Here the *precursor* baroclinic interaction begins on the
      // southern flank of the westerlies, while completion still requires a combination of frontal
      // forcing, shear/translation/cold-water support and loss of tropical-core symmetry.
      const etWesterlyIngress = westerlyRegimeActive
        ? smoothstep01(clamp01(westerlyDepth / 0.65))
        : smoothstep01(clamp01((newLat - 27.0) / 10.0));
      const etLatitudeGate = config.newEnvironmentPhysicsEnabled
        ? smoothstep01(clamp01(westerlyDepth / 0.72))
        : (config.westerliesEnabled
            ? smoothstep01(clamp01((newLat - ((config.westerliesLat ?? 30.0) - 5.0)) / 10.0))
            : smoothstep01(clamp01((newLat - 27.0) / 11.0)));
      const etShearGate = smoothstep01(clamp01((shearVal - 8.0) / 18.0));
      const etTranslationGate = smoothstep01(clamp01((speedKmh - 16.0) / 30.0));
      const etColdOceanGate = smoothstep01(clamp01((27.5 - sstVal) / 5.5));
      const etBaroclinicGate = clamp01(
        0.42 * etWesterlyIngress +
        0.24 * etShearGate +
        0.18 * etTranslationGate +
        0.16 * etColdOceanGate
      );
      const etStructuralGate = clamp01(
        0.32 * eyeAsymmetry + 0.22 * (1.0 - eyewallIntegrity) +
        0.20 * structuralDisorganization + 0.16 * westerlyStress +
        0.10 * (1.0 - clamp01(moistureReservoir))
      );
      const tropicalCoreResistance = clamp01(
        0.42 * eyeWarmCore + 0.24 * eyewallIntegrity + 0.20 * moistureReservoir + 0.14 * coreCompactness
      );
      let etTarget = clamp01(
        etLatitudeGate * (0.24 + 0.46 * etBaroclinicGate + 0.30 * etStructuralGate) +
        0.16 * etWesterlyIngress * etBaroclinicGate -
        0.16 * tropicalCoreResistance * (1.0 - etLatitudeGate)
      );

      // Once a cyclone is deeply embedded in a genuine baroclinic/frontal regime, the conversion
      // should continue on a roughly synoptic (several-to-~18 h) time scale rather than waiting for
      // latitude alone to push the target upward.  The floor is conditional, so a compact warm-core
      // storm under weak shear can still resist ET while moving poleward.
      if (etLatitudeGate > 0.62 && etBaroclinicGate > 0.50) {
        etTarget = Math.max(etTarget, clamp01(
          0.56 + 0.20 * etBaroclinicGate + 0.15 * etStructuralGate + 0.08 * etWesterlyIngress
        ));
      }
      if (westerlyRegimeActive && (config.newEnvironmentPhysicsEnabled ? westerlyDepth > 0.74 : newLat >= (config.westerliesLat ?? 30.0) + 4.0) && etBaroclinicGate > 0.42) {
        etTarget = Math.max(etTarget, 0.88 + 0.08 * etStructuralGate);
      }
      if (coldAirWarmCoreDestroyed) {
        // ROUND105: preserve the already-calibrated post-destruction intensity tendency without
        // treating the result as subtropical/ET.  This scalar remains an internal decay-coupling
        // proxy only; cyclone nature, fronts and the wind-field morphology are overridden to a
        // non-cyclonic remnant low once the 32 kt outbreak destroys the warm core.
        etTarget = Math.max(etTarget, 0.985);
      }
      if (config.etEnabled === false && !coldAirWarmCoreDestroyed) etTarget = 0;

      const etGrowthTauBase = Math.max(4.6, Math.min(10.0,
        7.1 + 4.4 * tropicalCoreResistance - 2.6 * etBaroclinicGate - 1.1 * etStructuralGate
      ));
      const etGrowthTau = coldAirWarmCoreDestroyed ? Math.min(9.0, etGrowthTauBase) : etGrowthTauBase;
      const etTau = etTarget > priorEtTransition ? etGrowthTau : 36.0;
      let extrTransition = (config.etEnabled === false && !coldAirWarmCoreDestroyed)
        ? 0
        : clamp01(priorEtTransition + (etTarget - priorEtTransition) *
          (1 - Math.exp(-stepFraction / etTau)));

      // Below 15 m/s, dissipation becomes progressively slower down to the 5 m/s model floor
      // rather than hitting the former 10.8 m/s discontinuity.
      if (vmaxDeltaPerHour < 0 && ty.vmax < 15.0) {
        const lowWindBlend = smoothstep01((ty.vmax - MIN_CYCLONE_INTENSITY_MS) / (15.0 - MIN_CYCLONE_INTENSITY_MS));
        const lowWindDecayFactor = 0.16 + 0.84 * lowWindBlend;
        vmaxDeltaPerHour *= lowWindDecayFactor;
      }

      // A broadened/damaged circulation spreads available energy over a larger area, reducing
      // peak-wind conversion efficiency until the center reorganizes. The user size control is
      // only a structural preference: compact vortices concentrate angular momentum somewhat
      // more efficiently, while broad vortices favor outer-wind/rainband growth over peak Vmax.
      if (vmaxDeltaPerHour > 0 && (ty.circulationExpansion ?? 0) > 0) {
        vmaxDeltaPerHour *= 1.0 - 0.28 * clamp01(ty.circulationExpansion ?? 0);
      }
      if (vmaxDeltaPerHour > 0) {
        vmaxDeltaPerHour *= 1.0 + 0.07 * sizePreference.compact - 0.09 * sizePreference.broad;
      }

      // Weak disturbances / tropical depressions organize far less efficiently than a mature
      // closed warm core. Below 18 m/s retain only 24-50% of the otherwise-normal positive rate.
      if (!playgroundMode && vmaxDeltaPerHour > 0 && ty.vmax < 18.0) {
        const weakDevelopmentFraction = 0.24 + 0.26 * smoothstep01((ty.vmax - MIN_CYCLONE_INTENSITY_MS) / (18.0 - MIN_CYCLONE_INTENSITY_MS));
        vmaxDeltaPerHour *= weakDevelopmentFraction;
      }

      // Playground mode: positive development runs at 800% of the otherwise-computed setting
      // and has no hard/soft upper intensity limiter. Normal mode keeps the calibrated cap.
      if (playgroundMode && vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= 8.0;
      if (!playgroundMode) {
        const livePositiveCeiling = rapidIntensifying && ty.rapidIntensificationMode === "uri"
          ? URI_RATE_MAX
          : 2.2;
        if (vmaxDeltaPerHour > livePositiveCeiling) vmaxDeltaPerHour = livePositiveCeiling;
      }

      // Shallow-shelf negative feedback: strong cyclones entering the East China/Yellow Sea shelf
      // churn a relatively shallow warm layer and more readily expose colder subsurface water.
      // This is a soft physical brake, not a 62 m/s hard ceiling.
      if (!playgroundMode && !metrics.isLand) {
        const shelfR7Mean = r7 ? (r7.ne + r7.se + r7.sw + r7.nw) / 4 : Math.max(120, ty.vmax * 5.0);
        const shelfMixingStress = getEastChinaShelfMixingStress(newLat, newLon, ty.vmax, speedKmh, shelfR7Mean, ohcVal);
        if (shelfMixingStress > 0.02) {
          if (vmaxDeltaPerHour > 0) {
            const highIntensityBrake = smoothstep01(clamp01((ty.vmax - 58.0) / 8.0));
            vmaxDeltaPerHour *= 1 - shelfMixingStress * (0.24 + 0.18 * highIntensityBrake);
          }
          if (ty.vmax > 62.0) {
            vmaxDeltaPerHour -= shelfMixingStress * (0.006 + 0.016 * clamp01((ty.vmax - 62.0) / 10.0));
          }
        }
      }

      // Active EWRC intensity invariant (3.3.25): once concentric eyewalls are exchanging
      // dominance, Vmax cannot continue rising. Most cycles weaken modestly; only exceptionally
      // favorable, well-organized cycles can be nearly steady for part of the exchange. Stronger
      // reintensification is permitted only after the outer wall has completed takeover.
      if (ewrcState === "forming" || ewrcState === "max_decay") {
        const ewrcHoldQuality = clamp01(
          0.27 * clamp01((sstVal - 27.0) / 2.0) +
          0.20 * clamp01(ohcVal / 115) +
          0.17 * clamp01((rhVal - 58) / 24) +
          0.18 * clamp01((17 - shearVal) / 11) +
          0.18 * clamp01(outflowEfficiency)
        );
        const rareNearSteady = ewrcHoldQuality > 0.91 && !metrics.isLand &&
          terrainHollowCoreMemory < 0.08 && coreRebuildScar < 0.12 && !ty.ewrcIsFailure;
        if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour = 0;
        if (!rareNearSteady && vmaxDeltaPerHour > -0.025) {
          const phaseWeakeningFloor = -(0.025 + 0.055 * Math.pow(Math.sin(Math.PI * clamp01(ewrcProgress)), 1.2));
          vmaxDeltaPerHour = phaseWeakeningFloor;
        }
      }

      // Re-apply the exact target bound after later structural/size modifiers as a final tendency guard.
      // This keeps the target invariant intact even if future modifiers are inserted between the
      // pre-structure guard and state integration.
      if (isTargetIntensityCapActive(config) && maxLimit !== undefined) {
        const targetGap = maxLimit - ty.vmax;
        if (targetGap < 0 && vmaxDeltaPerHour > -0.04) {
          vmaxDeltaPerHour = -0.04;
        } else if (vmaxDeltaPerHour > 0) {
          if (targetGap <= 0) vmaxDeltaPerHour = 0;
          else vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, targetGap / Math.max(stepFraction, 1e-6));
        }
      }

      // 3.3.25 inland tropical-storm soft shelf. Kaplan-DeMaria-style land decay is broadly
      // exponential, but the low-level circulation and moisture reservoir can persist much longer
      // than the compact hurricane core. China cases such as Lekima (44 h at TS-or-higher over
      // land) and Bavi (18 m/s while crossing Shandong with little change) motivate a conditional
      // ~17-19 m/s slowdown. It is no longer restricted to plains/hills: the main exclusion is a
      // genuinely high/rugged mountain crossing that destroys the residual vortex.
      let plainTsShelfHours = Math.max(0, ty.plainTsShelfHours ?? 0);
      let plainTsShelfMemory = clamp01(ty.plainTsShelfMemory ?? 0);
      if (metrics.isLand && !ty.manualForcedDecay) {
        const shelfTerrain = getEtopoTerrainDiagnostics(newLat, newLon);
        const plainSupport = clamp01(Math.max(
          shelfTerrain?.plainScore ?? 0,
          shelfTerrain?.lowerYangtzePlainSupport ?? 0,
          shelfTerrain?.northChinaPlainSupport ?? 0
        ));
        const namedPlain = Math.max(shelfTerrain?.lowerYangtzePlainSupport ?? 0, shelfTerrain?.northChinaPlainSupport ?? 0);
        const localElevation = shelfTerrain?.elevation ?? metrics.elevation ?? 0;
        const localRelief = shelfTerrain?.localReliefM ?? 0;
        const highMountainGate = clamp01(Math.max(
          (localElevation - 850) / 950,
          (localRelief - 900) / 1000,
          terrainMountainFraction * 1.05,
          (terrainMaxCoreElevation - 1400) / 1600,
          (terrainBlockingMemory - 0.58) / 0.38
        ));
        const nonMountainSupport = 1 - smoothstep01(highMountainGate);

        const shelfR7 = r7 ? Math.max(0, (r7.ne + r7.se + r7.sw + r7.nw) / 4) : 0;
        const circulationSizeGate = shelfR7 > 0
          ? 0.28 + 0.72 * smoothstep01(clamp01((shelfR7 - 110) / 250))
          : 0.34;
        const residualCirculationGate = clamp01(
          0.34 * circulationSizeGate + 0.42 * lowLevelVortexIntegrity + 0.24 * postPeakEnvelopeMemory
        );
        const moistureGate = clamp01((rhVal - 46) / 33) * clamp01((moistureReservoir - 0.10) / 0.72);
        const shearGate = clamp01((29.0 - shearVal) / 17.0);
        const dryGate = 1 - clamp01((dryAirIntrusion - 0.30) / 0.58);
        const shelfRadius = Math.max(180, Math.min(450, shelfR7 > 0 ? shelfR7 * 0.90 : 230));
        const shelfLandFraction = getLandCoverage(newLat, newLon, shelfRadius, config?.coastlineSource);
        const marineOverlap = clamp01((0.98 - shelfLandFraction) / 0.78);
        const westerlyShelfFactor = 1.0 - 0.24 * westerlyStress;
        const hostileShelfEnvironment = isHardEnvironmentalSuppression ||
          !!ty.ewrcIsFailure || ewrcState === "penalty_failure";
        const targetRequestsBelowShelf = isTargetIntensityCapActive(config) && maxLimit !== undefined && maxLimit < 17.2;

        // Even far inland, a coherent residual vortex gets a baseline shelf opportunity. Plains
        // extend it because friction/terrain blocking is small; marine overlap and moist advection
        // help but are no longer mandatory. High mountains are the genuine structural veto.
        const instantaneousSupport = hostileShelfEnvironment || targetRequestsBelowShelf ? 0 : clamp01(
          nonMountainSupport * residualCirculationGate *
          (0.30 + 0.16 * moistureGate + 0.10 * shearGate + 0.07 * dryGate +
           0.08 * marineOverlap + 0.08 * clamp01(broadMoisturePlatform) +
           0.11 * lowLevelVortexIntegrity + 0.08 * postPeakEnvelopeMemory +
           0.12 * plainSupport + 0.06 * namedPlain) *
          westerlyShelfFactor
        );
        const memoryTau = instantaneousSupport >= plainTsShelfMemory ? 2.8 : 14.0;
        const memoryAlpha = 1 - Math.exp(-stepFraction / memoryTau);
        plainTsShelfMemory = clamp01(plainTsShelfMemory + (instantaneousSupport - plainTsShelfMemory) * memoryAlpha);

        if (ty.vmax < 20.4 && ty.vmax >= 16.2) {
          // 3.3.26: shorten the former TS soft shelf. Coastal overlap and a broad residual vortex
          // can still sustain it, while deep inland / small-vortex cases lose the shelf much more
          // quickly. The shelf only slows weakening and never manufactures wind.
          const deepInlandGate = smoothstep01(clamp01((shelfLandFraction - 0.72) / 0.25));
          const compactVortexGate = 1 - circulationSizeGate;
          // 4.1.2: the plain-terrain ~18 m/s residual shelf is deliberately shorter. A broad
          // circulation that still overlaps the sea can keep a limited residence time, but an
          // ordinary inland TS now leaves the shelf several hours earlier instead of lingering.
          const residenceBudgetHours = Math.max(4.0, Math.min(22.5,
            6.5
            + 4.8 * marineOverlap
            + 4.4 * circulationSizeGate
            + 3.2 * clamp01(postPeakEnvelopeMemory)
            + 2.1 * clamp01(lowLevelVortexIntegrity)
            + 1.7 * plainSupport
            + 1.3 * namedPlain
            - 6.2 * deepInlandGate
            - 3.8 * compactVortexGate
            - 8.5 * highMountainGate
          ));
          const residenceFade = 1 - 0.88 * smoothstep01(clamp01(
            (plainTsShelfHours - residenceBudgetHours) / Math.max(4.0, 7.5 + 6.0 * marineOverlap + 4.5 * circulationSizeGate)
          ));
          const effectiveSupport = clamp01(Math.max(instantaneousSupport, 0.92 * plainTsShelfMemory) * residenceFade);
          if (effectiveSupport > 0.13 && nonMountainSupport > 0.18 && residualCirculationGate > 0.18) {
            const shelfTarget = 17.72 + 1.10 * effectiveSupport + 0.18 * namedPlain;
            const aboveShelf = ty.vmax - shelfTarget;
            let shelfTendency: number;
            if (aboveShelf > 1.15) {
              shelfTendency = -Math.min(0.18, 0.055 + 0.070 * aboveShelf);
            } else if (aboveShelf > 0) {
              shelfTendency = -(0.0025 + 0.017 * (aboveShelf / 1.15)) * (1.0 - 0.76 * effectiveSupport);
            } else {
              shelfTendency = -0.0022 * (1.0 - 0.78 * effectiveSupport);
            }
            const engage = smoothstep01(clamp01((20.4 - ty.vmax) / 1.55)) *
              smoothstep01(clamp01((effectiveSupport - 0.10) / 0.38)) *
              nonMountainSupport;
            vmaxDeltaPerHour += (Math.max(vmaxDeltaPerHour, shelfTendency) - vmaxDeltaPerHour) * engage;
            if (ty.vmax <= 20.0 && ty.vmax >= 17.25 && engage > 0.24) {
              plainTsShelfHours = Math.min(96, plainTsShelfHours + stepFraction);
            }
          } else {
            plainTsShelfHours = Math.max(0, plainTsShelfHours - 0.20 * stepFraction);
          }
        } else if (ty.vmax >= 20.4) {
          plainTsShelfHours = Math.max(0, plainTsShelfHours - 0.45 * stepFraction);
        } else {
          plainTsShelfHours = Math.max(0, plainTsShelfHours - 0.75 * stepFraction);
        }
      } else {
        plainTsShelfMemory = Math.max(0, plainTsShelfMemory - stepFraction / 9.5);
        plainTsShelfHours = Math.max(0, plainTsShelfHours - stepFraction);
      }

      // 3.5.9 cold-water residual-vortex shelf. Crossing a cold pool/eddy removes oceanic
      // enthalpy and rapidly collapses deep convection, but the broad low-level circulation
      // can survive for a while near low tropical-storm strength. This is deliberately a
      // weakening SLOWDOWN only: it can never add positive Vmax tendency or create a TS.
      if (!metrics.isLand && !playgroundMode && !ty.manualForcedDecay) {
        const coldTrigger = clamp01(Math.max(coldWaterStress, (26.4 - sstVal) / 3.2));
        const residualVortex = clamp01(
          0.48 * lowLevelVortexIntegrity +
          0.24 * postPeakEnvelopeMemory +
          0.16 * moistureReservoir +
          0.12 * clamp01((rhVal - 42) / 36)
        );
        const hostileColdShelf = isHardEnvironmentalSuppression || !!ty.ewrcIsFailure ||
          ewrcState === "penalty_failure" || dryAirCoreExposure > 0.78 || shearVal > 34;
        const instantaneousColdSupport = hostileColdShelf ? 0 : clamp01(
          coldTrigger * residualVortex *
          (0.74 + 0.16 * clamp01(postPeakEnvelopeMemory) + 0.10 * clamp01(broadMoisturePlatform))
        );
        const coldMemoryTau = instantaneousColdSupport >= coldWaterTsShelfMemory ? 3.2 : 12.0;
        const coldMemoryAlpha = 1 - Math.exp(-stepFraction / coldMemoryTau);
        coldWaterTsShelfMemory = clamp01(
          coldWaterTsShelfMemory + (instantaneousColdSupport - coldWaterTsShelfMemory) * coldMemoryAlpha
        );

        if (ty.vmax < 20.2 && ty.vmax >= 16.0 && coldTrigger > 0.10) {
          const residenceBudgetHours = Math.max(5, Math.min(28,
            6.5 + 9.0 * residualVortex + 5.0 * clamp01(postPeakEnvelopeMemory) +
            4.0 * clamp01(moistureReservoir) - 5.0 * clamp01((coldTrigger - 0.55) / 0.45)
          ));
          const residenceFade = 1 - 0.84 * smoothstep01(clamp01(
            (coldWaterTsShelfHours - residenceBudgetHours) / Math.max(5, 11 + 5 * residualVortex)
          ));
          const effectiveColdSupport = clamp01(
            Math.max(instantaneousColdSupport, 0.90 * coldWaterTsShelfMemory) * residenceFade
          );
          if (effectiveColdSupport > 0.10 && residualVortex > 0.22) {
            const shelfTarget = 17.15 + 0.90 * effectiveColdSupport;
            const aboveShelf = ty.vmax - shelfTarget;
            let shelfTendency = -0.0035 * (1 - 0.70 * effectiveColdSupport);
            if (aboveShelf > 1.15) shelfTendency = -Math.min(0.22, 0.065 + 0.078 * aboveShelf);
            else if (aboveShelf > 0) shelfTendency = -(0.004 + 0.020 * aboveShelf / 1.15) * (1 - 0.68 * effectiveColdSupport);
            // Never strengthen a system below the target: the shelf only caps the magnitude
            // of negative tendencies inherited from cold-water thermodynamic suppression.
            shelfTendency = Math.min(0, shelfTendency);
            const engage = smoothstep01(clamp01((20.2 - ty.vmax) / 1.65)) *
              smoothstep01(clamp01((effectiveColdSupport - 0.07) / 0.36));
            vmaxDeltaPerHour += (Math.max(vmaxDeltaPerHour, shelfTendency) - vmaxDeltaPerHour) * engage;
            if (ty.vmax <= 19.8 && ty.vmax >= 17.0 && engage > 0.22) {
              coldWaterTsShelfHours = Math.min(72, coldWaterTsShelfHours + stepFraction);
            }
          } else {
            coldWaterTsShelfHours = Math.max(0, coldWaterTsShelfHours - 0.25 * stepFraction);
          }
        } else if (ty.vmax >= 20.2) {
          coldWaterTsShelfHours = Math.max(0, coldWaterTsShelfHours - 0.45 * stepFraction);
        } else {
          coldWaterTsShelfHours = Math.max(0, coldWaterTsShelfHours - 0.70 * stepFraction);
        }
      } else {
        coldWaterTsShelfMemory = Math.max(0, coldWaterTsShelfMemory - stepFraction / 8.5);
        coldWaterTsShelfHours = Math.max(0, coldWaterTsShelfHours - stepFraction);
      }

      // ROUND104 split-path invariant: ordinary poleward ET may intensify from baroclinic energy,
      // but a warm core physically destroyed by strong cold air can never regain peak wind.
      const etNoIntensification = coldAirWarmCoreDestroyed;
      if (etNoIntensification && vmaxDeltaPerHour > 0) vmaxDeltaPerHour = 0;

      // Round170: any enhancement mechanism (ordinary, RI/ERI/URI, playground)
      // obeys the same reduced strengthening efficiency above 68 m/s.
      if (vmaxDeltaPerHour > 0 && ty.vmax + vmaxDeltaPerHour * stepFraction > 68) {
        const belowThreshold = Math.max(0, 68 - ty.vmax);
        vmaxDeltaPerHour = (belowThreshold + (vmaxDeltaPerHour * stepFraction - belowThreshold) * (2 / 3)) / stepFraction;
      }
      let newVmax = ty.vmax + vmaxDeltaPerHour * stepFraction;
      if (isTargetIntensityCapActive(config) && maxLimit !== undefined) {
        if (ty.vmax <= maxLimit) {
          newVmax = Math.min(maxLimit, newVmax);
        } else {
          newVmax = Math.max(maxLimit, newVmax);
        }
      }

      // Genesis organisation shelf: only suppress *positive* tendency. Hostile conditions may
      // still weaken the vortex, but an 18 m/s user placement cannot instantly jump above the
      // selected analysis strength before its shallow circulation has had time to organise.
      const genesisElapsedHours = Math.max(0, currentSimHourFloat - Number(ty.seasonStartHour ?? 0));
      const genesisHoldHours = Math.max(0, Number(ty.genesisIntensityHoldHours ?? 0));
      const genesisReference = Number(ty.genesisIntensityReference ?? ty.vmax);
      if (genesisHoldHours > 0 && genesisElapsedHours < genesisHoldHours && Number.isFinite(genesisReference)) {
        newVmax = Math.min(newVmax, genesisReference);
      }

      // Numerical safety guard: prevent crashes from NaN/Infinity
      if (isNaN(newVmax) || !isFinite(newVmax)) {
        newVmax = ty.vmax || 10;
      }

      if (ewrcFailureRestoredVmax !== null) {
        newVmax = ewrcFailureRestoredVmax;
      }

      // Track Super Typhoon land duration
      let superTyLandHours = ty.superTyLandHours || 0;
      if (metrics.isLand && newVmax >= 51.0) {
        if (speedKmh < 30.0) {
          superTyLandHours += stepFraction;
        }
      } else {
        superTyLandHours = 0;
      }

      // Limit Super Typhoon on land duration under 8 hours (when speed is < 30km/h)
      if (superTyLandHours >= 8.0 && newVmax >= 51.0) {
        newVmax = 50.8;
        if ((ty.superTyLandHours || 0) < 8.0) {
          logs.push({
            id: `super-ty-land-decay-${ty.id}-${currentSimHour}`,
            time: new Date(),
            simHour: currentSimHour,
            type: "warning",
            message: `⚠️ 强衰减提示：${ty.name} 登陆后在陆地上以低于 30 km/h 的移速维持超强台风级别已达 8 小时，受地形剧烈摩擦与充沛水分断绝影响，强度已被强制降级至强台风。`
          });
        }
      }

      // During ET, tropical peak-wind production fades but baroclinic conversion can support a broad
      // gale/storm-force circulation. Blend toward that dynamically diagnosed target rather than
      // clipping Vmax the instant an arbitrary ET threshold is crossed.
      if (!playgroundMode && extrTransition > 0.28) {
        const baroclinicWindTarget = 16.5 + 14.0 * etBaroclinicGate +
          6.0 * clamp01((speedKmh - 20.0) / 35.0) + 4.0 * westerlyDepth;
        const etWindBlend = smoothstep01((extrTransition - 0.28) / 0.72);
        const etAdjust = (baroclinicWindTarget - newVmax) * etWindBlend *
          (1 - Math.exp(-stepFraction / (15.0 - 5.0 * etBaroclinicGate)));
        newVmax += etAdjust;

        // Passive explosive deepening: on the normal recurvature path, strong baroclinic coupling
        // can briefly add wind even while tropical convection is dispersing.  It peaks during the
        // late-subtropical / early-frontal phase and vanishes for cold-air-destroyed warm cores.
        if (!coldAirWarmCoreDestroyed) {
          const baroclinicBurstPhase = smoothstep01((extrTransition - 0.38) / 0.26) *
            (1 - 0.58 * smoothstep01((extrTransition - 0.90) / 0.10));
          const baroclinicBurstPotential = clamp01(
            0.40 * etBaroclinicGate + 0.24 * etWesterlyIngress +
            0.20 * etTranslationGate + 0.16 * etShearGate
          );
          const burstWave = Math.max(0, Math.sin((westerlyInteractionHours - 2.5) * Math.PI / 11.0));
          const passiveBaroclinicGain = (0.08 + 0.44 * baroclinicBurstPotential) *
            baroclinicBurstPhase * burstWave * stepFraction;
          const passiveBurstCeiling = 27.0 + 11.0 * baroclinicBurstPotential;
          if (newVmax < passiveBurstCeiling) {
            newVmax += Math.min(passiveBaroclinicGain, Math.max(0, passiveBurstCeiling - newVmax));
          }
        }
      }

      if (manualEtBurst) {
        // User-requested burst in a normal subtropical/ET cyclone is a baroclinic deepening pulse,
        // not tropical RI.  Permit a broad storm-force response while avoiding tropical-URI winds.
        const manualEtCeiling = 31.0 + 7.0 * clamp01(etBaroclinicGate + 0.25 * westerlyDepth);
        newVmax = Math.min(manualEtCeiling, Math.max(ty.vmax, newVmax));
      }

      // Only the cold-air warm-core-destruction path is permanently barred from strengthening.
      if (coldAirWarmCoreDestroyed) {
        newVmax = Math.min(ty.vmax, newVmax);
      }

      // Absolute limiters. Playground mode deliberately bypasses upper-intensity ceilings, but the
      // universal model floor is now 5 m/s. ET has no artificial 12 m/s lower shelf.
      if (!playgroundMode && extrTransition >= 0.96) {
        newVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(38, newVmax));
      } else {
        newVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, newVmax);
        // Requirement 2: Once intensity is at or below maxLimit, strictly cap re-growth so it NEVER exceeds target maxLimit
        if (!manualEtBurst && isTargetIntensityCapActive(config)) {
          if (ty.vmax <= maxLimit) {
            newVmax = Math.min(maxLimit, newVmax);
          } else {
            newVmax = Math.min(newVmax, ty.vmax);
          }
        }
      }

      // D. Landfall and Dissipation Checks
      let landed = ty.landed;
      let landfallRecords = ty.landfallRecords ? [...ty.landfallRecords] : [];
      const reportableLandfallContact = metrics.isLand && !isMinorIslandOperationalIgnored(newLat, newLon);
      if (reportableLandfallContact && !landed) {
        landed = true;
        const recIndex = landfallRecords.length;
        const initialRegion = metrics.landName && metrics.landName !== "陆地"
          ? metrics.landName
          : getDetailedLandName(newLat, newLon, "", "");
        landfallRecords.push({
          lat: newLat,
          lon: newLon,
          vmax: Number(newVmax.toFixed(1)),
          simHour: Number(currentSimHourFloat.toFixed(1)),
          region: initialRegion
        });
        // Requirement 3: Fetch precision OSM city data on demand (lazily) to avoid unnecessary performance overhead
        fetchOsmCityName(newLat, newLon).then((osmName) => {
          // `landfallRecords` is the same array reference assigned to the updated state below,
          // so the late reverse-geocoder can refine the live/replay label without mutating stale `ty`.
          if (osmName && landfallRecords[recIndex]) landfallRecords[recIndex].region = osmName;
        }).catch(() => {});
        logs.push({
          id: `land-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "danger",
          message: `🚨 台风登陆：${ty.name} 已经在【${initialRegion}】附近沿海登陆，最大风力 ${Math.round(newVmax)} m/s (约${getWindForceCategory(newVmax)}级)。受地形摩擦与水分切断，强度开始剧烈衰减！`
        });
      } else if (!reportableLandfallContact && landed) {
        // Re-enters sea or passes over an operationally ignored tiny island.
        landed = false;
        logs.push({
          id: `sea-reentry-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "success",
          message: `🌊 重返海洋：${ty.name} 中心移回海洋面，开始重新整合云系。`
        });
      }

      let dissipated = ty.dissipated;
      let tdHours = ty.tdHours || 0;
      let landTdHours = ty.landTdHours || 0;
      let etHours = ty.etHours || 0;

      if (!coldAirWarmCoreDestroyed && extrTransition >= 0.8) {
        etHours += stepFraction;
      } else {
        etHours = 0;
      }

      if (newVmax < 17.2) {
        tdHours += stepFraction;
        if (metrics.isLand) {
          landTdHours += stepFraction;
        } else {
          landTdHours = 0;
        }
      } else {
        tdHours = 0;
        landTdHours = 0;
      }

      // Termination conditions:
      // 1. Landfall TD dissipation: if config mode is '6h' (default), stop after 6h as TD on land
      // 2. Extratropical Cyclone: 12 hours as ET OR (is ET and lon >= 160.0°E)
      // 3. Stays as TD for 72 hours continuously
      // 4. Crosses 170.0°E boundary
      // 5. Ocean cyclone reaches the universal 5 m/s model floor
      const landTdMode = config?.landTdDissipateMode || "6h";
      const nonLandDissipateMode = config?.nonLandDissipateMode || "normal";
      const allowNonLandAutoDissipation = nonLandDissipateMode === "normal";
      const isLandTdDissipate = landTdMode === "6h" && metrics.isLand && newVmax < 17.2 && landTdHours >= 6.0;
      const isOceanAtMinimumIntensity = !landed && !metrics.isLand && newVmax <= MIN_CYCLONE_INTENSITY_MS + 1e-6;

      if (allowNonLandAutoDissipation && isOceanAtMinimumIntensity && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-ocean-weaken-5-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 在海上减弱至 5 m/s 模型强度下限，中央气象台对其停止编号。`
        });
      } else if (allowNonLandAutoDissipation && newLon >= 218.0 && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-170e-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 已移出扩展模拟责任区东界，中央气象台对其停止编号。`
        });
      } else if (isLandTdDissipate && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-land-td-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 登陆减弱为热带低压已满 6 小时，中央气象台对其停止编号。`
        });
      } else if (allowNonLandAutoDissipation && !coldAirWarmCoreDestroyed && etHours >= 12.0 && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-et-12h-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 变性为温带气旋满 12 小时，中央气象台对其停止编号。`
        });
      } else if (allowNonLandAutoDissipation && !coldAirWarmCoreDestroyed && (etHours > 0 || extrTransition >= 0.8) && newLon >= 160.0 && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-et-160e-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 变性为温带气旋并到达东经 160º，中央气象台对其停止编号。`
        });
      } else if (allowNonLandAutoDissipation && tdHours >= 72.0 && !dissipated) {
        dissipated = true;
        newVmax = MIN_CYCLONE_INTENSITY_MS;
        logs.push({
          id: `dissipate-td-72h-${ty.id}-${currentSimHour}`,
          time: new Date(),
          simHour: currentSimHour,
          type: "info",
          message: `💤 停止编号：${ty.name} 减弱为热带低压已满 72 小时，中央气象台对其停止编号。`
        });
      }

      if (isNaN(newVmax) || !isFinite(newVmax)) newVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, ty.vmax || 18.0);
      if (isNaN(newLat) || !isFinite(newLat)) newLat = ty.lat || 20.0;
      if (isNaN(newLon) || !isFinite(newLon)) newLon = ty.lon || 135.0;

      // Center Minimum Pressure calculation (pmin) using interpolation:
      // 18m/s -> 997hpa, 68m/s -> 901hpa, etc.
      let targetPmin = calculatePressure(newVmax);
      if (isNaN(targetPmin) || !isFinite(targetPmin)) targetPmin = 998;
      
      // Keep corrupted/archive pressure values from feeding back into the next integration step.
      // A previous product bug could expose absurd negative MSLP; the model state must recover in
      // one step rather than slowly interpolating from an impossible value.
      const currentPmin = Math.max(0, Math.min(1045, Number.isFinite(ty.pmin) ? ty.pmin : 998));
      let newPmin = Math.round(currentPmin + (targetPmin - currentPmin) * 0.15);
      if (isNaN(newPmin) || !isFinite(newPmin)) newPmin = targetPmin;
      newPmin = Math.max(0, Math.min(1045, newPmin));

      // Category assessment (China Tropical Cyclone standard)
      let category = TyphoonCategory.TD;
      if (dissipated) {
        category = TyphoonCategory.DS;
      } else if (coldAirWarmCoreDestroyed) {
        category = TyphoonCategory.RL;
      } else if (extrTransition >= 0.80) {
        category = TyphoonCategory.ET;
      } else if (newVmax >= 51.0) {
        category = TyphoonCategory.SuperTY;
      } else if (newVmax >= 41.5) {
        category = TyphoonCategory.STY;
      } else if (newVmax >= 32.7) {
        category = TyphoonCategory.TY;
      } else if (newVmax >= 24.5) {
        category = TyphoonCategory.STS;
      } else if (newVmax >= 17.2) {
        category = TyphoonCategory.TS;
      }

      // A manually seeded 18 m/s system is intentionally treated as a newly organised
      // disturbance/TD for the same short shelf used by the intensity tendency. This avoids a
      // one-step TD -> TS flash immediately after placement and delays the naming latch until the
      // shallow genesis circulation has had time to consolidate.
      const genesisClassificationHoldActive = genesisHoldHours > 0 && genesisElapsedHours < genesisHoldHours;
      if (genesisClassificationHoldActive && !dissipated && !coldAirWarmCoreDestroyed && extrTransition < 0.80) {
        category = TyphoonCategory.TD;
      }

      // Naming is a one-way operational latch. A user-selected name becomes public only at the
      // first scheduled agency analysis after the cyclone has ever reached TS intensity. Once
      // named, later weakening never changes the displayed name back to “热带低压”.
      if (!hasBeenOfficiallyNamed && !genesisClassificationHoldActive && isExactlyOnThreeHour && Math.max(newVmax, ty.vmax, peakVmaxMemory || 0) >= 17.2) {
        hasBeenOfficiallyNamed = true;
        officialNamingHour = currentSimHourFloat;
      }

      // Check for level upgrades to trigger notifications/sound
      if (category !== ty.category && !dissipated) {
        const checkPriority = [TyphoonCategory.TD, TyphoonCategory.TS, TyphoonCategory.STS, TyphoonCategory.TY, TyphoonCategory.STY, TyphoonCategory.SuperTY];
        const prevIndex = checkPriority.indexOf(ty.category);
        const currIndex = checkPriority.indexOf(category);
        if (currIndex > prevIndex && prevIndex !== -1) {
          // Suppressed to keep logs focused on key milestones as requested
        } else if (currIndex < prevIndex && currIndex !== -1 && prevIndex !== -1) {
          // Suppressed to keep logs focused on key milestones as requested
        }
      }

      // Accumulate Ocean Cold Wake path coordinates - DISABLED for maximum program fluidity (Request 10) and cold wake deletion (Request 7)
      
      // Save intermediate history state at full hours. 3.7.1 deliberately never truncates
      // cyclone history: season replay, station-range reports and historical track points all
      // depend on the complete archive. Rendering layers perform their own display-only
      // decimation when a very long track would otherwise be expensive to draw.
      const nextHour = Math.round(currentSimHour + stepFraction);
      let newHistory = ty.history;

      let newForecastPath = liveForecastMode === "off" ? [] : ty.forecastPath;
      
      const lastHistoryHour = ty.history.length > 0 ? ty.history[ty.history.length - 1].simHour : -3;
      const finalRmwCeiling = giantEyeOuterWallMemory > 0.12 ? 175.0 : 90.0;
      const finalRmw = Math.max(8.0, Math.min(finalRmwCeiling, rmw));

      // Circulation-size memory: open-ocean enthalpy uptake slowly expands the outer vortex;
      // failed replacement/core damage expands it much faster. Once the inner core becomes
      // coherent again the anomaly contracts on a slower structural-recovery timescale.
      let openOceanEnergyHours = Math.max(0, ty.openOceanEnergyHours ?? 0);
      const sustainedOceanUptake = !metrics.isLand && sstVal >= 26.7 && ohcVal >= 38 && rhVal >= 56 && newVmax >= 17.2;
      if (sustainedOceanUptake) {
        openOceanEnergyHours = playgroundMode ? (openOceanEnergyHours + stepFraction) : Math.min(180, openOceanEnergyHours + stepFraction);
      } else {
        openOceanEnergyHours = Math.max(0, openOceanEnergyHours - 1.6 * stepFraction);
      }

      // Normal mode keeps the calibrated finite size anomaly. Playground removes the size ceiling:
      // long-lived oceanic energy uptake can continue broadening the outer vortex without a hard cap.
      const oceanExpansion = playgroundMode
        ? 0.16 * Math.sqrt(Math.max(0, openOceanEnergyHours) / 12.0)
        : 0.34 * clamp01(openOceanEnergyHours / 120.0);
      const failedReplacementExpansion = (ewrcState === "penalty_failure" || ewrcState === "recovering_failure" || !!ty.ewrcIsFailure) ? 0.92 : 0;
      const coreDamageSeverity = clamp01(Math.max(
        ty.isCoreDisrupted ? 0.90 : 0.0,
        (isStructureDamaged || ty.isStructureDamaged) ? 0.25 : 0.0,
        1.0 - structuralDamagePenaltyFactor
      ));
      const damagedCoreExpansion = coreDamageSeverity > 0.03
        ? (metrics.isLand ? 0.06 + 0.20 * coreDamageSeverity : 0.20 + 0.66 * coreDamageSeverity)
        : 0;
      const activeReplacementExpansion = (ewrcState === "forming" || ewrcState === "max_decay") ? 0.48 : 0;
      const broadArchitectureExpansion = clamp01(
        0.12 + 0.62 * broadMoisturePlatform + 0.34 * rainbandDominance - 0.30 * coreCompactness
        + 0.28 * sizePreference.broad - 0.11 * sizePreference.compact
      );
      const typedFailureExpansion = ewrcFailureMode === "inner_collapse_outer_stalls" ? 0.96 : ewrcFailureMode === "double_eyewall_decay" ? 0.82 : ewrcFailureMode === "outer_ring_fractures" ? 0.68 : 0;
      let expansionTarget = Math.max(oceanExpansion, failedReplacementExpansion, damagedCoreExpansion, activeReplacementExpansion, broadArchitectureExpansion, typedFailureExpansion);
      if (dryAirIntrusion > 0.28) {
        // Midlevel drying rapidly suppresses moist outer rainbands but can broaden the primary
        // circulation through the associated heating-gradient/secondary-circulation response.
        const dryVentilatedExpansion = clamp01(
          0.16 + 0.40 * dryAirIntrusion + 0.22 * dryAirCoreExposure + 0.12 * rainbandDominance
        );
        expansionTarget = Math.max(expansionTarget, dryVentilatedExpansion);
      }
      // Landfall must not create a new expansion impulse.  The pre-landfall envelope already has
      // inertia through previousExpansion/postPeakEnvelopeMemory; forcing a >=0.30 land floor made
      // the 3-hour issued radii jump outward exactly when the centre crossed the coast.  Terrain
      // now removes inner-core wind while the existing outer envelope decays on its normal memory
      // timescale, so landfall can preserve a broad circulation but cannot manufacture one.
      // Post-peak envelope inertia: dry-air erosion and landfall usually destroy the compact
      // eyewall before they erase the outer cyclonic gyre.  Hold a broad/loose circulation state
      // while low-level-vortex integrity remains high, including during a later return to sea.
      // This floor fades continuously with the diagnosed vortex memory and is not tied to Vmax.
      if (postPeakEnvelopeMemory > 0.14 && lowLevelVortexIntegrity > 0.42) {
        const residualOuterExpansion = clamp01(
          0.14 + 0.50 * postPeakEnvelopeMemory * lowLevelVortexIntegrity +
          0.12 * dryAirWrapFraction + 0.10 * structuralDisorganization
        );
        expansionTarget = Math.max(expansionTarget, residualOuterExpansion);
      }
      if (ewrcState === "recovering_success") {
        expansionTarget = Math.max(oceanExpansion, expansionTarget * 0.48);
      } else if (coreDamageSeverity < 0.38 && (ty.eyewallIntegrity ?? 0) > 0.55) {
        // Contraction begins before the damage flag fully clears, avoiding an abrupt radius jump.
        expansionTarget = Math.max(oceanExpansion, expansionTarget * (0.42 + 0.90 * coreDamageSeverity));
      }
      const previousExpansion = playgroundMode ? Math.max(0, ty.circulationExpansion ?? 0) : clamp01(ty.circulationExpansion ?? 0);
      if (metrics.isLand && !isMinorIslandWindSqueezeIgnored(newLat, newLon)) {
        // Structural damage can broaden rainbands, but land friction cannot create new angular
        // momentum. Never let the circulation-size anomaly grow after meaningful landfall; retain
        // the pre-landfall envelope briefly and then contract it continuously.
        expansionTarget = Math.min(expansionTarget, previousExpansion * 0.94);
      }
      const expansionTau = expansionTarget > previousExpansion ? 5.0 : (coreDamageSeverity > 0.20 ? 16.0 : 11.5);
      const expansionAlpha = clamp01(stepFraction / expansionTau);
      const rawCirculationExpansion = previousExpansion + (expansionTarget - previousExpansion) * expansionAlpha;
      const circulationExpansion = playgroundMode ? Math.max(0, rawCirculationExpansion) : clamp01(rawCirculationExpansion);
      const circulationChanged = Math.abs(circulationExpansion - previousExpansion) > 0.003;
      
      // Request 1: Dynamic Wind Radii update based on newly computed newVmax
      // When typhoon weakens or changes intensity, wind circles shrink continuously and proportionally
      // Hold the published wind radii between synoptic analyses. This is intentionally a step
      // change, not an animation tied to every 10-minute intensity fluctuation.
      const vmaxChanged = needRecalcRadii;
      if (vmaxChanged) {
        if (newVmax < 10.0 || dissipated) {
          r7 = { ne: 0, se: 0, sw: 0, nw: 0 };
          r10 = { ne: 0, se: 0, sw: 0, nw: 0 };
          r12 = { ne: 0, se: 0, sw: 0, nw: 0 };
        } else {
          let r10Boost = 0;
          let r12Boost = 0;
          if (ewrcState === "recovering_success") {
            r10Boost = 0.08;
            r12Boost = 0.12;
          } else if (rapidIntensifying) {
            r10Boost = 0.05;
            r12Boost = 0.08;
          }

          // Requirement 2: Structural damage mechanism no longer affects wind radii
          let structureDamageR7Scale = 1.0;
          let structureDamageR10R12Scale = 1.0;
          
          if (config.dryAirStrength && config.dryAirStrength > 0) {
             // Mid-level dry air primarily destroys convection/inner-core winds. It should not
             // instantaneously contract a broad surface gale envelope that has its own inertial
             // spin-down time. Keep only a small direct R7 response; R10/R12 remain more sensitive.
             structureDamageR7Scale *= Math.max(0.88, 1.0 - config.dryAirStrength * 0.06);
             structureDamageR10R12Scale *= Math.max(0.75, 1.0 - config.dryAirStrength * 0.12);
          }

          // Requirement 2: Outer wind radii are maintained during EWRC replacement
          const effectiveVmaxForRadii = (ewrcState === "forming" || ewrcState === "max_decay") ? Math.max(newVmax, ty.ewrcStartVmax || 0) : newVmax;

          r7 = this.calculateWindRadii(newLat, newLon, effectiveVmaxForRadii, (1.0 + 0.42 * circulationExpansion) * structureDamageR7Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false);
          
          const globalScale1012 = 0.85;

          const shrink = (r: { ne: number; se: number; sw: number; nw: number }) => ({
            ne: Math.round(r.ne * 0.68),
            se: Math.round(r.se * 0.68),
            sw: Math.round(r.sw * 0.68),
            nw: Math.round(r.nw * 0.68)
          });

          // Adjust r10 and r12 scales to match user averages
          // For STS (~220): 10: 70 (scale ~0.31)
          // For TY (~280): 10: 100 (scale ~0.35), 12: 50 (scale ~0.17)
          // For STY (~330): 10: 130 (scale ~0.39), 12: 70 (scale ~0.21)
          // For SuperTY (~380): 10: 160 (scale ~0.42), 12: 90 (scale ~0.23)
          let r10ScaleTarget = 0.35;
          let r12ScaleTarget = 0.20;
          if (effectiveVmaxForRadii > 50.9) { r10ScaleTarget = 0.42; r12ScaleTarget = 0.23; }
          else if (effectiveVmaxForRadii > 41.4) { r10ScaleTarget = 0.39; r12ScaleTarget = 0.21; }
          else if (effectiveVmaxForRadii > 32.6) { r10ScaleTarget = 0.35; r12ScaleTarget = 0.17; }
          else { r10ScaleTarget = 0.31; r12ScaleTarget = 0.0; } // <32.7 has no 12-level

          const r10_raw = effectiveVmaxForRadii >= 24.5 ? shrink(this.calculateWindRadii(newLat, newLon, effectiveVmaxForRadii, Math.max(0.20, r10ScaleTarget + r10Boost) * (1.0 + 0.28 * circulationExpansion) * structureDamageR10R12Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false)) : { ne: 0, se: 0, sw: 0, nw: 0 };
          r10 = { ne: Math.round(r10_raw.ne * 1.10), se: Math.round(r10_raw.se * 1.10), sw: Math.round(r10_raw.sw * 1.10), nw: Math.round(r10_raw.nw * 1.10) };
          const r12_raw = effectiveVmaxForRadii >= 32.7 ? shrink(this.calculateWindRadii(newLat, newLon, effectiveVmaxForRadii, Math.max(0.10, r12ScaleTarget + r12Boost) * (1.0 + 0.20 * circulationExpansion) * structureDamageR10R12Scale, u_agg, v_agg, metrics.isLand, ty.maxR7Limit, config, false)) : { ne: 0, se: 0, sw: 0, nw: 0 };
          r12 = { ne: Math.round(r12_raw.ne * 1.10), se: Math.round(r12_raw.se * 1.10), sw: Math.round(r12_raw.sw * 1.10), nw: Math.round(r12_raw.nw * 1.10) };

          const quadrants = ["ne", "se", "sw", "nw"] as const;
          for (const q of quadrants) {
            if (r10[q] > 0) {
              r10[q] = Math.min(r10[q], Math.max(15, r7[q] - 25));
            }
            if (r12[q] > 0) {
              const maxAllowedR12 = r10[q] > 0 ? (r10[q] - 25) : (r7[q] - 50);
              r12[q] = Math.min(r12[q], Math.max(15, maxAllowedR12));
            }
          }
          const previousR7Mean = ty.r7 ? (ty.r7.ne + ty.r7.se + ty.r7.sw + ty.r7.nw) / 4 : 0;
          const targetR7Mean = (r7.ne + r7.se + r7.sw + r7.nw) / 4;
          const r7TransitionAlpha = exactCirculationTransitionAnalysis
            ? 1
            : targetR7Mean < previousR7Mean && lowLevelVortexIntegrity > 0.42
              ? clamp01(0.16 + 0.26 * (1 - lowLevelVortexIntegrity) + 0.10 * (1 - postPeakEnvelopeMemory))
              : 0.52;
          const manualSizeTransitionAlpha = exactCirculationTransitionAnalysis ? 1 : 0.52;
          r7 = transitionWindRadii(ty.r7, r7, r7TransitionAlpha);
          r10 = transitionWindRadii(ty.r10, r10, manualSizeTransitionAlpha);
          r12 = transitionWindRadii(ty.r12, r12, manualSizeTransitionAlpha);
        }
      }
      // Do not erase a published wind area between analyses on an arbitrary
      // ten-minute wind-intensity threshold crossing. At issuance the new
      // physical intensity still determines force eligibility; dissipation
      // is handled separately as a terminal cyclone state.
      if (needRecalcRadii) {
        if (newVmax < 13.9) r7 = { ne: 0, se: 0, sw: 0, nw: 0 };
        if (newVmax < 24.5) r10 = { ne: 0, se: 0, sw: 0, nw: 0 };
        if (newVmax < 32.7) r12 = { ne: 0, se: 0, sw: 0, nw: 0 };
      }

      const intensityChange6h = getHistoryIntensityChange(ty.history, newVmax, nextHour, 6);
      const intensityChange24h = getHistoryIntensityChange(ty.history, newVmax, nextHour, 24);

      const updatedTy: Typhoon = {
        ...ty,
        // Keep the live cyclone self-contained too. Product generation can therefore reconstruct
        // intensity from the exact current controls even between hourly history archive points.
        configSnapshot: snapshotSimulationConfig(config),
        drawnRouteProgressKm: drawnStep?.progressKm ?? ty.drawnRouteProgressKm,
        lat: newLat,
        lon: newLon,
        vmax: newVmax, // Keep full precision for internal simulation stability
        pmin: newPmin,
        direction: dirDegrees,
        speed: speedKmh < 10 ? Number(speedKmh.toFixed(1)) : Math.round(speedKmh),
        rmw: finalRmw,
        r7,
        r10,
        r12,
        landed,
        dissipated,
        extrTransition,
        ewrcState,
        ewrcProgress,
        ewrcDuration,
        ewrcWeakenAmount,
        ewrcColdWakeHours,
        ewrcL12LandHours,
        ewrcStartVmax,
        ewrcStartRmw,
        ewrcExtraAdjust,
        ewrcRecoveryDuration,
        ewrcPenaltyTotalHours: ty.ewrcPenaltyTotalHours,
        ewrcFailurePenaltyHours: ty.ewrcFailurePenaltyHours,
        ewrcIsFailure: ty.ewrcIsFailure,
        ewrcCount: ty.ewrcCount,
        successfulEwrcCount,
        autoIntensityTarget,
        extremeIntensityHours,
        circulationExpansion: playgroundMode ? Math.max(0, circulationExpansion) : clamp01(circulationExpansion),
        openOceanEnergyHours,
        moistureReservoir,
        dryAirIntrusion: clamp01(dryAirIntrusion),
        dryAirCoreExposure: clamp01(dryAirCoreExposure),
        dryAirWrapFraction: clamp01(dryAirWrapFraction),
        moistEnvelopeIntegrity: clamp01(moistEnvelopeIntegrity),
        innerCoreMoisture: clamp01(innerCoreMoisture),
        eyewallOpenSectorFraction: clamp01(eyewallOpenSectorFraction),
        deepConvectiveCoverage: clamp01(deepConvectiveCoverage),
        lowLevelVortexIntegrity: clamp01(lowLevelVortexIntegrity),
        postPeakEnvelopeMemory: clamp01(postPeakEnvelopeMemory),
        peakVmaxMemory,
        dryAirLifecyclePhase,
        dryAirVentilationIndex: clamp01(dryAirVentilationIndex),
        dryAirCoreConnection: clamp01(dryAirCoreConnection),
        dryAirReMoistening: clamp01(dryAirReMoistening),
        dryAirConvectiveArcBearingDeg: ((dryAirConvectiveArcBearingDeg % 360) + 360) % 360,
        eyewallColdPoolMemory: clamp01(eyewallColdPoolMemory),
        moistCoreProtection: clamp01(moistCoreProtection),
        dryErosionHours,
        dryRecoveryHours,
        drySlotBearingDeg,
        rebuiltCoreDiameterKm,
        convectiveSuppression: clamp01(convectiveSuppression),
        structuralDisorganization: clamp01(structuralDisorganization),
        terrainFrictionWork: Math.max(0, terrainFrictionWork),
        terrainBlockingMemory: clamp01(terrainBlockingMemory),
        terrainFrictionAsymmetry: clamp01(terrainFrictionAsymmetry),
        terrainCoreLandFraction: clamp01(terrainCoreLandFraction),
        terrainMountainFraction: clamp01(terrainMountainFraction),
        terrainMaxCoreElevation: Math.max(0, terrainMaxCoreElevation),
        terrainInteractionBearingDeg: ((terrainInteractionBearingDeg % 360) + 360) % 360,
        plainTsShelfHours,
        plainTsShelfMemory: clamp01(plainTsShelfMemory),
        coldWaterTsShelfHours,
        coldWaterTsShelfMemory: clamp01(coldWaterTsShelfMemory),
        cdoDiameterKm,
        coastalCoreInfluence: clamp01(coastalCoreInfluence),
        coldWaterExposureHours,
        westerlyInteractionHours,
        westerlyRainMemory: clamp01(westerlyRainMemory),
        northeastCloudTailStrength: clamp01(northeastCloudTailStrength),
        warmConveyorBeltStrength: clamp01(warmConveyorBeltStrength),
        northeastCloudStripping: clamp01(northeastCloudStripping),
        llccExposure: clamp01(llccExposure),
        asymmetricReburstStrength: clamp01(asymmetricReburstStrength),
        asymmetricReburstBearingDeg: ((asymmetricReburstBearingDeg % 360) + 360) % 360,
        ewrcStandoffStrength: clamp01(ewrcStandoffStrength),
        giantEyeOuterWallMemory: clamp01(giantEyeOuterWallMemory),
        brownOceanBurstIndex: clamp01(brownOceanBurstIndex),
        landfallOuterRainbandIndex: clamp01(landfallOuterRainbandIndex),
        coreGeometryContinuity: clamp01(coreGeometryContinuity),
        dvorakTNumber: estimateDvorakTNumber(newVmax),
        marineMoistureLink: clamp01(marineMoistureLink),
        binaryInteractionStrength: clamp01(binaryInteraction.strength),
        binaryInducedShearKt: Math.max(0, binaryEffectiveShearKt),
        binaryPartnerDistanceKm: binaryInteraction.partnerDistanceKm,
        binaryPartnerId: binaryInteraction.partnerId,
        binaryMergerRecoveryHours,
        absorbedCycloneCount: ty.absorbedCycloneCount ?? 0,
        postDryAirBurstSuppressionHours,
        preStormSquallEvaluated,
        preStormSquallStartHour,
        preStormSquallDurationHours,
        preStormSquallBearingOffsetDeg,
        preStormSquallSpeedKmh,
        rapidIntensifying,
        forcedRapidIntensification: ty.forcedRapidIntensification,
        rapidIntensificationMode: ty.rapidIntensificationMode,
        forcedRapidIntensificationMode: ty.forcedRapidIntensificationMode,
        rapidEpisodeElapsedHours: ty.rapidEpisodeElapsedHours,
        rapidEpisodeDurationHours: ty.rapidEpisodeDurationHours,
        rapidEpisodeTarget24h: ty.rapidEpisodeTarget24h,
        rapidEpisodeStartRate: ty.rapidEpisodeStartRate,
        rapidEpisodeLastRate: ty.rapidEpisodeLastRate,
        rapidEpisodeExitHours: ty.rapidEpisodeExitHours,
        rapidEpisodeExitDuration: ty.rapidEpisodeExitDuration,
        rapidEpisodeAbortRequested: ty.rapidEpisodeAbortRequested,
        intensityRateMemory: ty.intensityRateMemory,
        intensityChange6h,
        intensityChange24h,
        isEyeClogged: ty.isEyeClogged,
        cloggedRecoveryHours: ty.cloggedRecoveryHours,
        cloggedRecoveryTotalHours: ty.cloggedRecoveryTotalHours,
        dryAirPenaltyHours: ty.dryAirPenaltyHours,
        dryAirPenaltyTotalHours: ty.dryAirPenaltyTotalHours,
        shearPenaltyHours: ty.shearPenaltyHours,
        shearPenaltyTotalHours: ty.shearPenaltyTotalHours,
        category,
        officialNamingHour,
        hasBeenOfficiallyNamed,
        upwellingHours,
        consecutiveUpwellingHours,
        upwellingPersistentPenaltyHours,
        tdHours,
        landTdHours,
        r10LandContactHours,
        superTyLandHours,
        etHours,
        casualties: currentCasualties,
        preparednessIndex: clamp01(preparednessIndex),
        forecastSurpriseIndex: clamp01(forecastSurpriseIndex),
        warningLeadHours,
        simHour: nextHour,
        maxLandElevationPassed,
        structuralDamageHours,
        warmWaterHoursAfterSea,
        landHours,
        landContactHours,
        passedTaiwanCentral,
        passedLuzonMountains,
        structuralDamagePenaltyFactor,
        isStructureDamaged,
        structureMode,
        coreCompactness: clamp01(coreCompactness),
        convectiveBurstIndex: clamp01(convectiveBurstIndex),
        rainbandDominance: clamp01(rainbandDominance),
        outflowEfficiency: clamp01(outflowEfficiency),
        coreRebuildScar: clamp01(coreRebuildScar),
        terrainHollowCoreMemory: clamp01(terrainHollowCoreMemory),
        terrainHollowCoreBearingDeg: ((terrainHollowCoreBearingDeg % 360) + 360) % 360,
        damageOrigin,
        terrainDamageMorphology,
        ewrcFailureMode,
        broadMoisturePlatform: clamp01(broadMoisturePlatform),
        upwellingLogged: ty.upwellingLogged,
        ewrcCooldownHours,
        lastJoyU: ty.lastJoyU,
        lastJoyV: ty.lastJoyV,
        isManualSteering,
        lastVelocityU,
        lastVelocityV,
        forcedDecayStartVmax,
        forcedDecayTargetVmax,
        forcedDecayElapsedHours,
        forcedDecayDuration,
        forcedDecayIsContinuous,
        forcedShear: ty.forcedShear,
        forcedEWRC: ty.forcedEWRC,
        manualEwrcOutcomeOverride: ty.manualEwrcOutcomeOverride,
        forcedDryAir: ty.forcedDryAir,
        forcedColdAirStrength: ty.forcedColdAirStrength,
        forcedColdAirArrivalHour: ty.forcedColdAirArrivalHour,
        forcedColdAirScheduledHour: ty.forcedColdAirScheduledHour,
        coldAirExposureHours: ty.coldAirExposureHours,
        coldAirWarmCoreDamage,
        coldAirWarmCoreDestroyed: coldAirWarmCoreDestroyed || undefined,
        forcedColdWaterTemperatureC: ty.forcedColdWaterTemperatureC,
        forcedColdWaterStartHour: ty.forcedColdWaterStartHour,
        forcedColdWaterEndHour: ty.forcedColdWaterEndHour,
        forcedColdWaterDurationHours: ty.forcedColdWaterDurationHours,
        penaltyRecoveryActive: penaltyRecoveryActive || undefined,
        penaltyRecoveryElapsedHours: penaltyRecoveryActive ? penaltyRecoveryElapsedHours : undefined,
        penaltyRecoveryTotalHours: penaltyRecoveryActive ? penaltyRecoveryTotalHours : undefined,
        penaltyRecoveryDryAir: penaltyRecoveryActive ? ty.penaltyRecoveryDryAir : undefined,
        penaltyRecoveryShear: penaltyRecoveryActive ? ty.penaltyRecoveryShear : undefined,
        penaltyRecoveryTerrain: penaltyRecoveryActive ? ty.penaltyRecoveryTerrain : undefined,
        penaltyRecoveryStage: penaltyRecoveryActive ? penaltyRecoveryStage : undefined,
        playgroundAutoERI: ty.playgroundAutoERI,
        playgroundAutoERIPaused: ty.playgroundAutoERIPaused,
        landfallRecords
      };

      // Forecast products are issued once at the exact CMA/NMC Beijing-time product instant (02/05/08/11/14/17/20/23). Do not derive
      // this from the integer history hour: doing so would recalculate on every 10-minute step
      // throughout an entire CMA product hour.
      const isUpdateTime = isExactlyOnThreeHour;
      const isFirstHour = ty.history.length === 0;

      if (nextHour - lastHistoryHour >= 1) {
        if (liveForecastMode === "off") {
          // No forecast-derived layer is visible.  Archive only the detailed observed state;
          // product generation can reconstruct an accurate forecast later from this snapshot.
          newForecastPath = [];
        } else if (isUpdateTime || isFirstHour || !ty.forecastPath || ty.forecastPath.length === 0 ||
          // Each later hour needs its own rebased preview, even between the
          // ordinary three-hour analysis updates, while an approved guide exists.
          !!issuePreSimulationReference(updatedTy, nextHour)) {
          newForecastPath = liveForecastMode === "preview"
            ? calculateLiveForecastTrackPath(updatedTy, config, 120)
            : calculateForecastTrackPath(updatedTy, config, 120, true);
        } else {
          newForecastPath = ty.forecastPath;
        }

        const prevReadings = ty.history.length > 0 ? ty.history[ty.history.length - 1].stationReadings : undefined;
        const nextReadings = calculateStationReadings(
          newLat,
          newLon,
          Number(newVmax.toFixed(1)),
          newPmin,
          finalRmw,
          r7,
          r10,
          r12,
          prevReadings,
          currentCasualties,
          updatedTy.eyeRadiusKm,
          updatedTy.eyeClearance,
          { ...updatedTy, config }
        );

        updatedTy.stationReadings = nextReadings;

        // 5.2.28 forecast seeds must remain self-contained. Start from the complete live cyclone
        // state so newly added damage/recovery memories are archived automatically instead of
        // silently disappearing from historical forecast reconstruction. Recursive history is
        // intentionally excluded; forecastPath below is the lightweight geometry-only issue path.
        const completeForecastSeed = makeHourlyHistorySeed(updatedTy);
        newHistory = [
          ...newHistory,
          {
              lat: newLat,
              lon: newLon,
              drawnRouteProgressKm: drawnStep?.progressKm ?? ty.drawnRouteProgressKm,
              vmax: Number(newVmax.toFixed(1)),
              pmin: newPmin,
              direction: dirDegrees,
              speed: speedKmh < 10 ? Number(speedKmh.toFixed(1)) : Math.round(speedKmh),
              rmw: finalRmw,
              r7,
              r10,
              r12,
              category,
              officialNamingHour,
              hasBeenOfficiallyNamed,
              simHour: nextHour,
              landed,
              dissipated,
              extrTransition,
              ewrcState,
              ewrcProgress,
              ewrcDuration,
              ewrcWeakenAmount,
              ewrcColdWakeHours,
              ewrcL12LandHours,
              ewrcStartVmax,
              ewrcStartRmw,
              ewrcExtraAdjust,
              ewrcRecoveryDuration,
              ewrcPenaltyTotalHours: ty.ewrcPenaltyTotalHours,
              ewrcFailurePenaltyHours: ty.ewrcFailurePenaltyHours,
              ewrcIsFailure: ty.ewrcIsFailure,
              ewrcCount: ty.ewrcCount,
              successfulEwrcCount,
              autoIntensityTarget,
              extremeIntensityHours,
              circulationExpansion: playgroundMode ? Math.max(0, circulationExpansion) : clamp01(circulationExpansion),
              openOceanEnergyHours,
              moistureReservoir,
              dryAirIntrusion: clamp01(dryAirIntrusion),
              dryAirCoreExposure: clamp01(dryAirCoreExposure),
              dryAirWrapFraction: clamp01(dryAirWrapFraction),
              moistEnvelopeIntegrity: clamp01(moistEnvelopeIntegrity),
              innerCoreMoisture: clamp01(innerCoreMoisture),
              eyewallOpenSectorFraction: clamp01(eyewallOpenSectorFraction),
              deepConvectiveCoverage: clamp01(deepConvectiveCoverage),
              lowLevelVortexIntegrity: clamp01(lowLevelVortexIntegrity),
              postPeakEnvelopeMemory: clamp01(postPeakEnvelopeMemory),
              peakVmaxMemory,
              dryAirLifecyclePhase,
              dryAirVentilationIndex: clamp01(dryAirVentilationIndex),
              dryAirCoreConnection: clamp01(dryAirCoreConnection),
              dryAirReMoistening: clamp01(dryAirReMoistening),
              dryAirConvectiveArcBearingDeg: ((dryAirConvectiveArcBearingDeg % 360) + 360) % 360,
              eyewallColdPoolMemory: clamp01(eyewallColdPoolMemory),
              moistCoreProtection: clamp01(moistCoreProtection),
              dryErosionHours,
              dryRecoveryHours,
              drySlotBearingDeg,
              rebuiltCoreDiameterKm,
              convectiveSuppression: clamp01(convectiveSuppression),
              structuralDisorganization: clamp01(structuralDisorganization),
              terrainFrictionWork: Math.max(0, terrainFrictionWork),
              terrainBlockingMemory: clamp01(terrainBlockingMemory),
              terrainFrictionAsymmetry: clamp01(terrainFrictionAsymmetry),
              terrainCoreLandFraction: clamp01(terrainCoreLandFraction),
              terrainMountainFraction: clamp01(terrainMountainFraction),
              terrainMaxCoreElevation: Math.max(0, terrainMaxCoreElevation),
              terrainInteractionBearingDeg: ((terrainInteractionBearingDeg % 360) + 360) % 360,
              cdoDiameterKm,
              coastalCoreInfluence: clamp01(coastalCoreInfluence),
              coldWaterExposureHours,
              westerlyInteractionHours,
              westerlyRainMemory: clamp01(westerlyRainMemory),
              northeastCloudTailStrength: clamp01(northeastCloudTailStrength),
              warmConveyorBeltStrength: clamp01(warmConveyorBeltStrength),
              northeastCloudStripping: clamp01(northeastCloudStripping),
              llccExposure: clamp01(llccExposure),
              asymmetricReburstStrength: clamp01(asymmetricReburstStrength),
              asymmetricReburstBearingDeg: ((asymmetricReburstBearingDeg % 360) + 360) % 360,
              ewrcStandoffStrength: clamp01(ewrcStandoffStrength),
              giantEyeOuterWallMemory: clamp01(giantEyeOuterWallMemory),
              brownOceanBurstIndex: clamp01(brownOceanBurstIndex),
              landfallOuterRainbandIndex: clamp01(landfallOuterRainbandIndex),
              coreGeometryContinuity: clamp01(coreGeometryContinuity),
              dvorakTNumber: estimateDvorakTNumber(newVmax),
              marineMoistureLink: clamp01(marineMoistureLink),
              binaryInteractionStrength: clamp01(binaryInteraction.strength),
              binaryInducedShearKt: Math.max(0, binaryEffectiveShearKt),
              binaryPartnerDistanceKm: binaryInteraction.partnerDistanceKm,
              binaryPartnerId: binaryInteraction.partnerId,
              binaryMergerRecoveryHours,
              absorbedCycloneCount: ty.absorbedCycloneCount ?? 0,
              postDryAirBurstSuppressionHours,
              preStormSquallEvaluated,
              preStormSquallStartHour,
              preStormSquallDurationHours,
              preStormSquallBearingOffsetDeg,
              preStormSquallSpeedKmh,
              rapidIntensifying,
              forcedRapidIntensification: ty.forcedRapidIntensification,
              rapidIntensificationMode: ty.rapidIntensificationMode,
              forcedRapidIntensificationMode: ty.forcedRapidIntensificationMode,
              rapidEpisodeElapsedHours: ty.rapidEpisodeElapsedHours,
              rapidEpisodeDurationHours: ty.rapidEpisodeDurationHours,
              rapidEpisodeTarget24h: ty.rapidEpisodeTarget24h,
              rapidEpisodeStartRate: ty.rapidEpisodeStartRate,
              rapidEpisodeLastRate: ty.rapidEpisodeLastRate,
              rapidEpisodeExitHours: ty.rapidEpisodeExitHours,
              rapidEpisodeExitDuration: ty.rapidEpisodeExitDuration,
              rapidEpisodeAbortRequested: ty.rapidEpisodeAbortRequested,
              intensityRateMemory: ty.intensityRateMemory,
              intensityChange6h,
              intensityChange24h,
              isEyeClogged: ty.isEyeClogged,
              eyeType: ty.eyeType,
              eyePhase: ty.eyePhase,
              eyeRadiusKm: ty.eyeRadiusKm,
              eyeClearance: ty.eyeClearance,
              eyeBrightnessTempC: ty.eyeBrightnessTempC,
              eyeObstruction: ty.eyeObstruction,
              eyewallIntegrity: ty.eyewallIntegrity,
              eyewallWrapProgress: ty.eyewallWrapProgress,
              eyeFormationMemory: ty.eyeFormationMemory,
              secondaryEyewallStrength: ty.secondaryEyewallStrength,
              eyeWarmCore: ty.eyeWarmCore,
              eyeAsymmetry: ty.eyeAsymmetry,
              structuralState: ty.structuralState,
              shear: ty.shear,
              shearDir: ty.shearDir,
              upwellingIntensity: ty.upwellingIntensity,
              cloggedRecoveryHours: ty.cloggedRecoveryHours,
              cloggedRecoveryTotalHours: ty.cloggedRecoveryTotalHours,
              dryAirPenaltyHours: ty.dryAirPenaltyHours,
              dryAirPenaltyTotalHours: ty.dryAirPenaltyTotalHours,
              shearPenaltyHours: ty.shearPenaltyHours,
              shearPenaltyTotalHours: ty.shearPenaltyTotalHours,
              upwellingHours,
              consecutiveUpwellingHours,
              upwellingPersistentPenaltyHours,
              tdHours,
              landTdHours,
              r10LandContactHours,
              superTyLandHours,
              etHours,
              casualties: currentCasualties,
              preparednessIndex: clamp01(preparednessIndex),
              forecastSurpriseIndex: clamp01(forecastSurpriseIndex),
              warningLeadHours,
              maxLandElevationPassed,
              structuralDamageHours,
              warmWaterHoursAfterSea,
              landHours,
              landContactHours,
              passedTaiwanCentral,
              passedLuzonMountains,
              structuralDamagePenaltyFactor,
              plainTsShelfHours,
              plainTsShelfMemory: clamp01(plainTsShelfMemory),
              coldWaterTsShelfHours,
              coldWaterTsShelfMemory: clamp01(coldWaterTsShelfMemory),
              isStructureDamaged,
              structureMode,
              coreCompactness: clamp01(coreCompactness),
              convectiveBurstIndex: clamp01(convectiveBurstIndex),
              rainbandDominance: clamp01(rainbandDominance),
              outflowEfficiency: clamp01(outflowEfficiency),
              coreRebuildScar: clamp01(coreRebuildScar),
              terrainHollowCoreMemory: clamp01(terrainHollowCoreMemory),
              terrainHollowCoreBearingDeg: ((terrainHollowCoreBearingDeg % 360) + 360) % 360,
              damageOrigin,
              terrainDamageMorphology,
              ewrcFailureMode,
              broadMoisturePlatform: clamp01(broadMoisturePlatform),
              isCoreDisrupted: ty.isCoreDisrupted,
              upwellingLogged: ty.upwellingLogged,
              ewrcCooldownHours,
              lastJoyU: ty.lastJoyU,
              lastJoyV: ty.lastJoyV,
              isManualSteering,
              lastVelocityU,
              lastVelocityV,
              forcedDecayStartVmax,
              forcedDecayTargetVmax,
              forcedDecayElapsedHours,
              forcedDecayDuration,
              forcedDecayIsContinuous,
              forcedShear: ty.forcedShear,
              forcedEWRC: ty.forcedEWRC,
              manualEwrcOutcomeOverride: ty.manualEwrcOutcomeOverride,
              forcedDryAir: ty.forcedDryAir,
              forcedColdAirStrength: ty.forcedColdAirStrength,
              forcedColdAirArrivalHour: ty.forcedColdAirArrivalHour,
              forcedColdAirScheduledHour: ty.forcedColdAirScheduledHour,
              coldAirExposureHours: ty.coldAirExposureHours,
              coldAirWarmCoreDamage,
              coldAirWarmCoreDestroyed: coldAirWarmCoreDestroyed || undefined,
              forcedColdWaterTemperatureC: ty.forcedColdWaterTemperatureC,
              forcedColdWaterStartHour: ty.forcedColdWaterStartHour,
              forcedColdWaterEndHour: ty.forcedColdWaterEndHour,
              forcedColdWaterDurationHours: ty.forcedColdWaterDurationHours,
              penaltyRecoveryActive: penaltyRecoveryActive || undefined,
              penaltyRecoveryElapsedHours: penaltyRecoveryActive ? penaltyRecoveryElapsedHours : undefined,
              penaltyRecoveryTotalHours: penaltyRecoveryActive ? penaltyRecoveryTotalHours : undefined,
              penaltyRecoveryDryAir: penaltyRecoveryActive ? ty.penaltyRecoveryDryAir : undefined,
              penaltyRecoveryShear: penaltyRecoveryActive ? ty.penaltyRecoveryShear : undefined,
              penaltyRecoveryTerrain: penaltyRecoveryActive ? ty.penaltyRecoveryTerrain : undefined,
              penaltyRecoveryStage: penaltyRecoveryActive ? penaltyRecoveryStage : undefined,
              playgroundAutoERI: ty.playgroundAutoERI,
        playgroundAutoERIPaused: ty.playgroundAutoERIPaused,
              manualForcedDecay: ty.manualForcedDecay,
              landfallRecords,
              // The complete live state wins over the legacy hand-maintained field list above.
              // This guarantees that every present/future damage memory and control state is saved.
              ...completeForecastSeed,
              forecastPath: newForecastPath,
              stationReadings: nextReadings,
              configSnapshot: snapshotSimulationConfig(config)
            }
          ];
      } else {
        updatedTy.stationReadings = ty.stationReadings;
      }
      
      updatedTy.history = newHistory;
      updatedTy.forecastPath = newForecastPath;

      updatedTyphoons.push(updatedTy);
    }

    // 4.1.2 direct vortex collision / merger. Pairwise Fujiwhara steering above can bring centers
    // together; actual absorption is only allowed at core-scale separation. A clearly dominant
    // circulation can ingest a weaker TD/TS somewhat earlier, while near-equal vortices must come
    // very close and otherwise continue orbiting/deforming one another.
    for (let i = 0; i < updatedTyphoons.length; i++) {
      const a = updatedTyphoons[i];
      if (!a.active || a.dissipated || a.vmax < MIN_CYCLONE_INTENSITY_MS) continue;
      for (let j = i + 1; j < updatedTyphoons.length; j++) {
        const b = updatedTyphoons[j];
        if (!b.active || b.dissipated || b.vmax < MIN_CYCLONE_INTENSITY_MS) continue;
        const distanceKm = greatCircleDistanceKm(a.lat, a.lon, b.lat, b.lon);
        if (!Number.isFinite(distanceKm)) continue;
        const ca = Math.max(6, a.vmax) * Math.sqrt(Math.max(70, meanWindRadius7(a)));
        const cb = Math.max(6, b.vmax) * Math.sqrt(Math.max(70, meanWindRadius7(b)));
        const dominant = ca >= cb ? a : b;
        const absorbed = ca >= cb ? b : a;
        const dominance = Math.max(ca, cb) / Math.max(1, Math.min(ca, cb));
        const rmwSum = Math.max(16, (a.rmw || 30) + (b.rmw || 30));
        const mergerRadiusKm = Math.max(62, Math.min(150, 48 + 0.42 * rmwSum));
        const coreCollision = distanceKm <= 64;
        const dominantCapture = dominance >= 1.22 && distanceKm <= mergerRadiusKm;
        if (!coreCollision && !dominantCapture) continue;

        const absorbedFraction = Math.min(0.72, Math.max(0.08,
          (Math.max(6, absorbed.vmax) * Math.sqrt(Math.max(70, meanWindRadius7(absorbed)))) /
          Math.max(1, Math.max(ca, cb))
        ));
        const tdIntoStrong = dominant.vmax >= 32.7 && absorbed.vmax < 24.5;
        const transientConvectivePulse = tdIntoStrong && this.prng.next() < 0.36;
        const intensityImpulse = transientConvectivePulse
          ? 0.30 + 0.90 * this.prng.next()
          : -Math.min(0.70, 0.12 + 0.62 * absorbedFraction);
        dominant.vmax = Math.max(MIN_CYCLONE_INTENSITY_MS, dominant.vmax + intensityImpulse);
        dominant.pmin = calculatePressure(dominant.vmax);
        dominant.dvorakTNumber = estimateDvorakTNumber(dominant.vmax);
        dominant.circulationExpansion = clamp01((dominant.circulationExpansion ?? 0) + 0.08 + 0.16 * absorbedFraction);
        dominant.moistureReservoir = clamp01((dominant.moistureReservoir ?? 0.55) + 0.06 + 0.10 * absorbedFraction);
        dominant.broadMoisturePlatform = clamp01((dominant.broadMoisturePlatform ?? 0.25) + 0.08 * absorbedFraction);
        dominant.coreRebuildScar = clamp01((dominant.coreRebuildScar ?? 0) + 0.10 + 0.18 * absorbedFraction);
        dominant.structuralDisorganization = clamp01((dominant.structuralDisorganization ?? 0) + 0.12 + 0.20 * absorbedFraction);
        dominant.eyewallIntegrity = clamp01((dominant.eyewallIntegrity ?? 0.35) * (0.90 - 0.18 * absorbedFraction));
        dominant.eyeClearance = clamp01((dominant.eyeClearance ?? 0) * (0.82 - 0.28 * absorbedFraction));
        dominant.convectiveBurstIndex = clamp01((dominant.convectiveBurstIndex ?? 0.15) + (transientConvectivePulse ? 0.24 : 0.08));
        dominant.binaryMergerRecoveryHours = Math.max(dominant.binaryMergerRecoveryHours ?? 0, 14 + 16 * absorbedFraction);
        dominant.binaryInteractionStrength = 1;
        dominant.binaryInducedShearKt = Math.max(dominant.binaryInducedShearKt ?? 0, 8 + 12 * absorbedFraction);
        dominant.binaryPartnerDistanceKm = distanceKm;
        dominant.binaryPartnerId = absorbed.id;
        dominant.absorbedCycloneCount = (dominant.absorbedCycloneCount ?? 0) + 1;
        dominant.structureMode = "binary_merger_reorganizing";

        if (dominant.vmax >= 51.0) dominant.category = TyphoonCategory.SuperTY;
        else if (dominant.vmax >= 41.5) dominant.category = TyphoonCategory.STY;
        else if (dominant.vmax >= 32.7) dominant.category = TyphoonCategory.TY;
        else if (dominant.vmax >= 24.5) dominant.category = TyphoonCategory.STS;
        else if (dominant.vmax >= 17.2) dominant.category = TyphoonCategory.TS;
        else dominant.category = TyphoonCategory.TD;

        absorbed.active = false;
        absorbed.dissipated = true;
        absorbed.category = TyphoonCategory.DS;
        absorbed.seasonEndHour = currentSimHourFloat;
        absorbed.forecastPath = [];
        absorbed.binaryInteractionStrength = 1;
        absorbed.binaryPartnerId = dominant.id;
        absorbed.binaryPartnerDistanceKm = distanceKm;

        const dominantLast = dominant.history?.[dominant.history.length - 1];
        if (dominantLast) {
          dominantLast.vmax = Number(dominant.vmax.toFixed(1));
          dominantLast.pmin = dominant.pmin;
          dominantLast.category = dominant.category;
          dominantLast.structureMode = "binary_merger_reorganizing";
          dominantLast.dvorakTNumber = dominant.dvorakTNumber;
          dominantLast.binaryMergerRecoveryHours = dominant.binaryMergerRecoveryHours;
          dominantLast.binaryInteractionStrength = 1;
          dominantLast.binaryInducedShearKt = dominant.binaryInducedShearKt;
          dominantLast.binaryPartnerId = absorbed.id;
          dominantLast.binaryPartnerDistanceKm = distanceKm;
          dominantLast.absorbedCycloneCount = dominant.absorbedCycloneCount;
        }
        const absorbedLast = absorbed.history?.[absorbed.history.length - 1];
        if (absorbedLast) {
          absorbedLast.dissipated = true;
          absorbedLast.category = TyphoonCategory.DS;
          absorbedLast.binaryInteractionStrength = 1;
          absorbedLast.binaryPartnerId = dominant.id;
          absorbedLast.binaryPartnerDistanceKm = distanceKm;
        }

        logs.push({
          id: `binary-merger-${dominant.id}-${absorbed.id}-${Math.round(currentSimHourFloat * 6)}`,
          time: new Date(),
          simHour: currentSimHourFloat,
          type: "warning",
          message: `🌀 双台风合并：${dominant.name} 与 ${absorbed.name} 的中心距离缩小至 ${Math.round(distanceKm)} km，${dominant.name} 的主环流已吞并并整合较弱涡旋。合并后的内核将在随后数十小时内经历偏置、风切和再组织。`
        });
        // The absorbed vortex can no longer merge with another storm in this integration step.
        if (!a.active || !b.active) break;
      }
    }

    return { updatedTyphoons, logs };
  }

  // Calculate quadrant wind radius (km) based on maximum wind speed vmax
  // Modulates by asymmetrical movement factor (front-right quadrant gets stronger wind)
  // Accounts for real-time land squeeze, steering-driven asymmetry, and individual/global size limits
  private calculateWindRadii(
    lat: number,
    lon: number,
    vmax: number,
    scaleFactor: number,
    u: number,
    v: number,
    isLanded: boolean,
    maxR7Limit?: number,
    config?: SimulationConfig,
    isStructureDamagedAtSea?: boolean,
    targetLevel: 7 | 10 | 12 = 7
  ): { ne: number; se: number; sw: number; nw: number } {
    const playgroundMode = isPlaygroundMode(config);
    const std = getStandardAverageWindRadii(vmax);
    let baseR = targetLevel === 7 ? std.r7 : targetLevel === 10 ? std.r10 : std.r12;
    if (baseR <= 0) {
      return { ne: 0, se: 0, sw: 0, nw: 0 };
    }
    const preferenceScale = circulationPreferenceScale(vmax, config, targetLevel);
    if (preferenceScale <= 1e-9) return { ne: 0, se: 0, sw: 0, nw: 0 };
    const radiusScale = scaleFactor * preferenceScale;
    baseR *= radiusScale;

    
    // 2. Translation movement asymmetry (Dangerous Semicircle vs Navigable Semicircle)
    // Northern Hemisphere: Dangerous semicircle is on the RIGHT side of the motion vector
    const speedMps = Math.sqrt(u * u + v * v);
    const headingRad = Math.atan2(u, v); // 0 = North, PI/2 = East, -PI/2 = West, PI = South
    const rightSideRad = headingRad + Math.PI / 2; // Dangerous semicircle center direction
    
    // Asymmetry scales smoothly with both translational velocity and typhoon base radius (vmax intensity) (Significantly amplified for realistic asymmetry)
    const speedAsym = Math.min(85 * radiusScale, (speedMps * 3.2 + baseR * 0.08) * radiusScale);

    // Quad angles: NE = PI/4, SE = 3PI/4, SW = 5PI/4, NW = 7PI/4
    let r_ne = baseR + Math.cos((Math.PI / 4) - rightSideRad) * speedAsym;
    let r_se = baseR + Math.cos(((3 * Math.PI) / 4) - rightSideRad) * speedAsym;
    let r_sw = baseR + Math.cos(((5 * Math.PI) / 4) - rightSideRad) * speedAsym;
    let r_nw = baseR + Math.cos(((7 * Math.PI) / 4) - rightSideRad) * speedAsym;

    // Direct Dangerous (+12%) vs Navigable (-12%) semicircle radius scaling
    const motionFactor = Math.min(1.0, speedMps / 8.0);
    const dangerousBoost = 0.12 * motionFactor;
    
    r_ne *= (1.0 + Math.cos((Math.PI / 4) - rightSideRad) * dangerousBoost);
    r_se *= (1.0 + Math.cos(((3 * Math.PI) / 4) - rightSideRad) * dangerousBoost);
    r_sw *= (1.0 + Math.cos(((5 * Math.PI) / 4) - rightSideRad) * dangerousBoost);
    r_nw *= (1.0 + Math.cos(((7 * Math.PI) / 4) - rightSideRad) * dangerousBoost);

    // 3. Fetch wind shear
    const shearVal = playgroundMode ? 0.0 : (config ? getShear(lat, lon, config) : 8.0);
    const isStrongShear = shearVal > 15.0;

    // Latitudinal influence: Coriolis effect increases circle size at higher latitudes
    const latFactor = 1.0 + Math.abs(lat - 15) * 0.012;
    r_ne *= latFactor;
    r_se *= latFactor;
    r_sw *= latFactor;
    r_nw *= latFactor;

    // Check land squeeze on the actual quadrant radii
    const quadrants = [
      { name: "ne" as const, angle: 45, radius: r_ne },
      { name: "se" as const, angle: 135, radius: r_se },
      { name: "sw" as const, angle: 225, radius: r_sw },
      { name: "nw" as const, angle: 315, radius: r_nw },
    ];

    const squeezeFactors = { ne: 1.0, se: 1.0, sw: 1.0, nw: 1.0 };
    let anySqueeze = false;

    for (const q of quadrants) {
      // Check land at multiple angles within each quadrant (center, and +/- 30 degrees) to ensure robust detection
      const angles = [q.angle - 30, q.angle, q.angle + 30];
      
      for (const a of angles) {
        const angleRad = (a * Math.PI) / 180;
        // Check land at 0.4, 0.7, 1.0 of the calculated quadrant radius
        const testFractions = [0.4, 0.7, 1.0];
        for (const f of testFractions) {
          const testDist = q.radius * f;
          const dLat = (testDist * Math.cos(angleRad)) / 111.12;
          const dLon = (testDist * Math.sin(angleRad)) / (111.12 * Math.cos((lat * Math.PI) / 180));
          const metrics = getLandMetrics(lat + dLat, lon + dLon, config?.coastlineSource);
          if (metrics.isLand && !isMinorIslandWindSqueezeIgnored(lat + dLat, lon + dLon)) {
            // Land squeeze from a major landmass. Tiny isolated islands are intentionally ignored
            // because they cannot remove a quadrant-scale boundary-layer wind footprint.
            // Land squeeze (Slightly increased land squeeze effect)
            let squeeze = 0.62 + 0.25 * f; 
            if (metrics.elevation > 500) {
              squeeze *= Math.max(0.75, 1.0 - (metrics.elevation / 12000.0));
            }
            squeezeFactors[q.name] = Math.min(squeezeFactors[q.name], squeeze);
            anySqueeze = true;
          }
        }
      }
    }

    if (!anySqueeze && !isStrongShear) {
      // 在未受到陆地和强风切影响时，四个象限的风圈在原基础上做连续、平滑的低频偏移，彻底解决高频抖动问题
      // Smooth, continuous spatial waves to maintain stable organic asymmetry without frame jitter
      const angleNE = Math.sin(lat * 0.8 + lon * 0.5);
      const angleSE = Math.cos(lat * 0.7 - lon * 0.6);
      const angleSW = -Math.sin(lat * 0.6 - lon * 0.4);
      const angleNW = -Math.cos(lat * 0.5 + lon * 0.7);

      let offsetBase = 32;

      let o_ne = Math.round(angleNE * offsetBase * radiusScale);
      let o_se = Math.round(angleSE * offsetBase * radiusScale);
      let o_sw = Math.round(angleSW * offsetBase * radiusScale);
      let o_nw = Math.round(angleNW * offsetBase * radiusScale);

      // Guarantee that at least two are different with a larger minimum difference
      if (Math.abs(o_ne - o_se) < 5 && Math.abs(o_se - o_sw) < 5) {
        o_ne += Math.round(12 * radiusScale);
        o_se -= Math.round(12 * radiusScale);
      }

      r_ne = Math.max(15, Math.round(r_ne + o_ne));
      r_se = Math.max(15, Math.round(r_se + o_se));
      r_sw = Math.max(15, Math.round(r_sw + o_sw));
      r_nw = Math.max(15, Math.round(r_nw + o_nw));
    } else {
      // Under the influence of land squeeze or strong wind shear
      // 1. Wind Shear Distortion Effect
      let shearFactorNE = 1.0;
      let shearFactorSE = 1.0;
      let shearFactorSW = 1.0;
      let shearFactorNW = 1.0;

      if (isStrongShear) {
        const shearExcess = shearVal - 15.0;
        const shearStrength = Math.min(0.18, shearExcess * 0.008); // reduced gain (Requirement 8)
        
        if (lat > 22) {
          // Westerlies shear (stretches east, compresses west)
          shearFactorNE = 1.0 + shearStrength * 0.5;
          shearFactorSE = 1.0 + shearStrength * 0.3;
          shearFactorSW = 1.0 - shearStrength * 0.5;
          shearFactorNW = 1.0 - shearStrength * 0.3;
        } else {
          // Tropical easterlies shear (stretches west, compresses east)
          shearFactorNE = 1.0 - shearStrength * 0.5;
          shearFactorSE = 1.0 - shearStrength * 0.3;
          shearFactorSW = 1.0 + shearStrength * 0.3;
          shearFactorNW = 1.0 + shearStrength * 0.5;
        }
      }

      // Priority of speed/direction sits BELOW land squeeze/shear - we modify the asymmetrical r_ne (preserving movement effect but letting shear override/multiply it)
      r_ne = Math.round(r_ne * shearFactorNE);
      r_se = Math.round(r_se * shearFactorSE);
      r_sw = Math.round(r_sw * shearFactorSW);
      r_nw = Math.round(r_nw * shearFactorNW);

      // 2. Land Squeeze Effect (Applied LAST, sitting above movement priority)
      r_ne = Math.round(r_ne * squeezeFactors.ne);
      r_se = Math.round(r_se * squeezeFactors.se);
      r_sw = Math.round(r_sw * squeezeFactors.sw);
      r_nw = Math.round(r_nw * squeezeFactors.nw);
    }

    // User circulation-size reference has no hard upper cap. Environmental/land/threshold physics
    // may still reshape the diagnosed quadrants, but the control itself is no longer clipped.

    // If fully landed on a substantial landmass, apply further overall reduction. Okinawa/Guam
    // and similar isolated small islands do not trigger this basin-scale contraction.
    if (isLanded && !isMinorIslandWindSqueezeIgnored(lat, lon)) {
      r_ne = Math.round(r_ne * 0.7);
      r_se = Math.round(r_se * 0.7);
      r_sw = Math.round(r_sw * 0.7);
      r_nw = Math.round(r_nw * 0.7);
    }

    return {
      ne: Math.round(Math.max(0, r_ne)),
      se: Math.round(Math.max(0, r_se)),
      sw: Math.round(Math.max(0, r_sw)),
      nw: Math.round(Math.max(0, r_nw))
    };
  }
}

export type IntensityAgency = "CMA" | "JMA" | "JTWC";
export type IntensityReportingMode = "public" | "continuous";

export interface AgencyIntensityResult {
  agency: IntensityAgency;
  value: number;
  rawValue: number;
  unit: "m/s" | "kt";
  averagingPeriod: "2分钟" | "10分钟" | "1分钟";
  multiplier: number;
  category: string;
  cmaEquivalentMs: number;
  reportingMode: IntensityReportingMode;
}

const CMA_PUBLIC_WIND_BINS = [
  5, 8, 10, 12, 15, 18, 20, 23, 25, 28, 30, 33, 35, 38, 40, 42, 45, 48, 50,
  52, 55, 58, 60, 62, 65, 68, 70, 72, 75, 78, 80, 82, 85, 88, 90, 92, 95,
  98, 100, 105, 110, 115
];

function snapAgencyPublicWind(value: number, bins: number[]): number {
  if (!Number.isFinite(value) || value <= bins[0]) return bins[0];
  // Operational public bins end at the top of the real-world table. Playground mode can exceed
  // that range, so extrapolate the displayed CMA value instead of visually pinning it at 115 m/s.
  if (value > bins[bins.length - 1]) return Math.round(value);
  if (value === bins[bins.length - 1]) return bins[bins.length - 1];
  let best = bins[0];
  let bestDiff = Math.abs(value - best);
  for (let i = 1; i < bins.length; i++) {
    const diff = Math.abs(value - bins[i]);
    if (diff < bestDiff) {
      best = bins[i];
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * The simulator keeps one CMA-like 2-minute physical wind internally. Agency switching
 * changes only the reporting convention. "public" snaps values to operational-style
 * published bins; "continuous" keeps the continuously evaluated wind for analysis/video.
 *
 * JTWC is intentionally an agency-analysis calibration, not a pure averaging-period
 * conversion: operational 1-minute estimates are commonly higher than a straight kt
 * conversion from the simulator's CMA-like 2-minute value. The factor gradually rises
 * from ~1.15 in weak systems toward ~1.195 in intense typhoons.
 */
export function getAgencyIntensity(
  vmaxCmaMs: number,
  agency: IntensityAgency = "CMA",
  reportingMode: IntensityReportingMode = "public"
): AgencyIntensityResult {
  const base = Math.max(MIN_CYCLONE_INTENSITY_MS, Number.isFinite(vmaxCmaMs) ? vmaxCmaMs : MIN_CYCLONE_INTENSITY_MS);
  const continuous = reportingMode === "continuous";

  if (agency === "JMA") {
    const adjustedMs = base * 0.952;
    const rawKt = adjustedMs * 1.943844492;
    // Simulator reporting convention: JMA display saturates at 140 kt.  Keep rawValue uncapped so
    // internal physics/analysis still knows how intense an experimental storm actually is.
    const reportedKt = Math.min(140, rawKt);
    const value = continuous ? Math.round(reportedKt * 10) / 10 : Math.max(0, Math.round(reportedKt / 5) * 5);
    // JMA's native Japanese public intensity wording is based on the 10-minute wind:
    // 熱帯低気圧 -> 台風 -> 強い台風 -> 非常に強い台風 -> 猛烈な台風.
    // TS/STS/TY are retained in JMA best-track data as grades, but the simulator's
    // visible intensity name uses the domestic Japanese wording requested by the UI.
    const classifiedMs = value / 1.943844492;
    let category = "熱帯低気圧";
    if (classifiedMs >= 54) category = "猛烈な台風";
    else if (classifiedMs >= 44) category = "非常に強い台風";
    else if (classifiedMs >= 33) category = "強い台風";
    else if (classifiedMs >= 17) category = "台風";
    return { agency, value, rawValue: rawKt, unit: "kt", averagingPeriod: "10分钟", multiplier: 0.952, category, cmaEquivalentMs: base, reportingMode };
  }

  if (agency === "JTWC") {
    const strengthBlend = clamp01((base - 15.0) / 55.0);
    const jtwcFactor = 1.15 + 0.045 * strengthBlend;
    const rawKt = base * 1.943844492 * jtwcFactor;
    const value = continuous ? Math.round(rawKt * 10) / 10 : Math.max(0, Math.round(rawKt / 5) * 5);
    // Compact JTWC-style English labels.  TDist is reserved for a weak disturbance
    // below the usual TD analysis range; TD/TS/TY/STY follow the familiar 1-min bins.
    let category = "TDist";
    if (value >= 130) category = "STY";
    else if (value >= 64) category = "TY";
    else if (value >= 34) category = "TS";
    else if (value >= 25) category = "TD";
    return { agency, value, rawValue: rawKt, unit: "kt", averagingPeriod: "1分钟", multiplier: jtwcFactor, category, cmaEquivalentMs: base, reportingMode };
  }

  const value = continuous ? Math.round(base * 10) / 10 : snapAgencyPublicWind(base, CMA_PUBLIC_WIND_BINS);
  let category = "热带低压";
  if (value >= 51.0) category = "超强台风";
  else if (value >= 41.5) category = "强台风";
  else if (value >= 32.7) category = "台风";
  else if (value >= 24.5) category = "强热带风暴";
  else if (value >= 17.2) category = "热带风暴";
  return { agency: "CMA", value, rawValue: base, unit: "m/s", averagingPeriod: "2分钟", multiplier: 1, category, cmaEquivalentMs: base, reportingMode };
}

export function formatAgencyIntensity(
  vmaxCmaMs: number,
  agency: IntensityAgency = "CMA",
  reportingMode: IntensityReportingMode = "public"
): string {
  const result = getAgencyIntensity(vmaxCmaMs, agency, reportingMode);
  return `${result.value}${result.unit === "kt" ? " kt" : " m/s"}`;
}

export type JtwcSshwsCategory = "DISTURBANCE" | "TD" | "TS" | "C1" | "C2" | "C3" | "C4" | "C5";

/**
 * Saffir-Simpson Hurricane Wind Scale thresholds applied to JTWC 1-minute, 10-m sustained wind.
 * Important: AETHER stores a CMA-like 2-minute physical wind internally, so callers must never
 * classify C1-C5 from a direct m/s->kt conversion. Use getAgencyIntensity(..., "JTWC", ...) first.
 * The public mode follows the simulator's JTWC 5-kt reporting bins before assigning the category.
 */
export const JTWC_SSHWS_BANDS = [
  { category: "DISTURBANCE" as const, label: "Disturbance", minKt: 0, maxKt: 24, minMph: 0 },
  { category: "TD" as const, label: "Tropical Depression", minKt: 25, maxKt: 33, minMph: 0 },
  { category: "TS" as const, label: "Tropical Storm", minKt: 34, maxKt: 63, minMph: 39 },
  { category: "C1" as const, label: "Category 1", minKt: 64, maxKt: 82, minMph: 74 },
  { category: "C2" as const, label: "Category 2", minKt: 83, maxKt: 95, minMph: 96 },
  { category: "C3" as const, label: "Category 3", minKt: 96, maxKt: 112, minMph: 111 },
  { category: "C4" as const, label: "Category 4", minKt: 113, maxKt: 136, minMph: 130 },
  { category: "C5" as const, label: "Category 5", minKt: 137, maxKt: Infinity, minMph: 157 }
] as const;

export function getJtwcSshwsAssessment(
  vmaxCmaMs: number,
  reportingMode: IntensityReportingMode = "public"
): { category: JtwcSshwsCategory; label: string; windKt: number; major: boolean } {
  const jtwc = getAgencyIntensity(vmaxCmaMs, "JTWC", reportingMode);
  const windKt = Math.max(0, Number(jtwc.value) || 0);
  let category: JtwcSshwsCategory = "DISTURBANCE";
  if (windKt >= 137) category = "C5";
  else if (windKt >= 113) category = "C4";
  else if (windKt >= 96) category = "C3";
  else if (windKt >= 83) category = "C2";
  else if (windKt >= 64) category = "C1";
  else if (windKt >= 34) category = "TS";
  else if (windKt >= 25) category = "TD";
  const band = JTWC_SSHWS_BANDS.find((item) => item.category === category)!;
  return { category, label: band.label, windKt, major: category === "C3" || category === "C4" || category === "C5" };
}


// Convert wind speed m/s to Beaufort scale force levels (China standards)
export function getWindForceCategory(vmax: number): number {
  if (vmax < 0.3) return 0;
  if (vmax < 1.5) return 1;
  if (vmax < 3.3) return 2;
  if (vmax < 5.4) return 3;
  if (vmax < 7.9) return 4;
  if (vmax < 10.7) return 5;
  if (vmax < 13.8) return 6;
  if (vmax < 17.1) return 7;
  if (vmax < 20.7) return 8;
  if (vmax < 24.4) return 9;
  if (vmax < 28.4) return 10;
  if (vmax < 32.6) return 11;
  if (vmax < 36.9) return 12;
  if (vmax < 41.4) return 13;
  if (vmax < 46.1) return 14;
  if (vmax < 50.9) return 15;
  if (vmax < 56.0) return 16;
  return 17; // 超强台风/极致风力
}

export function getCategoryColor(category: TyphoonCategory, config?: SimulationConfig): string {
  if (config?.categoryColors?.[category]) {
    return config.categoryColors[category];
  }

  switch (category) {
    case TyphoonCategory.TD:
      return "#F9D332";
    case TyphoonCategory.TS:
      return "#2056C6";
    case TyphoonCategory.STS:
      return "#1F8838";
    case TyphoonCategory.TY:
      return "#F07920";
    case TyphoonCategory.STY:
      return "#D829BC";
    case TyphoonCategory.SuperTY:
      return "#D62020";
    case TyphoonCategory.ET:
      return "#949297";
    case TyphoonCategory.RL:
      return "#87939c";
    case TyphoonCategory.DS:
    default:
      return "#8c9ba5";
  }
}

// Calculate the 120-hour projected forecast track (every 1 hour)


type ForecastFrameworkGuidance = {
  u: number;
  v: number;
  deviationKm: number;
  progressKm: number;
  remainingKm: number;
  totalKm: number;
  curvatureDeg: number;
  /** Relative speed cue inferred from waypoint spacing; 1 means route-median spacing. */
  spacingSpeedFactor: number;
  speedFactor: number;
};

const forecastFrameworkSmoothCache = new WeakMap<object, Array<{ lat: number; lon: number }>>();

function frameworkDistanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const meanLat = ((a.lat + b.lat) * 0.5 * Math.PI) / 180;
  const dy = (b.lat - a.lat) * 111.12;
  const dx = (b.lon - a.lon) * 111.12 * Math.max(0.15, Math.cos(meanLat));
  return Math.hypot(dx, dy);
}

/**
 * Round148: distinguish explicit repeated-position STALL waypoints from dense normal drawing.
 * A touch screen's uneven point spacing is NOT a translation-speed instruction. Only a
 * sustained near-identical-position cluster surrounded by real travel legs can encode a stop.
 * Keeping the signal on the unsmoothed route is essential: smoothing/resampling erases dwell.
 */
function getForecastFrameworkSpacingSpeedFactor(
  route: Array<{ lat: number; lon: number }>,
  progressFraction: number
): number {
  if (!route || route.length < 5) return 1;
  const lengths: number[] = [];
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) {
    const d = frameworkDistanceKm(route[i - 1], route[i]);
    if (!Number.isFinite(d)) return 1;
    lengths.push(d);
    cumulative.push(cumulative[cumulative.length - 1] + d);
  }
  const total = cumulative[cumulative.length - 1];
  const normalLegs = lengths.filter(d => d >= 18);
  // A densely sampled smooth route with no ordinary-size legs is ambiguous:
  // it must never be interpreted as a stationary cyclone.
  if (normalLegs.length < 2 || total < 55) return 1;
  const progressKm = clamp01(progressFraction) * total;
  let stallStrength = 0;
  for (let i = 0; i < lengths.length;) {
    if (lengths[i] > 0.85) { i++; continue; }
    let j = i;
    while (j + 1 < lengths.length && lengths[j + 1] <= 0.85) j++;
    const clusterKm = cumulative[j + 1] - cumulative[i];
    const repeatedLegs = j - i + 1;
    // Three exactly repeated taps (two microscopic legs) or four near-identical
    // taps (three short legs) count as a deliberate pause. Ordinary close
    // waypoints or an accidental double-tap remain neutral.
    const repeatedPosition = (repeatedLegs >= 3 && clusterKm <= 1.8)
      || (repeatedLegs >= 2 && clusterKm <= 0.08);
    if (repeatedPosition) {
      const nearbyNormalBefore = lengths.slice(Math.max(0, i-4), i).some(d => d >= 18);
      const nearbyNormalAfter = lengths.slice(j+1, Math.min(lengths.length,j+5)).some(d => d >= 18);
      if (nearbyNormalBefore || nearbyNormalAfter) {
        const distanceKm = progressKm < cumulative[i] ? cumulative[i] - progressKm
          : progressKm > cumulative[j+1] ? progressKm - cumulative[j+1] : 0;
        const influenceKm = Math.min(68, Math.max(22, Math.min(total * 0.24, 26 + 6 * repeatedLegs)));
        const envelope = 1 - smoothstep01(distanceKm / influenceKm);
        stallStrength = Math.max(stallStrength, envelope * Math.min(1, 0.91 + 0.05 * (repeatedLegs-3)));
      }
    }
    i = j + 1;
  }
  return Math.max(0.08, 1 - 0.98 * stallStrength);
}

/**
 * User forecast frameworks are usually drawn with only a few vertices. Feeding those raw segments
 * straight into the steering constraint makes the forecast visibly hinge at every waypoint. Use
 * repeated corner cutting followed by distance-based resampling to create a smooth direction curve
 * while preserving the user's first/last anchors. This is a steering guide only; it never changes
 * the cyclone's configured translation speed.
 */
function smoothForecastFrameworkRoute(route: Array<{ lat: number; lon: number }>): Array<{ lat: number; lon: number }> {
  if (!route || route.length < 3) return route;
  const cached = forecastFrameworkSmoothCache.get(route as object);
  if (cached) return cached;

  let pts = route.map((p) => ({ lat: p.lat, lon: p.lon }));
  for (let pass = 0; pass < 3; pass++) {
    const next: Array<{ lat: number; lon: number }> = [{ ...pts[0] }];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      next.push({ lat: a.lat * 0.75 + b.lat * 0.25, lon: a.lon * 0.75 + b.lon * 0.25 });
      next.push({ lat: a.lat * 0.25 + b.lat * 0.75, lon: a.lon * 0.25 + b.lon * 0.75 });
    }
    next.push({ ...pts[pts.length - 1] });
    pts = next;
  }

  const cumulative: number[] = [0];
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1] + frameworkDistanceKm(pts[i - 1], pts[i]));
  const total = cumulative[cumulative.length - 1];
  if (total < 1) return route;
  const stepKm = Math.max(18, Math.min(36, total / 60));
  const out: Array<{ lat: number; lon: number }> = [];
  for (let d = 0; d < total; d += stepKm) {
    let seg = 0;
    while (seg < cumulative.length - 2 && cumulative[seg + 1] < d) seg++;
    const span = Math.max(1e-6, cumulative[seg + 1] - cumulative[seg]);
    const t = clamp01((d - cumulative[seg]) / span);
    out.push({
      lat: pts[seg].lat + (pts[seg + 1].lat - pts[seg].lat) * t,
      lon: pts[seg].lon + (pts[seg + 1].lon - pts[seg].lon) * t
    });
  }
  out.push({ ...pts[pts.length - 1] });
  forecastFrameworkSmoothCache.set(route as object, out);
  return out;
}

/**
 * Converts a user-drawn polyline into a high-weight forecast framework. Geometry controls the
 * preferred heading; waypoint spacing contributes only a dimensionless *relative* speed cue.
 * No point interval is interpreted as a fixed number of hours. The environment remains the
 * absolute speed source, while curvature, alignment and relative spacing provide bounded
 * corrections around that physical steering magnitude.
 */
function getForecastFrameworkGuidance(
  lat: number,
  lon: number,
  route: Array<{ lat: number; lon: number }>,
  speedKmh: number
): ForecastFrameworkGuidance | null {
  if (!route || route.length < 2) return null;

  const rawRoute = route;
  route = smoothForecastFrameworkRoute(route);

  const cumulative: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    cumulative.push(cumulative[i - 1] + frameworkDistanceKm(route[i - 1], route[i]));
  }
  const totalKm = cumulative[cumulative.length - 1];
  if (totalKm < 20) return null;

  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  let nearestDeviation = Infinity;
  let nearestProgress = 0;
  let nearestSegment = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const ax = (a.lon - lon) * 111.12 * cosLat;
    const ay = (a.lat - lat) * 111.12;
    const bx = (b.lon - lon) * 111.12 * cosLat;
    const by = (b.lat - lat) * 111.12;
    const vx = bx - ax;
    const vy = by - ay;
    const denom = vx * vx + vy * vy;
    const t = denom > 1e-6 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / denom)) : 0;
    const px = ax + vx * t;
    const py = ay + vy * t;
    const deviation = Math.hypot(px, py);
    if (deviation < nearestDeviation) {
      nearestDeviation = deviation;
      nearestProgress = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * t;
      nearestSegment = i;
    }
  }

  // Look 6-10 translation hours ahead, but constrain the target to a meteorologically
  // useful scale. This makes a route made from 2 points behave the same as one made from 20.
  const lookAheadKm = Math.max(150, Math.min(320, Math.max(8, speedKmh) * 8.0));
  const targetProgress = Math.min(totalKm, nearestProgress + lookAheadKm);

  let target = route[route.length - 1];
  for (let i = 0; i < route.length - 1; i++) {
    if (targetProgress <= cumulative[i + 1]) {
      const span = Math.max(1e-6, cumulative[i + 1] - cumulative[i]);
      const t = Math.max(0, Math.min(1, (targetProgress - cumulative[i]) / span));
      target = {
        lat: route[i].lat + (route[i + 1].lat - route[i].lat) * t,
        lon: route[i].lon + (route[i + 1].lon - route[i].lon) * t
      };
      break;
    }
  }

  const dx = (target.lon - lon) * 111.12 * cosLat;
  const dy = (target.lat - lat) * 111.12;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-3) return null;

  const segmentUnit = (idx: number) => {
    const i = Math.max(0, Math.min(route.length - 2, idx));
    const a = route[i], b = route[i + 1];
    const meanLat = ((a.lat + b.lat) * 0.5 * Math.PI) / 180;
    const sx = (b.lon - a.lon) * 111.12 * Math.max(0.15, Math.cos(meanLat));
    const sy = (b.lat - a.lat) * 111.12;
    const sm = Math.hypot(sx, sy) || 1;
    return { x: sx / sm, y: sy / sm };
  };
  const before = segmentUnit(nearestSegment - 1);
  const after = segmentUnit(nearestSegment + 1);
  const curvatureDeg = Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y))) * 180 / Math.PI;
  // TC translation usually eases modestly through tight recurvature before accelerating again.
  // Waypoint spacing is handled separately as a deliberate tempo cue; the geometry penalties stay
  // mild so ordinary route shape does not masquerade as a speed command.
  const curvaturePenalty = 1 - 0.22 * smoothstep01(Math.min(1, curvatureDeg / 72));
  const crossTrackPenalty = 1 - 0.08 * smoothstep01(Math.min(1, nearestDeviation / 260));
  const spacingSpeedFactor = getForecastFrameworkSpacingSpeedFactor(rawRoute, nearestProgress / Math.max(1, totalKm));

  return {
    u: dx / mag,
    v: dy / mag,
    deviationKm: nearestDeviation,
    progressKm: nearestProgress,
    remainingKm: Math.max(0, totalKm - nearestProgress),
    totalKm,
    curvatureDeg,
    spacingSpeedFactor,
    // Mild geometry correction for ordinary routes; true slowdown only at
    // explicit repeated-position dwell clusters.
    speedFactor: spacingSpeedFactor < 0.90
      ? Math.max(0.08, Math.min(1.12, curvaturePenalty * crossTrackPenalty * spacingSpeedFactor))
      : Math.max(0.93, Math.min(1.08, 0.96 + 0.04 * curvaturePenalty * crossTrackPenalty))
  };
}
export interface ForecastPathPoint {
  lat: number;
  lon: number;
  vmax: number;
  pmin: number;
  simHour: number;
  category: TyphoonCategory;
  speed: number;
  intensityDeferred?: boolean;
  /** Coarse geometry generated only for the live map. Formal products must recompute full geometry. */
  previewOnly?: boolean;
  /** A directly replayed archived analysis or an approved sandbox-constrained fix. */
  preSimulationGuided?: boolean;
  dissipated?: boolean;
  landed?: boolean;
  remnantVortex?: boolean;
  lowLevelVortexIntegrity?: number;
  warmWaterHoursAfterSea?: number;
  extrTransition?: number;
  coldAirWarmCoreDestroyed?: boolean;
  ewrcState?: Typhoon["ewrcState"];
  ewrcProgress?: number;
  structuralDamageHours?: number;
  isStructureDamaged?: boolean;
  terrainHollowCoreMemory?: number;
  terrainHollowCoreBearingDeg?: number;
  structuralDamagePenaltyFactor?: number;
  penaltyRecoveryActive?: boolean;
  penaltyRecoveryElapsedHours?: number;
  penaltyRecoveryTotalHours?: number;
}

export function calculateForecastPath(
  typhoon: Typhoon,
  config: SimulationConfig,
  targetHours: number = 120,
  fastMode: boolean = false,
  continueResidualToDissipation: boolean = false,
  pathOnly: boolean = false,
  geometryOverride?: ReadonlyArray<{ lat: number; lon: number; simHour: number; speed?: number; previewOnly?: boolean }>,
  integrationStepHours: number = 1
): ForecastPathPoint[] {
  let initialCategory = TyphoonCategory.TD;
  if (typhoon.coldAirWarmCoreDestroyed || typhoon.category === TyphoonCategory.RL) initialCategory = TyphoonCategory.RL;
  else if ((typhoon.extrTransition ?? 0) >= 0.80 || typhoon.category === TyphoonCategory.ET) initialCategory = TyphoonCategory.ET;
  else if (typhoon.vmax >= 51.0) initialCategory = TyphoonCategory.SuperTY;
  else if (typhoon.vmax >= 41.5) initialCategory = TyphoonCategory.STY;
  else if (typhoon.vmax >= 32.7) initialCategory = TyphoonCategory.TY;
  else if (typhoon.vmax >= 24.5) initialCategory = TyphoonCategory.STS;
  else if (typhoon.vmax >= 17.2) initialCategory = TyphoonCategory.TS;

  const forecast: ForecastPathPoint[] = [
    {
      lat: typhoon.lat,
      lon: typhoon.lon,
      vmax: typhoon.vmax,
      pmin: typhoon.pmin,
      simHour: 0,
      category: initialCategory,
      speed: typhoon.speed,
      landed: !!typhoon.landed,
      remnantVortex: typhoon.vmax < 17.2 && (typhoon.lowLevelVortexIntegrity ?? 0.56) > 0.18,
      lowLevelVortexIntegrity: clamp01(typhoon.lowLevelVortexIntegrity ?? 0.56),
      warmWaterHoursAfterSea: Math.max(0, typhoon.warmWaterHoursAfterSea ?? 0),
      extrTransition: clamp01(typhoon.extrTransition || 0),
      coldAirWarmCoreDestroyed: !!typhoon.coldAirWarmCoreDestroyed,
      ewrcState: typhoon.ewrcState || "none",
      ewrcProgress: clamp01(typhoon.ewrcProgress || 0),
      structuralDamageHours: Math.max(0, typhoon.structuralDamageHours || 0),
      isStructureDamaged: !!typhoon.isStructureDamaged,
      terrainHollowCoreMemory: clamp01(typhoon.terrainHollowCoreMemory || 0),
      terrainHollowCoreBearingDeg: typhoon.terrainHollowCoreBearingDeg,
      structuralDamagePenaltyFactor: clamp01(typhoon.structuralDamagePenaltyFactor ?? 1),
      penaltyRecoveryActive: !!typhoon.penaltyRecoveryActive,
      penaltyRecoveryElapsedHours: Math.max(0, typhoon.penaltyRecoveryElapsedHours ?? 0),
      penaltyRecoveryTotalHours: Math.max(1, typhoon.penaltyRecoveryTotalHours ?? 18)
    }
  ];
  const playgroundMode = isPlaygroundMode(config);
  const forecastPeakReference = getForecastPeakIntensityReference(config);
  // A forecast-only peak reference supersedes the live target/cap inside future guidance. The live
  // control still governs the simulated cyclone itself, but it must not turn this new forecast
  // aspiration into a hidden hard ceiling.
  const forecastHardCapActive = forecastPeakReference === null && isTargetIntensityCapActive(config);
  const maxLimit = forecastHardCapActive ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 110;
  
  // Clone typhoon state
  const startLat = typhoon.lat;
  const startLon = typhoon.lon;
  let currentLat = typhoon.lat;
  let currentLon = typhoon.lon;
  let currentVmax = typhoon.vmax;
  let currentPmin = typhoon.pmin;
  const forecastEnvironmentBaseHour = typhoon.history?.length
    ? Number(typhoon.history[typhoon.history.length - 1].simHour || 0)
    : 0;

  // Reconstruct current actual velocity components (m/s) from current speed (km/h) and direction (degrees)
  const currentSpeedMps = typhoon.speed / 3.6;
  const currentDirRad = (typhoon.direction * Math.PI) / 180.0;
  const u_current = currentSpeedMps * Math.sin(currentDirRad);
  const v_current = currentSpeedMps * Math.cos(currentDirRad);
  // New-environment forecasts keep a weak one-hour heading memory. This is not a prescribed
  // track: it only prevents a point-scale synthetic feature from flipping the motion vector by
  // tens of degrees between adjacent one-hour integration steps.
  let previousForecastU = u_current;
  let previousForecastV = v_current;

  // Current atmospheric steering flow at the typhoon's actual current location
  const currentSteering = getSteeringFlow(typhoon.lat, typhoon.lon, typhoon.vmax, config, false, forecastEnvironmentBaseHour, !!config.newEnvironmentPhysicsEnabled);
  const u_steer_current = currentSteering.u;
  const v_steer_current = currentSteering.v;

  // The base/non-atmospheric movement vector (joystick bias, beta drift, internal dynamics)
  const forecastResidualRetention = config.newEnvironmentPhysicsEnabled ? 0.38 : 1.0;
  const u_base = (u_current - u_steer_current) * forecastResidualRetention;
  const v_base = (v_current - v_steer_current) * forecastResidualRetention;
  let forecastUpwellingHours = typhoon.upwellingHours || 0;
  let forecastSuperTyLandHours = typhoon.superTyLandHours || 0;
  let forecastLandHours = typhoon.landHours || 0;
  let forecastLandContactHours = typhoon.landContactHours || 0;
  let forecastR10LandContactHours = typhoon.r10LandContactHours || 0;
  let forecastMaxLandElevationPassed = typhoon.maxLandElevationPassed || 0;
  let forecastStructuralDamageHours = typhoon.structuralDamageHours || 0;
  let forecastWarmWaterHoursAfterSea = typhoon.warmWaterHoursAfterSea || 0;
  const forecastHasTerrainHistory = typhoon.damageOrigin === "terrain" || typhoon.damageOrigin === "mixed" ||
    !!typhoon.passedTaiwanCentral || !!typhoon.passedLuzonMountains || (typhoon.maxLandElevationPassed || 0) > 0;
  let forecastRecentLandExposureHours = Math.max(
    0,
    typhoon.landHours || 0,
    forecastHasTerrainHistory ? Math.min(36, typhoon.structuralDamageHours || 0) : 0
  );
  let forecastWasLand = !!typhoon.landed;
  // Translation-speed land memory is intentionally separate from the physical land-damage memory.
  // Round 121 narrows this speed-only geography to the Eurasian mainland, Taiwan, Hainan and the
  // Philippine archipelago. Land interaction elsewhere still affects intensity/terrain physics but
  // cannot seed the nearshore/post-landfall translation slowdown.
  const initialSpeedLandContext = getForecastSpeedSlowdownLandContext(typhoon.lat, typhoon.lon);
  const initialSpeedLandEligible = initialSpeedLandContext.isLand;
  let recentEligibleSpeedLandSeed = initialSpeedLandEligible ? Math.max(0, typhoon.landHours || 0) : 0;
  // If the issue time is already just offshore, recover only *eligible* recent landfall memory from
  // history. This preserves a China/Taiwan/Hainan/Philippines post-landfall slowdown without letting
  // a prior Japan/Indonesia/Australia crossing leak physical damage memory into translation speed.
  const speedHistory = typhoon.history || [];
  const speedHistoryNow = speedHistory.length ? Number(speedHistory[speedHistory.length - 1].simHour || 0) : forecastEnvironmentBaseHour;
  for (let i = speedHistory.length - 1; i >= 0; i--) {
    const state = speedHistory[i];
    const ageHours = Math.max(0, speedHistoryNow - Number(state.simHour || 0));
    if (ageHours > 36) break;
    if (!state.landed || !getForecastSpeedSlowdownLandContext(state.lat, state.lon).isLand) continue;
    const exposureAtLand = Math.max(3.2, Number(state.landHours || 0), Number(state.landContactHours || 0));
    recentEligibleSpeedLandSeed = Math.max(recentEligibleSpeedLandSeed, Math.max(0, exposureAtLand - 0.18 * ageHours));
    break;
  }
  let forecastSpeedLandHours = initialSpeedLandEligible ? Math.max(0, typhoon.landHours || 0) : 0;
  let forecastSpeedRecentLandExposureHours = recentEligibleSpeedLandSeed;
  let forecastSpeedWasLand = initialSpeedLandEligible && !!typhoon.landed;
  let forecastIsStructureDamaged = typhoon.isStructureDamaged || false;
  let forecastTerrainHollowCoreMemory = clamp01(typhoon.terrainHollowCoreMemory ?? 0);
  let forecastTerrainHollowCoreBearingDeg = Number.isFinite(typhoon.terrainHollowCoreBearingDeg as number)
    ? Number(typhoon.terrainHollowCoreBearingDeg)
    : Number(typhoon.direction || 0);
  let forecastPassedTaiwan = typhoon.passedTaiwanCentral || false;
  let forecastPassedLuzon = typhoon.passedLuzonMountains || false;
  let forecastUpwellingPersistentPenaltyHours = typhoon.upwellingPersistentPenaltyHours || 0;
  let forecastConsecutiveUpwellingHours = typhoon.consecutiveUpwellingHours || 0;
  let forecastRapidIntensifying = typhoon.rapidIntensifying || false;
  let forecastForcedRapid = !!typhoon.forcedRapidIntensification;
  let forecastRapidMode: "ri" | "eri" | "uri" = typhoon.forcedRapidIntensificationMode || typhoon.rapidIntensificationMode || "ri";
  let forecastRapidElapsedHours = typhoon.rapidEpisodeElapsedHours || 0;
  let forecastRapidDurationHours = typhoon.rapidEpisodeDurationHours;
  let forecastRapidTarget24h = typhoon.rapidEpisodeTarget24h;
  let forecastRapidStartRate = typhoon.rapidEpisodeStartRate;
  let forecastRapidLastRate = typhoon.rapidEpisodeLastRate;
  let forecastRapidExitHours = typhoon.rapidEpisodeExitHours || 0;
  let forecastRapidExitDuration = typhoon.rapidEpisodeExitDuration;
  let forecastRapidAbortRequested = !!typhoon.rapidEpisodeAbortRequested;
  let forecastRapidFavorableHours = typhoon.rapidFavorableHours || 0;
  let forecastRapidCooldownHours = typhoon.rapidTriggerCooldownHours || 0;
  let forecastPlaygroundAutoERIPaused = !!typhoon.playgroundAutoERIPaused;
  let forecastIntensityRateMemory = typhoon.intensityRateMemory || 0;
  let forecastExtrTransition = typhoon.extrTransition || 0;
  let forecastEtHours = typhoon.etHours || 0;
  // ROUND103: warm-core destruction is an irreversible analysis-state latch. Forecast guidance
  // inherits it so products cannot show a tropical or baroclinic rebound after destruction.
  const forecastWarmCoreDestroyed = !!typhoon.coldAirWarmCoreDestroyed;
  if (forecastWarmCoreDestroyed) {
    forecastForcedRapid = false;
    forecastRapidIntensifying = false;
    forecastRapidAbortRequested = true;
  }
  let forecastMoistureReservoir = clamp01(typhoon.moistureReservoir ?? 0.96);
  let forecastColdWaterExposureHours = Math.max(0, typhoon.coldWaterExposureHours ?? 0);
  // 3.3.4 forecast carries the same separated structural memories as the live engine.  Forecast
  // intensity should not forget that a post-peak cyclone can lose its CDO/eye much faster than
  // its broad low-level vortex, nor should environmental dry air instantaneously reach the core.
  let forecastDryAirWrapFraction = clamp01(typhoon.dryAirWrapFraction ?? Math.min(0.35, (typhoon.dryAirIntrusion ?? 0) * 0.45));
  let forecastMoistEnvelopeIntegrity = clamp01(typhoon.moistEnvelopeIntegrity ?? 0.62);
  let forecastInnerCoreMoisture = clamp01(typhoon.innerCoreMoisture ?? 0.68);
  let forecastEyewallOpenSectorFraction = clamp01(typhoon.eyewallOpenSectorFraction ?? 0.08);
  let forecastDeepConvectiveCoverage = clamp01(typhoon.deepConvectiveCoverage ?? 0.34);
  let forecastLowLevelVortexIntegrity = clamp01(typhoon.lowLevelVortexIntegrity ?? 0.56);
  let forecastPostPeakEnvelopeMemory = clamp01(typhoon.postPeakEnvelopeMemory ?? 0.10);
  let forecastPeakVmaxMemory = Math.max(typhoon.peakVmaxMemory ?? typhoon.vmax, typhoon.vmax);
  let forecastSuccessfulEwrcCount = Math.max(0, typhoon.successfulEwrcCount ?? 0);
  let forecastExtremeIntensityHours = Math.max(0, typhoon.extremeIntensityHours ?? 0);
  let forecastDryAirCoreExposure = clamp01(typhoon.dryAirCoreExposure ?? 0);
  let forecastDryAirVentilationIndex = clamp01(typhoon.dryAirVentilationIndex ?? 0);
  let forecastDryAirCoreConnection = clamp01(typhoon.dryAirCoreConnection ?? 0);
  let forecastDryAirReMoistening = clamp01(typhoon.dryAirReMoistening ?? 0);
  let forecastTdHours = Math.max(0, typhoon.tdHours ?? 0);
  let forecastLandTdHours = Math.max(0, typhoon.landTdHours ?? 0);
  let forecastForcedDecayStartVmax = typhoon.forcedDecayStartVmax;
  let forecastForcedDecayTargetVmax = typhoon.forcedDecayTargetVmax;
  let forecastForcedDecayElapsedHours = typhoon.forcedDecayElapsedHours || 0;
  let forecastForcedDecayDuration = typhoon.forcedDecayDuration;
  let forecastForcedDecayIsContinuous = typhoon.forcedDecayIsContinuous || false;
  // 3.5.7: carry the live post-landfall tropical-storm shelf state into forecast guidance.
  // The forecast previously rebuilt the shelf from forecast lead time (`h`), so a cyclone that
  // had already spent many hours on the shelf could unrealistically receive a fresh full shelf,
  // while a cyclone entering the shelf just before forecast issuance could lose its live memory.
  let forecastPlainTsShelfHours = Math.max(0, typhoon.plainTsShelfHours ?? 0);
  let forecastPlainTsShelfMemory = clamp01(typhoon.plainTsShelfMemory ?? 0);
  let forecastColdWaterTsShelfHours = Math.max(0, typhoon.coldWaterTsShelfHours ?? 0);
  let forecastColdWaterTsShelfMemory = clamp01(typhoon.coldWaterTsShelfMemory ?? 0);

  // Carry active manual-environment episodes into the forecast so the displayed intensity
  // guidance does not immediately forget a dry-air/shear intervention or its recovery inertia.
  let forecastForcedDryAir = typhoon.forcedDryAir;
  let forecastDryAirPenaltyHours = typhoon.dryAirPenaltyHours;
  let forecastDryAirPenaltyTotalHours = typhoon.dryAirPenaltyTotalHours;
  // Playground suppresses ambient shear, but explicit user-applied shear remains a valid
  // intervention and must be carried into the forecast so it can terminate auto-ERI.
  let forecastForcedShear = typhoon.forcedShear;
  let forecastShearPenaltyHours = typhoon.shearPenaltyHours;
  let forecastShearPenaltyTotalHours = typhoon.shearPenaltyTotalHours;
  let forecastRecoveryHours = typhoon.cloggedRecoveryHours;
  let forecastRecoveryTotalHours = typhoon.cloggedRecoveryTotalHours;
  let forecastPenaltyRecoveryActive = !!typhoon.penaltyRecoveryActive;
  let forecastPenaltyRecoveryElapsedHours = Math.max(0, typhoon.penaltyRecoveryElapsedHours ?? 0);
  const forecastPenaltyRecoveryTotalHours = Math.max(1, typhoon.penaltyRecoveryTotalHours ?? 18);
  
  let ewrcState = playgroundMode ? "none" : (typhoon.ewrcState || "none");
  let ewrcProgress = playgroundMode ? 0 : (typhoon.ewrcProgress || 0);
  let ewrcDuration = typhoon.ewrcDuration || 12;
  let ewrcWeakenAmount = typhoon.ewrcWeakenAmount || 6;
  let ewrcExtraAdjust = typhoon.ewrcExtraAdjust || 0;
  let ewrcRecoveryDuration = typhoon.ewrcRecoveryDuration || 12;
  let forecastManualEwrcOutcomeOverride = playgroundMode ? undefined : typhoon.manualEwrcOutcomeOverride;
  let forecastEwrcIsFailure = playgroundMode
    ? false
    : forecastManualEwrcOutcomeOverride
      ? forecastManualEwrcOutcomeOverride === "failure"
      : (typhoon.ewrcIsFailure || false);
  let forecastEwrcFailurePenaltyHours = playgroundMode ? 0 : (typhoon.ewrcFailurePenaltyHours || 0);
  let forecastEwrcPenaltyTotalHours = playgroundMode ? 0 : (typhoon.ewrcPenaltyTotalHours || 0);

  // Keep forecast products consistent with a user override even when opening a product immediately
  // after editing an older/legacy snapshot whose stored state still carries the opposite phase.
  if (forecastManualEwrcOutcomeOverride === "success" && (ewrcState === "penalty_failure" || ewrcState === "recovering_failure")) {
    ewrcState = "recovering_success";
    ewrcProgress = 0;
    forecastEwrcIsFailure = false;
    forecastEwrcFailurePenaltyHours = 0;
    forecastEwrcPenaltyTotalHours = 0;
    ewrcRecoveryDuration = Math.max(8, Math.min(24, ewrcRecoveryDuration || 12));
    ewrcExtraAdjust = Math.max(ewrcExtraAdjust, 0.10);
  } else if (forecastManualEwrcOutcomeOverride === "failure" && ewrcState === "recovering_success") {
    ewrcState = "penalty_failure";
    ewrcProgress = 0;
    forecastEwrcIsFailure = true;
    forecastEwrcPenaltyTotalHours = Math.max(12, forecastEwrcPenaltyTotalHours || Math.min(30, 14 + typhoon.vmax * 0.16));
    forecastEwrcFailurePenaltyHours = 0;
  }
  
  const totalHours = targetHours;
  // Formal forecasts retain the established 1-hour integration.  A live-map preview may use a
  // 3-hour step because the UI only renders issued points every 3 hours; this cuts synchronous
  // steering/land-speed work by about two thirds without lowering product-generation accuracy.
  const stepSizeHours = pathOnly ? Math.max(1, Math.min(6, integrationStepHours)) : 1;
  // The deterministic forecast keeps the established fast-mode land sampling behaviour.
  // Hurricane Tracker pseudo multi-model paths are now computed by HurricaneTrackerPort.ts and
  // no longer reuse this physical forecast integrator.
  const preciseLandIntensity = false;
  
  // Deterministic local pseudorandom generators. Track and thermodynamic randomness intentionally
  // use independent streams. 3.6.10 consumed one shared stream, which accidentally correlated
  // steering-side placement with RI/EWRC/intensity outcomes and produced a persistent spatial
  // strength gradient across the spaghetti plume.
  const hashSeed = (value: string): number => {
    let h = 2166136261 >>> 0;
    for (let charIdx = 0; charIdx < value.length; charIdx++) {
      h ^= value.charCodeAt(charIdx);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const makeForecastRand = (salt: string) => {
    let state = hashSeed(`${config.seed || "forecast"}|${salt}|${typhoon.id || "tc"}`) || 0x6d2b79f5;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const randTrack = makeForecastRand("track");
  const randIntensity = makeForecastRand("intensity");

  const periodLong = 60 + randTrack() * 60; // 60 to 120 hours
  const periodMedium = 28 + randTrack() * 24; // 28 to 52 hours
  const ampLong = (fastMode ? 1.1 : 0.6) * (0.8 + randTrack() * 1.5); // m/s
  const ampMedium = (fastMode ? 0.7 : 0.4) * (0.5 + randTrack() * 0.9); // m/s
  const phaseLong = randTrack() * Math.PI * 2;
  const phaseMedium = randTrack() * Math.PI * 2;
  const trochoidalPeriodBase = 18 + randTrack() * 12;
  const sinuosPeriodBase = 44 + randTrack() * 30;

  let u_drift = 0;
  let v_drift = 0;
  let hasRecurved = false;

  // 5.2.28: a forecast product may hydrate thermodynamic/intensity guidance later on top of the
  // exact geometry that was archived during the live simulation. This keeps "what path was issued"
  // immutable while moving the expensive intensity integration out of the simulation loop.
  const archivedGeometry = (geometryOverride || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.simHour))
    .slice()
    .sort((a, b) => Number(a.simHour) - Number(b.simHour));
  const geometryAtLead = (lead: number) => {
    if (!archivedGeometry.length) return null;
    if (lead < Number(archivedGeometry[0].simHour) - 1e-6 || lead > Number(archivedGeometry[archivedGeometry.length - 1].simHour) + 1e-6) return null;
    let hi = 0;
    while (hi < archivedGeometry.length && Number(archivedGeometry[hi].simHour) < lead - 1e-6) hi++;
    if (hi <= 0) return archivedGeometry[0];
    if (hi >= archivedGeometry.length) return archivedGeometry[archivedGeometry.length - 1];
    const b = archivedGeometry[hi];
    const a = archivedGeometry[hi - 1];
    const span = Math.max(1e-6, Number(b.simHour) - Number(a.simHour));
    const t = Math.max(0, Math.min(1, (lead - Number(a.simHour)) / span));
    return {
      lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * t,
      lon: Number(a.lon) + (Number(b.lon) - Number(a.lon)) * t,
      simHour: lead,
      speed: Number.isFinite(Number(a.speed)) && Number.isFinite(Number(b.speed))
        ? Number(a.speed) + (Number(b.speed) - Number(a.speed)) * t
        : undefined
    };
  };

  for (let h = stepSizeHours; h <= totalHours; h += stepSizeHours) {
    // Ordinary guidance stops once the circulation reaches the universal 5 m/s floor. Diagnostic
    // residual-vortex ensemble products may deliberately keep integrating to their total lead-time
    // ceiling so each member can retain a short post-floor display tail.
    // A newly generated tropical depression may legitimately sit on the 5 m/s analysis floor
    // before organization begins. Treat that as a *genesis state*, not an automatic end-of-
    // guidance signal. JMA/ensemble products therefore receive future guidance from weak TD
    // issues instead of collapsing to a single 0 h point. True dissipated/remnant cases still
    // terminate through the normal TD/residual-vortex criteria below.
    const hasPreviouslyReachedTropicalStorm = (typhoon.history || []).some((state) => Number(state?.vmax || 0) >= 17.2);
    const viableGenesisAtIntensityFloor = !typhoon.dissipated && !forecastWarmCoreDestroyed &&
      !hasPreviouslyReachedTropicalStorm && Number(typhoon.vmax || 0) < 17.2 &&
      forecastLowLevelVortexIntegrity > 0.18 && forecastTdHours < 96;
    if ((!continueResidualToDissipation && currentVmax <= MIN_CYCLONE_INTENSITY_MS && !viableGenesisAtIntensityFloor) || typhoon.dissipated) {
      break;
    }
    const previousForecastLat = currentLat;
    const previousForecastLon = currentLon;
    // 1. Steering flow
    const steering = getSteeringFlow(currentLat, currentLon, currentVmax, config, false, forecastEnvironmentBaseHour + h, !!config.newEnvironmentPhysicsEnabled);
    
    if (config.steeringBiasU !== undefined) {
      const timeFactor = 1.0 + Math.sin(h / 60) * 0.2;
      steering.u += config.steeringBiasU * timeFactor;
    }
    if (config.steeringBiasV !== undefined) {
      const timeFactor = 1.0 + Math.cos(h / 72) * 0.25;
      steering.v += config.steeringBiasV * timeFactor;
    }

    const steeringStrength = Math.sqrt(steering.u * steering.u + steering.v * steering.v);
    
    // Requirement 1: In weak steering flow (< 3.0 m/s), path is NOT a simple straight line!
    // Infer user intention & momentum vector, and apply non-linear beta-gyre Coriolis curvature
    const weakSteeringFactor = Math.max(0, (3.0 - steeringStrength) / 3.0);
    
    // Trochoidal motion and cross-track sinuosity belong to the legacy synthetic path model. The
    // full synoptic environment already contains monsoon lows, troughs, ridges and beta drift;
    // stacking the old large wobble/ever-growing gyre curvature on top of it can manufacture a
    // second artificial vortex and was a major source of the tight 3.7.8 forecast loops. Keep only
    // a small TC-scale wobble when the new environment is active.
    const trochoidalPeriod = trochoidalPeriodBase * (1 + 0.055 * Math.sin(h / 46 + phaseMedium));
    const trochoidalAmp = config.newEnvironmentPhysicsEnabled
      ? (0.08 + 0.14 * weakSteeringFactor)
      : (0.5 * weakSteeringFactor + 0.25);
    const trochoidalU = Math.sin((h / trochoidalPeriod) * Math.PI * 2 + phaseLong) * trochoidalAmp;
    const trochoidalV = Math.cos((h / trochoidalPeriod) * Math.PI * 2 + phaseMedium) * trochoidalAmp;

    const sinuosPeriod = sinuosPeriodBase * (1 + 0.075 * Math.sin(h / 73 + phaseLong * 0.6));
    const sinuosAmp = config.newEnvironmentPhysicsEnabled
      ? 0.16 * (1.0 + 0.45 * weakSteeringFactor)
      : 0.55 * (1.2 + weakSteeringFactor);
    const crossU = -(steering.v / (steeringStrength + 0.6)) * Math.sin((h / sinuosPeriod) * Math.PI * 2 + phaseLong * 0.4) * sinuosAmp;
    const crossV = (steering.u / (steeringStrength + 0.6)) * Math.sin((h / sinuosPeriod) * Math.PI * 2 + phaseLong * 0.4) * sinuosAmp;

    // The new synoptic field has an explicit monsoon-gyre circulation and beta propagation. Do not
    // add the old time-growing pseudo-gyre curvature a second time.
    const gyreCurvatureU = config.newEnvironmentPhysicsEnabled
      ? 0
      : weakSteeringFactor * (0.025 * h * Math.sin((currentLat * Math.PI) / 180));
    const gyreCurvatureV = config.newEnvironmentPhysicsEnabled ? 0 : weakSteeringFactor * (0.015 * h);

    const inertiaDecay = Math.exp(-0.012 * h); // Slightly slower momentum decay for better "intent" (Requirement 3)
    
    // Beta Drift (Rossby wave dispersion)
    // Requirement 5 & 6: Beta drift influenced by actual size (r7) and lat
    const scale = config?.betaDriftScale ?? 1.0;
    const betaDriftBaseR7 = currentVmax * 5.8 + 30;
    const sizeFactor = Math.max(0.3, Math.min(2.0, betaDriftBaseR7 / 250.0));
    // The full new steering engine already carries beta propagation. Do not add it twice.
    const legacyBetaEnabled = !!config?.betaDriftEnabled && !config.newEnvironmentPhysicsEnabled;
    const betaLatBoost = legacyBetaEnabled ? 0.7 * scale * sizeFactor * (1.0 + Math.sin((currentLat * Math.PI)/180)) : 0;
    const betaLonBoost = legacyBetaEnabled ? -0.5 * scale * sizeFactor * (1.0 + Math.sin((currentLat * Math.PI)/180)) : 0;
    
    // Subtropical High Ridge Curvature (realistic parabolic arc)
    const subHighArcPhase = Math.sin((h / 120) * Math.PI) * 0.6;
    
    // Low-frequency waves and dynamic random walks for highly realistic, wavy meteorological pathways
    let waveU = 0;
    let waveV = 0;
    let finalNoiseVal = 1.0;
    if ((config.randomNoise ?? 0) > 0 || fastMode) {
      // Genesis uncertainty: newly generated or weak typhoons have 60% higher path controversy (Requirement)
      const isEarlyStage = (typhoon.history?.length ?? 0) < 12 || typhoon.vmax < 25.0;
      const noiseVal = (config.randomNoise ?? 0.3) * (isEarlyStage ? 1.6 : 1.0);
      
      // Uncertainty profile: extremely low in short-term (first 12h), dynamically widening in long-term
      let timeScale = 0;
      if (h <= 12) {
        timeScale = Math.pow(h / 12.0, 1.8) * 0.18; 
      } else if (h <= 72) {
        // Linear growth up to 3 days
        timeScale = 0.18 + (h - 12) / 60.0; 
      } else {
        // Slowing growth for very long term to prevent extreme "unphysical" outliers
        timeScale = 1.18 + Math.sqrt((h - 72) / 24.0) * 0.25;
      }
      
      // Cap maximum timeScale to prevent extreme divergence at 10+ days
      timeScale = Math.min(2.0, timeScale);

      // Genesis uncertainty also causes faster divergence in the first 24 hours
      if (isEarlyStage && h <= 36) {
        timeScale *= 1.25;
      }

      // Weak Steering Boost: Toned down to prevent chaotic patterns (Requirement)
      const steeringStrength = Math.sqrt(steering.u * steering.u + steering.v * steering.v);
      const weakSteeringNoiseBoost = 1.0 + Math.max(0, (3.0 - steeringStrength) / 3.0) * 0.7;
      finalNoiseVal = noiseVal * weakSteeringNoiseBoost;

      // Decouple U and V components and use slightly different frequencies to prevent systematic circular spiraling
      waveU = Math.sin((h / periodLong) * Math.PI * 2 + phaseLong) * ampLong * finalNoiseVal * 0.8 * timeScale + 
              Math.sin((h / periodMedium) * Math.PI * 2 + phaseMedium) * ampMedium * finalNoiseVal * 0.8 * timeScale;
      waveV = Math.sin((h / (periodLong * 1.27)) * Math.PI * 2 + phaseLong + 1.1) * ampLong * finalNoiseVal * 0.8 * timeScale + 
              Math.sin((h / (periodMedium * 0.78)) * Math.PI * 2 + phaseMedium + 0.6) * ampMedium * finalNoiseVal * 0.8 * timeScale;

      // High-frequency micro-wiggle (tortuosity) to give paths an organic "jitter"
      const microWiggleU = Math.sin((h / 4.2) * Math.PI * 2 + phaseLong * 6.0) * 0.16 * finalNoiseVal;
      const microWiggleV = Math.sin((h / 5.1) * Math.PI * 2 + phaseMedium * 6.0 + 0.5) * 0.16 * finalNoiseVal;
      // Pure random "shiver" reduced to prevent "drunk walk" look
      const shiverU = (randTrack() - 0.5) * 0.22 * finalNoiseVal;
      const shiverV = (randTrack() - 0.5) * 0.22 * finalNoiseVal;
      waveU += microWiggleU + shiverU;
      waveV += microWiggleV + shiverV;
              
      // Random walk steering drift: more persistent to create organic curves
      const persistence = 0.94; 
      const driftIntensity = finalNoiseVal * 0.12 * timeScale;
      u_drift = u_drift * persistence + (randTrack() - 0.5) * driftIntensity;
      v_drift = v_drift * persistence + (randTrack() - 0.5) * driftIntensity;
      
      const maxDrift = 1.2 * finalNoiseVal;
      u_drift = Math.max(-maxDrift, Math.min(maxDrift, u_drift));
      v_drift = Math.max(-maxDrift, Math.min(maxDrift, v_drift));

      const maxDistortion = Math.max(0.5, steeringStrength * 0.8);
      const waveMag = Math.sqrt(waveU*waveU + waveV*waveV);
      if (waveMag > maxDistortion) {
         waveU = (waveU / waveMag) * maxDistortion;
         waveV = (waveV / waveMag) * maxDistortion;
      }

      // Constrain perturbations relative to the steering force so they never overpower it
      let perturbU = waveU + u_drift + trochoidalU + crossU;
      let perturbV = waveV + v_drift + trochoidalV + crossV;
      const perturbMag = Math.sqrt(perturbU * perturbU + perturbV * perturbV);
      const maxPerturb = Math.min(3.5, 0.3 * steeringStrength + 0.8) * finalNoiseVal;
      if (perturbMag > maxPerturb && perturbMag > 0) {
        const scale = maxPerturb / perturbMag;
        perturbU *= scale;
        perturbV *= scale;
        // Scale drift back proportionally
        u_drift *= scale;
        v_drift *= scale;
      }

      // Angular perturbation: instead of just Cartesian noise, perturb the movement direction
      // This creates spread without reversing the motion
      const currentSpeed = Math.sqrt(steering.u * steering.u + steering.v * steering.v);
      if (currentSpeed > 0.4) {
        const angularNoise = (randTrack() - 0.5) * 0.18 * timeScale * noiseVal;
        const cosA = Math.cos(angularNoise);
        const sinA = Math.sin(angularNoise);
        const u_new = steering.u * cosA - steering.v * sinA;
        const v_new = steering.u * sinA + steering.v * cosA;
        steering.u = u_new;
        steering.v = v_new;
      }
    }

    // Accumulate components
    let perturbU_final = waveU + u_drift + trochoidalU + crossU;
    let perturbV_final = waveV + v_drift + trochoidalV + crossV;
    const finalPerturbMag = Math.sqrt(perturbU_final * perturbU_final + perturbV_final * perturbV_final);
    const finalMaxPerturb = Math.min(3.5, 0.3 * steeringStrength + 0.8) * (finalNoiseVal || 1.0);
    if (finalPerturbMag > finalMaxPerturb && finalPerturbMag > 0) {
      const scale = finalMaxPerturb / finalPerturbMag;
      perturbU_final *= scale;
      perturbV_final *= scale;
    }

    let u_agg = (u_base * inertiaDecay) + steering.u + betaLonBoost + gyreCurvatureU + perturbU_final;
    let v_agg = (v_base * inertiaDecay) + steering.v + betaLatBoost + gyreCurvatureV + perturbV_final;
    
    // 4.1.2: the synoptic environment is allowed to contain weak-steering / col regions.
    // The old 2.8 m/s floor amplified small directional changes from nearby idealized features
    // into large looping forecast motion. Keep only a tiny numerical anti-stall floor for the new
    // environment; legacy forecasts retain their established minimum speed.
    const speed = Math.sqrt(u_agg * u_agg + v_agg * v_agg);
    const minSpeed = config.newEnvironmentPhysicsEnabled ? 0.9 : 2.8;
    if (speed < minSpeed && speed > 0) {
      const ratio = minSpeed / speed;
      u_agg *= ratio;
      v_agg *= ratio;
    }
    
    // 3. Westerlies steering force (Apply ONLY when westerlies are enabled and active)
    const forecastWesterlyRegimeDepth = effectiveWesterlyDepth(currentLat, currentLon, config, forecastEnvironmentBaseHour + h);
    const isWesterliesActive = config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.14 : (!!config?.westerliesEnabled && (config?.westerliesStrength ?? 1.0) > 0);
    const westerliesLat = config?.westerliesLat ?? 30.0;
    const inWesterliesZone = config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.20 : (isWesterliesActive && currentLat > westerliesLat - 8.0);
    
    if (isWesterliesActive && (config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.38 : currentLat > westerliesLat) && currentLon > 125.0 && u_agg > 2.0) {
      hasRecurved = true;
    }

    // Only treat the far edge of the expanded simulation domain as a hard responsibility boundary.
    if (currentLon >= 218.0) {
      hasRecurved = true;
    }

    if ((inWesterliesZone && hasRecurved) || currentLon >= 218.0) {
      // Do not inject a hard due-east speed component after recurvature. The resolved synoptic
      // steering determines heading; the regime calibration below changes magnitude only.
      // The old fixed southward clamp made mid-latitude/ET motion unrealistically one-way.
      // Relax it continuously with ET progress and remove it completely once transition is mature.
      if (forecastExtrTransition < 0.96) {
        const etFreedom = smoothstep01(clamp01((forecastExtrTransition - 0.08) / 0.88));
        const southwardFloor = -0.2 - 9.8 * etFreedom;
        if (v_agg < southwardFloor) v_agg = southwardFloor;
      }
    }
    
    // User-drawn forecast framework controls both heading and *relative translation tempo*. Dense
    // repeated waypoints can deliberately create a slow/stalled section; isolated irregular gaps
    // remain almost neutral. The resulting deterministic speed is the baseline later inherited by
    // all AETHER model centres and ensemble members.
    let manualRouteTempoFactor = 1;
    // Treat an empty/stale enabled flag exactly like “no framework”. Older saves could retain
    // manualForecastRouteEnabled=true after clearing the points; that accidentally disabled the
    // ordinary curvature guard and produced wild ensemble/reference arcs even though no route was
    // visible. Geometry authority exists only when at least two finite points are present.
    const hasManualForecastFramework = !!config.manualForecastRouteEnabled &&
      (config.manualForecastRoute?.length || 0) >= 2 &&
      config.manualForecastRoute!.slice(0,2).every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (hasManualForecastFramework) {
      const preGuideSpeedKmh = Math.hypot(u_agg, v_agg) * 3.6;
      const guide = getForecastFrameworkGuidance(currentLat, currentLon, config.manualForecastRoute!, preGuideSpeedKmh);
      if (guide && guide.remainingKm > 12) {
        // The hand-drawn framework is a high-authority *deterministic reference* rather than a weak
        // steering suggestion. Strengthen its heading pull nonlinearly so a saved 0.95-ish framework
        // behaves closer to ~0.98 authority without snapping exactly onto the polyline. This acts only
        // on the deterministic/reference path; AETHER model/member spread is generated later from its
        // own unchanged perturbation machinery and is deliberately not multiplied by this authority.
        const configuredRouteWeight = Math.max(0, Math.min(0.992, config.manualForecastRouteWeight ?? 0.92));
        let routeWeight = 1 - Math.pow(1 - configuredRouteWeight, 1.34);
        const deviationReleaseStartKm = 240;
        if (guide.deviationKm > deviationReleaseStartKm) {
          const fullReleaseKm = 640;
          routeWeight *= Math.max(0, Math.min(1,
            (fullReleaseKm - guide.deviationKm) / Math.max(1, fullReleaseKm - deviationReleaseStartKm)
          ));
        }
        // Keep short-range guidance almost as authoritative as medium range. A small residual share of
        // synoptic steering is retained so the forecast still has meteorological texture and does not
        // become a literal point-to-point tracer.
        routeWeight *= h <= 24 ? 0.985 : h <= 72 ? 0.997 : 1.0;

        const physicalMag = Math.hypot(u_agg, v_agg);
        if (routeWeight > 0.01 && physicalMag > 0.05) {
          const pu = u_agg / physicalMag;
          const pv = v_agg / physicalMag;
          let bu = pu * (1 - routeWeight) + guide.u * routeWeight;
          let bv = pv * (1 - routeWeight) + guide.v * routeWeight;
          const bmag = Math.hypot(bu, bv) || 1;
          bu /= bmag;
          bv /= bmag;
          u_agg = bu * physicalMag;
          v_agg = bv * physicalMag;

          // Translation speed still starts from the synoptic steering magnitude. Route curvature,
          // alignment and the route's *relative waypoint spacing* provide bounded corrections.
          // Spacing is normalized against the route itself, so it never means "one point = N hours".
          const alignment = Math.max(-1, Math.min(1, pu * guide.u + pv * guide.v));
          const alignmentFactor = 0.82 + 0.18 * ((alignment + 1) * 0.5);
          const westerlyRouteBoost = inWesterliesZone && guide.u > 0.35
            ? 1 + 0.11 * Math.min(1, Math.max(0, guide.u))
            : 1;
          manualRouteTempoFactor = guide.spacingSpeedFactor;
          const ordinaryAlignmentFactor = 0.98 + 0.02 * ((alignment + 1) * 0.5);
          const requestedFactor = guide.speedFactor * (manualRouteTempoFactor < 0.90 ? alignmentFactor : ordinaryAlignmentFactor) * westerlyRouteBoost;
          // Near a deliberate stall the waypoint-tempo signal must dominate. For ordinary spacing
          // the blend remains softer, preserving natural steering-speed variability.
          const stallIntent = clamp01((0.82 - manualRouteTempoFactor) / 0.62);
          const tempoBlendWeight = Math.min(0.98, routeWeight * (0.91 + 0.07 * stallIntent));
          const speedBlend = 1 + (requestedFactor - 1) * tempoBlendWeight;
          const guidedMag = physicalMag * Math.max(
            stallIntent > 0.10 ? 0.08 : 0.92,
            Math.min(1.30, speedBlend)
          );
          u_agg = bu * guidedMag;
          v_agg = bv * guidedMag;
        }
      }
    }

    // Apply regime-based forecast translation-speed rules.
    // Keep the new forecast system independent from the legacy oval-ridge geometry.  The far-ocean
    // speed envelope is generic geography only; when the new environment is active use neutral
    // constants instead of the old subtropical-high latitude/west-extent sliders.
    const subHighLat = config.newEnvironmentPhysicsEnabled ? 28 : (config.subtropicalHighLat ?? 28);
    const subHighWest = config.newEnvironmentPhysicsEnabled ? 125 : (config.subtropicalHighWestExtent ?? 125);
    const isFarOcean = currentLon > 140.0 && Math.abs(currentLat - subHighLat) > 7.0 && currentLon > subHighWest + 10;

    let speedMps = Math.hypot(u_agg, v_agg);
    let speedKmh = speedMps * 3.6;

    // Regime-based translation calibration. The forecast keeps the synoptic steering direction,
    // but its speed relaxes toward observed-style ranges with low-frequency variation instead of a
    // single basin-wide 15–25 km/h bucket.
    // Keep product/track land semantics separate from the Round-121 translation-speed whitelist.
    // Japan and other substantial landmasses can still be diagnosed as land in forecast products,
    // while only Eurasia/Taiwan/Hainan/Philippines influence nearshore/post-landfall *speed*.
    const forecastSpeedLandContext = getForecastSpeedSlowdownLandContext(currentLat, currentLon);
    const forecastSpeedLandNow = forecastSpeedLandContext.isLand;
    const forecastCoastDistanceKm = forecastSpeedLandContext.distanceKm;
    let forecastHeadingDeg = Math.atan2(u_agg, v_agg) * 180 / Math.PI;
    if (forecastHeadingDeg < 0) forecastHeadingDeg += 360;
    const westToNorthwest = forecastHeadingDeg >= 235 && forecastHeadingDeg <= 330;
    const northToNortheast = forecastHeadingDeg >= 335 || forecastHeadingDeg <= 70;
    const farOceanRecurving = isFarOcean && hasRecurved && (forecastHeadingDeg >= 285 || forecastHeadingDeg <= 100);
    const postLandResidual = (forecastSpeedLandHours >= 2 || forecastSpeedWasLand || forecastSpeedRecentLandExposureHours >= 3) && currentVmax < 24.5;
    const nearShoreOrLandfall = forecastSpeedLandNow || forecastCoastDistanceKm <= 120;
    const nearSea = forecastCoastDistanceKm <= 460;

    let regimeLow = 16.0;
    let regimeHigh = 24.0;
    if (postLandResidual) {
      regimeLow = 26.0; regimeHigh = 38.0;
    } else if (nearShoreOrLandfall) {
      regimeLow = 22.0; regimeHigh = 30.0;
    } else if (nearSea) {
      regimeLow = 16.0; regimeHigh = 24.0;
    } else if (farOceanRecurving) {
      regimeLow = 16.0; regimeHigh = 24.0;
    } else if (northToNortheast) {
      regimeLow = 18.0; regimeHigh = 28.0;
    } else if (isFarOcean && westToNorthwest) {
      regimeLow = 14.0; regimeHigh = 18.0;
    }

    // Westerly entry is a transition rather than an instant speed jump. As the circulation becomes
    // embedded in the jet, the preferred range continuously shifts toward 38–60 km/h.
    const jetGate = inWesterliesZone
      ? smoothstep01((forecastWesterlyRegimeDepth - 0.14) / 0.66)
      : 0;
    if (jetGate > 0) {
      regimeLow = regimeLow + (38.0 - regimeLow) * jetGate;
      regimeHigh = regimeHigh + (60.0 - regimeHigh) * jetGate;
    }

    // Round 120/121 translation calibration: ordinary open-ocean guidance is 4 km/h slower than the
    // previous envelope; near shore and target-land post-landfall guidance is 5 km/h slower. Only
    // the Eurasian mainland, Taiwan, Hainan and Philippines can supply that target-land context. Blend
    // the extra 1 km/h continuously from 460 km to 120 km offshore so there is no speed cliff.
    // The very-slow far-ocean W/WNW regime (whose old ceiling was <=18 km/h) is deliberately
    // exempt: subtracting another 4 km/h there would over-stall weak-steering genesis systems.
    const extremeFarOceanSlowRegime = isFarOcean && westToNorthwest && !nearSea && !postLandResidual && jetGate < 0.15;
    const coastSlowBlend = (forecastSpeedLandNow || postLandResidual)
      ? 1
      : 1 - smoothstep01((forecastCoastDistanceKm - 120) / Math.max(1, 460 - 120));
    const regionalSlowdownKmh = extremeFarOceanSlowRegime ? 0 : 4 + coastSlowBlend;
    regimeLow = Math.max(4, regimeLow - regionalSlowdownKmh);
    regimeHigh = Math.max(regimeLow + 2, regimeHigh - regionalSlowdownKmh);

    if (!hasManualForecastFramework && speedKmh > 0) {
      const phase = forecastEnvironmentBaseHour + h;
      const texture = clamp01(
        0.50 +
        0.24 * Math.sin(phase * 0.22 + currentLat * 0.17 + currentLon * 0.035) +
        0.11 * Math.sin(phase * 0.071 + currentLon * 0.083)
      );
      const desiredSpeed = regimeLow + (regimeHigh - regimeLow) * (0.18 + 0.68 * texture);
      const response = 0.28 + 0.22 * jetGate + (nearShoreOrLandfall ? 0.08 : 0);
      let adjustedSpeed = speedKmh + (desiredSpeed - speedKmh) * response;
      // Keep extreme numerical steering spikes outside the operational envelope while preserving
      // a gradual approach to the lower bound in weak-steering situations.
      if (adjustedSpeed > regimeHigh) adjustedSpeed = regimeHigh + (adjustedSpeed - regimeHigh) * 0.10;
      if (adjustedSpeed < regimeLow * 0.78) adjustedSpeed += (regimeLow * 0.90 - adjustedSpeed) * 0.55;
      const absoluteCap = jetGate > 0.15 ? 60.0 : Math.max(regimeHigh + 2.0, 30.0);
      adjustedSpeed = Math.max(0.05, Math.min(absoluteCap, adjustedSpeed));
      const scale = adjustedSpeed / Math.max(0.1, speedKmh);
      u_agg *= scale; v_agg *= scale; speedKmh = adjustedSpeed;
    } else if (hasManualForecastFramework && speedKmh > 0) {
      // Hand-drawn geometry keeps its waypoint-tempo signal, but the regional speed calibration
      // still applies to the clock used by the intensity editor and forecast products. Preserve
      // deliberate near-stalls by fading the subtraction below about 8 km/h.
      const slowdownGate = smoothstep01((speedKmh - 3.5) / 9.0);
      const calibratedSpeed = Math.max(0.4, Math.min(60, speedKmh - regionalSlowdownKmh * slowdownGate));
      // Ordinary hand-drawn turns should not turn a weak/sometimes opposed
      // steering vector into an unrequested near-stationary forecast. Deliberate
      // repeated-position dwell clusters are exempt from this non-stall floor.
      const adjustedSpeed = manualRouteTempoFactor < 0.90
        ? calibratedSpeed
        : Math.max(Math.max(5.5, regimeLow * 0.72), calibratedSpeed);
      const scale = adjustedSpeed / Math.max(0.1, speedKmh);
      u_agg *= scale; v_agg *= scale; speedKmh = adjustedSpeed;
    } else if (speedKmh > 60.0) {
      const scale = 60.0 / speedKmh;
      u_agg *= scale; v_agg *= scale; speedKmh = 60.0;
    }
    if (!hasManualForecastFramework) {
      const previousMag = Math.hypot(previousForecastU, previousForecastV);
      const currentMag = Math.hypot(u_agg, v_agg);
      if (previousMag > 0.45 && currentMag > 0.45) {
        const previousHeading = Math.atan2(previousForecastU, previousForecastV);
        const currentHeading = Math.atan2(u_agg, v_agg);
        let headingDelta = currentHeading - previousHeading;
        while (headingDelta > Math.PI) headingDelta -= 2 * Math.PI;
        while (headingDelta < -Math.PI) headingDelta += 2 * Math.PI;

        // Limit *curvature radius*, not merely an arbitrary angle. A fixed 18-28 deg/hour cap still
        // permits a 20 km/h storm to draw a 40-60 km radius circle. The TC-scale synoptic track now
        // uses a ~180-300 km minimum tropical curvature radius (smaller during westerly capture),
        // with a short analysis spin-up allowance so the forecast can adjust from the observed
        // motion vector without a hard kink. This suppresses repeated tiny loops while preserving
        // broad recurvature and genuine weak-steering bends.
        const speedForCurvature = Math.max(3.5, speedKmh);
        // Both environment solvers need a TC-scale curvature floor when no hand-drawn framework is
        // active. Previously the guard only ran in the retired/new-environment branch, so a stale
        // empty framework flag or pure legacy forecast could make broad circular hooks that then
        // contaminated every ensemble centre. Keep the legacy guard slightly looser than the newer
        // synoptic solver so genuine recurvature is preserved.
        const baseRadiusKm = config.newEnvironmentPhysicsEnabled ? 180 : 150;
        const radiusGrowthKm = config.newEnvironmentPhysicsEnabled ? 120 : 95;
        const tropicalRadiusKm = baseRadiusKm + radiusGrowthKm * clamp01((speedKmh - 10) / 24);
        const minCurvatureRadiusKm = inWesterliesZone ? Math.max(110, tropicalRadiusKm * 0.68) : tropicalRadiusKm;
        const geometricTurnDeg = (speedForCurvature * stepSizeHours / minCurvatureRadiusKm) * 180 / Math.PI;
        const spinupAllowanceDeg = h <= 8 ? 7.0 * (1 - h / 9) : 0;
        const capDeg = config.newEnvironmentPhysicsEnabled ? (inWesterliesZone ? 15 : 10) : (inWesterliesZone ? 18 : 13);
        const maxTurnDeg = Math.min(capDeg, Math.max(2.2, geometricTurnDeg + spinupAllowanceDeg));
        const maxTurnRad = maxTurnDeg * Math.PI / 180;
        if (Math.abs(headingDelta) > maxTurnRad) {
          const limitedHeading = previousHeading + Math.sign(headingDelta) * maxTurnRad;
          u_agg = Math.sin(limitedHeading) * currentMag;
          v_agg = Math.cos(limitedHeading) * currentMag;
        }
      }
    }
    previousForecastU = u_agg;
    previousForecastV = v_agg;
    speedKmh = Math.hypot(u_agg, v_agg) * 3.6;
    
    // Convert m/s velocity to coordinates changes (degrees/hour)
    const latSpeedDegHour = (v_agg * 3600.0) / 111111.0;
    const lonSpeedDegHour = (u_agg * 3600.0) / (111111.0 * Math.cos((currentLat * Math.PI) / 180));
    
    currentLat += latSpeedDegHour * stepSizeHours;
    currentLon += lonSpeedDegHour * stepSizeHours;
    
    // Expanded forecast domain; do not let the old coastline-plate edge act like a wall.
    currentLat = Math.max(-20, Math.min(88, currentLat));
    currentLon = Math.max(65, Math.min(220, currentLon));

    const archivedPoint = geometryAtLead(h);
    if (archivedPoint) {
      currentLat = Math.max(-20, Math.min(88, Number(archivedPoint.lat)));
      currentLon = Math.max(65, Math.min(220, Number(archivedPoint.lon)));
    }

    // Diagnose translation from the actual geodesic displacement of this forecast integration
    // step, then lightly blend it with the steering-vector magnitude. This makes speed robust at
    // high latitude, through manual-framework turns and after boundary corrections, while avoiding
    // one-step numerical spikes. The stored forecast speed is therefore a track-consistent value.
    const realizedForecastSpeedKmh = greatCircleDistanceKm(previousForecastLat, previousForecastLon, currentLat, currentLon) / Math.max(1e-6, stepSizeHours);
    speedKmh = Math.round((0.72 * realizedForecastSpeedKmh + 0.28 * speedKmh) * 10) / 10;

    if (pathOnly) {
      // Live simulation keeps only forecast geometry. Do not sample SST/OHC/RH/shear, do not run
      // land-intensity decay, RI/ET/EWRC, pressure or target-intensity logic here. A tiny land-state
      // memory is maintained only because it affects subsequent translation-speed calibration.
      if (forecastSpeedLandNow) {
        forecastSpeedLandHours = Math.min(120, forecastSpeedLandHours + stepSizeHours);
        forecastSpeedRecentLandExposureHours = Math.min(96, forecastSpeedRecentLandExposureHours + stepSizeHours);
        forecastSpeedWasLand = true;
      } else {
        forecastSpeedLandHours = 0;
        forecastSpeedRecentLandExposureHours = Math.max(0, forecastSpeedRecentLandExposureHours - 0.18 * stepSizeHours);
        forecastSpeedWasLand = false;
      }
      if (h % 3 === 0 || h === targetHours) {
        // Product land semantics remain distinct from the Round-121 translation-speed whitelist,
        // but geometry-only guidance needs only the boolean.  Skip the deprecated distance fan-out.
        const forecastLandNow = getForecastMeaningfulLandContext(currentLat, currentLon, config?.coastlineSource, false).isLand;
        forecast.push({
          lat: currentLat,
          lon: currentLon,
          vmax: Number.NaN,
          pmin: Number.NaN,
          simHour: h,
          category: initialCategory,
          speed: speedKmh,
          intensityDeferred: true,
          previewOnly: stepSizeHours > 1 ? true : undefined,
          landed: forecastLandNow
        });
      }
      continue;
    }

    // The full-physics branch maintains the same speed-only land memory independently from the
    // physical terrain memory below. This prevents a tiny island crossing from slowing subsequent
    // track guidance while retaining its real intensity/structure effects.
    if (forecastSpeedLandNow) {
      forecastSpeedLandHours = Math.min(120, forecastSpeedLandHours + stepSizeHours);
      forecastSpeedRecentLandExposureHours = Math.min(96, forecastSpeedRecentLandExposureHours + stepSizeHours);
      forecastSpeedWasLand = true;
    } else {
      forecastSpeedLandHours = 0;
      forecastSpeedRecentLandExposureHours = Math.max(0, forecastSpeedRecentLandExposureHours - 0.18 * stepSizeHours);
      forecastSpeedWasLand = false;
    }
    
    // Full physics intensity engine evaluation along forecast path
    const metrics = getLandMetrics(currentLat, currentLon, config?.coastlineSource, preciseLandIntensity ? false : fastMode);
    let sstVal = getSST(currentLat, currentLon, config, forecastEnvironmentBaseHour + h);
    if (playgroundMode) sstVal += 5.0;
    
    let coldWaterDecay = 0.0;
    const forecastAvgRadius = (quad?: { ne:number; se:number; sw:number; nw:number }) => {
      const vals = quad ? [quad.ne, quad.se, quad.sw, quad.nw].filter((v) => Number.isFinite(v) && v > 0) : [];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const forecastR10 = forecastAvgRadius(typhoon.r10 as any);
    const forecastR12 = forecastAvgRadius(typhoon.r12 as any);
    const forecastR7 = forecastAvgRadius(typhoon.r7 as any);
    const forecastOhcPre = getOHC(currentLat, currentLon, config, undefined, forecastEnvironmentBaseHour + h);
    const forecastSlowFactor = clamp01((18.0 - speedKmh) / 18.0);
    const forecastWindMix = clamp01((currentVmax - 18.0) / 38.0);
    const forecastExtremeMix = clamp01((currentVmax - 42.0) / 22.0);
    const forecastInnerFootprint = Math.max(Number(typhoon.rmw || 18) * 1.2, forecastR12 || forecastR10 || (forecastR7 * 0.46));
    const forecastTranslationResidence = 0.06 + 0.94 * (1 - smoothstep01((speedKmh - 5.0) / 20.0));
    const forecastDeepOhcProtection = clamp01((forecastOhcPre - 25.0) / 80.0);
    const forecastStirring = forecastTranslationResidence * (0.42 + 0.70 * forecastWindMix + 0.30 * forecastExtremeMix) * Math.max(0.70, Math.min(1.50, 0.70 + forecastInnerFootprint / 105.0));
    const isSlowForecast = !metrics.isLand && currentVmax >= 24.0 &&
      (speedKmh < 18.5 || (currentVmax >= 55.0 && speedKmh < 21.5)) && forecastStirring >= 0.20;
    let forecastUpwellingCooling = 0.0;
    if (isSlowForecast) {
      const forecastResidenceAccumulation = forecastTranslationResidence * Math.max(0.15, Math.min(1.8, 0.35 + 0.75 * forecastStirring));
      forecastUpwellingHours += stepSizeHours * forecastResidenceAccumulation;
      forecastConsecutiveUpwellingHours += stepSizeHours * forecastTranslationResidence;
      const slownessFactor = Math.pow(clamp01((16.0 - speedKmh) / 16.0), 0.82);
      const upwellingFactor = 1.0 + 0.30 * (forecastR10 > 0 ? 1 : 0) + 0.22 * (forecastR12 > 0 ? 1 : 0);
      const intensityFactorForWake = Math.pow(Math.max(1.0, currentVmax / 24.0), 1.25);
      const nonLinearTime = Math.pow(forecastUpwellingHours + 0.7, 1.08);
      const churningFactor = (0.48 + 0.38 * slownessFactor + 0.44 * forecastWindMix + 0.30 * forecastExtremeMix) * upwellingFactor;
      const ohcCoolingEfficiency = 1.0 - 0.74 * forecastDeepOhcProtection;
      const upwellingCoolingRate = 0.032 * intensityFactorForWake * churningFactor * config.airSeaCoupling * forecastTranslationResidence * ohcCoolingEfficiency;
      const forecastMaxCooling = 0.55 + 2.40 * forecastTranslationResidence * (1.0 - 0.58 * forecastDeepOhcProtection);
      forecastUpwellingCooling = Math.min(forecastMaxCooling, nonLinearTime * upwellingCoolingRate);
      sstVal = Math.max(16.0, sstVal - forecastUpwellingCooling);
      const decayAccel = 1.0 + 0.30 * Math.pow(forecastUpwellingHours, 0.92);
      coldWaterDecay = forecastUpwellingCooling * 0.020 * decayAccel * (1.0 + 0.20 * slownessFactor + 0.15 * forecastWindMix);
    } else {
      if (forecastConsecutiveUpwellingHours >= 18 && forecastSlowFactor >= 0.45) {
        forecastUpwellingPersistentPenaltyHours = Math.max(forecastUpwellingPersistentPenaltyHours, 30 + randIntensity() * 10);
      }
      forecastUpwellingHours = Math.max(0, forecastUpwellingHours - stepSizeHours * 1.35);
      forecastConsecutiveUpwellingHours = 0;
    }

    if (forecastUpwellingPersistentPenaltyHours > 0) {
      forecastUpwellingPersistentPenaltyHours = Math.max(0, forecastUpwellingPersistentPenaltyHours - stepSizeHours);
    }

    const rawForecastOhcAfterMixing = getOHC(currentLat, currentLon, config, sstVal, forecastEnvironmentBaseHour + h);
    const ohcVal = config.newEnvironmentPhysicsEnabled
      ? rawForecastOhcAfterMixing
      : Math.max(rawForecastOhcAfterMixing, forecastOhcPre * (1.0 - 0.12 * clamp01(forecastUpwellingCooling / 3.0)));
    const backgroundShearVal = getShear(currentLat, currentLon, config, forecastEnvironmentBaseHour + h);
    const forecastManualShearInfluence = getManualShearRegionInfluence(config, currentLat, currentLon);
    let shearVal = Math.max(backgroundShearVal, forecastManualShearInfluence.shearKt);
    if (forecastForcedShear !== undefined) {
      if (forecastShearPenaltyTotalHours === undefined || forecastShearPenaltyHours === undefined) {
        const shearSeverity = clamp01((forecastForcedShear - 16.0) / 22.0);
        const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
        forecastShearPenaltyTotalHours = Math.max(16.0, Math.min(38.0, 16.0 + shearSeverity * 14.0 + intensityLoad * 8.0));
        forecastShearPenaltyHours = forecastShearPenaltyTotalHours;
      }
      const shearPulse = interventionPulse(forecastShearPenaltyHours, forecastShearPenaltyTotalHours);
      const coupling = 0.08 + 0.92 * shearPulse;
      shearVal = backgroundShearVal + (forecastForcedShear - backgroundShearVal) * coupling;
    }

    if (playgroundMode && forecastForcedShear === undefined) shearVal = 0.0;

    const backgroundRhVal = getRH700(currentLat, currentLon, config, forecastEnvironmentBaseHour + h);
    let rhVal = backgroundRhVal;
    if (forecastForcedDryAir) {
      if (forecastDryAirPenaltyTotalHours === undefined || forecastDryAirPenaltyHours === undefined) {
        const isCore = forecastForcedDryAir === "core";
        const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
        const backgroundMoisture = clamp01((backgroundRhVal - 45.0) / 35.0);
        const durationBase = isCore ? 31.0 : 30.0;
        const durationSpread = isCore ? 18.0 : 16.0;
        const total = durationBase + durationSpread * (0.18 + 0.62 * intensityLoad + 0.20 * backgroundMoisture);
        forecastDryAirPenaltyTotalHours = Math.max(isCore ? 32.0 : 28.0, Math.min(isCore ? 52.0 : 48.0, total));
        forecastDryAirPenaltyHours = forecastDryAirPenaltyTotalHours;
      }
      const dryPulse = interventionPulse(forecastDryAirPenaltyHours, forecastDryAirPenaltyTotalHours);
      const targetRh = forecastForcedDryAir === "core" ? 34.0 : 48.0;
      const intrusion = (forecastForcedDryAir === "core" ? 0.08 : 0.05) + dryPulse * (forecastForcedDryAir === "core" ? 0.82 : 0.65);
      rhVal = Math.max(22.0, backgroundRhVal - Math.max(0, backgroundRhVal - targetRh) * intrusion);
    }

    // Carry the user-requested cancellation recovery into the forecast. The environment is not
    // teleported to ideal values: dry air is purged first, then the vortex gradually realigns
    // against shear. If the underlying hostile environment persists, it can act again after the
    // finite recovery window finishes.
    if (forecastPenaltyRecoveryActive) {
      forecastPenaltyRecoveryElapsedHours = Math.min(forecastPenaltyRecoveryTotalHours, forecastPenaltyRecoveryElapsedHours + stepSizeHours);
      const dryPurge = smoothstep01(forecastPenaltyRecoveryElapsedHours / Math.max(2.5, Math.min(7.0, forecastPenaltyRecoveryTotalHours * 0.32)));
      const shearRealign = smoothstep01(Math.max(0, forecastPenaltyRecoveryElapsedHours - 1.5) / Math.max(4.0, Math.min(10.0, forecastPenaltyRecoveryTotalHours * 0.42)));
      if (typhoon.penaltyRecoveryDryAir) rhVal += (Math.max(rhVal, 82.0) - rhVal) * 0.88 * dryPurge;
      if (typhoon.penaltyRecoveryShear && !playgroundMode) shearVal += (Math.min(shearVal, 4.5) - shearVal) * 0.92 * shearRealign;
      if (forecastPenaltyRecoveryElapsedHours >= forecastPenaltyRecoveryTotalHours) forecastPenaltyRecoveryActive = false;
    }

    const forecastRecoveryDryBlend = forecastPenaltyRecoveryActive && typhoon.penaltyRecoveryDryAir
      ? smoothstep01(forecastPenaltyRecoveryElapsedHours / Math.max(2.5, Math.min(7.0, forecastPenaltyRecoveryTotalHours * 0.32)))
      : 0;

    // Preserve landfall -> re-emergence memory in the forecast. The old path reset land hours to
    // zero the instant the centre returned over water and never used forecastWarmWaterHoursAfterSea,
    // so a damaged remnant could not gradually reorganize offshore. Keep a slowly decaying memory
    // of the recent land crossing and require several hours of oceanic support before recovery.
    if (metrics.isLand) {
      forecastRecentLandExposureHours = Math.min(96, forecastRecentLandExposureHours + stepSizeHours);
      forecastWarmWaterHoursAfterSea = 0;
    } else {
      const warmSeaSupport = clamp01(
        0.38 * clamp01((sstVal - 26.0) / 3.0) +
        0.24 * clamp01(ohcVal / 110.0) +
        0.20 * clamp01((rhVal - 48.0) / 34.0) +
        0.18 * clamp01((22.0 - shearVal) / 16.0)
      );
      if (forecastWasLand || forecastRecentLandExposureHours > 0.5) {
        if (warmSeaSupport > 0.28) forecastWarmWaterHoursAfterSea = Math.min(72, forecastWarmWaterHoursAfterSea + stepSizeHours * (0.72 + 0.55 * warmSeaSupport));
        else forecastWarmWaterHoursAfterSea = Math.max(0, forecastWarmWaterHoursAfterSea - 0.35 * stepSizeHours);
        forecastRecentLandExposureHours = Math.max(0, forecastRecentLandExposureHours - stepSizeHours * (0.08 + 0.10 * warmSeaSupport));
      } else {
        forecastWarmWaterHoursAfterSea = Math.max(0, forecastWarmWaterHoursAfterSea - 0.25 * stepSizeHours);
      }
    }
    forecastWasLand = metrics.isLand;

    // 3.3.14 forecast mirror of the live dry-air ventilation lifecycle.  Dry environmental air
    // is not allowed to "teleport" into the eye.  It must first be imported by storm-relative
    // ventilation, maintain a connected dry tongue through the moist envelope, then erode a
    // sector of the eyewall.  Conversely, a warm-ocean cyclone can recover only by isolating
    // that tongue and recharging the boundary layer with surface enthalpy fluxes.
    const forecastDryEnvironment = clamp01(Math.max(
      forecastForcedDryAir === "core" ? 1.0 : forecastForcedDryAir === "periphery" ? 0.62 : 0,
      0.55 * clamp01((60.0 - rhVal) / 30.0) +
      0.34 * clamp01((shearVal - 11.0) / 23.0) +
      0.11 * (metrics.isLand ? clamp01(0.25 + forecastLandHours / 14.0) : 0)
    ));
    const forecastCoreVentilation = clamp01(
      0.60 * clamp01((shearVal - 8.0) / 21.0) + 0.40 * clamp01((58.0 - rhVal) / 29.0)
    );
    const forecastThermodynamicRecharge = clamp01(
      0.34 * clamp01((sstVal - 25.5) / 4.0) +
      0.24 * clamp01(ohcVal / 120.0) +
      0.24 * forecastMoistureReservoir +
      0.18 * clamp01((rhVal - 44.0) / 42.0)
    );
    const forecastVentilationTarget = clamp01(
      (0.12 + 0.88 * clamp01((shearVal - 5.0) / 25.0)) *
      clamp01((64.0 - rhVal) / 36.0) *
      (1.16 - 0.42 * forecastThermodynamicRecharge)
    );
    forecastDryAirVentilationIndex += (forecastVentilationTarget - forecastDryAirVentilationIndex) *
      (1 - Math.exp(-stepSizeHours / (forecastVentilationTarget > forecastDryAirVentilationIndex ? 3.8 : 11.5)));
    forecastDryAirVentilationIndex = clamp01(forecastDryAirVentilationIndex);

    const forecastApproxR7 = Math.max(80, currentVmax * 5.8 + 30);
    const forecastSizeMemoryGate = clamp01((forecastApproxR7 - 180) / 300);
    const forecastDryWrapTarget = clamp01(
      forecastDryEnvironment *
      (0.28 + 0.42 * forecastCoreVentilation + 0.18 * forecastDryAirVentilationIndex + 0.12 * forecastSizeMemoryGate)
    );
    forecastDryAirWrapFraction += (forecastDryWrapTarget - forecastDryAirWrapFraction) *
      (1 - Math.exp(-stepSizeHours / (forecastDryWrapTarget > forecastDryAirWrapFraction ? 6.5 : 19.0)));
    forecastDryAirWrapFraction = clamp01(forecastDryAirWrapFraction);

    let forecastEnvelopeTarget = clamp01(
      0.12 + 0.34 * forecastMoistureReservoir + 0.17 * forecastSizeMemoryGate +
      0.14 * clamp01((rhVal - 48) / 38) -
      0.32 * forecastDryAirWrapFraction * forecastCoreVentilation -
      0.16 * forecastDryAirVentilationIndex -
      0.10 * clamp01((shearVal - 18) / 18)
    );
    if (metrics.isLand) forecastEnvelopeTarget *= clamp01(0.998 - 0.0014 * Math.min(96, forecastLandHours));
    forecastMoistEnvelopeIntegrity += (forecastEnvelopeTarget - forecastMoistEnvelopeIntegrity) *
      (1 - Math.exp(-stepSizeHours / (forecastEnvelopeTarget < forecastMoistEnvelopeIntegrity
        ? (metrics.isLand ? 36.5 : 9.0)
        : 17.0)));
    forecastMoistEnvelopeIntegrity = clamp01(forecastMoistEnvelopeIntegrity);

    const forecastBreachGate = smoothstep01(clamp01((forecastDryAirWrapFraction - 0.24) / 0.60)) *
      smoothstep01(clamp01((0.72 - forecastMoistEnvelopeIntegrity) / 0.58));
    let forecastConnectionTarget = clamp01(
      forecastDryAirWrapFraction *
      (0.14 + 0.86 * forecastDryAirVentilationIndex) *
      (0.18 + 0.82 * forecastBreachGate)
    );
    if (metrics.isLand) {
      forecastConnectionTarget = Math.max(
        forecastConnectionTarget,
        clamp01(0.10 + 0.30 * Math.min(1, forecastLandHours / 20) + 0.18 * (1 - forecastMoistureReservoir))
      );
    }
    if (forecastForcedDryAir === "core") forecastConnectionTarget = Math.max(forecastConnectionTarget, 0.94);
    if (forecastForcedDryAir === "periphery") forecastConnectionTarget = Math.max(forecastConnectionTarget, 0.46);
    forecastDryAirCoreConnection += (forecastConnectionTarget - forecastDryAirCoreConnection) *
      (1 - Math.exp(-stepSizeHours / (forecastConnectionTarget > forecastDryAirCoreConnection ? 3.6 : 8.5)));
    forecastDryAirCoreConnection = clamp01(forecastDryAirCoreConnection);

    const forecastOceanRecoveryGate = metrics.isLand ? 0 : clamp01(
      0.30 * clamp01((sstVal - 26.0) / 3.6) +
      0.24 * clamp01(ohcVal / 105.0) +
      0.22 * forecastMoistureReservoir +
      0.14 * forecastInnerCoreMoisture +
      0.10 * forecastDeepConvectiveCoverage
    );
    let forecastReMoisteningTarget = clamp01(
      forecastOceanRecoveryGate *
      (1.0 - 0.82 * forecastDryAirCoreConnection) *
      (0.30 + 0.70 * clamp01((rhVal - 44.0) / 36.0)) *
      (0.38 + 0.62 * clamp01((22.0 - shearVal) / 16.0))
    );
    if (forecastDryAirVentilationIndex > 0.72) forecastReMoisteningTarget *= 0.62;
    if (forecastForcedDryAir) forecastReMoisteningTarget *= 0.18;
    forecastDryAirReMoistening += (forecastReMoisteningTarget - forecastDryAirReMoistening) *
      (1 - Math.exp(-stepSizeHours / (forecastReMoisteningTarget > forecastDryAirReMoistening ? 3.2 : 5.5)));
    forecastDryAirReMoistening = clamp01(forecastDryAirReMoistening);

    let forecastCoreDryTarget = clamp01(
      forecastDryEnvironment *
      (0.06 + 0.60 * forecastCoreVentilation + 0.30 * forecastDryAirVentilationIndex) *
      (0.10 + 0.66 * forecastBreachGate + 0.24 * forecastDryAirCoreConnection) *
      (1 - 0.44 * forecastInnerCoreMoisture) -
      0.46 * forecastDryAirReMoistening * (1 - 0.70 * forecastDryAirCoreConnection)
    );
    if (forecastForcedDryAir === "core") forecastCoreDryTarget = Math.max(forecastCoreDryTarget, 0.90);
    if (forecastForcedDryAir === "periphery") forecastCoreDryTarget = Math.min(forecastCoreDryTarget, 0.32);
    if (forecastDryAirWrapFraction > 0.72 && forecastDryAirVentilationIndex > 0.58 && forecastMoistEnvelopeIntegrity < 0.40) {
      forecastCoreDryTarget = Math.max(forecastCoreDryTarget, 0.46 + 0.32 * forecastDryAirVentilationIndex);
    }
    const forecastCoreDryTau = forecastCoreDryTarget > forecastDryAirCoreExposure
      ? 5.2
      : Math.max(6.5, 13.5 - 6.0 * forecastDryAirReMoistening);
    forecastDryAirCoreExposure += (forecastCoreDryTarget - forecastDryAirCoreExposure) *
      (1 - Math.exp(-stepSizeHours / forecastCoreDryTau));
    forecastDryAirCoreExposure = clamp01(forecastDryAirCoreExposure);

    const forecastInnerMoistTarget = clamp01(
      forecastMoistureReservoir *
      (0.28 + 0.46 * forecastMoistEnvelopeIntegrity + 0.18 * (1 - forecastDryAirCoreExposure) +
        0.22 * forecastDryAirReMoistening * (1 - 0.64 * forecastDryAirCoreConnection)) *
      (1 - 0.72 * forecastDryAirCoreExposure) *
      (metrics.isLand ? clamp01(0.998 - 0.0023 * Math.min(84, forecastLandHours)) : 1)
    );
    forecastInnerCoreMoisture += (forecastInnerMoistTarget - forecastInnerCoreMoisture) *
      (1 - Math.exp(-stepSizeHours / (forecastInnerMoistTarget < forecastInnerCoreMoisture
        ? (metrics.isLand ? 28.0 : 6.8)
        : Math.max(6.2, 13.5 - 5.0 * forecastDryAirReMoistening))));
    forecastInnerCoreMoisture = clamp01(forecastInnerCoreMoisture);

    const forecastOpenSectorTarget = clamp01(
      0.02 + 0.56 * forecastDryAirCoreExposure +
      0.18 * forecastDryAirCoreConnection +
      0.14 * forecastDryAirWrapFraction * (1 - forecastMoistEnvelopeIntegrity) +
      0.16 * clamp01((shearVal - 12) / 22) -
      0.18 * forecastInnerCoreMoisture -
      0.24 * forecastDryAirReMoistening * (1 - 0.55 * forecastDryAirCoreConnection)
    );
    forecastEyewallOpenSectorFraction += (forecastOpenSectorTarget - forecastEyewallOpenSectorFraction) *
      (1 - Math.exp(-stepSizeHours / (forecastOpenSectorTarget > forecastEyewallOpenSectorFraction ? 3.6 : 10.5)));
    forecastEyewallOpenSectorFraction = clamp01(forecastEyewallOpenSectorFraction);

    const forecastDeepCoverageTarget = clamp01(
      0.10 + 0.34 * clamp01((currentVmax - 13.9) / 38.0) + 0.28 * forecastInnerCoreMoisture +
      0.06 * forecastDryAirReMoistening -
      0.22 * forecastDryAirCoreExposure -
      0.18 * forecastDryAirCoreConnection -
      0.20 * forecastEyewallOpenSectorFraction -
      0.10 * clamp01((shearVal - 14) / 20)
    );
    forecastDeepConvectiveCoverage += (forecastDeepCoverageTarget - forecastDeepConvectiveCoverage) *
      (1 - Math.exp(-stepSizeHours / (forecastDeepCoverageTarget < forecastDeepConvectiveCoverage ?
        4.0 + 4.5 * forecastInnerCoreMoisture : 7.0)));
    forecastDeepConvectiveCoverage = clamp01(forecastDeepConvectiveCoverage);

    // Peak-envelope memory and low-level-vortex integrity evolve much more slowly than deep
    // convection.  This is what lets a formerly major, broad cyclone sit near strong-TS winds
    // inland for many hours after its eye/CDO have already disintegrated.
    if (currentVmax >= 65.0) forecastExtremeIntensityHours = Math.min(96, forecastExtremeIntensityHours + stepSizeHours);
    else forecastExtremeIntensityHours = Math.max(0, forecastExtremeIntensityHours - 0.35 * stepSizeHours);
    forecastPeakVmaxMemory = Math.max(forecastPeakVmaxMemory, currentVmax);
    const forecastPeakIntensityGate = clamp01((forecastPeakVmaxMemory - 30) / 32);
    const forecastNearPeak = clamp01(currentVmax / Math.max(1, forecastPeakVmaxMemory));
    const forecastEnvelopeMemoryTarget = clamp01(
      0.10 + 0.40 * forecastPeakIntensityGate + 0.28 * forecastSizeMemoryGate +
      0.12 * clamp01((rhVal - 50) / 35)
    );
    const envelopeMemoryTau = !metrics.isLand && forecastNearPeak >= 0.72
      ? 8.0
      : 52.0 + 28.0 * forecastSizeMemoryGate;
    const forecastResidualEnvelopeTarget = !metrics.isLand && forecastNearPeak >= 0.72
      ? forecastEnvelopeMemoryTarget
      : clamp01(0.10 + 0.32 * forecastSizeMemoryGate + 0.10 * forecastMoistureReservoir);
    forecastPostPeakEnvelopeMemory += (forecastResidualEnvelopeTarget - forecastPostPeakEnvelopeMemory) *
      (1 - Math.exp(-stepSizeHours / envelopeMemoryTau));
    forecastPostPeakEnvelopeMemory = clamp01(forecastPostPeakEnvelopeMemory);

    const forecastTerrainStress = metrics.isLand ? clamp01(Math.max(0, metrics.elevation - 350) / 1650) : 0;
    const forecastLowLevelTarget = clamp01(
      0.12 + 0.22 * clamp01((currentVmax - 10) / 24) + 0.26 * forecastSizeMemoryGate +
      0.22 * forecastPostPeakEnvelopeMemory + 0.10 * forecastMoistureReservoir -
      0.22 * forecastTerrainStress - 0.05 * forecastExtrTransition
    );
    const forecastLowLevelTau = forecastLowLevelTarget < forecastLowLevelVortexIntegrity
      ? 34.0 + 34.0 * forecastSizeMemoryGate
      : 10.0;
    forecastLowLevelVortexIntegrity += (forecastLowLevelTarget - forecastLowLevelVortexIntegrity) *
      (1 - Math.exp(-stepSizeHours / forecastLowLevelTau));
    forecastLowLevelVortexIntegrity = clamp01(forecastLowLevelVortexIntegrity);

    const forecastEnvironmentalDryAir = effectiveDryAirStrength(currentLat, currentLon, config, forecastEnvironmentBaseHour + h, rhVal);
    const forecastAtmosphericStress = getAtmosphericStress(
      currentVmax, sstVal, ohcVal, rhVal, shearVal, speedKmh, forecastEnvironmentalDryAir * (1.0 - 0.95 * forecastRecoveryDryBlend)
    );

    // Environmental Rating & MPI calculation
    let sstScore = sstVal >= 26.5 ? Math.max(-1.0, Math.min(1.0, (sstVal - 26.5) / 2.0)) : Math.max(-1.5, (sstVal - 26.5) / 1.5);
    const ohcScore = Math.max(0.0, Math.min(1.0, ohcVal / 100.0));
    const rhScore = Math.max(-1.0, Math.min(1.0, (rhVal - 50.0) / 35.0));
    let shearPenalty = Math.max(0.0, Math.min(1.0, (shearVal - 9.0) / 18.0));

    // Low Peak Intensity Limit Factor & Adverse Climate Multiplier (Requirement 3)
    const configuredPeakLimit = forecastPeakReference ?? (isAnyIntensityReferenceActive(config) ? Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70) : 95);
    let lowPeakFactor = 1.0;
    let adverseClimateMultiplier = 1.0;
    if ((forecastPeakReference !== null || isAnyIntensityReferenceActive(config)) && configuredPeakLimit < 70) {
      lowPeakFactor = Math.max(0.25, configuredPeakLimit / 70.0);
      adverseClimateMultiplier = 1.0 / lowPeakFactor;
    }

    shearPenalty *= adverseClimateMultiplier;

    let outflowScore = 0.35;
    if (currentLat > 12 && currentLat < 28) outflowScore += 0.25;
    outflowScore *= config.outflowScale;

    let favScore = (0.35 * sstScore) + (0.18 * ohcScore) + (0.17 * rhScore) + (0.12 * outflowScore) - (0.35 * shearPenalty);

    // Compute MPI
    const sstFactorForMPI = Math.max(0, sstVal - 15);
    const baseMPI = 16.0 + 3.6 * Math.pow(sstFactorForMPI, 1.22) * (1.0 + ohcVal / 180.0); // Synchronized
    let shearReduction = Math.max(0, Math.min(0.75, (shearVal - 4.0) / 30.0));
    shearReduction *= (0.60 + 0.40 * forecastAtmosphericStress.intensity) * (1.0 - 0.20 * (1.0 - forecastAtmosphericStress.intensity) * forecastAtmosphericStress.oceanSupport);
    const rhFactor = Math.max(0.50, 1.0 - 0.52 * forecastAtmosphericStress.dryDeficit * (0.30 + 0.50 * forecastAtmosphericStress.intensity));
    const outflowFactor = Math.max(0.65, Math.min(1.35, outflowScore * 2.2));
    let environmentalMPI = playgroundMode
      ? Math.max(baseMPI * (1.0 - shearReduction) * rhFactor * outflowFactor, currentVmax + Math.max(80.0, baseMPI * 0.75))
      : Math.min(105.0, baseMPI * (1.0 - shearReduction) * rhFactor * outflowFactor);
    if (!playgroundMode && !metrics.isLand) {
      // Keep forecast thermodynamic potential synchronized with the live engine: warm, deep,
      // weakly ventilated water can support a major typhoon instead of inheriting an artificial
      // ~50–55 m/s ceiling from transient cold-wake/OHC penalties. This raises only potential;
      // forecast winds still need a positive tendency/RI episode to reach it.
      const forecastWarmOceanSupport = clamp01(
        0.54 * clamp01((sstVal - 27.0) / 2.8) +
        0.46 * clamp01((ohcVal - 45.0) / 85.0)
      );
      const forecastCleanAtmosphereSupport = clamp01(
        0.42 * clamp01((16.0 - shearVal) / 11.0) +
        0.34 * clamp01((rhVal - 58.0) / 24.0) +
        0.24 * clamp01((config.outflowScale ?? 1.0) / 1.25)
      );
      const forecastMajorTyphoonSupport = forecastWarmOceanSupport * forecastCleanAtmosphereSupport;
      if (forecastMajorTyphoonSupport > 0.20) {
        environmentalMPI = Math.max(environmentalMPI, 59.0 + 21.0 * forecastMajorTyphoonSupport);
      }
    }
    let forecastAmbitionFactor = 1.0;
    if (forecastHardCapActive && config.maxIntensityLimit && config.maxIntensityLimit > 50) {
      forecastAmbitionFactor = Math.max(1.0, config.maxIntensityLimit / 50.0);
    }
    if (forecastHardCapActive && config.maxIntensityLimit && environmentalMPI < config.maxIntensityLimit) {
      environmentalMPI += (config.maxIntensityLimit - environmentalMPI) * 0.4 * (forecastAmbitionFactor - 1.0);
    }
    if (forecastPeakReference !== null) {
      // Soft forecast aspiration: thermodynamic support decides how strongly the reference can pull
      // MPI. A hostile environment can keep the forecast well below it, while an exceptionally
      // favorable environment may still overshoot. This changes the *forecast process* rather than
      // clipping the final curve to a requested number.
      const oceanSupport = clamp01((sstVal - 25.5) / 4.0) * 0.34 + clamp01(ohcVal / 115) * 0.26;
      const ventilationSupport = (1 - clamp01((shearVal - 10) / 24)) * 0.22 + clamp01((rhVal - 45) / 42) * 0.18;
      const referenceAuthority = 0.20 + 0.34 * clamp01(oceanSupport + ventilationSupport);
      environmentalMPI += (forecastPeakReference - environmentalMPI) * referenceAuthority;
      environmentalMPI = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(110, environmentalMPI));
    }
    if (forecastPeakReference === null && isAutomaticPeakIntensityActive(config)) {
      const forecastDamageSeverity = clamp01(
        (forecastIsStructureDamaged ? 0.52 : 0) +
        (forecastPassedTaiwan ? 0.30 : 0) +
        (forecastPassedLuzon ? 0.16 : 0) +
        0.18 * forecastExtrTransition
      );
      const forecastAutoTarget = diagnoseAutomaticPeakTarget({
        configuredPeak: Math.max(MIN_CYCLONE_INTENSITY_MS, config.maxIntensityLimit ?? 70),
        environmentalMPI,
        vmax: currentVmax,
        sst: sstVal,
        ohc: ohcVal,
        rh: rhVal,
        shear: shearVal,
        outflowEfficiency: clamp01((config.outflowScale ?? 1) / 1.25),
        convectiveSuppression: clamp01(
          0.42 * forecastDryAirCoreExposure +
          0.24 * forecastEyewallOpenSectorFraction +
          0.18 * clamp01((shearVal - 12) / 20)
        ),
        ewrcState,
        ewrcCount: typhoon.ewrcCount ?? 0,
        successfulEwrcCount: forecastSuccessfulEwrcCount,
        circulationExpansion: typhoon.circulationExpansion ?? 0,
        rapidIntensifying: forecastRapidIntensifying,
        coreCompactness: clamp01(typhoon.coreCompactness ?? 0.55),
        damageSeverity: forecastDamageSeverity,
        extremeIntensityHours: forecastExtremeIntensityHours
      });
      environmentalMPI = Math.min(environmentalMPI, forecastAutoTarget);
    }

    let structuralDamagePenaltyFactor = forecastIsStructureDamaged
      ? (forecastPassedTaiwan ? 0.05 : (forecastPassedLuzon ? 0.28 : 0.35))
      : 1.0;
    let vmaxDeltaPerHour = 0;

    if (currentVmax < environmentalMPI) {
      // Keep forecast intensity response synchronized with the live engine.  The user
      // slider scales the thermodynamic growth tendency itself (0% truly means no
      // positive development) instead of adding a fixed baseline growth rate.
      const rate = Math.max(0, Math.min(2.0, config.intensificationRate ?? 1.0));
      const rateResponse = Math.pow(rate, 0.88);
      const g_v = 1.5 / (1.0 + Math.pow(currentVmax / 50.0, 1.2));
      const baseCoeff = 0.56 * rateResponse;
      const growthRoom = environmentalMPI - currentVmax;
      const envFavorability = Math.max(0.05, favScore + 0.5);
      vmaxDeltaPerHour = baseCoeff * envFavorability * Math.sqrt(growthRoom) * g_v;
      vmaxDeltaPerHour *= 0.62 * lowPeakFactor;

      const favorableBoost = Math.max(0, Math.min(1,
        (sstVal - 27.0) / 2.5 * 0.35 +
        (12.0 - shearVal) / 12.0 * 0.30 +
        (rhVal - 55.0) / 30.0 * 0.20 +
        Math.min(1, ohcVal / 110.0) * 0.15
      ));
      const maxAllowedIntensificationRate = (0.82 + 0.40 * favorableBoost) * rateResponse;
      vmaxDeltaPerHour = Math.min(maxAllowedIntensificationRate, vmaxDeltaPerHour);

      if (forecastPeakReference !== null) {
        // The peak reference also changes organization tempo. Far below the aspiration, otherwise
        // favorable storms can organize somewhat faster; near/above it the pull fades smoothly.
        // The multiplier is intentionally bounded so RI/EWRC/dry-air physics remain decisive.
        const peakGap = forecastPeakReference - currentVmax;
        const positivePull = smoothstep01(clamp01(peakGap / 34));
        const overTarget = smoothstep01(clamp01((-peakGap) / 22));
        vmaxDeltaPerHour *= (1 + 0.28 * positivePull) * (1 - 0.34 * overTarget);
      }

      // Non-linear deceleration as typhoon approaches user-configured maximum intensity limit
      if (forecastHardCapActive && currentVmax < maxLimit) {
        const growthToLimit = maxLimit - currentVmax;
        if (growthToLimit > 0 && growthToLimit < 18.0) {
          const p = Math.max(0.0, growthToLimit / 18.0);
          const limitApproachFactor = 0.25 + 0.75 * Math.pow(Math.sin(p * Math.PI / 2), 0.85);
          vmaxDeltaPerHour *= limitApproachFactor;
        }
      }
      
      // Persistent upwelling penalty in forecast (if passed from simulation state)
      if (forecastUpwellingPersistentPenaltyHours > 0) {
        vmaxDeltaPerHour *= 0.7;
      }
      
      vmaxDeltaPerHour *= structuralDamagePenaltyFactor;
    } else {
      const excess = currentVmax - environmentalMPI;
      vmaxDeltaPerHour = Math.max(-3.2, -0.08 * excess - 0.25);
    }

    if (vmaxDeltaPerHour > 0) {
      vmaxDeltaPerHour *= Math.max(0.12, 1.0 - 0.72 * forecastAtmosphericStress.growthSuppression);
      vmaxDeltaPerHour *= forecastAtmosphericStress.motionGrowthFactor;
      if (forecastDryAirCoreExposure > 0.10 || forecastEyewallOpenSectorFraction > 0.16) {
        const forecastRebuildEfficiency = clamp01(
          0.18 + 0.30 * forecastInnerCoreMoisture + 0.18 * forecastDeepConvectiveCoverage +
          0.14 * forecastMoistEnvelopeIntegrity + 0.10 * (1 - forecastEyewallOpenSectorFraction) +
          0.16 * forecastDryAirReMoistening - 0.12 * forecastDryAirCoreConnection
        );
        vmaxDeltaPerHour *= 0.36 + 0.64 * forecastRebuildEfficiency;
      }
    }
    if (forecastAtmosphericStress.ventilationDecay < 0) {
      // The dry component of ventilation is released into Vmax only as the protected core is
      // actually breached. Shear/motion ventilation still acts immediately, so this is a lag
      // mechanism rather than a blanket weakening reduction.
      const dryShare = clamp01(forecastAtmosphericStress.dryDeficit);
      const coreRelease = clamp01(
        0.12 + 0.34 * forecastDryAirCoreExposure + 0.20 * forecastEyewallOpenSectorFraction +
        0.18 * forecastDryAirCoreConnection + 0.10 * forecastDryAirVentilationIndex +
        0.14 * (1 - forecastInnerCoreMoisture) + 0.05 * (1 - forecastDeepConvectiveCoverage) -
        0.10 * forecastDryAirReMoistening
      );
      const ventilationRelease = 1 - 0.62 * dryShare * (1 - coreRelease);
      vmaxDeltaPerHour += forecastAtmosphericStress.ventilationDecay * ventilationRelease;
    }
    const forecastConnectedVentilationBreakdown = clamp01(
      smoothstep01((forecastDryAirCoreConnection - 0.34) / 0.56) *
      (0.38 + 0.62 * forecastDryAirVentilationIndex) *
      (0.36 + 0.64 * clamp01((shearVal - 9.0) / 24.0)) *
      (0.42 + 0.58 * forecastDryAirCoreExposure)
    );
    if (forecastConnectedVentilationBreakdown > 0.04) {
      const forecastDryIntensityLoad = smoothstep01((currentVmax - 20.0) / 45.0);
      vmaxDeltaPerHour -= Math.min(0.58, (0.07 + 0.46 * forecastDryIntensityLoad) * forecastConnectedVentilationBreakdown);
    }

    // 3.3.3 forecast moisture-reservoir/cold-water memory. Cold water first removes the marine
    // recharge; inherited column moisture then drains gradually before convection and Vmax collapse.
    const forecastColdStress = metrics.isLand ? 0 : clamp01(Math.max(
      (26.5 - sstVal) / 3.4,
      coldWaterDecay / 2.4,
      forecastConsecutiveUpwellingHours / 18.0
    ));
    if (forecastColdStress > 0.10) forecastColdWaterExposureHours += stepSizeHours;
    else forecastColdWaterExposureHours = Math.max(0, forecastColdWaterExposureHours - 0.6 * stepSizeHours);
    if (metrics.isLand) {
      // Keep forecast guidance thermodynamically consistent with the live engine. The previous
      // 10 h land e-folding exhausted the forecast moisture column far faster than the analysed
      // storm, making forecast rainfall/structure appear to collapse immediately after landfall.
      const forecastBroadLandMoistureMemory = clamp01(
        0.34 * forecastPostPeakEnvelopeMemory +
        0.30 * clamp01((rhVal - 48.0) / 38.0) +
        0.36 * forecastSizeMemoryGate
      );
      const forecastEnvironmentalLandMoistureSupport = clamp01(
        0.54 * clamp01((rhVal - 48.0) / 38.0) +
        0.24 * forecastPostPeakEnvelopeMemory +
        0.22 * forecastSizeMemoryGate
      );
      const forecastConvectiveConsumption = clamp01((currentVmax - 28.0) / 42.0);
      const forecastLandMoistureTau = Math.max(94.0,
        112.0 + 44.0 * forecastBroadLandMoistureMemory +
        30.0 * forecastEnvironmentalLandMoistureSupport - 3.0 * forecastConvectiveConsumption
      );
      const forecastAdvectedLandReservoirFloor = clamp01(
        0.30 + 0.38 * forecastEnvironmentalLandMoistureSupport +
        0.24 * forecastBroadLandMoistureMemory
      );
      if (forecastMoistureReservoir > forecastAdvectedLandReservoirFloor) {
        forecastMoistureReservoir = forecastAdvectedLandReservoirFloor +
          (forecastMoistureReservoir - forecastAdvectedLandReservoirFloor) *
          Math.exp(-stepSizeHours / forecastLandMoistureTau);
      } else if (forecastEnvironmentalLandMoistureSupport > 0.48) {
        forecastMoistureReservoir += (forecastAdvectedLandReservoirFloor - forecastMoistureReservoir) *
          (1 - Math.exp(-stepSizeHours / 44.0));
      }
    } else if (forecastColdStress > 0.08) {
      const tau = Math.max(44.0, 96.0 - 40.0 * forecastColdStress);
      forecastMoistureReservoir *= Math.exp(-stepSizeHours / tau);
    } else {
      const marineSupply = clamp01(0.42 + 0.38 * clamp01((sstVal - 25.5) / 4.0) +
        0.20 * clamp01((rhVal - 50) / 35));
      forecastMoistureReservoir += (marineSupply - forecastMoistureReservoir) *
        (1 - Math.exp(-stepSizeHours / 10.0));
    }
    forecastMoistureReservoir = clamp01(forecastMoistureReservoir);
    const forecastReserveExhaustion = smoothstep01((0.78 - forecastMoistureReservoir) / 0.62);
    const forecastColdMaturity = smoothstep01((forecastColdWaterExposureHours - 6.0) / 36.0);
    const forecastColdRelease = clamp01(0.010 + 0.10 * forecastColdMaturity + 0.27 * forecastReserveExhaustion);

    // 2. High-intensity typhoons have much higher SST requirements
    const requiredSST = 26.5 + Math.max(0, (currentVmax - 17.2) / 50.8) * 2.5; 
    if (sstVal < requiredSST) {
      let sstDeficit = requiredSST - sstVal;
      if (forecastHardCapActive && sstVal >= 26.5 && coldWaterDecay < 1.5) {
         sstDeficit /= (forecastAmbitionFactor * 1.5);
      }
      const intensityScale = Math.pow(currentVmax / 17.2, 1.5);
      const sstPenalty = 0.24 * sstDeficit * intensityScale;
      vmaxDeltaPerHour -= sstPenalty * forecastColdRelease;

      if (currentVmax > 32.7 && sstVal < requiredSST - 0.5) {
        vmaxDeltaPerHour = Math.min(-0.2 * sstDeficit * (currentVmax / 32.7) * forecastColdRelease, vmaxDeltaPerHour);
      }
    }

    if (isWesterliesActive && (config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.28 : currentLat >= westerliesLat - 3)) {
      // Increase decay progressively as the cyclone becomes embedded in the diagnosed westerly regime.
      const effectiveWestStrength = config.newEnvironmentPhysicsEnabled ? (0.45 + 0.85 * forecastWesterlyRegimeDepth) : (config.westerliesStrength ?? 1.0);
      const westerliesShearPenalty = Math.max(0.5, (currentVmax / 20.0)) * 0.8 * effectiveWestStrength;
      vmaxDeltaPerHour -= westerliesShearPenalty;
      
      // If moving very fast eastward in westerlies, ET transition decay accelerates
      if (speedKmh > 35) {
        vmaxDeltaPerHour -= 0.45;
      }
    }

    if (!metrics.isLand && speedKmh < 12.0) {
      const slownessFactor = (12.0 - speedKmh) / 12.0;
      const strengthFactor = Math.max(1.0, currentVmax / 25.0);
      const immediatePenalty = 0.100 * slownessFactor * strengthFactor * (config.airSeaCoupling ?? 0.5) * 2.0;
      const totalDecay = Math.max(immediatePenalty, coldWaterDecay) * forecastColdRelease;
      if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= Math.max(0.08, 1 - 0.82 * forecastColdStress * forecastColdRelease);
      vmaxDeltaPerHour -= totalDecay;
    }

    if (sstVal <= 26.5) {
      const deficit = Math.max(0.1, 26.5 - sstVal);
      if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= Math.max(0.06, 1 - 0.88 * forecastColdStress * forecastColdRelease);
      vmaxDeltaPerHour -= Math.min(0.82, (0.06 + deficit * 0.18) * forecastColdRelease);
    }

    // Landfall Decay & Proximity Mechanism
    const forecastStandardRadii = getStandardAverageWindRadii(currentVmax);
    const baseR7 = forecastStandardRadii.r7 > 0
      ? forecastStandardRadii.r7 * circulationPreferenceScale(currentVmax, config, 7)
      : 0;
    const distToLandKm = getDistanceToLand(
      currentLat,
      currentLon,
      config?.coastlineSource,
      preciseLandIntensity ? false : fastMode
    ) * 111.12;
    const r7TouchesLand = baseR7 > 0 && distToLandKm < baseR7;

    // Slider target constraint.  When the target is moved below the current
    // intensity, relax toward it over a physically limited response window instead
    // of forcing a constant or near-instantaneous drop.
    if (forecastHardCapActive && currentVmax > maxLimit) {
      forecastRapidIntensifying = false;
      if (forecastForcedDecayTargetVmax !== maxLimit || forecastForcedDecayStartVmax === undefined) {
        forecastForcedDecayStartVmax = currentVmax;
        forecastForcedDecayTargetVmax = maxLimit;
        forecastForcedDecayElapsedHours = 0;

        const decayGap = Math.max(0.5, currentVmax - maxLimit);
        const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
        const intensityFactor = Math.max(0, Math.min(1, (currentVmax - 30.0) / 35.0));
        const favorableResistance = 1.18 - adversity * 0.35;
        let dur = (10.0 + decayGap * 0.72 + intensityFactor * 8.0) * favorableResistance;
        if (metrics.isLand) dur *= 0.66;
        forecastForcedDecayDuration = Math.max(8.0, Math.min(54.0, dur));
        forecastForcedDecayIsContinuous = true;
      }

      forecastForcedDecayElapsedHours += stepSizeHours;
      const dur = forecastForcedDecayDuration || 18.0;
      const progress = Math.max(0, Math.min(1, forecastForcedDecayElapsedHours / dur));
      const startV = forecastForcedDecayStartVmax ?? currentVmax;
      const targetV = forecastForcedDecayTargetVmax ?? maxLimit;
      const remainingFraction = Math.pow(1.0 - progress, 1.58);
      const desiredV = targetV + (startV - targetV) * remainingFraction;
      const trackRate = Math.max(0.04, (currentVmax - desiredV) / Math.max(stepSizeHours, 1 / 6));

      const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
      const intensityFactor = Math.max(0, Math.min(1, (currentVmax - 28.0) / 38.0));
      const physicalCap = metrics.isLand
        ? 2.35
        : Math.min(1.75, 0.62 + adversity * 0.48 + intensityFactor * 0.30);
      vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, -Math.min(trackRate, physicalCap));
    } else {
      forecastForcedDecayStartVmax = undefined;
      forecastForcedDecayTargetVmax = undefined;
      forecastForcedDecayElapsedHours = 0;
      forecastForcedDecayDuration = undefined;
      forecastForcedDecayIsContinuous = false;
      if (vmaxDeltaPerHour > 0) {
        vmaxDeltaPerHour *= Math.min(1.0, Math.max(0, maxLimit - currentVmax) / 15.0);
      }
    }

    // Structural damage penalty check
    if (forecastIsStructureDamaged && !metrics.isLand) {
      const baseGrowthMultiplier = forecastPassedLuzon ? 0.24 : (forecastPassedTaiwan ? 0.05 : 0.25);
      const offshoreRecovery = smoothstep01((forecastWarmWaterHoursAfterSea - 3.0) / 18.0) *
        clamp01(0.42 + 0.58 * forecastLowLevelVortexIntegrity) *
        clamp01(0.55 + 0.45 * forecastMoistureReservoir);
      const growthMultiplier = baseGrowthMultiplier + (0.82 - baseGrowthMultiplier) * offshoreRecovery;
      if (vmaxDeltaPerHour > 0) {
        vmaxDeltaPerHour *= growthMultiplier;
      }
    }

    const r10Radius = forecastStandardRadii.r10 > 0
      ? forecastStandardRadii.r10 * circulationPreferenceScale(currentVmax, config, 10)
      : 0;
    const forecastR10TouchesLand = r10Radius > 0 && distToLandKm < r10Radius;
    if (forecastR10TouchesLand) {
      forecastR10LandContactHours += stepSizeHours;
    } else {
      forecastR10LandContactHours = Math.max(0, forecastR10LandContactHours - stepSizeHours * 2.0);
    }

    if (metrics.isLand || forecastR10TouchesLand || r7TouchesLand) {
      forecastLandContactHours += stepSizeHours;
      
      let coverage = 0;
      let maxElevation = 0;
      const r12Radius = forecastStandardRadii.r12 > 0
        ? forecastStandardRadii.r12 * circulationPreferenceScale(currentVmax, config, 12)
        : Math.max(35, r10Radius * 0.70);
      const useFastLandApproximation = fastMode && !preciseLandIntensity;
      
      if (useFastLandApproximation) {
        if (metrics.isLand) {
          coverage = 1.0;
          maxElevation = metrics.elevation;
        } else {
          const approxDistKm = distToLandKm;
          if (r10Radius > 0 && approxDistKm < r10Radius) {
            coverage = Math.max(0.05, Math.min(0.95, (1.0 - (approxDistKm / r10Radius)) * 0.4));
            maxElevation = 150;
          }
        }
      } else {
        coverage = metrics.isLand
          ? 1.0
          : forecastR10TouchesLand && r10Radius > 0
            ? getLandCoverage(currentLat, currentLon, r10Radius, config?.coastlineSource)
            : r7TouchesLand && baseR7 > 0
              ? getLandCoverage(currentLat, currentLon, baseR7, config?.coastlineSource) * 0.3
              : 0;
        const searchRadius = r7TouchesLand && baseR7 > 0 ? baseR7 : r12Radius;
        const terrainSample = getMaxElevationInRadius(currentLat, currentLon, Math.max(35, searchRadius), config?.coastlineSource);
        maxElevation = terrainSample.maxElevation;
      }

      let intensityFactor = 0.6;
      if (currentVmax > 32.7) {
         intensityFactor = 1.2 + 1.8 * Math.pow((currentVmax - 32.7) / 25.0, 0.9);
      } else if (currentVmax > 17.2) {
         // Speed up weakening for 8-9 level tropical storms over land (17.2 - 24.4 m/s)
         const tFactor = (currentVmax - 17.2) / 15.5;
         if (currentVmax <= 24.5) {
            intensityFactor = 1.0 + 0.65 * tFactor;
         } else {
            intensityFactor = 0.6 + 0.8 * tFactor;
         }
      } else {
         intensityFactor = 1.05 + 0.65 * (1.0 - currentVmax / 17.2);
      }
      const deepInlandFactor = 1.0 + Math.min(1.5, forecastLandHours / 18.0);

      // High-elevation terrain impact (Requirement 4: Reduced multipliers - Synchronized)
      let elevationScale = 11000.0;
      let terrainMulti = 0.09;
      let luzonFactor = 1.0;
      if (currentLat >= 12 && currentLat <= 19 && currentLon >= 119 && currentLon <= 123) {
        elevationScale = 21500.0;
        terrainMulti = 0.055;
        luzonFactor = 1.0;
      }
      if (currentLat >= 18 && currentLat <= 20.5 && currentLon >= 108.5 && currentLon <= 111.5) {
        elevationScale = 48000.0;
        terrainMulti = 0.0035;
      }
      if (currentLat >= 21.5 && currentLat <= 25.5 && currentLon >= 119.5 && currentLon <= 122.5) {
        elevationScale = 5900.0; // Synchronized with active simulation
        terrainMulti = 0.50; // Synchronized with active simulation
        if (currentVmax > 30.0) {
          const taiwanShred = 1.0 + Math.pow((currentVmax - 30.0) / 12.0, 1.2) * 0.30; // Synchronized with active simulation
          terrainMulti *= taiwanShred;
        }
      }

      const durationScale = Math.min(1.0, forecastLandContactHours / 24.0);
      const r10DurationFactor = Math.min(1.2, forecastR10LandContactHours / 16.0);
      const elevationEffectMultiplier = (1.0 + 0.6 * Math.pow(durationScale, 1.25)) * (1.0 + r10DurationFactor * 0.5);
      const adjustedTerrainMulti = terrainMulti * elevationEffectMultiplier;

      const elevationFactor = Math.pow(maxElevation / elevationScale, 0.95);
      const r10FrictionMultiplier = 1.0 + 0.4 * Math.min(1.0, forecastR10LandContactHours / 12.0);
      const inForecastCentralSouthPhilippines = currentLat >= 5.0 && currentLat < 15.0 && currentLon >= 117.0 && currentLon <= 127.5;
      const forecastPhilippineIslandFriction = inForecastCentralSouthPhilippines
        ? (metrics.isLand ? 1.14 : (forecastR10TouchesLand || r7TouchesLand ? 1.06 : 1.0))
        : 1.0;
      const mountainBarrier = clamp01((maxElevation - 250.0) / 1750.0);
      const inForecastTaiwanBarrier = currentLat >= 21.5 && currentLat <= 25.5 && currentLon >= 119.5 && currentLon <= 122.5;
      const inForecastLuzonBarrier = currentLat >= 12 && currentLat <= 19.5 && currentLon >= 119 && currentLon <= 124;
      const barrierStrength = inForecastTaiwanBarrier ? 0.72 : inForecastLuzonBarrier ? 0.27 : 0.24;
      const forecastCoreMountainShock = 1.0 + mountainBarrier * barrierStrength *
        (0.62 + 0.38 * clamp01((currentVmax - 24.0) / 36.0));

      // Product-time forecast state carries terrain damage forward, not just Vmax/pmin. Broad
      // low-land contact accumulates recoverable structural damage; a substantial high-terrain
      // core crossing can leave a hollow-core scar that persists until terrain rebuild is active.
      const forecastDamageForcing = clamp01(0.58 * coverage + 0.42 * mountainBarrier);
      if (forecastDamageForcing > 0.04) {
        forecastStructuralDamageHours = Math.min(120, forecastStructuralDamageHours + stepSizeHours * forecastDamageForcing);
        const establishedForecastCore = currentVmax >= 27 || forecastLowLevelVortexIntegrity >= 0.50;
        if (establishedForecastCore && (forecastStructuralDamageHours >= 3.5 || mountainBarrier >= 0.32)) {
          forecastIsStructureDamaged = true;
        }
        if (establishedForecastCore && maxElevation >= 900 && coverage >= 0.08 && mountainBarrier >= 0.34) {
          const hollowRate = 0.08 + 0.26 * mountainBarrier * clamp01(0.55 + coverage);
          forecastTerrainHollowCoreMemory = clamp01(
            1 - (1 - forecastTerrainHollowCoreMemory) * Math.exp(-hollowRate * stepSizeHours)
          );
          forecastTerrainHollowCoreBearingDeg = (Number(typhoon.direction || 0) + 180) % 360;
          if (forecastTerrainHollowCoreMemory >= 0.12) forecastIsStructureDamaged = true;
        }
        structuralDamagePenaltyFactor = forecastIsStructureDamaged
          ? Math.min(structuralDamagePenaltyFactor, forecastPassedTaiwan ? 0.05 : (forecastPassedLuzon ? 0.28 : Math.max(0.30, 1 - 0.52 * smoothstep01(forecastStructuralDamageHours / 12) - 0.28 * forecastTerrainHollowCoreMemory)))
          : 1.0;
      }
      const baseLandDecay = (0.85 + elevationFactor * adjustedTerrainMulti) * intensityFactor * deepInlandFactor *
        r10FrictionMultiplier * luzonFactor * forecastPhilippineIslandFriction * forecastCoreMountainShock;
      
      let coreSeaCoverage = 1.0;
      if (useFastLandApproximation) {
        coreSeaCoverage = 1.0 - coverage;
      } else {
        coreSeaCoverage = 1.0 - (forecastR10TouchesLand && r10Radius > 0
          ? getLandCoverage(currentLat, currentLon, r10Radius, config?.coastlineSource)
          : 0);
      }
      const seaGainFactor = Math.max(0.4, 1.0 - ((1.0 - coverage) * 0.5 + coreSeaCoverage * 0.35));
      
      let finalLandDecay = baseLandDecay * coverage * seaGainFactor;

      // Moisture reduction supply in forecast (Synchronized with simulation)
      const moistureSupply = Math.max(0.0, Math.min(1.0, (rhVal - 50.0) / 40.0));
      const moistureReduction = 0.25 * moistureSupply;
      finalLandDecay *= (1.0 - moistureReduction);
      let forecastEtSlowdownFactor = 1.0;
      if (isWesterliesActive && (config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.18 : currentLat > (config.westerliesLat ?? 30.0) - 2.0)) {
        const etDepth = config.newEnvironmentPhysicsEnabled
          ? smoothstep01(clamp01(forecastWesterlyRegimeDepth / 0.78))
          : Math.min((currentLat - ((config.westerliesLat ?? 30.0) - 2.0)) / 12.0, 1.0);
        forecastEtSlowdownFactor = Math.max(0.36, 1.0 - (etDepth * 0.42 + 0.18 * forecastExtrTransition));
      }
      finalLandDecay *= forecastEtSlowdownFactor;

      if (metrics.isLand) {
        forecastLandHours += stepSizeHours;
        if (metrics.elevation > forecastMaxLandElevationPassed) {
          forecastMaxLandElevationPassed = metrics.elevation;
          if (metrics.elevation > 1500 && currentLat >= 21.5 && currentLat <= 25.5 && currentLon >= 119.5 && currentLon <= 122.5) {
             forecastPassedTaiwan = true;
          }
          if (metrics.elevation > 700 && currentLat >= 12.0 && currentLat <= 19.5 && currentLon >= 119.0 && currentLon <= 124.0) {
             forecastPassedLuzon = true;
          }
        }
        
        if (config.landDecayEnabled && finalLandDecay > 0) {
          const landfallAdjustmentFactor = Math.max(0.01, 1.0 + (config.landfallDecayAdjustment ?? 0.0));
          const forecastEffectiveLandDecay = finalLandDecay * landfallAdjustmentFactor;
          // Keep the raw land-decay tendency here. The residual tropical-storm soft shelf is
          // applied once, after all land/manual/westerly tendencies, exactly like the live path.
          vmaxDeltaPerHour = -forecastEffectiveLandDecay;
        }
      } else {
        forecastLandHours = 0;
        const proximityAdjustmentFactor = Math.max(0.01, 1.0 + (config.landProximityDecayAdjustment ?? 0.0));
        const effectiveProximityDecay = finalLandDecay * proximityAdjustmentFactor;
        
        if (config.landDecayEnabled) {
          const envDelta = vmaxDeltaPerHour;
          // Scraping detection
          let scrapingMultiplier = 0.75; 
          if (forecastLandContactHours > 3.0) {
              const scrapeIntensity = Math.min(1.0, (forecastLandContactHours - 3.0) / 6.0);
              scrapingMultiplier = 0.75 + 0.65 * scrapeIntensity; // Up to 1.4x effectiveDecay
          }
          const landDelta = -effectiveProximityDecay * scrapingMultiplier;
          vmaxDeltaPerHour = envDelta < 0 ? (Math.min(envDelta, landDelta) + Math.max(envDelta, landDelta) * 0.2) : (envDelta + landDelta);
          vmaxDeltaPerHour = Math.max(-10.5, vmaxDeltaPerHour);
        }
      }
    } else {
      forecastLandHours = 0;
      forecastLandContactHours = Math.max(0, forecastLandContactHours - stepSizeHours * 2.0);
    }

    // Offshore remnant-vortex recovery. A circulation that survives a land crossing should not be
    // treated as a brand-new cyclone, but neither should it remain permanently capped by its old
    // land-damage flag. Once several hours over sufficiently supportive water have elapsed, allow
    // the surviving low-level vortex to rebuild convection gradually. This term is deliberately
    // modest and is strongest for TD/TS remnants with a coherent low-level circulation.
    if (!metrics.isLand && forecastRecentLandExposureHours > 0.5 && forecastWarmWaterHoursAfterSea > 2.0) {
      const oceanRecoverySupport = clamp01(
        0.30 * clamp01((sstVal - 26.0) / 3.2) +
        0.24 * clamp01(ohcVal / 115.0) +
        0.18 * clamp01((rhVal - 50.0) / 32.0) +
        0.16 * clamp01((21.0 - shearVal) / 15.0) +
        0.12 * forecastMoistureReservoir
      );
      const remnantCoherence = clamp01(
        0.50 * forecastLowLevelVortexIntegrity +
        0.26 * forecastPostPeakEnvelopeMemory +
        0.14 * forecastMoistEnvelopeIntegrity +
        0.10 * forecastInnerCoreMoisture
      );
      const recoveryRamp = smoothstep01((forecastWarmWaterHoursAfterSea - 2.0) / 14.0);
      const recentLandMemory = smoothstep01(forecastRecentLandExposureHours / 10.0);
      const weakRemnantGate = 1.0 - 0.55 * smoothstep01((currentVmax - 28.0) / 24.0);
      const offshoreRecoveryRate = (0.035 + 0.36 * oceanRecoverySupport * remnantCoherence) *
        recoveryRamp * recentLandMemory * weakRemnantGate;
      if (oceanRecoverySupport > 0.34 && remnantCoherence > 0.20) {
        vmaxDeltaPerHour = Math.max(vmaxDeltaPerHour, offshoreRecoveryRate);
      }
    }

    // Explicit terrain-rebuild recovery is allowed to erase the persistent hollow-core memory
    // only after the forecast centre has cleared land, matching the live-engine rule.
    if (!metrics.isLand && forecastPenaltyRecoveryActive && typhoon.penaltyRecoveryTerrain && forecastTerrainHollowCoreMemory > 0) {
      const rebuildProgress = smoothstep01(forecastPenaltyRecoveryElapsedHours / Math.max(1, forecastPenaltyRecoveryTotalHours));
      const repairTau = Math.max(3.8, 9.0 - 4.6 * rebuildProgress);
      forecastTerrainHollowCoreMemory *= Math.exp(-stepSizeHours / repairTau);
      if (forecastTerrainHollowCoreMemory < 0.08 && forecastWarmWaterHoursAfterSea >= 4) forecastIsStructureDamaged = false;
      if (!forecastIsStructureDamaged) structuralDamagePenaltyFactor = 1.0;
    }
    if (!metrics.isLand && forecastStructuralDamageHours > 0 && forecastWarmWaterHoursAfterSea > 2) {
      forecastStructuralDamageHours = Math.max(
        0,
        forecastStructuralDamageHours - stepSizeHours * (0.10 + 0.20 * smoothstep01((forecastWarmWaterHoursAfterSea - 2) / 16))
      );
    }

    // Continue active manual dry-air / shear episodes along the forecast path.  The live
    // simulation already feeds their effective RH/shear into MPI above; this additional term
    // represents structural ventilation damage and follows the same smooth episode envelope.
    const manualDryAirSeverity = getManualDryAirRegionSeverity(config, currentLat, currentLon);
    const forecastEwrcDryWindow = ewrcState === "forming" || ewrcState === "max_decay" || ewrcState === "recovering_success" || ewrcState === "recovering_failure" || ewrcState === "penalty_failure";
    const forecastStructureVulnerability = clamp01(
      0.48 * (1 - forecastLowLevelVortexIntegrity) + 0.30 * (1 - forecastMoistEnvelopeIntegrity) + 0.22 * (forecastIsStructureDamaged ? 1 : 0)
    );
    const effectiveManualDry = clamp01(manualDryAirSeverity * (0.94 + 0.74 * forecastStructureVulnerability) * (forecastEwrcDryWindow ? 1.40 : 1.0));
    if (effectiveManualDry > 0.015) {
      const regionIsCore = forecastForcedDryAir === "core" || effectiveManualDry >= (forecastEwrcDryWindow ? 0.30 : Math.max(0.54, 0.78 - 0.20 * forecastStructureVulnerability));
      forecastForcedDryAir = regionIsCore ? "core" : "periphery";
      const pulseHours = regionIsCore ? 6.5 + effectiveManualDry * 9.5 : 4.0 + effectiveManualDry * 6.5;
      const totalHours = regionIsCore ? 26.0 + effectiveManualDry * 24.0 : 14.0 + effectiveManualDry * 15.0;
      forecastDryAirPenaltyHours = Math.max(forecastDryAirPenaltyHours ?? 0, pulseHours);
      forecastDryAirPenaltyTotalHours = Math.max(forecastDryAirPenaltyTotalHours ?? 0, totalHours);
    }
    if (forecastManualShearInfluence.shearKt > 15.1) {
      forecastForcedShear = Math.max(Number(forecastForcedShear || 0), forecastManualShearInfluence.shearKt);
      forecastShearPenaltyHours = Math.max(forecastShearPenaltyHours ?? 0, 5.5 + 8.5 * forecastManualShearInfluence.severity);
      forecastShearPenaltyTotalHours = Math.max(forecastShearPenaltyTotalHours ?? 0, 22 + 22 * forecastManualShearInfluence.severity);
    }
    let forecastManualDecay = 0.0;
    let forecastManualSuppression = false;
    const forecastHasEstablishedCore = currentVmax >= 27.0 && (
      (typhoon.coreCompactness ?? 0) >= 0.46 ||
      (typhoon.eyewallIntegrity ?? 0) >= 0.40 ||
      ["tightening_core", "mature_eyewall", "ewrc_double", "post_ewrc_broad"].includes(typhoon.structureMode || "") ||
      forecastIsStructureDamaged
    );

    if (forecastForcedDryAir) {
      const isCore = forecastForcedDryAir === "core";
      const pulse = interventionPulse(forecastDryAirPenaltyHours, forecastDryAirPenaltyTotalHours);
      const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
      const structuralVulnerability = forecastIsStructureDamaged ? 1.18 : 1.0;
      const shearSynergy = 1.0 + clamp01((shearVal - 12.0) / 20.0) * 0.42;
      const dryContrast = clamp01((64.0 - rhVal) / 30.0);
      const warmOceanBuffer = 1.0 - (1.0 - intensityLoad) * forecastAtmosphericStress.oceanSupport * (isCore ? 0.28 : 0.62);
      const baseRate = isCore ? 0.040 + 0.22 * intensityLoad : 0.010 + 0.078 * intensityLoad;
      const dvorakDryDecayGate = smoothstep01((currentVmax - 32.7) / 9.0);
      forecastManualDecay += -baseRate * (0.20 + 0.80 * pulse) * (0.76 + 0.42 * dryContrast) * structuralVulnerability * shearSynergy * warmOceanBuffer * dvorakDryDecayGate;
      forecastManualSuppression = true;

      if (isCore && pulse > 0.45 && forecastHasEstablishedCore) forecastIsStructureDamaged = true;
      forecastDryAirPenaltyHours = Math.max(0, (forecastDryAirPenaltyHours ?? 0) - stepSizeHours);
      if (forecastDryAirPenaltyHours <= 0) {
        forecastForcedDryAir = undefined;
        forecastDryAirPenaltyHours = undefined;
        forecastDryAirPenaltyTotalHours = undefined;
        forecastRecoveryTotalHours = isCore
          ? Math.min(42.0, 20.0 + currentVmax * 0.24)
          : Math.min(24.0, 10.0 + currentVmax * 0.12);
        forecastRecoveryHours = 0.0;
      }
    }

    if (forecastForcedShear !== undefined && forecastForcedShear > 15.0) {
      const pulse = interventionPulse(forecastShearPenaltyHours, forecastShearPenaltyTotalHours);
      const shearSeverity = clamp01((forecastForcedShear - 15.0) / 22.0);
      const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
      const moistureVulnerability = 0.78 + clamp01((62.0 - rhVal) / 28.0) * 0.42;
      const structureVulnerability = forecastIsStructureDamaged ? 1.18 : 1.0;
      const warmWeakBuffer = 1.0 - (1.0 - intensityLoad) * forecastAtmosphericStress.oceanSupport * 0.52;
      forecastManualDecay += -(0.022 + 0.34 * Math.pow(shearSeverity, 1.35) * (0.38 + 0.98 * intensityLoad)) * (0.20 + 0.80 * pulse) * moistureVulnerability * structureVulnerability * warmWeakBuffer;
      forecastManualSuppression = true;

      if (pulse > 0.40 && forecastForcedShear >= 22.0 && forecastHasEstablishedCore) forecastIsStructureDamaged = true;
      forecastShearPenaltyHours = Math.max(0, (forecastShearPenaltyHours ?? 0) - stepSizeHours);
      if (forecastShearPenaltyHours <= 0) {
        const severity = clamp01((forecastForcedShear - 15.0) / 22.0);
        forecastForcedShear = undefined;
        forecastShearPenaltyHours = undefined;
        forecastShearPenaltyTotalHours = undefined;
        forecastRecoveryTotalHours = Math.min(40.0, 14.0 + severity * 14.0 + currentVmax * 0.16);
        forecastRecoveryHours = 0.0;
      }
    }

    if (forecastManualSuppression) {
      const hardSuppression = forecastForcedDryAir === "core" || (forecastForcedShear !== undefined && forecastForcedShear >= 26.0);
      if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= hardSuppression ? 0.18 : 0.16;
      if (forecastManualDecay < 0) vmaxDeltaPerHour += forecastManualDecay;
      if (hardSuppression) {
        const hardForShear = forecastForcedShear !== undefined && forecastForcedShear >= 26.0;
        let suppressionFloor = hardForShear ? 0.02 : 0.0;
        if (forecastForcedDryAir === "core") {
          const p = interventionPulse(forecastDryAirPenaltyHours, forecastDryAirPenaltyTotalHours);
          const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
          const dvorakDryDecayGate = smoothstep01((currentVmax - 32.7) / 9.0);
          suppressionFloor = Math.max(suppressionFloor, (0.022 + 0.34 * intensityLoad * p) * dvorakDryDecayGate);
        }
        if (forecastForcedShear !== undefined && forecastForcedShear >= 26.0) {
          const p = interventionPulse(forecastShearPenaltyHours, forecastShearPenaltyTotalHours);
          const severity = clamp01((forecastForcedShear - 20.0) / 20.0);
          const intensityLoad = smoothstep01((currentVmax - 24.0) / 42.0);
          suppressionFloor = Math.max(suppressionFloor, 0.025 + 0.19 * severity * (0.35 + intensityLoad) * p);
        }
        vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, -suppressionFloor);
      }
      // Do not switch RI off instantly in the forecast; request the same smooth rollover
      // used by the live engine.
      if (forecastRapidIntensifying) forecastRapidAbortRequested = true;
    }

    // Ordinary forecast strengthening also fluctuates on multi-hour time scales rather than
    // drawing a perfectly straight intensity line. Keep the perturbation deterministic so the
    // same forecast member is reproducible.
    if (vmaxDeltaPerHour > 0) {
      const normalWave = episodeWave(`${typhoon.id}-forecast-normal`, h, h, 0.12);
      const desiredRate = Math.max(0, vmaxDeltaPerHour * Math.max(0.74, Math.min(1.26, normalWave)));
      if (!Number.isFinite(forecastIntensityRateMemory) || forecastIntensityRateMemory <= 0) forecastIntensityRateMemory = desiredRate;
      const memoryAlpha = clamp01(stepSizeHours / 1.55);
      forecastIntensityRateMemory += (desiredRate - forecastIntensityRateMemory) * memoryAlpha;
      vmaxDeltaPerHour = 0.66 * desiredRate + 0.34 * forecastIntensityRateMemory;
    } else {
      forecastIntensityRateMemory *= 0.70;
    }

    // RI / ERI episode forecast. This mirrors the live nonlinear lifecycle: a finite episode,
    // low-frequency rate variability, smooth onset/exit, and severity-dependent termination.
    const startForecastRapidEpisode = (mode: "ri" | "eri" | "uri", forced: boolean) => {
      forecastRapidIntensifying = true;
      forecastForcedRapid = forced;
      forecastRapidMode = mode;
      forecastRapidElapsedHours = 0;
      forecastRapidExitHours = 0;
      forecastRapidExitDuration = undefined;
      forecastRapidAbortRequested = false;
      forecastRapidStartRate = Math.max(0, vmaxDeltaPerHour);
      forecastRapidLastRate = Math.max(0, vmaxDeltaPerHour);
      if (mode === "uri") {
        forecastRapidDurationHours = 25.0;
        forecastRapidTarget24h = 24.0 * (URI_RATE_MIN + randIntensity() * (URI_RATE_MAX - URI_RATE_MIN));
      } else if (mode === "eri") {
        forecastRapidDurationHours = 10.0 + randIntensity() * 10.0;
        forecastRapidTarget24h = randIntensity() < 0.035 ? 38.0 + randIntensity() * 11.0 : 24.0 + randIntensity() * 6.0;
      } else {
        const extended = randIntensity() < (forced ? 0.07 : 0.09);
        forecastRapidDurationHours = extended ? 24.0 + randIntensity() * 12.0 : 12.0 + randIntensity() * 12.0;
        forecastRapidTarget24h = 15.0 + randIntensity() * 7.0;
      }
    };

    const forecastManualRapidHostility =
      !!forecastForcedDryAir ||
      (forecastForcedShear !== undefined && forecastForcedShear > 15.0);
    const forecastPlaygroundSeaERI =
      playgroundMode &&
      !metrics.isLand &&
      !forecastPlaygroundAutoERIPaused &&
      !forecastManualRapidHostility;
    if (forecastPlaygroundSeaERI) {
      forecastForcedRapid = true;
      forecastRapidMode = "eri";
      if (!forecastRapidAbortRequested && (!forecastRapidIntensifying || !forecastRapidDurationHours || !forecastRapidTarget24h)) {
        startForecastRapidEpisode("eri", true);
      }
    } else if (playgroundMode && forecastForcedRapid && forecastRapidMode === "eri") {
      // Automatic playground ERI is ocean-only and can also be interrupted by explicit
      // dry-air/shear interventions or a user's manual pause.
      forecastRapidAbortRequested = true;
    }

    if (forecastForcedRapid && !forecastRapidIntensifying) {
      startForecastRapidEpisode(forecastRapidMode, true);
    } else if (forecastRapidIntensifying && (!forecastRapidDurationHours || !forecastRapidTarget24h)) {
      startForecastRapidEpisode(forecastRapidMode, forecastForcedRapid);
    }

    const userGrowthScale = Math.pow(Math.max(0, Math.min(2.0, config.intensificationRate ?? 1.0)), 0.78);
    forecastRapidCooldownHours = Math.max(0, forecastRapidCooldownHours - 1);
    const forecastRiFavorable =
      !forecastRapidIntensifying && !forecastForcedRapid && config.rapidIntensifyEnabled && userGrowthScale > 0.03 &&
      h >= 10 && !metrics.isLand && ewrcState === "none" && currentVmax >= 27.0 && currentVmax <= 60.0 &&
      sstVal >= 28.2 && ohcVal >= 72.0 && shearVal < 10.5 && rhVal > 70.0 &&
      forecastAtmosphericStress.ventilation < 0.39 && forecastAtmosphericStress.motionStress < 0.42 &&
      vmaxDeltaPerHour > 0.68;

    if (forecastRiFavorable) {
      forecastRapidFavorableHours = Math.min(48, forecastRapidFavorableHours + 1);
    } else {
      forecastRapidFavorableHours = Math.max(0, forecastRapidFavorableHours - 1.7);
    }

    if (forecastRiFavorable && forecastRapidCooldownHours <= 0 && forecastRapidFavorableHours >= 10) {
      const ohcSupport = clamp01((ohcVal - 72.0) / 75.0);
      const shearSupport = clamp01((10.5 - shearVal) / 6.5);
      const moistureSupport = clamp01((rhVal - 70.0) / 16.0);
      const growthSupport = clamp01((vmaxDeltaPerHour - 0.68) / 0.60);
      const hourlyHazard = (0.0014 + 0.0018 * ohcSupport + 0.0015 * shearSupport + 0.0012 * moistureSupport + 0.0009 * growthSupport) *
        forecastAtmosphericStress.riProbabilityFactor;
      if (randIntensity() < Math.min(0.0055, Math.max(0, hourlyHazard))) {
        startForecastRapidEpisode("ri", false);
        forecastRapidFavorableHours = 0;
      }
    }

    if (forecastRapidIntensifying && forecastRapidDurationHours && forecastRapidTarget24h) {
      const baselineRate = vmaxDeltaPerHour;
      const landInterference = metrics.isLand || forecastLandContactHours > 0.35 || forecastR10LandContactHours > 0.65;
      const coldWakeInterference = sstVal < 26.3 ||
        ((forecastUpwellingCooling > 1.25 || forecastConsecutiveUpwellingHours > 8.0) && ohcVal < 70.0);
      const dryInterference = !!forecastForcedDryAir || forecastAtmosphericStress.ventilation > 0.66 || rhVal < 53.0;
      const shearInterference = (forecastForcedShear !== undefined && forecastForcedShear > 15.0) || shearVal >= 21.0;
      const structuralInterference = ewrcState === "penalty_failure" || forecastEwrcIsFailure ||
        forecastTerrainHollowCoreMemory >= 0.12 || (forecastIsStructureDamaged && structuralDamagePenaltyFactor < 0.76);
      const targetCapInterference = forecastHardCapActive && currentVmax >= maxLimit - 0.15;
      const naturalDevelopmentDisabled = !forecastForcedRapid && (!config.rapidIntensifyEnabled || userGrowthScale <= 0.03);
      if (!forecastPlaygroundSeaERI && (landInterference || coldWakeInterference || dryInterference || shearInterference || structuralInterference || targetCapInterference || naturalDevelopmentDisabled)) {
        forecastRapidAbortRequested = true;
      }

      if (forecastRapidAbortRequested) {
        const severity = Math.max(
          landInterference ? 0.95 : 0,
          forecastForcedDryAir === "core" ? 1.0 : forecastForcedDryAir === "periphery" ? 0.55 : 0,
          forecastForcedShear !== undefined ? clamp01((forecastForcedShear - 15.0) / 20.0) : 0,
          coldWakeInterference ? 0.70 : 0,
          structuralInterference ? 1.0 : 0,
          shearInterference ? clamp01((shearVal - 17.0) / 16.0) : 0,
          dryInterference ? clamp01((58.0 - rhVal) / 18.0) : 0,
          targetCapInterference ? 0.72 : 0,
          naturalDevelopmentDisabled ? 0.45 : 0
        );
        if (!forecastRapidExitDuration) {
          forecastRapidExitDuration = Math.max(2.0, Math.min(5.8, 5.7 - 3.4 * severity));
          forecastRapidExitHours = 0;
        }
        forecastRapidExitHours += stepSizeHours;
        const q = smoothstep01(forecastRapidExitHours / Math.max(0.5, forecastRapidExitDuration));
        const lastRapidRate = Math.max(baselineRate, forecastRapidLastRate ?? baselineRate);
        vmaxDeltaPerHour = baselineRate + (lastRapidRate - baselineRate) * (1.0 - q);
        if (forecastRapidExitHours >= forecastRapidExitDuration) {
          forecastRapidIntensifying = false;
          forecastForcedRapid = false;
          forecastRapidDurationHours = undefined;
          forecastRapidTarget24h = undefined;
          forecastRapidStartRate = undefined;
          forecastRapidLastRate = undefined;
          forecastRapidElapsedHours = 0;
          forecastRapidExitHours = 0;
          forecastRapidExitDuration = undefined;
          forecastRapidAbortRequested = false;
          forecastRapidMode = "ri";
          forecastRapidFavorableHours = 0;
          forecastRapidCooldownHours = 30 + randIntensity() * 20;
          vmaxDeltaPerHour = baselineRate;
        }
      } else {
        forecastRapidElapsedHours += stepSizeHours;
        const duration = Math.max(4.0, forecastRapidDurationHours);
        const progress = clamp01(forecastRapidElapsedHours / duration);
        const meanRate = forecastRapidTarget24h / 24.0;
        const shape = rapidProfileShape(progress);
        const wave = episodeWave(`${typhoon.id}-forecast-${forecastRapidMode}`, forecastRapidElapsedHours, h, forecastRapidMode === "uri" ? 0.025 : forecastRapidMode === "eri" ? 0.15 : 0.11);
        const thermodynamicSupport = Math.max(0.84, Math.min(1.10,
          0.90 + 0.08 * clamp01((sstVal - 27.0) / 2.5) + 0.07 * clamp01(ohcVal / 120.0) + 0.05 * clamp01((rhVal - 62.0) / 20.0) - 0.08 * clamp01((shearVal - 8.0) / 12.0)
        ));
        let rapidTargetRate = meanRate * shape * wave * thermodynamicSupport * (1.0 - 0.10 * forecastAtmosphericStress.motionStress);
        if (forecastRapidMode === "uri") {
          // URI mirrors the live 1.3x envelope after its two-hour spin-up.
          rapidTargetRate = Math.max(URI_RATE_MIN, Math.min(URI_RATE_MAX, URI_RATE_MULTIPLIER * (1.785 + 0.027 * Math.sin(forecastRapidElapsedHours * 0.92 + h * 0.13) + 0.010 * Math.sin(forecastRapidElapsedHours * 2.1))));
        } else if (forecastRapidMode === "ri") rapidTargetRate = Math.max(0.56, Math.min(1.08, rapidTargetRate));
        else rapidTargetRate = Math.max(0.92, Math.min(2.12, rapidTargetRate));
        const rampInHours = forecastRapidMode === "uri" ? 2.0 : Math.min(3.2, duration * 0.22);
        const rampOutHours = Math.min(3.8, duration * 0.24);
        const envelope = forecastRapidMode === "uri"
          ? smoothstep01(forecastRapidElapsedHours / 2.0)
          : Math.min(
              smoothstep01(forecastRapidElapsedHours / Math.max(0.5, rampInHours)),
              smoothstep01((duration - forecastRapidElapsedHours) / Math.max(0.5, rampOutHours))
            );
        const startRate = forecastRapidStartRate ?? Math.max(0, baselineRate);
        vmaxDeltaPerHour = Math.max(baselineRate, startRate + (rapidTargetRate - startRate) * envelope);
        if (forecastHardCapActive) {
          const gap = Math.max(0, maxLimit - currentVmax);
          const capFade = smoothstep01(gap / 7.0);
          vmaxDeltaPerHour = baselineRate + Math.max(0, vmaxDeltaPerHour - baselineRate) * capFade;
        }
        const forecastRapidPositiveCeiling = forecastRapidMode === "uri" ? URI_RATE_MAX : 2.2;
        vmaxDeltaPerHour = Math.max(-12.5, Math.min(forecastRapidPositiveCeiling, vmaxDeltaPerHour));
        forecastRapidLastRate = vmaxDeltaPerHour;
        if (forecastRapidElapsedHours >= duration) {
          if (forecastRapidMode === "uri") {
            // The 25-hour URI plateau is followed by a dedicated two-hour smooth recovery.
            forecastRapidAbortRequested = true;
            forecastRapidExitDuration = 2.0;
            forecastRapidExitHours = 0;
            forecastForcedRapid = false;
          } else {
            forecastRapidIntensifying = false;
            forecastForcedRapid = false;
            forecastRapidDurationHours = undefined;
            forecastRapidTarget24h = undefined;
            forecastRapidStartRate = undefined;
            forecastRapidLastRate = undefined;
            forecastRapidElapsedHours = 0;
            forecastRapidMode = "ri";
            forecastRapidFavorableHours = 0;
            forecastRapidCooldownHours = 30 + randIntensity() * 20;
            vmaxDeltaPerHour = baselineRate;
          }
        }
      }
    }

    // EWRC simulation along forecast.  This mirrors the live cycle closely enough that an
    // active success/failure intervention does not turn into a different intensity regime as soon
    // as the forecast line begins.
    if (ewrcState === "forming" || ewrcState === "max_decay") {
      ewrcProgress += stepSizeHours / Math.max(1.0, ewrcDuration);
      const ewrcPhasePulse = 0.45 + 0.85 * Math.pow(Math.sin(Math.PI * clamp01(ewrcProgress)), 1.25);
      vmaxDeltaPerHour -= (ewrcWeakenAmount / Math.max(1.0, ewrcDuration)) * ewrcPhasePulse;
      ewrcState = ewrcProgress < 0.5 ? "forming" : "max_decay";

      // Forecast mirror of the live EWRC invariant: once replacement is active, the maximum
      // surface wind cannot keep increasing. A small subset of exceptionally favorable cycles may
      // remain nearly steady, but renewed strengthening belongs to the post-takeover recovery.
      const forecastEwrcHoldQuality = clamp01(
        0.27 * clamp01((sstVal - 27.0) / 2.0) +
        0.20 * clamp01(ohcVal / 115) +
        0.17 * clamp01((rhVal - 58) / 24) +
        0.18 * clamp01((17 - shearVal) / 11) +
        0.18 * clamp01(typhoon.outflowEfficiency ?? 0.55)
      );
      const forecastRareNearSteady = forecastEwrcHoldQuality > 0.91 && !metrics.isLand &&
        forecastTerrainHollowCoreMemory < 0.08 && !forecastEwrcIsFailure;
      if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour = 0;
      if (!forecastRareNearSteady && vmaxDeltaPerHour > -0.025) {
        vmaxDeltaPerHour = -(0.025 + 0.055 * Math.pow(Math.sin(Math.PI * clamp01(ewrcProgress)), 1.2));
      }

      if (ewrcProgress >= 1.0) {
        const envQuality = clamp01((sstVal - 26.0) / 3.0 - shearVal / 22.0 + rhVal / 200.0);
        ewrcProgress = 0;

        const forecastCycleIsFailure = forecastManualEwrcOutcomeOverride
          ? forecastManualEwrcOutcomeOverride === "failure"
          : forecastEwrcIsFailure;
        forecastEwrcIsFailure = forecastCycleIsFailure;

        if (forecastCycleIsFailure) {
          ewrcState = "penalty_failure";
          const intensityRatio = Math.max(1.0, currentVmax / 38.0);
          if (forecastEwrcPenaltyTotalHours <= 0) {
            forecastEwrcPenaltyTotalHours = Math.min(34.0, (12.0 + (1.0 - envQuality) * 13.0) * Math.pow(intensityRatio, 0.55));
          }
          forecastEwrcFailurePenaltyHours = 0;
          if (forecastRapidIntensifying) forecastRapidAbortRequested = true;
        } else {
          forecastSuccessfulEwrcCount += 1;
          ewrcState = "recovering_success";
          const intensityLoad = clamp01((currentVmax - 45.0) / 30.0);
          ewrcRecoveryDuration = Math.max(10.0, Math.min(24.0, 10.0 + (1.0 - envQuality) * 8.0 + intensityLoad * 4.0));
          let extraRise = 1.0 + envQuality * 2.8 + randIntensity() * 1.2;
          if (forecastPeakReference === null && isAutomaticPeakIntensityActive(config)) {
            const cycleRecoveryFactor = forecastSuccessfulEwrcCount <= 1
              ? (1.04 + 0.06 * envQuality)
              : Math.max(0.70, 1.0 - 0.075 * (forecastSuccessfulEwrcCount - 1) + 0.05 * envQuality);
            extraRise *= cycleRecoveryFactor;
          }
          if (forecastHardCapActive && config.maxIntensityLimit !== undefined) {
            const gap = Math.max(0, config.maxIntensityLimit - currentVmax);
            extraRise = Math.min(extraRise, Math.max(0.8, gap * 0.20));
          }
          const recoverableLoss = ewrcWeakenAmount * (0.45 + 0.25 * envQuality);
          ewrcExtraAdjust = Math.min(0.72, (recoverableLoss + extraRise) / ewrcRecoveryDuration);
        }
      }
    } else if (ewrcState === "recovering_success") {
      ewrcProgress += stepSizeHours / Math.max(1.0, ewrcRecoveryDuration);
      vmaxDeltaPerHour += ewrcExtraAdjust;
      if (ewrcProgress >= 1.0) {
        ewrcState = "none";
        ewrcProgress = 0;
        forecastEwrcIsFailure = false;
        forecastManualEwrcOutcomeOverride = undefined;
      }
    } else if (ewrcState === "recovering_failure" || ewrcState === "penalty_failure") {
      const totalPenalty = Math.max(1.0, forecastEwrcPenaltyTotalHours || 12.0);
      forecastEwrcFailurePenaltyHours += stepSizeHours;
      const penaltyProgress = clamp01(forecastEwrcFailurePenaltyHours / totalPenalty);
      const failurePulse = 0.08 + 1.04 * Math.pow(Math.max(0, Math.sin(Math.PI * penaltyProgress)), 1.46);
      const adversity = environmentalAdversity(sstVal, shearVal, rhVal, metrics.isLand);
      const intensityFactor = 0.85 + 0.45 * clamp01((Math.max(24.0, currentVmax) - 30.0) / 40.0);
      const failureDecayRate = -(0.22 + adversity * 0.20) * intensityFactor * failurePulse;

      vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, failureDecayRate);
      forecastIsStructureDamaged = true;
      if (forecastRapidIntensifying) forecastRapidAbortRequested = true;

      if (forecastEwrcFailurePenaltyHours >= totalPenalty) {
        ewrcState = "none";
        ewrcProgress = 0;
        forecastEwrcIsFailure = false;
        forecastManualEwrcOutcomeOverride = undefined;
        forecastEwrcFailurePenaltyHours = 0;
        forecastEwrcPenaltyTotalHours = 0;
        forecastRecoveryTotalHours = Math.min(48.0, 28.0 * Math.max(1.0, currentVmax / 45.0));
        forecastRecoveryHours = 0.0;
      }
    }

    // Preserve post-intervention inertia in the forecast.  Positive redevelopment returns with a
    // smoothstep envelope; weakening remains free to respond immediately to a still-hostile environment.
    if (forecastRecoveryHours !== undefined && forecastRecoveryTotalHours !== undefined) {
      const recoveryBlocked = forecastManualSuppression || ewrcState === "penalty_failure" || ewrcState === "recovering_failure";
      if (!recoveryBlocked && forecastRecoveryHours < forecastRecoveryTotalHours) {
        forecastRecoveryHours += stepSizeHours;
        const recoveryRatio = clamp01(forecastRecoveryHours / Math.max(1.0, forecastRecoveryTotalHours));
        const smoothFactor = recoveryRatio * recoveryRatio * (3.0 - 2.0 * recoveryRatio);
        if (vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= smoothFactor;
      } else if (!recoveryBlocked && forecastTerrainHollowCoreMemory < 0.12) {
        forecastIsStructureDamaged = false;
        forecastRecoveryHours = undefined;
        forecastRecoveryTotalHours = undefined;
      }
    }

    // A severely hollowed terrain-damaged core may keep a broad low-level vortex and even
    // strengthen somewhat over water, but without an explicit core-rebuild intervention it cannot
    // convert favorable thermodynamics into a pristine compact eyewall with normal efficiency.
    if (vmaxDeltaPerHour > 0 && forecastTerrainHollowCoreMemory >= 0.12 && !forecastPenaltyRecoveryActive) {
      vmaxDeltaPerHour *= Math.max(0.48, 1.0 - 0.48 * forecastTerrainHollowCoreMemory);
    }

    // Expanded circulation spreads new oceanic energy across a larger vortex, so peak-wind
    // strengthening is less efficient. Use the structural state, not the configured R7 ceiling.
    if (vmaxDeltaPerHour > 0 && (typhoon.circulationExpansion ?? 0) > 0) {
      vmaxDeltaPerHour *= 1.0 - 0.28 * clamp01(typhoon.circulationExpansion ?? 0);
    }

    // Westerlies depth decay (Requirement 2)
    if (isWesterliesActive && (config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.20 : currentLat > (config.westerliesLat ?? 30) - 3.0)) {
      const depth = config.newEnvironmentPhysicsEnabled
        ? smoothstep01(clamp01(forecastWesterlyRegimeDepth / 0.82))
        : Math.min((currentLat - ((config.westerliesLat ?? 30) - 3.0)) / 10.0, 1.0);
      let westerliesDecay = 1.8;
      if (currentVmax > 28.4) {
        westerliesDecay = 1.8 + (currentVmax - 28.4) * 0.15;
      } else if (currentVmax >= 13.9) {
        westerliesDecay = 0.15 + (currentVmax - 13.9) * 0.11;
      } else {
        westerliesDecay = 0.05;
      }
      vmaxDeltaPerHour -= depth * westerliesDecay;
    }

    if (!playgroundMode && vmaxDeltaPerHour > 0 && currentVmax < 18.0) {
      const weakDevelopmentFraction = 0.24 + 0.26 * smoothstep01((currentVmax - MIN_CYCLONE_INTENSITY_MS) / (18.0 - MIN_CYCLONE_INTENSITY_MS));
      vmaxDeltaPerHour *= weakDevelopmentFraction;
    }

    if (playgroundMode && vmaxDeltaPerHour > 0) {
      vmaxDeltaPerHour *= 8.0;
      vmaxDeltaPerHour = Math.max(-12.5, vmaxDeltaPerHour);
    } else {
      if (typhoon.vmax < 18.0 && vmaxDeltaPerHour > 0) vmaxDeltaPerHour *= 0.5;
      const forecastPositiveCeiling = forecastRapidIntensifying && forecastRapidMode === "uri"
        ? URI_RATE_MAX
        : 2.2;
      vmaxDeltaPerHour = Math.max(-12.5, Math.min(forecastPositiveCeiling, vmaxDeltaPerHour));
    }
    if (forecastHardCapActive && vmaxDeltaPerHour > 0) {
      const targetGap = maxLimit - currentVmax;
      if (targetGap <= 0) vmaxDeltaPerHour = 0;
      else vmaxDeltaPerHour = Math.min(vmaxDeltaPerHour, targetGap / Math.max(stepSizeHours, 1e-6));
    }
    if (vmaxDeltaPerHour < 0 && currentVmax < 15.0) {
      const lowWindBlend = smoothstep01((currentVmax - MIN_CYCLONE_INTENSITY_MS) / (15.0 - MIN_CYCLONE_INTENSITY_MS));
      vmaxDeltaPerHour *= 0.16 + 0.84 * lowWindBlend;
    }

    // 3.5.7 forecast mirror of the live post-landfall tropical-storm soft shelf.  This is a
    // stateful continuation, not a lead-time-based approximation: the forecast inherits both the
    // shelf residence time and the slowly varying support memory from the analysis state, updates
    // them hour-by-hour, and uses the same 3.3.26 shortened residence budget as the live engine.
    if (metrics.isLand && !forecastManualSuppression) {
      const shelfTerrain = getEtopoTerrainDiagnostics(currentLat, currentLon);
      const plainSupport = clamp01(Math.max(
        shelfTerrain?.plainScore ?? 0,
        shelfTerrain?.lowerYangtzePlainSupport ?? 0,
        shelfTerrain?.northChinaPlainSupport ?? 0
      ));
      const namedPlain = Math.max(shelfTerrain?.lowerYangtzePlainSupport ?? 0, shelfTerrain?.northChinaPlainSupport ?? 0);
      const localElevation = shelfTerrain?.elevation ?? metrics.elevation ?? 0;
      const localRelief = shelfTerrain?.localReliefM ?? 0;
      const highMountainGate = clamp01(Math.max(
        (localElevation - 850) / 950,
        (localRelief - 900) / 1000,
        forecastTerrainHollowCoreMemory * 1.08,
        ((typhoon.terrainMountainFraction ?? 0) * 1.05),
        ((typhoon.terrainMaxCoreElevation ?? 0) - 1400) / 1600,
        (Math.max(0, typhoon.terrainBlockingMemory ?? 0) - 0.58) / 0.38
      ));
      const nonMountainSupport = 1 - smoothstep01(highMountainGate);

      const circulationSizeGate = baseR7 > 0
        ? 0.28 + 0.72 * smoothstep01(clamp01((baseR7 - 110) / 250))
        : 0.34;
      const residualCirculationGate = clamp01(
        0.34 * circulationSizeGate +
        0.42 * forecastLowLevelVortexIntegrity +
        0.24 * forecastPostPeakEnvelopeMemory
      );
      const moistureGate = clamp01((rhVal - 46) / 33) * clamp01((forecastMoistureReservoir - 0.10) / 0.72);
      const shearGate = clamp01((29.0 - shearVal) / 17.0);
      const dryGate = 1 - clamp01((Math.max(forecastDryAirCoreExposure, forecastDryAirVentilationIndex) - 0.30) / 0.58);
      const shelfRadius = Math.max(180, Math.min(450, baseR7 > 0 ? baseR7 * 0.90 : 230));
      const shelfLandFraction = getLandCoverage(currentLat, currentLon, shelfRadius, config?.coastlineSource);
      const marineOverlap = clamp01((0.98 - shelfLandFraction) / 0.78);
      const westerlyDepthForShelf = config.newEnvironmentPhysicsEnabled
        ? smoothstep01(clamp01(forecastWesterlyRegimeDepth / 0.82))
        : (config.westerliesEnabled
            ? smoothstep01(clamp01((currentLat - ((config.westerliesLat ?? 30) - 3)) / 10))
            : 0);
      const westerlyShelfFactor = 1 - 0.24 * westerlyDepthForShelf;
      const hostileShelfEnvironment = forecastEwrcIsFailure || ewrcState === "penalty_failure";
      const targetRequestsBelowShelf = forecastHardCapActive && maxLimit < 17.2;
      const instantaneousSupport = hostileShelfEnvironment || targetRequestsBelowShelf ? 0 : clamp01(
        nonMountainSupport * residualCirculationGate *
        (0.30 + 0.16 * moistureGate + 0.10 * shearGate + 0.07 * dryGate +
         0.08 * marineOverlap + 0.08 * clamp01(typhoon.broadMoisturePlatform ?? 0) +
         0.11 * forecastLowLevelVortexIntegrity + 0.08 * forecastPostPeakEnvelopeMemory +
         0.12 * plainSupport + 0.06 * namedPlain) *
        westerlyShelfFactor
      );
      const memoryTau = instantaneousSupport >= forecastPlainTsShelfMemory ? 2.8 : 14.0;
      const memoryAlpha = 1 - Math.exp(-stepSizeHours / memoryTau);
      forecastPlainTsShelfMemory = clamp01(
        forecastPlainTsShelfMemory + (instantaneousSupport - forecastPlainTsShelfMemory) * memoryAlpha
      );

      if (currentVmax < 20.4 && currentVmax >= 16.2) {
        const deepInlandGate = smoothstep01(clamp01((shelfLandFraction - 0.72) / 0.25));
        const compactVortexGate = 1 - circulationSizeGate;
        // 4.1.2 mirror of the live plain-terrain shelf: shorter residence, while retaining
        // a modest extension for a broad circulation that still has marine overlap.
        const residenceBudgetHours = Math.max(4.0, Math.min(22.5,
          6.5
          + 4.8 * marineOverlap
          + 4.4 * circulationSizeGate
          + 3.2 * clamp01(forecastPostPeakEnvelopeMemory)
          + 2.1 * clamp01(forecastLowLevelVortexIntegrity)
          + 1.7 * plainSupport
          + 1.3 * namedPlain
          - 6.2 * deepInlandGate
          - 3.8 * compactVortexGate
          - 8.5 * highMountainGate
        ));
        const residenceFade = 1 - 0.88 * smoothstep01(clamp01(
          (forecastPlainTsShelfHours - residenceBudgetHours) /
          Math.max(4.0, 7.5 + 6.0 * marineOverlap + 4.5 * circulationSizeGate)
        ));
        const effectiveSupport = clamp01(
          Math.max(instantaneousSupport, 0.92 * forecastPlainTsShelfMemory) * residenceFade
        );
        if (effectiveSupport > 0.13 && nonMountainSupport > 0.18 && residualCirculationGate > 0.18) {
          const shelfTarget = 17.72 + 1.10 * effectiveSupport + 0.18 * namedPlain;
          const aboveShelf = currentVmax - shelfTarget;
          let shelfTendency: number;
          if (aboveShelf > 1.15) {
            shelfTendency = -Math.min(0.18, 0.055 + 0.070 * aboveShelf);
          } else if (aboveShelf > 0) {
            shelfTendency = -(0.0025 + 0.017 * (aboveShelf / 1.15)) * (1.0 - 0.76 * effectiveSupport);
          } else {
            shelfTendency = -0.0022 * (1.0 - 0.78 * effectiveSupport);
          }
          const engage = smoothstep01(clamp01((20.4 - currentVmax) / 1.55)) *
            smoothstep01(clamp01((effectiveSupport - 0.10) / 0.38)) *
            nonMountainSupport;
          vmaxDeltaPerHour += (Math.max(vmaxDeltaPerHour, shelfTendency) - vmaxDeltaPerHour) * engage;
          if (currentVmax <= 20.0 && currentVmax >= 17.25 && engage > 0.24) {
            forecastPlainTsShelfHours = Math.min(96, forecastPlainTsShelfHours + stepSizeHours);
          }
        } else {
          forecastPlainTsShelfHours = Math.max(0, forecastPlainTsShelfHours - 0.20 * stepSizeHours);
        }
      } else if (currentVmax >= 20.4) {
        forecastPlainTsShelfHours = Math.max(0, forecastPlainTsShelfHours - 0.45 * stepSizeHours);
      } else {
        forecastPlainTsShelfHours = Math.max(0, forecastPlainTsShelfHours - 0.75 * stepSizeHours);
      }
    } else {
      forecastPlainTsShelfMemory = Math.max(0, forecastPlainTsShelfMemory - stepSizeHours / 9.5);
      forecastPlainTsShelfHours = Math.max(0, forecastPlainTsShelfHours - stepSizeHours);
    }

    // Forecast mirrors the live cold-water shelf so guidance cannot drop straight through the
    // low-TS residual-vortex stage immediately after issuance.
    if (!playgroundMode && !metrics.isLand) {
      const forecastColdTrigger = clamp01(Math.max(
        (26.4 - sstVal) / 3.2,
        (52 - ohcVal) / 55,
        forecastColdWaterExposureHours / 18 * 0.45
      ));
      const forecastResidualVortex = clamp01(
        0.48 * forecastLowLevelVortexIntegrity +
        0.24 * forecastPostPeakEnvelopeMemory +
        0.16 * forecastMoistureReservoir +
        0.12 * clamp01((rhVal - 42) / 36)
      );
      const forecastColdHostile = forecastEwrcIsFailure || ewrcState === "penalty_failure" ||
        forecastDryAirCoreExposure > 0.78 || shearVal > 34;
      const instantColdSupport = forecastColdHostile ? 0 : clamp01(
        forecastColdTrigger * forecastResidualVortex *
        (0.74 + 0.16 * forecastPostPeakEnvelopeMemory + 0.10 * clamp01(typhoon.broadMoisturePlatform ?? 0))
      );
      const tau = instantColdSupport >= forecastColdWaterTsShelfMemory ? 3.2 : 12.0;
      forecastColdWaterTsShelfMemory = clamp01(
        forecastColdWaterTsShelfMemory + (instantColdSupport - forecastColdWaterTsShelfMemory) *
        (1 - Math.exp(-stepSizeHours / tau))
      );
      if (currentVmax < 20.2 && currentVmax >= 16.0 && forecastColdTrigger > 0.10) {
        const residenceBudget = Math.max(5, Math.min(28,
          6.5 + 9.0 * forecastResidualVortex + 5.0 * forecastPostPeakEnvelopeMemory +
          4.0 * forecastMoistureReservoir - 5.0 * clamp01((forecastColdTrigger - 0.55) / 0.45)
        ));
        const residenceFade = 1 - 0.84 * smoothstep01(clamp01(
          (forecastColdWaterTsShelfHours - residenceBudget) / Math.max(5, 11 + 5 * forecastResidualVortex)
        ));
        const support = clamp01(Math.max(instantColdSupport, 0.90 * forecastColdWaterTsShelfMemory) * residenceFade);
        if (support > 0.10 && forecastResidualVortex > 0.22) {
          const target = 17.15 + 0.90 * support;
          const above = currentVmax - target;
          let tendency = -0.0035 * (1 - 0.70 * support);
          if (above > 1.15) tendency = -Math.min(0.22, 0.065 + 0.078 * above);
          else if (above > 0) tendency = -(0.004 + 0.020 * above / 1.15) * (1 - 0.68 * support);
          tendency = Math.min(0, tendency);
          const engage = smoothstep01(clamp01((20.2 - currentVmax) / 1.65)) *
            smoothstep01(clamp01((support - 0.07) / 0.36));
          vmaxDeltaPerHour += (Math.max(vmaxDeltaPerHour, tendency) - vmaxDeltaPerHour) * engage;
          if (currentVmax <= 19.8 && currentVmax >= 17.0 && engage > 0.22) {
            forecastColdWaterTsShelfHours = Math.min(72, forecastColdWaterTsShelfHours + stepSizeHours);
          }
        } else forecastColdWaterTsShelfHours = Math.max(0, forecastColdWaterTsShelfHours - 0.25 * stepSizeHours);
      } else if (currentVmax >= 20.2) forecastColdWaterTsShelfHours = Math.max(0, forecastColdWaterTsShelfHours - 0.45 * stepSizeHours);
      else forecastColdWaterTsShelfHours = Math.max(0, forecastColdWaterTsShelfHours - 0.70 * stepSizeHours);
    } else {
      forecastColdWaterTsShelfMemory = Math.max(0, forecastColdWaterTsShelfMemory - stepSizeHours / 8.5);
      forecastColdWaterTsShelfHours = Math.max(0, forecastColdWaterTsShelfHours - stepSizeHours);
    }

    if (!playgroundMode && !metrics.isLand) {
      const forecastMeanR7 = typhoon.r7 ? (typhoon.r7.ne + typhoon.r7.se + typhoon.r7.sw + typhoon.r7.nw) / 4 : Math.max(120, currentVmax * 5.0);
      const forecastShelfStress = getEastChinaShelfMixingStress(currentLat, currentLon, currentVmax, speedKmh, forecastMeanR7, ohcVal);
      if (forecastShelfStress > 0.02) {
        if (vmaxDeltaPerHour > 0) {
          vmaxDeltaPerHour *= 1 - forecastShelfStress * (0.24 + 0.18 * smoothstep01(clamp01((currentVmax - 58.0) / 8.0)));
        }
        if (currentVmax > 62.0) vmaxDeltaPerHour -= forecastShelfStress * (0.006 + 0.016 * clamp01((currentVmax - 62.0) / 10.0));
      }
    }

    // Forecast split-path invariant: normal poleward transition may intensify through baroclinic
    // coupling; only irreversible cold-air warm-core destruction forbids positive peak-wind tendency.
    if (forecastWarmCoreDestroyed && vmaxDeltaPerHour > 0) {
      vmaxDeltaPerHour = 0;
    }
    const preStepVmax = currentVmax;
    // Same 68 m/s crossing treatment for issued forecast, including forced bursts.
    if (vmaxDeltaPerHour > 0 && currentVmax + vmaxDeltaPerHour * stepSizeHours > 68) {
      const belowThreshold = Math.max(0, 68 - currentVmax);
      vmaxDeltaPerHour = (belowThreshold + (vmaxDeltaPerHour * stepSizeHours - belowThreshold) * (2 / 3)) / stepSizeHours;
    }
    currentVmax += vmaxDeltaPerHour * stepSizeHours;
    currentVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, currentVmax);
    if (forecastHardCapActive) {
      if (preStepVmax <= maxLimit) {
        currentVmax = Math.min(maxLimit, currentVmax);
      } else {
        // A relaxation step may not overshoot below the newly selected target.
        currentVmax = Math.max(maxLimit, Math.min(currentVmax, preStepVmax));
      }
    }

    // Track Super Typhoon land duration
    if (metrics.isLand && currentVmax >= 51.0) {
      if (speedKmh < 30.0) forecastSuperTyLandHours += stepSizeHours;
    } else {
      forecastSuperTyLandHours = 0;
    }
    if (forecastSuperTyLandHours >= 8.0 && currentVmax >= 51.0) {
      currentVmax = 50.8;
    }

    // Forecast ET mirrors the live precursor -> hybrid -> frontal-cyclone conversion.  Use the
    // southern flank of the westerlies as the start of baroclinic interaction, then require both
    // frontal forcing and tropical-core erosion for completion. This prevents the 120/360 h guidance
    // from lagging the live engine by several degrees of latitude.
    const forecastEtWesterlyDepth = config.newEnvironmentPhysicsEnabled
      ? forecastWesterlyRegimeDepth
      : (isWesterliesActive ? clamp01((currentLat - (westerliesLat - 4.0)) / 14.0) : 0);
    const forecastEtWesterlyIngress = isWesterliesActive
      ? smoothstep01(clamp01(forecastEtWesterlyDepth / 0.65))
      : smoothstep01(clamp01((currentLat - 27.0) / 10.0));
    const forecastEtLatitudeGate = config.newEnvironmentPhysicsEnabled
      ? smoothstep01(clamp01(forecastWesterlyRegimeDepth / 0.72))
      : (isWesterliesActive
          ? smoothstep01(clamp01((currentLat - (westerliesLat - 5.0)) / 10.0))
          : smoothstep01(clamp01((currentLat - 27.0) / 11.0)));
    const forecastEtShearGate = smoothstep01(clamp01((shearVal - 8.0) / 18.0));
    const forecastEtTranslationGate = smoothstep01(clamp01((speedKmh - 16.0) / 30.0));
    const forecastEtColdOceanGate = smoothstep01(clamp01((27.5 - sstVal) / 5.5));
    const forecastEtBaroclinicGate = clamp01(
      0.42 * forecastEtWesterlyIngress +
      0.24 * forecastEtShearGate +
      0.18 * forecastEtTranslationGate +
      0.16 * forecastEtColdOceanGate
    );
    const forecastEtStructuralGate = clamp01(
      0.34 * forecastEtShearGate +
      0.24 * (1.0 - forecastMoistureReservoir) +
      0.18 * forecastEtColdOceanGate +
      0.14 * forecastEtTranslationGate +
      0.10 * forecastEtWesterlyIngress
    );
    const forecastTropicalResistance = clamp01(
      0.38 * forecastMoistureReservoir + 0.30 * clamp01((currentVmax - 24.0) / 35.0) +
      0.18 * clamp01((rhVal - 48) / 35) + 0.14 * clamp01((22 - shearVal) / 15)
    );
    let forecastEtTarget = clamp01(
      forecastEtLatitudeGate * (0.24 + 0.46 * forecastEtBaroclinicGate + 0.30 * forecastEtStructuralGate) +
      0.16 * forecastEtWesterlyIngress * forecastEtBaroclinicGate -
      0.16 * forecastTropicalResistance * (1 - forecastEtLatitudeGate)
    );
    if (forecastEtLatitudeGate > 0.62 && forecastEtBaroclinicGate > 0.50) {
      forecastEtTarget = Math.max(forecastEtTarget, clamp01(
        0.56 + 0.20 * forecastEtBaroclinicGate +
        0.15 * forecastEtStructuralGate + 0.08 * forecastEtWesterlyIngress
      ));
    }
    if (isWesterliesActive && (config.newEnvironmentPhysicsEnabled ? forecastWesterlyRegimeDepth > 0.74 : currentLat >= westerliesLat + 4.0) && forecastEtBaroclinicGate > 0.42) {
      forecastEtTarget = Math.max(forecastEtTarget, 0.88 + 0.08 * forecastEtStructuralGate);
    }
    if (forecastWarmCoreDestroyed) forecastEtTarget = Math.max(forecastEtTarget, 0.985);
    if (config.etEnabled === false && !forecastWarmCoreDestroyed) forecastEtTarget = 0;

    const forecastEtGrowthTauBase = Math.max(4.6, Math.min(10.0,
      7.1 + 4.4 * forecastTropicalResistance - 2.6 * forecastEtBaroclinicGate -
      1.1 * forecastEtStructuralGate
    ));
    const forecastEtGrowthTau = forecastWarmCoreDestroyed ? Math.min(9.0, forecastEtGrowthTauBase) : forecastEtGrowthTauBase;
    const forecastEtTau = forecastEtTarget > forecastExtrTransition ? forecastEtGrowthTau : 36.0;
    forecastExtrTransition = (config.etEnabled === false && !forecastWarmCoreDestroyed)
      ? 0
      : clamp01(forecastExtrTransition +
        (forecastEtTarget - forecastExtrTransition) * (1 - Math.exp(-stepSizeHours / forecastEtTau)));
    if (forecastExtrTransition > 0.28) {
      const etWindTarget = 16.5 + 14.0 * forecastEtBaroclinicGate +
        6.0 * clamp01((speedKmh - 20) / 35) + 3.0 * forecastEtWesterlyIngress;
      const blend = smoothstep01((forecastExtrTransition - 0.28) / 0.72);
      const preEtAdjustmentVmax = currentVmax;
      currentVmax += (etWindTarget - currentVmax) * blend * (1 - Math.exp(-stepSizeHours / 12.5));
      if (!forecastWarmCoreDestroyed) {
        const burstPhase = smoothstep01((forecastExtrTransition - 0.38) / 0.26) *
          (1 - 0.58 * smoothstep01((forecastExtrTransition - 0.90) / 0.10));
        const burstPotential = clamp01(
          0.42 * forecastEtBaroclinicGate + 0.24 * forecastEtWesterlyIngress +
          0.20 * forecastEtTranslationGate + 0.14 * forecastEtShearGate
        );
        const burstWave = Math.max(0, Math.sin((h + Number(typhoon.simHour || 0) - 2.5) * Math.PI / 11.0));
        const passiveGain = (0.08 + 0.42 * burstPotential) * burstPhase * burstWave * stepSizeHours;
        const burstCeiling = 27.0 + 11.0 * burstPotential;
        if (currentVmax < burstCeiling) currentVmax += Math.min(passiveGain, burstCeiling - currentVmax);
      }
      // Cold-air-destroyed warm cores remain monotonic even inside the forecast baroclinic zone.
      if (forecastWarmCoreDestroyed) currentVmax = Math.min(preEtAdjustmentVmax, currentVmax);
      if (!playgroundMode && forecastExtrTransition >= 0.96) currentVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(38, currentVmax));
    }

    // Hand-authored forecast intensity is a strong *forecast* reference, not a teleport/setpoint.
    // Pull the physical solution toward the edited curve over several integration steps so land,
    // hostile thermodynamics and ET still matter. Downward edits are allowed to act somewhat faster;
    // positive edits cannot resurrect a vortex after irreversible warm-core destruction.
    const manualForecastIntensityTarget = getManualForecastIntensityTarget(config, h);
    if (manualForecastIntensityTarget !== null) {
      const deltaToManualTarget = manualForecastIntensityTarget - currentVmax;
      // The user-edited curve is the dominant reference for *forecast* intensity.
      // Physical land/ET exposure still softens upward guidance and irreversible
      // warm-core loss still prevents artificial resurrection of a dead storm.
      let manualAuthority = 0.88 + 0.10 * smoothstep01(h / 18);
      if (metrics.isLand) manualAuthority *= 0.88;
      if (forecastExtrTransition > 0.45) manualAuthority *= 1 - 0.20 * smoothstep01((forecastExtrTransition - 0.45) / 0.50);
      if (forecastWarmCoreDestroyed && deltaToManualTarget > 0) manualAuthority = 0;
      const correctionLimit = deltaToManualTarget < 0 ? 9.0 : 8.0;
      const manualCorrection = Math.max(
        -correctionLimit * stepSizeHours,
        Math.min(correctionLimit * stepSizeHours, deltaToManualTarget * manualAuthority)
      );
      currentVmax = Math.max(MIN_CYCLONE_INTENSITY_MS, Math.min(110, currentVmax + manualCorrection));
    }

    currentPmin = calculatePressure(currentVmax);

    let category = TyphoonCategory.TD;
    if (forecastWarmCoreDestroyed) category = TyphoonCategory.RL;
    else if (forecastExtrTransition >= 0.80) category = TyphoonCategory.ET;
    else if (currentVmax >= 17.2 && currentVmax < 24.5) category = TyphoonCategory.TS;
    else if (currentVmax >= 24.5 && currentVmax < 32.7) category = TyphoonCategory.STS;
    else if (currentVmax >= 32.7 && currentVmax < 41.5) category = TyphoonCategory.TY;
    else if (currentVmax >= 41.5 && currentVmax < 51.0) category = TyphoonCategory.STY;
    else if (currentVmax >= 51.0) category = TyphoonCategory.SuperTY;

    if (h % 3 === 0 || h === targetHours) forecast.push({
      lat: currentLat,
      lon: currentLon,
      vmax: currentVmax,
      pmin: currentPmin,
      simHour: h,
      category,
      speed: speedKmh,
      landed: metrics.isLand,
      remnantVortex: currentVmax < 17.2 && forecastLowLevelVortexIntegrity > 0.18,
      lowLevelVortexIntegrity: forecastLowLevelVortexIntegrity,
      warmWaterHoursAfterSea: forecastWarmWaterHoursAfterSea,
      extrTransition: forecastExtrTransition,
      coldAirWarmCoreDestroyed: forecastWarmCoreDestroyed,
      ewrcState: ewrcState as Typhoon["ewrcState"],
      ewrcProgress: clamp01(ewrcProgress),
      structuralDamageHours: forecastStructuralDamageHours,
      isStructureDamaged: forecastIsStructureDamaged,
      terrainHollowCoreMemory: forecastTerrainHollowCoreMemory,
      terrainHollowCoreBearingDeg: forecastTerrainHollowCoreBearingDeg,
      structuralDamagePenaltyFactor: structuralDamagePenaltyFactor,
      penaltyRecoveryActive: forecastPenaltyRecoveryActive,
      penaltyRecoveryElapsedHours: forecastPenaltyRecoveryElapsedHours,
      penaltyRecoveryTotalHours: forecastPenaltyRecoveryTotalHours
    });

    if (!forecastWarmCoreDestroyed && forecastExtrTransition >= 0.8) {
      forecastEtHours += stepSizeHours;
    } else {
      forecastEtHours = 0;
    }

    // Ordinary forecast guidance ends at the simulator's normal operational termination criteria.
    // A small set of diagnostic ensemble products may explicitly request the residual low-level
    // vortex beyond stop-numbering; those products continue the same deterministic integration until
    // the 5 m/s floor or the requested horizon, while their map framing still uses the ordinary stop path.
    if (currentVmax < 17.2) {
      forecastTdHours += stepSizeHours;
      if (metrics.isLand) forecastLandTdHours += stepSizeHours;
      else forecastLandTdHours = 0;
    } else {
      forecastTdHours = 0;
      forecastLandTdHours = 0;
    }
    const reached170E = currentLon >= 218.0;
    const etDissipated = forecastEtHours >= 12.0;
    const etPastResponsibility = !forecastWarmCoreDestroyed && forecastExtrTransition >= 0.8 && currentLon >= 160.0;
    const remnantVortexSurvives = forecastLowLevelVortexIntegrity > 0.20 ||
      forecastPostPeakEnvelopeMemory > 0.16 || forecastRecentLandExposureHours > 1.5;
    const oceanDissipated = !metrics.isLand && currentVmax < 9.0 && forecastTdHours >= 18.0 && !remnantVortexSurvives;
    const tdPersisted = forecastTdHours >= 96.0 && currentVmax < 13.0 && forecastLowLevelVortexIntegrity < 0.24;
    const landTdDissipated = metrics.isLand && currentVmax < 10.5 && forecastLandTdHours >= 18.0 && forecastLowLevelVortexIntegrity < 0.24;

    const normalForecastTermination =
      landTdDissipated || reached170E || etDissipated || etPastResponsibility || oceanDissipated || tdPersisted;

    if (normalForecastTermination && !continueResidualToDissipation) {
      // Keep the actual termination state even when the operational guidance cadence is 3 h.
      // This prevents the rendered path from visually stopping one output interval too early while
      // still ensuring that disabling live auto-stop can never extend forecast guidance past the
      // normal stop-numbering criteria.
      const lastForecastPoint = forecast[forecast.length - 1];
      if (!lastForecastPoint || Math.abs(lastForecastPoint.simHour - h) > 1e-6) {
        forecast.push({
          lat: currentLat,
          lon: currentLon,
          vmax: currentVmax,
          pmin: currentPmin,
          simHour: h,
          category,
          speed: speedKmh,
          landed: metrics.isLand,
          remnantVortex: currentVmax < 17.2 && forecastLowLevelVortexIntegrity > 0.18,
          lowLevelVortexIntegrity: forecastLowLevelVortexIntegrity,
          warmWaterHoursAfterSea: forecastWarmWaterHoursAfterSea,
          extrTransition: forecastExtrTransition,
          ewrcState: ewrcState as Typhoon["ewrcState"],
          ewrcProgress: clamp01(ewrcProgress),
          structuralDamageHours: forecastStructuralDamageHours,
          isStructureDamaged: forecastIsStructureDamaged,
          terrainHollowCoreMemory: forecastTerrainHollowCoreMemory,
          terrainHollowCoreBearingDeg: forecastTerrainHollowCoreBearingDeg,
          structuralDamagePenaltyFactor: structuralDamagePenaltyFactor,
          penaltyRecoveryActive: forecastPenaltyRecoveryActive,
          penaltyRecoveryElapsedHours: forecastPenaltyRecoveryElapsedHours,
          penaltyRecoveryTotalHours: forecastPenaltyRecoveryTotalHours
        });
      }
      break;
    }
  }

  return forecast;
}

/**
 * Lightweight deterministic forecast used while the simulator is running. Future points contain
 * geometry/translation only; their intensity and pressure are deliberately NaN so no caller can
 * mistake them for an issued intensity forecast.
 */
export function calculateForecastTrackPath(
  typhoon: Typhoon,
  config: SimulationConfig,
  targetHours: number = 120,
  fastMode: boolean = true
) {
  return calculateForecastPath(typhoon, config, targetHours, fastMode, false, true);
}

/**
 * Coarse geometry used only by the live forecast/cone/model overlays.  The visible forecast nodes
 * are already 3-hourly, so integrating at the same cadence avoids 80 hidden intermediate steering
 * steps per 120-hour issue.  `previewOnly` prevents this path from becoming a formal product seed.
 */
export function calculateLiveForecastTrackPath(
  typhoon: Typhoon,
  config: SimulationConfig,
  targetHours: number = 120
) {
  const base=calculateForecastPath(typhoon, config, targetHours, true, false, true, undefined, 3);
  // Even the lightweight map preview must honor a confirmed sandbox reference.
  // Otherwise products use the guide but the visible live forecast overlay keeps
  // the old track until a page reload or a later operational cycle.
  const guidance=issuePreSimulationReference(typhoon, Number(typhoon.simHour));
  if(!guidance)return base;
  const rebased=rebasePreSimulationReference(guidance, Number(typhoon.simHour),typhoon);
  return rebased?blendPreSimulationForecast(base,rebased,targetHours,{isLandAt:landGeoJson?.features?checkPointOnLandGeoJson:undefined,liveIssue:typhoon}):base;
}

/**
 * Product-time forecast hydration. Full-precision archived geometry remains authoritative. A
 * coarse live-map preview is deliberately ignored: products rebuild 1-hour forecast geometry from
 * the archived detailed cyclone/config state before running thermodynamics/intensity.
 */
export function materializeForecastPath(
  typhoon: Typhoon,
  config: SimulationConfig,
  targetHours: number = 120,
  geometryPath?: ReadonlyArray<{ lat: number; lon: number; simHour: number; speed?: number; previewOnly?: boolean }>,
  continueResidualToDissipation: boolean = false,
  options?: { intensityPolicy?: 'adaptive' | 'round164' }
) {
  const issueHour = Number(typhoon.simHour);
  const stored = Number.isFinite(issueHour) ? issuePreSimulationReference(typhoon, issueHour) : undefined;
  const observed = stored && mainHistoryForecastFixes(stored,issueHour,typhoon,targetHours);
  const observedForecast:ForecastPathPoint[]|undefined = observed?.map(fix=>({
    lat:fix.lat,lon:fix.lon,vmax:fix.vmax,pmin:fix.pmin,simHour:fix.leadHour,
    speed:fix.speed,category:fix.category,landed:fix.landed,dissipated:fix.dissipated,
    remnantVortex:fix.vmax<17.2&&!fix.dissipated,
    lowLevelVortexIntegrity:fix.lowLevelVortexIntegrity,extrTransition:fix.extrTransition,
    ewrcState:fix.ewrcState,ewrcProgress:fix.ewrcProgress,
    structuralDamageHours:fix.structuralDamageHours,isStructureDamaged:fix.isStructureDamaged,
    preSimulationGuided:true
  }));
  // Recorded main history is the forecast source inside its real time window.
  // Do not even run the independent physical forecast if it covers the whole
  // published horizon (or the storm really dissipated during that history).
  if(observedForecast?.length && (observedForecast.at(-1)!.simHour>=targetHours-1e-5 ||
      observed?.at(-1)?.dissipated))return observedForecast;
  // Round179: continue from the ACTUAL archived terminal location/state, not
  // from a second forecast initialised at the old issue time and translated
  // to the archive end. Translation created detached loops/turns in NMC when
  // the recorded history ended before 120h. The unobserved segment is now a
  // genuine physical forecast issued at the last recorded observation.
  if(observedForecast?.length && stored?.origin==='main-history'){
    const final=observedForecast[observedForecast.length-1];
    const absoluteEnd=issueHour+final.simHour;
    const recorded=typhoon.history?.find(h=>Math.abs(h.simHour-absoluteEnd)<1e-5);
    const finalFix=observed![observed!.length-1];
    const {leadHour:_ignoredLead,...finalState}=finalFix;
    const terminalStorm={...typhoon,...(recorded||{}),...finalState,
      simHour:absoluteEnd,forecastPath:[],preSimulationReference:undefined,
      preSimulationReferenceCleared:false,
      history:(typhoon.history||[]).filter(h=>h.simHour<=absoluteEnd+1e-5)} as Typhoon;
    const remaining=Math.max(0,targetHours-final.simHour);
    if(remaining<1e-5)return observedForecast;
    const tailGeometry=calculateForecastTrackPath(terminalStorm,config,remaining,true);
    const tail=calculateForecastPath(terminalStorm,config,remaining,false,
      continueResidualToDissipation,false,tailGeometry);
    return [...observedForecast,...tail.filter(p=>p.simHour>1e-5).map(p=>({
      ...p,simHour:final.simHour+p.simHour
    }))];
  }
  const reference = stored && Number.isFinite(typhoon.lat) && Number.isFinite(typhoon.lon)
    ? rebasePreSimulationReference(stored,issueHour,{lat:typhoon.lat,lon:typhoon.lon}) : undefined;
  // Always calculate the complete ordinary forecast before merging sandbox
  // observations: a short (e.g. 24h) branch must never cut a 120h product short.
  const preferredGeometry = geometryPath;
  const reusableGeometry = preferredGeometry && preferredGeometry.length && !preferredGeometry.some((point) => point?.previewOnly)
    ? preferredGeometry
    : undefined;
  const geometry = reusableGeometry || calculateForecastTrackPath(typhoon, config, targetHours, true);
  const raw = calculateForecastPath(typhoon, config, targetHours, false, continueResidualToDissipation, false, geometry);
  // Only the issued FULL intensity products receive genesis-stage forecast
  // uncertainty; never smooth the active cyclone or geometry-only previews.
  const guided=reference?blendPreSimulationForecast(raw,reference,targetHours,{
    isLandAt:landGeoJson?.features?checkPointOnLandGeoJson:undefined,
    intensityPolicy:options?.intensityPolicy,liveIssue:typhoon
  }):raw;
  // Product-independent forecast hydration must NEVER apply NMC's deliberately
  // imprecise genesis depiction to JMA, JTWC, ensemble, video or live overlays.
  return guided;
}

export const WEATHER_STATIONS_DATA = [
  // Rank 1: Main regions / capitals (shown at lowest density >= 5%)
  { name: "上海", lat: 31.2304, lon: 121.4737, threshold: 5 },
  { name: "台北", lat: 25.0329, lon: 121.5654, threshold: 5 },
  { name: "东京", lat: 35.6762, lon: 139.6503, threshold: 5 },
  { name: "马尼拉", lat: 14.5995, lon: 120.9842, threshold: 5 },
  { name: "香港", lat: 22.3193, lon: 114.1694, threshold: 5 },
  
  // Rank 2: Key coastal cities (shown at density >= 20%)
  { name: "福州", lat: 26.0745, lon: 119.2965, threshold: 20 },
  { name: "温州", lat: 27.9942, lon: 120.6993, threshold: 20 },
  { name: "广州", lat: 23.1291, lon: 113.2644, threshold: 20 },
  { name: "那霸", lat: 26.2124, lon: 127.6809, threshold: 20 },
  { name: "高雄", lat: 22.6272, lon: 120.3014, threshold: 20 },
  { name: "首尔", lat: 37.5665, lon: 126.9780, threshold: 20 },
  { name: "海口", lat: 20.0319, lon: 110.3311, threshold: 20 },
  
  // Rank 3: Intermediate cities (shown at density >= 40%)
  { name: "宁波", lat: 29.8683, lon: 121.5439, threshold: 40 },
  { name: "厦门", lat: 24.4798, lon: 118.0894, threshold: 40 },
  { name: "汕头", lat: 23.3540, lon: 116.6819, threshold: 40 },
  { name: "湛江", lat: 21.2766, lon: 110.3592, threshold: 40 },
  { name: "三亚", lat: 18.2528, lon: 109.5119, threshold: 40 },
  { name: "鹿儿岛", lat: 31.5966, lon: 130.5571, threshold: 40 },
  { name: "釜山", lat: 35.1796, lon: 129.0756, threshold: 40 },
  { name: "岘港", lat: 16.0544, lon: 108.2022, threshold: 40 },
  { name: "南京", lat: 32.0603, lon: 118.7969, threshold: 40 },
  
  // Rank 4: Extra coastal & inland (shown at density >= 60%)
  { name: "深圳", lat: 22.5431, lon: 114.0579, threshold: 60 },
  { name: "珠海", lat: 22.2707, lon: 113.5767, threshold: 60 },
  { name: "台南", lat: 22.9997, lon: 120.2270, threshold: 60 },
  { name: "济州", lat: 33.4996, lon: 126.5312, threshold: 60 },
  { name: "大阪", lat: 34.6937, lon: 135.5023, threshold: 60 },
  { name: "福冈", lat: 33.5904, lon: 130.4017, threshold: 60 },
  { name: "海防", lat: 20.8449, lon: 106.6881, threshold: 60 },
  { name: "北京", lat: 39.9042, lon: 116.4074, threshold: 60 },
  { name: "武汉", lat: 30.5928, lon: 114.3055, threshold: 60 },
  { name: "长沙", lat: 28.2282, lon: 112.9388, threshold: 60 },
  
  // Rank 5: Detailed coverages (shown at density >= 80%)
  { name: "大连", lat: 38.9140, lon: 121.6147, threshold: 80 },
  { name: "青岛", lat: 36.0671, lon: 120.3826, threshold: 80 },
  { name: "盐城", lat: 33.3473, lon: 120.1636, threshold: 80 },
  { name: "舟山", lat: 29.9855, lon: 122.2072, threshold: 80 },
  { name: "台州", lat: 28.6564, lon: 121.4215, threshold: 80 },
  { name: "阳江", lat: 21.8511, lon: 111.9778, threshold: 80 },
  { name: "茂名", lat: 21.6629, lon: 110.9234, threshold: 80 },
  { name: "北海", lat: 21.4812, lon: 109.1202, threshold: 80 },
  { name: "石垣", lat: 24.3444, lon: 124.1572, threshold: 80 },
  { name: "加拉班", lat: 15.1909, lon: 145.7183, threshold: 80 },
  { name: "阿加尼亚", lat: 13.4443, lon: 144.7937, threshold: 80 },
  { name: "胡志明市", lat: 10.8231, lon: 106.6297, threshold: 80 },
  { name: "南昌", lat: 28.6820, lon: 115.8579, threshold: 80 },
  { name: "杭州", lat: 30.2741, lon: 120.1551, threshold: 80 },
  
  // Rank 6: High density coverages (shown at density >= 95%)
  { name: "连云港", lat: 34.5967, lon: 119.2238, threshold: 95 },
  { name: "泉州", lat: 24.8741, lon: 118.6757, threshold: 95 },
  { name: "漳州", lat: 24.5129, lon: 117.6470, threshold: 95 },
  { name: "防城港", lat: 21.6136, lon: 108.3533, threshold: 95 },
  { name: "三沙", lat: 16.8333, lon: 112.3333, threshold: 95 },
  { name: "宫古岛", lat: 24.8055, lon: 125.2811, threshold: 95 },
  { name: "巴士古", lat: 20.4485, lon: 121.9705, threshold: 95 },
  { name: "宿务", lat: 10.3157, lon: 123.8854, threshold: 95 },
  { name: "达沃", lat: 7.1907, lon: 125.4553, threshold: 95 },
  { name: "芽庄", lat: 12.2388, lon: 109.1967, threshold: 95 },
  { name: "柯罗", lat: 7.3526, lon: 134.4789, threshold: 95 },
  { name: "雅浦", lat: 9.5167, lon: 138.1167, threshold: 95 },
  { name: "澳门", lat: 22.1987, lon: 113.5439, threshold: 95 },
  { name: "惠州", lat: 23.1115, lon: 114.4156, threshold: 95 },
  { name: "中山", lat: 22.5170, lon: 113.3928, threshold: 95 },
  { name: "潮州", lat: 23.6569, lon: 116.6226, threshold: 95 },
  { name: "揭阳", lat: 23.5498, lon: 116.3729, threshold: 95 },
  { name: "宁德", lat: 26.6656, lon: 119.5479, threshold: 95 },
  { name: "莆田", lat: 25.4541, lon: 119.0076, threshold: 95 },
  { name: "龙岩", lat: 25.0916, lon: 117.0179, threshold: 95 },
  { name: "丽水", lat: 28.4676, lon: 119.9230, threshold: 95 },
  { name: "衢州", lat: 28.9358, lon: 118.8758, threshold: 95 },
  { name: "嘉兴", lat: 30.7522, lon: 120.7554, threshold: 95 },
  { name: "湖州", lat: 30.8943, lon: 120.0868, threshold: 95 },
  { name: "南通", lat: 31.9802, lon: 120.8943, threshold: 95 },
  { name: "泰州", lat: 32.4555, lon: 119.9229, threshold: 95 },
  { name: "扬州", lat: 32.3942, lon: 119.4129, threshold: 95 },
  { name: "淮安", lat: 33.6104, lon: 119.0153, threshold: 95 },
  { name: "烟台", lat: 37.4638, lon: 121.4479, threshold: 95 },
  { name: "威海", lat: 37.5131, lon: 122.1204, threshold: 95 },
  { name: "潍坊", lat: 36.7068, lon: 119.1618, threshold: 95 },
  { name: "营口", lat: 40.6670, lon: 122.2354, threshold: 95 },
  { name: "丹东", lat: 40.0007, lon: 124.3541, threshold: 95 },
  { name: "钦州", lat: 21.9664, lon: 108.6242, threshold: 95 },
  { name: "玉林", lat: 22.6363, lon: 110.1652, threshold: 95 },
  { name: "梧州", lat: 23.4770, lon: 111.2791, threshold: 95 },
  { name: "琼海", lat: 19.2435, lon: 110.4668, threshold: 95 },
  { name: "文昌", lat: 19.6129, lon: 110.7540, threshold: 95 },
  { name: "花莲", lat: 23.9871, lon: 121.6015, threshold: 95 },
  { name: "宜兰", lat: 24.7570, lon: 121.7530, threshold: 95 }
];

const STATION_LAND_CACHE = new Map<string, boolean>();
function isStationOnLand(stationName: string, lat: number, lon: number): boolean {
  // Temporary stations can keep the same display name while being moved from sea to land (or
  // between nearby land points).  Caching by name alone therefore leaks the previous location's
  // land/sea classification into the new station and corrupts the reconstructed eye-passage wind.
  const cacheKey = `${stationName}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  if (STATION_LAND_CACHE.has(cacheKey)) {
    return STATION_LAND_CACHE.get(cacheKey)!;
  }
  const isLand = EAST_ASIA_LAND.some(land => checkPointInPolygon(lat, lon, land.polygon));
  STATION_LAND_CACHE.set(cacheKey, isLand);
  return isLand;
}

/**
 * Axisymmetric sea-level pressure profile used by station observations and the live map.
 * The shape follows the Holland-family exponential pressure field: the eye is the pressure
 * minimum even though its surface wind is weak, while the largest pressure gradient lies near
 * the radius of maximum wind.  This is deliberately independent of the station wind estimate.
 */
export function calculateRadialPressure(pmin: number, distKm: number, rmwKm: number, vmax: number): number {
  const ambient = 1013.0;
  const pc = Math.max(0, Math.min(ambient, pmin));
  if (pc >= ambient) return ambient;
  if (!Number.isFinite(distKm) || distKm <= 0.05) return pc;

  const rmw = Math.max(6.0, Math.min(90.0, Number.isFinite(rmwKm) ? rmwKm : 30.0));
  const intensityNorm = Math.max(0, Math.min(1, (vmax - 20.0) / 55.0));
  const hollandB = 1.12 + 0.62 * intensityNorm;
  const radius = Math.max(0.5, distKm);
  const exponent = Math.pow(rmw / radius, hollandB);
  const pressure = pc + (ambient - pc) * Math.exp(-exponent);
  return Math.max(pc, Math.min(ambient, pressure));
}


interface StationCoastGeometry {
  coastDistanceKm: number;
  inlandUnitX: number; // eastward component from nearest shoreline toward the station
  inlandUnitY: number; // northward component from nearest shoreline toward the station
  shelfFactor: number;
  bayFactor: number;
}

const stationCoastGeometryCache = new Map<string, StationCoastGeometry>();

function stationClamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function getStationCoastGeometry(station: { name: string; lat: number; lon: number }): StationCoastGeometry {
  // Coordinate-aware key is essential for temporary stations: many ocean points
  // intentionally share the display name “洋面站点” but must not share geometry.
  const cacheKey = `${station.name}|${station.lat.toFixed(3)}|${station.lon.toFixed(3)}`;
  const cached = stationCoastGeometryCache.get(cacheKey);
  if (cached) return cached;

  const cosLat = Math.max(0.2, Math.cos(station.lat * Math.PI / 180));
  let bestDist2 = Number.POSITIVE_INFINITY;
  let nearestX = 0;
  let nearestY = 0;

  // EAST_ASIA_LAND uses [lat, lon] polygon coordinates.  Measuring the closest
  // polygon edge once per fixed station gives us a cheap, deterministic proxy
  // for both coastal distance and the local landward normal.  The latter is
  // useful for determining how much of the cyclone wind is actually onshore.
  for (const land of EAST_ASIA_LAND) {
    const poly = land.polygon;
    if (!poly || poly.length < 2) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      let ax = (a[1] - station.lon) * 111.12 * cosLat;
      let ay = (a[0] - station.lat) * 111.12;
      let bx = (b[1] - station.lon) * 111.12 * cosLat;
      let by = (b[0] - station.lat) * 111.12;

      // Ignore dateline-spanning segments that are obviously irrelevant to an
      // East-Asian station; otherwise their projected chord can cross the map.
      if (Math.abs(ax - bx) > 5000) continue;

      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx * vx + vy * vy;
      const t = vv > 1e-9 ? stationClamp(-(ax * vx + ay * vy) / vv, 0, 1) : 0;
      const px = ax + vx * t;
      const py = ay + vy * t;
      const d2 = px * px + py * py;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        nearestX = px;
        nearestY = py;
      }
    }
  }

  let coastDistanceKm = Number.isFinite(bestDist2) ? Math.sqrt(bestDist2) : 120;

  // The simplified basin polygon can place city-centre stations tens of kilometres
  // inland even when they represent an operational coastal observing site.  Use the
  // built-in coastal-city catalogue as a conservative second estimate.  This avoids
  // the previous failure mode where virtually every station received zero surge.
  let nearestCatalogKm = Number.POSITIVE_INFINITY;
  for (const c of COASTAL_CITIES) {
    const dx = (c.lon - station.lon) * 111.12 * cosLat;
    const dy = (c.lat - station.lat) * 111.12;
    nearestCatalogKm = Math.min(nearestCatalogKm, Math.hypot(dx, dy));
  }
  if (nearestCatalogKm <= 42) {
    coastDistanceKm = Math.min(coastDistanceKm, 5 + nearestCatalogKm * 0.42);
  }

  // nearestX/Y points from the station to the coastline. Reverse it to obtain
  // a landward normal (sea -> coast -> station). If the geometry is degenerate,
  // fall back to a broad regional landward direction rather than returning NaNs.
  const norm = Math.hypot(nearestX, nearestY);
  let inlandUnitX = norm > 1e-4 ? -nearestX / norm : 0;
  let inlandUnitY = norm > 1e-4 ? -nearestY / norm : 1;

  // Broad-shelf proxy.  Storm surge cannot be inferred from wind alone; NOAA
  // specifically highlights shelf slope/bathymetry and coastline geometry.  The
  // simulator has no bathymetric grid, so use conservative regional factors
  // rather than pretending to run a hydrodynamic SLOSH-class model.
  let shelfFactor = 1.0;
  if (station.lon >= 117 && station.lon <= 123.5 && station.lat >= 28 && station.lat <= 41.5) shelfFactor = 1.28; // East China / Bohai-Yellow Sea shelf
  else if (station.lon >= 108 && station.lon <= 121.5 && station.lat >= 18 && station.lat < 28) shelfFactor = 1.18; // South China Sea shelf
  else if (station.lon >= 120 && station.lon <= 123 && station.lat >= 21 && station.lat <= 26.5) shelfFactor = 0.78; // Taiwan steep shelf / exposed coast
  else if (station.lon >= 127 && station.lon <= 146 && station.lat >= 24 && station.lat <= 46) shelfFactor = 0.82; // Japan / Ryukyu generally steeper shelf
  else if (station.lon >= 119 && station.lon <= 127 && station.lat >= 5 && station.lat <= 20) shelfFactor = 0.80; // Philippines

  let bayFactor = 1.0;
  const bayLike = new Set(["上海", "宁波", "香港", "广州", "海口", "湛江", "东京", "釜山", "厦门", "福州"]);
  if (bayLike.has(station.name)) bayFactor = 1.12;

  const result = { coastDistanceKm, inlandUnitX, inlandUnitY, shelfFactor, bayFactor };
  stationCoastGeometryCache.set(cacheKey, result);
  return result;
}

export function calculateStationStormSurge(
  station: { name: string; lat: number; lon: number },
  cycloneLat: number,
  cycloneLon: number,
  pmin: number,
  rmw: number,
  r7: { ne: number; se: number; sw: number; nw: number } | undefined,
  localWindSpeed: number,
  localPressure: number,
  context?: Partial<PrecipitationStateLike>
): number {
  const coast = getStationCoastGeometry(station);
  // Inland observations rapidly lose a direct storm-surge signal.  A 25-km
  // e-folding keeps coastal/bay stations responsive without assigning large
  // surge values to inland cities.
  const coastalExposure = Math.exp(-Math.max(0, coast.coastDistanceKm) / 32.0);
  if (coastalExposure < 0.025 || (localWindSpeed < 4.0 && pmin > 1002)) return 0;

  const dx = (station.lon - cycloneLon) * 111.12 * Math.max(0.2, Math.cos(cycloneLat * Math.PI / 180));
  const dy = (station.lat - cycloneLat) * 111.12;
  const dist = Math.max(1, Math.hypot(dx, dy));

  // Northern-Hemisphere near-surface cyclonic flow: mainly counter-clockwise
  // tangential wind with a modest inward component.  Add part of translation
  // speed because forward motion enhances the right-hand-side surface wind.
  const rx = dx / dist;
  const ry = dy / dist;
  let ux = -ry - 0.20 * rx;
  let uy =  rx - 0.20 * ry;
  const un = Math.max(1e-6, Math.hypot(ux, uy));
  ux /= un;
  uy /= un;

  let windU = ux * localWindSpeed;
  let windV = uy * localWindSpeed;
  const motionSpeedMs = Math.max(0, context?.speed || 0) / 3.6;
  const heading = ((context?.direction || 0) * Math.PI) / 180;
  windU += Math.sin(heading) * motionSpeedMs * 0.30;
  windV += Math.cos(heading) * motionSpeedMs * 0.30;

  const resolvedOnshoreWind = Math.max(0, windU * coast.inlandUnitX + windV * coast.inlandUnitY);
  // A coarse shoreline normal can be imperfect at bays/islands. Preserve the
  // strong directional dependence while allowing a small basin-setup component
  // from the broader cyclone wind field.
  const effectiveOnshoreWind = Math.max(resolvedOnshoreWind, localWindSpeed * (0.10 + 0.12 * coastalExposure));
  const windForcing = Math.pow(stationClamp(effectiveOnshoreWind / 29.0, 0, 1.85), 2.0);
  const pressureForcing = stationClamp((1010 - localPressure) / 55.0, 0, 1.45);
  const centralPressureSupport = stationClamp((1010 - pmin) / 80.0, 0, 1.35);

  const r7Vals = r7 ? [r7.ne, r7.se, r7.sw, r7.nw].filter(v => Number.isFinite(v) && v > 0) : [];
  const meanR7 = r7Vals.length ? r7Vals.reduce((a, b) => a + b, 0) / r7Vals.length : 180;
  const sizeFactor = stationClamp(Math.sqrt(Math.max(60, meanR7) / 220.0), 0.65, 1.45);
  const rmwFactor = stationClamp(Math.sqrt(Math.max(10, rmw) / 35.0), 0.72, 1.35);
  const forwardFactor = 0.90 + 0.24 * stationClamp((context?.speed || 0) / 35.0, 0, 1.0);
  const landCenterFactor = context?.landed ? 0.72 : 1.0;

  // Parametric *simulation* estimate, not an operational inundation model.  It
  // explicitly combines the major NHC-listed drivers: onshore wind/intensity,
  // cyclone size/RMW, forward speed, approach angle (via onshore component),
  // shelf proxy and coastline/bay geometry.  Pressure contributes a smaller
  // inverse-barometer term.  Values are capped to keep this station statistic
  // plausible for the simplified basin geometry.
  let surge = coastalExposure * coast.shelfFactor * coast.bayFactor * landCenterFactor * (
    0.10 +
    2.55 * windForcing * sizeFactor * rmwFactor * forwardFactor +
    0.55 * pressureForcing +
    0.22 * centralPressureSupport
  );

  if (effectiveOnshoreWind < 8) surge *= stationClamp((effectiveOnshoreWind - 2) / 6, 0.12, 1);
  return Number(stationClamp(surge, 0, 8.8).toFixed(2));
}

function stationBackgroundNoise(name: string, simHour: number, channel: number): number {
  let seed = channel * 2166136261;
  for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
  const h = Math.floor(simHour);
  const x = Math.sin((seed >>> 0) * 0.000001 + h * 12.9898 + channel * 31.731) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function stationSmoothBackgroundNoise(name: string, simHour: number, channel: number): number {
  const h0 = Math.floor(simHour);
  const f = simHour - h0;
  const smooth = f * f * (3 - 2 * f);
  const a = stationBackgroundNoise(name, h0, channel);
  const b = stationBackgroundNoise(name, h0 + 1, channel);
  return a + (b - a) * smooth;
}

export function calculateStationReadings(
  lat: number,
  lon: number,
  vmax: number,
  pmin: number,
  rmw: number,
  r7?: { ne: number; se: number; sw: number; nw: number },
  r10?: { ne: number; se: number; sw: number; nw: number },
  r12?: { ne: number; se: number; sw: number; nw: number },
  previousReadings?: StationReading[],
  totalCasualties: number = 0,
  eyeRadiusKm?: number,
  eyeClearance?: number,
  precipitationContext?: Partial<PrecipitationStateLike> & { config?: Partial<SimulationConfig> },
  stationsOverride?: Array<{ name: string; lat: number; lon: number; threshold?: number }>
): StationReading[] {
  const targetTotalCasualties = Math.max(0, Math.floor(totalCasualties));

  // 1. First pass: compute meteorological variables and local hazard weights for all stations
  const stationSource = stationsOverride && stationsOverride.length > 0 ? stationsOverride : WEATHER_STATIONS_DATA;
  const intermediate = stationSource.map(station => {
    const R = 6371;
    const dLatRad = (station.lat - lat) * (Math.PI / 180);
    const dLonRad = (station.lon - lon) * (Math.PI / 180);
    const a = Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) +
              Math.cos(lat * (Math.PI / 180)) * Math.cos(station.lat * (Math.PI / 180)) *
              Math.sin(dLonRad / 2) * Math.sin(dLonRad / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    
    // Azimuthal Quadrant based on relative station coordinate vectors
    const dLat = station.lat - lat;
    const dLon = (station.lon - lon) * Math.cos((lat * Math.PI) / 180);
    
    let quad: "ne" | "se" | "sw" | "nw" = "ne";
    if (dLat >= 0 && dLon >= 0) {
      quad = "ne";
    } else if (dLat < 0 && dLon >= 0) {
      quad = "se";
    } else if (dLat < 0 && dLon < 0) {
      quad = "sw";
    } else {
      quad = "nw";
    }

    // Retrieve quadrant radii, falling back to symmetric estimate if r7/r10/r12 are undefined
    const qR7 = (r7 && r7[quad] > 0) ? r7[quad] : Math.max(100, vmax * 4);
    const qR10 = (r10 && r10[quad] > 0) ? r10[quad] : (vmax >= 24.5 ? Math.max(50, qR7 * 0.6) : 0);
    const qR12 = (r12 && r12[quad] > 0) ? r12[quad] : (vmax >= 32.7 ? Math.max(30, qR7 * 0.4) : 0);
    
    let windSpeed = 0;
    const stationOnLand = isStationOnLand(station.name, station.lat, station.lon);
    const stationCoast = getStationCoastGeometry(station);
    
    // 3.3.3 dynamical eye cross-section.  The station lull is diagnosed from the persisted eye
    // thermodynamics/eyewall continuity rather than Vmax alone.  A clear intact eye has a calm
    // centre and a steep wind jump into the eyewall; a ragged/cloud-filled eye keeps a much weaker
    // lull. Land turbulence degrades the eye *through the structural state* instead of deleting the
    // calm centre with a hard mainland penalty.
    const diagnosedEyeRadius = eyeRadiusKm && eyeRadiusKm > 2.0
      ? Math.max(2.0, eyeRadiusKm)
      : Math.max(5.0, rmw * 0.56);
    const eyeIntegrity = stationClamp(precipitationContext?.eyewallIntegrity ?? (vmax >= 32.7 ? 0.58 : 0.28), 0, 1);
    const eyeObstruction = stationClamp(precipitationContext?.eyeObstruction ?? 0.42, 0, 1);
    const eyeAsymmetry = stationClamp(precipitationContext?.eyeAsymmetry ?? 0.30, 0, 1);
    const eyeWarmCore = stationClamp(precipitationContext?.eyeWarmCore ?? 0.48, 0, 1);
    const eyeClear = stationClamp(eyeClearance ?? precipitationContext?.eyeClearance ?? 0, 0, 1);
    const stationInnerCoreMoisture = stationClamp(precipitationContext?.innerCoreMoisture ?? 0.68, 0, 1);
    const stationOpenSector = stationClamp(precipitationContext?.eyewallOpenSectorFraction ?? 0.08, 0, 1);
    const stationDeepCoverage = stationClamp(precipitationContext?.deepConvectiveCoverage ?? 0.34, 0, 1);
    const eyeIntensityGate = stationClamp((vmax - 28.0) / 17.0, 0, 1);
    const rawEyeQuality = stationClamp(
      eyeIntensityGate * (0.34 * eyeClear + 0.30 * eyeIntegrity + 0.18 * eyeWarmCore +
        0.18 * (1 - eyeObstruction)) * (0.70 + 0.30 * stationInnerCoreMoisture) *
      (1 - 0.48 * stationOpenSector) * (0.72 + 0.28 * stationDeepCoverage) *
      (1 - 0.46 * eyeAsymmetry), 0, 1
    );
    // A recently organised eye does not physically lose its station-level calm-centre signature
    // the instant the centre crosses a coastline.  Preserve a decaying near-landfall eye-passage
    // floor from the storm's eye-formation/eyewall memory. This affects only the diagnostic station
    // cross-section; it does not recreate a clear satellite eye or alter the cyclone's physics.
    const eyeFormationMemory = stationClamp(Number((precipitationContext as any)?.eyeFormationMemory ?? 0), 0, 1);
    const eyePassageMemory = stationClamp(Math.max(
      eyeFormationMemory,
      eyeIntegrity * 0.82,
      eyeWarmCore * 0.56
    ), 0, 1);
    const nearCoastLandWeight = stationOnLand
      ? 0.30 + 0.24 * Math.exp(-Math.max(0, stationCoast.coastDistanceKm) / 42)
      : 0;
    const landfallEyeQualityFloor = eyeIntensityGate * eyePassageMemory * nearCoastLandWeight;
    const eyeQuality = stationClamp(Math.max(rawEyeQuality, landfallEyeQualityFloor), 0, 1);
    const eyeBearingDeg = ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
    const shearAxis = precipitationContext?.shearDir ?? precipitationContext?.direction ?? 0;
    const eyeAzimuth = ((eyeBearingDeg - shearAxis + 540) % 360) - 180;
    const stationDrySlotBearing = precipitationContext?.drySlotBearingDeg ?? (shearAxis + 145);
    const drySlotAzimuth = ((eyeBearingDeg - stationDrySlotBearing + 540) % 360) - 180;
    const eyewallBreachAtStation = stationOpenSector * Math.exp(-0.5 * Math.pow(drySlotAzimuth / (32 + 30 * stationOpenSector), 2));
    const effectiveEyeRadius = diagnosedEyeRadius * stationClamp(
      1 + 0.13 * eyeAsymmetry * Math.cos(eyeAzimuth * Math.PI / 180) +
      0.09 * eyewallBreachAtStation, 0.76, 1.28
    );
    const motionFloor = stationClamp((precipitationContext?.speed ?? 0) / 3.6 * 0.16, 0, 3.2);
    const clearCenterRatio = 0.045 + 0.12 * (1 - eyeQuality) + 0.08 * eyeObstruction;
    // Keep the eye-centre wind ratio continuous through TS/typhoon thresholds.  The old discrete
    // 0.26 -> 0.48 jump at 32.7 m/s could erase a V-shaped eye passage within only a few kilometres
    // of landfall as the simulated storm weakened across the threshold.
    const raggedCenterRatio = vmax >= 32.7
      ? 0.26
      : vmax >= 17.2
        ? 0.48 - 0.22 * ((vmax - 17.2) / (32.7 - 17.2))
        : 0.82 - 0.34 * stationClamp((vmax - 5.0) / (17.2 - 5.0), 0, 1);
    const centerRatio = stationClamp(
      raggedCenterRatio * (1 - eyeQuality) + clearCenterRatio * eyeQuality, 0.04, 0.88
    );
    const V_center = Math.max(motionFloor, vmax * centerRatio);
    const localEyewallPeak = vmax * stationClamp(1 - 0.34 * eyewallBreachAtStation, 0.60, 1.0);
    const eyeEdgeWind = localEyewallPeak * stationClamp(
      0.40 + 0.18 * (1 - eyeQuality) + 0.08 * eyeAsymmetry, 0.34, 0.70
    );

    if (dist <= rmw) {
      if (dist <= effectiveEyeRadius) {
        const eyeFrac = stationClamp(dist / Math.max(1.5, effectiveEyeRadius), 0, 1);
        // Calm interior with a progressively sharper peripheral gradient as eye quality improves.
        windSpeed = V_center + (eyeEdgeWind - V_center) * Math.pow(eyeFrac, 1.35 + 1.10 * eyeQuality);
      } else {
        const ratio = stationClamp((dist - effectiveEyeRadius) / Math.max(1, rmw - effectiveEyeRadius), 0, 1);
        const steepness = 1.05 + 1.55 * eyeQuality + 0.35 * stationClamp(vmax / 55, 0, 1);
        windSpeed = eyeEdgeWind + (localEyewallPeak - eyeEdgeWind) * Math.pow(ratio, steepness);
      }
    } else if (qR12 > 0 && dist <= qR12) {
      // RMW to R12 zone: wind speed drops from vmax to 32.7 m/s
      const ratio = (dist - rmw) / Math.max(1, qR12 - rmw);
      windSpeed = vmax - (vmax - 32.7) * ratio;
    } else if (qR10 > 0 && dist <= qR10) {
      // R12 to R10 zone: wind speed drops from 32.7 to 24.5 m/s
      const startWind = qR12 > 0 ? 32.7 : vmax;
      const startDist = qR12 > 0 ? qR12 : rmw;
      const ratio = (dist - startDist) / Math.max(1, qR10 - startDist);
      windSpeed = startWind - (startWind - 24.5) * ratio;
    } else if (qR7 > 0 && dist <= qR7) {
      // R10 to R7 zone: wind speed drops from 24.5 to 13.9 m/s
      const startWind = qR10 > 0 ? 24.5 : (qR12 > 0 ? 32.7 : vmax);
      const startDist = qR10 > 0 ? qR10 : (qR12 > 0 ? qR12 : rmw);
      const ratio = (dist - startDist) / Math.max(1, qR7 - startDist);
      windSpeed = startWind - (startWind - 13.9) * ratio;
    } else {
      // Outside R7 zone: wind speed decays relative to R7 boundary
      const startWind = qR7 > 0 ? 13.9 : (qR10 > 0 ? 24.5 : (qR12 > 0 ? 32.7 : vmax));
      const startDist = qR7 > 0 ? qR7 : (qR10 > 0 ? qR10 : (qR12 > 0 ? qR12 : rmw));
      windSpeed = startWind * Math.exp(-(dist - startDist) / 150.0);
    }
    
    // Ensure windSpeed doesn't exceed vmax
    windSpeed = Math.max(0, Math.min(vmax, windSpeed));
    
    // Station winds respond to real coarse terrain, not just an all-land scalar.  ETOPO-derived
    // elevation/relief diagnose exposed ridges, sheltered valleys and broad plains.  The modifier
    // is intentionally modest because a 0.25-degree DEM cannot resolve individual buildings or
    // hilltops; it represents mesoscale exposure/roughness only.
    const stationTerrain = stationOnLand ? getEtopoTerrainDiagnostics(station.lat, station.lon) : null;
    const stationBearingDeg = ((Math.atan2(dLon, dLat) * 180 / Math.PI) + 360) % 360;
    const stationBearingRad = stationBearingDeg * Math.PI / 180;
    const radialEast = Math.sin(stationBearingRad);
    const radialNorth = Math.cos(stationBearingRad);
    // Northern-Hemisphere low-level TC flow is approximately cyclonic/tangential with a modest
    // inflow component; add a small translational vector to estimate the terrain-crossing flow.
    const tangentEast = -Math.cos(stationBearingRad);
    const tangentNorth = Math.sin(stationBearingRad);
    const motionDirRad = ((precipitationContext?.direction ?? 300) * Math.PI) / 180;
    const translationWeight = stationClamp((precipitationContext?.speed ?? 15) / 55, 0.05, 0.34);
    let flowEast = tangentEast - 0.20 * radialEast + translationWeight * Math.sin(motionDirRad);
    let flowNorth = tangentNorth - 0.20 * radialNorth + translationWeight * Math.cos(motionDirRad);
    const flowLength = Math.max(0.25, Math.hypot(flowEast, flowNorth));
    flowEast /= flowLength;
    flowNorth /= flowLength;
    const terrainSlopeAlongFlow = stationTerrain
      ? flowEast * stationTerrain.slopeEastMPerKm + flowNorth * stationTerrain.slopeNorthMPerKm
      : 0;
    const upslopeExposure = stationClamp(terrainSlopeAlongFlow / 16, 0, 1);
    const leeSlopeShelter = stationClamp(-terrainSlopeAlongFlow / 18, 0, 1);
    const reliefRoughness = stationTerrain ? stationClamp((stationTerrain.localReliefM - 90) / 760, 0, 1) : 0;
    const plainExposure = stationTerrain?.plainScore ?? 0;
    const baseLandFriction = stationClamp(
      0.875 + 0.055 * plainExposure - 0.075 * reliefRoughness - 0.030 * stationClamp(windSpeed / 45, 0, 1),
      0.72,
      0.95
    );
    const terrainExposureFactor = stationTerrain
      ? stationClamp(
          1.0 + 0.075 * stationTerrain.ridgeExposure + 0.045 * upslopeExposure -
          0.105 * stationTerrain.valleyShelter - 0.070 * leeSlopeShelter,
          0.78,
          1.10
        )
      : 1.0;
    const stationTerrainWindFactor = stationOnLand ? baseLandFriction * terrainExposureFactor : 1.0;

    const simH = precipitationContext?.simHour ?? 0;
    const cycloneInfluence = stationClamp((qR7 + 170 - dist) / 170, 0, 1);
    if (cycloneInfluence < 0.08) {
      // Real stations never draw perfectly flat lines. Outside TC influence, resolve a modest
      // boundary-layer wind cycle plus deterministic hourly turbulent/synoptic variability.
      const diurnalWind = 0.65 * Math.sin((simH - 5 + station.lon / 15) * Math.PI / 12);
      const synopticWind = 1.15 * stationSmoothBackgroundNoise(station.name, simH / 5.5, 11);
      const turbulentWind = 0.70 * stationBackgroundNoise(station.name, simH, 12);
      const backgroundWind = stationClamp(3.0 + diurnalWind + synopticWind + turbulentWind, 0.4, 8.8);
      windSpeed = backgroundWind;
    }
    if (stationOnLand) {
      windSpeed = Math.max(0, Math.min(vmax, windSpeed * stationTerrainWindFactor));
    }

    // Pressure is controlled by the vortex mass field, not by the local surface-wind minimum
    // inside the eye.  A Holland-style monotonic radial pressure profile prevents the old
    // artefact where a station could see pressure rebound simply because winds collapse in the
    // calm eye.  Pressure now continues falling through the eyewall and reaches its minimum at
    // the cyclone centre.
    let pressure = calculateRadialPressure(pmin, dist, rmw, vmax);
    if (cycloneInfluence < 0.08) {
      const synopticPressure = 1012.6
        + 1.7 * Math.sin((simH + station.lon * 0.22) / 17.0)
        + 0.65 * stationSmoothBackgroundNoise(station.name, simH / 3.0, 21)
        + 0.25 * stationBackgroundNoise(station.name, simH, 22);
      pressure = stationClamp(synopticPressure, 1006.5, 1019.5);
    }
    
    // Multi-mechanism precipitation model.  Unlike the old symmetric max() formula,
    // this explicitly represents outer circulation rain, spiral bands, pre-storm
    // squall lines, broken eyewalls, eye filling/clogging, RI convective bursts and
    // monsoon moisture feeding. Weak TD/TS rainfall is capped much lower.
    const isLand = stationOnLand;
    const elevation = isLand ? (stationTerrain?.elevation ?? getProceduralElevation(station.lat, station.lon)) : 0;
    const precipState: PrecipitationStateLike = {
      ...(precipitationContext || {}),
      lat,
      lon,
      vmax,
      pmin,
      rmw,
      eyeRadiusKm: eyeRadiusKm ?? precipitationContext?.eyeRadiusKm,
      eyeClearance: eyeClearance ?? precipitationContext?.eyeClearance
    };
    const precipitation = computeTyphoonPrecipitation(
      precipState,
      station.lat,
      station.lon,
      {
        config: precipitationContext?.config,
        isLand,
        elevation,
        coastDistanceKm: stationCoast.coastDistanceKm,
        coastInlandUnitEast: stationCoast.inlandUnitX,
        coastInlandUnitNorth: stationCoast.inlandUnitY,
        terrainSlopeEast: stationTerrain?.slopeEastMPerKm,
        terrainSlopeNorth: stationTerrain?.slopeNorthMPerKm
      }
    );
    let precRate = Math.round(precipitation.rate * 10) / 10;
    if (cycloneInfluence < 0.08) {
      // Background precipitation is intermittent: most hours dry, occasional light showers,
      // and rare convective showers in warm/humid low latitudes. This avoids artificial flatness
      // without inventing persistent rain that would inflate 24-h totals.
      const humiditySetting = stationClamp((precipitationContext?.config?.humidityScale ?? 1.0) / 1.2, 0.35, 1.25);
      const tropicality = stationClamp((32 - Math.abs(station.lat - 20)) / 32, 0.15, 1);
      const showerChance = 0.055 + 0.085 * humiditySetting * tropicality;
      const showerDraw = (stationBackgroundNoise(station.name, simH, 31) + 1) / 2;
      if (showerDraw > 1 - showerChance) {
        const convectiveDraw = (stationBackgroundNoise(station.name, simH, 32) + 1) / 2;
        precRate = convectiveDraw > 0.88
          ? Number((2.5 + 8.0 * convectiveDraw * tropicality).toFixed(1))
          : Number((0.2 + 1.8 * convectiveDraw).toFixed(1));
      } else {
        precRate = 0;
      }
    }

    // Instantaneous gust.  Tropical-cyclone gust factors depend strongly on exposure/roughness,
    // and unusually high gusts are disproportionately observed with convective spiral rainbands.
    // Use the precipitation mechanism itself to raise gust probability when an eyewall/hot tower/
    // embedded rainband cell crosses the station, while exposed terrain modestly enhances and
    // sheltered valleys suppress the local peak.
    const convectiveMechanismSignal = stationClamp(Math.max(
      precipitation.components.convectiveBurst / 42,
      precipitation.components.extremeConvectiveCell / 72,
      precipitation.components.inlandScatteredConvection / 28,
      precipitation.components.eyewall / 60,
      precipitation.components.spiralRainband / 54
    ), 0, 1.35);
    const convectiveRainSignal = stationClamp((precRate - 7) / 34, 0, 1.25);
    const stationEyeInterior = dist < effectiveEyeRadius * 0.88;
    const eyeGustSuppression = stationEyeInterior ? stationClamp(1 - 0.72 * eyeQuality, 0.25, 1) : 1;
    const strongConvectionIndex = stationClamp(
      (0.58 * convectiveMechanismSignal + 0.42 * convectiveRainSignal) * eyeGustSuppression, 0, 1.25
    );
    const terrainGustExposure = stationTerrain
      ? stationClamp(1 + 0.10 * stationTerrain.ridgeExposure + 0.045 * upslopeExposure - 0.055 * stationTerrain.valleyShelter, 0.90, 1.16)
      : 1;
    const gustiness = (1.14 + 0.17 * stationClamp(windSpeed / 38.0, 0, 1) + 0.11 * strongConvectionIndex) * terrainGustExposure;
    const gustPulse = 0.45 + 0.55 * Math.abs(Math.sin(simH * 1.73 + station.lat * 0.31 + station.lon * 0.17));
    const convectiveDownburst = strongConvectionIndex * (0.8 + 4.8 * gustPulse) * stationClamp(windSpeed / 10.0, 0.25, 1.25);
    let gustSpeed = (windSpeed * gustiness + gustPulse * stationClamp(windSpeed / 14.0, 0, 1) * 1.6 + convectiveDownburst) *
      (stationEyeInterior ? stationClamp(0.54 + 0.46 * (1 - eyeQuality), 0.45, 1) : 1);
    const gustCap = vmax * (1.50 + 0.10 * stationClamp(strongConvectionIndex, 0, 1) + 0.04 * (stationTerrain?.ridgeExposure ?? 0));
    gustSpeed = Math.max(windSpeed, Math.min(Math.max(windSpeed + 0.5, gustCap), gustSpeed));

    let stormSurge = calculateStationStormSurge(
      station, lat, lon, pmin, rmw, r7, windSpeed, pressure, precipitationContext
    );
    if (cycloneInfluence < 0.08) {
      // Even without a tropical cyclone, the meteorological residual sea level is not perfectly
      // flat: synoptic pressure and ordinary onshore wind setup produce centimetre-scale changes.
      // Keep this tiny and positive because this chart is "surge" rather than astronomical tide.
      const inverseBarometerSetup = Math.max(0, (1013.0 - pressure) * 0.0065);
      const backgroundWindSetup = Math.max(0, (windSpeed - 2.5) * 0.0075);
      const shelfNoise = 0.006 + 0.014 * ((stationBackgroundNoise(station.name, simH, 41) + 1) / 2);
      stormSurge = stationClamp(inverseBarometerSetup + backgroundWindSetup + shelfNoise, 0.004, 0.12);
    }

    // Get previous readings for accumulation
    const prev = previousReadings?.find(r => r.name === station.name);
    const prevMaxWind = prev?.maxWindSpeed ?? 0;
    const prevAccumPrecip = prev?.accumPrecip ?? 0;
    const prevMaxStormSurge = prev?.maxStormSurge ?? 0;
    const prevCasualties = prev?.casualties ?? 0;
    
    const maxWindSpeed = Math.max(prevMaxWind, windSpeed);
    const accumPrecip = prevAccumPrecip + precRate;
    const maxStormSurge = Math.max(prevMaxStormSurge, stormSurge);
    
    // Warning
    let warning = "无预警";
    if (windSpeed >= 32.7) warning = "台风红色预警";
    else if (windSpeed >= 24.4) warning = "台风橙色预警";
    else if (windSpeed >= 17.2) warning = "台风黄色预警";
    else if (windSpeed >= 10.8) warning = "台风蓝色预警";

    // Compute station impact hazard weight
    const windHazard = Math.max(0, Math.pow(windSpeed / 17.0, 3.0) - 0.2);
    const rainHazard = Math.max(0, Math.pow(precRate / 12.0, 1.8));
    const surgeHazard = Math.max(0, Math.pow(stormSurge / 1.35, 2.1));
    const rawHazard = windHazard + rainHazard + surgeHazard;

    let casualtyMultiplier = 1.0;
    if (station.lat > 18 && station.lat < 45 && station.lon > 105 && station.lon < 123) {
      const isTaiwan = station.lat >= 21.5 && station.lat <= 25.5 && station.lon >= 119.5 && station.lon <= 122.5;
      const isHainan = station.lat >= 18 && station.lat <= 20.5 && station.lon >= 108.5 && station.lon <= 111.5;
      if (!isTaiwan && !isHainan) {
        casualtyMultiplier = 0.5;
      }
    }

    const proxWeight = 1.0 / (dist + 50.0);
    const hazardWeight = (rawHazard > 0.05 ? rawHazard : proxWeight * 0.01) * casualtyMultiplier;

    return {
      station,
      windSpeed: Number(windSpeed.toFixed(1)),
      gustSpeed: Number(gustSpeed.toFixed(1)),
      pressure: Number(pressure.toFixed(1)),
      precipitation: Number(precRate.toFixed(1)),
      maxWindSpeed: Number(maxWindSpeed.toFixed(1)),
      accumPrecip: Number(accumPrecip.toFixed(1)),
      stormSurge: Number(stormSurge.toFixed(2)),
      maxStormSurge: Number(maxStormSurge.toFixed(2)),
      warning,
      prevCasualties,
      hazardWeight
    };
  });

  // 2. Distribute casualties among stations so that sum(stationCasualties) === targetTotalCasualties
  const totalWeight = intermediate.reduce((sum, item) => sum + item.hazardWeight, 0);
  const prevSumCasualties = intermediate.reduce((sum, item) => sum + item.prevCasualties, 0);

  let finalCasualties: number[] = [];

  if (targetTotalCasualties === 0) {
    finalCasualties = intermediate.map(() => 0);
  } else if (previousReadings && previousReadings.length > 0 && prevSumCasualties <= targetTotalCasualties) {
    const newCasualtiesTotal = targetTotalCasualties - prevSumCasualties;
    
    if (newCasualtiesTotal === 0) {
      finalCasualties = intermediate.map(item => item.prevCasualties);
    } else {
      const shares = intermediate.map(item => {
        const floatAdd = newCasualtiesTotal * (totalWeight > 0 ? item.hazardWeight / totalWeight : 1 / intermediate.length);
        const floorAdd = Math.floor(floatAdd);
        const remainder = floatAdd - floorAdd;
        return { prev: item.prevCasualties, floorAdd, remainder };
      });

      const allocatedAdd = shares.reduce((s, x) => s + x.floorAdd, 0);
      let diff = newCasualtiesTotal - allocatedAdd;

      const indices = shares.map((_, i) => i).sort((a, b) => shares[b].remainder - shares[a].remainder);
      const bonusSet = new Set(indices.slice(0, diff));

      finalCasualties = shares.map((s, i) => s.prev + s.floorAdd + (bonusSet.has(i) ? 1 : 0));
    }
  } else {
    // Full allocation of targetTotalCasualties
    const shares = intermediate.map(item => {
      const floatVal = targetTotalCasualties * (totalWeight > 0 ? item.hazardWeight / totalWeight : 1 / intermediate.length);
      const floorVal = Math.floor(floatVal);
      const remainder = floatVal - floorVal;
      return { floorVal, remainder };
    });

    const allocated = shares.reduce((s, x) => s + x.floorVal, 0);
    let diff = targetTotalCasualties - allocated;

    const indices = shares.map((_, i) => i).sort((a, b) => shares[b].remainder - shares[a].remainder);
    const bonusSet = new Set(indices.slice(0, diff));

    finalCasualties = shares.map((s, i) => s.floorVal + (bonusSet.has(i) ? 1 : 0));
  }

  // 3. Return final StationReading objects
  return intermediate.map((item, idx) => ({
    name: item.station.name,
    windSpeed: item.windSpeed,
    gustSpeed: item.gustSpeed,
    pressure: item.pressure,
    precipitation: item.precipitation,
    diagnosticVersion: "round124-eye-v2",
    maxWindSpeed: item.maxWindSpeed,
    accumPrecip: item.accumPrecip,
    stormSurge: item.stormSurge,
    maxStormSurge: item.maxStormSurge,
    casualties: finalCasualties[idx],
    warning: item.warning
  }));
}

// Gas Fluid Dynamics Wind Field Engine (Requirement 6 & Structural Symmetry/Patchiness)
export function getFluidDynamicsWindField(
  lat: number,
  lon: number,
  ty: { lat: number; lon: number; vmax: number; rmw?: number; direction?: number; speed?: number; landed?: boolean; isStructureDamaged?: boolean },
  config?: SimulationConfig,
  precomputedIsLand?: boolean
): { speed: number; u: number; v: number; isLand: boolean } {
  const clat = ty.lat;
  const clon = ty.lon;
  const dxKm = (lon - clon) * Math.cos((clat * Math.PI) / 180) * 111.12;
  const dyKm = (lat - clat) * 111.12;
  const distKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);
  const angleToPt = Math.atan2(dyKm, dxKm);

  const rmw = ty.rmw || Math.max(20, Math.min(60, 35.0));
  const vmax = ty.vmax;
  const isLand = precomputedIsLand !== undefined ? precomputedIsLand : getLandMetrics(lat, lon, config?.coastlineSource, true).isLand;
  const elevation = isLand ? getProceduralElevation(lat, lon) : 0;

  // Structural Organization Factor based on intensity (vmax):
  // Strong typhoons (vmax >= 50m/s): highly symmetrical, round, tight eye, continuous eyewall.
  // Weak typhoons (vmax <= 22m/s): low symmetry, irregular eye, gaps/notches in eyewall ("高风速区有缺口").
  let orgFactor = Math.min(1.0, Math.max(0.0, (vmax - 22.0) / 28.0));
  if (isLand || ty.landed || ty.isStructureDamaged) {
    orgFactor *= 0.25; // Structure degrades significantly over land or when damaged
  }

  // Base Cyclonic Fluid Vortex Profile
  let baseSpeed = 0;
  if (distKm <= rmw) {
    // Sharp calm eye for typhoons: central wind drops down to 8%-22% of vmax for strong typhoons
    const R_center = Math.max(10.0, rmw * 0.45);
    let centerRatio = 0.95;
    if (vmax >= 32.7) {
      centerRatio = Math.max(0.08, 0.22 - 0.14 * Math.min(1.0, (vmax - 32.7) / 30.0));
    } else if (vmax >= 17.2) {
      const f = (vmax - 17.2) / 15.5;
      centerRatio = 0.85 - 0.50 * f;
    }
    const V_center = vmax * centerRatio;

    if (distKm <= R_center) {
      // Core calm eye zone
      baseSpeed = V_center * Math.pow(distKm / Math.max(1, R_center), 1.2);
    } else {
      // Transition zone from calm eye boundary to eyewall peak
      const ratio = (distKm - R_center) / Math.max(1, rmw - R_center);
      const steepness = vmax >= 41.5 ? 2.2 : (1.2 + 0.9 * (vmax / 41.5));
      baseSpeed = V_center + (vmax - V_center) * Math.pow(ratio, steepness);
    }
  } else {
    const dR = distKm - rmw;
    const rCore = 38.0;
    const rOuter = 260.0 + vmax * 2.0;
    const coreDecay = Math.exp(-Math.pow(dR / rCore, 1.35));
    const outerDecay = Math.exp(-Math.pow(dR / rOuter, 0.65));
    baseSpeed = vmax * (0.70 * coreDecay + 0.30 * outerDecay);
  }

  // Fluid Dynamics Asymmetry & Eyewall Gaps / Notches for Weak Typhoons
  const eddy1 = Math.sin(lat * 18.3 + lon * 24.7 + (distKm / 35.0));
  const eddy2 = Math.cos(lat * 42.1 - lon * 37.9 - angleToPt * 2.0);
  const eddy3 = Math.sin(angleToPt * 4.0 - Math.log(Math.max(1, distKm / 15.0)) * 3.5);
  
  // Spiral Rainbands Perturbation
  const spiralPhase = angleToPt * 3.0 + distKm / 45.0;
  const spiralBands = Math.sin(spiralPhase) * Math.sin(spiralPhase * 1.5) * (0.08 + 0.08 * orgFactor);
  
  // Coriolis Effect modification on inflow angle
  const fCoriolis = 2 * 7.2921e-5 * Math.sin((Math.abs(lat) * Math.PI) / 180.0);
  const inflowCoriolisAdjust = Math.min(0.2, fCoriolis * 3000); 

  const fluidTurbulence = 0.88 + (1.0 - orgFactor * 0.4) * 0.26 * (0.5 * eddy1 + 0.35 * eddy2 + 0.15 * eddy3) + spiralBands;

  let eyewallAsymmetry = 1.0;
  if (distKm <= rmw * 2.2) {
    if (orgFactor >= 0.8) {
      // High-intensity typhoon: smooth, highly symmetric circular eyewall ring
      eyewallAsymmetry = 0.96 + 0.08 * Math.abs(Math.sin(angleToPt * 2.0));
    } else {
      // Low-intensity typhoon: irregular eye, gaps/notches in high-wind zone, structural asymmetry
      const weakNotch = Math.sin(angleToPt * 2.0 + 1.2) * 0.35 + Math.cos(angleToPt * 3.0 - 0.7) * 0.25;
      const asymmetryWeight = (1.0 - orgFactor);
      eyewallAsymmetry = 1.0 + asymmetryWeight * weakNotch;
    }
  } else if (vmax > 45.0 && distKm > rmw * 2.5 && distKm < rmw * 4.0 && !isLand) {
    // Secondary Eyewall formation in intense oceanic typhoons
    const secondaryEyewall = Math.exp(-Math.pow((distKm - rmw * 3.2) / 15.0, 2.0)) * 0.12;
    eyewallAsymmetry += secondaryEyewall;
  }

  const headingRad = ((ty.direction ?? 315) * Math.PI) / 180.0;
  const relAngle = angleToPt - headingRad;
  const motionAsymmetry = 1.0 + 0.18 * Math.sin(relAngle) * Math.min(1.0, (ty.speed ?? 18) / 28.0);

  let totalSpeed = baseSpeed * fluidTurbulence * eyewallAsymmetry * motionAsymmetry;

  // Landfall Friction, Elevation Terrain Effect ("低海拔地区风速高，高海拔地区风速低") & Patchy Distribution ("斑块状")
  if (isLand || ty.landed) {
    // Low elevation areas (<100m) maintain higher wind speed, high elevation mountain regions (>300m) experience heavy terrain blocking
    let landFriction = 0.78;
    if (elevation > 50) {
      const terrainBlocking = Math.min(0.60, (elevation / 1800.0) * 0.55);
      landFriction *= (1.0 - terrainBlocking);
    }
    totalSpeed *= landFriction;

    // Multi-scale terrain patch noise creates authentic patchy wind cells ("斑块状")
    const patchNoise = Math.sin(lat * 70.0) * Math.cos(lon * 70.0) + Math.sin(lat * 140.0 + lon * 120.0) * 0.5;
    const patchFactor = 0.68 + 0.64 * (0.5 + 0.5 * patchNoise);
    totalSpeed *= patchFactor;
  }

  // Disruption of Spiral Inflow Flow upon Landfall / Weakening
  // Over land or for weak typhoons, clean spiral inflow breaks down into messy, disorganized wind vector directions
  let inflowRad = (isLand ? 0.58 : 0.31) + inflowCoriolisAdjust;
  if (isLand || orgFactor < 0.5) {
    const spiralDisruption = (1.0 - orgFactor) * 0.35 * Math.sin(lat * 35.0 + lon * 35.0);
    inflowRad += spiralDisruption;
  }
  const windDirRad = angleToPt + Math.PI / 2 - inflowRad;

  const u = -totalSpeed * Math.sin(windDirRad);
  const v = -totalSpeed * Math.cos(windDirRad);

  // Procedural ambient background wind speed (3 - 10 kt, which is 1.54 - 5.14 m/s)
  const latNoise = Math.sin(lat * 0.15 + 2.0) * Math.cos(lon * 0.12 - 1.5);
  const lonNoise = Math.cos(lat * 0.25 - lon * 0.18) * Math.sin(lon * 0.1);
  const baseAmbientMs = 2.5 + 1.4 * (latNoise + lonNoise); // Ranges from ~1.5 to 4.8 m/s (3 to 9.3 kt)

  let ambientMs = baseAmbientMs;
  if (isLand) {
    // Land surface roughness reduces wind speed
    ambientMs *= 0.72;
    // Hills and mountains (elevation) reduce ambient wind speed further
    if (elevation > 50) {
      const terrainFriction = Math.max(0.55, 1.0 - (elevation / 1800) * 0.45);
      ambientMs *= terrainFriction;
    }
  }

  // Prevailing 10m surface ambient wind direction (easterly Trade winds in low lat, light variable surface breeze in high lat)
  const ambientAngle = lat < 22.0 
    ? Math.PI + 0.25 
    : Math.PI * 0.85 + Math.sin(lat * 0.25 + lon * 0.18) * 0.45;
  const u_amb = ambientMs * Math.cos(ambientAngle);
  const v_amb = ambientMs * Math.sin(ambientAngle);

  // Smoothly blend out ambient wind near the center of the typhoon eye to keep the eye calm
  const ambientWeight = Math.min(1.0, Math.max(0.0, (distKm - 18.0) / (rmw * 1.6)));

  const finalU = u + u_amb * ambientWeight;
  const finalV = v + v_amb * ambientWeight;
  const finalSpeed = Math.sqrt(finalU * finalU + finalV * finalV);

  return { speed: finalSpeed, u: finalU, v: finalV, isLand };
}
