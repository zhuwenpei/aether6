# AETHER 6.0.49 Round211 修复记录

基线：Round210。目标：修复台风网新增按钮灰色底座、进一步收窄 NMC 低纬度后期不确定性锥，并使分享生成的单文件 HTML 按钮与主页面同尺寸、同布局。

## 修复一：透明按钮被全局玻璃效果污染

`src/index.css` 旧有全局选择器 `#root :is([role="dialog"], ...) :is(button, ...)` 带 `!important` 灰色玻璃背景/内阴影，匹配整个 `TyphoonNetworkSimulator` 模态页面内部的按钮。此选择器含 ID 优先级，使组件局部单纯设置 `background:transparent` 失效。已在全局规则的标准/hover/active 分支排除 `.tn-viewport` 内的按钮及按钮角色，并在组件底部增加透明度、边框、阴影及伪元素的隔离兜底。七个图标按钮使用原有 PNG，PNG 本身的浅色圆角方块属于设计素材，应保留；按钮**额外**的灰色方形底盘不再显示。

## 修复二：NMC 预报图低纬度后期不确定性锥

更改 `src/utils/NmcForecastProduct.ts` 的 `nmcPreWesterliesConeFactor()`：

- 0–60h：保持原宽度 100%。
- 90h：收至 90%（此前 94%）。
- 120h：收至 80%（此前 88%）。
- 其间线性过渡；当路径达到或超过 30° 纬度，维持原锥宽。
- 改动同时作用于 Canvas 锥形蒙版和信息框避障，**不修改预报路径、台风强度或 NMC 安全超时保护**。

## 修复三：分享的独立 HTML 按钮大小和样式

`src/utils/TyphoonNetworkStandaloneExport.ts` 旧版是全新一套 `header{display:flex}` 与 46px 的右侧控件布局；返回箭头用文本字符“←”。已改用与主页面一致的自包含样式：

- 移动端顶栏高度 46px，网格布局，三个图标依次为分享／参考／历史；用和主页面相同的白色 SVG 返回箭头。
- 390px/430px 宽度时顶栏功能图标 34px、右侧按钮 42px、左侧重播按钮 54px；360px 宽度时顶栏功能图标为 30px。
- 右侧控件在 65.4% 的视口高度开始，间隔 7px；左下重播图标离底部 52px（并尊重安全区域）。
- 各控件无独立灰底、额外边框、阴影和模糊遮罩，仍使用原始透明图片。
- 保留原有单文件 HTML 的内嵌图片、气象数据、离线地图轮廓、历史及预报可视化、参考图与回放功能；**未**擅自打包第三方高德瓦片。

## 独立验证

- `python scripts/round211_global_glass_exclusion_chromium.py`: Chromium 360、390、430px，七个按钮、正常/hover/active 状态均无额外灰色背景、边框或阴影。
- `python scripts/round211_standalone_layout_chromium.py`: Chromium 360、390、430px，八个控件尺寸与位置合格；JavaScript 无运行错误；参考页往返、夜间切换、回正和重播操作通过。
- `node scripts/round208_nmc_cone_numeric.cjs`: 更新后真实 NMC 函数 7/7 数值检查通过。
- `python scripts/round208_ui_export_validation.py`: 39/39 通过（更新旧版锥体期望）。
- `node scripts/round209_cloudflare_build_regression.cjs`: 10/10 通过。
- `node scripts/round210_cloudflare_missing_leaflet_dependency_regression.cjs`: 25/25 通过。
- `typescript.transpileModule()`：NMC 和 HTML 导出文件、主台风网 TSX 语法无错误。

## 限制

- 以上 Chromium 为带实际导出模板和局部全局规则的独立浏览器运行，不是整个 React+Leaflet 手机应用的实际联网加载；需部署后在手机上复验。
- 当前环境没有安装该工程 Vite 前端依赖，因此尚未完成完整 `vite build`，不能声称 Cloudflare 构建已通过。
- NMC 后期锥体宽度是视觉修正，不代表官方概率校准。
