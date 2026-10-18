const fs = require('fs');
const assert = require('node:assert/strict');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const field = fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const map = fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
assert.equal(pkg.version,'6.0.36','ROUND113 package version mismatch');
assert(field.includes('smooth01(tcBackgroundGate / 0.92)'), 'ocean TC target gate is not continuous-to-zero');
assert(!field.includes('(0.16 + 0.84 * tcBackgroundGate)'), 'fixed 16% ocean target floor remains');
assert(!field.includes('if (gate < 0.68) continue;'), 'hard 0.68 environment gate remains');
assert(!field.includes('gate > 0.92 && speed > 0'), 'hard 0.92 environment gate remains');
assert(field.includes('const marineFloorGate = smooth01((gate - 0.42) / 0.48)'), 'continuous marine floor gate missing');
assert(field.includes('const marineCeilingGate = smooth01((gate - 0.70) / 0.28)'), 'continuous marine ceiling gate missing');
assert(field.includes('async function suppressMarineArtifactBands('), 'ROUND112 marine cleanup lost');
assert(!map.includes('async function detectExtrema('), 'unused H/L extrema calculation still exists');
assert(!map.includes('const extrema=await detectExtrema'), 'H/L extrema calculation still called');
assert(!map.includes('if(storm.id===options.primaryTyphoon.id)continue;'), 'secondary cyclone L labels remain');
assert.equal((map.match(/fillText\(\"L\"/g)||[]).length,1,'renderer should contain exactly one visible L marker');
assert(map.includes('const rasterW = Math.max(MAP.w, Math.round(mapW));'), 'full display-resolution raster lost');
assert(map.includes('ctx.imageSmoothingEnabled=true;'), 'display interpolation lost');

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const smooth01=(v)=>{const x=clamp(v,0,1);return x*x*(3-2*x)};
const floorGate=g=>smooth01((g-0.42)/0.48);
const ceilingGate=g=>smooth01((g-0.70)/0.28);
const targetGate=g=>smooth01(g/0.92);
assert.equal(targetGate(0),0,'target floor does not vanish at TC core');
assert.equal(targetGate(1),1,'target floor does not recover in far field');
let maxFloorJump=0,maxCeilingJump=0,maxTargetJump=0;
let pf=floorGate(0),pc=ceilingGate(0),pt=targetGate(0);
for(let i=1;i<=1000;i++){const g=i/1000;const f=floorGate(g),c=ceilingGate(g),t=targetGate(g);maxFloorJump=Math.max(maxFloorJump,Math.abs(f-pf));maxCeilingJump=Math.max(maxCeilingJump,Math.abs(c-pc));maxTargetJump=Math.max(maxTargetJump,Math.abs(t-pt));pf=f;pc=c;pt=t;}
assert(maxFloorJump<0.004,'marine floor gate has a numerical jump');
assert(maxCeilingJump<0.006,'marine ceiling gate has a numerical jump');
assert(maxTargetJump<0.004,'TC target gate has a numerical jump');
// A 20 m/s far-field wind capped toward 17 m/s must also change continuously as the gate rises.
let prev=20,maxSpeedJump=0;for(let i=0;i<=1000;i++){const g=i/1000;const w=ceilingGate(g);const s=20+(17-20)*w;maxSpeedJump=Math.max(maxSpeedJump,Math.abs(s-prev));prev=s;}
assert(maxSpeedJump<0.02,'continuous ceiling still creates a visible step');
// Spatial proxy for the exact storm-centred ring bug: the old threshold makes a multi-m/s jump at
// one radius, while the new fade remains continuous across a 5-km sampling step.
const radialGate=(r)=>smooth01((r-300)/(525-300));
let oldPrev=20,newPrev=20,oldRadialJump=0,newRadialJump=0;
for(let r=250;r<=575;r+=5){
  const g=radialGate(r);
  const oldSpeed=g>0.92?17:20;
  const w=ceilingGate(g);
  const newSpeed=20+(17-20)*w;
  oldRadialJump=Math.max(oldRadialJump,Math.abs(oldSpeed-oldPrev));
  newRadialJump=Math.max(newRadialJump,Math.abs(newSpeed-newPrev));
  oldPrev=oldSpeed;newPrev=newSpeed;
}
assert(oldRadialJump>2.5,'synthetic control did not reproduce old hard radial seam');
assert(newRadialJump<0.55,'new radial environmental gate is still too abrupt');
console.log('ROUND113 synoptic continuity regression: PASS');
console.log(JSON.stringify({maxFloorGateJump:+maxFloorJump.toFixed(5),maxCeilingGateJump:+maxCeilingJump.toFixed(5),maxTargetGateJump:+maxTargetJump.toFixed(5),maxSpeedJumpMs:+maxSpeedJump.toFixed(5),oldRadialJumpMs:+oldRadialJump.toFixed(3),newRadialJumpMs:+newRadialJump.toFixed(3),primaryOnlyL:true}));
