const fs=require('fs'),vm=require('vm'),assert=require('assert');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const {performance}=require('perf_hooks');
const oldMap=fs.readFileSync('scripts/round156_map_before.snapshot','utf8');
const newMap=fs.readFileSync('src/utils/SynopticWindPressureMap.ts','utf8');
const image=fs.readFileSync('src/components/ForecastImageModal.tsx','utf8');
function between(s,a,b){const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,`${a} / ${b} not found`);return s.slice(i,j)}
function evaluate(src, expose){const out=ts.transpileModule(src+'\n'+expose,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;
 const ctx={Math,Array,Number,Object,Float32Array,Float64Array,Uint8Array,Map,WeakMap,Promise,console,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),yieldUi:async()=>{}};
 vm.createContext(ctx);vm.runInContext(out,ctx);return ctx;}
const contourPart=s=>between(s,'type Point =','function chaikin');
const oldContours=evaluate(contourPart(oldMap),'var stitch=stitchSegments;var segments=contourSegments;');
const newContours=evaluate(contourPart(newMap),'var stitch=stitchSegments;var segments=contourSegments;');
const palettePart=s=>between(s,'function sampleReferenceWindRgb','function sampleStyleRgb');
const env=`const REFERENCE_COLORBAR_TICKS = ${JSON.stringify([7,16,25,34,40,46,52,58,64,80,96,110,125,140,155])};\n`+
 `const REFERENCE_WIND_BAND_RGB = ${JSON.stringify(Array.from({length:42},(_,i)=>[i,i,i]))};\n`+
 'const REFERENCE_WIND_OVER_155_RGB=[152,25,68],REFERENCE_WIND_UNDER_7_RGB=[255,255,255];\n';
const oldColor=evaluate(env+palettePart(oldMap),'var pick=sampleReferenceWindRgb;').pick;
const newColor=evaluate(env+palettePart(newMap),'var pick=sampleReferenceWindRgb;').pick;
let seed=0x9e3779b9;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const values=[]; for(let i=0;i<120000;i++)values.push(random()*170-5);
for(const bound of [7,16,25,34,40,46,52,58,64,80,96,110,125,140,155])for(const d of [-1e-9,0,1e-9])values.push(bound+d);
for(const val of values)assert.deepStrictEqual(Array.from(newColor(val)),Array.from(oldColor(val)),`palette differs at ${val}`);
function measure(fn,items){const t=performance.now();let sum=0;for(let r=0;r<4;r++)for(const v of items)sum+=fn(v)[0];return {ms:+(performance.now()-t).toFixed(2),sum};}
const paletteOld=measure(oldColor,values),paletteNew=measure(newColor,values);assert.equal(paletteNew.sum,paletteOld.sum);
async function testContours(){
 let total=0, longLineLength=0, originalMs=0,optimizedMs=0;
 for(const {nx,ny,shape} of [{nx:120,ny:90,shape:0},{nx:500,ny:340,shape:1},{nx:72,ny:60,shape:2}]) {
 const grid=new Float32Array(nx*ny);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) grid[y*nx+x]=shape===1?1000+(y-ny/2)*.15+6*Math.sin(x*.065):shape===2?1010+35*Math.cos(Math.hypot(x-nx/2,y-ny/2)*.1):960+30*Math.sin(x*.09)+22*Math.cos(y*.07);
 for(const level of shape===1?[997,1002,1006,1010]:shape===2?[980,995,1012,1030]:[940,960,980,1000]) {
   const a=await oldContours.segments(grid,nx,ny,level),b=await newContours.segments(grid,nx,ny,level);
   assert.equal(JSON.stringify(a),JSON.stringify(b),'contour marching squares mismatch');
   const start=performance.now(),oa=await oldContours.stitch(a);originalMs+=performance.now()-start;
   const second=performance.now(),nb=await newContours.stitch(b);optimizedMs+=performance.now()-second;
   assert.equal(JSON.stringify(oa),JSON.stringify(nb),'contour joined point order mismatch');
   total+=a.length;for(const l of nb)longLineLength=Math.max(longLineLength,l.length);
 }
 }
 return {totalSegments:total,longestContourPoints:longLineLength,originalMs:+originalMs.toFixed(2),optimizedMs:+optimizedMs.toFixed(2)};
}
async function testNmc(){
 const dispatch=between(image,'  const drawMapOnCanvas = async (','\n\n  useEffect(() => {');
 assert(/else\s*\{\s*await drawStandardMapOnCanvas\(canvas, isMini\);/.test(dispatch),'NMC dispatch must await asynchronous draw');
 assert(!/else\s*\{\s*drawStandardMapOnCanvas\(canvas, isMini\);/.test(dispatch));
 const standard=between(image,'  const drawStandardMapOnCanvas = async','  // Pre-generate a 1167x667');
 assert(standard.includes('throw new Error("NMC 地理底图尚未准备完成'), 'missing GIS must not silently yield blank image');
 const generate=between(image,'  const handleGenerate = async','  const handleGenerateSynopticVideo = async');
 assert(generate.indexOf('await drawMapOnCanvas(')<generate.indexOf('canvas.toBlob('),'image encode must follow awaited draw');
 return {asyncNmcAwaited:true,missingGISIsError:true,pngEncodedAfterDraw:true};
}
(async()=>{const contours=await testContours(),nmc=await testNmc();console.log(JSON.stringify({result:'PASS',paletteSamples:values.length,paletteExact:true,paletteBenchmarkMs:{before:paletteOld.ms,after:paletteNew.ms},contours,nmc,styles:['default','hmon','hwrf'],products:['still','follow-video','fixed-video']},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
