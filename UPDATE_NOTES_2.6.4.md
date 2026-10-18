# TyphoonSIM 2.6.4 更新说明

本版针对 2.6.3 在“强度仍高、但干空气已经侵入核心/结构已经破坏”的场景中，台风中心降水仍然偏弱的问题进行机制重构。

## 1. 真实结构判断

上传的 Himawari-9 云图显示，干空气侵入核心以后，台风并不会立刻变成一个几乎无降水的空涡旋。更常见的是：

- 原完整眼墙被咬开，出现明显干槽；
- 湿润一侧仍保留强眼墙弧或残余 CDO；
- 原雨带/内核对流可在更大半径重新组织成部分环状结构，形态类似不完整的外眼墙；
- 中心附近可能同时存在残余内眼墙、小核心、部分外眼墙和连接雨带；
- 即使最大风速相近，不同的湿核保护程度、眼墙完整度和干槽位置会造成完全不同的降水量与空间分布。

理想化干空气试验表明，干空气接近核心时会显著增强降水的波数1非对称，并可形成向外螺旋的强雨带；但仍可在部分眼墙扇区保留或重新发展强降水。外眼墙研究也显示，雨带可逐渐轴对称化为部分或完整的强降水环，并与次级风速极大值共存。

参考：
- Riemer & Montgomery 等关于中层干空气对飓风降水结构的研究：`https://journals.ametsoc.org/view/journals/atsc/69/1/jas-d-10-05007.1.xml`
- NOAA AOML 关于内核干空气卷入与下沉气流的总结：`https://www.aoml.noaa.gov/hurricane_blog/paper-on-how-dry-air-interacts-with-clouds-in-the-cores-of-tropical-cyclones-published-in-geophysical-research-letters/`
- Hurricane Rita 次级眼墙观测：`https://journals.ametsoc.org/view/journals/atsc/68/8/2011jas3715.1.xml`
- TRMM 同心眼墙垂直结构：`https://journals.ametsoc.org/view/journals/atsc/69/3/jas-d-11-0119.1.xml`

## 2. 新增“残破中心/外眼墙样强对流”机制

`PrecipitationModel.ts` 新增 `fragmentedCore` 机制。

触发条件包括：

- 干空气已经进入内核；
- 眼墙完整度下降；
- `isStructureDamaged / isCoreDisrupted`；
- `dry_slot_eroding / dry_leaf / incense_coil / westerly_sheared / landfall_disintegrating / rainband_dominant` 等结构阶段。

它不是新的完整 CDO，而是由三部分组成：

1. 残余内眼墙/小核心强对流；
2. 半径更大的部分外眼墙样强对流环；
3. 两者之间的残余中心云雨区。

这些结构在方位上是不完整的，并随台风环流逆时针演变。干槽侧明显减弱，湿润侧和残余眼墙弧可以维持高雨率。

## 3. 干空气不再重复删除湿侧强降水

2.6.3 中，残余 CDO 已经过一次干槽方位削弱，随后中心降水又被统一的干空气因子再次明显压低，导致同一干空气影响被重复计算。

2.6.4 中：

- 干空气的主要影响保留在方位侵蚀上；
- 湿侧残余眼墙弧不再被第二次大幅统一乘小；
- 干槽侧仍可出现近乎无深对流区域；
- 台风整体强度仍由 Engine 的干空气机制正常减弱，降水模型不会反过来维持不合理强度。

## 4. 允许损坏核心产生 500 mm 以上累计

之前 24h 产品把 500 mm 以上几乎只授权给“完整紧凑 CDO/眼墙”或极小随机极端单体，因此一个已经结构损坏、但仍有持续强残余眼墙/部分外眼墙的台风容易被错误压到 250–500 mm 以下。

本版新增：

- `fragmentedCoreRainAccum`
- `fragmentedCoreHeavyHours`
- `fragmentedCoreShare`
- `fragmentedCoreExtremePermission`

只有当残破中心/外眼墙样机制在某格点持续贡献数小时、且峰值雨率足够高时，才允许累计突破 500 mm。

这意味着：

- 残余眼墙、部分外眼墙、紧凑残破中心可局地出现 500–800 mm；
- 普通大范围雨带仍主要限制在 500 mm 以下；
- 广域层状雨/中低雨盾不能因为持续时间长就制造大片 500–800 mm。

## 5. 强降水尺度

本版把损坏内核处理成几十至约百公里尺度的强降水结构，而不是单个像素，也不是几百公里完整圆盘：

- 残余内眼墙：大致跟随 RMW；
- 外眼墙样部分环：通常位于约 1.5–2 倍 RMW；
- 方位宽度随眼墙完整度和结构损伤变化；
- 中心仍可有残余强对流，但如果存在明确风眼，风眼仍保留低降水孔洞。

## 6. 验证

未执行 npm、npx、npm install、npm run 或 npm build。

执行：

`tsc -p tsconfig.json --noEmit --noCheck`

语法检查通过。

另外对 50 m/s、核心干空气暴露约 0.66、眼墙明显受损的合成状态做了数值抽样：残破眼墙/外眼墙样区域可维持约数十 mm/h 的局地小时雨率；登陆后 8 小时的相似受损状态仍保留强残余环，而非中心降水直接归零。
