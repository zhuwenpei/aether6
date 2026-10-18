'use strict';
const {performance}=require('node:perf_hooks');const fs=require('node:fs');
const {load}=require('./round185_test_loader.cjs');const strike=load('src/utils/StrikeProbabilityField.ts');
const members=Array.from({length:12},(_,i)=>({id:`synthetic-${i}`,track:[
 {lat:17+i*.1,lon:125+i*.06,leadHour:0},
 {lat:19+i*.12,lon:126+i*.08,leadHour:24},
 {lat:21+i*.14,lon:128+i*.1,leadHour:48}]}));
const tests=[
 {name:'WNP 0.1°',bounds:{minLon:107.6,maxLon:177.3,minLat:-2.65,maxLat:57.9},cellDeg:.1,mode:'full'},
 {name:'5°×5° 0.0025°',bounds:{minLon:124,maxLon:129,minLat:18,maxLat:23},cellDeg:.0025,mode:'stripes'},
 {name:'10°×10° 0.0025°',bounds:{minLon:120,maxLon:130,minLat:15,maxLat:25},cellDeg:.0025,mode:'stripes'},
 {name:'WNP requested 0.0025° (80m cap)',bounds:{minLon:107.6,maxLon:177.3,minLat:-2.65,maxLat:57.9},cellDeg:.0025,mode:'stripes'}
];
(async()=>{
 const result=[];
 for(const t of tests){
  if(global.gc)global.gc();
  const start=performance.now();let maxRss=process.memoryUsage().rss,bandCount=0,meta;
  const measure=()=>maxRss=Math.max(maxRss,process.memoryUsage().rss);
  const opt={bounds:t.bounds,cellDeg:t.cellDeg,radiusKm:111.19,horizonHours:48,smoothPasses:1};
  if(t.mode==='full'){
   const f=await strike.computeStrikeField(members,opt);meta={nx:f.nx,ny:f.ny,cellDeg:f.cellDeg};bandCount=1;
   measure();
  }else{
   meta=await strike.computeStrikeFieldStripes(members,opt,(stripe)=>{bandCount++;measure();});
  }
  result.push({name:t.name,syntheticMembers:members.length,mode:t.mode,rows:meta.ny,columns:meta.nx,
   actualCellDeg:meta.cellDeg,cells:meta.ny*meta.nx,bands:bandCount,
   seconds:Number(((performance.now()-start)/1000).toFixed(3)),maxRssMiB:Number((maxRss/1048576).toFixed(1))});
  console.log(JSON.stringify(result[result.length-1]));
 }
 if(process.argv.includes('--write'))fs.writeFileSync('ROUND185_STAGE4_STRIKE_BENCHMARK.json',JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
