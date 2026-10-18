# TyphoonSIM 2.4.17 更新说明

本版本针对用户提供的“完全相同参数”对照进行了专项修正：2.4.16 的过去24小时降水图在台风已经登陆、仍保持较强环流且核心受干空气侵蚀的情况下，几乎只剩少量 25–50 mm 浅蓝色斑块；而中央气象台参考图在相近结构/参数下仍存在大范围 50–100 mm、100–250 mm，并伴有紧凑的 250–400/400+ mm 中心。这个差异不是配色问题，而是登陆后的水汽和累计机制把降水重复削弱了。

## 主要原因

1. `PrecipitationModel.ts` 在登陆后先用 `moistureReservoir` 强烈降低 `moistureTransport`。当储备下降时，环境本身仍可能很湿、低层环流仍可从海上输送水汽，但旧逻辑会把所有雨带/核心一起压低。
2. 干空气侵入后的强台风同时受到 `landConvectiveMemory`、`landfallDispersal`、`landBreakupProgress`、结构损伤和最终水汽储备乘法，多项作用在同一物理过程上，导致残余湿侧眼墙/小核心被重复删除。
3. 24h产品为了控制早期版本过大的浅蓝/深蓝雨盾，对 broad/stratiform 累计做了较强压缩；当登陆后的残余核心被错误归入 broad 类时，100–250 mm 原始累计可以被压成 25–50 mm。

## 2.4.17 修改

### 1. 登陆后水汽输送不再只由本地储备控制

新增 `advectedLandMoistureFloor`。对已经登陆的系统，水汽供给下限同时由：
- 环境湿度/季风水汽输送；
- 七级风圈代表的大尺度环流；
- 当前仍然较强的残余涡旋；
- 目标点距海岸距离

共同决定。

这并不代表陆地上无限维持海洋热力供给；它只防止“本地储备较低 = 整个环流立即没有可降水水汽”的非物理跳变。

### 2. 残余湿核/湿侧眼墙新增独立持续性

新增 `residualLandCorePersistence`。对于：
- 当前仍为较强台风；
- 或登陆时很强、尚处于降水记忆时段；
- 或干空气已经侵入，但对面仍有湿润眼墙弧/小核心

的系统，登陆后的核心降水不会再被多个破碎/衰减系数重复相乘到接近零。

干空气侧仍然保持明显缺口；这里恢复的是“仍活着的湿侧核心”，不是把破坏后的台风重新画成完整对称 CDO。

### 3. 内陆雨盾跟随残余涡旋维持

`inlandRainSupport` 现在取“储备水汽诊断”和“残余核心+环境水汽诊断”中的较强者。这样同一套参数下，中心深入陆地但仍有较大环流/较强强度时，可维持连续的中到大雨和局地暴雨，而不是只在沿海留少数小块。

### 4. 修正24小时累计产品的过度压缩

`ObservedRainfallMap.ts` 新增：
- `landfallOrganizedHours`
- `landedRainResidenceHours`
- `inlandFocusedRainAccum`
- `landfallPersistenceScore`

只有网格点在 24h 窗口中真正被登陆后的组织化核心、残余涡旋或中尺度降水覆盖数小时，累计映射才会放松。目标是恢复 CMA 参考图常见的：
- 有限但连续的 25–50 mm 区；
- 更明显的 50–100 mm 区；
- 有组织的 100–250 mm 叶瓣；
- 紧凑的 250–400/400+ mm 极值。

远离台风中心、只经历弱层状雨的地区仍沿用较强压缩，因此不会回到早期版本“大面积浅蓝/深蓝圆盘”的问题。

## 资料依据

- Kimball (2006), *A Modeling Study of Hurricane Landfall in a Dry Environment*, Monthly Weather Review. 研究指出，登陆附近干空气会气旋式卷入核心，但大尺度湿润包络和雨带可在一段时间内保护内核；靠近海岸时仍存在海洋暖湿气流供给。
- Kimball (2003), *Asymmetric Structures in a Simulated Landfalling Hurricane*, Journal of the Atmospheric Sciences. 近岸阶段仍可由海洋侧输送高 θe 暖湿空气并气旋式卷入核心。
- Hill & Lackmann (2009), *Structure and Evolution of Rainfall in Numerically Simulated Landfalling Hurricanes*, Monthly Weather Review. 登陆后平均雨率下降，但雨区可变宽，局地摩擦辐合和陆面湿度仍能造成显著累计降水。
- Riemer & Montgomery /相关干空气理想化研究（JAS 2012）表明，核心干空气更典型的结果是显著方位不对称和某些眼墙扇区少雨，而不是整个内核同步无雨。

## 验证

- 未执行 `npm`、`npx`、`npm install`、`npm run` 或 `npm build`。
- 使用环境已有 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --noCheck`，通过。
- 单独转译 `PrecipitationModel.ts` 做了登陆后干空气侵入的径向/方位数值抽样；在同一测试状态下，核心及 100–300 km 内陆雨率较 2.4.16 明显恢复，同时保留干槽侧弱、湿侧强的非对称。
