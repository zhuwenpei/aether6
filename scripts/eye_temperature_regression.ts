import { computeEyeBrightnessTarget, eyeBrightnessRelaxationHours } from "../src/simulation/EyeThermodynamics";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const clearSuper = computeEyeBrightnessTarget({
  predictedEyeVmax: 61,
  eyeWarmCore: 0.86,
  eyeClearance: 0.72,
  eyeObstruction: 0.24,
  convectiveBurstIndex: 0.20,
  secondaryEyewallStrength: 0.06,
  landEyeStress: 0.02,
  dryAirCoreExposure: 0.08,
  structureMode: "compact_symmetric"
});
assert(clearSuper > 5, `clear super-typhoon eye should be warm, got ${clearSuper.toFixed(1)}°C`);

const cloudFilledSuper = computeEyeBrightnessTarget({
  predictedEyeVmax: 59,
  eyeWarmCore: 0.72,
  eyeClearance: 0.14,
  eyeObstruction: 0.82,
  convectiveBurstIndex: 0.78,
  secondaryEyewallStrength: 0.55,
  landEyeStress: 0.04,
  dryAirCoreExposure: 0.05,
  structureMode: "rainband_dominant"
});
assert(cloudFilledSuper < 0, `cloud-filled intense eye should still be allowed to be cold, got ${cloudFilledSuper.toFixed(1)}°C`);

const weakSystem = computeEyeBrightnessTarget({
  predictedEyeVmax: 24,
  eyeWarmCore: 0.35,
  eyeClearance: 0.05,
  eyeObstruction: 0.75,
  convectiveBurstIndex: 0.45,
  secondaryEyewallStrength: 0,
  landEyeStress: 0,
  dryAirCoreExposure: 0.2,
  structureMode: ""
});
assert(weakSystem < -45, `weak system should not get a false warm eye, got ${weakSystem.toFixed(1)}°C`);

assert(eyeBrightnessRelaxationHours(-20, clearSuper, 61, 0.72) <= 1.6, "clear super-typhoon eye warming should relax quickly");
console.log("eye temperature regression: PASS", { clearSuper, cloudFilledSuper, weakSystem });
