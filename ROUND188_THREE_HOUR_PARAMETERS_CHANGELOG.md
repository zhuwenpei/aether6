# Round188 — “真实化参数”三小时折线节点

基线：AETHER 6.0.49 R187（卡努目标真实化优化版）。本轮保留版本号 `6.0.49`。

## 设计变更

用户明确要求**取消之前的路径真实化机制**。已经删除 R186/R187 使用的路径分段趋势重建、角度旋转优化、平滑波动、24 小时均速预算、未来物理积分速度扰动及其旧源码和旧测试入口；此后主模拟会直接使用其原有移动积分，不再因该功能对未来速度做扰动。

新入口 **“真实化参数”** 位于桌面/移动版“更多”菜单。应用前通过原生于项目的对话框确认（仍使用 R184 的输入/键盘环境，不恢复 R185 Provider）；可取消，可撤销，可保存后恢复。

- 将风速 `vmax`、中心气压 `pmin`、移速 `speed`、移向 `direction`、最大风半径 `rmw`、7/10/12 级风圈象限，以及主要**瞬时**结构和环流参数，每 **3 模拟小时**取一个节点；非节点的逐小时数值均为两个相邻节点之间的线性插值。
- 角度沿最短方向插值（如 359° 到 1°，不经过 180°）；跨日期变更线的经度也按最短位移计算。
- 在每个完整 3 小时路径节点采用带种子的、沿路径法向的**小幅偏移**，轻/标准/较明显三档的最大理论幅度分别是 1.25/2.7/4.5 km（偏移方向随机且实际绝大多数更小）；中间时刻连直线。起点、末端、已判断有登陆变化的节点不偏移，海陆翻转则放弃该节点偏移。
- 保留所有逐小时 `history` 记录及原时间轴（`simHour`）。这是一种**每三小时节点、逐小时存储**的表示形式，不删除历史时刻，也不产生三小时台阶保持（zero-order hold）。
- 气压/风速/移速折线在 `TyphoonReport` 使用 `linear` 与显式三小时点；图表禁用只针对旧曲线的展示层随机抖动。`TyphoonReportModal` 的科学图取消自带噪声线并画节点直线。
- 站点诊断依照改变后的路径与气象量逐小时分批重算。原始可观察量写入可撤销日志，成功后一次性更新程序状态；中断或报错不改变原状态。
- 删除已弃用的 `RealisticMotionGeometry.ts`、`RealisticMotionApply.ts`、`RealisticMotionJournal.ts`、`RealisticMotionDialog.tsx`，由 `RealisticParameter*` 替代。旧格式 `realisticMotion.version=1` 仅用于存档导入兼容及旧记录的还原；新记录格式为 version 2。旧配置 `realisticMotionEnabled` 仅兼容读入，主引擎不会读取。

## 数值范围与例外

“所有参数”限定为**可用于直接显示的瞬时台风数值**。不会修改模拟的计时器、生命周期累计量、发生过的事件、伤亡累计、概率引擎的 PRNG 状态、自动控制器的积分记忆或类别/登陆布尔状态。原因是这些变量不是连续的观测曲线，不可用三小时数值线性插值而不破坏物理一致性。

继续模拟时，为保证原物理引擎不被更改，新增历史仍按原算法产生；如要把续跑后的时段也处理为三小时折线，需再次执行“真实化参数”。此行为与 R186/R187 的持续速度扰动**不同**。旧存档打开不自动改变路径。

## 涉及源码

- 新增 `src/simulation/RealisticParameterGeometry.ts`、`RealisticParameterApply.ts`、`RealisticParameterJournal.ts`、`src/components/RealisticParameterDialog.tsx`
- 修改 `src/App.tsx`、`src/simulation/Engine.ts`、`src/simulation/DrawnTrackBranch.ts`、`src/types.ts`、`src/utils/SimulationArchive.ts`
- 修改 `src/components/TyphoonReport.tsx`、`TyphoonReportModal.tsx`、`AetherDesktopChrome.tsx`、`AetherMobileChrome.tsx`
- 新增 `scripts/round188_parameter_nodes_regression.cjs`、`package.json` 中 `test:round188-parameters`
- 删除直接依赖废弃路径算法的旧 R185/R186/R187 几何回归脚本入口和算法文件；历史版本日志保留供版本追溯

## 验证情况

专项：`npm run test:round188-parameters`，两份用户真实存档及合成数据通过 29 组检查（3h 折线、风圈、端点、确定性、原历史不变、应用/撤销/取消、存档往返及非法数值校验）。

其他回归：`test:round180`（NMC）、`test:round185-ensemble-intel`、`test:round185-strike-endmode`、`test:round185-archive-presim` 通过。`test:drawn-track` 旧脚本缺失 `src/components/TyphoonStatusCard.tsx` 测试目标，无法作为通过项。

环境缺少 npm 前端依赖（React、Vite、Recharts），故**不能声称完整 Vite 构建或真实浏览器联动已通过**。未对每种气象产品的全部组合进行像素级回归。
