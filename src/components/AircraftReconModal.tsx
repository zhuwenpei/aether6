import React, { useEffect, useMemo, useState } from "react";
import {
  X, Plane, Download, ImagePlus, Gauge, Radar, Wind, Droplets,
  Thermometer, Activity, CheckCircle2, ChevronLeft, BarChart3
} from "lucide-react";
import type { SimulationConfig, Typhoon, TyphoonState } from "../types";
import { getLandMetrics } from "../simulation/Engine";
import { computeTyphoonPrecipitation } from "../simulation/PrecipitationModel";
import { getTyphoonDisplayName } from "../utils/TyphoonDisplayName";

interface AircraftReconModalProps {
  isOpen: boolean;
  onClose: () => void;
  typhoon: Typhoon;
  currentHour: number;
  startDate: Date;
  config?: SimulationConfig;
  initialMode?: "details" | "report" | "crossSection";
}

type ReconSection = "summary" | "vdm" | "recco" | "hdob" | "sfmr" | "dropsonde" | "radar" | "microphysics";
type ReportRatio = "4:3" | "16:9" | "3:2" | "1:1";

type ReconState = Typhoon | TyphoonState;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap360 = (v: number) => ((v % 360) + 360) % 360;
const fmt = (v: number, d = 1) => Number.isFinite(v) ? v.toFixed(d) : "--";

function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return (h >>> 0) / 4294967295;
}

function noise(seed: string, amplitude = 1): number {
  return (hash01(seed) * 2 - 1) * amplitude;
}

function meanRadius(r?: { ne: number; se: number; sw: number; nw: number }): number {
  if (!r) return 0;
  const vals = [r.ne, r.se, r.sw, r.nw].filter(v => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function windDirFromMotion(motion: number, radialSide: number): number {
  return wrap360(motion + 90 + radialSide);
}

function windComponents(speed: number, dirDeg: number): { u: number; v: number } {
  const rad = dirDeg * Math.PI / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

function pressureAltitudeM(pHpa: number): number {
  return 44330 * (1 - Math.pow(clamp(pHpa, 100, 1050) / 1013.25, 0.1903));
}

function saturationVaporPressureHpa(tempC: number): number {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

function dewPointFromRh(tempC: number, rhPct: number): number {
  const rh = clamp(rhPct, 1, 100) / 100;
  const gamma = Math.log(rh) + (17.67 * tempC) / (tempC + 243.5);
  return 243.5 * gamma / (17.67 - gamma);
}

function mixingRatioGkg(pHpa: number, tempC: number, rhPct: number): number {
  const e = Math.min(pHpa * 0.96, saturationVaporPressureHpa(tempC) * clamp(rhPct, 1, 100) / 100);
  return Math.max(0, 622 * e / Math.max(1, pHpa - e));
}

function virtualTemperatureK(tempC: number, pHpa: number, rhPct: number): number {
  const q = mixingRatioGkg(pHpa, tempC, rhPct) / 1000;
  return (tempC + 273.15) * (1 + 0.61 * q);
}

function equivalentPotentialTemperatureK(pHpa: number, tempC: number, rhPct: number): number {
  const q = mixingRatioGkg(pHpa, tempC, rhPct) / 1000;
  const tk = tempC + 273.15;
  const theta = tk * Math.pow(1000 / Math.max(100, pHpa), 0.2854);
  return theta * Math.exp((2.5e6 * q) / (1004 * Math.max(190, tk)));
}

function hypsometricLayerHeight(zBaseM: number, pBaseHpa: number, pTopHpa: number, meanVirtualTempK: number): number {
  return zBaseM + (287.05 * meanVirtualTempK / 9.80665) * Math.log(Math.max(1.001, pBaseHpa / Math.max(1, pTopHpa)));
}

function getStateAtHour(typhoon: Typhoon, currentHour: number): ReconState {
  const historical = [...(typhoon.history || [])]
    .filter(h => h.simHour <= currentHour)
    .sort((a, b) => b.simHour - a.simHour)[0];
  return historical || typhoon;
}

interface ReconData {
  mission: {
    id: string; aircraft: string; callsign: string; fixTime: string; level: string; altitudeM: number; missionType: string;
  };
  summary: Array<[string, string]>;
  vdm: Array<[string, string]>;
  recco: Array<Record<string, string | number>>;
  hdob: Array<Record<string, string | number>>;
  sfmr: Array<Record<string, string | number>>;
  sondes: Array<{ name: string; lat: number; lon: number; rows: Array<Record<string, string | number>> }>;
  radar: Array<[string, string]>;
  microphysics: Array<[string, string]>;
  quality: Array<[string, string]>;
  diagnostics: {
    centerPass: Array<{ rangeKm: number; flightWindMs: number; surfaceWindMs: number; rainRate: number; pressureHpa: number }>;
    eyewallProfile: Array<{ pressureHpa: number; heightM: number; tempC: number; dewC: number; windMs: number }>;
  };
}

const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

function radialWindFraction(radiusKm: number, rmwKm: number, expansion: number, compactness = 0.55, broadness = 0): number {
  const x = Math.max(0.015, radiusKm / Math.max(6, rmwKm));
  // A compact inner core has a steeper rise toward the RMW; a loose/moisture-loaded vortex
  // carries more momentum into the outer circulation instead of pretending Vmax is uniform.
  if (x <= 1) {
    const innerExponent = clamp(0.90 - 0.38 * compactness + 0.16 * broadness, 0.46, 0.98);
    return Math.pow(x, innerExponent);
  }
  const outerDecay = clamp(0.45 - 0.15 * clamp(expansion, 0, 1) - 0.10 * broadness, 0.17, 0.48);
  return Math.exp(-outerDecay * (x - 1)) * Math.pow(x, -0.10 - 0.06 * compactness);
}

function pressureAtRadius(radiusKm: number, pmin: number, rmwKm: number, vmax: number, expansion: number): number {
  const environmentalP = clamp(Math.max(1007.5, pmin + 25 + 0.24 * vmax), 1007.5, 1017.0);
  const delta = Math.max(4, environmentalP - pmin);
  const shape = clamp(1.18 + 0.010 * (vmax - 28) - 0.20 * expansion, 0.95, 2.05);
  const scale = Math.max(10, rmwKm * (1.10 + 0.18 * expansion));
  return pmin + delta * (1 - Math.exp(-Math.pow(radiusKm / scale, shape)));
}

function surfaceToFlightRatio(levelHpa: number, wallFraction: number, rainRate: number): number {
  // NHC operational mean reductions are roughly 0.90 at 700 hPa and 0.80 at 850 hPa.
  // Local eyewall supergradient flow and convective mixing make the instantaneous ratio vary.
  const base = levelHpa === 700 ? 0.90 : 0.80;
  const mixing = 0.018 * wallFraction - 0.010 * clamp((rainRate - 55) / 55, 0, 1);
  return clamp(base + mixing, levelHpa === 700 ? 0.86 : 0.76, levelHpa === 700 ? 0.94 : 0.85);
}

function boundaryLayerWindFactor(heightM: number, eyewall: boolean): number {
  const z = Math.max(10, heightM);
  if (eyewall) {
    if (z <= 500) return 1.00 + 0.30 * smooth01((z - 10) / 490);
    if (z <= 1500) return 1.30 - 0.05 * smooth01((z - 500) / 1000);
    if (z <= 3000) return 1.25 - 0.14 * smooth01((z - 1500) / 1500);
    if (z <= 8000) return 1.11 - 0.22 * smooth01((z - 3000) / 5000);
    return clamp(0.89 - 0.10 * smooth01((z - 8000) / 5000), 0.74, 0.89);
  }
  if (z <= 800) return 1.00 + 0.13 * smooth01((z - 10) / 790);
  if (z <= 3000) return 1.13 - 0.15 * smooth01((z - 800) / 2200);
  return clamp(0.98 - 0.18 * smooth01((z - 3000) / 7000), 0.72, 0.98);
}

function synthesizeRecon(typhoon: Typhoon, state: ReconState, currentHour: number, startDate: Date, config?: SimulationConfig): ReconData {
  const key = `${typhoon.id}-${Math.floor(currentHour)}-${state.lat.toFixed(2)}-${state.lon.toFixed(2)}`;
  const vmax = Math.max(5, state.vmax || 5);
  const pmin = clamp(Number.isFinite(state.pmin) ? state.pmin : 1013, 0, 1018);
  const rmw = clamp(state.rmw || 35, 8, 120);
  const r7Mean = meanRadius(state.r7);
  const shear = Math.max(0, state.shear ?? 10);
  const shearNorm = clamp((shear - 7) / 28, 0, 1);
  const direction = state.direction ?? 300;
  const speedKmh = state.speed ?? 18;
  const translationMs = Math.max(0, speedKmh / 3.6);
  const eyeRadius = Math.max(2.0, state.eyeRadiusKm || rmw * 0.66);
  const eyeDiameter = eyeRadius * 2;
  const integrity = clamp(state.eyewallIntegrity ?? (0.35 + vmax / 120), 0.05, 1);
  const clearance = clamp(state.eyeClearance ?? 0, 0, 1);
  const eyeWarmCore = clamp(state.eyeWarmCore ?? (0.20 + 0.62 * integrity * clamp((vmax - 24) / 48, 0, 1)), 0, 1);
  const eyeObstruction = clamp(state.eyeObstruction ?? (1 - clearance), 0, 1);
  const asym = clamp(state.eyeAsymmetry ?? shear / 35, 0, 1);
  const rapid = !!state.rapidIntensifying;
  const circulationExpansion = clamp(state.circulationExpansion ?? 0, 0, 1);
  const moisture = clamp(state.moistureReservoir ?? 0.95, 0.02, 1.05);
  const compactness = clamp(state.coreCompactness ?? (0.24 + 0.60 * integrity), 0, 1);
  const rainbandDominance = clamp(state.rainbandDominance ?? (0.30 + 0.45 * (1 - integrity)), 0, 1);
  const outflowEfficiency = clamp(state.outflowEfficiency ?? (0.68 - 0.28 * shearNorm), 0.05, 1);
  const rebuildScar = clamp(state.coreRebuildScar ?? 0, 0, 1);
  const broadMoisturePlatform = clamp(state.broadMoisturePlatform ?? 0, 0, 1);
  const structuralBroadness = clamp(0.42 * circulationExpansion + 0.34 * rainbandDominance + 0.30 * broadMoisturePlatform + 0.24 * rebuildScar, 0, 1);
  const damage = clamp(Math.max(
    state.isCoreDisrupted ? 0.88 : 0,
    state.isStructureDamaged ? 0.40 : 0,
    1 - (state.structuralDamagePenaltyFactor ?? 1),
    0.42 * (1 - integrity),
    0.78 * rebuildScar
  ), 0, 1);
  const strengthening = clamp(Math.max((state.intensityChange6h ?? (rapid ? 5 : 0)) / 6, 0), 0, 1.4);

  const fixDate = new Date(startDate.getTime() + currentHour * 3600_000);
  const fixTime = fixDate.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const levelHpa = vmax >= 32.7 ? 700 : 850;
  const altitudeM = levelHpa === 700 ? 3050 + noise(`${key}-alt`, 55) : 1500 + noise(`${key}-alt`, 35);
  const aircraft = "NOAA WP-3D Orion（模拟观测平台）";
  const callsign = hash01(`${key}-tail`) > 0.5 ? "NOAA 42 / N42RF" : "NOAA 43 / N43RF";
  const aircraftGroundMs = clamp(166 + noise(`${key}-tas`, 12), 145, 188);

  // Use a storm-relative wind field first, then let each instrument observe that field with its
  // own averaging period, vertical transfer and error characteristics. This avoids copying Vmax.
  const motionAsym = clamp(0.035 + 0.075 * clamp(translationMs / 10, 0, 1.5) + 0.085 * asym + 0.045 * shearNorm, 0.03, 0.25);
  const strongestBearing = wrap360(direction + 90 + 24 * shearNorm + noise(`${key}-bearing`, 9));
  const shearBearing = wrap360((state.shearDir ?? direction + 125) + 70);
  const trueSurfaceAt = (radiusKm: number, azimuth: number) => {
    const radial = radialWindFraction(radiusKm, rmw, circulationExpansion, compactness, structuralBroadness);
    const quadrant = 1
      + motionAsym * Math.cos((azimuth - strongestBearing) * Math.PI / 180)
      + 0.055 * shearNorm * Math.cos((azimuth - shearBearing) * Math.PI / 180);
    const damagePenalty = 1 - 0.12 * damage * Math.exp(-0.5 * Math.pow((radiusKm - rmw) / Math.max(10, 0.42 * rmw), 2));
    return clamp(vmax * radial * quadrant * damagePenalty, 0, vmax * 1.24);
  };

  const eyewallSigma = clamp(7.0 + 0.10 * rmw + 6.5 * damage + 5.0 * (1 - compactness) + 3.0 * broadMoisturePlatform, 7.5, 30);
  const rainPeak = clamp(
    (27 + 66 * clamp((vmax - 20) / 48, 0, 1)) *
    (0.68 + 0.44 * integrity + 0.18 * rainbandDominance) *
    (1 + 0.40 * strengthening + (rapid ? 0.20 : 0) + 0.18 * (state.convectiveBurstIndex ?? 0)) *
    (0.56 + 0.58 * moisture) *
    (0.90 + 0.20 * outflowEfficiency) *
    (1 - 0.10 * damage),
    12, 155
  );
  const rainAt = (radiusKm: number, azimuth: number) => {
    const wall = Math.exp(-0.5 * Math.pow((radiusKm - rmw) / eyewallSigma, 2));
    const reorganized = (damage > 0.10 || rainbandDominance > 0.48)
      ? (0.34 + 0.46 * rainbandDominance) * Math.max(damage, 0.34 * structuralBroadness) *
        Math.exp(-0.5 * Math.pow((radiusKm - rmw * (1.22 + 0.42 * structuralBroadness)) / (17 + 22 * structuralBroadness), 2))
      : 0;
    const sector = clamp(0.76 + 0.18 * Math.cos((azimuth - strongestBearing) * Math.PI / 180) + 0.15 * hash01(`${key}-rain-sector-${Math.round(azimuth / 15)}`), 0.55, 1.18);
    const innerFloor = radiusKm < eyeRadius * 0.78 && clearance > 0.45 ? 0.02 + 0.10 * (1 - clearance) : 0.10;
    return clamp(rainPeak * Math.max(innerFloor, wall + reorganized) * sector + 1.2 * moisture * Math.exp(-radiusKm / Math.max(140, r7Mean * 0.7 || 180)), 0, 165);
  };

  // 3.5.8: aircraft products now consume the same multi-mechanism precipitation field used by
  // the live map, observed-rainfall product and station network.  The legacy radial operator is
  // retained only as a fail-safe if a diagnostic call cannot be evaluated.  At roughly fifty
  // center-pass samples this adds negligible work compared with the report/canvas rendering.
  const rainAtPosition = (lat: number, lon: number, fallbackRadiusKm: number, fallbackAzimuth: number) => {
    try {
      const land = getLandMetrics(lat, lon, config?.coastlineSource, true);
      return clamp(computeTyphoonPrecipitation(state as any, lat, lon, {
        config,
        isLand: land.isLand,
        elevation: land.elevation
      }).rate, 0, 170);
    } catch {
      return rainAt(fallbackRadiusKm, fallbackAzimuth);
    }
  };

  const pressureObsAt = (radiusKm: number) => pressureAtRadius(radiusKm, pmin, rmw, vmax, circulationExpansion);
  const fixLat = state.lat + noise(`${key}-fixlat`, 0.012 + 0.025 * asym);
  const fixLon = state.lon + noise(`${key}-fixlon`, 0.012 + 0.025 * asym) / Math.max(0.4, Math.cos(state.lat * Math.PI / 180));
  const surfacePressureObs = pressureObsAt(0) + noise(`${key}-p`, 0.55) + (clearance < 0.25 ? 0.35 : 0);
  const sst = clamp((config?.sstBase ?? 29) + Number(config?.sstAnomaly ?? 0) + noise(`${key}-sst`, 0.18), 20, 36);

  // Flight-level temperature is treated as an actual sampled thermodynamic field, not as an
  // intensity-to-temperature lookup.  The eye warm anomaly follows the modeled warm-core state
  // and increases with height; eyewall convection/rain can locally cool the flight level.
  // This matters for VDM P/Q/R: Q is the warmest *observed* HDOB sample inside the
  // model-diagnosed eye, while P is the warmest sampled flight-level temperature outside it.
  const altitudeKm = altitudeM / 1000;
  const warmCoreVertical = 0.30 + 0.70 * smooth01(clamp(altitudeM / 7500, 0, 1));
  const envFlightTemp = clamp(sst - 1.7 - (5.75 + 0.18 * clamp(altitudeKm / 6, 0, 1)) * altitudeKm, -25, 29);
  const warmCoreAmplitude = (0.55 + 4.8 * eyeWarmCore * clamp((vmax - 18) / 55, 0, 1)) * warmCoreVertical;
  const thermalAt = (radiusKm: number, wall: number, localRain: number, seed: string) => {
    const eyeThermalRadius = Math.max(6.5, Math.min(Math.max(eyeRadius * 0.92, 9.3), rmw * 0.92));
    const eyeWeight = Math.exp(-0.5 * Math.pow(radiusKm / eyeThermalRadius, 2));
    const subsidenceWarmth = warmCoreAmplitude * eyeWeight * (0.84 + 0.16 * (1 - eyeObstruction));
    const convectiveCooling = (0.35 + 0.90 * wall) * clamp(localRain / 95, 0, 1)
      + 0.80 * clamp(state.convectiveBurstIndex ?? 0, 0, 1) * eyeWeight * eyeObstruction;
    const temp = clamp(envFlightTemp + subsidenceWarmth + 0.18 * wall - convectiveCooling + noise(`${key}-${seed}-t`, 0.22), -30, 31);
    const wallRh = 94 - 7 * clamp(altitudeKm / 6, 0, 1);
    const eyeDrying = 34 * eyeWarmCore * (1 - 0.58 * eyeObstruction);
    const eyeRh = clamp(68 - eyeDrying + 10 * damage + 12 * eyeObstruction, 20, 82);
    const rh = clamp(wallRh * (1 - eyeWeight) + eyeRh * eyeWeight + noise(`${key}-${seed}-rh`, 1.8), 12, 100);
    const dew = clamp(dewPointFromRh(temp, rh), -75, temp);
    return { temp, dew, rh };
  };
  const eyeShape = clearance > 0.58 && asym < 0.25 ? "圆形 / closed" : asym > 0.58 ? "椭圆偏心 / open sector" : clearance > 0.3 ? "近圆形 / partially open" : "不规则 / ragged";
  const eyeOrientation = wrap360(direction + 90 + noise(`${key}-orient`, 20));
  const rmwNm = rmw / 1.852;

  // Simulate a straight aircraft center penetration. HDOB values are 30-s means and thus span a
  // real distance along track; both sides of the eye sample different motion/shear quadrants.
  const passAz = strongestBearing;
  const centerPass: ReconData["diagnostics"]["centerPass"] = [];
  const hdob: Array<Record<string, string | number>> = [];
  let maxFlightWind = 0;
  let maxSfmrWind = 0;
  let peakRainObserved = 0;
  let inboundMaxFlight = 0;
  let outboundMaxFlight = 0;
  let inboundMaxSurface = 0;
  let outboundMaxSurface = 0;
  let inboundMaxRange = rmw;
  let outboundMaxRange = rmw;
  const thermalSamples: Array<{ signedRangeKm: number; radiusKm: number; temp: number; dew: number; geopotential: number; obsTime: string; inbound: boolean }> = [];

  for (let i = -25; i <= 25; i++) {
    const signedRangeKm = i * aircraftGroundMs * 30 / 1000;
    const radiusKm = Math.abs(signedRangeKm);
    const az = signedRangeKm <= 0 ? wrap360(passAz + 180) : passAz;
    const rad = passAz * Math.PI / 180;
    const obsLat = fixLat + (signedRangeKm * Math.cos(rad)) / 111.12;
    const obsLon = fixLon + (signedRangeKm * Math.sin(rad)) / (111.12 * Math.max(0.3, Math.cos(fixLat * Math.PI / 180)));
    const obsTime = new Date(fixDate.getTime() + i * 30_000).toISOString().slice(11, 19) + "Z";
    const wall = Math.exp(-0.5 * Math.pow((radiusKm - rmw) / eyewallSigma, 2));
    const eye = Math.exp(-0.5 * Math.pow(radiusKm / Math.max(4, eyeRadius * 0.70), 2));
    const trueSurface = trueSurfaceAt(radiusKm, az);
    const trueRain = rainAtPosition(obsLat, obsLon, radiusKm, az);
    const reduction = surfaceToFlightRatio(levelHpa, wall, trueRain);
    const flWind = clamp(trueSurface / reduction + noise(`${key}-hdw-${i}`, 0.75 + 0.45 * wall), 1, vmax * 1.48);
    // SFMR observes brightness temperatures and retrieves 10-m wind. Heavy rain increases uncertainty.
    const rainUncertainty = 0.6 + 2.8 * clamp(trueRain / 100, 0, 1);
    const rainBias = noise(`${key}-sfmr-rain-bias-${i}`, rainUncertainty) + (trueRain > 80 ? 0.5 * noise(`${key}-sfmr-rain-sign-${i}`, 1) : 0);
    const sfmrSurface = clamp(trueSurface + rainBias + noise(`${key}-sfmr-inst-${i}`, 0.65), 0, vmax * 1.30);
    const thermal = thermalAt(radiusKm, wall, trueRain, `hd-${i}`);
    const temp = thermal.temp;
    const inflowAngle = 5 + 9 * wall;
    const tangent = wrap360(az + 90);
    const windDir = wrap360(tangent - inflowAngle + noise(`${key}-hddir-${i}`, 3.0 + 3.0 * asym));
    const rain = clamp(trueRain + noise(`${key}-hdr-${i}`, 1.6 + 0.04 * trueRain), 0, 170);
    const staticP = levelHpa + noise(`${key}-hdp-${i}`, 0.75);
    const warmHeightAnomaly = (thermal.temp - envFlightTemp) * (7.5 + 3.0 * warmCoreVertical);
    const massDeficitAnomaly = -0.42 * Math.max(0, 1013 - pressureObsAt(radiusKm));
    const geopotential = pressureAltitudeM(staticP) + warmHeightAnomaly + massDeficitAnomaly + noise(`${key}-hdz-${i}`, 6.5);
    thermalSamples.push({ signedRangeKm, radiusKm, temp, dew: thermal.dew, geopotential, obsTime, inbound: signedRangeKm < 0 });
    const extrapSlp = pressureObsAt(radiusKm) + noise(`${key}-hdslp-${i}`, 0.45);
    const peak10 = flWind * clamp(1.035 + 0.035 * wall + Math.abs(noise(`${key}-hd10-${i}`, 0.012)), 1.01, 1.10);
    const qcMet = rain > 95 && hash01(`${key}-qcmet-${i}`) > 0.84 ? 3 : 0;

    maxFlightWind = Math.max(maxFlightWind, flWind);
    maxSfmrWind = Math.max(maxSfmrWind, sfmrSurface);
    peakRainObserved = Math.max(peakRainObserved, rain);
    if (signedRangeKm < 0 && flWind > inboundMaxFlight) { inboundMaxFlight = flWind; inboundMaxSurface = sfmrSurface; inboundMaxRange = radiusKm; }
    if (signedRangeKm >= 0 && flWind > outboundMaxFlight) { outboundMaxFlight = flWind; outboundMaxSurface = sfmrSurface; outboundMaxRange = radiusKm; }
    centerPass.push({ rangeKm: signedRangeKm, flightWindMs: flWind, surfaceWindMs: sfmrSurface, rainRate: rain, pressureHpa: extrapSlp });
    hdob.push({
      "UTC": obsTime,
      "Lat": `${fmt(obsLat, 3)}N`,
      "Lon": `${fmt(obsLon, 3)}E`,
      "Static P": `${fmt(staticP, 1)} hPa`,
      "GA": `${Math.round(geopotential)} m`,
      "Extrap SLP/D": `${fmt(extrapSlp, 1)} hPa`,
      "T": `${fmt(temp, 1)}°C`,
      "Td": `${fmt(thermal.dew, 1)}°C`,
      "FL wind 30s": `${fmt(windDir, 0)}°/${fmt(flWind * 1.94384, 0)} kt`,
      "Peak FL 10s": `${fmt(peak10 * 1.94384, 0)} kt`,
      "SFMR 10s": `${fmt(sfmrSurface * 1.94384, 0)} kt`,
      "SFMR rain": `${fmt(rain, 1)} mm/h`,
      "QC": `0${qcMet}`,
    });
  }

  const sfmr: Array<Record<string, string | number>> = [];
  const freqs = [4.55, 5.06, 5.64, 6.34, 6.96, 7.22];
  const sfIndices = [-21, -17, -13, -9, -5, -1, 3, 7, 11, 15, 19, 23];
  sfIndices.forEach((idx, j) => {
    const cp = centerPass[clamp(idx + 25, 0, centerPass.length - 1)];
    const signedRange = cp.rangeKm;
    const az = signedRange <= 0 ? wrap360(passAz + 180) : passAz;
    const rad = passAz * Math.PI / 180;
    const sampleLat = fixLat + (signedRange * Math.cos(rad)) / 111.12;
    const sampleLon = fixLon + (signedRange * Math.sin(rad)) / (111.12 * Math.max(0.3, Math.cos(fixLat * Math.PI / 180)));
    const sampleTime = new Date(fixDate.getTime() + idx * 30_000).toISOString().slice(11, 19) + "Z";
    const rain = cp.rainRate;
    const w = cp.surfaceWindMs;
    const row: Record<string, string | number> = {
      UTC: sampleTime, Lat: `${fmt(sampleLat, 3)}N`, Lon: `${fmt(sampleLon, 3)}E`, Alt: `${Math.round(altitudeM)} m`,
      Range: `${fmt(signedRange, 1)} km`, Azimuth: `${Math.round(az)}°`, "10m wind": `${fmt(w * 1.94384, 0)} kt`, "Rain rate": `${fmt(rain, 1)} mm/h`
    };
    freqs.forEach((f, k) => {
      // Synthetic brightness temperature response: foam emissivity rises with wind, liquid water
      // raises TB and introduces channel-dependent rain contamination.
      row[`TB ${f}`] = `${fmt(165 + 2.6 * k + 0.19 * rain + 0.62 * w + noise(`${key}-tb-${j}-${k}`, 1.5 + 0.012 * rain), 1)} K`;
    });
    row.QC = rain > 85 ? "RAIN" : (rain > 60 ? "R?" : "00");
    sfmr.push(row);
  });

  const centerDropWind = clamp(trueSurfaceAt(Math.max(1.5, eyeRadius * 0.18), wrap360(direction + 155)) * 0.72 + noise(`${key}-center-drop-wind`, 1.4), 0, 22);
  const centerDropDir = wrap360(direction + 150 + noise(`${key}-center-drop-dir`, 22));

  // VDM P/Q/R are diagnosed from the actual 30-s flight-level samples created above.
  // Q is the maximum flight-level temperature observed *inside the modeled eye*, rather than
  // a fixed 5-n-mi intensity lookup. This is important for pinhole eyes and large/ragged eyes.
  const eyeSampleLimitKm = clearance > 0.18
    ? Math.max(1.5, eyeRadius * clamp(0.72 + 0.10 * clearance, 0.70, 0.82))
    : Math.max(2.5, Math.min(rmw * 0.32, 7.5));
  const eyeThermalSamples = thermalSamples.filter(sample => sample.radiusKm <= eyeSampleLimitKm + 0.05);
  const qSample = (eyeThermalSamples.length ? eyeThermalSamples : thermalSamples.filter(sample => sample.radiusKm <= Math.max(2.5, eyeRadius)))
    .reduce((best, sample) => !best || sample.temp > best.temp ? sample : best, undefined as typeof thermalSamples[number] | undefined);

  // P is the warmest observed flight-level sample outside the eye but still within the inner-core
  // penetration. Use both inbound and outbound HDOB samples; the VDM definition is not an
  // "inbound-only" temperature statistic.
  const outsideInnerKm = Math.max(eyeSampleLimitKm + Math.max(2.0, 0.10 * rmw), eyeRadius * 1.03);
  const outsideOuterKm = Math.max(outsideInnerKm + 8, rmw * 1.70);
  const outsideEyeSamples = thermalSamples.filter(sample => sample.radiusKm >= outsideInnerKm && sample.radiusKm <= outsideOuterKm);
  const pSample = (outsideEyeSamples.length ? outsideEyeSamples : thermalSamples.filter(sample => sample.radiusKm > eyeSampleLimitKm))
    .reduce((best, sample) => !best || sample.temp > best.temp ? sample : best, undefined as typeof thermalSamples[number] | undefined);
  const qTemp = qSample?.temp ?? envFlightTemp;
  const qDew = qSample?.dew ?? qTemp - 4;
  const qPa = qSample?.geopotential ?? altitudeM;
  const pTemp = pSample?.temp ?? envFlightTemp;
  const pPa = pSample?.geopotential ?? altitudeM;
  const thermalRemark = pSample && qSample && pSample.temp > qSample.temp + 0.2
    ? `; MAX FL TEMP OUTSIDE EYE ${fmt(pSample.temp, 1)}C AT ${fmt(pSample.radiusKm / 1.852, 1)}NM`
    : "";
  const inboundTime = new Date(fixDate.getTime() - Math.max(3.5, inboundMaxRange / Math.max(1, aircraftGroundMs) * 1000 / 60) * 60_000).toISOString().slice(11, 19) + "Z";
  const outboundTime = new Date(fixDate.getTime() + Math.max(3.5, outboundMaxRange / Math.max(1, aircraftGroundMs) * 1000 / 60) * 60_000).toISOString().slice(11, 19) + "Z";

  // NHOP VDM item S uses observation-method codes: 1 penetration, 2 radar, 3 wind,
  // 4 pressure, 5 temperature, followed by the fix-level code. Only advertise methods for
  // which this virtual mission actually computed independent evidence.
  const inboundPressureSamples = centerPass.filter(sample => sample.rangeKm < -Math.max(2, eyeSampleLimitKm * 0.5));
  const pressureFixEvidence = inboundPressureSamples.length > 0 && surfacePressureObs < Math.min(...inboundPressureSamples.map(sample => sample.pressureHpa)) - 0.3;
  const centerWindSample = centerPass.reduce((best, sample) => Math.abs(sample.rangeKm) < Math.abs(best.rangeKm) ? sample : best, centerPass[0]);
  const windFixEvidence = !!centerWindSample && inboundMaxFlight > 18 && outboundMaxFlight > 18 && centerWindSample.flightWindMs < 0.58 * Math.min(inboundMaxFlight, outboundMaxFlight);
  const maxInboundTemp = thermalSamples.filter(sample => sample.inbound).reduce((m, sample) => Math.max(m, sample.temp), -Infinity);
  const tempFixEvidence = !!qSample && Number.isFinite(maxInboundTemp) && qTemp >= maxInboundTemp - 0.15;
  // Radar is counted only when the modeled eye/inner-core geometry is coherent enough for a
  // curvature-based center estimate; otherwise the TDR section may still contain useful winds
  // but it is not claimed as a center-fix method.
  const radarFixEvidence = integrity >= 0.42 && asym <= 0.70 && (clearance >= 0.18 || compactness >= 0.48);
  const fixMethods = ["1"];
  if (radarFixEvidence) fixMethods.push("2");
  if (windFixEvidence) fixMethods.push("3");
  if (pressureFixEvidence) fixMethods.push("4");
  if (tempFixEvidence) fixMethods.push("5");
  const fixLevelCode = levelHpa === 700 ? "7" : levelHpa === 850 ? "8" : levelHpa === 925 ? "9" : "NA";
  const fixMethodCode = `${fixMethods.join("")} / ${fixLevelCode}`;
  const navErrorDeg = Math.max(0.01, Math.hypot(fixLat - state.lat, (fixLon - state.lon) * Math.cos(state.lat * Math.PI / 180)));
  const metErrorNm = clamp(0.6 + 3.0 * asym + 1.7 * damage + 0.8 * (1 - integrity), 0.5, 8.0);
  const fixAccuracy = `${fmt(navErrorDeg, 2)} / ${fmt(metErrorNm, 0)} nm`;
  const eyeCode = clearance > 0.58 && asym < 0.25
    ? `C${Math.max(4, Math.round(eyeDiameter / 1.852))}`
    : `E${String(Math.round(eyeOrientation / 10) * 10).padStart(3, "0")}/${Math.max(4, Math.round(eyeDiameter / 1.852))}/${Math.max(3, Math.round(eyeDiameter * (1 - 0.25 * asym) / 1.852))}`;

  const vdm: Array<[string, string]> = [
    ["A. FIX TIME", fixDate.toISOString().slice(8, 10) + "/" + fixDate.toISOString().slice(11, 19) + "Z"],
    ["B. CENTER POSITION", `${fmt(fixLat, 2)} deg N ${fmt(fixLon, 2)} deg E`],
    ["C. STANDARD LEVEL / MIN HEIGHT", `${levelHpa} mb ${Math.round(altitudeM)} m`],
    ["D. MINIMUM SLP", `${fmt(surfacePressureObs, 1)} mb`],
    ["E. CENTER DROP SURFACE WIND", `${fmt(centerDropDir, 0)} deg ${fmt(centerDropWind * 1.94384, 0)} kt`],
    ["F. EYE CHARACTER", eyeShape],
    ["G. EYE SHAPE / ORIENTATION / DIAMETER", eyeCode],
    ["H. MAX INBOUND SURFACE WIND", `${fmt(inboundMaxSurface * 1.94384, 0)} kt`],
    ["I. INBOUND SURFACE WIND LOCATION/TIME", `${fmt(wrap360(passAz + 180), 0)} deg ${fmt(inboundMaxRange / 1.852, 1)} nm ${inboundTime}`],
    ["J. MAX INBOUND FL WIND", `${fmt(wrap360(passAz + 270), 0)} deg ${fmt(inboundMaxFlight * 1.94384, 0)} kt`],
    ["K. INBOUND FL WIND LOCATION/TIME", `${fmt(wrap360(passAz + 180), 0)} deg ${fmt(inboundMaxRange / 1.852, 1)} nm ${inboundTime}`],
    ["L. MAX OUTBOUND SURFACE WIND", `${fmt(outboundMaxSurface * 1.94384, 0)} kt`],
    ["M. OUTBOUND SURFACE WIND LOCATION/TIME", `${fmt(passAz, 0)} deg ${fmt(outboundMaxRange / 1.852, 1)} nm ${outboundTime}`],
    ["N. MAX OUTBOUND FL WIND", `${fmt(wrap360(passAz + 90), 0)} deg ${fmt(outboundMaxFlight * 1.94384, 0)} kt`],
    ["O. OUTBOUND FL WIND LOCATION/TIME", `${fmt(passAz, 0)} deg ${fmt(outboundMaxRange / 1.852, 1)} nm ${outboundTime}`],
    ["P. MAX FL TEMP OUTSIDE CENTRAL REGION / PA", `${fmt(pTemp, 1)} C / ${Math.round(pPa)} m`],
    ["Q. MAX FL TEMP INSIDE EYE / PA", `${fmt(qTemp, 1)} C / ${Math.round(qPa)} m`],
    ["R. DEWPOINT / SST INSIDE EYE", `${fmt(qDew, 1)} C / ${state.landed ? "NA" : `${fmt(sst, 1)} C`}`],
    ["S. FIX METHOD", fixMethodCode],
    ["T. FIX ACCURACY", fixAccuracy],
    ["U. MISSION / REMARKS", `${callsign.replace(" / ", " ")} ${typhoon.name.toUpperCase()} OB ${String(1 + (Math.floor(currentHour) % 99)).padStart(2, "0")}; MAX FL WIND ${fmt(maxFlightWind * 1.94384, 0)} KT; RMW ${fmt(rmwNm, 1)} NM${thermalRemark}`],
  ];

  const recco: Array<Record<string, string | number>> = [-1, 0, 1].map((leg, idx) => {
    const radiusKm = leg === 0 ? Math.max(eyeRadius * 0.28, 2) : rmw * (1.00 + 0.12 * idx);
    const az = leg < 0 ? wrap360(passAz + 180) : leg > 0 ? passAz : wrap360(direction + 40);
    const rad = az * Math.PI / 180;
    const obsLat = fixLat + (radiusKm * Math.cos(rad)) / 111.12;
    const obsLon = fixLon + (radiusKm * Math.sin(rad)) / (111.12 * Math.max(0.3, Math.cos(fixLat * Math.PI / 180)));
    const inEye = leg === 0;
    const trueSfc = trueSurfaceAt(radiusKm, az);
    const localRain = rainAtPosition(obsLat, obsLon, radiusKm, az);
    const wall = inEye ? 0 : 1;
    const legWind = inEye ? Math.max(3, centerDropWind) : trueSfc / surfaceToFlightRatio(levelHpa, wall, localRain);
    const legThermal = thermalAt(radiusKm, wall, localRain, `recco-${idx}`);
    const legTemp = legThermal.temp;
    const legDew = legThermal.dew;
    const obsTime = new Date(fixDate.getTime() + leg * 4.0 * 60_000).toISOString().slice(11, 19) + "Z";
    const staticP = levelHpa + noise(`${key}-recco-p-${idx}`, 0.8);
    const warmHeightAnomaly = (legTemp - envFlightTemp) * (7.5 + 3.0 * warmCoreVertical);
    const massDeficitAnomaly = -0.42 * Math.max(0, 1013 - pressureObsAt(radiusKm));
    const observedGeoHeight = pressureAltitudeM(staticP) + warmHeightAnomaly + massDeficitAnomaly + noise(`${key}-recco-z-${idx}`, 7);
    const dValue = observedGeoHeight - pressureAltitudeM(staticP);
    return {
      "OB": String(idx + 1).padStart(2, "0"), "UTC": obsTime,
      "Lat": `${fmt(obsLat, 3)}N`, "Lon": `${fmt(obsLon, 3)}E`,
      "Flight level": `${levelHpa} hPa / ${Math.round(observedGeoHeight)} m`,
      "Static P": `${fmt(staticP, 1)} hPa`,
      "SLP/D-value": inEye ? `${fmt(surfacePressureObs, 1)} hPa` : `${dValue >= 0 ? "+" : ""}${Math.round(dValue)} m`,
      "T/Td": `${fmt(legTemp, 1)}/${fmt(legDew, 1)}°C`,
      "FL wind": `${fmt(wrap360(az + 90 - (inEye ? 0 : 8)), 0)}°/${fmt(legWind * 1.94384, 0)} kt`,
      "Peak 10s": `${fmt(legWind * (inEye ? 1.03 : 1.07) * 1.94384, 0)} kt`,
      "Weather": inEye ? (clearance > 0.55 ? "EYE / SCT low cloud" : "EYE / BRKN scud") : (localRain > 55 ? "HVY RA / CB" : "RA SHRA / CB"),
      "Turb": inEye ? "LGT" : (rapid || integrity > 0.75 ? "MOD-SEV" : "MOD"),
      "Remarks": inEye ? "CENTER FIX / DROP" : (leg < 0 ? "INBOUND EYEWALL" : "OUTBOUND EYEWALL"),
    };
  });

  const sondeDefs = [
    { name: "CENTER", radial: Math.max(1, eyeRadius * 0.12), az: direction + 10 },
    { name: "EYEWALL-IN", radial: rmw * 0.96, az: wrap360(passAz + 180) },
    { name: "EYEWALL-OUT", radial: rmw * 1.04, az: passAz },
    { name: "ENVIRONMENT", radial: Math.max(rmw * 3.1, 95), az: wrap360(direction - 55) },
  ];
  const mandatoryLevels = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 500, 400, 300];
  const sondes = sondeDefs.map((def, si) => {
    const rad = def.az * Math.PI / 180;
    const lat = fixLat + (def.radial * Math.cos(rad)) / 111.12;
    const lon = fixLon + (def.radial * Math.sin(rad)) / (111.12 * Math.max(0.3, Math.cos(fixLat * Math.PI / 180)));
    const localSurfaceP = pressureObsAt(def.radial);
    const isWall = def.name.startsWith("EYEWALL");
    const inCenter = def.name === "CENTER";
    const localSurfaceWind = inCenter ? Math.max(2, centerDropWind) : trueSurfaceAt(def.radial, def.az);
    const firstP = Math.floor((localSurfaceP - 1) / 5) * 5;
    const levels = Array.from(new Set([firstP, ...mandatoryLevels.filter(p => p < firstP - 3)])).filter(p => p >= 300 && p <= 1005).sort((a, b) => b - a);
    const rows: Array<Record<string, string | number>> = [];
    const thermoAtHeight = (z: number, p: number, li: number) => {
      const zKm = z / 1000;
      // Tropical marine sounding: moist lower/middle troposphere, steeper cooling aloft, then
      // flattening toward the tropical tropopause. The warm-core anomaly peaks in mid/upper levels.
      const baseSurfaceTemp = sst - (isWall ? 1.5 : inCenter ? 0.7 : 1.1);
      const envTemp = baseSurfaceTemp
        - 5.3 * Math.min(zKm, 1.5)
        - 5.8 * Math.max(0, Math.min(zKm, 5.5) - 1.5)
        - 6.4 * Math.max(0, Math.min(zKm, 11.5) - 5.5)
        - 1.6 * Math.max(0, zKm - 11.5);
      const warmPeak = Math.exp(-0.5 * Math.pow((zKm - 6.5) / 3.5, 2));
      const warmCoreAnom = inCenter
        ? (0.7 + 7.0 * eyeWarmCore * clamp((vmax - 20) / 52, 0, 1)) * warmPeak
        : isWall ? 0.8 * integrity * warmPeak : 0.12 * warmPeak;
      const t = clamp(envTemp + warmCoreAnom + noise(`${key}-sondet-${si}-${li}`, 0.28), -72, 33);
      let rhBase = inCenter
        ? 78 - 42 * eyeWarmCore * (1 - 0.50 * eyeObstruction) * Math.exp(-0.5 * Math.pow((zKm - 5.0) / 3.1, 2)) + 9 * eyeObstruction
        : isWall ? 97 - 10 * clamp(zKm / 12, 0, 1) : 84 - 24 * clamp(zKm / 11, 0, 1);
      if (z < 900) rhBase += isWall ? 1 : 7;
      if (!isWall && !inCenter && zKm > 5) rhBase -= 4 * smooth01((zKm - 5) / 5);
      const rh = clamp(rhBase + noise(`${key}-sonderh-${si}-${li}`, 2.5), 10, 100);
      return { t, rh, td: clamp(dewPointFromRh(t, rh), -85, t), tv: virtualTemperatureK(t, p, rh) };
    };

    let prevP = localSurfaceP;
    let prevZ = 10;
    let prevThermo = thermoAtHeight(prevZ, prevP, -1);
    levels.forEach((p, li) => {
      // Hydrostatic/hypsometric integration from the *local cyclone surface pressure*, not the
      // standard atmosphere. Two iterations are enough for a self-consistent virtual-temperature layer.
      let z = hypsometricLayerHeight(prevZ, prevP, p, prevThermo.tv);
      let thermo = thermoAtHeight(z, p, li);
      z = hypsometricLayerHeight(prevZ, prevP, p, 0.5 * (prevThermo.tv + thermo.tv));
      thermo = thermoAtHeight(z, p, li);
      const zKm = z / 1000;
      const verticalFactor = inCenter ? 0.45 * boundaryLayerWindFactor(z, false) : boundaryLayerWindFactor(z, isWall);
      const wSpeed = clamp(localSurfaceWind * verticalFactor + noise(`${key}-sondew-${si}-${li}`, 0.75 + (isWall ? 0.45 : 0)), 0.5, vmax * 1.55);
      // Strong inflow is confined to the boundary layer; above ~8 km the storm-relative flow
      // gradually turns into anticyclonic outflow rather than retaining a surface inflow angle.
      const inflowAngle = (isWall ? 26 : 17) * Math.exp(-z / 1700);
      const outflowTurn = (isWall ? 24 : 15) * smooth01((zKm - 7.5) / 4.5);
      const wDir = wrap360(def.az + 90 - inflowAngle - outflowTurn + 9 * asym * clamp(z / 8000, 0, 1) + noise(`${key}-sondedir-${si}-${li}`, 3.0));
      const uv = windComponents(wSpeed, wDir);
      const mixr = mixingRatioGkg(p, thermo.t, thermo.rh);
      const thetaE = equivalentPotentialTemperatureK(p, thermo.t, thermo.rh);
      rows.push({
        Level: li === 0 || mandatoryLevels.includes(p) ? "MANL" : "SIGL", P: `${p} hPa`, Z: `${Math.round(z)} m`,
        T: `${fmt(thermo.t, 1)}°C`, Td: `${fmt(thermo.td, 1)}°C`, RH: `${fmt(thermo.rh, 0)}%`,
        MixR: `${fmt(mixr, 1)} g/kg`, "Theta-e": `${fmt(thetaE, 1)} K`,
        Wind: `${fmt(wDir, 0)}°/${fmt(wSpeed * 1.94384, 0)} kt`, U: `${fmt(uv.u, 1)} m/s`, V: `${fmt(uv.v, 1)} m/s`, QC: "00"
      });
      prevP = p; prevZ = z; prevThermo = thermo;
    });
    return { name: def.name, lat, lon, rows };
  });

  const eyewallRows = sondes.find(s => s.name === "EYEWALL-IN")?.rows || [];
  const eyewallProfile = eyewallRows.map(row => ({
    pressureHpa: Number(String(row.P).replace(/[^0-9.\-]/g, "")),
    heightM: Number(String(row.Z).replace(/[^0-9.\-]/g, "")),
    tempC: Number(String(row.T).replace(/[^0-9.\-]/g, "")),
    dewC: Number(String(row.Td).replace(/[^0-9.\-]/g, "")),
    windMs: Number(String(row.Wind).split("/")[1]?.replace(/[^0-9.\-]/g, "")) / 1.94384,
  })).filter(v => Number.isFinite(v.pressureHpa) && Number.isFinite(v.tempC));

  const tiltKm = clamp(0.8 + shear * 0.30 + asym * 4.5 + damage * 2.5 + noise(`${key}-tilt`, 0.55), 0.3, 19);
  const maxReflectivity = clamp(39 + 17 * integrity + 8 * strengthening + (rapid ? 5 : 0) - 5 * damage + noise(`${key}-dbz`, 1.6), 31, 70);
  const echoTop = clamp(10.8 + 5.0 * integrity + 2.2 * strengthening + (rapid ? 1.2 : 0) + noise(`${key}-top`, 0.5), 8, 20);
  const azCoverage = clamp(44 + 52 * integrity - 30 * damage - 20 * shearNorm + 10 * strengthening, 12, 100);
  const updraftPeak = clamp(3.8 + 9.0 * integrity + 6.5 * strengthening + (rapid ? 3.0 : 0) - 2.5 * damage + noise(`${key}-upmax`, 0.8), 1.5, 26);
  const radar: Array<[string, string]> = [
    ["尾多普勒雷达最大反射率", `${fmt(maxReflectivity, 1)} dBZ`],
    ["眼墙 40 dBZ 回波顶", `${fmt(echoTop, 1)} km`],
    [">40 dBZ 眼墙方位覆盖率", `${fmt(azCoverage, 0)}%`],
    ["最大径向速度", `${fmt(maxFlightWind * 0.80 + noise(`${key}-vr`, 1.2), 1)} m/s`],
    ["轴对称切向风峰值", `${fmt(maxFlightWind * (0.88 + 0.06 * integrity), 1)} m/s @ ${fmt(rmw + noise(`${key}-rmw-radar`, 1.0), 1)} km`],
    ["眼墙上升气流峰值", `${fmt(updraftPeak, 1)} m/s`],
    ["0.5–6 km 涡旋倾斜", `${fmt(tiltKm, 1)} km toward ${fmt(wrap360((state.shearDir ?? direction + 120)), 0)}°`],
    ["低层 RMW / 中层 RMW", `${fmt(rmw + noise(`${key}-lr`, 0.9), 1)} / ${fmt(rmw * (1.02 + 0.07 * asym + 0.05 * damage), 1)} km`],
    ["次生眼墙/重组信号", (state.secondaryEyewallStrength ?? 0) > 0.2 ? `${Math.round((state.secondaryEyewallStrength ?? 0) * 100)}% coherent` : damage > 0.25 ? `broad reorganization ring · ${Math.round(damage * 100)}% damage` : "未检出显著闭合次生环"],
  ];

  const microphysics: Array<[string, string]> = [
    ["飞行穿越峰值雨率", `${fmt(peakRainObserved, 1)} mm/h（由虚拟SFMR/雷达降水观测算子计算）`],
    ["眼墙最大反射率", `${fmt(maxReflectivity, 1)} dBZ（由虚拟尾多普勒雷达算子计算）`],
    ["眼墙强回波覆盖率", `${fmt(azCoverage, 0)}%（>40 dBZ 方位覆盖）`],
    ["海表温度", state.landed ? "NA（中心在陆地）" : `${fmt(sst, 1)}°C（来自模拟海温场）`],
    ["LWC / TWC", "未计算：当前模拟器没有显式云微物理凝结水方程"],
    ["雨滴谱 / 粒子浓度", "未计算：当前模拟器没有粒子谱或探头采样模型"],
    ["结冰 / 湍流探头量", "未计算：不从反射率或最大风速反推伪观测"],
    ["AXBT / AXCP 海洋剖面", "未计算：当前模型只有海温/OHC环境量，没有真实垂直海洋剖面"],
  ];

  const aircraftEyewallDurationMin = 2 * 1.28 * eyewallSigma / Math.max(350, aircraftGroundMs * 3.6) * 60;
  const structureModeText: Record<string, string> = {
    tropical_depression: "热带低压·松散涡旋", loose_cdo: "松散 CDO", cdo_mature: "成熟 CDO（100–150 km）",
    dvorak_cmg: "增强红外 CMG 冷云环", dvorak_cdg: "增强红外 CDG 冷云环", dvorak_w_ring: "增强红外 W 环极值",
    dry_slot_eroding: "干空气槽卷入·内核部分受保护", dry_leaf: "干空气侵入·干菜化", incense_coil: "干空气侵入·蚊香化", dry_rebuilding_core: "干空气排出·小型松散核心",
    westerly_sheared: "西风带牵引·对流偏置", landfall_disintegrating: "登陆后结构瓦解·降水外散",
    convective_burst: "爆发对流·云填中心",
    reburst_eye_opening: "强对流重组·重新开眼", failed_eye_opening: "爆发对流失败·卷眼堵塞",
    sheared_convective_burst: "强风切下偏置对流爆发", binary_interaction_sheared: "双台风互扰·风切偏置",
    binary_merger_reorganizing: "双台风合并·内核再组织", landfall_intact_cdo: "平原登陆·完整湿核CDO",
    landfall_broken_eyewall: "登陆后破损眼墙",
    tightening_core: "内核收紧", mature_eyewall: "成熟闭合眼墙", ewrc_double: "双眼墙置换",
    post_ewrc_broad: "置换后宽阔环流", terrain_hollow_bands: "地形重创·空洞中心+浓密雨带",
    terrain_clogged_loose: "地形扰动·风眼堵塞+内核松动", terrain_displaced_core: "地形扰动·中心偏移+不对称CDO",
    sheared_small_core: "风切后小内核+大环流", rainband_dominant: "雨带主导·无紧实内核",
    moisture_loaded_broad: "高水汽·流出受限宽阔结构",
    cold_air_remnant_low: "强冷空气摧毁暖心·残留低压云团",
  };
  const failureModeText: Record<string, string> = {
    inner_collapse_outer_stalls: "内墙塌陷、外墙停滞", outer_ring_fractures: "外环断裂", double_eyewall_decay: "双眼墙共同衰减"
  };
  const reconStructure = structureModeText[state.structureMode || ""] || (damage > 0.35 ? "受损重组" : "常规内核");

  const summary: Array<[string, string]> = [
    ["中心定位", `${fmt(fixLat, 3)}°N, ${fmt(fixLon, 3)}°E`],
    ["中心海平面气压", `${fmt(surfacePressureObs, 1)} hPa`],
    ["飞行高度 / 标准层", `${Math.round(altitudeM)} m / ${levelHpa} hPa`],
    ["最大 30s 飞行高度风", `${fmt(maxFlightWind, 1)} m/s (${fmt(maxFlightWind * 1.94384, 0)} kt)`],
    ["最大 SFMR 10 m 风", `${fmt(maxSfmrWind, 1)} m/s (${fmt(maxSfmrWind * 1.94384, 0)} kt)`],
    ["SFMR/雷达眼墙峰值雨率", `${fmt(peakRainObserved, 1)} mm/h`],
    ["RMW（飞机诊断）", `${fmt(rmw + noise(`${key}-rmw`, 1.1), 1)} km / ${fmt(rmwNm, 1)} n mi`],
    ["风眼", `${eyeShape}；${fmt(eyeDiameter + noise(`${key}-eyediam`, 1.2), 1)} km`],
    ["VDM Q 眼内最高飞行高度温度", `${fmt(qTemp, 1)}°C @ ${Math.round(qPa)} m（眼区HDOB实测样本最大值）`],
    ["飞机单侧眼墙穿越", `${fmt(aircraftEyewallDurationMin, 1)} min（30 s HDOB 连续采样）`],
    ["结构诊断", `${reconStructure} · 紧实 ${Math.round(compactness * 100)}% · 雨带 ${Math.round(rainbandDominance * 100)}% · 流出 ${Math.round(outflowEfficiency * 100)}%`],
    ["损伤记忆", `即时损伤 ${Math.round(damage * 100)}% · 重建疤痕 ${Math.round(rebuildScar * 100)}% · 环流膨胀 ${Math.round(circulationExpansion * 100)}%${state.ewrcFailureMode && state.ewrcFailureMode !== "none" ? ` · ${failureModeText[state.ewrcFailureMode] || state.ewrcFailureMode}` : ""}`],
    ["侦察判读", rapid ? "快速增强/爆发对流：内核风梯度增强，但云填眼阶段可暂时无清晰眼" : state.structureMode === "terrain_hollow_bands" ? "严重穿山后中心偏空洞，紧实眼墙缺失，强降水转移至浓密内雨带" : state.structureMode === "terrain_clogged_loose" ? "地形扰动以眼区云填和轻度松动为主，仍保留闭合或近闭合低层内核" : state.structureMode === "terrain_displaced_core" ? "地形扰动使低层中心/对流中心错位，CDO和内雨带呈明显不对称" : state.structureMode === "sheared_small_core" ? "风切通风后仅保留小内核，外侧大环流与不对称雨带占优" : state.structureMode === "moisture_loaded_broad" ? "水汽充足但流出受限：宽阔湿涡旋、强雨带，峰值风受结构天花板限制" : state.structureMode === "dry_slot_eroding" ? "外围干空气槽正卷入：外侧雨带先被侵蚀，但湿润内核仍可暂时维持闭合或近闭合眼墙" : state.structureMode === "dry_leaf" ? "干空气已进入内核：深对流被压制并侵蚀一侧云墙，中心组织度下降、云系呈碎裂叶片状" : state.structureMode === "incense_coil" ? "干空气/通风后仅剩窄而弯曲的主螺旋对流带，核心闭合度偏低" : state.structureMode === "dry_rebuilding_core" ? "干空气减弱后正在重建不超过约50 km直径的松散小内核，对流强弱仍有明显脉动" : state.structureMode === "westerly_sheared" ? "西风带深层风切/通风使中心与深对流错位，降水向下风切侧偏置" : state.structureMode === "landfall_disintegrating" ? "登陆后低层环流与深对流逐步脱耦，紧实核心瓦解并向离散雨带转移" : state.structureMode === "cold_air_remnant_low" ? "32 kt 强冷空气已摧毁暖心：闭合眼墙与热带涡旋崩解，仅剩松散残留低压云团，无副热带或锋面温带结构" : damage > 0.35 ? "核心受损：最大风环变宽，内雨带/重组环增强" : state.ewrcState && state.ewrcState !== "none" ? "双眼墙/结构调整信号" : "常规中心穿越"],
  ];

  const quality: Array<[string, string]> = [
    ["中心定位不确定度", `${fmt(0.9 + 4.0 * asym + 1.2 * damage + noise(`${key}-qfix`, 0.35), 1)} km`],
    ["HDOB 采样", `30 s 平均；模拟地速 ${fmt(aircraftGroundMs * 1.94384, 0)} kt；中心穿越共 ${hdob.length} 个高密度观测`],
    ["飞行高度→海面风", `${levelHpa} hPa 基准折减 ${levelHpa === 700 ? "0.90" : "0.80"}，按眼墙混合/强降雨动态调整`],
    ["SFMR 风速不确定度", `约 ±${fmt(1.5 + 2.2 * clamp(peakRainObserved / 100, 0, 1), 1)} m/s；强降雨条件提高误差并触发 QC`],
    ["dropsonde 热力/边界层", "高度由当地地面气压起算并逐层使用虚温位厚公式积分；露点采用 Magnus 饱和水汽压反演，附混合比/θe；暖核、边界层入流、约0.5 km超梯度风和高层外流均随高度连续变化"],
    ["VDM P/Q/R 取样规则", "P取眼外内核穿越段HDOB最高飞行高度温度；Q取模型眼区内HDOB实测最高温度；R取Q位置露点，中心在海上时同时报告模型海温，陆地上SST记NA"],
    ["VDM S/T 判据", `S仅写入本次虚拟任务实际得到的中心判据（穿越${radarFixEvidence ? "、雷达" : ""}${windFixEvidence ? "、风场" : ""}${pressureFixEvidence ? "、气压" : ""}${tempFixEvidence ? "、温度" : ""}）；T由模拟定位偏差和结构不确定度计算`],
    ["数据属性", "SIMULATED RECON — 台风状态先转换为三维动力/热力结构场，再由 HDOB/SFMR/dropsonde/TDR 各自观测算子取样；探空高度按静力方程积分，热力量按湿空气关系诊断；非原始状态字段复制"],
  ];

  return {
    mission: {
      id: `SIM-${fixDate.toISOString().slice(0, 10).replace(/-/g, "")}-${String(Math.floor(currentHour)).padStart(3, "0")}`,
      aircraft, callsign, fixTime, level: `${levelHpa} hPa`, altitudeM,
      missionType: `Center fix + eyewall penetration + radial legs · ${fmt(aircraftGroundMs * 1.94384, 0)} kt ground speed`
    },
    summary, vdm, recco, hdob, sfmr, sondes, radar, microphysics, quality,
    diagnostics: { centerPass, eyewallProfile }
  };
}

const SECTION_LABELS: Record<ReconSection, string> = {
  summary: "任务摘要", vdm: "VDM 涡旋报文", recco: "RECCO 侦察观测", hdob: "HDOB 高频观测", sfmr: "SFMR 海面遥感",
  dropsonde: "GPS Dropsonde", radar: "尾多普勒雷达", microphysics: "微物理/海气"
};

function KeyValueGrid({ rows }: { rows: Array<[string, string]> }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
    {rows.map(([k, v]) => <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="mt-1 text-sm font-medium text-slate-100 break-words">{v}</div>
    </div>)}
  </div>;
}

function fitReconFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxPx: number, minPx: number, family: string, weight: string | number = 400) {
  let px = Math.max(minPx, maxPx);
  while (px > minPx) {
    ctx.font = `${weight} ${Math.round(px)}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return px;
    px -= Math.max(0.5, px * 0.04);
  }
  ctx.font = `${weight} ${Math.round(minPx)}px ${family}`;
  return minPx;
}

function DataTable({ rows, maxRows }: { rows: Array<Record<string, string | number>>; maxRows?: number }) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  const keys = shown.length ? Object.keys(shown[0]) : [];
  return <div className="overflow-auto rounded-lg border border-slate-800">
    <table className="min-w-full text-[11px]">
      <thead className="sticky top-0 bg-slate-900 text-slate-400"><tr>{keys.map(k => <th key={k} className="px-2.5 py-2 text-left whitespace-nowrap font-semibold">{k}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-800/80">{shown.map((row, i) => <tr key={i} className="bg-slate-950/35 hover:bg-slate-800/40">{keys.map(k => <td key={k} className="px-2.5 py-2 text-slate-200 whitespace-nowrap font-mono">{String(row[k])}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export default function AircraftReconModal({ isOpen, onClose, typhoon, currentHour, startDate, config, initialMode = "details" }: AircraftReconModalProps) {
  const displayName = getTyphoonDisplayName(typhoon, currentHour, startDate);
  const displayTyphoon = useMemo(() => ({ ...typhoon, name: displayName }), [typhoon, displayName]);
  const state = useMemo(() => getStateAtHour(typhoon, currentHour), [typhoon, currentHour]);
  const data = useMemo(() => synthesizeRecon(displayTyphoon, state, currentHour, startDate, config), [displayTyphoon, state, currentHour, startDate, config]);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [crossSectionMode, setCrossSectionMode] = useState(false);
  const [ratio, setRatio] = useState<ReportRatio>("4:3");
  const [width, setWidth] = useState(3840);
  const [title, setTitle] = useState("飞机侦察台风探空报告");
  const [crossTitle, setCrossTitle] = useState("台风径向—高度结构剖面分析");
  const [sections, setSections] = useState<Record<ReconSection, boolean>>({ summary: true, vdm: true, recco: true, hdob: true, sfmr: true, dropsonde: true, radar: true, microphysics: false });
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [crossGeneratedUrl, setCrossGeneratedUrl] = useState<string | null>(null);
  const [crossGenerating, setCrossGenerating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(4);
    setReady(false);
    setReportMode(initialMode === "report");
    setCrossSectionMode(initialMode === "crossSection");
    setGeneratedUrl(null);
    setCrossGeneratedUrl(null);
    let p = 4;
    const timer = window.setInterval(() => {
      p = Math.min(100, p + 6 + Math.round(hash01(`${typhoon.id}-${p}`) * 9));
      setProgress(p);
      if (p >= 100) { window.clearInterval(timer); setReady(true); }
    }, 55);
    return () => window.clearInterval(timer);
  }, [isOpen, typhoon.id, currentHour, initialMode]);

  const ratioWH = ratio === "16:9" ? 16 / 9 : ratio === "3:2" ? 3 / 2 : ratio === "1:1" ? 1 : 4 / 3;
  const height = Math.round(width / ratioWH);

  const toggleSection = (k: ReconSection) => setSections(prev => ({ ...prev, [k]: !prev[k] }));

  const generateReport = async () => {
    setGenerating(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const s = Math.min(width, height) / 1080;
      const serif = `"Times New Roman", "Songti SC", "Noto Serif CJK SC", serif`;
      const sans = `Inter, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
      const mono = `"SFMono-Regular", Consolas, "Liberation Mono", monospace`;
      const pageX = 64 * s;
      const pageW = width - pageX * 2;
      const ink = "#111111";
      const muted = "#444444";
      const grid = "#d7e0e8";
      const rule = "#8fa2b5";
      const accent = "#111111";
      // Match the supplied reconnaissance reference: flight-level wind vivid blue, SFMR dark
      // charcoal, rain bars pale cyan; dropsonde temperature burnt orange, dew point blue and
      // wind bars dark teal. These are report-rendering colours only.
      const flightWindColor = "#2458e8";
      const sfmrWindColor = "#111827";
      const rainColor = "#168db7";
      const rainBarColor = "rgba(104,197,224,0.34)";
      const warm = "#777777";

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4 * s;
      ctx.strokeRect(18 * s, 18 * s, width - 36 * s, height - 36 * s);

      let y = 38 * s;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = ink;
      fitReconFont(ctx, title, pageW - 20 * s, 52 * s, 32 * s, serif, 700);
      ctx.fillText(title, width / 2, y);
      y += 49 * s;
      ctx.fillStyle = "#333333";
      const missionLine = `${displayName}  |  ${data.mission.id}  |  ${data.mission.fixTime}`;
      fitReconFont(ctx, missionLine, pageW - 20 * s, 24 * s, 16 * s, serif, 400);
      ctx.fillText(missionLine, width / 2, y);
      y += 27 * s;
      ctx.font = `${Math.round(19 * s)}px ${sans}`;
      ctx.fillStyle = "#555555";
      ctx.fillText(`${data.mission.callsign} · ${data.mission.level} · ${data.mission.missionType}`, width / 2, y);
      y += 25 * s;
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.moveTo(pageX, y); ctx.lineTo(width - pageX, y); ctx.stroke();
      y += 15 * s;

      const metricIndexes = [1, 3, 4, 6, 10];
      const metricLabels = ["MIN SLP", "MAX FL WIND", "MAX SFMR", "RMW", "CORE STRUCTURE"];
      const metricValues = metricIndexes.map((i, mi) => {
        const raw = data.summary[i]?.[1] || "--";
        return mi === 4 ? raw.split(" · ")[0] : raw;
      });
      const metricW = pageW / metricLabels.length;
      metricLabels.forEach((label, i) => {
        const cx = pageX + metricW * (i + 0.5);
        if (i > 0) {
          ctx.strokeStyle = "#e4e4e4"; ctx.lineWidth = 1 * s;
          ctx.beginPath(); ctx.moveTo(pageX + metricW * i, y); ctx.lineTo(pageX + metricW * i, y + 54 * s); ctx.stroke();
        }
        ctx.fillStyle = muted; ctx.font = `600 ${Math.round(16 * s)}px ${sans}`; ctx.textAlign = "center";
        ctx.fillText(label, cx, y + 2 * s);
        ctx.fillStyle = ink;
        const value = metricValues[i].length > 38 ? metricValues[i].slice(0, 37) + "…" : metricValues[i];
        fitReconFont(ctx, value, metricW - 16 * s, 20 * s, 13 * s, serif, 600);
        ctx.fillText(value, cx, y + 24 * s);
      });
      y += 68 * s;

      const drawPanelFrame = (x: number, py: number, w: number, h: number, titleText: string, subtitle?: string) => {
        ctx.fillStyle = "#ffffff"; ctx.fillRect(x, py, w, h);
        ctx.strokeStyle = "#666666"; ctx.lineWidth = 1.15 * s; ctx.strokeRect(x, py, w, h);
        ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.font = `bold ${Math.round(21 * s)}px ${serif}`;
        ctx.fillText(titleText, x + 14 * s, py + 10 * s);
        if (subtitle) { ctx.fillStyle = "#555555"; ctx.font = `${Math.round(14.5 * s)}px ${sans}`; ctx.fillText(subtitle, x + 14 * s, py + 31 * s); }
      };

      const chartWantedA = sections.hdob || sections.sfmr;
      const chartWantedB = sections.dropsonde;
      const anyChart = chartWantedA || chartWantedB;
      if (anyChart) {
        const chartGap = 18 * s;
        const chartH = Math.min(330 * s, Math.max(225 * s, height * 0.28));
        const chartCount = (chartWantedA ? 1 : 0) + (chartWantedB ? 1 : 0);
        const chartW = chartCount === 2 ? (pageW - chartGap) / 2 : pageW;
        let chartX = pageX;

        if (chartWantedA) {
          drawPanelFrame(chartX, y, chartW, chartH, "Center Penetration / 中心穿越观测剖面", "HDOB 30-s flight-level wind · SFMR 10-m wind · rain rate");
          const dataPts = data.diagnostics.centerPass;
          const plot = { x: chartX + 58 * s, y: y + 58 * s, w: chartW - 112 * s, h: chartH - 128 * s };
          const maxAbsR = Math.max(...dataPts.map(p => Math.abs(p.rangeKm)), 1);
          const maxWind = Math.max(20, ...dataPts.map(p => Math.max(p.flightWindMs, p.surfaceWindMs))) * 1.12;
          const maxRain = Math.max(20, ...dataPts.map(p => p.rainRate)) * 1.10;
          ctx.strokeStyle = grid; ctx.lineWidth = 0.75 * s;
          for (let k = 0; k <= 4; k++) {
            const gy = plot.y + plot.h * k / 4;
            ctx.beginPath(); ctx.moveTo(plot.x, gy); ctx.lineTo(plot.x + plot.w, gy); ctx.stroke();
            ctx.fillStyle = muted; ctx.font = `${Math.round(13.5 * s)}px ${sans}`; ctx.textAlign = "right";
            ctx.fillText(fmt(maxWind * (1 - k / 4), 0), plot.x - 8 * s, gy - 5 * s);
            ctx.textAlign = "left"; ctx.fillStyle = rainColor;
            ctx.fillText(fmt(maxRain * (1 - k / 4), 0), plot.x + plot.w + 8 * s, gy - 5 * s);
          }
          ctx.strokeStyle = "#666666"; ctx.lineWidth = 1.0 * s;
          ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
          const xMap = (r: number) => plot.x + ((r + maxAbsR) / (2 * maxAbsR)) * plot.w;
          const wy = (v: number) => plot.y + plot.h * (1 - v / maxWind);
          const ry = (v: number) => plot.y + plot.h * (1 - v / maxRain);
          // restrained rain bars behind wind curves
          ctx.fillStyle = rainBarColor;
          dataPts.forEach((p, i) => {
            if (i % 2 !== 0) return;
            const bx = xMap(p.rangeKm); const by = ry(p.rainRate);
            ctx.fillRect(bx - 1.5 * s, by, 3 * s, plot.y + plot.h - by);
          });
          const drawLine = (getter: (p: typeof dataPts[number]) => number, stroke: string, dash: number[] = []) => {
            ctx.strokeStyle = stroke; ctx.lineWidth = 2.1 * s; ctx.setLineDash(dash.map(v => v * s)); ctx.beginPath();
            dataPts.forEach((p, i) => { const px = xMap(p.rangeKm); const py = wy(getter(p)); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
            ctx.stroke(); ctx.setLineDash([]);
          };
          drawLine(p => p.flightWindMs, flightWindColor);
          drawLine(p => p.surfaceWindMs, sfmrWindColor, [5, 3]);
          // center and diagnosed RMW guides
          ctx.setLineDash([4 * s, 4 * s]); ctx.strokeStyle = "#a0a0a0"; ctx.lineWidth = 1 * s;
          [-Number(state.rmw || 35), 0, Number(state.rmw || 35)].forEach(r => { const px = xMap(clamp(r, -maxAbsR, maxAbsR)); ctx.beginPath(); ctx.moveTo(px, plot.y); ctx.lineTo(px, plot.y + plot.h); ctx.stroke(); });
          ctx.setLineDash([]);
          ctx.fillStyle = muted; ctx.font = `${Math.round(13.5 * s)}px ${sans}`; ctx.textAlign = "center";
          [-1, -0.5, 0, 0.5, 1].forEach(v => ctx.fillText(`${fmt(maxAbsR * v, 0)} km`, xMap(maxAbsR * v), plot.y + plot.h + 9 * s));
          ctx.fillStyle = flightWindColor; ctx.textAlign = "left"; ctx.fillText("— Flight-level wind (m/s)", plot.x, y + chartH - 20 * s);
          ctx.fillStyle = sfmrWindColor; ctx.fillText("- - SFMR 10-m wind", plot.x + 145 * s, y + chartH - 20 * s);
          ctx.fillStyle = rainColor; ctx.fillText("Rain (mm/h)", plot.x + plot.w - 74 * s, y + chartH - 20 * s);
          chartX += chartW + chartGap;
        }

        if (chartWantedB) {
          drawPanelFrame(chartX, y, chartW, chartH, "Eyewall Dropsonde / 眼墙下投探空", "Temperature · dew point · GPS wind vertical profile");
          const prof = data.diagnostics.eyewallProfile;
          const plot = { x: chartX + 58 * s, y: y + 58 * s, w: chartW - 116 * s, h: chartH - 128 * s };
          const tMin = Math.floor(Math.min(-55, ...prof.map(p => p.dewC)) / 5) * 5;
          const tMax = Math.ceil(Math.max(30, ...prof.map(p => p.tempC)) / 5) * 5;
          const maxWind = Math.max(20, ...prof.map(p => p.windMs)) * 1.12;
          const pTop = Math.min(300, ...prof.map(p => p.pressureHpa));
          const pBottom = Math.max(...prof.map(p => p.pressureHpa), 1000);
          const xTemp = (v: number) => plot.x + ((v - tMin) / Math.max(1, tMax - tMin)) * plot.w;
          const yP = (p: number) => plot.y + (Math.log(p) - Math.log(pTop)) / Math.max(0.01, Math.log(pBottom) - Math.log(pTop)) * plot.h;
          ctx.strokeStyle = grid; ctx.lineWidth = 0.75 * s;
          [1000, 925, 850, 700, 500, 300].filter(p => p >= pTop && p <= pBottom).forEach(p => {
            const py = yP(p); ctx.beginPath(); ctx.moveTo(plot.x, py); ctx.lineTo(plot.x + plot.w, py); ctx.stroke();
            ctx.fillStyle = muted; ctx.font = `${Math.round(13.5 * s)}px ${sans}`; ctx.textAlign = "right"; ctx.fillText(`${p}`, plot.x - 8 * s, py - 5 * s);
          });
          ctx.strokeStyle = "#666666"; ctx.lineWidth = 1.0 * s; ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
          const drawProfile = (getter: (p: typeof prof[number]) => number, stroke: string, dash: number[] = []) => {
            ctx.strokeStyle = stroke; ctx.lineWidth = 2.0 * s; ctx.setLineDash(dash.map(v => v * s)); ctx.beginPath();
            prof.forEach((p, i) => { const px = xTemp(getter(p)); const py = yP(p.pressureHpa); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
            ctx.stroke(); ctx.setLineDash([]);
          };
          // Supplied reference convention: temperature orange/burnt-orange, dew point royal blue,
          // wind bars dark teal.
          const soundingTempColor = "#d97706";
          const soundingDewColor = "#2458e8";
          const soundingWindColor = "#0f4c5c";
          drawProfile(p => p.tempC, soundingTempColor);
          drawProfile(p => p.dewC, soundingDewColor);
          // Wind bar on right edge of the same pressure axis.
          prof.forEach(p => {
            const py = yP(p.pressureHpa);
            const len = clamp(p.windMs / maxWind, 0, 1) * 66 * s;
            ctx.strokeStyle = soundingWindColor; ctx.lineWidth = 2.1 * s; ctx.beginPath(); ctx.moveTo(plot.x + plot.w - len, py); ctx.lineTo(plot.x + plot.w, py); ctx.stroke();
          });
          ctx.fillStyle = soundingTempColor; ctx.font = `${Math.round(13.5 * s)}px ${sans}`; ctx.textAlign = "left"; ctx.fillText("— T (°C)", plot.x, y + chartH - 20 * s);
          ctx.fillStyle = soundingDewColor; ctx.fillText("— Td", plot.x + 72 * s, y + chartH - 20 * s);
          ctx.fillStyle = soundingWindColor; ctx.fillText("Wind bars", plot.x + plot.w - 70 * s, y + chartH - 20 * s);
        }
        y += chartH + 18 * s;
      }

      const selectedCount = (Object.keys(sections) as ReconSection[]).filter(k => sections[k]).length;
      const compact = selectedCount >= 7 || height / width < 0.62;
      const blockTitleSize = (compact ? 16.5 : 18.5) * s;
      const blockTextSize = (compact ? 14.0 : 15.2) * s;
      const rowH = (compact ? 22.5 : 25.0) * s;

      // VDM is the most report-like operational product, so keep it as a clean two-column text block.
      if (sections.vdm && y < height - 170 * s) {
        const rows = data.vdm;
        const vdmRows = Math.ceil(rows.length / 2);
        const h = (38 + vdmRows * (compact ? 21.5 : 23.0)) * s;
        ctx.strokeStyle = "#a0a0a0"; ctx.lineWidth = 1 * s; ctx.strokeRect(pageX, y, pageW, h);
        ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.font = `bold ${Math.round(blockTitleSize)}px ${serif}`;
        ctx.fillText("Vortex Data Message (VDM A–U) / 涡旋数据报文", pageX + 12 * s, y + 8 * s);
        const colW = pageW / 2;
        rows.forEach(([k, v], i) => {
          const col = i >= vdmRows ? 1 : 0;
          const row = col ? i - vdmRows : i;
          const tx = pageX + 12 * s + col * colW;
          const ty = y + 36 * s + row * (compact ? 21.5 : 23.0) * s;
          ctx.fillStyle = "#333333"; ctx.font = `600 ${Math.round(blockTextSize)}px ${mono}`;
          const text = `${k}  ${v}`;
          ctx.fillText(text.length > (compact ? 62 : 70) ? text.slice(0, compact ? 61 : 69) + "…" : text, tx, ty);
        });
        y += h + 14 * s;
      }

      type BriefBlock = { title: string; lines: string[] };
      const blocks: BriefBlock[] = [];
      if (sections.summary) blocks.push({ title: "Mission / Center Fix", lines: data.summary.slice(0, compact ? 6 : 8).map(([k, v]) => `${k}: ${v}`) });
      if (sections.recco) blocks.push({ title: "RECCO", lines: data.recco.slice(0, 3).map((r, i) => `${r.UTC}  ${r.Remarks}  FL ${r["FL wind"]}  ${r.Weather}`) });
      if (sections.hdob) {
        const center = Math.floor(data.hdob.length / 2);
        blocks.push({ title: "HDOB 30-s Excerpt", lines: [center - 8, center - 3, center, center + 3, center + 8].filter(i => i >= 0 && i < data.hdob.length).map(i => {
          const r = data.hdob[i]; return `${r.UTC}  ${r["FL wind 30s"]}  SFMR ${r["SFMR 10s"]}  P ${r["Extrap SLP/D"]}`;
        }) });
      }
      if (sections.sfmr) blocks.push({ title: "SFMR Retrieval", lines: data.sfmr.slice(0, compact ? 4 : 5).map(r => `${r.UTC}  ${r.Range}  Wind ${r["10m wind"]}  Rain ${r["Rain rate"]}  QC ${r.QC}`) });
      if (sections.dropsonde) {
        const wall = data.sondes.find(x => x.name === "EYEWALL-IN");
        blocks.push({ title: "GPS Dropsonde / EYEWALL-IN", lines: (wall?.rows || []).slice(0, compact ? 5 : 6).map(r => `${r.P}  ${r.Z}  T/Td ${r.T}/${r.Td}  ${r.Wind}`) });
      }
      if (sections.radar) blocks.push({ title: "P-3 Tail Doppler Radar", lines: data.radar.slice(0, compact ? 5 : 7).map(([k, v]) => `${k}: ${v}`) });
      if (sections.microphysics) blocks.push({ title: "Microphysics / Air-Sea", lines: data.microphysics.slice(0, compact ? 5 : 7).map(([k, v]) => `${k}: ${v}`) });

      if (blocks.length && y < height - 90 * s) {
        const gap = 12 * s;
        // A three-column evidence grid prevents the default seven-section report from being
        // squeezed into three very short rows.  All supported aspect ratios are landscape/square,
        // so this gives substantially larger readable text without sacrificing content.
        const colCount = blocks.length >= 5 ? 3 : 2;
        const colW = (pageW - gap * (colCount - 1)) / colCount;
        const rowsCount = Math.ceil(blocks.length / colCount);
        const remain = Math.max(110 * s, height - y - 40 * s);
        const blockH = Math.max(62 * s, (remain - gap * Math.max(0, rowsCount - 1)) / rowsCount);
        blocks.forEach((block, i) => {
          const col = i % colCount;
          const row = Math.floor(i / colCount);
          const bx = pageX + col * (colW + gap);
          const by = y + row * (blockH + gap);
          ctx.strokeStyle = "#c9c9c9"; ctx.lineWidth = 0.9 * s; ctx.strokeRect(bx, by, colW, blockH);
          ctx.fillStyle = "#f3f3f3"; ctx.fillRect(bx, by, colW, 32 * s);
          ctx.fillStyle = accent; ctx.fillRect(bx, by, 4 * s, 32 * s);
          ctx.fillStyle = ink; ctx.textAlign = "left";
          fitReconFont(ctx, block.title, colW - 24 * s, blockTitleSize, 12.5 * s, serif, 700);
          ctx.fillText(block.title, bx + 11 * s, by + 7 * s);
          const availableLines = Math.max(1, Math.floor((blockH - 44 * s) / rowH));
          block.lines.slice(0, availableLines).forEach((line, li) => {
            ctx.fillStyle = li % 2 === 0 ? "#222222" : "#555555";
            const raw = line.length > (compact ? 52 : 62) ? line.slice(0, compact ? 51 : 61) + "…" : line;
            fitReconFont(ctx, raw, colW - 20 * s, blockTextSize, 11.2 * s, mono, 400);
            ctx.fillText(raw, bx + 10 * s, by + 40 * s + li * rowH);
          });
        });
      }


      const url = canvas.toDataURL("image/png", 1.0);
      setGeneratedUrl(url);
    } finally {
      setGenerating(false);
    }
  };

  const generateCrossSection = async () => {
    setCrossGenerating(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const s = Math.min(width, height) / 1080;
      const serif = `"Times New Roman", "Songti SC", "Noto Serif CJK SC", serif`;
      const sans = `Inter, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
      const mono = `"SFMono-Regular", Consolas, "Liberation Mono", monospace`;
      const pagePad = Math.max(36 * s, width * 0.030);
      const topPad = Math.max(28 * s, height * 0.026);
      const ink = "#17212b";
      const muted = "#65727e";
      const grid = "#d9e1e6";
      const ocean = "#eaf5f8";
      const panelBg = "#f7fafb";
      const border = "#aab8c2";
      const accent = "#0b6fa4";

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#8797a3";
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.strokeRect(16 * s, 16 * s, width - 32 * s, height - 32 * s);

      const r7 = meanRadius(state.r7);
      const rmw = Math.max(8, state.rmw || 28);
      const vmax = Math.max(0, state.vmax || 0);
      const pmin = state.pmin || 1005;
      const expansion = clamp(state.circulationExpansion ?? 0, 0, 2.5);
      const compactness = clamp(state.coreCompactness ?? 0.55, 0, 1);
      const integrity = clamp(state.eyewallIntegrity ?? 0.62, 0, 1);
      const obstruction = clamp(state.eyeObstruction ?? 0.25, 0, 1);
      const warmCore = clamp(state.eyeWarmCore ?? (vmax >= 33 ? 0.55 : 0.25), 0, 1);
      const rainband = clamp(state.rainbandDominance ?? 0.45, 0, 1);
      const shearKt = Math.max(0, state.forcedShear ?? state.shear ?? 8);
      const maxRadius = clamp(Math.max(300, r7 > 0 ? r7 * 1.45 : rmw * 8.0), 300, 620);
      const zTop = 18;

      let y = topPad;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = ink;
      fitReconFont(ctx, crossTitle, width - pagePad * 2, 46 * s, 27 * s, serif, 700);
      ctx.fillText(crossTitle, width / 2, y);
      y += 46 * s;
      const validTime = new Date(startDate.getTime() + currentHour * 3600_000);
      const subTitle = `${displayName} · ${validTime.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} · ${fmt(state.lat, 2)}°N ${fmt(state.lon, 2)}°E`;
      ctx.fillStyle = "#43515d";
      fitReconFont(ctx, subTitle, width - pagePad * 2, 21 * s, 13 * s, sans, 500);
      ctx.fillText(subTitle, width / 2, y);
      y += 31 * s;

      const footerH = Math.max(198 * s, height * 0.205);
      const chartX = pagePad + 62 * s;
      const chartY = y + 10 * s;
      const chartW = width - pagePad * 2 - 82 * s;
      const chartH = Math.max(250 * s, height - chartY - footerH - 44 * s);
      const xToPx = (xKm: number) => chartX + ((xKm + maxRadius) / (2 * maxRadius)) * chartW;
      const zToPx = (zKm: number) => chartY + chartH - (zKm / zTop) * chartH;

      // Plot background: the lower strip is a schematic ocean boundary, while the atmospheric
      // field remains white so reflectivity / warm-core structure does not compete with UI decoration.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(chartX, chartY, chartW, chartH);
      ctx.fillStyle = ocean;
      ctx.fillRect(chartX, zToPx(0.22), chartW, Math.max(2 * s, zToPx(0) - zToPx(0.22)));

      ctx.save();
      ctx.beginPath(); ctx.rect(chartX, chartY, chartW, chartH); ctx.clip();

      const reflectivityColor = (dbz: number) => {
        if (dbz < 8) return "rgba(255,255,255,0)";
        if (dbz < 18) return "rgba(190,225,238,0.42)";
        if (dbz < 28) return "rgba(80,181,218,0.52)";
        if (dbz < 36) return "rgba(70,174,116,0.58)";
        if (dbz < 44) return "rgba(241,205,60,0.66)";
        if (dbz < 50) return "rgba(240,139,42,0.72)";
        if (dbz < 56) return "rgba(215,65,49,0.76)";
        return "rgba(139,55,132,0.80)";
      };

      // Deterministic pseudo-radar cross section. The geometry follows the canonical tropical
      // cyclone circulation: frictional low-level inflow, a sloping eyewall updraft, upper outflow,
      // subsidence/warming in the eye, and intermittent outer rainbands.
      const cols = Math.max(180, Math.min(360, Math.round(chartW / (8 * s))));
      const rows = Math.max(80, Math.min(180, Math.round(chartH / (7 * s))));
      const cw = chartW / cols;
      const ch = chartH / rows;
      const eyeClearance = clamp(state.eyeClearance ?? 0.3, 0, 1);
      const eyeRadius = Math.max(4, state.eyeRadiusKm || rmw * 0.62);
      const bandRadius = clamp(Math.max(rmw * 3.6, r7 > 0 ? r7 * 0.76 : rmw * 5.1), rmw * 2.4, maxRadius * 0.72);
      const verticalDepth = clamp(12.0 + 3.2 * (vmax / 70) + 1.0 * integrity, 10.8, 16.7);
      for (let iz = 0; iz < rows; iz++) {
        const zKm = zTop * (1 - (iz + 0.5) / rows);
        for (let ix = 0; ix < cols; ix++) {
          const xKm = -maxRadius + (2 * maxRadius) * ((ix + 0.5) / cols);
          const absX = Math.abs(xKm);
          const wallRadius = rmw * (1 + 0.026 * zKm + 0.0035 * zKm * zKm);
          const wallWidth = 8 + 0.17 * rmw + 0.55 * zKm + 4 * (1 - integrity);
          const wallRadial = Math.exp(-0.5 * ((absX - wallRadius) / wallWidth) ** 2);
          const wallVertical = Math.exp(-0.5 * ((zKm - 6.5) / 5.2) ** 2) * clamp((verticalDepth - zKm) / 3.4, 0, 1) +
            0.24 * Math.exp(-0.5 * ((zKm - 12.8) / 2.7) ** 2);
          const innerCdo = Math.exp(-0.5 * (absX / Math.max(45, rmw * 2.1)) ** 2) * Math.exp(-0.5 * ((zKm - 7.2) / 5.6) ** 2) *
            (1 - 0.74 * eyeClearance * Math.exp(-0.5 * (absX / Math.max(5, eyeRadius)) ** 2));
          const bandRadial = Math.exp(-0.5 * ((absX - bandRadius) / (24 + 18 * rainband)) ** 2) +
            0.42 * Math.exp(-0.5 * ((absX - bandRadius * 1.45) / 35) ** 2);
          const bandVertical = Math.exp(-0.5 * ((zKm - 4.2) / 3.8) ** 2) * clamp((12.8 - zKm) / 3, 0, 1);
          const shearAsym = 1 - 0.24 * clamp(shearKt / 35, 0, 1) * (xKm < 0 ? 1 : -0.35);
          const eyeSuppression = absX < eyeRadius * 0.9 ? (0.08 + 0.55 * obstruction) : 1;
          const convective = clamp((0.86 * wallRadial * wallVertical * integrity + 0.28 * innerCdo + 0.42 * bandRadial * bandVertical * (0.5 + rainband)) * shearAsym * eyeSuppression, 0, 1.45);
          const dbz = 5 + 48 * convective + 7 * clamp(vmax / 70, 0, 1) * wallRadial;
          const color = reflectivityColor(dbz);
          if (!color.endsWith(",0)")) {
            ctx.fillStyle = color;
            ctx.fillRect(chartX + ix * cw, chartY + iz * ch, cw + 0.8, ch + 0.8);
          }
        }
      }

      // Warm-core anomaly is shown as restrained red contours rather than another opaque fill.
      const warmPeak = 2.5 + 9.0 * warmCore * clamp(vmax / 65, 0.2, 1.25);
      [2, 4, 6, 8].forEach((level, i) => {
        if (warmPeak < level) return;
        const rxKm = clamp(105 - i * 16 + 22 * expansion, 34, 130);
        const zCenter = 10.2 + 0.35 * i;
        const rzKm = clamp(6.2 - i * 0.55, 2.5, 6.2);
        ctx.strokeStyle = `rgba(185, 55, 48, ${0.34 + i * 0.08})`;
        ctx.lineWidth = Math.max(1.2 * s, 1);
        ctx.setLineDash(i % 2 ? [6 * s, 4 * s] : []);
        ctx.beginPath();
        ctx.ellipse(xToPx(0), zToPx(zCenter), (rxKm / (2 * maxRadius)) * chartW, (rzKm / zTop) * chartH, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Meteorological reference levels.
      const freezingKm = clamp(4.7 + 0.09 * ((config?.sstAnomaly ?? 0) + 0.5) + 0.22 * clamp((state.lat - 12) / 20, -1, 1), 4.3, 5.5);
      ctx.strokeStyle = "rgba(64, 116, 145, 0.70)";
      ctx.lineWidth = Math.max(1.0 * s, 1);
      ctx.setLineDash([7 * s, 5 * s]);
      ctx.beginPath(); ctx.moveTo(chartX, zToPx(freezingKm)); ctx.lineTo(chartX + chartW, zToPx(freezingKm)); ctx.stroke();
      ctx.strokeStyle = "rgba(80, 90, 98, 0.58)";
      ctx.beginPath(); ctx.moveTo(chartX, zToPx(16.2)); ctx.lineTo(chartX + chartW, zToPx(16.2)); ctx.stroke();
      ctx.setLineDash([]);

      // Airflow vectors: only a few canonical arrows, avoiding a cluttered pseudo-vector field.
      const drawArrow = (x1: number, z1: number, x2: number, z2: number, color: string, lw = 2.1) => {
        const ax = xToPx(x1), ay = zToPx(z1), bx = xToPx(x2), by = zToPx(z2);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.2, lw * s);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        const ang = Math.atan2(by - ay, bx - ax); const head = 9 * s;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - head * Math.cos(ang - 0.48), by - head * Math.sin(ang - 0.48));
        ctx.lineTo(bx - head * Math.cos(ang + 0.48), by - head * Math.sin(ang + 0.48)); ctx.closePath(); ctx.fill();
      };
      const inflowExtent = Math.min(maxRadius * 0.78, Math.max(180, r7 || 250));
      drawArrow(-inflowExtent, 0.55, -rmw * 1.20, 0.75, "rgba(24,91,145,0.90)");
      drawArrow(inflowExtent, 0.55, rmw * 1.20, 0.75, "rgba(24,91,145,0.90)");
      drawArrow(-rmw * 1.10, 1.0, -rmw * 1.65, 13.1, "rgba(168,57,48,0.90)", 2.4);
      drawArrow(rmw * 1.10, 1.0, rmw * 1.65, 13.1, "rgba(168,57,48,0.90)", 2.4);
      drawArrow(-rmw * 1.8, 14.0, -maxRadius * 0.67, 15.2, "rgba(72,72,82,0.82)");
      drawArrow(rmw * 1.8, 14.0, maxRadius * 0.67, 15.2, "rgba(72,72,82,0.82)");
      if (eyeClearance > 0.35) drawArrow(0, 12.4, 0, 4.8, "rgba(144,95,54,0.78)", 1.8);
      ctx.restore();

      // Axes, ticks and concise annotations.
      ctx.strokeStyle = "#687985";
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.strokeRect(chartX, chartY, chartW, chartH);
      ctx.font = `${Math.max(11, Math.round(14 * s))}px ${mono}`;
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xStep = maxRadius > 450 ? 200 : 100;
      for (let x = -Math.floor(maxRadius / xStep) * xStep; x <= maxRadius; x += xStep) {
        const px = xToPx(x);
        ctx.strokeStyle = grid; ctx.lineWidth = Math.max(0.7, 0.75 * s);
        ctx.beginPath(); ctx.moveTo(px, chartY); ctx.lineTo(px, chartY + chartH); ctx.stroke();
        ctx.fillStyle = muted; ctx.fillText(x === 0 ? "0" : `${Math.abs(x)}`, px, chartY + chartH + 8 * s);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let z = 0; z <= zTop; z += 3) {
        const py = zToPx(z);
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(chartX, py); ctx.lineTo(chartX + chartW, py); ctx.stroke();
        ctx.fillStyle = muted; ctx.fillText(`${z}`, chartX - 10 * s, py);
      }
      ctx.save();
      ctx.translate(pagePad + 12 * s, chartY + chartH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = ink;
      ctx.font = `600 ${Math.max(12, Math.round(16 * s))}px ${sans}`;
      ctx.fillText("高度 / km", 0, 0);
      ctx.restore();
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = ink;
      ctx.font = `600 ${Math.max(12, Math.round(16 * s))}px ${sans}`;
      ctx.fillText("距台风中心径向距离 / km（左右两侧穿心剖面）", chartX + chartW / 2, chartY + chartH + 30 * s);

      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.font = `600 ${Math.max(10, Math.round(13 * s))}px ${sans}`;
      ctx.fillStyle = "#397395"; ctx.fillText(`0°C层 ~ ${freezingKm.toFixed(1)} km`, chartX + 10 * s, zToPx(freezingKm) - 5 * s);
      ctx.fillStyle = "#59636b"; ctx.fillText("热带对流层顶参考 ~16.2 km", chartX + 10 * s, zToPx(16.2) - 5 * s);
      ctx.fillStyle = "#a33b34"; ctx.fillText("眼墙上升气流", xToPx(rmw * 1.6) + 8 * s, zToPx(10.5));
      ctx.fillStyle = "#8c6035"; if (eyeClearance > 0.35) ctx.fillText("眼区下沉 / 暖核", xToPx(0) + 8 * s, zToPx(7.4));

      // Compact legend.
      const legendY = chartY + 10 * s;
      const legendX = chartX + chartW - 270 * s;
      const legW = 250 * s;
      const legH = 46 * s;
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "rgba(118,135,145,0.72)"; ctx.lineWidth = Math.max(0.8, s);
      ctx.fillRect(legendX, legendY, legW, legH); ctx.strokeRect(legendX, legendY, legW, legH);
      const legendStops = [[15,"#bedfea"],[25,"#50b5da"],[35,"#46ae74"],[42,"#f1cd3c"],[49,"#f08b2a"],[55,"#d74131"],[60,"#8b3784"]] as const;
      const sw = (legW - 20 * s) / legendStops.length;
      legendStops.forEach(([, c], i) => { ctx.fillStyle = c; ctx.fillRect(legendX + 10 * s + i * sw, legendY + 9 * s, sw, 11 * s); });
      ctx.fillStyle = muted; ctx.font = `${Math.max(9, Math.round(10 * s))}px ${mono}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText("模拟雷达反射率代理：15 → 60+ dBZ", legendX + 10 * s, legendY + 26 * s);

      // Bottom diagnostics — fixed fraction layout so 1:1, 4:3 and 16:9 all remain stable.
      const infoY = chartY + chartH + 58 * s;
      const infoBottom = height - 42 * s;
      const infoH = Math.max(90 * s, infoBottom - infoY);
      const gap = 12 * s;
      const cardW = (width - pagePad * 2 - gap * 2) / 3;
      const cards = [
        {
          title: "INNER CORE / 内核",
          rows: [
            ["MSLP", `${Math.round(pmin)} hPa`], ["VMAX", `${fmt(vmax, 1)} m/s`], ["RMW", `${Math.round(rmw)} km`],
            ["Eye", `${Math.round(eyeRadius)} km · ${Math.round(eyeClearance * 100)}% clear`]
          ]
        },
        {
          title: "STRUCTURE / 结构",
          rows: [
            ["Eyewall", `${Math.round(integrity * 100)}% integrity`], ["Warm core", `${warmPeak.toFixed(1)}°C proxy`],
            ["R34/CMA7", r7 > 0 ? `${Math.round(r7)} km mean` : "N/A"], ["Rainband", `${Math.round(rainband * 100)}% dominance`]
          ]
        },
        {
          title: "KINEMATICS / 动力",
          rows: [
            ["Shear", `${fmt(shearKt, 1)} kt`], ["Motion", `${Math.round(state.direction || 0)}° / ${fmt(state.speed || 0, 1)} km/h`],
            ["Inflow", "surface–1 km inward"], ["Outflow", "~13–16 km divergent"]
          ]
        }
      ];
      cards.forEach((card, ci) => {
        const x = pagePad + ci * (cardW + gap);
        ctx.fillStyle = panelBg; ctx.strokeStyle = border; ctx.lineWidth = Math.max(0.8, s);
        ctx.fillRect(x, infoY, cardW, infoH); ctx.strokeRect(x, infoY, cardW, infoH);
        ctx.fillStyle = accent; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.font = `700 ${Math.max(10, Math.round(13 * s))}px ${sans}`;
        ctx.fillText(card.title, x + 12 * s, infoY + 10 * s);
        const rowY = infoY + 32 * s;
        const rowH = Math.max(18 * s, (infoH - 40 * s) / card.rows.length);
        card.rows.forEach(([k,v], ri) => {
          const yy = rowY + ri * rowH;
          ctx.fillStyle = muted; ctx.font = `${Math.max(9, Math.round(11 * s))}px ${sans}`; ctx.fillText(k, x + 12 * s, yy);
          ctx.fillStyle = ink; ctx.font = `600 ${Math.max(9, Math.round(11.5 * s))}px ${mono}`; ctx.textAlign = "right";
          fitReconFont(ctx, v, cardW * 0.58, 11.5 * s, 8.5 * s, mono, 600); ctx.fillText(v, x + cardW - 12 * s, yy);
          ctx.textAlign = "left";
        });
      });

      ctx.fillStyle = "#727d85";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.font = `${Math.max(8, Math.round(10 * s))}px ${sans}`;
      const note = "SIMULATED DIAGNOSTIC · 非真实观测。剖面依据当前模拟强度、RMW、风圈、眼墙完整度、风切和暖核状态构建，用于结构诊断与可视化。";
      fitReconFont(ctx, note, width - pagePad * 2, 10 * s, 7.5 * s, sans, 400);
      ctx.fillText(note, width / 2, height - 21 * s);

      setCrossGeneratedUrl(canvas.toDataURL("image/png", 1.0));
    } finally {
      setCrossGenerating(false);
    }
  };

  const downloadGenerated = () => {
    if (!generatedUrl) return;
    const a = document.createElement("a"); a.href = generatedUrl; a.download = `${displayName}_飞机探空_${Math.floor(currentHour)}h_${width}x${height}.png`; a.click();
  };

  const downloadCrossGenerated = () => {
    if (!crossGeneratedUrl) return;
    const a = document.createElement("a");
    a.href = crossGeneratedUrl;
    a.download = `${displayName}_台风剖面_${Math.floor(currentHour)}h_${width}x${height}.png`;
    a.click();
  };

  if (!isOpen) return null;

  if (!ready) return <div className="aircraft-recon-overlay fixed inset-0 z-[7500] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-4">
    <div className="w-full max-w-md rounded-2xl border border-sky-900/60 bg-slate-900 p-7 shadow-2xl">
      <div className="flex items-center gap-3"><Plane className="w-7 h-7 text-sky-400"/><div><div className="text-lg font-bold text-white">正在合成飞机探空</div><div className="text-xs text-slate-400">构建中心穿越、RECCO、SFMR、dropsonde、HDOB 与雷达观测算子</div></div></div>
      <div className="mt-6 h-2.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }}/></div>
      <div className="mt-2 text-right text-xs font-mono text-sky-300">{progress}%</div>
    </div>
  </div>;

  return <div className="aircraft-recon-overlay fixed inset-0 z-[7500] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-3 md:p-5">
    <div className="aircraft-recon-panel w-full max-w-6xl h-[92vh] rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl overflow-hidden flex flex-col">
      <header className="shrink-0 px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-sky-950/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {(reportMode || crossSectionMode) ? <button onClick={() => { setReportMode(false); setCrossSectionMode(false); }} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="返回探空详情" aria-label="返回探空详情"><ChevronLeft className="w-4 h-4"/></button> : <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/30"><Plane className="w-5 h-5 text-sky-300"/></div>}
          <div className="min-w-0"><h2 className="text-lg font-bold text-white truncate">{reportMode ? "探空报告图生成" : crossSectionMode ? "台风剖面图生成" : "飞机探空"}</h2><p className="text-[11px] text-slate-400 truncate">{data.mission.callsign} · {data.mission.fixTime} · {data.mission.level}</p></div>
        </div>
        <div className="flex items-center gap-2">
          {!reportMode && !crossSectionMode && <button onClick={() => { setCrossSectionMode(false); setReportMode(true); }} className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20" title="生成探空报告图" aria-label="生成探空报告图"><ImagePlus className="w-4 h-4"/></button>}
          {!reportMode && !crossSectionMode && <button onClick={() => { setReportMode(false); setCrossSectionMode(true); }} className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20" title="生成台风径向—高度剖面图" aria-label="生成台风径向—高度剖面图"><BarChart3 className="w-4 h-4"/></button>}
          <button onClick={onClose} className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="关闭" aria-label="关闭"><X className="w-4 h-4"/></button>
        </div>
      </header>

      {reportMode ? <div className="aircraft-recon-report-content flex-1 overflow-y-auto p-5 md:p-6">
        <div className="aircraft-recon-report-layout grid lg:grid-cols-[1fr_1.15fr] gap-5">
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-4 space-y-4">
              <h3 className="font-bold text-slate-100 flex items-center gap-2"><ImagePlus className="w-4 h-4 text-sky-400"/>图片参数</h3>
              <label className="block text-xs text-slate-400">标题<input value={title} onChange={e => setTitle(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"/></label>
              <div><div className="text-xs text-slate-400 mb-2">图片比例</div><div className="grid grid-cols-4 gap-2">{(["4:3","16:9","3:2","1:1"] as ReportRatio[]).map(r => <button key={r} onClick={() => setRatio(r)} className={`rounded-lg border px-2 py-2 text-xs ${ratio===r ? "border-sky-500 bg-sky-500/15 text-sky-300" : "border-slate-700 text-slate-400"}`}>{r}</button>)}</div></div>
              <label className="block text-xs text-slate-400">长边分辨率<select value={width} onChange={e => setWidth(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">{[1920,2560,3840,5120].map(w => <option key={w} value={w}>{w}px · 输出 {w}×{Math.round(w/ratioWH)}</option>)}</select></label>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"><h3 className="font-bold text-slate-100 mb-3">可选信息</h3><div className="grid sm:grid-cols-2 gap-2">{(Object.keys(SECTION_LABELS) as ReconSection[]).map(k => <label key={k} className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={sections[k]} onChange={() => toggleSection(k)} className="accent-sky-500"/>{SECTION_LABELS[k]}</label>)}</div></section>
            <button onClick={generateReport} disabled={generating} className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">{generating ? <Activity className="w-4 h-4 animate-spin"/> : <ImagePlus className="w-4 h-4"/>}{generating ? "正在绘制高分辨率 PNG…" : "生成专业 PNG 报告图"}</button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 min-h-[520px] flex flex-col">
            <div className="flex items-center justify-between mb-3"><div><div className="font-bold text-slate-100">输出预览</div><div className="text-xs text-slate-500">{width} × {height}px · PNG</div></div>{generatedUrl && <button onClick={downloadGenerated} className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5"><Download className="w-4 h-4"/>下载 PNG</button>}</div>
            <div className="flex-1 rounded-lg bg-black/40 flex items-center justify-center overflow-auto p-2">{generatedUrl ? <img src={generatedUrl} alt="飞机探空报告预览" className="max-w-full max-h-[70vh] object-contain shadow-2xl"/> : <div className="text-center text-slate-600"><ImagePlus className="w-12 h-12 mx-auto mb-3 opacity-50"/><div className="text-sm">设置参数后生成报告图</div></div>}</div>
          </div>
        </div>
      </div> : crossSectionMode ? <div className="aircraft-recon-report-content flex-1 overflow-y-auto p-5 md:p-6 touch-pan-y overscroll-contain">
        <div className="aircraft-recon-report-layout grid lg:grid-cols-[0.9fr_1.35fr] gap-5">
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-800 bg-slate-950/35 p-4 space-y-4">
              <h3 className="font-bold text-slate-100 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-400"/>剖面图参数</h3>
              <label className="block text-xs text-slate-400">标题<input value={crossTitle} onChange={e => setCrossTitle(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"/></label>
              <div><div className="text-xs text-slate-400 mb-2">图片比例</div><div className="grid grid-cols-4 gap-2">{(["4:3","16:9","3:2","1:1"] as ReportRatio[]).map(r => <button key={r} onClick={() => setRatio(r)} className={`rounded-lg border px-2 py-2 text-xs ${ratio===r ? "border-cyan-500 bg-cyan-500/15 text-cyan-300" : "border-slate-700 text-slate-400"}`}>{r}</button>)}</div></div>
              <label className="block text-xs text-slate-400">清晰度 / 长边分辨率<select value={width} onChange={e => setWidth(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">{[1920,2560,3840,5120].map(w => <option key={w} value={w}>{w}px · 输出 {w}×{Math.round(w/ratioWH)}</option>)}</select></label>
              <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/15 p-3 text-[11px] leading-relaxed text-slate-400">
                径向—高度剖面使用当前模拟的 Vmax、MSLP、RMW、七级风圈、眼墙完整度、暖核、风切与雨带状态构建；绘制眼墙上升、近地面入流、高层外流、眼区下沉、0°C 层、对流层顶与模拟雷达反射率代理。它是结构诊断图，不冒充真实飞机雷达观测。
              </div>
            </section>
            <button onClick={generateCrossSection} disabled={crossGenerating} className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">{crossGenerating ? <Activity className="w-4 h-4 animate-spin"/> : <BarChart3 className="w-4 h-4"/>}{crossGenerating ? "正在绘制高分辨率剖面 PNG…" : "生成专业台风剖面图"}</button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 min-h-[520px] flex flex-col">
            <div className="flex items-center justify-between mb-3"><div><div className="font-bold text-slate-100">剖面输出预览</div><div className="text-xs text-slate-500">{width} × {height}px · PNG · 径向穿心剖面</div></div>{crossGeneratedUrl && <button onClick={downloadCrossGenerated} className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5"><Download className="w-4 h-4"/>下载 PNG</button>}</div>
            <div className="flex-1 rounded-lg bg-black/40 flex items-center justify-center overflow-auto p-2 touch-pan-y">{crossGeneratedUrl ? <img src={crossGeneratedUrl} alt="台风径向高度剖面图预览" className="max-w-full max-h-[70vh] object-contain shadow-2xl"/> : <div className="text-center text-slate-600"><BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50"/><div className="text-sm">选择比例与清晰度后生成剖面图</div></div>}</div>
          </div>
        </div>
      </div> : <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-5 touch-pan-y overscroll-contain">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[[Gauge,"中心最低压",data.summary[1][1]],[Wind,"SFMR 10m 最大风",data.summary[4][1]],[Radar,"RMW",data.summary[6][1]],[Droplets,"眼墙雨率",data.summary[5][1]]].map(([Icon,label,value]: any) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"><Icon className="w-4 h-4 text-sky-400"/><div className="mt-2 text-[10px] text-slate-500">{label}</div><div className="mt-0.5 text-sm font-bold text-white">{value}</div></div>)}
        </div>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Plane className="w-4 h-4 text-sky-400"/>任务与中心穿越</h3><KeyValueGrid rows={data.summary}/></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200">Vortex Data Message（VDM）</h3><KeyValueGrid rows={data.vdm}/></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Plane className="w-4 h-4 text-sky-400"/>RECCO / 侦察位置天气观测</h3><DataTable rows={data.recco}/></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400"/>HDOB / 30 秒高密度飞行高度观测</h3><DataTable rows={data.hdob}/></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Wind className="w-4 h-4 text-cyan-400"/>SFMR 海面风、雨率与六通道亮温</h3><DataTable rows={data.sfmr}/></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Thermometer className="w-4 h-4 text-amber-400"/>GPS Dropsonde / AVAPS 垂直廓线</h3><div className="space-y-3">{data.sondes.map(sonde => <details key={sonde.name} open={sonde.name === "EYEWALL-IN"} className="rounded-xl border border-slate-800 bg-slate-950/35 overflow-hidden"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-200">{sonde.name} · {fmt(sonde.lat,3)}°N {fmt(sonde.lon,3)}°E</summary><div className="px-3 pb-3"><DataTable rows={sonde.rows}/></div></details>)}</div></section>
        <div className="grid lg:grid-cols-2 gap-4"><section><h3 className="mb-2 text-sm font-bold text-slate-200 flex items-center gap-2"><Radar className="w-4 h-4 text-violet-400"/>P-3 尾多普勒雷达</h3><KeyValueGrid rows={data.radar}/></section><section><h3 className="mb-2 text-sm font-bold text-slate-200">云微物理 / 海气投弃探头</h3><KeyValueGrid rows={data.microphysics}/></section></div>
        <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/15 p-4"><div className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 className="w-4 h-4"/>观测算子与质量控制</div><div className="mt-3"><KeyValueGrid rows={data.quality}/></div><p className="mt-3 text-[10px] leading-relaxed text-slate-500">字段组织参考 NOAA/NHC Hurricane Hunter 常用 RECCO、HDOB、SFMR、TEMPDROP、VDM 与 NOAA P-3 雷达/微物理数据类别；本页全部数值均为模拟衍生观测，不代表真实天气或真实侦察任务。</p></section>
      </div>}
    </div>
  </div>;
}
