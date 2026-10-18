/** R208: self-contained, dependency-free HTML snapshot of a frozen simulated advisory.
 * No dynamic script/style/map-tile URLs are required to open the downloaded file.
 * It embeds the NMC PNG, forecast/history fixes, map outline and control artwork.
 * This is a read-only export, NOT a runnable copy of the physics simulator.
 */
import type { NetworkProduct } from './TyphoonNetworkData';

export type StandaloneNetworkPayload = {
  product: NetworkProduct;
  typhoonName: string;
  ordinal: number | string;
  startTimeISO: string;
  nmcImage: string | null;
};

async function urlToDataUri(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源读取失败：${url} (${response.status})`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/** Testable, strict JSON embedding: closing SCRIPT tags cannot escape the payload. */
export function safeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const CONTROL_FILES = {
  share:'network-share.png', reference:'network-reference-white.png', history:'network-history.png',
  night:'network-daynight.png', traffic:'network-traffic.png', locate:'network-locate.png',
  replay:'network-replay.png', cyclone:'cyclone-blue.png'
} as const;

/** Network tiles are NOT embedded. For true file:// portability this viewer draws
 * embedded offline coastline polygons instead. Third-party map tiles may not be
 * redistributed, and crossorigin tile images cannot reliably be read from Canvas.
 */
export async function buildStandaloneNetworkHtml(payload: StandaloneNetworkPayload): Promise<string> {
  const art: Record<string,string> = {};
  const icons = await Promise.all(Object.entries(CONTROL_FILES).map(async ([key, filename]) => {
    try { return [key, await urlToDataUri(`/network-icons/${filename}`)] as const; }
    catch { return [key, ''] as const; }
  }));
  for (const [key, uri] of icons) art[key] = uri;
  let coastline: unknown = { type: 'FeatureCollection', features: [] };
  try {
    const response = await fetch('/data/pacific_land_lite.geojson');
    if (response.ok) coastline = await response.json();
  } catch { /* The standalone graph and NMC plate still work without coastlines. */ }
  const packed = safeEmbeddedJson({ ...payload, art, coastline });
  return STANDALONE_TEMPLATE.replace('__AETHER_EMBEDDED_PAYLOAD__', packed);
}

export async function downloadStandaloneNetworkHtml(payload: StandaloneNetworkPayload): Promise<void> {
  const html = await buildStandaloneNetworkHtml(payload);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `AETHER_台风网模拟_${String(payload.ordinal).replace(/[^\w\u4e00-\u9fff-]/g,'')}_${payload.product.issue.simHour}h_离线快照.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const STANDALONE_TEMPLATE = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<title>AETHER 台风网模拟 · 离线快照</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif;background:#99d0f1;color:#111}
button{font:inherit;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:2px solid #fff;outline-offset:2px}
header{height:46px;display:grid;grid-template-columns:45px minmax(0,1fr) repeat(3,35px);align-items:center;gap:4px;padding:0 5px;background:#00c91a;color:#fff;position:absolute;top:0;left:0;right:0;z-index:30}
header button{appearance:none;border:0!important;background:transparent!important;background-image:none!important;box-shadow:none!important;color:#fff;cursor:pointer;display:grid;place-items:center;width:35px;height:43px;padding:0;margin:0;min-width:0;border-radius:0;filter:none!important;backdrop-filter:none!important}
#back{width:45px;height:43px;grid-column:1;grid-row:1}
#back svg{display:block;width:34px;height:34px}
header h1{grid-column:2;grid-row:1;font-size:clamp(18px,5.1vw,25px);font-weight:400;line-height:1.14;text-align:center;margin:0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#share{grid-column:3;grid-row:1}#reference{grid-column:4;grid-row:1}#history{grid-column:5;grid-row:1}
header button img{display:block;width:34px;height:34px;object-fit:contain;background:transparent!important;box-shadow:none!important}
#map{position:absolute;top:46px;bottom:0;left:0;right:0;touch-action:none;overflow:hidden;background:#9fd1ff}canvas{display:block;width:100%;height:100%}
#ticker{position:absolute;top:47px;left:0;right:0;padding:0 7px 0 5px;z-index:2;pointer-events:none;text-align:right;color:#112ba5;font-size:clamp(12.5px,3.5vw,16.5px);line-height:1.24;font-weight:400}
#ticker>div{white-space:nowrap}#state{color:#e50019;text-align:center;font-weight:500;font-size:clamp(15px,3.6vw,18px);margin-top:5px}
#right{position:absolute;right:9px;top:67%;display:flex;flex-direction:column;gap:5px;z-index:4;background:transparent!important}
#left{position:absolute;left:9px;bottom:calc(52px + env(safe-area-inset-bottom,0px));z-index:4;background:transparent!important}
.control{appearance:none;display:grid;place-items:center;cursor:pointer;border:0!important;background:transparent!important;background-image:none!important;box-shadow:none!important;filter:none!important;backdrop-filter:none!important;padding:0;margin:0;width:38px;height:38px;min-width:38px;min-height:38px;border-radius:9px;overflow:hidden}
.control img{display:block;width:100%;height:100%;object-fit:fill;aspect-ratio:1/1;background:transparent!important;box-shadow:none!important}
#left .control{width:46px;height:46px;min-width:46px;min-height:46px;border-radius:50%}
.credit{position:absolute;left:7px;bottom:calc(9px + env(safe-area-inset-bottom,0px));font:400 9px/1.1 Arial,sans-serif;color:#3b5360;opacity:.58;pointer-events:none;z-index:2}
#detail{position:absolute;z-index:5;background:#fff;color:#161616;padding:10px 12px;border:1px solid #999;border-radius:6px;box-shadow:0 2px 8px #0003;min-width:230px;max-width:calc(100vw - 24px);font-size:13px;white-space:pre-line;display:none;pointer-events:auto}
#detail button{float:right;background:transparent;border:none;color:#888;font-size:17px}#detail:after{content:'';position:absolute;bottom:-9px;left:calc(50% - 9px);border-left:9px solid transparent;border-right:9px solid transparent;border-top:9px solid white}
#ref{display:none;position:absolute;top:46px;bottom:0;overflow:auto;width:100%;background:#000;text-align:center;z-index:3}#ref img{max-width:100%;height:auto;display:block;margin:0 auto}#ref .error{color:#fff;padding:22px}
/* A quiet export disclaimer replaces the fixed information panel that used
   to overlap the map and has no equivalent in the reference screenshots. */
#notice{position:absolute;left:50%;bottom:9px;transform:translateX(-50%);z-index:3;color:#415e6e;opacity:.65;white-space:nowrap;font-size:9px;pointer-events:none;text-align:center}
@media(max-width:375px){header{grid-template-columns:42px minmax(0,1fr) repeat(3,32px);gap:2px}header button:not(#back){width:32px}header button img{width:30px;height:30px}header h1{font-size:clamp(18px,5.1vw,23px)}#ticker{font-size:clamp(11.5px,3.5vw,13.5px)}}
@media(min-width:800px){header{height:54px;grid-template-columns:51px minmax(0,1fr) repeat(3,35px)}#back{width:51px;height:50px}#map{top:54px}#ref{top:54px}#ticker{top:58px}}
</style></head><body>
<script type="application/json" id="aether-data">__AETHER_EMBEDDED_PAYLOAD__</script>
<header><button id="back" aria-label="返回地图"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="white" d="M23 3 1 24l22 21v-12h24V16H23Z"/></svg></button><h1 id="heading">健茂台风路径</h1><button id="share" title="导出当前 HTML" aria-label="保存"><img id="shareicon"></button><button id="reference" aria-label="台风参考"><img id="referenceicon"></button><button id="history" aria-label="历史图标"><img id="historyicon"></button></header>
<div id="map"><canvas id="c"></canvas></div><div id="ticker"></div>
<div id="right"><button class="control" id="night" title="切换昼夜"><img id="nighticon"></button><button class="control" id="traffic" title="信号灯，仅展示"><img id="trafficicon"></button><button class="control" id="locate" title="回到台风中心"><img id="locateicon"></button></div>
<div id="left"><button class="control" id="replay" title="重新播放"><img id="replayicon"></button></div>
<div class="credit">模拟资料 · 本文件自带地图海岸线及 NMC 预报图，不请求地图瓦片</div><div id="detail"></div>
<div id="notice">虚拟模拟 · 非官方预报</div>
<div id="ref"><div class="error" id="referror"></div><img id="nmc"></div>
<script>
'use strict';
const data=JSON.parse(document.getElementById('aether-data').textContent);
for(const key of ['share','reference','history','night','traffic','locate','replay']){const img=document.getElementById(key+'icon');if(data.art[key])img.src=data.art[key]}
const product=data.product,history=product.history||[],forecasts=product.forecasts||[],canvas=document.getElementById('c'),ctx=canvas.getContext('2d'),mapEl=document.getElementById('map'),detail=document.getElementById('detail');
let dpr=1,w=0,h=0,lat=history.length?history[history.length-1].lat:20,lon=history.length?history[history.length-1].lon:125;
let span=1000,night=false,frame=history.length-1,playing=false,replayHandle=null,selected=null;
const mc=(a)=>Math.log(Math.tan(Math.PI/4+Math.max(-80,Math.min(80,a))*Math.PI/360));
function mapPoint(la,lo){const sx=w/(span/111.195/Math.max(.12,Math.cos(lat*Math.PI/180)));return [w/2+((lo-lon+540)%360-180)*sx,h/2-(mc(la)-mc(lat))*sx*180/Math.PI]}
function resize(){const r=mapEl.getBoundingClientRect();w=r.width;h=r.height;dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);draw()}
function grade(v){return v<17.2?7:v<24.5?8:v<32.7?10:v<41.5?12:v<51?14:16}
function color(p){const v=p.vmax;return !Number.isFinite(v)?'#888':v<17.2?'#00ce3a':v<24.5?'#0639f5':v<32.7?'#ff8b12':v<41.5?'#ff161d':v<51?'#eb08dd':'#8320d6'}
function drawLand(){ctx.fillStyle=night?'#242e35':'#fffdf7';ctx.strokeStyle=night?'#43545b':'#b0bbc3';ctx.lineWidth=.55;
  for(const feature of data.coastline?.features||[]){const g=feature.geometry;if(!g)continue;let polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];for(const poly of polys){ctx.beginPath();for(const ring of poly){let first=true;for(let i=0;i<ring.length;i++){const p=ring[i],v=mapPoint(p[1],p[0]);if(first){ctx.moveTo(...v);first=false}else ctx.lineTo(...v)}ctx.closePath()}ctx.fill('evenodd');ctx.stroke()}}
}
function segment(a,b,stroke,width,dash=[]){const x=mapPoint(a.lat,a.lon),y=mapPoint(b.lat,b.lon);ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(...x);ctx.lineTo(...y);ctx.stroke();ctx.setLineDash([])}
function rings(f){for(const [key,stroke] of [['r7','#00ad2a'],['r10','#dfff6b'],['r12','#c41618']]){const rr=f[key];if(!rr)continue;const qs=['ne','se','sw','nw'];ctx.beginPath();let once=true;for(let j=0;j<4;j++){const r=Math.max(0,rr[qs[j]]||0);for(let i=0;i<=120;i++){const rad=(j*90+i*90/120)*Math.PI/180;const y=f.lat+r*Math.cos(rad)/111.195,x=f.lon+r*Math.sin(rad)/(111.195*Math.max(.12,Math.cos(f.lat*Math.PI/180)));const p=mapPoint(y,x);if(once){ctx.moveTo(...p);once=false}else ctx.lineTo(...p)}}ctx.closePath();ctx.strokeStyle=stroke;ctx.fillStyle=stroke;ctx.globalAlpha=.11;ctx.fill();ctx.globalAlpha=1;ctx.lineWidth=.8;ctx.stroke()}}
function dot(f,size){const p=mapPoint(f.lat,f.lon);ctx.beginPath();ctx.arc(p[0],p[1],size/2,0,Math.PI*2);ctx.fillStyle=color(f);ctx.fill();ctx.strokeStyle='#ffffff65';ctx.lineWidth=.45;ctx.stroke()}
function draw(){if(!w||!h)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=night?'#12212c':'#a1d2fd';ctx.fillRect(0,0,w,h);drawLand();
 for(let i=1;i<history.length;i++)segment(history[i-1],history[i],color(history[i]),2.1);
 for(const f of forecasts){let last=product.issue;for(const fix of f.fixes.filter(p=>[6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120].some(v=>Math.abs(v-(p.simHour-product.issue.simHour))<.01))){segment(last,fix,f.color,f.agency==='中国'?1.8:1.3,[2,5]);last=fix}}
 const fixed=history[Math.max(0,Math.min(frame,history.length-1))];if(fixed)rings(fixed);
 for(const p of history)dot(p,8.8);
 for(const f of forecasts){for(const p of f.fixes.filter(p=>[6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120].some(v=>Math.abs(v-(p.simHour-product.issue.simHour))<.01))){dot(p,f.agency==='中国'?8.8:4);if(f.agency==='中国'){const pt=mapPoint(p.lat,p.lon),lead=Math.round(p.simHour-product.issue.simHour);ctx.save();ctx.font='600 9px Arial,Microsoft YaHei,sans-serif';ctx.lineWidth=.85;ctx.strokeStyle='#303030';ctx.fillStyle='#fff';ctx.lineJoin='round';ctx.textBaseline='alphabetic';const label=lead+'h/'+(p.vmax>=56.1?'17级以上':grade(p.vmax)+'级');ctx.strokeText(label,pt[0]-26,pt[1]+16);ctx.fillText(label,pt[0]-26,pt[1]+16);ctx.restore()}}}
 if(fixed){const pt=mapPoint(fixed.lat,fixed.lon);if(!playing&&cycloneImage.complete&&cycloneImage.naturalWidth){ctx.drawImage(cycloneImage,pt[0]-12,pt[1]-12,24,24)}dot(fixed,6.6)}
 if(selected){const pt=mapPoint(selected.fix.lat,selected.fix.lon);detail.style.left=Math.max(8,Math.min(w-detail.offsetWidth-8,pt[0]-detail.offsetWidth/2))+'px';detail.style.top=Math.max(60,Math.min(h-detail.offsetHeight-22,pt[1]-detail.offsetHeight-13))+'px'}
}
const cycloneImage=new Image();cycloneImage.onload=draw;cycloneImage.src=data.art.cyclone||'';
function tick(){const p=history[Math.min(frame,history.length-1)];if(!p)return;const date=new Date(Date.parse(data.startTimeISO)+p.simHour*3600000+8*3600000);const ts=date.getUTCFullYear()+'年'+(date.getUTCMonth()+1)+'月'+date.getUTCDate()+'日'+String(date.getUTCHours()).padStart(2,'0')+'时';document.getElementById('ticker').innerHTML='<div>第'+data.ordinal+'号　'+data.typhoonName+' '+ts+'</div><div>风级:'+grade(p.vmax)+'级　风速:'+Math.round(p.vmax)+'m/s 等级:'+grade(p.vmax)+'级　气压:'+Math.round(p.pmin)+'hPa</div><div>经纬度：'+p.lon.toFixed(1)+'°,'+p.lat.toFixed(1)+'°　移向/移速：'+Math.round(p.direction)+'°,'+Math.round(p.speed)+'公里/小时</div><div id="state">'+(p.dissipated?'【已停编】':'【生效中】')+'</div>'}
function stop(){if(replayHandle)clearInterval(replayHandle);replayHandle=null;playing=false;frame=history.length-1;tick();draw()}
function run(){if(replayHandle)clearInterval(replayHandle);if(!history.length)return;playing=true;frame=0;span=1000;detail.style.display='none';selected=null;lat=history[0].lat;lon=history[0].lon;tick();draw();replayHandle=setInterval(()=>{frame++;if(frame>=history.length-1){stop();return}lat=history[frame].lat;lon=history[frame].lon;tick();draw()},93.75)}
function recenter(){stop();const p=history[history.length-1];if(p){lat=p.lat;lon=p.lon;draw()}}
document.getElementById('night').onclick=()=>{night=!night;draw()};document.getElementById('locate').onclick=recenter;document.getElementById('replay').onclick=run;
document.getElementById('traffic').onclick=()=>{};document.getElementById('history').onclick=()=>{};
function showReference(show){document.getElementById('ref').style.display=show?'block':'none';document.getElementById('map').style.display=show?'none':'block';document.getElementById('ticker').style.display=show?'none':'block';document.getElementById('right').style.display=show?'none':'grid';document.getElementById('left').style.display=show?'none':'block';document.getElementById('heading').textContent=show?'台风参考':'健茂台风路径';if(!show)resize()}
document.getElementById('reference').onclick=()=>{stop();showReference(true)};document.getElementById('back').onclick=()=>showReference(false);
document.getElementById('share').onclick=()=>{const blob=new Blob(['<!doctype html>\n'+document.documentElement.outerHTML],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='台风网模拟_离线快照.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
const nmc=document.getElementById('nmc');if(data.nmcImage)nmc.src=data.nmcImage;else document.getElementById('referror').textContent='此存档未能生成 NMC 图片';
let pDown=null;canvas.addEventListener('pointerdown',e=>{if(playing)stop();pDown={x:e.clientX,y:e.clientY,lon,lat};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!pDown)return;const k=span/111.195/Math.max(.12,Math.cos(lat*Math.PI/180))/w;lon=pDown.lon-(e.clientX-pDown.x)*k;lat=pDown.lat+(e.clientY-pDown.y)*k;draw()});
canvas.addEventListener('pointerup',e=>{const a=pDown;pDown=null;if(!a||Math.hypot(e.clientX-a.x,e.clientY-a.y)>8)return;const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let best=null,dist=18;
for(const f of forecasts){for(const fix of f.fixes){if(![6,12,18,24,30,36,42,48,54,60,66,72,84,96,108,120].includes(Math.round(fix.simHour-product.issue.simHour)))continue;const pt=mapPoint(fix.lat,fix.lon);const d=Math.hypot(pt[0]-x,pt[1]-y);if(d<dist){dist=d;best={fix,agency:f.agency}}}}
for(const fix of history){const pt=mapPoint(fix.lat,fix.lon),d=Math.hypot(pt[0]-x,pt[1]-y);if(d<dist){dist=d;best={fix,agency:null}}}
selected=best;if(best){const f=best.fix;detail.textContent='';const close=document.createElement('button');close.textContent='×';close.onclick=()=>{selected=null;detail.style.display='none'};detail.appendChild(close);const content=document.createElement('div');content.textContent=(best.agency?'预测机构：【'+best.agency+'】':data.typhoonName)+'\n中心位置：'+f.lon.toFixed(1)+'°E，'+f.lat.toFixed(1)+'°N\n最大风力：'+Math.round(f.vmax)+'米/秒\n中心气压：'+Math.round(f.pmin)+'百帕\n模拟资料 · 仅供娱乐与分析';detail.appendChild(content);detail.style.display='block';draw()}else detail.style.display='none';});
canvas.addEventListener('wheel',e=>{e.preventDefault();if(playing)stop();span=Math.max(100,Math.min(24000,span*(e.deltaY>0?1.25:.8)));draw()},{passive:false});
window.addEventListener('resize',resize);resize();tick();draw();
</script></body></html>`;
