# Exercise App 自托管与部署

| 项目 | 内容 |
|---|---|
| 状态 | Increment 0 部署基线；等待真实 Docker 主机验收 |
| 最后更新 | 2026-08-25 |
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
cp secrets/session_secret.example secrets/session_secret
cp secrets/admin_initial_password.example secrets/admin_initial_password
chmod 600 .env secrets/database_password secrets/session_secret secrets/admin_initial_password
```

必须替换三个文件的内容：

- `database_password`：PostgreSQL 账号密码；应用和 PostgreSQL 读取同一文件，避免两份密码不一致。
- `session_secret`：至少 32 个随机字符，用于计算不可逆的会话 token 摘要；不得与数据库密码相同。
- `admin_initial_password`：`admin` 的首次登录密码，至少 12 个字符；数据库只保存 Argon2id 哈希。

可以用系统密码管理器或密码生成器创建随机值。不要把真实 secret 粘贴进 `.env`、Compose 文件、Issue 或 Git 提交。

`.env` 中最常调整的是：

- `APP_PORT`：服务器对外端口，例如 `3000`；访问地址为 `http://服务器IP:APP_PORT`。
- `COOKIE_SECURE=false`：只适用于受信局域网或 VPN 内的纯 HTTP。公共互联网必须先配置 HTTPS，再改为 `true`。
- `POSTGRES_DB` 和 `POSTGRES_USER`：首次初始化后不要随意改变；它们与已有 volume 中的数据库身份有关。

### 2.3 检查并启动

先让 Compose 展开并检查配置，再构建和启动：

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs setup
docker compose logs --tail=100 api worker postgres
```

`setup` 应以状态码 0 退出，日志应说明数据库、队列 migration 完成并且 `admin` 已就绪。随后检查：

```bash
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/v1/health/live
curl --fail http://127.0.0.1:${APP_PORT:-3000}/api/v1/health/ready
```

在手机浏览器打开 `http://服务器IP:端口`，用用户名 `admin` 和 `admin_initial_password` 中的值登录。系统会要求立即修改初始密码；修改完成后，旧会话会全部失效。之后可以在“设置 → 账号管理”控制普通注册和账号状态。

## 3. 网络边界

Compose 只映射 `api` 端口；PostgreSQL 和 worker 没有宿主机端口。服务器防火墙也只需允许实际使用的 Web 端口和 SSH 管理端口。

- 同一局域网或受信 VPN：可以使用 `IP + 端口` 和 HTTP，保持 `COOKIE_SECURE=false`。
- 公共互联网：必须先增加受信证书的 HTTPS 入口，再设置 `COOKIE_SECURE=true`。密码、照片和健康相关记录不应通过公网明文传输。
- 如果后续使用反向代理，只代理 `api:3000`，不要暴露 PostgreSQL、worker、临时媒体 volume 或 Docker socket。

## 4. 数据与重启

```text
postgres_data  -> 长期数据库数据，必须备份
temporary_media -> 尚在分析或复核期的照片，不做长期备份
代码与镜像       -> 可从 Git 和 Dockerfile 重建
secret 文件      -> 不进 Git，由部署者独立安全保存
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

创建逻辑备份：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-exercise}" -d "${POSTGRES_DB:-exercise}" --format=custom > "backups/exercise-$(date +%Y%m%d-%H%M%S).dump"
```

备份文件包含个人训练、饮食、账号和会话等私有数据，应加密并保存在服务器之外。临时照片 volume 默认不进入长期备份；已确认的结构化营养结果仍在数据库备份中。

不要第一次就覆盖生产数据库来测试恢复。先恢复到独立校验库：

```bash
docker compose exec postgres createdb -U "${POSTGRES_USER:-exercise}" exercise_restore_check
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-exercise}" -d exercise_restore_check --clean --if-exists < backups/要验证的文件.dump
docker compose exec postgres psql -U "${POSTGRES_USER:-exercise}" -d exercise_restore_check -c "select count(*) from users;"
```

确认可读后，独立校验库可以在人工核对目标名称后删除。真实灾难恢复应先停止 API 和 worker、保留损坏库副本、记录当前版本，再把已验证备份恢复到新数据库；不要在没有备份的情况下直接清空生产库。

官方参考：[pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)。

## 6. 更新应用

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

## 7. 故障定位

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

## 8. 尚待真实服务器验收

当前开发机没有 Docker 与 PostgreSQL，因此以下项目不能在本机伪报为已通过：

- Compose 构建、启动顺序和健康检查；
- PostgreSQL volume 在容器重建后的持久化；
- Drizzle 与 pg-boss migration 的真实数据库执行；
- 事务提交/回滚、SIGKILL、数据库断线和任务恢复；
- `pg_dump` / `pg_restore` 备份恢复演练；
- 目标服务器端口、防火墙、磁盘、内存和 CPU 参数。

首次取得目标服务器环境后，应按本节清单逐项记录实际结果，再把部署状态从“基线”改为“已验收”。
