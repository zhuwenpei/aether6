# R209 Cloudflare Pages 构建内存优化

## 故障
Cloudflare 日志显示 `bun install --frozen-lockfile` 成功（403 packages），`prebuild` 成功（34 省界数据），`vite build` 开始 `transforming...` 后，约 2 分半钟退出码 137。137 通常是 SIGKILL，结合托管构建环境，内存资源不足是首要嫌疑，但无法仅凭日志排除外部资源限制。

## 改动
- `src/index.css`：Tailwind CSS 4 使用 `source(none)`，只通过 `@source "./"` 扫描 `src/`，通过 `@source "../index.html"` 扫描入口，避免构建时自动扫描 `scripts/`、`validation/`、多年日志、Markdown 等文件。保留源码内现有动态 CSS/主题。
- `vite.config.ts`：生产模式关闭 JavaScript 和 CSS 压缩、gzip 体积统计与 source map，目标 es2022。降低高峰内存占用；代价是 JS/CSS 传输体积可能增加，Cloudflare 仍可对资源使用 HTTP 压缩。
- 不删除 `public/data` 下的 NMC 水系、省界或模拟地理数据；`prebuild` 原样保留。
- `scripts/round209_cloudflare_build_regression.cjs`：验证源扫描范围与构建参数。

## Cloudflare Pages 部署
构建命令 `npm run build`；输出目录 `dist`；工程根目录（存放 package.json 的目录）为仓库根目录。Cloudflare 可继续使用自己的 Bun 自动安装逻辑；不要额外执行两次依赖安装。上传 R209 源码至 GitHub 后点击 Retry deployment 或重新部署新的提交。建议不要在环境变量里设置 NODE_OPTIONS 极大内存限制来强迫进程超配。

## 已验证与限制
新配置检查 10/10；NMC 防崩溃回归通过。本环境缺少项目的依赖安装缓存，尚不能执行 `vite build`，也无法重现 Cloudflare 的内存限制。若仍为 137，请提供完整（未截断的）transforming 之后日志，并考虑改用性能更高的构建平台先构建，再部署 `dist` 到 Pages。当前不声称 Cloudflare 构建已经通过。
