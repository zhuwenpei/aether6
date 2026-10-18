# AETHER 4.1.4 研究依据与实现边界

本文件记录本版业务图形与雷达显示所参考的公开资料。AETHER 是模拟器；参考业务规范只用于定义数据字段、图形语义和合理显示方式，不冒充任何机构实时产品。

## 1. 预报不确定性区域

NHC 对轨迹预报锥的公开定义说明：锥体是沿预报中心轨迹在各时效放置误差圆，并取这些圆扫掠形成的完整区域；圆半径来自历史预报误差统计。2026 试验产品进一步将沿轨/横轨误差拆分为椭圆。

- NHC, Definition of the NHC Track Forecast Cone: https://www.nhc.noaa.gov/aboutcone.shtml
- NHC, Experimental Tropical Cyclone Forecast Cone: https://www.nhc.noaa.gov/experimental/cone/

AETHER 4.1.4 采用这一“完整扫掠区域 + 连续封边”的几何思想修复 JTWC 风格图的缺口，但半径仍是模拟器内部诊断曲线，不宣称使用 JTWC/NHC 当前业务误差统计。

## 2. JTWC / ATCF 四象限风圈

NRL ATCF A/B Deck 字段文档明确给出：`RAD` 可为 34、50、64 kt；`WINDCODE=NEQ` 时 `RAD1/RAD2/RAD3/RAD4` 依次为 NE、SE、SW、NW 四象限半径。NRL Wind Radii 图例也说明最外层通常是 34 kt，若有第二/第三组则依次为 50/64 kt。

- NRL ATCF A/B Deck format: https://science.nrlmry.navy.mil/atcf/docs/database/new/abrdeck.html
- NRL Wind Radii graphic key: https://science.nrlmry.navy.mil/atcf/docs/graphic_key/radii.html
- U.S. Navy / JTWC wind-distribution description: https://www.navy.mil/DesktopModules/ArticleCS/Print.aspx?Article=2258791&ModuleId=523&PortalId=1

因此 4.1.4 的 JTWC 风格图直接读取模拟器 `r7/r10/r12` 的 NE/SE/SW/NW 象限结构，并按 34/50/64 kt 三层绘制，而不是用单一平均半径画同心圆。

## 3. 基本反射率与 dBZ 图例

NOAA JetStream 将 Reflectivity 定义为雷达回波能量的 dBZ 表达，并说明 Base Reflectivity 来自最低仰角扫描；反射率与降雨强度并非一一对应，滴谱/粒径会显著影响回波。该页面以飓风 Ida 为例指出，暖热带系统即使有暴雨和强风，典型回波仍常在约 35–45 dBZ，因为雨滴较小、冰雹很少。

- NOAA JetStream, Radar Images: Reflectivity: https://prod-01-alb-www-noaa.woc.noaa.gov/jetstream/reflectivity
- NWS Radar FAQ (BREF.QCD / CREF.QCD): https://www.weather.gov/radarfaq
- NWS LMRFC Z-R Relationship: https://www.weather.gov/lmrfc/experimental_ZR_relationships

NOAA/NWS 的一般说明中，层状降水常处在约 20–40 dBZ，对流雨常见约 40–55 dBZ；更高回波代表更强回波目标，但不能简单等价为固定雨强。这与 4.1.3 已完成的“浓密卫星 CDO ≠ 大面积 50–60 dBZ”机制一致。

4.1.4 地图雷达层不反演真实雷达波束传播、亮带、遮挡、衰减或具体站点拼图，而是显示模拟器内部的“近地层基本反射率诊断”。图层完全程序计算，不使用预渲染雷达贴图。

## 4. 地图取景与标签

业务预报图的视觉目标是突出“当前分析 + 未来预报 + 不确定性/风圈”，完整生成历史并不是预测图取景的必要内容。4.1.4 因此：

- NMC 风格图只保留当前前约 36 h 的分析历史参与取景；
- JTWC 风格图只保留当前前约 48 h；
- 未来预报、不确定性区域和风圈必须全部纳入边界；
- 信息框通过候选位置和碰撞面积评分避免遮挡路径与相互重叠。

这些是 AETHER 的排版优化，不声称复制 NMC/JTWC 私有制图算法。
