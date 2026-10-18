# AETHER 5.3.0-M3 雷达观测算子 / 虚拟站网 / 成像伪影实现与自测报告

## 1. 基线与阶段边界

基线：`AETHER_5_3_0_M2_radar_prognostic.zip`。

本阶段严格限定为 M3：

- `src/radar/RadarObservation.ts`
- `src/radar/RadarArtifacts.ts`
- `src/radar/RadarStationNetwork.ts`
- 为上述模块补充 `RadarTypes.ts` / `RadarConfig.ts` 公共类型与常量
- 新增 M3 回归与彩色调试输出

没有进入 M4 的 `RadarBasemap / RadarLegend / RadarEngine`，没有接 `ForecastImageModal`，没有新增正式产品底图/省界/地名/图例；也没有进入 M5 的 Worker、WebCodecs/MP4、入口 B/C。

## 2. 新增 / 修改文件

### 新增

- `src/radar/RadarStationNetwork.ts`
- `src/radar/RadarObservation.ts`
- `src/radar/RadarArtifacts.ts`
- `scripts/radar_m3_observation_regression.cjs`
- `artifacts/radar_m3_debug/m3_color_reflectivity.png`（M3 调试预览，不是 M4 正式产品）

### 修改

- `src/radar/RadarTypes.ts`
- `src/radar/RadarConfig.ts`
- `package.json`
- `MODIFICATION_NOTES.md`

## 3. RadarObservation：Z–R 与线性 Z 合成

按规格实现三类 Z–R：

- 对流：`Z = 300 * R^1.4`
- 层状：`Z = 200 * R^1.6`
- 热带暖雨：`Z = 250 * R^1.2`

M2 的 `q` 作为雨率输入，`convectiveFraction` 决定对流/层状混合；暖雨只在暖海面、低对流占比、非极端雨率时占一小部分。不同降水分量先分别转线性 Z，再相加。多个仰角、多个雷达站也都在线性 Z 域比较/合成，最后才转 dBZ。

提供：

- `precipitationToLinearZ()`
- `linearZToDbz()` / `dbzToLinearZ()`
- `computeRadarObservation()`
- `sampleObservationDbzAt()`
- `radarObservationDiagnostics()`

## 4. 三种反射率模式

### ground

近地层诊断反射率；保留虚拟站网覆盖约束，但不做波束高度截断。

### base05

使用单一 0.5° 仰角：

- 4/3 地球半径
- 1° 波束宽度
- 波束上下包络
- 根据回波顶高计算部分波束填充
- 远距离浅薄回波自然消失

### composite

对每个虚拟站使用：

`0.5° / 1.5° / 2.4° / 3.4° / 4.3°`

逐仰角计算后取最大 Z，再跨站取最大 Z。

层状区开启 `brightBandEnabled` 时，波束中心经过约 5 km 融化层可增加约 3–6 dBZ。

## 5. 波束分辨率近似

没有对最终图像做强高斯模糊。每个站点观测在原始线性 Z 场上按：

- 径向库长：1 km
- 方位高斯尺度代理：`0.425° * r`

使用中心 + 径向两点 + 方位两点的五点加权近似，让远距离波束自然变宽，同时保留 M2 细胞边缘。

## 6. 虚拟雷达站网

`RadarStationNetwork.ts` 从现有 `src/utils/stations.ts` 城市目录筛选中国沿海城市 / 省会城市；对于目录未导出但规格要求覆盖的部分沿海地级市 / 省会，用城市中心坐标作补点。

重要约束：

- 每个站都标记为 `虚拟站网（模拟）`
- sourceLabel 明确写出“不代表真实 CINRAD 台址”
- 不使用真实 CINRAD 台站名称/编号/型号冒充业务站
- 最大探测半径：460 km
- 有效回波半径：由站点 ID 的确定性哈希落在 230–300 km
- 当前总虚拟站：80
- 提供 `selectRadarSitesForDomain()`，只选择可能影响当前动力域的站点，避免无关站进入百万网格计算

## 7. RadarArtifacts

### 晴空杂波 / 异常传播

站点约 40–120 km 内产生 5–15 dBZ 浅色点状/扇区纹理；夜间/清晨更容易出现，地表粗糙度会调制概率，有明显降水时不覆盖强回波。

### 海杂波

海面、台风强风区可出现 5–12 dBZ 稀疏点；强度取决于涡旋切向风与显式伪影参数。

### 地形波束遮挡

不是画固定楔形。每个站按 360 个方位，沿径向地形逐步建立“地形地平线斜率前缀”，再把实际波束高度和地形遮挡角比较；高山脊后方自动形成扇形衰减。

### 干扰线 / 太阳尖峰

每帧 0–2 条，显式 seed + 体扫时间桶决定；强度约 35–60 dBZ，宽度亚公里到约 1 km（受动力网格分辨率下限约束），日出/日落附近优先采用太阳方向代理。

### 缺测 / 缺扇区

每个虚拟站可确定性出现整站缺测或局部扇区缺测。观测场保存第二优站，因此首选站缺测时能回退到第二站，而不是简单把所有重叠覆盖区挖空。

### 站网边缘

有效半径外到 460 km 之间逐渐失配，并由 `coverageEdge` 把边缘压陡，可形成海上弧形站网边界。

### strict-realism 体扫错位

每站按体扫时间桶产生约 ±2 km 以内的决定性平移，模拟相邻站约 ±1–2 min 时差导致的轻微拼接错位。

## 8. 色表与量化

M1 已建立全新 CMA / NWS / classic-green 色表；M3 现在真正接到观测场：

- `< 5 dBZ` 完全透明
- 5 dBZ 一档离散量化
- 最高显示档限制到 75 dBZ
- 提供 `radarColorForDbz()` 与 `renderRadarObservationColorized()`

M3 彩色调试图只显示回波，没有正式地理底图、行政边界、城市名和图例；这些严格留给 M4。

## 9. M3 数值回归

命令：

`npm run test:radar-m3`

当前结果：

`radar-m3 observation regression: PASS (sites=80, domainSites=32, covered=99.9%, visible=89.6%, max=58.0 dBZ, artifactsChanged=62.4%)`

回归覆盖：

- 三套 Z–R 公式精确数值检查
- 线性 Z ↔ dBZ 往返
- `<5 dBZ` 隐藏与 5 dBZ 离散量化
- CMA 45–50 dBZ 色阶
- 虚拟站最大 460 km / 有效 230–300 km
- ground / base05 / composite 三种产品
- 350 km 远距浅薄层状回波：ground 保留、0.5° 基本反射率因波束抬升消失
- 约 230 km 距离、约 5 km 波束高度附近亮带增益
- composite 几乎处处不低于 base05
- 地形遮挡、缺测、杂波、干扰、覆盖边缘等伪影会改变观测场
- 同 seed 两次伪影结果逐元素完全一致
- 彩色 RGBA 输出有效

## 10. 已有回归

全部通过：

- `test:radar-m0`
- `test:radar-m1`
- `test:radar-m2`
- `test:radar-m3`
- `test:release-ui`
- `test:synoptic`

旧实现禁用符号继续 0 命中；`src/radar` 继续没有 `Math.random()`。

## 11. TypeScript 全工程检查

交付环境仍和 M2 一样缺少项目 npm 依赖，因此不能把完整 `tsc --noEmit` 声称为 PASS。

对未修改 M2 与 M3 使用同一命令：

- M2：145 行诊断，141 个归一化唯一诊断
- M3：145 行诊断，141 个归一化唯一诊断
- M3 新增诊断：0
- M3 移除诊断：0

M3 自身及其依赖的纯数值 TypeScript 模块由回归脚本直接调用当前 `tsc` 编译，编译为 0 错误并实际执行。

## 12. 当前视觉状态与后续边界

M3 的彩色调试图已经是真实经过 Z–R / 波束 / 站网 / 伪影算子的 dBZ，不再是 M2 灰度雨率图。但当前 M2 调试台风的雨率场本身非常湿、覆盖率高，所以彩色预览会比最终参考图更“满”和更偏黄橙；本阶段没有为了做漂亮截图去篡改 Z–R。

M4 会加入正式底图、行政边界、地名、图例、强度标注和统一 `RadarEngine`；M6 再按用户给出的 13 张参考图系统调 M2/M3 参数与结构统计。

## 13. 下一阶段

M4：

- `RadarBasemap.ts`
- `RadarLegend.ts`
- `RadarEngine.ts`
- 入口 A：`ForecastImageModal` → 「雷达回波图」
- 1302×1260 近方形正式产品首图
