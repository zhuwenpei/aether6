# Round160 — 预模拟参考失效、暂停同步、Forecast 独立页面样式修复

基于 Round159 源码精确修改。保留原有物理计算、NMC 直线中心线及气象产品。

## 1. 预模拟参考新增两个主动中断原因

- 原有行为：确认新预模拟时，会由较新的起报时刻替换较旧参考。
- 新增行为：**确认正常手绘大体预报路径**时，会在当前模拟小时写入 `preSimulationReferenceCleared: true` 历史标记，立即终止以前的预模拟参考；实时画点路径选择“同步预报”也按同样规则处理。
- 新增行为：正常模拟设置 → 预报路径板块 → **清空预模拟预报参考**（手机“更多”菜单也可操作），仅删除本时刻以后旧预模拟的预报引用，不修改实际台风历史；如无有效预模拟参考则按钮不可用。
- 不会逆向清除该时刻以前曾被保存的预模拟参考。历史回放继续读取当时的参考。
- 后续确认新的预模拟参考时，会清除同一小时的撤销标记，使新参考可以继续被历史及未来起报读取。
- `.aether` / `.aether.json` 保留该撤销标记。旧文件不包含此字段时仍按旧规则导入。存档读取检查撤销标记必须是布尔类型。

## 2. 暂停按钮异步调度竞态修复

- 播放切换现在以实时 ref 为判断来源，而非可能过时的 React `isPlaying` 闭包值。
- 暂停时立即同步运行标记、清空累积模拟分钟并取消待运行的 rAF、物理任务与物理唤醒定时器。
- 每次启动物理调度均分配代际编号，过期 rAF、定时器、物理循环不得启动下一轮任务。
- 保留10分钟固定积分步长、不改动速度物理及点击音效。
- 独立预模拟页面的暂停也同步收紧：停播立即复位独立分支的播放标记和待积分时间。

## 3. Forecast 页面与主模拟视觉一致

- 预模拟直接复用 `AetherDesktopChrome` / `AetherMobileChrome` 组件，主品牌由 **AETHER** 改为 **Forecast**。
- 台风当前时间、状态、风速、气压、移向移速排版与主模拟使用同一个组件。
- 菜单和快捷按钮复用主模拟样式和响应方式；预模拟不显示气象产品入口；支持设置/状态、声音、全屏及独立分支画点操作。
- 左下角预模拟确认栏缩为**仅勾和叉两个图标**，删除说明文字，保留确认条件及按钮辅助标题。
- 独立分支初始**暂停、8×**的设置保留；正常模式与预模拟模式仍隔离。

## 修改文件

- `src/App.tsx`
- `src/components/ForecastPreSimulation.tsx`
- `src/components/AetherDesktopChrome.tsx`
- `src/components/AetherMobileChrome.tsx`
- `src/components/ControlDrawer.tsx`
- `src/simulation/PreSimulationReference.ts`
- `src/types.ts`
- `src/utils/SimulationArchive.ts`
- `scripts/round160_preguidance_pause_chrome_regression.cjs`

## 验证范围及限制

- 完成 Round160 专项回归、Round121/143/144/146/148/153/157/158/159 历史回归。
- `PreSimulationReference.ts` 与 `types.ts` 通过严格类型/模块检查；修改过的 TS/TSX 文件通过 TypeScript 语法转译检查。
- 当前源码包不包含 `node_modules`，未完成完整 Vite 生产构建、真机及全浏览器端到端交互验收。
