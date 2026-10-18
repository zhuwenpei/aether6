# AETHER 4.1.5 机制依据与实现边界

本文件只记录 4.1.5 新改动直接参考的资料。AETHER 是模拟器，不把经验参数化包装成业务机构算法。

## 热带气旋雨带不应成为无限数学螺旋

NOAA/AOML 1999 Hurricane Field Program 的 Rainband Structure Experiment 总结指出，热带气旋雷达/卫星中的典型雨带约 **5–50 km 宽、100–300 km 长**，雨带之间的无降水间隙往往更宽。它们具有尾随螺旋形态，但并不是能够无限向外反复绕圈的连续曲线。

- NOAA/AOML, *1999 Hurricane Field Program*, Rainband Structure Experiment: https://www.aoml.noaa.gov/hrd/HFP99/HFP99.pdf

Cecil & Zipser / Hence & Houze 等雷达研究把内雨带和外雨带区分开：外雨带区域通常从约 **150–200 km** 半径开始；TRMM 统计研究在分类时把与 TC 相关的最远降水特征限制在中心约 **500 km** 内。超过约 200 km 后，雨带覆盖更稀疏、更偏向离散对流单体，而靠近内核的雨带则更连续、层状成分更多。

- Cecil & Zipser 2002, *Reflectivity, Ice Scattering, and Lightning Characteristics of Hurricane Eyewalls and Rainbands. Part I*: https://journals.ametsoc.org/abstract/journals/mwre/130/4/1520-0493_2002_130_0769_risalc_2.0.co_2.xml
- Jiang et al. 2013, *Convective and Rainfall Properties of Tropical Cyclone Inner Cores and Rainbands from 11 Years of TRMM Data*: https://journals.ametsoc.org/abstract/journals/mwre/141/2/mwr-d-11-00360.1.xml
- Hence & Houze 2012, *Vertical Structure of Tropical Cyclone Rainbands as Seen by the TRMM Precipitation Radar*: https://journals.ametsoc.org/abstract/journals/atsc/69/9/jas-d-11-0323.1.xml

Hence & Houze 的统计还显示：外区雨带常呈破碎的对流单体线，向内逐渐增强、连续并增加层状降水；风切会组织雨带的方位不对称。这支持 4.1.5 采用“有限弧段 + 破碎纹理 + 独立对流单体”，而不是几条贯穿数百至上千公里的规则螺旋线。

Barnes 等早期机载雷达研究和后续雨带研究也指出，主雨带内部常由上风端/内侧的对流单体与下风端的层状降水共同构成，因此地层雷达不应把整条雨带以同一强度绘制。

- Barnes et al. 1983, *Mesoscale and Convective Structure of a Hurricane Rainband*: https://journals.ametsoc.org/view/journals/atsc/40/9/1520-0469_1983_040_2125_macsoa_2_0_co_2.xml
- Didlake & Houze 2013, *Dynamics of the Stratiform Sector of a Tropical Cyclone Rainband*: https://journals.ametsoc.org/view/journals/atsc/70/7/jas-d-12-0245.1.xml

## 4.1.5 的数值实现

`finiteRainbandGeometry()` 不声称重现某个业务数值模式。它把以上观测事实转化为适合交互式模拟器的连续经验几何：

1. principal / secondary / distant 三组雨带各自只有有限径向窗口；
2. 中心线仅在窗口内缓慢弯曲，最大转角受径向窗口天然限制；
3. 角宽由公里尺度带宽换算，远距离带更宽但更稀疏；
4. 风切、结构破坏、干空气仍通过现有不对称/纹理机制调制；
5. 同一几何同时供基本反射率与降水模型使用，避免两个产品出现互相矛盾的雨带尺度。

## 产品/地图修复的边界

- 向日葵9号观测风复盘的“1 h 折线”是用户指定的资料呈现规则；模拟器自身历史状态也按小时归档。该改动不改变动力积分。
- NMC 预报图的信息框避让是不确定性锥上层的版式算法，不改变预报轨迹、锥半径或强度数据。
- 中国全程累计降水地图修复只改变投影范围、GeoJSON 环处理与任务触发方式，不改变逐时降水物理值。
