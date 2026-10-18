export type EyeBrightnessInputs = {
  predictedEyeVmax: number;
  eyeWarmCore: number;
  eyeClearance: number;
  eyeObstruction: number;
  convectiveBurstIndex: number;
  secondaryEyewallStrength: number;
  landEyeStress: number;
  dryAirCoreExposure: number;
  structureMode?: string;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep01 = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/**
 * Diagnose simulated geostationary-IR eye brightness temperature (°C).
 *
 * This is intentionally a brightness-temperature diagnostic, not a surface thermometer.
 * Cloud-filled/convectively obscured eyes may remain below 0 °C.  A mature, clear, warm-core
 * intense-typhoon eye, however, should rapidly expose much warmer lower-tropospheric emission and
 * therefore should not remain unrealistically stuck at large negative values.
 */
export function computeEyeBrightnessTarget(input: EyeBrightnessInputs): number {
  const {
    predictedEyeVmax,
    eyeWarmCore,
    eyeClearance,
    eyeObstruction,
    convectiveBurstIndex,
    secondaryEyewallStrength,
    landEyeStress,
    dryAirCoreExposure,
    structureMode = ""
  } = input;

  let target = -45.0
    + 20.0 * eyeWarmCore
    + 43.0 * eyeClearance
    - 21.0 * eyeObstruction
    - 31.0 * convectiveBurstIndex
    - 7.0 * secondaryEyewallStrength
    - 5.0 * landEyeStress;

  if (structureMode === "terrain_hollow_bands" || structureMode === "rainband_dominant") target -= 6.0;
  if (structureMode === "terrain_clogged_loose") target -= 10.0;
  if (structureMode === "terrain_displaced_core") target -= 7.0;
  if (structureMode === "dry_slot_eroding") target -= 4.5 * dryAirCoreExposure;
  if (structureMode === "dry_leaf" || structureMode === "incense_coil") target -= 11.0;
  if (structureMode === "dry_rebuilding_core") target -= 8.0;

  // Once a strong eye clears, subsidence/warm-core emission becomes visible very quickly.
  const intenseEye = smoothstep01((predictedEyeVmax - 48.0) / 18.0);
  const exposedWarmEye = intenseEye
    * (0.22 + 0.78 * eyeClearance)
    * (0.48 + 0.52 * eyeWarmCore)
    * (1.0 - 0.72 * eyeObstruction)
    * (1.0 - 0.58 * convectiveBurstIndex);
  target += 28.0 * Math.max(0, exposedWarmEye);

  if (eyeClearance > 0.70 && convectiveBurstIndex < 0.25) {
    target += 10.0 * eyeWarmCore;
  }

  // A mature clear super-typhoon eye should not remain anomalously cold merely because the
  // previous brightness state was cloud-filled.  Keep the floor conditional so an obscured or
  // EWRC-filled centre can still legitimately be negative.
  if (
    predictedEyeVmax >= 51.0 &&
    eyeClearance >= 0.42 &&
    eyeWarmCore >= 0.56 &&
    eyeObstruction <= 0.58 &&
    convectiveBurstIndex <= 0.52
  ) {
    const warmFloor = 1.5
      + 20.0 * eyeClearance
      + 9.0 * eyeWarmCore
      - 10.0 * convectiveBurstIndex
      - 5.0 * landEyeStress
      - 4.0 * secondaryEyewallStrength;
    target = Math.max(target, warmFloor);
  }

  if (predictedEyeVmax < 31.5) {
    target = -50.0 + 8.0 * eyeWarmCore - 22.0 * convectiveBurstIndex;
  }

  return Math.max(-84.0, Math.min(32.0, target));
}

export function eyeBrightnessRelaxationHours(current: number | undefined, target: number, predictedEyeVmax: number, eyeClearance: number): number {
  const previous = current ?? target;
  if (target < previous) return 1.5;
  // Opening/warming eyes should not take several simulation hours to catch up with the diagnosed
  // clear-eye state. Strong clear eyes react fastest, while weaker/ragged eyes retain inertia.
  if (predictedEyeVmax >= 51 && eyeClearance >= 0.42) return 1.6;
  if (predictedEyeVmax >= 41 && eyeClearance >= 0.30) return 2.4;
  return 3.8;
}
