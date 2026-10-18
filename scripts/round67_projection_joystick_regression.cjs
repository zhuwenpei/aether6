const fs = require('fs');
const path = require('path');
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const read = p => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const projection = read('src/utils/MapProjection.ts');
const video = read('src/utils/VideoRenderEngine.ts');
const videoUi = read('src/components/VideoExportModal.tsx');
const engine = read('src/simulation/Engine.ts');
const forecast = read('src/components/ForecastImageModal.tsx');

// LAEA scale must not change merely because the moving storm centre changed latitude.
assert(projection.includes('const localScale = worldSize / (2 * Math.PI);'), 'LAEA fixed pixel scale missing');
assert(!projection.includes('2 * Math.PI * Math.max(0.16, Math.cos(phi0))'), 'old latitude-dependent LAEA zoom breathing remains');

// Himawari and JMA expose/use the same storm-centred LAEA option.
assert(videoUi.includes('LAEA 新投影') && videoUi.includes('isHimawari8Profile'), 'Himawari LAEA UI missing');
assert(video.includes('useHimawariAzimuthalProjection') && video.includes('himawariLaeaProjector'), 'Himawari LAEA renderer missing');
assert(video.includes('if (useHimawariAzimuthalProjection)') && video.includes('ctx.arc(c.x, c.y, radiusPx'), 'Himawari LAEA wind circles are not held round');

// Westerly joystick must be continuous and independent of ET progress.
assert(engine.includes('const stickMagnitude = clamp01(Math.hypot(effectiveDx, effectiveDy))'), 'joystick magnitude blend missing');
assert(engine.includes('u_agg = joyU + westVec.u * environmentalShare;') && engine.includes('v_agg = joyV + westVec.v * environmentalShare;'), 'continuous vector blend missing');
assert(!engine.includes('etControlFreedom') && !engine.includes('meridionalRelease'), 'ET-dependent joystick restriction remains');
assert(engine.includes('const scale = westerlyCapKmh / speedKmh;') && !engine.includes('const vKmh = Math.max(-48'), 'westerly speed cap still changes heading by axis clamp');

// JMA forecast chart must use the specified north-polar stereographic parameters.
assert(projection.includes('projectNorthPolarStereographicKm') && projection.includes('lon0 = 140') && projection.includes('latTs = 60'), 'polar stereographic helper/parameters missing');
assert(forecast.includes('projectNorthPolarStereographicKm(lat, lon, 140, 60)'), 'JMA forecast is not using lon_0=140 / lat_ts=60 polar stereographic');
assert(forecast.includes('northPolarStereographicScaleFactor(lat, 60)') && forecast.includes('ctx.arc(p.x, p.y, r'), 'JMA forecast circles are not preserved as synchronized screen circles');
assert(forecast.includes('Polar Stereographic') && forecast.includes('lat₀=90°N'), 'JMA forecast UI/documentation does not expose requested projection');

console.log('Round 67 projection / joystick regression: PASS');
