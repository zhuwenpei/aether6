/* Round183: real ensemble strike probability regression (no browser and no external dependency). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root = path.resolve(__dirname, '..');
// Round185: permit newly split TS utility dependencies when the standalone source tester loads a module.
require.extensions['.ts'] = (m, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const out = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename});
  m._compile(out.outputText,filename);
};

function loadTs(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName:file });
  if (result.diagnostics?.length) throw new Error(`${file}: ${result.diagnostics.map(d => d.messageText).join('; ')}`);
  const m = new Module(path.join(root,file),module);m.filename = path.join(root,file);m.paths=module.paths;
  m._compile(result.outputText,m.filename);return m.exports;
}
const f=loadTs('src/utils/StrikeProbabilityField.ts');
const point=(lat,lon,h)=>({lat,lon,vmax:28,pmin:976,leadHour:h,simHour:h});
const member=(name,track)=>({id:name,modelId:'WNV3',control:false,memberNumber:1,color:'#000',track,maxVmax:28,minPmin:976});
const cross=member('cross',[point(0,-3,0),point(0,3,3)]);
const far=member('far',[point(9,9,0),point(9,10,3)]);
const repeat=member('repeat',[point(0,-3,0),point(0,3,3),point(0,-3,6),point(0,3,9)]);
const prob=(members,lat=0,lon=0,r=100,h=24)=>f.computeSiteProbability(members,{lat,lon},r,h);
assert.equal(prob([cross]),100,'single segment crossing must be 100%');
assert.equal(prob([cross],4,4),0,'distant single member must be 0%');
assert.equal(prob([cross,far]),50,'one of two members hits');
assert.equal(prob([repeat,far]),50,'repeating one member never counts twice');
assert.equal(prob([cross],0,0,100,3),100,'segment to line distance counts when long nodes separated');
assert.equal(prob([far],0,0),0);
const gridOptions={bounds:{minLat:-2,maxLat:2,minLon:-4,maxLon:4},radiusKm:100,cellDeg:.1,horizonHours:24,smoothPasses:0};
(async()=>{
  const field=await f.computeStrikeField([cross,far],gridOptions);
  assert.equal(field.memberCount,2);
  assert.equal(Math.round(f.sampleStrikeField(field,0,0)),50);
  assert.equal(Math.round(f.sampleStrikeField(field,1.99,0)),0);
  const again=await f.computeStrikeField([repeat,far],gridOptions);
  assert.equal(Math.round(f.sampleStrikeField(again,0,0)),50,'cell stamp prevents duplicates');
  let c=new AbortController();c.abort();
  await assert.rejects(f.computeStrikeField([cross],{...gridOptions,signal:c.signal}),err=>err?.name==='AbortError');
  const coast=f.unwrapStrikeLon(-179,179);assert.equal(coast,181,'dateline continuation');
  const src=fs.readFileSync(path.join(root,'src/utils/EnsembleReferenceProducts.ts'),'utf8');
  assert.match(src,/id: "strike_probability_120km"/);
  assert.match(src,/aspect: 2030 \/ 1840/);
  assert.doesNotMatch(src,/strike_probability_map|drawProbabilityBand|STRIKE_PROBABILITY_SITES/);
  const modal=fs.readFileSync(path.join(root,'src/components/ForecastImageModal.tsx'),'utf8');
  for(const forbidden of ['setImageStyle("strike_probability")','袭击概率产品','彩色海岸线＝沿岸袭击概率'])assert.ok(!modal.includes(forbidden),`deprecated text: ${forbidden}`);
  for(const token of ['resolveEnsembleHorizon(ensembleReferenceStyle)','drawEnsembleReferenceProductAsync','forecast_','strikeFieldCacheRef','ensembleStrikeHorizonHours'])assert.ok(modal.includes(token),`missing: ${token}`);
  const sites=loadTs('src/utils/StrikeProbabilitySites.ts').STRIKE_SITES;
  assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);
  assert.ok(sites.filter(s=>s.group==='TW').length>=20);
  console.log('strike_probability_regression: all checks passed (segment, 50%, once-per-member, grid, dateline, cancel, UI, styles, sites)');
})().catch(e=>{console.error(e);process.exitCode=1;});
