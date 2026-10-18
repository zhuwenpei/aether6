# AETHER 5.2.29 更新说明

## 新增：风场气压形势图

产品中心新增“形势分析 → 风场气压形势图”。该产品为按需重计算产品，不随模拟时钟自动生成；点击“生成风场气压形势图”后显示分阶段进度，并可通过 `AbortController` 终止。取消后的旧任务不会覆盖新结果。

新增参数：有效时效（3 h 步长）、参考复刻/跟随台风/自定义取景、2/4/5/8 hPa 等压线间隔、0.25°/0.5° 计算网格、可选路径叠加和模型标题标签。默认标题为 `AETHER SIM`，不使用 ECMWF 等真实机构/模式名称冒充业务产品。

## 新增模块

- `src/simulation/SynopticWindField.ts`：环境背景场、多台风涡旋、地表场和边界层求解的总装。
- `src/simulation/WindBoundaryLayerSolver.ts`：半拉格朗日平流、压力梯度、科氏力、隐式阻力、Brinkman 地形惩罚及弱 Poisson 投影。
- `src/simulation/SurfaceDragPhysics.ts`：无 DOM/地理数据依赖的 Charnock/Powell 型海面阻力与 10 m 风折减纯函数，供主计算与数值回归共同使用。
- `src/simulation/SurfaceRoughness.ts`：海陆粗糙度、高程/起伏代理陆面阻力、Froude 型阻挡诊断，并缓存静态地形采样。
- `src/simulation/TropicalCycloneVortex.ts`：Holland 气压剖面、Willoughby 型风速结构、四象限风圈、EWRC、移动/风切非对称和温带化。
- `src/utils/SynopticWindPressureMap.ts`：3:2 参考版式、离散 4 kt 风速填色、marching-squares 等压线、极值/标题/色标绘制。
- `scripts/synoptic_wind_pressure_regression.cjs`：产品接入、确定性、涡旋方向、风圈锚点、地表阻力和求解器有限值回归。
- `docs/reference/synoptic_reference.png`：用户提供的参考图原图。

## 视觉复刻

- 基准逻辑画布 1536×1024，输出分辨率按相同比例缩放。
- 标题、地图框、色标、端帽、经纬标签和 `Min_MSLP` 按参考图几何布局实现。
- 色标主色从参考图色条实测，0–80 kt 每 4 kt 离散一级。
- 风速栅格按像素双三次插值后再分档，避免格点方块感。
- SLP 先 2× 双三次上采样，再 marching squares，并做两轮 Chaikin 平滑。
- 主台风 `L` 与中心气压来自产品时刻解析状态；其它 H/L 来自 SLP 局部极值检测。

## 物理一致性

形势图只读现有 AETHER 数据。环境来自 `SynopticEnvironment`，地形来自 ETOPO，陆地来自产品高精度海岸线。海陆风速反差由粗糙度/阻力和边界层求解产生；山地斑块来自地形阻挡及确定性湍流粒度；台风环流来自参数化气压/风速涡旋与求解器，不按掩膜换色或手工绘制同心结构。

计算端增加三层有限缓存：完整风压场小型 LRU、环境格点采样 LRU、静态地形/粗糙度采样缓存。边界层固定在 60–150 次迭代范围内并按残差提前收敛，使用台风相对平移坐标、Strang 科氏分裂、半拉格朗日平流和弱 Poisson 投影；计算与渲染都会周期性让出事件循环并检查取消信号。

## 清理的历史残留

本轮删除了 3 个已失效的旧回归脚本：

- `scripts/aether_desktop_rework_regression.cjs`
- `scripts/aether_v5_quality_regression.cjs`
- `scripts/aether_structure_product_regression.cjs`

它们仍引用已经不存在的 `src/utils/AetherProductRenderer.ts` 或旧形势产品标识，无法代表 5.2.28/5.2.29 当前源码。对应的 `package.json` 测试入口一并删除。`AETHER_DESKTOP_REWORK.md` 中同一批已删除产品的残留描述也已清理。

`patch_wind_forecast.js / patch_wind_await.js / patch_wind_fhours.js / patch_wind_blocking.cjs` 被保留，因为它们针对普通风衰减/地形阻挡补丁，并非旧“风场气压形势图”产品实现，本轮没有将其作为参考代码使用。

## 版本

`package.json`、README 顶部与 `index.html` 页面标题更新到 5.2.29。

## 验证状态

本轮实际验证结果记录在 `VALIDATION_5.2.29.md`。专用 `npm run test:synoptic`、Round 77 延迟预报重建回归与 AETHER 集合引导数值回归均通过；新增/修改 TypeScript 文件也通过 TypeScript `transpileModule` 语法诊断，并对新增纯 TS 模块进行了独立语义类型检查。由于用户提供的源码包不含 `node_modules`，本环境无法完成依赖解析后的全仓 `npm run lint` 与 Vite 构建，也无法启动浏览器生成真实成品 PNG 做 SSIM/并排视觉验收；这些未执行项没有被标记为通过。
