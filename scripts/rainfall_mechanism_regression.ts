import { computeTyphoonPrecipitation, type PrecipitationStateLike } from "../src/simulation/PrecipitationModel";

const state: PrecipitationStateLike = {
  lat: 28.6,
  lon: 122.2,
  vmax: 42,
  rmw: 36,
  simHour: 0,
  direction: 330,
  speed: 17,
  landed: false,
  shear: 12,
  shearDir: 240,
  structuralState: 0.85,
  eyewallIntegrity: 0.82,
  moistureReservoir: 0.96,
  rainbandDominance: 0.75,
  outflowEfficiency: 0.82,
  r7: { ne: 280, se: 300, sw: 320, nw: 260 },
  r10: { ne: 120, se: 135, sw: 145, nw: 115 },
};

const config = {
  monsoonTroughEnabled: true,
  westerliesEnabled: true,
  westerliesLat: 31,
  westerliesStrength: 0.8,
  westerliesTroughLon: 120,
  subtropicalHighEnabled: true,
  subtropicalHighLat: 25,
  subtropicalHighLon: 135,
  subtropicalHighWestExtent: 119,
  subtropicalHighStrength: 1.05,
};

function accumulate24h(
  lat: number,
  lon: number,
  terrain: { elevation: number; terrainSlopeEast: number; terrainSlopeNorth: number; coastDistanceKm: number },
): { total: number; terrain: number; synoptic: number } {
  let total = 0;
  let terrainTotal = 0;
  let synopticTotal = 0;
  for (let h = 0; h < 24; h++) {
    const s = { ...state, simHour: h, lat: state.lat + 0.045 * h, lon: state.lon - 0.018 * h };
    const result = computeTyphoonPrecipitation(s, lat, lon, {
      isLand: true,
      distanceToLandKm: 0,
      ...terrain,
      config,
    });
    total += result.rate;
    terrainTotal += result.components.terrainAnchoredRain;
    synopticTotal += result.components.synopticConvergenceRain;
  }
  return { total, terrain: terrainTotal, synoptic: synopticTotal };
}

const windwardMountain = accumulate24h(24.1, 120.9, {
  elevation: 1500,
  terrainSlopeEast: 38,
  terrainSlopeNorth: 5,
  coastDistanceKm: 35,
});
const leeMountain = accumulate24h(24.1, 121.4, {
  elevation: 1300,
  terrainSlopeEast: -38,
  terrainSlopeNorth: -3,
  coastDistanceKm: 22,
});
const remoteLowland = accumulate24h(24.1, 120.4, {
  elevation: 40,
  terrainSlopeEast: 2,
  terrainSlopeNorth: 0,
  coastDistanceKm: 55,
});

// A generic remote mountain should be able to form a distinct 24-h rain maximum under aligned
// moist TC flow. The same-distance lowland and the lee side must not receive the same boost.
if (windwardMountain.total < 35) {
  throw new Error(`Remote windward terrain rain too weak: ${windwardMountain.total.toFixed(1)} mm/24h`);
}
if (windwardMountain.total < leeMountain.total * 3) {
  throw new Error(`Windward/lee terrain contrast too weak: ${windwardMountain.total.toFixed(1)} vs ${leeMountain.total.toFixed(1)}`);
}
if (remoteLowland.total > windwardMountain.total * 0.35) {
  throw new Error(`Remote terrain mechanism leaked into lowland: ${remoteLowland.total.toFixed(1)} vs ${windwardMountain.total.toFixed(1)}`);
}

// Strong-shear rainfall should retain a clear downshear-left preference rather than reverting to
// a circular storm-centred shield.
const shearState: PrecipitationStateLike = {
  ...state,
  lat: 25,
  lon: 120,
  vmax: 38,
  shear: 24,
  shearDir: 270,
  direction: 330,
  simHour: 6,
};
function pointAtBearing(bearing: number, radiusKm: number): [number, number] {
  const a = bearing * Math.PI / 180;
  return [
    shearState.lat + radiusKm * Math.cos(a) / 111.12,
    shearState.lon + radiusKm * Math.sin(a) / (111.12 * Math.cos(shearState.lat * Math.PI / 180)),
  ];
}
const [dslLat, dslLon] = pointAtBearing(200, 180); // shearDir - 70°
const [upLat, upLon] = pointAtBearing(20, 180);
const downshearLeft = computeTyphoonPrecipitation(shearState, dslLat, dslLon, { config, isLand: false }).rate;
const upshear = computeTyphoonPrecipitation(shearState, upLat, upLon, { config, isLand: false }).rate;
if (downshearLeft <= upshear * 1.35) {
  throw new Error(`Shear asymmetry too weak: DSL=${downshearLeft.toFixed(2)} mm/h, upshear=${upshear.toFixed(2)} mm/h`);
}

console.log("Rainfall mechanism regression passed.");
console.table({
  windwardMountain24h: Number(windwardMountain.total.toFixed(1)),
  leeMountain24h: Number(leeMountain.total.toFixed(1)),
  remoteLowland24h: Number(remoteLowland.total.toFixed(1)),
  downshearLeftHourly: Number(downshearLeft.toFixed(2)),
  upshearHourly: Number(upshear.toFixed(2)),
});
