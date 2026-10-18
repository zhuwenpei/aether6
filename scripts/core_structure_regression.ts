import { computeTyphoonPrecipitation, type PrecipitationStateLike } from "../src/simulation/PrecipitationModel";

const config = {
  monsoonTroughEnabled: true,
  westerliesEnabled: true,
  westerliesLat: 31,
  westerliesStrength: 0.7,
  westerliesTroughLon: 120,
  subtropicalHighEnabled: true,
  subtropicalHighLat: 25,
  subtropicalHighLon: 135,
  subtropicalHighWestExtent: 119,
  subtropicalHighStrength: 1.0,
};

const base: PrecipitationStateLike = {
  lat: 24.8,
  lon: 126.0,
  vmax: 58,
  pmin: 925,
  rmw: 28,
  simHour: 36,
  direction: 315,
  speed: 18,
  landed: false,
  shear: 9,
  shearDir: 240,
  structuralState: 0.94,
  eyewallIntegrity: 0.90,
  eyeRadiusKm: 15,
  eyeClearance: 0.82,
  eyeObstruction: 0.10,
  eyeAsymmetry: 0.10,
  eyeWarmCore: 0.88,
  moistureReservoir: 0.98,
  dryAirIntrusion: 0.02,
  dryAirCoreExposure: 0.01,
  dryAirWrapFraction: 0.03,
  moistEnvelopeIntegrity: 0.94,
  innerCoreMoisture: 0.91,
  eyewallOpenSectorFraction: 0.05,
  deepConvectiveCoverage: 0.78,
  lowLevelVortexIntegrity: 0.92,
  moistCoreProtection: 0.90,
  convectiveSuppression: 0.05,
  coreCompactness: 0.86,
  convectiveBurstIndex: 0.52,
  rainbandDominance: 0.36,
  outflowEfficiency: 0.88,
  cdoDiameterKm: 124,
  structureMode: "dvorak_cmg",
  r7: { ne: 260, se: 250, sw: 235, nw: 245 },
  r10: { ne: 120, se: 110, sw: 105, nw: 115 },
};

const dryCollapse: PrecipitationStateLike = {
  ...base,
  simHour: 48,
  shear: 18,
  dryAirIntrusion: 0.78,
  dryAirCoreExposure: 0.70,
  dryAirWrapFraction: 0.84,
  moistEnvelopeIntegrity: 0.28,
  innerCoreMoisture: 0.34,
  eyewallOpenSectorFraction: 0.74,
  deepConvectiveCoverage: 0.24,
  lowLevelVortexIntegrity: 0.70,
  dryAirLifecyclePhase: "asymmetric_collapse",
  dryAirVentilationIndex: 0.78,
  dryAirCoreConnection: 0.76,
  dryAirReMoistening: 0.06,
  drySlotBearingDeg: 255,
  dryAirConvectiveArcBearingDeg: 70,
  moistCoreProtection: 0.30,
  convectiveSuppression: 0.66,
  structuralDisorganization: 0.56,
  coreCompactness: 0.58,
  convectiveBurstIndex: 0.20,
  rainbandDominance: 0.66,
  coreRebuildScar: 0.52,
  postDryAirBurstSuppressionHours: 18,
  structureMode: "dry_leaf",
};

const rebuilding: PrecipitationStateLike = {
  ...dryCollapse,
  simHour: 58,
  vmax: 46,
  rmw: 24,
  dryAirIntrusion: 0.46,
  dryAirCoreExposure: 0.30,
  dryAirWrapFraction: 0.46,
  moistEnvelopeIntegrity: 0.52,
  innerCoreMoisture: 0.62,
  eyewallOpenSectorFraction: 0.42,
  deepConvectiveCoverage: 0.34,
  lowLevelVortexIntegrity: 0.74,
  dryAirLifecyclePhase: "reorganizing",
  dryAirVentilationIndex: 0.44,
  dryAirCoreConnection: 0.28,
  dryAirReMoistening: 0.66,
  moistCoreProtection: 0.58,
  convectiveSuppression: 0.34,
  coreCompactness: 0.72,
  convectiveBurstIndex: 0.42,
  rainbandDominance: 0.54,
  rebuiltCoreDiameterKm: 34,
  structureMode: "dry_rebuilding_core",
};

function pointAt(state: PrecipitationStateLike, bearing: number, radiusKm: number): [number, number] {
  const a = bearing * Math.PI / 180;
  return [
    state.lat + radiusKm * Math.cos(a) / 111.12,
    state.lon + radiusKm * Math.sin(a) / (111.12 * Math.cos(state.lat * Math.PI / 180)),
  ];
}

function sampleCore(state: PrecipitationStateLike, radiusMax = 120) {
  let sum = 0;
  let n = 0;
  let heavy = 0;
  let veryHeavy = 0;
  let max = 0;
  for (let radius = 8; radius <= radiusMax; radius += 8) {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const [lat, lon] = pointAt(state, bearing, radius);
      const rate = computeTyphoonPrecipitation(state, lat, lon, { config, isLand: false }).rate;
      sum += rate;
      n++;
      if (rate >= 24) heavy++; // approximately the broad 45 dBZ concern under a basic Z-R relation
      if (rate >= 40) veryHeavy++;
      max = Math.max(max, rate);
    }
  }
  return { mean: sum / n, heavyFraction: heavy / n, veryHeavyFraction: veryHeavy / n, max };
}

function annulusMean(state: PrecipitationStateLike, r0: number, r1: number) {
  let sum = 0;
  let n = 0;
  for (let radius = r0; radius <= r1; radius += 4) {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const [lat, lon] = pointAt(state, bearing, radius);
      sum += computeTyphoonPrecipitation(state, lat, lon, { config, isLand: false }).rate;
      n++;
    }
  }
  return sum / n;
}

const intact = sampleCore(base);
const dry = sampleCore(dryCollapse);
const rebuild = sampleCore(rebuilding);
const rebuildInner = annulusMean(rebuilding, 10, 34);
const rebuildOuter = annulusMean(rebuilding, 70, 110);

if (dry.mean >= intact.mean * 0.80) {
  throw new Error(`Dry-air collapse did not weaken core mean enough: intact=${intact.mean.toFixed(2)}, dry=${dry.mean.toFixed(2)}`);
}
if (dry.heavyFraction >= Math.max(0.28, intact.heavyFraction * 0.82)) {
  throw new Error(`Dry-air collapse retained too much broad heavy rain: intact=${intact.heavyFraction.toFixed(3)}, dry=${dry.heavyFraction.toFixed(3)}`);
}
if (dry.max > intact.max) {
  throw new Error(`Dry-air collapse created a compensating stronger lobe: intactMax=${intact.max.toFixed(1)}, dryMax=${dry.max.toFixed(1)}`);
}
if (rebuildInner <= rebuildOuter * 1.80) {
  throw new Error(`Rebuilt core is not compact enough: inner=${rebuildInner.toFixed(2)}, outer=${rebuildOuter.toFixed(2)}`);
}
if (rebuild.heavyFraction > 0.70) {
  throw new Error(`Rebuilding stage paints too much broad heavy rain: ${rebuild.heavyFraction.toFixed(3)}`);
}

console.log("Core-structure regression passed.");
console.table({
  intactMean: Number(intact.mean.toFixed(2)),
  dryMean: Number(dry.mean.toFixed(2)),
  intactHeavyFraction: Number(intact.heavyFraction.toFixed(3)),
  dryHeavyFraction: Number(dry.heavyFraction.toFixed(3)),
  dryMax: Number(dry.max.toFixed(1)),
  rebuildInnerMean: Number(rebuildInner.toFixed(2)),
  rebuildOuterMean: Number(rebuildOuter.toFixed(2)),
  rebuildHeavyFraction: Number(rebuild.heavyFraction.toFixed(3)),
});
