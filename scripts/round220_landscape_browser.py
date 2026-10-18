"""Headless Chromium verification for R220 portrait/landscape reflow.
Uses real extracted standalone HTML plus layout-matched app controls; does not
claim to validate a production build (npm dependencies are not installed).
"""
import json,re,asyncio
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parent.parent
css='\n'.join((root/x).read_text() for x in ('src/index.css','src/components/TyphoonNetworkSimulator.css','src/components/NetworkEntrySettings.css'))
css=re.sub(r'@import\s+[^;]+;','',css)
base_html='<meta name="viewport" content="width=device-width,initial-scale=1">'
ui='''<div id="root"><div id="typhoon-app-container" class="aether-mobile-root" style="position:relative;width:100vw;height:100dvh;overflow:hidden"><div id="typhoon-gis-viewport" style="position:relative;width:100%;height:100%;background:#125b79"></div><aside class="aether-landscape-rail"><div class="aether-landscape-joystick-bay"><span>方向控制</span></div></aside><header class="aether-mobile-header"><div class="aether-mobile-brand"><b>WMC</b></div><div class="aether-mobile-header-actions"><button>产品</button><button>影响</button><button>设置</button><button>更多</button></div></header><section class="aether-mobile-statusrail"><span>12:00</span><strong>强台风</strong><span>48m/s</span><span>945hPa</span></section><nav class="aether-mobile-transport"><button>-</button><button>▶</button><button>■</button><button>⌃</button></nav><div id="joystick-wrapper" style="position:fixed;left:32px;bottom:96px"><div id="joystick-container" style="width:116px;height:116px;border-radius:100%;background:#234765"></div></div></div></div>'''
products='''<div id="root"><div class="aether-mobile-product-workstation"><header class="aether-mobile-product-header"><div><b>产品中心</b></div><div class="aether-mobile-product-header-actions"><button>关闭</button></div></header><aside class="aether-mobile-product-nav"><button class="icwc-product-tab">NMC</button><button class="icwc-product-tab">JMA</button><button class="icwc-product-tab">多模式集合</button></aside><div class="aether-mobile-product-settings"><div>原始设置</div></div></div></div>'''
network='''<div id="root"><div class="tn-viewport tn-stage-map"><header class="tn-header"><button class="tn-back">←</button><div class="tn-provider-wrapper"><button class="tn-switch">切换</button></div><div class="tn-header-title">健茂台风路径</div><button class="tn-header-action tn-share-action">分享</button><button class="tn-reference-link">参考</button></header><div class="tn-map"></div><div class="tn-ticker"><div>台风风速与气压</div></div><button class="tn-replay-button">↻</button></div></div>'''
prob='''<div id="root"><div class="tn-viewport tn-stage-probability"><header class="tn-header tn-header-reference"><button class="tn-back">←</button><div class="tn-header-title">热带气旋概率</div></header><main class="tn-probability-page"><div class="tn-probability-caption">模拟概率</div><p>模拟</p><figure><img width="2030" height="1840"><figcaption>概率</figcaption></figure><figure><img width="1200" height="900"><figcaption>集合</figcaption></figure></main></div></div>'''
source=(root/'src/utils/TyphoonNetworkStandaloneExport.ts').read_text()
standalone=source.split('const STANDALONE_TEMPLATE = String.raw`',1)[1].rsplit('`;',1)[0]
fix=lambda hour,lon,v:dict(lat=20,lon=lon,vmax=v,pmin=975,simHour=hour,speed=20,direction=270,r7={},r10={},r12={})
history=[fix(0,136,15),fix(3,132,20),fix(6,126,28),fix(9,120,52)]
payload=dict(typhoonName='R220预览',ordinal=9,startTimeISO='2026-10-18T00:00:00Z',nmcImage=None,art={},coastline={'features':[]},warningLines={'h24':[[105,0],[113,4.5],[119,11],[119,18],[127,22],[127,34]],'h48':[[105,0],[120,0],[132,15],[132,34]]},product={'history':history,'issue':history[-1],'forecasts':[]})
standalone=standalone.replace('__AETHER_EMBEDDED_PAYLOAD__',json.dumps(payload,ensure_ascii=False))
checks=0
async def main():
 global checks
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':844,'height':390})
  for w,h in ((844,390),(932,430),(568,320),(390,844)):
   landscape=w>h
   await page.set_viewport_size({'width':w,'height':h})
   for name,doc in (('main',ui),('products',products),('network',network),('prob',prob)):
    await page.set_content(base_html+'<style>'+css+'</style>'+doc,wait_until='domcontentloaded')
    await page.evaluate('(land)=>document.body.className="aether-mobile-ui"+(land?" aether-mobile-landscape":"")',landscape)
    bounds=await page.evaluate('''(name) => {const box=s=>{let e=document.querySelector(s);if(!e)return null;let b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,z:getComputedStyle(e).zIndex}};return {a:box(name==='main'?'.aether-landscape-rail':name==='products'?'.aether-mobile-product-nav':'.tn-header'),b:box(name==='main'?'#typhoon-gis-viewport':name==='products'?'.aether-mobile-product-settings':name==='network'?'.tn-map':'.tn-probability-page'),stick:box('#joystick-container'),fig1:box('figure:first-of-type'),fig2:box('figure:last-of-type'),scroll:document.documentElement.scrollWidth}}''',name)
    if landscape:
     assert abs(bounds['a']['x']+bounds['a']['w']-bounds['b']['x'])<=2, (name,w,h,bounds)
     assert bounds['b']['x']+bounds['b']['w'] <= w+2, (name,w,h,bounds)
     if name=='main':
      assert bounds['stick']['x']>=0 and bounds['stick']['x']+bounds['stick']['w']<=bounds['a']['w']+2,(name,w,h,bounds)
     if name=='prob':assert abs(bounds['fig1']['y']-bounds['fig2']['y'])<3,(name,w,h,bounds)
    elif name=='main':
     assert abs(bounds['b']['x'])<=2 and abs(bounds['b']['w']-w)<=2,(name,w,h,bounds)
    checks+=1
  await page.close()
  for w,h in ((844,390),(568,320),(390,844)):
   page=await browser.new_page(viewport={'width':w,'height':h})
   errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content(standalone,wait_until='domcontentloaded')
   box=await page.evaluate('''()=>{const bounds=e=>{const b=document.querySelector(e).getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height}};return {head:bounds('header'),map:bounds('#map'),prob:bounds('#prob'),overflow:document.documentElement.scrollWidth>innerWidth}}''')
   assert not errors,errors
   assert not box['overflow'],(w,h,box)
   if w>h:
    assert abs(box['head']['w']-box['map']['x'])<2,(w,h,box)
    assert abs(box['map']['x']+box['map']['w']-w)<2,(w,h,box)
    await page.locator('#reference').click()
    await page.locator('#openprob').click()
    assert await page.locator('#prob').evaluate('(e)=>getComputedStyle(e).display')=='grid'
    await page.locator('#back').click()
    assert await page.locator('#ref').evaluate('(e)=>getComputedStyle(e).display')=='block'
   else:assert abs(box['map']['w']-w)<2,box
   checks+=1
   await page.close()
  await browser.close()
 print('R220 browser orientation/layout/offline checks:',checks,'PASS')
asyncio.run(main())
