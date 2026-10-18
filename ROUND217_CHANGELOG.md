# AETHER 6.0.49 — R217：统一 NMC / 中国预报强度、外国机构高权重引导、警戒线数据预备

## 需求 1：取消台风网单独巅峰强度逻辑
- 移除 `NetworkEntrySettings.tsx` 入场独立 5–110 m/s 强度滑块和对 config 的强制 `forecastPeakIntensityEnabled` 注入。
- 使用原 `ForecastImageModal` 的完整 NMC 产品设置 `forecast_nmcCoarseIntensity`、`forecast_nmcCustomPeakEnabled`、`forecast_nmcCustomPeak`、`forecast_forecastHours` 等持久化值。
- 新增 `src/utils/NetworkNmcForecast.ts`：NMC 正常产品同源的物理路径重建 → 官方时效终点判断 → 初生保守强度（开启时）→ 自定义巅峰强度（开启时）。仅生成**一次**强度解。
- 网络中国预报和网络 NMC 图片使用同一数组 `chinese.fixes`（不仅对齐峰值，还对齐每一时次 vmax/pmin 和终止时效），不再独立插值、舍入或二次塑形；主模拟历史不改。
- `NetworkAgencyEnsemble.ts` 内其他机构保持随机固定的各集合家族与独立动力轨迹，海上 82% 对齐 NMC 相同时效强度 / 18% 维持自身集合成员强度；超过 NMC 正式时效则保持集合成员原生强度，不在没有有效 NMC 数据的时效做常值外推。陆上及首次登陆之后不增强。
- NMC 精确巅峰请求如果物理/正式时效内不可能达到，仍由原 NMC 算法拒绝请求，不虚构强度。

## 需求 2：细调打点和虚线
- 其他机构打点：3.4 → 3.7px（R215 4px）
- 其他机构描边：0.25 → 0.27px
- 其他机构虚线：1.25 → 1.40px（R215 1.6px）
- 虚线 dashArray：1.8,6.5 → 2,6.2
- 独立 HTML Canvas 同步改为 3.7px 和 1.18px（离线画布与 Leaflet 本身按不同量级绘制）。

## 需求 3：警戒线数据准备但不激活
- 数据 `docs/cma_typhoon_warning_lines_REFERENCE_NOT_RENDERED.geojson` 是标准 WGS84 LineString。
- 24h: [[105,0],[113,4.5],[119,11],[119,18],[127,22],[127,34]]
- 48h: [[105,0],[120,0],[132,15],[132,34]]
- 来源 https://lzugis.github.io/lzugis-blogs/project/ui.html 、https://patents.google.com/patent/CN116224469B/zh 。
- 已找到完整**公开绘图拐点**，但尚未验证为中国气象局直接发布的 GIS 文件，不能称为权威官方原始数据。本轮没有加载、绘制或修改地图警戒线图层。

## 回归与限制
- R217 新增专项脚本 `scripts/round217_nmc_sync_regression.cjs`：13/13 通过。
- R215 正常气象图产品原参数检查 15/15、R210 Cloudflare 兼容 25/25。
- 离线双图 3/3、响应式 9/9 检查通过。
- 142 个前端源码语法解析无错误。
- R213、R214、R216 的部分**旧断言**固定要求已由 R215、R216、R217 明确取消的 UI 巅峰滑块、旧打点宽度、旧登陆后出海增强或旧算法入口，这些断言冲突不作为 R217 的验收通过项。
- 缺少完整 node_modules，无法完成 Vite 生产构建与真实手机运行验收。tsc 仍存在大量缺包错误及已有项目原生类型问题，未发现本轮新增代码的专属 TS 诊断。
