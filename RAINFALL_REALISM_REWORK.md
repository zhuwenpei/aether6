# 降水真实性机制重构说明

本次修改针对 24 小时台风降水场的**物理生成机制**，不是针对某一张图做贴图、遮罩或区域硬编码。
目标是让相同路径/强度条件下的累计降水，从“以台风中心/路径为主的近同心雨盾”转向更接近业务降水分析常见的形态：
**垂直风切变控制的非对称雨区 + 边界层摩擦辐合 + 水汽输送/辐合走廊 + 地形锁定的远距离次中心 + 24 h 训练效应**。

## 对比样本暴露出的结构差异

- 原程序主要雨区过度锁定在台风中心和路径附近；参考图中大范围 50–250 mm 区域明显更不规则，并可向内陆伸出长舌、缺口和次级叶状区。
- 原程序对“远离台风中心的山区降水”基本只能做乘法增强：如果基础台风降水已经因距离衰减到很小，再高的山也无法独立形成降水中心。因此台湾中央山脉这类远距地形中心会直接缺失。
- 原程序登陆摩擦辐合偏轴对称，没有充分表达“风切变上升区”和“移动/摩擦上升区”重叠后形成的优先强降水象限。
- 原程序 24 h 累积中的宽广雨盾仍较容易被径向衰减和宽雨区压缩规则削弱，导致强降水区过于紧凑、外围次中心难以保留。

## 代码级修改

### 1. 新增低层水汽背景风诊断

`src/simulation/PrecipitationModel.ts`

新增 `estimateMoistureBackgroundWind()`：把西风带、副热带高压外围和暖季季风水汽输送转换为只服务于降水的低层背景风。
它**不改变台风路径**，只用于判断水汽输送、辐合和地形迎风抬升。

### 2. 新增持续水汽辐合 / 中尺度雨带机制

新增 `synopticConvergenceRain` 分量。它由以下信号共同控制：

- 台风外环流的径向水汽流入；
- 环境低层背景风；
- 风切变主导的 downshear / downshear-left 上升区；
- 台风移动造成的边界层前方/右前方摩擦辐合；
- 缓慢演变的地面相对水汽拓扑。

该分量被设计为**中等小时雨强、长时间持续**，主要负责在 24 h 累积中生成宽广、非圆形的 50–250 mm 叶状雨区，而不是直接制造极端点值。

### 3. 风切变与移动/摩擦不再是两个无关乘子

根据移动速度，边界层摩擦辐合中心从慢速系统的“右前方”连续旋转至快速系统的“正前方”；
随后显式计算它与风切变下游上升区的重叠 `shearFrictionOverlap`。

登陆前后的 `landfallConvergence` 使用该动态非对称场，从而让强降水优先出现在动力上升叠加区，而不是围绕中心形成一圈近轴对称增强。

### 4. 地形从“乘法增幅器”改为“独立降水源”

新增 `terrainAnchoredRain`。

旧模型：

`已有台风降水 × 地形因子`

新模型额外计算：

`低层湿气流强度 × 地形坡度 × 迎风投影(u·∇h) × 水汽供应 × 距离可达性 × 持续地形锁定`

因此即使一个山区距离台风中心数百公里，只要外环流/季风水汽持续撞击迎风坡，也能独立形成 24 h 次级降水中心；背风坡则通过 `terrainLeeShadow` 被明显压低。

同时加入了弱的“环境风与台风外环流在山地附近对冲/汇合”项，用于表达地形阻挡和局地锋生式辐合，不包含台湾、福建、浙江等任何硬编码地名或经纬度规则。

### 5. 修正远距离径向衰减的结构错误

通用的 storm-centred radial taper 仍保留，防止全图铺雨；但它现在不能直接抹掉已经被诊断为：

- `terrainAnchoredRain`
- `synopticConvergenceRain`

的真实机制贡献。

远距机制仍有独立的距离衰减，并在最后重新应用小时雨强物理上限，避免地形机制绕过全局 cap。

### 6. 24 h 累积图的机制识别与压缩规则更新

`src/utils/ObservedRainfallMap.ts`

- 累积 `terrainAnchoredRain` 和 `synopticConvergenceRain` 的持续时间/贡献；
- 将它们纳入 organized rain / focus 判据；
- 地形锁定或持续辐合明确存在时，不再按“普通宽雨盾”强行压缩；
- 山区网格的快速距离剔除半径扩大，避免还没调用降水模型就把远距山区次中心跳过；
- 仍然严格限制普通远距低地，不会因为扩大诊断范围就无条件铺出降水。

### 7. 回归测试

新增：`scripts/rainfall_mechanism_regression.ts`

并新增 npm script：

`npm run test:rainfall`

当前核心机制回归结果（合成场景，不对应某个具体台风）：

- 远距迎风山区：约 **55.1 mm/24 h**
- 相同距离背风山区：约 **3.7 mm/24 h**
- 相同距离普通低地：约 **2.6 mm/24 h**
- 强风切变场中 downshear-left 小时雨强：约 **12.54 mm/h**
- 对应 upshear：约 **4.92 mm/h**

另用更慢、更湿、更大环流的合成条件检查，远距迎风山地可自然达到约 **100–500+ mm/24 h**，说明新机制能覆盖“弱远距次中心”和“极端地形训练”两种状态，而不是把某个岛屿固定设成某个雨量。

## 同步修复

`src/types.ts` 中 `Typhoon` 缺失 `plainTsShelfHours/plainTsShelfMemory`，而 `Engine.ts` 实际使用这两个字段。本次同步补齐，消除了此前核心 TypeScript 类型阻断。

## 验证状态

- `PrecipitationModel.ts + types.ts` 已通过 TypeScript 5.8.3 独立类型检查。
- 三个修改文件均通过 TypeScript transpile/syntax 检查。
- 降水机制回归测试已执行通过。
- 完整 `npm install` 在当前沙箱网络条件下超时，因此没有声称完成完整 Vite production build；全项目 `tsc` 目前剩余报错均来自未安装的 React/Leaflet/Turf 等依赖及其级联类型缺失，没有再出现此次修改引入的核心文件类型错误。

## 机制依据

本次重构参考了公开研究中反复出现的机制结论，而不是拟合单一图片：

- Yu, Wang & Xu (2015), *Observed Rainfall Asymmetry in Tropical Cyclones Making Landfall over China*, JAMC, DOI: 10.1175/JAMC-D-13-0359.1
- Chen, Knaff & Marks (2006), *Effects of Vertical Wind Shear and Storm Motion on Tropical Cyclone Rainfall Asymmetries Deduced from TRMM*, MWR, DOI: 10.1175/MWR3245.1
- Shu, Feng & Wang (2018), *Essential Role of Synoptic Environment on Rainfall Distribution of Landfalling Tropical Cyclones Over China*, JGR Atmospheres, DOI: 10.1029/2018JD028842
- Lin & Wu (2021), *Remote Rainfall of Typhoon Khanun (2017): Monsoon Mode and Topographic Mode*, MWR, DOI: 10.1175/MWR-D-20-0037.1
- Zhang et al. (2012), *Impacts of Typhoon Track and Island Topography on the Heavy Rainfalls in Taiwan Associated with Morakot (2009)*, MWR, DOI: 10.1175/MWR-D-11-00240.1

这些研究共同支持：降水非对称主要受风切变/移动/边界层辐合控制；高地形的迎风抬升、低层水汽通量和持续训练可在台风中心之外形成独立极端降水中心。


## 3.7.4：强降水面积与登陆后持续时间进一步解耦

3.7.3 在实况图产品层压缩了高值平台，但同参数实测仍显示：50–250 mm 区域可占据过大的连续面积，同时登陆后随着风速下降，降水包络本身又衰减得偏快。3.7.4 不再用同一个“衰减系数”同时控制面积和寿命，而拆成两个问题：

1. **寿命**：延长登陆后湿润残余内核、低层涡旋和大环流水汽输送的降水记忆，使中低值降水可在内陆维持更久；
2. **覆盖面积**：收紧内陆强对流半径、提高对流/训练单体的空间选择性，并用慢演变的地面相对锚点维持少数持续雨带/单体，使高值从“整片铺开”转为“少数带状/簇状区域”；
3. **累计产品**：新增持续对流支持诊断。大面积高累计如果缺乏数小时以上的局地强对流、地形、训练或明确内核通过，会连续压回中低等级；局地显著且机制支持充分的极值则保留。

因此本版目标不是把所有降水都调小，而是形成“更窄的强降水 + 更持久的内陆中低值雨区 + 更明显的空间不规则性”。
