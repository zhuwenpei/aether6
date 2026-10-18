# TyphoonSIM 2.4.12 更新说明

## 目标

本版根据用户提供的 2026 年 BAVI / DOLPHIN 多时次 Himawari-9 Band 14 增强红外图，重点重做“巅峰完整结构—外围干槽侵蚀—内核被突破—干菜化/蚊香化—小核心重建”的连续结构演变，而不是只根据风速切换几个固定云图模板。

用户提供的参考图可归纳为三类典型场景：

1. **完整巅峰结构**：清晰暖眼、闭合眼墙、100–150 km 量级中央密集云团（CDO），内核冷云覆盖连续，外围雨带仍具有明显空隙和离散对流单体。
2. **干空气侵蚀/结构散架**：干槽先绕入外围雨带，随后在风切/通风配合下侵入内核；眼墙只在部分象限先塌陷，CDO不再均匀，出现大尺度叶瓣、空槽、残余冷云团和单条/少数螺旋带，但外侧风环流并不会同步缩小。
3. **干侵入后的恢复小核心**：环境重新湿润后先恢复 20–50 km 直径的松散小核心，外围仍是很大的旧环流；对流会脉动、偏心、时强时弱，不能直接恢复为原来 100–150 km 的完整成熟 CDO。

## 机制修改

### 1. 干空气从“一维数值”拆成外围与内核两层

新增持久状态：

- `dryAirIntrusion`：环境/外围环流中的干空气程度；
- `dryAirCoreExposure`：真正进入受保护内核的干空气比例；
- `moistCoreProtection`：眼墙/湿润内核对外围干空气的保护能力；
- `dryErosionHours`：内核受干空气侵蚀持续时间；
- `dryRecoveryHours`：内核重新转入湿润恢复后的时长；
- `drySlotBearingDeg`：主干槽方向，具有数小时连续记忆；
- `rebuiltCoreDiameterKm`：干侵入后重建的小核心直径。

外围干空气强并不等于眼墙立即瓦解。只有当风切/通风足够强、核心保护降低后，`dryAirCoreExposure` 才快速上升。

### 2. 新增 dry_slot_eroding 过渡阶段

当外围干空气已经卷入、但内核尚未完全失守时，进入 `dry_slot_eroding`：

- 干槽先在约 50–100 km 的湿润保护圈外侧出现；
- 干槽随半径向内呈旋卷，而不是切掉一个笔直扇区；
- 内核暴露较低时可以继续保持闭合或近闭合眼墙/CDO；
- 内核暴露继续升高后，干槽才逐渐切入一个眼墙象限。

### 3. 干菜化不再是随机“碎点”

`dry_leaf` 现在保留 2–3 个几十到数百公里尺度的残余对流叶瓣，并由一个或两个旋卷干槽切开；外围风环流仍维持宽广。这样更接近增强红外图中“大块冷云残片 + 大块暖/干槽”的结构，而不是全域像椒盐噪声一样破碎。

### 4. 蚊香化保留为特殊而非默认干空气形态

`incense_coil` 只在内核已经明显受侵蚀、核心紧实度低且雨带占主导时出现，表现为一条窄而弯曲的主要螺旋深对流带；普通外围干空气不会直接触发该形态。

### 5. 小核心重建尺度

干空气退出后：

- 新核心目标直径限制在 **20–50 km**；
- 核心可以偏心、部分闭合并以 2–5 小时时间尺度脉动；
- 大外围环流不会随小核心建立而突然收缩；
- 在后干空气记忆期内压制快速再次爆发，只有长期恢复后才允许重新形成成熟 CDO。

### 6. 成熟 CDO 和眼墙尺度统一

- 成熟 CDO：**100–150 km 直径**；
- 实时云图 MapView 旧代码误把 125–285 km 当作 CDO“半径”，本版改为按 `cdoDiameterKm / 2` 即 50–75 km 半径；
- 眼区、眼墙宽度和雨带半径仍独立演化，不把整个台风云系都当成 CDO。

### 7. 雨带视觉结构

SatelliteCloudModal 的雨带由连续正弦环改为：

- 宽的螺旋雨带走廊；
- 沿走廊离散的冷云对流单体/簇团；
- 后段较弱层状云；
- 雨带之间保留更宽的无云/弱云间隙。

### 8. 干空气与外环流解耦

外围中层干燥会快速压制外雨带深对流，但并不要求低层风环流同步缩小。Engine 在干空气阶段允许 `circulationExpansion` 维持或上升，从而形成“云系散架、核心变小，但大环流仍很宽”的状态。

### 9. 降水同步

PrecipitationModel 同步使用 `dryAirCoreExposure`、`moistCoreProtection` 和 `drySlotBearingDeg`：

- 早期外围干槽不会自动抹掉完整眼墙/CDO降水；
- 真正内核侵入后才显著削弱核心结构因子；
- 小核心重建阶段继续使用局地、脉动的内核降水，而非瞬间恢复大 CDO。

## 资料依据

1. NOAA/NHC Glossary — Central Dense Overcast：CDO 是覆盖眼墙或最紧密内雨带的密集云团。
   https://www.nhc.noaa.gov/aboutgloss.shtml
2. Velden et al. (2006), *The Dvorak Tropical Cyclone Intensity Estimation Technique*：Dvorak 直接使用 CDO、embedded center、curved band、shear 等卫星云型判读强度和结构。
   https://www.nhc.noaa.gov/pdf/velden06.PDF
3. Braun et al. (2012), *The Impact of Dry Midlevel Air on Hurricane Intensity in Idealized Simulations with No Mean Flow*：干空气只有接近/进入内核后才显著抑制发展；湿润保护圈可以隔离外侧干空气，干侵入会造成持续的对流非对称并把加热移出高涡度内核。
   https://journals.ametsoc.org/view/journals/atsc/69/1/jas-d-10-05007.1.xml
4. Wang (2019), *Impact of Dry Midlevel Air on the Tropical Cyclone Outer Circulation*：外侧中层干燥可快速压制外雨带湿对流，同时促进外侧主环流扩张，因此“云系减弱/破碎”不等于“风环流立刻缩小”。
   https://journals.ametsoc.org/view/journals/atsc/76/6/jas-d-18-0302.1.xml
5. Fischer et al. (2023), ventilation ensemble study：干空气推进内核时可造成一个象限湿度显著下降和眼墙塌陷；干侵入消退后，最内约 50 km 可重新恢复湿润环。
   https://journals.ametsoc.org/view/journals/mwre/151/1/MWR-D-22-0037.1.xml
6. NOAA/AOML Rainband Structure Experiment：典型雨带约 5–50 km 宽、100–300 km 长，雨带之间的无降水间隙往往与雨带同宽或更宽。
   https://www.aoml.noaa.gov/hrd/HFP99/HFP99.pdf
7. Knaff et al. / AMS eye climatology：新形成眼的中位直径约 33 km，75% 小于约 46 km；RMW 在形成眼时通常约 20–56 km，但存在更小或更大的个例。
   https://journals.ametsoc.org/view/journals/mwre/140/5/mwr-d-11-00108.1.xml

## 验证

按既定要求，本轮未执行 npm、npx、npm install、npm run 或 npm build。

仅使用环境中已经存在的 TypeScript 编译器执行：

```text
tsc -p tsconfig.json --noEmit --noCheck
```

用于检查 TypeScript / TSX 语法完整性。
