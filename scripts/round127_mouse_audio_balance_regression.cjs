const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const audio = fs.readFileSync('src/utils/audio.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const drawer = fs.readFileSync('src/components/ControlDrawer.tsx', 'utf8');

for (const file of [
  'src/assets/audio/mahjong-press.wav',
  'src/assets/audio/mahjong-release.wav',
  'src/assets/audio/mouse-press.wav',
  'src/assets/audio/mouse-release.wav'
]) {
  assert(fs.existsSync(file), `${file} missing`);
  assert(fs.statSync(file).size > 5000, `${file} unexpectedly small`);
}

assert(audio.includes('MOUSE_PRESS_SAMPLE_URL'), 'recorded mouse press asset URL missing');
assert(audio.includes('MOUSE_RELEASE_SAMPLE_URL'), 'recorded mouse release asset URL missing');
assert(audio.includes('ensureMouseSampleBuffers'), 'recorded mouse sample decode path missing');
assert(audio.includes('export function playSndMousePress'), 'mouse pointer-down player missing');
assert(audio.includes('export function playSndMouseRelease'), 'mouse pointer-up player missing');
assert(audio.includes('playDecodedBuffer(ctx, press, volume, 0.78)'), 'mouse press level match missing');
assert(audio.includes('playDecodedBuffer(ctx, release, volume, 0.78)'), 'mouse release level match missing');
assert(audio.includes('stamp - lastMousePointerMs < 160'), 'mouse click de-duplication missing');
assert(audio.includes('TACTILE_RELEASE_MIN_DELAY_MS.mouse') || audio.includes('window.setTimeout(() => playSndMouseRelease(volume, true), 58)'), 'mouse preview/keyboard pair timing missing');

assert(app.includes('playSndMousePress,'), 'mouse press import missing');
assert(app.includes('playSndMouseRelease,'), 'mouse release import missing');
assert(app.includes('const activeSoundPointers = new Map<number, ActiveSoundPointer>();') || app.includes('const activeSoundPointers = new Map<number, "mahjong" | "mouse">();'), 'dual-mode pointer phase map missing');
assert(app.includes('else playSndMousePress(volume, true);') || app.includes('else playSndMousePress(config.soundVolume, true);'), 'mouse pointer-down trigger missing');
assert(app.includes('else playSndMouseRelease(entry.volume, true);') || app.includes('else playSndMouseRelease(config.soundVolume, true);'), 'mouse pointer-up trigger missing');
assert(app.includes('playSndClick(soundConfig.soundVolume, true, soundConfig.soundMode || "mouse")') || app.includes('playSndClick(config.soundVolume, true, config.soundMode || "mouse")'), 'keyboard/global click compatibility missing');
assert(drawer.includes('鼠标音 (实录双触发)'), 'mouse UI label not updated');

console.log('ROUND127 recorded mouse press/release + loudness balance regression: PASS');
