# TyphoonSIM 3.7.4 研究依据：登陆后台风降水面积与寿命

本版继续采用通用机制，不按用户参考图的行政区边界或特定台风轨迹写死形状。参考图只用于检验“强降水面积比例、空间不规则性、登陆后持续时间”是否合理。

## 1. 登陆后降水不会与风速同步快速消失

Tuleya 等早期理想化数值试验指出，登陆初期粗糙度增强造成的边界层辐合可以暂时加强凝结潜热释放；真正导致后期衰减的是海面蒸发源切断后水汽逐步耗尽。因此降水结构可以在地面风速已开始明显减弱时继续维持。

Matyas (2013) 对45个美国登陆热带气旋雷达雨区的统计还显示，登陆后最初12小时部分个例雨区面积会增长，雨区增长/衰减与环境水汽、日变化和温带转化有关，不是简单随登陆时间单调指数缩小。

2026年针对华南登陆台风的统计也显示，登陆后降水总体连续衰减，但最显著的下降集中在登陆后约12–18小时；重降水仍可集中在中心附近，并保持明显非对称。这支持“延长雨量记忆、同时破坏轴对称结构”的参数化，而不是登陆后一刀切关闭深对流。

## 2. 强降水应比整个雨区稀疏得多

中国登陆台风观测研究表明，登陆前后降水具有显著一阶非对称，最大降水象限受风切、海陆摩擦和环境水汽共同控制；登陆后轴对称平均分量减弱，而非对称最大区仍可旋转并维持。因此24小时累计中大片规则同心或扇形高值并不合理。

Matmo (2014) 登陆后的双偏振雷达研究显示，内雨带在中心约120–180 km处仍可维持，新对流单体会在雨带上游端生成并并入主雨带。这类过程更接近“少数持续/再生雨带和单体”，而不是整个残余环流范围都持续同等强度降水。

因此3.7.4把降水寿命与高值覆盖面积分开：残余水汽和低层环流可维持较久，但高累计必须由反复对流、训练、内核通过或地形聚焦支撑。

## 参考资料

- Tuleya, R. E., Bender, M. A., & Kurihara, Y. (1978). A Numerical Simulation of the Landfall of Tropical Cyclones. *Journal of the Atmospheric Sciences*, 35, 242–257.
- Chan, J. C. L. et al. (2003). Convective Asymmetries Associated with Tropical Cyclone Landfall. Part I: f-Plane Simulations. *Journal of the Atmospheric Sciences*, 60, 1560–1576.
- Chan, J. C. L. et al. (2004). Asymmetric Distribution of Convection Associated with Tropical Cyclones Making Landfall along the South China Coast. *Monthly Weather Review*, 132, 2410–2420.
- Matyas, C. J. (2013). Processes Influencing Rain-Field Growth and Decay after Tropical Cyclone Landfall in the United States. *Journal of Applied Meteorology and Climatology*, 52, 1085–1096. DOI: 10.1175/JAMC-D-12-0153.1.
- Yu, Z. et al. (2015). Observed Rainfall Asymmetry in Tropical Cyclones Making Landfall over China. *Journal of Applied Meteorology and Climatology*, 54, 117–136. DOI: 10.1175/JAMC-D-13-0359.1.
- Wang et al. (2018). Microphysical and Kinematic Structure of Convective-Scale Elements in the Inner Rainband of Typhoon Matmo (2014) After Landfall. *Journal of Geophysical Research: Atmospheres*. DOI: 10.1029/2018JD028578.
- Zeng et al. (2026). Recent Decrease in Precipitation Asymmetry of Landfalling Tropical Cyclones Across South China. *Geophysical Research Letters*. DOI: 10.1029/2026GL121840.
