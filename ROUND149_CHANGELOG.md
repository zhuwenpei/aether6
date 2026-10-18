# Round149 — 风场选区/画幅比例/风眼内核修复

基线：AETHER 6.0.39 Round148，保留全部原有 NMC、手绘路径、存档及模拟功能。

## 1. 不同风格使用不同选区比例

新增 `src/utils/SynopticProductLayout.ts`，统一确定最终图片比例、纯风场画面矩形及图例几何：

- 默认：使用所选风格自己的原生画幅（默认/HMON/HWRF 不再都当作 1348:940）
- 3:4、4:3、9:16、16:9：**指完整图片（含图例）** 的宽高比例
- 横向：图例在右；竖向：图例在下，色阶由左到右从低风速到高风速
- 手动选区框使用纯风场 `map.w/map.h`，不含标题和图例
- 同一几何控制单张 PNG、风场视频每帧和 Leaflet 选区框
- 视频实际尺寸按新比例计算并取偶数像素，满足 WebCodecs/H.264 对编码尺寸的要求

## 2. 选区地理范围精确一致

旧版“选区与成图缩放不一致”由两层错误叠加造成：

1. 保存的手动经纬度又被 `computeSynopticDisplayBounds()` 按风格比例扩大并应用一次 `mapZoom`。
2. Leaflet 的 EPSG:3857 选区纬度进入了线性 Plate Carrée 映射，而 raster 仍按线性纬度逐行采样。

现已更改：

- 自定义选区直接使用已选边界，不二次调整或缩放；地理无效输入会报错。
- 手动选区的投影和显示 raster 均使用 Leaflet 一致的 Mercator 纬度关系，边界和中间位置不再发生南北缩放偏差。
- 选择后自动恢复 1.00×；自定义选区时 UI 禁用额外缩放以避免矛盾。
- 非手动取景继续保留原 Plate Carrée 风场取景逻辑。

## 3. 风眼形状

新增 `src/simulation/SynopticCoreRepair.ts`，仅对**风场产品**中已求解的 warm-core 热带气旋紧内核实施径向平滑修正：

- 消除 952 hPa 一类台风出现异常直径约 100 km 的大面积低风速白洞。
- 抑制 898 hPa 一类极强台风眼墙被环境风抵消后出现的长条状风眼与突兀切断边界。
- 修复范围以 RMW 及强度控制，径向权重平滑衰减；温带化/陆地影响较强时会降低修正权重。
- **不修改模拟引擎中的台风位置、风速、气压、风圈、历史、随机状态或气象站观测。**

## 主要文件

- `src/utils/SynopticProductLayout.ts` — 新建
- `src/utils/SynopticWindPressureMap.ts`
- `src/utils/SynopticWindPressureVideo.ts`
- `src/components/ForecastImageModal.tsx`
- `src/App.tsx`
- `src/simulation/SynopticCoreRepair.ts` — 新建
- `src/simulation/SynopticWindField.ts`
- `scripts/round149_synoptic_crop_aspect_eye_regression.cjs` — 新增
- `scripts/round148_drawn_stall_synoptic_nmc_regression.cjs` — 适配独立布局模块后测试逻辑仍保留

## 验证与限制

- Round149：三种风格 × 五种画幅比例，Mercator 经纬度-像素往返、内核连续性、二维修正及 UI-视频调用链检查：PASS。
- 新增两个独立模块的 TypeScript strict 检查：PASS。
- `tsc --noEmit --noCheck` 解析检查：PASS。
- Round148、Round146、Round135、Round130、Round129、Round128、Round121、Round143、Round138、Round144：相关回归：PASS。
- **当前运行环境未安装完整 npm React/Leaflet/Vite 依赖，未执行 Vite 生产构建或真机/实际风场出图验收。** 风眼两种样例已做数值回归，但仍应使用应用真实风场做视觉复测。
