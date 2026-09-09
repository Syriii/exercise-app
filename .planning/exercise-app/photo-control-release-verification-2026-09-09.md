# B2b 4f72113受限发布记录

当前阶段：全部门禁通过，4f72113已受限发布，2026-09-09 09:59:39（北京时间）本机独立公网复核通过。仅B2b本批范围完成，单项认错食物从目录替换、C/D仍待推进。

## 源码与验收

- 固定发布源码4f7211373a7ebafcdbacc4e9f3d48448b5290513。与真实PG20/20通过的d3c93e59服务器/根依赖/deployment差异为空；4f增加Web过期预览服务器刷新，check/build及受影响双端6项通过，沿用[真实PG证据](photo-control-postgres-verification-2026-09-09.md)，不重跑。
- Git任务01a083a5-68cd-7202-a9fe-39cccf01488d一次fetch退出0/1592ms，远端origin/main已eecbd9c15bd576d3b689558282d6e37a18d1bede，4f/d3属于其历史。HEAD/main41d472d8与origin分叉1/14，独有验收文档和未跟踪旧发布文档保留，不pull合并/重置；从已取得的固定Git树archive导出，未传bundle、未建worktree。

## 准备与主任务审阅

- 准备任务01a083a9-5148-7313-a5f5-1992460fead9，回合01a083a9-5c55-7b70-92ac-7cfe25ae4d9c耗时2068026ms，completed/idle；两个接口均取得完整最终正文及全部文件正文/分段输出。不是仅依据状态或摘要放行。
- 远端目录/tmp/exercise-b2b-release-prep.uafsaE；源码source-4f72113，无.git。source-4f72113.tar为6000640字节，SHA256 dbd0bd3bd69e3b6bc708fb0ee70e4ce0d8566e4daec2c6bb523d6269210fae78。git get-tar-commit-id精确，298个blob逐内容/路径/模式核对；无.gitattributes和符号链接。
- source-tree.manifest.tsv包含349项（51目录/298文件），SHA256 216ce20fca24c362fac7ff2645a677c30a7c3f58b2ff02af88636a91b365758b。artifact-sha256.txt SHA256 592583b1e43cc7e669b93f9a564c51dd47e1ba56b51d77d0ef0c501ed94b1905；完整20项顶层清单0183b5b90849f9652b2c0555b48255c111721b2c5185c008da6687e0c226c4ae。
- 主任务已完整审阅所有将执行的shell/mjs/override/env patch及RUNBOOK，重组本机副本/tmp/exercise-b2b-release-review.bSNTSw；13份副本hash与远端清单吻合，Shell/Node语法通过。执行前固定清单再校验；mjs保持0644、prep0700，secret权限不动。
- 准备中仅修正临时源码umask模式、ledger分隔符和脚本布尔显示格式。源码和生产未变。最初角色检查t/f与实际拼接true/false不一致，已只读证实属性正常并修正预期；失败的env哈希证据另存保留，复检通过。未安装shellcheck。
- 只读预检最终通过：生产f7cfd13/迁移23、容器/角色/网络/只读secret/健康/401匹配，正式镜像和本批备份目录/恢复库不存在。Compose API/Worker除image/build外无差异，migration-only无ports，只读根/secret/mjs/default网络/no-new-privileges。

## 已审阅执行文件SHA256

| 文件 | SHA256 |
|---|---|
| release-common.sh | 7223a8249946fd57df38b81d7796676133dee2c344c8110fb3611153facd925d |
| preflight.sh | c50515d0f20c911e083ee0c4b67bd0b389638587812394f07fda00a55c45527d |
| build-runtime.sh | d864ce315143c7371477b8cdec07864135038b3fb9d3ba65f02fd9455067c8b8 |
| compose.4f72113.release.yaml | 79c4394db54c0be1d859663ca2cc65154beadab47f1b5908eab0590f552aca9d |
| migrate-0023.mjs | 5174dac36fbe61097ceee227d750bd27911f9a68e82644145ba53f143450236a |
| backup-restore-verify.sh | 42c89ccf385dea1d8b6b04541d2133d8e0f6613f0b99b3f5b1c3007e69f57411 |
| migrate-production.sh | 2c2ef063469883e6becdd9793c6e4b8f8c0f6f2a8ac4f32d5efeef8842fa1690 |
| env-forward.apply_patch | cc3b7433e50fbb7b77f3dcaf83e4f1ea2638348c34141e21cf2a87476a4192ac |
| deploy-api-worker.sh | 3e1398a36086d6fe71794a3dfa690dd738f4f97eb938c71000aa91cf68bda744 |
| postflight.sh | 379112b2a9d29b5f7436ab4c0e88fefd183cd82a95e17a9d312000568a50973b |

## 阶段状态与边界

1. 正式构建：任务01a083c9-cf77-7f03-838e-1c4b4e7fd781（“114 B2b：构建4f72113正式镜像”），回合01a083c9-db75-7de1-aa6b-abe904dabb27耗时210200ms，completed/idle且最终正文直接可读，脚本一次退出0。exercise-app:4f72113镜像ID sha256:97cbe7d9b347f0036969e72130693a3d4459f42705af76bcabb4977ff17c4706；入口/Web/SQL/journal验证通过，生产仍f7/23且保护通过，旧镜像保留。runtime-image-build.log SHA256 d888677d85b7db716acfbecede44b0fa99cabf761718093b51939c8bcfd9b6db；runtime-image-build.json 5fb9d1244d3fc51c4130e6d96d6f82dadefb1d4b4a9d2ea55e3a9bf45932ac26，均在准备目录。
2. 备份/恢复：任务01a083cd-d0bb-7772-9514-c1d68817c0bd（“114 B2b：私有备份与隔离恢复验证”）已通过。目标私有目录/newdata/data/xiesh/exercise-app-private-backups/4f72113，备份exercise-pre-4f72113.dump；恢复库exercise_b2b_restore_test，先确认不存在/0连接、创建时限连接，再仅收紧该测试库CONNECT，真实恢复保留owner/ACL、仅元数据检查及0023试迁移，清理仅本轮0连接测试库，旧/新备份都保留。
   - 最终结果：回合01a083cd-db02-77a2-8af7-2c85166e3948耗时305961ms，completed/idle且直接读到最终正文，一次执行退出0。dump 214024字节，SHA256 e4e26923dd3f8f4c9d8f95951da026a3e7774cafebfd67f3b20122d176334663；restore-verification.json SHA256 a5e6155351b1959fb9d12687ed8e3e9dced3192011c2429c4b1f4a9bf29853ec。custom archive/真实恢复、精确0023的23→24及四字段/waiting/安全元数据全部通过；恢复库不存在/0连接，本轮migration-only容器已清理。目录0700、文件0600，旧新备份保留。生产仍f7/23，容器/PG/角色不变，内外健康200/私有401/心跳13s。
3. 生产0023：任务01a083d6-ba89-7a13-a042-ba821c3f5b62（“114 B2b：仅执行0023生产迁移”）回合01a083d6-c85d-7a92-ab90-868c319ed365耗时349072ms，completed/idle且直接取得最终正文。一次退出0，仅0023单serializable事务、ledger23→24，四字段/waiting/owner/ACL/RLS/角色全部通过，安全元数据前后SHA256均e0d700b2b253cf58ccf3c11b5830b07765ce4fa6a815415e5919ae628f8dc361。应用仍f7、PG不变，内外健康200/私有401/心跳≤45s。私有备份目录production-0023.json SHA256 b00b3a0b2ada9d1804d5b028202ee22f35926e4403255c94d1e7776a1ca39aa7，production-migrate-0023.log SHA256 88da8c16c7c503f85d15efc55c0609b93348a19af9a18963c3f420cd56e0dcf6，均0600。迁移前附加只读hash命令有一次shell引号错误，不涉及生产写入；正式脚本未重试。
4. 版本键与切换：任务01a083dd-5574-7b82-b682-8892ce90d3c3（“114 B2b：切换API Worker并验收公网”），回合01a083dd-60bc-7a50-abdf-0337450077f6耗时495952ms，completed/idle且直接读到最终正文。Stage4/5/6退出码均0。仅apply_patch两个版本键f7cfd13→4f72113，保留0600，非版本内容SHA256仍5bfaeac96a69bc04f8a8d233f2fc0e432827848144f3ed6de7b0d2382fba5589；仅API/Worker up --no-deps --no-build --wait --wait-timeout90。新waiting记录可能不兼容旧代码，无条件自动回退禁用。私有备份目录api-worker-release.log SHA256 7595d3f499a640ac5a368fb7c93ad9d1b8a073884932bc6eaf6c4da831301ee4，api-worker-release.json SHA256 bbaf43de9d390821c2b6c67f1f0b7f54a5f535a4468d741b55fd43b3ec1377d1，均0600。
5. 远端后验：API ID 110058fcf4dc0b229763decbaec1b462dd3b8b1ba4fe80ce5c4246479ce53288，healthy/重启0；Worker ID 70086b080f4ec50cae2ec45324b2858993319dda0946b6e2d6ff88b4e46ade57，重启0，心跳2秒。均运行精确4f镜像。PG ID 890633238a9698dbbd43381f1af2d9e47e3efe3196ac1e7c692bcc3ec0009755，镜像/网络/重启0不变，ledger24，角色/安全元数据/只读secret匹配，旧f7镜像保留。local/public live/ready200，私有401，/assets/index-C6f8J6a6.js含4f72113。保存仓库HEAD/main41d472d8、origin/main eecbd9c不动。
6. 本机独立后验：2026-09-09T01:59:39.416Z，首页/live/ready均200，auth/me及nutrition/meals未登录均401，/assets/index-C6f8J6a6.js为200且含4f72113。首次沙箱网络EPERM，获网络升级审批后同一只读检查通过；不是公网故障，未发送凭据或业务数据。

本批沿用已通过的138项单元/API、61项E2E、4f受影响6项及真实PG20/20；无真实模型调用。单次生产授权已执行完成，不作为以后重跑迁移或备份恢复的许可。受限清理仅本轮无连接测试库及临时运行容器，旧新私有备份及日志保留。

每阶段按用户要求新建SSH原目录任务，持续等待最终正文后才进入下一阶段；已授权范围见[门禁](photo-control-release-gates-2026-09-08.md)。不setup/队列迁移/改密/生产覆盖恢复/业务写入/清理旧备份，不改宿主机或其他服务。
