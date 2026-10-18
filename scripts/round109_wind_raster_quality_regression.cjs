const fs = require("fs");
const assert = require("assert");
const read = (p) => fs.readFileSync(p, "utf8");

const pkg = JSON.parse(read("package.json"));
assert.equal(pkg.version, "6.0.32", "ROUND109 package version mismatch");

const map = read("src/utils/SynopticWindPressureMap.ts");
assert(map.includes('const rasterW = Math.max(MAP.w, Math.round(mapW));'), 'wind raster width was not restored to display-space sampling');
assert(map.includes('const rasterH = Math.max(MAP.h, Math.round(mapH));'), 'wind raster height was not restored to display-space sampling');
assert(map.includes('ctx.imageSmoothingEnabled=true;'), 'final raster draw does not restore interpolation');
assert(map.includes('imageSmoothingQuality = "high"'), 'high-quality smoothing hint missing');
assert(map.includes('renderCache.rasterImageData'), 'ImageData reuse was lost');
assert(map.includes('sampleWindVectorAndSpeedAtLonLat'), 'ROUND108 no-quality-loss vector sample merge missing');
assert(!map.includes('lonCells * samplesPerCell'), 'old low-resolution raster-density optimisation still active');

console.log('ROUND109 wind-raster quality regression: PASS');
console.log(JSON.stringify({ rasterSampling: 'display-space', smoothing: 'high', cacheReuse: true }));
