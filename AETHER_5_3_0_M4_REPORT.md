# AETHER 5.3.0-M4 雷达正式产品阶段报告

## 1. 阶段范围

M4 以 `AETHER_5_3_0_M3_radar_observation.zip` 为唯一代码基线，只完成下列工作：

- 新增 `src/radar/RadarBasemap.ts`
- 新增 `src/radar/RadarLegend.ts`
- 新增 `src/radar/RadarEngine.ts`
- 新增 `src/radar/RadarControls.tsx`
- 扩展 `src/radar/RadarTypes.ts` / `RadarConfig.ts`
- 在 `ForecastImageModal.tsx` 接入入口 A「雷达回波图」
- 新增 M4 产品回归测试和 1302×1260 布局验证图

M4 **没有**实现 M5 的 `RadarVideo.ts`、`radar.worker.ts`、气象站入口 B、台风报告入口 C 或雷达视频编码。

## 2. RadarBasemap

`RadarBasemap.ts` 建立正式产品底图绘制链：

1. 海面：`#b7e3fb`
2. 陆地：`#f3f5f1`
3. 淡 ETOPO 地形晕渲
4. 国家边界；省界/地级市界仅在本地数据真实存在时绘制
5. 雷达回波（由 `RadarEngine` 插入）
6. 河流/湖泊数据若存在时的上层线条；当前没有数据时不伪造
7. 城市点、城市名、省名、海区名
8. 雷达站、覆盖圈、中心标志等可选覆盖层
9. 图例与标题由 `RadarLegend` 最后绘制

底图投影采用局地切平面近似，以视图中心为原点保持横纵 km/px 一致。1302×1260 / 400 km 半宽的经纬度↔像素往返回归误差为 `0.00000000 px`（浮点显示精度内）。

运行时不会请求外网行政区数据。底图只尝试工程本地资源：

- `/data/product_land_wide_v2.geojson`
- `/data/product_countries_highdetail_v3.geojson`
- `/data/radar_admin1_east_asia.geojson`
- `/data/china_prefectures.geojson`

### 行政区数据资产例外

规格要求随工程新增一份 Natural Earth admin-1 中国及周边简化 GeoJSON。本执行环境可以检索/核对公开数据来源，但外部数据文件无法通过当前容器网络传输链实际下载到工程。因此 M4 **没有伪造省界或地级市界**：

- `RadarBasemap` 已实现本地加载、缓存和缺失降级；
- 已加入 `public/data/RADAR_ADMIN_BOUNDARIES_NOTICE.md`；
- `/data/radar_admin1_east_asia.geojson` 缺失时省界自动跳过；
- `/data/china_prefectures.geojson` 缺失时地级市界自动跳过。

这是一项仍待补齐的**数据资产项**，不是渲染代码缺口。

## 3. RadarLegend

`RadarLegend.ts` 实现参考版式 β/γ 的正式标注系统：

- 左下白色图例面板；宽屏和近方形布局分别缩放；
- 产品标题、有效时间、反射率模式；
- 14 段、每 5 dBZ 一档的离散色条和 5–70 dBZ 刻度；
- 默认页脚：`AETHER 模拟雷达拼图 · 模拟产品，非实况`；
- 可选灰色倾斜装饰条；
- 右下极粗强度标注 `{vmax}m/s {CMA级别缩写}`；
- TS / STS / TY / STY / 超强台风等使用分级颜色。

没有复制参考图中的真实机构名称、审图号或官方署名。

## 4. RadarEngine

`RadarEngine.ts` 形成 M4 首个统一正式产品 API：

```ts
renderRadarFrame(req: RadarRenderRequest): Promise<HTMLCanvasElement | OffscreenCanvas>
```

实际数据链为：

`Typhoon history / frozen forecast state`
→ `RadarStructure`
→ `RadarBandSystem / RadarCellSystem / RadarPrognostic`
→ `RadarObservation`
→ `RadarArtifacts`
→ 多台风在线性 Z 域合成
→ 5 dBZ 色表量化
→ `RadarBasemap`
→ 回波 raster
→ 地名/站点/路径等上层标注
→ `RadarLegend`
→ 超采样下采样。

主要实现点：

- 支持 `composite / base05 / ground`；
- 支持 CMA / NWS / 经典绿色 / 自定义色表；
- `RadarRenderRequest` 增加 `customPalette?: RadarColorBand[]`，自定义色表不再只是 UI 占位；
- 支持 1/2/3 倍超采样；
- 支持历史/预报路径、中心标志、比例尺等叠加；
- `AbortSignal` 在长积分和渲染链中继续传递；
- 多台风各自积分/观测后，在**线性 Z 域求和**，最后统一转 dBZ；
- 未来时刻不是冻结当前强度：入口 A 的冻结起报场景通过现有 `materializeForecastPath()` 重建未来状态时间线，再由雷达引擎积分到目标 `validHour`；
- 检查点键包含雷达物理参数哈希，避免不同物理配置误复用状态。

## 5. RadarControls

新增共用 `RadarControls.tsx`，M4 已实现图片侧需要的控制：

- 预设：拟真、图示清晰、极致细节、科研对照；
- 分辨率：720p / 1080p / 2K / 4K / 自定义；
- 画幅：1:1 / 1.03:1 / 4:3 / 3:2 / 16:9 / 9:16；
- 视域半宽预设与 50–1000 km 滑块；
- 组合 / 0.5° / 近地层反射率；
- CMA / NWS / 经典绿色 / 自定义色表；
- PNG / JPEG 与 JPEG 质量；
- 1/2/3× 超采样；
- 地形、海岸辐合、局地对流、切变偏置、爆发、EWRC、棕海、散架、雨带密度、细胞粒度等物理参数；
- 杂波、遮挡、干扰、缺测、站网边缘等伪影参数；
- 图例、时间、强度、行政区、城市、轨迹、雷达站、覆盖圈、中心、比例尺等叠加项；
- seed 和页脚文字。

设置继续由 `RadarConfig.ts` 的雷达 localStorage 机制保存。`mode="video"` 只保留 M5 提示，本阶段没有提前实现视频参数链。

## 6. 入口 A：ForecastImageModal

`ForecastImageModal.tsx` 已新增：

- `ProductStyle = "radar_reflectivity"`
- 产品 Tab「雷达回波图」
- 进入产品时冻结起报小时 `radarIssueHour`
- `+0 ～ +168 h`、1 h 步长的预报时效选择
- 所选台风中心居中
- 复用共用 `RadarControls`
- 按钮「生成雷达回波图」
- PNG/JPEG 输出及对应质量设置
- 中文计算/失败提示与取消信号
- 用户点击才执行的低分辨率预览；预览使用更粗网格、较短预热和 `supersample=1`

入口 A 只提供图片；没有加入雷达视频按钮，也没有改动现有风场气压形势图视频流程。

## 7. 1302×1260 布局验证

生成：

`AETHER_5_3_0_M4_layout_validation_1302x1260.png`

尺寸严格为 **1302×1260**，用于检查近方形版式 γ 的：

- 海陆底色
- 彩色回波层
- 城市标注
- 左下图例
- 14 段色条
- 右下 `45m/s STY` 强度标注

注意：当前环境缺少完整项目 npm 依赖和浏览器 Canvas 运行时，所以该 PNG 是把真实 M3 彩色反射率输出按 M4 的布局/配色规则合成的**版式验证图**，不是浏览器内直接调用 `renderRadarFrame()` 截图。真正的产品渲染链已经在 TypeScript 中接通。M2/M3 调试降水场本身仍偏满，因此该图的回波覆盖偏大；结构/统计调参按计划留到 M6，不在 M4 为追求截图观感而篡改 Z–R 或动力参数。

## 8. 回归测试

M4 完整回归结果：

```text
radar-m0 cleanup regression: PASS (112 source files checked; legacy radar symbols absent)
radar-m1 physics regression: PASS (60 wind-radius checks, worst=0.000000%, geometry=0.00000000px)
radar-m2 prognostic regression: PASS (qMax=187.21 mm/h, wet=100.0%, cells=259, bands=5, worstAdjacentMAD=4.032)
radar-m3 observation regression: PASS (sites=80, domainSites=32, covered=99.9%, visible=89.6%, max=58.0 dBZ, artifactsChanged=62.4%)
radar-m4 product regression: PASS (projection=0.00000000px, layout=1302x1260, entryA=radar_reflectivity)
release_ui_regression: PASS
synoptic numeric 5.2.31 palette-fix: PASS
synoptic_wind_pressure_regression 5.2.31 palette-fix: PASS
```

`test:radar-m4` 还静态检查：

- M4 文件均存在；
- `RadarBasemap` 无 `http://` / `https://` 运行时数据请求；
- land/sea 标准色准确；
- 不含伪造官方雷达署名；
- 统一引擎保持线性 Z 多台风合成；
- 底图 → 回波 → 上层标注 → 图例的顺序正确；
- `renderRadarFrame()` API 存在；
- 自定义色表进入正式请求；
- Entry A 确实调用统一雷达引擎；
- M4 没有提前接 `generateRadarVideo`；
- 1302×1260 投影往返 < 0.05 px。

## 9. TypeScript 检查说明

当前工程包仍没有可用的本地 npm 依赖树，所以完整：

```bash
npx tsc --noEmit
```

不能作为“零错误”验收结果，因为 React/React JSX runtime/Leaflet/Turf 等模块解析在基线就失败。

诊断差分：

- 未修改 M3：145 行诊断 / 141 个归一化唯一诊断；
- M4：147 行诊断 / 143 个归一化唯一诊断；
- 新增两条均来自新建 `RadarControls.tsx` 对 `react` 和 `react/jsx-runtime` 的正常依赖解析失败；
- 未发现 M4 自身新增的本地 TypeScript 类型错误。

M4 可脱离 React 依赖的真实数值/底图/图例模块由全局 TypeScript 编译器单独编译，状态为 0。

## 10. M4 结论

M4 的**代码阶段**已经完成：统一正式产品渲染器、正式底图/图例、共用图片参数面板和入口 A 已接通，并且 M0–M4 及现有产品回归通过。

唯一没有闭合的是规格指定的 Natural Earth admin-1 **实际 GeoJSON 数据资产**；由于当前执行环境无法把外部文件传入容器，工程采取“真实数据存在才画、缺失明确降级”的方式，而没有伪造边界。该资产应在可传输公开数据文件的环境中补入 `public/data/radar_admin1_east_asia.geojson`。

M5 尚未开始。
