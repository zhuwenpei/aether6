# TyphoonSIM 3.3.26 公开资料与结构校准依据

本文件记录本次结构机制修改使用的主要公开资料方向，方便后续继续校准。它们用于规则/参数化设计，不代表模拟器复刻任何单一机构算法。

## CMA / NMC 业务产品时次

- 国家气象中心“台风路径预报”公开产品页面：历史产品列表长期显示北京时间 02、05、08、11、14、17、20、23 时滚动制作。  
  https://www.nmc.cn/publish/typhoon/probability.html
- NMC English typhoon track/intensity product：同样可见上述产品时次。  
  https://eng.nmc.cn/typhoon/publish/forecasts/track-intensity.html

实现：`CmaOperationalClock.ts` 作为全局唯一业务时钟源；主地图、风圈更新、预报刷新、视频/报告/导出节点全部引用该模块。

## 德沃夏克结构约束

- NOAA/AOML Hurricane FAQ — Dvorak technique：明确列出 Curved Band、Shear、Eye、CDO、Embedded Center / Central Cold Cover 等卫星结构模式，并用眼区与周围冷云顶温差等信息映射 T-number/CI。  
  https://www.aoml.noaa.gov/hrd/tcfaq/A7.html

实现：高强度系统即使进入西风带、风切或温带化早期，也不能因为非对称而被画成弱热带低压式云团；保留与强度相符的最低深对流/冷云覆盖，再由剪切、干空气、锋区改变空间分布。

## 1997 Winnie：失败眼墙置换、巨大外眼墙

- Zhang & Kuo 等，*Interaction between concentric eye-walls in super typhoon Winnie (1997)*：外眼墙直径约 370 km，并出现持续的同心眼墙相互作用。  
  https://rmets.onlinelibrary.wiley.com/doi/10.1256/qj.04.33
- JTWC 1997 Annual Tropical Cyclone Report：记载 Winnie 形成约 200 n mi（约 370 km）完整外眼墙云环。  
  https://www.metoc.navy.mil/jtwc/products/atcr/1997atcr.pdf
- Lander 1999 / MWR “A Tropical Cyclone with a Very Large Eye”：讨论 Winnie 外环并未按标准 EWRC 内缩替代内墙，以及大眼/同心眼墙与德沃夏克限制。  
  https://journals.ametsoc.org/view/journals/mwre/127/1/1520-0493_1999_127_0137_atcwav_2.0.co_2.xml

实现：加入 `ewrcStandoffStrength` 和 `giantEyeOuterWallMemory`，允许双眼墙对峙、内墙消亡、外墙不内缩和巨大眼长期存在；RMW 与眼区几何使用慢时间常数连续外移/恢复。

## 2023 Khanun：部分双眼墙与 moat

- NASA GPM：2023 Khanun 的 GMI/DPR 显示 moat 和 partial double eyewall，强降水外环与内眼墙之间存在较弱降水区。  
  https://gpm.nasa.gov/applications/weather/news/gpm-captures-powerful-typhoon-khanun-approaching-ryukyus

实现：双眼墙降水不是简单叠加两个圆环；模型加入 moat 抑制、外眼墙强度记忆与失败/成功置换分支。

## 海洋搅混、浅层暖水和冷尾流

- NOAA/GFDL Operational Hurricane Forecasting：热带气旋搅动海水会把下层冷水带到海面；暖表层较浅时冷水更容易上翻并明显削弱气旋，深厚暖水则更支持高强度。  
  https://www.gfdl.noaa.gov/operational-hurricane-forecasting/

实现：东海/黄海陆架不是硬上限，而是基于位置、强度、移动速度、风圈尺度和 OHC 的连续混合应力；>62 m/s 时正强度趋势被明显压制。

## 西风带、温带化、暖输送带和锋面云系

- NOAA/AOML Extratropical Transition：热带气旋进入高纬后会遇到更强温度梯度、更大风切和更低 SST，结构逐渐温带化。  
  https://www.aoml.noaa.gov/extratropical-transition/
- Evans et al. 2017 ET review：温带化包含热带对称暖核向非对称、锋面结构转化。  
  https://www.aoml.noaa.gov/extratropical-transition-of-tropical-cyclones/
- AMS Extratropical Cyclone Atlas / Warm Conveyor Belt literature：WCB 是锋前上升的暖湿气流，常对应冷锋前狭长云带与气旋东北侧大片高云；干侵入可切入云头并形成逗号结构。  
  https://journals.ametsoc.org/view/journals/bams/93/10/bams-d-11-00164.1.xml
  https://journals.ametsoc.org/view/journals/clim/32/16/jcli-d-18-0802.1.xml

实现：西风带先增加东北向云系剥离和 LLCC 暴露，再发展暖输送带/锋面云尾；完成变性后进入 `extratropical_cyclone`，业务类别变为“温带气旋”。

## 干空气、风切与非对称对流

- NOAA/AOML wind-shear research：剪切环境中的冷干空气可从特定象限进入，破坏眼墙热力对称；暖湿入流和对流组织存在明显方位依赖。  
  https://www.aoml.noaa.gov/impact-of-wind-shear-on-tropical-cyclone-intensity/

实现：干空气不再只减一个“云量系数”，而有外围干侵入、核心连接、眼墙开口、再湿化和旋转式对流再爆发阶段；单侧 burst 的方位角连续旋转并可卷入重建核心。

## Brown Ocean / 登陆局地再爆发

- NASA Brown Ocean Effect：湿润陆面和高水汽环境在少数个例中可帮助登陆后的热带气旋维持甚至局地增强。  
  https://svs.gsfc.nasa.gov/4587/
- NASA NTRS 对 Kelvin 的研究强调，陆上再增强不仅与土壤湿度有关，还与大气水汽平流和日变化等共同相关。  
  https://ntrs.nasa.gov/citations/20205010096

实现：只给低概率、小尺度、短寿命的登陆局地强对流 burst，不把“棕海效应”做成普遍的陆上增强开关。

## 登陆后热带风暴级衰减参考

- 2019 利奇马：中国天气网总结其在中国大陆陆上维持热带风暴及以上约 44 小时，是明显长驻留的大环流个例。  
  https://news.weather.com.cn/2019/08/3228731.shtml
- 2026 巴威：CMA/中国天气网资料显示 7 月 11 日约 23:20 以 40 m/s 登陆浙江，12 日 05 时约 30 m/s，17 时约 23 m/s；同时其环流非常庞大，随后继续向内陆并转向东北、逐渐温带化。  
  https://news.weather.com.cn/2026/07/4713320.shtml
  https://news.weather.com.cn/2026/07/4714661.shtml
- 1956 年第 12 号强台风（Wanda/温黛）作为极端强登陆历史参照，用于避免把登陆后衰减写成单一固定指数或固定平台长度。

实现：TS 软平台改成 4.5–27 h 的动态驻留预算主体，再由海洋重叠、环流尺度、低层涡旋、平原、高山、深入内陆等连续修正；大体型/沿海更久，小体型/深内陆更短。
