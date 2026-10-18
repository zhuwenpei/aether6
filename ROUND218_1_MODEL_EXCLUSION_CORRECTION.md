# AETHER 6.0.49 · R218.1 模型排除项更正

根据用户纠正，外国机构主路径随机分配的排除项为 **WNV3 和 FNV3**，而非 R218 所写的 FNV3 和 GEM。

- 可分配模型：ECMWF、AIFS、GEFS、AIGEPS、HGEFS、GEM（6 个）
- 禁止分配模型：WNV3、FNV3
- `src/utils/NetworkAgencyEnsemble.ts` 更新唯一模型候选池筛选条件。
- 三个国家仍各自固定对应一个不同模型主路径，按台风 ID 与配置种子保持确定性。
- 各机构既有强度权重、登陆限制、警戒线、入线后 1h 历史与动画均不变。
- `scripts/round218_warning_mainpath_quiet_regression.cjs` 更新固定分配断言，并增加候选池和 GEM 实际可分配检查。
- 无其他功能改动。
