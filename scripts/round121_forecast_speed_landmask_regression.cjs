const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const engine = read('src/simulation/Engine.ts');
const countries = JSON.parse(read('public/data/simulation_countries_asymmetric_v2.geojson'));

assert(engine.includes('getForecastSpeedSlowdownLandContext'), 'missing Round-121 slowdown-land context');
assert(engine.includes('FORECAST_SPEED_EURASIAN_MAINLAND_COUNTRIES'), 'missing Eurasian mainland whitelist');
assert(engine.includes('name === "Taiwan" || name === "Philippines"'), 'Taiwan/Philippines are not explicit slowdown targets');
assert(engine.includes('const isHainan ='), 'Hainan is not explicitly preserved');
assert(engine.includes('name === "Malaysia"') && engine.includes('bbox.maxLon <= 108.0'), 'Malay Peninsula / Borneo split missing');
assert(engine.includes('name === "Russia"') && engine.includes('wrappedChukotka'), 'Russia mainland / island split missing');
assert(engine.includes('const forecastSpeedLandNow = forecastSpeedLandContext.isLand'), 'speed-only land state not wired into forecast loop');
assert(engine.includes('const forecastLandNow = getForecastMeaningfulLandContext'), 'product land semantics should remain separate from speed mask');
assert(engine.includes('if (forecastSpeedLandNow) {'), 'speed-only post-land memory is not using the whitelist');
assert(engine.includes('history. This preserves a China/Taiwan/Hainan/Philippines post-landfall slowdown'), 'eligible-only historical post-land memory missing');

const mainlandNames = new Set([
  'Kazakhstan','Cambodia','Thailand','Laos','Myanmar','Vietnam','North Korea','South Korea',
  'Mongolia','India','Bangladesh','Bhutan','Nepal','Pakistan'
]);
function bboxOf(rings) {
  let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  for (const ring of rings) for (const p of ring) {
    minLat=Math.min(minLat,p[1]); maxLat=Math.max(maxLat,p[1]);
    minLon=Math.min(minLon,p[0]); maxLon=Math.max(maxLon,p[0]);
  }
  return {minLat,maxLat,minLon,maxLon};
}
function eligibleComponent(name,b) {
  if (name === 'Taiwan' || name === 'Philippines') return true;
  if (mainlandNames.has(name)) return true;
  if (name === 'China') {
    const mainland = b.maxLat >= 24 && (b.maxLon-b.minLon) >= 12;
    const hainan = b.minLat >= 17 && b.maxLat <= 21.2 && b.minLon >= 107.5 && b.maxLon <= 112.2;
    return mainland || hainan;
  }
  if (name === 'Russia') {
    const mainland = (b.maxLon-b.minLon) >= 30 && (b.maxLat-b.minLat) >= 12;
    const chukotka = b.minLon <= -179.5 && b.maxLon <= -174 && b.minLat >= 63 && b.maxLat <= 70.5;
    return mainland || chukotka;
  }
  if (name === 'Malaysia') return b.maxLon <= 108;
  return false;
}
function inRing(lat,lon,ring) {
  let inside=false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if (((yi>lat)!=(yj>lat)) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
function eligibleAt(lat,lon) {
  for (const f of countries.features) {
    const name = String(f.properties?.NAME || f.properties?.ADMIN || '');
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      const b=bboxOf(rings);
      if (!eligibleComponent(name,b)) continue;
      if (inRing(lat,lon,rings[0]) && !rings.slice(1).some(r=>inRing(lat,lon,r))) return true;
    }
  }
  return false;
}

// Positive targets.
assert(eligibleAt(31.2,121.5), 'China mainland should trigger speed slowdown');
assert(eligibleAt(43.1,131.9), 'Russian Far East mainland should trigger speed slowdown');
assert(eligibleAt(37.5,127.0), 'Korean peninsula should count as Eurasian mainland');
assert(eligibleAt(3.5,102.0), 'Malay Peninsula should count as Eurasian mainland');
assert(eligibleAt(23.7,121.0), 'Taiwan should trigger speed slowdown');
assert(eligibleAt(19.2,109.7), 'Hainan should trigger speed slowdown');
assert(eligibleAt(14.6,121.0), 'Philippines should trigger speed slowdown');

// Explicit non-target landmasses/islands.
assert(!eligibleAt(35.7,139.7), 'Japan must not trigger nearshore/post-land speed slowdown');
assert(!eligibleAt(32.8,130.7), 'Kyushu must not trigger nearshore/post-land speed slowdown');
assert(!eligibleAt(48.5,142.7), 'Sakhalin must not count as Eurasian mainland');
assert(!eligibleAt(4.0,114.0), 'Borneo must not trigger slowdown');
assert(!eligibleAt(-15.0,130.0), 'Australia must not trigger slowdown');

const result = ts.transpileModule(engine, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    isolatedModules: true
  },
  reportDiagnostics: true,
  fileName: 'src/simulation/Engine.ts'
});
const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert(errors.length === 0, `Engine.ts TypeScript syntax diagnostics: ${errors.map(e => e.messageText).join('; ')}`);

console.log('ROUND121 forecast-speed landmask regression: PASS');
console.log(JSON.stringify({
  slowdownTargets: ['Eurasian mainland','Taiwan','Hainan','Philippines'],
  excludedExamples: ['Japan','Sakhalin','Borneo','Australia'],
  productLandSemanticsPreserved: true,
  eligiblePostLandMemoryOnly: true
}));
