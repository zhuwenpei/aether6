const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const assert = (value, message) => { if (!value) throw new Error(`Round32 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const app = read('src/App.tsx');
const map = read('src/components/MapView.tsx');
const modal = read('src/components/ForecastImageModal.tsx');
const products = read('src/utils/EnsembleReferenceProducts.ts');

assert(pkg.version === '4.3.16', 'package version must be 4.3.16');
assert(pkg.scripts['test:round32'] === 'node scripts/round32_regression.cjs', 'round32 npm regression entry missing');

assert(map.includes('const targetFrameMs = 1000 / 60'), 'live centre must explicitly target 60 fps');
assert(map.includes('budget.nextVisualAt') && map.includes('do { budget.nextVisualAt += targetFrameMs; }'), '60 fps deadline accumulator missing');
assert(!map.includes('budget.degraded ? 35') && !map.includes('config.followMainTyphoon ? 40'), 'legacy mobile low-fps target survived');
assert(map.includes('mobile-live-circle') && map.includes('touchFirst && isPlaying && !historicalPlayback'), 'mobile live radii circle fast path missing');
assert(map.includes('degraded ? 6 : touchFirst ? 4.25 : 1.75'), 'mobile follow-camera dead-band optimization missing');
assert(map.includes('document.visibilityState === "hidden"'), 'background live animation suspension missing');
assert(app.includes('mobileCommitScale = useLegacyMobileUi ? (speed > 15 ? 1.38 : speed > 5 ? 1.32 : 1.22) : 1'), 'mobile whole-tree commit budget missing');
assert(app.includes('simMinutesBufferRef.current >= 10.0') && app.includes('totalSimMinutesRef.current += 10.0'), 'fixed 10-minute physics step must remain unchanged');

const styleIds = [
  'track_diagnostics_4panel',
  'diagnostic_matrix_2model',
  'deterministic_overview',
  'member_spaghetti_ranked',
  'member_spaghetti_mean',
  'diagnostic_matrix_3model',
  'pressure_spaghetti_basin',
  'paired_cycle_pressure'
];
for (const id of styleIds) assert(products.includes(`"${id}"`), `reference product style ${id} missing`);
assert(products.includes('getSynopticEnvironmentState'), 'environment diagnostics must use AETHER synoptic state');
assert(products.includes('pressureBins'), 'pressure-coded spaghetti bins missing');
assert(products.includes('previousCycleTrack') && products.includes('synthetic previous-cycle'), 'paired-cycle synthetic disclosure missing');
assert(products.includes('drawEnsembleReferenceProduct'), 'reference renderer dispatch missing');

assert(modal.includes('ENSEMBLE_REFERENCE_STYLES'), 'reference style selector not wired into product modal');
assert(modal.includes('forecast_ensembleReferenceStyle'), 'reference style persistence missing');
assert(modal.includes('drawEnsembleReferenceProduct'), 'reference renderer not wired into canvas generation');
assert(modal.includes('多模式 / 集合路径 · 9版式'), 'nine-layout product entry label missing');
assert(modal.includes('ensembleProductNeedsMembers'), 'member-requiring layouts are not integrated with ensemble calculation');

console.log('Round 32 regression: OK');
