from pathlib import Path
from PIL import Image
import json,base64,asyncio, re
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parent.parent
source=(root/'src/utils/TyphoonNetworkStandaloneExport.ts').read_text()
html=source.split('const STANDALONE_TEMPLATE = String.raw`',1)[1].rsplit('`;',1)[0]
art={}
for k,n in {'share':'network-share.png','reference':'network-reference-white.png','history':'network-history.png','night':'network-daynight.png','traffic':'network-traffic.png','locate':'network-locate.png','replay':'network-replay.png','cyclone':'cyclone-blue.png'}.items():
 p=root/'public/network-icons'/n
 art[k]='data:image/png;base64,'+base64.b64encode(p.read_bytes()).decode()
history=[{'lat':17+i*.35,'lon':135-i*.4,'vmax':30+i*1.5,'pmin':980-i*2,'simHour':i*3,'speed':20,'direction':305,'r7':{'ne':240,'se':220,'sw':230,'nw':250},'r10':{'ne':100,'se':90,'sw':90,'nw':110},'r12':{'ne':55,'se':50,'sw':50,'nw':55}} for i in range(12)]
payload={'typhoonName':'卡努','ordinal':6,'startTimeISO':'2023-07-29T00:00:00Z','nmcImage':None,'coastline':{'type':'FeatureCollection','features':[]},'art':art,'product':{'history':history,'issue':history[-1],'forecasts':[{'agency':'中国','color':'#00ff33','fixes':[dict(history[-1],lat=21+i*.3,lon=131-i*.3,simHour=history[-1]['simHour']+6*i) for i in range(1,5)]}]}}
html=html.replace('__AETHER_EMBEDDED_PAYLOAD__',json.dumps(payload,ensure_ascii=False).replace('<','\\u003c'))
(root/'validation').mkdir(exist_ok=True)
out=root/'validation/round212_standalone_visual_test.html';out.write_text(html)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'],headless=True)
  for width,height in [(360,780),(390,844),(430,932)]:
   page=await browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
   errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
   await page.set_content(html,wait_until='load',timeout=15000)
   await page.wait_for_timeout(400)
   styles=await page.evaluate('''() => Object.fromEntries(['back','share','reference','history','night','traffic','locate','replay'].map(id=>{let e=document.getElementById(id),s=getComputedStyle(e),r=e.getBoundingClientRect();return [id,{width:r.width,height:r.height,x:r.x,y:r.y,background:s.backgroundColor,boxShadow:s.boxShadow,border:s.borderWidth,img:e.querySelector('img')?.getBoundingClientRect().width}] }))''')
   print('WIDTH',width,styles,'errors',errors[:3])
   await page.screenshot(path=str(root/'validation'/f'round212_standalone_{width}.png'))
   assert not errors,errors
   assert styles['night']['width']==38 and styles['replay']['width']==46
   assert all(styles[k]['background']=='rgba(0, 0, 0, 0)' for k in styles)
   assert styles['share']['img']==(30 if width<=375 else 34)
   # Verify the standalone snapshot controls actually operate, not just CSS.
   await page.locator('#reference').click()
   assert await page.locator('#ref').evaluate('(e)=>getComputedStyle(e).display')=='block'
   assert await page.locator('#heading').inner_text()=='台风参考'
   await page.locator('#back').click()
   assert await page.locator('#map').evaluate('(e)=>getComputedStyle(e).display')=='block'
   await page.locator('#night').click()
   assert await page.evaluate('night') is True
   await page.locator('#locate').click()
   await page.locator('#replay').click()
   assert await page.evaluate('playing') is True
   await page.close()
  await browser.close()
asyncio.run(main())
