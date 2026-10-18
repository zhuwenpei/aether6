const fs = require('fs');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const read = (p) => fs.readFileSync(p, 'utf8');

const engine = read('src/simulation/Engine.ts');
const vortex = read('src/simulation/TropicalCycloneVortex.ts');
const field = read('src/simulation/SynopticWindField.ts');
const ensemble = read('src/simulation/AetherEnsembleGuidance.ts');
const renderer = read('src/utils/SynopticWindPressureMap.ts');
const video = read('src/utils/SynopticWindPressureVideo.ts');
const recordVideo = read('src/utils/SynopticWindPressureRecordVideo.ts');
const modal = read('src/components/ForecastImageModal.tsx');
const recordPanel = read('src/components/SynopticWindPressureRecordVideoPanel.tsx');

// 0 hPa is the only lower bound for central pressure throughout the model/product path.
assert(engine.includes('Math.max(0, Math.min(1045, Number.isFinite(ty.pmin)'), 'live engine pmin floor is not 0 hPa');
assert(engine.includes('newPmin = Math.max(0, Math.min(1045, newPmin))'), 'live engine output pmin floor is not 0 hPa');
assert(engine.includes('const pc = Math.max(0, Math.min(ambient, pmin))'), 'radial pressure profile still uses a nonzero pmin floor');
assert(engine.includes('return Math.max(0, Math.round(901 - 1.92 * (vmax - 68.0)))'), 'pressure-from-wind extrapolation can still go below 0 hPa');
assert(vortex.includes('state.pmin : 1000, 0, 1045'), 'TC vortex still clamps pmin above 0 hPa');
assert(field.includes('pmin: clamp(lerpNum("pmin", seed.pmin), 0, 1045)'), 'synoptic forecast interpolation still clamps pmin above 0 hPa');
assert(ensemble.includes('pressureNoise,0,1045'), 'ensemble guidance still clamps pmin above 0 hPa');
for (const [name, src] of [['Engine', engine], ['Vortex', vortex], ['Synoptic field', field]]) {
  assert(!/pmin[^\n]{0,120}850|850[^\n]{0,120}pmin/.test(src), `${name} still contains an 850 hPa pmin floor`);
}

// Three render styles exist and reference styles change more than just labels.
assert(renderer.includes('export type SynopticWindPressureStyle = "default" | "hmon" | "hwrf"'), 'three wind product styles missing');
assert(renderer.includes('REFERENCE_WIND_PALETTE') && renderer.includes('{ kt: 155') && renderer.includes('{ kt: 7'), 'reference 7-155 kt palette missing');
assert(renderer.includes('drawReferenceWindBarbs') && renderer.includes('windBarbs: true'), 'reference-style wind barbs missing');
assert(renderer.includes('contourWidth: 0.95') && renderer.includes('contourWidth: 0.85'), 'HMON/HWRF contour styling missing');
assert(renderer.includes('HMON STYLE') && renderer.includes('HWRF STYLE'), 'reference-style header variants missing');
assert(renderer.includes('不伪造本模型没有的 850 hPa 高度场'), 'HMON style must not falsely label an uncomputed 850-hPa height field');

// Still-image, forecast-video, and historical-record-video paths all carry the same selected style.
assert(modal.includes('forecast_synopticStylePreset'), 'style persistence missing from image/video workstation');
assert(modal.includes('<option value="hmon">HMON 参考风格</option>') && modal.includes('<option value="hwrf">HWRF 参考风格</option>'), 'image/video style selector missing');
assert((modal.match(/stylePreset: synopticStylePreset/g) || []).length >= 2, 'style not propagated to both still image and forecast video');
assert(video.includes('stylePreset?: SynopticWindPressureMapOptions["stylePreset"]') && video.includes('stylePreset: options.stylePreset'), 'forecast video does not preserve style');
assert(recordPanel.includes('stylePreset: SynopticWindPressureStyle') && recordPanel.includes('HMON 参考风格') && recordPanel.includes('HWRF 参考风格'), 'record-video style selector missing');
assert(recordVideo.includes('stylePreset?: SynopticWindPressureMapOptions["stylePreset"]') && recordVideo.includes('stylePreset: options.stylePreset'), 'record video does not preserve style');

console.log('ROUND117 pressure-floor / wind-style regression: PASS');
