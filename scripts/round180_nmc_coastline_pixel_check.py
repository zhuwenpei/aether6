"""Round180 Chromium pixel test: offshore pixels must not get mainland tint.
Run from project root after `node scripts/round180_nmc_coastline_fill_regression.cjs`.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'artifacts/round180_nmc_coastline_test.html').read_text(encoding='utf-8')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content(html)
    colors = page.evaluate('''() => ({
      sea: sample(28,123), land: sample(28,112),
      lake: sample(22,111), island: sample(18,121.5), ocean: sample(28,127)
    })''')
    browser.close()
expected = {'sea': [223, 240, 250, 255], 'land': [255, 235, 207, 255],
            'lake': [223, 240, 250, 255], 'island': [255, 235, 207, 255],
            'ocean': [223, 240, 250, 255]}
assert colors == expected, f'Coastline fill regression: {colors!r}'
print('ROUND180 PIXEL PASS: sea and lake stay ocean, mainland and island use China tint, fine coastline bounds respected')
