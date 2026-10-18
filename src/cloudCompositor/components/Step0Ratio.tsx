import React from 'react';
import { AppState, AspectRatio } from '../types';
import { Square, RectangleHorizontal, RectangleVertical } from 'lucide-react';

interface Props {
  state: AppState;
  updateState: (s: Partial<AppState>) => void;
  onNext: () => void;
}

export default function Step0Ratio({ state, updateState, onNext }: Props) {
  const ratios: { id: AspectRatio; label: string; icon: React.ReactNode; w: string; h: string }[] = [
    { id: '1:1', label: '1:1 正方形', icon: <Square className="w-8 h-8" />, w: 'w-16', h: 'h-16' },
    { id: '4:3', label: '4:3 横屏', icon: <RectangleHorizontal className="w-8 h-8" />, w: 'w-16', h: 'h-12' },
    { id: '3:4', label: '3:4 竖屏', icon: <RectangleVertical className="w-8 h-8" />, w: 'w-12', h: 'h-16' },
    { id: '16:9', label: '16:9 宽屏', icon: <RectangleHorizontal className="w-8 h-8" />, w: 'w-16', h: 'h-9' },
    { id: '9:16', label: '9:16 竖屏', icon: <RectangleVertical className="w-8 h-8" />, w: 'w-9', h: 'h-16' },
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
        <div className="text-[10px] font-black tracking-[0.18em] text-cyan-300 uppercase">WMC · NASA GIBS COMPOSITOR</div>
        <h1 className="text-2xl font-bold text-slate-800 text-center">卫星实景拼接</h1>
        <p className="text-slate-500 text-center mb-3">选择合成图像的输出比例。该功能获取 NASA GIBS 实景卫星图层，再按目标位置进行搬移与图层拼接，不使用 WMC 程序生成云体。</p>
        <div className="w-full max-w-sm rounded-xl border border-amber-700/35 bg-amber-950/20 px-3 py-2 text-[10px] leading-relaxed text-amber-100/75">拼接后的云系位置是人工合成结果，不代表目标位置在该时刻的真实卫星观测。</div>

        <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
          {ratios.map((ratio) => (
            <button
              key={ratio.id}
              onClick={() => {
                updateState({ aspectRatio: ratio.id });
                onNext();
              }}
              className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all ${
                state.aspectRatio === ratio.id
                  ? 'border-blue-500 bg-blue-50 text-blue-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              } ${ratio.id === '1:1' ? 'col-span-2' : ''}`}
            >
              <div className="mb-3 flex items-center justify-center h-16">
                <div className={`border-2 border-current rounded-sm ${ratio.w} ${ratio.h}`} />
              </div>
              <span className="font-medium">{ratio.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

