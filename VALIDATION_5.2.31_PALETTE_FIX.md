# AETHER 5.2.31 风场图例精确取色补丁验证

## 像素取色验证

以用户上传参考图 104×992 px 为源，按色标主体 y=70..950、2 kt=22 px 的几何关系，在每个 2 kt 色块中点使用 x=10..28、y±3 的像素区域取 RGB 中位数。

代码中的前 40 个 `KT_COLORS` 与重新从参考图计算得到的 40 个色块 **40/40 完全一致**。

## 回归

- `node scripts/synoptic_wind_pressure_regression.cjs`
  - `synoptic numeric 5.2.31 palette-fix: PASS`
  - `synoptic_wind_pressure_regression 5.2.31 palette-fix: PASS`
- `node scripts/round77_deferred_forecast_reconstruction_regression.cjs`
  - `Round 77 deferred forecast reconstruction regression: PASS`
- TypeScript 5.8.3 `transpileModule` syntax check：
  - `SynopticWindPressureMap.ts syntax transpile: PASS`

本补丁不包含用户参考 PNG，不改变正式包的参考图清理规则。
