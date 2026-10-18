# AETHER 4.1.5 桌面端 / 气象产品重构说明

本版本在 Hurricane Tracker 迁移版基础上完成桌面端本土化。参考界面只用于交互和业务图布局，不再把产品品牌、按钮语义或菜单结构照搬为 STORM_INC / ICWC。

## 桌面操作

- 方向键：连续控制台风移动矢量；斜向自动归一化。
- 标准手柄左摇杆：无级控制台风；D-pad 可作为数字备用输入。
- Space / 手柄 A：开始或暂停。
- `[` / `]`、手柄 LB / RB：前后时次。
- `P` / 手柄 X：AETHER 气象产品中心。
- `O` / 手柄 B：台风状态 / 强制影响。
- `G` / 手柄 Y：设置。
- `T` / 手柄 Start：展开/收起详细时间轴。
- 鼠标滚轮：无级地图缩放；Shift/Leaflet 框选缩放仍可用。
- 鼠标中键：有活动台风时移动当前中心；无活动台风时在该位置生成下一台风。
- 鼠标悬停实况/预报路径节点：显示引导线、时次、气压、位置，以及当前所选 CMA/JMA/JTWC 与公开/无级口径的风速。

## AETHER 桌面 UI

- 顶部统一为 `AETHER · TYPHOON SIMULATION SYSTEM`。
- 删除重复右上菜单，只保留一个顶部命令区。
- 底部 Dock 的图标与实际动作重新对应：播放、前后时次、产品中心、台风状态/影响、详细时间轴、停编。
- 左侧台风卡不再重复品牌 Logo，改为台风状态工作区，并增加高度自适应滚动。
- 右下强度曲线、左侧结构卫星缩略图和底部 Dock 在较矮/较窄桌面屏幕上有单独布局规则。

## Hurricane Tracker 多模型

八组 StormModel 参数仍按 Unity 发行版恢复，但其共同大尺度轨迹现在锚定在 AETHER 正常预报路径或用户绘制的总路径框架上。Unity GFS 为零偏差参考，其余模型保留相对 GFS 的原始离散偏差。

## 结构卫星云图与性能

Hurricane Tracker 的 Strength / CloudCover / Noise / Seed / Hemisphere / Normal-IR 继续决定基础云体；AETHER 的干空气侵入、风切、眼墙完整度、开放扇区、风眼状态、爆发对流等变量再破坏或重建该云体。

主地图不再对整个屏幕逐格调用云函数，而是每个台风生成局地 144×144 Tile 并缓存。左侧状态卡复用同一尺寸缓存；云图单独使用较低重建频率，雷达仍保持更快刷新。

## 统一 AETHER 产品中心


桌面宽屏下产品中心采用左侧目录 + 中央实时预览 + 右侧参数区；窄桌面自动隐藏中央实时预览并让参数区扩展。

## 气象图修复

- Natural Earth 多边形不再通过“删除视窗外顶点后闭合”裁剪，改为保留完整环并使用 Canvas clip / even-odd 填充，修复 500/200 hPa 图中的巨大斜三角陆地区域。
- 34/64 kt 概率产品使用连续二维概率栅格，不再以一串离散绿色圆表示。
- 警报图改为连续预报不确定性包络、参考轨迹、节点和业务图例。
- 高度场/气压场加入主要等值线标签；所有新增产品统一 AETHER 抬头、水印和模拟资料警告。

## 2026-09 Desktop finalization pass

This pass completes the desktop-oriented rework and removes the last runtime satellite/cloud path.

- Runtime simulation windows and layers no longer contain a cloud/satellite overlay. `ActiveLayers` no longer exposes `clouds` or `cloudMode`, `MapView` does not import the Hurricane Tracker cloud renderer, and old saves cannot silently re-enable it.
- The only Hurricane Tracker cloud synthesis entry is **AETHER 产品中心 → 高精度卫星云图合成**. It is export-only/on-demand and reads AETHER structural state (dry-air core exposure/connection, VWS, eyewall integrity/open sector, eyewall wrapping and eye-formation memory).
- Product-center rendering is explicitly lazy. Opening the workstation or changing tabs no longer runs map/contour/probability/cloud renders. The large Natural Earth product plate and OSM label scan are also deferred until an explicit preview/export request. Obsolete scatterometer/OLR/water-vapor/simulated-radar UI/render code was removed from the product modal.
- The desktop product center is a three-region workstation: persistent product navigation, isolated preview viewport, and independently scrollable controls with a sticky generation dock. The satellite synthesis page uses a lightweight structural diagnostic diagram instead of a hidden live cloud canvas.
- Typhoon report pages were refined for desktop: independent parameter scrolling, fixed large preview viewport, preview metadata toolbar, responsive KPI layout, and low-height desktop handling.
- AETHER multi-model guidance uses eight internal model families (WNV3/FNV3/ECMWF/AIFS/GEFS/AIGEPS/HGEFS/GEM). Center guidance is anchored to the normal or drawn AETHER forecast. Multi-member mode supports 50–500 members **per selected model** in steps of 50 using time-correlated cross-track/along-track and intensity perturbations.
- The new structural physics regression protects stateful eye formation, direct dry-air/shear ventilation weakening, forecast-side ventilation mirroring, EWRC failure/rebuild scars, and the product-only satellite rule.

The model-family names are visual/simulation families and do not mean that AETHER downloads or executes real operational ECMWF/GFS/WNV3 numerical model output.

## 2026-09-18 v4 hotfix: runtime layer state + satellite palettes

- Fixed the desktop startup/runtime crash caused by two stale `activeLayers` references in `MapView.tsx` after the cloud-layer removal. The map now initializes and synchronizes `layersRef` from the actual `layers` prop.
- Split `ActiveLayers` and other interface-only imports into `import type` declarations so no interface name can leak into the emitted browser module as a runtime dependency.
- Added three selectable high-resolution structural-satellite fill standards: **RAMMB**, **OTT**, and **Infrared**. The selector is stored in `forecast_satellitePalette` and applies only to the product-center satellite synthesis.
- RAMMB uses a brightness-temperature mapping following the documented CIRA/RAMMB Enhanced-V RGB breakpoints. AETHER first maps its structural cloud density to a synthetic long-wave IR brightness temperature; the palette changes only color rendering and does not alter cyclone structure.
- OTT is implemented as a classic tropical-cyclone enhancement-style curve because a stable authoritative numeric OTT lookup table was not available in the supplied project materials. It is intentionally treated as a visualization style rather than an observational calibration.
- Infrared is an unenhanced grayscale long-wave IR rendering (warm/thin cloud darker, colder/deeper cloud brighter).
- Satellite tile cache keys now include the selected palette to prevent stale colors when switching standards.

## v5 — guidance / synoptic / neutral glass / performance rework

This revision responds to generated-product QA rather than changing only presentation.

- **Unified multi-model guidance:** live-map centre guidance and exported multi-model products now use the same `buildAetherCenterGuidance()` pipeline and the same 3-hour issue cycle. Forecast-path `simHour` values are normalised as lead hours when appropriate; historical absolute hours are handled separately. This fixes the former product/live-map divergence and the large loops caused by interpreting lead hours as absolute simulation time.
- **Coherent ensemble spread:** 50–500 members per selected model use low-frequency along-track, cross-track, intensity and timing error modes around that model's own deterministic centre. Member 1 is a true control. Track and intensity differences therefore grow coherently with lead time instead of pointwise zig-zag noise.
- **Intensity guidance:** deterministic model lines carry intensity-coloured points and the external legend reports model peak wind/minimum pressure. Member products use intensity-coloured segments and a maximum-wind/minimum-pressure ranking.
- **Geographic projection:** product maps preserve local physical aspect ratio (`cos(latitude)` correction), unwrap longitude rings before drawing Natural Earth polygons and reserve the legend/ranking sidebar outside the map. This removes the stretched Korea/Japan geometry and long polygon closure artifacts.
- **Neutral liquid-glass UI:** desktop chrome, report workspaces and station detail workspaces use black/white/graphite translucent glass, blur, neutral glow and inset highlights. Meteorological categorical colours are retained only where they encode data.
- **Station detail layout:** charts are two-column on wide desktops and one-column on narrower screens, with larger fixed chart frames so axes and curves do not collapse into four narrow columns.
- **Runtime performance:** expensive Leaflet path/radius rebuilds are throttled more aggressively while the cyclone centre remains RAF-interpolated; multi-model guidance is cached across each 3-hour issue cycle; React simulation UI commits are reduced. Product generation remains explicitly on-demand and no satellite cloud renderer runs during simulation.

The eight model names remain **AETHER simulation guidance families**; this program does not download operational ECMWF/GFS/WNV3 fields.
