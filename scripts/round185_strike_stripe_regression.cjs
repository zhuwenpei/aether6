'use strict';
const assert=require('node:assert/strict');const {load}=require('./round185_test_loader.cjs');
const mod=load('src/utils/StrikeProbabilityField.ts');
async function main(){
 const members=[];for(let i=0;i<27;i++)members.push({id:String(i),track:[
  {lat:5+i*.03,lon:124+i*.03,leadHour:0},{lat:6+i*.1,lon:126+i*.1,leadHour:12},
  {lat:8+i*.08,lon:127+i*.11,leadHour:24}]});
 const bounds={minLon:120,maxLon:132,minLat:3,maxLat:13};
 const options={bounds,radiusKm:105,cellDeg:.1,horizonHours:24,smoothPasses:0};
 const full=await mod.computeStrikeField(members,options);
 const output=new Float32Array(full.nx*full.ny);let stripes=0;
 const meta=await mod.computeStrikeFieldStripes(members,options,async stripe=>{
  stripes++;
  for(let y=stripe.coreStart;y<stripe.coreEnd;y++)
   output.set(stripe.prob.subarray((y-stripe.firstRow)*stripe.nx,(y-stripe.firstRow+1)*stripe.nx),y*stripe.nx);
 },200000,4000); // force several bands on a 121x101 test mesh
 assert.equal(meta.nx,full.nx);assert.equal(meta.ny,full.ny);assert(stripes>1,'expected multiple row stripes');
 assert.deepEqual(output,full.rawProb,'streamed counting must match full buffer exactly');
 let smoothOut=new Float32Array(output.length);
 await mod.computeStrikeFieldStripes(members,{...options,smoothPasses:2},stripe=>{
  for(let y=stripe.coreStart;y<stripe.coreEnd;y++)smoothOut.set(stripe.prob.subarray((y-stripe.firstRow)*stripe.nx,(y-stripe.firstRow+1)*stripe.nx),y*stripe.nx);
 },200000,4000);
 const smoothed=mod.smoothGridPhysical(full.rawProb,full.nx,full.ny,.1,2);
 // At 0.1° this tester exercises the physical smoother directly; band
 // stitching must not change its values even at adjacent stripe boundaries.
 for(let i=0;i<smoothed.length;i++)assert(Math.abs(smoothOut[i]-smoothed[i])<.0002,`stripe seam ${i}`);
 const ctrl=new AbortController();ctrl.abort();
 await assert.rejects(mod.computeStrikeFieldStripes(members,{...options,signal:ctrl.signal},()=>{}),e=>e.name==='AbortError');
 // Memory budget reduction should not allocate a full field for a huge virtual grid.
 const large=mod.strikeStreamingCell({minLon:100,maxLon:170,minLat:-5,maxLat:55},.0025,false);
 const cells=(Math.floor(70/large)+1)*(Math.floor(60/large)+1);
 assert(cells<=mod.STRIKE_STREAM_DESKTOP_CELLS && large>.0025);
 assert.equal(mod.strikeStreamingCell({minLon:100,maxLon:105,minLat:15,maxLat:20},.0025,false),.0025);
 console.log('ROUND185 STRIKE STREAM PASS: full-grid equality, smoothing path, AbortSignal, 80m cap and small-frame 0.0025°');
}
main().catch(e=>{console.error(e);process.exit(1)});
