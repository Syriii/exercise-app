# Codex 远端回复读取缺失：定位与复现

## 状态

已在本机安装包的原始函数上复现一个吻合现象的读取缺陷，并验证新鲜读取路径。用户重启本机应用后，两个工具曾恢复读取同一回合的最终正文；随后新派发回合再次缺失正文，旧回合仍可读。尚未修改安装代码，也未直接读取本实例的运行时缓存游标；不是永久修复或已证明唯一根因。

## 用户要求归档旧任务并在原目录新建测试（2026-09-08）

### 后续复测：第二次归档新建

- 旧原目录任务01a08039-2368-7553-bfdf-8aaca957e0b6在B2b准备回合再次出现completed但正文为空；用户本次转贴完整结果并明确要求再归档新建。已确认归档成功，新建任务01a08174-0403-7d92-9947-348e8bbd883a，标题“114 原目录：归档后回复读取复测”。前后均为同一SSH项目、同一原目录、local环境，不涉及工作树切换。
- 第一轮回合01a08174-154f-7521-b48e-f72c5b621321，20593ms；只执行pwd且退出0。wait_threads.polls[0].latestAssistantMessage.text与read_thread.turns[0].items[3].text均读到标记REMOTE_REPLY_PROBE_20260908_ARCHIVE_NEW_01、实际目录/newdata/data/xiesh/exercise-app及未变更声明。最终消息ID msg_0a5474cf8d66cf46016aa01dc9fd2887d0a04c3d8d5e29da97。
- 第二轮回合01a08174-c2b1-7d40-a103-aa90be8782fd，4228ms；纯文本、无命令。携带前轮cursor等待后，两接口均读到新标记REMOTE_REPLY_PROBE_20260908_ARCHIVE_NEW_02，read_thread最终项为items[1]，最终消息ID msg_0a5474cf8d66cf46016aa01de5dc8c87d0a66d9508cec92430。最新cursor为2477c01b-0a94-48bc-8513-4b45ef74abdc:4。
- 证明本次归档新建后连续两轮可读；不证明归档本身为必要条件、永久修复、长回合/重连后稳定性。未修改客户端，未执行PG/构建/迁移/部署。旧准备产物保留，不重跑业务以修复回传。
- 官方归档说明仅用于核对任务生命周期，不作为故障根因证据：[Archive a thread](https://learn.chatgpt.com/docs/app-server#archive-a-thread)。

### 前次测试及业务对照

后续实际业务对照：完整脚本读取回合01a0803d-476d-7f40-a490-e5ca7a70f398（135968ms）、Stage 1回合01a08041-4ff6-7bf3-98c4-f73a9679a1d1（477447ms）、Stage 2回合01a08049-599c-7931-b358-58b97e099f05（216726ms），均直接取得最新最终正文与相关完整命令输出。新任务已支持多轮及长回合，不只是最小文本探针成功；尚无重连后证据，不宣称永久修复或工作树是根因。

- 用户明确授权归档旧远端任务并新建任务测试完成后的回复可读性，覆盖此前“不另建回传任务”的限制，仅作为本次诊断。旧任务01a079c5-de63-73a3-bb38-1cae91f63a3e归档成功。
- 新任务01a08039-2368-7553-bfdf-8aaca957e0b6，标题“114 原目录：回复读取最小测试”，主机仍114，environment明确local、cwd为/newdata/data/xiesh/exercise-app，未创建工作树。
- 第一回合01a08039-3238-7012-af94-090b8cd9a1ad，12080ms完成；仅pwd，退出0。wait_threads和read_thread均直接取得final_answer，消息msg_0cb943306c612d9b016a9fcd2577b087d0854292013bd2c4f0，标记REMOTE_REPLY_PROBE_20260908_A_7d3c91及实际目录准确。
- 同一任务追加第二轮纯文本测试，回合01a08039-dcf1-7f70-a0b1-7d5e18e244a6，3855ms完成；两个接口同样直接读到最新final_answer，消息msg_0cb943306c612d9b016a9fcd49265487d09ec075f3c4b8b6c9，标记REMOTE_REPLY_PROBE_20260908_B_8a2f64。不是仅首轮可读。
- 本次证明“新任务＋原目录”连续两轮可读；同时改变了任务历史/缓存和工作树模式，不能独立证明工作树为根因，未验证长回合/重连后表现，未修改客户端。测试未执行构建、PG、备份、迁移、部署或项目文件写入；主任务仅更新本地诊断/规划记录。

## 重启后新回合再次缺失（2026-09-08）

- 原任务的新验收回合01a07fd0-797e-7553-96f6-7b8d818bef43：startedAt1788850764、completedAt1788851736、durationMs972558，15:15:36北京时间completed/idle、error:null；持续有界等待覆盖整个执行期，不在inProgress时提前结束。
- 完成后等待同步、带/不带afterCursor读取wait_threads以及read_thread最新页，仍latestAssistantMessage/latestToolMarker为null、items=[]。同一read_thread读取最近2回合：新回合0项，上一恢复回合01a07f7f-f074-7732-8057-db05fdbbcc82仍9项及完整final_answer。
- generation仍2f2542a9-36ed-40ae-b233-4cc757d39926、revision3。真实现象为重启可恢复旧正文、重启后新回合正文又缺失；进一步支持读取边界未随新回合刷新，但没有检查实时缓存值，不能断言唯一根因。
- 本次18项PG是否执行、通过及清理状态均须最终正文确认；不重发任务或重跑来恢复回传，不以completed替代验收结论。
- 后续用户复制同回合最终回复，确认f7cfd13真实PG18/18通过、精度覆盖与清理/生产保护通过，远端确已执行并产生最终报告。此为用户转贴，不表示工具回复读取已恢复；进一步排除“远端没有执行”对本轮缺失正文的解释，具体缓存根因仍保留上述证据边界。
- 后续准备回合01a07ff7-49fe-7840-986a-a8c563b511f4也在completed后无正文：startedAt1788853307、completedAt1788856066、durationMs2758847、generation相同/revision5；等待同步与两接口复读后，新准备回合0项、上一PG回合0项、重启时已存在的旧恢复回合仍9项。再次吻合重启后新回合读取边界未更新的现象，未修改客户端或通过重复业务执行恢复回传。

## 重启后同回合对照（2026-09-08 14:41北京时间）

- 目标仍为01a07f7f-f074-7732-8057-db05fdbbcc82，startedAt1788845486、completedAt1788845626、durationMs140071均不变；未发送新消息、未重跑远端任务。
- wait_threads返回polls[0].latestAssistantMessage.text，消息ID为msg_0d394a81422a9e62016a9f9e31d64487d0a2f1fb042d6bd1dc，phase为final_answer。
- read_thread从0项恢复为9项，完整最终正文位于turns[0].items[8].text，消息ID与wait_threads一致，内容与用户转贴一致。
- 快照游标generation由98337b56-472f-45bb-98db-daf076d80906变为2f2542a9-36ed-40ae-b233-4cc757d39926，revision由100重新从1开始；支持本机内存状态已重建，不将这两个generation之间的revision数值直接比较为历史回退。
- 证据摘要保存于/tmp/exercise-reply-read-diagnostic.Wl366Q/after-restart.json。不含其他任务或推理内容。
- 结合安装代码与隔离复现，结果进一步支持本机客户端缓存/分页边界相关缺陷；没有通过重启对照单独证明具体游标值，更不证明不会复发。

## 已核实的现场

- 任务：01a079c5-de63-73a3-bb38-1cae91f63a3e；主机：114.132.232.9。
- 目标恢复核对回合：01a07f7f-f074-7732-8057-db05fdbbcc82。工具状态completed/idle、revision100、durationMs140071；截至北京时间2026-09-08 14:35:03，wait_threads的latestAssistantMessage与latestToolMarker均null，read_thread最新回合items为空。
- 用户已从远端界面复制完整最终回复：只读核对确认c46a548在bundle接收/校验前中断，无对应源码/脚本/镜像/日志，无在途构建/PG进程，exercise_test不存在且连接0；生产仍31acb96、迁移21、健康200。本条来源是用户转贴，不冒充接口取得。
- 工具调用已检查完整content[0].text JSON，而非只查看items；外层无额外structuredContent或_meta。无afterCursor调用仍无正文，includeOutputs不改变结果。旧B1回合正文可读，不能将其冒充当前回复。
- 当前本机安装位置为ChatGPT.app中的Codex；应用版本26.901.51231，内嵌codex-cli 0.153.4。没有取得远端CLI版本，不能归因于版本不一致。

## 安装代码中的共同读取路径

文件：/Applications/ChatGPT.app/Contents/Resources/app.asar 内 webview/assets/app-initial-cadb12d4a15e.js。

该JS资产SHA256：73594359b28d81b6fcc9a52aac808f6a2e9fc32ced661adb3e23d297827b9285。

| 入口/位置（该资产中的字符偏移） | 观察 |
|---|---|
| dJi / read_thread，5933469 | 分页模式调用manager.listThreadTurns，要求itemsView full；pJi直接映射得到的items，不补读空正文，也不保留itemsView完整性标记 |
| eK / wait_threads，约5927583 | 同样调用manager.listThreadTurns获取最新回合；$qi从其agentMessage中选择正文 |
| pagination.listThreadTurns，2544708 | 已加载的paginated会话走Q4t，并传入conversation.paginatedHistory.itemsBackwardsCursor |
| Q4t，2535019 | 先取得最新回合元数据，再把上述缓存边界作为每一回合thread/items/list的起始cursor；即使要求full，也沿用该边界 |
| Q4t空结果处理 | 边界之前没有目标新回合的消息时，可把completed回合返回为items为空且itemsView full |

itemsBackwardsCursor在已检索代码中由resume/revert等快照响应写入。界面的事件流与工具重新读取并非同一路径；“界面可见最新内容、工具有状态却无正文”在这种条件下并不矛盾。单纯移除wait_threads的afterCursor不会消除底层缓存边界。

官方文档说明thread/turns/list与thread/items/list可只读分页，itemsView full代表完整项；具体上述调用链来自本机安装代码，不以通用文档代替实际证据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。

## 隔离复现与证据边界

脚本：/tmp/exercise-reply-read-diagnostic.Wl366Q/reproduce.cjs。

运行：node /tmp/exercise-reply-read-diagnostic.Wl366Q/reproduce.cjs。

脚本只读安装包并在隔离JS上下文执行实际PS/Q4t、t3t/n3t函数；后端数据全部合成，不连接真实App Server或数据库、不运行模型。

6/6检查通过：

1. 旧边界在新回合消息之前：原函数返回completed、items长度0、itemsView full。
2. 重复相同读取仍为空；时间/重试本身不更新边界。
3. n3t新鲜路径从null消息游标读取，得到最终回复，原界面缓存边界保持不变。
4. Q4t仅把消息起始边界改为null，也可读取最终回复。
5. 新鲜路径正确分页读回503项及末尾最终回复。
6. 实际没有消息的合成回合仍返回空，不伪造结果。

这证明代码路径在给定条件下存在问题；未直接检查运行时conversation.paginatedHistory值，因此本次真实实例的最终归因还需重载前后或上游请求追踪对照。

原始工具返回保存在同一临时目录的read-thread.json与wait-thread.json；尚未对外上传。

## 建议修复范围（未应用到安装包）

- 为动态工具提供独立的新鲜正文读取路径，不能复用界面恢复快照的itemsBackwardsCursor。
- read_thread与wait_threads共同采用该路径：保留用户请求的“回合分页cursor”，每个回合的“消息分页cursor”从null开始，再按服务器返回的nextCursor分页。
- 当前安装代码已有t3t/n3t全量读取辅助函数，可作为复用候选；接入时仍须保留请求超时、重复游标保护、主机/回合归属与后端能力检查。
- 不全局修改UI历史分页行为；不通过缓存删除、任务重发或生成假回复修复。
- 不能将未完整加载标记为完整空结果。长回合与读取失败须显式保留完整性/错误信息，不静默丢弃。
- 正式源码侧需补两个工具入口的端到端回归，覆盖新回合、恢复后新回合、已有回合追加消息、长消息分页和真正空回合。本次6项是隔离代码路径验证，不冒充这些正式回归。

## 下一步与操作边界

1. 已完成：用户重启后，主任务重新读取同一回合，确认两个工具正文恢复且回合ID/时间不变。
2. 待永久修复：按上文新鲜读取路径修正客户端源码并补工具入口回归；本仓库不包含该客户端的可维护源码，不将修改Exercise App当作修复Codex。
3. 如需向产品维护方反馈，可使用已准备的原始返回、安装代码位置与复现；对外提交前由用户确认内容，不自动上传任务记录。

电脑操作工具明确拒绝控制com.openai.codex；未绕过限制、未发送AppleScript/系统事件、未重载或终止应用。安装包未改，未改任何安全配置或远端服务。Exercise App业务代码和生产数据未改，PG测试未重跑。
