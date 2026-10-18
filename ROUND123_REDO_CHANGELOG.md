# ROUND123_REDO_CHANGELOG

## 基线
本轮从 `AETHER_6_0_39_modified_round122_redo_synoptic_reference.zip` 重新开始，上一版 Round 123 的风标羽片/旗型修改不继承。

## 重做内容

### 1. 羽片按参考图重新测量
从参考图中选择无海岸线、无等压线干扰的低风速风标重新量取：
- 1024 px 参考图中的主杆约 13–14 px；
- 完整 10 kt 羽片约 7 px；
- 将羽片向量分解到主杆坐标后，约为：
  - 法向 6.5 px；
  - 沿主杆向前 2.7 px；
- 对应羽片与主杆夹角约 68°，不是上一版接近 90° 的几何。

项目 1536 px 基准重新标定为：
- `staff = 21.00 * S`
- `fullFeatherNormal = 9.75 * S`
- `fullFeatherForward = 4.05 * S`
- `halfFeatherNormal = 5.35 * S`
- `halfFeatherForward = 2.20 * S`
- `featherSpacing = 4.20 * S`

### 2. 50 kt 旗型与羽片彻底拆分
上一实现的旗型直接复用了羽片的外端点，因此三角旗容易变成细长、向杆尖方向偏移的形状。

本轮把 pennant 单独建模：
- 主杆侧有独立 base；
- 三角旗尖端位于 base 中部附近的外侧；
- 旗型成为更宽、更稳定的实心三角形；
- 多个 50 kt 旗型沿主杆顺序排列，再继续排列 10/5 kt 羽片。

参数：
- `pennantNormal = 9.55 * S`
- `pennantBase = 6.30 * S`
- `pennantApexBack = 3.05 * S`
- `pennantAdvance = 6.95 * S`

### 3. 线条
- 保持参考图的 `butt` line cap / `miter` join；
- 线宽轻微修正为 `max(1.02 * S, 0.68)`，避免羽片在 1024 px 输出下过细。

## 未改动
- Round122 REDO 的精确风速色阶；
- 44 格等高色标结构；
- 42 px 基准规则风标网格；
- HMON/HWRF 共用色阶；
- 台风物理、路径、强度、移速、陆地判定。

## 新增回归
- `scripts/round123_redo_barb_glyph_regression.cjs`
- npm: `test:round123-redo`

## 回归兼容
- `round122_redo_synoptic_reference_regression.cjs` 仅放宽了已被本轮重新标定的风标几何常量断言；Round122 的色阶、色标和规则网格断言仍保持原样。
