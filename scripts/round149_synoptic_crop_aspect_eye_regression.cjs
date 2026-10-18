const fs=require('fs');
const vm=require('vm');
const assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
function load(file){
 const content=fs.readFileSync(file,'utf8');
 const js=ts.transpileModule(content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};vm.runInNewContext(js,{exports:module.exports,module,Math}, {filename:file});return module.exports;
}
const layout=load('src/utils/SynopticProductLayout.ts');
const crop={lonMin:118,lonMax:126,latMin:16,latMax:34};
const frame={w:860,h:1470};
const nw=layout.synopticCropProject(crop,frame,crop.latMax,crop.lonMin);
const se=layout.synopticCropProject(crop,frame,crop.latMin,crop.lonMax);
assert(Math.abs(nw.x)<1e-7&&Math.abs(nw.y)<1e-7);
assert(Math.abs(se.x-frame.w)<1e-7&&Math.abs(se.y-frame.h)<1e-7);
for(const t of [0,.1,.25,.5,.75,.9,1]){
 const lat=layout.synopticCropLatitudeAtRow(crop,t);
 const p=layout.synopticCropProject(crop,frame,lat,(crop.lonMin+crop.lonMax)/2);
 assert(Math.abs(p.y-t*frame.h)<1e-8,'map crop latitude must match Leaflet Mercator scale');
}

const aspects=['default','3:4','4:3','9:16','16:9'];
for(const style of ['default','hmon','hwrf'])for(const a of aspects){
 const l=layout.synopticProductLayout(style,a);
 assert(l.height>l.map.h+l.map.y && l.map.w>0 && l.map.h>0);
 assert(Math.abs(l.map.w/l.map.h-l.mapAspect)<1e-10);
 if(a==='default') assert.equal(l.height,{default:1024,hmon:1462,hwrf:1230}[style]);
 else assert(Math.abs(l.height/1536-1/layout.synopticOutputAspect(style,a))<.002);
 if(a==='3:4'||a==='9:16')assert(l.portrait && l.colorbar.y>l.map.y+l.map.h);
 else assert(!l.portrait && l.colorbar.x>l.map.x+l.map.w);
}
// Round151 reverts all wind-eye / eyewall post-processing to Round148.
// Keep Round149 crop/aspect tests, but never require the superseded repair module.
assert(!fs.existsSync('src/simulation/SynopticCoreRepair.ts'));
const nativeField=fs.readFileSync('src/simulation/SynopticWindField.ts','utf8');
assert(!nativeField.includes('repairSynopticCoreVectors'), 'No Round149 / Round150 core post-processing');
const render=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const app=fs.readFileSync('src/App.tsx','utf8');
const modal=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
const video=fs.readFileSync('src/utils/SynopticWindPressureVideo.ts','utf8');
assert(render.includes('return { lonMin, lonMax, latMin, latMax };') && render.includes('const isPickedCrop=options.domainMode'));
assert(render.includes('synopticCropProject(bounds,MAP') && render.includes('synopticCropLatitudeAtRow(bounds,t)') && render.includes('latAtRow(py/'));
assert(render.includes('if (layout.portrait)') && render.includes('左低 → 右高'));
assert(app.includes('synopticCropLayout.mapAspect') && !app.includes('aspectRatio: "1348 / 940"'));
assert(modal.includes('value={synopticAspectRatio}') && modal.includes('aspectRatio: synopticAspectRatio'));
assert(video.includes('aspectRatio: options.aspectRatio') && video.includes('videoHeight'));
console.log('ROUND149 (Round151-compatible): 15 crop layouts + native Round148 eye field + integration hooks PASS');
