# Codex 跨任务结果读取诊断（2026-09-07）

## 结论与边界

已实测确认桌面端跨任务读取结果与底层持久化消息不一致：不是消息全部丢失，也不是仅发生在 SSH 远程主机。代码级定位高度指向历史快照游标被复用于新回合查询。尚未捕获运行中客户端实际发送的游标值，因此不把模拟游标当成线上抓包。

本轮是诊断，没有修改已安装客户端、SSH 配置或 Exercise App 业务代码，没有启动生产迁移、数据库验收或部署。

## 环境

- 应用路径：`/Applications/ChatGPT.app`
- 应用版本：`26.901.51231`，build `8109`
- 捆绑 CLI：`codex-cli 0.153.4`
- 远程任务：`01a04db6-862e-7720-9595-dbdbf63d0c1e`
- 本地对照任务：`01a05572-d2e3-7962-a52f-5e07c646a32c`

## 实测证据

| 对照 | 结果 |
|---|---|
| 同一远程任务，8 月旧回合 | read_thread 能返回完整消息和命令输出 |
| 同一远程任务，9 月新回合 | completed、error=null，但 items=[] |
| 9 月 7 日 10:25（北京时间）远程诊断 | 本地日志收到对应远程 turnId 的模型处理事件，不能推断远程没有执行 |
| 本地已完成回合 `01a079ae-715d-7172-ad65-f37cc8b46ac6` | read_thread 返回 0 条内容 |
| 同一本地已完成回合，通过捆绑 CLI 的官方 app-server 接口查询 | thread/items/list，cursor=null，返回 24 条内容且无后续页 |
| 底层查询后再次调用 read_thread | 同一已完成回合仍返回 0 条；当前主任务仍正常 active |

底层查询只调用 initialize、thread/turns/list、thread/items/list；只输出数量、类型和回合 ID，没有打印整段任务内容、凭据或业务记录。独立 stdio 诊断进程已结束，不启动模型回合。独立进程对当前进行中回合的离线状态不是原运行任务的权威状态，因此对照选用已经完成的回合。

## 代码定位

只读检查应用包 `app.asar` 中的 `webview/assets/app-initial-cadb12d4a15e.js`，没有注入或改写运行中的应用。

1. `dJi` 是 read_thread 的结果组装入口，要求 listThreadTurns 返回 full items。
2. 已加载 paginated 任务的 listThreadTurns 分支调用 `Q4t`，传入缓存 `paginatedHistory.itemsBackwardsCursor`。
3. `Q4t` 先用最新回合游标（首次为 null）请求 thread/turns/list，再为每个回合请求 thread/items/list，但消息查询使用上述缓存快照游标。
4. 当新回合在快照之后时，回合列表可见，消息却被旧边界排除。空页且 nextCursor=null 还会被标记为 itemsView=full。
5. `pJi` 直接映射返回的 items，没有在工具结果中暴露“快照可能过期”的提示。

这条路径可以解释“发送成功、状态完成、旧消息可读、新消息为空”，也能解释为何本地任务有同样表现。

## 最小复现

从已安装包提取实际 `PS`/`Q4t` 函数，在隔离 Node VM 中配合假数据接口执行，没有运行整个应用包：

- 历史消息 ordinal=90，新消息 ordinal=110，缓存快照上界=100。
- 使用缓存游标：旧回合 1 条，新回合 0 条，后者被标记 full。
- 同一函数改传 cursor=null：旧回合 1 条，新回合 1 条。

这是实际客户端函数加模拟服务的单元级复现，不是远程游标抓包。另有上节真实本地接口 24 对 0 的独立证据。

## 建议修复方向（未实施）

- 跨任务结果查询应以新的消息分页起点读取最新回合，不继承界面历史加载的旧快照边界。
- 界面恢复历史时仍应保留快照与实时事件合并规则，不能全局粗暴移除所有游标。
- 对已有完成状态或实时输出证据却返回空内容的回合，应作新鲜读取或明确标记内容未取得，不能默认为完整空记录。
- 同时回归 read_thread 与 wait_threads：已加载/未加载、本地/SSH、恢复前旧回合/恢复后新回合、分页和长输出。
- 不修改 Exercise App 或 PostgreSQL 来规避客户端问题；若修改安装包、更新客户端或重启客户端，需要作为单独的修复操作处理。

## 其他排障记录

- 文档示例的 `/Applications/Codex.app` 在本机不存在，改按 command -v codex 定位实际 ChatGPT.app。
- 默认 app-server proxy 控制 socket 不存在，没有创建或修改 socket。
- 独立 stdio 诊断首次被沙箱限制初始化本机状态库；受控授权后仅执行上述只读 RPC 成功。
- 曾请求远程通过正式 send_message_to_thread 反向回报；回合已结束但本任务未收到报告，不能宣称反向通道已恢复。
- 本轮不再尝试被禁止的 Codex 自身界面自动化，也没有通过其他 UI 技术绕过限制。

参考：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。诊断采用 OpenAI Docs 的接口核对流程，证据与不确定性按 planning-with-files 留存。
