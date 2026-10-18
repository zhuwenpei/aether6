from pathlib import Path
from io import BytesIO
from PIL import Image
from playwright.async_api import async_playwright
import asyncio,json,base64
root=Path(__file__).resolve().parent.parent
src=(root/'src/utils/TyphoonNetworkStandaloneExport.ts').read_text()
html=src.split('const STANDALONE_TEMPLATE = String.raw`',1)[1].rsplit('`;',1)[0]
def uri(color):
 image=Image.new('RGB',(700,340),color)
 out=BytesIO();image.save(out,format='PNG');return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()
fix={'lat':16,'lon':130,'vmax':40,'pmin':958,'simHour':3,'speed':18,'direction':320,'r7':{},'r10':{},'r12':{}}
payload={'typhoonName':'模拟','ordinal':1,'startTimeISO':'2026-10-18T00:00:00Z','nmcImage':uri('#f7f7f7'),
 'galleryImages':{'strike':uri('#93c5fd'),'centers':uri('#fef08a')},
 'coastline':{'type':'FeatureCollection','features':[]},'art':{},
 'product':{'history':[dict(fix,simHour=0),fix],'issue':fix,'forecasts':[]}}
html=html.replace('__AETHER_EMBEDDED_PAYLOAD__',json.dumps(payload,ensure_ascii=False).replace('<','\\u003c'))
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  for width,height in [(360,780),(390,844),(430,932)]:
   page=await b.new_page(viewport={'width':width,'height':height});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   await page.set_content(html)
   await page.locator('#reference').click()
   await page.locator('#openprob').click()
   assert await page.locator('#prob').is_visible()
   assert await page.locator('#probstrike').evaluate('(e)=>e.naturalWidth')==700
   assert await page.locator('#probcenters').evaluate('(e)=>e.naturalWidth')==700
   assert await page.locator('#prob img').count()==2
   await page.locator('#back').click();assert await page.locator('#ref').is_visible()
   await page.locator('#back').click();assert await page.locator('#map').is_visible()
   assert not errors,errors
   await page.close()
  await b.close()
 print('R214 standalone probability gallery 3/3 mobile widths PASS')
asyncio.run(main())
