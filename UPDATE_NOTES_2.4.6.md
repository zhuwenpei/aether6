# TyphoonSIM 2.4.6 更新说明

## 本轮问题诊断

对照用户提供的同参数 TyphoonSIM 24 h 降水图与中央气象台参考图，上一版主要还有两个系统性偏差：

1. **100–250 mm 色块不足。** 对图中主降水区域做粗略颜色分类后，模拟图的洋红/紫色只占着色雨区的个位数百分比量级，而参考图大约达到三成量级。上一版为了压制“大面积紫色圆盘”，对 70–260 mm 原始累计量的中段压缩过强，结果矫枉过正。
2. **24 h 轮廓仍偏圆。** 旧的 wave-2 / wave-3 叶瓣相位随 `simHour` 缓慢转动；在逐小时积分 24 h 后，不同方位的凸出部分互相填平，最终又接近轴对称圆/扇形。

参考图中的典型结构更接近：宽广的 25–100 mm 雨盾由数个大尺度叶瓣拼接，100–250 mm 区域覆盖其中若干有组织雨带/对流复合体，250–400/400+ mm 只在局地训练或强对流中心形成小核；外边界有明显凸舌、凹口和方向性，不是同心圆。

## 机制修改

### 1. 环境锁定的低波数雨盾

`src/simulation/PrecipitationModel.ts` 中的广域降水几何改为：

- 主叶瓣由垂直风切下风切左侧与弱风切时的移动方向前侧共同控制；
- 加入水汽输送/馈流方向的次叶瓣；
- 加入上风切侧抑制缺口；
- wave-2 / wave-3 相位固定在风切和移动几何上，不再每小时绕中心缓慢转动；
- 使用 270–410 km 空间尺度、56–84 h 演变时间的地面相干水汽纹理，为累计雨区提供稳定的凸出和凹陷。

这样 24 h 积分不会把不规则结构平均成圆。外环流、辐合区、层状雨盾和弥散雨盾的“有效半径”都使用更强的方位伸缩，因此改变的是实际阈值轮廓，而不只是同一个圆盘上的颜色深浅。

### 2. 中尺度雨带复合体

新增约 60–180 km 量级的 `rainbandMesoscaleComplex`：

- 位置主要锁定在下风切左侧、主水汽馈流方向和移动相关次级扇区；
- 径向宽度明显大于单个对流胞；
- 允许连续层状/中雨背景与嵌入对流共同形成业务图中的不规则紫色叶瓣；
- 原有 2–3 h 对流簇和短时极强单体仍保留，所以不会把整条螺旋雨带改成永久强对流环。

TRMM 研究显示，热带气旋降水的 wavenumber-1 非对称在中强风切下主要位于下风切至下风切左侧；当风切较弱时，移动方向对外雨带分布更重要。雨带本身又由强嵌入对流与较广层状降水共同组成，因此采用“宽复合体 + 短寿命单体”的双尺度结构比单一螺旋线更合理。

参考：
- Chen, S. S., Knaff, J. A., & Marks, F. D. (2006), *Effects of Vertical Wind Shear and Storm Motion on Tropical Cyclone Rainfall Asymmetries Deduced from TRMM*, Monthly Weather Review.
- Hence, D. A., & Houze, R. A. Jr. (2012), *Vertical Structure of Tropical Cyclone Rainbands as Seen by the TRMM Precipitation Radar*, Journal of the Atmospheric Sciences.
- Didlake, A. C. Jr., & Houze, R. A. Jr. (2013), *Dynamics of the Stratiform Sector of a Tropical Cyclone Rainband*, Journal of the Atmospheric Sciences.

### 3. 恢复 100–250 mm 等级但不恢复大圆盘

`src/utils/ObservedRainfallMap.ts` 的 24 h 累计映射新增 `organizedHeavyHours`：

- 只有峰值雨率并不能描述 CMA 图中的大片 100–250 mm；
- 多次经过 8–20 mm/h 的有组织中到大雨，同样可以在 24 h 内积累到 100–250 mm；
- 因此新的 focus score 同时考虑峰值、强对流驻留时间和持续中到大雨时数。

70–230 mm 左右的中段压缩明显放宽，使局地有组织雨带更容易进入 100–250 mm；低 focus 的普通层状雨仍倾向留在 25–100 mm。250/400+ mm 的高值尾部继续要求较高的集中度，因此不会重新出现整片暗红/橙色。

### 4. 减少产品端过度圆滑

累计场由两次完整水平/垂直平滑改为一次受控平滑，并提高 100 mm 以上原场权重。这样仍能去除格点噪声，但会保留 50–200 km 尺度的边界肩部、凹口和狭长伸展。

## 验证

本次未执行 npm / npx / npm install / npm run / npm build。仅使用环境中已有 TypeScript 编译器进行 `tsc -p tsconfig.json --noEmit --noCheck` 语法级检查，并对最终 ZIP 做完整性测试。
