# AETHER / TyphoonSIM 4.1.2 科学依据与实现边界

本文件记录 4.1.2 新增经验机制使用的主要公开资料。实现目标是让离线模拟的结构关系和数量级更接近观测认识，而不是复制某一篇论文、某一场台风或替代业务数值模式。

## Dvorak 强度与云结构

1. NOAA/NESDIS/OSPO, **The Dvorak Technique Explained**  
   https://www.ospo.noaa.gov/products/ocean/tropical/dvorak.html  
   Dvorak 技术利用增强红外/可见光云型、发展趋势和规则产生 T-number / Current Intensity。示例中 T3.5 对应约 55 kt。

2. NOAA/NESDIS/OSPO, **Dvorak Current Intensity Chart**  
   https://www.ospo.noaa.gov/products/ocean/tropical/CI-chart.html  
   4.1.2 的 `estimateDvorakTNumber()` 采用该表的风速节点做连续插值。代码只把它当作结构组织度先验，不把卫星 T 值直接当作降水或地面雷达观测。

## 眼墙置换、眼墙完整度与风圈扩张

3. NOAA/AOML, **Hurricane FAQ**  
   https://www.aoml.noaa.gov/hrd-faq/  
   成熟强台风/飓风可发生眼墙置换；新眼墙接替旧眼墙时峰值风速可暂时下降，随后新眼墙建立后再增强。高垂直风切和干空气可使热带气旋减弱。

4. NOAA/AOML Hurricane Field Program, **Secondary Eyewall Formation / Eyewall Replacement Cycle**  
   https://www.aoml.noaa.gov/2019-hurricane-field-program/  
   SEF/ERC 常令增强停止或暂时减弱，并常伴随风场明显扩张。4.1.2 因此把“双眼墙/置换成功/置换失败/外眼墙滞留”与眼墙强度、moat、风圈扩张和恢复时标分开表示。

5. NOAA/AOML, **Study relating boundary-layer structure and TC intensity**  
   https://www.aoml.noaa.gov/hurricane_blog/study-relating-the-structure-of-the-area-in-a-tropical-cyclone-closest-to-the-surface-and-intensity-released-online-in-monthly-weather-review/  
   对应研究 DOI: https://doi.org/10.1175/MWR-D-21-0335.1  
   研究总结指出窄核台风更容易把入流/上升集中在 RMW 附近，宽核台风的上升更分散到外核/雨带。4.1.2 将该关系用于“大/小环流 × 强/弱强度”的结构差异，而不是把所有同风速台风画成同一形态。

## 2024 年台风摩羯：卫星浓密 CDO 不等于整片强雷达回波

6. **Use of FY-3G PMR to analyze precipitation and microphysics of Typhoon Yagi (No. 2411) in rapid intensification**, Tropical Cyclone Research and Review, 2025.  
   DOI: https://doi.org/10.1016/j.tcrr.2025.10.002  
   FY-3G PMR 对 2024 年摩羯快速增强阶段的三维降水观测显示：层状降水约占降水面积 82%，对流降水仅约 18%，但贡献约 54.7% 的总降水强度；最强降水和 >45 dBZ 回波集中在眼墙，而内螺旋雨带主要是层状降水、雨强多低于 30 mm/h。

该结果直接支持 4.1.2 的雷达解耦：CDO 云盾可以很密实、很冷，但近地强回波应由眼墙/雨带中的局地强对流单体决定，而不是把整块卫星云罩填成 40–60 dBZ。

7. NOAA/AOML Hurricane Research Division, **Hurricane Radar / Radar observations of tropical cyclones**  
   https://www.aoml.noaa.gov/hrd/hrd_sub/hradar.html  
   AOML 对飓风雷达结构的教学资料说明，约 40 dBZ 常代表对流性降水，最强眼墙局地可接近或超过 50 dBZ，而眼墙外大量层状降水通常明显更低。4.1.2 因而让高 dBZ 由少量眼墙热塔/嵌入式对流单体产生，而不是从整片冷云罩反推。

## 地形破坏与再组织

8. Wu, Yang & Rogers (2022), **Examining Terrain Effects on the Evolution of Precipitation and Vorticity of Typhoon Fanapi (2010) after Departing the Central Mountain Range of Taiwan**, Monthly Weather Review.  
   DOI: https://doi.org/10.1175/MWR-D-21-0205.1  
   高分辨率模拟和雷达分析显示台湾中央山脉可破坏眼墙；离开山地后，深对流与低层涡度伸长可参与眼墙重新组织。4.1.2 因此把“平原仍完整/山地破碎/出山后重组”设为连续状态，而不是登陆即把所有核心统一清零。

## 双/多台风三维藤原效应

9. Ito, Hirano, Lee & Chan (2023), **Three-Dimensional Fujiwhara Effect for Binary Tropical Cyclones in the Western North Pacific**, Monthly Weather Review, 151, 1779–1795.  
   DOI: https://doi.org/10.1175/MWR-D-22-0239.1  
   西北太平洋 best-track + ERA5 分析显示双台风会互相诱导垂直风切，并通过非对称潜热加热改变路径。>1000 km 时可出现相对于两涡旋中点的顺时针/排斥偏差；<1000 km 时水平平流/经典互绕更重要，且效应依赖双方强度、尺度、环流与持续时间。

4.1.2 因而没有只实现一个固定半径的二维圆周运动，而是同时包含：距离相关互绕/靠近、1000–2000 km 的弱三维偏转、相互诱导风切、强弱不对称位移以及极近距离的碰撞/吞并。碰撞阈值、吞并后的强度脉冲，以及合并后仍保留一段衰减诱导风切/倾斜记忆，均属于模拟器经验参数，不是上述论文给出的确定业务阈值。


## 海气通量与登陆后有限海洋水汽连接

10. NOAA/AOML, **Coupled Boundary Layers Air-Sea Transfer (CBLAST) – Hurricane component**  
    https://www.aoml.noaa.gov/hrd/project2005/CBLAST_hurr_1.html  
    飓风边界层通过海面感热/潜热通量获得暖湿空气，水汽随后可被低层入流输送到内核和雨带。4.1.2 把这一基本关系压缩成 `marineMoistureLink`：当中心已登陆但大型、完整的低层环流仍有显著海面覆盖时，允许有限的海洋水汽通量继续支持内陆 CDO/雨带；这不是“陆地中心仍从脚下海洋取能”，也不抵消陆面摩擦。

## 新环境预报路径

新环境是离线、再分析启发式的理想化连续场，不是特定日期 ERA5/NCEP 原始场。因此 4.1.2 对“新环境开启后紧密回环”采用数值稳定性和气旋尺度一致性修复：用约 350–450 km 半径九点模板估计深层环境平均，而不是中心单点风；弱引导区不再被强制抬到 15–18 km/h；新环境还与旧版随时效增长的伪季风环流曲率隔离，并显著缩小旧式摆动项，防止重复施加旋转。最后用与每步实际位移对应的最小曲率半径（热带约 180–300 km，西风带最低约 120 km）限制数值上的紧密自旋，同时允许大尺度再曲折。该修复的目标是减少离线理想化小尺度涡旋对路径的非物理锁定，不宣称因此获得真实个例的业务预报技巧。

## 参数化边界

- Dvorak 是卫星云型强度估计方法，不是地面雷达反射率公式；本版明确分开二者。
- 摩羯 FY-3G PMR 论文给出的是一个个例的降水结构统计，本版只提取“广域层状 + 小面积强对流”的机制，不把 82%/18% 强行固定到所有台风。
- Fujiwhara 交互和吞并存在强烈个例依赖；本版使用连续经验门控而非硬编码“到某距离必吞并”。
- 海面环流给内陆中心供水是低层水汽通量的简化代理；中心进入山地、低层涡旋破坏或风圈不再覆盖足够海面时会自动衰减。
- 地层雷达是降水结构的观测/诊断，不是降水的物理“原因”。代码关系是“降水/微物理结构 → 雷达反射率诊断”，并与“云顶温度/卫星云图”分离。
