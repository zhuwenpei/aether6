/**
 * Hurricane Tracker (Unity 2018) compatibility port.
 *
 * This module intentionally mirrors the public behaviour recovered from the supplied
 * Hurricane Tracker release rather than AETHER's native forecast/cloud algorithms:
 *   - storm-cloud display uses the Unity StormSystem-style Strength/CloudCover chain,
 *     hemisphere flipping, deterministic Seed/noise and Normal/IR display modes;
 *   - pseudo multi-model guidance uses the eight recovered StormModel parameter sets and
 *     repeatedly integrates a single procedural wind field into the future.
 *
 * The original compiled DXBC shader's pixel equations and the full IL body of getWind()/
 * getJetstream() were not recoverable from the supplied analysis, so those two low-level
 * pieces are reconstructed with equivalent continuous procedural fields while preserving
 * the recovered inputs, update order and model parameters.
 */

import type { Typhoon } from "../types";
import { getConvectiveField, sampleConvectiveField, type ConvectiveField } from "./ConvectiveDynamics";

export type HurricaneTrackerCloudMode = "normal" | "ir";
export type HurricaneTrackerSatellitePalette = "rammb" | "ott" | "ir";

export interface HurricaneTrackerCloudSample {
  color: string;
  density: number;
  /** Synthetic long-wave IR cloud-top brightness temperature. */
  brightnessTemperatureC?: number;
  cloudCover: number;
  strength: number;
  annular: boolean;
}

export interface HurricaneTrackerModelSpec {
  name: string;
  resolution: number;
  iStep: number;
  length: number;
  color: string;
}

export interface HurricaneTrackerTrackPoint {
  lat: number;
  lon: number;
  step: number;
  futureTime: number;
  leadFraction: number;
}

export interface HurricaneTrackerModelTrack {
  id: string;
  spec: HurricaneTrackerModelSpec;
  track: HurricaneTrackerTrackPoint[];
}

export const HURRICANE_TRACKER_MODEL_SPECS: readonly HurricaneTrackerModelSpec[] = [
  { name: "ICON",  resolution: 15, iStep: 500, length: 6, color: "#0000ff" },
  { name: "GFS",   resolution: 15, iStep: 225, length: 5, color: "#00ff00" },
  { name: "GFS2",  resolution: 15, iStep: 325, length: 5, color: "#003300" },
  { name: "GFS3",  resolution: 15, iStep: 425, length: 5, color: "#00b380" },
  { name: "EURO",  resolution: 8,  iStep: 200, length: 6, color: "#ffff00" },
  { name: "EURO2", resolution: 8,  iStep: 150, length: 6, color: "#333300" },
  { name: "EURO3", resolution: 8,  iStep: 250, length: 6, color: "#a66600" },
  { name: "HMNI",  resolution: 5,  iStep: 10,  length: 7, color: "#ffffff" }
] as const;

const MPS_TO_MPH = 2.2369362920544;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// Keep the structural satellite renderer on the same intensity scale as AETHER's default
// Dvorak-derived Vmax. This mirrors estimateDvorakTNumber() without importing the rainfall module
// (and therefore avoids coupling the product renderer back into the precipitation dependency tree).
function satelliteDvorakTNumber(vmaxMps: number, stored?: number): number {
  if (Number.isFinite(stored as number)) return clamp(Number(stored), 1, 8);
  const kt = Math.max(0, vmaxMps) * 1.943844;
  const table: Array<[number, number]> = [
    [25, 1.5], [30, 2.0], [35, 2.5], [45, 3.0], [55, 3.5], [65, 4.0], [77, 4.5],
    [90, 5.0], [102, 5.5], [115, 6.0], [127, 6.5], [140, 7.0], [155, 7.5], [170, 8.0]
  ];
  if (kt <= table[0][0]) return clamp(1 + (kt / table[0][0]) * 0.5, 1, 1.5);
  for (let i = 1; i < table.length; i++) {
    if (kt <= table[i][0]) {
      const [w0, t0] = table[i - 1];
      const [w1, t1] = table[i];
      return t0 + (t1 - t0) * ((kt - w0) / Math.max(1e-6, w1 - w0));
    }
  }
  return 8;
}

function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const CLOUD_HASH_CACHE = new Map<string,number>();
function unitHash(input: string): number {
  const cached=CLOUD_HASH_CACHE.get(input);if(cached!==undefined)return cached;
  const result=hash32(input)/4294967296;CLOUD_HASH_CACHE.set(input,result);
  while(CLOUD_HASH_CACHE.size>2048)CLOUD_HASH_CACHE.delete(CLOUD_HASH_CACHE.keys().next().value!);
  return result;
}

// Unity's Spawner uses Mathf.PerlinNoise with a fixed noise implementation and shifts its input
// coordinates by a random global `seed`. This is the classic improved-Perlin implementation used
// here as the browser-side equivalent; unlike the previous value-noise approximation it preserves
// gradient continuity and, importantly, all recovered coordinate/scaling formulas verbatim.
const PERLIN_PERMUTATION = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,
  140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
  247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,
  57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,
  60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
  65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
  200,196,135,130,116,188,159,86,164,100,109,198,173,186,
  3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,
  85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,
  170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,
  43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,
  185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,
  179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,
  199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,
  236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215
] as const;
const PERLIN_P = new Uint16Array(512);
for (let i = 0; i < 512; i++) PERLIN_P[i] = PERLIN_PERMUTATION[i & 255];
const perlinFade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const perlinLerp = (t: number, a: number, b: number) => a + t * (b - a);
const perlinGrad = (hash: number, x: number, y: number) => {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};
function unityPerlinNoise(x: number, y: number): number {
  const xi0 = Math.floor(x);
  const yi0 = Math.floor(y);
  const xi = xi0 & 255;
  const yi = yi0 & 255;
  const xf = x - xi0;
  const yf = y - yi0;
  const u = perlinFade(xf);
  const v = perlinFade(yf);
  const aa = PERLIN_P[PERLIN_P[xi] + yi];
  const ab = PERLIN_P[PERLIN_P[xi] + yi + 1];
  const ba = PERLIN_P[PERLIN_P[xi + 1] + yi];
  const bb = PERLIN_P[PERLIN_P[xi + 1] + yi + 1];
  const x1 = perlinLerp(u, perlinGrad(aa, xf, yf), perlinGrad(ba, xf - 1, yf));
  const x2 = perlinLerp(u, perlinGrad(ab, xf, yf - 1), perlinGrad(bb, xf - 1, yf - 1));
  // Mathf.PerlinNoise is normalized to approximately 0..1. Clamp matches Unity's public contract.
  return clamp(perlinLerp(v, x1, x2) * 0.5 + 0.5, 0, 1);
}

/** Smooth deterministic value noise used only for the reconstructed Storm shader texture field. */
function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const h = (ix: number, iy: number) => {
    let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  };
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let value = 0;
  let amp = 0.56;
  let norm = 0;
  let freq = 1;
  for (let octave = 0; octave < 4; octave++) {
    value += valueNoise2D(x * freq, y * freq, seed + octave * 1013) * amp;
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return norm > 0 ? value / norm : 0;
}

function stormIdentity(storm: Partial<Typhoon>, seed = "HurricaneTracker"): string {
  return `${seed}|${storm.id || "storm"}`;
}

/**
 * Recovered Unity coordinate conversion:
 * longitude / 360 * 80, latitude / 180 * 40.
 */
export function latLonToHurricaneTrackerWorld(lat: number, lon: number): { x: number; z: number } {
  return { x: lon / 360 * 80, z: lat / 180 * 40 };
}

export function hurricaneTrackerWorldToLatLon(x: number, z: number): { lat: number; lon: number } {
  return { lon: x * 360 / 80, lat: z * 180 / 40 };
}

export function getHurricaneTrackerCloudParameters(storm: Partial<Typhoon>, seed = "HurricaneTracker") {
  // AETHER stores vmax in m/s. Hurricane Tracker stores windspeed in mph (confirmed by its
  // 39/74/96/111/131/156 intensity thresholds), so all recovered formulas use the converted value.
  const windSpeedMph = Math.max(0, Number(storm.vmax || 0)) * MPS_TO_MPH;
  const key = stormIdentity(storm, seed);
  // Exact StormSystemScript.Start() ranges recovered from Assembly-CSharp.dll. Unity samples these
  // once from Random.Range; the port uses stable per-storm hashes so save/load and re-rendering do
  // not randomly change an already-created storm.
  const strengthUniqueness = -0.1 + unitHash(`${key}|strength`) * 0.2;       // Range(-1,1) / 10
  const cloudCoverUniqueness = -0.5 + unitHash(`${key}|cloudCover`) * 0.6; // Range(-5,1) / 10
  const annular = unitHash(`${key}|annular`) < (1 / 9); // Range(1,10) < 2

  // Exact StormSystemScript.Update() branch and formulas recovered from IL.
  const cloudCover = windSpeedMph < 10
    ? clamp(1.5 - (windSpeedMph / 10) / 2 + cloudCoverUniqueness, 0.5, 1.5)
    : clamp(1 - windSpeedMph / 200 + cloudCoverUniqueness, 0.3, 1.0);
  const strength = clamp(windSpeedMph / 75 + strengthUniqueness, 0.4, 2.0);

  return { cloudCover, strength, cloudCoverUniqueness, strengthUniqueness, annular, windSpeedMph };
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(a, 0, 1).toFixed(3)})`;
}

function normalCloudColor(density: number): string {
  if (density <= 0.055) return "transparent";
  const d = clamp((density - 0.055) / 0.945, 0, 1);
  const shade = 176 + 79 * Math.pow(d, 0.58);
  const blueLift = 5 + 5 * d;
  return rgba(shade - 5, shade, shade + blueLift, 0.12 + 0.82 * Math.pow(d, 0.78));
}

function irCloudColor(density: number): string {
  if (density <= 0.07) return "transparent";
  const d = clamp((density - 0.07) / 0.93, 0, 1);
  // Recreates the release's observed enhanced-IR ordering (blue -> green -> yellow -> red -> black).
  if (d < 0.24) {
    const t = d / 0.24;
    return rgba(25 - 8 * t, 75 + 55 * t, 220 + 20 * t, 0.30 + 0.35 * t);
  }
  if (d < 0.46) {
    const t = (d - 0.24) / 0.22;
    return rgba(17 + 25 * t, 130 + 95 * t, 240 - 185 * t, 0.66 + 0.10 * t);
  }
  if (d < 0.68) {
    const t = (d - 0.46) / 0.22;
    return rgba(42 + 210 * t, 225 - 12 * t, 55 - 40 * t, 0.77 + 0.08 * t);
  }
  if (d < 0.86) {
    const t = (d - 0.68) / 0.18;
    return rgba(252, 213 - 190 * t, 15 - 8 * t, 0.86 + 0.07 * t);
  }
  const t = (d - 0.86) / 0.14;
  return rgba(235 * (1 - t), 22 * (1 - t), 18 * (1 - t), 0.94);
}

interface SatelliteColorStop { tempC: number; rgb: [number, number, number]; }

function interpolateSatelliteStops(tempC: number, stops: readonly SatelliteColorStop[]): [number, number, number] {
  if (tempC >= stops[0].tempC) return stops[0].rgb;
  if (tempC <= stops[stops.length - 1].tempC) return stops[stops.length - 1].rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    const warm = stops[i];
    const cold = stops[i + 1];
    if (tempC <= warm.tempC && tempC >= cold.tempC) {
      const t = clamp((warm.tempC - tempC) / Math.max(1e-6, warm.tempC - cold.tempC), 0, 1);
      return [
        warm.rgb[0] + (cold.rgb[0] - warm.rgb[0]) * t,
        warm.rgb[1] + (cold.rgb[1] - warm.rgb[1]) * t,
        warm.rgb[2] + (cold.rgb[2] - warm.rgb[2]) * t
      ];
    }
  }
  return stops[stops.length - 1].rgb;
}

// RAMMB/CIRA Enhanced-V temperature breakpoints. The documented enhancement is temperature based;
// AETHER has no radiative-transfer model, so the procedural cloud density is first converted into a
// synthetic 10-12 µm brightness temperature and then mapped through the published RGB breakpoints.
const RAMMB_ENHANCED_V_STOPS: readonly SatelliteColorStop[] = [
  { tempC: 54.5, rgb: [0, 0, 0] },
  { tempC: -24.0, rgb: [255, 255, 255] },
  { tempC: -29.5, rgb: [255, 255, 0] },
  { tempC: -40.0, rgb: [94, 94, 0] },
  { tempC: -41.0, rgb: [143, 0, 0] },
  { tempC: -50.0, rgb: [234, 0, 0] },
  { tempC: -51.0, rgb: [230, 0, 230] },
  { tempC: -55.0, rgb: [190, 0, 190] },
  { tempC: -56.0, rgb: [0, 73, 122] },
  { tempC: -60.0, rgb: [0, 157, 203] },
  { tempC: -61.0, rgb: [0, 255, 0] },
  { tempC: -65.0, rgb: [137, 137, 0] },
  { tempC: -71.0, rgb: [178, 178, 178] },
  { tempC: -75.0, rgb: [68, 68, 68] },
  { tempC: -76.0, rgb: [0, 82, 255] },
  { tempC: -80.0, rgb: [0, 0, 180] },
  { tempC: -81.0, rgb: [255, 0, 126] },
  { tempC: -85.0, rgb: [157, 0, 80] },
  { tempC: -86.0, rgb: [225, 225, 225] },
  { tempC: -109.0, rgb: [0, 0, 0] }
] as const;

// OTT enhancement calibrated against the user-supplied GOES-18 BAND14-OTT reference colour bar.
// Unlike the previous approximation, the breakpoints below follow the actual legend ordering:
// warm cloud in black/grey, an abrupt cyan transition near -29 C, blue around -35..-40 C,
// green near -45..-55 C, yellow/orange near -60..-70 C, red/dark-red near -74..-84 C,
// then a second black/grey shelf before the very-cold pink/magenta branch below about -96 C.
// This is intentionally non-monotonic in luminance; it is an enhancement table, not a physical
// greyscale transfer function.
const OTT_STYLE_STOPS: readonly SatelliteColorStop[] = [
  // Directly sampled from the user-supplied GOES-18 BAND14-OTT colour bar.  The
  // enhancement is intentionally discontinuous at -23 C, -75 C and -85 C.
  { tempC: 50,  rgb: [0, 0, 0] },
  { tempC: 30,  rgb: [0, 0, 0] },
  { tempC: 25,  rgb: [9, 9, 9] },
  { tempC: 20,  rgb: [28, 28, 28] },
  { tempC: 15,  rgb: [48, 48, 48] },
  { tempC: 10,  rgb: [68, 68, 68] },
  { tempC: 5,   rgb: [87, 87, 87] },
  { tempC: 0,   rgb: [109, 109, 109] },
  { tempC: -5,  rgb: [129, 129, 129] },
  { tempC: -10, rgb: [149, 149, 149] },
  { tempC: -15, rgb: [168, 168, 168] },
  { tempC: -20, rgb: [188, 188, 188] },
  { tempC: -22, rgb: [198, 198, 198] },
  { tempC: -23, rgb: [0, 255, 255] },
  { tempC: -25, rgb: [0, 195, 222] },
  { tempC: -28, rgb: [0, 120, 181] },
  { tempC: -30, rgb: [0, 75, 156] },
  { tempC: -33, rgb: [0, 0, 115] },
  { tempC: -35, rgb: [0, 45, 95] },
  { tempC: -37, rgb: [0, 90, 74] },
  { tempC: -40, rgb: [0, 165, 41] },
  { tempC: -42, rgb: [0, 225, 14] },
  { tempC: -44, rgb: [15, 255, 0] },
  { tempC: -48, rgb: [105, 255, 0] },
  { tempC: -50, rgb: [165, 255, 0] },
  { tempC: -54, rgb: [255, 255, 0] },
  { tempC: -58, rgb: [255, 150, 0] },
  { tempC: -60, rgb: [255, 105, 0] },
  { tempC: -62, rgb: [255, 60, 0] },
  { tempC: -64, rgb: [255, 0, 0] },
  { tempC: -66, rgb: [210, 0, 0] },
  { tempC: -68, rgb: [165, 0, 0] },
  { tempC: -70, rgb: [105, 0, 0] },
  { tempC: -72, rgb: [60, 0, 0] },
  { tempC: -74, rgb: [15, 0, 0] },
  { tempC: -75, rgb: [14, 14, 14] },
  { tempC: -77, rgb: [54, 54, 54] },
  { tempC: -80, rgb: [122, 122, 122] },
  { tempC: -82, rgb: [162, 162, 162] },
  { tempC: -84, rgb: [203, 203, 203] },
  { tempC: -85, rgb: [230, 100, 188] },
  { tempC: -87, rgb: [212, 82, 177] },
  { tempC: -90, rgb: [182, 53, 160] },
  { tempC: -92, rgb: [158, 29, 146] },
  { tempC: -95, rgb: [134, 6, 132] }
] as const;

function syntheticBrightnessTemperatureC(density: number): number {
  const d = clamp((density - 0.035) / 0.965, 0, 1);
  // High-density convective towers reach about -100 C, while diffuse outer cirrus remains much
  // warmer. The nonlinear mapping preserves more visual separation in the -45..-80 C range.
  return 22 - 124 * Math.pow(d, 0.74);
}

export function getHurricaneTrackerSatelliteColorForTemperature(
  tempC: number,
  palette: HurricaneTrackerSatellitePalette,
  alpha = 1
): string {
  if (palette === "ir") {
    const t = clamp((18 - tempC) / 118, 0, 1);
    const shade = 28 + 227 * Math.pow(t, 0.82);
    return rgba(shade, shade, shade + Math.min(8, 8 * t), alpha);
  }
  const [r, g, b] = interpolateSatelliteStops(tempC, palette === "rammb" ? RAMMB_ENHANCED_V_STOPS : OTT_STYLE_STOPS);
  return rgba(r, g, b, alpha);
}

function satellitePaletteColor(density: number, palette: HurricaneTrackerSatellitePalette, brightnessTemperatureC?: number): string {
  if (density <= 0.035) return "transparent";
  const tempC = Number.isFinite(brightnessTemperatureC as number)
    ? Number(brightnessTemperatureC)
    : syntheticBrightnessTemperatureC(density);
  const alpha = clamp(0.20 + Math.pow(clamp((density - 0.035) / 0.965, 0, 1), 0.58) * 0.80, 0, 1);
  return getHurricaneTrackerSatelliteColorForTemperature(tempC, palette, alpha);
}

/**
 * Sample a StormSystem-style cloud pixel at the requested geographic point.
 * The cloud geometry is generated procedurally because StrongHeight1/Annular1 and the DXBC pixel
 * equations are not available as source code, but it preserves the recovered shader data flow.
 */
function getHurricaneTrackerCloudHalfLat(storm: Partial<Typhoon>): number {
  const windKt = Math.max(0, Number(storm.vmax ?? 0) * 1.94384449);
  const bandDominance = clamp(Number(storm.rainbandDominance ?? 0.48), 0, 1);
  const broadMoisture = clamp(Number(storm.broadMoisturePlatform ?? 0.46), 0, 1);
  const deepCoverage = clamp(Number(storm.deepConvectiveCoverage ?? 0.40), 0, 1);
  const wrap = clamp(Number(storm.eyewallWrapProgress ?? 0), 0, 1);
  const intensity = smoothstep((windKt - 25) / 85);
  // Mature western-Pacific cyclones frequently carry feeder bands 700-1000 km from the LLCC.
  // Keep weak disturbances broad enough for scattered convection but reserve the largest footprint
  // for organized systems with a strong moisture envelope and mature rainbands.
  return clamp(5.7 + 1.15 * bandDominance + 0.72 * broadMoisture + 0.48 * deepCoverage + 0.45 * intensity + 0.28 * wrap, 5.7, 8.25);
}

/**
 * Sample a lifecycle-aware tropical-cyclone cloud pixel.
 *
 * Morphology is intentionally staged rather than scaled from one permanent spiral texture:
 *  - TD / weak disturbance: scattered, weakly rotating convective clusters with no clean spiral;
 *  - organizing TS: repeated convective bursts begin to wrap into broken curved arcs;
 *  - core building: inner bands merge into a CDO and a coherent eyewall begins to form;
 *  - homogenized mature core: broad cold CDO, embedded towers, long feeder bands and finally an eye;
 *  - hostile environments tear the same structures apart through dry-air/shear/land coupling.
 */
type CloudBandRandom = { start: number; length: number; phase: number; pitch: number; width: number; power: number };
type CloudRenderFrame = {
  params: ReturnType<typeof getHurricaneTrackerCloudParameters>;
  identity: string;
  seedInt: number;
  halfLat: number;
  bands: CloudBandRandom[];
  cdoAxis: number;
  cdoAxisRatio: number;
  cdoHealthyAxis: number;
  fastPixel: boolean;
};

/** Hash the storm's time-invariant spiral coefficients once per tile, not millions of times. */
function createCloudRenderFrame(storm: Partial<Typhoon>, seed: string, halfLat: number): CloudRenderFrame {
  const identity = stormIdentity(storm, seed);
  return {
    params: getHurricaneTrackerCloudParameters(storm, seed), identity, seedInt: hash32(identity), halfLat,
    bands: Array.from({ length: 7 }, (_, i) => ({
      start: unitHash(`${identity}|rb-start|${i}`), length: unitHash(`${identity}|rb-length|${i}`),
      phase: unitHash(`${identity}|rb-phase|${i}`), pitch: unitHash(`${identity}|rb-pitch|${i}`),
      width: unitHash(`${identity}|rb-width|${i}`), power: unitHash(`${identity}|rb-power|${i}`)
    })),
    cdoAxis: unitHash(`${identity}|cdo-axis`),
    cdoAxisRatio: unitHash(`${identity}|cdo-axis-ratio`),
    cdoHealthyAxis: unitHash(`${identity}|cdo-healthy-axis`), fastPixel: true
  };
}

export function sampleHurricaneTrackerCloud(
  storm: Partial<Typhoon>,
  lat: number,
  lon: number,
  simulationHour: number,
  mode: HurricaneTrackerCloudMode,
  seed = "HurricaneTracker",
  resolvedDynamics?: ConvectiveField,
  frame?: CloudRenderFrame
): HurricaneTrackerCloudSample {
  const stormLat = Number(storm.lat || 0);
  const stormLon = Number(storm.lon || 0);
  const params = frame?.params ?? getHurricaneTrackerCloudParameters(storm, seed);
  const identity = frame?.identity ?? stormIdentity(storm, seed);
  const seedInt = frame?.seedInt ?? hash32(identity);
  const hemisphereSign = stormLat < 0 ? -1 : 1;

  const cosLat = Math.max(0.22, Math.cos(stormLat * Math.PI / 180));
  const geoDxKm = (lon - stormLon) * 111.12 * cosLat;
  const geoDyKm = (lat - stormLat) * 111.12;
  const halfLat = frame?.halfLat ?? getHurricaneTrackerCloudHalfLat(storm);
  const cloudRadiusKm = halfLat * 111.12 * 0.96;
  const radiusKm = Math.hypot(geoDxKm, geoDyKm);
  if (radiusKm > cloudRadiusKm * 1.08) {
    return { color: "transparent", density: 0, brightnessTemperatureC: 30, cloudCover: params.cloudCover, strength: params.strength, annular: false };
  }

  const x = geoDxKm / cloudRadiusKm;
  const y = geoDyKm / cloudRadiusKm;
  const r = Math.hypot(x, y);
  const theta = Math.atan2(y, x) * hemisphereSign;
  const timePhase = simulationHour * (0.010 + 0.0055 * params.strength) * hemisphereSign;

  const vmaxMs = Math.max(0, Number(storm.vmax ?? 0));
  const windKt = vmaxMs * 1.94384449;
  const dvorakT = satelliteDvorakTNumber(vmaxMs, Number(storm.dvorakTNumber));
  const dvorakOrganization = smoothstep((dvorakT - 2.6) / 3.5);
  const dvorakMajorCore = smoothstep((dvorakT - 4.0) / 2.2);
  const dvorakExtremeCore = smoothstep((dvorakT - 5.2) / 1.8);
  // Intensity changes how energy is distributed, not simply how brightly every cloud is tinted:
  // weak systems are band/cell dominated; an intact strong vortex concentrates the deepest tops
  // in the CDO while retaining organized, moderately cold feeder bands.
  const weakBandRegime = 1 - smoothstep((vmaxMs - 19.0) / 15.0);
  // Dvorak-pattern staging. These gates are deliberately overlapping: real cyclones do not jump
  // from a curved-band pattern to an eye pattern in one frame. They provide a morphology prior
  // tied to the same intensity analysis used elsewhere in AETHER.
  const dvorakCurvedBand = clamp(smoothstep((dvorakT - 1.8) / 1.8) * (1 - smoothstep((dvorakT - 4.2) / 1.2)), 0, 1);
  const dvorakCdoPattern = clamp(smoothstep((dvorakT - 2.8) / 1.8) * (1 - 0.34 * smoothstep((dvorakT - 6.0) / 1.0)), 0, 1);
  const dvorakEyePattern = smoothstep((dvorakT - 4.4) / 1.8);
  const rawDeepCoverage = clamp(Number(storm.deepConvectiveCoverage ?? smoothstep((windKt - 24) / 62) * 0.70), 0, 1);
  const burst = clamp(Number(storm.convectiveBurstIndex ?? 0), 0, 1);
  const rawCoreCompactness = clamp(Number(storm.coreCompactness ?? smoothstep((windKt - 38) / 62) * 0.68), 0, 1);
  const rawEyewallWrap = clamp(Number(storm.eyewallWrapProgress ?? 0), 0, 1);
  const eyeMemory = clamp(Number(storm.eyeFormationMemory ?? 0), 0, 1);
  const rawIntegrity = clamp(Number(storm.eyewallIntegrity ?? 0), 0, 1);
  const eyeClearance = clamp(Number(storm.eyeClearance ?? 0), 0, 1);
  const eyeObstruction = clamp(Number(storm.eyeObstruction ?? 0), 0, 1);
  const rawStructuralDisorganization = clamp(Number(storm.structuralDisorganization ?? 0), 0, 1);
  const llccExposure = clamp(Number(storm.llccExposure ?? 0), 0, 1);
  const rainbandDominance = clamp(Number(storm.rainbandDominance ?? 0.52), 0, 1);
  const broadMoisture = clamp(Number(storm.broadMoisturePlatform ?? 0.46), 0, 1);
  const scar = clamp(Number(storm.coreRebuildScar ?? 0), 0, 1);
  const landHours = Math.max(0, Number(storm.landHours ?? 0));
  const terrainDamage = clamp(
    0.50 * Number(storm.terrainCoreLandFraction ?? (storm.landed ? 0.45 : 0)) +
    0.28 * Number(storm.terrainBlockingMemory ?? 0) +
    0.24 * Number(storm.terrainHollowCoreMemory ?? 0), 0, 1
  );
  const landTimeDamage = storm.landed ? smoothstep(landHours / 8.0) : smoothstep(Math.max(0, landHours - 0.5) / 10.0) * 0.55;
  const landDamage = clamp(Math.max(terrainDamage, (storm.landed ? 0.18 : 0) + 0.72 * landTimeDamage), 0, 1);
  const coreContinuity = clamp(Number(storm.coreGeometryContinuity ?? (1 - landDamage * 0.62)), 0, 1);
  const shearKt = Math.max(0, Number(storm.shear ?? 0));
  const shearNorm = clamp((shearKt - 7) / 32, 0, 1);
  const dryIntrusion = clamp(Number(storm.dryAirIntrusion ?? 0), 0, 1);
  const dryExposure = clamp(Number(storm.dryAirCoreExposure ?? 0), 0, 1);
  const dryConnection = clamp(Number(storm.dryAirCoreConnection ?? 0), 0, 1);
  const dryWrap = clamp(Number(storm.dryAirWrapFraction ?? 0), 0, 1);
  const dryStrength = clamp(0.20 * dryIntrusion + 0.40 * dryExposure + 0.25 * dryConnection + 0.15 * dryWrap, 0, 1);
  const structureMode = String(storm.structureMode || "");
  const ewrcState = String(storm.ewrcState || "none");
  const ewrcProgress = clamp(Number(storm.ewrcProgress ?? 0), 0, 1);
  const secondaryEyewallStrength = clamp(Number(storm.secondaryEyewallStrength ?? 0), 0, 1);
  const ewrcStandoffStrength = clamp(Number(storm.ewrcStandoffStrength ?? 0), 0, 1);
  const giantEyeOuterWallMemory = clamp(Number(storm.giantEyeOuterWallMemory ?? 0), 0, 1);
  const eyewallColdPoolMemory = clamp(Number(storm.eyewallColdPoolMemory ?? 0), 0, 1);
  const postPeakEnvelopeMemory = clamp(Number(storm.postPeakEnvelopeMemory ?? 0), 0, 1);
  const circulationExpansion = clamp(Number(storm.circulationExpansion ?? 0), 0, 1);
  const outflowEfficiency = clamp(Number(storm.outflowEfficiency ?? 0.5), 0, 1);
  const eyeAsymmetry = clamp(Number(storm.eyeAsymmetry ?? 0), 0, 1);
  const landfallOuterRainbandIndex = clamp(Number(storm.landfallOuterRainbandIndex ?? 0), 0, 1);
  const brownOceanBurstIndex = clamp(Number(storm.brownOceanBurstIndex ?? 0), 0, 1);
  const ewrcActive = ewrcState === "forming" || ewrcState === "max_decay" || secondaryEyewallStrength > 0.16;
  const ewrcFailure = ewrcState === "penalty_failure" || !!storm.ewrcIsFailure || ewrcStandoffStrength > 0.20;
  const ewrcRecovery = ewrcState === "recovering_success" || ewrcState === "recovering_failure" || ewrcState === "completed";
  const structureDoubleEyewall = structureMode === "ewrc_double" || structureMode === "failed_ewrc_standoff";
  const structureOuterWall = structureMode === "giant_outer_eyewall" || structureMode === "post_ewrc_broad";
  const structureOuterRainbands = structureMode === "landfall_outer_rainbands" || structureMode === "rainband_dominant";

  // A Dvorak-derived 50+ m/s analysis cannot simultaneously present as a loose, TD-like cloud
  // mass unless an explicit destructive process is underway. Use Vmax/T-number as a structural
  // prior, then allow land, deep dry-air penetration, severe shear and persistent scars to erode it.
  // This keeps cloud morphology consistent with the simulator's own analyzed intensity while still
  // permitting real structural failure after landfall or environmental attack.
  const destructiveEnvironment = clamp(
    0.82 * landDamage + 0.38 * dryExposure + 0.22 * dryConnection + 0.20 * shearNorm + 0.18 * scar,
    0, 1
  );
  const dvorakFloorGate = clamp(1 - destructiveEnvironment, 0.08, 1);
  const deepCoverageFloor = (0.26 + 0.62 * dvorakOrganization) * dvorakFloorGate;
  const compactnessFloor = (0.18 + 0.59 * dvorakMajorCore + 0.10 * dvorakExtremeCore) * dvorakFloorGate;
  const eyewallWrapFloor = (0.10 + 0.66 * dvorakMajorCore) * dvorakFloorGate;
  const integrityFloor = (0.16 + 0.60 * dvorakMajorCore + 0.08 * dvorakExtremeCore) * dvorakFloorGate;
  const deepCoverage = Math.max(rawDeepCoverage, deepCoverageFloor);
  const coreCompactness = Math.max(rawCoreCompactness, compactnessFloor);
  const eyewallWrap = Math.max(rawEyewallWrap, eyewallWrapFloor);
  const integrity = Math.max(rawIntegrity, integrityFloor);
  const structuralDisorganization = clamp(
    Math.min(rawStructuralDisorganization, 0.92 - 0.54 * dvorakMajorCore * dvorakFloorGate) + 0.34 * landDamage,
    0, 1
  );

  // Lifecycle gates. Intensity alone is not enough: a rapidly strengthening cyclone must build and
  // homogenize its core before a clean eye becomes possible.
  const windOrganization = smoothstep((windKt - 28) / 62);
  let organization = clamp(
    0.22 * windOrganization + 0.18 * deepCoverage + 0.17 * coreCompactness + 0.17 * eyewallWrap +
    0.13 * integrity + 0.13 * eyeMemory - 0.24 * structuralDisorganization - 0.16 * llccExposure -
    0.13 * shearNorm - 0.11 * dryExposure - 0.18 * landDamage,
    0, 1
  );
  const dvorakOrganizationFloor = clamp((0.12 + 0.78 * dvorakOrganization) * dvorakFloorGate, 0, 0.94);
  organization = Math.max(organization, dvorakOrganizationFloor);
  const tdDisorganized = clamp(1 - smoothstep((organization - 0.16) / 0.24), 0, 1);
  const organizing = clamp(smoothstep((organization - 0.12) / 0.38) * (1 - smoothstep((organization - 0.70) / 0.20)), 0, 1);
  const coreBuilding = clamp(smoothstep((organization - 0.32) / 0.42) * smoothstep((windKt - 38) / 48), 0, 1);
  let homogenizedCore = clamp(
    smoothstep((deepCoverage - 0.48) / 0.38) * smoothstep((eyewallWrap - 0.38) / 0.45) *
    smoothstep((coreCompactness - 0.34) / 0.45) * (1 - 0.46 * structuralDisorganization), 0, 1
  );
  homogenizedCore = Math.max(homogenizedCore, dvorakMajorCore * dvorakFloorGate * 0.72);
  const matureCore = clamp(
    smoothstep((windKt - 62) / 42) * smoothstep((organization - 0.50) / 0.36) *
    smoothstep((integrity - 0.42) / 0.48) * (0.58 + 0.42 * homogenizedCore) +
    0.42 * dvorakMajorCore * dvorakFloorGate,
    0, 1
  );
  const eyeReady = clamp(
    matureCore * smoothstep((eyeMemory - 0.42) / 0.46) * smoothstep((eyewallWrap - 0.58) / 0.34) *
    smoothstep((eyeClearance - 0.30) / 0.62) * (1 - 0.74 * eyeObstruction) *
    (1 - 0.62 * shearNorm) * (1 - 0.68 * dryExposure) * (1 - 0.82 * landDamage), 0, 1
  );
  const annularMode = clamp(
    (params.annular ? 1 : 0) * smoothstep((matureCore - 0.66) / 0.30) *
    (1 - 0.72 * dryStrength) * (1 - 0.66 * shearNorm) * (1 - 0.88 * landDamage),
    0, 1
  );
  // A healthy, very intense cyclone has normally completed the convective-homogenization phase:
  // its inner-core overcast is a continuous cold shield with embedded texture, not a collection of
  // isolated MCS blobs. Keep this separate from matureCore so destructive environments can still
  // tear apart a strong cyclone after landfall / dry-air penetration / severe shear.
  const healthyIntensityPrior = clamp(
    0.46 * dvorakMajorCore + 0.64 * smoothstep((windKt - 96) / 34),
    0, 1
  );
  const healthyIntenseCore = clamp(
    healthyIntensityPrior *
    smoothstep((integrity - 0.56) / 0.34) * smoothstep((eyewallWrap - 0.58) / 0.34) *
    (1 - 0.92 * landDamage) * (1 - 0.72 * shearNorm) * (1 - 0.82 * dryExposure) *
    (1 - 0.52 * structuralDisorganization),
    0, 1
  );

  const lowNoise = fbm(x * 2.15 + timePhase * 0.20, y * 2.15 - timePhase * 0.14, seedInt + 11);
  const midNoise = fbm(x * 5.1 - timePhase * 0.31, y * 5.1 + timePhase * 0.23, seedInt + 37);
  const cellNoise = fbm(x * 10.2 + timePhase * 0.42, y * 10.2 - timePhase * 0.33, seedInt + 83);
  const towerNoise = fbm(x * 18.5 - timePhase * 0.53, y * 18.5 + timePhase * 0.44, seedInt + 127);
  const warp = (lowNoise - 0.5) * (0.38 + 0.48 * structuralDisorganization) + (midNoise - 0.5) * 0.16;
  const warpedTheta = theta + warp;
  const broadEnvelope = Math.exp(-Math.pow(Math.max(0, r - 0.02) / (0.76 + 0.18 * broadMoisture), 1.65));
  // A physically forced tracer evolves in time independently of the IR lookup table. Existing
  // structural diagnostics (dry air, orography, convection, shear) drive its advection and renewal.
  const dynamics = sampleConvectiveField(resolvedDynamics ?? getConvectiveField(storm, simulationHour, seed), x, y);
  const advectedMoisture = dynamics.moisture;
  const advectedConvection = dynamics.updraft;
  const postLandBandSupport = clamp(0.28 * landDamage + 0.40 * landfallOuterRainbandIndex +
    0.20 * brownOceanBurstIndex, 0, 0.78);
  // WNP has only a weak climatological southern preference, not a hard-wired northern/NE lobe.
  // For highly organized strong typhoons this modest bias disappears; shear and local moisture
  // still determine the actual instantaneous quadrant distribution.
  const westernNorthPacific = stormLat > 5 && stormLat < 36 && stormLon > 105 && stormLon < 165;
  const southernPrior = westernNorthPacific ? 0.16 * (1 - 0.90 * healthyIntenseCore) : 0;
  // The supplied Mangkhut sequence repeatedly shows a broad poleward/eastern cirrus shield around
  // a dense compact core. Learn that as a generic mature WNP-typhoon regime instead of keying on
  // a storm name so other large western-Pacific cyclones inherit the same structural tendency.
  const majorWnpTyphoon = westernNorthPacific
    ? clamp(0.42 * matureCore + 0.34 * healthyIntenseCore + 0.22 * outflowEfficiency +
      0.18 * broadMoisture + 0.14 * circulationExpansion, 0, 1)
    : 0;
  const bandQuadrantFactor = clamp(1 + southernPrior * -Math.sin(theta) +
    (advectedMoisture - 0.50) * (0.26 + 0.26 * landDamage) +
    shearNorm * 0.12 * Math.cos(theta - (Number(storm.shearDir ?? 270) - 90) * Math.PI / 180), 0.60, 1.35);


  // Early convection and inner spiral bursts are advected moisture/updraft diagnostics.
  // No fixed collection of Gaussian cells or scripted burst arcs survives into later frames.
  const weakCellWeight = clamp(0.54 * tdDisorganized + 0.34 * organizing + 0.18 * burst +
    0.12 * structuralDisorganization, 0.06, 0.90);
  const weakCloudRadius = Math.exp(-Math.pow((r - 0.34) / (0.40 + 0.14 * broadMoisture), 2));
  const convectiveCells = smoothstep((advectedConvection - 0.12) / 0.38) *
    smoothstep((0.65 * cellNoise + 0.35 * towerNoise - 0.30) / 0.48);
  const scatteredConvection = weakCellWeight * weakCloudRadius *
    convectiveCells * (0.26 + 0.52 * advectedMoisture) *
    (0.68 + 0.49 * cellNoise) * (1 - 0.25 * landDamage);
  const rotatingBurstRadius = Math.exp(-Math.pow((r - (0.20 + 0.07 * (1 - matureCore))) / 0.18, 2));
  const rotatingBursts = rotatingBurstRadius * smoothstep((advectedConvection - 0.13) / 0.37) *
    (0.15 + 0.29 * organizing + 0.24 * coreBuilding + 0.38 * burst + 0.19 * tdDisorganized) *
    (0.52 + 0.48 * advectedMoisture) * (0.52 + 0.48 * cellNoise);
  // Before a true eye appears, rapidly intensifying storms often build one messy inner canopy of
  // wrapped bursts rather than jumping straight from scattered cells to a perfect circular CDO.
  const formativeShield = Math.exp(-Math.pow((r - (0.18 + 0.04 * (1 - coreBuilding))) /
    (0.11 + 0.03 * (1 - organizing)), 2)) *
    smoothstep((advectedConvection - 0.18) / 0.34) *
    (0.04 + 0.12 * organizing + 0.10 * burst + 0.06 * dvorakCdoPattern) *
    (1 - 0.78 * matureCore) * (0.38 + 0.62 * advectedMoisture);

  // 3) Large rainbands. Real tropical-cyclone bands are broad cloud/convection corridors with
  // embedded hot towers and stratiform/anvil cloud, not thin mathematical lines. Build a small
  // number of finite logarithmic arcs, then add irregular branch packets and convective maxima.
  let rainbands = 0;
  let rainbandConvectiveSignal = 0;
  const bandCoherence = clamp(0.37 + 0.46 * smoothstep((organization - 0.12) / 0.50) +
    0.20 * rainbandDominance + 0.33 * postLandBandSupport, 0.30, 1.25);
  // Several differently curved feeding corridors coexist with the principal spiral. Their
  // current convective segments are selected by the transported moisture/updraft field.
  const bandCount = organization > 0.62 ? 7 : organization > 0.30 ? 6 : 5;
  for (let i = 0; i < bandCount; i++) {
    const startR = 0.11 + 0.079 * i + (frame?.bands[i]?.start ?? unitHash(`${identity}|rb-start|${i}`)) * 0.065;
    const endR = Math.min(1.07, startR + 0.62 + (frame?.bands[i]?.length ?? unitHash(`${identity}|rb-length|${i}`)) * 0.29);
    const radialWindow = smoothstep((r - startR) / 0.055) * (1 - smoothstep((r - endR) / 0.080));
    const phase = (i / bandCount) * Math.PI * 2 +
      ((frame?.bands[i]?.phase ?? unitHash(`${identity}|rb-phase|${i}`)) - 0.5) * (1.55 - 0.95 * healthyIntenseCore) +
      simulationHour * (0.022 + 0.005 * i) * hemisphereSign +
      (advectedMoisture - 0.50) * 0.45;
    const pitch = 2.35 + 1.05 * (frame?.bands[i]?.pitch ?? unitHash(`${identity}|rb-pitch|${i}`)) + 0.38 * matureCore;
    const logarithmicTurn = pitch * Math.log((r + 0.16) / (startR + 0.16));
    const target = phase - logarithmicTurn + (lowNoise - 0.5) * 1.25 + (midNoise - 0.5) * 0.48 +
      (advectedConvection - 0.45) * 0.62 + 0.11 * Math.sin(simulationHour * 0.036 + r * 9 + i);
    const delta = Math.atan2(Math.sin(warpedTheta - target), Math.cos(warpedTheta - target));
    const width = 0.25 + 0.13 * (frame?.bands[i]?.width ?? unitHash(`${identity}|rb-width|${i}`)) + 0.065 * (1 - organization) + 0.055 * landDamage;
    const ridge = Math.exp(-Math.pow(delta / width, 2));
    const shoulder = Math.exp(-Math.pow(delta / (width * 1.58), 2));
    const segmentNoise = clamp(0.38 * fbm(x * (2.25 + i * 0.19) + timePhase*.24 + i * 7.2,
      y * (2.25 + i * 0.17) - timePhase*.22 - i * 4.9, seedInt + 233 + i * 43) +
      0.62 * advectedConvection, 0, 1);
    const stratiformSegment = clamp(0.10 + 0.90 * smoothstep((segmentNoise - 0.33) / 0.38) +
      0.10 * Math.cos(theta * (1 + (i % 2)) + i), 0.05, 1.20);
    const convectiveSegment = clamp(
      (i < 2 ? 0.18 * healthyIntenseCore : 0) +
      smoothstep((segmentNoise - 0.43) / 0.36) *
      (0.42 + 0.58 * smoothstep((0.56 * cellNoise + 0.44 * towerNoise - 0.34) / 0.48)),
      0, 1.20
    );
    const hierarchy = i === 0 ? 1.00 : i === 1 ? 0.98 : i === 2 ? 0.91 : i === 3 ? 0.84 : i === 4 ? 0.76 : 0.69;
    const amplitude = (0.34 + 0.21 * (frame?.bands[i]?.power ?? unitHash(`${identity}|rb-power|${i}`))) * hierarchy * bandQuadrantFactor *
      (0.85 + 0.52 * advectedMoisture + 0.72 * advectedConvection + postLandBandSupport) *
      (1 + healthyIntenseCore * (i === 0 ? 0.20 : i === 1 ? 0.10 : 0.04));
    const stratiform = radialWindow * shoulder * stratiformSegment * amplitude * 0.46;
    const convective = radialWindow * ridge * convectiveSegment * amplitude * 1.22;
    rainbands += stratiform + convective;
    rainbandConvectiveSignal += (convective + stratiform * 0.22 * healthyIntenseCore) * (0.72 + 0.28 * towerNoise);
  }
  const primaryBandField = rainbands;
  // Feeders form where the advected tracer intersects an established spiral convergence
  // corridor. The updraft-gradient diagnoses growing/decaying cells; no seeded packet coordinates.
  const resolvedField = resolvedDynamics ?? getConvectiveField(storm, simulationHour, seed);
  const neighboringUpdraft = sampleConvectiveField(resolvedField, x + 0.038, y - 0.026).updraft;
  const updraftContrast = Math.abs(advectedConvection - neighboringUpdraft);
  const feederCorridor = smoothstep((primaryBandField - 0.012) / 0.125);
  const feederPackets = feederCorridor * smoothstep((advectedConvection - 0.27) / 0.48) *
    (0.06 + 0.27 * updraftContrast + 0.12 * burst) * (0.60 + 0.40 * advectedMoisture) *
    (1 + 0.45 * postLandBandSupport);
  const feederConvectiveSignal = feederPackets * (0.45 + 0.55 * advectedConvection);
  rainbands = (rainbands + feederPackets * (0.48 + 0.62 * rainbandDominance)) *
    bandCoherence * clamp(0.64 + 0.52 * coreBuilding + 0.48 * matureCore + 0.28 * dvorakCurvedBand +
      0.55 * postLandBandSupport + 0.12 * tdDisorganized, 0.50, 1.85);
  rainbandConvectiveSignal = clamp((rainbandConvectiveSignal + 1.55 * feederConvectiveSignal) *
    bandCoherence * (1.10 + 0.47 * matureCore + 0.78 * postLandBandSupport), 0, 1);
  // Broad cloud/anvil shoulders around the convective rainbands make the bands look like real
  // mesoscale precipitation corridors rather than colored strings. The shoulders stay optically
  // thinner and therefore warmer in IR, while the ridge itself carries the cold towers.
  const bandCanopyNoise = fbm(x * 3.25 - timePhase * 0.10, y * 3.25 + timePhase * 0.07, seedInt + 619);
  const bandCanopy = smoothstep((rainbands - 0.012) / 0.14) *
    (0.052 + 0.085 * bandCoherence) * clamp(0.44 + 0.58 * bandCanopyNoise, 0.10, 1.16);
  rainbands += bandCanopy;

  // Broad post-peak / expanded-circulation bands are structurally different from the compact
  // primary rainbands above. They become prominent after a large cyclone has peaked, during some
  // EWRC episodes, and near landfall when the inner core weakens faster than the outer envelope.
  const outerEnvelopeMemory = clamp(
    0.48 * postPeakEnvelopeMemory + 0.34 * circulationExpansion + 0.30 * landfallOuterRainbandIndex +
    0.18 * (ewrcActive ? secondaryEyewallStrength : 0) + (structureOuterRainbands ? 0.20 : 0) +
    (structureOuterWall ? 0.14 : 0), 0, 1
  );
  const outerBandRadius = 0.63 + 0.12 * circulationExpansion + 0.06 * postPeakEnvelopeMemory;
  const outerBandWindow = Math.exp(-Math.pow((r - outerBandRadius) / (0.14 + 0.060 * outerEnvelopeMemory), 2));
  const outerConvection = smoothstep((advectedConvection - 0.28) / 0.42);
  const broadOuterBand = outerBandWindow * outerEnvelopeMemory *
    outerConvection * (0.10 + 0.25 * advectedMoisture) *
    (0.44 + 0.56 * smoothstep((primaryBandField - 0.015) / 0.12));
  rainbands += broadOuterBand * (1 + 1.1 * postLandBandSupport);
  rainbandConvectiveSignal = clamp(rainbandConvectiveSignal + broadOuterBand *
    (0.35 + 0.65 * advectedConvection) * (1 + postLandBandSupport), 0, 1);
  // Annular hurricanes preferentially concentrate convection in the inner ring and suppress much
  // of the ordinary outer-band field, while post-peak broad storms do the opposite.
  rainbands *= 1 - 0.22 * annularMode;
  rainbands *= 1 + 0.14 * weakBandRegime;

  // 4) CDO/core assembly. During early organization it is lumpy and burst-dominated. As convection
  // homogenizes the shield becomes more continuous, while embedded towers keep the mature CDO from
  // becoming a featureless smooth disk.
  const cdoOffsetKm = (18 + 62 * shearNorm + 34 * llccExposure + 85 * landDamage) *
    (1 - 0.62 * matureCore * (1 - landDamage));
  const shearBearingRad = ((Number(storm.shearDir ?? 270) - 90) * Math.PI / 180);
  const damageBearingRad = (Number(storm.terrainInteractionBearingDeg ?? 225) - 90) * Math.PI / 180;
  const displacementAngle = shearBearingRad * (1 - landDamage) + (damageBearingRad + Math.PI) * landDamage;
  const cdoX = x - Math.cos(displacementAngle) * cdoOffsetKm / cloudRadiusKm;
  const cdoY = y - Math.sin(displacementAngle) * cdoOffsetKm / cloudRadiusKm;
  // Mature CDOs are seldom circular. Give the dense overcast a persistent mesoscale ellipse and
  // quadrant-scale wobble, with its major axis partly tied to shear but not mechanically aligned.
  const cdoAxisAngle = shearBearingRad * 0.62 + ((frame?.cdoAxis ?? unitHash(`${identity}|cdo-axis`)) - 0.5) * 1.45;
  const cdoCa = Math.cos(cdoAxisAngle), cdoSa = Math.sin(cdoAxisAngle);
  const cdoRx = cdoX * cdoCa + cdoY * cdoSa;
  const cdoRy = -cdoX * cdoSa + cdoY * cdoCa;
  const rawCdoAxisRatio = 0.87 + 0.08 * matureCore + 0.065 * (frame?.cdoAxisRatio ?? unitHash(`${identity}|cdo-axis-ratio`));
  const healthyCdoAxisRatio = 0.89 + 0.075 * ((frame?.cdoHealthyAxis ?? unitHash(`${identity}|cdo-healthy-axis`)) - 0.5);
  const cdoAxisRatio = rawCdoAxisRatio * (1 - 0.48 * healthyIntenseCore) + healthyCdoAxisRatio * 0.48 * healthyIntenseCore;
  const cdoR = Math.hypot(cdoRx * cdoAxisRatio, cdoRy / Math.max(0.72, cdoAxisRatio));
  const cdoRadius = 0.122 + 0.065 * coreBuilding + 0.056 * matureCore + 0.020 * broadMoisture +
    0.018 * dvorakCdoPattern + 0.010 * healthyIntenseCore;
  const rawCdoRadiusFactor = clamp(
    0.78 + 0.32 * lowNoise + 0.090 * Math.cos(theta * 2 - 0.8) + 0.070 * Math.cos(theta * 3 + 1.7) +
    0.045 * Math.cos(theta * 5 + 1.1) + 0.040 * (midNoise - 0.5),
    0.64, 1.34
  );
  // Homogenization removes the large holes/indentations while preserving a soft, irregular edge.
  const cdoRadiusFactor = 1 + (rawCdoRadiusFactor - 1) * (1 - 0.64 * Math.max(healthyIntenseCore, homogenizedCore));
  const cdoRadiusLocal = cdoRadius * cdoRadiusFactor;
  const cdoEnvelope = Math.exp(-Math.pow(cdoR / Math.max(0.12, cdoRadiusLocal), 1.90 + 0.55 * homogenizedCore));
  const rawCdoTexture = (1 - homogenizedCore) * (0.34 + 0.86 * midNoise) +
    homogenizedCore * (0.56 + 0.28 * lowNoise + 0.28 * cellNoise + 0.14 * towerNoise);
  const healthyCdoTexture = clamp(0.94 + 0.05 * (lowNoise - 0.5) + 0.04 * (midNoise - 0.5), 0.86, 1.04);
  const cdoTexture = rawCdoTexture * (1 - 0.82 * healthyIntenseCore) + healthyCdoTexture * 0.82 * healthyIntenseCore;
  // Mature convection homogenizes into one continuous overcast. The advected tracer creates
  // embedded hot towers WITHOUT placing a fixed set of satellite-image patches or warm holes.
  const cdoTowerField = clamp(cdoEnvelope * advectedConvection *
    (0.30 + 0.28 * burst + 0.17 * matureCore), 0, 1);
  let cdo = cdoEnvelope * (0.18 + 0.36 * coreBuilding + 0.40 * matureCore + 0.15 * deepCoverage +
    0.11 * dvorakCdoPattern + 0.20 * healthyIntenseCore) * cdoTexture;
  // Land removes the central continuous shield, leaving the advected core convection in bands.
  cdo *= clamp((1 - 0.85 * landDamage) * (0.20 + 0.80 * coreContinuity) *
    (1 - landDamage * 0.40 * (1 - advectedConvection)), 0.08, 1);
  // Continuous dense-overcast floor for healthy T6/T7-class systems. Local towers still vary in
  // brightness temperature, but the *cloud shield itself* remains physically connected.
  cdo += cdoEnvelope * healthyIntenseCore * (0.28 + 0.12 * homogenizedCore) *
    clamp(0.94 + 0.07 * (lowNoise - 0.5), 0.88, 1.02) *
    (1 - landDamage * 0.91) * (0.22 + 0.78 * coreContinuity);
  // Fill the physical transition from eyewall to CDO with a mottled dense overcast skirt. This is
  // what prevents the synthetic "black donut + empty moat + grey outer ring" appearance.
  const cdoSkirt = Math.exp(-Math.pow((cdoR - (0.145 + 0.030 * matureCore)) / (0.105 + 0.035 * broadMoisture), 2)) *
    (0.07 + 0.16 * coreBuilding + 0.19 * matureCore + 0.09 * dvorakCdoPattern) *
    clamp(0.52 + 0.48 * lowNoise + 0.20 * midNoise, 0.16, 1.20);
  cdo += cdoSkirt * (1 - 0.82 * landDamage) * (0.24 + 0.76 * coreContinuity);
  // Mesoscale texture is tied to the advected tracer, not a fixed side-lobe overlay.
  const mesoscaleLobe = cdoEnvelope * smoothstep((advectedConvection - 0.31) / 0.47) *
    (0.045 + 0.090 * coreBuilding) * (1 - 0.85 * healthyIntenseCore) *
    (1 - 0.70 * landDamage);
  cdo += mesoscaleLobe;
  const rawCdoQuadrantModulation = clamp(
    0.76 + 0.18 * Math.cos(theta - cdoAxisAngle - 0.4) + 0.12 * Math.cos(theta * 2 + 1.1) +
    0.14 * (lowNoise - 0.5),
    0.48, 1.18
  );
  const cdoQuadrantModulation = rawCdoQuadrantModulation * (1 - 0.78 * healthyIntenseCore) +
    (0.96 + 0.04 * (lowNoise - 0.5)) * 0.78 * healthyIntenseCore;
  cdo *= cdoQuadrantModulation;
  cdo *= 1 + 0.14 * annularMode;
  cdo *= 1 - 0.70 * weakBandRegime;
  // Only a coherent, strong inner core receives the continuous dense-cloud dominance. Damage
  // still exposes gaps on one side; this is not a blanket circular overlay or a weaker rainband.
  cdo += cdoEnvelope * (0.12 * dvorakMajorCore + 0.12 * healthyIntenseCore) *
    (1 - 0.85 * destructiveEnvironment) * (0.30 + 0.70 * coreContinuity) *
    clamp(0.90 + 0.12 * lowNoise, 0.86, 1.05);

  // Embedded cold towers and hot towers in the eyewall/CDO. They drive IR temperature detail
  // separately from optical cloud opacity, matching the textured reference imagery.
  const towerRing = Math.exp(-Math.pow((r - (0.12 + 0.055 * matureCore)) / (0.075 + 0.025 * (1 - matureCore)), 2));
  const towerSignal = clamp(
    (0.12 + 0.44 * burst + 0.38 * coreBuilding + 0.34 * matureCore) * towerRing *
      (0.42 + 0.58 * smoothstep((towerNoise - 0.30) / 0.58)) +
    0.30 * rotatingBursts + 0.20 * rainbands * smoothstep((cellNoise - 0.40) / 0.52),
    0, 1
  );

  // Embedded cold-cloud anomalies are continuous advected updraft energy, not four fixed
  // arcs with a hard -93 C cutoff (the source of the magenta "sticker" artifacts).
  const innerCdoColdArcSignal = clamp(cdoEnvelope * healthyIntenseCore *
    Math.pow(advectedConvection, 1.35) * (0.22 + 0.22 * burst), 0, 0.40);

  // 5) Eyewall and eye. Eye clearing is a late lifecycle event after the core has wrapped and
  // convection has homogenized; high wind speed alone cannot punch an artificial hole into a TD.
  const stateEyeKm = Math.max(0, Number(storm.eyeRadiusKm ?? 0));
  const fallbackEyeKm = 7 + 18 * matureCore + 7 * (1 - coreCompactness);
  const expandedEyeBase = clamp(0.42 * giantEyeOuterWallMemory + (ewrcRecovery ? 0.24 : 0) +
    0.22 * circulationExpansion + 0.18 * postPeakEnvelopeMemory, 0, 1);
  const eyeRadiusNorm = clamp((stateEyeKm > 2 ? stateEyeKm : fallbackEyeKm) / cloudRadiusKm, 0.010, 0.082);
  const eyeWobble = eyeAsymmetry * (0.06 * Math.cos(theta - timePhase * 0.42) + 0.035 * Math.cos(theta * 2 + 1.2));
  const eyeEdgeWarp = 1 + (lowNoise - 0.5) * 0.18 + 0.06 * Math.sin(theta * 3 + timePhase * 0.8) + eyeWobble;
  const stabilizedEyeWarp = 1 + (eyeEdgeWarp - 1) * (1 - 0.42 * expandedEyeBase);
  const localEyeRadius = eyeRadiusNorm * stabilizedEyeWarp * (1 + 0.18 * expandedEyeBase);
  const eyewallCenter = localEyeRadius + 0.026 + 0.028 * (1 - coreCompactness) + 0.010 * expandedEyeBase;
  const eyewallWidth = 0.020 + 0.018 * (1 - matureCore) + 0.012 * structuralDisorganization + 0.009 * expandedEyeBase;
  const eyewallRadialWarp = 1 + 0.060 * Math.cos(theta * 2 + 0.8) + 0.035 * Math.cos(theta * 5 - 1.6) +
    (lowNoise - 0.5) * 0.055 + eyeAsymmetry * 0.055 * Math.cos(theta - timePhase * 0.35);
  const stabilizedEyewallWarp = 1 + (eyewallRadialWarp - 1) * (1 - 0.44 * expandedEyeBase);
  const localEyewallCenter = eyewallCenter * stabilizedEyewallWarp;
  const eyewallRing = Math.exp(-Math.pow((r - localEyewallCenter) / Math.max(0.014, eyewallWidth), 2));
  const eyewallTowerPattern = clamp(
    0.30 + 0.58 * smoothstep((0.52 * cellNoise + 0.48 * towerNoise - 0.34) / 0.50) +
    0.12 * Math.cos(theta * 3 + timePhase * 0.65) + 0.08 * Math.cos(theta * 7 - 1.1),
    0.08, 1.30
  );
  const eyewallTexture = clamp(0.48 + 0.72 * eyewallTowerPattern + 0.12 * midNoise, 0.15, 1.42);
  let eyewall = eyewallRing * (0.20 + 0.94 * coreBuilding + 0.86 * matureCore + 0.10 * dvorakEyePattern) * eyewallTexture;
  // Friction and terrain rapidly destroy azimuthal continuity after landfall. The wind analysis may
  // remain high for a short time, but the satellite signature should already show a torn/deformed
  // eyewall rather than a pristine oceanic ring.
  eyewall *= clamp(1 - 0.76 * landDamage, 0.12, 1);

  // Explicit concentric-eyewall / EWRC morphology. A secondary ring grows outside the primary,
  // separated by a lower-cloud moat. During max-decay the inner ring weakens; successful recovery
  // leaves a broader new eyewall, while failed/stalled replacements retain a ragged outer ring and
  // sometimes a large-eye/outer-wall memory instead of snapping back to a single perfect circle.
  const successfulTakeover = ewrcState === "recovering_success" && !ewrcFailure &&
    windKt >= 90 && dryExposure < 0.36 && landDamage < 0.24 && shearNorm < 0.46;
  const secondaryStrength = clamp(Math.max(
    secondaryEyewallStrength,
    ewrcActive ? 0.22 + 0.62 * ewrcProgress : 0,
    ewrcStandoffStrength * 0.78,
    giantEyeOuterWallMemory * 0.72,
    structureDoubleEyewall ? 0.58 : 0,
    structureOuterWall ? 0.66 : 0
  ), 0, 1);
  const outerEyewallCenter = eyewallCenter + 0.026 + 0.021 * secondaryStrength + 0.020 * giantEyeOuterWallMemory;
  const outerEyewallWidth = 0.015 + 0.012 * (1 - secondaryStrength) + 0.014 * ewrcStandoffStrength;
  const outerEyewallCenterLocal = outerEyewallCenter * (1 + 0.055 * Math.cos(theta * 2 - 0.4) +
    0.030 * Math.cos(theta * 5 + 1.9) + (lowNoise - 0.5) * 0.045);
  const outerEyewallRing = Math.exp(-Math.pow((r - outerEyewallCenterLocal) / Math.max(0.016, outerEyewallWidth), 2));
  const outerFracture = clamp(0.42 + 0.66 * midNoise + 0.30 * towerNoise + 0.10 * Math.cos(theta * 4 + 0.6) -
    0.28 * ewrcStandoffStrength, 0.04, 1.32);
  let outerEyewall = outerEyewallRing * secondaryStrength * (0.22 + 0.42 * outerFracture) *
    clamp(1 - 0.68 * landDamage, 0.12, 1);
  if (ewrcFailure) outerEyewall *= 0.68 + 0.42 * smoothstep((cellNoise - 0.28) / 0.55);
  if (ewrcState === "max_decay") eyewall *= 1 - 0.62 * secondaryStrength;
  if (giantEyeOuterWallMemory > 0.12) eyewall *= 1 - 0.58 * giantEyeOuterWallMemory;
  if (successfulTakeover) {
    // The former outer wall is the new single primary wall. Do not draw a second dark annulus
    // around the newly enlarged eye just because secondaryEyewallStrength decays slowly.
    outerEyewall *= 0.08 + 0.12 * (1 - ewrcProgress);
  } else if (ewrcRecovery && !ewrcFailure) outerEyewall *= 0.72 + 0.28 * matureCore;

  const moatCenter = (eyewallCenter + outerEyewallCenter) * 0.5;
  const moatWidth = Math.max(0.009, (outerEyewallCenter - eyewallCenter) * 0.25);
  const moatSignal = Math.exp(-Math.pow((r - moatCenter) / moatWidth, 2)) * secondaryStrength *
    (0.35 + 0.45 * ewrcProgress + 0.25 * giantEyeOuterWallMemory) *
    (successfulTakeover ? 0.10 : 1);

  // Dry-air-induced cold pools can shift convergence away from the primary eyewall into a broken
  // inner rainband. This produces a physically distinct arc rather than merely cutting a wedge out
  // of the cloud field.
  const coldPoolBearing = Number(storm.dryAirConvectiveArcBearingDeg ?? ((Number(storm.drySlotBearingDeg ?? 270) + 165) % 360));
  const coldPoolRad = (coldPoolBearing - 90) * Math.PI / 180;
  const coldPoolDelta = Math.atan2(Math.sin(theta - coldPoolRad), Math.cos(theta - coldPoolRad));
  const coldPoolArc = Math.exp(-Math.pow(coldPoolDelta / (0.48 + 0.28 * (1 - eyewallColdPoolMemory)), 2)) *
    Math.exp(-Math.pow((r - (0.22 + 0.09 * dryExposure)) / (0.065 + 0.045 * eyewallColdPoolMemory), 2)) *
    eyewallColdPoolMemory * (0.10 + 0.28 * deepCoverage);

  const bearingDeg = ((Math.atan2(geoDxKm, geoDyKm) * 180 / Math.PI) + 360) % 360;
  const angleDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  const sectorWeight = (bearing: number, center: number, halfWidth: number) => {
    const d = angleDiff(bearing, center);
    return d >= halfWidth ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / halfWidth);
  };

  const openFraction = clamp(Number(storm.eyewallOpenSectorFraction ?? (1 - integrity) * 0.35), 0, 1);
  const dryBearing = Number.isFinite(Number(storm.drySlotBearingDeg))
    ? Number(storm.drySlotBearingDeg)
    : ((Number(storm.shearDir ?? 270) + 180) % 360);
  if (openFraction > 0.02) {
    const opening = sectorWeight(bearingDeg, dryBearing, 22 + openFraction * 92);
    eyewall *= 1 - opening * clamp(0.16 + openFraction * 0.78 + scar * 0.18, 0, 0.92);
  }

  // Calibrated against the supplied 2026 No.13 "White Dolphin" GK-2A IR sequence:
  // mature phases should show a coherent moist-side shield, dry-air intrusion should carve a
  // hooked notch and expose a low-level swirl, and post-landfall decay should evolve into a
  // broad asymmetric shield with a trailing comma/deformation tail instead of a simply faded disk.
  const moistShieldBearing = (dryBearing + 180) % 360;
  const moistShieldSector = sectorWeight(bearingDeg, moistShieldBearing,
    86 + 46 * clamp(dryExposure + 0.30 * llccExposure + 0.22 * landDamage, 0, 1));
  const dryNotchSector = sectorWeight(bearingDeg, dryBearing,
    46 + 58 * clamp(dryWrap + 0.38 * dryExposure, 0, 1));
  const drySlotHookRadius = 0.26 + 0.10 * dryExposure + 0.08 * llccExposure;
  const drySlotHook = dryNotchSector *
    Math.exp(-Math.pow((r - drySlotHookRadius) / (0.075 + 0.040 * dryExposure + 0.020 * landDamage), 2)) *
    smoothstep((advectedConvection - 0.22) / 0.44) *
    smoothstep((dryStrength + eyewallColdPoolMemory * 0.4 - 0.08) / 0.45) *
    (0.05 + 0.18 * dryStrength + 0.13 * eyewallColdPoolMemory) *
    (0.40 + 0.60 * advectedMoisture);
  const moistShieldEnvelope = moistShieldSector *
    Math.exp(-Math.pow((r - (0.33 + 0.09 * dryWrap + 0.05 * landDamage)) / (0.23 + 0.08 * dryWrap + 0.06 * landDamage), 2)) *
    smoothstep((dryStrength + dryExposure + 0.25 * landDamage - 0.10) / 0.54) *
    (0.025 + 0.090 * clamp(dryStrength + 0.35 * deepCoverage + 0.20 * postLandBandSupport, 0, 1.3)) *
    clamp(0.42 + 0.46 * lowNoise + 0.20 * midNoise, 0.10, 1.20);
  const exposurePitch = 2.20 + 0.95 * clamp(llccExposure + 0.45 * dryExposure, 0, 1);
  const exposureTarget = ((dryBearing - 90) * Math.PI / 180) - exposurePitch * Math.log(r + 0.18) +
    (midNoise - 0.5) * 0.42;
  const exposureDelta = Math.atan2(Math.sin(warpedTheta - exposureTarget), Math.cos(warpedTheta - exposureTarget));
  const exposedSpiral = Math.exp(-Math.pow(exposureDelta / (0.34 + 0.10 * llccExposure), 2)) *
    Math.exp(-Math.pow((r - (0.16 + 0.05 * llccExposure + 0.05 * landDamage)) / (0.070 + 0.030 * (1 - coreContinuity) + 0.030 * landDamage), 2)) *
    smoothstep((llccExposure + dryExposure + 0.40 * landDamage - 0.10) / 0.50) *
    clamp(0.05 + 0.18 * llccExposure + 0.12 * dryExposure + 0.10 * landDamage, 0, 0.42) *
    (0.35 + 0.65 * advectedMoisture);
  // A storm heading is NOT a cloud-band azimuth. The previous round's motionBearing rotated
  // an artificial shield with the joystick. Diagnose the moist sector from terrain-induced
  // friction, deep-layer shear and *advected moisture*, independent of translation heading.
  const terrainConvergenceBearing = (Number(storm.terrainInteractionBearingDeg ?? 225) + 180) % 360;
  const downshearRightBearing = (Number(storm.shearDir ?? 270) + 45 * hemisphereSign + 360) % 360;
  const terrainDirectionWeight = clamp(landDamage * (0.55 + 0.45 * landfallOuterRainbandIndex), 0, 1);
  const synopticRad = (downshearRightBearing - 90) * Math.PI / 180;
  const terrainRad = (terrainConvergenceBearing - 90) * Math.PI / 180;
  const shieldX = (1 - terrainDirectionWeight) * Math.cos(synopticRad) + terrainDirectionWeight * Math.cos(terrainRad);
  const shieldY = (1 - terrainDirectionWeight) * Math.sin(synopticRad) + terrainDirectionWeight * Math.sin(terrainRad);
  const landfallShieldBearing = ((Math.atan2(shieldY, shieldX) * 180 / Math.PI + 90) + 360) % 360;
  const landfallShield = sectorWeight(bearingDeg, landfallShieldBearing,
    92 + 42 * clamp(landDamage + 0.40 * postLandBandSupport, 0, 1)) *
    Math.exp(-Math.pow((r - (0.42 + 0.10 * landDamage + 0.05 * circulationExpansion)) / (0.22 + 0.09 * landDamage + 0.05 * postLandBandSupport), 2)) *
    smoothstep((landDamage + postLandBandSupport + brownOceanBurstIndex * .3 - 0.04) / 0.40) *
    (0.03 + 0.10 * landDamage + 0.09 * postLandBandSupport + 0.05 * brownOceanBurstIndex) *
    clamp(0.35 + 0.56 * advectedMoisture + 0.26 * advectedConvection + 0.18 * lowNoise, 0.08, 1.18);
  const deformationTailBearing = (landfallShieldBearing + 35 * hemisphereSign + 360) % 360;
  const deformationTail = sectorWeight(bearingDeg, deformationTailBearing,
    62 + 34 * clamp(landDamage + 0.40 * outerEnvelopeMemory, 0, 1)) *
    Math.exp(-Math.pow((r - (0.72 + 0.10 * landDamage + 0.10 * outerEnvelopeMemory)) / (0.15 + 0.06 * landDamage + 0.04 * outerEnvelopeMemory), 2)) *
    smoothstep((landDamage + postLandBandSupport * .8 - 0.08) / 0.48) *
    (0.015 + 0.075 * landDamage + 0.040 * postLandBandSupport) *
    clamp(0.30 + 0.42 * lowNoise + 0.32 * advectedMoisture + 0.18 * advectedConvection, 0.08, 1.14);

  let density = scatteredConvection + rotatingBursts + formativeShield + rainbands + cdo + eyewall + outerEyewall +
    coldPoolArc + drySlotHook + moistShieldEnvelope + landfallShield + deformationTail + exposedSpiral * 0.72;
  density *= 1 - clamp(moatSignal, 0, 0.27);
  const cirrusTexture = smoothstep((0.72 * lowNoise + 0.28 * midNoise - 0.30) / 0.48);
  // Do not let a healthy intense storm sit inside one featureless circular grey disk. Mature
  // outflow is broad, but it is filamented/asymmetric and much thinner than the CDO/rainbands.
  const matureCirrusBreakup = clamp(0.52 + 0.54 * lowNoise + 0.18 * midNoise, 0.10, 1.16);
  density += broadEnvelope * (0.008 + 0.052 * broadMoisture + 0.018 * deepCoverage) * cirrusTexture *
    (1 - 0.42 * healthyIntenseCore) * matureCirrusBreakup;
  // A real mature CDO often has a broad anvil/moisture lobe on one side and cleaner air on the
  // opposite side. This asymmetry prevents the cloud shield from becoming a perfect round target.
  const anvilBearing = Number(storm.shearDir ?? 270);
  const anvilLobe = sectorWeight(bearingDeg, anvilBearing, 112) * Math.exp(-Math.pow((r - 0.34) / 0.34, 2));
  density += anvilLobe * (0.025 + 0.075 * deepCoverage + 0.055 * matureCore) * (0.55 + 0.45 * lowNoise);
  // Upper-level outflow adds thin, asymmetric cirrus filaments beyond the CDO. This is intentionally
  // optically thin and therefore does not create a second cold core in IR imagery.
  const outflowBearing = (Number(storm.shearDir ?? 270) + 70 * hemisphereSign) % 360;
  const outflowLobe = sectorWeight(bearingDeg, outflowBearing, 82 + 28 * outflowEfficiency) *
    Math.exp(-Math.pow((r - (0.53 + 0.10 * outflowEfficiency)) / (0.24 + 0.08 * outflowEfficiency), 2));
  density += outflowLobe * outflowEfficiency * (0.018 + 0.035 * lowNoise) * clamp(1 - 0.62 * landDamage, 0.20, 1);
  // Mangkhut and similar mature WNP major typhoons keep a broad poleward/eastern cirrus canopy
  // attached to the storm core. Keep it thin and warm enough to stay visually distinct from the CDO.
  const polewardOutflowBearing = westernNorthPacific
    ? (Number(storm.shearDir ?? 270) + 28 * hemisphereSign + 360) % 360
    : (Number(storm.shearDir ?? 270) + 48 * hemisphereSign + 360) % 360;
  const polewardOutflowShield = sectorWeight(bearingDeg, polewardOutflowBearing, 104 + 36 * majorWnpTyphoon) *
    Math.exp(-Math.pow((r - (0.60 + 0.11 * circulationExpansion + 0.07 * outflowEfficiency)) /
      (0.24 + 0.10 * outflowEfficiency + 0.08 * majorWnpTyphoon), 2)) *
    majorWnpTyphoon * (0.020 + 0.040 * advectedMoisture + 0.030 * outflowEfficiency) *
    clamp(0.34 + 0.46 * lowNoise + 0.30 * advectedMoisture, 0.08, 1.18) *
    clamp(1 - 0.54 * landDamage, 0.16, 1);
  density += polewardOutflowShield;
  // Mature CDOs contain a broad field of overlapping anvils and convective debris. Add a weak,
  // irregular connective shield so deep cells visually belong to one cyclone instead of looking
  // like isolated colored beads on a transparent canvas.
  const connectiveShield = Math.exp(-Math.pow(r / (0.42 + 0.08 * broadMoisture + 0.05 * matureCore), 2.0)) *
    (0.020 + 0.060 * coreBuilding + 0.075 * matureCore + 0.030 * dvorakCdoPattern) *
    clamp(0.44 + 0.45 * lowNoise + 0.20 * midNoise, 0.10, 1.15);
  density += connectiveShield * clamp(1 - 0.78 * landDamage, 0.12, 1) * (1 - 0.20 * healthyIntenseCore);

  // Dry-air intrusion cuts a meandering slot through rainbands first and only reaches the eyewall
  // when the simulated core exposure/connection says that it has actually penetrated inward.
  const dryHalfWidth = 25 + 84 * clamp(dryWrap + 0.42 * dryExposure, 0, 1);
  const drySector = sectorWeight(bearingDeg, dryBearing, dryHalfWidth);
  const dryRadialStart = 0.05 + 0.22 * (1 - dryExposure);
  const dryRadial = smoothstep((r - dryRadialStart) / 0.16) * (1 - smoothstep((r - 1.02) / 0.16));
  const dryFingers = clamp(0.54 + 0.58 * midNoise + 0.20 * towerNoise, 0.18, 1.28);
  density *= 1 - clamp(drySector * dryRadial * dryFingers * (0.10 + 0.78 * dryStrength), 0, 0.90);

  // Shear removes upshear cloud and favors a broader displaced downshear burst rather than simply
  // shrinking the entire storm symmetrically.
  if (shearNorm > 0.01) {
    const shearBearing = Number(storm.shearDir ?? 270);
    const downshear = sectorWeight(bearingDeg, shearBearing, 108);
    const upshear = sectorWeight(bearingDeg, (shearBearing + 180) % 360, 98);
    density *= 1 - upshear * shearNorm * (0.16 + 0.38 * smoothstep(r / 0.50));
    density += downshear * shearNorm * broadEnvelope * (0.04 + 0.17 * cellNoise) * (0.45 + 0.55 * deepCoverage);
  }

  // Land/terrain damage tears gaps into the core and feeder bands and redistributes the remaining
  // convection into displaced fragments. This is deliberately morphological: simply fading the
  // old circular cloud shield left an unrealistic intact cyclone sitting over land.
  let landFragmentSignal = 0;
  if (landDamage > 0.02) {
    const terrainBearing = Number(storm.terrainInteractionBearingDeg ?? 225);
    const terrainSector = sectorWeight(bearingDeg, terrainBearing, 85 + 35 * landDamage);
    const terrainBreak = terrainSector * smoothstep((r - 0.05) / 0.30) * (0.34 + 0.66 * midNoise) * landDamage;
    density *= 1 - clamp(terrainBreak * 0.76, 0, 0.78);

    // Terrain displacement and convective debris are carried by the time-integrated tracer.
    // No fixed seeded fragments or arbitrary patch centers survive across consecutive frames.
    const displacedR = Math.hypot(cdoX, cdoY);
    const terrainBandRadius = 0.28 + 0.15 * landDamage + 0.11 * (advectedMoisture - 0.5);
    const annularDebris = Math.exp(-Math.pow((displacedR - terrainBandRadius) / 0.23, 2));
    landFragmentSignal = clamp(annularDebris * landDamage *
      smoothstep((advectedConvection - 0.32) / 0.37) *
      (0.055 + 0.11 * advectedMoisture + 0.17 * brownOceanBurstIndex) *
      (0.32 + 0.68 * terrainSector), 0, 0.30);
    const breakupTexture = clamp(0.50 + 0.50 * advectedMoisture + 0.40 * advectedConvection, 0.12, 1.40);
    density = density * clamp(1 - landDamage * (0.10 + 0.18 * breakupTexture), 0.58, 1) +
      landFragmentSignal + postLandBandSupport * rainbands * (0.15 + 0.20 * advectedConvection);
    // LLCC exposure is diagnosed from loss of core geometry, and the advected moisture/updraft
    // grid determines which parts of the displaced inner cloud remain attached to outer bands.
    const innerBreakRadius = 0.32 + 0.13 * (advectedMoisture - 0.5);
    const innerScour = Math.exp(-Math.pow(displacedR / Math.max(0.15, innerBreakRadius), 2)) *
      landDamage * (1 - 0.62 * coreContinuity) *
      (0.42 + 0.40 * (1 - advectedConvection));
    density *= 1 - clamp(innerScour, 0, 0.82);
  }

  // Maintain realistic White-Dolphin-style post-peak asymmetry: moist-side shield survives,
  // while dry-side notches and exposed low-level swirls stay warmer than the dense CDO.
  const asymmetryWarmMask = clamp(dryNotchSector * smoothstep((dryStrength - 0.08) / 0.42) *
    (0.16 + 0.42 * dryStrength) + exposedSpiral * 0.22, 0, 0.68);
  density *= 1 - asymmetryWarmMask * (0.18 + 0.24 * (1 - advectedConvection));

  // Clear the eye only after the mature-core gate is satisfied. During eye formation a mottled
  // central warm spot appears first, then rapidly becomes a clean eye once the eyewall wraps.
  let eyeWarmMask = 0;
  if (landDamage < 0.54 && (eyeReady > 0.03 || healthyIntenseCore > 0.28) && r < localEyeRadius * 1.42) {
    const eyeT = clamp(r / Math.max(0.001, localEyeRadius * 1.34), 0, 1);
    const ordinaryClearProfile = 1 - smoothstep(eyeT);
    const healthyEyeT = clamp((r / Math.max(0.001, localEyeRadius) - 0.62) / 0.62, 0, 1);
    const healthyClearProfile = 1 - smoothstep(healthyEyeT);
    const clearProfile = ordinaryClearProfile * (1 - healthyIntenseCore) +
      healthyClearProfile * healthyIntenseCore;
    const eyeClearGate = Math.max(
      smoothstep((eyeReady - 0.11) / 0.50),
      healthyIntenseCore * (0.70 + 0.30 * eyeClearance) * (1 - 0.38 * eyeObstruction) * 0.98,
      (successfulTakeover ? 1 : 0) * (0.77 + 0.23 * eyeClearance) * (1 - 0.32 * eyeObstruction) * 0.99
    );
    eyeWarmMask = clamp(eyeClearGate * clearProfile * (1 - landDamage * 1.7), 0, 1);
    density *= 1 - eyeWarmMask * (0.97 + 0.025 * eyeClearGate);
    // Keep a little optically thin warm-eye signal so the product displays the eye as a warm
    // grey/dark spot instead of simply revealing the product's blue background colour.
    density = Math.max(density, 0.070 * eyeWarmMask);
  }

  density *= 1 - scar * 0.11 * (0.45 + 0.55 * midNoise);
  // Optical cloud coverage retains local texture rather than being globally blurred into a disk.
  density *= 0.88 + 0.18 * lowNoise + 0.10 * cellNoise;
  density = clamp(density, 0, 1);

  // IR temperature is not identical to optical opacity. Mature CDO towers/eyewall hot towers may
  // be much colder than nearby equally opaque anvil, producing the layered OTT/RAMMB appearance.
  // Separate broad band canopy from embedded convective towers.  Treating the entire optical
  // rainband ridge as one deep-cold signal produced enormous black OTT ribbons.  Real bands are a
  // mixture of warmer anvil/stratiform cloud with intermittent colder convective elements.
  const bandCanopyColdSignal = clamp(
    (0.88 * rainbands + 0.48 * rotatingBursts + 0.55 * broadOuterBand) *
      (0.34 + 0.66 * dvorakOrganization) * (0.72 + 0.28 * lowNoise),
    0, 0.88
  );
  // Cloud-top cooling follows localized advected updrafts, not every pixel in the broad
  // stratiform ridge. Saturating the entire band to -83 C had made enormous black OTT ribbons.
  const embeddedBandTower = smoothstep((advectedConvection - 0.38) / 0.38) *
    smoothstep((0.55 * towerNoise + 0.45 * cellNoise - 0.43) / 0.34);
  const bandTowerColdSignal = clamp(
    (1.80 * rainbandConvectiveSignal + 1.10 * feederConvectiveSignal + 0.62 * coldPoolArc +
      postLandBandSupport * advectedConvection * rainbands * 0.48) *
      (0.61 + 0.39 * dvorakOrganization) * (0.24 + 0.76 * embeddedBandTower),
    0, 1
  );
  const coreColdSignal = clamp(
    (0.34 * cdoEnvelope * (0.40 + 0.60 * homogenizedCore) + 0.88 * cdoTowerField +
      0.78 * eyewallRing * (0.34 + 0.66 * eyewallTowerPattern) +
      0.62 * outerEyewallRing * secondaryStrength * (0.34 + 0.66 * outerFracture)) *
      (0.34 + 0.66 * dvorakOrganization),
    0, 1
  );
  const analyzedTowerSignal = clamp(Math.max(
    towerSignal,
    eyewallRing * dvorakMajorCore * eyewallTowerPattern,
    scatteredConvection * (0.56 + 0.44 * burst),
    rotatingBursts * (0.65 + 0.35 * burst)
  ), 0, 1);
  const convectiveDepth = clamp(
    0.34 + 0.40 * deepCoverage + 0.18 * coreBuilding + 0.19 * matureCore + 0.26 * burst + 0.14 * dvorakMajorCore,
    0, 1.28
  );
  let brightnessTemperatureC =
    27 - (47 + 18 * convectiveDepth) * Math.pow(density, 0.70) - 26 * analyzedTowerSignal -
    23 * cdoTowerField - 7 * bandCanopyColdSignal - 14 * bandTowerColdSignal - 21 * dvorakMajorCore * coreColdSignal +
    8 * tdDisorganized * (1 - analyzedTowerSignal) + 5 * landDamage * cdoEnvelope;

  // Disorganized depressions and intensifying tropical storms can contain cold individual
  // convective towers even without a consolidated CDO. Do not infer cloud-top temperature from
  // the still-low maximum surface wind alone. Bursts grow out of the advected tracer.
  const developingCells = clamp((scatteredConvection + rotatingBursts) *
    (0.52 + 0.48 * advectedConvection) * (0.78 + 0.22 * burst), 0, 1);
  const developingTargetC = -48 - 23 * clamp(burst + 0.40 * organizing, 0, 1);
  brightnessTemperatureC = Math.min(brightnessTemperatureC,
    22 + (developingTargetC - 22) * smoothstep((developingCells - 0.045) / 0.37));

  // Intensity-consistent IR floor: at T5/T6+ the deepest eyewall/CDO towers must reach the cold
  // enhancement classes. Without this constraint a 50-60 m/s analyzed cyclone could render with
  // only green/yellow cloud tops simply because optical density happened to be locally moderate.
  const deepCoreGate = smoothstep((Math.max(analyzedTowerSignal, coreColdSignal * 0.82) - 0.24) / 0.62) *
    dvorakMajorCore * clamp(1 - 0.72 * landDamage, 0.18, 1);
  const analyzedCoreTargetC = -61 - 27 * dvorakMajorCore - 6 * dvorakExtremeCore;
  brightnessTemperatureC = Math.min(brightnessTemperatureC, 24 + (analyzedCoreTargetC - 24) * deepCoreGate);

  // No forced radial thermal plateau: a prescribed -85 C ring crossed the discontinuous
  // OTT palette thresholds and produced the photographed black donut / magenta sticker.
  // The homogenized CDO's thermal state is mixed from the advected updraft field below.
  // Smooth convective cooling only: never impose a hard magenta-temperature plateau.
  brightnessTemperatureC -= 6 * innerCdoColdArcSignal * (1 - eyeWarmMask);

  // Rainbands contain embedded deep convective cells, especially around a mature intense cyclone.
  // Give those cells their own cold-cloud signal so the entire outer band field cannot collapse to
  // featureless grey/white cirrus while the core is intense.
  const bandCanopyTargetC = -38 - 23 * dvorakOrganization - 4 * dvorakMajorCore;
  brightnessTemperatureC = Math.min(brightnessTemperatureC, 22 + (bandCanopyTargetC - 22) * bandCanopyColdSignal);
  const bandTowerTargetC = -64 - 15 * Math.max(dvorakOrganization, 0.55 * landfallOuterRainbandIndex) - 4 * dvorakMajorCore -
    5 * landDamage * clamp(advectedMoisture, 0, 1);
  brightnessTemperatureC = Math.min(brightnessTemperatureC, 22 + (bandTowerTargetC - 22) * bandTowerColdSignal);
  // The coldest *area mean* belongs to a coherent intense CDO, not to every feeder-band pixel.
  // Embedded band towers remain independently cold; avoid converting the CDO into a flat disk.
  const coherentCoreCooling = dvorakMajorCore * (1 - 0.85 * destructiveEnvironment) *
    (0.25 + 0.75 * homogenizedCore) * cdoEnvelope * smoothstep((density - 0.12) / 0.32) *
    (1 - eyeWarmMask);
  if (coherentCoreCooling > 0.12) {
    const coreCanopyTargetC = -68 - 13 * dvorakMajorCore - 5 * healthyIntenseCore;
    brightnessTemperatureC = Math.min(brightnessTemperatureC,
      coreCanopyTargetC + 12 * (1 - coherentCoreCooling) + 3 * (midNoise - 0.5));
  }
  const dryIntrusionColdSignal = clamp(moistShieldEnvelope * (0.45 + 0.55 * advectedConvection) +
    drySlotHook * (0.55 + 0.45 * advectedConvection), 0, 1);
  if (dryIntrusionColdSignal > 0.01) {
    const dryShieldTargetC = -46 - 12 * dvorakOrganization - 6 * dryExposure;
    brightnessTemperatureC = Math.min(brightnessTemperatureC,
      22 + (dryShieldTargetC - 22) * clamp(dryIntrusionColdSignal * 1.05, 0, 1));
  }
  const landfallShieldColdSignal = clamp(landfallShield * (0.20 + 0.80 * advectedMoisture) *
    (0.26 + 0.74 * advectedConvection) + deformationTail * 0.62, 0, 1);
  if (landfallShieldColdSignal > 0.01) {
    const landShieldTargetC = -43 - 10 * landDamage - 11 * postLandBandSupport - 5 * brownOceanBurstIndex;
    brightnessTemperatureC = Math.min(brightnessTemperatureC,
      22 + (landShieldTargetC - 22) * clamp(landfallShieldColdSignal, 0, 1));
  }
  const polewardOutflowColdSignal = clamp(polewardOutflowShield * (0.20 + 0.80 * advectedMoisture), 0, 1);
  if (polewardOutflowColdSignal > 0.01) {
    const outflowShieldTargetC = -39 - 10 * majorWnpTyphoon - 4 * outflowEfficiency;
    brightnessTemperatureC = Math.min(brightnessTemperatureC,
      22 + (outflowShieldTargetC - 22) * clamp(polewardOutflowColdSignal, 0, 1));
  }

  // Surface friction removes the warm-core symmetry faster than the outer moisture reservoir.
  // Advected organized rainbands retain deep cold towers after landfall instead of greying out
  // with the (necessarily decaying) analysed maximum wind.
  if (landDamage > 0.02 && r > 0.15) {
    const survivingBandGate = landDamage * smoothstep((rainbands - 0.07) / 0.30) *
      (0.42 + 0.58 * advectedConvection) * (0.50 + 0.50 * advectedMoisture);
    const survivorBurst = embeddedBandTower * smoothstep((advectedConvection - 0.42) / 0.38);
    brightnessTemperatureC = Math.min(brightnessTemperatureC,
      20 + (-66 - 12 * survivorBurst - 20) * clamp(survivingBandGate * 1.25, 0, 1));
    // Preserve the active rainband's visible red/orange cold-top classes: the lower -75 C
    // OTT shelf is nearly black, so saturating an entire surviving band there looks erased.
    const landBandAnvil = landDamage * smoothstep((rainbands - 0.08) / 0.26) *
      (0.35 + 0.65 * advectedMoisture);
    const activeBandTargetC = -65 - 12 * survivorBurst;
    brightnessTemperatureC += Math.max(0, activeBandTargetC - brightnessTemperatureC) *
      clamp(landBandAnvil * (0.75 + 0.15 * (1 - survivorBurst)), 0, 0.92);
  }

  // A healthy intense eyewall should merge thermally into the cold CDO instead of appearing as a
  // uniform black mathematical donut.  Most of the ring sits on the grey/white OTT shelves, with
  // only localized tower sectors reaching pink/magenta.
  const healthyEyewallGate = clamp(healthyIntenseCore * eyewallRing * (1 - eyeWarmMask), 0, 1);
  if (healthyEyewallGate > 0.01) {
    const healthyEyewallTargetC = -80 - 8 * eyewallTowerPattern - 3 * dvorakExtremeCore;
    brightnessTemperatureC = Math.min(
      brightnessTemperatureC,
      22 + (healthyEyewallTargetC - 22) * Math.sqrt(healthyEyewallGate)
    );
  }
  if (landFragmentSignal > 0.05) {
    const fragmentTargetC = -44 - 24 * dvorakOrganization;
    const fragmentColdGate = Math.sqrt(landFragmentSignal) * (1 - 0.26 * landDamage);
    brightnessTemperatureC = Math.min(brightnessTemperatureC, 20 + (fragmentTargetC - 20) * fragmentColdGate);
  }
  if (eyeWarmMask > 0.001) {
    const eyeTargetC = 12 + 12 * eyeClearance + 5 * Math.max(0, Number(storm.eyeWarmCore ?? 0));
    brightnessTemperatureC = brightnessTemperatureC * (1 - eyeWarmMask) + eyeTargetC * eyeWarmMask;
  }
  // Permit the very coldest simulated overshooting tops to enter OTT's pink/magenta branch.
  // The previous -101 C clamp made the lower OTT breakpoints unreachable even though the palette
  // defined them, producing an obvious mismatch with the supplied enhanced-IR reference.

  // Homogenized CDO: enforce a *continuous* inner-to-outer thermal distribution. The old
  // additive cold-floor chain could drive the entire shield below -95 C, yielding a solid
  // magenta disk and a discontinuous black donut. Rare advected updrafts retain colder tips.
  if (healthyIntenseCore > 0.05 && landDamage < 0.65 && cdoEnvelope > 0.07) {
    const innerFraction = 1 - smoothstep((cdoR / Math.max(0.09,cdoRadiusLocal) - 0.20) / 0.90);
    const rareUpdraft = smoothstep((advectedConvection - 0.63) / 0.30) *
      smoothstep((towerNoise - 0.57) / 0.35) * (0.48 + 0.52 * burst);
    const mixedCoreTargetC = -79 - 4.0 * innerFraction - 4.0 * rareUpdraft * dvorakExtremeCore +
      2.2 * (advectedMoisture - 0.5) + 2.0 * (lowNoise - 0.5) +
      2.4 * (advectedConvection - 0.5);
    const coherentGate = healthyIntenseCore * smoothstep((cdoEnvelope - 0.025) / 0.16) *
      smoothstep((density - 0.06) / 0.15) * (1 - eyeWarmMask) * (1 - landDamage);
    brightnessTemperatureC = brightnessTemperatureC * (1 - coherentGate) +
      mixedCoreTargetC * coherentGate;
  }

  // Weak TD/TS/STS cloud fields should not contain a giant, uniformly extreme-cold cloud top.
  // Keep isolated vigorous cells and cold segments within the rainbands, but limit the extent of
  // -80/-90 C pixels when the organized inner core has not formed. No gray-only conversion:
  // ordinary rainband anvils retain blue/green/red IR classes depending on local convection.
  if (vmaxMs < 32.7) {
    const isolatedTower = smoothstep((advectedConvection - 0.60) / 0.32) *
      smoothstep((towerNoise - 0.58) / 0.30) *
      smoothstep((rainbandConvectiveSignal + scatteredConvection - 0.16) / 0.44);
    const burstTower = smoothstep((burst - 0.53) / 0.32) *
      smoothstep((advectedConvection - 0.34) / 0.44) *
      smoothstep((towerNoise - 0.34) / 0.50) *
      smoothstep((rainbandConvectiveSignal + scatteredConvection - 0.10) / 0.40);
    const weakColdLimitC = -56 - 12 * (1 - weakBandRegime) -
      20 * Math.max(isolatedTower, burstTower);
    if (brightnessTemperatureC < weakColdLimitC) {
      brightnessTemperatureC = weakColdLimitC + 0.12 * (brightnessTemperatureC - weakColdLimitC);
    }
  }

  // OTT enhancement constraint: widespread magenta/pink cold cloud tops are reserved for
  // extreme T6+ / roughly 65 m/s and stronger cyclones. A strong but sub-super typhoon can
  // still have isolated overshooting towers, but not a whole magenta CDO.
  if (!dvorakExtremeCore && brightnessTemperatureC < -84) {
    brightnessTemperatureC = -84 + (brightnessTemperatureC + 84) * 0.35;
  }
  const replacementGate = clamp(secondaryStrength * (ewrcActive ? 1 : 0.48), 0, 1);
  if (replacementGate > 0.04 && brightnessTemperatureC < -85) {
    // EWRC weakens mean eyewall updraft. Only small, independently advected high-energy
    // towers may cross the pink enhancement threshold while replacement is under way.
    const exceptionalTower = smoothstep((advectedConvection - 0.73) / 0.23) *
      smoothstep((burst - 0.55) / 0.32) * (1 - landDamage);
    const floorC = -85 - 9 * exceptionalTower;
    brightnessTemperatureC = brightnessTemperatureC * (1 - replacementGate) +
      Math.max(brightnessTemperatureC, floorC) * replacementGate;
  }
  brightnessTemperatureC = clamp(brightnessTemperatureC, -95, 32);

  const visualAnnular = annularMode > 0.72 && eyeReady > 0.70;
  // The canvas writer derives RGB directly from temperature. Creating and then discarding
  // an rgba string for each high-resolution IR pixel was a major avoidable allocation hotspot.
  const color = frame?.fastPixel && mode === "ir" ? "" : mode === "ir"
    ? getHurricaneTrackerSatelliteColorForTemperature(brightnessTemperatureC, "ir", density <= 0.035 ? 0 : clamp(0.18 + Math.pow(density, 0.60) * 0.82, 0, 1))
    : normalCloudColor(density);
  return { color, density, brightnessTemperatureC, cloudCover: params.cloudCover, strength: params.strength, annular: visualAnnular };
}

/** The IR writer also recolors exact cached temperature/density fields without allocating a
 * sample object per pixel. No LUT or temperature quantization changes the reference palette. */
function writeInfraredPixel(data: Uint8ClampedArray, offset: number, density: number,
  brightnessTemperatureC: number, palette: HurricaneTrackerSatellitePalette): void {
  if (density <= 0.035) return;
    // Hot path: write channels directly. The old conversion allocated an RGB array for every
    // pixel and scanned the enhancement table again even when neighbouring pixels share a band.
    // Preserve the exact temperature breakpoints, interpolation and alpha rounding.
    const temp = brightnessTemperatureC;
    if (palette === "ir") {
      const t = clamp((18 - temp) / 118, 0, 1);
      const shade = 28 + 227 * Math.pow(t, 0.82);
      data[offset] = Math.round(shade);
      data[offset + 1] = Math.round(shade);
      data[offset + 2] = Math.round(shade + Math.min(8, 8 * t));
    } else {
      const stops = palette === "rammb" ? RAMMB_ENHANCED_V_STOPS : OTT_STYLE_STOPS;
      let warm = stops[0], cold = stops[0], ratio = 0;
      if (temp <= stops[stops.length - 1].tempC) warm = cold = stops[stops.length - 1];
      else if (temp < stops[0].tempC) {
        for (let i = 0; i < stops.length - 1; i++) {
          if (temp <= stops[i].tempC && temp >= stops[i + 1].tempC) {
            warm = stops[i]; cold = stops[i + 1];
            ratio = clamp((warm.tempC - temp) / Math.max(1e-6, warm.tempC - cold.tempC), 0, 1);
            break;
          }
        }
      }
      data[offset] = Math.round(warm.rgb[0] + (cold.rgb[0] - warm.rgb[0]) * ratio);
      data[offset + 1] = Math.round(warm.rgb[1] + (cold.rgb[1] - warm.rgb[1]) * ratio);
      data[offset + 2] = Math.round(warm.rgb[2] + (cold.rgb[2] - warm.rgb[2]) * ratio);
    }
    const a = clamp(0.20 + Math.pow(clamp((density - 0.035) / 0.965, 0, 1), 0.58) * 0.80, 0, 1);
    data[offset + 3] = Math.round(Math.round(a * 1000) / 1000 * 255);
}

/** Direct IR palette conversion avoids two rgba string allocations and one regex per pixel. */
function writeCloudPixel(data: Uint8ClampedArray, offset: number, sample: HurricaneTrackerCloudSample,
  mode: HurricaneTrackerCloudMode, palette: HurricaneTrackerSatellitePalette): void {
  if (sample.density <= 0.035) return;
  if (mode === "ir") {
    writeInfraredPixel(data, offset, sample.density, sample.brightnessTemperatureC, palette);
    return;
  }
  const match = sample.color.match(/rgba\(([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)/);
  if (!match) return;
  data[offset] = Number(match[1]); data[offset+1] = Number(match[2]);
  data[offset+2] = Number(match[3]); data[offset+3] = Math.round(Number(match[4]) * 255);
}

const CLOUD_TILE_CACHE = new Map<string, HTMLCanvasElement>();
// The expensive convective/IR field is identical for RAMMB, OTT and gray IR. Cache *raw*,
// full-precision samples independently of the palette so changing just the enhancement does
// not integrate ~1 million cloud samples again. A byte cap bounds mobile memory use.
const CLOUD_SAMPLE_CACHE = new Map<string, Float64Array>();
// Keep one full-resolution IR field on constrained phones, but avoid retaining multiple
// 960px Float64 tiles alongside the rest of the simulation. Desktop gets a larger LRU.
const CLOUD_CONSTRAINED_DEVICE = typeof navigator !== "undefined" &&
  (Number((navigator as any).deviceMemory || 8) <= 4 ||
    (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));
const CLOUD_SAMPLE_BYTE_BUDGET = (CLOUD_CONSTRAINED_DEVICE ? 18 : 30) * 1024 * 1024;
const CLOUD_IMAGE_PIXEL_BUDGET = CLOUD_CONSTRAINED_DEVICE ? 3_000_000 : 6_000_000;

function cacheCloudField(key: string, field: Float64Array | null): void {
  if (!field || field.byteLength > CLOUD_SAMPLE_BYTE_BUDGET) return;
  CLOUD_SAMPLE_CACHE.delete(key);
  CLOUD_SAMPLE_CACHE.set(key, field);
  let bytes = 0;
  for (const entry of CLOUD_SAMPLE_CACHE.values()) bytes += entry.byteLength;
  while (bytes > CLOUD_SAMPLE_BYTE_BUDGET) {
    const oldest = CLOUD_SAMPLE_CACHE.keys().next().value as string;
    const oldField = CLOUD_SAMPLE_CACHE.get(oldest);
    if (!oldField) break;
    bytes -= oldField.byteLength;
    CLOUD_SAMPLE_CACHE.delete(oldest);
  }
}

function cacheCloudImage(key: string, image: HTMLCanvasElement): void {
  CLOUD_TILE_CACHE.delete(key);
  CLOUD_TILE_CACHE.set(key, image);
  let pixels = 0;
  for (const tile of CLOUD_TILE_CACHE.values()) pixels += tile.width * tile.height;
  while (CLOUD_TILE_CACHE.size > 12 || pixels > CLOUD_IMAGE_PIXEL_BUDGET) {
    const oldest = CLOUD_TILE_CACHE.keys().next().value as string;
    const oldTile = CLOUD_TILE_CACHE.get(oldest);
    if (!oldTile) break;
    pixels -= oldTile.width * oldTile.height;
    CLOUD_TILE_CACHE.delete(oldest);
  }
}

function colorizeCachedCloudRow(data: Uint8ClampedArray, field: Float64Array, y: number,
  size: number, mode: HurricaneTrackerCloudMode, palette: HurricaneTrackerSatellitePalette): void {
  for (let x = 0; x < size; x++) {
    const pixel = y * size + x;
    const density = field[pixel * 2];
    if (density <= 0.035) continue;
    // The raw field is IR-only; optical mode never requests this cache.
    writeInfraredPixel(data, pixel * 4, density, field[pixel * 2 + 1], palette);
  }
}

function cloudStructureFingerprint(storm: Partial<Typhoon>, hour: number, mode: HurricaneTrackerCloudMode, seed: string, size: number, palette: HurricaneTrackerSatellitePalette) {
  const q = (v: unknown, step: number) => Math.round((Number(v) || 0) / step) * step;
  return [
    stormIdentity(storm, seed), mode, palette, size, q(hour, .5), q(storm.vmax, .5), q(storm.rmw, 2),
    q(storm.dryAirIntrusion, .05), q(storm.dryAirCoreExposure, .05), q(storm.dryAirCoreConnection, .05),
    q(storm.dryAirWrapFraction, .05), q(storm.drySlotBearingDeg, 8), q(storm.shear, 1.5), q(storm.shearDir, 8),
    q(storm.eyewallIntegrity, .05), q(storm.eyewallWrapProgress, .05), q(storm.eyeFormationMemory, .05),
    q(storm.eyewallOpenSectorFraction, .05), q(storm.eyeRadiusKm, 2), q(storm.eyeClearance, .05),
    q(storm.eyeObstruction, .05), q(storm.coreRebuildScar, .05), q(storm.convectiveBurstIndex, .05),
    q(storm.deepConvectiveCoverage, .05), q(storm.coreCompactness, .05), q(storm.rainbandDominance, .05),
    q(storm.broadMoisturePlatform, .05), q(storm.structuralDisorganization, .05), q(storm.llccExposure, .05),
    q(storm.dvorakTNumber, .1), storm.landed ? 1 : 0, q(storm.landHours, .5),
    q(storm.terrainCoreLandFraction, .05), q(storm.terrainBlockingMemory, .05), q(storm.terrainHollowCoreMemory, .05),
    q(storm.secondaryEyewallStrength, .05), q(storm.ewrcProgress, .05), String(storm.ewrcState || "none"),
    q(storm.ewrcStandoffStrength, .05), q(storm.giantEyeOuterWallMemory, .05), q(storm.eyewallColdPoolMemory, .05),
    q(storm.postPeakEnvelopeMemory, .05), q(storm.circulationExpansion, .05), q(storm.outflowEfficiency, .05),
    q(storm.eyeAsymmetry, .05), q(storm.landfallOuterRainbandIndex, .05), q(storm.brownOceanBurstIndex, .05),
    q(storm.terrainInteractionBearingDeg, 8), q(storm.coreGeometryContinuity, .05),
    q(storm.moistureReservoir, .05), q(storm.innerCoreMoisture, .05),
    q(storm.lat, .02), q(storm.lon, .02),
    String(storm.structureMode || "")
  ].join("|");
}

/** Render/cache a local cyclone cloud tile.  The map, status card and product generator share this
 * same tile path so the expensive procedural shader surrogate is not recomputed for every screen
 * pixel on every React update. */
export function renderHurricaneTrackerCloudTile(
  storm: Partial<Typhoon>, simulationHour: number, mode: HurricaneTrackerCloudMode, seed = "HurricaneTracker", size = 144,
  palette: HurricaneTrackerSatellitePalette = "ott"
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = cloudStructureFingerprint(storm, simulationHour, mode, seed, size, palette);
  const cached = CLOUD_TILE_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  const fieldKey = mode === "ir" ? cloudStructureFingerprint(storm, simulationHour, mode, seed, size, "ott") : "";
  const existingField = mode === "ir" ? CLOUD_SAMPLE_CACHE.get(fieldKey) : undefined;
  if (existingField) {
    for (let y = 0; y < size; y++) colorizeCachedCloudRow(image.data, existingField, y, size, mode, palette);
    ctx.putImageData(image, 0, 0);
    cacheCloudImage(key, canvas);
    return canvas;
  }
  const samples = mode === "ir" ? new Float64Array(size * size * 2) : null;
  const stormLat = Number(storm.lat || 0), stormLon = Number(storm.lon || 0);
  const halfLat = getHurricaneTrackerCloudHalfLat(storm);
  const halfLon = halfLat / Math.max(.22, Math.cos(stormLat * Math.PI / 180));
  const resolvedDynamics = getConvectiveField(storm, simulationHour, seed);
  const frame = createCloudRenderFrame(storm, seed, halfLat);
  for (let y = 0; y < size; y++) {
    const lat = stormLat + (0.5 - y / Math.max(1, size - 1)) * halfLat * 2;
    for (let x = 0; x < size; x++) {
      const lon = stormLon + (x / Math.max(1, size - 1) - 0.5) * halfLon * 2;
      const sample = sampleHurricaneTrackerCloud(storm, lat, lon, simulationHour, mode, seed, resolvedDynamics, frame);
      const i = (y * size + x) * 4;
      if (samples) { samples[(y * size + x) * 2] = sample.density; samples[(y * size + x) * 2 + 1] = sample.brightnessTemperatureC; }
      writeCloudPixel(image.data, i, sample, mode, palette);
    }
  }
  ctx.putImageData(image, 0, 0);
  cacheCloudField(fieldKey, samples);
  cacheCloudImage(key, canvas);
  return canvas;
}

/**
 * Async compatibility entry point used by the newer product UI.
 *
 * IMPORTANT: this intentionally preserves the cloud calculation/generation mechanism of this
 * HurricaneTrackerPort revision. It uses the same lifecycle-aware footprint, the same
 * sampleHurricaneTrackerCloud() field and the same density -> palette mapping as the synchronous
 * renderer above. The only difference is that rows are generated in small chunks so the UI can
 * report progress/cancel without freezing for a full high-resolution product render.
 */
export async function renderHurricaneTrackerCloudTileAsync(
  storm: Partial<Typhoon>,
  simulationHour: number,
  mode: HurricaneTrackerCloudMode,
  seed = "HurricaneTracker",
  size = 144,
  palette: HurricaneTrackerSatellitePalette = "ott",
  opts?: { signal?: AbortSignal; onProgress?: (value: number) => void; chunkRows?: number }
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const key = cloudStructureFingerprint(storm, simulationHour, mode, seed, size, palette);
  const cached = CLOUD_TILE_CACHE.get(key);
  if (cached) {
    opts?.onProgress?.(100);
    return cached;
  }

  const abortIfNeeded = () => {
    if (opts?.signal?.aborted) throw new DOMException("Cloud tile generation cancelled", "AbortError");
  };
  abortIfNeeded();

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const image = ctx.createImageData(size, size);
  const fieldKey = mode === "ir" ? cloudStructureFingerprint(storm, simulationHour, mode, seed, size, "ott") : "";
  const existingField = mode === "ir" ? CLOUD_SAMPLE_CACHE.get(fieldKey) : undefined;
  const samples = mode === "ir" && !existingField ? new Float64Array(size * size * 2) : null;
  const stormLat = Number(storm.lat || 0), stormLon = Number(storm.lon || 0);
  const halfLat = getHurricaneTrackerCloudHalfLat(storm);
  const halfLon = halfLat / Math.max(.22, Math.cos(stormLat * Math.PI / 180));
  const resolvedDynamics = existingField ? undefined : getConvectiveField(storm, simulationHour, seed);
  const frame = existingField ? undefined : createCloudRenderFrame(storm, seed, halfLat);
  const chunkRows = Math.max(1, Math.min(size, Math.round(opts?.chunkRows ?? 16)));
  let lastYieldAt = performance.now();

  for (let y0 = 0; y0 < size; y0 += chunkRows) {
    abortIfNeeded();
    const yEnd = Math.min(size, y0 + chunkRows);
    for (let y = y0; y < yEnd; y++) {
      if (existingField) colorizeCachedCloudRow(image.data, existingField, y, size, mode, palette);
      else {
        const lat = stormLat + (0.5 - y / Math.max(1, size - 1)) * halfLat * 2;
        for (let x = 0; x < size; x++) {
          const lon = stormLon + (x / Math.max(1, size - 1) - 0.5) * halfLon * 2;
          const sample = sampleHurricaneTrackerCloud(storm, lat, lon, simulationHour, mode, seed, resolvedDynamics, frame);
          const i = (y * size + x) * 4;
          if (samples) { samples[(y * size + x) * 2] = sample.density; samples[(y * size + x) * 2 + 1] = sample.brightnessTemperatureC; }
          writeCloudPixel(image.data, i, sample, mode, palette);
        }
      }
      // Yield according to a real frame budget, not a fixed number of potentially expensive rows.
      if (performance.now() - lastYieldAt >= 12 && y < size - 1) {
        opts?.onProgress?.(Math.round((y + 1) / size * 100));
        abortIfNeeded();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldAt = performance.now();
      }
    }
    opts?.onProgress?.(Math.round(yEnd / Math.max(1, size) * 100));
    abortIfNeeded();
  }

  ctx.putImageData(image, 0, 0);
  cacheCloudField(fieldKey, samples);
  cacheCloudImage(key, canvas);
  opts?.onProgress?.(100);
  return canvas;
}

export function getHurricaneTrackerCloudBounds(storm: Partial<Typhoon>) {
  const lat = Number(storm.lat || 0), lon = Number(storm.lon || 0);
  const halfLat = getHurricaneTrackerCloudHalfLat(storm);
  const halfLon = halfLat / Math.max(.22, Math.cos(lat * Math.PI / 180));
  return { north: lat + halfLat, south: lat - halfLat, west: lon - halfLon, east: lon + halfLon };
}

export interface HurricaneTrackerWindVector {
  x: number;
  z: number;
}

/** Map AETHER's simulated-hour clock onto Hurricane Tracker's Spawner.getTime() scale.
 * The Unity defaults are dayLength=25 s and timeScale=200; gameSpeed cancels when expressed per
 * simulated calendar hour, yielding 25 / (200 * 24) = 1/192 time units per simulated hour.
 */
export function aetherHourToHurricaneTrackerTime(simulationHour: number): number {
  return simulationHour / 192;
}

function hurricaneTrackerGlobalSeed(seed: string): number {
  // Spawner.Start(): Random.Range(-9999f, 9999f). Stable hashing substitutes for Unity's global RNG.
  return -9999 + unitHash(`${seed}|Spawner.seed`) * 19998;
}

function getHurricaneTrackerJetstream(worldX: number, time: number, seedValue: number): { north: number; south: number } {
  // Exact getJetstream() IL: time /= 2; time += seed; x *= 12.8; both jet axes share the same
  // Perlin meander and are centred on +118/-118 in the scaled coordinate space.
  const t = time / 2 + seedValue;
  const scaledX = worldX * 12.8;
  const meander = (unityPerlinNoise(scaledX / 100 + t, -scaledX / 100 + t) - 0.5) * 2 * 30;
  return { north: (118 + meander) / 12.8, south: (-118 + meander) / 12.8 };
}

function addJetInfluence(
  wind: HurricaneTrackerWindVector,
  worldX: number,
  worldZ: number,
  jetZ: number,
  nextJetZ: number
) {
  // Exact Spawner.getWind() jet branch. The original computes a local jet tangent in coordinates
  // multiplied by 12.8, then weakens the contribution quadratically with meridional distance.
  const distance = Math.abs(worldZ * 12.8 - jetZ * 12.8 + 20);
  const ax = worldX * 12.8;
  const az = jetZ * 12.8;
  const bx = (worldX + 0.1) * 12.8;
  const bz = nextJetZ * 12.8;
  let dx = ax - bx;
  let dz = az - bz;
  const mag = Math.hypot(dx, dz) || 1;
  dx /= mag;
  dz /= mag;
  const resistance = Math.max(1, 0.003 * Math.pow(distance, 2));
  wind.x += Math.abs(dz * 2) / resistance;
  wind.z += Math.abs(dx * 2) / resistance;
}

/**
 * Port of Spawner.getWind(position,time,stormToIgnore) recovered directly from Assembly-CSharp.dll.
 * All numerical constants, coordinate swaps, jet-distance law and neighbouring-storm perturbation
 * below match the IL. The only engine-level substitution is a browser implementation of the fixed
 * Mathf.PerlinNoise primitive and deterministic recreation of Unity's random global seed.
 */
export function getHurricaneTrackerWind(
  worldX: number,
  worldZ: number,
  time: number,
  storms: readonly Partial<Typhoon>[] = [],
  stormToIgnore?: Partial<Typhoon>,
  seed = "HurricaneTracker"
): HurricaneTrackerWindVector {
  const hemisphereSign = worldZ < 0 ? -1 : 1;
  const seedValue = hurricaneTrackerGlobalSeed(seed);
  const noiseTime = time + seedValue;
  const scale = 5; // Spawner.scale static default from .cctor

  const wind: HurricaneTrackerWindVector = { x: -0.68, z: 0.35 * hemisphereSign };

  // Exact paired Mathf.PerlinNoise terms from getWind().
  wind.x += (unityPerlinNoise(worldX / scale + noiseTime, worldZ / scale + noiseTime) - 0.5) * 2;
  wind.z += (unityPerlinNoise(worldZ / scale + noiseTime, worldX / scale + noiseTime) - 0.5) * 1.2;

  const jet = getHurricaneTrackerJetstream(worldX, time, seedValue);
  const jetNext = getHurricaneTrackerJetstream(worldX + 0.1, time, seedValue);
  addJetInfluence(wind, worldX, worldZ, jet.north, jetNext.north);
  addJetInfluence(wind, worldX, worldZ, jet.south, jetNext.south);

  // Exact nearby-storm perturbation from the IL. StormModel freezes other GameObjects at their
  // current scene positions while integrating one target storm, so `storms` is intentionally not
  // advanced along with the forecast position.
  for (const other of storms) {
    if (!other || other === stormToIgnore || !Number.isFinite(other.lat) || !Number.isFinite(other.lon)) continue;
    if (stormToIgnore?.id && other.id && other.id === stormToIgnore.id) continue;
    const otherWorld = latLonToHurricaneTrackerWorld(Number(other.lat), Number(other.lon));
    const dx = otherWorld.x - worldX;
    const dz = otherWorld.z - worldZ;
    const worldDistance = Math.hypot(dx, dz);
    if (worldDistance <= 0.1) continue;

    const stormStrength = (Number(other.vmax || 0) * MPS_TO_MPH) / 50;
    const distanceFactor = Math.pow(worldDistance * 12.8, 1.4) / 10;
    if (!(distanceFactor > 0)) continue;

    const primaryX = dz / distanceFactor;
    const primaryZ = dx / -distanceFactor;
    const secondaryX = dx / -(distanceFactor * 6);
    const secondaryZ = dz / -(distanceFactor * 6);
    wind.x += ((primaryX + secondaryX) / 2) * stormStrength;
    wind.z += ((primaryZ + secondaryZ) / 2) * stormStrength;
  }

  return wind;
}

export function calculateHurricaneTrackerModelTrack(
  storm: Partial<Typhoon>,
  spec: HurricaneTrackerModelSpec,
  currentTime: number,
  storms: readonly Partial<Typhoon>[] = [],
  seed = "HurricaneTracker"
): HurricaneTrackerModelTrack {
  const world = latLonToHurricaneTrackerWorld(Number(storm.lat || 0), Number(storm.lon || 0));
  let x = world.x;
  let z = world.z;
  const unityCurrentTime = aetherHourToHurricaneTrackerTime(currentTime);
  const track: HurricaneTrackerTrackPoint[] = [
    { lat: Number(storm.lat || 0), lon: Number(storm.lon || 0), step: 0, futureTime: unityCurrentTime, leadFraction: 0 }
  ];

  for (let i = 0; i < spec.resolution; i++) {
    // Exact recovered StormModel formula. Every model reads the SAME global wind field; model name
    // never changes the noise seed. The differing iStep/resolution/length values create the spread.
    const futureTime = unityCurrentTime + (spec.iStep / 200) * (i / spec.resolution);
    const wind = getHurricaneTrackerWind(x, z, futureTime, storms, storm, seed);
    const deltaX = wind.x / spec.resolution * spec.length;
    const deltaZ = wind.z / spec.resolution * spec.length;
    x += deltaX;
    z += deltaZ;
    const ll = hurricaneTrackerWorldToLatLon(x, z);
    track.push({
      // StormModel itself performs no geographic clamp/wrap; preserve that behaviour.
      lat: ll.lat,
      lon: ll.lon,
      step: i + 1,
      futureTime,
      leadFraction: (i + 1) / spec.resolution
    });
  }

  return { id: spec.name, spec, track };
}

export function calculateHurricaneTrackerModelTracks(
  storm: Partial<Typhoon>,
  currentTime: number,
  storms: readonly Partial<Typhoon>[] = [],
  seed = "HurricaneTracker"
): HurricaneTrackerModelTrack[] {
  return HURRICANE_TRACKER_MODEL_SPECS.map((spec) =>
    calculateHurricaneTrackerModelTrack(storm, spec, currentTime, storms, seed)
  );
}

export interface HurricaneTrackerReferencePoint {
  lat: number;
  lon: number;
  simHour?: number;
}

function interpolateReferencePath(
  storm: Partial<Typhoon>,
  referencePath: readonly HurricaneTrackerReferencePoint[] | undefined,
  leadHour: number,
  currentHour: number,
  horizonHours = 120
): { lat: number; lon: number } {
  const source = (referencePath || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!source.length) return { lat: Number(storm.lat || 0), lon: Number(storm.lon || 0) };
  const pts = [{ lat: Number(storm.lat || 0), lon: Number(storm.lon || 0), lead: 0 }, ...source.map((p, i) => {
    const raw = Number(p.simHour);
    let lead = Number.isFinite(raw) ? raw : ((i + 1) / source.length) * horizonHours;
    // Stored AETHER forecast paths normally use lead hours.  Historical/export paths may contain
    // absolute simulation hours; normalize those without disturbing an ordinary 0..120 path.
    if (lead > horizonHours + 1 && lead >= currentHour - 1e-6) lead -= currentHour;
    return { lat: Number(p.lat), lon: Number(p.lon), lead: Math.max(0, lead) };
  })].sort((a, b) => a.lead - b.lead);
  const target = clamp(leadHour, 0, horizonHours);
  if (target <= pts[0].lead) return { lat: pts[0].lat, lon: pts[0].lon };
  for (let i = 1; i < pts.length; i++) {
    if (target <= pts[i].lead + 1e-6) {
      const a = pts[i - 1], b = pts[i];
      const t = clamp((target - a.lead) / Math.max(1e-6, b.lead - a.lead), 0, 1);
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  return { lat: pts[pts.length - 1].lat, lon: pts[pts.length - 1].lon };
}

function interpolateModelTrack(track: readonly HurricaneTrackerTrackPoint[], fraction: number) {
  const f = clamp(fraction, 0, 1);
  if (!track.length) return { lat: 0, lon: 0 };
  const pos = f * Math.max(1, track.length - 1);
  const i0 = Math.min(track.length - 1, Math.floor(pos));
  const i1 = Math.min(track.length - 1, i0 + 1);
  const t = pos - i0;
  return {
    lat: track[i0].lat + (track[i1].lat - track[i0].lat) * t,
    lon: track[i0].lon + (track[i1].lon - track[i0].lon) * t
  };
}

/**
 * AETHER-guided Hurricane Tracker multi-model family.
 *
 * The Unity release supplies the *spread generator* (the eight StormModel integrations), while the
 * AETHER deterministic forecast or user-drawn forecast framework supplies the shared synoptic
 * trajectory.  The original GFS-labelled StormModel becomes the zero-anomaly member and the other
 * seven preserve their Unity displacement relative to that member.  This keeps the recovered
 * resolution/iStep/length behaviour without allowing the pseudo-model family to ignore the actual
 * AETHER forecast direction.
 */
export function calculateHurricaneTrackerGuidanceTracks(
  storm: Partial<Typhoon>,
  currentTime: number,
  storms: readonly Partial<Typhoon>[] = [],
  seed = "HurricaneTracker",
  referencePath?: readonly HurricaneTrackerReferencePoint[],
  horizonHours = 120
): HurricaneTrackerModelTrack[] {
  const raw = calculateHurricaneTrackerModelTracks(storm, currentTime, storms, seed);
  if (!referencePath?.length) return raw;
  const gfs = raw.find((m) => m.spec.name === "GFS") || raw[0];
  return raw.map((model) => ({
    ...model,
    track: model.track.map((pt) => {
      const f = clamp(pt.leadFraction, 0, 1);
      const leadHour = f * horizonHours;
      const base = interpolateReferencePath(storm, referencePath, leadHour, currentTime, horizonHours);
      const modelRaw = interpolateModelTrack(model.track, f);
      const gfsRaw = interpolateModelTrack(gfs.track, f);
      // Latitude/longitude deltas are intentionally taken in the same flat equirectangular spirit
      // as Hurricane Tracker's 80x40 world.  GFS therefore lies exactly on the AETHER reference.
      const dLat = model.spec.name === "GFS" ? 0 : modelRaw.lat - gfsRaw.lat;
      const dLon = model.spec.name === "GFS" ? 0 : modelRaw.lon - gfsRaw.lon;
      return { ...pt, lat: base.lat + dLat, lon: base.lon + dLon };
    })
  }));
}
