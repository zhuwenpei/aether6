/** R214 read-only network reference charts. All points are simulated, not public advisories. */
import type {Typhoon,SimulationConfig} from '../types';
import {materializeForecastPath} from '../simulation/Engine';
import {buildAetherCenterGuidance,buildAetherEnsembleMembers,AETHER_MODEL_SPECS,type AetherGuidanceMember} from '../simulation/AetherEnsembleGuidance';
import {loadProductNaturalEarthData,productCoastlineGeoJson} from '../simulation/NaturalEarthLoader';
import {drawEnsembleReferenceProductAsync} from './EnsembleReferenceProducts';
import type {NetworkFix} from './TyphoonNetworkData';
import type {NetworkChartSettings} from '../components/NetworkEntrySettings';

export type NetworkReferenceImages={strike:string;centers:string};
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('生成已取消','AbortError');};
const xyBounds=(coords:Array<{lat:number;lon:number}>)=>{
  let minLon=180,maxLon=-180,minLat=90,maxLat=-90;
  for(const p of coords){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon))continue;minLon=Math.min(minLon,p.lon);maxLon=Math.max(maxLon,p.lon);minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);}
  if(maxLon<minLon)return {minLon:105,maxLon:165,minLat:0,maxLat:42};
  const lonPad=Math.max(5,(maxLon-minLon)*.23),latPad=Math.max(4,(maxLat-minLat)*.25);
  return {minLon:Math.max(65,minLon-lonPad),maxLon:Math.min(190,maxLon+lonPad),minLat:Math.max(-25,minLat-latPad),maxLat:Math.min(75,maxLat+latPad)};
};

/** Classic eight-model CENTRE (control) tracks: no ensemble member spaghetti. */
export function drawNetworkEightCenterChart(canvas:HTMLCanvasElement,centers:AetherGuidanceMember[],issue:NetworkFix,stormName:string,startDate:Date):void{
  const w=1000,h=735;canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法创建中心路径图');
  ctx.fillStyle='#f9fcff';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#122c45';ctx.fillRect(0,0,w,88);
  ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='bold 26px Arial,"Microsoft YaHei",sans-serif';ctx.fillText('8 机构中心路径 · 经典集合预报',35,39);
  const issueTime=new Date(startDate.getTime()+issue.simHour*3600000);
  ctx.font='17px Arial,"Microsoft YaHei",sans-serif';ctx.fillStyle='#dcecff';ctx.fillText(`AETHER ${stormName} · ${issueTime.toISOString().slice(0,16).replace('T',' ')} UTC · 模拟资料`,36,68);
  const plot={x:56,y:107,w:892,h:500};
  const coords=[{lat:issue.lat,lon:issue.lon},...centers.flatMap(m=>m.track)];
  const bounds=xyBounds(coords);
  const x=(lon:number)=>plot.x+(lon-bounds.minLon)/(bounds.maxLon-bounds.minLon)*plot.w;
  const y=(lat:number)=>plot.y+(bounds.maxLat-lat)/(bounds.maxLat-bounds.minLat)*plot.h;
  ctx.fillStyle='#dceff8';ctx.fillRect(plot.x,plot.y,plot.w,plot.h);
  ctx.save();ctx.beginPath();ctx.rect(plot.x,plot.y,plot.w,plot.h);ctx.clip();
  ctx.strokeStyle='#a2c1d6';ctx.lineWidth=.8;ctx.font='13px Arial';ctx.fillStyle='#416b88';
  for(let lon=Math.ceil(bounds.minLon/5)*5;lon<=bounds.maxLon;lon+=5){const px=x(lon);ctx.beginPath();ctx.moveTo(px,plot.y);ctx.lineTo(px,plot.y+plot.h);ctx.stroke();ctx.fillText(`${lon}°E`,px+3,plot.y+plot.h-7);}
  for(let lat=Math.ceil(bounds.minLat/5)*5;lat<=bounds.maxLat;lat+=5){const py=y(lat);ctx.beginPath();ctx.moveTo(plot.x,py);ctx.lineTo(plot.x+plot.w,py);ctx.stroke();ctx.fillText(`${lat}°N`,plot.x+5,py-5);}
  const coastline=productCoastlineGeoJson;
  if(coastline?.features?.length){
    ctx.strokeStyle='#7a9a9a';ctx.lineWidth=1.15;
    const rings=(coords:any):void=>{if(!Array.isArray(coords)||!coords.length)return;
      if(typeof coords[0]?.[0]==='number'){
        ctx.beginPath();let started=false;let last:number[]|null=null;
        for(const p of coords){if(!Array.isArray(p)||p.length<2)continue;
          if(last&&Math.abs(p[0]-last[0])>15){started=false;last=p;continue;}
          const px=x(p[0]),py=y(p[1]);if(!started){ctx.moveTo(px,py);started=true;}else ctx.lineTo(px,py);last=p;
        }ctx.stroke();return;
      }for(const piece of coords)rings(piece);
    };
    for(const f of coastline.features)if(f.geometry)rings(f.geometry.coordinates);
  }
  for(const center of centers){const color=AETHER_MODEL_SPECS.find(s=>s.id===center.modelId)?.color||center.color||'#c00';
    const points=center.track.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));if(!points.length)continue;
    ctx.strokeStyle=color;ctx.lineWidth=2.7;ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(x(issue.lon),y(issue.lat));
    for(const p of points)ctx.lineTo(x(p.lon),y(p.lat));ctx.stroke();
    ctx.fillStyle=color;for(const p of points){if(Math.round(p.leadHour)%24!==0)continue;ctx.beginPath();ctx.arc(x(p.lon),y(p.lat),3,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();ctx.strokeStyle='#607e97';ctx.lineWidth=1;ctx.strokeRect(plot.x,plot.y,plot.w,plot.h);
  ctx.beginPath();ctx.arc(x(issue.lon),y(issue.lat),7,0,2*Math.PI);ctx.fillStyle='#f33232';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  centers.forEach((center,i)=>{const spec=AETHER_MODEL_SPECS.find(s=>s.id===center.modelId);const c=spec?.color||center.color||'#888';const lx=60+(i%4)*238,ly=642+Math.floor(i/4)*36;
    ctx.strokeStyle=c;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+33,ly);ctx.stroke();ctx.fillStyle='#203348';ctx.font='bold 16px Arial';ctx.fillText(spec?.label||center.modelId,lx+44,ly+6);
  });
  ctx.fillStyle='#617383';ctx.font='13px Arial,"Microsoft YaHei"';ctx.fillText('模拟 8 模式控制路径 · 以入场巅峰强度为共同高权重参考 · 各模式独立偏差',58,724);
}

export async function generateNetworkReferenceCharts(args:{storm:Typhoon;issue:NetworkFix;startDate:Date;config:SimulationConfig;settings:NetworkChartSettings;name:string;signal:AbortSignal;onProgress?:(text:string)=>void;}):Promise<NetworkReferenceImages>{
  const {storm,issue,startDate,config,settings,name,signal,onProgress}=args;
  check(signal);onProgress?.('准备集合底图与模拟预报');
  const ready=await loadProductNaturalEarthData();check(signal);
  if(!ready)throw new Error('集合预报地理底图未就绪');
  const seed={...storm,...issue,history:(storm.history||[]).filter(h=>h.simHour<=issue.simHour),forecastPath:[],simHour:issue.simHour} as Typhoon;
  const horizon=settings.strikeHorizon;
  const forecast=materializeForecastPath(seed,config,horizon,undefined,false).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon));
  check(signal);onProgress?.('生成 8 机构差异化中心路径');
  const centers=buildAetherCenterGuidance(seed,issue.simHour,[seed],config.seed||'AETHER',forecast,horizon,config,true);
  if(!centers.length)throw new Error('8 机构中心路径计算结果为空');
  const centerCanvas=document.createElement('canvas');drawNetworkEightCenterChart(centerCanvas,centers,issue,name,startDate);
  const centerImage=centerCanvas.toDataURL('image/png');check(signal);
  onProgress?.(`生成 ${centers.length} 机构集合成员与袭击概率`);
  const members=await buildAetherEnsembleMembers({storm:seed,currentHour:issue.simHour,scene:[seed],seed:config.seed||'AETHER',referencePath:forecast,
    selectedModelIds:AETHER_MODEL_SPECS.map(m=>m.id),membersPerModel:settings.membersPerModel,horizon,config,useProductCoastline:true,signal,
    onProgress:(done,total)=>{if(done===total)onProgress?.('绘制袭击概率栅格');}});
  check(signal);
  if(!members.length)throw new Error('集合成员计算结果为空');
  const strikeCanvas=document.createElement('canvas');
  await drawEnsembleReferenceProductAsync({canvas:strikeCanvas,style:'strike_probability_120km',typhoon:seed,activeState:seed,
    currentHour:issue.simHour,startDate,config,centers,members,referencePath:forecast,framingReferencePath:forecast,forecastHorizonHours:horizon,
    width:1015,height:920,stormName:name,historicalTrack:(storm.history||[]).filter(p=>p.simHour<=issue.simHour),
    strike:{horizonHours:horizon,radiusKm:settings.strikeRadiusKm,cellDeg:settings.strikeCellDeg,
      smoothPasses:settings.strikeSmoothPasses,coastMinPct:10,coastWidth:2,frameMode:'auto',showMembers:false,
      meanDotHours:settings.meanDotHours,pillCount:10,pillMinPct:5,modelLabel:'8-MODEL ENSEMBLE',watermark:'AETHER 模拟袭击概率 · 非官方'},
    signal,onProgress:p=>onProgress?.(`绘制袭击概率图 ${Math.round(p*100)}%`)});
  check(signal);
  return {strike:strikeCanvas.toDataURL('image/png'),centers:centerImage};
}
