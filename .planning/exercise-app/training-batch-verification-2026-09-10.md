# C1 事后批量训练记录验收

## 范围与状态

实现事后整条训练的创建、修改、删除；本地会话草稿、参考计划／上次实际内容、多动作录入、按组及各组差异、时长／距离／次数、未知数量、日期及可空大致时间。计划管理独立页面保留单次／周期／系统建议／动作指导，今天与历史进入同一批量编辑。旧接口与历史保留，旧待完成动作不会成为实际。

C1不等于C/U04完成。独立日期安排快照、稳定计划项关联、累计量进度和计划管理名词／层级统一属于C2；当前来源计划只是复制参考，不能宣称已按新关联规则抵扣日期安排。D今天／首次设置／我的／历史整体精简未完成。

## 本地证据

- `npm run check`、`npm run build`、`npm run api:contract`通过；单元/API142项通过。
- 固定构建完整手机／桌面67项通过（40.2秒），包括布局宽度回归；最后标题衔接和旧记录兼容用例的18项定向回归通过（15.7秒）。
- 新接口用例覆盖整条新增／替换、保留修订、未知与零值、非法字段拒绝、响应丢失同请求重试、改内容重试拒绝、跨账号、并发版本和删除后旧请求不可恢复。
- 双端覆盖多动作／不同组、时长距离、只记动作、计划复制不写事实、周期内容、历史整条修改删除、冲突核对、页面切换和丢响应重试。手机截图核对发现名称偏右后已修正；页面横向无溢出。截图仅假数据。
- 本地日志：`/tmp/exercise-c1-tests.log`、`/tmp/exercise-c1-build.log`、`/tmp/exercise-c1-contract.log`、`/tmp/exercise-c1-e2e-full.log`、`/tmp/exercise-c1-e2e-final.log`。

## 数据与发布门禁

- 新增Drizzle `0024_training_batch_records.sql`：原有training_sessions增加recorded_time、record_write、deleted_at，原有training_session_revisions增加record_snapshot；4个可空字段，无新表、回填或角色变更。隔离测试账本应25项；当前生产仍24项。
- 新真实PG第22项：`atomically creates edits and deletes batch training records with retry rollback and RLS protection`，覆盖并发首存／编辑、末尾父记录失败回滚、修订、精度、重排、RLS及导出、软删除与旧接口不可恢复。尚未执行，不以142项内存/API测试冒充PG结果。
- 已向用户请求本批私有备份／专用_test恢复验证及清理／仅0024生产迁移／API与Worker受限切换；当前未收到本批批准，不执行这些生产步骤。
- 基线：生产ded36d4，ledger24|1788874421379，PG容器890633238a9698dbbd43381f1af2d9e47e3efe3196ac1e7c692bcc3ec0009755保持。旧备份、旧镜像、SSH保存main41d472d8及未跟踪发布文档须保留。
- 代码经本地push后由114fetch固定SHA并git archive到独立源码目录；不修改远端分叉main，不建worktree，不传bundle。

## 远端任务

上一项B2c发布任务01a08414-c27a-7781-8792-8deea6681a70的最终正文于本轮重新直接读取，确认completed/idle且正文完整；已有完整产物留证。新建本批远端任务前归档它，之后持续有界等待最终正文。
