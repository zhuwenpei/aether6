from pathlib import Path
from playwright.sync_api import sync_playwright
# Optional browser integration test: requires Python playwright and Chromium.
css = (Path(__file__).resolve().parents[1] / 'src/index.css').read_text()
# Actual index.css is read and applied; minimal layout utilities mimic the Vite/Tailwind build.
utilities = '''
.fixed { position:fixed; }
.left-1\\/2 { left:50%; }
.bottom-4 { bottom:16px; }
.top-4 { top:16px; }
.flex { display:flex; }
.items-center { align-items:center; }
.gap-1\\.5 { gap:6px; }
.w-\\[min\\(960px\\,calc\\(100vw-16px\\)\\)\\] { width:min(960px, calc(100vw - 16px)); }
.h-\\[min\\(430px\\,52vh\\)\\] { height:min(430px,52vh); }
.inset-2 { inset:8px; }
'''
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-gpu'])
    for w,h in [(320,650),(360,740),(390,844),(432,915),(768,1024)]:
        page=browser.new_page(viewport={'width':w,'height':h}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page.set_content('<html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body class="aether-mobile-ui"><div class="pro-route-toolbar fixed left-1/2 top-4 flex items-center gap-1.5"><button>A</button><button>B</button><button>C</button><button>D</button></div><section aria-label="预报强度曲线编辑器" class="forecast-curve-popup fixed left-1/2 bottom-4 w-[min(960px,calc(100vw-16px))] h-[min(430px,52vh)]"><header>曲线</header></section></body></html>')
        page.add_style_tag(content=utilities+'\n'+css)
        page.evaluate('''() => { let el=document.documentElement; el.style.setProperty('--aether-vvw',window.innerWidth+'px'); el.style.setProperty('--aether-vvh',window.innerHeight+'px'); el.style.setProperty('--aether-vv-left','0px'); el.style.setProperty('--aether-vv-top','0px'); el.style.setProperty('--aether-vv-bottom','0px') }''')
        rects=page.evaluate('''() => ['.pro-route-toolbar','.forecast-curve-popup'].map(s => { const el=document.querySelector(s); const r=el.getBoundingClientRect(); return {x:r.x,width:r.width,right:r.right,translate:getComputedStyle(el).translate,transform:getComputedStyle(el).transform} })''')
        for el in rects:
            assert abs((el['x']+el['right'])/2-w/2) < 1.0, (w,el)
            assert el['x']>=-1 and el['right']<=w+1, (w,el)
        page.locator('.forecast-curve-popup').evaluate("el => {el.classList.remove('forecast-curve-popup');el.classList.add('forecast-curve-fullscreen','inset-2')}")
        r=page.evaluate('''() => { const el=document.querySelector('.forecast-curve-fullscreen'); const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,translate:getComputedStyle(el).translate,transform:getComputedStyle(el).transform}; }''')
        assert abs(r['x']-8)<1 and abs(r['width']-(w-16))<1 and abs(r['y']-8)<1 and abs(r['height']-(h-16))<1, (w,r)
        print(f"PASS viewport={w}x{h} toolbar={rects[0]['x']:.1f}..{rects[0]['right']:.1f} editor={rects[1]['x']:.1f}..{rects[1]['right']:.1f} fullscreen_left={r['x']:.1f}")
        # Simulate the browser moving/shrinking its visible viewport (e.g. pinch zoom
        # or a webview toolbar): panels must follow the *visible* rectangle, not 100vw.
        if w == 432:
            page.evaluate("""() => {
              const root = document.documentElement;
              root.style.setProperty('--aether-vv-left', '60px');
              root.style.setProperty('--aether-vv-top', '30px');
              root.style.setProperty('--aether-vvw', '300px');
              root.style.setProperty('--aether-vvh', '640px');
              root.style.setProperty('--aether-vv-bottom', '245px');
            }""")
            rect = page.locator('.pro-route-toolbar').bounding_box()
            assert rect and abs(rect['x'] + rect['width'] / 2 - 210) < 1, rect
            full = page.locator('.forecast-curve-fullscreen').bounding_box()
            assert full and abs(full['x'] - 68) < 1 and abs(full['y'] - 38) < 1, full
            assert abs(full['width'] - 284) < 1 and abs(full['height'] - 624) < 1, full
            print('PASS visual viewport offset (60,30), size (300,640)')
        page.close()
    browser.close()
