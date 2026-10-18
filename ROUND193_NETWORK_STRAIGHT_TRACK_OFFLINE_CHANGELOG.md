# R193 — 台风网模拟：直线段、打点强度修正、离线海陆取色

**基线：R192（程序版本仍为 6.0.49）。** 本轮修改仅限台风网模拟显示与测试文档，不回退或修改既有物理引擎、NMC 单版式及防崩溃机制、Round184 集系算法、R188 三小时参数、R189 风圈原值保护等。

## 1. 每两个**可见**打点用一段直线连接

- 新增 `networkHistorySegments()`、`networkVisibleForecastFixes()`、`networkForecastSegments()`。历史每个实际可见节点之间只画**单独的 2 端点线段**，强度色由该段后端点确定。
- 机构模拟预报内部仍保留每 3 小时的预测资料，但页面只在每隔一个预测点绘制打点（即大多数情况下 6 小时一个显示点）。**连线也只使用显示的点**，不会再因隐藏的 3 小时计算节点而在空白处拐角。
- 预报每段保持所属机构的虚线色（中国、日本、美国、韩国），圆点只按风力强度着色；颜色与线型相互独立。
- OSM/离线 Leaflet、百度 BMap、Petal HWMap 全部改为 2 端点折线对象（Leaflet 额外关闭段内简化）。整条路径仍可以随着一个个节点改变总体方向，但**每段之间没有曲线或无打点的折点**。

## 2. 去掉“生效中”

- 台风网独立视图**不显示“生效中”常驻状态提示**；已消散且 `dissipated=true` 的“已停编”信息仍保留，以免误删有用的历史终止状态。此项只涉及台风网展示，不影响其他产品或数据状态。

## 3. 参考图的强度配色，避免异常打点

基于参考截图（51426、51425、51424、51423、51420）的打点外观，R193 使用以下统一色阶；这是**视觉仿照**而非官方颜色规范：

| 风速 (m/s) | 图示强度 | 新颜色 |
| --- | --- | --- |
| 0–17.2（不含） | 7 级及以下 | 绿色 `#00CE3A` |
| 17.2–24.5（不含） | 8–9 级 | 蓝色 `#0639F5` |
| 24.5–32.7（不含） | 10–11 级 | 橙色 `#FF8B12` |
| 32.7–41.5（不含） | 12–13 级 | 红色 `#FF161D` |
| 41.5–51（不含） | 14–15 级 | 品红 `#EB08DD` |
| ≥51 | 16 级及以上 | 紫色 `#8320D6` |

对 NaN、无穷大、负数使用中性灰；真正弱的已消散／温带低压允许灰色，但不允许一个**过期状态标签将高风速打点误判成灰色**。历史、预报、中心大圆点三者统一使用这一映射。实际 SDK 标签和显示文案不伪称官方机构数据。

## 4. 参考图离线海陆配色图源

- 从用户提供的清晰 Petal 截图上采集典型纯色区域：海洋 RGB **(161,210,253)** `#A1D2FD`；陆地 RGB **(255,255,255)** `#FFFFFF`。
- 菜单中的“离线海陆图”完善为 **“离线海陆图 · 参考配色”**，默认图源仍是 OSM 亮色，已有百度、Petal Maps 保留。
- 陆地及国家边界使用随工程分发的 `public/data/product_land_wide_v3.geojson` 和 `product_countries_highdetail_v3.geojson`，离线图源本身**不向任何第三方地图服务请求在线瓦片**，且不需要百度或华为 API Key。
- 两份地理 JSON 文件第一次选用时从当前项目域名懒加载，并缓存于当前页面内存；异步加载时有清晰提示与失败信息；切走图源时防止旧的异步结果叠到新地图上。
- 高细节离线海陆矢量存放在专用低图层，轨迹与预报打点绘在其上方。海陆颜色在地图缩放时保持一致，离线图源也完整保留已设置的风圈、信息弹窗、三小时中心跳变动画与地理锚点。
- **边界说明：** 这是模拟专用、**海陆和国界的简化离线地图**，不是 Petal Maps 官方地图复制品；没有 Petal 原始道路、建筑、商标、地名和行政细节数据。矢量覆盖重点仍是工程已有的太平洋／亚洲域。首次打开网页、或在完全断网且上述资源未缓存时，仍须预先有本地程序／离线缓存才能正常运行；它的“离线”是无需第三方地图服务、内置地图素材，而非保证任意 URL 在无网络下首次加载。

## 文件变化

- `src/utils/TyphoonNetworkData.ts`：强度色阶、可见节点直线分段。
- `src/utils/TyphoonNetworkOfflineMap.ts`：新增静态资源加载、缓存、离线 GeoJSON 层。
- `src/components/TyphoonNetworkSimulator.tsx`：OSM/离线/百度/Petal 各自画线、地图切换和可见节点。
- `src/components/TyphoonNetworkSimulator.css`：离线背景及图源菜单宽度。
- `scripts/round193_typhoon_network_regression.cjs`：新增专项测试；升级 R190/R192 已过时的源代码形状断言，保留测试意图。
- `validation/round193_user_references/`：本轮 5 张参考截图；`validation/round193_reference_sampled_colors.json`：取色证据；`validation/round193_offline_landsea_preview.png`：**简化数据渲染预览（非浏览器地图截图）**。

## 验证

- `node scripts/round193_typhoon_network_regression.cjs`：**53/53 PASS**。执行真实的颜色/节点计算、GeoJSON 加载（模拟同源 HTTP 返回）、图层创建及跨功能源码哈希核对。
- `node scripts/round190_typhoon_network_regression.cjs`：**20/20 PASS**（更新既有四图源场景断言）。
- `node scripts/round191_typhoon_network_fix_regression.cjs`：**28/28 PASS**。
- `node scripts/round192_typhoon_network_regression.cjs`：**32/32 PASS**（升级旧字面调用断言和修正旧不合理的高风速“已消散灰色”断言）。
- `node scripts/round192_petal_sdk_loader_regression.cjs`：**4/4 PASS**，仅为 SDK 模拟测试。
- `node scripts/round188_parameter_nodes_regression.cjs`：**32 组 PASS**；`node scripts/round189_preserve_wind_radii_regression.cjs`：**24 项 PASS**。
- R185 NMC 防崩溃、集合七面板、袭击概率终止模式专项回归均为 PASS。
- `npm run build`：**未完成**，运行环境无 Vite 依赖（`sh: vite: not found`）。当前未有完整网页的移动端真机截图及手机浏览器和真实 Petal/百度 SDK 验收；不能把此版本声称为像素级或全部端到端通过。
