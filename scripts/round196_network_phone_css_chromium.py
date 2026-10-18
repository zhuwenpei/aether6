"""Round196 mobile CSS fixture (not a bundled Vite/Leaflet end-to-end test).
Inspect heading layout and popup close control at mobile widths, without JS map keys.
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
css=(root/'src/components/TyphoonNetworkSimulator.css').read_text()
svg='''<svg width="35" height="35" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 2C9 2 3 10 4 19c3-6 8-9 14-8 9 1 13 8 11 15-3 9-12 12-20 8 6 5 17 6 24-1 11-12 4-31-13-31Z" fill="white"/><circle cx="20" cy="20" r="6" fill="#02c942"/><circle cx="20" cy="20" r="2.5" fill="white"/></svg>'''
html=f'''<!DOCTYPE html><html lang="zh"><meta charset="UTF-8"/><body><div id="root">
<section class="tn-viewport">
<header class="tn-header"><button class="tn-back" aria-label="返回"><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button>
<div class="tn-provider-wrapper"><button class="tn-switch">切换<br/>地图商</button></div>
<div class="tn-header-title">健茂台风路径</div><button class="tn-reference-link" aria-label="台风参考">{svg}</button>
</header>
<div class="tn-map" style="background:#a1d2fd;">
<div class="leaflet-popup tn-map-popup" style="position:absolute;left:6%;right:6%;top:145px;z-index:3;">
<div class="leaflet-popup-content-wrapper"><div class="leaflet-popup-content" style="width:auto!important;">
<div class="tn-detail"><button class="tn-detail-close" aria-label="关闭打点详情">x</button>
<div class="tn-detail-heading" style="color:#00b92c">卡努 2023年8月1日17时</div>
<div class="tn-detail-body"><div>中心位置：128.4°E，25.2°N</div><div>最大风力：16级，55米/秒，196公里/小时</div>
<div>强度等级：超强台风</div><div>中心气压：930百帕</div><div>移向移速：西北，13公里/小时</div>
<div class="tn-quadrant tn-quadrant-label"><span>风圈方位：</span><span>东北</span><span>东南</span><span>西南</span><span>西北</span></div>
<div class="tn-quadrant"><span>七级风圈半径：</span><span>525</span><span>413</span><span>346</span><span>460</span></div>
<div class="tn-quadrant"><span>十级风圈半径：</span><span>132</span><span>105</span><span>94</span><span>120</span></div>
<div class="tn-quadrant"><span>12级风圈半径：</span><span>71</span><span>58</span><span>52</span><span>65</span></div></div>
<div class="tn-simulated-note">模拟资料 · 仅供娱乐与分析</div></div></div></div>
</div></div>
</section></div></body></html>'''
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 checks=[]
 for w in (360,390,430):
  page=b.new_page(viewport={'width':w,'height':810},device_scale_factor=1)
  page.set_content(html)
  page.add_style_tag(content='''
    .tn-map .leaflet-popup{width:88%;max-width:480px;}
    .tn-map .leaflet-popup-content-wrapper{padding:0;border-radius:6px;}
    .tn-map .leaflet-popup-content{margin:0;}
    .tn-map .tn-detail-close{appearance:none;}
    .tn-map .tn-detail-body>div{white-space:normal;}
    .tn-map .tn-detail{padding-bottom:6px;}
  ''')
  page.add_style_tag(content=css)
  values=page.evaluate('''()=>{
    const r=sel=>{const a=document.querySelector(sel).getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width,center:(a.left+a.right)/2};};
    const close=document.querySelector('.tn-detail-close'); const s=getComputedStyle(close), h=getComputedStyle(document.querySelector('.tn-header'));
    return {title:r('.tn-header-title'),switch:r('.tn-switch'),reference:r('.tn-reference-link'),
      popup:r('.tn-map-popup'),close:r('.tn-detail-close'),bg:s.backgroundColor,color:s.color,grid:h.gridTemplateColumns,
      viewportWidth:window.innerWidth};
  }''')
  assert values['title']['left']>=values['switch']['right']-4,values
  assert values['title']['right']<=values['reference']['left']+4,values
  assert values['popup']['left']<values['close']['left']<values['close']['right']<values['popup']['right'],values
  assert values['bg']=='rgba(0, 0, 0, 0)',values
  assert values['color'] in ('rgb(137, 137, 137)','rgb(136, 136, 136)'),values
  checks.append({'width':w,'status':'PASS','measurements':values})
  if w==390:page.screenshot(path=str(root/'validation/round196_header_popup_chromium.png'))
  page.close()
 b.close()
(root/'ROUND196_PHONE_CSS_VALIDATION.json').write_text(json.dumps({'status':'PASS','checks':checks},ensure_ascii=False,indent=2))
print(json.dumps({'status':'PASS','widths':[x['width'] for x in checks]},ensure_ascii=False))
