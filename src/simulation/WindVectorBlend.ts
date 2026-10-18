const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth01 = (v: number) => {
  const x = clamp(v, 0, 1);
  return x * x * (3 - 2 * x);
};

export interface CycloneVectorBlendInput {
  backgroundU: number;
  backgroundV: number;
  vortexU: number;
  vortexV: number;
  distanceKm: number;
  captureInnerKm: number;
  captureOuterKm: number;
}

export interface CycloneVectorBlendResult {
  u: number;
  v: number;
  capture: number;
  speedMs: number;
}

function shortestAngleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Turns environmental flow progressively into the cyclone circulation without first deleting the
 * background vector. This prevents vector-cancellation "vacuum cleaner" calms and keeps a mature
 * cyclone from being flattened by a 10-15 kt background current on one side.
 */
export function blendEnvironmentIntoCyclone(input: CycloneVectorBlendInput): CycloneVectorBlendResult {
  const bu = Number.isFinite(input.backgroundU) ? input.backgroundU : 0;
  const bv = Number.isFinite(input.backgroundV) ? input.backgroundV : 0;
  const vu = Number.isFinite(input.vortexU) ? input.vortexU : 0;
  const vv = Number.isFinite(input.vortexV) ? input.vortexV : 0;
  const bSpeed = Math.hypot(bu, bv);
  const vSpeed = Math.hypot(vu, vv);
  if (vSpeed < 0.02) return { u: bu, v: bv, capture: 0, speedMs: bSpeed };
  if (bSpeed < 0.02) return { u: vu, v: vv, capture: 1, speedMs: vSpeed };

  const inner = Math.max(1, input.captureInnerKm);
  const outer = Math.max(inner + 1, input.captureOuterKm);
  const radialCapture = 1 - smooth01((input.distanceKm - inner) / (outer - inner));
  const strengthCapture = smooth01((vSpeed - 0.30 * bSpeed) / Math.max(2.0, 1.25 * bSpeed));
  // ROUND111: capture must be spatially bounded. The previous 72% strength-only term could keep a
  // powerful vortex "capturing" environmental flow almost independently of radius, stretching a
  // monsoon/background current into a long one-sided orange/red wedge. Strength now modulates the
  // radial envelope instead of bypassing it, so capture is exactly zero at/beyond captureOuterKm.
  const capture = clamp(radialCapture * (0.34 + 0.66 * strengthCapture), 0, 1);

  const bgAngle = Math.atan2(bv, bu);
  const vortexAngle = Math.atan2(vv, vu);
  const delta = shortestAngleDelta(bgAngle, vortexAngle);
  // Direction starts bending outside the core but also remains strictly inside the same radial
  // capture envelope. This removes narrow directional "spokes" at the outer circulation edge.
  const turn = clamp(radialCapture * (0.18 + 0.82 * strengthCapture), 0, 1);
  const angle = bgAngle + delta * turn;

  // ROUND111: avoid root-sum-square speed inflation. RSS treated background and vortex kinetic
  // energy as independent even after their directions had already been merged, producing a fast
  // jet wherever an organized monsoon current overlapped one cyclone quadrant. Preserve the
  // diagnosed vortex magnitude through almost the entire circulation, then taper it smoothly only
  // in the outermost capture annulus. This keeps operational wind-radius guidance intact without
  // letting the background current add an artificial second reservoir of kinetic energy.
  const dominantSpeed = Math.max(vSpeed, bSpeed);
  const speedCapture = smooth01(radialCapture / 0.18);
  let speed = bSpeed * (1 - speedCapture) + dominantSpeed * speedCapture;
  const alignment = Math.max(0, Math.cos(delta));
  const transitionWindow = 4 * speedCapture * (1 - speedCapture);
  const constructive = 0.06 * Math.min(vSpeed, bSpeed) * alignment * transitionWindow;
  speed += constructive;
  const maxPhysical = dominantSpeed + 0.06 * Math.min(vSpeed, bSpeed);
  speed = Math.min(speed, maxPhysical);
  // Never manufacture the old vector-cancellation annular calm.
  const minimumTransitionSpeed = bSpeed * (1 - 0.03 * speedCapture);
  speed = Math.max(speed, minimumTransitionSpeed);

  return { u: Math.cos(angle) * speed, v: Math.sin(angle) * speed, capture, speedMs: speed };
}
