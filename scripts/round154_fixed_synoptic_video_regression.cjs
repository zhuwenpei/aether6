const fs=require('fs'),path=require('path'),assert=require('assert');
const vm=require('vm'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const map=read('src/utils/SynopticWindPressureMap.ts');
const exporter=read('src/utils/SynopticWindPressureRecordVideo.ts');
const panel=read('src/components/SynopticWindPressureRecordVideoPanel.tsx');
const app=read('src/App.tsx');
const vid=read('src/components/VideoExportModal.tsx');
const preview=read('src/utils/SynopticRecordMapPreview.ts');
assert(!map.includes('ctx.fillText(String(Math.round(level))'),'isobar numbers still present');
assert(!map.includes('ctx.strokeText(String(Math.round(level))'),'isobar outlines still present');
assert(map.includes('ctx.stroke();') && map.includes('contourSegments('),'isobar lines accidentally removed');
for(const hook of ['videoMode: settings.videoMode','startHour: clipStart','endHour: clipEnd','aspectRatio: settings.aspectRatio',"videoMode === \"fixed\"",'fixedBoundsConfirmed','双滑块','onStartMapSelection(settings.stylePreset,settings.aspectRatio)']) assert(panel.includes(hook),hook);
for(const hook of ['setSynopticSelecting(true)','synopticCropTargetRef.current',"typhoon_synoptic_record_video_v1",'onStartSynopticRecordSelection','setVideoExportTyphoon(synopticVideoReturnRef.current)'])assert(app.includes(hook),hook);
assert(vid.includes('onStartMapSelection={onStartSynopticRecordSelection}'));
for(const hook of ['const fixed = options.videoMode === "fixed"','validHour = startHour + (endHour - startHour) * frac','domainMode: fixed ? "custom"','mapZoom: fixed ? 1','videoBitrate','synopticProductLayout','aspectRatio: fixed ?'])assert(exporter.includes(hook),hook);
assert(preview.includes('productLandGeoJson') && preview.includes('productCoastlineGeoJson'));
assert(preview.includes('historicalStormAt') && preview.includes('ctx.arc('));
function load(file,stubs={}){
  const js=ts.transpileModule(read(file),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  const cb=new Function('module','exports','require',js);
  cb(module,module.exports,n=>{
    for (const [key,value] of Object.entries(stubs))if(n.includes(key))return value;
    throw Error('unexpected dependency: '+n);
  });
  return module.exports;
}
const layout=load('src/utils/SynopticProductLayout.ts');
for(const style of ['default','hmon','hwrf'])for(const aspect of ['default','3:4','4:3','9:16','16:9']){
  const l=layout.synopticProductLayout(style,aspect);
  assert(l.mapAspect>0 && l.map.w>0 && l.map.h>0);
  assert(Math.abs(l.mapAspect-l.map.w/l.map.h)<1e-12);
  const b={lonMin:120,lonMax:130,latMin:15,latMax:25};
  const top=layout.synopticCropProject(b,l.map,25,120),bottom=layout.synopticCropProject(b,l.map,15,130);
  assert(Math.abs(top.x)<1e-9 && Math.abs(top.y)<1e-9);
  assert(Math.abs(bottom.x-l.map.w)<1e-9 && Math.abs(bottom.y-l.map.h)<1e-9);
}
const previewUtil=load('src/utils/SynopticRecordMapPreview.ts',{'SynopticProductLayout':layout,'NaturalEarthLoader':{productLandGeoJson:{features:[]},productCoastlineGeoJson:{features:[]}}});
const storm={history:[{simHour:0,lat:10,lon:110,vmax:20,pmin:1000,r7:{ne:40,se:40,sw:30,nw:30}},{simHour:10,lat:20,lon:120,vmax:40,pmin:950,r7:{ne:100,se:80,sw:60,nw:70}}]};
const state=previewUtil.historicalStormAt(storm,5);
assert.equal(state.lat,15);assert.equal(state.lon,115);assert.equal(state.vmax,30);assert.equal(state.pmin,975);assert.equal(state.r7.ne,70);
assert.equal(previewUtil.historicalStormAt(storm,0).lat,10);
assert.equal(previewUtil.historicalStormAt(storm,10).lat,20);
console.log('ROUND154 PASS: all three synoptic presets x five crop geometries, hidden contour numbers, mode routing, two-ended trim, fixed geobounds, archived replay interpolation');
// Execute the actual replay Canvas code twice to exercise both the cold geography
// pass and warm cached-geometry pass, including curved archived wind radii.
let drawCalls=0;
const c2d=()=>new Proxy({
  save(){},restore(){},beginPath(){},rect(){},clip(){},clearRect(){},fillRect(){},
  moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},arc(){},fillText(){},
  drawImage(){drawCalls++;},
  measureText(t){return {width:t.length*6}}
},{set(t,k,v){t[k]=v;return true}});
const createCanvas=()=>({width:0,height:0,ctx:c2d(),getContext(){return this.ctx}});
global.document={createElement:(tag)=>{assert.equal(tag,'canvas');return createCanvas();}};
const mapCanvas=createCanvas();
const b={lonMin:105,lonMax:135,latMin:5,latMax:40};
previewUtil.drawSynopticRecordMapPreview(mapCanvas,storm,b,4,620,540);
const firstDraws=drawCalls;
previewUtil.drawSynopticRecordMapPreview(mapCanvas,storm,b,7,620,540);
assert(drawCalls>firstDraws,'cached base-map image was not reused');
assert.equal(mapCanvas.width,620);assert.equal(mapCanvas.height,540);
console.log('ROUND154 PASS: archived replay Canvas renders and uses cached geography on subsequent range moves');
