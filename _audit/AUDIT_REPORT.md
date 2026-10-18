# 深度审计报告

## 结论

该抓取包的核心项目文件完整，未发现损坏的本地游戏资源或缺失的内置场景文件。原 ZIP 中存在 13 个由引用扫描误判生成的空目录，已经从最终包中移除。实际文件内容没有修改。

## 版本与来源

- Project ID：`ut40m21wzk2gbqieril7`
- Revision：`1`
- 部署 URL：`https://satellite-war-organic-frontlines--icysky64119725.on.websim.com/`
- Canonical：`https://websim.com/@icysky64119725/satellite-war-organic-frontlines`
- 页面显示版本：`v1.4.0-BETA`

本次上传的 `websim-source-satellite-war(1).zip` 与此前的 `websim-source-satellite-war.zip` SHA-256 完全相同：

`24511d39ffb3fb86711fae6827e0027c6695451a4752e49fd5e4649badd7ba26`

说明两份 Websim 源包是逐字节相同的 ZIP。

## 文件完整性

原抓取根目录共有 25 个实际文件：

- 核心代码：`index.html`、`main.js`、`style.css`
- Logo：`other thing (1).png`
- 音频：5 个 MP3 + 2 个 WAV + 1 个战争环境 MP3，共 8 个音频文件
- 地图/场景数据：11 个 JSON
- 抓取/来源元数据：`manifest.json`、`SOURCE_MANIFEST.json`

`SOURCE_MANIFEST.json` 中列出的文件大小与 SHA-256 均与实际文件一致。

## 删除的误抓取目录

原 ZIP 内有 13 个空目录，不属于游戏源码。例如：

- `${CONFIG.GEOJSON_BASE}${mapRes}/`
- `${CONFIG.GEOJSON_BASE}${mapRes}/cultural/`
- 以 `> ... </div>`、`Never show this again` 等 HTML 模板片段命名的目录

这些目录来自自动资源引用扫描器误把模板字符串当成路径。它们为空，并且游戏代码不会从这些目录读取本地文件，因此删除不会影响运行。

## JavaScript / HTML / CSS

- `main.js` 通过 `node --check`，未发现 JavaScript 语法错误。
- `index.html` 中实际本地入口引用：`style.css?v=1`、`main.js?v=1`、`/other thing (1).png?v=1`，最终包中均存在。
- `main.js` 中所有内置场景 JSON、MP3、WAV 的字面量本地引用均存在。
- CSS 未发现额外的本地 `url(...)` 资源依赖。
- 静态 DOM ID 扫描发现 11 个旧变量引用对应的 ID 不在 HTML 中，但这些变量在声明后没有再次使用，因此属于残留/死代码，不构成当前运行缺失资源。

## 地图/场景 JSON 深度校验

以下 11 个 JSON 均能完整解析：

- `world map 2022.json`
- `ww2_releasables_fixed_preset.json`
- `1942.json`
- `world_war_1__1914_.json`
- `1804_map.json`
- `1492_map (2).json`
- `1ad.json`
- `my_custom_preset (7).json`
- `canada_states (1).json`
- `1948 (1).json`
- `better_cold_war_preset.json`

对全部场景执行了：

- `mapData` pair 格式检查
- 网格索引重复检查
- `mapData` 国家 ID 是否存在于 `metadata` 检查
- metadata ID 重复检查
- cities owner/country ID 一致性检查（存在 cities 的文件）

结果：未发现坏 pair、重复网格索引、未知国家 ID、重复 metadata ID 或未知城市归属 ID。

部分历史场景存在相同国家名称的多个 metadata 项，这属于数据设计/历史可释放国家结构，ID 本身仍唯一，因此没有自动修改。

## 媒体资源

- `other thing (1).png`：有效 PNG，587×134，RGBA。
- 所有 MP3 均能被媒体探测器读取。
- `peace.wav`、`war.wav` 均为有效 PCM WAV。
- 音频时长从约 0.63 秒到 242.11 秒不等，未发现零长度或明显截断文件。

## 外部依赖与“离线完整性”

项目不是纯离线应用。原代码运行时会访问：

- `api.websim.com`
- `esm.sh`
- `unpkg.com`
- `server.arcgisonline.com`
- `mt1.google.com`
- `flagcdn.com`
- `raw.githubusercontent.com`
- `images.websim.com` / `images.websim.ai`

以及 Websim 的用户、上传、评论/Hub 等 API。最终包没有把这些第三方/平台服务伪装成本地文件，也没有修改原代码来绕过它们。

## 关于 manifest.json

根目录 `manifest.json` 是抓取器生成的资源引用记录，其中包含若干被误识别的 HTML/模板字符串“references”。它不被 `index.html` 或 `main.js` 运行时引用。为保留来源证据，本包仍保留该文件原样；错误空目录则已删除。

## 最终处理原则

- 不重写 `index.html` / `main.js` / `style.css`
- 不压缩、不格式化、不改名核心文件
- 不修改大型地图 JSON
- 不重新编码音频/图片
- 只删除确定为无意义且为空的抓取器误建目录
- 添加 `_audit/` 文档，不参与游戏运行
