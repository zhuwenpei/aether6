from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import base64
root=Path(__file__).resolve().parent.parent
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
index=(root/'src/index.css').read_text()
# Minimal Leaflet default icon theme, including its opaque divIcon, to test overrides.
leaflet='''.leaflet-div-icon{background:white;border:1px solid #666}.leaflet-marker-icon{position:absolute}.leaflet-container{overflow:hidden}.leaflet-pane{position:absolute;inset:0}.leaflet-popup-content-wrapper{background:white}'''
cyclone='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/cyclone-blue.png').read_bytes()).decode()
reference='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/reference-white.png').read_bytes()).decode()
lead='<svg xmlns="http://www.w3.org/2000/svg" width="98" height="19" viewBox="0 0 98 19"><text x="1" y="13" fill="#fff" stroke="#292929" stroke-width="1.25" paint-order="stroke" stroke-linejoin="round" font-family="Arial,sans-serif" font-size="10.5" font-weight="600">24h/15级</text></svg>'
html=f'''<!doctype html><html><head><meta charset="utf-8"><style>{leaflet}\n{index}\n{css}</style></head><body><div id="root"><div role="dialog" class="tn-viewport"><header class="tn-header"><button class="tn-back">←</button><div class="tn-provider-wrapper"><button class="tn-switch">切换<br>地图商</button></div><div class="tn-header-title">健茂台风路径</div><button type="button" id="tn-network-reference-icon" class="tn-reference-link"><img class="tn-reference-art" src="{reference}" width="40" height="40"></button></header><div class="tn-map"><div class="leaflet-container"><div class="leaflet-pane"><div class="leaflet-marker-icon tn-cyclone-icon leaflet-zoom-animated" style="left:160px;top:165px;width:31px;height:31px"><span class="tn-cyclone-center" style="--tn-intensity:#eb08dd"><img src="{cyclone}" class="tn-cyclone-spin"><span class="tn-cyclone-eye"></span></span></div><div class="leaflet-marker-icon tn-forecast-lead-icon tn-label-pin leaflet-zoom-animated" style="left:100px;top:125px;width:98px;height:19px">{lead}</div></div></div></div><div class="tn-ticker"><div>第6号 卡努 2023年7月31日02时</div><div>风级:15级 风速:48m/s 等级:强台风 气压:945hPa</div><div>经纬度:132.1°,21.1° 移向/移速:北偏西,16公里/小时</div></div></div></div></body></html>'''
report={}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--allow-file-access-from-files'])
 for width in (360,390,430):
  page=browser.new_page(viewport={'width':width,'height':750},device_scale_factor=1)
  page.set_content(html,wait_until='load')
  page.wait_for_timeout(120)
  assert page.eval_on_selector('.tn-reference-art','e=>e.naturalWidth')==256
  assert page.eval_on_selector('.tn-cyclone-spin','e=>e.naturalWidth')==256
  results=page.evaluate('''()=>{
   const sel=['.tn-reference-link','.tn-reference-art','.tn-cyclone-icon','.tn-cyclone-center','.tn-cyclone-spin','.tn-cyclone-eye','.tn-forecast-lead-icon','.tn-ticker'];
   return Object.fromEntries(sel.map(s=>{let x=document.querySelector(s);let c=getComputedStyle(x);return [s,{bg:c.backgroundColor,backgroundImage:c.backgroundImage,backdrop:c.backdropFilter,boxShadow:c.boxShadow,opacity:c.opacity,border:c.borderWidth,filter:c.filter,width:x.getBoundingClientRect().width}]}));
  }''')
  for sel,vals in results.items():
   if sel=='.tn-cyclone-eye': continue
   
   assert vals['bg']=='rgba(0, 0, 0, 0)',(width,sel,vals)

   
   assert vals['backdrop']=='none',(width,sel,vals)

   
   assert vals['boxShadow']=='none',(width,sel,vals)

   
   assert vals['backgroundImage']=='none',(width,sel,vals)

  metrics=page.evaluate('''() => { const t=document.querySelector('.tn-ticker'),l=document.querySelector('.tn-forecast-lead-icon'); const style=getComputedStyle(t);const lstyle=getComputedStyle(l);return {fontPx:parseFloat(style.fontSize),fontWeight:style.fontWeight,leadWidth:l.getBoundingClientRect().width,leadHeight:l.getBoundingClientRect().height,stroke:lstyle.webkitTextStrokeWidth,referenceTitle:document.querySelector('.tn-header-title').getBoundingClientRect().toJSON()}; }''')
  assert 10<=metrics['fontPx']<=14.4,(width,metrics)
  assert metrics['fontWeight']=='400',(width,metrics)
  assert metrics['leadWidth']==98 and metrics['leadHeight']==19,(width,metrics)
  report[str(width)]={'styles':results,'metrics':metrics}
  if width==390:
   outfile=root/'validation/round200_mobile_calibrated_chromium.png'
   page.screenshot(path=str(outfile))
  page.close()
 browser.close()
(root/'ROUND200_CSS_BROWSER_VALIDATION.json').write_text(json.dumps({'passed':3,'total':3,'sizes':report},ensure_ascii=False,indent=2))
print('R200 3/3 Chromium viewport computed-style PASS')
