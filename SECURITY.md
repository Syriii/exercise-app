# Security Policy

## Supported version

Security fixes target the current `main` branch until the project begins tagged releases. Historical commits and unofficial deployments are not independently supported.

## Reporting a vulnerability

请优先使用 GitHub 仓库的 Private vulnerability reporting / Security Advisory。不要在公开 Issue 中粘贴可利用细节、真实账号、Cookie、API Key、照片、数据库内容或备份。

报告应包含受影响版本或提交、部署方式、最小复现步骤、实际与预期结果，以及已去除私人内容的日志。维护者确认前不要访问不属于你的账号或扩大验证范围。

普通产品缺陷可以使用公开 Issue，但必须使用假数据。若部署者怀疑 secret、Cookie 或数据库 owner 密码泄露，应立即停止公网访问、轮换相关 secret、撤销会话并检查审计与容器日志。

## Security baseline

- 密码只以 Argon2id 保存；会话 Cookie 为 HttpOnly、SameSite=Strict。
- API 和数据库 owner 使用不同 secret；API 角色受 PostgreSQL RLS 约束。
- PostgreSQL、worker、临时媒体和 Docker socket 不对公网暴露。
- 公网使用必须配置 HTTPS 和 `COOKIE_SECURE=true`。
- 照片、数据库、日志、导出、备份和真实 secret 不进入 Git。

更多边界见 [账号隔离与数据访问](docs/security/data-access.md) 和 [自托管文档](docs/deployment/self-hosting.md)。
