"""Independent Chromium rendering check for subpixel projected quadrant rings.
Not a full integration test with Leaflet or deployed map tiles.
"""
from pathlib import Path
from math import sin, cos, pi
import asyncio, json
from playwright.async_api import async_playwright
R=Path(__file__).resolve().parent.parent
OUT=R/'validation'/'round203_windring_subpixel_chromium.png'

# 4 independent quadrants; cardinal joins intentionally remain straight.
def vertices(radii=(400,330,270,370), cx=250,cy=232):
    arr=[]
    for sector,r in enumerate(radii):
        for step in range(361):
            a=(sector*90+step*0.25)*pi/180
            arr.append((cx+r*.55*sin(a),cy-r*.55*cos(a)))
    return arr

def path(coords,round_pixels=False):
    seq=[(round(x),round(y)) if round_pixels else (x,y) for x,y in coords]
    return 'M'+' L'.join(f'{x:.3f},{y:.3f}' for x,y in seq)+' Z'

# Show same geometry with only coordinate quantization changed.
v=vertices()
html=f'''<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f5f8fd;font:15px Arial,sans-serif;color:#27354a}}
section{{display:flex;gap:12px;padding:14px}}article{{width:520px;background:white;border:1px solid #d0dae7;border-radius:9px;overflow:hidden}}
h3{{margin:0;padding:10px 14px;font-size:15px}}svg{{display:block;width:520px;height:490px;background:#a1d2fd}}.ring{{fill:#00b63322;stroke:#00ad4d;stroke-width:.76;stroke-linejoin:round;stroke-linecap:round}}
</style></head><body><section><article><h3>对照：标准整数像素投影</h3><svg viewBox="-15 -35 530 540"><path class="ring" d="{path(v,True)}"/></svg></article><article><h3>R203：亚像素连续投影</h3><svg viewBox="-15 -35 530 540"><path class="ring" d="{path(v,False)}"/></svg></article></section></body></html>'''
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=await browser.new_page(viewport={'width':1100,'height':600},device_scale_factor=2)
        await page.set_content(html,wait_until='load')
        await page.screenshot(path=str(OUT),full_page=True)
        has_two=await page.locator('path.ring').count()
        coords_float=[(x,y) for x,y in v if abs(x-round(x))>0.01 and abs(y-round(y))>0.01]
        assert has_two==2 and len(coords_float)>1000
        print(json.dumps({'result':'PASS','elements':has_two,'subpixel_points':len(coords_float),'total':len(v),'screenshot':str(OUT)},ensure_ascii=False))
        await browser.close()
if __name__=='__main__':asyncio.run(main())
