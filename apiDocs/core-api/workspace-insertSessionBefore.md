# workspace.insertSessionBefore

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `insertSessionBefore`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('insertSessionBefore')，委托至 WorkspaceCommands.insertSessionBefore）
- 功能说明: 在某个 Workspace 的记账 Session 列表中移动一个 Session（DOM insertBefore 语义），返回更新后的 Workspace 投影。

## 入参 (Request / Input)
请求类型：`WorkspaceInsertSessionBeforeRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `WorkspaceId` | 是 | 所属 Workspace 标识。 |
| `sessionId` | `SessionId` | 是 | 被移动的已记账 Session 标识。 |
| `beforeSessionId` | `SessionId` | 否 | 锚点 Session；省略表示追加到该 Workspace 的 Session 列表末尾。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace` | `WorkspaceView` | 变更后完整的 Workspace 投影（含更新后的 `sessionIds` 顺序）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/index.ts:124`（`insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)`）→ `packages/api/workspace-controller/src/client/service.ts:119`（`WorkspaceController.insertSessionBefore` → 返回 `WorkspaceView`）→ `packages/api/workspace-controller/src/client/model.ts:159`（`ClientWorkspaceModel.insertSessionBefore` → `this.remote.insertSessionBefore({ workspaceId, sessionId, ...beforeSessionId? })`）。
- 调用方式: `const result = await this.remote.insertSessionBefore({ workspaceId, sessionId, beforeSessionId? })`（返回 `RemoteResult<WorkspaceValue>`）。
- 入参构造: UI 行级 Session 排序 `insertSessionBefore(workspaceId, sessionId, beforeSessionId)`。
- 响应/流处理: `result.ok` 时 `ClientWorkspaceModel` 立即 `upsert(result.value.workspace)`；`updatedAt` 较旧的流/一元增量会被忽略，避免乱序覆盖。UI 通过 `useWorkspaces` 快照刷新该 Workspace 的 `sessionIds` 顺序。
- 错误处理: 失败封装 `{ ok: false, error }`，`WorkspaceController.insertSessionBefore` 抛出 `commandError('move', ...)`。可能错误码：`workspace-not-found`(workspaceId)、`session-not-found`(sessionId)、`workspace-move-invalid`(workspaceId/sessionId/beforeSessionId)、`bad-request`。
