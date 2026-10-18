# AETHER 6.0.49 · Round203 台风网模拟定向修复

## 基线与范围

基于 R202 原始完整源码修改。仅变更 `src/components/TyphoonNetworkSimulator.tsx`，没有改动物理引擎、风圈半径、路径及预报数学、NMC 出图、存档格式、地图数据或顶栏样式。

## 一、点击打点后镜头不跳动

- Leaflet 地理锚定详情弹窗使用 `autoPan:false`，不再为了让信息框完整入屏而强制改变地图中心。
- 32× 自动回放期间，用户触摸、缩放、点击打点仍会**立即结束回放**并跳到相应历史的最终显示时刻，但现在中断操作不会调用 `panTo` / `setCenter` 抢走用户主动选择的地图视野。
- 点击历史中心、CMA 或其他机构打点后，详情框仍锚定其经纬度，地图位置保持不变。极靠边的打点弹窗可能被视口裁切，这是“地图绝不自动移动”的预期折中。
- Petal Maps 分支同样关闭回放中断后的强制重居中，并设置 InfoWindow `disableAutoPan:true`（是否由 SDK 支持需要授权设备验证）。

## 二、风圈抗锯齿

- 问题根因：Leaflet 默认 `latLngToLayerPoint` 会在地图投影中把绘制坐标舍入到整数像素，即使每象限已有 360 个采样点，轮廓仍可能呈 1px 级台阶。
- 针对台风网的风圈 SVG Polygon，独立覆盖 `_projectLatlngs`，使用 `map.project(latlng, zoom).subtract(map.getPixelOrigin())` 保留**浮点亚像素坐标**；继续使用既有 SVG 渲染器、圆角描边和逐帧复用 `setLatLngs`。
- 四象限仍各 360 段，使用原始的四象限半径；经纬方向连接规则、陆地中心隐藏风圈、圆圈填色均不变。
- 此修改仅解决投影时的像素量化台阶，不会消除象限半径不相同时按规定应出现的直线连接和真实拐角。

## 三、恢复很淡的打点轮廓

| 打点类别 | 外径 | 描边宽度 | 描边样式 |
|---|---:|---:|---|
| 历史 | 10 CSS px | 0.36px | 白色，28% 不透明度 |
| CMA 中国预报 | 10 CSS px | 0.36px | 白色，28% 不透明度 |
| 其他机构预报 | 6 CSS px | 0.30px | 白色，28% 不透明度 |

通过同时缩小圆点的填色半径保持原来的**总外径**，重叠时有轻微可见分界；Petal 的 SVG 打点图像使用对应细描边参数。打点颜色仍由台风强度决定，机构虚线仍按机构着色。

## 验证与限制

- 新增 R203 源码与真实几何投影回归：`node scripts/round203_network_popup_windring_dots_regression.cjs`，16/16 通过。
- 额外点按、轮廓、经纬度投影专项：`node scripts/round203_network_click_ring_dot_regression.cjs`，12/12 通过。
- Chromium 独立子像素 SVG 绘制比较：`python scripts/round203_wind_svg_browser.py`，通过，图像保存在 `validation/round203_windring_subpixel_chromium.png`。
- R188 三小时参数、R189 风圈半径、NMC 防崩溃回归通过。
- 原 R198 与 R201 的部分旧源码断言在原始 R202 上已同样失败，属于对已经移除的 DOM 图标或旧绘制语句的过时断言，非本次引入；不计入成功数量。
- 完整 Vite 生产构建仍因当前运行环境没有安装前端依赖（`vite: not found`）而不能完成，尚未执行真实移动浏览器双指缩放与地图图源实测。
