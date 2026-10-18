# TyphoonSIM 3.7.5 — 干空气、雷达回波与内核尺度重构依据

本版针对两个问题：

1. 干空气连入内核后，不应凭空制造一个比原完整内核更大的偏置强对流团；应先表现为整体深对流覆盖下降、眼墙破口/残余弧，之后若再湿化才从小核心重新组织。
2. 红外冷云顶（CDO/云砧）与低—中层雷达强回波不能一一对应；增强也不等于“高反射率核心面积不断变大”。

## 1. 干空气通风是净负反馈，不是湿侧补偿增幅

Tang & Emanuel (2012) 将垂直风切与中层低熵空气通风联系起来，指出高通风指数对应更强的减弱倾向。Tang & Emanuel 的轴对称试验还表明，超过一定通风阈值后，内核结构会严重退化并快速减弱。

- Tang, B. & Emanuel, K. (2012), *A Ventilation Index for Tropical Cyclones*, BAMS.
  https://doi.org/10.1175/BAMS-D-11-00165.1
- Tang, B. & Emanuel, K. (2012), *Sensitivity of Tropical Cyclone Intensity to Ventilation in an Axisymmetric Model*, JAS.
  https://doi.org/10.1175/JAS-D-11-0232.1

因此 3.7.5 把干空气拆成两部分：

- 方位结构：干槽、破口、残余湿侧弧；
- 面平均热力学损失：`dryCoreLifecycleRetention`。

湿侧弧只能“少受损”，不能超过未受干空气影响时的基线强度。`asymmetric_collapse` / `residual_vortex` 阶段会显著压低整个内核的深对流覆盖和雨强。

## 2. 卫星云顶和雷达降水不是同一个量

Chan et al. (2004) 对华南登陆台风的卫星与雷达对照指出：卫星云顶温度描述的是上对流层云特征，雷达 3-km CAPPI 更接近中低层降水；有垂直风切时，卷云砧会从底层对流上方移开，因此冷云区可与强降水区错位。该研究的 Cam 个例中，干大陆空气入侵破坏了眼墙的西部和南部。

- Chan et al. (2004), *Asymmetric Distribution of Convection Associated with Tropical Cyclones Making Landfall along the South China Coast*, MWR.
  https://doi.org/10.1175/1520-0493(2004)132<2410:ADOCAW>2.0.CO;2

这与本次上传的增强红外图 + 华东雷达拼图的视觉关系一致：宽广冷云罩并不对应同样宽广、连续的 45 dBZ 以上低层强回波。

## 3. 强台风雷达里，45–50+ dBZ 应是局地嵌入式强对流，不是整片 CDO

NOAA/AOML 的飓风雷达说明指出：约 40 dBZ 常见于眼墙/螺旋雨带对流，约 50 dBZ 可出现在强飓风的局部强对流中，但这种最强对流只占飓风面积的一小部分；对流外更大面积常为约 30 dBZ 的层状降水。

- NOAA/AOML, *Hurricane Radar (HRadar)*.
  https://www.aoml.noaa.gov/general/WWW000/text/hradar.html

NOAA 2023 的机载多普勒降水型统计进一步给出：样本中层状降水约占 82.6%，深对流仅约占 1.3%。增强台风眼墙中的对流覆盖会增加，但“深对流 = 大面积连续强回波”仍不成立。

- Wadler et al. (2023), *On the distribution of convective and stratiform precipitation in tropical cyclones from airborne Doppler radar...*, MWR (NOAA/AOML publication summary).
  https://www.aoml.noaa.gov/hrd/about_hrd/publications.html

NOAA 机载雨滴谱还给出热带气旋专用 Z–R 关系（总体样本约 `Z = 192 R^1.42`），说明单一 Marshall–Palmer 关系并不能完整代表热带暖雨微物理。

- NOAA/AOML, *Z-R Relations from Airborne Disdrometers*.
  https://www.aoml.noaa.gov/hrd/TC_ZR.html

因此 3.7.5 雷达渲染不再用 43–58 dBZ 的“结构底值”画完整眼墙；底值只用于保证中等回波连续性，45–55 dBZ 尾部主要由局地 hot tower / extreme-cell / burst 成分保留，同时对宽广暖雨背景做高反射率压缩。

## 4. 增强与内核尺度：RI 更偏好小 RMW，而不是核心越增强越大

Carrasco et al. (2014) 的统计显示，发生 RI 的台风初始 RMW 和 34-kt 风圈通常更小；RMW 与后续 24 h 强度变化呈负相关，大 RMW 情况下 RI 显著更少。外层尺度 ROCI 与强度变化关系则弱得多，说明“内核大小”和“外围环流大小”必须拆开。

- Carrasco, Landsea & Lin (2014), *The Influence of Tropical Cyclone Size on Its Intensification*, Weather and Forecasting.
  https://doi.org/10.1175/WAF-D-13-00092.1

另一项统计研究也指出，最高增强率集中在较小 RMW（例如 RMW <= 40 km）的参数区间。

- Xu & Wang (2015), *A Statistical Analysis on the Dependence of Tropical Cyclone Intensification Rate on the Storm Intensity and Size in the North Atlantic*, Weather and Forecasting.
  https://doi.org/10.1175/WAF-D-14-00141.1

Stern et al. (2015) 进一步说明：RMW 收缩通常在增强早期最明显，很多强台风在达到峰值强度前，RMW 已经进入近稳态；之后可以“原地增强”，而不是一直收缩或反过来随着风速不断扩张。

- Stern et al. (2015), *Revisiting the Relationship between Eyewall Contraction and Intensification*, JAS.
  https://doi.org/10.1175/JAS-D-14-0261.1

因此 3.7.5：

- RI 不再打开“大面积高效率密集降水核心”通道；
- RMW 在增强时不能被外围大环流/水汽平台拖着增大；
- RMW 气候目标在高强度阶段改为趋平，允许“先收缩、后稳定、继续增强”；
- CDO/高层云砧可滞后并维持较大范围，但它不再决定密集降水核心半径；
- 干空气后恢复首先建立约 20–44 km 的小核心，再逐步恢复更完整的结构。
