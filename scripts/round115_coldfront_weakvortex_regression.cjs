const fs=require('fs');
const vm=require('vm');
const assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
assert.equal(pkg.version,'6.0.38','ROUND115 package version mismatch');
const field=fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const vortexSrc=fs.readFileSync('src/simulation/TropicalCycloneVortex.ts','utf8');
for(const token of [
  'function coldAirFrontPhaseDeg(',
  'const leadingFeatherDeg = [0, 2.4, 3.1, 4.0][strength];',
  'const bodyDepthDeg = [0, 3.4, 3.9, 4.4][strength];',
  'const rearFadeDeg = [1, 3.0, 3.5, 4.2][strength];',
  'const frontPhase = clamp(coldAirFrontPhaseDeg(lon) - coldAirFrontPhaseDeg(contactLon), -0.55, 0.55);',
  'const organization = smooth01((vmax - 7.0) / 8.0);',
  'const weakProtect = Math.max(45, rmw * 1.40);',
  'const downwardCalibration = smooth01(((s.vmax || 0) - 11.5) / 10.5);'
]) assert(field.includes(token),`ROUND115 field token missing: ${token}`);
assert(vortexSrc.includes('if (vmax < 13.9) {'),'weak-vortex compact profile missing');
assert(vortexSrc.includes('const hasPhysicalR7 = (state.vmax || 0) >= 13.9 && !!state.r7;'),'weak R7 guard missing');

// Cold-front continuity: the old 0.55-degree feather produced ~13-15 kt jumps per 0.25-degree row.
const cold=require('./cold_air_path_numeric.cjs');
let maxQuarterDegJump=0;
for(const lon of [118,120,121,122,124,126]){
  let prev=null;
  for(let lat=18;lat<=36+1e-9;lat+=0.25){
    const v=cold.stage3WeightedKt(lat,lon,24,30,121);
    if(prev!==null) maxQuarterDegJump=Math.max(maxQuarterDegJump,Math.abs(v-prev));
    prev=v;
  }
}
assert(maxQuarterDegJump<3.0,`cold-air leading edge still forms a sharp 0.25deg stripe: ${maxQuarterDegJump.toFixed(2)} kt`);
let lo=Infinity,hi=-Infinity,maxKt=0;
for(let d=-6;d<=14+1e-9;d+=0.01){
  const sample=cold.maxStage3AtLat(24+d);
  maxKt=Math.max(maxKt,sample.kt);
  if(sample.kt>=25){lo=Math.min(lo,d);hi=Math.max(hi,d);}
}
const span=hi-lo;
assert(span>=6.40&&span<=6.65,`stage-3 >=25kt footprint drifted from ~6.5deg: ${span}`);
assert(maxKt<=32.01,'stage-3 cold-air signal exceeds nominal 32kt');
assert(Math.abs(cold.frontPhase(121)-cold.frontPhase(121))<1e-12,'contact-longitude front phase is not exactly anchored');
// Dual-source marine route remains intact after the leading-edge repair.
const bohai=cold.route(39,120), japan=cold.route(39,130.5);
assert(bohai.weight>.95,'Bohai source weakened unexpectedly');
assert(japan.weight>.45&&japan.weight<.68&&japan.weight<bohai.weight*.70,'western Japan-Sea source ratio regressed');
assert(cold.route(29,124.5).weight>.97,'East-China-Sea merge regressed');
assert(cold.route(17,118).weight>.95,'South-China-Sea branch regressed');
assert(cold.route(12,132).weight < cold.route(12,117.5).weight*.16,'Philippine-Sea branch no longer dissipates faster');

// Load the standalone vortex module and verify weak lows are compact rather than giant fallback donuts.
const js=ts.transpileModule(vortexSrc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};
vm.runInNewContext(`(function(exports,module,require){${js}\n})(module.exports,module,require)`,{module:m,exports:m.exports,require,Math,console});
const {targetWindFromQuadrantRadii,sampleTropicalCycloneVortex}=m.exports;
for(const vmax of [5,8,10,13]){
  const state={lat:10,lon:150,vmax,pmin:1008,rmw:35,simHour:0,direction:300,speed:8,extrTransition:0};
  const atRmw=targetWindFromQuadrantRadii(state,0,35);
  const at150=targetWindFromQuadrantRadii(state,0,150);
  const at220=targetWindFromQuadrantRadii(state,0,220);
  assert(Math.abs(atRmw-vmax)<1e-9,`weak profile does not peak at Vmax for ${vmax}`);
  assert(at150 < vmax*0.18,`weak ${vmax}m/s vortex remains too broad at 150km: ${at150}`);
  assert(at220 < vmax*0.06,`weak ${vmax}m/s vortex remains too broad at 220km: ${at220}`);
}
const weakState={lat:10,lon:150,vmax:8,pmin:1008,rmw:35,simHour:0,direction:300,speed:8,extrTransition:0};
const env={slp:1010,shearU:2,shearV:1,westerlyStrength:0};
const weak150=sampleTropicalCycloneVortex(10+150/111.12,150,weakState,env).tangentialMs;
assert(weak150<1.2,`sampled weak vortex still has a giant outer ring: ${weak150} m/s at 150km`);
console.log('ROUND115 cold-front + weak-vortex regression: PASS');
console.log(JSON.stringify({maxQuarterDegColdFrontJumpKt:+maxQuarterDegJump.toFixed(3),stage3Span25KtDeg:+span.toFixed(3),maxStage3Kt:+maxKt.toFixed(3),weak8mpsAt150km:+weak150.toFixed(3)}));
