# B2b图片识别控制：真实PostgreSQL验收

## 结论与证据来源

固定源码 `d3c93e59ec347ef73da80990d5035dfe30bf212d` 真实隔离PG **20/20通过**。脚本仅执行一次，Vitest 17.04秒。远端任务 `01a0837d-798f-75e0-aa36-ce1714557dc7`（“114 B2b：固定源码20项PG隔离验收”），回合 `01a0837d-84f2-7370-b379-b9808f57700a` 耗时543018ms后completed；wait_threads取得最终摘要，read_thread取得完整最终正文，消息 `msg_05875f285ea3f5a2016aa0a526948887d0b7a15914ed5b5cc8`。本次直接读取，非用户转贴。

两项新增测试均通过：

- `atomically replaces complete photo results, rolls back late failures and protects undo with RLS`（264ms）。
- `persists photo consent without submitting old photos and isolates reanalysis and expired originals`（104ms）。

其余18项含RLS/凭据安全、训练草稿事务、餐食与食物目录、精度归一化、任务提交回滚和Worker恢复，全部通过。没有真实模型调用，不把PG验收当作模型准确性证据。

## 固定输入与远端产物

目录 `/tmp/exercise-b2b-prep.zHoqnS`；源码 `source-d3c93e59` 独立detached且干净；前置 `f7cfd134f3691d4bd28a95118342bce7f2a28823`。

| 产物 | SHA256 |
|---|---|
| source-d3c93e59.bundle（71683字节） | 95dd0c13c029a19c182edb538bd4655c36ec308eb8242b1f633706223f645e2f |
| run-b2b-verification.sh | e582250ebfd5240cb3e01d4845859b0f2f87d05eb72b71ccac0ab916a073e679 |
| compose.b2b.override.yaml | b85869dd98b0a07ca59439a8dd2ff634eb8c39b3cc115e35dc4de17f80a0c1f0 |
| postgres-integration.log | 936142b50c7d8714ecc6e37ed134e8c484f38ae84fe4f6c32a950e8a5978cbd6 |
| verification-build.log | a4a3c594be2640a10a060728e0a45f78c31e69fb96ad5bf87b6399612c4135f5 |
| b2b-verification-report-2026-09-09.md | b6345dca4a64dbcfe0d36aff026aef58c326e17b030017be7935849b686bf714 |

三份日志/报告0600，保留远端不上传私有记录。验证镜像 `exercise-app-verification:b2b-d3c93e59`，ID `sha256:69c2dea4fa8a3644bbeb5e0f47eff0b9062dff2bba26ca9e47365e2695ca2cdf`。

## 清理与生产保护

- 测试库迁移24；测试后 `exercise_test` 不存在、活动连接0，integration容器0、验收进程0。只删除本轮隔离测试库，假数据不可恢复但可由测试重建。
- 生产仍 `exercise-app:f7cfd13`，API/Worker镜像 `sha256:8b9a0d8e3497f4c6591ab0db9ad4bc0e15b0cebfb48b57221f08022f11ac1876`。
- API `aca3ae54a3305cf18fa8e99be9c150881ed4502aba2f6bc5f9bfbe8b42539e86`、Worker `e2c59ee25ad7e0411efe5cc4bcc0fe5181011ab3dd79adc892f9057980862ddb`、PG `890633238a9698dbbd43381f1af2d9e47e3efe3196ac1e7c692bcc3ec0009755` 的ID/镜像/网络及重启数均不变，均重启0，网络exercise-app_default。
- 生产迁移仍 `23|1788771226810`；角色 `exercise_api|t|f|f|f|f|f`，secret挂载readonly，preserveExistingPassword:true保持；未读取或改动密码。
- 独立后检查Worker心跳3秒，本机及公网live/ready全部200。无生产业务/媒体读取、setup、生产迁移、备份恢复、正式构建、版本键变化或切换。
- 远端保存仓库HEAD/main `41d472d8b0e5c531bce0d88561acac34021e3176`、origin/main `e324fd575935d7057fe2673829dc985e0efa2953` 不变，唯一旧未跟踪发布文档保留。

## 发布关联与待处理门禁

计划发布 `4f7211373a7ebafcdbacc4e9f3d48448b5290513`。本机git diff确认d3→4f仅Web、对应E2E和规划文档；服务器/根依赖/deployment不变，可在远端核对相同差异后沿用本次后端PG证据。增量bundle为3213字节、SHA256 `47073bd80bfe48d1d3b73935b6c48d59394d45972ddb8617fd5307920b605562`。

2026-09-09创建下一发布准备任务时，自动审批拒绝向114发送该源码bundle，理由为缺少具体源码载荷/目标的明确导出许可及目的地归属确认。未创建新任务，未传送成功、未绕过或换通道。需用户明确同意将此增量发送到自己的114测试部署服务后再继续。此前0023及备份/恢复/受限发布的条件授权仍保留，但尚未执行；不以本次PG通过直接宣称已发布。

后续处理：用户明确确认后进一步要求暂停bundle，改回本地push/远端Git获取。远端新任务已实际fetch成功（1592ms），origin/main达到eecbd9c且4f/d3对象齐全；保留分叉的本地文档提交，从已获取的固定4f Git archive导出发布上下文。没有传送上述bundle；原传送审批不再是当前阻塞。发布窄脚本正在另一个新原目录任务准备，生产尚未变化。
