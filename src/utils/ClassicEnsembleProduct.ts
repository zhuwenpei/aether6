/** Shared, byte-for-byte classic WMC ensemble drawing routine.
 * The normal Product Centre and the Typhoon Network reference page call this
 * same code so their projection, typography, palette and aspect are identical.
 */
import type {SimulationConfig} from '../types';
import {getAgencyIntensity} from '../simulation/Engine';
import {AETHER_MODEL_SPECS, smoothGuidanceTrackForDisplay, type AetherGuidanceMember} from '../simulation/AetherEnsembleGuidance';
import {productLandGeoJson as landGeoJson} from '../simulation/NaturalEarthLoader';
import {strokeProductCoastlineRing} from './ProductCoastlineDrawing';
import {loadAgencyBranding} from './AgencyBranding';

export function drawClassicEnsembleProduct({ctx,W,H,scale,isMini,activeState,referencePath,allTracks,visibleCenters,
  ensembleMode,ensembleBlackLines,selectedEnsembleModels,config,currentHour,startDate}:{
  ctx:CanvasRenderingContext2D;W:number;H:number;scale:number;isMini:boolean;
  activeState:{lat:number;lon:number;vmax:number;pmin:number};referencePath:any[];
  allTracks:AetherGuidanceMember[];visibleCenters:AetherGuidanceMember[];
  ensembleMode:'centers'|'members';ensembleBlackLines:boolean;selectedEnsembleModels:string[];
  config?:SimulationConfig;currentHour:number;startDate:Date;
}):void{
  const formatChineseDateShort=(date:Date)=>`${date.getDate()}日${String(date.getHours()).padStart(2,'0')}时`;
    // Streaming bounds keeps the 8×500-member case cheap and avoids constructing another giant
    // point array just to obtain min/max.
    let minLat=Number(activeState.lat),maxLat=Number(activeState.lat),minLon=Number(activeState.lon),maxLon=Number(activeState.lon);
    const absorb=(lat:number,lon:number)=>{if(!Number.isFinite(lat)||!Number.isFinite(lon))return;minLat=Math.min(minLat,lat);maxLat=Math.max(maxLat,lat);minLon=Math.min(minLon,lon);maxLon=Math.max(maxLon,lon);};
    referencePath.forEach((p:any)=>absorb(Number(p.lat),Number(p.lon)));
    allTracks.forEach(m=>m.track.forEach(p=>absorb(p.lat,p.lon)));
    const latPad=Math.max(1.9,(maxLat-minLat)*.085),lonPad=Math.max(2.4,(maxLon-minLon)*.075);
    minLat=Math.max(-78,minLat-latPad);maxLat=Math.min(82,maxLat+latPad);minLon=Math.max(-180,minLon-lonPad);maxLon=Math.min(180,maxLon+lonPad);
    if(maxLat-minLat<12.5){const c=(maxLat+minLat)/2;minLat=c-6.25;maxLat=c+6.25;}
    if(maxLon-minLon<16.5){const c=(maxLon+minLon)/2;minLon=c-8.25;maxLon=c+8.25;}

    const headerH=isMini?38:64*scale, footerH=isMini?16:30*scale;
    const sideW=!isMini ? Math.max(300*scale, W*.205) : 0;
    const mapLeft=isMini?0:70*scale, mapRight=W-sideW-(isMini?0:16*scale), mapTop=headerH, mapBottom=H-footerH-14*scale;
    const mapW=mapRight-mapLeft,mapH=mapBottom-mapTop;
    // Preserve geographic aspect ratio. The former renderer independently stretched latitude and
    // longitude to fill the rectangle, visibly deforming Korea/Japan/China at mid latitudes.
    const midLat=(minLat+maxLat)/2,cosMid=Math.max(.22,Math.cos(midLat*Math.PI/180));
    let latSpan=maxLat-minLat,lonSpan=maxLon-minLon;
    const geoAspect=(lonSpan*cosMid)/Math.max(.001,latSpan),boxAspect=mapW/Math.max(1,mapH);
    if(geoAspect<boxAspect){const wantLon=latSpan*boxAspect/cosMid,d=(wantLon-lonSpan)/2;minLon-=d;maxLon+=d;lonSpan=wantLon;}
    else {const wantLat=lonSpan*cosMid/boxAspect,d=(wantLat-latSpan)/2;minLat-=d;maxLat+=d;latSpan=wantLat;}
    const centerLon=(minLon+maxLon)/2;
    const project=(lat:number,lon:number)=>({x:mapLeft+(lon-minLon)/(maxLon-minLon)*mapW,y:mapBottom-(lat-minLat)/(maxLat-minLat)*mapH});
    const unwrapRing=(ring:any[])=>{const out:Array<[number,number]>=[];let prev=centerLon;for(const c of ring||[]){let lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;while(lon-prev>180)lon-=360;while(lon-prev<-180)lon+=360;out.push([lon,lat]);prev=lon;}return out;};

    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#f5f7fa";ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#a6d7f4";ctx.fillRect(mapLeft,mapTop,mapW,mapH);
    if(!isMini){ctx.fillStyle="#ffffff";ctx.fillRect(mapRight+8*scale,0,W-mapRight-8*scale,H);}
    ctx.fillStyle="#0b33f0";ctx.textAlign="center";ctx.font=`500 ${isMini?17:34*scale}px Arial,"Microsoft YaHei",sans-serif`;
    ctx.fillText(ensembleMode==="members"?`${selectedEnsembleModels.join("+")} 集合预报路径`:`多模式热带气旋路径预报`,mapLeft+mapW/2,isMini?25:30*scale);
    if(!isMini){ctx.font=`500 ${16*scale}px Arial,"Microsoft YaHei",sans-serif`;ctx.fillText(`${formatChineseDateShort(new Date(startDate.getTime()+currentHour*3600000))} · WMC SIMULATED GUIDANCE`,mapLeft+mapW/2,51*scale);}

    ctx.save();ctx.beginPath();ctx.rect(mapLeft,mapTop,mapW,mapH);ctx.clip();
    ctx.strokeStyle="rgba(255,255,255,.72)";ctx.lineWidth=Math.max(.7,scale);ctx.setLineDash([6*scale,4*scale]);
    for(let lon=Math.ceil(minLon/5)*5;lon<=maxLon;lon+=5){const q=project(minLat,lon);ctx.beginPath();ctx.moveTo(q.x,mapTop);ctx.lineTo(q.x,mapBottom);ctx.stroke();}
    for(let lat=Math.ceil(minLat/5)*5;lat<=maxLat;lat+=5){const q=project(lat,minLon);ctx.beginPath();ctx.moveTo(mapLeft,q.y);ctx.lineTo(mapRight,q.y);ctx.stroke();}
    ctx.setLineDash([]);
    if(landGeoJson?.features){
      ctx.fillStyle="#f4f5f7";ctx.strokeStyle="#18212b";ctx.lineWidth=.85*scale;
      for(const f of landGeoJson.features as any[]){const g=f?.geometry;if(!g)continue;const polys=g.type==="Polygon"?[g.coordinates]:g.type==="MultiPolygon"?g.coordinates:[];for(const poly of polys){ctx.beginPath();for(const ring0 of poly){const ring=unwrapRing(ring0);if(ring.length<3)continue;ring.forEach((c,i)=>{const q=project(c[1],c[0]);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();}try{ctx.fill("evenodd")}catch{ctx.fill()}for(const ring0 of poly){const ring=unwrapRing(ring0);if(ring.length<3)continue;strokeProductCoastlineRing(ctx, ring, (lat,lon)=>project(lat,lon));}}}
    }

    const intensityColor=(v:number)=>v>=51?"#81137d":v>=46?"#ef25df":v>=41?"#f51b1b":v>=33?"#f6a010":v>=24.5?"#1738f5":"#119b20";
    const drawTrack=(track:any[],color:string,width:number,alpha=1,segmentsByIntensity=false)=>{
      if(track.length<2)return;const displayTrack=smoothGuidanceTrackForDisplay(track,0);ctx.globalAlpha=alpha;ctx.lineCap="butt";ctx.lineJoin="miter";ctx.miterLimit=6;
      if(segmentsByIntensity){for(let i=1;i<displayTrack.length;i++){const a=project(displayTrack[i-1].lat,displayTrack[i-1].lon),b=project(displayTrack[i].lat,displayTrack[i].lon);ctx.strokeStyle=intensityColor(((displayTrack[i-1].vmax||0)+(displayTrack[i].vmax||0))*.5);ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}}
      else{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();displayTrack.forEach((p:any,i:number)=>{const q=project(p.lat,p.lon);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();}
      ctx.globalAlpha=1;
    };
    // Exact WMC operational/manual-constrained forecast for visual verification against the live map.
    const baseline=[{lat:Number(activeState.lat),lon:Number(activeState.lon),vmax:Number(activeState.vmax),pmin:Number(activeState.pmin),simHour:0},...referencePath];
    const baselineDisplay=smoothGuidanceTrackForDisplay(baseline,0);
    if (ensembleMode !== "members" || ensembleBlackLines) {
      ctx.strokeStyle="#0f172a";ctx.lineWidth=Math.max(1.3,2.2*scale);ctx.setLineDash([7*scale,5*scale]);ctx.beginPath();baselineDisplay.forEach((p:any,i)=>{const q=project(Number(p.lat),Number(p.lon));i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke();ctx.setLineDash([]);
    }

    if(ensembleMode==="members"){
      allTracks.filter(m=>!m.control).forEach(member=>drawTrack(member.track,"",Math.max(.62,.95*scale),.70,true));
      (ensembleBlackLines ? allTracks.filter(m=>m.control) : []).forEach(member=>drawTrack(member.track,"#050505",Math.max(1.6,2.3*scale),.95,false));
      const labelTrack=visibleCenters[0]?.track||[];labelTrack.forEach((p:any)=>{if(p.leadHour>0&&p.leadHour%24===0){const q=project(p.lat,p.lon);ctx.fillStyle="#111827";ctx.font=`700 ${Math.max(7,9*scale)}px Arial`;ctx.fillText(String(Math.round(p.leadHour)),q.x+3*scale,q.y-4*scale);}});
    } else {
      visibleCenters.forEach(center=>{
        drawTrack(center.track,"#ffffff",4.5*scale,.88);drawTrack(center.track,center.color,2.6*scale,1);
        center.track.forEach((p:any,i:number)=>{if(i%2!==0&&i!==center.track.length-1)return;const q=project(p.lat,p.lon);ctx.fillStyle=intensityColor(p.vmax);ctx.strokeStyle="#101820";ctx.lineWidth=.8*scale;ctx.beginPath();ctx.arc(q.x,q.y,3.1*scale,0,Math.PI*2);ctx.fill();ctx.stroke();});
      });
      // Lead labels are written only on the first family to keep the densely clustered early track readable.
      (visibleCenters[0]?.track||[]).forEach((p:any)=>{if(p.leadHour>=24&&p.leadHour%24===0){const q=project(p.lat,p.lon);ctx.fillStyle="#15223a";ctx.font=`700 ${Math.max(7,9*scale)}px Arial`;ctx.fillText(`${Math.round(p.leadHour)}`,q.x+4*scale,q.y-5*scale);}});
    }
    const origin=project(Number(activeState.lat),Number(activeState.lon));ctx.fillStyle="#050505";ctx.beginPath();ctx.arc(origin.x,origin.y,4.5*scale,0,Math.PI*2);ctx.fill();ctx.restore();

    if(!isMini){
      ctx.fillStyle="#344054";ctx.font=`${12*scale}px Arial`;ctx.textAlign="center";for(let lon=Math.ceil(minLon/10)*10;lon<=maxLon;lon+=10){const q=project(minLat,lon);ctx.fillText(`${Math.abs(lon)}°${lon>=0?"E":"W"}`,q.x,mapBottom+17*scale);}ctx.textAlign="right";for(let lat=Math.ceil(minLat/5)*5;lat<=maxLat;lat+=5){const q=project(lat,minLon);ctx.fillText(`${Math.abs(lat)}°${lat>=0?"N":"S"}`,mapLeft-6*scale,q.y+4*scale);}
      const sx=mapRight+28*scale;ctx.textAlign="left";ctx.fillStyle="#15191f";ctx.font=`700 ${14*scale}px Arial,"Microsoft YaHei",sans-serif`;ctx.fillText(ensembleMode==="members"?"成员最大风速排名":"模式图例",sx,92*scale);
      if(ensembleMode==="centers"){
        AETHER_MODEL_SPECS.forEach((spec,i)=>{const y=(121+i*28)*scale;const g=visibleCenters.find(c=>c.modelId===spec.id);ctx.strokeStyle=spec.color;ctx.lineWidth=4*scale;ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+42*scale,y);ctx.stroke();ctx.fillStyle="#111827";ctx.font=`700 ${11.5*scale}px Arial`;ctx.fillText(spec.label,sx+54*scale,y-2*scale);if(g){const a=(config?.intensityAgency||config?.agencyStyle||"CMA") as "CMA"|"JMA"|"JTWC";const wi=getAgencyIntensity(g.maxVmax,a,config?.intensityReportingMode||"public");const speeds=g.track.map(p=>Number(p.speed)).filter(v=>Number.isFinite(v));const meanSpeed=speeds.length?Math.round(speeds.reduce((x,y)=>x+y,0)/speeds.length):0;const maxSpeed=speeds.length?Math.round(Math.max(...speeds)):0;ctx.fillStyle="#667085";ctx.font=`${8.2*scale}px ui-monospace,monospace`;ctx.fillText(`${wi.value}${wi.unit} / ${Math.round(g.minPmin)}hPa · ${meanSpeed}/${maxSpeed}kmh`,sx+54*scale,y+9*scale);}});
        ctx.fillStyle="#475467";ctx.font=`700 ${10*scale}px Arial`;ctx.fillText("强度标记 / MAX WIND",sx,364*scale);
        const cats=[["≥16级",52,"#81137d"],["≥14级",47,"#ef25df"],["≥12级",42,"#f51b1b"],["≥10级",34,"#f6a010"],["≥8级",25,"#1738f5"],["≤7级",18,"#119b20"]] as const;
        cats.forEach((c,i)=>{const y=(389+i*25)*scale;ctx.fillStyle=c[2];ctx.beginPath();ctx.arc(sx+6*scale,y-3*scale,5*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#111827";ctx.stroke();ctx.fillStyle="#111827";ctx.font=`${10.5*scale}px Arial`;ctx.fillText(c[0],sx+20*scale,y);});
        ctx.setLineDash([6*scale,4*scale]);ctx.strokeStyle="#111827";ctx.lineWidth=2*scale;ctx.beginPath();ctx.moveTo(sx,566*scale);ctx.lineTo(sx+42*scale,566*scale);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#111827";ctx.fillText("WMC 基准预报",sx+54*scale,570*scale);
      } else {
        const rankStartY=118*scale, rankStep=18.5*scale, rankBottom=H-32*scale;
        const rankSlots=Math.max(1, Math.floor((rankBottom-rankStartY)/Math.max(1,rankStep)));
        const ranked=[...allTracks].sort((a,b)=>b.maxVmax-a.maxVmax).slice(0,Math.min(rankSlots,allTracks.length));ranked.forEach((m,i)=>{const y=(118+i*18.5)*scale;const a=(config?.intensityAgency||config?.agencyStyle||"CMA") as "CMA"|"JMA"|"JTWC";const wi=getAgencyIntensity(m.maxVmax,a,config?.intensityReportingMode||"public");const speeds=m.track.map(p=>Number(p.speed)).filter(v=>Number.isFinite(v));const meanSpeed=speeds.length?Math.round(speeds.reduce((x,y)=>x+y,0)/speeds.length):0;ctx.fillStyle=intensityColor(m.maxVmax);ctx.font=`${9.2*scale}px ui-monospace,monospace`;ctx.fillText(`${String(i+1).padStart(2,"0")}. ${m.id} · ${wi.value}${wi.unit} ${Math.round(m.minPmin)}hPa · ${meanSpeed}km/h`,sx,y);});
      }
    }
    ctx.fillStyle="#667085";ctx.textAlign="left";ctx.font=`${Math.max(7,9.5*scale)}px Arial`;ctx.fillText(`${loadAgencyBranding('ensemble_tracks').agencyCode} simulated guidance · model names are simulation families, not downloaded NWP data`,10*scale,H-9*scale,Math.max(1,W-20*scale));

}
