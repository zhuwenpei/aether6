# AETHER 6.0.39 Round132 — 手绘大体预报路径显示层

## 用户需求
在“图层设置 / 常用叠加层”中增加“手绘大体预报路径”显示开关；没有已确认的手绘路径时，不允许切换该开关。

## 修改内容

### 1. 新增独立显示层
- `ActiveLayers` 新增 `drawnForecastRoute?: boolean`。
- 默认值为 `false`，保持旧版本“确认后不常驻显示”的视觉行为。
- 该层只负责显示已经保存的 `config.drawnTrackRoute`，不会触发任何预报路径、强度或气象产品计算。

### 2. 图层设置增加“手绘大体预报路径”
- 位于“地图 -> 常用叠加层”。
- 只有 `drawnTrackRoute` 至少包含 2 个已确认节点时才允许操作。
- 没有有效路径时复选框置灰，并提示“请先绘制并确认手绘大体预报路径”。

### 3. 清除路径时自动关闭图层
- 如果手绘路径被清除、旧存档仅残留图层标志但没有路径，程序会自动把 `drawnForecastRoute` 复位为 `false`。
- 避免以后重新绘制新路径时因为旧开关状态而突然自动显示。

### 4. 地图显示行为
- 绘制/编辑过程中：仍然始终显示当前草稿，不受该开关影响，保证编辑反馈。
- 绘制确认后：只有打开“手绘大体预报路径”图层时才常驻显示。
- 已确认路径使用青色虚线和小节点，与正式 120h 预报路径区分。

## 性能约束
- 新图层不加入 `needsLiveForecastGeometry()`。
- 打开该图层只绘制现有折线，不进行 120h 预报积分。
- Round131 的预报按需计算策略保持不变。

## 验证
- `tsc --noEmit --noCheck`：PASS
- `scripts/round132_drawn_forecast_route_layer_regression.cjs`：PASS
- `scripts/round131_forecast_on_demand_performance_regression.cjs`：PASS
- `scripts/round128_min_delay_performance_regression.cjs`：PASS

完整 TypeScript 类型检查无法在当前执行环境完成，因为原项目包未包含 `node_modules`，React/Leaflet 等类型依赖不可用；源码语法检查与项目专项回归均通过。
