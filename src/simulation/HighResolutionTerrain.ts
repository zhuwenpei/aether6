import { getEtopoTerrainDiagnostics, getEtopoTerrainElevation } from "./EtopoTerrain";

/**
 * Synoptic-product terrain provider.
 *
 * The simulator core intentionally keeps its compact embedded ETOPO1-derived grid, but the
 * high-resolution wind/pressure product can opportunistically fetch NOAA/NCEI ETOPO 2022
 * 60-arc-second elevations through ERDDAP.  We decimate the native 1' source to ~0.10° because
 * that matches the finest synoptic solver grid; using finer terrain than the momentum grid adds
 * cost without adding resolvable dynamics.
 *
 * Tiles are cached for the life of the page and every caller has a deterministic embedded
 * fallback, so a blocked/offline ERDDAP endpoint never prevents product generation.
 */

const NATIVE_STEP = 1 / 60;
const LAT0 = -89 + 1 / 120; // -89.991666...
const LON0 = 1 / 120;       // 0.008333...
const LAT_COUNT = 10_800;
const LON_COUNT = 21_600;
const TARGET_STRIDE = 6;     // 6 * 1' = 0.10°
const TARGET_STEP = NATIVE_STEP * TARGET_STRIDE;
const TILE_DEG = 12;
const MAX_TILES_PER_PREPARE = 48;

const ERDDAP_ENDPOINTS = [
  // This 60-arc-second ETOPO 2022 dataset is published on NOAA/NCEI-backed ERDDAP.
  // The longitude axis is 0..360, which is exactly what the WNP synoptic domain uses.
  "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.csv0",
  "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.csv0"
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface HighResolutionTerrainBounds {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

interface TerrainTile {
  key: string;
  lat0: number;
  lon0: number;
  stepLat: number;
  stepLon: number;
  nx: number;
  ny: number;
  elevation: Float32Array;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export interface SynopticTerrainDiagnostics {
  elevation: number;
  slopeEastMPerKm: number;
  slopeNorthMPerKm: number;
  localReliefM: number;
  neighborhoodMeanM: number;
  source: "ETOPO 2022 60-arc-second / 0.10deg synoptic cache" | "embedded ETOPO1-derived fallback";
  resolutionDeg: number;
}

const loadedTiles = new Map<string, TerrainTile>();
const pendingTiles = new Map<string, Promise<TerrainTile | null>>();
const failedTiles = new Set<string>();

async function fetchTerrainWithTimeout(url: string, signal?: AbortSignal, timeoutMs = 6500): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "force-cache", mode: "cors" });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function wrapLon360(lon: number) {
  let x = lon % 360;
  if (x < 0) x += 360;
  return x;
}

function indexForLat(lat: number) {
  return clamp(Math.round((lat - LAT0) / NATIVE_STEP), 0, LAT_COUNT - 1);
}

function indexForLon(lon360: number) {
  return clamp(Math.round((wrapLon360(lon360) - LON0) / NATIVE_STEP), 0, LON_COUNT - 1);
}

function coordinateFromLatIndex(i: number) { return LAT0 + i * NATIVE_STEP; }
function coordinateFromLonIndex(i: number) { return LON0 + i * NATIVE_STEP; }

function tileOrigin(v: number) {
  return Math.floor(v / TILE_DEG) * TILE_DEG;
}

function tileKey(latOrigin: number, lonOrigin: number) {
  return `${latOrigin.toFixed(0)}|${wrapLon360(lonOrigin).toFixed(0)}|${TARGET_STRIDE}`;
}

function makeTileSpec(latOrigin: number, lonOrigin: number) {
  // One target-grid sample of overlap on every side prevents seams during bilinear sampling.
  const latMin = clamp(latOrigin - TARGET_STEP, -89.9, 89.9);
  const latMax = clamp(latOrigin + TILE_DEG + TARGET_STEP, -89.9, 89.9);
  const lonMin = wrapLon360(lonOrigin - TARGET_STEP);
  const lonMaxRaw = lonOrigin + TILE_DEG + TARGET_STEP;
  // WNP calculation domains do not span the 0° seam; keep this path deliberately simple.
  const lonMax = wrapLon360(lonMaxRaw);
  const latI0 = indexForLat(latMin);
  const latI1 = indexForLat(latMax);
  const lonI0 = indexForLon(lonMin);
  const lonI1 = indexForLon(lonMax);
  return { latI0: Math.min(latI0, latI1), latI1: Math.max(latI0, latI1), lonI0: Math.min(lonI0, lonI1), lonI1: Math.max(lonI0, lonI1) };
}

async function fetchTile(latOrigin: number, lonOrigin: number, signal?: AbortSignal): Promise<TerrainTile | null> {
  const key = tileKey(latOrigin, lonOrigin);
  const hit = loadedTiles.get(key);
  if (hit) return hit;
  if (failedTiles.has(key)) return null;
  const existing = pendingTiles.get(key);
  if (existing) return existing;

  const task = (async () => {
    const { latI0, latI1, lonI0, lonI1 } = makeTileSpec(latOrigin, lonOrigin);
    const ny = Math.floor((latI1 - latI0) / TARGET_STRIDE) + 1;
    const nx = Math.floor((lonI1 - lonI0) / TARGET_STRIDE) + 1;
    const query = `?z[${latI0}:${TARGET_STRIDE}:${latI1}][${lonI0}:${TARGET_STRIDE}:${lonI1}]`;
    let lastError: unknown = null;
    for (const endpoint of ERDDAP_ENDPOINTS) {
      try {
        const response = await fetchTerrainWithTimeout(endpoint + query, signal);
        if (!response.ok) throw new Error(`ETOPO ERDDAP HTTP ${response.status}`);
        const text = await response.text();
        const values: number[] = [];
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const parts = line.split(",");
          if (parts.length < 3) continue;
          const z = Number(parts[parts.length - 1]);
          const lat = Number(parts[0]);
          const lon = Number(parts[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(z) || z < -90_000) continue;
          values.push(z);
        }
        if (values.length !== nx * ny) throw new Error(`ETOPO tile size mismatch ${values.length} != ${nx * ny}`);
        const tile: TerrainTile = {
          key,
          lat0: coordinateFromLatIndex(latI0),
          lon0: coordinateFromLonIndex(lonI0),
          stepLat: TARGET_STEP,
          stepLon: TARGET_STEP,
          nx,
          ny,
          elevation: Float32Array.from(values),
          latMin: coordinateFromLatIndex(latI0),
          latMax: coordinateFromLatIndex(latI0 + (ny - 1) * TARGET_STRIDE),
          lonMin: coordinateFromLonIndex(lonI0),
          lonMax: coordinateFromLonIndex(lonI0 + (nx - 1) * TARGET_STRIDE)
        };
        loadedTiles.set(key, tile);
        return tile;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    console.warn("High-resolution ETOPO terrain unavailable; using embedded terrain fallback", lastError);
    failedTiles.add(key);
    return null;
  })().finally(() => pendingTiles.delete(key));

  pendingTiles.set(key, task);
  return task;
}

/** Preload the terrain tiles intersecting the actual synoptic computation grid. */
export async function prepareHighResolutionTerrain(bounds: HighResolutionTerrainBounds, _solverStepDeg: number, signal?: AbortSignal, onProgress?: (fraction: number) => void) {
  const latStart = tileOrigin(clamp(bounds.latMin, -72, 72));
  const latEnd = tileOrigin(clamp(bounds.latMax, -72, 72));
  const lonStart = tileOrigin(wrapLon360(bounds.lonMin));
  const lonEnd = tileOrigin(wrapLon360(bounds.lonMax));
  if (lonEnd < lonStart) return; // not expected for current WNP product domains
  const specs: Array<[number, number]> = [];
  for (let la = latStart; la <= latEnd + 1e-6; la += TILE_DEG) {
    for (let lo = lonStart; lo <= lonEnd + 1e-6; lo += TILE_DEG) specs.push([la, lo]);
  }
  if (specs.length > MAX_TILES_PER_PREPARE) return;
  if (!specs.length) { onProgress?.(1); return; }

  // Same 0.10° source/detail, but fetch independent tiles in larger batches so the terrain-prep
  // phase is network-bound for much less wall time. Per-endpoint timeout above prevents a stalled
  // ERDDAP mirror from pinning the whole export.
  const batchSize = 8;
  for (let i = 0; i < specs.length; i += batchSize) {
    if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
    const batch = specs.slice(i, i + batchSize);
    await Promise.all(batch.map(([la, lo]) => fetchTile(la, lo, signal)));
    onProgress?.(Math.min(1, (i + batch.length) / specs.length));
  }
}

function tileForPoint(lat: number, lon: number): TerrainTile | null {
  const lon360 = wrapLon360(lon);
  const primary = loadedTiles.get(tileKey(tileOrigin(lat), tileOrigin(lon360)));
  if (primary && lat >= primary.latMin && lat <= primary.latMax && lon360 >= primary.lonMin && lon360 <= primary.lonMax) return primary;
  // Overlap makes boundary points occasionally belong to a neighbouring cached tile.
  for (const tile of loadedTiles.values()) {
    if (lat >= tile.latMin && lat <= tile.latMax && lon360 >= tile.lonMin && lon360 <= tile.lonMax) return tile;
  }
  return null;
}

function bilinear(tile: TerrainTile, lat: number, lon: number) {
  const lon360 = wrapLon360(lon);
  const fx = (lon360 - tile.lon0) / tile.stepLon;
  const fy = (lat - tile.lat0) / tile.stepLat;
  const x0 = clamp(Math.floor(fx), 0, tile.nx - 1);
  const y0 = clamp(Math.floor(fy), 0, tile.ny - 1);
  const x1 = Math.min(tile.nx - 1, x0 + 1);
  const y1 = Math.min(tile.ny - 1, y0 + 1);
  const tx = clamp(fx - Math.floor(fx), 0, 1);
  const ty = clamp(fy - Math.floor(fy), 0, 1);
  const v00 = tile.elevation[y0 * tile.nx + x0];
  const v10 = tile.elevation[y0 * tile.nx + x1];
  const v01 = tile.elevation[y1 * tile.nx + x0];
  const v11 = tile.elevation[y1 * tile.nx + x1];
  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  return v0 * (1 - ty) + v1 * ty;
}

export function getSynopticTerrainElevation(lat: number, lon: number): { elevation: number; highResolution: boolean } {
  const tile = tileForPoint(lat, lon);
  if (tile) return { elevation: bilinear(tile, lat, lon), highResolution: true };
  return { elevation: getEtopoTerrainElevation(lat, lon) ?? 0, highResolution: false };
}

/**
 * Terrain derivatives at approximately the same horizontal scale as the synoptic momentum grid.
 * High-resolution slopes use 0.10–0.20° stencils; the embedded fallback keeps the legacy ETOPO
 * diagnostics so offline behaviour remains deterministic.
 */
export function getSynopticTerrainDiagnostics(lat: number, lon: number, solverStepDeg = 0.1): SynopticTerrainDiagnostics {
  const center = getSynopticTerrainElevation(lat, lon);
  if (!center.highResolution) {
    const fallback = getEtopoTerrainDiagnostics(lat, lon);
    return {
      elevation: fallback?.elevation ?? center.elevation,
      slopeEastMPerKm: fallback?.slopeEastMPerKm ?? 0,
      slopeNorthMPerKm: fallback?.slopeNorthMPerKm ?? 0,
      localReliefM: fallback?.localReliefM ?? 0,
      neighborhoodMeanM: fallback?.neighborhoodMeanM ?? center.elevation,
      source: "embedded ETOPO1-derived fallback",
      resolutionDeg: 0.25
    };
  }

  const d = clamp(Math.max(TARGET_STEP, solverStepDeg * 0.8), TARGET_STEP, 0.20);
  const broad = Math.max(0.30, d * 2.5);
  const sample = (la: number, lo: number) => getSynopticTerrainElevation(la, lo).elevation;
  const c = center.elevation;
  const e = sample(lat, lon + d), w = sample(lat, lon - d);
  const n = sample(lat + d, lon), s = sample(lat - d, lon);
  const ne = sample(lat + d, lon + d), nw = sample(lat + d, lon - d);
  const se = sample(lat - d, lon + d), sw = sample(lat - d, lon - d);
  const e2 = sample(lat, lon + broad), w2 = sample(lat, lon - broad);
  const n2 = sample(lat + broad, lon), s2 = sample(lat - broad, lon);
  const cosLat = Math.max(0.20, Math.cos(lat * Math.PI / 180));
  const kmLon = 111.12 * d * cosLat;
  const kmLat = 111.12 * d;
  const slopeEastMPerKm = (e - w) / Math.max(1, 2 * kmLon);
  const slopeNorthMPerKm = (n - s) / Math.max(1, 2 * kmLat);
  const neighborhood = [c, e, w, n, s, ne, nw, se, sw, e2, w2, n2, s2];
  return {
    elevation: c,
    slopeEastMPerKm,
    slopeNorthMPerKm,
    localReliefM: Math.max(...neighborhood) - Math.min(...neighborhood),
    neighborhoodMeanM: neighborhood.reduce((a, b) => a + b, 0) / neighborhood.length,
    source: "ETOPO 2022 60-arc-second / 0.10deg synoptic cache",
    resolutionDeg: TARGET_STEP
  };
}

export const SYNOPTIC_TERRAIN_INFO = Object.freeze({
  source: "NOAA/NCEI ETOPO 2022 60-arc-second via ERDDAP",
  nativeStepDegrees: NATIVE_STEP,
  synopticStepDegrees: TARGET_STEP,
  fallback: "embedded ETOPO1-derived 0.25deg grid"
});
