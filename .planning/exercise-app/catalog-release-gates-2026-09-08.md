# 饮食目录批次发布门禁（2026-09-08 已执行完成）

固定f7cfd13已完成私有备份、真实隔离恢复、仅0021/0022生产迁移和API/Worker受限发布；公网版本f7cfd13、迁移23。首次隔离验证的name[]类型误报经最小修正后重验通过，原备份/失败日志保留。执行证据及哈希见[发布记录](catalog-release-verification-2026-09-08.md)。下文保留本轮执行前门禁与授权背景，不作为重新执行或后续迁移许可。

## 固定范围

- 公网已知基线31acb96，生产业务迁移21。目录功能需要0021/0022，完成后为23。
- 0021在meal_contributions和meal_contribution_revisions新增food_snapshot；在personal_food_templates新增catalog_key、catalog_metadata、is_favorite及(user_id,catalog_key)唯一索引。0022在meal_contributions新增selection_batch_id。
- 无新表、无历史餐食合并/删除，无凭据、RLS策略或角色密码改动。旧catalog_key为空，已有个人食物保留常用默认值；新增字段对旧应用兼容。
- ALTER TABLE/索引创建会持有数据库锁，应设有界lock_timeout/statement_timeout；遇等待或失败回滚并保留现场，不强制断开业务连接。
- 本机固定源码复核：0021 SHA256 17e21eb3dfebe52ae61535e3c8b293d948ecd90a6d9c7a5b6c0a86dee7b6c6ca，journal时间1788769931859；0022 SHA256 d59f6f23695dcef0090a159f74b31f78a89a98d951c47435e758fd5fa9adfe72，journal时间1788771226810。journal SHA256 6aa45966fc581f96a7a7548b5e96102c68ba847f95eb191a0ff1a58c8b43ab4f。Drizzle用原始SQL UTF-8文本SHA256登记hash，不能对去除断点标记后的执行文本重新取hash。

## 已有验证与待补证据

- 532320ad真实PG17/17完整报告已取得，包含0021/0022；测试库清理及生产前后不变通过。
- c46a548目录防重复：本地133项单元/API、59项E2E通过。远端旧回合中断；恢复核对正文已在用户重启应用后由两个接口直接取得，确认中断发生在bundle接收前，18项未执行、exercise_test不存在且连接0，生产未变。
- f7cfd13补个人食物三位小数归一化：本地133项单元/API、check/build及受影响E2E2/2通过。用户转贴固定f7cfd134f3691d4bd28a95118342bce7f2a28823真实PG18/18通过，新增防重/改变与删除重试拒绝用例及高精度归一化断言通过。exercise_test迁移23后不存在、连接0，integration容器已删除，生产保护通过且迁移仍21。完整日志/报告路径、哈希与来源边界见progress最新条目；未执行生产操作。

## 已取得并执行完成的单次授权（2026-09-08）

用户明确回复“同意”，覆盖以下范围；脚本先由主任务审阅，获准执行后不再重复索取相同授权。

1. 创建本项目业务数据库的受限私有备份及校验清单，不含临时照片；不读取/输出私有记录或secret。保留旧备份，不自动清理。
2. 在明确核实不存在且无连接的专用_test库中验证备份可恢复，只读核对结构；清理本轮创建且无连接的测试库。真实备份不得提交或通过任务正文回传。
3. 仅运行已审阅0021/0022版本化迁移并登记迁移记录；不运行setup、队列迁移、初始化账号或共享角色改密。
4. 沿用持续授权构建固定SHA正式镜像，构建/版本及入口验证安排在生产迁移前；迁移门禁通过后只改应用两个版本键并重建API/Worker，再核对公网版本/live/ready、未登录私有接口401及PG容器不变。

## 不能直接复用的宽入口

- apps/server/src/entrypoints/migrate.ts会调用ensureApiDatabaseRole且未传preserveExistingPassword，不能当作仅迁移入口直接执行。
- deployment/scripts/backup.sh会写maintenance_events并按保留天数删除旧备份，超出本次最小备份范围。
- deployment/scripts/verify-backup-restore.sh会compose up -d postgres并调用通用清理，不能作为本次窄恢复入口。
- 应在授权后准备并审阅固定目标的窄执行脚本，所有路径/版本/目标库经只读核实；不替换项目通用脚本，不扩大服务范围。

## 回退

- 应用切换失败优先保留现场，回退到已知31acb96镜像及原两个版本键；新增兼容字段不自动删除。
- 不自动回滚SQL结构或恢复覆盖生产库；需要数据恢复时另列具体影响并重新获授权。

识别控制、结果替换和C/D页面未完成，本门禁只覆盖已验收饮食目录与首页简化，不代表全App改造结束。
