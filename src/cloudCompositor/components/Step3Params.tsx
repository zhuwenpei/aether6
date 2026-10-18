import React from 'react';
import { AppState } from '../types';
import { ChevronRight, ChevronLeft, Settings, Image as ImageIcon, Map } from 'lucide-react';

interface Props {
  state: AppState;
  updateState: (s: Partial<AppState>) => void;
  onNext: () => void;
  onPrev: () => void;
}

export default function Step3Params({ state, updateState, onNext, onPrev }: Props) {
  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-center mb-8 mt-4">
          <div className="bg-blue-100 p-4 rounded-full text-blue-600">
            <Settings className="w-8 h-8" />
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">输出设置</h1>
        <p className="text-slate-500 text-center mb-10">配置最终的合成图像参数</p>

        <div className="space-y-8">
          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <ImageIcon className="w-5 h-5 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">分辨率（长边）</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {[
                { val: 720, label: '标准清晰度 (720px)' },
                { val: 1080, label: '高清 (1080px)' },
                { val: 2160, label: '超高清 (2160px)' }
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => updateState({ resolution: opt.val })}
                  className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                    state.resolution === opt.val 
                      ? 'border-blue-500 bg-blue-50 text-blue-700' 
                      : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200'
                  }`}
                >
                  <span className="font-semibold">{opt.label}</span>
                  {state.resolution === opt.val && (
                    <div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <Map className="w-5 h-5 text-slate-400" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">叠加图层</h2>
            </div>
            
            <label className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
              <div>
                <div className="font-semibold text-slate-700">添加海岸线</div>
                <div className="text-xs text-slate-500 mt-1">在画面上叠加全球海岸线矢量数据</div>
              </div>
              <div className="relative">
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={state.addCoastlines}
                  onChange={(e) => updateState({ addCoastlines: e.target.checked })}
                />
                <div className={`w-12 h-6 rounded-full transition-colors ${state.addCoastlines ? 'bg-blue-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${state.addCoastlines ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-10">
        <div className="flex gap-4">
          <button
            onClick={onPrev}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" /> 返回
          </button>
          <button
            onClick={onNext}
            className="flex-[2] flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
          >
            生成图像 <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

