const fs=require('fs');
const assert=require('node:assert/strict');
const {route,maxStage3AtLat}=require('./cold_air_path_numeric.cjs');
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json'));
assert.ok(/^6\.0\.(2[4-9]|[3-9]\d)$/.test(pkg.version),`unexpected post-ROUND101 version ${pkg.version}`);
const field=read('src/simulation/SynopticWindField.ts');
for(const token of [
  'function coldAirPathwaySignal','const bodyDepthDeg = [0, 4.0, 4.5, 5.5][strength];',
  'const rearFadeDeg = [1, 3.2, 3.6, 4.3][strength];',
  'meridionalWeight = 0.94 + 0.06 * Math.sin(Math.PI * phase);','const broadTexture = clamp(',
  'const pathway = coldAirPathwaySignal(lat, lon, isLand, landInterior);'
]) assert.ok(field.includes(token),`ROUND100/102 cold-air token missing: ${token}`);
assert.ok(!field.includes('function coldAirLongitudeWeight'),'obsolete rectangular longitude weighting remains');
assert.ok(route(28,116).weight<.10,'field is still broad across inland-adjacent longitudes');
assert.ok(route(28,124.5).weight>.95,'East-China-Sea corridor is not broad enough');
const points=[];
for(let i=-55;i<=900;i++){
  const d=i/100;
  if(maxStage3AtLat(24+d).kt>=25)points.push(d);
}
const span=Math.max(...points)-Math.min(...points);
assert.ok(span>=6.40&&span<=6.62,`stage-3 >=25kt latitude span is not about 6.5 degrees: ${span}`);
const front=maxStage3AtLat(24).kt,middle=maxStage3AtLat(26.5).kt;
assert.ok(front<=middle*1.04,`leading edge is visibly stronger than following air mass: ${front}/${middle}`);
console.log('ROUND100 broad-body/current-path compatibility regression: PASS');
console.log(JSON.stringify({latitude25ktSpanDeg:span,frontKt:front,middleKt:middle}));
