# Exercise App 仓库架构

| 项目 | 内容 |
|---|---|
| 状态 | 当前有效 |
| 最后更新 | 2026-08-30 |
| 适用范围 | 源码仓库的应用边界、目录职责、构建入口和未来扩展位置 |
| 不在本文重复 | 服务端、数据库、Android、部署拓扑和版本顺序由已确认的 `technical-architecture.md` 与 `delivery-plan.md` 集中说明 |

## 1. 架构结论

Exercise App 采用单个公开 GitHub 仓库管理多个可独立构建或部署的应用。

- 当前 Web 客户端采用 Vue 3 + TypeScript + Vite，是第一个实际应用，位于 `apps/web/`。
- 当前服务端代码位于 `apps/server/`，包含 API、Worker、数据库 schema/migration 与模块边界。
- 未来 Android 工程固定进入 `apps/android/`。
- 共享代码只有在出现真实复用关系后才进入 `packages/`。
- 当前 Dockerfile、Compose 与配置示例位于 `deployment/`；真实 secret 和运行数据不进入仓库。
- 产品与设计文档、Codex 工作记录、源代码和私有运行数据彼此分离。

这种布局确定稳定放置边界；具体技术选择已经在 Phase 4 确认，Phase 5 按交付增量创建真实应用与配置。

## 2. 目录职责

```text
exercise-app/
├── apps/
│   ├── web/                     # 当前 Vue 3 + TypeScript + Vite 客户端
│   ├── server/                  # 当前 Fastify API、Worker、数据库与服务端模块
│   │   ├── data/                # 服务端随版本发布的可审阅生成数据
│   │   └── scripts/             # 服务端专属生成与校验工具
│   └── android/                 # 未来 Android 工程，实际开发时创建
├── packages/                    # 出现真实跨应用复用时创建
├── deployment/                  # 当前容器构建、Compose 与配置示例
│   └── scripts/                 # 服务器烟雾、集成、持久化与恢复验收入口
├── docs/
│   ├── architecture/            # 工程与仓库架构
│   ├── archive/                 # 失效但需要保留的历史稿
│   ├── domain/                  # 领域概念、状态、规则与安全边界
│   │   ├── domain-rules.md      # 已确认的当前领域事实源
│   │   └── calculation-evidence.md # 训练与营养规划官方证据登记
│   ├── experience/              # 体验结构、流程、原型范围与交互状态
│   ├── deployment/              # 自托管、持久化、备份恢复与部署验收
│   ├── product.md               # 当前产品事实源
│   └── product-decisions.md     # 重要产品决定
├── .runtime/                    # 本地运行状态与私有源资料，始终忽略
├── .planning/exercise-app/      # Codex 计划、研究和进度记录
├── AGENTS.md                    # 全仓库协作与放置规则
├── README.md                    # 项目入口
├── LICENSE
├── .gitignore
├── package.json                 # JavaScript workspace 与根命令编排
└── package-lock.json            # JavaScript workspace 的统一依赖锁
```

尚未产生内容的 `apps/android/` 和 `packages/` 不创建空目录。上图既表达稳定位置约定，也反映 `apps/web/`、`apps/server/` 与 `deployment/` 已经出现的真实内容。

## 3. 根目录与应用目录的边界

根目录只保存对整个仓库有效的内容：项目入口、许可、Agent 规则、忽略规则、跨应用编排和统一依赖锁。具体应用的源码与专属配置必须跟随该应用。

当前 Web 应用自行拥有：

- `apps/web/src/`
- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/tsconfig.json`、`tsconfig.app.json` 和 `tsconfig.node.json`
- `apps/web/playwright.config.ts` 与 `apps/web/e2e/`

根 `package.json` 不声明 Vue、Vite 或其他 Web 运行与打包依赖，只通过 npm workspace 转发根命令。当前 TypeScript 编译器版本在根 workspace 统一锁定，避免 npm 可选 peer 把不兼容的编译器版本提升给多个工具；Vue、Vue Vite 插件和 `vue-tsc` 仍归属 `apps/web/package.json`。npm 官方把 workspace 定义为由顶层根包管理多个本地嵌套包的机制，并支持从根目录在指定 workspace 中执行命令：<https://docs.npmjs.com/cli/v11/using-npm/workspaces/>。

Vue 官方推荐使用基于 Vite 的 `create-vue` 建立项目，并为单文件组件与 TypeScript 提供官方工具支持：<https://vuejs.org/guide/quick-start.html>、<https://vuejs.org/guide/typescript/overview>。本仓库保留既有 Vite workspace，只把框架插件、入口和组件转换为 Vue，不重新生成或打乱仓库结构。

服务端技术选择与模块边界见 `technical-architecture.md`；无论以后是否改变实现语言，服务端仍归入 `apps/server/` 并在目录内维护自己的构建配置。

## 4. Web 到 Android 的演进边界

Android 是明确的后续交付形态。Phase 4 草案把 Web 容器路线设为首选，并保留验证失败后的原生路线：

1. **首选 Web 容器路线：** 使用 Capacitor 复用 `apps/web/` 的构建结果，在 `apps/android/` 中维护原生容器、权限、图标、签名和平台配置。Capacitor 官方支持加入现有 Vue 项目：<https://capacitorjs.com/docs>。
2. **独立原生路线：** 在 `apps/android/` 中维护完整的 Kotlin、Flutter、React Native 或其他 Android 工程，通过服务端接口复用业务数据和规则。

两条路线都保持同一仓库边界；正式 Android 增量先验证相机、上传、会话、通知和目标系统版本，再确认是否继续 Capacitor。

如果采用标准 Android Gradle 工程，`apps/android/` 是 Android 项目根，内部再包含常规的 `app/` 模块、Gradle 配置和源码资源。Android 官方对项目级配置、应用模块、源码与资源目录有明确分工：<https://developer.android.com/build/android-build-structure>。

APK 和 AAB 是构建产物，不是源码。它们应被 Git 忽略，并在需要发布时通过 GitHub Releases 或 Android 分发渠道交付。Android 官方说明 APK 默认生成在模块的 `build/outputs/apk/`：<https://developer.android.com/build/build-for-release>。

## 5. 服务端、部署与运行数据

- `apps/server/` 保存账号、权限、业务数据、照片访问和分析任务交接等服务端代码。
- `apps/server/data/` 只保存经过生成、校验、许可审阅且需要随应用版本发布的数据；原始第三方资料不放在这里。
- `.runtime/` 保存本地可重建的运行状态、临时文件和私有源资料，不会进入 Git 或 Docker 构建上下文。
- `deployment/` 保存 Docker、进程、反向代理或其他部署定义，不保存真实运行数据。
- 餐食照片在服务器的临时持久化位置中保存到分析、重试和用户复核完成，不进入 Git 仓库；数据库、备份、访问凭证和用户记录同样位于仓库外。
- 代码重新部署不得覆盖运行数据；当前 Phase 4 草案采用 PostgreSQL 与独立临时媒体卷。数据库进入长期备份和恢复演练，临时照片不进入长期备份。

## 6. 共享代码规则

不得为了看起来像 monorepo 而提前创建公共包。只有满足以下条件之一时才建立 `packages/` 中的包：

- 至少两个实际应用需要使用同一份代码；
- 需要独立维护稳定的接口契约、数据结构或生成产物；
- 拆分后能形成明确依赖方向，而不是循环引用或跨目录随意导入。

可能出现但尚未决定的共享包包括 API 契约、领域计算或通用 UI。名称和边界在真实依赖出现时确定。

## 7. 当前工程命令

在仓库根目录执行：

```bash
npm install
npm run dev
npm run check
npm run test
npm run build
npm run api:contract
npm run test:e2e
```

根命令目前编排 `@exercise-app/web` 与 `@exercise-app/server` workspace。`npm run dev:web`、`npm run dev:server` 和 `npm run dev:worker` 可以分别启动三个开发入口；检查、单元测试和构建默认覆盖所有已有 workspace。真实 PostgreSQL 集成测试使用独立的 `npm run test:integration`，并强制要求 `TEST_DATABASE_URL` 的数据库名以 `_test` 结尾。

## 8. 文件放置判断

新增文件前依次判断：

1. 是否只属于一个可运行应用？放入对应的 `apps/<name>/`。
2. 是否被多个实际应用共享？放入经过定义的 `packages/<name>/`。
3. 是否是部署定义？放入 `deployment/`。
4. 是否是长期有效的产品或工程说明？放入 `docs/` 的对应分类。
5. 是否是 Codex 工作状态？放入 `.planning/exercise-app/`。
6. 是否是本地运行状态、私有源资料或可重建缓存？放入 `.runtime/`，不得进入版本控制或容器构建上下文。
7. 是否是凭证、数据库、备份、用户记录或构建产物？放在各自受控的仓库外位置，不得进入版本控制。
