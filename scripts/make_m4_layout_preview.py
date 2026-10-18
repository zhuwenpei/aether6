from PIL import Image, ImageDraw, ImageFont
import json, math, os
ROOT=os.path.dirname(os.path.dirname(__file__))
W,H=1302,1260
center_lat,center_lon=22.3,114.4
half_w=400.0; half_h=half_w*H/W
cos0=math.cos(math.radians(center_lat))
def proj(lat,lon):
    x=(lon-center_lon)*111.32*cos0; y=(lat-center_lat)*111.32
    return W/2+x/(2*half_w)*W, H/2-y/(2*half_h)*H
img=Image.new('RGB',(W,H),'#b7e3fb'); d=ImageDraw.Draw(img)
# land
land_path=os.path.join(ROOT,'public/data/product_land_wide_v2.geojson')
with open(land_path,encoding='utf-8') as f: land=json.load(f)
def rings(g):
    if g.get('type')=='Polygon': return g.get('coordinates',[])
    if g.get('type')=='MultiPolygon': return [r for p in g.get('coordinates',[]) for r in p]
    return []
for ft in land.get('features',[]):
    for ring in rings(ft.get('geometry') or {}):
        pts=[]
        for c in ring:
            if len(c)>=2:
                x,y=proj(c[1],c[0]); pts.append((x,y))
        if len(pts)>=3 and not (max(x for x,y in pts)<-50 or min(x for x,y in pts)>W+50 or max(y for x,y in pts)<-50 or min(y for x,y in pts)>H+50):
            d.polygon(pts,fill='#f3f5f1')
# country outlines
cp=os.path.join(ROOT,'public/data/product_countries_highdetail_v3.geojson')
with open(cp,encoding='utf-8') as f: countries=json.load(f)
for ft in countries.get('features',[]):
    for ring in rings(ft.get('geometry') or {}):
        pts=[proj(c[1],c[0]) for c in ring if len(c)>=2]
        if len(pts)>=2: d.line(pts,fill='#666b6e',width=2,joint='curve')
# M3 echo keyed to transparent, covering +/-300km
src=Image.open('/mnt/data/AETHER_5_3_0_M3_color_reflectivity.png').convert('RGBA')
pix=src.load(); bg=(238,243,246)
for y in range(src.height):
    for x in range(src.width):
        r,g,b,a=pix[x,y]
        dist=abs(r-bg[0])+abs(g-bg[1])+abs(b-bg[2])
        pix[x,y]=(r,g,b,235 if dist>25 else 0)
echo_w=round(W*(300/half_w)); echo_h=round(H*(300/half_h))
src=src.resize((echo_w,echo_h),Image.Resampling.NEAREST)
img=Image.alpha_composite(img.convert('RGBA'), Image.new('RGBA',(W,H),(0,0,0,0)))
img.alpha_composite(src,((W-echo_w)//2,(H-echo_h)//2)); d=ImageDraw.Draw(img)
font_reg='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'; font_bold='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
def F(sz,b=False): return ImageFont.truetype(font_bold if b else font_reg,sz,index=2)
# labels above echo
cities=[('广州',23.13,113.26),('深圳',22.54,114.06),('香港',22.32,114.17),('澳门',22.20,113.54),('珠海',22.27,113.58),('汕头',23.35,116.68),('惠州',23.11,114.42),('佛山',23.02,113.12),('江门',22.58,113.08),('阳江',21.86,111.98),('湛江',21.27,110.36),('南宁',22.82,108.32),('海口',20.04,110.35),('厦门',24.48,118.09),('福州',26.07,119.30)]
for name,lat,lon in cities:
    x,y=proj(lat,lon)
    if 10<x<W-10 and 10<y<H-10:
        rr=3;d.ellipse((x-rr,y-rr,x+rr,y+rr),fill='#454b4e');d.text((x+6,y-9),name,font=F(15),fill='#555b5f')
for name,lat,lon in [('广 东',23.6,113.0),('广 西 壮 族 自 治 区',24.0,108.5),('福 建',26.0,117.8),('江 西',27.4,115.7),('海 南',19.2,109.8)]:
    x,y=proj(lat,lon)
    if 0<x<W and 0<y<H: d.text((x,y),name,font=F(22,b=True),fill=(80,84,86,190),anchor='mm')
# legend panel
panel_h=145;panel_w=910; y0=H-panel_h
d.rectangle((0,y0,panel_w,H),fill=(255,255,255,247),outline='#8b9296',width=1)
timestamp='2026-07-26 01:48:00'
d.text((26,y0+16),f'AETHER 模拟雷达拼图 [{timestamp}]',font=F(17,b=True),fill='#343a3d')
d.text((panel_w-245,y0+16),'[ 组合反射率 ]',font=F(17,b=True),fill='#343a3d')
colors=['#4A9EF0','#5CD6F0','#6EEA5A','#1FC93A','#0A8F1E','#FFFF00','#E6C300','#FF9A00','#FF1A00','#D40000','#A80000','#FF00FF','#9A00C8','#B79CF0']
bx,by=30,y0+55; bw,bh=690,24; sw=bw/14
for i,c in enumerate(colors): d.rectangle((bx+i*sw,by,bx+(i+1)*sw+1,by+bh),fill=c)
d.text((bx+bw+16,by+1),'dBZ',font=F(14,b=True),fill='#3b4246')
for i,v in enumerate(range(5,71,5)): d.text((bx+i*sw,by+30),str(v),font=F(12),fill='#3b4246',anchor='ma')
d.text((26,H-23),'AETHER 模拟雷达拼图 · 模拟产品，非实况',font=F(12),fill='#687176')
# intensity label
text='45m/s  STY'; f=F(64,b=True); bbox=d.textbbox((0,0),text,font=f); tw=bbox[2]-bbox[0]
d.text((W-24,H-25),text,font=f,fill='#E81FD0',stroke_width=2,stroke_fill=(255,255,255,190),anchor='rs')
# grey slant bar
bar=Image.new('RGBA',(24,130),(135,135,135,170)); bar=bar.rotate(-12,expand=True);img.alpha_composite(bar,(int(W*.84),int(H*.80)))
out='/mnt/data/AETHER_5_3_0_M4_layout_validation_1302x1260.png';img.convert('RGB').save(out,quality=95)
print(out)
