# Hurricane Tracker → AETHER 4.1.5 迁移说明

本分支将 Hurricane Tracker（Unity 2018.2.1f1）的 StormSystem / StormModel 核心机制迁入 AETHER，并在后续桌面重构中做了 AETHER 本土化：Unity 云场负责基础形态，AETHER 结构状态负责干空气、风切、眼墙破损等真实模拟反馈；Unity 多模型偏差则围绕 AETHER 正常或手绘预报路径展开。迁移依据包括用户提供的静态分析文档，以及对发行版 `Assembly-CSharp.dll` 的进一步只读 IL 核对。

## 1. 卫星云图 / StormSystem

运行时地图的 `clouds` 图层以 `src/simulation/HurricaneTrackerPort.ts` 的 Hurricane Tracker 云体为基础，不再使用旧 AETHER 云图渲染器；但最终密度场会读取 AETHER 当前模拟出的结构状态，使干空气侵入、风切、眼墙开放、风眼阻塞/清空、爆发对流和核心重构疤痕真实反映在云图上。

已按 IL 恢复并使用：

- `I` 键：Normal / IR 模式切换。
- 南北半球 `_Flipped` 对应的反向旋转。
- `StormSystemScript.Start()`：
  - `annular = Random.Range(1, 10) < 2`；浏览器端改为同概率的稳定哈希，保证读档/重绘不跳变。
  - `strengthUniqueness = Random.Range(-1, 1) / 10`。
  - `cloudCoverUniqueness = Random.Range(-5, 1) / 10`。
  - Shader `_Seed` 的随机思想以每风暴稳定 seed 重建。
- `StormSystemScript.Update()`：
  - `windspeed < 10 mph` 时，`CloudCover = Clamp(1.5 - (windspeed/10)/2 + uniqueness, 0.5, 1.5)`。
  - 其他情况，`CloudCover = Clamp(1 - windspeed/200 + uniqueness, 0.3, 1)`。
  - `Strength = Clamp(windspeed/75 + uniqueness, 0.4, 2)`。
  - AETHER 的 `vmax` 为 m/s，进入上述 Unity 算法前统一转换为 mph。
  - 原游戏旋转积分对应约 `150° × Strength / simulated day`，并按半球反转。
- Normal 与 IR 共用同一云体几何，只更换最终色彩分支。
- AETHER 结构耦合：`dryAirIntrusion / dryAirCoreExposure / dryAirCoreConnection / dryAirWrapFraction / drySlotBearingDeg / shear / shearDir / eyewallIntegrity / eyewallOpenSectorFraction / eyeRadiusKm / eyeClearance / eyeObstruction / coreRebuildScar / convectiveBurstIndex`。
- 地图与左侧状态卡共用 144×144 局地云图 Tile 缓存；缓存按 0.5 模拟小时及结构指纹量化，避免逐屏逐像素反复计算。

无法 1:1 恢复的部分：`Nature/Storm` 的最终 Pixel Shader 仅以编译 DXBC 存在；`StrongHeight1` / `Annular1` 的像素采样公式没有源码。因此浏览器端重建了同样的数据流（固定风暴纹理族思想 + Noise + Seed + Strength + CloudCover + Annular + Hemisphere + Mode），但最终像素级函数不是逐指令 DXBC 翻译。

## 2. Hurricane Tracker 离散多模型路径

AETHER 原先 50–200 成员的集合扰动算法已从产品入口和 `Engine.ts` 的集合专用配置/分支中移除。当前多模型路径使用 Hurricane Tracker 的八组 `StormModel`：

| 模型 | resolution | iStep | length | Unity 颜色 |
|---|---:|---:|---:|---|
| ICON | 15 | 500 | 6 | Blue `#0000ff` |
| GFS | 15 | 225 | 5 | Green `#00ff00` |
| GFS2 | 15 | 325 | 5 | `(0, 0.2, 0)` `#003300` |
| GFS3 | 15 | 425 | 5 | `(0, 0.7, 0.5)` `#00b380` |
| EURO | 8 | 200 | 6 | Yellow `#ffff00` |
| EURO2 | 8 | 150 | 6 | `(0.2, 0.2, 0)` `#333300` |
| EURO3 | 8 | 250 | 6 | `(0.65, 0.4, 0)` `#a66600` |
| HMNI | 5 | 10 | 7 | White `#ffffff` |

每一步保持原 IL：

```text
futureTime = Spawner.getTime()
           + (iStep / 200)
           * (i / resolution)

wind = Spawner.getWind(pos, futureTime, stormToIgnore)
delta = wind / resolution * length
pos += delta
```

所有“模型”严格共享同一个 `Spawner.getWind()` 风场；模型名不会改变 seed。它们并不是真实 ICON/GFS/ECMWF 数据。

### 2.1 AETHER 基准路径锚定

当前并不是让这八条 Unity 路径脱离 AETHER 自由运行。系统先取得 AETHER 正常 120h 预报路径；若用户绘制了总预报路径框架，则使用应用该框架后的 AETHER 预报路径。随后以 Unity GFS 作为零偏差参考，计算其他 7 个 StormModel 相对 Unity GFS 的经纬度偏差，并把这些偏差叠加到 AETHER 基准路径。这样 GFS 与 AETHER 基准重合，其余模型保留原 Unity 参数造成的离散程度，同时整体趋势遵循 AETHER/手绘路径。

### 2.2 Spawner.getWind / getJetstream

已直接从 DLL IL 恢复下列数值链：

- `Spawner.scale = 5`。
- 基础风：`(-0.68, 0, 0.35 * hemisphereSign)`。
- 两个互换坐标的 `Mathf.PerlinNoise` 项：X 振幅 2.0，Z 振幅 1.2。
- `getJetstream()`：
  - `time /= 2` 后加全局 `seed`。
  - X 坐标先乘 `12.8`。
  - 北/南急流中心为 `+118 / -118`，共同使用 `±30` 的 Perlin meander，最终除 `12.8` 返回世界坐标。
- 急流作用：使用局地切向量，距离项为 `Clamp(0.003 * distance², 1, +∞)`。
- 其他风暴扰动：
  - `strength = other.windspeed / 50`（先由 AETHER m/s 转 mph）。
  - `distanceFactor = Pow(Distance * 12.8, 1.4) / 10`。
  - 保留 IL 中主旋转项与 `/6` 的次级径向/切向项，再 `/2 * strength` 加到风场。
- `Spawner.seed = Random.Range(-9999, 9999)`；AETHER 使用同范围稳定哈希，以保证同一存档可重复。
- AETHER 模拟小时通过 Unity 默认 `dayLength=25`、`timeScale=200` 映射到 `Spawner.getTime()`：`unityTime = simulationHour / 192`。

`Mathf.PerlinNoise` 是 Unity 原生函数，浏览器端使用固定 permutation 的 improved Perlin 等价实现；这是 `getWind()` 中唯一无法逐字节调用原 Unity Native 实现的基础数学原语。

## 3. UI / 操作

- 地图图层：`Hurricane Tracker 卫星云图`。
- Normal / IR：设置抽屉按钮，或键盘 `I`。
- 主地图离散多模型路径：图层开关，或键盘 `M`；路径族围绕 AETHER 正常/手绘预报路径。
- 气象图产品中的原集合预报入口已替换为 `离散多模型预测路径`，固定计算 8 组 StormModel，不再提供 50 / 64 / 100 / 200 成员数量选择。

## 4. 保留的 AETHER 功能边界

- AETHER 普通 120h 确定性预报路径、预报锥仍保持原算法；它们不是本次替换对象。
- 雷达、SST、OHC、环境场等产品保持原实现。
- `CloudCompositorModal` 是 NASA GIBS 实景影像搬移/合成工具，作为独立外部卫星产品保留；AETHER 的“结构卫星影像”使用 Hurricane Tracker 基础云场 + AETHER 结构状态。

## 5. 回归测试

新增 `npm run test:hurricane-tracker-port`，覆盖：

- 8 组模型参数及颜色；
- Unity 80×40 经纬度坐标映射；
- 1/192 时间桥；
- 统一风场 seed；
- 每条路径点数；
- Normal / IR 共用几何；
- Strength / CloudCover 范围；
- `scale=5` 与邻近风暴距离律等已恢复常量。
