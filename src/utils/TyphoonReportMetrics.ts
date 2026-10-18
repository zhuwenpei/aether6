import type { SimulationConfig, StationReading, Typhoon, TyphoonState } from "../types";
import { TyphoonCategory } from "../types";
import { calculateStationReadings, getAgencyIntensity, getLandMetrics } from "../simulation/Engine";

export type Extremum = { value: number; lat: number; lon: number; simHour: number; cityName?: string } | null;
export type LandExtremes = {
  maxWind: Extremum;
  maxRain: Extremum;
  maxGust: Extremum;
  minPressure: Extremum;
  maxStormSurge: Extremum;
  sampledStates: number;
  sampledStations: number;
};

export type StationExtremum = { name: string; value: number; simHour: number } | null;
export type StoredStationExtremes = {
  maxWind: StationExtremum;
  maxGust: StationExtremum;
  minPressure: StationExtremum;
  maxAccumPrecip: StationExtremum;
  maxStormSurge: StationExtremum;
  maxCasualties: StationExtremum;
};

export function peakOf(ty: Typhoon) {
  const h = ty.history?.length ? ty.history : [ty as any];
  return h.reduce((best, p) => Number(p.vmax || 0) > Number(best.vmax || 0) ? p : best, h[0]);
}

export function minPressureOf(ty: Typhoon) {
  return Math.min(...(ty.history?.length ? ty.history.map((h) => Number(h.pmin || 1100)) : [Number(ty.pmin || 1100)]));
}

export function casualtiesOf(ty: Typhoon) {
  return Math.max(Number(ty.casualties || 0), ...(ty.history || []).map((h: any) => Number(h.casualties || 0)));
}

export function aceOf(ty: Typhoon) {
  const h = ty.history || [];
  if (!h.length) return 0;
  const first = h[0].simHour;
  let ace = 0;
  let lastSample = -Infinity;
  for (const state of h) {
    if (state.dissipated || state.category === TyphoonCategory.ET || state.category === TyphoonCategory.RL || state.vmax < 17.2) continue;
    const relative = state.simHour - first;
    if (relative + 1e-6 < lastSample + 5.5) continue;
    if (Math.abs(relative / 6 - Math.round(relative / 6)) > 0.20 && relative !== 0) continue;
    const kt = Number(getAgencyIntensity(state.vmax, "JTWC", "continuous").value || state.vmax * 1.94384);
    if (kt >= 34) ace += kt * kt / 10000;
    lastSample = relative;
  }
  return ace;
}

export function estimatedLossBillionCny(ty: Typhoon) {
  const maxWind = Number(peakOf(ty)?.vmax || 0);
  const landHours = Math.max(0, Number((ty as any).landContactHours || (ty as any).landHours || 0));
  const landfalls = ty.landfallRecords?.length || 0;
  const casualties = casualtiesOf(ty);
  const affected = landHours > 0 || landfalls > 0;
  if (!affected) return Math.max(0, Math.pow(Math.max(0, maxWind - 20) / 35, 2.2) * 0.12);
  const windTerm = Math.pow(Math.max(0, maxWind) / 35, 3.05) * (1.4 + 0.065 * landHours);
  const landfallTerm = landfalls * Math.pow(Math.max(1, maxWind / 28), 1.8) * 0.65;
  const casualtyTerm = Math.sqrt(Math.max(0, casualties)) * 0.08;
  return Math.max(0.05, windTerm + landfallTerm + casualtyTerm);
}

export function formatReportTime(startDate: Date, simHour: number) {
  const d = new Date(startDate.getTime() + simHour * 3600000);
  return d.toLocaleString();
}

export function scanLandExtremes(ty: Typhoon, config: SimulationConfig): LandExtremes {
  const history = ty.history || [];
  if (!history.length) return { maxWind: null, maxRain: null, maxGust: null, minPressure: null, maxStormSurge: null, sampledStates: 0, sampledStations: 0 };
  const stride = Math.max(1, Math.ceil(history.length / 34));
  const stateIndexes = new Set<number>();
  for (let i = 0; i < history.length; i += stride) stateIndexes.add(i);
  stateIndexes.add(history.length - 1);
  const peakIndex = history.reduce((best, h, i) => h.vmax > history[best].vmax ? i : best, 0);
  stateIndexes.add(peakIndex);
  (ty.landfallRecords || []).forEach((lf) => {
    let best = 0, diff = Infinity;
    history.forEach((h, i) => { const d = Math.abs(h.simHour - lf.simHour); if (d < diff) { diff = d; best = i; } });
    stateIndexes.add(best);
  });

  let maxWind: Extremum = null;
  let maxRain: Extremum = null;
  let maxGust: Extremum = null;
  let minPressure: Extremum = null;
  let maxStormSurge: Extremum = null;
  let sampledStations = 0;
  const radii = [0, 35, 70, 120, 180, 260, 340];
  const bearings = Array.from({ length: 16 }, (_, i) => i * 22.5);

  [...stateIndexes].sort((a, b) => a - b).forEach((index) => {
    const state = history[index] as TyphoonState;
    const candidates: Array<{ name: string; lat: number; lon: number; threshold: number }> = [];
    for (const radius of radii) {
      const dirs = radius === 0 ? [0] : bearings;
      for (const bearing of dirs) {
        const rad = bearing * Math.PI / 180;
        const lat = state.lat + (radius * Math.cos(rad)) / 111.12;
        const lon = state.lon + (radius * Math.sin(rad)) / (111.12 * Math.max(0.2, Math.cos(state.lat * Math.PI / 180)));
        const land = getLandMetrics(lat, lon, config.coastlineSource, true);
        if (!land.isLand) continue;
        candidates.push({ name: `极值格点@${lat.toFixed(4)},${lon.toFixed(4)}`, lat, lon, threshold: 0 });
      }
    }
    if (!candidates.length) return;
    sampledStations += candidates.length;
    let rows: ReturnType<typeof calculateStationReadings> = [];
    try {
      rows = calculateStationReadings(
        state.lat, state.lon, state.vmax, state.pmin, state.rmw || 35,
        state.r7, state.r10, state.r12, undefined, 0,
        state.eyeRadiusKm, state.eyeClearance,
        { ...state, simHour: state.simHour, config: (state as any).configSnapshot || config } as any,
        candidates
      );
    } catch {
      rows = [];
    }
    rows.forEach((row, i) => {
      const c = candidates[i];
      if (!c) return;
      const wind = Math.max(0, Number(row.windSpeed || 0));
      const rain = Math.max(0, Number(row.precipitation || 0));
      const gust = Math.max(wind, Number(row.gustSpeed || 0));
      const pressure = Number(row.pressure || 1013);
      const surge = Math.max(0, Number(row.stormSurge || 0));
      if (!maxWind || wind > maxWind.value) maxWind = { value: wind, lat: c.lat, lon: c.lon, simHour: state.simHour };
      if (!maxRain || rain > maxRain.value) maxRain = { value: rain, lat: c.lat, lon: c.lon, simHour: state.simHour };
      if (!maxGust || gust > maxGust.value) maxGust = { value: gust, lat: c.lat, lon: c.lon, simHour: state.simHour };
      if (!minPressure || pressure < minPressure.value) minPressure = { value: pressure, lat: c.lat, lon: c.lon, simHour: state.simHour };
      if (!maxStormSurge || surge > maxStormSurge.value) maxStormSurge = { value: surge, lat: c.lat, lon: c.lon, simHour: state.simHour };
    });
  });

  return { maxWind, maxRain, maxGust, minPressure, maxStormSurge, sampledStates: stateIndexes.size, sampledStations };
}

export function collectStoredStationExtremes(ty: Typhoon): StoredStationExtremes {
  let maxWind: StationExtremum = null;
  let maxGust: StationExtremum = null;
  let minPressure: StationExtremum = null;
  let maxAccumPrecip: StationExtremum = null;
  let maxStormSurge: StationExtremum = null;
  let maxCasualties: StationExtremum = null;

  const inspect = (rows: StationReading[] | undefined, simHour: number) => {
    (rows || []).forEach((row) => {
      const wind = Number(row.maxWindSpeed ?? row.windSpeed ?? 0);
      const gust = Number(row.gustSpeed ?? row.windSpeed ?? 0);
      const pressure = Number(row.pressure ?? 1013);
      const accum = Number(row.accumPrecip ?? 0);
      const surge = Number(row.maxStormSurge ?? row.stormSurge ?? 0);
      const casualties = Number(row.casualties ?? 0);
      if (!maxWind || wind > maxWind.value) maxWind = { name: row.name, value: wind, simHour };
      if (!maxGust || gust > maxGust.value) maxGust = { name: row.name, value: gust, simHour };
      if (!minPressure || pressure < minPressure.value) minPressure = { name: row.name, value: pressure, simHour };
      if (!maxAccumPrecip || accum > maxAccumPrecip.value) maxAccumPrecip = { name: row.name, value: accum, simHour };
      if (!maxStormSurge || surge > maxStormSurge.value) maxStormSurge = { name: row.name, value: surge, simHour };
      if (!maxCasualties || casualties > maxCasualties.value) maxCasualties = { name: row.name, value: casualties, simHour };
    });
  };

  (ty.history || []).forEach((state) => inspect(state.stationReadings, state.simHour));
  inspect(ty.stationReadings, ty.simHour);
  return { maxWind, maxGust, minPressure, maxAccumPrecip, maxStormSurge, maxCasualties };
}
