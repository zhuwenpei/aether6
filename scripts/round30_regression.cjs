const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));
const assert = (value, message) => { if (!value) throw new Error(`Round30 regression failed: ${message}`); };

const pkg = JSON.parse(read('package.json'));
const map = read('src/components/MapView.tsx');
const app = read('src/App.tsx');
const chrome = read('src/components/AetherMobileChrome.tsx');
const transport = read('src/components/AetherMobileTransport.tsx');
const joystick = read('src/components/VirtualJoystick.tsx');
const station = read('src/components/StationHistory.tsx');
const product = read('src/components/ForecastImageModal.tsx');
const radar = read('src/components/RadarProductControls.tsx');
const css = read('src/index.css');

assert(pkg.version === '4.3.14', 'package version must be 4.3.14');
assert(map.includes('const touchFirst = !!(typeof window') && !/useEffect\([\s\S]{0,500}const touchFirst/.test(map), 'touchFirst must be component-scoped');
assert(map.includes('attributionControl: false'), 'Leaflet attribution badge must be disabled');
assert(!map.includes('ty.displayName'), 'MapView must not access undeclared Typhoon.displayName');
assert(map.includes('stationMarkersRef.current[station.name]') && map.includes('marker.setPopupContent(popupHtml)'), 'station markers must be reused incrementally');
assert(map.includes('interactionScale = mapGestureActiveRef.current') && map.includes('mobileCadence = touchFirst ? 1.24 : 1'), 'adaptive raster/canvas mobile budget missing');
assert(map.includes('historyPointBudget = touchFirst ? 320 : 520'), 'historical display geometry budget missing');
assert(app.includes('joystickUiCommitAtRef') && app.includes('now - joystickUiCommitAtRef.current >= 84'), 'joystick React commit throttle missing');
assert(joystick.includes('handleRef') && joystick.includes('visualRafRef') && joystick.includes('compact ? 108 : 164'), 'joystick DOM-rAF path/compact geometry missing');

assert(chrome.includes('km/h') && !chrome.includes('MOBILE WORKSTATION'), 'mobile header subtitle/speed unit');
const collapsed = transport.slice(transport.indexOf('if(collapsed)'), transport.indexOf('return <section'));
assert(collapsed.indexOf('onStepBackward') < collapsed.indexOf('onPlayToggle'), 'collapsed previous-time key must remain first');
assert(collapsed.indexOf('onTerminate') > collapsed.indexOf('onPlayToggle') && !collapsed.includes('onStepForward'), 'collapsed next-time key must be replaced by stop/report');
assert(css.includes('backdrop-filter:blur(18px) saturate(140%)') && css.includes('right:calc(10px + env(safe-area-inset-right,0px))'), 'right glass transport styling missing');
assert(css.includes('body.aether-mobile-ui #joystick-wrapper') && css.includes('transform:none !important'), 'joystick must share bottom control band');

assert(station.includes('StationRadarModal') && !station.includes('StationVideoModal'), 'station radar must replace station video entry');
assert(!exists('src/components/StationVideoModal.tsx') && !exists('src/utils/StationVideoRenderer.ts'), 'legacy station video implementation must be removed');
assert(product.includes('radar_product') && product.includes('RadarProductControls'), 'product-center radar UI missing');
assert(radar.includes('实时图片') && radar.includes('变化视频') && radar.includes('fps') && radar.includes('成片时长') && radar.includes('开始时间') && radar.includes('结束时间'), 'radar image/video configuration incomplete');
assert(!radar.includes('generateStationVideo') && !radar.includes('mp4-muxer'), 'radar UI must not invoke renderer/encoder in Round30');

console.log('Round 30 regression: OK');
