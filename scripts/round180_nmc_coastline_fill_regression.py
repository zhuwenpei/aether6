#!/usr/bin/env python3
"""Round180 browser-pixel regression: fine coastline, not admin geometry, is the sea/land mask.
Only Chromium/Playwright and the globally available TypeScript compiler are needed.
"""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
modal = (ROOT / 'src/components/ForecastImageModal.tsx').read_text()
renderer = (ROOT / 'src/utils/NmcForecastProduct.ts').read_text()
assert 'productCoastlineGeoJson as nmcFineCoastlineGeoJson' in modal
assert 'coastlineGeoJson: nmcFineCoastlineGeoJson' in modal
assert "ctx.clip('evenodd')" in renderer
assert "o.coastlineGeoJson?.features?.length" in renderer

compiled = subprocess.check_output(['node', '-e', r'''
const fs=require('fs'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const src=fs.readFileSync(process.argv[1],'utf8');
process.stdout.write(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nmodule.exports.__round180DrawBaseMap = drawBaseMap;\n');
''', str(ROOT / 'src/utils/NmcForecastProduct.ts')], text=True)

js = r'''({compiled}) => {
  const modules={
    '../simulation/Engine': {getAgencyIntensity:v=>({value:Math.round(v)}),getWindForceCategory:()=>12},
    '../simulation/CmaOperationalClock': {getSimulationBeijingDate:()=>new Date()},
    './NmcMapViewport': {buildNmcGeoFrame:()=>({}),nmcProjectPoint:()=>({x:0,y:0})},
    './NmcOptionalGeography': {shouldDrawNmcRiver:()=>true},
    './ProductCoastlineDrawing': {strokeProductCoastlineRing(ctx,ring,project) {
      ctx.beginPath();let started=false;
      for (const pt of ring) {
        const p=project(pt[1],pt[0]);if(!started)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        started=true;
      }
      if(started)ctx.stroke();
    }}
  };
  const m={exports:{}};
  new Function('module','exports','require',compiled)(m,m.exports,(key)=>{if(!modules[key])throw Error(key);return modules[key]});
  const draw=m.exports.__round180DrawBaseMap;
  const polygon=(ring,ADMIN='')=>({type:'Feature',properties:{ADMIN},geometry:{type:'Polygon',coordinates:[ring]}});
  const rectangle=(left,bottom,right,top)=>[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]];
  // The hi-res land has a genuine open-water bay with a separate nearshore island.
  const mainland=[[110,20],[117,20],[117,23],[113,23],[113,26],[117,26],[117,30],[110,30],[110,20]];
  const island=rectangle(116.5,24,118,25);
  const fine={features:[polygon(mainland),polygon(island)]};
  // Legacy/admin polygons simplify the bay into a rectangular coastal plate.
  const coarse={features:[polygon(rectangle(109,19,119,31),'China')]};
  const admin={features:[polygon(rectangle(109,19,119,31),'China')]};
  const frame={minLon:108,maxLon:120,minLat:18,maxLat:32};
  const project=(lat,lon)=>({x:22+(lon-108)/12*1248,y:102+(32-lat)/14*819});
  function render(chinaTint, borders, fineData=true) {
    const canvas=document.createElement('canvas');canvas.width=1295;canvas.height=1103;
    const ctx=canvas.getContext('2d');
    draw(ctx,{landGeoJson:coarse,coastlineGeoJson:fineData?fine:undefined,countriesGeoJson:admin,chinaLandTint:chinaTint,overlayNationalBorders:borders,overlayChinaProvinces:false,overlayRivers:false},frame,project);
    const sample=(lat,lon)=>{
      const p=project(lat,lon),v=ctx.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data;
      return Array.from(v.slice(0,3));
    };
    return {bay:sample(24.4,115.6),land:sample(22,111),island:sample(24.5,117.5),offshore:sample(27,119.5)};
  }
  return {tint:render(true,false),noTint:render(false,false),withBorders:render(true,true),legacy:render(true,false,false)};
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    result=page.evaluate(js,{'compiled':compiled})
    browser.close()

COLORS={'sea':[223,240,250],'land':[255,253,249],'china':[255,235,207]}
for mode in ('tint','noTint','withBorders'):
    assert result[mode]['bay']==COLORS['sea'], f'{mode}: the bay has been wrongly filled: {result[mode]}'
    assert result[mode]['offshore']==COLORS['sea'], f'{mode}: offshore incorrectly painted'
    assert result[mode]['land']==COLORS['china' if mode!='noTint' else 'land'], f'{mode}: mainland color mismatch'
    assert result[mode]['island']==COLORS['china' if mode!='noTint' else 'land'], f'{mode}: island lost'
assert result['legacy']['bay'] != COLORS['sea'], 'regression fixture must actually distinguish the bug'
print('ROUND180_NMC_COASTLINE_FILL: PASS')
print(json.dumps(result,ensure_ascii=False))
