import {threeHourlyReportNodes} from "./ThreeHourlyReportNodes";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Mp4Muxer from "mp4-muxer";
import { Typhoon, TyphoonState, TyphoonCategory, SimulationConfig } from "../types";
import { getAgencyIntensity, getCategoryColor, WEATHER_STATIONS_DATA, getEnvironmentalWind, getSST, getFluidDynamicsWindField, checkPointOnLandGeoJson, getProceduralElevation, getLandMetrics, materializeForecastPath, shouldHideCmaWindRadiiAfterLandfall } from "../simulation/Engine";
import { landGeoJson, countriesGeoJson, productLandGeoJson, productCountriesGeoJson } from "../simulation/NaturalEarthLoader";
import { calculateJmaWindCircleGeometry } from "./JmaWindRadii";
import { isJmaTrackDotTime, resolveJmaIssuedWindRadiiState } from "./JmaOperationalTiming";
import { getSimulationBeijingDate, isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";
import { getTyphoonDisplayName } from "./TyphoonDisplayName";
import { mergeTyphoonStateWithCurrentIdentity } from "./TyphoonIdentity";
import { getLocalVectorBasemapStyle, isLocalVectorBasemap, JMA_PRODUCT_COLORS, LOCAL_VECTOR_BASEMAPS } from "./LocalVectorBasemaps";
import { strokeProductCoastlineRing } from "./ProductCoastlineDrawing";
import { drawBlueMarble2002Mercator, drawBlueMarble2002LambertAzimuthalEqualArea, drawBlueMarble2002NorthPolarStereographic, loadBlueMarble2002 } from "./BlueMarble2002";
import {
  drawBlueMarble2004LambertAzimuthalEqualArea,
  drawBlueMarble2004NorthPolarStereographic,
  drawBlueMarble2004Mercator,
  getBlueMarble2004TileUrl,
  preloadBlueMarble2004MercatorViewport,
  preloadBlueMarble2004LambertAzimuthalEqualAreaViewport,
  preloadBlueMarble2004NorthPolarStereographicViewport
} from "./BlueMarble2004";
import { createLambertAzimuthalEqualAreaProjector, createNorthPolarStereographicProjector, getLambertAzimuthalEqualAreaMercatorViewportBounds, getNorthPolarStereographicMercatorViewportBounds, latLonToMercatorWorldPixel, unwrapLonAround, projectNorthPolarStereographicKm, northPolarStereographicScaleFactor } from "./MapProjection";

const videoForecastMaterializationCache = new WeakMap<object, { geometry: object; path: NonNullable<Typhoon["forecastPath"]> }>();

function resolveVideoForecastPath(typhoon: Typhoon, activeHist: TyphoonState | undefined): NonNullable<Typhoon["forecastPath"]> {
  const geometry = (activeHist?.forecastPath || typhoon.forecastPath || []) as NonNullable<Typhoon["forecastPath"]>;
  if (!geometry.length) return geometry;
  const deferred = geometry.some((pt) => pt.intensityDeferred === true || !Number.isFinite(Number(pt.vmax)) || !Number.isFinite(Number(pt.pmin)));
  if (!deferred) return geometry;
  const issueConfig = activeHist?.configSnapshot;
  if (!issueConfig) return geometry;

  const cacheKey = (activeHist || typhoon) as object;
  const cached = videoForecastMaterializationCache.get(cacheKey);
  if (cached?.geometry === geometry) return cached.path;

  const issueHour = Number(activeHist?.simHour ?? typhoon.simHour ?? 0);
  const seed: Typhoon = mergeTyphoonStateWithCurrentIdentity(typhoon, activeHist || {}, {
    active: !(activeHist as any)?.dissipated,
    history: (typhoon.history || []).filter((h) => Number(h.simHour) <= issueHour + 1e-6)
  });
  const horizon = Math.max(1, ...geometry.map((pt) => Number(pt.simHour || 0)).filter(Number.isFinite));
  const path = materializeForecastPath(seed, issueConfig, horizon, geometry);
  videoForecastMaterializationCache.set(cacheKey, { geometry: geometry as object, path });
  return path;
}

function getWindColor(speed: number, alphaMultiplier: number = 1.0): string {
  if (speed < 10) return `rgba(30, 156, 255, ${0.32 * alphaMultiplier})`;
  if (speed < 17) return `rgba(69, 212, 131, ${0.55 * alphaMultiplier})`;
  if (speed < 24) return `rgba(246, 211, 74, ${0.75 * alphaMultiplier})`;
  if (speed < 32) return `rgba(255, 140, 58, ${0.88 * alphaMultiplier})`;
  return `rgba(255, 77, 79, ${0.95 * alphaMultiplier})`;
}

function getVideoVectorBasemap(baseMap: VideoExportConfig["baseMap"]) {
  return getLocalVectorBasemapStyle(baseMap);
}

/** Reprojection is valid for geometry we fully own plus the two built-in Blue Marble sources.
 * Blue Marble 2002/2004 have dedicated LAEA and polar renderers; arbitrary network raster tiles do not. */
function canUseVideoReprojection(baseMap: VideoExportConfig["baseMap"]): boolean {
  return baseMap === "none" || baseMap === "blueMarble" || isLocalVectorBasemap(baseMap);
}

function getStationGradientColor(wind: number): string {
  const anchors = [
    [0, 16, 185, 129],
    [10, 34, 197, 94],
    [17, 234, 179, 8],
    [24, 249, 115, 22],
    [32, 239, 68, 68],
    [41, 220, 38, 38],
    [51, 168, 85, 247]
  ];
  if (wind <= 0) return `rgb(${anchors[0][1]}, ${anchors[0][2]}, ${anchors[0][3]})`;
  if (wind >= anchors[anchors.length - 1][0]) {
    const last = anchors[anchors.length - 1];
    return `rgb(${last[1]}, ${last[2]}, ${last[3]})`;
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const a1 = anchors[i];
    const a2 = anchors[i + 1];
    if (wind >= a1[0] && wind <= a2[0]) {
      const ratio = (wind - a1[0]) / (a2[0] - a1[0]);
      const r = Math.round(a1[1] + (a2[1] - a1[1]) * ratio);
      const g = Math.round(a1[2] + (a2[2] - a1[2]) * ratio);
      const b = Math.round(a1[3] + (a2[3] - a1[3]) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(16, 185, 129)";
}

export interface VideoExportConfig {
  agencyStyle?: "CMA" | "JMA";
  /** Special replay composition/profile. JMA Best Track keeps the standard renderer with locked JMA semantics; Himawari 8 uses its dedicated observation renderer. */
  replayStyle?: "standard" | "jma_best_track" | "himawari8_observation" | "himawari9_observation";
  /** Typhoon number printed by the Himawari-8/JMA observation replay plate. */
  jmaReplayTyphoonNumber?: number;
  intensityAgency?: "CMA" | "JMA" | "JTWC"; // independent wind assessment/display standard
  intensityReportingMode?: "public" | "continuous"; // published wind bins or continuous assessment
  trackStyle?: "CMA" | "JMA";
  trackDotStyle?: "CMA" | "JMA";
  windRadiiStyle?: "CMA" | "JMA";
  centerStyle?: "CMA" | "JMA";
  mechanismStyle?: "CMA" | "JMA";
  mode?: "trajectory" | "wind_forecast" | "rain_forecast"; // trajectory / wind forecast / rain forecast
  forecastHours?: number; // 预报时效 (默认 24小时)
  durationSec?: number; // 动画时长 (2-30秒)
  dateTimePosition?: "inside" | "top-left" | "top-right" | "bottom-left" | "bottom-right"; // 日期显示位置
  // Trajectory parameters
  /** Apply the reference-product colour grade to the basemap before overlays/export. */
  referenceBasemapColorGrade?: boolean;
  blueMarbleVersion?: "2002" | "2004";
  /** Optional storm-centred Lambert Azimuthal Equal-Area camera for all replay modes. */
  jmaAzimuthalEqualAreaProjection?: boolean;
  /** Himawari replay option matching the JMA forecast chart: north-polar stereographic, lon_0=140E / lat_ts=60N. */
  jmaNorthPolarStereographicProjection?: boolean;
  baseMap: "dark" | "jma" | "blackGray" | "himawari" | "stormTerrain" | "satellite" | "terrain" | "light" | "googleSatellite" | "googleStreet" | "blueMarble" | "bingSatellite" | "none";
  showCoastline: boolean; // 海岸线图层开关
  rasterResolution: "low" | "medium" | "high" | "ultra";
  showGrid: boolean; // 经纬度线
  showForecast: boolean; // 预报路线图层
  showUncertaintyCone: boolean; // 预报不确定性概率锥
  showWindRadii: boolean; // 风圈渲染
  showStations?: boolean; // 气象站点图层
  stationSizeScale?: number; // 气象站点显示大小
  fps?: number; // 1 to 60 fps
  endAction?: "none" | "pause" | "report"; // 结束后动作 (片尾报告)
  dotInterval: number; // 0 hides dots; any positive value shows CMA/NMC Beijing product-time dots
  showDataLabel: boolean; // 数据标注开关
  infoBoxStyle?: "agency" | "broadcast" | "monochrome" | "minimal"; // 信息框专业样式
  labelContent: "all" | "pressure" | "windSpeed"; // 标注内容
  showStatus: boolean; // 台风状态显示
  labelSize: "small" | "medium" | "large" | "extraLarge"; // 标注字号大小
  labelPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right"; // 标注位置
  centerFollow: boolean; // 中心跟随
  showDateTime: boolean; // 是否显示时间总开关
  dateTimeFormat: "relative" | "calendar"; // 时间格式：相对小时 or 真实日期
  showCasualties: boolean; // 是否显示伤亡人数信息
  zoomLevel: number; // 缩放等级
  aspectRatio: "16:9" | "4:3" | "3:4" | "1:1" | "9:16"; // 画面比例
  videoResolution: "360p" | "480p" | "720p" | "1080p" | "2K" | "4K"; // 画质分辨率
  videoCodec?: "H.264" | "H.265"; // 视频编码格式
  bitrate?: number; // 视频码率 (bps)
  startDate?: Date; // 模拟起算时间
  animSpeed?: number; // legacy fallback
}

export function getSimulationStartDate(config?: VideoExportConfig): Date {
  if (config?.startDate) return new Date(config.startDate);
  const savedStart = localStorage.getItem("typhoon_sim_start_date");
  return savedStart ? new Date(savedStart) : new Date("2027-06-30T20:00:00");
}

/**
 * 根据台风物理参数生成台风状态文字描述
 */
export function getTyphoonStatusText(state: TyphoonState): string {
  if (state.dissipated) return "已消散";
  if (state.coldAirWarmCoreDestroyed || state.category === TyphoonCategory.RL) return "残留低压云团";
  if (state.category === TyphoonCategory.ET || (state.extrTransition && state.extrTransition >= 0.80)) return "温带气旋";
  if (state.extrTransition && state.extrTransition >= 0.72) return "温带化变性中";
  if (state.extrTransition && state.extrTransition >= 0.34) return "副热带气旋";
  if (state.isStructureDamaged || ((state.maxLandElevationPassed || 0) > 2000 && (state.structuralDamageHours || 0) <= 48 && !state.landed)) {
    return "台风结构损坏";
  }
  if (state.landed) return "已登陆 (陆地衰减)";
  if (state.ewrcState === "forming" || state.ewrcState === "max_decay") return "眼墙置换中 (EWRC)";
  if (state.ewrcState === "recovering_success") return "置换成功 (新眼重建)";
  if (state.ewrcState === "recovering_failure") return "置换失败 (结构塌陷)";
  if (state.rapidIntensifying) return "爆发增强中 (RI)";
  
  if ((state.upwellingHours || 0) >= 6) {
    return "冷水上翻 (自涌衰减)";
  }

  if (state.isCoreDisrupted) return "核心结构破坏";
  if (state.category === TyphoonCategory.SuperTY) return "超强台风维持";
  if (state.vmax >= 45) return "强台风发展";
  if (state.vmax >= 33) return "稳步增强中";
  return "热带气旋发展中";
}

export interface RenderProgress {
  percentage: number;
  currentFrame: number;
  totalFrames: number;
  statusText: string;
}

// Convert the map-range selector (1..5, including half steps) to Mercator zoom.
// Keeping this continuous gives users useful intermediate framing instead of five coarse jumps.
export function getMercatorZoom(zoomIndex: number, canvasWidth: number = 1920): number {
  const level = Math.max(1, Math.min(5, Number.isFinite(zoomIndex) ? zoomIndex : 3));
  const baseZoom = 2.5 + level;
  // Scale zoom so that map geographical framing is identical across 720p, 1080p, and 4K resolutions
  return baseZoom + Math.log2(canvasWidth / 1920);
}

// Convert video settings to canvas dimensions W x H
export function getCanvasDimensions(aspectRatio: string, resolution: string): { width: number; height: number } {
  let baseWidth = 1920;
  if (resolution === "360p") baseWidth = 640;
  else if (resolution === "480p") baseWidth = 848;
  else if (resolution === "720p") baseWidth = 1280;
  else if (resolution === "2K") baseWidth = 2560;
  else if (resolution === "4K") baseWidth = 3840;

  let width = baseWidth;
  let height = Math.round(baseWidth * (9 / 16));

  if (aspectRatio === "16:9") {
    height = Math.round(width * (9 / 16));
  } else if (aspectRatio === "4:3") {
    height = Math.round(width * (3 / 4));
  } else if (aspectRatio === "3:4") {
    height = Math.round(width * (4 / 3));
  } else if (aspectRatio === "1:1") {
    height = width;
  } else if (aspectRatio === "9:16") {
    height = Math.round(width * (16 / 9));
  }

  // Strictly align to multiples of 16 for hardware encoder compatibility across all devices
  width = Math.round(width / 16) * 16;
  height = Math.round(height / 16) * 16;

  // AVC Level 5.2 maximum coded area is 9,437,184 pixels (e.g. 4096x2304)
  // If resolution * aspect ratio exceeds 9,437,184 pixels,
  // clamp width & height proportionally to fit within 9,437,184 pixels safely.
  const MAX_CODED_AREA = 9437184;
  if (width * height > MAX_CODED_AREA) {
    const scale = Math.sqrt(MAX_CODED_AREA / (width * height));
    width = Math.floor((width * scale) / 16) * 16;
    height = Math.floor((height * scale) / 16) * 16;
  }

  return { width, height };
}

// Web Mercator coordinate transformations
export function latLonToMercatorPixel(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const worldSize = 256 * Math.pow(2, zoom);

  // Mercator X
  const x = ((lon + 180) / 360) * worldSize;
  const cx = ((centerLon + 180) / 360) * worldSize;

  // Mercator Y
  const latRad = (lat * Math.PI) / 180;
  const centerLatRad = (centerLat * Math.PI) / 180;

  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * (worldSize / 2);
  const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);

  const screenX = canvasWidth / 2 + (x - cx);
  const screenY = canvasHeight / 2 + (y - cy);

  return { x: screenX, y: screenY };
}


// Map tile cache used by video preview/export.
class TileCache {
  private cache: Map<string, HTMLImageElement> = new Map();
  private pending: Map<string, Promise<HTMLImageElement>> = new Map();

    getTileUrl(baseMap: string, z: number, x: number, y: number): string {
    const maxTile = Math.pow(2, z);
    const tileZ = z;
    const tileX = ((x % maxTile) + maxTile) % maxTile;
    const tileY = Math.max(0, Math.min(maxTile - 1, y));

    switch (baseMap) {
      case "dark":
        return `https://tile.openstreetmap.org/${tileZ}/${tileX}/${tileY}.png`;
      case "light":
        return `https://a.basemaps.cartocdn.com/light_all/${tileZ}/${tileX}/${tileY}.png`;
      case "satellite":
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tileZ}/${tileY}/${tileX}`;
      case "terrain":
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/${tileZ}/${tileY}/${tileX}`;
      case "googleSatellite":
        return `https://mt1.google.com/vt/lyrs=s&x=${tileX}&y=${tileY}&z=${tileZ}`;
      case "googleStreet":
        return `https://mt1.google.com/vt/lyrs=m&x=${tileX}&y=${tileY}&z=${tileZ}`;
      case "blueMarble":
        return getBlueMarble2004TileUrl(tileZ, tileX, tileY);
      case "bingSatellite":
        let quadkey = '';
        for (let i = tileZ; i > 0; i--) {
          let digit = 0;
          let mask = 1 << (i - 1);
          if ((tileX & mask) !== 0) digit += 1;
          if ((tileY & mask) !== 0) digit += 2;
          quadkey += digit;
        }
        return `https://ecn.t0.tiles.virtualearth.net/tiles/a${quadkey}.jpeg?g=129&mkt=en-US`;
      default:
        return "";
    }
  }

  async loadTile(url: string, fallbackUrl?: string): Promise<HTMLImageElement | null> {
    if (!url) return Promise.resolve(null);
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (this.pending.has(url)) return this.pending.get(url)!;

    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.cache.set(url, img);
        this.pending.delete(url);
        resolve(img);
      };
      img.onerror = () => {
        // Retry only with an explicitly supplied alternate URL. This tile cache is retained for non-Blue-Marble
        // sources and the correctly-labelled 2004 GIBS fallback helper; genuine Blue Marble 2002 uses the static raster path.
        if (fallbackUrl && fallbackUrl !== url) {
          const fallbackImg = new Image();
          fallbackImg.crossOrigin = "anonymous";
          fallbackImg.onload = () => {
            this.cache.set(url, fallbackImg);
            this.pending.delete(url);
            resolve(fallbackImg);
          };
          fallbackImg.onerror = () => {
            this.pending.delete(url);
            resolve(null);
          };
          fallbackImg.src = fallbackUrl;
        } else {
          this.pending.delete(url);
          resolve(null);
        }
      };
      img.src = url;
    });

    this.pending.set(url, promise as any);
    return promise;
  }

  getTileIfLoaded(url: string): HTMLImageElement | null {
    return this.cache.get(url) || null;
  }
}

export const globalTileCache = new TileCache();

async function drawRasterBasemapLambertAzimuthalEqualArea(
  ctx: CanvasRenderingContext2D,
  baseMap: VideoExportConfig["baseMap"],
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  // Capture exactly the Mercator footprint needed by the LAEA frame.  A fixed hidden Mercator
  // viewport fails as the projection centre moves poleward because Mercator stretches latitude,
  // which used to create expanding black borders even though the selected LAEA zoom never changed.
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom) + 1));
  const sourceBounds = getLambertAzimuthalEqualAreaMercatorViewportBounds(
    centerLat, centerLon, zoom, width, height, tileZoom, 112, 28
  );
  const spanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
  const spanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
  const sourceScale = Math.max(0.25, Math.min(1.0, 1800 / spanX, 1450 / spanY));
  const sourceW = Math.max(300, Math.ceil(spanX * sourceScale));
  const sourceH = Math.max(220, Math.ceil(spanY * sourceScale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW;
  sourceCanvas.height = sourceH;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const minTileX = Math.floor(sourceBounds.minX / 256) - 1;
  const maxTileX = Math.ceil(sourceBounds.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(sourceBounds.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(sourceBounds.maxY / 256) + 1);
  const entries: Array<{ tx: number; ty: number; img: HTMLImageElement | null; url: string }> = [];
  const pending: Promise<void>[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const url = globalTileCache.getTileUrl(baseMap, tileZoom, tx, ty);
      const entry = { tx, ty, img: globalTileCache.getTileIfLoaded(url), url };
      entries.push(entry);
      if (!entry.img && url) pending.push(globalTileCache.loadTile(url).then((img) => { entry.img = img; }));
    }
  }
  if (pending.length) await Promise.all(pending);

  if (baseMap === "dark") {
    sourceCtx.save();
    sourceCtx.filter = "invert(0.92) hue-rotate(180deg) brightness(0.68) contrast(1.14) saturate(0.62)";
  }
  for (const { tx, ty, img } of entries) {
    if (!img) continue;
    const sx = (tx * 256 - sourceBounds.minX) * sourceScale;
    const sy = (ty * 256 - sourceBounds.minY) * sourceScale;
    const tileSize = 256 * sourceScale;
    sourceCtx.drawImage(img, sx, sy, tileSize, tileSize);
  }
  if (baseMap === "dark") sourceCtx.restore();

  let source: ImageData;
  try { source = sourceCtx.getImageData(0, 0, sourceW, sourceH); } catch { return; }

  // Lower working resolution makes the CPU inverse warp substantially faster.  Only the basemap
  // uses this bounded raster; tracks, wind circles and labels remain full-resolution vectors.
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
      const inv = projector.inverse(fullX, fullY);
      const dstIdx = (y * outW + x) * 4;
      if (!inv.valid || Math.abs(inv.lat) >= 85.05112878) continue;
      const lon = unwrapLonAround(inv.lon, centerLon);
      const world = latLonToMercatorWorldPixel(inv.lat, lon, tileZoom);
      const sx = (world.x - sourceBounds.minX) * sourceScale;
      const sy = (world.y - sourceBounds.minY) * sourceScale;
      if (sx < 0 || sy < 0 || sx >= sourceW - 1 || sy >= sourceH - 1) continue;
      const srcIdx = (Math.floor(sy) * sourceW + Math.floor(sx)) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  outCtx.putImageData(out, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(outCanvas, 0, 0, width, height);
  ctx.restore();

}

async function drawRasterBasemapNorthPolarStereographic(
  ctx: CanvasRenderingContext2D,
  baseMap: VideoExportConfig["baseMap"],
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number
) {
  const tileZoom = Math.max(1, Math.min(8, Math.floor(zoom) + 1));
  const sourceBounds = getNorthPolarStereographicMercatorViewportBounds(
    centerLat, centerLon, zoom, width, height, tileZoom, 112, 30, 140, 60
  );
  const spanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX);
  const spanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY);
  const sourceScale = Math.max(0.25, Math.min(1.0, 1800 / spanX, 1450 / spanY));
  const sourceW = Math.max(300, Math.ceil(spanX * sourceScale));
  const sourceH = Math.max(220, Math.ceil(spanY * sourceScale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceW;
  sourceCanvas.height = sourceH;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const minTileX = Math.floor(sourceBounds.minX / 256) - 1;
  const maxTileX = Math.ceil(sourceBounds.maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(sourceBounds.minY / 256) - 1);
  const maxTileY = Math.min(Math.pow(2, tileZoom) - 1, Math.ceil(sourceBounds.maxY / 256) + 1);
  const entries: Array<{ tx: number; ty: number; img: HTMLImageElement | null; url: string }> = [];
  const pending: Promise<void>[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const url = globalTileCache.getTileUrl(baseMap, tileZoom, tx, ty);
      const entry = { tx, ty, img: globalTileCache.getTileIfLoaded(url), url };
      entries.push(entry);
      if (!entry.img && url) pending.push(globalTileCache.loadTile(url).then((img) => { entry.img = img; }));
    }
  }
  if (pending.length) {
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 9000))
    ]);
  }

  if (baseMap === "dark") {
    sourceCtx.save();
    sourceCtx.filter = "invert(0.92) hue-rotate(180deg) brightness(0.68) contrast(1.14) saturate(0.62)";
  }
  for (const { tx, ty, img } of entries) {
    if (!img) continue;
    const sx = (tx * 256 - sourceBounds.minX) * sourceScale;
    const sy = (ty * 256 - sourceBounds.minY) * sourceScale;
    const tileSize = 256 * sourceScale;
    sourceCtx.drawImage(img, sx, sy, tileSize, tileSize);
  }
  if (baseMap === "dark") sourceCtx.restore();

  let source: ImageData;
  try { source = sourceCtx.getImageData(0, 0, sourceW, sourceH); } catch { return; }

  const outW = Math.max(360, Math.min(720, Math.round(width * 0.55)));
  const outH = Math.max(200, Math.round(height * outW / Math.max(1, width)));
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return;
  const out = outCtx.createImageData(outW, outH);
  const projector = createNorthPolarStereographicProjector(centerLat, centerLon, zoom, width, height, 140, 60);
  const src = source.data;
  const dst = out.data;
  const xScale = width / outW;
  const yScale = height / outH;

  for (let y = 0; y < outH; y++) {
    const fullY = (y + 0.5) * yScale;
    for (let x = 0; x < outW; x++) {
      const fullX = (x + 0.5) * xScale;
      const inv = projector.inverse(fullX, fullY);
      const dstIdx = (y * outW + x) * 4;
      if (!inv.valid || Math.abs(inv.lat) >= 85.05112878) continue;
      const lon = unwrapLonAround(inv.lon, centerLon);
      const world = latLonToMercatorWorldPixel(inv.lat, lon, tileZoom);
      const sx = (world.x - sourceBounds.minX) * sourceScale;
      const sy = (world.y - sourceBounds.minY) * sourceScale;
      if (sx < 0 || sy < 0 || sx >= sourceW - 1 || sy >= sourceH - 1) continue;
      const srcIdx = (Math.floor(sy) * sourceW + Math.floor(sx)) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  outCtx.putImageData(out, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(outCanvas, 0, 0, width, height);
  ctx.restore();
}

// Helper to interpolate typhoon state between two history steps
// Catmull-Rom spline formula for smooth C1 continuous movement
function jmaWindRadiiStepHours(history: TyphoonState[], currentSimHour: number, currentState?: Partial<TyphoonState>) {
  return resolveJmaIssuedWindRadiiState(history, currentSimHour, currentState as TyphoonState | undefined).stepHours;
}

function steppedJmaWindRadiiState(history: TyphoonState[], currentSimHour: number, currentState: TyphoonState) {
  return resolveJmaIssuedWindRadiiState(history, currentSimHour, currentState).state;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Helper to interpolate typhoon state smoothly between history steps using spline curves
export function interpolateTyphoonSmooth(
  history: TyphoonState[],
  currentSimHour: number
): TyphoonState {
  if (!history || history.length === 0) return {} as TyphoonState;
  if (history.length === 1 || currentSimHour <= history[0].simHour) return history[0];
  if (currentSimHour >= history[history.length - 1].simHour) return history[history.length - 1];

  let i = 0;
  for (; i < history.length - 1; i++) {
    if (currentSimHour >= history[i].simHour && currentSimHour <= history[i + 1].simHour) {
      break;
    }
  }

  const s1 = history[i];
  const s2 = history[i + 1];
  const span = s2.simHour - s1.simHour;
  const t = span > 0 ? (currentSimHour - s1.simHour) / span : 0;

  const s0 = history[Math.max(0, i - 1)];
  const s3 = history[Math.min(history.length - 1, i + 2)];

  const smoothLat = catmullRom(s0.lat, s1.lat, s2.lat, s3.lat, t);
  const smoothLon = catmullRom(s0.lon, s1.lon, s2.lon, s3.lon, t);

  const lerp = (a: number, b: number) => a + (b - a) * t;
  // Wind radii are operational analyses, not continuously interpolated physical fields.
  // The hourly history already holds the last CMA/NMC Beijing-time product analysis, so replay/video
  // keeps that exact footprint until the next CMA product update instead of morphing it.
  const heldR7 = s1.r7;
  const heldR10 = s1.r10;
  const heldR12 = s1.r12;

  return {
    ...s1,
    lat: smoothLat,
    lon: smoothLon,
    vmax: lerp(s1.vmax, s2.vmax),
    pmin: lerp(s1.pmin, s2.pmin),
    rmw: lerp(s1.rmw, s2.rmw),
    r7: heldR7,
    r10: heldR10,
    r12: heldR12,
    casualties: lerp(s1.casualties || 0, s2.casualties || 0),
    simHour: currentSimHour,
    stationReadings: s1.stationReadings
  };
}


/** Linear position/state interpolation used by camera-locked replay styles.
 * Unlike Catmull-Rom it cannot overshoot a sharp track bend, so the camera center
 * remains monotonic between adjacent history fixes and never appears to jump. */
function interpolateTyphoonLinear(history: TyphoonState[], currentSimHour: number): TyphoonState {
  if (!history?.length) return {} as TyphoonState;
  if (history.length === 1 || currentSimHour <= history[0].simHour) return history[0];
  if (currentSimHour >= history[history.length - 1].simHour) return history[history.length - 1];
  let i = 0;
  while (i < history.length - 1 && currentSimHour > history[i + 1].simHour) i++;
  const a = history[i];
  const b = history[Math.min(history.length - 1, i + 1)];
  const span = Math.max(1e-6, b.simHour - a.simHour);
  const t = Math.max(0, Math.min(1, (currentSimHour - a.simHour) / span));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    ...a,
    lat: lerp(a.lat, b.lat),
    lon: lerp(a.lon, b.lon),
    vmax: lerp(a.vmax, b.vmax),
    pmin: lerp(a.pmin, b.pmin),
    rmw: lerp(a.rmw, b.rmw),
    simHour: currentSimHour,
    r7: a.r7, r10: a.r10, r12: a.r12
  };
}

/** Latest 3-hour analysis used only for replay information fields (pressure, wind, category,
 * motion, etc.).  The moving centre/track remain smooth, and JMA wind radii continue to use their
 * independent issued-radii clock via steppedJmaWindRadiiState(). */
function latestThreeHourlyReplayInfoState(history: TyphoonState[], currentSimHour: number, fallback: TyphoonState): TyphoonState {
  if (!history?.length) return fallback;
  const sorted = history.slice().sort((a, b) => a.simHour - b.simHour);
  const firstHour = Number(sorted[0].simHour || 0);
  const lastHour = Number(sorted[sorted.length - 1].simHour || firstHour);
  const capped = Math.max(firstHour, Math.min(currentSimHour, lastHour));
  const stepIndex = Math.max(0, Math.floor((capped - firstHour + 1e-6) / 3));
  const analysisHour = Math.min(lastHour, firstHour + stepIndex * 3);
  const exact = sorted.find((state) => Math.abs(state.simHour - analysisHour) < 1e-6);
  return exact || interpolateTyphoonLinear(sorted, analysisHour);
}

function replayWholeHour(currentSimHour: number): number {
  // Replay clocks jump exactly once per hour and always display xx:00.  Use floor rather than
  // round so a 30-minute in-between video frame cannot prematurely advance the visible hour.
  return Math.max(0, Math.floor(currentSimHour + 1e-6));
}

/** Build the observation-replay track from completed one-hour vertices only.
 *
 * This path is deliberately *not* a continuously interpolated trace. Every visible corner belongs
 * to an integer simulation hour. If an old/imported archive lacks an exact integer-hour record we
 * construct that one missing hourly vertex linearly, but fractional video-frame positions are never
 * appended to the path. The moving centre may animate between analyses; the best-track line itself
 * advances one straight 1-hour leg at a time.
 */
function buildThreeHourlyReplayPolyline(history: TyphoonState[], currentSimHour: number): TyphoonState[] {
  if (!history?.length) return [];
  const sorted = history.slice().sort((a, b) => a.simHour - b.simHour);
  const first = sorted[0];
  const firstHour = Number(first.simHour || 0);
  const lastAllowed = Math.min(currentSimHour, sorted[sorted.length - 1].simHour);
  if (lastAllowed < firstHour - 1e-6) return [];

  // JMA/Himawari replay tracks are bulletin-like 3-hour polylines.  Between nodes the
  // cyclone itself may move smoothly, but the already-issued path must remain unchanged
  // until the next 3-hour node becomes available.
  const points: TyphoonState[] = [first];
  const nodeCount = Math.floor((lastAllowed - firstHour + 1e-6) / 3);
  for (let i = 1; i <= nodeCount; i++) {
    const h = firstHour + i * 3;
    const existing = sorted.find((state) => Math.abs(state.simHour - h) < 1e-6);
    const state = existing || interpolateTyphoonLinear(sorted, h);
    const prev = points[points.length - 1];
    if (!prev || Math.abs(prev.simHour - state.simHour) > 1e-6) points.push(state);
  }
  return points;
}

export function interpolateTyphoonState(
  s1: TyphoonState,
  s2: TyphoonState,
  fraction: number
): TyphoonState {
  const lerp = (a: number, b: number) => a + (b - a) * fraction;
  // Hold the previously issued CMA/NMC wind-area analysis between history frames.
  const heldR7 = fraction >= 0.999 ? s2.r7 : s1.r7;
  const heldR10 = fraction >= 0.999 ? s2.r10 : s1.r10;
  const heldR12 = fraction >= 0.999 ? s2.r12 : s1.r12;

  return {
    ...s1,
    lat: lerp(s1.lat, s2.lat),
    lon: lerp(s1.lon, s2.lon),
    vmax: lerp(s1.vmax, s2.vmax),
    pmin: lerp(s1.pmin, s2.pmin),
    rmw: lerp(s1.rmw, s2.rmw),
    r7: heldR7,
    r10: heldR10,
    r12: heldR12,
    casualties: lerp(s1.casualties || 0, s2.casualties || 0),
    simHour: s1.simHour + fraction * (s2.simHour - s1.simHour),
    stationReadings: s1.stationReadings
  };
}

// -----------------------------------------------------------------------------
// Himawari-8 observation-style replay renderer
// -----------------------------------------------------------------------------
// This is a clean-room vector recreation of the user-provided broadcast reference:
// no satellite/cloud raster and no source-video watermark/copyright overlay.  It keeps
// the reference composition: muted Web-Mercator map, JMA 30/50-kt circles, intensity-
// coloured historical path, Japanese observation plate, and bottom-left wind legend.
const clampVideo01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const HIMAWARI_JMA_COLORS = {
  ocean: "#252f47",
  land: "#4a614b",
  coast: "#111a1b",
  border: "rgba(15,24,24,0.72)",
  grid: "rgba(216,224,231,0.18)",
  strong: "#EEF537",
  storm: "#CB3045",
  td: "#bdbdc5",
  ts: "#a5caf9",
  sts: "#f3f401",
  ty: "#ffb141",
  sty: "#ff4047",
  super: "#dd50df",
  et: "#67d3ff"
} as const;

function himawariJmaWindMs(state: Pick<TyphoonState, "vmax">): number {
  // Internal VMAX is CMA-like 2-min; JMA reporting in Engine uses the same 0.952 factor.
  return Math.max(0, state.vmax || 0) * 0.952;
}

function isHimawariExtratropical(state: Pick<TyphoonState, "category" | "extrTransition" | "coldAirWarmCoreDestroyed">): boolean {
  if (state.coldAirWarmCoreDestroyed || state.category === TyphoonCategory.RL) return false;
  return state.category === TyphoonCategory.ET || Number(state.extrTransition || 0) >= 0.80;
}

function himawariTrackColor(state: Pick<TyphoonState, "vmax" | "category" | "extrTransition" | "coldAirWarmCoreDestroyed">): string {
  // In the Himawari replay, ET is encoded by the same pale dashed line convention as a TD.
  // Keep the cyan ET colour for legend/text accents only; using it on the path made ET look like
  // a separate solid blue intensity class instead of a dashed cyclone-nature state.
  if (state.category === TyphoonCategory.RL || state.coldAirWarmCoreDestroyed) return HIMAWARI_JMA_COLORS.td;
  if (isHimawariExtratropical(state)) return HIMAWARI_JMA_COLORS.td;
  const ms = Math.max(0, state.vmax || 0) * 0.952;
  if (ms < 17) return HIMAWARI_JMA_COLORS.td;
  if (ms < 25) return HIMAWARI_JMA_COLORS.ts;
  if (ms < 33) return HIMAWARI_JMA_COLORS.sts;
  if (ms < 44) return HIMAWARI_JMA_COLORS.ty;
  if (ms < 54) return HIMAWARI_JMA_COLORS.sty;
  return HIMAWARI_JMA_COLORS.super;
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function haversineKmVideo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function bearingVideo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function japaneseDirection8(deg: number): string {
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function japaneseDirection16(deg: number): string {
  const dirs = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function himawariLocationText(lat: number, lon: number): string {
  // Reference broadcasts describe the centre relative to nearby Ryukyu/Japanese islands.
  // Use the same grammatical form when a useful landmark is nearby, then fall back to a
  // broad basin/land-region name for the rest of the western North Pacific.
  const landmarks = [
    { name: "久米島", lat: 26.340, lon: 126.805 },
    { name: "沖永良部島", lat: 27.370, lon: 128.580 },
    { name: "沖縄本島", lat: 26.500, lon: 127.950 },
    { name: "奄美大島", lat: 28.320, lon: 129.450 },
    { name: "屋久島", lat: 30.350, lon: 130.520 },
    { name: "宮古島", lat: 24.800, lon: 125.280 },
    { name: "石垣島", lat: 24.340, lon: 124.160 }
  ];
  let nearest: (typeof landmarks)[number] | null = null;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const mark of landmarks) {
    const km = haversineKmVideo(mark.lat, mark.lon, lat, lon);
    if (km < nearestKm) { nearest = mark; nearestKm = km; }
  }
  if (nearest && nearestKm <= 450) {
    const dir = japaneseDirection8(bearingVideo(nearest.lat, nearest.lon, lat, lon));
    const rounded = Math.max(10, roundToNearest(nearestKm, 10));
    return `${nearest.name}の${dir}約${rounded}km`;
  }

  if (checkPointOnLandGeoJson(lat, lon)) {
    if (lon >= 107 && lon <= 122 && lat >= 24 && lat <= 34) return "華中";
    if (lon >= 105 && lon <= 122 && lat >= 18 && lat < 24) return "華南";
    if (lon >= 108 && lon <= 123 && lat > 34 && lat <= 42) return "華北";
    if (lon >= 120 && lon <= 146 && lat >= 30 && lat <= 46) return "日本付近";
    return "陸上";
  }
  if (lon >= 118 && lon <= 132 && lat >= 22 && lat <= 34) return "東シナ海";
  if (lon >= 105 && lon <= 122 && lat >= 5 && lat < 22) return "南シナ海";
  if (lon >= 125 && lon <= 150 && lat >= 8 && lat < 25) return "フィリピンの東";
  if (lon >= 130 && lon <= 155 && lat >= 25 && lat <= 36) return "日本の南";
  return "西太平洋";
}

function himawariWindAreaText(radii: TyphoonState["r7"] | undefined, factor: number): string {
  if (!radii) return "なし";
  const values = [
    { key: "ne", label: "北東", value: Math.max(0, radii.ne || 0) * factor, opposite: "sw" },
    { key: "se", label: "南東", value: Math.max(0, radii.se || 0) * factor, opposite: "nw" },
    { key: "sw", label: "南西", value: Math.max(0, radii.sw || 0) * factor, opposite: "ne" },
    { key: "nw", label: "北西", value: Math.max(0, radii.nw || 0) * factor, opposite: "se" }
  ];
  const positive = values.filter((q) => q.value > 0);
  if (!positive.length) return "なし";
  const max = Math.max(...positive.map((q) => q.value));
  const min = Math.min(...positive.map((q) => q.value));
  if (min > 0 && max / min < 1.16) return `全域${roundToNearest(positive.reduce((a, q) => a + q.value, 0) / positive.length, 5)}km`;
  const major = positive.reduce((a, b) => a.value >= b.value ? a : b);
  const opposite = values.find((q) => q.key === major.opposite) || positive.reduce((a, b) => a.value <= b.value ? a : b);
  return `${major.label}${roundToNearest(major.value, 5)}km ${opposite.label}${roundToNearest(opposite.value, 5)}km`;
}

function drawHimawariGeoJson(
  ctx: CanvasRenderingContext2D,
  geo: any,
  toScreen: (lat: number, lon: number) => { x: number; y: number },
  fill: string | null,
  stroke: string,
  lineWidth: number,
  suppressCoastlineSeams = false
) {
  if (!geo?.features) return;
  const drawRing = (ring: any[]) => {
    if (!Array.isArray(ring) || ring.length < 3) return;
    ctx.beginPath();
    let started = false;
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const p = toScreen(Number(coord[1]), Number(coord[0]));
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    if (!started) return;
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    if (suppressCoastlineSeams) strokeProductCoastlineRing(ctx, ring, toScreen);
    else ctx.stroke();
  };
  for (const feature of geo.features) {
    const g = feature?.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      const rings = g.coordinates || [];
      if (rings[0]) drawRing(rings[0]);
    } else if (g.type === "MultiPolygon") {
      for (const polygon of g.coordinates || []) if (polygon?.[0]) drawRing(polygon[0]);
    }
  }
}

function renderHimawariObservationReplayFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  currentState: TyphoonState,
  currentSimHour: number,
  exportConfig: VideoExportConfig,
  customCenter?: { lat: number; lon: number }
) {
  const history = typhoon.history || [];
  if (!history.length) return;
  const s = Math.min(width / 1440, height / 1080);
  const currentIsEt = isHimawariExtratropical(currentState);
  const renderedHistory = history.filter((h) => h.simHour <= currentSimHour + 1e-6);
  const hadTyphoon = renderedHistory.some((h) => himawariJmaWindMs(h) >= 17);
  // Pressure/wind/category/motion/location are bulletin information: hold one analysis for three
  // hours. The observation clock and smoothly moving centre remain independent of this state.
  const analysisState = latestThreeHourlyReplayInfoState(history, currentSimHour, currentState);

  const projectionAllowed = canUseVideoReprojection(exportConfig.baseMap);
  const useHimawariPolarStereographic = projectionAllowed && !!exportConfig.jmaNorthPolarStereographicProjection;
  const useHimawariAzimuthalProjection = projectionAllowed && !!exportConfig.jmaAzimuthalEqualAreaProjection && !useHimawariPolarStereographic;
  let centerLat = currentState.lat;
  let centerLon = currentState.lon;
  if (!useHimawariAzimuthalProjection && !useHimawariPolarStereographic && customCenter) {
    centerLat = customCenter.lat;
    centerLon = customCenter.lon;
  } else if (!useHimawariAzimuthalProjection && !useHimawariPolarStereographic && !exportConfig.centerFollow) {
    centerLat = history.reduce((sum, h) => sum + h.lat, 0) / history.length;
    centerLon = history.reduce((sum, h) => sum + h.lon, 0) / history.length;
  }

  // The reference places the cyclone near 56% of frame width so the fixed left data panel never
  // covers the core.  In LAEA mode the mathematical projection origin follows the storm, but the
  // completed projected map is translated by the same fixed screen offset.  The LAEA scale itself
  // is fixed (see MapProjection.ts), so north/south motion no longer produces camera zoom breathing.
  const himawariZoomLevel = Math.max(1, Math.min(5, Number(exportConfig.zoomLevel || 4)));
  const referenceZoom = (5.20 + 0.45 * himawariZoomLevel) + Math.log2(width / 1440);
  const cycloneOffsetX = width * 0.058;
  const cycloneOffsetY = height * 0.005;
  const himawariLaeaProjector = useHimawariAzimuthalProjection
    ? createLambertAzimuthalEqualAreaProjector(currentState.lat, currentState.lon, referenceZoom, width, height)
    : null;
  const polarCenter = useHimawariPolarStereographic
    ? projectNorthPolarStereographicKm(currentState.lat, currentState.lon, 140, 60)
    : null;
  const polarLocalScale = useHimawariPolarStereographic
    ? (256 * Math.pow(2, referenceZoom)) / (2 * Math.PI * 6371.0088) / Math.max(0.25, northPolarStereographicScaleFactor(currentState.lat, 60))
    : 0;
  const toScreen = (lat: number, lon: number) => {
    let p: { x: number; y: number };
    if (himawariLaeaProjector) {
      p = himawariLaeaProjector.project(lat, lon);
    } else if (useHimawariPolarStereographic && polarCenter) {
      const q = projectNorthPolarStereographicKm(lat, lon, 140, 60);
      p = {
        x: width / 2 + (q.x - polarCenter.x) * polarLocalScale,
        y: height / 2 - (q.y - polarCenter.y) * polarLocalScale
      };
    } else {
      p = latLonToMercatorPixel(lat, lon, centerLat, centerLon, referenceZoom, width, height);
    }
    return { x: p.x + cycloneOffsetX, y: p.y + cycloneOffsetY };
  };

  ctx.save();
  ctx.fillStyle = HIMAWARI_JMA_COLORS.ocean;
  ctx.fillRect(0, 0, width, height);

  // Geographic grid beneath land, matching the subdued straight/slightly Mercator-curved broadcast grid.
  ctx.strokeStyle = HIMAWARI_JMA_COLORS.grid;
  ctx.lineWidth = Math.max(0.7, 1.0 * s);
  for (let lon = 90; lon <= 180; lon += 5) {
    ctx.beginPath();
    let first = true;
    for (let lat = 0; lat <= 55; lat += 1) {
      const p = toScreen(lat, lon);
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  for (let lat = 0; lat <= 55; lat += 5) {
    ctx.beginPath();
    let first = true;
    for (let lon = 90; lon <= 180; lon += 1) {
      const p = toScreen(lat, lon);
      if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  const videoLandGeoJson = productLandGeoJson || landGeoJson;
  const videoCountriesGeoJson = productCountriesGeoJson || countriesGeoJson;
  if (videoLandGeoJson?.features) {
    drawHimawariGeoJson(ctx, videoLandGeoJson, toScreen, HIMAWARI_JMA_COLORS.land, HIMAWARI_JMA_COLORS.coast, Math.max(0.9, 1.35 * s), true);
  }
  // Do not fall back to the retired hand-drawn EAST_ASIA_LAND outline. If detailed Natural Earth
  // geometry is unavailable for a frame, keep the clean ocean plate rather than showing a coarse,
  // visibly angular coastline that can be mistaken for real geography.
  // Do not stroke country polygon exteriors here: they duplicate the detailed coastline with a
  // coarser geometry and can show up as an angular second shoreline.

  // Intensity-coloured historical path.  TD portions are pale and dashed; named-storm portions
  // use the exact threshold sequence printed in the lower-left reference legend.
  const pathStates: TyphoonState[] = buildThreeHourlyReplayPolyline(history, currentSimHour);
  // Deliberately keep visible angular changes at each 3 h vertex. Rounded caps are retained only
  // at the ends of individual coloured segments; no Catmull-Rom/Bezier path smoothing is used.
  ctx.lineCap = "round";
  ctx.lineJoin = "miter";
  for (let i = 1; i < pathStates.length; i++) {
    const a = pathStates[i - 1];
    const b = pathStates[i];
    const p1 = toScreen(a.lat, a.lon);
    const p2 = toScreen(b.lat, b.lon);
    const et = isHimawariExtratropical(a);
    const remnant = a.category === TyphoonCategory.RL || !!a.coldAirWarmCoreDestroyed;
    const td = !et && !remnant && himawariJmaWindMs(a) < 17;
    ctx.setLineDash((td || et || remnant) ? [8 * s, 7 * s] : []);
    ctx.strokeStyle = himawariTrackColor(a);
    ctx.lineWidth = Math.max(2.4, 4.8 * s);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  // The completed polyline still gains a permanent vertex only every 3 h, but its live end must
  // remain attached to the continuously moving cyclone centre.  At the next 3 h analysis this
  // temporary segment simply becomes the next fixed straight leg.
  const lastThreeHourly = pathStates[pathStates.length - 1];
  if (lastThreeHourly && lastThreeHourly.simHour < currentSimHour - 1e-6) {
    const p1 = toScreen(lastThreeHourly.lat, lastThreeHourly.lon);
    const p2 = toScreen(currentState.lat, currentState.lon);
    const et = isHimawariExtratropical(lastThreeHourly);
    const remnant = lastThreeHourly.category === TyphoonCategory.RL || !!lastThreeHourly.coldAirWarmCoreDestroyed;
    const td = !et && !remnant && himawariJmaWindMs(lastThreeHourly) < 17;
    ctx.setLineDash((td || et || remnant) ? [8 * s, 7 * s] : []);
    ctx.strokeStyle = himawariTrackColor(lastThreeHourly);
    ctx.lineWidth = Math.max(2.4, 4.8 * s);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // JMA public wind areas. In this replay style the published wind-area geometry is
  // held for a six-hour bulletin block, while its centre continues to follow the
  // smoothly moving cyclone. This prevents the radius from visibly breathing every frame.
  const windRadiiState = steppedJmaWindRadiiState(history, currentSimHour, currentState);
  if (exportConfig.showWindRadii !== false && !currentState.dissipated && !currentIsEt) {
    const drawCircle = (radii: TyphoonState["r7"], level: "strong" | "storm", stroke: string) => {
      // Diagnose the whole circle (radius + asymmetric offset) from the six-hour issue state,
      // then translate that frozen geometry with the continuously moving centre.  This keeps the
      // wind area visually attached to the cyclone without letting coast sampling/radii breathe
      // between issue times.
      const issued = calculateJmaWindCircleGeometry({
        lat: windRadiiState.lat,
        lon: windRadiiState.lon,
        vmaxCmaMs: windRadiiState.vmax,
        landed: !!windRadiiState.landed,
        radii,
        level
      }, checkPointOnLandGeoJson);
      if (!issued.visible || issued.radiusKm <= 0) return;
      // Round146: freeze the *issued* geometry, including its projection scale,
      // after landfall. Only translate its screen position by the current
      // storm-centre displacement; do not recalculate ellipse radii at the
      // continuously changing centre latitude on each interpolated frame.
      const issuedCenter = toScreen(issued.centerLat, issued.centerLon);
      const issuedCyclone = toScreen(windRadiiState.lat, windRadiiState.lon);
      const liveCyclone = toScreen(currentState.lat, currentState.lon);
      const deltaX = liveCyclone.x - issuedCyclone.x;
      const deltaY = liveCyclone.y - issuedCyclone.y;
      const c = { x: issuedCenter.x + deltaX, y: issuedCenter.y + deltaY };
      const east = toScreen(issued.centerLat, issued.centerLon + issued.radiusKm / (111.12 * Math.max(0.22, Math.cos(issued.centerLat * Math.PI / 180))));
      const north = toScreen(issued.centerLat + issued.radiusKm / 111.12, issued.centerLon);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(2.4, (level === "strong" ? 4.5 : 4.1) * s);
      ctx.beginPath();
      if (useHimawariAzimuthalProjection || useHimawariPolarStereographic) {
        const radiusPx = Math.max(1, (Math.hypot(east.x - issuedCenter.x, east.y - issuedCenter.y) + Math.hypot(north.x - issuedCenter.x, north.y - issuedCenter.y)) * 0.5);
        ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2);
      } else {
        ctx.ellipse(c.x, c.y, Math.max(1, Math.abs(east.x - issuedCenter.x)), Math.max(1, Math.abs(north.y - issuedCenter.y)), 0, 0, Math.PI * 2);
      }
      ctx.stroke();
    };
    drawCircle(windRadiiState.r7, "strong", HIMAWARI_JMA_COLORS.strong);
    drawCircle(windRadiiState.r10, "storm", HIMAWARI_JMA_COLORS.storm);
  }

  // A restrained centre cue is useful when clouds are deliberately omitted.  Keep it tiny so it
  // does not invent a symbol absent from the reference's satellite-covered centre.
  const centerPt = toScreen(currentState.lat, currentState.lon);
  ctx.fillStyle = "rgba(240,243,245,0.86)";
  ctx.beginPath(); ctx.arc(centerPt.x, centerPt.y, Math.max(1.5, 2.2 * s), 0, Math.PI * 2); ctx.fill();

  const startDate = getSimulationStartDate(exportConfig);
  const currentJst = new Date(startDate.getTime() + replayWholeHour(currentSimHour) * 3600000 + 9 * 3600000);
  currentJst.setUTCMinutes(0, 0, 0);
  const analysisJst = new Date(startDate.getTime() + analysisState.simHour * 3600000 + 9 * 3600000);
  analysisJst.setUTCMinutes(0, 0, 0);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const fontSans = '"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans CJK JP","Meiryo",sans-serif';

  // Top-left observation clock, separate from the analysis panel just like the reference video.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.88)";
  ctx.shadowBlur = 3.5 * s;
  ctx.shadowOffsetX = 1.2 * s;
  ctx.shadowOffsetY = 1.5 * s;
  ctx.fillStyle = "#eef1f0";
  ctx.font = `700 ${Math.round(27 * s)}px ${fontSans}`;
  ctx.fillText("ひまわり8号 観測", 31 * s, 20 * s);
  ctx.font = `800 ${Math.round(53 * s)}px ${fontSans}`;
  ctx.fillText(`${pad2(currentJst.getUTCMonth() + 1)}/${pad2(currentJst.getUTCDate())} ${pad2(currentJst.getUTCHours())}:${pad2(currentJst.getUTCMinutes())}`, 29 * s, 52 * s);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  const stormNumber = Math.max(1, Math.min(99, Math.round(exportConfig.jmaReplayTyphoonNumber ?? 18)));
  const panelX = 26 * s;
  const panelY = 129 * s;
  const panelW = 380 * s;
  const blueHeaderH = 52 * s;
  const analysisWindMs = himawariJmaWindMs(analysisState);
  const analysisEt = isHimawariExtratropical(analysisState);
  const analysisRemnant = analysisState.category === TyphoonCategory.RL || !!analysisState.coldAirWarmCoreDestroyed;
  const analysisTd = !analysisEt && !analysisRemnant && (analysisWindMs < 17 || analysisState.category === TyphoonCategory.TD || analysisState.dissipated);
  const panelH = (analysisEt ? 410 : (analysisTd || analysisRemnant) ? 318 : 456) * s;

  ctx.fillStyle = "rgba(230,233,235,0.94)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "#5278af";
  ctx.lineWidth = Math.max(1, 2 * s);
  ctx.strokeRect(panelX, panelY, panelW, panelH);
  ctx.fillStyle = "#3d6db2";
  ctx.fillRect(panelX, panelY, 170 * s, blueHeaderH);
  ctx.fillStyle = "rgba(211,215,218,0.96)";
  ctx.fillRect(panelX + 170 * s, panelY, panelW - 170 * s, blueHeaderH);
  ctx.fillStyle = "#f4f6f7";
  ctx.font = `800 ${Math.round(32 * s)}px ${fontSans}`;
  ctx.textBaseline = "middle";
  ctx.fillText(`台風${stormNumber}号`, panelX + 10 * s, panelY + blueHeaderH / 2);
  ctx.fillStyle = "#2b2f32";
  ctx.font = `700 ${Math.round(24 * s)}px ${fontSans}`;
  ctx.fillText(`${analysisJst.getUTCDate()}日 ${pad2(analysisJst.getUTCHours())}時の実況`, panelX + 178 * s, panelY + blueHeaderH / 2 + 1 * s);
  ctx.fillStyle = "#5f6264";
  ctx.font = `500 ${Math.round(14 * s)}px ${fontSans}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("※速報値", panelX + panelW - 8 * s, panelY - 4 * s);

  // Intensity band.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(198,203,207,0.96)";
  ctx.fillRect(panelX, panelY + blueHeaderH, panelW, 70 * s);
  let category = getAgencyIntensity(analysisState.vmax, "JMA", "public").category.replace(/台風$/u, "");
  if (analysisEt) category = "温帯低気圧(ET)";
  else if (analysisTd) category = "熱帯低気圧(TD)";
  else if (!category || category === "") category = "台風";
  ctx.fillStyle = "#25282a";
  ctx.font = `800 ${Math.round(36 * s)}px ${fontSans}`;
  ctx.fillText(category, panelX + panelW / 2, panelY + blueHeaderH + 35 * s);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const bodyX = panelX + 14 * s;
  let y = panelY + blueHeaderH + 82 * s;
  ctx.fillStyle = "#282c2f";
  ctx.font = `600 ${Math.round(21 * s)}px ${fontSans}`;
  ctx.fillText("中心気圧", bodyX, y);
  ctx.font = `800 ${Math.round(38 * s)}px ${fontSans}`;
  ctx.fillText(`${Math.round(analysisState.pmin)}hPa`, bodyX, y + 25 * s);
  y += 82 * s;

  if (!analysisTd) {
    const maxWindMs = roundToNearest(analysisWindMs, 5);
    const gustFactor = 1.36 + 0.13 * clampVideo01(Number((analysisState as any).eyewallIntegrity ?? (analysisState as any).coreCompactness ?? 0.5));
    const gustMs = Math.max(maxWindMs + 5, roundToNearest(analysisWindMs * gustFactor, 5));
    ctx.font = `600 ${Math.round(19 * s)}px ${fontSans}`;
    ctx.fillText("最大風速", bodyX, y);
    ctx.fillText("最大瞬間風速", panelX + 172 * s, y);
    ctx.font = `800 ${Math.round(33 * s)}px ${fontSans}`;
    ctx.fillText(`${maxWindMs}m/s`, bodyX, y + 25 * s);
    ctx.fillText(`${gustMs}m/s`, panelX + 172 * s, y + 25 * s);
    y += 78 * s;
  }

  // Lower grey operational rows.
  ctx.fillStyle = "rgba(196,202,207,0.92)";
  ctx.fillRect(panelX, y - 6 * s, panelW, panelY + panelH - (y - 6 * s));
  ctx.fillStyle = "#303438";
  ctx.font = `600 ${Math.round(18 * s)}px ${fontSans}`;
  const analysisLoc = himawariLocationText(analysisState.lat, analysisState.lon);
  const motionSpeed = Math.max(0, roundToNearest(Number(analysisState.speed || 0), 5));
  const motionText = motionSpeed < 5 ? `${japaneseDirection16(Number(analysisState.direction || 0))}にゆっくり` : `${japaneseDirection16(Number(analysisState.direction || 0))}に${motionSpeed}km/h`;
  const rows: string[] = [
    `存在地域 ${analysisLoc}`,
    `進行方向 ${motionText}`
  ];
  // Wind-area rows intentionally stay on the pre-existing issued-radii mechanism. They must not
  // inherit the new 3-hour scalar-information clock.
  if (!currentState.dissipated && !currentIsEt) {
    rows.push(`暴風域　${himawariWindAreaText(windRadiiState.r10, 0.84)}`);
    rows.push(`強風域　${himawariWindAreaText(windRadiiState.r7, 0.88)}`);
  }
  rows.push(`中心位置 ${analysisState.lon.toFixed(1)}°E ${analysisState.lat.toFixed(1)}°N 正確`);
  rows.forEach((line, i) => ctx.fillText(line, bodyX, y + i * 29 * s));

  if (analysisTd && hadTyphoon) {
    const msgY = panelY + panelH + 7 * s;
    ctx.fillStyle = "#eef1f2";
    ctx.shadowColor = "rgba(0,0,0,.86)";
    ctx.shadowBlur = 3.0 * s;
    ctx.shadowOffsetX = 1.1 * s;
    ctx.shadowOffsetY = 1.2 * s;
    ctx.font = `700 ${Math.round(18 * s)}px ${fontSans}`;
    ctx.fillText(`台風${stormNumber}号は熱帯低気圧に変わりました`, panelX + 3 * s, msgY);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (analysisEt) {
    const msgY = panelY + panelH + 7 * s;
    ctx.fillStyle = "#dff5ff";
    ctx.shadowColor = "rgba(0,0,0,.86)";
    ctx.shadowBlur = 3.0 * s;
    ctx.shadowOffsetX = 1.1 * s;
    ctx.shadowOffsetY = 1.2 * s;
    ctx.font = `700 ${Math.round(18 * s)}px ${fontSans}`;
    ctx.fillText(`台風${stormNumber}号は温帯低気圧に変わりました`, panelX + 3 * s, msgY);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Bottom-left path legend; wording/thresholds match the supplied reference image.
  const legendX = 25 * s;
  const legendY = height - 132 * s;
  const legendW = 382 * s;
  const legendH = 112 * s;
  ctx.fillStyle = "rgba(22,27,37,0.76)";
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.fillStyle = "#eef1f2";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.round(20 * s)}px ${fontSans}`;
  ctx.fillText("最大風速 [m/s]", legendX + 11 * s, legendY + 10 * s);
  const barX = legendX + 14 * s;
  const barY = legendY + 54 * s;
  const tdW = 94 * s;
  const segmentW = 52 * s;
  const barH = 11 * s;
  // Reference legend: the sub-17 m/s stage is a pale dashed sample; named-typhoon
  // intensities are five solid blocks with boundaries labelled 17/25/33/44/54.
  ctx.save();
  ctx.strokeStyle = HIMAWARI_JMA_COLORS.td;
  ctx.lineWidth = Math.max(3, 6 * s);
  ctx.setLineDash([8 * s, 5 * s]);
  ctx.beginPath();
  ctx.moveTo(barX, barY + barH / 2);
  ctx.lineTo(barX + tdW - 10 * s, barY + barH / 2);
  ctx.stroke();
  ctx.restore();
  const colors = [HIMAWARI_JMA_COLORS.ts, HIMAWARI_JMA_COLORS.sts, HIMAWARI_JMA_COLORS.ty, HIMAWARI_JMA_COLORS.sty, HIMAWARI_JMA_COLORS.super];
  const solidX = barX + tdW;
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(solidX + i * segmentW, barY, segmentW - 1 * s, barH);
  });
  const thresholds = [17, 25, 33, 44, 54];
  ctx.fillStyle = "#edf0f1";
  ctx.font = `600 ${Math.round(13 * s)}px ${fontSans}`;
  ctx.textAlign = "center";
  thresholds.forEach((t, i) => ctx.fillText(String(t), solidX + i * segmentW, barY + 15 * s));
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = HIMAWARI_JMA_COLORS.et;
  ctx.font = `700 ${Math.round(13 * s)}px ${fontSans}`;
  ctx.fillText("ET 温帯低気圧", legendX + legendW - 12 * s, legendY + 10 * s);

  ctx.restore();
}


export async function renderVideoFrameOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  currentSimHour: number,
  exportConfig: VideoExportConfig,
  customCenter?: { lat: number; lon: number }
) {
  const history = typhoon.history;
  if (!history || history.length === 0) return;

  // 1. Determine current state with Catmull-Rom smooth spline interpolation
  const currentState: TyphoonState = interpolateTyphoonSmooth(history, currentSimHour);
  const replayInfoState = exportConfig.replayStyle === "jma_best_track"
    ? latestThreeHourlyReplayInfoState(history, currentSimHour, currentState)
    : currentState;
  const frameDisplayName = getTyphoonDisplayName(typhoon, currentSimHour, getSimulationStartDate(exportConfig));

  if (exportConfig.replayStyle === "himawari8_observation" || exportConfig.replayStyle === "himawari9_observation") {
    // Use a fixed-scale, linear camera state for this broadcast-style composition. The
    // spline state remains useful elsewhere, but its overshoot at sharp turns can visibly
    // jerk a center-follow camera even though the underlying hourly track is continuous.
    const lockedState = interpolateTyphoonLinear(history, currentSimHour);
    renderHimawariObservationReplayFrame(ctx, width, height, { ...typhoon, name: frameDisplayName }, lockedState, currentSimHour, exportConfig, customCenter);
    return;
  }

  const agencyStyle = exportConfig.agencyStyle || "CMA";
  const trackStyle = exportConfig.trackStyle || agencyStyle;
  const trackDotStyle = exportConfig.trackDotStyle || agencyStyle;
  const windRadiiStyle = exportConfig.windRadiiStyle || agencyStyle;
  const centerStyle = exportConfig.centerStyle || agencyStyle;
  const mechanismStyle = exportConfig.mechanismStyle || agencyStyle;

  // Camera center
  let centerLat = currentState.lat;
  let centerLon = currentState.lon;

  if (customCenter) {
    centerLat = customCenter.lat;
    centerLon = customCenter.lon;
  } else if (!exportConfig.centerFollow) {
    // Calculate centroid of full history
    let sumLat = 0;
    let sumLon = 0;
    history.forEach((h) => {
      sumLat += h.lat;
      sumLon += h.lon;
    });
    centerLat = sumLat / history.length;
    centerLon = sumLon / history.length;
  }

  const projectionAllowed = canUseVideoReprojection(exportConfig.baseMap);
  const useJmaPolarProjection = projectionAllowed && !!exportConfig.jmaNorthPolarStereographicProjection;
  const useJmaAzimuthalProjection = projectionAllowed && !!exportConfig.jmaAzimuthalEqualAreaProjection && !useJmaPolarProjection;
  if (useJmaAzimuthalProjection || useJmaPolarProjection) {
    // Reprojected replay modes are storm-centred in screen space. The user-selected zoom itself
    // remains untouched; only the map projection changes.
    centerLat = currentState.lat;
    centerLon = currentState.lon;
  }
  const zoom = getMercatorZoom(exportConfig.zoomLevel, width);
  const laeaProjector = useJmaAzimuthalProjection
    ? createLambertAzimuthalEqualAreaProjector(centerLat, centerLon, zoom, width, height)
    : null;
  const polarProjector = useJmaPolarProjection
    ? createNorthPolarStereographicProjector(centerLat, centerLon, zoom, width, height, 140, 60)
    : null;

  // All storm overlays use the exact same projection as the basemap. Wind rings and point
  // symbols are still drawn as canvas circles after their geographic centre is projected, so
  // they remain perfectly round rather than inheriting projection deformation.
  const toScreen = (lat: number, lon: number) =>
    polarProjector ? polarProjector.project(lat, lon) :
    laeaProjector ? laeaProjector.project(lat, lon) :
    latLonToMercatorPixel(lat, lon, centerLat, centerLon, zoom, width, height);

  // Reference colour reconstruction for the historical Digital Typhoon / JMA Best Track plate.
  // Unlike a global CSS filter, this separates Blue-Marble ocean from land so the sea can
  // become the characteristic blue-violet (#38407a-ish) without bleaching the yellow-green land.
  const applyJmaBestTrackReferenceGrade = (target: CanvasRenderingContext2D, w: number, h: number) => {
    try {
      const image = target.getImageData(0, 0, w, h);
      const d = image.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const blueDominance = b - Math.max(r, g);
        // Blue Marble open water is dark and blue-dominant.  A soft membership avoids
        // a visible seam along shallow water / coastlines.
        const oceanBlue = Math.max(0, Math.min(1, (blueDominance + 4) / 24));
        const oceanDark = Math.max(0, Math.min(1, (132 - (r + g + b) / 3) / 76));
        const ocean = oceanBlue * (0.45 + 0.55 * oceanDark);

        // Land: old Digital Typhoon imagery is substantially brighter and more
        // yellow-green than the raw modern Blue Marble tiles. Preserve terrain texture.
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // The reference plate is not vivid modern satellite colour: vegetation is a muted
        // yellow/olive green and deserts are softly beige.  Desaturate first, then bias warm.
        const landR = Math.min(255, lum * 0.40 + r * 0.33 + g * 0.25 + 30);
        const landG = Math.min(255, lum * 0.36 + g * 0.48 + r * 0.12 + 36);
        const landB = Math.min(255, lum * 0.18 + b * 0.22 + g * 0.10 + 8);

        // Ocean: retain luminance detail, but lift the near-black source into the
        // blue-violet analogue-video palette visible in the 1980s reference capture.
        const detail = Math.max(-18, Math.min(22, lum - 43));
        const oceanR = Math.max(0, Math.min(255, 67 + detail * 0.28));
        const oceanG = Math.max(0, Math.min(255, 76 + detail * 0.34));
        const oceanB = Math.max(0, Math.min(255, 145 + detail * 0.48));

        d[i]     = Math.round(landR * (1 - ocean) + oceanR * ocean);
        d[i + 1] = Math.round(landG * (1 - ocean) + oceanG * ocean);
        d[i + 2] = Math.round(landB * (1 - ocean) + oceanB * ocean);
      }
      target.putImageData(image, 0, 0);
    } catch {
      // If a browser denies pixel access for a third-party tile, retain the already
      // rendered Blue Marble frame rather than breaking preview/export.
    }
  };

  // 2. Clear canvas with oceanic background. JMA/black-gray are local vector
  // basemaps, so they never depend on network tile availability.
  ctx.save();
  // Historical Digital Typhoon style can optionally recolor Blue Marble into a closer old-video palette.
  const useJmaReferenceGrade = !!exportConfig.referenceBasemapColorGrade && exportConfig.replayStyle === "jma_best_track" && exportConfig.baseMap === "blueMarble" && agencyStyle !== "JMA";
  // LAEA mode reprojects the selected basemap itself, so the chosen basemap can now be kept.
  const jmaProductMap = (exportConfig.replayStyle === "jma_best_track" ||
    (agencyStyle === "JMA" && exportConfig.replayStyle !== "himawari8_observation" && exportConfig.replayStyle !== "himawari9_observation"));
  const effectiveBaseMap: VideoExportConfig["baseMap"] = jmaProductMap ? "jma" : exportConfig.baseMap;
  const blueMarbleVersion = exportConfig.blueMarbleVersion || "2002";
  const vectorBasemap = getVideoVectorBasemap(effectiveBaseMap);
  ctx.fillStyle = vectorBasemap?.ocean ?? (effectiveBaseMap === "light" ? "#f8fafc" : "#07111F");
  ctx.fillRect(0, 0, width, height);

  // 3. Draw map background. Tile sources use the cached pipeline; local vector
  // styles are drawn from Natural Earth coastlines with the reference colours.
  if (effectiveBaseMap === "blueMarble" && blueMarbleVersion === "2002") {
    const blueMarble2002 = await loadBlueMarble2002(true);
    if (blueMarble2002) {
      if (useJmaPolarProjection) {
        drawBlueMarble2002NorthPolarStereographic(ctx, blueMarble2002, width, height, centerLat, centerLon, zoom);
      } else if (useJmaAzimuthalProjection) {
        drawBlueMarble2002LambertAzimuthalEqualArea(ctx, blueMarble2002, width, height, centerLat, centerLon, zoom);
      } else {
        drawBlueMarble2002Mercator(ctx, blueMarble2002, width, height, centerLat, centerLon, zoom, width >= 2560 ? 2 : 3);
      }
    }
  } else if (effectiveBaseMap === "blueMarble" && blueMarbleVersion === "2004") {
    if (useJmaPolarProjection) {
      await drawBlueMarble2004NorthPolarStereographic(ctx, width, height, centerLat, centerLon, zoom);
    } else if (useJmaAzimuthalProjection) {
      await drawBlueMarble2004LambertAzimuthalEqualArea(ctx, width, height, centerLat, centerLon, zoom);
    } else {
      // Use the dedicated 2004 cache/loader instead of the generic per-frame tile pipeline.
      // This shares the preloaded GIBS tiles with every frame and prevents JMA Best Track
      // exports from stalling while repeatedly waiting for the same WMS requests.
      await drawBlueMarble2004Mercator(ctx, width, height, centerLat, centerLon, zoom);
    }
  } else if (effectiveBaseMap !== "none" && !vectorBasemap && useJmaPolarProjection) {
    await drawRasterBasemapNorthPolarStereographic(ctx, effectiveBaseMap, width, height, centerLat, centerLon, zoom);
  } else if (effectiveBaseMap !== "none" && !vectorBasemap && useJmaAzimuthalProjection) {
    await drawRasterBasemapLambertAzimuthalEqualArea(ctx, effectiveBaseMap, width, height, centerLat, centerLon, zoom);
  } else if (effectiveBaseMap !== "none" && !vectorBasemap) {
    const tileZoom = Math.floor(zoom);
    const scaleFactor = Math.pow(2, zoom - tileZoom);
    const worldSize = 256 * Math.pow(2, tileZoom);

    const cx = ((centerLon + 180) / 360) * worldSize;
    const centerLatRad = (centerLat * Math.PI) / 180;
    const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);

    const minX = Math.floor((cx - (width / (2 * scaleFactor))) / 256) - 1;
    const maxX = Math.ceil((cx + (width / (2 * scaleFactor))) / 256) + 1;
    const minY = Math.floor((cy - (height / (2 * scaleFactor))) / 256) - 1;
    const maxY = Math.ceil((cy + (height / (2 * scaleFactor))) / 256) + 1;

    type FrameTile = { tx: number; ty: number; url: string; img: HTMLImageElement | null };
    const frameTiles: FrameTile[] = [];
    const missingLoads: Promise<void>[] = [];
    for (let tx = minX; tx <= maxX; tx++) {
      for (let ty = minY; ty <= maxY; ty++) {
        const url = globalTileCache.getTileUrl(effectiveBaseMap, tileZoom, tx, ty);
        const entry: FrameTile = { tx, ty, url, img: globalTileCache.getTileIfLoaded(url) };
        frameTiles.push(entry);
        if (!entry.img && url) {
          missingLoads.push(globalTileCache.loadTile(url).then((img) => { entry.img = img; }));
        }
      }
    }
    if (missingLoads.length) {
      await Promise.race([
        Promise.allSettled(missingLoads).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 9000))
      ]);
    }

    const useOsmNightFilter = effectiveBaseMap === "dark";
    if (useOsmNightFilter) {
      ctx.save();
      ctx.filter = "invert(0.92) hue-rotate(180deg) brightness(0.68) contrast(1.14) saturate(0.62)";
    }
    for (const { tx, ty, img } of frameTiles) {
      const screenX = width / 2 + (tx * 256 - cx) * scaleFactor;
      const screenY = height / 2 + (ty * 256 - cy) * scaleFactor;
      const tileSize = 256 * scaleFactor;
      if (img) ctx.drawImage(img, screenX, screenY, tileSize, tileSize);
    }
    if (useOsmNightFilter) ctx.restore();
  }

  if (useJmaReferenceGrade) {
    applyJmaBestTrackReferenceGrade(ctx, width, height);
    // A gentle lift after recolouring helps mimic the lighter legacy Digital Typhoon capture.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(255, 250, 228, 0.05)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // 4. Draw Land Polygons (Coastlines/Borders). Local vector basemaps always
  // draw their coastlines because the coastline is the basemap itself.
  const uiScale = width / 1280;

  const videoLandGeoJson = productLandGeoJson || landGeoJson;
  const videoCountriesGeoJson = productCountriesGeoJson || countriesGeoJson;
  if (vectorBasemap && videoLandGeoJson?.features) {
    drawHimawariGeoJson(ctx, videoLandGeoJson, toScreen, vectorBasemap.land, vectorBasemap.coast, Math.max(0.9, 1.05 * uiScale), true);
    // Country polygon exteriors contain a simplified duplicate coastline.  Omitting this outline
    // keeps the detailed Natural Earth land ring as the only shoreline on offline vector maps.
  }

  if (exportConfig.showCoastline && !vectorBasemap) {
    const jmaMap = agencyStyle === "JMA";
    ctx.fillStyle = jmaMap ? "rgba(0,0,0,0)" : (exportConfig.baseMap === "light" ? "rgba(203,213,225,0.4)" : "rgba(15,23,42,0.5)");
    ctx.strokeStyle = jmaMap ? LOCAL_VECTOR_BASEMAPS.jma.coast : (exportConfig.baseMap === "light" ? "rgba(100,116,139,0.6)" : "rgba(30,156,255,0.7)");
    ctx.lineWidth = Math.max(1, (jmaMap ? 1.0 : 1.2) * uiScale);

    if (videoLandGeoJson?.features) {
      drawHimawariGeoJson(
        ctx, videoLandGeoJson, toScreen,
        agencyStyle !== "JMA" ? ctx.fillStyle as string : null,
        ctx.strokeStyle as string, ctx.lineWidth, true
      );
    }
  }

  // 5. Draw Lat/Lon Grid Lines if enabled
  if (exportConfig.showGrid || jmaProductMap) {
    ctx.strokeStyle = jmaProductMap ? JMA_PRODUCT_COLORS.grid : (exportConfig.baseMap === "light" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)");
    ctx.fillStyle = exportConfig.baseMap === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
    ctx.font = `${Math.round(11 * uiScale)}px sans-serif`;
    ctx.lineWidth = Math.max(1, 1 * uiScale);

    if (useJmaAzimuthalProjection || useJmaPolarProjection) {
      // A projected grid must use the same transform as coastlines and tracks. The old code
      // only projected one anchor and then drew a screen-horizontal/vertical line, which could make
      // a reprojected map look indistinguishable from Mercator even while the land itself changed.
      for (let lat = -5; lat <= 60; lat += 5) {
        ctx.beginPath();
        let started = false;
        for (let lon = 80; lon <= 200; lon += 1) {
          const p = toScreen(lat, lon);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
        }
        if (started) ctx.stroke();
      }
      for (let lon = 80; lon <= 200; lon += 5) {
        ctx.beginPath();
        let started = false;
        for (let lat = -5; lat <= 65; lat += 1) {
          const p = toScreen(lat, lon);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
        }
        if (started) ctx.stroke();
      }
    } else {
      for (let lat = 0; lat <= 55; lat += 5) {
        const p1 = toScreen(lat, 90);
        ctx.beginPath();
        ctx.moveTo(0, p1.y);
        ctx.lineTo(width, p1.y);
        ctx.stroke();
        if (p1.y > 20 * uiScale && p1.y < height - 20 * uiScale) {
          ctx.fillText(`${lat}°N`, 12 * uiScale, p1.y - 4 * uiScale);
        }
      }
      for (let lon = 90; lon <= 180; lon += 5) {
        const p1 = toScreen(0, lon);
        ctx.beginPath();
        ctx.moveTo(p1.x, 0);
        ctx.lineTo(p1.x, height);
        ctx.stroke();
        if (p1.x > 30 * uiScale && p1.x < width - 30 * uiScale) {
          ctx.fillText(`${lon}°E`, p1.x + 4 * uiScale, height - 12 * uiScale);
        }
      }
    }
  }

  // 6. Draw Forecast Path & Uncertainty Cone if enabled
  const renderedHistory = history.filter((h) => h.simHour <= currentSimHour);
  const useThreeHourlyJmaTrack = exportConfig.replayStyle === "jma_best_track" || trackStyle === "JMA";
  const renderedTrackHistory = useThreeHourlyJmaTrack
    ? buildThreeHourlyReplayPolyline(history, currentSimHour)
    : renderedHistory;
  const activeHist = renderedHistory.length > 0 ? renderedHistory[renderedHistory.length - 1] : history[0];
  // Replay/video rendering is a product-generation path: hydrate deferred intensity from the
  // archived hourly issue state/config once, then reuse it for every frame within that hour.
  const fPath = resolveVideoForecastPath(typhoon, activeHist);

  if (exportConfig.showForecast && fPath && fPath.length > 0) {
    // Draw uncertainty as one continuous probability envelope, matching the generated
    // forecast chart. The previous stacked-circle appearance has been removed.
    if (exportConfig.showUncertaintyCone) {
      const rawConeTrack = [
        { lat: currentState.lat, lon: currentState.lon, simHour: 0 },
        ...fPath.filter((pt) => pt.simHour > 0)
      ];
      const coneTrack: Array<{ lat: number; lon: number; simHour: number }> = [];
      rawConeTrack.forEach((pt, idx) => {
        const prev = coneTrack[coneTrack.length - 1];
        if (!prev || Math.hypot(pt.lat - prev.lat, pt.lon - prev.lon) > 0.05 || idx === rawConeTrack.length - 1) {
          coneTrack.push(pt);
        }
      });

      if (coneTrack.length >= 2) {
        const centers = coneTrack.map((pt) => toScreen(pt.lat, pt.lon));
        const leftPts: Array<{ x: number; y: number }> = [];
        const rightPts: Array<{ x: number; y: number }> = [];

        coneTrack.forEach((pt, i) => {
          const p = centers[i];
          let vx = 0;
          let vy = 0;
          if (i < centers.length - 1) {
            vx += centers[i + 1].x - p.x;
            vy += centers[i + 1].y - p.y;
          }
          if (i > 0) {
            vx += p.x - centers[i - 1].x;
            vy += p.y - centers[i - 1].y;
          }
          const len = Math.hypot(vx, vy) || 1;
          const nx = -vy / len;
          const ny = vx / len;
          const radiusDeg = Math.min(4.2, 0.032 * Math.max(0, pt.simHour) + 0.45);
          const radiusPoint = toScreen(pt.lat, pt.lon + radiusDeg);
          const radiusPx = Math.abs(radiusPoint.x - p.x);
          leftPts.push({ x: p.x + nx * radiusPx, y: p.y + ny * radiusPx });
          rightPts.push({ x: p.x - nx * radiusPx, y: p.y - ny * radiusPx });
        });

        const radiiPx = coneTrack.map((pt, i) => {
          const p = centers[i];
          const radiusDeg = Math.min(4.2, 0.032 * Math.max(0, pt.simHour) + 0.45);
          return Math.abs(toScreen(pt.lat, pt.lon + radiusDeg).x - p.x);
        });
        const n = coneTrack.length - 1;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(leftPts[0].x, leftPts[0].y);
        for (let i = 1; i <= n; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
        const endLeft = Math.atan2(leftPts[n].y - centers[n].y, leftPts[n].x - centers[n].x);
        const endRight = Math.atan2(rightPts[n].y - centers[n].y, rightPts[n].x - centers[n].x);
        ctx.arc(centers[n].x, centers[n].y, radiiPx[n], endLeft, endRight, true);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
        const startRight = Math.atan2(rightPts[0].y - centers[0].y, rightPts[0].x - centers[0].x);
        const startLeft = Math.atan2(leftPts[0].y - centers[0].y, leftPts[0].x - centers[0].x);
        ctx.arc(centers[0].x, centers[0].y, radiiPx[0], startRight, startLeft, true);
        ctx.closePath();
        ctx.fillStyle = "rgba(175, 115, 150, 0.40)";
        ctx.fill();
        ctx.restore();
      }
    }

    // Draw dashed forecast line
    ctx.setLineDash([Math.round(8 * uiScale), Math.round(6 * uiScale)]);
    ctx.lineWidth = Math.max(1.2, (trackStyle === "JMA" ? 3.8 : 3) * uiScale);

    for (let i = 0; i < fPath.length; i++) {
      const ptStart = i === 0 ? toScreen(currentState.lat, currentState.lon) : toScreen(fPath[i - 1].lat, fPath[i - 1].lon);
      const ptEnd = toScreen(fPath[i].lat, fPath[i].lon);

      ctx.strokeStyle = trackStyle === "JMA" ? "#ffffff" : getCategoryColor(fPath[i].category);
      ctx.beginPath();
      ctx.moveTo(ptStart.x, ptStart.y);
      ctx.lineTo(ptEnd.x, ptEnd.y);
      ctx.stroke();
    }
    ctx.setLineDash([]); // reset

    // Draw forecast node dots
    fPath.forEach((pt) => {
      const scr = toScreen(pt.lat, pt.lon);
      ctx.fillStyle = trackDotStyle === "JMA" ? "#ffffff" : getCategoryColor(pt.category);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(1, (trackDotStyle === "JMA" ? 1.7 : 1.5) * uiScale);
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, Math.max(trackDotStyle === "JMA" ? 2.4 : 3, (trackDotStyle === "JMA" ? 6.8 : 5) * uiScale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  // 7. Draw Historical Track. JMA-style permanent vertices update every three hours, while the
  // final temporary leg always follows the current centre so the cyclone never visually detaches
  // from its path between bulletin vertices.
  if (renderedTrackHistory.length > 0) {
    for (let i = 0; i < renderedTrackHistory.length - 1; i++) {
      const h1 = renderedTrackHistory[i];
      const h2 = renderedTrackHistory[i + 1];
      const scr1 = toScreen(h1.lat, h1.lon);
      const scr2 = toScreen(h2.lat, h2.lon);

      ctx.strokeStyle = trackStyle === "JMA" ? "#ffffff" : getCategoryColor(h1.category);
      ctx.lineWidth = Math.max(2, (trackStyle === "JMA" ? 4.8 : 4) * uiScale);
      ctx.beginPath();
      ctx.moveTo(scr1.x, scr1.y);
      ctx.lineTo(scr2.x, scr2.y);
      ctx.stroke();
    }

    const lastHist = renderedTrackHistory[renderedTrackHistory.length - 1];
    if (lastHist.simHour < currentState.simHour - 1e-6) {
      const scr1 = toScreen(lastHist.lat, lastHist.lon);
      const scr2 = toScreen(currentState.lat, currentState.lon);
      ctx.strokeStyle = trackStyle === "JMA" ? "#ffffff" : getCategoryColor(lastHist.category);
      ctx.lineWidth = Math.max(2, (trackStyle === "JMA" ? 4.8 : 4) * uiScale);
      ctx.beginPath();
      ctx.moveTo(scr1.x, scr1.y);
      ctx.lineTo(scr2.x, scr2.y);
      ctx.stroke();
    }
  }

  // Historical Best Track dots: JMA-style products now use a restrained 24-hour cadence.
  if (exportConfig.dotInterval > 0) {
    const simStart = getSimulationStartDate(exportConfig);
    const dotHistory = useThreeHourlyJmaTrack ? renderedTrackHistory : renderedHistory;
    const firstHistoryHour = Number(dotHistory[0]?.simHour || 0);
    dotHistory.forEach((h, idx) => {
      const isLastDissipated = idx === dotHistory.length - 1 && !!h.dissipated;
      const showDot = trackDotStyle === "JMA"
        ? isJmaTrackDotTime(Number(h.simHour), firstHistoryHour) || isLastDissipated
        : (isCmaTyphoonProductTime(simStart, h.simHour) || isLastDissipated);
      if (!showDot) return;

      const scr = toScreen(h.lat, h.lon);
      const radius = trackDotStyle === "JMA" ? 9.8 : 5;
      ctx.fillStyle = trackDotStyle === "JMA" ? "#ffffff" : getCategoryColor(h.category);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(1, (trackDotStyle === "JMA" ? 1.2 : 1.5) * uiScale);
      ctx.beginPath();
      ctx.arc(scr.x, scr.y, Math.max(trackDotStyle === "JMA" ? 2 : 3, radius * uiScale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  // 8. Draw 3-Tier 4-Quadrant Wind Circles (`r7`, `r10`, `r12`) for current state.
  // Do not hide JMA wind areas merely because the centre has crossed land. The shared
  // JMA geometry routine already contracts/shifts the reportable 30/50-kt circles from
  // coastline sampling, matching the Himawari replay mechanism after landfall.
  if (exportConfig.showWindRadii && (windRadiiStyle === "JMA" || !shouldHideCmaWindRadiiAfterLandfall(currentState))) {
    const jmaIssuedState = windRadiiStyle === "JMA" ? steppedJmaWindRadiiState(history, currentSimHour, currentState) : currentState;
    const levels = windRadiiStyle === "JMA"
      ? [
          { radii: jmaIssuedState.r7, color: "rgba(0,0,0,0)", stroke: JMA_PRODUCT_COLORS.strongWind, label: "强风圈" },
          { radii: jmaIssuedState.r10, color: "rgba(0,0,0,0)", stroke: JMA_PRODUCT_COLORS.stormWind, label: "暴风圈" }
        ]
      : [
          { radii: currentState.r7, color: "rgba(243, 156, 18, 0.25)", stroke: "#f39c12", label: "7级风圈" },
          { radii: currentState.r10, color: "rgba(211, 84, 0, 0.35)", stroke: "#d35400", label: "10级风圈" },
          { radii: currentState.r12, color: "rgba(192, 57, 43, 0.45)", stroke: "#c0392b", label: "12级风圈" }
        ];

    levels.forEach((lvl) => {
      const q = lvl.radii;
      const vals = [q.ne, q.se, q.sw, q.nw].filter(v => Number.isFinite(v) && v > 0);
      if (!vals.length) return;

      if (windRadiiStyle === "JMA") {
        const geometry = calculateJmaWindCircleGeometry(
          {
            lat: jmaIssuedState.lat,
            lon: jmaIssuedState.lon,
            vmaxCmaMs: jmaIssuedState.vmax,
            landed: !!jmaIssuedState.landed,
            radii: q,
            level: lvl.label === "强风圈" ? "strong" : "storm"
          },
          (lat, lon) => getLandMetrics(lat, lon, currentState.configSnapshot?.coastlineSource).isLand
        );
        if (!geometry.visible) return;
        const issuedCenter = toScreen(geometry.centerLat, geometry.centerLon);
        const issuedStorm = toScreen(jmaIssuedState.lat, jmaIssuedState.lon);
        const liveStorm = toScreen(currentState.lat, currentState.lon);
        const c = { x: issuedCenter.x + liveStorm.x - issuedStorm.x,
          y: issuedCenter.y + liveStorm.y - issuedStorm.y };
        const e = toScreen(
          geometry.centerLat,
          geometry.centerLon + geometry.radiusKm / (111.12 * Math.max(0.2, Math.cos(geometry.centerLat * Math.PI / 180)))
        );
        const radiusPx = Math.max(1, Math.abs(e.x - issuedCenter.x));
        ctx.save();
        ctx.strokeStyle = lvl.stroke;
        ctx.lineWidth = Math.max(1.2, 4.2 * uiScale);
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      const quadPoints: { x: number; y: number }[] = [];
      const quadrants: Array<[number, number, number]> = [
        [0, 90, q.ne], [90, 180, q.se], [180, 270, q.sw], [270, 360, q.nw]
      ];
      quadrants.forEach(([from, to, radius]) => {
        if (!radius || radius <= 0) return;
        for (let deg = from; deg <= to; deg += 3) {
          const rad = deg * Math.PI / 180;
          const dLat = radius * Math.cos(rad) / 111.12;
          const dLon = radius * Math.sin(rad) / (111.12 * Math.max(0.2, Math.cos(currentState.lat * Math.PI / 180)));
          quadPoints.push(toScreen(currentState.lat + dLat, currentState.lon + dLon));
        }
      });
      if (quadPoints.length < 4) return;
      ctx.fillStyle = lvl.color;
      ctx.strokeStyle = lvl.stroke;
      ctx.lineWidth = Math.max(1.1, 2.3 * uiScale);
      ctx.beginPath();
      quadPoints.forEach((pt, idx) => idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }

  // 9. Draw Active Typhoon Center Symbol
  const centerScr = toScreen(currentState.lat, currentState.lon);
  const catColor = getCategoryColor(currentState.category);

  if (centerStyle === "JMA") {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2.3, 3.8 * uiScale);
    ctx.lineCap = "round";
    const arm = 13.8 * uiScale;
    ctx.beginPath();
    ctx.moveTo(centerScr.x - arm, centerScr.y - arm);
    ctx.lineTo(centerScr.x + arm, centerScr.y + arm);
    ctx.moveTo(centerScr.x + arm, centerScr.y - arm);
    ctx.lineTo(centerScr.x - arm, centerScr.y + arm);
    ctx.stroke();
    ctx.restore();
  } else {
    // CMA outer glowing ring
    ctx.fillStyle = catColor;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(centerScr.x, centerScr.y, 16 * uiScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = catColor;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(1, 2 * uiScale);
    ctx.beginPath();
    ctx.arc(centerScr.x, centerScr.y, 8 * uiScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(centerScr.x, centerScr.y, 2.5 * uiScale, 0, Math.PI * 2);
    ctx.fill();
  }

  // 10. Draw Weather Stations (Layer below HUD Box)
  if (exportConfig.showStations) {
    WEATHER_STATIONS_DATA.forEach(station => {
      let windSpeed = 0;
      const reading = currentState.stationReadings?.find(r => r.name === station.name);
      
      if (reading) {
        windSpeed = reading.windSpeed;
      } else {
        const R = 6371;
        const dLat = (station.lat - currentState.lat) * (Math.PI / 180);
        const dLon = (station.lon - currentState.lon) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(currentState.lat * (Math.PI / 180)) * Math.cos(station.lat * (Math.PI / 180)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const dist = R * c;
        
        if (dist > 0) {
          if (currentState.vmax > 48.0 && dist < currentState.rmw) {
            windSpeed = currentState.vmax * (0.15 + 0.85 * (dist / currentState.rmw));
          } else {
            windSpeed = Math.max(0, Math.min(currentState.vmax, (currentState.vmax * currentState.rmw) / dist));
          }
        } else {
          windSpeed = currentState.vmax > 48.0 ? currentState.vmax * 0.15 : currentState.vmax;
        }
      }

      const pt = toScreen(station.lat, station.lon);
      if (pt.x < 0 || pt.x > width || pt.y < 0 || pt.y > height) return;

      const sizeScale = (exportConfig.stationSizeScale || 0.8) * uiScale;
      const w = 42 * sizeScale;
      const h = 18 * sizeScale;
      const borderRadius = 9 * sizeScale;

      ctx.fillStyle = getStationGradientColor(windSpeed);
      ctx.beginPath();
      ctx.roundRect(pt.x - w / 2, pt.y - h / 2, w, h, borderRadius);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = `bold ${10 * sizeScale}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(windSpeed.toFixed(1), pt.x, pt.y);
    });
  }

  // 11. Draw Data Annotation Badge (Highest Layer above Weather Stations)
  if (exportConfig.showDataLabel) {
    if (mechanismStyle === "JMA") {
      const dt = new Date(getSimulationStartDate(exportConfig).getTime() + replayWholeHour(currentSimHour) * 3600000);
      dt.setUTCMinutes(0, 0, 0);
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      const h = String(dt.getUTCHours()).padStart(2, "0");
      const jmaBestTrackInfoState = exportConfig.replayStyle === "jma_best_track" ? replayInfoState : currentState;
      const pressureText = String(Math.max(0, Math.round(jmaBestTrackInfoState.pmin))).padStart(4, "0");
      const lines = [
        `Typhoon ${frameDisplayName}  (${pressureText} hPa)`,
        `${y}-${m}-${d}  ${h}:00 UTC`
      ];
      if (exportConfig.showStatus) lines.push(getTyphoonStatusText(jmaBestTrackInfoState));

      ctx.save();
      ctx.textBaseline = "top";
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,.68)";
      ctx.shadowBlur = 2.2 * uiScale;
      ctx.shadowOffsetX = 1.1 * uiScale;
      ctx.shadowOffsetY = 1.1 * uiScale;

      const labelScale = exportConfig.labelSize === "small" ? 0.88 : exportConfig.labelSize === "large" ? 1.10 : exportConfig.labelSize === "extraLarge" ? 1.22 : 1;
      const f1 = Math.round(35 * uiScale * labelScale);
      const f2 = Math.round(33 * uiScale * labelScale);
      const rowGap = 42 * uiScale * labelScale;
      const marginX = 28 * uiScale;
      const marginY = 24 * uiScale;
      const position = exportConfig.labelPosition || "bottom-right";
      const isRight = position === "top-right" || position === "bottom-right";
      const isBottom = position === "bottom-left" || position === "bottom-right";
      ctx.textAlign = isRight ? "right" : "left";
      const x = isRight ? width - marginX : marginX;
      const blockHeight = Math.max(f1, f2) + Math.max(0, lines.length - 1) * rowGap;
      const topY = isBottom ? Math.max(marginY, height - marginY - blockHeight) : marginY;

      ctx.font = `${f1}px "Courier New", "Liberation Mono", monospace`;
      ctx.fillText(lines[0], x, topY);
      ctx.font = `${f2}px "Courier New", "Liberation Mono", monospace`;
      for (let li = 1; li < lines.length; li++) {
        ctx.fillText(lines[li], x, topY + li * rowGap);
      }
      ctx.restore();
    } else {
    let sizeMultiplier = 1.0;
    if (exportConfig.labelSize === "small") sizeMultiplier = 0.85;
    else if (exportConfig.labelSize === "large") sizeMultiplier = 1.2;
    else if (exportConfig.labelSize === "extraLarge") sizeMultiplier = 1.4;

    // Slightly enlarged typography for optimal legibility
    let portraitBoost = 1.0;
    if (exportConfig.aspectRatio === "9:16" || exportConfig.aspectRatio === "3:4") {
      portraitBoost = 1.5;
    }

    const titleFontSize = Math.round(16 * sizeMultiplier * uiScale * portraitBoost);
    const categoryFontSize = Math.round(14 * sizeMultiplier * uiScale * portraitBoost);
    const bodyFontSize = Math.round(13 * sizeMultiplier * uiScale * portraitBoost);

    const paddingX = Math.round(14 * sizeMultiplier * uiScale * portraitBoost);
    const paddingY = Math.round(10 * sizeMultiplier * uiScale * portraitBoost);

    // Date/Time calculation
    let timeLabel = "";
    let calendarLine: string | null = null;
    if (exportConfig.showDateTime) {
      if (exportConfig.dateTimeFormat === "relative") {
        timeLabel = ` (${Math.round(currentSimHour)}h)`;
      } else {
        // Calculate calendar date starting from current simulation start date
        const date = getSimulationStartDate(exportConfig);
        date.setHours(date.getHours() + Math.round(currentSimHour));
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, "0");
        const d = date.getDate().toString().padStart(2, "0");
        const h = date.getHours().toString().padStart(2, "0");
        calendarLine = `${y}/${m}/${d} ${h}:00`;
      }
    }

    const titleText = `${frameDisplayName}${timeLabel}`;
    const intensityAssessment = getAgencyIntensity(currentState.vmax, exportConfig.intensityAgency || "CMA", exportConfig.intensityReportingMode || "public");
    const categoryText = intensityAssessment.category;

    // Build body lines dynamically
    let bodyLines: { text: string; color: string }[] = [];

    // Check date position option
    const dateInside = !exportConfig.dateTimePosition || exportConfig.dateTimePosition === "inside";

    if (calendarLine && dateInside) {
      bodyLines.push({
        text: calendarLine,
        color: "#cbd5e1" // slate-300
      });
    }
    bodyLines.push({
      text: `位置: ${currentState.lat.toFixed(2)}°N, ${currentState.lon.toFixed(2)}°E`,
      color: "rgba(226, 232, 240, 0.95)"
    });

    if (exportConfig.labelContent === "all" || exportConfig.labelContent === "pressure") {
      bodyLines.push({
        text: `中心气压: ${currentState.pmin.toFixed(0)} hPa`,
        color: "#1E9CFF"
      });
    }

    if (exportConfig.labelContent === "all" || exportConfig.labelContent === "windSpeed") {
      bodyLines.push({
        text: `最大风速: ${intensityAssessment.value} ${intensityAssessment.unit} (${intensityAssessment.category})`,
        color: "#f43f5e"
      });
    }

    if (exportConfig.showCasualties && currentState.casualties && currentState.casualties > 0) {
      const casualtyText = currentState.casualties > 10000 
        ? `${((currentState.casualties as number) / 10000).toFixed(1)} 万人` 
        : `${Math.round(currentState.casualties as number)} 人`;
      bodyLines.push({
        text: `预估伤亡: ${casualtyText}`,
        color: "#fca5a5"
      });
    }

    if (exportConfig.showStatus) {
      const statusText = getTyphoonStatusText(currentState);
      bodyLines.push({
        text: `状态: ${statusText}`,
        color: "#c084fc"
      });
    }

    const infoStyle = exportConfig.infoBoxStyle || "agency";
    const titleFamily = infoStyle === "agency"
      ? '"Arial", "Helvetica Neue", "Noto Sans CJK SC", sans-serif'
      : infoStyle === "monochrome"
      ? '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'
      : '"Inter", "Arial", "Noto Sans CJK SC", sans-serif';
    const bodyFamily = infoStyle === "agency"
      ? '"Arial", "Helvetica Neue", "Noto Sans CJK SC", sans-serif'
      : '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';

    // Measure widths dynamically so the box fits like a broadcast/agency data plate rather
    // than a decorative game HUD.
    ctx.font = `${infoStyle === "minimal" ? 600 : 700} ${titleFontSize}px ${titleFamily}`;
    const titleWidth = ctx.measureText(titleText).width;

    ctx.font = `600 ${categoryFontSize}px ${titleFamily}`;
    const catWidth = ctx.measureText(categoryText).width;

    const headerGap = Math.round(18 * sizeMultiplier * uiScale);
    const headerRowWidth = titleWidth + headerGap + catWidth;

    ctx.font = `${bodyFontSize}px ${bodyFamily}`;
    let maxBodyWidth = 0;
    bodyLines.forEach((line) => {
      const w = ctx.measureText(line.text).width;
      if (w > maxBodyWidth) maxBodyWidth = w;
    });

    const maxContentWidth = Math.max(headerRowWidth, maxBodyWidth);
    const badgeWidth = Math.ceil(maxContentWidth + paddingX * 2);
    const lineSpacing = Math.round(bodyFontSize * (infoStyle === "agency" ? 1.45 : 1.38));
    const dividerMargin = Math.round((infoStyle === "minimal" ? 4 : 7) * sizeMultiplier * uiScale);
    const badgeHeight = Math.ceil(
      paddingY * 2 + titleFontSize + dividerMargin * 2 +
      (bodyLines.length > 0 ? bodyLines.length * lineSpacing : 0)
    );

    const margin = Math.round(24 * uiScale);
    let badgeX = margin;
    let badgeY = margin;
    if (exportConfig.labelPosition === "top-right") {
      badgeX = width - badgeWidth - margin;
      badgeY = margin;
    } else if (exportConfig.labelPosition === "bottom-left") {
      badgeX = margin;
      badgeY = height - badgeHeight - margin;
    } else if (exportConfig.labelPosition === "bottom-right") {
      badgeX = width - badgeWidth - margin;
      badgeY = height - badgeHeight - margin;
    }

    const palettes = {
      agency: {
        bg: "rgba(248, 250, 252, 0.94)", border: "rgba(51, 65, 85, 0.82)",
        title: "#0f172a", category: "#334155", body: "#1f2937", divider: "#94a3b8"
      },
      broadcast: {
        bg: "rgba(10, 16, 24, 0.90)", border: "rgba(148, 163, 184, 0.65)",
        title: "#f8fafc", category: catColor, body: "#e2e8f0", divider: "rgba(148, 163, 184, 0.45)"
      },
      monochrome: {
        bg: "rgba(8, 10, 12, 0.90)", border: "rgba(229, 231, 235, 0.72)",
        title: "#f9fafb", category: "#d1d5db", body: "#e5e7eb", divider: "rgba(229, 231, 235, 0.38)"
      },
      minimal: {
        bg: "rgba(0,0,0,0)", border: "rgba(0,0,0,0)",
        title: "#ffffff", category: "#e5e7eb", body: "#ffffff", divider: "rgba(255,255,255,0.42)"
      }
    } as const;
    const palette = palettes[infoStyle];

    ctx.save();
    if (infoStyle !== "minimal") {
      ctx.fillStyle = palette.bg;
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = Math.max(1, infoStyle === "agency" ? 1.2 * uiScale : 1.0 * uiScale);
      const cornerRadius = Math.round((infoStyle === "agency" ? 3 : 6) * uiScale);
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, cornerRadius);
      ctx.fill();
      ctx.stroke();
      if (infoStyle === "agency") {
        ctx.fillStyle = "#334155";
        ctx.fillRect(badgeX, badgeY, Math.max(3, 4 * uiScale), badgeHeight);
      }
    } else {
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 6 * uiScale;
      ctx.shadowOffsetX = 1 * uiScale;
      ctx.shadowOffsetY = 1 * uiScale;
    }

    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const titleY = badgeY + paddingY;
    ctx.fillStyle = palette.title;
    ctx.font = `${infoStyle === "minimal" ? 600 : 700} ${titleFontSize}px ${titleFamily}`;
    ctx.fillText(titleText, badgeX + paddingX, titleY);

    ctx.fillStyle = palette.category;
    ctx.font = `600 ${categoryFontSize}px ${titleFamily}`;
    ctx.fillText(categoryText, badgeX + badgeWidth - paddingX - catWidth, titleY + Math.max(0, (titleFontSize - categoryFontSize) * 0.35));

    const dividerY = titleY + titleFontSize + dividerMargin;
    ctx.strokeStyle = palette.divider;
    ctx.lineWidth = Math.max(1, 0.8 * uiScale);
    ctx.beginPath();
    ctx.moveTo(badgeX + paddingX, dividerY);
    ctx.lineTo(badgeX + badgeWidth - paddingX, dividerY);
    ctx.stroke();

    let currentY = dividerY + dividerMargin;
    ctx.font = `${bodyFontSize}px ${bodyFamily}`;
    bodyLines.forEach((line) => {
      // Agency/monochrome/minimal styles deliberately remove semantic rainbow coloring.
      ctx.fillStyle = infoStyle === "broadcast" ? line.color : palette.body;
      ctx.fillText(line.text, badgeX + paddingX, currentY);
      currentY += lineSpacing;
    });
    ctx.restore();
    }
  }

  // Draw Date/Time at specified corner if configured. JMA Best Track footer already contains UTC time.
  if (mechanismStyle !== "JMA" && exportConfig.showDateTime && exportConfig.dateTimePosition && exportConfig.dateTimePosition !== "inside") {
    drawCornerDateTime(ctx, width, height, currentSimHour, exportConfig, uiScale);
  }

  ctx.restore();
}

function drawCornerDateTime(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentSimHour: number,
  exportConfig: VideoExportConfig,
  uiScale: number
) {
  let dateStr = "";
  if (exportConfig.dateTimeFormat === "relative") {
    dateStr = `模拟时间: +${Math.round(currentSimHour)} 小时`;
  } else {
    const date = getSimulationStartDate(exportConfig);
    date.setHours(date.getHours() + Math.round(currentSimHour));
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    dateStr = `${y}/${m}/${d} ${h}:00 UTC`;
  }

  const fontSize = Math.round(22 * uiScale);
  ctx.font = `600 ${fontSize}px "Inter", "Plus Jakarta Sans", system-ui, -apple-system, sans-serif`;
  const textWidth = ctx.measureText(dateStr).width;
  const paddingX = 14 * uiScale;
  const paddingY = 8 * uiScale;
  const boxW = textWidth + paddingX * 2;
  const boxH = fontSize + paddingY * 2;
  const margin = 20 * uiScale;

  let x = margin;
  let y = margin;
  const pos = exportConfig.dateTimePosition || "top-left";

  if (pos === "top-right") {
    x = width - boxW - margin;
    y = margin;
  } else if (pos === "bottom-left") {
    x = margin;
    y = height - boxH - margin;
  } else if (pos === "bottom-right") {
    x = width - boxW - margin;
    y = height - boxH - margin;
  }

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 8 * uiScale;
  ctx.shadowOffsetX = 1 * uiScale;
  ctx.shadowOffsetY = 1.5 * uiScale;

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(dateStr, x + paddingX, y + paddingY);
  ctx.restore();
}

/**
 * Draws a final summary report overlay with wind and pressure curves
 */
function drawEndReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  uiScale: number,
  exportConfig: VideoExportConfig
) {
  const history = typhoon.history || [];
  const chartHistory = threeHourlyReportNodes(history,point=>Number(point.simHour));
  if (!history.length) return;
  const maxVmax = Math.max(...history.map((h) => h.vmax));
  const intensityAgency = exportConfig.intensityAgency || "CMA";
  const windAssessments = history.map((h) => getAgencyIntensity(h.vmax, intensityAgency, exportConfig.intensityReportingMode || "public"));
  const windUnit = windAssessments[0]?.unit || "m/s";
  const maxWindRaw = Math.max(...windAssessments.map((w) => w.value));
  const maxWindDisplay = getAgencyIntensity(maxVmax, intensityAgency, exportConfig.intensityReportingMode || "public");
  const minPmin = Math.min(...history.map((h) => h.pmin));
  const startHour = history[0].simHour;
  const endHour = history[history.length - 1].simHour;
  const duration = Math.max(1, endHour - startHour);
  const summaryDisplayName = getTyphoonDisplayName(typhoon, endHour, getSimulationStartDate(exportConfig));

  const margin = 42 * uiScale;
  const panelX = margin;
  const panelY = margin;
  const panelW = width - margin * 2;
  const panelH = height - margin * 2;

  ctx.save();
  ctx.fillStyle = "rgba(248, 250, 252, 0.965)";
  ctx.strokeStyle = "rgba(51, 65, 85, 0.9)";
  ctx.lineWidth = Math.max(1, 1.2 * uiScale);
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelW, panelH, 4 * uiScale);
  ctx.fill();
  ctx.stroke();

  const left = panelX + 42 * uiScale;
  const top = panelY + 34 * uiScale;
  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${30 * uiScale}px "Arial", "Noto Sans CJK SC", sans-serif`;
  ctx.fillText(`${summaryDisplayName}  模拟复盘摘要`, left, top);
  ctx.fillStyle = "#64748b";
  ctx.font = `500 ${13 * uiScale}px "Arial", sans-serif`;
  ctx.fillText("TROPICAL CYCLONE SIMULATION — FINAL SUMMARY", left, top + 40 * uiScale);

  const statsY = top + 78 * uiScale;
  const stats = [
    ["MAX WIND", `${maxWindDisplay.value} ${maxWindDisplay.unit}`],
    ["MIN PRESSURE", `${minPmin.toFixed(0)} hPa`],
    ["DURATION", `${duration.toFixed(0)} h`],
    ["LANDFALLS", `${typhoon.landfallRecords?.length || 0}`]
  ];
  const statW = (panelW - 84 * uiScale) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = left + i * statW;
    if (i > 0) {
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = Math.max(1, 0.8 * uiScale);
      ctx.beginPath();
      ctx.moveTo(x - 18 * uiScale, statsY);
      ctx.lineTo(x - 18 * uiScale, statsY + 52 * uiScale);
      ctx.stroke();
    }
    ctx.fillStyle = "#64748b";
    ctx.font = `600 ${11 * uiScale}px "Arial", sans-serif`;
    ctx.fillText(label, x, statsY);
    ctx.fillStyle = "#111827";
    ctx.font = `700 ${22 * uiScale}px "Arial", sans-serif`;
    ctx.fillText(value, x, statsY + 20 * uiScale);
  });

  const chartX = left + 48 * uiScale;
  const chartY = statsY + 92 * uiScale;
  const chartW = panelW - 180 * uiScale;
  const chartH = panelH - (chartY - panelY) - 62 * uiScale;
  const vmaxMin = 0;
  const windAxisStep = windUnit === "kt" ? 20 : 10;
  const windAxisFloor = windUnit === "kt" ? 140 : 70;
  const vmaxMax = Math.max(windAxisFloor, Math.ceil(maxWindRaw / windAxisStep) * windAxisStep + windAxisStep);
  const pminMin = Math.floor((minPmin - 8) / 10) * 10;
  const pminMax = 1020;

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = Math.max(1, 1 * uiScale);
  ctx.strokeRect(chartX, chartY, chartW, chartH);
  ctx.font = `${11 * uiScale}px "Arial", sans-serif`;
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 5; i++) {
    const y = chartY + (i / 5) * chartH;
    ctx.strokeStyle = "#dbe2e8";
    ctx.beginPath(); ctx.moveTo(chartX, y); ctx.lineTo(chartX + chartW, y); ctx.stroke();
    ctx.fillStyle = "#475569";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(vmaxMax - (i / 5) * (vmaxMax - vmaxMin))}`, chartX - 10 * uiScale, y);
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(pminMax - (i / 5) * (pminMax - pminMin))}`, chartX + chartW + 10 * uiScale, y);
  }

  const xFor = (h: number) => chartX + ((h - startHour) / duration) * chartW;
  const yWind = (v: number) => chartY + chartH - ((v - vmaxMin) / (vmaxMax - vmaxMin)) * chartH;
  const yPressure = (v: number) => chartY + chartH - ((v - pminMin) / (pminMax - pminMin)) * chartH;

  const drawSeries = (selector: (h: TyphoonState) => number, yFn: (v: number) => number, dashed: boolean) => {
    ctx.save();
    ctx.strokeStyle = dashed ? "#64748b" : "#111827";
    ctx.lineWidth = Math.max(1.5, (dashed ? 1.6 : 2.3) * uiScale);
    ctx.setLineDash(dashed ? [7 * uiScale, 5 * uiScale] : []);
    ctx.beginPath();
    chartHistory.forEach((h, i) => {
      const x = xFor(h.simHour);
      const y = yFn(selector(h));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  };
  drawSeries((h) => getAgencyIntensity(h.vmax, intensityAgency, exportConfig.intensityReportingMode || "public").value, yWind, false);
  drawSeries((h) => h.pmin, yPressure, true);

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748b";
  ctx.font = `${10 * uiScale}px "Arial", sans-serif`;
  const tickHours = Math.max(6, Math.ceil(duration / 8 / 6) * 6);
  for (let h = startHour; h <= endHour + 0.1; h += tickHours) {
    const x = xFor(h);
    ctx.fillText(`+${Math.round(h - startHour)}h`, x, chartY + chartH + 10 * uiScale);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#111827";
  ctx.font = `600 ${11 * uiScale}px "Arial", sans-serif`;
  ctx.fillText(`实线  最大风速 (${windUnit})`, chartX, chartY - 24 * uiScale);
  ctx.fillStyle = "#64748b";
  ctx.fillText("虚线  中心气压 (hPa)", chartX + 150 * uiScale, chartY - 24 * uiScale);
  ctx.restore();
}

// Master Video Encoding Generator Function
export async function generateTyphoonVideo(
  typhoon: Typhoon,
  exportConfig: VideoExportConfig,
  onProgress: (prog: RenderProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const { width, height } = getCanvasDimensions(exportConfig.aspectRatio, exportConfig.videoResolution);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D canvas context");

  const history = typhoon.history;
  if (!history || history.length === 0) {
    throw new Error("Typhoon has no history path to render");
  }

  const startHour = history[0].simHour;
  const endHour = history[history.length - 1].simHour;
  const totalHours = endHour - startHour;

  // Video Parameters: Configurable Duration (2-30s) and FPS (1-60fps)
  const fps = exportConfig.fps || 30;
  const durationSec = exportConfig.durationSec || 10;
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  onProgress({
    percentage: 0,
    currentFrame: 0,
    totalFrames,
    statusText: "正在预加载地图瓦片数据..."
  });

  // Preload all map assets through one unified tile path. This keeps video
  // rendering latency consistent between map sources.
  const zoom = getMercatorZoom(exportConfig.zoomLevel, width);

  let sumLat = 0;
  let sumLon = 0;
  history.forEach((h) => { sumLat += h.lat; sumLon += h.lon; });
  const avgLat = sumLat / history.length;
  const avgLon = sumLon / history.length;
  // Hard render guard: stale presets/localStorage may still carry projection flags. Arbitrary
  // network/raster basemaps stay Mercator, while Blue Marble 2002/2004 are explicitly allowed
  // because both versions have dedicated LAEA and North Polar Stereographic renderers.
  const projectionAllowed = canUseVideoReprojection(exportConfig.baseMap);
  const effectivePolarProjection = projectionAllowed && !!exportConfig.jmaNorthPolarStereographicProjection;
  const effectiveAzimuthalProjection = projectionAllowed && !!exportConfig.jmaAzimuthalEqualAreaProjection && !effectivePolarProjection;

  if (exportConfig.baseMap === "blueMarble" && (exportConfig.blueMarbleVersion || "2002") === "2002") {
      const imageTimeout = new Promise<null>((r) => setTimeout(() => r(null), 15000));
      await Promise.race([loadBlueMarble2002(true), imageTimeout]);
  } else if (exportConfig.baseMap === "blueMarble" && exportConfig.blueMarbleVersion === "2004") {
      // Blue Marble 2004 must be fully resident before frame 1.  Previously preloading was only a
      // 4.5 s best-effort warm-up, so the first video frames could start with missing GIBS tiles
      // and the map visibly filled in as the replay advanced.  Preload representative viewports
      // across the whole camera corridor with retry-capable tile requests and wait for completion.
      const sampleCount = Math.max(2, Math.min(24, Math.ceil(Math.max(1, totalHours) / 12)));
      const warmJobs: Promise<boolean>[] = [];
      for (let i = 0; i <= sampleCount; i++) {
        const frac = i / sampleCount;
        const simHour = startHour + frac * totalHours;
        const stateAtSample = interpolateTyphoonSmooth(history, simHour);
        const projectedFollow = effectiveAzimuthalProjection || effectivePolarProjection;
        const cLat = projectedFollow ? stateAtSample.lat : (exportConfig.centerFollow ? stateAtSample.lat : avgLat);
        const cLon = projectedFollow ? stateAtSample.lon : (exportConfig.centerFollow ? stateAtSample.lon : avgLon);
        if (effectivePolarProjection) {
          warmJobs.push(preloadBlueMarble2004NorthPolarStereographicViewport(width, height, cLat, cLon, zoom, 18000, true));
        } else if (effectiveAzimuthalProjection) {
          warmJobs.push(preloadBlueMarble2004LambertAzimuthalEqualAreaViewport(width, height, cLat, cLon, zoom, 18000, true));
        } else {
          warmJobs.push(preloadBlueMarble2004MercatorViewport(width, height, cLat, cLon, zoom, 0, 18000, true));
        }
      }
      const warmed = await Promise.all(warmJobs);
      if (warmed.some((complete) => !complete)) {
        throw new Error("Blue Marble 2004 地图未能完整加载，请检查网络后重试视频生成");
      }
  } else if (exportConfig.baseMap !== "none" && !getVideoVectorBasemap(exportConfig.baseMap)) {
      const tileZoom = Math.floor(zoom);
      const tileUrlsToLoad = new Set<string>();

      // Sample camera positions instead of iterating every output frame. The
      // same tile ranges repeat heavily between adjacent animation frames.
      const sampleCount = Math.min(totalFrames, Math.max(12, Math.ceil(totalHours * 2)));
      for (let f = 0; f <= sampleCount; f += 1) {
        const frac = sampleCount === 0 ? 0 : f / sampleCount;
        const simHour = startHour + frac * totalHours;

        let cLat = avgLat;
        let cLon = avgLon;
        if (exportConfig.centerFollow || effectiveAzimuthalProjection || effectivePolarProjection) {
          const stateAtF = interpolateTyphoonSmooth(history, simHour);
          cLat = stateAtF.lat;
          cLon = stateAtF.lon;
        }

        if (effectiveAzimuthalProjection) {
          const laeaTileZoom = Math.max(1, Math.min(8, Math.floor(zoom) + 1));
          const b = getLambertAzimuthalEqualAreaMercatorViewportBounds(cLat, cLon, zoom, width, height, laeaTileZoom, 112, 20);
          const minX = Math.floor(b.minX / 256) - 1;
          const maxX = Math.ceil(b.maxX / 256) + 1;
          const minY = Math.max(0, Math.floor(b.minY / 256) - 1);
          const maxY = Math.min(Math.pow(2, laeaTileZoom) - 1, Math.ceil(b.maxY / 256) + 1);
          for (let tx = minX; tx <= maxX; tx++) {
            for (let ty = minY; ty <= maxY; ty++) {
              const url = globalTileCache.getTileUrl(exportConfig.baseMap, laeaTileZoom, tx, ty);
              if (url) tileUrlsToLoad.add(url);
            }
          }
        } else {
          const scaleFactor = Math.pow(2, zoom - tileZoom);
          const worldSize = 256 * Math.pow(2, tileZoom);
          const cx = ((cLon + 180) / 360) * worldSize;
          const centerLatRad = (cLat * Math.PI) / 180;
          const cy = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) * (worldSize / 2);
          const minX = Math.floor((cx - (width / (2 * scaleFactor))) / 256) - 2;
          const maxX = Math.ceil((cx + (width / (2 * scaleFactor))) / 256) + 2;
          const minY = Math.floor((cy - (height / (2 * scaleFactor))) / 256) - 2;
          const maxY = Math.ceil((cy + (height / (2 * scaleFactor))) / 256) + 2;
          for (let tx = minX; tx <= maxX; tx++) {
            for (let ty = minY; ty <= maxY; ty++) {
              const url = globalTileCache.getTileUrl(exportConfig.baseMap, tileZoom, tx, ty);
              if (url) tileUrlsToLoad.add(url);
            }
          }
        }
      }
      const tilePromises = Array.from(tileUrlsToLoad, (url) => globalTileCache.loadTile(url));
      const tileTimeout = new Promise((r) => setTimeout(r, 15000));
      await Promise.race([Promise.all(tilePromises), tileTimeout]);
  }

  if (signal?.aborted) throw new Error("Video rendering cancelled by user");

  
  let bitRate = exportConfig.bitrate || 28000000; // Use user provided bitrate or defaults
  if (!exportConfig.bitrate) {
    if (exportConfig.videoResolution === "360p") bitRate = 3000000; // 3 Mbps
    else if (exportConfig.videoResolution === "480p") bitRate = 6500000; // 6.5 Mbps
    else if (exportConfig.videoResolution === "720p") bitRate = 15000000; // 15 Mbps
    else if (exportConfig.videoResolution === "1080p") bitRate = 28000000; // 28 Mbps
    else if (exportConfig.videoResolution === "2K") bitRate = 45000000; // 45 Mbps for 2K
    else if (exportConfig.videoResolution === "4K") bitRate = 80000000; // 80 Mbps for 4K
  }

  const isH265 = exportConfig.videoCodec === "H.265"; // Only H.265 if explicitly selected

  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    let muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: {
        codec: isH265 ? 'hevc' : 'avc',
        width: width,
        height: height
      },
      fastStart: 'in-memory'
    });

    let encoderError: any = null;
    let videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error("VideoEncoder error:", e);
        encoderError = e;
      }
    });

    const candidateCodecs = isH265 ? [
      'hev1.1.6.L153.B0', // HEVC Main Profile, Main Tier, Level 5.1
      'hev1.1.6.L150.B0', // HEVC Main Profile, Main Tier, Level 5.0
      'hev1.1.6.L120.B0', // HEVC Main Profile, Main Tier, Level 4.0
      'hev1.1.6.L93.B0',  // HEVC Main Profile, Main Tier, Level 3.1
      'hvc1.1.6.L153.B0', // Alternative identifier
      'hvc1.1.6.L150.B0',
      'hev1.1.6.L153',
      'hev1.1.6.L150',
      'hev1.2.4.L153.B0'  // HEVC Main 10 Profile
    ] : [
      'avc1.640034', // High Profile Level 5.2 (Required for 4K/60 H.264)
      'avc1.640033', // High Profile Level 5.1
      'avc1.4d0033', // Main Profile Level 5.1
      'avc1.42E033', // Baseline Level 5.1
      'avc1.640032', // High Profile Level 5.0
      'avc1.64002a', // High Profile Level 4.2
      'avc1.42E01E'  // Baseline Level 3.0
    ];

    let codecString = candidateCodecs[0];
    for (const cand of candidateCodecs) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: cand,
          width: width,
          height: height,
          bitrate: bitRate,
          framerate: fps
        });
        if (support && support.supported) {
          codecString = cand;
          break;
        }
      } catch (e) {
        // continue trying next codec
      }
    }

    videoEncoder.configure({
      codec: codecString,
      width: width,
      height: height,
      bitrate: bitRate,
      framerate: fps,
      latencyMode: "quality", // Prioritize extreme visual sharpness/quality over real-time streaming speed
    });

    const freezeFrames = (exportConfig.endAction && exportConfig.endAction !== "none") ? (2 * fps) : 0;
    const totalFramesWithFreeze = totalFrames + freezeFrames;
    const uiScale = width / 1920;

    // --- Unified Pipeline: Render and Encode on-the-fly ---
    try {
      for (let frame = 0; frame <= totalFramesWithFreeze; frame++) {
        if (signal?.aborted) {
          if (videoEncoder.state !== 'closed') videoEncoder.close();
          throw new Error("Video rendering cancelled by user");
        }
        if (encoderError) {
          throw new Error(`VideoEncoder failed: ${encoderError.message || encoderError}`);
        }

        const currentSimFrame = Math.min(frame, totalHours === 0 ? 0 : totalFrames);
        const frac = totalFrames === 0 ? 0 : currentSimFrame / totalFrames;
        const simHour = startHour + frac * totalHours;

        ctx.clearRect(0, 0, width, height);

        try {
          await renderVideoFrameOnCanvas(ctx, width, height, typhoon, simHour, exportConfig);
          
          if (frame > totalFrames && exportConfig.endAction === "report") {
            drawEndReport(ctx, width, height, typhoon, uiScale, exportConfig);
          }
        } catch (e) {
          console.warn(`Frame ${frame} render warning:`, e);
        }

        // Encode directly from canvas without creating an intermediate ImageBitmap list
        if (videoEncoder.state === 'configured') {
          const timestampMicroseconds = Math.round((frame / fps) * 1_000_000);
          // Pass the canvas directly to VideoFrame constructor - highly optimized by browsers
          const videoFrame = new VideoFrame(canvas, { timestamp: timestampMicroseconds });
          try {
            // Force ALL frames to be KeyFrames (I-frames/Intra) to fully eliminate inter-frame coding drift
            videoEncoder.encode(videoFrame, { keyFrame: true });
          } catch (e: any) {
            console.error("Encode failed at frame", frame, ":", e);
            videoFrame.close();
            encoderError = e;
            throw e;
          }
          videoFrame.close();
        } else {
          console.warn(`VideoEncoder state is ${videoEncoder.state} at frame ${frame}, skipping encode`);
          if (videoEncoder.state === 'closed') {
            encoderError = new Error("Codec closed unexpectedly");
            break;
          }
        }

        const completedFrame = Math.min(totalFramesWithFreeze + 1, frame + 1);
        const percentage = Math.min(98, 3 + Math.round((completedFrame / Math.max(1, totalFramesWithFreeze + 1)) * 95));
        onProgress({
          percentage,
          currentFrame: completedFrame,
          totalFrames: totalFramesWithFreeze + 1,
          statusText: "正在渲染并编码视频帧..."
        });

        // Control queue size to prevent browser/encoder choking
        let queueWaitStartTime = Date.now();
        while (videoEncoder.encodeQueueSize > 12) {
          await new Promise(r => setTimeout(r, 8));
          if (encoderError) break;
          if (Date.now() - queueWaitStartTime > 5000) {
            console.warn("VideoEncoder queue stuck for 5s, proceeding anyway");
            break;
          }
        }
        
        // Yield to prevent tab freeze (increase frequency for smooth UI)
        if (frame % 15 === 0) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      if (videoEncoder.state !== 'closed' && !encoderError) {
        await videoEncoder.flush();
        muxer.finalize();
        onProgress({
          percentage: 100,
          currentFrame: totalFramesWithFreeze + 1,
          totalFrames: totalFramesWithFreeze + 1,
          statusText: "视频编码完成，正在整理文件..."
        });
        const buffer = muxer.target.buffer;
        return new Blob([buffer], { type: "video/mp4" });
      } else if (encoderError) {
        throw new Error(`VideoEncoder finalization failed: ${encoderError.message || encoderError}`);
      } else {
        throw new Error("VideoEncoder closed unexpectedly");
      }
    } finally {
      // No per-source export atlas is retained; tile cache is shared across frames.
    }
  }

  // Fallback to MediaRecorder for browsers without WebCodecs
  // Check supported mime types for MediaRecorder prioritizing MP4 format
  const candidateMimeTypes = isH265 ? [
    "video/mp4;codecs=hvc1",
    "video/mp4;codecs=hev1",
    "video/mp4;codecs=hevc",
    "video/mp4;codecs=h265",
    "video/webm;codecs=hevc",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1",
    "video/mp4;codecs=h264",
    "video/mp4"
  ] : [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1",
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];

  let chosenMimeType = candidateMimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || "";



  // Use 30 fps capture stream to ensure MediaRecorder records exact 30 FPS frame timestamps
  const stream = canvas.captureStream(fps);
  let recorder: MediaRecorder;

  try {
    recorder = new MediaRecorder(stream, {
      mimeType: chosenMimeType || undefined,
      videoBitsPerSecond: bitRate
    });
  } catch {
    try {
      recorder = new MediaRecorder(stream, { videoBitsPerSecond: bitRate });
    } catch {
      recorder = new MediaRecorder(stream);
    }
  }

  const actualMimeType = recorder.mimeType || chosenMimeType || "video/mp4";
  const isMp4 = actualMimeType.includes("mp4") || actualMimeType.includes("avc1") || actualMimeType.includes("h264");
  const blobType = isMp4 ? "video/mp4" : "video/webm";

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // Helper to fix MP4 container duration header so mobile photo albums and media players display exact duration
  const fixMp4Duration = async (blob: Blob, durationSec: number): Promise<Blob> => {
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);

      for (let i = 0; i < bytes.length - 32; i++) {
        // Search for 'mvhd' box (Movie Header Box)
        if (bytes[i] === 0x6d && bytes[i+1] === 0x76 && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
          const version = bytes[i + 4];
          if (version === 0) {
            const timescale = view.getUint32(i + 16, false);
            if (timescale > 0) {
              view.setUint32(i + 20, Math.round(durationSec * timescale), false);
            }
          } else if (version === 1) {
            const timescale = view.getUint32(i + 24, false);
            if (timescale > 0) {
              const targetDur = BigInt(Math.round(durationSec * timescale));
              view.setBigUint64(i + 28, targetDur, false);
            }
          }
        }
        // Search for 'mdhd' box (Media Header Box)
        if (bytes[i] === 0x6d && bytes[i+1] === 0x64 && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
          const version = bytes[i + 4];
          if (version === 0) {
            const timescale = view.getUint32(i + 16, false);
            if (timescale > 0) {
              view.setUint32(i + 20, Math.round(durationSec * timescale), false);
            }
          } else if (version === 1) {
            const timescale = view.getUint32(i + 24, false);
            if (timescale > 0) {
              const targetDur = BigInt(Math.round(durationSec * timescale));
              view.setBigUint64(i + 28, targetDur, false);
            }
          }
        }
        // Search for 'tkhd' box (Track Header Box)
        if (bytes[i] === 0x74 && bytes[i+1] === 0x6b && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
          const version = bytes[i + 4];
          if (version === 0) {
            view.setUint32(i + 24, Math.round(durationSec * 1000), false);
          } else if (version === 1) {
            view.setBigUint64(i + 32, BigInt(Math.round(durationSec * 1000)), false);
          }
        }
      }
      return new Blob([buffer], { type: blob.type });
    } catch (e) {
      console.warn("Could not patch MP4 duration header:", e);
      return blob;
    }
  };

  // Helper to fix WebM duration header so media players display exact duration
  const fixWebmDuration = async (blob: Blob, durationMs: number): Promise<Blob> => {
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      
      // Search for Segment Info ID: 0x15, 0x49, 0xA9, 0x66
      for (let i = 0; i < bytes.length - 16; i++) {
        if (bytes[i] === 0x15 && bytes[i+1] === 0x49 && bytes[i+2] === 0xa9 && bytes[i+3] === 0x66) {
          let foundDuration = false;
          for (let j = i + 4; j < i + 200 && j < bytes.length - 8; j++) {
            if (bytes[j] === 0x44 && bytes[j+1] === 0x89) {
              foundDuration = true;
              const length = bytes[j+2];
              if (length === 8) {
                const view = new DataView(buffer, j + 3, 8);
                view.setFloat64(0, durationMs, false);
                return new Blob([buffer], { type: blob.type });
              } else if (length === 4) {
                const view = new DataView(buffer, j + 3, 4);
                view.setFloat32(0, durationMs, false);
                return new Blob([buffer], { type: blob.type });
              }
            }
          }

          // If Duration tag was missing, inject 0x44 0x89 0x88 [Float64 durationMs] into Segment Info
          if (!foundDuration && i + 8 < bytes.length) {
            const insertPos = i + 8; // Right inside Segment Info
            const durTag = new Uint8Array(11);
            durTag[0] = 0x44; // Element ID Duration
            durTag[1] = 0x89;
            durTag[2] = 0x88; // Length 8 bytes
            const view = new DataView(durTag.buffer, 3, 8);
            view.setFloat64(0, durationMs, false);

            const newBuffer = new Uint8Array(bytes.length + 11);
            newBuffer.set(bytes.subarray(0, insertPos), 0);
            newBuffer.set(durTag, insertPos);
            newBuffer.set(bytes.subarray(insertPos), insertPos + 11);

            return new Blob([newBuffer.buffer], { type: blob.type });
          }
        }
      }
    } catch (e) {
      console.warn("Could not patch EBML duration header:", e);
    }
    return blob;
  };

  const recorderStopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const rawBlob = new Blob(chunks, { type: blobType });
      let fixedBlob = await fixWebmDuration(rawBlob, durationSec * 1000);
      fixedBlob = await fixMp4Duration(fixedBlob, durationSec);
      resolve(fixedBlob);
    };
    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      reject(e);
    };
  });

  // Start with 200ms timeslice to emit chunks progressively and prevent RAM spikes
  recorder.start(200);

  // Lockstep frame-by-frame rendering loop paced for 30 FPS (33.3ms per frame)
  const frameIntervalMs = 1000 / fps;
  for (let frame = 0; frame <= totalFrames; frame++) {
    const frameStartTime = performance.now();
    if (signal?.aborted) {
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Video rendering cancelled by user");
    }

    const frac = frame / totalFrames;
    const simHour = startHour + frac * totalHours;

    try {
      await renderVideoFrameOnCanvas(ctx, width, height, typhoon, simHour, exportConfig);
    } catch (e) {
      console.warn(`Frame $${frame} render warning:`, e);
    }

    // Force frame capture on canvas stream if supported
    const track = stream.getVideoTracks()[0] as any;
    if (track && typeof track.requestFrame === "function") {
      track.requestFrame();
    }

    const completedFrame = Math.min(totalFrames + 1, frame + 1);
    const percentage = Math.min(98, 3 + Math.round((completedFrame / Math.max(1, totalFrames + 1)) * 95));
    onProgress({
      percentage,
      currentFrame: completedFrame,
      totalFrames: totalFrames + 1,
      statusText: "正在逐帧渲染并封装视频..."
    });

    const renderElapsed = performance.now() - frameStartTime;
    const delay = Math.max(1, Math.round(frameIntervalMs - renderElapsed));
    await new Promise((r) => setTimeout(r, delay));
  }

  
  // Hold the final frame for extra buffer ticks so MediaRecorder captures the entire video tail completely

  const extraHoldTicks = Math.max(16, Math.floor(fps * 0.8));
  for (let hold = 0; hold < extraHoldTicks; hold++) {
    if (signal?.aborted) break;
    try {
      await renderVideoFrameOnCanvas(ctx, width, height, typhoon, endHour, exportConfig);
    } catch {}
    const track = stream.getVideoTracks()[0] as any;
    if (track && typeof track.requestFrame === "function") {
      track.requestFrame();
    }
    await new Promise((r) => setTimeout(r, 16));
  }

  onProgress({
    percentage: 100,
    currentFrame: totalFrames,
    totalFrames,
    statusText: "正在封装导出的 MP4 动画视频文件..."
  });

  // Request any pending data buffer before stopping recorder
  if (recorder.state === "recording" && typeof recorder.requestData === "function") {
    recorder.requestData();
  }
  await new Promise((r) => setTimeout(r, 250));

  if (recorder.state !== "inactive") {
    recorder.stop();
  }
  return recorderStopped;
}

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
  cvmax: number
): number => {
  const exactCvmax = cvmax;

  let coreReduction = 5 + ((exactCvmax - 30) / (140 - 30)) * 20;
  coreReduction = Math.max(5, Math.min(25, coreReduction));

  const decayScale = rmw_km * 2.2;
  const decayFactor = Math.exp(-Math.pow(distKm / decayScale, 2));

  const reduction = coreReduction * decayFactor;

  let simulated = rawWind - reduction;

  if (rawWind > 15) {
    simulated = Math.max(10, simulated);
  }

  if (distKm < rmw_km * 4.0) {
    const maxAllowed = exactCvmax - (coreReduction * 0.8 * decayFactor);
    if (simulated > maxAllowed) {
      simulated = maxAllowed;
    }
  }

  return Math.max(1.0, simulated);
};
