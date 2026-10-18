/** AETHER 4.3.13 regression: popup startup, radar heading independence and version. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.version, '4.3.13');
assert.match(read('index.html'), /<title>AETHER 4\.3\.13 · Typhoon Simulation System<\/title>/);
const engine = read('src/simulation/Engine.ts');
assert.equal((engine.match(/TyphoonSim\/4\.3\.13/g) || []).length, 2);
const map = read('src/components/MapView.tsx');
assert(!/\bmap\.getPopup\s*\(/.test(map), 'Leaflet Map has no getPopup method');
assert(map.includes('centerPopup?.isOpen()') && map.includes('centerPopup.setContent(popupHtml)'), 'refresh only owned open center popup');
assert(map.includes('hitAreaAny.__aetherCenterPopup = activePopup') && map.includes('map.openPopup(activePopup.setLatLng'), 'click opens tracked Leaflet popup');
assert(map.includes('map.closePopup(oldPopup)'), 'replace/remove centre closes its stale popup');
const precip = read('src/simulation/PrecipitationModel.ts');
const radar = precip.slice(precip.indexOf('export function computeGroundRadarDiagnostics('), precip.indexOf('export function computeGroundRadarReflectivity('));
assert(!radar.includes('finiteRainbandGeometry('), 'radar must not render movement-locked finite outer band');
assert(!radar.includes('state.direction'), 'radar morphology must not depend on cyclone translation heading');
assert(precip.includes('const finiteBands = finiteRainbandGeometry('), 'retain finite physical rainband geometry for rainfall totals');
assert(radar.includes('innerSpiral * innerBandEnvelope'), 'retain independent inner radar precipitation arc');
const result = ts.transpileModule(precip, { fileName:'PrecipitationModel.ts', reportDiagnostics:true, compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS} });
assert(!result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error), 'precipitation TS syntax valid');
const compiledModule = {exports:{}};
new Function('module','exports','require',result.outputText)(compiledModule,compiledModule.exports,id => { throw Error('unexpected runtime import '+id); });
const {computeGroundRadarDiagnostics: diagnostic} = compiledModule.exports;
const storm = {lat:19.1,lon:127.9,vmax:43,pmin:955,rmw:32,r7:{ne:190,se:210,sw:180,nw:175},simHour:17,deepConvectiveCoverage:.72,eyewallIntegrity:.76,moistureReservoir:.83,rainbandDominance:.73};
let active = 0;
for (let i=0;i<15;i++) for (let j=0;j<19;j++) {
  const km = 18+32*i,angle = j*2*Math.PI/19;
  const lat = storm.lat + km*Math.cos(angle)/111.12;
  const lon = storm.lon + km*Math.sin(angle)/(111.12*Math.cos(storm.lat*Math.PI/180));
  for (const isLand of [false,true]) {
    const base = diagnostic({...storm,direction:0},lat,lon,{isLand,elevation:270});
    const turned = diagnostic({...storm,direction:217},lat,lon,{isLand,elevation:270});
    assert.deepEqual(turned,base,'heading changes must not rotate or redraw a radar-only band');
    assert(Number.isFinite(base.dbz) && base.dbz>=0 && base.dbz<=65, 'radar finite bounded reflectivity');
    if (base.dbz>10) active++;
  }
}
assert(active>50, 'eyewall and independent precipitation arcs remain on radar');
console.log('round20_regression PASS: version 4.3.13, Leaflet popup API and ownership, radar heading-invariance, rainfall model preserved, numeric radar field');
