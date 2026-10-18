import { TyphoonCategory, type SimulationConfig, type Typhoon, type TyphoonState } from "../types";
import { DEFAULT_CONFIG } from "../config/DefaultSettings";
import { getStandardAverageWindRadii, materializeForecastPath } from "./Engine";
import { getColdAirCenterContactHour } from "./ColdAirTiming";
import { mergeTyphoonStateWithCurrentIdentity } from "../utils/TyphoonIdentity";
import { getSynopticEnvironmentState, type SynopticEnvironmentState } from "./SynopticEnvironment";
import { estimateTenMeterReduction, sampleSurfaceRoughness, seaSurfaceDragCoefficient } from "./SurfaceRoughness";
import { sampleTropicalCycloneVortex, synopticInnerCoreRmw } from "./TropicalCycloneVortex";
import { solveWindBoundaryLayer, type BoundaryLayerDiagnostics } from "./WindBoundaryLayerSolver";
import { prepareHighResolutionTerrain } from "./HighResolutionTerrain";
import { diagnoseLandEnvironmentalWindCeilingKt, diagnoseSynopticEnvironmentalWindTarget } from "./SynopticEnvironmentalWindModel";
import { getConfiguredSystemSurfaceState } from "./SynopticConfiguredSystems";
import { blendEnvironmentIntoCyclone } from "./WindVectorBlend";
import { suppressZonalResidualSeams } from "./WindFieldArtifactFilter";
import { refineIntactEyewallVectors, refineEnhancedEyeVectors } from "./IntactEyewallRefinement";
import { yieldSynopticUi } from "../utils/SynopticCooperativeYield";

const DEG = Math.PI / 180;
const RHO_AIR = 1.17;
const OMEGA = 7.2921159e-5;
const EARTH_M_PER_DEG = 111_120;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

const fieldCache = new Map<string, SynopticWindField>();
const FIELD_CACHE_LIMIT = 4;
const environmentSampleCache = new Map<string, SynopticEnvironmentState>();
const ENV_CACHE_LIMIT = 45_000;

export interface SynopticComputationCache {
  /** Forecast integration is expensive; one video session materializes each storm only once. */
  forecastPaths: Map<string, { maxLeadHours: number; seed: Typhoon; points: any[] }>;
  /** Cold-air event anchors are time-invariant within one issue-cycle render session. */
  coldAirAnchors: Map<string, ColdAirEventAnchor[]>;
}

export function createSynopticComputationCache(): SynopticComputationCache {
  return { forecastPaths: new Map(), coldAirAnchors: new Map() };
}

function touchCache<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as K);
}

export interface SynopticBounds {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export interface SynopticWindFieldOptions {
  displayBounds: SynopticBounds;
  typhoons: Typhoon[];
  primaryTyphoon: Typhoon;
  initHour: number;
  validHour: number;
  startDate: Date;
  config?: SimulationConfig;
  gridResolutionDeg: 0.1 | 0.125 | 0.25 | 0.5;
  /** Opt-in Round153 visual refinement; false keeps Round152 result identical. */
  roundedClearEye?: boolean;
  paddingDeg?: number;
  /** Shared by all frames in one still/video render session. */
  computationCache?: SynopticComputationCache;
  /** Video horizon so the first forecast frame can materialize the whole path once. */
  forecastHorizonHours?: number;
  onProgress?: (v: number) => void;
  signal?: AbortSignal;
}

export interface ResolvedSynopticStorm {
  id: string;
  state: TyphoonState | Typhoon;
}

export interface SynopticWindField {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  stepDeg: number;
  computationBounds: SynopticBounds;
  displayBounds: SynopticBounds;
  slpHpa: Float32Array;
  displaySlpHpa: Float32Array;
  u10: Float32Array;
  v10: Float32Array;
  speedKt: Float32Array;
  landMask: Uint8Array;
  elevationM: Float32Array;
  storms: ResolvedSynopticStorm[];
  diagnostics: BoundaryLayerDiagnostics;
  minMslp: number;
  maxWindMs: number;
}

function wrapLon(lon: number) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

function unwrapLonAround(lon: number, anchor: number) {
  let x = lon;
  while (x - anchor > 180) x -= 360;
  while (x - anchor < -180) x += 360;
  return x;
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
}

const yieldUi = yieldSynopticUi;

function stringHash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash01(x: number, y: number, t: number, seed: number) {
  let h = seed ^ Math.imul((x | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul((t | 0) + 0x165667b1, 0x27d4eb2d);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(lat: number, lon: number, hour: number, seed: number, cellDeg: number, timeStepHours: number) {
  const x = (lon + 360) / cellDeg, y = (lat + 90) / cellDeg;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth01(x - x0), ty = smooth01(y - y0);
  const timeScale = Math.max(0.25, timeStepHours);
  const tf = hour / timeScale;
  const t0 = Math.floor(tf);
  const tt = smooth01(tf - t0);
  const spatialAt = (t: number) => {
    const a = hash01(x0, y0, t, seed), b = hash01(x0 + 1, y0, t, seed);
    const c = hash01(x0, y0 + 1, t, seed), d = hash01(x0 + 1, y0 + 1, t, seed);
    const ab = a * (1 - tx) + b * tx, cd = c * (1 - tx) + d * tx;
    return ab * (1 - ty) + cd * ty - 0.5;
  };
  // Interpolate in time as well as space. The previous floor(hour / timestep) implementation
  // jumped to a new random field every 1.5/3/6 h, which appeared in videos as coastline wind
  // ribbons pulsing on and off even when the resolved synoptic flow changed smoothly.
  const a = spatialAt(t0), b = spatialAt(t0 + 1);
  return a * (1 - tt) + b * tt;
}

function correlatedNoise(lat: number, lon: number, hour: number, seed: number): number {
  // 确定性多尺度值噪声；各尺度均双线性平滑，形成连续地形/湍流斑块而非格点方块。
  return (
    valueNoise(lat, lon, hour, seed, 0.45, 1.5) * 1.0
    + valueNoise(lat, lon, hour, seed ^ 0x9e3779b9, 1.0, 3.0) * 0.65
    + valueNoise(lat, lon, hour, seed ^ 0x243f6a88, 2.2, 6.0) * 0.42
  ) / 1.04;
}

function nudgeVectorToMinimumBackground(
  u: number, v: number, desiredSpeed: number, pull: number, fallbackU: number, fallbackV: number
): [number, number] {
  const speed = Math.hypot(u, v);
  if (speed >= desiredSpeed || desiredSpeed <= 0 || pull <= 0) return [u, v];
  const nextSpeed = speed + (desiredSpeed - speed) * clamp(pull, 0, 1);
  if (speed > 0.20) {
    const scale = nextSpeed / speed;
    return [u * scale, v * scale];
  }
  const fallbackSpeed = Math.hypot(fallbackU, fallbackV);
  if (fallbackSpeed > 0.20) {
    const scale = nextSpeed / fallbackSpeed;
    return [fallbackU * scale, fallbackV * scale];
  }
  // Deterministic last-resort direction for a true vector-cancellation calm.
  return [nextSpeed, 0];
}

function historyStateAtOrBefore(typhoon: Typhoon, hour: number): TyphoonState | undefined {
  if (!typhoon.history?.length) return undefined;
  let best: TyphoonState | undefined;
  for (const s of typhoon.history) {
    if (s.simHour <= hour + 1e-6 && (!best || s.simHour > best.simHour)) best = s;
  }
  if (best) return best;
  // 极早期若还没有早于目标时刻的归档，只允许回退到最早归档。
  return typhoon.history.reduce((a, b) => a.simHour <= b.simHour ? a : b);
}

function stormStateAtIssue(typhoon: Typhoon, issueHour: number): TyphoonState | Typhoon {
  // ROUND116: a live synoptic issue uses the latest continuous physical state for the current
  // timeline hour. The UI clock is integer-hour based while typhoon.simHour can already be partway
  // through that hour; requiring |liveHour-issueHour|<0.18 made a newly edited live wind radius fall
  // back to the older archived snapshot. Historical scrub issues still resolve from history.
  const liveHour = typeof typhoon.simHour === "number" ? typhoon.simHour : null;
  if (liveHour !== null && Number.isFinite(liveHour)) {
    const liveTimelineHour = Math.floor(liveHour + 1e-6);
    if (issueHour >= liveTimelineHour - 1e-6 && issueHour <= liveHour + 0.25) return typhoon;
  }
  const hist = historyStateAtOrBefore(typhoon, issueHour);
  return hist ? mergeTyphoonStateWithCurrentIdentity(typhoon, hist) : typhoon;
}


function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function lerpRadiusQuad(a: any, b: any, t: number) {
  if (!a && !b) return undefined;
  const aa = a || b, bb = b || a;
  return {
    ne: (aa.ne || 0) * (1 - t) + (bb.ne || 0) * t,
    se: (aa.se || 0) * (1 - t) + (bb.se || 0) * t,
    sw: (aa.sw || 0) * (1 - t) + (bb.sw || 0) * t,
    nw: (aa.nw || 0) * (1 - t) + (bb.nw || 0) * t
  };
}

function inferredExtrTransition(point: any, fallback: number) {
  const value = Number(point?.extrTransition);
  if (Number.isFinite(value)) return clamp(value, 0, 1);
  return point?.category === TyphoonCategory.ET ? Math.max(0.84, fallback) : fallback;
}

function scaleForecastRadiusQuad(
  seedQuad: any,
  fallbackMean: number,
  targetMean: number,
  extrTransition: number,
  damage: number
) {
  const baseMean = Math.max(1, meanStormRadius(seedQuad, fallbackMean));
  const broaden = 1 + 0.42 * extrTransition + 0.16 * damage;
  const factor = clamp((Math.max(0, targetMean) * broaden) / baseMean, 0.42, 2.6);
  if (!seedQuad) return { ne: targetMean * broaden, se: targetMean * broaden, sw: targetMean * broaden, nw: targetMean * broaden };
  return {
    ne: Math.max(0, Number(seedQuad.ne || baseMean) * factor),
    se: Math.max(0, Number(seedQuad.se || baseMean) * factor),
    sw: Math.max(0, Number(seedQuad.sw || baseMean) * factor),
    nw: Math.max(0, Number(seedQuad.nw || baseMean) * factor)
  };
}

function interpolateSynopticForecastState(seed: Typhoon, a: any, b: any, validHour: number): Typhoon {
  const same = !b || Math.abs(Number(b.simHour) - Number(a.simHour)) < 1e-6;
  const t = same ? 0 : clamp((validHour - Number(a.simHour)) / (Number(b.simHour) - Number(a.simHour)), 0, 1);
  let dlon = Number((b || a).lon) - Number(a.lon);
  while (dlon > 180) dlon -= 360;
  while (dlon < -180) dlon += 360;
  const lerpNum = (key: string, fallback: number) => {
    const av = Number(a?.[key]); const bv = Number((b || a)?.[key]);
    const x = Number.isFinite(av) ? av : fallback; const y = Number.isFinite(bv) ? bv : x;
    return x * (1 - t) + y * t;
  };
  const category = t < 0.5 ? (a?.category ?? seed.category) : ((b || a)?.category ?? a?.category ?? seed.category);
  const seedEt = clamp(seed.extrTransition || 0, 0, 1);
  const aEt = inferredExtrTransition(a, seedEt);
  const bEt = inferredExtrTransition(b || a, aEt);
  const extrTransition = clamp(aEt * (1 - t) + bEt * t, 0, 1);
  const coldAirRemnantLow = Boolean(seed.coldAirWarmCoreDestroyed || a?.coldAirWarmCoreDestroyed || (b || a)?.coldAirWarmCoreDestroyed || category === TyphoonCategory.RL);
  const windShapeTransition = coldAirRemnantLow ? 0 : extrTransition;
  const vmax = lerpNum("vmax", seed.vmax);
  const damageHours = lerpNum("structuralDamageHours", seed.structuralDamageHours || 0);
  const terrainMemory = lerpNum("terrainHollowCoreMemory", seed.terrainHollowCoreMemory || 0);
  const damage = clamp(Math.max(terrainMemory, damageHours / 30, (a?.isStructureDamaged || (b || a)?.isStructureDamaged) ? 0.45 : 0), 0, 1);

  const seedStd = getStandardAverageWindRadii(Math.max(0, seed.vmax));
  const nowStd = getStandardAverageWindRadii(Math.max(0, vmax));
  const r7 = (a?.r7 || (b || a)?.r7)
    ? lerpRadiusQuad(a?.r7 || seed.r7, (b || a)?.r7 || a?.r7 || seed.r7, t)
    : scaleForecastRadiusQuad(seed.r7, seedStd.r7 || Math.max(150, (seed.rmw || 35) * 5.2), nowStd.r7 || Math.max(120, (seed.rmw || 35) * 4.2), windShapeTransition, damage);
  const r10 = (a?.r10 || (b || a)?.r10)
    ? lerpRadiusQuad(a?.r10 || seed.r10, (b || a)?.r10 || a?.r10 || seed.r10, t)
    : scaleForecastRadiusQuad(seed.r10, seedStd.r10 || Math.max(70, (seed.rmw || 35) * 2.5), nowStd.r10, windShapeTransition, damage);
  const r12 = (a?.r12 || (b || a)?.r12)
    ? lerpRadiusQuad(a?.r12 || seed.r12, (b || a)?.r12 || a?.r12 || seed.r12, t)
    : scaleForecastRadiusQuad(seed.r12, seedStd.r12 || Math.max(45, (seed.rmw || 35) * 1.6), nowStd.r12, windShapeTransition, damage);

  const rawRmw = lerpNum("rmw", Number.NaN);
  const inferredRmw = clamp(
    (seed.rmw || 35) * Math.sqrt(Math.max(14, seed.vmax || 14) / Math.max(14, vmax || 14)) *
    (1 + 0.62 * windShapeTransition + 0.26 * damage),
    8, 240
  );
  const rmw = Number.isFinite(rawRmw) ? rawRmw : inferredRmw;

  return {
    ...seed, ...a, ...(b || a),
    lat: lerpNum("lat", seed.lat),
    lon: wrapLon(Number(a.lon) + dlon * t),
    vmax,
    pmin: clamp(lerpNum("pmin", seed.pmin), 0, 1045),
    rmw,
    speed: lerpNum("speed", seed.speed || 0),
    direction: lerpAngleDeg(Number(a?.direction ?? seed.direction ?? 0), Number((b || a)?.direction ?? a?.direction ?? seed.direction ?? 0), t),
    category,
    extrTransition,
    coldAirWarmCoreDestroyed: coldAirRemnantLow || undefined,
    ewrcProgress: lerpNum("ewrcProgress", seed.ewrcProgress || 0),
    ewrcState: t < 0.5 ? (a?.ewrcState ?? seed.ewrcState) : ((b || a)?.ewrcState ?? a?.ewrcState ?? seed.ewrcState),
    structuralDamageHours: damageHours,
    isStructureDamaged: t < 0.5 ? (a?.isStructureDamaged ?? seed.isStructureDamaged) : ((b || a)?.isStructureDamaged ?? a?.isStructureDamaged ?? seed.isStructureDamaged),
    terrainHollowCoreMemory: terrainMemory,
    terrainHollowCoreBearingDeg: lerpAngleDeg(
      Number(a?.terrainHollowCoreBearingDeg ?? seed.terrainHollowCoreBearingDeg ?? seed.direction ?? 0),
      Number((b || a)?.terrainHollowCoreBearingDeg ?? a?.terrainHollowCoreBearingDeg ?? seed.terrainHollowCoreBearingDeg ?? seed.direction ?? 0),
      t
    ),
    structuralDamagePenaltyFactor: lerpNum("structuralDamagePenaltyFactor", seed.structuralDamagePenaltyFactor ?? 1),
    penaltyRecoveryActive: t < 0.5 ? (a?.penaltyRecoveryActive ?? seed.penaltyRecoveryActive) : ((b || a)?.penaltyRecoveryActive ?? a?.penaltyRecoveryActive ?? seed.penaltyRecoveryActive),
    lowLevelVortexIntegrity: lerpNum("lowLevelVortexIntegrity", seed.lowLevelVortexIntegrity ?? 0.56),
    warmWaterHoursAfterSea: lerpNum("warmWaterHoursAfterSea", seed.warmWaterHoursAfterSea ?? 0),
    penaltyRecoveryElapsedHours: lerpNum("penaltyRecoveryElapsedHours", seed.penaltyRecoveryElapsedHours ?? 0),
    penaltyRecoveryTotalHours: lerpNum("penaltyRecoveryTotalHours", seed.penaltyRecoveryTotalHours ?? 0),
    r7, r10, r12,
    simHour: validHour,
    landed: t < 0.5 ? (a?.landed ?? seed.landed) : ((b || a)?.landed ?? a?.landed ?? seed.landed),
    dissipated: seed.dissipated || Boolean((t < 0.5 ? a : (b || a))?.remnantVortex && vmax <= 5)
  } as Typhoon;
}

export function resolveSynopticStormAtHour(
  typhoon: Typhoon,
  initHour: number,
  validHour: number,
  config: SimulationConfig,
  computationCache?: SynopticComputationCache,
  forecastHorizonHours?: number
): ResolvedSynopticStorm | null {
  if (validHour <= initHour + 1e-6) {
    const rawState = stormStateAtIssue(typhoon, validHour);
    if ((rawState as Typhoon).timelineHidden) return null;
    const state = { ...rawState, pmin: clamp(Number.isFinite(rawState.pmin) ? rawState.pmin : 1000, 0, 1045) } as TyphoonState | Typhoon;
    return { id: typhoon.id, state };
  }
  const issueState = stormStateAtIssue(typhoon, initHour);
  const seed = issueState === typhoon ? typhoon : mergeTyphoonStateWithCurrentIdentity(typhoon, issueState, { history: typhoon.history.filter((h) => h.simHour <= initHour + 1e-6) });
  const lead = Math.max(3, Math.ceil((validHour - initHour) / 3) * 3 + 3);
  const requestedLead = Math.max(lead, Math.max(0, forecastHorizonHours || 0));
  const configHash = stringHash(JSON.stringify(config));
  // ROUND116: forecast materialization cache must include the mutable issue-state structure.
  // In particular, changing circulation-size / r7-r10-r12 targets at the same issue hour must not
  // reuse a path materialized before that edit. Include the resolved seed radii and a compact
  // forecast-geometry signature while keeping the cache cheap enough for per-video reuse.
  const lastGeometryPoint = seed.forecastPath?.length ? seed.forecastPath[seed.forecastPath.length - 1] : undefined;
  const seedStateHash = stringHash(stormCacheSignature([{ id: typhoon.id, state: seed }]) +
    `|fp:${seed.forecastPath?.length || 0}:${Number(lastGeometryPoint?.lat || 0).toFixed(3)}:${Number(lastGeometryPoint?.lon || 0).toFixed(3)}`);
  const cacheKey = `${typhoon.id}|${initHour.toFixed(3)}|${configHash}|${seedStateHash}`;
  let cachedForecast = computationCache?.forecastPaths.get(cacheKey);
  if (!cachedForecast || cachedForecast.maxLeadHours + 1e-6 < requestedLead) {
    // materializeForecastPath returns lead-relative hours (0, 3, 6...). Synoptic products use
    // absolute simulation hours, so offset every hydrated forecast point by the frozen issue hour.
    // ROUND107: a video now asks for its complete horizon up front and reuses this materialized
    // path for every frame instead of reintegrating 0..N hours again and again.
    const relativePath = materializeForecastPath(seed, config, requestedLead, seed.forecastPath, true);
    const path = relativePath.map((p: any) => ({ ...p, simHour: initHour + Number(p.simHour || 0) }));
    const issuePoint = { ...seed, simHour: initHour };
    cachedForecast = {
      maxLeadHours: requestedLead,
      seed,
      points: [issuePoint, ...path].filter((p: any) => Number.isFinite(p?.simHour)).sort((a: any, b: any) => a.simHour - b.simHour)
    };
    computationCache?.forecastPaths.set(cacheKey, cachedForecast);
  }
  const points = cachedForecast.points;
  if (!points.length) return null;
  let a: any = points[0], b: any = points[points.length - 1];
  for (let i = 0; i < points.length - 1; i++) {
    if (validHour >= points[i].simHour - 1e-6 && validHour <= points[i + 1].simHour + 1e-6) { a = points[i]; b = points[i + 1]; break; }
  }
  if (validHour >= points[points.length - 1].simHour) a = b = points[points.length - 1];
  const state = interpolateSynopticForecastState(seed, a, b, validHour);
  if (!Number.isFinite(state.lat) || !Number.isFinite(state.lon)) return null;
  return { id: typhoon.id, state };
}

function localSolarHour(date: Date, lon: number) {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60;
  return ((utc + lon / 15) % 24 + 24) % 24;
}

function environmentPressureAdjustment(env: SynopticEnvironmentState, lat: number, isLand: boolean, localHour: number, month: number): number {
  const s = env.scores;
  const summer = Math.cos(((month - 7) / 12) * Math.PI * 2);
  const circulation = 0.9 * s.subtropicalHigh + 0.55 * s.continentalHigh + 0.35 * s.westerlyRidge
    - 0.75 * s.monsoonTrough - 0.55 * s.monsoonLow - 0.45 * s.itcz - 0.45 * s.westerlyTrough - 0.35 * s.cutoffLow;
  const diurnal = isLand ? -1.25 * Math.cos(((localHour - 15) / 24) * Math.PI * 2) * (0.65 + 0.35 * Math.max(0, summer)) : 0;
  const continentalWeight = isLand && lat > 20 ? smooth01((lat - 20) / 20) : 0;
  const seasonalContinental = continentalWeight * (
    1.2 * Math.max(0, -summer)   // 冬半年大陆冷高压
    - 0.9 * Math.max(0, summer) // 夏半年大陆热低压
  );
  return clamp(0.8 * circulation + diurnal + seasonalContinental, -3.0, 3.0);
}

interface ColdAirSurfaceSignal { u: number; v: number; target10mMs: number; weight: number; strength: 1 | 2 | 3; }

interface ColdAirEventAnchor {
  stormId: string;
  strength: 1 | 2 | 3;
  arrivalHour: number;
  centerContactHour: number;
  contactLat: number;
  contactLon: number;
}

interface ColdAirPathwaySignal {
  weight: number;
  zonalFraction: number;
  taiwanStraitWeight: number;
  bashiWeight: number;
  southChinaSeaWeight: number;
  eastPhilippineWeight: number;
}

function coldAirGaussianLon(lon: number, centerLon: number, sigmaDeg: number): number {
  let d = wrapLon(lon) - centerLon;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.exp(-0.5 * Math.pow(d / Math.max(0.25, sigmaDeg), 2));
}

function coldAirUnionWeight(...weights: number[]): number {
  let miss = 1;
  for (const value of weights) miss *= 1 - clamp(value, 0, 1);
  return clamp(1 - miss, 0, 1);
}

function coldAirFrontPhaseDeg(lon: number): number {
  // ROUND115: a real marine cold-surge leading edge is not a perfectly zonal latitude line.
  // Give the advancing edge a gentle, deterministic longitudinal phase so the Bohai/East-China-
  // Sea/South-China-Sea pathway arrives as a curved marine front rather than one raster row.
  const x = wrapLon(lon);
  return 0.24 * Math.sin((x - 121) * 0.42) + 0.12 * Math.sin((x - 118) * 0.19);
}

function coldAirPathwaySignal(lat: number, lon: number, isLand: boolean, landInterior: number): ColdAirPathwaySignal {
  // ROUND102: the outbreak follows marine pathways rather than a 100-132E rectangular sheet.
  // Two northern sources descend simultaneously: the Bohai/Yellow-Sea source is dominant, while
  // the western Sea-of-Japan source is intentionally much weaker. They merge over the East China
  // Sea, then split around Taiwan. The western branch uses both Taiwan Strait and Bashi Channel
  // before spreading into the South China Sea; the eastern branch enters the Philippine Sea and
  // loses coherence much faster.
  const x = wrapLon(lon);
  const highLatitudeGate = 1 - smooth01((lat - 45) / 5);
  const lowLatitudeGate = smooth01((lat - 5) / 6);

  const northProgress = smooth01((lat - 31) / 9);
  const bohaiCenterLon = 123.4 - 3.8 * northProgress;
  const westJapanCenterLon = 126.3 + 4.5 * northProgress;
  const bohaiWeight = coldAirGaussianLon(x, bohaiCenterLon, 2.25) * highLatitudeGate;
  const westJapanWeight = 0.56 * coldAirGaussianLon(x, westJapanCenterLon, 2.15) * highLatitudeGate;
  const northernSources = coldAirUnionWeight(bohaiWeight, westJapanWeight);
  const northernZonal = (0.18 * bohaiWeight - 0.18 * westJapanWeight) /
    Math.max(1e-6, bohaiWeight + westJapanWeight);

  const eastChinaSeaCenterLon = 124.3 + 0.15 * clamp(lat - 27, -3, 4);
  const eastChinaSeaWeight = coldAirGaussianLon(x, eastChinaSeaCenterLon, 3.7);
  const mergeGate = 1 - smooth01((lat - 29) / 5);
  const preSplitWeight = northernSources * (1 - mergeGate)
    + coldAirUnionWeight(northernSources * 0.72, eastChinaSeaWeight) * mergeGate;
  const preSplitZonal = northernZonal * (1 - mergeGate);

  const southProgress = clamp((25 - lat) / 13, 0, 1);
  const taiwanStraitCenterLon = 119.6 - 2.8 * southProgress;
  const bashiCenterLon = 122.1 - 4.2 * southProgress;
  const taiwanStraitWeight = 0.95 * (1 - 0.12 * smooth01((18 - lat) / 8))
    * coldAirGaussianLon(x, taiwanStraitCenterLon, 1.65 + 1.25 * southProgress);
  const bashiWeight = 0.92 * (1 - 0.08 * smooth01((16 - lat) / 8))
    * coldAirGaussianLon(x, bashiCenterLon, 1.8 + 1.45 * southProgress);
  const southChinaSeaWeight = coldAirUnionWeight(taiwanStraitWeight, bashiWeight);

  const eastPhilippineCenterLon = 125.8 + 6.0 * southProgress;
  const eastPhilippineDecay = 1 - 0.94 * smooth01((24 - lat) / 12);
  const eastPhilippineWeight = 0.78 * eastPhilippineDecay
    * coldAirGaussianLon(x, eastPhilippineCenterLon, 2.7 + 0.6 * southProgress);
  const downstreamWeight = coldAirUnionWeight(southChinaSeaWeight, eastPhilippineWeight);
  const downstreamZonal = (-0.24 * southChinaSeaWeight + 0.20 * eastPhilippineWeight) /
    Math.max(1e-6, southChinaSeaWeight + eastPhilippineWeight);

  const splitGate = 1 - smooth01((lat - 24.5) / 4.0);
  let weight = preSplitWeight * (1 - splitGate)
    + coldAirUnionWeight(preSplitWeight * 0.55, downstreamWeight) * splitGate;
  let zonalFraction = preSplitZonal * (1 - splitGate) + downstreamZonal * splitGate;

  weight *= lowLatitudeGate;
  // Land may feel the adjacent surge, but the plotted transport axis must stay over water instead
  // of presenting a fictitious north-to-south corridor through mainland China / Indochina.
  if (isLand) {
    weight *= 0.18 + 0.22 * (1 - clamp(landInterior, 0, 1));
    zonalFraction *= 0.8;
  }

  return {
    weight: clamp(weight, 0, 1),
    zonalFraction: clamp(zonalFraction, -0.36, 0.32),
    taiwanStraitWeight,
    bashiWeight,
    southChinaSeaWeight,
    eastPhilippineWeight
  };
}

function coldAirSurfaceSignal(
  lat: number, lon: number, validHour: number, anchors: ColdAirEventAnchor[],
  isLand: boolean, elevationM: number, landInterior: number
): ColdAirSurfaceSignal | null {
  let best: ColdAirSurfaceSignal | null = null;
  for (const event of anchors) {
    const { strength, centerContactHour, contactLat, contactLon } = event;
    const propagationKmh = [0, 28, 34, 40][strength];
    // The selected arrival hour remains the exact cyclone-centre encounter.  ROUND115 removes the
    // old near-zonal raster front: the edge is gently phase-shifted by longitude, with zero phase
    // error at the configured cyclone contact longitude, so timing remains exact at the storm.
    const baseFrontLat = contactLat + (centerContactHour - validHour) * propagationKmh / 111.12;
    const frontPhase = clamp(coldAirFrontPhaseDeg(lon) - coldAirFrontPhaseDeg(contactLon), -0.55, 0.55);
    const frontLat = baseFrontLat + frontPhase;
    if (frontLat < -7 || frontLat > 58) continue;

    const behindDeg = lat - frontLat;
    // A 0.55-degree leading feather occupied only ~2 cells on a 0.25-degree product and therefore
    // appeared as a guaranteed horizontal colour-step line during every outbreak.  Use a broad,
    // smooth leading transition instead. Stage-3 keeps the previously requested ~6.5-degree >=25 kt
    // core by shortening the near-uniform body while widening only the leading transition.
    const leadingFeatherDeg = [0, 2.4, 3.1, 4.0][strength];
    const bodyDepthDeg = [0, 3.4, 3.9, 4.4][strength];
    const rearFadeDeg = [1, 3.0, 3.5, 4.2][strength];
    if (behindDeg < -leadingFeatherDeg || behindDeg > bodyDepthDeg + rearFadeDeg) continue;

    let meridionalWeight = 0;
    if (behindDeg < 0) {
      meridionalWeight = 0.94 * smooth01((behindDeg + leadingFeatherDeg) / Math.max(0.01, leadingFeatherDeg));
    } else if (behindDeg <= bodyDepthDeg) {
      // The middle/rear body is at least as strong as the leading edge. This removes the old
      // bright "front line" impression while retaining a gently structured, non-uniform surge.
      const phase = clamp(behindDeg / Math.max(0.01, bodyDepthDeg), 0, 1);
      meridionalWeight = 0.94 + 0.06 * Math.sin(Math.PI * phase);
    } else {
      const fade = 1 - smooth01((behindDeg - bodyDepthDeg) / Math.max(0.01, rearFadeDeg));
      meridionalWeight = 0.94 * fade;
    }

    const pathway = coldAirPathwaySignal(lat, lon, isLand, landInterior);
    if (pathway.weight <= 0) continue;
    const latitudeGate = smooth01((lat - 5) / 6) * (1 - smooth01((lat - 52) / 7));
    // Broad, low-amplitude waves break up perfectly uniform fill without turning the outbreak
    // back into parallel streaks. Variability stays intentionally small (roughly +/-5%).
    const broadTexture = clamp(
      0.96
      + 0.035 * Math.sin((lon - 108) * 0.23 + (lat - frontLat) * 0.31 + validHour * 0.028)
      + 0.020 * Math.sin((lon - 118) * 0.11 - (lat - frontLat) * 0.19 - validHour * 0.017),
      0.90,
      1.0
    );
    const weight = clamp(meridionalWeight * pathway.weight * latitudeGate * broadTexture, 0, 1);
    if (weight < 0.012) continue;

    // The surge still weakens gradually toward lower latitudes. Marine-pathway geometry and the
    // broad trailing body control coverage; local terrain/land drag is applied below as before.
    const southProgress = smooth01((35 - lat) / 23);
    const oceanKt = [0, 24, 28, 32][strength];
    const southLoss = [0, 0.08, 0.11, 0.14][strength] * southProgress;
    const channelWeight = Math.max(pathway.taiwanStraitWeight, pathway.bashiWeight);
    const channelBoost = !isLand ? 1 + 0.06 * channelWeight : 1;
    let targetKt = Math.min(oceanKt, oceanKt * (1 - southLoss) * channelBoost);
    if (isLand) {
      const coastalKt = [0, 18, 23, 25][strength];
      const inlandFactor = 1 - 0.475 * clamp(landInterior, 0, 1);
      const elevationFactor = 1 - 0.42 * smooth01((elevationM - 100) / 1900);
      targetKt = Math.max(5.0, coastalKt * (1 - southLoss) * inlandFactor * elevationFactor);
    }

    // Flow follows the marine pathway: Bohai bends southeast, the weaker western-Japan-Sea source
    // bends southwest into the East China Sea, and the two downstream branches diverge around
    // Taiwan toward the South China Sea and the Philippine Sea respectively.
    const speed = targetKt * 0.514444;
    const zonalFrac = pathway.zonalFraction;
    const u = zonalFrac * speed;
    const v = -Math.sqrt(Math.max(0.01, 1 - zonalFrac * zonalFrac)) * speed;
    const signal = { u, v, target10mMs: speed, weight, strength } as ColdAirSurfaceSignal;
    if (!best || signal.target10mMs * signal.weight > best.target10mMs * best.weight) best = signal;
  }
  return best;
}

function stormCacheSignature(storms: ResolvedSynopticStorm[]) {
  return storms.map(({ id, state: s }) => [
    id, s.lat.toFixed(3), s.lon.toFixed(3), s.vmax.toFixed(2), s.pmin.toFixed(2),
    (s.rmw || 0).toFixed(1), (s.speed || 0).toFixed(1), (s.direction || 0).toFixed(1),
    s.ewrcState || "none", (s.ewrcProgress || 0).toFixed(3), (s.extrTransition || 0).toFixed(3),
    s.ewrcFailureMode || "none", (s.giantEyeOuterWallMemory || 0).toFixed(3),
    (s.dryAirCoreExposure || 0).toFixed(3),
    (s.structuralDamageHours || 0).toFixed(2), (s.terrainHollowCoreMemory || 0).toFixed(3),
    (s.structuralDamagePenaltyFactor ?? 1).toFixed(3), s.penaltyRecoveryActive ? 1 : 0,
    Number((s as any).forcedColdAirStrength || 0), Number((s as any).forcedColdAirArrivalHour ?? -1).toFixed(2),
    s.landed ? 1 : 0, s.dissipated ? 1 : 0,
    s.eyeType || "none", s.eyePhase || "none", (s.eyewallIntegrity || 0).toFixed(3),
    (s.eyeClearance || 0).toFixed(3), (s.eyeObstruction ?? 1).toFixed(3),
    (s.eyeAsymmetry ?? 1).toFixed(3), (s.eyewallWrapProgress || 0).toFixed(3),
    (s.eyewallOpenSectorFraction ?? 1).toFixed(3),
    ...(s.r7 ? [s.r7.ne, s.r7.se, s.r7.sw, s.r7.nw] : [0, 0, 0, 0]),
    ...(s.r10 ? [s.r10.ne, s.r10.se, s.r10.sw, s.r10.nw] : [0, 0, 0, 0]),
    ...(s.r12 ? [s.r12.ne, s.r12.se, s.r12.sw, s.r12.nw] : [0, 0, 0, 0])
  ].join(",")).join(";");
}

function meanStormRadius(quad: { ne?: number; se?: number; sw?: number; nw?: number } | undefined, fallback: number): number {
  if (!quad) return fallback;
  const vals = [quad.ne, quad.se, quad.sw, quad.nw].filter((v): v is number => Number.isFinite(v) && Number(v) > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallback;
}


function buildColdAirEventAnchors(
  typhoons: Typhoon[], initHour: number, config: SimulationConfig,
  computationCache?: SynopticComputationCache, forecastHorizonHours?: number
): ColdAirEventAnchor[] {
  const events: ColdAirEventAnchor[] = [];
  for (const typhoon of typhoons) {
    const strength = Number((typhoon as any).forcedColdAirStrength || 0) as 0 | 1 | 2 | 3;
    const arrivalHour = Number((typhoon as any).forcedColdAirArrivalHour);
    if (!strength || !Number.isFinite(arrivalHour)) continue;
    const centerContactHour = getColdAirCenterContactHour(arrivalHour);
    // Keep the legacy four-argument call visible for non-session consumers/regressions, while
    // video sessions reuse the already-materialized full forecast path.
    const contactResolved = computationCache
      ? resolveSynopticStormAtHour(typhoon, initHour, centerContactHour, config, computationCache, forecastHorizonHours)
      : resolveSynopticStormAtHour(typhoon, initHour, centerContactHour, config);
    const state = contactResolved?.state || typhoon;
    events.push({
      stormId: typhoon.id,
      strength,
      arrivalHour,
      centerContactHour,
      contactLat: state.lat,
      contactLon: state.lon
    });
  }
  return events;
}

function localStormDistanceKm(lat: number, lon: number, state: TyphoonState | Typhoon): number {
  let dlon = lon - state.lon;
  while (dlon > 180) dlon -= 360;
  while (dlon < -180) dlon += 360;
  const dx = dlon * 111.12 * Math.max(0.2, Math.cos((lat + state.lat) * 0.5 * DEG));
  const dy = (lat - state.lat) * 111.12;
  return Math.hypot(dx, dy);
}

function backgroundStormProtectionRadiusKm(state: TyphoonState | Typhoon): number {
  const rmw = Math.max(12, synopticInnerCoreRmw(state));
  const vmax = Math.max(0, state.vmax || 0);
  // ROUND115: a 5-10 m/s disturbance is not allowed to reserve the same 170-400 km protected
  // environment as a tropical storm/typhoon. Doing so suppressed ordinary background wind over a
  // huge disk and produced the grey annuli seen around weak 1007-1008 hPa lows. Operational R7 is
  // only meaningful once the cyclone can actually support 34-kt wind.
  const organization = smooth01((vmax - 7.0) / 8.0);
  const weakProtect = Math.max(45, rmw * 1.40);
  const r7 = vmax >= 13.9 ? meanStormRadius(state.r7, rmw * 4.6) : rmw * 2.2;
  const organizedProtect = Math.max(170, rmw * 4.0, r7 * 0.92);
  return weakProtect * (1 - organization) + organizedProtect * organization;
}

function backgroundRestoreGate(lat: number, lon: number, storms: ResolvedSynopticStorm[]): number {
  if (!storms.length) return 1;
  let gate = 1;
  for (const storm of storms) {
    const protect = backgroundStormProtectionRadiusKm(storm.state);
    const release = Math.max(protect + 90, protect * 1.75);
    const r = localStormDistanceKm(lat, lon, storm.state);
    gate *= smooth01((r - protect) / Math.max(30, release - protect));
  }
  return clamp(gate, 0, 1);
}

async function buildLandInteriorWeight(nx: number, ny: number, stepDeg: number, landMask: Uint8Array, signal?: AbortSignal): Promise<Float32Array> {
  const n = nx * ny;
  const dist = new Float32Array(n);
  const INF = 1e6;
  for (let k = 0; k < n; k++) dist[k] = landMask[k] ? INF : 0;
  const diag = Math.SQRT2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!landMask[k]) continue;
      let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + 1);
      if (j > 0) d = Math.min(d, dist[k - nx] + 1);
      if (i > 0 && j > 0) d = Math.min(d, dist[k - nx - 1] + diag);
      if (i + 1 < nx && j > 0) d = Math.min(d, dist[k - nx + 1] + diag);
      dist[k] = d;
    }
    if (j % 4 === 3) await yieldUi(signal);
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!landMask[k]) continue;
      let d = dist[k];
      if (i + 1 < nx) d = Math.min(d, dist[k + 1] + 1);
      if (j + 1 < ny) d = Math.min(d, dist[k + nx] + 1);
      if (i + 1 < nx && j + 1 < ny) d = Math.min(d, dist[k + nx + 1] + diag);
      if (i > 0 && j + 1 < ny) d = Math.min(d, dist[k + nx - 1] + diag);
      dist[k] = d;
    }
    if (j % 10 === 0) await yieldUi(signal);
  }
  const transitionCells = clamp(0.42 / Math.max(0.05, stepDeg), 2.0, 5.0);
  const weight = new Float32Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!landMask[k]) { weight[k] = 0; continue; }
      weight[k] = smooth01((dist[k] - 0.70) / Math.max(0.8, transitionCells - 0.70));
    }
    if (j % 16 === 15) await yieldUi(signal);
  }
  return weight;
}

async function buildCoastalBandWeight(nx: number, ny: number, landMask: Uint8Array, signal?: AbortSignal): Promise<Float32Array> {
  const n = nx * ny;
  const band = new Float32Array(n);
  const isBoundary = new Uint8Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const here = landMask[k];
      let boundary = false;
      if (i > 0 && landMask[k - 1] !== here) boundary = true;
      if (i + 1 < nx && landMask[k + 1] !== here) boundary = true;
      if (j > 0 && landMask[k - nx] !== here) boundary = true;
      if (j + 1 < ny && landMask[k + nx] !== here) boundary = true;
      if (boundary) { isBoundary[k] = 1; band[k] = 1; }
    }
    if (j % 16 === 15) await yieldUi(signal);
  }
  // One additional grid ring is enough to remove a one-cell coast outline without smearing inland
  // terrain wakes or offshore cyclone gradients.
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (isBoundary[k]) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          if (isBoundary[(j + dj) * nx + i + di]) { near = true; break; }
        }
      }
      if (near) band[k] = 0.42;
    }
    if (j % 16 === 15) await yieldUi(signal);
  }
  return band;
}

async function buildOpenOceanWeight(nx: number, ny: number, stepDeg: number, landMask: Uint8Array, signal?: AbortSignal): Promise<Float32Array> {
  const n = nx * ny;
  const inf = 1e6;
  const dist = new Float32Array(n);
  for (let k = 0; k < n; k++) dist[k] = landMask[k] ? 0 : inf;
  const diag = Math.SQRT2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      let d = dist[k];
      if (i > 0) d = Math.min(d, dist[k - 1] + 1);
      if (j > 0) d = Math.min(d, dist[k - nx] + 1);
      if (i > 0 && j > 0) d = Math.min(d, dist[k - nx - 1] + diag);
      if (i + 1 < nx && j > 0) d = Math.min(d, dist[k - nx + 1] + diag);
      dist[k] = d;
    }
    if (j % 4 === 3) await yieldUi(signal);
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      let d = dist[k];
      if (i + 1 < nx) d = Math.min(d, dist[k + 1] + 1);
      if (j + 1 < ny) d = Math.min(d, dist[k + nx] + 1);
      if (i + 1 < nx && j + 1 < ny) d = Math.min(d, dist[k + nx + 1] + diag);
      if (i > 0 && j + 1 < ny) d = Math.min(d, dist[k + nx - 1] + diag);
      dist[k] = d;
    }
    if (j % 10 === 0) await yieldUi(signal);
  }
  const out = new Float32Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (landMask[k]) { out[k] = 0; continue; }
      if (dist[k] >= inf * 0.5) { out[k] = 1; continue; }
      const distanceDeg = dist[k] * stepDeg;
      // Coastal seas retain their resolved pressure-gradient wind; the extra open-ocean support ramps
      // in smoothly after ~0.6° and reaches full strength several degrees away from meaningful land.
      out[k] = smooth01((distanceDeg - 0.6) / 3.4);
    }
    if (j % 16 === 15) await yieldUi(signal);
  }
  return out;
}

async function smoothCoastalWindVectors(
  nx: number,
  ny: number,
  coastalBandWeight: Float32Array,
  landMask: Uint8Array,
  u: Float32Array,
  v: Float32Array,
  signal?: AbortSignal
): Promise<void> {
  let srcU = new Float32Array(u);
  let srcV = new Float32Array(v);
  const dstU = new Float32Array(u);
  const dstV = new Float32Array(v);
  for (let pass = 0; pass < 2; pass++) {
    dstU.set(srcU); dstV.set(srcV);
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const coast = coastalBandWeight[k];
        if (coast <= 0.01) continue;
        let sumU = 0, sumV = 0, sumW = 0, localMax = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const q = (j + dj) * nx + i + di;
            const baseW = (!di && !dj) ? 2.2 : (Math.abs(di) + Math.abs(dj) === 1 ? 1 : 0.65);
            // ROUND110: do not smear a slow land/island vector offshore with equal weight.  The
            // continuity pass is mainly along the same surface; only a small cross-shore share is
            // retained so a coastline stays continuous without creating an oceanic low-wind tail.
            const sameSurface = landMask[q] === landMask[k];
            const crossSurfaceFactor = landMask[k] ? 0.18 : 0.06;
            const w = baseW * (sameSurface ? 1 : crossSurfaceFactor);
            sumU += srcU[q] * w;
            sumV += srcV[q] * w;
            sumW += w;
            localMax = Math.max(localMax, Math.hypot(srcU[q], srcV[q]));
          }
        }
        const blend = (pass === 0 ? 0.34 : 0.22) * coast;
        let uu = srcU[k] * (1 - blend) + (sumU / Math.max(1e-6, sumW)) * blend;
        let vv = srcV[k] * (1 - blend) + (sumV / Math.max(1e-6, sumW)) * blend;
        const sp = Math.hypot(uu, vv);
        if (sp > localMax * 1.005 && sp > 0) {
          uu *= localMax * 1.005 / sp;
          vv *= localMax * 1.005 / sp;
        }
        dstU[k] = uu;
        dstV[k] = vv;
      }
      if (j % 4 === 3) await yieldUi(signal);
    }
    srcU = new Float32Array(dstU);
    srcV = new Float32Array(dstV);
  }
  u.set(srcU); v.set(srcV);
}

async function suppressMarineArtifactBands(
  nx: number,
  ny: number,
  lon0: number,
  lat0: number,
  stepDeg: number,
  landMask: Uint8Array,
  openOceanWeight: Float32Array,
  coastalBandWeight: Float32Array,
  terrainWakeExposure: Float32Array,
  initialU: Float32Array,
  initialV: Float32Array,
  tenMeterReduction: Float32Array,
  cycloneCaptureWeight: Float32Array,
  storms: ResolvedSynopticStorm[],
  u: Float32Array,
  v: Float32Array,
  signal?: AbortSignal
): Promise<void> {
  const srcU = new Float32Array(u);
  const srcV = new Float32Array(v);
  const dstU = new Float32Array(u);
  const dstV = new Float32Array(v);
  for (let j = 2; j < ny - 2; j++) {
    const lat = lat0 + j * stepDeg;
    for (let i = 2; i < nx - 2; i++) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      const lon = wrapLon(lon0 + i * stepDeg);
      const stormGate = backgroundRestoreGate(lat, lon, storms);
      const stormBand = (1 - stormGate) * (1 - smooth01((cycloneCaptureWeight[k] - 0.82) / 0.10));
      const coastalInfluence = clamp(Math.max(1 - openOceanWeight[k], 0.7 * coastalBandWeight[k], terrainWakeExposure[k]), 0, 1);
      const artifactGate = clamp(Math.max(stormBand, 0.85 * coastalInfluence), 0, 1);
      if (artifactGate < 0.06) continue;

      const curU = srcU[k];
      const curV = srcV[k];
      const curSpeed = Math.hypot(curU, curV);
      const refU = initialU[k] * tenMeterReduction[k];
      const refV = initialV[k] * tenMeterReduction[k];
      const refSpeed = Math.hypot(refU, refV);
      if (refSpeed < 2.8 && curSpeed < 4.0 && artifactGate < 0.18) continue;

      let sumU = 0, sumV = 0, sumW = 0;
      let minSp = Infinity, maxSp = -Infinity;
      let count = 0;
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (!di && !dj) continue;
          const q = (j + dj) * nx + i + di;
          if (landMask[q]) continue;
          const dist = Math.hypot(di, dj);
          const w = 1 / (1 + dist);
          const qu = srcU[q], qv = srcV[q];
          const sp = Math.hypot(qu, qv);
          sumU += qu * w;
          sumV += qv * w;
          sumW += w;
          minSp = Math.min(minSp, sp);
          maxSp = Math.max(maxSp, sp);
          count++;
        }
      }
      if (count < 8 || sumW <= 0) continue;
      const meanU = sumU / sumW;
      const meanV = sumV / sumW;
      const meanSpeed = Math.hypot(meanU, meanV);

      const targetRefWeight = 0.58 + 0.18 * stormBand;
      let targetU = refU * targetRefWeight + meanU * (1 - targetRefWeight);
      let targetV = refV * targetRefWeight + meanV * (1 - targetRefWeight);
      const targetSpeed = Math.hypot(targetU, targetV);
      if (targetSpeed < 0.15) {
        targetU = meanU;
        targetV = meanV;
      }

      const baselineSpeed = 0.62 * refSpeed + 0.38 * meanSpeed;
      const maxDeficit = clamp(0.32 - 0.16 * stormBand - 0.10 * coastalInfluence, 0.10, 0.32);
      const maxExcess = clamp(0.38 - 0.18 * stormBand - 0.10 * coastalInfluence, 0.12, 0.38);
      let lowerBound = Math.max(0, baselineSpeed * (1 - maxDeficit) - 0.8);
      let upperBound = baselineSpeed * (1 + maxExcess) + 1.2;
      lowerBound = Math.max(lowerBound, Math.max(0, minSp - (1.5 + 1.0 * artifactGate)));
      upperBound = Math.min(upperBound, maxSp + (2.0 + 1.2 * artifactGate));
      if (!(upperBound > lowerBound + 0.05)) {
        const mid = 0.5 * (upperBound + lowerBound);
        lowerBound = Math.max(0, mid - 0.05);
        upperBound = mid + 0.05;
      }

      let nextU = curU;
      let nextV = curV;
      if (curSpeed + 0.05 < lowerBound) {
        const deficit = lowerBound - curSpeed;
        const repair = clamp((0.32 + 0.58 * artifactGate) * smooth01(deficit / Math.max(3.0, baselineSpeed * 0.26 + 2.0)), 0, 0.92);
        [nextU, nextV] = nudgeVectorToMinimumBackground(curU, curV, lowerBound, repair, targetU, targetV);
      } else if (curSpeed > upperBound + 0.05) {
        const excess = curSpeed - upperBound;
        const repair = clamp((0.28 + 0.60 * artifactGate) * smooth01(excess / Math.max(3.0, baselineSpeed * 0.28 + 2.0)), 0, 0.90);
        const cappedSpeed = upperBound;
        if (curSpeed > 0) {
          nextU = curU * (cappedSpeed / curSpeed);
          nextV = curV * (cappedSpeed / curSpeed);
        }
        nextU = nextU * (1 - repair) + targetU * repair;
        nextV = nextV * (1 - repair) + targetV * repair;
        const repairedSpeed = Math.hypot(nextU, nextV);
        if (repairedSpeed > upperBound && repairedSpeed > 0) {
          nextU *= upperBound / repairedSpeed;
          nextV *= upperBound / repairedSpeed;
        }
      }
      dstU[k] = nextU;
      dstV[k] = nextV;
    }
    if (j % 12 === 11) await yieldUi(signal);
  }
  u.set(dstU);
  v.set(dstV);
}


/**
 * Diagnoses a finite downstream terrain wake from the already-composed flow.  The local
 * Brinkman term handles air that is actually crossing a ridge; this second diagnostic carries
 * that obstruction downstream so a lee slope / island wake has a distinct wind minimum and a
 * gradual recovery instead of immediately returning to the free-stream value one grid cell later.
 *
 * The ray is traced *upstream* from every cell along the local wind vector.  Only real land
 * terrain can seed a wake, but the wake itself may extend across lower land or adjacent ocean.
 */
async function buildTerrainWakeField(
  nx: number,
  ny: number,
  lat0: number,
  stepDeg: number,
  initialU: Float32Array,
  initialV: Float32Array,
  isLand: Uint8Array,
  elevationM: Float32Array,
  localReliefM: Float32Array,
  landInteriorWeight: Float32Array,
  signal?: AbortSignal
): Promise<Float32Array> {
  const wake = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const lat = lat0 + j * stepDeg;
    const cellKmY = Math.max(2, 111.12 * stepDeg);
    const cellKmX = Math.max(2, 111.12 * stepDeg * Math.max(0.2, Math.cos(lat * DEG)));
    const rayStepKm = Math.max(8, Math.min(cellKmX, cellKmY));
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const speed = Math.hypot(initialU[k], initialV[k]);
      if (speed < 2.5) continue;
      const ux = initialU[k] / speed;
      const uy = initialV[k] / speed;
      const localElevation = elevationM[k];
      let best = 0;
      const maxWakeKm = clamp(125 + 0.9 * speed, 130, 220);
      for (let distanceKm = rayStepKm; distanceKm <= maxWakeKm + 1e-6; distanceKm += rayStepKm) {
        const x = Math.round(i - ux * distanceKm / cellKmX);
        const y = Math.round(j - uy * distanceKm / cellKmY);
        if (x < 0 || x >= nx || y < 0 || y >= ny) break;
        const q = y * nx + x;
        if (!isLand[q]) continue;
        const obstacle = Math.max(
          0,
          elevationM[q] - 0.42 * localElevation + 0.34 * localReliefM[q]
        );
        if (obstacle < 110) continue;
        const obstacleWeight = smooth01((obstacle - 110) / 1250)
          * (0.72 + 0.28 * smooth01(localReliefM[q] / 1000))
          * landInteriorWeight[q];
        const speedGate = clamp(1.12 - speed / 90, 0.48, 1.0);
        const recoveryKm = clamp(42 + 0.075 * obstacle + 0.035 * localReliefM[q], 48, 185);
        const candidate = obstacleWeight * speedGate * Math.exp(-distanceKm / recoveryKm);
        if (candidate > best) best = candidate;
      }
      wake[k] = clamp(best, 0, 0.88);
    }
    if (j % 4 === 3) await yieldUi(signal);
  }
  return wake;
}

function cachedEnvironmentState(lat: number, lon: number, config: SimulationConfig, configHash: number, simHour: number) {
  const key = `${configHash}|${simHour.toFixed(3)}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  const hit = environmentSampleCache.get(key);
  if (hit) {
    touchCache(environmentSampleCache, key, hit, ENV_CACHE_LIMIT);
    return hit;
  }
  const value = getSynopticEnvironmentState(lat, lon, config, simHour);
  touchCache(environmentSampleCache, key, value, ENV_CACHE_LIMIT);
  return value;
}

export async function buildSynopticWindField(options: SynopticWindFieldOptions): Promise<SynopticWindField> {
  const signal = options.signal;
  abortIfNeeded(signal);
  const stepDeg = options.gridResolutionDeg;
  // ROUND107: callers may shrink the halo with map zoom. Keep only the numerical halo needed by
  // pressure gradients / terrain wake instead of forcing a 6-degree off-screen solve every time.
  const minNumericalHalo = Math.max(0.9, stepDeg * 4);
  const pad = clamp(options.paddingDeg ?? 6, minNumericalHalo, 8);
  const displayCenterLon = (options.displayBounds.lonMin + options.displayBounds.lonMax) / 2;
  // ROUND108: anchor the solver lattice to global step-degree coordinates. The visible domain and
  // numerical halo are still fully covered, but adjacent video frames now reuse the exact same
  // terrain/coast sample coordinates over their overlapping area instead of shifting every grid
  // point by a fraction of a cell. Resolution and solver quality are unchanged.
  const rawLonMin = options.displayBounds.lonMin - pad;
  const rawLonMax = options.displayBounds.lonMax + pad;
  const rawLatMin = clamp(options.displayBounds.latMin - pad, -68, 68);
  const rawLatMax = clamp(options.displayBounds.latMax + pad, -68, 68);
  const lonMin = Math.floor(rawLonMin / stepDeg + 1e-9) * stepDeg;
  const lonMax = Math.ceil(rawLonMax / stepDeg - 1e-9) * stepDeg;
  const latMin = clamp(Math.floor(rawLatMin / stepDeg + 1e-9) * stepDeg, -68, 68);
  const latMax = clamp(Math.ceil(rawLatMax / stepDeg - 1e-9) * stepDeg, -68, 68);
  const nx = Math.max(3, Math.round((lonMax - lonMin) / stepDeg) + 1);
  const ny = Math.max(3, Math.round((latMax - latMin) / stepDeg) + 1);
  const n = nx * ny;
  const config = { ...DEFAULT_CONFIG, ...(options.config || options.primaryTyphoon.configSnapshot || {}) } as SimulationConfig;
  const validDate = new Date(options.startDate.getTime() + options.validHour * 3600_000);
  const month = validDate.getUTCMonth() + 1;
  options.onProgress?.(1);
  // 5.2.31: preload ETOPO 2022 at ~0.10° before any surface sample is cached.  This keeps
  // terrain resolution on the same order as the finest pressure/wind solve while retaining the
  // embedded deterministic terrain if the NOAA service is unavailable.
  await prepareHighResolutionTerrain({ lonMin, lonMax, latMin, latMax }, stepDeg, signal, (fraction) => options.onProgress?.(1 + 2 * fraction));
  abortIfNeeded(signal);
  options.onProgress?.(3);

  const allStorms = (options.typhoons.length ? options.typhoons : [options.primaryTyphoon]);
  const storms = allStorms.map((t) => resolveSynopticStormAtHour(
    t, options.initHour, options.validHour, config, options.computationCache, options.forecastHorizonHours
  )).filter((s): s is ResolvedSynopticStorm => Boolean(s));
  if (!storms.some((s) => s.id === options.primaryTyphoon.id)) {
    const primary = resolveSynopticStormAtHour(
      options.primaryTyphoon, options.initHour, options.validHour, config, options.computationCache, options.forecastHorizonHours
    );
    if (primary) storms.unshift(primary);
  }
  const coldAnchorKey = `${options.initHour.toFixed(3)}|${stringHash(JSON.stringify(config))}|${allStorms.map((t) =>
    `${t.id}:${Number((t as any).forcedColdAirStrength || 0)}:${Number((t as any).forcedColdAirArrivalHour ?? -1).toFixed(3)}`
  ).join(';')}`;
  let coldAirAnchors = options.computationCache?.coldAirAnchors.get(coldAnchorKey);
  if (!coldAirAnchors) {
    coldAirAnchors = buildColdAirEventAnchors(
      allStorms, options.initHour, config, options.computationCache, options.forecastHorizonHours
    );
    options.computationCache?.coldAirAnchors.set(coldAnchorKey, coldAirAnchors);
  }
  // 所有随机纹理都由配置种子 + 当前产品中的台风 ID 集合 + 有效时刻派生；
  // 格点坐标在 valueNoise/hash01 内继续参与哈希，因此相同输入逐次完全一致。
  const stormSeedIds = storms.map((s) => s.id).sort().join(",");
  const seedHash = stringHash(`${config.seed}|${stormSeedIds}|${options.validHour.toFixed(2)}|synoptic-5.2.31`);
  const configHash = stringHash(JSON.stringify(config));
  const cacheKey = [
    stepDeg, pad.toFixed(3), options.initHour.toFixed(3), options.validHour.toFixed(3), options.startDate.toISOString(),
    options.displayBounds.lonMin.toFixed(4), options.displayBounds.lonMax.toFixed(4),
    options.displayBounds.latMin.toFixed(4), options.displayBounds.latMax.toFixed(4), configHash,
    options.roundedClearEye === true ? "eye-enhanced-v153" : "eye-default-v152",
    stormCacheSignature(storms),
    coldAirAnchors.map((e) => `${e.stormId},${e.strength},${e.arrivalHour.toFixed(2)},${e.centerContactHour.toFixed(2)},${e.contactLat.toFixed(3)},${e.contactLon.toFixed(3)}`).join(";")
  ].join("|");
  const cached = fieldCache.get(cacheKey);
  if (cached) {
    touchCache(fieldCache, cacheKey, cached, FIELD_CACHE_LIMIT);
    options.onProgress?.(84);
    return cached;
  }

  const envSlp = new Float32Array(n);
  const envU850 = new Float32Array(n);
  const envV850 = new Float32Array(n);
  const envMeanU = new Float32Array(n);
  const envMeanV = new Float32Array(n);
  const envShearU = new Float32Array(n);
  const envShearV = new Float32Array(n);
  const envMonsoonFlow = new Float32Array(n);
  const envCrossEquatorialFlow = new Float32Array(n);
  const envMonsoonTrough = new Float32Array(n);
  const envSubtropicalHigh = new Float32Array(n);
  const envWesterly = new Float32Array(n);
  const envWesterlyTrough = new Float32Array(n);
  const envMeanFlowScore = new Float32Array(n);
  const configuredSurfaceU = new Float32Array(n);
  const configuredSurfaceV = new Float32Array(n);
  const coldAirTarget10mMs = new Float32Array(n);
  const envFlowGain = new Float32Array(n);
  const envLandPressureDelta = new Float32Array(n);
  const slp = new Float32Array(n);
  const displaySlp = new Float32Array(n);
  const initialU = new Float32Array(n);
  const initialV = new Float32Array(n);
  const backgroundSlabU = new Float32Array(n);
  const backgroundSlabV = new Float32Array(n);
  const backgroundTarget10mMs = new Float32Array(n);
  const backgroundCeiling10mMs = new Float32Array(n);
  // Maximum resolved TC-capture weight at each grid point. This lets post-solver environmental
  // land limits distinguish true background wind from a broad tropical-cyclone circulation.
  const cycloneCaptureWeight = new Float32Array(n);
  const landMask = new Uint8Array(n);
  const elevationM = new Float32Array(n);
  const localReliefM = new Float32Array(n);
  const slopeEastMPerKm = new Float32Array(n);
  const slopeNorthMPerKm = new Float32Array(n);
  const z0M = new Float32Array(n);
  const dragCoefficient = new Float32Array(n);
  const boundaryLayerDepthM = new Float32Array(n);
  const terrainPenalty = new Float32Array(n);
  const terrainDeflectX = new Float32Array(n);
  const terrainDeflectY = new Float32Array(n);
  const tenMeterReduction = new Float32Array(n);
  const turbulenceFraction = new Float32Array(n);

  // 阶段 1：读取现有环境场与真实地形/粗糙度。
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const lonUnwrapped = lonMin + i * stepDeg;
      const lon = wrapLon(lonUnwrapped);
      const env = cachedEnvironmentState(lat, lon, config, configHash, options.validHour);
      const rough = sampleSurfaceRoughness(lat, lon, Math.hypot(env.u850, env.v850), localSolarHour(validDate, lon), env.u850, env.v850, stepDeg);
      const k = j * nx + i;
      landMask[k] = rough.isLand ? 1 : 0;
      elevationM[k] = rough.elevationM;
      localReliefM[k] = rough.localReliefM;
      slopeEastMPerKm[k] = rough.slopeEastMPerKm;
      slopeNorthMPerKm[k] = rough.slopeNorthMPerKm;
      z0M[k] = rough.z0M;
      dragCoefficient[k] = rough.dragCoefficient;
      boundaryLayerDepthM[k] = rough.boundaryLayerDepthM;
      terrainPenalty[k] = rough.terrainPenalty;
      terrainDeflectX[k] = rough.terrainDeflectX;
      terrainDeflectY[k] = rough.terrainDeflectY;
      tenMeterReduction[k] = rough.tenMeterReduction;
      turbulenceFraction[k] = rough.turbulenceFraction;
      const surfaceHour = localSolarHour(validDate, lon);
      const oceanPressureAdj = environmentPressureAdjustment(env, lat, false, surfaceHour, month);
      const landPressureAdj = environmentPressureAdjustment(env, lat, true, surfaceHour, month);
      const configuredSystem = getConfiguredSystemSurfaceState(lat, lon, config, month, options.validHour);
      // Keep user-adjustable synoptic systems in the dynamical pressure field, but never introduce
      // a land/sea pressure step. Land-only thermal pressure corrections are display-only below.
      envSlp[k] = env.slp + oceanPressureAdj + configuredSystem.pressureHpa;
      envLandPressureDelta[k] = rough.isLand ? (landPressureAdj - oceanPressureAdj) : 0;
      envU850[k] = env.u850; envV850[k] = env.v850; envMeanU[k] = env.meanU; envMeanV[k] = env.meanV;
      envShearU[k] = env.shearU; envShearV[k] = env.shearV;
      envMonsoonFlow[k] = Math.max(env.scores.monsoonFlow || 0, configuredSystem.monsoon);
      envCrossEquatorialFlow[k] = env.scores.crossEquatorialFlow || 0;
      envMonsoonTrough[k] = Math.max(env.scores.monsoonTrough || 0, configuredSystem.monsoon * 0.88);
      envSubtropicalHigh[k] = Math.max(env.scores.subtropicalHigh || 0, configuredSystem.subtropicalHigh);
      envWesterly[k] = Math.max(env.scores.westerlyJet || 0, env.scores.midLatWesterlies || 0, configuredSystem.westerly);
      envWesterlyTrough[k] = Math.max(env.scores.westerlyTrough || 0, configuredSystem.westerlyTrough);
      envMeanFlowScore[k] = env.scores.meanFlow || 0;
      configuredSurfaceU[k] = configuredSystem.u10;
      configuredSurfaceV[k] = configuredSystem.v10;
      // Large-scale systems change the actual vector field. Keep the gain modest; the global
      // 4-36 kt system-aware coverage target below fills missing speed without multiplying all marine wind.
      envFlowGain[k] = clamp(
        0.995
        + 0.10 * envWesterly[k]
        + 0.06 * envMonsoonFlow[k]
        + 0.025 * envMeanFlowScore[k],
        0.98, 1.18
      );
    }
    options.onProgress?.(5 + 22 * ((j + 1) / ny));
    if (j % 4 === 3) await yieldUi(signal);
  }

  // Land-only thermal pressure corrections are deliberately excluded from the momentum pressure
  // field. Even a smoothed coast-to-interior pressure increment can generate a geostrophic speed
  // ribbon parallel to a detailed coastline. They are added back only to display MSLP after the
  // wind solve. Terrain drag still ramps one-sided after the air crosses the shore.
  const landInteriorWeight = await buildLandInteriorWeight(nx, ny, stepDeg, landMask, signal);
  const coastalBandWeight = await buildCoastalBandWeight(nx, ny, landMask, signal);
  const openOceanWeight = await buildOpenOceanWeight(nx, ny, stepDeg, landMask, signal);

  // 阶段 2：构造与气压一致的背景风并叠加台风涡旋。
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    const f = 2 * OMEGA * Math.sin(lat * DEG);
    const dx = EARTH_M_PER_DEG * stepDeg * Math.max(0.15, Math.cos(lat * DEG));
    const dy = EARTH_M_PER_DEG * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lonUnwrapped = lonMin + i * stepDeg;
      const lon = wrapLon(lonUnwrapped);
      let bgU = envU850[k] * 0.62 + envMeanU[k] * 0.38;
      let bgV = envV850[k] * 0.62 + envMeanV[k] * 0.38;
      if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1) {
        // Never switch geostrophic wind on at one exact latitude. The old |lat|>=8 branch painted
        // a perfectly horizontal seam into both stills and videos. Fade it in continuously from
        // the deep tropics and regularize f near the equator so the pressure-gradient contribution
        // approaches zero smoothly instead of appearing in one grid row.
        const absLat = Math.abs(lat);
        const geoGate = smooth01((absLat - 3.0) / 9.0);
        if (geoGate > 1e-5) {
          const dpdx = (envSlp[k + 1] - envSlp[k - 1]) * 100 / (2 * dx);
          const dpdy = (envSlp[k + nx] - envSlp[k - nx]) * 100 / (2 * dy);
          const safeLat = Math.max(5.0, absLat) * (lat < 0 ? -1 : 1);
          const fSafe = 2 * OMEGA * Math.sin(safeLat * DEG);
          let geoU = -dpdy / (RHO_AIR * fSafe);
          let geoV = dpdx / (RHO_AIR * fSafe);
          const gm = Math.hypot(geoU, geoV);
          if (gm > 46) { geoU *= 46 / gm; geoV *= 46 / gm; }
          const geoBlend = 0.36 * geoGate;
          bgU = bgU * (1 - geoBlend) + geoU * geoBlend;
          bgV = bgV * (1 - geoBlend) + geoV * geoBlend;
        }
      }
      bgU *= envFlowGain[k];
      bgV *= envFlowGain[k];

      // Product-side background-flow coverage. The preset is a 10 m target, so convert it to the
      // slab reference level before the boundary-layer solve; this prevents the later 10 m transfer
      // from silently turning a nominal 13-17 kt open-ocean target into a broad <12 kt field.
      const synopticActivity = smooth01((envFlowGain[k] - 1.03) / 0.28);
      const backgroundTexture = correlatedNoise(lat, lon, options.validHour + 17.25, seedHash ^ 0x51ed270b);
      const environmentalTarget = diagnoseSynopticEnvironmentalWindTarget({
        lat,
        lon,
        isLand: !!landMask[k],
        elevationM: elevationM[k],
        localReliefM: localReliefM[k],
        monsoonFlow: envMonsoonFlow[k],
        crossEquatorialFlow: envCrossEquatorialFlow[k],
        monsoonTrough: envMonsoonTrough[k],
        subtropicalHigh: envSubtropicalHigh[k],
        westerlyJet: envWesterly[k],
        midLatWesterlies: envWesterly[k],
        westerlyTrough: envWesterlyTrough[k],
        meanFlow: envMeanFlowScore[k],
        openOcean: openOceanWeight[k],
        month,
        backgroundTexture,
        synopticActivity
      });
      const preliminaryTransfer = clamp(tenMeterReduction[k], landMask[k] ? 0.62 : 0.83, landMask[k] ? 0.86 : 0.92);
      // User-configured subtropical high / westerlies / seasonal monsoon are specified as surface
      // systems. Convert them to the slab reference level before the boundary-layer solve.
      bgU += configuredSurfaceU[k] / Math.max(0.62, preliminaryTransfer);
      bgV += configuredSurfaceV[k] / Math.max(0.62, preliminaryTransfer);
      const desiredSlabSpeed = environmentalTarget.target10mMs / Math.max(0.58, preliminaryTransfer);
      const deficit = clamp((desiredSlabSpeed - Math.hypot(bgU, bgV)) / Math.max(1, desiredSlabSpeed), 0, 1);
      // ROUND111: the product coverage target is a far-field *minimum*, not extra cyclone energy.
      // Near a TC the resolved environmental vector remains present, but the artificial minimum-
      // speed nudge fades out. Otherwise a 25-35 kt monsoon target can be forced underneath the
      // vortex and then emerge as a long one-sided high-wind wedge after capture/blending.
      const tcBackgroundGate = backgroundRestoreGate(lat, lon, storms);
      // ROUND113: the artificial *minimum* environmental speed must disappear continuously inside
      // the cyclone-protection region. Keeping a fixed 16% ocean contribution at gate=0 allowed a
      // target-speed floor to survive underneath the vortex and re-emerge as a narrow marine wedge.
      // Use a smooth 0..1 gate instead; the real environmental vector itself is untouched.
      const minimumTargetGate = landMask[k]
        ? smooth01((tcBackgroundGate + 0.08) / 1.08)
        // ROUND114: do not let the artificial marine minimum target recover inside the outer TC
        // circulation. July monsoon targets are zonally coherent; restoring them too early can
        // paint a near-horizontal 2-kt colour-step band south of a storm even though the actual
        // environmental vector is smooth. Keep the real vector, but delay only the artificial floor.
        : smooth01((tcBackgroundGate - 0.46) / 0.46);
      [bgU, bgV] = nudgeVectorToMinimumBackground(
        bgU,
        bgV,
        desiredSlabSpeed,
        (landMask[k] ? (0.42 + 0.28 * deficit) : (0.72 + 0.24 * deficit)) * minimumTargetGate,
        envU850[k],
        envV850[k]
      );
      if (!landMask[k]) {
        // ROUND110: only marine environmental flow is hard-capped before the fluid solve. Hard
        // clipping a land/island grid cell here lets the semi-Lagrangian solver advect that low
        // momentum downstream as a long artificial blue wake. Land limits are enforced after the
        // solve, where they cannot seed an oceanic numerical plume.
        const maxEnvironmentalSlab = (environmentalTarget.ceiling10mKt * 0.514444) / Math.max(0.58, preliminaryTransfer);
        const bgSpeed = Math.hypot(bgU, bgV);
        if (bgSpeed > maxEnvironmentalSlab && bgSpeed > 0) {
          bgU *= maxEnvironmentalSlab / bgSpeed;
          bgV *= maxEnvironmentalSlab / bgSpeed;
        }
      }

      // Scheduled cold-air surge is a synoptic environmental flow, not a paint-only overlay.
      // Blend it at slab level so terrain drag, cyclone capture and the boundary-layer solver all
      // act on the same incoming northerly current.
      const coldAir = coldAirSurfaceSignal(lat, lon, options.validHour, coldAirAnchors, !!landMask[k], elevationM[k], landInteriorWeight[k]);
      if (coldAir) {
        const slabTarget = coldAir.target10mMs / Math.max(0.56, preliminaryTransfer);
        const coldMag = Math.max(1e-6, Math.hypot(coldAir.u, coldAir.v));
        const cu = coldAir.u / coldMag * slabTarget;
        const cv = coldAir.v / coldMag * slabTarget;
        const blend = clamp((0.70 + 0.09 * coldAir.strength) * coldAir.weight, 0, 0.96);
        bgU = bgU * (1 - blend) + cu * blend;
        bgV = bgV * (1 - blend) + cv * blend;
        coldAirTarget10mMs[k] = coldAir.target10mMs * coldAir.weight;
      }

      let p = envSlp[k];
      const vortexSamples: Array<{ storm: ResolvedSynopticStorm; sample: ReturnType<typeof sampleTropicalCycloneVortex> }> = [];
      for (const storm of storms) {
        const env = {
          slp: envSlp[k], shearU: envShearU[k], shearV: envShearV[k],
          westerlyStrength: envWesterly[k]
        } as Pick<SynopticEnvironmentState, "slp" | "shearU" | "shearV"> & { westerlyStrength: number };
        const vortex = sampleTropicalCycloneVortex(lat, lon, storm.state, env);
        vortexSamples.push({ storm, sample: vortex });
        p += vortex.pressureAnomalyHpa;
      }

      // Environment-to-cyclone capture is directional rather than subtractive. The old
      // bg*(1-shield)+vortex formulation literally removed environmental momentum around the storm,
      // creating an annular "vacuum cleaner" calm and flattening the side opposed to the background
      // flow. Here the incoming flow bends progressively into the vortex while keeping its speed.
      let u = bgU, v = bgV;
      for (const { storm, sample: vortex } of vortexSamples) {
        const rmw = Math.max(10, synopticInnerCoreRmw(storm.state));
        const vmax = Math.max(0, storm.state.vmax || 0);
        const organization = smooth01((vmax - 6.0) / 9.0);
        const r7 = vmax >= 13.9
          ? Math.max(rmw * 4.2, meanStormRadius(storm.state.r7, rmw * 4.8))
          : rmw * (2.15 + 1.25 * organization);
        // Weak lows only bend the local environment in a compact neighbourhood. Their old large
        // capture radius was a major source of the artificial calm/grey disk around 5-10 m/s lows.
        const captureInnerKm = rmw * (0.70 + 0.45 * organization);
        const captureOuterKm = Math.max(
          rmw * (2.35 + 2.65 * organization),
          r7 * (1.02 + 0.26 * organization)
        );
        const blended = blendEnvironmentIntoCyclone({
          backgroundU: u,
          backgroundV: v,
          vortexU: vortex.u,
          vortexV: vortex.v,
          distanceKm: vortex.distanceKm,
          captureInnerKm,
          captureOuterKm
        });
        cycloneCaptureWeight[k] = Math.max(cycloneCaptureWeight[k], blended.capture);
        u = blended.u;
        v = blended.v;
      }
      // 地表阻力必须响应复合风速而不是只看远场环境风。海面在台风眼墙处
      // 因此会进入 Powell 型高风速阻力饱和/回落，10 m 折减也随风速更新。
      const compositeSpeed = Math.hypot(u, v);
      const surfaceLocalHour = localSolarHour(validDate, lon);
      if (!landMask[k]) {
        dragCoefficient[k] = seaSurfaceDragCoefficient(compositeSpeed);
        boundaryLayerDepthM[k] = 760 - 90 * smooth01((compositeSpeed - 25) / 35);
        tenMeterReduction[k] = estimateTenMeterReduction(false, z0M[k], boundaryLayerDepthM[k], compositeSpeed, surfaceLocalHour, 0);
      } else {
        // One-sided coast transition: marine momentum crosses the shoreline first, then adjusts
        // progressively inland. This avoids a one-grid-cell fast ribbon exactly following the coast.
        const interior = landInteriorWeight[k];
        // Surface roughness begins immediately after crossing the shoreline, but terrain pressure /
        // slope forcing does not.  Using a zero roughness weight in the first land cell preserved
        // full marine wind exactly along every coastline and painted a bright "outline jet".  A
        // modest 26% first-cell land coupling gives continuous ocean -> coast -> inland decay.
        const dragInterior = 0.26 + 0.74 * interior;
        const landDepth = Math.max(boundaryLayerDepthM[k], 680 + 250 * smooth01((compositeSpeed - 8) / 28));
        // Small additional inland attenuation for the wind-field product, keeping the offshore and coastal interpolation intact.
        const landReduction = estimateTenMeterReduction(true, z0M[k], landDepth, compositeSpeed, surfaceLocalHour, localReliefM[k]) * 0.987;
        const seaDepth = 760 - 90 * smooth01((compositeSpeed - 25) / 35);
        const seaReduction = estimateTenMeterReduction(false, 0.0002, seaDepth, compositeSpeed, surfaceLocalHour, 0);
        const seaDrag = seaSurfaceDragCoefficient(compositeSpeed);
        const landDrag = dragCoefficient[k];
        dragCoefficient[k] = seaDrag * (1 - dragInterior) + landDrag * dragInterior;
        boundaryLayerDepthM[k] = seaDepth * (1 - dragInterior) + landDepth * dragInterior;
        tenMeterReduction[k] = seaReduction * (1 - dragInterior) + landReduction * dragInterior;
      }

      // 迎风高压 / 背风低压使用“背景风 + 涡旋”后的局地来流方向诊断，
      // 因而台风贴近山地时也会随真实环流换侧，而不是固定按环境风画地形阴影。
      if (landMask[k] && localReliefM[k] > 120) {
        const interior = landInteriorWeight[k];
        const flowSpeed = Math.max(0.5, compositeSpeed);
        const slopeAlongFlow = (u * slopeEastMPerKm[k] + v * slopeNorthMPerKm[k]) / flowSpeed;
        const terrainDynamicPressure = clamp(
          0.009 * slopeAlongFlow * (0.15 + 0.85 * smooth01((localReliefM[k] - 100) / 800)),
          -1.6, 1.6
        ) * interior;
        p += terrainDynamicPressure;

        // Froude 数也必须用复合来流重算：强台风大风可越山，弱背景风更容易绕流。
        const diurnal = Math.cos(((surfaceLocalHour - 14) / 24) * Math.PI * 2);
        const daytimeMixing = smooth01((diurnal + 0.45) / 1.25);
        const stabilityN = 0.009 + 0.004 * (1 - daytimeMixing);
        const barrierM = Math.max(40, Math.min(1800, 0.50 * localReliefM[k] + 0.20 * elevationM[k]));
        const froude = flowSpeed / Math.max(0.5, stabilityN * barrierM);
        terrainPenalty[k] = 0.86 * smooth01((1.02 - froude) / 0.88)
          * smooth01((localReliefM[k] - 150) / 780) * interior;
      }
      slp[k] = p;
      initialU[k] = u;
      initialV[k] = v;
      backgroundSlabU[k] = bgU;
      backgroundSlabV[k] = bgV;
      backgroundTarget10mMs[k] = environmentalTarget.target10mMs;
      backgroundCeiling10mMs[k] = environmentalTarget.ceiling10mKt * 0.514444;
    }
    options.onProgress?.(28 + 24 * ((j + 1) / ny));
    if (j % 4 === 3) await yieldUi(signal);
  }

  // Coast transition is already applied one-sided on land during the composite-wind pass.
  // Do not average drag/reduction across the shoreline: cross-shore averaging was a source of
  // coastline-following artificial wind ribbons.

  // 对每个涡旋中心做紧凑校准，使离散格点 SLP 严格保留模型 pmin，避免
  // 0.25° 采样损失数 hPa；该修正局限于内核并真实进入动力求解。
  for (const storm of storms) {
    const s = storm.state;
    const stormLon = unwrapLonAround(s.lon, displayCenterLon);
    const ci = clamp(Math.round((stormLon - lonMin) / stepDeg), 0, nx - 1);
    const cj = clamp(Math.round((s.lat - latMin) / stepDeg), 0, ny - 1);
    const ck = cj * nx + ci;
    const delta = s.pmin - slp[ck];
    const landBroadening = s.landed ? 1.06 : 1;
    const physicalCoreKm = s.landed ? Math.max(synopticInnerCoreRmw(s), 34) : synopticInnerCoreRmw(s);
    const sigmaDeg = Math.max(stepDeg * 1.8, Math.min(1.8, physicalCoreKm / 111.12 * 0.82 * landBroadening));
    const radiusCells = Math.ceil(3 * sigmaDeg / stepDeg);
    for (let jj = Math.max(0, cj - radiusCells); jj <= Math.min(ny - 1, cj + radiusCells); jj++) {
      const dyDeg = (jj - cj) * stepDeg;
      for (let ii = Math.max(0, ci - radiusCells); ii <= Math.min(nx - 1, ci + radiusCells); ii++) {
        const dxDeg = (ii - ci) * stepDeg * Math.max(0.2, Math.cos(s.lat * DEG));
        const w = Math.exp(-0.5 * (dxDeg * dxDeg + dyDeg * dyDeg) / (sigmaDeg * sigmaDeg));
        slp[jj * nx + ii] += delta * w;
      }
    }
  }
  // 多涡旋高斯校准会有很弱的尾部互扰；最后重新钉住每个中心格点，确保
  // 任意台风中心仍严格等于其状态 pmin。随后只做最低气压下限保护。
  for (const storm of storms) {
    const s = storm.state;
    const stormLon = unwrapLonAround(s.lon, displayCenterLon);
    const ci = clamp(Math.round((stormLon - lonMin) / stepDeg), 0, nx - 1);
    const cj = clamp(Math.round((s.lat - latMin) / stepDeg), 0, ny - 1);
    slp[cj * nx + ci] = s.pmin;
  }
  const deepestPmin = storms.length ? Math.min(...storms.map((s) => s.state.pmin)) : -Infinity;
  if (Number.isFinite(deepestPmin)) for (let k = 0; k < n; k++) slp[k] = Math.max(deepestPmin, slp[k]);

  // Explicit downstream terrain-memory field.  Unlike plain local roughness, this can reduce wind
  // on a lee slope / immediately offshore after crossing high terrain, then recover with distance.
  const terrainWake = await buildTerrainWakeField(
    nx, ny, latMin, stepDeg, initialU, initialV, landMask, elevationM, localReliefM, landInteriorWeight, signal
  );
  // Keep the raw upstream-land exposure only as a diagnostic for limiting numerical wake depth
  // after the solve. The actual momentum forcing below remains strongly suppressed over ocean.
  const terrainWakeExposure = new Float32Array(terrainWake);
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lon = wrapLon(lonMin + i * stepDeg);
      const stormGate = backgroundRestoreGate(lat, lon, storms);
      const oceanWakeLimiter = landMask[k] ? 1 : 0.04 * (1 - coastalBandWeight[k]);
      terrainWake[k] *= oceanWakeLimiter * (0.04 + 0.96 * stormGate);
    }
  }

  // The terrain provider resolves real relief, but a coastline cell is not a mountain face.  Feed
  // only coast-to-interior-ramped terrain forcing to the boundary-layer solver so raw ETOPO slope
  // or deflection vectors cannot create a one-cell jet hugging the shoreline.
  const solverSlopeEast = new Float32Array(n);
  const solverSlopeNorth = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (!landMask[k]) {
      terrainPenalty[k] = 0;
      continue;
    }
    const interior = landInteriorWeight[k];
    terrainPenalty[k] *= interior;
    solverSlopeEast[k] = slopeEastMPerKm[k] * interior;
    solverSlopeNorth[k] = slopeNorthMPerKm[k] * interior;
    if (interior < 0.08) {
      terrainDeflectX[k] = 0;
      terrainDeflectY[k] = 0;
    }
  }

  const primaryResolved = storms.find((s) => s.id === options.primaryTyphoon.id)?.state;
  const frameSpeed = Math.max(0, primaryResolved?.speed || 0) / 3.6;
  const frameDir = (primaryResolved?.direction || 0) * DEG;
  const frameMotion = { u: Math.sin(frameDir) * frameSpeed, v: Math.cos(frameDir) * frameSpeed };
  const solved = await solveWindBoundaryLayer({
    geometry: { nx, ny, lon0: lonMin, lat0: latMin, stepDeg },
    slpHpa: slp,
    initialU,
    initialV,
    surface: {
      dragCoefficient, boundaryLayerDepthM, terrainPenalty, terrainDeflectX, terrainDeflectY, terrainWake,
      isLand: landMask, elevationM, localReliefM, slopeEastMPerKm: solverSlopeEast, slopeNorthMPerKm: solverSlopeNorth
    },
    stormCenters: storms.map((s) => {
      const rmw = Math.max(10, synopticInnerCoreRmw(s.state));
      const r7 = meanStormRadius(s.state.r7, rmw * 4.8);
      return {
        lat: s.state.lat,
        lon: s.state.lon,
        protectionRadiusKm: clamp(Math.max(rmw * 3.4, r7 * 0.92), 150, 460)
      };
    }),
    frameMotion,
    maxIterations: stepDeg <= 0.1 ? 150 : stepDeg <= 0.125 ? 132 : stepDeg <= 0.25 ? 104 : 72,
    onProgress: options.onProgress,
    signal
  });

  const u10 = new Float32Array(n);
  const v10 = new Float32Array(n);
  const speedKt = new Float32Array(n);
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lon = wrapLon(lonMin + i * stepDeg);
      const reduction = tenMeterReduction[k];
      let uu = solved.u[k] * reduction;
      let vv = solved.v[k] * reduction;
      const speed = Math.hypot(uu, vv);
      const noise = correlatedNoise(lat, lon, options.validHour, seedHash);
      const fade = smooth01(speed / 5);
      // Do not let high roughness/turbulence on a detailed shoreline blink as a one-cell fast ribbon
      // from frame to frame. Mesoscale variability remains offshore and well inland.
      const coastalTurbulenceGate = Math.pow(1 - coastalBandWeight[k], 2);
      const factor = clamp(1 + noise * turbulenceFraction[k] * fade * coastalTurbulenceGate, 0.80, 1.20);
      uu *= factor; vv *= factor;
      const restoreGate = backgroundRestoreGate(lat, lon, storms);
      const targetBgU = backgroundSlabU[k] * reduction;
      const targetBgV = backgroundSlabV[k] * reduction;
      const targetBgSpeed = Math.hypot(targetBgU, targetBgV);
      const targetFloor = backgroundTarget10mMs[k] * (landMask[k] ? 0.96 : 0.99);
      const currentSpeed = Math.hypot(uu, vv);
      const floorRestoreGate = landMask[k]
        ? restoreGate
        : smooth01((restoreGate - 0.42) / 0.50);
      if (floorRestoreGate > 0.002 && targetBgSpeed > 0.1 && currentSpeed + 0.03 < targetFloor) {
        const deficit = clamp((targetFloor - currentSpeed) / Math.max(0.3, targetFloor), 0, 1);
        const restore = floorRestoreGate * (landMask[k] ? (0.58 + 0.28 * deficit) : (0.90 + 0.08 * deficit));
        [uu, vv] = nudgeVectorToMinimumBackground(uu, vv, targetFloor, restore, targetBgU, targetBgV);
      }
      u10[k] = uu; v10[k] = vv;
    }
  }

  // Enforce a narrow cross-shore continuity layer on the resolved vectors. This is not a wind
  // speed boost: the filter cannot exceed the local neighborhood maximum. It only removes the
  // one-grid-cell ocean/land discontinuity that otherwise appears as a pulsing coastline outline.
  await smoothCoastalWindVectors(nx, ny, coastalBandWeight, landMask, u10, v10, signal);

  // ROUND110: cap the depth of narrow island/terrain wakes over water. The semi-Lagrangian solve
  // can otherwise keep importing one slow land cell downstream for many iterations and form the
  // long blue/white tongues seen in the product. The reference is the already-composed pre-solver
  // environmental + TC vector, so this does not flatten the eye or invent wind outside the storm;
  // it only prevents a terrain wake from erasing most of the resolved marine circulation.
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      const exposure = clamp(terrainWakeExposure[k], 0, 1);
      if (exposure < 0.025) continue;
      const lon = wrapLon(lonMin + i * stepDeg);
      const stormProtection = 1 - backgroundRestoreGate(lat, lon, storms);
      const referenceU = initialU[k] * tenMeterReduction[k];
      const referenceV = initialV[k] * tenMeterReduction[k];
      const referenceSpeed = Math.hypot(referenceU, referenceV);
      if (referenceSpeed < 2.5) continue;
      const currentSpeed = Math.hypot(u10[k], v10[k]);
      // A broad far-field mountain wake may keep ~24% deficit; inside a TC circulation the allowed
      // numerical deficit is much smaller because a narrow island cannot destroy the whole vortex.
      const maxDeficit = (0.24 - 0.13 * stormProtection) * smooth01(exposure / 0.55);
      const minimumSpeed = referenceSpeed * (1 - maxDeficit);
      if (currentSpeed + 0.05 < minimumSpeed) {
        [u10[k], v10[k]] = nudgeVectorToMinimumBackground(
          u10[k], v10[k], minimumSpeed, 0.92, referenceU, referenceV
        );
      }
    }
    if (j % 16 === 15) await yieldUi(signal);
  }

  // ROUND112: remove residual post-solver marine seams / wedges that can still appear around
  // tropical cyclones and fragmented coastlines at coarser grids. The repair is reference-bounded
  // and ocean-only, so it suppresses numerical stripes without flattening the cyclone core.
  await suppressMarineArtifactBands(
    nx, ny, lonMin, latMin, stepDeg, landMask, openOceanWeight, coastalBandWeight, terrainWakeExposure,
    initialU, initialV, tenMeterReduction, cycloneCaptureWeight, storms, u10, v10, signal
  );

  // Absolute marine environmental floor requested by the product specification: 4 kt. Do not
  // apply it inside tropical-cyclone capture zones (eye / inner circulation must be allowed calm).
  // Outside those zones, a boundary-layer or coastal numerical cancellation cannot erase the
  // resolved environmental flow below 4 kt.
  const oceanEnvironmentalFloorMs = 4 * 0.514444;
  const absoluteEnvironmentalCeilingMs = 36 * 0.514444;
  const absoluteColdAirCeilingMs = 46 * 0.514444;
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lon = wrapLon(lonMin + i * stepDeg);
      const gate = backgroundRestoreGate(lat, lon, storms);
      const speed = Math.hypot(u10[k], v10[k]);

      if (landMask[k]) {
        // Land cap is deliberately restricted to far-field ENVIRONMENTAL flow. A landfalling TC
        // remains governed by its vortex + terrain/boundary-layer solution and is never clipped to
        // 12/22 kt by this background rule. The ceiling itself falls continuously with altitude
        // and relief, preserving stronger lowland wind and weaker high-mountain wind.
        const landFarGate = smooth01((gate - 0.76) / 0.22)
          * (1 - smooth01((cycloneCaptureWeight[k] - 0.02) / 0.08));
        if (landFarGate > 0.005 && speed > 0) {
          const coldAirStrength = clamp(coldAirTarget10mMs[k] / Math.max(1e-6, 22 * 0.514444), 0, 1);
          const localCeilingKt = diagnoseLandEnvironmentalWindCeilingKt({
            elevationM: elevationM[k],
            localReliefM: localReliefM[k],
            coldAirStrength,
            westerlyStrength: envWesterly[k]
          });
          const localCeiling = localCeilingKt * 0.514444;
          if (speed > localCeiling) {
            const targetSpeed = speed + (localCeiling - speed) * landFarGate;
            u10[k] *= targetSpeed / speed;
            v10[k] *= targetSpeed / speed;
          }
        }
        continue;
      }

      const refU = backgroundSlabU[k] * tenMeterReduction[k];
      const refV = backgroundSlabV[k] * tenMeterReduction[k];
      // ROUND113: remove the old gate>=0.68 / gate>0.92 switches. Those thresholds trace an exact
      // storm-centred radius and can become a visible arc/stripe after quantisation. Floor and
      // ceiling enforcement now fade in continuously and are effectively full-strength only in
      // genuine far-field environmental flow.
      const marineFloorGate = smooth01((gate - 0.42) / 0.48);
      if (marineFloorGate > 0.002 && speed < oceanEnvironmentalFloorMs) {
        [u10[k], v10[k]] = nudgeVectorToMinimumBackground(
          u10[k], v10[k], oceanEnvironmentalFloorMs, marineFloorGate, refU, refV
        );
      }
      const marineCeilingGate = smooth01((gate - 0.70) / 0.28);
      if (marineCeilingGate > 0.002 && speed > 0) {
        // This far from every tropical cyclone the vector is environmental flow. Organized
        // monsoon/westerly cells may reach 36 kt; all other marine environment is capped at 34 kt.
        // The hard global 36 kt guard remains even if a future target model is misconfigured.
        const coldAirCeiling = coldAirTarget10mMs[k] > 0.1
          ? Math.min(absoluteColdAirCeilingMs, Math.max(coldAirTarget10mMs[k], 36 * 0.514444))
          : 0;
        const localCeiling = coldAirCeiling > 0
          ? coldAirCeiling
          : Math.min(absoluteEnvironmentalCeilingMs, Math.max(oceanEnvironmentalFloorMs, backgroundCeiling10mMs[k] || (34 * 0.514444)));
        if (speed > localCeiling) {
          const targetSpeed = speed + (localCeiling - speed) * marineCeilingGate;
          u10[k] *= targetSpeed / speed;
          v10[k] *= targetSpeed / speed;
        }
      }
    }
  }

  // ROUND114: final residual-only zonal seam guard. It never smooths the composed meteorological
  // reference field; it only removes solver/post-processing residuals that are coherent along a
  // row but jump abruptly across latitude. The eye/eyewall is protected by capture/gate weighting.
  const seamEligibility = new Float32Array(n);
  const seamReferenceU = new Float32Array(n);
  const seamReferenceV = new Float32Array(n);
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (landMask[k]) continue;
      const lon = wrapLon(lonMin + i * stepDeg);
      const outerGate = smooth01((backgroundRestoreGate(lat, lon, storms) - 0.05) / 0.58);
      const coreGuard = 1 - smooth01((cycloneCaptureWeight[k] - 0.58) / 0.24);
      seamEligibility[k] = clamp(outerGate * coreGuard, 0, 1);
      seamReferenceU[k] = initialU[k] * tenMeterReduction[k];
      seamReferenceV[k] = initialV[k] * tenMeterReduction[k];
    }
  }
  suppressZonalResidualSeams({
    nx, ny, u: u10, v: v10,
    referenceU: seamReferenceU, referenceV: seamReferenceV,
    landMask, eligibility: seamEligibility
  });

  // 边界层阻力求解后执行 Vmax 一致性校准，并在内核周围平滑混合；
  // 这是求解结果到状态量的校准，而不是后处理画出的风环。
  for (const storm of storms) {
    const s = storm.state;
    if (s.dissipated || s.vmax < 5) continue;
    const stormLon = unwrapLonAround(s.lon, displayCenterLon);
    const radiusKm = Math.max(50, synopticInnerCoreRmw(s) * 3.0);
    let localMax = 0;
    for (let j = 0; j < ny; j++) {
      const lat = latMin + j * stepDeg;
      const dy = (lat - s.lat) * 111.12;
      if (Math.abs(dy) > radiusKm) continue;
      for (let i = 0; i < nx; i++) {
        const lon = lonMin + i * stepDeg;
        const dxk = (lon - stormLon) * 111.12 * Math.max(0.2, Math.cos(s.lat * DEG));
        const r = Math.hypot(dxk, dy);
        if (r <= radiusKm) localMax = Math.max(localMax, Math.hypot(u10[j * nx + i], v10[j * nx + i]));
      }
    }
    if (localMax > 0.5) {
      // ROUND115: do not carve a circular calm hole out of the environmental flow merely to force
      // a weak disturbance's total-field local maximum down to 5-10 m/s. Downward Vmax calibration
      // activates progressively only after the circulation is genuinely organized.
      const downwardCalibration = smooth01(((s.vmax || 0) - 11.5) / 10.5);
      const minimumCorrection = 1 - 0.28 * downwardCalibration;
      const correction = clamp(s.vmax / localMax, minimumCorrection, s.landed ? 1.10 : 1.42);
      for (let j = 0; j < ny; j++) {
        const lat = latMin + j * stepDeg;
        const dy = (lat - s.lat) * 111.12;
        if (Math.abs(dy) > radiusKm * 1.4) continue;
        for (let i = 0; i < nx; i++) {
          const lon = lonMin + i * stepDeg;
          const dxk = (lon - stormLon) * 111.12 * Math.max(0.2, Math.cos(s.lat * DEG));
          const r = Math.hypot(dxk, dy);
          const rmw = Math.max(8, synopticInnerCoreRmw(s));
          const coreEdge = (s.landed ? 1.28 : 1.72) * rmw;
          const outerEdge = (s.landed ? 2.35 : 3.35) * rmw;
          const w = r <= coreEdge ? 1 : 1 - smooth01((r - coreEdge) / Math.max(1, outerEdge - coreEdge));
          const factor = 1 + (correction - 1) * w;
          const k = j * nx + i;
          u10[k] *= factor; v10[k] *= factor;
        }
      }
    }
  }

  // ROUND152: strength-scaled *conditional* eyewall coherence. No complete
  // clear eye -> no change at all; storm physics and MSLP remain untouched.
  refineIntactEyewallVectors({ nx, ny, lonMin, latMin, stepDeg, landMask, u10, v10 }, storms.map(s => s.state));
  // ROUND153: OPTIONAL extra coherence / clarity; off means exactly Round152.
  if (options.roundedClearEye === true) {
    refineEnhancedEyeVectors({ nx, ny, lonMin, latMin, stepDeg, landMask, u10, v10 }, storms.map(s => s.state));
  }

  let maxWindMs = 0;
  for (let k = 0; k < n; k++) {
    const sp = Math.hypot(u10[k], v10[k]);
    maxWindMs = Math.max(maxWindMs, sp);
    speedKt[k] = sp * 1.943844;
  }

  // 仅显示使用的高地海平面订正不确定性：确定性且具有空间相关。
  // 该项绝不反馈进动量求解器。
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const lon = wrapLon(lonMin + i * stepDeg);
      let p = slp[k] + envLandPressureDelta[k] * landInteriorWeight[k] * 0.65;
      if (landMask[k] && elevationM[k] > 1200) {
        let stormSuppression = 1;
        for (const storm of storms) {
          const r = localStormDistanceKm(lat, lon, storm.state);
          const protectedRadius = Math.max(220, synopticInnerCoreRmw(storm.state) * (storm.state.landed ? 7.5 : 5.5));
          stormSuppression *= smooth01((r - protectedRadius * 0.45) / Math.max(40, protectedRadius * 0.55));
        }
        const amp = clamp((elevationM[k] - 1100) / 650, 0, 1) * 2.6 * stormSuppression;
        p += correlatedNoise(lat * 0.72, lon * 0.72, Math.floor(options.validHour / 6) * 6, seedHash ^ 0x51ed270b) * amp;
      }
      displaySlp[k] = Number.isFinite(deepestPmin) ? Math.max(deepestPmin, p) : p;
    }
  }

  // 最低气压只在最终可见地图范围内统计。
  let minMslp = Infinity;
  for (let j = 0; j < ny; j++) {
    const lat = latMin + j * stepDeg;
    if (lat < options.displayBounds.latMin - 1e-6 || lat > options.displayBounds.latMax + 1e-6) continue;
    for (let i = 0; i < nx; i++) {
      const lon = lonMin + i * stepDeg;
      if (lon < options.displayBounds.lonMin - 1e-6 || lon > options.displayBounds.lonMax + 1e-6) continue;
      minMslp = Math.min(minMslp, slp[j * nx + i]);
    }
  }

  options.onProgress?.(84);
  await yieldUi(signal);
  const result: SynopticWindField = {
    nx, ny, lon0: lonMin, lat0: latMin, stepDeg,
    computationBounds: { lonMin, lonMax, latMin, latMax },
    displayBounds: options.displayBounds,
    slpHpa: slp,
    displaySlpHpa: displaySlp,
    u10, v10, speedKt, landMask, elevationM, storms,
    diagnostics: solved.diagnostics,
    minMslp: Number.isFinite(minMslp) ? minMslp : Math.min(...Array.from(slp)),
    maxWindMs
  };
  touchCache(fieldCache, cacheKey, result, FIELD_CACHE_LIMIT);
  return result;
}
