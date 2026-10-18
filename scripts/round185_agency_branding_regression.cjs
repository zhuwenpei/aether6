const assert=require('node:assert/strict');const storage=new Map();global.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
const {load}=require('./round185_test_loader.cjs');const b=load('src/utils/AgencyBranding.ts');
assert.equal(b.loadAgencyBranding('nmc').agencyCode,'WMC');
assert.equal(b.sanitizeBrandText(' abc\u0000\n\u007f d ',9),'abc d');
assert.equal(b.sanitizeBrandText('长'.repeat(80),16).length,16);
b.saveAgencyBranding('nmc',{agencyName:'私人气象站',agencyCode:' ABC ',footerNote:'你好\n世界'});
assert.equal(b.loadAgencyBranding('nmc').agencyCode,'ABC');assert.equal(b.loadAgencyBranding('nmc').footerNote,'你好世界');
console.log('round185_agency_branding_regression: PASS, defaults, scope, limit and control-character stripping');
