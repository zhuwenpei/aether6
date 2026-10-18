'use strict';
const assert=require('node:assert/strict');
const {load}=require('./round185_test_loader.cjs');
const f=load('src/utils/StrikeProbabilityField.ts');
function rand(seed){let x=seed>>>0;return()=>((x=Math.imul(x,1664525)+1013904223|0)>>>0)/4294967296;}
const random=rand(185);const members=[];
for(let i=0;i<120;i++){
 const x=115+random()*55,y=-12+random()*45,dx=(random()-.5)*18,dy=(random()-.5)*12;
 members.push({id:String(i),track:[{lat:y,lon:x,leadHour:0},{lat:y+dy/2,lon:x+dx/2,leadHour:12},
  {lat:y+dy,lon:x+dx,leadHour:24}]});
}
// Deliberately exercise the 180-degree seam and stationary single-point tracks.
for(let i=120;i<132;i++)members.push({id:String(i),track:[{lat:8+i/8,lon:178.3,leadHour:0},
 {lat:9+i/8,lon:-178.4,leadHour:12}]});
members.push({id:'stationary',track:[{lat:23,lon:121,leadHour:0}]});
for(const center of [145,180])for(const radius of [30,111.19,300]){
 const index=f.buildStrikeSiteIndex(members,radius,30,center);
 for(let j=0;j<2400;j++){
  const site=j%7===0?{lat:12+random()*5,lon:(random()>.5?179:-179)}:{lat:-14+random()*54,lon:110+random()*80};
  const exact=f.computeSiteProbability(members,site,radius,30);
  const indexed=f.computeSiteProbabilityIndexed(index,site);
  assert.equal(indexed,exact,`indexed site differs: ${JSON.stringify({site,radius,center,indexed,exact})}`);
 }
}
console.log('ROUND185 STRIKE SITE INDEX PASS: 14,400 exact comparisons, 133 members, seam, multiple radii');
