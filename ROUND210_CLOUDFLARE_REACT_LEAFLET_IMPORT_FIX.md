# AETHER 6.0.49 · R210 — Cloudflare Pages Rollup 导入失败修复

## 错误依据

R209 在 Cloudflare Pages 构建过程中，`bun install --frozen-lockfile` 成功、NMC 省界预处理成功，Vite 显示 `2545 modules transformed`，之后报错：

```
[vite]: Rollup failed to resolve import "react-leaflet"
from "/opt/buildhome/repo/src/cloudCompositor/components/Step1Target.tsx".
```

这不是上一次的退出码 137。`react-leaflet` 被源码引用，但不在 R209 的 `package.json` 或 `bun.lock` 内。给 Rollup `external` 只会把问题推迟到浏览器运行时，不是修复。

## R210 修复

- 修改 `src/cloudCompositor/components/Step1Target.tsx`、`Step2Typhoon.tsx`、`SmartWMSTileLayer.tsx`，移除对未声明的 `react-leaflet` 的导入。
- 新增 `src/cloudCompositor/lib/LeafletReactLite.tsx`，使用已有的 `react` 和 `leaflet` 提供局部适配的 `MapContainer`、`useMap`、`WMSTileLayer`；保留卫星云图拼接页面的 WMS 地图、移动及更新时效等能力。
- 适配层负责创建和清理 Leaflet 实例、透传 `ref`、管理 WMS 图层生命周期，避免将 UI 专项修复扩展到主台风地图引擎。
- 从 `package.json` 中清理没有对应锁定条目的 `react-leaflet` 声明；不增加新依赖，也不改变 `bun.lock`，Cloudflare 当前 `bun install --frozen-lockfile` 仍可使用。
- 保留 R209 低内存构建配置、NMC 省界预构建、R208 新按钮和单文件 HTML 导出。
- 新增 `scripts/round210_cloudflare_missing_leaflet_dependency_regression.cjs`、`npm run test:round210-cloudflare`。

## 验证

- 相关四个 TSX 模块经 TypeScript 5.8.3 transpileModule JSX 语法测试通过。
- R210 专项静态回归 **25/25** 通过。
- AST 扫描 `src` 下 136 个 TypeScript/JavaScript 文件，没有发现未声明的包导入。
- R209 构建配置专项 **10/10** 通过。
- R204 地图 SVG 挂载回归 **9/9** 通过。
- R208 NMC 不确定性锥数值检查 **7/7** 通过。
- R185 NMC 防崩溃回归通过，R188/R189 参数、风圈保护回归通过。
- 某些 R203、R205、R207 旧检查仍要求“10px 历史打点”或已删除的原始实现，R208 基线为 9px，因此旧断言不适用。本轮未改动这些组件。

### 尚未完成

当前离线运行环境中没有已安装的 Vite、React、Leaflet 等项目依赖，无法实际执行完整的 `vite build`。本修复解决的是日志中明确定位的 `react-leaflet` 导入故障；Cloudflare 下一次完整构建仍须以线上结果验收。若出现新的报错，请提供首个 `error during build` 及其后几行的完整内容。

## 部署

把 R210 解压**覆盖更新 GitHub 仓库根目录**（不可直接把 ZIP 作为 GitHub 单个文件）。确保 `package.json`、`bun.lock`、`vite.config.ts`、`src/` 在仓库根目录。

Cloudflare Pages：`npm run build`，输出目录 `dist`，根目录 `/`。正常日志应看到 `2545 modules transformed` 一类统计后继续渲染 chunks、生成 `dist`。如果失败，将新错误日志作为下一轮定位依据。
