import type { Typhoon, TyphoonState } from "../types";
import type { SynopticEnvironmentState } from "./SynopticEnvironment";

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;
const RHO_AIR = 1.17;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

export interface TropicalCycloneVortexSample {
  distanceKm: number;
  pressureHpa: number;
  pressureAnomalyHpa: number;
  u: number;
  v: number;
  tangentialMs: number;
  radialInflowMs: number;
  quadrantScale: number;
  farFieldWeight: number;
}

function angularRadius(
  quad: { ne?: number; se?: number; sw?: number; nw?: number } | undefined,
  bearingDeg: number,
  fallback: number
): number {
  if (!quad) return fallback;
  const ne = quad.ne || fallback;
  const se = quad.se || fallback;
  const sw = quad.sw || fallback;
  const nw = quad.nw || fallback;
  // 在四象限中心之间做分段余弦插值（从北顺时针：NE 45、SE 135、SW 225、NW 315）。
  const centers = [45, 135, 225, 315, 405];
  const values = [ne, se, sw, nw, ne];
  let b = ((bearingDeg % 360) + 360) % 360;
  if (b < 45) b += 360;
  for (let i = 0; i < 4; i++) {
    if (b >= centers[i] && b <= centers[i + 1]) {
      const t0 = (b - centers[i]) / 90;
      const t = (1 - Math.cos(Math.PI * t0)) * 0.5;
      return values[i] * (1 - t) + values[i + 1] * t;
    }
  }
  return fallback;
}

function meanQuad(quad: { ne?: number; se?: number; sw?: number; nw?: number } | undefined, fallback: number): number {
  if (!quad) return fallback;
  const vals = [quad.ne, quad.se, quad.sw, quad.nw].filter((v): v is number => Number.isFinite(v) && (v as number) > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : fallback;
}


function vortexSymmetryWeight(state: TyphoonState | Typhoon): number {
  if (state.coldAirWarmCoreDestroyed) return 0.82;
  // 强台风内核受旋转惯性约束更强，不应被单个象限风圈或背景风压成“扁饼”。
  // 弱系统/温带化阶段保留更大的方位非对称。
  const strong = smooth01(((state.vmax || 0) - 24) / 28);
  const et = clamp(state.extrTransition || 0, 0, 1);
  return clamp(0.82 - 0.62 * strong + 0.24 * et, 0.18, 0.85);
}

function regularizedAngularRadius(
  state: TyphoonState | Typhoon,
  quad: { ne?: number; se?: number; sw?: number; nw?: number } | undefined,
  bearingDeg: number,
  fallback: number
): number {
  if (!quad) return fallback;
  const mean = meanQuad(quad, fallback);
  const raw = angularRadius(quad, bearingDeg, mean);
  const weight = vortexSymmetryWeight(state);
  const strong = smooth01(((state.vmax || 0) - 28) / 24);
  const lo = mean * (0.60 + 0.25 * strong);
  const hi = mean * (1.50 - 0.30 * strong);
  return clamp(mean + (raw - mean) * weight, lo, hi);
}

function localGeometry(lat: number, lon: number, centerLat: number, centerLon: number) {
  const phi1 = centerLat * DEG;
  const phi2 = lat * DEG;
  let dLonDeg = lon - centerLon;
  while (dLonDeg > 180) dLonDeg -= 360;
  while (dLonDeg < -180) dLonDeg += 360;
  const dPhi = (lat - centerLat) * DEG;
  const dLam = dLonDeg * DEG;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  const distanceKm = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  const xKm = dLonDeg * 111.12 * Math.max(0.15, Math.cos((lat + centerLat) * 0.5 * DEG));
  const yKm = (lat - centerLat) * 111.12;
  const bearingDeg = ((Math.atan2(xKm, yKm) / DEG) + 360) % 360;
  return { distanceKm, xKm, yKm, bearingDeg };
}

function hollandB(state: TyphoonState | Typhoon, poc: number): number {
  const safePmin = clamp(Number.isFinite(state.pmin) ? state.pmin : 1000, 0, 1045);
  const deficit = clamp(poc - safePmin, 1, 125);
  const compact = clamp(42 / Math.max(8, state.rmw || 35), 0.45, 2.2);
  return clamp(1.05 + deficit / 115 + 0.22 * (compact - 0.7) - 0.10 * (Math.abs(state.lat) / 35), 1.0, 2.5);
}

export function targetWindFromQuadrantRadii(state: TyphoonState | Typhoon, bearingDeg: number, radiusKm: number): number {
  const rmw = clamp(state.rmw || 35, 7, 180);
  const vmax = Math.max(0, state.vmax || 0);
  if (radiusKm <= rmw) return vmax * Math.pow(Math.max(0, radiusKm / rmw), 1.25);
  // ROUND115: below 34 kt there is no physically defined R7/34-kt radius.  The previous fallback
  // still constructed an outer anchor several hundred kilometres away, stamping a giant donut into
  // 5-10 m/s disturbances. Weak lows now use a compact monotonic decay from their actual RMW.
  if (vmax < 13.9) {
    const weakOrganization = smooth01((vmax - 5.0) / 8.9);
    const decayKm = Math.max(28, rmw * (1.12 + 0.62 * weakOrganization));
    return vmax * Math.exp(-(radiusKm - rmw) / decayKm);
  }
  const r12 = Math.max(rmw * 1.08, regularizedAngularRadius(state, state.r12, bearingDeg, rmw * 1.75));
  const r10 = Math.max(r12 * 1.06, regularizedAngularRadius(state, state.r10, bearingDeg, rmw * 2.75));
  const r7 = Math.max(r10 * 1.08, regularizedAngularRadius(state, state.r7, bearingDeg, rmw * 4.8));
  const anchors: Array<[number, number]> = [[rmw, vmax]];
  if (vmax > 32.4) anchors.push([r12, 32.4]);
  if (vmax > 24.2) anchors.push([r10, 24.2]);
  if (vmax > 13.9) anchors.push([r7, 13.9]);
  const last = anchors[anchors.length - 1];
  anchors.push([Math.max(last[0] * 2.0, r7 * 1.75), Math.min(last[1] * 0.15, 3.0)]);
  for (let i = 0; i < anchors.length - 1; i++) {
    const [r0, v0] = anchors[i], [r1, v1] = anchors[i + 1];
    if (radiusKm <= r1) {
      const t = clamp((radiusKm - r0) / Math.max(1e-6, r1 - r0), 0, 1);
      if (v0 > 0 && v1 > 0) return Math.exp(Math.log(v0) * (1 - t) + Math.log(v1) * t);
      return v0 * (1 - t) + v1 * t;
    }
  }
  const [r0, v0] = anchors[anchors.length - 1];
  return v0 * Math.exp(-(radiusKm - r0) / Math.max(80, r0 * 0.8));
}


/**
 * Wind-circle geometry is guidance, not a hard stencil.  The three available operational radii
 * contribute according to how close the sample is to each wind band.  This preserves the useful
 * size/asymmetry information in R7/R10/R12 while preventing a noisy single quadrant or one edited
 * radius from mechanically stamping that exact outline into every 10 m wind contour.
 */
function softWindRadiiShapeScale(
  state: TyphoonState | Typhoon,
  bearingDeg: number,
  radiusKm: number,
  rmw: number
): number {
  const vmax = Math.max(0, state.vmax || 0);
  const levels = [
    { quad: state.r12, fallback: rmw * 1.70, threshold: 32.4, weight: 0.85 },
    { quad: state.r10, fallback: rmw * 2.65, threshold: 24.2, weight: 0.95 },
    { quad: state.r7, fallback: Math.max(145, rmw * 4.55), threshold: 13.9, weight: 1.00 }
  ];
  let logScale = 0;
  let weightSum = 0;
  for (const level of levels) {
    if (!level.quad || vmax < level.threshold * 0.88) continue;
    const mean = Math.max(rmw * 1.04, meanQuad(level.quad, level.fallback));
    const local = regularizedAngularRadius(state, level.quad, bearingDeg, mean);
    const proximityWidth = Math.max(35, mean * 0.52);
    const proximity = Math.exp(-0.5 * ((radiusKm - mean) / proximityWidth) ** 2);
    // Keep a little influence away from the exact threshold so the three wind circles cooperate
    // to describe one circulation rather than three disconnected rings.
    const w = level.weight * (0.22 + 0.78 * proximity);
    const ratio = clamp(local / Math.max(1, mean), 0.80, 1.20);
    logScale += Math.log(ratio) * w;
    weightSum += w;
  }
  if (weightSum <= 1e-6) return 1;
  // Only 58% of the diagnosed quadrant-size anomaly is applied.  The rest is supplied by the
  // pressure-gradient / boundary-layer solution, making the wind circles a soft physical guide.
  const diagnosed = Math.exp(logScale / weightSum);
  return clamp(1 + (diagnosed - 1) * 0.58, 0.88, 1.12);
}

/**
 * Holland / Willoughby 型台风涡旋采样。气压以局地环境压作为外围气压，
 * 风速剖面锚定模型状态 Vmax，并由四象限风圈半径连续拉伸。
 */
/** Round157 wind-product compatibility: recover the active INNER vortex
 * radius from old saves whose failed EWRC had enlarged `rmw` to the stalled
 * OUTER eyewall. This is NOT an artificial calm-eye overlay: the solver still
 * produces the winds, but its inner-core scale must not be the outer-ring
 * memory scale. The outer wind radii and secondary eyewall remain separate.
 */
export function synopticInnerCoreRmw(state: TyphoonState | Typhoon): number {
  const original = clamp(Number(state.rmw) || 35, 7, 240);
  // Hot-path fast exit: vortex samples evaluate this at every synoptic grid
  // cell. Normal compact eyes need no additional state reads or allocation.
  if (original <= 65 || (state.vmax || 0) <= 27) return original;
  const memory = clamp(Number(state.giantEyeOuterWallMemory) || 0, 0, 1);
  const failure = state.ewrcFailureMode === 'inner_collapse_outer_stalls' ||
    state.ewrcFailureMode === 'outer_ring_fractures' ||
    state.ewrcFailureMode === 'double_eyewall_decay' ||
    state.ewrcState === 'penalty_failure' || state.ewrcState === 'recovering_failure';
  const dryDamage = clamp(Number(state.dryAirCoreExposure) || 0, 0, 1);
  const broken = state.eyePhase === 'blocked' || state.eyePhase === 'none' ||
    state.eyeType === 'gap' || state.eyeType === 'broken';
  // Ordinary, coherent big eyes and successful replacement are untouched.
  // Failed mode labels can persist for hundreds of hours in an archive. Only
  // reinterpret an implausibly wide *active tropical inner core*: a weak
  // remnant's legitimately diffuse outer circulation must not be compacted.
  const overlyBroadCore = clamp((original - 65) / 23,0,1);
  const tropicalGate = clamp(((state.vmax || 0) - 27) / 13,0,1);
  const failureGate = Math.max(failure ? 1 : 0,
    memory > 0.12 ? clamp((memory - 0.12)/0.35,0,1) : 0) *
    overlyBroadCore * tropicalGate;
  const dryGate = (broken || original > 75)
    ? clamp((dryDamage-0.34)/0.34,0,1) * overlyBroadCore * tropicalGate
    : 0;
  const gate = Math.max(failureGate,dryGate);
  if (gate <= 0) return original;
  // A still-visible compact vortex inside a stalled outer band. Avoid a hard
  // discontinuity while the failure memory develops or recedes.
  const innerCeiling = broken ? 48 : 58;
  return original + (Math.min(original,innerCeiling)-original)*gate;
}

export function sampleTropicalCycloneVortex(
  lat: number,
  lon: number,
  state: TyphoonState | Typhoon,
  environment: Pick<SynopticEnvironmentState, "slp" | "shearU" | "shearV"> & { westerlyStrength?: number },
): TropicalCycloneVortexSample {
  const { distanceKm: rawR, xKm, yKm, bearingDeg } = localGeometry(lat, lon, state.lat, state.lon);
  const coldAirRemnantLow = !!state.coldAirWarmCoreDestroyed;
  const et = coldAirRemnantLow ? 0 : clamp(state.extrTransition || 0, 0, 1);
  // Lifecycle geometry: tropical -> subtropical/hybrid -> frontal extratropical.
  // A stage-3 cold-air warm-core collapse is explicitly excluded: it becomes a remnant low,
  // never a subtropical or frontal extratropical cyclone.
  // The subtropical stage is deliberately front-free: the upper warm core erodes and the wind
  // maximum migrates outward before mature cold/warm fronts are allowed to appear.
  const subtropicalOnset = smooth01((et - 0.28) / 0.24);
  const frontalPhase = smooth01((et - 0.68) / 0.22);
  const subtropicalPhase = clamp(subtropicalOnset * (1 - 0.82 * frontalPhase), 0, 1);
  const statePmin = clamp(Number.isFinite(state.pmin) ? state.pmin : 1000, 0, 1045);
  // Product pressure is not rigidly one-to-one with Vmax. A small continuous structural/time
  // perturbation keeps equal-intensity frames meteorologically alive without changing Engine.pmin.
  const pressureMicroVariation = clamp(
    0.72 * Math.sin((state.simHour || 0) * 0.19 + (state.direction || 0) * DEG * 0.37)
      + 0.38 * Math.sin((state.simHour || 0) * 0.071 + (state.rmw || 35) * 0.083),
    -1.15, 1.15
  );
  const safePmin = clamp(statePmin + pressureMicroVariation, 0, 1045);
  const westerlyStrength = clamp(environment.westerlyStrength || 0, 0, 1);
  const weakBaroclinicResponse = 1 - smooth01(((state.vmax || 0) - 18) / 42);
  // A weak/decaying cyclone deforms much more readily when it reaches the westerly belt.  This is
  // a shape response only; the dynamical extratropical-transition state in Engine.ts still owns
  // the actual lifecycle/intensity transition.
  const baroclinicShape = coldAirRemnantLow
    ? 0
    : clamp(et + 0.42 * westerlyStrength * (0.28 + 0.72 * weakBaroclinicResponse), 0, 1);
  const damage = clamp(Math.max(
    state.terrainHollowCoreMemory || 0,
    (state.structuralDamageHours || 0) / 30,
    state.isStructureDamaged ? 0.45 : 0
  ), 0, 1);
  // Keep the wind-maximum radius tied primarily to the dynamical state. Terrain damage may
  // broaden the pressure mass field, but it must not instantly inflate the 10 m circulation when
  // the centre crosses a coastline. ET still broadens the wind core gradually.
  const baseRmw = synopticInnerCoreRmw(state);
  const damageWindBroadening = state.landed ? 0.02 : 0.05;
  const rmw = clamp(baseRmw * (1 + 0.24 * et + damageWindBroadening * damage), 7, 235);
  const weakOrganization = smooth01(((state.vmax || 0) - 5.0) / 8.9);
  const fallbackR7 = (state.vmax || 0) < 13.9
    ? Math.max(62, rmw * (2.05 + 1.35 * weakOrganization))
    : Math.max(148, rmw * 4.6);
  const hasPhysicalR7 = (state.vmax || 0) >= 13.9 && !!state.r7;
  const r7Mean = hasPhysicalR7 ? meanQuad(state.r7, fallbackR7) : fallbackR7;
  const strongCore = smooth01(((state.vmax || 0) - 26) / 28);
  const radiiShapeScale = softWindRadiiShapeScale(state, bearingDeg, rawR, rmw);
  const quadrantScale = clamp(
    radiiShapeScale,
    0.84 + 0.08 * strongCore,
    1.16 - 0.07 * strongCore
  );
  const stretchBlend = smooth01((rawR / rmw - 1.38) / 1.62);
  // A small 3% compactness bias corrects the still-slightly-broad 6.0.8 circulation.  Operational
  // radii can push the field wider or narrower through quadrantScale, but cannot dictate it 1:1.
  const compactness = 0.97;
  const adjustedOuterR = rawR / compactness;
  const effectiveR = rawR <= rmw * 1.08
    ? rawR
    : rmw + (adjustedOuterR - rmw) / (1 + (quadrantScale - 1) * 1.06 * stretchBlend);
  const r = Math.max(0.25, effectiveR);

  const poc = clamp(environment.slp, 975, 1045);
  const deficitForB = clamp(poc - safePmin, 1, 125);
  const compactForB = clamp(42 / Math.max(8, baseRmw), 0.45, 2.2);
  const b = clamp(1.05 + deficitForB / 115 + 0.22 * (compactForB - 0.7) - 0.10 * (Math.abs(state.lat) / 35), 1.0, 2.5);
  const shearMagForShape = Math.hypot(environment.shearU || 0, environment.shearV || 0);
  const motionDirForShape = (state.direction || 0) * DEG;
  const shearUx = shearMagForShape > 0.2 ? (environment.shearU || 0) / shearMagForShape : Math.sin(motionDirForShape);
  const shearVy = shearMagForShape > 0.2 ? (environment.shearV || 0) / shearMagForShape : Math.cos(motionDirForShape);
  const axisX = 0.68 * Math.sin(motionDirForShape) + 0.32 * shearUx;
  const axisY = 0.68 * Math.cos(motionDirForShape) + 0.32 * shearVy;
  const baroclinicBearing = Math.atan2(axisX, axisY);
  const bearingRadForShape = bearingDeg * DEG;
  // ET pressure fields become broad and elliptical/comma-like along the motion/shear axis instead
  // of remaining a circular tropical bullseye. Terrain damage adds only a weak lopsided memory.
  const hollowBearing = (state.terrainHollowCoreBearingDeg ?? state.direction ?? 0) * DEG;
  const pressureShape = clamp(
    1 + 0.30 * baroclinicShape * Math.cos(2 * (bearingRadForShape - baroclinicBearing))
      + 0.06 * damage * Math.cos(bearingRadForShape - hollowBearing),
    0.70, 1.38
  );
  // 登陆后中心压强仍可很低，但摩擦/地形会使质量场内核变宽。只拓宽压力 RMW，
  // 风速 RMW 仍由状态量和边界层求解控制，避免陆地等压线在一个格点附近挤成一团。
  // Landfall must not inflate the pressure-gradient footprint.  Earlier versions widened the
  // pressure RMW to >=1.45x immediately on land, which made the boundary-layer solver manufacture
  // a larger circulation exactly when surface friction should be contracting it.
  const pressureRmwBase = state.landed ? Math.max(baseRmw * 1.03, 28) : rmw;
  const pressureRmw = pressureRmwBase * (1 + 0.24 * baroclinicShape + (state.landed ? 0.025 : 0.08) * damage) *
    (coldAirRemnantLow ? 1.48 : 1);
  const pressureR = Math.max(0.25, r / pressureShape);
  const x = Math.pow(pressureRmw / pressureR, b);
  const pressureHpa = safePmin + Math.max(0, poc - safePmin) * Math.exp(-x);
  const outerScale = Math.max(r7Mean, rmw * 4.4);
  const farStart = Math.max(outerScale * 1.27, rmw * 3.65);
  const farEnd = Math.max(outerScale * 1.78, rmw * 5.8);
  const farFieldWeight = 1 - smooth01((rawR - farStart) / Math.max(1, farEnd - farStart));
  // 与降水模型有限雨带相同的主相位关系，只给外围风压场很弱的螺旋调制。
  // 它改变计算场而非绘图像素，因此等压线和风速色块会共同产生细微波折。
  const size01 = clamp((r7Mean - 180) / 360, 0, 1);
  const principalInner = Math.max(1.42 * rmw, 68 + 28 * size01);
  const principalOuter = Math.min(500 + 80 * size01, principalInner + 205 + 85 * size01);
  const bandRise = smooth01((rawR - (principalInner - 35)) / 70);
  const bandFall = 1 - smooth01((rawR - (principalOuter - 45)) / 90);
  const bandWeight = clamp(bandRise * bandFall, 0, 1);
  const principalTargetDeg = (state.direction || 0) + 132 - (state.simHour || 0) * 3.5
    - (92 + 22 * size01) * Math.log(Math.max(0.72, rawR / Math.max(1, principalInner)));
  const spiralWave = Math.cos((bearingDeg - principalTargetDeg) * DEG);
  let pressureAnomalyHpa = (pressureHpa - poc) * farFieldWeight * (1 + 0.018 * bandWeight * spiralWave);
  if (frontalPhase > 0.01) {
    const bearingRad = bearingDeg * DEG;
    const warmFrontBearing = baroclinicBearing + 78 * DEG;
    const coldFrontBearing = baroclinicBearing + 205 * DEG;
    const frontalSector = Math.max(
      Math.max(0, Math.cos(bearingRad - warmFrontBearing)),
      0.78 * Math.max(0, Math.cos(bearingRad - coldFrontBearing))
    );
    const frontalRadius = rmw * (3.8 + 1.5 * frontalPhase);
    const frontalWidth = Math.max(75, rmw * (2.3 + 0.9 * frontalPhase));
    const frontalTrough = Math.min(5.4, Math.max(0, poc - safePmin) * 0.060) * frontalPhase
      * Math.exp(-0.5 * ((rawR - frontalRadius) / frontalWidth) ** 2) * frontalSector;
    pressureAnomalyHpa -= frontalTrough * farFieldWeight;
  }

  // 由 Holland 气压径向导数求梯度风估计。
  const rM = Math.max(1000, pressureR * 1000);
  const dpdrPaM = Math.max(0, (poc - safePmin) * 100 * b * x * Math.exp(-x) / rM);
  const f = 2 * 7.2921159e-5 * Math.sin(state.lat * DEG);
  const grad = Math.max(0, dpdrPaM / RHO_AIR);
  const vg = Math.max(0, 0.5 * (-f * rM + Math.sqrt(Math.max(0, f * f * rM * rM + 4 * rM * grad))));

  // Willoughby 型风速剖面由模型的四象限 34/50/64 kt 风圈共同约束。
  // 风圈锚点连续插值，因此状态风圈是物理输入，
  // 而不是渲染阶段后画上去的装饰圆。
  const radiiReferenceRadius = rawR / 0.965;
  const radiiTarget = targetWindFromQuadrantRadii(state, bearingDeg, radiiReferenceRadius);
  const gradientTarget = Math.max(0.35, vg * 0.76);
  const radiiBlendOuter = smooth01((rawR - rmw * 1.10) / Math.max(45, r7Mean * 0.82));
  const radiiGuidanceWeight = 0.32 + 0.40 * radiiBlendOuter;
  // Log-space blending lets the diagnosed pressure-gradient wind remain primary while wind-circle
  // size still shifts the circulation coherently.  Unlike max(gradient,radiiTarget), the exact R7/
  // R10/R12 thresholds are no longer mandatory wind-speed contours.
  let target = Math.exp(
    Math.log(gradientTarget) * (1 - radiiGuidanceWeight)
    + Math.log(Math.max(0.35, radiiTarget)) * radiiGuidanceWeight
  );
  const innerCoreRestore = 1 - smooth01((rawR - rmw * 0.72) / Math.max(10, rmw * 0.55));
  target = target * (1 - innerCoreRestore) + Math.max(target, Math.min(state.vmax, radiiTarget)) * innerCoreRestore;
  target = Math.min(state.vmax * 1.02, target);
  target *= 1 + 0.042 * bandWeight * spiralWave;

  // Subtropical cyclone: convection has spread away from the centre, the low-level circulation
  // remains weakly warm, and the strongest winds live far outside the former eyewall.  No frontal
  // wind band is added here; that waits for frontalPhase below.
  if (subtropicalPhase > 0.01) {
    const outerWindRadius = Math.max(rmw * 3.05, Math.min(r7Mean * 0.68, 260));
    const outerWindWidth = Math.max(48, outerWindRadius * 0.34);
    const peripheralRing = Math.exp(-0.5 * ((rawR - outerWindRadius) / outerWindWidth) ** 2);
    const innerDecay = Math.exp(-rawR / Math.max(68, rmw * 2.15));
    const redistributedBase = target * (1 - 0.48 * subtropicalPhase * innerDecay);
    const peripheralTarget = state.vmax * (0.72 + 0.18 * subtropicalPhase) * peripheralRing;
    target = Math.max(redistributedBase, peripheralTarget);
  }

  // Mature ET: the former tropical core continues to fade while two frontal wind corridors emerge.
  // This moves the strongest surface wind from a circular eyewall/ring onto the cold/warm-front bands.
  if (frontalPhase > 0.01) {
    const bearingRad = bearingDeg * DEG;
    const warmFrontBearing = baroclinicBearing + 78 * DEG;
    const coldFrontBearing = baroclinicBearing + 205 * DEG;
    const warmBand = Math.pow(Math.max(0, Math.cos(bearingRad - warmFrontBearing)), 2.2);
    const coldBand = 0.88 * Math.pow(Math.max(0, Math.cos(bearingRad - coldFrontBearing)), 1.8);
    const frontalAzimuth = Math.max(warmBand, coldBand);
    const frontalWindRadius = Math.max(rmw * 3.7, Math.min(r7Mean * 0.72, 330));
    const frontalWindWidth = Math.max(70, frontalWindRadius * 0.42);
    const frontalRadial = Math.exp(-0.5 * ((rawR - frontalWindRadius) / frontalWindWidth) ** 2);
    const innerCoreFade = Math.exp(-rawR / Math.max(80, rmw * 2.5));
    target *= 1 - 0.58 * frontalPhase * innerCoreFade;
    const frontalWindTarget = state.vmax * (0.68 + 0.16 * frontalPhase) * frontalRadial *
      (0.42 + 0.58 * frontalAzimuth);
    target = Math.max(target, frontalWindTarget);
  }

  // Stage-3 cold-air warm-core destruction: the closed eyewall vortex collapses before an
  // extratropical cyclone can form. Keep the analysed Vmax evolution untouched in Engine.ts, but
  // redistribute the wind product into a broad, ragged remnant-low cloud/wind shield: no eye-wall
  // ring, no subtropical outer-wind annulus, and no frontal corridors.
  if (coldAirRemnantLow) {
    const remnantAge = clamp((state.coldAirExposureHours || 0) / 30, 0, 1);
    const formerCoreRing = Math.exp(-0.5 * ((rawR - rmw) / Math.max(18, rmw * 0.72)) ** 2);
    const remnantRadius = Math.max(rmw * 2.35, Math.min(Math.max(105, r7Mean * 0.46), 220));
    const remnantWidth = Math.max(70, remnantRadius * (0.52 + 0.16 * remnantAge));
    const diffusePatch = Math.exp(-0.5 * ((rawR - remnantRadius) / remnantWidth) ** 2);
    const remnantBearing = ((state.direction || 0) + 145 + 22 * Math.sin((state.simHour || 0) * 0.11)) * DEG;
    const azimuthalPatchiness = clamp(
      0.58 + 0.27 * Math.cos(bearingRadForShape - remnantBearing)
        + 0.15 * Math.cos(2 * (bearingRadForShape - remnantBearing) + 0.7),
      0.20, 1.0
    );
    const collapsedCore = target * (1 - (0.72 + 0.10 * remnantAge) * formerCoreRing);
    const diffuseRemnant = state.vmax * (0.50 - 0.10 * remnantAge) * diffusePatch * azimuthalPatchiness;
    target = Math.min(state.vmax * 0.82, Math.max(collapsedCore * 0.72, diffuseRemnant));
  }

  // EWRC：由模型生命周期状态驱动外眼墙次峰与中间护城河。
  const ewrc = clamp(state.ewrcProgress || 0, 0, 1);
  if (state.ewrcState !== "none" && state.ewrcState !== "completed" && ewrc > 0.01) {
    const outerRmw = rmw * (1.9 + 1.0 * ewrc);
    const sigma = Math.max(8, outerRmw * 0.24);
    const outerPeak = state.vmax * (0.38 + 0.48 * ewrc) * Math.exp(-0.5 * ((r - outerRmw) / sigma) ** 2);
    const moat = 1 - (0.18 + 0.18 * ewrc) * Math.exp(-0.5 * ((r - rmw * 1.45) / Math.max(8, rmw * 0.28)) ** 2);
    target = Math.max(target * moat, outerPeak);
  }

  // 椭圆/波数 2 结构随 EWRC、风切和温带化程度增强。
  const theta = Math.atan2(yKm, xKm);
  const shearDir = Math.atan2(environment.shearV || 0, environment.shearU || 0);
  const shearMag = Math.hypot(environment.shearU || 0, environment.shearV || 0);
  const axisymmetry = 1 - 0.58 * smooth01(((state.vmax || 0) - 24) / 28);
  const ellipse = clamp((
    0.026 + 0.050 * ewrc + 0.032 * clamp(shearMag / 25, 0, 1)
    + 0.115 * baroclinicShape * (0.30 + 0.70 * weakBaroclinicResponse)
  ) * axisymmetry, 0.016, 0.20);
  target *= 1 + ellipse * Math.cos(2 * (theta - 0.35 * shearDir));

  // Deterministic wave-3 / wave-4 structure gives the broad lumpy, evolving footprint visible in
  // gridded forecast products without allowing one quadrant radius to flatten an entire side.
  // The mature eyewall remains comparatively axisymmetric; irregularity grows in the outer core,
  // with shear, ET and terrain-damage memory.
  const irregularGate = smooth01((rawR - rmw * 0.72) / Math.max(18, rmw * 1.25))
    * (1 - 0.45 * smooth01((rawR - r7Mean * 1.7) / Math.max(80, r7Mean)));
  const temporalPhase = ((state.simHour || 0) * 4.7 + (state.direction || 0) * 0.55) * DEG;
  const irregularAmp = clamp(
    0.020 + 0.025 * clamp(shearMag / 22, 0, 1) + 0.035 * baroclinicShape + 0.028 * damage,
    0.018, 0.095
  ) * (1 - 0.48 * strongCore);
  target *= 1 + irregularGate * irregularAmp * (
    0.62 * Math.cos(3 * theta + temporalPhase + 0.25 * shearDir)
    + 0.38 * Math.cos(4 * theta - temporalPhase * 0.7)
  );
  if (damage > 0.04) {
    const damagedSector = Math.max(0, Math.cos(bearingRadForShape - hollowBearing));
    const hollowGate = Math.exp(-0.5 * ((rawR - rmw * 1.05) / Math.max(12, rmw * 0.72)) ** 2);
    target *= 1 - 0.16 * damage * damagedSector * hollowGate;
  }

  // 平移不对称：叠加部分台风移动速度，使北半球右前侧自然增强。
  const motionMs = Math.max(0, state.speed || 0) / 3.6;
  const dir = (state.direction || 0) * DEG;
  const translationFraction = 0.46 - 0.08 * strongCore;
  const transU = Math.sin(dir) * motionMs * translationFraction;
  const transV = Math.cos(dir) * motionMs * translationFraction;
  const translationWeight = Math.exp(-rawR / Math.max(140, r7Mean * 1.8));

  // 风切诱导波数 1 不对称，并限幅以便边界层求解后仍可校准 Vmax。
  const shearProjection = shearMag > 0.2 ? Math.cos(theta - shearDir - Math.PI / 2) : 0;
  const shearAsymmetry = 0.060 * (1 - 0.62 * strongCore);
  target *= 1 + shearAsymmetry * clamp(shearMag / 20, 0, 1.2) * shearProjection;

  // 温带化扩大并重排风场。增强象限随移动/深层风切轴旋转，而不是固定压向东南侧；
  // 外围风场会逐步形成宽阔的非对称温带气旋形态，内核则同步衰减。
  if (et > 0) {
    const bearingRad = bearingDeg * DEG;
    const strongSideBearing = baroclinicBearing + 82 * DEG;
    const broadOuter = smooth01((rawR - rmw * 1.08) / Math.max(30, rmw * 2.7));
    const asymmetricStage = clamp(0.58 * subtropicalPhase + frontalPhase, 0, 1);
    target *= 1 + (0.08 + 0.18 * broadOuter) * asymmetricStage * Math.cos(bearingRad - strongSideBearing);
    target *= 1 + (0.08 * subtropicalPhase + 0.13 * frontalPhase) * broadOuter;
    target *= 1 - (0.10 * subtropicalPhase + 0.24 * frontalPhase) * Math.exp(-rawR / Math.max(65, rmw * 2.6));
  }

  if (state.dissipated) target *= 0.18;
  target = Math.max(0, target) * farFieldWeight;

  const hemisphere = state.lat >= 0 ? 1 : -1;
  const radialNorm = Math.max(1e-9, Math.hypot(xKm, yKm));
  const radialX = xKm / radialNorm;
  const radialY = yKm / radialNorm;
  // In the Northern Hemisphere this is explicitly counter-clockwise: east of the eye the
  // tangential vector points north, north of the eye it points west. Southern Hemisphere reverses.
  const tangentialX = -radialY * hemisphere;
  const tangentialY = radialX * hemisphere;
  const inflowAngle = (12 + 12 * smooth01((rawR - rmw) / Math.max(40, r7Mean))) * DEG;
  // TyphoonState.vmax 与风圈阈值都是 10 m 风口径；slab 初值先补偿典型海面
  // 10 m 折减，随后仍由真实粗糙度和边界层求解决定最终地面风。
  const slabTransferReference = 0.86;
  const slabTarget = target / slabTransferReference;
  const tangentialMs = slabTarget * Math.cos(inflowAngle);
  const radialInflowMs = -slabTarget * Math.sin(inflowAngle);
  const u = tangentialX * tangentialMs + radialX * radialInflowMs + transU * translationWeight / slabTransferReference;
  const v = tangentialY * tangentialMs + radialY * radialInflowMs + transV * translationWeight / slabTransferReference;

  return { distanceKm: rawR, pressureHpa, pressureAnomalyHpa, u, v, tangentialMs, radialInflowMs, quadrantScale, farFieldWeight };
}
