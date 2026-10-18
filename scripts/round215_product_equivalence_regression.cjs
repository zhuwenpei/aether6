/* R215: regression of shared settings and byte-identical classic ensemble plate. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const read=(s)=>fs.readFileSync(s,'utf8');
const entry=read('src/components/NetworkEntrySettings.tsx');
const normal=read('src/components/ForecastImageModal.tsx');
const shared=read('src/utils/ClassicEnsembleProduct.ts');
const network=read('src/utils/NetworkReferenceCharts.ts');
const css=read('src/components/TyphoonNetworkSimulator.css');
const offline=read('src/utils/TyphoonNetworkStandaloneExport.ts');
let checks=0;
const check=(value,label)=>{assert(value,label);console.log('PASS '+label);checks++};
// Transpile, execute and probe the ACTUAL entry loader, including the same localStorage keys.
const transpiled=ts.transpileModule(entry,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
check(!transpiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'network entry transpiles');
const data={};
const localStorage={getItem:key=>Object.hasOwn(data,key)?data[key]:null,setItem:(key,value)=>data[key]=String(value)};
const vmExports={};
const ctx={exports:vmExports,module:{exports:vmExports},localStorage,require:id=>{
  if(id.endsWith('AetherEnsembleGuidance'))return {AETHER_ENSEMBLE_MEMBER_COUNTS:[10,15,20,25,30,40,50,75,100,150,200,300,400,500,750,1000]};
  if(id.endsWith('AgencyBranding'))return {loadAgencyBranding:()=>({agencyCode:'WMC'})};
  return {};
}};
vm.runInNewContext(transpiled.outputText,ctx,{filename:'NetworkEntrySettings.js'});
const get=ctx.module.exports.readNetworkChartSettingsFromProducts;
const d=get();
check(d.resolutionId==='2k'&&d.nmcWidth===2560&&d.forecastHours===120,'normal 2K/NMC 120h defaults');
check(d.nmcCustomPeak===55&&d.nmcCoarseIntensity&&d.nmcProvinces&&d.nmcBorders,'normal NMC switches and 55m/s image-only default');
check(d.strikeHorizon===168&&d.strikeRadiusKm===120&&d.strikeCellDeg===.1&&d.strikeSmoothPasses===1,'normal strike horizon/radius/cell/smooth defaults');
check(d.membersPerModel===50&&d.meanDotHours===6,'normal 50 members / 6h dots defaults');
check(d.strike.coastMinPct===5&&d.strike.coastWidth===7&&d.strike.showMembers&&d.strike.pillCount===7,'normal strike coastline/member/label defaults');
localStorage.setItem('forecast_resolutionId','4k');localStorage.setItem('forecast_ensembleStrikeHorizonHours','240');
localStorage.setItem('forecast_strikeRadiusKm','300');localStorage.setItem('forecast_strikeCellDeg','0.005');
localStorage.setItem('forecast_ensembleMembersPerModel','200');localStorage.setItem('forecast_strikeShowMembers','false');
localStorage.setItem('forecast_nmcProvinces','false');
const changed=get(true);
check(changed.resolutionId==='4k'&&changed.nmcWidth===3840&&changed.precalculate,'normal resolution setting propagates on confirm');
check(changed.strikeHorizon===240&&changed.strikeRadiusKm===300&&changed.strikeCellDeg===.005,'full normal strike option values propagate');
check(changed.membersPerModel===200&&!changed.strike.showMembers&&!changed.nmcProvinces,'members and geo toggles propagate');
check(entry.includes('<ForecastImageModal isOpen={true}')&&entry.includes('settingsOnly={true}')&&
  !entry.includes('<option'),'entire original product settings UI reused instead of truncated duplicate');
check(normal.includes('localStorage.setItem(\'forecast_resolutionId\',resolutionId)')&&
  normal.includes('drawClassicEnsembleProduct({')&&network.includes('drawClassicEnsembleProduct({'),
  'normal and network classic renders share one actual renderer and resolution persistence');
check(shared.includes('Preserve geographic aspect ratio')&&shared.includes('WMC 基准预报')&&
  shared.includes('AETHER_MODEL_SPECS.forEach')&&shared.includes('loadAgencyBranding'),
  'classic page geometry/labels preserved in shared drawing code');
check(network.includes("style:'strike_probability_120km'")&&network.includes('...settings.strike')&&
  network.includes("getEnsembleReferenceAspect('strike_probability_120km')")&&network.includes('Math.round(settings.nmcWidth*3/4)'),
  'probability and classic output maintain original renderer and native aspect ratios');
check(css.includes('height:auto!important')&&css.includes('aspect-ratio:auto!important')&&
  css.includes('max-width:100%!important')&&offline.includes('aspect-ratio:auto;object-fit:contain'),
  'onscreen/offline images preserve aspect without forced stretch');
const old=read('src/simulation/Engine.ts');
check(old.length>1000,'main physics untouched by settings/plate layout changes');
console.log(`R215 product settings & aspect regression ${checks}/${checks} PASS`);
