# AETHER 5.3.0-M5 自测与实现报告

## 1. 阶段范围

本阶段严格以 `AETHER_5_3_0_M4_radar_product.zip` 为基线，完成 M5：雷达视频编码 / Worker、入口 B（气象站点）、入口 C（台风报告视频）、双滑块、30 min 检查点缓存与一致性接线。未进入 M6 的参考图逐项调参、性能实测与最终总验收。

## 2. 新增文件

- `src/radar/RadarVideo.ts`
  - `generateRadarVideo()` 正式视频入口。
  - 复用 `mp4-muxer` 与 `SynopticWindPressureVideo.chooseAvcCodec()`。
  - WebCodecs：逐帧创建 `VideoFrame`，编码后立即 `close()`；`encodeQueueSize > 8` 时等待，防止所有帧堆入内存。
  - MediaRecorder 降级路径。
  - 支持固定 seed、中心平滑、自适应视域、进度水印、AbortSignal。
  - Worker 不可用/渲染失败时自动回退到主线程同一 `RadarEngine`。
- `src/radar/RadarVideoMath.ts`
  - 帧数、H.264 偶数尺寸、自动码率和体积估算纯函数。
- `src/radar/radar.worker.ts`
  - 模块 Worker；直接调用 `renderRadarFrameDetailed()`。
  - `OffscreenCanvas -> ImageBitmap`，主线程仅接收当前帧；支持单任务/全部取消。
- `src/radar/RadarStationExportPanel.tsx`
  - 入口 B：实时图片 / 指定时刻图片 / 过去 X 小时视频 / 图片+视频。
  - X 限制 1–72 h，默认 6 h。
  - 站点中心、距离/方位提示、dBZ / 估算雨率小图、取消/进度。
- `src/radar/RadarTyphoonVideoPanel.tsx`
  - 入口 C 雷达专用视频工作台。
  - 生命史双滑块：1 h 步长、最小 3 h、150 ms 防抖双端缩略图。
  - 仅视频输出，逐帧台风中心跟随，自适应雨区视域有限速。
  - 显示总帧数、播放时长、预计渲染耗时、估算体积、码率及当前渲染进度。
- `scripts/radar_m5_video_workflow_regression.cjs`
  - M5 静态结构 + 纯数值回归。

## 3. 修改文件

- `src/radar/RadarEngine.ts`
  - 检查点缓存升级为按 `physics.checkpointIntervalMinutes`（默认 30 min）的时间格点缓存。
  - LRU 命中提升热度；达到 `maxCheckpointMemoryMb` 时淘汰最老项。
  - 所有场数组、细胞、雨带在缓存取出后深拷贝，避免不同帧互相污染。
  - 新增 `clearRadarCheckpointCache()` / `getRadarCheckpointCacheStats()`。
  - 新增 `sampleRadarPointDbz()` 给站点时序使用。
  - 候选台风筛选改为按目标 `validHour` 的插值状态判断，确保站点历史视频不会因“当前中心已经远离”而漏掉过去时刻的台风。
  - 视频请求支持 0–6 h 相机中心平滑。
- `src/radar/RadarControls.tsx`
  - 视频参数正式接入：1/2/3/5/6/10/15/30/60 min、12/15/24/30/60 fps、自动/手动码率、0–6 h 中心平滑、自适应视域、进度水印及估算。
- `src/radar/RadarTypes.ts`
  - 给序列请求补充 M5 可选视频字段，并让单帧请求可接收相机平滑参数。
- `src/components/StationReportModal.tsx`
  - 保留原站点报告全部功能，增加“雷达回波图 / 视频”工作区入口。
- `src/components/VideoExportModal.tsx`
  - 保留原全部视频类型，增加“雷达回波视频”内容类型；切换后进入专用雷达视频工作台。
- `src/utils/SynopticWindPressureVideo.ts`
  - 仅把既有 `chooseAvcCodec()` 改为导出，供 `RadarVideo.ts` 复用；算法未改。
- `package.json`
  - 新增 `test:radar-m5`。
- `MODIFICATION_NOTES.md`
  - 追加 5.3.0-M5 记录。

## 4. M5 行为核对

### 入口 B

已实现四种模式：

1. 实时图片；
2. 指定时刻图片；
3. 过去 X 小时视频；
4. 图片 + 视频。

视频默认沿用雷达全局默认 6 min 帧距；X 默认为 6 h，输入限制 1–72 h。站点请求固定 `center.kind="point"`，并强制显示中心标记、不显示台风强度大字。站点距离最近台风较远时给出“外围尾部 / 弱回波 / 空场”的明确提示。

可选站点时序会调用同一 `sampleRadarPointDbz()`，不是另造一套假曲线；雨率显示用热带 Z-R 的反算作为“估算降水率”。

### 入口 C

在现有 `VideoExportModal` 中增加“雷达回波视频”，没有删除或替换原有轨迹复盘/JMA/Himawari 功能。雷达专页没有图片导出按钮，只能生成视频。

双滑块覆盖 `history[0].simHour` 到历史末端，步长 1 h，强制 `end-start >= 3 h`；起止两端都生成低分辨率真实雷达缩略图，拖动后 150 ms 防抖。

### 视频编码 / 内存

- H.264 尺寸统一规整为偶数。
- 自动码率主档：720p 约 9 Mbps、1080p 约 18 Mbps、2K 约 26 Mbps、更高约 34 Mbps；高 FPS 用平方根倍率调整。
- WebCodecs 逐帧 `VideoFrame.close()`，编码队列上限 8。
- 不保存所有画面帧，只保留当前 Canvas / ImageBitmap 与物理检查点。
- Worker 支持时正式积分与 Canvas 渲染发生在 `radar.worker.ts`；主线程只绘当前 `ImageBitmap` 到编码画布。
- Worker 或 OffscreenCanvas 不可用时明确降级到主线程同一物理引擎，不切换到贴图动画。

## 5. 检查点与一致性设计

`RadarEngine` 现在会：

- 以 `typhoonId + seed + physicsHash + domain + grid + checkpointHour` 为物理检查点键；
- 默认每 30 min 保存一次完整 `RadarPrognosticState`；
- 保存 q、对流活跃度、对流比例、材料坐标、累积雨量、细胞和雨带；
- 缓存命中后深拷贝再推进；
- LRU 总量受 `maxCheckpointMemoryMb` 控制，默认/最大目标为 400 MB。

视频帧和单图都调用 `RadarEngine`，不存在第二套视频物理模型。M5 当前环境无法运行真实浏览器 Canvas/WebCodecs，因此“编码前的逐像素单图 = 视频帧”没有在本机浏览器实际截图比对；代码路径已经统一，最终逐像素浏览器验收必须在 M6 有完整 npm 依赖的运行环境再次执行。这里没有把未执行的浏览器像素测试虚报为 PASS。

## 6. 回归结果

全部通过：

```text
radar-m0 cleanup regression: PASS (117 source files checked; legacy radar symbols absent)
radar-m1 physics regression: PASS (60 wind-radius checks, worst=0.000000%, geometry=0.00000000px)
radar-m2 prognostic regression: PASS (qMax=187.21 mm/h, wet=100.0%, cells=259, bands=5, worstAdjacentMAD=4.032)
radar-m3 observation regression: PASS (sites=80, domainSites=32, covered=99.9%, visible=89.6%, max=58.0 dBZ, artifactsChanged=62.4%)
radar-m4 product regression: PASS (projection=0.00000000px, layout=1302x1260, entryA=radar_reflectivity)
radar-m5 video/workflow regression: PASS (6h@6min=61 frames, 24h@6min=241, bitrate720=9Mbps, bitrate1080=18Mbps)
release_ui_regression: PASS
synoptic numeric 5.2.31 palette-fix: PASS
synoptic_wind_pressure_regression 5.2.31 palette-fix: PASS
```

M5 数值测试会用真实 TypeScript 5.8.3 编译 `RadarTypes.ts + RadarVideoMath.ts` 后执行：

- 6 h / 6 min = 61 帧；
- 24 h / 6 min = 241 帧；
- 1301 / 1261 会规整成 1302 / 1262；
- 1280×720@24fps 自动 9 Mbps；
- 1920×1080@24fps 自动 18 Mbps。

## 7. TypeScript 全工程检查

原 M4 压缩包没有 `node_modules`。因此 `tsc --noEmit` 仍会报 React、Leaflet、Turf、mp4-muxer、Node types 等依赖不存在。

对比结果：

- M4 基线：147 行诊断，143 个“文件+归一化位置”唯一诊断；
- M5：154 行诊断，150 个“文件+归一化位置”唯一诊断；
- 若只比较“TS 错误码 + 错误消息”，M4 与 M5 都是完全相同的 **22 种**错误类别；
- M5 新增的 7 个文件级诊断全部是新 TSX/视频文件引用原本就缺失的 `react / lucide-react / mp4-muxer / react-jsx-runtime`，没有新增 TypeScript 语法或业务类型错误类别。

所以仍不能声明完整 `tsc --noEmit` PASS；需要安装项目依赖后在 M6 做最终编译/浏览器验收。

## 8. 移动端

入口 B/C 首次打开时，如果屏幕宽度 <768 px 或硬件并发较低，会自动把当前雷达设置调整为：

- `supersample = 1`；
- `physics.gridSpacingKm = 3`。

UI 中有明确提示，不做静默降级。

## 9. M5 尚未声称完成的项目

这些属于 M6 或需要完整浏览器依赖环境：

- 24 h / 6 min 的真实 1080p WebCodecs 全程性能测试（目标 ≤1.5 s/帧）；
- 单次视频实际浏览器内存峰值测量（目标 ≤800 MB）；
- 单图/视频对应帧浏览器逐像素哈希比对；
- 光流/互相关相邻帧连续性最终验收；
- 参考图 13 张对应的登陆、RI、EWRC、强切变、地形、棕海逐项视觉调参；
- M4 尚未实际随包加入的 Natural Earth admin-1 数据资产问题。

这些没有静默标记为完成。
