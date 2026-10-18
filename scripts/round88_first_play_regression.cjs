const fs = require('fs');
const { execFileSync } = require('child_process');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert(['6.0.11','6.0.12','6.0.13'].includes(pkg.version), 'package version must retain the 6.0.11 first-play fix');
assert(engine.includes('const currentPmin = Math.max(850, Math.min(1045, Number.isFinite(ty.pmin) ? ty.pmin : 998));'), 'safe pressure lower/upper bound missing');
assert(engine.includes('newPmin = Math.max(850, Math.min(1045, newPmin));'), 'safe post-update pressure bound missing');
assert(!/\bclamp\s*\(\s*newPmin\s*,\s*850\s*,\s*1045\s*\)/.test(engine), 'undefined clamp() call still present in first-step pressure path');
assert(!/\bclamp\s*\(\s*Number\.isFinite\(ty\.pmin\)/.test(engine), 'undefined clamp() call still present in current pressure path');
assert(app.includes('Simulation step failed:') && app.includes('模拟计算异常，已暂停'), 'first-step runtime errors must remain user-visible');
assert(engine.includes('active: true') && engine.includes('dissipated: false'), 'newly created storm must start active and non-dissipated');

let output = '';
try {
  execFileSync('tsc', [
    '--noEmit', '--pretty', 'false', '--target', 'ES2022', '--module', 'ESNext',
    '--moduleResolution', 'Bundler', '--skipLibCheck', 'src/simulation/Engine.ts'
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  output = String(err.stdout || '') + String(err.stderr || '');
  const critical = output.match(/TS(?:2304|2448|2454|2552):[^\n]*/g) || [];
  if (critical.length) throw new Error(`Engine semantic first-step regression: ${critical.join(' | ')}`);
}

console.log('round88_first_play_regression: PASS');
