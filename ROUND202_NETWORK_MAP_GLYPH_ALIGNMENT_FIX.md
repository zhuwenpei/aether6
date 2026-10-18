# R202 — 台风网中心图标、预报标签与地图同步；移除灰色底座和路径打点描边

开发基线：R201；应用版本号继续为 6.0.49。仅修改台风网的可视化绘制层，不改动台风物理引擎、NMC 产品生成器、预报数据数学、风圈原始半径或 32× 回放节奏。

## 问题定位

R201 的历史点、预报点、风圈和轨迹由 Leaflet SVG renderer 绘制；但旋转中心图标与中国预报时效标签仍采用 `L.marker` + `L.divIcon`，属于 Leaflet 独立的 HTML 标记层。移动端 pinch/zoom 变换与 SVG 图层刷新的阶段可能不同，造成图标和标签视觉滞后。应用级按钮/浮层样式还可能作用于 `.leaflet-marker-icon` 的 HTML 容器，使半透明灰色矩形难以单靠 CSS 消除。

## 改动

1. 新增 `networkGeographicGlyph`：以不可见 Leaflet `CircleMarker` 作真实地理坐标锚点，SVG 图片、眼心色点、文字 `<text>` 作为同一 Leaflet `L.SVG` renderer 内的 SVG 节点；renderer 更新点坐标时同步更新 SVG 属性，pan/pinch/zoom 使用与路径及风圈相同的 SVG 根变换。
2. 蓝色中心台风图标更换为 SVG `<image>` 引用已有的透明 PNG，保持 **2 秒逆时针一圈**；眼心独立 SVG `<circle>`，颜色随对应历史强度更新。地图帧改变时只更新锚点，不重建图标。
3. 中国 CMA 预报时效标签改为真实 SVG `<text>`，取消运行时 divIcon，因此不存在独立的玻璃背景矩形。
4. 路径历史打点、中国预报打点及其他机构打点设置 `stroke:false, weight:0`；Petal 的 SVG 点图形去掉白色轮廓，尺寸分别保留 R200 的 10/10/6 CSS px。
5. 新增限定 `tn-map` 的 SVG 样式重置；避免给 SVG glyph 应用应用级模糊/背景/阴影。Geo glyph 被移除时同时清除其 SVG 兄弟节点，避免重复残留。

## 验证

- R202 新增源码专项检查：**9/9 通过**。
- Chromium 模拟地理 SVG 平移、缩放、更新锚点和移除：**通过**；无 HTML divIcon、无背景色或阴影；并生成 `validation/round202_svg_glyphs_chromium.png`。
- R188 三小时参数折线、R189 风圈保持、R185 NMC 防崩溃相关回归：**通过**。
- `Engine.ts`、`NmcForecastProduct.ts`、`TyphoonNetworkData.ts` 与 R201 SHA-256 **完全一致**。
- 一些旧测试脚本以源代码出现 `L.marker(...)` 或必须有白色点描边为断言，和本轮改动目标相冲突，**不能**将其失败当作新功能未通过，亦不能计作通过。
- 现有环境缺少项目 node_modules（vite/react/leaflet），**没有通过完整 TypeScript 类型检查和 Vite 生产构建**，也尚无真实手机手势端到端测试。新的浏览器检查是地图 SVG 组件的隔离模拟，不等同完整 Leaflet 页面。

## 部署验证建议

刷新缓存进入“台风网模拟”，选择高德（默认）/OSM，检查双指缩放或拖动时：（1）旋转台风图标眼心是否仍落在历史终点地理坐标，（2）`6h/…`、`12h/…` 标签是否始终跟随 CMA 对应预报打点，（3）透明背景与无点描边。再切换到 Petal 对比第三方 SDK 的标记显示。
