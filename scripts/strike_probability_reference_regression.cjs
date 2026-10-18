/* Round184: regression for the coordinate and colour calibration against user 51119.png.
   Uses literal reference samples to avoid bundling the user's copyrighted screenshot. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');const mods={};
function load(file){if(mods[file])return mods[file];const location=path.join(root,file);
const source=ts.transpileModule(fs.readFileSync(location,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m=new Module(location);m.filename=location;m.paths=module.paths;m.require=(id)=>{
 if(id.includes('NaturalEarthLoader'))return {productLandGeoJson:null,productCoastlineGeoJson:null,productCountriesGeoJson:null,isProductCoastlineSeamSegment:()=>false};
 if(id.includes('TyphoonDisplayName'))return {getTyphoonOfficialNumber:()=> '2696'};
 if(id.endsWith('StrikeProbabilityField'))return load('src/utils/StrikeProbabilityField.ts');
 if(id.endsWith('EnsembleTrackTermination'))return load('src/utils/EnsembleTrackTermination.ts');
 if(id.endsWith('StrikeProbabilitySites'))return load('src/utils/StrikeProbabilitySites.ts');
 throw Error('Unexpected import '+id);
};m._compile(source,location);return mods[file]=m.exports;}
const p=load('src/utils/StrikeProbabilityProduct.ts');
const options={frameMode:'wnp',coastMinPct:5,horizonHours:168};
const bounds=p.strikeMapBounds([],{width:2030,height:1840,activeState:{lat:8.7,lon:161.2},strike:options});
const rectRatio=(2008-97)/(1763-101);
assert.ok(Math.abs((bounds.maxLon-bounds.minLon)/(bounds.maxLat-bounds.minLat)-rectRatio)<1e-10);
assert.ok(Math.abs(bounds.minLat-(-2.65))<.05 && Math.abs(bounds.maxLat-57.9)<.05,'reference y framing');
assert.ok(Math.abs(bounds.minLon-107.6)<.05 && Math.abs(bounds.maxLon-177.3)<.05,'reference x framing');
// Field and bar use the same calibrated colour lookup; these are pixel colours
// sampled from the right-hand vertical bar in the user-supplied 2048x1839 PNG.
const colorSamples=[
 [100,[255,152,252]], [95,[241,125,240]], [90,[227,103,223]],
 [80,[193,62,87]], [70,[220,98,56]], [60,[255,162,58]],
 [50,[255,222,62]], [45,[244,240,75]], [42,[184,198,135]],
 [35,[68,121,255]], [30,[78,144,255]], [20,[134,194,255]], [10,[222,236,255]]
];
for(const [percent,reference] of colorSamples){const rgb=p.strikeColor(percent);
 for(let c=0;c<3;c++)assert.ok(Math.abs(rgb[c]-reference[c])<=2,`bar ${percent}% channel ${c}: ${rgb[c]}`);
}
assert.equal(p.strikeColor(0)[3],0,'0% must be transparent');
assert.deepEqual(p.strikeColor(100).slice(0,3),[255,152,252]);
const ui=fs.readFileSync(path.join(root,'src/components/ForecastImageModal.tsx'),'utf8');
assert.match(ui,/西北太平洋（参考图范围）/);
const source=fs.readFileSync(path.join(root,'src/utils/StrikeProbabilityProduct.ts'),'utf8');
assert.match(source,/await colorCoasts\(/,'coastline rendering must yield and support cancellation');
assert.match(source,/await new Promise<void>\(resolve=>setTimeout\(resolve,0\)\)/);
console.log('strike_probability_reference_regression: calibrated palette, reference footprint, plate-carree, async coasts OK');
