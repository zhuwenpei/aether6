# AETHER 5.2.30 验证记录

本文件只记录实际执行过的验证；未运行的项目不标记为通过。

## 已通过

1. `npm run test:synoptic`
   - PASS：`synoptic numeric 5.2.30: PASS`
   - PASS：`synoptic_wind_pressure_regression 5.2.30: PASS`
   - 覆盖高精度选项、等压线开关、地图倍率、冻结起报时刻、视频逐帧物理重建、近岸海陆掩膜、强风陆面保留、成熟台风内核轴对称保护、登陆压力核展宽、确定性与日界线连续性。
2. `node scripts/round77_deferred_forecast_reconstruction_regression.cjs`
   - PASS；版本断言同步为 5.2.30，5.2.28/5.2.29 的延迟强度重建架构保持不变。
3. `node scripts/aether_guidance_numeric_regression.cjs`
   - PASS：8 centers / 100 members。
4. TypeScript 5.9.2 `transpileModule` 语法检查
   - PASS：本轮 8 个新增/修改 TS/TSX 文件均无语法诊断。

## 数值重点

专用回归增加一个 35 m/s 平原强风 slab 场。完整 0.125° 高精度伪时间迭代后要求边界层风速至少保留 72%，再经过陆地 10 m 换算后仍高于 32 kt。它不是对“上海青浦”硬编码风速，而是保护所有低起伏平原强风不再被数值摩擦错误耗散到 0。

另使用人为设置的极端不均匀四象限风圈检查 60 m/s 强台风的 60 km 内核，要求四象限合成风速最大/最小比小于 1.40，防止成熟内核被单侧风圈或环境场压成扁平直墙。

## 依赖环境导致未通过的全仓命令

`npm run lint` 已实际执行，但源码交付包没有 `node_modules`，因此 TypeScript 首先报 React、lucide-react、recharts、mp4-muxer 等模块/类型无法解析。针对本轮修改文件过滤错误后，只有这些缺失依赖错误，没有出现本轮文件内部的额外类型诊断。

`npm run build` 已实际执行，结果为 `vite: not found`，原因同样是没有安装项目依赖。因此这里不宣称全仓 lint/build 通过。

## 视觉限制

当前执行环境没有启动真实浏览器产品界面，因此没有伪造新的 5.2.30 Canvas 成品截图。用户提供的两张 5.2.29 输出图用于定位：近岸/陆地强风过衰减、成熟涡旋单侧陡墙、登陆等压线堆叠与整体细节不足。最终视觉效果仍需要在浏览器用同一台风状态重新生成进行对比。
