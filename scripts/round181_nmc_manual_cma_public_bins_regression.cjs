'use strict';
/** Round181: NMC manual peak changes ONLY the model's product-only wind series;
 * every NMC callout (including the manually targeted fix) publishes CMA public
 * wind bins, Beaufort force and category derived from that same published value.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = (() => { try { return require('typescript'); } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); } })();
const source = name => fs.readFileSync(name,'utf8');
const engineText = source('src/simulation/Engine.ts');
const renderText = source('src/utils/NmcForecastProduct.ts');
const modalText = source('src/components/ForecastImageModal.tsx');
const engineTree = ts.createSourceFile('Engine.ts',engineText,ts.ScriptTarget.ES2022,true);
const renderTree = ts.createSourceFile('NmcForecastProduct.ts',renderText,ts.ScriptTarget.ES2022,true);
const pick = (tree,names) => {
  const found = tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
  assert.equal(found.length,names.length,`missing function: ${names}`);
  return found.map(n=>n.getText(tree)).join('\n');
};
const binStart=engineText.indexOf('const CMA_PUBLIC_WIND_BINS = [');
const binEnd=engineText.indexOf('/**\n * The simulator keeps one CMA-like',binStart);
assert(binStart>=0&&binEnd>binStart);
const engineFunctions = pick(engineTree,['getAgencyIntensity','getWindForceCategory']);
const rendererFunctions = pick(renderTree,['isNmcExtratropical','category','classification','cmaNmcAssessment']);
const code='const MIN_CYCLONE_INTENSITY_MS=5;\n'+engineText.slice(binStart,binEnd)+'\n'+engineFunctions+'\n'+rendererFunctions+
  '\nmodule.exports={getAgencyIntensity,getWindForceCategory,cmaNmcAssessment};';
const output=ts.transpileModule(code,{fileName:'round181_merged.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const mod={exports:{}};
vm.runInNewContext(output.outputText,{module:mod,exports:mod.exports,Math,Number,Array,Object,
 PALETTE:{et:'#999',td:'#ff0',ts:'#00f',sts:'#0f0',ty:'#f90',sty:'#f0f',super:'#f00'}},
 {filename:'round181_merged.js'});
const {getAgencyIntensity, cmaNmcAssessment:assess}=mod.exports;
const cases=[
  // raw manual peak -> CMA displayed bin, wind force, named typhoon category
  [15.7244884,15,7,'热带低压'],
  [17.1,18,8,'热带风暴级'],
  [24.4,25,10,'强热带风暴级'],
  [32.5,33,12,'台风级'],
  [40.2,40,13,'台风级'],
  [42.3,42,14,'强台风级'],
  [44,45,14,'强台风级'],
  [50.8,50,15,'强台风级'],
  [51.2,52,16,'超强台风级'],
  [54,55,16,'超强台风级'],
  [57,58,17,'超强台风级'],
  [60,60,17,'超强台风级'],
  [61.5,62,17,'超强台风级'],
  [67,68,17,'超强台风级'],
  [67.63333099702145,68,17,'超强台风级'],
  [69,68,17,'超强台风级'],
  [73,72,17,'超强台风级']
];
for(const [raw, wind, force, name] of cases){
  const actual=assess(raw);
  assert.equal(actual.wind,wind,`CMA public speed at ${raw}`);
  assert.equal(actual.force,force,`force at ${raw}`);
  assert.equal(actual.name,name,`category at ${raw}`);
  assert.equal(actual.wind,getAgencyIntensity(raw,'CMA','public').value,
    `the renderer did not use the official simulator CMA reporting path at ${raw}`);
  assert.equal(Number.isInteger(actual.wind),true,`manual peak ${raw} leaked a raw decimal`);
}
assert.equal(assess(66,'温带气旋').name,'温带气旋', 'ET overrides wind category');
assert.equal(assess(66,'RL').name,'残留低压', 'RL overrides wind category');
assert(renderText.includes('const published = cmaNmcAssessment(pt.vmax, pt.category);'),
 'NMC callouts must not pass any manual peak exact-display override');
assert(renderText.includes('`${published.wind}m/s,${published.wind >= 62 ? "17级以上" : `${published.force}级`}`'),
 'force label must be determined by the published (binned) wind');
assert(!renderText.includes('customPeakWind') && !modalText.includes('customPeakWind: applyImagePeak'),
 'manual peak must never bypass CMA public bins on NMC callouts');
assert(modalText.includes('shapeNmcPeakIntensity(limitedForecast,requestedPeak,Number(issue.vmax))'),
 'manual peak must still alter the NMC-only intensity curve');
// Check that 17 and 17+ labels are separated at the public 62 m/s fix.
const forceLabel=wind=>wind>=62?'17级以上':`${assess(wind).force}级`;
assert.equal(forceLabel(60),'17级');
assert.equal(forceLabel(62),'17级以上');
const guidanceText=source('src/simulation/NmcIntensityGuidance.ts');
const guidanceModule={exports:{}};
vm.runInNewContext(ts.transpileModule(guidanceText,{fileName:'NmcIntensityGuidance.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {module:guidanceModule,exports:guidanceModule.exports,Math,Number,Array,Object,Map,Set,Error,RangeError});
const {shapeNmcPeakIntensity}=guidanceModule.exports;
const base=Array.from({length:13},(_,i)=>({simHour:i*6,lat:17+i*.1,lon:148-i*.2,vmax:25+14*Math.sin(Math.PI*i/12),pmin:985,
  category:'台风',landed:false,preSimulationGuided:true}));
for(const target of [54,67]){
 const adjusted=shapeNmcPeakIntensity(base,target,25);
 const actualPeak=Math.max(25,...adjusted.map(p=>p.vmax));
 assert(Math.abs(actualPeak-target)<1e-6,`physical NMC-only peak ${target} was changed`);
 const peakFix=adjusted.find(p=>Math.abs(p.vmax-target)<1e-6);
 assert(peakFix,'a peak fix must appear in the product');
 assert.equal(assess(peakFix.vmax).wind,target===54?55:68,
   'the SAME physical peak must display the nearest CMA public wind bin');
 assert(base.every((p,i)=>p.vmax===25+14*Math.sin(Math.PI*i/12)),
   'shaping must not change the underlying normal forecast data');
}
console.log('ROUND181 PASS: manual peaks preserve exact NMC-only physics, CMA public bins for all callouts, 17/17+ and typhoon category consistent ('+cases.length+' bin boundaries)');
