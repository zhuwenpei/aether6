import { Activity, Calendar, ChevronDown, ChevronUp, Images, OctagonX, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AetherInputDialog from "./AetherInputDialog";

interface Props {
  currentHour: number;
  maxHour: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onTerminate: () => void;
  isTerminationReport?: boolean;
  onOpenForecast?: () => void;
  onOpenInfluence?: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onReset: () => void;
  onSeek: (hour: number, mode?: "preview" | "commit") => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  startDate: Date;
  onStartDateChange?: (newDate: Date) => void;
  collapsed: boolean;
  onCollapseChange: (collapsed: boolean) => void;
}
const SPEEDS = [0.25,0.5,1,2,4,8,16,32];

export default function AetherMobileTransport(props: Props) {
  const { currentHour,maxHour,isPlaying,onPlayToggle,onTerminate,isTerminationReport=false,onOpenForecast,onOpenInfluence,onStepForward,onStepBackward,onReset,onSeek,speed,onSpeedChange,startDate,onStartDateChange,collapsed,onCollapseChange } = props;
  const [previewHour,setPreviewHour] = useState(currentHour);
  const [clockDialogOpen,setClockDialogOpen] = useState(false);
  const pendingRef = useRef(currentHour);
  const previewRafRef = useRef<number|null>(null);
  const lastPreviewDispatchRef = useRef(0);
  const scrubbingRef = useRef(false);
  useEffect(()=>{ if(!scrubbingRef.current){setPreviewHour(currentHour);pendingRef.current=currentHour;} },[currentHour]);
  useEffect(()=>()=>{ if(previewRafRef.current!==null)cancelAnimationFrame(previewRafRef.current); },[]);
  const preview = (h:number) => {
    scrubbingRef.current=true; setPreviewHour(h); pendingRef.current=h;
    if(previewRafRef.current!==null)return;
    const pump=(now:number)=>{
      if(now-lastPreviewDispatchRef.current>=46){
        lastPreviewDispatchRef.current=now;
        previewRafRef.current=null;
        onSeek(pendingRef.current,"preview");
      }else previewRafRef.current=requestAnimationFrame(pump);
    };
    previewRafRef.current=requestAnimationFrame(pump);
  };
  const commit = () => {
    if(!scrubbingRef.current)return; scrubbingRef.current=false;
    if(previewRafRef.current!==null){cancelAnimationFrame(previewRafRef.current);previewRafRef.current=null;}
    onSeek(pendingRef.current,"commit");
  };
  const displayDate = new Date(startDate.getTime()+previewHour*3600000);
  const stamp = `${String(displayDate.getMonth()+1).padStart(2,"0")}-${String(displayDate.getDate()).padStart(2,"0")} ${String(displayDate.getHours()).padStart(2,"0")}:00`;

  if(collapsed) return <nav className="aether-mobile-transport" aria-label="模拟播放控制">
    <div className="aether-landscape-time-main" aria-label="横屏大时间轴">
      <span>大时间轴 · T+{Math.round(currentHour)}h / {Math.round(maxHour)}h</span>
      <input type="range" min={0} max={Math.max(1,maxHour)} step={1}
        value={Math.min(previewHour,Math.max(1,maxHour))}
        aria-label="横屏历史时间位置" onChange={e=>preview(Number(e.target.value))}
        onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit}/>
    </div>
    <button onClick={onStepBackward} disabled={currentHour<=0} aria-label="后退一小时"><SkipBack /></button>
    <button className="primary" onClick={onPlayToggle} aria-label={isPlaying?"暂停":"播放"}>{isPlaying?<Pause/>:<Play className="fill-current"/>}</button>
    <button className={isTerminationReport ? "report" : "danger"} onClick={onTerminate} aria-label={isTerminationReport ? "查看停编报告" : "停编"}>{isTerminationReport?<Images/>:<OctagonX/>}</button>
    <button onClick={()=>onCollapseChange(false)} aria-label="展开时间轴"><ChevronUp /></button>
  </nav>;

  return <>
  <section className="aether-mobile-timeline" aria-label="详细时间轴">
    <div className="aether-mobile-timeline-head">
      <div><span>SIMULATION TIME</span><strong>{stamp}</strong></div>
      <button onClick={()=>onCollapseChange(true)} aria-label="收起时间轴"><ChevronDown /></button>
    </div>
    <div className="aether-mobile-seekrow">
      <span>0H</span>
      <input type="range" min={0} max={Math.max(1,maxHour)} step={1} value={Math.min(previewHour,Math.max(1,maxHour))}
        onChange={e=>preview(Number(e.target.value))} onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit}/>
      <span>{Math.round(maxHour)}H</span>
    </div>
    <div className="aether-mobile-timeline-meta"><b>T+{Math.round(previewHour)}H</b><span>{Math.round(maxHour-previewHour)}h remaining</span></div>
    <div className="aether-mobile-timeline-actions">
      <button onClick={onStepBackward} disabled={currentHour<=0}><SkipBack/><span>-1h</span></button>
      <button className="primary" onClick={onPlayToggle}>{isPlaying?<Pause/>:<Play className="fill-current"/>}<span>{isPlaying?"暂停":"播放"}</span></button>
      <button onClick={onStepForward}><SkipForward/><span>+1h</span></button>
      <label className="aether-mobile-speed"><span>模拟速度</span><select value={speed} onChange={e=>onSpeedChange(Number(e.target.value))}>{SPEEDS.map(v=><option key={v} value={v}>{v} h/s</option>)}</select></label>
    </div>
    <div className="aether-mobile-timeline-tools">
      <button onClick={onOpenForecast} disabled={!onOpenForecast}><Images/><span>产品</span></button>
      <button onClick={onOpenInfluence} disabled={!onOpenInfluence}><Activity/><span>影响</span></button>
      <button onClick={()=>{ if(onStartDateChange)setClockDialogOpen(true); }}><Calendar/><span>时钟</span></button>
      <button onClick={onReset}><RotateCcw/><span>重置</span></button>
      <button className={isTerminationReport?"report":"danger"} onClick={onTerminate}>{isTerminationReport?<Images/>:<OctagonX/>}<span>{isTerminationReport?"报告":"停编"}</span></button>
    </div>
  </section>
  <AetherInputDialog
    open={clockDialogOpen}
    title="修改当前模拟时刻"
    description="格式：YYYY-MM-DD HH（小时使用 00–23）。"
    initialValue={`${displayDate.getFullYear()}-${String(displayDate.getMonth()+1).padStart(2,"0")}-${String(displayDate.getDate()).padStart(2,"0")} ${String(displayDate.getHours()).padStart(2,"0")}`}
    placeholder="2026-09-27 08"
    onClose={()=>setClockDialogOpen(false)}
    onSubmit={(raw)=>{
      const match=raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})$/);
      if(!match)return "请输入 YYYY-MM-DD HH 格式。";
      const [,y,m,d,h]=match;
      const next=new Date(`${y}-${m}-${d}T${h}:00:00`);
      if(Number.isNaN(next.getTime())||Number(h)>23)return "日期或小时无效。";
      onStartDateChange?.(next);
    }}
  />
  </>;
}
