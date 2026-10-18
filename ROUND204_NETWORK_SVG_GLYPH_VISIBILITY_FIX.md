# AETHER R204 — 台风网模拟：台风中心图标和 CMA 预报时效文字缺失修复

版本：程序 `6.0.49`；工作基线：R203。

## 问题原因

R202/R203 的 `networkGeographicGlyph()` 为消除灰色 DOM 底座和双指缩放不同步，把台风中心与 CMA 时效文字迁移至 Leaflet SVG 图层。图形注册在 `CircleMarker._updatePath()` 中，但 Leaflet 初始化时首次调用该方法可能早于 SVG 路径被插入 `_rootGroup`：`path.parentNode === null`。旧实现先记录了 `anchor._networkGlyph`，却尝试将其添加到 null 父节点；之后只在 `anchor._networkGlyph` 不存在时才挂载，导致图标和 CMA 标签长时间不可见。单纯的 SVG 样式隔离测试不能模拟此路径生命周期。

## 代码修改

文件：`src/components/TyphoonNetworkSimulator.tsx`，仅修改通用地理 SVG 图形的挂载时机。

1. 在无有效父 SVG 容器时不创建、记录悬空 `<g>` 元素。
2. `anchor.addTo(map)` 完成 SVG 路径添加后，主动调用一次 `_updatePath()`，执行首次实际绘制。
3. 重新绘制时检查 `<g>` 当前父节点，地图图层容器变更后会重新挂载。
4. 保留已实现的 SVG 地理坐标锚定、旋转中心图标、强度色圆点、CMA `xh/强度` 标签、R203 点击不跳镜头、圆润风圈及低透明度极细描边。

## 验证

- `node scripts/round204_svg_mount_regression.cjs`：源码和挂载时机专项 **9/9 PASS**。
- `python scripts/round204_svg_mount_chromium.py`：通过 Chromium **模拟 Leaflet 的首次更新早于 SVG 路径插入**，验证首次显示、`6h/15级` 标签、中心图标及强度眼、坐标更新、图层父节点重建、移除清理。**PASS**。附隔离可视截图：`validation/round204_svg_glyph_visible_chromium.png`。
- `node scripts/round203_network_click_ring_dot_regression.cjs`：12/12 PASS。
- `node scripts/round203_network_popup_windring_dots_regression.cjs`：16/16 PASS。
- `node scripts/round188_parameter_nodes_regression.cjs`、`node scripts/round189_preserve_wind_radii_regression.cjs`、`node scripts/round185_nmc_crash_safety_retained_regression.cjs`：均通过。
- `npm run build`：**未通过／未执行完整构建**，当前测试环境缺少 `vite`，提示 `sh: 1: vite: not found`。

**限制：** Chromium 使用模拟的 Leaflet SVG.Path 生命周期进行浏览器验证；完整项目的真实 Leaflet 页面和手机双指缩放仍需部署后实测。不能以本次验证宣称全端已验收。
