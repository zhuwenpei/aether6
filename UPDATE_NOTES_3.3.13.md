# TyphoonSIM 3.3.13 更新说明

## 本版目的

修正 3.3.11–3.3.12 中把“60 m/s登陆强度”当作平原24小时450 mm高值硬门槛的问题。该规则与2026年浙江登陆台风的业务/实况样本不一致。

## 参考标定

- 2026年第9号台风“巴威”在浙江玉环登陆时中心附近最大风力约40 m/s；公开水文资料显示浙江已有多个站累计超过500 mm，最大约584.5 mm。
- 2026年第13号台风“白海豚”首次登陆玉环时约42 m/s；浙江气象评估显示其在浙江滞留约18小时，过程单站最大970 mm，国家站温岭24小时425 mm。
- 用户提供的中央气象台24小时预报参考图中，同样约40–42 m/s的登陆场景分别出现约450 mm与420 mm级局地最大值，说明局地累计并不与登陆Vmax单调一一对应。
- 学术研究指出，登陆台风强降水受海陆粗糙度差导致的摩擦辐合、风暴移动速度、水汽条件、雨带训练、天气尺度环境和地形共同控制；登陆强度与降水强化并非简单线性关系。

## 代码修改

### 1. 删除60 m/s硬开关

`src/utils/ObservedRainfallMap.ts` 不再执行“Vmax < 60 m/s => 平原累计 <450 mm”的硬截断。风速现在只是局地高值效率的一个次要因子。

### 2. 新增过程门控的平原高值尾部

新增 `plainTrainingSupport`，由以下实际模拟证据共同组成：

- 局地降水聚焦度 `focusScore`；
- 登陆后驻留/残余涡旋维持 `landfallPersistenceScore`；
- 天气尺度/摩擦辐合 `synopticConvergenceScore`；
- 有组织中雨持续 `organizedMidScore`；
- 持续强降水 `sustainedHeavyScore`；
- 峰值小时雨率；
- 登陆风速仅提供较小效率修正。

因此约40 m/s的台风在快速移动、辐合较弱时仍可能只有较低累计；但若雨带/摩擦辐合反复经过同一点，也可以形成约450 mm局地高值。约42 m/s并不会被程序强迫生成比40 m/s更高的极值。

### 3. 420/450 mm以上逐级收紧

- 420 mm以上：必须有明显局地训练/聚焦证据，否则迅速压缩回420 mm附近。
- 450 mm以上：需要更高 `plainTrainingSupport`、一定时长的聚焦对流/有组织强降水，以及较高峰值雨率或强辐合。
- 无明显地形抬升的平原仍最终限制在 `<550 mm/24 h`。
- 迎风丘陵/山区不套用平原上限，继续由地形抬升、训练时间、坡度/起伏/脊线暴露控制。

## 保持不变

- 3.3.12 对大面积600+和普通丘陵1200+的空间约束继续保留。
- 海上成熟CDO 300–600 mm级累计校准继续保留。
- 降水网格、地图分辨率、等值面插值质量没有降低。

## 资料

- 新华网：2026-07-11，“巴威”在浙江玉环登陆，40 m/s。
  https://www.news.cn/20260711/95c2d0f41c9049f596cc1512976202a6/c.html
- 太湖流域管理局：截至7月12日11时，浙江3站累计超过500 mm，最大584.5 mm。
  https://www.tba.gov.cn/slbthlyglj/zsdwdt/content/9e1ea254-0e7f-45eb-b112-42729e070fc7.html
- 新华网：2026-08-09，“白海豚”在浙江玉环登陆，42 m/s。
  https://www.news.cn/20260809/d9a569d3f1fd4392b397c4ab5e4127c7/c.html
- 浙江天气网：“白海豚”气象评估；浙江滞留约18小时，过程单站最大970 mm，温岭国家站24小时425 mm。
  https://zj.weather.com.cn/tqyw/08/4757123.shtml
- Journal of the Atmospheric Sciences: Rainfall Reinforcement Associated with Landfalling Tropical Cyclones。
  https://journals.ametsoc.org/view/journals/atsc/67/11/2010jas3268.1.xml
- Monthly Weather Review: Structure and Evolution of Rainfall in Numerically Simulated Landfalling Hurricanes。
  https://journals.ametsoc.org/view/journals/mwre/136/10/2008mwr2304.1.xml
