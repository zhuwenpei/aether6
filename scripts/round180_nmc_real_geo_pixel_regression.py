import json,subprocess,time
from pathlib import Path
from playwright.sync_api import sync_playwright
r=str(Path(__file__).resolve().parents[1])+'/'
compiler=r'''const fs=require('fs'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nmodule.exports.__draw=drawBaseMap;');'''
compiled=subprocess.check_output(['node','-e',compiler,r+'src/utils/NmcForecastProduct.ts'],text=True)
geo={n:json.load(open(r+'public/data/'+n+'.geojson')) for n in ['product_land_wide_v3','product_coastline_fine_v5','product_countries_highdetail_v3']}
script=r'''({compiled,geo})=>{
  const deps={'../simulation/Engine':{getAgencyIntensity:v=>({value:v}),getWindForceCategory:()=>12},'../simulation/CmaOperationalClock':{getSimulationBeijingDate:()=>new Date()},'./NmcMapViewport':{buildNmcGeoFrame:()=>({}),nmcProjectPoint:()=>({x:0,y:0})},'./NmcOptionalGeography':{shouldDrawNmcRiver:()=>true},'./ProductCoastlineDrawing':{strokeProductCoastlineRing(c,r,p){c.beginPath();for(let i=0;i<r.length;i++){let q=p(r[i][1],r[i][0]);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);}c.stroke();}}};
  const m={exports:{}};new Function('module','exports','require',compiled)(m,m.exports,key=>{if(!deps[key])throw Error(key);return deps[key]});
  const canvas=document.createElement('canvas');canvas.width=1295;canvas.height=1103;
  const ctx=canvas.getContext('2d');
  const frame={minLon:105,maxLon:135,minLat:15,maxLat:35};
  const project=(lat,lon)=>({x:22+(lon-105)/30*1248,y:102+(35-lat)/20*819});
  const opts={landGeoJson:geo.product_land_wide_v3,coastlineGeoJson:geo.product_coastline_fine_v5,countriesGeoJson:geo.product_countries_highdetail_v3,chinaLandTint:true,overlayNationalBorders:true,overlayChinaProvinces:false,overlayRivers:false};
  let time=performance.now();m.exports.__draw(ctx,opts,frame,project);let ms=Math.round(performance.now()-time);
  const sample=(lat,lon)=>{let p=project(lat,lon);return Array.from(ctx.getImageData(p.x,p.y,1,1).data).slice(0,3)};
  return {ms,oversea:[sample(20.8,110.5),sample(22.6,113.7),sample(22.5,114.4)],island:sample(20.05,110.33),inner:sample(26.5,115.8)};
}'''
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page()
 t=time.time();z=page.evaluate(script,{'compiled':compiled,'geo':geo});b.close()
 assert z['oversea']==[[223,240,250]]*3, f'coastal ocean was filled: {z}'
 assert z['inner']==[255,235,207], f'overlapping Chinese land plates erased mainland tint: {z}'
 print('ROUND180_REAL_GEO_PIXEL: PASS',z,'totalSeconds',round(time.time()-t,2))
