"use strict";
/** Standalone rollback guard, does not need the original ZIP or UI dependencies. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=(()=>{try{return require('typescript')}catch{return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}})();
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const expectedOriginal={
  "src/App.tsx": "1190d10192554a4640ed59686dd1c5ff6cb90fd72c95f921420fa72c53ac3e9b",
  "src/simulation/AetherEnsembleGuidance.ts": "b8d3c8ba1a4fb3f005eb774c935f06c2ab6b0b0809cd24f537efffe49b258ef1",
  "src/utils/NmcForecastProduct.ts": "542fb84751b75e40478637f6b8626a1fc029f19b8a88f5354dfe1d0123019fd1",
  "src/utils/NmcMapViewport.ts": "578450182147bf9b7e72e399824dd144b732f91cbb0ea5a5f1f8874b86d4e8d6",
  "src/utils/NmcOptionalGeography.ts": "a703b57e9af879f77808a63f62e76cbe435f2dc1735f986db0e507da0baa01a0",
  "src/components/ControlDrawer.tsx": "c36754efcbbc08d51822c6054a98a80f465e42b8a11eb0d4735bce54f58a8419",
  "src/components/MapView.tsx": "530f33de56264673815ba0a7afcb1a46279341e03d9da15589714ca0af8e4864",
  "src/components/ForecastPreSimulation.tsx": "3c3f0d3e4aa43f9a807bbdaaa065853b460cf78fe27c104ddf8645f825862c52",
  "src/components/ForecastSandboxTools.tsx": "43e0f2cdbb5b63e21495807b74846bee1f842246eadf8a3de519809ae7be67b2",
  "src/components/AetherDesktopChrome.tsx": "195a5e0817f57f9b254b6466955d22e0d79bfc4f0d30c1b39248edfd50f948b4",
  "src/components/AetherMobileChrome.tsx": "3fd6a3990fb550bffb75903674558eded8be3a17cf0876acfdbbbf06be33b267",
  "src/components/AetherInputDialog.tsx": "9e9a36d91dc9da6497c2d68ef17ae58dea516381798cf04e09736545dda552d3",
  "src/components/VideoExportModal.tsx": "21a8b5e1252f7f43da5eb0769a03c419fe41c81a058128d2f2fe1585a269dd37",
  "src/main.tsx": "0f3f5788b4a0c7e1d726a1e1ee32d255cac0004cd3c707fbc3e2215e9a50a4fb",
  "scripts/round180_nmc_coastline_fill_regression.cjs": "5bc69e8e1fe3adfac4675c91bef1b97808a1739972b787afe3fee18f960e5423",
  "scripts/round181_nmc_manual_cma_public_bins_regression.cjs": "74f5ad68c53a1c4de83479e6205b6abbd36a5b5fb17c0821a7443599f67f06c7",
  "scripts/round182_nmc_white_crash_regression.cjs": "d29ab01daeba68e2e0520f646a53421cab9be24e091434e1e08808b1d049a41f"
};
const expectedRetained={
  "src/simulation/Engine.ts": "5eb47c16bb8a20bf94960d5626a6e5564dd80eb0f1820027ef59ae9b86a3e01d",
  "src/simulation/EtopoTerrain.ts": "bfc05f79366b3296830c90644b385e64c8eade54ee190b5b4e07387fb768243f",
  "src/simulation/PrecipitationModel.ts": "0fa0725dbc3c912e07074907913a18d8f968c989321c6cb68fc0b9ba4c756094",
  "src/utils/ObservedRainfallMap.ts": "a13d06b3109c8b8a4c95587a07592e3f764dfffe188b0150b527260285c30683",
  "src/utils/StrikeProbabilityField.ts": "8678d3526bfa2713f8e7a4c945a44ab97575f6e2e2586aaec233a7f722d15522",
  "src/utils/StrikeProbabilityProduct.ts": "7da09d54cc5b0cabc5255e9040467560dc29dcaba926b5713598af7f9a64eab5",
  "src/utils/AgencyBranding.ts": "7fd7074459d311fe8d4036cd20fa435da59d937c6935570f93c879ad92091b58",
  "src/utils/EnsembleIntensityAnalysis.ts": "8f1a63992a26ee9234c93576274ea4a70595eb5e6c798797303bfe6908f8a3eb",
  "src/simulation/EnsembleCalibrationMetrics.ts": "a04c463e6fde88011c4588baff85eee74a26e194bbd596e1fa22d1b7f1055c32",
  "src/simulation/RealisticMotionGeometry.ts": "1cd53f9feb8c3b5fcc53bce92a2dff902068dd52eff32c302b2100540aa0b972",
  "src/utils/HistorySnapshot.ts": "dfcd828cafd3204230ecd913e0e1592f43e005d37698dd59cdaf159e592b9df4"
};
for(const [file,hash] of Object.entries(expectedOriginal)){
 if(['src/App.tsx','src/simulation/AetherEnsembleGuidance.ts',
   'src/utils/NmcForecastProduct.ts','src/utils/NmcMapViewport.ts',
   'src/utils/NmcOptionalGeography.ts',
   'scripts/round180_nmc_coastline_fill_regression.cjs'].includes(file))continue;
 assert.equal(digest(read(file)),hash,file+' must match Round184 exactly');
}
// Safety-only exception: NMC retains Round184 appearance and Round185 crash guards.
const nmc=read('src/utils/NmcForecastProduct.ts');
for (const token of ['const BASE_W = 1295','const BASE_H = 1103',
  "ctx.fillText('WMC', 1261, 56)","ctx.fillText('晚风气象台',1165,131,210)",
  'function createNmcOverlaySurface(',"globalCompositeOperation='destination-in'",
  'maxDurationMs?:number','onContextLost', 'AETHER_NMC_OVERLAY_TIMEOUT'])
  assert(nmc.includes(token),'NMC visual baseline/safety requirement missing: '+token);
assert(!/NMC_STYLE_SPECS|styleVersion|nmc2019|nmc2024|drawNmcCycloneGlyph/.test(nmc),
  'NMC dual-style graphics must stay removed');
assert(read('src/utils/NmcMapViewport.ts').includes('Number.isFinite(lon)'),
  'guard nonfinite longitudes');
assert(read('src/utils/NmcOptionalGeography.ts').includes('FETCH_TIMEOUT_MS'),
  'required validated local overlay loader');
const guidance=read('src/simulation/AetherEnsembleGuidance.ts');
const native=guidance.replace('[10,15,20,25,30,40,50,75,100,150,200,300,400,500,750,1000] as const;',
 '[10,15,20,25,30,40,50,75,100,150,200,300,400,500] as const;');
assert.equal(digest(native),expectedOriginal['src/simulation/AetherEnsembleGuidance.ts'],
 'all path/weight/member math must be Round184; only the independent 750/1000 member-size list may differ');
const app=read('src/App.tsx');
assert(!/AuxiliaryRoute|auxiliaryEditMode|auxiliaryForecastRoutes|onMultiRoute|AetherDialogProvider|NumericField/.test(app));
assert(app.includes('makeHourlyHistorySeed'), 'preserve independent R185 history repair');
assert(!read('src/utils/EnsembleReferenceProducts.ts').includes('import { terminateEnsembleTrack }'),
 'legacy ensemble drawing uses its original termination implementation');
for(const file of [
 'src/components/AuxiliaryRoutePreview.tsx','src/components/AuxiliaryRouteWeightBar.tsx','src/simulation/AuxiliaryForecastRoutes.ts',
 'src/components/dialogs/AetherDialogProvider.tsx','src/components/dialogs/AetherNumericPad.tsx','src/components/dialogs/NumericField.tsx'
])assert(!fs.existsSync(path.join(root,file)),file+' should be deleted');
const dead=/\b(?:AuxiliaryForecastRoute|auxiliaryMainRouteWeight|auxiliaryRoutesIssueHour|auxiliaryForecastRoutes|onMultiRoute|NumericField|AetherNumericPad|AetherDialogProvider|useAetherDialog|nmcStyleVersion|NmcStyleVersion|NMC_STYLE_SPECS)\b/;
function walk(dir,fn){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,d.name);if(d.isDirectory())walk(full,fn);else fn(full);}}
let parsed=0,imports=0;
walk(path.join(root,'src'),(name)=>{
 if(!/\.tsx?$/.test(name))return;
 const content=fs.readFileSync(name,'utf8');assert(!dead.test(content),'removed feature referenced in '+name);
 const source=ts.createSourceFile(name,content,ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(source.parseDiagnostics.length,0,'syntax '+name+' '+source.parseDiagnostics.map(d=>d.messageText).join(' / '));parsed++;
 for(const m of content.matchAll(/(?:import|export)\s+(?:[^\n]*?\s+from\s+)?[\x27\x22](\.[^\x27\x22]+)[\x27\x22]/g)){
  const target=path.resolve(path.dirname(name),m[1]);const good=[target,target+'.ts',target+'.tsx',target+'.js',target+'.jsx',path.join(target,'index.ts'),path.join(target,'index.tsx')].some(f=>fs.existsSync(f));
  assert(good,'missing import '+m[1]+' in '+name);imports++;
 }
});
const modal=read('src/components/ForecastImageModal.tsx');
for(const token of ['ensemble_intensity_analysis','ensIntelHorizon','strikeTrackEndMode','strikeStreamingCell','forecast_nmcBorders'])assert(modal.includes(token),'retained feature missing '+token);
assert(!modal.includes('nmc2024'), 'NMC version selection must be removed');
const routes=read('src/utils/EnsembleReferenceProducts.ts');
assert(routes.includes('function stableTrackHash01(')&&routes.includes('const tailHours=14+10*stableTrackHash01('),
 'Round184 ensemble residual track trimming must be restored');
for(const [file,hash] of Object.entries(expectedRetained))assert.equal(digest(read(file)),hash,'unrelated R185 code changed: '+file);
console.log(`ROUND185 ROLLBACK PASS: ${Object.keys(expectedOriginal).length-6} files equal Round184; native guidance math equals Round184; ${Object.keys(expectedRetained).length} unrelated R185 modules bit-identical; ${parsed} TS/TSX parsed; ${imports} relative imports valid; no feature residues`);
