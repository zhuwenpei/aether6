from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[1]
css='unused-inline-stylesheet'
p=ROOT/'scripts'/'fixtures'/'round223_sketch_fixture.html'
p.write_text('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><link rel="stylesheet" href="'''+css+'''"/><style>body{margin:0;background:#202733;color:#ddd;font-family:sans-serif} #typhoon-app-container{position:relative;width:100vw;height:100vh} #typhoon-gis-viewport{background:#87bbde;position:absolute;inset:0} .testmap{position:absolute;inset:0;display:grid;place-items:center;color:#14263a;font-weight:900;font-size:36px} #joystick-wrapper{width:116px;height:116px;border-radius:50%;border:6px solid #eee;background:#929eaa;color:black;display:grid;place-items:center;box-sizing:border-box} .aether-mobile-statusrail{background:#202733} .aether-mobile-header{background:#202733} .aether-mobile-transport{background:#182030;display:flex;align-items:center;gap:5px}.aether-mobile-transport>button{border:1px solid #556475;background:#303e51;color:white}.aether-mobile-header-actions>button{border:1px solid #556475;background:#303e51;color:white}</style></head><body class="aether-mobile-ui aether-mobile-landscape"><div id="typhoon-app-container"><div class="aether-cutout-safe-strip"></div><aside class="aether-landscape-rail"><div class="aether-landscape-joystick-bay"><span>方向摇杆</span></div></aside><div id="typhoon-gis-viewport"><div class="testmap">模拟画面</div></div><header class="aether-mobile-header"><div class="aether-mobile-brand"><b>WMC</b></div><div class="aether-mobile-header-actions"><button class="aether-landscape-tool-products">图<br/>气象图</button><button class="aether-landscape-tool-shortcuts">快捷</button><button class="aether-landscape-tool-menu">菜单</button><button class="aether-landscape-tool-more">更多</button></div></header><section class="aether-mobile-statusrail"><span class="aether-mobile-status-time">10:00</span><strong>超强台风</strong><span>风速 59m/s</span><span>气压 925hPa</span><span>经纬度 130E 15N</span></section><div id="joystick-wrapper">摇杆</div><nav class="aether-mobile-transport"><div class="aether-landscape-time-main"><span>大时间轴 · T+24h</span><input type="range"/></div><button>上一点</button><button>暂停</button><button>停编</button><button>展开</button></nav><button class="aether-landscape-sidebar-toggle" onclick="document.body.classList.toggle('aether-landscape-rail-collapsed')">❮</button><button class="aether-landscape-immersive-toggle" onclick="document.body.classList.toggle('aether-landscape-ui-hidden');document.body.classList.add('aether-landscape-rail-collapsed')">⌄</button></div></body></html>''')
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu'])
 for w,h in [(568,320),(844,390),(1024,600),(390,844)]:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
  page.set_content(re.sub(r'<link rel="stylesheet"[^>]+/>', lambda _: '<style>'+(ROOT/'src'/'index.css').read_text()+'</style>',p.read_text()), wait_until='domcontentloaded');
  if w<h:page.evaluate("document.body.classList.remove('aether-mobile-landscape')")
  for stage in ['full','collapsed','immersive'] if w>h else ['portrait']:
   if stage=='collapsed':page.evaluate("document.body.classList.add('aether-landscape-rail-collapsed')")
   if stage=='immersive':page.evaluate("document.body.classList.add('aether-landscape-ui-hidden')")
   page.wait_for_timeout(420)
   await_result = page.evaluate('''async () => { for (let i=0;i<32;i++) await new Promise(requestAnimationFrame); return true; }''')
   result=page.evaluate('''() => {const props = sel=>{const a=document.querySelector(sel);const r=a.getBoundingClientRect();const s=getComputedStyle(a);return {left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height),display:s.display,opacity:s.opacity}};return {map:props('#typhoon-gis-viewport'), info:props('.aether-mobile-statusrail'),joy:props('#joystick-wrapper'),tab:props('.aether-landscape-immersive-toggle'),vars:[getComputedStyle(document.body).getPropertyValue('--aether-shell-rail-w'),getComputedStyle(document.body).getPropertyValue('--aether-hole-side'),getComputedStyle(document.querySelector('#typhoon-gis-viewport')).getPropertyValue('--aether-shell-rail-w'),getComputedStyle(document.querySelector('#typhoon-gis-viewport')).left],safe:getComputedStyle(document.body,'::before').backgroundColor, scrollX:document.documentElement.scrollWidth}}''')
   if stage=='full':
    assert result['map']['left']>w*.25 and result['map']['width']>w*.6, result
    assert result['map']['height']<h and result['joy']['display']!='none'
   if stage=='collapsed': assert result['map']['left']<w*.1 and result['map']['width']>w*.9 and result['joy']['display']!='none',result
   if stage=='immersive': assert result['map']['height']>=h-2 and result['joy']['display']=='none' and result['tab']['display']=='grid',result
   print(w,h,stage,json.dumps(result,ensure_ascii=False))
   # No screenshot is necessary for this geometry regression test.
  page.close()
 b.close()
print('R223 browser check passed')
