# workspace.session.tag

## 接口 (Interface)
- 命名空间 (Namespace): `dsh-session-tag-manage`
- 方法名 (Method): `workspace.session.tag`
- 路由 (Route): `/dsh-session-tag-manage/workspace.session.tag`
- 调用模式 (Mode): 一元调用 (unary) / HTTP POST（服务端内部会触发对内置 `session.history` 的多页 RPC 调用）
- 来源文件:
  - 服务端：`packages/dsh-session-host/src/index.ts`（注册 `WORKSPACE_SESSION_TAG_ROUTE` 处理器）、`packages/dsh-session-host/src/contract.ts`（`WORKSPACE_SESSION_TAG_ROUTE` / `WorkspaceSessionTagRequest` / `WorkspaceSessionTagResponse` / `SessionEventTagItem`）、`packages/dsh-session-host/src/utils/session-history.ts`（`fetchAllSessionEvents` / `foldStats` / `extractUserMessages` / `extractAssistantMessages` / `extractAssistantThinking` / `extractFileOperations` / `extractSessionTitle` / `splitTurns` / `classifyRoundEndReason`）、`packages/dsh-session-host/src/utils/rpc-client.ts`（`dshRpcCall`）
  - 客户端：`packages/dsh-session-client/src/utils/tag-api.ts`（`fetchWorkspaceSessionTag`）、`packages/dsh-session-client/src/index.ts`（canvas 点击调用）
- 功能说明: 按会话 ID 查询其「事件数据标签」统计：轮次、用户/助手消息数、工具调用统计、**用户真实提问文本与 LLM(助手)返回文本**、写文件操作路径、活动起止时间等。Host 端通过 `dshRpcCall('session.history')` 分页拉取该会话全部事件流，按 `turn/start` 边界切分为多个轮次段，**逐轮**折叠整理后返回 `SessionEventTagItem[]`（每 turn 一条，每条含本轮的用户原话与助手原话「问—答」闭环）。

## 入参 (Request / Input)
请求体支持两种格式（host `parseRpcEnvelope` 兼容）：
1. DSH RPC 信封：`{ type: 'client-request', rpcId, method: 'workspace.session.tag', payload: { sessionId, maxMessages } }`
2. 简单 JSON：直接 `{ sessionId, maxMessages }`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `string` | 是 | 目标会话 ID。缺失返回 `400` `session-id-required`。 |
| `maxMessages` | `number` | 否 | 单页最大消息数，默认 `200`（host 端 `?? 200`；`fetchAllSessionEvents` 默认 `maxMessages=200`，总事件上限默认 `10000`）。 |

## 出参 (Response / Output)
- 返回类型：`WorkspaceSessionTagResponse`，成功数据位于 `value.items`（`SessionEventTagItem[]`，按 `turn/start` 切分，每 turn 一条）；`value.hasMore` 描述会话事件流分页边界。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 请求是否成功。 |
| `value.hasMore` | `boolean` | 会话事件流是否还有更早的分页未读完。 |
| `value.items[]` | `SessionEventTagItem[]` | 按 turn 切分的条目数组（顺序即轮次顺序）。 |
| `value.items[].sessionId` | `string` | 会话 ID。 |
| `value.items[].title` | `string \| null` | 会话标题（取最新 `session/title` 事件，回退到 `foldStats` 的 title）。 |
| `value.items[].round` | `number` | 轮次序号（1-based，取自 `turn/start.data.turn`；纯前导段为 0）。 |
| `value.items[].endReason` | `string` | 本轮结束/异常原因：`completed`/`aborted`/`error`/`interrupted`/`max-tokens`/`blocked`/`ongoing`/`seed`。 |
| `value.items[].turns` | `number` | 轮次数（该段内 `turn/start` 计数：单 turn 段为 1，纯前导 seed 段为 0）。 |
| `value.items[].userMessages` | `number` | 用户真实提问数（仅 `source.kind==='user'` 的 `user/message`）。 |
| `value.items[].assistantMessages` | `number` | 助手消息数（`assistant/message`）。 |
| `value.items[].toolCalls` | `Array<{ name: string; count: number }>` | 工具调用统计，按调用次数降序。 |
| `value.items[].userMessageTexts` | `string[]` | 用户真实提问文本列表。 |
| `value.items[].assistantMessageTexts` | `string[]` | LLM(助手)的**最终回答**文本列表（**真实事件中文本嵌套在 `assistant/message`.`data.message.content`**，抽取 `content.type==='text'` 的片段，排除 `reasoning` 与过程独白；同消息内多个 text 块以 `\n` 合并为 1 条）。⚠️ **仅取 segment 内「最后一个、其后不再跟随任何 `tool/call`」的 assistant/message 的 text**（即整轮收尾、模型停止前的回答）；真实会话里 assistant 的「过程独白」与「最终回答」常混在同为 `type==='text'` 的块中，光靠块类型无法区分，故以事件顺序判定。若整轮以 `tool/call` 收尾、无收尾回答，则为**空数组**。过程独白统一归入 `assistantThinkTexts`。 |
| `value.items[].assistantThinkTexts` | `string[]` | LLM(助手)**思考过程**（与 `assistantMessageTexts` 双轨、互不重叠）：按事件顺序收集 (a) `assistant/message` 中 `content.type==='reasoning'` 的思考文本（每消息合并为 1 条），(b) `assistant/message` 中**非最终回答**的 `type==='text'` 片段（过程独白，如 "Now let me verify the composition boot-free…"），(c) `tool/call` 事件 → `调用工具 <name>（<input摘要>）`；**完整思考过程**包含推理、过程独白与工具决策，无思考内容时为空数组。 |
| `value.items[].fileOperations` | `string[]` | 写文件操作路径列表（`write_file`/`edit`/`write` 工具，去重）。 |
| `value.items[].startedAt` | `number \| null` | 活动开始时间（epoch ms，取该段最早事件时间）。 |
| `value.items[].updatedAt` | `number \| null` | 活动结束时间（epoch ms，取该段最晚事件时间）。 |
| `value.items[].totalEvents` | `number` | 该段事件总数。 |
| `error` | `string` | 失败时的错误码（见下）。 |

**错误码**：`method-not-allowed`（非 POST，405）、`session-id-required`（400）、`history-fetch-failed: <reason>`（500，内部 `session.history` 调用失败）、`session-tag-query-failed`（500，其它异常）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `packages/dsh-session-client/src/index.ts` canvas 点击事件处理器——当 `sessionCurrent` 存在时，经 `fetchWorkspaceSessionTag(sessionCurrent)`（`tag-api.ts`）发起。
- 调用方式: `const sessionTagResult = await fetchWorkspaceSessionTag(sessionId, maxMessages?)`，返回 `TagApiResult<WorkspaceSessionTagValue>`（`{ ok, value: { items, hasMore }, rpcId }` 或 `{ ok: false, error, rpcId }`）。
- 入参构造: `sessionId` 来自 `getCurrentSessionId(ctx)`，即 `ctx.sessions.selection.getSnapshot().sessionId`；`maxMessages` 不传（走服务端默认 200）。
- 响应/流处理: `tagApiPost` 自动兼容标准信封与简单 JSON 两种响应，校验 `rpcId`；成功后 `sessionTagResult.value.items` 为 `SessionEventTagItem[]`。
- 错误处理: 同 `workspace.list.tag`——失败以 `{ ok: false, error }` 返回，不直接抛异常（HTTP 错误 `http-<status>`，网络错误 `network-error`）。
- 业务落点: 当前仅 `console.log` 打印结果（`[SessionTag] workspace.session.tag 结果:`），未渲染到 UI。
- 内部链路（服务端）: `workspace.session.tag` 处理器 → `fetchAllSessionEvents(dshBaseUrl, sessionId, { maxMessages })`（`dshBaseUrl = http://127.0.0.1:${DSH_WEB_PORT ?? 3080}`）→ 循环 `dshRpcCall('session.history')` 按 `beforeSeq` 向前翻页（含 `seq` 去重、最多 10000 事件）→ `splitTurns` 按 `turn/start` 切分为轮次段 → 对**每段**调用 `foldStats` / `extractUserMessages` / `extractAssistantMessages` / `extractAssistantThinking` / `extractFileOperations` / `extractSessionTitle` 及 `classifyRoundEndReason` → 逐段组装 `SessionEventTagItem`，汇总为 `items` 数组（含 `hasMore`）回传。
