# AETHER 6.0.49 · R218 接力修改记录

## 修改基线
R217 完整源码；保留 R217 中国预报与 NMC 图同一强度结果的机制，主物理模拟引擎未修改。

## 1. 外国机构固定映射集合“主路径”
- `src/utils/NetworkAgencyEnsemble.ts`：采用正常经典集系产品相同的 `buildAetherCenterGuidance` deterministic/control paths，不再抽取扰动集合成员。
- 日本、美国、韩国各分配一个模型家族，固定在同一台风身份 + seed；分配不重复。可选模型：WNV3、ECMWF、AIFS、GEFS、AIGEPS、HGEFS。排除 FNV3 和 GEM（项目内部与用户提及 GENC 对应的末位模式）。
- 主路径使用与经典集系图一致的 168h 集成范围；台风网显示不超过 120h 的 3h 节点。各机构气压/风速在本机构主路径上演算，延续 R217 的 82% NMC 引导、18% 模型强度，以及独立登陆后不可重新增强约束。
- 在打点详情中显示机构所对应的集合模型 ID；导出 HTML 同步保留这一字段。模拟国家机构名称不代表真实业务预报。

## 2. 24/48 小时警戒线和入线 1 小时历史
- `src/utils/NetworkWarningLines.ts`：两条可检视坐标常量，分别 24h（6 拐点）、48h（4 拐点），WGS84  `[经度,纬度]`。
- 地图使用 24h 红色 `#e1162d` 实线、48h 黄色 `#f9e12a` 虚线，均为 `weight:1.75`；统一 Leaflet SVG，随缩放、地图平移和 AMap/OSM 坐标转换一致运动。
- `src/utils/TyphoonNetworkData.ts`：历史中心首次位于 24h 边界的陆侧时，后续切换至每 1 小时节点，入线之前按原 CMA 3h 时次；风速仍离散至 CMA 公开等级。进入判断来自历史真实地理中心而不是图像像素或预报点。
- `src/components/TyphoonNetworkSimulator.tsx` 和导出 HTML：32 模拟小时 / 真实秒的时钟，不按每个节点固定 93.75ms，确保切换至 1h 后不减慢动画。
- 离线 Canvas 快照使用完全相同的警戒线坐标、颜色和自适应时间轴。

**参考来源和限制：** 警戒线坐标来源于公开 GIS 复现代码；未取得中国气象局认证原始 GIS 数据。所用“进入24h线”是参考折线陆侧地理判定，不等价于官方警报发布/解除。

## 3. 入场提示精简确认
- `src/components/NetworkEntrySettings.tsx`：入口增加“关闭所有模拟提示信息（需密码）”按钮；密码 **110908**，同时需要阅读免责声明、勾选同意；关闭后可再次点击恢复提示。
- 精简重复的点位详情说明和概率页大段重复声明。不移除地图最小“模拟”标识，也不移除离线 HTML 的“虚拟模拟 · 非官方预报”标注，以免把非官方模型结果冒充官方实时预报。
- 此密码仅控制前端 UI 选项，并非安全加密、账号认证或内容保密机制。

## 主要文件
- `src/utils/NetworkAgencyEnsemble.ts`
- `src/utils/NetworkWarningLines.ts` (新增)
- `src/utils/TyphoonNetworkData.ts`
- `src/components/NetworkEntrySettings.tsx`、`NetworkEntrySettings.css`
- `src/components/TyphoonNetworkSimulator.tsx`、`TyphoonNetworkSimulator.css`
- `src/utils/TyphoonNetworkStandaloneExport.ts`
- `docs/cma_typhoon_warning_lines_R218_RENDERED_REFERENCE.geojson` (新)
- `scripts/round218_warning_mainpath_quiet_regression.cjs` (新)

## 验证
- R218 新增动态/静态回归：18/18 通过。
- R217 中国与 NMC 同源：13/13 通过。
- R215 设置/图片原始版式：15/15 通过。
- R210 Cloudflare 兼容：25/25 通过。
- 离线双图浏览器 3/3 手机宽度；响应式图片 9/9 屏宽。
- TS/TSX/JS 143 个源码文件语法解析：0 错误。离线 HTML 两个 `<script>` 代码段可正常 JS 语法解析。
- `tsc --noEmit` 无法完成全项目类型检查：当前环境缺少 React/Leaflet 等 npm 模块及类型。无法运行正式 Vite 生产构建，暂未在实际手机地图瓦片下验收滑动及回放。
- R213、R214、R216 的部分旧版固定断言与当前需求冲突（历史节奏、集合成员/主路径、入口峰值滑块、点尺寸），不是 R218 的回归依据。
