from pathlib import Path
import asyncio,base64
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parent.parent
styles=(root/'src/index.css').read_text();start=styles.index('/* Primary floating/sheet surfaces. */');stop=styles.index('/* Round147:',start);styles=styles[start:stop]
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text();icons=root/'public/network-icons'
def art(n):return 'data:image/png;base64,'+base64.b64encode((icons/n).read_bytes()).decode()
mock=f'''<div id="root"><main id="typhoon-app-container"><div role="dialog" class="tn-viewport">
<header class="tn-header"><button id="tn-network-back" class="tn-back"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button>
<div class="tn-provider-wrapper"><button id="tn-network-switch" class="tn-switch"><span class="tn-switch-first">切换</span><span class="tn-switch-second">地图商</span></button><div id="tn-provider-menu" class="tn-provider-menu"><button>高德地图</button><button>OSM 普通地图</button><button>OSM Night 夜间地图</button></div></div>
<div id="tn-header-title" class="tn-header-title">健茂台风路径</div><button class="tn-header-action tn-share-action"><img src="{art('network-share.png')}"></button><button id="tn-network-reference-icon" class="tn-header-action tn-reference-link"><img src="{art('network-reference-white.png')}"></button><button class="tn-header-action tn-history-action"><img src="{art('network-history.png')}"></button></header>
<div class="tn-right-tools"><button id="night" class="tn-floating-button"><img src="{art('network-daynight.png')}"></button><button id="traffic" class="tn-floating-button"><img src="{art('network-traffic.png')}"></button><button id="locate" class="tn-floating-button"><img src="{art('network-locate.png')}"></button></div>
<button id="replay" class="tn-replay-button"><img src="{art('network-replay.png')}"></button></div></main></div>'''
html=f'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>{styles}</style><style>{css}\n#root .tn-viewport #tn-provider-menu{{display:none!important}}#root .tn-viewport #tn-provider-menu.is-open{{display:flex!important}}</style></head><body>{mock}<script>document.getElementById("tn-network-switch").addEventListener("click",()=>document.getElementById("tn-provider-menu").classList.toggle("is-open"));</script></body></html>'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
  for width,height in [(360,780),(390,844),(430,932)]:
   page=await browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
   await page.set_content(html,wait_until='load')
   result=await page.evaluate('''() => {const info=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),s=getComputedStyle(e),img=e.querySelector('img'),ir=img?.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bg:s.backgroundColor,border:s.borderWidth,radius:s.borderRadius,imgW:ir?.width,imgH:ir?.height}};return {provider:info('tn-network-switch'),menu:info('tn-provider-menu'),right:['night','traffic','locate'].map(info),replay:info('replay'),title:info('tn-header-title')}}''')
   print('WIDTH',width,result)
   assert result['provider']['width']==40 and result['provider']['height']==40,result
   assert result['provider']['border'] in ('1px','1.5px') and result['provider']['radius']=='8px',result
   assert all(x['width']==38 and x['height']==38 for x in result['right']),result
   assert all(x['imgW']==38 and x['imgH']==38 for x in result['right']),result
   assert result['replay']['width']==46 and result['replay']['height']==46,result
   assert abs(result['right'][0]['y']-height*.67)<1,result
   assert result['menu']['width']==0,result
   assert result['title']['width']>0 and result['title']['x']>=result['provider']['x']+result['provider']['width'],result
   assert all(x['bg']=='rgba(0, 0, 0, 0)' for x in [result['provider'],*result['right'],result['replay']]),result
   await page.locator('#tn-network-switch').click()
   assert await page.locator('#tn-provider-menu button').count()==3
   menu=await page.locator('#tn-provider-menu').bounding_box();assert menu['width']<=width-58,menu
   await page.screenshot(path=str(root/'validation'/f'round212_main_controls_{width}.png'))
   await page.close()
  await browser.close()
asyncio.run(main())
