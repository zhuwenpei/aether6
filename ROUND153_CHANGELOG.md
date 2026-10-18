# Round153 — 圆润清晰风眼（按需开关，默认关闭）

基线：**Round152 完整工程**。本轮不修改原模拟物理积分、历史状态、NMC 产品、风场选区/缩放/画幅比例或风速色标。

## 功能

- 在「气象产品 → 风场气压形势图」新增 **圆润清晰风眼** 复选框，默认关闭。用户可手动开启或关闭，状态保存为 `forecast_synopticRoundedClearEye`。
- 关闭时仍执行 Round152 的 `refineIntactEyewallVectors`；只有开启才运行新增 `refineEnhancedEyeVectors`。开关状态作为风场缓存键的一部分，避免前后模式数据复用。
- **风眼真实存在且完整**：无需高风速阈值，采用更强环向风速平滑以及眼墙外缘的受限径向梯度增强，使完整眼墙更圆润、边界更清晰。
- **风眼部分遮挡或破损但仍存在**：仅弱化仍存在眼墙内的短尺度粗糙，保留原始缺口，禁止利用圆周另一侧的风速填补弱风扇区；登陆/近岸区域不会强制封闭眼墙。
- **风眼不存在**（`eyeType=none`）、消散：无增强。风速方向不变；增强只作用于内核附近风场；增强后局部速度不超过原风场该区域的最大风速。
- 一次性气象产品 PNG、预报风场视频以及台风报告全生命周期气压风场视频均接入增强开关。报告视频有独立默认关闭的开关。
- 用户的已保存 `.aether.json` 兼容；`forecast_` 前缀下的新产品参数可被现有存档产品偏好收集器保存。

## 核心源码

- `src/simulation/IntactEyewallRefinement.ts`：Round153 结构判定、完整/部分眼墙环向整理与有限清晰度增强。
- `src/simulation/SynopticWindField.ts`：只在选项开启时应用新增算法；风场缓存按开关隔离。
- `src/utils/SynopticWindPressureMap.ts` / `SynopticWindPressureVideo.ts` / `SynopticWindPressureRecordVideo.ts`：参数透传。
- `src/components/ForecastImageModal.tsx` / `SynopticWindPressureRecordVideoPanel.tsx`：复选框与持久化。
- `scripts/round153_rounded_clear_eye_option_regression.cjs`：专门的门控、幅值、缺口与集成回归。

## 使用存档历史状态的独立门控校验

「达维」四时刻 `scripts/fixtures/round152_davi_4_states.json`：

| 时刻 | 眼结构 | 圆润清晰风眼增强系数 |
| --- | --- | --- |
| +80h | 完整 large_round | 0.960 |
| +215h | gap / blocked | 0.302 |
| +240h | gap / blocked（严重遮挡） | 0.212 |
| +268h | none | 0.000 |

这些是**结构门控强度**，并非完整生产风场渲染图中每个网格的实际修改百分比。位于陆地与地形破坏区的真实修改还会受到陆地遮罩和风场连续性判断限制。

## 验证及限制

Round153 专项、Round152 独立、Round121、143、146、148、149、144 存档回归通过；变更核心模块严格 TypeScript 检查、TSX/TS 转译语法检查、工程 `tsc --noEmit --noCheck` 通过。

原有 Round147 独立脚本存在 `frameworkDistanceKm is not defined` 的旧测试依赖问题；Round145 旧取景断言与 Round148 之后取景机制不一致。这些不是本轮修改造成的，未将其误报为通过。

工程压缩包不包含完整 `node_modules`，**尚未完成 Vite 正式生产构建和移动端实景图视觉验收**。新增的实际绘图效果基于风场算法专项数值测试，不应把其误写为已完成浏览器图片逐像素验收。
