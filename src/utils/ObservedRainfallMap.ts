/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * High-resolution simulated observed accumulated-rainfall analysis product.
 * The layout intentionally follows the restrained operational style of Chinese
 * regional precipitation products, while retaining clear TyphoonSIM / simulated
 * data labelling so it cannot be mistaken for an official CMA/NMC product.
 */

import { SimulationConfig, Typhoon, TyphoonState } from "../types";
import { computeTyphoonPrecipitation } from "../simulation/PrecipitationModel";
import { getProceduralElevation } from "../simulation/Engine";
import { buildWeightedRainSnapshots, type WeightedRainSnapshot } from "./RainfallTimeWindow";
import {
  checkPointOnLandGeoJson,
  productCountriesGeoJson as countriesGeoJson,
  productLandGeoJson as landGeoJson,
  loadProductNaturalEarthData
} from "../simulation/NaturalEarthLoader";
import { strokeProductCoastlineRing } from "./ProductCoastlineDrawing";
import { loadAgencyBranding } from "./AgencyBranding";

export type RainfallAspectRatio = "4:3" | "16:9" | "3:2" | "1:1" | "3:4";
export type RainfallLegendStyle = "green_reference" | "extreme_reference" | "combined_overlay";
export type RainfallMapPalette = "palette1" | "palette2";

export interface ObservedRainfallMapOptions {
  canvas: HTMLCanvasElement;
  typhoon: Typhoon;
  currentHour: number;
  startDate: Date;
  config?: SimulationConfig;
  typhoonName: string;
  typhoonNumber?: string;
  windowHours: number;
  aspectRatio: RainfallAspectRatio;
  /** Auto follows the simulated swath; China fixes the product to a China-wide operational frame. */
  domainMode?: "auto" | "china";
  /** Draw a simple black best-track polyline over the accumulated-rain analysis. */
  showTrackOverlay?: boolean;
  /** Changes the title and relaxes the normal regional span cap for whole-life accumulation. */
  fullTrackProduct?: boolean;
  legendStyle?: RainfallLegendStyle;
  /** Rainfall raster palette is independent from the legend layout. */
  mapPalette?: RainfallMapPalette;
  outputWidth: number;
  onProgress?: (value: number) => void;
  /** Cooperative cancellation. Checked at every event-loop yield and inside heavy raster loops. */
  signal?: AbortSignal;
}

type WeightedSnapshot = WeightedRainSnapshot;

type RainBand = {
  min: number;
  max: number;
  color: string;
  label: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const aspectValue = (ratio: RainfallAspectRatio): number => {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
};

const formatBeijingTime = (date: Date): string => {
  // Simulation startDate is already used throughout the app as the simulation wall clock.
  // The report follows the reference-product convention and labels the display as Beijing time.
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  return `${y}年${m}月${d}日${hh}时`;
};

const formatIssueTime = (date: Date): string => {
  return `${date.getMonth() + 1}月${date.getDate()}日${String(date.getHours()).padStart(2, "0")}时制作`;
};

const meanPositiveRadius = (quad: any): number => {
  if (!quad) return 0;
  const vals = [quad.ne, quad.se, quad.sw, quad.nw].filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

function unwrapLon(lon: number, refLon: number): number {
  let x = lon;
  while (x - refLon > 180) x -= 360;
  while (x - refLon < -180) x += 360;
  return x;
}

function computeDomain(snapshots: WeightedSnapshot[], mapAspect: number, domainMode: "auto" | "china" = "auto", allowWide = false): {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  refLon: number;
} {
  if (domainMode === "china") {
    // Full-track China products should frame the affected rain swath, not the entire country.
    // Use storm snapshots capable of contributing rain over/near China and expand by an
    // operational heavy-rain footprint. The physical accumulation still decides the actual
    // 25-mm contour; this pre-frame merely avoids wasting most of the page on unaffected regions.
    const relevant = snapshots.filter(({ state }) => state.lat >= 12 && state.lat <= 58 && state.lon >= 68 && state.lon <= 142);
    if (relevant.length) {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const { state } of relevant) {
        const windRadiusKm = Math.max(110, meanPositiveRadius((state as any).r7), Number((state as any).rmw || 25) * 3.2);
        // Heavy rain is normally much more compact than the full cloud shield.
        const rainRadiusKm = Math.min(430, Math.max(150, windRadiusKm * .72));
        const dLat = rainRadiusKm / 111.12;
        const dLon = dLat / Math.max(.38, Math.cos(Number(state.lat) * Math.PI / 180));
        minLon = Math.min(minLon, Number(state.lon) - dLon); maxLon = Math.max(maxLon, Number(state.lon) + dLon);
        minLat = Math.min(minLat, Number(state.lat) - dLat); maxLat = Math.max(maxLat, Number(state.lat) + dLat);
      }
      minLon = clamp(minLon - 1.0, 72, 138.5); maxLon = clamp(maxLon + 1.0, 72, 138.5);
      minLat = clamp(minLat - .8, 14, 55.5); maxLat = clamp(maxLat + .8, 14, 55.5);
      // If the storm only clips China, keep a useful minimum report frame around the affected swath.
      if (maxLon - minLon < 9) { const c=(minLon+maxLon)/2; minLon=clamp(c-4.5,72,129.5); maxLon=clamp(c+4.5,81,138.5); }
      if (maxLat - minLat < 7) { const c=(minLat+maxLat)/2; minLat=clamp(c-3.5,14,48.5); maxLat=clamp(c+3.5,21,55.5); }
      // This renderer uses a linear lon/lat projection.  Do the framing in the same degree-space
      // geometry: applying an extra cos(latitude) correction here widened the longitude domain a
      // second time and made China (including HK/Macao/Taiwan) look horizontally compressed.
      const latSpan=maxLat-minLat,lonSpan=maxLon-minLon,wantLon=mapAspect*latSpan;
      if(wantLon>lonSpan){const add=Math.min(18,wantLon-lonSpan)/2;minLon=clamp(minLon-add,72,138.5);maxLon=clamp(maxLon+add,72,138.5);}
      else {
        const wantLat = lonSpan / Math.max(0.1, mapAspect);
        if (wantLat > latSpan) {
          const addLat = Math.min(12, wantLat - latSpan) / 2;
          minLat = clamp(minLat - addLat, 14, 55.5);
          maxLat = clamp(maxLat + addLat, 14, 55.5);
        }
      }
      const refLon=(minLon+maxLon)/2;
      return { minLon, maxLon, minLat, maxLat, refLon };
    }
    // Fallback for a track with no China-sector samples.
    return { minLon: 72, maxLon: 137.5, minLat: 14, maxLat: 55.5, refLon: 104.75 };
  }

  const firstLon = snapshots[0]?.state.lon ?? 125;
  const lons = snapshots.map((x) => unwrapLon(x.state.lon, firstLon));
  const lats = snapshots.map((x) => x.state.lat);
  const refLon = lons.reduce((a, b) => a + b, 0) / Math.max(1, lons.length);
  const meanLat = lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length);

  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);

  // 2.6.7: rainfall products should frame the actual storm/rain swath rather than the full
  // synoptic wind envelope plus a 250-km padding.  The old rule routinely zoomed too far out.
  const maxWindRadiusKm = Math.max(
    285,
    ...snapshots.map((x) => Math.max(meanPositiveRadius(x.state.r7), 0) + 165 + 48 * Math.min(2.5, x.state.circulationExpansion ?? 0))
  );
  const marginLat = clamp(maxWindRadiusKm / 111.12, 3.25, 7.2);
  const cosLat = Math.max(0.42, Math.cos((meanLat * Math.PI) / 180));
  const marginLon = marginLat / cosLat;

  minLat -= marginLat;
  maxLat += marginLat;
  minLon -= marginLon;
  maxLon += marginLon;

  // Keep enough context to resemble an operational regional rainfall map.
  const minLatSpan = 10.0;
  const minLonSpan = 13.0;
  if (maxLat - minLat < minLatSpan) {
    const c = (minLat + maxLat) / 2;
    minLat = c - minLatSpan / 2;
    maxLat = c + minLatSpan / 2;
  }
  if (maxLon - minLon < minLonSpan) {
    const c = (minLon + maxLon) / 2;
    minLon = c - minLonSpan / 2;
    maxLon = c + minLonSpan / 2;
  }

  // Match physical map aspect (1 degree lon shrinks with latitude).
  let latSpan = maxLat - minLat;
  let lonSpan = maxLon - minLon;
  const desiredLonSpan = mapAspect * latSpan / cosLat;
  if (lonSpan < desiredLonSpan) {
    const c = (minLon + maxLon) / 2;
    lonSpan = desiredLonSpan;
    minLon = c - lonSpan / 2;
    maxLon = c + lonSpan / 2;
  } else {
    const desiredLatSpan = lonSpan * cosLat / mapAspect;
    if (latSpan < desiredLatSpan) {
      const c = (minLat + maxLat) / 2;
      latSpan = desiredLatSpan;
      minLat = c - latSpan / 2;
      maxLat = c + latSpan / 2;
    }
  }

  // Broad sanity bounds while still supporting Guam / the Philippine Sea.
  const maxLatSpan = allowWide ? 64 : 42;
  const maxLonSpan = allowWide ? 92 : 58;
  if (maxLat - minLat > maxLatSpan) {
    const c = (minLat + maxLat) / 2;
    minLat = c - maxLatSpan / 2;
    maxLat = c + maxLatSpan / 2;
  }
  if (maxLon - minLon > maxLonSpan) {
    const c = (minLon + maxLon) / 2;
    minLon = c - maxLonSpan / 2;
    maxLon = c + maxLonSpan / 2;
  }

  return { minLon, maxLon, minLat, maxLat, refLon };
}

function smoothField(values: Float32Array, cols: number, rows: number, landMask?: Uint8Array): Float32Array {
  const sample = (arr: Float32Array, x: number, y: number, fallback: number) => {
    const xx = Math.max(0, Math.min(cols - 1, x));
    const yy = Math.max(0, Math.min(rows - 1, y));
    const ii = yy * cols + xx;
    if (landMask && landMask[ii] !== 1) return fallback;
    return arr[ii];
  };
  const blurHorizontal = (input: Float32Array) => {
    const out = new Float32Array(input.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (landMask && landMask[i] !== 1) { out[i] = 0; continue; }
        const c = input[i];
        out[i] = 0.25 * sample(input, x - 1, y, c) + 0.50 * c + 0.25 * sample(input, x + 1, y, c);
      }
    }
    return out;
  };
  const blurVertical = (input: Float32Array) => {
    const out = new Float32Array(input.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (landMask && landMask[i] !== 1) { out[i] = 0; continue; }
        const c = input[i];
        out[i] = 0.25 * sample(input, x, y - 1, c) + 0.50 * c + 0.25 * sample(input, x, y + 1, c);
      }
    }
    return out;
  };

  // Operational analyses are smooth at the grid scale but retain large irregular lobes.
  // Two full blur passes rounded the 25/50/100-mm boundaries too strongly. One restrained
  // separable pass removes cell noise while preserving mesoscale shoulders, notches and tongues.
  const smooth = blurVertical(blurHorizontal(values));
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (landMask && landMask[i] !== 1) { out[i] = 0; continue; }
    const raw = values[i];
    // 2.4.10: low/mid classes carry the large-scale landfall topology (moisture corridors,
    // coastline-fed lobes and dry notches). Too much blur re-rounds those physically generated
    // shapes into smooth arcs. Keep enough raw mesoscale structure at 0-100 mm while still
    // removing grid-scale stair steps; high totals remain comparatively smooth/compact.
    // Keep extreme orographic maxima spatially compact. High-end classes should not be spread
    // into neighbouring cells by display smoothing; lower classes still receive the same gentle
    // contour smoothing as before.
    // 3.7.2: display smoothing must not know about legend-class thresholds. A class-aware
    // 250/400/600-mm retention rule created visible plateaus at exactly the colour breaks. Blend
    // continuously by magnitude instead, so contours are a consequence of the physical field.
    // 3.7.4: preserve more of the already-diagnosed mesoscale shape at moderate/high totals.
    // The earlier blend re-rounded irregular lobes after the physical field had been localized.
    const rawWeight = Math.max(0.38, Math.min(0.88,
      0.38 + 0.52 * (1 - Math.exp(-Math.max(0, raw) / 240))
    ));
    const blended = rawWeight * raw + (1 - rawWeight) * smooth[i];
    out[i] = blended;
  }
  return out;
}

/**
 * Render-only shoreline extension. The physical precipitation field remains land-only and at the
 * original grid resolution. We copy the nearest coastal-land values one/two grid cells seaward
 * solely for interpolation, then clip the final raster against the vector land polygon. This avoids
 * bilinear dilution by ocean zeros and makes the fill meet the coastline cleanly without increasing
 * model resolution or creating any marine rainfall in the product/statistics.
 */
function buildLandSurfaceDiagnostics(
  elevation: Float32Array,
  landMask: Uint8Array,
  cols: number,
  rows: number,
  cellKmEast: number,
  cellKmNorth: number
): {
  coastDistanceKm: Float32Array;
  terrainSlopeEast: Float32Array;
  terrainSlopeNorth: Float32Array;
  coastInlandUnitEast: Float32Array;
  coastInlandUnitNorth: Float32Array;
  terrainLocalRelief: Float32Array;
  terrainRidgeExposure: Float32Array;
  terrainOrographicBreadth: Float32Array;
} {
  const coastDistanceKm = new Float32Array(elevation.length);
  const terrainSlopeEast = new Float32Array(elevation.length);
  const terrainSlopeNorth = new Float32Array(elevation.length);
  const coastInlandUnitEast = new Float32Array(elevation.length);
  const coastInlandUnitNorth = new Float32Array(elevation.length);
  const terrainLocalRelief = new Float32Array(elevation.length);
  const terrainRidgeExposure = new Float32Array(elevation.length);
  const terrainOrographicBreadth = new Float32Array(elevation.length);
  const inf = 1e7;
  const diag = Math.hypot(cellKmEast, cellKmNorth);

  // Chamfer distance transform from ocean to inland grid cells. This gives the rainfall model a
  // physically useful coastal-convergence length scale without any additional web/geodata request.
  for (let i = 0; i < coastDistanceKm.length; i++) coastDistanceKm[i] = landMask[i] === 1 ? inf : 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (landMask[i] !== 1) continue;
      let d = coastDistanceKm[i];
      if (x > 0) d = Math.min(d, coastDistanceKm[i - 1] + cellKmEast);
      if (y > 0) d = Math.min(d, coastDistanceKm[i - cols] + cellKmNorth);
      if (x > 0 && y > 0) d = Math.min(d, coastDistanceKm[i - cols - 1] + diag);
      if (x + 1 < cols && y > 0) d = Math.min(d, coastDistanceKm[i - cols + 1] + diag);
      coastDistanceKm[i] = d;
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (landMask[i] !== 1) continue;
      let d = coastDistanceKm[i];
      if (x + 1 < cols) d = Math.min(d, coastDistanceKm[i + 1] + cellKmEast);
      if (y + 1 < rows) d = Math.min(d, coastDistanceKm[i + cols] + cellKmNorth);
      if (x + 1 < cols && y + 1 < rows) d = Math.min(d, coastDistanceKm[i + cols + 1] + diag);
      if (x > 0 && y + 1 < rows) d = Math.min(d, coastDistanceKm[i + cols - 1] + diag);
      coastDistanceKm[i] = Math.min(600, d);
    }
  }

  // 3.3.20: inland coastline normals from the gradient of the ocean-distance transform. Distance
  // increases inland, so its gradient points from sea toward land. This lets the precipitation
  // model require *resolved onshore moist flow* before applying a roughness-convergence boost;
  // merely being close to a coast is no longer sufficient.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (landMask[i] !== 1) continue;
      const west = x > 0 ? coastDistanceKm[i - 1] : coastDistanceKm[i];
      const east = x + 1 < cols ? coastDistanceKm[i + 1] : coastDistanceKm[i];
      const north = y > 0 ? coastDistanceKm[i - cols] : coastDistanceKm[i];
      const south = y + 1 < rows ? coastDistanceKm[i + cols] : coastDistanceKm[i];
      const gradEast = (east - west) / Math.max(1, 2 * cellKmEast);
      const gradNorth = (north - south) / Math.max(1, 2 * cellKmNorth);
      const norm = Math.hypot(gradEast, gradNorth);
      if (norm > 1e-4) {
        coastInlandUnitEast[i] = gradEast / norm;
        coastInlandUnitNorth[i] = gradNorth / norm;
      }
    }
  }

  // Terrain-gradient diagnostics. Ocean neighbours are excluded so the coastline itself does not
  // become a fake cliff; one-sided differences are used at the edge of an island/mountain range.
  // Proxy ETOPO spacing is 0.25°, so a tiny output pixel difference measures
  // resampling edges, not real terrain. Estimate gradients across >=0.5° each side.
  const TERRAIN_GRADIENT_BASELINE_KM = 55.6;
  const MAX_TERRAIN_SLOPE_M_PER_KM = 34;
  const slopeAxis = (i: number, x: number, y: number, alongX: boolean): number => {
    const stepKm = alongX ? cellKmEast : cellKmNorth;
    const step = Math.max(1, Math.ceil(TERRAIN_GRADIENT_BASELINE_KM / Math.max(1, stepKm)));
    const sample = (sgn: number): {h:number; dist:number} | null => {
      for (let offset=step; offset>=1; offset--) {
        const xx = alongX ? x + offset*sgn : x;
        const yy = alongX ? y : y + offset*sgn;
        if(xx>=0 && xx<cols && yy>=0 && yy<rows && landMask[yy*cols+xx]===1)
          return {h:elevation[yy*cols+xx],dist:offset*stepKm};
      }
      return null;
    };
    const westOrSouth=sample(-1), eastOrNorth=sample(1);
    const raw = westOrSouth && eastOrNorth ?
      (eastOrNorth.h-westOrSouth.h)/(eastOrNorth.dist+westOrSouth.dist) :
      eastOrNorth ? (eastOrNorth.h-elevation[i])/eastOrNorth.dist :
      westOrSouth ? (elevation[i]-westOrSouth.h)/westOrSouth.dist : 0;
    return Math.max(-MAX_TERRAIN_SLOPE_M_PER_KM, Math.min(MAX_TERRAIN_SLOPE_M_PER_KM, raw));
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (landMask[i] !== 1) continue;
      terrainSlopeEast[i] = slopeAxis(i, x, y, true);
      terrainSlopeNorth[i] = -slopeAxis(i, x, y, false);

      // 3.3.12: diagnose compact ridge/peak exposure from the already sampled terrain grid.
      // This is deliberately local (roughly a 3-5 cell neighbourhood) so a broad coastal hill
      // belt does not receive the same extreme-rain permission as a focused windward ridge.
      // It adds no new terrain source and avoids expensive extra ETOPO lookups during map export.
      let minH = elevation[i];
      let maxH = elevation[i];
      let sumH = 0;
      let countH = 0;
      let validNeighbourCells = 0;
      let elevatedNeighbourCells = 0;
      let windowCells = 0;
      let rowCells = 0, rowLandCells = 0, rowElevatedCells = 0;
      let colCells = 0, colLandCells = 0, colElevatedCells = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          windowCells++;
          if (dy === 0) rowCells++;
          if (dx === 0) colCells++;
          const ni = yy * cols + xx;
          if (landMask[ni] !== 1) continue;
          validNeighbourCells++;
          if (dy === 0) rowLandCells++;
          if (dx === 0) colLandCells++;
          const h = elevation[ni];
          if (h >= 180) {
            elevatedNeighbourCells++;
            if (dy === 0) rowElevatedCells++;
            if (dx === 0) colElevatedCells++;
          }
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
          sumH += h;
          countH++;
        }
      }
      const meanH = countH > 0 ? sumH / countH : elevation[i];
      const relief = Math.max(0, maxH - minH);
      const ridgeAnomaly = elevation[i] - meanH;
      terrainLocalRelief[i] = relief;
      terrainRidgeExposure[i] = Math.max(0, Math.min(1,
        Math.max(0, (ridgeAnomaly - 20) / 260) * Math.max(0, Math.min(1, (relief - 70) / 650))
      ));

      // 3.3.15: distinguish a two-dimensional mountain/hill mass from a one-cell-wide peninsula
      // or coastal filament. The old extreme-rain retention could chain several narrow coastal
      // land cells into an artificial high-rain corridor (the Yuhuan-like artefact) because every
      // cell independently looked like a persistent windward slope. True orographic training needs
      // a finite terrain footprint upwind/crosswind, not merely a thin shoreline strip.
      const landNeighbourFraction = windowCells > 0 ? validNeighbourCells / windowCells : 0;
      const elevatedNeighbourFraction = validNeighbourCells > 0 ? elevatedNeighbourCells / validNeighbourCells : 0;
      const breadthFromLandMass = Math.max(0, Math.min(1, (landNeighbourFraction - 0.28) / 0.52));
      const breadthFromTerrainMass = Math.max(0, Math.min(1, (elevatedNeighbourFraction - 0.10) / 0.58));
      // A peninsula can look broad in a 5x5 occupancy average if the mainland sits only a cell or
      // two away. Require support in *both* grid axes as well. This is a geometry diagnostic, not a
      // Yuhuan/location special case: an elongated but genuinely wide mountain range still scores,
      // while a one-cell coastal finger does not inherit a ridge-wide training permission.
      const rowLandFraction = rowCells > 0 ? rowLandCells / rowCells : 0;
      const colLandFraction = colCells > 0 ? colLandCells / colCells : 0;
      const rowElevatedFraction = rowCells > 0 ? rowElevatedCells / rowCells : 0;
      const colElevatedFraction = colCells > 0 ? colElevatedCells / colCells : 0;
      const crossAxisLandSupport = Math.min(rowLandFraction, colLandFraction);
      const crossAxisTerrainSupport = Math.min(rowElevatedFraction, colElevatedFraction);
      const breadthFromCrossAxis = Math.max(0, Math.min(1,
        0.70 * Math.max(0, (crossAxisLandSupport - 0.26) / 0.54) +
        0.30 * Math.max(0, (crossAxisTerrainSupport - 0.08) / 0.48)
      ));
      let diagnosedBreadth = Math.max(0, Math.min(1,
        0.42 * breadthFromLandMass + 0.24 * breadthFromTerrainMass + 0.34 * breadthFromCrossAxis
      ));
      if (Math.min(rowLandCells, colLandCells) <= 2) diagnosedBreadth *= 0.58;
      terrainOrographicBreadth[i] = diagnosedBreadth;
    }
  }
  return { coastDistanceKm, terrainSlopeEast, terrainSlopeNorth, coastInlandUnitEast, coastInlandUnitNorth, terrainLocalRelief, terrainRidgeExposure, terrainOrographicBreadth };
}

function buildCoastalRenderField(values: Float32Array, cols: number, rows: number, landMask: Uint8Array): Float32Array {
  let work = new Float32Array(values);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(work);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (landMask[i] === 1 || work[i] > 0) continue;
        let sum = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= cols || yy < 0 || yy >= rows) continue;
            const j = yy * cols + xx;
            const v = work[j];
            if (v <= 0) continue;
            // First pass is anchored to actual land; second pass may extend that coastal value
            // another cell so interpolation kernels never see an immediate ocean zero.
            if (pass === 0 && landMask[j] !== 1) continue;
            const w = (dx === 0 || dy === 0) ? 1 : 0.70;
            sum += v * w; weight += w;
          }
        }
        if (weight > 0) next[i] = sum / weight;
      }
    }
    work = next;
  }
  return work;
}

function rainfallBands(_windowHours: number, _maxRain: number, style: RainfallLegendStyle): RainBand[] {
  // Visualization-only palettes requested by the user. The precipitation accumulation engine,
  // integration window and scalar field are unchanged; only categorical legend/color rendering differs.
  if (style === "extreme_reference") {
    return [
      { min: 25, max: 50, color: "#71c7e7", label: "大雨（25–49.9毫米）" },
      { min: 50, max: 100, color: "#1712f4", label: "暴雨（50–99.9毫米）" },
      { min: 100, max: 250, color: "#ef00e8", label: "大暴雨（100–249.9毫米）" },
      { min: 250, max: 400, color: "#85003b", label: "特大暴雨（250–399.9毫米）" },
      { min: 400, max: 600, color: "#ffa000", label: "特大暴雨（400–599.9毫米）" },
      { min: 600, max: Infinity, color: "#d18500", label: "特大暴雨（600毫米以上）" },
    ];
  }
  if (style === "combined_overlay") {
    // True overlay requested in 3.3.7: 0-250 mm uses legend/palette ①, while values above
    // 250 mm switch to the high-end colours of legend/palette ②.
    return [
      { min: 0.1, max: 10, color: "#9bed82", label: "0～10" },
      { min: 10, max: 25, color: "#34c23a", label: "10～25" },
      { min: 25, max: 50, color: "#5aaee6", label: "25～50" },
      { min: 50, max: 100, color: "#1712f4", label: "50～100" },
      { min: 100, max: 250, color: "#f000ec", label: "100～250" },
      { min: 250, max: 400, color: "#85003b", label: "250～400" },
      { min: 400, max: 600, color: "#ffa000", label: "400～600" },
      { min: 600, max: 800, color: "#d18500", label: "600～800" },
      { min: 800, max: Infinity, color: "#d18500", label: "≥800" },
    ];
  }
  return [
    { min: 0.1, max: 10, color: "#9bed82", label: "0～10" },
    { min: 10, max: 25, color: "#34c23a", label: "10～25" },
    { min: 25, max: 50, color: "#5aaee6", label: "25～50" },
    { min: 50, max: 100, color: "#1712f4", label: "50～100" },
    { min: 100, max: 250, color: "#f000ec", label: "100～250" },
    { min: 250, max: Infinity, color: "#8c003a", label: "≥250" },
  ];
}

function colorForRain(v: number, bands: RainBand[]): string | null {
  for (const b of bands) {
    if (v >= b.min && v < b.max) return b.color;
  }
  return null;
}


async function drawRainClassContours(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  cols: number,
  rows: number,
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number,
  thresholds: Array<{ value: number; color: string }>,
  lineWidth: number,
  checkpoint?: () => Promise<void>,
) {
  if (cols < 2 || rows < 2) return;
  const px = (gx: number) => mapX + ((gx + 0.5) / cols) * mapW;
  const py = (gy: number) => mapY + ((gy + 0.5) / rows) * mapH;
  const edgePoint = (gx: number, gy: number, edge: number, t: number, v0: number, v1: number, v2: number, v3: number) => {
    const interp = (a: number, b: number) => Math.max(0, Math.min(1, Math.abs(b - a) < 1e-6 ? 0.5 : (t - a) / (b - a)));
    if (edge === 0) { const u = interp(v0, v1); return { x: px(gx + u), y: py(gy) }; }
    if (edge === 1) { const u = interp(v1, v2); return { x: px(gx + 1), y: py(gy + u) }; }
    if (edge === 2) { const u = interp(v3, v2); return { x: px(gx + u), y: py(gy + 1) }; }
    const u = interp(v0, v3); return { x: px(gx), y: py(gy + u) };
  };
  const simple: Record<number, number[][]> = {
    1: [[3,0]], 2: [[0,1]], 3: [[3,1]], 4: [[1,2]],
    6: [[0,2]], 7: [[3,2]], 8: [[2,3]], 9: [[0,2]],
    11: [[1,2]], 12: [[1,3]], 13: [[0,1]], 14: [[3,0]],
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineWidth;
  // A large number of unreachable legend levels used to march the full grid anyway.
  let maxField=-Infinity,minField=Infinity;
  for(let i=0;i<field.length;i++) {const v=field[i];if(v>maxField)maxField=v;if(v<minField)minField=v;}
  let lastContourYieldAt = performance.now();
  for (const threshold of thresholds) {
    if (threshold.value>maxField || threshold.value<=minField) continue;
    if (checkpoint) await checkpoint();
    lastContourYieldAt = performance.now();
    ctx.strokeStyle = threshold.color;
    ctx.beginPath();
    for (let gy = 0; gy < rows - 1; gy++) {
      // Time-budgeted yields preserve every marching-squares cell while avoiding many
      // redundant event-loop turns for small/fast contour rows.
      if (checkpoint && (gy & 15) === 0 && performance.now() - lastContourYieldAt >= 11) {
        await checkpoint();
        lastContourYieldAt = performance.now();
      }
      for (let gx = 0; gx < cols - 1; gx++) {
        const v0 = field[gy * cols + gx];
        const v1 = field[gy * cols + gx + 1];
        const v2 = field[(gy + 1) * cols + gx + 1];
        const v3 = field[(gy + 1) * cols + gx];
        const code = (v0 >= threshold.value ? 1 : 0) | (v1 >= threshold.value ? 2 : 0) | (v2 >= threshold.value ? 4 : 0) | (v3 >= threshold.value ? 8 : 0);
        if (code === 0 || code === 15) continue;
        let segments = simple[code];
        if (code === 5 || code === 10) {
          const centreHigh = (v0 + v1 + v2 + v3) * 0.25 >= threshold.value;
          if (code === 5) segments = centreHigh ? [[3,2],[0,1]] : [[3,0],[1,2]];
          else segments = centreHigh ? [[3,0],[1,2]] : [[0,1],[2,3]];
        }
        for (const [a,b] of segments || []) {
          const p0 = edgePoint(gx, gy, a, threshold.value, v0, v1, v2, v3);
          const p1 = edgePoint(gx, gy, b, threshold.value, v0, v1, v2, v3);
          ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTyphoonMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.strokeStyle = "#287bb9";
  ctx.lineWidth = Math.max(2, radius * 0.10);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, radius * 0.16);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx - sign * radius * 0.10, cy - sign * radius * 0.04, radius * 0.52, sign > 0 ? 0.28 : Math.PI + 0.28, sign > 0 ? 2.30 : Math.PI + 2.30);
    ctx.stroke();
  }
  ctx.fillStyle = "#287bb9";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ringIntersectsDomain(
  ring: number[][],
  refLon: number,
  domain?: { minLon: number; maxLon: number; minLat: number; maxLat: number }
): boolean {
  if (!domain || !ring?.length) return true;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  let prevLon: number | null = null;
  for (const coord of ring) {
    if (!coord || coord.length < 2) continue;
    let lon = unwrapLon(coord[0], refLon);
    if (prevLon !== null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, coord[1]); maxLat = Math.max(maxLat, coord[1]);
  }
  const pad = 3;
  return maxLon >= domain.minLon - pad && minLon <= domain.maxLon + pad &&
    maxLat >= domain.minLat - pad && minLat <= domain.maxLat + pad;
}

function appendGeoJsonRing(
  target: CanvasRenderingContext2D | Path2D,
  ring: number[][],
  project: (lat: number, lon: number) => { x: number; y: number },
  refLon: number
): boolean {
  let started = false;
  let prevLon: number | null = null;
  for (const coord of ring) {
    if (!coord || coord.length < 2) continue;
    let lon = unwrapLon(coord[0], refLon);
    if (prevLon !== null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    const p = project(coord[1], lon);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (!started) { target.moveTo(p.x, p.y); started = true; }
    else target.lineTo(p.x, p.y);
  }
  if (started) target.closePath();
  return started;
}

function drawGeoJson(
  ctx: CanvasRenderingContext2D,
  geo: any,
  project: (lat: number, lon: number) => { x: number; y: number },
  refLon: number,
  fill: string | null,
  stroke: string | null,
  lineWidth: number,
  domain?: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  suppressProductSeams = false
) {
  if (!geo?.features) return;
  ctx.save();
  if (fill) ctx.fillStyle = fill;
  if (stroke) ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const drawPolygon = (rings: number[][][]) => {
    const visible = (rings || []).filter((ring) => ringIntersectsDomain(ring, refLon, domain));
    if (!visible.length) return;
    ctx.beginPath();
    let any = false;
    for (const ring of visible) any = appendGeoJsonRing(ctx, ring, project, refLon) || any;
    if (!any) return;
    // Fill the polygon and its holes together.  Filling each ring independently was harmless on
    // small automatic domains but could turn lakes/holes and wrapped world polygons into large
    // false land patches on the fixed China frame.
    if (fill) ctx.fill("evenodd");
    if (stroke) {
      if (!suppressProductSeams) ctx.stroke();
      else for (const ring of visible) {
        strokeProductCoastlineRing(ctx, ring, (lat, lon) => project(lat, unwrapLon(lon, refLon)));
      }
    }
  };

  for (const feature of geo.features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") drawPolygon(geom.coordinates || []);
    else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates || []) drawPolygon(poly || []);
  }
  ctx.restore();
}

function buildGeoJsonPath(
  geo: any,
  project: (lat: number, lon: number) => { x: number; y: number },
  refLon: number,
  domain?: { minLon: number; maxLon: number; minLat: number; maxLat: number }
): Path2D {
  const path = new Path2D();
  for (const feature of geo?.features || []) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const polygons = geom.type === "Polygon" ? [geom.coordinates || []] : geom.type === "MultiPolygon" ? (geom.coordinates || []) : [];
    for (const poly of polygons) {
      for (const ring of poly || []) {
        if (!ringIntersectsDomain(ring, refLon, domain)) continue;
        appendGeoJsonRing(path, ring, project, refLon);
      }
    }
  }
  return path;
}

function niceGridStep(span: number): number {
  if (span <= 14) return 2;
  if (span <= 26) return 5;
  return 10;
}

export async function drawObservedRainfallMap(options: ObservedRainfallMapOptions): Promise<void> {
  const {
    canvas,
    typhoon,
    currentHour,
    startDate,
    config,
    typhoonName,
    typhoonNumber,
    windowHours,
    aspectRatio,
    domainMode = "auto",
    showTrackOverlay = false,
    fullTrackProduct = false,
    legendStyle = "green_reference",
    mapPalette = "palette1",
    outputWidth,
    onProgress,
    signal
  } = options;

  const throwIfCancelled = () => {
    if (signal?.aborted) throw new DOMException("Rainfall generation cancelled", "AbortError");
  };
  const yieldToUi = async () => {
    throwIfCancelled();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    throwIfCancelled();
  };
  const progress = (v: number) => {
    throwIfCancelled();
    onProgress?.(clamp(v, 0, 100));
  };
  progress(2);
  await loadProductNaturalEarthData();
  throwIfCancelled();
  progress(5);

  const ratio = aspectValue(aspectRatio);
  const width = Math.max(1200, Math.round(outputWidth));
  const height = Math.max(900, Math.round(width / ratio));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const S = width / 1920;

  const { snapshots, actualStartHour, actualEndHour, actualWindow } = buildWeightedRainSnapshots(typhoon, currentHour, windowHours);
  const headerH = Math.round(148 * S);
  const outerPad = Math.round(28 * S);
  const bottomPad = Math.round(30 * S);
  const mapX = outerPad;
  const mapY = headerH;
  const mapW = width - outerPad * 2;
  const mapH = height - headerH - bottomPad;
  const domain = computeDomain(snapshots, mapW / mapH, domainMode, fullTrackProduct);

  const project = (lat: number, rawLon: number) => {
    const lon = unwrapLon(rawLon, domain.refLon);
    return {
      x: mapX + ((lon - domain.minLon) / (domain.maxLon - domain.minLon)) * mapW,
      y: mapY + ((domain.maxLat - lat) / (domain.maxLat - domain.minLat)) * mapH
    };
  };

  // Base paper and map frame.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#4b5563";
  ctx.lineWidth = Math.max(1, 1.2 * S);
  ctx.strokeRect(Math.round(5 * S), Math.round(5 * S), width - Math.round(10 * S), height - Math.round(10 * S));

  // Map/raster palette is now independent from the legend layout.
  const useOriginalPaletteBase = mapPalette !== "palette2";
  const baseSea = useOriginalPaletteBase ? "#ffffff" : "#dff1fb";
  const baseLand = useOriginalPaletteBase ? "#d7d7d7" : "#ffecce";
  const baseCoast = useOriginalPaletteBase ? "#606060" : "#9aa0a6";
  ctx.fillStyle = baseSea;
  ctx.fillRect(mapX, mapY, mapW, mapH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(mapX, mapY, mapW, mapH);
  ctx.clip();
  drawGeoJson(ctx, landGeoJson, project, domain.refLon, baseLand, baseCoast, Math.max(0.7, 0.9 * S), domain, true);
  ctx.restore();
  progress(8);

  // Compute a scalar rainfall field at a calculation grid independent of PNG output size.
  // 300-430 columns are enough for smooth operational contours after bilinear up-sampling,
  // while keeping 24/48/72 h products responsive in the browser.
  // Computation resolution is independent of export pixels.  Bilinear colour raster and
  // coast vectors stay full export resolution. Previous 310-430-column physics grids
  // dominated both 24 h and lifetime generation (complex multi-mechanism calls / cell).
  const gridCols = outputWidth >= 7000 ? 370 : outputWidth >= 3800 ? 330 : outputWidth >= 2500 ? 295 : 238;
  const gridRows = Math.max(144, Math.round(gridCols * mapH / mapW));
  const field = new Float32Array(gridCols * gridRows);
  const landMask = new Uint8Array(gridCols * gridRows);
  const elevation = new Float32Array(gridCols * gridRows);

  for (let gy = 0; gy < gridRows; gy++) {
    const lat = domain.maxLat - ((gy + 0.5) / gridRows) * (domain.maxLat - domain.minLat);
    for (let gx = 0; gx < gridCols; gx++) {
      const lon = domain.minLon + ((gx + 0.5) / gridCols) * (domain.maxLon - domain.minLon);
      const idx = gy * gridCols + gx;
      const normalizedLon = ((lon + 540) % 360) - 180;
      const isLand = checkPointOnLandGeoJson(lat, normalizedLon);
      landMask[idx] = isLand ? 1 : 0;
      elevation[idx] = isLand ? getProceduralElevation(lat, normalizedLon) : 0;
    }
    if (gy % 20 === 0) {
      progress(8 + 6 * gy / gridRows);
      await yieldToUi();
    }
  }

  const meanDomainLat = 0.5 * (domain.minLat + domain.maxLat);
  const cellKmEast = Math.max(1, ((domain.maxLon - domain.minLon) / gridCols) * 111.12 * Math.max(0.25, Math.cos(meanDomainLat * Math.PI / 180)));
  const cellKmNorth = Math.max(1, ((domain.maxLat - domain.minLat) / gridRows) * 111.12);
  const {
    coastDistanceKm, terrainSlopeEast, terrainSlopeNorth, coastInlandUnitEast, coastInlandUnitNorth, terrainLocalRelief, terrainRidgeExposure, terrainOrographicBreadth
  } = buildLandSurfaceDiagnostics(
    elevation, landMask, gridCols, gridRows, cellKmEast, cellKmNorth
  );
  // 3.7.2 renderer diagnostics. These arrays deliberately store continuous physical support, not
  // colour-class permissions. They are used only to preserve compact process-supported maxima and
  // to damp broad diffuse accumulation continuously after the hourly model has been integrated.
  // This keeps the display/product layer from feeding 250/400/600-mm legend thresholds back into
  // the rainfall field itself.
  const physicalFocusField = new Float32Array(gridCols * gridRows);
  const broadDiffusePenaltyField = new Float32Array(gridCols * gridRows);
  // 3.7.4: distinguishes a genuinely repeated convective/training maximum from a broad
  // all-day rain shield. This stays continuous and independent of the display colour breaks.
  const sustainedConvectiveSupportField = new Float32Array(gridCols * gridRows);

  // Performance: all values below depend only on a snapshot, not on the map grid point.
  // Precomputing them removes repeated lon unwrapping, landfall sorting, configuration lookup,
  // and state-spread allocation without changing a single physical sample or output threshold.
  const preparedSnapshots = snapshots.map((snap) => {
    const state = snap.state;
    const stateLonUnwrapped = unwrapLon(state.lon, domain.refLon);
    const rainState = stateLonUnwrapped === state.lon ? state : ({ ...state, lon: stateLonUnwrapped } as TyphoonState);
    const snapSimHour = state.simHour || 0;
    let latestLandfall: any = undefined;
    if (state.landfallRecords?.length) {
      for (const rec of state.landfallRecords as any[]) {
        if (rec.simHour <= snapSimHour + 0.05 && (!latestLandfall || rec.simHour > latestLandfall.simHour)) latestLandfall = rec;
      }
    }
    const snapLandfallVmax = latestLandfall?.vmax ?? state.vmax ?? 0;
    const snapLandHours = Math.max(0, state.landHours ?? (state.landed ? 1 : 0));
    const strongLandfallRainMemory = state.landed
      ? Math.max(0, Math.min(1, (snapLandfallVmax - 32.7) / 35)) * Math.exp(-Math.max(0, snapLandHours - 2) / 28)
      : 0;
    return {
      snap, state, rainState, stateLonUnwrapped,
      stateCosLat: Math.max(0.2, Math.cos((state.lat * Math.PI) / 180)),
      stateConfig: (state.configSnapshot || config) as SimulationConfig | undefined,
      snapLandfallVmax, snapLandHours, strongLandfallRainMemory,
      westerlyTailAllowance: 210 * Math.max(0, Math.min(1, state.northeastCloudTailStrength ?? 0)),
      circulationAllowance: 95 * Math.min(2.2, state.circulationExpansion ?? 0)
    };
  });

  // Exact acceleration for long-life accumulation: each snapshot is registered only in coarse
  // spatial tiles that its *maximum possible* influence radius can reach.  The later physical
  // distance rejection is unchanged, so this removes impossible snapshot/cell pairs without
  // changing resolution, thresholds or any precipitation sample.
  const tileDeg = 4.0;
  const tileCols = Math.max(1, Math.ceil((domain.maxLon - domain.minLon) / tileDeg));
  const tileRows = Math.max(1, Math.ceil((domain.maxLat - domain.minLat) / tileDeg));
  const snapshotBuckets: number[][] = Array.from({ length: tileCols * tileRows }, () => []);
  preparedSnapshots.forEach((prepared, snapshotIndex) => {
    const maxInfluence = 790 + 230 + prepared.westerlyTailAllowance + prepared.circulationAllowance;
    const latRadiusDeg = maxInfluence / 111.12 + 0.35;
    const lonRadiusDeg = maxInfluence / (111.12 * prepared.stateCosLat) + 0.35;
    const minTx = Math.max(0, Math.floor((prepared.stateLonUnwrapped - lonRadiusDeg - domain.minLon) / tileDeg));
    const maxTx = Math.min(tileCols - 1, Math.floor((prepared.stateLonUnwrapped + lonRadiusDeg - domain.minLon) / tileDeg));
    const minTy = Math.max(0, Math.floor((domain.maxLat - (prepared.state.lat + latRadiusDeg)) / tileDeg));
    const maxTy = Math.min(tileRows - 1, Math.floor((domain.maxLat - (prepared.state.lat - latRadiusDeg)) / tileDeg));
    if (minTx > maxTx || minTy > maxTy) return;
    for (let ty = minTy; ty <= maxTy; ty++) for (let tx = minTx; tx <= maxTx; tx++) {
      snapshotBuckets[ty * tileCols + tx].push(snapshotIndex);
    }
  });

  let rawMax = 0;
  let rawMaxIndex = 0;
  for (let gy = 0; gy < gridRows; gy++) {
    const lat = domain.maxLat - ((gy + 0.5) / gridRows) * (domain.maxLat - domain.minLat);
    for (let gx = 0; gx < gridCols; gx++) {
      const lonUnwrapped = domain.minLon + ((gx + 0.5) / gridCols) * (domain.maxLon - domain.minLon);
      const lon = ((lonUnwrapped + 540) % 360) - 180;
      const idx = gy * gridCols + gx;
      if (landMask[idx] !== 1) {
        field[idx] = 0;
        continue;
      }
      let total = 0;
      let peakRate = 0;
      let focusedConvectiveHours = 0;
      let organizedHeavyHours = 0;
      // 2.6.6: operational 24-h 50-250 mm areas are often built by several hours of
      // 4-15 mm/h rain, not only by 20-50 mm/h convective peaks. Track that residence
      // separately so a broad but genuinely raining inner shield is not compressed to pale blue.
      let moderateRainHours = 0;
      let organizedMidRainHours = 0;
      let coreRainAccum = 0;
      let bandRainAccum = 0;
      let broadRainAccum = 0;
      let bandHyperAccum = 0;
      let pointExtremeAccum = 0;
      let compactCoreRainAccum = 0;
      let fragmentedCoreRainAccum = 0;
      let fragmentedCoreHeavyHours = 0;
      // 2.6.5: separately remember a Dvorak-intense but dry-air-damaged core. This overlaps the
      // generic core bucket intentionally: it is evidence for *retaining* focused 24-h totals,
      // not a second source of physical rainfall.
      let dryDamagedCoreRainAccum = 0;
      let dryDamagedCoreHeavyHours = 0;
      let westerlyOrganizedRainAccum = 0;
      let westerlyOrganizedHours = 0;
      let terrainAnchoredAccum = 0;
      let terrainAnchoredHours = 0;
      let synopticConvergenceAccum = 0;
      let coastalFrictionAccum = 0;
      let coastalFrictionHours = 0;
      let coastalNodeAccum = 0;
      let coastalNodeHours = 0;
      let detachedOuterBandAccum = 0;
      let detachedOuterBandHours = 0;
      let inlandTrainingAccum = 0;
      let inlandTrainingHours = 0;
      let remoteTerrainAccum = 0;
      let remoteTerrainHours = 0;
      let coherentCoreRainHours = 0;
      let landfallOrganizedHours = 0;
      let landedRainResidenceHours = 0;
      let inlandFocusedRainAccum = 0;
      let maxWindowVmax = 0;
      let maxWindowLandfallVmax = 0;
      let maxWindowRapidCoreSupport = 0;
      let maxWindowCoreOrganization = 0;
      let maxWindowTerrainHollowMemory = 0;
      let maxWindowTerrainBreakupScore = 0;
      let maxWindowTerrainCoreElevation = 0;
      let maxWindowTerrainMountainFraction = 0;
      let hollowSlowTrainingHours = 0;
      let manualTerrainRebuildHours = 0;
      const tileX = Math.max(0, Math.min(tileCols - 1, Math.floor((lonUnwrapped - domain.minLon) / tileDeg)));
      const tileY = Math.max(0, Math.min(tileRows - 1, Math.floor((domain.maxLat - lat) / tileDeg)));
      const candidateSnapshots = snapshotBuckets[tileY * tileCols + tileX];
      for (const preparedIndex of candidateSnapshots) {
        const prepared = preparedSnapshots[preparedIndex];
        const { snap, state, rainState, stateLonUnwrapped, stateCosLat, stateConfig, snapLandfallVmax, snapLandHours, strongLandfallRainMemory } = prepared;
        // Fast distance rejection before invoking the multi-mechanism rain model.
        const dLatKm = (lat - state.lat) * 111.12;
        const dLonKm = (lonUnwrapped - stateLonUnwrapped) * 111.12 * stateCosLat;
        // Avoid a square root for each rejected grid/time pair.
        // Remote TC rainfall can be terrain-locked well outside the compact storm-centred shield.
        // Give mountainous land a wider diagnostic radius so the fast rejection does not erase a
        // Taiwan/coastal-range secondary maximum before the precipitation model can evaluate it.
        const terrainRemoteAllowance = elevation[idx] > 900 ? 230 : elevation[idx] > 300 ? 150 : 55;
        const maxInfluence = 790 + terrainRemoteAllowance + prepared.westerlyTailAllowance + prepared.circulationAllowance;
        if (dLatKm * dLatKm + dLonKm * dLonKm > maxInfluence * maxInfluence) continue;
        const rain = computeTyphoonPrecipitation(rainState as any, lat, lonUnwrapped, {
          config: stateConfig,
          isLand: landMask[idx] === 1,
          elevation: elevation[idx],
          coastDistanceKm: coastDistanceKm[idx],
          terrainSlopeEast: terrainSlopeEast[idx],
          terrainSlopeNorth: terrainSlopeNorth[idx],
          coastInlandUnitEast: coastInlandUnitEast[idx],
          coastInlandUnitNorth: coastInlandUnitNorth[idx]
        });
        const rate = Math.max(0, rain.rate);
        total += rate * snap.dtHours;
        peakRate = Math.max(peakRate, rate);
        maxWindowVmax = Math.max(maxWindowVmax, state.vmax || 0);
        if (state.landed) maxWindowLandfallVmax = Math.max(maxWindowLandfallVmax, snapLandfallVmax || state.vmax || 0);
        if (state.rapidIntensifying) {
          const rapidModeSupport = state.rapidIntensificationMode === "uri" ? 1.0 :
            state.rapidIntensificationMode === "eri" ? 0.94 : 0.84;
          maxWindowRapidCoreSupport = Math.max(maxWindowRapidCoreSupport, rapidModeSupport);
        }
        const rc: any = rain.components || {};
        // A residual inland vortex following a very intense landfall is not merely broad
        // stratiform rain. Give more of it to the focused/core bucket while that inherited
        // inner-core moisture/organization remains present; this allows the 50-250 mm swath
        // to follow the inland track instead of leaving only a pale-blue shield.
        const inlandCoreWeight = 0.50 + 0.34 * strongLandfallRainMemory;
        const inlandBroadWeight = 0.40 - 0.20 * strongLandfallRainMemory;
        const fragmentedCoreRate = Math.max(0, rc.fragmentedCore || 0);
        const coreComponentRate = Math.max(0,
          (rc.eyewall || 0) + (rc.center || 0) + fragmentedCoreRate + (rc.convectiveBurst || 0) + (rc.coreExtremeCell || 0) +
          inlandCoreWeight * (rc.inlandVortexRain || 0) + 0.34 * (rc.largeInlandCirculationRain || 0));
        coreRainAccum += snap.dtHours * coreComponentRate;
        compactCoreRainAccum += snap.dtHours * Math.max(0,
          (rc.eyewall || 0) + (rc.center || 0) + (rc.convectiveBurst || 0) + (rc.coreExtremeCell || 0));
        fragmentedCoreRainAccum += snap.dtHours * fragmentedCoreRate;
        fragmentedCoreHeavyHours += snap.dtHours * Math.max(0, Math.min(1, (fragmentedCoreRate - 12) / 26));
        const dryExposureAtSnap = Math.max(0, Math.min(1, state.dryAirCoreExposure ?? 0));
        const moistProtectionAtSnap = Math.max(0, Math.min(1, state.moistCoreProtection ?? 0.50));
        const integrityAtSnap = Math.max(0.08, Math.min(1, state.eyewallIntegrity ?? 0.62));
        const dryIntrudedCoreRetention = (state.vmax || 0) >= 32.7 && dryExposureAtSnap >= 0.14
          ? Math.max(0.24, Math.min(0.90,
            (0.34 + 0.38 * moistProtectionAtSnap + 0.28 * integrityAtSnap) *
            (1 - 0.34 * dryExposureAtSnap)))
          : 1;
        const terrainBreakupAtSnap = Math.max(0, Math.min(1,
          0.24 * Math.max(0, Math.min(1, (state.terrainFrictionWork ?? 0) / 13.5)) +
          0.30 * Math.max(0, Math.min(1, state.terrainBlockingMemory ?? 0)) +
          0.24 * Math.max(0, Math.min(1, state.terrainFrictionAsymmetry ?? 0)) *
            (0.35 + 0.65 * Math.max(0, Math.min(1, state.terrainCoreLandFraction ?? 0))) +
          0.14 * Math.max(0, Math.min(1, state.terrainMountainFraction ?? 0))
        ));
        maxWindowTerrainBreakupScore = Math.max(maxWindowTerrainBreakupScore, terrainBreakupAtSnap);
        maxWindowTerrainCoreElevation = Math.max(maxWindowTerrainCoreElevation, state.terrainMaxCoreElevation ?? 0);
        maxWindowTerrainMountainFraction = Math.max(maxWindowTerrainMountainFraction, state.terrainMountainFraction ?? 0);
        const stateCoreOrganization = Math.max(0, Math.min(1,
          Math.max(0, Math.min(1, ((state.vmax || 0) - 34) / 25)) *
          integrityAtSnap *
          (0.56 + 0.44 * Math.max(0, Math.min(1, state.coreCompactness ?? 0.50))) *
          dryIntrudedCoreRetention *
          (1 - 0.70 * terrainBreakupAtSnap) *
          (state.isCoreDisrupted ? 0.48 : state.isStructureDamaged ? 0.62 : 1)
        ));
        maxWindowCoreOrganization = Math.max(maxWindowCoreOrganization, stateCoreOrganization);
        const hollowMemoryAtSnap = Math.max(0, Math.min(1, state.terrainHollowCoreMemory ?? 0));
        maxWindowTerrainHollowMemory = Math.max(maxWindowTerrainHollowMemory, hollowMemoryAtSnap);
        const hollowRainSignal = Math.max(0, Math.min(1, (rate - 4) / 16));
        // A broken vortex can still make an extreme local rainband if it stalls or repeatedly
        // trains one sector. Translating quickly after the mountain crossing is not sufficient
        // evidence for a broad 400+ mm shield. Preserve this residence/slow-training signal for
        // the product-level high-tail gate below.
        const slowDamagedMotion = Math.max(0, Math.min(1, (25 - (state.speed ?? 18)) / 13));
        hollowSlowTrainingHours += snap.dtHours * hollowMemoryAtSnap * hollowRainSignal * slowDamagedMotion;
        if (state.penaltyRecoveryActive && state.penaltyRecoveryTerrain) {
          manualTerrainRebuildHours += snap.dtHours;
        }
        // A 24-h landfall analysis must not treat every inland grid point as "broad weak rain"
        // merely because the symmetric core score has collapsed. Preserve evidence that a still-
        // strong residual vortex, humid eyewall arc or inland mesoscale rain shield actually
        // occupied this point for several hours.
        if (state.landed) {
          const r7MeanAtSnap = meanPositiveRadius(state.r7);
          const sizePersistence = Math.max(0, Math.min(1, (r7MeanAtSnap - 110) / 330));
          const residualVmaxAtSnap = Math.max(
            state.vmax || 0,
            17.5 + Math.max(0, snapLandfallVmax - 17.5) * Math.exp(-snapLandHours / 30)
          );
          const residualStrength = Math.max(0, Math.min(1, (residualVmaxAtSnap - 20) / 24));
          const moisturePersistence = Math.max(0.20, Math.min(1,
            0.46 * Math.sqrt(Math.max(0.02, Math.min(1.05, state.moistureReservoir ?? 0.65))) +
            0.26 * Math.max(0, Math.min(1, (state.broadMoisturePlatform ?? 0.25))) +
            0.28 * (0.55 + 0.45 * sizePersistence)
          ));
          const dryResidualCore = dryExposureAtSnap >= 0.14
            ? Math.max(0.18, Math.min(1,
              dryIntrudedCoreRetention * (0.52 + 0.48 * moistProtectionAtSnap)))
            : stateCoreOrganization;
          const landfallPersistence = Math.max(
            stateCoreOrganization,
            dryResidualCore,
            residualStrength * (0.42 + 0.58 * moisturePersistence)
          );
          const pointRainSignal = Math.max(0, Math.min(1, (rate - 2.5) / 11.5));
          landfallOrganizedHours += snap.dtHours * landfallPersistence * pointRainSignal;
          landedRainResidenceHours += snap.dtHours * Math.max(0, Math.min(1, (rate - 1.8) / 7.2));
          inlandFocusedRainAccum += snap.dtHours * Math.max(0,
            0.72 * (rc.inlandVortexRain || 0) +
            0.84 * (rc.largeInlandCirculationRain || 0) +
            0.90 * (rc.inlandMesoscaleTrainingCell || 0) +
            0.55 * (rc.landfallConvergence || 0) +
            // Coastal convergence belongs in the landfall history, but it must not dominate the
            // product-level focus score after the circulation has translated/stalled inland.
            0.44 * (rc.coastalFrictionConvergence || 0) +
            0.60 * (rc.coastalMesoscaleTrainingCell || 0) +
            0.45 * ((rc.eyewall || 0) + (rc.center || 0)));
        }
        // A dry-intruded core may be strongly asymmetric but still rain very hard in its surviving
        // humid eyewall/CDO arc.  Count observed core-component rain itself as evidence of a focused
        // inner-core passage so the 24-h product does not compress that arc into a weak broad shield.
        const actualCoreRainSignal = Math.max(0, Math.min(1, (coreComponentRate - 7) / 30));
        coherentCoreRainHours += snap.dtHours * Math.max(
          stateCoreOrganization * actualCoreRainSignal,
          (dryExposureAtSnap >= 0.14 ? 0.58 : 0.30) * actualCoreRainSignal
        );

        // Dry-air intrusion changes morphology much faster than it changes the satellite-analyzed
        // wind.  If a 40-55 m/s Dvorak-intense cyclone still has a humid residual eyewall/fragmented
        // core, preserve that actual core rain instead of classifying the whole system as a weak
        // broad shield merely because the symmetric CDO score collapsed.
        const dryDamagedDvorakPrior = dryExposureAtSnap >= 0.14
          ? Math.max(0, Math.min(1, ((state.vmax || 0) - 34) / 22)) *
            Math.max(0.30, dryIntrudedCoreRetention)
          : 0;
        const survivingDamagedCoreRate = Math.max(
          fragmentedCoreRate,
          Math.max(0, rc.center || 0),
          0.82 * Math.max(0, rc.eyewall || 0)
        );
        dryDamagedCoreRainAccum += snap.dtHours * survivingDamagedCoreRate * dryDamagedDvorakPrior;
        dryDamagedCoreHeavyHours += snap.dtHours * dryDamagedDvorakPrior *
          Math.max(0, Math.min(1, (survivingDamagedCoreRate - 10) / 24));

        const terrainRate = Math.max(0, rc.terrainAnchoredRain || 0);
        const remoteTerrainRate = Math.max(0, rc.remoteTerrainFeederRain || 0);
        const synopticRate = Math.max(0, rc.synopticConvergenceRain || 0);
        const coastalFrictionRate = Math.max(0, rc.coastalFrictionConvergence || 0);
        const coastalNodeRate = Math.max(0, rc.coastalMesoscaleTrainingCell || 0);
        terrainAnchoredAccum += snap.dtHours * terrainRate;
        terrainAnchoredHours += snap.dtHours * Math.max(0, Math.min(1, (terrainRate - 2.5) / 9.5));
        synopticConvergenceAccum += snap.dtHours * synopticRate;
        coastalFrictionAccum += snap.dtHours * coastalFrictionRate;
        coastalFrictionHours += snap.dtHours * Math.max(0, Math.min(1, (coastalFrictionRate - 2.0) / 9.0));
        coastalNodeAccum += snap.dtHours * coastalNodeRate;
        coastalNodeHours += snap.dtHours * Math.max(0, Math.min(1, (coastalNodeRate - 2.4) / 11.5));

        // 3.3.22: integrate the exact nested mechanisms. Earlier inference from the parent
        // spiral/inland/terrain buckets could mistake an ordinary broad rainband for a detached
        // packet, or grant remote terrain strips the same extreme permission as local mountains.
        const detachedRate = Math.max(0, rc.detachedOuterRainband || 0);
        if (detachedRate > 1.2) {
          detachedOuterBandAccum += snap.dtHours * detachedRate;
          detachedOuterBandHours += snap.dtHours * Math.max(0, Math.min(1, (detachedRate - 1.2) / 6.8));
        }
        const inlandCellRate = Math.max(0, rc.inlandMesoscaleTrainingCell || 0);
        if (state.landed && inlandCellRate > 2.8) {
          inlandTrainingAccum += snap.dtHours * inlandCellRate;
          inlandTrainingHours += snap.dtHours * Math.max(0, Math.min(1, (inlandCellRate - 2.8) / 13.5));
        }
        if (remoteTerrainRate > 0.8) {
          remoteTerrainAccum += snap.dtHours * remoteTerrainRate;
          remoteTerrainHours += snap.dtHours * Math.max(0, Math.min(1, (remoteTerrainRate - 0.8) / 5.2));
        }

        const westerlyRate = Math.max(0, rc.westerlyFrontalRain || 0);
        const westerlyTailRate = Math.max(0, rc.westerlyNortheastTailRain || 0);
        const westerlyStateSignal = Math.max(
          state.structureMode === "westerly_sheared" ? 0.72 : 0,
          Math.max(0, Math.min(1, (state.etHours || 0) / 12)),
          Math.max(0, Math.min(1, (state.westerlyInteractionHours || 0) / 14)),
          Math.max(0, Math.min(1, state.northeastCloudTailStrength || 0)),
          Math.max(0, Math.min(1, (((state.shear || 0) - 14) / 20))) *
            Math.max(0, Math.min(1, ((state.lat || 0) - 25) / 10))
        );
        // Frontal convection supports the heavy-rain lobe; the NE tail is intentionally weighted
        // more into the broad/moderate bucket so 25-100 mm totals persist longer without painting
        // an unrealistic 100-250 mm corridor along the full cloud tail.
        westerlyOrganizedRainAccum += snap.dtHours * (westerlyRate + 0.58 * westerlyTailRate);
        westerlyOrganizedHours += snap.dtHours * westerlyStateSignal * Math.max(
          Math.max(0, Math.min(1, (westerlyRate - 4) / 14)),
          0.55 * Math.max(0, Math.min(1, (westerlyTailRate - 1.2) / 5.5))
        );

        bandRainAccum += snap.dtHours * Math.max(0,
          (rc.spiralRainband || 0) + (rc.bandExtremeCell || 0) + (rc.preStormSquall || 0) +
          0.78 * westerlyRate + 0.28 * westerlyTailRate + 0.62 * synopticRate + 0.58 * terrainRate +
          0.82 * coastalFrictionRate + 0.88 * coastalNodeRate);
        broadRainAccum += snap.dtHours * Math.max(0,
          (rc.outerCirculation || 0) + (rc.moistureConvergence || 0) +
          (rc.stratiformShield || 0) + (rc.diffuseRainShield || 0) +
          0.74 * westerlyTailRate + 0.24 * synopticRate + 0.14 * terrainRate + 0.22 * remoteTerrainRate +
          inlandBroadWeight * (rc.inlandVortexRain || 0) + 0.44 * (rc.largeInlandCirculationRain || 0));
        bandHyperAccum += snap.dtHours * Math.max(0, rc.bandHyperCell || 0);
        pointExtremeAccum += snap.dtHours * Math.max(0, (rc.bandHyperCell || 0) + (rc.inlandExtremeCell || 0));
        // Distinguish a broad day-long moderate rain shield from cells that actually spend
        // time at convective rates. This lets the 24-h product keep large 25-100 mm lobes
        // without converting every persistent 6-10 mm/h grid cell into a 100-250 mm blanket.
        focusedConvectiveHours += snap.dtHours * Math.max(0, Math.min(1, (rate - 16) / 34));
        // Repeated 8-18 mm/h rain in an organized band/mesoscale complex is exactly what
        // builds many operational 100-250 mm lobes. The old focus metric ignored it and
        // therefore collapsed too much physically meaningful purple area back into 50-100 mm.
        organizedHeavyHours += snap.dtHours * Math.max(0, Math.min(1, (rate - 7.5) / 12.5));
        moderateRainHours += snap.dtHours * Math.max(0, Math.min(1, (rate - 3.0) / 7.5));
        const organizedRateShare = Math.max(0, Math.min(1,
          (coreComponentRate + 0.86 * Math.max(0,
            (rc.spiralRainband || 0) + (rc.bandExtremeCell || 0) + 0.74 * westerlyRate + 0.22 * westerlyTailRate) +
            0.70 * synopticRate + 0.72 * terrainRate + 0.82 * coastalNodeRate +
            0.52 * inlandCellRate + 0.64 * Math.max(0, rc.inlandVortexRain || 0) +
            0.76 * Math.max(0, rc.largeInlandCirculationRain || 0)) / Math.max(2.0, rate)
        ));
        organizedMidRainHours += snap.dtHours * Math.max(0, Math.min(1, (rate - 3.8) / 9.2)) * organizedRateShare;
      }
      // 3.7.2 accumulation renderer starts from the raw time-integrated physical rain.
      // Older releases passed this field through many operational colour-class retention/ceiling
      // branches (including exact 250/400/550/600-mm thresholds). Those branches were removed, not
      // merely bypassed, so the rainfall physics and display palette can no longer feed back into
      // one another or create threshold shelves in the spatial field.
      let calibrated = Math.max(0, total);
      const mechanismDenom = Math.max(1, coreRainAccum + bandRainAccum + broadRainAccum);
      const coreShare = Math.max(0, Math.min(1, coreRainAccum / mechanismDenom));
      const fragmentedCoreShare = Math.max(0, Math.min(1, fragmentedCoreRainAccum / mechanismDenom));
      const fragmentedCoreHeavyScore = Math.max(0, Math.min(1, fragmentedCoreHeavyHours / 3.2));
      const dryDamagedCoreShare = Math.max(0, Math.min(1, dryDamagedCoreRainAccum / mechanismDenom));
      const dryDamagedCoreScore = Math.max(0, Math.min(1,
        0.58 * Math.min(1, dryDamagedCoreHeavyHours / 3.4) +
        0.42 * Math.min(1, dryDamagedCoreShare / 0.34)
      ));
      const westerlyOrganizedScore = Math.max(0, Math.min(1,
        0.56 * Math.min(1, westerlyOrganizedHours / 4.5) +
        0.44 * Math.min(1, westerlyOrganizedRainAccum / 90)
      ));
      const terrainAnchoredScore = Math.max(0, Math.min(1,
        0.58 * Math.min(1, terrainAnchoredHours / 5.0) +
        0.42 * Math.min(1, terrainAnchoredAccum / 110)
      ));
      const synopticConvergenceScore = Math.max(0, Math.min(1, synopticConvergenceAccum / 115));
      const coastalFrictionScore = Math.max(0, Math.min(1,
        0.54 * Math.min(1, coastalFrictionHours / 5.0) +
        0.46 * Math.min(1, coastalFrictionAccum / 105)
      ));
      const coastalNodeScore = Math.max(0, Math.min(1,
        0.56 * Math.min(1, coastalNodeHours / 3.8) +
        0.44 * Math.min(1, coastalNodeAccum / 72)
      ));
      const detachedOuterBandScore = Math.max(0, Math.min(1,
        0.56 * Math.min(1, detachedOuterBandHours / 4.2) +
        0.44 * Math.min(1, detachedOuterBandAccum / 72)
      ));
      const inlandTrainingScore = Math.max(0, Math.min(1,
        0.58 * Math.min(1, inlandTrainingHours / 3.4) +
        0.42 * Math.min(1, inlandTrainingAccum / 78)
      ));
      const remoteTerrainScore = Math.max(0, Math.min(1,
        0.60 * Math.min(1, remoteTerrainHours / 4.8) +
        0.40 * Math.min(1, remoteTerrainAccum / 58)
      ));
      const bandShare = Math.max(0, Math.min(1, bandRainAccum / mechanismDenom));
      const sustainedHeavyScore = Math.max(0, Math.min(1, organizedHeavyHours / 7.5));
      const moderatePersistenceScore = Math.max(0, Math.min(1, moderateRainHours / 8.0));
      const organizedMidScore = Math.max(0, Math.min(1, organizedMidRainHours / 5.0));
      const coherentCorePassScore = Math.max(0, Math.min(1, coherentCoreRainHours / 3.6));
      const landfallPersistenceScore = Math.max(0, Math.min(1,
        0.48 * Math.min(1, landfallOrganizedHours / 5.5) +
        0.30 * Math.min(1, landedRainResidenceHours / 8.0) +
        0.22 * Math.min(1, inlandFocusedRainAccum / 95)
      ));
      const focusScore = Math.max(0, Math.min(1,
        0.25 * Math.max(0, Math.min(1, (peakRate - 17) / 64)) +
        0.20 * Math.max(0, Math.min(1, focusedConvectiveHours / 4.8)) +
        0.18 * sustainedHeavyScore +
        0.16 * organizedMidScore +
        0.16 * Math.max(coreShare, 0.72 * bandShare) +
        0.15 * fragmentedCoreHeavyScore +
        0.20 * dryDamagedCoreScore +
        0.16 * westerlyOrganizedScore +
        0.18 * terrainAnchoredScore +
        0.10 * synopticConvergenceScore +
        0.18 * coastalFrictionScore +
        0.13 * coastalNodeScore +
        0.10 * detachedOuterBandScore +
        0.14 * inlandTrainingScore +
        0.08 * remoteTerrainScore +
        0.22 * coherentCorePassScore +
        0.20 * landfallPersistenceScore
      ));

      // The map now follows the hourly physics instead of an operational-colour-class shaping
      // ladder. Broad all-day drizzle is reduced continuously; focused core/band/training/terrain residence is
      // retained. There is no special 250/400/550/600-mm boundary and no flat-land absolute ceiling.
      const physicalFocus = Math.max(0, Math.min(1,
        0.30 * focusScore + 0.18 * organizedMidScore + 0.14 * sustainedHeavyScore +
        0.12 * inlandTrainingScore + 0.10 * terrainAnchoredScore + 0.08 * coastalNodeScore +
        0.08 * coherentCorePassScore + 0.10 * dryDamagedCoreScore
      ));
      const physicalBroadShare = Math.max(0, Math.min(1, broadRainAccum / mechanismDenom));
      const unfocusedBroadness = physicalBroadShare * (1 - 0.78 * physicalFocus) *
        (1 - 0.45 * landfallPersistenceScore);
      // Store only continuous mechanism evidence for the neighbourhood pass. Fragmented/dry-air
      // cores and inland training are intentionally allowed to be locally extreme even when the
      // symmetric-core share is small.
      physicalFocusField[idx] = Math.max(0, Math.min(1, Math.max(
        physicalFocus,
        0.88 * inlandTrainingScore,
        0.82 * terrainAnchoredScore,
        0.78 * coastalNodeScore,
        0.80 * dryDamagedCoreScore,
        0.76 * fragmentedCoreHeavyScore,
        0.72 * detachedOuterBandScore
      )));
      broadDiffusePenaltyField[idx] = Math.max(0, Math.min(1, unfocusedBroadness));
      const sustainedConvectiveSupport = Math.max(0, Math.min(1,
        0.28 * Math.min(1, focusedConvectiveHours / 3.4) +
        0.20 * Math.min(1, organizedHeavyHours / 5.0) +
        0.16 * Math.min(1, Math.max(0, peakRate - 8) / 34) +
        0.14 * Math.max(inlandTrainingScore, terrainAnchoredScore, coastalNodeScore) +
        0.10 * coherentCorePassScore +
        0.07 * dryDamagedCoreScore +
        0.05 * fragmentedCoreHeavyScore
      ));
      sustainedConvectiveSupportField[idx] = sustainedConvectiveSupport;

      // 3.7.4 area/intensity separation. A broad moist shield is allowed to persist inland, but
      // its 24-h mean is no longer allowed to occupy the same classes as repeatedly convecting
      // cells. This is deliberately stronger than 3.7.3 for diffuse totals while preserving
      // localized training/terrain/core maxima and using no legend-class hard ceiling.
      const accumulationScale = Math.max(0.28, Math.min(1.0,
        0.50 + 0.30 * physicalFocus + 0.10 * sustainedConvectiveSupport +
        0.08 * landfallPersistenceScore + 0.05 * moderatePersistenceScore -
        0.38 * unfocusedBroadness
      ));
      const tailLocality = Math.max(physicalFocus, sustainedConvectiveSupport, inlandTrainingScore,
        terrainAnchoredScore, coastalNodeScore, dryDamagedCoreScore, fragmentedCoreHeavyScore);
      const continuousTailDamping = 1 / (1 +
        0.82 * (1 - tailLocality) * Math.pow(Math.max(0, total) / 390, 1.14));
      // A full-life total is a sum of nonnegative hourly rain. The 24-h visual tail
      // calibration is NOT additive and can make a 120-h map smaller than its 24-h subset.
      // Preserve the raw physical integral for full-life maps, without extra normalization.
      calibrated = fullTrackProduct ? Math.max(0, total) : Math.max(0, total * accumulationScale * continuousTailDamping);

      // 3.3.2 trim only the weakest 0-10 mm fringe. The previous diffuse shield kept too many
      // barely-raining pixels alive. Preserve organized NE-tail rain and all >=10 mm totals; only
      // contract the low-signal skirt by roughly 5-15%.
      if (calibrated < 0.75) {
        calibrated = 0;
      } else if (calibrated < 10) {
        const lowRainKeep = 0.86 + 0.14 * Math.max(0, Math.min(1, calibrated / 10));
        calibrated *= lowRainKeep;
      }
      // No hard 800-mm ceiling: the map annotation reports the diagnosed maximum.
      field[idx] = calibrated;
      if (calibrated > rawMax) {
        rawMax = calibrated;
        rawMaxIndex = idx;
      }
    }
    if (gy % 4 === 0) {
      progress(14 + 66 * gy / gridRows);
      await yieldToUi();
    }
  }

  // 3.7.4 mesoscale concentration pass. A broad high-value plateau is not a collection of local
  // extremes: operational 24-h analyses show narrow belts/clusters embedded inside a much larger
  // light/moderate shield. Diagnose prominence over a wider neighbourhood and require actual
  // sustained-convective support before retaining most of the high-end excess.
  const preExtremeLocalization = new Float32Array(field);
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const idx = gy * gridCols + gx;
      if (fullTrackProduct || landMask[idx] !== 1 || preExtremeLocalization[idx] <= 0) continue;
      const v0 = preExtremeLocalization[idx];
      let neighbourSum = 0;
      let neighbourCount = 0;
      let distinctlyLowerCount = 0;
      // Nine-by-nine remains mesoscale at this grid spacing and better distinguishes an embedded
      // convective belt from a province-scale plateau.
      for (let dy = -4; dy <= 4; dy++) {
        const yy = gy + dy;
        if (yy < 0 || yy >= gridRows) continue;
        for (let dx = -4; dx <= 4; dx++) {
          const xx = gx + dx;
          if (xx < 0 || xx >= gridCols || (dx === 0 && dy === 0)) continue;
          const ni = yy * gridCols + xx;
          if (landMask[ni] !== 1) continue;
          const nv = preExtremeLocalization[ni];
          neighbourSum += nv;
          if (nv < v0 * 0.72) distinctlyLowerCount++;
          neighbourCount++;
        }
      }
      const neighbourMean = neighbourCount > 0 ? neighbourSum / neighbourCount : v0;
      const contrast = Math.max(0, Math.min(1,
        (v0 - neighbourMean) / Math.max(42, 0.30 * v0 + 38)
      ));
      const shoulderFraction = neighbourCount > 0 ? distinctlyLowerCount / neighbourCount : 1;
      const prominence = Math.max(0, Math.min(1, 0.62 * contrast + 0.38 * shoulderFraction));
      const processSupport = Math.max(0, Math.min(1, physicalFocusField[idx]));
      const sustainedConvectiveSupport = Math.max(0, Math.min(1, sustainedConvectiveSupportField[idx]));
      const locality = Math.max(0, Math.min(1,
        0.62 * prominence + 0.18 * processSupport + 0.20 * contrast
      ));
      const diffuseContext = Math.max(0, Math.min(1, broadDiffusePenaltyField[idx]));
      const highEndSupport = Math.max(0, Math.min(1,
        0.58 * sustainedConvectiveSupport + 0.30 * prominence + 0.12 * processSupport
      ));

      // Decompose the total into a background shoulder and a convective excess. 3.7.4 deliberately
      // lowers the shoulder carried by a flat plateau: a point keeps a large high-end excess only
      // if it is both locally prominent and repeatedly convective. True local 400-1000+ mm maxima
      // remain possible because their prominence/support drive retention back toward one.
      const backgroundShoulder = 26 + 44 * locality + 18 * processSupport + 18 * sustainedConvectiveSupport;
      const excess = Math.max(0, v0 - backgroundShoulder);
      const excessRetention = Math.max(0.20, Math.min(1.0,
        0.20 + 0.44 * locality + 0.22 * sustainedConvectiveSupport + 0.10 * processSupport
      ));
      let compacted = Math.min(v0, backgroundShoulder + excess * excessRetention);

      // Flat high-value plateaus receive an additional continuous reduction. This changes no
      // categorical threshold; it simply represents the fact that intense convection occupies a
      // much smaller fraction of the rain shield than stratiform/light-moderate precipitation.
      const magnitudeActivation = 1 - Math.exp(-v0 / 115);
      const plateauPenalty = Math.min(0.34,
        (1 - prominence) * (1 - 0.55 * highEndSupport) *
        (0.38 + 0.62 * diffuseContext) * magnitudeActivation * 0.34
      );
      const diffusePenalty = Math.min(0.28,
        (1 - locality) * diffuseContext * magnitudeActivation * 0.28
      );
      const fringeActivation = Math.max(0, Math.min(1, (68 - v0) / 52));
      const fringePenalty = Math.min(0.14,
        (1 - locality) * diffuseContext * fringeActivation * 0.14
      );
      compacted *= (1 - plateauPenalty) * (1 - diffusePenalty) * (1 - fringePenalty);
      field[idx] = Math.max(0, Math.min(v0, compacted));
    }
  }

  // Recompute the annotation maximum after the spatial tail calibration.
  rawMax = 0;
  rawMaxIndex = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] > rawMax) {
      rawMax = field[i];
      rawMaxIndex = i;
    }
  }

  const smoothed = smoothField(field, gridCols, gridRows, landMask);
  const renderField = buildCoastalRenderField(smoothed, gridCols, gridRows, landMask);
  let maxRain = rawMax;
  let maxIndex = rawMaxIndex;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] > maxRain) {
      maxRain = smoothed[i];
      maxIndex = i;
    }
  }
  const legendBands = rainfallBands(actualWindow, maxRain, legendStyle);

  // 3.3.8: the selected legend is also a semantic precipitation classification mode.
  // In 3.3.7 the legend layout and raster palette were fully independent, which meant a saved
  // `palette1` preference could silently keep the map in palette ① even after the user selected
  // legend ② or the combined overlay.  That produced exactly the misleading situation where the
  // legend advertised 400/600+ orange classes while an 800+ maximum was still painted maroon.
  //
  // Keep the explicit map-palette selector useful for legend ①, but make the two high-end legend
  // modes authoritative so their promised class colours are always present on the actual raster:
  //   legend ②        -> full palette ②
  //   combined overlay -> 0-250 from ①, 250+ from ②
  // This is render-only; the scalar precipitation field is unchanged.
  const mapBandStyle: RainfallLegendStyle =
    legendStyle === "combined_overlay"
      ? "combined_overlay"
      : legendStyle === "extreme_reference"
        ? "extreme_reference"
        : (mapPalette === "palette2" ? "extreme_reference" : "green_reference");
  const bands = rainfallBands(actualWindow, maxRain, mapBandStyle);
  progress(82);

  // Bilinear sample the scalar field into a denser classification raster. This gives the
  // smooth, contour-like edges of the reference images without inventing vector polygons.
  // Render-only supersampling: the physical accumulation grid above is unchanged. A denser
  // threshold-classification raster lets categorical boundaries approach vector smoothness
  // without claiming extra meteorological resolution.
  const rasterW = Math.min(1800, gridCols * 4);
  const rasterH = Math.max(420, Math.round(rasterW * mapH / mapW));
  const rainCanvas = document.createElement("canvas");
  rainCanvas.width = rasterW;
  rainCanvas.height = rasterH;
  const rctx = rainCanvas.getContext("2d");
  if (rctx) {
    const image = rctx.createImageData(rasterW, rasterH);
    const parseHex = (hex: string) => {
      const h = hex.replace("#", "");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    // Categorical RGB is constant per legend band. Predecode once, and map x to the
    // rainfall grid once per image rather than doing multiple divisions, hex parses and
    // Map lookups across every raster row (~0.4-1.8 million output pixels).
    const bandRgb = bands.map(b => parseHex(b.color));
    const x0Lut = new Uint16Array(rasterW);
    const xFracLut = new Float32Array(rasterW);
    for(let px=0;px<rasterW;px++) {
      const gx = px / Math.max(1,rasterW-1) * (gridCols-1);
      x0Lut[px] = Math.floor(gx);
      xFracLut[px] = gx-x0Lut[px];
    }
    let lastRasterYieldAt = performance.now();
    for (let py = 0; py < rasterH; py++) {
      // Preserve full categorical classification while yielding only when the elapsed
      // work budget warrants it, including abort checks for long 4K/8K products.
      if ((py & 31) === 0 && performance.now() - lastRasterYieldAt >= 11) {
        await yieldToUi();
        lastRasterYieldAt = performance.now();
      }
      const gy = (py / Math.max(1, rasterH - 1)) * (gridRows - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(gridRows - 1, y0 + 1);
      const fy = gy - y0;
      for (let px = 0; px < rasterW; px++) {
        const x0 = x0Lut[px];
        const x1 = Math.min(gridCols - 1, x0 + 1);
        const fx = xFracLut[px];
        const v00 = renderField[y0 * gridCols + x0];
        const v10 = renderField[y0 * gridCols + x1];
        const v01 = renderField[y1 * gridCols + x0];
        const v11 = renderField[y1 * gridCols + x1];
        const v0 = v00 * (1 - fx) + v10 * fx;
        const v1 = v01 * (1 - fx) + v11 * fx;
        const v = v0 * (1 - fy) + v1 * fy;
        let bandIndex = -1;
        for (let bi = 0; bi < bands.length; bi++) {
          if (v >= bands[bi].min && v < bands[bi].max) {bandIndex = bi;break;}
        }
        if (bandIndex < 0) continue;
        const rgb = bandRgb[bandIndex];
        const ii = (py * rasterW + px) * 4;
        image.data[ii] = rgb[0];
        image.data[ii + 1] = rgb[1];
        image.data[ii + 2] = rgb[2];
        image.data[ii + 3] = 242;
      }
    }
    rctx.putImageData(image, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();
    // The observed-rainfall product shades land only. Clip with the actual land geometry so
    // bilinear resampling cannot leak colored rainfall back over adjacent ocean pixels.
    const landClipPath = buildGeoJsonPath(landGeoJson, project, domain.refLon, domain);
    ctx.clip(landClipPath, "evenodd");
    // Never blur categorical rainfall classes during final scaling. The scalar field was
    // interpolated before classification; smoothing the color raster itself creates fuzzy class
    // boundaries and coast halos.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rainCanvas, mapX, mapY, mapW, mapH);
    ctx.restore();

    // Edge-only vector pass: marching-squares contours are traced from the original scalar
    // accumulation field, so class boundaries stay crisp without changing the meteorological
    // grid or inventing finer-scale rainfall. The contour is clipped to the same land geometry.
    ctx.save();
    ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
    // Reuse the already built, immutable Path2D: retracing the entire coastline adds no precision.
    ctx.clip(landClipPath, "evenodd");
    await drawRainClassContours(
      ctx, renderField, gridCols, gridRows, mapX, mapY, mapW, mapH,
      bands.map((b) => ({ value: b.min, color: b.color })),
      Math.max(0.8, 1.05 * S),
      yieldToUi,
    );
    ctx.restore();
  }
  progress(88);

  // Crisp vector boundaries above the land-clipped raster.  No opaque shoreline under-stroke is
  // used: the render-only coastal extension already makes the fill reach the exact vector coast.
  ctx.save();
  ctx.beginPath();
  ctx.rect(mapX, mapY, mapW, mapH);
  ctx.clip();
  drawGeoJson(ctx, landGeoJson, project, domain.refLon, null, "rgba(92,92,92,0.92)", Math.max(0.9, 1.10 * S), domain, true);
  ctx.restore();

  if (showTrackOverlay) {
    const track = [...(typhoon.history || [])]
      .filter((h) => Number.isFinite(h.simHour) && h.simHour >= actualStartHour - 1e-6 && h.simHour <= actualEndHour + 1e-6)
      .sort((a, b) => a.simHour - b.simHour);
    if (track.length >= 2) {
      ctx.save();
      ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
      ctx.beginPath();
      track.forEach((h, i) => { const p = project(h.lat, h.lon); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.strokeStyle = "#111111"; ctx.lineWidth = Math.max(1.8, 2.4 * S); ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      ctx.restore();
    }
  }

  // Latitude/longitude grid, restrained and thin like an operational map product.
  const lonStep = niceGridStep(domain.maxLon - domain.minLon);
  const latStep = niceGridStep(domain.maxLat - domain.minLat);
  ctx.save();
  ctx.beginPath();
  ctx.rect(mapX, mapY, mapW, mapH);
  ctx.clip();
  ctx.strokeStyle = "rgba(80,80,80,0.42)";
  ctx.lineWidth = Math.max(0.65, 0.75 * S);
  ctx.font = `${Math.max(12, 15 * S)}px "Arial", sans-serif`;
  ctx.fillStyle = "#4b5563";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const firstLonGrid = Math.ceil(domain.minLon / lonStep) * lonStep;
  for (let lon = firstLonGrid; lon <= domain.maxLon + 1e-6; lon += lonStep) {
    const p0 = project(domain.minLat, lon);
    const p1 = project(domain.maxLat, lon);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    const displayLon = ((lon + 540) % 360) - 180;
    const suffix = displayLon >= 0 ? "°E" : "°W";
    ctx.fillText(`${Math.round(Math.abs(displayLon))}${suffix}`, p0.x, mapY + mapH - Math.max(20, 22 * S));
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const firstLatGrid = Math.ceil(domain.minLat / latStep) * latStep;
  for (let lat = firstLatGrid; lat <= domain.maxLat + 1e-6; lat += latStep) {
    const p0 = project(lat, domain.minLon);
    const p1 = project(lat, domain.maxLon);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    const suffix = lat >= 0 ? "°N" : "°S";
    ctx.save();
    ctx.translate(mapX + mapW - Math.max(10, 12 * S), p1.y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(Math.abs(lat))}${suffix}`, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Map border.
  ctx.strokeStyle = "#626b73";
  ctx.lineWidth = Math.max(1, 1.4 * S);
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // Operational-style precipitation-center annotation only.  City/station values are
  // intentionally omitted so the product reads like a gridded observed-rainfall analysis.
  const maxGy = Math.floor(maxIndex / gridCols);
  const maxGx = maxIndex % gridCols;
  const maxLat = domain.maxLat - ((maxGy + 0.5) / gridRows) * (domain.maxLat - domain.minLat);
  const maxLon = domain.minLon + ((maxGx + 0.5) / gridCols) * (domain.maxLon - domain.minLon);
  const maxP = project(maxLat, maxLon);
  if (!fullTrackProduct && maxRain >= Math.max(1, bands[0].min)) {
    ctx.save();
    const arm = Math.max(4.5, 5.2 * S);
    ctx.strokeStyle = "rgba(255,255,255,0.96)";
    ctx.lineWidth = Math.max(2.4, 3.0 * S);
    ctx.beginPath();
    ctx.moveTo(maxP.x - arm, maxP.y - arm); ctx.lineTo(maxP.x + arm, maxP.y + arm);
    ctx.moveTo(maxP.x + arm, maxP.y - arm); ctx.lineTo(maxP.x - arm, maxP.y + arm);
    ctx.stroke();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = Math.max(1.05, 1.3 * S);
    ctx.beginPath();
    ctx.moveTo(maxP.x - arm, maxP.y - arm); ctx.lineTo(maxP.x + arm, maxP.y + arm);
    ctx.moveTo(maxP.x + arm, maxP.y - arm); ctx.lineTo(maxP.x - arm, maxP.y + arm);
    ctx.stroke();
    const txt = `${Math.round(maxRain)}`;
    ctx.font = `800 ${Math.max(14, 18 * S)}px "Arial", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const tx = maxP.x, ty = maxP.y - arm - 6 * S;
    ctx.lineWidth = Math.max(3.4, 4.4 * S);
    ctx.strokeStyle = "rgba(25,25,25,0.94)"; ctx.strokeText(txt, tx, ty);
    ctx.fillStyle = "#ffffff"; ctx.fillText(txt, tx, ty);
    ctx.restore();
  }

  // Legend box inside bottom-left map area, matching the reference composition.
  const legendPad = 18 * S;
  const legendTitleH = 34 * S;
  const itemH = 34 * S;
  const legendW = Math.min(mapW * 0.36, 470 * S);
  const legendItems: RainBand[] = legendStyle === "extreme_reference"
    ? legendBands
    : [{ min: 0, max: 0.1, color: "#ffffff", label: "无降水" }, ...legendBands];
  const legendH = legendPad * 2 + legendTitleH + legendItems.length * itemH;
  const legendX = mapX + 58 * S;
  const legendY = mapY + mapH - legendH - 42 * S;
  ctx.fillStyle = "rgba(246,246,241,0.95)";
  ctx.strokeStyle = "#606970";
  ctx.lineWidth = Math.max(1, 1.2 * S);
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeRect(legendX, legendY, legendW, legendH);
  ctx.fillStyle = "#343a40";
  ctx.font = `bold ${Math.max(17, 22 * S)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(legendStyle === "combined_overlay" ? "叠加图例（毫米）" : legendStyle === "green_reference" ? "图例（毫米）" : "图例", legendX + legendPad, legendY + legendPad + legendTitleH / 2);
  ctx.font = `${Math.max(13, 17 * S)}px "Microsoft YaHei", sans-serif`;
  legendItems.forEach((band, i) => {
    const y = legendY + legendPad + legendTitleH + i * itemH;
    ctx.fillStyle = band.color;
    ctx.fillRect(legendX + legendPad, y + 6 * S, 46 * S, 22 * S);
    ctx.strokeStyle = "rgba(75,85,99,0.62)";
    ctx.strokeRect(legendX + legendPad, y + 6 * S, 46 * S, 22 * S);
    ctx.fillStyle = "#33383d";
    ctx.fillText(band.label, legendX + legendPad + 62 * S, y + 17 * S);
  });

  // Header text, deliberately close to the reference layout while clearly marked simulated.
  const endDate = new Date(startDate.getTime() + actualEndHour * 3600000);
  const beginDate = new Date(startDate.getTime() + actualStartHour * 3600000);
  const rawNumber = String(typhoonNumber || "").replace(/\D/g, "");
  const ordinalNumber = rawNumber ? Number(rawNumber.slice(-2)) || Number(rawNumber) : 0;
  const numberText = ordinalNumber > 0 ? `第${ordinalNumber}号` : "";
  const nameText = typhoonName?.trim() || typhoon.name || "无名";
  ctx.fillStyle = "#22252a";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${Math.max(23, 31 * S)}px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
  const title = fullTrackProduct
    ? `今年${numberText}台风“${nameText}”全程累计降水图`
    : `今年${numberText}台风“${nameText}”过去${Math.round(actualWindow * 10) / 10}小时降水实况图`;
  ctx.fillText(title, width / 2, 52 * S);
  ctx.font = `500 ${Math.max(18, 25 * S)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${formatBeijingTime(beginDate)}—${formatBeijingTime(endDate)}（北京时间）`, width / 2, 96 * S);

  // Custom TyphoonSIM mark at upper left; do not reproduce the CMA logo.
  drawTyphoonMark(ctx, mapX + 55 * S, mapY + 55 * S, 31 * S);

  ctx.textAlign = "right";
  ctx.fillStyle = "#143aa6";
  ctx.font = `bold ${Math.max(17, 23 * S)}px "Microsoft YaHei", sans-serif`;
  const branding=loadAgencyBranding('rain_observed');
  ctx.fillText(branding.agencyName, mapX + mapW - 25 * S, mapY + 38 * S, mapW*.33);
  ctx.font = `bold ${Math.max(14, 18 * S)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(formatIssueTime(endDate).replace(/制作$/, branding.makerSuffix), mapX + mapW - 25 * S, mapY + 67 * S, mapW*.33);

  throwIfCancelled();
  progress(100);
}
