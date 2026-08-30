# session.list

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `list`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('list')`）、`packages/api/session-controller/src/list.ts`
- 功能说明: 在不恢复任何 Agent 的前提下，读取所有可见（已挂载或已持久化）会话的摘要列表，按最近活动时间排序返回。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cursor` | `string` | 否 | 列表游标（预留字段，当前实现未分页截断，仅用于向后兼容）。 |

## 出参 (Response / Output)
- 返回类型: `SessionListValue`
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | `readonly SessionSummary[]` | 可见会话摘要数组，按 `updatedAt` 倒序。 |

`SessionSummary` 字段（来自 `types.ts`）：
| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `SessionId`（`string` 品牌类型） | 会话标识。 |
| `updatedAt` | `number` | 最近活动时间（取 `createdAt` 与最近一次用户 prompt 时间的最大值）。 |
| `running` | `boolean` | 是否正在运行（对应 Agent 状态为 running）。 |
| `blank` | `boolean` | 前缀是否不含任何 turn（冷会话未探测时可能为未知）。 |
| `parentSessionId?` | `SessionId` | 若为子 agent，则其父会话标识。 |
| `origin?` | `'subagent'` | 来源标记。 |
| `cwd?` | `string` | 会话工作目录。 |
| `projections?` | `SessionProjectionHints` | 缓存投影提示（部分、可能过期），含 `asOfSeq` 与 `values`。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 通过 `ctx.sessions.list`（生成客户端 `ISessions` 列表服务）在多个业务模块消费；例如 `ui-workspace/src/client/navigation.ts:101,117,166,194`、`ui-session/src/client/index.ts:259,355,509`、`ui-reference/src/client/index.ts:68`、`ui-agent-preset/src/client/index.ts:109,129`。
- 调用方式: `const result = await sessions.list();` 或 `sessions.list.getSnapshot()` / `sessions.list.subscribe(...)`。生成客户端将一元调用归一为 `RemoteResult<SessionListValue>`。
- 入参构造: 通常不传参（`cursor` 省略）。
- 响应/流处理: `sessions` 商店（连接/会话层）在连接建立或失效时调用 `session.list` 拉取 `items`，写入 `byId`/`current` 等快照字段；同时订阅 Host 事件 `api-session/added`、`api-session/removed`、`api-session/status`、`api-session/activity`（见 `index.ts` 构造函数）做增量更新，无需重新拉全量。UI 通过 `useSessions` 选择器渲染侧边栏/会话树。
- 错误处理: 失败以 `{ ok: false, error: { code, message } }` 形式返回（可能码：`internal`/`cancelled`）；传输层异常表现为 `TypertRemoteFailure`，由连接层统一处理并重试/置空。业务模块一般读取 `getSnapshot()` 的既存状态，不直接抛错。
