const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');

const app = read('src/App.tsx');
const engine = read('src/simulation/Engine.ts');
const transition = read('src/simulation/CirculationSizeTransition.ts');
const pkg = JSON.parse(read('package.json'));

assert(['6.0.6','6.0.7','6.0.8','6.0.9','6.0.10','6.0.11','6.0.12','6.0.13'].includes(pkg.version), 'package version must retain the circulation-transition fix');
assert(pkg.scripts?.['test:circulation-transition'] === 'node scripts/circulation_size_transition_regression.cjs', 'circulation transition regression script missing');
assert(app.includes('resolveCirculationSizeTransition(configRef.current, nowHour).referenceKm'), 'App must resolve the current effective circulation reference before scheduling a new target');
assert(app.includes('totalSimMinutesRef.current / 60'), 'circulation transition must use the fixed-step simulation clock');
assert(app.includes('restoreCirculationSizeConfigFromSnapshot(configRef.current, archivedCirculationIssue.configSnapshot)'), 'timeline seek must restore archived circulation-size controls');
assert(app.includes('"circulationSizeTransitionTargetKm"') && app.includes('historyIssueControlKeys'), 'circulation transition controls must be persisted into issue snapshots');
assert(engine.includes('shouldUseExactCirculationTransitionAnalysis') && engine.includes('exactCirculationTransitionAnalysis ? 1 : 0.52'), 'Engine must not stack a 52% low-pass on top of a requested timed size transition');
assert(engine.includes('manualCirculationTransitionActive || isExactlyOnThreeHour'), 'timed circulation transition must update every physics step, not only every 3 h issuance');
assert(app.includes('pendingCirculationSizeOriginRef') && app.includes('applyCirculationTransitionDuration'), 'size-first then choose-duration UI repair missing');
assert(transition.includes('startHour + state.durationHours + Math.max(0, issueCadenceHours)'), 'first post-deadline 3-hour issuance must still use exact requested transition timing');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-circulation-transition-'));
const entry = path.join(tmpDir, 'numeric.mjs');
fs.writeFileSync(entry, `
import assert from 'node:assert/strict';
import { resolveCirculationSizeTransition, restoreCirculationSizeConfigFromSnapshot, shouldUseExactCirculationTransitionAnalysis } from ${JSON.stringify('file://' + path.resolve('src/simulation/CirculationSizeTransition.ts'))};
const cfg = { circulationSizeReferenceKm:500, circulationSizeTransitionHours:72, circulationSizeTransitionStartHour:10, circulationSizeTransitionFromKm:380, circulationSizeTransitionTargetKm:500 };
const a = resolveCirculationSizeTransition(cfg, 10);
const b = resolveCirculationSizeTransition(cfg, 13);
const c = resolveCirculationSizeTransition(cfg, 46);
const d = resolveCirculationSizeTransition(cfg, 82);
assert.equal(a.referenceKm, 380);
assert.ok(b.referenceKm > 380 && b.referenceKm < 390, '72 h transition completed too much during first 3 h');
assert.ok(Math.abs(c.referenceKm - 440) < 1e-9, '72 h transition midpoint is incorrect');
assert.equal(d.referenceKm, 500);
assert.equal(shouldUseExactCirculationTransitionAnalysis(b,13), true);
assert.equal(shouldUseExactCirculationTransitionAnalysis(d,82), true);
assert.equal(shouldUseExactCirculationTransitionAnalysis(d,86), false);
const future = { circulationSizeReferenceKm:700, circulationSizeTransitionHours:72, circulationSizeTransitionStartHour:100, circulationSizeTransitionFromKm:420, circulationSizeTransitionTargetKm:700, soundEnabled:true };
const archived = { circulationSizeReferenceKm:401, circulationSizeTransitionHours:0, circulationSizeTransitionStartHour:20, circulationSizeTransitionFromKm:400, circulationSizeTransitionTargetKm:400, soundEnabled:false };
const restored = restoreCirculationSizeConfigFromSnapshot(future, archived);
assert.equal(restored.circulationSizeReferenceKm, 400);
assert.equal(restored.circulationSizeTransitionTargetKm, 400);
assert.equal(restored.circulationSizeTransitionStartHour, 20);
assert.equal(restored.soundEnabled, true);
console.log('circulation-size transition numeric regression: PASS');
`);
try {
  execFileSync(process.execPath, ['--experimental-strip-types', entry], { stdio: 'inherit' });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('circulation_size_transition_regression: PASS');
