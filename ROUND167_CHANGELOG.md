# AETHER 6.0.43 · Round167

基线：Round166 `AETHER_6_0_42_round166_forecast_flex_nmc_coarse_toggle.zip`。本轮不更改正式预报融合、NMC 粗略强度开关、数值风暴模型、集合成员离散算法或主模拟调度。

## 1. NMC 温带气旋预报终止与动态图例

- `src/utils/NmcForecastProduct.ts`：识别物理引擎实际序列化的中文 `TyphoonCategory.ET = '温带气旋'`，以及兼容的 `ET` / `extratropical_cyclone` 标记。过去只识别字面量 `ET`，导致灰色符号和图例失效。
- 从已计算的完整预报轨迹中查找**第一个温带气旋预报节点**，保留这一个节点为最终打点；在预报明确进入 ET 时优先展示该节点（不让旧的七级风提前终止吞掉 ET），同时截断其后所有中心线、概率带、符号与预报信息框；不是在同一预报内继续展示多个温带气旋节点。
- 若温带气旋出现在非整 12 小时节点，保留实际温带转型时刻的终点，不人为延长到下一业务节点；已转温带的当前中心不再向后生成热带预报线。
- 仅在本张预报图的**预报段确实包含温带节点**时，扩展底部图例为三行、增绘灰色“温带气旋”；不包含则保持原来两行六个热带等级图例、原宽高位置不变。
- 保留 NMC 图例解释、历史气旋符号、Round166 强度粗略开关和原地图外观。

## 2. 独立 JTWC 风格气象图产品

- 新增 `src/utils/JtwcForecastProduct.ts`，独立 Canvas 渲染器，以用户提供的两张 JTWC/ATCF 通告图为版式参考，设计坐标为 1467×1024：蓝灰海面、浅黄色陆地/海岸线、自动地理取景、等间距经纬网和两侧坐标标签、历史黑色点线/中心符号、深蓝预报中心线、带黑色引线的 UTC 日期及 kt 风速标注、34/50/64 kt 分级象限风圈、34kt 海上警戒带纹理和虚线边界、右侧黑白通告数据表及业务图例。
- 产品中心“路径 / 风险”增加 **JTWC 风格预报图**，可配置 24/48/72/96/120 小时，支持按需低清预览、正式高清出图与 PNG 下载。原 `jtwc` 本地记录值可迁移到新图类型。
- 数据来自项目本身的物理预报，JTWC 1 分钟平均风速转换复用 `getAgencyIntensity(vmax, 'JTWC', 'public')`，风圈在预测节点处用当前已分析的象限半径随强度变化推估，并随中心位移自适应跳过过度重叠的风圈。
- 为防止误认作真实机构发布，**机构署名替换为 AETHER**，通告栏明确注明 `AETHER SIMULATED GUIDANCE` / `NOT OFFICIAL`；视觉风格以参考图为目标，但不会声称原官方图的真实风圈、校验编号或业务审核身份。
- JTWC 计算与 NMC 初生粗略强度预测完全隔离；不修改 NMC/JMA/集合/风场/视频产品的强度。

## 3. Forecast 间歇性、会持续整个会话的卡顿

排查 Round163 / Round166 源码后发现：所谓“降低 React/Leaflet 刷新次数”不能解决 **主线程的单步物理积分**（包括部分昂贵的环境/每小时气象站运算）带来的长任务。高倍速时，该积分与浏览器 UI 在同一 JS 线程执行，且全量 history 的高频跨组件复制会引起越来越大的 GC 抖动。

- 新增 `src/workers/ForecastSandboxWorker.ts`：预模拟物理核心在独立 Web Worker 中继续**逐 10 分钟**执行原 `TyphoonEngine.stepSimulation(..., {liveForecastMode:'off'})`，保留输入配置、种子、随机数状态、精确物理步进、风暴结构、登陆、风圈及历史生成。不会跳步或者用近似预报代替模拟。
- 与 UI 的消息频率单独节流。Worker 只发送最新状态与**新增小时历史快照增量**，不再反复 structuredClone 从开头累计至当前时刻的整段历史；React 地图层仍拥有完整可回放的历史。
- 引入任务 token 防止停止、读取、重置、历史分支后被旧异步计算覆盖；提供暂停确认协议，导出存档与确认预模拟前先等最新物理/PRNG 状态传回。
- 配置/摇杆/速度输入实时送入 Worker；导入、重置和回放分支均可重新建构 Worker 物理状态。浏览器不支持 Worker 时保留原生 RAF 积分为后备路径；线程运行异常时停止并提示从已确认状态重试。
- 不改主模拟及 Round163 地图自身的动画优化。

## 4. 检查与已知限制

- 新增 `scripts/round167_jtwc_et_worker_regression.cjs`：验证首个 ET 结束、ET 条件图例、JTWC 产品隔离/重要图层，以及 Worker 的 10 分钟物理步数、PRNG、历史增量计数与暂停结果。
- 修改过的 NMC / JTWC / ForecastSandboxWorker / ForecastPreSimulation / ForecastImageModal 已执行 TypeScript 语法转译检查；使用真实项目 GeoJSON 配合 Canvas 进行了 JTWC 绘制试验。
- Round160、161、162 快捷工具、163 物理自动暂停/RAF 节流/UI 生命周期、164 历史游标与空间预报、165、166 与本轮新测试均有通过项。将四个旧版 CommonJS vm 脚本中的 `import.meta.url` 以测试 URL 替代，以兼容新增的 Vite Worker URL 语法。
- `round162_live_branch_config_integration.cjs` 的旧测试仍要求“快捷菜单打开后继续物理推进”，与 Round163 起的**自动暂停**规定冲突，因此不可视作新版本正确行为。
- 由于 ZIP 未含 `node_modules` 且当前环境缺少 React/Vite 依赖，尚未完成完整生产构建、浏览器 Web Worker 实机测试、不同设备/各速度档的长期运行压测。此次独立线程修复是针对明确代码瓶颈的结构性改动，不保证所有机型零卡顿。
- 存档 `schemaVersion` 与物理模型参数格式未变化，仅更新应用版本标识至 `6.0.43`。
