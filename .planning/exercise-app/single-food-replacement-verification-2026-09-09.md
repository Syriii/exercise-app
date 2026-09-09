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
- 固定源码ded36d4ebaa3b03e01e18fc890635a3cc50ef75f已提交/push；真实PG21/21通过，新增精确用例通过。exercise_test内迁移24，验收后不存在/0连接/integration容器0。生产保持4f72113/ledger24；无生产迁移、备份恢复或正式构建/切换。
- 上一项01a083dd-5574-7b82-b682-8892ce90d3c3重新核对completed及最终正文后已归档；114保存项目local任务01a083f8-3ff2-7952-bb97-311968906f94（“114 B2c：单项食物替换21项PG验收”）完成，回合01a083f8-4b8b-7b31-9c7c-e058de6af4ca耗时1579239ms；wait_threads及read_thread均直接取得最终正文，不建worktree。
- 远端唯一fetch成功，origin/main更新为ded36d4，HEAD/main41d472d8和未跟踪旧文档保留。临时目录/tmp/exercise-b2c-verification.SUwEfG，source-ded36d4来自git archive；tar SHA256 d9821cbf49ccaf24fc9bed2bfcc8ec03f24bc7abb0241ad6af6d70276448f245与本机独立计算一致。303/303 blob内容/路径匹配，导出模式已按Git树规范化（292个0644、11个0755），无.git/符号链接。
- Verification镜像exercise-app-verification:b2c-ded36d4，ID sha256:3609ec4f0c644d96b87437ece2dff9e50ae0d3c087b70c68aaef7291ddaee53f。生产API/Worker/PG容器、镜像、重启数、网络、角色、只读secret挂载与ledger24均未变；后置Worker心跳7秒，本机及公网live/ready200、匿名私有401。
- 远端证据均位于上述临时目录：报告b2c-verification-report-2026-09-09.md，SHA256 b1dceea3c6b6a4f884c81867a616c30dd1d9bfa653ec52726d22bdbc5b2db883；postgres-integration.log，9aee9857645c52911846c7f550fbcfcce12336ad77d6fe489f4d2a1a8d66955d；run-b2c-verification.sh，896ee453497b565efe1367b7fe8f1fa0d29807694991d88321b2509037768012；SHA256SUMS，d57bdb59d1ce9d0e7070784f9fc8ce2097b678ef549aaf7acf39b6823d31d12f（8项全部校验OK）。

## 受限发布完成

- PG最终结果留证后已归档该任务；新建01a08414-c27a-7781-8792-8deea6681a70（“114 B2c：固定ded36d4受限发布与公网验收”），同一114保存项目local环境，无worktree。复用已验收的固定源码和PG证据，不再fetch或重跑PG。
- 受限发布回合01a08414-d8d2-72e2-b776-c38c41354ef1已completed/idle，耗时1558112ms；wait_threads及read_thread均直接读到最终正文msg_01435047cbc4c678016aa0cfe5dedc87d098393878aeaaa8aa。正式构建、静态检查、切换和后验全部通过，没有新迁移、备份恢复、secret/PG更改或业务写入。
- 正式镜像exercise-app:ded36d4，ID sha256:a96eec35db636f66744d6ec24af7e48e7c824433de96ccc629907e4e46305dab；API新容器141378a2984ee35a8c58928f339d090145335b1121cd5ff2165f3c5f7ccb4901，Worker新容器6077e9a41dbff585bf7eae0225764768460c6e58bab293c16eed9c8da16383f1。两者running、restart0、网络exercise-app_default；API healthy，Worker后验心跳10秒。
- .env仅APP_IMAGE_TAG及APP_BUILD_REVISION由4f72113改为ded36d4，权限0600，除版本键外规范化SHA256保持5bfaeac96a69bc04f8a8d233f2fc0e432827848144f3ed6de7b0d2382fba5589。旧4f镜像、备份及原仓库未跟踪文档保留。
- PG容器890633238a9698dbbd43381f1af2d9e47e3efe3196ac1e7c692bcc3ec0009755、镜像sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af未变，healthy/restart0；角色属性、只读secret和ledger24|1788874421379未变。
- 远端本机/公网首页、live、ready200，匿名auth/me和餐食401；本地主任务2026-09-09T03:14:22.324Z（北京时间11:14:22）独立复核同样通过，/assets/index-CO0p1qSQ.js为200且含ded36d4。没有账号/业务数据读取或真实模型调用。
- 主任务审阅本轮脚本时指出/bin/sh与read -d不兼容，远端统一Bash后bash -n及303项树校验通过；补丁锚点首次不匹配为原子拒绝，无部分发布脚本，修正后继续，没有重跑PG。遵循planning-with-files只维护现有计划和本批证据；release-skills沿用提交SHA，不引入semver/tag或对文档提交重新部署。

远端私有证据目录/tmp/exercise-b2c-release.Rlz84P为0700，报告和日志0600，凭据模式扫描0命中。以下SHA256均来自直接读取的最终回复及执行输出，SHA256SUMS共22项全部校验OK：

| 文件（相对上述远端目录） | SHA256 |
|---|---|
| release-report-2026-09-09.md | 82f8fd1b2b4c645ae5f68e65098a88b95a39d3b6b70f2d02a60859695dfbd9bf |
| SHA256SUMS | 37647a307d30ffd14859f0b5c8ae5c74101cde49dc04a6a89df5a3e3b34c0774 |
| release-common.sh | bb2e8bc6c6190b655f7fa71c3e0a772d8f06198ea316ac4a37259b442defb739 |
| build-runtime.sh | fa76237cd5402dcf82da5b914b12ffe1f59f9aaf3d939abd74caf611eae111d7 |
| deploy-api-worker.sh | ffb27c8b2ea65b1494b893c3a7ba40a379a19181bde5864cc29b99e6e77a2aa9 |
| postflight.sh | eb13aba24103f6fe09be23dc8fef397d1e461f354f70e6b59d3176cb0d2ec156 |
| runtime-build.log | d88d68e4a589159ed494247aca79e35a8c4cacaca49091d5a5975a8787714759 |
| runtime-static-inspection.log | 872faf1e98219ab223a05848aacc4a1baffac44731cf135622082ceac34e48cb |
| api-worker-release.log | e127c46a2b04eea59801eb4850cbcae77530f944f515a6d167e9c69d4218ce51 |
| postflight-report.txt | cfc63ce256b98910df640c8ad7692b7dddd2b50a1062b3f1e13dd8ffcb7bc3f4 |
