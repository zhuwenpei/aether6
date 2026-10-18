# Round 63 Changelog

- 修复手机端点击右上角“更多”后工具面板被顶部栏 paint containment 裁剪、看起来压在后面的问题。
- “更多”打开期间仅临时取消顶部栏的 paint containment，并提升顶部栏/菜单的 stacking context；关闭菜单后仍保留原性能隔离。
- 菜单现在会正常覆盖地图、状态栏和底部时间轴等交互层。
