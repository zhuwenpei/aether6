export interface XY { x: number; y: number; }
export interface LatLon { lat: number; lon: number; valid?: boolean; }

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function wrapLon(lon: number): number {
  let x = lon;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

export function unwrapLonAround(lon: number, anchor: number): number {
  let x = lon;
  while (x - anchor > 180) x -= 360;
  while (x - anchor < -180) x += 360;
  return x;
}

/**
 * Lambert Azimuthal Equal-Area on a sphere. The pixel scale is deliberately independent of
 * the moving projection-centre latitude. Earlier builds divided by cos(phi0), which made a
 * storm-centred replay visibly zoom in/out as the cyclone moved north/south. A fixed spherical
 * angular scale keeps the camera size stable while the projection origin follows the storm.
 */
export function createLambertAzimuthalEqualAreaProjector(
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number
) {
  const phi0 = centerLat * DEG;
  const lambda0 = centerLon * DEG;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const worldSize = 256 * Math.pow(2, zoom);
  const localScale = worldSize / (2 * Math.PI);

  const project = (lat: number, lon: number): XY => {
    const phi = Math.max(-89.999, Math.min(89.999, lat)) * DEG;
    const lambda = unwrapLonAround(lon, centerLon) * DEG;
    const dLambda = lambda - lambda0;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const denom = 1 + sinPhi0 * sinPhi + cosPhi0 * cosPhi * Math.cos(dLambda);
    const k = Math.sqrt(2 / Math.max(1e-8, denom));
    const x = k * cosPhi * Math.sin(dLambda);
    const y = k * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * Math.cos(dLambda));
    return { x: width / 2 + x * localScale, y: height / 2 - y * localScale };
  };

  const inverse = (x: number, y: number): LatLon => {
    const xx = (x - width / 2) / localScale;
    const yy = -(y - height / 2) / localScale;
    const rho = Math.hypot(xx, yy);
    if (rho > 2 + 1e-6) return { lat: centerLat, lon: centerLon, valid: false };
    if (rho < 1e-10) return { lat: centerLat, lon: centerLon, valid: true };
    const c = 2 * Math.asin(Math.min(1, rho / 2));
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const phi = Math.asin(cosC * sinPhi0 + (yy * sinC * cosPhi0) / rho);
    const lambda = lambda0 + Math.atan2(xx * sinC, rho * cosPhi0 * cosC - yy * sinPhi0 * sinC);
    return { lat: phi * RAD, lon: wrapLon(lambda * RAD), valid: true };
  };

  return { project, inverse, localScale };
}

export function createPlateCarreeProjector(
  centerLat: number,
  centerLon: number,
  pixelsPerDegree: number,
  width: number,
  height: number
) {
  const scale = Math.max(1e-6, pixelsPerDegree);
  const project = (lat: number, lon: number): XY => ({
    x: width / 2 + (unwrapLonAround(lon, centerLon) - centerLon) * scale,
    y: height / 2 - (lat - centerLat) * scale,
  });
  const inverse = (x: number, y: number): LatLon => ({
    lat: centerLat - (y - height / 2) / scale,
    lon: wrapLon(centerLon + (x - width / 2) / scale),
    valid: true,
  });
  return { project, inverse, pixelsPerDegree: scale };
}


/**
 * North-polar stereographic projection on a sphere, returned in projected kilometres.
 * Parameters match the JMA forecast-chart request: lat_0=90N, lon_0=140E, lat_ts=60N.
 * The true-scale latitude is implemented through k0=(1+sin(lat_ts))/2.
 */
export function projectNorthPolarStereographicKm(
  lat: number,
  lon: number,
  lon0 = 140,
  latTs = 60
): XY {
  const earthRadiusKm = 6371.0088;
  const phi = Math.max(-89.999, Math.min(89.9999, lat)) * DEG;
  const lambda = unwrapLonAround(lon, lon0) * DEG;
  const lambda0 = lon0 * DEG;
  const phiTs = latTs * DEG;
  const k0 = (1 + Math.sin(phiTs)) / 2;
  const rho = 2 * earthRadiusKm * k0 * Math.tan(Math.PI / 4 - phi / 2);
  const theta = lambda - lambda0;
  return {
    x: rho * Math.sin(theta),
    y: -rho * Math.cos(theta),
  };
}


/**
 * Screen-space North Polar Stereographic projector used by replay video products. The projection
 * axes remain fixed to lon_0=140E / lat_ts=60N like the JMA forecast plate, while the selected
 * camera centre is translated to the canvas centre. Pixel scale is derived from the requested map
 * zoom and the local stereographic scale at the camera centre, so changing projection never
 * silently changes the user's selected zoom range.
 */
export function createNorthPolarStereographicProjector(
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
  lon0 = 140,
  latTs = 60
) {
  const earthRadiusKm = 6371.0088;
  const center = projectNorthPolarStereographicKm(centerLat, centerLon, lon0, latTs);
  const worldSize = 256 * Math.pow(2, zoom);
  const localScale = worldSize / (2 * Math.PI * earthRadiusKm) /
    Math.max(0.25, northPolarStereographicScaleFactor(centerLat, latTs));

  const project = (lat: number, lon: number): XY => {
    const q = projectNorthPolarStereographicKm(lat, lon, lon0, latTs);
    return {
      x: width / 2 + (q.x - center.x) * localScale,
      y: height / 2 - (q.y - center.y) * localScale,
    };
  };

  const inverse = (x: number, y: number): LatLon => {
    const earthRadiusKm = 6371.0088;
    const phiTs = latTs * DEG;
    const k0 = (1 + Math.sin(phiTs)) / 2;
    const qx = center.x + (x - width / 2) / Math.max(1e-9, localScale);
    const qy = center.y - (y - height / 2) / Math.max(1e-9, localScale);
    const rho = Math.hypot(qx, qy);
    const phi = Math.PI / 2 - 2 * Math.atan(rho / Math.max(1e-9, 2 * earthRadiusKm * k0));
    const theta = rho < 1e-12 ? 0 : Math.atan2(qx, -qy);
    const lambda = lon0 * DEG + theta;
    const lat = phi * RAD;
    const lon = wrapLon(lambda * RAD);
    return { lat, lon, valid: Number.isFinite(lat) && Number.isFinite(lon) && lat > -89.999 && lat < 89.9999 };
  };

  return { project, inverse, localScale };
}

/** Local spherical scale factor for the above north-polar stereographic projection. */
export function northPolarStereographicScaleFactor(lat: number, latTs = 60): number {
  const phi = Math.max(-89.999, Math.min(89.9999, lat)) * DEG;
  const phiTs = latTs * DEG;
  const k0 = (1 + Math.sin(phiTs)) / 2;
  return (2 * k0) / Math.max(1e-6, 1 + Math.sin(phi));
}


export interface MercatorViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  worldSize: number;
}

export function latLonToMercatorWorldPixel(lat: number, lon: number, zoom: number): XY {
  const worldSize = 256 * Math.pow(2, zoom);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = clampedLat * DEG;
  return {
    x: ((lon + 180) / 360) * worldSize,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * (worldSize / 2),
  };
}

/**
 * Compute the Mercator source rectangle required to cover the currently visible LAEA frame.
 * This is intentionally independent of the camera zoom itself: it only enlarges the hidden
 * source raster used for reprojection, so the rendered LAEA scale never changes.
 */
export function getLambertAzimuthalEqualAreaMercatorViewportBounds(
  centerLat: number,
  centerLon: number,
  targetZoom: number,
  width: number,
  height: number,
  sourceMercatorZoom: number,
  paddingPx = 96,
  edgeSamples = 28
): MercatorViewportBounds {
  const projector = createLambertAzimuthalEqualAreaProjector(centerLat, centerLon, targetZoom, width, height);
  const worldSize = 256 * Math.pow(2, sourceMercatorZoom);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const add = (sx: number, sy: number) => {
    const ll = projector.inverse(sx, sy);
    if (!ll.valid) return;
    const lon = unwrapLonAround(ll.lon, centerLon);
    const p = latLonToMercatorWorldPixel(ll.lat, lon, sourceMercatorZoom);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };

  const n = Math.max(8, Math.round(edgeSamples));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(t * width, 0);
    add(t * width, height);
    add(0, t * height);
    add(width, t * height);
  }
  // A few interior samples protect against extrema produced by the curved LAEA-to-Mercator warp.
  for (let gy = 1; gy <= 7; gy++) {
    for (let gx = 1; gx <= 7; gx++) add(width * gx / 8, height * gy / 8);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    const c = latLonToMercatorWorldPixel(centerLat, centerLon, sourceMercatorZoom);
    minX = c.x - width / 2; maxX = c.x + width / 2;
    minY = c.y - height / 2; maxY = c.y + height / 2;
  }

  const pad = Math.max(16, paddingPx);
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  // Mercator has no valid pixels beyond its north/south limits. Longitude remains intentionally
  // unbounded here so callers can wrap tile X indices cleanly across the dateline.
  minY = Math.max(0, minY);
  maxY = Math.min(worldSize, maxY);
  return { minX, maxX, minY, maxY, worldSize };
}

/** Compute the Mercator source rectangle required to cover a centred JMA-style polar-stereographic frame. */
export function getNorthPolarStereographicMercatorViewportBounds(
  centerLat: number,
  centerLon: number,
  targetZoom: number,
  width: number,
  height: number,
  sourceMercatorZoom: number,
  paddingPx = 96,
  edgeSamples = 28,
  lon0 = 140,
  latTs = 60
): MercatorViewportBounds {
  const projector = createNorthPolarStereographicProjector(centerLat, centerLon, targetZoom, width, height, lon0, latTs);
  const worldSize = 256 * Math.pow(2, sourceMercatorZoom);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (sx: number, sy: number) => {
    const ll = projector.inverse(sx, sy);
    if (!ll.valid || Math.abs(ll.lat) >= 85.05112878) return;
    const lon = unwrapLonAround(ll.lon, centerLon);
    const p = latLonToMercatorWorldPixel(ll.lat, lon, sourceMercatorZoom);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };
  const n = Math.max(8, Math.round(edgeSamples));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    add(t * width, 0); add(t * width, height); add(0, t * height); add(width, t * height);
  }
  for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.25, 0.5, 0.75]) add(fx * width, fy * height);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    const c = latLonToMercatorWorldPixel(centerLat, centerLon, sourceMercatorZoom);
    minX = c.x - width / 2; maxX = c.x + width / 2; minY = c.y - height / 2; maxY = c.y + height / 2;
  }
  return { minX: minX - paddingPx, maxX: maxX + paddingPx, minY: minY - paddingPx, maxY: maxY + paddingPx, worldSize };
}

