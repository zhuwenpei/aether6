# ROUND99 CHANGELOG — 冷空气同相到达 / 非线性减弱 / 风场预览响应性修复

版本：AETHER 6.0.22
日期：2026-10-03

## 本轮修改

1. **冷空气到达时间重新定义为真实中心接触时刻**
   - 撤销 ROUND98 的 `+1.5h` 中心接触延迟。
   - 快捷工具设置的 `forcedColdAirArrivalHour = T` 现在就是冷空气强风前锋抵达台风中心的时刻。
   - `SynopticWindField` 与 `Engine` 继续共用 `ColdAirTiming`，但共享延迟常量恢复为 `0h`，避免风场图和强度响应再次分离。
   - 在 `T` 时刻，冷空气强风前锋位于台风中心；随后继续独立向南推进。

2. **40 kt 强冷空气对台风的减弱负荷降为原来的 80%**
   - 第 3 档风场本身仍保持约 `40 kt` 海面强风，不修改气象图上的冷空气风速。
   - 仅将第 3 档施加到台风上的直接减弱、对流抑制和结构破坏负荷缩放为原来的 `0.80`。
   - 第 1、2 档强度响应保持原尺度。

3. **冷空气减弱改为快速“先慢后快”的非线性曲线**
   - 接触瞬间先出现较轻的响应，避免一步跳到最大衰减。
   - 约前 0.5h 影响仍较弱，随后在约 1–1.7h 内快速加速到接近完整影响。
   - 使用凸型幂函数 onset，而不是线性或立即硬压制；强制负趋势与 RI/增强抑制也随同一连续 pulse 增长。

4. **风场气压预览生成改为协作式主线程计算**
   - `WindBoundaryLayerSolver` 新增约 8ms 时间片切分，在压力梯度、主迭代、散度、Poisson 投影和诊断阶段主动让出主线程。
   - `SynopticWindField` 的海陆距离场、海岸带、开阔海域权重、地形尾流和海岸平滑改为可等待的分块计算。
   - 风速 raster、MSLP 重采样、极值扫描、海岸线绘制、marching-squares 等压线生成/拼接均增加更细粒度 yield。
   - 数值计算顺序和结果公式不变；仅改变任务调度，避免手机 UI 长时间失去响应，同时让实时固定步进模拟有机会继续执行。

5. **重型预览前后双重保存模拟进度**
   - 开始生成风场图/视频前，App 立即从实时 refs 保存一次模拟状态。
   - 生成结束或取消后再次保存，因为协作式生成期间模拟可能已经继续推进。
   - 降低移动端因页面回收、切后台或返回产品界面而恢复到旧模拟进度的风险。

## 涉及文件

- `src/simulation/ColdAirTiming.ts`
- `src/simulation/SynopticWindField.ts`
- `src/simulation/Engine.ts`
- `src/simulation/WindBoundaryLayerSolver.ts`
- `src/utils/SynopticWindPressureMap.ts`
- `src/components/ForecastImageModal.tsx`
- `src/App.tsx`
- `src/types.ts`
- `scripts/round92_cold_air_land_wind_regression.cjs`
- `scripts/round97_coastline_cold_air_passage_regression.cjs`
- `scripts/round98_cold_air_timing_name_sync_regression.cjs`
- `scripts/round99_cold_air_performance_regression.cjs`
- `package.json`

## 验证

- 102 个 `src/**/*.ts` / `src/**/*.tsx` 文件 `transpileModule`：0 个语法错误。
- ROUND99 专项回归通过。
- ROUND98 名称同步兼容回归通过。
- ROUND97 冷空气移动/海岸线回归通过。
- ROUND96、ROUND94、ROUND93、ROUND92、ROUND89、ROUND87 回归通过。
- 非线性 onset 数值抽查：接触时约 `0.008`，+0.5h `0.117`，+1.0h `0.372`，+1.5h `0.787`，+1.7h 达 `1.000`；后段增幅明显快于初段。
