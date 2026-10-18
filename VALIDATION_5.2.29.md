# AETHER 5.2.29 验证记录

## 已实际运行并通过

1. `npm run test:synoptic`
   - 产品类型、侧栏入口、按需生成、阶段进度、取消、下载文件名与标题模板静态断言通过。
   - 参考图存在且尺寸为 1536×1024。
   - 新物理/渲染模块无 `Math.random()`。
   - Holland 中心 `pmin`、南北半球环流方向、右半圆移动不对称、r7/r10/r12 锚点、陆/海 10 m 风折减比、Powell 型高风阻力饱和、日界线 wrap、求解器有限值与逐字节确定性数值检查通过。
   - 全场 `pmin` 中心格点钉住、最低压下限以及求解后 `vmax/localMax` 校准存在源码级防回退断言。
2. `node scripts/round77_deferred_forecast_reconstruction_regression.cjs`
   - 通过；版本断言同步为 5.2.29。
3. `node scripts/aether_guidance_numeric_regression.cjs`
   - 通过：`centers=8 members=100 endSpread=1294km`。用于确认新增产品没有破坏现有 AETHER 集合引导核心数值回归。
4. TypeScript 5.8.3 `transpileModule` 语法诊断
   - `ForecastImageModal.tsx`、`SurfaceDragPhysics.ts`、`SurfaceRoughness.ts`、`TropicalCycloneVortex.ts`、`WindBoundaryLayerSolver.ts`、`SynopticWindField.ts`、`SynopticWindPressureMap.ts` 全部无语法诊断。
5. 新增纯 TS 模块的独立语义类型检查
   - 使用 TypeScript 5.8.3 对 `SurfaceDragPhysics.ts`、`SurfaceRoughness.ts`、`TropicalCycloneVortex.ts`、`WindBoundaryLayerSolver.ts`、`SynopticWindField.ts`、`SynopticWindPressureMap.ts` 做独立 `tsc --noEmit` 检查；本轮新增模块本身没有诊断。
   - 该独立检查继续追踪到旧 `Engine.ts` / `NaturalEarthLoader.ts` 后会遇到原项目已有严格模式诊断和缺失的 `@turf/turf` / `rbush` 类型，因此不能把它等同于完整仓库构建。
6. 参考图色标复测
   - PIL 确认原图为 1536×1024；x=1437、色条 y=100–983 的 20 档中心采样与代码 LUT 一致，顶端帽尖端采样为 `#17090a`。

## 已运行但受源码包依赖缺失阻塞

- `npm run lint`（项目脚本为 `tsc --noEmit`）：未完成完整依赖解析。用户提供的源码包没有 `node_modules`；当前报错首先集中在 `react`、`react/jsx-runtime`、`lucide-react`、`recharts`、`leaflet`、`react-leaflet` 等模块/类型找不到。修改过的 `ForecastImageModal.tsx` 在这次运行里仅出现上述外部模块/JSX runtime 缺失；新增纯 TS 模块没有出现在该次诊断列表里。
- `npm run build`：无法启动，`vite: not found`，原因同样是依赖未安装。
- 当前环境不能补装依赖：`npm view react version --fetch-timeout=5000 --fetch-retries=0` 返回 `EAI_AGAIN getaddrinfo registry.npmjs.org`。此前 `npm install --ignore-scripts` 也没有形成可用 `node_modules`。因此没有把“安装依赖后的全仓 tsc / Vite 构建”标记为通过。

## 本环境尚不能完成的视觉验收

真实成品 PNG 必须在浏览器 Canvas + 完整项目依赖环境中由新增物理管线实际计算后生成。由于本次源码包无法启动 Vite，本轮没有伪造 `compare_*.png`，也没有宣称已完成 SSIM。

安装依赖后应以约 19°N、116°E、约 913 hPa 的强台场景生成 1536×1024 产品，再与 `docs/reference/synoptic_reference.png` 并排核对：标题三处文字位置、色标与上下端帽、`20°N/110°E` 标签、`L` 与中心气压、外围等压线疏密、海陆风速反差、山地斑块和高地小闭合圈。
