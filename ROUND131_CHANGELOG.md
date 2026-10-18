# AETHER 6.0.39 · Round 131 — 按需预报路径 / 远洋与转向卡顿修复

## 问题复盘

Round129–130 已经消除了深远洋海岸距离与巨型 Polygon 海陆判定的主要退化，但实时模拟仍可能在远洋、或近海转向远洋时出现周期性较长卡顿。进一步静态追踪确认，地理位置只是“看起来相关”，真正稳定的同步尖峰来自 **实时确定性预报路径**：

- 主模拟在 CMA/NMC 3 小时发布时刻会同步生成 120 h 路径；
- 即使 `forecast` 图层关闭，这个 120 h 路径仍然会计算；
- Round120/121 降低预报移速本身不会增加积分步数，因为旧实现固定按 T+1…T+120 每小时积分，共 120 步；
- 但每一步都要计算 steering、区域移速校准、陆地减速语义等，因此会形成明显主线程尖峰；
- 低移速会让路径在某些高成本环境/海陆过渡区域停留更久，可能放大单步成本，但不是“步数增加”的根因。

## 采用方案：按需计算 + 粗实时预览 + 正式产品全精度重算

### 1. 预报图层关闭时：实时预报积分 = 0

新增 `stepSimulation(..., options)` 的实时预报模式：

- `off`：不计算、不携带新的 live `forecastPath`；
- `preview`：只生成地图需要的轻量路径；
- `full`：保留旧行为，作为非 UI 调用/回归兼容默认值。

AETHER 主界面只有以下任一图层打开时才认为存在实时预报需求：

- 预报路径 `forecast`
- 预报锥 `forecastCone`
- Hurricane Tracker 多模式路径 `hurricaneTrackerModels`

默认这些图层均关闭，因此普通模拟不再每 3 小时同步跑 120 h 预报。

### 2. 图层开启时：实时路径只做 3 小时分辨率几何预览

新增 `calculateLiveForecastTrackPath()`：

- 仍然只算路径，不算强度/气压；
- 积分步长从实时旧路径的 1 h 改为 3 h；
- 120 h 路径从约 120 个内部积分步降为约 40 个；
- 地图本身原本就是 3 小时预报节点，因此不浪费 80 个不会直接显示的中间积分步。

MapView 的预报锥和多模式 fallback 也改用该轻量预览，避免某次 React/Leaflet 重绘重新触发完整 120 步同步积分。

### 3. 正式气象产品不使用粗预览

实时粗路径点会带 `previewOnly` 标记。

`materializeForecastPath()` 遇到此标记时：

1. 丢弃 coarse live preview 作为正式几何种子；
2. 从当时保存的完整 Typhoon + `configSnapshot` 状态重新计算 1 h 分辨率确定性路径；
3. 再运行正式强度 / 气压 / 地形 / 热力学积分。

因此实时地图性能优化不会降低 NMC/JMA/JTWC、风场图、集合产品、视频正式预报的积分精度。

### 4. 图层开关即时响应

- 从无预报图层 → 打开任一预报图层：立即为活动台风生成一次轻量 preview；
- 关闭最后一个预报相关图层：立即清空活动台风的 live `forecastPath`，后续物理步不再维护或归档实时预报；
- 历史已经写入的快照不被反向修改。

### 5. 其他显式编辑操作也遵守需求

部署/移动台风、清空或同步实时画点、保存/清除人工预报框架等 UI 操作，不再无条件生成完整实时预报；只有预报图层确实需要显示时才生成 coarse preview。

人工“预报强度曲线编辑器”属于用户主动请求的正式计算入口，仍保留全精度路径 + 强度计算。

## 性能量级

静态控制流计数：

| 场景 | 旧实时 120h 积分 | Round131 |
|---|---:|---:|
| 所有预报相关图层关闭 | 120 步 / 每次 3h issue | **0 步** |
| 预报路径/锥/多模式图层开启 | 120 步 / issue | **40 步 / issue** |
| 正式气象产品生成 | 1h 精度 | **仍为 1h 精度** |

开启实时预报时内部路径步数约减少 **66.7%**；默认图层关闭时消除整个周期性预报同步尖峰。

## 验证

通过：

- `tsc --noEmit --noCheck`
- Round120 forecast genesis / intensity / speed regression
- Round121 forecast-speed landmask regression
- Round128 minimum-delay/performance regression
- Round129 deep-ocean land-distance regression
- Round130 deep-ocean live-land + forecast stall regression
- **Round131 on-demand forecast performance regression**

Round131 专项回归同时锁定：

- hidden-layer 模式不会触发实时路径计算；
- live preview 使用 3 h 步长；
- MapView fallback 不会调用 full integrator；
- `previewOnly` 不会进入正式产品；
- App 中唯一保留的显式 full forecast 调用是人工强度曲线编辑器。
