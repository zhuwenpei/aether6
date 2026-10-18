const fs=require('fs');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(p,'utf8');
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
const types=read('src/types.ts');
const defaults=read('src/config/DefaultSettings.ts');
const app=read('src/App.tsx');
const mobile=read('src/components/AetherMobileChrome.tsx');
const drawer=read('src/components/ControlDrawer.tsx');
const map=read('src/components/MapView.tsx');
const engine=read('src/simulation/Engine.ts');
const ens=read('src/simulation/AetherEnsembleGuidance.ts');
const css=read('src/index.css');

for(const n of ['ManualShearRegion','manualShearRegions','manualShearDrawKt']) assert(types.includes(n),`missing shear type/config ${n}`);
assert(defaults.includes('manualShearRegions: []')&&defaults.includes('manualShearDrawKt: 30'),'manual shear defaults missing');

// Tools were moved, not copied, into the phone ellipsis menu.
for(const n of ['🗺️ 大体预报路径','📈 预报最大强度','🍂 绘制干空气区','⚡ 绘制强风切区']) assert(mobile.includes(n),`More tool missing ${n}`);
assert(!app.includes('绘制大体预报路径')&&!app.includes('预报最大强度参考'),'forecast controls still duplicated in Quick Tools sheet');
assert(!drawer.includes('手动干空气区域'),'draw-dry UI still duplicated in settings drawer');
assert(map.includes('isShearDrawing')&&map.includes('onShearPointRef.current?.'),'map shear drawing plumbing missing');

// Dry-air physics: structural vulnerability + EWRC entry/core probability + force-12/Dvorak weakening gate.
assert(engine.includes('0.82 + 0.62 * dryStructureVulnerability'),'dry-air structure vulnerability coupling missing');
assert(engine.includes('0.20 + 0.80 * Math.pow(shapeFactor'),'dry-air polygon edge floor missing');
assert(engine.includes('0.70 + 0.20 * effectiveManualDry + 0.10 * dryStructureVulnerability'),'EWRC core-entrainment probability missing');
assert(engine.includes('smoothstep01((ty.vmax - 32.7) / 9.0)'),'force-12 manual dry decay gate missing');
assert(engine.includes('const dvorakDryGate = smoothstep01((vmax - 32.7) / 10.0)'),'force-12 atmospheric ventilation gate missing');
assert(engine.includes('0.24 + 0.26 * smoothstep01((ty.vmax - MIN_CYCLONE_INTENSITY_MS) / (18.0 - MIN_CYCLONE_INTENSITY_MS))'),'sub-18 m/s 24%-50% development scale missing');

// Every forecast path samples drawn shear; ensemble members perturb position/size/intensity independently.
assert(engine.includes('getManualShearRegionInfluence(config, currentLat, currentLon)'),'deterministic forecast does not sample drawn shear');
for(const n of ['ENV-CENTER','ENV-MEMBER','const size=clamp(1+normal(r)*.13*spread','const intensityScale=clamp(1+normal(r)*.13*spread']) assert(ens.includes(n),`ensemble environment dispersion missing ${n}`);
assert(ens.includes('manualDry:manual,manualShear'),'ensemble environment diagnostics missing');

// Damage memories must not snap back after high terrain / ventilation / failed EWRC.
assert(ens.includes('210+120*modelTerrainDamageMemory')&&ens.includes('228+130*memberTerrainDamageMemory'),'high-terrain slow memory missing');
assert(ens.includes('72+84*modelVentilationDamageMemory')&&ens.includes('78+90*memberVentilationDamageMemory'),'ventilation damage memory too short/missing');
assert(ens.includes('ewrcFailureAge')&&ens.includes('memberEwrcFailureAge'),'failed-EWRC memory tail missing');
assert(ens.includes('if(vmax>shifted.vmax)')&&ens.includes('if(vmax>timed.vmax)'),'post-land parent forecast can still pull damaged members upward');

// Full-height sheet + real drag-to-close handle.
assert(app.includes('e.clientY - drag.startY >= 44'),'Quick Tools downward close gesture missing');
assert(css.includes('height:var(--aether-vvh,100dvh) !important')&&css.includes('.aether-influence-sheet-handle'),'Quick Tools full-height/handle CSS missing');

for(const [name,src] of [['App.tsx',app],['AetherMobileChrome.tsx',mobile],['MapView.tsx',map],['Engine.ts',engine],['AetherEnsembleGuidance.ts',ens]]){
  const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true,fileName:name});
  const errs=(out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert(!errs.length,`${name} transpile error: ${errs.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; ')}`);
}
console.log('Round 58 environment / ensemble memory / mobile More regression: PASS');
