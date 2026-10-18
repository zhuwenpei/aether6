# AETHER 完整存档 — 提供给新 AI 对话的编辑说明

1. 在模拟器 **设置 → 存档 / 导出 → 保存 AI 可编辑 JSON**，得到 `AETHER_...aether.json`。
2. 在新对话中上传 JSON 文件并说明希望修改的具体物理参数、台风、时间或历史快照。
3. 文件第一部分包含 `format`, `schemaVersion`, `applicationVersion`, `exportedAt`, `aiEditingGuide`；实际模拟内容在 `data` 下。
4. `data.config` 是模型物理、环境、手绘路径等配置；`data.typhoons` 保存全部台风与其完整 `history`；`data.currentHour`、`data.maxHour` 是当前游标及历史末端时刻；`data.totalSimMinutes` 是物理时间。
5. 编辑后保留文件为标准 **UTF-8 JSON**，不添加注释（JSON 不支持注释）；保持台风 ID 唯一、历史 `simHour` 非递减、数值有限、`data.config.seed` 为字符串。
6. 如果要修改实时状态，还应检查与该时间对应的历史快照是否需同步。风速 `vmax` 单位 m/s，位置 `lat/lon` 为度，时间 `simHour` 为模拟小时。修改 `data.prngState` 或 `data.config.seed` 会影响后续随机过程，不建议无目的调整。
7. 将 AI 输出的完整 `.aether.json` 文件在模拟器点击 **读取存档文件** 导入，先预验证后确认覆盖。导入自动暂停。

如果只需要保存备份而非 AI 阅读，使用 **另存为小体积压缩备份（.aether）**。两种格式均包含同一份完整模拟数据。
