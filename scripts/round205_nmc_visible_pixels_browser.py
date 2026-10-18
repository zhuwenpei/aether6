"""R205: genuine canvas pixel difference when optional geography is enabled.
Must verify drawn lines rather than merely a nonempty chart.
"""
from pathlib import Path
import subprocess,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
transpile="const ts=require('typescript'),fs=require('fs');process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)"
compiled=subprocess.check_output(['node','-e',transpile,str(root/'src/utils/NmcForecastProduct.ts')],text=True)
geo=json.load(open(root/'public/data/nmc_rivers.geojson'))
script=r'''({compiled,rivers})=>{
 const proj=(lat,lon)=>({x:22+(lon-105)/35*1248,y:102+(40-lat)/30*819});
 const deps={
 '../simulation/Engine':{getAgencyIntensity:v=>({value:v}),getWindForceCategory:()=>12},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:(d,h)=>new Date(d.getTime()+h*3600000)},
 './NmcMapViewport':{},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>true},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing(){}}
 };
 const m={exports:{}};
 new Function('module','exports','require',compiled+'\nmodule.exports.__base=drawBaseMap;')(m,m.exports,id=>deps[id]);
 const province={type:'FeatureCollection',features:[{type:'Feature',bbox:[116,23,124,34],geometry:{type:'LineString',coordinates:[[116,23],[118,29],[124,34]]}}]};
 const options={width:1295,landGeoJson:{features:[]},coastlineGeoJson:{features:[]},countriesGeoJson:{features:[]},provinceGeoJson:province,riversGeoJson:rivers,
   overlayNationalBorders:false,chinaLandTint:false,overlayChinaProvinces:false,overlayRivers:false};
 const render=(changes)=>{
  const canvas=document.createElement('canvas');canvas.width=1295;canvas.height=1103;
  m.exports.__base(canvas.getContext('2d'),{...options,...changes},{minLon:105,maxLon:140,minLat:10,maxLat:40},proj);
  return canvas.getContext('2d').getImageData(0,0,1295,1103).data;
 };
 const base=render({}),prov=render({overlayChinaProvinces:true}),river=render({overlayRivers:true});
 const diff=(b)=>{let n=0;for(let y=130;y<900;y+=1)for(let x=28;x<1250;x+=1){const i=(y*1295+x)*4;if(base[i]!==b[i]||base[i+1]!==b[i+1]||base[i+2]!==b[i+2])n++;}return n;};
 return {provinceChangedPixels:diff(prov),riverChangedPixels:diff(river)};
}'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page()
 result=page.evaluate(script,{'compiled':compiled,'rivers':geo})
 b.close()
 print('R205 CHROMIUM OPTIONAL VECTOR PIXEL DIFF',result)
 assert result['provinceChangedPixels']>25,result
 assert result['riverChangedPixels']>150,result
 (root/'validation').mkdir(exist_ok=True)
 (root/'validation'/'round205_nmc_vector_pixel_check.json').write_text(json.dumps(result,indent=2))
 print('R205 NMC PROVINCE+RIVER PIXELS: PASS')
