# AETHER / WMC 6.0.49 · Round183 — 120 km 袭击概率图

## 基线与编号
- 基于 Round182 的完整源码继续修改（保留此前 NMC PNG 白屏/崩溃、精细海岸线和存档等修复）。
- 随附任务文档指定新增 `ROUND182_CHANGELOG.md`，但实际基线已经具有该文件；为避免覆盖上一轮修复记录，本次新增 **`ROUND183_CHANGELOG.md`**。
- 项目版本 `package.json` 升至 `6.0.49`；未新增 npm 依赖。

## 新版式
- 在“多模式 / 集合路径”新增第五个版式 `strike_probability_120km`，画幅 `2030/1840`。
- `StrikeProbabilityField.ts`：每成员/每格只记一次的精确路径线段命中统计；每 25 成员让出事件循环、取消信号、可选 3×3 展示平滑、站点精确概率。
- `StrikeProbabilitySites.ts`：台湾县市、大陆沿海、日本琉球、菲律宾、越南、朝鲜半岛、西太平洋岛屿的近似行政中心/城市站点（**用于位置代表性统计，不是官方站点实测**）。
- `StrikeProbabilityProduct.ts`：板块等经纬投影、柔和彩色概率栅格、精细海岸线、国省界、四色沿岸概率、灰色成员线、黑色平均线、起报叉号、双行标题、图例、色条及最多十个城市/县市概率胶囊。
- 旧 `strike_probability_map` 的宽度带近似代码已删除，保留原四个版式原有分支。
- Canvas 导出及低清预览通过 `drawEnsembleReferenceProductAsync` 调用新异步路径，支持 AbortSignal 和进度回调。

## UI 参数与缓存
- 统计时效 72/96/120/168/240/360 h，改变时清空旧成员并重新生成；三个集合生成入口统一 `resolveEnsembleHorizon`。
- 命中半径 50–300 km、栅格精度、平滑、沿岸阈值与线宽、取景范围/自定义经纬度、灰线显示、均线黑点间隔、胶囊数量与最低概率、标题模型标签、水印。所有选项带 `forecast_` 前缀本地保存。
- 概率场有最多 3 份内存缓存：仅画面参数改动不重算集合成员；成员状态改变时清空缓存；改变半径/区域自动换键重新计算概率场。
- 当成员数 < 10 时不平滑；0 成员进入绘制工具时可用 centers 生成简化概率图。
- 按项目 WMC 标识约定，**标题模型标签及右下水印默认 `WMC`**（可手动编辑/清空），不复制参考图第三方网址或机构标识；成员属 WMC 内部模拟，非真实 ECMWF/GFS 数值资料。

## 验证 / 限制
- `npm run test:strike-probability`：线段命中、二成员 50%、单成员重复命中只计一次、跨日期变更经线、取消、版式注册、UI 禁用旧字面量、站点 ID 检查通过。
- 8 模型共 4000 构造成员、70°×60°、0.1° 栅格：概率场约 1.0 秒（当前 Node 测试环境，非桌面 Chrome 保证值）。
- 使用真实 `product_coastline_fine_v5.geojson` 与国界数据进行合成 50 成员 Canvas 出图测试：640px 绘图非空，绘制约 300 ms（Skia/Node 环境）。
- 122 个 TypeScript/TSX 文件语法解析无错误，新增模块未出现非依赖类的编译错误。
- **未能完成 `npm run lint`**：随附工程不带依赖，尝试 npm install 超时；TypeScript 报告缺失 react / recharts / leaflet 等包。必须在有依赖和网络的环境内 `npm install && npm run lint && npm run build` 再上线。
- 任务文档提到的 `51119.png` **本次未收到**；颜色使用文档色表及精确坐标，尚无法与原图做像素叠图/取色校准，因此不声称达到 2% 以内的参考图一致性。
- 已知限制：部分岛屿精细数据可能缺失；行政省界在线加载失败时保留离线国界及精细海岸线；集系统计只代表模型模拟路径。

## 文件清单
新增 `src/utils/StrikeProbabilityField.ts`、`src/utils/StrikeProbabilitySites.ts`、`src/utils/StrikeProbabilityProduct.ts`、`scripts/strike_probability_regression.cjs`、`ROUND183_CHANGELOG.md`。
修改 `src/utils/EnsembleReferenceProducts.ts`、`src/components/ForecastImageModal.tsx`、`README.md`、`package.json`。
