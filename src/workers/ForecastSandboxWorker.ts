/** Round167: separate the full ten-minute physics solver from map/UI RAF.
 * All simulation state and PRNG checkpoints remain owned by this worker while
 * playing. Display snapshots never skip physics steps; they only throttle IPC.
 */
import { TyphoonEngine, getLandMetrics } from '../simulation/Engine';
import { loadNaturalEarthData, getLoaderState } from '../simulation/NaturalEarthLoader';
import type { Typhoon, SimulationConfig } from '../types';

type Start = {type:'start';token:number;seed:string;randomState:number;storm:Typhoon;
  config:SimulationConfig;hour:number;startDate:string;speed:number};
type Command = Start | {type:'pause';token:number;pauseId?:number} |
  {type:'config';token:number;config:SimulationConfig} |
  {type:'state';token:number;storm:Typhoon;hour:number} |
  {type:'speed';token:number;speed:number} |
  {type:'stop'};
let token = -1;
let engine: TyphoonEngine | null = null;
let storm: Typhoon | null = null;
let config: SimulationConfig | null = null;
let hour = 0;
let startDate = new Date();
let speed = 8;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = 0;
let accumulated = 0;
let lastPublishedAt = 0;
let lastPublishedHistoryLength=0;
// Every Web Worker has its OWN module globals and RBush indexes. The parent
// page's Natural Earth preload is invisible here; never integrate on empty land.
let geographicStartSerial=0;
const emit = (type: 'snapshot'|'paused', pauseId?:number) => {
  if (!engine || !storm) return;
  const latestHistory=storm.history||[];
  // Delta encoding is critical at 8x/32x: sending the whole multi-year hourly
  // archive on every issue was capable of saturating structuredClone/GC and
  // yielding session-long UI jank depending on history size.
  const historyDelta=latestHistory.slice(lastPublishedHistoryLength);
  lastPublishedHistoryLength=latestHistory.length;
  const {history:_unused,...state}=storm;
  self.postMessage({type,token,storm:state,hour,
    prngState:engine.capturePrngState(),historyDelta,pauseId});
};
const tick = () => {
  timer=null;
  if (!running || !engine || !storm || !config) return;
  const now=performance.now();
  const dt=last?Math.min(100,now-last):0;
  last=now;
  accumulated=Math.min(720,accumulated+dt/1000*speed*60);
  let count=0,changed=false;
  const began=performance.now();
  try {
    while (accumulated>=10 && count<24 && (count===0||performance.now()-began<8)) {
      const next=hour+1/6;
      const result=engine.stepSimulation([storm],config,next,startDate,{liveForecastMode:'off'});
      if (!result.updatedTyphoons.length) throw new Error('预模拟未返回台风状态');
      storm=result.updatedTyphoons[0];
      hour=next; accumulated-=10; count++;changed=true;
      if (!storm.active || storm.dissipated) { running=false; break; }
    }
  } catch(e) {
    running=false;
    self.postMessage({type:'error',token,message:e instanceof Error?e.message:String(e)});
  }
  if (changed && running && performance.now()-lastPublishedAt>=330) {
    emit('snapshot');lastPublishedAt=performance.now();
  }
  if (running) timer=setTimeout(tick,12);
  else emit('paused');
};
const schedule=()=>{if(timer!==null)clearTimeout(timer);timer=setTimeout(tick,0);};
self.onmessage=(event:MessageEvent<Command>)=>{
  const message=event.data;
  if (message.type==='stop') {geographicStartSerial++;running=false;if(timer!==null)clearTimeout(timer);timer=null;return;}
  if (message.type==='start') {
    running=false;if(timer!==null)clearTimeout(timer);
    token=message.token;
    engine=new TyphoonEngine(message.seed);
    engine.restorePrngState(message.randomState);
    storm=message.storm;config=message.config;hour=message.hour;
    startDate=new Date(message.startDate);speed=message.speed;
    accumulated=0;last=0;lastPublishedAt=0;
    lastPublishedHistoryLength=storm.history?.length||0;
    const serial=++geographicStartSerial;
    // Initialize the same high-resolution land/country coastline data + indexes
    // used by the main simulator BEFORE advancing even a single physics step.
    // Fail closed instead of silently simulating all terrain as open ocean.
    void loadNaturalEarthData().then(ok=>{
      if(serial!==geographicStartSerial || token!==message.token)return;
      const loader=getLoaderState();
      if(!ok || !loader.landLoaded || !loader.countriesLoaded ||
          !getLandMetrics(31.2,121.5).isLand || getLandMetrics(20,135).isLand){
        self.postMessage({type:'error',token,message:'独立预模拟海岸线初始化或陆海校验失败，已阻止无陆地物理积分'});
        return;
      }
      running=true;last=0;schedule();
    }).catch(e=>{
      if(serial===geographicStartSerial && token===message.token)
        self.postMessage({type:'error',token,message:'独立预模拟无法加载海岸线：'+String(e)});
    });return;
  }
  if (message.token!==token)return;
  if (message.type==='pause') {
    geographicStartSerial++;
    running=false;if(timer!==null)clearTimeout(timer);timer=null;
    emit('paused',message.pauseId);return;
  }
  if (message.type==='config')config=message.config;
  if (message.type==='state'){storm=message.storm;hour=message.hour;lastPublishedHistoryLength=storm.history?.length||0;}
  if (message.type==='speed')speed=Math.max(1,Math.min(32,message.speed));
};
