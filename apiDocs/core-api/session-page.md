# session.page

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `page`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('page')`）、`packages/api/session-controller/src/history.ts`（`page()`）
- 功能说明: 读取一个冷安全、按消息对齐的会话历史分页（向后翻页），无需恢复 Agent；返回一页按时间顺序的记录。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `address` | `SessionAddress` | 是 | 持久化地址：<br>`{ kind: 'session'; sessionId }`<br>或 `{ kind: 'subagent'; parentSessionId; childSessionId; mode: 'one-shot'\|'continuable' }`。 |
| `throughSeq` | `number` | 是 | 包含的上界日志序号，取自对应 `follow` 开场帧的 `cursor`（允许 `-1` 表示空）。 |
| `beforeSeq?` | `number` | 否 | 上界之前的截断点（非负整数，用于逐页回溯）。 |
| `maxMessages?` | `number` | 否 | 每页最大消息数（正整数，默认 50）。 |

## 出参 (Response / Output)
- 返回类型: `SessionPage`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `records` | `readonly SessionHistoryRecord[]` | 本页记录数组，元素为 `SessionEventEntry`（`{ type:'event'; event }`）或 `SessionChunkRun`（`{ type:'chunks'; event }`，打包后的 assistant delta）。 |
| `hasMore` | `boolean` | 是否还有更早的消息可继续回溯。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 经生成客户端 `ISessions`/`SessionFace` 的 `history(...)`（底层映射 `session.page`）；由 `ui-conversation` 的 `ConversationController.loadOlder()` → `SessionFace.loadOlder()` 驱动（`ui-conversation/src/client/service.ts:332`、`ui-chat/src/client/apply.ts:127` `loadOlder` 注入）。
- 调用方式（推断）: `session.history({ sessionId, throughSeq, beforeSeq?, maxMessages? })`（生成客户端返回 `RemoteResult<SessionPage>`，方法名 `history` 对应 Remote `page`）。
- 入参构造: `address` 取当前 `sessionId`；`throughSeq` 来自已持有的 `follow` 开场 `cursor`；`maxMessages` 默认 50；`beforeSeq` 为上一页上界用于继续回溯。
- 响应/流处理: 追加到会话快照的更早消息列表中，向上滚动时动态加载；`hasMore` 控制是否展示「加载更早」。
- 错误处理: Host 端可能抛 `TypertRemoteFailure`：`bad-request`（`throughSeq`/`beforeSeq`/`maxMessages` 校验失败或越界）、`session-not-found`/`subagent-not-found`、子 agent 鉴权错误、`internal`。以 `{ ok: false, error }` 返回；测试见 `connection/tests/fixture.client.spec.ts`（`api.sessions.history`）。
