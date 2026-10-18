"""R195 mobile CSS isolation smoke: no bottom-right bar or backdrop.
This does not replace a full production Vite/Leaflet browser test."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json

root=Path(__file__).resolve().parent.parent
css1=root/'src/index.css'; css2=root/'src/components/TyphoonNetworkSimulator.css'
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
  page.set_content('''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"/></head><body class="aether-mobile-ui"><div id="root"><section class="tn-viewport" role="dialog"><div class="tn-header"><span>健茂台风路径</span></div><div class="tn-map"><div class="leaflet-container" style="width:100%;height:100%;"></div></div><div class="tn-ticker"><div>第1号 台风 2026年10月17日</div><div>风级:12级 风速:33m/s</div><div>经纬度: 120.5°,25.8°</div></div><a class="tn-osm-credit" href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></section></div></body></html>''')
  # Inject only the global rules responsible for mobile attribution expansion and dark glass.
  # The full application stylesheet is too large for this isolated headless smoke.
  global_conflict = '''
    .leaflet-control-attribution{background:rgba(5,12,20,.72)!important;color:#ddd!important;padding:2px 5px!important}
    body.aether-mobile-ui .leaflet-control a{min-width:42px;min-height:42px;line-height:42px}
    #root [role=dialog]{background:rgba(32,32,34,.70)!important;backdrop-filter:blur(19px)!important}
  '''
  page.add_style_tag(content=global_conflict)
  page.add_style_tag(content=css2.read_text())
  val=page.locator('.tn-osm-credit').evaluate('''el => {
    const s=getComputedStyle(el),r=el.getBoundingClientRect();
    return {text:el.textContent,background:s.backgroundColor,shadow:s.boxShadow,filter:s.backdropFilter,
      width:r.width,height:r.height,top:r.top,bottom:r.bottom,color:s.color,position:s.position,
      footerControls:document.querySelectorAll('.leaflet-control-attribution').length};}''')
  assert val['text']=='© OpenStreetMap contributors',val
  assert val['background']=='rgba(0, 0, 0, 0)',val
  assert val['shadow']=='none',val
  assert val['filter']=='none',val
  assert 90<val['top']<180,val
  assert val['bottom']<200,val
  assert val['position']=='absolute',val
  assert val['footerControls']==0,val
  out=root/'validation/round195_network_no_footer_chromium.png'
  page.screenshot(path=str(out))
  browser.close()
  result={'status':'PASS','test':'390x844 phone isolated CSS smoke','values':val,'screenshot':str(out.relative_to(root))}
  (root/'ROUND195_CHROMIUM_CSS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
  print(json.dumps(result,ensure_ascii=False,indent=2))
