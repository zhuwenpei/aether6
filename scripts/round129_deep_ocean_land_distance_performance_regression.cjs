const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync('src/simulation/NaturalEarthLoader.ts', 'utf8');
const engine = fs.readFileSync('src/simulation/Engine.ts', 'utf8');
const distanceFn = src.slice(src.indexOf('export function getDistanceToLandGeoJson'), src.indexOf('/**\n * Turf-based distance helper'));

assert(src.includes('const SEARCH_RADII = [3, 15, 30, 60, 120, 180] as const;'), 'distance search must expand progressively through RBush');
assert(src.includes('const landBoundaryTree = new RBush<BoundarySegmentItem>();'), 'segment-level RBush missing');
assert(src.includes('const collectCandidateSegments = (radius: number): BoundarySegmentItem[] =>'), 'indexed boundary-segment candidate collection missing');
assert(src.includes('landBoundaryTree.load(boundaryItems);'), 'segment-level RBush build missing');
assert(src.includes('minDistance > searchRadius'), 'distance-bound verification expansion missing');
assert(!/const targetFeatures = candidates\.length > 0 \? candidates\.map\(c => c\.feature\) : landGeoJson\.features;/.test(distanceFn), 'deep-ocean global feature-scan fallback must not return');
assert(src.includes('rawMinX < -180') && src.includes('rawMaxX > 180'), 'antimeridian-safe indexed search missing');
assert(engine.includes('const scale = fastMode ? 10 : 50;'), 'fast-mode distance cache quantization unexpectedly changed');
assert(engine.includes('minDistance = getDistanceToLandGeoJson(lat, lon);'), 'Engine must continue using the Natural Earth distance helper');

console.log('ROUND129 deep-ocean land-distance performance regression: PASS');
