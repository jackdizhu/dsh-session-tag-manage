# session.follow

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `follow`
- 调用模式 (Mode): 流式调用 (stream)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote({ mode: 'stream' })`）、`packages/api/session-controller/src/history.ts`（`follow()`）
- 功能说明: 从开场（或恢复游标）开始跟随某个会话日志，先返回完整的开场快照，再推送无空洞的事件帧。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `address` | `SessionAddress` | 是 | 持久化地址：`{ kind: 'session'; sessionId }` 或 `{ kind: 'subagent'; parentSessionId; childSessionId; mode }`。 |
| `maxMessages?` | `number` | 否 | 开场快照最大消息数（正整数，默认 50）。 |

## 出参 (Response / Output)
- 返回类型: `AsyncIterable<SessionFollowFrame>`（生成客户端为 `AsyncIterator`/流订阅）
- 逐帧推送以下结构（`SessionFollowFrame` 为联合类型）：
| 帧 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `snapshot`（开场，恰一次） | `type` | `'snapshot'` | 标记。 |
| | `header` | `SessionHeader` | 会话头。 |
| | `cursor` | `number` | 开场日志序号（用于后续 `page` 的 `throughSeq`）。 |
| | `records` | `readonly SessionHistoryRecord[]` | 开场记录（消息对齐）。 |
| | `hasMore` | `boolean` | 开场快照外是否还有更早消息。 |
| | `projections` | `SessionProjectionBaseline` | 投影基线（`asOfSeq` + `values`）。 |
| `event`（逐条增量） | `type` | `'event'` | 标记。 |
| | `event` | `SessionWireEvent` | 单条追加事件（`type`/`seq`/`time`/`data`/`sourceEventSeqs?`/`surfaceOp?`）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 经生成客户端 `ctx.sessionRemote.follow(sessionId, signal)` 消费（测试见 `connection/tests/fixture.client.spec.ts:861,917,973,1200,1516,1571`）；由会话连接/商店层（sessions store）建立，用于驱动实时 transcript 与列表/投影状态。业务组件通过 `SessionFace` 的 `loadOlder`/快照订阅间接消费其 `snapshot` 与 `event` 帧。
- 调用方式: 流端点，返回 `AsyncIterable`/`AsyncIterator`；生成客户端在 `ctx.sessionRemote.follow(address, abortSignal)` 暴露，供连接层按需订阅与重连。
- 入参构造: `address`（来自当前 `sessionId` 或子 agent 三元组）+ `AbortSignal`（流取消由 Remote 载体拥有）。
- 响应/流处理: 首帧 `snapshot` 用于初始化/补齐 transcript 与 `cursor`；后续 `event` 帧按 `seq` 顺序无空洞地追加到消息列表与各类投影；`snapshot` 中普通会话且为 prepared 来源时会触发 Host 侧 Agent 激活（promotion）。
- 错误处理: 传输/中止表现为 `TypertRemoteFailure`（`cancelled` 等）；Host 端逻辑错误含 `session-not-found`/`subagent-not-found`、子 agent 鉴权（`subagent-unauthorized`/`subagent-catalog-diagnostic`）、`agent-busy`、`internal`（seq 跳号）。流异常由连接层统一处理并触发重连。
