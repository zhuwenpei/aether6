# TyphoonSIM 3.5.8 公开资料与实现依据

本文件记录3.5.8涉及的公开业务资料、浏览器API依据和用户参考图颜色校准。公开资料用于设计/字段含义/性能实现，不代表复制任何机构内部算法。

## JMA台风信息表达

日本气象厅《台風情報の種類と表現方法》说明：

- 台风実況包含中心位置、移动方向/速度、中心气压、最大风速、最大瞬间风速、暴风域和强风域；
- 黄色实线圆表示15 m/s以上强风域；
- 红色实线圆表示25 m/s以上暴风域；
- 风区不对称时，表示风区的圆心可以与台风中心不同；
- JMA现行台风路径产品的远期预报信息按固定业务时次更新，图上预报圆/暴风警戒域有明确业务语义。

来源：
https://www.jma.go.jp/jma/kishou/know/typhoon/7-1.html

3.5.8 的“ひまわり9号 観測風”没有改变上述15/25 m/s风区语义；只是按用户要求把复盘画面中的风区**显示几何**冻结成每6小时一组，六小时内只随台风中心平移。

## JMA与黑灰参考底图颜色

用户本轮上传的JMA预报图和黑灰地图截图用于clean-room颜色校准。使用图像主色/聚类和海陆代表区域抽样得到：

- JMA海洋主色约 `RGB(25,99,206)` → `#1963CE`；
- JMA陆地主色约 `RGB(89,150,91)` → `#59965B`；
- 黑灰海洋主色约 `RGB(38,38,38)` → `#262626`；
- 黑灰陆地主色约 `RGB(15,15,15)` → `#0F0F0F`。

实现只复刻海陆基色、海岸线/行政线的低对比关系；不复制参考图上的文字、机构标识、手机UI或水印。底图几何直接来自项目Natural Earth本地数据。

## WebCodecs视频编码

MDN `VideoEncoder` / WebCodecs 文档说明浏览器可在支持的环境中直接配置硬件/软件视频编码器，并通过 `isConfigSupported()` 探测具体codec配置。3.5.8 的气象站变化视频因此在编码前主动探测H.264/H.265候选配置，避免在不支持的设备上生成伪格式文件。

来源：
https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder

## Canvas性能原则

MDN Canvas优化建议包括：避免不必要的重复绘制、尽量复用预渲染结果/离屏内容、只做实际需要的像素工作，并减少主线程高频无效绘制。3.5.8没有降低模拟积分或物理采样质量，而是把优化集中在：站点诊断复用、排行缓存、轻量预览、编码背压/进度节流、网络瓦片跳过和非关键栅格Canvas帧率上限。

来源：
https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas

## OffscreenCanvas（研究结论）

MDN说明 `OffscreenCanvas` 可将Canvas渲染移出DOM，并在Worker环境使用。由于本项目大量现有绘制函数直接依赖DOM、Leaflet状态和同步Canvas上下文，本轮没有为了“看起来更优化”而大规模迁移到Worker，避免在没有运行时回归测试的前提下增加稳定性风险。本轮优先采用缓存、节流和共享渲染器等低风险优化。

来源：
https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
