# AGENTS.md

本文件适用于整个 `exercise-app` 仓库。

## 1. 核心协作原则

- 产品所有者明确提出的目标和能力，记录为当前产品意图；Agent 可以说明风险和成本，但不得擅自降级、删除或要求反复证明。
- 先形成完整产品全貌，再讨论版本取舍、技术方案和验证指标。
- Agent 默认先整理并提出方案，用户负责整体纠正和选择；不得用连续小问题让用户从零设计产品。
- 可以不提问。只有真正阻塞当前产出时才提问。
- 验证产品是否有帮助，不考核用户，不把观察指标变成打卡或使用配额。

## 2. 当前有效文档

| 文件 | 作用 |
|---|---|
| `.planning/exercise-app/task_plan.md` | 唯一当前规划：阶段、当前产出和下一步 |
| `docs/product.md` | 已确认的唯一当前产品事实源 |
| `docs/domain/domain-rules.md` | 已确认的当前领域事实源：概念、状态、计算责任、修正与异常规则 |
| `docs/domain/calculation-evidence.md` | 训练与营养规划公式、阈值、适用范围、安全边界和产品推导的官方证据登记 |
| `docs/experience/experience-design.md` | Phase 3 当前体验结构、核心流程、状态覆盖与低保真原型边界 |
| `docs/architecture/technical-architecture.md` | 已确认的服务端、数据、任务、部署、安全与 Android 技术基线 |
| `docs/architecture/delivery-plan.md` | 已确认的可运行增量、范围和验收顺序 |
| `docs/product-decisions.md` | 只记录重要且经过权衡的决定 |
| `docs/architecture/repository-layout.md` | 当前仓库边界、目录职责与未来应用位置 |
| `docs/deployment/quick-start.md` | 首次自托管的最短操作路径 |
| `docs/deployment/self-hosting.md` | 当前单机 Docker Compose 部署、持久化、备份恢复和待验收清单 |
| `.planning/exercise-app/findings.md` | 研究、风险和待验证材料，不作为产品事实源 |
| `.planning/exercise-app/progress.md` | 阶段、文件和测试历史，不作为当前任务来源 |
| `README.md` | 项目入口 |

`docs/archive/product-brief-v0.1.md` 是规划重置前的旧稿，只能作为重建 `docs/product.md` 的输入。

发生冲突时，以产品所有者最新的明确表述为准，并在当前主题结束时清理冲突。

## 3. 恢复工作

提出产品问题或开始实现前：

1. 阅读本文件。
2. 阅读 `.planning/exercise-app/task_plan.md` 的当前阶段。
3. 如果 `docs/product.md` 已存在，阅读它。
4. 涉及体验设计时，阅读 `docs/experience/experience-design.md` 与 `docs/domain/domain-rules.md`；涉及训练或营养规划数值、公式或来源时，同时阅读 `docs/domain/calculation-evidence.md`。
5. 涉及代码、工程配置、目录或部署时，阅读 `docs/architecture/repository-layout.md`；涉及服务端、数据、模型、部署或版本顺序时，同时阅读 Phase 4 的两份架构草案。
6. 仅按当前任务需要读取决策、发现和历史记录。

不得把历史中的“下一步”当成当前任务。

## 4. 提问门槛

提问前必须同时满足：

1. 当前有效文档没有答案；
2. 答案会改变正在制作的具体产出；
3. 不回答就无法继续；
4. 用户是最合适的信息来源；
5. 无法采用安全、可逆、易修改的默认方案。

任一条件不满足，就不提问；应直接整理、提出方案或把问题放回后续阶段。

必须提问时，先说明已经知道什么、缺少什么以及它影响什么。一个主题可以整体讨论，不机械限制为每轮一个孤立问题。

## 5. 讨论与更新

每个主题采用：

1. 展示已确认内容；
2. 展示缺失或冲突；
3. 提交完整草案或方案；
4. 用户整体纠正；
5. 主题确认后一次更新相关文档。

不要逐句对话同步到多份文件。不要为了推进对话而强制以问题结尾。

用户作出重要纠正、进入下一阶段、开始业务代码或准备发布前，执行一致性审计：

- 产品当前事实是否只有一个来源；
- 已回答的问题是否仍被列为未知；
- 用户要求是否被错误降级为假设；
- 验证信号是否被写成用户约束；
- 当前下一步是否真正阻塞产出。

## 6. 仓库架构与文件放置

- 本项目采用单仓库、多应用结构。当前 Web 应用位于 `apps/web/`。
- 当前 Web 工程基线为 Vue 3 + TypeScript + Vite；React 骨架已被替代。未经产品所有者明确改变，不重新比较前端框架。
- 当前服务端位于 `apps/server/`；未来 Android 工程固定放入 `apps/android/`。
- `packages/` 只用于已经出现真实跨应用复用关系的代码；不得预先制造公共层。
- `deployment/` 只保存部署定义；照片、数据库、备份、凭证和用户记录不得进入仓库。
- `deployment/scripts/` 保存可审阅的服务器验收入口；任何重建容器、重置测试库或恢复测试都必须使用固定隔离目标和显式影响确认，不得删除业务 volume。
- 根目录只保存全仓库入口、规则、许可、忽略规则和跨应用编排配置。应用专属源码、依赖和构建配置必须跟随对应应用。
- APK、AAB、`dist/`、Gradle `build/`、缓存和本机配置都是生成物或本地状态，不得提交。
- 当前有效的完整放置规则以 `docs/architecture/repository-layout.md` 为准。

根目录工程命令：

```bash
npm install
npm run dev
npm run check
npm run test
npm run build
npm run api:contract
npm run test:e2e
```

真实 PostgreSQL 集成测试单独使用 `npm run test:integration`，并且只能连接名称以 `_test` 结尾的显式测试数据库。

## 7. 阶段约束

Phase 5 Web 代码实现已经完成。完成性审计发现的训练消耗、图片暂定采用、饮食安排、历史趋势和上传体验缺口均已补齐并通过本地自动化验收；产品所有者已把真实服务器部署定义为独立后续目标。

- Phase 3 体验基线与 Phase 4 技术架构、交付顺序均已由产品所有者确认，不得重新降级为待讨论候选。
- 后续若启动部署目标，再按自托管文档验证 Compose、PostgreSQL、pg-boss、DeepSeek、备份恢复和手机访问。图片不得进入导出或默认长期备份；Android 仍按既定门槛后移。
- 可以创建真实的 `apps/server/` 和 `deployment/`；`apps/android/` 等到 Android 增量，`packages/` 仍只在真实跨应用复用出现后创建。
- PostgreSQL 是业务事实源；Drizzle migration 必须生成可审阅 SQL，生产不得使用 schema `push`。pg-boss 只负责执行，自有任务表保存产品权威状态，Worker 按至少一次执行和幂等写回设计，当前不引入 Redis。
- 私有表均保存账号归属并纳入访问分类、跨账号拒绝测试和 PostgreSQL RLS；新增账号表必须同步这些清单。管理员权限不得隐含获得其他用户健康数据读取权。
- 密码明文或可逆密码不得写入数据库、日志、错误、任务、导出或备份清单；数据库只保存符合当前安全基线的 Argon2id 摘要。浏览器认证令牌不得进入 `localStorage`。
- 容器、migration、测试和备份骨架必须使用假数据与示例 secret；数据库、临时媒体、真实 secret 和备份仍位于仓库外。
- 每完成一个可运行纵向切片，执行类型检查、构建、单元/集成测试和相应安全检查，并同步交付进度；不得用静态演示冒充真实服务能力。增量 0 的真实 Compose 首次启动、migration/RLS、API/Worker 健康和非破坏性 smoke 已通过；容器重建持久化、任务故障注入和备份恢复仍应分别标记为待专项验收。
- DeepSeek 请求结构的本地合约测试已完成；真实 Key、真实模型响应、用量、限流和超时仍需服务器环境验收，不得用固定测试结果冒充。目标服务器规格在确定生产参数或首次部署前采集，本地工程保持可配置。
- 问题报告只能由用户主动生成并先行预览，不得自动上传；浏览器自动收集部分不得记录请求体、响应体、账号标识、凭证、照片或训练饮食明细，部署侧诊断不得读取 secret、数据库记录或媒体内容。

## 8. 文件与 Git

- 使用 `apply_patch` 编辑人工维护的文件。
- 保留用户已有改动，不覆盖无关文件。
- 产品所有者已于 2026-08-30 明确要求：每批用户可见问题修改完成并通过本地验收后，默认自动提交到 `main`、推送 `origin/main`，并继续完成 Exercise App 的受限服务器重新部署和公网健康/版本验证，不再停在本地等待重复授权。
- 上述持续授权只覆盖本项目代码的 fast-forward、应用镜像构建、私有应用版本键更新，以及只重建 Exercise App API/Worker；不覆盖 setup/migration、数据库写入、PostgreSQL、Nginx、Docker 服务、宿主机、端口、secret、volume、其他项目或清理操作。若某次变更需要这些操作，必须先说明影响并获得单独授权。
- 自动发布失败时保留现场、报告证据，不得为了完成部署擅自扩大操作边界；未经用户要求仍不执行破坏性 Git 操作。
- 远程仓库为 `https://github.com/Syriii/exercise-app`，默认分支为 `main`。
