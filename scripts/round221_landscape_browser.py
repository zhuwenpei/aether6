from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re,sys
base=Path(__file__).resolve().parents[1]
css='\n'.join((base/x).read_text() for x in ['src/index.css','src/components/TyphoonNetworkSimulator.css','src/components/NetworkEntrySettings.css'])
css=re.sub(r'@import\s+[^;]+;', '', css)
img='data:image/svg+xml,'+'%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%22900%22%3E%3Crect%20width%3D%221200%22%20height%3D%22900%22%20fill%3D%22%23c1e4f9%22%2F%3E%3C/svg%3E'
main='<div id="root"><div id="typhoon-app-container" style="position:relative;width:100vw;height:100dvh;overflow:hidden"><div id="typhoon-gis-viewport" style="position:absolute;inset:0;background:#407b93"></div><aside class="aether-landscape-rail"><div class="aether-landscape-joystick-bay"><span>方向控制</span></div></aside><header class="aether-mobile-header"><div class="aether-mobile-brand"><b>AETHER</b></div><div class="aether-mobile-header-actions">'+''.join('<button>◯</button>' for _ in range(4))+'</div></header><section class="aether-mobile-statusrail"><span>12:00</span><i></i><span>发展中</span><i></i><strong>强台风</strong><span>48 m/s</span><i></i><span>945 hPa</span><i></i><span>310° · 13 km/h</span></section><nav class="aether-mobile-transport">'+''.join('<button>◯</button>' for _ in range(4))+'</nav><div id="joystick-wrapper"><div style="position:relative"><div id="joystick-container" style="width:116px;height:116px;border-radius:50%;background:#234765"></div></div></div></div></div>'
prob=f'<div id="root"><div class="tn-viewport tn-stage-probability"><header class="tn-header tn-header-reference"><button class="tn-back">←</button><div class="tn-header-title">热带气旋概率</div></header><main class="tn-probability-page"><div class="tn-probability-caption">热带气旋概率与集合预报</div><p>以下两张图为模拟</p><div class="tn-gallery-switch" role="group"><button class="is-active" aria-pressed="true" id="tab1">袭击概率图</button><button aria-pressed="false" id="tab2">8机构中心路径</button></div><figure class="tn-gallery-figure is-selected"><img src="{img}"><figcaption>袭击概率图</figcaption></figure><figure class="tn-gallery-figure"><img src="{img}"><figcaption>八机构路径</figcaption></figure></main></div></div>'
raw=(base/'src/utils/TyphoonNetworkStandaloneExport.ts').read_text()
assert 'const STANDALONE_TEMPLATE = String.raw`' in raw
html=raw.split('const STANDALONE_TEMPLATE = String.raw`',1)[1].rsplit('`;',1)[0]
payload=dict(product=dict(history=[dict(lat=15,lon=135,vmax=35,pmin=980,simHour=0,direction=90,speed=12)],forecasts=[],issue=dict(simHour=0,lat=15,lon=135,vmax=35)),typhoonName='测试风暴',ordinal=1,startTimeISO='2026-10-18T00:00:00Z',art={},coastline=dict(features=[]),warningLines=dict(h24=[],h48=[]),galleryImages=dict(strike=img,centers=img),nmcImage=img)
html=html.replace('__AETHER_EMBEDDED_PAYLOAD__',json.dumps(payload,ensure_ascii=False))
# The self-contained snapshot is tested in memory; do not package fake fixtures.

def dims(page,selectors):
 return page.evaluate('''s=>Object.fromEntries(s.map(sel=>{const el=document.querySelector(sel);if(!el)return [sel,null];const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return[sel,{x:r.x,y:r.y,w:r.width,h:r.height,display:cs.display,scrollWidth:el.scrollWidth}]}))''',selectors)

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport=dict(width=844,height=390),is_mobile=True,has_touch=True)
 page=context.new_page()
 for width,height in [(568,320),(844,390),(932,430),(1024,600),(390,844)]:
  page.set_viewport_size(dict(width=width,height=height))
  page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style>'+main)
  page.evaluate("l=>document.body.className='aether-mobile-ui'+(l?' aether-mobile-landscape':'')",width>height)
  ds=dims(page,['#typhoon-gis-viewport','.aether-landscape-rail','.aether-landscape-joystick-bay','#joystick-container','.aether-mobile-statusrail'])
  mapr=ds['#typhoon-gis-viewport'];rail=ds['.aether-landscape-rail'];stick=ds['#joystick-container']
  if width>height:
   assert .70 <= mapr['w']/width <= .82,(width,mapr)
   assert abs(mapr['x']-rail['w'])<2,(width,mapr,rail)
   assert 0<=stick['x'] and stick['x']+stick['w']<=mapr['x']+2,(width,stick,mapr)
   assert 0<=stick['y'] and stick['y']+stick['h']<=height+2,(width,stick)
  else:
   assert abs(mapr['w']-width)<2
   assert rail['display']=='none'
  print('MAIN',width,height,'map width',round(mapr['w']),'stick',round(stick['w']),flush=True)
 # Live gallery fixture test size and content
 for width,height in [(568,320),(844,390),(932,430),(1024,600),(390,844)]:
  page.set_viewport_size(dict(width=width,height=height))
  page.set_content('<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style>'+prob)
  d=dims(page,['.tn-probability-page','.tn-gallery-switch','.tn-gallery-figure','.tn-gallery-figure:nth-of-type(2)'])
  f=d['.tn-gallery-figure']; f2=d['.tn-gallery-figure:nth-of-type(2)'];content=d['.tn-probability-page'];tabs=d['.tn-gallery-switch']
  if width>height and width<=960:
   assert tabs['display']=='grid',(width,tabs)
   assert f['w']>=content['w']-25,(width,f,content)
   assert f2['display']=='none',(width,f2)
  else:
   assert tabs['display']=='none',(width,tabs)
   assert f2['display']!='none',(width,f2)
  print('GALLERY',width,height,'content',round(content['w']),'first',round(f['w']), 'second',f2['display'],flush=True)
 # Off-line true generated output test with real JS and no API connectivity
 page.set_viewport_size(dict(width=568,height=320))
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='load')
 page.click('#reference');page.click('#openprob');page.wait_for_timeout(100)
 assert page.locator('#gallerytabs').is_visible()
 assert page.locator('#probstrike').is_visible()
 assert not page.locator('#probcenters').is_visible()
 page.click('#showcenters')
 assert page.locator('#probcenters').is_visible()
 assert not page.locator('#probstrike').is_visible()
 assert page.locator('#showcenters').get_attribute('aria-pressed')=='true'
 page.screenshot(path='/mnt/data/aether_r221_offline_gallery_landscape.png')
 page.set_viewport_size(dict(width=390,height=844));page.wait_for_timeout(100)
 assert page.locator('#probstrike').is_visible()
 assert page.locator('#probcenters').is_visible()
 assert not page.locator('#gallerytabs').is_visible()
 page.screenshot(path='/mnt/data/aether_r221_offline_gallery_portrait.png')
 page.set_viewport_size(dict(width=932,height=430));page.wait_for_timeout(100)
 assert page.locator('#gallerytabs').is_visible()
 assert page.locator('#probcenters').is_visible()
 assert not page.locator('#probstrike').is_visible()
 assert not errors,errors
 print('OFFLINE orientation+two-image switch 3/3 PASS',flush=True)
 browser.close()
