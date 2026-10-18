const G = 9.80665;
const KAPPA = 0.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Powell 型高风速饱和：达到飓风级后海面阻力不再无限增大。 */
export function seaSurfaceDragCoefficient(speedMs: number): number {
  const u = Math.max(0, speedMs);
  if (u < 10) return clamp((0.75 + 0.067 * u) * 1e-3, 0.75e-3, 1.45e-3);
  if (u < 33) return clamp((1.18 + 0.030 * (u - 10)) * 1e-3, 1.1e-3, 1.9e-3);
  if (u < 55) return clamp((1.87 - 0.020 * (u - 33)) * 1e-3, 1.40e-3, 1.90e-3);
  return 1.40e-3;
}

export function charnockRoughness(speedMs: number): number {
  const cd = seaSurfaceDragCoefficient(speedMs);
  const uStar = Math.sqrt(cd) * Math.max(0.5, speedMs);
  return clamp(0.014 * uStar * uStar / G + 1.5e-5, 1.5e-5, 0.008);
}

export function landRoughness(elevationM: number, reliefM: number): number {
  const plain = smooth01((340 - elevationM) / 300) * smooth01((360 - reliefM) / 300);
  const mountain = smooth01((Math.max(elevationM, reliefM) - 650) / 1250);
  // 5.2.30：此前中低起伏陆地的 z0 偏大，配合 slab 重复阻力会把近岸大风过度耗散。
  // 这里仍然由 ETOPO 高程/起伏控制，但把华东平原一类地表保持在更合理的低粗糙度区间。
  const base = 0.040 * plain + 0.20 * (1 - plain) * (1 - mountain) + 0.64 * mountain;
  const form = 0.000016 * reliefM * reliefM / 25;
  return clamp(Math.sqrt(base * base + form * form), 0.020, 1.00);
}

function logWindReduction(z0: number, boundaryLayerDepthM: number): number {
  // slab 风代表约 80–180 m 的边界层平均风，不应再按 10–50 m 的强折减重复一次。
  const zRef = Math.max(80, Math.min(180, boundaryLayerDepthM * 0.18));
  const denom = Math.log(Math.max(1.01, zRef / Math.max(1e-5, z0)));
  const numer = Math.log(Math.max(1.01, 10 / Math.max(1e-5, z0)));
  return clamp(numer / Math.max(0.2, denom), 0.48, 0.96);
}

export function estimateTenMeterReduction(
  isLand: boolean,
  z0M: number,
  boundaryLayerDepthM: number,
  speedMs: number,
  localSolarHour: number,
  localReliefM = 0
): number {
  const diurnal = Math.cos(((localSolarHour - 14) / 24) * Math.PI * 2);
  const daytimeMixing = smooth01((diurnal + 0.45) / 1.25);
  if (!isLand) return clamp(0.86 + 0.045 * smooth01((speedMs - 12) / 35), 0.83, 0.92);
  const logFactor = logWindReduction(z0M, boundaryLayerDepthM);
  // 强台风登陆时机械湍流会显著加深混合层，因此陆地 10 m 风不能按静稳夜间边界层
  // 一刀切到 40% 左右。强风时逐步抬高交换系数，使平原内陆仍能保留现实的大风。
  const strongWindMixing = smooth01((speedMs - 10) / 28);
  const empirical = 0.66 + 0.08 * daytimeMixing + 0.12 * strongWindMixing - 0.045 * smooth01(localReliefM / 1400);
  return clamp(0.24 * logFactor + 0.76 * empirical, 0.62, 0.86);
}
