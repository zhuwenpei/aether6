# Round 62 Changelog

- 将主要气象图的信息层尺寸基准恢复为用户提供的旧版 v37（1080p）视觉大小。
- 这次恢复了 ForecastImageModal 各主产品图、EnsembleReferenceProducts、StationReportRenderer 的尺寸基准，不再沿用 v40 的统一放大倍率。
- Wiki 路径图单独采用“旧版 v37 再大一档”的尺寸：路径线宽和打点都略大于旧版。
- 打包时排除 `.git`，恢复正常 ZIP 体积。
