# TyphoonSIM 3.5.10 公开资料与实现依据

本版本主要是产品入口与UI信息架构整理，不修改台风物理积分、降水机制或预报强度算法。联网资料仅用于校对“台风预报产品”和“高层/探空观测产品”应当作为不同产品族展示的方向。

## JMA产品分类参考

日本气象厅信息目录将“台风”作为独立产品类，内容包括位置、移动、气压、风和预报等台风信息；高层气象观测则作为另一产品类，包含由radiosonde获得的气温、露点差、风向、风速等垂直观测资料。

参考：
- JMA 台风信息目录：https://www.data.jma.go.jp/suishin/cgi-bin/catalogue/make_product_page.cgi?id=Taifu
- JMA 高层气象观测目录：https://www.data.jma.go.jp/suishin/cgi-bin/catalogue/make_product_page.cgi?id=KosoKish
- JMA 数值预报图目录：https://www.data.jma.go.jp/suishin/cgi-bin/catalogue/make_product_page.cgi?id=SuYohozu

3.5.10据此没有把飞机探空继续作为气象图编辑器顶部的“工具按钮”，而是将“台风探空报告图”放到产品选择网格，与其它独立输出产品处于同一信息层级。TyphoonSIM的探空数据仍为模拟诊断，不宣称为JMA或任何机构真实观测。

## 移动端Dock原则

台风总结报告底部操作区采用两个等宽主操作 + 一个固定宽度图标关闭操作。这样在窄屏上无需换行，同时保留安全区padding，减少浏览器底部工具栏或系统手势区域对按键的遮挡。

## 纯文字快报

事件日志本身继续保留原始消息，显示层再清除emoji/图形符号。这样既满足快报“只显示纯文字”的产品要求，又避免修改历史存档结构或其它可能依赖原始事件消息的功能。

## 删除UI皮肤的兼容策略

删除全局UI风格后，旧localStorage可能仍携带 `uiStyle`。3.5.10在读取旧配置、恢复模拟状态以及应用配置补丁时显式丢弃该字段，使旧设置不会重新触发已经删除的视觉运行路径。
