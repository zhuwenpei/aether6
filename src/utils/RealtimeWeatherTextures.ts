import type { SimulationConfig } from "../types";
import { getOHC, getSST } from "../simulation/Engine";

export type OceanTextureKind = "sst" | "ohc";

export const WEST_PACIFIC_TEXTURE_BOUNDS = {
  minLat: 0,
  maxLat: 55,
  minLon: 95,
  maxLon: 180,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function paletteColor(value: number, anchors: Array<[number, number, number, number, number]>): [number, number, number, number] {
  if (value <= anchors[0][0]) return [anchors[0][1], anchors[0][2], anchors[0][3], anchors[0][4]];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return [last[1], last[2], last[3], last[4]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (value < a[0] || value > b[0]) continue;
    const t = clamp01((value - a[0]) / Math.max(1e-6, b[0] - a[0]));
    return [
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t)),
      Math.round(lerp(a[3], b[3], t)),
      Math.round(lerp(a[4], b[4], t)),
    ];
  }
  return [0, 0, 0, 0];
}

const SST_PALETTE: Array<[number, number, number, number, number]> = [
  [10, 26, 55, 104, 45],
  [20, 43, 91, 156, 95],
  [24, 30, 156, 255, 125],
  [26, 55, 196, 188, 142],
  [28, 69, 212, 131, 158],
  [29.5, 246, 211, 74, 175],
  [31, 255, 126, 53, 192],
  [32, 255, 77, 79, 205],
];

const OHC_PALETTE: Array<[number, number, number, number, number]> = [
  [0, 20, 75, 145, 0],
  [8, 30, 156, 255, 75],
  [30, 45, 184, 225, 115],
  [60, 69, 212, 131, 145],
  [95, 255, 166, 70, 175],
  [130, 255, 95, 70, 195],
  [180, 214, 55, 109, 212],
];

function mercatorY(latDeg: number): number {
  const lat = Math.max(-85, Math.min(85, latDeg)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

function inverseMercatorY(y: number): number {
  return Math.atan(Math.sinh(y)) * 180 / Math.PI;
}

function texturePoint(lon: number, lat: number, width: number, height: number): [number, number] {
  const b = WEST_PACIFIC_TEXTURE_BOUNDS;
  const x = ((lon - b.minLon) / (b.maxLon - b.minLon)) * width;
  const top = mercatorY(b.maxLat), bottom = mercatorY(b.minLat);
  const y = ((top - mercatorY(lat)) / Math.max(1e-9, top - bottom)) * height;
  return [x, y];
}

function traceRing(ctx: CanvasRenderingContext2D, ring: any[], width: number, height: number) {
  let started = false;
  for (const coord of ring || []) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lon = Number(coord[0]), lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const [x, y] = texturePoint(lon, lat, width, height);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  if (started) ctx.closePath();
}

function traceGeometry(ctx: CanvasRenderingContext2D, geometry: any, width: number, height: number) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    ctx.beginPath();
    for (const ring of geometry.coordinates || []) traceRing(ctx, ring, width, height);
    ctx.fill("evenodd");
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates || []) {
      ctx.beginPath();
      for (const ring of polygon || []) traceRing(ctx, ring, width, height);
      ctx.fill("evenodd");
    }
  }
}

/**
 * Bake the procedural ocean field once into a fixed Web-Mercator texture. The map then only moves
 * and scales one ImageOverlay; pan/zoom no longer calls getSST/getOHC for every viewport block.
 * A deliberately small physical sample grid is bilinearly enlarged before the vector land mask is
 * punched out, so the cost is paid only when the relevant ocean-environment controls change.
 */
export function bakeOceanTexture(kind: OceanTextureKind, config: SimulationConfig, landGeoJson: any): string {
  const sampleW = 208;
  const sampleH = 136;
  const outputW = 832;
  const outputH = Math.round(outputW * (mercatorY(WEST_PACIFIC_TEXTURE_BOUNDS.maxLat) - mercatorY(WEST_PACIFIC_TEXTURE_BOUNDS.minLat)) /
    ((WEST_PACIFIC_TEXTURE_BOUNDS.maxLon - WEST_PACIFIC_TEXTURE_BOUNDS.minLon) * Math.PI / 180));

  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const sctx = sample.getContext("2d", { alpha: true });
  if (!sctx) return "";
  const image = sctx.createImageData(sampleW, sampleH);
  const data = image.data;
  const topMerc = mercatorY(WEST_PACIFIC_TEXTURE_BOUNDS.maxLat);
  const bottomMerc = mercatorY(WEST_PACIFIC_TEXTURE_BOUNDS.minLat);

  for (let y = 0; y < sampleH; y++) {
    const fy = (y + 0.5) / sampleH;
    const lat = inverseMercatorY(topMerc + (bottomMerc - topMerc) * fy);
    for (let x = 0; x < sampleW; x++) {
      const fx = (x + 0.5) / sampleW;
      const lon = WEST_PACIFIC_TEXTURE_BOUNDS.minLon + (WEST_PACIFIC_TEXTURE_BOUNDS.maxLon - WEST_PACIFIC_TEXTURE_BOUNDS.minLon) * fx;
      const sst = getSST(lat, lon, config);
      const value = kind === "sst" ? sst : getOHC(lat, lon, config, sst);
      const [r, g, b, a] = paletteColor(value, kind === "sst" ? SST_PALETTE : OHC_PALETTE);
      const i = (y * sampleW + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  sctx.putImageData(image, 0, 0);

  const output = document.createElement("canvas");
  output.width = outputW;
  output.height = Math.max(320, outputH);
  const ctx = output.getContext("2d", { alpha: true });
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sample, 0, 0, output.width, output.height);

  // Remove land with one vector pass instead of tens of thousands of point-in-polygon tests.
  if (landGeoJson?.features?.length) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    for (const feature of landGeoJson.features) traceGeometry(ctx, feature?.geometry, output.width, output.height);
    ctx.restore();
  }

  return output.toDataURL("image/png");
}

export function oceanTextureFingerprint(kind: OceanTextureKind, config: SimulationConfig, landRevision = "land"): string {
  return [kind, config.sstBase, config.sstNorthSouthGradient, config.sstPivotLat, config.sstAnomaly,
    config.warmPoolEnabled ? 1 : 0, config.coldEddyEnabled ? 1 : 0, kind === "ohc" ? config.ohcScale : "-", landRevision].join("|");
}
