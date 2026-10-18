#!/usr/bin/env python3
"""Isolated, computed CSS verification with actual global CSS and title header."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64,json
root=Path(__file__).resolve().parent.parent
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
global_css=(root/'src/index.css').read_text()
ref='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/reference-white.png').read_bytes()).decode()
html=f'''<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta charset="utf-8"/><style>{global_css}\n{css}</style></head><body><div id="root"><section class="tn-viewport"><header class="tn-header"><button id="tn-network-back" class="tn-back" aria-label="返回"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button><div class="tn-header-title">健茂台风路径</div><button id="tn-network-reference-icon" class="tn-reference-link" aria-label="台风参考"><img class="tn-reference-art" src="{ref}"/></button></header><div class="tn-map" style="background:#a1d1f5"></div><a class="tn-osm-credit" href="https://www.amap.com/">© 高德地图</a></section></div></body></html>'''
result={}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in (360,390,430,800):
  page=browser.new_page(viewport={'width':width,'height':760},device_scale_factor=1)
  page.set_content(html,wait_until='load')
  for state in ('normal','hover','focus'):
   if state=='hover':page.locator('#tn-network-back').hover()
   if state=='focus':page.locator('#tn-network-back').focus()
   d=page.evaluate('''()=>{const info=selector=>{const x=document.querySelector(selector),a=x.getBoundingClientRect(),s=getComputedStyle(x);return {x:a.x,y:a.y,w:a.width,h:a.height,border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow,opacity:s.opacity,color:s.color,font:s.fontSize}}; return {back:info('#tn-network-back'),title:info('.tn-header-title'),reference:info('#tn-network-reference-icon'),credit:info('.tn-osm-credit')}}''')
   assert d['back']['border']=='0px',(width,state,d['back'])
   assert d['back']['bg']=='rgba(0, 0, 0, 0)',(width,state,d['back'])
   assert d['reference']['bg']=='rgba(0, 0, 0, 0)',(width,state,d['reference'])
   assert d['credit']['y']>690,(width,state,d['credit'])
   assert float(d['credit']['opacity'])<.65
   assert abs((d['title']['x']+d['title']['w']/2)-(width/2))<4,(width,state,d['title'])
   result[f'{width}_{state}']=d
  if width==390:
   page.locator('#tn-network-back').blur()
   page.screenshot(path=str(root/'validation/round206_amap_single_source_chromium.png'))
  page.close()
 browser.close()
(root/'ROUND206_BROWSER_TEST_RESULTS.json').write_text(json.dumps({'checks':len(result),'passed':len(result),'details':result},ensure_ascii=False,indent=2))
print(f'R206 GAODE SINGLE-SOURCE PHONE CSS {len(result)}/{len(result)} PASS')
