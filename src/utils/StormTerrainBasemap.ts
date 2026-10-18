/**
 * Offline operational terrain overlay.
 *
 * Unlike the old broad yellow relief wash, this layer intentionally reveals only significant
 * mountain terrain/ridges over the vector land plate. Low plains stay fully transparent and
 * contour edges are derived from the same land-clipped ETOPO field, producing a crisp synoptic
 * basemap similar to the STORM_INC reference rather than a blurred elevation photograph.
 */
import { getEtopoTerrainElevation } from "../simulation/EtopoTerrain";
import { checkPointOnLandGeoJson, loadNaturalEarthData } from "../simulation/NaturalEarthLoader";

export const STORM_TERRAIN_BOUNDS: [[number, number], [number, number]] = [[-10, 90], [60, 180]];

let cachedTexture: string | null = null;
let pendingTexture: Promise<string> | null = null;
const clamp = (v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const mercatorY=(latDeg:number)=>{const lat=clamp(latDeg,-85,85)*Math.PI/180;return Math.log(Math.tan(Math.PI/4+lat/2));};
const inverseMercatorY=(y:number)=>(2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI;
const yieldToBrowser=()=>new Promise<void>(resolve=>{if(typeof requestIdleCallback!=="undefined")requestIdleCallback(()=>resolve(),{timeout:120});else setTimeout(resolve,0);});

export async function getStormTerrainTextureDataUrl():Promise<string>{
  if(cachedTexture)return cachedTexture;
  if(pendingTexture)return pendingTexture;
  pendingTexture=(async()=>{
    if(typeof document==="undefined")return "";
    await loadNaturalEarthData();
    await yieldToBrowser();
    const width=1152,height=768;
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:true});if(!ctx)return "";
    const image=ctx.createImageData(width,height),elev=new Uint16Array(width*height),land=new Uint8Array(width*height),mask=new Uint8Array(width*height);
    const latByY=new Float64Array(height),lonByX=new Float64Array(width);
    const maxMerc=mercatorY(60),minMerc=mercatorY(-10);
    for(let x=0;x<width;x++)lonByX[x]=90+90*x/Math.max(1,width-1);
    for(let y=0;y<height;y++){
      const lat=inverseMercatorY(maxMerc+(minMerc-maxMerc)*y/Math.max(1,height-1));latByY[y]=lat;
      for(let x=0;x<width;x++){
        const lon=lonByX[x],i=y*width+x;
        if(!checkPointOnLandGeoJson(lat,lon))continue;
        land[i]=1;elev[i]=Math.max(0,Math.min(65535,getEtopoTerrainElevation(lat,lon)??0));
      }
      if((y&63)===63)await yieldToBrowser();
    }
    // Mountain selection: altitude alone is insufficient. Moderate terrain is shown only when it
    // has meaningful local relief; high plateaus/ranges remain visible but plains disappear.
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x;if(!land[i])continue;const e=elev[i];
      const localMin=Math.min(elev[i-1],elev[i+1],elev[i-width],elev[i+width]);
      const localMax=Math.max(elev[i-1],elev[i+1],elev[i-width],elev[i+width]);
      const relief=localMax-localMin;
      if(e>=1550||(e>=900&&relief>=90)||(e>=620&&relief>=180))mask[i]=1;
    }
    // One-pixel closing joins tiny holes inside a massif without expanding it onto plains.
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
      const i=y*width+x;if(mask[i]||!land[i])continue;let n=0;
      for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)n+=mask[i+yy*width+xx];
      if(n>=6)mask[i]=2;
    }
    for(let y=1;y<height-1;y++){
      for(let x=1;x<width-1;x++){
        const i=y*width+x;if(!mask[i])continue;const e=elev[i];
        const left=elev[i-1],right=elev[i+1],up=elev[i-width],down=elev[i+width];
        const slope=Math.hypot(right-left,down-up);
        const shade=clamp(.96+(left-right)*.00075+(down-up)*.0005,.76,1.14);
        const high=clamp((e-700)/3000,0,1);
        // restrained olive/stone palette; never the former saturated yellow blanket
        const baseR=91+42*high,baseG=103+30*high,baseB=74+18*high;
        const edge=!mask[i-1]||!mask[i+1]||!mask[i-width]||!mask[i+width];
        const contour=(e>=3000&&(Math.min(left,right,up,down)<3000))||(e>=1800&&Math.min(left,right,up,down)<1800)||(e>=1000&&Math.min(left,right,up,down)<1000);
        const p=i*4;
        const dark=(edge||contour)?0.76:1;
        image.data[p]=clamp(Math.round(baseR*shade*dark),0,255);
        image.data[p+1]=clamp(Math.round(baseG*shade*dark),0,255);
        image.data[p+2]=clamp(Math.round(baseB*shade*dark),0,255);
        image.data[p+3]=edge?190:contour?175:Math.round(clamp(92+high*68+slope*.018,92,168));
      }
      if((y&31)===31)await yieldToBrowser();
    }
    ctx.putImageData(image,0,0);
    cachedTexture=canvas.toDataURL("image/png");return cachedTexture;
  })().finally(()=>{pendingTexture=null;});
  return pendingTexture;
}
