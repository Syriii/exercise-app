# 饮食目录与首页收敛发布验收

2026-09-08完成受限发布。源码固定f7cfd134f3691d4bd28a95118342bce7f2a28823，公网版本f7cfd13，生产迁移23。本记录只含脱敏证据，不包含备份、业务行、secret或原始私有日志。

## 范围与证据来源

- 本批上线B1统一食物目录、整体分类与常用排序、个人食物/包装食品保存防重及高精度归一化，和B2a饮食首页收敛；保留已上线S1、A/E。B2b识别控制/替换恢复、C训练、D今天/首次设置/我的/历史仍待完成。
- 固定f7真实PG18/18由用户转贴，沿用其准确版本证据；本轮未重跑完整PG测试、真实模型或人工写入生产业务。
- 本轮脚本全文、构建、备份恢复、生产迁移与发布结果均经新114原目录任务直接读取，不是用户代抄。任务01a08039-2368-7553-bfdf-8aaca957e0b6，cwd /newdata/data/xiesh/exercise-app；旧任务按用户要求归档，新任务不创建工作树。
- 最终发布回合01a08059-16dd-7970-a9ad-421583dec7c2，startedAt1788859717、completedAt1788860024、durationMs306993，completed/idle。wait_threads与read_thread均取得同一完整最终正文，消息msg_0cb943306c612d9b016a9fd6501ff487d08299672c3e184f14。Stage3/4/5/6全部成功。

## 审阅与失败修正

准备目录为远端/tmp/exercise-f7-release-prep.6GSHYj。主任务完整审阅14份脚本/文本，并重建本机副本/tmp/exercise-f7-script-review.VcbGtA，逐字节哈希匹配。固定业务SQL已按源码核验：

| 文件 | SHA256 |
|---|---|
| 0021_food_catalog_snapshots.sql | 17e21eb3dfebe52ae61535e3c8b293d948ecd90a6d9c7a5b6c0a86dee7b6c6ca |
| 0022_food_selection_retry_identity.sql | d59f6f23695dcef0090a159f74b31f78a89a98d951c47435e758fd5fa9adfe72 |
| meta/_journal.json | 6aa45966fc581f96a7a7548b5e96102c68ba847f95eb191a0ff1a58c8b43ab4f |

审阅后实施三个窄修正：

1. API/Worker切换和应用回退命令加--wait --wait-timeout 90，避免启动尚未健康时误判。
2. 不含敏感字面量的迁移脚本由0600 root:root改为0644，父目录仍0700；无网络、无secret、只读node容器test -r由退出1变0。未修改secret权限。
3. 首次真实隔离恢复成功，但唯一索引检查失败并回滚。主任务本机与正式镜像纯内存均复现pg-types把OID1003(name[])返回为字符串，而OID1009(text[])返回JS数组。仅将验证器a.attname改为a.attname::text，保留唯一性、两列顺序及全部事务安全检查，业务SQL不变。

首次隔离库清理至不存在/连接0，失败日志保留，生产未变。新增restore-existing-backup-verify.sh复用同一固定备份，使用retry1新日志；全文审阅、本机副本哈希和语法验证通过后执行一次，真实恢复与21→23迁移、六列、索引、约束/RLS/ACL/角色校验全部通过。没有重新备份或重新构建。

最终验证器SHA256：6905f420a2c70e895c77fa6c30bc83b47da227f9ad48ba5925a3a5734277854a。
retry1脚本SHA256：3d2f483b35cb11f2c8c5d593254534a8a834800eafee884ffa25414df4d7cdcd。
最终17项产物清单SHA256：ba63ce96e8a8e46ec182775725bda155ff0858cb63f51c1c2e297087e2202c88。

## 私有备份与报告

远端私有目录/newdata/data/xiesh/exercise-app-private-backups/f7cfd13为0700，以下文件均root:root 0600，保留在服务器，不复制进仓库。

| 文件 | 字节 | SHA256 |
|---|---:|---|
| exercise-pre-f7cfd13.dump | 213230 | e360ce9ce5febb37b9eef388a44581ae6fb7b30b29dc68676264ddfdd1e8fc46 |
| exercise-pre-f7cfd13.dump.manifest.json | 327 | 2ea50f53d86639b9b2b25e68411a63e73f09deb23b23f316a636b61610bace77 |
| restore-verification.json | 647 | 5de87599c8da8729d4d4ea6e955bb71f1c27e4ecd2ef33cea7175d351abac044 |
| production-0021-0022.json | 657 | 98c4cbab80975d60497bdd7c9982c9b4c8a24d4855d2f61fd0b8cf881ec68da0 |
| api-worker-release.json | 379 | d951f3e43c8a7126db8fa689ab949bd33e78ce1d005b49c96beec7a6cb944d99 |

备份为postgres-custom，不含global roles或媒体volume。真实恢复后、迁移前的结构/约束/RLS与备份源一致；只查询元数据，不查询用户记录。exercise_f7_restore_test已清理，不存在、活动连接0；migration-only临时容器0。原备份与首次失败日志均保留，可在另行确认的隔离目标恢复；本轮不恢复覆盖生产。

## 生产迁移与运行状态

- 仅0021/0022单个事务，Drizzle完整ledger21→23；lock_timeout=5s、statement_timeout=60s。六列/唯一索引与安全元数据检查通过，无setup、队列迁移或角色改密。
- 正式镜像exercise-app:f7cfd13，只构建一次，完整ID sha256:8b9a0d8e3497f4c6591ab0db9ad4bc0e15b0cebfb48b57221f08022f11ac1876。API/Worker入口、内嵌Web版本、SQL哈希通过。
- 仅apply_patch修改APP_IMAGE_TAG、APP_BUILD_REVISION为f7cfd13；.env保持0600，非版本内容归一化哈希与执行前一致。
- 仅重建API/Worker，均运行新镜像、重启0，API healthy；Worker心跳正常。网络、角色及只读secret挂载未变。

| 容器 | 最终ID |
|---|---|
| API | aca3ae54a3305cf18fa8e99be9c150881ed4502aba2f6bc5f9bfbe8b42539e86 |
| Worker | e2c59ee25ad7e0411efe5cc4bcc0fe5181011ab3dd79adc892f9057980862ddb |
| PostgreSQL，保持原容器 | 890633238a9698dbbd43381f1af2d9e47e3efe3196ac1e7c692bcc3ec0009755 |

PG镜像仍mirror.ccs.tencentyun.com/library/postgres:18.6-bookworm，完整ID sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af，重启0。未重建PG、Nginx或其他服务，未改端口/secret/volume/宿主配置。远端保存仓库41d472d8及旧S1未修改。

## 独立公网复核

主任务本机2026-09-08 17:32:27北京时间（09:32:27 UTC）直接只读请求http://114.132.232.9:5011：

| 路径 | 结果 |
|---|---|
| / | 200 |
| /api/v1/health/live | 200 |
| /api/v1/health/ready | 200 |
| /api/v1/auth/me，未登录 | 401 |
| /api/v1/nutrition/meals?from=2026-09-08&to=2026-09-08，未登录 | 401 |
| /assets/index-BEEsk-2y.js | 200，包含f7cfd13 |

远端同样完成本机/公网健康、私有401与JS版本后验。以上仅证明版本和服务/权限入口健康，不冒充生产账号交互或真实模型专项验收。

## 剩余工作

本次发布及2026-09-08单次迁移授权已收口，不重复执行。继续B2b识别控制/替换恢复，再实施C、D；域名/HTTPS按用户决定后移。远端新原目录任务多轮长回合可读，当前无需用户复制，不据此将工作树认定为唯一根因或宣称客户端永久修复。
