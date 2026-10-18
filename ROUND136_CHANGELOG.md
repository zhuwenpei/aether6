# AETHER 6.0.39 — Round136：手机手绘预报编辑器居中修复

## 问题

在手机浏览器中进入手绘大体预报路径界面后，底部四按钮工具栏和“目标预报强度曲线”编辑窗整体向左偏移，严重时一半内容位于屏幕外。全屏曲线编辑器也会继承普通弹窗的水平平移。

## 根因

Round133 为解决手机图层裁切而把两个浮动组件挂载到 `document.body`，同时给 CSS 增加 `transform: translateX(-50%)`。但组件自身还带有 Tailwind v4 的 `-translate-x-1/2` 类；Tailwind v4 用独立的 CSS `translate` 属性实现这一类，它**不覆盖** `transform`，两者会**叠加**，形成两次 -50% 位移，导致整个控件向左错位约自身宽度的一半。单纯增加 `left:50%` 或 `max-width` 无法修复。

## 本轮改动

- `src/App.tsx`：手绘预报工具栏移除冗余的 Tailwind `-translate-x-1/2`；保留 body portal，避免地图容器的裁切/变换影响定位。
- `src/components/ForecastIntensityCurveEditor.tsx`：普通强度曲线窗口移除冗余的 Tailwind `-translate-x-1/2`；保留原曲线绘制、240h 自由控制点等功能。
- `src/index.css`：两种普通浮窗只使用单一 `transform: translateX(-50%)`，明确将 CSS `translate` 置为 `none`，与 Tailwind v4 的变换机制解耦。手机布局继续根据 `visualViewport.width/offsetLeft` 计算真正的可视区域中心和适配宽度。
- `src/index.css`：手机强度曲线**全屏状态**单独按 `visualViewport` 左上角、宽度、高度进行布局，并同时取消所有水平平移；避免将普通居中规则带入全屏。
- `scripts/round136_mobile_forecast_centering_regression.cjs`：新增无需安装依赖的静态回归检查。
- `scripts/round136_mobile_forecast_layout_browser.py`：新增可选 Chromium/Playwright 实际浏览器几何测试（需要环境安装 Python playwright + Chromium）。
- `package.json`：新增 `npm run test:round136`。

## 验证

- Chromium 模拟手机/平板视口 **320×650、360×740、390×844、432×915、768×1024**：普通工具栏、曲线窗口均居中且不越界；全屏窗口左右各 8 CSS px。
- 特殊可视区域案例：layout viewport 432px，visual viewport 左移偏量 60px / 顶部偏量 30px，宽 300px、高 640px，测试通过，浮层仍按可视区域放置。
- TypeScript：`tsc --noEmit --noCheck -p tsconfig.json` 通过。
- Round120、Round121、Round128～Round136 回归通过。
- 项目包不含 `node_modules`，当前未执行完整 Vite 生产构建；浏览器几何验证是隔离浮层布局测试，不等于移动设备完整功能实测。

## 不涉及

未修改台风物理积分、存档、预报计算、120h 产品限制、240h 手工强度曲线、时间轴等行为。
