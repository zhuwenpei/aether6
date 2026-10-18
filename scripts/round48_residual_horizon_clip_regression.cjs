const fs=require('fs');
const assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const product=fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');

assert(modal.includes('forecast_ensembleTotalForecastHours'),'special ensemble total-horizon persistence missing');
assert(modal.includes('[72,96,120,144,168]'),'total horizon choices missing');
assert((modal.match(/const ensembleHorizon = residualContinuationProduct \? ensembleTotalForecastHours : 168/g)||[]).length>=3,'total horizon not wired through preview/generation flows');
assert((modal.match(/calculateForecastPath\(primaryStorm, config, ensembleHorizon, false, true\)/g)||[]).length>=2,'residual path still ignores selected total horizon');
assert(modal.includes('horizon: ensembleHorizon'),'ensemble member builder still ignores selected horizon');
assert(modal.includes('forecastHorizonHours: ensembleHorizon'),'renderer does not receive total horizon');

const pressureStart=product.indexOf('function drawPressureSpaghetti');
const pairedStart=product.indexOf('function drawPairedCycle');
const end=product.indexOf('function drawCategoryWindBands',pairedStart);
assert(pressureStart>=0&&pairedStart>pressureStart&&end>pairedStart,'special ensemble renderers missing');
const pressure=product.slice(pressureStart,pairedStart);
const paired=product.slice(pairedStart,end);
for(const [name,src] of [['pressure',pressure],['paired',paired]]){
  assert(src.includes('forecastHorizonHours'),'forecast horizon not consumed by '+name);
  assert(src.includes('ctx.rect(mapRect.x,mapRect.y,mapRect.w,mapRect.h);ctx.clip()'),'map clipping missing in '+name);
  assert(src.includes('boundsForOperationalForecast(args,mapRect,true)'),'normal-stop viewport missing in '+name);
}
assert(product.includes('function trimTrackToHorizon'),'horizon trim helper missing');

for(const file of ['src/components/ForecastImageModal.tsx','src/utils/EnsembleReferenceProducts.ts']){
  const source=fs.readFileSync(file,'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:file});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length) throw new Error(file+' syntax errors: '+errors.map(e=>String(e.messageText)).join('; '));
}
console.log('Round 48 total-horizon/clip regression passed.');
