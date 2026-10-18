# AETHER 6.0.49 — R203 台风网模拟定向修复

**基线**：R202 `AETHER_6_0_49_R202_台风网文字图标同步_去除灰色底座及描边_完整源码.zip`。

## 修改项目

### 1. 点击历史点 / 机构预报点后不移动镜头

- Leaflet 信息弹窗由 `autoPan:true` 改为 `autoPan:false`。信息窗继续绑定被点击节点的地理坐标，尖角仍指向该点，但不再为容纳弹窗自动改变地图中心。
- 点击历史点、CMA 点、其他机构点或地图手势打断 **32× 回放**时，仍按照旧交互直接跳过剩余回放帧、停止自动跟随，但**不执行 `panTo` 或 `setCenter`**，因此不会强制把镜头移动到台风最终位置。
- Petal Maps 的信息窗添加 `disableAutoPan:true` 作为 SDK 支持时的禁止自动平移选项；此 SDK 分支未在实机获得授权密钥验收。
- 有意保留：自动回放正常进行期间仍按 3 小时节点主动跟随中心；切换图源时原有的定位逻辑不变。

### 2. 风圈边缘锯齿

- 保留 R189 的 7/10/12 级风圈四象限数值及 360 段/象限的几何顶点，不改变物理参数和风圈形状定义。
- 旧 Leaflet `L.polygon` 默认的整数屏幕像素投影会把圆弧变成一连串细小水平、垂直台阶，增加角度采样不能有效消除。
- 新增 `smoothWindPolygon`：在 Leaflet SVG 图层上通过 `map.project(latlng, zoom).subtract(map.getPixelOrigin())` 保留**浮点投影坐标**，跳过默认的整数像素取整；继续使用圆角描边和 `smoothFactor:0`。
- 动态风圈更新仍复用同一个多边形实例 `setLatLngs`，跨缩放自动重投影，不必每帧销毁。高德参考栅格、OSM 和离线海陆图共用这套 Leaflet 叠加层；Petal 使用官方 SDK 的多边形分支，未直接采用 Leaflet 的投影覆写。
- 保留原先沿经纬方向连接相邻象限的直线段（该处故意不是圆弧）。

### 3. 极细半透明打点描边

| 打点 | 外直径 | 新描边宽度 | 描边 |
|---|---:|---:|---|
| 历史 | 10 CSS px | 0.36 CSS px | 白色，28% 不透明度 |
| CMA 机构预报 | 10 CSS px | 0.36 CSS px | 同上 |
| 其他机构预报 | 6 CSS px | 0.30 CSS px | 同上 |

- 半径计算扣除描边后仍维持上述**外径**，不让圆点整体变大。
- Petal Maps 使用生成的 SVG 图标，采用相同的细描边与透明度。
- 颜色仍按台风强度，预报虚线仍按机构分类。

## 验证

- `node scripts/round203_network_popup_windring_dots_regression.cjs`：**16/16 通过**。
- `node scripts/round203_network_click_ring_dot_regression.cjs`：**12/12 通过**。
- `python scripts/round203_wind_svg_browser.py`：使用本机 Chromium 通过合成 SVG 对照；证明整数屏幕像素与亚像素路径呈现差异，**不是完整 Leaflet 手机实机测试**。
- R188 三小时参数回归、R189 风圈原值保护及 R185 NMC 防崩溃回归通过。
- TypeScript/TSX 解析与 transpile 检查通过；`npm run build` 仍无法执行（环境缺少 Vite，输出 `sh: 1: vite: not found`）。
- 部分历史版本的静态测试脚本仍断言“所有点无描边”或旧 `L.marker` 调用，已过期；不得将这些失败误报成 R203 运行错误，也不得计为通过。

## 兼容和边界

本次仅修改 `src/components/TyphoonNetworkSimulator.tsx` 的运行时代码以及配套 CSS 注释；不触及物理引擎、存档、集系路径、预报值计算、NMC 绘图器、风圈半径本身。线上地图数据加载、手机双指手势、弹窗贴点和 Petal SDK 仍需部署验收。
