from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parent.parent
src=(root/'src/utils/TyphoonNetworkStandaloneExport.ts').read_text()
html=src.split('const STANDALONE_TEMPLATE = String.raw`',1)[1].rsplit('`;',1)[0]
fix=lambda h,lon,v: dict(lat=20,lon=lon,vmax=v,pmin=970-h,simHour=h,speed=20,direction=270,r7={},r10={},r12={})
history=[fix(0,136,15),fix(3,132,20),fix(6,126,28),fix(7,122,35),fix(8,121,42),fix(9,120,52)]
forecast=[fix(15,118,48),fix(21,116,55)]
payload={'typhoonName':'R219样例','ordinal':9,'startTimeISO':'2026-10-18T00:00:00Z','nmcImage':None,
 'coastline':{'type':'FeatureCollection','features':[]},'art':{},
 'warningLines':{'h24':[[105,0],[113,4.5],[119,11],[119,18],[127,22],[127,34]],'h48':[[105,0],[120,0],[132,15],[132,34]]},
 'product':{'history':history,'issue':history[-1],'forecasts':[{'agency':'中国','color':'#fa19da','fixes':forecast},
 {'agency':'日本','color':'#a97a07','fixes':forecast}]}}
html=html.replace('__AETHER_EMBEDDED_PAYLOAD__',json.dumps(payload,ensure_ascii=False).replace('<','\\u003c'))
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  for width,height in [(360,780),(390,844),(430,932)]:
   pg=await b.new_page(viewport={'width':width,'height':height});errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
   await pg.set_content(html)
   result=await pg.evaluate('''() => {
     const colors=[15,20,28,35,42,52].map(v=>color({vmax:v}));
     const old=ctx.arc,radii=[];
     ctx.arc=function(x,y,r,...rest){radii.push(r);return old.call(this,x,y,r,...rest)};
     draw();ctx.arc=old;
     return {colors,radii,inside:insideWarning24(20,122),outside:insideWarning24(20,130),overflow:document.documentElement.scrollWidth>innerWidth};
   }''')
   assert result['colors']==['#00bf00','#0000ff','#ff7400','#ff0000','#ff00ff','#753fc9'],result
   assert any(abs(v-5.5)<.01 for v in result['radii']),result
   assert any(abs(v-1.85)<.01 for v in result['radii']),result
   assert result['inside'] and not result['outside'] and not result['overflow'],result
   assert not errors,errors
   await pg.locator('#replay').click()
   assert await pg.evaluate('playing')
   await pg.wait_for_timeout(150)
   assert not errors,errors
   await pg.close()
  await b.close()
 print('R219 standalone screenshot palette/dot sizes/24h replay 3/3 mobile widths PASS')
asyncio.run(main())
