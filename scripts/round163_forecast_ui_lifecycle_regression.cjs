'use strict';
const fs=require('fs'),assert=require('assert');
const app=fs.readFileSync('src/App.tsx','utf8');
const sandbox=fs.readFileSync('src/components/ForecastPreSimulation.tsx','utf8');
const mobile=fs.readFileSync('src/components/AetherMobileChrome.tsx','utf8');
const desktop=fs.readFileSync('src/components/AetherDesktopChrome.tsx','utf8');
const map=fs.readFileSync('src/components/MapView.tsx','utf8');
// During the sandbox there must be ONE Leaflet map and ONE active settings drawer.
assert(app.includes('{!preSimulationInput && <MapView'));
assert(app.includes('{!preSimulationInput && <ControlDrawer'));
assert(app.includes('{!preSimulationInput && (useLegacyMobileUi ? <AetherMobileChrome'));
// The pre-simulation camera inherits the live view and the live view is restored.
assert(app.includes('liveCameraBeforeForecastRef.current={center:[center.lat,center.lng],zoom:liveMap.getZoom()}'));
assert(app.includes('mapViewport={liveCameraBeforeForecastRef.current ?? undefined}'));
assert(app.includes('initialViewport={liveCameraBeforeForecastRef.current ?? undefined}'));
assert(sandbox.includes('initialViewport={mapViewport}'));
assert(map.includes('zoom: initialViewport?.zoom ?? 4'));
assert(map.includes('preserveRestoredCameraRef.current=false'));
// Shared mobile drawer styles must match the sandbox's mobile drawer.
assert(sandbox.includes('mobileMode={mobileChrome}'));
assert(sandbox.includes('onMoreOpen={pauseForMenu}'));
assert(sandbox.includes('if(wasPlaying){')&&sandbox.includes('setCursor(hourRef.current)'), 'only a playing sandbox may publish the live hour when opening a menu');
assert(sandbox.includes('onInfluence={openQuickTools}'));
assert(desktop.includes('if(!mobileMoreOpen)onMoreOpen?.()'));
assert(mobile.includes('if(!moreOpen)onMoreOpen?.()'));
// Global .storminc-top-actions styles force 31-px-wide buttons on mobile.
// Branch-specific buttons must NOT receive that class and wrap their labels.
assert(sandbox.includes('data-forecast-branch-actions'));
assert(!sandbox.includes('storminc-top-actions pointer-events-auto'));
assert(sandbox.includes('whitespace-nowrap'));
console.log('ROUND163 UI PASS: isolated map/drawer, camera restore, no stale overflow, correct mobile styles, menu pause and readable quick-action layout.');
