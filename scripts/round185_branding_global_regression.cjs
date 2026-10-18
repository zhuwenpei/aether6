const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source=fs.readFileSync('src/utils/AgencyBranding.ts','utf8');
const items=new Map();let rejectWrites=false;
const storage={get length(){return items.size},key(i){return [...items.keys()][i]??null},
 getItem(k){return items.get(k)??null},removeItem(k){items.delete(k)},
 setItem(k,v){if(rejectWrites&&k==='forecast_agency_global')throw Error('quota exceeded');items.set(k,v)}};
const sink={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:sink.exports,module:sink,localStorage:storage,console}, {timeout:5000});
const a=sink.exports;
assert.equal(a.loadAgencyBranding('rain_observed').agencyCode,'WMC');
a.saveAgencyBranding('nmc',{agencyName:'区域一'});
a.saveAgencyBranding('rain_observed',{agencyName:'区域二'});
assert.equal(a.loadAgencyBranding('nmc').agencyName,'区域一');
assert.equal(a.loadAgencyBranding('rain_observed').agencyName,'区域二');
rejectWrites=true;
a.applyAgencyBrandingGlobally({agencyName:'新全局',agencyCode:'TEST'});
assert.equal(a.loadAgencyBranding('nmc').agencyName,'区域一','atomic failure must keep local values');
assert.equal(a.loadAgencyBranding('rain_observed').agencyName,'区域二');
rejectWrites=false;
a.applyAgencyBrandingGlobally({agencyName:'新全局',agencyCode:'TEST',footerNote:''});
for(const p of ['nmc','rain_observed','wind_forecast','ensemble_tracks','synoptic_wind_pressure','typhoon_report']){
 const b=a.loadAgencyBranding(p);assert.equal(b.agencyName,'新全局');assert.equal(b.agencyCode,'TEST');assert.equal(b.footerNote,'');
}
assert.equal(items.has('forecast_agency_nmc'),false);
assert.equal(items.has('forecast_agency_rain_observed'),false);
a.saveAgencyBranding('nmc',{agencyName:'本地覆盖',agencyCode:''});
assert.equal(a.loadAgencyBranding('nmc').agencyName,'本地覆盖');
assert.equal(a.loadAgencyBranding('nmc').agencyCode,'WMC','empty code reverts to built-in by specification');
a.clearAgencyBranding('nmc');assert.equal(a.loadAgencyBranding('nmc').agencyName,'新全局');
assert.equal(a.sanitizeBrandText('测\u0000试\n 气\t象 台',16),'测试 气象 台');
assert.equal(a.sanitizeBrandText('甲'.repeat(50),16).length,16);
a.clearAgencyBranding('global');assert.equal(a.loadAgencyBranding('nmc').agencyCode,'WMC');
console.log('ROUND185 BRAND GLOBAL PASS: global precedence, stale overrides, failed-write atomicity, blank footer, reset, sanitation');
