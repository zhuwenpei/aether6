const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const audio = fs.readFileSync('src/utils/audio.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const drawer = fs.readFileSync('src/components/ControlDrawer.tsx', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');

for (const file of ['src/assets/audio/mahjong-press.wav', 'src/assets/audio/mahjong-release.wav']) {
  assert(fs.existsSync(file), `${file} missing`);
  assert(fs.statSync(file).size > 5000, `${file} unexpectedly small`);
}
assert(audio.includes('MAHJONG_PRESS_SAMPLE_URL'), 'recorded mahjong press asset URL missing');
assert(audio.includes('MAHJONG_RELEASE_SAMPLE_URL'), 'recorded mahjong release asset URL missing');
assert(audio.includes('export function playSndMahjongPress'), 'mahjong pointer-down player missing');
assert(audio.includes('export function playSndMahjongRelease'), 'mahjong pointer-up player missing');
assert(audio.includes('stamp - lastMahjongPointerMs < 140') || audio.includes('stamp - lastMahjongPointerMs < 160'), 'mahjong click de-duplication missing');
assert(app.includes('window.addEventListener("pointerdown", handlePointerDown, true)'), 'global mahjong pointer-down hook missing');
assert(app.includes('window.addEventListener("pointerup", handlePointerUp, true)'), 'global mahjong pointer-up hook missing');
assert(app.includes('playSndMahjongPress(volume, true)') || app.includes('playSndMahjongPress(config.soundVolume, true)'), 'press trigger missing');
assert(app.includes('playSndMahjongRelease(entry.volume, true)') || app.includes('playSndMahjongRelease(config.soundVolume, true)'), 'release trigger missing');
assert(drawer.includes('麻将音 (实录双触发)'), 'mahjong UI label not updated');

assert(css.includes('Round 126 · Global neutral / frosted-glass consolidation'), 'Round126 neutral-glass pass missing');
assert(css.includes('--aether-glass-surface: rgba(39, 39, 42, .64);'), 'neutral glass token missing');
assert(css.includes('backdrop-filter: blur(20px) saturate(108%)'), 'major-surface frosted glass missing');
assert(css.includes('--aether-glass-control: rgba(82, 82, 87, .34);'), 'neutral control token missing');
assert(css.includes('select option { background-color: #27272a !important;'), 'neutral select option palette missing');
assert(css.includes('.custom-leaflet-popup .leaflet-popup-content-wrapper'), 'Leaflet glass unification missing');

console.log('ROUND126 audio + neutral glass regression: PASS');
