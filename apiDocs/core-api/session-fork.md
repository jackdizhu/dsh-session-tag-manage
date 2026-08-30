# session.fork

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `fork`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('fork')`）、`packages/api/session-controller/src/commands.ts`（`fork()`）
- 功能说明: 将某个已完成 turn 前缀（可锚定事件位置）派生为一个新会话，返回新会话标识。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 源会话标识。 |
| `atSeq?` | `number` | 否 | 可选事件锚点（非负整数）；缺省时取最后一个 `turn/end` 之后的边界。 |

## 出参 (Response / Output)
- 返回类型: `SessionForkValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `SessionId` | 新派生的子会话标识。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-workspace/src/client/index.ts:112`（`forkSession(sessionId)`）；`ui-chat/src/client/apply.ts:140`（`forkAt(seq)`）。
- 调用方式: `sessions.fork({ sessionId, increaseTitle: true })`（`ui-workspace`）或 `ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })`（`ui-chat`）。注意：生成客户端 `ISessions.fork` 暴露额外的客户端侧 `increaseTitle` 提示（子会话标题自增），其底层映射到 Remote `session.fork` 的 `{ sessionId, atSeq }` 请求体。
- 入参构造: 由源 `sessionId`（及可选 `atSeq` 来自 `forkAt`）组装；`increaseTitle` 为客户端层行为，不进入 wire 请求。
- 响应/流处理: 成功后 `sessions.open(childId)` 将当前视图切到新派生的子会话；fork 或子会话改名失败时被静默 catch，保留源视图不变。
- 错误处理: 常见失败码：`bad-request`（`atSeq` 非负整数校验失败）、`session-not-found`、`fork-unavailable`（无已完成 turn）、`workspace-attach-failed`、`internal`。以 `{ ok: false, error }` 形式由生成客户端返回，UI 在 `.catch` 中吞掉。
