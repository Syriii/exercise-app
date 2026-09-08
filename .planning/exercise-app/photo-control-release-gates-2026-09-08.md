# B2b识别控制与结果替换交付门禁

## 本批范围与状态

本地实现与check/build/api:contract、138项单元/API、61项双端E2E通过。固定源码真实隔离PG共20项仍待验收。当前生产f7cfd13、迁移23；本批尚未发布。

## 新迁移（已获单次授权，尚未执行）

- 0023_photo_analysis_control.sql，SHA256 `7bef1e535469c74fff669499663d4cdac82c084ecab9816e570f315185a2fa3a`，journal when `1788874421379`。
- 枚举meal_image_analysis_status增加waiting；meal_image_analyses增加可空replacement_state；users增加photo_analysis_automatic（默认false）、可空photo_analysis_consent_at、photo_analysis_settings_revision（默认1）。迁移数23→24。
- 不新增表，不修改或删除历史餐食/训练/照片、密码或RLS策略。旧账号先手动识别，首次启用需确认发送范围；既有已发起任务不被取消。
- 新代码依赖这些字段，不能在迁移前切换应用。旧代码在新增结构但无新waiting记录时可继续服务；一旦新应用产生waiting记录，回退必须先评估旧代码状态兼容，不能承诺直接回退无损。
- ALTER TABLE/TYPE会持锁；仅运行此固定SQL及Drizzle登记，设置有界lock_timeout/statement_timeout，锁等待或失败回滚并保留现场，不强制终止业务连接。不用db:setup或通用db:migrate（会触达共享角色）。

## 隔离验收

仅在确认不存在/0连接的exercise_test建立假数据测试；使用preserveExistingPassword:true与已有只读secret，不查看密码。构建verification目标，不构建正式镜像、不改版本键、不部署。保留源码/脚本/脱敏日志；通过后仅清理本轮创建且无连接的测试库和integration容器。

新增两项须实际执行：

- atomically replaces complete photo results, rolls back late failures and protects undo with RLS
- persists photo consent without submitting old photos and isolates reanalysis and expired originals

前后核对生产API/Worker/PG身份、镜像、重启数、网络、角色非敏感属性和只读secret挂载不变，迁移仍23，live/ready与Worker心跳正常。不查询生产业务记录。

## 生产阶段单次授权（2026-09-08，待执行）

用户对完整影响问题明确答复“同意，通过全部门禁后执行”：前提是本批20项真实隔离PG通过，允许本项目受限私有备份、专用_test隔离恢复验证/本轮清理、仅0023生产迁移及API/Worker受限切换；备份保留、不包括原图或清理旧备份，不改密码、权限、历史业务记录，不重建PG。正式镜像固定SHA构建，窄脚本先审阅，所有门槛通过后才进入下一阶段；失败保留现场，不扩大操作范围。当前仅授权已取得，尚未开始这些生产阶段。

上一批f7cfd13的0021/0022及备份授权已执行，不覆盖本批。详见当前AGENTS.md和task_plan.md。
