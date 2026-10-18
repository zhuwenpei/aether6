# AETHER 6.0.49 — Round185 定向回退说明

**完成日期：2026-10-17**  
**基线：** `AETHER_6_0_49_Round185_第六阶段完整增量源码.zip`  
**参照：** `AETHER_6_0_49_round184_按51119参考图重校准袭击概率图_完整源码.zip`  
**版本号：** `6.0.49`（未改变）  
**变更性质：** 仅按用户最新三条要求选择性回退；不是将整个 Round185 退回 Round184。

## 1. 集系路径计算与新增多权重多路径：回退到 Round184

- `src/simulation/AetherEnsembleGuidance.ts` 还原 Round184 的**全部集合成员中心位置计算、噪声叠加、父成员走廊约束、目标路径引导及成员输出**。删除 Round185 的辅助路径成员分配、按权重选支路、追加逐步偏移、成员 `auxiliaryBranch` 标记。**差异仅剩 R185 第1项七面板所需的成员规模可选值 `750/1000`**，不会影响已经选定成员数的轨迹数学。
- `src/utils/EnsembleReferenceProducts.ts` 还原 Round184 原有的 `stableTrackHash01` 与 `trimTrackToPostFiveWindow`，从既有集系路径产品的绘图流程撤销 Round185 的停编代理换算；保留与集系路径生成无关的七面板诊断产品和 R185 机构标识能力。
- `src/App.tsx`、`src/components/MapView.tsx`、`ControlDrawer.tsx`、`AetherDesktopChrome.tsx`、`AetherMobileChrome.tsx` 恢复原来的路径编辑/绘图 UI，移除地图虚线、权重条、分支列表、辅助预览、相关按钮/控制器/状态/回调。
- 删除新增的 `src/simulation/AuxiliaryForecastRoutes.ts`、`src/components/AuxiliaryRouteWeightBar.tsx` 和 `AuxiliaryRoutePreview.tsx`。
- `src/types.ts` 移除 `AuxiliaryForecastRoute`、`auxiliaryForecastRoutes`、`auxiliaryMainRouteWeight`、`auxiliaryRoutesIssueHour` 类型及配置声明；`SimulationArchive.ts` 移除其专门的权重/分支校验。**历史 Round185 存档中多出的这三个 JSON 字段仍可被存档格式作为未知附加数据读取，但已不进入任何轨迹生成、图层或 UI；不是删除旧存档文件。**
- `App.tsx` 独立的 `makeHourlyHistorySeed` 三处历史/归档修复刻意保留，避免误回退 Round185 的模拟继续保存修正。

## 2. 弹窗和键盘：全部恢复 Round184

- `src/main.tsx` 去除 Round185 全局对话框 Provider；`src/App.tsx`、`src/components/ForecastPreSimulation.tsx` 恢复 Round184 已有 `window.confirm` 等确认流程及原本的结束预模拟二选一行为。
- `AetherInputDialog.tsx` 完全还原 Round184，取消 Round185 的内置数字键盘、输入法控制与新配色。全项目本次改动的 `NumericField` 均恢复 Round184 原生 `<input>`，涉及 `App`、`ControlDrawer`、`ForecastPreSimulation`、`ForecastSandboxTools`、`ForecastImageModal`、`VideoExportModal`、`SynopticWindPressureRecordVideoPanel`。
- 删除 `src/components/dialogs/AetherDialogProvider.tsx`、`AetherNumericPad.tsx`、`NumericField.tsx` 及相关新增测试、npm 脚本。
- **操作体验回退说明：** 台风编号会恢复 Round184 输入时即时夹取 `1–99` 的逻辑，Round185 的“可先清空再提交”机制不再存在。这是用户要求的完整输入回退，而非遗漏。

## 3. NMC 风格预报图：全部恢复 Round184

- 直接以 Round184 的**字节一致**源码恢复 `src/utils/NmcForecastProduct.ts`、`NmcMapViewport.ts`、`NmcOptionalGeography.ts`。包括画布/取景、概率锥、标注、城市/地理叠加、绘制安全与空白图检测等，不再保留 Round185 的双版式、连续圆盘锥体、版式差异参数、城市筛选以及相关绘图监控。
- `ForecastImageModal.tsx` 移除 `NmcStyleVersion`、2019/2024 切换、版式 LocalStorage、R185 新 NMC 机构参数透传、新警告回调和版式感知空白检测，恢复 Round184 原绘图调用。NMC 产品的原有地理叠加说明文字亦恢复；机构自定义面板不再对这个恢复版式提供无效的可编辑控件。
- Round185 的全局机构名称编辑**仍服务于非 NMC 产品**；恢复的 NMC 输出使用 Round184 原文字和制图方式。
- 恢复 Round184 的 Round180/181/182 三项 NMC 回归脚本和对应浏览器测试夹具；清除 Round185 双版式专用的测试/截图文件。原阶段日志作为历史证据保留，但其叙述已不对应本版运行行为。

## 4. 明确保留的 Round185 独立功能

- 降水地形/噪声调整：`EtopoTerrain.ts`、`PrecipitationModel.ts`、`ObservedRainfallMap.ts`、`Engine.ts`。
- 细分网格、袭击概率的扫描线/条带/精确站点概率和产品级停编设置：`StrikeProbabilityField.ts`、`StrikeProbabilityProduct.ts`、`EnsembleTrackTermination.ts`。**这些是独立袭击概率产品的计算，不再改动原有集系成员路径生成器及旧集系绘图的停编机制。**
- 第六个“综合集系分析”七面板 `EnsembleIntensityAnalysis.ts` 与 750/1000 成员可选值；相关统计产品仍可使用 Round184 的成员生成输出。
- 路径真实化**尚未正式上线**的几何试算工具 `RealisticMotionGeometry.ts`，集系统计标定**仅为度量工具** `EnsembleCalibrationMetrics.ts`，存档异常预模拟引用修复、机构标识（非 NMC）。
- 以上列出的 11 个有代表性的原始 Round185 模块 SHA-256 与用户上传 Round185 文件完全一致；详情由 `scripts/rollback_round185_three_domains.cjs` 独立核查。

## 5. 验证结果

- **29/29 当前回归通过**：运行 `npm run test:rollback-suite`，结果见 `ROLLBACK_ACTIVE_TEST_RESULTS.json`。包括 Round180/181/182 NMC、原有集系成员数值、R185 七面板统计、概率场与精细网格、降水代理、存档、历史几何和机构标识。
- **源代码结构校验**：127 个 TS/TSX 文件解析错误 0，366 条相对导入目标全部存在；被删除的模块/字段/函数运行时引用未发现。
- **哈希校验**：15 个恢复的文件与 Round184 完全相同；`AetherEnsembleGuidance.ts` 除 `750/1000` 成员规模选项外与 Round184 字节一致。11 个与本次回退无关的 Round185 核心模块与原 Round185 字节一致。
- **真实 Chromium Canvas**：Round184 NMC 在合成场 + 随包真实精细海岸线数据上完成 640px 和 1920px 出图、非空检测、取消响应；保留的七面板完成 1988×1871 合成场出图（概率为模拟替身，不代表生产性能）。两项均通过。
- **历史基线缺陷**：另曾跑过三个早期回归 `round46_ensemble_residual_kink_regression`、`round50_ensemble_semicircle_regression`、`round74_ensemble_dispersion_regression`，均失败；已**在原始 Round184 独立复测，同样失败**，原因是早期脚本要求的过时源代码字样/版本号，不是本次回退引入。逐条失败记录见 `ROLLBACK_TEST_RESULTS.json`。这三项未并入当前 29 项有效回归。
- **构建**：执行 `npm run build` 未通过，`sh: 1: vite: not found`，因本环境无项目 npm 依赖；未完成全工程类型检查、生产 Vite 打包或移动端真实交互 E2E。语法/导入校验和 Chromium 模块冒烟**不等同于完整构建通过**。

## 6. 使用与兼容提示

完整工程不含 `node_modules`。保留项目所有与本次三项回退无关的 Round185 业务源代码、资源、历史报告、回归资料；新增本说明和专用回归守卫。旧 Round185 多路径存档的额外权重字段仅作为惰性兼容数据存在，无法继续进入多路径编辑或计算。旧的 `forecast_nmcStyleVersion` LocalStorage 键不会再被使用；图像会按 Round184 样式绘制。

验证命令：

```bash
npm install
npm run build
npm run test:rollback-184
npm run test:rollback-suite
```

`npm install` 与 `npm run build` 应在具备对应网络与完整依赖的本机进行，交付环境并未验证其成功。
