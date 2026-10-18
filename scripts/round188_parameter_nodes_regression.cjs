/** R188: offline three-hour historical parameter and atomic archive regression. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('./round185_test_loader.cjs');
const geom=load('src/simulation/RealisticParameterGeometry.ts');
const archive=load('src/utils/SimulationArchive.ts');
const project=path.resolve(__dirname,'..');
const samples=[
 ['达维',process.env.AETHER_DAVI_SAMPLE||'/mnt/data/AETHER_20261017_074311_1storms.aether.json'],
 ['卡努',process.env.AETHER_KHANUN_SAMPLE||'/mnt/data/2306_卡努_KHANUN_2023_400km模拟风圈_可导入存档.aether(1).json']
];
let count=0;const metrics=[];
const ok=(value,message)=>{assert.ok(value,message);count++;};
function linear(a,b,t){return a+(b-a)*t;}
for(const [name,source] of samples){
 if(!fs.existsSync(source)){console.log('SKIP SAMPLE',name,'not present (use AETHER_*_SAMPLE)');continue;}
 const raw=JSON.parse(fs.readFileSync(source,'utf8'));
 const ty=raw.data.typhoons[0],history=ty.history;
 const result=geom.buildThreeHourlyParameters(history,'r188-sample-test','mid');
 const result2=geom.buildThreeHourlyParameters(history,'r188-sample-test','mid');
 ok(result.length===history.length,`${name} historical hours unchanged`);
 ok(JSON.stringify(result)===JSON.stringify(result2),`${name} deterministic`);
 ok(history[0].lat===result[0].lat&&history.at(-1).lat===result.at(-1).lat,`${name} position endpoints unchanged`);
 ok(history[0].vmax===result[0].vmax&&history.at(-1).pmin===result.at(-1).pmin,`${name} intensity endpoints unchanged`);
 const n=geom.threeHourlyNodes(history),map=new Map(result.map(h=>[h.simHour,h]));
 for(let i=1;i<n.length;i++){
  const a=map.get(n[i-1]),b=map.get(n[i]);if(!a||!b)continue;
  for(const fix of result){if(fix.simHour<n[i-1]||fix.simHour>n[i])continue;
   const t=(fix.simHour-n[i-1])/(n[i]-n[i-1]);
   for(const key of ['vmax','pmin','speed','lat']){
    if(!Number.isFinite(a[key])||!Number.isFinite(b[key])||!Number.isFinite(fix[key]))continue;
    assert.ok(Math.abs(fix[key]-linear(a[key],b[key],t))<1e-5,`${name} ${key} three-hour line at +${fix.simHour}`);
   }
  }
 }
 count++;
 const p=geom.buildThreeHourlyParameters(history,'r188-sample-test','high');
 const changedPositions=p.filter((h,i)=>Math.abs(h.lat-history[i].lat)>1e-6||Math.abs(h.lon-history[i].lon)>1e-6).length;
 ok(changedPositions>0,`${name} fine positional shift`);
 ok(result.every(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lon)&&h.vmax>=0&&h.pmin>0),`${name} finite met fields`);
 ok(result.every((h,i)=>h.rmw===history[i].rmw&&['r7','r10','r12'].every(k=>JSON.stringify(h[k])===JSON.stringify(history[i][k]))),`${name} wind circles and RMW unchanged at each historical hour`);
 const edit={...ty,history:result,lat:result.at(-1).lat,lon:result.at(-1).lon,vmax:result.at(-1).vmax,pmin:result.at(-1).pmin,
  realisticMotion:{version:2,seed:'r188-sample-test',strength:'mid',original:history.map(geom.makeParameterSnapshot)},historyRevision:1};
 const payload={...raw.data,typhoons:[edit],config:{...raw.data.config,realisticMotionEnabled:false}};
 const restored=archive.parseSimulationArchive(JSON.stringify(archive.makeSimulationArchive(payload))).data.typhoons[0];
 ok(restored.realisticMotion.version===2&&restored.realisticMotion.original.length===history.length,`${name} archive roundtrip`);
 const broken=structuredClone(payload);broken.typhoons[0].realisticMotion.original[3].values.vmax=NaN;
 assert.throws(()=>archive.validateSimulationArchiveData(broken),/非法数值参数/);count++;
 metrics.push({sample:name,hours:history.length,knots:n.length,changedPositions,meanWind:result.reduce((s,h)=>s+h.vmax,0)/result.length});
}
const synthetic=Array.from({length:11},(_,i)=>({simHour:i,lat:15+i*.06,lon:134-i*.04,vmax:21+Math.sin(i)*4,pmin:1002-i/2,speed:12+Math.cos(i)*2,direction:330,rmw:30+(i%4)*3.25,landed:false,
 r7:{ne:150+(i*11)%17,se:130+(i*9)%19,sw:110+(i*7)%11,nw:100+(i*5)%23},r10:{ne:50+i%7,se:44+(i*5)%13,sw:35+(i*3)%9,nw:30+i%4},r12:{ne:i%4===0?0:10+i,se:i%3===0?0:9+i,sw:0,nw:i%5===0?0:8+i}}));
const one=geom.buildThreeHourlyParameters(synthetic,'fixed','mid'),two=geom.buildThreeHourlyParameters(synthetic,'fixed','mid');
ok(JSON.stringify(one)===JSON.stringify(two),'synthetic deterministic');
ok(Math.abs(one[1].vmax-linear(one[0].vmax,one[3].vmax,1/3))<1e-8,'wind linear 3h');
ok(Math.abs(one[2].pmin-linear(one[0].pmin,one[3].pmin,2/3))<1e-8,'pressure linear 3h');
ok(Math.abs(one[5].speed-linear(one[3].speed,one[6].speed,2/3))<1e-8,'speed linear 3h');
ok(one.every((h,i)=>h.rmw===synthetic[i].rmw&&['r7','r10','r12'].every(k=>JSON.stringify(h[k])===JSON.stringify(synthetic[i][k]))),'wind radii and RMW unchanged at all hours');
ok(one[0].lat===synthetic[0].lat&&one[10].lat===synthetic[10].lat,'partial final interval preserved');
// Integration using a lightweight station diagnostic in place of GIS loaders.
const enginePath=path.resolve(project,'src/simulation/Engine.ts');
require.cache[enginePath]={id:enginePath,filename:enginePath,loaded:true,exports:{calculateStationReadings:()=>[]}};
const apply=load('src/simulation/RealisticParameterApply.ts');
(async()=>{
 const ty={id:'demo',name:'demo',history:synthetic,lat:synthetic.at(-1).lat,lon:synthetic.at(-1).lon,vmax:synthetic.at(-1).vmax,pmin:synthetic.at(-1).pmin,rmw:synthetic.at(-1).rmw,r7:synthetic.at(-1).r7,r10:synthetic.at(-1).r10,r12:synthetic.at(-1).r12};
 const result=await apply.prepareRealisticParameters(ty,{seed:'demo'},'mid','seed');
 ok(result.typhoon.realisticMotion.version===2,'apply journal version2');
 ok(['rmw','r7','r10','r12'].every(k=>JSON.stringify(result.typhoon[k])===JSON.stringify(ty[k])),'apply keeps current wind circle and RMW');
 ok(result.typhoon.history!==ty.history&&ty.history[1].vmax===synthetic[1].vmax,'atomic immutability');
 const again=await apply.prepareRealisticParameters(result.typhoon,{seed:'demo'},'high','seed2');
 ok(again.typhoon.realisticMotion.original[1].values.vmax===synthetic[1].vmax,'reapply starts from original');
 const original=await apply.undoRealisticParameters(again.typhoon,{seed:'demo'});
 ok(original.history.every((h,i)=>h.lat===synthetic[i].lat&&h.vmax===synthetic[i].vmax&&h.pmin===synthetic[i].pmin&&h.r7.ne===synthetic[i].r7.ne),'undo all edited physical fields');
 const ac=new AbortController();ac.abort();
 await assert.rejects(()=>apply.prepareRealisticParameters(ty,{},'mid','cancel',undefined,ac.signal),/取消/);count++;
 console.log(JSON.stringify({result:'PASS',assertionGroups:count,metrics},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
