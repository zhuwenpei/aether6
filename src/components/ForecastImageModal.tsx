import { loadAgencyBranding, saveAgencyBranding, applyAgencyBrandingGlobally, clearAgencyBranding, DEFAULT_AGENCY_BRANDING } from "../utils/AgencyBranding";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { X, Download, AlertTriangle, Monitor, Settings, Check, RefreshCw, Copy, BarChart3, Table, Plane, Square, CloudRain, ImagePlus, Film } from "lucide-react";
import { TyphoonCategory } from "../types";
import type { Typhoon, TyphoonState, SimulationConfig } from "../types";
import { getWindForceCategory, getAgencyIntensity, materializeForecastPath, getDetailedLandName, fetchOsmCityName, getProceduralElevation, getStandardAverageWindRadii, calculateStationReadings } from "../simulation/Engine";
import {
  productLandGeoJson as landGeoJson,
  productCoastlineGeoJson as nmcFineCoastlineGeoJson,
  productCountriesGeoJson as countriesGeoJson,
  loadProductNaturalEarthData,
  checkPointOnLandGeoJson,
  getLandfallCountryGeoJson
} from "../simulation/NaturalEarthLoader";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend, Cell } from "recharts";
import AircraftReconModal from "./AircraftReconModal";
import CloudCompositorModal from "../cloudCompositor/CloudCompositorModal";
import { drawObservedRainfallMap, RainfallAspectRatio, RainfallLegendStyle, RainfallMapPalette } from "../utils/ObservedRainfallMap";
import { drawSynopticWindPressureMap, SYNOPTIC_TITLE_MODEL_LABEL, type SynopticWindPressureStyle } from "../utils/SynopticWindPressureMap";
import { type SynopticProductAspect } from "../utils/SynopticProductLayout";
import { generateSynopticWindPressureVideo, type SynopticVideoResolution } from "../utils/SynopticWindPressureVideo";
import { isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";
import { getTyphoonDisplayName, getTyphoonOfficialNumber, getTyphoonOrdinalNumber } from "../utils/TyphoonDisplayName";
import { mergeTyphoonStateWithCurrentIdentity } from "../utils/TyphoonIdentity";
import { drawCyclonePhaseSpaceProduct } from "../utils/CyclonePhaseSpaceProduct";
import { AETHER_MODEL_SPECS, AETHER_ENSEMBLE_MEMBER_COUNTS, buildAetherCenterGuidance, buildAetherEnsembleMembers, smoothGuidanceTrackForDisplay, type AetherGuidanceMember } from "../simulation/AetherEnsembleGuidance";
import { drawEnsembleReferenceProductAsync, ENSEMBLE_REFERENCE_STYLES, ensembleReferenceStyleNeedsMembers, getEnsembleReferenceAspect, type EnsembleReferenceStyle } from "../utils/EnsembleReferenceProducts";
import type { StrikeProbabilityOptions } from "../utils/StrikeProbabilityProduct";
import {strikeStreamingCell, type StrikeField} from "../utils/StrikeProbabilityField";
import { strokeProductCoastlineRing } from "../utils/ProductCoastlineDrawing";
import { calculateJmaWindCircleGeometry, meetsJmaWindAreaThreshold } from "../utils/JmaWindRadii";
import { JMA_PRODUCT_COLORS, LOCAL_VECTOR_BASEMAPS } from "../utils/LocalVectorBasemaps";
import { drawNmcForecastProductCooperative, hasNmcRenderedContent, selectNmcIssuedForecast } from "../utils/NmcForecastProduct";
import { chooseSafeNmcWidth, detectNmcDeviceClass } from "../utils/NmcRenderSafety";
import { loadNmcOptionalGeography, type NmcExtraVectors } from "../utils/NmcOptionalGeography";
import { drawJmaTerminationPlate } from "../utils/JmaTerminationPlate";
import { limitNmcGenesisPeak, shapeNmcPeakIntensity } from "../simulation/NmcIntensityGuidance";
import { issuePreSimulationReference } from "../simulation/PreSimulationReference";
import { northPolarStereographicScaleFactor, projectNorthPolarStereographicKm } from "../utils/MapProjection";

interface ForecastImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSynopticMapSelection?: () => void;
  pickedSynopticBounds?: { lonMin: number; lonMax: number; latMin: number; latMax: number } | null;
  typhoon: Typhoon;
  /** All active storms are supplied so the ported Spawner.getWind can include nearby-storm circulation. */
  typhoons?: Typhoon[];
  currentHour: number;
  /** Fractional live-model time used only by the accumulated observed-rainfall product. */
  observedRainfallEndHour?: number;
  maxHour?: number;
  startDate: Date;
  config?: SimulationConfig;
  mobileMode?: boolean;
  /** Flush the live simulation before a heavy wind-field render so mobile tab recovery cannot roll back progress. */
  onBeforeHeavyGeneration?: () => void;
  /** Checkpoint the live refs again after the cooperative render because the simulator may advance while it runs. */
  onAfterHeavyGeneration?: () => void;
  /** Enter the standalone Round190 read-only typhoon network simulation. */
  onOpenTyphoonNetwork?: () => void;
}

// Projection bounds for East Asia to match template coordinates precisely
const MIN_LON = 95.0;
const MAX_LON = 138.0;
const MIN_LAT = 12.0;
const MAX_LAT = 38.0;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const isPreTropicalStormGenesisIssue = (storm: Typhoon | TyphoonState): boolean => {
  const vmax = Number(storm?.vmax || 0);
  if (!Number.isFinite(vmax) || vmax >= 17.2 || !!(storm as any)?.dissipated) return false;
  const issueHour = Number.isFinite(Number((storm as any)?.simHour)) ? Number((storm as any).simHour) : Number.POSITIVE_INFINITY;
  const reachedTsBeforeIssue = ((storm as any)?.history || []).some((state: any) =>
    Number(state?.simHour || 0) <= issueHour + 1e-6 && Number(state?.vmax || 0) >= 17.2
  );
  const integrity = Number((storm as any)?.lowLevelVortexIntegrity ?? 0.58);
  return !reachedTsBeforeIssue && integrity > 0.18;
};

/** Product-safe forecast materialization. A never-yet-TS genesis issue at the 5 m/s floor is not
 * an operational stop signal. The ordinary forecast is always tried first; only a genuine 0 h-only
 * result receives residual integration as a genesis fallback. */
const materializeProductForecast = (
  storm: Typhoon,
  cfg: SimulationConfig | undefined,
  horizon: number,
  geometry?: any[],
  forceResidual = false,
  strengthPolicy: 'adaptive' | 'round164' = 'adaptive'
) => {
  const primary = materializeForecastPath(storm, cfg, horizon, geometry, forceResidual, {intensityPolicy:strengthPolicy});
  if (forceResidual || !isPreTropicalStormGenesisIssue(storm)) return primary;
  const maxLead = primary.reduce((m: number, pt: any) => Math.max(m, Number(pt?.simHour || 0)), 0);
  return maxLead > 1e-6 ? primary : materializeForecastPath(storm, cfg, horizon, geometry, true, {intensityPolicy:strengthPolicy});
};

// Exact station ranking memoization: keyed by the immutable history array object used by
// the current timeline branch. Reopening/changing ranking tabs reuses the same physical
// station diagnostics without reducing spatial/temporal quality.
const stationRankingMemo = new WeakMap<any[], Map<string, any[]>>();

// Forecast products must reconstruct from the most recent archived simulation seed at or before
// the selected cursor, never from the newest storm/config state. Histories are monotonic by hour.
const findForecastSeedAtOrBefore = (history: TyphoonState[] | undefined, hour: number): TyphoonState | undefined => {
  if (!history?.length) return undefined;
  let lo = 0, hi = history.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const h = Number(history[mid]?.simHour);
    if (h <= hour + 1e-6) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 ? history[best] : undefined;
};

const RESOLUTIONS = [
  { id: "1080p", name: "1080p (高清)", width: 1920, height: 1440 },
  { id: "2k", name: "2K (极清)", width: 2560, height: 1920 },
  { id: "4k", name: "4K (超清)", width: 3840, height: 2880 },
  { id: "8k", name: "8K (极高)", width: 7680, height: 5760 }
];

const getAngularRadius = (
  r: { ne?: number; se?: number; sw?: number; nw?: number } | undefined,
  angleRad: number,
  defaultVal: number
): number => {
  const ne = r?.ne ?? defaultVal;
  const se = r?.se ?? defaultVal;
  const sw = r?.sw ?? defaultVal;
  const nw = r?.nw ?? defaultVal;

  let deg = (angleRad * 180) / Math.PI;
  if (deg < 0) deg += 360;

  // NE center: 45 deg, NW center: 135 deg, SW center: 225 deg, SE center: 315 deg
  let shifted = (deg - 45) % 360;
  if (shifted < 0) shifted += 360;

  const segment = shifted / 90;
  const idx = Math.floor(segment);
  const frac = segment - idx;

  const t = (1 - Math.cos(frac * Math.PI)) / 2;

  if (idx === 0) {
    return ne * (1 - t) + nw * t;
  } else if (idx === 1) {
    return nw * (1 - t) + sw * t;
  } else if (idx === 2) {
    return sw * (1 - t) + se * t;
  } else {
    return se * (1 - t) + ne * t;
  }
};

const getMeanRadius = (
  rQuad: { ne: number; se: number; sw: number; nw: number } | undefined,
  defaultVal: number
): number => {
  if (!rQuad) return defaultVal;
  const sum = (rQuad.ne || 0) + (rQuad.se || 0) + (rQuad.sw || 0) + (rQuad.nw || 0);
  const count = ((rQuad.ne || 0) > 0 ? 1 : 0) + ((rQuad.se || 0) > 0 ? 1 : 0) + ((rQuad.sw || 0) > 0 ? 1 : 0) + ((rQuad.nw || 0) > 0 ? 1 : 0);
  return count > 0 ? sum / count : defaultVal;
};

const getTyphoonWindSpeed = (
  distKm: number,
  angleToPt: number,
  cvmax: number,
  radSnap: any,
  isLand: boolean = false,
  ewrcState: string = "none",
  ewrcProgress: number = 0
): { w_ty: number; rmw_km: number } => {
  let orgFactor = Math.min(1.0, Math.max(0.0, (cvmax - 28.0) / 55.0));
  if (isLand) orgFactor *= 0.25;

  // Use mean reference radii to maintain circular vortex symmetry (正圆)
  const r34_raw = getMeanRadius(radSnap?.r34 || radSnap?.r7, 220);
  const r50_raw = getMeanRadius(radSnap?.r50 || radSnap?.r10, 110);
  const r64_raw = getMeanRadius(radSnap?.r64 || radSnap?.r12, 45);

  const r34_eff = Math.max(35, r34_raw);
  const r50_eff = Math.max(25, r50_raw);
  const r64_eff = Math.max(18, r64_raw);

  // Compactness constraint: High intensity -> tight eye, Max 25km post-ERC constraint
  let baseRmw = Math.max(10, Math.min(65, r64_eff * (0.65 - 0.2 * orgFactor))); 
  
  if (ewrcState === "completed" || (ewrcState === "none" && radSnap?.ewrcCount > 0)) {
     baseRmw = Math.min(baseRmw, 25.0); // Rule 11 constraint
  }

  const rmw_km = baseRmw * (1.0 + 0.35 * (1.0 - orgFactor));
  let w_ty = 0;

  // Double eyewall logic during EWRC
  let outer_rmw_km = rmw_km * 2.5;
  let outer_w_ty = 0;
  let inner_w_ty = cvmax;

  if (ewrcState === "forming" || ewrcState === "max_decay") {
      inner_w_ty = cvmax * (1.0 - ewrcProgress * 0.4); 
      outer_w_ty = cvmax * (0.5 + ewrcProgress * 0.4);
  } else if (ewrcState === "recovering_success" || ewrcState === "recovering_failure") {
      inner_w_ty = 0; // old eye dissipated
      outer_w_ty = cvmax;
      // New eye contracts
      outer_rmw_km = outer_rmw_km - (outer_rmw_km - Math.min(rmw_km * 1.5, 25.0)) * ewrcProgress;
  }

  if (ewrcState !== "none" && ewrcState !== "completed") {
      // Double eyewall blending
      if (distKm < rmw_km) {
          const eyeExponent = orgFactor >= 0.7 ? 1.5 : 0.8;
          w_ty = inner_w_ty * Math.pow(distKm / rmw_km, eyeExponent);
      } else if (distKm < outer_rmw_km) {
          // Gap between inner and outer
          const gapFraction = (distKm - rmw_km) / (outer_rmw_km - rmw_km);
          // Inner eye decay using Holland
          const r_ratio_in = rmw_km / distKm;
          const r_ratio_in_b = Math.pow(r_ratio_in, 1.5);
          const gapWind = inner_w_ty * Math.sqrt(r_ratio_in_b * Math.exp(1.0 - r_ratio_in_b)) * (1.0 - gapFraction);
          
          const outerRamp = outer_w_ty * Math.pow(gapFraction, 2.0);
          w_ty = gapWind + outerRamp;
      } else {
          // Outside outer eye using fluid model
          const b = 2.0 * Math.log(34 / (outer_w_ty * 1.6487)) / Math.log(outer_rmw_km / r34_eff);
          const b_eff = Math.max(0.5, Math.min(3.0, b));
          const r_ratio = outer_rmw_km / distKm;
          const r_ratio_b = Math.pow(r_ratio, b_eff);
          w_ty = outer_w_ty * Math.sqrt(r_ratio_b * Math.exp(1.0 - r_ratio_b));
          
          if (distKm > r34_eff) {
            const dropFactor = Math.pow(r34_eff / distKm, 2.5);
            w_ty = w_ty * dropFactor;
          }
      }
      return { w_ty, rmw_km: outer_rmw_km };
  }

  if (distKm <= rmw_km) {
    const eyeExponent = orgFactor >= 0.7 ? 1.5 : 0.8;
    w_ty = cvmax * Math.pow(distKm / rmw_km, eyeExponent);
  } else {
    // Fluid model: Holland B profile derivative for smooth natural transitions
    // V(r) = Vmax * sqrt( (Rmw/r)^B * exp(1 - (Rmw/r)^B) )
    // We calculate a distance-dependent B parameter to anchor to reference radii
    const getB = (targetV: number, targetR: number) => {
      if (targetV >= cvmax || targetR <= rmw_km) return 1.5;
      // Approximation for r > rmw: V(r) ≈ Vmax * sqrt(e) * (rmw/r)^(B/2)
      // => B ≈ 2 * ln( V(r) / (Vmax * sqrt(e)) ) / ln(rmw / r)
      const b = 2.0 * Math.log(targetV / (cvmax * 1.6487)) / Math.log(rmw_km / targetR);
      return Math.max(0.5, Math.min(3.0, b));
    };

    let b_eff = 1.5;
    const b34 = getB(34, r34_eff);
    const b50 = getB(50, r50_eff);
    const b64 = getB(64, r64_eff);

    if (distKm >= r50_eff) {
      const f = Math.max(0, Math.min(1.0, (distKm - r50_eff) / Math.max(1, r34_eff - r50_eff)));
      b_eff = b50 * (1 - f) + b34 * f;
    } else if (distKm >= r64_eff) {
      const f = Math.max(0, Math.min(1.0, (distKm - r64_eff) / Math.max(1, r50_eff - r64_eff)));
      b_eff = b64 * (1 - f) + b50 * f;
    } else {
      b_eff = b64;
    }

    const r_ratio = rmw_km / distKm;
    const r_ratio_b = Math.pow(r_ratio, b_eff);
    w_ty = cvmax * Math.sqrt(r_ratio_b * Math.exp(1.0 - r_ratio_b));

    // Natural steep drop-off outside 7-level wind radius (r34)
    if (distKm > r34_eff) {
      const dropFactor = Math.pow(r34_eff / distKm, 2.5);
      w_ty = w_ty * dropFactor;
    }
    if (w_ty < 0.5) w_ty = 0;
  }

  return { w_ty, rmw_km };
};

const getSimulatedScatWind = (
  rawWind: number,
  distKm: number,
  rmw_km: number,
  cvmax: number // cvmax here should be exact to 1 decimal place (e.g. from Number((vmax * 1.9438).toFixed(1)))
): number => {
  const exactCvmax = cvmax;

  // Peak reduction at the core center: 5 to 25 kt.
  // Weakest typhoon: ~30 kt (15 m/s) -> 5 kt reduction
  // Strongest typhoon: ~140 kt (72 m/s) -> 25 kt reduction
  let coreReduction = 5 + ((exactCvmax - 30) / (140 - 30)) * 20;
  coreReduction = Math.max(5, Math.min(25, coreReduction));

  // The attenuation is highest at the core and decays to 0 as distance increases.
  const decayScale = rmw_km * 2.2;
  const decayFactor = Math.exp(-Math.pow(distKm / decayScale, 2));

  const reduction = coreReduction * decayFactor;

  let simulated = rawWind - reduction;

  // Keep simulated wind field's lower bound reasonable for active wind zones
  if (rawWind > 15) {
    simulated = Math.max(10, simulated);
  }

  // CRITICAL RULE: "风场kt值只可能比直接把台风强度从m/s换算成kt之后的值低，而不可能更高。"
  // In the core area, the wind speed must be strictly capped below exactCvmax - reduction.
  if (distKm < rmw_km * 4.0) {
    const maxAllowed = exactCvmax - (coreReduction * 0.8 * decayFactor);
    if (simulated > maxAllowed) {
      simulated = maxAllowed;
    }
  }

  return Math.max(1.0, simulated);
};

export default function ForecastImageModal({
  isOpen,
  onClose,
  onStartSynopticMapSelection,
  pickedSynopticBounds,
  typhoon,
  typhoons = [typhoon],
  currentHour,
  observedRainfallEndHour,
  maxHour,
  startDate,
  config: baseConfigProps,
  mobileMode = false,
  onBeforeHeavyGeneration,
  onAfterHeavyGeneration,
  onOpenTyphoonNetwork
}: ForecastImageModalProps) {
  // Forecast products must be reproducible when scrubbing historical simulation time.  In
  // particular, a route framework that was active at that hour belongs to that historical
  // forecast issue and must not be replaced by the user's *current* route setting.
  const isHistoricalIssue = maxHour !== undefined && currentHour < maxHour;
  const activeHistoryState = isHistoricalIssue
    ? (findForecastSeedAtOrBefore(typhoon.history, currentHour)
      || (typhoon.history && typhoon.history.length > 0 ? typhoon.history[0] : null))
    : null;
  const historicalConfig = activeHistoryState?.configSnapshot || baseConfigProps;
  const config = historicalConfig || baseConfigProps;

  // Compass direction conversion helper
  const getCompassDirection = (deg: number): string => {
    const d = (deg % 360 + 360) % 360;
    const directions = [
      { label: "正北", min: 348.75, max: 11.25 },
      { label: "东北偏北", min: 11.25, max: 33.75 },
      { label: "东北", min: 33.75, max: 56.25 },
      { label: "东北偏东", min: 56.25, max: 78.75 },
      { label: "正东", min: 78.75, max: 101.25 },
      { label: "东南偏东", min: 101.25, max: 123.75 },
      { label: "东南", min: 123.75, max: 146.25 },
      { label: "东南偏南", min: 146.25, max: 168.75 },
      { label: "正南", min: 168.75, max: 191.25 },
      { label: "西南偏南", min: 191.25, max: 213.75 },
      { label: "西南", min: 213.75, max: 236.25 },
      { label: "西南偏西", min: 236.25, max: 258.75 },
      { label: "正西", min: 258.75, max: 281.25 },
      { label: "西北偏西", min: 281.25, max: 303.75 },
      { label: "西北", min: 303.75, max: 326.25 },
      { label: "西北偏北", min: 326.25, max: 348.75 }
    ];
    for (const item of directions) {
      if (item.min <= item.max) {
        if (d >= item.min && d < item.max) return item.label;
      } else {
        if (d >= item.min || d < item.max) return item.label;
      }
    }
    return "未知";
  };

  // Local physical status text helper
  const getStationRankings = (
    history: any[],
    currentHour: number,
    windowHours: number
  ) => {
    if (!history || history.length === 0) return [];

    // Ranking windows must describe what happened *inside that window*, not
    // lifetime maxima copied forward in each station record.  Older saves can
    // also contain stale stationReadings, so reconstruct instantaneous station
    // observations from each historical cyclone state before aggregating.
    const finiteStates = history
      .filter((h: any) => Number.isFinite(h?.simHour))
      .sort((a: any, b: any) => a.simHour - b.simHour);
    if (!finiteStates.length) return [];

    const requestedEnd = Number.isFinite(currentHour) ? Number(currentHour) : finiteStates[finiteStates.length - 1].simHour;
    // Snap to the latest actual history sample at/before the timeline cursor.
    // This is important when the UI cursor sits between hourly model samples.
    const endState = [...finiteStates].reverse().find((h: any) => h.simHour <= requestedEnd + 1e-6) || finiteStates[0];
    const endHour = endState.simHour;
    const startHour = endHour - Math.max(1, windowHours);
    let windowStates = finiteStates.filter((h: any) => h.simHour <= endHour + 1e-6 && h.simHour > startHour + 1e-6);
    if (!windowStates.length) windowStates = [endState];

    let historyCache = stationRankingMemo.get(history);
    if (!historyCache) {
      historyCache = new Map<string, any[]>();
      stationRankingMemo.set(history, historyCache);
    }
    const endSignature = [endState.simHour, endState.lat, endState.lon, endState.vmax, endState.pmin, endState.rmw, endState.structureMode, endState.precipitationAsymmetry].join(":");
    const cacheKey = `${windowHours}|${endSignature}|${history.length}`;
    const memoized = historyCache.get(cacheKey);
    if (memoized) return memoized;

    const stationMap = new Map<string, {
      maxGust: number;
      maxAvgWind: number;
      totalPrecip: number;
      maxSurge: number;
      latestHour: number;
    }>();

    windowStates.forEach((state: any) => {
      // Recalculate from this state instead of trusting cumulative/lifetime
      // values embedded in stationReadings. This fixes cases where a 1 h list
      // still showed a station the cyclone passed many hours earlier.
      let readings: any[] = [];
      const storedRows = Array.isArray(state?.stationReadings) ? state.stationReadings : [];
      // Current-version history already stores the exact output of the shared station /
      // multi-mechanism precipitation engine. Reuse it rather than recomputing 85 stations
      // for every ranking window. Legacy rows without the marker are re-diagnosed below.
      if (storedRows.length && storedRows.every((r: any) => r?.diagnosticVersion === "round124-eye-v2")) {
        readings = storedRows;
      } else {
        try {
          readings = calculateStationReadings(
            Number(state.lat),
            Number(state.lon),
            Number(state.vmax),
            Number(state.pmin),
            Number(state.rmw || 35),
            state.r7,
            state.r10,
            state.r12,
            undefined,
            0,
            state.eyeRadiusKm,
            state.eyeClearance,
            { ...state, simHour: state.simHour, config: state.configSnapshot || config }
          ) as any[];
        } catch (e) {
          readings = storedRows;
        }
      }

      readings.forEach((r: any) => {
        if (!r?.name) return;
        const existing = stationMap.get(r.name) || { maxGust: 0, maxAvgWind: 0, totalPrecip: 0, maxSurge: 0, latestHour: -Infinity };
        const meanWind = Number(r.windSpeed) || 0;
        const instantGust = Number.isFinite(r.gustSpeed)
          ? Number(r.gustSpeed)
          : meanWind * (1.18 + 0.14 * Math.min(1, meanWind / 35));
        existing.maxGust = Math.max(existing.maxGust, instantGust);
        existing.maxAvgWind = Math.max(existing.maxAvgWind, meanWind);
        existing.totalPrecip += Number(r.precipitation) || 0;
        existing.maxSurge = Math.max(existing.maxSurge, Number(r.stormSurge) || 0);
        existing.latestHour = Math.max(existing.latestHour, state.simHour);
        stationMap.set(r.name, existing);
      });
    });

    const results: any[] = [];
    stationMap.forEach((val, name) => {
      results.push({
        name,
        gust: Number(val.maxGust.toFixed(1)),
        avgWind: Number(val.maxAvgWind.toFixed(1)),
        precip: Number(val.totalPrecip.toFixed(1)),
        surge: Number(val.maxSurge.toFixed(2)),
        sampleEndHour: val.latestHour
      });
    });
    historyCache.set(cacheKey, results);
    if (historyCache.size > 28) historyCache.delete(historyCache.keys().next().value as string);
    return results;
  };


  const [resolutionId, setResolutionId] = useState("2k");
  // 4.1.4: storm identity is single-source-of-truth from the main typhoon editor.
  const typhoonName = getTyphoonDisplayName(typhoon, currentHour, startDate);
  const typhoonNumber = getTyphoonOfficialNumber(typhoon, startDate);
  const typhoonOrdinalNumber = getTyphoonOrdinalNumber(typhoon, startDate);
  const [forecastHours, setForecastHours] = useState(() => {
    // Round134: old product horizon restored. Clamp a persisted Round133 144-240h selection.
    const stored = Number(localStorage.getItem("forecast_forecastHours"));
    return [24, 48, 72, 96, 120].includes(stored) ? stored : 120;
  });
  // NMC image-only uncertainty; never propagate to other product families.
  const [nmcCoarseIntensity, setNmcCoarseIntensity] = useState(() =>
    localStorage.getItem("forecast_nmcCoarseIntensity") !== "false");
  // Product-only display controls. NEVER written to simulation config or storm history.
  const [nmcCustomPeakEnabled,setNmcCustomPeakEnabled] = useState(() =>
    localStorage.getItem("forecast_nmcCustomPeakEnabled") === "true");
  // Round170: product-only, independent geographic overlay switches.
  const [globalAgency,setGlobalAgency]=useState(()=>loadAgencyBranding('global'));
  const changeGlobalAgency=(key:keyof typeof globalAgency,value:string)=>{
    setGlobalAgency(p=>({...p,[key]:value}));
  };

  const [nmcBorders, setNmcBorders] = useState(() => localStorage.getItem('forecast_nmcBorders') !== 'false');
  const [nmcChinaTint, setNmcChinaTint] = useState(() => localStorage.getItem('forecast_nmcChinaTint') !== 'false');
  const [nmcProvinces, setNmcProvinces] = useState(() => localStorage.getItem('forecast_nmcProvinces') !== 'false');
  const [nmcRivers, setNmcRivers] = useState(() => localStorage.getItem('forecast_nmcRivers') !== 'false');
  const [nmcOverlayError, setNmcOverlayError] = useState('');
  const overlayDataRef = useRef<NmcExtraVectors>({provinces:null,rivers:null,errors:[]});
  const [nmcCustomPeak,setNmcCustomPeak] = useState(() => {
    const stored=Number(localStorage.getItem("forecast_nmcCustomPeak"));
    return Number.isFinite(stored)&&stored>=15&&stored<=90?Math.round(stored):55;
  });
  const [showInfoBoxes, setShowInfoBoxes] = useState(() => localStorage.getItem("forecast_showInfoBoxes") !== "false");
  const [showLandfallBox, setShowLandfallBox] = useState(() => localStorage.getItem("forecast_showLandfallBox") === "true");
  const [showForecastBox, setShowForecastBox] = useState(() => localStorage.getItem("forecast_showForecastBox") !== "false");
  const [showCenterBox, setShowCenterBox] = useState(() => localStorage.getItem("forecast_showCenterBox") !== "false");
  const [boxDensity, setBoxDensity] = useState(() => Number(localStorage.getItem("forecast_boxDensity")) || 3);
  const [auditNumber, setAuditNumber] = useState(() => localStorage.getItem("forecast_auditNumber") || "GS (2026) 3082号");
  const [showWarning, setShowWarning] = useState(() => localStorage.getItem("forecast_showWarning") !== "false");
  const [rainfallAspectRatio, setRainfallAspectRatio] = useState<RainfallAspectRatio>(() => {
    const stored = localStorage.getItem("forecast_rainfallAspectRatio");
    return stored === "16:9" || stored === "3:2" || stored === "1:1" ? stored : "4:3";
  });
  const [rainfallLegendStyle, setRainfallLegendStyle] = useState<RainfallLegendStyle>(() => {
    const stored = localStorage.getItem("forecast_rainfallLegendStyle");
    return stored === "extreme_reference" || stored === "combined_overlay" ? stored : "green_reference";
  });
  const [rainfallMapPalette, setRainfallMapPalette] = useState<RainfallMapPalette>(() =>
    localStorage.getItem("forecast_rainfallMapPalette") === "palette2" ? "palette2" : "palette1"
  );
  // 气压风场产品的起报时刻在进入该产品时冻结；长时间计算期间即使主模拟继续走时，
  // 下一次生成仍保持同一报次 + 同一预报时效，避免“生成一次后时效跳变”。
  const [synopticIssueHour, setSynopticIssueHour] = useState<number>(() => currentHour);
  const [synopticLeadHours, setSynopticLeadHours] = useState<number>(() => {
    const value = Number(localStorage.getItem("forecast_synopticLeadHours"));
    return Number.isFinite(value) ? Math.max(0, Math.round(value / 3) * 3) : 0;
  });
  const [synopticDomainMode, setSynopticDomainMode] = useState<"reference" | "follow_storm" | "custom">(() => {
    const value = localStorage.getItem("forecast_synopticDomainMode");
    return value === "follow_storm" || value === "custom" ? value : "reference";
  });
  const [synopticContourInterval, setSynopticContourInterval] = useState<2 | 4 | 5 | 8>(() => {
    const value = Number(localStorage.getItem("forecast_synopticContourInterval"));
    return value === 2 || value === 5 || value === 8 ? value : 4;
  });
  const [synopticGridResolution, setSynopticGridResolution] = useState<0.1 | 0.125 | 0.25 | 0.5>(() => {
    const value = Number(localStorage.getItem("forecast_synopticGridResolution"));
    return value === 0.1 || value === 0.125 || value === 0.5 ? value : 0.25;
  });
  const [synopticShowContours, setSynopticShowContours] = useState(() => localStorage.getItem("forecast_synopticShowContours") !== "false");
  const [synopticMapZoom, setSynopticMapZoom] = useState<number>(() => {
    const value = Number(localStorage.getItem("forecast_synopticMapZoom"));
    return [0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5].includes(value) ? value : 1;
  });
  const [synopticShowTrack, setSynopticShowTrack] = useState(() => localStorage.getItem("forecast_synopticShowTrack") === "true");
  const [synopticModelLabel, setSynopticModelLabel] = useState(() => localStorage.getItem("forecast_synopticModelLabel") || SYNOPTIC_TITLE_MODEL_LABEL);
  const [synopticStylePreset, setSynopticStylePreset] = useState<SynopticWindPressureStyle>(() => {
    const value = localStorage.getItem("forecast_synopticStylePreset");
    return value === "hmon" || value === "hwrf" ? value : "default";
  });
  const [synopticRoundedClearEye, setSynopticRoundedClearEye] = useState<boolean>(() => localStorage.getItem("forecast_synopticRoundedClearEye") === "true");
  const [synopticAspectRatio, setSynopticAspectRatio] = useState<SynopticProductAspect>(() => {
    const value = localStorage.getItem('forecast_synopticAspectRatio');
    return value === '3:4' || value === '4:3' || value === '9:16' || value === '16:9' ? value : 'default';
  });
  const [synopticVideoFrames, setSynopticVideoFrames] = useState<number>(() => Number(localStorage.getItem("forecast_synopticVideoFrames")) || 16);
  const [synopticVideoDuration, setSynopticVideoDuration] = useState<number>(() => Number(localStorage.getItem("forecast_synopticVideoDuration")) || 8);
  const [synopticVideoResolution, setSynopticVideoResolution] = useState<SynopticVideoResolution>(() => {
    const value = localStorage.getItem("forecast_synopticVideoResolution");
    return value === "720p" || value === "2K" ? value : "1080p";
  });
  const [synopticCustomBounds, setSynopticCustomBounds] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("forecast_synopticCustomBounds") || "null");
      if (raw && [raw.lonMin, raw.lonMax, raw.latMin, raw.latMax].every(Number.isFinite)) return raw as { lonMin: number; lonMax: number; latMin: number; latMax: number };
    } catch {}
    return { lonMin: 98, lonMax: 123, latMin: 14.5, latMax: 32 };
  });
  // An on-map 3:2 frame becomes the next wind product's exact custom domain.
  // The modal remounts after confirmation; no stale product closure survives.
  useEffect(() => {
    if (!pickedSynopticBounds) return;
    setSynopticCustomBounds(pickedSynopticBounds);
    setSynopticDomainMode("custom");
    // The selection itself is the final crop: never apply a second zoom.
    setSynopticMapZoom(1);
  }, [pickedSynopticBounds]);
  // 风场产品的预报状态由 materializeForecastPath 按需重建，不再用当前 forecastPath
  // 最后一个点反推滑条上限。旧做法在生成一次后路径快照发生变化时会把最大时效突然压到 0。
  const synopticMaxLead = 168;

  useEffect(() => {
    setSynopticLeadHours((value) => clamp(Math.round(value / 3) * 3, 0, synopticMaxLead));
  }, [typhoon.id]);


  const [showAircraftRecon, setShowAircraftRecon] = useState(false);
  const [showCloudCompositor, setShowCloudCompositor] = useState(false);

  // Station Ranking states
  const [showRankings, setShowRankings] = useState(false);
  const [showChartMaker, setShowChartMaker] = useState(false);
  const [chartMakerConfig, setChartMakerConfig] = useState(() => {
    try {
      const saved = localStorage.getItem("typhoon_chart_maker_config");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      aspectRatio: "16:9",
      resolution: 2,
      chartType: "bar",
      topN: 10,
      showInfo: true,
    };
  });
  const [rankingWindow, setRankingWindow] = useState<1 | 3 | 6 | 12 | 24 | 48 | 72>(() => {
    try {
      const saved = localStorage.getItem("typhoon_ranking_window");
      if (saved) return JSON.parse(saved) as any;
    } catch (e) {}
    return 1;
  });
  const [rankingElement, setRankingElement] = useState<"gust" | "avgWind" | "precip" | "surge">((): any => {
    try {
      const saved = localStorage.getItem("typhoon_ranking_element");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return "gust";
  });
  const [chartOrientation, setChartOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedRanking, setCopiedRanking] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("typhoon_chart_maker_config", JSON.stringify(chartMakerConfig));
    } catch (e) {}
  }, [chartMakerConfig]);

  useEffect(() => {
    try {
      localStorage.setItem("typhoon_ranking_window", JSON.stringify(rankingWindow));
    } catch (e) {}
  }, [rankingWindow]);

  useEffect(() => {
    try {
      localStorage.setItem("typhoon_ranking_element", JSON.stringify(rankingElement));
    } catch (e) {}
  }, [rankingElement]);


  useEffect(() => {
    localStorage.setItem("forecast_rainfallAspectRatio", rainfallAspectRatio);
  }, [rainfallAspectRatio]);

  useEffect(() => {
    localStorage.setItem("forecast_rainfallLegendStyle", rainfallLegendStyle);
  }, [rainfallLegendStyle]);

  useEffect(() => {
    localStorage.setItem("forecast_rainfallMapPalette", rainfallMapPalette);
  }, [rainfallMapPalette]);
  useEffect(() => {
    localStorage.setItem("forecast_synopticLeadHours", String(synopticLeadHours));
    localStorage.setItem("forecast_synopticDomainMode", synopticDomainMode);
    localStorage.setItem("forecast_synopticContourInterval", String(synopticContourInterval));
    localStorage.setItem("forecast_synopticGridResolution", String(synopticGridResolution));
    localStorage.setItem("forecast_synopticShowContours", String(synopticShowContours));
    localStorage.setItem("forecast_synopticMapZoom", String(synopticMapZoom));
    localStorage.setItem("forecast_synopticShowTrack", String(synopticShowTrack));
    localStorage.setItem("forecast_synopticModelLabel", synopticModelLabel);
    localStorage.setItem("forecast_synopticStylePreset", synopticStylePreset);
    localStorage.setItem("forecast_synopticRoundedClearEye", String(synopticRoundedClearEye));
    localStorage.setItem("forecast_synopticAspectRatio", synopticAspectRatio);
    localStorage.setItem("forecast_synopticCustomBounds", JSON.stringify(synopticCustomBounds));
    localStorage.setItem("forecast_synopticVideoFrames", String(synopticVideoFrames));
    localStorage.setItem("forecast_synopticVideoDuration", String(synopticVideoDuration));
    localStorage.setItem("forecast_synopticVideoResolution", synopticVideoResolution);
  }, [synopticLeadHours, synopticDomainMode, synopticContourInterval, synopticGridResolution, synopticShowContours, synopticMapZoom, synopticShowTrack, synopticModelLabel, synopticStylePreset, synopticRoundedClearEye, synopticAspectRatio, synopticCustomBounds, synopticVideoFrames, synopticVideoDuration, synopticVideoResolution]);


  const drawCoastlinesOnTop = (ctx: CanvasRenderingContext2D, latLonToPixel: (lat: number, lon: number) => { x: number; y: number }, scale: number) => {
    if (landGeoJson && landGeoJson.features) {
      ctx.save();
      ctx.strokeStyle = "#1e293b"; // Fine dark slate coastline
      ctx.lineWidth = 1.2 * scale;
      const strokePoly = (coordinates: number[][][]) => {
        for (const ring of coordinates) {
          strokeProductCoastlineRing(ctx, ring, (lat, lon) => latLonToPixel(lat, lon));
        }
      };
      landGeoJson.features.forEach((feat: any) => {
        if (feat.geometry.type === "Polygon") strokePoly(feat.geometry.coordinates);
        else if (feat.geometry.type === "MultiPolygon") feat.geometry.coordinates.forEach(strokePoly);
      });
      ctx.restore();
    }
  };
  
  // Product style and Hurricane Tracker multi-model states
  type ProductStyle = "standard" | "jma_forecast" | "phase_space" | "ensemble_tracks" | "rain_observed" | "synoptic_wind_pressure";
  const [imageStyle, setImageStyle] = useState<ProductStyle>(() => {
    const stored = localStorage.getItem("forecast_imageStyle");
    const allowed = new Set(["standard","jma_forecast","phase_space","rain_observed","ensemble_tracks","synoptic_wind_pressure"]);
    if (stored === "icwc_satellite" || stored === "aether_satellite") return "standard";
    if (stored === "ensemble") return "ensemble_tracks";
    if (stored === "jtwc" || stored === "jtwc_forecast") return "standard";
    if (stored === "strike_probability") return "standard";
    if (["scatterometer","met_olr","met_dbz","met_wv","aether_warning"].includes(String(stored))) return "standard";
    return allowed.has(String(stored)) ? stored as ProductStyle : "standard";
  });

  const brandingProductId = imageStyle === 'standard' ? 'nmc' : imageStyle;
  const [productAgency,setProductAgency]=useState(()=>loadAgencyBranding('nmc'));
  useEffect(()=>setProductAgency(loadAgencyBranding(brandingProductId)),[brandingProductId]);

  useEffect(() => {
    if (!isOpen || imageStyle !== "synoptic_wind_pressure") return;
    // ROUND116: follow the current simulation/timeline hour between generations. Each individual
    // render still receives a value snapshot when it starts, so a long render remains reproducible,
    // but the next image no longer reuses the first image's old issue hour and wind radii.
    setSynopticIssueHour(currentHour);
  }, [isOpen, imageStyle, typhoon.id, currentHour]);


  const [isCalculatingEnsemble, setIsCalculatingEnsemble] = useState(false);
  const [ensembleProgress, setEnsembleProgress] = useState(0);
  const [ensembleProgressStage, setEnsembleProgressStage] = useState("等待开始");
  const [ensembleCompletedCount, setEnsembleCompletedCount] = useState(0);
  const [ensembleTargetCount, setEnsembleTargetCount] = useState(AETHER_MODEL_SPECS.length);
  const ensembleAbortRef = useRef<AbortController | null>(null);
  const [ensembleMode, setEnsembleMode] = useState<"centers" | "members">(() =>
    localStorage.getItem("forecast_ensembleMode") === "members" ? "members" : "centers"
  );
  const [ensembleMembersPerModel, setEnsembleMembersPerModel] = useState<number>(() => {
    const stored = Number(localStorage.getItem("forecast_ensembleMembersPerModel"));
    return AETHER_ENSEMBLE_MEMBER_COUNTS.includes(stored as any) ? stored : 50;
  });
  const [ensembleBlackLines, setEnsembleBlackLines] = useState(() => localStorage.getItem("forecast_ensembleBlackLines") !== "false");
  const [selectedEnsembleModels, setSelectedEnsembleModels] = useState<string[]>(() => {
    const saved = localStorage.getItem("forecast_selectedEnsembleModels");
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((id: unknown) => AETHER_MODEL_SPECS.some((m) => m.id === id)) as string[];
      } catch {}
    }
    return AETHER_MODEL_SPECS.map((m) => m.id);
  });
  const [ensembleMembers, setEnsembleMembers] = useState<AetherGuidanceMember[]>([]);
  const [ensembleReferenceStyle, setEnsembleReferenceStyle] = useState<EnsembleReferenceStyle>(() => {
    const stored = localStorage.getItem("forecast_ensembleReferenceStyle") as EnsembleReferenceStyle | null;
    return ENSEMBLE_REFERENCE_STYLES.some(item => item.id === stored) ? (stored as EnsembleReferenceStyle) : "classic";
  });
  useEffect(() => {
    localStorage.setItem("forecast_ensembleReferenceStyle", ensembleReferenceStyle);
  }, [ensembleReferenceStyle]);
  // Round183: separate forecast horizon from rendering-only strike settings.
  const readStrikeSetting = <T,>(key: string, fallback: T, allowed?: readonly T[]): T => {
    try {
      const raw = localStorage.getItem(`forecast_${key}`);
      if (raw === null) return fallback;
      const value = (typeof fallback === "boolean" ? raw === "true" : typeof fallback === "number" ? Number(raw) : raw) as T;
      if (typeof value === "number" && !Number.isFinite(value)) return fallback;
      return allowed && !allowed.includes(value) ? fallback : value;
    } catch { return fallback; }
  };
  const [ensIntelHorizon,setEnsIntelHorizon]=useState(() => readStrikeSetting("ensIntelHorizon",360,[120,168,240,360]));
  const [ensIntelFooter,setEnsIntelFooter]=useState(() => readStrikeSetting("ensIntelFooter","").slice(0,60));
  const [ensIntelUnit,setEnsIntelUnit]=useState<"kt"|"m/s">(() => localStorage.getItem("forecast_ensIntelUnit")==="m/s"?"m/s":"kt");
  useEffect(()=>{localStorage.setItem("forecast_ensIntelHorizon",String(ensIntelHorizon));localStorage.setItem("forecast_ensIntelFooter",ensIntelFooter);localStorage.setItem("forecast_ensIntelUnit",ensIntelUnit);},[ensIntelHorizon,ensIntelFooter,ensIntelUnit]);
  const [ensembleStrikeHorizonHours, setEnsembleStrikeHorizonHours] = useState(() => readStrikeSetting("ensembleStrikeHorizonHours",168,[72,96,120,168,240,360]));
  const [strikeTrackEndMode,setStrikeTrackEndMode]=useState<"operational"|"residual">(() => readStrikeSetting("strikeTrackEndMode","operational",["operational","residual"]));
  const [strikeRadiusKm, setStrikeRadiusKm] = useState(() => readStrikeSetting("strikeRadiusKm",120,[50,80,100,120,150,200,300]));
  const [strikeCellDeg, setStrikeCellDeg] = useState(() => readStrikeSetting("strikeCellDeg",0.1,[0.0025,0.005,0.01,0.02,0.025,0.05,0.1,0.2,0.25]));
  const [strikeSmoothPasses, setStrikeSmoothPasses] = useState(() => readStrikeSetting("strikeSmoothPasses",1,[0,1,2]));
  const [strikeCoastMinPct, setStrikeCoastMinPct] = useState(() => readStrikeSetting("strikeCoastMinPct",5,[1,5,10,25]));
  const [strikeCoastWidth, setStrikeCoastWidth] = useState(() => readStrikeSetting("strikeCoastWidth",7,[4,5,6,7,8,9,10,11,12]));
  const [strikeFrameMode, setStrikeFrameMode] = useState<"auto"|"wnp"|"custom">(() => readStrikeSetting<"auto"|"wnp"|"custom">("strikeFrameMode","auto",["auto","wnp","custom"]));
  const [strikeCustomBounds, setStrikeCustomBounds] = useState(() => {
    try {
      const p = JSON.parse(localStorage.getItem("forecast_strikeCustomBounds")||"null");
      if (p && [p.minLon,p.maxLon,p.minLat,p.maxLat].every(Number.isFinite) && p.maxLon>p.minLon && p.maxLat>p.minLat) return p as {minLon:number;maxLon:number;minLat:number;maxLat:number};
    } catch {}
    return { minLon:105,maxLon:180,minLat:-3,maxLat:58 };
  });
  const [strikeShowMembers, setStrikeShowMembers] = useState(() => readStrikeSetting("strikeShowMembers",true));
  const [strikeMeanDotHours, setStrikeMeanDotHours] = useState(() => readStrikeSetting("strikeMeanDotHours",6,[3,6,12,24]));
  const [strikePillCount, setStrikePillCount] = useState(() => readStrikeSetting("strikePillCount",7,[0,1,2,3,4,5,6,7,8,9,10]));
  const [strikePillMinPct, setStrikePillMinPct] = useState(() => readStrikeSetting("strikePillMinPct",5,Array.from({length:30},(_,i)=>i+1)));
  const [strikeModelLabel, setStrikeModelLabel] = useState(() => readStrikeSetting("strikeModelLabel","WMC").slice(0,12));
  const [strikeWatermark, setStrikeWatermark] = useState(() => readStrikeSetting("strikeWatermark","WMC").slice(0,30));
  const strikeFieldCacheRef = useRef<Map<string,StrikeField>>(new Map());
  // Cached fields refer to member paths, not just member IDs. Invalidate when regenerated.
  useEffect(() => { strikeFieldCacheRef.current.clear(); }, [ensembleMembers]);
  useEffect(() => {
    const settings = {strikeTrackEndMode,ensembleStrikeHorizonHours,strikeRadiusKm,strikeCellDeg,strikeSmoothPasses,strikeCoastMinPct,
      strikeCoastWidth,strikeFrameMode,strikeShowMembers,strikeMeanDotHours,strikePillCount,strikePillMinPct,strikeModelLabel,strikeWatermark};
    for (const [key,value] of Object.entries(settings)) try { localStorage.setItem(`forecast_${key}`,String(value)); } catch {}
    try {localStorage.setItem("forecast_strikeCustomBounds",JSON.stringify(strikeCustomBounds));} catch {}
  },[strikeTrackEndMode,ensembleStrikeHorizonHours,strikeRadiusKm,strikeCellDeg,strikeSmoothPasses,strikeCoastMinPct,
    strikeCoastWidth,strikeFrameMode,strikeCustomBounds,strikeShowMembers,strikeMeanDotHours,strikePillCount,strikePillMinPct,strikeModelLabel,strikeWatermark]);
  const resolveEnsembleHorizon = (style:EnsembleReferenceStyle) => style === "ensemble_intensity_analysis" ? ensIntelHorizon : style === "strike_probability_120km" ? ensembleStrikeHorizonHours
    : style === "pressure_spaghetti_basin" || style === "paired_cycle_pressure" ? ensembleTotalForecastHours : 168;
  const strikeGridEstimate = strikeFrameMode==='auto'?null:(strikeFrameMode==='wnp'
    ? {minLon:107.6,maxLon:177.3,minLat:-2.65,maxLat:57.9}:strikeCustomBounds);
  const effectiveStrikeCell = strikeGridEstimate?strikeStreamingCell(strikeGridEstimate,strikeCellDeg):null;
  const strikeEstimatedCells = strikeGridEstimate&&effectiveStrikeCell
    ? (Math.floor((strikeGridEstimate.maxLon-strikeGridEstimate.minLon)/effectiveStrikeCell)+1)*
      (Math.floor((strikeGridEstimate.maxLat-strikeGridEstimate.minLat)/effectiveStrikeCell)+1):0;
  const strikeOptions: StrikeProbabilityOptions = {
    horizonHours:ensembleStrikeHorizonHours,radiusKm:strikeRadiusKm,endMode:strikeTrackEndMode,cellDeg:strikeCellDeg,smoothPasses:strikeSmoothPasses,
    coastMinPct:strikeCoastMinPct,coastWidth:strikeCoastWidth,frameMode:strikeFrameMode,customBounds:strikeCustomBounds,
    showMembers:strikeShowMembers,meanDotHours:strikeMeanDotHours,pillCount:strikePillCount,pillMinPct:strikePillMinPct,
    modelLabel:strikeModelLabel==='WMC'?loadAgencyBranding('ensemble_tracks').agencyCode:strikeModelLabel,watermark:strikeWatermark
  };
  const [ensembleTotalForecastHours, setEnsembleTotalForecastHours] = useState<number>(() => {
    const stored=Number(localStorage.getItem("forecast_ensembleTotalForecastHours") ?? localStorage.getItem("forecast_ensembleResidualForecastHours"));
    return [72,96,120,144,168].includes(stored) ? stored : 168;
  });
  useEffect(() => {
    localStorage.setItem("forecast_ensembleTotalForecastHours", String(ensembleTotalForecastHours));
  }, [ensembleTotalForecastHours]);
  const [ensembleSpecialMapRangeMode, setEnsembleSpecialMapRangeMode] = useState<"operational" | "all">(() => {
    return localStorage.getItem("forecast_ensembleSpecialMapRangeMode") === "all" ? "all" : "operational";
  });
  const [ensembleSpecialTrackEndMode, setEnsembleSpecialTrackEndMode] = useState<"operational" | "residual">(() =>
    localStorage.getItem("forecast_ensembleSpecialTrackEndMode") === "residual" ? "residual" : "operational"
  );
  const [ensembleSpecialShowMainPath, setEnsembleSpecialShowMainPath] = useState(() => localStorage.getItem("forecast_ensembleSpecialShowMainPath") !== "false");
  useEffect(() => {
    localStorage.setItem("forecast_ensembleMode", ensembleMode);
  }, [ensembleMode]);
  useEffect(() => {
    localStorage.setItem("forecast_ensembleMembersPerModel", String(ensembleMembersPerModel));
  }, [ensembleMembersPerModel]);
  useEffect(() => {
    localStorage.setItem("forecast_ensembleBlackLines", String(ensembleBlackLines));
  }, [ensembleBlackLines]);
  useEffect(() => {
    localStorage.setItem("forecast_selectedEnsembleModels", JSON.stringify(selectedEnsembleModels));
  }, [selectedEnsembleModels]);
  useEffect(() => {
    localStorage.setItem("forecast_ensembleSpecialMapRangeMode", ensembleSpecialMapRangeMode);
  }, [ensembleSpecialMapRangeMode]);
  useEffect(() => {
    localStorage.setItem("forecast_ensembleSpecialTrackEndMode", ensembleSpecialTrackEndMode);
  }, [ensembleSpecialTrackEndMode]);
  useEffect(() => {
    localStorage.setItem("forecast_ensembleSpecialShowMainPath", String(ensembleSpecialShowMainPath));
  }, [ensembleSpecialShowMainPath]);
  const ensembleProductNeedsMembers = ensembleReferenceStyle === "classic"
    ? ensembleMode === "members"
    : ensembleReferenceStyleNeedsMembers(ensembleReferenceStyle);


  // JMA Style Specific States
  const [jmaShowPredictedRings, setJmaShowPredictedRings] = useState<boolean>(() => localStorage.getItem("forecast_jmaShowPredictedRings") !== "false");
  const [jmaShowCurrentWindArea, setJmaShowCurrentWindArea] = useState<boolean>(() => localStorage.getItem("forecast_jmaShowCurrentWindArea") !== "false");

  useEffect(() => {
    localStorage.setItem("forecast_jmaShowPredictedRings", String(jmaShowPredictedRings));
  }, [jmaShowPredictedRings]);

  useEffect(() => {
    localStorage.setItem("forecast_jmaShowCurrentWindArea", String(jmaShowCurrentWindArea));
  }, [jmaShowCurrentWindArea]);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem("forecast_forecastHours", forecastHours.toString());
    localStorage.setItem("forecast_nmcCoarseIntensity", String(nmcCoarseIntensity));
    localStorage.setItem("forecast_nmcCustomPeakEnabled", String(nmcCustomPeakEnabled));
    localStorage.setItem("forecast_nmcCustomPeak", String(nmcCustomPeak));
    localStorage.setItem('forecast_nmcBorders', String(nmcBorders));
    localStorage.setItem('forecast_nmcChinaTint', String(nmcChinaTint));
    localStorage.setItem('forecast_nmcProvinces', String(nmcProvinces));
    localStorage.setItem('forecast_nmcRivers', String(nmcRivers));
    localStorage.setItem("forecast_showInfoBoxes", showInfoBoxes.toString());
    localStorage.setItem("forecast_showLandfallBox", showLandfallBox.toString());
    localStorage.setItem("forecast_showForecastBox", showForecastBox.toString());
    localStorage.setItem("forecast_showCenterBox", showCenterBox.toString());
    localStorage.setItem("forecast_boxDensity", boxDensity.toString());
    localStorage.setItem("forecast_auditNumber", auditNumber);
    localStorage.setItem("forecast_showWarning", showWarning.toString());
    localStorage.setItem("forecast_imageStyle", imageStyle);
  }, [
    forecastHours,
    nmcCoarseIntensity,
    nmcCustomPeakEnabled, nmcCustomPeak,
    nmcBorders, nmcChinaTint, nmcProvinces, nmcRivers,
    showInfoBoxes,
    showLandfallBox,
    showForecastBox,
    showCenterBox,
    boxDensity,
    auditNumber,
    showWarning,
    imageStyle
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationKind, setGenerationKind] = useState<"image" | "video">("image");
  const [generationStatus, setGenerationStatus] = useState("");
  const [nmcRenderedSize, setNmcRenderedSize] = useState("");
  const [generationError, setGenerationError] = useState("");
  const generationAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const clearPreview = (deferBlobRevoke: boolean = false) => {
    setPreviewDataUrl((prev) => {
      if (prev?.startsWith("blob:")) {
        if (deferBlobRevoke) setTimeout(() => URL.revokeObjectURL(prev), 1200);
        else URL.revokeObjectURL(prev);
      }
      return null;
    });
  };

  useEffect(() => () => {
    generationAbortRef.current?.abort();
    previewAbortRef.current?.abort();
    ensembleAbortRef.current?.abort();
  }, []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workstationPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);

  const [geoJsonLoaded, setGeoJsonLoaded] = useState(false);
  const [osmNamesMap, setOsmNamesMap] = useState<Record<string, string>>({});
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const namingPreviewKeyRef = useRef("");

  useEffect(() => {
    if (!isOpen || !typhoon || imageStyle !== "standard" || previewRefreshToken === 0) return;
    // Naming belongs to an explicitly requested preview, not every 10-minute physics commit.
    // The user can refresh the preview to request names for the latest simulation state.
    const namingPreviewKey = `${typhoon.id}|${previewRefreshToken}|${forecastHours}`;
    if (namingPreviewKeyRef.current === namingPreviewKey) return;
    namingPreviewKeyRef.current = namingPreviewKey;
    const activeState = isHistoricalIssue ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    const tempTyphoon: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState, {
      active: !(activeState as any).dissipated,
      history: typhoon.history?.filter((h) => h.simHour <= currentHour) || []
    });
    const historicalForecastPath = (activeState as any).forecastPath as Typhoon["forecastPath"] | undefined;
    const path = materializeForecastPath(tempTyphoon, config, forecastHours, historicalForecastPath);

    let wasLand = checkPointOnLandGeoJson(activeState.lat, activeState.lon);
    for (let i = 0; i < path.length; i++) {
      const pt = path[i];
      const isLand = checkPointOnLandGeoJson(pt.lat, pt.lon);
      
      // 1. Regular track points
      if (!wasLand && isLand) {
        // Transition point (landfall)
        let landfallLat = pt.lat;
        let landfallLon = pt.lon;
        if (i > 0) {
          const prev = path[i-1];
          for (let s = 1; s <= 20; s++) {
            const r = s / 20;
            const ilat = prev.lat + (pt.lat - prev.lat) * r;
            const ilon = prev.lon + (pt.lon - prev.lon) * r;
            if (checkPointOnLandGeoJson(ilat, ilon)) {
              landfallLat = ilat;
              landfallLon = ilon;
              break;
            }
          }
        }
        const key = `${landfallLat.toFixed(3)},${landfallLon.toFixed(3)}`;
        if (!fetchedKeysRef.current.has(key)) {
          fetchedKeysRef.current.add(key);
          fetchOsmCityName(landfallLat, landfallLon).then((osmName) => {
            if (osmName) {
              setOsmNamesMap((prev) => ({ ...prev, [key]: osmName }));
            }
          }).catch(() => {
            fetchedKeysRef.current.delete(key);
          });
        }
      }

      // 2. Sample points for general naming
      if (i % 8 === 0 && isLand) {
        const key = `${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`;
        if (!fetchedKeysRef.current.has(key)) {
          fetchedKeysRef.current.add(key);
          fetchOsmCityName(pt.lat, pt.lon).then((osmName) => {
            if (osmName) {
              setOsmNamesMap((prev) => ({ ...prev, [key]: osmName }));
            }
          }).catch(() => {
            fetchedKeysRef.current.delete(key);
          });
        }
      }
      wasLand = isLand;
    }
  }, [isOpen, typhoon, currentHour, forecastHours, config, imageStyle, previewRefreshToken]);

  const ensureProductGeoJson = async () => {
    if (geoJsonLoaded) return true;
    const ok = await loadProductNaturalEarthData();
    if (ok) setGeoJsonLoaded(true);
    return ok;
  };

  const runEnsembleSimulationWithCount = async (countOverride?: number) => {
    if (isCalculatingEnsemble || ensembleAbortRef.current) return;
    const controller = new AbortController();
    ensembleAbortRef.current = controller;
    const activeState = isHistoricalIssue
      ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon)
      : typhoon;
    const primaryStorm: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState);
    const scene = (typhoons?.length ? typhoons : [typhoon]).map((candidate) => {
      if (!isHistoricalIssue) return candidate;
      const state = [...(candidate.history || [])].reverse().find((h) => h.simHour <= currentHour + 1e-6);
      return state ? mergeTyphoonStateWithCurrentIdentity(candidate, state) : candidate;
    });
    const residualContinuationProduct = ensembleReferenceStyle === "pressure_spaghetti_basin" || ensembleReferenceStyle === "paired_cycle_pressure" || (ensembleReferenceStyle === "strike_probability_120km" && strikeTrackEndMode === "residual");
    const ensembleHorizon = resolveEnsembleHorizon(ensembleReferenceStyle);
    // For residual-vortex products calculate both paths with the same explicit lead-time cap.
    // The ordinary path is used only for framing; the residual path drives the actual members.
    const framingReferencePath = materializeProductForecast(
      primaryStorm, config, ensembleHorizon, primaryStorm.forecastPath
    );
    const referencePath = residualContinuationProduct
      ? materializeForecastPath(primaryStorm, config, ensembleHorizon, primaryStorm.forecastPath, true)
      : framingReferencePath;
    const portSeed = config?.seed || activeState.configSnapshot?.seed || "WMC";
    const guidanceIssueHour = Math.floor(currentHour / 3) * 3;
    const perModel = countOverride ?? ensembleMembersPerModel;
    const selected = selectedEnsembleModels.length ? selectedEnsembleModels : [AETHER_MODEL_SPECS[0].id];
    const total = ensembleProductNeedsMembers ? selected.length * perModel : AETHER_MODEL_SPECS.length;
    setIsCalculatingEnsemble(true);
    setEnsembleMembers([]);
    setEnsembleProgress(1);
    setEnsembleCompletedCount(0);
    setEnsembleTargetCount(total);
    setEnsembleProgressStage(ensembleProductNeedsMembers ? `准备 ${selected.length} 个机构 × ${perModel} 成员` : "计算 8 机构中心路径");
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const productCoastReady = await ensureProductGeoJson();
      if (!productCoastReady) throw new Error("产品海岸线数据加载失败");
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      if (!ensembleProductNeedsMembers) {
        const centers = buildAetherCenterGuidance(primaryStorm, guidanceIssueHour, scene, portSeed, referencePath, ensembleHorizon, config, true);
        if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
        setEnsembleMembers(centers);
        setEnsembleCompletedCount(centers.length);
        setEnsembleProgress(100);
        setEnsembleProgressStage("8 机构中心路径完成");
      } else {
        const members = await buildAetherEnsembleMembers({
          storm: primaryStorm, currentHour: guidanceIssueHour, scene, seed: portSeed, referencePath,
          selectedModelIds: selected, membersPerModel: perModel, horizon: ensembleHorizon, config, useProductCoastline: true, signal: controller.signal,
          onProgress: (done, target, stage) => {
            setEnsembleCompletedCount(done);
            setEnsembleTargetCount(target);
            setEnsembleProgress(Math.round(done / Math.max(1, target) * 100));
            setEnsembleProgressStage(stage);
          }
        });
        if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
        setEnsembleMembers(members);
        setEnsembleProgress(100);
        setEnsembleCompletedCount(members.length);
        setEnsembleProgressStage(`${selected.length} 机构 · ${members.length} 成员完成`);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("WMC ensemble generation failed:", err);
        setEnsembleProgressStage("集合推演失败");
      } else setEnsembleProgressStage("已取消集合推演");
    } finally {
      if (ensembleAbortRef.current === controller) ensembleAbortRef.current = null;
      setIsCalculatingEnsemble(false);
    }
  };

  const cancelEnsembleSimulation = () => {
    const controller = ensembleAbortRef.current;
    if (!controller) return;
    controller.abort();
    // Keep the aborted controller registered until the current batch observes the signal and
    // performs its own cleanup. This prevents a second run from starting during the few
    // milliseconds in which an old scheduled batch could still publish stale progress/state.
    setEnsembleProgressStage("已取消离散多模型推演");
    setIsCalculatingEnsemble(false);
    setEnsembleMembers([]);
  };

  const runEnsembleSimulation = () => runEnsembleSimulationWithCount();

  // Ensemble guidance is generated explicitly by the user; opening the product center never launches heavy member calculations.

  // Parse simulated dates
  const forecastBaseDate = new Date(startDate.getTime() + currentHour * 60 * 60 * 1000);
  const forecastEndDate = new Date(forecastBaseDate.getTime() + forecastHours * 60 * 60 * 1000);

  const formatChineseDate = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const h = String(date.getHours()).padStart(2, "0");
    return `${y}年${m}月${d}日${h}时`;
  };

  const formatChineseDateShort = (date: Date) => {
    const d = date.getDate();
    const h = String(date.getHours()).padStart(2, "0");
    return `${d}日${h}时`;
  };

  const selectedRes = RESOLUTIONS.find((r) => r.id === resolutionId) || RESOLUTIONS[1];

  // Helper to draw standard NMC style forecast map
  const drawJmaForecastMapOnCanvas = async (canvas: HTMLCanvasElement | null, isMini: boolean = false) => {
    if (typeof setGenerationProgress === "function") setGenerationProgress(5);
    await new Promise(r => setTimeout(r, 0));
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = isMini ? 400 : selectedRes.width;
    const H = Math.round(W * 3 / 4);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const scale = W / 1200;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Do not snapshot the React loading flag into the exported image. The previous code could
    // finish the async coastline fetch but still see the stale `geoJsonLoaded=false` closure and
    // permanently export a loading-placeholder canvas. Await the actual product
    // loader here and continue drawing in the same invocation.
    const productMapReady = geoJsonLoaded || await ensureProductGeoJson();
    if (!productMapReady || !landGeoJson || !countriesGeoJson) {
      ctx.fillStyle = "#b45309";
      ctx.font = `${14 * scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("地图数据加载失败，请重试。", W / 2, H / 2);
      return;
    }

    // The discontinued-storm plate uses a full East Asia stereographic chart
    // with no archived or forecast cyclone geometry, matching the reference screenshot.
    const terminatedState = isHistoricalIssue
      ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    if (terminatedState.dissipated || (!isHistoricalIssue && typhoon.active === false) ||
        terminatedState.category === TyphoonCategory.RL || terminatedState.category === TyphoonCategory.ET) {
      drawJmaTerminationPlate(canvas, landGeoJson, typhoonOrdinalNumber,
        terminatedState.category === TyphoonCategory.ET ? '温帯低気圧' : '熱帯低気圧');
      setGenerationProgress(100);
      return;
    }

    const defaultConfig: SimulationConfig = config || {
      subtropicalHighEnabled: true,
      subtropicalHighStrength: 1.0,
      subtropicalHighLat: 28.0,
      subtropicalHighLon: 135.0,
      subtropicalHighWestExtent: 125.0,
      westerliesEnabled: true,
      westerliesStrength: 1.0,
      westerliesLat: 30.0,
      westerliesTroughLon: 120.0,
      westerliesTroughDepth: 1.0,
      betaDriftEnabled: true,
      betaDriftScale: 1.0,
      monsoonTroughEnabled: false,
      eastWaveEnabled: false,
      shearScale: 1.0,
      humidityScale: 1.0,
      outflowScale: 1.0,
      dryAirEnabled: false,
      randomNoise: 0,
      sstAnomaly: 0,
      ohcScale: 1.0,
      warmPoolEnabled: true,
      coldEddyEnabled: false,
      airSeaCoupling: 1.0,
      ewrcTrigger: "auto",
      rapidIntensifyEnabled: true,
      landDecayEnabled: true,
      terrainDecayEnabled: true,
      landfallDecayAdjustment: 0,
      landProximityDecayAdjustment: 0,
      etEnabled: true,
      seed: "12345",
      joystickSensitivity: 1.0,
      joystickStrength: 1.0,
      joystickDx: 0,
      joystickDy: 0,
      joystickDragging: false,
      soundEnabled: false,
      soundVolume: 0.5,
      followMainTyphoon: false,
      maxIntensityLimitEnabled: false,
      maxIntensityLimit: 70,
      intensificationRate: 1.0,
      coastlineSource: "natural_earth"
    };

    const activeState = (isHistoricalIssue
      ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon)
      : typhoon) as TyphoonState;
    const productStorm: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState);
    const requestedForecastHours = Math.max(1, Number(forecastHours) || 120);
    const allStandardLeadHours = [12, 24, 48, 72, 96, 120];
    const standardLeadHours = allStandardLeadHours.filter((h) => h <= requestedForecastHours + 1e-6);
    // Both JMA and NMC use the SAME physical issue state, config and issued
    // terminal lead. Do not append an extra JMA point after the NMC stop,
    // or draw past the common published advisory horizon.
    const operationalForecast = materializeProductForecast(productStorm, defaultConfig, requestedForecastHours, productStorm.forecastPath);
    const commonIssued = selectNmcIssuedForecast(
      {lat:productStorm.lat,lon:productStorm.lon,vmax:productStorm.vmax,simHour:0,category:productStorm.category},
      operationalForecast.filter((pt:any)=>Number(pt.simHour)>0),0,requestedForecastHours);
    const jmaStopLead = Math.min(requestedForecastHours, commonIssued.at(-1)?.simHour ?? 0);
    const rawForecast = operationalForecast;
    const forecastCandidates = rawForecast.filter((pt: any) =>
      Number.isFinite(pt?.simHour) && Number(pt.simHour) <= jmaStopLead + 1e-6
    );
    const maxAvailableForecastLead = forecastCandidates.length
      ? Math.min(jmaStopLead, Math.max(...forecastCandidates.map((pt: any) => Number(pt.simHour || 0))))
      : 0;
    const pickForecastAtLead = (lead: number) => {
      // JMA-style forecast graphics must stop when the storm would no longer be issued,
      // rather than repeating the last available centre at later nominal lead times.
      if (lead > maxAvailableForecastLead + 1e-6) return null;
      const candidates = forecastCandidates.filter((pt: any) => Number(pt.simHour || 0) <= lead + 1e-6);
      if (!candidates.length) return null;
      return candidates.reduce((best: any, pt: any) => {
        const bestDiff = Math.abs(Number(best?.simHour ?? 0) - lead);
        const diff = Math.abs(Number(pt?.simHour ?? 0) - lead);
        return diff < bestDiff ? pt : best;
      }, candidates[0]);
    };

    // JMA forecast geometry remains ring/envelope based.  The 3-hour cadence requested for
    // this product applies only to the historical best-track tail; do not add a forecast
    // centre polyline that is not part of the original JMA forecast graphic.

    const motionUncertainty = Math.max(0, Math.min(1, (12 - Math.max(0, Number(activeState.speed || 0))) / 9));
    const earlyIntensityUncertainty = Math.max(0, Math.min(1, (28 - Number(activeState.vmax || 0)) / 16));
    // Earlier JMA-style forecast circles were too large relative to the reference chart.
    // Use a more compact baseline and gentler state-dependent inflation.
    const uncertaintyScale = 0.94 + motionUncertainty * 0.04 + earlyIntensityUncertainty * 0.03;
    const radiusAnchors = [
      { h: 12, r: 78 },
      { h: 24, r: 135 },
      { h: 48, r: 250 },
      { h: 72, r: 360 },
      { h: 96, r: 500 },
      { h: 120, r: 660 }
    ];
    const getJmaForecastRadiusKm = (lead: number) => {
      if (lead <= 0) return 0;
      if (lead <= radiusAnchors[0].h) {
        return radiusAnchors[0].r * (lead / radiusAnchors[0].h) * uncertaintyScale;
      }
      for (let i = 1; i < radiusAnchors.length; i++) {
        const prev = radiusAnchors[i - 1];
        const curr = radiusAnchors[i];
        if (lead <= curr.h) {
          const t = (lead - prev.h) / Math.max(1, curr.h - prev.h);
          return (prev.r + (curr.r - prev.r) * t) * uncertaintyScale;
        }
      }
      return radiusAnchors[radiusAnchors.length - 1].r * uncertaintyScale;
    };

    const displayLeadHours = [...standardLeadHours.filter((lead) => lead <= maxAvailableForecastLead + 1e-6)];
    if (maxAvailableForecastLead > 0 && !displayLeadHours.some((lead) => Math.abs(lead - maxAvailableForecastLead) < 1e-6)) {
      displayLeadHours.push(maxAvailableForecastLead);
    }
    displayLeadHours.sort((a, b) => a - b);

    const forecastPoints = displayLeadHours.map((lead) => {
      const picked: any = pickForecastAtLead(lead);
      if (!picked) return null;
      return {
        lead,
        lat: Number(picked.lat),
        lon: Number(picked.lon),
        vmax: Number.isFinite(Number(picked.vmax)) ? Number(picked.vmax) : Number(activeState.vmax),
        pmin: Number.isFinite(Number(picked.pmin)) ? Number(picked.pmin) : Number(activeState.pmin),
        radiusKm: getJmaForecastRadiusKm(lead),
        // JMA storm-warning area is the complete area that can be within >=50 kt winds
        // if the centre lies anywhere in the 70% probability circle.  WMC's forecast
        // intensity supplies the forecast storm radius; it is deliberately separate from
        // the probability-circle radius.
        stormRadiusKm: (() => {
          const forecastVmax = Number.isFinite(Number(picked.vmax)) ? Number(picked.vmax) : Number(activeState.vmax);
          // A non-zero CMA force-10 fallback radius must never create a JMA red storm-wind area
          // before the forecast centre itself reaches JMA's strict 50 kt / 10-minute threshold.
          return meetsJmaWindAreaThreshold(forecastVmax, "storm")
            ? Math.max(0, getStandardAverageWindRadii(forecastVmax).r10 || 0)
            : 0;
        })(),
        date: new Date(startDate.getTime() + (currentHour + lead) * 60 * 60 * 1000)
      };
    }).filter(Boolean) as { lead: number; lat: number; lon: number; vmax: number; pmin: number; radiusKm: number; stormRadiusKm: number; date: Date }[];

    const currentWindFallback = getStandardAverageWindRadii(Number(activeState.vmax || 0));
    const strongWind = calculateJmaWindCircleGeometry({
      lat: Number(activeState.lat),
      lon: Number(activeState.lon),
      vmaxCmaMs: Number(activeState.vmax || 0),
      landed: Boolean(activeState.landed),
      radii: {
        ne: Number(activeState.r7?.ne || currentWindFallback.r7 || 0),
        se: Number(activeState.r7?.se || currentWindFallback.r7 || 0),
        sw: Number(activeState.r7?.sw || currentWindFallback.r7 || 0),
        nw: Number(activeState.r7?.nw || currentWindFallback.r7 || 0)
      },
      level: "strong"
    }, (lat, lon) => checkPointOnLandGeoJson(lat, lon));
    const stormWind = calculateJmaWindCircleGeometry({
      lat: Number(activeState.lat),
      lon: Number(activeState.lon),
      vmaxCmaMs: Number(activeState.vmax || 0),
      landed: Boolean(activeState.landed),
      radii: {
        ne: Number(activeState.r10?.ne || currentWindFallback.r10 || 0),
        se: Number(activeState.r10?.se || currentWindFallback.r10 || 0),
        sw: Number(activeState.r10?.sw || currentWindFallback.r10 || 0),
        nw: Number(activeState.r10?.nw || currentWindFallback.r10 || 0)
      },
      level: "storm"
    }, (lat, lon) => checkPointOnLandGeoJson(lat, lon));

    const boundsPts: { lat: number; lon: number }[] = [
      { lat: Number(activeState.lat), lon: Number(activeState.lon) }
    ];
    const headerCollisionPts: { lat: number; lon: number }[] = [
      { lat: Number(activeState.lat), lon: Number(activeState.lon) }
    ];
    const addCircleBounds = (lat: number, lon: number, radiusKm: number) => {
      const latRadius = radiusKm / 111.12;
      const lonRadius = radiusKm / (111.12 * Math.max(0.25, Math.cos(lat * Math.PI / 180)));
      boundsPts.push({ lat: lat + latRadius, lon }, { lat: lat - latRadius, lon }, { lat, lon: lon + lonRadius }, { lat, lon: lon - lonRadius });
      // The title plate occupies real map space. Sample the entire outer circle rather than only
      // four cardinal points so the camera can detect a curved forecast/wind boundary that would
      // otherwise graze the top-left information plate between cardinal extrema.
      for (let deg = 0; deg < 360; deg += 11.25) {
        const a = deg * Math.PI / 180;
        headerCollisionPts.push({
          lat: lat + latRadius * Math.sin(a),
          lon: lon + lonRadius * Math.cos(a)
        });
      }
    };

    // JMA forecast charts frame the current wind area plus the forecast guidance/envelopes.
    // Do not expand the map to include the full recent history, otherwise the camera zooms out
    // too much and the operational forecast geometry becomes small.  Keep only a short visual
    // tail for context and exclude it from the framing bounds.
    const historyForDisplay = (typhoon.history || []).filter((h) => h.simHour <= currentHour);
    forecastPoints.forEach((pt) => {
      boundsPts.push({ lat: pt.lat, lon: pt.lon });
      headerCollisionPts.push({ lat: pt.lat, lon: pt.lon });
      addCircleBounds(pt.lat, pt.lon, pt.radiusKm + pt.stormRadiusKm);
    });
    if (jmaShowCurrentWindArea) {
      if (strongWind.visible) addCircleBounds(strongWind.centerLat, strongWind.centerLon, strongWind.radiusKm);
      if (stormWind.visible) addCircleBounds(stormWind.centerLat, stormWind.centerLon, stormWind.radiusKm);
    }

    const rawMinLat = Math.min(...boundsPts.map((p) => p.lat));
    const rawMaxLat = Math.max(...boundsPts.map((p) => p.lat));
    const rawMinLon = Math.min(...boundsPts.map((p) => p.lon));
    const rawMaxLon = Math.max(...boundsPts.map((p) => p.lon));
    let latSpan = rawMaxLat - rawMinLat;
    let lonSpan = rawMaxLon - rawMinLon;
    const latPad = Math.max(2.45, latSpan * 0.10);
    const lonPad = Math.max(4.15, lonSpan * 0.12);
    const latMid = (rawMinLat + rawMaxLat) / 2;
    const lonMid = (rawMinLon + rawMaxLon) / 2;
    let mapMinLat = latMid - (latSpan / 2 + latPad);
    let mapMaxLat = latMid + (latSpan / 2 + latPad);
    let mapMinLon = lonMid - (lonSpan / 2 + lonPad);
    let mapMaxLon = lonMid + (lonSpan / 2 + lonPad);
    latSpan = mapMaxLat - mapMinLat;
    lonSpan = mapMaxLon - mapMinLon;
    const minLatSpan = 12;
    const minLonSpan = 18;
    if (latSpan < minLatSpan) {
      const mid = (mapMinLat + mapMaxLat) / 2;
      mapMinLat = mid - minLatSpan / 2;
      mapMaxLat = mid + minLatSpan / 2;
      latSpan = minLatSpan;
    }
    if (lonSpan < minLonSpan) {
      const mid = (mapMinLon + mapMaxLon) / 2;
      mapMinLon = mid - minLonSpan / 2;
      mapMaxLon = mid + minLonSpan / 2;
      lonSpan = minLonSpan;
    }

    const mapLeft = 18 * scale;
    const mapTop = 16 * scale;
    const mapRight = W - 18 * scale;
    const mapBottom = H - 18 * scale;
    const mapWidth = mapRight - mapLeft;
    const mapHeight = mapBottom - mapTop;

    // JMA operational forecast plate: north-polar stereographic projection.
    // Parameters requested by the product specification:
    //   lat_0 = 90°N, lon_0 = 140°E, lat_ts = 60°N.
    // Geographic padding is still selected from the forecast/wind-area extent, but the actual
    // fit and every feature position are resolved in projected kilometres.  This avoids the old
    // equirectangular distortion while preserving circular Canvas symbols.
    mapMinLat = Math.max(-5, Math.floor(mapMinLat / 5) * 5);
    mapMaxLat = Math.min(89.5, Math.ceil(mapMaxLat / 5) * 5);
    mapMinLon = Math.floor(mapMinLon / 5) * 5;
    mapMaxLon = Math.ceil(mapMaxLon / 5) * 5;

    const rawProject = (lat: number, lon: number) => projectNorthPolarStereographicKm(lat, lon, 140, 60);
    const projectedFitPoints: { x: number; y: number }[] = [];
    const addProjectedFitPoint = (lat: number, lon: number) => {
      const q = rawProject(lat, lon);
      if (Number.isFinite(q.x) && Number.isFinite(q.y)) projectedFitPoints.push(q);
    };
    // Fit the camera to the actual forecast information, not the corners of a padded geographic
    // rectangle.  Under polar stereographic projection those rectangle corners can sit far outside
    // the forecast envelope and make the chart look zoomed-out/off-centre.
    boundsPts.forEach((pt) => addProjectedFitPoint(pt.lat, pt.lon));
    let projMinX = Math.min(...projectedFitPoints.map((p) => p.x));
    let projMaxX = Math.max(...projectedFitPoints.map((p) => p.x));
    let projMinY = Math.min(...projectedFitPoints.map((p) => p.y));
    let projMaxY = Math.max(...projectedFitPoints.map((p) => p.y));
    const projPadX = Math.max(34, (projMaxX - projMinX) * 0.032);
    const projPadY = Math.max(34, (projMaxY - projMinY) * 0.032);
    projMinX -= projPadX; projMaxX += projPadX;
    projMinY -= projPadY; projMaxY += projPadY;
    const targetAspect = mapWidth / mapHeight;
    let projSpanX = Math.max(1, projMaxX - projMinX);
    let projSpanY = Math.max(1, projMaxY - projMinY);
    const projectedAspect = projSpanX / projSpanY;
    if (projectedAspect < targetAspect) {
      const required = projSpanY * targetAspect;
      const mid = (projMinX + projMaxX) / 2;
      projMinX = mid - required / 2;
      projMaxX = mid + required / 2;
      projSpanX = required;
    } else if (projectedAspect > targetAspect) {
      const required = projSpanX / targetAspect;
      const mid = (projMinY + projMaxY) / 2;
      projMinY = mid - required / 2;
      projMaxY = mid + required / 2;
      projSpanY = required;
    }

    // Keep forecast geometry away from the top-left JMA title/time plate. The title is deliberately
    // part of the operational composition, so when a large 70% circle or its outer envelope would
    // touch that plate, widen the projected map range just enough to restore a clean gap. This is a
    // static product framing adjustment only; replay-video zoom rules are unaffected.
    const headerReserved = {
      x: 14 * scale,
      y: 14 * scale,
      w: 468 * scale,
      h: 116 * scale
    };
    const projectedCollisionPts = headerCollisionPts.map((pt) => rawProject(pt.lat, pt.lon));
    const collidesWithHeader = () => projectedCollisionPts.some((q) => {
      const x = mapLeft + ((q.x - projMinX) / Math.max(1, projMaxX - projMinX)) * mapWidth;
      const y = mapBottom - ((q.y - projMinY) / Math.max(1, projMaxY - projMinY)) * mapHeight;
      return x >= headerReserved.x && x <= headerReserved.x + headerReserved.w &&
        y >= headerReserved.y && y <= headerReserved.y + headerReserved.h;
    });
    let headerFitIterations = 0;
    while (collidesWithHeader() && headerFitIterations < 20) {
      const midX = (projMinX + projMaxX) / 2;
      const midY = (projMinY + projMaxY) / 2;
      const grow = 1.055;
      const halfX = (projMaxX - projMinX) * grow / 2;
      const halfY = (projMaxY - projMinY) * grow / 2;
      projMinX = midX - halfX; projMaxX = midX + halfX;
      projMinY = midY - halfY; projMaxY = midY + halfY;
      headerFitIterations += 1;
    }

    const projectionPxPerKm = mapWidth / Math.max(1, projMaxX - projMinX);
    const project = (lat: number, lon: number) => {
      const q = rawProject(lat, lon);
      return {
        x: mapLeft + ((q.x - projMinX) / Math.max(1, projMaxX - projMinX)) * mapWidth,
        y: mapBottom - ((q.y - projMinY) / Math.max(1, projMaxY - projMinY)) * mapHeight
      };
    };
    // Radii remain screen-space circles. The polar-stereographic local scale factor converts a
    // physical-km radius to the correctly synchronized projected radius without turning it into
    // an ellipse.
    const kmToPx = (km: number, lat: number) => km * northPolarStereographicScaleFactor(lat, 60) * projectionPxPerKm;

    const palette = LOCAL_VECTOR_BASEMAPS.jma;
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapLeft, mapTop, mapWidth, mapHeight);
    ctx.clip();
    ctx.fillStyle = palette.ocean;
    ctx.fillRect(mapLeft, mapTop, mapWidth, mapHeight);

    if (landGeoJson && landGeoJson.features) {
      ctx.fillStyle = palette.land;
      ctx.lineWidth = 1.05 * scale;
      const drawPolygonCoords = (coordinates: number[][][]) => {
        ctx.beginPath();
        coordinates.forEach((ring) => {
          ring.forEach((pt: number[], idx: number) => {
            const { x, y } = project(pt[1], pt[0]);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        });
        ctx.fill("evenodd");
      };
      landGeoJson.features.forEach((feat: any) => {
        const geom = feat.geometry;
        if (!geom) return;
        if (geom.type === "Polygon") drawPolygonCoords(geom.coordinates);
        else if (geom.type === "MultiPolygon") geom.coordinates.forEach((poly: number[][][]) => drawPolygonCoords(poly));
      });
    }

    if (false && countriesGeoJson && countriesGeoJson.features) {
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 0.65 * scale;
      const drawBorderCoords = (coordinates: number[][][]) => {
        ctx.beginPath();
        coordinates.forEach((ring) => {
          ring.forEach((pt: number[], idx: number) => {
            const { x, y } = project(pt[1], pt[0]);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        });
        ctx.stroke();
      };
      countriesGeoJson.features.forEach((feat: any) => {
        const geom = feat.geometry;
        if (!geom) return;
        if (geom.type === "Polygon") drawBorderCoords(geom.coordinates);
        else if (geom.type === "MultiPolygon") geom.coordinates.forEach((poly: number[][][]) => drawBorderCoords(poly));
      });
    }

    const lonStep = 10;
    const latStep = 10;
    ctx.strokeStyle = JMA_PRODUCT_COLORS.grid;
    ctx.lineWidth = 1.0 * scale;
    ctx.setLineDash([]);
    // Polar stereographic graticule: extend the sampled geographic domain beyond the fitted
    // content box so the curved meridians/parallels fully span the visible map after the
    // projected aspect-ratio expansion.  This prevents truncated grid lines near the edges.
    // Sample a broad fixed WNP/East-Asia domain and rely on the map clip. This guarantees that
    // the curved polar-stereographic graticule reaches every visible edge even when the camera is
    // tightly fitted around a short forecast envelope.
    const gridMinLat = -5;
    const gridMaxLat = 85;
    const gridMinLon = 60;
    const gridMaxLon = 220;
    for (let lon = Math.ceil(gridMinLon / lonStep) * lonStep; lon <= gridMaxLon; lon += lonStep) {
      ctx.beginPath();
      let started = false;
      for (let lat = gridMinLat; lat <= gridMaxLat + 1e-6; lat += 0.6) {
        const p = project(lat, lon);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (started) ctx.stroke();
    }
    for (let lat = Math.ceil(gridMinLat / latStep) * latStep; lat <= gridMaxLat; lat += latStep) {
      ctx.beginPath();
      let started = false;
      for (let lon = gridMinLon; lon <= gridMaxLon + 1e-6; lon += 0.6) {
        const p = project(lat, lon);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (started) ctx.stroke();
    }

    const sortedHistoryForDisplay = historyForDisplay.slice().sort((a, b) => Number(a.simHour) - Number(b.simHour));
    const historyPath: any[] = [];
    if (sortedHistoryForDisplay.length) {
      const firstHistoryHour = Number(sortedHistoryForDisplay[0].simHour || 0);
      const lastHistoryHour = Math.min(Number(currentHour), Number(sortedHistoryForDisplay[sortedHistoryForDisplay.length - 1].simHour || 0));
      const nodeCount = Math.floor((lastHistoryHour - firstHistoryHour + 1e-6) / 3);
      for (let i = 0; i <= nodeCount; i++) {
        const targetHour = firstHistoryHour + i * 3;
        let nearest = sortedHistoryForDisplay[0];
        let nearestDiff = Math.abs(Number(nearest.simHour) - targetHour);
        for (const state of sortedHistoryForDisplay) {
          const diff = Math.abs(Number(state.simHour) - targetHour);
          if (diff < nearestDiff) { nearest = state; nearestDiff = diff; }
        }
        historyPath.push(nearest);
      }
    }
    if (historyPath.length >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = JMA_PRODUCT_COLORS.forecast;
      ctx.lineWidth = 2.0 * scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "miter";
      for (let i = 1; i < historyPath.length; i++) {
        const a = historyPath[i - 1];
        const b = historyPath[i];
        const p1 = project(Number(a.lat), Number(a.lon));
        const p2 = project(Number(b.lat), Number(b.lon));
        const isEt = !a.coldAirWarmCoreDestroyed && a.category !== TyphoonCategory.RL &&
          (a.category === TyphoonCategory.ET || Number(a.extrTransition || 0) >= 0.80);
        const isRemnant = a.category === TyphoonCategory.RL || !!a.coldAirWarmCoreDestroyed;
        const isTd = a.category === TyphoonCategory.TD || Number(a.vmax || 0) < 17.2;
        ctx.setLineDash((isTd || isEt || isRemnant) ? [6 * scale, 5 * scale] : []);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    const trackPoints = [{ lead: 0, lat: Number(activeState.lat), lon: Number(activeState.lon), radiusKm: 0, date: forecastBaseDate }, ...forecastPoints];
    const pixelTrack = trackPoints.map((pt) => {
      const projected = project(pt.lat, pt.lon);
      return { ...pt, x: projected.x, y: projected.y, r: kmToPx(Number(pt.radiusKm || 0), pt.lat) };
    });

    // Build two distinct envelopes. White = forecast uncertainty area created by
    // connecting the 70% forecast circles. Red = possible storm-wind passage area,
    // i.e. each forecast circle expanded by the forecast storm-wind radius.
    // Both envelopes are now derived from per-segment external tangents so the
    // white envelope truly "connects the white circles" like the JMA reference.
    type EnvelopeCircle = { x: number; y: number; r: number };
    type EnvelopeSegment = { start: { x: number; y: number }; end: { x: number; y: number } };
    type EnvelopeShape = {
      circles: EnvelopeCircle[];
      leftSegments: EnvelopeSegment[];
      rightSegments: EnvelopeSegment[];
    };
    const buildEnvelope = (extraStorm: boolean): EnvelopeShape => {
      const circles: EnvelopeCircle[] = pixelTrack.map((pt: any, idx: number) => {
        const baseKm = Number(pt.radiusKm || 0);
        const stormKm = idx === 0
          ? (stormWind.visible ? stormWind.radiusKm : 0)
          : Number((forecastPoints[idx - 1] as any)?.stormRadiusKm || 0);
        const rr = idx === 0
          ? (extraStorm ? kmToPx(stormKm, pt.lat) : 0)
          : kmToPx(baseKm + (extraStorm ? stormKm : 0), pt.lat);
        return { x: pt.x, y: pt.y, r: rr };
      });
      const leftSegments: EnvelopeSegment[] = [];
      const rightSegments: EnvelopeSegment[] = [];
      for (let i = 0; i < circles.length - 1; i++) {
        const a = circles[i];
        const b = circles[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1e-6, Math.hypot(dx, dy));
        // Start point may be radius zero at the current position. Keep the envelope pointed there.
        if (a.r <= 1e-6) {
          const nx = -dy / d;
          const ny = dx / d;
          leftSegments.push({ start: { x: a.x, y: a.y }, end: { x: b.x + nx * b.r, y: b.y + ny * b.r } });
          rightSegments.push({ start: { x: a.x, y: a.y }, end: { x: b.x - nx * b.r, y: b.y - ny * b.r } });
          continue;
        }
        const diff = Math.max(-1, Math.min(1, (a.r - b.r) / d));
        const theta = Math.atan2(dy, dx);
        const alpha = Math.acos(diff);
        const leftAngle = theta + alpha;
        const rightAngle = theta - alpha;
        leftSegments.push({
          start: { x: a.x + Math.cos(leftAngle) * a.r, y: a.y + Math.sin(leftAngle) * a.r },
          end: { x: b.x + Math.cos(leftAngle) * b.r, y: b.y + Math.sin(leftAngle) * b.r }
        });
        rightSegments.push({
          start: { x: a.x + Math.cos(rightAngle) * a.r, y: a.y + Math.sin(rightAngle) * a.r },
          end: { x: b.x + Math.cos(rightAngle) * b.r, y: b.y + Math.sin(rightAngle) * b.r }
        });
      }
      return { circles, leftSegments, rightSegments };
    };
    const normaliseAngle = (a: number) => {
      let out = a % (Math.PI * 2);
      if (out < 0) out += Math.PI * 2;
      return out;
    };
    const angleIsOnCcwSweep = (start: number, end: number, test: number) => {
      const s = normaliseAngle(start);
      const e = normaliseAngle(end);
      const t = normaliseAngle(test);
      const ccwSpan = (e - s + Math.PI * 2) % (Math.PI * 2);
      const ccwTest = (t - s + Math.PI * 2) % (Math.PI * 2);
      return ccwTest <= ccwSpan + 1e-6;
    };
    // Draws a minor (shorter) arc on circle `c` between two points that both lie on its
    // boundary. Any two points on a circle's boundary can be joined either by a straight
    // chord (which cuts across the circle's interior) or by an arc that stays exactly on
    // the boundary. Interior forecast circles need the arc: the tangent line reaching a
    // circle from the previous circle and the tangent line leaving it toward the next
    // circle generally touch the circle at two different points whenever the track bends,
    // and connecting those two points with a straight line is what previously made the
    // white envelope cut through the middle of the forecast circles.
    const arcBetweenPointsOnCircle = (c: EnvelopeCircle, from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a0 = Math.atan2(from.y - c.y, from.x - c.x);
      const a1 = Math.atan2(to.y - c.y, to.x - c.x);
      let diff = a1 - a0;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ctx.arc(c.x, c.y, c.r, a0, a0 + diff, diff < 0);
    };
    const drawEnvelopePath = (shape: EnvelopeShape) => {
      const { circles, leftSegments, rightSegments } = shape;
      if (circles.length < 2 || !leftSegments.length || !rightSegments.length) return;
      const first = circles[0];
      const last = circles[circles.length - 1];

      // Left side, walking forward from the current position to the final forecast circle.
      // Every interior circle is hugged with an arc between the tangent point coming in
      // from the previous circle and the tangent point going out to the next one, so the
      // envelope always rides the true outside of each circle instead of cutting a chord
      // across it.
      ctx.moveTo(leftSegments[0].start.x, leftSegments[0].start.y);
      ctx.lineTo(leftSegments[0].end.x, leftSegments[0].end.y);
      for (let i = 1; i < leftSegments.length; i++) {
        const c = circles[i];
        const prevEnd = leftSegments[i - 1].end;
        const nextStart = leftSegments[i].start;
        if (c.r > 1e-6) arcBetweenPointsOnCircle(c, prevEnd, nextStart);
        ctx.lineTo(nextStart.x, nextStart.y);
        ctx.lineTo(leftSegments[i].end.x, leftSegments[i].end.y);
      }

      if (last.r > 1e-6) {
        const lp = leftSegments[leftSegments.length - 1].end;
        const rp = rightSegments[rightSegments.length - 1].end;
        const a0 = Math.atan2(lp.y - last.y, lp.x - last.x);
        const a1 = Math.atan2(rp.y - last.y, rp.x - last.x);
        const prev = circles.length >= 2 ? circles[circles.length - 2] : null;
        // The terminal cap should wrap the "front" side of the final forecast circle,
        // i.e. the side in the direction of forecast motion beyond the last centre.
        const frontAngle = prev ? Math.atan2(last.y - prev.y, last.x - prev.x) : normaliseAngle((a0 + a1) / 2);
        const useCcw = angleIsOnCcwSweep(a0, a1, frontAngle);
        ctx.arc(last.x, last.y, last.r, a0, a1, useCcw);
      } else {
        ctx.lineTo(rightSegments[rightSegments.length - 1].end.x, rightSegments[rightSegments.length - 1].end.y);
      }

      // Right side, walking backward from the final forecast circle back to the current
      // position, hugging each interior circle the same way as the left side above.
      for (let i = rightSegments.length - 1; i >= 0; i--) {
        ctx.lineTo(rightSegments[i].start.x, rightSegments[i].start.y);
        if (i > 0) {
          const c = circles[i];
          const nextEnd = rightSegments[i - 1].end;
          if (c.r > 1e-6) arcBetweenPointsOnCircle(c, rightSegments[i].start, nextEnd);
          ctx.lineTo(nextEnd.x, nextEnd.y);
        }
      }

      if (first.r > 1e-6) {
        const rs = rightSegments[0].start;
        const ls = leftSegments[0].start;
        const a0 = Math.atan2(rs.y - first.y, rs.x - first.x);
        const a1 = Math.atan2(ls.y - first.y, ls.x - first.x);
        const next = circles.length >= 2 ? circles[1] : null;
        // The starting cap should cover the side opposite the outgoing path, keeping the
        // current storm-wind circle as the beginning of the red warning envelope.
        const rearAngle = next ? Math.atan2(first.y - next.y, first.x - next.x) : normaliseAngle((a0 + a1) / 2);
        const useCcw = angleIsOnCcwSweep(a0, a1, rearAngle);
        ctx.arc(first.x, first.y, first.r, a0, a1, useCcw);
      }
      ctx.closePath();
    };
    const uncertaintyEnvelope = buildEnvelope(false);

    // Round171: Round169 envelope geometry/weight with solid, fully opaque white.
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5 * scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    drawEnvelopePath(uncertaintyEnvelope);
    ctx.stroke();
    ctx.restore();

    if (jmaShowPredictedRings) {
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3.0 * scale;
      ctx.setLineDash([4.4 * scale, 4.0 * scale]);
      forecastPoints.forEach((pt) => {
        const p = project(pt.lat, pt.lon);
        const r = kmToPx(pt.radiusKm, pt.lat);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (jmaShowCurrentWindArea) {
      if (strongWind.visible) {
        const p = project(strongWind.centerLat, strongWind.centerLon);
        const r = kmToPx(strongWind.radiusKm, strongWind.centerLat);
        ctx.save();
        ctx.strokeStyle = JMA_PRODUCT_COLORS.strongWind;
        ctx.lineWidth = 4.2 * scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (stormWind.visible) {
        const p = project(stormWind.centerLat, stormWind.centerLon);
        const r = kmToPx(stormWind.radiusKm, stormWind.centerLat);
        ctx.save();
        ctx.strokeStyle = JMA_PRODUCT_COLORS.stormWind;
        ctx.lineWidth = 3.5 * scale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.save();
    pixelTrack.forEach((pt, idx) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, idx === 0 ? 5.0 * scale : 3.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    });
    ctx.restore();

    const weekdayChars = ["日", "月", "火", "水", "木", "金", "土"];
    const formatJmaPointLabel = (date: Date) => `${date.getDate()}(${weekdayChars[date.getDay()]})${String(date.getHours()).padStart(2, "0")}时`;
    const headerLeftBoxX = 30 * scale;
    const headerLeftBoxY = 30 * scale;
    const headerLeftBoxH = 60 * scale;
    const headerLeftBoxW = 168 * scale;
    const headerRightBoxX = headerLeftBoxX + 172 * scale;
    const headerRightBoxW = 214 * scale;
    const usedLabelRects: { x: number; y: number; w: number; h: number }[] = [
      // Reserve the complete top-left information plate before placing forecast labels. This keeps
      // date labels and the typhoon-number label from being laid underneath the plate.
      { x: headerLeftBoxX - 8 * scale, y: headerLeftBoxY - 8 * scale, w: headerLeftBoxW + headerRightBoxW + 20 * scale, h: headerLeftBoxH + 16 * scale }
    ];
    const overlapsRect = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    const drawOutlinedText = (textValue: string, x: number, y: number, align: CanvasTextAlign = "left", fontPx: number = 20, fill: string = "#ffffff") => {
      ctx.save();
      ctx.font = `700 ${fontPx * scale}px "Yu Gothic","Noto Sans CJK JP","Microsoft YaHei",sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3.2 * scale, fontPx * scale * 0.18);
      ctx.lineJoin = "round";
      ctx.strokeStyle = JMA_PRODUCT_COLORS.labelOutline;
      ctx.strokeText(textValue, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(textValue, x, y);
      ctx.restore();
    };
    const placeJmaLabel = (textValue: string, anchorX: number, anchorY: number, fontPx: number, candidates: { dx: number; dy: number; align: CanvasTextAlign }[]) => {
      ctx.save();
      ctx.font = `700 ${fontPx * scale}px "Yu Gothic","Noto Sans CJK JP","Microsoft YaHei",sans-serif`;
      const textW = ctx.measureText(textValue).width;
      ctx.restore();
      const textH = fontPx * scale * 1.15;
      const pad = 4 * scale;
      let chosen = null as null | { x: number; y: number; align: CanvasTextAlign; rect: { x: number; y: number; w: number; h: number }; score: number };
      for (const candidate of candidates) {
        let x = anchorX + candidate.dx * scale;
        let y = anchorY + candidate.dy * scale;
        const left = candidate.align === "center" ? x - textW / 2 - pad : candidate.align === "right" ? x - textW - pad : x - pad;
        const rect = { x: left, y: y - textH / 2 - pad, w: textW + pad * 2, h: textH + pad * 2 };
        let penalty = 0;
        usedLabelRects.forEach((other, otherIndex) => { if (overlapsRect(rect, other)) penalty += otherIndex === 0 ? 100000 : 1000; });
        if (rect.x < mapLeft + 4 * scale || rect.x + rect.w > mapRight - 4 * scale) penalty += 100;
        if (rect.y < mapTop + 4 * scale || rect.y + rect.h > mapBottom - 4 * scale) penalty += 100;
        penalty += Math.hypot(x - anchorX, y - anchorY) * 0.03;
        if (!chosen || penalty < chosen.score) chosen = { x, y, align: candidate.align, rect, score: penalty };
      }
      if (!chosen) return;
      // clamp softly back inside map if needed
      const minX = mapLeft + 8 * scale;
      const maxX = mapRight - 8 * scale;
      const minY = mapTop + 8 * scale;
      const maxY = mapBottom - 8 * scale;
      let drawX = chosen.x;
      let drawY = chosen.y;
      if (chosen.align === "center") {
        drawX = Math.max(minX + textW / 2, Math.min(maxX - textW / 2, drawX));
      } else if (chosen.align === "right") {
        drawX = Math.max(minX + textW, Math.min(maxX, drawX));
      } else {
        drawX = Math.max(minX, Math.min(maxX - textW, drawX));
      }
      drawY = Math.max(minY + textH / 2, Math.min(maxY - textH / 2, drawY));
      const finalLeft = chosen.align === "center" ? drawX - textW / 2 - pad : chosen.align === "right" ? drawX - textW - pad : drawX - pad;
      usedLabelRects.push({ x: finalLeft, y: drawY - textH / 2 - pad, w: textW + pad * 2, h: textH + pad * 2 });
      drawOutlinedText(textValue, drawX, drawY, chosen.align, fontPx);
    };

    pixelTrack.forEach((pt, idx) => {
      const prev = pixelTrack[Math.max(0, idx - 1)] || pt;
      const next = pixelTrack[Math.min(pixelTrack.length - 1, idx + 1)] || pt;
      const vx = next.x - prev.x;
      const vy = next.y - prev.y;
      const labelDate = idx === 0 ? forecastBaseDate : (forecastPoints[idx - 1]?.date || forecastBaseDate);
      const label = formatJmaPointLabel(labelDate);
      const primaryRight = vx >= 0;
      const primaryBelow = vy >= 0;
      const nearCurrent = idx <= 2;
      const nearEnd = idx >= pixelTrack.length - 2;
      const candidates = primaryRight
        ? [
            { dx: 14, dy: primaryBelow ? 24 : -24, align: "left" as CanvasTextAlign },
            { dx: 14, dy: primaryBelow ? -24 : 24, align: "left" as CanvasTextAlign },
            { dx: -14, dy: primaryBelow ? 24 : -24, align: "right" as CanvasTextAlign },
            { dx: -14, dy: primaryBelow ? -24 : 24, align: "right" as CanvasTextAlign },
            { dx: nearCurrent ? -2 : 0, dy: nearCurrent ? 30 : (nearEnd ? -30 : 28), align: "center" as CanvasTextAlign },
            { dx: 20, dy: 62, align: "left" as CanvasTextAlign },
            { dx: -20, dy: 62, align: "right" as CanvasTextAlign },
            { dx: 20, dy: -62, align: "left" as CanvasTextAlign }
          ]
        : [
            { dx: -14, dy: primaryBelow ? 24 : -24, align: "right" as CanvasTextAlign },
            { dx: -14, dy: primaryBelow ? -24 : 24, align: "right" as CanvasTextAlign },
            { dx: 14, dy: primaryBelow ? 24 : -24, align: "left" as CanvasTextAlign },
            { dx: 14, dy: primaryBelow ? -24 : 24, align: "left" as CanvasTextAlign },
            { dx: nearCurrent ? -2 : 0, dy: nearCurrent ? 30 : (nearEnd ? -30 : 28), align: "center" as CanvasTextAlign },
            { dx: -20, dy: 62, align: "right" as CanvasTextAlign },
            { dx: 20, dy: 62, align: "left" as CanvasTextAlign },
            { dx: -20, dy: -62, align: "right" as CanvasTextAlign }
          ];
      placeJmaLabel(label, pt.x, pt.y, idx === 0 ? 17 : 16, candidates);
    });

    placeJmaLabel(`${typhoonOrdinalNumber}号`, pixelTrack[0].x, pixelTrack[0].y, 24, [
      { dx: -92, dy: 58, align: "right" as CanvasTextAlign },
      { dx: -90, dy: -56, align: "right" as CanvasTextAlign },
      { dx: 92, dy: 58, align: "left" as CanvasTextAlign },
      { dx: 92, dy: -56, align: "left" as CanvasTextAlign }
    ]);

    ctx.restore();

    const titleNo = `${typhoonOrdinalNumber}号`;
    const titleTime = `${forecastBaseDate.getMonth() + 1}月${forecastBaseDate.getDate()}日 ${String(forecastBaseDate.getHours()).padStart(2, "0")}时`;
    const leftBoxX = headerLeftBoxX;
    const leftBoxY = headerLeftBoxY;
    const leftBoxH = headerLeftBoxH;
    ctx.save();
    ctx.fillStyle = JMA_PRODUCT_COLORS.headerBlue;
    ctx.strokeStyle = JMA_PRODUCT_COLORS.headerBorder;
    ctx.lineWidth = 2.4 * scale;
    ctx.beginPath();
    ctx.roundRect(leftBoxX, leftBoxY, headerLeftBoxW, leftBoxH, 7 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${24 * scale}px "Microsoft YaHei",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`台风 ${titleNo}`, leftBoxX + headerLeftBoxW / 2, leftBoxY + leftBoxH / 2);

    const rightBoxX = headerRightBoxX;
    const rightBoxW = headerRightBoxW;
    ctx.fillStyle = JMA_PRODUCT_COLORS.headerLight;
    ctx.beginPath();
    ctx.roundRect(rightBoxX, leftBoxY, rightBoxW, leftBoxH, 4 * scale);
    ctx.fill();
    ctx.strokeStyle = JMA_PRODUCT_COLORS.headerBorder;
    ctx.lineWidth = 2.2 * scale;
    ctx.stroke();
    ctx.fillStyle = JMA_PRODUCT_COLORS.headerText;
    ctx.font = `700 ${23 * scale}px "Microsoft YaHei",sans-serif`;
    ctx.fillText(titleTime, rightBoxX + rightBoxW / 2, leftBoxY + leftBoxH / 2);

    ctx.fillStyle = JMA_PRODUCT_COLORS.logoGreen;
    ctx.font = `500 ${22 * scale}px Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("JMA", W - 26 * scale, H - 42 * scale);
    ctx.restore();

    if (typeof setGenerationProgress === "function") setGenerationProgress(100);
  };

  // Round137: the former monolithic NMC drawing code was removed. The rebuilt
  // reference-style product is isolated from all other weather-map renderers.
  const drawStandardMapOnCanvas = async (canvas: HTMLCanvasElement | null, isMini = false, signal?: AbortSignal, maxWidth?: number) => {
    if (!canvas) throw new Error("NMC 绘图画布不存在");
    setGenerationProgress(5);
    const ready = geoJsonLoaded || await ensureProductGeoJson();
    // A successful fetch without any drawable polygon features must not
    // silently produce an all-ocean NMC plate. The NMC renderer can also
    // use the country plate if the dedicated land geometry is unavailable.
    if (!ready || !(landGeoJson?.features?.length || countriesGeoJson?.features?.length)) {
      // Never encode a white placeholder as a successful forecast. The exporter
      // waits for this promise and surfaces the error instead.
      throw new Error("NMC 地理底图尚未准备完成，请重试生成");
    }
    // Hydrate full-resolution forecast geometry/intensity only when this product
    // is explicitly previewed or exported (Round131 on-demand simulation).
    const issue = isHistoricalIssue ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    const copiedMainHistory = issuePreSimulationReference(typhoon,Number(issue.simHour))?.origin==='main-history';
    const issueStorm = mergeTyphoonStateWithCurrentIdentity(typhoon, issue, {
      active: !(issue as any).dissipated,
      // The true terminal observation may lie after the playback cursor.
      // Preserve those states solely for main-history continuation physics;
      // the NMC drawing itself filters the displayed past at issueHour.
      history: copiedMainHistory ? (typhoon.history || [])
        : (typhoon.history?.filter(h => h.simHour <= currentHour) || [])
    });
    const rawForecast = materializeProductForecast(issueStorm, config, forecastHours, issue.forecastPath,
      false, nmcCoarseIntensity ? 'adaptive' : 'round164');
    const history=issueStorm.history||[];
    const genesisAgeHours=history.length ? Math.max(0,Number(issue.simHour)-Number(history[0].simHour)) : Infinity;
    const manualIntensityActive=!!config?.manualForecastRouteEnabled && !!config?.manualForecastIntensityEnabled
      && (config?.manualForecastIntensityCurve?.length||0)>0;
    // The official terminal lead is taken from the UNMODIFIED physical forecast.
    // Product-only peak shaping may never push the public track past its stop.
    const commonIssued = selectNmcIssuedForecast(
      {lat:issue.lat,lon:issue.lon,vmax:issue.vmax,simHour:currentHour,category:(issue as any).category},
      rawForecast.filter(pt=>Number(pt.simHour)>0).map(pt=>({...pt,simHour:currentHour+pt.simHour})),currentHour,forecastHours);
    const commonEnd = commonIssued.at(-1)?.simHour ?? currentHour;
    const publishedLead = Math.max(0,commonEnd-currentHour);
    // NMC-only genesis conservatism is layered on top of the ordinary or
    // confirmed pre-simulation-guided physics (never the other way round).
    const exactMainHistory = copiedMainHistory;
    const baseForecast = nmcCoarseIntensity && !manualIntensityActive && !exactMainHistory
      ? limitNmcGenesisPeak(rawForecast,genesisAgeHours,Number(issue.vmax)) : rawForecast;
    const limitedForecast = baseForecast
      .filter(pt=>Number.isFinite(pt.simHour)&&pt.simHour<=publishedLead+1e-6);
    // Include the actual (possibly irregular) terminal fix before constraining
    // intensity. Otherwise the hard maximum might be reached outside the PNG.
    if(publishedLead>1e-6 && !limitedForecast.some(pt=>Math.abs(pt.simHour-publishedLead)<1e-5)){
      const before = [...baseForecast].filter(pt=>pt.simHour<publishedLead).sort((a,b)=>b.simHour-a.simHour)[0];
      const after = [...baseForecast].filter(pt=>pt.simHour>publishedLead).sort((a,b)=>a.simHour-b.simHour)[0];
      const terminal = commonIssued.at(-1);
      if(before && after && terminal && after.simHour>before.simHour){
        const f=(publishedLead-before.simHour)/(after.simHour-before.simHour);
        limitedForecast.push({...after,simHour:publishedLead,lat:terminal.lat,lon:terminal.lon,
          vmax:before.vmax+(after.vmax-before.vmax)*f,
          pmin:before.pmin+(after.pmin-before.pmin)*f,
          landed:before.landed && after.landed,
          category:(terminal.category || after.category) as TyphoonCategory});
      }
    }
    // Round174: explicitly enabled NMC peak always applies to this image,
    // INCLUDING forecasts with a confirmed pre-simulation reference. Round173
    // suppressed the override unconditionally for those references, making
    // the visible checkbox/slider non-functional. A disabled override leaves
    // the verified pre-simulation trend completely untouched. An enabled
    // override reshapes only a separate NMC product forecast copy (preserving
    // its underlying rising/falling tendencies); it never mutates the main
    // simulation, the pre-simulation reference, JMA or any other product.
    // The exact maximum is checked against the actually published forecast;
    // impossible requests fail visibly instead of silently being ignored.
    const applyImagePeak = nmcCustomPeakEnabled;
    // NMC peak control is an INTEGER wind target. Never promote the raw
    // fractional issue wind (e.g. 67.633330997) to a display-only exact peak.
    const requestedPeak = Math.max(Math.ceil(Number(issue.vmax)),Math.round(nmcCustomPeak));
    const forecastData = applyImagePeak
      ? shapeNmcPeakIntensity(limitedForecast,requestedPeak,Number(issue.vmax))
      : limitedForecast;
    const points = forecastData
      .filter(pt => Number.isFinite(pt.lat) && Number.isFinite(pt.lon) && Number(pt.simHour)>0 && currentHour+pt.simHour<=commonEnd+1e-6)
      .map(pt => ({ lat: pt.lat, lon: pt.lon, vmax: pt.vmax, simHour: currentHour + pt.simHour,
        category: (pt as any).category }));
    const overlayData = await loadNmcOptionalGeography(nmcProvinces, nmcRivers);
    overlayDataRef.current = overlayData;
    setNmcOverlayError(overlayData.errors.join('；'));
    const outputWidth = isMini ? 640 : Math.min(
      chooseSafeNmcWidth(selectedRes.width, detectNmcDeviceClass(!!mobileMode)), maxWidth ?? Infinity
    );
    if (!isMini && outputWidth < selectedRes.width) {
      setGenerationStatus(`设备内存保护：${selectedRes.width}px 调整为 ${outputWidth}px`);
    }
    await drawNmcForecastProductCooperative({
      canvas, width: outputWidth,
      typhoonName, typhoonNumber, ordinalNumber: typhoonOrdinalNumber,
      issueDate: forecastBaseDate, forecastHours, issueHour: currentHour, startDate,
      current: { lat: issue.lat, lon: issue.lon, vmax: issue.vmax, simHour: currentHour,
        category: (issue as any).category },
      history: typhoon.history || [], forecast: points, issuedEndHour: commonEnd,
      landGeoJson, coastlineGeoJson: nmcFineCoastlineGeoJson, countriesGeoJson,
      provinceGeoJson: overlayData.provinces, riversGeoJson: overlayData.rivers,
      overlayNationalBorders: nmcBorders, overlayChinaProvinces: nmcProvinces,
      overlayRivers: nmcRivers, chinaLandTint: nmcChinaTint,
      showInfoBoxes, showCenterBox, showForecastBox
    }, { signal, onProgress: isMini ? undefined : (progress) => setGenerationProgress(progress),
      onWarning: (message) => { if (!isMini) setGenerationStatus(message); } });
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    if (!hasNmcRenderedContent(canvas)) throw new Error("NMC 绘制结果为空白，请重试或降低输出分辨率");
    if (!isMini) setGenerationProgress(90);
  };

  // Pre-generate a 1167x667 land mask array for instant O(1) grid land-checks during meteorological simulation
  const createLandMask = (landGeoJson: any) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1167;
    canvas.height = 667;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#000000"; // Sea is black
    ctx.fillRect(0, 0, 1167, 667);

    if (landGeoJson && landGeoJson.features) {
      ctx.fillStyle = "#ffffff"; // Land is white
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;

      const project = (lon: number, lat: number) => {
        const x = ((lon - 110.0) / (145.0 - 110.0)) * 1167;
        const y = ((30.0 - lat) / (30.0 - 10.0)) * 667;
        return { x, y };
      };

      const drawPoly = (coordinates: number[][][]) => {
        ctx.beginPath();
        coordinates.forEach((ring) => {
          ring.forEach((pt, idx) => {
            const { x, y } = project(pt[0], pt[1]);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        });
        ctx.fill();
        ctx.stroke();
      };

      landGeoJson.features.forEach((feat: any) => {
        if (!feat.geometry) return;
        if (feat.geometry.type === "Polygon") drawPoly(feat.geometry.coordinates);
        else if (feat.geometry.type === "MultiPolygon") {
          feat.geometry.coordinates.forEach((p: any) => drawPoly(p));
        }
      });
    }
    return ctx.getImageData(0, 0, 1167, 667).data;
  };

  const drawRainForecastOnCanvas = async (canvas: HTMLCanvasElement | null, isMini: boolean = false) => {
    if (!canvas) return;
    if (!(geoJsonLoaded || await ensureProductGeoJson())) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = isMini ? 400 : selectedRes.width;
    const H = isMini ? 300 : selectedRes.height;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const scale = W / 1920;
    
    // Fill white
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Map bounds
    const mapLeft = 80 * scale;
    const mapRight = W - 80 * scale;
    const mapTop = 160 * scale;
    const mapBottom = H - 80 * scale;
    const mapWidth = mapRight - mapLeft;
    const mapHeight = mapBottom - mapTop;

    // Draw Title
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.font = `${36 * scale}px sans-serif`;
    const fHours = forecastHours; // Use user selected hours
    ctx.fillText(`今年第${typhoonOrdinalNumber}号台风 “${typhoonName}” 未来${fHours}小时降水预报图`, W / 2, 70 * scale);
    
    // Time
    const activeState = isHistoricalIssue ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    const startTime = new Date(startDate.getTime() + currentHour * 3600000);
    const endTime = new Date(startTime.getTime() + fHours * 3600000);
    
    const formatTime = (d: Date) => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${d.getHours().toString().padStart(2, '0')}时`;
    const formatTimeEnd = (d: Date) => `${d.getDate()}日${d.getHours().toString().padStart(2, '0')}时`;
    
    ctx.font = `${26 * scale}px sans-serif`;
    ctx.fillText(`${formatTime(startTime)}—${formatTimeEnd(endTime)} (北京时)`, W / 2, 115 * scale);

    const baseConfig = config || activeState.configSnapshot || {
      subtropicalHighEnabled: true, subtropicalHighStrength: 1.0, subtropicalHighLat: 28.0,
      subtropicalHighLon: 135.0, subtropicalHighWestExtent: 125.0, westerliesEnabled: true,
      westerliesStrength: 1.0, westerliesLat: 30.0, westerliesTroughLon: 120.0, westerliesTroughDepth: 1.0,
      betaDriftEnabled: true, betaDriftScale: 1.0, monsoonTroughEnabled: false, eastWaveEnabled: false,
      shearScale: 1.0, humidityScale: 1.0, outflowScale: 1.0, dryAirEnabled: true, randomNoise: 0,
      sstAnomaly: 0, sstNorthSouthGradient: 1.0, ohcScale: 1.0, warmPoolEnabled: true, coldEddyEnabled: false,
      airSeaCoupling: 0.5, ewrcTrigger: "auto", rapidIntensifyEnabled: true, landDecayEnabled: true,
      terrainDecayEnabled: true, landfallDecayAdjustment: 0, landProximityDecayAdjustment: 0,
      landTdDissipateMode: "6h", intensificationRate: 1.0, etEnabled: true,
      seed: "default", joystickSensitivity: 1.0, joystickStrength: 1.0, joystickDx: 0, joystickDy: 0,
      soundEnabled: false, soundVolume: 0, followMainTyphoon: false
    };

    const tempTyphoon: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState, {
      active: !(activeState as any).dissipated,
      history: typhoon.history?.filter(h => h.simHour <= currentHour) || []
    });
    const historicalForecastPath = (activeState as any).forecastPath as Typhoon["forecastPath"] | undefined;
    const path = materializeForecastPath(tempTyphoon, baseConfig, fHours, historicalForecastPath);
    const path24h = path.filter(p => p.simHour <= currentHour + fHours);
    
    // Auto-frame map bounds around typhoon path with proper geographic extent
    let pMinLon = activeState.lon, pMaxLon = activeState.lon;
    let pMinLat = activeState.lat, pMaxLat = activeState.lat;
    for (const pt of path24h) {
      if (pt.lon < pMinLon) pMinLon = pt.lon;
      if (pt.lon > pMaxLon) pMaxLon = pt.lon;
      if (pt.lat < pMinLat) pMinLat = pt.lat;
      if (pt.lat > pMaxLat) pMaxLat = pt.lat;
    }

    let minLon = pMinLon - 5.5;
    let maxLon = pMaxLon + 5.5;
    let minLat = pMinLat - 4.5;
    let maxLat = pMaxLat + 4.5;

    // Guarantee minimum geographic frame
    if (maxLon - minLon < 16.0) {
      const midLon = (minLon + maxLon) / 2;
      minLon = midLon - 8.0; maxLon = midLon + 8.0;
    }
    if (maxLat - minLat < 13.0) {
      const midLat = (minLat + maxLat) / 2;
      minLat = midLat - 6.5; maxLat = midLat + 6.5;
    }

    const mapAspect = mapWidth / mapHeight;
    const dataAspect = (maxLon - minLon) / (maxLat - minLat);
    if (dataAspect > mapAspect) {
      const extraLat = ((maxLon - minLon) / mapAspect) - (maxLat - minLat);
      minLat -= extraLat / 2; maxLat += extraLat / 2;
    } else {
      const extraLon = ((maxLat - minLat) * mapAspect) - (maxLon - minLon);
      minLon -= extraLon / 2; maxLon += extraLon / 2;
    }

    const latLonToPixel = (lat: number, lon: number) => {
      const x = mapLeft + ((lon - minLon) / (maxLon - minLon)) * mapWidth;
      const y = mapBottom - ((lat - minLat) / (maxLat - minLat)) * mapHeight;
      return { x, y };
    };

    // Draw Map Background
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapLeft, mapTop, mapWidth, mapHeight);
    ctx.clip();
    
    // Sea
    ctx.fillStyle = "#EAF4FE";
    ctx.fillRect(mapLeft, mapTop, mapWidth, mapHeight);
    
    // Land
    ctx.fillStyle = "#F8EBD6";
    const drawPoly = (coordinates: number[][][]) => {
      for (const ring of coordinates) {
        ctx.beginPath();
        for (let i = 0; i < ring.length; i++) {
          const pt = latLonToPixel(ring[i][1], ring[i][0]);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fill();
        strokeProductCoastlineRing(ctx, ring, (lat, lon) => latLonToPixel(lat, lon));
      }
    };
    ctx.strokeStyle = "#C0A880";
    ctx.lineWidth = 1;
    if (landGeoJson && landGeoJson.features) {
      landGeoJson.features.forEach((feat: any) => {
        if (feat.geometry.type === "Polygon") drawPoly(feat.geometry.coordinates);
        else if (feat.geometry.type === "MultiPolygon") feat.geometry.coordinates.forEach(drawPoly);
      });
    }

    // Grid lines (lat/lon)
    ctx.strokeStyle = "#888888";
    ctx.lineWidth = 0.5;
    for (let l = Math.floor(minLat); l <= Math.ceil(maxLat); l++) {
      if (l % 5 === 0) {
        const pt = latLonToPixel(l, minLon);
        ctx.beginPath(); ctx.moveTo(mapLeft, pt.y); ctx.lineTo(mapRight, pt.y); ctx.stroke();
        ctx.fillStyle = "#000"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        ctx.font = `${12 * scale}px sans-serif`;
        ctx.fillText(l + "°N", mapRight + 30 * scale, pt.y);
      }
    }
    for (let l = Math.floor(minLon); l <= Math.ceil(maxLon); l++) {
      if (l % 5 === 0) {
        const pt = latLonToPixel(minLat, l);
        ctx.beginPath(); ctx.moveTo(pt.x, mapTop); ctx.lineTo(pt.x, mapBottom); ctx.stroke();
        ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.font = `${12 * scale}px sans-serif`;
        ctx.fillText(l + "°E", pt.x, mapBottom + 10 * scale);
      }
    }

    if (typeof setGenerationProgress === "function") setGenerationProgress(5);
    await new Promise(r => setTimeout(r, 0));

    // High calculation precision grid (0.04 degrees)
    const rainGridSize = 0.04;
    const cols = Math.ceil((maxLon - minLon) / rainGridSize);
    const rows = Math.ceil((maxLat - minLat) / rainGridSize);
    const rainGrid = new Float32Array(cols * rows);
    
    const steps = path24h.length;
    let maxAccuRain = 0;

    let lastRainYieldAt = performance.now();
    let lastRainProgress = -1;
    for (let i = 0; i < steps; i++) {
      const rainProgress = 10 + Math.floor((i / Math.max(1, steps)) * 50);
      if (rainProgress !== lastRainProgress) {
        setGenerationProgress(rainProgress);
        lastRainProgress = rainProgress;
      }
      // Keep the main thread responsive without paying a timer/task switch on every two
      // forecast points. The meteorological sampling grid and all integration steps are intact.
      if ((i & 1) === 0 && performance.now() - lastRainYieldAt >= 11) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        lastRainYieldAt = performance.now();
      }
      
      const pt = path24h[i];
      const prev = i > 0 ? path24h[i-1] : {lat: activeState.lat, lon: activeState.lon, vmax: activeState.vmax, simHour: activeState.simHour};
      
      const interps = 10;
      for (let j = 1; j <= interps; j++) {
        const r = j / interps;
        const clat = prev.lat + (pt.lat - prev.lat) * r;
        const clon = prev.lon + (pt.lon - prev.lon) * r;
        const cvmax = prev.vmax + (pt.vmax - prev.vmax) * r;
        
        // Calibrated 24h accumulated rainfall physics (mm/h rate during storm passage)
        // Eyewall convective core rainfall rate: tightly focused so Grade 14 typhoon produces ~250-320mm compact landfall core
        const coreRate = Math.pow(Math.max(15, cvmax) / 10, 1.30) * 5.2;
        const innerRate = Math.pow(Math.max(15, cvmax) / 10, 1.05) * 3.2;
        const outerRate = 1.8;
        // Strong landfalling typhoons can retain or briefly increase rainfall
        // efficiency as coastal friction enhances low-level convergence while
        // the inner circulation is still fed by adjacent oceanic moisture.
        const centerOnLand = checkPointOnLandGeoJson(clat, clon);
        const strongLandfallFactor = centerOnLand
          ? Math.max(0, Math.min(1, (cvmax - 32) / 30))
          : 0;
        
        const infl = 4.2; // ~460km outer rainfall influence
        const minG_lat = Math.max(0, Math.floor((clat - infl - minLat) / rainGridSize));
        const maxG_lat = Math.min(rows - 1, Math.ceil((clat + infl - minLat) / rainGridSize));
        const minG_lon = Math.max(0, Math.floor((clon - infl - minLon) / rainGridSize));
        const maxG_lon = Math.min(cols - 1, Math.ceil((clon + infl - minLon) / rainGridSize));

        const dtSubHours = 24.0 / (Math.max(1, steps) * interps);
        
        for (let y = minG_lat; y <= maxG_lat; y++) {
          const glat = minLat + y * rainGridSize;
          for (let x = minG_lon; x <= maxG_lon; x++) {
            const glon = minLon + x * rainGridSize;
            
            const dx = (glon - clon) * Math.cos(clat * Math.PI / 180) * 111;
            const dy = (glat - clat) * 111;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < infl * 111) {
              // Compact eyewall core profile (radius ~22km) so >=250mm 特大暴雨 is tightly focused around landfall core
              let coreR = coreRate * Math.exp(-(dist*dist)/(22 * 22));
              let innerR = innerRate * Math.exp(-(dist*dist)/(100 * 100));
              let outerR = outerRate * Math.exp(-(dist*dist)/(300 * 300));
              
              // Logarithmic spiral rainband modulation (螺旋雨带)
              const azimuth = Math.atan2(dy, dx);
              const spiralPhase = azimuth - 2.8 * Math.log(Math.max(1, dist / 20.0));
              const spiralPulse = 0.85 + 0.30 * Math.pow(Math.cos(3.0 * spiralPhase), 2);

              let rainRate = (coreR + innerR + outerR) * spiralPulse;
              
              // Continuous front-right quadrant convective asymmetry
              rainRate *= (1.0 + 0.15 * Math.sin(azimuth - Math.PI / 4));

              // Fresh strong-typhoon landfall: frictional convergence enhances
              // the near-core/rainband rainfall instead of applying an
              // immediate post-landfall reduction.
              if (strongLandfallFactor > 0) {
                const landfallCore = Math.exp(-(dist * dist) / (175 * 175));
                rainRate *= 1.0 + 0.38 * strongLandfallFactor * landfallCore;
              }

              // Orographic lifting over land terrain (降水陆地抬升)
              const elev = getProceduralElevation(glat, glon);
              if (elev > 0 && strongLandfallFactor > 0) {
                rainRate *= 1.10 + 0.10 * strongLandfallFactor;
              }
              if (elev > 40) {
                 rainRate *= (1.0 + Math.min(elev / 450, 1.25));
              }

              const gIdx = y * cols + x;
              rainGrid[gIdx] += rainRate * dtSubHours;
              if (rainGrid[gIdx] > maxAccuRain) {
                maxAccuRain = rainGrid[gIdx];
              }
            }
          }
        }
      }
    }

    if (typeof setGenerationProgress === "function") setGenerationProgress(65);

    // Double 3x3 Spatial Gaussian Blur Pass over rainGrid to eliminate pixelation and create silky smooth, natural contour boundaries
    let currentRain = rainGrid;
    for (let pass = 0; pass < 2; pass++) {
      const smoothedRainPass = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let sum = 0;
          let wSum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= rows) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= cols) continue;
              const weight = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0 ? 2 : 1);
              sum += currentRain[ny * cols + nx] * weight;
              wSum += weight;
            }
          }
          smoothedRainPass[y * cols + x] = sum / wSum;
        }
      }
      currentRain = smoothedRainPass;
    }
    const smoothedRain = currentRain;

    // High performance ImageData rendering
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = cols;
    gridCanvas.height = rows;
    const gridCtx = gridCanvas.getContext("2d");

    if (gridCtx) {
      if (typeof setGenerationProgress === "function") setGenerationProgress(80);
      await new Promise(r => setTimeout(r, 0));

      const imgData = gridCtx.createImageData(cols, rows);
      const data = imgData.data;

      const hasExtreme400 = maxAccuRain >= 380;

      for (let y = 0; y < rows; y++) {
        const imgY = rows - 1 - y;
        for (let x = 0; x < cols; x++) {
          const rain = smoothedRain[y * cols + x];
          if (rain >= 0.1) {
            let r = 0, g = 0, b = 0, a = 210;
            if (rain >= 400)      { r = 230; g = 145; b = 0; }   // 400mm+ 极强中心 #E69100
            else if (rain >= 250) { r = 115; g = 0;   b = 38; }  // 特大暴雨 #730026
            else if (rain >= 100) { r = 250; g = 0;   b = 250; } // 大暴雨 #FA00FA
            else if (rain >= 50)  { r = 0;   g = 0;   b = 255; } // 暴雨 #0000FF
            else if (rain >= 25)  { r = 97;  g = 184; b = 255; } // 大雨 #61B8FF
            else if (rain >= 10)  { r = 56;  g = 168; b = 0; }   // 中雨 #38A800
            else if (rain >= 0.1) { r = 166; g = 242; b = 143; } // 小雨 #A6F28F

            const idx = (imgY * cols + x) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }

      gridCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.globalAlpha = 0.90;
      ctx.imageSmoothingEnabled = false;

      // PRECISION LAND MASK CLIPPING: Rain forecast ONLY renders on land polygons!
      if (landGeoJson && landGeoJson.features) {
        ctx.beginPath();
        const clipPoly = (coordinates: number[][][]) => {
          for (const ring of coordinates) {
            for (let i = 0; i < ring.length; i++) {
              const pt = latLonToPixel(ring[i][1], ring[i][0]);
              if (i === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
          }
        };
        landGeoJson.features.forEach((feat: any) => {
          if (feat.geometry.type === "Polygon") clipPoly(feat.geometry.coordinates);
          else if (feat.geometry.type === "MultiPolygon") feat.geometry.coordinates.forEach(clipPoly);
        });
        ctx.clip("evenodd");
      }

      ctx.drawImage(gridCanvas, mapLeft, mapTop, mapWidth, mapHeight);
      ctx.restore();

      // Superimpose fine coastlines on top of rainfall blocks
      drawCoastlinesOnTop(ctx, latLonToPixel, scale);
    }

    ctx.restore(); // map clip

    // Draw CMA logo & Maker info
    ctx.fillStyle = "#000080"; // Navy blue text
    ctx.textAlign = "right";
    ctx.font = `bold ${24 * scale}px sans-serif`;
    ctx.fillText(loadAgencyBranding('rain_forecast').agencyName, mapRight - 20 * scale, mapTop + 40 * scale, mapWidth*.33);
    ctx.font = `bold ${20 * scale}px sans-serif`;
    ctx.fillText(`${forecastBaseDate.getMonth()+1}月${forecastBaseDate.getDate()}日${forecastBaseDate.getHours().toString().padStart(2, '0')}时制作`, mapRight - 20 * scale, mapTop + 70 * scale);

    // Draw outer map border
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(mapLeft, mapTop, mapWidth, mapHeight);

    // Legend - Sized to comfortably fit all items without overflow
    const hasExtreme400 = maxAccuRain >= 380;
    const legX = mapLeft + 20 * scale;
    const legY = mapBottom - (hasExtreme400 ? 360 : 320) * scale;
    const legW = 340 * scale;
    const legH = (hasExtreme400 ? 340 : 300) * scale;
    
    ctx.fillStyle = "#F8F9FA";
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeRect(legX, legY, legW, legH);
    
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.font = `bold ${20 * scale}px sans-serif`;
    ctx.fillText("图例", legX + 20 * scale, legY + 30 * scale);
    
    const items = [
      { c: "#A6F28F", l: "小雨 (0.1-9.9毫米)" },
      { c: "#38A800", l: "中雨 (10-24.9毫米)" },
      { c: "#61B8FF", l: "大雨 (25-49.9毫米)" },
      { c: "#0000FF", l: "暴雨 (50-99.9毫米)" },
      { c: "#FA00FA", l: "大暴雨 (100-249.9毫米)" },
      { c: "#730026", l: hasExtreme400 ? "特大暴雨 (250-399.9毫米)" : "特大暴雨 (≥250毫米)" }
    ];
    if (hasExtreme400) {
      items.push({ c: "#E69100", l: "特大暴雨 (≥400毫米)" });
    }
    
    items.forEach((item, idx) => {
      ctx.fillStyle = item.c;
      ctx.fillRect(legX + 20 * scale, legY + 48 * scale + idx * 40 * scale, 45 * scale, 22 * scale);
      ctx.strokeRect(legX + 20 * scale, legY + 48 * scale + idx * 40 * scale, 45 * scale, 22 * scale);
      ctx.fillStyle = "#000";
      ctx.font = `${16 * scale}px sans-serif`;
      ctx.fillText(item.l, legX + 75 * scale, legY + 65 * scale + idx * 40 * scale);
    });

    if (typeof setGenerationProgress === 'function') setGenerationProgress(100);
  };

  // =========================================================================================
  // WIND FORECAST
  // =========================================================================================
  const drawWindForecastOnCanvas = async (canvas: HTMLCanvasElement | null, isMini: boolean = false) => {
    if (!canvas) return;
    if (!(geoJsonLoaded || await ensureProductGeoJson())) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (typeof setGenerationProgress === "function") setGenerationProgress(5);
    await new Promise(r => setTimeout(r, 0));

    const W = isMini ? 400 : selectedRes.width;
    const H = isMini ? 300 : selectedRes.height;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const scale = W / 1920;
    
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const mapLeft = 80 * scale; const mapRight = W - 80 * scale;
    const mapTop = 160 * scale; const mapBottom = H - 80 * scale;
    const mapWidth = mapRight - mapLeft; const mapHeight = mapBottom - mapTop;

    ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.font = `${36 * scale}px sans-serif`;
    const fHours = forecastHours; 
    ctx.fillText(`今年第${typhoonOrdinalNumber}号台风 “${typhoonName}” 未来${fHours}小时大风预报图`, W / 2, 70 * scale);
    
    const activeState = isHistoricalIssue ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    const startTime = new Date(startDate.getTime() + currentHour * 3600000);
    const endTime = new Date(startTime.getTime() + fHours * 3600000);
    const formatTime = (d: Date) => `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${d.getHours().toString().padStart(2, '0')}时`;
    const formatTimeEnd = (d: Date) => `${d.getDate()}日${d.getHours().toString().padStart(2, '0')}时`;
    ctx.font = `${26 * scale}px sans-serif`;
    ctx.fillText(`${formatTime(startTime)}—${formatTimeEnd(endTime)} (北京时)`, W / 2, 115 * scale);

    const baseConfig = config || activeState.configSnapshot;
    const tempTyphoon: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState, {
      active: !(activeState as any).dissipated,
      history: typhoon.history?.filter(h => h.simHour <= currentHour) || []
    });
    const historicalForecastPath = (activeState as any).forecastPath as Typhoon["forecastPath"] | undefined;
    const path = materializeForecastPath(tempTyphoon, baseConfig, fHours, historicalForecastPath);
    const path24h = path.filter(p => p.simHour <= currentHour + fHours);

    // Auto-adjust zoom level and bounding box for wind map to fit track & broad gale envelope
    let pMinLon = activeState.lon, pMaxLon = activeState.lon;
    let pMinLat = activeState.lat, pMaxLat = activeState.lat;
    for (const pt of path24h) {
      if (pt.lon < pMinLon) pMinLon = pt.lon;
      if (pt.lon > pMaxLon) pMaxLon = pt.lon;
      if (pt.lat < pMinLat) pMinLat = pt.lat;
      if (pt.lat > pMaxLat) pMaxLat = pt.lat;
    }

    let minLon = pMinLon - 7.5;
    let maxLon = pMaxLon + 7.5;
    let minLat = pMinLat - 6.5;
    let maxLat = pMaxLat + 6.5;

    // Guarantee minimum geographic frame so East China, Taiwan & surrounding seas look spacious
    if (maxLon - minLon < 20.0) {
      const midLon = (minLon + maxLon) / 2;
      minLon = midLon - 10.0; maxLon = midLon + 10.0;
    }
    if (maxLat - minLat < 15.0) {
      const midLat = (minLat + maxLat) / 2;
      minLat = midLat - 7.5; maxLat = midLat + 7.5;
    }

    const mapAspect = mapWidth / mapHeight;
    const dataAspect = (maxLon - minLon) / (maxLat - minLat);
    if (dataAspect > mapAspect) {
      const extraLat = ((maxLon - minLon) / mapAspect) - (maxLat - minLat);
      minLat -= extraLat / 2; maxLat += extraLat / 2;
    } else {
      const extraLon = ((maxLat - minLat) * mapAspect) - (maxLon - minLon);
      minLon -= extraLon / 2; maxLon += extraLon / 2;
    }

    const latLonToPixel = (lat: number, lon: number) => {
      return { x: mapLeft + ((lon - minLon) / (maxLon - minLon)) * mapWidth, y: mapBottom - ((lat - minLat) / (maxLat - minLat)) * mapHeight };
    };

    ctx.save(); ctx.beginPath(); ctx.rect(mapLeft, mapTop, mapWidth, mapHeight); ctx.clip();
    ctx.fillStyle = "#EAF4FE"; ctx.fillRect(mapLeft, mapTop, mapWidth, mapHeight);
    
    ctx.fillStyle = "#F8EBD6"; ctx.strokeStyle = "#C0A880"; ctx.lineWidth = 1;
    const drawPoly = (coordinates: number[][][]) => {
      for (const ring of coordinates) {
        ctx.beginPath();
        for (let i = 0; i < ring.length; i++) {
          const pt = latLonToPixel(ring[i][1], ring[i][0]);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath(); ctx.fill();
        strokeProductCoastlineRing(ctx, ring, (lat, lon) => latLonToPixel(lat, lon));
      }
    };
    if (landGeoJson && landGeoJson.features) {
      landGeoJson.features.forEach((feat: any) => {
        if (feat.geometry.type === "Polygon") drawPoly(feat.geometry.coordinates);
        else if (feat.geometry.type === "MultiPolygon") feat.geometry.coordinates.forEach(drawPoly);
      });
    }

    for (let l = Math.floor(minLat); l <= Math.ceil(maxLat); l++) {
      if (l % 5 === 0) {
        const pt = latLonToPixel(l, minLon);
        ctx.beginPath(); ctx.moveTo(mapLeft, pt.y); ctx.lineTo(mapRight, pt.y); ctx.strokeStyle="#888"; ctx.stroke();
        ctx.fillStyle = "#000"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.font = `${12 * scale}px sans-serif`;
        ctx.fillText(l + "°N", mapRight + 30 * scale, pt.y);
      }
    }
    for (let l = Math.floor(minLon); l <= Math.ceil(maxLon); l++) {
      if (l % 5 === 0) {
        const pt = latLonToPixel(minLat, l);
        ctx.beginPath(); ctx.moveTo(pt.x, mapTop); ctx.lineTo(pt.x, mapBottom); ctx.strokeStyle="#888"; ctx.stroke();
        ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = `${12 * scale}px sans-serif`;
        ctx.fillText(l + "°E", pt.x, mapBottom + 10 * scale);
      }
    }

    // High resolution grid (0.035 deg) for sharp-edged solid color blocks without wave ripples
    const windGridSize = 0.035;
    const cols = Math.ceil((maxLon - minLon) / windGridSize);
    const rows = Math.ceil((maxLat - minLat) / windGridSize);
    const windGrid = new Float32Array(cols * rows);

    // Precalculate land mask on grid for land friction wind decay (风力上岸衰减)
    const isLandGrid = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      const glat = minLat + y * windGridSize;
      for (let x = 0; x < cols; x++) {
        const glon = minLon + x * windGridSize;
        if (checkPointOnLandGeoJson(glat, glon)) {
          isLandGrid[y * cols + x] = 1;
        }
      }
    }
    
    // 1. Build dense sub-sampled trajectory track points with continuous heading angle along path
    const trackPoints: { lat: number; lon: number; vmax: number; windRadiusVmax: number; headingRad: number }[] = [];
    const denseSteps = Math.max(220, path24h.length * 25);
    
    for (let i = 0; i < denseSteps; i++) {
      const frac = i / (denseSteps - 1);
      const pathIdx = frac * (path24h.length - 1);
      const idx0 = Math.floor(pathIdx);
      const idx1 = Math.min(path24h.length - 1, idx0 + 1);
      const r = pathIdx - idx0;
      
      const p0 = path24h[idx0] || { lat: activeState.lat, lon: activeState.lon, vmax: activeState.vmax };
      const p1 = path24h[idx1] || p0;
      
      const clat = p0.lat + (p1.lat - p0.lat) * r;
      const clon = p0.lon + (p1.lon - p0.lon) * r;
      const cvmax = p0.vmax + (p1.vmax - p0.vmax) * r;
      
      let headingRad = 0;
      if (idx1 > idx0) {
        const dLat = (p1.lat - p0.lat) * 111.0;
        const dLon = (p1.lon - p0.lon) * Math.cos(clat * Math.PI / 180) * 111.0;
        headingRad = Math.atan2(dLat, dLon);
      } else if (i > 0) {
        headingRad = trackPoints[i - 1].headingRad;
      }
      
      // Center position remains visually continuous, but operational wind-radius analysis is held
      // from the latest 3-hourly forecast point until the next synoptic update.
      trackPoints.push({ lat: clat, lon: clon, vmax: cvmax, windRadiusVmax: p0.vmax, headingRad });
    }

    // 2. Iterate dense track points and integrate wind speed envelope continuously across grid
    const numTrackPts = trackPoints.length;
    let lastWindProgress = -1;
    let lastWindYieldAt = performance.now();
    for (let i = 0; i < numTrackPts; i++) {
      if ((i % 20) === 0) {
        const windProgress = 10 + Math.floor((i / numTrackPts) * 65);
        if (windProgress !== lastWindProgress) {
          setGenerationProgress(windProgress);
          lastWindProgress = windProgress;
        }
        if (performance.now() - lastWindYieldAt >= 11) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          lastWindYieldAt = performance.now();
        }
      }

      const pt = trackPoints[i];
      const cvmax = pt.vmax;
      const clat = pt.lat;
      const clon = pt.lon;
      const heading = pt.headingRad;
      const cosLat = Math.cos(clat * Math.PI / 180);

      // Wind-circle geometry is an analysis product: calculate it only at the 3-hour forecast
      // points and hold it constant between issue times instead of continuously morphing it.
      const stdR = getStandardAverageWindRadii(pt.windRadiusVmax);
      const r12 = stdR.r12; // ~50-100km
      const r10 = stdR.r10; // ~70-165km
      const r7  = stdR.r7;  // ~180-380km
      const r13 = Math.max(20, r12 * 0.72);
      const r11 = r12 > 0 ? (r12 + (r10 - r12) * 0.5) : Math.max(35, r10 * 0.7);
      const r9  = r10 > 0 ? (r10 + (r7 - r10) * 0.3) : Math.max(50, r7 * 0.5);
      const r8  = r10 > 0 ? (r10 + (r7 - r10) * 0.6) : Math.max(90, r7 * 0.75);
      const r6  = Math.max(220, r7 * 1.28); // ~230-480km outer 6-level wind circle

      const maxInflKm = r6 * 1.22;
      const inflLatDeg = maxInflKm / 111.0;
      const inflLonDeg = maxInflKm / (cosLat * 111.0);

      const minG_lat = Math.max(0, Math.floor((clat - inflLatDeg - minLat) / windGridSize));
      const maxG_lat = Math.min(rows - 1, Math.ceil((clat + inflLatDeg - minLat) / windGridSize));
      const minG_lon = Math.max(0, Math.floor((clon - inflLonDeg - minLon) / windGridSize));
      const maxG_lon = Math.min(cols - 1, Math.ceil((clon + inflLonDeg - minLon) / windGridSize));

      for (let y = minG_lat; y <= maxG_lat; y++) {
        const glat = minLat + y * windGridSize;
        const dY = (glat - clat) * 111.0;

        for (let x = minG_lon; x <= maxG_lon; x++) {
          const glon = minLon + x * windGridSize;
          const dX = (glon - clon) * cosLat * 111.0;
          const dist = Math.sqrt(dX * dX + dY * dY);

          if (dist > maxInflKm) continue;

          // Continuous front-right quadrant asymmetry factor relative to instantaneous storm heading
          const azimuth = Math.atan2(dY, dX);
          const angleDiff = azimuth - heading;
          const asymFactor = 1.0 + 0.16 * Math.sin(angleDiff); // smooth right-side enhancement (1.16 starboard, 0.84 port)

          const effR13 = r13 * asymFactor;
          const effR12 = r12 * asymFactor;
          const effR11 = r11 * asymFactor;
          const effR10 = r10 * asymFactor;
          const effR9  = r9  * asymFactor;
          const effR8  = r8  * asymFactor;
          const effR7  = r7  * asymFactor;
          const effR6  = r6  * asymFactor;

          let wSea = 0;
          if (dist <= effR13) {
            wSea = cvmax;
          } else if (dist <= effR12) {
            const f = (dist - effR13) / Math.max(1, effR12 - effR13);
            wSea = cvmax * (1.0 - f) + 32.7 * f;
          } else if (dist <= effR11) {
            const f = (dist - effR12) / Math.max(1, effR11 - effR12);
            wSea = 32.7 * (1.0 - f) + 28.5 * f;
          } else if (dist <= effR10) {
            const f = (dist - effR11) / Math.max(1, effR10 - effR11);
            wSea = 28.5 * (1.0 - f) + 24.5 * f;
          } else if (dist <= effR9) {
            const f = (dist - effR10) / Math.max(1, effR9 - effR10);
            wSea = 24.5 * (1.0 - f) + 20.8 * f;
          } else if (dist <= effR8) {
            const f = (dist - effR9) / Math.max(1, effR8 - effR9);
            wSea = 20.8 * (1.0 - f) + 17.2 * f;
          } else if (dist <= effR7) {
            const f = (dist - effR8) / Math.max(1, effR7 - effR8);
            wSea = 17.2 * (1.0 - f) + 13.9 * f;
          } else if (dist <= effR6) {
            const f = (dist - effR7) / Math.max(1, effR6 - effR7);
            wSea = 13.9 * (1.0 - f) + 10.8 * f;
          } else {
            const decayScale = 80.0;
            wSea = 10.8 * Math.exp(-(dist - effR6) / decayScale);
          }

          // Land friction decay (风力上岸衰减)
          const gIdx = y * cols + x;
          if (isLandGrid[gIdx]) {
            wSea *= 0.72;
          }

          if (wSea > windGrid[gIdx]) {
            windGrid[gIdx] = wSea;
          }
        }
      }
    }

    if (typeof setGenerationProgress === 'function') setGenerationProgress(75);
    await new Promise(r => setTimeout(r, 0));

    // Double 3x3 Spatial Gaussian Blur Pass over windGrid to guarantee silky-smooth, 100% seam-free solid color blocks
    let currentWind = windGrid;
    for (let pass = 0; pass < 2; pass++) {
      const smoothedWindPass = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let sum = 0;
          let wSum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= rows) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              if (nx < 0 || nx >= cols) continue;
              const weight = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0 ? 2 : 1);
              sum += currentWind[ny * cols + nx] * weight;
              wSum += weight;
            }
          }
          smoothedWindPass[y * cols + x] = sum / wSum;
        }
      }
      currentWind = smoothedWindPass;
    }
    const smoothedWind = currentWind;

    // ImageData rendering for crisp, sharp-edged solid color blocks without ripples
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = cols;
    gridCanvas.height = rows;
    const gridCtx = gridCanvas.getContext("2d");

    if (gridCtx) {
      if (typeof setGenerationProgress === "function") setGenerationProgress(85);
      await new Promise(r => setTimeout(r, 0));

      const imgData = gridCtx.createImageData(cols, rows);
      const data = imgData.data;

      for (let y = 0; y < rows; y++) {
        const imgY = rows - 1 - y;
        for (let x = 0; x < cols; x++) {
          const w = smoothedWind[y * cols + x];
          if (w >= 10.8) { // 6级 >= 10.8m/s
            let r = 0, g = 0, b = 0, a = 215;
            if (w >= 37.0)      { r = 204; g = 0;   b = 0; }   // 13级+ #CC0000
            else if (w >= 32.7) { r = 255; g = 0;   b = 0; }   // 12级 #FF0000
            else if (w >= 28.5) { r = 255; g = 102; b = 102; } // 11级 #FF6666
            else if (w >= 24.5) { r = 255; g = 153; b = 0; }   // 10级 #FF9900
            else if (w >= 20.8) { r = 255; g = 204; b = 0; }   // 9级  #FFCC00
            else if (w >= 17.2) { r = 0;   g = 0;   b = 204; } // 8级  #0000CC
            else if (w >= 13.9) { r = 0;   g = 102; b = 255; } // 7级  #0066FF
            else if (w >= 10.8) { r = 0;   g = 204; b = 255; } // 6级  #00CCFF
            
            const idx = (imgY * cols + x) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }

      gridCtx.putImageData(imgData, 0, 0);

      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(gridCanvas, mapLeft, mapTop, mapWidth, mapHeight);
      ctx.restore();

      // Superimpose fine coastlines on top of wind blocks
      drawCoastlinesOnTop(ctx, latLonToPixel, scale);
    }

    ctx.restore();

    ctx.fillStyle = "#000080"; ctx.textAlign = "right"; ctx.font = `bold ${24 * scale}px sans-serif`;
    ctx.fillText(loadAgencyBranding('wind_forecast').agencyName, mapRight - 20 * scale, mapTop + 40 * scale, mapWidth*.33);
    ctx.font = `bold ${20 * scale}px sans-serif`;
    ctx.fillText(`${forecastBaseDate.getMonth()+1}月${forecastBaseDate.getDate()}日${forecastBaseDate.getHours().toString().padStart(2, '0')}时制作`, mapRight - 20 * scale, mapTop + 70 * scale);

    ctx.strokeStyle = "#000"; ctx.lineWidth = 2 * scale; ctx.strokeRect(mapLeft, mapTop, mapWidth, mapHeight);

    // Legend
    const legX = mapLeft + 20 * scale; const legY = mapBottom - 360 * scale;
    const legW = 220 * scale; const legH = 340 * scale;
    ctx.fillStyle = "#F8F9FA"; ctx.fillRect(legX, legY, legW, legH); ctx.strokeRect(legX, legY, legW, legH);
    ctx.fillStyle = "#000"; ctx.textAlign = "left"; ctx.font = `${22 * scale}px sans-serif`;
    ctx.fillText("图例", legX + 20 * scale, legY + 30 * scale);
    
    const wItems = [
      { c: "#00CCFF", l: "6级" },
      { c: "#0066FF", l: "7级" },
      { c: "#0000CC", l: "8级" },
      { c: "#FFCC00", l: "9级" },
      { c: "#FF9900", l: "10级" },
      { c: "#FF6666", l: "11级" },
      { c: "#FF0000", l: "12级" },
      { c: "#CC0000", l: "13级及以上" }
    ];
    
    wItems.forEach((item, idx) => {
      ctx.fillStyle = item.c;
      ctx.fillRect(legX + 20 * scale, legY + 50 * scale + idx * 35 * scale, 40 * scale, 20 * scale);
      ctx.strokeRect(legX + 20 * scale, legY + 50 * scale + idx * 35 * scale, 40 * scale, 20 * scale);
      ctx.fillStyle = "#000"; ctx.font = `${18 * scale}px sans-serif`;
      ctx.fillText(item.l, legX + 70 * scale, legY + 66 * scale + idx * 35 * scale);
    });

    if (typeof setGenerationProgress === 'function') setGenerationProgress(100);
  };

  // =========================================================================================
  // SCATTEROMETER
  // =========================================================================================
  const drawEnsembleMapOnCanvas = async (
    canvas: HTMLCanvasElement | null,
    isMini: boolean = false,
    membersOverride?: AetherGuidanceMember[],
    signal?: AbortSignal
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Ensemble products always calculate against the large product coastline plate.
    if (!(await ensureProductGeoJson())) return;
    const W = isMini ? 640 : selectedRes.width;
    const ensembleAspect = getEnsembleReferenceAspect(ensembleReferenceStyle);
    const H = ensembleReferenceStyle === "classic"
      ? (isMini ? 420 : selectedRes.height)
      : Math.max(360, Math.round(W / ensembleAspect));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const scale = W / (isMini ? 640 : 1920);
    const activeState = isHistoricalIssue ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon) : typhoon;
    // forecastPath and calculateForecastPath both store *lead hours* in simHour. The ensemble
    // builder normalises the occasional absolute-hour historical path internally so this product
    // uses the exact same reference forecast as the live map.
    const productStorm = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState);
    const residualContinuationProduct = ensembleReferenceStyle === "pressure_spaghetti_basin" || ensembleReferenceStyle === "paired_cycle_pressure" || (ensembleReferenceStyle === "strike_probability_120km" && strikeTrackEndMode === "residual");
    const ensembleHorizon = resolveEnsembleHorizon(ensembleReferenceStyle);
    const framingReferencePath = materializeProductForecast(
      productStorm, config, ensembleHorizon, activeState.forecastPath
    ).filter((pt: any) => Number.isFinite(pt.lat) && Number.isFinite(pt.lon) && Number(pt.simHour ?? 0) <= ensembleHorizon + 1e-6);
    const referencePath = (residualContinuationProduct && (ensembleReferenceStyle === "strike_probability_120km" ? strikeTrackEndMode === "residual" : ensembleSpecialTrackEndMode === "residual")
      ? materializeForecastPath(productStorm, config, ensembleHorizon, activeState.forecastPath, true)
      : framingReferencePath)
      .filter((pt: any) => Number.isFinite(pt.lat) && Number.isFinite(pt.lon) && Number(pt.simHour ?? 0) <= ensembleHorizon + 1e-6);
    const scene = typhoons?.length ? typhoons : [typhoon];
    const guidanceIssueHour = Math.floor(currentHour / 3) * 3;
    const centers = buildAetherCenterGuidance(mergeTyphoonStateWithCurrentIdentity(typhoon, activeState), guidanceIssueHour, scene, config?.seed || "WMC", referencePath, ensembleHorizon, config, true);
    const visibleCenters = ensembleProductNeedsMembers ? centers.filter(c => selectedEnsembleModels.includes(c.modelId)) : centers;
    const memberTracks = membersOverride?.length ? membersOverride : ensembleMembers;
    const allTracks = ensembleProductNeedsMembers ? (memberTracks.length ? memberTracks : visibleCenters) : visibleCenters;

    if (ensembleReferenceStyle !== "classic") {
      const historicalTrack = (typhoon.history || [])
        .filter((h: any) => Number.isFinite(h?.simHour) && h.simHour <= currentHour + 1e-6)
        .map((h: any) => ({ lat: Number(h.lat), lon: Number(h.lon), vmax: Number(h.vmax), pmin: Number(h.pmin), simHour: Number(h.simHour) }))
        .filter((h: any) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
      const strikeProvinces = ensembleReferenceStyle === "strike_probability_120km"
        ? (await loadNmcOptionalGeography(true,false)).provinces : undefined;
      if (signal?.aborted) throw new DOMException("cancelled","AbortError");
      await drawEnsembleReferenceProductAsync({
        canvas,
        style: ensembleReferenceStyle,
        typhoon,
        activeState: activeState as any,
        currentHour,
        startDate,
        config,
        centers: visibleCenters,
        members: memberTracks,
        referencePath,
        framingReferencePath,
        forecastHorizonHours: ensembleHorizon,
        specialMapRangeMode: ensembleSpecialMapRangeMode,
        specialShowMainPath: ensembleSpecialShowMainPath,
        specialTrackEndMode: ensembleSpecialTrackEndMode,
        historicalTrack,
        width: W,
        height: H,
        isMini,
        stormName: typhoonName,
        selectedModelIds: selectedEnsembleModels,
        ensembleAnalysisFooter: ensIntelFooter,
        ensembleAnalysisUnit: ensIntelUnit,
        strike: ensembleReferenceStyle === "strike_probability_120km" || ensembleReferenceStyle === "ensemble_intensity_analysis" ? { ...strikeOptions, provincesGeoJson:strikeProvinces } : undefined,
        signal,
        onProgress: (pct) => {if(!isMini)setGenerationProgress(prev=>Math.max(prev,pct));},
        strikeCache:strikeFieldCacheRef.current
      });
      return;
    }

    // Streaming bounds keeps the 8×500-member case cheap and avoids constructing another giant
    // point array just to obtain min/max.
    let minLat=Number(activeState.lat),maxLat=Number(activeState.lat),minLon=Number(activeState.lon),maxLon=Number(activeState.lon);
    const absorb=(lat:number,lon:number)=>{if(!Number.isFinite(lat)||!Number.isFinite(lon))return;minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);};
    referencePath.forEach((p:any)=>absorb(Number(p.lat),Number(p.lon)));
    allTracks.forEach(m=>m.track.forEach(p=>absorb(p.lat,p.lon)));
    const latPad=Math.max(1.9,(maxLat-minLat)*.085),lonPad=Math.max(2.4,(maxLon-minLon)*.075);
    minLat=Math.max(-78,minLat-latPad);maxLat=Math.min(82,maxLat+latPad);minLon=Math.max(-180,minLon-lonPad);maxLon=Math.min(180,maxLon+lonPad);
    if(maxLat-minLat<12.5){const c=(maxLat+minLat)/2;minLat=c-6.25;maxLat=c+6.25;}
    if(maxLon-minLon<16.5){const c=(maxLon+minLon)/2;minLon=c-8.25;maxLon=c+8.25;}

    const headerH=isMini?38:64*scale, footerH=isMini?16:30*scale;
    const sideW=!isMini ? Math.max(300*scale, W*.205) : 0;
    const mapLeft=isMini?0:70*scale, mapRight=W-sideW-(isMini?0:16*scale), mapTop=headerH, mapBottom=H-footerH-14*scale;
    const mapW=mapRight-mapLeft,mapH=mapBottom-mapTop;
    // Preserve geographic aspect ratio. The former renderer independently stretched latitude and
    // longitude to fill the rectangle, visibly deforming Korea/Japan/China at mid latitudes.
    const midLat=(minLat+maxLat)/2,cosMid=Math.max(.22,Math.cos(midLat*Math.PI/180));
    let latSpan=maxLat-minLat,lonSpan=maxLon-minLon;
    const geoAspect=(lonSpan*cosMid)/Math.max(.001,latSpan),boxAspect=mapW/Math.max(1,mapH);
    if(geoAspect<boxAspect){const wantLon=latSpan*boxAspect/cosMid,d=(wantLon-lonSpan)/2;minLon-=d;maxLon+=d;lonSpan=wantLon;}
    else {const wantLat=lonSpan*cosMid/boxAspect,d=(wantLat-latSpan)/2;minLat-=d;maxLat+=d;latSpan=wantLat;}
    const centerLon=(minLon+maxLon)/2;
    const project=(lat:number,lon:number)=>({x:mapLeft+(lon-minLon)/(maxLon-minLon)*mapW,y:mapBottom-(lat-minLat)/(maxLat-minLat)*mapH});
    const unwrapRing=(ring:any[])=>{const out:Array<[number,number]>=[];let prev=centerLon;for(const c of ring||[]){let lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;while(lon-prev>180)lon-=360;while(lon-prev<-180)lon+=360;out.push([lon,lat]);prev=lon;}return out;};

    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#f5f7fa";ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#a6d7f4";ctx.fillRect(mapLeft,mapTop,mapW,mapH);
    if(!isMini){ctx.fillStyle="#ffffff";ctx.fillRect(mapRight+8*scale,0,W-mapRight-8*scale,H);}
    ctx.fillStyle="#0b33f0";ctx.textAlign="center";ctx.font=`500 ${isMini?17:34*scale}px Arial,"Microsoft YaHei",sans-serif`;
    ctx.fillText(ensembleMode==="members"?`${selectedEnsembleModels.join("+")} 集合预报路径`:`多模式热带气旋路径预报`,mapLeft+mapW/2,isMini?25:30*scale);
    if(!isMini){ctx.font=`500 ${16*scale}px Arial,"Microsoft YaHei",sans-serif`;ctx.fillText(`${formatChineseDateShort(new Date(startDate.getTime()+currentHour*3600000))} · WMC SIMULATED GUIDANCE`,mapLeft+mapW/2,51*scale);}

    ctx.save();ctx.beginPath();ctx.rect(mapLeft,mapTop,mapW,mapH);ctx.clip();
    ctx.strokeStyle="rgba(255,255,255,.72)";ctx.lineWidth=Math.max(.7,scale);ctx.setLineDash([6*scale,4*scale]);
    for(let lon=Math.ceil(minLon/5)*5;lon<=maxLon;lon+=5){const q=project(minLat,lon);ctx.beginPath();ctx.moveTo(q.x,mapTop);ctx.lineTo(q.x,mapBottom);ctx.stroke();}
    for(let lat=Math.ceil(minLat/5)*5;lat<=maxLat;lat+=5){const q=project(lat,minLon);ctx.beginPath();ctx.moveTo(mapLeft,q.y);ctx.lineTo(mapRight,q.y);ctx.stroke();}
    ctx.setLineDash([]);
    if(landGeoJson?.features){
      ctx.fillStyle="#f4f5f7";ctx.strokeStyle="#18212b";ctx.lineWidth=.85*scale;
      for(const f of landGeoJson.features as any[]){const g=f?.geometry;if(!g)continue;const polys=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];for(const poly of polys){ctx.beginPath();for(const ring0 of poly){const ring=unwrapRing(ring0);if(ring.length<3)continue;ring.forEach((c,i)=>{const q=project(c[1],c[0]);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();}try{ctx.fill("evenodd")}catch{ctx.fill()}for(const ring0 of poly){const ring=unwrapRing(ring0);if(ring.length<3)continue;strokeProductCoastlineRing(ctx, ring, (lat,lon)=>project(lat,lon));}}}
    }

    const intensityColor=(v:number)=>v>=51?"#81137d":v>=46?"#ef25df":v>=41?"#f51b1b":v>=33?"#f6a010":v>=24.5?"#1738f5":"#119b20";
    const drawTrack=(track:any[],color:string,width:number,alpha=1,segmentsByIntensity=false)=>{
      if(track.length<2)return;const displayTrack=smoothGuidanceTrackForDisplay(track,0);ctx.globalAlpha=alpha;ctx.lineCap="butt";ctx.lineJoin="miter";ctx.miterLimit=6;
      if(segmentsByIntensity){for(let i=1;i<displayTrack.length;i++){const a=project(displayTrack[i-1].lat,displayTrack[i-1].lon),b=project(displayTrack[i].lat,displayTrack[i].lon);ctx.strokeStyle=intensityColor(((displayTrack[i-1].vmax||0)+(displayTrack[i].vmax||0))*.5);ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}}
      else{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();displayTrack.forEach((p:any,i:number)=>{const q=project(p.lat,p.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();}
      ctx.globalAlpha=1;
    };
    // Exact WMC operational/manual-constrained forecast for visual verification against the live map.
    const baseline=[{lat:Number(activeState.lat),lon:Number(activeState.lon),vmax:Number(activeState.vmax),pmin:Number(activeState.pmin),simHour:0},...referencePath];
    const baselineDisplay=smoothGuidanceTrackForDisplay(baseline,0);
    if (ensembleMode !== "members" || ensembleBlackLines) {
      ctx.strokeStyle="#0f172a";ctx.lineWidth=Math.max(1.3,2.2*scale);ctx.setLineDash([7*scale,5*scale]);ctx.beginPath();baselineDisplay.forEach((p:any,i)=>{const q=project(Number(p.lat),Number(p.lon));i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();ctx.setLineDash([]);
    }

    if(ensembleMode==="members"){
      allTracks.filter(m=>!m.control).forEach(member=>drawTrack(member.track,"",Math.max(.62,.95*scale),.70,true));
      (ensembleBlackLines ? allTracks.filter(m=>m.control) : []).forEach(member=>drawTrack(member.track,"#050505",Math.max(1.6,2.3*scale),.95,false));
      const labelTrack=visibleCenters[0]?.track||[];labelTrack.forEach((p:any)=>{if(p.leadHour>0&&p.leadHour%24===0){const q=project(p.lat,p.lon);ctx.fillStyle="#111827";ctx.font=`700 ${Math.max(7,9*scale)}px Arial`;ctx.fillText(String(Math.round(p.leadHour)),q.x+3*scale,q.y-4*scale);}});
    } else {
      visibleCenters.forEach(center=>{
        drawTrack(center.track,"#ffffff",4.5*scale,.88);drawTrack(center.track,center.color,2.6*scale,1);
        center.track.forEach((p:any,i:number)=>{if(i%2!==0&&i!==center.track.length-1)return;const q=project(p.lat,p.lon);ctx.fillStyle=intensityColor(p.vmax);ctx.strokeStyle="#101820";ctx.lineWidth=.8*scale;ctx.beginPath();ctx.arc(q.x,q.y,3.1*scale,0,Math.PI*2);ctx.fill();ctx.stroke();});
      });
      // Lead labels are written only on the first family to keep the densely clustered early track readable.
      (visibleCenters[0]?.track||[]).forEach((p:any)=>{if(p.leadHour>=24&&p.leadHour%24===0){const q=project(p.lat,p.lon);ctx.fillStyle="#15223a";ctx.font=`700 ${Math.max(7,9*scale)}px Arial`;ctx.fillText(`${Math.round(p.leadHour)}`,q.x+4*scale,q.y-5*scale);}});
    }
    const origin=project(Number(activeState.lat),Number(activeState.lon));ctx.fillStyle="#050505";ctx.beginPath();ctx.arc(origin.x,origin.y,4.5*scale,0,Math.PI*2);ctx.fill();ctx.restore();

    if(!isMini){
      ctx.fillStyle="#344054";ctx.font=`${12*scale}px Arial`;ctx.textAlign="center";for(let lon=Math.ceil(minLon/10)*10;lon<=maxLon;lon+=10){const q=project(minLat,lon);ctx.fillText(`${Math.abs(lon)}°${lon>=0?"E":"W"}`,q.x,mapBottom+17*scale);}ctx.textAlign="right";for(let lat=Math.ceil(minLat/5)*5;lat<=maxLat;lat+=5){const q=project(lat,minLon);ctx.fillText(`${Math.abs(lat)}°${lat>=0?"N":"S"}`,mapLeft-6*scale,q.y+4*scale);}
      const sx=mapRight+28*scale;ctx.textAlign="left";ctx.fillStyle="#15191f";ctx.font=`700 ${14*scale}px Arial,"Microsoft YaHei",sans-serif`;ctx.fillText(ensembleMode==="members"?"成员最大风速排名":"模式图例",sx,92*scale);
      if(ensembleMode==="centers"){
        AETHER_MODEL_SPECS.forEach((spec,i)=>{const y=(121+i*28)*scale;const g=visibleCenters.find(c=>c.modelId===spec.id);ctx.strokeStyle=spec.color;ctx.lineWidth=4*scale;ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+42*scale,y);ctx.stroke();ctx.fillStyle="#111827";ctx.font=`700 ${11.5*scale}px Arial`;ctx.fillText(spec.label,sx+54*scale,y-2*scale);if(g){const a=(config?.intensityAgency||config?.agencyStyle||"CMA") as "CMA"|"JMA"|"JTWC";const wi=getAgencyIntensity(g.maxVmax,a,config?.intensityReportingMode||"public");const speeds=g.track.map(p=>Number(p.speed)).filter(v=>Number.isFinite(v));const meanSpeed=speeds.length?Math.round(speeds.reduce((x,y)=>x+y,0)/speeds.length):0;const maxSpeed=speeds.length?Math.round(Math.max(...speeds)):0;ctx.fillStyle="#667085";ctx.font=`${8.2*scale}px ui-monospace,monospace`;ctx.fillText(`${wi.value}${wi.unit} / ${Math.round(g.minPmin)}hPa · ${meanSpeed}/${maxSpeed}kmh`,sx+54*scale,y+9*scale);}});
        ctx.fillStyle="#475467";ctx.font=`700 ${10*scale}px Arial`;ctx.fillText("强度标记 / MAX WIND",sx,364*scale);
        const cats=[["≥16级",52,"#81137d"],["≥14级",47,"#ef25df"],["≥12级",42,"#f51b1b"],["≥10级",34,"#f6a010"],["≥8级",25,"#1738f5"],["≤7级",18,"#119b20"]] as const;
        cats.forEach((c,i)=>{const y=(389+i*25)*scale;ctx.fillStyle=c[2];ctx.beginPath();ctx.arc(sx+6*scale,y-3*scale,5*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#111827";ctx.stroke();ctx.fillStyle="#111827";ctx.font=`${10.5*scale}px Arial`;ctx.fillText(c[0],sx+20*scale,y);});
        ctx.setLineDash([6*scale,4*scale]);ctx.strokeStyle="#111827";ctx.lineWidth=2*scale;ctx.beginPath();ctx.moveTo(sx,566*scale);ctx.lineTo(sx+42*scale,566*scale);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#111827";ctx.fillText("WMC 基准预报",sx+54*scale,570*scale);
      } else {
        const rankStartY=118*scale, rankStep=18.5*scale, rankBottom=H-32*scale;
        const rankSlots=Math.max(1, Math.floor((rankBottom-rankStartY)/Math.max(1,rankStep)));
        const ranked=[...allTracks].sort((a,b)=>b.maxVmax-a.maxVmax).slice(0,Math.min(rankSlots,allTracks.length));ranked.forEach((m,i)=>{const y=(118+i*18.5)*scale;const a=(config?.intensityAgency||config?.agencyStyle||"CMA") as "CMA"|"JMA"|"JTWC";const wi=getAgencyIntensity(m.maxVmax,a,config?.intensityReportingMode||"public");const speeds=m.track.map(p=>Number(p.speed)).filter(v=>Number.isFinite(v));const meanSpeed=speeds.length?Math.round(speeds.reduce((x,y)=>x+y,0)/speeds.length):0;ctx.fillStyle=intensityColor(m.maxVmax);ctx.font=`${9.2*scale}px ui-monospace,monospace`;ctx.fillText(`${String(i+1).padStart(2,"0")}. ${m.id} · ${wi.value}${wi.unit} ${Math.round(m.minPmin)}hPa · ${meanSpeed}km/h`,sx,y);});
      }
    }
    ctx.fillStyle="#667085";ctx.textAlign="left";ctx.font=`${Math.max(7,9.5*scale)}px Arial`;ctx.fillText(`${loadAgencyBranding('ensemble_tracks').agencyCode} simulated guidance · model names are simulation families, not downloaded NWP data`,10*scale,H-9*scale,Math.max(1,W-20*scale));
    if (typeof setGenerationProgress === "function") setGenerationProgress(100);
  };

  // 产品绘制分发器。
  const drawMapOnCanvas = async (
    canvas: HTMLCanvasElement | null,
    isMini: boolean = false,
    requestedStyle: ProductStyle = imageStyle,
    synopticIssueOverride?: number,
    signal?: AbortSignal,
    nmcMaxWidth?: number
  ) => {
    if (!canvas) return;
    // 调用方在生成开始时冻结产品类型；异步计算期间不得读取之后切换的标签页。
    if (requestedStyle === "synoptic_wind_pressure") {
      const issueHourForRender = Number.isFinite(synopticIssueOverride as number)
        ? Number(synopticIssueOverride)
        : synopticIssueHour;
      await drawSynopticWindPressureMap({
        canvas,
        typhoons: typhoons?.length ? typhoons : [typhoon],
        primaryTyphoon: typhoon,
        initHour: issueHourForRender,
        validHour: issueHourForRender + clamp(Math.round(synopticLeadHours / 3) * 3, 0, synopticMaxLead),
        startDate,
        config,
        modelLabel: synopticModelLabel===SYNOPTIC_TITLE_MODEL_LABEL ? `${loadAgencyBranding('synoptic_wind_pressure').agencyCode} SIM` : synopticModelLabel,
        stylePreset: synopticStylePreset,
        roundedClearEye: synopticRoundedClearEye,
        aspectRatio: synopticAspectRatio,
        domainMode: synopticDomainMode,
        customBounds: synopticCustomBounds,
        contourIntervalHpa: synopticContourInterval,
        showContours: synopticShowContours,
        gridResolutionDeg: isMini ? 0.5 : synopticGridResolution,
        mapZoom: synopticMapZoom,
        outputWidth: isMini ? 768 : selectedRes.width,
        showTrackOverlay: synopticShowTrack,
        onProgress: (value) => setGenerationProgress(value),
        signal: generationAbortRef.current?.signal
      });
    } else if (requestedStyle === "rain_observed") {
      await drawObservedRainfallMap({
        canvas,
        typhoon,
        // Forecast issue products remain tied to the operational integer timeline hour. The
        // observed-rainfall product instead uses the exact live physical time so the latest partial
        // hour is not lost when the centre has already moved beyond the last hourly archive point.
        currentHour: isHistoricalIssue ? currentHour : (observedRainfallEndHour ?? currentHour),
        startDate,
        config,
        typhoonName,
        typhoonNumber,
        windowHours: 24,
        aspectRatio: rainfallAspectRatio,
        legendStyle: rainfallLegendStyle,
        mapPalette: rainfallMapPalette,
        outputWidth: selectedRes.width,
        onProgress: (value) => setGenerationProgress(value),
        signal: generationAbortRef.current?.signal
      });
    } else if (requestedStyle === "ensemble_tracks") {
      await drawEnsembleMapOnCanvas(canvas, isMini, undefined, signal);
    } else if (requestedStyle === "phase_space") {
      const targetW = isMini ? 640 : selectedRes.width;
      const targetH = isMini ? 420 : selectedRes.height;
      if (canvas.width !== targetW) canvas.width = targetW;
      if (canvas.height !== targetH) canvas.height = targetH;
      drawCyclonePhaseSpaceProduct(canvas, typhoon, currentHour, typhoonName);
    } else if (requestedStyle === "jma_forecast") {
      await drawJmaForecastMapOnCanvas(canvas, isMini);
    } else {
      await drawStandardMapOnCanvas(canvas, isMini, signal, nmcMaxWidth);
    }
  };


  useEffect(() => {
    // Desktop product browsing must stay instant. No canvas product is rendered merely because the
    // user opens the workstation or changes tabs; a lightweight preview is generated only after an
    // explicit request. High-resolution satellite/rainfall products remain export-only.
    if (showWarning || !isOpen || previewRefreshToken === 0 || imageStyle === "rain_observed" || imageStyle === "synoptic_wind_pressure") return;
    if (imageStyle === "ensemble_tracks" && ensembleProductNeedsMembers && ensembleMembers.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = controller;
    const render = () => {
      if (cancelled || controller.signal.aborted || !workstationPreviewRef.current) return;
      void drawMapOnCanvas(workstationPreviewRef.current, true, imageStyle, undefined, controller.signal)
        .then(() => { if (!cancelled && !controller.signal.aborted) setGenerationError(""); })
        .catch((err) => { if (!cancelled && !controller.signal.aborted) setGenerationError(err instanceof Error ? err.message : "预览绘制失败"); });
    };
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: { timeout: number }) => number);
    const idleId = ric ? ric(render, { timeout: 420 }) : window.setTimeout(render, 220);
    return () => { cancelled = true; controller.abort(); if (previewAbortRef.current === controller) previewAbortRef.current = null; if ((window as any).cancelIdleCallback && ric) (window as any).cancelIdleCallback(idleId); else window.clearTimeout(idleId); };
  }, [showWarning, isOpen, imageStyle, forecastHours, nmcCoarseIntensity, nmcCustomPeakEnabled, nmcCustomPeak, nmcBorders, nmcChinaTint, nmcProvinces, nmcRivers, ensembleMode, ensembleReferenceStyle, ensembleMembers, geoJsonLoaded, rainfallAspectRatio, rainfallLegendStyle, rainfallMapPalette, jmaShowPredictedRings, jmaShowCurrentWindArea, previewRefreshToken]);

  // Ranking diagnostics can touch every historical station. Do not repeat the sort/filter
  // during export progress, product-tab hover or unrelated React updates.
  const rankingsView = useMemo(() => {
    if (!isOpen || !showRankings) return { sorted: [] as any[], filtered: [] as any[] };
    const raw = getStationRankings(typhoon.history || [], currentHour, rankingWindow);
    const sorted = [...raw].sort((a, b) => b[rankingElement] - a[rankingElement]);
    const search = searchQuery.trim().toLocaleLowerCase();
    return { sorted, filtered: search ? sorted.filter(item => item.name.toLocaleLowerCase().includes(search)) : sorted };
  }, [isOpen, showRankings, typhoon.history, currentHour, rankingWindow, rankingElement, searchQuery, config]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    const canvas = canvasRef.current;
    // A low-resolution preview must not keep decoding/drawing while full-size
    // NMC export starts. Independent canvases still compete for the same GPU.
    previewAbortRef.current?.abort();
    setPreviewRefreshToken(0); // suspend costly preview until explicitly requested again
    const requestedStyle = imageStyle;
    if (!canvas) return;
    if (requestedStyle === "synoptic_wind_pressure") {
      onBeforeHeavyGeneration?.();
      // Give React/browser one paint after the safety flush before entering the cooperative solver.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const controller = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = controller;
    setIsGenerating(true);
    setGenerationKind("image");
    setGenerationStatus("");
    setGenerationError("");
    setNmcRenderedSize("");
    setGenerationProgress(0);
    try {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)));
      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      await ensureProductGeoJson();
      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      let membersOverride: AetherGuidanceMember[] | undefined;
      if (requestedStyle === "ensemble_tracks" && ensembleProductNeedsMembers && ensembleMembers.length === 0) {
        const activeState = isHistoricalIssue
          ? (findForecastSeedAtOrBefore(typhoon.history, currentHour) || typhoon)
          : typhoon;
        const primaryStorm: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeState);
        const scene = (typhoons?.length ? typhoons : [typhoon]).map((candidate) => {
          if (!isHistoricalIssue) return candidate;
          const state = [...(candidate.history || [])].reverse().find((h) => h.simHour <= currentHour + 1e-6);
          return state ? mergeTyphoonStateWithCurrentIdentity(candidate, state) : candidate;
        });
        const residualContinuationProduct = ensembleReferenceStyle === "pressure_spaghetti_basin" || ensembleReferenceStyle === "paired_cycle_pressure" || (ensembleReferenceStyle === "strike_probability_120km" && strikeTrackEndMode === "residual");
        const ensembleHorizon = resolveEnsembleHorizon(ensembleReferenceStyle);
        const framingReferencePath = materializeProductForecast(
          primaryStorm, config, ensembleHorizon, primaryStorm.forecastPath
        );
        const referencePath = residualContinuationProduct && (ensembleReferenceStyle === "strike_probability_120km" ? strikeTrackEndMode === "residual" : ensembleSpecialTrackEndMode === "residual")
          ? materializeForecastPath(primaryStorm, config, ensembleHorizon, primaryStorm.forecastPath, true)
          : framingReferencePath;
        const portSeed = config?.seed || activeState.configSnapshot?.seed || "WMC";
        const guidanceIssueHour = Math.floor(currentHour / 3) * 3;
        const selected = selectedEnsembleModels.length ? selectedEnsembleModels : [AETHER_MODEL_SPECS[0].id];
        setGenerationProgress(4);
        membersOverride = await buildAetherEnsembleMembers({
          storm: primaryStorm,
          currentHour: guidanceIssueHour,
          scene,
          seed: portSeed,
          referencePath,
          selectedModelIds: selected,
          membersPerModel: ensembleMembersPerModel,
          horizon: ensembleHorizon,
          config,
          useProductCoastline: true,
          signal: controller.signal,
          onProgress: (done, target) => {
            const pct = Math.round(done / Math.max(1, target) * 100);
            setGenerationProgress(Math.min(70, 6 + Math.round(pct * 0.64)));
          }
        });
        if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
        setEnsembleMembers(membersOverride);
      }
      // PNG encoding is asynchronous. If a mobile GPU refuses the first large
      // canvas or produces an empty plate, retry ONCE at a smaller resolution
      // without reloading the GeoJSON or touching any physical forecast state.
      const renderImage = async (nmcMaxWidth?: number) => {
        if (requestedStyle === "ensemble_tracks" && membersOverride) {
          await drawEnsembleMapOnCanvas(canvas, false, membersOverride, controller.signal);
        } else {
          const issueOverride = requestedStyle === "synoptic_wind_pressure" ? currentHour : undefined;
          if (issueOverride !== undefined) setSynopticIssueHour(issueOverride);
          await drawMapOnCanvas(canvas, false, requestedStyle, issueOverride, controller.signal, nmcMaxWidth);
        }
        if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
        if (requestedStyle === "standard" && !hasNmcRenderedContent(canvas)) {
          throw new Error("NMC 画布未绘制完整，禁止导出空白图片");
        }
        if (requestedStyle === "standard" && (canvas.width < 320 || canvas.height < 250)) {
          throw new Error("NMC 绘制未完成：画布尺寸不正确");
        }
      };
      const encodeImage = async () => {
        setGenerationProgress(96);
        const blob = await new Promise<Blob>((resolve, reject) => {
          let settled = false;
          const onAbort = () => {
            if (settled) return;
            settled = true;
            reject(new DOMException("Generation cancelled", "AbortError"));
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          try {
            canvas.toBlob((value) => {
              if (settled) return;
              settled = true;
              controller.signal.removeEventListener("abort", onAbort);
              if (!value || value.size === 0) reject(new Error("PNG 编码失败或空白"));
              else resolve(value);
            }, "image/png");
          } catch (error) {
            controller.signal.removeEventListener("abort", onAbort);
            reject(error);
          }
        });
        if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
        return blob;
      };
      let blob: Blob;
      try {
        await renderImage();
        blob = await encodeImage();
      } catch (firstError) {
        if (requestedStyle !== "standard" || controller.signal.aborted) throw firstError;
        console.warn("[NMC] 高清绘制或编码失败，尝试安全低清重绘", firstError);
        setGenerationStatus("首次高清绘制失败，正在自动降级重试…");
        setGenerationProgress(4);
        // Reset the failed GPU surface before trying to allocate a new one.
        canvas.width = 1;
        canvas.height = 1;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
        await renderImage(1280);
        blob = await encodeImage();
      }
      if (requestedStyle === "standard") {
        setNmcRenderedSize(`${canvas.width} × ${canvas.height}`);
      }
      const objectUrl = URL.createObjectURL(blob);
      setPreviewDataUrl((prev) => {
        if (prev?.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(prev), 1800);
        return objectUrl;
      });
      setGenerationProgress(100);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Generating image failed:", err);
        setGenerationError(err instanceof Error ? err.message : "产品生成失败，请检查参数后重试");
      }
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
        // The PNG Blob owns its pixels now. Release the hidden GPU bitmap;
        // an older aborted generation must NOT clear a newer generation's canvas.
        if (requestedStyle === "standard" && canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
        setIsGenerating(false);
      }
      if (requestedStyle === "synoptic_wind_pressure") {
        // The live simulator is intentionally allowed to keep running between cooperative slices.
        // Persist the *new* live refs as well, otherwise a mobile tab reclaim immediately after
        // preview completion could restore only the pre-generation checkpoint.
        onAfterHeavyGeneration?.();
      }
    }
  };

  const handleGenerateSynopticVideo = async () => {
    if (imageStyle !== "synoptic_wind_pressure") return;
    onBeforeHeavyGeneration?.();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const controller = new AbortController();
    generationAbortRef.current?.abort();
    generationAbortRef.current = controller;
    setIsGenerating(true);
    setGenerationKind("video");
    setGenerationStatus("准备视频计算域");
    setGenerationProgress(0);
    try {
      // ROUND116: freeze the video issue at click time, but start from the latest live/timeline
      // state rather than the issue hour left over from a previous image/video generation.
      const videoIssueHour = currentHour;
      setSynopticIssueHour(videoIssueHour);
      await ensureProductGeoJson();
      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      const endLead = clamp(Math.round(synopticLeadHours / 3) * 3, 0, synopticMaxLead);
      const blob = await generateSynopticWindPressureVideo({
        typhoons: typhoons?.length ? typhoons : [typhoon],
        primaryTyphoon: typhoon,
        initHour: videoIssueHour,
        endLeadHours: endLead,
        startDate,
        config,
        modelLabel: synopticModelLabel===SYNOPTIC_TITLE_MODEL_LABEL ? `${loadAgencyBranding('synoptic_wind_pressure').agencyCode} SIM` : synopticModelLabel,
        stylePreset: synopticStylePreset,
        roundedClearEye: synopticRoundedClearEye,
        aspectRatio: synopticAspectRatio,
        domainMode: synopticDomainMode,
        customBounds: synopticCustomBounds,
        contourIntervalHpa: synopticContourInterval,
        showContours: synopticShowContours,
        gridResolutionDeg: synopticGridResolution,
        mapZoom: synopticMapZoom,
        showTrackOverlay: synopticShowTrack,
        frameCount: synopticVideoFrames,
        durationSec: synopticVideoDuration,
        resolution: synopticVideoResolution,
        signal: controller.signal,
        onProgress: (value, frame, total, status) => {
          setGenerationProgress(value);
          setGenerationStatus(`${status} · ${frame}/${total}`);
        }
      });
      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `AETHER_synoptic_${String(Math.round(videoIssueHour)).padStart(4, "0")}h_to_+${endLead}h.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
      setGenerationProgress(100);
      setGenerationStatus("视频已生成并开始下载");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) console.error("Generating synoptic video failed:", err);
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setIsGenerating(false);
      onAfterHeavyGeneration?.();
    }
  };

  const handleStopGeneration = () => {
    generationAbortRef.current?.abort();
  };
  
  
  const handleGenerateChart = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Parse aspect ratio
    const [wRatio, hRatio] = chartMakerConfig.aspectRatio.split(":").map(Number);
    const baseWidth = 1200;
    const baseHeight = Math.round((baseWidth / wRatio) * hRatio);
    
    const scale = chartMakerConfig.resolution;
    canvas.width = baseWidth * scale;
    canvas.height = baseHeight * scale;
    
    ctx.scale(scale, scale);
    
    // Operational meteorological report: neutral paper, restrained rule lines,
    // no neon/medal/gradient styling.
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, baseWidth, baseHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(18, 18, baseWidth - 36, baseHeight - 36);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(18, 18, baseWidth - 36, baseHeight - 36);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(18, 18, 8, baseHeight - 36);

    // Grid & Layout
    const padding = 50;
    let drawX = padding;
    let drawY = padding;
    let drawW = baseWidth - padding * 2;
    let drawH = baseHeight - padding * 2;
    
    const getElementUnit = () => rankingElement === "precip" ? "mm" : rankingElement === "surge" ? "m" : "m/s";
    const getElementName = () => {
      if (rankingElement === "gust") return "最大阵风";
      if (rankingElement === "avgWind") return "最大平均风速";
      if (rankingElement === "surge") return "最大风暴潮高度";
      return "累计降水量";
    };
    const formatElementValue = (v: number) => rankingElement === "surge" ? v.toFixed(2) : v.toFixed(1);

    if (chartMakerConfig.showInfo) {
      // Header
      ctx.fillStyle = "#111827";
      ctx.font = `bold ${28}px sans-serif`;
      ctx.fillText(`${typhoonName}台风气象站影响要素排名报告`, drawX, drawY + 28);
      
      ctx.fillStyle = "#475569";
      ctx.font = `500 ${15}px sans-serif`;
      const simTime = new Date(startDate.getTime() + currentHour * 3600000);
      const y = simTime.getFullYear();
      const m = String(simTime.getMonth() + 1).padStart(2, "0");
      const d = String(simTime.getDate()).padStart(2, "0");
      const hh = String(simTime.getHours()).padStart(2, "0");
      const timeStr = `${y}-${m}-${d} ${hh}:00`;
      ctx.fillText(`统计窗口: 过去 ${rankingWindow} 小时  |  模拟时次: ${timeStr}  |  资料属性: 气象站网仿真统计`, drawX, drawY + 58);
      
      // Header Divider
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(drawX, drawY + 72);
      ctx.lineTo(drawX + drawW, drawY + 72);
      ctx.stroke();

      drawY += 90;
      drawH -= 90;
    }
    
    const rawRankings = getStationRankings(typhoon.history || [], currentHour, rankingWindow);
    const sorted = [...rawRankings].sort((a, b) => b[rankingElement] - a[rankingElement]);
    const topData = sorted.slice(0, chartMakerConfig.topN);
    
    const maxVal = Math.max(...topData.map(d => d[rankingElement]), rankingElement === "surge" ? 1 : 10);

    // Draw horizontal grid lines behind chart
    const gridCount = 5;
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    for (let g = 0; g <= gridCount; g++) {
      const gy = drawY + (drawH - 40) * (g / gridCount);
      ctx.beginPath();
      ctx.moveTo(drawX, gy);
      ctx.lineTo(drawX + drawW, gy);
      ctx.stroke();
    }
    
    // Restrained operational-report palette: one primary ink color per element,
    // no decorative gradients or medal colors.
    const barColor = rankingElement === "gust"
      ? "#c62828"
      : rankingElement === "precip"
        ? "#2563eb"
        : rankingElement === "surge"
          ? "#0f766e"
          : "#20242a";

    if (chartMakerConfig.chartType === "column") {
      // Column (Vertical bars)
      const stepW = drawW / topData.length;
      const barW = Math.max(12, stepW * 0.55);
      
      topData.forEach((d, i) => {
        const val = d[rankingElement];
        const barH = (val / maxVal) * (drawH - 60);
        const bx = drawX + i * stepW + (stepW - barW) / 2;
        const by = drawY + drawH - barH - 35;
        
        ctx.fillStyle = barColor;
        ctx.fillRect(bx, by, barW, barH);
        
        // Value Text
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${14}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(`${formatElementValue(val)}`, bx + barW / 2, by - 8);
        
        // Name Text
        ctx.fillStyle = "#334155";
        ctx.font = `500 ${13}px sans-serif`;
        ctx.fillText(d.name, bx + barW / 2, drawY + drawH - 10);
      });
    } else {
      // Bar (Horizontal bars)
      const stepH = (drawH - 30) / topData.length;
      const barH = Math.max(10, stepH * 0.55);
      
      topData.forEach((d, i) => {
        const val = d[rankingElement];
        const labelW = 100;
        const barW = (val / maxVal) * (drawW - labelW - 70);
        const bx = drawX + labelW;
        const by = drawY + i * stepH + (stepH - barH) / 2;
        
        ctx.fillStyle = barColor;
        ctx.fillRect(bx, by, barW, barH);
        
        // Name Text (Left side)
        ctx.fillStyle = "#1e293b";
        ctx.font = `bold ${14}px sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(d.name, bx - 12, by + barH / 2);
        
        // Value Text (Right side)
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${14}px sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(`${formatElementValue(val)} ${getElementUnit()}`, bx + barW + 10, by + barH / 2);
      });
    }

    // Footer Agency Stamp / Note
    ctx.fillStyle = "#94a3b8";
    ctx.font = `12px sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("台风模拟器 · 气象站网仿真分析报告", drawX + drawW, baseHeight - 22);

    // Download
    const link = document.createElement("a");
    link.download = `${typhoonName}台风气象站${getElementName()}排名分析.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleDownloadActual = () => {
    if (!previewDataUrl) return;
    const link = document.createElement("a");
    link.download = imageStyle === "synoptic_wind_pressure"
      ? `${typhoonName}_${synopticLeadHours}h_风场气压形势图.png`
      : imageStyle === "rain_observed"
      ? `${typhoonName}_过去24h_降水实况图.png`
      : imageStyle === "phase_space"
        ? `${typhoonName}_CPS_气旋相空间图.png`
        : imageStyle === "jma_forecast"
          ? `${typhoonName}_${forecastHours}h_JMA预报图.png`
          : imageStyle === "ensemble_tracks"
            ? `${typhoonName}_${ensembleReferenceStyle}_集系预报图.png`
            : `${typhoonName}_${forecastHours}h_${imageStyle}_预报图.png`;
    link.href = previewDataUrl;
    link.click();
    clearPreview(true);
  };

  // Render Station Rankings full-screen page
  const renderRankingsPopup = () => {
    if (!showRankings) return null;

    const sortedRankings = rankingsView.sorted;
    const filteredRankings = rankingsView.filtered;

    const getElementUnit = () => rankingElement === "precip" ? "mm" : rankingElement === "surge" ? "m" : "m/s";
    const getElementName = () => {
      if (rankingElement === "gust") return "最大阵风";
      if (rankingElement === "avgWind") return "最大平均风速";
      if (rankingElement === "surge") return "最大风暴潮高度";
      return "累计降水量";
    };
    const formatElementValue = (v: number) => rankingElement === "surge" ? v.toFixed(2) : v.toFixed(1);
    const metricAccent = rankingElement === "gust"
      ? "text-red-300 border-red-500/30 bg-red-500/10"
      : rankingElement === "precip"
        ? "text-blue-300 border-blue-500/30 bg-blue-500/10"
        : rankingElement === "surge"
          ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/10"
          : "text-slate-200 border-slate-600 bg-slate-800/70";
    const leader = filteredRankings[0];

    const handleCopyRankings = () => {
      const header = `气象站实测排行报告 (前30名)\n--------------------------------------\n台风名称: ${typhoonName}\n时间窗口: ${rankingWindow}小时\n气象要素: ${getElementName()}\n\n排名 | 站点名称 | 数值 (${getElementUnit()})\n--------------------------------------\n`;
      const rows = sortedRankings
        .slice(0, 30)
        .map((item, i) => `${String(i + 1).padStart(2, " ")}   | ${item.name.padEnd(8, "　")} | ${formatElementValue(item[rankingElement])} ${getElementUnit()}`)
        .join("\n");
      navigator.clipboard.writeText(header + rows).then(() => {
        setCopiedRanking(true);
        setTimeout(() => setCopiedRanking(false), 2000);
      });
    };

    return (
      <div className="station-ranking-page fixed inset-0 z-[7500] bg-[#07111F] flex flex-col text-slate-100 animate-fade-in overflow-hidden font-sans">
        <div className="shrink-0 border-b border-slate-800 bg-[#0b1420]/98 backdrop-blur-md">
          <div className="max-w-5xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-300 shrink-0">
                <Table className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-wide text-white truncate">气象站排行</h2>
                <div className="text-[10px] text-slate-500 truncate">{typhoonName} · {rankingWindow}h · {filteredRankings.length} stations</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setShowChartMaker(true)} title="制作排行报告图" className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition cursor-pointer"><BarChart3 className="w-4 h-4" /></button>
              <button onClick={handleCopyRankings} title="复制排行数据" className={`w-8 h-8 rounded-lg border flex items-center justify-center transition cursor-pointer ${copiedRanking ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300"}`}>{copiedRanking ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
              <button onClick={() => setShowRankings(false)} title="关闭" className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
          </div>
        </div>

        {showChartMaker && (
          <div className="fixed inset-0 z-[7600] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-[#0b1420] text-slate-100 w-full max-w-md rounded-xl border border-slate-700 shadow-2xl overflow-hidden animate-scale-up">
              <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800">
                <div>
                  <h2 className="font-semibold text-sm">制作排行报告图</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">只调整输出样式，不改变统计数据</p>
                </div>
                <button onClick={() => setShowChartMaker(false)} className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center cursor-pointer"><X className="w-4 h-4"/></button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold tracking-wide block mb-2">图表方向</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setChartMakerConfig(p => ({...p, chartType: "bar"}))} className={`py-2.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${chartMakerConfig.chartType === "bar" ? "bg-sky-500/15 border-sky-400/40 text-sky-200" : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"}`}>横向条形图</button>
                    <button onClick={() => setChartMakerConfig(p => ({...p, chartType: "column"}))} className={`py-2.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${chartMakerConfig.chartType === "column" ? "bg-sky-500/15 border-sky-400/40 text-sky-200" : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"}`}>纵向柱状图</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] text-slate-500 font-semibold block mb-2">画面比例</label><select value={chartMakerConfig.aspectRatio} onChange={(e) => setChartMakerConfig(p => ({...p, aspectRatio: e.target.value}))} className="w-full rounded-lg bg-slate-900 border border-slate-700 text-slate-200 px-3 py-2.5 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"><option value="16:9">16:9 宽屏</option><option value="4:3">4:3 标准</option><option value="1:1">1:1 方形</option><option value="9:16">9:16 竖屏</option></select></div>
                  <div><label className="text-[10px] text-slate-500 font-semibold block mb-2">清晰度</label><select value={chartMakerConfig.resolution} onChange={(e) => setChartMakerConfig(p => ({...p, resolution: Number(e.target.value)}))} className="w-full rounded-lg bg-slate-900 border border-slate-700 text-slate-200 px-3 py-2.5 text-xs focus:outline-none focus:border-sky-500 cursor-pointer"><option value="1">1X 标准</option><option value="2">2X 高清</option><option value="3">3X 超清</option><option value="4">4X 4K级</option></select></div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2"><label className="text-[10px] text-slate-500 font-semibold">展示站数</label><span className="text-xs font-mono font-semibold text-slate-300">TOP {chartMakerConfig.topN}</span></div>
                  <input type="range" min="5" max="30" step="5" value={chartMakerConfig.topN} onChange={(e) => setChartMakerConfig(p => ({...p, topN: Number(e.target.value)}))} className="w-full accent-sky-500" />
                </div>
                <button onClick={handleGenerateChart} className="w-full py-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition cursor-pointer"><Download className="w-4 h-4" />生成高清报告图</button>
              </div>
            </div>
          </div>
        )}

        <div className="shrink-0 max-w-5xl w-full mx-auto px-4 sm:px-5 pt-3">
          <div className="rounded-xl border border-slate-800 bg-[#0b1420] overflow-hidden">
            <div className="p-3 grid gap-3 lg:grid-cols-[1fr_1.15fr_0.95fr] lg:items-end">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-wider text-slate-500 mb-1.5">时间窗口</div>
                <div className="flex gap-1 overflow-x-auto scrollbar-none">
                  {([1, 3, 6, 12, 24, 48, 72] as const).map((w) => <button key={w} onClick={() => setRankingWindow(w)} className={`min-w-[42px] rounded-md px-2 py-2 text-xs font-semibold border transition cursor-pointer ${rankingWindow === w ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"}`}>{w}h</button>)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-wider text-slate-500 mb-1.5">排行要素</div>
                <div className="grid grid-cols-4 gap-1">
                  {(["gust", "avgWind", "precip", "surge"] as const).map((elem) => <button key={elem} onClick={() => setRankingElement(elem)} className={`rounded-md px-2 py-2 text-[11px] sm:text-xs font-semibold border transition cursor-pointer ${rankingElement === elem ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"}`}>{elem === "gust" ? "阵风" : elem === "avgWind" ? "平均风" : elem === "precip" ? "降水" : "风暴潮"}</button>)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-wider text-slate-500 mb-1.5">站点筛选</div>
                <input type="text" placeholder="输入站点名称" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-9 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs px-3 focus:outline-none focus:border-sky-500 placeholder-slate-600 transition" />
              </div>
            </div>
            <div className="px-3 py-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900/35">
              <div className="flex items-center gap-2 min-w-0"><span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-semibold ${metricAccent}`}>{getElementName()}</span><span className="text-[11px] text-slate-500">按当前 {rankingWindow}h 窗口实时重算</span></div>
              {leader && <div className="text-[11px] text-slate-400 min-w-0 truncate"><span className="mr-1.5">首位</span><span className="font-semibold text-slate-200">{leader.name}</span><span className="font-mono font-semibold ml-2 text-white">{formatElementValue(leader[rankingElement])} {getElementUnit()}</span></div>}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 max-w-5xl w-full mx-auto px-4 sm:px-5 py-3">
          <div className="h-full rounded-xl border border-slate-800 bg-[#0b1420] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
              <div className="sm:hidden divide-y divide-slate-800/80">
                {filteredRankings.map((item, idx) => (
                  <div key={item.name} className={`px-4 py-3 flex items-center gap-3 ${idx === 0 ? "bg-sky-500/[0.06]" : ""}`}>
                    <span className={`inline-flex items-center justify-center w-9 h-8 rounded-md border text-[11px] font-mono font-semibold shrink-0 ${idx === 0 ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-500"}`}>{String(idx + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm text-slate-200 truncate">{item.name}</div>
                      {rankingElement !== "surge" && <div className="text-[10px] text-slate-500 mt-0.5">风暴潮 <span className="font-mono text-cyan-300">{Number(item.surge || 0).toFixed(2)} m</span></div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-base font-bold text-white">{formatElementValue(item[rankingElement])}</div>
                      <div className="text-[10px] text-slate-500">{getElementUnit()}</div>
                    </div>
                  </div>
                ))}
                {filteredRankings.length === 0 && <div className="py-16 text-center text-slate-500 text-sm">暂无符合条件的站点数据</div>}
              </div>
              <table className="hidden sm:table w-full text-left border-collapse table-fixed">
                <thead className="bg-slate-900 sticky top-0 z-10 border-b border-slate-800">
                  <tr><th className="py-3 px-4 text-[10px] font-semibold tracking-wider text-slate-500 w-20">排名</th><th className="py-3 px-4 text-[10px] font-semibold tracking-wider text-slate-500">气象站</th><th className="py-3 px-4 text-[10px] font-semibold tracking-wider text-slate-500 text-right">{getElementName()} / {getElementUnit()}</th>{rankingElement !== "surge" && <th className="py-3 px-4 text-[10px] font-semibold tracking-wider text-slate-500 text-right">最大风暴潮 / m</th>}</tr>
                </thead>
                <tbody>
                  {filteredRankings.map((item, idx) => (
                    <tr key={item.name} className={`border-b border-slate-800/80 last:border-b-0 transition-colors ${idx === 0 ? "bg-sky-500/[0.06]" : "hover:bg-slate-900/55"}`}>
                      <td className="py-3 px-4"><span className={`inline-flex items-center justify-center w-8 h-7 rounded-md border text-[11px] font-mono font-semibold ${idx === 0 ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-slate-700 bg-slate-900 text-slate-500"}`}>{String(idx + 1).padStart(2, "0")}</span></td>
                      <td className="py-3 px-4"><div className="font-medium text-sm text-slate-200 truncate">{item.name}</div></td>
                      <td className="py-3 px-4 text-right"><span className="font-mono text-sm font-semibold text-white">{formatElementValue(item[rankingElement])}</span><span className="ml-1.5 text-[10px] text-slate-500">{getElementUnit()}</span></td>
                      {rankingElement !== "surge" && <td className="py-3 px-4 text-right"><span className="font-mono text-sm font-semibold text-cyan-300">{Number(item.surge || 0).toFixed(2)}</span><span className="ml-1.5 text-[10px] text-slate-500">m</span></td>}
                    </tr>
                  ))}
                  {filteredRankings.length === 0 && <tr><td colSpan={rankingElement === "surge" ? 3 : 4} className="py-16 text-center text-slate-500 text-sm">暂无符合条件的站点数据</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const cloudCompositorTargetState = (() => {
    const history = typhoon.history || [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (Number(h.simHour) <= currentHour) return h;
    }
    return typhoon;
  })();
  const cloudCompositorDate = (() => {
    const d = new Date(startDate.getTime() + currentHour * 3600000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  return (
    <div
      id="forecast-modal-overlay"
      className={`${mobileMode ? "aether-mobile-product-overlay" : "forecast-product-overlay fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 text-white overflow-hidden"}`}
    >
      {showWarning ? (
        // 1. Disclaimer Warning Dialog
        <div
          id="disclaimer-dialog"
          className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl flex flex-col gap-5 text-center animate-in zoom-in-95 duration-200"
        >
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-orange-500">
            <AlertTriangle className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold text-slate-100">气象图生成服务条款</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              “生成的预报图/模拟实况图仅供娱乐与模拟分析使用”
            </p>
            <p className="text-xs text-red-400/90 leading-relaxed bg-red-950/20 border border-red-900/30 rounded-lg p-2.5 mt-2">
              本工具生成的预报图与“实况降水图”均属于虚拟模拟产物，不代表中央气象台或任何官方机构观测/预报，请勿冒充真实气象资料传播。
            </p>
          </div>

          <div className="flex gap-3 mt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer text-sm"
            >
              取消
            </button>
            <button
              onClick={() => setShowWarning(false)}
              className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition cursor-pointer text-sm"
            >
              我已知晓并同意
            </button>
          </div>
        </div>
      ) : (
        // 2. Full Parameter Settings and Preview Page
        <div
          id="forecast-editor-main"
          className={`${mobileMode ? "aether-mobile-product-workstation" : "icwc-product-workstation aether-product-workstation w-full bg-[#202023] border border-[#434348] shadow-2xl flex overflow-hidden animate-in fade-in zoom-in-98 duration-300 relative"}`}
        >
          {/* Offscreen Canvas for high-res map rendering */}
          <canvas ref={canvasRef} width={1} height={1} className="hidden" />

          {mobileMode && <header className="aether-mobile-product-header">
            <div><b>WMC 产品中心</b><span>METEOROLOGICAL PRODUCTS</span></div>
            <div className="aether-mobile-product-header-actions">
              <button type="button" onClick={() => { setShowRankings(true); setCopiedRanking(false); }} aria-label="气象站排名"><Table /></button>
              <button type="button" onClick={onClose} aria-label="关闭产品中心"><X /></button>
            </div>
          </header>}

          <aside className={mobileMode ? "aether-mobile-product-nav" : "icwc-product-sidebar aether-product-sidebar"}>
            <div className="icwc-product-sidebar-title"><div>WMC 产品中心</div><span>METEOROLOGICAL PRODUCTS</span></div>
            <div className="aether-product-section">路径 / 风险</div>
            <button type="button" className="icwc-product-tab" onClick={() => onOpenTyphoonNetwork?.()} aria-label="进入台风网模拟">台风网模拟 · 三小时动态路径</button>
            <button type="button" onClick={() => { setImageStyle("standard"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "standard" ? "active" : ""}`}>NMC 路径概率预报图</button>
            <button type="button" onClick={() => { setImageStyle("jma_forecast"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "jma_forecast" ? "active" : ""}`}>JMA 预报图</button>
            <button type="button" onClick={() => { setImageStyle("ensemble_tracks"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "ensemble_tracks" ? "active" : ""}`}>多模式 / 集合路径 · 5版式</button>
            <div className="aether-product-section">结构 / 遥感</div>
            <button type="button" onClick={() => setShowCloudCompositor(true)} className="icwc-product-tab"><span className="inline-flex items-center gap-1"><ImagePlus className="w-3.5 h-3.5"/>卫星实景拼接</span></button>
            <button type="button" onClick={() => { setImageStyle("phase_space"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "phase_space" ? "active" : ""}`}>气旋相空间</button>
            <div className="aether-product-section">形势分析</div>
            <button type="button" onClick={() => { setSynopticIssueHour(currentHour); setImageStyle("synoptic_wind_pressure"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "synoptic_wind_pressure" ? "active" : ""}`}>风场气压形势图</button>
            <div className="aether-product-section">观测 / 诊断</div>
            <button type="button" onClick={() => { setImageStyle("rain_observed"); setPreviewRefreshToken(0); }} className={`icwc-product-tab ${imageStyle === "rain_observed" ? "active" : ""}`}>实况降水图</button>
                        <button type="button" onClick={() => setShowRankings(true)} className="icwc-product-tab">气象站排名</button>
            <button type="button" onClick={() => setShowAircraftRecon(true)} className="icwc-product-tab">台风探空报告</button>
          </aside>

          <section className="aether-product-live-preview hidden lg:flex flex-1 min-w-0 bg-[#242427] border-r border-[#434348] p-4 flex-col">
            <div className="flex items-center justify-between gap-3 border border-[#434348] border-b-0 bg-[#2b2b2e] px-3 py-2 text-[#e5e5e7]">
              <div><b className="text-[11px] tracking-[0.08em]">WMC PRODUCT PREVIEW</b><div className="text-[9px] text-[#87919e] mt-0.5">按需预览 · 最终导出按右侧分辨率生成</div></div>
              <span className="rounded border border-[#c9d1d9] bg-[#f7f8fa] px-2 py-1 text-[9px] font-mono text-[#536273]">T+{Math.round(currentHour)}H</span>
            </div>
            <div className="flex-1 min-h-0 border border-[#434348] bg-[#1c1c1f] grid place-items-center overflow-hidden p-2">
              {imageStyle === "rain_observed" ? (
                <div className="text-center text-[#667085]"><CloudRain className="w-8 h-8 mx-auto mb-2 text-sky-500"/><div className="text-xs font-bold">实况降水图按需生成</div><div className="text-[10px] mt-1">该产品计算量较大，不执行实时预览。</div></div>
              ) : imageStyle === "synoptic_wind_pressure" ? (
                <div className="text-center text-[#667085] px-6"><div className="text-xs font-bold">风场气压形势图按需生成</div><div className="text-[10px] mt-1 leading-relaxed">该产品会重建背景气压、台风涡旋、地表粗糙度并迭代边界层流场，只在点击“生成风场气压形势图”后计算。</div></div>
              ) : imageStyle === "ensemble_tracks" && ensembleProductNeedsMembers && ensembleMembers.length === 0 ? (
                <div className="text-center text-[#667085]"><div className="text-xs font-bold">该版式需要集合成员；点击“制作图片”会自动计算成员</div><div className="text-[10px] mt-1">成员路径基于各机构中心路径继续产生时空与强度离散。</div></div>
              ) : previewRefreshToken === 0 ? (
                <div className="text-center text-[#667085] px-6"><div className="text-xs font-bold">按需低清预览</div><div className="text-[10px] mt-1 leading-relaxed">为了保持桌面端产品选择流畅，切换产品不会自动运行任何地图/等值线/概率计算。点击右侧“生成低清预览”后才进行一次预览渲染。</div></div>
              ) : (
                <canvas ref={workstationPreviewRef} width={640} height={480} className="max-w-full max-h-full object-contain bg-white shadow-sm" />
              )}
            </div>
            <div className="border border-[#434348] border-t-0 bg-[#2b2b2e] px-3 py-2 text-[9px] text-[#b6b6bd]">
              产品导航只切换配置，不触发后台制图；所有低清预览均手动请求，高精度卫星与降水只在正式生成时计算。
            </div>
          </section>

          {/* Controls Settings */}
          <div className={mobileMode ? "aether-mobile-product-settings" : "icwc-product-settings aether-product-settings w-[350px] flex-1 lg:flex-none bg-[#29292c] p-5 flex flex-col justify-between overflow-y-auto"}>
            <div className="space-y-6">
              {mobileMode && <div className="aether-mobile-product-title">
                <div><span>参数调整</span><b>{imageStyle === "standard" ? "NMC 路径概率预报图" : imageStyle === "jma_forecast" ? "JMA 预报图" : imageStyle === "ensemble_tracks" ? "多模式 / 集合路径" : imageStyle === "phase_space" ? "气旋相空间" : imageStyle === "synoptic_wind_pressure" ? "风场气压形势图" : "实况降水图"}</b></div>
                <span>T+{Math.round(currentHour)}H</span>
              </div>}
              <div className={mobileMode ? "hidden" : "flex items-center justify-between mb-4"}>
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" />
                  <h3 className="text-lg font-bold text-slate-100">参数调整</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRankings(true);
                      setCopiedRanking(false);
                    }}
                    className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:text-white transition cursor-pointer flex items-center justify-center"
                    title="气象站实测排行"
                  >
                    <Table className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onClose}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Mini Preview Box */}
              <div className="mb-6 space-y-2">
                {/* Preview box removed as requested */}
              </div>

              {/* Typhoon Basic Fields */}
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-700/70 bg-slate-950/45 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-slate-200">当前产品</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">产品切换统一使用左侧列表。集合成员和大尺度场均按需计算，打开页面不会在后台反复重绘。</div>
                    </div>
                    <button type="button" onClick={async () => { await ensureProductGeoJson(); setPreviewRefreshToken(v => v + 1); }} className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[10px] font-bold text-cyan-300 hover:border-cyan-500/60">刷新低清预览</button>
                  </div>
                </div>


                {imageStyle !== "standard" && <details className="rounded-xl border border-cyan-800/60 bg-slate-900/60 p-3 space-y-2">
                  <summary className="cursor-pointer text-xs font-bold text-slate-200">当前产品机构名称</summary>
                  <div className="mt-2 text-[10px] text-slate-400">只影响当前产品；中文文字由系统输入法输入，水印与页脚允许留空。</div>
                  {([['agencyName','机构名称',16],['agencyCode','机构代号',12],['footerNote','页脚/来源文字',60],['makerSuffix','制作时间后缀',10]] as const).map(([key,label,max])=><label key={key} className="block mt-2 text-xs text-slate-200">{label}
                    <input type="text" maxLength={max} value={productAgency[key]} onChange={e=>setProductAgency(p=>({...p,[key]:e.target.value}))} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded p-2"/></label>)}
                  <div className="grid grid-cols-2 gap-2 mt-3"><button type="button" onClick={()=>{
                    saveAgencyBranding(brandingProductId,productAgency);
                    setPreviewRefreshToken(v=>v+1);
                  }} className="rounded border border-cyan-700 p-2 text-xs">应用到当前产品</button>
                    <button type="button" onClick={()=>{
                      clearAgencyBranding(brandingProductId);const restored=loadAgencyBranding(brandingProductId);
                      setProductAgency(restored);
                      setPreviewRefreshToken(v=>v+1);
                    }} className="rounded border border-slate-600 p-2 text-xs">恢复产品默认</button></div>
                </details>}

                <details className="rounded-xl border border-slate-600 bg-slate-900/60 p-3 space-y-2">
                  <summary className="cursor-pointer text-xs font-bold text-slate-200">全局机构标识（NMC 已恢复 Round184 固定版式）</summary>
                  <p className="mt-2 text-[10px] text-slate-400">中文及文字使用系统输入法。应用后清除其他产品的旧覆盖；NMC 预报图保持 Round184 的原有机构文字。模拟产品不能冒充官方机构。</p>
                  {([['agencyName','机构名称',16],['agencyCode','机构代号',12],['footerNote','页脚/来源文字（留空可隐藏）',60],['makerSuffix','制作时间后缀',10]] as const).map(([key,label,max])=><label key={key} className="block mt-2 text-xs text-slate-200">{label}
                    <input type="text" maxLength={max} value={globalAgency[key]} onChange={e=>changeGlobalAgency(key,e.target.value)} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded p-2"/></label>)}
                  <div className="grid grid-cols-2 gap-2 mt-3"><button type="button" onClick={()=>{
                    applyAgencyBrandingGlobally(globalAgency);setProductAgency(loadAgencyBranding(brandingProductId));setPreviewRefreshToken(v=>v+1);
                  }} className="rounded border border-cyan-700 p-2 text-xs">应用到全部产品</button>
                    <button type="button" onClick={()=>{
                      clearAgencyBranding('global');setGlobalAgency({...DEFAULT_AGENCY_BRANDING});setProductAgency(loadAgencyBranding(brandingProductId));setPreviewRefreshToken(v=>v+1);
                    }} className="rounded border border-slate-600 p-2 text-xs">恢复全局默认</button></div>
                </details>

                {imageStyle === "phase_space" && (
                  <div className="rounded-lg border border-rose-700/35 bg-rose-950/20 p-3 text-[10px] leading-relaxed text-rose-100/80">
                    Hart CPS 风格结构诊断。由于 TyphoonSIM 不保存完整 900/600/300 hPa 位势高度场，本图的 B、-VTₗ、-VTᵤ 为由暖核、非对称、风切与温带转型状态推导的模拟 proxy，而非真实再分析值。
                  </div>
                )}

                {/* WMC multi-model / multi-member guidance controls */}
                {imageStyle === "ensemble_tracks" && (
                  <div className="space-y-3 bg-indigo-950/25 p-3 rounded-lg border border-indigo-800/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-indigo-300">WMC 多模式 / 集合路径</span>
                      {ensembleMembers.length > 0 && <span className="text-[10px] bg-indigo-500/15 text-indigo-200 px-2 py-0.5 rounded-full border border-indigo-500/30 font-mono">{ensembleMembers.length} 条</span>}
                    </div>
                    <div className="space-y-2 rounded-xl border border-indigo-800/40 bg-slate-950/35 p-2.5">
                      <div className="flex items-center justify-between"><span className="text-[10px] font-black tracking-[0.12em] text-indigo-200">集系图版式</span><span className="text-[9px] text-slate-500">4 种参考气象图 + 经典版</span></div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {ENSEMBLE_REFERENCE_STYLES.map((item) => {
                          const active = ensembleReferenceStyle === item.id;
                          return <button key={item.id} type="button" onClick={() => {
                            if (resolveEnsembleHorizon(item.id) !== resolveEnsembleHorizon(ensembleReferenceStyle)) {
                              setEnsembleMembers([]);
                              strikeFieldCacheRef.current.clear();
                            }
                            setEnsembleReferenceStyle(item.id);
                            if (item.id !== "classic") setEnsembleMode(item.needsMembers ? "members" : "centers");
                            setPreviewRefreshToken(0);
                          }} className={`rounded-lg border px-2 py-2 text-left transition ${active ? "border-indigo-400 bg-indigo-500/15 text-indigo-100" : "border-slate-800 bg-slate-950/65 text-slate-400 hover:border-slate-700"}`}>
                            <div className="text-[10px] font-bold leading-tight">{item.shortName}</div>
                            <div className="mt-0.5 text-[8px] leading-tight opacity-70">{item.needsMembers ? "成员集合" : item.id === "classic" ? "原版" : "多模式中心"}</div>
                          </button>;
                        })}
                      </div>
                      <div className="text-[9px] leading-relaxed text-slate-500">{ENSEMBLE_REFERENCE_STYLES.find(item => item.id === ensembleReferenceStyle)?.description}</div>
                      {ensembleReferenceStyle === "paired_cycle_pressure" && <div className="mt-2 rounded-lg border border-cyan-800/40 bg-cyan-950/20 px-2.5 py-2 text-[9px] leading-relaxed text-cyan-100/80">双周期现已使用下方勾选的模型和“每个机构成员数”完整生成；当前周期与前一周期会使用同一组选中成员进行逐成员对照，不再固定截取前 50 条。</div>}
                      {(ensembleReferenceStyle === "pressure_spaghetti_basin" || ensembleReferenceStyle === "paired_cycle_pressure") && <div className="mt-2 space-y-2 rounded-lg border border-amber-700/35 bg-amber-950/15 p-2.5">
                        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-amber-200">总预报时效</span><span className="font-mono text-[10px] text-amber-300">+{ensembleTotalForecastHours}h</span></div>
                        <select value={ensembleTotalForecastHours} onChange={(e)=>{setEnsembleTotalForecastHours(Number(e.target.value));setEnsembleMembers([]);setPreviewRefreshToken(v=>v+1);}} className="w-full rounded border border-amber-800/50 bg-slate-950 px-2 py-2 text-xs text-slate-200">
                          {[72,96,120,144,168].map(h=><option key={h} value={h}>{h} 小时</option>)}
                        </select>
                        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-amber-200">路径结束方式</span><span className="text-[9px] text-slate-500">两个特殊集系图</span></div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button type="button" onClick={()=>{setEnsembleSpecialTrackEndMode("operational");setEnsembleMembers([]);setPreviewRefreshToken(v=>v+1);}} className={`rounded border px-2 py-1.5 text-[9px] font-bold ${ensembleSpecialTrackEndMode === "operational" ? "border-emerald-400 bg-emerald-500/15 text-emerald-100" : "border-slate-700 bg-slate-950/70 text-slate-400"}`}>正常停编</button>
                          <button type="button" onClick={()=>{setEnsembleSpecialTrackEndMode("residual");setEnsembleMembers([]);setPreviewRefreshToken(v=>v+1);}} className={`rounded border px-2 py-1.5 text-[9px] font-bold ${ensembleSpecialTrackEndMode === "residual" ? "border-violet-400 bg-violet-500/15 text-violet-100" : "border-slate-700 bg-slate-950/70 text-slate-400"}`}>跟随残余涡流</button>
                        </div>
                        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-amber-200">地图选取范围依据</span><span className="text-[9px] text-slate-500">仅影响自动取景</span></div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button type="button" onClick={()=>{setEnsembleSpecialMapRangeMode("operational");setPreviewRefreshToken(v=>v+1);}} className={`rounded border px-2 py-1.5 text-[9px] font-bold ${ensembleSpecialMapRangeMode === "operational" ? "border-amber-400 bg-amber-500/15 text-amber-100" : "border-slate-700 bg-slate-950/70 text-slate-400"}`}>默认 · 正常停编路径</button>
                          <button type="button" onClick={()=>{setEnsembleSpecialMapRangeMode("all");setPreviewRefreshToken(v=>v+1);}} className={`rounded border px-2 py-1.5 text-[9px] font-bold ${ensembleSpecialMapRangeMode === "all" ? "border-cyan-400 bg-cyan-500/15 text-cyan-100" : "border-slate-700 bg-slate-950/70 text-slate-400"}`}>显示全部成员路径</button>
                        </div>
                        <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-200 cursor-pointer"><input type="checkbox" checked={ensembleSpecialShowMainPath} onChange={(e)=>{setEnsembleSpecialShowMainPath(e.target.checked);setPreviewRefreshToken(v=>v+1);}} className="accent-emerald-400"/>显示主路径</label>
                        <div className="text-[8px] leading-relaxed text-slate-500">总时效是从起报时刻计算的硬上限。“正常停编”在成员首次减弱到 15 m/s 以下的节点停编，之后不再显示路径；“跟随残余涡流”则在成员首次减弱到 5 m/s 后继续显示约 14–24 小时（各成员不同），但不会超过总时效。“默认”按全部正常停编成员自动取景，“显示全部”会把实际显示的残余涡流路径也纳入取景。</div>
                      </div>}
                    </div>
                    {ensembleReferenceStyle === "ensemble_intensity_analysis" && (
                      <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-3 space-y-2">
                        <div className="text-xs font-bold">综合集系分析 · 7 面板</div>
                        <label className="text-xs">统计时效
                          <select value={ensIntelHorizon} onChange={e=>{setEnsIntelHorizon(Number(e.target.value));setEnsembleMembers([]);setPreviewRefreshToken(v=>v+1);}} className="w-full rounded bg-slate-950 p-2">
                            {[120,168,240,360].map(n=><option key={n} value={n}>{n} 小时</option>)}
                          </select>
                        </label>
                        <label className="text-xs">风速单位<select value={ensIntelUnit} onChange={e=>{setEnsIntelUnit(e.target.value as "kt"|"m/s");setPreviewRefreshToken(v=>v+1);}} className="w-full rounded bg-slate-950 p-2"><option value="kt">节（kt）</option><option value="m/s">米/秒（m/s）</option></select></label>
                        <label className="text-xs">页脚右侧文字（可留空）<input value={ensIntelFooter} maxLength={60} onChange={e=>setEnsIntelFooter(e.target.value)} className="w-full rounded bg-slate-950 p-2"/></label>
                        <div className="text-xs text-slate-400">使用程序内 {ensembleMembers.length} 条成员记录；缺失时效为未知，不计作零强度。</div>
                      </div>
                    )}
                    {ensembleReferenceStyle === "strike_probability_120km" && (
                      <div className="space-y-2 rounded-xl border border-amber-700/40 bg-amber-950/15 p-3">
                        <div className="text-xs font-bold text-amber-200">袭击概率图 · 120 km 设置</div>
                        <div className="text-[9px] text-slate-400">集合成员：{ensembleMembers.length} 条 / 已选 {selectedEnsembleModels.length} 个模型</div>
                        {ensembleMembers.length > 0 && ensembleMembers.length < 100 && <div className="text-[9px] text-amber-300">成员偏少，低概率区域容易颗粒化；建议至少 200 成员。</div>}
                        <div className="text-xs text-slate-300">停编方式</div>
                        <div className="grid grid-cols-2 gap-2">{(["operational","residual"] as const).map(mode=><button type="button" key={mode} onClick={()=>{setStrikeTrackEndMode(mode);strikeFieldCacheRef.current.clear();setEnsembleMembers([]);setPreviewRefreshToken(v=>v+1);}} className={`rounded border p-2 text-xs ${strikeTrackEndMode===mode?"border-slate-200 bg-slate-700 text-white":"border-slate-700"}`}>{mode==="operational"?"正常停编":"跟随残余低压"}</button>)}</div>
                        <label className="block text-[10px] text-slate-300">统计时效
                          <select value={ensembleStrikeHorizonHours} onChange={e=>{setEnsembleStrikeHorizonHours(Number(e.target.value));setEnsembleMembers([]);strikeFieldCacheRef.current.clear();setPreviewRefreshToken(v=>v+1);}} className="w-full rounded bg-slate-950 border border-slate-700 p-2 text-xs">
                            {[72,96,120,168,240,360].map(n=><option key={n} value={n}>{n} 小时</option>)}
                          </select>
                        </label>
                        {effectiveStrikeCell&&<div className="text-[10px] text-slate-400">预计栅格：{strikeEstimatedCells.toLocaleString('zh-CN')} 格，实际计算精度约 {Number(effectiveStrikeCell.toFixed(5))}°{effectiveStrikeCell>strikeCellDeg+1e-6?'（取景较大，已自动放宽）':''}</div>}
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            ["半径 (km)",strikeRadiusKm,setStrikeRadiusKm,[50,80,100,120,150,200,300]],
                            ["栅格精度 (°)",strikeCellDeg,setStrikeCellDeg,[0.0025,0.005,0.01,0.02,0.025,0.05,0.1,0.2,0.25]],
                            ["轻度平滑",strikeSmoothPasses,setStrikeSmoothPasses,[0,1,2]],
                            ["沿岸阈值 (%)",strikeCoastMinPct,setStrikeCoastMinPct,[1,5,10,25]],
                            ["平均路径黑点间隔",strikeMeanDotHours,setStrikeMeanDotHours,[3,6,12,24]],
                            ["底部胶囊数",strikePillCount,setStrikePillCount,[0,1,2,3,4,5,6,7,8,9,10]],
                            ["胶囊最低概率 (%)",strikePillMinPct,setStrikePillMinPct,[1,5,10,15,20,25,30]]
                          ] as const).map(([label,value,setter,items])=><label key={label} className="text-[10px] text-slate-300">{label}
                            <select value={value} onChange={e=>{setter(Number(e.target.value));setPreviewRefreshToken(v=>v+1);}} className="w-full rounded bg-slate-950 border border-slate-700 p-2 text-xs">
                              {items.map(n=><option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>)}
                        </div>
                        <label className="block text-[10px] text-slate-300">沿岸线宽 {strikeCoastWidth}px
                          <input type="range" min={4} max={12} step={1} value={strikeCoastWidth} onChange={e=>{setStrikeCoastWidth(Number(e.target.value));setPreviewRefreshToken(v=>v+1);}} className="w-full accent-amber-400"/>
                        </label>
                        <label className="block text-[10px] text-slate-300">取景范围
                          <select value={strikeFrameMode} onChange={e=>{setStrikeFrameMode(e.target.value as "auto"|"wnp"|"custom");setPreviewRefreshToken(v=>v+1);}} className="w-full rounded bg-slate-950 border border-slate-700 p-2 text-xs">
                            <option value="auto">自动</option><option value="wnp">西北太平洋（参考图范围）</option><option value="custom">自定义</option>
                          </select>
                        </label>
                        {strikeFrameMode === "custom" && <div className="grid grid-cols-2 gap-2">
                          {(["minLon","maxLon","minLat","maxLat"] as const).map(k=><label key={k} className="text-[10px] text-slate-300">{k}
                            <input type="number" step="0.5" value={strikeCustomBounds[k]} onChange={e=>{setStrikeCustomBounds(prev=>({...prev,[k]:Number(e.target.value)}));setPreviewRefreshToken(v=>v+1);}} className="w-full bg-slate-950 border border-slate-700 rounded p-2"/>
                          </label>)}
                        </div>}
                        <label className="flex items-center gap-2 text-[10px] text-slate-300"><input type="checkbox" checked={strikeShowMembers} onChange={e=>{setStrikeShowMembers(e.target.checked);setPreviewRefreshToken(v=>v+1);}}/>显示成员灰线</label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[10px] text-slate-300">标题模型标签<input type="text" maxLength={12} value={strikeModelLabel} onChange={e=>{setStrikeModelLabel(e.target.value);setPreviewRefreshToken(v=>v+1);}} className="w-full bg-slate-950 border border-slate-700 rounded p-2"/></label>
                          <label className="text-[10px] text-slate-300">水印文字<input type="text" maxLength={30} value={strikeWatermark} onChange={e=>{setStrikeWatermark(e.target.value);setPreviewRefreshToken(v=>v+1);}} className="w-full bg-slate-950 border border-slate-700 rounded p-2"/></label>
                        </div>
                        <div className="text-[9px] text-slate-400">概率 = 成员中心曾进入点 R km 内的成员数 ÷ 全部成员数。成员为 WMC 内部模拟，不代表真实 ECMWF/GFS 资料。</div>
                      </div>
                    )}
                    {ensembleReferenceStyle === "classic" && <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setEnsembleMode("centers"); setEnsembleMembers([]); setPreviewRefreshToken(0); }} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${ensembleMode === "centers" ? "border-cyan-400 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-950/60 text-slate-400"}`}>8 机构中心路径</button>
                      <button type="button" onClick={() => { setEnsembleMode("members"); setEnsembleMembers([]); setPreviewRefreshToken(0); }} className={`rounded-lg border px-2 py-2 text-[10px] font-bold ${ensembleMode === "members" ? "border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-200" : "border-slate-700 bg-slate-950/60 text-slate-400"}`}>机构多成员集合</button>
                    </div>}
                    <div className="grid grid-cols-2 gap-1.5">
                      {AETHER_MODEL_SPECS.map((spec) => { const checked = selectedEnsembleModels.includes(spec.id); return (
                        <label key={spec.id} className={`rounded-lg border px-2 py-1.5 flex items-center gap-2 cursor-pointer ${checked ? "border-slate-500 bg-slate-900" : "border-slate-800 bg-slate-950/50 opacity-70"}`}>
                          <input type="checkbox" checked={!ensembleProductNeedsMembers ? true : checked} disabled={!ensembleProductNeedsMembers} onChange={(e) => { setEnsembleMembers([]); setPreviewRefreshToken(0); setSelectedEnsembleModels(prev => e.target.checked ? [...new Set([...prev, spec.id])] : prev.filter(id => id !== spec.id)); }} className="accent-cyan-400"/>
                          <span className="w-5 h-1 rounded-full" style={{backgroundColor:spec.color}}/><span className="text-[10px] font-bold text-slate-200">{spec.label}</span>
                        </label>
                      );})}
                    </div>
                    {ensembleProductNeedsMembers && (
                      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/45 p-2">
                        {ensembleReferenceStyle === "classic" && <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer"><input type="checkbox" checked={ensembleBlackLines} onChange={e => {setEnsembleBlackLines(e.target.checked);setPreviewRefreshToken(v=>v+1);}} className="accent-zinc-300"/>叠加黑色控制线与基准路径</label>}
                        <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">每个机构成员数</span><span className="text-[10px] font-mono text-cyan-300">{ensembleMembersPerModel} / 模型 · 总计 {ensembleMembersPerModel * selectedEnsembleModels.length}{ensembleReferenceStyle === "paired_cycle_pressure" ? " / 周期" : ""}</span></div>
                        <select value={ensembleMembersPerModel} onChange={(e) => { setEnsembleMembers([]); setPreviewRefreshToken(0); setEnsembleMembersPerModel(Number(e.target.value)); }} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200">
                          {AETHER_ENSEMBLE_MEMBER_COUNTS.map(n => <option key={n} value={n}>{n} 成员 / 模型</option>)}
                        </select>
                        <div className="flex gap-2"><button type="button" onClick={() => { setSelectedEnsembleModels(AETHER_MODEL_SPECS.map(m=>m.id)); setEnsembleMembers([]); }} className="flex-1 rounded border border-slate-700 py-1 text-[10px] text-slate-300">全选</button><button type="button" onClick={() => { setSelectedEnsembleModels([]); setEnsembleMembers([]); }} className="flex-1 rounded border border-slate-700 py-1 text-[10px] text-slate-300">清空</button></div>
                      </div>
                    )}
                    <div className="text-[9px] leading-relaxed text-slate-500">这些名称代表 WMC 内部模拟模式族，并非下载或运行真实 ECMWF/GFS 数值模式资料。成员会在所选模式中心路径附近产生随时效增长的路径与强度离散。</div>
                    {isCalculatingEnsemble ? (
                      <div className="space-y-2"><div className="flex justify-between text-[10px] text-indigo-300"><span>{ensembleProgressStage}</span><span>{ensembleProgress}%</span></div><div className="h-2 overflow-hidden rounded-full border border-indigo-900 bg-slate-950"><div className="h-full bg-indigo-500" style={{width:`${ensembleProgress}%`}}/></div><button type="button" onClick={cancelEnsembleSimulation} className="w-full rounded-lg border border-rose-700/50 py-1.5 text-[10px] font-bold text-rose-300">取消计算</button></div>
                    ) : (
                      <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] leading-5 text-slate-300">
                        点击下方“制作图片”时将自动完成集合计算并直接出图，不再需要单独的计算按钮。
                      </div>
                    )}
                  </div>
                )}
                {/* Style-Specific Parameter Panels */}
                {imageStyle === "synoptic_wind_pressure" && (
                  <div className="space-y-3 rounded-xl border border-cyan-800/45 bg-cyan-950/20 p-3">
                    <div>
                      <div className="text-xs font-bold text-cyan-200">风场气压形势图</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">环境背景场 + Holland/Willoughby 台风涡旋 + ETOPO 地形 + 高阶二维边界层流体求解。0.10°/0.125° 会明显增加计算时间，但能保留更多陆地地形风影与眼墙细节。</div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px]"><span className="text-slate-400">有效时刻 / 预报时效</span><b className="font-mono text-cyan-300">+{clamp(synopticLeadHours, 0, synopticMaxLead)} h</b></div>
                      <input type="range" min={0} max={synopticMaxLead} step={3} value={clamp(synopticLeadHours, 0, synopticMaxLead)} onChange={(e) => setSynopticLeadHours(Number(e.target.value))} className="w-full accent-cyan-500" />
                      <div className="text-[9px] text-slate-600">起报时刻跟随当前时间轴（当前 {synopticIssueHour.toFixed(1)} h）；每次生成开始后会冻结该次报次，下一次生成会自动读取最新台风状态与风圈。</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-500">取景模式
                        <select value={synopticDomainMode} onChange={(e) => setSynopticDomainMode(e.target.value as "reference" | "follow_storm" | "custom")} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200">
                          <option value="reference">参考复刻</option><option value="follow_storm">跟随台风</option><option value="custom">自定义（精确选区）</option>
                        </select>
                      </label>
                      <label className="text-[10px] text-slate-500">地图缩放
                        <select disabled={synopticDomainMode === "custom"} value={synopticDomainMode === "custom" ? 1 : synopticMapZoom} onChange={(e) => setSynopticMapZoom(Number(e.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 disabled:opacity-50">
                          <option value={0.4}>0.40×（超广域）</option>
                          <option value={0.5}>0.50×（很广）</option>
                          <option value={0.6}>0.60×</option>
                          <option value={0.75}>0.75×（广域）</option>
                          <option value={0.9}>0.90×</option>
                          <option value={1}>1.00×（基准）</option>
                          <option value={1.15}>1.15×</option>
                          <option value={1.3}>1.30×</option>
                          <option value={1.5}>1.50×</option>
                          <option value={1.75}>1.75×</option>
                          <option value={2}>2.00×（近景）</option>
                          <option value={2.5}>2.50×</option>
                          <option value={3}>3.00×（特写）</option>
                          <option value={3.5}>3.50×</option>
                          <option value={4}>4.00×（近核心）</option>
                          <option value={5}>5.00×（超特写）</option>
                        </select>
                      </label>
                    </div>
                    <button type="button" onClick={onStartSynopticMapSelection} disabled={!onStartSynopticMapSelection}
                      className="w-full rounded-lg border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-[11px] font-bold text-cyan-200 disabled:opacity-40">
                      <Monitor className="inline-block h-3.5 w-3.5 mr-1" />手动选区 · 返回地图平移/缩放后确认
                    </button>
                    {synopticDomainMode === "custom" && (
                      <div className="grid grid-cols-2 gap-2">
                        {([['lonMin','西界'],['lonMax','东界'],['latMin','南界'],['latMax','北界']] as const).map(([key, label]) => (
                          <label key={key} className="text-[10px] text-slate-500">{label}
                            <input type="number" step="0.5" value={synopticCustomBounds[key]} onChange={(e) => setSynopticCustomBounds((v) => ({ ...v, [key]: Number(e.target.value) }))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200" />
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-slate-500">计算网格
                        <select value={synopticGridResolution} onChange={(e) => setSynopticGridResolution(Number(e.target.value) as 0.1 | 0.125 | 0.25 | 0.5)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200">
                          <option value={0.1}>0.10°（超高精度）</option><option value={0.125}>0.125°（高精度）</option><option value={0.25}>0.25°（标准）</option><option value={0.5}>0.50°（快速）</option>
                        </select>
                      </label>
                      <label className="text-[10px] text-slate-500">等压线间隔
                        <select disabled={!synopticShowContours} value={synopticContourInterval} onChange={(e) => setSynopticContourInterval(Number(e.target.value) as 2 | 4 | 5 | 8)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200 disabled:opacity-40">
                          {[2, 4, 5, 8].map((v) => <option key={v} value={v}>{v} hPa</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setSynopticShowContours((v) => !v)} className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${synopticShowContours ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-950 text-slate-400"}`}>等压线：{synopticShowContours ? "开" : "关"}</button>
                      <button type="button" onClick={() => setSynopticShowTrack((v) => !v)} className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${synopticShowTrack ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 bg-slate-950 text-slate-400"}`}>路径/中心：{synopticShowTrack ? "开" : "关"}</button>
                    </div>
                    <label className="text-[10px] text-slate-500 block">模型名标签
                      <input value={synopticModelLabel} onChange={(e) => setSynopticModelLabel(e.target.value)} maxLength={24} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200" />
                    </label>
                    <label className="text-[10px] text-slate-500 block">画面比例（含图例）
                      <select aria-label="风场图画面比例" value={synopticAspectRatio} onChange={e=>setSynopticAspectRatio(e.target.value as SynopticProductAspect)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200">
                        <option value="default">默认（跟随风格）</option>
                        <option value="3:4">3:4 竖屏</option><option value="4:3">4:3 横屏</option>
                        <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option>
                      </select>
                      <div className="mt-1 text-[9px] text-slate-500">竖屏图例在风场下方，左侧弱风、右侧强风；手动选区框只对应地图主体。</div>
                    </label>
                    <label className="text-[10px] text-slate-500 block">风场图风格
                      <select value={synopticStylePreset} onChange={(e) => setSynopticStylePreset(e.target.value as SynopticWindPressureStyle)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-200">
                        <option value="default">默认</option>
                        <option value="hmon">HMON 参考风格</option>
                        <option value="hwrf">HWRF 参考风格</option>
                      </select>
                      <div className="mt-1 text-[9px] leading-relaxed text-slate-600">两套参考风格会切换风速配色、等压线样式、风羽密度、标题与 7–155 kt 色标；气象计算本身不变。</div>
                    </label>
                    <label className="flex items-start gap-2.5 rounded-lg border border-cyan-900/45 bg-slate-950/70 px-3 py-2.5 cursor-pointer">
                      <input type="checkbox" aria-label="圆润清晰风眼" checked={synopticRoundedClearEye} onChange={(e)=>setSynopticRoundedClearEye(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-500" />
                      <span className="min-w-0"><span className="block text-[11px] font-bold text-cyan-100">圆润清晰风眼（默认关闭）</span>
                        <span className="block text-[9px] leading-relaxed text-slate-400">仅增强已存在的风眼：完整眼墙显著圆润清晰；受损眼墙只局部改善，保留缺口。无风眼时不会生成新风眼。适用于风场图和预报视频。</span>
                      </span>
                    </label>
                    <div className="space-y-2 rounded-xl border border-violet-800/45 bg-violet-950/20 p-2.5">
                      <div className="flex items-center gap-2 text-[11px] font-bold text-violet-200"><Film className="h-3.5 w-3.5" />预报风场视频</div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-[9px] text-slate-500">帧数<select value={synopticVideoFrames} onChange={(e) => setSynopticVideoFrames(Number(e.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1.5 text-[10px] text-slate-200">{[8, 12, 16, 24, 36, 48, 60, 72, 96, 120, 144, 180, 240].map(v => <option key={v} value={v}>{v} 帧</option>)}</select></label>
                        <label className="text-[9px] text-slate-500">时长<select value={synopticVideoDuration} onChange={(e) => setSynopticVideoDuration(Number(e.target.value))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1.5 text-[10px] text-slate-200">{[4, 6, 8, 12, 16, 20].map(v => <option key={v} value={v}>{v} 秒</option>)}</select></label>
                        <label className="text-[9px] text-slate-500">清晰度<select value={synopticVideoResolution} onChange={(e) => setSynopticVideoResolution(e.target.value as SynopticVideoResolution)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1.5 text-[10px] text-slate-200"><option value="720p">720p · 宽 1080px</option><option value="1080p">1080p · 宽 1620px</option><option value="2K">2K · 宽 2160px</option></select></label>
                      </div>
                      <div className="text-[8px] leading-relaxed text-slate-500">视频会从 +0h 自动计算到当前选择的 +{clamp(synopticLeadHours, 0, synopticMaxLead)}h；每一帧都重新计算风压场，不是静态图片平移动画。高精度网格 × 高帧数会显著增加耗时。</div>
                    </div>
                  </div>
                )}
                {imageStyle === "rain_observed" && (
                  <div className="space-y-4 bg-cyan-950/20 p-3 rounded-xl border border-cyan-900/40">
                    <div>
                      <div className="text-xs font-bold text-cyan-200">累计降水实况分析</div>
                      <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">按已经发生的台风历史状态逐小时积分眼墙、螺旋雨带、季风水汽与地形增雨，输出模拟实况而非未来预报。</div>
                    </div>
                    <div className="rounded-lg border border-cyan-800/50 bg-cyan-950/30 px-3 py-2 text-[11px] text-cyan-100">统计窗口固定为过去 24 小时；实况产品不再提供可切换时间窗口。</div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">图片比例</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(["4:3", "16:9", "3:2", "1:1"] as RainfallAspectRatio[]).map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => setRainfallAspectRatio(ratio)}
                            className={`py-2 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
                              rainfallAspectRatio === ratio
                                ? "bg-cyan-500/15 border-cyan-400 text-cyan-200"
                                : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                            }`}
                          >
                            {ratio}{ratio === "4:3" ? " 参考" : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">降水图例</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                        <button type="button" onClick={() => { setRainfallLegendStyle("green_reference"); setRainfallMapPalette("palette1"); }} className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition cursor-pointer ${rainfallLegendStyle === "green_reference" ? "bg-cyan-500/15 border-cyan-400 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"}`}>图例① 0～250+</button>
                        <button type="button" onClick={() => { setRainfallLegendStyle("extreme_reference"); setRainfallMapPalette("palette2"); }} className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition cursor-pointer ${rainfallLegendStyle === "extreme_reference" ? "bg-cyan-500/15 border-cyan-400 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"}`}>图例② 25～800+</button>
                        <button type="button" onClick={() => setRainfallLegendStyle("combined_overlay")} className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition cursor-pointer ${rainfallLegendStyle === "combined_overlay" ? "bg-cyan-500/15 border-cyan-400 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"}`}>叠加：0～250用①，250+用②</button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">地图降水配色 <span className="text-[10px] text-slate-600">（图例①时可独立选择）</span></label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button type="button" disabled={rainfallLegendStyle !== "green_reference"} onClick={() => setRainfallMapPalette("palette1")} className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition ${rainfallLegendStyle !== "green_reference" ? "cursor-not-allowed opacity-45 bg-slate-950 border-slate-900 text-slate-600" : rainfallMapPalette === "palette1" ? "cursor-pointer bg-cyan-500/15 border-cyan-400 text-cyan-200" : "cursor-pointer bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"}`}>使用配色①</button>
                        <button type="button" disabled={rainfallLegendStyle !== "green_reference"} onClick={() => setRainfallMapPalette("palette2")} className={`py-2 px-2 rounded-lg border text-[11px] font-bold transition ${rainfallLegendStyle !== "green_reference" ? "cursor-not-allowed opacity-45 bg-slate-950 border-slate-900 text-slate-600" : rainfallMapPalette === "palette2" ? "cursor-pointer bg-cyan-500/15 border-cyan-400 text-cyan-200" : "cursor-pointer bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"}`}>使用配色②</button>
                      </div>
                      {rainfallLegendStyle !== "green_reference" && (
                        <div className="text-[10px] text-amber-300/80">当前地图配色由{rainfallLegendStyle === "combined_overlay" ? "叠加规则（0～250=①，250+=②）" : "图例②"}锁定，避免图例与地图颜色不一致。</div>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
                      图例②会强制地图使用②的分级颜色；“叠加”会强制地图按0～250 mm使用①、250 mm以上使用②，因此400/600/800+高值会实际显示橙黄系颜色。图例①时仍可用下方按钮独立切换地图配色①/②。仅改变成图表达，不修改累计降水、地形增雨、水汽输送或模拟分辨率。
                    </div>
                  </div>
                )}
                {imageStyle === "jma_forecast" && (
                  <>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">台风名称</span><b className="text-slate-100">{typhoonName}</b></div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">台风编号</span><b className="font-mono text-cyan-300">{typhoonNumber}</b></div>
                      <div className="mt-2 text-[9px] leading-relaxed text-slate-600">复刻 JMA 业务预报图风格：采用北半球 Polar Stereographic（lat₀=90°N、lon₀=140°E、lat_ts=60°N），蓝海绿陆、白色70%预报圈与白色不确定性包络、红色暴风警戒域，并按照 T+12 / 24 / 48 / 72 / 96 / 120h 自动计算各时次标注；风圈、概率圈和节点保持屏幕正圆。</div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">预报时效 (未来)</label>
                      <select
                        value={forecastHours}
                        onChange={(e) => setForecastHours(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500/80 transition"
                      >
                        <option value={24}>24 小时（显示 12 / 24h 圈）</option>
                        <option value={48}>48 小时</option>
                        <option value={72}>72 小时</option>
                        <option value={96}>96 小时</option>
                        <option value={120}>120 小时</option>
                      </select>
                    </div>

                    <div className="space-y-2 border-t border-slate-800/40 pt-4">
                      <label className="text-xs text-slate-400 block font-medium">JMA 要素显示</label>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-300">显示预测概率圆</span>
                        <button
                          onClick={() => setJmaShowPredictedRings(!jmaShowPredictedRings)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                            jmaShowPredictedRings ? "bg-cyan-500" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              jmaShowPredictedRings ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-300">显示当前风圈</span>
                        <button
                          onClick={() => setJmaShowCurrentWindArea(!jmaShowCurrentWindArea)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                            jmaShowCurrentWindArea ? "bg-cyan-500" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              jmaShowCurrentWindArea ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-amber-100/80">
                      不确定性锥基于各个预报时次的概率圆半径连续外包构建，导出时会完整保留整个锥体；标题栏时间、各时次日期标签与 T+12/24/48/72/96/120h 位置均按当前模拟时刻自动换算。
                    </div>
                  </>
                )}
                {imageStyle === "standard" && (
                  <>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">台风名称</span><b className="text-slate-100">{typhoonName}</b></div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">台风编号</span><b className="font-mono text-cyan-300">{typhoonNumber}</b></div>
                      <div className="mt-2 text-[9px] leading-relaxed text-slate-600">名称与编号由“台风 → 台风基础信息”统一管理，所有产品同步使用同一身份。</div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">预报时效 (未来)</label>
                      <select
                        value={forecastHours}
                        onChange={(e) => setForecastHours(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500/80 transition"
                      >
                        <option value={24}>24 小时</option>
                        <option value={48}>48 小时</option>
                        <option value={72}>72 小时</option>
                        <option value={96}>96 小时</option>
                        <option value={120}>120 小时</option>
                      </select>
                    </div>

                    <div className="rounded-xl border border-cyan-700/40 bg-cyan-950/20 p-3 space-y-2">
                      <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-slate-100">
                        <span>初期巅峰强度保守预报</span>
                        <input type="checkbox" checked={nmcCoarseIntensity}
                          onChange={e=>{setNmcCoarseIntensity(e.target.checked);setPreviewRefreshToken(0);}}
                          className="h-4 w-4 accent-cyan-400" aria-label="初期巅峰强度保守预报" />
                      </label>
                      <div className="text-[10px] leading-relaxed text-slate-400">
                        {nmcCoarseIntensity
                          ? "开启：仅在台风生成初期压低预测巅峰、减弱对爆发增强与近岸突然增强的预判；不再平滑真实的干空气减弱、恢复等过程。"
                          : "关闭：本张 NMC 图使用 Round164 风格高权重预模拟强度，不施加初期巅峰保守修正。"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/15 p-3 space-y-2">
                      <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-slate-100">
                        <span>指定 NMC 巅峰强度</span>
                        <input type="checkbox" checked={nmcCustomPeakEnabled}
                          onChange={e=>{setNmcCustomPeakEnabled(e.target.checked);setPreviewRefreshToken(v=>v===0?0:v+1);}}
                          className="h-4 w-4 accent-emerald-400" aria-label="指定 NMC 巅峰强度" />
                      </label>
                      {nmcCustomPeakEnabled && <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-xs text-slate-300">
                          <span>目标最大风速</span><b className="font-mono text-emerald-300">{Math.max(nmcCustomPeak,Math.ceil(Number(typhoon.vmax)||0))} m/s</b>
                        </div>
                        <input type="range" min={15} max={90} step={1}
                          value={Math.max(nmcCustomPeak,Math.ceil(Number(typhoon.vmax)||0))}
                          onChange={e=>{setNmcCustomPeak(Number(e.target.value));setPreviewRefreshToken(v=>v===0?0:v+1);}}
                          className="w-full accent-emerald-400" aria-label="NMC 目标巅峰强度滑块" />
                        <div className="flex justify-between text-[10px] text-slate-500"><span>15 m/s</span><span>90 m/s</span></div>
                      </div>}
                      <div className="text-[10px] leading-relaxed text-slate-400">
                        {'关闭时：已确认的预模拟或主模拟参考强度保持原样，不会凭空增强。开启时：即使有预模拟参考，也会按你指定的目标重塑本张 WMC 风格 NMC 预报图的强度，同时保留提高后的强度余量，让峰后减弱平稳衔接而非突然跌回旧预模拟风速；仅影响这张图，不修改预模拟、主模拟或其他产品。若时效内无法达到目标，将提示错误。图中信息框的风速按 CMA 公开档位显示，可能与滑块的精确目标值不同（如指定 67 m/s，信息框显示 68 m/s）；风力等级与强度类别均按公开值对应。'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-sky-700/40 bg-slate-950/50 p-3 space-y-2">
                      <div className="text-xs font-bold text-sky-200">NMC 地理叠加（仅此产品）</div>
                      {([
                        ['中国大陆及港澳台淡黄色填色',nmcChinaTint,setNmcChinaTint],
                        ['精细国界',nmcBorders,setNmcBorders],
                        ['中国省界（本地优先，在线备用）',nmcProvinces,setNmcProvinces],
                        ['蓝色河流水系（本地矢量数据）',nmcRivers,setNmcRivers]
                      ] as const).map(([label,enabled,setEnabled]) => (
                        <label key={label} className="flex items-center justify-between gap-2 text-[11px] text-slate-300 cursor-pointer">
                          <span>{label}</span><input type="checkbox" checked={enabled}
                            onChange={e=>{setEnabled(e.target.checked);setPreviewRefreshToken(0);}} className="accent-cyan-400" />
                        </label>
                      ))}
                      {nmcOverlayError && <div className="text-[10px] text-amber-300">叠加资料未能全部读取：{nmcOverlayError}。国界及基础海岸线仍可离线绘制。</div>}
                      <div className="text-[9px] text-slate-500">水系使用内置离线矢量数据；省界在构建时尽量打包到本地，缺失时从公开矢量镜像加载。加载失败会提示，不会绘制虚构边界。预览与 PNG 导出共用开关。</div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400 block font-medium">历史路径业务打点</label>
                      <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs leading-5 text-cyan-200">
                        NMC 历史节点（北京时间）：02 / 08 / 11 / 14 / 17 / 20 / 23 时
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-slate-800/40 pt-4">
                      <label className="text-xs text-slate-400 block font-medium">信息框显示选项</label>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-slate-300">显示预报信息框</span>
                        <button
                          onClick={() => setShowInfoBoxes(!showInfoBoxes)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                            showInfoBoxes ? "bg-cyan-500" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              showInfoBoxes ? "translate-x-5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>

                      {showInfoBoxes && (
                        <div className="space-y-4 pl-3 border-l-2 border-slate-800/60 mt-3 mb-2">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">标注分布密度</label>
                              <span className="text-[10px] bg-slate-800 text-blue-400 px-1.5 py-0.5 rounded font-mono">Lv.{boxDensity}</span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="5"
                              step="1"
                              value={boxDensity}
                              onChange={(e) => setBoxDensity(Number(e.target.value))}
                              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            />
                            <div className="flex justify-between text-[9px] text-slate-600 px-0.5">
                              <span>稀疏</span>
                              <span>默认</span>
                              <span>密集</span>
                            </div>
                          </div>

                          <div className="space-y-2.5">
                            <div className="flex items-center gap-3 group" onClick={() => setShowCenterBox(!showCenterBox)}>
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${showCenterBox ? "bg-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "border-slate-700 bg-slate-950"}`}>
                                {showCenterBox && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                              </div>
                              <span className={`text-xs transition-colors ${showCenterBox ? "text-slate-200" : "text-slate-500"} cursor-pointer`}>现状位置框 (Present)</span>
                            </div>

                            <div className="flex items-center gap-3 group" onClick={() => setShowForecastBox(!showForecastBox)}>
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${showForecastBox ? "bg-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "border-slate-700 bg-slate-950"}`}>
                                {showForecastBox && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                              </div>
                              <span className={`text-xs transition-colors ${showForecastBox ? "text-slate-200" : "text-slate-500"} cursor-pointer`}>预报节点框 (Forecast)</span>
                            </div>

                            <div className="flex items-center gap-3 group" onClick={() => setShowLandfallBox(!showLandfallBox)}>
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${showLandfallBox ? "bg-cyan-500 border-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "border-slate-700 bg-slate-950"}`}>
                                {showLandfallBox && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                              </div>
                              <span className={`text-xs transition-colors ${showLandfallBox ? "text-slate-200" : "text-slate-500"} cursor-pointer`}>登陆预报框 (Landfall)</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}


                </div>

              {imageStyle !== "rain_observed" && imageStyle !== "synoptic_wind_pressure" && (
                <div className="pt-4 border-t border-slate-200">
                  <button type="button"
                    disabled={imageStyle === "ensemble_tracks" && ensembleProductNeedsMembers && ensembleMembers.length === 0}
                    onClick={async () => { await ensureProductGeoJson(); setPreviewRefreshToken(Date.now()); }}
                    className="w-full rounded border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] font-bold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40">
                    {previewRefreshToken === 0 ? "生成低清预览" : "刷新低清预览"}
                  </button>
                  <div className="mt-1.5 text-[9px] leading-relaxed text-slate-500">预览只计算一次并使用低分辨率 Canvas；不会随着模拟时钟自动刷新。</div>
                </div>
              )}

              {/* Resolution selection */}
              <div className="space-y-2.5">
                <label className="text-xs text-slate-400 block font-medium">输出清晰度 (最高 8K)</label>
                <div className="grid grid-cols-2 gap-2">
                  {RESOLUTIONS.map((res) => {
                    const isSelected = resolutionId === res.id;
                    return (
                      <button
                        key={res.id}
                        onClick={() => setResolutionId(res.id)}
                        className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? "bg-blue-500/10 border-sky-500 text-blue-400"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <span className="text-xs font-bold font-mono">{res.name}</span>
                        <span className="text-[10px] text-slate-500 mt-0.5">
                          {imageStyle === "synoptic_wind_pressure"
                            ? `${res.width}x${Math.round(res.width / 1.5)}`
                            : imageStyle === "rain_observed"
                            ? `${res.width}x${Math.round(res.width / (rainfallAspectRatio === "16:9" ? 16/9 : rainfallAspectRatio === "3:2" ? 3/2 : rainfallAspectRatio === "1:1" ? 1 : 4/3))}`
                            : imageStyle === "ensemble_tracks" && ensembleReferenceStyle !== "classic"
                              ? `${res.width}x${Math.round(res.width / getEnsembleReferenceAspect(ensembleReferenceStyle))}`
                              : `${res.width}x${res.height}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Download & Close buttons */}
            <div className="aether-product-actions space-y-3 pt-4 border-t border-slate-800/60 mt-6">
              <button
                onClick={isGenerating ? handleStopGeneration : handleGenerate}
                disabled={!isGenerating && (imageStyle === "ensemble_tracks" && ensembleProductNeedsMembers && selectedEnsembleModels.length === 0)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-bold text-sm transition cursor-pointer shadow-md ${
                  isGenerating
                    ? "bg-red-950/45 hover:bg-red-900/60 text-red-200 border-red-700/80"
                    : "bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/50 text-slate-200 border-slate-700/80"
                }`}
              >
                {isGenerating ? (
                  imageStyle === "rain_observed" || imageStyle === "synoptic_wind_pressure" ? <Square className="w-4 h-4" /> : <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isGenerating
                  ? `终止生成${generationProgress > 0 ? ` (${Math.round(generationProgress)}%)` : ""}`
                  : `${previewDataUrl ? "重新" : ""}${imageStyle === "ensemble_tracks"
                    ? `制作集系预报图${ensembleProductNeedsMembers ? ` (${selectedEnsembleModels.length * ensembleMembersPerModel} 成员)` : " (8 机构)"}`
                    : imageStyle === "rain_observed" ? "生成实况降水图" : imageStyle === "synoptic_wind_pressure" ? "生成风场气压形势图" : "生成图片"}`}
              </button>

              {generationError && (
                <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-[10px] leading-relaxed text-rose-200">{generationError}</div>
              )}

              {imageStyle === "synoptic_wind_pressure" && (
                <button
                  onClick={handleGenerateSynopticVideo}
                  disabled={isGenerating || synopticLeadHours <= 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-violet-700/70 bg-violet-950/35 text-violet-200 hover:bg-violet-900/45 disabled:cursor-not-allowed disabled:opacity-45 font-bold text-sm transition"
                >
                  <Film className="w-4 h-4" />
                  {synopticLeadHours <= 0 ? "先选择大于 0h 的视频预报时效" : `生成预报风场视频 · ${synopticVideoFrames}帧 / ${synopticVideoDuration}s / ${synopticVideoResolution}`}
                </button>
              )}
              
              <button
                onClick={() => { generationAbortRef.current?.abort(); onClose(); }}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition cursor-pointer"
              >
                返回主控台
              </button>
            </div>
          </div>
        </div>
      )}

      {isCalculatingEnsemble && (
        <div className="fixed inset-0 z-[7950] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-2xl border border-violet-500/35 bg-[#0b1020] shadow-2xl p-5 text-slate-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl border border-violet-500/35 bg-violet-500/10 flex items-center justify-center shrink-0">
                <RefreshCw className="w-5 h-5 text-violet-300 animate-spin" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base">正在计算 WMC 集合路径</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">中心模式生成 8 个模拟机构路径；多成员模式按所选机构和成员数生成相关路径、强度与气压离散。</p>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex justify-between gap-3 text-xs mb-2">
                <span className="text-slate-400 truncate">{ensembleProgressStage}</span>
                <span className="font-mono font-bold text-violet-300 shrink-0">{Math.round(ensembleProgress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
                <div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 transition-[width] duration-150" style={{ width: `${Math.max(1, ensembleProgress)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>已完成 {ensembleCompletedCount} / {ensembleTargetCount}</span>
                <span>剩余 {Math.max(0, ensembleTargetCount - ensembleCompletedCount)}</span>
              </div>
            </div>
            <button onClick={cancelEnsembleSimulation} className="mt-5 w-full py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15 text-xs font-bold flex items-center justify-center gap-2">
              <Square className="w-3.5 h-3.5" />取消集合计算
            </button>
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="fixed inset-0 z-[7900] bg-slate-950/88 backdrop-blur-md flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-2xl border border-sky-500/30 bg-[#0b1420] shadow-2xl p-5 text-slate-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl border border-sky-500/30 bg-sky-500/10 flex items-center justify-center shrink-0">{imageStyle === "ensemble_tracks" ? <RefreshCw className="w-5 h-5 text-sky-300 animate-spin" /> : <CloudRain className="w-5 h-5 text-sky-300" />}</div>
              <div className="min-w-0"><h3 className="font-bold text-base">{generationKind === "video" ? "正在生成预报风场视频" : imageStyle === "synoptic_wind_pressure" ? "正在计算风场气压形势图" : imageStyle === "rain_observed" ? "正在计算实况降水图" : imageStyle === "ensemble_tracks" ? "正在制作集系预报图" : "正在生成图片"}</h3><p className="text-xs text-slate-400 mt-1 leading-relaxed">{generationKind === "video" ? "逐帧重建预报时刻的环境、台风涡旋、ETOPO 地形和边界层流场，并实时编码视频；高精度模式可能需要较长时间。" : imageStyle === "synoptic_wind_pressure" ? "正在重建环境背景场、台风涡旋、地形粗糙度并迭代高阶二维边界层流场；计算可随时取消。" : imageStyle === "rain_observed" ? "高分辨率或较长时间窗需要逐时、逐格积分完整降水机制，计算可能需要较长时间。请尽量保持页面在前台。" : imageStyle === "ensemble_tracks" ? "点击制作图片后会先自动完成集合成员计算，再继续绘制成图。" : "正在输出高分辨率图片，请保持页面在前台。"}</p></div>
            </div>
            <div className="mt-5">
              <div className="flex justify-between text-xs mb-2"><span className="text-slate-400">{generationStatus && imageStyle === "standard" ? generationStatus : generationKind === "video" ? (generationStatus || "正在计算视频帧") : imageStyle === "synoptic_wind_pressure" ? (generationProgress < 8 ? "准备地形与粗糙度" : generationProgress < 30 ? "环境背景场" : generationProgress < 55 ? "涡旋叠加" : generationProgress < 82 ? "高阶边界层求解迭代" : generationProgress < 96 ? "绘制色块 / 等压线 / 标注" : "编码高清 PNG") : imageStyle === "rain_observed" ? (generationProgress < 10 ? "准备海陆与地形场" : generationProgress < 80 ? "积分历史降水机制" : generationProgress < 96 ? "绘制降水与地图要素" : "编码高清 PNG") : imageStyle === "ensemble_tracks" ? (generationProgress < 72 ? "自动计算集合成员" : generationProgress < 96 ? "绘制集系预报图" : "编码高清 PNG") : (generationProgress < 92 ? "绘制图片要素" : "编码高清 PNG")}</span><span className="font-mono font-bold text-sky-300">{Math.round(generationProgress)}%</span></div>
              <div className="h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800"><div className="h-full bg-sky-500 transition-[width] duration-150" style={{ width: `${Math.max(2, generationProgress)}%` }} /></div>
            </div>
            <button onClick={handleStopGeneration} className="mt-5 w-full py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15 text-xs font-bold flex items-center justify-center gap-2"><Square className="w-3.5 h-3.5" />终止计算</button>
          </div>
        </div>
      )}

      {previewDataUrl && (
        <div className="icwc-preview-backdrop fixed inset-0 z-[6000] flex items-center justify-center bg-black/90 p-4">
          <div className="icwc-preview-modal bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-7xl max-h-full flex flex-col shadow-2xl relative">
            <button 
              onClick={() => clearPreview()}
              className="absolute top-2 right-2 p-2 bg-slate-800 rounded-full text-slate-300 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 overflow-auto bg-black/50 rounded-lg p-2 min-h-0 flex items-center justify-center">
              <img src={previewDataUrl} alt="Preview" className="max-w-full max-h-[80vh] object-contain rounded" />
            </div>
            <div className="mt-4 flex flex-wrap gap-3 justify-end items-center">
              <p className="text-sm text-slate-400 self-center mr-auto">{imageStyle === "standard" && nmcRenderedSize ? `实际输出 ${nmcRenderedSize}；` : ""}提示：长按图片也可保存到相册</p>
              <button 
                onClick={() => clearPreview()}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition"
              >
                取消
              </button>
              <button 
                onClick={handleDownloadActual}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold flex items-center gap-1.5 text-sm transition shadow-md"
              >
                <Download className="w-4 h-4" />
                下载成品
              </button>
            </div>
          </div>
        </div>
      )}
      <AircraftReconModal
        isOpen={showAircraftRecon}
        onClose={() => setShowAircraftRecon(false)}
        typhoon={typhoon}
        currentHour={currentHour}
        startDate={startDate}
        config={config}
        initialMode="report"
      />
      {renderRankingsPopup()}
      <CloudCompositorModal
        isOpen={showCloudCompositor}
        onClose={() => setShowCloudCompositor(false)}
        targetLat={Number(cloudCompositorTargetState.lat ?? typhoon.lat)}
        targetLon={Number(cloudCompositorTargetState.lon ?? typhoon.lon)}
        initialDate={cloudCompositorDate}
      />
    </div>
  );
}
