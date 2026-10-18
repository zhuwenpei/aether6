/** AETHER 4.3.13 regression: version bump and White-Dolphin cloud realism terms compile. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '4.3.13');
assert.match(read('index.html'), /<title>AETHER 4\.3\.13 · Typhoon Simulation System<\/title>/);
const engine = read('src/simulation/Engine.ts');
assert.equal((engine.match(/TyphoonSim\/4\.3\.13/g) || []).length, 2);
const tracker = read('src/simulation/HurricaneTrackerPort.ts');
for (const token of ['moistShieldEnvelope', 'drySlotHook', 'exposedSpiral', 'landfallShield', 'deformationTail']) {
  assert(tracker.includes(token), `missing cloud realism token: ${token}`);
}
const compiled = ts.transpileModule(tracker, {
  fileName: 'HurricaneTrackerPort.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
});
assert(!compiled.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error), 'HurricaneTrackerPort.ts must transpile without TS errors');
console.log('round21_regression PASS: version 4.3.13 and White-Dolphin cloud realism signals compile');
