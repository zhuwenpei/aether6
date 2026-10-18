# AETHER 6.0.49 · Round 214 接力开发记录

## 基线与变更原则
- 起点：用户提供的 AETHER 6.0.49 / R213 完整源码。
- R214 只修改台风网展示、台风网预报入场参数、台风报告绘图和独立 HTML 分享逻辑；`src/simulation/Engine.ts` 与 `src/components/StationHistory.tsx` 均未修改。
- 所有 CMA/NMC/八模式图为 **项目模拟预报**，不是实时官方 CMA/NMC/ECMWF 资料。参考截图仅用于 UI 风格与双图布局。

## 1 · 入场先确认巅峰强度
- `src/App.tsx`：点击“模拟台风网”时，暂停回放并弹出入场调整页，确认后才挂载 `TyphoonNetworkSimulator`。
- `src/components/NetworkEntrySettings.tsx`、`.css`（新增）：5–110 m/s 巅峰目标强度滑块；入场暂存配置，不覆盖主模拟配置及历史。
- 用现有引擎参数 `forecastPeakIntensityEnabled:true` 与 `forecastPeakIntensityReference` 调用 `materializeForecastPath`。这是环境约束下的强度**目标引导**，并非强制把峰值设为指定数值。
- `src/utils/TyphoonNetworkData.ts`：以目标引导后的物理预测为强度高权重项（92% + 当前值8%），按机构分别叠加随时效变化的确定性位置/强度差异；中国预报最终量化至 CMA 公布档位。

## 2 · 历史与实时 CMA 风速档位
- `cmaBoundedNetworkHistory` 的所有返回节点在展示副本上执行 `toCmaPublishedWindSpeed`，包括首节点和单节点退化情形；不改写 `storm.history`。
- 地图播放/提示与 NMC 参考图中的历史强度来源统一为 CMA 档位数据。

## 3 · “热带气旋概率”双图页
- `src/components/TyphoonNetworkSimulator.tsx` 增加 `probability` 视图和在 NMC 图片下方的入口按钮，保留既有地图/台风参考导航。
- 新模块 `src/utils/NetworkReferenceCharts.ts`：使用现有 `AetherEnsembleGuidance` 的八模型中心引导，Canvas 绘制经典中心轨迹图；使用现有集合成员与 `EnsembleReferenceProducts` 概率栅格生成袭击概率图。页面总共两张图，顺序：袭击概率在上，八模型中心路径在下。
- 页面视觉借鉴截图：绿色导航条、黑背景、纵排图片、浅色标题。图片以 `data:image/png` 真实 `<img>` 呈现，启用移动浏览器原生长按保存；NMC 图片同样可以长按。
- `src/utils/TyphoonNetworkStandaloneExport.ts`：生成离线 HTML 时嵌入两张 PNG，并实现按钮切换与原生长按；不是向外链加载实时图片。

## 4 · 抽屉式图形参数
- 预计算开关（默认关闭；开启将在进入互动地图前计算两图）。
- NMC：预报时效72/96/120小时，图宽800/930/1200px。
- 概率：时效72/120/168小时、袭击半径60–240km、网格精度0.25/0.4/0.6度、平滑遍数0–3次。
- 集合：每模型4/8/12/20条成员，平均位置标注间隔6/12/24小时。
- 关闭预计算后，首次点击概率按钮时按需生成；离线分享时若未生成过则自动补算并打包，时间取决于设备性能与成员数量。

## 5 · 台风报告曲线的 3 小时折线
- `src/utils/ThreeHourlyReportNodes.ts`（新增）：从真实存储历史中依次选择首节点、3小时整步可用节点、末节点；对不规则档案取相邻时点后的第一个真实节点；不产生伪样本。
- `TyphoonReport.tsx`：风速、气压、移动速度使用采样节点，Recharts `type="linear"` 折线，保留节点标记；删除报告专用抖动。
- `TyphoonReportModal.tsx`：普通、生命周期、Patricia 等台风报告的曲线改为3小时原始节点、直线连接；删除旧随机样式噪声、小时/分钟中间点及平滑路径。
- `VideoRenderEngine.ts`：视频结束报告的风速/气压图使用相同的3小时节点。
- **排除项**：正常气象图、气象站点报告/历史曲线及物理引擎均保持原样。

## 校验
- `node scripts/round213_regression.cjs`：15/15 通过。
- `node scripts/round210_cloudflare_missing_leaflet_dependency_regression.cjs`：25/25 通过。
- `node scripts/round214_network_report_regression.cjs`：20/20 通过。
- `python scripts/round213_controls_chromium.py`：9/9 通过（本轮修改前后原按钮回归）。
- `python scripts/round213_standalone_chromium.py`：360/390/430px 原离线 HTML 回归通过。
- `python scripts/round214_standalone_gallery_chromium.py`：360/390/430px 新双图离线交互通过。
- 修改文件的 TypeScript/TSX 语法解析通过；R210 Leaflet 兼容测试通过。

## 现有限制 / 进一步验收事项
- 当前环境中 ZIP 自带的项目无 `node_modules`，离线 `npm install` 不可完成，因此 **未证明 Vite 生产构建、完整类型检查或真实手机端集成体验通过**。静态解析/专项 Chromium 夹具不能替代整站构建。
- 可在可联网并有足够内存的正式开发环境执行依赖安装、`npm run build`、实际手机横竖屏预览，重点验证大成员数与高精度概率计算时延。
- 所有预测来自本项目模拟模型，不接入在线实时气象机构数据；8模型模拟差异不应被当成官方“8机构预报”。
