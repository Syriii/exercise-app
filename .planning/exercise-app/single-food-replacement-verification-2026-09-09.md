# B2c 单项食物目录替换验收

## 范围与实现

- 复用FoodPicker浏览全部食物、统一分类、常用排序、在线搜索和个人补充；替换模式只选一项，按新食物的基准单位填写份量。添加与替换草稿独立，普通导航保留草稿。
- PUT /api/v1/nutrition/meals/:mealId/contributions/:contributionId/food-selection，由服务端核对账号、目录版本及份量，保存目录快照并重算营养，不信任客户端营养或沿用照片单位。原项ID/分析关联保留，旧来源和值进入既有修订历史，其他条目不变。
- 复用updateContribution行锁/餐食及条目CAS/同事务历史，不新增数据库迁移。旧请求或并发修改返回409，不重复添加；已删除目标404，不恢复。失败保留选择，重新读取服务器并确认新基准后才允许再次提交。
- 本次只收口U05剩余单项认错替换，不涉及C训练、D今天/首次设置/我的/历史；不新增真实模型调用、公式或数据源。

## 本地验证

- check、build、api:contract通过；140项单元/API通过，日志/tmp/exercise-b2c-{check,build,contract,tests}.log。
- 首轮定向4项中2项失败，仅因测试期待原始503文字，而客户端统一安全提示；修正断言后4/4通过。
- 全量手机/桌面65/65通过（40.1s），日志/tmp/exercise-b2c-e2e-full.log；手机单项替换结果截图目视检查通过，无横向溢出。
- 后续仅Web修正“冲突后浏览目录不得隐藏刷新入口”，重新check/build及共用目录与替换6项双端回归通过（7.7s），日志/tmp/exercise-b2c-e2e-final.log。
- 首次本地浏览器服务受沙箱EPERM限制，获本地验收升级审批后通过，不是应用故障。仅假数据。

## 真实PG与交付

- 新增第21项：replaces one photo food from catalog atomically with immutable basis, rollback, concurrency and RLS。覆盖父餐食更新末尾故障时回滚食物与历史、并发只写一次、原照片来源历史、其他条目不变、拒绝跨账号（含真实RLS）、不可恢复删除、未知营养、新基准改量与导出。
- 当前真实PG尚未执行，不以140项内存测试或旧20项冒充。先提交/push固定源码，经Git获取后仅显式隔离exercise_test运行；生产保持4f72113/ledger24。通过后只正式镜像/API Worker受限发布，不运行生产setup/migration/备份恢复或改secret/PG。
- 远端任务开始前按用户最新要求归档上一项已完成任务，再新建114保存项目local任务；持续等待最终正文。
