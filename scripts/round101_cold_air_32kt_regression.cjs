const fs=require('fs');
const assert=require('node:assert/strict');
const {maxStage3AtLat}=require('./cold_air_path_numeric.cjs');
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'6.0.28');
const field=read('src/simulation/SynopticWindField.ts');
const app=read('src/App.tsx');
const engine=read('src/simulation/Engine.ts');
for(const token of [
  'const oceanKt = [0, 24, 28, 32][strength];','const bodyDepthDeg = [0, 4.0, 4.5, 5.5][strength];',
  'const rearFadeDeg = [1, 3.2, 3.6, 4.3][strength];','meridionalWeight = 0.94 + 0.06 * Math.sin(Math.PI * phase);',
  'const broadTexture = clamp(','const southLoss = [0, 0.08, 0.11, 0.14][strength] * southProgress;'
]) assert.ok(field.includes(token),`ROUND101 corrected cold-air token missing: ${token}`);
assert.ok(!field.includes('const oceanKt = [0, 28, 36, 40][strength];'),'obsolete 40 kt target remains');
assert.ok(app.includes('<span>1 · 约24kt海面</span><span>2 · 约28kt</span><span>3 · 约32kt</span>'),'quick-tool labels are stale');
assert.ok(engine.includes('This response scale is independent of the corrected ~32 kt wind-field target.'),'engine wording regressed');
const covered=[],body=[];
let maxKt=0;
for(let i=-100;i<=1200;i++){
  const d=i/100,s=maxStage3AtLat(24+d);
  maxKt=Math.max(maxKt,s.kt);
  if(s.kt>=25)covered.push(d);
  if(d>=0&&d<=5.5)body.push(s.kt);
}
const span=Math.max(...covered)-Math.min(...covered);
assert.ok(span>=6.40&&span<=6.62,`stage-3 >=25kt latitude span is not about 6.5 degrees: ${span}`);
assert.ok(maxKt<=32.01,`corrected cold-air signal exceeds 32 kt nominal target: ${maxKt}`);
assert.ok(Math.max(...body)-Math.min(...body)>1.0,'25kt body is too uniform');
console.log('ROUND101 corrected 32kt cold-air compatibility regression: PASS');
console.log(JSON.stringify({stage3NominalKt:32,latitude25ktSpanDeg:span,maxResolvedRouteKt:maxKt}));
