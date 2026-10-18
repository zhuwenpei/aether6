import type { SimulationConfig, TyphoonStructureMode } from "../types";

export interface PrecipitationStateLike {
  id?: string | number;
  lat: number;
  lon: number;
  vmax: number;
  pmin?: number;
  rmw?: number;
  simHour?: number;
  direction?: number;
  speed?: number;
  landed?: boolean;
  rapidIntensifying?: boolean;
  rapidIntensificationMode?: "ri" | "eri" | "uri";
  rapidEpisodeAbortRequested?: boolean;
  intensityChange6h?: number;
  intensityChange24h?: number;
  isEyeClogged?: boolean;
  isStructureDamaged?: boolean;
  isCoreDisrupted?: boolean;
  eyeType?: "none" | "small_round" | "large_round" | "irregular" | "gap" | "eccentric" | "broken";
  eyePhase?: "none" | "forming" | "opening" | "clear" | "clouding" | "blocked" | "replacement_inner" | "replacement_double" | "replacement_new" | "ragged";
  eyeRadiusKm?: number;
  eyeClearance?: number;
  eyeObstruction?: number;
  eyewallIntegrity?: number;
  eyeAsymmetry?: number;
  eyeWarmCore?: number;
  secondaryEyewallStrength?: number;
  shear?: number;
  shearDir?: number;
  structuralState?: number;
  ewrcState?: string;
  forcedDryAir?: "core" | "periphery";
  landHours?: number;
  landContactHours?: number;
  circulationExpansion?: number;
  openOceanEnergyHours?: number;
  moistureReservoir?: number;
  dryAirIntrusion?: number;
  dryAirCoreExposure?: number;
  dryAirWrapFraction?: number;
  moistEnvelopeIntegrity?: number;
  innerCoreMoisture?: number;
  eyewallOpenSectorFraction?: number;
  deepConvectiveCoverage?: number;
  lowLevelVortexIntegrity?: number;
  postPeakEnvelopeMemory?: number;
  peakVmaxMemory?: number;
  dryAirLifecyclePhase?: "moist_protected" | "outer_wrap" | "eyewall_breach" | "asymmetric_collapse" | "residual_vortex" | "reorganizing";
  dryAirVentilationIndex?: number;
  dryAirCoreConnection?: number;
  dryAirReMoistening?: number;
  dryAirConvectiveArcBearingDeg?: number;
  eyewallColdPoolMemory?: number;
  moistCoreProtection?: number;
  drySlotBearingDeg?: number;
  rebuiltCoreDiameterKm?: number;
  convectiveSuppression?: number;
  structuralDisorganization?: number;
  cdoDiameterKm?: number;
  coldWaterExposureHours?: number;
  westerlyInteractionHours?: number;
  westerlyRainMemory?: number;
  northeastCloudTailStrength?: number;
  warmConveyorBeltStrength?: number;
  northeastCloudStripping?: number;
  llccExposure?: number;
  asymmetricReburstStrength?: number;
  asymmetricReburstBearingDeg?: number;
  ewrcStandoffStrength?: number;
  giantEyeOuterWallMemory?: number;
  brownOceanBurstIndex?: number;
  landfallOuterRainbandIndex?: number;
  coreGeometryContinuity?: number;
  dvorakTNumber?: number;
  marineMoistureLink?: number;
  binaryInteractionStrength?: number;
  binaryInducedShearKt?: number;
  binaryPartnerDistanceKm?: number;
  binaryMergerRecoveryHours?: number;
  postDryAirBurstSuppressionHours?: number;
  preStormSquallEvaluated?: boolean;
  preStormSquallStartHour?: number;
  preStormSquallDurationHours?: number;
  preStormSquallBearingOffsetDeg?: number;
  preStormSquallSpeedKmh?: number;
  structuralDamagePenaltyFactor?: number;
  structureMode?: TyphoonStructureMode;
  coreCompactness?: number;
  convectiveBurstIndex?: number;
  rainbandDominance?: number;
  outflowEfficiency?: number;
  coreRebuildScar?: number;
  terrainHollowCoreMemory?: number;
  terrainHollowCoreBearingDeg?: number;
  damageOrigin?: "none" | "terrain" | "shear_dry" | "ewrc_failure" | "mixed";
  ewrcFailureMode?: "none" | "inner_collapse_outer_stalls" | "outer_ring_fractures" | "double_eyewall_decay";
  broadMoisturePlatform?: number;
  /** 0..1 coastline/land interaction diagnosed at the cyclone centre by Engine. */
  coastalCoreInfluence?: number;
  /** Equivalent accumulated hours of normalized inner-core surface-friction/orographic work. */
  terrainFrictionWork?: number;
  /** 0..1 memory of terrain blocking beneath the inner core. */
  terrainBlockingMemory?: number;
  /** 0..1 wavenumber-1 land/sea drag asymmetry around the inner core. */
  terrainFrictionAsymmetry?: number;
  /** 0..1 sampled fraction of the RMW/inner-core circulation over land. */
  terrainCoreLandFraction?: number;
  /** 0..1 sampled fraction of the inner core over >=650 m terrain. */
  terrainMountainFraction?: number;
  /** Maximum terrain height sampled beneath the current inner core (m). */
  terrainMaxCoreElevation?: number;
  /** Bearing toward the strongest rough-land/terrain interaction. */
  terrainInteractionBearingDeg?: number;
  plainTsShelfMemory?: number;
  plainTsShelfHours?: number;
  /** Hours spent in an extratropical-transition / westerly-interaction regime. */
  etHours?: number;
  /** 0..1 continuous tropical -> subtropical -> extratropical structural transition. */
  extrTransition?: number;
  /** Stage-3 cold air destroyed the warm core; this is a non-cyclonic remnant low, never ET. */
  coldAirWarmCoreDestroyed?: boolean;
  r7?: { ne: number; se: number; sw: number; nw: number };
  r10?: { ne: number; se: number; sw: number; nw: number };
  /** Recorded landfall points; used to retain rainfall memory of a very intense landfall after surface winds weaken inland. */
  landfallRecords?: Array<{ lat: number; lon: number; vmax: number; simHour: number; region?: string }>;
}

export interface PrecipitationOptions {
  /** Optional deterministic seed, combined with the cyclone id. */
  noiseSeed?: number;
  config?: Partial<SimulationConfig>;
  isLand?: boolean;
  elevation?: number;
  distanceToLandKm?: number;
  /** Distance from this land grid point to the nearest coastline/ocean cell. */
  coastDistanceKm?: number;
  /** Local terrain gradient (metres of elevation change per kilometre, eastward). */
  terrainSlopeEast?: number;
  /** Local terrain gradient (metres of elevation change per kilometre, northward). */
  terrainSlopeNorth?: number;
  /** Unit vector from the nearest coastline toward inland, eastward component. */
  coastInlandUnitEast?: number;
  /** Unit vector from the nearest coastline toward inland, northward component. */
  coastInlandUnitNorth?: number;
}

export interface PrecipitationResult {
  rate: number;
  components: {
    outerCirculation: number;
    spiralRainband: number;
    /** Detached outer-rainband packet resolved separately for accumulation diagnostics. */
    detachedOuterRainband: number;
    connectingBand: number;
    preStormSquall: number;
    eyewall: number;
    center: number;
    fragmentedCore: number;
    convectiveBurst: number;
    extremeConvectiveCell: number;
    coreExtremeCell: number;
    bandExtremeCell: number;
    bandHyperCell: number;
    inlandExtremeCell: number;
    /** Ground-relative mesoscale training cell embedded in the post-landfall shield. */
    inlandMesoscaleTrainingCell: number;
    inlandScatteredConvection: number;
    inlandVortexRain: number;
    /** Broad inland rainfall retained by a >~380 km circulation over plains/rolling hills. */
    largeInlandCirculationRain: number;
    westerlyFrontalRain: number;
    /** Elongated northeastward stratiform/convective tail that develops gradually in the westerlies. */
    westerlyNortheastTailRain: number;
    monsoonPlume: number;
    moistureConvergence: number;
    stratiformShield: number;
    diffuseRainShield: number;
    landfallConvergence: number;
    /** Coast-normal land-sea roughness convergence / shoreline-locked inner rainband rainfall. */
    coastalFrictionConvergence: number;
    /** Localized convective node riding the coast-normal roughness-convergence zone. */
    coastalMesoscaleTrainingCell: number;
    /** Terrain-locked moist upslope rainfall. Unlike the legacy terrain multiplier this can create
     * remote rainfall when a TC outer circulation impinges on steep terrain well away from the centre. */
    terrainAnchoredRain: number;
    /** Remote outer-circulation feeder rainfall over terrain; deliberately separated from
     * local terrain-extreme permission so a remote island strip cannot become a fake 600+ core. */
    remoteTerrainFeederRain: number;
    /** Persistent low-level moisture-convergence / feeder-corridor rainfall that is ground-relative
     * enough to survive a 24 h accumulation as irregular CMA-like lobes rather than circular rings. */
    synopticConvergenceRain: number;
  };
  dominantMechanism: string;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const gauss = (x: number, sigma: number) => Math.exp(-0.5 * (x / Math.max(1e-6, sigma)) ** 2);
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const angleDelta = (a: number, b: number) => {
  const d = Math.abs(wrap360(a) - wrap360(b));
  return Math.min(d, 360 - d);
};
const blendBearing = (a: number, b: number, weightB: number) => {
  const w = clamp(weightB, 0, 1);
  const ar = wrap360(a) * Math.PI / 180;
  const br = wrap360(b) * Math.PI / 180;
  const x = (1 - w) * Math.sin(ar) + w * Math.sin(br);
  const y = (1 - w) * Math.cos(ar) + w * Math.cos(br);
  return wrap360(Math.atan2(x, y) * 180 / Math.PI);
};

function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Deterministic, spatially coherent pseudo-noise. Rainband sectors keep their
 * identity while the storm moves, then evolve gradually with simulation time.
 */
function coherentNoise(angleDeg: number, radiusKm: number, timeHour: number): number {
  const a = wrap360(angleDeg) / 360;
  const t = timeHour / 8;
  const n1 = hash01(Math.floor(a * 11) * 17.17 + Math.floor(radiusKm / 75) * 3.91 + Math.floor(t) * 7.31);
  const n2 = hash01(Math.floor(a * 23) * 5.83 + Math.floor(radiusKm / 140) * 13.7 + Math.floor(t / 2) * 2.47);
  return clamp(0.58 * n1 + 0.42 * n2);
}

const smooth01 = (v: number) => {
  const x = clamp(v);
  return x * x * (3 - 2 * x);
};

/**
 * Finite tropical-cyclone rainband geometry.
 *
 * Real TC rainbands are mesoscale arcs/complexes with finite radial extents, not logarithmic
 * spirals that can wind around the vortex indefinitely.  The previous equations used radius/rmw
 * in a linear phase term (and an older display proxy used an effectively unbounded log spiral), which
 * could create several enormous, basin-scale arms when RMW was small.  This helper instead uses
 * three finite arc families: a principal band, a secondary inner band, and a sparse distant band.
 * Each arc turns only gradually over its physically relevant radial span and fades smoothly at
 * both ends.  The distant band is deliberately weaker and more broken.
 */
interface FiniteRainbandGeometry {
  primary: number;
  secondary: number;
  distant: number;
  skeleton: number;
}

function finiteRainbandGeometry(
  rKm: number,
  bearingDeg: number,
  simHour: number,
  movementDirDeg: number,
  rmwKm: number,
  size01: number,
  disruption01 = 0
): FiniteRainbandGeometry {
  const r = Math.max(0, rKm);
  const rmw = clamp(rmwKm, 8, 140);
  const size = clamp(size01);
  const disruption = clamp(disruption01);

  const principalInner = Math.max(1.42 * rmw, 68 + 28 * size);
  const principalOuter = Math.min(500 + 80 * size, principalInner + 205 + 85 * size + 42 * disruption);
  const secondaryInner = Math.max(1.28 * rmw, 58 + 20 * size);
  const secondaryOuter = Math.min(350 + 65 * size, secondaryInner + 132 + 62 * size + 26 * disruption);
  const distantInner = Math.max(235 + 45 * size, principalOuter * 0.80);
  const distantOuter = Math.min(690 + 70 * size, distantInner + 150 + 72 * size);

  const radialWindow = (inner: number, outer: number, taper: number) => {
    if (r <= inner - taper || r >= outer + taper) return 0;
    const rise = smooth01((r - (inner - taper)) / Math.max(1, 2 * taper));
    const fall = 1 - smooth01((r - (outer - taper)) / Math.max(1, 2 * taper));
    return clamp(rise * fall);
  };
  const angularWidthDeg = (widthKm: number) =>
    clamp((widthKm / Math.max(70, r)) * 180 / Math.PI, 4.8, 18.0);

  // Logarithmic turning is bounded by the finite radial windows above. Across the whole principal
  // band the centreline normally turns ~70-150 degrees, rather than completing repeated revolutions.
  const principalTarget = wrap360(
    movementDirDeg + 132 - simHour * 3.5 -
    (92 + 22 * size + 16 * disruption) * Math.log(Math.max(0.72, r / principalInner))
  );
  const secondaryTarget = wrap360(
    movementDirDeg + 24 - simHour * 4.25 -
    (76 + 16 * size) * Math.log(Math.max(0.72, r / secondaryInner))
  );
  const distantTarget = wrap360(
    movementDirDeg + 220 - simHour * 2.1 -
    (62 + 12 * size) * Math.log(Math.max(0.76, r / distantInner))
  );

  const principalWidth = angularWidthDeg(25 + 13 * size + 8 * disruption);
  const secondaryWidth = angularWidthDeg(20 + 10 * size + 7 * disruption);
  const distantWidth = angularWidthDeg(32 + 14 * size);

  const principalTexture = 0.50 + 0.50 * coherentNoise(bearingDeg + 17, r, simHour * 0.72);
  const secondaryTexture = 0.44 + 0.56 * coherentNoise(bearingDeg + 143, r + 31, simHour * 0.80 + 2.3);
  const distantTexture = 0.26 + 0.74 * coherentNoise(bearingDeg + 257, r + 83, simHour * 0.46 + 7.1);

  const primary = radialWindow(principalInner, principalOuter, 30 + 10 * size) *
    gauss(angleDelta(bearingDeg, principalTarget), principalWidth) * principalTexture;
  const secondary = radialWindow(secondaryInner, secondaryOuter, 24 + 8 * size) *
    gauss(angleDelta(bearingDeg, secondaryTarget), secondaryWidth) * secondaryTexture;
  const distant = radialWindow(distantInner, distantOuter, 38 + 10 * size) *
    gauss(angleDelta(bearingDeg, distantTarget), distantWidth) * distantTexture;

  return {
    primary: clamp(primary, 0, 1),
    secondary: clamp(secondary, 0, 1),
    distant: clamp(distant, 0, 1),
    skeleton: clamp(Math.max(primary, 0.76 * secondary, 0.46 * distant), 0, 1)
  };
}

/**
 * Ground-relative mesoscale value noise. The field changes only gradually between
 * multi-hour frames, so accumulated rainfall preserves broken cells/gaps instead of
 * averaging every landfalling CDO back into one solid circular shield.
 */
/** Integer lattice hash: deterministic across runs; no coordinate-product aliasing. */
export function rainfallLatticeHash(x: number, y: number, t: number, seed: number): number {
  let h = (Math.trunc(seed) ^ Math.imul(x | 0, 0x9e3779b1) ^
    Math.imul(y | 0, 0x85ebca77) ^ Math.imul(t | 0, 0xc2b2ae3d)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function rainfallNoiseSeed(seed: number | string, id: string | number = ''): number {
  let h = 2166136261 | 0;
  for (const char of `${seed}|${id}`) h = (Math.imul(h ^ char.charCodeAt(0), 0x01000193)) | 0;
  return h;
}

function spatialCoherentNoise(
  xKm: number,
  yKm: number,
  timeHour: number,
  cellKm: number,
  evolutionHours: number,
  seedOffset = 0,
  runSeed = 0
): number {
  const sx = xKm / Math.max(4, cellKm);
  const sy = yKm / Math.max(4, cellKm);
  const st = timeHour / Math.max(1, evolutionHours);
  const ix = Math.floor(sx), iy = Math.floor(sy), it = Math.floor(st);
  const fx = smooth01(sx - ix), fy = smooth01(sy - iy), ft = smooth01(st - it);
  const sample = (x: number, y: number, t: number) =>
    rainfallLatticeHash(x, y, t, Math.imul(Math.round(seedOffset * 100), 2654435761) ^ runSeed);
  const frame = (t: number) => {
    const n00 = sample(ix, iy, t), n10 = sample(ix + 1, iy, t);
    const n01 = sample(ix, iy + 1, t), n11 = sample(ix + 1, iy + 1, t);
    const a = n00 * (1 - fx) + n10 * fx;
    const b = n01 * (1 - fx) + n11 * fx;
    return a * (1 - fy) + b * fy;
  };
  return clamp(frame(it) * (1 - ft) + frame(it + 1) * ft);
}

function meanRadius(r?: { ne: number; se: number; sw: number; nw: number }): number {
  if (!r) return 0;
  const values = [r.ne, r.se, r.sw, r.nw].filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Return the operational quadrant wind radius for a bearing measured clockwise from north. */
function radiusAtBearing(
  radii: { ne: number; se: number; sw: number; nw: number } | undefined,
  bearingDeg: number
): number {
  if (!radii) return 0;
  const b = wrap360(bearingDeg);
  const value = b < 90 ? radii.ne : b < 180 ? radii.se : b < 270 ? radii.sw : radii.nw;
  return Number.isFinite(value) && value > 0 ? value : 0;
}


/**
 * Operational-style Dvorak T-number proxy for simulated (non-observed) intensity.  The table is
 * the NW-Pacific/standard Dvorak CI wind calibration; interpolation is deliberately smooth so
 * structure does not jump at category boundaries.  It is a structural prior, not a rain-rate
 * conversion and not a replacement for direct observations.
 */
export function estimateDvorakTNumber(vmaxMps: number): number {
  const kt = Math.max(0, vmaxMps) * 1.943844;
  const table: Array<[number, number]> = [
    [25, 1.5], [30, 2.0], [35, 2.5], [45, 3.0], [55, 3.5], [65, 4.0], [77, 4.5],
    [90, 5.0], [102, 5.5], [115, 6.0], [127, 6.5], [140, 7.0], [155, 7.5], [170, 8.0]
  ];
  if (kt <= table[0][0]) return clamp(1.0 + (kt / table[0][0]) * 0.5, 1, 1.5);
  for (let i = 1; i < table.length; i++) {
    if (kt <= table[i][0]) {
      const [w0, t0] = table[i - 1];
      const [w1, t1] = table[i];
      return t0 + (t1 - t0) * ((kt - w0) / Math.max(1e-6, w1 - w0));
    }
  }
  return 8.0;
}


/**
 * Low-level moisture-bearing environmental flow used by the rainfall model.  This intentionally
 * mirrors the simulator's broad 850-hPa steering environment, but adds a weak warm-season
 * moisture-conveyor extension north of the formal monsoon trough.  It is not used to steer the TC;
 * it only supplies a physically interpretable background flow for moisture convergence and
 * orographic precipitation.
 */
function estimateMoistureBackgroundWind(
  lat: number,
  lon: number,
  cfg: Partial<SimulationConfig>
): { u: number; v: number } {
  let u = 0;
  let v = 0;

  if (cfg.westerliesEnabled) {
    const axis = cfg.westerliesLat ?? 31;
    const strength = cfg.westerliesStrength ?? 1;
    const transition = 8;
    if (lat > axis - transition) {
      const x = clamp((lat - (axis - transition)) / transition);
      const smooth = x * x * (3 - 2 * x);
      u += (6 + Math.max(0, lat - axis) * 1.5) * smooth * strength * 0.40;
      const troughLon = cfg.westerliesTroughLon ?? 122;
      const depth = cfg.westerliesTroughDepth ?? 0.9;
      v += Math.sin(((lon - troughLon) * Math.PI) / 35) * 4.8 * depth *
        Math.exp(-Math.pow((lat - axis) / 8, 2));
    }
  }

  if (cfg.subtropicalHighEnabled !== false) {
    const highLat = cfg.subtropicalHighLat ?? 24.5;
    const highLon = cfg.subtropicalHighLon ?? 135;
    const west = cfg.subtropicalHighWestExtent ?? 118;
    const strength = cfg.subtropicalHighStrength ?? 1.1;
    const nsSize = cfg.subtropicalHighNSSize ?? 1;
    const ewSize = cfg.subtropicalHighEWSize ?? 1;
    const dLat = lat - highLat;
    const dLon = lon > highLon ? lon - highLon : lon >= west ? 0 : lon - west;
    const latRadius = 6 * nsSize;
    const lonRadius = 15 * ewSize;
    const rSq = Math.pow(dLat / latRadius, 2) + Math.pow(dLon / lonRadius, 2);
    if (rSq < 20) {
      const rr = Math.sqrt(rSq);
      const wind = rr * Math.exp(1 - rr) * 14 * strength * 0.80;
      const angle = Math.atan2(dLat * (lonRadius / latRadius), dLon);
      u += Math.sin(angle) * wind;
      v += -Math.cos(angle) * wind;
    }
  }

  // Warm-season SCS/WNP moisture conveyor.  The simulation's formal monsoon-trough steering is
  // intentionally confined to the deep tropics; rainfall, however, can be fed by southwesterly
  // moisture far poleward of that trough.  Keep this broad and weak so the TC circulation still
  // determines the local wind direction.
  if (cfg.monsoonTroughEnabled) {
    const latGate = clamp(1 - Math.abs(lat - 20) / 15, 0, 1);
    const lonGate = clamp(1 - Math.max(0, lon - 132) / 14, 0, 1) * clamp(1 - Math.max(0, 103 - lon) / 12, 0, 1);
    const feed = latGate * lonGate;
    u += 4.8 * feed;
    v += 2.5 * feed;
  }

  // Weak trades provide a realistic easterly moisture source southeast of the subtropical high.
  const tradeGate = clamp((24 - lat) / 10, 0, 1) * clamp((lon - 118) / 22, 0, 1);
  u -= 1.8 * tradeGate;
  v += 0.35 * tradeGate;
  return { u, v };
}

/**
 * Multi-mechanism tropical-cyclone rainfall model.
 *
 * Rainfall is intentionally not a direct function of Vmax. It also responds to:
 * - current strengthening/weakening tendency;
 * - circulation size / wind radii;
 * - eye and eyewall morphology (CDO, clear eye, ragged/broken eyewall, EWRC);
 * - environmental shear and storm motion;
 * - large-scale moisture transport / monsoon feeding and dry-air intrusion;
 * - land/orographic enhancement.
 */
export function computeTyphoonPrecipitation(
  state: PrecipitationStateLike,
  targetLat: number,
  targetLon: number,
  options: PrecipitationOptions = {}
): PrecipitationResult {
  const cfg = options.config || {};
  // The same storm/seed/time always gives bit-identical noise; other seeds and
  // storm ids change the actual ground-relative rainfall patterns.
  const noiseKey = rainfallNoiseSeed(options.noiseSeed ?? cfg.seed ?? 0, state.id ?? '');
  const rainNoise = (x: number, y: number, t: number, size: number, evolve: number, offset = 0) =>
    spatialCoherentNoise(x, y, t, size, evolve, offset, noiseKey);

  const latRad = (state.lat * Math.PI) / 180;
  const dx = (targetLon - state.lon) * 111.12 * Math.max(0.2, Math.cos(latRad));
  const dy = (targetLat - state.lat) * 111.12;
  const r = Math.sqrt(dx * dx + dy * dy);
  const bearing = wrap360((Math.atan2(dx, dy) * 180) / Math.PI);
  const simHour = state.simHour || 0;
  const rmw = clamp(state.rmw || 38, 10, 120);
  const vmax = Math.max(0, state.vmax || 0);

  // Intensity is only one input. It controls convective potential but no longer
  // determines the rain footprint or cap by itself.
  const intensity = clamp((vmax - 8) / 52);
  const hurricaneCore = clamp((vmax - 28) / 38);
  const superTyCore = clamp((vmax - 50) / 22);
  const weakSystem = clamp((31 - vmax) / 22);
  // The simulator's default Vmax is treated as a Dvorak/satellite-analysis intensity.  Dvorak
  // is not a rainfall algorithm, so do NOT convert wind directly into a 24-h total.  Instead use
  // analyzed intensity as a structural prior: a 40-65 m/s vortex is unlikely to have *zero*
  // inner-core deep convection merely because one dry slot or westerly shear sector is present.
  // Observed/simulated studies also show the intensity-rain relationship is strongest in the
  // inner core and much weaker at outer radii.
  const dvorakConvectivePotential = clamp((vmax - 28) / 34);
  const dvorakMajorCorePotential = clamp((vmax - 38) / 27);

  const r7Mean = meanRadius(state.r7);
  const r10Mean = meanRadius(state.r10);
  const r7Directional = radiusAtBearing(state.r7, bearing);
  const r10Directional = radiusAtBearing(state.r10, bearing);
  const sizeFromRadii = r7Mean > 0 ? clamp((r7Mean - 120) / 330) : clamp((rmw - 20) / 65);
  const innerSize = r10Mean > 0 ? clamp((r10Mean - 45) / 150) : clamp((rmw - 18) / 55);
  const radialScale = 0.82 + 0.46 * sizeFromRadii;

  // Trend indices. A rapidly weakening but still strong cyclone can keep very
  // heavy rain because the large circulation continues converging moisture,
  // even while the compact eyewall deteriorates.
  const d6 = state.intensityChange6h ?? (state.rapidIntensifying ? 4.2 : 0);
  const d24 = state.intensityChange24h ?? d6 * 3.2;
  const strengthening = clamp(Math.max(d6 / 6.0, d24 / 22.0), 0, 1.45);
  const weakening = clamp(Math.max(-d6 / 6.0, -d24 / 22.0), 0, 1.45);
  const steady = 1 - clamp(Math.abs(d6) / 5.0);

  const humidity = clamp((cfg.humidityScale ?? 1) / 1.15, 0.35, 1.45);
  const monsoon = cfg.monsoonTroughEnabled ? 1.0 : 0.30;
  const outflow = clamp(cfg.outflowScale ?? 1, 0.25, 1.6);
  const dryStrength = clamp((cfg.dryAirStrength ?? 0) / 1.8, 0, 1);
  const forcedDry = state.forcedDryAir === "core" ? 1.0 : state.forcedDryAir === "periphery" ? 0.52 : 0;
  const shearKt = Math.max(0, state.shear || 0);
  const shearNorm = clamp((shearKt - 7) / 30);

  // South-China-Sea / monsoon-fed environments are given an explicit moisture
  // transport pathway. It changes total available moisture and rainfall area,
  // rather than simply multiplying eyewall rain.
  const inScsMoistureCorridor = state.lon >= 105 && state.lon <= 127 && state.lat >= 7 && state.lat <= 29;
  const scsFeed = inScsMoistureCorridor ? (0.22 + 0.36 * monsoon) : 0;
  let moistureTransport = clamp(
    0.48 * humidity +
    0.28 * monsoon +
    0.18 * clamp(outflow / 1.2) +
    scsFeed -
    0.22 * dryStrength -
    // The user dry-air intervention changes the engine's dry-air state gradually.  Do not also
    // remove the moisture column instantaneously here; that caused inner-core precipitation structure to remain
    // strong while the rainfall product collapsed the moment the switch was pressed.
    0.00 * forcedDry,
    0.18,
    1.55
  );
  // Preserve the environmental moisture-feed diagnosis before the inherited oceanic
  // reservoir is depleted over land.  A landfalling circulation can continue to tap a
  // low-level oceanic moisture stream even after its centre is well inland (observed in broad
  // cases), so the inland rain shield must not be governed solely by the local reservoir.
  const ambientMoistureTransport = moistureTransport;
  const moistureReservoir = clamp(state.moistureReservoir ?? 0.96, 0.02, 1.05);
  const circulationExpansion = clamp(state.circulationExpansion ?? 0, 0, 4);
  const coreCompactness = clamp(state.coreCompactness ?? (0.30 + 0.42 * hurricaneCore), 0, 1);
  const convectiveBurstIndex = clamp(state.convectiveBurstIndex ?? (state.rapidIntensifying ? 0.62 : 0.18), 0, 1);
  const rainbandDominance = clamp(state.rainbandDominance ?? (0.38 + 0.28 * (state.isStructureDamaged ? 1 : 0)), 0, 1);
  const outflowEfficiency = clamp(state.outflowEfficiency ?? clamp(outflow / 1.25), 0, 1);
  const coreRebuildScar = clamp(state.coreRebuildScar ?? 0, 0, 1);
  const terrainHollowCoreMemory = clamp(state.terrainHollowCoreMemory ?? 0, 0, 1);
  const terrainHollowCoreBearing = wrap360(state.terrainHollowCoreBearingDeg ?? state.terrainInteractionBearingDeg ?? ((state.direction ?? 300) + 90));
  const broadMoisturePlatform = clamp(state.broadMoisturePlatform ?? 0, 0, 1);
  const coastalCoreInfluence = clamp(state.coastalCoreInfluence ?? (state.landed ? 1 : 0), 0, 1);
  // 3.3.11: precipitation morphology consumes the same continuous terrain/friction diagnostics
  // that now drive structural damage in Engine. This lets a partial mountain scrape, a flat-land
  // crossing and a full mountain-core strike produce different rainfall displacement without
  // named-island rules or random morphology switches.
  const terrainFrictionWork = Math.max(0, state.terrainFrictionWork ?? 0);
  const terrainBlockingMemory = clamp(state.terrainBlockingMemory ?? 0, 0, 1);
  const terrainFrictionAsymmetry = clamp(state.terrainFrictionAsymmetry ?? 0, 0, 1);
  const terrainCoreLandFraction = clamp(state.terrainCoreLandFraction ?? (state.landed ? 0.55 : 0), 0, 1);
  const terrainMountainFraction = clamp(state.terrainMountainFraction ?? 0, 0, 1);
  const terrainMaxCoreElevation = Math.max(0, state.terrainMaxCoreElevation ?? 0);
  const terrainInteractionBearing = wrap360(state.terrainInteractionBearingDeg ?? ((state.direction ?? 300) + 90));
  const terrainFrictionExposure = clamp(terrainFrictionWork / 13.5, 0, 1);
  const physicalTerrainBreakup = clamp(
    0.24 * terrainFrictionExposure +
    0.30 * terrainBlockingMemory +
    0.24 * terrainFrictionAsymmetry * (0.35 + 0.65 * terrainCoreLandFraction) +
    0.14 * terrainMountainFraction +
    0.08 * clamp((terrainMaxCoreElevation - 450) / 1500, 0, 1),
    0, 1
  );
  const structureMode = state.structureMode || "loose_cdo";
  const dvorakTNumber = clamp(state.dvorakTNumber ?? estimateDvorakTNumber(vmax), 1, 8);
  const marineMoistureLink = clamp(state.marineMoistureLink ?? 0, 0, 1);
  const binaryInteractionStrength = clamp(state.binaryInteractionStrength ?? 0, 0, 1);
  const ewrcFailureMode = state.ewrcFailureMode || "none";
  // Environmental memory is diagnosed by the simulation engine. Keep rainfall physics
  // continuous: dry air, cold-water/westerly suppression and structural disorder reduce
  // compact deep convection first, while broad residual/stratiform rain fades more slowly.
  const dryAirIntrusion = clamp(state.dryAirIntrusion ?? Math.max(0.34 * dryStrength, 0.58 * forcedDry), 0, 1);
  const dryAirCoreExposure = clamp(state.dryAirCoreExposure ?? 0, 0, 1);
  const dryAirWrapFraction = clamp(state.dryAirWrapFraction ?? Math.min(0.7, dryAirIntrusion * 0.65), 0, 1);
  const moistEnvelopeIntegrity = clamp(state.moistEnvelopeIntegrity ?? (1 - 0.55 * dryAirWrapFraction), 0, 1);
  const innerCoreMoisture = clamp(state.innerCoreMoisture ?? (0.72 * moistureReservoir + 0.20), 0, 1);
  const eyewallOpenSectorFraction = clamp(state.eyewallOpenSectorFraction ?? (0.10 + 0.55 * dryAirCoreExposure), 0, 1);
  const deepConvectiveCoverage = clamp(state.deepConvectiveCoverage ?? (0.62 * (1 - dryAirCoreExposure) + 0.18), 0, 1);
  const lowLevelVortexIntegrity = clamp(state.lowLevelVortexIntegrity ?? 0.58, 0, 1);
  const postPeakEnvelopeMemory = clamp(state.postPeakEnvelopeMemory ?? 0, 0, 1);
  const dryAirLifecyclePhase = state.dryAirLifecyclePhase ?? "moist_protected";
  const dryAirVentilationIndex = clamp(state.dryAirVentilationIndex ?? (0.42 * dryAirIntrusion + 0.38 * shearNorm), 0, 1);
  const dryAirCoreConnection = clamp(state.dryAirCoreConnection ?? (dryAirWrapFraction * dryAirVentilationIndex * (1 - moistEnvelopeIntegrity)), 0, 1);
  const dryAirReMoistening = clamp(state.dryAirReMoistening ?? 0, 0, 1);
  const eyewallColdPoolMemory = clamp(state.eyewallColdPoolMemory ?? 0, 0, 1);
  const moistCoreProtection = clamp(state.moistCoreProtection ?? 0.55, 0, 1);
  const drySlotBearing = wrap360(state.drySlotBearingDeg ?? ((state.shearDir ?? (state.direction ?? 300)) + 145));
  const dryAirConvectiveArcBearing = wrap360(state.dryAirConvectiveArcBearingDeg ?? (drySlotBearing + 178));
  const westerlyInteractionHours = Math.max(0, state.westerlyInteractionHours ?? 0);
  const westerlyRainMemory = clamp(state.westerlyRainMemory ?? 0, 0, 1);
  const northeastCloudTailStrength = clamp(state.northeastCloudTailStrength ?? 0, 0, 1);
  const warmConveyorBeltStrength = clamp(state.warmConveyorBeltStrength ?? 0, 0, 1);
  const northeastCloudStripping = clamp(state.northeastCloudStripping ?? 0, 0, 1);
  const llccExposure = clamp(state.llccExposure ?? 0, 0, 1);
  const asymmetricReburstStrength = clamp(state.asymmetricReburstStrength ?? 0, 0, 1);
  const asymmetricReburstBearing = wrap360(state.asymmetricReburstBearingDeg ?? (state.direction ?? 300));
  const ewrcStandoffStrength = clamp(state.ewrcStandoffStrength ?? 0, 0, 1);
  const giantEyeOuterWallMemory = clamp(state.giantEyeOuterWallMemory ?? 0, 0, 1);
  const brownOceanBurstIndex = clamp(state.brownOceanBurstIndex ?? 0, 0, 1);
  const landfallOuterRainbandIndex = clamp(state.landfallOuterRainbandIndex ?? 0, 0, 1);
  const rawConvectiveSuppression = clamp(
    state.convectiveSuppression ?? (0.18 * dryAirIntrusion + 0.34 * dryAirCoreExposure + 0.22 * shearNorm),
    0, 1
  );
  // The compact tropical core is allowed to weaken in the westerlies, but inherited moisture
  // and mesoscale organization keep some deep convection alive for several additional hours.
  // The relief is deliberately small and cannot cancel a real dry-core intrusion.
  const westerlyRetentionRelief = 0.10 * westerlyRainMemory *
    clamp(Math.max(westerlyInteractionHours / 10, structureMode === "westerly_sheared" ? 0.72 : 0), 0, 1) *
    (1 - 0.72 * dryAirCoreExposure);
  const convectiveSuppression = clamp(rawConvectiveSuppression - westerlyRetentionRelief, 0, 1);

  // 2.4.16: dry-air intrusion is a *sectoral* inner-core process, not a scalar switch that
  // extinguishes precipitation everywhere inside the RMW.  Aircraft/satellite studies show
  // that a dry slot can erode one or two eyewall sectors while a humid arc on the opposite side
  // continues to support deep convection for many hours.  Diagnose the dry slot and surviving
  // moist arc once here and reuse them throughout the core/rainband physics.
  const drySlotDelta = angleDelta(bearing, drySlotBearing);
  // A connected ventilation tongue is broader and more destructive than an isolated remnant dry
  // pocket. During re-moistening the dry slot narrows/rotates, while the surviving convective arc
  // can intensify on its opposite/trailing side.
  const drySlotWidthDeg = 24 + 28 * eyewallOpenSectorFraction + 18 * dryAirWrapFraction +
    20 * dryAirCoreConnection - 10 * dryAirReMoistening;
  const drySlotLobe = gauss(drySlotDelta, clamp(drySlotWidthDeg, 18, 82));
  const dryWrapLobe = Math.max(
    gauss(angleDelta(bearing, wrap360(drySlotBearing - 68)), 42 + 18 * dryAirWrapFraction + 12 * dryAirCoreConnection),
    0.72 * gauss(angleDelta(bearing, wrap360(drySlotBearing - 132)), 56 + 22 * dryAirWrapFraction)
  );
  const moistArcBearing = dryAirConvectiveArcBearing;
  const moistArcLobe = gauss(
    angleDelta(bearing, moistArcBearing),
    54 + 18 * (1 - dryAirCoreExposure) + 14 * dryAirReMoistening
  );
  const moistArcFlanks = Math.max(
    gauss(angleDelta(bearing, wrap360(moistArcBearing + 78)), 42 + 8 * dryAirReMoistening),
    gauss(angleDelta(bearing, wrap360(moistArcBearing - 84)), 44 + 8 * dryAirReMoistening)
  );
  const dryIntrusionAzimuthalSurvival = (dryAirCoreExposure > 0.06 || dryAirWrapFraction > 0.20)
    ? clamp(
      0.92 -
      eyewallOpenSectorFraction * (0.66 + 0.32 * dryAirCoreConnection) * (0.80 * drySlotLobe + 0.20 * dryWrapLobe) +
      (0.08 + 0.16 * innerCoreMoisture + 0.12 * dryAirReMoistening) * moistArcLobe,
      0.06, 1.04
    )
    : 1;
  // 3.7.5: a humid-side arc may survive ventilation, but it is no longer allowed to become
  // *stronger than the undisturbed core*.  The uploaded White-Dolphin-like dry-air cases show an
  // area-mean collapse with only sparse retained towers, not a compensating giant hot lobe.
  const dryMoistSectorSupport = (dryAirCoreExposure > 0.06 || dryAirWrapFraction > 0.20)
    ? clamp(
      0.12 + (0.46 + 0.14 * dryAirReMoistening) * moistArcLobe +
      (0.14 + 0.08 * dryAirReMoistening) * moistArcFlanks +
      0.16 * innerCoreMoisture + 0.08 * deepConvectiveCoverage -
      (0.28 + 0.20 * dryAirCoreConnection) * eyewallOpenSectorFraction * drySlotLobe,
      0.04, 0.98
    )
    : 1;
  // 4.1.2 binary/shear structure: interaction-induced VWS displaces the strongest convection
  // without erasing the entire precipitation shield. The downshear-left quadrant receives a
  // localized boost while the opposite eyewall sector is thinned.
  const binaryShearLobe = binaryInteractionStrength > 0.04
    ? gauss(angleDelta(bearing, wrap360((state.shearDir ?? (state.direction ?? 300)) + 105)), 58)
    : 0;
  const binaryConvectiveRedistribution = clamp(
    1 - 0.34 * binaryInteractionStrength + 0.52 * binaryInteractionStrength * binaryShearLobe,
    0.54, 1.22
  );

  // Ventilation is also a basin-mean thermodynamic penalty. Keep the directional dry slot, but
  // apply a lifecycle-dependent mean retention so a strongly connected dry tongue weakens the
  // whole inner core before any small-core rebuilding can begin.
  const dryCoreLifecycleRetention = (() => {
    if (dryAirCoreExposure <= 0.06 && dryAirWrapFraction <= 0.20) return 1;
    const connectedDamage = clamp(
      0.46 * dryAirCoreExposure + 0.30 * dryAirCoreConnection + 0.18 * eyewallOpenSectorFraction +
      0.12 * dryAirVentilationIndex - 0.20 * dryAirReMoistening,
      0, 1
    );
    const moistureKeep = clamp(0.52 * innerCoreMoisture + 0.34 * deepConvectiveCoverage + 0.14 * moistCoreProtection, 0, 1);
    if (dryAirLifecyclePhase === "outer_wrap") return clamp(0.90 - 0.22 * connectedDamage + 0.06 * moistureKeep, 0.72, 0.98);
    if (dryAirLifecyclePhase === "eyewall_breach") return clamp(0.74 - 0.30 * connectedDamage + 0.10 * moistureKeep, 0.46, 0.88);
    if (dryAirLifecyclePhase === "asymmetric_collapse") return clamp(0.30 + 0.24 * moistureKeep - 0.16 * connectedDamage, 0.20, 0.56);
    if (dryAirLifecyclePhase === "residual_vortex") return clamp(0.22 + 0.22 * moistureKeep - 0.12 * connectedDamage, 0.16, 0.46);
    if (dryAirLifecyclePhase === "reorganizing") return clamp(0.32 + 0.34 * dryAirReMoistening + 0.16 * moistureKeep - 0.10 * connectedDamage, 0.28, 0.76);
    return clamp(0.86 - 0.28 * connectedDamage + 0.08 * moistureKeep, 0.58, 0.98);
  })();
  // Remove the portion of the scalar suppression that is already represented by the explicit
  // dry slot.  Shear/cold/westerly/other suppression remains basin-wide, but dry air itself no
  // longer double-penalizes the surviving humid eyewall arc.
  const nonDryConvectiveSuppression = clamp(
    convectiveSuppression -
    0.14 * dryAirIntrusion -
    0.38 * dryAirCoreExposure -
    0.16 * dryAirCoreConnection -
    0.08 * dryAirVentilationIndex,
    0, 1
  );

  // 3.7.2 dry-air morphology: ventilation is a process, not an instantaneous scalar dimmer.
  // The outer envelope first contracts and opens a dry-side gap, then the connected dry tongue can
  // breach/fragment the core. During re-moistening, a compact convective arc returns before the broad
  // rain shield fills back in. All factors below are continuous in the prognosed dry-air state.
  const dryEnvelopeDamage = clamp(
    0.42 * dryAirWrapFraction + 0.32 * dryAirCoreConnection + 0.24 * dryAirCoreExposure +
      0.12 * dryAirVentilationIndex - 0.24 * dryAirReMoistening,
    0, 1
  );
  const dryEnvelopeContraction = clamp(
    1 - 0.24 * dryAirWrapFraction - 0.16 * dryAirCoreConnection - 0.08 * dryAirCoreExposure +
      0.10 * dryAirReMoistening,
    0.56, 1.05
  );
  const dryOuterSectorSurvival = clamp(
    1 - dryEnvelopeDamage * (0.62 * drySlotLobe + 0.20 * dryWrapLobe) +
      (0.10 + 0.22 * dryAirReMoistening) * moistArcLobe,
    0.12, 1.16
  );
  const dryBandSectorSurvival = clamp(
    1 - dryEnvelopeDamage * (0.78 * drySlotLobe + 0.24 * dryWrapLobe) +
      (0.16 + 0.34 * dryAirReMoistening) * moistArcLobe + 0.10 * moistArcFlanks,
    0.06, 1.24
  );
  const dryRebuildCompactness = dryAirLifecyclePhase === "reorganizing"
    ? clamp(0.48 + 0.52 * dryAirReMoistening, 0.48, 1)
    : 1;

  const structuralDisorganization = clamp(
    state.structuralDisorganization ?? Math.max(state.landed ? clamp((state.landHours ?? 0) / 14) : 0, state.isCoreDisrupted ? 0.72 : state.isStructureDamaged ? 0.42 : 0),
    0,
    1
  );
  const postDryBurstSuppression = clamp((state.postDryAirBurstSuppressionHours ?? 0) / 48, 0, 1);
  const landHours = Math.max(0, state.landHours ?? (state.landed ? 1 : 0));

  // 2.4.15: rainfall has memory of the intensity and organization *at landfall*. A 60-70 m/s
  // typhoon does not instantly acquire the rainfall structure of a 25-30 m/s tropical storm just
  // because the surface wind decays rapidly over land. Retrieve the latest landfall record that
  // has already occurred and let its thermodynamic/inner-core imprint decay on a slower 12-28 h
  // timescale. This memory affects rainfall only; it does not hold Vmax artificially high.
  const latestLandfallRecord = state.landed && state.landfallRecords?.length
    ? [...state.landfallRecords]
        .filter((rec) => rec.simHour <= simHour + 0.05)
        .sort((a, b) => b.simHour - a.simHour)[0]
    : undefined;
  const landfallVmax = latestLandfallRecord?.vmax ?? vmax;
  const landfallIntensityClass = clamp((landfallVmax - 32.7) / 35.0, 0, 1);
  const landfallCoreVmaxMemory = state.landed
    ? Math.max(vmax, landfallVmax * Math.exp(-landHours / (15.5 + 3.5 * sizeFromRadii)))
    : vmax;
  const landfallRainMemory = state.landed
    ? landfallIntensityClass * Math.exp(-Math.max(0, landHours - 2.0) / (30 + 10 * sizeFromRadii))
    : 0;
  const rememberedRainVmax = state.landed
    ? Math.max(vmax, 17.5 + Math.max(0, landfallVmax - 17.5) * Math.exp(-landHours / (32 + 10 * sizeFromRadii)))
    : vmax;
  const rememberedRainIntensity = clamp((rememberedRainVmax - 8) / 52);
  const rememberedHurricaneCore = clamp((rememberedRainVmax - 28) / 38);
  const rememberedSuperTyCore = clamp((rememberedRainVmax - 50) / 22);
  // 3.3.23 intensity-to-area separation. Broad landfall rain support reaches most of its usable
  // amplitude by the mid/upper-50 m/s range and then saturates; additional super-typhoon wind
  // primarily increases compact convective-cell potential rather than the areal mean rain rate.
  const coastalBroadIntensitySupport = smooth01(clamp((rememberedRainVmax - 39) / 19, 0, 1));
  const superTyRainLocalization = smooth01(clamp((rememberedRainVmax - 59) / 11, 0, 1));

  // 3.7.5 inner-core rain-size regime. Rapid intensification strengthens a *compact* eyewall /
  // hot-tower population; it does not unlock a large filled high-rate disk. Observational size-RI
  // studies show that smaller RMW/inner-core size is more favourable for RI, while the outer cloud
  // canopy/circulation can evolve much more independently.
  const rapidCompactRainSupport = state.rapidIntensifying
    ? clamp(0.42 + 0.34 * coreCompactness + 0.24 * convectiveBurstIndex, 0, 1)
    : 0;
  const extremeCoreIntensitySupport = smooth01(clamp((rememberedRainVmax - 55.5) / 7.0, 0, 1));
  const largeInnerCoreHeavyRainSupport = clamp(
    extremeCoreIntensitySupport * (0.84 + 0.16 * (1 - coreCompactness)),
    0, 1
  );
  const moderateCompactCoreSupport = clamp(Math.max(
    (1 - largeInnerCoreHeavyRainSupport) *
      smooth01(clamp((rememberedRainVmax - 42) / 14, 0, 1)) *
      coreCompactness * (1 - 0.55 * rainbandDominance),
    rapidCompactRainSupport * (0.72 + 0.28 * coreCompactness)
  ), 0, 1);
  const broadDenseCoreRainEfficiency = clamp(
    0.38 + 0.62 * largeInnerCoreHeavyRainSupport + 0.16 * moderateCompactCoreSupport,
    0.38, 1.04
  );

  // Landfall does not switch deep convection off.  A coherent typhoon / super-typhoon can
  // carry its moist inner core across the shoreline for many hours while the surface wind starts
  // weakening.  Keep the initial core-rain memory longer for a still-intact, moist cyclone; only
  // after that grace period does loss of ocean enthalpy progressively dominate.
  const plainsMarineSupportedCore = state.landed && structureMode === "landfall_intact_cdo" &&
    marineMoistureLink > 0.16 && terrainMountainFraction < 0.18 && terrainBlockingMemory < 0.36 &&
    lowLevelVortexIntegrity > 0.50;
  const coherentStrongLandfallCore = landfallCoreVmaxMemory >= 41.5 && dryAirCoreExposure < 0.34 && convectiveSuppression < 0.48 &&
    deepConvectiveCoverage > 0.38 && eyewallOpenSectorFraction < 0.48 && innerCoreMoisture > 0.42 &&
    physicalTerrainBreakup < 0.24 && !state.isCoreDisrupted && (!state.isStructureDamaged || plainsMarineSupportedCore) &&
    !["dry_leaf", "incense_coil", "westerly_sheared", "landfall_disintegrating", "rainband_dominant"].includes(structureMode);
  // 3.7.4: rainfall organisation decays more slowly than surface wind after landfall.
  // Keep a moist residual core alive for roughly the first half day on ordinary low-relief land,
  // then decay it gradually. High terrain / severe structural damage can still shorten this memory.
  const landCoreHoldHours = (coherentStrongLandfallCore ? 22.0 : 17.0) * (1 - 0.34 * physicalTerrainBreakup);
  const landCoreDecayTau = (52.0 + 24.0 * moistureReservoir) + (coherentStrongLandfallCore ? 12.0 : 0);
  const earlyLandfallHold = state.landed
    ? (1 - (coherentStrongLandfallCore ? 0.025 : 0.045) * smooth01(landHours / landCoreHoldHours))
    : 1;
  const postLandCoreDecay = state.landed
    ? Math.exp(-Math.max(0, landHours - landCoreHoldHours) / landCoreDecayTau)
    : 1;
  const landConvectiveMemory = state.landed
    ? clamp(earlyLandfallHold * postLandCoreDecay, coherentStrongLandfallCore ? 0.28 : 0.18, 1)
    : 1;
  const breakupDelay = coherentStrongLandfallCore ? 1.1 : 0;
  const breakupClock = Math.max(0, landHours - breakupDelay);
  const landEnvironmentDamage = clamp(
    0.42 * physicalTerrainBreakup + 0.20 * structuralDisorganization + 0.16 * shearNorm +
      0.14 * dryAirCoreExposure + 0.08 * nonDryConvectiveSuppression,
    0, 1
  );
  const moistFlatLandRetention = clamp(
    (1 - physicalTerrainBreakup) * (0.52 + 0.48 * moistureReservoir) *
      (1 - 0.52 * dryAirCoreExposure) * (1 - 0.34 * shearNorm),
    0, 1
  );
  const landfallDispersal = state.landed
    ? clamp(
      0.12 * smooth01((breakupClock - 2.0) / 12.0) * (1 - 0.70 * moistFlatLandRetention) +
      0.56 * physicalTerrainBreakup + 0.30 * structuralDisorganization +
      0.16 * dryAirCoreExposure + 0.10 * shearNorm,
      0, 0.94
    )
    : 0;
  // Time over land alone no longer hollows the core into a ring. Breakup needs an actual structural,
  // terrain, shear or dry-air driver. A moist vortex over warm low-relief land can therefore keep
  // irregular deep convection for a day or longer while individual cells continually redevelop.
  const landBreakupProgress = state.landed
    ? clamp(
      0.10 * smooth01((breakupClock - 2.5) / 14.0) * (1 - 0.78 * moistFlatLandRetention) +
      0.58 * landEnvironmentDamage + 0.22 * structuralDisorganization,
      0, 0.92
    )
    : 0;
  const groundXKm = targetLon * 96.0;
  const groundYKm = targetLat * 111.12;
  const landCellNoise = rainNoise(groundXKm, groundYKm, simHour, 108, 13.0, 211.3);
  const landFineNoise = rainNoise(groundXKm, groundYKm, simHour, 62, 8.5, 701.9);
  const landBroadNoise = rainNoise(groundXKm, groundYKm, simHour, 168, 20.0, 411.7);
  // Heavy inland convection occupies coherent cells/arcs with genuine dry gaps. A low floor is
  // retained so light/moderate stratiform rain remains continuous, but the strong-convective mask
  // can fall much lower than in 3.3.6 and therefore cannot average into one huge solid inland CDO.
  const landConvectiveSeed = clamp(0.58 * landCellNoise + 0.30 * landFineNoise + 0.12 * landBroadNoise, 0, 1);
  const landConvectivePatch = clamp(0.10 + 0.98 * smooth01((landConvectiveSeed - 0.34) / 0.52), 0.08, 1.06);
  const landConvectiveMask = state.landed
    ? (1 - landBreakupProgress) + landBreakupProgress * landConvectivePatch
    : 1;
  const landBroadPatch = clamp(0.70 + 0.30 * Math.pow(landBroadNoise, 1.10), 0.64, 1.0);
  const landBroadRainMask = state.landed
    ? (1 - 0.46 * landBreakupProgress) + 0.46 * landBreakupProgress * landBroadPatch
    : 1;
  // Open-ocean mature CDOs are normally ~100-150 km, but Engine deliberately allows a
  // near-coast small-core (~45-95 km) or broad/asymmetric (~125-180 km) regime.
  const cdoDiameterKm = clamp(state.cdoDiameterKm ?? 120, 38, 185);
  const rebuiltCoreDiameterKm = clamp(state.rebuiltCoreDiameterKm ?? 0, 0, 50);
  // Marine surface fluxes replenish the column continuously over water. After landfall the
  // inherited reservoir matters, but a still-strong/broad vortex can keep importing low-level
  // moisture from the adjacent ocean and environmental flow for many hours. 2.4.16 allowed the
  // local reservoir to drive this factor almost to zero; in a 24-h landfall product that erased
  // nearly all inland rain even while Vmax remained typhoon strength. Keep a physically bounded
  // advected-moisture floor that is strongest for large, intense and near-coastal residual vortices.
  const localCoastDistanceForMoisture = Math.max(0, options.coastDistanceKm ?? 999);
  const residualStrongVortexMoistureGate = state.landed
    ? clamp((vmax - 18) / 30, 0, 1) * (0.58 + 0.42 * sizeFromRadii)
    : 0;
  const advectedLandMoistureFloor = state.landed
    ? clamp(
      0.34 +
      0.22 * clamp(ambientMoistureTransport / 1.20, 0, 1) +
      0.13 * sizeFromRadii +
      0.19 * Math.exp(-localCoastDistanceForMoisture / (390 + 95 * sizeFromRadii)) +
      0.13 * residualStrongVortexMoistureGate +
      0.22 * marineMoistureLink,
      0.36,
      0.96
    )
    : 0;
  const reservoirSupplyFactor = state.landed
    ? Math.max(0.14 + 0.86 * moistureReservoir, advectedLandMoistureFloor)
    : (0.78 + 0.22 * moistureReservoir);
  moistureTransport *= reservoirSupplyFactor;
  moistureTransport *= 1.0 + 0.24 * broadMoisturePlatform;
  // Dry air is handled azimuthally by the slot/moist-arc fields.  Only the non-dry part of
  // the environmental stress should suppress the whole moisture transport column.  A mild,
  // continuous dry-air reduction remains, but there is no instantaneous basin-wide collapse.
  moistureTransport *= 1.0 - 0.30 * nonDryConvectiveSuppression;
  moistureTransport *= 1.0 - 0.08 * dryAirIntrusion;

  const integrity = clamp(state.eyewallIntegrity ?? (0.60 + 0.26 * hurricaneCore), 0.08, 1);
  const dvorakHealthyMorphology = !state.landed && dvorakTNumber >= 5.0 &&
    physicalTerrainBreakup < 0.18 && dryAirCoreExposure < 0.46 && eyewallOpenSectorFraction < 0.38 &&
    shearNorm < 0.62 && coreRebuildScar < 0.48 &&
    !["ewrc_double", "failed_ewrc_standoff", "failed_eye_opening", "sheared_convective_burst",
      "binary_interaction_sheared", "dry_leaf", "incense_coil", "terrain_hollow_bands",
      "terrain_hollow_fragmented_eyewall", "landfall_broken_eyewall", "subtropical_cyclone", "extratropical_transition",
      "extratropical_cyclone"].includes(structureMode);
  const dvorakMajorMorphology = smooth01((dvorakTNumber - 5.7) / 1.3);
  let asymmetry = clamp(state.eyeAsymmetry ?? (0.12 + 0.45 * shearNorm), 0, 1);
  if (dvorakHealthyMorphology) {
    asymmetry = Math.min(asymmetry, 0.30 - 0.18 * dvorakMajorMorphology);
  }
  let obstruction = clamp(
    Math.max(
      state.eyeObstruction ?? 0,
      state.isEyeClogged ? 0.78 : 0,
      state.isStructureDamaged || state.isCoreDisrupted ? 0.58 : 0,
      outflow < 0.72 ? (0.72 - outflow) * 1.5 : 0
    )
  );
  if (dvorakHealthyMorphology) {
    obstruction = Math.min(obstruction, 0.40 - 0.25 * dvorakMajorMorphology);
  }
  // Structural damage does not simply "turn rain off". A disrupted core transfers a larger
  // fraction of convergence and condensational heating from a compact eyewall into asymmetric
  // inner rainbands / stratiform precipitation. As organization recovers, the compact eyewall
  // progressively regains that share. The engine's structuralDamagePenaltyFactor is 1 when intact.
  const damageSeverity = clamp(Math.max(
    state.isCoreDisrupted ? 0.82 : 0,
    state.isStructureDamaged ? 0.48 : 0,
    1 - (state.structuralDamagePenaltyFactor ?? 1),
    0.74 * coreRebuildScar,
    0.90 * terrainHollowCoreMemory,
    0.52 * (1 - integrity),
    // Keep rainfall structure coupled to the continuously integrated surface interaction.
    // A glancing mountain encounter therefore leaves a partial scar even if the pressure centre
    // never spends a full simulation step over land.
    0.92 * physicalTerrainBreakup
  ));
  // A genuinely intact intense inner core should concentrate deep convection around the eye /
  // tightly wrapped inner bands.  Keep this separate from the environmental asymmetry terms so a
  // random rainband lobe cannot become the default rainfall centre of a 60-70 m/s cyclone.
  const organizedIntactCore = clamp(
    clamp(((state.landed ? landfallCoreVmaxMemory : vmax) - 36) / 24, 0, 1) * integrity * (0.56 + 0.44 * coreCompactness) *
    (1 - 0.78 * damageSeverity) * (1 - 0.72 * convectiveSuppression) *
    (0.42 + 0.58 * deepConvectiveCoverage) * (1 - 0.58 * eyewallOpenSectorFraction),
    0, 1
  );
  // A dry-intruded storm is no longer "intact", but it can still possess a powerful residual
  // eyewall/CDO arc.  Keep a separate survival index so 45-60 m/s dry-leaf storms do not become
  // nearly rain-free simply because their symmetric-core score collapses.
  const dryIntrudedCoreSurvival = clamp(
    clamp(((state.landed ? landfallCoreVmaxMemory : vmax) - 27) / 29, 0, 1) *
    (0.34 + 0.66 * integrity) * (0.34 + 0.66 * moistCoreProtection) *
    (0.26 + 0.74 * innerCoreMoisture) * (0.28 + 0.72 * deepConvectiveCoverage) *
    (1 - 0.42 * nonDryConvectiveSuppression) *
    (dryAirCoreExposure > 0.08 || dryAirLifecyclePhase !== "moist_protected" ? 1 : 0),
    0, 1
  );
  // Residual-core rainfall persistence is intentionally distinct from *wind* persistence.
  // A dry-intruded or partially broken typhoon can still have a vigorous humid eyewall arc and
  // a compact moist core after landfall even when symmetric-core metrics have collapsed. This
  // term prevents the land-time breakup masks from multiplying together and deleting that rain.
  const residualLandCorePersistence = state.landed
    ? clamp(
      Math.max(
        organizedIntactCore,
        dryIntrudedCoreSurvival,
        clamp((Math.max(vmax, landfallCoreVmaxMemory) - 28) / 30, 0, 1) *
          (0.32 + 0.68 * integrity) * (0.42 + 0.58 * moistCoreProtection)
      ) *
      (0.58 + 0.42 * clamp(ambientMoistureTransport / 1.20, 0, 1)) *
      Math.exp(-Math.max(0, landHours - 18) / 45),
      0,
      1
    )
    : 0;
  const coreMoistureSupply = clamp(
    moistureTransport *
    (dryAirCoreExposure > 0.08
      ? (0.78 + 0.36 * moistArcLobe + 0.12 * moistArcFlanks - 0.34 * dryAirCoreExposure * drySlotLobe)
      : 1),
    0.08, 1.70
  );
  const organizedCoreBroadSuppression = 1 - 0.25 * organizedIntactCore;

  const movementDir = wrap360(state.direction ?? 300);
  const movementSpeed = clamp((state.speed ?? 15) / 38, 0, 1.45);
  const sectorNoise = coherentNoise(bearing, r, simHour);

  // Diagnose a low-level moisture-bearing wind at the target point. This is used by both
  // topographic rainfall and persistent moisture-convergence lobes. The cyclone wind is a
  // compact Holland-like approximation: strong near the RMW, broad in a large circulation, and
  // progressively less dominant outside the operational force-7 radius.
  const bearingRadForFlow = bearing * Math.PI / 180;
  const radialOutEast = Math.sin(bearingRadForFlow);
  const radialOutNorth = Math.cos(bearingRadForFlow);
  const tangentEastFlow = -Math.cos(bearingRadForFlow);
  const tangentNorthFlow = Math.sin(bearingRadForFlow);
  const rSafe = Math.max(4, r);
  const outerReferenceRadius = Math.max(165, r7Directional || r7Mean || (220 + 90 * sizeFromRadii));
  const tangentialCore = rSafe <= rmw
    ? vmax * Math.pow(rSafe / Math.max(6, rmw), 0.72)
    : vmax * Math.pow(Math.max(6, rmw) / rSafe, 0.60);
  const outerWindRetention = rSafe <= outerReferenceRadius
    ? 1
    : Math.exp(-(rSafe - outerReferenceRadius) / (230 + 90 * sizeFromRadii));
  const tcTangentialMs = Math.max(0, tangentialCore * outerWindRetention);
  const inflowFraction = options.isLand ? 0.27 : 0.18;
  const tcRadialInflowMs = tcTangentialMs * inflowFraction *
    (0.72 + 0.28 * clamp(rSafe / Math.max(40, outerReferenceRadius), 0, 1));
  const backgroundMoistWind = estimateMoistureBackgroundWind(targetLat, targetLon, cfg);
  const translationMs = Math.max(0, state.speed ?? 15) / 3.6;
  const movementRadForFlow = movementDir * Math.PI / 180;
  const translationEast = Math.sin(movementRadForFlow) * translationMs;
  const translationNorth = Math.cos(movementRadForFlow) * translationMs;
  // Geographic tangent is cyclonic in NH; reverse only the tangential circulation
  // south of the equator. Radial inflow and storm translation do not reverse.
  const circulationSign = state.lat < 0 ? -1 : 1;
  const lowLevelFlowEast = circulationSign * tangentEastFlow * tcTangentialMs - radialOutEast * tcRadialInflowMs +
    0.82 * backgroundMoistWind.u + 0.24 * translationEast;
  const lowLevelFlowNorth = circulationSign * tangentNorthFlow * tcTangentialMs - radialOutNorth * tcRadialInflowMs +
    0.82 * backgroundMoistWind.v + 0.24 * translationNorth;
  const lowLevelFlowSpeed = Math.hypot(lowLevelFlowEast, lowLevelFlowNorth);

  // 3.3.20 coast-normal roughness convergence.  A coastline does not enhance rainfall simply
  // because a grid point is near the sea: the low-level moist flow must actually cross the
  // shoreline toward land.  When a landward normal is available from the map/station geometry,
  // project the resolved cyclone + background low-level flow onto it.  This creates a generic
  // coastal convergence belt that follows any coastline and any storm track, rather than a
  // province-specific rainfall lobe.  If the caller has no normal (e.g. a cheap live-map sample),
  // the older track-relative friction lobe remains the conservative fallback below.
  const coastNormalEastRaw = options.coastInlandUnitEast ?? Number.NaN;
  const coastNormalNorthRaw = options.coastInlandUnitNorth ?? Number.NaN;
  const coastNormalLength = Math.hypot(coastNormalEastRaw, coastNormalNorthRaw);
  const hasCoastNormal = Number.isFinite(coastNormalLength) && coastNormalLength > 0.35;
  const coastInlandEast = hasCoastNormal ? coastNormalEastRaw / coastNormalLength : 0;
  const coastInlandNorth = hasCoastNormal ? coastNormalNorthRaw / coastNormalLength : 0;
  const onshoreFlowMs = hasCoastNormal
    ? Math.max(0, lowLevelFlowEast * coastInlandEast + lowLevelFlowNorth * coastInlandNorth)
    : 0;
  const coastDistanceForConvergence = Math.max(0, options.coastDistanceKm ?? 999);
  const coastRoughnessProximity = options.isLand
    ? Math.exp(-coastDistanceForConvergence / (70 + 20 * sizeFromRadii))
    : 0;
  const resolvedOnshoreFlowSupport = hasCoastNormal
    ? smooth01(clamp((onshoreFlowMs - 1.2) / 10.5, 0, 1))
    : 0;
  const backgroundFlowSpeed = Math.hypot(backgroundMoistWind.u, backgroundMoistWind.v);
  const radialMoistureInflow = lowLevelFlowSpeed > 0.3
    ? clamp(-(lowLevelFlowEast * radialOutEast + lowLevelFlowNorth * radialOutNorth) / lowLevelFlowSpeed, -1, 1)
    : 0;

  // Rainfall asymmetry is not an arbitrary storm-motion decoration. TRMM and China-landfall
  // composites show a robust wavenumber-1 maximum downshear to downshear-left, with storm motion
  // becoming relatively more important only when vertical shear is weak. Keep the transition
  // continuous so changing shear does not make the rain field jump sectors.
  const shearDir = wrap360(state.shearDir ?? (movementDir + 135));
  const shearMs = shearKt * 0.514444;
  const shearDominance = clamp((shearMs - 4.5) / 5.0, 0, 1);
  const downshearLeftBearing = wrap360(shearDir - 70);
  const motionFavoredBearing = wrap360(movementDir + 35);
  const shearLobe = gauss(angleDelta(bearing, downshearLeftBearing), 72);
  const motionLobe = gauss(angleDelta(bearing, motionFavoredBearing), 86);

  // Boundary-layer roughness contrast produces a track-relative convergence maximum ahead to
  // front-right of a landfalling TC. Observations indicate that the maximum sits farther to the
  // right for slower storms and rotates toward directly ahead as translation speed increases.
  // Where this shallow frictional ascent overlaps the shear-forced downshear ascent, rainfall is
  // preferentially reinforced instead of receiving two unrelated scalar multipliers.
  const fastMotionFraction = clamp((translationMs - 4.0) / 6.0, 0, 1);
  const frictionBearing = wrap360(movementDir + 36 * (1 - fastMotionFraction));
  const frictionConvergenceLobe = gauss(angleDelta(bearing, frictionBearing), 62 + 12 * fastMotionFraction);
  const shearFrictionOverlap = Math.sqrt(Math.max(0, shearLobe * frictionConvergenceLobe)) *
    (0.30 + 0.70 * shearDominance);

  const lowWave1 = 0.82 + 0.28 * motionLobe;
  const shearWave1 = 0.58 + 0.82 * shearLobe;
  const environmentalRainAsymmetry = clamp(
    lowWave1 * (1 - shearDominance) + shearWave1 * shearDominance,
    0.56,
    1.42
  );

  // Mesoscale rainbands contain embedded cells, but a 24-h operational product integrates
  // them into broad lobes.  Larger coherent scales prevent the accumulated field from turning
  // into narrow comb-like stripes while still allowing a few embedded maxima.
  const stormCellCoarse = rainNoise(dx, dy, simHour, 112, 8.0, 913.7);
  const stormCellFine = rainNoise(dx + 11 * Math.sin(simHour / 3.5), dy - 9 * Math.cos(simHour / 4.0), simHour, 58, 5.0, 1281.4);
  const rainbandCellGate = clamp(0.40 + 0.46 * Math.pow(stormCellCoarse, 1.15) + 0.17 * Math.pow(stormCellFine, 1.55), 0.32, 1.08);

  // Broad rainfall shields in real 24-h analyses are rarely circular. Use only low-order,
  // slowly varying asymmetries here (not fine random texture) so the 25-100 mm area forms
  // coherent lobes controlled by shear/motion plus mesoscale moisture organization.
  // The 24-h rainfall footprint must retain persistent, environment-locked lobes. Earlier
  // versions let wave-2/3 phases rotate with simulation time, so a full-day accumulation
  // averaged those lobes back into a near circle. Use slow ground-relative moisture texture
  // plus shear/motion-anchored sectors instead: this produces the broad, irregular CMA-like
  // leaves without introducing pixel-scale randomness.
  // 3.7.4: the ground-relative moisture pattern evolves on a synoptic rather than convective
  // timescale. A 24-h accumulation therefore retains real lobes/notches instead of averaging a
  // rotating random field into a smooth fan.
  const broadGroundNoise = rainNoise(groundXKm, groundYKm, simHour, 270, 96.0, 1667.3);
  const broadGroundNoise2 = rainNoise(groundXKm + 61, groundYKm - 43, simHour, 410, 144.0, 2917.1);
  const primaryShieldLobe = (1 - shearDominance) * gauss(angleDelta(bearing, motionFavoredBearing), 78) +
    shearDominance * gauss(angleDelta(bearing, downshearLeftBearing), 68);
  const feederShieldLobe = gauss(angleDelta(bearing, wrap360(movementDir + 145)), 58);
  const secondaryShieldLobe = gauss(angleDelta(bearing, wrap360(shearDir + 155)), 48);
  const suppressedWedge = gauss(angleDelta(bearing, wrap360(shearDir + 28)), 52);
  const wave2Phase = wrap360(downshearLeftBearing + 32);
  const wave3Phase = wrap360(movementDir - 48);
  const wave2 = 0.5 + 0.5 * Math.cos(2 * (bearing - wave2Phase) * Math.PI / 180);
  const wave3 = 0.5 + 0.5 * Math.cos(3 * (bearing - wave3Phase) * Math.PI / 180);
  const mesoscaleShieldShape = clamp(
    0.78 + 0.50 * primaryShieldLobe + 0.20 * feederShieldLobe + 0.14 * secondaryShieldLobe -
    0.25 * suppressedWedge + 0.24 * (wave2 - 0.5) + 0.13 * (wave3 - 0.5) +
    0.24 * (broadGroundNoise - 0.5) + 0.16 * (broadGroundNoise2 - 0.5),
    0.42, 1.68
  );

  // 2.4.10: broad landfall rainfall is not an annulus with a few azimuthal multipliers.
  // Once a cyclone reaches land, the 0-100 mm footprint is shaped by persistent moisture
  // corridors from the sea, a trailing stratiform lobe, terrain/coast geometry and large
  // ground-relative moist/dry patches.  These features evolve much more slowly than individual
  // convective cells, so a 24-h accumulation retains irregular lobes/notches instead of
  // averaging back into concentric arcs around the storm track.
  const topologyNoiseA = rainNoise(groundXKm - 117, groundYKm + 63, simHour, 205, 88.0, 4721.5);
  const topologyNoiseB = rainNoise(groundXKm + 83, groundYKm - 139, simHour, 335, 132.0, 5317.9);
  const topologyNoiseC = rainNoise(groundXKm - 211, groundYKm - 41, simHour, 145, 72.0, 6191.2);
  const groundMoistureTopology = clamp(0.48 * topologyNoiseA + 0.34 * topologyNoiseB + 0.18 * topologyNoiseC, 0, 1);

  const feederAxisDeg = wrap360(movementDir + 145);
  const feederAxisRad = feederAxisDeg * Math.PI / 180;
  const feederAlong = dx * Math.sin(feederAxisRad) + dy * Math.cos(feederAxisRad);
  const feederCross = dx * Math.cos(feederAxisRad) - dy * Math.sin(feederAxisRad);
  const moistureFeederCorridor =
    gauss(feederCross, 112 + 42 * sizeFromRadii) *
    gauss(feederAlong - (105 + 65 * sizeFromRadii), 285 + 95 * sizeFromRadii);

  const trailAxisDeg = wrap360(movementDir + 180);
  const trailAxisRad = trailAxisDeg * Math.PI / 180;
  const trailAlong = dx * Math.sin(trailAxisRad) + dy * Math.cos(trailAxisRad);
  const trailCross = dx * Math.cos(trailAxisRad) - dy * Math.sin(trailAxisRad);
  const trailingStratiformCorridor =
    gauss(trailCross, 148 + 48 * sizeFromRadii) *
    gauss(trailAlong - (135 + 60 * sizeFromRadii), 320 + 110 * sizeFromRadii);

  // A dry/up-shear intrusion creates broad missing sectors rather than a perfectly smooth
  // radial edge.  It is intentionally wide and weak because this term governs the low/mid
  // rain shield, not the compact convective core.
  const broadDrySlot = gauss(angleDelta(bearing, wrap360(shearDir + 28)), 42 + 18 * (1 - shearDominance)) *
    smooth01(clamp((r - 70) / 300, 0, 1));
  const coastMoistureGeometry = options.isLand && state.landed
    ? clamp(0.68 + 0.32 * Math.exp(-Math.max(0, options.coastDistanceKm ?? 80) / 230), 0.68, 1.0)
    : 1.0;
  const landTopologyWeight = options.isLand
    ? (state.landed ? clamp(0.44 + 0.56 * smooth01(landHours / 8.0), 0.44, 1.0) : 0.20)
    : 0.08;
  const landShieldTopologyRaw = clamp(
    0.80 +
    0.30 * moistureFeederCorridor +
    0.17 * trailingStratiformCorridor +
    0.72 * (groundMoistureTopology - 0.50) -
    0.28 * broadDrySlot,
    0.30,
    1.34
  );
  const broadFootprintTopology = clamp(
    (1 + landTopologyWeight * (landShieldTopologyRaw - 1)) * coastMoistureGeometry,
    0.38,
    1.28
  );


  // Persistent synoptic/mesoscale convergence layer.  Operational 24-h TC rainfall analyses are
  // not made of concentric storm-centred rings: low-level feeder flow, shear-locked ascent and
  // mesoscale convergence repeatedly rain over preferred *ground-relative* corridors.  This term
  // supplies moderate hourly rain (not the extreme tail) and therefore naturally builds broad,
  // irregular 50-250 mm lobes when a corridor remains active for several hours.
  const convergencePatch = smooth01(clamp((groundMoistureTopology - 0.30) / 0.52, 0, 1));
  const convergencePatchFine = rainNoise(groundXKm + 33, groundYKm + 17, simHour, 122, 24.0, 7351.9);
  const feederConvergence = clamp(
    0.20 + 0.52 * Math.max(0, radialMoistureInflow) + 0.28 * clamp(backgroundFlowSpeed / 9, 0, 1),
    0.18, 1.0
  );
  const convergenceAzimuth = clamp(
    0.48 + 0.44 * primaryShieldLobe + 0.20 * feederShieldLobe + 0.14 * secondaryShieldLobe +
      0.24 * frictionConvergenceLobe + 0.20 * shearFrictionOverlap - 0.18 * suppressedWedge,
    0.30, 1.34
  );
  const synopticConvergenceRadius = 190 + 115 * sizeFromRadii + 46 * circulationExpansion;
  const convergenceRadialEnvelope = Math.exp(-Math.pow(r / Math.max(170, synopticConvergenceRadius), 1.55)) *
    (0.72 + 0.28 * gauss(r - (150 + 75 * sizeFromRadii), 130 + 45 * sizeFromRadii));
  const synopticConvergenceRain = (
    0.65 + 3.2 * intensity + 4.4 * moistureTransport + 1.6 * sizeFromRadii +
      1.2 * rainbandDominance + 0.9 * weakening
  ) * convergenceRadialEnvelope * convergenceAzimuth * feederConvergence *
    clamp(0.34 + 0.58 * convergencePatch + 0.16 * convergencePatchFine, 0.28, 1.05) *
    (0.72 + 0.28 * broadFootprintTopology) *
    (1 - 0.22 * organizedIntactCore);

  const eyeType = state.eyeType || "none";
  const eyePhase = state.eyePhase || "none";
  const diagnosedEyeOrganization = clamp(
    0.72 * hurricaneCore * integrity * (1 - 0.72 * obstruction) * (1 - 0.58 * shearNorm),
    0, 1
  );
  // At very high intensity an otherwise coherent core should not silently lose the eye merely
  // because a saved snapshot has stale eye metadata.  This fallback is disabled for blocked,
  // ragged, EWRC-failure and dry-air-damaged structures.
  const strongEyeFallback = clamp(
    clamp((vmax - 46) / 18, 0, 1) * integrity * (0.58 + 0.42 * coreCompactness) *
    (1 - 0.80 * damageSeverity) * (1 - 0.72 * dryAirCoreExposure) * (1 - 0.62 * shearNorm),
    0, 0.94
  );
  const eyeFallbackAllowed = !["blocked", "ragged", "clouding", "replacement_double"].includes(eyePhase) &&
    !["dry_leaf", "incense_coil", "westerly_sheared", "terrain_hollow_bands", "rainband_dominant",
      "failed_eye_opening", "sheared_convective_burst", "binary_interaction_sheared",
      "binary_merger_reorganizing", "landfall_broken_eyewall"].includes(structureMode);
  // Strong, well-organized cyclones should retain a recognizable eye/eyewall
  // precipitation signature even when an older save lacks the newer eye-type
  // fields. Explicit eye state still takes precedence, but a meteorological
  // fallback prevents the eye from silently disappearing from station rainfall.
  const clearEye = clamp(Math.max(
    state.eyeClearance ?? 0,
    eyeFallbackAllowed && vmax >= 40 ? diagnosedEyeOrganization : 0,
    eyeFallbackAllowed ? strongEyeFallback : 0
  ));
  const hasDefinedEye = vmax >= 31.5 && ((eyeType !== "none" && clearEye > 0.24) ||
    (vmax >= 40 && Math.max(diagnosedEyeOrganization, strongEyeFallback) > 0.30 && obstruction < 0.64));
  const raggedEye = state.isStructureDamaged || state.isCoreDisrupted || ["irregular", "gap", "eccentric", "broken"].includes(eyeType) || ["ragged", "blocked", "clouding"].includes(eyePhase);
  // Low-intensity systems can have central convective clusters, but they do not receive a mature
  // CDO/eye scene. Reserve the 100-150 km dense inner-core shield for typhoon-strength vortices.
  const matureCdoEligible = (state.landed ? landfallCoreVmaxMemory : vmax) >= 32.7 && integrity >= 0.38 &&
    convectiveSuppression < 0.68 && deepConvectiveCoverage > 0.34 && eyewallOpenSectorFraction < 0.62 &&
    terrainHollowCoreMemory < 0.12;
  const cdoLike = matureCdoEligible && (!hasDefinedEye || eyePhase === "forming");
  const hollowing = hasDefinedEye && clearEye > 0.68 && weakening > 0.22 && integrity < 0.72;
  const ewrcActive = !!state.ewrcState && !["none", "completed"].includes(state.ewrcState);
  const secondaryEyewall = clamp(state.secondaryEyewallStrength ?? (ewrcActive ? 0.42 : 0));

  // 1) Broad outer circulation. Bigger systems and weakening mature systems can
  // retain/expand large rain shields despite falling peak winds.
  const landLooseSpread = state.landed
    ? (1 + 0.08 * smooth01(landHours / 18.0) + 0.08 * structuralDisorganization + 0.05 * physicalTerrainBreakup)
    : 1;
  // 2.4.7: keep the asymmetry/leaf geometry from 2.4.6, but contract the low-to-moderate
  // rain shield. CMA-style 24 h products show a broad but not basin-filling 25-100 mm envelope;
  // the previous e-folding radii let weak stratiform/diffuse rain cross the 25/50 mm thresholds
  // too far from the organized bands. Heavy-band/core geometry below is intentionally unchanged.
  const diagnosedWindEnvelopeRadius = r7Directional > 0
    ? clamp(0.62 * r7Directional + 55, 135, 360)
    : (160 + 58 * sizeFromRadii);
  const outerRadius = (diagnosedWindEnvelopeRadius + 14 * weakening) *
    (0.92 + 0.18 * radialScale) * (1 + 0.08 * circulationExpansion) * landLooseSpread * dryEnvelopeContraction;
  // Deform the broad shield radius as well as its amplitude. This prevents threshold contours
  // from becoming nearly circular even when the storm spends many hours over the same region.
  const directionalOuterScale = clamp(
    (0.55 + 0.48 * mesoscaleShieldShape) * (0.82 + 0.22 * broadFootprintTopology),
    0.52, 1.43
  );
  const outerEnvelope = Math.exp(-Math.pow(r / Math.max(65, outerRadius * directionalOuterScale), 1.48)) *
    clamp(r / (70 + 18 * sizeFromRadii), 0.14, 1);
  const weakeningMoistureBoost = 1 + 0.22 * weakening * moistureTransport * (0.45 + 0.55 * hurricaneCore);
  const residualEnvelopeBoost = 1 + 0.34 * postPeakEnvelopeMemory * lowLevelVortexIntegrity *
    clamp(0.28 + 0.72 * (weakening + dryAirCoreExposure), 0, 1);
  const outerCirculation = (0.12 + 0.58 * intensity + 0.36 * weakSystem + 0.46 * sizeFromRadii) *
    outerEnvelope * (0.66 + 0.38 * moistureTransport) * weakeningMoistureBoost * mesoscaleShieldShape *
    (0.60 + 0.36 * broadFootprintTopology) * organizedCoreBroadSuppression * residualEnvelopeBoost *
    dryOuterSectorSurvival;

  // 2) Spiral rainbands. Radius responds strongly to circulation size. Broken/ragged
  // cores and weakening phases shift a larger fraction of rain into outer bands.
  const finiteBands = finiteRainbandGeometry(
    r, bearing, simHour, movementDir, rmw, sizeFromRadii,
    clamp(0.44 * structuralDisorganization + 0.32 * damageSeverity + 0.22 * dryAirCoreExposure, 0, 1)
  );
  const primarySpiralGate = finiteBands.primary;
  const secondarySpiralGate = 0.62 * finiteBands.secondary;
  // Rainbands are narrow, finite, discontinuous mesoscale structures rather than mathematical
  // spirals that continue winding outward forever. Keep distant bands sparse and weak; intense
  // cells still require the separate convective-cluster gates below.
  const spiralSkeleton = finiteBands.skeleton;
  const spiralGate = clamp(
    (0.045 + 0.64 * spiralSkeleton) * (0.66 + 0.42 * rainbandCellGate) *
      (0.79 + 0.21 * environmentalRainAsymmetry) +
    0.018 * rainbandDominance,
    0,
    1.02
  );
  // When the core is damaged, rainbands are advected outward by the loosening vortex while
  // continuing to rotate cyclonically.  Their radius changes continuously rather than jumping
  // to a fixed displaced lobe.
  const bandOutwardThrow = 1 + 0.14 * damageSeverity + 0.16 * structuralDisorganization +
    0.10 * dryAirCoreExposure + 0.10 * rainbandDominance + 0.12 * eyewallColdPoolMemory;
  const band1Center = (92 + 88 * intensity + 62 * sizeFromRadii) * (0.92 + 0.18 * radialScale) *
    (1 + 0.10 * circulationExpansion) * bandOutwardThrow * dryEnvelopeContraction *
    (state.landed ? 1.00 + 0.05 * landfallDispersal : 1);
  const band2Center = (225 + 74 * sizeFromRadii + 28 * weakening) * (0.92 + 0.16 * radialScale) *
    (1 + 0.10 * circulationExpansion) * bandOutwardThrow * dryEnvelopeContraction *
    (state.landed ? 1.01 + 0.07 * landfallDispersal : 1);
  const bandEnvelope = gauss(r - band1Center, 34 + 20 * sizeFromRadii) +
    0.24 * gauss(r - band2Center, 49 + 25 * sizeFromRadii);

  // Deep convection on spiral bands is cellular and transient, not a permanent convective ring.
  // A few 2.5-3.5 h clusters are spawned along the spiral skeleton and fade to zero at the
  // beginning/end of each cycle. The weaker band background remains, but intense rain requires
  // one of these embedded cells.
  const clusterCycleHours = 3.2;
  const clusterEpoch = Math.floor(simHour / clusterCycleHours);
  const clusterFrac = (simHour / clusterCycleHours) - clusterEpoch;
  const clusterLifePulse = Math.pow(Math.max(0, Math.sin(Math.PI * clusterFrac)), 0.72);
  let rainbandConvectiveCluster = 0;
  for (let ci = 0; ci < 3; ci++) {
    const seed = clusterEpoch * 117.31 + ci * 43.77 + 19.2;
    const useOuter = hash01(seed + 5.4) > 0.84;
    const baseRadius = useOuter ? band2Center : band1Center;
    const cellRadius = baseRadius * (0.82 + 0.34 * hash01(seed + 17.8));
    const clusterAgeHours = clusterFrac * clusterCycleHours;
    const cellRotationDegPerHour = 4.2 + 4.8 * hash01(seed + 61.2);
    const cellAz = wrap360(360 * hash01(seed + 31.6) + (cellRadius / Math.max(75, rmw)) * 12 -
      clusterAgeHours * cellRotationDegPerHour);
    const radialCell = gauss(r - cellRadius, useOuter ? 22 + 10 * sizeFromRadii : 15 + 8 * sizeFromRadii);
    const azCell = gauss(angleDelta(bearing, cellAz), useOuter ? 13 : 10);
    rainbandConvectiveCluster = Math.max(rainbandConvectiveCluster, radialCell * azCell * clusterLifePulse);
  }
  rainbandConvectiveCluster *= 0.45 + 0.55 * spiralSkeleton;

  // Secondary/mesoscale rainband packets are transient and rotate cyclonically around the
  // vortex.  Do not pin a permanent heavy-rain lobe to the north/downshear sector: individual
  // packets can occur in any quadrant and are only active during a minority of 6-9 h windows.
  // In Northern Hemisphere bearing coordinates (clockwise positive from north), cyclonic
  // rotation means the packet bearing decreases with time.  Environmental shear modulates
  // intensity, but does not hard-code the packet location.
  const bandComplexCycleHours = 7.4;
  const bandComplexEpoch = Math.floor(simHour / bandComplexCycleHours);
  const bandComplexAge = simHour - bandComplexEpoch * bandComplexCycleHours;
  const bandComplexFrac = bandComplexAge / bandComplexCycleHours;
  const bandComplexPulse = Math.pow(Math.max(0, Math.sin(Math.PI * bandComplexFrac)), 0.78);
  const bandComplexSeed = bandComplexEpoch * 83.71 + 419.6;
  const bandComplexEventDraw = hash01(bandComplexSeed + 11.8);
  const bandComplexThreshold = clamp(
    0.72 - 0.08 * rainbandDominance - 0.05 * moistureTransport - 0.04 * intensity,
    0.61, 0.78
  );
  const bandComplexActive = bandComplexEventDraw > bandComplexThreshold;
  const bandComplexStartBearing = 360 * hash01(bandComplexSeed + 37.4);
  const bandComplexRotationDegPerHour = 3.8 + 5.6 * hash01(bandComplexSeed + 91.3);
  const rotatingBandComplexBearing = wrap360(
    bandComplexStartBearing - bandComplexAge * bandComplexRotationDegPerHour
  );
  const bandComplexPrimary = bandComplexActive
    ? gauss(angleDelta(bearing, rotatingBandComplexBearing), 32 + 9 * sizeFromRadii) *
      gauss(r - band1Center * (0.92 + 0.10 * sizeFromRadii), 64 + 21 * sizeFromRadii) * bandComplexPulse
    : 0;
  const trailingPacketBearing = wrap360(rotatingBandComplexBearing + 74 + 22 * hash01(bandComplexSeed + 53.9));
  const bandComplexSecondary = bandComplexActive
    ? 0.58 * gauss(angleDelta(bearing, trailingPacketBearing), 28 + 9 * sizeFromRadii) *
      gauss(r - (0.76 * band2Center + 0.24 * band1Center), 86 + 25 * sizeFromRadii) * bandComplexPulse
    : 0;
  const rainbandMesoscaleComplex = clamp(
    Math.max(bandComplexPrimary, bandComplexSecondary) *
      (0.76 + 0.24 * broadGroundNoise2) *
      (0.84 + 0.16 * environmentalRainAsymmetry),
    0, 1.05
  );

  // 3.3.21: detached outer-rainband packets. A 24-h analysis can contain small 50-250 mm
  // islands well outside the main rain shield because a slowly evolving outer band repeatedly
  // sweeps the same ground-relative corridor while the cyclone translates. Earlier versions
  // represented almost all outer bands with storm-relative spirals; over 24 h those phases
  // averaged away and the detached lobes vanished. Keep the packet tied to both the diagnosed
  // spiral geometry and a slowly varying ground-relative moisture/convergence patch so it is
  // episodic, asymmetric and physically coupled rather than random map speckle.
  const detachedBandGroundA = rainNoise(groundXKm + 127, groundYKm - 83, simHour, 165, 34.0, 9721.4);
  const detachedBandGroundB = rainNoise(groundXKm - 211, groundYKm + 51, simHour, 245, 52.0, 9733.8);
  const detachedBandGroundGate = smooth01(clamp((0.64 * detachedBandGroundA + 0.36 * detachedBandGroundB - 0.43) / 0.42, 0, 1));
  const detachedBandRadius = Math.max(250, 0.78 * band2Center + 90 * sizeFromRadii);
  const detachedBandEnvelope = Math.max(
    gauss(r - detachedBandRadius, 74 + 24 * sizeFromRadii),
    0.55 * gauss(r - (detachedBandRadius + 155), 96 + 34 * sizeFromRadii)
  );
  const detachedBandAzimuth = clamp(
    0.28 + 0.52 * primaryShieldLobe + 0.24 * feederShieldLobe + 0.18 * secondaryShieldLobe +
      0.26 * rainbandMesoscaleComplex + 0.18 * shearFrictionOverlap,
    0.18, 1.18
  );
  const detachedOuterRainband = (0.35 + 5.6 * intensity + 4.0 * moistureTransport + 2.2 * sizeFromRadii) *
    detachedBandEnvelope * detachedBandAzimuth * detachedBandGroundGate *
    (0.46 + 0.54 * rainbandCellGate) * (0.76 + 0.24 * lowLevelVortexIntegrity);
  const brokenBandFactor = 0.40 + 0.78 * sectorNoise;
  const structureToBands = 1 + (raggedEye ? 0.34 : 0) + 0.24 * weakening + 0.18 * secondaryEyewall
    + 0.92 * rainbandDominance + 0.54 * broadMoisturePlatform + 0.30 * coreRebuildScar;

  // Outer rainbands are usually showers with embedded convective cells. A station can receive a
  // very high instantaneous rate for 5-25 minutes, but that should not be treated as an hour-long
  // deluge. Use several deterministic sub-hour opportunities and convert them into an hourly-equivalent pulse.
  const pulseBase = Math.floor(simHour) * 2 + Math.floor(bearing / 18) * 37 + Math.floor(r / 35) * 19;
  let shortBurstEquivalent = 0;
  for (let pulse = 0; pulse < 3; pulse++) {
    const trigger = hash01(pulseBase + pulse * 101.7);
    if (trigger > 0.82) {
      const durationHours = 0.08 + 0.30 * hash01(pulseBase + pulse * 41.3 + 3.1); // ~5-23 min
      const peakScale = 0.78 + 1.25 * hash01(pulseBase + pulse * 23.9 + 8.7);
      shortBurstEquivalent += durationHours * peakScale;
    }
  }
  const showerBackground = 0.42 + 2.15 * intensity + 0.78 * sizeFromRadii;
  const remoteBurstFactor = clamp(1 - 0.0028 * Math.max(0, r - 230), 0.10, 1);
  const embeddedBurst = (18 + 58 * intensity + 13 * strengthening + 10 * rainbandDominance) * shortBurstEquivalent * remoteBurstFactor *
    (0.08 + 1.42 * clamp(rainbandConvectiveCluster, 0, 1));
  // Convert the non-convective portion to an hourly accumulation using a lower duty cycle.
  // A band can persist for hours as a mesoscale feature, but any one gauge typically spends
  // much of that time in gaps/stratiform residue rather than continuous convective rain.
  const showerOccupancyNoise = hash01(pulseBase + 211.9);
  const showerThreshold = clamp(
    0.52 - 0.12 * sectorNoise - 0.15 * spiralGate - 0.08 * moistureTransport - 0.10 * rainbandDominance,
    0.27,
    0.62
  );
  const showerPresent = showerOccupancyNoise > showerThreshold;
  const showerDuty = showerPresent
    ? 0.22 + 0.25 * hash01(pulseBase + 317.2)   // ~13-28 min of light/moderate rain per hour
    : 0.025 + 0.065 * hash01(pulseBase + 419.6); // mostly dry lane / weak stratiform residue
  const residualBandMemory = clamp(
    lowLevelVortexIntegrity * postPeakEnvelopeMemory *
    (0.30 + 0.70 * clamp(weakening + dryAirCoreExposure + (state.landed ? 0.30 : 0), 0, 1)),
    0, 1
  );
  const structuralRainbandTransfer = 1 + 0.46 * damageSeverity + 0.16 * circulationExpansion +
    0.46 * rainbandDominance + 0.20 * broadMoisturePlatform + 0.30 * residualBandMemory;
  // Dry-air morphology is represented as a strongly asymmetric, shredded cloud shield
  // ("dry-leaf") or a narrow single-arm spiral ("incense-coil"), rather than merely a label.
  const drySectorAngle = drySlotBearing;
  const dryLeafGate = structureMode === "dry_leaf"
    ? clamp(0.14 + 0.96 * (1 - gauss(angleDelta(bearing, drySectorAngle), 54)), 0.08, 1.05)
    : structureMode === "dry_slot_eroding"
      ? clamp(0.46 + 0.66 * (1 - gauss(angleDelta(bearing, drySectorAngle), 42)) +
          0.10 * moistCoreProtection * gauss(r - Math.max(45, 1.8 * rmw), 55), 0.30, 1.12)
      : 1;
  const incensePhase = angleDelta(
    bearing,
    movementDir + 145 - (state.lat < 0 ? -1 : 1) * simHour * 1.35 -
      (state.lat < 0 ? -1 : 1) * (96 + 18 * sizeFromRadii) * Math.log(Math.max(0.72, r / Math.max(58, 1.55 * rmw)))
  );
  const incenseGate = structureMode === "incense_coil"
    ? clamp(0.08 + 1.35 * Math.pow(Math.max(0, Math.cos((incensePhase * Math.PI) / 90)), 4.2), 0.04, 1.25)
    : 1;
  const bandStratiformBackground = 0.62 * showerBackground * showerDuty * spiralGate;
  const bandCellConvection = embeddedBurst * (0.22 + 0.95 * rainbandConvectiveCluster);
  const mesoscaleComplexRain = (0.8 + 5.6 * intensity + 4.2 * moistureTransport + 2.6 * rainbandDominance) *
    rainbandMesoscaleComplex * (0.70 + 0.30 * rainbandCellGate) *
    (1 + 0.18 * weakening + 0.16 * broadMoisturePlatform);
  let spiralRainband = (((bandStratiformBackground + bandCellConvection) * bandEnvelope + mesoscaleComplexRain) *
    (0.64 + 0.50 * moistureTransport) * brokenBandFactor * structureToBands * structuralRainbandTransfer *
    dryLeafGate * incenseGate * dryBandSectorSurvival * dryRebuildCompactness) +
    0.72 * detachedOuterRainband * dryOuterSectorSurvival;

  // A loose/disrupted cyclone can consolidate most surviving convection into one dominant displaced
  // rainband instead of several equally strong, geometrically neat spirals. The band is probabilistic,
  // long-lived and follows the dynamically favoured moist/downshear sector; an intact core suppresses it.
  const looseSingleBandPotential = clamp(
    0.46 * structuralDisorganization + 0.34 * rainbandDominance + 0.24 * shearNorm +
      0.26 * dryAirCoreExposure + 0.18 * eyewallOpenSectorFraction - 0.72 * organizedIntactCore,
    0, 1
  );
  const looseBandEpoch = Math.floor(simHour / 13.5);
  const looseBandSeed = looseBandEpoch * 97.31 + 1739.5;
  const looseBandEvent = hash01(looseBandSeed + 4.7) < (0.10 + 0.54 * looseSingleBandPotential);
  const looseBandLifeFrac = (simHour / 13.5) - looseBandEpoch;
  const looseBandLife = Math.pow(Math.max(0, Math.sin(Math.PI * looseBandLifeFrac)), 0.46);
  const looseBandDynamicBearing = blendBearing(
    downshearLeftBearing,
    moistArcBearing,
    clamp(0.20 + 0.58 * dryAirCoreExposure + 0.16 * dryAirCoreConnection, 0.12, 0.82)
  );
  const looseBandAnchor = wrap360(looseBandDynamicBearing + (hash01(looseBandSeed + 22.8) - 0.5) * 54);
  const looseBandCurveBearing = wrap360(looseBandAnchor - 26 * (r / Math.max(95, band1Center) - 1));
  const looseBandAz = gauss(angleDelta(bearing, looseBandCurveBearing), 19 + 12 * (1 - looseSingleBandPotential));
  const looseBandRad = Math.max(
    gauss(r - (0.94 * band1Center), 46 + 20 * sizeFromRadii),
    0.54 * gauss(r - (0.68 * band2Center + 0.32 * band1Center), 62 + 24 * sizeFromRadii)
  );
  const dominantLooseRainband = looseBandEvent
    ? (3.0 + 16.0 * intensity + 12.0 * moistureTransport + 9.0 * looseSingleBandPotential) *
      looseSingleBandPotential * looseBandLife * looseBandRad * looseBandAz *
      (0.56 + 0.44 * rainbandCellGate) * dryBandSectorSurvival
    : 0;
  if (looseBandEvent && looseSingleBandPotential > 0.24) {
    spiralRainband *= 1 - 0.46 * looseSingleBandPotential;
    spiralRainband += dominantLooseRainband;
  }

  // A dry-eroded/post-peak cyclone can keep one or two rain-bearing feeder arcs after its CDO is
  // gone.  This is low-level-vortex memory, not a hidden boost to inner-core intensity: the term
  // lives on the diagnosed spiral envelopes and vanishes as the broad vortex itself decays.
  if (dryAirLifecyclePhase === "residual_vortex" || dryAirLifecyclePhase === "asymmetric_collapse") {
    const residualMoistArc = clamp(0.32 + 0.68 * moistArcLobe + 0.18 * moistArcFlanks, 0.18, 1.12);
    spiralRainband *= 1 + 0.42 * residualBandMemory * residualMoistArc;
  }

  // A coast-striking rainband packet is an episodic feature, not a permanent north-side lobe.
  // It may originate in any quadrant, then rotates cyclonically with the vortex while moving
  // through the coastal belt.  The event probability is deliberately low; a coherent intense
  // inner core remains the default rainfall maximum unless one of these packets actually occurs.
  const coastalBandCycleHours = 6.8;
  const coastalBandEpoch = Math.floor(simHour / coastalBandCycleHours);
  const coastalBandAge = simHour - coastalBandEpoch * coastalBandCycleHours;
  const coastalBandFrac = coastalBandAge / coastalBandCycleHours;
  const coastalBandLifePulse = Math.pow(Math.max(0, Math.sin(Math.PI * coastalBandFrac)), 0.80);
  const coastalEventSeed = coastalBandEpoch * 71.3 + 331.9;
  const coastalEventDraw = hash01(coastalEventSeed);
  const coastalEventThreshold = clamp(
    0.76 - 0.07 * rainbandDominance - 0.04 * intensity - 0.04 * ambientMoistureTransport,
    0.66, 0.82
  );
  const coastalBandActive = coastalEventDraw > coastalEventThreshold;
  // 3.3.22: do not hard-code a southeast-China sector preference. Detached/coastal packets
  // should anchor where the resolved boundary-layer dynamics favour repeated convergence:
  // friction-favoured inflow, downshear-left ascent and (when available) the local coast normal.
  // A free stochastic phase remains so this is a probabilistic mesoscale packet, not a fixed lobe.
  const sectorJitter = (hash01(coastalEventSeed + 14.6) - 0.5) * 70;
  const freePacketBearing = wrap360(360 * hash01(coastalEventSeed + 8.2));
  const shearFrictionPacketBearing = blendBearing(
    frictionBearing,
    downshearLeftBearing,
    0.16 + 0.48 * shearDominance
  );
  const localCoastNormalBearing = hasCoastNormal
    ? wrap360(Math.atan2(coastInlandEast, coastInlandNorth) * 180 / Math.PI)
    : shearFrictionPacketBearing;
  const processPacketBearing = blendBearing(
    shearFrictionPacketBearing,
    localCoastNormalBearing,
    hasCoastNormal ? 0.18 + 0.52 * resolvedOnshoreFlowSupport : 0
  );
  const packetAnchorWeight = clamp(
    0.22 + 0.28 * rainbandDominance + 0.24 * resolvedOnshoreFlowSupport + 0.14 * shearDominance,
    0.18, 0.84
  );
  const thrownBandStartBearing = blendBearing(
    freePacketBearing,
    wrap360(processPacketBearing + sectorJitter),
    packetAnchorWeight
  );
  const thrownBandRotationDegPerHour = 4.5 + 5.0 * hash01(coastalEventSeed + 63.8);
  const thrownBandBearing = wrap360(
    thrownBandStartBearing - coastalBandAge * thrownBandRotationDegPerHour
  );
  const coastDistance = Math.max(0, options.coastDistanceKm ?? (options.isLand ? 65 : 999));
  const coastalTransitionFocus = Math.exp(-coastDistance / 82) *
    (state.landed ? Math.exp(-landHours / 6.5) : 1);
  const movingResidualPacketSupport = state.landed
    ? clamp(0.28 + 0.42 * landConvectiveMemory + 0.22 * moistureReservoir + 0.16 * lowLevelVortexIntegrity, 0.25, 1.04)
    : 0.48;
  const coastStrikeFocus = clamp(0.34 * coastalTransitionFocus + 0.66 * movingResidualPacketSupport, 0.16, 1.02);
  const thrownBandRadius = band1Center * (0.92 + 0.16 * hash01(coastalEventSeed + 5.8)) +
    50 * hash01(coastalEventSeed + 11.4);
  const thrownBandRad = Math.max(
    gauss(r - thrownBandRadius, 24 + 16 * sizeFromRadii),
    0.42 * gauss(r - (thrownBandRadius + 92 + 50 * sizeFromRadii), 42 + 18 * sizeFromRadii)
  );
  const thrownBandAz = gauss(angleDelta(bearing, thrownBandBearing), 16 + 8 * sizeFromRadii);
  const inlandBandFade = state.landed ? clamp(0.72 + 0.28 * landConvectiveMemory, 0.52, 1) : 1;
  const coastalThrownRainband = coastalBandActive
    ? (2.2 + 9.0 * intensity + 7.0 * moistureTransport + 4.0 * rainbandDominance) *
      coastalBandLifePulse * thrownBandRad * thrownBandAz * coastStrikeFocus * inlandBandFade *
      (0.35 + 0.65 * spiralSkeleton) * (0.72 + 0.28 * rainbandCellGate) *
      Math.max(0.16, 1 - 0.70 * convectiveSuppression) * (1 - 0.50 * organizedIntactCore)
    : 0;
  spiralRainband += coastalThrownRainband;
  // Intact high-intensity vortices still carry rainbands, but those bands should not routinely
  // out-rain the coherent CDO/eyewall.  The suppression is modest so a genuine coastal packet can
  // still make a separate heavy-rain lobe.
  spiralRainband *= 1 - 0.18 * organizedIntactCore;

  // As the vortex comes apart over land, compact rainfall is transferred into broader,
  // patchier rainbands rather than disappearing in one step.
  spiralRainband *= (1 + 0.38 * landfallDispersal) *
    clamp(1 - 0.18 * structuralDisorganization - 0.08 * dryAirCoreExposure, 0.55, 1);

  // 3) Episodic pre-TC squall line. Chinese observational statistics show these only accompany
  // a minority of landfalling TCs, commonly last about 4 h, form as broken lines several
  // hundred kilometres ahead/right of the centre, then outrun the parent vortex and dissipate.
  // The engine persists a single probabilistic episode; without that episode this term is zero.
  const squallStart = state.preStormSquallStartHour;
  const squallDuration = Math.max(0, state.preStormSquallDurationHours ?? 0);
  const squallAge = squallStart == null ? -999 : simHour - squallStart;
  const squallActive = squallStart != null && squallDuration > 0 && squallAge >= 0 && squallAge <= squallDuration + 1.3;
  const squallFrac = squallActive ? clamp(squallAge / Math.max(0.5, squallDuration), 0, 1) : 0;
  const squallPulse = !squallActive ? 0 : squallAge <= squallDuration
    ? Math.pow(Math.max(0, Math.sin(Math.PI * squallFrac)), 0.62)
    : Math.exp(-(squallAge - squallDuration) / 0.45);
  const squallAxisDeg = wrap360(movementDir + (state.preStormSquallBearingOffsetDeg ?? 36));
  const squallAxisRad = squallAxisDeg * Math.PI / 180;
  const squallForwardKm = dx * Math.sin(squallAxisRad) + dy * Math.cos(squallAxisRad);
  const squallCrossKm = dx * Math.cos(squallAxisRad) - dy * Math.sin(squallAxisRad);
  const squallSpeed = Math.max(state.preStormSquallSpeedKmh ?? 45, state.speed ?? 15);
  const lineAheadKm = 430 + 120 * sizeFromRadii + Math.max(0, squallAge) * Math.max(8, squallSpeed - (state.speed ?? 15));
  const lineWidthKm = 9.0 + 4.0 * clamp(1.0 - shearNorm, 0, 1) + 2.0 * sizeFromRadii;
  const lineHalfLengthSigma = 88 + 34 * sizeFromRadii;
  const lineNormal = gauss(squallForwardKm - lineAheadKm, lineWidthKm);
  const lineAlong = gauss(squallCrossKm, lineHalfLengthSigma);
  const brokenLineCells = clamp(0.24 + 0.76 * rainNoise(squallCrossKm, lineAheadKm, simHour, 52, 3.8, 2751.4), 0.18, 1);
  const trailingStratiform = gauss(squallForwardKm - (lineAheadKm - 28), 24 + 10 * sizeFromRadii) * lineAlong * 0.24;
  const preStormSquall = squallActive ? (14 + 52 * intensity + 16 * moistureTransport + 7 * shearNorm) *
    squallPulse * (lineNormal * lineAlong * brokenLineCells + trailingStratiform) *
    (0.76 + 0.38 * movementSpeed) * (0.84 + 0.28 * sectorNoise) : 0;

  // 4) Primary and secondary eyewall. Strengthening increases symmetric inner-core
  // precipitation coverage, while ragged/hollowing cores lose compact rainfall even if
  // Vmax is still high.
  const eyeRadius = Math.max(2.0, state.eyeRadiusKm || rmw * 0.68);
  // In a mature storm the RMW lies in the eyewall, just outside the relatively
  // precipitation-poor eye.  Keep the inferred eye and eyewall close enough for
  // a station time series to resolve the classic eyewall -> eye -> eyewall passage.
  const eyewallRadius = Math.max(rmw * 0.92, eyeRadius + Math.max(5.5, rmw * 0.14));
  // Airborne precipitation composites show a narrow, high-gradient eyewall ring. Keep
  // the Gaussian sigma compact enough that a station crossing a complete eye
  // experiences a sharp rain increase on eyewall entry and a sharp decrease
  // inside the eye, rather than one broad central rainfall hump.
  const eyewallWidth = clamp(8.8 + 0.15 * eyewallRadius + 5.5 * (1 - integrity) + (ewrcActive ? 3.6 : 0), 9.0, 23.0);
  const primaryRing = gauss(r - eyewallRadius, eyewallWidth);
  const shearOpenSector = state.shearDir == null
    ? 1
    : 1 - 0.76 * shearNorm * gauss(angleDelta(bearing, wrap360(state.shearDir + 35)), 38);
  // A genuinely complete eyewall is close to annular on the station scale.
  // Keep stochastic sector holes for ragged / sheared systems, but do not let
  // pseudo-noise erase one side of an otherwise clear eye.
  const sectorBreaks = hasDefinedEye && !raggedEye && integrity > 0.70
    ? clamp(0.84 + 0.20 * sectorNoise - 0.10 * asymmetry, 0.72, 1.10)
    : clamp(0.36 + 0.94 * sectorNoise - 0.34 * asymmetry, 0.08, 1.35);
  let coreStructureFactor = clamp(integrity * shearOpenSector * sectorBreaks, 0.06, 1.35);
  if (raggedEye) coreStructureFactor *= 0.74;
  if (hollowing) coreStructureFactor *= 0.64;
  coreStructureFactor *= 1 - 0.42 * damageSeverity;
  coreStructureFactor *= 0.58 + 0.54 * coreCompactness;
  if (ewrcFailureMode === "inner_collapse_outer_stalls") coreStructureFactor *= 0.62;
  if (structureMode === "cold_air_remnant_low") coreStructureFactor *= 0.36;
  if (structureMode === "terrain_hollow_bands" || structureMode === "rainband_dominant") coreStructureFactor *= 0.70;
  if (structureMode === "dry_slot_eroding") coreStructureFactor *= 0.94 - 0.14 * dryAirCoreExposure;
  if (structureMode === "dry_leaf") coreStructureFactor *= 0.74;
  if (structureMode === "incense_coil") coreStructureFactor *= 0.60;
  if (structureMode === "failed_eye_opening") coreStructureFactor *= 0.72;
  if (structureMode === "sheared_convective_burst") coreStructureFactor *= 0.80;
  if (structureMode === "binary_interaction_sheared") coreStructureFactor *= 0.78;
  if (structureMode === "binary_merger_reorganizing") coreStructureFactor *= 0.72;
  if (structureMode === "landfall_broken_eyewall") coreStructureFactor *= 0.76;
  if (structureMode === "landfall_intact_cdo") coreStructureFactor *= clamp(0.82 + 0.12 * marineMoistureLink, 0.82, 0.94);
  // Entering the westerlies/ET primarily redistributes deep convection into asymmetric core and
  // frontal/slantwise rain before it disappears. A Dvorak-analyzed 55-65 m/s cyclone crossing
  // Japan must therefore retain a meaningful inner-core convective floor.
  if (structureMode === "westerly_sheared") {
    // Do not erase the heavy-rain core immediately at westerly entry. The compact eyewall still
    // decays, but a moisture-loaded remnant can keep a one-sided 100+ mm/24 h lobe for longer.
    coreStructureFactor *= clamp(0.76 + 0.14 * dvorakMajorCorePotential + 0.10 * westerlyRainMemory, 0.72, 0.98);
  }
  if (structureMode === "dry_rebuilding_core") coreStructureFactor *= 0.72;
  coreStructureFactor *= 1 - 0.54 * nonDryConvectiveSuppression;
  coreStructureFactor *= 0.38 + 0.62 * deepConvectiveCoverage;
  coreStructureFactor *= binaryConvectiveRedistribution;
  // A ventilated eyewall cold pool diverts part of the boundary-layer convergence to its outer
  // edge.  This weakens the original closed ring while preserving the possibility of a very
  // vigorous arc/inner rainband immediately outside it.
  coreStructureFactor *= 1 - 0.16 * eyewallColdPoolMemory;
  coreStructureFactor *= Math.max(0.18, 1 - 0.62 * eyewallOpenSectorFraction * drySlotLobe);
  // Explicitly perforate the dry-slot side while retaining a vigorous humid-side eyewall arc.
  // This is the key fix for the 2.4.15 case where a 50 m/s dry-intruded cyclone lost almost all
  // inner-core precipitation signature despite satellite imagery still showing a substantial convective arc.
  if (dryAirCoreExposure > 0.08) coreStructureFactor *= dryIntrusionAzimuthalSurvival;
  // Once inland, retain localized eyewall fragments/hot towers but remove the unrealistic
  // complete ring. The mask strengthens smoothly with land exposure.
  const landEyewallArcRetention = state.landed
    ? clamp(0.10 + 0.72 * residualLandCorePersistence * (0.62 + 0.38 * landConvectiveMask), 0.10, 0.90)
    : 0;
  coreStructureFactor *= state.landed
    ? Math.max(
      clamp((1 - 0.50 * landBreakupProgress) * (0.42 + 0.70 * landConvectiveMask), 0.12, 1.05),
      landEyewallArcRetention
    )
    : 1;
  const strengtheningCoreBoost = 1 + 0.52 * strengthening + (state.rapidIntensifying ? 0.38 : 0);
  const completeEyewallBoost = hasDefinedEye ? (1.08 + 0.22 * clearEye * integrity) : 1.0;
  // In a coherent super-typhoon inner core, extremely high condensate production is concentrated
  // in the eyewall/CDO rather than spread through the whole circulation. This selective boost fixes
  // underdone core totals without re-inflating remote rainband accumulations.
  const superTyEyewallBoost = 1 + 0.34 * superTyCore * integrity * (0.72 + 0.28 * coreCompactness);
  const eyewallRainIntensity = state.landed
    ? Math.max(intensity, rememberedRainIntensity * (0.52 + 0.48 * landConvectiveMemory) * (0.62 + 0.38 * landfallRainMemory))
    : intensity;
  const eyewallSuperTyMemory = state.landed ? Math.max(superTyCore, rememberedSuperTyCore * landfallRainMemory) : superTyCore;
  const primaryEyewall = (6.5 + 78 * Math.pow(eyewallRainIntensity, 1.10)) * primaryRing * coreStructureFactor * Math.max(0.46, 1 - 0.18 * Math.min(2.5, circulationExpansion)) *
    (0.68 + 0.44 * coreMoistureSupply + 0.28 * innerCoreMoisture) * strengtheningCoreBoost * completeEyewallBoost *
    (1 + 0.34 * eyewallSuperTyMemory * integrity * (0.72 + 0.28 * coreCompactness));

  const standoffOuterRadius = Math.max(eyewallRadius + 30 + 58 * secondaryEyewall,
    rmw * (1.75 + 1.45 * ewrcStandoffStrength + 0.85 * giantEyeOuterWallMemory));
  const secondaryRadius = (ewrcStandoffStrength > 0.12 || giantEyeOuterWallMemory > 0.10)
    ? standoffOuterRadius
    : eyewallRadius + 30 + 58 * secondaryEyewall;
  const secondaryRing = gauss(r - secondaryRadius, 14 + 15 * secondaryEyewall + 14 * giantEyeOuterWallMemory);
  const secondaryRainGate = Math.max(secondaryEyewall, 0.82 * ewrcStandoffStrength, 0.74 * giantEyeOuterWallMemory);
  const secondaryRain = (ewrcActive || ewrcStandoffStrength > 0.10 || giantEyeOuterWallMemory > 0.08)
    ? (3.5 + 24 * intensity) * secondaryRainGate * secondaryRing *
      (0.72 + 0.58 * moistureTransport) * (0.65 + 0.35 * sectorNoise)
    : 0;
  // When a damaged circulation returns to supportive ocean, convergence often reorganizes first
  // in a broader, asymmetric ring before a compact eyewall closes again. This produces a rainfall
  // rebound before full wind/intensity recovery and then contracts as structural damage fades.
  const reorganizationActive = !state.landed && damageSeverity > 0.10 && moistureReservoir > 0.48;
  const reorganizationRadius = eyewallRadius * (1.15 + 0.65 * damageSeverity);
  const reorganizationRing = reorganizationActive
    ? (2.0 + 19 * intensity) * damageSeverity * gauss(r - reorganizationRadius, 16 + 18 * damageSeverity) *
      (0.65 + 0.55 * moistureTransport) * (0.52 + 0.48 * sectorNoise)
    : 0;
  // Evaporative-cooling convergence ring: only develops when the engine diagnosed a persistent
  // eyewall cold pool. It is intentionally asymmetric and sits outside the primary eyewall,
  // representing the inner-rainband response seen when dry-air ventilation erodes a core.
  const coldPoolBandRadius = eyewallRadius * (1.34 + 0.30 * eyewallColdPoolMemory);
  const coldPoolBand = eyewallColdPoolMemory > 0.06
    ? (1.2 + 15.5 * intensity) * eyewallColdPoolMemory *
      gauss(r - coldPoolBandRadius, 11 + 12 * eyewallColdPoolMemory) *
      clamp(0.22 + 0.78 * moistArcLobe + 0.18 * moistArcFlanks, 0.10, 1.18) *
      (0.62 + 0.50 * coreMoistureSupply) * (0.62 + 0.38 * sectorNoise)
    : 0;
  const eyewall = Math.max(primaryEyewall, secondaryRain) + reorganizationRing + coldPoolBand;

  // Connecting bands and inner stratiform precipitation normally bridge the eyewall and the
  // principal rainband. A broad annular "moat" is a special concentric-eyewall/EWRC structure,
  // not the default state of every mature cyclone.
  const moatActive = (
    (ewrcActive && secondaryEyewall > 0.30) ||
    ewrcFailureMode === "inner_collapse_outer_stalls" ||
    (structureMode === "post_ewrc_broad" && secondaryEyewall > 0.18)
  );
  const bridgeInner = Math.max(eyewallRadius + 0.85 * eyewallWidth, rmw * 1.28);
  const bridgeOuter = Math.max(bridgeInner + 28, band1Center - (26 + 16 * sizeFromRadii));
  const bridgeMid = 0.5 * (bridgeInner + bridgeOuter);
  const bridgeSigma = Math.max(22, 0.48 * (bridgeOuter - bridgeInner));
  const connectingAz = clamp(0.48 + 0.38 * Math.max(primarySpiralGate, secondarySpiralGate) + 0.14 * sectorNoise, 0.32, 1.0);
  const moatCenter = eyewallRadius + 0.48 * Math.max(22, secondaryRadius - eyewallRadius);
  const moatSuppression = moatActive
    ? 1 - 0.68 * gauss(r - moatCenter, Math.max(13, 0.22 * Math.max(25, secondaryRadius - eyewallRadius)))
    : 1;
  const connectingBand = (1.0 + 3.7 * intensity + 2.8 * moistureTransport + 1.4 * hurricaneCore) *
    gauss(r - bridgeMid, bridgeSigma) * connectingAz * clamp(moatSuppression, 0.18, 1.0) *
    (0.78 + 0.22 * (1 - damageSeverity));

  // 5) CDO / center precipitation. A mature intense cyclone carries a comparatively uniform
  // 100-150 km dense inner-core convective shield around the eye/eyewall. Low-intensity storms
  // only receive loose central clusters. After landfall the CDO is retained for several hours,
  // then progressively loses continuity while the broader circulation can stay the same size.
  const recentlyLandedIntactCdo = state.landed && landHours <= 3.8 && landfallCoreVmaxMemory >= 41.5 &&
    terrainHollowCoreMemory < 0.10 && integrity >= 0.58 && damageSeverity < 0.48 && dryAirCoreExposure < 0.34 && convectiveSuppression < 0.50 &&
    deepConvectiveCoverage > 0.46;
  const dvorakCoherentCdoScene = dvorakHealthyMorphology && dvorakTNumber >= 5.2 &&
    integrity >= 0.50 && convectiveSuppression < 0.50 && deepConvectiveCoverage > 0.40 &&
    cdoDiameterKm >= 78;
  const matureCdoScene = (matureCdoEligible && deepConvectiveCoverage > 0.42 && (
    ["cdo_mature", "dvorak_cmg", "dvorak_cdg", "dvorak_w_ring", "mature_eyewall", "tightening_core", "landfall_intact_cdo"].includes(structureMode) ||
    (structureMode === "dry_slot_eroding" && dryAirCoreExposure < 0.30 && moistCoreProtection > 0.48 && moistEnvelopeIntegrity > 0.42) ||
    recentlyLandedIntactCdo
  )) || dvorakCoherentCdoScene;
  // Dry-air intrusion often destroys CDO *symmetry* before it destroys every deep convective
  // tower.  Represent the observed "dry leaf" stage as a partial CDO/eyewall arc instead of
  // dropping directly to a weak loose-central-cluster solution.
  const dryIntrudedCdoScene = !matureCdoScene && landfallCoreVmaxMemory >= 32.7 &&
    (dryAirCoreExposure >= 0.10 || dryAirWrapFraction >= 0.34) && dryAirCoreExposure < 0.94 && integrity >= 0.20 &&
    deepConvectiveCoverage > 0.12 &&
    ["dry_slot_eroding", "dry_leaf", "incense_coil", "westerly_sheared", "landfall_disintegrating",
      "failed_eye_opening", "sheared_convective_burst", "binary_interaction_sheared", "landfall_broken_eyewall"].includes(structureMode);
  const cdoRadiusKm = 0.5 * cdoDiameterKm;
  const cdoLandHoldHours = coherentStrongLandfallCore ? 4.2 : 2.8;
  const cdoLandIntegrity = state.landed
    ? clamp(
      (1 - (coherentStrongLandfallCore ? 0.035 : 0.055) * smooth01(landHours / cdoLandHoldHours)) *
      Math.exp(-Math.max(0, landHours - cdoLandHoldHours) /
        (11.5 + 5.5 * moistureReservoir + (coherentStrongLandfallCore ? 3.0 : 0))),
      coherentStrongLandfallCore ? 0.18 : 0.08,
      1
    )
    : 1;
  const cdoFragmentation = state.landed ? smooth01((landHours - 0.7) / 6.8) * landBreakupProgress : 0;
  const centerScale = structureMode === "dry_rebuilding_core"
    ? clamp(rebuiltCoreDiameterKm > 0 ? rebuiltCoreDiameterKm * 0.42 : rmw * 0.42, 8, 22)
    : matureCdoScene
      ? Math.max(32, cdoRadiusKm * 0.78)
      : Math.max(16, Math.min(48, rmw * (0.78 + 0.32 * weakSystem)));
  const centerEnvelope = gauss(r, centerScale);
  const looseCentralCluster = !matureCdoScene
    ? (1.2 + 5.5 * intensity + 4.5 * weakSystem) * centerEnvelope * (0.55 + 0.45 * sectorNoise)
    : 0;
  const blockedCenter = (3.0 + 12.5 * intensity) * obstruction * (1.0 + 0.36 * shearNorm);
  const centerClearSuppression = 1 - 0.93 * clearEye;
  const cdoEdgeWidth = Math.max(5.5, 0.10 * cdoDiameterKm);
  const cdoDisk = matureCdoScene ? 1 / (1 + Math.exp((r - cdoRadiusKm) / cdoEdgeWidth)) : 0;
  const cdoEyeHole = hasDefinedEye && eyeRadius > 0
    ? smooth01(clamp((r - Math.max(1.5, eyeRadius * 0.86)) / Math.max(2.5, eyeRadius * 0.34), 0, 1))
    : 1;
  // 3.7.5: cloud-top CDO size and low/mid-level precipitation-core size are deliberately
  // decoupled. A broad cold canopy does not imply a filled precipitation core. Dense precipitation follows
  // RMW/eyewall geometry first; compactification during strengthening therefore tightens the rain
  // core even while the IR canopy can remain broad.
  const structuralDenseCoreRadius = Math.max(
    rmw * (1.28 + 0.38 * (1 - coreCompactness)),
    34 + 18 * postPeakEnvelopeMemory
  );
  const denseCoreRadiusKm = clamp(
    structuralDenseCoreRadius * (0.94 + 0.06 * circulationExpansion + 0.04 * rainbandDominance),
    32, giantEyeOuterWallMemory > 0.18 ? 165 : 132
  );
  const compactRadiusFactor = 0.80 + 0.18 * largeInnerCoreHeavyRainSupport +
    0.08 * moderateCompactCoreSupport;
  const effectiveDenseCoreRadiusKm = denseCoreRadiusKm * clamp(compactRadiusFactor, 0.78, 1.02);
  const denseCoreEdgeWidth = Math.max(8, Math.min(22, 0.11 * effectiveDenseCoreRadiusKm));
  const denseCoreDisk = 1 / (1 + Math.exp((r - effectiveDenseCoreRadiusKm) / denseCoreEdgeWidth));
  const denseCoreEyeHole = cdoEyeHole;
  // Before landfall, roughness/moisture-flux contrast commonly makes the inner-core convection
  // lopsided even while satellite imagery still contains a recognizable CDO. Favor a broad
  // front/left sector in the Northern Hemisphere while preserving environmental shear asymmetry.
  const coastalPreferredBearing = wrap360(movementDir + (state.lat >= 0 ? -55 : 55));
  const coastalCdoLobe = gauss(angleDelta(bearing, coastalPreferredBearing), 70);
  // 3.7.5 continuity fix: the coastal inner-core asymmetry is a structural memory, not a binary
  // ocean/land switch. Previously the factor became exactly 1 on the first landed time step, which
  // instantly refilled the suppressed quadrants of a strong rain core and looked like a sudden
  // radial expansion at the shoreline. Carry the inherited coastal morphology inland and let it
  // relax over several hours as the vortex reorganizes/decays.
  const coastalMorphologyMemory = coastalCoreInfluence * (state.landed
    ? Math.exp(-Math.max(0, landHours) / 7.5)
    : 1);
  const coastalCdoAzimuthFactor = clamp(
    1 + coastalMorphologyMemory * (0.58 * coastalCdoLobe - 0.32),
    0.52, 1.36
  );
  const coastalBroadWeakCore = coastalCoreInfluence * smooth01((cdoDiameterKm - 118) / 54);
  const coastalCdoIntensityEfficiency = clamp(1 - 0.34 * coastalBroadWeakCore - 0.10 * coastalCoreInfluence, 0.58, 1);
  const intactDenseCoreScene = matureCdoScene && landfallCoreVmaxMemory >= 41.5 && organizedIntactCore > 0.30 &&
    dryAirCoreExposure < 0.38 && convectiveSuppression < 0.54;
  const cdoRainIntensity = state.landed ? Math.max(intensity, rememberedRainIntensity * (0.68 + 0.32 * landfallRainMemory)) : intensity;
  const cdoHurricaneMemory = state.landed ? Math.max(hurricaneCore, rememberedHurricaneCore * (0.62 + 0.38 * landfallRainMemory)) : hurricaneCore;
  const cdoSuperTyMemory = state.landed ? Math.max(superTyCore, rememberedSuperTyCore * landfallRainMemory) : superTyCore;
  // 4.1.3 Yagi-style cloud-top/precipitation decoupling: a mature cold CDO is mostly a cloud/anvil and
  // stratiform precipitation envelope.  Its areal coverage may be huge even when only a minority
  // of the low-level rain field is actively convective.  Size and stable organization increase the
  // stratiform share; RI bursts/compact cores decrease it.  This parameter controls broad CDO rain
  // filling only -- the explicit eyewall, hot-tower and rainband cells retain their own extremes.
  const cdoStratiformShare = matureCdoScene
    ? clamp(
      0.56 + 0.18 * sizeFromRadii + 0.10 * (1 - coreCompactness) + 0.08 * integrity +
      0.06 * weakening - 0.18 * convectiveBurstIndex - 0.10 * strengthening,
      0.38, 0.86
    )
    : 0;
  const broadCdoConvectiveFill = matureCdoScene ? clamp(1 - 0.58 * cdoStratiformShare, 0.48, 0.78) : 1;
  const cdoStratiformBackground = matureCdoScene
    ? (1.8 + 4.8 * cdoRainIntensity + 2.2 * cdoHurricaneMemory + 1.2 * cdoSuperTyMemory) * cdoDisk * cdoEyeHole *
      (0.70 + 0.38 * moistureTransport) * (0.74 + 0.26 * integrity) * cdoLandIntegrity *
      coastalCdoAzimuthFactor * (0.76 + 0.24 * cdoStratiformShare) *
      (state.landed ? ((1 - 0.72 * cdoFragmentation) + 0.72 * cdoFragmentation * (0.30 + 0.70 * landConvectiveMask)) : 1)
    : 0;
  const denseInnerCoreConvection = intactDenseCoreScene
    ? (7.5 + 11.5 * cdoRainIntensity + 8.0 * cdoHurricaneMemory + 5.5 * cdoSuperTyMemory) * denseCoreDisk * denseCoreEyeHole *
      (0.70 + 0.42 * moistureTransport) * (0.72 + 0.28 * integrity) *
      (0.72 + 0.28 * organizedIntactCore) * cdoLandIntegrity * coastalCdoAzimuthFactor * coastalCdoIntensityEfficiency *
      broadDenseCoreRainEfficiency *
      (state.landed ? ((1 - 0.74 * cdoFragmentation) + 0.74 * cdoFragmentation * (0.24 + 0.78 * landConvectiveMask)) : 1)
    : 0;
  const uniformCdoConvection = matureCdoScene
    ? (4.2 + 8.2 * cdoRainIntensity + 5.0 * cdoHurricaneMemory + 3.0 * cdoSuperTyMemory) * cdoDisk * cdoEyeHole *
      (0.72 + 0.44 * moistureTransport) * (0.76 + 0.24 * integrity) * (0.52 + 0.48 * deepConvectiveCoverage) * cdoLandIntegrity *
      coastalCdoAzimuthFactor * coastalCdoIntensityEfficiency * broadCdoConvectiveFill *
      (0.40 + 0.38 * largeInnerCoreHeavyRainSupport + 0.18 * moderateCompactCoreSupport) *
      (state.landed ? ((1 - cdoFragmentation) + cdoFragmentation * (0.16 + 0.82 * landConvectiveMask)) : 1)
    : 0;
  const cdoRingRadius = Math.max(eyeRadius * 1.20, Math.min(cdoRadiusKm * 0.58, rmw * 1.22));
  const cdoRingWidth = Math.max(8, Math.min(18, 0.16 * cdoDiameterKm));
  const matureCdoRing = matureCdoScene
    ? (3.8 + 11.5 * cdoRainIntensity + 5.0 * cdoSuperTyMemory) * gauss(r - cdoRingRadius, cdoRingWidth) *
      (0.70 + 0.46 * moistureTransport) * (0.72 + 0.28 * integrity) * cdoLandIntegrity *
      coastalCdoAzimuthFactor * coastalCdoIntensityEfficiency *
      (0.66 + 0.24 * largeInnerCoreHeavyRainSupport + 0.10 * moderateCompactCoreSupport)
    : 0;
  const denseCdoCoreRain = matureCdoScene ? (2.4 + 8.0 * superTyCore * integrity) *
    gauss(r - Math.max(0.56 * rmw, eyeRadius * 1.18), Math.max(12, 0.44 * rmw)) *
    (0.68 + 0.48 * coreMoistureSupply) * (1.0 - 0.72 * clearEye) * cdoLandIntegrity : 0;

  const dryCdoArcGate = clamp(
    0.05 + (0.54 + 0.12 * dryAirReMoistening) * moistArcLobe +
    (0.16 + 0.08 * dryAirReMoistening) * moistArcFlanks + 0.10 * innerCoreMoisture -
    (0.30 + 0.30 * eyewallOpenSectorFraction + 0.24 * dryAirCoreConnection) * drySlotLobe,
    0.02, 0.92
  );
  // Once ventilation reaches the core, the broad IR canopy is no longer used as a heavy-rain
  // footprint. Retain a compact remnant arc near the old RMW; the cloud shield may remain much
  // larger aloft, but the low/mid-level precipitation core collapses.
  const dryCdoRadialEnvelope = Math.max(
    0.18 * cdoDisk * dryEnvelopeContraction,
    gauss(r - Math.max(0.98 * rmw, eyeRadius * 1.28), Math.max(10, 0.34 * rmw))
  ) * cdoEyeHole;
  const dryDamagedDvorakCorePotential = clamp(
    dvorakConvectivePotential * (0.28 + 0.42 * Math.max(dryAirCoreExposure, damageSeverity)) *
    (0.42 + 0.38 * Math.max(moistCoreProtection, dryIntrudedCoreSurvival)) *
    (1 - 0.42 * dryAirCoreConnection),
    0, 0.82
  );
  const dryIntrudedCdoConvection = dryIntrudedCdoScene
    ? (5.2 + 14.0 * cdoRainIntensity + 7.5 * cdoHurricaneMemory + 3.5 * cdoSuperTyMemory +
        7.0 * dryDamagedDvorakCorePotential) *
      dryCdoRadialEnvelope * dryCdoArcGate * dryCoreLifecycleRetention *
      (0.54 + 0.28 * coreMoistureSupply + 0.20 * innerCoreMoisture) *
      (0.42 + 0.32 * dryIntrudedCoreSurvival + 0.18 * deepConvectiveCoverage) *
      (state.landed ? clamp(0.62 + 0.36 * landConvectiveMemory, 0.46, 0.94) : 1)
    : 0;

  // 2.6.4: a damaged inner core does not become precipitation-free.  Satellite/microwave
  // imagery often shows a ragged remnant centre plus a partial outer-eyewall-like convective arc
  // after dry-air erosion, shear damage, or the first hours after landfall.  This structure is
  // larger than the original eyewall, broken in azimuth, and can still host very deep convection.
  // Keep it distinct from a mature symmetric CDO so damage changes morphology rather than simply
  // scaling the whole core toward zero.
  const fragmentedCoreScene = landfallCoreVmaxMemory >= 30 && (
    dryAirCoreExposure >= 0.12 || damageSeverity >= 0.34 || state.isCoreDisrupted ||
    state.isStructureDamaged ||
    ["dry_slot_eroding", "dry_leaf", "incense_coil", "westerly_sheared", "landfall_disintegrating", "rainband_dominant",
      "failed_eye_opening", "sheared_convective_burst", "binary_interaction_sheared", "binary_merger_reorganizing",
      "landfall_broken_eyewall"].includes(structureMode)
  );
  // Damage that already existed offshore may legitimately have a broad fragmented shield at the
  // coast. Damage created *by* first land contact must grow into that morphology gradually. This
  // prevents a one-step switch into the 100-250 km damaged-core envelopes exactly at landfall.
  const preExistingFragmentDriver =
    dryAirCoreExposure >= 0.12 || dryAirWrapFraction >= 0.24 || coreRebuildScar >= 0.24 ||
    terrainHollowCoreMemory >= 0.12 || state.isCoreDisrupted ||
    (!state.landed && state.isStructureDamaged) ||
    ["dry_slot_eroding", "dry_leaf", "incense_coil", "westerly_sheared", "rainband_dominant",
      "failed_eye_opening", "sheared_convective_burst", "binary_interaction_sheared", "binary_merger_reorganizing",
      "landfall_broken_eyewall"].includes(structureMode);
  const landfallFragmentBroadRamp = state.landed
    ? 0.08 + 0.92 * smooth01((Math.max(0, landHours) - 0.30) / 3.2)
    : 1;
  const landfallFragmentCoreRamp = state.landed
    ? 0.38 + 0.62 * smooth01((Math.max(0, landHours) - 0.10) / 2.0)
    : 1;
  const fragmentBroadDevelopment = preExistingFragmentDriver ? 1 : landfallFragmentBroadRamp;
  const fragmentCoreDevelopment = preExistingFragmentDriver ? 1 : landfallFragmentCoreRamp;
  // 3.3.14: damaged-core fragments are anchored to diagnosed physics instead of a decorative
  // pseudo-random rotation cycle. Dry-air cases follow the surviving moist convective arc; terrain
  // cases favor the side opposite the strongest rough-land interaction; shear-only cases retain
  // the familiar downshear-side preference. The engine already evolves these bearings smoothly.
  const terrainFragmentBearing = wrap360((terrainHollowCoreMemory >= 0.12 ? terrainHollowCoreBearing : (state.terrainInteractionBearingDeg ?? movementDir)) + 165);
  const shearFragmentBearing = wrap360((state.shearDir ?? (state.direction ?? 300)) + 105);
  const fragmentRotation = dryAirCoreExposure > 0.08 || dryAirWrapFraction > 0.20
    ? dryAirConvectiveArcBearing
    : terrainCoreLandFraction > 0.08 || terrainFrictionAsymmetry > 0.16
      ? terrainFragmentBearing
      : shearFragmentBearing;
  const fragmentArcA = gauss(angleDelta(bearing, fragmentRotation), 30 + 18 * (1 - integrity) + 8 * dryAirReMoistening);
  const fragmentArcB = gauss(angleDelta(bearing, wrap360(fragmentRotation + 118)), 28 + 18 * damageSeverity);
  const fragmentArcC = 0.52 * gauss(angleDelta(bearing, wrap360(fragmentRotation - 132)), 24 + 18 * dryAirCoreExposure);
  const fragmentMoistArc = dryAirCoreExposure > 0.08
    ? clamp(0.16 + 0.78 * moistArcLobe + 0.28 * moistArcFlanks - 0.42 * drySlotLobe, 0.05, 1.12)
    : 1;
  const fragmentAzimuth = clamp(
    0.12 + 0.76 * Math.max(fragmentArcA, fragmentArcB, fragmentArcC) + 0.34 * fragmentMoistArc,
    0.08, 1.18
  );
  const fragmentInnerRadius = Math.max(1.02 * rmw, eyeRadius * 1.28, 18);
  const fragmentOuterRadius = Math.max(fragmentInnerRadius + 24, 1.72 * rmw, 42);
  const fragmentInnerRing = gauss(r - fragmentInnerRadius, Math.max(10, 0.34 * rmw + 7));
  const fragmentOuterRing = gauss(r - fragmentOuterRadius, Math.max(15, 0.42 * rmw + 11));
  // 2.6.6: damaged cores seen in microwave/IR imagery are not just one thin residual arc.
  // A ragged inner eyewall is commonly embedded in a wider 70-170 km inner-rainband / partial
  // outer-eyewall shield.  That wider shield is what builds the operational 50-250 mm lobes in
  // 24-h products.  Keep it azimuthally broken and rotating rather than restoring a symmetric CDO.
  // 2.6.7: damaged cores in the reference cases still carry a broad, rotating inner-rainband
  // shield.  The previous 70-170 km layer was too narrow, so a translating storm only left a
  // tiny 100-250 mm patch.  Widen the broken mesoscale shield without restoring a symmetric CDO.
  const fragmentMesoscaleRadius = Math.max(fragmentOuterRadius + 42, 2.55 * rmw, 88);
  const fragmentMesoscaleEnvelope = gauss(
    r - fragmentMesoscaleRadius,
    Math.max(31, 0.64 * rmw + 16)
  );
  const fragmentMesoscaleAzimuth = clamp(
    0.32 + 0.44 * Math.max(fragmentArcA, fragmentArcB, 0.72 * fragmentArcC) +
    0.38 * fragmentMoistArc + 0.12 * sectorNoise,
    0.20, 1.12
  );
  // A second, lower-rate broken shield represents the inner-rainband/stratiform complex just
  // outside the damaged eyewall.  It rotates with the same vortex and therefore paints broad
  // irregular 50-250 mm lobes over 24 h instead of a compact circular bullseye.
  const fragmentOuterShieldRadius = Math.max(fragmentMesoscaleRadius + 48, 3.15 * rmw, 132);
  const fragmentOuterShieldEnvelope = gauss(
    r - fragmentOuterShieldRadius,
    Math.max(42, 0.78 * rmw + 20)
  );
  const fragmentOuterShieldAzimuth = clamp(
    0.18 + 0.40 * Math.max(fragmentArcA, fragmentArcB, 0.68 * fragmentArcC) +
    0.30 * fragmentMoistArc + 0.18 * sectorNoise,
    0.10, 1.02
  );
  const naturalHollowAnnulus = terrainHollowCoreMemory >= 0.12
    ? gauss(r - Math.max(22, 1.05 * rmw, eyeRadius * 1.35), Math.max(11, 0.38 * rmw + 6)) *
      clamp(0.36 + 0.72 * Math.max(fragmentArcA, fragmentArcB, fragmentArcC), 0.24, 1.06)
    : 0;
  const fragmentCoreFill = terrainHollowCoreMemory >= 0.12
    ? naturalHollowAnnulus
    : Math.exp(-Math.pow(r / Math.max(34, 1.18 * fragmentOuterRadius), 2.15)) *
      (hasDefinedEye ? cdoEyeHole : (0.55 + 0.45 * gauss(r - 0.75 * rmw, Math.max(12, 0.45 * rmw))));
  const fragmentLandMemory = state.landed
    ? clamp(0.78 * landConvectiveMemory + 0.50 * residualLandCorePersistence, 0.40, 1.10)
    : 1;
  const fragmentedCoreIntensity = clamp(
    0.34 + 0.42 * cdoRainIntensity + 0.20 * Math.max(dryIntrudedCoreSurvival, organizedIntactCore) +
    0.12 * rememberedHurricaneCore + 0.18 * dryDamagedDvorakCorePotential,
    0.30, 1.28
  );
  // 3.3.16: a terrain-hollowed inner core is not a weaker copy of an intact CDO. Once the closed
  // eyewall ring has been severed by major terrain, the broad dense overcast / mesoscale inner
  // shield must collapse much faster than the surviving local convective arcs. Deep convection
  // can still flare around the hollow rim (and the explicit burst term below remains available),
  // but the old wide 15-30+ mm/h CDO shield is not allowed to persist and paint a broad 400+ mm
  // swath downstream. This is deliberately tied to the prognostic terrain-hollow memory rather
  // than a named island or an elapsed-time switch.
  const hollowFragmentDisruption = terrainHollowCoreMemory >= 0.12
    ? smooth01((terrainHollowCoreMemory - 0.10) / 0.72)
    : 0;
  const hollowInnerArcRetention = 1 - 0.24 * hollowFragmentDisruption;
  const hollowOuterArcRetention = 1 - 0.38 * hollowFragmentDisruption;
  const hollowMesoscaleRetention = 1 - 0.62 * hollowFragmentDisruption;
  const hollowOuterShieldRetention = 1 - 0.74 * hollowFragmentDisruption;
  const hollowCoreFillRetention = 1 - 0.68 * hollowFragmentDisruption;
  const dryFragmentRetention = (dryAirCoreExposure > 0.08 || dryAirWrapFraction > 0.24)
    ? clamp(dryCoreLifecycleRetention * (0.72 + 0.28 * fragmentMoistArc), 0.14, 0.82)
    : 1;
  const fragmentedCore = fragmentedCoreScene
    ? (
      (10.0 + 34.0 * fragmentedCoreIntensity) * fragmentInnerRing * hollowInnerArcRetention * fragmentCoreDevelopment *
        clamp(0.44 + 0.70 * fragmentAzimuth, 0.22, 1.16) +
      (7.0 + 27.0 * fragmentedCoreIntensity) * fragmentOuterRing * fragmentAzimuth * hollowOuterArcRetention * fragmentCoreDevelopment +
      // Wider damaged inner-rainband / partial outer-eyewall precipitation. For ordinary damage
      // this remains a useful 50-250 mm shield; after a severe mountain hollowing event it is
      // intentionally thinned so only broken arcs/cells, not a rebuilt CDO disk, carry the heavy tail.
      (6.2 + 17.5 * fragmentedCoreIntensity + 5.4 * dryDamagedDvorakCorePotential) *
        fragmentMesoscaleEnvelope * fragmentMesoscaleAzimuth * hollowMesoscaleRetention * fragmentBroadDevelopment +
      (4.8 + 12.8 * fragmentedCoreIntensity + 3.8 * dryDamagedDvorakCorePotential) *
        fragmentOuterShieldEnvelope * fragmentOuterShieldAzimuth * hollowOuterShieldRetention *
        Math.pow(fragmentBroadDevelopment, 1.15) +
      (4.0 + 12.0 * fragmentedCoreIntensity) * fragmentCoreFill * hollowCoreFillRetention * fragmentCoreDevelopment *
        clamp(0.44 + 0.60 * fragmentMoistArc, 0.26, 1.10)
    ) * (0.70 + 0.48 * coreMoistureSupply) * fragmentLandMemory * dryFragmentRetention *
      Math.max(0.36 + 0.12 * dryDamagedDvorakCorePotential, 1 - 0.42 * nonDryConvectiveSuppression)
    : 0;
  // Dry air has both directional and area-mean effects. The latter is essential: retaining one
  // moist arc must not compensate for entropy ventilation by creating a broader/stronger core.
  const dryCoreFactor = clamp(
    (1 - 0.52 * nonDryConvectiveSuppression) * dryCoreLifecycleRetention,
    0.16, 1
  );
  const rawLandCoreFactor = state.landed
    ? landConvectiveMemory * (1 - 0.52 * landfallDispersal) * (0.48 + 0.62 * landConvectiveMask)
    : 1;
  const landCoreFactor = state.landed
    ? clamp(Math.max(rawLandCoreFactor, 0.10 + 0.62 * residualLandCorePersistence), 0.10, 1)
    : 1;
  const rebuildingPulse = structureMode === "dry_rebuilding_core"
    ? clamp(
      0.30 +
      (0.24 + 0.24 * dryAirReMoistening) *
        gauss(angleDelta(bearing, dryAirConvectiveArcBearing), 34 + 16 * dryAirReMoistening) *
        (0.52 + 0.48 * Math.sin(simHour * Math.PI / 2.4) ** 2) +
      0.10 * moistArcFlanks,
      0.24, 0.82
    )
    : 1;
  // A clear eye excavates only the eye itself; it must not dim the surrounding mature CDO.
  // Low-intensity/blocked central clusters still respond to eye clearance, while the mature
  // CDO/eyewall fields already contain their own explicit eye hole.
  const looseCenterField = Math.max(looseCentralCluster, blockedCenter * centerEnvelope) * Math.max(0.10, centerClearSuppression);
  const matureCenterField = Math.max(
    cdoStratiformBackground,
    uniformCdoConvection,
    matureCdoRing,
    denseCdoCoreRain,
    denseInnerCoreConvection
  );
  const dryIntrudedCenterField = Math.max(dryIntrudedCdoConvection, dryIntrudedCdoScene ? 0.66 * primaryEyewall : 0);
  // Dry-air effects have already been applied directionally to dryIntrudedCdoConvection and the
  // fragmented core.  Do not multiply the surviving humid arc by another strong scalar penalty.
  const centerDrySectorFactor = dryIntrudedCdoScene || fragmentedCoreScene
    ? clamp(0.54 + 0.34 * dryMoistSectorSupport, 0.34, 0.88)
    : (dryAirCoreExposure > 0.08 ? clamp(0.48 + 0.38 * dryMoistSectorSupport, 0.28, 0.86) : 1);
  const hollowVoidRadius = Math.max(18, eyeRadius * 1.45, rmw * (0.62 + 0.24 * terrainHollowCoreMemory));
  const hollowCenterSurvival = terrainHollowCoreMemory >= 0.12
    ? 1 - clamp(0.52 + 0.46 * terrainHollowCoreMemory, 0, 0.94) * gauss(r, hollowVoidRadius)
    : 1;
  const center = Math.max(looseCenterField, matureCenterField, dryIntrudedCenterField, 0.82 * fragmentedCore) *
    (1 + 0.20 * strengthening) * Math.max(0.12, dryCoreFactor) *
    Math.max(0.08, landCoreFactor) * rebuildingPulse * centerDrySectorFactor * hollowCenterSurvival;
  // 6) RI / ERI / URI hot towers. Their azimuth and magnitude vary in time and they taper
  // automatically when the episode is aborting rather than disappearing instantly.
  const riActive = !!state.rapidIntensifying && vmax >= 22;
  const eriBoost = state.rapidIntensificationMode === "uri" ? 1.78 : state.rapidIntensificationMode === "eri" ? 1.55 : 1.0;
  const abortFade = state.rapidEpisodeAbortRequested ? 0.55 : 1.0;
  const burstPhase = wrap360(55 + hash01(Math.floor(simHour / 2) + vmax * 0.17) * 300);
  const burstAz = Math.max(
    gauss(angleDelta(bearing, burstPhase), 15),
    0.72 * gauss(angleDelta(bearing, burstPhase + 145), 19)
  );
  const burstRadCenter = terrainHollowCoreMemory >= 0.12
    ? Math.max(24, eyeRadius * 1.65, rmw * (1.02 + 0.18 * terrainHollowCoreMemory))
    : Math.max(eyeRadius * 1.7, rmw * 0.82);
  const burstRad = gauss(r - burstRadCenter, Math.max(8, rmw * (terrainHollowCoreMemory >= 0.12 ? 0.30 : 0.22)));
  const burstActivity = clamp(Math.max(convectiveBurstIndex, riActive ? 0.58 : 0));
  const dryBurstRetention = dryAirCoreExposure > 0.08
    ? (dryAirLifecyclePhase === "reorganizing"
      ? clamp(0.34 + 0.34 * dryAirReMoistening + 0.18 * dryMoistSectorSupport, 0.28, 0.78)
      : clamp(dryCoreLifecycleRetention * (0.68 + 0.28 * dryMoistSectorSupport), 0.12, 0.62))
    : 1;
  const convectiveBurst = burstActivity > 0.16
    ? (11 + 46 * intensity + 20 * strengthening) * (0.55 + 0.85 * burstActivity) * eriBoost * abortFade * burstAz * burstRad *
      (0.72 + 0.52 * coreMoistureSupply) * (0.62 + 0.55 * sectorNoise) * dryBurstRetention *
      Math.max(0.10, 1 - 0.72 * nonDryConvectiveSuppression) * Math.max(0.34, 1 - 0.58 * postDryBurstSuppression)
    : 0;

  // Rotating asymmetric recovery lobe. Engine advances the bearing continuously, so structure diagnostics,
  // station rainfall and the satellite scene all see the same burst wrap around the LLCC before
  // it can close into a new core. A rare brown-ocean cell uses the same local-sector geometry.
  const reburstAz = gauss(angleDelta(bearing, asymmetricReburstBearing), 24 + 18 * (1 - asymmetricReburstStrength));
  const reburstRad = gauss(r - Math.max(0.92 * rmw, eyeRadius * 1.55, 22), Math.max(8, 0.30 * rmw));
  const reburstLifecycleGate = dryAirLifecyclePhase === "reorganizing"
    ? clamp(0.28 + 0.52 * dryAirReMoistening - 0.22 * dryAirCoreConnection, 0.12, 0.72)
    : 0;
  const rotatingReburstRain = asymmetricReburstStrength > 0.05 && reburstLifecycleGate > 0
    ? (5 + 24 * intensity + 8 * strengthening) * asymmetricReburstStrength * reburstLifecycleGate * reburstAz * reburstRad *
      (0.62 + 0.46 * coreMoistureSupply) * Math.max(0.14, 1 - 0.64 * convectiveSuppression)
    : 0;
  const brownOceanLocalBurstRain = state.landed && brownOceanBurstIndex > 0.06
    ? (4 + 25 * intensity) * brownOceanBurstIndex * reburstAz *
      gauss(r - Math.max(rmw, 28), Math.max(9, 0.42 * rmw)) *
      clamp(0.48 + 0.62 * moistureTransport, 0.35, 1.25)
    : 0;

  // 6b) Rare mesoscale extreme-convection cells. They are intentionally narrow and
  // intermittent: TC inner cores statistically contain the strongest convection most often,
  // while outer rainbands can occasionally host cells as vigorous as or stronger than the core.
  // These cells provide local 400+ mm accumulation potential without turning an entire CDO or
  // rainband sector into continuous extreme rainfall.
  const deepConvectiveSupport = clamp(
    0.10 + 0.42 * intensity + 0.36 * hurricaneCore + 0.34 * moistureTransport +
    0.16 * strengthening + 0.12 * rainbandDominance + 0.12 * moistCoreProtection +
    0.10 * clamp((dvorakTNumber - 4.0) / 3.0) * (0.55 + 0.45 * coreCompactness) -
    0.44 * nonDryConvectiveSuppression - 0.07 * dryAirIntrusion - 0.08 * dryAirCoreExposure -
    0.05 * binaryInteractionStrength,
    0, 1.20
  );
  const coreExtremeWindow = Math.floor(simHour / 2.0);
  const coreExtremeTrigger = hash01(coreExtremeWindow * 97.31 + 13.7);
  // Extreme hot towers should be intermittent.  Earlier versions activated them in roughly half
  // of the 2-h windows of a strong cyclone, which made 600-800 mm maxima too routine.  A damaged
  // core may still exceed 500 mm, but normally through repeated remnant-eyewall rain rather than
  // an always-on synthetic hot tower.
  const damagedExtremePenalty = dryAirLifecyclePhase === "asymmetric_collapse" || dryAirLifecyclePhase === "residual_vortex"
    ? 0.16
    : (fragmentedCoreScene || dryAirCoreExposure > 0.18 ? 0.08 : 0);
  const coreExtremeActive = coreExtremeTrigger > (0.89 - 0.18 * deepConvectiveSupport + damagedExtremePenalty);
  const genericCoreExtremeAzimuth = wrap360(
    movementDir + 35 + 280 * hash01(coreExtremeWindow * 31.7 + 91.2)
  );
  // In a ventilated storm, hot towers are not free to appear in any quadrant: the surviving
  // moist arc / re-moistening side strongly biases where the deepest bursts can recur.
  const coreExtremeAzimuth = (dryAirCoreExposure > 0.08 || dryAirWrapFraction > 0.22)
    ? wrap360(dryAirConvectiveArcBearing + (hash01(coreExtremeWindow * 31.7 + 91.2) - 0.5) * (22 + 18 * (1 - dryAirReMoistening)))
    : genericCoreExtremeAzimuth;
  const coreExtremeAz = Math.max(
    gauss(angleDelta(bearing, coreExtremeAzimuth), 8.5 + 5.0 * (1 - coreCompactness)),
    0.62 * gauss(angleDelta(bearing, coreExtremeAzimuth + 128), 10.5)
  );
  const coreExtremeRad = gauss(
    r - Math.max(eyeRadius * 1.55, rmw * (0.92 + 0.22 * hash01(coreExtremeWindow * 17.9 + 7.4))),
    Math.max(5.5, 0.16 * rmw)
  );
  const coreExtremeDuration = 0.22 + 0.42 * hash01(coreExtremeWindow * 59.1 + 18.3);
  const inlandCoreSurvival = state.landed
    ? clamp(0.42 + 0.50 * landConvectiveMemory + 0.18 * moistFlatLandRetention -
      0.24 * physicalTerrainBreakup - 0.18 * dryAirCoreExposure, 0.24, 1)
    : 1;
  const dryCoreExtremeSector = dryAirCoreExposure > 0.08
    ? clamp(0.12 + 0.96 * moistArcLobe + 0.30 * moistArcFlanks - 0.30 * drySlotLobe, 0.06, 1.14)
    : 1;
  const coreExtremeCell = coreExtremeActive
    ? (78 + 118 * deepConvectiveSupport + 38 * superTyCore) * coreExtremeDuration * coreExtremeAz * coreExtremeRad *
      (0.66 + 0.52 * coreMoistureSupply) * inlandCoreSurvival * dryCoreExtremeSector *
      (dryAirCoreExposure > 0.08 ? clamp(0.34 + 0.66 * dryCoreLifecycleRetention, 0.24, 0.82) : 1) *
      Math.max(0.10, 1 - 0.68 * nonDryConvectiveSuppression) * (state.landed ? (0.35 + 0.80 * landConvectiveMask) : 1)
    : 0;

  const bandExtremeWindow = Math.floor(simHour / 3.0);
  const bandExtremeTrigger = hash01(bandExtremeWindow * 73.91 + 44.8);
  const bandExtremeActive = bandExtremeTrigger > (0.66 - 0.30 * deepConvectiveSupport - 0.09 * rainbandDominance);
  const bandExtremeUsesOuter = hash01(bandExtremeWindow * 29.3 + 5.2) > 0.72;
  const bandExtremeRadius = bandExtremeUsesOuter
    ? band2Center * (0.92 + 0.12 * hash01(bandExtremeWindow * 61.2 + 7.8))
    : band1Center * (0.82 + 0.34 * hash01(bandExtremeWindow * 41.4 + 19.6));
  const bandExtremeRad = gauss(r - bandExtremeRadius, bandExtremeUsesOuter ? 16 + 8 * sizeFromRadii : 11 + 7 * sizeFromRadii);
  const bandExtremeSectorDraw = hash01(bandExtremeWindow * 53.6 + 3.9);
  const bandExtremeJitter = (hash01(bandExtremeWindow * 37.1 + 12.8) - 0.5) * 54;
  const bandExtremeAge = simHour - bandExtremeWindow * 3.0;
  const bandExtremeRotationDegPerHour = 5.0 + 5.0 * hash01(bandExtremeWindow * 19.7 + 27.6);
  // Extreme cells follow whichever spiral packet is active; otherwise they can begin in any
  // quadrant.  They then rotate cyclonically instead of being hard-coded to N/NW sectors.
  const bandExtremeBaseBearing = bandComplexActive
    ? rotatingBandComplexBearing + bandExtremeJitter
    : 360 * bandExtremeSectorDraw + bandExtremeJitter;
  const bandExtremeAzimuth = wrap360(
    bandExtremeBaseBearing - bandExtremeAge * bandExtremeRotationDegPerHour +
    (r / Math.max(70, rmw)) * 8
  );
  const bandExtremeAz = Math.max(
    gauss(angleDelta(bearing, bandExtremeAzimuth), bandExtremeUsesOuter ? 7.2 : 8.8),
    0.48 * gauss(angleDelta(bearing, bandExtremeAzimuth + 118), 9.5)
  );
  const bandExtremeDuration = 0.12 + 0.26 * hash01(bandExtremeWindow * 83.5 + 11.1);
  const terrainCellBoost = options.isLand
    ? 1 + 0.28 * clamp(Math.max(0, options.elevation || 0) / 1600) + 0.10 * Math.exp(-landHours / 9)
    : 1;
  // Rotating bands crossing the coast gain a short-lived frictional/orographic pulse.  This is
  // deliberately compact: most coastal band passages only enhance 100-400 mm totals, while a
  // rare tiny cell can still become an extreme point.
  const coastalBandBurstNoise = rainNoise(groundXKm + 17, groundYKm - 29, simHour, 34, 3.2, 4451.7);
  const coastalBandBurstGate = options.isLand
    ? smooth01(clamp((coastalBandBurstNoise - 0.70) / 0.30, 0, 1)) *
      Math.exp(-Math.max(0, options.coastDistanceKm ?? 90) / 78) * Math.max(0.28, spiralSkeleton)
    : 0;
  // Ordinary deep cells embedded in a thrown-onshore rainband lose buoyancy rapidly after the
  // band penetrates inland. Keep a residual stratiform/band signal farther inland, but confine
  // the really heavy rainband cores to the coastal belt unless orographic lifting re-focuses them.
  const normalBandInlandSurvival = options.isLand
    ? clamp(0.22 + 0.78 * Math.exp(-Math.max(0, options.coastDistanceKm ?? 80) / 185), 0.22, 1)
    : 1;
  const normalBandExtremeCell = bandExtremeActive
    ? (48 + 76 * deepConvectiveSupport + 22 * intensity) * bandExtremeDuration * bandExtremeRad * bandExtremeAz *
      clamp(0.42 + 0.68 * Math.max(spiralGate, 0.35 * rainbandDominance), 0.22, 1.08) *
      (0.66 + 0.52 * moistureTransport) * terrainCellBoost * normalBandInlandSurvival *
      (1 + 0.42 * coastalBandBurstGate) *
      Math.max(0.18, 1 - 0.68 * nonDryConvectiveSuppression) *
      (dryAirCoreExposure > 0.08 ? clamp(0.62 + 0.46 * dryMoistSectorSupport, 0.35, 1.10) : 1) *
      (state.landed ? (0.50 + 0.66 * landConvectiveMask) : 1) *
      (1 - 0.28 * organizedIntactCore)
    : 0;

  // Exceptionally intense rainband cores can still occur, but they are point-like events rather
  // than broad sectors.  The very small radial/azimuthal footprint means a 400-800 mm 24-h pixel
  // is possible only when a rare cell repeatedly trains over nearly the same coastal location.
  const bandHyperTrigger = hash01(bandExtremeWindow * 211.37 + 907.2);
  const bandHyperActive = bandExtremeActive && deepConvectiveSupport > 0.70 &&
    bandHyperTrigger > 0.986 && (!options.isLand || Math.max(0, options.coastDistanceKm ?? 999) < 180);
  const bandHyperRad = gauss(r - bandExtremeRadius, 5.2 + 2.6 * sizeFromRadii);
  const bandHyperAz = gauss(angleDelta(bearing, bandExtremeAzimuth), 3.8 + 1.8 * sizeFromRadii);
  const bandHyperDuration = 0.08 + 0.13 * hash01(bandExtremeWindow * 117.9 + 73.4);
  const bandHyperCell = bandHyperActive
    ? (165 + 135 * deepConvectiveSupport + 36 * intensity) * bandHyperDuration * bandHyperRad * bandHyperAz *
      (0.72 + 0.48 * moistureTransport) * Math.max(0.20, 1 - 0.70 * nonDryConvectiveSuppression) *
      (dryAirCoreExposure > 0.08 ? clamp(0.58 + 0.52 * dryMoistSectorSupport, 0.32, 1.10) : 1)
    : 0;
  const coastalBandExtremeCell = options.isLand
    ? (22 + 62 * deepConvectiveSupport + 18 * intensity) * coastalBandBurstGate *
      gauss(r - bandExtremeRadius, 13 + 6 * sizeFromRadii) * bandExtremeAz *
      (0.62 + 0.48 * moistureTransport) * Math.max(0.24, 1 - 0.62 * nonDryConvectiveSuppression)
    : 0;
  const bandExtremeCell = normalBandExtremeCell + bandHyperCell + coastalBandExtremeCell;
  // Over low-relief inland plains a decaying but broad/moist vortex can continue to produce
  // several separated convective rain centres even after Vmax has fallen to tropical-storm
  // strength.  These cells require a moist column and benign shear/dry-air environment; they
  // are generated by a slowly evolving ground-relative field so a 24-h accumulation contains
  // a handful of coherent maxima rather than random pixel-scale speckle.
  const terrainSlopeMagnitude = Math.hypot(options.terrainSlopeEast || 0, options.terrainSlopeNorth || 0);
  // A broad post-landfall vortex does not stop raining merely because the terrain is no longer an
  // ideal flat plain.  Low hills and rolling terrain remain inside the moist boundary-layer
  // circulation and can actually focus ascent.  Keep the old lowland factor for the 18-20 m/s wind
  // shelf, but diagnose a wider plain/hill rainfall support separately below.
  const lowlandFactor = options.isLand && state.landed
    ? clamp((760 - Math.max(0, options.elevation || 0)) / 650, 0, 1) *
      clamp((9.5 - terrainSlopeMagnitude) / 8.0, 0.28, 1)
    : 0;
  const inlandPlainHillFactor = options.isLand && state.landed
    ? clamp((1450 - Math.max(0, options.elevation || 0)) / 1320, 0.12, 1) *
      clamp((20.0 - terrainSlopeMagnitude) / 17.0, 0.18, 1)
    : 0;
  // Rolling hills frequently focus residual TC convection after landfall. This factor deliberately
  // peaks below true mountain-ridge terrain: plains retain broad convergence, hills gain lift, while
  // steep/high terrain is handled by the explicit orographic module and can disrupt the vortex core.
  const rollingHillConvectiveFactor = options.isLand && state.landed
    ? inlandPlainHillFactor *
      clamp((terrainSlopeMagnitude - 0.7) / 5.8, 0, 1) *
      clamp((1180 - Math.max(0, options.elevation || 0)) / 1020, 0, 1)
    : 0;
  const giantInlandCirculation = r7Mean > 0
    ? smooth01(clamp((r7Mean - 330) / 105, 0, 1))
    : smooth01(clamp((sizeFromRadii - 0.68) / 0.28, 0, 1));
  const inlandBenignEnvironment = clamp((22 - shearKt) / 13, 0, 1) *
    (1 - 0.55 * clamp((dryAirIntrusion - 0.20) / 0.70, 0, 1));
  const localInlandMoistSupport = clamp((moistureReservoir - 0.20) / 0.70, 0, 1) *
    clamp((moistureTransport - 0.16) / 0.76, 0, 1);
  const advectedPlainMoistSupport = clamp((ambientMoistureTransport - 0.20) / 0.82, 0, 1) *
    (0.68 + 0.32 * broadMoisturePlatform) * (0.70 + 0.30 * sizeFromRadii);
  const inlandMoistSupport = Math.max(localInlandMoistSupport, 0.62 * advectedPlainMoistSupport);
  const inlandDynamicWindGate = clamp((vmax - 12.0) / 15.0, 0, 1);
  const inlandResidualVortexGate = clamp(
    0.22 + 0.58 * lowLevelVortexIntegrity + 0.20 * postPeakEnvelopeMemory,
    0, 1.08
  );
  const inlandVortexSupport = Math.max(inlandDynamicWindGate, 0.82 * inlandResidualVortexGate) *
    (0.42 + 0.58 * sizeFromRadii) * (0.55 + 0.45 * broadMoisturePlatform);
  const inlandLife = state.landed ? clamp(1 - Math.max(0, landHours - 3) / 58, 0.24, 1) : 0;
  const largePlainCirculationSupport = lowlandFactor * inlandBenignEnvironment *
    clamp((sizeFromRadii - 0.18) / 0.82, 0, 1) *
    clamp((ambientMoistureTransport - 0.22) / 0.78, 0, 1) *
    clamp((Math.max(vmax, rememberedRainVmax) - 13.0) / 24.0, 0, 1);
  const rollingHillConvectiveSupport = rollingHillConvectiveFactor * inlandBenignEnvironment *
    inlandMoistSupport * inlandVortexSupport * inlandLife * (0.74 + 0.26 * broadMoisturePlatform);
  const inlandConvectiveSupport = clamp(
    Math.max(
      lowlandFactor * inlandBenignEnvironment * inlandMoistSupport * inlandVortexSupport * inlandLife,
      0.78 * largePlainCirculationSupport * inlandLife,
      0.86 * rollingHillConvectiveSupport
    ),
    0, 1
  );
  // The ~18 m/s inland shelf is an intensity phenomenon, not a translation-speed brake.
  // A coherent residual vortex can keep organizing rainbands over ordinary inland terrain; only
  // genuinely high/rugged mountain terrain should strongly veto the shelf. The bell-shaped factor
  // peaks near tropical-storm strength and vanishes for very weak remnants.
  const weakPlainShelfIntensity = state.landed && vmax < 20.4
    ? smooth01(clamp((20.4 - vmax) / 1.8, 0, 1)) * smooth01(clamp((vmax - 15.2) / 2.4, 0, 1))
    : 0;
  const shelfMemorySupport = clamp(state.plainTsShelfMemory ?? 0, 0, 1) *
    clamp(1 - Math.max(0, (state.plainTsShelfHours ?? 0) - 24) / 36, 0.28, 1);
  // 3.3.25: retain strong, broken/banded precipitation through the residual-vortex shelf without
  // forcing a flat-plain-only regime. Elevation and steepness are used only to suppress true high
  // mountain crossings; plains/low hills still receive an extra persistence advantage.
  const nonMountainShelfRainGate = options.isLand && state.landed
    ? clamp((2100 - Math.max(0, options.elevation || 0)) / 1450, 0.10, 1) *
      clamp((31 - terrainSlopeMagnitude) / 24, 0.18, 1)
    : 0;
  const shelfTerrainRainGate = clamp(Math.max(0.62 * nonMountainShelfRainGate, lowlandFactor, 0.78 * rollingHillConvectiveFactor), 0, 1);
  const weakPlainRainSupport = clamp(
    Math.max(weakPlainShelfIntensity, 0.82 * shelfMemorySupport) * shelfTerrainRainGate * inlandBenignEnvironment *
    clamp(inlandMoistSupport * (0.72 + 0.40 * sizeFromRadii) * (0.72 + 0.36 * broadMoisturePlatform), 0, 1) *
    (0.64 + 0.36 * lowLevelVortexIntegrity),
    0, 1
  );
  const inlandCellA = rainNoise(groundXKm, groundYKm, simHour, 86, 5.5, 1811.7);
  const inlandCellB = rainNoise(groundXKm + 23, groundYKm - 17, simHour, 146, 9.0, 2237.9);
  const inlandCellSeed = clamp(0.70 * inlandCellA + 0.30 * inlandCellB, 0, 1);
  // 3.7.4: inland convection is persistent but spatially sparse. The old permissive cell gate
  // made too many neighbouring points rain convectively, producing smooth 50-250 mm carpets.
  const inlandCellGate = smooth01(clamp((inlandCellSeed - 0.57) / 0.34, 0, 1));
  const shelfCellSeed = rainNoise(groundXKm - 71, groundYKm + 49, simHour, 118, 11.0, 3187.3);
  const shelfCellGate = smooth01(clamp((shelfCellSeed - 0.53) / 0.34, 0, 1));
  const inlandCellRadius = 110 + 85 * sizeFromRadii + 18 * lowLevelVortexIntegrity;
  const inlandCellEnvelope = Math.exp(-Math.pow(r / Math.max(70, inlandCellRadius), 1.72)) *
    clamp(0.54 + 0.52 * landBroadNoise + 0.18 * groundMoistureTopology, 0.42, 1.16);
  const primaryInlandCells = (3.2 + 27 * inlandConvectiveSupport) * inlandConvectiveSupport * inlandCellGate;
  const shelfRainCells = (5.2 + 34 * weakPlainRainSupport) * weakPlainRainSupport *
    Math.max(shelfCellGate, 0.52 * inlandCellGate);
  const inlandScatteredConvection = (primaryInlandCells + shelfRainCells) *
    inlandCellEnvelope * (0.76 + 0.24 * environmentalRainAsymmetry);


  // 3.3.21: ground-relative mesoscale training cells inside the post-landfall rain shield.
  // Strong landfalls do not produce a smooth 250-400 mm carpet: frictional convergence,
  // residual-vortex arcs and small terrain/land-use convergence zones can repeatedly trigger
  // cells at a few preferred locations. These cells are anchored to the ground for several
  // hours, then decay, so a 24-h product naturally develops isolated 400-600 mm pockets inland
  // while neighbouring grid cells remain 100-400 mm. The mechanism is not keyed to a province
  // or track and is capped at the hourly level; 600+ still requires repeated/focused residence.
  const trainingCycleHours = 8.5;
  const trainingEpoch = Math.floor(simHour / trainingCycleHours);
  const trainingFrac = (simHour / trainingCycleHours) - trainingEpoch;
  const trainingPulse = Math.pow(Math.max(0, Math.sin(Math.PI * trainingFrac)), 0.52);
  const trainingGroundA = rainNoise(groundXKm + 59, groundYKm - 101, simHour, 82, 9.0, 11831.7);
  const trainingGroundB = rainNoise(groundXKm - 143, groundYKm + 67, simHour, 46, 11.0, 11857.1);
  const trainingCellGate = smooth01(clamp((0.70 * trainingGroundA + 0.30 * trainingGroundB - 0.62) / 0.27, 0, 1));
  const trainingRadialEnvelope = Math.max(
    Math.exp(-Math.pow(r / Math.max(92, 2.45 * rmw + 68 * sizeFromRadii), 1.58)),
    0.24 * gauss(r - Math.max(185, 3.2 * rmw), 76 + 24 * sizeFromRadii)
  );
  const trainingProcessSupport = clamp(
    0.32 * inlandConvectiveSupport + 0.22 * inlandMoistSupport + 0.16 * lowLevelVortexIntegrity +
      0.12 * Math.max(frictionConvergenceLobe, shearFrictionOverlap) + 0.10 * rainbandDominance +
      0.08 * broadMoisturePlatform,
    0, 1.12
  );
  const stalledInlandTraining = clamp((11 - (state.speed ?? 18)) / 9, 0, 1) *
    inlandMoistSupport * (0.55 + 0.45 * lowLevelVortexIntegrity) * (1 - 0.62 * dryAirCoreExposure);
  const rareTrainingSeed = rainNoise(groundXKm + 211, groundYKm - 177, simHour, 38, 11.0, 12971.3);
  const rareTrainingGate = smooth01(clamp((rareTrainingSeed - 0.64) / 0.27, 0, 1));

  // 3.7.7: a slow/stalled post-landfall vortex carries its convergence maximum inland with the
  // circulation centre.  The previous implementation required a rare gate *and* the zero-to-one
  // training pulse at the same time, which could leave a 24 h inland-stationary cyclone with a
  // conspicuous dry hole near its centre while old coastal convergence kept accumulating rain.
  // Keep this component patchy and ground-relative, but give it a non-zero temporal duty cycle
  // once a moist low-level vortex has remained inland for several hours.
  const stalledCoreMaturity = state.landed
    ? smooth01(clamp((Math.max(0, landHours) - 4) / 16, 0, 1))
    : 0;
  const stalledCoreRadius = Math.max(78, 1.85 * rmw + 58 + 54 * sizeFromRadii);
  const stalledCoreEnvelope = Math.exp(-Math.pow(r / stalledCoreRadius, 1.66));
  const stalledCoreNoise = rainNoise(groundXKm - 89, groundYKm + 137, simHour, 64, 14.0, 13117.9);
  const stalledCoreTexture = 0.30 + 0.70 * smooth01(clamp((stalledCoreNoise - 0.36) / 0.48, 0, 1));
  const stalledInlandCoreRain = state.landed && options.isLand
    ? (3.5 + 19.5 * stalledInlandTraining) * stalledInlandTraining * stalledCoreMaturity *
      stalledCoreEnvelope * stalledCoreTexture * (0.62 + 0.38 * trainingPulse) *
      (0.58 + 0.42 * lowLevelVortexIntegrity) * (0.70 + 0.30 * environmentalRainAsymmetry)
    : 0;

  const inlandMesoscaleTrainingCell = state.landed && options.isLand
    ? Math.min(92,
      (2.2 + 24.0 * trainingProcessSupport) * trainingProcessSupport * trainingCellGate *
        trainingPulse * trainingRadialEnvelope * (0.70 + 0.30 * environmentalRainAsymmetry) +
      58 * stalledInlandTraining * stalledInlandTraining * rareTrainingGate * trainingPulse *
        trainingRadialEnvelope * Math.pow(Math.max(trainingCellGate, 0.16), 1.35) +
      stalledInlandCoreRain
    )
    : 0;

  // 2.4.14: once the circulation centre is inland, the rain shield must travel inland with it.
  // Do not leave the heavy-rain physics pinned to the coastline.  A broad, moist vortex can
  // sustain a compact-to-mesoscale inland rain shield for many hours through its inherited
  // moist entropy, low-level convergence and continued environmental moisture transport.
  // The shield is deliberately irregular and patchy rather than an annulus, and it broadens
  // as the low-level circulation loosens while its convective intensity gradually decreases.
  const coastDistanceForInlandFeed = Math.max(0, options.coastDistanceKm ?? 999);
  const marineMoistureReach = Math.exp(-coastDistanceForInlandFeed / (360 + 95 * sizeFromRadii)) *
    (0.68 + 0.32 * sizeFromRadii);
  const inheritedStrongLandfallMoisture = landfallRainMemory *
    (0.52 + 0.48 * clamp(ambientMoistureTransport / 1.20, 0, 1.15));
  const inlandMoistureMemory = state.landed
    ? clamp(
      0.42 * moistureReservoir +
      0.29 * clamp(ambientMoistureTransport / 1.25, 0, 1.15) +
      0.13 * broadMoisturePlatform +
      0.20 * inheritedStrongLandfallMoisture +
      0.16 * marineMoistureReach * clamp(ambientMoistureTransport / 1.15, 0, 1.15),
      0, 1.28
    )
    : 0;
  // 3.7.4: retain the post-landfall rain envelope substantially longer than the compact wind
  // core. This delays rainfall decay without keeping the field axisymmetric or uniformly heavy.
  const inlandTimePersistence = state.landed
    ? clamp(
      Math.exp(-Math.max(0, landHours - 22) / (96 + 28 * sizeFromRadii)) *
      (0.91 + 0.09 * Math.exp(-landHours / 52)) *
      (1 + 0.18 * landfallRainMemory + 0.19 * lowLevelVortexIntegrity * postPeakEnvelopeMemory),
      0.14, 1.18
    )
    : 0;
  const inlandIntensitySupport = clamp((Math.max(vmax, rememberedRainVmax * (0.58 + 0.42 * landfallRainMemory)) - 10.5) / 24, 0, 1.12) *
    (0.50 + 0.50 * sizeFromRadii);
  const diagnosedInlandRainSupport =
    inlandMoistureMemory * inlandTimePersistence * inlandIntensitySupport *
    Math.max(0.34, 1 - 0.46 * nonDryConvectiveSuppression - 0.15 * dryAirCoreExposure) *
    (0.76 + 0.24 * Math.max(0.30, 1 - 0.55 * dryAirCoreExposure));
  // If a strong residual core is still diagnosed, do not let a depleted *local* reservoir erase
  // the moving inland rain shield. Environmental inflow and the storm's large moist envelope can
  // maintain moderate/heavy rain even when the compact eyewall is already asymmetric.
  const residualCoreInlandSupport = state.landed
    ? residualLandCorePersistence * inlandTimePersistence *
      (0.44 + 0.36 * clamp(ambientMoistureTransport / 1.20, 0, 1) + 0.20 * sizeFromRadii)
    : 0;
  const inlandRainSupport = clamp(Math.max(diagnosedInlandRainSupport, residualCoreInlandSupport), 0, 1.28);
  // Keep the weak outer rain shield compact, but allow moderate/heavy inland rain to occupy the
  // inner 120-220 km of a large residual vortex. This prevents the 25-50 mm field from becoming
  // huge while simultaneously starving the inland 50-250 mm swath.
  const inlandLooseRadius = (68 + 52 * sizeFromRadii + 20 * circulationExpansion) *
    (1 + 0.18 * structuralDisorganization + 0.08 * landfallDispersal);
  const inlandShapeLobeA = gauss(angleDelta(bearing, wrap360(movementDir + 165)), 82);
  const inlandShapeLobeB = gauss(angleDelta(bearing, wrap360(shearDir - 55)), 76);
  const inlandShape = clamp(
    0.70 + 0.20 * inlandShapeLobeA + 0.18 * shearNorm * inlandShapeLobeB +
    0.22 * (groundMoistureTopology - 0.5) + 0.16 * (landBroadNoise - 0.5),
    0.54, 1.28
  );
  const inlandVortexEnvelope = Math.exp(-Math.pow(r / Math.max(55, inlandLooseRadius * inlandShape), 1.65));
  const inlandDryMoistShape = dryAirCoreExposure > 0.08
    ? clamp(0.52 + 0.62 * moistArcLobe + 0.18 * moistArcFlanks - 0.28 * drySlotLobe, 0.30, 1.22)
    : 1;
  // Broad inland rain should be a patchy/lobed shield, not a uniform orange disk.  Lower the
  // background instantaneous rate and move the recovered water into residual-core arcs/cells.
  const inlandVortexBackground = (0.72 + 3.8 * rememberedRainIntensity + 2.3 * sizeFromRadii + 2.0 * weakening) *
    inlandRainSupport * inlandVortexEnvelope *
    (0.46 + 0.22 * landBroadRainMask + 0.24 * landBroadPatch) * inlandDryMoistShape;
  const inlandVortexCellEnvelope = Math.exp(-Math.pow(
    r / Math.max(72, 0.92 * inlandLooseRadius + 0.65 * rmw),
    1.62
  ));
  const inlandVortexCells = (3.2 + 20.0 * inlandRainSupport + 7.2 * rememberedRainIntensity) *
    inlandRainSupport * inlandVortexCellEnvelope *
    Math.pow(Math.max(0.08, inlandCellGate), 1.22) * (0.44 + 0.56 * landConvectiveMask) *
    clamp(0.40 + 0.62 * landCellNoise + 0.20 * landFineNoise, 0.22, 1.16);
  const inlandResidualCoreRadius = 50 + 42 * sizeFromRadii + 16 * landfallDispersal;
  const inlandResidualCoreEnvelope = Math.exp(-Math.pow(r / Math.max(48, inlandResidualCoreRadius), 1.80));
  const inlandResidualCorePatch = clamp(0.46 + 0.34 * landCellNoise + 0.20 * landBroadNoise, 0.30, 1.08);
  // Several hours inland, the strongest rain usually migrates away from the pressure/wind centre.
  // Frictional convergence, shear and terrain then dominate. Keep a weak central remnant but move
  // most convective support into one/two broad off-centre lobes instead of a circular bullseye.
  const inlandDisplacementProgress = state.landed
    ? clamp(Math.max(
      0.82 * physicalTerrainBreakup,
      0.58 * terrainFrictionAsymmetry * (0.35 + 0.65 * terrainCoreLandFraction),
      0.52 * shearNorm * structuralDisorganization,
      0.46 * dryAirCoreExposure * (0.45 + 0.55 * dryAirCoreConnection),
      0.36 * structuralDisorganization
    ), 0, 1)
    : 0;
  const inlandPreferredA = wrap360(movementDir + (state.lat >= 0 ? -105 : 105));
  const inlandPreferredB = wrap360(shearDir + (state.lat >= 0 ? 75 : -75));
  // Boundary-layer convergence generated on the rough-land side is advected cyclonically before
  // hydrometeors reach the surface. Observational/model studies commonly diagnose a displaced
  // convective maximum rather than one remaining over the pressure centre.
  const terrainFrictionRainBearing = wrap360(terrainInteractionBearing + (state.lat >= 0 ? 78 : -78));
  const terrainFrictionRainLobe = gauss(
    angleDelta(bearing, terrainFrictionRainBearing),
    48 + 22 * (1 - terrainFrictionAsymmetry)
  );
  const inlandDisplacedAzimuth = clamp(Math.max(
    gauss(angleDelta(bearing, inlandPreferredA), 62),
    0.76 * gauss(angleDelta(bearing, inlandPreferredB), 68),
    (0.36 + 0.78 * physicalTerrainBreakup) * terrainFrictionRainLobe
  ), 0, 1.22);
  const inlandDisplacedRadius = Math.max(70, 1.55 * rmw + 28 * landfallDispersal);
  const inlandDisplacedRing = gauss(r - inlandDisplacedRadius, 42 + 24 * sizeFromRadii);
  const terrainDamageCentreVoid = clamp(
    0.18 * terrainCoreLandFraction + 0.54 * physicalTerrainBreakup + 0.20 * structuralDisorganization +
      0.78 * terrainHollowCoreMemory,
    0, 0.97
  );
  const inlandCentreDamage = clamp(
    0.70 * terrainDamageCentreVoid + 0.28 * dryAirCoreExposure +
      0.22 * shearNorm * structuralDisorganization + 0.12 * landEnvironmentDamage,
    0, 0.88
  );
  const inlandCentreVoid = 1 - inlandCentreDamage * gauss(r, Math.max(38, 0.78 * inlandResidualCoreRadius));
  const inlandCoreShape = clamp(
    (1 - 0.48 * inlandDisplacementProgress) +
    inlandDisplacementProgress * (0.48 + 0.76 * inlandDisplacedAzimuth * (0.62 + 0.38 * inlandDisplacedRing)),
    0.28, 1.24
  );
  const inlandResidualCoreRain = (3.0 + 14.0 * rememberedRainIntensity + 10.0 * landfallRainMemory +
    5.4 * rememberedHurricaneCore + 6.2 * dryIntrudedCoreSurvival) *
    inlandRainSupport * inlandResidualCoreEnvelope * inlandResidualCorePatch * inlandCentreVoid * inlandCoreShape *
    (dryAirCoreExposure > 0.08 ? clamp(0.48 + 0.70 * dryMoistSectorSupport, 0.28, 1.20) : 1) *
    Math.max(0.34, 1 - 0.52 * landfallDispersal);
  const inlandVortexRain = state.landed && options.isLand
    ? inlandVortexBackground + inlandVortexCells + inlandResidualCoreRain
    : 0;

  // 3.3.3: large-circulation inland rain shield.  This is deliberately tied to the diagnosed R7
  // footprint rather than a named province or a single storm.  Once mean R7 is around 380 km or
  // larger, the low-level vortex can keep importing/redistributing moisture hundreds of kilometres
  // inland even after Vmax has fallen.  Plains receive a broad 2-8 mm/h shield; rolling hills add
  // a flow-facing orographic term that can support embedded 10-25+ mm/h cells.
  const inlandFlowLen = Math.max(0.3, lowLevelFlowSpeed);
  const inlandFlowEast = lowLevelFlowEast / inlandFlowLen;
  const inlandFlowNorth = lowLevelFlowNorth / inlandFlowLen;
  const inlandSlopeAlongFlow = inlandFlowEast * (options.terrainSlopeEast ?? 0) +
    inlandFlowNorth * (options.terrainSlopeNorth ?? 0);
  const inlandHillLift = clamp(inlandSlopeAlongFlow / 15.0, 0, 1) *
    clamp((terrainSlopeMagnitude - 0.55) / 9.2, 0, 1) *
    clamp((1350 - Math.max(0, options.elevation || 0)) / 1260, 0.12, 1);
  const giantMoistFeed = clamp(
    0.29 * clamp(ambientMoistureTransport / 1.20, 0, 1.15) +
    0.22 * Math.sqrt(moistureReservoir) +
    0.14 * broadMoisturePlatform +
    0.12 * landfallRainMemory +
    0.13 * lowLevelVortexIntegrity +
    0.10 * postPeakEnvelopeMemory +
    0.18 * marineMoistureLink, 0, 1.25
  );
  const giantInlandLife = state.landed
    ? clamp(Math.exp(-Math.max(0, landHours - 10) / (90 + 26 * giantInlandCirculation)) *
      (0.64 + 0.24 * giantMoistFeed + 0.12 * lowLevelVortexIntegrity + 0.14 * marineMoistureLink) *
      (1 + 0.14 * postPeakEnvelopeMemory), 0.20, 1.20)
    : 0;
  const giantInlandRadius = 135 + 92 * giantInlandCirculation + 45 * sizeFromRadii + 16 * circulationExpansion;
  const giantInlandEnvelope = Math.exp(-Math.pow(r / Math.max(120, giantInlandRadius), 1.42));
  const giantInlandPatch = clamp(
    0.64 + 0.22 * rainNoise(groundXKm + 37, groundYKm - 21, simHour, 150, 13.5, 4673.2) +
    0.14 * groundMoistureTopology, 0.52, 1.08
  );
  const giantPlainRain = (0.42 + 2.35 * giantInlandCirculation + 1.70 * giantMoistFeed +
    1.05 * rememberedRainIntensity) * giantInlandCirculation * inlandPlainHillFactor *
    giantMoistFeed * giantInlandLife * giantInlandEnvelope * giantInlandPatch *
    // Core dry-air damage does not immediately erase a 300-500 km low-level moisture conveyor.
    Math.max(0.50, 1 - 0.18 * dryAirCoreExposure - 0.22 * shearNorm) *
    (0.76 + 0.24 * lowLevelVortexIntegrity);
  const giantHillRain = (1.55 + 8.6 * giantInlandCirculation + 7.2 * giantMoistFeed +
    2.6 * rememberedHurricaneCore) * giantInlandCirculation * inlandHillLift *
    giantMoistFeed * giantInlandLife *
    Math.exp(-Math.pow(r / Math.max(145, giantInlandRadius * 1.08), 1.48)) *
    clamp(0.66 + 0.34 * landCellNoise, 0.54, 1.12) * (1 - 0.52 * clamp(-inlandSlopeAlongFlow / 18, 0, 1)) *
    (0.72 + 0.28 * lowLevelVortexIntegrity);
  const rollingHillPulse = state.landed && options.isLand
    ? Math.min(16.5, (1.8 + 13.0 * rollingHillConvectiveSupport) * rollingHillConvectiveSupport *
      clamp(0.48 + 0.70 * inlandHillLift, 0.36, 1.18) *
      Math.exp(-Math.pow(r / Math.max(110, 0.88 * giantInlandRadius), 1.55)) *
      clamp(0.58 + 0.48 * landCellNoise + 0.14 * groundMoistureTopology, 0.46, 1.14))
    : 0;
  const largeInlandCirculationRain = state.landed && options.isLand
    ? giantPlainRain + giantHillRain + rollingHillPulse
    : 0;

  const inlandExtremeCell = Math.max(
    inlandScatteredConvection * smooth01(clamp((inlandCellGate - 0.70) / 0.30, 0, 1)) * (0.85 + 0.55 * inlandConvectiveSupport),
    inlandMesoscaleTrainingCell
  );
  const extremeConvectiveCell = Math.max(coreExtremeCell, bandExtremeCell, inlandExtremeCell);

  // 7) Large-scale moisture convergence and monsoon feeder. This is deliberately
  // capable of producing very heavy rain in a moderate-strength cyclone when the
  // circulation is broad and moisture supply is exceptional (e.g. SCS monsoon feed).
  const feederBearing = wrap360(movementDir + 145);
  const plumeAz = gauss(angleDelta(bearing, feederBearing), 30 + 18 * monsoon);
  const plumeRad = gauss(r - (260 + 110 * sizeFromRadii), 140 + 48 * sizeFromRadii) +
    0.14 * gauss(r - (500 + 65 * sizeFromRadii), 150);
  const nearLandFeed = options.distanceToLandKm != null
    ? 1 + 0.30 * clamp((280 - options.distanceToLandKm) / 280)
    : (options.isLand || state.landed ? 1.20 : 1);
  const monsoonPlume = (0.35 + 3.0 * intensity + 2.3 * sizeFromRadii) * monsoon * moistureTransport *
    plumeAz * plumeRad * nearLandFeed * (1 + 0.28 * weakening) * (1 + 0.72 * broadMoisturePlatform);

  const convergenceRadius = (145 + 95 * sizeFromRadii + 29 * weakening) * radialScale * (1 + 0.12 * circulationExpansion);
  const convergenceEffectiveR = r / clamp(
    (0.60 + 0.46 * mesoscaleShieldShape) * (0.84 + 0.20 * broadFootprintTopology),
    0.52, 1.43
  );
  const convergenceEnvelope = gauss(convergenceEffectiveR - convergenceRadius, 76 + 32 * sizeFromRadii);
  const moistureConvergence = (0.36 + 2.28 * moistureTransport + 0.82 * sizeFromRadii) * convergenceEnvelope *
    (0.42 + 0.50 * Math.max(intensity, weakSystem * 0.55)) * (1 + 0.30 * weakening + 0.14 * steady) *
    (1 + 0.36 * broadMoisturePlatform + 0.18 * rainbandDominance) * landBroadRainMask *
    (0.72 + 0.18 * mesoscaleShieldShape + 0.18 * broadFootprintTopology) * (1 - 0.18 * organizedIntactCore);

  // 8) Stratiform shield. Particularly relevant behind mature/ragged systems and during
  // weakening when deep convection becomes less symmetric but broad rain persists.
  const shieldBearing = wrap360(movementDir + 180);
  const shieldAz = 0.45 + 0.55 * gauss(angleDelta(bearing, shieldBearing), 70);
  const shieldEffectiveR = r / clamp(
    (0.58 + 0.48 * mesoscaleShieldShape) * (0.82 + 0.23 * broadFootprintTopology),
    0.50, 1.45
  );
  const shieldEnvelope = gauss(shieldEffectiveR - (174 + 94 * sizeFromRadii), 111 + 40 * sizeFromRadii);
  const stratiformShield = (0.27 + 1.34 * intensity + 1.58 * weakening + (raggedEye ? 0.70 : 0)) *
    shieldEnvelope * shieldAz * (0.72 + 0.44 * moistureTransport) *
    (1 + 0.34 * damageSeverity + 0.52 * structuralDisorganization) * (1 - 0.28 * convectiveSuppression) *
    landBroadRainMask * (0.66 + 0.20 * mesoscaleShieldShape + 0.24 * broadFootprintTopology) *
    (1 - 0.16 * organizedIntactCore);

  // A diffuse moisture-rich rain shield prevents the unrealistically dry gaps
  // that occurred between idealised spiral-band sectors. Real tropical cyclones
  // commonly carry broad areas of light/moderate rain beneath the central cloud
  // shield and feeder bands even when a point is not under the eyewall maximum.
  const diffuseRadius = (185 + 86 * sizeFromRadii + 30 * weakening) * (1 + 0.10 * circulationExpansion);
  const diffuseEffectiveR = r / clamp(
    (0.62 + 0.43 * mesoscaleShieldShape) * (0.80 + 0.25 * broadFootprintTopology),
    0.50, 1.41
  );
  const diffuseEnvelope = Math.exp(-diffuseEffectiveR / diffuseRadius) * (0.62 + 0.38 * sectorNoise);
  const diffuseRainShield = (0.06 + 0.44 * intensity + 0.22 * weakSystem + 0.37 * moistureTransport + 0.20 * sizeFromRadii) *
    diffuseEnvelope * (0.80 + 0.20 * clamp((30 - (state.speed ?? 18)) / 24, 0, 1)) *
    (1 + 0.62 * structuralDisorganization) * (1 - 0.20 * convectiveSuppression) * landBroadRainMask *
    (0.60 + 0.18 * mesoscaleShieldShape + 0.30 * broadFootprintTopology) *
    (1 - 0.20 * organizedIntactCore);

  // 3.3.2 westerly / extratropical-transition precipitation. ET reorganizes rainfall rather
  // than deleting it. Early interaction keeps a one-sided remnant convective core; later,
  // poleward/slantwise ascent and warm-frontogenesis shift the dominant precipitation into a
  // broad north/east shield and an elongated northeast warm-conveyor-belt tail.
  const etHours = Math.max(0, state.etHours ?? 0);
  const latitudeEtGate = clamp((state.lat - 25.0) / 10.0, 0, 1);
  const shearEtGate = clamp((shearKt - 14) / 20, 0, 1);
  const westerlyAgeGate = smooth01(clamp(westerlyInteractionHours / 14, 0, 1));
  const coldAirRemnantLow = !!state.coldAirWarmCoreDestroyed;
  const westerlyTransition = coldAirRemnantLow ? 0 : clamp(Math.max(
    structureMode === "westerly_sheared" || structureMode === "westerly_cloud_stripped" ? 0.74 : 0,
    structureMode === "subtropical_cyclone" ? 0.64 : 0,
    structureMode === "extratropical_transition" ? 0.82 : 0,
    structureMode === "extratropical_cyclone" ? 0.96 : 0,
    0.78 * latitudeEtGate * shearEtGate,
    0.82 * clamp(etHours / 12, 0, 1),
    0.72 * latitudeEtGate * westerlyAgeGate,
    0.64 * northeastCloudTailStrength,
    0.88 * warmConveyorBeltStrength
  ), 0, 1);
  const etMoistPotential = clamp(
    0.43 + 0.31 * clamp(ambientMoistureTransport / 1.2, 0, 1) +
    0.16 * broadMoisturePlatform + 0.10 * sizeFromRadii + 0.10 * westerlyRainMemory,
    0.38, 1.18
  );
  const frontalBearing = wrap360((state.shearDir ?? movementDir) + 78);
  const slantwiseBearing = wrap360(frontalBearing - 76);
  const frontalAz = clamp(Math.max(
    gauss(angleDelta(bearing, frontalBearing), 54),
    0.76 * gauss(angleDelta(bearing, slantwiseBearing), 46)
  ), 0, 1.08);
  const frontalRadius = Math.max(105, 1.55 * rmw + 66 * sizeFromRadii);
  const frontalRad = Math.max(
    gauss(r - frontalRadius, 62 + 22 * sizeFromRadii),
    0.50 * gauss(r - (frontalRadius + 150 + 36 * sizeFromRadii), 105 + 28 * sizeFromRadii)
  );
  const etNearCoreRing = gauss(r - Math.max(0.98 * rmw, 34), Math.max(21, 0.82 * rmw));
  const frontalPersistence = 0.76 + 0.36 * westerlyRainMemory;
  // A subtropical cyclone is hybrid but front-free.  Frontal precipitation appears only once
  // the continuous ET state reaches the late transition, then strengthens into the mature ET stage.
  const frontalLifecycleGate = coldAirRemnantLow
    ? 0
    : smooth01(clamp(((state.extrTransition ?? 0) - 0.68) / 0.20, 0, 1));
  const westerlyFrontalRain = westerlyTransition > 0.04 && frontalLifecycleGate > 0.01
    ? (2.0 + 7.0 * dvorakConvectivePotential + 7.5 * dvorakMajorCorePotential + 2.8 * weakening) *
      westerlyTransition * frontalLifecycleGate * etMoistPotential * frontalPersistence * (0.82 + 0.40 * warmConveyorBeltStrength) *
      (frontalRad * (0.55 + 0.66 * frontalAz) +
       0.55 * dvorakMajorCorePotential * etNearCoreRing * (0.56 + 0.44 * frontalAz)) *
      Math.max(0.50, 1 - 0.30 * dryAirCoreExposure)
    : 0;

  // Northeast cloud/rain tail. The orientation is constrained toward NE in the Northern
  // Hemisphere but still follows storm motion and the evolving warm-frontal axis. The tail
  // spins up over several hours and its modest rain rates decay slowly, so 10-100 mm/24 h
  // precipitation survives farther downstream than the compact convective core.
  const motionNortheastBearing = blendBearing(45, movementDir, 0.34);
  const northeastTailBearing = blendBearing(motionNortheastBearing, frontalBearing, 0.24);
  const signedTailDelta = ((wrap360(bearing) - northeastTailBearing + 540) % 360) - 180;
  const tailRad = signedTailDelta * Math.PI / 180;
  const tailAlong = r * Math.cos(tailRad);
  const tailCross = Math.abs(r * Math.sin(tailRad));
  const tailStart = smooth01(clamp((tailAlong - 28) / 115, 0, 1));
  const tailLength = 330 + 270 * sizeFromRadii + 150 * westerlyRainMemory + 80 * circulationExpansion;
  const tailAlongEnvelope = tailAlong > 0
    ? tailStart * Math.exp(-Math.max(0, tailAlong - 135) / Math.max(180, tailLength))
    : 0;
  const tailWidth = 58 + 58 * sizeFromRadii + 45 * westerlyTransition + 25 * structuralDisorganization;
  const tailCrossEnvelope = Math.exp(-0.5 * Math.pow(tailCross / Math.max(42, tailWidth), 2));
  const tailTexture = 0.70 + 0.30 * coherentNoise(northeastTailBearing + signedTailDelta * 0.26, r * 0.72, simHour / 1.8);
  const proximalTailBand = gauss(tailAlong - (135 + 60 * sizeFromRadii), 95 + 36 * sizeFromRadii) *
    Math.exp(-0.5 * Math.pow(tailCross / Math.max(36, 0.68 * tailWidth), 2));
  const tailOrganization = clamp(Math.max(
    northeastCloudTailStrength,
    0.74 * warmConveyorBeltStrength,
    0.58 * westerlyTransition * westerlyAgeGate
  ), 0, 1);
  const westerlyNortheastTailRain = tailOrganization > 0.025
    ? (0.24 + 2.55 * westerlyRainMemory + 1.10 * westerlyTransition +
       0.72 * weakening + 0.52 * sizeFromRadii) *
      etMoistPotential * tailOrganization * tailAlongEnvelope * tailCrossEnvelope * tailTexture *
      (1 + 0.64 * proximalTailBand) *
      Math.max(0.54, 1 - 0.25 * dryAirIntrusion - 0.18 * dryAirCoreExposure)
    : 0;

  // 9) Landfall frictional convergence. A strong cyclone does not instantly lose
  // its rainfall efficiency when the centre crosses the coast: low-level
  // friction increases convergence, the eyewall/rainbands are still fed by the
  // adjacent ocean, and terrain can further enhance ascent. This term is
  // strongest during the first several hours after landfall, then fades as the
  // vortex moves inland and its marine moisture supply is cut off.
  const recentLandfall = state.landed ? Math.exp(-landHours / 9.5) : 0;
  const coastTargetFocus = options.coastDistanceKm == null
    ? 1
    : clamp(0.18 + 0.82 * Math.exp(-Math.max(0, options.coastDistanceKm) / 82), 0.18, 1);
  const landfallCoreGate =
    0.94 * gauss(r - 1.08 * rmw, Math.max(16, 0.52 * rmw)) +
    0.34 * gauss(r - 2.15 * rmw, Math.max(36, 0.82 * rmw));
  const postCrossingInlandFeed = options.coastDistanceKm == null
    ? 1
    : clamp(0.64 + 0.36 * Math.exp(-Math.max(0, options.coastDistanceKm) / 285), 0.64, 1);
  const landfallDynamicAsymmetry = clamp(
    0.58 + 0.48 * frictionConvergenceLobe + 0.28 * shearFrictionOverlap +
      0.10 * primaryShieldLobe - 0.12 * suppressedWedge,
    0.46, 1.38
  );
  // 3.7.5 shoreline continuity: do not swap the entire convergence source on the exact time step
  // that the centre changes from water to land. The pre-crossing roughness signal grows with the
  // already-smoothed coastal-core influence, then lingers briefly after landfall while the stronger
  // inland frictional source ramps in over roughly two hours. This preserves a genuine coastal
  // rainfall enhancement without creating a one-frame annular expansion of the heavy-rain core.
  const preCrossingActivation = smooth01(clamp((coastalCoreInfluence - 0.04) / 0.46, 0, 1));
  const postCrossingRamp = state.landed
    ? 0.24 + 0.76 * smooth01(Math.max(0, landHours) / 2.2)
    : 0;
  const preCrossingMemory = state.landed
    ? Math.exp(-Math.max(0, landHours) / 1.8)
    : 1;
  const postCrossingConvergence = options.isLand && state.landed
    ? (2.0 + 7.6 * coastalBroadIntensitySupport + 1.7 * sizeFromRadii) *
      landfallCoreGate * recentLandfall * postCrossingInlandFeed * postCrossingRamp *
      (0.72 + 0.58 * moistureTransport + 0.16 * inheritedStrongLandfallMoisture) *
      (1 + 0.16 * weakening) * (1 - 0.66 * landfallDispersal) *
      (0.42 + 0.68 * landConvectiveMask) * landfallDynamicAsymmetry
    : 0;
  // Land-sea roughness contrast can focus low-level convergence just inland before the centre
  // itself crosses the coast. Keep this weaker and broader than the post-landfall core term and
  // fade it continuously instead of dropping it at the boolean landfall boundary.
  const preCrossingCoastalConvergence = options.isLand
    ? (0.65 + 2.25 * coastalBroadIntensitySupport + 0.80 * sizeFromRadii) *
      gauss(r - Math.max(1.55 * rmw, 105), Math.max(62, 1.25 * rmw)) * coastTargetFocus *
      (0.68 + 0.52 * moistureTransport) * (0.74 + 0.18 * environmentalRainAsymmetry) *
      clamp(0.62 + 0.48 * frictionConvergenceLobe + 0.22 * shearFrictionOverlap, 0.55, 1.30) *
      preCrossingActivation * preCrossingMemory
    : 0;

  // 3.3.20: persistent shoreline-locking rainband / residual-CDO convergence.  Numerical and
  // observational studies of landfalling TCs show that the land-sea roughness contrast can
  // decelerate onshore tangential flow, generate subgradient/radial convergence and maintain
  // convection close to the coast for hours.  Represent that as an *additive* moisture-
  // convergence source, not a blanket multiplier on the whole inland CDO.  The source follows
  // the actual coast-normal moist flow, the translating inner rainband, and the inherited
  // landfall intensity. It therefore builds a finite 400-500 mm coastal swath in strong landfalls
  // while naturally becoming patchier farther inland.
  const fallbackOnshoreSupport = clamp(0.28 + 0.62 * frictionConvergenceLobe + 0.18 * shearFrictionOverlap, 0.18, 1.02);
  const coastCrossingFlowSupport = hasCoastNormal
    ? clamp(0.20 + 0.88 * resolvedOnshoreFlowSupport, 0.18, 1.08)
    : fallbackOnshoreSupport;
  const coastalCoreBandEnvelope = Math.max(
    gauss(r - Math.max(1.15 * rmw, 48), Math.max(27, 0.76 * rmw)),
    0.78 * gauss(r - Math.max(2.15 * rmw, 105), Math.max(48, 1.10 * rmw)),
    0.40 * gauss(r - Math.max(3.20 * rmw, 185), Math.max(72, 1.34 * rmw))
  );
  const coastalConvergenceTexture = clamp(
    0.72 + 0.22 * rainNoise(groundXKm + 23, groundYKm - 17, simHour, 92, 12.0, 9341.2) +
      0.12 * rainNoise(groundXKm - 41, groundYKm + 29, simHour, 54, 7.0, 9347.8),
    0.54, 1.10
  );
  const inheritedCoastalIntensity = clamp(
    Math.max(hurricaneCore, 0.82 * rememberedHurricaneCore * (0.55 + 0.45 * landfallRainMemory)) +
      0.34 * rememberedSuperTyCore * landfallRainMemory,
    0, 1.25
  );
  // 3.3.23: broad coastal rainfall must not scale linearly all the way from a strong typhoon to
  // a super-typhoon. coastalBroadIntensitySupport was diagnosed from remembered landfall strength
  // above so it can be shared by both post-crossing and shoreline-convergence physics.
  const hollowedCoastalRetention = clamp(
    1 - 0.62 * terrainHollowCoreMemory - 0.34 * physicalTerrainBreakup,
    0.16, 1
  );
  // Coastal roughness convergence dominates around landfall, then yields to the translated inland
  // vortex if the circulation remains over land.  This prevents a 24 h stationary inland storm
  // from continuing to place its dominant accumulation maximum back on the shoreline.
  const stalledInlandCoastRelease = state.landed
    ? clamp(1 - 0.78 * stalledInlandTraining * smooth01(clamp((landHours - 8) / 14, 0, 1)), 0.20, 1)
    : 1;
  const postLandfallCoastalRetention = state.landed
    ? clamp(
      (0.12 + 0.88 * Math.exp(-Math.max(0, landHours - 5) / 16) + 0.12 * coastalCoreInfluence) *
        stalledInlandCoastRelease,
      0.08, 1
    )
    : 1;
  const coastalFrictionActivation = (state.landed
    ? Math.max(preCrossingActivation, 0.34 + 0.66 * smooth01(Math.max(0, landHours) / 1.7))
    : preCrossingActivation) * postLandfallCoastalRetention;
  const coastalFrictionConvergence = options.isLand && coastalFrictionActivation > 0.001
    ? (3.8 + 10.0 * coastalBroadIntensitySupport + 2.8 * sizeFromRadii) *
      coastRoughnessProximity * coastCrossingFlowSupport * coastalCoreBandEnvelope * coastalFrictionActivation *
      (0.58 + 0.56 * moistureTransport + 0.10 * broadMoisturePlatform) *
      coastalConvergenceTexture *
      // Keep a weak structure-memory term, but do not let remembered super-typhoon Vmax
      // multiply the whole coastal rain shield. This is the mechanism-level saturation that
      // raises plausible 55 m/s coastal 400+ rain while preventing a 68 m/s case from converting
      // most of the surrounding 250-400 mm shield into 400-600 mm simply because Vmax is larger.
      (0.84 + 0.16 * clamp(inheritedCoastalIntensity, 0, 1)) *
      (0.54 + 0.46 * Math.max(organizedIntactCore, residualLandCorePersistence, 0.55 * rainbandDominance)) *
      hollowedCoastalRetention
    : 0;

  // 3.3.22: embedded coastal training nodes. A broad coast-normal convergence swath can contain
  // several much smaller repeatedly firing cells near bays/capes or where an inner rainband
  // intersects the roughness discontinuity. These produce the irregular 400-550 mm pockets
  // inside an otherwise connected coastal 250-500 mm lobe. The cell is ground-relative and
  // process-gated; it does not grant any 600+ permission by itself.
  const coastalNodeCycleHours = 6.4;
  const coastalNodeEpoch = Math.floor(simHour / coastalNodeCycleHours);
  const coastalNodeFrac = (simHour / coastalNodeCycleHours) - coastalNodeEpoch;
  const coastalNodePulse = Math.pow(Math.max(0, Math.sin(Math.PI * coastalNodeFrac)), 0.48);
  const coastalNodeNoiseA = rainNoise(groundXKm + 131, groundYKm - 73, simHour, 54, 10, 14531.9);
  const coastalNodeNoiseB = rainNoise(groundXKm - 37, groundYKm + 109, simHour, 31, 12, 14549.7);
  const coastalNodeGate = smooth01(clamp((0.68 * coastalNodeNoiseA + 0.32 * coastalNodeNoiseB - 0.56) / 0.30, 0, 1));
  const coastalNodeBandSupport = clamp(
    0.36 * Math.min(1, coastalFrictionConvergence / 15) +
      0.20 * spiralSkeleton + 0.16 * rainbandCellGate +
      0.12 * Math.min(1, synopticConvergenceRain / 12) +
      0.10 * rainbandDominance + 0.06 * organizedIntactCore,
    0, 1.05
  );
  const coastalMesoscaleTrainingCell = options.isLand && coastRoughnessProximity > 0.08
    ? Math.min(31,
      (1.4 + (22 + 5 * superTyRainLocalization) * coastalNodeBandSupport) *
      coastalNodeBandSupport * coastalNodeGate * coastalNodePulse *
      coastRoughnessProximity * coastCrossingFlowSupport * coastalFrictionActivation *
      (0.60 + 0.48 * moistureTransport) *
      clamp(0.54 + 0.46 * landConvectiveMask, 0.30, 1.0) *
      clamp(1 - 0.58 * terrainHollowCoreMemory - 0.26 * physicalTerrainBreakup, 0.18, 1)
    )
    : 0;

  const landfallConvergence = postCrossingConvergence + preCrossingCoastalConvergence + coastalFrictionConvergence;

  // Core uses a max-like combination to avoid stacking mutually exclusive eye morphologies.
  const compactCoreFadeBase = Math.max(0.055, (1 - 0.72 * convectiveSuppression) *
    (state.landed ? landConvectiveMemory * (1 - 0.62 * landfallDispersal) : 1));
  const compactCoreFade = state.landed
    ? Math.max(compactCoreFadeBase, 0.07 + 0.62 * residualLandCorePersistence)
    : compactCoreFadeBase;
  const eyewallCoreField = eyewall * compactCoreFade;
  const coreOverlapRain = intactDenseCoreScene
    ? 0.30 * Math.min(eyewallCoreField, center) * Math.max(primaryRing, 0.38 * denseCoreDisk) * denseCoreEyeHole
    : 0;
  const fragmentedCoreField = fragmentedCore * (state.landed
    ? Math.max(0.42, 0.72 + 0.28 * residualLandCorePersistence - 0.18 * landfallDispersal)
    : 1);
  const exposedCoreRetention = clamp(1 - 0.48 * llccExposure - 0.34 * northeastCloudStripping, 0.22, 1);
  const core = Math.max(
    eyewallCoreField,
    center,
    fragmentedCoreField,
    convectiveBurst * Math.max(0.12, 1 - 0.62 * landfallDispersal),
    rotatingReburstRain,
    brownOceanLocalBurstRain,
    coreExtremeCell
  ) * exposedCoreRetention + coreOverlapRain;
  // Outside the inner core, broad cloud shields are not equivalent to continuous rain at a
  // point. Apply a mesoscale duty cycle that leaves genuine dry gaps between passing bands.
  const outerBlend = clamp((r - Math.max(145, 3.8 * rmw)) / 150, 0, 1);
  const broadCellNoise = rainNoise(dx, dy, simHour, 148, 10.5, 1551.3);
  const broadPresenceThreshold = clamp(
    0.50 - 0.08 * sectorNoise - 0.10 * moistureTransport - 0.08 * rainbandDominance,
    0.31,
    0.56
  );
  const broadTransition = smooth01(clamp((broadCellNoise - (broadPresenceThreshold - 0.16)) / 0.34, 0, 1));
  // The light/moderate shield should remain connected in 24-h accumulations. Convective
  // intermittency is handled separately, so the broad component never falls to near-zero
  // random stripes from one azimuth/radius bin to the next.
  // Persistent synoptic-scale wet/dry topology controls whether broad low/mid rain actually
  // occupies a grid point. Keep a floor so the product remains meteorologically connected, but
  // allow wide notches and tongues that survive a 24-h accumulation.
  // 3.7.2: broad rain may be meteorologically connected without raining continuously at every
  // point. Lower the occupancy floor so a 24-h integration retains dry lanes/notches instead of
  // filling them into a smooth coastal fan.
  const landBroadIntermittencyTightening = options.isLand ? 1 : 0;
  const broadTopologyOccupancy = clamp(
    (0.38 - 0.08 * landBroadIntermittencyTightening) +
      (0.62 + 0.08 * landBroadIntermittencyTightening) * broadFootprintTopology,
    0.32 - 0.08 * landBroadIntermittencyTightening,
    1.10 - 0.02 * landBroadIntermittencyTightening
  );
  const broadDuty = ((0.030 - 0.012 * landBroadIntermittencyTightening) +
    (0.25 - 0.05 * landBroadIntermittencyTightening) * broadTransition) * broadTopologyOccupancy;
  const broadDutyFloor = 0.018 - 0.006 * landBroadIntermittencyTightening;
  const broadDutyCeiling = 0.34 - 0.06 * landBroadIntermittencyTightening;
  const broadIntermittency = (1 - outerBlend) + outerBlend * clamp(broadDuty, broadDutyFloor, broadDutyCeiling);
  const feederIntermittency = (1 - outerBlend) + outerBlend * Math.max(
    clamp(broadDuty, broadDutyFloor, broadDutyCeiling),
    (0.035 - 0.007 * landBroadIntermittencyTightening) +
      (0.085 - 0.011 * landBroadIntermittencyTightening) * monsoon * moistureTransport * plumeAz *
        (0.72 - 0.02 * landBroadIntermittencyTightening +
          (0.28 + 0.02 * landBroadIntermittencyTightening) * broadFootprintTopology)
  );
  const landfallOuterBandRain = landfallOuterRainbandIndex > 0.04
    ? (1.5 + 10.5 * intensity + 5.0 * moistureTransport) * landfallOuterRainbandIndex *
      gauss(r - Math.max(2.4 * rmw, 105), Math.max(28, 0.90 * rmw)) *
      (0.52 + 0.48 * sectorNoise)
    : 0;

  // 3.7.2: broad moisture/convergence terms are background rain, not a proxy for a solid heavy
  // rain shield. Heavy totals are carried by the core, coherent rainbands, terrain and sparse
  // convective/training cells. This also lets the rainfall maximum translate inland with the vortex.
  // 3.7.4 applies the stronger broad-field reduction over land, where the observed product was
  // producing oversized continuous 50-250 mm areas; marine rainbands retain the prior weighting.
  const landBroadWeight = options.isLand ? 1 : 0;
  // Round170 TRMM-composite recalibration: background moisture is widespread but
  // rain *occurrence* is not. Preserve physically forced embedded cells, terrain
  // training and eyewall bursts while trimming broad persistent stratiform fill.
  const outerCirculationWeight = 0.125 - 0.025 * landBroadWeight;
  const monsoonPlumeWeight = 0.39 - 0.055 * landBroadWeight;
  const moistureConvergenceWeight = 0.165 - 0.04 * landBroadWeight;
  const synopticConvergenceWeight = 0.41 - 0.13 * landBroadWeight;
  const stratiformWeight = (0.15 - 0.025 * landBroadWeight) + 0.028 * landfallDispersal;
  const diffuseShieldWeight = (0.068 - 0.015 * landBroadWeight) + 0.02 * landfallDispersal;
  let rate = core +
    1.00 * spiralRainband +
    0.72 * landfallOuterBandRain +
    0.94 * bandExtremeCell +
    0.70 * connectingBand +
    outerCirculationWeight * outerCirculation * broadIntermittency +
    0.90 * preStormSquall +
    monsoonPlumeWeight * monsoonPlume * feederIntermittency +
    moistureConvergenceWeight * moistureConvergence * broadIntermittency +
    synopticConvergenceWeight * synopticConvergenceRain +
    stratiformWeight * stratiformShield * broadIntermittency +
    diffuseShieldWeight * diffuseRainShield * broadIntermittency +
    0.54 * landfallConvergence +
    0.96 * coastalMesoscaleTrainingCell +
    0.96 * westerlyFrontalRain +
    0.92 * westerlyNortheastTailRain +
    0.96 * inlandScatteredConvection +
    1.04 * inlandVortexRain +
    0.62 * largeInlandCirculationRain +
    0.56 * inlandExtremeCell;

  // Observed TRMM composites show a downshear-left maximum rather than a smooth
  // circular heavy-rain disk. Add temporally persistent mesoscale *dry gaps* only
  // to the diffuse contribution, not the explicitly resolved eyewall/terrain cells.
  // SpatialCoherentNoise is deterministic in world coordinates and evolves slowly:
  // it cannot cause frame-to-frame random flashing or resampling artifacts.
  const marineRainGap = rainNoise(groundXKm + 137, groundYKm - 91, simHour, 86, 19, 17019.1);
  const secondaryRainGap = rainNoise(groundXKm - 71, groundYKm + 139, simHour, 46, 33, 17033.7);
  const broadCellOccupancy = smooth01(clamp((0.68 * marineRainGap + 0.32 * secondaryRainGap - 0.34) / 0.38, 0, 1));
  const nonCoreShield = Math.max(0, 1 - Math.exp(-Math.pow(r / Math.max(100, 2.4 * rmw), 2)));
  const backgroundReduction = nonCoreShield * (options.isLand ? 0.095 : 0.14) * (1 - broadCellOccupancy);
  rate *= 1 - backgroundReduction;
  // Satellite-derived conditional radial averages (TRMM: ~6.7 mm/h at 60 km,
  // ~3.9 mm/h at 200 km for CAT1-2 composites) are lower than the old uniform
  // tropical background. Apply the strongest correction to the 100-250 km
  // broad rain shield; spare genuine embedded hot towers and terrain training.
  const convectiveException = clamp(Math.max(coreExtremeCell / 95, bandExtremeCell / 90,
    inlandMesoscaleTrainingCell / 90), 0, .85);
  const satelliteRadialBias = (0.115 + .18 * smooth01(clamp((r - 70) / 145,0,1))) *
    Math.exp(-Math.max(0,r-260) / 240) * (1 - .86 * convectiveException);
  rate *= 1 - satelliteRadialBias;

  // Environmental asymmetry belongs primarily to rainbands and the broad shield.  When a
  // high-intensity cyclone still has an intact CDO/eyewall, the dominant inner-core rainfall
  // maximum remains centred on the CDO passage rather than having the entire rain field shifted
  // downshear.  Protection fades rapidly outside roughly 1-2 CDO radii and also collapses when
  // shear, dry air or structural damage destroys the core.
  const intactCoreSymmetry = matureCdoScene
    ? clamp(Math.max(organizedIntactCore,
        integrity * (1 - 0.62 * shearNorm) * (1 - 0.70 * damageSeverity) * (1 - 0.55 * convectiveSuppression)), 0, 1)
    : 0;
  const symmetryRadius = Math.max(cdoRadiusKm * 1.35, 2.1 * rmw, 65);
  const coreSymmetryProtection = intactCoreSymmetry *
    clamp(1 - 0.68 * shearNorm - 0.70 * dryAirCoreExposure - 0.46 * structuralDisorganization, 0.06, 1) *
    Math.exp(-Math.pow(r / symmetryRadius, 3.0));
  const outerAsymmetryRamp = smooth01(clamp((r - 0.65 * rmw) / Math.max(55, 2.7 * rmw), 0, 1));
  const denseCoreSymmetryGate = intactDenseCoreScene ? denseCoreDisk * denseCoreEyeHole * organizedIntactCore : 0;
  const asymmetryApplication = clamp(
    (0.20 + 0.80 * outerAsymmetryRamp) * (1 - 0.92 * coreSymmetryProtection) * (1 - 0.94 * denseCoreSymmetryGate),
    0.018, 1
  );
  const broadShapeApplication = clamp((r - Math.max(55, 1.15 * rmw)) / Math.max(80, 2.5 * rmw), 0, 1) *
    (1 - 0.86 * coreSymmetryProtection) * (1 - 0.90 * denseCoreSymmetryGate);
  rate *= 1 + (environmentalRainAsymmetry - 1) * asymmetryApplication;
  rate *= 1 + (mesoscaleShieldShape - 1) * 0.40 * broadShapeApplication;

  // 3.7.2 dry-air lifecycle morphology. The dry slot first eats an outer-band sector, then reaches
  // the eyewall/core, and only gradually closes during re-moistening. Apply this chiefly to heavy
  // convection so light stratiform residue can remain inside the ventilated sector.
  const lifecycleHeavyBlend = clamp((rate - 2.8) / 16, 0, 1);
  const lifecycleCoreEnvelope = Math.exp(-Math.pow(r / Math.max(52, 2.8 * rmw), 2.0));
  const lifecycleBandEnvelope = gauss(r - Math.max(2.4 * rmw, 105), Math.max(70, 1.8 * rmw));
  let lifecycleSurvival = 1;
  if (dryAirLifecyclePhase === "outer_wrap") {
    lifecycleSurvival = 1 - (0.18 + 0.30 * dryAirWrapFraction) * dryWrapLobe * lifecycleBandEnvelope;
  } else if (dryAirLifecyclePhase === "eyewall_breach") {
    lifecycleSurvival = 1 - (0.32 + 0.46 * dryAirCoreConnection) * drySlotLobe *
      Math.max(0.42 * lifecycleBandEnvelope, lifecycleCoreEnvelope);
  } else if (dryAirLifecyclePhase === "asymmetric_collapse") {
    const drySideLoss = (0.50 + 0.34 * dryAirCoreExposure) * Math.max(drySlotLobe, 0.58 * dryWrapLobe);
    const survivingArc = clamp(0.34 + 0.78 * moistArcLobe + 0.18 * moistArcFlanks, 0.16, 1.16);
    lifecycleSurvival = clamp((1 - drySideLoss) * (0.54 + 0.46 * survivingArc), 0.10, 1.05);
  } else if (dryAirLifecyclePhase === "residual_vortex") {
    const residualArc = clamp(0.18 + 0.80 * moistArcLobe + 0.20 * moistArcFlanks, 0.10, 1.08);
    lifecycleSurvival = clamp(0.30 + 0.70 * residualArc - 0.30 * drySlotLobe, 0.08, 1.02);
  } else if (dryAirLifecyclePhase === "reorganizing") {
    const rebuild = smooth01(dryAirReMoistening);
    lifecycleSurvival = clamp(
      (1 - (1 - rebuild) * (0.30 + 0.34 * dryAirCoreConnection) * drySlotLobe) *
        (0.84 + 0.22 * rebuild * moistArcLobe),
      0.24, 1.12
    );
  }
  rate *= 1 - lifecycleHeavyBlend * (1 - clamp(lifecycleSurvival, 0.06, 1.14));

  // Higher-wavenumber/eccentric inner-core structure. This vanishes for an intact low-shear eye,
  // but under shear/dry-air damage the core becomes an offset convective blob/broken arc rather
  // than an unrealistically perfect circle.
  const eccentricCoreStrength = clamp(
    0.60 * shearNorm + 0.46 * dryAirCoreExposure + 0.42 * structuralDisorganization +
      0.32 * (state.eyeAsymmetry ?? 0) - 0.72 * organizedIntactCore,
    0, 0.86
  );
  if (eccentricCoreStrength > 0.02 && r < Math.max(180, 4.2 * rmw)) {
    const eccentricBearing = blendBearing(downshearLeftBearing, moistArcBearing, 0.38 + 0.34 * dryAirCoreExposure);
    const eccentricPrimary = gauss(angleDelta(bearing, eccentricBearing), 48);
    const eccentricSecondary = gauss(angleDelta(bearing, wrap360(eccentricBearing + 145)), 62);
    const eccentricMask = clamp(0.68 + 0.62 * eccentricPrimary - 0.24 * eccentricSecondary, 0.40, 1.26);
    rate *= 1 + eccentricCoreStrength * lifecycleCoreEnvelope * (eccentricMask - 1);
  }

  // Landfall breakup selectively perforates heavy/convective precipitation while allowing
  // lighter stratiform rain to remain broad. This is the key distinction between a broken
  // inland CDO and an unrealistic single intact 100-250+ mm disk.
  if (state.landed) {
    const heavyConvectiveBlend = clamp((rate - 4.0) / 18, 0, 1);
    const breakupGap = clamp(1 - landConvectiveMask, 0, 1);
    rate *= 1 - 0.64 * landBreakupProgress * heavyConvectiveBlend * breakupGap;
  }

  // Organized inner-core rainfall contrast. Airborne and precipitation observations place the most intense,
  // persistent precipitation in the eyewall and immediately adjacent inner rainbands. A strong
  // storm with a coherent inner core should therefore leave a much wetter station swath than its
  // broad outer circulation. Damage transfers rain outward, so the contrast weakens continuously
  // rather than disappearing through a binary switch. The true eye is masked again below.
  const postLandCoreCoherence = state.landed
    ? clamp(landConvectiveMemory * (0.46 + 0.54 * landConvectiveMask) * (1 - 0.46 * landfallDispersal), 0.045, 1)
    : 1;
  const effectiveInnerHurricaneCore = state.landed
    ? Math.max(hurricaneCore, rememberedHurricaneCore * (0.48 + 0.52 * landfallRainMemory))
    : hurricaneCore;
  const innerCorePresence = clamp(
    effectiveInnerHurricaneCore * (0.55 + 0.55 * integrity) * (0.68 + 0.32 * coreCompactness) *
      (1 - 0.58 * damageSeverity) * postLandCoreCoherence,
    0, 1.15
  );
  const innerRainbandRing = gauss(r - Math.max(eyewallRadius * 1.65, rmw * 1.55), Math.max(18, 0.46 * rmw));
  const corePassageEnvelope = Math.max(
    primaryRing,
    0.58 * innerRainbandRing,
    intactDenseCoreScene ? 0.50 * denseCoreDisk * denseCoreEyeHole : 0
  );
  if (innerCorePresence > 0.08) {
    const corePersistence = 0.80 + 0.34 * strengthening + 0.18 * convectiveBurstIndex + 0.18 * moistureTransport;
    const intactSuperCore = (matureCdoScene ? 1 : 0) * clamp((vmax - 45) / 23, 0, 1) * intactCoreSymmetry;
    rate *= 1 + (0.82 + 0.16 * intactSuperCore) * innerCorePresence * corePassageEnvelope;
    rate += (3.0 + 20.5 * innerCorePresence + 7.5 * intactSuperCore) * corePassageEnvelope * corePersistence;
  }

  // Basin-wide rainfall efficiency.  Tropical-cyclone rain is controlled at
  // least as much by residence time, circulation size and moisture supply as by
  // peak wind.  The old model systematically under-produced ordinary rainband
  // and landfall totals because most components were individually down-weighted.
  const slowMotionRain = clamp((28 - (state.speed ?? 18)) / 22, 0, 1);
  const rainfallEfficiency = clamp(
    0.96 +
    0.22 * moistureTransport +
    0.12 * sizeFromRadii +
    0.16 * slowMotionRain +
    0.08 * weakening +
    0.12 * strengthening +
    0.22 * rainbandDominance +
    0.20 * broadMoisturePlatform,
    0.90,
    1.82
  );
  // Calibration against station-scale tropical-cyclone accumulations: the component sum is a
  // potential precipitation field, while a fixed sub-grid efficiency keeps broad shields from
  // raining at their component maximum continuously at a single gauge. Terrain/training below
  // can still push exceptional windward mountain stations into the ~1000 mm/24 h tail.
  rate *= rainfallEfficiency * 0.72;

  // Mature-eye rain shadow. Apply this *after* the broad rain-shield terms are
  // combined; otherwise diffuse/monsoon components can refill the eye and erase
  // the characteristic eyewall -> eye -> eyewall rainfall sequence at a station.
  // The transition is steep near the eye boundary but continuous, matching the
  // sharp radial reflectivity gradient of a complete eyewall.
  if (hasDefinedEye && clearEye > 0.34 && vmax >= 36) {
    const normalizedEyeRadius = r / Math.max(5, eyeRadius);
    // TRMM precipitation composites show a local rainfall minimum in the eye and a
    // sharp radial gradient into the eyewall.  Preserve that discontinuity-like
    // signature while keeping the numerical transition smooth.
    const eyeInteriorTransition = clamp((normalizedEyeRadius - 0.72) / 0.33, 0, 1);
    const smoothEyeEdge = eyeInteriorTransition * eyeInteriorTransition * (3 - 2 * eyeInteriorTransition);
    const eyeFloor = clamp(0.015 + 0.12 * (1 - clearEye) + 0.12 * obstruction + 0.07 * shearNorm, 0.015, 0.28);
    const eyeMask = eyeFloor + (1 - eyeFloor) * smoothEyeEdge;
    rate *= eyeMask;

    // For a clean, complete eye, broad feeder/shield terms must not refill the
    // centre.  This explicit interior ceiling makes hourly station traces show
    // the observed sharp eyewall peak, eye lull, and second eyewall peak.
    if (clearEye > 0.62 && !raggedEye && normalizedEyeRadius < 0.78) {
      const eyeInteriorCap = 0.8 + 3.5 * (1 - clearEye) + 2.8 * obstruction + 1.4 * shearNorm;
      rate = Math.min(rate, eyeInteriorCap);
    }
  }

  // Dry-air core intrusion reduces compact convection more than the remote moisture plume.
  if (state.forcedDryAir === "core") {
    // Forced core dry-air now opens a sectoral dry slot instead of dimming the whole inner core.
    // The opposite humid arc can retain strong rain even at similar Vmax, matching observed cases
    // where core ventilation produces severe asymmetry rather than a uniformly rain-free vortex.
    if (r < Math.max(165, 2.7 * rmw)) {
      rate *= clamp((0.32 + 0.46 * dryMoistSectorSupport - 0.24 * drySlotLobe) * dryCoreLifecycleRetention, 0.12, 0.76);
    } else rate *= 0.86;
  } else if (state.forcedDryAir === "periphery") {
    rate *= r > 1.6 * rmw ? 0.86 : 0.95;
  }

  let terrainWindwardLift = 0;
  let terrainLeeShadow = 0;
  let terrainAnchoredRain = 0;
  let remoteTerrainFeederRain = 0;
  if (options.isLand) {
    const elevation = Math.max(0, options.elevation || 0);
    const elevationNorm = clamp(elevation / 2200);

    // Orographic precipitation depends on moist flow crossing the terrain gradient (u·∇h),
    // not on elevation alone. Estimate the low-level cyclone inflow from the local tangential
    // circulation plus a modest inward component and storm translation. Positive projection is
    // windward ascent; negative projection creates a lee-side rain shadow.
    const flowLen = Math.max(0.2, lowLevelFlowSpeed);
    const flowEast = lowLevelFlowEast / flowLen;
    const flowNorth = lowLevelFlowNorth / flowLen;
    const slopeEast = options.terrainSlopeEast ?? 0;
    const slopeNorth = options.terrainSlopeNorth ?? 0;
    const slopeMag = Math.hypot(slopeEast, slopeNorth);
    const slopeAlongFlow = flowEast * slopeEast + flowNorth * slopeNorth;
    // A flow-normalized slope projection is a better proxy for forced ascent than elevation alone.
    // The lower denominator than the old multiplier is intentional: steep island/coastal ranges
    // can trigger deep rain even when the TC centre is hundreds of kilometres away.
    terrainWindwardLift = clamp(slopeAlongFlow / 32, 0, 1);
    terrainLeeShadow = clamp(-slopeAlongFlow / 44, 0, 1);

    const terrainSteepness = clamp(0.72 * slopeMag / 34 + 0.28 * elevation / 2200, 0, 1);
    const moistFlowStrength = clamp((lowLevelFlowSpeed - 2.5) / 17.5, 0, 1);
    const terrainMoistureReachRadius = 390 + 95 * sizeFromRadii + 80 * moistureTransport +
      55 * circulationExpansion;
    const terrainMoistureReach = Math.exp(-Math.pow(r / Math.max(260, terrainMoistureReachRadius), 1.35));
    const terrainPatch = rainNoise(groundXKm - 19, groundYKm + 31, simHour, 96, 18.0, 8117.3);
    const upslopeEfficiency = Math.pow(terrainWindwardLift, 0.72) * (1 - 0.82 * terrainLeeShadow);
    // Additive terrain-forced precipitation.  This fixes the principal structural flaw of the old
    // model: multiplying an already-small remote TC rain rate by an orographic factor can never
    // create a separate Taiwan/coastal-mountain rainfall maximum. Moist flux impinging on steep
    // terrain is itself a precipitation source and can remain phase-locked to the mountain for many
    // hours, so the 24-h integration naturally creates isolated 50-250/250-500 mm centres.
    terrainAnchoredRain = (
      1.0 + 10.5 * moistureTransport + 4.2 * intensity + 3.6 * sizeFromRadii +
        1.6 * broadMoisturePlatform
    ) * terrainSteepness * upslopeEfficiency * terrainMoistureReach *
      (0.35 + 0.65 * moistFlowStrength) *
      clamp(0.62 + 0.34 * terrainPatch + 0.12 * convergencePatch, 0.52, 1.08);

    // Low-level confluence against a mountain barrier can organize rainfall upstream of the
    // steepest grid cell.  This modest supplement represents terrain blocking / frontogenesis and
    // is strongest where the environmental flow is dynamically relevant, without hard-coding any
    // island or province.
    const backgroundUnitDotTc = backgroundFlowSpeed > 0.4 && tcTangentialMs > 1
      ? (backgroundMoistWind.u * (tangentEastFlow * tcTangentialMs - radialOutEast * tcRadialInflowMs) +
         backgroundMoistWind.v * (tangentNorthFlow * tcTangentialMs - radialOutNorth * tcRadialInflowMs)) /
        Math.max(0.5, backgroundFlowSpeed * Math.hypot(
          tangentEastFlow * tcTangentialMs - radialOutEast * tcRadialInflowMs,
          tangentNorthFlow * tcTangentialMs - radialOutNorth * tcRadialInflowMs
        ))
      : 0;
    const barrierConfluence = clamp((-backgroundUnitDotTc - 0.05) / 0.75, 0, 1) *
      clamp(backgroundFlowSpeed / 8, 0, 1);
    terrainAnchoredRain += (2.2 + 7.5 * moistureTransport) * terrainSteepness *
      Math.max(0.28 * terrainWindwardLift, barrierConfluence * (0.40 + 0.60 * terrainWindwardLift)) *
      terrainMoistureReach * (0.58 + 0.42 * terrainPatch);


    // 3.3.21: remote outer-circulation terrain feeder. Large intense cyclones can send moist
    // feeder flow and detached rainbands across high islands/coastal ranges several hundred
    // kilometres from the centre. This usually yields narrow 25-100/100-250 mm terrain strips,
    // not a second inner core. Use the actual upslope projection, moisture transport, outer-band
    // geometry and storm size, with a strict hourly cap so the mechanism cannot create remote
    // 400-600 mm shields by itself.
    const remoteTerrainGate = smooth01(clamp((r - 250) / 170, 0, 1)) *
      Math.exp(-Math.pow(Math.max(0, r - 420) / (330 + 90 * sizeFromRadii), 1.45));
    const remoteFeederBandSupport = clamp(
      0.30 * feederShieldLobe + 0.24 * primaryShieldLobe + 0.18 * spiralSkeleton +
        0.16 * detachedBandGroundGate + 0.12 * convergencePatch,
      0.08, 1.0
    );
    remoteTerrainFeederRain = Math.min(8.8,
      (0.55 + 6.8 * moistureTransport + 2.6 * sizeFromRadii + 1.8 * intensity) *
      terrainSteepness * Math.max(0.18, upslopeEfficiency) * remoteTerrainGate *
      remoteFeederBandSupport * (0.45 + 0.55 * moistFlowStrength) *
      clamp(0.58 + 0.42 * terrainPatch, 0.50, 1.06)
    );

    const orographic = clamp(
      1.00 + 0.08 * elevationNorm +
      (0.28 + 0.72 * moistureTransport) * (0.35 + 0.65 * intensity) * 0.92 * terrainWindwardLift -
      0.34 * terrainLeeShadow * (0.35 + 0.65 * elevationNorm),
      0.62,
      1.92
    );
    rate *= orographic;
    rate += terrainAnchoredRain + remoteTerrainFeederRain;

    // Extreme 24-h tropical-cyclone totals are a residence-time/training phenomenon rather than a
    // simple Vmax multiplier. A slow, moisture-loaded large circulation feeding windward mountain
    // terrain can repeatedly train rainbands over one station and exceed 1000 mm/day, while fast
    // ordinary landfalls remain far lower.
    const slowTraining = clamp((25 - (state.speed ?? 18)) / 19, 0, 1);
    const terrainBandExposure = clamp(
      0.22 + 0.46 * Math.max(spiralGate, plumeAz) + 0.32 * Math.max(primaryRing, innerRainbandRing),
      0,
      1
    );
    const terrainTraining = clamp(
      elevationNorm * (0.40 + 0.60 * moistureTransport) * (0.34 + 0.66 * slowTraining) *
      (0.42 + 0.58 * rainbandDominance) * (0.72 + 0.28 * (state.landed ? moistureReservoir : 1)) *
      terrainBandExposure * (0.12 + 0.88 * terrainWindwardLift) * (1 - 0.72 * terrainLeeShadow),
      0, 1
    );
    rate *= 1.0 + 1.05 * terrainTraining;

    // Near-coastal inland phase: a broad vortex moving parallel to the coast can
    // keep receiving oceanic moisture while rainbands repeatedly lift over coastal hills. This
    // supports separated heavy-rain centres (e.g. central Shandong) without forcing the cyclone
    // centre itself to remain the rainfall maximum after the inner core has weakened.
    const coastDistForHill = Math.max(0, options.coastDistanceKm ?? 999);
    const coastalHill = clamp((Math.max(0, options.elevation || 0) - 55) / 520, 0, 1);
    const coastalMoistHillSupport = options.isLand && state.landed
      ? Math.exp(-coastDistForHill / 175) * coastalHill * (0.38 + 0.62 * moistureTransport) *
        (0.38 + 0.62 * Math.max(terrainWindwardLift, 0.42 * spiralGate, 0.36 * plumeAz)) *
        (0.42 + 0.58 * sizeFromRadii)
      : 0;
    rate *= 1.0 + 0.42 * coastalMoistHillSupport;

    if (state.landed) {
      // Fresh strong-typhoon landfalls often keep or even briefly enhance
      // torrential rain near the core. Only after several hours inland does the
      // loss of oceanic enthalpy dominate. Use a smooth curve instead of the old
      // immediate 14% core rainfall cut.
      const strongLandfall = hurricaneCore * recentLandfall;
      // Strong landfalls often maintain torrential inner-core rain for several
      // hours while frictional convergence and adjacent-ocean moisture feeding
      // compensate for the initial wind weakening.
      const coastProximity = options.coastDistanceKm == null
        ? 1
        : clamp(Math.exp(-Math.max(0, options.coastDistanceKm) / 95), 0.16, 1);
      // A fresh intact eyewall can briefly benefit from roughness convergence at coast crossing.
      // A terrain-hollowed core cannot: once the old ring has been severed, applying the same
      // broad coastal boost would silently refill the damaged centre and recreate a CDO-like
      // rainfall shield. Keep only a small residual convergence contribution while the hollow
      // memory persists; explicit off-centre arcs / terrain lift still operate independently.
      const hollowCoastalBoostRetention = 1 - 0.88 * smooth01((terrainHollowCoreMemory - 0.08) / 0.70);
      const coastalRainBoost = 1 + (0.17 + 0.08 * moistureTransport) * strongLandfall *
        gauss(r, Math.max(115, 3.15 * rmw)) * coastProximity * hollowCoastalBoostRetention;
      rate *= coastalRainBoost;
      // The inherited oceanic reservoir still matters, but do not count its depletion twice.
      // A coherent inland vortex can continue to import moisture through its low-level inflow,
      // so points near the translating centre retain a larger rainfall-efficiency floor than a
      // remote inland broad shield.  This is the key distinction between "wind weakens inland"
      // and "rain instantly vanishes inland".
      const reservoirRainFactor = 0.50 + 0.50 * Math.sqrt(moistureReservoir);
      const centreFeedRelief = clamp(
        Math.max(inlandRainSupport, 0.82 * residualLandCorePersistence) *
          Math.exp(-Math.pow(r / Math.max(165, inlandLooseRadius * 1.32), 2)),
        0, 1
      );
      const advectedMoistureFloor = clamp(
        0.64 + 0.25 * clamp(ambientMoistureTransport / 1.20, 0, 1) +
        0.08 * broadMoisturePlatform + 0.08 * sizeFromRadii,
        0.64, 0.98
      );
      rate *= reservoirRainFactor * (1 - centreFeedRelief) +
        Math.max(reservoirRainFactor, advectedMoistureFloor) * centreFeedRelief;

      // 3.7.4: axisymmetric eyewall rain weakens inland, but the *rainfall envelope* should not
      // collapse on the same timescale as surface wind. Delay and soften this central reduction;
      // the selective topology gate below removes symmetry by relocating heavy convection into
      // cells/arcs rather than simply deleting inland rainfall.
      const inlandDecayProgress = clamp((landHours - 6.0) / 24.0);
      const smoothInlandDecay = inlandDecayProgress * inlandDecayProgress * (3 - 2 * inlandDecayProgress);
      if (r < 2.0 * rmw) {
        rate *= 1 - (0.055 + 0.045 * hurricaneCore) * smoothInlandDecay;
      }
    }
  }

  // 3.3.7 final land heavy-rain topology gate. This acts only on the convective/heavy tail;
  // light/moderate stratiform rain remains broad. Persistent ground-relative mesoscale cells,
  // hill lift and off-centre frictional/shear lobes can retain extreme rates, while gaps between
  // them stay genuinely dry enough that a 24-h accumulation does not turn into one solid disk.
  if (state.landed && options.isLand) {
    // 3.7.4: separate persistence from areal coverage. Inland convection may continue for many
    // hours, but sustained heavy rain should occupy only a few ground-relative corridors/cells.
    // A very-slowly evolving anchor survives a 24-h accumulation, while the faster field lets
    // individual cells pulse and reform. This prevents an all-day smooth purple/blue carpet.
    const landHeavySeed = clamp(0.52 * landCellNoise + 0.30 * landFineNoise + 0.18 * landBroadNoise, 0, 1);
    const landHeavyTopology = smooth01(clamp((landHeavySeed - 0.42) / 0.43, 0, 1));
    const persistentLandA = rainNoise(groundXKm + 191, groundYKm - 73, simHour, 104, 112.0, 15121.7);
    const persistentLandB = rainNoise(groundXKm - 83, groundYKm + 157, simHour, 62, 148.0, 15187.3);
    const persistentLandSeed = clamp(0.66 * persistentLandA + 0.34 * persistentLandB, 0, 1);
    const persistentLandTopology = smooth01(clamp((persistentLandSeed - 0.48) / 0.38, 0, 1));
    const terrainCellSupport = clamp(
      0.14 + 0.44 * terrainWindwardLift + 0.22 * rollingHillConvectiveFactor + 0.12 * inlandDisplacedAzimuth,
      0, 1
    );
    const mesoscaleCellSupport = clamp(Math.max(
      inlandCellGate, trainingCellGate, 0.80 * persistentLandTopology, 0.72 * landHeavyTopology
    ), 0, 1);
    const heavyTopologySupport = clamp(Math.max(
      0.72 * persistentLandTopology + 0.28 * landHeavyTopology,
      0.92 * terrainCellSupport,
      0.88 * mesoscaleCellSupport
    ), 0.05, 1.04);
    const heavyBlend = smooth01(clamp((rate - 5.2) / 20, 0, 1));
    const inlandTopologyMaturity = smooth01(clamp((landHours - 0.8) / 6.5, 0, 1));
    const fragmentationStrength = clamp(
      0.14 + 0.34 * inlandTopologyMaturity + 0.30 * landBreakupProgress +
        0.10 * structuralDisorganization + 0.08 * physicalTerrainBreakup,
      0.12, 0.82
    );
    rate *= 1 - fragmentationStrength * heavyBlend * (1 - heavyTopologySupport);

    // 3.3.11: after the inner core is frictionally/terrain damaged, the strongest precipitation
    // should usually migrate away from the pressure centre into a remnant-eyewall arc, frictional
    // convergence lobe, shear-favoured sector or windward slope. Apply the hollowing only to the
    // heavy-convective part so light/moderate residual rain may still cover the centre.
    const centreDamageStrength = clamp(
      0.62 * physicalTerrainBreakup +
      0.22 * structuralDisorganization +
      0.18 * landBreakupProgress +
      0.12 * dryAirCoreExposure +
      0.10 * shearNorm * structuralDisorganization +
      0.10 * terrainFrictionAsymmetry * terrainCoreLandFraction,
      0.02, 0.95
    );
    const centreDamageEnvelope = gauss(r, Math.max(44, 1.10 * rmw + 24));
    const centreHeavyBlend = clamp((rate - 4.5) / 18, 0, 1);
    // 3.3.12: once the low-level centre has been frictionally/terrain disrupted, deep convection
    // normally shifts into remnant-eyewall arcs / frictional convergence lobes instead of remaining
    // a bullseye over the pressure centre. Even windward terrain only partially offsets this local
    // hollowing; upslope maxima should form *away* from the damaged centre.
    const centreHeavySuppression = centreDamageStrength * centreDamageEnvelope * centreHeavyBlend *
      (1 - 0.25 * terrainWindwardLift);
    rate *= 1 - centreHeavySuppression;

    // Preserve the displaced convergence arc diagnosed from the actual rough-land interaction.
    // This term only restores support where a physical lobe already exists; it cannot create rain
    // without moisture / residual vortex support.
    const displacedFrictionSupport = terrainFrictionRainLobe * inlandDisplacedRing *
      clamp(0.45 * terrainFrictionAsymmetry + 0.42 * physicalTerrainBreakup + 0.18 * landfallRainMemory, 0, 1);
    const displacedFloor = (2.0 + 11.0 * rememberedRainIntensity + 7.0 * landfallRainMemory) *
      displacedFrictionSupport * (0.50 + 0.50 * moistureTransport) * (0.46 + 0.54 * landConvectiveMask);
    // Do not let the terrain floor refill the damaged pressure centre after the hollowing above.
    const terrainFloorAfterCoreDamage = 0.78 * terrainAnchoredRain *
      (1 - 0.86 * centreDamageStrength * centreDamageEnvelope);
    rate = Math.max(rate, displacedFloor, terrainFloorAfterCoreDamage);
  }

  // CMA-style 24-h analyses usually show a broad 25-100 mm shield, a more selective
  // 100-250 mm lobe, and compact 250/400+ maxima.  Do not let a broad moisture shield sit
  // at moderate-heavy rain rates for the full accumulation window. Preserve focused rain
  // where an organized band, inner core, lowland convective cell or windward terrain supports it.
  const focusedHeavySupport = clamp(Math.max(
    0.92 * spiralGate,
    0.88 * rainbandMesoscaleComplex,
    0.96 * innerCorePresence * (intactDenseCoreScene ? denseCoreDisk * denseCoreEyeHole : primaryRing),
    0.94 * clamp(fragmentedCore / 38, 0, 1),
    0.78 * clamp(westerlyFrontalRain / 18, 0, 1),
    0.42 * clamp(westerlyNortheastTailRain / 7, 0, 1),
    0.62 * clamp(synopticConvergenceRain / 9, 0, 1),
    clamp(extremeConvectiveCell / 80, 0, 1),
    clamp(inlandScatteredConvection / 18, 0, 1),
    clamp(inlandMesoscaleTrainingCell / 48, 0, 1),
    0.70 * terrainWindwardLift
  ), 0, 1);
  if (rate > 5.5) {
    const excess = rate - 5.5;
    // Keep sustained moderate-heavy rain in organized mesoscale lobes. The previous 30%
    // compression was too aggressive and left almost no 100-250 mm class in 24-h products.
    rate = 5.5 + excess * (0.76 + 0.24 * focusedHeavySupport);
  }

  // Keep the >35-50 mm/h tail spatially compact. Very high hourly rain should require a
  // direct organized-core pass, a short embedded convective cell, or focused terrain training;
  // broad cloud shields/moisture convergence alone must not paint hundreds of kilometres of
  // torrential rain that later accumulate into unrealistic 250-500 mm annuli.
  const embeddedCellGate = clamp(shortBurstEquivalent * 1.8, 0, 1) * clamp(spiralGate, 0, 1);
  const terrainExtremeGate = options.isLand
    ? clamp((Math.max(0, options.elevation || 0) - 280) / 1500, 0, 1) *
      clamp(0.35 + 0.65 * Math.max(spiralGate, plumeAz, primaryRing), 0, 1) *
      (0.10 + 0.90 * terrainWindwardLift) * (1 - 0.75 * terrainLeeShadow)
    : 0;
  const fragmentedCoreExtremeSupport = fragmentedCoreScene
    ? clamp(fragmentedCoreField / 36, 0, 1) * clamp(0.48 + 0.52 * fragmentAzimuth, 0.28, 1)
    : 0;
  const localExtremeSupport = clamp(Math.max(
    1.05 * innerCorePresence * primaryRing,
    0.82 * innerCorePresence * (intactDenseCoreScene ? denseCoreDisk * denseCoreEyeHole : 0),
    1.04 * fragmentedCoreExtremeSupport,
    0.72 * dvorakMajorCorePotential * westerlyTransition * etNearCoreRing,
    0.92 * convectiveBurstIndex * burstRad * burstAz,
    1.08 * clamp(extremeConvectiveCell / 105, 0, 1),
    0.72 * embeddedCellGate,
    0.88 * terrainExtremeGate
  ), 0, 1);
  // Avoid a visible hard 36 mm/h shelf. Broad/unfocused rain is compressed continuously, while
  // a resolved convective/training cell retains the full tail and can exceed 50-100 mm/h locally.
  const torrentialTransition = smooth01(clamp((rate - 24) / 34, 0, 1));
  if (torrentialTransition > 0) {
    const unfocusedRetention = 0.30 + 0.70 * localExtremeSupport;
    const softReference = 24 + 12 * localExtremeSupport;
    if (rate > softReference) {
      rate = softReference + (rate - softReference) *
        ((1 - torrentialTransition) + torrentialTransition * unfocusedRetention);
    }
  }

  // Heavy/torrential rainfall is much more spatially selective than the outer cloud/rain shield.
  // Outer bands can exist 100–300+ km from the centre, and exceptional pre-TC squall lines may be
  // farther away, but broad continuous >18 mm/h fields should not follow every recurving track point.
  // Keep distant heavy rain only where an embedded cell / organized core / terrain focus supplies it.
  const r7SupportRadius = r7Mean > 0 ? 1.18 * r7Mean : 205 + 60 * sizeFromRadii;
  const heavyRainRadius = clamp(
    Math.max(210, r7SupportRadius + 42 * rainbandDominance + 28 * circulationExpansion),
    210,
    500
  );
  const distantFocusedSupport = clamp(Math.max(
    localExtremeSupport,
    0.72 * embeddedCellGate,
    0.62 * clamp(preStormSquall / 42, 0, 1),
    0.72 * terrainExtremeGate
  ), 0, 1);
  if (r > heavyRainRadius && rate > 18) {
    const decay = Math.exp(-(r - heavyRainRadius) / (105 + 26 * sizeFromRadii));
    const support = clamp(Math.max(decay, 0.12 + 0.78 * distantFocusedSupport), 0.08, 1);
    rate = 18 + (rate - 18) * support;
  }
  if (r > heavyRainRadius + 165 && rate > 10 && distantFocusedSupport < 0.42) {
    const support = Math.exp(-(r - heavyRainRadius - 165) / 90);
    rate = 10 + (rate - 10) * clamp(0.08 + 0.55 * support, 0.08, 0.63);
  }

  // Cap depends on moisture supply, structure and tendency as well as intensity. This
  // allows a moisture-rich TS/STS to produce local torrential rain without giving every
  // weak disturbance typhoon-class rainfall.
  const structuralConvectivePotential = Math.max(cdoLike ? 0.45 : 0, integrity * 0.70, strengthening * 0.70);
  let cap = 18 + 36 * intensity + 18 * moistureTransport + 14 * structuralConvectivePotential + 8 * weakening;
  if (state.rapidIntensificationMode === "uri" && riActive) cap += 20;
  else if (state.rapidIntensificationMode === "eri" && riActive) cap += 14;
  if (options.isLand && state.landed) {
    // Preserve realistic high hourly rainfall potential during the first
    // several hours of a strong/very-strong typhoon landfall.
    cap += 12 * hurricaneCore * recentLandfall * (0.65 + 0.35 * moistureTransport) * (0.35 + 0.65 * moistureReservoir);
  }
  if (options.isLand) {
    const elevationNorm = clamp(Math.max(0, options.elevation || 0) / 1800);
    const slowTraining = clamp((25 - (state.speed ?? 18)) / 19, 0, 1);
    cap += 72 * elevationNorm * slowTraining * moistureTransport * (0.45 + 0.55 * rainbandDominance) *
      (0.12 + 0.88 * terrainWindwardLift) * (1 - 0.70 * terrainLeeShadow);
  }
  cap += 22 * broadMoisturePlatform + 18 * convectiveBurstIndex;
  cap += 92 * clamp(extremeConvectiveCell / 95, 0, 1);
  cap += 52 * innerCorePresence * corePassageEnvelope;
  cap += 54 * fragmentedCoreExtremeSupport;
  cap += 26 * dryDamagedDvorakCorePotential * Math.max(fragmentInnerRing, fragmentOuterRing, dryCdoRadialEnvelope);
  cap += 30 * westerlyTransition * dvorakMajorCorePotential * etMoistPotential * Math.max(etNearCoreRing, 0.42 * frontalRad * frontalAz);
  cap += 34 * Math.max(superTyCore, rememberedSuperTyCore * landfallRainMemory) * integrity * Math.max(primaryRing, 0.60 * centerEnvelope);
  cap += 18 * landfallRainMemory * Math.max(primaryRing, 0.55 * denseCoreDisk * denseCoreEyeHole);
  cap += 30 * organizedIntactCore * (intactDenseCoreScene ? denseCoreDisk * denseCoreEyeHole : 0);

  // 3.3.9 land-surface separation. A flat, non-orographic inland point should not inherit the
  // same extreme hourly ceiling as a windward hill/mountain cell. Conversely, genuine upslope
  // training must retain enough headroom for exceptional mountain rainfall. This changes the
  // *physical rate envelope*, not the rainfall-map colour classification.
  const localTerrainSlopeForCap = Math.hypot(options.terrainSlopeEast || 0, options.terrainSlopeNorth || 0);
  const localElevationForCap = Math.max(0, options.elevation || 0);
  const windwardTerrainExtremeSupport = options.isLand
    ? clamp(
      0.48 * clamp((localElevationForCap - 120) / 950, 0, 1) +
      0.52 * clamp((localTerrainSlopeForCap - 1.8) / 11.5, 0, 1),
      0, 1
    ) * clamp(0.10 + 0.90 * terrainWindwardLift, 0, 1) * (1 - 0.82 * terrainLeeShadow)
    : 0;
  const flatNonOrographicLand = !!(options.isLand && state.landed &&
    localElevationForCap < 240 && localTerrainSlopeForCap < 3.4 &&
    terrainWindwardLift < 0.20 && windwardTerrainExtremeSupport < 0.12);

  cap = clamp(cap, vmax < 13.9 ? 28 : 36, 260);

  // Mature open-ocean CDOs should accumulate a few hundred millimetres across the moving dense
  // core, not behave as a uniformly saturated extreme-rain disk. Keep the sustained CDO
  // background in a realistic envelope while explicitly preserving narrow eyewall/hot-tower
  // bursts. This is a soft rate constraint rather than a hard daily-total clamp because the
  // precipitation model is also used outside 24-h map products.
  const marineMatureCdoFootprint = !options.isLand && matureCdoScene &&
    Math.max(denseCoreDisk * denseCoreEyeHole, cdoDisk * cdoEyeHole) > 0.16;
  if (marineMatureCdoFootprint) {
    const marineEmbeddedExtremeSupport = clamp(Math.max(
      coreExtremeCell / 105,
      convectiveBurst / 78,
      0.82 * primaryRing,
      bandExtremeCell / 120
    ), 0, 1);
    // 3.3.12 marine CDO calibration: the broad dense overcast should build a few-hundred-mm
    // moving-core accumulation, not sustain 40-70 mm/h across the whole CDO for many hours.
    // Keep narrow eyewall/hot-tower bursts explicitly through marineEmbeddedExtremeSupport.
    const marineCdoSoftCeiling = 21.5 + 13.5 * marineEmbeddedExtremeSupport;
    if (rate > marineCdoSoftCeiling) {
      rate = marineCdoSoftCeiling + (rate - marineCdoSoftCeiling) *
        (0.08 + 0.31 * marineEmbeddedExtremeSupport);
    }
    // Broad CDO background is now tuned so a repeatedly sampled marine core normally integrates
    // into roughly the 300-600 mm/day regime. Narrow eyewall / hot-tower support still retains a
    // substantially higher instantaneous cap and therefore sharp embedded peaks.
    cap = Math.min(cap, 54 + 24 * marineEmbeddedExtremeSupport);
  }

  if (flatNonOrographicLand) {
    // Flat-land torrential cells are possible, but repeated 70-100+ mm/h rates over the same
    // point are not allowed to behave like an orographic training maximum. Keep a rare-cell tail
    // while sharply reducing only the *sustained background*. A slow/stalled moist vortex may still
    // produce exceptional flat-land point totals through repeatedly firing mesoscale cells; the
    // 24-h renderer therefore no longer imposes a fixed flat-land accumulation ceiling.
    const plainCellSupport = clamp(Math.max(
      inlandScatteredConvection / 24,
      inlandExtremeCell / 90,
      bandExtremeCell / 105,
      synopticConvergenceRain / 18
    ), 0, 1);
    const plainTrainingExtremeSupport = clamp(Math.max(
      plainCellSupport,
      inlandMesoscaleTrainingCell / 72,
      stalledInlandTraining * rareTrainingGate
    ), 0, 1);
    const plainHourlySoftCeiling = 38 + 26 * plainCellSupport + 34 * plainTrainingExtremeSupport +
      8 * landfallRainMemory;
    if (rate > plainHourlySoftCeiling) {
      rate = plainHourlySoftCeiling + (rate - plainHourlySoftCeiling) *
        (0.16 + 0.64 * plainTrainingExtremeSupport);
    }
    cap = Math.min(cap, 82 + 78 * plainTrainingExtremeSupport);
  } else if (options.isLand && windwardTerrainExtremeSupport > 0.34) {
    // True windward hill/mountain training retains the exceptional hourly tail.
    cap = Math.min(260, cap + 38 * windwardTerrainExtremeSupport);
  }
  rate = clamp(rate, 0, cap);

  // Preserve substantial inner/outer-band accumulations without returning to the old problem where
  // remote stations several hundred kilometres away received an almost continuous broad-rain penalty.
  // Beyond the principal rainband envelope, residence-time rainfall tapers exponentially while
  // embedded band pulses can still produce short-lived heavy showers.
  // 3.7.7: slightly tighten the generic storm-centred rain footprint.  Remote terrain/feeder
  // mechanisms retain their explicit floors below, so this reduction affects over-broad diffuse
  // rainfall rather than legitimate remote orographic maxima.
  const remoteTaperStart = 178 + 39 * sizeFromRadii + 14 * circulationExpansion;
  if (r > remoteTaperStart) {
    const remoteScale = 116 + 31 * sizeFromRadii + 21 * moistureTransport;
    const taper = Math.exp(-(r - remoteTaperStart) / remoteScale);
    // Remote topographic / feeder rainfall is terrain- or convergence-locked, not a direct
    // extension of the storm-centred rain shield. Keep a mechanism floor so the generic radial
    // taper cannot delete a physically forced secondary maximum.
    const remoteMechanismFloor = 0.88 * terrainAnchoredRain + 0.92 * remoteTerrainFeederRain + 0.24 * synopticConvergenceRain +
      0.62 * westerlyNortheastTailRain + 0.34 * largeInlandCirculationRain;
    rate = Math.max(rate * taper, remoteMechanismFloor * Math.exp(-Math.max(0, r - 720) / 260));
  }

  const maxRainRadius = 418 + 66 * sizeFromRadii + 32 * moistureTransport + 27 * circulationExpansion;
  if (r > maxRainRadius) {
    const farTaper = Math.exp(-(r - maxRainRadius) / 132);
    const farMechanismFloor = 0.78 * terrainAnchoredRain + 0.86 * remoteTerrainFeederRain + 0.16 * synopticConvergenceRain +
      0.52 * westerlyNortheastTailRain + 0.26 * largeInlandCirculationRain;
    rate = Math.max(rate * farTaper, farMechanismFloor * Math.exp(-Math.max(0, r - 820) / 190));
  }
  // Round170 / TRMM-PR: observed eyewalls contain intermittent convective cells,
  // while outer rainbands have sparse convective coverage (Hence & Houze 2011/2012).
  // Previous blended moisture fields left a widespread quasi-uniform moderate/heavy
  // rate even after band localisation. Apply deterministic, scale-separated
  // cell occupancy to the *excess* rainfall, not the synoptic stratiform drizzle.
  // Moving and terrain-anchored coherent noise avoids per-frame pixel flicker.
  const convectiveCellLong = rainNoise(
    groundXKm + 217.0, groundYKm - 91.0, simHour, 68.0, 5.8, 17031.0);
  const convectiveCellShort = rainNoise(
    groundXKm - 51.0, groundYKm + 139.0, simHour, 29.0, 2.9, 17063.0);
  const cellOccupancy = smooth01(clamp(
    (0.67 * convectiveCellLong + 0.33 * convectiveCellShort - 0.35) / 0.44, 0, 1));
  const coherentBandFocus = clamp(Math.max(
    0.88 * spiralGate, 0.72 * rainbandMesoscaleComplex,
    0.92 * innerCorePresence * primaryRing,
    0.77 * terrainWindwardLift,
    0.75 * clamp(coastalMesoscaleTrainingCell / 32, 0, 1)
  ), 0, 1);
  const baselineShield = Math.min(rate, options.isLand ? 1.25 : 1.65);
  const heavyExcess = Math.max(0, rate - baselineShield);
  const highRateShare = smooth01(clamp((rate - 3.2) / 16.0, 0, 1));
  const intermittency = clamp(
    0.43 + 0.52 * cellOccupancy + 0.24 * coherentBandFocus * cellOccupancy,
    0.43, 1.19);
  // Climatological coverage correction: large rain shields preferentially
  // lose their uniform >5 mm/h apron, compact forced cells retain extremes.
  rate = baselineShield + heavyExcess * (
    (1 - highRateShare) * (0.74 + 0.24 * cellOccupancy) +
    highRateShare * intermittency
  );

  // The mechanism floors above are applied after the generic radial taper; re-apply the physical
  // hourly cap so remote orographic support cannot bypass the same convective upper bound used
  // everywhere else.
  rate = clamp(rate, 0, cap);
  if (rate < 0.07) rate = 0;

  const components = {
    outerCirculation,
    spiralRainband,
    detachedOuterRainband,
    connectingBand,
    preStormSquall,
    eyewall,
    center,
    fragmentedCore,
    convectiveBurst,
    extremeConvectiveCell,
    coreExtremeCell,
    bandExtremeCell,
    bandHyperCell,
    inlandExtremeCell,
    inlandMesoscaleTrainingCell,
    inlandScatteredConvection,
    inlandVortexRain,
    largeInlandCirculationRain,
    westerlyFrontalRain,
    westerlyNortheastTailRain,
    monsoonPlume,
    moistureConvergence,
    stratiformShield,
    diffuseRainShield,
    landfallConvergence,
    coastalFrictionConvergence,
    coastalMesoscaleTrainingCell,
    terrainAnchoredRain,
    remoteTerrainFeederRain,
    synopticConvergenceRain
  };
  const mechanismNames: Array<[keyof typeof components, string]> = [
    ["outerCirculation", "外围环流降水"],
    ["spiralRainband", raggedEye ? "破碎结构螺旋雨带" : "螺旋雨带"],
    ["detachedOuterRainband", "脱离主雨盾的外雨带斑块"],
    ["preStormSquall", "台前辐合/飑线"],
    ["eyewall", ewrcActive ? "眼墙置换双环降水" : integrity < 0.58 ? "非均匀破碎眼墙降水" : "眼墙降水"],
    ["center", matureCdoScene ? "成熟CDO/眼墙强对流" : dryIntrudedCdoScene ? "干空气侵蚀后的残余CDO/眼墙弧" : obstruction > 0.45 ? "封眼/中心对流降水" : "中心对流降水"],
    ["fragmentedCore", "残破中心/外眼墙样强对流"],
    ["convectiveBurst", state.rapidIntensificationMode === "uri" ? "URI超高速中心爆发" : state.rapidIntensificationMode === "eri" ? "ERI极端对流爆发" : "RI中心对流爆发"],
    ["extremeConvectiveCell", "局地极强对流单体"],
    ["inlandMesoscaleTrainingCell", "稍内陆中尺度训练强降水单体"],
    ["inlandScatteredConvection", "平原残余环流零散强对流"],
    ["inlandVortexRain", "登陆后随中心内移的残余环流雨盾"],
    ["largeInlandCirculationRain", "大环流内陆平原/丘陵持续强降水"],
    ["westerlyFrontalRain", "西风带/温带转化不对称强降水"],
    ["westerlyNortheastTailRain", "西风带东北暖输送带云尾降水"],
    ["monsoonPlume", inScsMoistureCorridor ? "南海/季风水汽输送带" : "季风水汽输送带"],
    ["moistureConvergence", weakening > 0.25 ? "减弱期大尺度水汽辐合" : "大尺度水汽辐合"],
    ["stratiformShield", "层状云雨盾"],
    ["diffuseRainShield", "大范围湿润云雨区"],
    ["landfallConvergence", "登陆摩擦辐合/地形增雨"],
    ["coastalFrictionConvergence", "海陆粗糙度差沿岸锁定辐合雨带"],
    ["coastalMesoscaleTrainingCell", "沿岸辐合带嵌入式训练对流"],
    ["terrainAnchoredRain", "地形锁定湿气流抬升降水"],
    ["remoteTerrainFeederRain", "外围湿流远程迎风坡降水"],
    ["synopticConvergenceRain", "持续水汽辐合/中尺度雨带"]
  ];

  let dominantMechanism = "无显著降水";
  let maxValue = 0;
  for (const [key, label] of mechanismNames) {
    if (components[key] > maxValue) {
      maxValue = components[key];
      dominantMechanism = label;
    }
  }

  return { rate, components, dominantMechanism };
}
