from pathlib import Path
import asyncio,base64,json
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parent.parent
full=(root/'src/index.css').read_text()
start0=full.index(':root { --aether-glass:rgba')
stop0=full.index('/* Round 22:',start0)
start1=full.rfind('/*',0,full.index('Round 126 ·'))
stop1=full.index('/* Round147:',start1)
css_global=full[start0:stop0]+'\n'+full[start1:stop1]
css_local=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
icons=root/'public/network-icons'
def art(name):return 'data:image/png;base64,'+base64.b64encode((icons/name).read_bytes()).decode('ascii')
mock=f'''<div id="root"><main id="typhoon-app-container"><div role="dialog" class="tn-viewport">
<header class="tn-header"><button id="tn-network-back" class="tn-back"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button>
<div class="tn-provider-wrapper"><button id="tn-network-switch" class="tn-switch"><span class="tn-switch-first">切换</span><span class="tn-switch-second">地图商</span></button></div>
<div class="tn-header-title">健茂台风路径</div><button id="tn-network-share" class="tn-header-action tn-share-action"><img src="{art('network-share.png')}"></button>
<button id="tn-network-reference-icon" class="tn-header-action tn-reference-link"><img src="{art('network-reference-white.png')}"></button>
<button id="tn-network-history" class="tn-header-action tn-history-action"><img src="{art('network-history.png')}"></button></header>
<div class="tn-right-tools"><button id="night" class="tn-floating-button"><img src="{art('network-daynight.png')}"></button>
<button id="traffic" class="tn-floating-button"><img src="{art('network-traffic.png')}"></button>
<button id="locate" class="tn-floating-button"><img src="{art('network-locate.png')}"></button></div>
<button id="replay" class="tn-replay-button"><img src="{art('network-replay.png')}"></button></div></main></div>'''
html=f'''<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>{css_global}</style><style>{css_local}</style></head><body>{mock}</body></html>'''
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    passed=0
    report=[]
    for width in [360,390,430]:
      page=await browser.new_page(viewport={'width':width,'height':844})
      await page.set_content(html,wait_until='domcontentloaded',timeout=12000)
      for state in ['normal','hover','active']:
        if state=='hover': await page.locator('#tn-network-share').hover()
        elif state=='active': await page.locator('#tn-network-history').dispatch_event('pointerdown')
        result=await page.evaluate('''() => Object.fromEntries(['tn-network-share','tn-network-history','tn-network-reference-icon','night','traffic','locate','replay'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e),b=e.getBoundingClientRect(),im=e.querySelector('img'),si=im&&getComputedStyle(im);return[id,{bg:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,overflow:s.overflow,x:b.x,y:b.y,w:b.width,h:b.height,fit:si?.objectFit,imgBg:si?.backgroundColor}]}))''')
        for id,info in result.items():
          assert info['bg']=='rgba(0, 0, 0, 0)' and info['shadow']=='none' and info['border']=='0px',(width,state,id,info)
          assert info['imgBg']=='rgba(0, 0, 0, 0)',(width,state,id,info)
          if id in ['night','traffic','locate']:
            assert info['w']==38 and info['h']==38 and info['overflow']=='visible' and info['fit']=='contain', (width,state,id,info)
        assert result['replay']['w']==46 and result['replay']['h']==46
        passed+=1
        report.append({'width':width,'state':state,'right':result['night'],'share':result['tn-network-share'],'history':result['tn-network-history']})
      await page.screenshot(path=str(root/'validation'/f'round213_controls_{width}.png'))
      await page.close()
    await browser.close()
    (root/'validation'/'round213_browser_results.json').write_text(json.dumps({'cases':passed,'passed':passed,'details':report},indent=2,ensure_ascii=False))
    print(f'R213 Chromium button appearance {passed}/{passed} PASS')
asyncio.run(main())
