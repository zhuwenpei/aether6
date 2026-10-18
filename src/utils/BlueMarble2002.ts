import { createLambertAzimuthalEqualAreaProjector, createNorthPolarStereographicProjector } from "./MapProjection";
/**
 * Genuine NASA Blue Marble 2002 raster:
 * "Land Surface, Shallow Water, and Shaded Topography" (11 Feb 2002).
 *
 * NASA source record:
 *   https://visibleearth.nasa.gov/view.php?id=57752
 * Original TIFF:
 *   https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_21600.tif
 *
 * The TIFF is not directly browser-decodable. For canvas rendering we use JPEG derivatives of
 * the exact same 2002 equirectangular raster. NASA's historical JPEG endpoint is tried first;
 * Wikimedia Commons' CORS-enabled mirror of the NASA original is the browser-safe fallback.
 */

const NASA_BLUE_MARBLE_2002_JPEG =
  "https://earthobservatory.nasa.gov/Features/BlueMarble/Images/land_shallow_topo_2048.jpg";
const COMMONS_BLUE_MARBLE_2002_3840 =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Land_shallow_topo_2048.jpg/3840px-Land_shallow_topo_2048.jpg";
const COMMONS_BLUE_MARBLE_2002_5120 =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Land_shallow_topo_2048.jpg/5120px-Land_shallow_topo_2048.jpg";

const imageCache = new Map<string, HTMLImageElement>();
const pendingCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url)!);
  if (pendingCache.has(url)) return pendingCache.get(url)!;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      imageCache.set(url, img);
      pendingCache.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      pendingCache.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  pendingCache.set(url, promise);
  return promise;
}

export async function loadBlueMarble2002(highResolution = false): Promise<HTMLImageElement | null> {
  // NASA first, then the CORS-safe mirror of the same NASA 2002 raster.
  const candidates = highResolution
    ? [COMMONS_BLUE_MARBLE_2002_5120, COMMONS_BLUE_MARBLE_2002_3840, NASA_BLUE_MARBLE_2002_JPEG]
    : [NASA_BLUE_MARBLE_2002_JPEG, COMMONS_BLUE_MARBLE_2002_3840];
  for (const url of candidates) {
    const image = await loadCorsImage(url);
    if (image) return image;
  }
  return null;
}

function mercatorYNorm(lat: number) {
  const safe = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const r = safe * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

function inverseMercatorLat(normY: number) {
  const y = Math.max(0, Math.min(1, normY));
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

/** Draw the 2:1 equirectangular Blue Marble 2002 raster into a Web-Mercator viewport. */
export function drawBlueMarble2002Mercator(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  stripHeight = 3
) {
  if (!image.naturalWidth || !image.naturalHeight || width <= 0 || height <= 0) return;
  const worldSize = 256 * Math.pow(2, zoom);
  const centerX = ((centerLon + 180) / 360) * worldSize;
  const centerY = mercatorYNorm(centerLat) * worldSize;
  const leftNorm = (centerX - width / 2) / worldSize;
  const spanNorm = width / worldSize;
  const sourceW = image.naturalWidth;
  const sourceH = image.naturalHeight;
  const strip = Math.max(1, Math.floor(stripHeight));

  const drawHorizontalBand = (dy: number, dh: number, sy0: number, sy1: number) => {
    const sh = Math.max(0.5, sy1 - sy0);
    if (spanNorm >= 1) {
      ctx.drawImage(image, 0, sy0, sourceW, sh, 0, dy, width, dh);
      return;
    }
    const wrappedLeft = ((leftNorm % 1) + 1) % 1;
    const wrappedRight = wrappedLeft + spanNorm;
    if (wrappedRight <= 1) {
      ctx.drawImage(image, wrappedLeft * sourceW, sy0, spanNorm * sourceW, sh, 0, dy, width, dh);
    } else {
      const firstFrac = 1 - wrappedLeft;
      const firstW = width * (firstFrac / spanNorm);
      ctx.drawImage(image, wrappedLeft * sourceW, sy0, firstFrac * sourceW, sh, 0, dy, firstW, dh);
      const secondFrac = wrappedRight - 1;
      ctx.drawImage(image, 0, sy0, secondFrac * sourceW, sh, firstW, dy, width - firstW, dh);
    }
  };

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (let y = 0; y < height; y += strip) {
    const y1 = Math.min(height, y + strip);
    const worldY0 = centerY + y - height / 2;
    const worldY1 = centerY + y1 - height / 2;
    const lat0 = inverseMercatorLat(worldY0 / worldSize);
    const lat1 = inverseMercatorLat(worldY1 / worldSize);
    const sy0 = Math.max(0, Math.min(sourceH, ((90 - lat0) / 180) * sourceH));
    const sy1 = Math.max(0, Math.min(sourceH, ((90 - lat1) / 180) * sourceH));
    drawHorizontalBand(y, y1 - y, Math.min(sy0, sy1), Math.max(sy0, sy1));
  }
  ctx.restore();
}

export const BLUE_MARBLE_2002_ATTRIBUTION =
  "NASA Blue Marble 2002 — Land Surface, Shallow Water, and Shaded Topography";

export function drawBlueMarble2002Tile(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  z: number,
  x: number,
  y: number,
  size = 256
) {
  const n = Math.pow(2, z);
  const centerLon = ((x + 0.5) / n) * 360 - 180;
  const mercatorN = Math.PI - (2 * Math.PI * (y + 0.5)) / n;
  const centerLat = Math.atan(Math.sinh(mercatorN)) * 180 / Math.PI;
  drawBlueMarble2002Mercator(ctx, image, size, size, centerLat, centerLon, z, 2);
}


const sourceRasterCache = new WeakMap<HTMLImageElement, Map<number, ImageData>>();

function getScaledEquirectangularSource(image: HTMLImageElement, targetWidth: number): ImageData | null {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  const width = Math.max(512, Math.min(4096, Math.round(targetWidth)));
  let byWidth = sourceRasterCache.get(image);
  if (!byWidth) { byWidth = new Map(); sourceRasterCache.set(image, byWidth); }
  const existing = byWidth.get(width);
  if (existing) return existing;
  const height = Math.round(width / 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(image, 0, 0, width, height);
  try {
    const data = c.getImageData(0, 0, width, height);
    byWidth.set(width, data);
    return data;
  } catch {
    return null;
  }
}

/** Draw the genuine 2002 equirectangular raster through a storm-centred LAEA projection. */
export function drawBlueMarble2002LambertAzimuthalEqualArea(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  const source = getScaledEquirectangularSource(image, width >= 1920 ? 4096 : 3072);
  if (!source) return;
  const outW = Math.max(320, Math.min(720, width));
  const outH = Math.max(180, Math.round(height * outW / Math.max(1, width)));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const outCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return;
  const out = outCtx.createImageData(outW, outH);
  const projector = createLambertAzimuthalEqualAreaProjector(centerLat, centerLon, zoom, width, height);
  const sxMax = source.width - 1;
  const syMax = source.height - 1;
  const xScale = width / outW;
  const yScale = height / outH;
  const src = source.data;
  const dst = out.data;
  for (let y = 0; y < outH; y++) {
    const fullY = (y + 0.5) * yScale;
    for (let x = 0; x < outW; x++) {
      const fullX = (x + 0.5) * xScale;
      const ll = projector.inverse(fullX, fullY);
      const di = (y * outW + x) * 4;
      if (!ll.valid || ll.lat < -90 || ll.lat > 90) {
        dst[di] = 5; dst[di + 1] = 9; dst[di + 2] = 39; dst[di + 3] = 255;
        continue;
      }
      const lon = ((ll.lon + 180) % 360 + 360) % 360;
      const sx = Math.max(0, Math.min(sxMax, Math.round((lon / 360) * sxMax)));
      const sy = Math.max(0, Math.min(syMax, Math.round(((90 - ll.lat) / 180) * syMax)));
      const si = (sy * source.width + sx) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
    }
  }
  outCtx.putImageData(out, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, width, height);
  ctx.restore();
}

/** Draw the genuine 2002 equirectangular raster through the JMA forecast North Polar Stereographic projection. */
export function drawBlueMarble2002NorthPolarStereographic(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  const source = getScaledEquirectangularSource(image, width >= 1920 ? 4096 : 3072);
  if (!source) return;
  const outW = Math.max(320, Math.min(720, width));
  const outH = Math.max(180, Math.round(height * outW / Math.max(1, width)));
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const outCtx = canvas.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return;
  const out = outCtx.createImageData(outW, outH);
  const projector = createNorthPolarStereographicProjector(centerLat, centerLon, zoom, width, height, 140, 60);
  const sxMax = source.width - 1, syMax = source.height - 1;
  const xScale = width / outW, yScale = height / outH;
  const src = source.data, dst = out.data;
  for (let y = 0; y < outH; y++) {
    const fullY = (y + 0.5) * yScale;
    for (let x = 0; x < outW; x++) {
      const fullX = (x + 0.5) * xScale;
      const ll = projector.inverse(fullX, fullY);
      const di = (y * outW + x) * 4;
      if (!ll.valid || ll.lat < -90 || ll.lat > 90) continue;
      const lon = ((ll.lon + 180) % 360 + 360) % 360;
      const sx = Math.max(0, Math.min(sxMax, Math.round((lon / 360) * sxMax)));
      const sy = Math.max(0, Math.min(syMax, Math.round(((90 - ll.lat) / 180) * syMax)));
      const si = (sy * source.width + sx) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
    }
  }
  outCtx.putImageData(out, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, width, height); ctx.restore();
}

