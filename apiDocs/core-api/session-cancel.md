# session.cancel

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `cancel`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('cancel')`）、`packages/api/session-controller/src/commands.ts`（`cancel()`）
- 功能说明: 取消某个活跃 Agent 的当前 turn，但保留其待处理 inbox（队列）内容；返回取消请求已被受理的回执。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 取消其活跃 turn 的目标会话标识（Agent 必须已挂载）。 |

## 出参 (Response / Output)
- 返回类型: `SessionCancelValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `accepted` | `true` | 取消请求已提交给活跃 Agent 的确认常量。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-conversation/src/client/service.ts:327`（`ConversationController.cancel()`）。
- 调用方式: `const result = await session.cancel();`（生成客户端 `SessionFace.cancel`，返回 `RemoteResult<SessionCancelValue>`；`session` 由 scope-addressed `scopedSession('cancel')` 解析）。
- 入参构造: 仅需当前会话 scope 的 `sessionId`（scope 内自动解析，无需显式传参）。
- 响应/流处理: 成功后 Agent 触发取消，运行态经 `api-session/status` 与 `session.control` 流的 `queue`/`jobs` 帧刷新；失败与 `send` 一致写入 `promptError` 快照并 `throw`，composer 据此恢复。
- 错误处理: 常见失败码：`session-not-found`（Agent 未挂载）、子 agent 所有权错误。以 `{ ok: false, error: { code, message } }` 返回（`conversation.cancel failed: <code>: <message>`）。
