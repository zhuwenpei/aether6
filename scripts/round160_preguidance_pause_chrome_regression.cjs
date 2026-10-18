'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const get=(file)=>fs.readFileSync(file,'utf8');
function evalModule(file){
 const module={exports:{}};
 const code=ts.transpileModule(get(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,Set,Map,Object,Math,Array,Number,Date,Error});
 return module.exports;
}
const {issuePreSimulationReference}=evalModule('src/simulation/PreSimulationReference.ts');
const fix=hour=>({leadHour:hour,lat:10,lon:130,vmax:45,pmin:970,r7:{ne:1,se:1,sw:1,nw:1}});
const reference=(issueHour)=>({version:1,stormId:'s1',issueHour,authority:.995,completedLeadHour:120,fixes:[fix(0),fix(120)]});
const storm={id:'s1',history:[{simHour:50,preSimulationReference:reference(50)},{simHour:80,preSimulationReferenceCleared:true}]};
assert.equal(issuePreSimulationReference(storm,49),undefined);
assert.equal(issuePreSimulationReference(storm,79).issueHour,50,'old guidance lost before route redraw');
assert.equal(issuePreSimulationReference(storm,80),undefined,'route redraw failed to cancel prior sandbox');
assert.equal(issuePreSimulationReference(storm,81),undefined,'old guidance resurrected after redraw');
assert.equal(issuePreSimulationReference(storm,150),undefined,'old branch resurrected further in future');
storm.history.push({simHour:90,preSimulationReference:reference(90),preSimulationReferenceCleared:false});
assert.equal(issuePreSimulationReference(storm,89),undefined);
assert.equal(issuePreSimulationReference(storm,95).issueHour,90,'new sandbox not restored');
assert.equal(issuePreSimulationReference(storm,79).issueHour,50,'historical playback retroactively rewritten');
const sameHour={id:'s1',history:[{simHour:80,preSimulationReference:reference(80),preSimulationReferenceCleared:true}]};
assert.equal(issuePreSimulationReference(sameHour,80),undefined,'same-hour revocation failed');
sameHour.history[0].preSimulationReferenceCleared=false;
assert.equal(issuePreSimulationReference(sameHour,80).issueHour,80,'same-hour newly approved sandbox failed');
const app=get('src/App.tsx');
for(const token of [
 'const revokePreSimulationFromHour =',
 'preSimulationReferenceCleared:true',
 'preSimulationReferenceCleared:false',
 'const clearPreSimulationReference =',
 'const revoked=revokePreSimulationFromHour(ty,currentHourRef.current)',
 'syncForecast ? revokePreSimulationFromHour(ty,currentHourRef.current) : ty',
 'onClearPreSimulationReference={clearPreSimulationReference}',
 'const nextPlaying = !isPlayingRef.current',
 'isPlayingRef.current=nextPlaying',
 'physicsRunGenerationRef.current++',
 'if(runGeneration!==physicsRunGenerationRef.current || !isPlayingRef.current)return;',
 'if(isPlayingRef.current && runGeneration===physicsRunGenerationRef.current)scheduleNextTick()'
])assert(app.includes(token),`App wiring missing ${token}`);
const drawer=get('src/components/ControlDrawer.tsx');
assert(drawer.includes('清空预模拟预报参考')&&drawer.includes('disabled={!hasPreSimulationReference}'));
const ui=get('src/components/ForecastPreSimulation.tsx');
assert(ui.includes('brandText="Forecast" sandboxMode')&&ui.includes('<AetherMobileChrome')&&ui.includes('<AetherDesktopChrome'));
assert(ui.includes('const [playing,setPlaying]=useState(false)'));
const barStart=ui.indexOf('aria-label="预模拟确认或取消"');
const controls=ui.slice(barStart,ui.indexOf('    </div>',barStart));
assert(!controls.includes('确认后从 +')&&!controls.includes('预模拟参考从'));
assert((controls.match(/<button/g)||[]).length===2,'Confirmation bar must contain two buttons only');
assert(ui.includes('onProducts={()=>{}}'),'Forecast sandbox should not expose products');
for(const comp of ['AetherDesktopChrome','AetherMobileChrome']){
 const src=get('src/components/'+comp+'.tsx');
 assert(src.includes('brandText="AETHER"')&&src.includes('sandboxMode=false'));
 assert(src.includes('{brandText}')&&src.includes('!sandboxMode&&'),'Shared chrome variant missing');
}
assert(get('src/utils/SimulationArchive.ts').includes('typeof h.preSimulationReferenceCleared === "boolean"'),'archive revocation validation missing');
console.log('Round160 PASS: historic pre-simulation cancellation, same-hour replacement, redraw vs clear wiring, queued-physics pause guards, shared Forecast header and compact two-button approval panel.');
