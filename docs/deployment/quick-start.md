# Exercise App 快速部署

这份教程只解决一件事：在一台已有公网或局域网 IP 的 Linux 服务器上，把 Exercise App 启动起来，并能用手机通过 `IP + 端口` 访问。完整的安全边界、DeepSeek、备份恢复、升级和故障说明见[完整自托管手册](self-hosting.md)。

> 如果服务器还承载其他项目，先阅读完整手册中的“共享服务器的硬性停止条件”。Docker 安装、启动和镜像构建并非零影响操作；本页代码块只是操作说明，不构成整段执行授权。每条改变服务器状态的命令都要先说明后果、风险、验证和回退方式，获得产品所有者对准确命令的明确批准后才能单独执行。

## 1. 准备服务器

服务器需要：

- Docker Engine 与 Docker Compose 插件；
- Git；
- 至少一个允许手机访问的 TCP 端口，默认使用 `3000`。

按 Docker 官方对应发行版教程安装，不使用来源不明的一键脚本：[安装 Docker Engine](https://docs.docker.com/engine/install/)。安装后确认：

```bash
docker version
docker compose version
git --version
```

## 2. 下载项目

```bash
git clone https://github.com/Syriii/exercise-app.git
cd exercise-app/deployment
```

## 3. 创建本机配置

复制可以公开的示例文件：

```bash
cp .env.example .env
cp secrets/database_password.example secrets/database_password
cp secrets/api_database_password.example secrets/api_database_password
cp secrets/session_secret.example secrets/session_secret
cp secrets/admin_initial_password.example secrets/admin_initial_password
chmod 600 .env secrets/database_password secrets/api_database_password secrets/session_secret secrets/admin_initial_password
```

如果服务器有 `openssl`，可以直接生成三个随机内部 secret；管理员首次密码则在终端中隐藏输入：

```bash
umask 077
openssl rand -hex 32 | tr -d '\n' > secrets/database_password
openssl rand -hex 32 | tr -d '\n' > secrets/api_database_password
openssl rand -hex 32 | tr -d '\n' > secrets/session_secret
read -rsp '请输入 admin 首次登录密码（至少 8 位）: ' EXERCISE_ADMIN_PASSWORD
printf '%s' "$EXERCISE_ADMIN_PASSWORD" > secrets/admin_initial_password
unset EXERCISE_ADMIN_PASSWORD
printf '\n密码已保存。\n'
```

三个随机值必须彼此不同。`admin` 密码在首次登录后会要求修改，数据库只保存 Argon2id 摘要，不保存明文。

这些文件应继续保持当前部署用户私有的 `0600`，不要为了让容器读取而改成 `0644`。应用镜像会在容器内存文件系统中准备仅供非 root `node` 进程读取的临时副本，容器停止后随之消失。

打开 `.env`，至少确认：

```dotenv
APP_PORT=3000
COOKIE_SECURE=false
```

`COOKIE_SECURE=false` 只适用于局域网或受信 VPN 中的 HTTP 测试。如果这个端口直接暴露在公共互联网，先按完整手册配置 HTTPS，再改为 `true`；不要通过公网明文发送密码、照片和健康记录。

默认从 Docker Hub 获取固定版本的 Node 与 PostgreSQL 镜像，并从 Debian 官方软件源安装构建依赖。如果服务器位于腾讯云且访问这些上游不稳定，可以只为本项目修改 `.env`：

```dotenv
NODE_BASE_IMAGE=mirror.ccs.tencentyun.com/library/node:24.19.0-bookworm-slim
POSTGRES_IMAGE=mirror.ccs.tencentyun.com/library/postgres:18.6-bookworm
DEBIAN_MIRROR=http://mirrors.tencentyun.com/debian
```

`mirrors.tencentyun.com` 是腾讯云内网软件源，只适用于能够访问该内网地址的腾讯云服务器。这里使用 HTTP 是为了让尚未安装 CA 证书的 slim 基础镜像完成首次 APT 安装；APT 仍会按 Debian `apt-secure` 规则验证签名的 Release 元数据，不得增加 `trusted=yes`、`allow-insecure` 或其他关闭认证的选项。

这些变量只影响本项目的镜像与镜像内部的软件包下载，不修改宿主机软件源或 Docker daemon，也不需要重启 Docker。镜像代理可能限流或缓存旧标签，使用前应先检查 manifest；长期生产部署更适合把固定镜像同步到自己控制的容器仓库。恢复默认值时删除这些覆盖项，或改回 `.env.example` 中的值。

## 4. 构建并启动

先执行无副作用的部署预检：

```bash
./scripts/preflight.sh
```

它会检查 Docker、Compose、Git、端口、配置与 secret 文件权限，拒绝未替换的公开示例值、过短或重复的 secret，并确认真实配置不会进入 Git；不会启动容器、修改数据库或打印任何 secret。预检通过后再启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs setup
```

`setup` 最终应显示成功并退出，`postgres`、`api`、`worker` 应保持运行。执行自带的非破坏性检查：

```bash
./scripts/verify-increment0.sh smoke
```

检查通过后，在服务器本机也可以确认：

```bash
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

## 5. 用手机访问

在手机浏览器打开：

```text
http://服务器IP:3000
```

如果改过 `APP_PORT`，把 `3000` 换成实际端口。登录用户名固定为 `admin`，密码是刚才写入 `secrets/admin_initial_password` 的值。首次登录后立即按页面要求修改密码。

页面打不开时，先检查云服务器安全组和系统防火墙是否允许实际的 `APP_PORT`；不要开放 PostgreSQL 端口，Compose 默认也没有把它映射到宿主机。

## 6. 启用拍照估餐（可选）

不配置 DeepSeek 时，训练、手工记餐和其他功能仍可使用。需要自动分析照片时：

```bash
cp secrets/deepseek_api_key.example secrets/deepseek_api_key
chmod 600 secrets/deepseek_api_key
```

把真实 Key 写入该文件，然后使用两个 Compose 文件启动：

```bash
./scripts/preflight.sh
docker compose -f compose.yaml -f compose.deepseek.yaml up -d --build
docker compose -f compose.yaml -f compose.deepseek.yaml logs --tail=100 worker
```

之后查看日志、停止、更新或重建时都要带上相同的两个 `-f` 参数。Key 不要写进 `.env`、聊天、Issue 或 Git。

## 7. 遇到问题时生成报告

页面还能打开时，进入“设置 → 问题报告”，填写刚才做了什么，点击“生成问题报告”。你可以检查后直接复制到问答中，或下载 `.txt` 文件。

如果应用无法启动或后台任务异常，在 `deployment/` 目录执行：

```bash
./scripts/collect-diagnostics.sh
```

脚本会在 `deployment/diagnostics/` 生成一个权限为 `600` 的 `.log` 文件，包含 Compose 状态、健康检查和四个服务最近 200 行日志。它不会读取 `.env`、secret、数据库记录、照片或导出内容；但容器日志仍可能出现 IP、请求路径、ID 或错误上下文，发到问答前先快速检查。

常用的人工检查命令：

```bash
docker compose ps
docker compose logs --tail=200 setup api worker postgres
```

不要把整个 `deployment/secrets/`、`.env`、数据库备份或照片目录发到问答中。

## 8. 接下来必须做的事

快速启动成功不等于长期运行已经安全。开始积累真实训练和饮食记录前，继续按[完整自托管手册](self-hosting.md)完成：

- 数据库备份和隔离恢复验证；
- 公网 HTTPS 或受信 VPN；
- 更新前备份、升级后健康检查；
- DeepSeek 真实请求、失败重试和临时照片删除验收。
