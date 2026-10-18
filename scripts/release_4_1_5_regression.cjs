const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (s, needle, label) => assert.ok(s.includes(needle), `${label} missing: ${needle}`);
const lacks = (s, needle, label) => assert.ok(!s.includes(needle), `${label} must not contain: ${needle}`);

const pkg = JSON.parse(read('package.json'));
const video = read('src/utils/VideoRenderEngine.ts');
const videoModal = read('src/components/VideoExportModal.tsx');
const rainfallMap = read('src/utils/ObservedRainfallMap.ts');
const report = read('src/components/TyphoonReportModal.tsx');
const forecast = read('src/components/ForecastImageModal.tsx');
const precip = read('src/simulation/PrecipitationModel.ts');
const drawer = read('src/components/ControlDrawer.tsx');
const tutorial = read('src/components/AetherTutorial.tsx');
const engine = read('src/simulation/Engine.ts');

// Regression for the 4.1.5 feature set, retained after the 4.3.13 version bump.
assert.strictEqual(pkg.version, '4.3.13');
assert.strictEqual(pkg.scripts['test:release-4.1.5'], 'node scripts/release_4_1_5_regression.cjs');
has(engine, 'TyphoonSim/4.3.13', 'Engine User-Agent');

// 1. Himawari/JMA observation replay: exact hourly polyline and user-selectable framing.
has(video, 'function buildHourlyReplayPolyline', 'hourly replay polyline builder');
has(video, 'const pathStates: TyphoonState[] = buildHourlyReplayPolyline(history, currentSimHour);', 'Himawari hourly path');
has(video, 'const himawariZoomLevel = Math.max(1, Math.min(5', 'Himawari map-size control');
has(videoModal, '地图选区大小 / 缩放档位', 'video framing control label');
has(videoModal, '历史路径严格按每1小时归档点以折线连接，不进行样条平滑', 'Himawari path UI note');

// 2. China full-life rainfall frame should follow the affected heavy-rain swath,
// remain bounded to the China sector, and keep a safe full-China fallback.
has(rainfallMap, 'const relevant = snapshots.filter', 'dynamic China rainfall frame');
has(rainfallMap, 'const rainRadiusKm = Math.min(430, Math.max(150, windRadiusKm * .72));', 'heavy-rain footprint framing');
has(rainfallMap, 'minLon = clamp(minLon - 1.0, 72, 138.5)', 'bounded China longitude frame');
has(rainfallMap, 'return { minLon: 72, maxLon: 137.5, minLat: 14, maxLat: 55.5, refLon: 104.75 };', 'safe China fallback frame');
has(rainfallMap, 'function ringIntersectsDomain', 'domain-aware GeoJSON filtering');
has(rainfallMap, 'ctx.fill("evenodd")', 'GeoJSON hole-safe fill');
has(rainfallMap, 'ctx.clip(landClipPath, "evenodd")', 'land-mask evenodd clip');

// 3. Full-life rainfall is an explicit, cancellable computation with fullscreen progress.
has(report, 'const handleStartRainfallCalculation = async () =>', 'explicit rainfall start handler');
has(report, 'onClick={handleStartRainfallCalculation}', 'rainfall start button');
has(report, 'const handleStopRainfallCalculation = () =>', 'rainfall stop handler');
has(report, 'rainfallAbortRef.current?.abort()', 'rainfall cancellation');
has(report, 'z-[12000]', 'fullscreen rainfall progress modal');
has(report, '正在计算全程累计降水', 'rainfall progress modal text');
has(report, 'if (isRainfallCalculating || rainfallReady) return;', 'no auto calculation on tab entry');

// 4. Retire strike-probability and JTWC forecast products from the meteorological-product UI.
lacks(forecast, 'setImageStyle("jtwc")', 'JTWC forecast selector');
lacks(forecast, 'setImageStyle("strike_probability")', 'strike-probability selector');
lacks(forecast, '袭击概率产品', 'strike-probability UI description');
lacks(forecast, '彩色海岸线＝沿岸袭击概率', 'strike-probability renderer');
has(forecast, 'if (stored === "jtwc" || stored === "strike_probability") return "standard";', 'old-setting migration');
lacks(drawer, 'NMC/JTWC 风格预报图', 'usage JTWC forecast wording');
lacks(tutorial, 'NMC / JTWC 风格预报图', 'tutorial JTWC forecast wording');

// 5. NMC labels reserve a cone-free gutter and never render an unplaced box on top of the track.
has(forecast, 'const nmcConeAvoidanceEllipses', 'NMC cone no-label geometry');
has(forecast, 'const rectClearOfCone = (rect: Rect)', 'NMC cone collision test');
has(forecast, 'rectClearOfTrack(rect) && rectClearOfCone(rect)', 'NMC placement cone guard');
has(forecast, 'placedBoxes.forEach((box) =>', 'NMC render only placed boxes');
has(forecast, 'const annotationLatGutter = showInfoBoxes ? 1.20 : 0;', 'NMC annotation framing gutter');

// 7. Rainfall keeps its finite bands; radar no longer paints a heading-locked outer arm.
has(precip, 'function finiteRainbandGeometry(', 'finite rainband geometry helper');
lacks(precip, 'const finiteRadarBands = finiteRainbandGeometry(', 'removed radar heading-locked rainbands');
has(precip, 'const finiteBands = finiteRainbandGeometry(', 'precipitation finite rainbands');
lacks(precip, 'Math.log(Math.max(0.35, r / Math.max(12, rmw))) * 2.05', 'old unbounded radar spiral');
lacks(precip, '(r / Math.max(60, rmw)) * 36', 'old linearly winding precipitation spiral');
has(precip, 'const distantOuter = Math.min(690 + 70 * size', 'finite distant-rainband cap');
has(precip, 'incensePhase = angleDelta(', 'finite incense-coil phase');

for (const doc of ['UPDATE_NOTES_4.1.5.md', 'RESEARCH_BASIS_4.1.5.md']) {
  assert.ok(fs.existsSync(path.join(root, doc)), `${doc} missing`);
}

console.log('PASS release_4_1_5_regression');
