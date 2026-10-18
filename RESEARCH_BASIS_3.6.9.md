# TyphoonSIM 3.6.9 集合预报研究依据

本版本的集合产品是模拟器内部的理想化集合指导，不代表任何真实数值天气预报中心的业务输出。

## 公开资料依据

1. ECMWF Forecast User Guide, Tropical Cyclone diagrams — existing TCs
   https://confluence.ecmwf.int/spaces/FUG/pages/673550988/Section%2B8.1.16.1%2BTropical%2BCyclone%2Bdiagrams%2B-%2Bexisting%2BTCs
   - 各集合成员独立追踪热带气旋；
   - 追踪综合过去运动和中层引导流，并搜索海平面气压、850 hPa 涡度等特征；
   - strike probability 按成员中心进入指定半径的比例统计。

2. ECMWF Atmospheric model Ensemble 15-day forecast — Tropical Cyclone tracks
   https://www.ecmwf.int/en/forecasts/datasets/set-iii
   - TC轨迹由各集合成员独立计算；
   - 不同成员可在不同时间失去/消散气旋，因此有效成员数随预报时效变化。

3. ECMWF AIFS Ensemble — Tropical Cyclone tracks
   https://www.ecmwf.int/en/forecasts/datasets/set-x
   - 中期集合TC轨迹可延伸到360小时；
   - 典型集合包含大量独立扰动成员及控制成员。

4. NHC experimental cone methodology (2026)
   https://www.nhc.noaa.gov/experimental/cone/
   - 路径不确定性应区分沿轨与横轨误差；本项目的成员扩散因此采用持续引导偏差、转向时机差异和相关低频扰动，而非独立逐点噪声。

## TyphoonSIM 实现原则

- 所有成员从同一分析中心出发，短时效维持紧密一致；
- 不确定性随时效非线性增长；
- 使用环境参数和引导场扰动形成相关、平滑、可持续的路径差异；
- 大体手绘路径只作为弱方向框架，并且框架本身也逐成员扰动；
- 少量成员允许形成合理的提前转向/偏西/离群分支；
- strike probability 使用等权成员的120km中心经过事件，而不是人为的径向模糊分值；
- 为图像可读性进行的概率栅格平滑只属于渲染，不改变成员事件统计。
