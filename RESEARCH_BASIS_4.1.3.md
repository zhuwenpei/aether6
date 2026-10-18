# AETHER / TyphoonSIM 4.1.3 科研依据与摩羯图像分析

## 用户上传图像的结构判读

用户上传的“摩羯第二次巅峰”卫星与雷达对比非常适合作为反例：卫星图上的结构非常完整，具有清晰小眼、接近闭合的高层冷云眼墙以及范围很大的致密 CDO；但 NMC 基本反射率图并没有把整个 CDO 显示成 50–60 dBZ。

从上传的雷达图可直接看到：

- 眼区仍是明显低回波孔洞；
- 眼墙附近以连续的中等至强回波环为主体，但真正很高的回波只集中在局部弧段；
- 内外雨带有大量 20–40 dBZ 的层状/混合回波；
- 50 dBZ 左右及更高回波只占很小面积，并表现为嵌入式细窄单体/弧段；
- 外围还存在明显的弱回波区、缺口和分层雨带，而不是由卫星 CDO 外缘决定的实心雷达圆盘。

因此，卫星云图适合约束“高层云盖组织度 / Dvorak 结构”，但不能直接作为地面降水强度和 dBZ 的二维模板。

## 直接研究依据

### 1. 2024 摩羯 FY-3G PMR 研究

2025 年发表的 FY-3G PMR 对摩羯快速增强阶段研究指出：层状降水占总降水面积约 82%，对流降水面积只约 18%，但对流部分贡献约 54.7% 的总雨强。最强降水集中在眼墙，组合反射率超过 45 dBZ，近地层雨强可超过 100 mm/h；内雨带则以层状降水为主，强对流以嵌入形式存在。

来源：
- *Use of FY-3G PMR to analyze precipitation and microphysics of Typhoon Yagi (No. 2411) in rapid intensification*, Tropical Cyclone Research and Review, 2025.
- https://www.sciencedirect.com/science/article/pii/S2225603225000487

该研究还报告摩羯眼墙不同象限存在明显不对称：一侧最大反射率约 50 dBZ，而另一侧明显更弱。这支持程序中“高 T 值并不等于 360° 同强度眼墙”的处理。

### 2. NOAA/AOML 飓风雷达结构

NOAA/AOML 的经典飓风雷达说明指出：强飓风眼墙可出现约 50 dBZ，但大多数眼墙和螺旋雨带对流约 40 dBZ；最强对流只占飓风很小面积。对流以外的层状降水常在约 30 dBZ。

来源：
- NOAA/AOML Hurricane Olivia Radar
- https://www.aoml.noaa.gov/hrd/hrd_sub/hradar.html

这直接支持 4.1.3 的面积约束：眼墙可以很强，但 50–60+ dBZ 必须局地化。

### 3. NOAA：热带暴雨可以只有 35–45 dBZ

NOAA JetStream 雷达教材特别以 Hurricane Ida 为例说明：热带气旋中即使出现暴雨和强风，反射率仍常在 35–45 dBZ，因为暖热带降水的雨滴通常更小、少冰雹，雷达回波功率因此比大陆强对流低。雷达反射率与雨量不是一一对应关系，粒径分布对 Z 极其重要。

来源：
- NOAA JetStream, Radar Images: Reflectivity
- https://www.noaa.gov/jetstream/reflectivity

因此 4.1.3 不再使用一个固定 Z–R 关系把雨强直接翻译成 dBZ，而引入 `warmRainDbPenalty` 与显式对流填充率。

### 4. NASA GPM：降水类型和粒径分布是雷达定量降水的核心

NASA GPM 资料说明，雷达反射率反映的是水凝物大小和数量；DPR 定量降水算法必须考虑粒子/雨滴粒径分布，并区分层状和对流降水。两种类型具有不同的垂直和微物理特征。

来源：
- NASA GPM Precipitation Algorithms
- https://gpm.nasa.gov/science/precipitation-algorithms
- GPM/DPR Algorithm Theoretical Basis Document

这对应 4.1.3 新增的 `stratiform / mixed / convective` 诊断和分离的反射率生成路径。

### 5. NOAA 机载雷达统计

NOAA/AOML 汇总 1997–2021 年机载多普勒雷达资料的研究显示，在热带气旋可观测降水中，层状降水是最常见类型，而深对流面积占比非常小；增强中的台风/飓风会增加眼墙内对流覆盖，但仍不是整个台风都成为深对流。

来源：
- Wadler et al., *On the Distribution of Convective and Stratiform Precipitation in Tropical Cyclones from Airborne Doppler Radar...*
- NOAA repository: https://repository.library.noaa.gov/view/noaa/60229

## 4.1.3 的参数化结论

科研资料并不能给出一个可直接复制到离线模拟器的“唯一正确公式”，所以本版本采用受观测约束的经验参数化：

1. **云图决定包络，不决定 dBZ 峰值。** CDO 大小只扩大层状/混合雨盾，不直接放大雷达色阶。
2. **高强度决定眼墙有资格强，不保证整圈强。** Dvorak T 值提高眼墙基线与局地峰值上限，方位填充率仍由眼墙完整度、风切和对流覆盖决定。
3. **体型决定强对流如何分布。** 大型强台风把对流质量分散在更长眼墙和更大雨盾上；紧凑强台风更容易把上升运动集中到小半径并出现更高局地 Z。
4. **暖雨谱允许“高雨量、中等 dBZ”。** 宽广湿润热带核心对 dBZ 施加温和负修正，而不直接砍掉雨量。
5. **60+ dBZ 是特殊局地状态。** 需要高 T、紧凑核心、较高深对流覆盖/爆发指数，并只赋予极窄热塔扇区。
6. **EWRC 和破坏过程必须在雷达上有几何表现。** 双眼墙产生两条回波环和 moat；风切/干空气/山地破坏产生扇区缺口和破碎弧，而不是仅把整图统一降亮度。

## 数值校准目标

4.1.3 回归中设置了两个无命名、通用化的结构样本：

- **大型 T6.7 级成熟强台风**：约 260 km CDO、28 km RMW、大风圈。要求最大回波约 47–53 dBZ，45+ dBZ 面积极小，50+ dBZ 近乎点状，默认没有 60+ dBZ。
- **极紧凑 T8 级猛烈核心**：约 130 km CDO、13 km RMW、高爆发指数。允许局地达到 60–65 dBZ，但 60+ dBZ 面积仍小于 0.4%。

这些阈值是模拟器校准目标，不代表业务雷达硬阈值，也不声称复刻摩羯某一时刻每个像素的真实观测值。
