const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const assert = require('node:assert/strict');

const fieldSrc = fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
const appSrc = fs.readFileSync('src/App.tsx','utf8');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

assert.equal(pkg.version, '6.0.13', 'ROUND90 version mismatch');
assert.ok(!fieldSrc.includes('Math.abs(lat) >= 8'), 'hard +/-8 degree geostrophic switch still exists');
assert.ok(fieldSrc.includes('geoGate = smooth01((absLat - 3.0) / 9.0)'), 'smooth equatorial geostrophic gate missing');
assert.ok(fieldSrc.includes('const geoBlend = 0.36 * geoGate'), 'geostrophic contribution is not continuously blended');
assert.ok(appSrc.includes('radiiById: Record<string'), 'exact pre-edit wind-radii snapshot missing');
assert.ok(appSrc.includes('typhoonsRef.current = restoredTyphoons'), 'duration selection still waits on asynchronous React ref update');
assert.ok(appSrc.includes('sameSimulationInstant'), 'exact rollback must be limited to the same simulation instant');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(),'aether-round90-'));
const entry = path.join(tmpDir,'numeric.mjs');
fs.writeFileSync(entry, `
import assert from 'node:assert/strict';
import { diagnoseSynopticEnvironmentalWindTarget } from ${JSON.stringify('file://' + path.resolve('src/simulation/SynopticEnvironmentalWindModel.ts'))};
import { getConfiguredSystemSurfaceState } from ${JSON.stringify('file://' + path.resolve('src/simulation/SynopticConfiguredSystems.ts'))};
import { resolveCirculationSizeTransition } from ${JSON.stringify('file://' + path.resolve('src/simulation/CirculationSizeTransition.ts'))};

const cfg={westerliesEnabled:true,westerliesStrength:1,westerliesLat:38,westerliesTroughLon:120,westerliesTroughDepth:1,subtropicalHighEnabled:false,monsoonTroughEnabled:false};
const vals=[];
for(let lat=30;lat<=48;lat+=1){
  for(let lon=100;lon<=170;lon+=2){
    const s=getConfiguredSystemSurfaceState(lat,lon,cfg,7,120);
    if(s.westerly < .45) continue;
    const texture=Math.max(-1,Math.min(1,.45*Math.sin(lat*.31+lon*.17)+.22*Math.cos(lon*.11-lat*.07)));
    const t=diagnoseSynopticEnvironmentalWindTarget({
      lat,lon,isLand:false,openOcean:1,backgroundTexture:texture,synopticActivity:.45,meanFlow:.5,
      westerlyJet:s.westerly,midLatWesterlies:s.westerly,westerlyTrough:s.westerlyTrough,month:7
    });
    vals.push(t.target10mKt);
  }
}
const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
const variance=vals.reduce((a,b)=>a+(b-avg)*(b-avg),0)/vals.length;
const sd=Math.sqrt(variance);
const min=Math.min(...vals), max=Math.max(...vals);
assert.ok(avg>=17 && avg<=22, 'westerly-belt target mean is not generally 17-22 kt: '+avg);
assert.ok(sd>=0.8, 'westerly belt became too uniform: sd='+sd);
assert.ok(max-min>=3.0, 'westerly belt lacks meaningful spatial variation: spread='+(max-min));
assert.ok(max<=36, 'westerly target exceeded global 36 kt ceiling');

const tr={circulationSizeReferenceKm:520,circulationSizeTransitionHours:72,circulationSizeTransitionStartHour:100,circulationSizeTransitionFromKm:360,circulationSizeTransitionTargetKm:520};
const h0=resolveCirculationSizeTransition(tr,100);
const h3=resolveCirculationSizeTransition(tr,103);
const h12=resolveCirculationSizeTransition(tr,112);
const h36=resolveCirculationSizeTransition(tr,136);
const h72=resolveCirculationSizeTransition(tr,172);
assert.equal(h0.referenceKm,360);
assert.ok(h3.referenceKm<365,'72 h transition advanced too quickly in first 3 h');
assert.ok(h12.referenceKm<390,'72 h transition advanced too quickly in first 12 h');
assert.ok(Math.abs(h36.referenceKm-440)<1e-9,'72 h midpoint wrong');
assert.equal(h72.referenceKm,520);
console.log('ROUND90 numeric:', {westerlyAvgKt:+avg.toFixed(2), westerlySdKt:+sd.toFixed(2), minKt:+min.toFixed(2), maxKt:+max.toFixed(2), h3:+h3.referenceKm.toFixed(2), h12:+h12.referenceKm.toFixed(2)});
`);
try {
  execFileSync(process.execPath,['--experimental-strip-types',entry],{stdio:'inherit'});
} finally {
  fs.rmSync(tmpDir,{recursive:true,force:true});
}
console.log('round90_westerly_latitude_transition_regression: PASS');
