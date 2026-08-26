# 账号隔离与数据访问

| 项目 | 当前规则 |
|---|---|
| 适用版本 | 朋友与开源版安全基线 |
| API 数据库角色 | `exercise_api`，非 owner、无 `BYPASSRLS` |
| 数据库 owner | 只供 setup、migration、可信 worker 和备份使用 |
| 用户上下文 | 认证成功后在单个数据库事务内设置 `exercise.user_id` |
| 管理员能力 | 管理账号与聚合运行状态，不读取其他账号健康记录 |

## 1. 两层隔离

第一层是应用服务：每个训练、规划、饮食、提醒、图片和导出操作都从 HttpOnly 会话取得当前账号，仓储查询继续显式带 `user_id` 或先验证父记录归属。

第二层是 PostgreSQL RLS：API 容器只能使用 `exercise_api`，32 张账号拥有表按当前事务中的 `exercise.user_id` 过滤。没有账号上下文时默认看不到这些表的任何行；向其他账号写入会被 PostgreSQL 拒绝。上下文使用事务本地 `set_config(..., true)`，连接归还池后不会把账号带到下一个请求。

PostgreSQL 表 owner 默认可绕过 RLS，因此 API 容器不挂载 owner 密码。setup 和 worker 是可信内部进程：setup 负责 migration、角色和授权，worker 需要跨账号领取后台任务，但任务处理仍使用任务保存的账号归属和幂等状态机。

官方依据：[PostgreSQL Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)、[PostgreSQL `set_config`](https://www.postgresql.org/docs/18/functions-admin.html)、[Drizzle RLS](https://orm.drizzle.team/docs/rls)。

## 2. 表访问矩阵

| 分类 | 表 | 数据库规则 |
|---|---|---|
| 直接账号归属 | 训练建议/方案/周期/安排/记录，三类提醒，档案/策略/测量/每日参考，餐食/全天状态/常用项，图片分析 | 表内 `user_id` 必须等于当前账号 |
| 继承账号归属 | 方案动作、周期单元/动作、实际动作/组/修订、测量修订、餐食/营养贡献修订、图片分析尝试 | 必须能沿父记录找到当前账号 |
| 身份内部 | `users`、`credentials`、`sessions`、`app_settings`、`audit_events` | 登录前或管理员边界使用；凭据仅 Argon2id，会话仅不可逆摘要；无健康记录读取接口 |
| 后台内部 | `background_tasks`、`background_task_attempts`、`temporary_media` | API 查询显式带账号，worker 跨账号处理；对象键和任务载荷不向其他用户或管理员展示 |
| 运维内部 | `runtime_heartbeats`、`maintenance_events` | 只保存服务心跳和备份/恢复结果，不保存健康记录 |

完整机器可检查清单位于 `apps/server/src/security/data-access-policy.ts`。测试会把它与当前 41 张 schema 表和全部 RLS migration 对比；任何新增表都必须明确进入 RLS 或写出内部豁免理由。

## 3. 自动化验证

- 路由/服务测试覆盖训练、档案测量、餐食及修订、图片分析、三类提醒、导出列表和下载的跨账号拒绝。
- PostgreSQL integration 以 `exercise_api` 角色验证：无上下文看不到记录；账号 A 只看到 A 的根表和子表；修改或插入 B 的数据被过滤或拒绝。
- 部署烟雾检查确认 API 角色没有 superuser/建库/建角色/`BYPASSRLS`，32 张表已启用 RLS，API 容器拿不到 owner secret。

本地没有 PostgreSQL 时，上述 integration 只能保持“已编译、待服务器执行”，不得用内存测试冒充数据库策略已运行。

## 4. 运维者边界

自托管服务器的操作系统管理员和数据库 owner 在技术上可以访问数据库、备份和临时媒体。产品内的“管理员账号不能读取朋友健康记录”不能约束拥有主机 root 或数据库 owner 权限的人。因此部署者必须：

- 只邀请理解并接受该信任边界的人；
- 限制 SSH、Docker 和备份存储权限；
- 不把数据库、照片、日志、导出或备份用于其他目的；
- 在开放注册前提供隐私说明和第三方模型发送说明。
