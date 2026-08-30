# session.control

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `control`
- 调用模式 (Mode): 流式调用 (stream)（无请求体）
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote({ mode: 'stream' })`）、`packages/api/session-controller/src/control.ts`（`control()`）
- 功能说明: 流式推送一份完整的 Host 级实时控制基线，随后推送队列/任务/投影的增量替换帧，供客户端维持全局实时控制态。

## 入参 (Request / Input)
无（一元/流调用，无请求体）。

## 出参 (Response / Output)
- 返回类型: `AsyncIterable<SessionControlFrame>`（生成客户端为 `AsyncIterator`/流订阅）
- 逐帧推送以下联合结构（`SessionControlFrame`）：
| 帧 | 字段 | 类型 | 说明 |
|---|---|---|---|
| `baseline`（每代恰一次） | `type` | `'baseline'` | 标记。 |
| | `value` | `SessionControlBaseline` | 完整基线：`queues`（按 SessionId 的待处理项）、`jobs`（按 SessionId 的后台任务）、`projections`（按 SessionId 的投影基线）。 |
| `queue` | `type` | `'queue'` | 标记。 |
| | `sessionId` | `SessionId` | 变更的会话。 |
| | `items` | `readonly SessionQueuedItem[]` | 该会话最新待处理队列项（含 `id`/`placement`/`rpcId?`/`message`）。 |
| `jobs` | `type` | `'jobs'` | 标记。 |
| | `sessionId` | `SessionId` | 变更的会话。 |
| | `jobs` | `readonly SessionJob[]` | 该会话后台任务（`id`/`kind`/`label`/`status`/`detail?`/`startedAt`/`finishedAt?`）。 |
| `projection` | `type` | `'projection'` | 标记。 |
| | `sessionId` | `SessionId` | 变更的会话。 |
| | `key` | `string` | 投影键。 |
| | `value` | `JsonValue` | 投影值。 |
| | `seq` | `number` | 投影水位序号。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 经生成客户端 `ctx.sessionRemote.control(signal)` 消费（测试见 `connection/tests/fixture.client.spec.ts:866,1206,1521`）；由会话连接/商店层（sessions store）订阅，为队列 dock、后台任务面板、模型选择当前态等提供全局实时数据。
- 调用方式: 流端点，返回 `AsyncIterable`/`AsyncIterator`；生成客户端在 `ctx.sessionRemote.control(abortSignal)` 暴露，连接建立后常驻订阅并随连接重置重连。
- 入参构造: 无请求体，仅需 `AbortSignal`（流取消由 Remote 载体拥有）。
- 响应/流处理: 首帧 `baseline` 一次性初始化全量 `queues`/`jobs`/`projections` 快照；后续 `queue`/`jobs`/`projection` 帧按 `sessionId` 做替换式更新，驱动 `useSessions` 选择器中 `queueBySession`/`jobsBySession`/投影相关字段的渲染（如 `ui-jobs` 的 `JobListAction` 读取 `jobsBySession`）。
- 错误处理: 传输/中止表现为 `TypertRemoteFailure`（`cancelled` 等）；流异常由连接层统一处理并触发重连，业务模块通过选择器读取最新快照，不直接抛错。
