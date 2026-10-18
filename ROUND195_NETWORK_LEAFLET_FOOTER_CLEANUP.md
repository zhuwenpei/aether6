# R195 台风网模拟：移除底部 Leaflet 弹窗式栏与黑色遮罩

基线：R194 修复未定义引用版；程序 `package.json` 版本保持 `6.0.49`。

## 原因

R194 的台风网 OSM/离线地图采用 `L.map(..., {attributionControl:true})`。Leaflet 自动在地图底部右侧创建署名控件；程序全局对 `.leaflet-control-attribution` 的深色背景与移动端链接最小尺寸等样式叠加，使控件变成显眼的深色底栏/大面积遮罩。它**并不是台风数据弹窗**。

## 本次修复

1. 仅在 `src/components/TyphoonNetworkSimulator.tsx` 将此独立地图的 `attributionControl` 设为 `false`，不再生成底部 Leaflet 署名控件。
2. 将 OSM 版权署名改为地图上缘的小型独立透明链接 `© OpenStreetMap contributors`，无背景、滤镜、阴影、遮罩、底部固定栏。点击可查看其版权信息。OSM 版权署名仍必须保留；此改动不代表取消地图数据许可要求。
3. 离线海陆图不显示 OSM 瓦片署名；百度和 Petal 自带的地图版权区域不在本次调整范围内。
4. 历史/预报点点击后、指向地理坐标的信息弹窗保留，因为它们是用户主动点选的数据详情，并非底部遮罩；3 小时动画、NMC、集系、风圈与物理引擎均不改动。

## 验证

- `node scripts/round195_network_bottom_overlay_regression.cjs`：11/11 通过。
- `python scripts/round195_network_css_chromium.py`：390×844 Chromium 隔离样式实测：透明背景、无阴影、无 backdrop-filter、控件位于页面上缘，页面底部不存在 Leaflet 控件。此测试不是完整前端 App 的实机截图。
- R190 / R191 / R192 / R193 / R194：20/20、28/28、32/32、53/53、9/9 通过。其中 R193 脚本依赖的 5 个 R192 原始基线文件从 R192 交付 ZIP 原样提取后参与哈希回归。
- R188 / R189、NMC 崩溃保护单独测试正常。
- 完整 Vite build 与线上手机网页验收未完成：测试环境缺少前端依赖。

部署请重新构建并刷新网页缓存，避免继续加载旧的 R194 前端 JS/CSS。
