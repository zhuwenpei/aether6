"""Chromium CSS fixture: supplied alpha icons, centered colored eye & mobile header.
Not an end-to-end build of the app or SDK.
"""
from pathlib import Path
import json,base64
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
logo='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/reference-white.png').read_bytes()).decode()
cyc='data:image/png;base64,'+base64.b64encode((root/'public/network-icons/cyclone-blue.png').read_bytes()).decode()
html='''<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"><section class="tn-viewport"><header class="tn-header"><button class="tn-back"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button><div class="tn-provider-wrapper"><button class="tn-switch">切换<br>地图商</button></div><div class="tn-header-title">健茂台风路径</div><button class="tn-reference-link"><img class="tn-reference-art" src="__LOGO__"></button></header><div class="tn-map" style="position:absolute;width:100%;height:100%;background:#a1d2fd!important"><div class="tn-cyclone-icon" style="position:absolute;left:calc(50% - 15.5px);top:calc(50% - 15.5px)"><span class="tn-cyclone-center" style="--tn-intensity:#8320d6"><img class="tn-cyclone-spin" src="__CYCLONE__"><span class="tn-cyclone-eye"></span></span></div></div></section></div></body></html>'''.replace('__LOGO__',logo).replace('__CYCLONE__',cyc)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);results=[]
 for width in (360,390,430):
  page=b.new_page(viewport={'width':width,'height':840},device_scale_factor=1)
  page.set_content(html);page.add_style_tag(content=css)
  values=page.evaluate('''() => {const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,cx:(r.left+r.right)/2}};return {ref:rect('.tn-reference-art'),title:rect('.tn-header-title'),eye:rect('.tn-cyclone-eye'),spin:rect('.tn-cyclone-spin'),map:rect('.tn-map'),duration:getComputedStyle(document.querySelector('.tn-cyclone-spin')).animationDuration,direction:getComputedStyle(document.querySelector('.tn-cyclone-spin')).animationName}}''')
  assert values['duration']=='2s',values
  assert values['ref']['width']>=38,values
  assert abs(values['title']['cx']-width/2)<1.2,values
  assert values['title']['right']<=values['ref']['left']+12,values
  assert abs(values['eye']['cx']-values['spin']['cx'])<1,values
  if width==390:page.screenshot(path=str(root/'validation/round197_icon_header_chromium.png'))
  results.append({'width':width,'status':'PASS','computed':values});page.close()
 b.close()
out={'status':'PASS','checks':results,'limitations':'CSS fixture only: external map SDKs not loaded'}
(root/'ROUND197_CHROMIUM_VALIDATION.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps({'status':'PASS','widths':[x['width'] for x in results]},ensure_ascii=False))
