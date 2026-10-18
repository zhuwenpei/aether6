"""Real Chromium NMC Canvas smoke test with real bundled fine coastline geometry.
Requires system Chromium and Python playwright. Tests async completion, nonwhite
content and abort, without relying on a network or simulator back end.
"""
import json, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
compiler='''const ts=require('typescript'),fs=require('fs');process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);'''
compiled=subprocess.check_output(['node','-e',compiler,str(root/'src/utils/NmcForecastProduct.ts')],text=True)
geo={n:json.load(open(root/'public/data'/f'{n}.geojson')) for n in ['product_coastline_fine_v5','product_countries_highdetail_v3']}
script=r'''async ({compiled,geo})=>{
 const deps={
   '../simulation/Engine':{getAgencyIntensity:(v)=>({value:Math.round(v)}),getWindForceCategory:()=>17},
   '../simulation/CmaOperationalClock':{getSimulationBeijingDate:(date,h)=>new Date(date.getTime()+h*3600000)},
   './NmcMapViewport':{
     buildNmcGeoFrame:()=>({minLon:105,maxLon:135,minLat:15,maxLat:35,minMercY:0,maxMercY:1}),
     nmcProjectPoint:(lat,lon,frame,map)=>({x:map.x+(lon-105)/30*map.w,y:map.y+(35-lat)/20*map.h})
   },
   './NmcOptionalGeography':{shouldDrawNmcRiver:()=>false},
   './ProductCoastlineDrawing':{strokeProductCoastlineRing(ctx,ring,proj){ctx.beginPath();ring.forEach((p,i)=>{let xy=proj(p[1],p[0]);i?ctx.lineTo(xy.x,xy.y):ctx.moveTo(xy.x,xy.y)});ctx.stroke();}}
 };
 const mod={exports:{}};
 new Function('module','exports','require',compiled)(mod,mod.exports,(name)=>{if(!deps[name])throw Error(name);return deps[name]});
 const {drawNmcForecastProductCooperative,drawNmcForecastProduct,hasNmcRenderedContent}=mod.exports;
 const forecast=Array.from({length:11},(_,i)=>({simHour:i*12,lat:17+i*.8,lon:133-i*1.1,vmax:25+i*1.1}));
 const makeOpts=(canvas,width)=>({canvas,width,typhoonName:'测试',typhoonNumber:'2601',ordinalNumber:1,issueDate:new Date('2026-10-14T12:00:00Z'),forecastHours:120,issueHour:0,startDate:new Date('2026-10-14T12:00:00Z'),current:forecast[0],forecast:forecast.slice(1),history:[],landGeoJson:geo.product_coastline_fine_v5,coastlineGeoJson:geo.product_coastline_fine_v5,countriesGeoJson:geo.product_countries_highdetail_v3,overlayNationalBorders:true,chinaLandTint:true,showInfoBoxes:true,showCenterBox:true,showForecastBox:true});
 const canvas=document.createElement('canvas');
 const progress=[];
 const start=performance.now();
 await drawNmcForecastProductCooperative(makeOpts(canvas,640),{onProgress:p=>progress.push(p)});
 const duration=Math.round(performance.now()-start);
 const ctx=canvas.getContext('2d');
 const pixel=(x,y)=>Array.from(ctx.getImageData(Math.floor(canvas.width*x/1295),Math.floor(canvas.height*y/1103),1,1).data).slice(0,3);
 const content=hasNmcRenderedContent(canvas);
 const ocean=pixel(1150,550);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 const cancelledCanvas=document.createElement('canvas');
 const controller=new AbortController();
 let cancellation=false;
 try{await drawNmcForecastProductCooperative(makeOpts(cancelledCanvas,640),{signal:controller.signal,onProgress:p=>controller.abort()});}
 catch(e){cancellation=e.name==='AbortError'}
 const high=document.createElement('canvas');
 await drawNmcForecastProductCooperative(makeOpts(high,1920));
 const highReady=hasNmcRenderedContent(high);
 const highBlob=await new Promise(resolve=>high.toBlob(resolve,'image/png'));
 high.width=1;high.height=1; // exporter releases GPU backing store
 const blank=document.createElement('canvas');blank.width=640;blank.height=545;
 return {duration,progressEvents:progress.length,completed:content,ocean,blobSize:blob?.size||0,cancelled:cancellation,highReady,highBlobSize:highBlob?.size||0,blankRejected:!hasNmcRenderedContent(blank)};
}'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page()
 page.set_default_timeout(60000)
 result=page.evaluate(script,{'compiled':compiled,'geo':geo})
 browser.close()
 assert result['completed'], f'NMC rendered content was blank: {result}'
 assert result['blobSize']>20000, f'PNG encoding empty: {result}'
 assert result['progressEvents']>5, f'not cooperative: {result}'
 assert result['cancelled'], f'not cancellable: {result}'
 assert result['highReady'] and result['highBlobSize']>50000, f'1920px product failed: {result}'
 assert result['blankRejected'], f'white/empty detection failed: {result}'
 print('ROUND182 NMC CHROMIUM CANVAS: PASS',result)
