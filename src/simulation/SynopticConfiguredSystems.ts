import type { SimulationConfig } from "../types";

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};
const gaussian01 = (lat: number, lon: number, cLat: number, cLon: number, rLat: number, rLon: number) => {
  const dy = (lat - cLat) / Math.max(1e-6, rLat);
  const dx = wrapDeltaLon(lon, cLon) / Math.max(1e-6, rLon);
  return Math.exp(-(dy * dy + dx * dx));
};
const summerMonsoonRegionalWeight = (lat: number, lon: number, month: number) => {
  const m = clamp(month, 1, 12);
  const annual = Math.cos(((m - 8) / 12) * Math.PI * 2);
  const summer = smooth01((annual + 0.18) / 1.18);
  if (summer <= 0.001) return 1;
  const scsBasin = gaussian01(lat, lon, 14.0, 114.5, 6.2, 10.5);
  const easternScs = gaussian01(lat, lon, 16.0, 119.5, 4.8, 5.0);
  const westPhilPassage = gaussian01(lat, lon, 16.5, 123.0, 5.5, 5.5);
  const eastPhilPenalty = gaussian01(lat, lon, 17.0, 136.0, 7.0, 18.0) * smooth01((lon - 126.5) / 11.0);
  const containment = smooth01((lon - 101.0) / 10.0) * (1 - smooth01((lon - 129.5) / 9.0))
    * smooth01((lat - 4.5) / 5.0) * (1 - smooth01((lat - 25.0) / 6.5));
  const summerFootprint = clamp(
    0.55 * scsBasin + 0.95 * easternScs + 0.38 * westPhilPassage + 0.22 * containment - 0.85 * eastPhilPenalty,
    0,
    1
  );
  return clamp((1 - summer) + summer * summerFootprint, 0, 1);
};

function wrapDeltaLon(lon: number, center: number) {
  let d = lon - center;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export interface ConfiguredSystemSurfaceState {
  u10: number;
  v10: number;
  pressureHpa: number;
  subtropicalHigh: number;
  westerly: number;
  westerlyTrough: number;
  monsoon: number;
}

/**
 * Product-side projection of the user-configurable large-scale systems onto 10 m wind / MSLP.
 * This keeps the wind/pressure product responsive when the user moves or changes the subtropical
 * high, westerlies or monsoon controls, without replacing the continuously resolved background
 * environment. All shapes are smooth and geographic-box free.
 */
export function getConfiguredSystemSurfaceState(
  lat: number,
  lon: number,
  config: SimulationConfig,
  month: number,
  simHour: number
): ConfiguredSystemSurfaceState {
  let u10 = 0;
  let v10 = 0;
  let pressureHpa = 0;
  let subtropicalHigh = 0;
  let westerly = 0;
  let westerlyTrough = 0;
  let monsoon = 0;

  if (config.subtropicalHighEnabled !== false && Number(config.subtropicalHighStrength ?? 1) > 0) {
    const strength = clamp(Number(config.subtropicalHighStrength ?? 1), 0, 2.2);
    const cLat = Number(config.subtropicalHighLat ?? 28);
    const cLon = Number(config.subtropicalHighLon ?? 135);
    const west = Number(config.subtropicalHighWestExtent ?? 118);
    const ns = clamp(Number(config.subtropicalHighNSSize ?? 1), 0.5, 2.2);
    const ew = clamp(Number(config.subtropicalHighEWSize ?? 1), 0.5, 2.2);
    const ridgeLon = lon >= west && lon <= cLon ? lon : (lon < west ? west : cLon);
    const dLon = wrapDeltaLon(lon, ridgeLon) / (13.5 * ew);
    const dLat = (lat - cLat) / (6.2 * ns);
    const r = Math.hypot(dLon, dLat);
    const core = Math.exp(-(r * r) * 0.72);
    const ring = r * Math.exp(1 - r) * Math.exp(-Math.max(0, r - 2.6) * 0.8);
    subtropicalHigh = clamp(core * strength / 1.35, 0, 1);
    const speed = 5.3 * strength * ring;
    const norm = Math.max(0.16, r);
    // NH anticyclone: clockwise. The ridge segment itself is allowed a weak calm core.
    u10 += (dLat / norm) * speed;
    v10 += -(dLon / norm) * speed;
    pressureHpa += 5.2 * strength * core;
  }

  if (config.westerliesEnabled !== false && Number(config.westerliesStrength ?? 1) > 0) {
    const strength = clamp(Number(config.westerliesStrength ?? 1), 0, 2.2);
    const axisBase = Number(config.westerliesLat ?? 38);
    const troughLon = Number(config.westerliesTroughLon ?? 120);
    const troughDepth = clamp(Number(config.westerliesTroughDepth ?? 1), 0, 2.2);
    const meander = 2.3 * Math.sin((wrapDeltaLon(lon, troughLon) * 0.085 + simHour * 0.018));
    const axis = axisBase + meander;
    const jet = Math.exp(-Math.pow((lat - axis) / 5.6, 2));
    const broad = smooth01((lat - (axis - 11)) / 13);
    const troughWave = Math.sin(wrapDeltaLon(lon, troughLon) * DEG * 2.6)
      * Math.exp(-Math.pow((lat - axis) / 8.0, 2));
    const speedWave = clamp(
      0.84
      + 0.16 * Math.sin((wrapDeltaLon(lon, troughLon) * 1.7 + simHour * 0.11) * DEG)
      + 0.08 * Math.sin((wrapDeltaLon(lon, troughLon) * 4.1 - simHour * 0.07) * DEG),
      0.62,
      1.12
    );
    westerly = clamp((0.72 * jet + 0.42 * broad) * strength, 0, 1);
    westerlyTrough = clamp(Math.abs(troughWave) * troughDepth * strength, 0, 1);
    // The configured westerly control steers direction and establishes streaks; it is deliberately
    // not a second large speed boost on top of the environmental target. This keeps typical belt
    // means near 17-22 kt while preserving local faster/slower filaments.
    u10 += (0.45 * broad + 1.85 * jet) * strength * speedWave;
    v10 += 1.55 * troughWave * troughDepth * strength;
    pressureHpa += -3.0 * troughWave * troughDepth * strength;
  }

  if (config.monsoonTroughEnabled) {
    const m = clamp(month, 1, 12);
    // Seasonal migration: the summer SW-monsoon axis should focus over the central/eastern South
    // China Sea, then weaken east of the Philippines instead of forming a broad summer gale belt
    // over the open Philippine Sea.
    const annual = Math.cos(((m - 8) / 12) * Math.PI * 2);
    const eastLift = 2.6 * smooth01((lon - 110) / 18) * (1 - 0.72 * smooth01((lon - 126) / 10));
    const eastRetreat = 1.4 * smooth01((lon - 128) / 10);
    const axis = 10.2 + 4.2 * annual + eastLift - eastRetreat
      + 1.0 * Math.sin((lon - 118) * DEG * 1.8 + simHour * 0.010);
    const summerWeight = smooth01((annual + 0.18) / 1.18);
    const winterWeight = 1 - summerWeight;
    const regionalWeight = summerMonsoonRegionalWeight(lat, lon, m);
    const band = Math.exp(-Math.pow((lat - axis) / 5.0, 2)) * regionalWeight;
    monsoon = clamp(band * (0.72 + 0.28 * Math.max(summerWeight, winterWeight)), 0, 1);
    // Summer: southwesterly / westerly inflow. Winter: northeasterly monsoon displaced equatorward.
    u10 += band * (5.2 * summerWeight - 3.3 * winterWeight);
    v10 += band * (2.1 * summerWeight - 2.5 * winterWeight);
    pressureHpa -= 2.4 * band * summerWeight;
    pressureHpa += 1.1 * band * winterWeight;
  }

  return { u10, v10, pressureHpa, subtropicalHigh, westerly, westerlyTrough, monsoon };
}
