const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');

const map = read('src/components/MapView.tsx');
const engine = read('src/simulation/Engine.ts');
const app = read('src/App.tsx');

// Keep the normal operational 3-hour publication cadence; an explicit user timed-size transition may update on fixed physics steps.
assert(engine.includes('isThreeHourlySynopticTime(startDate, currentSimHourFloat)'), '3-hour synoptic radius clock changed');
assert(engine.includes('manualCirculationTransitionActive || isExactlyOnThreeHour'), 'normal 3-hour gate / explicit timed-transition exception missing');
assert(engine.includes('effectiveVmaxForRadii >= 24.5') && engine.includes('effectiveVmaxForRadii >= 32.7'), 'R10/R12 threshold logic missing');

// App deliberately publishes an integer UI hour while physics can be fractional.
assert(app.includes('const nextHour = Math.floor(totalSimMinutesRef.current / 60.0)'), 'integer UI cursor assumption changed');
assert(map.includes('function resolveSteppedWindRadii(typhoon: Typhoon, currentHour: number, historicalPlayback: boolean)'), 'live/replay radius source is not explicit');
assert(map.includes('const archived = historicalPlayback ? findHistoryAtOrBefore(typhoon.history, currentHour) : undefined'), 'live simulation can still fall back to stale hourly history');
assert(map.includes('const nextRadii = resolveSteppedWindRadii(ty, currentHour, historicalPlayback);'), 'MapView does not pass explicit playback state');

// A new force level must be materialized in the same commit that changes layer topology.
assert(map.includes('radiiMotion.durationMs = 0'), '3-hour wind-area update is no longer an immediate step');
assert(map.includes('{ q: nextRadii.r7, color: "#f39c12"') && map.includes('{ q: nextRadii.r10, color: "#d35400"') && map.includes('{ q: nextRadii.r12, color: "#c0392b"'), 'live layer creation still reads the previous RAF snapshot');

// The old 6/12h display-side JMA gate must remain absent.
assert(!map.includes('resolveJmaIssuedWindRadiiState'), 'display-side JMA issuance gate reintroduced');

console.log('user live wind-radii regression: PASS');
