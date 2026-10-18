const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const loader = read('src/simulation/NaturalEarthLoader.ts');
const engine = read('src/simulation/Engine.ts');
const land = JSON.parse(read('public/data/simulation_land_asymmetric_v2.geojson'));

assert(loader.includes('landContainmentEdgeTree'), 'missing exact containment edge index');
assert(loader.includes('polygonPartId'), 'missing polygon-part parity grouping');
assert(loader.includes('oddParts'), 'missing exact even/odd containment parity');
assert(loader.includes('hasLandBoundaryWithinKmGeoJson'), 'missing conservative deep-ocean boundary fast path');

const liveFnStart = loader.indexOf('export function checkPointOnLandGeoJson');
const liveFnEnd = loader.indexOf('/**\n * Conservative live-physics proximity test', liveFnStart);
assert(liveFnStart >= 0 && liveFnEnd > liveFnStart, 'cannot isolate live land function');
const liveFn = loader.slice(liveFnStart, liveFnEnd);
assert(!liveFn.includes('booleanPointInPolygon('), 'live land function still performs Turf whole-feature point-in-polygon');
assert(liveFn.includes('landContainmentEdgeTree.search'), 'live land function does not use edge-local ray search');

assert(engine.includes('includeDistance: boolean = true'), 'forecast meaningful-land helper lacks boolean-only mode');
assert(engine.includes('if (!includeDistance) return { isLand: false, distanceKm: 999 };'), 'forecast boolean-only mode still computes distance fan-out');
assert(engine.includes('getForecastMeaningfulLandContext(currentLat, currentLon, config?.coastlineSource, false).isLand'), 'geometry forecast did not opt out of deprecated distance fan-out');
assert(engine.includes('!hasLandBoundaryWithinKmGeoJson(lat, lon, radiusKm + 2)'), 'land coverage lacks deep-ocean proof fast path');
assert(engine.includes('!hasLandBoundaryWithinKmGeoJson(lat, lon, outerRadius + 2)'), 'core-surface sampler lacks deep-ocean proof fast path');

function polygonParts(feature, nextId) {
  const g = feature.geometry || {};
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map(rings => ({ id: nextId(), rings }));
}

let partCounter = 0;
const parts = [];
const edges = [];
for (const feature of land.features) {
  for (const part of polygonParts(feature, () => partCounter++)) {
    parts.push(part);
    for (const ring of part.rings) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
      const edgeCount = ring.length - 1 + (closed ? 0 : 1);
      for (let i = 0; i < edgeCount; i++) {
        const a = ring[i % ring.length], b = ring[(i + 1) % ring.length];
        const x1 = Number(a[0]), y1 = Number(a[1]), x2 = Number(b[0]), y2 = Number(b[1]);
        edges.push({ minX: Math.min(x1,x2), minY: Math.min(y1,y2), maxX: Math.max(x1,x2), maxY: Math.max(y1,y2), x1,y1,x2,y2, partId: part.id });
      }
    }
  }
}

function coordCount(feature) {
  const g = feature.geometry || {};
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let n = 0;
  for (const p of polys) for (const r of p) n += r.length;
  return n;
}
function legacyCandidateCoordinateWork(lat, lon) {
  let n = 0;
  for (const f of land.features) {
    const b = f.properties?.BBOX || [-180,-90,180,90];
    if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) n += coordCount(f);
  }
  return n;
}
function rayCandidateWork(lat, lon) {
  let n = 0;
  for (const e of edges) if (e.minY <= lat && lat <= e.maxY && e.maxX >= lon && e.minX <= 180) n++;
  return n;
}
function ringContains(lat, lon, ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    const xi=Number(a[0]), yi=Number(a[1]), xj=Number(b[0]), yj=Number(b[1]);
    if (((yi > lat) !== (yj > lat)) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}
function legacyContains(lat, lon) {
  for (const f of land.features) {
    const b=f.properties?.BBOX || [-180,-90,180,90];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    const g=f.geometry||{};
    const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for (const rings of polys) {
      if (!rings.length || !ringContains(lat,lon,rings[0])) continue;
      if (!rings.slice(1).some(r=>ringContains(lat,lon,r))) return true;
    }
  }
  return false;
}
function edgeContains(lat, lon) {
  const odd = new Set();
  for (const e of edges) {
    if (!(e.minY <= lat && lat <= e.maxY && e.maxX >= lon)) continue;
    if ((e.y1 > lat) === (e.y2 > lat)) continue;
    const x = e.x1 + (lat-e.y1)*(e.x2-e.x1)/(e.y2-e.y1);
    if (x <= lon) continue;
    if (odd.has(e.partId)) odd.delete(e.partId); else odd.add(e.partId);
  }
  return odd.size > 0;
}

const perfSamples = [
  [26,155], [26,145], [26,135], [20,155], [15,135], [10,150]
];
const work = perfSamples.map(([lat,lon]) => ({ lat, lon, old: legacyCandidateCoordinateWork(lat,lon), edge: rayCandidateWork(lat,lon) }));
for (const row of work) {
  assert(row.old >= 18000, `expected giant legacy bbox work at ${row.lat},${row.lon}, got ${row.old}`);
  assert(row.edge <= 64, `edge ray should stay local at ${row.lat},${row.lon}, got ${row.edge}`);
}

// Deterministic semantic comparison away from exact boundaries.
let state = 0x13013013 >>> 0;
const rand = () => { state = (Math.imul(state,1664525)+1013904223)>>>0; return state/4294967296; };
for (let i=0;i<320;i++) {
  const lat = -18 + rand()*94;
  const lon = 66 + rand()*113;
  const a = legacyContains(lat,lon), b = edgeContains(lat,lon);
  assert(a === b, `edge parity land mismatch at ${lat.toFixed(5)},${lon.toFixed(5)}: ${a} vs ${b}`);
}

for (const [lat,lon,expected] of [[23.8,121.0,true],[35.7,139.7,true],[26,145,false],[15,135,false],[7,125,true]]) {
  assert(edgeContains(lat,lon) === expected, `representative land classification mismatch at ${lat},${lon}`);
}

for (const [file, source] of [['NaturalEarthLoader.ts', loader], ['Engine.ts', engine]]) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
    reportDiagnostics: true,
    fileName: `src/simulation/${file}`
  });
  const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert(errors.length === 0, `${file} TypeScript syntax diagnostics: ${errors.map(e=>e.messageText).join('; ')}`);
}

console.log('ROUND130 deep-ocean live-land + forecast stall regression: PASS');
console.log(JSON.stringify({
  exactContainmentEdges: edges.length,
  giantFeatureCoordinates: Math.max(...land.features.map(coordCount)),
  representativeWork: work,
  semanticSamplesChecked: 325,
  forecastDistanceFanoutDisabledForGeometry: true,
  deepOceanCoreSamplerFastPath: true
}));
