import { yieldSynopticUi } from "./SynopticCooperativeYield";
import * as Mp4Muxer from "mp4-muxer";
import { synopticProductLayout, type SynopticProductAspect } from "./SynopticProductLayout";
import type { SimulationConfig, Typhoon } from "../types";
import {
  createSynopticWindPressureRenderCache,
  drawSynopticWindPressureMap,
  type SynopticWindPressureMapOptions
} from "./SynopticWindPressureMap";

export type SynopticVideoResolution = "720p" | "1080p" | "2K";

export interface SynopticWindPressureVideoOptions {
  typhoons: Typhoon[];
  primaryTyphoon: Typhoon;
  initHour: number;
  endLeadHours: number;
  startDate: Date;
  config?: SimulationConfig;
  modelLabel?: string;
  stylePreset?: SynopticWindPressureMapOptions["stylePreset"];
  roundedClearEye?: boolean;
  aspectRatio?: SynopticProductAspect;
  domainMode?: SynopticWindPressureMapOptions["domainMode"];
  customBounds?: SynopticWindPressureMapOptions["customBounds"];
  contourIntervalHpa?: number;
  showContours?: boolean;
  gridResolutionDeg?: 0.1 | 0.125 | 0.25 | 0.5;
  mapZoom?: number;
  showTrackOverlay?: boolean;
  frameCount: number;
  durationSec: number;
  resolution: SynopticVideoResolution;
  onProgress?: (value: number, frame: number, total: number, status: string) => void;
  signal?: AbortSignal;
}

// 产品固定 3:2，因此清晰度名称按垂直分辨率定义。宽高都保持偶数，
// 避免 H.264/WebCodecs 因奇数尺寸拒绝编码。
const dimensions: Record<SynopticVideoResolution, { width: number; height: number; bitrate: number }> = {
  "720p": { width: 1080, height: 720, bitrate: 9_000_000 },
  "1080p": { width: 1620, height: 1080, bitrate: 20_000_000 },
  "2K": { width: 2160, height: 1440, bitrate: 34_000_000 }
};

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Generation cancelled", "AbortError");
}

export async function chooseAvcCodec(width: number, height: number, bitrate: number, fps: number) {
  const candidates = ["avc1.640033", "avc1.640032", "avc1.64002a", "avc1.4d002a", "avc1.42E01E"];
  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (support.supported) return codec;
    } catch {}
  }
  return candidates[candidates.length - 1];
}

async function encodeWithWebCodecs(
  canvas: HTMLCanvasElement,
  renderFrame: (index: number) => Promise<void>,
  frameCount: number,
  durationSec: number,
  bitrate: number,
  onProgress: SynopticWindPressureVideoOptions["onProgress"],
  signal?: AbortSignal
): Promise<Blob> {
  const fps = Math.max(1, frameCount / Math.max(1, durationSec));
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

  try {
    for (let frame = 0; frame < frameCount; frame++) {
      abortIfNeeded(signal);
      if (encoderError) throw encoderError;
      await renderFrame(frame);
      const timestamp = Math.round((frame / fps) * 1_000_000);
      const duration = Math.round((1 / fps) * 1_000_000);
      const vf = new VideoFrame(canvas, { timestamp, duration });
      encoder.encode(vf, { keyFrame: frame === 0 || frame % Math.max(1, Math.round(fps * 2)) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 8) {
        abortIfNeeded(signal);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      onProgress?.(Math.min(97, 5 + ((frame + 1) / frameCount) * 92), frame + 1, frameCount, "正在计算风场并编码视频帧");
      await yieldSynopticUi(signal);
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    onProgress?.(100, frameCount, frameCount, "视频封装完成");
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

async function encodeWithMediaRecorder(
  canvas: HTMLCanvasElement,
  renderFrame: (index: number) => Promise<void>,
  frameCount: number,
  durationSec: number,
  bitrate: number,
  onProgress: SynopticWindPressureVideoOptions["onProgress"],
  signal?: AbortSignal
): Promise<Blob> {
  const fps = Math.max(1, frameCount / Math.max(1, durationSec));
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mimeType = candidates.find((v) => MediaRecorder.isTypeSupported(v)) || "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("MediaRecorder encoding failed"));
  });
  recorder.start();
  const frameDelay = 1000 / fps;
  try {
    for (let frame = 0; frame < frameCount; frame++) {
      abortIfNeeded(signal);
      await renderFrame(frame);
      track.requestFrame?.();
      onProgress?.(Math.min(97, 5 + ((frame + 1) / frameCount) * 92), frame + 1, frameCount, "正在计算风场并录制视频帧");
      await new Promise((resolve) => setTimeout(resolve, Math.max(8, frameDelay)));
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
  }
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  abortIfNeeded(signal);
  onProgress?.(100, frameCount, frameCount, "视频封装完成");
  return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
}

/**
 * 自动从起报时刻积分到所选预报时效，逐帧重建“产品时刻物化”的预报状态、环境场、
 * 台风涡旋、ETOPO 地形与边界层风场。预报状态包含登陆/地形损伤、恢复、EWRC 与 ET 记忆。
 * 每一帧都是完整产品计算，不是把静态 PNG 做平移/缩放动画。
 */
export async function generateSynopticWindPressureVideo(options: SynopticWindPressureVideoOptions): Promise<Blob> {
  abortIfNeeded(options.signal);
  const frameCount = Math.max(2, Math.min(240, Math.round(options.frameCount)));
  // Keep H.264/WebCodecs requests at <=60 fps even for the new high-frame-count modes.
  const durationSec = Math.max(2, Math.min(30, options.durationSec), frameCount / 60);
  const endLead = Math.max(0, options.endLeadHours);
  const dim = dimensions[options.resolution];
  const layout = synopticProductLayout(options.stylePreset || 'default', options.aspectRatio || 'default');
  // The video encoder and still renderer MUST request identical aspect ratio.
  // H.264 needs even backing-store dimensions.
  const videoWidth = dim.width;
  const videoHeight = Math.round(videoWidth / layout.outputAspect / 2) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  // ROUND107: one cache lives for the complete video. Forecast integration, cold-air anchors and
  // reusable raster/contour buffers are shared by every frame instead of being recreated per draw.
  const renderCache = createSynopticWindPressureRenderCache();

  options.onProgress?.(1, 0, frameCount, "准备视频计算域与缓存");
  const renderFrame = async (index: number) => {
    abortIfNeeded(options.signal);
    const frac = frameCount <= 1 ? 0 : index / (frameCount - 1);
    const validHour = options.initHour + endLead * frac;
    await drawSynopticWindPressureMap({
      canvas,
      typhoons: options.typhoons,
      primaryTyphoon: options.primaryTyphoon,
      initHour: options.initHour,
      validHour,
      startDate: options.startDate,
      config: options.config,
      modelLabel: options.modelLabel,
      stylePreset: options.stylePreset,
      roundedClearEye: options.roundedClearEye === true,
      aspectRatio: options.aspectRatio,
      domainMode: options.domainMode,
      customBounds: options.customBounds,
      contourIntervalHpa: options.contourIntervalHpa,
      showContours: options.showContours,
      gridResolutionDeg: options.gridResolutionDeg,
      mapZoom: options.mapZoom,
      outputWidth: dim.width,
      showTrackOverlay: options.showTrackOverlay,
      renderCache,
      forecastHorizonHours: Math.max(3, endLead + 3),
      signal: options.signal,
      onProgress: (v) => {
        const base = index / frameCount;
        const within = v / 100 / frameCount;
        options.onProgress?.(Math.min(96, 3 + (base + within) * 92), index, frameCount, "正在计算当前预报风场");
      }
    });
  };

  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    return encodeWithWebCodecs(canvas, renderFrame, frameCount, durationSec, dim.bitrate, options.onProgress, options.signal);
  }
  if (typeof MediaRecorder !== "undefined" && typeof canvas.captureStream === "function") {
    return encodeWithMediaRecorder(canvas, renderFrame, frameCount, durationSec, dim.bitrate, options.onProgress, options.signal);
  }
  throw new Error("当前浏览器不支持 WebCodecs 或 MediaRecorder，无法生成视频");
}
