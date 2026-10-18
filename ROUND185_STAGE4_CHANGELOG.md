# AETHER/WMC 6.0.49 — Round185 第四阶段更新记录

**性质：完整源码增量开发包，尚未达到 13 项全部正式验收。** 在第三阶段 ZIP 上继续修改；`package.json` 版本保持 `6.0.49`。没有改变 Round184 概率图色表、NMC 官方标志策略或既有确定性模式中心线。

## 1. 按最新指令修正内置键盘（任务 9）

> **用户修订：内置键盘只用于数字输入；普通文本和中文输入必须使用系统输入法。** 这项指令替代任务书早期“自制中文拼音键盘”的要求。

修改：

- `src/components/AetherInputDialog.tsx`：根据 `inputMode` 区分；`numeric/decimal/tel` 用只读的数值草稿和内置数字键盘；`text` 使用可编辑的原生 `input`，不再设置 `readOnly`/`inputMode=none`，允许用户通过系统中文输入法组合、选词、粘贴和移动光标。监听 `compositionstart/end`，避免候选词阶段 Enter/Escape 提前提交或关闭。
- `src/components/dialogs/AetherDialogProvider.tsx`：队列式 `promptText` 改为原生文本输入框并自动聚焦，系统负责拼音候选；`promptNumber` 使用共用数字键盘；焦点循环纳入输入框。`confirm` / `choose` / select 捕获行为保留。
- **新增** `src/components/dialogs/AetherNumericPad.tsx`：公用数字键盘支持 0–9、小数、清空、退格、正负号、长度上限及可选确定/取消；纯函数 `updateNumericDraft` 可独立测试。
- `src/components/dialogs/NumericField.tsx` 改为复用同一数字键盘，避免不同数字对话框行为分叉。
- **移除** 不再使用的 `src/components/dialogs/AetherTextKeyboard.tsx` 和 `gb2312Pinyin.json`；不会在发布包内保留自制中文词库。旧测试脚本文件保留，但已标注原自制中文要求被新的系统 IME 规则取代。其他普通文本框原本走系统输入法，保持不变。

**限制**：尚未逐一将工程中所有 `<input type="number">` 改为内置数字弹窗（部分原生数值框仍使用平台数字键盘）；真实 Android/iOS 拼音候选栏、语音输入及焦点恢复尚无 E2E 验收。内置数字键盘的新增规则只限于已接入的弹窗和 `NumericField`。

## 2. 袭击概率栅格的行条带流式计算（任务 5）

修改：`src/utils/StrikeProbabilityField.ts`、`src/utils/StrikeProbabilityProduct.ts`、`src/components/ForecastImageModal.tsx`。

- 保留原 `computeStrikeField` 全缓冲路径（≤ 500 万格），不改变 Round184 0.1° 小栅格产品路径；大于此阈值时自动切换 `computeStrikeFieldStripes`。
- **新增** `computeStrikeFieldStripes`，沿原“线段胶囊 × 纬度扫描行 × 成员内区间合并”算法逐条带输出；条带最大目标约 160 万格，输出向上/向下额外带有物理平滑核的 halo 行，保证跨条带接缝正确。没有为全场申请相同大小的 `count / rawProb / prob / ImageData` 四套缓冲。保留 `AbortSignal`，每批成员及每个条带让出主线程。
- **新增** `strikeStreamingCell`、`STRIKE_STREAM_DESKTOP_CELLS=80_000_000`、`STRIKE_STREAM_MOBILE_CELLS=16_000_000`：按视窗格数估计最细可行栅格，自动放宽并保留“实际栅格”页脚提示，UI 预估采用同样预算。
- 绘制端对每条带的高精度概率做双线性采样，只写入有限尺寸（最长边 ≤ 3072 像素）的输出用 ImageData；保持经纬网、色表、标题、路径图层等原绘制逻辑。取消或异常会释放临时位图。
- **新增** `buildStrikeSiteIndex`、`computeSiteProbabilityIndexed`：流式模式及自动放宽栅格时，海岸顶点和城市点概率按成员真实轨迹命中计算，避免使用粗化的未平滑格点插值；其最终判断调用原 `strikeSegmentDistanceSq`，同一成员只计一次。
- **修复** `smoothGridPhysical` 原先横向两遍、纵向一遍的各向异性：改成各两个等价箱型分离滤波过程，原始概率数组不受改动；条带 halo 在测试中与全场物理平滑逐格一致。

**测试实况**：

- 14,400 个成员/站点/半径/跨经线查询中，空间索引结果与原逐成员精确算法相同。
- 小栅格的原统计与流式条带统计逐格一致；含人工强制条带边界的平滑接缝测试通过。
- `AbortSignal`、桌面预算、0.0025° 小取景保真及渲染接口接线离线测试通过。
- **没有**在真实浏览器/GPU 上验证 80m 网格长期运行，也未测量 1000 成员与官方参考图 PNG 对比。

### Node 基准（2026-10-17，本环境、12 条合成成员，48 h，平滑 1）

| 情景 | 实际精度 | 处理格数 | 条带 | 耗时 | 最高进程 RSS |
|---|---:|---:|---:|---:|---:|
| WNP 0.1° | 0.1° | 422,988 | 1（旧全缓冲） | 0.034 s | 92.1 MiB |
| 5°×5° 请求 0.0025° | 0.0025° | 4,004,001 | 3 | 0.238 s | 143.9 MiB |
| 10°×10° 请求 0.0025° | 0.0025° | 16,008,001 | 14 | 0.763 s | 156.6 MiB |
| WNP 请求 0.0025° | ≈0.00727° | 79,840,536 | 66 | 2.61 s | 172.9 MiB |

另有 **1,000 条合成成员、10°×10°、0.0025°、无平滑** 的 Node 测试：16,008,001 格，11 条带，耗时 **1.85 s**，最高 RSS **193.8 MiB**；记录在 `ROUND185_STAGE4_1000MEM_BENCHMARK.json`。上表和该例均不是浏览器 Canvas/GPU 峰值内存，也不能代表带很多节点的完整物理集合。执行 `npm run bench:round185-strike` / `npm run bench:round185-strike-1000` 可复测本机情况，因机器而异。

## 3. 已执行的回归与构建边界

- `ROUND185_STAGE4_TEST_RESULTS.json`：**40 / 40 个离线脚本成功**（包括 Round178–182、袭击概率、降水、NMC、存档、多路径及新增 6 个键盘/栅格测试）。更新了历史键盘测试的期待，以匹配本轮用户修改后的要求。
- TypeScript 语法解析：**133 个源码文件、0 处解析错误**。相对导入路径：**390 次、0 缺失**。
- 新输入弹窗四个 TSX 文件用 React 最小声明进行了**隔离式类型检查，0 错误**；**不是**完整项目的 TS 类型检查。
- `npm run build`：**未通过（环境无 `vite`，提示 `sh: vite: not found`）**。尚无法声明浏览器运行、移动触摸、1:1 像素、GPU/内存与完整集成通过。
- 版本号保持 `6.0.49`；原始 Round184 / 前三阶段 ZIP 没有修改。

## 4. 原 13 项任务的当前状态

| 编号 | 状态 | 已接入与尚缺事项 |
|---:|---|---|
| 1 综合集系分析 | 部分完成 | 七面板及数值统计已入源码；仍缺主图逐像素对齐、离线字体子集、浏览器千成员输出实测，以及未上传的 51284 辅图核验 |
| 2 NMC 2019/2024 双版 | 部分完成 | 参数化双版、楔形与气旋符号、概率锥连续插值已入；缺实测 1:1 参考图叠图及浏览器验收 |
| 3 停编方式 | 计算层完成 / 产品未验收 | 正常停编与残余低压已接入，离线回归通过；真实个例图待核对 |
| 4 降水固定高值区 | 部分完成 | 地形清洗、随机噪声和合成个例已通过；卡努完整重播及 51146/51147 像素比对未完成 |
| 5 概率高精度栅格 | **本轮推进至流式计算/接线完成** | 80m/16m 内存预算、精确沿岸概率、可取消条带与 Node 基准已实现；缺 Chrome/Safari/Android 真正出图压力测试 |
| 6 路径真实化 | 未完成正式功能 | 几何试算与锚点保护模块已有；尚未安全写入历史及重算站点、降水、风圈、缓存、继续积分、撤销与存档 |
| 7 自定义机构名称 | 部分完成 | 已覆盖 NMC/概率/部分集系；所有雨风/视频/报告的统一入口及校验尚缺 |
| 8 编号可删空 | 功能已实现 / 手机未测 | 草稿输入改动与离线校验通过；真实手机触控仍待验证 |
| 9 内置对话框与输入 | **按本轮新指令修正** | 中文和文本由系统输入法处理；内置数字键盘复用到多种输入弹窗；原生数字框全面迁移及移动端 E2E 未完成 |
| 10 多路径 | 部分完成 | 可编辑辅助路径、地图显示、权重、成员分配和存档校验；完整浏览器交互与预报导出尚待测试 |
| 11 NMC 黑屏/卡死 | 部分完成 | 离屏蒙版、取消/回退/释放策略已入；无法复现 GPU 真实崩溃或运行 4×20 浏览器压力 |
| 12 存档继续模拟保存 | 部分完成 | 预模拟引用清理及旧存档兼容校验已通过；缺真实历史导入→续跑→导出→重读 |
| 13 集系强度/路径标定 | 仅有统计台架 | 可测分位、RI、偏移及簇指标，但缺 8 个真值场景×30 种子；未贸然调整物理常数 |

## 5. 本轮主要修改文件

`src/components/AetherInputDialog.tsx`、`src/components/dialogs/AetherDialogProvider.tsx`、`src/components/dialogs/NumericField.tsx`、**新增** `src/components/dialogs/AetherNumericPad.tsx`、`src/components/ForecastImageModal.tsx`、`src/utils/StrikeProbabilityField.ts`、`src/utils/StrikeProbabilityProduct.ts`；新增 6 个专项回归脚本与 2 个 Node 性能基准脚本，更新 2 个过时测试脚本、`package.json` 和 `README.md`。
