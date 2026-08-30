# workspace.tag.set

## 接口 (Interface)
- 命名空间 (Namespace): `dsh-session-tag-manage`
- 方法名 (Method): `workspace.tag.set`
- 路由 (Route): `/dsh-session-tag-manage/workspace.tag.set`
- 调用模式 (Mode): 一元调用 (unary) / HTTP POST
- 来源文件:
  - 服务端：`packages/dsh-session-host/src/index.ts`（注册 `WORKSPACE_TAG_SET_ROUTE` 处理器）、`packages/dsh-session-host/src/contract.ts`（`WORKSPACE_TAG_SET_ROUTE` / `WorkspaceTagSetRequest` / `WorkspaceTagSetResponse`）、`packages/dsh-session-host/src/utils/file-storage.ts`（`writeWorkspaceTags` / `deleteWorkspaceFile`）
- 功能说明: 全量覆盖写入某工作区的会话标签条目（`SessionTagEntry[]`）。当 `deleteWorkspace === true` 且 `sessions` 为空数组时，删除整个工作区存储文件（而非写入）。

## 入参 (Request / Input)
请求体支持两种格式（host `parseRpcEnvelope` 兼容）：
1. DSH RPC 信封：`{ type: 'client-request', rpcId, method: 'workspace.tag.set', payload: { workspaceId, sessions, deleteWorkspace } }`
2. 简单 JSON：直接 `{ workspaceId, sessions, deleteWorkspace }`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `string` | 是 | 目标工作区 ID。缺失返回 `400` `workspace-id-required`。 |
| `sessions` | `SessionTagEntry[]` | 是 | 全量覆盖的会话标签条目数组。缺失或非数组返回 `400` `sessions-array-required`。 |
| `deleteWorkspace` | `boolean` | 否 | 仅当为 `true` **且** `sessions` 为空数组时，删除该工作区文件；否则忽略，执行普通写入。 |

> `SessionTagEntry` 结构：{ `sessionId`: string, `title`: string, `sessionCurrentTag`: string, `createdAt`: string, `updatedAt`: string }。

## 出参 (Response / Output)
- 返回类型：`WorkspaceTagSetResponse`
- 同样支持 RPC 信封 / 简单 JSON 两种包装（host `rpcResponse`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 请求是否成功。 |
| `value.count` | `number` | 写入的条目数（恒等于 `sessions.length`）。删除场景下也会返回 `sessions.length`(=0)。 |
| `error` | `string` | 失败时的错误码（见下）。 |

**错误码**：`method-not-allowed`（非 POST，405）、`workspace-id-required`（400）、`sessions-array-required`（400）、`storage-write-failed`（500，写入/删除异常）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: **当前客户端未提供对 `workspace.tag.set` 的调用封装**——`packages/dsh-session-client/src/utils/tag-api.ts` 仅导出了 `fetchWorkspaceListTag` 与 `fetchWorkspaceSessionTag` 两个读取型 API，没有对应的写入函数；`client/src/index.ts` 也未调用该接口。
- 结论: 该接口为「保留/待接入」的写入端点，服务端已完整实现（全量覆盖 + 可选删除工作区），但 web 端暂无消费点。如需在浏览器侧写入标签，应在 `tag-api.ts` 新增类似 `setWorkspaceTags(workspaceId, sessions, deleteWorkspace?)` 的函数（复用 `tagApiPost` 信封机制）并接入 UI。
- 协议兼容性: 一旦客户端接入，须按 `tagApiPost` 构造 `{ type: 'client-request', rpcId, method: 'workspace.tag.set', payload }` 信封；服务端会回以带相同 `rpcId` 的响应。
