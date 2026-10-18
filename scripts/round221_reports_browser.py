from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
css=re.sub(r'@import\s+[^;]+;','',(root/'src/index.css').read_text())
fixture='''<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root">
<div class="station-history-workstation"><div class="station-history-header">气象站观测</div><div class="flex-1"><div class="station-history-charts"><section class="station-chart-frame">风速</section><section class="station-chart-frame">气压</section><section class="station-chart-frame">雨量</section></div></div></div>
<div class="aircraft-recon-panel"><div class="aircraft-recon-report-content"><div class="aircraft-recon-report-layout"><section>探空参数</section><section>剖面图</section></div></div></div>
<div class="aether-report-summary"><div class="aether-report-summary-header">台风报告</div><div class="aether-report-summary-body"><div class="aether-report-kpi-grid"><div>生命周期</div><div>强度</div><div>气压</div><div>ACE</div><div>伤亡</div></div></div></div>
</div>'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':844,'height':390},is_mobile=True)
 for w,h in [(568,320),(844,390),(932,430)]:
  page.set_viewport_size({'width':w,'height':h})
  page.set_content('<style>'+css+'</style>'+fixture)
  page.evaluate('document.body.className="aether-mobile-ui aether-mobile-landscape"')
  cols=page.evaluate('''()=>{const n=s=>getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').filter(Boolean).length;return {station:n('.station-history-charts'),aircraft:n('.aircraft-recon-report-layout'),summary:n('.aether-report-kpi-grid')}}''')
  target=1 if w<=760 else 2
  assert cols['station']==target,(w,cols)
  assert cols['aircraft']==target,(w,cols)
  assert cols['summary']==(3 if w<=760 else 4),(w,cols)
  print(f'REPORT {w}x{h}: charts {cols["station"]}, aircraft {cols["aircraft"]}, KPI {cols["summary"]}')
 browser.close()
print('R221 operational report layout: 3/3 PASS')
