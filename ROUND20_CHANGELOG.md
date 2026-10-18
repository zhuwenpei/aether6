# AETHER / TyphoonSIM 4.3.5 — Round 20

基于用户提供的 Round 19 项目，只处理本轮三项要求。旧版文档保留为历史记录。

## 修改

1. 版本：`package.json` → `4.3.5`；网页标题和 `Engine.ts` 两处请求标识同步。README 首行及当前版本摘要已更新。保留旧历史版本回归脚本的命令名称，但更新其中针对当前运行版本的断言。
2. 雷达：`src/simulation/PrecipitationModel.ts` 的 `computeGroundRadarDiagnostics()` 不再绘制用台风平移方向加固定相位得到的主/次/远端外螺旋雨臂，因其跟随运动航向机械转向。保留与运动航向无关的云盾、眼墙、内雨带和内雨带局地对流。陆地地形回波不再依赖已移除的外雨臂；降水积分 `computeTyphoonPrecipitation()` 及其有限雨带几何保持不变。
3. 启动崩溃：`src/components/MapView.tsx` 不再调用不存在的 Leaflet `Map.getPopup()`。仅更新点击当前台风中心时保存的 `L.Popup` 实例；中心被移除/换样式时清理旧弹窗，不影响历史节点等其他弹窗。

## 验证

- `scripts/round20_regression.cjs`：版本/页面标题/请求标识检查、Leaflet 弹窗调用与生命周期检查、雷达在改变运动方向时 570 个海陆采样点的数值不变性（285 地点 × 海陆两种）与回波有效性、降水积分雨带机制保留：通过。
- 66 个 TS/TSX 源文件 TypeScript 转译语法检查：0 错误。
- Round 19、Round 18、Round 17 云图/路径、画点、集合数值、历史 4.1.5 功能回归、release UI、HurricaneTrackerPort：通过。
- 旧 `aether_v5_quality_regression` 与 `aether_structure_product_regression` 存在 Round 19 原包即有的产品渲染器字符串断言失败。本轮未修改对应渲染器文件；两项不能声称通过。
- 此环境无完整项目 `node_modules`，未完成 Vite 构建、真实浏览器启动或实际地图/雷达的视觉验证。
