# Contributing

感谢参与 Exercise App。项目优先保证训练/饮食事实不被静默改写、个人数据隔离和普通自托管者能够理解部署边界。

## 开始前

1. 阅读 `AGENTS.md`、`docs/product.md`、相关领域规则和技术架构。
2. 从 `main` 创建短期分支；不要提交 `.env`、secret、照片、数据库、日志、导出、备份或真实健康记录。
3. 使用假账号和合成数据复现问题。动作视频、食物数据库或其他内容必须有可再分发许可。

## 本地验证

```bash
npm install
npm run check
npm run test
npm run build
npm run api:contract
npm run test:e2e
npm run audit:prod
```

真实 PostgreSQL 集成测试只能连接名称以 `_test` 结尾的独立数据库。不要把生产或个人使用库交给测试命令。

## 数据与 migration 规则

- 新的账号私有表必须加入 `data-access-policy.ts`，并选择直接或继承账号归属的 RLS 策略；内部表必须写明不使用 RLS 的理由。
- schema 变更使用 Drizzle 生成可审阅 migration；角色、RLS 等自定义 SQL 也必须进入 Drizzle journal，不能依赖手工改生产库。
- 模型原始估算、用户修正和当前采用值保持分离；未知值不得静默变成 0。
- 后台任务按至少一次执行设计，自有任务表是权威状态，处理器必须幂等。

## Pull request

说明用户可见变化、数据迁移、安全/隐私影响、验证命令与仍待真实环境确认的项目。不要把“已编译”写成“真实 PostgreSQL 已通过”，也不要把固定模型测试结果写成实际营养准确度。

安全问题请按 `SECURITY.md` 私下报告。
