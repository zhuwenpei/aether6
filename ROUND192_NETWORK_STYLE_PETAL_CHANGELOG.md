# AETHER 6.0.49 — Round192 台风网模拟：强度打点、版式与 Petal Maps

基线：**R191 完整源码**。本轮只修改台风网模拟独立组件及其专属 CSS、图源环境配置，以及对应回归脚本／文档，**不改变台风物理引擎、集系轨迹算法、R188 三小时参数处理、R189 风圈原值保护或 NMC 绘图核心**。

## 1. 预报点由强度决定颜色，预报虚线由机构决定颜色

- 现有 `networkPointColor(vmax, category)` 是历史打点使用的强度调色表；新增 `networkForecastDotColor(fix)` 复用它。预报强度涵盖低压、热带风暴、强热带风暴、台风、强台风、超强台风，以及消散／温带转性灰色。
- 四条机构模拟路径仍采用 `NETWORK_FORECAST_STYLE` 中对应的机构颜色来绘制**虚线**。强度圆点与机构颜色彻底解耦，不会再发生「整条预报圆点都显示为机构色」的问题。
- Leaflet OSM、百度 Map SDK、Petal Map Kit 各自使用相同的强度色判断。预报时效文字在 Petal 底图下也使用 SDK 标记标签显示。
- 用户上传截图中的「中国／日本／美国／韩国」依旧是**模拟产品分组标签**，并非实时下载的官方机构预报数据。

## 2. 根据 51378–51397 系列参考截图继续收敛排版

- 将顶部资料三行蓝字**右对齐**，不再居中；`font-weight:400`，清除 `text-shadow` 和 `-webkit-text-stroke`。红色生效／消散状态同样取消描边与阴影，但保留必要较大的字号与红色。
- 移动端绿色工具栏缩至 `46px`，相应缩小返回图标、地图商按钮、台风参考入口图标与标题字重；地图容器／NMC 参考图位置同步下移对齐。
- 依照移动端参考调整历史／机构信息卡片标题、正文、行距，保留 R191 的 **地理锚定弹窗** 和白底深字清晰度保护；其底部箭头仍由地图 SDK 指向准确打点。
- 信息卡仍保留小号「模拟资料」说明，避免虚拟预测被当成实际气象机构发布数据。
- **验收限制：** 这些是按参照截图做的版式近似校准；没有用相同系统字体、设备 DPI、浏览器内核和地图瓦片作逐像素误差测量，不能宣称像素级完全相同。

## 3. 增加 Petal Maps 正式图源

- 「切换地图商」现在弹出精简菜单：**OSM 亮色 / 百度地图 / Petal Maps**；默认仍为 OSM。
- Petal 采用华为 **Map Kit Web JavaScript SDK** 的官方加载 URL：`https://mapapi.cloud.huawei.com/mapjs/v1/api/js`，通过 `callback` 和 URL 编码后的授权 key 加载，**不是盗用或伪装成 Petal 的未知瓦片地址**。
- 环境变量为 `.env` 中的 `VITE_PETAL_MAPS_KEY`；需要在华为开发者平台启用 Map Kit、申请 API Key、配置域名白名单，部分账户或服务可能需要订阅计费计划。
- Petal 绘制历史路径、每 3 小时强度点、四条机构虚线／强度预报点、风圈覆盖、点击后的地图原生信息窗和三小时中心跳变跟随；离开或切换时清理覆盖层。
- 地图 SDK 加载异常、超时、无授权 key 等情况会显示错误提示并继续使用当前底图。首次建立 Petal 或百度 SDK 时先让地图容器完成布局，再创建地图，避免 `display:none` 初始尺寸为零。
- Petal SDK 加载／认证／真实瓦片数据在本次**没有真实 API Key** 的环境中无法端到端验收；需要在部署后的实际域名和设备上验证。

## 使用

在部署工程 `.env` 中配置（仅需你实际使用的地图服务）：

```ini
VITE_BAIDU_MAP_AK=your_baidu_js_api_key
VITE_PETAL_MAPS_KEY=your_huawei_mapkit_web_api_key
```

部署的环境变量由 Vite 在构建时注入，**修改变量后需要重新构建和部署**。对浏览器公开的 API Key 应使用官方支持的域名白名单／授权限制，避免超额度调用。

## 已运行验证

- `node scripts/round192_typhoon_network_regression.cjs`：**32/32 PASS**；验证强度色、三图源机构虚线、CSS 右对齐、地图切换入口、SDK 清理、动画隔离、NMC 接口。
- `node scripts/round192_petal_sdk_loader_regression.cjs`：**4/4 PASS**；模拟官方脚本回调、Key URL 编码、加载异常及中止。
- `node scripts/round191_typhoon_network_fix_regression.cjs`：**28/28 PASS**（更新了过时的「只有两种图源」断言，但保留原测试意图）。
- `node scripts/round190_typhoon_network_regression.cjs`：**20/20 PASS**（更新两图源旧断言）。
- `python scripts/round192_typography_browser.py`：**PASS**。Chromium 独立 DOM 测量：393px 手机视口的 46px 顶部栏、蓝色信息正常字重右对齐、0px 描边、无文字阴影、信息窗深色正文和白色背景。
- R188 参数节点、R189 风圈保留、R185 NMC 防崩溃、集系统计与袭击概率停编五组回归：**全部退出码 0**；运行日志见 `validation/r192_*.log`。
- **未能完成生产构建：** `npm run build` 返回 `sh: vite: not found`；当前没有安装 React/Vite/Leaflet 依赖，未进行完整站点端到端测试，也无法确认 Petal 服务端授权或载图成功。

## 可追溯的官方 SDK 文档

- [华为 Map Kit Web 入口](https://developer.huawei.com/consumer/en/hms/huawei-MapKit)
- [华为 Map Kit JavaScript 标记](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/javascript-api-drawing-on-map-0000001050162118)
- [华为 Map Kit JavaScript 线／面](https://developer.huawei.com/consumer/fr/doc/HMSCore-Guides/javascript-api-shapes-0000001063922513)
- [华为 Map Kit JavaScript 信息窗](https://developer.huawei.com/consumer/cn/doc/HMScore-Guides/javascript-api-information-window-0000001064306488)
- [API Key 安全与服务订阅问题](https://developer.huawei.com/consumer/de/doc/HMSCore-Guides/faq-0000001050166999)
