#!/usr/bin/env python3
"""R201 mobile header: use application CSS plus the real button markup and PNG."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, json
root=Path(__file__).resolve().parent.parent
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
global_css=(root/'src/index.css').read_text()
reference='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/reference-white.png').read_bytes()).decode()
html=f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>{global_css}\n{css}</style></head><body><div id="root"><div role="dialog" class="tn-viewport"><header class="tn-header"><button type="button" id="tn-network-back" class="tn-back" aria-label="返回"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button><div class="tn-provider-wrapper"><button id="tn-network-switch" class="tn-switch" type="button"><span class="tn-switch-first">切换</span><span class="tn-switch-second">地图商</span></button></div><div class="tn-header-title">健茂台风路径</div><button id="tn-network-reference-icon" class="tn-reference-link" type="button"><img class="tn-reference-art" src="{reference}" width="40" height="40"/></button></header></div></div></body></html>'''
results={}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for width in (360,390,430,800):
  page=browser.new_page(viewport={'width':width,'height':720},device_scale_factor=1)
  page.set_content(html,wait_until='load')
  page.wait_for_timeout(50)
  for state in ('normal','hover','focus'):
   if state=='hover':page.locator('#tn-network-switch').hover()
   if state=='focus':page.locator('#tn-network-switch').focus()
   d=page.evaluate('''()=>{
     const vals=(selector)=>{const x=document.querySelector(selector),s=getComputedStyle(x),r=x.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top,bg:s.backgroundColor,bgImage:s.backgroundImage,border:s.border, borderColor:s.borderTopColor,borderWidth:s.borderTopWidth,radius:s.borderRadius,shadow:s.boxShadow,backdrop:s.backdropFilter,filter:s.filter,font:s.fontSize,weight:s.fontWeight};};
     return {back:vals('#tn-network-back'),switch:vals('#tn-network-switch'),reference:vals('#tn-network-reference-icon'),first:vals('.tn-switch-first'),second:vals('.tn-switch-second'),title:vals('.tn-header-title')};
   }''')
   assert abs(d['switch']['width']-d['switch']['height'])<.1,(width,state,d['switch'])
   assert d['switch']['bg']=='rgba(0, 0, 0, 0)',(width,state,d['switch'])
   assert d['back']['bg']=='rgba(0, 0, 0, 0)',(width,state,d['back'])
   assert d['reference']['bg']=='rgba(0, 0, 0, 0)',(width,state,d['reference'])
   for key in ('back','switch'):
    assert d[key]['borderColor']=='rgb(255, 255, 255)',(width,state,key,d[key])
    assert float(d[key]['borderWidth'].rstrip('px'))>=1,(width,state,key,d[key])
   assert d['reference']['borderWidth']=='0px',(width,state,d['reference'])
   for key in ('back','switch','reference'):
    assert d[key]['bgImage']=='none' and d[key]['shadow']=='none' and d[key]['backdrop']=='none',(width,state,key,d[key])
   assert float(d['first']['font'].rstrip('px'))>float(d['second']['font'].rstrip('px')),(width,state,d)
   assert d['first']['bg']=='rgba(0, 0, 0, 0)' and d['second']['bg']=='rgba(0, 0, 0, 0)' 
   results[f'{width}_{state}']=d
  page.locator('#tn-network-switch').blur()
  if width==390:page.screenshot(path=str(root/'validation/round201_header_calibration_chromium.png'))
  page.close()
 browser.close()
(root/'ROUND201_HEADER_BROWSER_VALIDATION.json').write_text(json.dumps({'total':len(results),'passed':len(results),'conditions':results},indent=2,ensure_ascii=False))
print(f'R201 mobile/desktop header browser PASS {len(results)}/{len(results)}')
