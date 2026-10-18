import {createPortal} from 'react-dom';
import {useEffect} from 'react';
import type {ParameterOffset} from '../simulation/RealisticParameterGeometry';
interface Props {open:boolean;busy:boolean;strength:ParameterOffset;progress:number;mode?:'apply'|'undo';onStrength:(s:ParameterOffset)=>void;onCancel:()=>void;onConfirm:()=>void}
export default function RealisticParameterDialog({open,busy,strength,progress,onStrength,onCancel,onConfirm,mode='apply'}:Props){
 useEffect(()=>{if(!open)return;const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onCancel();};window.addEventListener('keydown',handle);return()=>window.removeEventListener('keydown',handle);},[open,busy,onCancel]);
 if(!open)return null;
 return createPortal(<div role="dialog" aria-modal="true" aria-label="真实化参数" className="fixed inset-0 z-[9200] flex items-center justify-center bg-black/75 p-4">
  <div className="w-[min(430px,95vw)] rounded-2xl border border-slate-600 bg-[#101b2a] p-5 text-slate-100 shadow-2xl">
   <h2 className="text-lg font-bold text-sky-200">{mode==='undo'?'撤销真实化参数':'真实化参数'}</h2>
   <p className="mt-3 text-sm leading-relaxed text-slate-300">{mode==='undo'?'恢复应用前保存的路径、气压、风速、移速与其他参数；风圈保持原始数值，重新计算气象站数据。':'将历史风速、气压、移速、移向等参数改成每 3 小时一个折线节点。7/10/12 级风圈四象限半径和最大风速半径（RMW）保持原值，不进行插值或随机修改。路径每 3 小时仅作小幅偏移；保留逐小时历史，不改变未来模拟的移动算法。'}</p>
   {mode==='apply'&&<fieldset disabled={busy} className="mt-4 flex gap-2"><legend className="mb-2 text-sm text-slate-300">路径节点偏移幅度（参数始终为 3 小时节点）</legend>
    {([['low','轻微'],['mid','标准'],['high','较明显']] as const).map(([id,label])=><button key={id} type="button" aria-pressed={strength===id} onClick={()=>onStrength(id)} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${strength===id?'border-sky-400 bg-sky-700 text-white':'border-slate-600 bg-slate-800'}`}>{label}</button>)}
   </fieldset>}
   {busy&&<div className="mt-3" aria-live="polite"><p className="mb-1 text-xs">正在重算气象站数据 {progress}%</p><div className="h-2 rounded bg-slate-700"><div className="h-2 rounded bg-sky-400" style={{width:`${progress}%`}}/></div></div>}
   <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-600 px-5 py-2 text-sm">{busy?'取消计算':'取消'}</button><button type="button" disabled={busy} onClick={onConfirm} className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-bold disabled:opacity-50">{mode==='undo'?'确认撤销':'确认应用'}</button></div>
  </div>
 </div>,document.body);
}
