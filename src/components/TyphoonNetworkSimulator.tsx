/** Round190: standalone read-only typhoon-network simulation, styled to user-provided screenshots. */
import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Typhoon, SimulationConfig } from '../types';
import { getTyphoonDisplayName, getTyphoonOrdinalNumber } from '../utils/TyphoonDisplayName';
import { getWindForceCategory } from '../simulation/Engine';
import { loadNaturalEarthData, landGeoJson, countriesGeoJson, checkPointOnLandGeoJson } from '../simulation/NaturalEarthLoader';
import { drawNmcForecastProductCooperative } from '../utils/NmcForecastProduct';
import { loadNmcOptionalGeography } from '../utils/NmcOptionalGeography';
import { cmaBoundedNetworkHistory, buildNetworkForecasts, networkPointColor, networkHistorySegments, networkVisibleForecastFixes, networkForecastSegments, type NetworkFix, type NetworkProduct } from '../utils/TyphoonNetworkData';
import { createReferenceRasterLayer, referenceBasemapLocation, REFERENCE_RASTER_CREDIT } from '../utils/TyphoonNetworkReferenceRaster';
import { downloadStandaloneNetworkHtml } from '../utils/TyphoonNetworkStandaloneExport';
import './TyphoonNetworkSimulator.css';

export type NetworkProps = { storm:Typhoon; startDate:Date; currentHour:number; config?:SimulationConfig; onClose:()=>void };
const fmtDate=(d:Date)=>{const bj=new Date(d.getTime()+8*3600000);return `${bj.getUTCFullYear()}年${bj.getUTCMonth()+1}月${bj.getUTCDate()}日${String(bj.getUTCHours()).padStart(2,'0')}时`;};
const dateAt=(start:Date,h:number)=>new Date(start.getTime()+h*3600000);
const num=(n:number,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
const compass=(deg:number)=>{
  const compass16=['北','北偏东','东北','东偏北','东','东偏南','东南','南偏东','南','南偏西','西南','西偏南','西','西偏北','西北','北偏西'];
  return compass16[Math.round(((deg%360+360)%360)/22.5)%16];
};
const grade=(w:number,category?:string)=>{
  if(category==='温带气旋')return '温带气旋';
  if(category==='残留低压'||category==='已消散')return category;
  if(w<17.2)return '热带低压';if(w<24.5)return '热带风暴';if(w<32.7)return '强热带风暴';if(w<41.5)return '台风';if(w<51)return '强台风';return '超强台风';
};
/** Four quadrant arcs retain R189's unmodified N/E/S/W radii.
 * 360 steps per quadrant (0.25°) preserve the geographic geometry;
 * neighboring quadrant radii still join exclusively on their common
 * meridian/parallel, never diagonally. */
export function windRing(fix:NetworkFix, field:'r7'|'r10'|'r12'):Array<[number,number]>{
  const stepsPerQuadrant=360;
  const rr=fix[field];
  const quadrants=['ne','se','sw','nw'] as const;
  const points:Array<[number,number]>=[];
  for(let sector=0;sector<4;sector++){
    const radius=Math.max(0,Number(rr?.[quadrants[sector]]||0));
    for(let step=0;step<=stepsPerQuadrant;step++){
      const bearing=sector*90+step*(90/stepsPerQuadrant);
      const rad=bearing*Math.PI/180;
      const latitude=(bearing===90||bearing===270)?fix.lat:fix.lat+radius*Math.cos(rad)/111.195;
      const longitude=(bearing===0||bearing===180||bearing===360)?fix.lon:fix.lon+radius*Math.sin(rad)/(111.195*Math.max(.12,Math.cos(fix.lat*Math.PI/180)));
      points.push([Math.max(-85,Math.min(85,latitude)),((longitude+540)%360+360)%360-180]);
    }
  }
  // Close north boundary with a meridional segment, not an accidental diagonal.
  return points;
}
/** Leaflet's usual latLngToLayerPoint() rounds to *integer* screen pixels.
 * Its high-density rings therefore become stair-stepped at mobile zoom, even
 * with 1444 geodesic samples. Use unrounded projected points for this overlay.
 * This only changes display precision, never the input quadrant radii. */
export function smoothWindPolygon(map:L.Map,vertices:L.LatLngExpression[],options:L.PolylineOptions):L.Polygon {
  const polygon=L.polygon(vertices,options);
  type ProjectedWindPolygon=L.Polygon & {
    _map?:L.Map;
    _projectLatlngs:(latlngs:L.LatLng[]|L.LatLng[][],result:L.Point[][],bounds:L.Bounds)=>void;
  };
  const path=polygon as ProjectedWindPolygon;
  path._projectLatlngs=function(latlngs,result,bounds){
    if(!latlngs.length)return;
    if(latlngs[0] instanceof L.LatLng){
      const projected=(latlngs as L.LatLng[]).map(ll=>{
        const pt=map.project(ll,map.getZoom()).subtract(map.getPixelOrigin());
        bounds.extend(pt);
        return pt;
      });
      result.push(projected);
    }else{
      for(const ring of latlngs as L.LatLng[][])this._projectLatlngs(ring,result,bounds);
    }
  };
  return polygon;
}
/** Show rings only while the current center lies over water. The landed flag is
 * a fallback ONLY when fine shoreline polygons are unavailable (it may be sticky). */
export function shouldDrawNetworkWindRadii(fix:NetworkFix):boolean {
  const hasRadii=(['r7','r10','r12'] as const).some(field=>
    Object.values(fix[field]||{}).some(value=>Number(value)>0));
  if(!hasRadii)return false;
  if(landGeoJson?.features?.length)return !checkPointOnLandGeoJson(fix.lat,fix.lon);
  return !fix.landed;
}
const encode=(raw:string)=>raw.replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
/** Uploaded transparent white reference icon, centered on its actual open eye. */
function hurricaneSvg(size=40){return <img className="tn-reference-art" src="/network-icons/reference-white.png" width={size} height={size} alt="" draggable={false} aria-hidden="true"/>}
/** R197: blue eye asset is alpha centered before packaging; the eye itself never moves.
 * The outside artwork turns counter-clockwise once every 2 seconds. */
export const NETWORK_CYCLONE_SIZE_PX=24;
export function cycloneAsset(vmax:number,category?:string):string {
  const palette:Record<string,string>={
    '#00ce3a':'weak','#0639f5':'storm','#ff8b12':'severe',
    '#ff161d':'typhoon','#eb08dd':'intense','#8320d6':'super'
  };
  return `/network-icons/cyclone-${palette[networkPointColor(vmax,category)]||'unknown'}.webp`;
}

function Details({fix,name,startDate,agency}: {fix:NetworkFix; name:string; startDate:Date; agency?:string}){
  const label=agency?`预测机构：【${agency}】`:`${name} ${fmtDate(dateAt(startDate,fix.simHour))}`;
  const r=(rad:NetworkFix['r7'])=>['ne','se','sw','nw'].map(k=>num(rad?.[k as keyof typeof rad]??0)).map(encode);
  return <div className="tn-detail">
    <button type="button" className="tn-detail-close" aria-label="关闭打点详情">x</button>
    <div className="tn-detail-heading" style={{color:agency?({'中国':'#f2181b','美国':'#18bdf6','韩国':'#9d6c03','日本':'#00bb40'}[agency]||'#16b724'):'#00b92c'}}>{label}</div>
    <div className="tn-detail-body">
      <div>中心位置： {num(fix.lon,1)}°E， {num(fix.lat,1)}°N</div>
      <div>最大风力： {getWindForceCategory(fix.vmax)}级，{num(fix.vmax)}米/秒{!agency?`，${num(fix.vmax*3.6)}公里/小时`:''}</div>
      <div>强度等级： {grade(fix.vmax,fix.category)}</div>
      <div>中心气压： {Number.isFinite(fix.pmin)?`${num(fix.pmin)}百帕`:'-'}</div>
      {agency? <div>预报时效： {fmtDate(dateAt(startDate,fix.simHour))}</div>: <>
        <div>移向移速： {compass(fix.direction)}，{num(fix.speed)}公里/小时</div>
        <div className="tn-quadrant tn-quadrant-label"><span>风圈方位：</span><span>东北</span><span>东南</span><span>西南</span><span>西北</span></div>
        {([['七级风圈半径',fix.r7],['十级风圈半径',fix.r10],['12级风圈半径',fix.r12]] as const).map(([title,rad])=><div className="tn-quadrant" key={title}><span>{title}：</span>{r(rad).map((v,i)=><span key={i}>{v}</span>)}</div>)}
      </>}
    </div>
    <div className="tn-simulated-note">模拟资料 · 仅供娱乐与分析</div>
  </div>;
}


/** WGS84 -> GCJ-02 only inside mainland, as required by AMap JS API. */
export function toAmapPosition(lon:number,lat:number):[number,number] {
  if(!(lon>73.66&&lon<135.05&&lat>3.86&&lat<53.55))return [lon,lat];
  const pi=Math.PI,x=lon-105,y=lat-35;
  const ld=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x))+
    (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3+(20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3+
    (160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
  const od=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))+
    (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3+(20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3+
    (150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
  const rad=lat*pi/180,magic=1-.006693421622965943*Math.sin(rad)**2,sqrt=Math.sqrt(magic);
  return [lon+(od*180)/(6378245/sqrt*Math.cos(rad)*pi),lat+(ld*180)/(6378245*(1-.006693421622965943)/(magic*sqrt)*pi)];
}
/** R192: agency identity colors are for forecast dashed lines only. */
export function networkForecastDotColor(fix:NetworkFix):string {
  return networkPointColor(fix.vmax,fix.category);
}
/** Screenshot-calibrated *outer* diameter: CMA and history are peers;
 * other forecast agencies are lower-priority. Diameter includes the
 * deliberately faint R203 semi-transparent separation outline. */
export const NETWORK_DOT_DIAMETER_PX=9;
export const NETWORK_CMA_DOT_DIAMETER_PX=NETWORK_DOT_DIAMETER_PX;
export const NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX=4;
export const NETWORK_HISTORY_DOT_STROKE_PX=0.48;
export const NETWORK_CMA_DOT_STROKE_PX=0.48;
export const NETWORK_OTHER_DOT_STROKE_PX=0.28;
/** Invisible interaction radius for non-CMA forecast dots; visual size stays at 4px. */
export const NETWORK_OTHER_AGENCY_HIT_RADIUS_PX=7;
/** Horizontal ground distance visible from edge to edge during 32x replay. */
export const NETWORK_REPLAY_HORIZONTAL_SPAN_KM=1000;
export function networkReplayZoomForWidth(viewportWidthPx:number,latitude:number):number {
  // EPSG:3857 ground resolution: circumference*cos(lat)/(256*2^zoom).
  // A fractional zoom is intentional: integer zooms cannot maintain 1000km on phones.
  const cosLat=Math.cos(Math.max(-85,Math.min(85,latitude))*Math.PI/180);
  const zoom=Math.log2(Math.max(1,viewportWidthPx)*40075.016686*Math.max(0.087,cosLat)/
    (256*NETWORK_REPLAY_HORIZONTAL_SPAN_KM));
  return Math.max(2,Math.min(18,zoom));
}
export const NETWORK_DOT_RADIUS_PX=(NETWORK_DOT_DIAMETER_PX-NETWORK_HISTORY_DOT_STROKE_PX)/2;
export const NETWORK_CMA_DOT_RADIUS_PX=(NETWORK_CMA_DOT_DIAMETER_PX-NETWORK_CMA_DOT_STROKE_PX)/2;
export const NETWORK_OTHER_AGENCY_DOT_RADIUS_PX=(NETWORK_OTHER_AGENCY_DOT_DIAMETER_PX-NETWORK_OTHER_DOT_STROKE_PX)/2;
/** R203: Outline is almost invisible on its own but separates overlapping fixes. */
export const NETWORK_WIND_RING_COLORS=['#00ad2a','#dfff6b','#c41618'] as const;
export const NETWORK_DOT_OUTLINE_COLOR='#ffffff';
export const NETWORK_DOT_OUTLINE_OPACITY=0.34;
export const NETWORK_LEAD_LABEL_WIDTH_PX=91;
export const NETWORK_LEAD_LABEL_HEIGHT_PX=16;
/** Z-order must be independent of the order in the returned forecast array. */
export function networkForecastDrawOrder(forecasts: NetworkProduct['forecasts']): NetworkProduct['forecasts'] {
  return [...forecasts].sort((a,b)=>(a.agency==='中国'?1:0)-(b.agency==='中国'?1:0));
}
/** A transparent standalone SVG label avoids a Leaflet divIcon/glass background.
 * The caller escapes input by passing ONLY computed numeric lead/force values. */
export function networkLeadLabelSvg(lead:number,force:number):string {
  const text=`${Math.round(lead)}h/${Math.round(force)}级${force>=17?'以上':''}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${NETWORK_LEAD_LABEL_WIDTH_PX}" height="${NETWORK_LEAD_LABEL_HEIGHT_PX}" viewBox="0 0 ${NETWORK_LEAD_LABEL_WIDTH_PX} ${NETWORK_LEAD_LABEL_HEIGHT_PX}" aria-hidden="true"><text x="1" y="13" fill="#fff" stroke="#292929" stroke-width="0.7" paint-order="stroke fill" stroke-linejoin="round" font-family="Arial,'Microsoft YaHei',sans-serif" font-size="9" font-weight="500">${text}</text></svg>`;
}
/** Small flat SVG center/dot; independent of provider identity. */
function strengthDotSvg(color:string,size:number,outline:number=NETWORK_HISTORY_DOT_STROKE_PX):string {
  const safe=/^#[0-9a-fA-F]{6}$/.test(color)?color:'#818181';
  const c=size/2;
  const weight=Math.max(0,Math.min(0.5,outline));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${c-weight/2}" fill="${safe}" stroke="${NETWORK_DOT_OUTLINE_COLOR}" stroke-opacity="${NETWORK_DOT_OUTLINE_OPACITY}" stroke-width="${weight}"/></svg>`)}`;
}
/** Huawei/Petal Maps Web Map Kit; requires a valid domain-allowlisted API key. */
/** R202: Geographic SVG glyphs share the SAME Leaflet SVG renderer/zoom transform
 * as tracks, circles and wind-radii. DOM divIcons follow a separate marker pane
 * and visibly slip relative to the SVG paths during mobile pinch gestures.
 * Render an SVG <g> next to the invisible anchor path in the renderer's root.
 */
type NetworkSvgGlyph = L.CircleMarker & { _path?:SVGPathElement; _point?:L.Point;
  _updatePath?:()=>void; _networkGlyph?:SVGGElement };
const SVG_NS='http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(kind:K, attrs:Record<string,string>={}){
  const node=document.createElementNS(SVG_NS,kind);
  Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));
  return node;
}
function networkGeographicGlyph(map:L.Map,at:L.LatLngExpression,renderer:L.SVG,
  make:(position:L.Point,group:SVGGElement)=>void,options:{interactive?:boolean;radius?:number}={}):NetworkSvgGlyph{
  const anchor=L.circleMarker(at,{renderer,radius:options.radius??1,stroke:false,
    fill:options.interactive??false,opacity:0,fillOpacity:0.001,interactive:options.interactive??false}) as NetworkSvgGlyph;
  const update=anchor._updatePath!.bind(anchor);
  anchor._updatePath=()=>{
    update();
    const path=anchor._path;
    const pos=anchor._point;
    if(!path||!pos)return;
    // Leaflet creates the SVG <path> before it inserts that path into its SVG
    // renderer. The first _updatePath can therefore run while parentNode is
    // null. Do not record a detached glyph as if it were already rendered.
    const parent=path.parentNode;
    if(!parent)return;
    if(!anchor._networkGlyph){
      anchor._networkGlyph=svgElement('g',{'class':'tn-geo-glyph'});
    }
    // SVG renderer / pane reinitialization can replace the original parent.
    // Reattach on every draw instead of keeping a permanently orphaned <g>.
    if(anchor._networkGlyph.parentNode!==parent)parent.appendChild(anchor._networkGlyph);
    make(pos,anchor._networkGlyph);
  };
  anchor.on('remove',()=>{anchor._networkGlyph?.remove();anchor._networkGlyph=undefined;});
  anchor.addTo(map);
  // On real Leaflet's first add, CircleMarker._updatePath runs before SVG._addPath
  // inserts the <path> into _rootGroup. Force a *post-insertion* draw so both
  // the cyclone icon and all CMA lead-time labels appear on initial map entry.
  anchor._updatePath?.();
  return anchor;
}
function geographicLead(map:L.Map,at:L.LatLngExpression,renderer:L.SVG,lead:number,force:number):L.Layer{
  const caption=`${Math.round(lead)}h/${Math.round(force)}级${force>=17?'以上':''}`;
  return networkGeographicGlyph(map,at,renderer,(point,group)=>{
    let text=group.firstElementChild as SVGTextElement|null;
    if(!text){
      text=svgElement('text',{'class':'tn-geo-lead', 'paint-order':'stroke fill',
        'stroke-linejoin':'round','font-size':'9','font-weight':'600',
        'font-family':"Arial,'Microsoft YaHei',sans-serif",'fill':'#fff',
        'stroke':'#292929','stroke-width':'0.85', 'pointer-events':'none'});
      text.textContent=caption;
      group.appendChild(text);
    }
    text.setAttribute('x',String(point.x-26));
    text.setAttribute('y',String(point.y+16));
  });
}
function geographicCyclone(map:L.Map,at:L.LatLngExpression,renderer:L.SVG,fix:NetworkFix):NetworkSvgGlyph {
  return networkGeographicGlyph(map,at,renderer,(point,group)=>{
    let image=group.querySelector<SVGImageElement>('image');
    let eye=group.querySelector<SVGCircleElement>('circle');
    if(!image){
      image=svgElement('image',{'class':'tn-geo-cyclone-spin','href':'/network-icons/cyclone-blue.png',
        'width':String(NETWORK_CYCLONE_SIZE_PX),'height':String(NETWORK_CYCLONE_SIZE_PX),
        'preserveAspectRatio':'xMidYMid meet','pointer-events':'none'});
      group.appendChild(image);
    }
    if(!eye){
      eye=svgElement('circle',{'class':'tn-geo-cyclone-eye','r':'3.5','stroke':'none',
        'pointer-events':'none'});
      group.appendChild(eye);
    }
    image.setAttribute('x',String(point.x-NETWORK_CYCLONE_SIZE_PX/2));
    image.setAttribute('y',String(point.y-NETWORK_CYCLONE_SIZE_PX/2));
    eye.setAttribute('cx',String(point.x));
    eye.setAttribute('cy',String(point.y));
  },{interactive:true,radius:NETWORK_CYCLONE_SIZE_PX/2});
}

export default function TyphoonNetworkSimulator({storm,startDate,currentHour,config,onClose}:NetworkProps){
  const [stage,setStage]=useState<'loading'|'map'|'reference'>('loading');
  const [percent,setPercent]=useState(0);
  const [task,setTask]=useState('读取逐小时历史记录');
  const [error,setError]=useState('');
  const [product,setProduct]=useState<NetworkProduct|null>(null);
  const [reference,setReference]=useState<string|null>(null);
  const [referenceError,setReferenceError]=useState('');
  const [mapMessage,setMapMessage]=useState('');
  const [frame,setFrame]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [basemap,setBasemap]=useState<'amap'|'osm'|'osm-night'>('amap');
  const [providerMenuOpen,setProviderMenuOpen]=useState(false);
  const [exporting,setExporting]=useState(false);
  const rootMapRef=useRef<HTMLDivElement|null>(null);
  const leafletRef=useRef<L.Map|null>(null);
  // Use ONE SVG overlay for dots, paths and wind radii: Canvas vector repaint can
  // lag behind Leaflet DOM markers when a phone pinches/zooms or drags rapidly.
  const networkSvgRendererRef=useRef<L.SVG|null>(null);
  const layersRef=useRef<L.Layer[]>([]);
  const focusRef=useRef<NetworkSvgGlyph|null>(null);
  const liveFixRef=useRef<NetworkFix|null>(null);
  const windRingsRef=useRef<(L.Polygon|null)[]>([null,null,null]);
  const controller=useRef(new AbortController());
  const stormName=getTyphoonDisplayName(storm,currentHour,startDate);
  const ordinal=getTyphoonOrdinalNumber(storm,startDate);
  const raf=()=>new Promise<void>(r=>requestAnimationFrame(()=>r()));
  useEffect(()=>{
    controller.current=new AbortController();let active=true;
    (async()=>{
      try{
        setPercent(5);await raf();
        const history=cmaBoundedNetworkHistory(storm,startDate,currentHour);
        if(!history.length)throw new Error('所选时刻尚无可公开档位的历史台风中心记录');
        if(!active||controller.current.signal.aborted)return;
        setPercent(26);setTask('计算台风移动节点与强度、气压、风圈');await raf();
        const issue=history[history.length-1];
        setPercent(45);setTask('生成多机构模拟预报轨迹');await raf();
        let forecasts:NetworkProduct['forecasts']=[];
        try{forecasts=buildNetworkForecasts(issue,storm,config);}catch(err){
          if(active)setReferenceError(`模拟预测轨迹计算失败：${err instanceof Error?err.message:'未知错误'}`);
        }
        if(!active||controller.current.signal.aborted)return;
        const data={history,issue,forecasts,maxHour:history[history.length-1].simHour};
        setProduct(data);setPercent(65);setTask('准备 NMC 风格台风参考图与地理底图');await raf();
        try{
          // This is the existing R184 NMC plate and retained crash-safe cooperative renderer.
          const ready=await Promise.race([loadNaturalEarthData(),new Promise<boolean>((_,reject)=>window.setTimeout(()=>reject(new Error('地图数据加载超时')),15000))]);
          if(!active||controller.current.signal.aborted)return;
          if(!ready||!(landGeoJson?.features?.length||countriesGeoJson?.features?.length))throw new Error('地理数据未就绪');
          setTask('加载 NMC 国界、省界、河流及中国陆地填色叠加层');
          const optional=await Promise.race([
            loadNmcOptionalGeography(true,true).catch(()=>null),
            new Promise<null>(resolve=>window.setTimeout(()=>resolve(null),12000))
          ]);
          if(!active||controller.current.signal.aborted)return;
          const canvas=document.createElement('canvas');
          const forecast=forecasts[0]?.fixes||[];
          await drawNmcForecastProductCooperative({
            canvas,width:930,typhoonName:stormName,typhoonNumber:String(ordinal),ordinalNumber:ordinal,
            issueDate:dateAt(startDate,issue.simHour),forecastHours:120,issueHour:issue.simHour,startDate,
            current:issue,history:storm.history||[],forecast:forecast.map(x=>({...x,simHour:x.simHour})),
            landGeoJson,countriesGeoJson,coastlineGeoJson:landGeoJson,
            provinceGeoJson:optional?.provinces,riversGeoJson:optional?.rivers,
            showInfoBoxes:true,showCenterBox:true,showForecastBox:true,
            overlayNationalBorders:true,overlayChinaProvinces:true,overlayRivers:true,chinaLandTint:true
          },{signal:controller.current.signal,onProgress:(value:number)=>{if(active)setPercent(Math.max(65,Math.min(93,65+value*.28)));}});
          if(active)setReference(canvas.toDataURL('image/png'));
        }catch(err){if(controller.current.signal.aborted)return;
          if(active)setReferenceError(`NMC 参考图未生成：${err instanceof Error?err.message:'未知错误'}`);
        }
        if(!active||controller.current.signal.aborted)return;
        setPercent(100);setTask('计算完成，按CMA三小时公开档位回放');await raf();
        setStage('map');setFrame(0);setPlaying(history.length>1);
      }catch(err){if(active&&!controller.current.signal.aborted)setError(err instanceof Error?err.message:'模拟产品生成失败');}
    })();
    return ()=>{active=false;controller.current.abort();};
  // The product is frozen at entry; switching to reference and back cannot re-trigger playback.
  },[]);

  // OSM tiles are WGS84; Gaode tiles require GCJ-02 positions over mainland China.
  const displayPoint=(lon:number,lat:number):[number,number]=>
    basemap==='amap'?referenceBasemapLocation('amap',lon,lat,toAmapPosition):[lat,lon];
  // 32x: 3 hours of simulation per 93.75 ms, using discrete CMA slots only.
  // Geographic labels/dots/popup/radii are all owned by the map; only the top
  // summary panel is intentionally screen anchored as in the reference photo.
  useEffect(()=>{
    if(stage!=='map'||!product||!playing)return;
    const timer=window.setInterval(()=>setFrame(last=>{
      if(last>=product.history.length-1){setPlaying(false);return last;}
      return last+1;
    }),93.75);
    return ()=>window.clearInterval(timer);
  },[stage,product,playing]);

  /** User interruption updates simulation time without moving the camera.
   * Only the playback timer itself follows the cyclone; a point click must never
   * jump to the final advisory or auto-pan to fit a popup. */
  const finishReplay=()=>{
    if(!playing||!product)return;
    setFrame(product.history.length-1);setPlaying(false);
    // Keep the map viewport exactly where the user stopped it.
  };
  const finishReplayRef=useRef(finishReplay);
  finishReplayRef.current=finishReplay;
  useEffect(()=>{
    if(stage!=='map')return;
    // Interruption is user input, never an SDK-driven camera update.
    const nodes=[rootMapRef.current].filter((item):item is HTMLDivElement=>item!==null);
    // User gestures cancel playback without moving the camera to the end fix.
    const skip=()=>finishReplayRef.current();
    for(const node of nodes)for(const name of ['pointerdown','wheel','touchstart'])node.addEventListener(name,skip,{passive:true});
    return ()=>{for(const node of nodes)for(const name of ['pointerdown','wheel','touchstart'])node.removeEventListener(name,skip);};
  },[stage,product]);
  /** Leaflet native popup is anchored in map coordinates; its arrow targets the clicked dot.
   * This also avoids the global charcoal dialog overlay and washed-out text. */
  const openLeafletDetails=(fix:NetworkFix,agency?:string)=>{
    const map=leafletRef.current;
    if(!map)return;
    finishReplay();
    map.closePopup();
    const popup=L.popup({className:agency?'tn-map-popup tn-agency-popup':'tn-map-popup',autoPan:false,autoPanPadding:[12,12],
      closeButton:false,offset:L.point(0,0),minWidth:Math.min(300,Math.max(232,window.innerWidth-48)),
      maxWidth:Math.min(390,window.innerWidth-30)});
    popup.setLatLng(displayPoint(fix.lon,fix.lat));
    popup.setContent(renderToStaticMarkup(<Details fix={fix} name={stormName} startDate={startDate} agency={agency}/>));
    popup.openOn(map);
  };
  // Keep the single Gaode Leaflet viewport mounted while reference is open.
  useEffect(()=>{
    if(stage!=='map'||!product||!rootMapRef.current)return;
    if(!leafletRef.current){
      // Remove Leaflet's bottom-right attribution box: global mobile control rules
      // expanded its links and backdrop into an opaque map-covering panel.
      // A small Gaode credit is rendered at the lower-left of the map.
      const map=L.map(rootMapRef.current,{zoomControl:false,attributionControl:false,preferCanvas:false,scrollWheelZoom:true,zoomSnap:0,zoomDelta:0.25});
      networkSvgRendererRef.current=L.svg({padding:0.65});
      networkSvgRendererRef.current.addTo(map);

      map.setView(displayPoint(product.history[0].lon,product.history[0].lat),5);
      leafletRef.current=map;
      setTimeout(()=>map.invalidateSize(),10);
    }
    const map=leafletRef.current;
    // Day = reference Gaode raster, night = OSM raster with a local dark style.
    // No unlicensed CARTO dark tile endpoints or API-key bypasses.
    // Night uses ORIGINAL WGS84 geographic points, not Gaode's GCJ-02.
    map.eachLayer(layer=>{if(layer instanceof L.TileLayer)map.removeLayer(layer);});
    const rasterLayer=basemap==='amap'?createReferenceRasterLayer(L,'amap'):
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
        minZoom:1,maxZoom:19,tileSize:256,keepBuffer:3,
        className:basemap==='osm-night'?'tn-osm-night-tiles':'tn-osm-day-tiles',
        attribution:'© OpenStreetMap contributors'
      });
    let cancelled=false;let tileFailures=0;
    rasterLayer.on('tileerror',()=>{
      if(cancelled||++tileFailures<6)return;
      setMapMessage(basemap==='amap'?'高德地图瓦片暂时无法加载，请检查网络或图源授权。':basemap==='osm-night'?'OSM Night 瓦片加载受限，请检查网络与图源服务。':'OSM 地图瓦片加载受限，请检查网络与图源服务。');
    });
    rasterLayer.addTo(map);
    map.getContainer().style.background=basemap==='amap'?'#f7f7f7':basemap==='osm-night'?'#15222d':'#e9e7e2';
    // Switching providers must also reproject the map centre. All geometries
    // below are drawn from immutable original WGS84 fixes.
    if(basemap!=='amap')map.setView([product.history[Math.min(frame,product.history.length-1)].lat,product.history[Math.min(frame,product.history.length-1)].lon],map.getZoom(),{animate:false});
    else map.setView(referenceBasemapLocation('amap',product.history[Math.min(frame,product.history.length-1)].lon,product.history[Math.min(frame,product.history.length-1)].lat,toAmapPosition),map.getZoom(),{animate:false});
    window.setTimeout(()=>map.invalidateSize(),40);
    layersRef.current.forEach(x=>map.removeLayer(x));layersRef.current=[];
    const hist=product.history;
    for(const segment of networkHistorySegments(hist)){
      layersRef.current.push(L.polyline([displayPoint(segment.from.lon,segment.from.lat),displayPoint(segment.to.lon,segment.to.lat)],
        {renderer:networkSvgRendererRef.current??undefined,color:segment.color,weight:2.5,opacity:.96,noClip:true,smoothFactor:0,lineCap:'round',lineJoin:'round'}).addTo(map));
    }
    // Draw ALL forecast polylines beneath the marker layer, regardless of agency.
    // CMA lines must never cut through another agency's dot in a crowded forecast.
    const orderedForecasts=networkForecastDrawOrder(product.forecasts);
    for(const f of orderedForecasts){
      if(!f.fixes.length)continue;
      // Each straight dashed edge joins two VISIBLE dots; hidden 3h points cannot bend the line.
      for (const segment of networkForecastSegments(product.issue,f)) {
        layersRef.current.push(L.polyline([displayPoint(segment.from.lon,segment.from.lat),displayPoint(segment.to.lon,segment.to.lat)],
          {renderer:networkSvgRendererRef.current??undefined,color:segment.color,weight:f.agency==='中国'?2.3:1.6,dashArray:'2,6',opacity:.96,noClip:true,smoothFactor:0,lineCap:'round',lineJoin:'round'}).addTo(map));
      }
    }
    // Hit targets are kept BELOW all visible dots. This avoids the enlarged
    // transparent hit area of a later agency stealing taps from a visible dot.
    for(const f of orderedForecasts){
      if(f.agency==='中国'||!f.fixes.length)continue;
      for(const point of networkVisibleForecastFixes(f,product.issue)){
        const hit=L.circleMarker(displayPoint(point.lon,point.lat),{
          renderer:networkSvgRendererRef.current??undefined,
          radius:NETWORK_OTHER_AGENCY_HIT_RADIUS_PX,stroke:false,fill:true,
          fillColor:'#ffffff',fillOpacity:0.001,interactive:true,
        }).addTo(map);
        hit.on('click',()=>openLeafletDetails(point,f.agency));
        layersRef.current.push(hit);
      }
    }
    for (let i=0;i<hist.length;i++){
      const p=hist[i];
      const marker=L.circleMarker(displayPoint(p.lon,p.lat),{renderer:networkSvgRendererRef.current??undefined,radius:NETWORK_DOT_RADIUS_PX,stroke:true,color:NETWORK_DOT_OUTLINE_COLOR,opacity:NETWORK_DOT_OUTLINE_OPACITY,weight:NETWORK_HISTORY_DOT_STROKE_PX,fillColor:networkPointColor(p.vmax,p.category),fillOpacity:1}).addTo(map);
      marker.on('click',()=>openLeafletDetails(p));layersRef.current.push(marker);
    }
    // Ordinary agency points first, larger CMA fixes last: visually clear hierarchy.
    for(const f of orderedForecasts){
      if(!f.fixes.length)continue;
      const visible=networkVisibleForecastFixes(f,product.issue);
      for(let i=0;i<visible.length;i++){
        const point=visible[i];
        const mark=L.circleMarker(displayPoint(point.lon,point.lat),{renderer:networkSvgRendererRef.current??undefined,radius:f.agency==='中国'?NETWORK_CMA_DOT_RADIUS_PX:NETWORK_OTHER_AGENCY_DOT_RADIUS_PX,stroke:true,color:NETWORK_DOT_OUTLINE_COLOR,opacity:NETWORK_DOT_OUTLINE_OPACITY,weight:f.agency==='中国'?NETWORK_CMA_DOT_STROKE_PX:NETWORK_OTHER_DOT_STROKE_PX,fillColor:networkForecastDotColor(point),fillOpacity:1}).addTo(map);
        mark.on('click',()=>openLeafletDetails(point,f.agency));layersRef.current.push(mark);
        const lead=point.simHour-product.issue.simHour;
        if(f.agency==='中国' && [6,12,24,36,48,60,72,96,120].includes(Math.round(lead)) && Math.abs(Math.round(lead)-lead)<.1){
          const force=getWindForceCategory(point.vmax);
          // Shared map SVG root: prevents DOM divIcon lag and its grey glass tile.
          const label=geographicLead(map,displayPoint(point.lon,point.lat),networkSvgRendererRef.current!,lead,force);
          layersRef.current.push(label);
        }
      }
    }
    return ()=>{cancelled=true;layersRef.current.forEach(x=>map.removeLayer(x));layersRef.current=[];
    };
  },[stage,product,basemap]);
  useEffect(()=>{
    // The day/night basemap coordinate frame changes (GCJ-02 vs WGS84).
    // Discard previous frame glyphs/rings so their paths are rebuilt at the
    // new geographic locations rather than retaining old projected points.
    focusRef.current?.remove();focusRef.current=null;
    windRingsRef.current.forEach(r=>r?.remove());windRingsRef.current=[null,null,null];
  },[basemap]);
  useEffect(()=>{
    // Keep one geographic marker and three persistent SVG ring paths while stepping.
    // Replacing them every 93.75ms restarts the cyclone spin and can flicker or lag
    // compared with the map during mobile pinch gestures.
    if(stage!=='map'||!product||!leafletRef.current){
      focusRef.current?.remove();focusRef.current=null;liveFixRef.current=null;
      windRingsRef.current.forEach(r=>r?.remove());windRingsRef.current=[null,null,null];
      return;
    }
    const map=leafletRef.current, fix=product.history[Math.min(frame,product.history.length-1)];
    if(!fix)return;
    liveFixRef.current=fix;
    const currentPoint=displayPoint(fix.lon,fix.lat);
    if(!focusRef.current){
      focusRef.current=geographicCyclone(map,currentPoint,networkSvgRendererRef.current!,fix);
      focusRef.current.on('click',()=>{if(liveFixRef.current)openLeafletDetails(liveFixRef.current);});
    }else{
      focusRef.current.setLatLng(currentPoint);
    }
    const glyph=focusRef.current._networkGlyph;
    // While replaying, only the intensity dot is visible; after completion or
    // interruption, reveal the original 0.5 rev/s counterclockwise icon.
    glyph?.querySelector('circle')?.setAttribute('fill',networkPointColor(fix.vmax,fix.category));
    glyph?.querySelector('circle')?.setAttribute('r',String(playing?NETWORK_DOT_RADIUS_PX:3.5));
    glyph?.querySelector('image')?.setAttribute('visibility',playing?'hidden':'visible');
    const fields=['r7','r10','r12'] as const;
    const colors=NETWORK_WIND_RING_COLORS;
    for(let i=0;i<fields.length;i++){
      const field=fields[i];
      const visible=shouldDrawNetworkWindRadii(fix)&&Object.values(fix[field]||{}).some(v=>Number(v)>0);
      if(!visible){windRingsRef.current[i]?.remove();windRingsRef.current[i]=null;continue;}
      const vertices=windRing(fix,field).map(([lat,lon])=>displayPoint(lon,lat));
      if(windRingsRef.current[i])windRingsRef.current[i]!.setLatLngs(vertices);
      else windRingsRef.current[i]=smoothWindPolygon(map,vertices,{renderer:networkSvgRendererRef.current??undefined,color:colors[i],weight:0.76,opacity:.94,lineJoin:'round',lineCap:'round',smoothFactor:0,fillColor:colors[i],fillOpacity:.13,interactive:false}).addTo(map);
    }
    // Keep the cyclone above rings; all SVG objects share the same transform.
    const foreground=focusRef.current?._networkGlyph;
    foreground?.parentNode?.appendChild(foreground);
    if(playing){
      // Follow the center with 1000km across the entire viewport at this latitude.
      // A fractionally zoomed, non-animated setView avoids camera easing/lag.
      map.setView(currentPoint,networkReplayZoomForWidth(map.getSize().x,fix.lat),{animate:false});
    }
  },[frame,stage,product,playing,basemap]);
  useEffect(()=>()=>{
    focusRef.current?.remove();focusRef.current=null;
    windRingsRef.current.forEach(r=>r?.remove());windRingsRef.current=[null,null,null];
    leafletRef.current?.remove();leafletRef.current=null;networkSvgRendererRef.current=null;
  },[]);
  const latest=product?.history[product.history.length-1]||null;
  const replayFromStart=()=>{
    if(!product?.history.length)return;
    leafletRef.current?.closePopup();
    setFrame(0);setPlaying(product.history.length>1);
    const first=product.history[0];
    leafletRef.current?.setView(displayPoint(first.lon,first.lat),
      networkReplayZoomForWidth(leafletRef.current.getSize().x,first.lat),{animate:false});
  };
  const centerLatest=()=>{
    if(!latest||!leafletRef.current)return;
    finishReplay();
    const fix=product?.history[product.history.length-1]||latest;
    leafletRef.current.setView(displayPoint(fix.lon,fix.lat),leafletRef.current.getZoom(),{animate:false});
  };
  const exportSnapshot=async()=>{
    if(!product||exporting)return;
    setExporting(true);
    try{
      await downloadStandaloneNetworkHtml({product,typhoonName:stormName,ordinal,startTimeISO:startDate.toISOString(),nmcImage:reference});
    }catch(err){setMapMessage(`HTML 导出失败：${err instanceof Error?err.message:String(err)}`);}
    finally{setExporting(false);}
  };
  return <div className="tn-viewport" role="dialog" aria-modal="true" aria-label="台风网模拟"
    onClickCapture={event=>{
      if(!(event.target instanceof Element))return;
      if(event.target.closest('.tn-provider-wrapper'))return;
      setProviderMenuOpen(false);
      if(!event.target.closest('.tn-detail-close'))return;
      event.preventDefault();event.stopPropagation();
      leafletRef.current?.closePopup();
      }}>
    {stage==='loading'? <div className="tn-loading">
      <div className="tn-loading-title">台风网模拟</div>
      <div className="tn-loading-caption">正在准备历史节点、模拟预报与参考图片</div>
      <div className="tn-progress"><div style={{width:`${percent}%`}}/></div>
      <div className="tn-progress-caption" aria-live="polite">{task} · {Math.round(percent)}%</div>
      {error&&<div className="tn-error" role="alert">{error}</div>}
      <button onClick={onClose}>返回产品中心</button>
    </div>:<>
      <header className={`tn-header${stage==='reference'?' tn-header-reference':''}`}>
        <button id="tn-network-back" className="tn-back" type="button" aria-label="返回" onClick={()=>{setProviderMenuOpen(false);if(stage==='reference'){setStage('map');}else onClose();}}><svg viewBox="0 0 48 48"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button>
        {stage==='map'&&<div className="tn-provider-wrapper">
          <button id="tn-network-switch" className="tn-switch" type="button" aria-label="切换地图商" aria-expanded={providerMenuOpen} aria-controls="tn-provider-menu" onClick={()=>setProviderMenuOpen(value=>!value)}><span className="tn-switch-first">切换</span><span className="tn-switch-second">地图商</span></button>
          {providerMenuOpen&&<div id="tn-provider-menu" className="tn-provider-menu" role="menu" aria-label="选择地图商">
            {([{id:'amap',label:'高德地图'},{id:'osm',label:'OSM 普通地图'},{id:'osm-night',label:'OSM Night 夜间地图'}] as const).map(option=><button key={option.id} type="button" role="menuitemradio" aria-checked={basemap===option.id} className={basemap===option.id?'is-selected':''} onClick={()=>{setBasemap(option.id);setProviderMenuOpen(false);}}>{option.label}{basemap===option.id?' ✓':''}</button>)}
          </div>}
        </div>}
        <div className="tn-header-title">{stage==='reference'?'台风参考':'健茂台风路径'}</div>
        {stage==='map'&&<>
          <button className="tn-header-action tn-share-action" type="button" title="分享：下载完整离线HTML快照" aria-label="下载台风网独立HTML" disabled={exporting} onClick={exportSnapshot}><img src="/network-icons/network-share.png" alt=""/></button>
          <button id="tn-network-reference-icon" className="tn-reference-link tn-header-action" type="button" aria-label="台风参考" onClick={()=>{leafletRef.current?.closePopup();finishReplay();setStage('reference');}}><img src="/network-icons/network-reference-white.png" alt=""/></button>
          <button className="tn-header-action tn-history-action" type="button" aria-label="历史图标（预留）" title="历史图标（预留）"><img src="/network-icons/network-history.png" alt=""/></button>
        </>}
      </header>
      {product&&<div className="tn-map" ref={rootMapRef} style={{visibility:stage==='map'?'visible':'hidden'}}/>}
      {stage==='map'&&product&&latest&&<>
        <div className="tn-ticker" aria-label="台风当前资料">
          <div>第{ordinal}号　{stormName} {fmtDate(dateAt(startDate,latest.simHour))}</div>
          <div>风级:{getWindForceCategory(latest.vmax)}级　风速:{num(latest.vmax)}m/s 等级:{grade(latest.vmax,latest.category)}　气压:{num(latest.pmin)}hPa</div>
          <div>经纬度：{num(latest.lon,1)}°,{num(latest.lat,1)}°　移向/移速：{compass(latest.direction)},{num(latest.speed)}公里/小时</div>
          <b className={latest.dissipated?'tn-status-ended':'tn-status-active'}>{latest.dissipated?'【已停编】':'【生效中】'}</b>
        </div>
        <a className={basemap==='osm-night'?'tn-osm-credit tn-credit-night':'tn-osm-credit'} href={basemap==='amap'?'https://www.amap.com/':'https://www.openstreetmap.org/copyright'} target="_blank" rel="noopener noreferrer" aria-label="地图版权信息">{basemap==='amap'?REFERENCE_RASTER_CREDIT:'© OpenStreetMap contributors'}</a>
        <div className="tn-right-tools">
          <button className="tn-floating-button" title="快捷切换：高德地图 / OSM Night" aria-label="切换高德与 OSM Night" onClick={()=>setBasemap(value=>value==='amap'?'osm-night':'amap')}><img src="/network-icons/network-daynight.png" alt=""/></button>
          <button className="tn-floating-button" title="信号灯（暂未启用）" aria-label="信号灯（预留）"><img src="/network-icons/network-traffic.png" alt=""/></button>
          <button className="tn-floating-button" title="台风中心居中" aria-label="回正台风中心" onClick={centerLatest}><img src="/network-icons/network-locate.png" alt=""/></button>
        </div>
        <button className="tn-replay-button" title="从头重放32倍速动画" aria-label="刷新重放" onClick={replayFromStart}><img src="/network-icons/network-replay.png" alt=""/></button>
        {mapMessage&&<div className="tn-map-error" role="status" onClick={()=>setMapMessage('')}>{mapMessage}</div>}
      </>}
      {stage==='reference'&&<main className="tn-reference-page">
        {reference?<img className="tn-nmc-img" src={reference} alt="Round184 NMC 风格台风路径概率模拟预报图"/>:
          <div className="tn-reference-error">{referenceError||'暂无预报图数据'}</div>}
      </main>}
    </>}
  </div>;
}
