/** Round158: physically independent forecast sandbox; never advances or edits the parent simulation. */
import {useEffect,useRef,useState} from 'react';
import {Check,X,Play,Pause,RotateCcw,Route} from 'lucide-react';
import type {Typhoon,SimulationConfig,ActiveLayers,EventLog} from '../types';
import {TyphoonEngine,reweightLiveWindRadiiForPreference} from '../simulation/Engine';
import {resolveCirculationSizeTransition} from '../simulation/CirculationSizeTransition';
import {buildPreSimulationReference,type PreSimulationReference} from '../simulation/PreSimulationReference';
import MapView from './MapView';
import VirtualJoystick from './VirtualJoystick';
import ControlDrawer from './ControlDrawer';
import AetherMobileChrome from './AetherMobileChrome';
import AetherDesktopChrome from './AetherDesktopChrome';
import {createSimulationArchiveBlob,readSimulationArchiveFile,type SimulationArchiveData} from '../utils/SimulationArchive';
import {applyForecastSandboxIntervention,clearForecastSandboxPenalties,type InterventionKind} from '../simulation/ForecastSandboxInterventions';
import ForecastSandboxTools from './ForecastSandboxTools';

type Props={initial:Typhoon; issueHour:number; config:SimulationConfig; layers:ActiveLayers;
  startDate:Date; seed:string; randomState?:number; mobileChrome?:boolean;
  mapViewport?:{center:[number,number];zoom:number};
  onConfirm:(reference:PreSimulationReference, copyToMain?:{
    storm:Typhoon;config:SimulationConfig;prngState:number;endHour:number
  })=>void;onCancel:()=>void};
const clone = <T,>(value:T):T=>structuredClone(value);

export default function ForecastPreSimulation({initial,issueHour,config,layers,startDate,seed,randomState,onConfirm,onCancel,mobileChrome=false,mapViewport}:Props){
  // The parent already hands this portal a deep-cloned, private branch.
  // One immutable reset snapshot is enough: avoid another full history clone.
  const [storm,setStorm]=useState<Typhoon>(()=>initial);
  const [sandboxConfig,setSandboxConfig]=useState<SimulationConfig>(()=>({...clone(config),
    // The user's hand-drawn *forecast* does not become sandbox physics by accident.
    manualForecastRouteEnabled:false,manualForecastRoute:[],manualForecastIntensityEnabled:false,
    manualForecastIntensityCurve:[],controlMode:'joystick',drawnTrackRoute:[],speed:8}));
  const configRef=useRef(sandboxConfig);
  const engineRef=useRef<TyphoonEngine|null>(null);
  if(!engineRef.current){
    const engine=new TyphoonEngine(seed+'|pre-simulation|'+initial.id+'|'+issueHour);
    if(Number.isFinite(randomState))engine.restorePrngState(randomState!);
    else engine.syncPrngToHour(issueHour);
    engineRef.current=engine;
  }
  const [cursor,setCursor]=useState(issueHour);
  const [endHour,setEndHour]=useState(issueHour);
  const hourRef=useRef(issueHour);
  // Round159: sandbox opens PAUSED; clicking Play is the only way to advance.
  const [playing,setPlaying]=useState(false);
  const playingRef=useRef(false);playingRef.current=playing;
  const [speed,setSpeed]=useState(8);
  const speedRef=useRef(speed);speedRef.current=speed;
  const accumulated=useRef(0);
  // Physics is never skipped: only the expensive React/Leaflet presentation is throttled.
  // At 8x the integrator may execute ~48 ten-minute steps per real second.
  const lastPresentationAt=useRef(0);
  const lastPublishedHour=useRef(issueHour);
  const lastJoystickPaint=useRef(0);
  // Worker is a performance isolation boundary, not an approximate physics mode.
  const workerRef=useRef<Worker|null>(null);
  const workerTokenRef=useRef(0);
  const workerPrngRef=useRef(engineRef.current!.capturePrngState());
  const pauseSerialRef=useRef(0);
  const activePauseRef=useRef<Promise<void>|null>(null);
  const pauseResolvesRef=useRef(new Map<number,()=>void>());
  const pauseSandbox=():Promise<void>=>{
    const wasPlaying=playingRef.current;
    playingRef.current=false;setPlaying(false);accumulated.current=0;
    if (!wasPlaying || !workerRef.current) return activePauseRef.current || Promise.resolve();
    const pauseId=++pauseSerialRef.current;
    const completion=new Promise<void>(resolve=>pauseResolvesRef.current.set(pauseId,resolve));
    activePauseRef.current=completion;
    void completion.then(()=>{if(activePauseRef.current===completion)activePauseRef.current=null;});
    workerRef.current.postMessage({type:'pause',token:workerTokenRef.current,pauseId});
    return completion;
  };
  const discardWorkerRun=()=>{
    workerTokenRef.current++;
    for(const resolve of pauseResolvesRef.current.values())resolve();
    pauseResolvesRef.current.clear();
  };
  const syncWorkerState=()=>{
    if (workerRef.current && playingRef.current)
      workerRef.current.postMessage({type:'state',token:workerTokenRef.current,storm:mainStormRef.current,hour:hourRef.current});
  };
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const mainStormRef=useRef<Typhoon>(storm);
  const endRef=useRef(issueHour);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [drawerTab,setDrawerTab]=useState<string|null>(null);
  const [sandboxLayers,setSandboxLayers]=useState<ActiveLayers>(()=>({...layers,
    forecast:false,forecastCone:false,drawnForecastRoute:false,hurricaneTrackerModels:false}));
  const [placement,setPlacement]=useState<'none'|'main'|'genesis'|'home'>('none');
  const [drawing,setDrawing]=useState(false);
  const [drawPoints,setDrawPoints]=useState<{lat:number;lon:number}[]>([]);
  const [logs,setLogs]=useState<EventLog[]>([]);
  const [editStorm,setEditStorm]=useState(false);
  const [influenceOpen,setInfluenceOpen]=useState(false);
  const startRef=useRef(clone(initial));
  const log=(message:string)=>setLogs(prev=>[...prev,{id:`branch-${Date.now()}-${prev.length}`,
    simHour:hourRef.current,time:new Date(startDate.getTime()+hourRef.current*3600000),
    message,type:'info' as const}].slice(-80));
  // If a RAF step has not yet reached React, publish it ONLY while actually playing.
  // A paused historical playback has its own cursor/storm and must not jump forward
  // simply because the user opens/closes a drawer or quick intervention menu.
  const pauseForMenu=()=>{
    const wasPlaying=playingRef.current;
    pauseSandbox();
    if(wasPlaying){
      setStorm(mainStormRef.current);setCursor(hourRef.current);setEndHour(endRef.current);
    }
  };
  const openTab=(tab:string|null)=>{
    pauseForMenu();
    setDrawerTab(tab);setDrawerOpen(true);
  };
  const openQuickTools=()=>{
    pauseForMenu();
    setDrawerOpen(false);
    setInfluenceOpen(true);
  };
  const startSandboxFrom=(hour:number)=>{
    const state=mainStormRef.current.history.find(s=>Math.abs(s.simHour-hour)<1e-4);
    if(!state)return;
    const history=mainStormRef.current.history.filter(s=>s.simHour<=hour+1e-5);
    mainStormRef.current={...mainStormRef.current,...state,history,active:!state.dissipated,forecastPath:[]};
    hourRef.current=hour;endRef.current=hour;setEndHour(hour);
    engineRef.current!.syncPrngToHour(hour);
    workerPrngRef.current=engineRef.current!.capturePrngState();
  };
  /** Edit the sandbox, never the parent. Old replay futures are explicitly branched. */
  const mutateStorm=(patch:Partial<Typhoon>)=>{
    if(!playingRef.current)discardWorkerRun();
    if(cursor<endRef.current-1e-5){pauseSandbox();startSandboxFrom(cursor);}
    const original=mainStormRef.current;
    const history=[...(original.history||[])];
    const i=history.findIndex(s=>Math.abs(s.simHour-hourRef.current)<1e-5);
    if(i>=0)history[i]={...history[i],...patch};
    const updated={...original,...patch,history,forecastPath:[]};
    mainStormRef.current=updated;setStorm(updated);syncWorkerState();
  };
  // Apply all quick interventions only to this independent branch. Historical
  // replays fork before editing, exactly as they do for physical storm edits.
  const editBranch=(change:(ty:Typhoon)=>Typhoon)=>{
    if(!playingRef.current)discardWorkerRun();
    if(cursor<endRef.current-1e-5){pauseSandbox();startSandboxFrom(cursor);}
    const original=mainStormRef.current;
    const changed=change(original);
    const history=[...changed.history];
    const at=history.findIndex(h=>Math.abs(h.simHour-hourRef.current)<1e-5);
    if(at>=0){
      const {history:_discard,...state}=changed;
      history[at]={...history[at],...state};
    }
    const updated={...changed,history,forecastPath:[]};
    mainStormRef.current=updated;
    setStorm(updated);syncWorkerState();
  };
  const applyCirculationTarget=(raw:number)=>{
    const target=Math.max(0,Math.round(raw));
    const now=hourRef.current;
    const old=resolveCirculationSizeTransition(configRef.current,now).referenceKm;
    const duration=Math.max(0,Number(configRef.current.circulationSizeTransitionHours??0));
    // Match the live simulator: an immediate target reweights the CURRENT
    // published quadrants, while a timed change waits for 3-hour analyses.
    if(duration<=1e-6 && Math.abs(target-old)>1e-6){
      if(!pendingSizeOrigin.current || Math.abs(pendingSizeOrigin.current.hour-now)>1e-4){
        const ty=mainStormRef.current;
        pendingSizeOrigin.current={target,origin:old,hour:now,r7:{...ty.r7},r10:{...ty.r10},r12:{...ty.r12}};
      }else pendingSizeOrigin.current.target=target;
      const before={...configRef.current,circulationSizeReferenceKm:old};
      const after={...configRef.current,circulationSizeReferenceKm:target};
      editBranch(ty=>reweightLiveWindRadiiForPreference(ty,before,after));
    }
    onConfigChange({circulationSizeReferenceKm:target,
      circulationSizeTransitionFromKm:duration>0?old:target,
      circulationSizeTransitionTargetKm:target,
      circulationSizeTransitionStartHour:now,
      circulationSizeTransitionHours:duration});
  };
  const pendingSizeOrigin=useRef<null|{target:number;origin:number;hour:number;
    r7:Typhoon['r7'];r10:Typhoon['r10'];r12:Typhoon['r12']}>(null);
  const setCirculationTransitionDuration=(hours:number)=>{
    const duration=Math.max(0,Math.min(72,Number(hours)||0));
    const now=hourRef.current;
    const cfg=configRef.current;
    const target=Math.max(0,Number(cfg.circulationSizeReferenceKm??320));
    const pending=pendingSizeOrigin.current;
    const reused=duration>0 && pending && Math.abs(pending.target-target)<1e-5 &&
      Math.abs(pending.hour-now)<1e-4 && !(cfg.circulationSizeTransitionHours??0);
    let from=resolveCirculationSizeTransition(cfg,now).referenceKm;
    if(reused){
      from=pending!.origin;
      editBranch(ty=>({...ty,r7:{...pending!.r7},r10:{...pending!.r10},r12:{...pending!.r12}}));
    }
    pendingSizeOrigin.current=null;
    onConfigChange({circulationSizeTransitionHours:duration,
      circulationSizeTransitionFromKm:duration>0?from:target,
      circulationSizeTransitionTargetKm:target,
      circulationSizeTransitionStartHour:now});
  };
  const applyIntervention=(type:InterventionKind,option:string)=>editBranch(ty=>
    applyForecastSandboxIntervention(ty,type,option,(message)=>setNotice(message)));
  const updateColdAir=(strength:0|1|2|3,delay:number)=>editBranch(ty=>{
    const next={...ty};
    if(!strength){
      delete next.forcedColdAirStrength;delete next.forcedColdAirArrivalHour;
      delete next.forcedColdAirScheduledHour;delete next.coldAirExposureHours;
    }else{
      next.forcedColdAirStrength=strength;
      next.forcedColdAirArrivalHour=hourRef.current+Math.max(0,Math.min(96,delay));
      next.forcedColdAirScheduledHour=hourRef.current;
      next.coldAirExposureHours=0;
    }
    return next;
  });
  const updateColdWater=(temperature:number,duration:number)=>editBranch(ty=>{
    const next={...ty};
    if(duration<=0){
      delete next.forcedColdWaterTemperatureC;delete next.forcedColdWaterStartHour;
      delete next.forcedColdWaterEndHour;delete next.forcedColdWaterDurationHours;
    }else{
      next.forcedColdWaterTemperatureC=Math.max(0,Math.min(30,temperature));
      next.forcedColdWaterStartHour=hourRef.current;
      next.forcedColdWaterDurationHours=Math.max(0,Math.min(240,duration));
      next.forcedColdWaterEndHour=hourRef.current+next.forcedColdWaterDurationHours;
    }
    return next;
  });
  const clearPenalties=()=>editBranch(ty=>clearForecastSandboxPenalties(ty,(message)=>setNotice(message)));
  const onConfigChange=(patch:Partial<SimulationConfig>)=>{
    if(cursor<endRef.current-1e-5){pauseSandbox();startSandboxFrom(cursor);}
    // The 10-minute physics RAF reads configRef, NOT the queued React state.
    // Assign synchronously so sliders / checkboxes take effect on the next step
    // even if React batches their render or the simulator remains at 8x.
    const next={...configRef.current,...patch};
    configRef.current=next;
    setSandboxConfig(next);
    workerRef.current?.postMessage({type:'config',token:workerTokenRef.current,config:next});
  };
  const handlePlacement=(lat:number,lon:number)=>{
    if(drawing){setDrawPoints(prev=>[...prev,{lat,lon}].slice(0,250));return;}
    if(placement!=='none'){
      mutateStorm({lat,lon});setPlacement('none');
    }
  };
  const resetBranch=()=>{
    void pauseSandbox();discardWorkerRun();accumulated.current=0;
    lastPresentationAt.current=0;lastPublishedHour.current=issueHour;
    mainStormRef.current=clone(startRef.current);
    const engine=new TyphoonEngine(seed+'|pre-simulation|'+initial.id+'|'+issueHour);
    if(Number.isFinite(randomState))engine.restorePrngState(randomState!);
    else engine.syncPrngToHour(issueHour);
    engineRef.current=engine;workerPrngRef.current=engine.capturePrngState();
    hourRef.current=issueHour;endRef.current=issueHour;
    setCursor(issueHour);setEndHour(issueHour);setStorm(clone(startRef.current));
    setError('');log('独立预模拟已重置到起报时刻');
  };
  const branchArchiveData=():SimulationArchiveData=>({
    typhoons:[clone(mainStormRef.current)],eventLogs:logs,config:clone(configRef.current),
    layers:sandboxLayers,currentHour:cursor,maxHour:endRef.current,
    totalSimMinutes:Math.round(endRef.current*60),startDate:startDate.toISOString(),
    seasonEnded:false,speed,prngState:workerPrngRef.current,
    timelineCollapsed:false,genesisPos:{lat:initial.lat,lon:initial.lon}
  });
  const exportBranchArchive=async(mode:'readable'|'compressed'='readable')=>{
    await pauseSandbox();
    const blob=await createSimulationArchiveBlob(branchArchiveData(),mode);
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;
    a.download=`AETHER_forecast_branch_${issueHour.toFixed(0)}h.${mode==='readable'?'aether.json':'aether'}`;
    document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  const importBranchArchive=async(file:File):Promise<boolean>=>{
    await pauseSandbox();discardWorkerRun();
    const loaded=await readSimulationArchiveFile(file);
    const data=loaded.data;
    const next=data.typhoons.find(t=>t.id===initial.id);
    if(!next || !next.history.some(h=>Math.abs(h.simHour-issueHour)<1e-5))
      throw new Error('此存档不包含当前台风和预模拟起报时刻，不能用于该分支。');
    if(data.maxHour<issueHour || data.currentHour<issueHour ||
      data.startDate!==startDate.toISOString())
      throw new Error('存档的风季时间与当前预模拟不一致。');
    if(!window.confirm('只覆盖独立预模拟分支，不影响主模拟。确定读取吗？'))return false;
    const restored=clone(next);
    mainStormRef.current=restored;
    engineRef.current!.restorePrngState(data.prngState);workerPrngRef.current=data.prngState;
    hourRef.current=data.maxHour;endRef.current=data.maxHour;
    setEndHour(data.maxHour);setCursor(data.currentHour);
    const state=restored.history.find(h=>Math.abs(h.simHour-data.currentHour)<1e-5);
    setStorm(state?{...restored,...state,history:restored.history}:restored);
    configRef.current=clone(data.config);
    setSandboxConfig(configRef.current);
    setSandboxLayers({...data.layers,forecast:false,forecastCone:false,
      drawnForecastRoute:false,hurricaneTrackerModels:false});
    setLogs(data.eventLogs);setSpeed(data.speed);
    accumulated.current=0;lastPresentationAt.current=0;lastPublishedHour.current=data.currentHour;setError('');
    return true;
  };
  const applyDrawRoute=()=>{
    if(drawPoints.length<2){setError('控制路径至少需要两个节点');return;}
    onConfigChange({controlMode:'draw',drawnTrackRoute:[{lat:storm.lat,lon:storm.lon},...drawPoints]});
    setDrawing(false);setDrawPoints([]);setError('');
  };

  // The sandbox worker shields React/Leaflet from expensive individual physics
  // steps (especially storm/environment-dependent hourly station analyses).
  // Fallback below preserves identical integration for browsers without Workers.
  useEffect(()=>{
    let worker:Worker;
    try{worker=new Worker(new URL('../workers/ForecastSandboxWorker.ts',import.meta.url),{type:'module'});}
    catch{return;}
    workerRef.current=worker;
    worker.onmessage=(event:MessageEvent<any>)=>{
      const data=event.data;
      if (data.token!==workerTokenRef.current)return;
      if(data.type==='error'){
        setError(data.message||'预模拟物理计算发生错误');
        playingRef.current=false;setPlaying(false);
        for(const resolve of pauseResolvesRef.current.values())resolve();
        pauseResolvesRef.current.clear();return;
      }
      if(data.type!=='snapshot' && data.type!=='paused')return;
      const updated:Typhoon={...data.storm,history:[...mainStormRef.current.history,...(data.historyDelta||[])]};
      mainStormRef.current=updated;
      hourRef.current=data.hour;endRef.current=data.hour;
      workerPrngRef.current=data.prngState;
      engineRef.current?.restorePrngState(data.prngState);
      lastPublishedHour.current=data.hour;
      setStorm(updated);setCursor(data.hour);setEndHour(data.hour);
      if(data.type==='paused'){
        if(playingRef.current && (!updated.active || updated.dissipated)){
          playingRef.current=false;setPlaying(false);
        }
        if(data.pauseId!==undefined){
          pauseResolvesRef.current.get(data.pauseId)?.();pauseResolvesRef.current.delete(data.pauseId);
        }
      }
    };
    worker.onerror=()=>{
      // Do not restart a second integrator against a possibly advanced worker.
      // Fall back to the existing main-thread integrator from the LAST
      // acknowledged physical/PRNG checkpoint, never run both loops together.
      worker.terminate();if(workerRef.current===worker)workerRef.current=null;
      setError('预模拟计算线程异常，已停在最近确认的物理节点；可以重新播放（备用模式）');
      playingRef.current=false;setPlaying(false);
      for(const resolve of pauseResolvesRef.current.values())resolve();
      pauseResolvesRef.current.clear();
    };
    return()=>{worker.postMessage({type:'stop'});worker.terminate();workerRef.current=null;
      for(const resolve of pauseResolvesRef.current.values())resolve();pauseResolvesRef.current.clear();};
  },[]);
  useEffect(()=>{
    workerRef.current?.postMessage({type:'speed',token:workerTokenRef.current,speed});
  },[speed]);
  // One independent simulation RAF. Physics stepping matches the main 10-minute integrator;
  // no runtime/timer or React state from the parent is shared with this branch.
  useEffect(()=>{
    let raf=0,last=0;
    let stopped=false;
    const tick=(now:number)=>{
      if(stopped)return;
      raf=requestAnimationFrame(tick);
      if(!last){last=now;return;}
      const dt=Math.min(100,now-last);last=now;
      if(!playingRef.current || workerRef.current)return;
      accumulated.current=Math.min(720,accumulated.current+dt/1000*speedRef.current*60);
      let working=mainStormRef.current;
      let changed=false,count=0;
      const t0=performance.now();
      while(accumulated.current>=10 && count<32 && (count===0||performance.now()-t0<9)){
        const nextHour=hourRef.current+1/6;
        try{
          const result=engineRef.current!.stepSimulation([working],configRef.current,nextHour,startDate,{liveForecastMode:'off'});
          if(!result.updatedTyphoons?.length)throw new Error('预模拟未返回台风状态');
          working=result.updatedTyphoons[0];
        }catch(e){setError(e instanceof Error?e.message:String(e));pauseSandbox();accumulated.current=0;return;}
        hourRef.current=nextHour;
        accumulated.current-=10;
        count++;changed=true;
        if(!working.active||working.dissipated){pauseSandbox();break;}
      }
      if(changed){
        mainStormRef.current=working;
        workerPrngRef.current=engineRef.current!.capturePrngState();
        endRef.current=hourRef.current;
        // The history/physical state advances on *every* ten-minute step, but
        // map layers only receive a new immutable snapshot at most 10 times/s.
        // Always flush on dissipation, pause, or an explicit whole-hour boundary.
        const wholeHour=Math.abs(hourRef.current-Math.round(hourRef.current))<1e-5;
        const flush=!playingRef.current || now-lastPresentationAt.current>=100 ||
          (wholeHour && Math.floor(hourRef.current)>Math.floor(lastPublishedHour.current));
        if(flush){
          lastPresentationAt.current=now;
          lastPublishedHour.current=hourRef.current;
          setStorm(working);
          setEndHour(hourRef.current);
          setCursor(hourRef.current);
        }
      }
    };
    raf=requestAnimationFrame(tick);
    return()=>{stopped=true;cancelAnimationFrame(raf);playingRef.current=false;};
  },[startDate]);
  // Parent keyboard/gamepad controls must never receive sandbox keystrokes.
  useEffect(()=>{
    const block=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null;
      const interactive=!!target?.closest('button,input,select,textarea');
      e.stopImmediatePropagation();
      if(!interactive && ['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyM','Enter'].includes(e.code))
        e.preventDefault();
    };
    window.addEventListener('keydown',block,true);
    return()=>window.removeEventListener('keydown',block,true);
  },[]);
  const seek=(hour:number)=>{
    const h=Math.max(issueHour,Math.min(Math.floor(endRef.current),Math.round(hour)));
    void pauseSandbox();discardWorkerRun();
    setCursor(h);
    const state=mainStormRef.current.history.find(s=>Math.abs(s.simHour-h)<1e-4);
    if(state){setStorm(prev=>({...prev,...state,history:mainStormRef.current.history,forecastPath:[],active:!state.dissipated}));}
  };
  const resume=()=>{
    // Replaying older hours must never silently overwrite the branch history.
    if(cursor<Math.floor(endRef.current)-1e-5){
      const h=cursor;
      if(!mainStormRef.current.history.some(s=>Math.abs(s.simHour-h)<1e-4)){
        setError('没有可继续模拟的历史状态');return;
      }
      startSandboxFrom(h);
    }
    accumulated.current=0;
    lastPresentationAt.current=0;
    setError('');playingRef.current=true;setPlaying(true);
    if(workerRef.current){
      workerTokenRef.current++;
      workerRef.current.postMessage({type:'start',token:workerTokenRef.current,
        seed:seed+'|pre-simulation|'+initial.id+'|'+issueHour,
        randomState:workerPrngRef.current,storm:mainStormRef.current,
        config:configRef.current,hour:hourRef.current,startDate:startDate.toISOString(),speed:speedRef.current});
    }
  };
  const finish=async()=>{
    try{
      await pauseSandbox();
      const ref=buildPreSimulationReference(mainStormRef.current,issueHour);
      const copy=window.confirm('预模拟已完成。是否将整套预模拟台风历史和最终状态复制到主模拟？\n\n确定：应用到预报，并直接推进主模拟到预模拟结束时刻。\n取消：仅应用到预报，主模拟保持原样，由你自行继续运行。');
      onConfirm(ref,copy?{
        storm:clone(mainStormRef.current), config:clone(configRef.current),
        prngState:workerPrngRef.current,endHour:endRef.current
      }:undefined);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  return <div className="fixed inset-0 z-[9900] bg-[#081119] text-white" data-preforecast-controls>
    <MapView viewportId="forecast-gis-viewport" initialViewport={mapViewport} typhoons={[storm]} layers={sandboxLayers} config={sandboxConfig} speed={speed}
      currentHour={cursor} historicalPlayback={cursor<endHour-1e-5 || !playing}
      isPlaying={playing} startDate={startDate} placementMode={drawing?'main':placement}
      onMapClickPlacement={handlePlacement} onMiddleClickPlacement={handlePlacement}
      isForecastRouteDrawing={drawing} forecastRouteDraft={drawPoints}
      onForecastRoutePoint={handlePlacement}/>
    {mobileChrome ? <AetherMobileChrome
      brandText="Forecast" sandboxMode typhoon={storm} currentHour={cursor}
      startDate={startDate} isPlaying={playing} maxHour={endHour}
      config={sandboxConfig} soundEnabled={sandboxConfig.soundEnabled!==false}
      onProducts={()=>{}} onSettings={()=>openTab(null)} onHelp={()=>openTab('usage')}
      onInfluence={openQuickTools} onMoreOpen={pauseForMenu}
      onToggleSound={()=>onConfigChange({soundEnabled:sandboxConfig.soundEnabled===false})}
      onFullscreen={()=>document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.()}
      onStartForecastRoute={()=>{pauseSandbox();setDrawing(true);setDrawPoints([]);}}
      onClearForecastRoute={()=>onConfigChange({drawnTrackRoute:[],controlMode:'joystick'})}
      onForecastPeakChange={(value,enabled)=>onConfigChange({forecastPeakIntensityReference:value,forecastPeakIntensityEnabled:enabled})}
    /> : <AetherDesktopChrome
      brandText="Forecast" sandboxMode typhoon={storm} currentHour={cursor}
      startDate={startDate} isPlaying={playing} maxHour={endHour}
      config={sandboxConfig} soundEnabled={sandboxConfig.soundEnabled!==false}
      onProducts={()=>{}} onSettings={()=>openTab(null)} onHelp={()=>openTab('usage')}
      onInfluence={openQuickTools} onMoreOpen={pauseForMenu}
      onToggleSound={()=>onConfigChange({soundEnabled:sandboxConfig.soundEnabled===false})}
      onFullscreen={()=>document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.()}
    />}
    <div className="pro-route-toolbar fixed left-3 bottom-[max(225px,29dvh)] max-[650px]:bottom-[max(345px,40dvh)] z-[9920] flex gap-1 rounded-xl border border-slate-600/80 bg-[#111820]/95 p-1 shadow-2xl backdrop-blur-md" aria-label="预模拟确认或取消">
      <button title="确认并应用预模拟" aria-label="确认预模拟" onClick={finish}
        disabled={endHour-issueHour<1} className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/95 text-white disabled:opacity-35"><Check size={19}/></button>
      <button title="取消预模拟" aria-label="取消预模拟" onClick={onCancel}
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-600 bg-slate-800/95 text-slate-100"><X size={19}/></button>
    </div>
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9920] flex flex-col items-center w-[min(580px,94vw)] rounded-xl border border-slate-600 bg-[#0a1825]/95 px-3 py-2 shadow-xl" data-forecast-transport>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <button className="p-2 rounded bg-sky-600" onClick={()=>playingRef.current?pauseSandbox():resume()} aria-label={playing?'暂停预模拟':'播放预模拟'}>{playing?<Pause size={17}/>:<Play size={17}/>}</button>
        <button className="p-2 rounded bg-slate-700" title="返回起报点回放" onClick={()=>seek(issueHour)}><RotateCcw size={16}/></button>
        <span className="text-slate-300">速度</span>
        <select className="bg-slate-800 rounded p-1" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
          {[1,2,4,8,16,32].map(x=><option key={x} value={x}>{x}×</option>)}
        </select>
        <span className="font-mono text-xs">+{(cursor-issueHour).toFixed(1)} / +{(endHour-issueHour).toFixed(1)}h</span>
      </div>
      <input type="range" aria-label="预模拟时间回放" className="w-full accent-sky-400" min={issueHour} max={Math.max(issueHour+1,Math.floor(endHour))} step="1" value={Math.min(cursor,Math.max(issueHour+1,Math.floor(endHour)))} onChange={e=>seek(Number(e.target.value))}/>
      {error&&<p role="alert" className="text-rose-300 text-xs">{error}</p>}
      {notice&&<p role="status" className="text-emerald-300 text-[11px] text-center">{notice}</p>}
    </div>
    {influenceOpen&&<ForecastSandboxTools storm={storm} config={sandboxConfig} hour={cursor}
      onClose={()=>setInfluenceOpen(false)} onApply={applyIntervention}
      onConfig={onConfigChange} onColdAir={updateColdAir}
      onColdWater={updateColdWater} onClearPenalties={clearPenalties}
      onCirculationTarget={applyCirculationTarget}
      onCirculationDuration={setCirculationTransitionDuration}
      onNotice={(text)=>setNotice(text)}/> }
    {/* Reuse the very same typhoon, atmosphere, ocean, map, display and custom
        settings pages as the live simulator, with sandbox-local callbacks. */}
    {editStorm&&<div className="fixed top-32 right-3 z-[9925] w-[min(300px,92vw)] bg-slate-950/95 rounded-xl border border-sky-500/50 p-3 text-xs shadow-2xl">
      <div className="font-semibold mb-2">当前台风状态 · 仅预模拟分支</div>
      {([['vmax','最大风速 (m/s)',5,90],['pmin','最低气压 (hPa)',850,1035],
        ['rmw','最大风速半径 (km)',5,150],['speed','移速 (km/h)',0,100],
        ['direction','移向 (°)',0,359]] as const).map(([key,label,min,max])=><label key={key} className="flex justify-between items-center gap-2 mb-2">
          <span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={key==='pmin'?1:0.5}
          value={Math.round((Number(storm[key])||0)*10)/10}
          className="w-20 bg-slate-800 rounded px-1 py-1 text-right"
          onChange={e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>=min&&v<=max)mutateStorm({[key]:v} as Partial<Typhoon>);}}/>
        </label>)}
      <button className="px-3 py-1 rounded bg-slate-700" onClick={()=>setEditStorm(false)}>完成</button>
    </div>}
    <div className="fixed left-3 top-[max(132px,16dvh)] z-[9920] flex flex-row flex-wrap items-center gap-1.5 max-w-[min(310px,75vw)] pointer-events-auto" data-forecast-branch-actions>
      <button onClick={()=>{pauseSandbox();setDrawing(v=>!v);setDrawPoints([]);}}
        className="min-w-0 whitespace-nowrap rounded-lg bg-slate-950/85 border border-slate-600 px-2 py-2 text-xs flex gap-1 items-center"><Route size={15}/>画点控制</button>
      {drawing&&<><button className="bg-emerald-700 rounded-lg px-2 py-2 text-xs" onClick={applyDrawRoute}>应用 {drawPoints.length} 点</button>
        <button className="bg-slate-700 rounded-lg px-2 py-2 text-xs" onClick={()=>{setDrawing(false);setDrawPoints([]);}}>取消</button></>}
      <button onClick={resetBranch} className="min-w-0 whitespace-nowrap rounded-lg bg-slate-950/85 border border-slate-600 px-2 py-2 text-xs flex gap-1 items-center"><RotateCcw size={14}/>重置分支</button>
    </div>
    <div className="relative z-[9990]">
    <ControlDrawer isOpen={drawerOpen} requestedTab={drawerTab} sandboxMode mobileMode={mobileChrome}
      onClose={()=>setDrawerOpen(false)} typhoons={[storm]} startDate={startDate}
      config={sandboxConfig} layers={sandboxLayers}
      onConfigChange={onConfigChange}
      onUpdateTyphoonIdentity={(_,patch)=>mutateStorm(patch)}
      onLayersChange={l=>setSandboxLayers(prev=>({...prev,...l,
        forecast:false,forecastCone:false,drawnForecastRoute:false,hurricaneTrackerModels:false}))}
      onDeployTyphoon={mode=>{setDrawerOpen(false);pauseSandbox();setPlacement(mode);}}
      onGenerateEnvironment={()=>onConfigChange({seed:`${sandboxConfig.seed}|branch-${hourRef.current.toFixed(2)}`})}
      onResetSimulation={resetBranch}
      onClearTrack={()=>onConfigChange({drawnTrackRoute:[]})}
      onExportSimulationArchive={exportBranchArchive}
      onImportSimulationArchive={importBranchArchive}
      eventLogs={logs} onClearLogs={()=>setLogs([])} onSeekHour={seek}
      genesisPos={{lat:storm.lat,lon:storm.lon}}
      isForecastRouteDrawing={drawing} forecastRoutePointCount={drawPoints.length}
      onStartForecastRoute={()=>{setDrawerOpen(false);pauseSandbox();setDrawing(true);setDrawPoints([]);}}
      onFinishForecastRoute={()=>{applyDrawRoute();setDrawerOpen(false);}}
      onCancelForecastRoute={()=>{setDrawing(false);setDrawPoints([]);}}
      onClearForecastRoute={()=>onConfigChange({drawnTrackRoute:[]})}
    />
    </div>
    <div className="fixed bottom-4 left-3 z-[9910] max-[650px]:bottom-[112px]">
      <VirtualJoystick compact dx={sandboxConfig.joystickDx||0} dy={sandboxConfig.joystickDy||0}
        strength={sandboxConfig.joystickStrength||1} enabled={true}
        returnToCenter={sandboxConfig.joystickReturnToCenter!==false}
        onChange={(dx,dy,dragging)=>{
          // Avoid a React/Leaflet full re-render at joystick pointer frequency.
          configRef.current={...configRef.current,joystickDx:dx,joystickDy:dy,joystickDragging:!!dragging};
          workerRef.current?.postMessage({type:'config',token:workerTokenRef.current,config:configRef.current});
          const stamp=performance.now();
          if(!dragging || stamp-lastJoystickPaint.current>=100){
            lastJoystickPaint.current=stamp;
            setSandboxConfig(configRef.current);
          }
        }}/>
    </div>
  </div>;
}
