const DEG = Math.PI / 180;
const EARTH_M_PER_DEG = 111_120;
const RHO_AIR = 1.17;
const OMEGA = 7.2921159e-5;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };

export interface BoundaryLayerGridGeometry {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  stepDeg: number;
}

export interface BoundaryLayerSurfaceFields {
  dragCoefficient: Float32Array;
  boundaryLayerDepthM: Float32Array;
  terrainPenalty: Float32Array;
  terrainDeflectX: Float32Array;
  terrainDeflectY: Float32Array;
  isLand?: Uint8Array;
  elevationM?: Float32Array;
  localReliefM?: Float32Array;
  slopeEastMPerKm?: Float32Array;
  slopeNorthMPerKm?: Float32Array;
  /** 0..1 resolved lee-wake strength diagnosed from upstream terrain and the incoming flow. */
  terrainWake?: Float32Array;
}

export interface BoundaryLayerDiagnostics {
  divergence: Float32Array;
  verticalVelocity: Float32Array;
  inflowAngleDeg: Float32Array;
  iterations: number;
  residualMs: number;
}

export interface BoundaryLayerSolution {
  u: Float32Array;
  v: Float32Array;
  diagnostics: BoundaryLayerDiagnostics;
}

export interface BoundaryLayerStormCenter {
  lat: number;
  lon: number;
  protectionRadiusKm?: number;
}

export interface BoundaryLayerSolverOptions {
  geometry: BoundaryLayerGridGeometry;
  slpHpa: Float32Array;
  initialU: Float32Array;
  initialV: Float32Array;
  surface: BoundaryLayerSurfaceFields;
  stormCenters?: BoundaryLayerStormCenter[];
  /** 主台风平移速度；只用于半拉格朗日平流的台风相对坐标。 */
  frameMotion?: { u: number; v: number };
  maxIterations?: number;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
}

async function yieldToUi(signal?: AbortSignal) {
  assertNotAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertNotAborted(signal);
}

const schedulerNowMs = () => (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : Date.now();

/**
 * Cooperative ~8 ms time slicer for mobile/browser generation. The numerical loop stays fully
 * deterministic because yielding never changes iteration order or values; it only lets paint,
 * input and the live fixed-step simulator run between row blocks.
 */
function createUiTimeSlicer(signal?: AbortSignal, budgetMs = 8) {
  let sliceStart = schedulerNowMs();
  return async (force = false) => {
    assertNotAborted(signal);
    if (!force && schedulerNowMs() - sliceStart < budgetMs) return;
    await yieldToUi(signal);
    sliceStart = schedulerNowMs();
  };
}

function bilinear(field: Float32Array, x: number, y: number, nx: number, ny: number): number {
  const xx = clamp(x, 0, nx - 1.001);
  const yy = clamp(y, 0, ny - 1.001);
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1);
  const tx = xx - x0, ty = yy - y0;
  const a = field[y0 * nx + x0] * (1 - tx) + field[y0 * nx + x1] * tx;
  const b = field[y1 * nx + x0] * (1 - tx) + field[y1 * nx + x1] * tx;
  return a * (1 - ty) + b * ty;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  const a0 = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const a1 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const a2 = -0.5 * p0 + 0.5 * p2;
  return ((a0 * t + a1) * t + a2) * t + p1;
}

/**
 * Catmull-Rom 半拉格朗日采样，并把结果限制在邻近 4 点包络内。
 * 这样 0.10°/0.125° 高精度模式能保留眼墙与山地风影细节，又不会出现插值过冲。
 */
function bicubicClamped(field: Float32Array, x: number, y: number, nx: number, ny: number): number {
  const xx = clamp(x, 0, nx - 1.001);
  const yy = clamp(y, 0, ny - 1.001);
  const ix = Math.floor(xx), iy = Math.floor(yy), tx = xx - ix, ty = yy - iy;
  const rows = new Array<number>(4);
  for (let m = -1; m <= 2; m++) {
    const yy0 = clamp(iy + m, 0, ny - 1);
    const p = new Array<number>(4);
    for (let q = -1; q <= 2; q++) p[q + 1] = field[yy0 * nx + clamp(ix + q, 0, nx - 1)];
    rows[m + 1] = cubic(p[0], p[1], p[2], p[3], tx);
  }
  const raw = cubic(rows[0], rows[1], rows[2], rows[3], ty);
  const x1 = Math.min(nx - 1, ix + 1), y1 = Math.min(ny - 1, iy + 1);
  const a = field[iy * nx + ix], b = field[iy * nx + x1], c = field[y1 * nx + ix], d = field[y1 * nx + x1];
  return clamp(raw, Math.min(a, b, c, d), Math.max(a, b, c, d));
}

function sampleVelocity(field: Float32Array, x: number, y: number, nx: number, ny: number, highOrder: boolean) {
  return highOrder ? bicubicClamped(field, x, y, nx, ny) : bilinear(field, x, y, nx, ny);
}

function bilinearMaskFraction(mask: Uint8Array, x: number, y: number, nx: number, ny: number): number {
  const xx = clamp(x, 0, nx - 1.001), yy = clamp(y, 0, ny - 1.001);
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1);
  const tx = xx - x0, ty = yy - y0;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  return mask[y0 * nx + x0] * w00 + mask[y0 * nx + x1] * w10 + mask[y1 * nx + x0] * w01 + mask[y1 * nx + x1] * w11;
}

function sampleOceanOnlyBilinear(field: Float32Array, mask: Uint8Array, x: number, y: number, nx: number, ny: number): number | null {
  const xx = clamp(x, 0, nx - 1.001), yy = clamp(y, 0, ny - 1.001);
  const x0 = Math.floor(xx), y0 = Math.floor(yy);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1);
  const tx = xx - x0, ty = yy - y0;
  const cells = [
    [x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]
  ] as const;
  let sum = 0, weight = 0;
  for (const [cx, cy, w] of cells) {
    const k = cy * nx + cx;
    if (mask[k] || w <= 0) continue;
    sum += field[k] * w; weight += w;
  }
  if (weight > 0.08) return sum / weight;
  // If the back-trace lands just inside a tiny island, use the nearest surrounding ocean cell
  // rather than transporting the island's friction-reduced momentum far downstream.
  const ci = Math.round(xx), cj = Math.round(yy);
  for (let radius = 1; radius <= 2; radius++) {
    let best: number | null = null, bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const px = ci + dx, py = cj + dy;
      if (px < 0 || px >= nx || py < 0 || py >= ny) continue;
      const k = py * nx + px;
      if (mask[k]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = field[k]; }
    }
    if (best !== null) return best;
  }
  return null;
}

function sampleVelocityForTargetSurface(
  field: Float32Array, x: number, y: number, nx: number, ny: number, highOrder: boolean,
  landMask: Uint8Array | undefined, targetIsLand: boolean
): number {
  const raw = sampleVelocity(field, x, y, nx, ny, highOrder);
  // Preserve onshore marine inflow for land cells. The artifact occurs in the opposite direction:
  // slow, repeatedly dragged island/land cells being numerically advected back out over the ocean.
  if (!landMask || targetIsLand) return raw;
  const landFraction = bilinearMaskFraction(landMask, x, y, nx, ny);
  if (landFraction <= 0.015) return raw;
  const ocean = sampleOceanOnlyBilinear(field, landMask, x, y, nx, ny);
  if (ocean === null) return raw;
  const guard = smooth01((landFraction - 0.015) / 0.42);
  return raw * (1 - guard) + ocean * guard;
}

function wrapLonDelta(lon: number, ref: number) {
  let d = lon - ref;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function nearestStormDistanceDeg(lat: number, lon: number, centers: BoundaryLayerStormCenter[] | undefined) {
  if (!centers?.length) return Infinity;
  let best = Infinity;
  for (const c of centers) {
    const dx = wrapLonDelta(lon, c.lon) * Math.max(0.2, Math.cos(lat * DEG));
    const dy = lat - c.lat;
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

function nearestStormProtection(lat: number, lon: number, centers: BoundaryLayerStormCenter[] | undefined) {
  if (!centers?.length) return 0;
  let best = 0;
  for (const c of centers) {
    const dxKm = wrapLonDelta(lon, c.lon) * 111.12 * Math.max(0.2, Math.cos(lat * DEG));
    const dyKm = (lat - c.lat) * 111.12;
    const rKm = Math.hypot(dxKm, dyKm);
    const outer = Math.max(120, c.protectionRadiusKm || 260);
    const inner = Math.max(55, outer * 0.42);
    const p = 1 - clamp((rKm - inner) / Math.max(25, outer - inner), 0, 1);
    const smooth = p * p * (3 - 2 * p);
    if (smooth > best) best = smooth;
  }
  return best;
}

function nearestStormInflowAngle(
  lat: number,
  lon: number,
  u: number,
  v: number,
  centers: BoundaryLayerStormCenter[] | undefined
): number {
  if (!centers?.length || Math.hypot(u, v) < 0.1) return 0;
  let best: { dx: number; dy: number; r2: number } | null = null;
  for (const c of centers) {
    const dx = wrapLonDelta(lon, c.lon) * Math.max(0.2, Math.cos(lat * DEG));
    const dy = lat - c.lat;
    const r2 = dx * dx + dy * dy;
    if (!best || r2 < best.r2) best = { dx, dy, r2 };
  }
  if (!best || best.r2 < 1e-8) return 0;
  const r = Math.sqrt(best.r2);
  const rx = best.dx / r, ry = best.dy / r;
  const hemisphere = lat >= 0 ? 1 : -1;
  const tx = -ry * hemisphere, ty = rx * hemisphere;
  const tang = u * tx + v * ty;
  const inward = -(u * rx + v * ry);
  return Math.atan2(Math.max(-50, inward), Math.max(0.1, Math.abs(tang))) / DEG;
}

function pressureGradient(
  slpHpa: Float32Array,
  k: number,
  i: number,
  j: number,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  highOrder: boolean
) {
  if (highOrder && i >= 2 && i <= nx - 3 && j >= 2 && j <= ny - 3) {
    // 四阶中心差分：细网格下明显减少格点方向性，台风近核等压线/风场更平滑。
    const dpdx = (-slpHpa[k + 2] + 8 * slpHpa[k + 1] - 8 * slpHpa[k - 1] + slpHpa[k - 2]) * 100 / (12 * dx);
    const dpdy = (-slpHpa[k + 2 * nx] + 8 * slpHpa[k + nx] - 8 * slpHpa[k - nx] + slpHpa[k - 2 * nx]) * 100 / (12 * dy);
    return { x: dpdx, y: dpdy };
  }
  const dpdx = (slpHpa[k + 1] - slpHpa[k - 1]) * 100 / (2 * dx);
  const dpdy = (slpHpa[k + nx] - slpHpa[k - nx]) * 100 / (2 * dy);
  return { x: dpdx, y: dpdy };
}

/**
 * 5.2.31 高精度二维 slab 边界层求解器。
 *
 * 相比 5.2.29：
 * - 0.25°及更细网格使用 RK2 反向追踪 + 有界 Catmull-Rom 采样；
 * - 气压梯度改用四阶中心差分；
 * - slab 与上方压力平衡风持续交换动量，避免陆地阻力在“数值迭代次数”上重复把强台风耗散到 0；
 * - 山地用 Froude/Brinkman 绕流，并加入沿来流方向向下游衰减的背风坡尾流；平原摩擦进一步减弱；
 * - 投影在台风内核自动减弱，保留真实低层辐合与眼墙涡度。
 */
export async function solveWindBoundaryLayer(options: BoundaryLayerSolverOptions): Promise<BoundaryLayerSolution> {
  const { geometry, slpHpa, initialU, initialV, surface, signal } = options;
  const { nx, ny, lon0, lat0, stepDeg } = geometry;
  const n = nx * ny;
  if (slpHpa.length !== n || initialU.length !== n || initialV.length !== n) throw new Error("Boundary-layer grid size mismatch");
  assertNotAborted(signal);
  const maybeYield = createUiTimeSlicer(signal, 8);

  const highOrder = stepDeg <= 0.25;
  let u = new Float32Array(initialU);
  let v = new Float32Array(initialV);
  let nextU = new Float32Array(n);
  let nextV = new Float32Array(n);
  const pressureAx = new Float32Array(n);
  const pressureAy = new Float32Array(n);

  for (let j = 1; j < ny - 1; j++) {
    const lat = lat0 + j * stepDeg;
    const dx = EARTH_M_PER_DEG * stepDeg * Math.max(0.15, Math.cos(lat * DEG));
    const dy = EARTH_M_PER_DEG * stepDeg;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const grad = pressureGradient(slpHpa, k, i, j, nx, ny, dx, dy, highOrder);
      pressureAx[k] = clamp(-grad.x / RHO_AIR, -0.030, 0.030);
      pressureAy[k] = clamp(-grad.y / RHO_AIR, -0.030, 0.030);
    }
    await maybeYield();
  }

  const defaultIterations = stepDeg <= 0.1 ? 150 : stepDeg <= 0.125 ? 132 : stepDeg <= 0.25 ? 104 : 72;
  const maxIterations = clamp(options.maxIterations ?? defaultIterations, 60, 180);
  let residual = Infinity;
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    assertNotAborted(signal);
    residual = 0;
    let maxWind = 8;
    for (let k = 0; k < n; k += 23) maxWind = Math.max(maxWind, Math.hypot(u[k], v[k]));
    const gridM = EARTH_M_PER_DEG * stepDeg;
    const dt = clamp((highOrder ? 0.54 : 0.62) * gridM / Math.max(8, maxWind), 34, highOrder ? 150 : 210);

    for (let j = 0; j < ny; j++) {
      const lat = lat0 + j * stepDeg;
      const cosLat = Math.max(0.15, Math.cos(lat * DEG));
      const f = 2 * OMEGA * Math.sin(lat * DEG);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
          nextU[k] = initialU[k];
          nextV[k] = initialV[k];
          continue;
        }

        const frameU = options.frameMotion?.u || 0;
        const frameV = options.frameMotion?.v || 0;
        const cellDx = EARTH_M_PER_DEG * stepDeg * cosLat;
        const cellDy = EARTH_M_PER_DEG * stepDeg;
        const coreProtection = nearestStormProtection(lat, lon0 + i * stepDeg, options.stormCenters);

        // RK2 半拉格朗日回溯。第一步估计半步位置，再在半步位置采样速度完成完整回溯。
        const halfX = i - ((u[k] - frameU) * dt * 0.5) / cellDx;
        const halfY = j - ((v[k] - frameV) * dt * 0.5) / cellDy;
        const targetIsLand = !!surface.isLand?.[k];
        const midU = sampleVelocityForTargetSurface(u, halfX, halfY, nx, ny, highOrder, surface.isLand, targetIsLand);
        const midV = sampleVelocityForTargetSurface(v, halfX, halfY, nx, ny, highOrder, surface.isLand, targetIsLand);
        const backX = i - ((midU - frameU) * dt) / cellDx;
        const backY = j - ((midV - frameV) * dt) / cellDy;
        let uu = sampleVelocityForTargetSurface(u, backX, backY, nx, ny, highOrder, surface.isLand, targetIsLand);
        let vv = sampleVelocityForTargetSurface(v, backX, backY, nx, ny, highOrder, surface.isLand, targetIsLand);

        const halfAng = 0.5 * f * dt;
        const hca = Math.cos(halfAng), hsa = Math.sin(halfAng);
        const hu = uu * hca + vv * hsa;
        const hv = vv * hca - uu * hsa;
        uu = hu; vv = hv;

        uu += pressureAx[k] * dt * 0.74;
        vv += pressureAy[k] * dt * 0.74;

        // 边界层与上方压力平衡流的机械交换。强风/深混合层交换更快；这是持续物理强迫，
        // 而不是每次迭代重新“钉死”初值，能避免陆地大风被伪时间阻力无限累乘衰减。
        const isLand = !!surface.isLand?.[k];
        const freeSpeed = Math.hypot(initialU[k], initialV[k]);
        const h = clamp(surface.boundaryLayerDepthM[k], 420, 1350);
        const couplingTau = isLand
          ? clamp(3300 - 30 * freeSpeed - 0.7 * (h - 700), 1250, 3300)
          : clamp(5200 - 20 * freeSpeed, 2600, 5200);
        const coupling = clamp(dt / couplingTau, 0.012, isLand ? 0.095 : 0.060) * (1 - 0.42 * coreProtection);
        uu += (initialU[k] - uu) * coupling;
        vv += (initialV[k] - vv) * coupling;

        const penalty = clamp(surface.terrainPenalty[k], 0, 1);
        if (penalty > 0.001) {
          const tx = surface.terrainDeflectX[k], ty = surface.terrainDeflectY[k];
          const tangent = uu * tx + vv * ty;
          const defU = tangent * tx;
          const defV = tangent * ty;
          const relief = surface.localReliefM?.[k] || 0;
          const blend = clamp(penalty * dt / (isLand ? 900 : 650) * (0.62 + 0.32 * clamp(relief / 1200, 0, 1)), 0, 0.38)
            * (1 - 0.72 * coreProtection);
          uu += (defU - uu) * blend;
          vv += (defV - vv) * blend;
        }

        // 背风坡/岛屿尾流：terrainWake 是由上游真实地形沿当前来流方向诊断的有限长度风影。
        // 这里把它作为边界层动量交换的一部分，而不是渲染层直接乘色块，因此尾流会和压强梯度、
        // 科氏力及平流共同演化。离开障碍物后 terrainWake 自身指数衰减，风速自然恢复。
        const wake = clamp(surface.terrainWake?.[k] || 0, 0, 1) * (1 - 0.88 * coreProtection);
        if (wake > 0.002) {
          const wakeTargetFactor = 1 - 0.46 * wake;
          const wakeTau = 780 + 920 * (1 - wake);
          const wakeBlend = clamp((dt / wakeTau) * (0.48 + 0.72 * wake), 0, 0.15);
          uu += (initialU[k] * wakeTargetFactor - uu) * wakeBlend;
          vv += (initialV[k] * wakeTargetFactor - vv) * wakeBlend;
        }

        // 解析地形坡度产生的有限绕流/下坡加速。仅在真实 ETOPO 坡度存在时生效。
        const sx = surface.slopeEastMPerKm?.[k] || 0;
        const sy = surface.slopeNorthMPerKm?.[k] || 0;
        const slopeMag = Math.hypot(sx, sy);
        const reliefForAcceleration = surface.localReliefM?.[k] || 0;
        const mountainAccelerationGate = clamp((reliefForAcceleration - 180) / 720, 0, 1);
        if (isLand && slopeMag > 0.20 && mountainAccelerationGate > 0.001) {
          const sp = Math.max(1, Math.hypot(uu, vv));
          const alongSlope = (uu * sx + vv * sy) / sp;
          const terrainAccel = clamp(-alongSlope * 0.000035, -0.0018, 0.0018) * mountainAccelerationGate;
          uu += terrainAccel * dt * (sx / slopeMag);
          vv += terrainAccel * dt * (sy / slopeMag);
        }

        // 高精度网格使用更弱数值扩散，保留山地风影与眼墙细节。
        const lapU = u[k - 1] + u[k + 1] + u[k - nx] + u[k + nx] - 4 * u[k];
        const lapV = v[k - 1] + v[k + 1] + v[k - nx] + v[k + nx] - 4 * v[k];
        const diffusion = (stepDeg <= 0.125 ? 0.007 : stepDeg <= 0.25 ? 0.010 : 0.017) * (1 - 0.64 * coreProtection);
        uu += lapU * diffusion;
        vv += lapV * diffusion;

        const speed = Math.hypot(uu, vv);
        const cd = clamp(surface.dragCoefficient[k], 4e-4, isLand ? 0.0072 : 0.0030);
        const drag = 1 / (1 + dt * cd * speed / h);
        uu *= drag;
        vv *= drag;

        const fu = uu * hca + vv * hsa;
        const fv = vv * hca - uu * hsa;
        uu = fu; vv = fv;

        nextU[k] = uu;
        nextV[k] = vv;
        residual = Math.max(residual, Math.hypot(uu - u[k], vv - v[k]));
      }
      await maybeYield();
    }

    [u, nextU] = [nextU, u];
    [v, nextV] = [nextV, v];
    iterations = iter + 1;
    options.onProgress?.(58 + 22 * (iterations / maxIterations));
    if (iter % (stepDeg <= 0.125 ? 4 : 6) === (stepDeg <= 0.125 ? 3 : 5)) await maybeYield(true);
    if (iterations >= Math.min(72, maxIterations) && residual < (stepDeg <= 0.125 ? 0.035 : 0.05)) break;
  }

  // 弱 Helmholtz/Poisson 投影：远场去除虚假散度，台风近核保留低层辐合。
  const divergence = new Float32Array(n);
  const phi = new Float32Array(n);
  const phiNext = new Float32Array(n);
  for (let j = 1; j < ny - 1; j++) {
    const lat = lat0 + j * stepDeg;
    const dx = EARTH_M_PER_DEG * stepDeg * Math.max(0.15, Math.cos(lat * DEG));
    const dy = EARTH_M_PER_DEG * stepDeg;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      divergence[k] = (u[k + 1] - u[k - 1]) / (2 * dx) + (v[k + nx] - v[k - nx]) / (2 * dy);
    }
    await maybeYield();
  }
  const avgGridM = EARTH_M_PER_DEG * stepDeg;
  const poissonIterations = stepDeg <= 0.125 ? 28 : 20;
  for (let it = 0; it < poissonIterations; it++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        phiNext[k] = 0.25 * (phi[k - 1] + phi[k + 1] + phi[k - nx] + phi[k + nx] - divergence[k] * avgGridM * avgGridM);
      }
      await maybeYield();
    }
    phi.set(phiNext);
    await maybeYield();
  }
  for (let j = 1; j < ny - 1; j++) {
    const lat = lat0 + j * stepDeg;
    const dx = EARTH_M_PER_DEG * stepDeg * Math.max(0.15, Math.cos(lat * DEG));
    const dy = EARTH_M_PER_DEG * stepDeg;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const lon = lon0 + i * stepDeg;
      const coreProtection = nearestStormProtection(lat, lon, options.stormCenters);
      const projectionStrength = 0.26 - 0.23 * coreProtection;
      u[k] -= projectionStrength * (phi[k + 1] - phi[k - 1]) / (2 * dx);
      v[k] -= projectionStrength * (phi[k + nx] - phi[k - nx]) / (2 * dy);
    }
    await maybeYield();
  }

  const verticalVelocity = new Float32Array(n);
  const inflowAngleDeg = new Float32Array(n);
  for (let j = 1; j < ny - 1; j++) {
    const lat = lat0 + j * stepDeg;
    const dx = EARTH_M_PER_DEG * stepDeg * Math.max(0.15, Math.cos(lat * DEG));
    const dy = EARTH_M_PER_DEG * stepDeg;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const div = (u[k + 1] - u[k - 1]) / (2 * dx) + (v[k + nx] - v[k - nx]) / (2 * dy);
      divergence[k] = div;
      verticalVelocity[k] = -surface.boundaryLayerDepthM[k] * div;
      inflowAngleDeg[k] = nearestStormInflowAngle(lat, lon0 + i * stepDeg, u[k], v[k], options.stormCenters);
    }
    await maybeYield();
  }
  options.onProgress?.(81);
  return { u, v, diagnostics: { divergence, verticalVelocity, inflowAngleDeg, iterations, residualMs: residual } };
}
