# AETHER 5.2.31 验证记录

本文件只记录本轮实际执行过的检查。

## 已通过

1. `node scripts/synoptic_wind_pressure_regression.cjs`
   - PASS：`synoptic numeric 5.2.31: PASS`
   - PASS：`synoptic_wind_pressure_regression 5.2.31: PASS`
   - 覆盖北半球逆时针环流、四象限风圈锚定、强台风内核不被单边压扁、弱化后的陆面摩擦、高风速海面阻力饱和、完整边界层迭代、确定性、日界线连续性，以及新增的地形尾流动量减风。
   - 静态覆盖 ETOPO 2022 约0.10°地形缓存、环境流增强/屏蔽减弱、等压线鞍点渐近判别、视频相对/绝对时效修复、240帧选项和预报损伤/恢复状态物化。
2. `node scripts/round77_deferred_forecast_reconstruction_regression.cjs`
   - PASS；确认 5.2.28 以后延迟预报强度重建架构没有被本轮修改破坏。
3. `node scripts/aether_guidance_numeric_regression.cjs`
   - PASS：8 centers / 100 members，集合引导数值链未被破坏。
4. TypeScript 5.8.3 `transpileModule` 语法检查
   - PASS：本轮修改的 10 个 TS/TSX 文件均无语法诊断。
5. `tsc --noEmit`
   - 已实际执行。交付包没有 `node_modules`，因此全仓命令退出码为 2；本轮文件中只出现 React、lucide-react、recharts、mp4-muxer 等依赖模块/类型缺失，没有出现其它本轮代码内部类型错误。

## 数值重点

- 35 m/s 平原来流通过完整 0.125° 边界层迭代后仍需保留足够动量，10 m 风不能因重复摩擦坍塌。
- 人为极端不均匀四象限风圈下，强台风 60 km 内核仍要求四象限合成风速比保持受控，避免单侧直墙。
- 新增合成地形尾流场，在同一动量求解器中要求背风区速度低于无尾流基线，同时下游不能形成永久静风。

## 当前环境无法闭环的项目

- 未安装 `node_modules`，因此无法在本环境完成 Vite 实际构建和浏览器 Canvas/视频成品渲染。
- NOAA ETOPO 2022 高分辨率地形采用浏览器运行时 ERDDAP 加载；当前容器没有对外 DNS，无法在这里预下载并打包实际瓦片。代码保留确定性内置地形回退。
- 用户提供的 Windy 图片用于视觉/物理特征校准；没有伪造“与 Windy 像素一致”的验证结论。最终视觉效果仍建议在安装依赖后，用相同台风状态分别生成热带阶段、近山地登陆、温带化阶段和长时效视频进行 A/B 对比。
