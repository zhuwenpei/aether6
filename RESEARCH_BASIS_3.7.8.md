# AETHER 3.7.8 — 新气象 / 海洋环境系统研究依据与数据说明

## 1. 数据定位

3.7.8 的 `SynopticEnvironment.ts` 是一套**离线典型天气/海洋过程数据库与连续场生成器**。其变量定义、压力层、空间尺度、量级和过程结构依据公开再分析、海温分析和热带气旋预报文献进行校准。

必须明确：

- 本项目**没有**把某个实际日期的 ERA5 原始 GRIB/NetCDF 或 NOAA OISST 原始逐点二进制资料打包后冒充实时分析；
- 本项目也不在运行期间联网获取天气；
- “逻辑 0.25° 海洋网格”是运行时的采样/插值尺度，海区背景、锋区、黑潮和中尺度异常由内置数据库与连续函数重建；
- 六组大气和五组海洋均是用于模拟/对照的典型过程，不应被解释为某日某时的业务天气预报。

这种设计允许在完全离线、无运行时网络请求的前提下提供远高于旧版固定标量预设的空间和时间结构，并维持交互模拟性能。

## 2. ERA5：压力层、空间尺度与多层环境结构

**Copernicus Climate Data Store — ERA5 hourly data on pressure levels from 1940 to present**

- https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels
- ERA5 压力层产品提供全球多压力层的大气变量，CDS 的规则网格产品可按 0.25° × 0.25° 使用。
- 本版以 850、700、500、200 hPa 为主要环境层：850 hPa 表示低层引导/季风气流，700 hPa 表示中层水汽与干空气，500 hPa 表示中层高度/槽脊结构，200 hPa 与 850 hPa 联合诊断深层风切。

采用方式：用于确定新环境模块的多层数据结构、空间变化尺度、位势高度/湿度/风场的合理量级和槽脊—急流的三维关系；并不分发 ERA5 原始再分析文件。

## 3. NCEP/NCAR Reanalysis：6 小时过程演变参考

**NOAA Physical Sciences Laboratory — NCEP/NCAR Reanalysis 1**

- https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html
- 该再分析提供长期、全球、6 小时大气场，是观察典型天气尺度系统连续演变和构造离线关键帧过程的长期参考。

采用方式：3.7.8 的基础天气形势数据库使用 6 h 关键帧概念，并让副高、季风槽、急流、槽脊、切断低压等在 120 h 内连续位移/增强/减弱；不是逐格复制某个 NCEP 5 日事件。

## 4. WMO：热带气旋引导层与 β 漂移

**WMO Global Guide to Tropical Cyclone Forecasting / Chapter 3: Motion and Track Forecasting**

- https://cyclone.wmo.int/pdf/Global-Guide-to-Tropical-Cyclone-Forecasting.pdf
- https://cyclone.wmo.int/pdf/Chapter-Three.pdf

WMO 指南强调环境引导流和气旋垂直深度之间的关系：较弱、受切变或浅层系统更接近低层引导，较深/较强系统需要更深层平均风；β效应可作为相对于环境引导的偏移机制之一。

采用方式：新预报引导使用 850/500/200 hPa 不同权重并随台风强度连续变化；新 β 项只进入完整预报引导场。为了保持本版人工操控规则，实时/手动路径只允许新西风带额外贡献，不把其它新天气系统强制施加给摇杆控制。

## 5. NOAA：200–850 hPa 深层风切定义

**NOAA/NESDIS OSPO — Tropical Cyclone Formation Probability ATBD**

- https://www.ospo.noaa.gov/products/ocean/tropical/tcfp/docs/ATBD_TCFP_v1.0_20240125.pdf

公开算法资料使用 200 hPa 与 850 hPa 风矢量差表示深层垂直风切。

采用方式：新环境不再从一个固定“风切强度”数字直接得到影响，而是先生成 200/850 hPa 风，再计算矢量差；干空气另以 700 hPa 湿度/通风过程描述。为避免多个理想化天气系统叠加时形成非物理无限值，模拟数值上限设为 85 kt。

## 6. NOAA OISST v2.1：SST 空间尺度

**NOAA/NCEI — Optimum Interpolation Sea Surface Temperature (OISST) v2.1**

- https://www.ncei.noaa.gov/products/optimum-interpolation-sst
- NOAA OISST v2.1 为全球日尺度、0.25° 网格海表温度分析。

采用方式：新海洋运行时采用 0.25° 逻辑采样与双线性插值的设计目标，并建立西太暖池、菲律宾海、南海、东海/黄海、黑潮/亲潮锋区、印尼贯穿流等区域数据库。项目没有重新分发 OISST 原始逐点文件。

## 7. NOAA/AOML：上层海洋热含量 / TCHP

**NOAA AOML — Tropical Cyclone Heat Potential**

- https://www.aoml.noaa.gov/phod/cyclone/data/

TCHP/OHC 类指标反映从海表向下到 26°C 等温面附近的上层海洋热储量，说明单独 SST 不足以描述台风可利用的海洋能量。

采用方式：3.7.8 将 OHC 与 SST 分离，给深暖水区、陆架浅海、锋区、冷暖涡和冷尾流不同的 OHC 响应；不再简单由 SST 单值线性映射海洋供能。

## 8. 120 h / 240 h 周期的含义

用户要求气象与海洋以 5 天为主要动态周期，因此：

- 基础大尺度天气形势：120 h 周期；
- 海洋中尺度/锋区过程：120 h 周期；
- 干空气与深层风切：单独使用 240 h 过程库，以避免 5 日内过快重复典型通风事件。

所有边界均做连续闭合；完整大气状态因 10 日干/切过程形成 240 h 超周期，但 120 h 边界没有离散跳变。

## 9. 典型过程与业务实况的界限

“最真实”在本版的含义是：使用真实气象学变量、真实压力层关系、合理的天气尺度结构、海区结构、时间连续性和台风环境耦合规则，而不是声称离线程序拥有未来某 5 天的真实业务分析。若后续版本要做“自动模拟实际天气个例”，应再引入可追溯到具体日期的 GRIB/NetCDF 压缩资料、资料同化/初始化时间和数据许可证信息，并与本版典型预设数据库并列，而不是混淆两类数据。
