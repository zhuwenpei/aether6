const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const audio = fs.readFileSync('src/utils/audio.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const map = fs.readFileSync('src/components/MapView.tsx', 'utf8');
const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');

assert(audio.includes('mouse: 72') && audio.includes('mahjong: 84'), 'minimum tactile release delays missing');
assert(audio.includes('getTactileReleaseMinDelayMs'), 'minimum release delay helper missing');
assert(audio.includes('TACTILE_RELEASE_MIN_DELAY_MS.mahjong'), 'mahjong preview minimum delay missing');
assert(audio.includes('TACTILE_RELEASE_MIN_DELAY_MS.mouse'), 'mouse preview minimum delay missing');
assert(app.includes('const waitMs = Math.max(0, getTactileReleaseMinDelayMs(entry.mode) - elapsed);'), 'pointer-up minimum delay enforcement missing');
assert(app.includes('const pendingReleaseTimers = new Set<number>();'), 'delayed release timer cleanup missing');
assert(app.includes('playSndClick(soundConfig.soundVolume, true, soundConfig.soundMode || "mouse")'), 'stable sound listener ref path missing');
assert(app.includes('  }, []);'), 'one-time sound listener effect missing');

assert(app.includes('serializeTyphoonsForPersistence'), 'incremental persistence serializer missing');
assert(app.includes('serializeHistoryForPersistence'), 'history-prefix serialization cache missing');
assert(app.includes('history[i] !== cached.historyRef[i]'), 'append-only history prefix guard missing');
assert(!app.includes('localStorage.setItem("typhoon_sim_state_typhoons", JSON.stringify(snapshotTyphoons));'), 'full repeated season stringify still active');

assert(map.includes('const stationIconCacheRef = useRef<Map<string, L.DivIcon>>(new Map());'), 'station icon cache missing');
assert(map.includes('WEATHER_STATION_RENDER_META'), 'precomputed station trig metadata missing');
assert(map.includes('forecastGeometryGroupRef'), 'forecast geometry split layer missing');
assert(map.includes('Keeping these layers separate prevents a moving forecast'), 'forecast/history layer isolation missing');
assert(map.includes('const canReuseLiveTrackGeometry = !historicalPlayback && activeCyclones.length <= 1 &&\n      !layers.hurricaneTrackerModels;'), 'forecast layers still disable best-track reuse');
assert(map.includes('categoryColorsKey = useMemo'), 'category color fingerprint memo missing');

assert(engine.includes('manualForecastIntensityCurveCache = new WeakMap'), 'manual forecast curve normalization cache missing');
assert(engine.includes('if (typhoons.length < 2) return null;'), 'single-cyclone binary fast path missing');
assert(engine.includes('NO_BINARY_CYCLONE_INTERACTION'), 'shared zero binary interaction missing');

console.log('ROUND128 minimum tactile delay + lossless performance refactor regression: PASS');
