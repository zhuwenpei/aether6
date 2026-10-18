"""NMC Round184 style + Round185 safety: actual Chromium optional-overlay rendering.
Each overlay independently + together, forced timeout fallback, synthetic tint masking.
"""
from pathlib import Path
import subprocess,json,time,sys
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
compiler="const ts=require('typescript'),fs=require('fs');process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)"
compiled=subprocess.check_output(['node','-e',compiler,str(root/'src/utils/NmcForecastProduct.ts')],text=True)
geo={n:json.load(open(root/'public/data'/f'{n}.geojson')) for n in ['product_coastline_fine_v5','product_countries_highdetail_v3','nmc_rivers']}
script=r'''async ({compiled,geo,mode})=>{
 const deps={
 '../simulation/Engine':{getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:()=>17},
 '../simulation/CmaOperationalClock':{getSimulationBeijingDate:(d,h)=>new Date(d.getTime()+h*3600000)},
 './NmcMapViewport':{
   buildNmcGeoFrame:()=>({minLon:105,maxLon:135,minLat:15,maxLat:35,minMercY:0,maxMercY:1}),
   nmcProjectPoint:(lat,lon,f,map)=>({x:map.x+(lon-105)/30*map.w,y:map.y+(35-lat)/20*map.h})},
 './NmcOptionalGeography':{shouldDrawNmcRiver:()=>true},
 './ProductCoastlineDrawing':{strokeProductCoastlineRing(ctx,ring,pr){ctx.beginPath();let open=false;for(let i=0;i<ring.length;i++){const v=ring[i];if(!Array.isArray(v)||!Number.isFinite(v[0])||!Number.isFinite(v[1]))continue;const p=pr(v[1],v[0]);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;if(!open){ctx.moveTo(p.x,p.y);open=true}else ctx.lineTo(p.x,p.y)}ctx.stroke();}}
 };
 const mod={exports:{}};
 new Function('module','exports','require',compiled+'\nmodule.exports.__drawBaseMap=drawBaseMap;')(mod,mod.exports,id=>deps[id]);
 const {drawNmcForecastProductCooperative,hasNmcRenderedContent}=mod.exports;
 const trajectory=Array.from({length:11},(_,i)=>({simHour:i*12,lat:17+i*.8,lon:133-i*1.1,vmax:25+i*1.1}));
 const province={type:'FeatureCollection',features:[{type:'Feature',bbox:[105,16,126,34],geometry:{type:'LineString',coordinates:[[112,23],[113,24],[114,24]]}}]};
 const base=(canvas)=>({canvas,width:640,typhoonName:'测试',typhoonNumber:'2601',ordinalNumber:1,
   issueDate:new Date('2026-10-14T12:00:00Z'),startDate:new Date('2026-10-14T12:00:00Z'),
   forecastHours:120,issueHour:0,current:trajectory[0],forecast:trajectory.slice(1),history:[],
   coastlineGeoJson:geo.product_coastline_fine_v5,landGeoJson:geo.product_coastline_fine_v5,
   countriesGeoJson:geo.product_countries_highdetail_v3,provinceGeoJson:province,riversGeoJson:geo.nmc_rivers,
   overlayNationalBorders:false,chinaLandTint:false,overlayChinaProvinces:false,overlayRivers:false,
   showInfoBoxes:true,showCenterBox:true,showForecastBox:true});
 const cases={china:{chinaLandTint:true},borders:{overlayNationalBorders:true},
    provinces:{overlayChinaProvinces:true},rivers:{overlayRivers:true},
    all:{chinaLandTint:true,overlayNationalBorders:true,overlayChinaProvinces:true,overlayRivers:true}};
 const results={};
 if(mode==='overlays') for(const [name,active] of Object.entries(cases)){
   const canvas=document.createElement('canvas');const warn=[];
   const started=performance.now();
   await drawNmcForecastProductCooperative({...base(canvas),...active},{onWarning:m=>warn.push(m),maxDurationMs:20000});
   results[name]={durationMs:Math.round(performance.now()-started),valid:hasNmcRenderedContent(canvas),warnings:warn,
     peakMemoryApprox:performance.memory?.usedJSHeapSize??null};
   canvas.width=0;canvas.height=0;
 }
 if(mode==='overlays')return results;
 if(mode==='fallback'){
 const reset=document.createElement('canvas'),fallback=[];
 await drawNmcForecastProductCooperative({...base(reset),chinaLandTint:true,overlayNationalBorders:true},
   {maxDurationMs:1,onWarning:m=>fallback.push(m)});
 results.fallback={valid:hasNmcRenderedContent(reset),warnings:fallback};reset.width=0;reset.height=0;return results;}

 // Verify exactly the Round184 sea, white land and warm tint on a minimal plate.
 const mk=(coords,name='')=>({type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{ADMIN:name}});
 const fine={features:[mk([[110,18],[124,18],[124,31],[110,31],[110,18]])]};
 const admin={features:[mk([[105,15],[130,15],[130,35],[105,35],[105,15]],'China')]};
 const cv=document.createElement('canvas');cv.width=1295;cv.height=1103;
 const c=cv.getContext('2d');
 mod.exports.__drawBaseMap(c,{width:1295,landGeoJson:fine,coastlineGeoJson:fine,countriesGeoJson:admin,
    chinaLandTint:true,overlayNationalBorders:false,overlayRivers:false,overlayChinaProvinces:false},
    {minLon:105,maxLon:135,minLat:15,maxLat:35},deps['./NmcMapViewport'].nmcProjectPoint.bind(null));
 // Build the direct projection expected by the rasterizer.
 // Above uses an incompatible positional binding; this gets checked on the next call below.
 return results;
}'''
# Fix positional projection and pixel sample in script before invoking
script=script.replace("deps['./NmcMapViewport'].nmcProjectPoint.bind(null));\n // Build the direct projection expected by the rasterizer.\n // Above uses an incompatible positional binding; this gets checked on the next call below.\n return results;", """(lat,lon)=>({x:22+(lon-105)/30*1248,y:102+(35-lat)/20*819}));
 const sample=(lat,lon)=>{const x=Math.round(22+(lon-105)/30*1248),y=Math.round(102+(35-lat)/20*819);
   return Array.from(c.getImageData(x,y,1,1).data).slice(0,3)};
 results.pixels={tint:sample(24,116),water:sample(24,128)};
 return results;""")
mode=sys.argv[1] if len(sys.argv)>1 else 'overlays'
assert mode in ('overlays','fallback','pixels')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page();page.set_default_timeout(90000)
 started=time.monotonic()
 result=page.evaluate(script,{'compiled':compiled,'geo':geo,'mode':mode})
 browser.close()
 if mode=='overlays':
  for name in ['china','borders','provinces','rivers','all']:
   assert result[name]['valid'],f'{name} returned blank image: {result[name]}'
 elif mode=='fallback':
  assert result['fallback']['valid'],result['fallback']
  assert any('关闭叠加层' in w for w in result['fallback']['warnings']),result['fallback']
 else:
  assert result['pixels']['tint']==[255,235,207],result['pixels']
  assert result['pixels']['water']==[223,240,250],result['pixels']
 json_path=root/'validation'/('NMC_SAFETY_'+mode.upper()+'_BROWSER_METRICS.json')
 json_path.parent.mkdir(exist_ok=True)
 json_path.write_text(json.dumps({'results':result,'wallSec':round(time.monotonic()-started,2)},ensure_ascii=False,indent=2))
 print('NMC ROLLBACK SAFE OVERLAYS CHROMIUM',mode.upper()+': PASS',json.dumps(result,ensure_ascii=False))
