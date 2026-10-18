import React, { useEffect, useState, useRef } from 'react';
import { AppState } from '../types';
import { Download, RotateCcw, AlertCircle, CheckCircle2, Loader2, ChevronLeft } from 'lucide-react';

interface Props {
  state: AppState;
  onPrev: () => void;
  onReset: () => void;
}

export default function Step4Export({ state, onPrev, onReset }: Props) {
  const [status, setStatus] = useState<string>('正在初始化...');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let isMounted = true;

    const controllers = new Set<AbortController>();

    const runComposite = async () => {
      try {
        // Calculate base dimensions
        let baseW = state.resolution || 1080;
        let baseH = state.resolution || 1080;
        const [rw, rh] = (state.aspectRatio || '1:1').split(':').map(Number);

        if (rw > rh) {
          baseH = Math.round(baseW * (rh / rw));
        } else if (rh > rw) {
          baseW = Math.round(baseH * (rw / rh));
        }

        // Output at the exact requested resolution. Do not apply any multiplier, interpolation, or super-resolution computation.
        const w = baseW;
        const h = baseH;

        // Calculate BBOXes
        const deltaLon = isNaN(state.deltaLon) || state.deltaLon <= 0 ? 10 : state.deltaLon;
        const deltaLat = isNaN(state.deltaLat) || state.deltaLat <= 0 ? 10 : state.deltaLat;

        const dLon = deltaLon / 2;
        const dLat = deltaLat / 2;

        const targetLat = isNaN(state.targetLat) ? 31.2304 : state.targetLat;
        const targetLon = isNaN(state.targetLon) ? 121.4737 : state.targetLon;
        const typhoonLat = isNaN(state.typhoonLat) ? 20.0 : state.typhoonLat;
        const typhoonLon = isNaN(state.typhoonLon) ? 130.0 : state.typhoonLon;

        const formatBbox = (lon: number, lat: number) => {
          return `${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)}`;
        };

        const targetBbox = formatBbox(targetLon, targetLat);
        const typhoonBbox = formatBbox(typhoonLon, typhoonLat);

        const buildWmsUrl = (layer: string, bbox: string, time?: string, format = 'image/jpeg') => {
          let url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=${format}&TRANSPARENT=${format === 'image/png' ? 'true' : 'false'}&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=${w}&HEIGHT=${h}`;
          if (time) url += `&TIME=${time}`;
          return url;
        };

        const baseLayer = 'BlueMarble_NextGeneration';
        const dayNight = state.isNight ? 'Night' : 'Day';
        const sat = state.satellite === 'NOAA20' ? 'NOAA20' : 'SNPP';
        const cloudLayer = state.cloudLayerId || `VIIRS_CrIS_${sat}_BT_Band33_Fusion_${dayNight}`;

        const urls = {
          base: buildWmsUrl(baseLayer, targetBbox, '2004-08-01'),
          cloud: buildWmsUrl(cloudLayer, typhoonBbox, state.layerTime, 'image/png'),
          coastlines: buildWmsUrl('Coastlines', targetBbox, undefined, 'image/png'),
        };

        const fetchImageWithRetry = async (
          url: string,
          label: string,
          maxRetries = 3,
          timeoutMs = 12000
        ): Promise<HTMLImageElement> => {
          let lastError: any = null;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (!isMounted) throw new Error("组件已被卸载");

            if (attempt > 1) {
              if (isMounted) setStatus(`正在重试获取 ${label} 数据 (第 ${attempt}/${maxRetries} 次尝试)...`);
              await new Promise(r => setTimeout(r, 800 * attempt));
            }

            const controller = new AbortController();
            controllers.add(controller);
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
              const requestUrl = attempt > 1 ? `${url}&_retry=${Date.now()}` : url;
              const res = await fetch(requestUrl, {
                signal: controller.signal,
                mode: 'cors',
              });
              clearTimeout(timer);
              controllers.delete(controller);

              if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
              }

              const blob = await res.blob();
              const objectUrl = URL.createObjectURL(blob);

              return await new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  URL.revokeObjectURL(objectUrl);
                  resolve(img);
                };
                img.onerror = () => {
                  URL.revokeObjectURL(objectUrl);
                  reject(new Error(`解析 ${label} 图像解码失败`));
                };
                img.src = objectUrl;
              });
            } catch (err: any) {
              clearTimeout(timer);
              controllers.delete(controller);
              console.warn(`[Step4Export] Attempt ${attempt} failed for ${label}:`, err);
              lastError = err;
            }
          }

          throw new Error(`加载 NASA GIBS ${label} 数据失败 (已重试 ${maxRetries} 次): ${lastError?.message || '网络超时无响应'}`);
        };

        if (isMounted) setStatus('正在并行下载底图、卫星云图与海岸线数据...');

        let completedCount = 0;
        const totalCount = state.addCoastlines ? 3 : 2;

        const trackProgress = (promise: Promise<HTMLImageElement>, label: string) => {
          return promise.then((img) => {
            completedCount++;
            if (isMounted) setStatus(`已成功接收 ${label} (${completedCount}/${totalCount})...`);
            return img;
          });
        };

        const basePromise = trackProgress(fetchImageWithRetry(urls.base, '基础底图'), '基础底图');
        const cloudPromise = trackProgress(fetchImageWithRetry(urls.cloud, '卫星云图'), '卫星云图');
        const coastPromise = state.addCoastlines
          ? trackProgress(fetchImageWithRetry(urls.coastlines, '海岸线'), '海岸线')
          : Promise.resolve(null);

        const [baseImg, cloudImg, coastImg] = await Promise.all([
          basePromise,
          cloudPromise,
          coastPromise,
        ]);

        if (!isMounted) return;
        setStatus('正在合成图像图层...');

        // Process band33 cloud image to eliminate grey scan wash by shifting the black point.
        // We do this by copying cloudImg to an offscreen canvas and remapping the pixels.
        const cloudCanvas = document.createElement('canvas');
        cloudCanvas.width = w;
        cloudCanvas.height = h;
        const cloudCtx = cloudCanvas.getContext('2d');
        if (!cloudCtx) throw new Error("无法创建临时画布进行色阶调整");

        cloudCtx.imageSmoothingEnabled = false;
        cloudCtx.drawImage(cloudImg, 0, 0, w, h);

        const cloudImgData = cloudCtx.getImageData(0, 0, w, h);
        const cloudPixels = cloudImgData.data;
        const blackPoint = 45; // Clamps lower gray levels to black (removes grey background wash)
        const factor = 255 / (255 - blackPoint);

        let hasPixel = false;
        for (let i = 0; i < cloudPixels.length; i += 4) {
          if (cloudPixels[i + 3] > 0) {
            const r = Math.min(255, Math.max(0, (cloudPixels[i] - blackPoint) * factor));
            const g = Math.min(255, Math.max(0, (cloudPixels[i + 1] - blackPoint) * factor));
            const b = Math.min(255, Math.max(0, (cloudPixels[i + 2] - blackPoint) * factor));

            cloudPixels[i] = r;
            cloudPixels[i + 1] = g;
            cloudPixels[i + 2] = b;

            if (r > 0 || g > 0 || b > 0) {
              hasPixel = true;
            }
          }
        }
        cloudCtx.putImageData(cloudImgData, 0, 0);

        const isTransparent = !hasPixel;

        if (isTransparent) {
          throw new Error('所选位置和日期的卫星云图数据为空。请返回步骤 2 重新选择日期或切换卫星（NOAA-20 / Suomi NPP）。');
        }

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("找不到画布元素");

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("无法初始化 Canvas 2D 上下文");

        // Disable bilinear interpolation smoothing to preserve crisp, sharp pixelated details of satellite/vector data
        ctx.imageSmoothingEnabled = false;
        (ctx as any).mozImageSmoothingEnabled = false;
        (ctx as any).webkitImageSmoothingEnabled = false;
        (ctx as any).msImageSmoothingEnabled = false;

        // Render layers
        // Re-enforce disabled image smoothing for the final composite draws
        ctx.imageSmoothingEnabled = false;
        (ctx as any).mozImageSmoothingEnabled = false;
        (ctx as any).webkitImageSmoothingEnabled = false;
        (ctx as any).msImageSmoothingEnabled = false;

        // 1. Blue Marble Base Map
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(baseImg, 0, 0, w, h);

        // 2. Typhoon Infrared Cloud Layer (Screen blend using black-level adjusted canvas)
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(cloudCanvas, 0, 0, w, h);

        // 3. Coastlines (Black lines, slightly thicker, opacity 0.75)
        if (coastImg) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.filter = 'brightness(0)';
          ctx.globalAlpha = 0.75;
          ctx.drawImage(coastImg, 0, 0, w, h);
          ctx.drawImage(coastImg, 0.5, 0.5, w, h);
          ctx.drawImage(coastImg, -0.5, -0.5, w, h);
          ctx.filter = 'none';
          ctx.globalAlpha = 1.0;
        }

        const dataUrl = canvas.toDataURL('image/png');
        if (isMounted) {
          setResultUrl(dataUrl);
          setStatus('完成');
        }

      } catch (err: any) {
        if (isMounted) {
          setError(err.message || '合成图像时出错');
        }
      }
    };

    runComposite();

    return () => {
      isMounted = false;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [state]);

  const handleDownload = () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = `WMC_GIBS_Composite_${state.layerTime}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex-1 p-6 overflow-y-auto flex flex-col items-center justify-center">
        <canvas ref={canvasRef} className="hidden" />

        {error ? (
          <div className="bg-red-50 p-6 rounded-3xl flex flex-col items-center text-center w-full max-w-sm border border-red-100 shadow-sm">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <h2 className="text-lg font-bold text-slate-800 mb-2">生成提示</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-4">{error}</p>
            <button
              onClick={onPrev}
              className="bg-red-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm hover:bg-red-700 transition-colors shadow-md shadow-red-200"
            >
              返回步骤 2
            </button>
          </div>
        ) : !resultUrl ? (
          <div className="flex flex-col items-center justify-center p-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-6" />
            <div className="bg-white px-6 py-3 rounded-full shadow-sm border border-slate-100 font-medium text-slate-600 animate-pulse text-sm">
              {status}
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center">
            <div className="flex items-center gap-2 mb-6 bg-green-50 text-green-700 px-4 py-2 rounded-full font-medium text-sm border border-green-100">
              <CheckCircle2 className="w-5 h-5" />
              图像合成完成
            </div>

            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-slate-300/50 mb-8 w-full max-w-sm border border-slate-200">
              <img src={resultUrl} alt="Composite result" className="w-full h-auto block" style={{ imageRendering: 'pixelated' }} />
            </div>

            <button
              onClick={handleDownload}
              className="w-full max-w-sm flex items-center justify-center gap-3 py-4 rounded-2xl font-bold bg-slate-800 text-white hover:bg-slate-900 transition-colors shadow-xl shadow-slate-200"
            >
              <Download className="w-5 h-5" />
              保存图片
            </button>
          </div>
        )}
      </div>

      <div className="bg-white p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-10">
        <div className="flex gap-4">
          <button
            onClick={onPrev}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" /> 调整参数
          </button>
          <button
            onClick={onReset}
            className="flex-[2] flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
          >
            <RotateCcw className="w-5 h-5" /> 重新开始
          </button>
        </div>
      </div>
    </div>
  );
}
