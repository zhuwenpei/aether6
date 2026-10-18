from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
css=(base/'src/components/TyphoonNetworkSimulator.css').read_text()
html='''<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"><div class="tn-viewport" role="dialog">
<header class="tn-header"><button class="tn-back"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button>
<div class="tn-provider-wrapper"><button class="tn-switch">切换<br>地图商</button></div><div class="tn-header-title">健茂台风路径</div><button class="tn-reference-link">◉</button></header>
<div class="tn-map" style="background:#a9d9f7"></div><div class="tn-ticker">
<div>第1号　达维 2023年8月3日20时</div><div>风级:3级　风速:5m/s 等级:已消散　气压:997hPa</div>
<div>经纬度：121.9°,37.2°　移向/移速：北偏东,38公里/小时</div><b>【已消散】</b></div>
<div class="tn-map" style="inset:54% 0 0;background:transparent;pointer-events:none"><div class="leaflet-popup tn-map-popup" style="position:absolute;left:20px;top:0;right:20px;pointer-events:auto"><div class="leaflet-popup-content-wrapper"><div class="leaflet-popup-content"><div class="tn-detail"><div class="tn-detail-heading" style="color:#00b92c">达维 2023年7月31日02时</div><div class="tn-detail-body"><div>中心位置：124.9°E，17.1°N</div><div>最大风力：16级，53米/秒，190公里/小时</div><div>强度等级：超强台风</div><div>中心气压：933百帕</div><div>移向移速：西，24公里/小时</div><div>风圈方位：东北　东南　西南　西北</div><div>七级风圈半径：525　361　317　441</div></div><div class="tn-simulated-note">模拟资料 · 仅供娱乐与分析</div></div></div></div></div></div>
</div></div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':393,'height':855},device_scale_factor=2)
 page.set_content(html)
 page.add_style_tag(content='''#root :is([role="dialog"],.control-drawer),.leaflet-popup-content-wrapper,.leaflet-popup-tip {background:rgba(32,32,34,.7)!important;color:#f2f2f2!important;backdrop-filter:blur(19px)!important}'''+css)
 result=page.evaluate('''() => {const get=s=>getComputedStyle(document.querySelector(s));const bounds=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};return {tickerAlign:get('.tn-ticker').textAlign,tickerStroke:get('.tn-ticker').webkitTextStrokeWidth,tickerShadow:get('.tn-ticker').textShadow,tickerWeight:get('.tn-ticker').fontWeight,tickerX:bounds('.tn-ticker'),tickerFont:get('.tn-ticker').fontSize,headingWeight:get('.tn-header-title').fontWeight,toolbar:bounds('.tn-header'),bodyColor:get('.tn-detail-body').color,popupBg:get('.leaflet-popup-content-wrapper').backgroundColor,detailSize:get('.tn-detail').fontSize,bodyWidth:bounds('.tn-detail-body')}}''')
 print(result)
 assert result['tickerAlign']=='right'
 assert result['tickerStroke']=='0px'
 assert result['tickerShadow']=='none'
 assert result['tickerWeight']=='400'
 assert result['popupBg']=='rgb(255, 255, 255)'
 assert result['bodyColor']=='rgb(22, 22, 22)'
 assert result['toolbar']['h']==46
 save=base/'validation'/'round192_reference_layout_chromium.png'
 page.screenshot(path=str(save));print('CHROMIUM PASS',str(save))
 browser.close()
