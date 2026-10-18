'use strict';
const {performance}=require('node:perf_hooks'),fs=require('node:fs');
const {load}=require('./round185_test_loader.cjs');const strike=load('src/utils/StrikeProbabilityField.ts');
const members=Array.from({length:1000},(_,i)=>({id:`synthetic-${i}`,track:[
 {lat:17+Math.sin(i*0.31)*.9,lon:122+Math.cos(i*.23)*1.1,leadHour:0},
 {lat:19+Math.sin(i*.29)*1.4,lon:124+Math.cos(i*.21)*1.5,leadHour:24},
 {lat:21+Math.sin(i*.25)*1.8,lon:126+Math.cos(i*.19)*1.7,leadHour:48}]}));
(async()=>{
 const start=performance.now();let bands=0,peakRss=process.memoryUsage().rss,progress=0;
 const meta=await strike.computeStrikeFieldStripes(members,{bounds:{minLat:16,maxLat:26,minLon:119,maxLon:129},
  cellDeg:.0025,radiusKm:111.19,horizonHours:48,smoothPasses:0,
  onProgress:(done,total)=>progress=done/total},stripe=>{
    bands++;peakRss=Math.max(peakRss,process.memoryUsage().rss);
  });
 const result={members:members.length,synthetic:true,cellDeg:meta.cellDeg,cells:meta.nx*meta.ny,
  bands,seconds:Number(((performance.now()-start)/1000).toFixed(2)),peakRssMiB:Number((peakRss/1048576).toFixed(1)),progress};
 fs.writeFileSync('ROUND185_STAGE4_1000MEM_BENCHMARK.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1)});
