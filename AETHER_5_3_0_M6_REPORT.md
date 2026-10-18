# AETHER 5.3.0 — M6 最终调参、性能收口与验收报告

## 1. 阶段范围

M6 以 `AETHER_5_3_0_M5_radar_video_workflows.zip` 为唯一基线，只进行最终结构/回波调参、参数预设收口、长序列性能路径优化、验收脚本与文档整理；没有另起一套雷达渲染实现。版本号由 5.2.31 正式顺延为 5.3.0。

本阶段主要修改：

- `src/radar/RadarConfig.ts`
- `src/radar/RadarStructure.ts`
- `src/radar/RadarPrognostic.ts`
- `src/radar/RadarCellSystem.ts`
- `src/radar/RadarEngine.ts`
- `src/radar/RadarTypes.ts`
- `scripts/radar_m6_acceptance_regression.cjs`
- `scripts/synoptic_wind_pressure_regression.cjs`（仅解除旧测试对 package 5.2.31 的冻结，保留全部 5.2.31 数值/配色断言）
- `README.md`、`MODIFICATION_NOTES.md`、`public/data/RADAR_ADMIN_BOUNDARIES_NOTICE.md`
- `package.json`、`index.html`

## 2. M6 调参结果

### 2.1 成熟强台风 / 参考图 γ

以用户提供的强台风近方形雷达参考图为结构目标，M6 不通过固定贴图仿造，而是调节同一动力/结构模型：

- 风眼背景主动清扫，避免旧 `q` 被平流持续灌入；
- 内眼墙内侧梯度更陡、外侧稍宽；
- 成熟期加入连续普通 moat；
- 右前象限受移动不对称增强，风切不对称独立叠加；
- r7 以外的轴对称层状背景快速收口，显式雨带/细胞仍可伸到外区；
- 默认杂波/干扰略减弱，避免掩盖眼墙与主雨带。

M6 数值验收得到：眼/眼墙雨率比 `0.046`，右前/对侧眼墙 `1.34×`，moat/眼墙 `0.24`。这三个量直接对应“眼清晰、东/右前侧更强、moat 可辨”的结构目标。

### 2.2 EWRC / RI / 强切变

- EWRC 按 forming → max_decay → recovering → completed 连续改变内外眼墙与 moat；max_decay 测试的内墙/moat/外墙雨率为 `66.5 / 12.7 / 107.0 mm/h`。
- completed 后取消第二眼墙，改由扩大后的主眼墙/大眼接管。
- RI/URI 继续通过结构爆发强度和热塔概率增强，不创建独立硬编码图形。
- 15 m/s 风切测试中，对流中心偏移至少 90 km，下风切侧/上风切侧雨率比为 `4.71×`，同时保留上风切干槽/暴露中心机制。

### 2.3 登陆 / 地形 / 棕海

- 登陆后对称核心衰减，新增由实际移动/风切方向控制的离心残余强弧；8 h 登陆测试强弧/背侧为 `5.38×`。
- 地形仍使用迎风抬升与背风雨影，同一结构在合成山脊测试中迎风侧显著高于背风侧。
- 棕海不直接重新制造完整海上台风，而是抑制登陆散架、延缓对称环和核心一致性衰退；强湿低地测试 `brownOceanFactor=0.95`，关闭棕海后结构保持度明显下降。

### 2.4 细胞与材料纹理

- `localConvectionFrequency` 现已实际进入目标细胞数和新生率，不再只是 UI 参数。
- 长序列保持固定地理网格；台风中心以平滑偏移在网格中移动，结构源项、涡旋风、细胞新生和眼/moat 清扫均跟随当前中心。
- 材料坐标仍随流场平流，不通过整张纹理刚体旋转制造动画。

## 3. 性能路径收口

`RadarEngine` 本阶段完成两项关键改造：

1. 正式积分接入 `sampleRadarEnvironmentGrid()`，以较粗环境网格提供 850/500/200 hPa 风、湿度和风切；不再让正式 Engine 路径的天气尺度环境平流退化为零。
2. 检查点由“固定 spin-up 锚点”升级为“目标时刻之前最新可复用检查点”；正式视频帧也写入既有 LRU/内存上限缓存。连续 6 min 帧距视频因此可从上一帧附近继续积分，而不是每帧重复约 2 h spin-up。

纯 Node 小网格 6 h 双份决定性积分在当前容器约 1.5–1.7 s；该数据只用于发现明显算法退化，**不等同于**规格中的浏览器 2K/1080p 性能预算。

## 4. 预设收口

四套预设仍共用 `RadarConfig.ts`：

- `拟真（默认）`：完整物理与适量真实伪影；
- `图示清晰（弱伪影）`：降低杂波、干扰、缺测；
- `极致细节（高超采样）`：提高 supersample、细胞粒度与局地对流频率；
- `科研对照（关伪影）`：关闭观测伪影并回到基准物理系数。

新雷达目录 `src/radar/` 仍为 `Math.random()` 零命中，所有随机扰动继续由 seed 驱动。

## 5. 自动回归

最终工作树执行结果：

```text
radar-m0 cleanup regression: PASS (117 source files checked; legacy radar symbols absent)
radar-m1 physics regression: PASS (60 wind-radius checks, worst=0.000000%, geometry=0.00000000px)
radar-m2 prognostic regression: PASS (qMax=185.24 mm/h, wet=100.0%, cells=259, bands=5, worstAdjacentMAD=3.824)
radar-m3 observation regression: PASS (sites=80, domainSites=32, covered=91.2%, visible=79.5%, max=58.0 dBZ, artifactsChanged=60.6%)
radar-m4 product regression: PASS (projection=0.00000000px, layout=1302x1260, entryA=radar_reflectivity)
radar-m5 video/workflow regression: PASS (6h@6min=61 frames, 24h@6min=241, bitrate720=9Mbps, bitrate1080=18Mbps)
radar-m6 acceptance regression: PASS (eye/wall=0.046, eastBias=1.34x, moat=0.24, EWRC=66.5/12.7/107.0, shear=4.71x, landArc=5.38x, brown=0.95, continuityΔ=15.04km)
release_ui_regression: PASS
synoptic numeric 5.2.31 palette-fix: PASS
synoptic_wind_pressure_regression 5.2.31 palette-fix: PASS
```

`grep -rniE "computeGroundRadar|radarReflectivity|RADAR_LEGEND" src` 为 0 命中；`Math.random(` 在 `src/radar` 为 0 命中。

## 6. TypeScript 基线差分

当前包仍没有 `node_modules` / lockfile，因此完整 `tsc --noEmit` 无法解析 `react`、`lucide-react`、`react-leaflet`、`@turf/turf`、`mp4-muxer` 等外部模块，返回非零。

为避免把“缺依赖”误判成 M6 类型回归，本阶段对未修改 M5 基线和 M6 工作树使用同一全局 TypeScript 编译器运行：

- M5：154 行诊断；
- M6：154 行诊断；
- 两份原始诊断日志逐字节完全相同；
- 错误代码/信息类别均为 22 类；
- M6 新增 TypeScript 诊断：0。

因此不能宣称完整 `tsc` 在本容器 PASS，但可以确认 M6 没有引入新的编译诊断。

## 7. 规格 14 条最终验收矩阵

| # | 验收项 | 本环境结论 | 记录 |
|---|---|---|---|
| 1 | 旧雷达清理 + tsc | **部分通过** | 旧符号 0 命中；M6 与 M5 `tsc` 日志完全相同，但缺 npm 依赖使完整 tsc 无法成功结束。 |
| 2 | A/B/C 三入口 | **通过（源码/回归）** | M4/M5 回归确认 A 仅图、B 图/视频/双出、C 仅视频+双滑块。 |
| 3 | 1302×1260 STY 版式 γ | **部分通过** | M4 版式/投影回归通过；M6 数值确认清晰眼、右前偏强、moat；当前无浏览器 Canvas，不能重新产出完整正式产品截图做像素级人工比对。 |
| 4 | 24 h 华南登陆视频 | **部分通过** | 241 帧时间计划与登陆 8 h 残余强弧/散架机制通过；无 WebCodecs/Canvas，未实际编码 24 h MP4。 |
| 5 | RI / EWRC | **通过（数值）** | RI 热塔概率提升；EWRC 双眼墙→moat→扩大主眼墙数值回归通过。 |
| 6 | shear=15 m/s | **通过（数值）** | 对流中心偏移 ≥90 km，下风切/上风切雨率 4.71×。 |
| 7 | 台湾/武夷山/南岭地形 | **部分通过** | 真实地形算子已接正式 Engine；合成迎/背风山脊数值测试通过。当前隔离环境未跑三条指定真实路径的完整视频。 |
| 8 | 棕海 | **通过（数值）** | 18 h 湿润低地条件与关闭棕海对照通过。 |
| 9 | 时间连续性 / 非整体贴图旋转 / 细胞生命周期 | **通过（数值/源码）** | 6 h 质心位移变化无突跳（最大相邻位移差 15.04 km）；材料坐标平流和细胞生命周期均为实际产品路径。未进行浏览器视频光流人工观感测试。 |
| 10 | 单图/视频对应帧逐像素一致 | **部分通过** | 两者共用 `RadarEngine`，同 seed 的动力/伪影数组逐元素决定性；因无 Canvas/WebCodecs，未做最终 RGBA/编码帧哈希实测。 |
| 11 | 决定性 | **通过** | M2/M3/M6 同 seed 逐元素一致。 |
| 12 | 取消/报错/泄漏 | **部分通过** | M5 已接 Worker/主线程取消、中文错误和逐帧释放；无浏览器运行时，未做 DevTools 堆内存泄漏测量。 |
| 13 | 性能预算 | **未能运行验证** | 已完成最近检查点复用、环境粗网格、LRU、逐帧释放；当前 Node 无 OffscreenCanvas/VideoEncoder/Worker，不能诚实验证 2K≤6s、1080p≤1.5s/帧、≤800MB。 |
| 14 | 旧功能回归 | **通过** | release UI 与 5.2.31 风场气压形势图数值/配色回归均 PASS。 |

## 8. 数据资产例外

规格要求随包提供 Natural Earth admin-1 中国及周边简化 GeoJSON。当前隔离环境无法把该外部数据文件下载进入容器，因此最终包仍没有：

`public/data/radar_admin1_east_asia.geojson`

`RadarBasemap` 的本地加载/缓存和缺失降级路径保持完整，且不会用手工折线伪造省界。该项在 `public/data/RADAR_ADMIN_BOUNDARIES_NOTICE.md` 中继续明确记录。

## 9. 当前环境浏览器能力

Node 检测结果：

```json
{"OffscreenCanvas":"undefined","VideoEncoder":"undefined","Worker":"undefined","ImageBitmap":"undefined"}
```

因此上表中涉及真实浏览器帧渲染、WebCodecs 编码、峰值内存和最终像素哈希的项目保留为“部分通过/未运行验证”。这是执行环境限制，不在报告中伪装为 PASS。

## 10. M6 结论

AETHER 5.3.0 的新雷达体系已经从 M0 的旧代码清理，经过 M1 风场/环境/地形底座、M2 动力与结构、M3 观测算子、M4 正式产品、M5 视频/三个入口，完成到 M6 的结构调参、预设、缓存性能路径和可自动执行的最终验收基线。

后续若在具备完整 `node_modules + Chromium/WebCodecs` 的机器上做发布前最后验证，优先只需补三项：真实 2K/1080p 性能与内存基准、单图/视频 RGBA/编码帧哈希，以及实际 Natural Earth admin-1 数据文件。
