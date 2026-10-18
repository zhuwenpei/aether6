# Round182 — NMC 全白图片 / 高分辨率卡死修复

基础：Round181。只调整 NMC 制图与交互输出，不修改物理引擎、存档格式、路径和强度算法、CMA 公开强度档位或精细海岸线数据。

## 发现的风险

1. NMC 允许在移动浏览器直接为 8K 分辨率分配约 5,000 万像素的单一 RGBA 画布，仅原始像素缓冲就超过 200 MB，PNG 编码与浏览器图片解码还需额外的副本。在移动设备或内存受限的浏览器中容易造成卡顿、空白图片和浏览器进程被系统回收。
2. NMC 底图使用精细海岸线多边形、国界、河流和省界；之前同步在主线程连续绘制，长任务期间页面无法刷新进度或处理取消操作。预览异步任务切换后只标记取消，但已经执行的绘制不会停下，可能与高清导出并发占用 GPU/CPU。
3. 先前缺少内容校验，浏览器即使给出画布上下文，也可能在 GPU 失败时返回没有正确绘制的空白图；`toBlob` 成功与否本身不能证明图片内容存在。
4. 生成结束后隐藏的高清 Canvas 仍然保留整张原始 GPU 位图，在重复生成时不断与 PNG 解码副本争抢内存。

## 主要修改

- `src/utils/NmcForecastProduct.ts`：保留同步绘制 API 与全部精细几何，新增合作式 `drawNmcForecastProductCooperative`：分批处理海岸填色、国界和细致描边、河网与省界，逐批让出事件循环、报告进度并响应 AbortSignal。新增 `hasNmcRenderedContent`，校验 WMC 实际标题墨迹，拒绝导出空白图片。河网绘制先按经纬度外接框剔除范围外的要素，保留范围内所有原始坐标精度。
- `src/utils/NmcRenderSafety.ts`（新）：根据移动端属性、设备可用内存以及 NMC 实际地图纵横比估算可安全分配的像素预算；低内存时不会直接开辟危险的 4K/8K RGBA 位图。桌面高内存设备仍可使用 8K。
- `src/components/ForecastImageModal.tsx`：预览支持真正取消，导出前终止正在运行的预览，导出中使用可取消的分批绘制；编码前复验图片内容；`toBlob` 空结果或绘制失败时自动重置失败画布、降到 1280px 重绘一次；生成后释放隐藏高清 Canvas 的 GPU 内存。预览面板显示**实际输出尺寸**，分辨率被保护性降低时会告知用户。
- 兼容回归断言 `scripts/round170_geography_rainfall_jma_physics_regression.cjs` 允许新的异步 NMC 调用方式。

## 验证

- Round158、166–182：19 个相关 `.cjs` 测试组通过。
- 新增 `scripts/round182_nmc_white_crash_regression.cjs`：NMC 风险预算、重复画布释放、一次性低清重试及合作式绘制入口。
- 新增 `scripts/round182_nmc_browser_canvas_regression.py`：使用 Chromium 和本项目真实 `product_coastline_fine_v5.geojson` / 国家边界数据，分别生成 640px 与 1920px NMC PNG，验证非空白像素、PNG 编码、取消能力及空白画布检测。均通过。
- 119 个 TS/TSX 文件语法解析通过，0 个相对导入缺失。

## 限制

当前源码包未包含 `node_modules`，未执行完整 Vite 生产构建，也没有在用户实际手机、具体台风 JSON 上进行长时间压力测试。浏览器会依据内存条件调整实际输出尺寸（预览窗口可见）。此修复旨在降低崩溃风险并检测、自动重试失败产物，不保证浏览器或操作系统在极端低内存环境永不终止进程。
