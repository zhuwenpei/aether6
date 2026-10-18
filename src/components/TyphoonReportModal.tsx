import {threeHourlyReportNodes} from "../utils/ThreeHourlyReportNodes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, Sliders, X, Map as MapIcon, Activity, CloudRain } from "lucide-react";
import { SimulationConfig, Typhoon, TyphoonCategory } from "../types";
import { getAgencyIntensity, getLandMetrics, getStandardAverageWindRadii, isMinorIslandOperationalIgnored, JTWC_SSHWS_BANDS } from "../simulation/Engine";
import { checkPointOnLandGeoJson, productLandGeoJson as landGeoJson, loadProductNaturalEarthData } from "../simulation/NaturalEarthLoader";
import { strokeProductCoastlineRing } from "../utils/ProductCoastlineDrawing";
import { calculateJmaWindCircleGeometry } from "../utils/JmaWindRadii";
import { JMA_PRODUCT_COLORS, LOCAL_VECTOR_BASEMAPS } from "../utils/LocalVectorBasemaps";
import { isCmaTyphoonProductTime } from "../simulation/CmaOperationalClock";
import { getTyphoonDisplayName, getTyphoonOfficialNumber } from "../utils/TyphoonDisplayName";
import { drawObservedRainfallMap } from "../utils/ObservedRainfallMap";
import { drawWikiTrackMap } from "../utils/WikiTrackMapProduct";
import { getJmaTrackDotCadenceHours } from "../utils/JmaOperationalTiming";
import { loadAgencyBranding } from "../utils/AgencyBranding";

interface TyphoonReportModalProps {
  typhoon: Typhoon;
  startDate?: Date;
  config?: SimulationConfig;
  onClose: () => void;
}

type ReportAgency = "CMA" | "JMA" | "JTWC";

type HistoryPoint = {
  time: number;
  wind: number;
  pressure: number;
};

type LandfallPoint = {
  lat: number;
  lon: number;
  wind: number;
  time: number;
  region: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function fitCanvasFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxPx: number,
  minPx: number,
  family: string,
  weight: string | number = 400
) {
  let px = Math.max(minPx, maxPx);
  while (px > minPx) {
    ctx.font = `${weight} ${Math.round(px)}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return px;
    px -= Math.max(0.5, px * 0.035);
  }
  ctx.font = `${weight} ${Math.round(minPx)}px ${family}`;
  return minPx;
}

const cleanLandName = (rawName: string) => {
  return rawName
    .replace(/\s*\(OSM Geofabrik Asia 提取\)/g, "")
    .replace(/\s*\(精细气象观测掩膜\)/g, "")
    .replace(/\s*\(西太平洋.*\)/g, "")
    .replace(/\s*\(大湾区.*\)/g, "")
    .replace(/\s*\(东海.*\)/g, "")
    .replace(/\s*\(长江.*\)/g, "")
    .replace(/\s*\(高纬度.*\)/g, "")
    .replace(/\s*\(菲律宾\)/g, "")
    .replace(/\s*\(.*\)/g, "")
    .trim();
};

function formatDateTime(date: Date, withSeconds = false) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}${withSeconds ? `:${ss}` : ""}`;
}

function formatAxisTime(start: Date, simHour: number) {
  const d = new Date(start.getTime() + simHour * 3600000);
  return {
    upper: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`,
    lower: `${String(d.getHours()).padStart(2, "0")}:00`
  };
}

function niceStep(range: number, targetTicks = 6) {
  const rough = Math.max(0.1, range / targetTicks);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

function drawLinePath(
  ctx: CanvasRenderingContext2D,
  data: HistoryPoint[],
  xForTime: (time: number) => number,
  yForValue: (value: number) => number,
  valueKey: "wind" | "pressure",
  color: string,
  width: number,
  scale: number
) {
  if (data.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * scale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  data.forEach((point, index) => {
    const x = xForTime(point.time);
    const y = yForValue(point[valueKey]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawScientificPanel(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    data: HistoryPoint[];
    startDate: Date;
    valueKey: "wind" | "pressure";
    yLabel: string;
    showSynopticNodes?: boolean;
    threeHourlyParameters?: boolean;
    scale: number;
  }
) {
  const { x, y, w, h, data, startDate, valueKey, yLabel, showSynopticNodes, threeHourlyParameters, scale } = opts;
  if (data.length === 0) return;

  const padL = 112 * scale;
  const padR = 42 * scale;
  const padT = 72 * scale;
  const padB = 94 * scale;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const minTime = data[0].time;
  const maxTime = Math.max(minTime + 1, data[data.length - 1].time);

  const values = data.map((d) => d[valueKey]);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  const rawRange = Math.max(1, maxValue - minValue);
  const margin = valueKey === "pressure" ? Math.max(3, rawRange * 0.08) : Math.max(3, rawRange * 0.10);
  minValue -= margin;
  maxValue += margin;

  const step = niceStep(maxValue - minValue, 5);
  minValue = Math.floor(minValue / step) * step;
  maxValue = Math.ceil(maxValue / step) * step;
  if (valueKey === "wind") minValue = Math.max(0, minValue);

  const xForTime = (time: number) => plotX + ((time - minTime) / (maxTime - minTime)) * plotW;
  const yForValue = (value: number) => plotY + plotH - ((value - minValue) / Math.max(0.001, maxValue - minValue)) * plotH;

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "#171717";
  ctx.lineWidth = 2.35 * scale;
  ctx.strokeRect(plotX, plotY, plotW, plotH);

  // Horizontal grid and y labels: thin, desaturated, reference-image-like.
  ctx.font = `${Math.round(18 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = minValue; v <= maxValue + step * 0.2; v += step) {
    const yy = yForValue(v);
    ctx.save();
    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = 1.15 * scale;
    ctx.setLineDash([6 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.moveTo(plotX, yy);
    ctx.lineTo(plotX + plotW, yy);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#222222";
    ctx.fillText(valueKey === "pressure" ? v.toFixed(0) : v.toFixed(0), plotX - 15 * scale, yy);
  }

  // Time ticks: about 10 major ticks, with the two-line date/hour style visible in both references.
  const desiredTicks = clamp(Math.round(plotW / (195 * scale)), 5, 10);
  const timeStep = Math.max(1, Math.ceil((maxTime - minTime) / desiredTicks / 3) * 3);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let tickIndex = 0;
  for (let t = Math.ceil(minTime / timeStep) * timeStep; t <= maxTime + 0.001; t += timeStep) {
    const xx = xForTime(t);
    ctx.save();
    ctx.strokeStyle = tickIndex % 2 === 0 ? "#d1d5db" : "#e5e7eb";
    ctx.lineWidth = 0.8 * scale;
    ctx.setLineDash([5 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.moveTo(xx, plotY);
    ctx.lineTo(xx, plotY + plotH);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 1.55 * scale;
    ctx.beginPath();
    ctx.moveTo(xx, plotY + plotH);
    ctx.lineTo(xx, plotY + plotH + 9 * scale);
    ctx.stroke();

    const label = formatAxisTime(startDate, t);
    ctx.fillStyle = "#171717";
    ctx.font = `${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`;
    ctx.fillText(label.upper, xx, plotY + plotH + 14 * scale);
    ctx.fillText(label.lower, xx, plotY + plotH + 40 * scale);
    tickIndex++;
  }

  // R214: all exported report curves are literal three-hour node segments.
  // Old sensor jitter, sub-hour subdivisions and Bezier smoothing are removed.
  const knots=threeHourlyReportNodes(data,p=>p.time);
  drawLinePath(ctx,knots,xForTime,yForValue,valueKey,"#262626",valueKey==="pressure"?2.75:2.45,scale);
  ctx.fillStyle="#262626";
  knots.forEach(p=>{ctx.beginPath();ctx.arc(xForTime(p.time),yForValue(p[valueKey]),2.5*scale,0,Math.PI*2);ctx.fill();});

  // Extreme annotation lives in a dedicated header strip above the plot.
  // A leader connects it to the actual extremum so the numeric label can never cover the curve.
  const extremeValue = valueKey === "pressure" ? Math.min(...values) : Math.max(...values);
  const extreme = data.find((d) => d[valueKey] === extremeValue) || data[0];
  const ex = xForTime(extreme.time);
  const ey = yForValue(extremeValue);
  const annotationColor = valueKey === "pressure" ? "#245d93" : "#b42318";
  const suffix = valueKey === "pressure" ? " hPa" : " m/s";
  const annotationText = `${valueKey === "pressure" ? "MIN" : "MAX"}  ${extremeValue.toFixed(1)}${suffix}`;
  ctx.font = `bold ${Math.round(17 * scale)}px "Times New Roman", "Songti SC", serif`;
  const textW = ctx.measureText(annotationText).width;
  const labelX = plotX + plotW - textW - 12 * scale;
  const labelY = plotY - 30 * scale;
  ctx.save();
  ctx.strokeStyle = "#a0a0a0";
  ctx.lineWidth = 1.15 * scale;
  ctx.setLineDash([3 * scale, 3 * scale]);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex, plotY - 7 * scale);
  ctx.lineTo(labelX - 6 * scale, labelY + 1 * scale);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(labelX - 7 * scale, labelY - 14 * scale, textW + 14 * scale, 28 * scale);
  ctx.strokeStyle = "#d0d0d0";
  ctx.lineWidth = 0.8 * scale;
  ctx.strokeRect(labelX - 7 * scale, labelY - 14 * scale, textW + 14 * scale, 28 * scale);
  ctx.fillStyle = annotationColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(annotationText, labelX, labelY);

  // Y-axis title.
  ctx.save();
  ctx.translate(x + 23 * scale, plotY + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#171717";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(20 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // Compact legend occupies the opposite side of the header strip.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(15 * scale)}px sans-serif`;
  const legendX = plotX + 10 * scale;
  const legendY = plotY - 30 * scale;
  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 2.35 * scale;
  ctx.beginPath();
  ctx.moveTo(legendX, legendY);
  ctx.lineTo(legendX + 24 * scale, legendY);
  ctx.stroke();
  ctx.fillStyle = "#3a3a3a";
  ctx.fillText("3 小时折线节点", legendX + 31 * scale, legendY);

  ctx.restore();
}


type LifecyclePoint = { time: number; value: number };

function meanQuadrantRadiusKm(r: any): number | null {
  if (!r) return null;
  const vals = [r.ne, r.se, r.sw, r.nw].map(Number).filter((v) => Number.isFinite(v) && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function drawLifecycleMiniPanel(
  ctx: CanvasRenderingContext2D,
  opts: { x:number; y:number; w:number; h:number; title:string; unit:string; data:LifecyclePoint[]; color:string; scale:number }
) {
  const { x, y, w, h, title, unit, data, color, scale } = opts;
  if (!data.length) return;
  const padL = 84 * scale, padR = 28 * scale, padT = 38 * scale, padB = 34 * scale;
  const px = x + padL, py = y + padT, pw = Math.max(20, w - padL - padR), ph = Math.max(20, h - padT - padB);
  const minT = data[0].time, maxT = Math.max(minT + 1, data[data.length - 1].time);
  let minV = Math.min(...data.map(d => d.value)), maxV = Math.max(...data.map(d => d.value));
  const valuePad = Math.max(2, (maxV - minV) * 0.12);
  minV -= valuePad; maxV += valuePad;
  if (unit === 'kt' || unit === 'nm') minV = Math.max(0, minV);
  const step = niceStep(Math.max(1, maxV - minV), 4);
  minV = Math.floor(minV / step) * step; maxV = Math.ceil(maxV / step) * step;
  const xf = (t:number) => px + (t - minT) / (maxT - minT) * pw;
  const yf = (v:number) => py + ph - (v - minV) / Math.max(1e-6, maxV - minV) * ph;

  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#111827'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(16*scale)}px Arial, sans-serif`; ctx.fillText(title, x + w - 10*scale, y + 18*scale);
  ctx.strokeStyle = '#d7dce2'; ctx.lineWidth = 1 * scale;
  ctx.font = `${Math.round(12*scale)}px Arial, sans-serif`;
  for (let v=minV; v<=maxV + step*0.2; v+=step) {
    const yy = yf(v); ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px+pw, yy); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.textAlign='right'; ctx.fillText(v.toFixed(0), px - 8*scale, yy);
  }
  const tStep = Math.max(24, Math.ceil((maxT-minT)/7/12)*12);
  for (let t=Math.ceil(minT/tStep)*tStep; t<=maxT+0.01; t+=tStep) {
    const xx=xf(t); ctx.strokeStyle='#e5e7eb'; ctx.beginPath(); ctx.moveTo(xx, py); ctx.lineTo(xx, py+ph); ctx.stroke();
    ctx.fillStyle='#64748b'; ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillText(String(Math.round(t)), xx, py+ph+6*scale);
  }
  ctx.strokeStyle='#64748b'; ctx.lineWidth=1.2*scale; ctx.strokeRect(px,py,pw,ph);
  ctx.strokeStyle=color; ctx.lineWidth=2.5*scale; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.beginPath();
  data.forEach((d,i)=>{ const xx=xf(d.time), yy=yf(d.value); i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy); }); ctx.stroke();
  ctx.fillStyle=color;
  data.forEach((d)=>{ const xx=xf(d.time), yy=yf(d.value); ctx.beginPath(); ctx.arc(xx,yy,2.1*scale,0,Math.PI*2); ctx.fill(); });
  ctx.save(); ctx.translate(x+20*scale,py+ph/2); ctx.rotate(-Math.PI/2); ctx.fillStyle='#334155'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`600 ${Math.round(13*scale)}px Arial, sans-serif`; ctx.fillText(unit,0,0); ctx.restore();
  ctx.restore();
}

function drawLifecycleDiagnosticReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  historyData: HistoryPoint[],
  startDate: Date,
  displayName: string
) {
  const scale = width / 1600;
  const history = threeHourlyReportNodes(typhoon.history?.length ? typhoon.history : [{ simHour:0, vmax:typhoon.vmax, pmin:typhoon.pmin, r7:(typhoon as any).r7 } as any],h=>Number(h.simHour));
  const wind = historyData.map(p=>({time:p.time,value:Number(getAgencyIntensity(p.wind,"JTWC","continuous").value)}));
  const pressure = historyData.map(p=>({time:p.time,value:p.pressure}));
  const radius = history.map((p:any)=>{
    const exact = meanQuadrantRadiusKm(p.r7 || p.r34);
    const fallback = getStandardAverageWindRadii(Number(p.vmax||0)).r7;
    return { time:Number(p.simHour||0), value:Math.max(0,(exact ?? fallback)/1.852) };
  });
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#111827'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.font=`700 ${Math.round(30*scale)}px Arial, sans-serif`; ctx.fillText(`${displayName} Lifecycle Diagnostics`,width/2,26*scale);
  ctx.fillStyle='#64748b'; ctx.font=`${Math.round(14*scale)}px Arial, sans-serif`;
  ctx.fillText(`Initialized ${formatDateTime(startDate)} · lifecycle history · ${loadAgencyBranding('typhoon_report').agencyCode} simulation`,width/2,64*scale);
  const x=56*scale, top=96*scale, gap=16*scale, panelW=width-x*2, panelH=(height-top-34*scale-gap*2)/3;
  drawLifecycleMiniPanel(ctx,{x,y:top,w:panelW,h:panelH,title:'Max Sustained Wind',unit:'kt',data:wind,color:'#111827',scale});
  drawLifecycleMiniPanel(ctx,{x,y:top+panelH+gap,w:panelW,h:panelH,title:'MSLP',unit:'hPa',data:pressure,color:'#2563eb',scale});
  drawLifecycleMiniPanel(ctx,{x,y:top+(panelH+gap)*2,w:panelW,h:panelH,title:'Mean 34kt Radius',unit:'nm',data:radius,color:'#059669',scale});
}

function geoDistanceKm(a:{lat:number;lon:number}, b:{lat:number;lon:number}) {
  const rad = Math.PI/180, p1=a.lat*rad, p2=b.lat*rad, dp=(b.lat-a.lat)*rad, dl=(b.lon-a.lon)*rad;
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}

function drawPatriciaStyleLifecycleReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  startDate: Date,
  displayName: string
) {
  const scale=width/1600;
  const history=threeHourlyReportNodes(typhoon.history?.length?typhoon.history:[{simHour:0,vmax:typhoon.vmax,pmin:typhoon.pmin,lat:typhoon.lat,lon:typhoon.lon} as any],p=>Number(p.simHour));
  const rows=history.map((p:any,i:number)=>{
    let speedMph=0;
    if(i>0){ const prev:any=history[i-1]; const dt=Math.max(1e-6,Number(p.simHour)-Number(prev.simHour)); speedMph=geoDistanceKm(prev,p)/dt*0.621371; }
    const jtwcKt = Number(getAgencyIntensity(Number(p.vmax||0), "JTWC", "continuous").value);
    return {time:Number(p.simHour||0), windMph:jtwcKt*1.150779448, pressure:Number(p.pmin||1010), speedMph};
  });
  const minT=rows[0].time,maxT=Math.max(minT+1,rows[rows.length-1].time);
  const maxWind=Math.max(80,...rows.map(r=>r.windMph)); const windMax=Math.ceil((maxWind+20)/20)*20;
  const minP=Math.floor((Math.min(...rows.map(r=>r.pressure))-10)/10)*10, maxP=Math.ceil((Math.max(...rows.map(r=>r.pressure))+4)/10)*10;
  const left=106*scale,right=112*scale,top=110*scale,bottom=78*scale; const px=left,py=top,pw=width-left-right,ph=height-top-bottom;
  const xf=(t:number)=>px+(t-minT)/(maxT-minT)*pw, yw=(v:number)=>py+ph-(v/windMax)*ph, yp=(v:number)=>py+ph-(v-minP)/(maxP-minP)*ph;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#111827';ctx.textAlign='center';ctx.textBaseline='top';ctx.font=`700 ${Math.round(31*scale)}px Arial, sans-serif`;ctx.fillText(`${displayName} — Lifecycle Intensity`,width/2,28*scale);
  ctx.font=`${Math.round(14*scale)}px Arial, sans-serif`;ctx.fillStyle='#64748b';ctx.fillText(`${formatDateTime(startDate)} → ${formatDateTime(new Date(startDate.getTime()+maxT*3600000))}`,width/2,68*scale);
  ctx.strokeStyle='#d1d5db';ctx.lineWidth=1*scale;
  ctx.font=`${Math.round(12*scale)}px Arial, sans-serif`;
  for(let v=0;v<=windMax;v+=20){const y=yw(v);ctx.beginPath();ctx.moveTo(px,y);ctx.lineTo(px+pw,y);ctx.stroke();ctx.fillStyle='#e43d0b';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(String(v),px-9*scale,y);}
  const tstep=Math.max(24,Math.ceil((maxT-minT)/8/12)*12);
  for(let t=Math.ceil(minT/tstep)*tstep;t<=maxT+0.01;t+=tstep){const x=xf(t);ctx.strokeStyle='#e5e7eb';ctx.beginPath();ctx.moveTo(x,py);ctx.lineTo(x,py+ph);ctx.stroke();const d=new Date(startDate.getTime()+t*3600000);ctx.fillStyle='#334155';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(`${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`,x,py+ph+8*scale);}
  ctx.strokeStyle='#374151';ctx.lineWidth=1.2*scale;ctx.strokeRect(px,py,pw,ph);
  for(let p=minP;p<=maxP;p+=10){const y=yp(p);ctx.fillStyle='#172554';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(String(p),px+pw+8*scale,y);}
  const thresholds = JTWC_SSHWS_BANDS
    .filter((band) => band.category === "TS" || band.category.startsWith("C"))
    .map((band) => [band.label, band.minMph] as const);
  ctx.font=`${Math.round(11*scale)}px Arial, sans-serif`;
  thresholds.forEach(([name,mph])=>{if(mph>windMax)return;const y=yw(mph);ctx.strokeStyle='rgba(234,88,12,.55)';ctx.beginPath();ctx.moveTo(px,y);ctx.lineTo(px+pw,y);ctx.stroke();ctx.fillStyle='#ea580c';ctx.textAlign='left';ctx.fillText(name,px+8*scale,y-5*scale);});
  const draw=(key:'windMph'|'pressure'|'speedMph',color:string,yf:(v:number)=>number,w:number)=>{ctx.strokeStyle=color;ctx.lineWidth=w*scale;ctx.lineJoin='round';ctx.beginPath();rows.forEach((r,i)=>{const x=xf(r.time),y=yf(r[key]);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();};
  draw('windMph','#f0440b',yw,3.1); draw('pressure','#172554',yp,3.2); draw('speedMph','#6b0f75',yw,2.4);
  ctx.fillStyle='#e43d0b';ctx.save();ctx.translate(24*scale,py+ph/2);ctx.rotate(-Math.PI/2);ctx.font=`700 ${Math.round(16*scale)}px Arial, sans-serif`;ctx.textAlign='center';ctx.fillText('JTWC 1-min wind (mph)',0,0);ctx.restore();
  ctx.fillStyle='#172554';ctx.save();ctx.translate(width-22*scale,py+ph/2);ctx.rotate(Math.PI/2);ctx.font=`700 ${Math.round(16*scale)}px Arial, sans-serif`;ctx.textAlign='center';ctx.fillText('hPa',0,0);ctx.restore();
  const lx=px+pw*0.25,ly=88*scale;[['Wind','#f0440b'],['Pressure','#172554'],['Storm speed','#6b0f75']].forEach((it,i)=>{ctx.strokeStyle=it[1];ctx.lineWidth=3*scale;ctx.beginPath();ctx.moveTo(lx+i*150*scale,ly);ctx.lineTo(lx+28*scale+i*150*scale,ly);ctx.stroke();ctx.fillStyle='#334155';ctx.font=`${Math.round(12*scale)}px Arial, sans-serif`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(it[0],lx+35*scale+i*150*scale,ly);});
}

function pressureTrackColor(p: number): string {
  const stops = [
    { p: 920, c: [190, 38, 32] },
    { p: 940, c: [235, 156, 31] },
    { p: 960, c: [132, 190, 79] },
    { p: 980, c: [48, 170, 196] },
    { p: 1000, c: [30, 73, 171] }
  ];
  if (p <= stops[0].p) return `rgb(${stops[0].c.join(",")})`;
  if (p >= stops[stops.length - 1].p) return `rgb(${stops[stops.length - 1].c.join(",")})`;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (p >= a.p && p <= b.p) {
      const t = (p - a.p) / (b.p - a.p);
      const c = a.c.map((v, k) => Math.round(v + (b.c[k] - v) * t));
      return `rgb(${c.join(",")})`;
    }
  }
  return "#555555";
}


type TrackScreenPoint = { x: number; y: number };
type TrackLabelRect = { x: number; y: number; w: number; h: number };

function rectsOverlap(a: TrackLabelRect, b: TrackLabelRect, pad = 0) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}
function pointInRect(p: TrackScreenPoint, r: TrackLabelRect) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function orient(a: TrackScreenPoint, b: TrackScreenPoint, c: TrackScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(a: TrackScreenPoint, b: TrackScreenPoint, c: TrackScreenPoint, d: TrackScreenPoint) {
  const eps = 1e-6;
  const onSegment = (p: TrackScreenPoint, q: TrackScreenPoint, r: TrackScreenPoint) =>
    q.x >= Math.min(p.x, r.x) - eps && q.x <= Math.max(p.x, r.x) + eps &&
    q.y >= Math.min(p.y, r.y) - eps && q.y <= Math.max(p.y, r.y) + eps;
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 * o2 < -eps && o3 * o4 < -eps) return true;
  if (Math.abs(o1) <= eps && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= eps && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= eps && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= eps && onSegment(c, b, d)) return true;
  return false;
}
function segmentTouchesRect(a: TrackScreenPoint, b: TrackScreenPoint, rect: TrackLabelRect, padding: number) {
  const r = { x: rect.x - padding, y: rect.y - padding, w: rect.w + padding * 2, h: rect.h + padding * 2 };
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const tl = { x: r.x, y: r.y }, tr = { x: r.x + r.w, y: r.y }, br = { x: r.x + r.w, y: r.y + r.h }, bl = { x: r.x, y: r.y + r.h };
  return segmentsCross(a, b, tl, tr) || segmentsCross(a, b, tr, br) || segmentsCross(a, b, br, bl) || segmentsCross(a, b, bl, tl);
}

/**
 * Place a point annotation while treating the plotted track as an obstacle. Candidate boxes are
 * scored against every path segment and every earlier annotation, then joined to the exact fix by
 * a short leader. This preserves the one-glance point-to-label relationship without allowing text
 * to sit on top of the track itself.
 */
function placeTrackLabel(
  ctx: CanvasRenderingContext2D,
  point: TrackScreenPoint,
  lines: string[],
  map: TrackLabelRect,
  trackSegments: Array<[TrackScreenPoint, TrackScreenPoint]>,
  used: TrackLabelRect[],
  scale: number,
  lineHeight: number,
  preferredIndex = 0
): { rect: TrackLabelRect; leader: TrackScreenPoint } {
  const padX = 3 * scale;
  const padY = 2 * scale;
  const textW = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const w = textW + padX * 2;
  const h = lines.length * lineHeight + padY * 2;
  const dirs = [
    { dx: 1, dy: -1 }, { dx: -1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 },
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
  ];
  let best: { rect: TrackLabelRect; score: number; leader: TrackScreenPoint } | null = null;
  for (let ring = 0; ring < 4; ring++) {
    const distance = (18 + ring * 15) * scale;
    for (let k = 0; k < dirs.length; k++) {
      const dir = dirs[(k + preferredIndex) % dirs.length];
      const cx = point.x + dir.dx * distance;
      const cy = point.y + dir.dy * distance;
      let x = dir.dx < 0 ? cx - w : dir.dx > 0 ? cx : cx - w / 2;
      let y = dir.dy < 0 ? cy - h : dir.dy > 0 ? cy : cy - h / 2;
      x = clamp(x, map.x + 4 * scale, map.x + map.w - w - 4 * scale);
      y = clamp(y, map.y + 4 * scale, map.y + map.h - h - 4 * scale);
      const rect = { x, y, w, h };
      const trackHits = trackSegments.reduce((n, seg) => n + (segmentTouchesRect(seg[0], seg[1], rect, 4.5 * scale) ? 1 : 0), 0);
      const labelHits = used.reduce((n, r) => n + (rectsOverlap(rect, r, 5 * scale) ? 1 : 0), 0);
      const leader = { x: clamp(point.x, rect.x, rect.x + rect.w), y: clamp(point.y, rect.y, rect.y + rect.h) };
      const leaderCross = trackSegments.reduce((n, seg) => {
        // Ignore the tiny local section at the labelled fix; crossing some other track segment is expensive.
        const farFromFix = Math.hypot(seg[0].x - point.x, seg[0].y - point.y) > 10 * scale && Math.hypot(seg[1].x - point.x, seg[1].y - point.y) > 10 * scale;
        return n + (farFromFix && segmentsCross(point, leader, seg[0], seg[1]) ? 1 : 0);
      }, 0);
      const score = trackHits * 10000 + labelHits * 12000 + leaderCross * 1800 + ring * 35 + k * 2;
      if (!best || score < best.score) best = { rect, score, leader };
      if (score < 50) break;
    }
    if (best && best.score < 50) break;
  }
  const result = best || { rect: { x: point.x + 12 * scale, y: point.y - h - 12 * scale, w, h }, leader: point, score: 0 };
  used.push(result.rect);
  return { rect: result.rect, leader: result.leader };
}

function drawTrackReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  startDate: Date
) {
  const history = typhoon.history?.length ? typhoon.history : [{
    lat: typhoon.lat, lon: typhoon.lon, pmin: typhoon.pmin, vmax: typhoon.vmax, simHour: 0
  } as any];
  const displayName = getTyphoonDisplayName(typhoon, typhoon.simHour, startDate);
  const scale = Math.min(width / 1920, height / 1080);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const portrait = height > width;
  const marginX = Math.max((portrait ? 30 : 72) * scale, width * (portrait ? 0.020 : 0.035));
  const titleY = Math.max(22 * scale, height * 0.018);
  const mapX = marginX;
  const mapY = Math.max(76 * scale, height * (portrait ? 0.055 : 0.075));
  const mapW = width - marginX * 2;
  const bottomReserve = Math.max(64 * scale, height * (portrait ? 0.045 : 0.075));
  const mapH = height - mapY - bottomReserve;

  let minLat = Math.min(...history.map((h) => h.lat));
  let maxLat = Math.max(...history.map((h) => h.lat));
  let minLon = Math.min(...history.map((h) => h.lon));
  let maxLon = Math.max(...history.map((h) => h.lon));
  const latSpan0 = Math.max(4, maxLat - minLat);
  const lonSpan0 = Math.max(5, maxLon - minLon);
  minLat -= Math.max(2.2, latSpan0 * 0.18);
  maxLat += Math.max(2.2, latSpan0 * 0.18);
  minLon -= Math.max(2.8, lonSpan0 * 0.18);
  maxLon += Math.max(2.8, lonSpan0 * 0.18);
  minLat = Math.max(-55, minLat); maxLat = Math.min(88, maxLat);
  minLon = Math.max(30, minLon); maxLon = Math.min(220, maxLon);

  const desiredAspect = mapW / mapH;
  let latSpan = maxLat - minLat;
  let lonSpan = maxLon - minLon;
  const meanLat = (minLat + maxLat) * 0.5;
  const correctedAspect = (lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180))) / Math.max(0.1, latSpan);
  if (correctedAspect < desiredAspect) {
    const needed = desiredAspect * latSpan / Math.max(0.35, Math.cos(meanLat * Math.PI / 180));
    const add = (needed - lonSpan) / 2;
    minLon -= add; maxLon += add;
  } else {
    const needed = lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180)) / desiredAspect;
    const add = (needed - latSpan) / 2;
    minLat -= add; maxLat += add;
  }

  const project = (lat: number, lon: number) => ({
    x: mapX + ((lon - minLon) / (maxLon - minLon)) * mapW,
    y: mapY + mapH - ((lat - minLat) / (maxLat - minLat)) * mapH
  });

  // CMA-style operational chart palette: pale cyan sea + warm ivory land.
  // This follows the visual hierarchy of the supplied CMA reference while keeping
  // pressure-colored track segments legible.
  ctx.fillStyle = "#dff4f6";
  ctx.fillRect(mapX, mapY, mapW, mapH);
  ctx.save();
  ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();

  // Land mask from the Natural Earth dataset already loaded by the simulator.
  if (landGeoJson?.features) {
    ctx.fillStyle = "#fffceb";
    ctx.strokeStyle = "#8f9a9d";
    ctx.lineWidth = Math.max(0.7, 0.9 * scale);
    const drawRing = (ring: any[]) => {
      let started = false;
      ctx.beginPath();
      ring.forEach((coord) => {
        const lon = Number(coord[0]); const lat = Number(coord[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const p = project(lat, lon);
        if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
      });
      if (started) { ctx.closePath(); ctx.fill(); strokeProductCoastlineRing(ctx, ring, project); }
    };
    landGeoJson.features.forEach((feature: any) => {
      const g = feature?.geometry;
      if (!g) return;
      if (g.type === "Polygon") (g.coordinates || []).slice(0, 1).forEach(drawRing);
      else if (g.type === "MultiPolygon") (g.coordinates || []).forEach((poly: any) => (poly || []).slice(0, 1).forEach(drawRing));
    });
  }

  // Grid, deliberately light and technical like the reference figure.
  const lonStep = 5;
  const latStep = 5;
  ctx.save();
  ctx.strokeStyle = "rgba(89, 126, 134, 0.28)";
  ctx.lineWidth = Math.max(0.6, 0.8 * scale);
  ctx.setLineDash([4 * scale, 4 * scale]);
  for (let lon = Math.ceil(minLon / lonStep) * lonStep; lon <= maxLon; lon += lonStep) {
    const p = project(minLat, lon);
    ctx.beginPath(); ctx.moveTo(p.x, mapY); ctx.lineTo(p.x, mapY + mapH); ctx.stroke();
  }
  for (let lat = Math.ceil(minLat / latStep) * latStep; lat <= maxLat; lat += latStep) {
    const p = project(lat, minLon);
    ctx.beginPath(); ctx.moveTo(mapX, p.y); ctx.lineTo(mapX + mapW, p.y); ctx.stroke();
  }
  ctx.restore();

  // Track colored continuously by central pressure.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < history.length; i++) {
    const a = project(history[i - 1].lat, history[i - 1].lon);
    const b = project(history[i].lat, history[i].lon);
    ctx.strokeStyle = pressureTrackColor((history[i - 1].pmin + history[i].pmin) / 2);
    ctx.lineWidth = Math.max(4.2, 5.6 * scale);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  history.forEach((h, i) => {
    if (i !== 0 && i !== history.length - 1 && !isCmaTyphoonProductTime(startDate, h.simHour)) return;
    const p = project(h.lat, h.lon);
    ctx.fillStyle = pressureTrackColor(h.pmin);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.4, 1.7 * scale);
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4.2, 5.8 * scale), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });

  // One clean date callout per ~24 h. The complete path is an obstacle for label boxes.
  const callouts = history.filter((h, i) => i === 0 || i === history.length - 1 || Math.round(h.simHour) % 24 === 0);
  const trackSegments: Array<[TrackScreenPoint, TrackScreenPoint]> = history.slice(1).map((h, i) => [project(history[i].lat, history[i].lon), project(h.lat, h.lon)]);
  const usedCalloutRects: TrackLabelRect[] = [];
  ctx.font = `${Math.round(18 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.fillStyle = "#5a5a5a";
  ctx.strokeStyle = "#9099a0";
  ctx.lineWidth = Math.max(1.0, 1.25 * scale);
  callouts.forEach((h, i) => {
    const p = project(h.lat, h.lon);
    const d = new Date(startDate.getTime() + h.simHour * 3600000);
    const text = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    const placed = placeTrackLabel(ctx, p, [text], { x: mapX, y: mapY, w: mapW, h: mapH }, trackSegments, usedCalloutRects, scale, 20 * scale, i % 2);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(placed.leader.x, placed.leader.y); ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(text, placed.rect.x + 3 * scale, placed.rect.y + 2 * scale);
  });
  ctx.restore();

  ctx.strokeStyle = "#333333";
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // Axes labels outside the clip.
  ctx.fillStyle = "#555555";
  ctx.font = `${Math.round(15 * scale)}px "Times New Roman", serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let lon = Math.ceil(minLon / lonStep) * lonStep; lon <= maxLon; lon += lonStep) {
    const p = project(minLat, lon); ctx.fillText(`${lon}°E`, p.x, mapY + mapH + 7 * scale);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let lat = Math.ceil(minLat / latStep) * latStep; lat <= maxLat; lat += latStep) {
    const p = project(lat, minLon); ctx.fillText(`${lat}°N`, mapX - 8 * scale, p.y);
  }

  ctx.fillStyle = "#171717";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.font = `600 ${Math.round(27 * scale)}px "Times New Roman", "Songti SC", serif`;
  ctx.fillText(`CMA-style Typhoon Track — ${displayName}, colored by central pressure`, width / 2, titleY);

  ctx.textAlign = "left";
  ctx.font = `${Math.round(14 * scale)}px "Arial", sans-serif`;
  ctx.fillStyle = "#333333";
  

  // Pressure color bar.
  const barW = Math.min(420 * scale, mapW * 0.36);
  const barH = 16 * scale;
  const barX = mapX + mapW - barW - 26 * scale;
  const barY = mapY + mapH - 34 * scale;
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, pressureTrackColor(920));
  grad.addColorStop(0.25, pressureTrackColor(940));
  grad.addColorStop(0.5, pressureTrackColor(960));
  grad.addColorStop(0.75, pressureTrackColor(980));
  grad.addColorStop(1, pressureTrackColor(1000));
  ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(barX - 8 * scale, barY - 18 * scale, barW + 16 * scale, 44 * scale);
  ctx.fillStyle = grad; ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = "#6b6b6b"; ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = "#555555"; ctx.font = `${Math.round(13 * scale)}px "Arial", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  [920, 940, 960, 980, 1000].forEach((v, i) => ctx.fillText(String(v), barX + (i / 4) * barW, barY - 2 * scale));
  ctx.textBaseline = "top"; ctx.fillText("Pressure (hPa)", barX + barW / 2, barY + barH + 3 * scale);
}


/** 3.7.1 multi-cyclone season overlay using the exact CMA track-report basemap/palette. */
export function drawSeasonTrackReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoons: Typhoon[],
  startDate: Date
) {
  const storms = typhoons.filter((ty) => (ty.history || []).length > 0);
  const all = storms.flatMap((ty) => ty.history || []);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (!all.length) return;
  const scale = Math.min(width / 1920, height / 1080);
  const portrait = height > width;
  const marginX = Math.max((portrait ? 30 : 72) * scale, width * (portrait ? 0.020 : 0.035));
  const titleY = Math.max(22 * scale, height * 0.018);
  const mapX = marginX;
  const mapY = Math.max(76 * scale, height * (portrait ? 0.055 : 0.075));
  const mapW = width - marginX * 2;
  const bottomReserve = Math.max(64 * scale, height * (portrait ? 0.045 : 0.075));
  const mapH = height - mapY - bottomReserve;

  let minLat = Math.min(...all.map((h) => h.lat));
  let maxLat = Math.max(...all.map((h) => h.lat));
  let minLon = Math.min(...all.map((h) => h.lon));
  let maxLon = Math.max(...all.map((h) => h.lon));
  const latSpan0 = Math.max(4, maxLat - minLat);
  const lonSpan0 = Math.max(5, maxLon - minLon);
  minLat -= Math.max(2.2, latSpan0 * 0.18); maxLat += Math.max(2.2, latSpan0 * 0.18);
  minLon -= Math.max(2.8, lonSpan0 * 0.18); maxLon += Math.max(2.8, lonSpan0 * 0.18);
  minLat = Math.max(-55, minLat); maxLat = Math.min(88, maxLat);
  minLon = Math.max(30, minLon); maxLon = Math.min(220, maxLon);
  const desiredAspect = mapW / mapH;
  let latSpan = maxLat - minLat; let lonSpan = maxLon - minLon;
  const meanLat = (minLat + maxLat) * 0.5;
  const correctedAspect = (lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180))) / Math.max(0.1, latSpan);
  if (correctedAspect < desiredAspect) {
    const needed = desiredAspect * latSpan / Math.max(0.35, Math.cos(meanLat * Math.PI / 180));
    const add = (needed - lonSpan) / 2; minLon -= add; maxLon += add;
  } else {
    const needed = lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180)) / desiredAspect;
    const add = (needed - latSpan) / 2; minLat -= add; maxLat += add;
  }
  const project = (lat: number, lon: number) => ({
    x: mapX + ((lon - minLon) / Math.max(0.1, maxLon - minLon)) * mapW,
    y: mapY + mapH - ((lat - minLat) / Math.max(0.1, maxLat - minLat)) * mapH
  });

  ctx.fillStyle = "#dff4f6"; ctx.fillRect(mapX, mapY, mapW, mapH);
  ctx.save(); ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
  if (landGeoJson?.features) {
    ctx.fillStyle = "#fffceb"; ctx.strokeStyle = "#8f9a9d"; ctx.lineWidth = Math.max(0.7, 0.9 * scale);
    const drawRing = (ring: any[]) => {
      let started = false; ctx.beginPath();
      ring.forEach((coord) => { const lon = Number(coord[0]), lat = Number(coord[1]); if (!Number.isFinite(lat) || !Number.isFinite(lon)) return; const p = project(lat, lon); if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); });
      if (started) { ctx.closePath(); ctx.fill(); strokeProductCoastlineRing(ctx, ring, project); }
    };
    landGeoJson.features.forEach((feature: any) => { const g = feature?.geometry; if (!g) return; if (g.type === "Polygon") (g.coordinates || []).slice(0,1).forEach(drawRing); else if (g.type === "MultiPolygon") (g.coordinates || []).forEach((poly:any)=>(poly||[]).slice(0,1).forEach(drawRing)); });
  }
  ctx.save(); ctx.strokeStyle = "rgba(89, 126, 134, 0.28)"; ctx.lineWidth = Math.max(0.6, 0.8 * scale); ctx.setLineDash([4 * scale, 4 * scale]);
  for (let lon = Math.ceil(minLon / 5) * 5; lon <= maxLon; lon += 5) { const p = project(minLat, lon); ctx.beginPath(); ctx.moveTo(p.x,mapY); ctx.lineTo(p.x,mapY+mapH); ctx.stroke(); }
  for (let lat = Math.ceil(minLat / 5) * 5; lat <= maxLat; lat += 5) { const p = project(lat,minLon); ctx.beginPath(); ctx.moveTo(mapX,p.y); ctx.lineTo(mapX+mapW,p.y); ctx.stroke(); }
  ctx.restore();

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  storms.forEach((ty, stormIndex) => {
    const history = ty.history || [];
    for (let i = 1; i < history.length; i++) {
      const a = project(history[i-1].lat, history[i-1].lon), b = project(history[i].lat, history[i].lon);
      ctx.strokeStyle = pressureTrackColor((history[i-1].pmin + history[i].pmin) / 2);
      ctx.lineWidth = Math.max(3.8, 5.2 * scale); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    history.forEach((h, i) => {
      if (i !== 0 && i !== history.length - 1 && !isCmaTyphoonProductTime(startDate, h.simHour)) return;
      const p = project(h.lat,h.lon); ctx.fillStyle = pressureTrackColor(h.pmin); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1.2,1.5*scale); ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(3.8,5.2*scale),0,Math.PI*2); ctx.fill(); ctx.stroke();
    });
    const anchor = history[Math.min(history.length - 1, Math.max(0, Math.floor(history.length * 0.2)))] || history[0];
    if (anchor) {
      const p = project(anchor.lat, anchor.lon); const label = `${stormIndex + 1}. ${ty.name || "未命名"}`;
      ctx.font = `600 ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`; const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.fillRect(p.x + 7*scale, p.y - 22*scale, tw + 10*scale, 22*scale);
      ctx.fillStyle = "#303030"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(label, p.x + 12*scale, p.y - 11*scale);
    }
  });
  ctx.restore();

  ctx.strokeStyle = "#333333"; ctx.lineWidth = Math.max(1,1.2*scale); ctx.strokeRect(mapX,mapY,mapW,mapH);
  ctx.fillStyle = "#555555"; ctx.font = `${Math.round(15*scale)}px "Times New Roman", serif`; ctx.textAlign="center"; ctx.textBaseline="top";
  for (let lon=Math.ceil(minLon/5)*5;lon<=maxLon;lon+=5){const p=project(minLat,lon);ctx.fillText(`${lon}°E`,p.x,mapY+mapH+7*scale);}
  ctx.textAlign="right"; ctx.textBaseline="middle";
  for (let lat=Math.ceil(minLat/5)*5;lat<=maxLat;lat+=5){const p=project(lat,minLon);ctx.fillText(`${lat}°N`,mapX-8*scale,p.y);}
  ctx.fillStyle="#171717"; ctx.textAlign="center"; ctx.textBaseline="top"; ctx.font=`600 ${Math.round(27*scale)}px "Times New Roman", "Songti SC", serif`; ctx.fillText(`CMA-style Typhoon Season Track — ${storms.length} cyclones`,width/2,titleY);

  const barW=Math.min(420*scale,mapW*0.36),barH=16*scale,barX=mapX+mapW-barW-26*scale,barY=mapY+mapH-34*scale;
  const grad=ctx.createLinearGradient(barX,0,barX+barW,0); [920,940,960,980,1000].forEach((v,i)=>grad.addColorStop(i/4,pressureTrackColor(v)));
  ctx.fillStyle="rgba(255,255,255,.9)";ctx.fillRect(barX-8*scale,barY-18*scale,barW+16*scale,44*scale);ctx.fillStyle=grad;ctx.fillRect(barX,barY,barW,barH);ctx.strokeStyle="#6b6b6b";ctx.strokeRect(barX,barY,barW,barH);
  ctx.fillStyle="#555555";ctx.font=`${Math.round(13*scale)}px "Arial", sans-serif`;ctx.textAlign="center";ctx.textBaseline="bottom";[920,940,960,980,1000].forEach((v,i)=>ctx.fillText(String(v),barX+(i/4)*barW,barY-2*scale));ctx.textBaseline="top";ctx.fillText("Pressure (hPa)",barX+barW/2,barY+barH+3*scale);
}

function meanQuadrants(r: any): number {
  if (!r) return 0;
  const vals = [r.ne, r.se, r.sw, r.nw].map(Number).filter((v) => Number.isFinite(v) && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function jmaWindAreaReport(h: any, level: "strong" | "storm"): { longestNm: number; shortestNm: number; direction: string } {
  const std = getStandardAverageWindRadii(Number(h.vmax || 0));
  const physical = physicalWindRadiiForState(h);
  const raw = level === "strong" ? physical.r7 : physical.r10;
  const fallback = level === "strong" ? std.r7 : std.r10;
  const vals = raw ? [raw.ne, raw.se, raw.sw, raw.nw].map(Number) : [];
  const valid = vals.filter(v => Number.isFinite(v) && v > 0);
  const mean = valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : fallback;
  const radii = {
    ne: Number(raw?.ne) > 0 ? Number(raw.ne) : mean,
    se: Number(raw?.se) > 0 ? Number(raw.se) : mean,
    sw: Number(raw?.sw) > 0 ? Number(raw.sw) : mean,
    nw: Number(raw?.nw) > 0 ? Number(raw.nw) : mean,
  };
  const g = calculateJmaWindCircleGeometry({
    lat: Number(h.lat), lon: Number(h.lon), vmaxCmaMs: Number(h.vmax || 0), landed: !!h.landed, radii, level
  }, checkPointOnLandGeoJson);
  if (!g.visible || g.radiusKm <= 0) return { longestNm: 0, shortestNm: 0, direction: "—" };
  const dNorth = (g.centerLat - Number(h.lat)) * 111.12;
  const dEast = (g.centerLon - Number(h.lon)) * 111.12 * Math.max(.2, Math.cos(Number(h.lat) * Math.PI / 180));
  const offset = Math.hypot(dEast, dNorth);
  let bearing = Math.atan2(dEast, dNorth) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  const direction = offset < 2 ? "SYM" : dirs[Math.round(bearing / 45) % 8];
  return { longestNm: (g.radiusKm + offset) / 1.852, shortestNm: Math.max(0, g.radiusKm - offset) / 1.852, direction };
}

function physicalWindRadiiForState(h: any) {
  const vmax = Number(h?.vmax || 0);
  const zero = { ne: 0, se: 0, sw: 0, nw: 0 };
  return {
    r7: vmax >= 13.9 ? (h?.r7 || zero) : zero,
    r10: vmax >= 24.5 ? (h?.r10 || zero) : zero,
    r12: vmax >= 32.7 ? (h?.r12 || zero) : zero,
  };
}

function derivedJtwcRadii(r: any, scale: number): [number, number, number, number] {
  if (!r) return [0, 0, 0, 0];
  return [r.ne, r.se, r.sw, r.nw].map((v) => Math.max(0, Math.round((Number(v) || 0) * scale / 1.852))) as [number, number, number, number];
}

function formatUtcCompact(startDate: Date, simHour: number): string {
  const d = new Date(startDate.getTime() + simHour * 3600000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCHours()).padStart(2, "0")}Z`;
}

function formatJmaPosition(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}${lon >= 0 ? "E" : "W"}`;
}

function selectAgencyHistory(typhoon: Typhoon, cadence: number | "CMA", startDate: Date) {
  const raw = (typhoon.history?.length ? typhoon.history : [{
    lat: typhoon.lat, lon: typhoon.lon, pmin: typhoon.pmin, vmax: typhoon.vmax, rmw: typhoon.rmw,
    r7: typhoon.r7, r10: typhoon.r10, r12: typhoon.r12, category: typhoon.category, simHour: 0
  } as any]).filter((h: any) => !isMinorIslandOperationalIgnored(h.lat, h.lon) || !h.landed);
  const firstHour = Number(raw[0]?.simHour || 0);
  const selected = raw.filter((h: any, i: number) => {
    if (i === 0 || i === raw.length - 1) return true;
    if (cadence === "CMA") return isCmaTyphoonProductTime(startDate, h.simHour);
    return Math.abs(((Number(h.simHour) - firstHour) / cadence) - Math.round((Number(h.simHour) - firstHour) / cadence)) < 1e-6;
  });
  return selected.length ? selected : raw;
}

function drawAgencyDataReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  startDate: Date,
  agency: Exclude<ReportAgency, "CMA">
) {
  const s = Math.min(width, height) / 1080;
  const displayName = getTyphoonDisplayName(typhoon, typhoon.simHour, startDate);
  const margin = Math.max(34 * s, width * 0.025);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(1.2, 1.6 * s);
  ctx.strokeRect(margin, margin, width - 2 * margin, height - 2 * margin);

  const landscape = width / height >= 1.15;
  const headerH = Math.max(104 * s, height * 0.105);
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  if (agency === "JMA") {
    fitCanvasFont(ctx, "気象庁　RSMC TOKYO - TYPHOON CENTER", width - 2 * margin - 40 * s, 32 * s, 22 * s, '"Yu Mincho","Hiragino Mincho ProN","Noto Serif CJK JP",serif', 700);
    ctx.fillText("気象庁　RSMC TOKYO - TYPHOON CENTER", width / 2, margin + 14 * s);
    const jmaTitle = `台風 ${displayName}　解析経過表`;
    fitCanvasFont(ctx, jmaTitle, width - 2 * margin - 50 * s, 27 * s, 19 * s, '"Yu Gothic","Noto Sans CJK JP",sans-serif', 700);
    ctx.fillText(jmaTitle, width / 2, margin + 49 * s);
    ctx.font = `${Math.round(15.5 * s)}px "Yu Gothic","Noto Sans CJK JP",sans-serif`;
    ctx.fillText("10分間平均風・30kt/50kt風域", width / 2, margin + 78 * s);
  } else {
    fitCanvasFont(ctx, "JOINT TYPHOON WARNING CENTER", width - 2 * margin - 40 * s, 35 * s, 24 * s, '"Arial",sans-serif', 700);
    ctx.fillText("JOINT TYPHOON WARNING CENTER", width / 2, margin + 18 * s);
    const jtwcTitle = `TROPICAL CYCLONE ANALYSIS — ${displayName.toUpperCase()}`;
    fitCanvasFont(ctx, jtwcTitle, width - 2 * margin - 50 * s, 29 * s, 19 * s, '"Arial",sans-serif', 700);
    ctx.fillText(jtwcTitle, width / 2, margin + 55 * s);
    ctx.font = `${Math.round(18 * s)}px "Arial",sans-serif`;
    ctx.fillText("1-MINUTE SUSTAINED WIND · 34/50/64-KT RADII", width / 2, margin + 88 * s);
  }

  const tableX = margin + 18 * s;
  const tableY = margin + headerH;
  const tableW = width - 2 * margin - 36 * s;
  const footerH = 12 * s;
  const tableH = height - tableY - margin - footerH;
  // JMA is a report skin only in TyphoonSIM. Simulator analysis points stay on the
  // CMA/NMC Beijing product clock to avoid cross-feature cadence drift.
  const cadence: number | "CMA" = agency === "JMA" ? "CMA" : 6;
  let rows = selectAgencyHistory(typhoon, cadence, startDate);
  const targetRowH = agency === "JMA" ? 64 * s : 61 * s;
  const maxRows = Math.max(4, Math.floor(tableH / targetRowH) - 1);
  if (rows.length > maxRows) {
    const stride = Math.ceil(rows.length / maxRows);
    rows = rows.filter((_: any, i: number) => i % stride === 0 || i === rows.length - 1);
  }

  const columns = agency === "JMA"
    ? [
        { t: "解析時刻 UTC", f: 0.12 },
        { t: "中心位置", f: 0.15 },
        { t: "中心気圧", f: 0.10 },
        { t: "最大風速\n10分 kt", f: 0.10 },
        { t: "50kt風域\n方位/長/短", f: 0.14 },
        { t: "30kt風域\n方位/長/短", f: 0.14 },
        { t: "階級", f: 0.12 },
        { t: "状態", f: 0.13 },
      ]
    : [
        { t: "DTG", f: 0.075 },
        { t: "POSITION", f: 0.11 },
        { t: "MSLP\nHPA", f: 0.07 },
        { t: "VMAX\n1-MIN KT", f: 0.08 },
        { t: "RMW\nNM", f: 0.06 },
        { t: "34 KT RADII\nNE SE SW NW", f: 0.17 },
        { t: "50 KT RADII\nNE SE SW NW", f: 0.17 },
        { t: "64 KT RADII\nNE SE SW NW", f: 0.17 },
        { t: "CLASS", f: 0.095 },
      ];
  const headerRowH = Math.max(48 * s, tableH / Math.max(7, rows.length + 2) * 1.1);
  const rowH = Math.min(targetRowH, (tableH - headerRowH) / Math.max(1, rows.length));

  const accent = "#333333";
  ctx.fillStyle = "#e8e8e8";
  ctx.fillRect(tableX, tableY, tableW, headerRowH);
  rows.forEach((_: any, i: number) => { if (i % 2 === 1) { ctx.fillStyle = "#f6f6f6"; ctx.fillRect(tableX, tableY + headerRowH + i * rowH, tableW, rowH); } });
  ctx.fillStyle = accent; ctx.fillRect(tableX, tableY, Math.max(5 * s, 7), headerRowH);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(0.8, 1.0 * s);
  ctx.strokeRect(tableX, tableY, tableW, headerRowH + rowH * rows.length);
  let x = tableX;
  const xPositions = [tableX];
  columns.forEach((c) => {
    x += tableW * c.f;
    xPositions.push(x);
  });
  xPositions.slice(1, -1).forEach((xx) => {
    ctx.beginPath(); ctx.moveTo(xx, tableY); ctx.lineTo(xx, tableY + headerRowH + rowH * rows.length); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(tableX, tableY + headerRowH); ctx.lineTo(tableX + tableW, tableY + headerRowH); ctx.stroke();
  for (let i = 1; i < rows.length; i++) {
    const yy = tableY + headerRowH + i * rowH;
    ctx.beginPath(); ctx.moveTo(tableX, yy); ctx.lineTo(tableX + tableW, yy); ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const headerFamily = agency === "JMA" ? '"Yu Gothic","Noto Sans CJK JP",sans-serif' : '"Arial Narrow","Arial",sans-serif';
  const bodyFamily = agency === "JMA" ? '"Yu Gothic","Noto Sans CJK JP",sans-serif' : '"Consolas","Courier New",monospace';
  columns.forEach((c, i) => {
    const cx = (xPositions[i] + xPositions[i + 1]) / 2;
    const cellW = xPositions[i + 1] - xPositions[i];
    const lines = c.t.split("\n");
    const lineGap = Math.min(18 * s, headerRowH / Math.max(2.8, lines.length + 0.5));
    lines.forEach((line, li) => {
      fitCanvasFont(ctx, line, cellW - 12 * s, Math.min(19.5 * s, headerRowH * 0.30), 12.5 * s, headerFamily, 700);
      ctx.fillText(line, cx, tableY + headerRowH / 2 + (li - (lines.length - 1) / 2) * lineGap);
    });
  });

  ctx.fillStyle = "#111";
  rows.forEach((h: any, ri: number) => {
    const y = tableY + headerRowH + ri * rowH + rowH / 2;
    const agencyWind = getAgencyIntensity(h.vmax, agency, "continuous");
    let vals: string[];
    if (agency === "JMA") {
      const r50 = jmaWindAreaReport(h, "storm");
      const r30 = jmaWindAreaReport(h, "strong");
      const grade = agencyWind.value >= 64 ? "TY" : agencyWind.value >= 48 ? "STS" : agencyWind.value >= 34 ? "TS" : "TD";
      const status = h.coldAirWarmCoreDestroyed || h.category === TyphoonCategory.RL
        ? "残留低圧"
        : h.extrTransition >= 1 ? "温帯低気圧" : h.landed ? "陸上" : "海上";
      vals = [
        formatUtcCompact(startDate, h.simHour),
        formatJmaPosition(h.lat, h.lon),
        `${Math.round(h.pmin)} hPa`,
        `${Math.round(agencyWind.value)} kt`,
        r50.longestNm > 0 ? `${r50.direction} ${Math.round(r50.longestNm)}/${Math.round(r50.shortestNm)}` : "—",
        r30.longestNm > 0 ? `${r30.direction} ${Math.round(r30.longestNm)}/${Math.round(r30.shortestNm)}` : "—",
        grade,
        status,
      ];
    } else {
      const physical = physicalWindRadiiForState(h);
      const r34 = derivedJtwcRadii(physical.r7, 0.90);
      const r50 = derivedJtwcRadii(physical.r10, 0.94);
      const r64 = derivedJtwcRadii(physical.r12, 0.96);
      const join = (r: number[]) => r.some((v) => v > 0) ? r.map((v) => String(v).padStart(2, "0")).join(" ") : "—";
      vals = [
        formatUtcCompact(startDate, h.simHour),
        formatJmaPosition(h.lat, h.lon),
        String(Math.round(h.pmin)),
        String(Math.round(agencyWind.value)),
        String(Math.round((h.rmw || 0) / 1.852)),
        join(r34), join(r50), join(r64), agencyWind.category,
      ];
    }
    vals.forEach((v, ci) => {
      const cx = (xPositions[ci] + xPositions[ci + 1]) / 2;
      const cellW = xPositions[ci + 1] - xPositions[ci];
      const maxBodyPx = Math.min((landscape ? 18.5 : 17.5) * s, rowH * 0.43);
      fitCanvasFont(ctx, v, cellW - 12 * s, maxBodyPx, 11.5 * s, bodyFamily, 400);
      ctx.fillText(v, cx, y);
    });
  });

}

function computeTrackViewport(history: any[], mapW: number, mapH: number) {
  let minLat = Math.min(...history.map((h) => h.lat));
  let maxLat = Math.max(...history.map((h) => h.lat));
  let minLon = Math.min(...history.map((h) => h.lon));
  let maxLon = Math.max(...history.map((h) => h.lon));
  const latSpan0 = Math.max(4, maxLat - minLat);
  const lonSpan0 = Math.max(5, maxLon - minLon);
  minLat -= Math.max(2.0, latSpan0 * 0.20); maxLat += Math.max(2.0, latSpan0 * 0.20);
  minLon -= Math.max(2.4, lonSpan0 * 0.20); maxLon += Math.max(2.4, lonSpan0 * 0.20);
  const desiredAspect = mapW / mapH;
  const meanLat = (minLat + maxLat) / 2;
  let latSpan = maxLat - minLat;
  let lonSpan = maxLon - minLon;
  const geoAspect = lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180)) / Math.max(0.1, latSpan);
  if (geoAspect < desiredAspect) {
    const needed = desiredAspect * latSpan / Math.max(0.35, Math.cos(meanLat * Math.PI / 180));
    const extra = (needed - lonSpan) / 2; minLon -= extra; maxLon += extra;
  } else {
    const needed = lonSpan * Math.max(0.35, Math.cos(meanLat * Math.PI / 180)) / desiredAspect;
    const extra = (needed - latSpan) / 2; minLat -= extra; maxLat += extra;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function drawMonochromeLand(
  ctx: CanvasRenderingContext2D,
  project: (lat: number, lon: number) => { x: number; y: number },
  lineWidth: number,
  landFill = "#f4f4f0",
  coastStroke = "#777"
) {
  if (!landGeoJson?.features) return;
  ctx.fillStyle = landFill;
  ctx.strokeStyle = coastStroke;
  ctx.lineWidth = lineWidth;
  const ring = (coords: any[]) => {
    let started = false;
    ctx.beginPath();
    coords.forEach((c) => {
      const lon = Number(c[0]), lat = Number(c[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const p = project(lat, lon);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    });
    if (started) { ctx.closePath(); ctx.fill(); strokeProductCoastlineRing(ctx, coords, project); }
  };
  landGeoJson.features.forEach((f: any) => {
    const g = f?.geometry;
    if (!g) return;
    if (g.type === "Polygon") (g.coordinates || []).slice(0, 1).forEach(ring);
    else if (g.type === "MultiPolygon") (g.coordinates || []).forEach((poly: any) => (poly || []).slice(0, 1).forEach(ring));
  });
}

function drawAgencyTrackReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  startDate: Date,
  agency: Exclude<ReportAgency, "CMA">
) {
  const history = selectAgencyHistory(typhoon, agency === "JMA" ? getJmaTrackDotCadenceHours() : 6, startDate);
  const displayName = getTyphoonDisplayName(typhoon, typhoon.simHour, startDate);
  const s = Math.min(width, height) / 1080;
  const landscape = width / height >= 1.22;
  const portrait = height / width >= 1.15;
  const margin = Math.max((portrait ? 18 : 24) * s, width * (portrait ? 0.012 : 0.016));
  const titleH = (portrait ? 72 : landscape ? 84 : 78) * s;
  // 3.5.7: JTWC path reports use the same full-map composition as JMA/CMA.  The former
  // side/bottom analysis list is intentionally removed so the product is path-only.
  const sideW = 0;
  const bottomPanelH = 0;
  const mapX = margin;
  const mapY = margin + titleH;
  const mapW = width - 2 * margin - sideW;
  const mapH = height - mapY - margin - bottomPanelH;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = Math.max(1.0, 1.4 * s);
  ctx.strokeRect(margin, margin, width - 2 * margin, height - 2 * margin);

  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (agency === "JMA") {
    const trackTitle = `気象庁 RSMC東京　台風 ${displayName} 経路図`;
    fitCanvasFont(ctx, trackTitle, width - 2 * margin - 36 * s, 30 * s, 20 * s, '"Yu Mincho","Noto Serif CJK JP",serif', 700);
    ctx.fillText(trackTitle, width / 2, margin + 14 * s);
    const trackSub = "○ 解析位置（白色）　実線：台風/TS以上　破線：熱帯低気圧";
    fitCanvasFont(ctx, trackSub, width - 2 * margin - 44 * s, 14 * s, 10.5 * s, '"Yu Gothic","Noto Sans CJK JP",sans-serif', 400);
    ctx.fillText(trackSub, width / 2, margin + 52 * s);
  } else {
    const trackTitle = `JOINT TYPHOON WARNING CENTER — ${displayName.toUpperCase()}`;
    fitCanvasFont(ctx, trackTitle, width - 2 * margin - 36 * s, 29 * s, 19 * s, '"Arial",sans-serif', 700);
    ctx.fillText(trackTitle, width / 2, margin + 12 * s);
    const trackSub = "BEST-TRACK STYLE TRACK — 1-MIN WIND";
    fitCanvasFont(ctx, trackSub, width - 2 * margin - 44 * s, 18 * s, 12 * s, '"Arial",sans-serif', 700);
    ctx.fillText(trackSub, width / 2, margin + 48 * s);
  }

  const vp = computeTrackViewport(history, mapW, mapH);
  const project = (lat: number, lon: number) => ({
    x: mapX + (lon - vp.minLon) / (vp.maxLon - vp.minLon) * mapW,
    y: mapY + mapH - (lat - vp.minLat) / (vp.maxLat - vp.minLat) * mapH
  });

  ctx.save();
  ctx.beginPath(); ctx.rect(mapX, mapY, mapW, mapH); ctx.clip();
  const seaColor = agency === "JTWC" ? "#b7c9da" : JMA_PRODUCT_COLORS.ocean;
  const landColor = agency === "JTWC" ? "#eadb88" : JMA_PRODUCT_COLORS.land;
  const coastColor = agency === "JTWC" ? "#7f7250" : LOCAL_VECTOR_BASEMAPS.jma.coast;
  ctx.fillStyle = seaColor; ctx.fillRect(mapX, mapY, mapW, mapH);
  drawMonochromeLand(ctx, project, Math.max(0.5, 0.8 * s), landColor, coastColor);

  const gridStep = (vp.maxLon - vp.minLon) > 30 ? 10 : 5;
  ctx.strokeStyle = agency === "JTWC" ? "rgba(50,62,72,.55)" : JMA_PRODUCT_COLORS.grid; ctx.lineWidth = Math.max(0.5, 0.7 * s);
  for (let lon = Math.ceil(vp.minLon / gridStep) * gridStep; lon <= vp.maxLon; lon += gridStep) {
    const p = project(vp.minLat, lon); ctx.beginPath(); ctx.moveTo(p.x, mapY); ctx.lineTo(p.x, mapY + mapH); ctx.stroke();
  }
  for (let lat = Math.ceil(vp.minLat / 5) * 5; lat <= vp.maxLat; lat += 5) {
    const p = project(lat, vp.minLon); ctx.beginPath(); ctx.moveTo(mapX, p.y); ctx.lineTo(mapX + mapW, p.y); ctx.stroke();
  }

  for (let i = 1; i < history.length; i++) {
    const a: any = history[i - 1], b: any = history[i];
    const p1 = project(a.lat, a.lon), p2 = project(b.lat, b.lon);
    const wind = getAgencyIntensity((a.vmax + b.vmax) / 2, agency, "continuous").value;
    ctx.strokeStyle = agency === "JTWC" ? "#b01f3f" : JMA_PRODUCT_COLORS.forecast;
    ctx.lineWidth = Math.max(2.1, (agency === "JTWC" ? 3.2 : 2.7) * s);
    ctx.setLineDash(agency === "JMA" && wind < 34 ? [7 * s, 6 * s] : []);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // 3.5.7: JTWC display cadence now mirrors the clean JMA map cadence.  Source fixes remain
  // six-hourly best-track points are retained internally, but the displayed JMA-style map marks
  // only one node every 24 hours (plus endpoints) to match the requested visual cadence.
  // Labels are plain operational text with no halo/glow/outline. Track geometry is an
  // explicit obstacle, and every label keeps a leader back to its own analysis dot.
  const agencyTrackSegments: Array<[TrackScreenPoint, TrackScreenPoint]> = history.slice(1).map((h: any, i: number) => [project(history[i].lat, history[i].lon), project(h.lat, h.lon)]);
  const agencyLabelRects: TrackLabelRect[] = [];
  const firstReportHour = Number(history[0]?.simHour || 0);
  history.forEach((h: any, i: number) => {
    const p = project(h.lat, h.lon);
    const d = new Date(startDate.getTime() + h.simHour * 3600000);
    const agencyWind = getAgencyIntensity(h.vmax, agency, "continuous");
    const relHour = Number(h.simHour || 0) - firstReportHour;
    const isEndpoint = i === 0 || i === history.length - 1;
    if (agency === "JMA") {
      // JMA history has already been reduced to the operational display cadence above. Draw every
      // selected analysis point instead of checking UTC clock hours again: an arbitrary simulation
      // start minute/hour can otherwise make every interior dot disappear from the report.
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1.0, 1.35 * s);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3.2, 4.8 * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const labelThis = isEndpoint || Math.abs(relHour / getJmaTrackDotCadenceHours() - Math.round(relHour / getJmaTrackDotCadenceHours())) < 1e-6;
      if (labelThis) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.round(15 * s)}px "Yu Gothic","Noto Sans CJK JP",sans-serif`;
        const text = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${Math.round(agencyWind.value)}kt`;
        const placed = placeTrackLabel(ctx, p, [text], { x: mapX, y: mapY, w: mapW, h: mapH }, agencyTrackSegments, agencyLabelRects, s, 17 * s, i % 4);
        ctx.strokeStyle = "rgba(255,255,255,.82)";
        ctx.lineWidth = Math.max(.7, .9 * s);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(placed.leader.x, placed.leader.y);
        ctx.stroke();
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(text, placed.rect.x + 3 * s, placed.rect.y + 2 * s);
      }
    } else {
      // JTWC source history is six-hourly in this product. Keep every source dot visible and only
      // thin text labels to a relative 12-hour cadence, independent of the wall-clock init hour.
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#b01f3f";
      ctx.lineWidth = Math.max(1.1, 1.65 * s);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3.5, 4.8 * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const isTwelveHourly = Math.abs(relHour / 12 - Math.round(relHour / 12)) < 1e-6;
      if (isTwelveHourly || isEndpoint) {
        const day = String(d.getUTCDate()).padStart(2, "0");
        const hour = String(d.getUTCHours()).padStart(2, "0");
        const wind = Math.round(agencyWind.value);
        const fontPx = Math.max(11, Math.round(14.5 * s));
        const lines = [`${day}/${hour}Z`, `${wind}KTS`];
        ctx.fillStyle = "#6b1730";
        ctx.font = `600 ${fontPx}px "Arial",sans-serif`;
        const placed = placeTrackLabel(ctx, p, lines, { x: mapX, y: mapY, w: mapW, h: mapH }, agencyTrackSegments, agencyLabelRects, s, fontPx * 1.08, (i + 1) % 4);
        ctx.strokeStyle = "rgba(107,23,48,.76)";
        ctx.lineWidth = Math.max(.7, .9 * s);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(placed.leader.x, placed.leader.y);
        ctx.stroke();
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(lines[0], placed.rect.x + 3 * s, placed.rect.y + 2 * s);
        ctx.fillText(lines[1], placed.rect.x + 3 * s, placed.rect.y + 2 * s + fontPx * 1.08);
      }
    }
  });

  // Landfall crosses are intentionally omitted from agency path reports; landfall events have a dedicated report.
  ctx.restore();

  ctx.strokeStyle = agency === "JTWC" ? "#465563" : "#e4edf7"; ctx.strokeRect(mapX, mapY, mapW, mapH);
  ctx.fillStyle = "#111"; ctx.font = `${Math.round(10.5 * s)}px "Arial",sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let lon = Math.ceil(vp.minLon / gridStep) * gridStep; lon <= vp.maxLon; lon += gridStep) {
    const p = project(vp.minLat, lon); ctx.fillText(`${lon.toFixed(0)}°E`, p.x, mapY + mapH + 4 * s);
  }


}

function drawLandfallDetailReport(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  typhoon: Typhoon,
  startDate: Date,
  agency: ReportAgency,
  landfall: LandfallPoint,
  index: number
) {
  const s = Math.min(width, height) / 1080;
  const margin = Math.max(34 * s, width * 0.022);
  const landscape = width / height >= 1.18;
  const history: any[] = typhoon.history?.length ? typhoon.history as any[] : [typhoon as any];
  const nearestState = (targetHour: number) => history.reduce((best, h) =>
    !best || Math.abs(h.simHour - targetHour) < Math.abs(best.simHour - targetHour) ? h : best, null as any
  ) || typhoon;
  const state: any = nearestState(landfall.time);
  const displayName = getTyphoonDisplayName(typhoon, landfall.time, startDate);
  const before: any = nearestState(Math.max(0, landfall.time - 6));
  const after: any = nearestState(landfall.time + 6);
  const ai = getAgencyIntensity(state.vmax, agency, "continuous");
  const t = new Date(startDate.getTime() + landfall.time * 3600000);
  const jst = new Date(t.getTime() + 9 * 3600000);
  const bjt = new Date(t.getTime() + 8 * 3600000);
  const region = cleanLandName(landfall.region || state.osmLandName || "coastal area");
  const meanR = (r:any) => meanQuadrants(r);
  const physicalRadii = physicalWindRadiiForState(state);
  const r7 = meanR(physicalRadii.r7), r10 = meanR(physicalRadii.r10), r12 = meanR(physicalRadii.r12);
  const reportState = { ...state, ...physicalRadii };
  const jma30 = jmaWindAreaReport(reportState, "strong"), jma50 = jmaWindAreaReport(reportState, "storm");
  const damage = clamp(Number(state.structuralDamageSeverity ?? (1 - Number(state.structuralDamagePenaltyFactor ?? 1))), 0, 1);
  const integrity = clamp(Number(state.eyewallIntegrity ?? 0), 0, 1);
  const compact = clamp(Number(state.coreCompactness ?? 0), 0, 1);
  const moisture = clamp(Number(state.moistureReservoir ?? 0), 0, 1);
  const prep = clamp(Number(state.preparednessIndex ?? 0), 0, 1);
  const surprise = clamp(Number(state.forecastSurpriseIndex ?? 0), 0, 1);
  const sixHourDecay = Math.max(0, Number(state.vmax || 0) - Number(after.vmax || state.vmax || 0));
  const preTrend = Number(state.vmax || 0) - Number(before.vmax || state.vmax || 0);
  const structureNames: Record<string, {zh:string;ja:string;en:string}> = {
    tropical_depression:{zh:"热带低压松散涡旋",ja:"熱帯低気圧型の緩い循環",en:"loose tropical-depression vortex"},
    loose_cdo:{zh:"松散中央密集云团",ja:"組織化途上のCDO",en:"loosely organized CDO"},
    convective_burst:{zh:"爆发对流主导",ja:"対流バースト卓越",en:"convective-burst dominant core"},
    reburst_eye_opening:{zh:"强对流重组并开眼",ja:"対流再組織化・眼の形成",en:"convective reorganization and eye opening"},
    failed_eye_opening:{zh:"爆发对流失败/卷眼堵塞",ja:"対流バースト失敗・眼の雲埋め",en:"failed eye opening / cloud-filled eye"},
    sheared_convective_burst:{zh:"强风切下偏置对流爆发",ja:"強いシア下の偏位対流バースト",en:"sheared displaced convective burst"},
    binary_interaction_sheared:{zh:"双台风互扰风切结构",ja:"二重台風相互作用・シア構造",en:"binary-interaction shear structure"},
    binary_merger_reorganizing:{zh:"双台风合并后内核重组",ja:"二重台風合流後のコア再組織化",en:"post-merger inner-core reorganization"},
    landfall_intact_cdo:{zh:"平原登陆后完整湿核CDO",ja:"平地上陸後も維持される湿潤CDO",en:"marine-fed intact CDO after plains landfall"},
    landfall_broken_eyewall:{zh:"登陆后破损眼墙",ja:"上陸後の破断した眼壁",en:"broken eyewall after landfall"},
    tightening_core:{zh:"内核收紧阶段",ja:"内部コア収縮・組織化",en:"tightening inner core"},
    mature_eyewall:{zh:"成熟闭合眼墙",ja:"成熟した閉じた眼壁",en:"mature closed eyewall"},
    ewrc_double:{zh:"双眼墙置换阶段",ja:"二重眼壁・置換過程",en:"concentric eyewall replacement"},
    post_ewrc_broad:{zh:"置换后宽阔环流",ja:"眼壁置換後の広い循環",en:"post-ERC broad circulation"},
    terrain_hollow_bands:{zh:"地形破坏后空洞中心/浓密雨带",ja:"地形損傷後の空洞状中心と強い雨帯",en:"terrain-damaged hollow center with dense bands"},
    terrain_clogged_loose:{zh:"地形扰动后风眼堵塞/内核松动",ja:"地形影響による眼の雲埋め・コア緩み",en:"terrain-clogged eye with loosened core"},
    terrain_displaced_core:{zh:"低层中心与对流错位",ja:"低層中心と対流中心のずれ",en:"displaced low-level and convective centers"},
    sheared_small_core:{zh:"风切后小内核+大环流",ja:"鉛直シア後の小型コア・広域循環",en:"sheared small core within broad circulation"},
    rainband_dominant:{zh:"雨带主导结构",ja:"雨帯卓越型構造",en:"rainband-dominant structure"},
    moisture_loaded_broad:{zh:"高水汽宽阔结构",ja:"高水蒸気・広域循環型",en:"moisture-loaded broad vortex"},
    cdo_mature:{zh:"成熟中央密集云团（CDO）",ja:"成熟した中央密集雲（CDO）",en:"mature central dense overcast (CDO)"},
    dvorak_cmg:{zh:"极冷云顶环（CMG）",ja:"極低温雲頂リング（CMG）",en:"very-cold cloud-top ring (CMG)"},
    dvorak_cdg:{zh:"深冷云顶环（CDG）",ja:"低温雲頂リング（CDG）",en:"deep-cold cloud-top ring (CDG)"},
    dvorak_w_ring:{zh:"W环极值眼区",ja:"Wリング極値眼域",en:"W-ring extreme eye scene"},
    dry_slot_eroding:{zh:"干空气槽卷入·内核仍部分受保护",ja:"乾燥スロット侵入・コア一部保護",en:"dry-slot erosion with partially protected core"},
    dry_leaf:{zh:"干空气侵入·干菜化",ja:"乾燥空気侵入・崩れた非対称雲域",en:"dry-air eroded / leaf-like asymmetric core"},
    incense_coil:{zh:"干空气侵入·蚊香化",ja:"乾燥空気侵入・細い螺旋雨帯型",en:"dry-air eroded spiral / incense-coil form"},
    dry_rebuilding_core:{zh:"干槽隔离·再湿化小核心重建",ja:"乾燥スロット隔離・再湿潤化コア",en:"dry-slot isolation / re-moistening small-core rebuilding"},
    westerly_sheared:{zh:"西风带牵引·对流偏置",ja:"偏西風帯・対流の強い偏位",en:"westerly-sheared asymmetric convection"},
    subtropical_cyclone:{zh:"副热带气旋·外围强风/浅暖核",ja:"亜熱帯低気圧・外側強風/浅い暖気核",en:"subtropical cyclone with outer wind maximum / shallow warm core"},
    extratropical_transition:{zh:"温带化后段·锋面生成",ja:"温帯低気圧化後期・前線形成",en:"late extratropical transition / frontogenesis"},
    extratropical_cyclone:{zh:"温带气旋·冷暖锋强风带",ja:"温帯低気圧・前線帯の強風",en:"extratropical cyclone with frontal wind bands"},
    cold_air_remnant_low:{zh:"强冷空气摧毁暖心·残留低压云团",ja:"強い寒気で暖気核崩壊・残留低圧雲域",en:"warm-core collapse into a diffuse remnant low"},
    landfall_disintegrating:{zh:"登陆后结构逐渐瓦解",ja:"上陸後の構造崩壊過程",en:"post-landfall structural disintegration"},
  };
  const st = structureNames[state.structureMode] || {zh:"常规台风结构",ja:"通常の台風構造",en:"standard tropical-cyclone structure"};
  const directionTextZh=(d:number)=>["北","东北","东","东南","南","西南","西","西北"][Math.round((((d%360)+360)%360)/45)%8];
  const directionTextJa=(d:number)=>["北","北東","東","南東","南","南西","西","北西"][Math.round((((d%360)+360)%360)/45)%8];
  const directionTextEn=(d:number)=>["N","NE","E","SE","S","SW","W","NW"][Math.round((((d%360)+360)%360)/45)%8];
  const dir = Number(state.direction || 0), speed = Number(state.speed || 0);
  const accent = agency === "CMA" ? "#b42318" : agency === "JMA" ? "#c62828" : "#a51532";
  const soft = agency === "JMA" ? "#eef5ff" : "#f7f1ed";
  ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);ctx.strokeStyle="#222222";ctx.lineWidth=Math.max(1.2,1.5*s);ctx.strokeRect(margin,margin,width-2*margin,height-2*margin);
  ctx.fillStyle=accent;ctx.fillRect(margin,margin,Math.max(8,10*s),height-2*margin);

  const serif=agency==="JMA"?'"Yu Mincho","Noto Serif CJK JP",serif':agency==="CMA"?'"Songti SC","Noto Serif CJK SC","Times New Roman",serif':'"Arial","Helvetica",sans-serif';
  const sans=agency==="JMA"?'"Yu Gothic","Noto Sans CJK JP",sans-serif':agency==="CMA"?'"Microsoft YaHei","Noto Sans CJK SC",sans-serif':'"Arial","Helvetica",sans-serif';
  ctx.textAlign="left";ctx.textBaseline="top";ctx.fillStyle="#171717";
  const title=agency==="CMA"?`第${index+1}次登陆详细分析报告`:agency==="JMA"?`第${index+1}回 上陸時詳細解析`:`LANDFALL ANALYSIS REPORT · EVENT ${index+1}`;
  fitCanvasFont(ctx,title,width-2*margin-70*s,31*s,21*s,serif,700);
  ctx.fillText(title,margin+30*s,margin+18*s);
  ctx.fillStyle="#555555";ctx.font=`${Math.round(14.5*s)}px ${sans}`;
  const sub=agency==="CMA"?`${displayName} · CMA登陆分析`:agency==="JMA"?`台風 ${displayName} · 上陸詳細解析`:`${displayName.toUpperCase()} · LANDFALL ANALYSIS`;
  ctx.fillText(sub,margin+31*s,margin+61*s);
  ctx.fillStyle=accent;ctx.fillRect(margin+31*s,margin+88*s,width-2*margin-62*s,2.2*s);

  const top=margin+108*s;
  const leftX=margin+31*s;
  const gap=22*s;
  const contentW=width-2*margin-62*s;
  const mapW=landscape?contentW*.43:contentW;
  const mapH=landscape?Math.min(height*.46,430*s):Math.min(height*.31,310*s);
  const rightX=landscape?leftX+mapW+gap:leftX;
  const rightY=landscape?top:top+mapH+gap;
  const rightW=landscape?contentW-mapW-gap:contentW;

  // Local landfall map: no historical path. Only the landfall X and the agency wind areas
  // at the landfall analysis time are shown. Base-map colors match each agency path report.
  const mapSea = agency === "JTWC" ? "#b7c9da" : agency === "JMA" ? JMA_PRODUCT_COLORS.ocean : "#dff4f6";
  const mapLand = agency === "JTWC" ? "#eadb88" : agency === "JMA" ? JMA_PRODUCT_COLORS.land : "#fffceb";
  const mapCoast = agency === "JTWC" ? "#7f7250" : agency === "JMA" ? LOCAL_VECTOR_BASEMAPS.jma.coast : "#8f9a9d";
  ctx.fillStyle=mapSea;ctx.fillRect(leftX,top,mapW,mapH);ctx.strokeStyle="#6b6b6b";ctx.lineWidth=Math.max(.8,1*s);ctx.strokeRect(leftX,top,mapW,mapH);
  const maxWindKm=Math.max(120, ...(physicalRadii.r7 ? [physicalRadii.r7.ne,physicalRadii.r7.se,physicalRadii.r7.sw,physicalRadii.r7.nw] : [0]));
  const spanLat=Math.max(7, Math.min(16, maxWindKm/111.12*2.8));
  const cos=Math.max(.45,Math.cos(landfall.lat*Math.PI/180)),spanLon=spanLat*(mapW/mapH)/cos;
  const minLat=landfall.lat-spanLat/2,maxLat=landfall.lat+spanLat/2,minLon=landfall.lon-spanLon/2,maxLon=landfall.lon+spanLon/2;
  const proj=(lat:number,lon:number)=>({x:leftX+(lon-minLon)/(maxLon-minLon)*mapW,y:top+mapH-(lat-minLat)/(maxLat-minLat)*mapH});
  const scaleQuad=(q:any,f:number)=>q?({ne:(q.ne||0)*f,se:(q.se||0)*f,sw:(q.sw||0)*f,nw:(q.nw||0)*f}):undefined;
  const drawQuadArea=(q:any, stroke:string, fill:string|null, lineWidth:number)=>{
    if(!q || Math.max(q.ne||0,q.se||0,q.sw||0,q.nw||0)<=0)return;
    // Draw each quadrant as a constant-radius arc, then join the adjacent radii exactly on
    // N/E/S/W.  The previous radiusAt() polyline changed radius one 3° sample after a
    // quadrant boundary, producing diagonal/slanted joins in CMA/JTWC landfall reports.
    const pointAt=(bearing:number,radiusKm:number)=>{
      const rad=bearing*Math.PI/180;
      const lat=landfall.lat+(radiusKm*Math.cos(rad))/111.12;
      const lon=landfall.lon+(radiusKm*Math.sin(rad))/(111.12*cos);
      return proj(lat,lon);
    };
    const appendArc=(from:number,to:number,radiusKm:number,move:boolean)=>{
      for(let a=from;a<=to+1e-6;a+=3){
        const z=pointAt(Math.min(a,to),radiusKm);
        if(move){ctx.moveTo(z.x,z.y);move=false;}else ctx.lineTo(z.x,z.y);
      }
      // Guarantee the exact cardinal endpoint even when the sampling step changes later.
      const end=pointAt(to,radiusKm);ctx.lineTo(end.x,end.y);
    };
    const ne=Math.max(0,q.ne||0),se=Math.max(0,q.se||0),sw=Math.max(0,q.sw||0),nw=Math.max(0,q.nw||0);
    ctx.beginPath();
    appendArc(0,90,ne,true);
    // Same bearing, different radius => a true horizontal/vertical radial join.
    {const z=pointAt(90,se);ctx.lineTo(z.x,z.y);}
    appendArc(90,180,se,false);
    {const z=pointAt(180,sw);ctx.lineTo(z.x,z.y);}
    appendArc(180,270,sw,false);
    {const z=pointAt(270,nw);ctx.lineTo(z.x,z.y);}
    appendArc(270,360,nw,false);
    {const z=pointAt(0,ne);ctx.lineTo(z.x,z.y);}
    ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.lineJoin="round";ctx.stroke();
  };
  ctx.save();ctx.beginPath();ctx.rect(leftX,top,mapW,mapH);ctx.clip();drawMonochromeLand(ctx,proj,Math.max(.55,.75*s),mapLand,mapCoast);
  if(agency === "JMA"){
    // Match the live JMA wind-area renderer: 30/50-kt areas are displaced circles derived from
    // the four model quadrants, with the same threshold conversion and major-land squeeze logic.
    const drawJmaCircle=(q:any,level:"strong"|"storm",stroke:string,lineWidth:number)=>{
      if(!q)return;
      const g=calculateJmaWindCircleGeometry({
        lat:landfall.lat,lon:landfall.lon,vmaxCmaMs:Number(state.vmax||0),landed:true,radii:q,level
      },checkPointOnLandGeoJson);
      if(!g.visible||g.radiusKm<=0)return;
      const center=proj(g.centerLat,g.centerLon);
      const edgeLat=proj(g.centerLat+g.radiusKm/111.12,g.centerLon);
      const edgeLon=proj(g.centerLat,g.centerLon+g.radiusKm/(111.12*Math.max(.2,Math.cos(g.centerLat*Math.PI/180))));
      const rx=Math.abs(edgeLon.x-center.x),ry=Math.abs(edgeLat.y-center.y);
      ctx.beginPath();ctx.ellipse(center.x,center.y,Math.max(.5,rx),Math.max(.5,ry),0,0,Math.PI*2);
      ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();
    };
    drawJmaCircle(physicalRadii.r7,"strong",JMA_PRODUCT_COLORS.strongWind,Math.max(1.4,1.8*s));
    drawJmaCircle(physicalRadii.r10,"storm",JMA_PRODUCT_COLORS.stormWind,Math.max(1.5,2.0*s));
  }else{
    const rr7=agency === "JTWC"?scaleQuad(physicalRadii.r7,.90):physicalRadii.r7;
    const rr10=agency === "JTWC"?scaleQuad(physicalRadii.r10,.94):physicalRadii.r10;
    const rr12=agency === "JTWC"?scaleQuad(physicalRadii.r12,.96):physicalRadii.r12;
    drawQuadArea(rr7,"#f39c12","rgba(243,156,18,.11)",Math.max(1.3,1.5*s));
    drawQuadArea(rr10,"#d35400","rgba(211,84,0,.11)",Math.max(1.3,1.5*s));
    drawQuadArea(rr12,"#c0392b","rgba(192,57,43,.11)",Math.max(1.3,1.5*s));
  }
  const lp=proj(landfall.lat,landfall.lon);ctx.strokeStyle=accent;ctx.lineWidth=Math.max(2,2.5*s);const cr=7*s;ctx.beginPath();ctx.moveTo(lp.x-cr,lp.y-cr);ctx.lineTo(lp.x+cr,lp.y+cr);ctx.moveTo(lp.x+cr,lp.y-cr);ctx.lineTo(lp.x-cr,lp.y+cr);ctx.stroke();
  ctx.restore();ctx.fillStyle="#333333";fitCanvasFont(ctx,region,mapW-24*s,13*s,10.5*s,sans,600);ctx.fillText(region,leftX+12*s,top+10*s);

  const rows: Array<[string,string]> = agency==="JMA" ? [
    ["上陸時刻",`${jst.getUTCFullYear()}/${String(jst.getUTCMonth()+1).padStart(2,"0")}/${String(jst.getUTCDate()).padStart(2,"0")} ${String(jst.getUTCHours()).padStart(2,"0")} JST`],
    ["上陸位置",`${region} · ${landfall.lat.toFixed(2)}N ${landfall.lon.toFixed(2)}E`],["中心気圧",`${Math.round(state.pmin)} hPa`],["最大風速（10分）",`${Math.round(ai.value)} kt · ${ai.category}`],["移動",`${directionTextJa(dir)} ${Math.round(speed)} km/h`],["最大風半径 RMW",`${Math.round((state.rmw||0)/1.852)} nm`],["強風域 30kt",jma30.longestNm?`${jma30.direction} ${Math.round(jma30.longestNm)}/${Math.round(jma30.shortestNm)} nm`:"—"],["暴風域 50kt",jma50.longestNm?`${jma50.direction} ${Math.round(jma50.longestNm)}/${Math.round(jma50.shortestNm)} nm`:"—"],["内部構造",st.ja],["眼壁完全度",`${Math.round(integrity*100)}%`]
  ] : agency==="JTWC" ? [
    ["LANDFALL DTG",`${String(t.getUTCDate()).padStart(2,"0")}${String(t.getUTCHours()).padStart(2,"0")}Z`],["LOCATION",`${region.toUpperCase()} · ${landfall.lat.toFixed(2)}N ${landfall.lon.toFixed(2)}E`],["MSLP",`${Math.round(state.pmin)} hPa`],["VMAX (1-MIN)",`${Math.round(ai.value)} kt · ${ai.category}`],["MOTION",`${directionTextEn(dir)} / ${Math.round(speed/1.852)} kt`],["RMW",`${Math.round((state.rmw||0)/1.852)} nm`],["34-KT MEAN RADIUS",r7?`${Math.round(r7*.90/1.852)} nm`:"—"],["50-KT MEAN RADIUS",r10?`${Math.round(r10*.94/1.852)} nm`:"—"],["64-KT MEAN RADIUS",r12?`${Math.round(r12*.96/1.852)} nm`:"—"],["CORE STRUCTURE",st.en]
  ] : [
    ["登陆时刻",`${bjt.getUTCFullYear()}年${bjt.getUTCMonth()+1}月${bjt.getUTCDate()}日${String(bjt.getUTCHours()).padStart(2,"0")}时（北京时）`],["登陆位置",`${region} · ${landfall.lat.toFixed(2)}°N ${landfall.lon.toFixed(2)}°E`],["中心气压",`${Math.round(state.pmin)} hPa`],["最大风速（CMA口径）",`${ai.value.toFixed(1)} m/s · ${ai.category}`],["移动",`${directionTextZh(dir)} ${Math.round(speed)} km/h`],["最大风半径 RMW",`${Math.round(state.rmw||0)} km`],["7级风圈平均半径",r7?`${Math.round(r7)} km`:"—"],["10级风圈平均半径",r10?`${Math.round(r10)} km`:"—"],["12级风圈平均半径",r12?`${Math.round(r12)} km`:"—"],["核心结构",st.zh]
  ];
  const before6 = Number(state.vmax || 0) - Number(before.vmax || state.vmax || 0);
  const after6 = Math.max(0, Number(state.vmax || 0) - Number(after.vmax || state.vmax || 0));
  const extraRows: Array<[string,string]> = [];
  if (agency === "JMA") {
    extraRows.push(["上陸前6時間の強度変化", `${before6 >= 0 ? "+" : ""}${before6.toFixed(1)} m/s`]);
    extraRows.push(["上陸後6時間の模擬減衰", `${after6.toFixed(1)} m/s`]);
    extraRows.push(["コア損傷度", `${Math.round(damage * 100)}%`], ["水蒸気リザーバ", `${Math.round(moisture * 100)}%`]);
    if (Number.isFinite(Number(state.shear))) extraRows.push(["鉛直シアー", `${Number(state.shear).toFixed(1)} kt`]);
    if (Number.isFinite(Number(state.sst))) extraRows.push(["上陸直前SST", `${Number(state.sst).toFixed(1)} ℃`]);
    extraRows.push(["防災準備 / 進路急変", `${Math.round(prep * 100)}% / ${Math.round(surprise * 100)}%`]);
  } else if (agency === "JTWC") {
    extraRows.push(["6-HR PRE-LANDFALL TREND", `${before6 >= 0 ? "+" : ""}${(before6 * 1.94384).toFixed(0)} KT`]);
    extraRows.push(["6-HR POST-LANDFALL DECAY", `${(after6 * 1.94384).toFixed(0)} KT`]);
    extraRows.push(["CORE DAMAGE", `${Math.round(damage * 100)}%`], ["MOISTURE RESERVOIR", `${Math.round(moisture * 100)}%`]);
    if (Number.isFinite(Number(state.shear))) extraRows.push(["VERTICAL SHEAR", `${Number(state.shear).toFixed(1)} KT`]);
    if (Number.isFinite(Number(state.sst))) extraRows.push(["PRE-LANDFALL SST", `${Number(state.sst).toFixed(1)} C`]);
    extraRows.push(["PREPAREDNESS / SURPRISE", `${Math.round(prep * 100)}% / ${Math.round(surprise * 100)}%`]);
  } else {
    extraRows.push(["登陆前6小时强度变化", `${before6 >= 0 ? "+" : ""}${before6.toFixed(1)} m/s`]);
    extraRows.push(["登陆后6小时模拟减弱", `${after6.toFixed(1)} m/s`]);
    extraRows.push(["核心损伤度", `${Math.round(damage * 100)}%`], ["水汽储库", `${Math.round(moisture * 100)}%`]);
    if (Number.isFinite(Number(state.shear))) extraRows.push(["垂直风切", `${Number(state.shear).toFixed(1)} kt`]);
    if (Number.isFinite(Number(state.sst))) extraRows.push(["登陆前海温", `${Number(state.sst).toFixed(1)} ℃`]);
    extraRows.push(["防灾准备 / 路径突变", `${Math.round(prep * 100)}% / ${Math.round(surprise * 100)}%`]);
  }
  rows.push(...extraRows);
  const rowH=Math.max(30*s,Math.min(43*s,(mapH-24*s)/Math.ceil(rows.length/2)));
  const colW=rightW/2;
  rows.forEach(([k,v],i)=>{
    const col=i%2,row=Math.floor(i/2),x=rightX+col*colW,y=rightY+row*rowH;
    if(row%2===0){ctx.fillStyle=soft;ctx.fillRect(x,y,colW-5*s,rowH-2*s)}
    ctx.fillStyle="#666666";fitCanvasFont(ctx,k,colW-18*s,11.8*s,9.5*s,sans,600);ctx.fillText(k,x+8*s,y+4*s);
    ctx.fillStyle="#171717";const vv=v.length>46?v.slice(0,45)+"…":v;fitCanvasFont(ctx,vv,colW-18*s,14.5*s,10.8*s,sans,600);ctx.fillText(vv,x+8*s,y+19*s);
  });

  const narrativeY=landscape?Math.max(top+mapH+24*s,rightY+Math.ceil(rows.length/2)*rowH+18*s):rightY+Math.ceil(rows.length/2)*rowH+20*s;
  const availableH=Math.max(130*s,height-margin-narrativeY-30*s);
  const narrativeH=Math.min(landscape?245*s:285*s,availableH);
  ctx.strokeStyle="#a0a0a0";ctx.lineWidth=Math.max(.8,1*s);ctx.strokeRect(leftX,narrativeY,contentW,narrativeH);ctx.fillStyle=soft;ctx.fillRect(leftX,narrativeY,contentW,38*s);ctx.fillStyle="#171717";ctx.font=`700 ${Math.round(16*s)}px ${serif}`;
  ctx.fillText(agency==="CMA"?"登陆过程综合研判":agency==="JMA"?"上陸時の総合解析":"OPERATIONAL INTERPRETATION",leftX+12*s,narrativeY+9*s);

  const trendWordZh=preTrend>2?"登陆前仍在明显增强":preTrend<-2?"登陆前已处于减弱过程":"登陆前强度变化相对平稳";
  const damageWordZh=damage>.55?"核心已经受到较重结构损伤":damage>.25?"核心存在一定松动/不对称":"核心整体保持较完整";
  const cmaLandfallTime = `${bjt.getUTCMonth()+1}月${bjt.getUTCDate()}日${String(bjt.getUTCHours()).padStart(2,"0")}时`;
  const jmaLandfallTime = `${jst.getUTCMonth()+1}月${jst.getUTCDate()}日${String(jst.getUTCHours()).padStart(2,"0")}時（JST）`;
  const textZh=`${cmaLandfallTime}前后，${displayName}在${region}附近登陆。登陆分析时中心气压约${Math.round(state.pmin)} hPa，最大风速${ai.value.toFixed(1)} m/s，${trendWordZh}。结构诊断为“${st.zh}”，眼墙完整度约${Math.round(integrity*100)}%，内核紧实度约${Math.round(compact*100)}%；${damageWordZh}。登陆后海洋水汽与焓通量被切断并叠加地表摩擦，模型未来6小时最大风减弱约${sixHourDecay.toFixed(1)} m/s。当前水汽储库约${Math.round(moisture*100)}%，因此若环流仍能从近海持续输送暖湿空气，强降雨可在风力减弱后继续维持。防灾准备指数约${Math.round(prep*100)}%，路径突变/突然袭击指数约${Math.round(surprise*100)}%，两者会进入模拟伤亡风险计算。`;
  const textJa=`台風 ${displayName} は ${jmaLandfallTime}ごろ、${region} 付近の海岸線を通過した。模擬解析では中心気圧約 ${Math.round(state.pmin)} hPa、10分間平均最大風速 ${Math.round(ai.value)} kt、30kt強風域 ${jma30.longestNm?`${jma30.direction} ${Math.round(jma30.longestNm)}/${Math.round(jma30.shortestNm)} nm`:"なし"}。内部構造は「${st.ja}」で、眼壁完全度約 ${Math.round(integrity*100)}%、コアの締まり約 ${Math.round(compact*100)}%。上陸後は海面からの水蒸気・エンタルピー供給低下、地表摩擦、地形作用により、モデルでは6時間で最大風速が約 ${sixHourDecay.toFixed(1)} m/s低下する。水蒸気リザーバは約 ${Math.round(moisture*100)}%で、沿岸から暖湿気流が続く場合は風の弱まりより遅れて強雨が持続し得る。`;
  const textEn=`${displayName.toUpperCase()} crossed the coastline near ${region} at approximately ${formatUtcCompact(startDate,landfall.time)}. The simulated JTWC-style analysis gives MSLP ${Math.round(state.pmin)} hPa, 1-minute VMAX ${Math.round(ai.value)} kt, RMW ${Math.round((state.rmw||0)/1.852)} nm, and diagnosed 34/50/64-kt wind radii from the model wind field. The inner core is ${st.en}, with eyewall integrity near ${Math.round(integrity*100)}% and compactness near ${Math.round(compact*100)}%. Following coast crossing, loss of ocean enthalpy supply, surface friction and terrain interaction reduce the simulated maximum wind by about ${(sixHourDecay*1.94384).toFixed(0)} kt in six hours. The moisture reservoir remains near ${Math.round(moisture*100)}%, so hazardous rainfall can persist after peak winds weaken where onshore moisture transport continues. Preparedness is ${Math.round(prep*100)}% and track-surprise ${Math.round(surprise*100)}% in the simulator impact model.`;
  const prose=agency==="CMA"?textZh:agency==="JMA"?textJa:textEn;
  const wrap=(text:string,x:number,y:number,maxW:number,lineH:number,maxLines:number)=>{const chars=agency==="JTWC"?text.split(/\s+/):Array.from(text);let line="",lines:string[]=[];for(const c of chars){const test=agency==="JTWC"?(line?line+" "+c:c):line+c;if(ctx.measureText(test).width>maxW&&line){lines.push(line);line=c}else line=test;if(lines.length>=maxLines)break;}if(line&&lines.length<maxLines)lines.push(line);lines.forEach((ln,i)=>ctx.fillText(ln,x,y+i*lineH));};
  const proseLineH=24*s;
  ctx.fillStyle="#272727";ctx.font=`${Math.round(15*s)}px ${sans}`;ctx.textAlign="left";ctx.textBaseline="top";wrap(prose,leftX+14*s,narrativeY+50*s,contentW-28*s,proseLineH,Math.max(4,Math.floor((narrativeH-62*s)/proseLineH)));
}

export default function TyphoonReportModal({ typhoon, startDate, config, onClose }: TyphoonReportModalProps) {
  const simStartDate = useMemo(() => {
    if (startDate) return new Date(startDate);
    const saved = localStorage.getItem("typhoon_sim_start_date");
    return saved ? new Date(saved) : new Date("2027-06-30T20:00:00");
  }, [startDate]);
  const displayName = getTyphoonDisplayName(typhoon, typhoon.simHour, simStartDate);

  const [showMaxWind, setShowMaxWind] = useState(() => localStorage.getItem("report_showMaxWind") !== "false");
  const [showMinPressure, setShowMinPressure] = useState(() => localStorage.getItem("report_showMinPressure") !== "false");
  const [showDuration, setShowDuration] = useState(() => localStorage.getItem("report_showDuration") !== "false");
  const [showCasualtiesDisplay, setShowCasualtiesDisplay] = useState(() => localStorage.getItem("report_showCasualtiesDisplay") !== "false");
  const [showWindCurve, setShowWindCurve] = useState(() => localStorage.getItem("report_showWindCurve") !== "false");
  const [showPressureCurve, setShowPressureCurve] = useState(() => localStorage.getItem("report_showPressureCurve") !== "false");
  const [reportType, setReportType] = useState<"intensity" | "patricia" | "lifecycle" | "track" | "wiki" | "landfall" | "rainfall">(() => {
    const saved = localStorage.getItem("report_type");
    return saved === "track" || saved === "wiki" || saved === "landfall" || saved === "rainfall" || saved === "patricia" || saved === "lifecycle" ? saved : "intensity";
  });
  const [reportAgency, setReportAgency] = useState<ReportAgency>(() => (localStorage.getItem("report_agency") as ReportAgency) || "CMA");
  const [selectedLandfallIndex, setSelectedLandfallIndex] = useState(() => Math.max(0, Number(localStorage.getItem("report_landfallIndex") || 0)));
  const [splitExport, setSplitExport] = useState<"single" | "split">(() => (localStorage.getItem("report_splitExport") as "single" | "split") || "single");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // Reports update at interactive preview resolution. Generate the user's exact chosen resolution
  // only on export; otherwise editing one checkbox repeatedly allocates a 4K canvas.
  const [fullResolutionExport, setFullResolutionExport] = useState(false);
  const [resolution, setResolution] = useState<"1080p" | "2K" | "4K">(() => (localStorage.getItem("report_resolution") as "1080p" | "2K" | "4K") || "2K");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3" | "3:4" | "1:1">(() => (localStorage.getItem("report_aspectRatio") as "16:9" | "4:3" | "3:4" | "1:1") || "16:9");
  const [rainfallRange, setRainfallRange] = useState<"all" | "china">(() => localStorage.getItem("report_rainfallRange") === "china" ? "china" : "all");
  const [rainfallShowTrack, setRainfallShowTrack] = useState(() => localStorage.getItem("report_rainfallShowTrack") !== "false");
  const [rainfallProgress, setRainfallProgress] = useState(0);
  const [isRainfallCalculating, setIsRainfallCalculating] = useState(false);
  const [rainfallReady, setRainfallReady] = useState(false);
  const rainfallAbortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [productMapReady, setProductMapReady] = useState(false);
  const [isWikiRendering, setIsWikiRendering] = useState(false);
  const [wikiReferenceColorGrade, setWikiReferenceColorGrade] = useState(() => localStorage.getItem("report_wikiReferenceColorGrade") !== "false");
  const [wikiEquirectangularProjection, setWikiEquirectangularProjection] = useState(() => localStorage.getItem("report_wikiEquirectangularProjection") === "true");

  useEffect(() => {
    // The intensity report is pure SVG/Canvas and does not need the much larger global
    // coastlines. Load GIS lazily when the user actually switches to a map-dependent product.
    if (reportType === "intensity" || reportType === "patricia" || reportType === "lifecycle" || productMapReady) return;
    let active = true;
    loadProductNaturalEarthData().then((ok) => { if (active && ok) setProductMapReady(true); });
    return () => { active = false; };
  }, [reportType, productMapReady]);

  useEffect(() => {
    localStorage.setItem("report_showMaxWind", showMaxWind.toString());
    localStorage.setItem("report_showMinPressure", showMinPressure.toString());
    localStorage.setItem("report_showDuration", showDuration.toString());
    localStorage.setItem("report_showCasualtiesDisplay", showCasualtiesDisplay.toString());
    localStorage.setItem("report_showWindCurve", showWindCurve.toString());
    localStorage.setItem("report_showPressureCurve", showPressureCurve.toString());
    localStorage.setItem("report_type", reportType);
    localStorage.setItem("report_agency", reportAgency);
    localStorage.setItem("report_landfallIndex", String(selectedLandfallIndex));
    localStorage.setItem("report_splitExport", splitExport);
    localStorage.setItem("report_resolution", resolution);
    localStorage.setItem("report_aspectRatio", aspectRatio);
    localStorage.setItem("report_rainfallRange", rainfallRange);
    localStorage.setItem("report_rainfallShowTrack", String(rainfallShowTrack));
    localStorage.setItem("report_wikiReferenceColorGrade", String(wikiReferenceColorGrade));
    localStorage.setItem("report_wikiEquirectangularProjection", String(wikiEquirectangularProjection));
  }, [showMaxWind, showMinPressure, showDuration, showCasualtiesDisplay, showWindCurve, showPressureCurve, reportType, reportAgency, selectedLandfallIndex, splitExport, resolution, aspectRatio, rainfallRange, rainfallShowTrack, wikiReferenceColorGrade, wikiEquirectangularProjection]);

  const historyData = useMemo<HistoryPoint[]>(() => {
    if (!typhoon.history?.length) {
      return [{ time: 0, wind: typhoon.vmax, pressure: typhoon.pmin }];
    }
    return threeHourlyReportNodes(typhoon.history,h=>Number(h.simHour)).map(h=>({
      time:Number(h.simHour),wind:Number(h.vmax),pressure:Number(h.pmin)
    }));
  }, [typhoon.history, typhoon.vmax, typhoon.pmin]);

  const maxWind = useMemo(() => Math.max(...historyData.map((d) => d.wind)), [historyData]);
  const minPressure = useMemo(() => Math.min(...historyData.map((d) => d.pressure)), [historyData]);
  const lifeCycleHours = historyData.length > 0 ? historyData[historyData.length - 1].time : 0;
  const totalCasualties = Math.floor(typhoon.casualties || 0);

  const landfalls = useMemo<LandfallPoint[]>(() => {
    if (typhoon.landfallRecords && typhoon.landfallRecords.length > 0) {
      return typhoon.landfallRecords
        .filter((r) => !isMinorIslandOperationalIgnored(r.lat, r.lon))
        .map((r) => ({ lat: r.lat, lon: r.lon, wind: r.vmax, time: r.simHour, region: r.region }));
    }
    const derived: LandfallPoint[] = [];
    let wasLanded = false;
    typhoon.history?.forEach((h) => {
      if (h.landed && !wasLanded && !isMinorIslandOperationalIgnored(h.lat, h.lon)) {
        const metrics = getLandMetrics(h.lat, h.lon);
        derived.push({ lat: h.lat, lon: h.lon, wind: h.vmax, time: h.simHour, region: metrics.landName || "沿海地区" });
      }
      wasLanded = h.landed;
    });
    return derived;
  }, [typhoon.history, typhoon.landfallRecords]);

  useEffect(() => {
    // Wiki rendering must never be blocked indefinitely by GIS initialization. It can immediately
    // draw the track (and Blue Marble on full export), then automatically redraw with the detailed
    // Natural Earth coastline once productMapReady becomes true.
    if (!productMapReady && reportType !== "wiki" && reportType !== "intensity" && reportType !== "patricia" && reportType !== "lifecycle") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (reportType === "rainfall") {
      // 4.1.5: do not start the expensive full-life integration simply by opening this tab.
      // Until the user presses “开始计算”, render only a lightweight instruction plate.
      if (isRainfallCalculating || rainfallReady) return;
      // Blank rainfall placeholder is a preview, not the expensive physical output canvas.
      const baseW = 1280;
      let baseH = Math.round(baseW * 9 / 16);
      if (aspectRatio === "4:3") baseH = Math.round(baseW * 3 / 4);
      if (aspectRatio === "3:4") baseH = Math.round(baseW * 4 / 3);
      if (aspectRatio === "1:1") baseH = baseW;
      canvas.width = baseW; canvas.height = baseH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, baseW, baseH);
      ctx.fillStyle = "#e2e8f0"; ctx.fillRect(baseW * 0.06, baseH * 0.13, baseW * 0.88, baseH * 0.74);
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = Math.max(2, baseW / 900);
      ctx.strokeRect(baseW * 0.06, baseH * 0.13, baseW * 0.88, baseH * 0.74);
      ctx.fillStyle = "#334155"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(26, baseW / 52)}px "Microsoft YaHei", sans-serif`;
      ctx.fillText("全程累计降水图等待计算", baseW / 2, baseH * 0.45);
      ctx.font = `500 ${Math.max(18, baseW / 78)}px "Microsoft YaHei", sans-serif`;
      ctx.fillText("确认范围、路径叠加、分辨率与比例后，点击左侧“开始计算”", baseW / 2, baseH * 0.52);
      return;
    }

    let baseW = fullResolutionExport
      ? (resolution === "1080p" ? 1920 : resolution === "4K" ? 3840 : 2560)
      : 1280;
    let baseH = Math.round(baseW * 9 / 16);
    if (aspectRatio === "4:3") baseH = Math.round(baseW * 3 / 4);
    if (aspectRatio === "3:4") baseH = Math.round(baseW * 4 / 3);
    if (aspectRatio === "1:1") baseH = baseW;

    canvas.width = baseW;
    canvas.height = baseH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (reportType === "wiki") {
      const abortController = new AbortController();
      setIsWikiRendering(true);
      drawWikiTrackMap(canvas, typhoon, { signal: abortController.signal, referenceColorGrade: wikiReferenceColorGrade, highQualityBasemap: fullResolutionExport, useEquirectangularProjection: wikiEquirectangularProjection })
        .then(() => {
          if (abortController.signal.aborted) return;
          setIsWikiRendering(false);
          if (fullResolutionExport) {
            setPreviewImage(canvas.toDataURL("image/png"));
            setFullResolutionExport(false);
          }
        })
        .catch((err) => {
          if (abortController.signal.aborted) return;
          console.error("Wiki-style track map render failed:", err);
          setIsWikiRendering(false);
          if (fullResolutionExport) setFullResolutionExport(false);
        });
      return () => {
        abortController.abort();
        setIsWikiRendering(false);
      };
    }

    if (reportType === "patricia") {
      drawPatriciaStyleLifecycleReport(ctx, baseW, baseH, typhoon, simStartDate, displayName);
      return;
    }
    if (reportType === "lifecycle") {
      drawLifecycleDiagnosticReport(ctx, baseW, baseH, typhoon, historyData, simStartDate, displayName);
      return;
    }

    if (reportType === "landfall") {
      const lf = landfalls[Math.max(0, Math.min(selectedLandfallIndex, Math.max(0, landfalls.length - 1)))];
      if (lf) drawLandfallDetailReport(ctx, baseW, baseH, typhoon, simStartDate, reportAgency, lf, selectedLandfallIndex);
      else { ctx.fillStyle = "#fff"; ctx.fillRect(0,0,baseW,baseH); ctx.fillStyle="#333"; ctx.font=`${Math.round(baseW/48)}px sans-serif`; ctx.textAlign="center"; ctx.fillText("没有可用于生成报告的登陆记录", baseW/2, baseH/2); }
      return;
    }
    if (reportAgency !== "CMA") {
      if (reportType === "track") drawAgencyTrackReport(ctx, baseW, baseH, typhoon, simStartDate, reportAgency);
      else drawAgencyDataReport(ctx, baseW, baseH, typhoon, simStartDate, reportAgency);
      return;
    }

    if (reportType === "track") {
      drawTrackReport(ctx, baseW, baseH, typhoon, simStartDate);
      return;
    }

    const scale = baseW / 1920;
    const start = simStartDate;
    const end = new Date(start.getTime() + lifeCycleHours * 3600000);
    const serif = `"Times New Roman", "Songti SC", "Noto Serif CJK SC", serif`;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, baseW, baseH);

    const pageX = 74 * scale;
    const pageW = baseW - pageX * 2;
    let y = 35 * scale;

    ctx.fillStyle = "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `bold ${Math.round(31 * scale)}px ${serif}`;
    ctx.fillText(`台风 ${displayName}  |  CMA风格台风数据报告`, baseW / 2, y);
    y += 43 * scale;

    ctx.font = `${Math.round(20 * scale)}px ${serif}`;
    ctx.fillText(`起报时间：${formatDateTime(start, true)}   至   ${formatDateTime(end, true)}`, baseW / 2, y);
    y += 34 * scale;

    const metrics: string[] = [];
    if (showMaxWind) metrics.push(`最高风速：${maxWind.toFixed(1)} m/s`);
    if (showMinPressure) metrics.push(`最低气压：${minPressure.toFixed(1)} hPa`);
    if (showDuration) metrics.push(`持续时间：${lifeCycleHours.toFixed(0)} h`);
    if (showCasualtiesDisplay) metrics.push(`伤亡估算：${totalCasualties.toLocaleString()} 人`);
    ctx.font = `${Math.round(19 * scale)}px ${serif}`;
    ctx.fillText(metrics.join("    "), baseW / 2, y);
    y += 28 * scale;
    // ROUND116: remove the CMA intensity-report red horizontal separator between the header and
    // the chart area; retain only the original vertical spacing.
    y += 12 * scale;

    const panels: Array<"pressure" | "wind"> = [];
    if (showPressureCurve) panels.push("pressure");
    if (showWindCurve) panels.push("wind");

    const available = baseH - y - 38 * scale;
    if (panels.length === 0) {
      ctx.strokeStyle = "#171717";
      ctx.lineWidth = 2.35 * scale;
      ctx.strokeRect(pageX, y, pageW, Math.max(120 * scale, available));
      ctx.fillStyle = "#3a3a3a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(18 * scale)}px sans-serif`;
      ctx.fillText("未选择风速/气压曲线", baseW / 2, y + available / 2);
    } else {
      const gap = 22 * scale;
      const panelH = (available - gap * (panels.length - 1)) / panels.length;
      panels.forEach((panel, index) => {
        drawScientificPanel(ctx, {
          x: pageX,
          y: y + index * (panelH + gap),
          w: pageW,
          h: panelH,
          data: historyData,
          startDate: start,
          valueKey: panel,
          yLabel: panel === "pressure" ? "中心气压 (hPa)" : "最大风速 (m/s)",
          showSynopticNodes: false,
          threeHourlyParameters:true,
          scale
        });
      });
    }

  }, [aspectRatio, historyData, landfalls, lifeCycleHours, maxWind, minPressure, reportType, reportAgency, resolution, showCasualtiesDisplay, showDuration, showMaxWind, showMinPressure, showPressureCurve, showWindCurve, simStartDate, totalCasualties, typhoon, selectedLandfallIndex, productMapReady, rainfallRange, rainfallShowTrack, config, displayName, isRainfallCalculating, rainfallReady, fullResolutionExport, wikiReferenceColorGrade, wikiEquirectangularProjection]);

  // Any output-setting change invalidates the previous full-life rainfall raster.  This effect does
  // not calculate anything; it only forces an explicit new Start action for the changed request.
  useEffect(() => {
    rainfallAbortRef.current?.abort();
    rainfallAbortRef.current = null;
    setIsRainfallCalculating(false);
    setRainfallProgress(0);
    setRainfallReady(false);
  }, [rainfallRange, rainfallShowTrack, resolution, aspectRatio, reportType]);

  useEffect(() => () => rainfallAbortRef.current?.abort(), []);

  const handleStartRainfallCalculation = async () => {
    if (reportType !== "rainfall" || isRainfallCalculating || !productMapReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    rainfallAbortRef.current?.abort();
    const controller = new AbortController();
    rainfallAbortRef.current = controller;
    setRainfallReady(false);
    setRainfallProgress(1);
    setIsRainfallCalculating(true);
    const historyHours = (typhoon.history || []).map((h) => Number(h.simHour)).filter(Number.isFinite);
    const firstHour = historyHours.length ? Math.min(...historyHours) : Number(typhoon.seasonStartHour || 0);
    const endHour = historyHours.length ? Math.max(...historyHours, Number(typhoon.simHour || 0)) : Number(typhoon.simHour || 0);
    const wholeLifeWindow = Math.max(1, endHour - firstHour + 0.01);
    const width = resolution === "1080p" ? 1920 : resolution === "4K" ? 3840 : 2560;
    try {
      await drawObservedRainfallMap({
        canvas, typhoon, currentHour: endHour, startDate: simStartDate, config,
        typhoonName: displayName, typhoonNumber: getTyphoonOfficialNumber(typhoon, simStartDate),
        windowHours: wholeLifeWindow, aspectRatio,
        domainMode: rainfallRange === "china" ? "china" : "auto",
        showTrackOverlay: rainfallShowTrack, fullTrackProduct: true,
        legendStyle: "extreme_reference", mapPalette: "palette2", outputWidth: width,
        onProgress: setRainfallProgress, signal: controller.signal
      });
      if (!controller.signal.aborted) { setRainfallProgress(100); setRainfallReady(true); }
    } catch (err: any) {
      if (err?.name !== "AbortError") console.error("full-track rainfall report failed", err);
    } finally {
      if (rainfallAbortRef.current === controller) rainfallAbortRef.current = null;
      setIsRainfallCalculating(false);
      if (controller.signal.aborted) { setRainfallProgress(0); setRainfallReady(false); }
    }
  };

  const handleStopRainfallCalculation = () => {
    rainfallAbortRef.current?.abort();
  };

  const handleDownload = () => {
    if (reportType === "rainfall" && !rainfallReady) return;
    if (!canvasRef.current) return;
    if (reportType === "rainfall") {
      setPreviewImage(canvasRef.current.toDataURL("image/png"));
    } else {
      setFullResolutionExport(true);
    }
  };

  // Earlier drawing effect runs first and completes synchronously for these lightweight reports.
  // Capture that full-resolution frame before restoring the fast live preview on the next commit.
  useEffect(() => {
    if (reportType === "wiki") return;
    if (!fullResolutionExport || !canvasRef.current) return;
    try {
      setPreviewImage(canvasRef.current.toDataURL("image/png"));
    } finally {
      setFullResolutionExport(false);
    }
  }, [fullResolutionExport, reportType]);

  const handleDownloadActual = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!previewImage) return;
    const a = document.createElement("a");
    a.href = previewImage;
    a.download = `${reportType === "rainfall" ? "全程累计降水图" : reportType === "wiki" ? `Wiki风格台风路径图_${displayName}` : reportAgency + "_" + (reportType === "track" ? "台风路径报告" : reportType === "landfall" ? `第${selectedLandfallIndex + 1}次登陆详情报告` : reportType === "patricia" ? "三曲线生命周期报告" : reportType === "lifecycle" ? "生命周期三联诊断" : "台风数据报告")}_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  return (
    <div className="aether-report-builder-overlay fixed inset-0 z-[10000] bg-slate-950/90 backdrop-blur-md flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-hidden">
      <div className="aether-report-builder bg-slate-900 border border-slate-800 rounded-xl w-full h-[calc(100dvh-1rem)] sm:h-[92vh] max-h-none flex flex-col shadow-2xl overflow-hidden my-auto min-h-0">
        <div className="aether-report-builder-header flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <Activity className="w-5 h-5 text-cyan-300 shrink-0" />
            <div className="min-w-0"><h2 className="text-lg font-semibold text-white tracking-tight truncate">{loadAgencyBranding('typhoon_report').agencyCode} 台风报告制图 · {displayName}</h2><div className="text-[10px] text-slate-500 font-mono mt-0.5">REPORT WORKSTATION · {reportType === "wiki" ? "WIKIMEDIA" : reportAgency} · {reportType.toUpperCase()}</div></div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="aether-report-builder-body flex-1 min-h-0 overflow-y-scroll overscroll-y-contain touch-pan-y [-webkit-overflow-scrolling:touch] p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
          <div className="aether-report-builder-controls space-y-6 bg-slate-950/40 border border-slate-800/80 rounded-lg p-5">
            <div className="aether-report-builder-controls-title"><span>制图参数</span><small>滚轮滚动参数 · 右侧预览保持固定</small></div>
            {reportType === "intensity" || reportType === "track" || reportType === "landfall" ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3">机构样式</h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(["CMA", "JMA", "JTWC"] as ReportAgency[]).map(agency => (
                    <button key={agency} onClick={() => setReportAgency(agency)} className={`py-2 rounded-lg font-semibold border transition-all cursor-pointer ${reportAgency === agency ? "bg-slate-200 border-slate-200 text-slate-950 font-bold" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}>
                      {agency}风格
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">CMA、JMA、JTWC 分别使用对应语言、平均风口径与风圈字段；输出图不叠加额外水印或说明性注脚。</p>
              </div>
            ) : (
              <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/15 p-3 text-[10px] leading-5 text-slate-400">
                {reportType === "rainfall"
                  ? "全程累计降水图为机构无关产品，固定沿用24小时降水实况图的图例②、配色②和同一逐时降水物理链。"
                  : reportType === "wiki"
                    ? "Wiki风格路径图为机构无关产品：预览仅显示离线海岸线底图；导出时恢复使用较早版本的 NASA Blue Marble 2004 底图与对应调色，并使用 SSHWS 新版配色和气旋性质符号。"
                  : reportType === "patricia"
                    ? "三曲线生命周期采用独立参考版式：风速、气压、移速三条折线，直接读取台风全历史。"
                    : "生命周期三联诊断采用独立业务诊断版式，直接读取台风全历史，不受 CMA/JMA/JTWC 样式选择影响。"}
              </div>
            )}

            <div className="pt-4 border-t border-slate-800/80">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">报告类型</h3>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setReportType("intensity"); setShowWindCurve(true); setShowPressureCurve(true); }} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "intensity" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <Activity className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">{reportAgency === "CMA" ? "双曲线强度报告" : "台风数据报告"}</div>
                  <div className={`text-[10px] mt-1 ${reportType === "intensity" ? "text-slate-600" : "text-slate-500"}`}>{reportAgency === "CMA" ? "CMA风格 · 风速/气压两条折线" : reportAgency === "JMA" ? "JMA風 · 解析経過表" : "JTWC style · best-track table"}</div>
                </button>
                <button onClick={() => setReportType("patricia")} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "patricia" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <Activity className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">三曲线生命周期</div>
                  <div className={`text-[10px] mt-1 ${reportType === "patricia" ? "text-slate-600" : "text-slate-500"}`}>Patricia式 · 风速/气压/移速</div>
                </button>
                <button onClick={() => setReportType("lifecycle")} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "lifecycle" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <Sliders className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">生命周期三联诊断</div>
                  <div className={`text-[10px] mt-1 ${reportType === "lifecycle" ? "text-slate-600" : "text-slate-500"}`}>最大风速 / MSLP / 34kt平均风圈</div>
                </button>
                <button onClick={() => setReportType("track")} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "track" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <MapIcon className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">路径报告</div>
                  <div className={`text-[10px] mt-1 ${reportType === "track" ? "text-slate-600" : "text-slate-500"}`}>{reportAgency === "CMA" ? "CMA风格 · 单路径/气压着色" : reportAgency === "JMA" ? "JMA風 · 経路図" : "JTWC style · track only"}</div>
                </button>
                <button onClick={() => setReportType("wiki")} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "wiki" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <MapIcon className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">Wiki风格台风路径图</div>
                  <div className={`text-[10px] mt-1 ${reportType === "wiki" ? "text-slate-600" : "text-slate-500"}`}>离线预览 / Blue Marble 2004 导出 · Wiki 调色 · SSHWS配色 / 气旋性质符号</div>
                </button>
                <button onClick={() => setReportType("landfall")} disabled={landfalls.length === 0} className={`p-3 rounded-md border text-left transition-colors cursor-pointer disabled:opacity-40 ${reportType === "landfall" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <MapIcon className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">登陆详情</div>
                  <div className={`text-[10px] mt-1 ${reportType === "landfall" ? "text-slate-600" : "text-slate-500"}`}>{landfalls.length ? `${landfalls.length} 个可选登陆点` : "暂无登陆记录"}</div>
                </button>
                <button onClick={() => setReportType("rainfall")} className={`p-3 rounded-md border text-left transition-colors cursor-pointer ${reportType === "rainfall" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                  <MapIcon className="w-4 h-4 mb-2" />
                  <div className="text-xs font-semibold">全程累计降水图</div>
                  <div className={`text-[10px] mt-1 ${reportType === "rainfall" ? "text-slate-600" : "text-slate-500"}`}>图例②配色 · 全生命周期积分</div>
                </button>
              </div>
            </div>

            {reportType === "wiki" && (
              <div className="pt-4 border-t border-slate-800/80 space-y-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-sky-800/50 bg-sky-950/20 p-3 cursor-pointer">
                  <span><b className="block text-xs text-sky-200">参考 Wiki 底图调色</b><span className="block mt-1 text-[10px] leading-4 text-slate-500">增强 Blue Marble 2004 的深钴蓝海洋、亮度与饱和度，贴近较早版本 Wikimedia 路径图；选项会保存到本地。</span></span>
                  <input type="checkbox" checked={wikiReferenceColorGrade} onChange={(e) => setWikiReferenceColorGrade(e.target.checked)} className="w-4 h-4 shrink-0 accent-sky-400" />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-cyan-800/50 bg-cyan-950/15 p-3 cursor-pointer">
                  <span><b className="block text-xs text-cyan-200">新投影</b><span className="block mt-1 text-[10px] leading-4 text-slate-500">开启后使用 Equirectangular / Plate Carrée 等距圆柱投影；关闭保持原 Web Mercator。路径点与离线海岸线使用同一投影，打点仍保持正圆/正方/三角，不做符号形变。</span></span>
                  <input type="checkbox" checked={wikiEquirectangularProjection} onChange={(e) => setWikiEquirectangularProjection(e.target.checked)} className="w-4 h-4 shrink-0 accent-cyan-400" />
                </label>
              </div>
            )}

            {reportType === "rainfall" && (
              <div className="pt-4 border-t border-slate-800/80 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 mb-2">累计降水范围</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button onClick={() => setRainfallRange("all")} className={`py-2 rounded-lg border font-semibold ${rainfallRange === "all" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-400"}`}>全部路径范围</button>
                    <button onClick={() => setRainfallRange("china")} className={`py-2 rounded-lg border font-semibold ${rainfallRange === "china" ? "bg-slate-200 border-slate-200 text-slate-950" : "bg-slate-900 border-slate-700 text-slate-400"}`}>中国（含港澳台）</button>
                  </div>
                </div>
                <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/55 px-3 py-2.5 text-xs text-slate-300 cursor-pointer">
                  <span>叠加全程台风路径（黑线）</span>
                  <input type="checkbox" checked={rainfallShowTrack} onChange={(e) => setRainfallShowTrack(e.target.checked)} className="w-4 h-4 accent-slate-300"/>
                </label>
                <button
                  type="button"
                  onClick={handleStartRainfallCalculation}
                  disabled={isRainfallCalculating || !productMapReady}
                  className="w-full py-2.5 rounded-lg border border-cyan-700/60 bg-cyan-950/30 text-cyan-200 font-bold text-xs hover:bg-cyan-900/35 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {rainfallReady ? "重新开始计算" : productMapReady ? "开始计算" : "地图数据准备中…"}
                </button>
                <div className="text-[10px] leading-5 text-slate-500">使用与24小时降水实况图“图例②”完全相同的海陆底色、降水分级和图例。只有点击“开始计算”后才执行全生命周期积分；空间候选索引只跳过物理上不可能影响该网格的历史时次，不降低网格精度或逐小时降水计算精度。</div>
                {rainfallReady && <div className="text-[10px] font-mono text-emerald-300">计算完成 · 可预览/导出</div>}
              </div>
            )}

            {reportType === "landfall" && landfalls.length > 0 && (
              <div className="pt-4 border-t border-slate-800/80">
                <h3 className="text-sm font-semibold text-slate-200 mb-3">选择登陆点</h3>
                <select value={Math.max(0, Math.min(selectedLandfallIndex, landfalls.length-1))} onChange={e=>setSelectedLandfallIndex(Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200">
                  {landfalls.map((lf,i)=><option key={`${lf.time}-${i}`} value={i}>第{i+1}次 · {cleanLandName(lf.region)} · {formatUtcCompact(simStartDate, lf.time)}</option>)}
                </select>
              </div>
            )}

            {reportType === "intensity" && reportAgency === "CMA" ? (
            <div className="pt-4 border-t border-slate-800/80">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
                <Sliders className="w-4 h-4 text-slate-400" />
                显示参数勾选
              </h3>
              <div className="space-y-2.5 text-xs text-slate-300">
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showMaxWind} onChange={e => setShowMaxWind(e.target.checked)} className="accent-slate-300 w-4 h-4" />最大风速显示 (Max Wind)</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showMinPressure} onChange={e => setShowMinPressure(e.target.checked)} className="accent-slate-300 w-4 h-4" />最低气压显示 (Min Pressure)</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showDuration} onChange={e => setShowDuration(e.target.checked)} className="accent-slate-300 w-4 h-4" />持续时间 (Duration)</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showCasualtiesDisplay} onChange={e => setShowCasualtiesDisplay(e.target.checked)} className="accent-slate-300 w-4 h-4" />伤亡人数显示 (Casualties)</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showWindCurve} onChange={e => setShowWindCurve(e.target.checked)} className="accent-slate-300 w-4 h-4" />风速曲线 (Wind Curve)</label>
                <label className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white"><input type="checkbox" checked={showPressureCurve} onChange={e => setShowPressureCurve(e.target.checked)} className="accent-slate-300 w-4 h-4" />气压曲线 (Pressure Curve)</label>
              </div>
            </div>
            ) : (
              <div className="pt-4 border-t border-slate-800/80 text-xs leading-5 text-slate-400">
                {reportType === "rainfall"
                  ? "全程累计降水采用与24小时实况降水图相同的逐时降水模型、图例②和配色②；可选择完整路径范围或中国（含港澳台），并可叠加黑色历史路径。"
                  : reportType === "wiki"
                    ? "Wiki风格路径图预览使用离线精细海岸线；点击生成后再加载 NASA Blue Marble 2004 高清底图并应用对应调色。路径为约6小时 best-track 连线，节点颜色按 SSHWS 最大持续风速等级。"
                  : reportType === "track"
                    ? (reportAgency === "CMA" ? "CMA风格路径报告使用单条模拟历史路径、中心气压连续着色、海陆底图与经纬网格。" : reportAgency === "JMA" ? "JMA风格按其最佳路径资料字段生成彩色海陆底图経路図。" : "JTWC路径图改为与JMA相同的纯路径构图：不显示侧边/底部列表；源资料保持 6 小时 best-track 节奏，地图打点按 JMA 的 24 小时节奏整理，文字同 JMA 节奏仅标首点与关键时次，并用两行 DTG 与 KTS。")
                    : (reportAgency === "JMA" ? "JMA风格数据表使用日文与10分钟风/30–50 kt风区字段，但节点时次仍统一采用 TyphoonSIM 的 CMA/NMC 北京时业务时钟。" : "JTWC风格数据表使用英文，按6小时最佳路径节奏列出1分钟最大风、RMW及34/50/64 kt象限风圈。")}
              </div>
            )}

            {reportType === "intensity" && reportAgency === "CMA" && (
            <div className="pt-4 border-t border-slate-800/80">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">多图输出模式 (Multi-Image Generation)</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(["single", "split"] as const).map(mode => (
                  <button key={mode} onClick={() => setSplitExport(mode)} className={`py-2 rounded-lg font-semibold border transition-all cursor-pointer ${splitExport === mode ? "bg-slate-200 border-slate-200 text-slate-950 font-bold" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}>
                    {mode === "single" ? "合成为1张图片" : "分多张图片生成"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-slate-500">当前预览始终显示合成版；分图模式保留为导出偏好，不改变报告数据。</p>
            </div>
            )}

            <div className="pt-4 border-t border-slate-800/80">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">图像清晰度 (Resolution)</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(["1080p", "2K", "4K"] as const).map(res => (
                  <button key={res} onClick={() => setResolution(res)} className={`py-2 rounded-lg font-semibold border transition-all cursor-pointer ${resolution === res ? "bg-slate-200 border-slate-200 text-slate-950 font-bold" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}>{res}</button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">图片比例 (Aspect Ratio)</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(["16:9", "4:3", "3:4", "1:1"] as const).map(ratio => (
                  <button key={ratio} onClick={() => setAspectRatio(ratio)} className={`py-2 rounded-lg font-semibold border transition-all cursor-pointer ${aspectRatio === ratio ? "bg-slate-200 border-slate-200 text-slate-950 font-bold" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}>{ratio}</button>
                ))}
              </div>
            </div>

            <button onClick={handleDownload} disabled={(reportType === "rainfall" && !rainfallReady) || (reportType === "wiki" && isWikiRendering)} className="w-full py-3 bg-slate-200 hover:bg-white disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-slate-950 font-bold rounded-md flex items-center justify-center gap-2 transition-colors cursor-pointer mt-4">
              <Download className="w-4 h-4" />{reportType === "rainfall" ? (rainfallReady ? "导出全程累计降水图" : "请先开始计算") : reportType === "wiki" ? (isWikiRendering ? "正在加载Wiki底图…" : "导出Wiki风格路径图") : `导出${reportAgency} ${reportType === "track" ? "路径报告" : reportType === "landfall" ? "登陆详情报告" : reportType === "patricia" ? "三曲线生命周期报告" : reportType === "lifecycle" ? "生命周期三联诊断" : "数据报告"}`}
            </button>
          </div>

          <div className="aether-report-builder-preview lg:col-span-2 bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex flex-col min-h-[400px]">
            <div className="aether-report-builder-previewbar">
              <div><b>报告实时预览</b><span>预览采用轻量分辨率；导出时按所选分辨率重新绘制</span></div>
              <div className="aether-report-builder-previewmeta"><span>{reportType === "wiki" ? "WIKI" : reportAgency}</span><span>{reportType === "intensity" ? "数据报告" : reportType === "patricia" ? "三曲线生命周期" : reportType === "lifecycle" ? "生命周期三联诊断" : reportType === "wiki" ? "Wiki风格路径图" : reportType === "track" ? "路径报告" : reportType === "landfall" ? "登陆详情" : "累计降水"}</span><span>{resolution}</span><span>{aspectRatio}</span></div>
            </div>
            <div className="aether-report-builder-canvasframe flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden rounded-lg shadow-2xl border border-slate-800 bg-white">
              <canvas ref={canvasRef} className="max-w-full max-h-[520px] object-contain" />
            </div>
          </div>
        </div>
      </div>

      {isRainfallCalculating && (
        <div className="fixed inset-0 z-[12000] bg-slate-950/96 backdrop-blur-lg flex items-center justify-center p-5">
          <div className="w-full max-w-md rounded-2xl border border-cyan-800/50 bg-slate-900 p-6 shadow-2xl">
            <div className="text-center space-y-2">
              <CloudRain className="w-9 h-9 mx-auto text-cyan-300" />
              <h3 className="text-base font-bold text-slate-100">正在计算全程累计降水</h3>
              <p className="text-xs text-slate-400">逐小时积分与地形/海陆诊断正在运行，可随时终止。</p>
            </div>
            <div className="mt-5 h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-cyan-400 transition-[width] duration-150" style={{ width: `${Math.max(1, Math.min(100, rainfallProgress))}%` }} />
            </div>
            <div className="mt-2 text-center text-sm font-mono text-cyan-200">{Math.round(rainfallProgress)}%</div>
            <button type="button" onClick={handleStopRainfallCalculation} className="mt-5 w-full py-2.5 rounded-lg border border-red-700/60 bg-red-950/30 text-red-200 text-sm font-bold hover:bg-red-900/40">终止计算</button>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-4xl flex flex-col gap-4 shadow-2xl relative">
            <button onClick={() => setPreviewImage(null)} className="absolute top-4 right-4 p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 hover:text-white transition cursor-pointer"><X className="w-5 h-5" /></button>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3"><h3 className="text-base font-bold text-slate-100">图片原图预览</h3></div>
            <div className="flex-1 overflow-auto bg-slate-950/80 rounded-xl p-4 flex items-center justify-center min-h-[40vh] max-h-[60vh] border border-slate-800/40"><img src={previewImage} alt="Image Preview" className="max-w-full max-h-[55vh] object-contain rounded-lg shadow-lg" /></div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800/60 pt-4">
              <p className="text-xs text-slate-400 font-medium">{reportType === "rainfall" ? "全程累计降水图沿用24小时实况图例②与配色②，并使用同一逐时物理积分。" : reportType === "wiki" ? "Wiki风格路径图预览阶段使用离线精细海岸线；生成原图时再加载 NASA Blue Marble 2004 高清底图与对应 Wiki 调色，符号形状表示气旋性质。" : reportType === "patricia" ? "三曲线生命周期参考Patricia历史强度图风格：左轴风速/移速、右轴中心气压；曲线图不再绘制登陆地点或登陆竖线。" : reportType === "lifecycle" ? "生命周期三联诊断集中展示最大持续风速、最低气压与平均34kt风圈半径，适合与业务模式诊断图对照。" : reportAgency === "CMA" ? (reportType === "track" ? "CMA风格路径报告采用单轨迹气压着色、海陆底图与经纬网格。" : "CMA风格数据报告采用白底、细网格与双面板连续曲线。") : reportAgency === "JMA" ? "JMA风格使用日文、10分钟风和30/50 kt风区字段；数据报告采用黑白灰业务排版。" : "JTWC路径图仅显示路径与简洁节点标签，不附列表；独立数据报告仍使用英文、1分钟风及34/50/64 kt字段。"}</p>
              <div className="flex gap-3 w-full sm:w-auto text-white">
                <button onClick={() => setPreviewImage(null)} className="flex-1 sm:flex-initial px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition cursor-pointer">取消</button>
                <button onClick={handleDownloadActual} className="flex-1 sm:flex-initial px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold flex items-center justify-center gap-1.5 text-sm transition shadow-md cursor-pointer"><Download className="w-4 h-4" />下载原图</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
