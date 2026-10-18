import { createLambertAzimuthalEqualAreaProjector, createNorthPolarStereographicProjector, getLambertAzimuthalEqualAreaMercatorViewportBounds, getNorthPolarStereographicMercatorViewportBounds, latLonToMercatorWorldPixel, unwrapLonAround } from "./MapProjection";
const NASA_GIBS_BLUE_MARBLE_2004_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";

const imageCache = new Map<string, HTMLImageElement>();
const pendingCache = new Map<string, Promise<HTMLImageElement | null>>();
const failedUntilCache = new Map<string, number>();

function tile2long(x: number, z: number) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tile2lat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function getBlueMarble2004TileUrl(z: number, x: number, y: number): string {
  const n = Math.pow(2, z);
  const tileX = ((x % n) + n) % n;
  if (y < 0 || y >= n) return "";
  const minLon = tile2long(tileX, z);
  const maxLon = tile2long(tileX + 1, z);
  const maxLat = tile2lat(y, z);
  const minLat = tile2lat(y + 1, z);
  const R = 6378137;
  const projectX = (lon: number) => R * lon * Math.PI / 180;
  const projectY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 360)));
  const bbox = `${projectX(minLon)},${projectY(minLat)},${projectX(maxLon)},${projectY(maxLat)}`;
  return `${NASA_GIBS_BLUE_MARBLE_2004_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_NextGeneration&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&SRS=EPSG:3857&BBOX=${encodeURIComponent(bbox)}&WIDTH=512&HEIGHT=512`;
}

export function loadBlueMarble2004Tile(url: string, timeoutMs = 9000): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url)!);
  if ((failedUntilCache.get(url) || 0) > Date.now()) return Promise.resolve(null);
  if (pendingCache.has(url)) return pendingCache.get(url)!;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingCache.delete(url);
      if (value) failedUntilCache.delete(url);
      else failedUntilCache.set(url, Date.now() + 30_000);
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      // GIBS WMS occasionally leaves an image request pending indefinitely. Never let one
      // missing map tile block the whole video render; the next frame can reuse any tiles
      // that did load successfully and the ocean background remains a safe fallback.
      try { img.src = ""; } catch { /* ignore */ }
      finish(null);
    }, Math.max(1500, timeoutMs));
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      imageCache.set(url, img);
      finish(img);
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
  pendingCache.set(url, promise);
  return promise;
}


async function loadBlueMarble2004TileWithRetry(url: string, timeoutMs = 18000, attempts = 2) {
  let image: HTMLImageElement | null = null;
  const tries = Math.max(1, Math.round(attempts));
  for (let attempt = 0; attempt < tries; attempt++) {
    image = await loadBlueMarble2004Tile(url, timeoutMs);
    if (image) return image;
    // Wiki export is an explicit one-shot operation. A transient timeout must not poison the same
    // request for the 30 s video failure-cache window; clear it and retry after a short backoff.
    failedUntilCache.delete(url);
    if (attempt + 1 < tries) await new Promise<void>((resolve) => window.setTimeout(resolve, 260 + attempt * 240));
  }
  return image;
}

export async function drawBlueMarble2004Mercator(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  sourceZoomOffset = 0,
  reliable = false
) {
  const tileZoom = Math.max(0, Math.floor(zoom) + sourceZoomOffset);
  const scaleFactor = Math.pow(2, zoom - tileZoom);
  const worldSize = 256 * Math.pow(2, tileZoom);
  const cx = ((centerLon + 180) / 360) * worldSize;
  const centerLatRad = (centerLat * Math.PI) / 180;
  const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);
  const minX = Math.floor((cx - (width / (2 * scaleFactor))) / 256) - 1;
  const maxX = Math.ceil((cx + (width / (2 * scaleFactor))) / 256) + 1;
  const minY = Math.floor((cy - (height / (2 * scaleFactor))) / 256) - 1;
  const maxY = Math.ceil((cy + (height / (2 * scaleFactor))) / 256) + 1;
  const tileJobs: Array<Promise<{tx:number; ty:number; img:HTMLImageElement | null}>> = [];
  for (let tx=minX; tx<=maxX; tx++) {
    for (let ty=minY; ty<=maxY; ty++) {
      const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
      const load = reliable ? loadBlueMarble2004TileWithRetry(url, 30000, 3) : loadBlueMarble2004Tile(url);
      tileJobs.push(load.then((img) => ({ tx, ty, img })));
    }
  }
  // Load the viewport concurrently. Browser per-origin connection limits naturally bound
  // request pressure, while this avoids the old one-tile-at-a-time delay on GIBS WMS.
  const tiles = await Promise.all(tileJobs);
  // Wiki export uses an atomic composite: never paint only the half of the GIBS viewport that
  // happened to arrive before a transient timeout. After the longer retry window either the whole
  // Blue Marble plate replaces the offline fallback, or the already-complete fallback is retained.
  if (reliable && tiles.some((tile) => !tile.img)) return false;
  if (reliable) {
    const loaded = tiles.filter((tile) => !!tile.img);
    const minDrawX = Math.min(...loaded.map(({ tx }) => width / 2 + (tx * 256 - cx) * scaleFactor));
    const maxDrawX = Math.max(...loaded.map(({ tx }) => width / 2 + (tx * 256 - cx) * scaleFactor + 256 * scaleFactor));
    const minDrawY = Math.min(...loaded.map(({ ty }) => height / 2 + (ty * 256 - cy) * scaleFactor));
    const maxDrawY = Math.max(...loaded.map(({ ty }) => height / 2 + (ty * 256 - cy) * scaleFactor + 256 * scaleFactor));
    // Guard against an apparently-successful WMS batch whose tile-world range does not actually
    // cover the output viewport (the visual symptom is a narrow photographic strip over the
    // offline fallback). Never composite such a partial plate.
    if (minDrawX > 0.5 || maxDrawX < width - 0.5 || minDrawY > 0.5 || maxDrawY < height - 0.5) return false;
  }
  let drawCtx = ctx;
  let atomicCanvas: HTMLCanvasElement | null = null;
  if (reliable) {
    atomicCanvas = document.createElement("canvas");
    atomicCanvas.width = width; atomicCanvas.height = height;
    const atomicCtx = atomicCanvas.getContext("2d");
    if (!atomicCtx) return false;
    drawCtx = atomicCtx;
  }
  for (const {tx, ty, img} of tiles) {
    if (!img) continue;
    const screenX = width / 2 + (tx * 256 - cx) * scaleFactor;
    const screenY = height / 2 + (ty * 256 - cy) * scaleFactor;
    const tileSize = 256 * scaleFactor;
    drawCtx.drawImage(img, screenX, screenY, tileSize, tileSize);
  }
  if (atomicCanvas) ctx.drawImage(atomicCanvas, 0, 0);
  return true;
}

/** Pre-warm the exact GIBS tiles used by a video viewport without drawing them. */
export async function preloadBlueMarble2004MercatorViewport(
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  sourceZoomOffset = 0,
  timeoutMs = 8000,
  reliable = false
) {
  const tileZoom = Math.max(0, Math.floor(zoom) + sourceZoomOffset);
  const scaleFactor = Math.pow(2, zoom - tileZoom);
  const worldSize = 256 * Math.pow(2, tileZoom);
  const cx = ((centerLon + 180) / 360) * worldSize;
  const centerLatRad = (centerLat * Math.PI) / 180;
  const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);
  const minX = Math.floor((cx - (width / (2 * scaleFactor))) / 256) - 1;
  const maxX = Math.ceil((cx + (width / (2 * scaleFactor))) / 256) + 1;
  const minY = Math.floor((cy - (height / (2 * scaleFactor))) / 256) - 1;
  const maxY = Math.ceil((cy + (height / (2 * scaleFactor))) / 256) + 1;
  const jobs: Promise<HTMLImageElement | null>[] = [];
  for (let tx = minX; tx <= maxX; tx++) {
    for (let ty = minY; ty <= maxY; ty++) {
      const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
      if (url) jobs.push(reliable ? loadBlueMarble2004TileWithRetry(url, Math.max(12000, timeoutMs), 3) : loadBlueMarble2004Tile(url, timeoutMs));
    }
  }
  const images = await Promise.all(jobs);
  return images.every(Boolean);
}

export const BLUE_MARBLE_2004_ATTRIBUTION = "NASA Blue Marble 2004 — BlueMarble_NextGeneration (GIBS)";


const NASA_GIBS_BLUE_MARBLE_2004_WMS_4326 = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

function getBlueMarble2004GeographicUrl(west: number, south: number, east: number, north: number, width: number, height: number) {
  const bbox = `${west},${south},${east},${north}`;
  return `${NASA_GIBS_BLUE_MARBLE_2004_WMS_4326}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_NextGeneration&STYLES=&FORMAT=image/jpeg&TRANSPARENT=false&SRS=EPSG:4326&BBOX=${encodeURIComponent(bbox)}&WIDTH=${Math.max(1, Math.round(width))}&HEIGHT=${Math.max(1, Math.round(height))}`;
}

/** Draw Blue Marble 2004 directly in Plate Carrée / equirectangular coordinates. */
export async function drawBlueMarble2004Equirectangular(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  pixelsPerDegree: number,
  reliable = false
) {
  const scale = Math.max(1e-6, pixelsPerDegree);
  const west = centerLon - width / (2 * scale);
  const east = centerLon + width / (2 * scale);
  const south = Math.max(-90, centerLat - height / (2 * scale));
  const north = Math.min(90, centerLat + height / (2 * scale));
  const totalSpan = Math.max(1e-6, east - west);
  let targetCtx = ctx;
  let atomicCanvas: HTMLCanvasElement | null = null;
  if (reliable) {
    atomicCanvas = document.createElement("canvas");
    atomicCanvas.width = width; atomicCanvas.height = height;
    const atomicCtx = atomicCanvas.getContext("2d");
    if (!atomicCtx) return;
    targetCtx = atomicCtx;
  }

  const drawSpan = async (x0: number, x1: number, lon0: number, lon1: number): Promise<boolean> => {
    if (x1 - x0 < 1 || lon1 - lon0 < 1e-6) return true;
    const band0 = Math.floor((lon0 + 180) / 360);
    const band1 = Math.floor((lon1 - 1e-9 + 180) / 360);
    if (band0 !== band1) {
      const boundary = 180 + 360 * band0;
      const frac = (boundary - lon0) / (lon1 - lon0);
      const xm = x0 + (x1 - x0) * frac;
      const a = await drawSpan(x0, xm, lon0, boundary);
      const b = await drawSpan(xm, x1, boundary, lon1);
      return a && b;
    }
    const normalizedWest = lon0 - 360 * band0;
    const normalizedEast = lon1 - 360 * band0;
    const requestW = Math.max(512, Math.min(2400, Math.round((x1 - x0) * 1.2)));
    const requestH = Math.max(512, Math.min(1800, Math.round(height * 1.1)));
    const url = getBlueMarble2004GeographicUrl(normalizedWest, south, normalizedEast, north, requestW, requestH);
    const img = reliable
      ? await loadBlueMarble2004TileWithRetry(url, 32000, 3)
      : await loadBlueMarble2004Tile(url);
    if (!img) return false;
    targetCtx.drawImage(img, x0, 0, x1 - x0, height);
    return true;
  };

  // Split into moderate output-width bands, but request independent bands concurrently. The old
  // sequential loop could spend one full network timeout on every band and leave Wiki export stuck
  // at “loading map” for tens of seconds on a weak GIBS connection.
  const bandPx = Math.min(1500, Math.max(480, width / 2.4));
  const jobs: Promise<boolean>[] = [];
  for (let x0 = 0; x0 < width; x0 += bandPx) {
    const x1 = Math.min(width, x0 + bandPx);
    const lon0 = west + (x0 / width) * totalSpan;
    const lon1 = west + (x1 / width) * totalSpan;
    jobs.push(drawSpan(x0, x1, lon0, lon1));
  }
  const results = await Promise.all(jobs);
  if (reliable && atomicCanvas && results.every(Boolean)) ctx.drawImage(atomicCanvas, 0, 0);
}

/**
 * Render the 2004 GIBS plate into a storm-centred LAEA projection. The expensive reprojection is
 * deliberately done at a bounded working resolution and then upscaled; overlays are drawn later
 * at full resolution so track points, wind circles and labels remain crisp and geometrically exact.
 */
export async function drawBlueMarble2004LambertAzimuthalEqualArea(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  // The visible LAEA footprint in Mercator grows rapidly as a storm moves poleward.  Earlier
  // builds always captured a fixed-size Mercator rectangle, so progressively more LAEA pixels
  // sampled outside that hidden source and turned into dark borders.  Compute the exact hidden
  // Mercator coverage for every frame instead; this never changes the requested LAEA zoom.
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom)));
  const sourceBounds = getLambertAzimuthalEqualAreaMercatorViewportBounds(
    centerLat, centerLon, zoom, width, height, tileZoom, 128, 32
  );
  const spanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
  const spanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
  const sourceScale = Math.max(0.28, Math.min(1.45, 2000 / spanX, 1600 / spanY));
  const sourceW = Math.max(320, Math.ceil(spanX * sourceScale));
  const sourceH = Math.max(240, Math.ceil(spanY * sourceScale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW;
  sourceCanvas.height = sourceH;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const minTileX = Math.floor(sourceBounds.minX / 256) - 1;
  const maxTileX = Math.ceil(sourceBounds.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(sourceBounds.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(sourceBounds.maxY / 256) + 1);
  const jobs: Array<Promise<{ tx: number; ty: number; img: HTMLImageElement | null }>> = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
      jobs.push(loadBlueMarble2004Tile(url, 6500).then((img) => ({ tx, ty, img })));
    }
  }
  const tiles = await Promise.all(jobs);
  for (const { tx, ty, img } of tiles) {
    if (!img) continue;
    const sx = (tx * 256 - sourceBounds.minX) * sourceScale;
    const sy = (ty * 256 - sourceBounds.minY) * sourceScale;
    const tileSize = 256 * sourceScale;
    sourceCtx.drawImage(img, sx, sy, tileSize, tileSize);
  }

  let source: ImageData;
  try { source = sourceCtx.getImageData(0, 0, sourceW, sourceH); } catch { return; }

  // Keep the warp canvas deliberately smaller than the output.  Track/wind/label overlays are
  // still rendered at full resolution, while reducing the expensive inverse-projection work by
  // roughly half versus the former 1200-pixel working raster.
  const outW = Math.max(360, Math.min(720, Math.round(width * 0.55)));
  const outH = Math.max(200, Math.round(height * outW / Math.max(1, width)));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return;
  const out = outCtx.createImageData(outW, outH);
  const projector = createLambertAzimuthalEqualAreaProjector(centerLat, centerLon, zoom, width, height);
  const src = source.data;
  const dst = out.data;
  const xScale = width / outW;
  const yScale = height / outH;

  for (let y = 0; y < outH; y++) {
    const fullY = (y + 0.5) * yScale;
    for (let x = 0; x < outW; x++) {
      const fullX = (x + 0.5) * xScale;
      const ll = projector.inverse(fullX, fullY);
      const di = (y * outW + x) * 4;
      if (!ll.valid || Math.abs(ll.lat) >= 85.05112878) continue;
      const lon = unwrapLonAround(ll.lon, centerLon);
      const world = latLonToMercatorWorldPixel(ll.lat, lon, tileZoom);
      const sx = (world.x - sourceBounds.minX) * sourceScale;
      const sy = (world.y - sourceBounds.minY) * sourceScale;
      if (sx < 0 || sy < 0 || sx >= sourceW - 1 || sy >= sourceH - 1) continue;
      const si = (Math.floor(sy) * sourceW + Math.floor(sx)) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  outCtx.putImageData(out, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(outCanvas, 0, 0, width, height);
  ctx.restore();
}

/** Pre-warm the actual tile footprint needed by a storm-centred LAEA frame. */
export async function preloadBlueMarble2004LambertAzimuthalEqualAreaViewport(
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  timeoutMs = 5500,
  reliable = false
) {
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom)));
  const b = getLambertAzimuthalEqualAreaMercatorViewportBounds(centerLat, centerLon, zoom, width, height, tileZoom, 128, 24);
  const minTileX = Math.floor(b.minX / 256) - 1;
  const maxTileX = Math.ceil(b.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(b.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(b.maxY / 256) + 1);
  const jobs: Promise<HTMLImageElement | null>[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
      if (url) jobs.push(reliable ? loadBlueMarble2004TileWithRetry(url, Math.max(12000, timeoutMs), 3) : loadBlueMarble2004Tile(url, timeoutMs));
    }
  }
  const images = await Promise.all(jobs);
  return images.every(Boolean);
}


/** Pre-warm the actual tile footprint needed by a JMA north-polar stereographic frame. */
export async function preloadBlueMarble2004NorthPolarStereographicViewport(
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  timeoutMs = 8000,
  reliable = false
) {
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom)));
  const b = getNorthPolarStereographicMercatorViewportBounds(
    centerLat, centerLon, zoom, width, height, tileZoom, 128, 30, 140, 60
  );
  const minTileX = Math.floor(b.minX / 256) - 1;
  const maxTileX = Math.ceil(b.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(b.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(b.maxY / 256) + 1);
  const jobs: Promise<HTMLImageElement | null>[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
      if (url) jobs.push(reliable ? loadBlueMarble2004TileWithRetry(url, Math.max(12000, timeoutMs), 3) : loadBlueMarble2004Tile(url, timeoutMs));
    }
  }
  const images = await Promise.all(jobs);
  return images.every(Boolean);
}

/** Render Blue Marble 2004 through the JMA forecast North Polar Stereographic projection. */
export async function drawBlueMarble2004NorthPolarStereographic(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom)));
  const sourceBounds = getNorthPolarStereographicMercatorViewportBounds(
    centerLat, centerLon, zoom, width, height, tileZoom, 128, 30, 140, 60
  );
  const spanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
  const spanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
  const sourceScale = Math.max(0.28, Math.min(1.35, 1900 / spanX, 1500 / spanY));
  const sourceW = Math.max(320, Math.ceil(spanX * sourceScale));
  const sourceH = Math.max(240, Math.ceil(spanY * sourceScale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW; sourceCanvas.height = sourceH;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const minTileX = Math.floor(sourceBounds.minX / 256) - 1;
  const maxTileX = Math.ceil(sourceBounds.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(sourceBounds.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(sourceBounds.maxY / 256) + 1);
  const jobs: Array<Promise<{ tx: number; ty: number; img: HTMLImageElement | null }>> = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) for (let ty = minTileY; ty <= maxTileY; ty++) {
    const url = getBlueMarble2004TileUrl(tileZoom, tx, ty);
    jobs.push(loadBlueMarble2004Tile(url, 7000).then((img) => ({ tx, ty, img })));
  }
  const tiles = await Promise.all(jobs);
  for (const { tx, ty, img } of tiles) {
    if (!img) continue;
    const sx = (tx * 256 - sourceBounds.minX) * sourceScale;
    const sy = (ty * 256 - sourceBounds.minY) * sourceScale;
    const tileSize = 256 * sourceScale;
    sourceCtx.drawImage(img, sx, sy, tileSize, tileSize);
  }
  let source: ImageData;
  try { source = sourceCtx.getImageData(0, 0, sourceW, sourceH); } catch { return; }

  const outW = Math.max(360, Math.min(720, Math.round(width * 0.55)));
  const outH = Math.max(200, Math.round(height * outW / Math.max(1, width)));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW; outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return;
  const out = outCtx.createImageData(outW, outH);
  const projector = createNorthPolarStereographicProjector(centerLat, centerLon, zoom, width, height, 140, 60);
  const src = source.data, dst = out.data;
  const xScale = width / outW, yScale = height / outH;
  for (let y = 0; y < outH; y++) {
    const fullY = (y + 0.5) * yScale;
    for (let x = 0; x < outW; x++) {
      const fullX = (x + 0.5) * xScale;
      const ll = projector.inverse(fullX, fullY);
      const di = (y * outW + x) * 4;
      if (!ll.valid || Math.abs(ll.lat) >= 85.05112878) continue;
      const lon = unwrapLonAround(ll.lon, centerLon);
      const world = latLonToMercatorWorldPixel(ll.lat, lon, tileZoom);
      const sx = (world.x - sourceBounds.minX) * sourceScale;
      const sy = (world.y - sourceBounds.minY) * sourceScale;
      if (sx < 0 || sy < 0 || sx >= sourceW - 1 || sy >= sourceH - 1) continue;
      const si = (Math.floor(sy) * sourceW + Math.floor(sx)) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  outCtx.putImageData(out, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(outCanvas, 0, 0, width, height); ctx.restore();
}

