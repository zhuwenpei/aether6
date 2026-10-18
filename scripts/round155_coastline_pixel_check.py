import json, time
from pathlib import Path
from playwright.sync_api import sync_playwright
geo=json.load(open(Path(__file__).resolve().parents[1]/'public/data/product_coastline_fine_v5.geojson'))
bounds={'lonMin':105,'lonMax':140,'latMin':5,'latMax':45}
js=r'''async ({geo,bounds})=>{
 const W=1348,H=940;
 const project=(lat,lon)=>({x:(lon-bounds.lonMin)/(bounds.lonMax-bounds.lonMin)*W,y:(bounds.latMax-lat)/(bounds.latMax-bounds.latMin)*H});
 const intersects=ring=>{
   let xlo=Infinity,xhi=-Infinity,ylo=Infinity,yhi=-Infinity;
   for(const p of ring){xlo=Math.min(xlo,p[0]);xhi=Math.max(xhi,p[0]);ylo=Math.min(ylo,p[1]);yhi=Math.max(yhi,p[1]);}
   return yhi>=bounds.latMin&&ylo<=bounds.latMax&&xhi>=bounds.lonMin&&xlo<=bounds.lonMax;
 };
 const make=(v)=>{const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d');ctx.lineWidth=.88;ctx.strokeStyle='#292126';return [c,ctx];};
 const rings=[];
 for(const f of geo.features){const g=f.geometry;if(!g)continue;
  if(g.type==='Polygon') for(const ring of g.coordinates){if(intersects(ring))rings.push(ring);}
  else if(g.type==='MultiPolygon') for(const poly of g.coordinates)for(const ring of poly){if(intersects(ring))rings.push(ring);}
 }
 // Direct commands and Path2D commands use the same seam predicate (none in this
 // inland/coastal geographic subdomain), command order, and per-ring strokes.
 const render=(ctx,paths)=>{
  for(let j=0;j<rings.length;j++){
   const ring=rings[j],path=paths?.[j];if(!path) ctx.beginPath();
   let down=false,drew=false;
   if(!path){for(let i=0;i<ring.length-1;i++){
    const a=ring[i],b=ring[i+1],pa=project(a[1],a[0]),pb=project(b[1],b[0]);
    if(!down)ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);down=true;drew=true;
   }if(drew)ctx.stroke();}else ctx.stroke(path);
  }
 };
 const paths=rings.map(ring=>{const path=new Path2D();let down=false;
  for(let i=0;i<ring.length-1;i++){
   const a=ring[i],b=ring[i+1],pa=project(a[1],a[0]),pb=project(b[1],b[0]);
   if(!down)path.moveTo(pa.x,pa.y);path.lineTo(pb.x,pb.y);down=true;
  }return path;
 });
 const [a,ca]=make(),[b,cb]=make();
 const t=performance.now();render(ca);const oldMs=performance.now()-t;
 const tt=performance.now();render(cb,paths);const cachedMs=performance.now()-tt;
 const aa=ca.getImageData(0,0,W,H).data,bb=cb.getImageData(0,0,W,H).data;
 let diff=0;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])diff++;
 const runs=6,t1=performance.now();for(let i=0;i<runs;i++)render(ca);const oldRepeatedMs=performance.now()-t1;
 const t2=performance.now();for(let i=0;i<runs;i++)render(cb,paths);const newRepeatedMs=performance.now()-t2;
 return {pixelsDiffering:diff,rings:rings.length,oldMs:+oldMs.toFixed(2),cachedMs:+cachedMs.toFixed(2),oldRepeatedMs:+oldRepeatedMs.toFixed(2),newRepeatedMs:+newRepeatedMs.toFixed(2)};
}'''
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
    page=browser.new_page()
    result=page.evaluate(js,{'geo':geo,'bounds':bounds})
    print(json.dumps(result,ensure_ascii=False))
    assert result['pixelsDiffering']==0
    browser.close()
