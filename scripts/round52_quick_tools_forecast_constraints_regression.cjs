const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const app=fs.readFileSync('src/App.tsx','utf8');
const mobile=fs.readFileSync('src/components/AetherMobileChrome.tsx','utf8');
const engine=fs.readFileSync('src/simulation/Engine.ts','utf8');
const ens=fs.readFileSync('src/simulation/AetherEnsembleGuidance.ts','utf8');
const products=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const ref=fs.readFileSync('src/utils/EnsembleReferenceProducts.ts','utf8');
const css=fs.readFileSync('src/index.css','utf8');
const types=fs.readFileSync('src/types.ts','utf8');
for(const n of [
  'forecastPeakIntensityEnabled','forecastPeakIntensityReference','circulationSizeTransitionHours','circulationSizeTransitionTargetKm'
]) if(!types.includes(n)) throw new Error(`missing config field ${n}`);
for(const n of ['风圈变化生效时间','applyCirculationSizeTarget','applyForecastPeakReference'])
  if(!app.includes(n)) throw new Error(`missing quick-tool handler ${n}`);
// Round 58 deliberately moved route/peak controls out of the Quick Tools sheet into the phone
// ellipsis menu. Keep validating that the feature still exists without forcing the old location.
for(const n of ['大体预报路径','预报最大强度'])
  if(!mobile.includes(n)) throw new Error(`missing More-menu forecast tool ${n}`);
for(const n of [
  'getForecastPeakIntensityReference','forecastHardCapActive','referenceAuthority','resolveCirculationSizeReferenceKm',
  'const hasManualForecastFramework','if (!hasManualForecastFramework)'
]) if(!engine.includes(n)) throw new Error(`missing engine guard ${n}`);
if(!ens.includes('forecastPeakIntensityReference')) throw new Error('ensemble does not consume forecast peak reference');
for(const n of ['路径结束方式','正常停编','跟随残余涡流','ensembleSpecialTrackEndMode']) if(!products.includes(n)) throw new Error(`missing special ensemble option ${n}`);
if(!ref.includes('specialTrackEndMode?: "operational" | "residual"')) throw new Error('reference renderer missing specialTrackEndMode');
if(!ref.includes('args.specialTrackEndMode === "operational"')) throw new Error('renderer does not branch on track-end mode');
const finalDry=css.lastIndexOf('/* Round 52: keep the dry-air drawing toolbar');
if(finalDry<0) throw new Error('dry-air mobile toolbar rule missing');
const tail=css.slice(finalDry,finalDry+1100);
if(!tail.includes('left:50% !important')||!tail.includes('transform:translateX(-50%) !important')) throw new Error('dry-air toolbar not final-centered');
for(const [file,src] of [['App.tsx',app],['Engine.ts',engine],['AetherEnsembleGuidance.ts',ens],['ForecastImageModal.tsx',products],['EnsembleReferenceProducts.ts',ref]]){
  const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:file});
  const errs=(out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  if(errs.length) throw new Error(`${file} transpile error: ${errs.map(e=>e.messageText).join('; ')}`);
}
console.log('Round 52 quick tools / forecast constraints regression: PASS');
