# Exercise App 自托管与部署

| 项目 | 内容 |
|---|---|
| 状态 | Web 长期运行部署基线；等待真实 Docker 主机验收 |
| 最后更新 | 2026-08-26 |
| 适用范围 | 单台长期运行服务器、Docker Compose、IP + 端口访问 |

## 1. 部署后会运行什么

宿主机只需要安装 Docker Engine、Docker Compose 插件和 Git。应用依赖全部进入容器，不需要在服务器单独安装 Node.js、PostgreSQL、Drizzle 或 pg-boss。

Compose 启动四个服务：

| 服务 | 作用 | 是否对外开放端口 |
|---|---|---|
| `postgres` | 业务数据、账号会话和 pg-boss 数据 | 否 |
| `setup` | 一次性执行业务 migration、队列 migration 和管理员初始化 | 否；成功后退出 |
| `api` | Fastify API 和 Vue 静态文件 | 是，默认 `3000` |
| `worker` | 后台任务执行进程 | 否 |

PostgreSQL 使用独立 named volume；容器重启、重新创建或代码更新不会自动删除数据库。只有显式执行 `docker compose down --volumes` 等删除 volume 的命令才会移除数据，因此日常停止只使用 `docker compose stop` 或 `docker compose down`，不要附加 `--volumes`。

官方参考：[Docker Engine 安装](https://docs.docker.com/engine/install/)、[Docker Compose](https://docs.docker.com/compose/)、[Docker volumes](https://docs.docker.com/engine/storage/volumes/)、[Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)。

## 2. 首次部署

### 2.1 安装并取得代码

按服务器 Linux 发行版使用 Docker 官方安装说明安装 Engine 与 Compose 插件，然后确认：

```bash
docker version
docker compose version
git --version
```

取得仓库并进入部署目录：

```bash
git clone https://github.com/Syriii/exercise-app.git
cd exercise-app/deployment
```

### 2.2 建立本机配置与 secret

示例文件可以提交，真实值已被 Git 忽略：

```bash
cp .env.example .env
cp secrets/database_password.example secrets/database_password
cp secrets/api_database_password.example secrets/api_database_password
cp secrets/session_secret.example secrets/session_secret
cp secrets/admin_initial_password.example secrets/admin_initial_password
chmod 600 .env secrets/database_password secrets/api_database_password secrets/session_secret secrets/admin_initial_password
```

必须替换四个文件的内容：

- `database_password`：PostgreSQL owner 密码，只供 PostgreSQL、setup、可信 worker 和备份使用。
- `api_database_password`：受限角色 `exercise_api` 的密码，只供 API 使用；不得与 owner 密码相同。
- `session_secret`：至少 32 个随机字符，用于计算不可逆的会话 token 摘要；不得与数据库密码相同。
- `admin_initial_password`：`admin` 的首次登录密码，至少 12 个字符；数据库只保存 Argon2id 哈希。
- `deepseek_api_key`：仅在启用拍照估餐时使用，由 API 和 worker 以只读 Compose secret 读取；不启用时可以不创建该文件。

可以用系统密码管理器或密码生成器创建随机值。不要把真实 secret 粘贴进 `.env`、Compose 文件、Issue 或 Git 提交。

`.env` 中最常调整的是：

- `APP_PORT`：服务器对外端口，例如 `3000`；访问地址为 `http://服务器IP:APP_PORT`。
- `COOKIE_SECURE=false`：只适用于受信局域网或 VPN 内的纯 HTTP。公共互联网必须先配置 HTTPS，再改为 `true`。
- `POSTGRES_DB` 和 `POSTGRES_USER`：首次初始化后不要随意改变；它们与已有 volume 中的数据库身份有关。
- `WORKER_HEARTBEAT_INTERVAL_SECONDS`：worker 写入 PostgreSQL 存活信号的间隔，默认 15 秒。
- `WORKER_HEARTBEAT_STALE_SECONDS`：管理页判定 worker 心跳过期的时间，默认 45 秒，必须大于写入间隔。
- `DEEPSEEK_VISION_MODEL`：默认使用官方视觉指南当前列出的 `deepseek-v4-flash-vision-exp`；该模型带实验标记，因此部署时保留为可配置项。
- `IMAGE_UPLOAD_MAX_BYTES`：应用接收单张照片的上限，默认 8 MiB，低于供应商文档的 32 MiB 单图限制，避免手机原图占用过多内存和临时磁盘。
- `EXPORT_MAX_BYTES` 与 `EXPORT_RETENTION_HOURS`：账号 JSON 导出的大小上限与下载保留时间；默认 64 MiB、7 天。导出不包含密码、会话令牌或原始照片。
- `MEDIA_CLEANUP_INTERVAL_SECONDS`：worker 清理过期导出和临时照片的间隔，默认 1 小时。
- `MAX_ACCOUNTS`：普通账号与管理员账号的总上限，默认 10；并发注册也不能突破该上限。
- `AUTH_RATE_LIMIT_*`、`WRITE_RATE_LIMIT_*`、`IMAGE_RATE_LIMIT_*`：单个 API 进程按来源 IP 限制登录注册、写操作与图片提交频率。默认值面向不超过 10 人的单机部署；多个 API 副本需要改用共享限流存储。
- `MAX_ACTIVE_IMAGE_ANALYSES_PER_ACCOUNT`：单个账号同时等待或处理中的图片分析上限，默认 3。
- `TEMP_MEDIA_MAX_BYTES_PER_ACCOUNT`：单个账号可占用的临时照片与导出空间上限，默认 256 MiB；采用结果或到期清理后释放。
- `BACKUP_DIRECTORY` 与 `BACKUP_RETENTION_DAYS`：宿主机数据库备份目录与本机保留天数；默认 `deployment/backups/`、14 天。
- `BACKUP_MIRROR_DIRECTORY`：可选的已存在目录。设置后，每次成功备份会把备份和 SHA-256 清单再复制一份；它应位于异地挂载或受保护的备份存储，而不是同一块磁盘的另一个目录。

### 2.3 检查并启动

先运行无副作用的部署预检。它会验证主机工具、端口、配置和 secret 文件权限，拒绝公开示例值、过短或重复的 secret，确认真实配置已被 Git 忽略，并让 Compose 展开配置；不会启动容器、修改数据库或打印 secret：

```bash
./scripts/preflight.sh
```

预检通过后再构建和启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs setup
docker compose logs --tail=100 api worker postgres
```

上面的基础命令不会挂载 DeepSeek Key，训练和手工饮食照常可用，拍照入口会明确提示“尚未配置”。启用拍照估餐时，确认 `secrets/deepseek_api_key` 已写入真实 Key，然后在所有 Compose 命令中同时加入覆盖文件：

```bash
cp secrets/deepseek_api_key.example secrets/deepseek_api_key
chmod 600 secrets/deepseek_api_key
# 编辑该文件，替换示例内容后再启动
./scripts/preflight.sh
docker compose -f compose.yaml -f compose.deepseek.yaml up -d --build
docker compose -f compose.yaml -f compose.deepseek.yaml logs --tail=100 api worker
```

后续更新、停止、查看日志也要使用相同的两个 `-f` 参数，否则重建后的容器不会挂载 Key。模型请求由 worker 直接把私有照片编码为 `data:image/...;base64` 发送给 DeepSeek；照片不需要公开 URL，也不使用远端 Files API。没有现有营养值时，结构化候选会先作为“暂定值”计入当天剩余量，用户随后核对或修正；已有手工或确认值时只保留候选，不自动覆盖。确认采用后默认删除本机临时原图。

`setup` 应以状态码 0 退出，日志应说明数据库、队列 migration 完成并且 `admin` 已就绪。随后检查：

```bash
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/v1/health/live
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/v1/health/ready
```

仓库还提供非破坏性烟雾检查。它会读取 Compose 实际映射的 API 端口，并检查迁移、Argon2id 约束、worker 心跳、私有端口和临时媒体卷写入；写入探针会在同一步骤立即删除：

```bash
./scripts/verify-increment0.sh smoke
```

在手机浏览器打开 `http://服务器IP:端口`，用用户名 `admin` 和 `admin_initial_password` 中的值登录。系统会要求立即修改初始密码；修改完成后，旧会话会全部失效。之后可以在“设置 → 账号管理”控制普通注册和账号状态，并查看 API、PostgreSQL 与 worker 的分项运行状态。worker 显示“尚未确认”或“心跳过期”时不能视为健康，应结合容器日志排查。

`setup` 会创建或轮换受限数据库角色 `exercise_api`，并为账号私有表启用 PostgreSQL RLS。API 容器只能读取 `api_database_password`，不能读取 owner 密码；worker 与 setup 属于可信内部进程。烟雾检查会验证角色权限、RLS 表数量和 secret 挂载边界。完整说明见 [账号隔离与数据访问](../security/data-access.md)。

## 3. 网络边界

Compose 只映射 `api` 端口；PostgreSQL 和 worker 没有宿主机端口。服务器防火墙也只需允许实际使用的 Web 端口和 SSH 管理端口。

- 同一局域网或受信 VPN：可以使用 `IP + 端口` 和 HTTP，保持 `COOKIE_SECURE=false`。
- 公共互联网：必须先增加受信证书的 HTTPS 入口，再设置 `COOKIE_SECURE=true`。密码、照片和健康相关记录不应通过公网明文传输。
- 如果后续使用反向代理，只代理 `api:3000`，不要暴露 PostgreSQL、worker、临时媒体 volume 或 Docker socket。
- 当前内存限流以 API 看到的来源 IP 为键。直接使用 `IP + 端口` 时行为明确；以后增加反向代理时，必须先限定可信代理地址再配置真实客户端 IP，不能无条件信任任意 `X-Forwarded-For`。

## 4. 数据与重启

```text
postgres_data   -> 长期数据库数据，必须备份
temporary_media -> 待分析照片和限时 JSON 导出，到期清理且不做长期备份
代码与镜像        -> 可从 Git 和 Dockerfile 重建
secret 文件       -> 不进 Git，由部署者独立安全保存
```

普通重启：

```bash
docker compose restart
```

停止并稍后恢复：

```bash
docker compose down
docker compose up -d
```

以上命令不会删除 named volume。不要把 `deployment/secrets/`、Docker volume 数据目录或数据库备份放入公开仓库。

## 5. 备份与恢复演练

推荐使用仓库脚本创建逻辑备份：

```bash
mkdir -p backups
./scripts/backup.sh
```

脚本先写入权限受限的 `.partial` 文件，确认非空后原子改名，并为每份备份生成 `.manifest.json`，记录创建时间、字节数、SHA-256 和“不含临时照片”。成功或失败会写入 `maintenance_events`，管理员页面只显示最近时间，不显示文件路径和个人数据。

备份文件包含个人训练、饮食、账号和会话等私有数据，应加密并保存在服务器之外。临时照片和限时下载文件所在的 `temporary_media` volume 不进入长期备份；已确认的结构化营养结果仍在数据库备份中。`BACKUP_MIRROR_DIRECTORY` 只是复制入口，部署者仍需保证目标存储的访问控制、加密和异地可靠性。

可以由宿主机定时任务调用，例如每天 03:20：

```cron
20 3 * * * cd /srv/exercise-app/deployment && ./scripts/backup.sh >> /var/log/exercise-app-backup.log 2>&1
```

这里的 `/srv/exercise-app` 和日志位置只是示例，应替换为实际绝对路径。先手工成功运行一次再加入定时任务；不要把密码或 Key 写进 crontab。

不要第一次就覆盖生产数据库来测试恢复。先恢复到独立校验库：

```bash
docker compose exec postgres createdb -U "${POSTGRES_USER:-exercise}" exercise_restore_check
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-exercise}" -d exercise_restore_check --clean --if-exists < backups/要验证的文件.dump
docker compose exec postgres psql -U "${POSTGRES_USER:-exercise}" -d exercise_restore_check -c "select count(*) from users;"
```

确认可读后，独立校验库可以在人工核对目标名称后删除。真实灾难恢复应先停止 API 和 worker、保留损坏库副本、记录当前版本，再把已验证备份恢复到新数据库；不要在没有备份的情况下直接清空生产库。

仓库提供等价的隔离恢复验证入口，并把结果登记到管理页：

```bash
./scripts/verify-restore.sh
```

这条命令创建固定安全前缀的临时校验库，验证后删除校验库和临时文件，不会覆盖业务库。它证明当前服务器能够导出和恢复，不等同于异机灾难恢复；正式运行仍应定期在另一台受控主机验证一份已复制的备份。

官方参考：[pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)。

### 5.1 自动化验收入口

以下命令都在 `deployment/` 目录执行：

```bash
./scripts/verify-increment0.sh database
./scripts/verify-increment0.sh backup
ALLOW_CONTAINER_RECREATE_TEST=true ./scripts/verify-increment0.sh persistence
```

- `database` 创建并重置 `${POSTGRES_DB}_test`，使用只在 verification 镜像目标中存在的 Vitest 执行 Drizzle、pg-boss 事务提交/回滚、worker 强杀恢复、Argon2id 和运行心跳集成测试，结束后删除该测试库。
- `backup` 把当前业务库临时导出到宿主机的 `mktemp` 私有目录，恢复到名称以 `exercise_restore_check_` 开头的隔离库，验证结构后同时删除临时库和临时备份。
- `persistence` 创建名称以 `exercise_volume_check_` 开头的探针库，强制重新创建 PostgreSQL 容器但不删除 volume，确认探针仍存在后清理。该步骤会造成短暂数据库中断，所以必须显式设置开关。

首次完整验收可以按固定顺序执行：

```bash
ALLOW_CONTAINER_RECREATE_TEST=true ./scripts/verify-increment0.sh full
```

`full` 会在容器重建后再次运行烟雾检查，确认 API 与 worker 已从短暂断线中恢复。所有测试数据库名称都有固定安全前缀或 `_test` 后缀；脚本不会对默认业务库执行删除，也不会运行 `docker compose down --volumes`。

## 6. 管理页运行摘要

预置管理员可以在“设置 → 系统管理”查看：

- API、PostgreSQL 和 worker 心跳；
- 当前视觉模型是否配置及非敏感模型 ID；
- 后台任务各状态数量；
- 临时媒体数量、过期未删除数量和媒体目录所在磁盘可用空间；
- 最近一次备份与隔离恢复验证的成功、失败时间。

该页面不读取其他用户的训练、饮食、照片或导出内容，也不显示 API Key、secret、对象键或备份路径。摘要只用于发现问题；出现失败任务、过期媒体或磁盘不足时，仍需结合容器日志和备份文件核对。

## 7. 更新应用

更新前先创建并验证数据库备份，然后：

```bash
git pull --ff-only
cd deployment
docker compose build --pull
docker compose run --rm setup
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/v1/health/ready
```

`setup` 是幂等入口：只执行仓库中尚未应用的 migration，并确认管理员存在。更改 `admin_initial_password` 不会修改已经初始化的管理员密码；管理员密码只能通过应用内改密或未来受控重置流程变更。

当前镜像锁定明确的 Node 24 与 PostgreSQL 18 minor 标签。升级 PostgreSQL 主版本前必须阅读官方镜像和 PostgreSQL 升级说明并完成独立恢复演练；不能只替换镜像标签。PostgreSQL 官方建议受支持主版本采用最新 minor：[版本策略](https://www.postgresql.org/support/versioning/)。

## 8. 故障定位

优先生成一份可保存、可检查的部署诊断报告：

```bash
./scripts/collect-diagnostics.sh
```

报告默认写入 `deployment/diagnostics/exercise-app-diagnostics-<UTC 时间>.log`，权限为 `600`，包含宿主机与 Compose 版本、磁盘概况、容器状态、公开健康检查以及 `setup`、`api`、`worker`、`postgres` 最近 200 行日志。可用 `DIAGNOSTIC_LOG_LINES=500` 调整日志行数。脚本不会读取 `.env`、secret、数据库表内容、照片、导出或 volume 文件；容器日志仍可能包含 IP、请求路径、ID 和错误上下文，因此分享前必须人工检查。

页面仍可访问时，也可以在“设置 → 问题报告”生成浏览器侧报告。它更适合定位具体页面、接口请求或浏览器错误；部署脚本更适合启动、数据库和 worker 问题。

```bash
docker compose ps
docker compose logs --tail=200 setup
docker compose logs --tail=200 api
docker compose logs --tail=200 worker
docker compose logs --tail=200 postgres
docker compose exec postgres pg_isready -U "${POSTGRES_USER:-exercise}" -d "${POSTGRES_DB:-exercise}"
```

- `setup` 失败：先修复 migration、secret 或数据库问题；不要绕过 setup 强行启动旧结构的 API。
- `/health/live` 正常但 `/health/ready` 失败：应用进程活着，但数据库不可用。
- 登录失败且刚轮换 `session_secret`：已有 Cookie 会整体失效，这是预期行为，重新登录即可。
- PostgreSQL volume 已存在但修改了初始化用户名、数据库名或密码：官方镜像不会重新初始化已有数据，应恢复原配置或执行受控数据库角色变更。
- worker 不健康或反复退出：检查 pg-boss migration 是否成功以及数据库连接；任务自有表仍是产品状态事实源，不能直接手改 pg-boss 内部表。
- 账号导出一直等待或失败：检查 worker 和任务摘要；不要从媒体 volume 手工把文件公开给用户。
- “过期未删”持续大于 0：检查 worker 的媒体清理日志和目录权限；不要直接删除数据库记录来隐藏告警。
- 备份或恢复验证显示失败：先保留失败日志和现有备份，确认数据库、磁盘和镜像版本；不要用一次新的成功记录覆盖调查过程。

## 9. 尚待真实服务器验收

当前开发机没有 Docker 与 PostgreSQL，因此以下项目不能在本机伪报为已通过：

- Compose 构建、启动顺序和健康检查；
- PostgreSQL volume 在容器重建后的持久化；
- Drizzle 与 pg-boss migration 的真实数据库执行；
- 事务提交/回滚、SIGKILL、数据库断线和任务恢复；
- `pg_dump` / `pg_restore` 备份恢复演练；
- 目标服务器端口、防火墙、磁盘、内存和 CPU 参数。

首次取得目标服务器环境后，应按本节清单逐项记录实际结果，再把部署状态从“基线”改为“已验收”。
