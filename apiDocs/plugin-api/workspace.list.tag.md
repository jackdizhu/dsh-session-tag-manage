# workspace.list.tag

## 接口 (Interface)
- 命名空间 (Namespace): `dsh-session-tag-manage`
- 方法名 (Method): `workspace.list.tag`
- 路由 (Route): `/dsh-session-tag-manage/workspace.list.tag`
- 调用模式 (Mode): 一元调用 (unary) / HTTP POST
- 来源文件:
  - 服务端：`packages/dsh-session-host/src/index.ts`（注册 `WORKSPACE_LIST_TAG_ROUTE` 处理器）、`packages/dsh-session-host/src/contract.ts`（`WORKSPACE_LIST_TAG_ROUTE` / `WorkspaceTagQueryRequest` / `WorkspaceTagQueryResponse`）、`packages/dsh-session-host/src/utils/file-storage.ts`（`readWorkspaceTags`）
  - 客户端：`packages/dsh-session-client/src/utils/tag-api.ts`（`fetchWorkspaceListTag`）、`packages/dsh-session-client/src/index.ts`（canvas 点击调用）
- 功能说明: 按工作区 ID 查询其下所有会话标签条目（`SessionTagEntry` 列表）。存储文件不存在时自动创建空 JSON 文件并返回空列表。

## 入参 (Request / Input)
请求体支持两种格式（由 host `parseRpcEnvelope` 兼容）：
1. DSH RPC 信封：`{ type: 'client-request', rpcId, method: 'workspace.list.tag', payload: { workspaceId } }`
2. 简单 JSON：直接 `{ workspaceId: '...' }`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `string` | 是 | 目标工作区 ID。缺失时返回 `400` 错误码 `workspace-id-required`。 |

## 出参 (Response / Output)
- 返回类型：`WorkspaceTagQueryResponse`
- 若请求携带 `rpcId`，host 用标准信封包装：`{ type: 'server-response', rpcId, result: { ok, value/error } }`；否则返回简单 JSON `{ ok, value/error }`（rpc-client `rpcResponse`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | `boolean` | 请求是否成功。 |
| `value.items` | `SessionTagEntry[]` | 会话标签条目列表。每项含：`sessionId`(string)、`title`(string)、`sessionCurrentTag`(string)、`createdAt`(ISO8601 string)、`updatedAt`(ISO8601 string)。 |
| `error` | `string` | 失败时的错误码（见下）。 |

**错误码**：`method-not-allowed`（非 POST，405）、`workspace-id-required`（400）、`storage-read-failed`（500，读取异常）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `packages/dsh-session-client/src/index.ts` 中 canvas 点击事件处理器，经 `fetchWorkspaceListTag(folderActive ?? '')`（`tag-api.ts`）发起。
- 调用方式: `const tagResult = await fetchWorkspaceListTag(workspaceId)`，返回 `TagApiResult<WorkspaceListTagValue>`（`{ ok, value: { items }, rpcId }` 或 `{ ok: false, error, rpcId }`）。
- 入参构造: `folderActive` 由 `getActiveWorkspaceId(workspacesSnapshot.items, sessionCurrent)` 得到——先按当前会话 ID 在工作区列表中查找所属工作区的 `workspaceId`，找不到则降级取第一个工作区。该值即作为 `workspaceId` 传入。
- 响应/流处理: `tag-api.ts` 的 `tagApiPost` 自动兼容「标准信封」与「简单 JSON」两种响应格式，并校验 `rpcId` 一致性（`rpc-id-mismatch`）。成功后 `tagResult.value.items` 为标签列表。
- 错误处理: `fetchWorkspaceListTag` 不直接抛异常，失败时以 `{ ok: false, error }` 形式返回（HTTP 层错误形如 `http-<status>: <text>`，网络错误形如 `network-error: <msg>`）。
- 业务落点: 当前客户端仅将结果 `console.log` 打印（`[SessionTag] workspace.list.tag 结果:`），**尚未渲染到任何 UI 组件**，属于调试/探测用途。
