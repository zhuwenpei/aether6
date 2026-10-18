# AETHER 6.0.47 — Round171 (由 Round170 增量修改)

## 底版和来源

- **完整应用、物理引擎、预模拟、天气与地理数据均继承 AETHER 6.0.46 Round170。**
- 只读取 Round169 的 `src/components/ForecastImageModal.tsx` 中 JMA 图形样式，以恢复相应绘制常数、文本和布局。没有用 Round169 整项目覆盖 Round170。
- Round170 的 **JMA 停编牌** 和 NMC 可选省界/河流图层、物理及降水模型继续保留。

## 本轮六项修改

1. **JMA 预报图回退 Round169 样式**：恢复标题栏盒尺寸/位置、字号、日文以外的原标注文字与字号、经纬线宽、预测圈虚线节奏、白色不确定性外包络粗细等；唯一附加的视觉变动：台风中心白点半径从 `6.2 / 4.7` 缩为 `5.0 / 3.5` 逻辑像素，全部用不透明 `#FFFFFF`；白色外包络及预测圈换为纯白不透明。停编功能（Round170 新增）保留。
2. **NMC 指定峰值变成硬约束**：先形成正常或预模拟参考融合后的预报强度，再做 NMC 生成初期保守调整，最后仅在实际发布时效内硬约束峰值。无自然增强过程也可渐进改造；选峰优先落到 12h/24h 业务打点（含非标准终止时次）。限制增强不超过 1.1 m/s/h、衰减不超过 1.65 m/s/h，陆地不新增增强，预报时间、路径、主模拟和预模拟数据不改。如无法在允许时效内达到用户硬目标，**抛出说明原因的错误，阻止错误出图，而不是降权/悄悄调小峰值**；预览分支同样捕获错误并显示于产品生成区，避免未处理的 Promise 异常。定制峰值点的文本采用该精确目标 m/s，避免一般 CMA 离散风速表把目标值重新取整；非指定点仍沿用现有发布分档。
3. **NMC 河流线网适度减少**：从本地 `nmc_rivers.geojson` 中按河段累积真实地理长度筛选，保留 `scalerank<=3` 干流及长度 `>=40 km` 的完整河段。所有被保留河段使用**全部原始坐标顶点**，没有简化、抽稀或修改 GeoJSON。东亚窗口候选 1283 条中保留 817 条（数据筛选，非降精度）。
4. **NMC 标注信息框半透明**：背景绘制从接近不透明改为 `rgba(239,248,252,0.78)`，保留原尺寸、字体与细边框，底图线条透出。
5. **NMC 历史/预报/起报中心路径点移除白色细描边**：只保留风级颜色实心点，图例和城市点的原有样式不变。
6. **热带低压标题**：起报状态为热带低压（包括枚举 TD 或中心强度低于 17.2 m/s）时，页眉只以“热带低压”作为风暴名头衔，不拼接“今年第 N 号台风/热带低压”称谓，后面仍正常显示未来预报时长。

## 主要修改文件

- `src/components/ForecastImageModal.tsx`
- `src/simulation/NmcIntensityGuidance.ts`
- `src/utils/NmcForecastProduct.ts`
- `src/utils/NmcOptionalGeography.ts`
- `scripts/round171_nmc_jma_peak_style_regression.cjs`
- `scripts/round170_geography_rainfall_jma_physics_regression.cjs`（更新与本轮合法 JMA 样式回退相冲突的旧断言）
- `package.json`（新版本标记及专项测试命令）

## 验证与已知约束

- `node scripts/round171_nmc_jma_peak_style_regression.cjs`：通过。包含强度硬达峰、自然速率、陆地约束、无法达到时的明确错误，以及样式与数据筛选断言。
- 继承的 `node scripts/round169_physics_nmc_peak_synced_eye_regression.cjs`、`node scripts/round170_release_regression.cjs`、`node scripts/round170_geography_rainfall_jma_physics_regression.cjs`：本轮测试均通过。
- TypeScript 独立模块 `NmcIntensityGuidance.ts`、`NmcOptionalGeography.ts`：通过真实 `tsc --noEmit` 类型检查；本轮四个主要源文件通过 TypeScript 语法编译检查。
- 使用 skia-canvas 生成了一张离线合成台风 NMC PNG 完整绘制验证，可看到半透明框、完整河段和无白边点。它是模拟样图，**不是实际 NMC 发布的预报**。
- 当前工具环境安装项目依赖时超时，故**没有**完成 Vite 全量构建或浏览器端到端验证。可在已安装依赖的开发环境运行 `npm run lint`、`npm run build`、`npm run test:round171`。
- 定制硬峰与预报时效/登陆约束可能数学上冲突；当前明确阻止输出不达峰图片，要求降低目标或延长有效预报时效。若正式预报已停编，仍沿用 Round170 的停编时间，定制峰值绝不延长轨迹。
