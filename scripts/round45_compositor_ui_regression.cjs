const fs = require('fs');
const assert = require('assert');

const drawer = fs.readFileSync('src/components/ControlDrawer.tsx','utf8');
const forecast = fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const compositor = fs.readFileSync('src/cloudCompositor/CloudCompositorModal.tsx','utf8');
const types = fs.readFileSync('src/cloudCompositor/types.ts','utf8');
const step2 = fs.readFileSync('src/cloudCompositor/components/Step2Typhoon.tsx','utf8');
const step4 = fs.readFileSync('src/cloudCompositor/components/Step4Export.tsx','utf8');
const css = fs.readFileSync('src/index.css','utf8');

assert(!drawer.includes('MusicPlaylist'), 'music playlist must be removed from ControlDrawer');
assert(!fs.existsSync('src/components/MusicPlaylist.tsx'), 'MusicPlaylist component should be removed');
assert(forecast.includes('CloudCompositorModal'), 'cloud compositor must be integrated into product center');
assert(forecast.includes('卫星实景拼接'), 'separate satellite real-image compositor entry missing');
assert(forecast.includes('AETHER 云图生成'), 'procedural AETHER cloud generation must remain distinct');
assert(forecast.includes('initialDate={cloudCompositorDate}'), 'compositor should inherit simulation date');
assert(compositor.includes('cloud-compositor-overlay'), 'compositor must remain a dedicated full-page workflow');
assert(types.includes('cloudLayerId?: string'), 'capability-resolved GIBS layer must persist into export');
assert(step2.includes('updateState({ cloudLayerId:'), 'Step 2 must save resolved GIBS layer');
assert(step4.includes('state.cloudLayerId ||'), 'export must use resolved GIBS layer');
assert(step4.includes('controllers.forEach((controller) => controller.abort())'), 'network requests must cancel when compositor closes');
assert(css.includes('AETHER Round 45 — shared interaction / viewport adaptation'), 'shared UI adaptation layer missing');
assert(css.includes('font-size: 16px !important; /* prevent browser auto-zoom while editing */'), 'mobile form auto-zoom prevention missing');

console.log('Round 45 compositor/UI regression: PASS');
