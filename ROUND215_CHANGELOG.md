# Round 215 · 全量气象图选项与原版概率集系图

基线：AETHER 6.0.49 · R214。此版本为在 R214 基础上的增量修改，未改动物理模拟引擎。

## 一、台风网入场参数完全复用气象图产品中心

- `src/components/NetworkEntrySettings.tsx`：原先独立的精简设置列表不再使用。保留目标巅峰强度滑块与进入前预计算开关，`气象图生成参数` 抽屉中直接挂载 **同一 `ForecastImageModal` 组件**。因此 NMC、JMA、多模式/集合路径各版式、气旋相空间、风场气压、降水、卫星拼接、气象站等原界面与原生选项均可访问。
- `src/components/ForecastImageModal.tsx`：增加 `settingsOnly` 可选参数，仅在嵌套入口隐藏“进入台风网模拟”循环导航；其他产品、设置界面、预览及选项保留。分辨率选项保存为 `forecast_resolutionId`，默认继续为原产品的 2K（2560×1920）。
- `readNetworkChartSettingsFromProducts`：在确认入场时读取原产品 `forecast_*` 键和对应默认值，不独立保存另一套参数。NMC 默认120小时；袭击概率默认168小时、120km、0.1° 网格和1次平滑；每模型默认50成员；8机构经典产品沿用固定168小时时效。这些均与原产品设置逻辑对应。具体产品独有选项仍由原组件负责保存/使用，不应误认为其他产品选项都作用到概率页的两张图。
- `src/App.tsx`：为嵌套原产品界面提供当前模拟台风、时次、日期和移动端布局，并接入风场气压的地图选区动作。

## 二、概率页两幅产品图保持原有绘图算法及宽高比

- `src/utils/ClassicEnsembleProduct.ts`：从正常气象图产品中提取原有经典集系绘制主体，保持绘制算法、地理投影、字体、色板、图例、边框及布局不变。正常气象图与台风网均调用此同一函数，避免双实现漂移。
- `src/utils/NetworkReferenceCharts.ts`：下方「8机构中心路径图」取消 R214 自定义绘图逻辑，直接交给上述正常产品经典绘制器。默认原生比例 4:3（2K 为 2560×1920）。上方「袭击概率图」继续使用气象图产品同一个 `drawEnsembleReferenceProductAsync` 绘制器，图像比例由其 `getEnsembleReferenceAspect` 决定（2030:1840，宽高比约1.103:1），而不自行拉伸比例。
- 经典集系中心路径图固定使用正常产品 168 小时时效；袭击概率图独立应用用户在原产品设置的概率时效、搜索半径、网格、平滑及其余相关选项。两种时效不会互相篡改。
- `src/components/TyphoonNetworkSimulator.tsx`：网络 NMC 模拟参考读取常规 NMC 独立强度及地理显示相关选项；目标引导仍独立于主模拟实况历史。
- `src/components/TyphoonNetworkSimulator.css` 和 `src/utils/TyphoonNetworkStandaloneExport.ts`：页面内两幅 PNG 宽度占满安全可用宽度（小屏保留 6px 侧边距，其他 10px），最大显示宽度 2560px；`height:auto`、自然纵横比、`object-fit:contain`、纵向滚动，避免横向溢出、裁切及强制变形。长按图片保存仍有效。独立 HTML 离线页面采用同等比例规则。

## 三、回归及交付约束

- `scripts/round215_product_equivalence_regression.cjs`：15/15 通过；涵盖共享默认值、设置继承、常规绘制器共用和原比例的静态检验。
- `scripts/round215_responsive_gallery_chromium.py`：9/9 通过；320、360、390、430、768、1024、1440、1920、2560px 九种视口宽度下无横向溢出、图片保持宽高比。
- 兼容基线：R213 15/15、R214 20/20、R210 Cloudflare 25/25、Chromium 按钮 9/9、离线双图 3/3，均通过。
- 本轮未改动 `src/simulation/Engine.ts`、原台风报告曲线、气象站报告和三小时采样工具。
- **限制**：交付环境没有项目 `node_modules`，因此无法完成正式 Vite 生产构建或完整真实设备端到端运行；全源码静态解析通过，且修改的源码在剔除缺失依赖的 TS2307 报错后未发现新增 TypeScript 语义错误。Chromium 测试针对页面样式/交互测试装置，不等于已在目标手机上验收完整应用。
- 用户选择 8K 输出或高密度集合成员时，会显著提升内存和计算耗时；此时应根据目标设备酌情降档。图像是模拟预报产品而非官方资料。
