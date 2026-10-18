/** Instrumentation-only. CLI with real truth JSON:
 * node scripts/round185_ensemble_calibration.cjs data.json
 * JSON {forecast:[{track:...}],truth:[{track:...}]}. '--self-test' only tests
 * numeric metric functions with synthetic fixture; NEVER represents physics truth. */
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const source=fs.readFileSync('src/simulation/EnsembleCalibrationMetrics.ts','utf8');
const m={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module:m,exports:m.exports,Math,Number,Set,Map,Array,Error},{timeout:15000});
const {calibrationPeakIntensity,calibrationQuantile,calibrationTrackSpread,calibrationRapidIntensification,compareCalibrationEnsembles,calibrationPeakCoverage,calibrationPeakRank}=m.exports;
function fixture(count=60,axis='split'){
 return Array.from({length:count},(_,i)=>{const branch=axis==='split'?(i<count/2?-1:1):0;
 const track=Array.from({length:41},(_,j)=>{
  const h=j*6;return {leadHour:h,lat:15+h*.05 +branch*h*.035 +(i%3)*.002,
    lon:145-h*.09 +branch*h*.047+(i%5)*.004,vmax:15+Math.min(h,120)*(.28+i/count*.10)};});return {track};});
}
const args=process.argv.slice(2);
if(args.length && args[0]!=='--self-test'){
 const raw=JSON.parse(fs.readFileSync(args[0],'utf8'));
 if(!Array.isArray(raw.truth)||raw.truth.length<30||!Array.isArray(raw.forecast)||raw.forecast.length<30)throw Error('请提供至少30条独立物理真值和30条集合预报。');
 const report=compareCalibrationEnsembles(raw.forecast,raw.truth);
 report.peakCoverage=calibrationPeakCoverage(raw.forecast,raw.truth);
 // Pooled physical truths are NOT matched case verifications. No Talagrand
 // histogram is fabricated from an unpaired forecast/truth pair.
 console.log(JSON.stringify({warning:'真值来源由输入提供，本工具不能核实是否为独立物理引擎积分',report},null,2));
}else{
 assert.equal(calibrationQuantile([10,20,30],.5),20);
 assert.equal(calibrationQuantile([10,20,30],.1),12);
 assert.equal(calibrationPeakIntensity([{track:[]},{track:[{vmax:50}]}]).valid,1);
 const sample=fixture();
 const spread=calibrationTrackSpread(sample,120);
 assert.equal(spread.valid,60);
 assert.equal(spread.clusterCount,2,'synthetic two-way fork should produce two clusters');
 assert.ok(spread.centroidAngleGap>20);
 assert.ok(spread.crossP10P90>300);
 const ri=calibrationRapidIntensification(sample);
 assert.equal(ri,0,'fixture does not increase >=15 m/s per 24h');
 const comparison=compareCalibrationEnsembles(sample,fixture(40,'tight'));
 assert.ok(Number.isFinite(comparison.medianPeakRatio));
 assert.throws(()=>compareCalibrationEnsembles(sample,[]));
 assert.throws(()=>calibrationPeakCoverage(sample,fixture(29)));
 const coverage=calibrationPeakCoverage(sample,fixture(40));
 assert.ok(coverage.coverage>=0&&coverage.coverage<=1);
 assert.equal(calibrationPeakRank([{track:[{vmax:10}]},{track:[{vmax:20}]}],15),1);
 assert.equal(calibrationPeakRank([{track:[{vmax:10}]},{track:[{vmax:20}]}],10),.5);
 const dateline=calibrationTrackSpread(Array.from({length:35},(_,i)=>({track:[{leadHour:0,lat:15,lon:179},
    {leadHour:120,lat:20+i*.02,lon:-179-i*.01}]})),120);
 assert.ok(dateline.crossP10P90<100, 'dateline must not produce a 360° displacement');
 console.log('round185_ensemble_calibration: PASS, quantiles, RI, fork, dateline, coverage, ranks, truth requirements (synthetic fixtures only)');
}
