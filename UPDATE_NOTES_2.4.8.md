# TyphoonSIM 2.4.8 更新说明

## 本轮目标

本轮只围绕三个问题继续修正：完整台风的强降水中心不能被机械偏置；低平、湿润、环流很大的陆上热带风暴需要更合理的缓慢衰减平台；气象站风/阵风必须把粗地形暴露与强对流经过纳入计算。

## 1. 完整 CDO 与偏置强降雨重新分工

此前降水场的环境非对称会对较大范围同时生效，因此即使 CDO/眼墙结构仍很完整，也可能把整个强降水核心从中心推开。2.4.8 将其拆分为两类：

- **完整内核**：达到台风强度、存在成熟 CDO/眼墙且核心完整时，CDO/眼墙约 100–150 km 内的降水获得轴对称保护；强风切、干空气和结构损伤越强，保护越弱。
- **偏置强雨**：明显离心的强降雨主要交给“沿海有组织雨带包”产生。事件约每数小时重新组织一次，可以从任何象限甩上岸；在中国东部登陆环境中仅给予西、西北、北三个象限更高概率，而不是强制固定北侧。
- **入陆衰减**：雨带强对流使用真实/几何海岸距离衰减，离海岸几十到一百多公里后深对流迅速下降，避免一条海上强雨带原强度直插内陆。

研究依据：弱垂直风切时眼墙/雨带降水更接近轴对称；随风切增强才逐渐出现明显下风切/左侧最大值。完整核心因此不能默认被整体平移。与此同时，实际登陆过程中的外围雨带可形成独立强降雨中心。

参考：
- Rios-Berrios et al. (2024), *A Review of the Interactions between Tropical Cyclones and Environmental Vertical Wind Shear*, JAS. https://doi.org/10.1175/JAS-D-23-0022.1
- Chen et al. / TC rainfall review: weak shear is more symmetric, increasing shear concentrates precipitation downshear/left-of-shear. https://doi.org/10.6057/2018TCRR02.03
- 2019 Lekima observational summaries show separate extreme-rain centers connected with peripheral/outer spiral bands while the storm moved inland and northward.

## 2. 真实粗地形与平原 18 m/s 残余环流

项目继续使用包内已经离线化的 **NOAA/NCEI ETOPO1 派生 0.25° 西北太平洋粗地形场**。本轮没有在运行时请求网络数据，因此离线运行不受影响；新增的是对这个真实地形来源的诊断利用：

- 局地高程；
- 东西/南北坡度；
- 约 50–110 km 邻域起伏；
- 平原度；
- 山脊暴露/谷地遮蔽；
- 长江中下游平原、华北平原的区域置信度，但只有当地形格点本身确实低平时才生效，区域框不能把山地“硬判成平原”。

陆上衰减新增/强化软平台：当 Vmax 约 14–21.5 m/s、大七级风圈、水汽储备充足、风切较弱、干空气不强且地形低平时，衰减率可以降低到每天只有几十分之一到几十分之几 m/s 的量级，使强度在约 17.5–19 m/s 附近维持较长时间。它不是把 Vmax 锁死在 18 m/s：水汽消耗、环流缩小、进入丘陵山地或环境转差后，会自动恢复普通陆地衰减。

这与理想化研究中“强台风登陆前 12 h 迅速衰减，但降到热带风暴强度后减弱变慢，较湿土壤的潜热通量可维持更大的外侧环流/对流”一致。2026 年巴威也提供了近期实例：中央气象台 7 月 13 日 17 时定位其中心在江苏新沂境内，外围最大风力 8 级 18 m/s，并预计强度变化不大；当天早晨在安徽内陆仍为 20 m/s。2019 利奇马同样具有长时间陆上滞留、巨大环流和持续北上影响。

参考：
- Hlywiak & Nolan (2021), *The Response of the Near-Surface Tropical Cyclone Wind Field to Inland Surface Roughness Length and Soil Moisture Content during and after Landfall*, JAS 78, 983–1000. https://doi.org/10.1175/JAS-D-20-0211.1
- 中央气象台/中国天气网，2026-07-13 巴威热带风暴：江苏新沂 18 m/s，强度变化不大。https://m.weather.com.cn/news/2026/07/4716115.shtml
- 中央气象台业务总结：利奇马在陆地时间长达 44 h。https://qxqk.nmc.cn/html/2021/8/20210808.html
- NOAA/NCEI ETOPO1: Amante & Eakins (2009), 1 Arc-Minute Global Relief Model.

> 注意：0.25° 地形只用于模拟器的中尺度地形/平原判断，不作为站点测绘高程或工程风场资料。

## 3. 气象站地形风与强对流阵风

站点风场现在先计算台风切向风 + 低层入流 + 少量平移分量，再与 ETOPO 粗地形坡向耦合：

- 低平地区保留较高的近地面风；
- 山脊/迎风暴露可小幅增强；
- 谷地、背风坡和高起伏地形会降低持续风；
- 修正幅度保持克制，避免 0.25° 地形假装能描述建筑、峡谷或具体站址。

阵风不再只由持续风固定乘一个系数。若降水模型显示眼墙/CDO爆发、强雨带单体、极端对流单体或内陆零散强对流正经过站点，阵风因子与局地下击暴流脉冲会提高；普通层状雨区则不会获得同等加成。文献指出热带气旋异常高阵风因子常与螺旋雨带/强对流有关，同时站点暴露、上游粗糙度和地形会显著改变实测持续风与阵风。

另外，本轮将站点实际海岸距离传入降水模型，防止内陆站点被默认成“距海岸 65 km”而错误触发近岸强雨带。

## 验证

- 没有执行 `npm`、`npx`、`npm install`、`npm run` 或 `npm build`。
- 使用环境已有 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --noCheck`，TS/TSX 语法检查通过。
- 完整 ZIP 打包后执行压缩完整性检查。
