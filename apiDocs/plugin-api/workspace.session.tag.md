# workspace.session.tag

## 接口 (Interface)
- 命名空间 (Namespace): `dsh-session-tag-manage`
- 方法名 (Method): `workspace.session.tag`
- 路由 (Route): `/dsh-session-tag-manage/workspace.session.tag`
- 调用模式 (Mode): 一元调用 (unary) / HTTP POST（服务端内部会触发对内置 `session.history` 的多页 RPC 调用）
- 来源文件:
  - 服务端：`packages/dsh-session-host/src/index.ts`（注册 `WORKSPACE_SESSION_TAG_ROUTE` 处理器）、`packages/dsh-session-host/src/contract.ts`（`WORKSPACE_SESSION_TAG_ROUTE` / `WorkspaceSessionTagRequest` / `WorkspaceSessionTagResponse` / `SessionEventTagItem`）、`packages/dsh-session-host/src/utils/session-history.ts`（`fetchAllSessionEvents` / `foldStats` / `extractUserMessages` / `extractFileOperations` / `extractSessionTitle`）、`packages/dsh-session-host/src/utils/rpc-client.ts`（`dshRpcCall`）
  - 客户端：`packages/dsh-session-client/src/utils/tag-api.ts`（`fetchWorkspaceSessionTag`）、`packages/dsh-session-client/src/index.ts`（canvas 点击调用）
- 功能说明: 按会话 ID 查询其「事件数据标签」统计：轮次、用户/助手消息数、工具调用统计、用户真实提问文本、写文件操作路径、活动起止时间等。Host 端通过 `dshRpcCall('session.history')` 分页拉取该会话全部事件流，再用工具函数折叠整理后返回单条 `SessionEventTagItem`。

## 入参 (Request / Input)
请求体支持两种格式（host `parseRpcEnvelope` 兼容）：
1. DSH RPC 信封：`{ type: 'client-request', rpcId, method: 'workspace.session.tag', payload: { sessionId, maxMessages } }`
2. 简单 JSON：直接 `{ sessionId, maxMessages }`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `string` | 是 | 目标会话 ID。缺失返回 `400` `session-id-required`。 |
| `maxMessages` | `number` | 否 | 单页最大消息数，默认 `200`（host 端 `?? 200`；`fetchAllSessionEvents` 默认 `maxMessages=200`，总事件上限默认 `10000`）。 |

## 出参 (Response / Output)
- 返回类型：`WorkspaceSessionTagResponse`，成功数据位于 `value.item`（`SessionEventTagItem`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 请求是否成功。 |
| `value.item.sessionId` | `string` | 会话 ID。 |
| `value.item.title` | `string \| null` | 会话标题（取最新 `session/title` 事件，回退到 `foldStats` 的 title）。 |
| `value.item.turns` | `number` | 轮次数（`turn/start` 计数）。 |
| `value.item.userMessages` | `number` | 用户真实提问数（仅 `source.kind==='user'` 的 `user/message`）。 |
| `value.item.assistantMessages` | `number` | 助手消息数（`assistant/message`）。 |
| `value.item.toolCalls` | `Array<{ name: string; count: number }>` | 工具调用统计，按调用次数降序。 |
| `value.item.userMessageTexts` | `string[]` | 用户真实提问文本列表（取 `content` 中 `type==='text'` 的片段）。 |
| `value.item.fileOperations` | `string[]` | 写文件操作路径列表（`write_file`/`edit`/`write` 工具的 `file_path`/`path`，去重）。 |
| `value.item.startedAt` | `number \| null` | 活动开始时间（epoch ms，取最早事件时间）。 |
| `value.item.updatedAt` | `number \| null` | 活动结束时间（epoch ms，取最晚事件时间）。 |
| `value.item.totalEvents` | `number` | 事件总数。 |
| `value.item.hasMore` | `boolean` | 是否还有更早的事件未读完（分页边界指示）。 |
| `error` | `string` | 失败时的错误码（见下）。 |

**错误码**：`method-not-allowed`（非 POST，405）、`session-id-required`（400）、`history-fetch-failed: <reason>`（500，内部 `session.history` 调用失败）、`session-tag-query-failed`（500，其它异常）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `packages/dsh-session-client/src/index.ts` canvas 点击事件处理器——当 `sessionCurrent` 存在时，经 `fetchWorkspaceSessionTag(sessionCurrent)`（`tag-api.ts`）发起。
- 调用方式: `const sessionTagResult = await fetchWorkspaceSessionTag(sessionId, maxMessages?)`，返回 `TagApiResult<WorkspaceSessionTagValue>`（`{ ok, value: { item }, rpcId }` 或 `{ ok: false, error, rpcId }`）。
- 入参构造: `sessionId` 来自 `getCurrentSessionId(ctx)`，即 `ctx.sessions.selection.getSnapshot().sessionId`；`maxMessages` 不传（走服务端默认 200）。
- 响应/流处理: `tagApiPost` 自动兼容标准信封与简单 JSON 两种响应，校验 `rpcId`；成功后 `sessionTagResult.value.item` 为 `SessionEventTagItem`。
- 错误处理: 同 `workspace.list.tag`——失败以 `{ ok: false, error }` 返回，不直接抛异常（HTTP 错误 `http-<status>`，网络错误 `network-error`）。
- 业务落点: 当前仅 `console.log` 打印结果（`[SessionTag] workspace.session.tag 结果:`），未渲染到 UI。
- 内部链路（服务端）: `workspace.session.tag` 处理器 → `fetchAllSessionEvents(dshBaseUrl, sessionId, { maxMessages })`（`dshBaseUrl = http://127.0.0.1:${DSH_WEB_PORT ?? 3080}`）→ 循环 `dshRpcCall('session.history')` 按 `beforeSeq` 向前翻页（含 `seq` 去重、最多 10000 事件）→ 对合并后的事件调用 `foldStats` / `extractUserMessages` / `extractFileOperations` / `extractSessionTitle` → 组装 `SessionEventTagItem` 回传。
