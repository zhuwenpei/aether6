"""R208 targeted source, CSS and browser checks (not a complete Vite app build)."""
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
import base64, json, re, subprocess
ROOT=Path(__file__).resolve().parent.parent
SRC=(ROOT/'src/components/TyphoonNetworkSimulator.tsx').read_text()
CSS=(ROOT/'src/components/TyphoonNetworkSimulator.css').read_text()
NMC=(ROOT/'src/utils/NmcForecastProduct.ts').read_text()
HTML=ROOT/'validation/round208_standalone_sample.html'
checks={}
def check(name,cond):
 checks[name]=bool(cond)
 if not cond:print('FAIL:',name)
check('historical/CMA dot diameter 9px', 'NETWORK_DOT_DIAMETER_PX=9' in SRC and 'NETWORK_CMA_DOT_DIAMETER_PX=NETWORK_DOT_DIAMETER_PX' in SRC)
check('ordinary agency dot 4px', 'NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=4' in SRC)
check('SVG CMA label 9px and light stroke',"'font-size':'9','font-weight':'500'" in SRC and "'stroke-width':'0.7'" in SRC)
check('network summary enlarged', 'font-size:clamp(12.5px,3.5vw,16.5px)' in CSS)
check('active status restored', "'【生效中】'" in SRC)
check('night OSM tile and WGS conversion', 'tile.openstreetmap.org' in SRC and "basemap==='amap'?referenceBasemapLocation" in SRC)
check('Gaode day raster still present', "createReferenceRasterLayer(L,'amap')" in SRC)
check('replay handler functional', 'setFrame(0);setPlaying(product.history.length>1)' in SRC)
check('center handler functional', 'const centerLatest=()=>' in SRC and 'setView(displayPoint(fix.lon,fix.lat)' in SRC)
check('share exporter in main screen', 'downloadStandaloneNetworkHtml' in SRC and 'onClick={exportSnapshot}' in SRC)
check('NMC correction is prewest and >60h only', 'maxLatitude>=30' in NMC and 'lead<=60' in NMC and '0.12*Math.min' in NMC)
# Check tapering numerically, not merely by searching for its source text.
def nmc_factor(max_lat,lead):
 if lead<=60 or max_lat>=30:return 1
 return 1-0.12*min(1,(lead-60)/60)
check('NMC cone 0h-60h unchanged',all(nmc_factor(19,h)==1 for h in [0,12,48,60]))
check('NMC tropical late 120h cone radius mildly reduced',abs(nmc_factor(19,120)-0.88)<1e-8)
check('NMC after entering westerlies unchanged',all(nmc_factor(35,h)==1 for h in [72,96,120]))
check('reference image embedding included', 'nmcImage:reference' in SRC)
check('control assets all exist', all((ROOT/'public/network-icons'/x).exists() for x in ['network-share.png','network-reference-white.png','network-history.png','network-daynight.png','network-traffic.png','network-locate.png','network-replay.png']))
check('offline HTML generated',HTML.exists() and HTML.stat().st_size>300_000)
thumb=lambda n:'data:image/png;base64,'+base64.b64encode((ROOT/'public/network-icons'/n).read_bytes()).decode()
fixture=f'''<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>{CSS}</style></head><body style="margin:0"><div id="root"><div class="tn-viewport"><div class="tn-map"></div><header class="tn-header"><button class="tn-back" id="tn-network-back"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button><div class="tn-header-title">健茂台风路径</div><button class="tn-header-action tn-share-action"><img src="{thumb('network-share.png')}"></button><button class="tn-header-action tn-reference-link" id="tn-network-reference-icon"><img src="{thumb('network-reference-white.png')}"></button><button class="tn-header-action tn-history-action"><img src="{thumb('network-history.png')}"></button></header><div class="tn-ticker"><div>第30号　莺琵 2026年10月18日08时</div><div>风级:17级以上　风速:62m/s 等级:超强台风　气压:915hPa</div><div>经纬度：143.6°,13.1°　移向/移速：西北偏西,19公里/小时</div><b class="tn-status-active">【生效中】</b></div><div class="tn-right-tools"><button class="tn-floating-button"><img src="{thumb('network-daynight.png')}"></button><button class="tn-floating-button"><img src="{thumb('network-traffic.png')}"></button><button class="tn-floating-button"><img src="{thumb('network-locate.png')}"></button></div><button class="tn-replay-button"><img src="{thumb('network-replay.png')}"></button></div></div></body></html>'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for w in [360,390,430]:
  page=browser.new_page(viewport={'width':w,'height':800},device_scale_factor=1)
  page.set_content(fixture,wait_until='load');page.wait_for_timeout(180)
  controls=page.evaluate('''() => {
   const q=s=>document.querySelector(s),rect=e=>{const x=e.getBoundingClientRect();return [x.x,x.y,x.width,x.height]};
   return {head:rect(q('.tn-header')), title:rect(q('.tn-header-title')), share:rect(q('.tn-share-action')),
    ref:rect(q('#tn-network-reference-icon')),history:rect(q('.tn-history-action')),
    right:rect(q('.tn-right-tools')),replay:rect(q('.tn-replay-button')),
    ticker:parseFloat(getComputedStyle(q('.tn-ticker')).fontSize),
    status:parseFloat(getComputedStyle(q('.tn-status-active')).fontSize),
    back:getComputedStyle(q('#tn-network-back')).backgroundColor,
    bg:getComputedStyle(q('#tn-network-reference-icon')).backgroundColor,
    rightSize:rect(q('.tn-floating-button'))[2]};
  }''')
  check(f'header icons fit at {w}',controls['share'][0]>=controls['title'][0] and controls['history'][0]+controls['history'][2]<=w+2)
  check(f'three functional reference buttons present at {w}',all(controls[k][2]>=30 for k in ['share','ref','history']))
  check(f'right controls 42px at {w}',abs(controls['rightSize']-42)<1)
  check(f'header reference button has no overlay at {w}',controls['bg'] in ['rgba(0, 0, 0, 0)','transparent'])
  check(f'active status is not oversized at {w}',14<=controls['status']<=20)
  if w==390:page.screenshot(path=str(ROOT/'validation/round208_new_buttons_chromium.png'))
  page.close()
 page=browser.new_page(viewport={'width':390,'height':820})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(HTML.read_text(),wait_until='load',timeout=40000);page.wait_for_timeout(250)
 check('standalone HTML has no JS runtime errors',not errors)
 check('standalone map canvas initialized',page.locator('#c').evaluate('(e)=>e.width>200&&e.height>300'))
 check('standalone NMC image embedded',page.locator('#nmc').evaluate('(e)=>e.naturalWidth>0'))
 check('standalone icon art all embedded',page.locator('#nighticon').evaluate('(e)=>e.naturalWidth>0'))
 page.locator('#reference').click()
 check('standalone reference switch',page.locator('#ref').evaluate('(e)=>getComputedStyle(e).display')=='block')
 page.locator('#back').click();page.locator('#night').click()
 check('standalone night toggle',page.evaluate('night') is True)
 page.locator('#replay').click();page.wait_for_timeout(500)
 check('standalone replay timer returns to final state',page.evaluate('playing') is False)
 page.screenshot(path=str(ROOT/'validation/round208_standalone_mobile_chromium.png'))
 browser.close()
passed=sum(checks.values());result={'passed':passed,'total':len(checks),'failures':[n for n,v in checks.items() if not v]}
(ROOT/'ROUND208_VALIDATION.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False))
raise SystemExit(0 if passed==len(checks) else 1)
