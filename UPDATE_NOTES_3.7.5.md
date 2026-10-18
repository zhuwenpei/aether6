# TyphoonSIM 3.7.5 更新说明

## 干空气入侵

- 新增 `dryCoreLifecycleRetention`：把干空气从“只有方位缺口”改成“方位缺口 + 内核平均热力学衰弱”。
- 湿侧 `dryMoistSectorSupport` 上限降到 1 以下，不允许干空气事件反而生成比完整内核更强的补偿性大对流团。
- `dry_leaf` 的红外残余冷云头缩小，整体 CDO 明显衰弱；真正再组织时才进入 `dry_rebuilding_core`。
- `asymmetricReburstStrength` 只有进入 `reorganizing` 且再湿化、核心连接的干空气减弱后才允许明显增长。
- 干空气后的极端内核单体概率、面积和强度额外受生命周期约束。

## 卫星—雷达解耦

- CDO 冷云罩不再充当密集降水核心半径。
- 雷达结构底值从可制造 50+ dBZ 完整环，改为仅维持约中等回波的眼墙连续性。
- 宽广暖雨背景的 >42 dBZ 部分被压缩；45–55 dBZ 主要由局地 `coreExtremeCell`、`bandExtremeCell`、`convectiveBurst` 保留。
- 干空气 `asymmetric_collapse` / `residual_vortex` 内核额外降低回波，避免截图中那种一侧突然膨胀成大片红/紫色。

## 增强时核心尺度

- RI 不再直接触发 large-inner-core heavy-rain pathway。
- 密集降水核心半径以 RMW、核心紧致度为主，不再按 CDO 半径放大。
- 增强时 RMW target 只能收缩或保持，外围环流扩张不再使 RMW 同步增大。
- RMW 强度气候关系在高强度段趋平，体现“早期收缩完成后，强度仍可继续上升”。
- RI 期间 CDO target 不允许因为 RI 本身向外扩张；已有高层云砧仍可滞后存在。
- 干空气后重建核心目标范围由 20–50 km 收紧为约 20–44 km。

## 回归测试

新增 `scripts/core_structure_regression.ts` / `npm run test:core`，覆盖：

- 完整强台风 vs 干空气内核坍塌的平均雨强；
- >=24 mm/h（基础 Z–R 下约对应高反射率关注区）的面积占比；
- 干空气事件是否产生高于完整内核的补偿性极值；
- 再组织阶段是否保持“小核心 > 外围”的径向集中度。
