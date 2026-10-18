# Satellite War: Organic Frontlines — 最终整理源码包

这是对 Websim 项目公开部署文件的清理/核验版源码包。

- Websim 项目：`@icysky64119725/satellite-war-organic-frontlines`
- Project ID：`ut40m21wzk2gbqieril7`
- Revision：`1`
- 对应部署：`https://satellite-war-organic-frontlines--icysky64119725.on.websim.com/`
- 页面版本标识：`v1.4.0-BETA`

## 本次整理做了什么

1. 保留抓取包中的全部 25 个实际文件，源码和资源文件均不修改字节内容。
2. 删除 13 个由资源扫描器误识别产生的空目录，例如 HTML 片段目录、`${CONFIG.GEOJSON_BASE}${mapRes}/` 模板目录。
3. 校验 `main.js` JavaScript 语法。
4. 校验全部 11 个大型地图/预设 JSON 可完整解析，并检查 mapData pair、重复索引、国家 ID 引用一致性。
5. 校验全部本地静态资源引用；游戏实际引用的本地 PNG、MP3、WAV、JSON、CSS、JS 均存在。
6. 校验 PNG/WAV/MP3 文件签名及音频可读取性。
7. 保留 `SOURCE_MANIFEST.json` 和 `manifest.json` 作为来源/抓取记录；它们不是游戏运行必需文件。
8. 在 `_audit/` 中加入审计报告与 SHA-256 校验表。

## 本地运行

不要直接双击 `index.html`。该项目使用 ES Modules 和 `fetch()` 读取 JSON，建议通过 HTTP 服务启动：

```bash
cd Satellite-War-Organic-Frontlines-FINAL
python3 -m http.server 8000
```

然后访问：

`http://localhost:8000/`

## 重要：仍然需要联网的功能

这个包包含项目自身公开部署的本地源文件和资源，但原项目本身还依赖外部运行时服务，包括：

- Leaflet 1.9.4：`unpkg.com` / `esm.sh`
- ArcGIS / Google 卫星地图瓦片
- Natural Earth GeoJSON（GitHub raw）
- flagcdn.com 国旗资源
- Websim API / upload / comments / user / hub 等功能
- 部分 Websim blob / image 资源

因此这不是“完全断网可运行”的第三方依赖镜像，而是这个 Websim revision 的完整本地项目文件整理包。核心游戏本地文件未被改写。

详细检查结果见 `_audit/AUDIT_REPORT.md`。
