const assert=require('node:assert/strict');
const {load}=require('./round185_test_loader.cjs');
const f=load('src/utils/StrikeProbabilityField.ts');
const pt=(lat,lon,h)=>({lat,lon,leadHour:h,simHour:h,vmax:40,pmin:950});
const member=(i,track)=>({id:String(i),modelId:'WMC',memberNumber:i,track});
const tracks=Array.from({length:200},(_,i)=>member(i,[pt((i%20-10)*.2,-2,0),pt((i%20-10)*.2+.1,(i%17-8)*.15,6),pt((i%20-10)*.2+.2,2,12)]));
(async()=>{
 const bounds={minLat:-2,maxLat:2,minLon:-4,maxLon:4};
 const field=await f.computeStrikeField(tracks,{bounds,radiusKm:80,horizonHours:24,cellDeg:.1,smoothPasses:0});
 assert.equal(field.nx,81);assert.equal(field.ny,41);
 let mismatch=0;
 for(let y=0;y<field.ny;y++)for(let x=0;x<field.nx;x++){
   const lat=bounds.minLat+y*.1,lon=bounds.minLon+x*.1;
   let hits=0;
   for(const m of tracks){let found=false;for(let i=1;i<m.track.length;i++){
     const a=m.track[i-1],b=m.track[i];if(f.strikeSegmentDistanceSq(lat,lon,a.lon,a.lat,b.lon,b.lat)<=80*80){found=true;break;}
   }if(found)hits++;}
   if(Math.abs(field.rawProb[y*field.nx+x]-hits/2)>1e-4)mismatch++;
 }
 assert.equal(mismatch,0);
 const fine=f.strikeEffectiveCell({minLat:0,maxLat:3,minLon:130,maxLon:133},.0025);
 assert.equal(fine,.0025);
 const enlarged=f.strikeEffectiveCell({minLat:-40,maxLat:40,minLon:100,maxLon:180},.0025);
 assert.ok(enlarged>.0025);
 const ac=new AbortController();ac.abort();await assert.rejects(f.computeStrikeField(tracks,{bounds,radiusKm:80,horizonHours:24,cellDeg:.1,smoothPasses:0,signal:ac.signal}),e=>e?.name==='AbortError');
 console.log('round185_strike_scanline_regression: PASS, 200 members × 3321 grid cells, mismatch=0, adaptive and AbortSignal');
})().catch(e=>{console.error(e);process.exitCode=1;});
