# ROUND128_CHANGELOG

## 目标

1. 给“鼠标音 / 麻将音”的按下→松开双触发加入最小可听间隔，避免极快点击时两次瞬态重叠成一声。
2. 在不降低模拟精度、物理步长、地图/气象产品分辨率、显示信息量和业务刷新机制的前提下，对主线程热点进行无损重构，提升长时间运行、高倍速模拟和多图层状态下的流畅度。

## 1. 双触发音效最小间隔

### 新规则
- 鼠标音最小按下→松开间隔：**72 ms**。
- 麻将音最小按下→松开间隔：**84 ms**。
- 实际按住时间若超过最小值：pointerup 立即播放松开声。
- 实际按住时间若短于最小值：只延迟松开声到最低间隔，不延迟按下声。
- 键盘触发/设置预览等兼容播放同样使用这一最低间隔。

### 额外优化
- 全局 pointerdown / pointerup / click 音效监听器改成只安装一次，实时设置从 `configRef` 读取。
- 不再因模拟/设置状态提交而重复卸载、注册 capture-phase 全局监听器。
- 未完成的延迟松开 timer 在组件卸载时统一清理。

## 2. 长风季自动保存：增量历史序列化

此前每次自动保存都会：
- 对每个台风完整 `history` 再执行一次深度 `JSON.stringify`；
- 长风季下每个历史节点还包含站点、配置快照等数据，序列化成本随历史长度持续增长。

ROUND128：
- 缓存已经序列化的历史前缀；
- 普通追加小时只 stringify 新增的 history 节点；
- 保存前对旧前缀逐项进行引用一致性检查；
- 只要发现历史被截断、分支、或中间节点被修改，自动退回完整序列化。

因此恢复数据内容不变，仍写入同一个 `typhoon_sim_state_typhoons` localStorage key，不改变存档格式兼容性。

## 3. 地图历史轨迹与实时预报几何拆层

旧结构中：
- 最佳路径、历史节点、hover 命中区、预报虚线和预报锥位于同一个重型 FeatureGroup；
- 只要打开预报线/锥形，即使历史轨迹完全没变化，也会随实时台风中心更新反复重建大量历史 Leaflet 图层。

ROUND128：
- 新增独立 `forecastGeometryGroupRef`；
- 实时变化的预报虚线和预报锥进入轻量组；
- 历史路径、分析点、预报节点/交互节点继续留在原重型路径组；
- 单活动台风时，即使开启 Forecast / Forecast Cone，重型历史层也可以在几何未变化时直接复用；
- 预报虚线仍保留原来的逐段绘制方式和 dash 样式，没有合并成会改变 dash phase 的单一折线；
- 预报锥算法、点位、半径和原刷新节流保持不变。

## 4. 气象站 Leaflet 图标缓存

- 内置站点纬度余弦预计算，不再每次站点刷新重复求三角函数。
- 去掉每轮临时创建的站点 ID Set。
- 站点当前读数 Map 改为直接填充，避免中间数组。
- `L.divIcon` + HTML 只在以下可见属性变化时生成：
  - 0.1 m/s 显示风速；
  - 胶囊尺寸；
  - 是否处于路径绘制模式。
- 相同视觉键直接复用图标对象；缓存有上限，避免无限增长。

站点实时风速、气压、阵风、风暴潮计算没有降频或降精度。

## 5. 其他无损热点优化

### MapView
- `categoryColors` 指纹改为 `useMemo`，不再在同一次重型地图 effect 中重复 JSON.stringify。
- UI-only config key Set 提升到模块级常量，避免配置 effect 反复分配。

### Forecast intensity
- 手调预报强度曲线的数值清洗 + 排序按数组 identity 使用 WeakMap 缓存。
- 同一条曲线在一次预报/集合计算中被大量查询时，不再每个 lead hour 重做 map/filter/sort。

### 单台风物理
- 只有 0/1 个有效活动气旋时直接跳过 binary/Fujiwhara interaction Map 构造。
- 使用共享零交互对象，避免每 10 分钟物理步反复创建相同 fallback object。
- 两个及以上活动气旋时原有相互作用算法完全不变。

## 未降低的项目

本轮没有修改：
- 10 分钟固定物理步长；
- 模拟计算公式、强度/路径/风圈精度；
- 地形、海岸线、DEM 精度；
- 天气形势/风场 raster 输出分辨率；
- 站点实时诊断内容；
- 历史节点保存频率；
- JMA / CMA 产品业务时钟；
- 风标、色阶和 Round122–125 的视觉标定；
- Round120/121 的生成期、预报强度、移速与陆地白名单逻辑。

## 修改文件

- `src/utils/audio.ts`
- `src/App.tsx`
- `src/components/MapView.tsx`
- `src/simulation/Engine.ts`
- `package.json`
- `scripts/round128_min_delay_performance_regression.cjs`
- Round126/127 回归脚本的兼容断言（接受 Round128 新的最低延时实现）

## 验证

通过：
- ROUND128 minimum tactile delay + lossless performance refactor regression
- ROUND127 recorded mouse audio regression
- ROUND126 audio + neutral glass regression
- ROUND125 flattened/tight pennant regression
- ROUND124 station/replay/barb regression
- ROUND123 REDO barb glyph regression
- ROUND122 REDO synoptic reference regression
- ROUND120 forecast genesis/intensity/speed regression
- ROUND121 forecast-speed landmask regression
- `npx tsc --noEmit --noCheck`

说明：项目包仍未包含 `node_modules`，因此完整 dependency-aware `tsc --noEmit` 会首先报 React/Leaflet 等第三方类型缺失；同时项目已有少量旧类型断言问题。本轮使用源码转译检查 + 专项/关键历史回归确认修改。
