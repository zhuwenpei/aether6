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

const source = fs.readFileSync('src/simulation/TropicalCycloneVortex.ts', 'utf8');
assert.ok(source.includes('softWindRadiiShapeScale'), 'soft multi-radii shape guidance missing');
assert.ok(source.includes('radiiGuidanceWeight'), 'soft wind-radii magnitude guidance missing');
assert.ok(!source.includes('Math.max(vg * 0.72, radiiTarget)'), 'hard max wind-radii stencil returned');
assert.ok(source.includes('const compactness = 0.97'), 'slight circulation tightening missing');

const { sampleTropicalCycloneVortex, targetWindFromQuadrantRadii } = loadTsModule('src/simulation/TropicalCycloneVortex.ts');

function pointAt(storm, bearing, rKm) {
  const a = bearing * Math.PI / 180;
  return {
    lat: storm.lat + Math.cos(a) * rKm / 111.12,
    lon: storm.lon + Math.sin(a) * rKm / (111.12 * Math.max(0.2, Math.cos(storm.lat * Math.PI / 180)))
  };
}

const base = {
  id:'R86', name:'R86', lat:20, lon:130, vmax:60, pmin:930, direction:300, speed:18, rmw:30,
  r7:{ne:260,se:280,sw:240,nw:250}, r10:{ne:150,se:160,sw:135,nw:145}, r12:{ne:85,se:92,sw:76,nw:82},
  category:'SuperTY', landed:false, dissipated:false, extrTransition:0, ewrcState:'none', ewrcProgress:0,
  active:true, history:[], simHour:0
};
const env = { slp:1010, shearU:5, shearV:2 };

function tenMeterSpeed(storm, bearing, rKm) {
  const p = pointAt(storm, bearing, rKm);
  const s = sampleTropicalCycloneVortex(p.lat, p.lon, storm, env);
  // Vortex slab seeds compensate a representative 0.86 marine 10 m transfer.
  return Math.hypot(s.u, s.v) * 0.86;
}
function lastThresholdRadius(storm, threshold=13.9, bearing=45) {
  let last = 0;
  for (let r=30; r<=700; r+=2) if (tenMeterSpeed(storm, bearing, r) >= threshold) last = r;
  return last;
}
function scaleQuad(q, factor) {
  return Object.fromEntries(Object.entries(q).map(([k,v]) => [k, v * factor]));
}

const baseCross = lastThresholdRadius(base);
const r7Reference = base.r7.ne;
assert.ok(baseCross >= r7Reference * 0.86 && baseCross <= r7Reference * 0.96,
  `circulation not slightly inside wind-circle guidance: cross=${baseCross}, ref=${r7Reference}`);

// The operational radius should guide the field, but should not be copied as an exact 34-kt contour.
const atR7 = tenMeterSpeed(base, 45, r7Reference);
const hardReference = targetWindFromQuadrantRadii(base, 45, r7Reference);
assert.ok(Math.abs(hardReference - 13.9) < 0.5, 'reference curve itself lost the R7 meaning');
assert.ok(Math.abs(atR7 - 13.9) > 0.75,
  `R7 was hard-copied into the final vortex: speed=${atR7.toFixed(2)} m/s`);

// Larger wind circles must still make the circulation larger, but less than 1:1.
const larger = { ...base, r7:scaleQuad(base.r7,1.25), r10:scaleQuad(base.r10,1.25), r12:scaleQuad(base.r12,1.25) };
const largerCross = lastThresholdRadius(larger);
assert.ok(largerCross > baseCross + 20, `wind-circle enlargement no longer influences circulation: ${baseCross} -> ${largerCross}`);
assert.ok(largerCross / baseCross < 1.20, `wind-circle enlargement is being copied too literally: ${baseCross} -> ${largerCross}`);

// Each operational wind-circle level participates near its own radial band.
const largerR12 = { ...base, r12:scaleQuad(base.r12,1.25) };
const largerR10 = { ...base, r10:scaleQuad(base.r10,1.25) };
const largerR7 = { ...base, r7:scaleQuad(base.r7,1.25) };
assert.ok(tenMeterSpeed(largerR12,45,100) > tenMeterSpeed(base,45,100) + 0.5, 'R12 has no inner-core influence');
assert.ok(tenMeterSpeed(largerR10,45,180) > tenMeterSpeed(base,45,180) + 0.5, 'R10 has no middle-core influence');
assert.ok(tenMeterSpeed(largerR7,45,260) > tenMeterSpeed(base,45,260) + 0.5, 'R7 has no outer-core influence');

console.log(`ROUND86 radii-reference: base R7 ref=${r7Reference.toFixed(0)} km, diagnosed 34-kt edge=${baseCross.toFixed(0)} km, speed@R7=${atR7.toFixed(2)} m/s`);
console.log(`ROUND86 larger-radii case: R7 ref=${larger.r7.ne.toFixed(0)} km, diagnosed 34-kt edge=${largerCross.toFixed(0)} km`);
console.log('round86_circulation_radii_reference_regression: PASS');
