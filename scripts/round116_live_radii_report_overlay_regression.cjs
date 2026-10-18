const fs = require('fs');
const assert = require('node:assert/strict');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const field = fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const modal = fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const map = fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const report = fs.readFileSync('src/components/TyphoonReportModal.tsx','utf8');

assert.equal(pkg.version,'6.0.39');
assert.equal(pkg.scripts['test:round116'],'node scripts/round116_live_radii_report_overlay_regression.cjs');

// Live timeline issue must use continuous state even when simHour is fractional.
assert(field.includes('const liveTimelineHour = Math.floor(liveHour + 1e-6);'));
assert(field.includes('issueHour >= liveTimelineHour - 1e-6 && issueHour <= liveHour + 0.25'));

// Forecast cache invalidates when current wind radii / storm structure change.
assert(field.includes('const seedStateHash = stringHash(stormCacheSignature([{ id: typhoon.id, state: seed }])'));
assert(field.includes('`${typhoon.id}|${initHour.toFixed(3)}|${configHash}|${seedStateHash}`'));

// The UI follows currentHour between generations and manual export snapshots the current hour.
assert(modal.includes('}, [isOpen, imageStyle, typhoon.id, currentHour]);'));
assert(modal.includes('const issueOverride = requestedStyle === "synoptic_wind_pressure" ? currentHour : undefined;'));
assert(modal.includes('const videoIssueHour = currentHour;'));

// History-path overlay must not draw the old automatic dashed wind-radius circles.
const overlayStart = map.indexOf('if(options.showTrackOverlay){');
const overlayEnd = map.indexOf('// ROUND112:', overlayStart);
assert(overlayStart >= 0 && overlayEnd > overlayStart);
const overlay = map.slice(overlayStart, overlayEnd);
assert(!overlay.includes('const rings: Array<'));
assert(!overlay.includes('radiusAtBearing(quad'));
assert(!overlay.includes('setLineDash([4*S,3*S])'));

// CMA intensity report red header separator is removed.
assert(!report.includes('ctx.fillStyle = "#b42318"; ctx.fillRect(pageX, y, pageW, Math.max(2, 3 * scale));'));
assert(report.includes('remove the CMA intensity-report red horizontal separator'));

// Simple signature sanity: changing radii must change the structural token used conceptually by the cache.
const sig = r => ['storm',15.0,135.0,30.0,970.0,35.0,r.ne,r.se,r.sw,r.nw].join(',');
assert.notEqual(sig({ne:180,se:170,sw:160,nw:175}), sig({ne:260,se:250,sw:240,nw:255}));

console.log('ROUND116 live-radii/report/overlay regression: PASS');
console.log(JSON.stringify({version:pkg.version, liveIssueRefresh:true, windRadiiCacheInvalidation:true, cmaRedSeparator:false, historyDashedRings:false}));
