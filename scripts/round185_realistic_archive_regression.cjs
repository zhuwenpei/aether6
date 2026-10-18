const assert=require('node:assert/strict'),{load}=require('./round185_test_loader.cjs');
const archive=load('src/utils/SimulationArchive.ts');
const history=Array.from({length:25},(_,i)=>({simHour:i,lat:12+i*.03,lon:145-i*.04,vmax:25}));
const original=history.map(h=>({simHour:h.simHour,lat:h.lat,lon:h.lon,speed:8,direction:286}));
const storm={id:'round185-test',name:'case',lat:12.72,lon:144.04,vmax:25,history};
const base={typhoons:[storm],eventLogs:[],config:{seed:'test'},layers:{},currentHour:24,maxHour:24,
 totalSimMinutes:24*60,startDate:new Date('2026-10-16T00:00:00Z').toISOString(),seasonEnded:false,speed:1,
 prngState:123,timelineCollapsed:false,genesisPos:{lat:12,lon:145}};
const clone=x=>JSON.parse(JSON.stringify(x));
assert.doesNotThrow(()=>archive.validateSimulationArchiveData(clone(base)),'legacy archive without motion metadata');
const valid=clone(base);
valid.config.realisticMotionEnabled=false;
valid.typhoons[0].historyRevision=1;
valid.typhoons[0].realisticMotion={version:1,seed:'aether-seed-1',strength:'mid',original};
assert.doesNotThrow(()=>archive.validateSimulationArchiveData(valid));
const invalid=[
 [d=>d.typhoons[0].historyRevision=-1,'真实化历史版本号无效'],
 [d=>d.typhoons[0].realisticMotion.original.pop(),'路径真实化撤销记录无效'],
 [d=>d.typhoons[0].realisticMotion.seed='','路径真实化撤销记录无效'],
 [d=>d.typhoons[0].realisticMotion.original[3].lat=NaN,'路径真实化撤销记录包含非法'],
 [d=>d.typhoons[0].realisticMotion.original[3].simHour=50,'路径真实化撤销记录包含非法'],
 [d=>d.typhoons[0].realisticMotion.strength='extreme','路径真实化撤销记录无效'],
 [d=>d.config.realisticMotionEnabled='yes','路径真实化开关必须为布尔值']
];
for(const [corrupt,msg] of invalid){const bad=clone(valid);corrupt(bad);assert.throws(()=>archive.validateSimulationArchiveData(bad),new RegExp(msg));}
const roundtrip=archive.parseSimulationArchive(JSON.stringify(archive.makeSimulationArchive(valid)));
assert.equal(roundtrip.data.typhoons[0].historyRevision,1);
assert.deepEqual(roundtrip.data.typhoons[0].realisticMotion.original,original);
console.log('ROUND185 REALISTIC ARCHIVE PASS: legacy, 7 malformed fields, JSON export/import round-trip');
