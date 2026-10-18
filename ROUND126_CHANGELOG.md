# ROUND126_CHANGELOG

## 1. 麻将音改为用户提供的实录双触发声音

- 使用用户提供的 `low-button-click-331780.mp3` 作为麻将音新素材。
- 原素材包含两个清晰撞击瞬态，检测到主要瞬态约位于 0.032 s 与 0.173 s。
- 自动拆分为：
  - `src/assets/audio/mahjong-press.wav`：按下声；
  - `src/assets/audio/mahjong-release.wav`：松开声。
- Mahjong 模式下，全局 UI 交互从原来的 `click` 单次触发改为：
  - `pointerdown` → 第一声；
  - `pointerup` → 第二声。
- 保留 mouse 模式原来的单次 microswitch 点击反馈。
- 为已有组件里的 `playSndClick(..., "mahjong")` 加去重：真实 pointerdown/up 已经播放时，后续 click handler 不会重复播放。
- 对非指针触发/预览操作保留兼容行为：第一声后约 72 ms 自动播放第二声。
- 设置项文案更新为“麻将音（实录双触发）”。

## 2. 全局 UI 继续统一为中性色 + 毛玻璃

- 新增统一中性设计 token：主表面、控制表面、hover/active、边框、文字、弱化文字。
- 统一主要界面表面：控制抽屉、台风状态卡、时间轴、强度面板、影响弹窗、报告、站点页面、飞机侦察、产品中心、视频导出等。
- 主要面板使用低饱和灰色半透明渐变 + 20 px blur；子控件不叠加 blur，仅使用半透明中性灰，减少 GPU 过绘。
- 各类旧蓝/青/紫/绿 UI chrome 在主要工作区中收敛为中性表面；气象图、地图、canvas/SVG 产品配色不受影响。
- select、checkbox/radio/range、滚动条和 Leaflet 信息弹窗继续统一为无彩色中性语言。
- 保留 `prefers-reduced-transparency` 降级，关闭透明时改为实体中性灰。

## 验证

- `node scripts/round126_audio_neutral_glass_regression.cjs`
- `tsc --noEmit --noCheck`
- Round125 / Round124 / Round123 REDO 回归继续执行。
