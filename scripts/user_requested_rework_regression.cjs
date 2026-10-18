const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (s, needle, label) => assert.ok(s.includes(needle), `${label} missing: ${needle}`);
const lacks = (s, needle, label) => assert.ok(!s.includes(needle), `${label} must not contain: ${needle}`);

const app = read('src/App.tsx');
const image = read('src/components/ForecastImageModal.tsx');
const guidance = read('src/simulation/AetherEnsembleGuidance.ts');
const map = read('src/components/MapView.tsx');
const panel = read('src/components/AetherIntensityPanel.tsx');
const timeline = read('src/components/Timeline.tsx');
const status = read('src/components/TyphoonStatusCard.tsx');
const desktop = read('src/components/AetherDesktopChrome.tsx');
const terrain = read('src/utils/StormTerrainBasemap.ts');
const sat = read('src/simulation/HurricaneTrackerPort.ts');
const rain = read('src/utils/ObservedRainfallMap.ts');
const css = read('src/index.css');

// 1. Freeze the requested product style for the asynchronous generation pass.
has(image, 'requestedStyle: ProductStyle = imageStyle', 'product style snapshot parameter');
has(image, 'const requestedStyle = imageStyle;', 'product generation snapshot');
has(image, 'drawMapOnCanvas(canvas, false, requestedStyle)', 'product snapshot dispatch');

// 2. Ensembles use smooth multi-scale stochastic bends/regimes rather than one radial fan.
has(guidance, 'sampleSmoothKnots(', 'ensemble smooth-knot perturbation');
has(guidance, 'regime', 'ensemble regime perturbation');
has(guidance, 'centerCrossKnots', 'guidance-center shape perturbation');

// 3. Manual interventions are cumulative at the same time step rather than baseline-reset transactions.
lacks(app, 'prepareManualIntervention', 'old intervention baseline reset');
lacks(app, 'manualInterventionSessionRef', 'old intervention transaction state');
has(app, 'aether-influence-modal', 'desktop/mobile influence modal hook');

// 5/12/13. Intensity panel uses the full history, pointer hover, and selected-agency reporting.
lacks(panel, '.slice(-80)', 'rolling intensity window');
has(panel, 'getAgencyIntensity(', 'agency-aware intensity chart');
has(panel, 'onPointerMove', 'intensity chart hover');
has(panel, 'Math.ceil(rows.length / 440)', 'intensity path decimation');
has(desktop, 'getAgencyIntensity(', 'agency-aware desktop chrome');

// 6. Expanded timeline remains centered and uses the same workstation visual language.
has(timeline, 'left-1/2 -translate-x-1/2', 'centered expanded timeline');
has(timeline, 'storminc-timeline-expanded', 'expanded timeline style hook');

// 8/9. STORM_INC-like forecast cone/path and more opaque ensemble paths.
has(map, 'fillColor: "#24344f"', 'forecast cone palette');
has(map, 'const col = "#22d3ee";', 'forecast path palette');
has(map, 'storminc-forecast-lead-label', 'forecast lead labels');
has(image, 'Math.max(.62,.95*scale),.70,true', 'ensemble member opacity');

// 10. Terrain shows selected mountain massifs/relief with sharp ridge/contour treatment.
has(terrain, 'e>=1550', 'major mountain threshold');
has(terrain, 'const relief=localMax-localMin;', 'terrain relief selector');
has(terrain, 'massif', 'mountain edge treatment');
lacks(terrain, 'e>=420', 'old broad elevation wash');

// 11/16. Satellite angular texture is periodic across atan2 and carries shear/dry-air structure damage.
has(sat, 'const armCount', 'periodic integer spiral-arm count');
has(sat, 'tilted vortex column', 'shear-relative vortex tilt');
has(sat, 'dry_leaf', 'dry-air damaged structure');
has(sat, 'incense_coil', 'incense-coil structure');
has(sat, 'dry_rebuilding_core', 'dry-air rebuild memory');

// 14. Collapsed status card has a desktop/mobile reopen placement above the map chrome.
has(css, '[id^="typhoon-card-collapsed-"]', 'status-card reopen placement');

// 15. Full-track rain map hides the extreme marker and uses a dynamic China heavy-rain frame.
has(rain, 'if (!fullTrackProduct && maxRain >=', 'full-track max marker suppression');
has(rain, 'const relevant = snapshots.filter', 'dynamic China rain frame');

// 17. Phone UI follows the workstation design below the 900px breakpoint.
has(status, 'window.innerWidth < 900', 'mobile status-card selection');
has(css, '@media (max-width:899px)', 'mobile workstation breakpoint');
has(css, '.storminc-dock', 'mobile command dock redesign');

console.log('PASS user_requested_rework_regression');
