# R198：按 webtoapp v122 参考程序改造百度／高德图源读取

基于用户上一份交付 **AETHER R197 (6.0.49)** 定向修改。本轮仅改变「气象图产品 → 台风网模拟」的两个底图选项及地图底图坐标显示，不改动模拟物理、历史／预报计算、CMA 时效、风圈原始半径和 NMC 出图。

## 经查证的参考程序事实

用户上传：`webtoapp_v122_smart60_trail005.zip`。其 `assets/index-v5fix4.js` 定义了 MapLibre Style JSON 中名为 `baidu` 的 raster source，但四个实际地址是：

`https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}`

其余三个域名仅将 `webrd01` 替换为 `webrd02`、`webrd03`、`webrd04`。源代码 attribution 为「高德地图」；参考程序 `v5-focused-fixes-v75.js` 还明确说明，该内置 `baidu` 风格实际采用 **Gaode raster**。因此上传的程序没有提供独立的正版百度地图瓦片接口，也没有能从中复制的真实百度取图方法。

## 实际改动

1. `src/utils/TyphoonNetworkReferenceRaster.ts`：提供与参考程序同参数、同四台主机的普通 Web 墨卡托栅格瓦片，256px，`scale=1`、`style=8`。使用 Leaflet `tileLayer`，不再动态加载百度 BMap 或高德 AMap JavaScript SDK。
2. 原菜单的「百度」兼容项及「高德」项均改用该**同一高德瓦片源**。菜单直接写明「参考程序‘百度’图源（实际高德）」，版权显示「© 高德地图（参考程序瓦片图源）」。**两项不代表两张不同的地图。**
3. 在中国大陆范围内，把用于绘图的 WGS84 台风经纬度临时转换至 GCJ-02 以对准高德栅格底图。真实模拟数值和存档中的经纬度依旧保留原值。历史节点、预报节点、机构虚线、CMA 标签、风圈顶点、旋转中心点、弹窗锚点与视图跟随统一使用同一显示变换。
4. 取消这两个图源对 `VITE_BAIDU_MAP_AK`、`VITE_AMAP_JS_KEY` 与安全代理的前端要求。旧版对应 SDK 载入逻辑与无用地图容器已从该页面清理；Petal Maps 仍按其自身 SDK 方式工作。
5. 连续六个瓦片请求出错时，自动回退至 OSM 并给出清晰提示，避免空白地图。
6. 宽屏及小屏图源选单支持长标签折行，避免真实来源说明被截断。

## 重要限制

- 无 API Key 并不意味着该瓦片服务自动提供第三方商用授权；访问策略、使用条款、速率限制、Referer 限制和服务变更均可能影响实际加载。请按图源服务方要求申请授权后发布。不能保证持续可用。
- 上传的参考程序无法提供真正的百度地图栅格接口。若你要求**真实百度地图**，需要另行提供获授权的百度地图服务或地图 SDK Key；不可把高德数据标成百度数据。
- 没有在本环境中完成获得有效图源授权后的手机浏览器实测，也没有完成完整 Vite 生产构建（依赖未安装）。

## 验证

- `node scripts/round198_reference_raster_regression.cjs`：**26/26 通过**。核对参考程序的瓦片地址、瓦片模板及 subdomain、两项切换、投影变换、所有地图叠加数据定位、图源标识、断线回退、Petal 与 OSM 原功能保留。
- `node scripts/round197_real_archives.cjs`：PASS（两份真实样本存档）。
- `node scripts/round188_parameter_nodes_regression.cjs`、`round189_preserve_wind_radii_regression.cjs`、`round185_nmc_crash_safety_retained_regression.cjs`：PASS。
- R190–R197 旧测试部分含旧 16×、旧官方 SDK 密钥或旧地图容器断言，即使 R197 原版也有过时失败项；本轮不将其错误归类为全部通过。
- TypeScript 无新增的未定义名称诊断；`react`、`leaflet` 等依赖不存在使 `tsc` 和 Vite 完整打包尚无法运行。

## 变更范围

仅改动 `src/components/TyphoonNetworkSimulator.tsx`、`src/components/TyphoonNetworkSimulator.css`，新增 `src/utils/TyphoonNetworkReferenceRaster.ts`、`scripts/round198_reference_raster_regression.cjs`、`validation/round198_reference_webtoapp_source.txt`、本文件与 README 顶部提示。其余程序计算代码与 R197 一致。
