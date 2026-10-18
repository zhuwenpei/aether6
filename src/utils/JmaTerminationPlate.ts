/** Reference-style discontinued advisory. No probability rings or cyclone tracks. */
import { projectNorthPolarStereographicKm } from './MapProjection';
import { JMA_PRODUCT_COLORS, LOCAL_VECTOR_BASEMAPS } from './LocalVectorBasemaps';

export function drawJmaTerminationPlate(canvas: HTMLCanvasElement, landGeoJson:any, number:string|number, nature:'熱帯低気圧'|'温帯低気圧'='熱帯低気圧') {
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const W=canvas.width,H=canvas.height,k=W/1200;
  ctx.fillStyle=LOCAL_VECTOR_BASEMAPS.jma.ocean;ctx.fillRect(0,0,W,H);
  // Fixed broad map coverage, not auto-framed around a stopped centre.
  const anchor=[{lat:0,lon:75},{lat:0,lon:190},{lat:70,lon:75},{lat:70,lon:190},
    {lat:0,lon:125},{lat:65,lon:125}].map(v=>projectNorthPolarStereographicKm(v.lat,v.lon,140,60));
  const minX=Math.min(...anchor.map(p=>p.x)),maxX=Math.max(...anchor.map(p=>p.x));
  const minY=Math.min(...anchor.map(p=>p.y)),maxY=Math.max(...anchor.map(p=>p.y));
  const viewH=H*1.05,viewW=W*1.05;
  const projectionScale=Math.min(viewW/(maxX-minX),viewH/(maxY-minY));
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const project=(lat:number,lon:number)=>{
    const q=projectNorthPolarStereographicKm(lat,lon,140,60);
    return {x:W*.5+(q.x-cx)*projectionScale,y:H*.5-(q.y-cy)*projectionScale};
  };
  ctx.save();ctx.fillStyle=LOCAL_VECTOR_BASEMAPS.jma.land;
  for(const f of landGeoJson?.features||[]){
    const b=f.properties?.BBOX||f.bbox;
    if(b && (b[2]<65||b[0]>200||b[3]<-5||b[1]>75))continue;
    const g=f.geometry;if(!g)continue;
    const polies:number[][][][]=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
    for(const poly of polies){ctx.beginPath();for(const ring of poly){let started=false,lastX=NaN;
      for(const coord of ring){const q=project(coord[1],coord[0]);
        if(!started||Math.abs(q.x-lastX)>W*.65)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);
        started=true;lastX=q.x;
      }ctx.closePath();
    }ctx.fill('evenodd');}
  }
  ctx.lineWidth=.85*k;ctx.strokeStyle=JMA_PRODUCT_COLORS.grid;
  for(let lon=60;lon<=220;lon+=10){ctx.beginPath();for(let lat=-5;lat<=85;lat+=.75){const pt=project(lat,lon);lat===-5?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y);}ctx.stroke();}
  for(let lat=0;lat<=80;lat+=10){ctx.beginPath();for(let lon=55;lon<=220;lon+=.75){const pt=project(lat,lon);lon===55?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y);}ctx.stroke();}
  ctx.restore();
  const message=`台風${number}号は${nature}に変わりました`;
  ctx.font=`700 ${Math.round(57*k)}px "Yu Gothic","Noto Sans CJK JP","Microsoft YaHei",sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
  ctx.strokeStyle='rgba(26,37,44,.88)';ctx.lineWidth=8*k;
  ctx.shadowColor='rgba(0,0,0,.64)';ctx.shadowBlur=9*k;ctx.shadowOffsetY=3*k;
  ctx.strokeText(message,W/2,H*.47,W*.94);
  ctx.fillStyle='#ffffff';ctx.fillText(message,W/2,H*.47,W*.94);
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.fillStyle=JMA_PRODUCT_COLORS.logoGreen;ctx.textAlign='right';ctx.textBaseline='alphabetic';
  ctx.font=`500 ${40*k}px Arial,sans-serif`;ctx.fillText('JMA',W-40*k,H-35*k);
}
