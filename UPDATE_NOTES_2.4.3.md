# TyphoonSIM 2.4.3 更新说明

## 本次目标

本版针对用户提供的多组“相同模拟参数下的 TyphoonSIM 24 小时累计降水图 / 中央气象台业务降水图”进行结构性校正。重点不是继续修改图例或单纯抬高/压低雨量，而是修正导致空间分布失真的几个机制：

1. 模拟图中过多的 100–250 mm 连续洋红色大区；
2. 250–400 / 400–600+ mm 极值反而过少、过弱；
3. 雨带过度呈现为规则、连续的“机械螺旋条纹”；
4. 登陆后的 CDO/内核仍容易沿路径留下过宽、过连续的强降水带；
5. 地形影响此前几乎只看“海拔高度”，没有判断气流究竟是在迎风坡抬升还是在背风坡下沉；
6. 台湾、福建、浙江等复杂地形区域因此容易出现“整片一起增强”，而不是业务图中常见的迎风侧局地高值 + 背风侧骤减；
7. 低层海岸辐合缺少明确的离岸/入陆距离尺度；
8. 环境垂直风切变对降水一阶非对称的控制偏弱。

## 主要机制修改

### 1. 切变相对降水非对称

`src/simulation/PrecipitationModel.ts` 新增连续的 wavenumber-1 降水非对称：

- 弱切变时，台风移动方向只提供较弱的前侧偏置；
- 切变增强后，降水最大值逐步转向下切变至下切变左侧；
- 不是硬切换，而是随 200–850 hPa 深层切变强度连续过渡；
- 非对称主要作用于眼墙之外、雨带和降水盾区域，避免重新制造规则圆盘。

同时 `src/simulation/Engine.ts` 不再使用旧的 `台风移动方向 + 135°` 作为纯视觉 shearDir 占位值，而是用模拟环境 200 hPa 与 850 hPa 风场差向量诊断切变方向。

### 2. 雨带由“规则螺旋线”改成“分段、演变的中尺度雨带”

保留台风螺旋雨带的动力骨架，但叠加两级 25–60 km 量级、3–6 小时缓慢演变的 storm-relative coherent field：

- 一条雨带不再从头到尾连续着色；
- 雨带内部会出现强对流段、普通对流段、层状降水段和明显空隙；
- 螺旋相位演变速度加快，24 小时累计图不再保留过于“人工”的固定螺旋纹；
- 仍保留可辨认的台风雨带结构，不会退化成完全随机噪声。

### 3. 登陆后轴对称核心更快瓦解

- CDO 登陆后的完整度衰减时间尺度进一步缩短；
- `innerCorePresence` 新增 `postLandCoreCoherence`，避免旧逻辑在 CDO 已破碎后又用“强台风内核增强项”把完整强降水圆盘重新加回来；
- 该项同时受登陆时间和局地对流碎裂 mask 控制；
- 结果是登陆后仍可有强眼墙碎片/极强对流，但不再形成持续数小时的大面积完整 100–250 mm 盘。

### 4. 海岸辐合增加距离尺度

`ObservedRainfallMap.ts` 新增陆地到最近海岸的近似距离场。降水模型据此区分：

- 登陆前：海陆粗糙度差异可在近海岸陆地形成较弱的预登陆辐合增强；
- 登陆初期：海岸附近仍可维持较强摩擦辐合；
- 深入内陆后：该项快速减弱，不再把“登陆辐合”无差别施加到整个内陆路径。

### 5. 地形从“只看海拔”改成“风上坡抬升 / 背风雨影”

`ObservedRainfallMap.ts` 从程序地形场计算局地东西、南北坡度（m/km），并传入降水模型。

`PrecipitationModel.ts` 用台风局地低层切向风 + 径向入流 + 少量平移分量估算近地面来流方向，然后计算 `u · ∇h`：

- 正值：迎风坡抬升，增强降水；
- 负值：背风坡，下沉/雨影削弱；
- 海拔仅作为次要背景因子，不再“山越高四面都更湿”；
- 地形训练和地形极端降水门槛也必须同时满足迎风条件。

该修改尤其针对台湾中央山脉、武夷山等区域，使同一台风路径下岛屿/沿海的高值位置更依赖实际来流方向。

### 6. 24 h 累计等级重新标定

此前产品空间标定对高值尾部压缩过强，同时 100–250 mm 中档范围保留过多，造成“洋红面积很大但 400 mm 以上几乎没有”的典型偏差。2.4.3 改为：

- 0–100 mm 基本保持；
- 100–250 mm 区间适度压缩，使大暴雨区更有选择性；
- 250 mm 以上恢复接近线性的高值尾部，让真正由核心对流、雨带训练或迎风地形形成的局地极值进入 400–600+ mm；
- 仍保持严格单调，不通过绘图阶段伪造极值。

### 7. 登陆后碎裂尺度调整

将此前偏细碎的陆地 breakup 随机场尺度由约 20–35 km 调整到约 30–50 km，并保留更大的 90 km 级背景场。这样既能破坏完整 CDO，又不会让降水图变成大量像素级“碎纸屑”。

## 资料依据

本次机制取向参考以下研究，不按单个个例数值硬拟合：

1. Chen, S. S., et al. (2006), *Effects of Vertical Wind Shear and Storm Motion on Tropical Cyclone Rainfall Asymmetries Deduced from TRMM*, Monthly Weather Review. DOI: 10.1175/MWR3245.1
   - 深层垂直风切变是 TC 降水一阶非对称的主要控制因素；北半球高值通常位于下切变左侧，低切变时平移影响相对更重要。

2. Wingo, M. T. & Cecil, D. J. (2010), *Effects of Vertical Wind Shear on Tropical Cyclone Precipitation*, Monthly Weather Review. DOI: 10.1175/2009MWR2921.1
   - 强降水覆盖的不对称性随切变增强而增大，重雨在上切变右象限明显稀少。

3. Yu, Z. et al. (2015), *Observed Rainfall Asymmetry in Tropical Cyclones Making Landfall over China*, Journal of Applied Meteorology and Climatology. DOI: 10.1175/JAMC-D-13-0359.1
   - 中国登陆台风降水最大值主要位于下切变至下切变左侧；多数地区登陆后轴对称降水分量快速减小。

4. Yu, Z. et al. (2017), *On the Relationship between Intensity and Rainfall Distribution in Tropical Cyclones Making Landfall over China*, Journal of Applied Meteorology and Climatology. DOI: 10.1175/JAMC-D-16-0334.1
   - 登陆前轴对称平均峰值约在中心外 60 km，登陆后平均峰值显著下降；强切变下内核高值更偏向海上/下切变左侧。

5. Wu, C.-C. et al. (2002/2003), *Rainfall Simulation Associated with Typhoon Herb (1996) near Taiwan. Part I: The Topographic Effect*, Weather and Forecasting.
   - 台湾高山迎风坡抬升是极端台风降水的关键，背风侧存在明显雨影；地形分辨率直接影响极端累计雨量。

6. Wu, C.-C. et al. (2021), *Remote Rainfall of Typhoon Khanun (2017): Monsoon Mode and Topographic Mode*, Monthly Weather Review. DOI: 10.1175/MWR-D-20-0037.1
   - 地形抬升、地形阻挡与季风/台风环流共同决定远距离重雨，不应只按台风最大风速做同心圆式降水。

## 验证说明

- 按用户要求，本次没有执行 `npm install`、`npm run`、`npm build`、`npx` 或其他 npm 命令。
- 使用系统现有 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --noCheck`，TS/TSX 语法解析通过。
- 修改为完整源码，不依赖补丁脚本运行。
- 两套既有降水图例和地图配色机制保持不变，本次只改降水物理分布和产品标定。
