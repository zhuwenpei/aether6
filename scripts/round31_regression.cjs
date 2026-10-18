const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round31 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const map = read('src/components/MapView.tsx');

assert(pkg.version === '4.3.15', 'package version must be 4.3.15');
assert(app.includes('lastPhysicsDispatchAtRef') && app.includes('const minDispatchMs = speed > 30 ? 8.5 : speed > 15 ? 10.5 : 12'), 'high-refresh physics scheduler wakeup cap missing');
assert(app.includes('simMinutesBufferRef.current >= 10.0') && app.includes('simMinutesBufferRef.current -= 10.0'), 'fixed 10-minute physics step must remain unchanged');
assert(app.includes('mobileCommitScale = useLegacyMobileUi') && app.includes('nominalUiIntervalMs * mobileCommitScale'), 'mobile whole-tree commit scaling missing');
assert(map.includes('targetIntervalMs') && map.includes('previousInterval * 0.72 + observedInterval * 0.28') && map.includes('motion.targetIntervalMs * 1.08'), 'live-centre cadence smoothing missing');
assert(map.includes('const estimatedHz =') && map.includes('const frameStride = Math.max(1, Math.round(estimatedHz / targetFps))'), 'stable high-refresh frame divisor missing');
assert(map.includes('const radiiInterval = config.followMainTyphoon ? 0') && map.includes('followPanUntilRef.current = performance.now() + 45'), 'follow centre/radii/camera clock unification missing');
assert(map.includes('const wantsCursor = !!layersRef.current.cursor') && map.includes('if (!wantsCursor && !wantsRadar) return'), 'hidden cursor/radar React update guard missing');
assert(map.includes('stationVisualKey') && map.includes('marker.__aetherStationVisualKey !== stationVisualKey'), 'station DivIcon diffing missing');
assert(map.includes('document.visibilityState === "hidden"'), 'background animation suspension must remain enabled');

console.log('Round 31 regression: OK');
