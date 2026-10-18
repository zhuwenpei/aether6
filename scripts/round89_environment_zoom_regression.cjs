const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('node:assert/strict');

function loadTsModule(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`,
    { module, exports: module.exports, require, console, Math }, { filename: file });
  return module.exports;
}

const { diagnoseSynopticEnvironmentalWindTarget } = loadTsModule('src/simulation/SynopticEnvironmentalWindModel.ts');
const fieldSrc = fs.readFileSync('src/simulation/SynopticWindField.ts', 'utf8');
const mapSrc = fs.readFileSync('src/utils/SynopticWindPressureMap.ts', 'utf8');
const modalSrc = fs.readFileSync('src/components/ForecastImageModal.tsx', 'utf8');

function sampleOrdinary(openOcean) {
  const vals = [];
  for (let i = 0; i < 2400; i++) {
    const x = i * 0.173;
    const texture = Math.max(-1, Math.min(1, 0.45 * Math.sin(x) + 0.22 * Math.cos(x * 0.37)));
    const activity = Math.max(0, Math.min(1, 0.35 + 0.22 * Math.sin(x * 0.29)));
    const meanFlow = Math.max(0, Math.min(1, 0.35 + 0.20 * Math.cos(x * 0.17)));
    vals.push(diagnoseSynopticEnvironmentalWindTarget({
      lat: 20, lon: 145, isLand: false, openOcean,
      backgroundTexture: texture, synopticActivity: activity, meanFlow
    }).target10mKt);
  }
  vals.sort((a, b) => a - b);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const q = p => vals[Math.floor((vals.length - 1) * p)];
  return { avg, min: vals[0], p10: q(.1), p50: q(.5), p90: q(.9), max: vals.at(-1), pct16: vals.filter(v => v >= 16).length / vals.length };
}

const coast = sampleOrdinary(0.05);
const midOcean = sampleOrdinary(0.55);
const remote = sampleOrdinary(1.0);
assert.ok(remote.avg > midOcean.avg + 1.4, 'remote ocean no longer trends clearly faster than mid-ocean/coastal water');
assert.ok(midOcean.avg > coast.avg + 1.4, 'offshore speed no longer rises away from coast');
assert.ok(remote.avg >= 18 && remote.avg <= 23.5, `remote-ocean ordinary mean out of target range: ${remote.avg}`);
assert.ok(remote.pct16 > 0.92, `too little remote ocean reaches >=16 kt: ${(remote.pct16 * 100).toFixed(1)}%`);
assert.ok(remote.max <= 34 + 1e-9, 'ordinary non-monsoon/non-westerly flow exceeded 34 kt ceiling');

const deepTrough = diagnoseSynopticEnvironmentalWindTarget({
  lat: 15, lon: 135, isLand: false, openOcean: 1,
  backgroundTexture: -1, synopticActivity: .1, meanFlow: .1
});
assert.ok(deepTrough.target10mKt >= 4 && deepTrough.target10mKt < 10, '4-10 kt deep low-wind trough is unavailable');
assert.equal(deepTrough.ceiling10mKt, 34, 'non-fast-system environmental ceiling is not 34 kt');

const westerly = diagnoseSynopticEnvironmentalWindTarget({
  lat: 42, lon: 145, isLand: false, openOcean: 1,
  backgroundTexture: .4, synopticActivity: .6, meanFlow: .6, westerlyJet: 1
});
const monsoon = diagnoseSynopticEnvironmentalWindTarget({
  lat: 15, lon: 125, isLand: false, openOcean: .8,
  backgroundTexture: .3, synopticActivity: .6, meanFlow: .5, monsoonFlow: 1
});
assert.equal(westerly.ceiling10mKt, 36, 'westerly did not receive 36 kt exceptional-system ceiling');
assert.equal(monsoon.ceiling10mKt, 36, 'monsoon did not receive 36 kt exceptional-system ceiling');
assert.ok(westerly.target10mKt >= 16 && westerly.target10mKt <= 27, 'organized westerly target is outside the revised generally-17-22 kt belt envelope');
assert.ok(monsoon.target10mKt > 28 && monsoon.target10mKt <= 36, 'organized monsoon flow is not materially stronger than ordinary marine flow');

assert.ok(fieldSrc.includes('buildOpenOceanWeight'), 'distance-from-land/open-ocean trend is not wired into wind field');
assert.ok(fieldSrc.includes('openOcean: openOceanWeight[k]'), 'open-ocean weight is not passed to environmental target');
assert.ok(fieldSrc.includes('absoluteEnvironmentalCeilingMs = 36 * 0.514444'), 'hard 36 kt environmental ceiling missing');
assert.ok(fieldSrc.includes('environmentalTarget.ceiling10mKt'), 'per-cell 34/36 kt system ceiling is not enforced before TC blending');
assert.ok(fieldSrc.includes('backgroundCeiling10mMs[k]'), 'post-boundary-layer per-cell environmental ceiling is missing');

const zoomValues = [0.4,0.5,0.6,0.75,0.9,1,1.15,1.3,1.5,1.75,2,2.5,3,3.5,4,5];
for (const z of zoomValues) assert.ok(modalSrc.includes(`<option value={${z}}>`), `synoptic map zoom option ${z}x missing`);
assert.ok(mapSrc.includes('clamp(options.mapZoom ?? 1, 0.4, 5.0)'), 'synoptic map renderer still clamps to old zoom range');
assert.ok(mapSrc.includes('clamp((r7 / 111.12 * 5.2) / zoom, 4, 52)'), 'follow-storm framing does not honor expanded zoom range');

console.log(`Ordinary coastal avg=${coast.avg.toFixed(2)} kt; mid-ocean avg=${midOcean.avg.toFixed(2)} kt; remote avg=${remote.avg.toFixed(2)} kt`);
console.log(`Remote ordinary p10/p50/p90=${remote.p10.toFixed(2)}/${remote.p50.toFixed(2)}/${remote.p90.toFixed(2)} kt; >=16 kt=${(remote.pct16*100).toFixed(1)}%`);
console.log(`Deep trough=${deepTrough.target10mKt.toFixed(2)} kt; westerly=${westerly.target10mKt.toFixed(2)} kt; monsoon=${monsoon.target10mKt.toFixed(2)} kt`);
console.log(`Synoptic map zoom options: ${zoomValues.length} levels, ${zoomValues[0]}x-${zoomValues.at(-1)}x`);
console.log('round89_environment_zoom_regression: PASS');
