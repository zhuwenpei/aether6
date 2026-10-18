/** Round162: the Forecast branch uses the ORIGINAL live quick-tool pages and markup.
 * Extracted verbatim from App's main quick-tool modal (Round161), with a branch-local
 * action adapter rather than a second simplified UI implementation.
 */
import {useRef,useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {Typhoon,SimulationConfig} from '../types';
import {playSndClick} from '../utils/audio';
import type {InterventionKind} from '../simulation/ForecastSandboxInterventions';

type Props={storm:Typhoon;config:SimulationConfig;hour:number;onClose:()=>void;
  onApply:(type:InterventionKind,option:string)=>void;
  onConfig:(patch:Partial<SimulationConfig>)=>void;
  onColdAir:(strength:0|1|2|3,delay:number)=>void;
  onColdWater:(temperature:number,duration:number)=>void;
  onClearPenalties:()=>void;
  onCirculationTarget:(km:number)=>void;
  onCirculationDuration:(hours:number)=>void;
  onNotice?:(message:string,level:string)=>void};

export default function ForecastSandboxTools({storm,config,hour,onClose,onApply,onConfig,
  onColdAir,onColdWater,onClearPenalties,onCirculationTarget,onCirculationDuration,onNotice}:Props){
  const typhoons=[storm];
  const currentHour=hour;
  const [activeInfluenceCategory,setActiveInfluenceCategory]=useState<'main'|'ewrc'|'dry_air'|'shear'|'cold_air'|'cold_water'|'rapid'>('main');
  const [coldAirStrength,setColdAirStrength]=useState<1|2|3>(3);
  const [coldAirDelayHours,setColdAirDelayHours]=useState(12);
  const [coldWaterDurationHours,setColdWaterDurationHours]=useState(24);
  const [coldWaterTemperatureC,setColdWaterTemperatureC]=useState(24);
  const influenceSheetDragRef=useRef<{pointerId:number;startY:number}|null>(null);
  const [inputDialog,setInputDialog]=useState<null|{title:string;initialValue:string}>(null);
  const setIsInfluenceModalOpen=(open:boolean)=>{if(!open){setActiveInfluenceCategory('main');onClose();}};
  const showToast=(message:string,level:string)=>onNotice?.(message,level);
  const applyConfigPatch=onConfig;
  const handleApplyInfluence=onApply;
  const handleCancelAllPenalties=onClearPenalties;
  const handleScheduleColdAir=(strength:1|2|3,delay:number)=>onColdAir(strength,delay);
  const handleCancelColdAir=()=>onColdAir(0,0);
  const handleScheduleColdWater=onColdWater;
  const handleCancelColdWater=()=>onColdWater(0,0);
  const applyCirculationSizeTarget=onCirculationTarget;
  const applyCirculationTransitionDuration=onCirculationDuration;
  const setAppInputDialog=(dialog:{kind:string;title:string;initialValue:string})=>setInputDialog(dialog);
  return <>
          <div className="aether-influence-overlay fixed inset-0 z-[10000] flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto touch-pan-y overscroll-contain">
            <div className={`aether-influence-modal relative w-[min(520px,calc(100vw-24px))] max-h-[min(86dvh,820px)] overflow-y-auto touch-pan-y overscroll-contain rounded-2xl p-4 sm:p-5 lg:p-6 border shadow-2xl transition-all duration-200 ${
              "bg-[#0b1726]/98 border-slate-700/60 text-slate-100"
            }`}>
              <button
                type="button"
                className="aether-influence-sheet-handle"
                aria-label="下滑收起快捷工具"
                onPointerDown={(e) => {
                  influenceSheetDragRef.current = { pointerId: e.pointerId, startY: e.clientY };
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
                }}
                onPointerUp={(e) => {
                  const drag = influenceSheetDragRef.current;
                  influenceSheetDragRef.current = null;
                  if (drag && drag.pointerId === e.pointerId && e.clientY - drag.startY >= 44) {
                    setIsInfluenceModalOpen(false); setActiveInfluenceCategory("main");
                  }
                }}
                onPointerCancel={() => { influenceSheetDragRef.current = null; }}
                onClick={() => { setIsInfluenceModalOpen(false); setActiveInfluenceCategory("main"); }}
              ><span /></button>
              
              <div className="mb-4 flex items-center justify-between border-b border-slate-700/50 pb-3">
                <div>
                  <div className="text-sm font-bold tracking-wide">快捷工具</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">结构干预 · 环境影响 · 强度与环流参考</div>
                </div>
                <Sparkles className="h-4 w-4 text-slate-400" />
              </div>

              {/* Main Categories Menu */}
              {activeInfluenceCategory === "main" && (() => {
                const activeTy = typhoons[0];
                const hasEwrc = activeTy && (activeTy.forcedEWRC || (activeTy.ewrcState && activeTy.ewrcState !== "none"));
                const hasDryAir = activeTy && activeTy.forcedDryAir;
                const hasShear = activeTy && activeTy.forcedShear !== undefined;
                const hasRI = activeTy && (activeTy.forcedRapidIntensification || activeTy.rapidIntensifying);
                const activeRIMode = activeTy ? (activeTy.forcedRapidIntensificationMode || activeTy.rapidIntensificationMode || "ri") : "ri";
                const isRISuppressed = activeTy && (!!activeTy.forcedDryAir || (activeTy.forcedShear !== undefined && activeTy.forcedShear > 15.0) || activeTy.ewrcState === "penalty_failure" || activeTy.ewrcIsFailure);

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("ewrc");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasEwrc
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>🌀 开启眼墙置换 (EWRC) {hasEwrc && <span className="text-xs text-emerald-400 font-bold ml-1.5">[周期演变中]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("dry_air");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasDryAir
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>🍂 干空气卷入 (Dry Air) {hasDryAir && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("shear");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasShear
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 text-slate-200"
                    }`}
                  >
                    <span>⚡ 强风切变 (Wind Shear) {hasShear && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                        return;
                      }
                      const active = typhoons[0];
                      if (active.forcedColdAirStrength) setColdAirStrength(active.forcedColdAirStrength);
                      if (Number.isFinite(active.forcedColdAirArrivalHour)) setColdAirDelayHours(Math.max(0, Math.round((active.forcedColdAirArrivalHour as number) - currentHour)));
                      setActiveInfluenceCategory("cold_air");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      activeTy?.forcedColdAirStrength
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.42)] bg-cyan-950/30 text-cyan-200"
                        : "bg-sky-950/20 border-sky-900/40 hover:bg-sky-900/40 text-sky-200"
                    }`}
                  >
                    <span>❄️ 冷空气南下 {activeTy?.forcedColdAirStrength ? <span className="text-xs text-cyan-300 font-bold ml-1.5">[已安排 · {activeTy.forcedColdAirStrength}档]</span> : null}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法设置冷水区", "warning");
                        return;
                      }
                      const active = typhoons[0];
                      if (Number.isFinite(active.forcedColdWaterTemperatureC)) setColdWaterTemperatureC(Math.max(0, Math.min(30, active.forcedColdWaterTemperatureC as number)));
                      if (Number.isFinite(active.forcedColdWaterEndHour)) setColdWaterDurationHours(Math.max(0, Math.round(((active.forcedColdWaterEndHour as number) - currentHour) * 2) / 2));
                      setActiveInfluenceCategory("cold_water");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      activeTy?.forcedColdWaterEndHour !== undefined && currentHour <= (activeTy.forcedColdWaterEndHour as number)
                        ? "border-2 border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.42)] bg-blue-950/30 text-blue-200"
                        : "bg-blue-950/20 border-blue-900/40 hover:bg-blue-900/40 text-blue-200"
                    }`}
                  >
                    <span>🌊 冷水区 {activeTy?.forcedColdWaterEndHour !== undefined && currentHour <= (activeTy.forcedColdWaterEndHour as number) ? <span className="text-xs text-blue-300 font-bold ml-1.5">[影响中]</span> : null}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length === 0) {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                        return;
                      }
                      setActiveInfluenceCategory("rapid");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-between border transition-all ${
                      hasRI
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : isRISuppressed
                        ? "bg-amber-950/15 border-amber-900/30 text-amber-300"
                        : "bg-red-950/20 border-red-900/30 hover:bg-red-900/50 text-red-300"
                    }`}
                  >
                    <span>🔥 爆发增强 (RI / ERI / URI) {hasRI && <span className="text-xs text-emerald-400 font-bold ml-1">[{activeRIMode.toUpperCase()} 演变中]</span>} {isRISuppressed && !hasRI && <span className="text-[10px] text-amber-400 font-normal ml-1">(当前环境不利)</span>}</span>
                    <span className="text-xs opacity-60">❯</span>
                  </button>

                  <button
                    onClick={() => {
                      handleCancelAllPenalties();
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    disabled={!activeTy || !activeTy.active || activeTy.dissipated}
                    className={`w-full py-3.5 px-4 rounded-xl font-semibold text-sm flex items-center justify-between border transition-all ${
                      activeTy?.penaltyRecoveryActive
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.38)] bg-cyan-950/30 text-cyan-200"
                        : "bg-cyan-950/20 border-cyan-900/50 hover:bg-cyan-900/35 text-cyan-300"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    title="清除人为干预/置换失败等惩罚；严重高山穿越造成的持久中心空洞不会被此按钮抹除，需用爆发增强重构"
                  >
                    <span>🛡️ 取消所有惩罚</span>
                    <span className="text-xs opacity-60">↻</span>
                  </button>

                  {/* Forecast framework, forecast peak reference and drawn environment tools live in the phone/desktop More menu. */}

                  {/* Target Intensity Control Slider */}
                  <div className={`p-3.5 rounded-xl border space-y-2 mt-1 ${
                    "bg-slate-800/40 border-slate-700/50"
                  }`}>
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 text-blue-400">
                        <span>{config.autoAdjustIntensity ? "🎯 目标巅峰强度" : "🎯 目标强度"}</span>
                      </span>
                      <label className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-slate-400 cursor-pointer select-none" title="勾选后，滑块只设定全程期望巅峰；实际每小时目标由海温、海洋热含量、风切、水汽、结构和眼墙置换阶段动态计算，不保证达到。">
                        <input
                          type="checkbox"
                          checked={!!config.autoAdjustIntensity}
                          onChange={(e) => applyConfigPatch({ maxIntensityLimitEnabled: true, autoAdjustIntensity: e.target.checked })}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                        自动调整强度
                      </label>
                      <button
                        type="button"
                        className="font-mono text-blue-400 font-bold hover:text-blue-300 underline decoration-dotted underline-offset-2"
                        title={config.autoAdjustIntensity ? "点击手动输入目标巅峰强度（实际强度由环境动态调整）" : "点击手动输入目标强度（可高于滑块上限）"}
                        onClick={() => setAppInputDialog({
                          kind: "targetIntensity",
                          title: config.autoAdjustIntensity ? "手动输入目标巅峰强度" : "手动输入目标强度",
                          initialValue: String(config.maxIntensityLimit || 70)
                        })}
                      >{config.maxIntensityLimit || 70} m/s</button>
                    </div>
                    <input
                      aria-label="目标风速"
                      type="range"
                      min={5}
                      max={150}
                      step={1}
                      value={Math.min(150, Math.max(5, config.maxIntensityLimit || 70))}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        applyConfigPatch({ maxIntensityLimitEnabled: true, maxIntensityLimit: val });
                      }}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none accent-blue-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>5 m/s</span>
                      <span>150 m/s</span>
                    </div>
                    {(config.maxIntensityLimit || 0) >= 115 && (
                      <div className="rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-[9px] font-bold text-fuchsia-300">🎡 游乐场模式已启动：海上默认自动 ERI · 增强 ×8 · 海温 +5℃ · 禁用背景风切/EWRC · 手动干空气/风切可中断 · 登陆正常减弱 · 风圈/强度无上限</div>
                    )}
                    <p className="text-[9px] leading-snug text-slate-500">{config.autoAdjustIntensity ? "自动调整开启：该数值是全程目标巅峰而不是当前硬上限。环境、内核结构、RI/EWRC阶段会连续决定实际目标；第一次成功置换后的再增强通常获得最大巅峰机会，后续置换默认趋于持平或略弱，但环境显著改善时仍可例外。" : "自动调整关闭：该数值继续作为当前目标强度上限，按原有平滑方式逼近。"} 达到 115 m/s 仍进入游乐场模式。</p>
                  </div>

                  {/* Soft circulation-size reference: not a hard radius constraint. */}
                  <div className={`p-3.5 rounded-xl border space-y-2 mt-1 ${
                    "bg-slate-800/40 border-slate-700/50"
                  }`}>
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                      <span className="text-slate-300">🌀 台风环流大小参考</span>
                      <label className="flex items-center gap-1 font-mono font-bold text-slate-100" title="可点击数值手动输入；最低 0 km，不设最高限制">
                        <input
                          key={`circulation-size-${Math.round(config.circulationSizeReferenceKm ?? 320)}`}
                          type="number"
                          min={0}
                          step={5}
                          defaultValue={Math.round(config.circulationSizeReferenceKm ?? 320)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          onBlur={(e) => {
                            const raw = Number(e.currentTarget.value);
                            const val = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : Math.round(config.circulationSizeReferenceKm ?? 320);
                            e.currentTarget.value = String(val);
                            applyCirculationSizeTarget(val);
                          }}
                          className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right font-mono font-bold text-slate-100 outline-none focus:border-cyan-500"
                        />
                        <span>km</span>
                      </label>
                    </div>
                    <input
                      aria-label="目标风圈"
                      type="range"
                      min={0}
                      max={Math.max(500, Math.ceil((config.circulationSizeReferenceKm ?? 320) / 100) * 100)}
                      step={5}
                      value={Math.max(0, config.circulationSizeReferenceKm ?? 320)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        applyCirculationSizeTarget(val);
                      }}
                      className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none accent-slate-300 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>最小 0 km</span><span>62 m/s · 7级风圈参考</span><span>数值输入无上限</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-950/45 px-2.5 py-2">
                      <div><div className="text-[10px] font-bold text-slate-300">风圈变化生效时间</div><div className="text-[8px] text-slate-500">从当前模拟时刻平滑变化到新参考值</div></div>
                      <select value={Number(config.circulationSizeTransitionHours ?? 0)} onChange={(e)=>applyCirculationTransitionDuration(Number(e.target.value))} className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-200">
                        <option value={0}>立即</option><option value={3}>3 小时</option><option value={6}>6 小时</option><option value={12}>12 小时</option><option value={24}>24 小时</option><option value={36}>36 小时</option><option value={48}>48 小时</option><option value={72}>72 小时</option>
                      </select>
                    </div>
                    <p className="text-[9px] leading-snug text-slate-500">
                      这是62 m/s台风的七级风圈平均半径“软参考”，不是硬性锁定。最低可设为 0 km，数值输入不设最高限制；滑块会随当前大值自动扩展。实际风圈仍会随移速、纬度、风切、海气供能、置换、核心损伤、登陆与环流膨胀变化；紧凑型更利于峰值风集中，宽广型更倾向大雨带、慢收紧和更大的外围风场。
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm transition-all border border-transparent text-red-500 hover:bg-red-500/10 text-center cursor-pointer"
                  >
                    关闭
                  </button>
                </div>
                );
              })()}

              {/* EWRC Sub Menu */}
              {activeInfluenceCategory === "ewrc" && (() => {
                const activeTy = typhoons[0];
                const isCycleRunning = activeTy && (activeTy.ewrcState === "forming" || activeTy.ewrcState === "max_decay");
                const isAutoActive = activeTy && !activeTy.manualEwrcOutcomeOverride && (activeTy.forcedEWRC === "auto" || !!isCycleRunning);
                const isSuccessActive = activeTy && (activeTy.manualEwrcOutcomeOverride === "success" || activeTy.forcedEWRC === "success" || activeTy.ewrcState === "recovering_success");
                const isFailureActive = activeTy && (activeTy.manualEwrcOutcomeOverride === "failure" || activeTy.forcedEWRC === "failure" || activeTy.ewrcState === "penalty_failure" || activeTy.ewrcState === "recovering_failure");
                const hasManualOutcomeLock = !!activeTy?.manualEwrcOutcomeOverride;

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "auto");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isAutoActive
                        ? "border-2 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)] bg-cyan-950/30 text-cyan-200"
                        : "bg-cyan-950/20 border-cyan-800/30 hover:bg-cyan-900/30 text-cyan-200"
                    }`}
                  >
                    🌀 正常开始置换 (Auto EWRC) {isAutoActive && <span className="text-xs text-cyan-300 font-bold ml-1.5">[程序判定中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "success");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isSuccessActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-emerald-950/20 border-emerald-800/30 hover:bg-emerald-900/30 text-emerald-300"
                    }`}
                  >
                    🚀 置换成功 (Success EWRC) {isSuccessActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[{hasManualOutcomeLock && activeTy?.manualEwrcOutcomeOverride === "success" ? "人工锁定" : "置换演变中"} - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("ewrc", "failure");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isFailureActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    💥 置换失败 (Failure EWRC) {isFailureActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[{hasManualOutcomeLock && activeTy?.manualEwrcOutcomeOverride === "failure" ? "人工锁定" : "影响演变中"} - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Dry Air Sub Menu */}
              {activeInfluenceCategory === "dry_air" && (() => {
                const activeTy = typhoons[0];
                const isCoreActive = activeTy && activeTy.forcedDryAir === "core";
                const isPeripheryActive = activeTy && activeTy.forcedDryAir === "periphery";

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("dry_air", "core");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isCoreActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    💀 卷入核心 (Severe Core Damage) {isCoreActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("dry_air", "periphery");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      isPeripheryActive
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    🍂 卷入外围 (Peripheral Erosion) {isPeripheryActive && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Shear Sub Menu */}
              {activeInfluenceCategory === "shear" && (() => {
                const activeTy = typhoons[0];
                const is35Active = activeTy && activeTy.forcedShear === 35;
                const is22Active = activeTy && activeTy.forcedShear === 22;

                return (
                <div className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("shear", "35.0");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      is35Active
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    ⚡ 35节极强风切变 (35kt Extreme) {is35Active && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      if (typhoons.length > 0) {
                        handleApplyInfluence("shear", "22.0");
                      } else {
                        showToast("当前没有活跃台风，无法施加影响", "warning");
                      }
                      setIsInfluenceModalOpen(false);
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all cursor-pointer ${
                      is22Active
                        ? "border-2 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] bg-emerald-950/30 text-emerald-300"
                        : "bg-amber-950/20 border-amber-800/30 hover:bg-amber-900/30 text-amber-300"
                    }`}
                  >
                    ⚡ 22节中强风切变 (22kt Moderate) {is22Active && <span className="text-xs text-emerald-400 font-bold ml-1.5">[影响演变中 - 点击停止]</span>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}

              {/* Cold Water Sub Menu */}
              {activeInfluenceCategory === "cold_water" && (() => {
                const activeTy = typhoons[0];
                const activeUntil = activeTy?.forcedColdWaterEndHour;
                const isActive = Number.isFinite(activeUntil) && currentHour <= (activeUntil as number) + 1e-6;
                const remaining = isActive ? Math.max(0, (activeUntil as number) - currentHour) : 0;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="px-3 py-2 rounded-lg text-[10px] leading-relaxed border bg-blue-950/20 border-blue-800/40 text-blue-200/80">
                      将当前台风置于指定海温的冷水区中。持续时间使用模拟时；期间中心海温按设定值进入强度、OHC、对流和冷水压制计算，结束后由既有冷水记忆机制平滑恢复。
                    </div>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">持续时间（模拟时）</span><b className="text-blue-300">{coldWaterDurationHours.toFixed(1)} h</b></div>
                      <input type="range" min={0} max={120} step={0.5} value={coldWaterDurationHours} onChange={e => setColdWaterDurationHours(Number(e.target.value))} className="w-full" />
                      {isActive && <div className="mt-2 text-[10px] text-blue-300">当前事件剩余约 {remaining.toFixed(1)}h</div>}
                    </label>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">冷水区温度</span><b className="text-blue-300">{coldWaterTemperatureC.toFixed(1)}℃</b></div>
                      <input type="range" min={0} max={30} step={0.5} value={coldWaterTemperatureC} onChange={e => setColdWaterTemperatureC(Number(e.target.value))} className="w-full" />
                      <div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>0℃</span><span>26℃以下显著抑制</span><span>30℃</span></div>
                    </label>
                    <button onClick={() => { handleScheduleColdWater(coldWaterTemperatureC, coldWaterDurationHours); setIsInfluenceModalOpen(false); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }} className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm border border-blue-600/60 bg-blue-950/30 hover:bg-blue-900/40 text-blue-200">
                      🌊 {isActive ? "更新冷水区" : "启动冷水区"}
                    </button>
                    {isActive && <button onClick={() => { handleCancelColdWater(); setIsInfluenceModalOpen(false); }} className="w-full py-3 px-4 rounded-xl font-medium text-sm border border-red-900/40 bg-red-950/20 text-red-300">取消冷水区</button>}
                    <button onClick={() => setActiveInfluenceCategory("main")} className="w-full py-3 px-4 rounded-xl font-medium text-sm border bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300">返回上一级</button>
                  </div>
                );
              })()}

              {/* Cold Air Sub Menu */}
              {activeInfluenceCategory === "cold_air" && (() => {
                const activeTy = typhoons[0];
                const existing = activeTy?.forcedColdAirStrength;
                const arrival = activeTy?.forcedColdAirArrivalHour;
                const remaining = Number.isFinite(arrival) ? Math.max(0, (arrival as number) - currentHour) : null;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="px-3 py-2 rounded-lg text-[10px] leading-relaxed border bg-sky-950/20 border-sky-800/40 text-sky-200/80">
                      冷空气由渤海和西日本海两支同时南下（西日本海支明显较弱），在东海交汇后绕台湾分流：西南侧经台湾海峡、巴士海峡进入南海，东南侧进入菲律宾以东海域并更快减弱消散。主输送路径位于海上，不再从华东、华南陆地直接南压。到达时间仍按模拟时绝对时刻锁定，并与台风强度响应同步。
                    </div>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">强度</span><b className="text-cyan-300">{coldAirStrength} 档 · {coldAirStrength === 1 ? "弱" : coldAirStrength === 2 ? "中" : "强"}</b></div>
                      <input type="range" min={1} max={3} step={1} value={coldAirStrength} onChange={e => setColdAirStrength(Number(e.target.value) as 1 | 2 | 3)} className="w-full" />
                      <div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>1 · 约24kt海面</span><span>2 · 约28kt</span><span>3 · 约32kt</span></div>
                    </label>
                    <label className="block rounded-xl border border-slate-700 bg-slate-900/45 p-3">
                      <div className="flex justify-between text-xs mb-2"><span className="text-slate-200">延迟到达时间（模拟时）</span><b className="text-cyan-300">{coldAirDelayHours} h</b></div>
                      <input type="range" min={0} max={72} step={1} value={coldAirDelayHours} onChange={e => setColdAirDelayHours(Number(e.target.value))} className="w-full" />
                      {existing && remaining !== null && <div className="mt-2 text-[10px] text-cyan-300">当前事件：{existing}档，距强风前锋抵达台风中心约 {remaining.toFixed(1)}h</div>}
                    </label>
                    <button onClick={() => { handleScheduleColdAir(coldAirStrength, coldAirDelayHours); setIsInfluenceModalOpen(false); playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse"); }} className="w-full py-3.5 px-4 rounded-xl font-semibold text-sm border border-cyan-600/60 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-200">
                      ❄️ {existing ? "更新冷空气事件" : "启动冷空气南下"}
                    </button>
                    {existing && <button onClick={() => { handleCancelColdAir(); setIsInfluenceModalOpen(false); }} className="w-full py-3 px-4 rounded-xl font-medium text-sm border border-red-900/40 bg-red-950/20 text-red-300">取消冷空气事件</button>}
                    <button onClick={() => setActiveInfluenceCategory("main")} className="w-full py-3 px-4 rounded-xl font-medium text-sm border bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300">返回上一级</button>
                  </div>
                );
              })()}

              {/* Rapid Intensification Sub Menu */}
              {activeInfluenceCategory === "rapid" && (() => {
                const activeTy = typhoons[0];
                const currentMode = activeTy ? (activeTy.forcedRapidIntensificationMode || activeTy.rapidIntensificationMode || "ri") : "ri";
                const active = !!activeTy && !!(activeTy.forcedRapidIntensification || activeTy.rapidIntensifying);
                const extratropicalBurstBlocked = !!activeTy && !!activeTy.coldAirWarmCoreDestroyed;
                const suppressed = !!activeTy && (extratropicalBurstBlocked || !!activeTy.forcedDryAir || (activeTy.forcedShear !== undefined && activeTy.forcedShear > 15.0) || activeTy.ewrcState === "penalty_failure" || !!activeTy.ewrcIsFailure);

                const chooseMode = (mode: "ri" | "eri" | "uri") => {
                  if (!activeTy) {
                    showToast("当前没有活跃台风，无法施加影响", "warning");
                    return;
                  }
                  const sameActive = active && currentMode === mode;
                  if (suppressed && !sameActive) {
                    showToast(extratropicalBurstBlocked ? "强冷空气已彻底摧毁暖心，该残留低压路径禁止任何爆发增强。" : "当前处于干空气/强风切/置换失败压制状态，无法新开启爆发增强。", "warning");
                    return;
                  }
                  handleApplyInfluence("rapid_intensify", mode);
                  setIsInfluenceModalOpen(false);
                  playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                };

                return (
                <div className="flex flex-col gap-2.5">
                  <div className={`px-3 py-2 rounded-lg text-[10px] leading-relaxed border ${
                    "bg-slate-900/50 border-slate-700/50 text-slate-400"
                  }`}>
                    RI：典型约 15–22 m/s / 24h；ERI：典型约 24–30 m/s / 24h。URI 超高速爆发为 2.28–2.37 m/s/h、持续25h。正常北上进入副热带/温带阶段后，手动爆发会转化为斜压能量驱动的受动爆发，不再按热带暖心 RI 处理；若 32 kt 强冷空气已彻底摧毁暖心，则系统直接成为残留低压云团，不进入副热带/温带气旋阶段，并永久禁止任何增强。
                  </div>

                  <button
                    onClick={() => chooseMode("ri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "ri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-orange-950/20 border-orange-800/30 hover:bg-orange-900/30 text-orange-300"
                    }`}
                  >
                    ⚡ RI 快速增强
                    <div className="text-[10px] font-normal opacity-70 mt-1">≥30 kt / 24h 级别；常见 6h 平均增幅约 8–12 kt。</div>
                    {active && currentMode === "ri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => chooseMode("eri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "eri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-red-950/20 border-red-800/30 hover:bg-red-900/30 text-red-300"
                    }`}
                  >
                    🔥 ERI 极端快速增强
                    <div className="text-[10px] font-normal opacity-70 mt-1">典型约 50–70 kt / 24h 级别，极少数可进入纪录级尾部。</div>
                    {active && currentMode === "eri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => chooseMode("uri")}
                    className={`w-full py-3.5 px-4 rounded-xl font-medium text-sm text-left border transition-all ${
                      active && currentMode === "uri"
                        ? "border-2 border-emerald-500 bg-emerald-950/30 text-emerald-300"
                        : suppressed
                        ? "opacity-55 bg-slate-800/30 border-slate-700/40 text-slate-400"
                        : "bg-fuchsia-950/20 border-fuchsia-800/30 hover:bg-fuchsia-900/30 text-fuchsia-300"
                    }`}
                  >
                    🚀 URI 超高速爆发
                    <div className="text-[10px] font-normal opacity-70 mt-1">2.28–2.37 m/s/h 动态增强 · 25h · 前2h渐入 · 结束后2h渐退。</div>
                    {active && currentMode === "uri" && <div className="text-[10px] text-emerald-400 mt-1">当前运行中 · 再次点击将平滑结束</div>}
                  </button>

                  <button
                    onClick={() => {
                      setActiveInfluenceCategory("main");
                      playSndClick(config.soundVolume, config.soundEnabled, config.soundMode || "mouse");
                    }}
                    className={`w-full py-3 px-4 rounded-xl font-medium text-sm border transition-all text-center cursor-pointer ${
                      "bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300"
                    }`}
                  >
                    返回上一级
                  </button>
                </div>
                );
              })()}
            </div>
          </div>
    {inputDialog&&<div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={inputDialog.title}>
      <form onSubmit={e=>{e.preventDefault();const field=e.currentTarget.elements.namedItem('intensity') as HTMLInputElement;const value=Number(field?.value);if(Number.isFinite(value)&&value>=5){applyConfigPatch({maxIntensityLimitEnabled:true,maxIntensityLimit:value});setInputDialog(null);}else showToast('请输入至少 5 m/s 的有效目标强度','warning');}}
        className="rounded-xl border border-slate-600 bg-[#08121f] p-4 shadow-2xl w-[min(390px,94vw)]">
        <h3 className="font-bold text-sm mb-2">{inputDialog.title}</h3>
        <input autoFocus name="intensity" type="number" min={5} step={0.1} defaultValue={inputDialog.initialValue} className="w-full bg-slate-900 rounded-lg border border-slate-700 p-2 text-white" />
        <div className="flex justify-end gap-2 mt-3"><button type="button" onClick={()=>setInputDialog(null)} className="px-3 py-2 bg-slate-800 rounded-lg">取消</button><button type="submit" className="px-3 py-2 bg-sky-700 rounded-lg">应用</button></div>
      </form>
    </div>}
  </>;
}
