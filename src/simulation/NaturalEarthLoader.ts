/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as turf from "@turf/turf";
import RBush from "rbush";

// 1. Export required Turf.js spatial calculation functions
export const booleanPointInPolygon = turf.booleanPointInPolygon;
export const lineIntersect = turf.lineIntersect;
export const point = turf.point;
export const lineString = turf.lineString;
export const polygonToLine = turf.polygonToLine;
export const distance = turf.distance;


/** Adjusted live-simulation detailed coastline envelope (with the asymmetric north/west extensions). */
export const PRODUCT_COASTLINE_SEAM_BOUNDS = { west: 65, south: -20, east: 180, north: 90 } as const;
/**
 * Product/offline plate is kept at least 35 degrees wider than the adjusted live dataset wherever
 * the globe physically permits it. East of 180E is represented with wrapped longitudes; v3 now extends through 110W (250E), 30° farther east than v2.
 */
export const PRODUCT_COASTLINE_DETAIL_BOUNDS = { west: 30, south: -55, eastWrapped: -110, north: 90 } as const;
/** Historical v2 envelope, retained for seam suppression and old regression compatibility. */
export const PRODUCT_COASTLINE_DETAIL_BOUNDS_V2 = { west: 30, south: -55, eastWrapped: -140, north: 90 } as const;
export const PRODUCT_COASTLINE_RENDER_MARGIN_DEG = 35;
export const SIMULATION_COASTLINE_RENDER_MARGIN_DEG = 20;

/**
 * Suppress only artificial clipping/join edges.  The actual product data now contains
 * intermediate/high-resolution coastline geometry throughout the expanded product belt; this helper
 * is no longer being used to disguise a low-resolution or missing outer map.
 */
export function isProductCoastlineSeamSegment(a: [number, number], b: [number, number], eps = 1e-5): boolean {
  const core = PRODUCT_COASTLINE_SEAM_BOUNDS;
  const ext = PRODUCT_COASTLINE_DETAIL_BOUNDS;
  const same = (x: number, y: number) => Math.abs(x - y) <= eps;
  const between = (x: number, lo: number, hi: number) => x >= lo - eps && x <= hi + eps;
  const vertical = (lon: number, minLat: number, maxLat: number) =>
    same(a[0], lon) && same(b[0], lon) && between(a[1], minLat, maxLat) && between(b[1], minLat, maxLat);
  const horizontal = (lat: number, minLon: number, maxLon: number) =>
    same(a[1], lat) && same(b[1], lat) && between(a[0], minLon, maxLon) && between(b[0], minLon, maxLon);

  return vertical(core.west, core.south, core.north) ||
    vertical(core.east, core.south, core.north) ||
    horizontal(core.south, core.west, core.east) ||
    horizontal(core.north, core.west, core.east) ||
    vertical(ext.west, ext.south, ext.north) ||
    vertical(ext.eastWrapped, ext.south, ext.north) ||
    vertical(PRODUCT_COASTLINE_DETAIL_BOUNDS_V2.eastWrapped, ext.south, ext.north) ||
    horizontal(ext.south, ext.west, 180) ||
    horizontal(ext.south, -180, ext.eastWrapped) ||
    horizontal(ext.north, ext.west, 180) ||
    horizontal(ext.north, -180, ext.eastWrapped) ||
    vertical(180, ext.south, ext.north) || vertical(-180, ext.south, ext.north);
}

// 2. Global cached GeoJSON variables
export let landGeoJson: any = null;
export let countriesGeoJson: any = null;

// Product-only GIS plate. It is never consulted by live cyclone physics. The wide product plate
// is fetched lazily only by ensemble/weather-product/report code, preserving live-map smoothness.
export let productLandGeoJson: any = null;
export let productCountriesGeoJson: any = null;
/** Fine coastline-only geometry for weather products, dissolved directly from the product land plate; never sourced from admin/country polygons. */
export let productCoastlineGeoJson: any = null;

// Spatial indexing items with RBush
export interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  feature: any;
}

interface BoundarySegmentItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  p1: any;
  p2: any;
}

interface ContainmentEdgeItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  polygonPartId: number;
}

export const landTree = new RBush<SpatialItem>();
const landBoundaryTree = new RBush<BoundarySegmentItem>();
// Exact coastline edges used only for live point-in-land classification. Unlike landTree,
// this index never selects an entire 20k-point Eurasia/Pacific polygon just because its bbox
// covers a remote ocean point.
const landContainmentEdgeTree = new RBush<ContainmentEdgeItem>();
export const countriesTree = new RBush<SpatialItem>();
// Product-only spatial index. It is built lazily with the large coastline plate and is never
// consulted by the live simulation, so runtime physics keeps the lighter simulation dataset.
export const productLandTree = new RBush<SpatialItem>();

// Loading status types
export type GeoJsonLoadStatus = "idle" | "loading" | "success" | "error";

export interface GeoJsonLoaderState {
  status: GeoJsonLoadStatus;
  message: string;
  landLoaded: boolean;
  countriesLoaded: boolean;
}

let loaderState: GeoJsonLoaderState = {
  status: "idle",
  message: "",
  landLoaded: false,
  countriesLoaded: false
};

const listeners: Set<(state: GeoJsonLoaderState) => void> = new Set();

export function getLoaderState(): GeoJsonLoaderState {
  return loaderState;
}

export function subscribeLoaderState(listener: (state: GeoJsonLoaderState) => void): () => void {
  listeners.add(listener);
  listener(loaderState);
  return () => listeners.delete(listener);
}

function updateState(newState: Partial<GeoJsonLoaderState>) {
  loaderState = { ...loaderState, ...newState };
  listeners.forEach((fn) => fn(loaderState));
}

let loadPromise: Promise<boolean> | null = null;

/**
 * Loads landGeoJson and countriesGeoJson once at app startup and caches them.
 * Built directly from the preprocessed and optimized files.
 */
export async function loadNaturalEarthData(): Promise<boolean> {
  if (landGeoJson && countriesGeoJson) {
    updateState({ status: "success", message: "", landLoaded: true, countriesLoaded: true });
    return true;
  }

  if (loadPromise) {
    return loadPromise;
  }

  updateState({
    status: "loading",
    message: "正在加载海岸线数据...",
    landLoaded: false,
    countriesLoaded: false
  });

  const baseUrl = (import.meta as any).env?.BASE_URL || "/";
  const landUrls = [
    `${baseUrl}data/simulation_land_asymmetric_v2.geojson`.replace("//", "/"),
    "data/simulation_land_asymmetric_v2.geojson",
    "./data/simulation_land_asymmetric_v2.geojson",
    `${baseUrl}data/pacific_land_lite.geojson`.replace("//", "/"),
    "data/pacific_land_lite.geojson"
  ];
  const countryUrls = [
    `${baseUrl}data/simulation_countries_asymmetric_v2.geojson`.replace("//", "/"),
    "data/simulation_countries_asymmetric_v2.geojson",
    "./data/simulation_countries_asymmetric_v2.geojson",
    `${baseUrl}data/pacific_countries_lite.geojson`.replace("//", "/"),
    "data/pacific_countries_lite.geojson"
  ];

  async function fetchWithFallback(urls: string[]) {
    let lastError = null;
    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);
      try {
        console.log(`[GeoJSON Loader] Trying to fetch from: ${url}`);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return res;
        console.warn(`[GeoJSON Loader] Fetch from ${url} returned status ${res.status}`);
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        console.warn(`[GeoJSON Loader] Failed to fetch from ${url}`, e);
      }
    }
    throw lastError || new Error(`Failed to fetch from any of: ${urls.join(", ")}`);
  }

  loadPromise = (async () => {
    try {
      const [landRes, countriesRes] = await Promise.all([
        fetchWithFallback(landUrls),
        fetchWithFallback(countryUrls)
      ]);

      const landData = await landRes.json();
      const countriesData = await countriesRes.json();

      landGeoJson = landData;
      countriesGeoJson = countriesData;

      // Build RBush spatial indexes
      if (landGeoJson && landGeoJson.features) {
        const landItems: SpatialItem[] = landGeoJson.features.map((feat: any) => {
          const bbox = feat.properties.BBOX || [-180, -90, 180, 90];
          return {
            minX: bbox[0],
            minY: bbox[1],
            maxX: bbox[2],
            maxY: bbox[3],
            feature: feat
          };
        });
        landTree.clear();
        landTree.load(landItems);

        // Distance-to-coast queries need segment-level locality. A feature/ring bbox can span
        // thousands of kilometres (the largest live coastline ring has ~18k coordinates and a
        // bbox covering most of the western Pacific). Selecting that container offshore would
        // still force a long synchronous traversal. Index the exact sampled segments used by the
        // legacy distance calculation so each query only measures nearby coastline pieces.
        const boundaryItems: BoundarySegmentItem[] = [];
        const containmentItems: ContainmentEdgeItem[] = [];
        let polygonPartId = 0;
        for (const feat of landGeoJson.features) {
          const geom = feat?.geometry;
          const polygons = geom?.type === "Polygon"
            ? [geom.coordinates]
            : geom?.type === "MultiPolygon"
              ? geom.coordinates
              : [];
          for (const poly of polygons) {
            const currentPartId = polygonPartId++;
            for (const ring of poly) {
              if (!Array.isArray(ring) || ring.length < 2) continue;
              const ringLen = ring.length;

              // Exact edge index for point-in-land ray casting.  The old feature-level RBush
              // selected a 20,308-coordinate polygon across almost the entire W Pacific, so every
              // moving terrain/core sample offshore paid an O(20k) Turf point-in-polygon scan.
              // Grouping outer + hole rings by polygonPartId preserves GeoJSON even/odd semantics.
              const exactEdgeCount = ringLen - 1 + (ring[0]?.[0] !== ring[ringLen - 1]?.[0] || ring[0]?.[1] !== ring[ringLen - 1]?.[1] ? 1 : 0);
              for (let edgeIndex = 0; edgeIndex < exactEdgeCount; edgeIndex++) {
                const p1 = ring[edgeIndex % ringLen];
                const p2 = ring[(edgeIndex + 1) % ringLen];
                const x1 = Number(p1?.[0]);
                const y1 = Number(p1?.[1]);
                const x2 = Number(p2?.[0]);
                const y2 = Number(p2?.[1]);
                if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
                containmentItems.push({
                  minX: Math.min(x1, x2), minY: Math.min(y1, y2),
                  maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
                  x1, y1, x2, y2, polygonPartId: currentPartId
                });
              }

              // Distance queries intentionally retain the legacy sampled-boundary geometry.  It is
              // a separate index from exact containment so Round129 distance semantics stay intact.
              const step = ringLen > 5000 ? 20 : (ringLen > 1000 ? 5 : 1);
              for (let i = 0; i < ringLen - 1; i += step) {
                const p1 = ring[i];
                const p2 = ring[Math.min(i + step, ringLen - 1)];
                const x1 = Number(p1?.[0]);
                const y1 = Number(p1?.[1]);
                const x2 = Number(p2?.[0]);
                const y2 = Number(p2?.[1]);
                if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
                boundaryItems.push({
                  minX: Math.min(x1, x2), minY: Math.min(y1, y2),
                  maxX: Math.max(x1, x2), maxY: Math.max(y1, y2), p1, p2
                });
              }
            }
          }
        }
        landBoundaryTree.clear();
        landBoundaryTree.load(boundaryItems);
        landContainmentEdgeTree.clear();
        landContainmentEdgeTree.load(containmentItems);
      }

      if (countriesGeoJson && countriesGeoJson.features) {
        const countryItems: SpatialItem[] = countriesGeoJson.features.map((feat: any) => {
          const bbox = feat.properties.BBOX || [-180, -90, 180, 90];
          return {
            minX: bbox[0],
            minY: bbox[1],
            maxX: bbox[2],
            maxY: bbox[3],
            feature: feat
          };
        });
        countriesTree.clear();
        countriesTree.load(countryItems);
      }

      console.log(`[GeoJSON Loader] Loaded optimized GIS data. Land Polygons Indexed = ${landTree.all().length}`);

      updateState({
        status: "success",
        message: "",
        landLoaded: !!landGeoJson,
        countriesLoaded: !!countriesGeoJson
      });
      return true;
    } catch (err: any) {
      console.error("[GeoJSON Loader] Natural Earth data loading error:", err);
      updateState({
        status: "error",
        message: `海岸线数据加载失败: ${err.message || "未知错误"}`,
        landLoaded: !!landGeoJson,
        countriesLoaded: !!countriesGeoJson
      });
      return false;
    }
  })();

  return loadPromise;
}

let productLoadPromise: Promise<boolean> | null = null;

/**
 * Lazily load the wide-coverage coastline/admin plate used by generated images and reports.
 * Unlike loadNaturalEarthData(), this never touches the RBush trees used by the live model.
 * The bundled product plate keeps global fallback coverage and, more importantly, a high-density
 * coastline plate dissolved directly from land geometry. Country/admin polygons are loaded separately
 * for products that need names, but are never used as a coastline source.
 * This prevents low-zoom ensemble/weather products from exposing the old dataset edge.  Seam
 * suppression is only a secondary visual guard at source-plate joins.
 */
export async function loadProductNaturalEarthData(): Promise<boolean> {
  if (productLandGeoJson && productCountriesGeoJson && productCoastlineGeoJson) return true;
  if (productLoadPromise) return productLoadPromise;

  const baseUrl = (import.meta as any).env?.BASE_URL || "/";
  const landUrls = [
    `${baseUrl}data/product_land_wide_v3.geojson`.replace("//", "/"),
    "data/product_land_wide_v3.geojson",
    "./data/product_land_wide_v3.geojson",
    `${baseUrl}data/product_land_wide_v2.geojson`.replace("//", "/"),
    "data/product_land_wide_v2.geojson",
    "./data/product_land_wide_v2.geojson"
  ];
  const coastlineUrls = [
    `${baseUrl}data/product_coastline_fine_v5.geojson`.replace("//", "/"),
    "data/product_coastline_fine_v5.geojson",
    "./data/product_coastline_fine_v5.geojson"
  ];
  const countryUrls = [
    // 5.2.21: product/report maps prefer the denser admin-0 plate. It replaces the most
    // visibly coarse West-Pacific Natural Earth polygons with bundled 1:10m overlays while
    // retaining the wide-coverage fallback underneath, so clipped detail never removes coverage. Live-model land checks stay on
    // the lighter simulation plate and are therefore unaffected by this rendering upgrade.
    `${baseUrl}data/product_countries_highdetail_v3.geojson`.replace("//", "/"),
    "data/product_countries_highdetail_v3.geojson",
    "./data/product_countries_highdetail_v3.geojson",
    `${baseUrl}data/product_countries_wide_v2.geojson`.replace("//", "/"),
    "data/product_countries_wide_v2.geojson",
    "./data/product_countries_wide_v2.geojson"
  ];

  const fetchProductWithFallback = async (urls: string[]) => {
    let lastError: unknown = null;
    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return res;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
      }
    }
    throw lastError || new Error(`Failed to fetch product GIS data from: ${urls.join(", ")}`);
  };

  productLoadPromise = (async () => {
    try {
      const [landRes, countryRes, coastlineRes] = await Promise.all([
        fetchProductWithFallback(landUrls),
        fetchProductWithFallback(countryUrls),
        fetchProductWithFallback(coastlineUrls)
      ]);
      const [wideLand, wideCountries, coastlineOnly] = await Promise.all([landRes.json(), countryRes.json(), coastlineRes.json()]);
      productLandGeoJson = wideLand;
      productCountriesGeoJson = wideCountries;
      productCoastlineGeoJson = coastlineOnly;
      if (productLandGeoJson?.features) {
        const productItems: SpatialItem[] = productLandGeoJson.features.map((feat: any) => {
          const bbox = feat.properties?.BBOX || turf.bbox(feat);
          return { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3], feature: feat };
        });
        productLandTree.clear();
        productLandTree.load(productItems);
        productLandCache.clear();
      }
      if (typeof window !== "undefined") window.dispatchEvent(new Event("product-map-data-loaded"));
      return true;
    } catch (err) {
      console.warn("[GeoJSON Loader] Extended product coastline unavailable; falling back to live plate.", err);
      await loadNaturalEarthData();
      productLandGeoJson = landGeoJson;
      productCountriesGeoJson = countriesGeoJson;
      productCoastlineGeoJson = landGeoJson;
      productLandTree.clear();
      if (productLandGeoJson?.features) {
        productLandTree.load(productLandGeoJson.features.map((feat: any) => {
          const bbox = feat.properties?.BBOX || turf.bbox(feat);
          return { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3], feature: feat };
        }));
      }
      productLandCache.clear();
      return !!(productLandGeoJson && productCountriesGeoJson);
    }
  })().finally(() => {
    productLoadPromise = null;
  });

  return productLoadPromise;
}

export const getProductLandGeoJson = () => productLandGeoJson || landGeoJson;
export const getProductCountriesGeoJson = () => productCountriesGeoJson || countriesGeoJson;
export const getProductCoastlineGeoJson = () => productCoastlineGeoJson || productLandGeoJson || landGeoJson;

// English to Simplified Chinese country name lookup map for the West Pacific and marginal areas
const COUNTRY_ZH_MAP: Record<string, string> = {
  "China": "中国",
  "Taiwan": "中国台湾",
  "Japan": "日本",
  "Philippines": "菲律宾",
  "Vietnam": "越南",
  "South Korea": "韩国",
  "Korea": "韩国",
  "North Korea": "朝鲜",
  "Dem. People's Rep. Korea": "朝鲜",
  "Russia": "俄罗斯",
  "Russian Federation": "俄罗斯",
  "United States": "美国",
  "United States of America": "美国",
  "Guam": "关岛",
  "Northern Mariana Islands": "北马里亚纳群岛",
  "Malaysia": "马来西亚",
  "Indonesia": "印度尼西亚",
  "Brunei": "文莱",
  "Brunei Darussalam": "文莱",
  "Cambodia": "柬埔寨",
  "Thailand": "泰国",
  "Laos": "老挝",
  "Lao PDR": "老挝",
  "Hong Kong": "中国香港",
  "Macao": "中国澳门",
  "Macau": "中国澳门"
};

function normalizeGeoLon(lon: number): number {
  let x = Number(lon);
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

const landCache = new Map<string, boolean>();
const productLandCache = new Map<string, boolean>();

/**
 * Spatial calculation: Check if point (lat, lon) is on land using landGeoJson and RBush.
 * Achieves O(log N) performance, executing in less than 2 microseconds.
 * Accelerated with a high-precision spatial cache to achieve sub-nanosecond lookups.
 */
export function checkPointOnLandGeoJson(lat: number, lon: number): boolean {
  if (!landGeoJson || !landGeoJson.features) return false;

  // High-precision key (approx 11m resolution) preserves the existing coastline semantics.
  const queryLon = normalizeGeoLon(lon);
  const key = `${Math.round(lat * 10000)},${Math.round(queryLon * 10000)}`;
  if (landCache.has(key)) return landCache.get(key)!;

  let result = false;
  try {
    // Round130: exact edge-ray containment instead of feature-level Turf scans.
    //
    // simulation_land_asymmetric_v2 contains one 20,308-coordinate Polygon whose BBOX spans
    // roughly 65E..180E / 1N..74N.  The old landTree point query therefore selected that whole
    // feature for almost every western-Pacific ocean sample.  Live physics asks this question
    // dozens of times per 10-minute step (core friction, land coverage, terrain, forecast), so a
    // nominal O(log N) RBush lookup still became O(20k) inside booleanPointInPolygon.
    //
    // A horizontal ray only needs coastline edges that cross the queried latitude and lie east of
    // the point.  landContainmentEdgeTree stores every edge exactly (unlike the sampled Round129
    // distance tree).  Toggling parity per polygon part naturally handles holes while OR-ing the
    // surviving odd parts preserves MultiPolygon/overlap semantics.
    const edges = landContainmentEdgeTree.search({
      minX: queryLon,
      minY: lat,
      maxX: 180,
      maxY: lat
    });
    const oddParts = new Set<number>();
    const boundaryEpsilon = 1e-10;

    for (const edge of edges) {
      const { x1, y1, x2, y2 } = edge;
      const dx = x2 - x1;
      const dy = y2 - y1;

      // Turf's default booleanPointInPolygon treats the polygon boundary as land. Match that
      // behaviour before applying the half-open ray-crossing rule.
      const cross = (queryLon - x1) * dy - (lat - y1) * dx;
      const crossTolerance = boundaryEpsilon * Math.max(1, Math.abs(dx) + Math.abs(dy));
      if (Math.abs(cross) <= crossTolerance &&
          queryLon >= edge.minX - boundaryEpsilon && queryLon <= edge.maxX + boundaryEpsilon &&
          lat >= edge.minY - boundaryEpsilon && lat <= edge.maxY + boundaryEpsilon) {
        result = true;
        break;
      }

      // Half-open Y comparison avoids double-counting shared vertices, identical to the ordinary
      // even/odd point-in-polygon rule. Horizontal edges cannot cross the ray.
      if ((y1 > lat) === (y2 > lat)) continue;
      const intersectX = x1 + ((lat - y1) * dx) / dy;
      if (intersectX <= queryLon) continue;

      if (oddParts.has(edge.polygonPartId)) oddParts.delete(edge.polygonPartId);
      else oddParts.add(edge.polygonPartId);
    }

    if (!result) result = oddParts.size > 0;
  } catch {
    // Fail ocean on malformed geometry, matching the prior guarded live-land behaviour.
    result = false;
  }

  if (landCache.size > 200000) landCache.clear();
  landCache.set(key, result);
  return result;
}

/**
 * Conservative live-physics proximity test backed by the exact containment-edge index.
 *
 * Returns false only when there is provably no coastline edge inside a rectangle that fully
 * encloses the requested radius. Callers may therefore skip expensive multi-point land samplers
 * for an ocean centre without changing any near-coast/land result. A true result is deliberately
 * conservative (an edge in a rectangle corner may lie outside the circle), which only disables
 * the optimization and never invents ocean.
 */
export function hasLandBoundaryWithinKmGeoJson(lat: number, lon: number, radiusKm: number): boolean {
  if (!landGeoJson || !landGeoJson.features || radiusKm <= 0) return !!landGeoJson;

  const queryLon = normalizeGeoLon(lon);
  // 110 km/degree is intentionally a little smaller than the real meridional scale, making the
  // search box slightly larger than the requested physical circle.
  const latRadius = radiusKm / 110.0;
  const cosLat = Math.max(0.12, Math.cos(lat * Math.PI / 180));
  const lonRadius = Math.min(180, radiusKm / (110.0 * cosLat));
  const minY = Math.max(-90, lat - latRadius);
  const maxY = Math.min(90, lat + latRadius);
  const rawMinX = queryLon - lonRadius;
  const rawMaxX = queryLon + lonRadius;

  const boxes: Array<{ minX: number; maxX: number }> = [];
  if (rawMinX < -180) {
    boxes.push({ minX: -180, maxX: rawMaxX });
    boxes.push({ minX: rawMinX + 360, maxX: 180 });
  } else if (rawMaxX > 180) {
    boxes.push({ minX: rawMinX, maxX: 180 });
    boxes.push({ minX: -180, maxX: rawMaxX - 360 });
  } else {
    boxes.push({ minX: rawMinX, maxX: rawMaxX });
  }

  for (const box of boxes) {
    if (landContainmentEdgeTree.search({ minX: box.minX, minY, maxX: box.maxX, maxY }).length > 0) {
      return true;
    }
  }
  return false;
}


/**
 * Product-only land test using the large, wide-coverage coastline plate. Ensemble/product
 * calculations call this explicitly; live cyclone physics continues to use checkPointOnLandGeoJson.
 */
export function checkPointOnProductLandGeoJson(lat: number, lon: number): boolean {
  if (!productLandGeoJson || !productLandGeoJson.features) return checkPointOnLandGeoJson(lat, lon);

  const queryLon = normalizeGeoLon(lon);
  const key = `${Math.round(lat * 10000)},${Math.round(queryLon * 10000)}`;
  if (productLandCache.has(key)) return productLandCache.get(key)!;

  let result = false;
  try {
    const pt = point([queryLon, lat]);
    const candidates = productLandTree.search({ minX: queryLon, minY: lat, maxX: queryLon, maxY: lat });
    // The tree should exist after loadProductNaturalEarthData(). Fall back to a direct scan only
    // for hot-reload/legacy states where the GeoJSON binding exists before its index was built.
    const features = candidates.length ? candidates.map((item) => item.feature) : productLandGeoJson.features;
    for (const feature of features) {
      if (booleanPointInPolygon(pt, feature)) { result = true; break; }
    }
  } catch {
    result = false;
  }

  if (productLandCache.size > 200000) productLandCache.clear();
  productLandCache.set(key, result);
  return result;
}

/**
 * Spatial calculation: Get landfall country or region name at (lat, lon) using countriesGeoJson and RBush.
 */
export function getLandfallCountryGeoJson(lat: number, lon: number): { country: string; admin: string } | null {
  if (!countriesGeoJson || !countriesGeoJson.features) return null;
  try {
    const queryLon = normalizeGeoLon(lon);
    const pt = point([queryLon, lat]);
    // Query RBush tree for candidate country polygons overlapping the point
    const candidates = countriesTree.search({
      minX: queryLon,
      minY: lat,
      maxX: queryLon,
      maxY: lat
    });

    for (const c of candidates) {
      if (booleanPointInPolygon(pt, c.feature)) {
        const props = c.feature.properties || {};
        const rawCountry = props.NAME_ZH || props.NAME_LONG || props.NAME || props.ADMIN || "未知国家/地区";
        const rawAdmin = props.ADMIN || props.NAME || rawCountry;

        const translate = (name: string): string => {
          if (!name) return "未知区域";
          const trimmed = name.trim();
          if (COUNTRY_ZH_MAP[trimmed]) return COUNTRY_ZH_MAP[trimmed];
          for (const key of Object.keys(COUNTRY_ZH_MAP)) {
            if (trimmed.toLowerCase() === key.toLowerCase() || trimmed.toLowerCase().includes(key.toLowerCase())) {
              return COUNTRY_ZH_MAP[key];
            }
          }
          return trimmed;
        };

        const country = translate(rawCountry);
        const admin = translate(rawAdmin);

        return { country, admin };
      }
    }
  } catch (e) {
    // Ignore geometry parse errors
  }
  return null;
}

/**
 * Spatial calculation: Get distance in degrees to the nearest land boundary with RBush acceleration.
 */
export function getDistanceToLandGeoJson(lat: number, lon: number): number {
  if (!landGeoJson || !landGeoJson.features) return 1.5;
  lon = normalizeGeoLon(lon); // default distance if not loaded yet

  if (checkPointOnLandGeoJson(lat, lon)) {
    return 0;
  }

  let minDistance = 999;

  function distToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const collectCandidateSegments = (radius: number): BoundarySegmentItem[] => {
    const minY = Math.max(-90, lat - radius);
    const maxY = Math.min(90, lat + radius);
    const boxes: Array<{ minX: number; maxX: number }> = [];
    const rawMinX = lon - radius;
    const rawMaxX = lon + radius;

    // RBush stores normalized [-180, 180] segment bounds. Split antimeridian-crossing
    // searches instead of creating an oversized box or missing the wrapped side.
    if (rawMinX < -180) {
      boxes.push({ minX: -180, maxX: rawMaxX });
      boxes.push({ minX: rawMinX + 360, maxX: 180 });
    } else if (rawMaxX > 180) {
      boxes.push({ minX: rawMinX, maxX: 180 });
      boxes.push({ minX: -180, maxX: rawMaxX - 360 });
    } else {
      boxes.push({ minX: rawMinX, maxX: rawMaxX });
    }

    const seen = new Set<BoundarySegmentItem>();
    const segments: BoundarySegmentItem[] = [];
    for (const box of boxes) {
      const hits = landBoundaryTree.search({ minX: box.minX, minY, maxX: box.maxX, maxY });
      for (const hit of hits) {
        if (!seen.has(hit)) {
          seen.add(hit);
          segments.push(hit);
        }
      }
    }
    return segments;
  };

  const measureSegments = (segments: BoundarySegmentItem[]): number => {
    let best = 999;
    for (const segment of segments) {
      const p1 = segment.p1;
      const p2 = segment.p2;
      if (Math.abs(p1[1] - lat) > best && Math.abs(p2[1] - lat) > best) continue;
      const p1Lon = lon + normalizeGeoLon(p1[0] - lon);
      const p2Lon = lon + normalizeGeoLon(p2[0] - lon);
      if (Math.abs(p1Lon - lon) > best && Math.abs(p2Lon - lon) > best) continue;
      const dist = distToSegment(lat, lon, p1[1], p1Lon, p2[1], p2Lon);
      if (dist < best) best = dist;
    }
    return best;
  };

  try {
    // Deep-ocean performance guard: the old implementation jumped from a 15-degree RBush
    // miss straight to scanning every Natural Earth feature (~70k coordinate pairs). Because
    // Engine fast-mode distance caching is quantized at 0.1 degrees, a moving cyclone repeatedly
    // hit that O(all-coastline) fallback and produced long periodic main-thread stalls offshore.
    //
    // Instead, grow the indexed search until it encloses a coastline. Once a candidate distance
    // is known, expand to that distance (when needed) so any potentially closer geometry is also
    // included. This preserves the same sampled-boundary distance semantics without a global scan.
    const SEARCH_RADII = [3, 15, 30, 60, 120, 180] as const;
    let searchRadius: number = SEARCH_RADII[0];
    let candidateSegments: BoundarySegmentItem[] = [];

    for (const radius of SEARCH_RADII) {
      searchRadius = radius;
      candidateSegments = collectCandidateSegments(radius);
      if (candidateSegments.length > 0) break;
    }

    if (candidateSegments.length > 0) {
      minDistance = measureSegments(candidateSegments);

      // A large polygon bbox may enter the search square before its actual coastline does.
      // If the measured boundary is farther away than the current radius, one indexed expansion
      // to that measured distance is required to guarantee that no nearer feature was omitted.
      // Iterate only while the bound genuinely grows; in practice this is usually zero or one pass.
      for (let guard = 0; guard < 3 && Number.isFinite(minDistance) && minDistance > searchRadius; guard++) {
        const expandedRadius = Math.min(180, Math.max(searchRadius + 1, minDistance + 0.01));
        if (expandedRadius <= searchRadius) break;
        searchRadius = expandedRadius;
        const expandedSegments = collectCandidateSegments(searchRadius);
        if (expandedSegments.length === 0) break;
        candidateSegments = expandedSegments;
        minDistance = measureSegments(candidateSegments);
      }
    }
  } catch (e) {
    // ignore geometry parse errors
  }

  return minDistance;
}

/**
 * Turf-based distance helper: calculates distance from current point to nearest coordinate in kilometers.
 * Accelerated using RBush.
 */
export function getDistanceToLandKmTurf(lat: number, lon: number): number {
  if (!landGeoJson || !landGeoJson.features) return 150;
  lon = normalizeGeoLon(lon); // default 150km
  try {
    const pt = point([lon, lat]);
    let minKm = 99999;
    
    // Narrow candidate bounding box
    let searchRadius = 2.7; // ~300km
    let candidates = landTree.search({
      minX: lon - searchRadius,
      minY: lat - searchRadius,
      maxX: lon + searchRadius,
      maxY: lat + searchRadius
    });

    if (candidates.length === 0) {
      searchRadius = 12.0; // ~1300km
      candidates = landTree.search({
        minX: lon - searchRadius,
        minY: lat - searchRadius,
        maxX: lon + searchRadius,
        maxY: lat + searchRadius
      });
    }

    const targetFeatures = candidates.length > 0 ? candidates.map(c => c.feature) : landGeoJson.features;

    for (const feat of targetFeatures) {
      if (!feat || !feat.geometry) continue;
      const lines = polygonToLine(feat);
      if (!lines) continue;
      
      if (lines.type === "FeatureCollection") {
        for (const f of lines.features) {
          if (f.geometry && f.geometry.coordinates) {
            for (const coords of f.geometry.coordinates) {
              const d = distance(pt, point(coords as [number, number]));
              if (d < minKm) minKm = d;
            }
          }
        }
      } else if (lines.geometry && lines.geometry.coordinates) {
        const coords = lines.geometry.coordinates;
        if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
          for (const subLine of coords) {
            for (const coord of subLine) {
              const d = distance(pt, point(coord as [number, number]));
              if (d < minKm) minKm = d;
            }
          }
        } else {
          for (const coord of coords) {
            const d = distance(pt, point(coord as [number, number]));
            if (d < minKm) minKm = d;
          }
        }
      }
    }
    return minKm;
  } catch (e) {
    // Fallback if conversion fails
    return getDistanceToLandGeoJson(lat, lon) * 111.12;
  }
}
