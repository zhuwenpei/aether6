import { checkPointOnProductLandGeoJson } from "./NaturalEarthLoader";
import { getSynopticTerrainDiagnostics } from "./HighResolutionTerrain";

import {
  charnockRoughness,
  estimateTenMeterReduction,
  landRoughness,
  seaSurfaceDragCoefficient
} from "./SurfaceDragPhysics";
export { estimateTenMeterReduction, seaSurfaceDragCoefficient } from "./SurfaceDragPhysics";

const KAPPA = 0.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};


interface StaticTerrainSample {
  isLand: boolean;
  elevationM: number;
  localReliefM: number;
  slopeEastMPerKm: number;
  slopeNorthMPerKm: number;
  highResolution: boolean;
}

const terrainStaticCache = new Map<string, StaticTerrainSample>();
// A 0.10°/0.125° export commonly contains >80k points. The old limit evicted the first rows
// before the next video frame arrived, so every frame repeated the expensive coastline + 13-point
// terrain diagnostics. 180k covers typical high-resolution product domains without changing any
// sampled terrain value; it trades a bounded amount of memory for a large multi-frame speedup.
const TERRAIN_CACHE_LIMIT = 180_000;

function getStaticTerrainSample(lat: number, lon: number, terrainResolutionDeg = 0.1): StaticTerrainSample {
  // HighResolutionTerrain itself clamps the terrain stencil to 0.10-0.20°. Normalize the cache
  // key to that effective stencil so coarser product-diagnostic grids and 0.10/0.125° synoptic
  // products can reuse identical terrain work instead of storing duplicate entries.
  const effectiveTerrainResolutionDeg = clamp(Math.max(0.10, terrainResolutionDeg * 0.8), 0.10, 0.20);
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${effectiveTerrainResolutionDeg.toFixed(3)}`;
  const hit = terrainStaticCache.get(key);
  if (hit) {
    terrainStaticCache.delete(key);
    terrainStaticCache.set(key, hit);
    return hit;
  }
  const etopo = getSynopticTerrainDiagnostics(lat, lon, effectiveTerrainResolutionDeg);
  // 海陆边界以高精度产品海岸线为准。5.2.29 曾用“ETOPO > 8 m”直接并入 land mask，
  // 海岸附近插值高程会把部分近海格点误判为陆地，使强风尚未登陆就提前受到陆面阻力。
  // ETOPO 现在只负责真实陆地上的高程、起伏和坡度，不再向海面扩张陆地掩膜。
  const isLand = checkPointOnProductLandGeoJson(lat, lon);
  const sample: StaticTerrainSample = {
    isLand,
    elevationM: isLand ? Math.max(0, etopo.elevation) : 0,
    localReliefM: isLand ? Math.max(0, etopo?.localReliefM ?? 0) : 0,
    slopeEastMPerKm: isLand ? (etopo?.slopeEastMPerKm ?? 0) : 0,
    slopeNorthMPerKm: isLand ? etopo.slopeNorthMPerKm : 0,
    highResolution: etopo.source === "ETOPO 2022 60-arc-second / 0.10deg synoptic cache"
  };
  terrainStaticCache.set(key, sample);
  if (terrainStaticCache.size > TERRAIN_CACHE_LIMIT) terrainStaticCache.delete(terrainStaticCache.keys().next().value as string);
  return sample;
}
export interface SurfaceRoughnessSample {
  isLand: boolean;
  elevationM: number;
  localReliefM: number;
  slopeEastMPerKm: number;
  slopeNorthMPerKm: number;
  z0M: number;
  dragCoefficient: number;
  boundaryLayerDepthM: number;
  tenMeterReduction: number;
  terrainPenalty: number;
  terrainDeflectX: number;
  terrainDeflectY: number;
  terrainPressureHpa: number;
  turbulenceFraction: number;
  terrainHighResolution: boolean;
}

/**
 * 从现有产品海岸线与 ETOPO 数据诊断地表阻力和地形绕流参数。
 * AETHER 当前没有土地利用数据，因此明确使用高程与次网格起伏作为代理量，
 * 不虚构植被或城市分类。
 */
export function sampleSurfaceRoughness(
  lat: number,
  lon: number,
  speedMs: number,
  localSolarHour: number,
  windU = 0,
  windV = 0,
  terrainResolutionDeg = 0.1
): SurfaceRoughnessSample {
  const terrain = getStaticTerrainSample(lat, lon, terrainResolutionDeg);
  const { isLand, elevationM, localReliefM, slopeEastMPerKm, slopeNorthMPerKm } = terrain;

  const z0M = isLand ? landRoughness(elevationM, localReliefM) : charnockRoughness(speedMs);
  let dragCoefficient: number;
  if (isLand) {
    // slab 动量层代表约百米高度，不能直接使用 10 m 阻力系数，否则每次伪时间迭代都会
    // 对陆地重复施加过强耗散。用 80 m 参考高度得到等效阻力，再由 10 m 折减单独处理近地层。
    const refHeight = 80;
    dragCoefficient = clamp(Math.pow(KAPPA / Math.log(Math.max(1.05, refHeight / z0M)), 2), 0.95e-3, 6.8e-3);
  } else {
    dragCoefficient = seaSurfaceDragCoefficient(speedMs);
  }

  const diurnal = Math.cos(((localSolarHour - 14) / 24) * Math.PI * 2);
  const daytimeMixing = smooth01((diurnal + 0.45) / 1.25);
  const strongMixing = smooth01((speedMs - 10) / 30);
  const boundaryLayerDepthM = isLand
    ? 680 + 300 * daytimeMixing + 220 * strongMixing + 90 * smooth01(localReliefM / 1200)
    : 760 - 90 * smooth01((speedMs - 25) / 35);

  const tenMeterReduction = estimateTenMeterReduction(isLand, z0M, boundaryLayerDepthM, speedMs, localSolarHour, localReliefM);

  // Brunt–Väisälä 稳定度代理：夜间稳定层结和高地形会增强阻挡。
  const stabilityN = isLand ? (0.009 + 0.004 * (1 - daytimeMixing)) : 0.008;
  const barrierM = Math.max(40, Math.min(1800, 0.50 * localReliefM + 0.20 * elevationM));
  const froude = speedMs / Math.max(0.5, stabilityN * barrierM);
  // 低起伏平原不应被“山地阻挡”误杀；真正的 Brinkman 惩罚主要留给显著山脉。
  const terrainPenalty = isLand ? 0.86 * smooth01((1.02 - froude) / 0.88) * smooth01((localReliefM - 150) / 780) : 0;

  // 地形梯度的切向方向；Fr < 1 时求解器会把部分气流转向该方向。
  const gradMag = Math.hypot(slopeEastMPerKm, slopeNorthMPerKm);
  const terrainDeflectX = gradMag > 1e-6 ? -slopeNorthMPerKm / gradMag : 0;
  const terrainDeflectY = gradMag > 1e-6 ? slopeEastMPerKm / gradMag : 0;
  const flowNorm = Math.max(0.5, Math.hypot(windU, windV));
  const slopeAlongFlow = (windU * slopeEastMPerKm + windV * slopeNorthMPerKm) / flowNorm;
  // 顺流上坡形成有限迎风高压，顺流下坡形成背风低压；该动力项会进入压力梯度。
  // Fr 较大时惩罚减弱，因此气流可越山并受背风低压加速，而不是被强行绕流。
  const terrainPressureHpa = isLand
    ? clamp(0.009 * slopeAlongFlow * (0.35 + 0.65 * smooth01(localReliefM / 900)), -1.6, 1.6)
    : 0;

  return {
    isLand,
    elevationM,
    localReliefM,
    slopeEastMPerKm,
    slopeNorthMPerKm,
    z0M,
    dragCoefficient,
    boundaryLayerDepthM,
    tenMeterReduction,
    terrainPenalty,
    terrainDeflectX,
    terrainDeflectY,
    terrainPressureHpa,
    turbulenceFraction: isLand ? clamp(0.055 + localReliefM / 18000, 0.05, 0.11) : 0.028,
    terrainHighResolution: terrain.highResolution
  };
}
