from pathlib import Path
from io import BytesIO
from PIL import Image
from playwright.async_api import async_playwright
import asyncio,base64
root=Path(__file__).resolve().parent.parent
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
def uri(size,color):
 im=Image.new('RGB',size,color);f=BytesIO();im.save(f,format='PNG');return 'data:image/png;base64,'+base64.b64encode(f.getvalue()).decode()
# Uses the exact rendered 2030:1840 and classic 4:3 image aspect ratios.
strike=uri((1015,920),'#c4dbff'); classic=uri((640,480),'#def4fd')
html=f'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body,#root{{margin:0;height:100%;}} .tn-viewport{{position:relative;width:100%;height:100dvh;}}
</style><style>{css}</style></head><body><div id="root"><div class="tn-viewport">
<main class="tn-probability-page"><div class="tn-probability-caption">热带气旋概率</div><p>模拟图</p>
<figure><img id="strike" src="{strike}"><figcaption>袭击概率</figcaption></figure>
<figure><img id="classic" src="{classic}"><figcaption>8 机构中心路径</figcaption></figure></main>
</div></div></body></html>'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  checks=0
  for width in [320,360,390,430,768,1024,1440,1920,2560]:
   page=await browser.new_page(viewport={'width':width,'height':860})
   await page.set_content(html)
   results=await page.evaluate('''()=>{const main=document.querySelector('.tn-probability-page');return {
     overflows:main.scrollWidth>main.clientWidth+1,
     images:['strike','classic'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {w:r.width,h:r.height,nw:e.naturalWidth,nh:e.naturalHeight,x:r.x}})
   }}''')
   assert not results['overflows'],(width,results)
   for img in results['images']:
    assert img['w']>0 and img['x']>=-1 and img['x']+img['w']<=width+1,(width,img)
    assert abs((img['w']/img['h'])-(img['nw']/img['nh']))<0.005,(width,img)
    if width<2560:assert img['w']>=min(width-25,2560), (width,img)
   checks+=1;await page.close()
  await browser.close()
  print(f'R215 probability gallery responsive 9/9 viewport widths PASS')
asyncio.run(main())
