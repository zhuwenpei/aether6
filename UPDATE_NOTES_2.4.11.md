# TyphoonSIM 2.4.11 更新说明

## 本轮目标

本轮针对 2.4.10 用户实测图继续校正三个问题：

1. 完整、超强的台风登陆时，最高累计降水不应长期被一个偏置外围雨带取代；成熟 CDO/眼墙过境应仍是主要强降水核心之一。
2. 普通沿海强雨带可以制造独立暴雨中心，但通常不应铺出数十至数百公里宽的 600–800 mm 面积；极端 800 mm 更应是极少数点状/小尺度训练结果。
3. 平原上的 8 级热带风暴软平台需要真正落到最终强度积分上，并在约 18 m/s 停留一段时间；同时保留湿润大环流、沿海水汽输送和丘陵抬升产生的暴雨。

## 1. 完整 CDO / 眼墙重新成为强台风主要高值中心

`src/simulation/PrecipitationModel.ts` 与 `src/utils/ObservedRainfallMap.ts` 现在把累计降水来源显式拆成三组：

- **core**：眼墙、成熟 CDO/中心强对流、核心热塔；
- **band**：螺旋雨带、沿海甩上岸强雨带、台前飑线；
- **broad**：外围环流、水汽辐合、层状雨盾和弥散雨盾。

当时间窗内最大风速较高、且 core 在机制累计中占主导时，24 h 高值尾部会保留更高斜率。因此，完整 60–70 m/s 级台风的 CDO/眼墙轨迹可以形成紧凑的 250–400、400–600 甚至更高的累计核，而不会因为统一的“风切偏置”把所有强降水都挪到外围。

环境垂直风切仍然能造成降水非对称，但主要逐渐作用到外围雨盾和雨带。完整内核附近保留对称保护，核心破损、干空气侵入或较强风切后保护自动下降。

## 2. 偏置强雨带：任意方位，W/NW/N 较常见，但普通事件 <400 mm

中国东部近岸场景的独立强雨带仍可出现在任意方向；概率上仅把 W、NW、N 三个象限合计提高到约三分之二，其余约三分之一为全方位自由事件，不是固定“北侧强雨”。

普通雨带深对流现在新增海岸距离衰减：

- 刚甩上岸时可以维持较强深对流；
- 向内陆推进后，深对流核心快速衰减；
- 更远处仍可留下较弱雨带/层状降水，而不是直接清零。

24 h 产品层再对 `band-dominated` 网格做机制校准：普通雨带主导的累计高值软压在约 **350–400 mm**；只有极低概率的 **5–10 km** 级短寿命 `bandHyperCell` 才允许形成少数点状 400–800 mm 极值。这样可以保留现实中极端训练单体，却避免“大面积 800 mm 雨带、核心反而不到 400 mm”的倒置。

## 3. 继续缩小 25–100 mm 大雨/暴雨范围

根据本轮对照图，2.4.10 的浅蓝/深蓝雨盾仍明显偏大。2.4.11 进一步收紧：

- 外围环流 e-folding 半径；
- 广域水汽辐合半径与雨率；
- 层状雨盾宽度与雨率；
- 弥散雨盾半径与雨率。

产品累计映射同时降低 broad/stratiform 主导格点进入 25–50、50–100 mm 的概率。真正有组织的雨带、内核和迎风地形高值不采用同样比例的削弱，因此不会简单把整张图一起变淡。

目标分布为：

**较紧凑、不规则的 25–100 mm 雨盾 → 有限 100–250 mm 叶瓣 → 小范围 250–400 / 400+ mm 核心。**

## 4. 8级平原软平台改为“最终积分级”机制

此前软平台只在陆地衰减分支里限制 `landDecay`，但后续 EWRC、西风带、结构惩罚等仍可能继续修改最终强度趋势，因此用户实测中会出现“已经到 8 级仍一路掉下去”。

2.4.11 在所有常规强度趋势计算完成后、写入新 Vmax 之前再次执行最终级平台约束，并新增：

- `plainTsShelfMemory`：0–1，记录低平、大环流、湿润、弱风切/弱干空气支持的短期记忆；
- `plainTsShelfHours`：记录约 18 m/s 平台已经持续的小时数。

关键顺序：

1. **Vmax >= 20 m/s：完全不保护**，登陆初期仍使用原正常强衰减；
2. **Vmax < 20 m/s** 后才逐渐接管；
3. 目标中心约 **18 m/s**，不是把 19–20 m/s 提前锁住；
4. 支持良好时可在平台停留约半天到一天，之后逐渐释放；
5. 水汽耗尽、进入山地、强风切、明显干空气、EWRC失败或人工目标强度要求继续下降时，平台自动退出；
6. **不修改台风平移速度**。

预报积分器同步使用同一触发顺序。

## 5. 平台期仍有暴雨；利奇马式沿海北上加强

弱到 8 级并不代表大环流立即失去降水能力。降水模型现在读取 `plainTsShelfMemory`：只要平原湿润大环流仍被支持，就会继续出现多个缓慢演变的中尺度零散强对流/暴雨中心。

沿海路径另保留三项局地加强：

- 实际海岸距离控制邻近海域的水汽馈送；
- ETOPO1 派生粗地形坡向控制迎风抬升/背风雨影；
- 有组织雨带或低空水汽通道在丘陵发生训练时形成局地高值。

因此，类似 2019 利奇马沿海北上、中心没有深扎内陆但山东中部丘陵/沿海出现持续强降水的场景，不再要求“台风中心必须直接压过降水中心”。

## 资料依据

- Yu, Z. et al., 2015: *Observed Rainfall Asymmetry in Tropical Cyclones Making Landfall over China*. Journal of Applied Meteorology and Climatology, 54, 117–136. DOI: 10.1175/JAMC-D-13-0359.1. 研究表明登陆台风降水非对称受垂直风切、海陆差异等共同影响，并非固定在单一方向；登陆后轴对称分量通常下降。
- Yu, Z. et al., 2017: *On the Relationship between Intensity and Rainfall Distribution in Tropical Cyclones Making Landfall over China*. Journal of Applied Meteorology and Climatology, 56. DOI: 10.1175/JAMC-D-16-0334.1. 研究显示弱风切条件下海岸线效应可以显著影响内外核降水非对称，强度与最大降水并非简单一一对应。
- DeMaria, M., Knaff, J. A., and Kaplan, J., 2006: *On the Decay of Tropical Cyclone Winds Crossing Narrow Landmasses*. Journal of Applied Meteorology and Climatology, 45, 491–499. DOI: 10.1175/JAM2351.1. 改进内陆衰减模型以约 110 km 环流半径和“环流在陆地上的比例”修正衰减率，说明近海/狭窄陆地区域不应按无限大陆同速衰减。
- Hlywiak, J. and Nolan, D. S., 2021: *The Response of the Near-Surface Tropical Cyclone Wind Field to Inland Surface Roughness Length and Soil Moisture Content during and after Landfall*. Journal of the Atmospheric Sciences, 78, 983–1000. DOI: 10.1175/JAS-D-20-0211.1. 数值试验显示登陆最初强风快速衰减，而降至热带风暴强度后减弱速度放慢，湿润地表潜热可支持扩大外围环流和对流。
- Gao, Y. et al., 2022: *Multi-scale characteristics of an extreme rain event in Shandong Province, produced by Typhoon Lekima (2019)*. Frontiers in Earth Science. DOI: 10.3389/feart.2022.1093545. 利奇马沿海北上时，低空急流持续输送海洋水汽，中纬度系统、多个中尺度雨带和山东中部迎风地形共同造成超过 400 mm 的极端降水。
- 中央气象台/中国天气网，2026-07-13 18时、2026-07-14 06时“巴威”预警：中心在江苏新沂、山东胶州时均报 8 级、18 m/s，并预报强度变化不大或略有增强，支持模拟中“先正常衰减、到热带风暴级后短时维持”的阶段性处理。

## 验证

按用户要求，本次修改过程 **没有执行**：

- `npm install`
- `npm run`
- `npm build`
- `npx`

仅使用环境中已有 TypeScript 编译器执行：

```text
tsc -p tsconfig.json --noEmit --noCheck
```

并对最终 ZIP 执行压缩完整性检查。
