const fs=require('fs');
const assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const product=fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');

assert(modal.includes('总预报时效'),'UI still labels special horizon as residual-only');
assert(!modal.includes('>残余低涡预报时效<'),'old residual-only label still present');
assert(modal.includes('forecast_ensembleTotalForecastHours'),'total horizon key missing');
assert(modal.includes('forecast_ensembleSpecialMapRangeMode'),'map-range basis persistence missing');
assert(modal.includes('默认 · 正常停编路径'),'default operational framing option missing');
assert(modal.includes('显示全部成员路径'),'show-all framing option missing');
assert(modal.includes('specialMapRangeMode: ensembleSpecialMapRangeMode'),'map-range mode not passed to product renderer');

assert(product.includes('specialMapRangeMode?: "operational" | "all"'),'renderer map-range contract missing');
assert(product.includes('function trimTrackToPostFiveWindow'),'post-5 m/s display-tail helper missing');
assert(product.includes('14+10*stableTrackHash01'),'member-specific 14–24 h tail not encoded');
assert(product.includes('finite(pt.vmax,999)<=5.0'),'5 m/s threshold missing');
assert((product.match(/args\.specialMapRangeMode==="all"/g)||[]).length>=4,'both special products do not honor show-all map framing/footer');
assert(product.includes('boundsForTracks(allRangeTracks,EMPTY_HISTORY,mapRect,true)'),'pressure spaghetti show-all range does not use all generated members');
assert(product.includes('boundsForTracks([...current,...paired],EMPTY_HISTORY,mapRect,true)'),'dual-cycle show-all range does not use both cycles');
assert(engine.includes('!continueResidualToDissipation && currentVmax <= MIN_CYCLONE_INTENSITY_MS'),'residual reference does not terminate at the 5 m/s floor before member-tail rendering can work');

for(const file of ['src/components/ForecastImageModal.tsx','src/utils/EnsembleReferenceProducts.ts','src/simulation/Engine.ts']){
  const source=fs.readFileSync(file,'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:file});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errors.length) throw new Error(file+' syntax errors: '+errors.map(e=>String(e.messageText)).join('; '));
}
console.log('Round 49 total horizon / post-5 tail / map-range regression passed.');
