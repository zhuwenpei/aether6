# TyphoonSIM 3.3.22 更新说明

本版是对 3.3.21 黑圈目标的第二次逐项核对。3.3.21 已经补充主雨盾外的脱离外雨带、稍内陆训练单体和远程地形馈送流，但重新比较目标图后确认仍有两类机制耦合不够准确：沿岸主高值带内部的小尺度 400–550 mm 节点缺少独立动力来源；同时 24 小时产品仍通过父级分量推断子机制，容易产生错误权限。

## 1. 黑圈中遗漏的沿岸局地强降水节点

新增 `coastalMesoscaleTrainingCell`。它不是随机画橙色点，而是必须同时获得：

- 实际岸线法向与跨岸低层含湿气流；
- 海陆粗糙度差造成的沿岸辐合；
- 内雨带/螺旋雨带正在经过该半径；
- 中尺度水汽与对流可用性；
- 数小时地面相对的训练持续。

该分量可在连续的 250–500 mm 沿岸雨区内形成少量 400–550 mm 局地斑块，代表湾口、岬角附近或雨带与摩擦辐合带交汇处的反复触发。它严格低于 600+ 极端权限。

## 2. 外雨带、内陆单体不再由父级分量“猜”

`PrecipitationModel` 现在直接暴露：

- `detachedOuterRainband`
- `inlandMesoscaleTrainingCell`
- `coastalMesoscaleTrainingCell`
- `remoteTerrainFeederRain`

`ObservedRainfallMap` 直接积分这些子机制的驻留时间与累计量。这样主雨盾外的蓝/紫小斑、稍内陆的孤立 400+ 单体和沿岸局地高值不会互相误判。

## 3. 远程地形雨与“重大山地极端”权限分离

此前远程外围湿流的地形雨被加回 `terrainAnchoredRain`，虽然小时雨率有上限，但 24 小时后处理可能把它误当成真正的本地山地训练证据。3.3.22 将 `remoteTerrainFeederRain` 独立出来：

- 它仍可保留台湾/高岛上由外围环流造成的窄 25–100 / 100–250 mm 雨带；
- 但不会单独开启 600+、1000+ 的重大山地极端尾部；
- 真正极端地形雨仍需要本地迎风坡、坡度/起伏、持续训练和强水汽通量。

## 4. 删除区域硬编码

移除旧的“东南中国海岸 W/NW/N 扇区偏好”。脱离/沿岸雨带方位改由通用动力学决定：

1. 摩擦有利方位；
2. downshear-left 对流有利区；
3. 实际岸线法向；
4. 实际跨岸含湿流强度；
5. 有限中尺度相位。

因此这些机制不会只在福建/浙江路径上有效，也不会把同一形态强行复制到其他海岸。

## 5. 对黑圈目标的对应

- 主雨盾外蓝/紫孤立小片：脱离外雨带 packet；
- 北侧/沿岸内部橙色小斑：沿岸中尺度训练节点；
- 稍内陆橙色孤立点：内陆中尺度训练单体；
- 沿岸主体橙色区域：跨岸粗糙度辐合 + CDO/内雨带接岸；
- 台湾等远离中心的蓝色/浅蓝窄带：外围湿流 + 地形阻塞/抬升。

这些分量在物理积分中独立产生，最终成图只做分类保留，不通过画图阶段人为膨胀。

## 参考机制

- Taiwan Rainbands Formed in the Outer Region of Tropical Cyclones (Monthly Weather Review, 2021)：外围台风环流的 onshore flow 与地形阻塞/沿岸压力脊可触发独立外雨带。
- A Simple Model of the Tropical Cyclone Boundary Layer at Landfall (Monthly Weather Review, 2025)：海陆粗糙度突变会产生显著的边界层摩擦不对称。
- Remote Rainfall of Typhoon Khanun (2017): Monsoon Mode and Topographic Mode (Monthly Weather Review, 2021)：远程台风降水可由外围环流、季风/汇合与地形阻塞抬升共同产生。

## 验证边界

按用户要求未执行 npm / npx、未安装依赖、未启动浏览器程序，也未生成图片。使用环境已有 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --noCheck`，并额外筛查本次两个核心文件的 TypeScript 语义错误；最后进行 ZIP 完整性检查。
