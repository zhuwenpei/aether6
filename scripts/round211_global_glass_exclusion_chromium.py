from pathlib import Path
from playwright.async_api import async_playwright
import asyncio,base64
root=Path(__file__).resolve().parent.parent
styles=(root/'src/index.css').read_text(); start=styles.index('/* Round126') if '/* Round126' in styles else styles.index('/* Primary floating/sheet surfaces. */'); stop=styles.index('/* Round147:',start); styles=styles[start:stop]
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
icons=root/'public/network-icons'
def art(n):return 'data:image/png;base64,'+base64.b64encode((icons/n).read_bytes()).decode()
mock=f'''<div id="root"><main id="typhoon-app-container"><div role="dialog" class="tn-viewport">
<header class="tn-header"><button id="tn-network-back" class="tn-back">返回</button><div class="tn-header-title">健茂台风路径</div>
<button id="share" class="tn-header-action tn-share-action"><img src="{art('network-share.png')}"></button>
<button id="tn-network-reference-icon" class="tn-header-action tn-reference-link"><img src="{art('network-reference-white.png')}"></button>
<button id="history" class="tn-header-action tn-history-action"><img src="{art('network-history.png')}"></button></header>
<div class="tn-right-tools"><button id="night" class="tn-floating-button"><img src="{art('network-daynight.png')}"></button><button id="traffic" class="tn-floating-button"><img src="{art('network-traffic.png')}"></button><button id="locate" class="tn-floating-button"><img src="{art('network-locate.png')}"></button></div>
<button id="replay" class="tn-replay-button"><img src="{art('network-replay.png')}"></button></div></main></div>'''
html=f'<html><head><style>{styles}</style><style>{css}</style></head><body>{mock}</body></html>'
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in [360,390,430]:
   page=await browser.new_page(viewport={'width':width,'height':844})
   await page.set_content(html)
   for state in ['normal','hover','active']:
    if state=='hover':await page.locator('#night').hover()
    if state=='active':await page.locator('#night').dispatch_event('pointerdown');await page.locator('#night').dispatch_event('mousedown')
    res=await page.evaluate('''() => Object.fromEntries(['share','tn-network-reference-icon','history','night','traffic','locate','replay'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e);return[id,{bg:s.backgroundColor,shadow:s.boxShadow,border:s.borderWidth,backdrop:s.backdropFilter}]}))''')
    print(width,state,res)
    assert all(d['bg']=='rgba(0, 0, 0, 0)' and d['shadow']=='none' and d['border']=='0px' for d in res.values()),res
   await page.screenshot(path=str(root/'validation'/f'round211_theme_{width}.png'))
   await page.close()
  await browser.close()
asyncio.run(run())
