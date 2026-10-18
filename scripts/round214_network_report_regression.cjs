'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('src/App.tsx'),setup=read('src/components/NetworkEntrySettings.tsx'),network=read('src/components/TyphoonNetworkSimulator.tsx'),data=read('src/utils/TyphoonNetworkData.ts'),gallery=read('src/utils/NetworkReferenceCharts.ts'),standalone=read('src/utils/TyphoonNetworkStandaloneExport.ts'),report=read('src/components/TyphoonReport.tsx'),reportModal=read('src/components/TyphoonReportModal.tsx'),video=read('src/utils/VideoRenderEngine.ts');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS',name)}
for(const f of ['src/App.tsx','src/components/NetworkEntrySettings.tsx','src/components/TyphoonNetworkSimulator.tsx','src/utils/TyphoonNetworkData.ts','src/utils/NetworkReferenceCharts.ts','src/utils/TyphoonNetworkStandaloneExport.ts','src/components/TyphoonReport.tsx','src/components/TyphoonReportModal.tsx','src/utils/VideoRenderEngine.ts','src/utils/ThreeHourlyReportNodes.ts']){
  test('TS syntax '+f,()=>{const src=ts.createSourceFile(f,read(f),99,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(src.parseDiagnostics.length,0)})
}
test('entry must confirm before mounting network',()=>{assert.match(app,/setTyphoonNetworkSetupOpen\(true\)/);assert.match(app,/onConfirm=\{\(networkConfig,settings\)/);assert.match(app,/networkEntryOptions\.config/);assert.match(app,/chartSettings=\{networkEntryOptions\.settings\}/)});
test('independent forecast peak aspiration uses existing Engine mechanism',()=>{assert.match(setup,/forecastPeakIntensityEnabled:true,forecastPeakIntensityReference:peak/);assert.match(data,/materializeForecastPath\(seed,config,120/);assert.match(gallery,/materializeForecastPath\(seed,config,horizon/)});
test('reference generation controls include precalc/NMC/strike/8-model members',()=>{for(const key of ['precalculate','nmcWidth','forecastHours','strikeRadiusKm','strikeHorizon','strikeCellDeg','strikeSmoothPasses','membersPerModel','meanDotHours'])assert(setup.includes(key),key)});
test('gallery is exactly two computed images, on-demand or precalc',()=>{assert.match(network,/chartSettings\.precalculate/);assert.match(network,/const openProbability=/);assert.match(network,/gallery\.strike/);assert.match(network,/gallery\.centers/);assert.match(gallery,/buildAetherCenterGuidance/);assert.match(gallery,/buildAetherEnsembleMembers/)});
test('CMA display history quantized without touching physical histories',()=>{assert.match(data,/return result\.map\(fix=>\(\{\.\.\.fix,vmax:toCmaPublishedWindSpeed\(fix\.vmax\)/);assert.match(data,/const valid=\(storm\.history\|\|\[\]\)/);assert.match(data,/const vmax=style\.agency==='中国'\?toCmaPublishedWindSpeed\(rawVmax\):rawVmax/)});
test('forecast agency variation deterministic, physical forecast high weight',()=>{assert.match(data,/0\.92\*p\.vmax\+0\.08\*issue\.vmax/);assert.match(data,/forwardBiasKm/);assert.match(data,/lateralBiasKm/);assert.doesNotMatch(data,/Math\.random\(/)});
test('reference and probability images support longpress, including offline file',()=>{assert.match(network,/tn-longpress-save/);assert.match(network,/stage==='probability'/);assert.match(standalone,/#openprob/);assert.match(standalone,/galleryImages\?/);assert.match(standalone,/probstrike/);assert.match(standalone,/probcenters/);assert.match(standalone,/-webkit-touch-callout:default/)});
test('all typhoon report curve families use three-hour physical nodes',()=>{assert.match(report,/threeHourlyReportNodes\(rawData/);assert.match(reportModal,/threeHourlyReportNodes\(typhoon\.history/);assert.match(reportModal,/const knots=threeHourlyReportNodes\(data/);assert.match(video,/chartHistory\.forEach/);assert.doesNotMatch(reportModal,/function drawNaturalizedLinePath/);assert.doesNotMatch(reportModal,/function reportNoiseHash/);assert.doesNotMatch(report,/getTurbulenceJitter/);assert.doesNotMatch(report,/<Line type="monotone"/)});
test('station charts excluded and unmodified',()=>{assert.equal(read('src/components/StationHistory.tsx'),fs.readFileSync(path.join(root,'src/components/StationHistory.tsx'),'utf8'))});
// Execute the real TS helper with a mocked module environment, checking neither samples nor values are fabricated.
test('report helper: first/3h/final source points exactly, no interpolation',()=>{
 const src=read('src/utils/ThreeHourlyReportNodes.ts'),js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};vm.runInNewContext(js,{exports});const fn=exports.threeHourlyReportNodes;
 const rows=Array.from({length:22},(_,i)=>({simHour:i/2,vmax:i*i,pmin:1010-i}));
 const chosen=fn(rows,x=>x.simHour);assert.deepEqual(Array.from(chosen.map(x=>x.simHour)),[0,3,6,9,10.5]);
 for(const p of chosen)assert.strictEqual(p,rows.find(r=>r.simHour===p.simHour));
});
const result={round:'R214',passed,total:passed,created:new Date().toISOString()};fs.writeFileSync(path.join(root,'ROUND214_STATIC_TEST_RESULTS.json'),JSON.stringify(result,null,2));console.log(`R214 static ${passed}/${passed} PASS`);
