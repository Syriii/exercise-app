# Exercise App

一个面向训练与饮食记录的开源健身辅助应用。项目先以响应式 Web App 验证真实使用体验，成熟后再封装为 Android APK。

当前仓库采用单仓库、多应用结构；Vue Web、Fastify 服务端、PostgreSQL migration、pg-boss worker、账号会话和 Compose 部署定义已经完成。训练计划与实际记录、证据化训练建议和消耗估算、官方营养规划、独立饮食安排、手工与图片估餐、暂定值核对、历史趋势、三类提醒、账号导出/删除及朋友版安全边界均已有可运行实现，并已通过本地自动化验收。首台 OpenCloudOS 9 服务器的 Compose 首次启动、真实 migration/RLS、API/Worker 健康、非破坏性 smoke 和外部 `IP:5011` 访问已经通过；DeepSeek 真实请求、容器重建持久化、队列故障恢复和备份恢复仍待专项验收。大型公共食物目录等待合法数据源，Android 在 Web 版获得实际使用确认后实现。

## 已确认的两个功能域

- 训练：训练指导、训练量记录与历史进度。
- 饮食：饮食记录、营养结构与每日目标。

## 本地运行

```bash
npm install
npm run dev:web
npm run dev:server
npm run dev:worker
```

## 验证

```bash
npm run check
npm run test
npm run build
npm run audit:prod
npm run api:contract
npm run test:e2e
```

`npm test` 运行不依赖数据库的单元与 API 契约测试。浏览器测试会构建应用并启动只使用内存账号的专用本地服务，不连接生产数据库。真实 PostgreSQL 集成测试必须显式提供名称以 `_test` 结尾的独立数据库：

```bash
TEST_DATABASE_URL=postgresql://exercise:密码@127.0.0.1:5432/exercise_test npm run test:integration
```

集成测试会执行 Drizzle 与 pg-boss migration，不能指向个人使用库或生产库。

在已经启动 Compose 的目标服务器上，可以运行增量 0 的非破坏性烟雾检查：

```bash
deployment/scripts/verify-increment0.sh smoke
```

包含测试数据库、备份恢复和 PostgreSQL 容器重建的完整验收具有短暂服务影响，需要显式允许：

```bash
ALLOW_CONTAINER_RECREATE_TEST=true deployment/scripts/verify-increment0.sh full
```

第一次部署可以直接跟随[快速部署教程](docs/deployment/quick-start.md)，启动容器前先运行其中的无副作用预检；持久化、安全、备份恢复、升级和完整验收见[自托管手册](docs/deployment/self-hosting.md)。

运行中遇到页面问题时，可以在“设置 → 问题报告”生成可复制、可下载的脱敏文本。容器启动、数据库或后台任务异常时，在 `deployment/` 目录执行：

```bash
./scripts/collect-diagnostics.sh
```

报告只在本机生成，不会自动上传；分享前仍需检查容器日志中的 IP、请求路径和错误上下文。

## 项目如何推进

项目按“规划重置 → 产品全貌 → 领域规则 → 体验设计 → 技术与版本规划 → Web 实现 → 使用与扩展”推进。先完整理解产品，再决定实现顺序。

- 协作与讨论规范：[`AGENTS.md`](AGENTS.md)
- 完整路线与阶段状态：[`.planning/exercise-app/task_plan.md`](.planning/exercise-app/task_plan.md)
- 当前产品全貌：[`docs/product.md`](docs/product.md)
- 已确认的领域规则：[`docs/domain/domain-rules.md`](docs/domain/domain-rules.md)
- 训练与营养规划官方证据登记：[`docs/domain/calculation-evidence.md`](docs/domain/calculation-evidence.md)
- 当前体验设计与原型范围：[`docs/experience/experience-design.md`](docs/experience/experience-design.md)
- 仓库架构与文件放置：[`docs/architecture/repository-layout.md`](docs/architecture/repository-layout.md)
- 当前技术架构：[`docs/architecture/technical-architecture.md`](docs/architecture/technical-architecture.md)
- 当前分阶段交付方案：[`docs/architecture/delivery-plan.md`](docs/architecture/delivery-plan.md)
- 账号隔离与数据访问：[`docs/security/data-access.md`](docs/security/data-access.md)
- 快速部署：[`docs/deployment/quick-start.md`](docs/deployment/quick-start.md)
- 自托管与部署：[`docs/deployment/self-hosting.md`](docs/deployment/self-hosting.md)
- 隐私说明模板：[`PRIVACY.md`](PRIVACY.md)
- 安全策略：[`SECURITY.md`](SECURITY.md)
- 贡献指南：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 历史研究、风险与待验证材料：[`.planning/exercise-app/findings.md`](.planning/exercise-app/findings.md)
- 工作记录与测试结果：[`.planning/exercise-app/progress.md`](.planning/exercise-app/progress.md)
- 重要且经过权衡的决定：[`docs/product-decisions.md`](docs/product-decisions.md)
- 重置前产品旧稿：[`docs/archive/product-brief-v0.1.md`](docs/archive/product-brief-v0.1.md)

## 仓库结构

- `apps/web/`：当前可以独立构建和运行的 Web 应用及其专属配置。
- `apps/server/`：Fastify API、数据库 schema/migration、身份模块和 pg-boss worker。
- `apps/android/`：未来 Android 工程的固定位置，Web 满意且 Android 迁移验证开始时创建。
- `packages/`：确有跨应用复用代码后创建。
- `deployment/`：Dockerfile、Compose 与可提交的配置示例；真实 secret 和运行数据不进入仓库。
- `docs/`：长期有效的产品和设计文档；旧稿统一进入 `docs/archive/`。
- `.planning/exercise-app/`：Codex 使用的计划、研究和进度记录，不作为产品事实源。
- 根目录：项目入口、全仓库规则、许可和跨应用编排配置。

尚未产生内容的目录不会提前创建。临时餐食照片、个人记录、数据库、备份和访问凭证属于私有运行数据，不进入本仓库；确认后的餐食原图按产品规则删除，APK 和 AAB 作为发布产物也不直接提交到 Git。

## License

[MIT](LICENSE)
