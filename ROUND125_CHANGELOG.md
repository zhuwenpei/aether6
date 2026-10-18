# ROUND125_CHANGELOG

## 目标
继续校正 HMON / HWRF 两个新风场样式中的 50 kt 三角旗。用户提供的对比图显示：程序生成的旗型相对标准参考图过高、过胖，并且多个旗沿主杆排列过松。

## 修改
仅调整 50 kt pennant，不改变 10 kt / 5 kt 羽片、风标网格、色阶或预报物理。

- `pennantNormal`: `9.55` → `6.35`
  - 将旗型法向高度压低约 33.5%，使三角旗明显更扁。
- `pennantBase`: `6.30` → `4.75`
  - 缩短旗型沿主杆的基底长度约 24.6%。
- `pennantApexBack`: `3.05` → `2.30`
  - 保持旗尖基本位于缩短后基底的中部，避免旗型偏斜。
- `pennantAdvance`: `6.95` → `4.95`
  - 将多旗之间的推进距离压缩约 28.8%。
  - 相邻旗之间只保留约 `0.20` 的主杆间隙，视觉上接近连续紧排。

## 保留不变
- ROUND124 的风标整体放大 `1.18x`。
- HMON / HWRF 风标不透明度 `0.64`。
- 10 kt 完整羽片、5 kt 半羽片角度和长度。
- ROUND122 REDO 的参考色阶与规则网格。
- ROUND124 的站点风眼曲线、JMA Best Track / 向日葵 3 小时信息刷新修改。

## 验证
新增：
- `scripts/round125_pennant_flatten_regression.cjs`

同时运行 Round 122 REDO、123 REDO、124 和 TypeScript 静态转译检查。
