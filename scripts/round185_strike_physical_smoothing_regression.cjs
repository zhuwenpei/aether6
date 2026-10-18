'use strict';
const assert=require('node:assert/strict');
const {load}=require('./round185_test_loader.cjs');
const f=load('src/utils/StrikeProbabilityField.ts');
const n=65,raw=new Float32Array(n*n);
raw[32*n+32]=100;
for(const cell of [.0025,.005,.01,.05])for(const passes of [1,2]){
 const out=f.smoothGridPhysical(raw,n,n,cell,passes);
 assert.equal(raw[32*n+32],100,'raw source mutated');
 assert.notEqual(out,raw,'smoothed array should not alias raw');
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const horizontal=out[y*n+x],transposed=out[x*n+y];
  assert(Math.abs(horizontal-transposed)<.0002,`anisotropic smoothing at ${cell} / ${passes}`);
  assert(Number.isFinite(horizontal)&&horizontal>=0);
 }
}
assert.strictEqual(f.smoothGridPhysical(raw,n,n,.01,0),raw,'no smoothing must be identity');
console.log('ROUND185 STRIKE SMOOTHING PASS: four meshes, two smoothing levels, symmetric, source unchanged');
