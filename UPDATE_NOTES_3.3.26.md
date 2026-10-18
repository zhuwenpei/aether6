# TyphoonSIM 3.3.26 更新说明

## 本版目标

3.3.26 不是增加一组互相独立的“贴图特效”，而是把台风内核、眼墙、CDO、水汽、地形损伤、西风带变性和降水组织统一到连续的结构生命周期中。结构变量逐小时保存在历史状态，卫星云图、降水/雷达、气象站、回放和预报产品读取同一状态，避免不同功能各自判断造成不同步。

> 说明：本版属于基于公开观测、论文与业务资料校准的确定性/随机参数化模拟，不声称进行了机器学习模型训练。公开案例与真实云图用于结构判据、尺度、时间常数和概率门控的资料约束。

## 主要修改

- 新增并统一 `TyphoonStructureMode`，覆盖成熟圆盘 CDO+大眼、不规则高强度 CDO+针眼、中高强度带状/不规则较大眼、干空气侵蚀/干叶/重建、裸露 LLCC、单侧再爆发绕心卷入与重新开眼、标准 EWRC、失败 EWRC 双眼墙对峙、巨大眼+停滞外眼墙、穿山中空+破碎眼墙、登陆偏置云系、登陆外围雨带、棕海局地爆发、西风带剥离、暖输送带/锋面云尾、温带化与温带气旋等状态。
- 新增连续结构记忆：`ewrcStandoffStrength`、`giantEyeOuterWallMemory`、`asymmetricReburstStrength/Bearing`、`llccExposure`、`warmConveyorBeltStrength`、`northeastCloudStripping`、`brownOceanBurstIndex`、`landfallOuterRainbandIndex`、`coreGeometryContinuity` 等。
- 失败眼墙置换不再在 EWRC 状态结束后立刻消失。外眼墙可以长期停滞，内眼墙衰亡后形成巨大眼，RMW 允许连续外移到大尺度并用长时间常数回落，避免动力几何与云图不一致。
- 单侧对流再爆发使用随时间旋转的方位角；爆发可绕中心卷入、逐渐增加轴对称覆盖，并在条件合适时重新开眼。
- 穿越高山后的中空结构保留独立地形记忆。没有明确重建条件时 CDO 不允许下一小时突然恢复；眼半径、RMW、CDO 直径和紧实度使用一致的慢恢复门控。
- 近岸海面上未触发显式机制时，CDO/RMW/眼区也采用更长收缩时间常数与连续性下限，修复“靠陆地但仍在海上，核心突然大幅缩小”。
- 删除 CDO 等于十级风圈的几何耦合。降水密集核心现在由预报/历史 CDO、RMW、紧实度、环流扩张和结构记忆诊断；R10 只作为风场业务量，不再决定云核边界。
- 冷水、低 OHC、水汽储备下降、干空气核心连接和西风带共同进入 `convectiveSuppression`。高强度系统仍保留与德沃夏克 CI/T-number 相符的最低深对流覆盖，但允许明显非对称、云系剥离和锋面化。
- 新增东海/黄海浅陆架搅混软反馈。强度越高、环流越大、移动越慢且 OHC 越低，浅层暖水被搅动后的负反馈越强；超过约 62 m/s 后继续加强显著困难，但不是硬性强度上限。
- 登陆后的热带风暴级软平台缩短为动态驻留预算：近海水汽重叠、大环流、完整低层涡旋和宽平原可延长；深入内陆、小体型、高山阻挡、干空气/西风带会显著缩短。实时和 120 h 预报使用同一逻辑。
- 新增温带气旋业务类别。温带化完成后不再显示热带风暴/强热带风暴等热带等级，而显示“温带气旋”；CMA 路径点和 CMA 预报点使用灰色。
- 新建 `src/simulation/CmaOperationalClock.ts`。路径打点、风圈分析、预报产品、主地图、预报图、视频、报告和 CSV/GeoJSON 业务节点统一使用 CMA/NMC 北京时间 02/05/08/11/14/17/20/23。JMA 仅保留视觉样式和机构风速口径，不再控制 TyphoonSIM 的业务时钟。
- 卫星云图的新结构全部在原有像素循环内计算，没有增加第二套高分辨率场或额外逐像素遍历；降水新结构也并入现有单点求值函数，避免明显增加渲染复杂度。

## 影响的关键文件

- `src/simulation/Engine.ts`
- `src/simulation/PrecipitationModel.ts`
- `src/simulation/CmaOperationalClock.ts`
- `src/types.ts`
- `src/components/SatelliteCloudModal.tsx`
- `src/components/MapView.tsx`
- `src/components/ForecastImageModal.tsx`
- `src/components/TyphoonStatusCard.tsx`
- `src/components/TyphoonReportModal.tsx`
- `src/components/VideoExportModal.tsx`
- `src/utils/VideoRenderEngine.ts`
- `src/components/ControlDrawer.tsx`

## 静态验证说明

按要求未执行 `npm`、未启动 Vite/前端。使用系统已有 TypeScript 编译器做 `tsc --noEmit` 静态扫描；当前源码包没有 `node_modules`，因此会报告 React/Leaflet/Turf 等外部模块类型缺失。另做结构模式枚举、CMA 时钟引用、CDO/R10 解耦与关键字段持久化的文本/类型一致性检查。
