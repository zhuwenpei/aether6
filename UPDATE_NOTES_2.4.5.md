# TyphoonSIM 2.4.5 更新说明

本版针对用户提供的 TyphoonSIM 2.4.4 降水图与中央气象台 24 h 降水参考图继续回标，同时重做 CDO/风眼、登陆后对流衰减、台前飑线和螺旋雨带的生命周期。修改重点不是替换色表，而是把“强对流何时存在、在哪里存在、能持续多久”从宽广的径向常驻项拆成可演变的结构过程。

## 1. 登陆后对流不再瞬间减弱

旧版本有两类会造成“上岸即跳变”的叠加：一是结构模式过早进入 `landfall_disintegrating`，二是卫星云图在 `structuralState === 6` 时直接把移动方向一侧云密度乘 0.5。2.4.5 删除这种瞬时半球削弱。

新过程：

- 登陆后最初约 0–6 h 保存明显的海上深对流/湿熵记忆；
- 约 3–4 h 后才逐步增加 CDO/眼墙缺口和雨带重组；
- 6 h 后根据水汽储备、结构紊乱、干空气、风切等逐步提高衰减速度；
- 轻中雨和外围雨盾比紧凑眼墙/强 CDO 衰减更慢；
- 卫星云图、降水模型使用相同的 `landHours` 连续时间尺度，避免物理状态和可视化互相矛盾。

参考：Marchok et al. 对美国登陆热带气旋雨量统计的简化模型指出，内侧径向区的雨率在登陆后的最初约 6 h 变化较慢，之后才呈更明显的指数型衰减，而且并非直接衰减到零。Monthly Weather Review / Weather and Forecasting, “Evaluation of GFDL and Simple Statistical Model Rainfall Forecasts for U.S. Landfalling Tropical Storms”.

## 2. CDO 与风眼机制重做

- 成熟 CDO 只在 `Vmax >= 32.7 m/s` 且眼墙完整度、结构完整性、对流抑制满足条件时生成；
- CDO 诊断直径限制为 100–150 km；
- 健康成熟 CDO 使用更平坦的密集内核分布，风眼作为 CDO/眼墙中的明确低云/少雨孔洞；
- 低强度 TD/TS/STS 不再被 `loose_cdo` 的旧标签强行画成成熟 CDO，也不会使用历史遗留的风眼半径；
- 已成熟的 CDO 登陆后保留几小时连续性，随后才随 `landHours`、`structuralDisorganization` 和水汽储备出现宽尺度缺口、破损并降低强对流；
- 减弱中的外围环流尺寸不与 CDO 同步收缩。

NOAA/NHC 将 CDO 定义为覆盖眼墙或最紧密内雨带的稠密云团；NOAA/AOML 的说明还指出，在达到约飓风/台风强度前，CDO 往往表现为均一冷云顶而没有清晰眼，达到约 33 m/s 后才常可在卫星图像中识别眼。因此本版把成熟风眼/CDO门槛和台风强度附近相联系，而不是让低强度热带风暴拥有成熟眼/CDO。

## 3. 登陆后“环流大小”与“对流/峰值风”解耦

新增陆地松散环流扩展下限：登陆后中心风和深对流可下降，但 `circulationExpansion` 不会因为 Vmax 同步下降而快速归零。随着登陆时间和结构紊乱增加，外围环流可保持原尺度或略变大，雨带/层状云雨向外围重新分配。

这与热带气旋强度和尺度并非一一对应的观测/理论认识一致；已有理想化研究也能得到成熟后强度下降而眼墙半径与外围大风半径继续扩大的演变。

## 4. 台前飑线改为“一次性近岸概率事件”

旧版 `preStormSquall` 是一个几何项，只要条件满足就一直存在，看起来像固定外挂的一条飑线。2.4.5 改成持久化事件状态：

- 仅当台风中心仍在海上、距海岸大约 70–520 km、强度和水汽条件满足且总体接近海岸时评估一次；
- 发生概率为约 0.31–0.51 的动态范围（平均目标约四成量级），未触发也会记住“本次已评估”，不会每 10 min 反复抽签；
- 触发后持续约 3.2–4.9 h；
- 位于移动方向右前方，事件本身移动约 40–56 km/h，并逐渐从母体台风前方甩远；
- 线体使用 broken-line + trailing-stratiform 结构，生命周期结束后迅速消散。

Meng et al. (2012) 对 2007–09 中国登陆台风雷达资料的统计显示，约 43% 的登陆台风伴有台前飑线；典型飑线位于中心前方约 600 km、路径右侧约 36°，平均寿命约 4 h，常以 broken-line 方式组织并带 trailing stratiform。因此本版不再让每个近岸台风永久带一条台前飑线。

## 5. 螺旋雨带对流改为散装爆发

雨带仍有可维持的弱/中雨背景和层状部分，但深对流不再沿整条螺旋线常驻：

- 每约 3.2 h 生成一组短寿命嵌入式对流簇；
- 每组仅有少量径向/方位局地单体；
- 单体在周期开始和结束时归零，中间达到峰值；
- 外雨带极端单体仍可偶发，但其空间宽度和持续时间都受限；
- 24 h 累计会留下几个较宽的雨带叶瓣/局部高值，而不是完整的强对流螺旋圆环。

飞机/雷达研究表明，眼墙外的雨带通常由层状降水和嵌入其中的对流单体组成，外雨带对流明显更“cellular”，且沿雨带存在新生、成熟、衰减为层状降水的生命周期。

## 6. 24 h 降水图继续按 CMA 参考图回标

对用户提供的 2.4.4 模拟图做颜色面积抽样后，100–250 mm（洋红）占比约 54%，而两张 CMA 参考图约 20–26%；模拟图的 25–100 mm 占比反而明显不足，同时 250–400 mm 的小高值核太少。这说明问题不是单纯“总雨量太大”，而是**中等偏强雨量被铺得太宽，局地极值又不够集中**。

本版做了三层修改：

1. **物理场几何**：外围雨盾不再只使用圆形径向衰减；切变相对 wavenumber-1、移动方向、低波数 wavenumber-2/3 和慢变水汽组织共同改变“有效半径”，直接把等值面拉成不规则叶瓣。
2. **强对流时空占空**：100–250 mm 和以上等级更依赖短寿命雨带单体、眼墙/CDO、地形训练、平原残余对流中心等聚焦机制，不再由宽广水汽盾长期维持中高小时雨率。
3. **累计产品映射**：不再只看 24 h 总量。每个格点同时统计 `peakRate` 与 `focusedConvectiveHours`。持续 6–10 mm/h 的广阔雨盾会更多落在 25–100 mm；只有真正出现高峰雨率/长时间对流驻留的格点才能保持 100–250、250–400、400+ mm 的陡峭尾部。

目标是更接近 CMA 图常见结构：**大片浅蓝/蓝（25–100） + 数个不规则洋红叶瓣（100–250） + 很小的暗红/橙色极值核（250/400+）**，而不是以台风中心为圆心的大面积完整洋红圆盘。

## 7. 代码位置

主要修改：

- `src/simulation/Engine.ts`
- `src/simulation/PrecipitationModel.ts`
- `src/components/SatelliteCloudModal.tsx`
- `src/utils/ObservedRainfallMap.ts`
- `src/types.ts`

新增的台前飑线事件字段写入实时状态与历史快照，时间轴回放不会重新随机生成事件。

## 8. 验证与构建说明

按要求，本次没有执行：

- `npm`
- `npx`
- `npm install`
- `npm run`
- `npm build`

仅使用系统环境中已经存在的 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --noCheck` 做 TS/TSX 语法解析，并使用 ZIP 完整性检查验证最终压缩包。

## 资料来源

- National Hurricane Center, Glossary — Central Dense Overcast (CDO).
- NOAA/AOML Hurricane FAQ — CDO and tropical-cyclone eye description.
- Meng, Z., D. Yan, and Y. Zhang, 2012: *On the Squall Lines Preceding Landfalling Tropical Cyclones in China*. Monthly Weather Review, 140, 445–470.
- Houze, R. A., 2010: *Clouds in Tropical Cyclones*. Monthly Weather Review, 138, 293–344.
- Jorgensen, D. P., 1984: *Mesoscale and Convective-Scale Characteristics of Mature Hurricanes. Part I*. Journal of the Atmospheric Sciences, 41, 1268–1285.
- Kilroy, G., and R. K. Smith, 2016: *Why Do Model Tropical Cyclones Grow Progressively in Size and Decay in Intensity after Reaching Maturity?* Journal of the Atmospheric Sciences, 73, 487–503.
- *Evaluation of GFDL and Simple Statistical Model Rainfall Forecasts for U.S. Landfalling Tropical Storms*, Weather and Forecasting, 22, 56–70.
