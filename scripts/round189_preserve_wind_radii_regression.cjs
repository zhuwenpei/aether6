/** R189: applying "真实化参数" must not alter r7/r10/r12 or RMW. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {load}=require('./round185_test_loader.cjs');
const geom=load('src/simulation/RealisticParameterGeometry.ts');
const archive=load('src/utils/SimulationArchive.ts');
const fixtures=[
 ['达维',process.env.AETHER_DAVI_SAMPLE||'/mnt/data/AETHER_20261017_074311_1storms.aether.json'],
 ['卡努',process.env.AETHER_KHANUN_SAMPLE||'/mnt/data/2306_卡努_KHANUN_2023_400km模拟风圈_可导入存档.aether(1).json']
];
const windKeys=['rmw','r7','r10','r12'];
let checks=0;
function test(title,fn){fn();checks++;}
function equalWind(a,b,description){for(const key of windKeys) assert.deepStrictEqual(a[key],b[key],`${description} ${key}`);}
function validateHistory(before,after,name){
 assert.equal(after.length,before.length,`${name} length`);
 for(let i=0;i<before.length;i++) equalWind(after[i],before[i],`${name} +${before[i].simHour}h`);
}
const sampleStats=[];
for(const [name,p] of fixtures){
 if(!fs.existsSync(p)){console.log(`SKIP ${name}: fixture missing`);continue;}
 const raw=JSON.parse(fs.readFileSync(p,'utf8'));
 const input=raw.data.typhoons[0];
 const before=JSON.stringify(input.history);
 for(const level of ['low','mid','high']){
  const output=geom.buildThreeHourlyParameters(input.history,`r189:${name}`,level);
  test(`${name} ${level} 3-hour processing does not change wind circles`,()=>validateHistory(input.history,output,`${name}/${level}`));
  test(`${name} ${level} input unchanged`,()=>assert.equal(JSON.stringify(input.history),before));
  if(level==='mid'){
   const changedSpeed=output.some((h,i)=>Math.abs(h.speed-input.history[i].speed)>1e-5);
   const changedPressure=output.some((h,i)=>Math.abs(h.pmin-input.history[i].pmin)>1e-5);
   const changedWind=output.some((h,i)=>Math.abs(h.vmax-input.history[i].vmax)>1e-5);
   test(`${name} non-wind-circle fields still processed`,()=>assert.ok(changedSpeed||changedPressure||changedWind));
  }
 }
 sampleStats.push({name,hours:input.history.length});
}
const synthetic=Array.from({length:13},(_,i)=>({
 simHour:i,lat:12+i*.06,lon:130-i*.04,
 vmax:20+Math.sin(i*1.71)*5,pmin:996+Math.cos(i*.75)*9,
 speed:12+Math.sin(i*.63)*4,direction:(345+i*1.5)%360,
 rmw:16+((i*13)%37),
 r7:{ne:85+(i*19)%89,se:74+(i*23)%81,sw:52+(i*31)%97,nw:90+(i*11)%93},
 r10:{ne:((i*17)%41),se:((i*23)%47),sw:((i*29)%31),nw:((i*7)%53)},
 r12:{ne:(i%4===0?0:((i*31)%40)),se:(i%5===0?0:((i*13)%41)),sw:i%3===0?0:23,nw:i%2===0?0:31},
 landed:false,stationReadings:[]
}));
const generated=geom.buildThreeHourlyParameters(synthetic,'R189-test','mid');
test('sparse and irregular wind circles preserved every hour',()=>validateHistory(synthetic,generated,'synthetic'));
test('speed/wind/pressure 3h node interpolation remains active',()=>{
 for(const field of ['speed','vmax','pmin']){
  for(let i=0;i+3<generated.length;i+=3){
   const expected=(generated[i][field]*2+generated[i+3][field])/3;
   assert.ok(Math.abs(generated[i+1][field]-expected)<1e-8,`${field} +${i+1}h`);
  }
 }
});
// Current-state radii need not equal the final history snapshot when the
// time-axis is being viewed or an older import carries a divergent live state.
const liveWind={rmw:75,r7:{ne:301,se:260,sw:220,nw:205},r10:{ne:151,se:133,sw:114,nw:102},r12:{ne:71,se:53,sw:34,nw:22}};
const ty={id:'storm',name:'storm',history:synthetic,
 lat:synthetic.at(-1).lat,lon:synthetic.at(-1).lon,vmax:synthetic.at(-1).vmax,pmin:synthetic.at(-1).pmin,
 ...liveWind};
const enginePath=path.resolve(__dirname,'../src/simulation/Engine.ts');
require.cache[enginePath]={id:enginePath,filename:enginePath,loaded:true,exports:{calculateStationReadings:()=>[]}};
const apply=load('src/simulation/RealisticParameterApply.ts');
(async()=>{
 const applied=await apply.prepareRealisticParameters(ty,{seed:'x'},'mid','R189-test');
 test('apply preserves original live wind circles even when different from final fix',()=>equalWind(applied.typhoon,ty,'live after apply'));
 test('apply preserves wind circles in history',()=>validateHistory(synthetic,applied.typhoon.history,'applied history'));
 const undone=await apply.undoRealisticParameters(applied.typhoon,{seed:'x'});
 test('undo restores original historical wind circles',()=>validateHistory(synthetic,undone.history,'undone history'));
 // R188 archives contain a valid original journal but may have 3-hour
 // resampled wind circles. When reapplying, restore originals first.
 const legacyEdited=structuredClone(applied.typhoon);
 for(let i=0;i<legacyEdited.history.length;i++){
  legacyEdited.history[i].rmw=90+i;
  for(const field of ['r7','r10','r12'])legacyEdited.history[i][field]={ne:999,se:999,sw:999,nw:999};
 }
 legacyEdited.rmw=999;
 legacyEdited.r7={ne:999,se:999,sw:999,nw:999};
 legacyEdited.r10={ne:999,se:999,sw:999,nw:999};
 legacyEdited.r12={ne:999,se:999,sw:999,nw:999};
 const restored=await apply.prepareRealisticParameters(legacyEdited,{seed:'x'},'high','R189-reapply');
 test('reapply an older R188 edited history restores exact original hourly radii',()=>validateHistory(synthetic,restored.typhoon.history,'R188 reapply'));
 test('reapply an older R188 edited history restores original final radii',()=>equalWind(restored.typhoon,synthetic.at(-1),'R188 reapply live'));
 const payload={...JSON.parse(fs.readFileSync(fixtures[0][1],'utf8')).data,typhoons:[restored.typhoon]};
 const packed=archive.makeSimulationArchive(payload);
 const imported=archive.parseSimulationArchive(JSON.stringify(packed)).data.typhoons[0];
 test('archive export-import retains hourly wind circles',()=>validateHistory(restored.typhoon.history,imported.history,'archive'));
 const sourceJournal=structuredClone(imported.realisticMotion);
 test('legacy R188 v2 undo journal retained for backwards compatibility',()=>assert.ok(sourceJournal.original[1].radii.r7.ne!==undefined&&sourceJournal.original[1].values.rmw!==undefined));
 test('archive restored cyclone wind circles unchanged',()=>equalWind(restored.typhoon,imported,'imported live'));
 console.log(JSON.stringify({result:'PASS',checks,samples:sampleStats,windCircles:['r7','r10','r12','rmw']},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
