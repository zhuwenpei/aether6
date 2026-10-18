const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const station = fs.readFileSync('src/components/StationHistory.tsx', 'utf8');
const map = fs.readFileSync('src/components/MapView.tsx', 'utf8');
const video = fs.readFileSync('src/utils/VideoRenderEngine.ts', 'utf8');
const synoptic = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');

// 1) Temporary/land station eye-passage reconstruction.
assert(engine.includes('const cacheKey = `${stationName}|${lat.toFixed(4)}|${lon.toFixed(4)}`;'), 'station land cache is still name-only');
assert(engine.includes('diagnosticVersion: "round124-eye-v2"'), 'station diagnostic version was not bumped after the eye-profile change');
assert(station.includes('const stored = station.temporary ? undefined : h.stationReadings?.find'), 'temporary station still reuses a built-in same-name history row');
assert(station.includes('(!station.temporary ? activeState?.stationReadings?.find'), 'temporary current station still falls back to built-in same-name row');
assert(map.includes('updateTemporaryStationLocation(best.lat, best.lon, snappedName);'), 'nearest-land action does not move temporary station coordinates');
assert(station.includes('"吸附最近陆地"'), 'nearest-land UI still describes rename-only behavior');
assert(engine.includes('0.48 - 0.22 * ((vmax - 17.2) / (32.7 - 17.2))'), 'station eye center ratio is not continuous through 32.7 m/s');
assert(engine.includes('const landfallEyeQualityFloor = eyeIntensityGate * eyePassageMemory * nearCoastLandWeight;'), 'near-landfall eye-passage memory floor missing');

// Explicitly verify the former threshold jump is gone numerically.
const ragged = (v) => v >= 32.7 ? 0.26 : v >= 17.2 ? 0.48 - 0.22 * ((v - 17.2) / (32.7 - 17.2)) : 0.82 - 0.34 * Math.max(0, Math.min(1, (v - 5) / (17.2 - 5)));
assert(Math.abs(ragged(32.6999) - ragged(32.7)) < 0.001, 'station eye ratio still jumps at the typhoon threshold');

// 2) JMA Best Track + Himawari scalar info: 3 h analysis, 1 h xx:00 display clock.
assert(video.includes('function latestThreeHourlyReplayInfoState('), '3-hour replay info helper missing');
assert(video.includes('Math.floor((capped - firstHour + 1e-6) / 3)'), 'replay info is not stepped at 3 hours');
assert(video.includes('function replayWholeHour(currentSimHour: number)'), 'whole-hour replay clock helper missing');
assert(video.includes('Math.floor(currentSimHour + 1e-6)'), 'replay time still rounds/interpolates instead of hourly stepping');
assert(video.includes('const analysisState = latestThreeHourlyReplayInfoState(history, currentSimHour, currentState);'), 'Himawari panel is not using 3-hour scalar analyses');
assert(video.includes('himawariWindAreaText(windRadiiState.r10, 0.84)'), 'Himawari wind-radii text was incorrectly moved onto the 3-hour scalar clock');
assert(video.includes('himawariWindAreaText(windRadiiState.r7, 0.88)'), 'Himawari strong-wind-area text was incorrectly moved onto the 3-hour scalar clock');
assert(video.includes('const replayInfoState = exportConfig.replayStyle === "jma_best_track"'), 'JMA Best Track scalar info state missing');
assert(video.includes('Math.round(jmaBestTrackInfoState.pmin)'), 'JMA Best Track pressure does not use the stepped info state');
assert(video.includes('dt.setUTCMinutes(0, 0, 0);'), 'JMA Best Track display time is not forced to xx:00');
assert(video.includes('currentJst.setUTCMinutes(0, 0, 0);'), 'Himawari display time is not forced to xx:00');

// 3) HMON/HWRF barb visibility/scale increase while preserving the glyph geometry.
assert((synoptic.match(/barbSpacingPx: 42, barbColor: "rgba\(14,14,14,0\.64\)"/g) || []).length === 2, 'both reference wind styles did not receive the opacity increase');
assert(synoptic.includes('const glyphScale = 1.18;'), 'reference wind-barb size increase missing');
assert(synoptic.includes('ctx.lineWidth = Math.max(1.14 * S, 0.76);'), 'reference wind-barb stroke increase missing');
assert(synoptic.includes('const fullFeatherNormal = 9.75 * S * glyphScale;'), 'ROUND123 REDO feather geometry was not uniformly scaled');
assert(synoptic.includes('const pennantNormal = 9.55 * S * glyphScale;') || synoptic.includes('const pennantNormal = 6.35 * S * glyphScale;'), 'reference pennant geometry missing after scale update');

console.log('ROUND124 station/replay/barb regression: PASS');
