# Exercise App

一个正在设计中的开源健身辅助应用。项目先以响应式 Web App 验证训练与饮食体验，成熟后再封装为 Android APK。

当前仓库采用单仓库、多应用结构；Vue Web、Fastify 服务端、PostgreSQL migration、pg-boss worker、账号会话和 Compose 部署骨架已经进入 Phase 5 增量 0。训练算法、营养数据库、图片分析和 Android 仍按后续增量实现。

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
```

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
- 自托管与部署：[`docs/deployment/self-hosting.md`](docs/deployment/self-hosting.md)
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
