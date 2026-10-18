# Round139 — NMC 预报信息框环绕排版 / 概率锥圆头修复

基线：Round138（AETHER 6.0.39）

## 1. NMC 逐时效信息框重新排布

- 移除了 Round138 将全部框固定排列成左右两列的 two-rail 布局。
- `src/utils/NmcForecastProduct.ts` 的 `planNmcCallouts()` 改为 **按预报节点局部布局**：对每个 12 小时节点在 16 个方向 × 8 个偏移距离上枚举候选位置，并做确定性的碰撞评分与局部迭代优化。
- 综合避让已有标注框、台风节点、中心轨迹、标注引线、地图上下边缘、顶部图标与制作信息。引线连接到目标信息框最近的实际边缘，因此上下方的框也能正常连接，不再统一接左右边。
- 允许信息框围绕路径上下、左右、斜向错落分布，避免整列/整行对齐，支持 24～120h 原有产品时效。
- 不修改标注文本内容、台风风级转换、预报位置/强度或预报物理。

## 2. 概率锥圆润封口，避免急转弯几何尖角

- 重写 `renderEnvelope()`：使用随时效半径递增的圆形截面扫掠，绘制到一次性的**不透明离屏掩模**，然后以原透明度 0.49 一次合成到地图。
- 末端是台风 T+H 节点对应的圆形截面，天然获得圆头；不存在旧多边形封口的二次曲线尖角、自交尖刺或多层 alpha 叠加变深问题。
- 半径仍沿用原 `30 + 360 × (lead/120)^1.27` km 和对应纬度/投影缩放，未更改概率锥的增长参数。
- 掩模按主地图区域尺寸创建，绘制被地图边界裁剪；只在生成 NMC 产品时运行，不加入主模拟循环。

## 3. 验证

- `scripts/round139_nmc_perimeter_roundcap_regression.cjs`：四种轨迹（包括 72h 西移、120h 西北行、显著回转、密集慢移）共 40 个框，验证确定性、不越界、不互相重叠、框线连接与概率锥一次合成，**PASS**。
- 既有 `round138_toolbar_nmc_labels_regression.cjs` 为兼容新增共享几何助手仅调整测试脚本截取范围，所有原有无碰撞验证仍 **PASS**。
- Round121、128、129、130、132、135、137、138 静态/专项回归：**PASS**。
- TypeScript `tsc --noEmit --noCheck --pretty false`：**PASS**。
- Chromium 生成并人工检查 72h、120h 和回转样例画布；预览中的台风数据为模拟测试轨迹，测试图使用简化地图数据，实际产品保留原有高精度底图入口。
- 旧 Round120、136 断言依赖 Round138 已删除的 `ForecastIntensityCurveEditor.tsx`，因此在 Round138 原有设计下即不再适用；本轮未恢复被明确要求删除的强度曲线编辑器，也未篡改旧测试。
- 未进行完整 Vite 生产构建或手机浏览器端产品导出测试（提供的项目压缩包未附带 npm 依赖）。

## 修改文件

- `src/utils/NmcForecastProduct.ts`
- `scripts/round138_toolbar_nmc_labels_regression.cjs`（仅适配 Round139 共享 helper 的测试提取范围）
- `scripts/round139_nmc_perimeter_roundcap_regression.cjs`（新增）
- `ROUND139_CHANGELOG.md`（新增）

其它产品、主模拟、历史回放、手绘路径 UI 和既有 NMC 图面业务字段保持不变。
