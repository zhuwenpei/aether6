import type { SimulationConfig } from "../types";

/**
 * AETHER 4.1.2 synoptic environment engine.
 *
 * The legacy environment is intentionally kept untouched.  This module is a separate,
 * reanalysis-inspired field system designed around smoothly evolving 120 h synoptic scenes.
 * The background climatology follows the large-scale spatial/seasonal structure represented in
 * NCEP/NCAR and ERA5 pressure-level fields; SST geography follows NOAA OISST v2.1 climatology.
 * It is not a live weather feed and must not be presented as an analysis of a particular date.
 */

export type SynopticAtmosPresetId =
  | "wnp_monsoon_ridge"
  | "recurvature_trough"
  | "monsoon_gyre"
  | "cutoff_cold_low"
  | "continental_surge"
  | "equatorial_crossflow";

export type SynopticOceanPresetId =
  | "wnp_climatology_mesoscale"
  | "warm_pool_deep"
  | "kuroshio_front"
  | "cold_wake_mixed"
  | "late_season_front";

export interface SynopticPresetInfo {
  id: string;
  name: string;
  description: string;
  seasonLabel: string;
}

export const SYNOPTIC_ATMOS_PRESETS: SynopticPresetInfo[] = [
  {
    id: "wnp_monsoon_ridge",
    name: "盛夏季风槽—副高摆动",
    seasonLabel: "7–9月型",
    description: "西太副高呈多中心弯曲脊带，季风槽东伸并伴随菲律宾海低压；急流轴在北侧蛇行。"
  },
  {
    id: "recurvature_trough",
    name: "深槽东移—转向型",
    seasonLabel: "8–10月型",
    description: "中纬度深槽自华北—东海向日本附近推进，副高断裂并东退，槽前西南气流逐步增强。"
  },
  {
    id: "monsoon_gyre",
    name: "季风环流/低压群型",
    seasonLabel: "7–9月型",
    description: "南海—菲律宾海维持大尺度低压环流，季风西南风、跨赤道气流与多个低压中心缓慢旋转。"
  },
  {
    id: "cutoff_cold_low",
    name: "高空冷涡—切断低压型",
    seasonLabel: "6–9月型",
    description: "副热带中高层出现切断低压与TUTT冷涡，产生显著方向性风切和中层干空气卷入。"
  },
  {
    id: "continental_surge",
    name: "大陆高压—东北季风爆发",
    seasonLabel: "10–3月型",
    description: "大陆高压南压，南海/菲律宾附近出现东北季风涌流，低纬东风增强、干空气向海上推进。"
  },
  {
    id: "equatorial_crossflow",
    name: "赤道跨流—ITCZ活跃型",
    seasonLabel: "5–7月型",
    description: "赤道以南跨赤道气流北上并转为西南季风，ITCZ波动明显，低纬度环境平均流变化较快。"
  }
];

export const SYNOPTIC_OCEAN_PRESETS: SynopticPresetInfo[] = [
  {
    id: "wnp_climatology_mesoscale",
    name: "西北太平洋精细气候态",
    seasonLabel: "暖季",
    description: "0.25°采样网格逻辑，包含暖池、南海陆架、东海陆架、黑潮、亲潮及中尺度暖/冷涡。"
  },
  {
    id: "warm_pool_deep",
    name: "菲律宾海深暖池",
    seasonLabel: "7–10月型",
    description: "菲律宾海暖池和高OHC区偏强，暖涡随背景流缓慢西北移。"
  },
  {
    id: "kuroshio_front",
    name: "黑潮—锋面蛇行",
    seasonLabel: "全年可用",
    description: "黑潮暖舌、东海陆架锋和日本南侧锋面位置在5天内持续摆动。"
  },
  {
    id: "cold_wake_mixed",
    name: "混合层冷尾迹场",
    seasonLabel: "台风活跃期",
    description: "加入多个缓慢平移的冷涡/冷尾迹异常，OHC比SST下降更明显。"
  },
  {
    id: "late_season_front",
    name: "秋季南压海温锋",
    seasonLabel: "10–12月型",
    description: "26–28℃等温线显著南压，东海/日本附近温度梯度加强，南海仍保留相对暖水。"
  }
];

/**
 * Regional upper-ocean anomaly database used by the 0.25° logical SST/OHC grid.  Values are
 * climatological anomaly parameters (°C / kJ cm⁻²-like model OHC units), not observations for a
 * particular date.  They encode named marginal seas, shelves, warm pools and frontal zones so the
 * field does not collapse to a single latitude gradient.
 */
export const SYNOPTIC_OCEAN_REGION_DATABASE: ReadonlyArray<{
  id: string; name: string; lat: number; lon: number; rLat: number; rLon: number; sstDelta: number; ohcDelta: number;
}> = [
  { id: "wpac_warm_pool", name: "西太平洋暖池", lat: 12.5, lon: 142.0, rLat: 10.0, rLon: 23.0, sstDelta: 0.95, ohcDelta: 54 },
  { id: "philippine_deep_pool", name: "菲律宾海深暖水", lat: 18.0, lon: 132.0, rLat: 7.5, rLon: 12.0, sstDelta: 0.38, ohcDelta: 34 },
  { id: "south_china_basin", name: "南海中央盆地", lat: 13.5, lon: 114.0, rLat: 8.0, rLon: 11.0, sstDelta: 0.28, ohcDelta: 18 },
  { id: "n_scs_shelf", name: "南海北部陆架", lat: 22.5, lon: 113.5, rLat: 5.0, rLon: 8.0, sstDelta: -0.45, ohcDelta: -24 },
  { id: "vietnam_upwelling", name: "越南沿岸上升流区", lat: 17.5, lon: 108.5, rLat: 5.0, rLon: 5.0, sstDelta: -0.22, ohcDelta: -18 },
  { id: "east_china_shelf", name: "东海陆架", lat: 31.5, lon: 123.5, rLat: 5.8, rLon: 5.8, sstDelta: -0.80, ohcDelta: -31 },
  { id: "yellow_sea", name: "黄海浅水区", lat: 38.0, lon: 124.0, rLat: 5.5, rLon: 7.0, sstDelta: -1.50, ohcDelta: -45 },
  { id: "oyashio", name: "亲潮冷水区", lat: 42.0, lon: 147.0, rLat: 7.0, rLon: 12.0, sstDelta: -2.40, ohcDelta: -58 },
  { id: "japan_front", name: "日本南侧锋区", lat: 36.5, lon: 145.0, rLat: 4.5, rLon: 8.5, sstDelta: -1.20, ohcDelta: -34 },
  { id: "indo_throughflow", name: "印尼贯穿流暖区", lat: 5.0, lon: 126.0, rLat: 6.0, rLon: 11.0, sstDelta: 0.32, ohcDelta: 20 },
  { id: "sulu_sea", name: "苏禄海", lat: 9.5, lon: 120.5, rLat: 3.5, rLon: 4.0, sstDelta: 0.24, ohcDelta: 15 },
  { id: "celebes_sea", name: "西里伯斯海", lat: 4.5, lon: 123.5, rLat: 3.5, rLon: 5.5, sstDelta: 0.22, ohcDelta: 18 },
  { id: "mariana_pool", name: "马里亚纳暖水区", lat: 15.5, lon: 148.5, rLat: 5.5, rLon: 8.0, sstDelta: 0.18, ohcDelta: 19 },
  { id: "ryukyu_trough", name: "琉球海槽深暖水", lat: 25.5, lon: 127.5, rLat: 3.5, rLon: 4.5, sstDelta: 0.20, ohcDelta: 22 },
  { id: "north_philippine_front", name: "菲律宾以北锋区", lat: 21.5, lon: 124.0, rLat: 3.0, rLon: 5.0, sstDelta: -0.14, ohcDelta: -9 },
  { id: "bonin_recirc", name: "小笠原再循环暖区", lat: 27.5, lon: 143.0, rLat: 4.0, rLon: 6.0, sstDelta: 0.18, ohcDelta: 15 }
];

export type SynopticFeatureKind =
  | "subtropicalHigh"
  | "monsoonTrough"
  | "monsoonLow"
  | "itcz"
  | "westerlyJet"
  | "westerlyTrough"
  | "westerlyRidge"
  | "cutoffLow"
  | "upperColdLow"
  | "tropicalHigh"
  | "continentalHigh"
  | "lowLatEasterlies"
  | "midLatWesterlies"
  | "crossEquatorialFlow"
  | "monsoonFlow"
  | "meanFlow"
  | "betaEffect"
  | "dryAir"
  | "windShear";

export interface SynopticEnvironmentState {
  u850: number;
  v850: number;
  u500: number;
  v500: number;
  u200: number;
  v200: number;
  h500: number;
  rh700: number;
  slp: number;
  shear: number;
  shearU: number;
  shearV: number;
  meanU: number;
  meanV: number;
  sst: number;
  ohc: number;
  scores: Record<SynopticFeatureKind, number>;
}

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const cyc = (hours: number, period: number) => {
  const x = ((hours % period) + period) % period;
  return x / period;
};
const phaseSin = (hours: number, period: number, phase = 0) => Math.sin(cyc(hours, period) * Math.PI * 2 + phase);
const phaseCos = (hours: number, period: number, phase = 0) => Math.cos(cyc(hours, period) * Math.PI * 2 + phase);

/**
 * Offline 5-day synoptic phase database at six-hour cadence.  The values are nondimensional
 * multipliers derived from typical WNP regime evolution; they are interpolated continuously so
 * the simulator never jumps at a keyframe boundary.  The last row closes the 120 h cycle.
 *
 * This is deliberately independent from the legacy scalar presets: the database modulates
 * multiple interacting fields (ridge, monsoon, jet, ITCZ and upper lows) at different phases.
 */
export const SYNOPTIC_5D_PHASE_DATABASE: ReadonlyArray<{
  hour: number; ridge: number; monsoon: number; jet: number; itcz: number; upperLow: number; trough: number;
}> = [
  { hour:   0, ridge: 0.864, monsoon: 1.075, jet: 0.847, itcz: 1.069, upperLow: 1.002, trough: 0.816 },
  { hour:   6, ridge: 0.922, monsoon: 1.076, jet: 0.841, itcz: 1.059, upperLow: 0.986, trough: 0.855 },
  { hour:  12, ridge: 0.970, monsoon: 1.072, jet: 0.838, itcz: 1.040, upperLow: 0.958, trough: 0.890 },
  { hour:  18, ridge: 1.002, monsoon: 1.066, jet: 0.848, itcz: 1.013, upperLow: 0.914, trough: 0.922 },
  { hour:  24, ridge: 1.017, monsoon: 1.060, jet: 0.877, itcz: 0.980, upperLow: 0.854, trough: 0.954 },
  { hour:  30, ridge: 1.019, monsoon: 1.049, jet: 0.927, itcz: 0.946, upperLow: 0.787, trough: 0.990 },
  { hour:  36, ridge: 1.014, monsoon: 1.029, jet: 0.990, itcz: 0.913, upperLow: 0.725, trough: 1.031 },
  { hour:  42, ridge: 1.010, monsoon: 0.995, jet: 1.054, itcz: 0.884, upperLow: 0.683, trough: 1.072 },
  { hour:  48, ridge: 1.007, monsoon: 0.945, jet: 1.105, itcz: 0.863, upperLow: 0.674, trough: 1.107 },
  { hour:  54, ridge: 1.006, monsoon: 0.885, jet: 1.129, itcz: 0.852, upperLow: 0.701, trough: 1.126 },
  { hour:  60, ridge: 1.000, monsoon: 0.825, jet: 1.120, itcz: 0.851, upperLow: 0.759, trough: 1.119 },
  { hour:  66, ridge: 0.982, monsoon: 0.777, jet: 1.082, itcz: 0.861, upperLow: 0.837, trough: 1.083 },
  { hour:  72, ridge: 0.950, monsoon: 0.752, jet: 1.023, itcz: 0.880, upperLow: 0.917, trough: 1.021 },
  { hour:  78, ridge: 0.903, monsoon: 0.758, jet: 0.959, itcz: 0.907, upperLow: 0.986, trough: 0.943 },
  { hour:  84, ridge: 0.848, monsoon: 0.793, jet: 0.903, itcz: 0.940, upperLow: 1.031, trough: 0.863 },
  { hour:  90, ridge: 0.797, monsoon: 0.851, jet: 0.865, itcz: 0.974, upperLow: 1.052, trough: 0.795 },
  { hour:  96, ridge: 0.762, monsoon: 0.918, jet: 0.847, itcz: 1.007, upperLow: 1.052, trough: 0.752 },
  { hour: 102, ridge: 0.750, monsoon: 0.981, jet: 0.844, itcz: 1.036, upperLow: 1.041, trough: 0.737 },
  { hour: 108, ridge: 0.767, monsoon: 1.031, jet: 0.848, itcz: 1.057, upperLow: 1.027, trough: 0.748 },
  { hour: 114, ridge: 0.808, monsoon: 1.062, jet: 0.850, itcz: 1.068, upperLow: 1.014, trough: 0.778 },
  { hour: 120, ridge: 0.864, monsoon: 1.075, jet: 0.847, itcz: 1.069, upperLow: 1.002, trough: 0.816 }
];

function interpolateFiveDayPhase(hour: number) {
  const h = ((hour % 120) + 120) % 120;
  const f = h / 6;
  const i0 = Math.floor(f) % 20;
  const i1 = i0 + 1;
  const t = smooth(f - Math.floor(f));
  const a = SYNOPTIC_5D_PHASE_DATABASE[i0];
  const b = SYNOPTIC_5D_PHASE_DATABASE[i1];
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    ridge: lerp(a.ridge, b.ridge), monsoon: lerp(a.monsoon, b.monsoon),
    jet: lerp(a.jet, b.jet), itcz: lerp(a.itcz, b.itcz),
    upperLow: lerp(a.upperLow, b.upperLow), trough: lerp(a.trough, b.trough)
  };
}
const gaussian = (lat: number, lon: number, cLat: number, cLon: number, rLat: number, rLon: number) => {
  const x = (lat - cLat) / Math.max(0.2, rLat);
  const y = (lon - cLon) / Math.max(0.2, rLon);
  return Math.exp(-(x * x + y * y));
};
const distanceToCurve = (lat: number, lon: number, latitudeAtLon: (x: number) => number, latScale: number) => {
  const target = latitudeAtLon(lon);
  return Math.abs(lat - target) / Math.max(0.2, latScale);
};

// Tiny bounded memoization keeps the new field system cheaper than repeatedly rebuilding the same
// 850/500/200-hPa state for SST/RH/shear/steering calls in one simulation step or map sample.
const atmosCache = new Map<string, Omit<SynopticEnvironmentState, "sst" | "ohc">>();
const oceanCache = new Map<string, { sst: number; ohc: number }>();
function boundedSet<T>(cache: Map<string, T>, key: string, value: T, max = 1400) {
  cache.set(key, value);
  if (cache.size > max) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
}
function atmosphereCacheKey(lat: number, lon: number, config: SimulationConfig, hour: number) {
  return [lat.toFixed(2), lon.toFixed(2), hour.toFixed(2), config.newAtmosPreset, config.newAtmosAnomalyScale,
    config.newAtmosShearScale, config.newAtmosHumidityBias, config.shearPreset].join("|");
}
function oceanCacheKey(lat: number, lon: number, config: SimulationConfig, hour: number) {
  // Hundredth-degree cache keys preserve bilinear interpolation while still producing abundant
  // cache hits for the coarse visualization sampler and repeated engine diagnostics.
  return [lat.toFixed(2), lon.toFixed(2), hour.toFixed(2), config.newOceanPreset,
    config.newOceanSstBias, config.newOceanOhcScale, config.newOceanMesoscaleScale].join("|");
}

function effectiveAtmosHour(config: SimulationConfig, simHour = 0): number {
  const offset = Number(config.newAtmosTimeOffsetHours ?? 0);
  const baseHour = config.newAtmosTimeFlowEnabled === false
    ? Number(config.newAtmosFrozenBaseHour ?? 0)
    : simHour;
  return baseHour + offset;
}
function effectiveOceanHour(config: SimulationConfig, simHour = 0): number {
  const offset = Number(config.newOceanTimeOffsetHours ?? 0);
  const baseHour = config.newOceanTimeFlowEnabled === false
    ? Number(config.newOceanFrozenBaseHour ?? 0)
    : simHour;
  return baseHour + offset;
}

interface FieldAccumulator {
  u850: number; v850: number; u500: number; v500: number; u200: number; v200: number;
  h500: number; rh700: number; slp: number;
  score: Record<SynopticFeatureKind, number>;
}

const emptyScores = (): Record<SynopticFeatureKind, number> => ({
  subtropicalHigh: 0, monsoonTrough: 0, monsoonLow: 0, itcz: 0,
  westerlyJet: 0, westerlyTrough: 0, westerlyRidge: 0, cutoffLow: 0,
  upperColdLow: 0, tropicalHigh: 0, continentalHigh: 0, lowLatEasterlies: 0,
  midLatWesterlies: 0, crossEquatorialFlow: 0, monsoonFlow: 0, meanFlow: 0,
  betaEffect: 0, dryAir: 0, windShear: 0
});

/** Broad WNP climatological background, with curved rather than zonally straight flow. */
function addClimatology(a: FieldAccumulator, lat: number, lon: number, hour: number, season: "warm" | "cool" | "transition") {
  const warm = season === "warm" ? 1 : season === "transition" ? 0.58 : 0.18;
  const cool = 1 - warm;
  const tropical = Math.exp(-Math.pow((lat - 14) / 16, 2));
  const midlat = smooth((lat - 23) / 22);
  const jetAxis = 42 - 15 * cool + 2.3 * Math.sin((lon - 112) * DEG * 2.2 + 0.18 * phaseSin(hour, 120));
  const jetBand = Math.exp(-Math.pow((lat - jetAxis) / (5.0 + cool * 1.2), 2));

  // Trade/easterly flow bends around the western Pacific anticyclone instead of remaining straight.
  a.u850 += -3.8 * tropical + 1.8 * warm * gaussian(lat, lon, 10, 112, 9, 18);
  a.v850 += 1.3 * warm * gaussian(lat, lon, 8, 118, 8, 20) - 1.6 * cool * gaussian(lat, lon, 20, 118, 12, 18);
  a.u500 += -2.8 * tropical + 4.0 * midlat + 7.5 * jetBand;
  a.v500 += 1.4 * Math.sin((lon - 115) * DEG * 2.1) * midlat;
  a.u200 += 2.0 * tropical + 13.0 * midlat + 23.0 * jetBand;
  a.v200 += 2.2 * Math.sin((lon - 108) * DEG * 2.0 + 0.4) * midlat;

  a.h500 += 5890 - Math.max(0, lat - 17) * 5.3 - Math.pow(Math.max(0, lat - 24), 1.45) * 0.52;
  a.h500 += 13 * Math.sin((lon - 122) * DEG * 1.4) * smooth((lat - 20) / 25);
  a.rh700 += 72 + 10 * warm * gaussian(lat, lon, 12, 138, 17, 30) - 12 * cool * smooth((lat - 20) / 30);
  a.slp += 1010 + 3.5 * cool * smooth((lat - 25) / 20) - 1.8 * warm * gaussian(lat, lon, 14, 135, 16, 30);

  a.score.lowLatEasterlies = clamp01((-a.u850 - 1) / 8) * smooth((24 - lat) / 18);
  a.score.midLatWesterlies = clamp01((a.u500 - 1) / 18) * smooth((lat - 22) / 20);
  a.score.westerlyJet = clamp01(jetBand * (0.65 + 0.35 * midlat));
}

function addRotatingVortex(
  a: FieldAccumulator,
  lat: number,
  lon: number,
  cLat: number,
  cLon: number,
  rLat: number,
  rLon: number,
  strength: number,
  levels: { l850?: number; l500?: number; l200?: number },
  clockwise: boolean,
  scoreKey?: SynopticFeatureKind
) {
  const g = gaussian(lat, lon, cLat, cLon, rLat, rLon);
  if (g < 0.003) return;
  const dx = (lon - cLon) / rLon;
  const dy = (lat - cLat) / rLat;
  const norm = Math.max(0.2, Math.hypot(dx, dy));
  const sign = clockwise ? 1 : -1;
  const u = sign * dy / norm * strength * g;
  const v = -sign * dx / norm * strength * g;
  a.u850 += u * (levels.l850 ?? 0);
  a.v850 += v * (levels.l850 ?? 0);
  a.u500 += u * (levels.l500 ?? 0);
  a.v500 += v * (levels.l500 ?? 0);
  a.u200 += u * (levels.l200 ?? 0);
  a.v200 += v * (levels.l200 ?? 0);
  if (scoreKey) a.score[scoreKey] = Math.max(a.score[scoreKey], clamp01(g * Math.abs(strength) / 9));
}

function addCurvedSubtropicalRidge(a: FieldAccumulator, lat: number, lon: number, hour: number, amplitude = 1, eastShift = 0, broken = 0) {
  const p = cyc(hour, 120);
  const phase = interpolateFiveDayPhase(hour);
  const pulse = (0.86 + 0.16 * Math.sin(p * Math.PI * 2 - 0.55)) * phase.ridge;
  const nodes = [
    { lon: 116 + eastShift + 3.0 * phaseSin(hour, 120, 0.4), lat: 29.0 + 1.8 * phaseSin(hour, 120, 0.2), amp: 0.58 },
    { lon: 128 + eastShift + 2.0 * phaseSin(hour, 120, 1.1), lat: 31.5 + 2.2 * phaseSin(hour, 120, 0.8), amp: 0.92 },
    { lon: 140 + eastShift + 1.6 * phaseSin(hour, 120, 1.8), lat: 30.0 + 2.0 * phaseSin(hour, 120, 1.5), amp: 1.0 },
    { lon: 151 + eastShift + 1.7 * phaseSin(hour, 120, 2.4), lat: 28.5 + 1.8 * phaseSin(hour, 120, 2.0), amp: 0.86 },
    { lon: 163 + eastShift + 1.4 * phaseSin(hour, 120, 2.9), lat: 27.0 + 1.6 * phaseSin(hour, 120, 2.5), amp: 0.62 }
  ];
  let ridge = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const gap = i === 1 || i === 2 ? (1 - 0.65 * broken) : 1;
    const g = gaussian(lat, lon, n.lat, n.lon, 5.0 + i * 0.3, 9.0);
    ridge += g * n.amp * gap;
    // Anticyclonic circulation differs by level; warm-core ridge weakens/reverses aloft.
    addRotatingVortex(a, lat, lon, n.lat, n.lon, 6.5, 11, 6.2 * amplitude * n.amp * pulse * gap,
      { l850: 0.78, l500: 1.0, l200: -0.16 }, true);
  }
  ridge = clamp01(ridge * 0.62);
  a.h500 += 48 * amplitude * pulse * ridge;
  a.rh700 -= 23 * amplitude * ridge;
  a.slp += 7.0 * amplitude * ridge;
  a.score.subtropicalHigh = Math.max(a.score.subtropicalHigh, ridge);
  a.score.tropicalHigh = Math.max(a.score.tropicalHigh, clamp01(ridge * 0.72));
}

function monsoonTroughLatitude(lon: number, hour: number, northShift = 0) {
  const wave = 2.4 * phaseSin(hour, 120, (lon - 112) * DEG * 2.7);
  const eastLift = 5.2 * smooth((lon - 114) / 18) * (1 - 0.70 * smooth((lon - 126) / 10));
  const eastRetreat = 2.6 * smooth((lon - 130) / 12);
  return 10.0 + northShift + eastLift - eastRetreat + wave;
}

function addMonsoonTrough(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1, northShift = 0) {
  strength *= interpolateFiveDayPhase(hour).monsoon;
  const curveLat = monsoonTroughLatitude(lon, hour, northShift);
  const d = Math.abs(lat - curveLat);
  const scsCore = gaussian(lat, lon, curveLat + 0.2, 114.5, 5.5, 10.0);
  const easternScs = gaussian(lat, lon, curveLat + 0.4, 119.5, 4.8, 6.0);
  const westPhil = gaussian(lat, lon, curveLat, 123.5, 5.2, 5.5);
  const eastPhilPenalty = gaussian(lat, lon, curveLat + 0.6, 136.0, 6.8, 18.0) * smooth((lon - 126.5) / 11.0);
  const maritimeContainment = smooth((lon - 100) / 14) * (1 - smooth((lon - 130) / 10));
  const regionalWeight = clamp01(
    0.54 * scsCore + 0.92 * easternScs + 0.36 * westPhil + 0.20 * maritimeContainment - 0.82 * eastPhilPenalty
  );
  const band = Math.exp(-Math.pow(d / 4.2, 2)) * smooth((lon - 100) / 18) * smooth((178 - lon) / 18) * regionalWeight;
  // ROUND110: never flip the low-level monsoon vector on one mathematical latitude.  The old
  // ternary switch generated a narrow speed seam / tongue where the two vector regimes met.  Use
  // a finite cross-axis transition so convergence is resolved over several grid cells instead.
  const crossAxis = smooth((lat - (curveLat - 1.35)) / 2.70);
  const southToNorth = 1 - 2 * crossAxis;
  const lowLevelZonalFactor = 1.0 * (1 - crossAxis) + (-0.18) * crossAxis;
  a.u850 += 4.8 * strength * band * lowLevelZonalFactor;
  a.v850 += 1.9 * strength * band * phaseSin(hour, 120, (lon - 108) * DEG * 3.1);
  a.u500 += 1.4 * strength * band * southToNorth;
  a.v500 += 1.0 * strength * band;
  a.rh700 += 17 * strength * band;
  a.slp -= 5.8 * strength * band;
  a.h500 -= 10 * strength * band;
  a.score.monsoonTrough = Math.max(a.score.monsoonTrough, clamp01(band * strength));
  a.score.monsoonFlow = Math.max(a.score.monsoonFlow, clamp01(band * strength * 0.95));
}

function addItcz(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1) {
  strength *= interpolateFiveDayPhase(hour).itcz;
  const target = 7.5 + 2.2 * phaseSin(hour, 120, (lon - 95) * DEG * 3.4);
  const band = Math.exp(-Math.pow((lat - target) / 2.8, 2));
  a.u850 += -1.9 * strength * band;
  // ROUND110: ITCZ convergence must also turn continuously across the axis. A binary north/south
  // v-wind switch paints a thin zonal discontinuity into high-resolution wind-speed products.
  const crossAxis = smooth((lat - (target - 1.10)) / 2.20);
  const meridionalFactor = 2.1 * (1 - crossAxis) + (-1.4) * crossAxis;
  a.v850 += meridionalFactor * strength * band;
  a.rh700 += 13 * strength * band;
  a.slp -= 2.2 * strength * band;
  a.score.itcz = Math.max(a.score.itcz, clamp01(band * strength));
}

function jetAxisLat(lon: number, hour: number, baseLat: number, waveAmp: number, eastPhase = 0) {
  return baseLat
    + waveAmp * phaseSin(hour, 120, (lon - 105) * DEG * 2.2 + eastPhase)
    + 1.8 * phaseSin(hour, 60, (lon - 115) * DEG * 5.1 + Math.PI);
}

function addMeanderingWesterlies(a: FieldAccumulator, lat: number, lon: number, hour: number, baseLat = 40, strength = 1, troughBoost = 1) {
  const phase = interpolateFiveDayPhase(hour);
  strength *= phase.jet;
  troughBoost *= phase.trough;
  const axis = jetAxisLat(lon, hour, baseLat, 4.2);
  const jet = Math.exp(-Math.pow((lat - axis) / 4.5, 2));
  const broad = smooth((lat - (axis - 11)) / 13);
  const speed = (8 + 25 * jet + 8 * broad) * strength;
  a.u200 += speed;
  a.u500 += speed * 0.52;
  a.u850 += speed * 0.18;
  const dAxisDLon = 0.17 * phaseCos(hour, 120, (lon - 105) * DEG * 2.2);
  a.v200 += speed * dAxisDLon * 0.62;
  a.v500 += speed * dAxisDLon * 0.42;
  a.score.westerlyJet = Math.max(a.score.westerlyJet, clamp01(jet * strength));
  a.score.midLatWesterlies = Math.max(a.score.midLatWesterlies, clamp01(broad * strength));

  // Progressive trough-ridge train, not a single sinusoidal wall.
  const troughLon = 124.5 + 11.5 * phaseSin(hour, 120, -Math.PI / 2) + 4 * phaseSin(hour, 60, 0.6);
  const ridgeLon = troughLon + 22;
  const trough = gaussian(lat, lon, axis - 1.5, troughLon, 10, 13) * troughBoost;
  const ridge = gaussian(lat, lon, axis - 0.5, ridgeLon, 9, 15);
  a.h500 -= 78 * strength * trough;
  a.h500 += 48 * strength * ridge;
  a.rh700 -= 12 * trough;
  addRotatingVortex(a, lat, lon, axis - 2, troughLon, 10, 13, 10 * strength * troughBoost,
    { l850: 0.24, l500: 0.78, l200: 1.0 }, false);
  addRotatingVortex(a, lat, lon, axis, ridgeLon, 9, 15, 7.5 * strength,
    { l850: 0.22, l500: 0.68, l200: 0.82 }, true);
  a.score.westerlyTrough = Math.max(a.score.westerlyTrough, clamp01(trough));
  a.score.westerlyRidge = Math.max(a.score.westerlyRidge, clamp01(ridge));
}

function addCrossEquatorialFlow(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1) {
  strength *= interpolateFiveDayPhase(hour).monsoon;
  const centers = [105, 123, 146];
  let score = 0;
  for (let i = 0; i < centers.length; i++) {
    const cLon = centers[i] + 2 * phaseSin(hour, 120, i * 1.4);
    const g = gaussian(lat, lon, 3.5, cLon, 8, 7);
    const northward = (5.0 + 1.5 * i) * strength * g;
    a.v850 += northward;
    // ROUND111: the cross-equatorial inflow used to flip its zonal component at lon===cLon.
    // At 0.10° resolution that mathematical longitude can survive all the way to a vertical blue/
    // green seam beside a cyclone. Turn continuously across a ~3° corridor instead.
    const eastTurn = smooth((lon - (cLon - 1.5)) / 3.0);
    const zonal = -0.5 * (1 - eastTurn) + 2.2 * eastTurn;
    a.u850 += zonal * strength * g;
    score = Math.max(score, g * strength);
  }
  a.score.crossEquatorialFlow = Math.max(a.score.crossEquatorialFlow, clamp01(score));
}

function addContinentalHigh(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1) {
  const cLat = 40 + 2 * phaseCos(hour, 120, 0.2);
  const cLon = 104 + 7 * phaseSin(hour, 120, 0.5);
  const g = gaussian(lat, lon, cLat, cLon, 16, 21);
  a.slp += 18 * strength * g;
  a.h500 += 26 * strength * g;
  a.rh700 -= 31 * strength * gaussian(lat, lon, cLat - 8, cLon + 10, 18, 24);
  addRotatingVortex(a, lat, lon, cLat, cLon, 16, 21, 8.0 * strength, { l850: 1.0, l500: 0.35, l200: 0.05 }, true);
  // South/east flank northeasterly surge.
  const surge = gaussian(lat, lon, 20, 118, 15, 18) * strength;
  a.u850 -= 5.0 * surge;
  a.v850 -= 4.0 * surge;
  a.score.continentalHigh = Math.max(a.score.continentalHigh, clamp01(g * strength));
  a.score.dryAir = Math.max(a.score.dryAir, clamp01(surge * 0.9));
}

function addUpperColdLow(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1, cutoff = false) {
  strength *= interpolateFiveDayPhase(hour).upperLow;
  const cLat = (cutoff ? 31 : 24) + 2.2 * phaseSin(hour, 120, cutoff ? 1.2 : 0.4);
  const cLon = (cutoff ? 132 : 146) + 5 * phaseSin(hour, 120, 1.0) + 2.5 * phaseSin(hour, 60, 0.7);
  const g = gaussian(lat, lon, cLat, cLon, cutoff ? 7 : 8, cutoff ? 9 : 11);
  a.h500 -= (cutoff ? 70 : 42) * strength * g;
  a.rh700 -= (cutoff ? 18 : 26) * strength * gaussian(lat, lon, cLat - 1, cLon - 4, 9, 12);
  addRotatingVortex(a, lat, lon, cLat, cLon, 8, 11, 13 * strength, { l850: 0.08, l500: 0.52, l200: 1.0 }, false,
    cutoff ? "cutoffLow" : "upperColdLow");
  a.score.dryAir = Math.max(a.score.dryAir, clamp01(g * strength * 0.82));
}

function addMonsoonLow(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1, cLon0 = 136) {
  strength *= interpolateFiveDayPhase(hour).monsoon;
  const cLat = 15 + 2.8 * phaseSin(hour, 120, 0.3);
  const cLon = cLon0 - 4 + 4 * phaseSin(hour, 120, 1.6) + 3 * phaseSin(hour, 60, 1.0);
  const g = gaussian(lat, lon, cLat, cLon, 7.5, 9.5);
  a.slp -= 9.5 * strength * g;
  a.h500 -= 20 * strength * g;
  a.rh700 += 16 * strength * g;
  addRotatingVortex(a, lat, lon, cLat, cLon, 7.5, 9.5, 7.2 * strength, { l850: 1.0, l500: 0.58, l200: -0.08 }, false, "monsoonLow");
}

function addTropicalUpperHigh(a: FieldAccumulator, lat: number, lon: number, hour: number, strength = 1) {
  const cLat = 18 + 2 * phaseSin(hour, 120, 0.6);
  const cLon = 139 + 6 * phaseSin(hour, 120, 1.4);
  const g = gaussian(lat, lon, cLat, cLon, 11, 18);
  addRotatingVortex(a, lat, lon, cLat, cLon, 11, 18, 9.5 * strength, { l850: 0.02, l500: 0.12, l200: 1.0 }, true);
  a.score.tropicalHigh = Math.max(a.score.tropicalHigh, clamp01(g * strength));
}

function seasonalMonsoonLatitudeShift(config: SimulationConfig): number {
  const names = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const idx = names.indexOf(String(config.shearPreset || "july").toLowerCase());
  const month = idx >= 0 ? idx + 1 : 7;
  // Northernmost around Jul-Aug, equatorward in boreal winter.
  return 4.1 * Math.cos(((month - 8) / 12) * Math.PI * 2);
}

function applyAtmosPreset(a: FieldAccumulator, preset: SynopticAtmosPresetId, lat: number, lon: number, hour: number, seasonalMonsoonShift = 0) {
  switch (preset) {
    case "recurvature_trough":
      addClimatology(a, lat, lon, hour, "warm");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 0.95, 11.5 - 4.5 * phaseCos(hour, 120), 0.75);
      addMonsoonTrough(a, lat, lon, hour, 0.8, 2 + seasonalMonsoonShift);
      addItcz(a, lat, lon, hour, 0.75);
      addMeanderingWesterlies(a, lat, lon, hour, 36, 1.18, 1.35);
      addUpperColdLow(a, lat, lon, hour, 0.55, false);
      addTropicalUpperHigh(a, lat, lon, hour, 0.75);
      break;
    case "monsoon_gyre":
      addClimatology(a, lat, lon, hour, "warm");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 0.72, 8, 0.38);
      addMonsoonTrough(a, lat, lon, hour, 1.28, 3.5 + seasonalMonsoonShift);
      addMonsoonLow(a, lat, lon, hour, 1.35, 130);
      addMonsoonLow(a, lat, lon, hour + 34, 0.72, 150);
      addCrossEquatorialFlow(a, lat, lon, hour, 1.25);
      addItcz(a, lat, lon, hour, 1.15);
      addMeanderingWesterlies(a, lat, lon, hour, 44, 0.72, 0.62);
      addTropicalUpperHigh(a, lat, lon, hour, 1.0);
      break;
    case "cutoff_cold_low":
      addClimatology(a, lat, lon, hour, "warm");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 0.82, 4, 0.48);
      addMonsoonTrough(a, lat, lon, hour, 0.9, 1 + seasonalMonsoonShift);
      addItcz(a, lat, lon, hour, 0.85);
      addMeanderingWesterlies(a, lat, lon, hour, 39, 0.98, 0.9);
      addUpperColdLow(a, lat, lon, hour, 1.35, true);
      addUpperColdLow(a, lat, lon, hour + 23, 1.0, false);
      addTropicalUpperHigh(a, lat, lon, hour, 0.82);
      break;
    case "continental_surge":
      addClimatology(a, lat, lon, hour, "cool");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 0.72, 11, 0.22);
      addContinentalHigh(a, lat, lon, hour, 1.25);
      addMeanderingWesterlies(a, lat, lon, hour, 29, 1.34, 1.1);
      addItcz(a, lat, lon, hour, 0.7);
      addUpperColdLow(a, lat, lon, hour, 0.6, false);
      break;
    case "equatorial_crossflow":
      addClimatology(a, lat, lon, hour, "transition");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 0.83, 5, 0.18);
      addCrossEquatorialFlow(a, lat, lon, hour, 1.45);
      addMonsoonTrough(a, lat, lon, hour, 1.05, -1.5 + seasonalMonsoonShift);
      addMonsoonLow(a, lat, lon, hour, 0.72, 142);
      addItcz(a, lat, lon, hour, 1.35);
      addMeanderingWesterlies(a, lat, lon, hour, 38, 0.88, 0.8);
      break;
    case "wnp_monsoon_ridge":
    default:
      addClimatology(a, lat, lon, hour, "warm");
      addCurvedSubtropicalRidge(a, lat, lon, hour, 1.0, 0, 0.18);
      addMonsoonTrough(a, lat, lon, hour, 1.0, 2.0 + seasonalMonsoonShift);
      addMonsoonLow(a, lat, lon, hour, 0.72, 148);
      addCrossEquatorialFlow(a, lat, lon, hour, 0.9);
      addItcz(a, lat, lon, hour, 0.9);
      addMeanderingWesterlies(a, lat, lon, hour, 42, 0.92, 0.82);
      addUpperColdLow(a, lat, lon, hour, 0.52, false);
      addTropicalUpperHigh(a, lat, lon, hour, 0.95);
      break;
  }
}

/**
 * Offline 10-day typical ventilation database at 6 h cadence. Values are normalized typical
 * episode amplitudes, not a live analysis. Interpolation is continuous, so no six-hour jumps are
 * visible in either the map or the intensity calculation. 41 samples close the 240 h cycle.
 */
export const DRY_SHEAR_10D_KEYFRAMES: ReadonlyArray<{ dry: number; shear: number; lon: number; lat: number }> = [
  {dry:.30,shear:.34,lon:116,lat:26},{dry:.36,shear:.35,lon:117,lat:26},{dry:.46,shear:.38,lon:118,lat:27},{dry:.58,shear:.43,lon:119,lat:27},
  {dry:.70,shear:.50,lon:120,lat:28},{dry:.80,shear:.60,lon:121,lat:28},{dry:.86,shear:.72,lon:122,lat:29},{dry:.83,shear:.84,lon:123,lat:29},
  {dry:.75,shear:.92,lon:124,lat:29},{dry:.63,shear:.96,lon:126,lat:30},{dry:.50,shear:.91,lon:127,lat:30},{dry:.39,shear:.82,lon:128,lat:30},
  {dry:.31,shear:.70,lon:130,lat:30},{dry:.27,shear:.58,lon:131,lat:30},{dry:.29,shear:.48,lon:132,lat:29},{dry:.36,shear:.42,lon:133,lat:29},
  {dry:.47,shear:.40,lon:134,lat:29},{dry:.60,shear:.44,lon:135,lat:28},{dry:.71,shear:.52,lon:136,lat:28},{dry:.78,shear:.63,lon:137,lat:28},
  {dry:.76,shear:.74,lon:138,lat:27},{dry:.68,shear:.82,lon:139,lat:27},{dry:.56,shear:.86,lon:140,lat:27},{dry:.44,shear:.82,lon:141,lat:27},
  {dry:.34,shear:.72,lon:142,lat:26},{dry:.28,shear:.60,lon:143,lat:26},{dry:.26,shear:.49,lon:144,lat:26},{dry:.31,shear:.42,lon:145,lat:26},
  {dry:.42,shear:.39,lon:145,lat:26},{dry:.56,shear:.43,lon:144,lat:27},{dry:.69,shear:.51,lon:143,lat:27},{dry:.78,shear:.62,lon:141,lat:27},
  {dry:.82,shear:.73,lon:139,lat:28},{dry:.78,shear:.82,lon:136,lat:28},{dry:.68,shear:.88,lon:133,lat:28},{dry:.55,shear:.85,lon:130,lat:28},
  {dry:.43,shear:.75,lon:126,lat:27},{dry:.34,shear:.62,lon:122,lat:27},{dry:.29,shear:.50,lon:119,lat:26},{dry:.28,shear:.40,lon:117,lat:26},
  {dry:.30,shear:.34,lon:116,lat:26}
];

function interpolateTenDayVentilation(hour: number) {
  const h = ((hour % 240) + 240) % 240;
  const f = h / 6;
  const i0 = Math.floor(f) % 40;
  const i1 = (i0 + 1) % 40;
  const t = smooth(f - Math.floor(f));
  const a = DRY_SHEAR_10D_KEYFRAMES[i0];
  const b = DRY_SHEAR_10D_KEYFRAMES[i1];
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return { dry: lerp(a.dry, b.dry), shear: lerp(a.shear, b.shear), lon: lerp(a.lon, b.lon), lat: lerp(a.lat, b.lat) };
}

/** 10-day dry-air/shear database, evaluated continuously between six-hour keyframes. */
function applyTenDayDryShearCycle(a: FieldAccumulator, lat: number, lon: number, hour: number, preset: SynopticAtmosPresetId) {
  const k = interpolateTenDayVentilation(hour);
  const dryLat = preset === "continental_surge" ? k.lat - 6.5 : k.lat;
  const dry = gaussian(lat, lon, dryLat, k.lon, 12, 17) * (0.25 + 0.75 * k.dry);
  a.rh700 -= (preset === "continental_surge" ? 26 : 15) * dry;
  a.score.dryAir = Math.max(a.score.dryAir, clamp01(dry));

  // Upper-flow acceleration lags and sits poleward/eastward of the dry tongue, as is typical of
  // ventilation by a TUTT / mid-latitude trough. The separate keyframe series prevents a fixed
  // one-to-one dry-air/shear relationship.
  const shearBand = gaussian(lat, lon, dryLat + 3.2, k.lon + 8.0, 11, 20) * (0.22 + 0.78 * k.shear);
  a.u200 += 8.2 * shearBand;
  a.v200 += 4.4 * shearBand * Math.sin((lon - k.lon) * DEG * 3.0 + 0.5);
}

function quantizeQuarterDegree(x: number): number {
  return Math.round(x * 4) / 4;
}

function baseDetailedSstCell(lat: number, lon: number, lateSeason: boolean): number {
  let t = 29.45;

  // Basin-scale meridional gradient with a broad tropical warm pool rather than one pivot line.
  const north = Math.max(0, lat - 18);
  t -= 0.115 * north + 0.0115 * north * north;
  t -= 0.035 * Math.max(0, 8 - lat);

  // Detailed regional anomaly database.  Each cell samples all named basins/shelves/fronts;
  // smooth Gaussian footprints avoid polygon-edge discontinuities while preserving geographic
  // structure well below the old one-gradient model.
  for (const region of SYNOPTIC_OCEAN_REGION_DATABASE) {
    t += region.sstDelta * gaussian(lat, lon, region.lat, region.lon, region.rLat, region.rLon);
  }

  // Kuroshio warm tongue follows a curved current path from Luzon east of Taiwan toward Japan.
  const kuroLon = lat < 25 ? 122.5 + (lat - 18) * 0.38 : 125.2 + (lat - 25) * 1.18;
  t += 1.05 * Math.exp(-Math.pow((lon - kuroLon) / 2.1, 2)) * Math.exp(-Math.pow((lat - 27) / 12, 2));

  // Small-scale marginal-sea texture is deterministic and is sampled on the same logical grid.
  t += 0.12 * Math.sin((lon - 100) * DEG * 8.5) * Math.cos((lat - 10) * DEG * 7.0) * Math.exp(-Math.pow((lat - 18) / 25, 2));

  if (lateSeason) {
    const gate = smooth((lat - 20) / 18);
    t -= 2.2 * gate + 0.8 * gaussian(lat, lon, 30, 130, 8, 20);
  }
  return clamp(t, 8, 31.8);
}

function baseDetailedSst(lat: number, lon: number, lateSeason: boolean): number {
  // The embedded climatological field is defined on a 0.25° logical grid.  Bilinear interpolation
  // removes block edges without inventing a different source resolution.
  const y0 = Math.floor(lat * 4) / 4;
  const x0 = Math.floor(lon * 4) / 4;
  const fy = clamp01((lat - y0) * 4);
  const fx = clamp01((lon - x0) * 4);
  const t00 = baseDetailedSstCell(y0, x0, lateSeason);
  const t10 = baseDetailedSstCell(y0, x0 + 0.25, lateSeason);
  const t01 = baseDetailedSstCell(y0 + 0.25, x0, lateSeason);
  const t11 = baseDetailedSstCell(y0 + 0.25, x0 + 0.25, lateSeason);
  const south = t00 + (t10 - t00) * fx;
  const north = t01 + (t11 - t01) * fx;
  return south + (north - south) * fy;
}

function oceanAnomaly(lat: number, lon: number, hour: number, preset: SynopticOceanPresetId, scale: number) {
  let sst = 0;
  let ohc = 0;
  const eddies = [
    { lat: 19 + 2.0 * phaseSin(hour, 120, 0.2), lon: 132.5 + 4.5 * phaseSin(hour, 120, -Math.PI / 2), sign: 1, amp: 0.65 },
    { lat: 22 + 1.5 * phaseSin(hour, 120, 1.1), lon: 134.5 + 3.5 * phaseSin(hour, 120, Math.PI / 2), sign: -1, amp: 0.62 },
    { lat: 28 + 1.2 * phaseSin(hour, 120, 2.0), lon: 135.5 + 2.5 * phaseSin(hour, 120, -Math.PI / 2), sign: 1, amp: 0.48 },
    { lat: 16 + 1.0 * phaseSin(hour, 120, 2.7), lon: 151 + 3 * phaseSin(hour, 120, Math.PI / 2), sign: -1, amp: 0.42 }
  ];
  for (const e of eddies) {
    const g = gaussian(lat, lon, e.lat, e.lon, 2.8, 3.4);
    sst += e.sign * e.amp * g;
    ohc += e.sign * e.amp * 28 * g;
  }
  if (preset === "warm_pool_deep") {
    const g = gaussian(lat, lon, 14.5, 139 + 3 * phaseSin(hour, 120, 0.5), 9, 16);
    sst += 0.65 * g;
    ohc += 55 * g;
  } else if (preset === "kuroshio_front") {
    const meander = 1.1 * phaseSin(hour, 120, 0.6);
    const kuroLon = lat < 25 ? 122.7 + (lat - 18) * 0.42 + meander : 125.6 + (lat - 25) * 1.12 + meander;
    const g = Math.exp(-Math.pow((lon - kuroLon) / 1.6, 2)) * Math.exp(-Math.pow((lat - 29) / 12, 2));
    sst += 0.75 * g;
    ohc += 38 * g;
  } else if (preset === "cold_wake_mixed") {
    const wakeLon = 132 + 6 * phaseSin(hour, 120, -Math.PI / 2);
    const wakeLat = 22.5 + 4.5 * phaseSin(hour, 120, -Math.PI / 2 + 0.45);
    const g = gaussian(lat, lon, wakeLat, wakeLon, 3.0, 7.5);
    sst -= 1.1 * g;
    ohc -= 52 * g;
  } else if (preset === "late_season_front") {
    const frontLat = 27 + 1.6 * phaseSin(hour, 120, 0.8) + 1.2 * Math.sin((lon - 120) * DEG * 3.0);
    const north = smooth((lat - frontLat) / 7);
    sst -= 1.6 * north;
    ohc -= 32 * north;
  }
  return { sst: sst * scale, ohc: ohc * scale };
}

export function getSynopticOceanState(lat: number, lon: number, config: SimulationConfig, simHour = 0): { sst: number; ohc: number } {
  const hour = effectiveOceanHour(config, simHour);
  const cacheKey = oceanCacheKey(lat, lon, config, hour);
  const cached = oceanCache.get(cacheKey);
  if (cached) return cached;
  const preset = (config.newOceanPreset || "wnp_climatology_mesoscale") as SynopticOceanPresetId;
  const lateSeason = preset === "late_season_front";
  let sst = baseDetailedSst(lat, lon, lateSeason);
  const mesoscaleScale = clamp(config.newOceanMesoscaleScale ?? 1, 0, 2.5);
  const anomaly = oceanAnomaly(lat, lon, hour, preset, mesoscaleScale);
  sst += anomaly.sst + clamp(config.newOceanSstBias ?? 0, -4, 4);

  // OHC follows upper-ocean thermal structure rather than a single SST multiplier.
  const warmPool = gaussian(lat, lon, 14, 140, 11, 22);
  const kuroshio = gaussian(lat, lon, 26, 127.5, 12, 6);
  const shelf = Math.max(
    gaussian(lat, lon, 31, 123, 8, 7),
    gaussian(lat, lon, 20, 113, 8, 10)
  );
  const regionalOhc = SYNOPTIC_OCEAN_REGION_DATABASE.reduce((sum, region) =>
    sum + region.ohcDelta * gaussian(lat, lon, region.lat, region.lon, region.rLat, region.rLon), 0);
  // Shallow marginal seas still mix more efficiently than the open Pacific, but warm-season East
  // China Sea / South China Sea waters can sustain an intense typhoon when SST is high and the
  // storm keeps moving. The former -24 shelf term made their OHC unrealistically collapse and
  // created a de-facto ~50-55 m/s ceiling. Keep a modest shelf penalty and restore observed warm
  // pools continuously (no hard regional intensity cap/floor).
  const warmSeaGate = smooth((sst - 27.8) / 1.8);
  const southChinaWarmPool = gaussian(lat, lon, 16.5, 114.5, 8.5, 9.5);
  const eastChinaKuroshioSupport = gaussian(lat, lon, 27.0, 125.5, 8.0, 6.5);
  let ohc = Math.max(0,
    (sst - 25.2) * 25 + 44 * warmPool + 22 * kuroshio - 6 * shelf + regionalOhc + anomaly.ohc +
    warmSeaGate * (24 * southChinaWarmPool + 20 * eastChinaKuroshioSupport)
  );
  ohc *= clamp(config.newOceanOhcScale ?? 1, 0, 2.5);
  const result = { sst: clamp(sst, 8, 33), ohc: clamp(ohc, 0, 245) };
  boundedSet(oceanCache, cacheKey, result);
  return result;
}

export function getSynopticAtmosState(lat: number, lon: number, config: SimulationConfig, simHour = 0): Omit<SynopticEnvironmentState, "sst" | "ohc"> {
  const hour = effectiveAtmosHour(config, simHour);
  const cacheKey = atmosphereCacheKey(lat, lon, config, hour);
  const cached = atmosCache.get(cacheKey);
  if (cached) return cached;
  const preset = (config.newAtmosPreset || "wnp_monsoon_ridge") as SynopticAtmosPresetId;
  const a: FieldAccumulator = { u850: 0, v850: 0, u500: 0, v500: 0, u200: 0, v200: 0, h500: 0, rh700: 0, slp: 0, score: emptyScores() };
  applyAtmosPreset(a, preset, lat, lon, hour, seasonalMonsoonLatitudeShift(config));
  applyTenDayDryShearCycle(a, lat, lon, hour, preset);

  const anomalyScale = clamp(config.newAtmosAnomalyScale ?? 1, 0.25, 2.25);
  // Blend anomaly scaling around a stable climatological range rather than multiplying absolute heights.
  a.u850 *= anomalyScale; a.v850 *= anomalyScale;
  a.u500 *= anomalyScale; a.v500 *= anomalyScale;
  a.u200 *= anomalyScale; a.v200 *= anomalyScale;
  a.h500 = 5750 + (a.h500 - 5750) * (0.78 + 0.22 * anomalyScale);
  a.slp = 1010 + (a.slp - 1010) * anomalyScale;
  a.rh700 = 68 + (a.rh700 - 68) * (0.8 + 0.2 * anomalyScale) + (config.newAtmosHumidityBias ?? 0);

  const shearU = a.u200 - a.u850;
  const shearV = a.v200 - a.v850;
  // Environmental 200–850-hPa shear is expressed in knots. Extremely large raw vector
  // differences can occur inside an idealized jet/cutoff overlap; cap the diagnostic at 85 kt so
  // those rare overlaps remain a "very hostile" environment rather than numerically dominating
  // intensity equations that were calibrated for operational tropical-cyclone shear ranges.
  const shear = clamp(Math.hypot(shearU, shearV) * 1.943844 * clamp(config.newAtmosShearScale ?? 1, 0.25, 2.5), 0, 85);
  const meanU = a.u850 * 0.24 + a.u500 * 0.51 + a.u200 * 0.25;
  const meanV = a.v850 * 0.24 + a.v500 * 0.51 + a.v200 * 0.25;
  a.score.windShear = clamp01((shear - 12) / 34);
  a.score.meanFlow = clamp01(Math.hypot(meanU, meanV) / 18);
  a.score.dryAir = Math.max(a.score.dryAir, clamp01((58 - a.rh700) / 28));
  a.score.betaEffect = clamp01((lat - 4) / 28);

  const result = {
    u850: a.u850, v850: a.v850, u500: a.u500, v500: a.v500, u200: a.u200, v200: a.v200,
    h500: clamp(a.h500, 5200, 6000), rh700: clamp(a.rh700, 15, 98), slp: clamp(a.slp, 970, 1045),
    shear, shearU, shearV, meanU, meanV, scores: a.score
  };
  boundedSet(atmosCache, cacheKey, result);
  return result;
}

export function getSynopticEnvironmentState(lat: number, lon: number, config: SimulationConfig, simHour = 0): SynopticEnvironmentState {
  const atmosphere = getSynopticAtmosState(lat, lon, config, simHour);
  const ocean = getSynopticOceanState(lat, lon, config, simHour);
  return { ...atmosphere, ...ocean };
}

export function getSynopticWind(level: 850 | 500 | 200, lat: number, lon: number, config: SimulationConfig, simHour = 0) {
  const s = getSynopticAtmosState(lat, lon, config, simHour);
  if (level === 850) return { u: s.u850, v: s.v850 };
  if (level === 500) return { u: s.u500, v: s.v500 };
  return { u: s.u200, v: s.v200 };
}

/**
 * New-system forecast steering. Stronger cyclones sample a deeper layer; weaker systems sample
 * more low/mid-level flow. A conventional beta propagation component is kept separate so it can
 * be visualized and disabled by the existing beta toggle.
 */
export function getSynopticSteering(lat: number, lon: number, vmax: number, config: SimulationConfig, simHour = 0) {
  // 4.1.2: steering is a broad deep-layer environmental quantity, not the wind at one grid
  // point. A single-point sample can sit on the flank of an idealized cutoff/gyre and rotate
  // rapidly as the cyclone moves a few tenths of a degree, producing the tight loops seen in
  // 3.7.8. Average a roughly 350-450 km radius stencil before applying vortex-depth weights.
  // This represents the deep-layer environmental flow seen by a TC-sized vortex rather than the
  // circulation of an idealized monsoon-low/cutoff center itself.
  const deep = smooth((vmax - 17) / 38);
  const w850 = 0.48 - 0.29 * deep;
  const w500 = 0.52 - 0.02 * deep;
  const w200 = 1 - w850 - w500;
  const scale = clamp(config.newAtmosSteeringScale ?? 1, 0, 2.0);
  const radiusLat = 3.15 + 0.85 * deep;
  const lonScale = Math.max(0.32, Math.cos(clamp(lat, -60, 60) * DEG));
  const radiusLon = radiusLat / lonScale;
  const samples: Array<[number, number, number]> = [
    [0, 0, 0.16],
    [ radiusLat, 0, 0.12], [-radiusLat, 0, 0.12],
    [0,  radiusLon, 0.12], [0, -radiusLon, 0.12],
    [ radiusLat * 0.72,  radiusLon * 0.72, 0.09],
    [ radiusLat * 0.72, -radiusLon * 0.72, 0.09],
    [-radiusLat * 0.72,  radiusLon * 0.72, 0.09],
    [-radiusLat * 0.72, -radiusLon * 0.72, 0.09]
  ];

  let broadU = 0, broadV = 0;
  let jetScore = 0, meanFlowScore = 0, gyreScore = 0;
  for (const [dLat, dLon, weight] of samples) {
    const p = getSynopticAtmosState(
      clamp(lat + dLat, -68, 68),
      ((lon + dLon + 540) % 360) - 180,
      config,
      simHour
    );
    broadU += weight * (p.u850 * w850 + p.u500 * w500 + p.u200 * w200);
    broadV += weight * (p.v850 * w850 + p.v500 * w500 + p.v200 * w200);
    jetScore += weight * Math.max(p.scores.westerlyJet, p.scores.midLatWesterlies);
    meanFlowScore += weight * p.scores.meanFlow;
    gyreScore += weight * Math.max(p.scores.monsoonLow, p.scores.cutoffLow, p.scores.upperColdLow * 0.75);
  }

  let u = broadU * scale;
  let v = broadV * scale;
  // Bound only the magnitude of the background environmental flow. This preserves recurvature
  // while preventing a compact synthetic anomaly from acting like a second tropical vortex.
  const steerCap = 11.0 + 9.0 * clamp01(jetScore) + 3.0 * clamp01(meanFlowScore) - 1.8 * clamp01(gyreScore);
  const broadMag = Math.hypot(u, v);
  if (broadMag > steerCap && broadMag > 0) {
    u *= steerCap / broadMag;
    v *= steerCap / broadMag;
  }

  if (config.betaDriftEnabled) {
    const betaScale = config.betaDriftScale ?? 1;
    const sizeProxy = clamp((vmax * 5.8 + 30) / 250, 0.3, 2);
    const latFactor = 0.85 + 0.45 * Math.sin(clamp(lat, 0, 55) * DEG);
    u += -0.55 * betaScale * sizeProxy * latFactor;
    v += 0.72 * betaScale * sizeProxy * latFactor;
  }
  return { u, v };
}

/**
 * Live/manual mode exception requested for 3.7.8: only the synoptic westerly component may alter
 * user-operated motion. Other new steering components are reserved for forecast/automatic paths.
 */
export function getSynopticWesterlyLiveContribution(lat: number, lon: number, config: SimulationConfig, simHour = 0) {
  const s = getSynopticAtmosState(lat, lon, config, simHour);
  const score = Math.max(s.scores.westerlyJet, s.scores.midLatWesterlies, s.scores.westerlyTrough * 0.7);
  const gate = smooth((score - 0.16) / 0.58);
  return { u: Math.max(0, s.meanU) * gate, v: s.meanV * gate * 0.72 };
}

export function getSynopticFeatureScore(kind: SynopticFeatureKind, lat: number, lon: number, config: SimulationConfig, simHour = 0) {
  return getSynopticAtmosState(lat, lon, config, simHour).scores[kind];
}

export function getSynopticCycleLabel(config: SimulationConfig, simHour: number, ocean = false) {
  const h = ocean ? effectiveOceanHour(config, simHour) : effectiveAtmosHour(config, simHour);
  const period = ocean ? 120 : 120;
  const p = ((h % period) + period) % period;
  return `${Math.floor(p / 24) + 1}日 ${String(Math.floor(p % 24)).padStart(2, "0")}:00`;
}
