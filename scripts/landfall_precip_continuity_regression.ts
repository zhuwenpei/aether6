import { computeTyphoonPrecipitation, type PrecipitationStateLike } from "../src/simulation/PrecipitationModel";

const coastalApproach: PrecipitationStateLike = {
  lat: 22.6,
  lon: 114.2,
  vmax: 50,
  pmin: 940,
  rmw: 34,
  simHour: 20,
  direction: 305,
  speed: 18,
  landed: false,
  landHours: 0,
  shear: 13,
  shearDir: 235,
  structuralState: 0.88,
  eyewallIntegrity: 0.80,
  eyeRadiusKm: 17,
  eyeClearance: 0.60,
  eyeObstruction: 0.20,
  coreCompactness: 0.64,
  deepConvectiveCoverage: 0.74,
  moistureReservoir: 0.95,
  moistEnvelopeIntegrity: 0.86,
  innerCoreMoisture: 0.88,
  rainbandDominance: 0.48,
  outflowEfficiency: 0.86,
  broadMoisturePlatform: 0.40,
  cdoDiameterKm: 132,
  coastalCoreInfluence: 0.90,
  structuralDamagePenaltyFactor: 1,
  structuralDisorganization: 0.10,
  terrainCoreLandFraction: 0.03,
  terrainFrictionAsymmetry: 0.05,
  terrainHollowCoreMemory: 0,
  dryAirCoreExposure: 0.04,
  dryAirWrapFraction: 0.08,
  dryAirCoreConnection: 0.03,
  r7: { ne: 285, se: 270, sw: 245, nw: 265 },
  r10: { ne: 135, se: 125, sw: 118, nw: 126 },
  structureMode: "cdo_mature",
};

const firstLandStep: PrecipitationStateLike = {
  ...coastalApproach,
  simHour: 20.25,
  vmax: 48,
  landed: true,
  landHours: 0.25,
  isStructureDamaged: true,
  structuralDamagePenaltyFactor: 0.88,
  structuralDisorganization: 0.28,
  terrainCoreLandFraction: 0.32,
  terrainFrictionAsymmetry: 0.24,
  structureMode: "landfall_disintegrating",
  landfallRecords: [{ lat: coastalApproach.lat, lon: coastalApproach.lon, vmax: 50, simHour: 20 }],
};

const config = {
  monsoonTroughEnabled: true,
  westerliesEnabled: true,
  subtropicalHighEnabled: true,
};

type Footprint = { n20: number; n30: number; n40: number; sum: number; max: number; far20: number };

function scanFootprint(state: PrecipitationStateLike): Footprint {
  let n20 = 0, n30 = 0, n40 = 0, sum = 0, max = 0, far20 = 0;
  for (let yKm = -180; yKm <= 180; yKm += 15) {
    for (let xKm = -180; xKm <= 180; xKm += 15) {
      const lat = state.lat + yKm / 111.12;
      const lon = state.lon + xKm / (111.12 * Math.cos(state.lat * Math.PI / 180));
      const rate = computeTyphoonPrecipitation(state, lat, lon, {
        isLand: true,
        elevation: 25,
        coastDistanceKm: 35,
        distanceToLandKm: 0,
        config,
      }).rate;
      sum += rate;
      max = Math.max(max, rate);
      if (rate >= 20) {
        n20++;
        far20 = Math.max(far20, Math.hypot(xKm, yKm));
      }
      if (rate >= 30) n30++;
      if (rate >= 40) n40++;
    }
  }
  return { n20, n30, n40, sum, max, far20 };
}

const before = scanFootprint(coastalApproach);
const after = scanFootprint(firstLandStep);
const approachBelowGate = scanFootprint({ ...coastalApproach, coastalCoreInfluence: 0.19 });
const approachAboveGate = scanFootprint({ ...coastalApproach, coastalCoreInfluence: 0.21 });

// Coastal influence used to cross a hard 0.20 switch. A tiny change around that historical
// threshold must now produce only a small continuous change in the resolved rainfall field.
if (approachAboveGate.sum > approachBelowGate.sum * 1.08) {
  throw new Error(`Near-coast convergence still has a threshold jump: ${approachBelowGate.sum.toFixed(1)} -> ${approachAboveGate.sum.toFixed(1)}`);
}
if (approachAboveGate.n20 > approachBelowGate.n20 * 1.15 + 2) {
  throw new Error(`Near-coast >=20 mm/h area jumped at coastal influence 0.20: ${approachBelowGate.n20} -> ${approachAboveGate.n20}`);
}

// The first land-contact step may redistribute convection and create broken rainbands, but it must
// not refill every previously suppressed quadrant or instantiate a full 100-250 km damaged shield.
// These bounds deliberately allow substantial physical reorganization while catching the historical
// one-step ~6x expansion of the >=20 mm/h footprint.
if (after.n20 > before.n20 * 2.0) {
  throw new Error(`Landfall >=20 mm/h footprint expanded too abruptly: ${before.n20} -> ${after.n20}`);
}
if (after.sum > before.sum * 1.40) {
  throw new Error(`Landfall integrated core field jumped too abruptly: ${before.sum.toFixed(1)} -> ${after.sum.toFixed(1)}`);
}
if (after.far20 > before.far20 + 35) {
  throw new Error(`Landfall heavy-rain radius jumped too abruptly: ${before.far20.toFixed(1)} -> ${after.far20.toFixed(1)} km`);
}

console.log("Landfall precipitation continuity regression passed.");
console.table({
  beforeN20: before.n20,
  afterN20: after.n20,
  footprintRatio20: Number((after.n20 / Math.max(1, before.n20)).toFixed(2)),
  integratedFieldRatio: Number((after.sum / Math.max(1, before.sum)).toFixed(2)),
  beforeHeavyRadiusKm: Number(before.far20.toFixed(1)),
  afterHeavyRadiusKm: Number(after.far20.toFixed(1)),
  beforePeakRate: Number(before.max.toFixed(1)),
  afterPeakRate: Number(after.max.toFixed(1)),
  coastalThresholdFieldRatio: Number((approachAboveGate.sum / Math.max(1, approachBelowGate.sum)).toFixed(3)),
});
