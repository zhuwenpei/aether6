import { yieldSynopticUi } from "./SynopticCooperativeYield";
import * as Mp4Muxer from "mp4-muxer";
import type { SimulationConfig, Typhoon } from "../types";
import {
  createSynopticWindPressureRenderCache,
  drawSynopticWindPressureMap,
  type SynopticWindPressureMapOptions
} from "./SynopticWindPressureMap";
import { chooseAvcCodec, type SynopticVideoResolution } from "./SynopticWindPressureVideo";
import { synopticProductLayout, type SynopticProductAspect } from "./SynopticProductLayout";

export interface SynopticWindPressureRecordVideoOptions {
  typhoon: Typhoon;
  startDate: Date;
  config?: SimulationConfig;
  modelLabel?: string;
  stylePreset?: SynopticWindPressureMapOptions["stylePreset"];
  roundedClearEye?: boolean;
  /** Full lifecycle follow (legacy), or selected, geographically stationary interval. */
  videoMode?: "follow" | "fixed";
  aspectRatio?: SynopticProductAspect;
  startHour?: number;
  endHour?: number;
  quality?: "standard" | "high" | "ultra";
  domainMode?: SynopticWindPressureMapOptions["domainMode"];
  customBounds?: SynopticWindPressureMapOptions["customBounds"];
  contourIntervalHpa?: number;
  showContours?: boolean;
  gridResolutionDeg?: 0.1 | 0.125 | 0.25 | 0.5;
  mapZoom?: number;
  showTrackOverlay?: boolean;
  resolution: SynopticVideoResolution;
  fps: number;
  durationSec: number;
  /** Number of fully calculated PNG products spanning the complete archived lifecycle. */
  pngFrameCount: number;
  onProgress?: (value: number, phaseFrame: number, phaseTotal: number, status: string) => void;
  signal?: AbortSignal;
}

const RECORD_DIMENSIONS: Record<SynopticVideoResolution, { width: number; height: number; bitrate: number }> = {
  "720p": { width: 1080, height: 720, bitrate: 9_000_000 },
  "1080p": { width: 1620, height: 1080, bitrate: 20_000_000 },
  "2K": { width: 2160, height: 1440, bitrate: 34_000_000 }
};

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
};

const yieldUi = yieldSynopticUi;

function canvasToPng(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      reject(new DOMException("Generation cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    canvas.toBlob((blob) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      if (!blob) reject(new Error("风场气压图 PNG 序列编码失败"));
      else resolve(blob);
    }, "image/png");
  });
}

async function loadPngSource(blob: Blob): Promise<{ source: CanvasImageSource; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("PNG 序列帧解码失败"));
  });
  image.src = url;
  await loaded;
  return { source: image, close: () => URL.revokeObjectURL(url) };
}


async function encodeRenderedSequenceWebCodecs(
  canvas: HTMLCanvasElement,
  renderProductFrame: (index: number) => Promise<void>,
  productFrameCount: number,
  outputFrames: number,
  fps: number,
  bitrate: number,
  onProgress: SynopticWindPressureRecordVideoOptions["onProgress"],
  signal?: AbortSignal
): Promise<Blob> {
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: canvas.width, height: canvas.height },
    fastStart: "in-memory"
  });
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { encoderError = error; }
  });
  const codec = await chooseAvcCodec(canvas.width, canvas.height, bitrate, fps);
  encoder.configure({ codec, width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: "quality" });

  let outputIndex = 0;
  try {
    for (let productIndex = 0; productIndex < productFrameCount; productIndex++) {
      abortIfNeeded(signal);
      if (encoderError) throw encoderError;
      await renderProductFrame(productIndex);

      // Preserve the exact legacy PNG-sequence timing rule: each encoded video frame points to
      // round(frame/(N-1)*(productFrames-1)). The only difference is that the already-rendered
      // lossless Canvas is fed directly to WebCodecs instead of PNG encode -> PNG decode first.
      while (outputIndex < outputFrames) {
        const mapped = outputFrames <= 1 ? 0 : Math.round(outputIndex / (outputFrames - 1) * (productFrameCount - 1));
        if (mapped !== productIndex) break;
        const timestamp = Math.round(outputIndex / fps * 1_000_000);
        const duration = Math.round(1 / fps * 1_000_000);
        const vf = new VideoFrame(canvas, { timestamp, duration });
        encoder.encode(vf, { keyFrame: outputIndex === 0 || outputIndex % Math.max(1, Math.round(fps * 2)) === 0 });
        vf.close();
        outputIndex++;
        while (encoder.encodeQueueSize > 8) {
          abortIfNeeded(signal);
          await new Promise((resolve) => setTimeout(resolve, 4));
        }
      }
      onProgress?.(Math.min(98, 2 + (productIndex + 1) / productFrameCount * 96), productIndex + 1, productFrameCount,
        `正在计算并直接编码全程风场 ${productIndex + 1}/${productFrameCount}`);
      if (productIndex % 2 === 1) await yieldUi(signal);
    }
    if (outputIndex !== outputFrames) throw new Error(`视频帧映射不完整 ${outputIndex}/${outputFrames}`);
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

async function encodePngSequenceWebCodecs(
  blobs: Blob[], canvas: HTMLCanvasElement, fps: number, durationSec: number, bitrate: number,
  onProgress: SynopticWindPressureRecordVideoOptions["onProgress"], signal?: AbortSignal
): Promise<Blob> {
  const outputFrames = Math.max(2, Math.round(fps * durationSec));
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: canvas.width, height: canvas.height },
    fastStart: "in-memory"
  });
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { encoderError = error; }
  });
  const codec = await chooseAvcCodec(canvas.width, canvas.height, bitrate, fps);
  encoder.configure({ codec, width: canvas.width, height: canvas.height, bitrate, framerate: fps, latencyMode: "quality" });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建气压风场视频 Canvas");

  let loadedIndex = -1;
  let loaded: Awaited<ReturnType<typeof loadPngSource>> | null = null;
  try {
    for (let frame = 0; frame < outputFrames; frame++) {
      abortIfNeeded(signal);
      if (encoderError) throw encoderError;
      const idx = outputFrames <= 1 ? 0 : Math.round(frame / (outputFrames - 1) * (blobs.length - 1));
      if (idx !== loadedIndex) {
        loaded?.close();
        loaded = await loadPngSource(blobs[idx]);
        loadedIndex = idx;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loaded.source, 0, 0, canvas.width, canvas.height);
      const timestamp = Math.round(frame / fps * 1_000_000);
      const duration = Math.round(1 / fps * 1_000_000);
      const vf = new VideoFrame(canvas, { timestamp, duration });
      encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 8) {
        abortIfNeeded(signal);
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      onProgress?.(75 + (frame + 1) / outputFrames * 24, frame + 1, outputFrames, `PNG 序列已完成，正在编码视频 ${frame + 1}/${outputFrames}`);
      if (frame % 4 === 0) await yieldUi(signal);
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    loaded?.close();
    if (encoder.state !== "closed") encoder.close();
  }
}

async function encodePngSequenceMediaRecorder(
  blobs: Blob[], canvas: HTMLCanvasElement, fps: number, durationSec: number, bitrate: number,
  onProgress: SynopticWindPressureRecordVideoOptions["onProgress"], signal?: AbortSignal
): Promise<Blob> {
  const outputFrames = Math.max(2, Math.round(fps * durationSec));
  // Use a real capture rate instead of captureStream(0): some browsers expose requestFrame()
  // incompletely and otherwise record a black/empty stream. The PNG sequence is still the
  // only meteorological source; this stream merely serializes the already-rendered frames.
  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = candidates.find((v) => MediaRecorder.isTypeSupported(v)) || "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("气压风场视频录制失败"));
  });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建气压风场视频 Canvas");
  // Prime the capture canvas before MediaRecorder starts so the first encoded sample cannot
  // be an unpainted frame.
  const first = await loadPngSource(blobs[0]);
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(first.source, 0, 0, canvas.width, canvas.height);
  } finally {
    first.close();
  }
  recorder.start();
  let loadedIndex = -1;
  let loaded: Awaited<ReturnType<typeof loadPngSource>> | null = null;
  try {
    for (let frame = 0; frame < outputFrames; frame++) {
      abortIfNeeded(signal);
      const idx = outputFrames <= 1 ? 0 : Math.round(frame / (outputFrames - 1) * (blobs.length - 1));
      if (idx !== loadedIndex) {
        loaded?.close();
        loaded = await loadPngSource(blobs[idx]);
        loadedIndex = idx;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(loaded.source, 0, 0, canvas.width, canvas.height);
      track.requestFrame?.();
      onProgress?.(75 + (frame + 1) / outputFrames * 24, frame + 1, outputFrames, `PNG 序列已完成，正在录制视频 ${frame + 1}/${outputFrames}`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(8, 1000 / fps)));
    }
  } finally {
    loaded?.close();
    if (recorder.state !== "inactive") recorder.stop();
  }
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  abortIfNeeded(signal);
  return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
}

/**
 * Typhoon-report record exporter. Phase 1 always computes the complete lifecycle into an
 * in-memory PNG sequence. Phase 2 encodes only from those PNG products, so video timing/FPS
 * changes never alter the meteorological calculation itself.
 */
export async function generateSynopticWindPressureRecordVideo(options: SynopticWindPressureRecordVideoOptions): Promise<Blob> {
  abortIfNeeded(options.signal);
  const history = (options.typhoon.history || []).slice().sort((a, b) => a.simHour - b.simHour);
  if (history.length < 2) throw new Error("历史记录不足，无法生成台风全程气压风场视频");
  const fixed = options.videoMode === "fixed";
  const startHour = fixed ? Math.max(history[0].simHour, Number(options.startHour ?? history[0].simHour)) : history[0].simHour;
  const endHour = fixed ? Math.min(history[history.length-1].simHour, Number(options.endHour ?? history[history.length-1].simHour)) : history[history.length - 1].simHour;
  if (!(endHour > startHour)) throw new Error("视频裁剪时间范围无效");
  if(fixed && (options.domainMode!=="custom" || !options.customBounds ||
    ![options.customBounds.lonMin, options.customBounds.lonMax, options.customBounds.latMin, options.customBounds.latMax].every(Number.isFinite) ||
    options.customBounds.lonMax<=options.customBounds.lonMin || options.customBounds.latMax<=options.customBounds.latMin))
    throw new Error("固定位置视频必须先在地图上确认有效选区");

  const sourceDim = RECORD_DIMENSIONS[options.resolution];
  const layout = synopticProductLayout(options.stylePreset ?? 'default', options.aspectRatio ?? 'default');
  const dim = fixed ? {
    width: sourceDim.width,
    height: Math.max(2,Math.round(sourceDim.width * layout.height/1536/2)*2),
    bitrate: sourceDim.bitrate
  } : sourceDim;
  const videoBitrate = Math.round(dim.bitrate * (options.quality === 'ultra' ? 1.6 : options.quality === 'high' ? 1.15 : 1));
  const fps = Math.max(1, Math.min(60, Math.round(options.fps)));
  const durationSec = Math.max(2, Math.min(30, Number(options.durationSec) || 10));
  const outputFrames = Math.max(2, Math.round(fps * durationSec));
  const maxSequenceFrames = options.resolution === "2K" ? 160 : options.resolution === "1080p" ? 200 : 240;
  const pngFrameCount = Math.max(2, Math.min(outputFrames, maxSequenceFrames, Math.round(options.pngFrameCount)));
  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = dim.width;
  renderCanvas.height = dim.height;
  const renderCache = createSynopticWindPressureRenderCache();

  const renderProductFrame = async (i: number) => {
    abortIfNeeded(options.signal);
    const frac = pngFrameCount <= 1 ? 0 : i / (pngFrameCount - 1);
    const validHour = startHour + (endHour - startHour) * frac;
    await drawSynopticWindPressureMap({
      canvas: renderCanvas,
      typhoons: [options.typhoon],
      primaryTyphoon: options.typhoon,
      // Record products resolve archived physics at the valid hour, never a forecast extension.
      initHour: validHour,
      validHour,
      startDate: options.startDate,
      config: options.config,
      modelLabel: options.modelLabel,
      stylePreset: options.stylePreset,
      roundedClearEye: options.roundedClearEye === true,
      aspectRatio: fixed ? (options.aspectRatio || 'default') : undefined,
      domainMode: fixed ? "custom" : options.domainMode,
      customBounds: options.customBounds,
      contourIntervalHpa: options.contourIntervalHpa,
      showContours: options.showContours,
      gridResolutionDeg: options.gridResolutionDeg,
      mapZoom: fixed ? 1 : options.mapZoom,
      outputWidth: dim.width,
      showTrackOverlay: options.showTrackOverlay,
      timePresentation: "record",
      renderCache,
      signal: options.signal,
      onProgress: (v) => {
        const frameBase = i / pngFrameCount;
        const within = (v / 100) / pngFrameCount;
        options.onProgress?.(Math.min(96, 2 + (frameBase + within) * 94), i, pngFrameCount, `计算全程风场气压 ${i + 1}/${pngFrameCount}`);
      }
    });
  };

  // ROUND108 fast path: WebCodecs can consume the fully-rendered Canvas directly. This removes
  // lossless PNG compression, Blob allocation, PNG decode and a second Canvas copy for every
  // meteorological frame. Pixel content, meteorological frame count, H.264 quality settings and
  // output-frame timing are unchanged.
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    options.onProgress?.(1, 0, pngFrameCount, "准备全生命周期风场直接编码");
    try {
      const direct = await encodeRenderedSequenceWebCodecs(
        renderCanvas, renderProductFrame, pngFrameCount, outputFrames, fps, videoBitrate, options.onProgress, options.signal
      );
      options.onProgress?.(100, outputFrames, outputFrames, "气压风场视频封装完成");
      return direct;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Fall through to the legacy lossless PNG sequence so older/quirky WebCodecs implementations
      // keep the same compatibility as before.
      options.onProgress?.(1, 0, pngFrameCount, "直接编码不可用，使用兼容 PNG 序列路径");
    }
  }

  const pngBlobs: Blob[] = [];
  options.onProgress?.(1, 0, pngFrameCount, "准备全生命周期 PNG 序列");
  for (let i = 0; i < pngFrameCount; i++) {
    await renderProductFrame(i);
    pngBlobs.push(await canvasToPng(renderCanvas, options.signal));
    options.onProgress?.(Math.min(74, 2 + (i + 1) / pngFrameCount * 72), i + 1, pngFrameCount, `已生成 PNG 序列 ${i + 1}/${pngFrameCount}`);
    await yieldUi(options.signal);
  }

  const encodeCanvas = document.createElement("canvas");
  encodeCanvas.width = dim.width;
  encodeCanvas.height = dim.height;
  options.onProgress?.(75, 0, outputFrames, `PNG 序列完成，共 ${pngBlobs.length} 张；开始视频编码`);
  const canMediaRecord = typeof MediaRecorder !== "undefined" && typeof encodeCanvas.captureStream === "function";
  let blob: Blob;
  if (canMediaRecord) {
    blob = await encodePngSequenceMediaRecorder(pngBlobs, encodeCanvas, fps, durationSec, videoBitrate, options.onProgress, options.signal);
  } else {
    throw new Error("当前浏览器不支持 WebCodecs 或 MediaRecorder，无法从 PNG 序列生成视频");
  }
  options.onProgress?.(100, outputFrames, outputFrames, "气压风场视频封装完成");
  return blob;
}
