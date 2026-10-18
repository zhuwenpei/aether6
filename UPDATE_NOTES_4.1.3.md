# AETHER / TyphoonSIM 4.1.3 更新说明

本版本针对用户上传的 2024 年台风“摩羯”第二次强度峰值红外/增强云图与 NMC 基本反射率图进行专项校准，重点不是把雷达“画得更弱”，而是把卫星云顶、实际降水、近地层反射率三者从同一个强度代理中彻底拆开。

## 1. 卫星 CDO 不再隐含“整片强雷达回波”

红外/增强云图中的低温、浓密、近圆对称 CDO 主要表示高层云砧、深对流外流与厚云盖的覆盖和组织度。4.1.3 中，`cdoDiameterKm` 只决定近地层降水包络和层状雨盾的尺度，不再把 CDO 白亮程度直接抬成大片 45–60 dBZ。

雷达回波强度改由以下变量联合诊断：

- Dvorak T 值 / Vmax 所约束的内核组织上限；
- RMW、七级风圈与 `coreCompactness` 共同表征的内核紧凑度；
- `eyewallIntegrity`、`deepConvectiveCoverage` 与 `convectiveBurstIndex`；
- 眼墙 / 雨带几何位置和方位连续性；
- 风切、裸露 LLCC、干空气开口、登陆/地形破坏；
- 暖海洋热带降水的小雨滴高浓度谱造成的 dBZ 偏低；
- 像素/波束内强对流填充率，而不是“只要有 CDO 就整格峰值回波”。

## 2. 新增显式层状—混合—对流雷达诊断

`PrecipitationModel.ts` 新增：

- `GroundRadarDiagnostics`
- `computeGroundRadarDiagnostics()`

该函数在返回 dBZ 的同时输出：

- `precipitationClass`: `none | stratiform | mixed | convective`
- `stratiformFraction`
- `convectiveFraction`
- `eyewallFraction`
- `rainbandFraction`

原 `computeGroundRadarReflectivity()` 保留为兼容包装层。

## 3. 摩羯式“大而强、云图极密、雷达以中等回波为主”机制

对于大环流、高强度、成熟眼墙但不是极端紧凑内核的台风：

- CDO/内雨带大部分区域默认落在约 25–40 dBZ；
- 连续眼墙主体一般为约 35–45 dBZ；
- 45–50 dBZ 主要出现在部分眼墙弧段及嵌入式雨带单体；
- 50–55 dBZ 只占很小面积；
- 不会仅因 T 值高、眼清晰、CDO 很白就自动出现 360° 55–60 dBZ 实心强环。

4.1.3 的“摩羯式”数值回归样本（68 m/s、较大风圈、260 km CDO、28 km RMW）要求全场最大 dBZ 位于约 47–53 dBZ，同时 45 dBZ 以上面积保持在极小比例，60 dBZ 以上默认为零。

## 4. 紧凑猛烈核心仍允许局地 60+ dBZ

对于极紧凑、高 T 值、眼墙完整、深对流覆盖和爆发指数都高的内核，新增极窄 `hotTower` 方位扇区：

- 60+ dBZ 不再由整圈眼墙统一抬升；
- 只在一个或两个很窄的热塔/强对流扇区出现；
- 面积占比受到强约束；
- 大体型超级台风因环流长、暖雨谱与对流质量分散，更难触发同样高的局地 Z 峰值。

内置紧凑 T8 回归样本允许约 60–65 dBZ 的局地峰值，但 60 dBZ 以上面积必须低于 0.4%。

## 5. 成熟 CDO 降水本身也加入层状占比

`computeTyphoonPrecipitation()` 新增：

- `cdoStratiformShare`
- `broadCdoConvectiveFill`
- `cdoStratiformBackground`

大型成熟 CDO 默认有更高的层状占比。强度高仍可拥有猛烈眼墙和极端短时降水，但大范围云盖下的低层降水更倾向于中等、连续的层状/混合雨，而不是整片深对流。

这使“云图很强、实际雨量很大、但基本反射率大部分仍只有 30–45 dBZ”成为允许且常见的状态。

## 6. 暖雨滴谱修正

新增 `warmRainDbPenalty`。它只作用于雷达反射率，不直接削弱雨量：

- 湿润、宽广的热带暖雨环境下，小雨滴数量很多但粒径较小，同样很大的降雨率可以只有中等 dBZ；
- 紧凑猛烈内核和强碰并增长过程可部分抵消该效应，因此仍可出现高 dBZ；
- 不再使用单一固定 Z–R 公式把所有雨量机械映射成雷达强度。

## 7. 雷达空间结构细化

本版雷达结构增加：

- 大范围层状 CDO 雨盾；
- 内部断续层状弧 / connecting-band；
- 主眼墙中等至强回波环；
- 眼墙局地嵌入式强对流；
- 极紧凑核心稀疏热塔；
- EWRC 双眼墙与中间 moat 低回波带；
- 外雨带 25–40 dBZ 主体 + 少量 40–55 dBZ 嵌入单体；
- 风切、干空气、裸露 LLCC、山地登陆造成的扇区缺口和破碎；
- 明显的真眼低回波孔洞。

所有纹理使用小时尺度连续变化的确定性空间噪声，减少上一版按时间片跳变导致的“椒盐闪烁”。

## 8. 产品名称修正

预报产品中的原“组合反射率 (DBZ) 模拟雷达拼图”改为：

> 近地层基本反射率 (dBZ) 模拟雷达拼图

以更贴近用户上传的 NMC 基本反射率参考，也避免把当前二维近地层诊断误称为完整三维体扫最大值组合反射率。

## 9. 验证

未执行 `npm install`、`npm run` 或 `npx`。

新增 `scripts/release_4_1_3_regression.cjs`，直接用系统 TypeScript 转译并执行真实 `PrecipitationModel.ts`，检查：

- 摩羯式大而强 CDO 不出现整片 50–60 dBZ；
- 45+ dBZ 仅局地出现；
- 紧凑 T8 核心允许稀疏 60+ dBZ；
- 60+ dBZ 面积严格保持稀少；
- 清晰台风眼维持低回波孔洞；
- 版本、UI 产品名称和源码机制均已同步。
