#!/usr/bin/env python3
"""Isolated Chromium interaction smoke: tests SVG click bounds and icon playback visibility.
Does not claim complete React/Leaflet mobile integration verification.
"""
from pathlib import Path
import base64, json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
asset=root/'public/network-icons/cyclone-blue.png'
data=base64.b64encode(asset.read_bytes()).decode()
markup='''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;background:#a1d5ef;color:#123;font-family:Arial}svg{width:100vw;height:90vh;touch-action:none}
#cyclone{transform-box:fill-box;transform-origin:center;animation:spin 2s linear infinite}
@keyframes spin{to{transform:rotate(-360deg)}}
</style></head><body><svg id="layer" viewBox="0 0 390 650" xmlns="http://www.w3.org/2000/svg">
<path d="M0 270 L390 310" stroke="#00c8aa" stroke-width="2" fill="none"/>
<circle id="hit" cx="160" cy="270" r="7" fill="#ffffff" fill-opacity=".001"/>
<circle id="dot" cx="160" cy="270" r="1.86" fill="#8428de" stroke="white" stroke-width=".28" stroke-opacity=".34"/>
<image id="cyclone" x="183" y="258" width="24" height="24" href="data:image/png;base64,__ASSET__"/>
<circle id="eye" cx="195" cy="270" r="4.76" fill="#8320d6"/>
</svg><script>
window.events=[];document.getElementById('hit').addEventListener('click',()=>events.push('small agency'));
const cyclone=document.getElementById('cyclone'),eye=document.getElementById('eye');
window.toggleReplay=function(playing){cyclone.setAttribute('visibility',playing?'hidden':'visible');eye.setAttribute('r',playing?'4.76':'3.5')};
toggleReplay(true);
</script></body></html>'''.replace('__ASSET__',data)
outputs=[]
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (360,390,430):
  page=browser.new_page(viewport={'width':width,'height':720},device_scale_factor=1,has_touch=True,is_mobile=True)
  page.set_content(markup)
  # The viewBox scales with viewport; touch point is 6 CSS px from the dot center.
  bounds=page.locator('#hit').bounding_box()
  assert bounds, f'circle not rendered at {width}px'
  x=bounds['x']+bounds['width']/2
  y=bounds['y']+bounds['height']/2
  dx=bounds['width']/2*(6/7)
  page.mouse.click(x+dx,y)
  assert page.evaluate('events.length')==1,(width,page.evaluate('events'))
  assert page.locator('#cyclone').get_attribute('visibility')=='hidden'
  assert page.locator('#eye').get_attribute('r')=='4.76'
  page.evaluate('toggleReplay(false)')
  assert page.locator('#cyclone').get_attribute('visibility')=='visible'
  assert page.locator('#eye').get_attribute('r')=='3.5'
  if width==390:page.screenshot(path=str(root/'validation/round207_touch_playback_svg_chromium.png'))
  outputs.append({'viewport_width':width,'hit_outside_visible_dot':True,'playback_icon_hidden':True,'restored_after_interrupt':True})
  page.close()
 browser.close()
result={'kind':'isolated Chromium SVG interaction, not complete Leaflet', 'cases':outputs}
(root/'validation/round207_svg_browser_result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('PASS',json.dumps(result,ensure_ascii=False))
