import {useState} from 'react';
import type {SimulationConfig} from '../types';
import './NetworkEntrySettings.css';

export type NetworkChartSettings={
  precalculate:boolean;
  nmcWidth:number;
  forecastHours:72|96|120;
  strikeHorizon:72|120|168;
  strikeRadiusKm:number;
  strikeCellDeg:number;
  strikeSmoothPasses:number;
  membersPerModel:number;
  meanDotHours:number;
};
export const DEFAULT_NETWORK_CHART_SETTINGS:NetworkChartSettings={
  precalculate:false,nmcWidth:930,forecastHours:120,strikeHorizon:120,
  strikeRadiusKm:120,strikeCellDeg:0.4,strikeSmoothPasses:1,
  membersPerModel:12,meanDotHours:12
};
export default function NetworkEntrySettings({config,onCancel,onConfirm}:{
  config:SimulationConfig;onCancel:()=>void;onConfirm:(config:SimulationConfig,settings:NetworkChartSettings)=>void;
}){
  const [peak,setPeak]=useState(Math.max(5,Math.min(110,config.forecastPeakIntensityReference??70)));
  const [settings,setSettings]=useState<NetworkChartSettings>(DEFAULT_NETWORK_CHART_SETTINGS);
  const [drawer,setDrawer]=useState(false);
  const set=<K extends keyof NetworkChartSettings>(key:K,value:NetworkChartSettings[K])=>setSettings(prev=>({...prev,[key]:value}));
  return <div className="tn-entry-overlay" role="dialog" aria-modal="true" aria-label="台风网模拟入场调整">
    <section className="tn-entry-card">
      <div className="tn-entry-head"><button type="button" onClick={onCancel} aria-label="取消进入">←</button><strong>模拟台风网 · 预报调整</strong></div>
      <div className="tn-entry-body">
        <p className="tn-entry-muted">本次入场生成专用预报，不改变主模拟物理历史与原始参数。</p>
        <div className="tn-entry-peak"><span>巅峰目标预报强度</span><b>{Math.round(peak)} m/s</b></div>
        <input aria-label="巅峰目标预报强度" type="range" min="5" max="110" step="1" value={peak} onChange={event=>setPeak(Number(event.target.value))}/>
        <div className="tn-entry-scale"><span>5 m/s</span><span>110 m/s</span></div>
        <p className="tn-entry-muted">与 NMC 预报参数中的“预报最大强度”共用物理引导机制：非强制上限，依赖环境条件调整未来强度。中国、NMC 和其他模拟机构基于该参考生成不同的预报。</p>
        <button type="button" className="tn-entry-drawer-toggle" onClick={()=>setDrawer(v=>!v)} aria-expanded={drawer} aria-controls="tn-entry-drawer">☰　气象图生成参数 <span>{drawer?'收起 ▲':'展开 ▼'}</span></button>
        {drawer&&<div id="tn-entry-drawer" className="tn-entry-drawer">
          <label className="tn-entry-check"><input type="checkbox" checked={settings.precalculate} onChange={e=>set('precalculate',e.target.checked)}/> 进入台风网时提前计算集合预报图片</label>
          <small>关闭后只在首次打开“热带气旋概率”时生成；开启会增加入场等待时间。</small>
          <h4>NMC 路径预报图</h4>
          <label>预报时效<select value={settings.forecastHours} onChange={e=>set('forecastHours',Number(e.target.value) as 72|96|120)}><option value="72">72 小时</option><option value="96">96 小时</option><option value="120">120 小时</option></select></label>
          <label>输出宽度<select value={settings.nmcWidth} onChange={e=>set('nmcWidth',Number(e.target.value))}><option value="800">800 px</option><option value="930">930 px</option><option value="1200">1200 px</option></select></label>
          <h4>袭击概率图</h4>
          <label>集合预报时效<select value={settings.strikeHorizon} onChange={e=>set('strikeHorizon',Number(e.target.value) as 72|120|168)}><option value="72">72 小时</option><option value="120">120 小时</option><option value="168">168 小时</option></select></label>
          <label>袭击判定半径 <b>{settings.strikeRadiusKm} km</b><input type="range" min="60" max="240" step="20" value={settings.strikeRadiusKm} onChange={e=>set('strikeRadiusKm',Number(e.target.value))}/></label>
          <label>概率网格精度<select value={settings.strikeCellDeg} onChange={e=>set('strikeCellDeg',Number(e.target.value))}><option value="0.25">0.25°（较慢）</option><option value="0.4">0.4°</option><option value="0.6">0.6°（较快）</option></select></label>
          <label>概率平滑遍数<select value={settings.strikeSmoothPasses} onChange={e=>set('strikeSmoothPasses',Number(e.target.value))}><option value="0">0（原始网格）</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
          <h4>8 机构中心路径 / 集合成员</h4>
          <label>每机构成员数<select value={settings.membersPerModel} onChange={e=>set('membersPerModel',Number(e.target.value))}><option value="4">4（32 条）</option><option value="8">8（64 条）</option><option value="12">12（96 条）</option><option value="20">20（160 条）</option></select></label>
          <label>集合平均位置标注间隔<select value={settings.meanDotHours} onChange={e=>set('meanDotHours',Number(e.target.value))}><option value="6">6 小时</option><option value="12">12 小时</option><option value="24">24 小时</option></select></label>
        </div>}
      </div>
      <div className="tn-entry-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" className="tn-entry-confirm" onClick={()=>onConfirm({...config,forecastPeakIntensityEnabled:true,forecastPeakIntensityReference:peak},settings)}>确认并进入台风网 →</button></div>
    </section>
  </div>;
}
