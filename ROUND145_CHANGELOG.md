# Round145 — NMC 取景、墨卡托投影与 AI 可编辑模拟存档

## NMC 预报图
- 删除旧版固定 `spanLon / spanLat` 加强制“向西容纳东亚大陆”的取景算法。
- 增加 `src/utils/NmcMapViewport.ts`：统一使用 EPSG:3857 球面墨卡托的经度 x、Mercator 纬度 y，并以同一像素比例适配地图矩形。海岸线、多边形、城市、历史台风路径、预报路径、概率锥和经纬网共享相同投影。
- 预报中心路径没有触及有效陆地时：完整历史路径、当前中心和所有预报节点一起决定地图范围，留约 19% 几何余量。
- 预报中心路径触及有效陆地时：只用当前中心及完整未来预报节点决定范围，留约 15% 几何余量；地图不需要包含全部历史路径。
- 避免西北太平洋零星小岛错误触发切换：对真实 GeoJSON 中每个 **独立多边形** 计算近似面积，低于 5000 km² 的孤立岛屿不用于“显著触陆”判定。岛屿在底图上仍正常绘制，不会被隐藏或更改物理海陆判定。
- 路径按约 0.2° 间距采样判定，避免短暂越岛时漏判。该分类仅控制 NMC 产品取景，不影响台风模拟陆地效应。
- 回归覆盖无陆地时的完整历史、触陆时的紧凑预报取景、小岛过滤、横纵同尺度墨卡托投影及经纬度逆算。

## 可供 AI 直接编辑的完整模拟存档
- `设置 → 存档 / 导出` 新增默认推荐入口 `保存 AI 可编辑 JSON`。
- 文件扩展名 `.aether.json`，使用 UTF-8、标准 JSON 和缩进；新 AI 对话可以直接读取该文件，不必先执行 gzip 解压。
- 文件前部新增只读说明 `aiEditingGuide`（主要字段说明、台风索引、关键物理单位、历史顺序和随机状态注意事项）。说明位于大体积历史记录之前，便于新对话直接理解。
- 保存对象的正式数据结构仍为 `format/schemaVersion/applicationVersion/exportedAt/data`，导入仍使用原 Round144 的结构和合法性校验。修改数值后可重新导入。
- 保留 `另存为小体积压缩备份 (.aether)`。旧版 `.aether`（压缩/未压缩）导入兼容；文件选择器额外支持 `.aether.json` 和 `.json`。
- 提示：超长风季的可读 JSON 文件可能明显大于压缩备份；若只备份不修改，建议保存 `.aether`。

## 校验
- `node scripts/round145_nmc_mercator_ai_archive_regression.cjs`
- `node scripts/round144_complete_simulation_archive_regression.cjs`
- `node scripts/round143_nmc_ordered_straight_callout_regression.cjs`
- TypeScript 静态宽松检查 `tsc --noEmit --noCheck`

未在当前依赖不完整环境执行 Vite 生产构建或手机真机导出；Chromium 实绘尝试受此环境浏览器运行阻塞，未作为成功测试宣称。
