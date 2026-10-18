const fs = require('fs');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const src = fs.readFileSync('src/simulation/HurricaneTrackerPort.ts', 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const dynamicsSrc = fs.readFileSync('src/simulation/ConvectiveDynamics.ts', 'utf8');
const dynamicsJs = ts.transpileModule(dynamicsSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
const dynamicsMod = { exports: {} };
new Function('exports', 'module', 'require', dynamicsJs)(dynamicsMod.exports, dynamicsMod, require);
const mod = { exports: {} };
new Function('exports', 'module', 'require', js)(mod.exports, mod,
  id => id === './ConvectiveDynamics' ? dynamicsMod.exports : require(id));
const h = mod.exports;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const expected = [
  ['ICON',15,500,6,'#0000ff'], ['GFS',15,225,5,'#00ff00'], ['GFS2',15,325,5,'#003300'], ['GFS3',15,425,5,'#00b380'],
  ['EURO',8,200,6,'#ffff00'], ['EURO2',8,150,6,'#333300'], ['EURO3',8,250,6,'#a66600'], ['HMNI',5,10,7,'#ffffff']
];
assert(h.HURRICANE_TRACKER_MODEL_SPECS.length === 8, 'expected 8 StormModel specs');
expected.forEach((e, i) => {
  const s = h.HURRICANE_TRACKER_MODEL_SPECS[i];
  assert(s.name === e[0] && s.resolution === e[1] && s.iStep === e[2] && s.length === e[3] && s.color === e[4], `spec mismatch ${e[0]}`);
});
const w = h.latLonToHurricaneTrackerWorld(20, 130);
const ll = h.hurricaneTrackerWorldToLatLon(w.x, w.z);
assert(Math.abs(ll.lat - 20) < 1e-9 && Math.abs(ll.lon - 130) < 1e-9, 'coordinate conversion not reversible');

assert(Math.abs(h.aetherHourToHurricaneTrackerTime(192) - 1) < 1e-12, 'Unity time bridge mismatch');
assert(src.includes('const scale = 5;'), 'Spawner.scale=5 port missing');
assert(src.includes('windSpeedMph < 10'), 'StormSystem cloud-cover branch must switch at 10 mph');
assert(src.includes('MPS_TO_MPH = 2.2369362920544'), 'AETHER m/s to Hurricane Tracker mph bridge missing');
assert(src.includes('Math.pow(worldDistance * 12.8, 1.4) / 10'), 'nearby-storm distance law mismatch');
assert(!src.includes('`${seed}|${spec.name}`'), 'models must share one global wind field seed');

const storm = { id:'test', lat:18, lon:132, vmax:45, pmin:950, eyeRadiusKm:24, eyeClearance:0.8, eyewallIntegrity:0.9, rainbandDominance:0.2, secondaryEyewallStrength:0.05, extrTransition:0 };
const tracks = h.calculateHurricaneTrackerModelTracks(storm, 100, [storm], 'regression');
assert(tracks.length === 8, 'track count mismatch');
tracks.forEach((m) => {
  assert(m.track.length === m.spec.resolution + 1, `${m.id} point count mismatch`);
  assert(Math.abs(m.track[0].lat - storm.lat) < 1e-9 && Math.abs(m.track[0].lon - storm.lon) < 1e-9, `${m.id} origin mismatch`);
});
const endpoints = new Set(tracks.map(m => `${m.track.at(-1).lat.toFixed(3)},${m.track.at(-1).lon.toFixed(3)}`));
assert(endpoints.size >= 5, 'model parameters are not producing sufficiently distinct tracks');

const normal = h.sampleHurricaneTrackerCloud(storm, 18.3, 132.4, 100, 'normal', 'regression');
const ir = h.sampleHurricaneTrackerCloud(storm, 18.3, 132.4, 100, 'ir', 'regression');
assert(Math.abs(normal.density - ir.density) < 1e-12, 'Normal/IR must share one cloud geometry');
assert(normal.color !== ir.color, 'Normal/IR shader branches should color the same density differently');
assert(Number.isFinite(ir.brightnessTemperatureC) && ir.brightnessTemperatureC <= 32 && ir.brightnessTemperatureC >= -98, 'synthetic IR brightness temperature missing/out of range');
assert(normal.strength >= 0.4 && normal.strength <= 2, 'Strength clamp broken');
assert(normal.cloudCover >= 0.3 && normal.cloudCover <= 1.5, 'CloudCover clamp broken');
console.log('hurricane_tracker_port_regression: PASS');

// AETHER-localized guidance: Unity StormModel spread must be applied around the normal/user-drawn
// AETHER forecast path. GFS is the zero-deviation reference and therefore lies exactly on it.
const reference = [
  { lat: 18, lon: 132, simHour: 100 },
  { lat: 20, lon: 128, simHour: 160 },
  { lat: 24, lon: 124, simHour: 220 }
];
const guidance = h.calculateHurricaneTrackerGuidanceTracks(storm, 100, [storm], 'regression', reference, 120);
const gfsGuidance = guidance.find(m => m.id === 'GFS');
assert(gfsGuidance, 'anchored GFS guidance missing');
assert(Math.abs(gfsGuidance.track[0].lat - 18) < 1e-9 && Math.abs(gfsGuidance.track[0].lon - 132) < 1e-9, 'anchored guidance origin mismatch');
const gfsEnd = gfsGuidance.track.at(-1);
assert(Math.abs(gfsEnd.lat - 24) < 1e-9 && Math.abs(gfsEnd.lon - 124) < 1e-9, 'GFS must terminate on AETHER reference path');
const guidedEndpoints = new Set(guidance.map(m => `${m.track.at(-1).lat.toFixed(3)},${m.track.at(-1).lon.toFixed(3)}`));
assert(guidedEndpoints.size >= 5, 'anchored StormModel spread collapsed');
assert(src.includes('dryAirCoreExposure') && src.includes('eyewallOpenSectorFraction') && src.includes('shearDir'), 'AETHER structural cloud damage bridge missing');
assert(src.includes('CLOUD_TILE_CACHE') && src.includes('renderHurricaneTrackerCloudTile'), 'satellite tile cache optimization missing');
console.log('hurricane_tracker_aether_guidance_regression: PASS');
