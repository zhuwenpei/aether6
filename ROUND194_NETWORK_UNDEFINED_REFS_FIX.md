# R194 台风网模拟入页 ReferenceError 修复

基线：**R193 台风网模拟（直线轨迹／强度颜色／离线海陆图）**，程序版本号仍为 `6.0.49`。

## 症状与原因

进入“台风网模拟”后，浏览器报错 `ReferenceError: lastLeafletProviderRef is not defined`。
问题存在于 R193 原始交付 ZIP 的 `src/components/TyphoonNetworkSimulator.tsx`。
Leaflet 地图初始化 effect 使用了 `lastLeafletProviderRef.current`，但组件从未声明该 ref。
同一个 effect 中的 `offlineLayerRef` 也未声明，因此即便只修第一个名称，切换或加载离线海陆图仍会触发另一个 ReferenceError。

## 变更

在 `TyphoonNetworkSimulator` 组件的 hooks 部分新增：

```tsx
const lastLeafletProviderRef=useRef<'osm'|'offline'|null>(null);
const offlineLayerRef=useRef<L.Layer|null>(null);
```

两者都跟随组件生命周期创建：前者记住当前 Leaflet 地图的底图选项，后者保存异步加载的离线 GeoJSON 图层及其清理引用。除此之外未修改台风历史与预报数据、强度配色、3h/16× 回放、CMA 截止、风圈、NMC 或集系计算。

## 验证

- `node scripts/round194_network_refs_regression.cjs`：**9/9 通过**，包含 TypeScript AST ref 声明检查，以及使用全局 TypeScript 语义检查器确认此文件无 TS2304 / TS2552 未定义变量。
- R193 / R192 / R191 / R190 相关回归：**53/53、32/32、28/28、20/20 均通过**。
- R188、R189、NMC 防崩溃、袭击概率与集系分析相关单独回归：均返回成功。
- 原始 R193 ZIP 和本地基线源码比对：确认旧 ZIP 确实缺少 `lastLeafletProviderRef` 声明。
- 差异范围：唯一修改的现有运行时代码文件是 `src/components/TyphoonNetworkSimulator.tsx`（新增两个 ref）；另新增测试和本变更文档，README 增添说明。

## 尚未完成

测试环境中 React / Leaflet / Vite 依赖不存在，完整 `vite build` 及浏览器中点开用户线上页面的端到端验收**未完成**。`tsc --noEmit` 的全项目输出包含依赖缺失及与本次无关的旧报错；已独立筛选检查台风网模块不存在未定义变量。部署后请清除旧缓存或使用新构建，以免继续运行 R193 JavaScript。
