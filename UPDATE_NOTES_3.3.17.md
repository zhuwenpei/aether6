# TyphoonSIM 3.3.17 更新说明

## 修复：新生成台风点击播放后立即自动暂停

### 根因
3.3.15 引入 CDO 尺度连续演化时，`Engine.stepSimulation()` 的 CDO 收缩判定提前引用了稍后才声明的 `ewrcSuccessRecovery`。JavaScript 的 `const` 存在 temporal dead zone，因此第一个 10 分钟积分步就会抛出 `ReferenceError`。`App.tsx` 的异常保护随后执行 `setIsPlaying(false)`，用户看到的现象就是“点击开始后立刻自动暂停”。

### 修复
- CDO 尺度模块不再跨代码阶段读取尚未初始化的局部变量。
- 在 CDO 模块内部直接从已经存在的 `ewrcState === "recovering_success"` 诊断当前 EWRC 成功恢复状态。
- 保留 3.3.15 的 CDO 连续尺寸记忆和所有物理时间常数，不回退结构机制。
- 模拟步若未来再次发生运行时异常，会在事件日志和界面 Toast 中显示具体错误原因，而不再只表现为无提示自动暂停。

### 校验
- 未运行 npm / npx，未安装依赖，未启动网页应用，未生成图片。
- 使用系统已有 TypeScript 编译器执行静态转译检查。
- 额外执行 simulation 核心的正常 TypeScript 语义检查，确认本次 `TS2448: block-scoped variable used before its declaration` 已消失；剩余错误仅为原压缩包未包含 `@turf/turf` 与 `rbush` 依赖声明。
