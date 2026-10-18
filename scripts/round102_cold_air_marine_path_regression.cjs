const fs=require('fs');
const assert=require('node:assert/strict');
const {route,maxStage3AtLat}=require('./cold_air_path_numeric.cjs');
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,'6.0.28');

const field=read('src/simulation/SynopticWindField.ts');
const app=read('src/App.tsx');
for(const token of [
  'function coldAirPathwaySignal',
  'const bohaiWeight = coldAirGaussianLon(x, bohaiCenterLon, 2.25)',
  'const westJapanWeight = 0.56 * coldAirGaussianLon(x, westJapanCenterLon, 2.15)',
  'const eastChinaSeaWeight = coldAirGaussianLon(x, eastChinaSeaCenterLon, 3.7)',
  'const taiwanStraitWeight = 0.95',
  'const bashiWeight = 0.92',
  'const eastPhilippineDecay = 1 - 0.94 * smooth01((24 - lat) / 12);',
  'weight *= 0.18 + 0.22 * (1 - clamp(landInterior, 0, 1));',
  'const rearFadeDeg = [1, 3.2, 3.6, 4.3][strength];',
  'const oceanKt = [0, 24, 28, 32][strength];'
]) assert.ok(field.includes(token),`ROUND102 path token missing: ${token}`);
assert.ok(!field.includes('function coldAirLongitudeWeight'), 'obsolete rectangular longitude sheet remains');
assert.ok(app.includes('渤海和西日本海两支同时南下'), 'UI does not describe dual northern sources');
assert.ok(app.includes('台湾海峡、巴士海峡进入南海'), 'UI does not describe southwest marine split');
assert.ok(app.includes('菲律宾以东海域并更快减弱消散'), 'UI does not describe faster-decaying southeast split');

// Northern sources: simultaneous, but the western Sea-of-Japan source is clearly weaker.
const bohai=route(39,120);
const japan=route(39,130.5);
assert.ok(bohai.weight>.95,`Bohai source too weak: ${bohai.weight}`);
assert.ok(japan.weight>.45 && japan.weight<.68,`western Japan Sea source not clearly weaker: ${japan.weight}`);
assert.ok(japan.weight < bohai.weight*.70,'western Japan Sea source is not clearly weaker than Bohai');
assert.ok(bohai.zonal>0,'Bohai source should bend southeast toward the East China Sea');
assert.ok(japan.zonal<0,'western Japan Sea source should bend southwest toward the East China Sea');

// Merge over East China Sea, then two marine routes around Taiwan.
assert.ok(route(29,124.5).weight>.97,'dual sources do not merge strongly over the East China Sea');
assert.ok(route(23,119).weight>.94,'Taiwan Strait branch is too weak/disconnected');
assert.ok(route(22.5,121.5).weight>.94,'Bashi Channel branch is too weak/disconnected');
assert.ok(route(17,118).weight>.95,'South China Sea downstream branch decays too quickly');

// No fictitious mainland transport axis.
const mainlandOceanEquivalent=route(28,116,false,0).weight;
const mainlandLand=route(28,116,true,.7).weight;
assert.ok(mainlandOceanEquivalent<.10,'route still forms a broad mainland-adjacent sheet at 28N/116E');
assert.ok(mainlandLand<.03 && mainlandLand<mainlandOceanEquivalent*.30,'land suppression does not remove the fictitious mainland path');

// Philippine-Sea branch fades much faster than the South-China-Sea branch.
const scs17=route(17,118).weight, phil17=route(17,130).weight;
const scs12=route(12,117.5).weight, phil12=route(12,132).weight;
assert.ok(phil17 < scs17*.50,`Philippine-Sea branch is not clearly weaker by 17N: ${phil17}/${scs17}`);
assert.ok(phil12 < scs12*.16,`Philippine-Sea branch does not dissipate rapidly enough by 12N: ${phil12}/${scs12}`);
assert.ok(route(17,118).zonal<0 && route(17,130).zonal>0,'downstream branches do not diverge west/east around Taiwan');

// Preserve the corrected ROUND101 intensity envelope: 32 kt nominal, non-uniform >=25 kt body
// spanning about 6.5 degrees latitude along the strongest marine transport axis.
const covered=[];
const body=[];
let maxKt=0;
for(let i=-100;i<=1200;i++){
  const d=i/100, sample=maxStage3AtLat(24+d);
  maxKt=Math.max(maxKt,sample.kt);
  if(sample.kt>=25)covered.push(d);
  if(d>=0 && d<=5.5)body.push(sample.kt);
}
assert.ok(covered.length,'no >=25 kt stage-3 marine footprint');
const span=Math.max(...covered)-Math.min(...covered);
assert.ok(span>=6.40 && span<=6.62,`>=25 kt latitude span is not about 6.5 degrees: ${span}`);
assert.ok(maxKt<=32.01,`stage-3 nominal signal exceeds 32 kt: ${maxKt}`);
assert.ok(Math.max(...body)-Math.min(...body)>1.0,'stage-3 body became uniformly filled');

console.log('ROUND102 cold-air dual-source marine-path regression: PASS');
console.log(JSON.stringify({bohai:bohai.weight,westJapan:japan.weight,scs17,phil17,scs12,phil12,latitude25ktSpanDeg:span,maxKt}));
