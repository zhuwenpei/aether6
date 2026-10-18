import { buildWeightedRainSnapshots } from "../src/utils/RainfallTimeWindow";

const base: any = {
  id: "time-window-regression",
  lat: 30,
  lon: 122,
  vmax: 40,
  pmin: 960,
  rmw: 35,
  simHour: 2,
  direction: 270,
  speed: 20,
  active: true,
  dissipated: false,
  r7: { ne: 220, se: 220, sw: 220, nw: 220 },
  r10: { ne: 100, se: 100, sw: 100, nw: 100 },
  r12: { ne: 50, se: 50, sw: 50, nw: 50 },
};

const history = [
  { ...base, simHour: 0, lon: 122.0 },
  { ...base, simHour: 1, lon: 121.6 },
  { ...base, simHour: 2, lon: 121.2 },
];

// Live centre has continued 45 minutes beyond the last archived whole hour.
const live: any = { ...base, simHour: 2, lon: 120.9, history };
const liveWindow = buildWeightedRainSnapshots(live, 2.75, 1);
const integratedHours = liveWindow.snapshots.reduce((s, x) => s + x.dtHours, 0);
if (Math.abs(integratedHours - 1) > 1e-6) {
  throw new Error(`Expected exactly 1.0 h integration, got ${integratedHours}`);
}
if (Math.abs(liveWindow.actualEndHour - 2.75) > 1e-6) {
  throw new Error(`Fractional live end time was lost: ${liveWindow.actualEndHour}`);
}
if (!liveWindow.snapshots.some((s) => s.state.simHour > 2 && s.state.simHour < 2.75)) {
  throw new Error("Latest partial live hour was not represented in rainfall integration.");
}

// Whole-hour histories must be sampled at interval midpoints, not at the later endpoint.  For a
// west-moving storm the final 1-2 h contribution should sit halfway between the 1 h and 2 h centres.
const archivedWindow = buildWeightedRainSnapshots({ ...base, history } as any, 2, 2);
const last = archivedWindow.snapshots[archivedWindow.snapshots.length - 1];
if (Math.abs(last.state.simHour - 1.5) > 1e-6) {
  throw new Error(`Expected midpoint sample at 1.5 h, got ${last.state.simHour}`);
}
if (Math.abs(last.state.lon - 121.4) > 1e-6) {
  throw new Error(`Moving rain swath is still endpoint-shifted: expected 121.4E, got ${last.state.lon}`);
}

console.log("Rainfall time-window regression passed.");
console.table({
  exactEndHour: liveWindow.actualEndHour,
  integratedHours,
  partialSamples: liveWindow.snapshots.filter((s) => s.state.simHour > 2).length,
  finalArchivedMidpointHour: last.state.simHour,
  finalArchivedMidpointLon: last.state.lon,
});
