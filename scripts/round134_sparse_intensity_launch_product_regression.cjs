const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const app = fs.readFileSync('src/App.tsx', 'utf8');
const editor = fs.readFileSync('src/components/ForecastIntensityCurveEditor.tsx', 'utf8');
const modal = fs.readFileSync('src/components/ForecastImageModal.tsx', 'utf8');
const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const splash = fs.readFileSync('src/index.css', 'utf8');

// Unit-test the exact production interpolation module, compiled without app dependencies.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-r134-'));
try {
  execFileSync('tsc', ['src/utils/manualForecastIntensityCurve.ts', '--target', 'es2020', '--module', 'commonjs', '--skipLibCheck', '--outDir', dir], { stdio: 'pipe' });
  const { buildManualIntensityPreview, makeManualIntensityAnchors, getManualIntensityAtLead } = require(path.join(dir, 'manualForecastIntensityCurve.js'));
  const physical = Array.from({ length: 81 }, (_, i) => ({ leadHour: i * 3, vmax: i % 2 ? 5 : 85, lat: 15 + i / 10, lon: 145 - i / 10, speedKmh: 18 }));
  const controls = [{ leadHour: 24, vmax: 30 }, { leadHour: 72, vmax: 70 }];
  const anchors = makeManualIntensityAnchors(physical, controls);
  assert.deepEqual(anchors.map(p => p.leadHour), [0, 24, 72]);
  assert.equal(getManualIntensityAtLead(anchors, 48), 50);
  assert.equal(getManualIntensityAtLead(anchors, 60), 60);
  const preview = buildManualIntensityPreview(physical, controls);
  for (const [hour, expected] of [[24,30], [27,32.5], [36,40], [48,50], [60,60], [72,70], [120,70], [240,70]]) {
    assert.equal(preview.find(p => p.leadHour === hour).vmax, expected, `bad piecewise line at +${hour}h`);
  }
  assert.equal(buildManualIntensityPreview(physical, []).find(p => p.leadHour === 27).vmax, 5, 'no edits must retain original physical curve');
  const odd = buildManualIntensityPreview(physical, [{ leadHour: 37, vmax: 40 }, { leadHour: 89, vmax: 65 }]);
  assert.equal(odd.find(p => p.leadHour === 37).vmax, 40, 'control points must not snap to 3h preset ticks');
  assert.equal(odd.find(p => p.leadHour === 89).vmax, 65);
  assert(Math.abs(odd.find(p => p.leadHour === 63).vmax - 52.5) < 1e-7);
  assert.equal(anchors.length, 3, 'serialization must use only real control anchors');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

assert(app.includes('calculateForecastTrackPath(mainTy, curveConfig, 240)'));
assert(app.includes('materializeForecastPath(mainTy, curveConfig, 240, geometry)'));
assert(app.includes('makeManualIntensityAnchors(forecastIntensityDefaultSamples, forecastIntensityControlPoints)'));
assert(!app.includes('forecastIntensitySamples.map((sample) => ({ leadHour: sample.leadHour, vmax: sample.vmax }))'), 'do not serialize all old 3h reference samples');
assert(editor.includes('const chosenHour = nearestHandle ?? clamp(Math.round(rawLead), 1, maxLead)'));
assert(engine.includes('a.vmax + (b.vmax - a.vmax) * t'), 'physical intensity must interpolate controls linearly');

const jmaOptions = modal.split('{imageStyle === "jma_forecast" && (')[1].split('{imageStyle === "standard" && (')[0];
const standardOptions = modal.split('{imageStyle === "standard" && (')[1].split('历史路径业务打点')[0];
for (const [name, block] of [['JMA', jmaOptions], ['CMA', standardOptions]]) {
  assert(!/value=\{(?:144|168|192|216|240)\}/.test(block), `${name} has Round133 extended forecast hours`);
  assert(block.includes('<option value={120}>120 小时</option>'));
}
assert(modal.includes('return [24, 48, 72, 96, 120].includes(stored) ? stored : 120;'), 'stale extended product-hour preference must be clamped');
assert(!modal.includes('240 小时（扩展模拟）'));
assert(app.includes('{!termsAccepted && (\n          <AetherTermsModal'), 'disclaimer must already be mounted behind splash');
assert(!app.includes('{launchFinished && !termsAccepted && ('), 'late disclaimer mount recreates exposed blank gap');
assert(splash.includes('z-index: 20000;') && modal.includes('jma_forecast'), 'startup overlay remains above disclaimer');
console.log('ROUND134 sparse intensity interpolation / product-hour restoration / seamless terms: PASS');
