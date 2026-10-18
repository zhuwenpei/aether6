# TyphoonSIM 2.4.16 更新说明

## 本轮对比结论

本轮针对用户提供的两组对照重新检查了降水机制：

1. **干空气已经侵入核心、强度仍较高的场景**：真实红外图并不是“整个内核一起熄火”。典型结构是干槽沿一个或数个象限卷入，部分眼墙/CDO被侵蚀，但干槽对面的湿润眼墙弧、内雨带和深对流团仍可非常旺盛。2.4.15 的模拟雷达却容易只剩远离中心的一小块降水，说明干空气被错误地当成了全内核标量惩罚。
2. **登陆后的场景**：真实台风登陆后仍可保留明显的残余核心、湿侧强对流弧和有组织雨带，同时大尺度环流继续存在。2.4.15 的即时雷达又容易出现另一种误差：广域的 `inlandVortexBackground` 过强，形成很大、比较均匀的橙/黄雨区，而真正的残余核心和湿侧高雨率不够突出。

因此 2.4.16 的目标不是简单“加雨”或“减雨”，而是重新分配：**干槽侧减、湿润残余弧增；广域均匀背景减、残余核心/眼墙/离散雨带增。**

## 1. 干空气侵入改为扇区物理

`PrecipitationModel.ts` 新增以下诊断：

- `drySlotLobe`：实际干槽进入的象限；
- `dryWrapLobe`：随环流卷入的次级干空气侧；
- `moistArcLobe`：干槽大致对面的湿润残余眼墙/CDO弧；
- `moistArcFlanks`：湿润弧两侧仍可能爆发的内雨带/眼墙碎片；
- `dryIntrusionAzimuthalSurvival`：同一半径上随方位变化的对流存活率。

旧版中，`dryAirCoreExposure` 会通过水汽输送、`coreStructureFactor`、`convectiveSuppression`、强迫干空气等多个路径重复全方位削弱核心。现在改为：

- 干槽方向：眼墙/CDO显著降低，可形成明显低回波缺口；
- 湿润对侧：只要仍有 `moistCoreProtection`、眼墙完整度和足够强的低层涡旋，仍能维持强降水；
- 风切、冷水、西风带等**非干空气**抑制仍可全局削弱对流。

## 2. 新增“干空气侵蚀后的残余 CDO/眼墙弧”

新增 `dryIntrudedCoreSurvival` 与 `dryIntrudedCdoScene`。

强度仍在台风级以上时，即使结构模式已经进入：

- `dry_slot_eroding`
- `dry_leaf`
- 部分 `incense_coil`
- `westerly_sheared`
- 登陆初期的 `landfall_disintegrating`

也不会直接跳到“中心几乎无雨”。只要内核还有一定完整度和湿润保护，模型会绘制一个**不闭合的残余 CDO/眼墙强对流弧**。它的径向尺度仍围绕原 RMW/CDO，而不是跑到几百公里外成为唯一强降水中心。

## 3. 干空气后的极强对流不再随机落进干槽

核心极强单体仍保持低概率和短寿命，但在已经发生内核干侵入时，会优先出现在湿润残余弧或其两侧，而不是在干槽中随机爆发。

这使同样 45–60 m/s 的两个系统可以出现明显不同结构：

- 一个只处于早期干槽侵蚀：仍有大块强眼墙/CDO弧；
- 一个湿核保护已经崩溃：只剩小核心/雨带碎片，平均雨量低得多。

因此不再使用“同 Vmax = 同降水结构”的隐含假设。

## 4. 登陆后的即时雷达重新分配

2.4.15 的 `inlandVortexRain` 有一个较强的宽指数背景，会把较大区域同时推到中高雨率。2.4.16 改为：

- 广域 `inlandVortexBackground` 下调；
- 背景加入更明显的地面相干斑块与湿/干方位；
- `inlandResidualCoreRain` 增强，并读取干侵入后的湿润残余弧；
- 内陆零散对流/雨带仍保留，不把登陆系统重新画成一个完整圆形 CDO；
- 登陆后仍有海洋水汽补给或大水汽储备时，强雨可以继续跟着中心深入陆地。

目标是让即时雷达更接近“残余核心 + 非对称强雨弧 + 有组织雨带 + 大范围较弱雨盾”，而不是“一整个橙黄色圆盘”。

## 5. 24 小时累计产品同步修正

`ObservedRainfallMap.ts` 以前会因为 `dryAirCoreExposure` 和 `isCoreDisrupted` 把干侵入系统的核心组织评分压得很低，即使实际 `eyewall/center` 组件仍有强雨，也会在最终产品中被当成 broad/stratiform 后再次压缩。

2.4.16 改为：

- 干侵入时允许保留部分 `stateCoreOrganization`；
- 实际 `eyewall + center + coreExtreme` 雨率本身可以贡献“核心过境证据”；
- 只有真正广域、低峰值、层状主导的降水才继续接受强压缩。

因此同强度系统在“湿润残余核心仍强”和“核心已经彻底散架”两个阶段，24 h 雨量可以自然拉开差距。

## 资料依据

- Riemer et al. / AMS: *The Impact of Dry Midlevel Air on Hurricane Intensity in Idealized Simulations with No Mean Flow*。干空气可通过蒸发冷却、夹卷等抑制深对流，并造成能持续很久的降水非对称，而不是简单使整个台风均匀少雨。
  https://journals.ametsoc.org/view/journals/atsc/69/1/jas-d-10-05007.1.xml
- Wang et al. / AMS: *Impact of Dry Midlevel Air on the Tropical Cyclone Outer Circulation*。外围中层干空气可迅速压制外雨带对流，但湿润包络和海面焓通量可以保护眼墙，同时外围环流尺度甚至可能继续扩大。
  https://journals.ametsoc.org/view/journals/atsc/76/6/jas-d-18-0302.1.xml
- Kimball / AMS: *A Modeling Study of Hurricane Landfall in a Dry Environment*。雨带可在一段时间内隔离湿核与干环境；接近陆地后海面热湿通量减少，雨带逐渐侵蚀，干空气才进一步接近核心并促进减弱。
  https://journals.ametsoc.org/view/journals/mwre/134/7/mwr3155.1.xml
- Jiang et al. / AMS: *Convective and Rainfall Properties of Tropical Cyclone Inner Cores and Rainbands from 11 Years of TRMM Data*。眼墙区域通常具有最高反射率/更强对流特征，内雨带、外雨带具有不同统计结构。
  https://journals.ametsoc.org/view/journals/mwre/141/2/mwr-d-11-00360.1.xml
- Chan et al. / AMS: *Asymmetric Distribution of Convection Associated with Tropical Cyclones Making Landfall along the South China Coast*。登陆前后对流可呈明显方位非对称，且干大陆空气可破坏部分眼墙扇区。
  https://journals.ametsoc.org/view/journals/mwre/132/10/1520-0493_2004_132_2410_adocaw_2.0.co_2.xml

## 验证

本次没有执行 npm / npx / npm install / npm run / npm build。

仅使用系统现有 TypeScript 编译器：

```text
tsc -p tsconfig.json --noEmit --noCheck
```

并单独转译 `PrecipitationModel.ts` 做合成状态数值抽样。以一个 50 m/s、`dry_leaf`、内核干空气暴露约 0.72 的测试状态为例，2.4.15 在 RMW 附近各象限约为 17–22 mm/h；2.4.16 的干槽侧仍约 17–18 mm/h，但湿润残余弧可升到约 25–38 mm/h。登陆合成状态则降低了广域背景，同时使湿侧残余核心更集中。
