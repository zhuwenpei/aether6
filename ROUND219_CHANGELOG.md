# AETHER 6.0.49 · R219 修改记录

基线：R218.1（**排除 WNV3/FNV3，允许 GEM**）。本轮只修改 NMC 历史绘制、台风网 CMA 强度/色阶、回放时钟与点径，不改主物理模拟引擎。

## 本轮六项需求

1. **NMC 历史直线连接**：`NmcForecastProduct.ts` 新增 `nmcVisibleHistoricalFixes`；历史绘制的折线拐点与圆点来自**完全相同**的离散节点序列，不再让未显示的高频历史点成为隐形弯曲拐点。
2. **台风网打点精确参考取色**：以 `51757.jpg` 台风点内部高频 RGB 为依据，得到近似 `#00BF00 / #0000FF / #FF7400 / #FF0000 / #FF00FF / #753FC9`。修改 `NETWORK_STRENGTH_LEGEND` 和离线 HTML 的同名色阶，并修复中心图标颜色到图标素材的对应映射、CSS 备用色。截图经过 JPEG 编码，不应把颜色当成官方原始样式表的权威数据。
3. **中国预报按 CMA 公开档位，档位后判级**：共享 NMC 强度解在完成参数/目标巅峰塑形后，仅作**一次**中国公开风速量化，使用物理引擎原有 `getAgencyIntensity(..., 'CMA', 'public')`；按量化后的速度重新计算强度等级；台风网中国预报点与台风网 NMC 图使用**同一数组**，保持同步。其它机构仍由自己的集合主路径和强度方案控制。
4. **NMC 历史警戒线后每小时打点**：历史源数据首次进入 24h 红线陆侧时，转为逐小时采样；优先使用源记录，缺小时的情况仅对已有物理历史做时间插值。线段和圆点使用同一序列；不会向未来预测延伸。NMC 正常产品与台风网引用共用此绘制逻辑。
5. **入线回放速度降至 1/3**：警戒线外 `32` 模拟小时/s（3h 一点），首次入线后为 `32/3` 模拟小时/s（1h 一点），因此两侧都是约 `10.67` 个节点/s。支持一帧跨线的按剩余时间拆分；离线 HTML 同步按警戒线几何位置判定。
6. **中国预报及历史点径增大**：由 `9px` 调到 `11px`（圆点总直径，包括原有轻微白色描边），其它机构 `3.7px` 不变；离线 Canvas 视图同步，历史点点击命中半径相应调整。

## 修改文件

- `src/utils/TyphoonNetworkData.ts`
- `src/utils/NetworkNmcForecast.ts`
- `src/utils/NmcForecastProduct.ts`
- `src/components/TyphoonNetworkSimulator.tsx`
- `src/components/TyphoonNetworkSimulator.css`
- `src/utils/TyphoonNetworkStandaloneExport.ts`
- `scripts/round217_nmc_sync_regression.cjs`（更新 R219 有意调整的旧预期/测试替身）
- `scripts/round218_warning_mainpath_quiet_regression.cjs`（更新 R219 变速/量化后的旧测试替身）
- `scripts/round219_network_nmc_regression.cjs`（新增）
- `scripts/round219_standalone_chromium.py`（新增）

## 已运行验证

- R219 数值与绘制专项：**26/26 通过**。
- R219 离线地图 Chromium：**3/3 手机宽度通过**（360/390/430px）。
- R218 警戒线/固定主路径/免责声明回归：**20/20 通过**。
- R217 中国/NMC 统一强度及登陆限制回归：**13/13 通过**。
- R215 产品设置与比例回归：**15/15 通过**。
- R210 Cloudflare 兼容：**25/25 通过**。
- R213 按钮 Chromium 外观：**9/9 通过**。
- R215 概率图九种屏宽：**9/9 通过**。
- R219 所涉 TS/TSX 文件无语法错误。

## 验证范围与已知限制

1. 环境缺少 React/Leaflet 等 npm 依赖，**未完成正式 Vite 生产构建，也未在真实手机上走完整场台风的 NMC 出图/地图动画端到端流程**；全项目 TypeScript 检查中出现大量依赖缺失的模块解析错误。本轮改动文件未发现其它新增类型错误。
2. 截图采色仅能从 JPEG 找到像素主色，不能保证与截图应用的未压缩源 CSS 完全一致。
3. 台风警戒线使用此前 R218 引入的公开参考坐标，仍非官方原始 GIS 数据。
4. 若自定义 NMC 巅峰目标不在 CMA 公布档位上，**展示值按公开档位就近取整**，因此量化后数值可能不同于未经量化的输入目标。这正是第 3 项所要求的公开档位显示。
5. 更早的 R213、R214、R216 测试可能硬编码了已经被 R217/R218/R219 有意更改的点径、独立峰值滑块或回放速度，不应作为新版判断标准；新版专项已覆盖这些差异。
