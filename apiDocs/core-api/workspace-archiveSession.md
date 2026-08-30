# workspace.archiveSession

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `archiveSession`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('archiveSession')，委托至 WorkspaceCommands.archiveSession）
- 功能说明: 在某个 Workspace 分组界面中隐藏一个已知 Session，返回完整的归档 Session 集合。

## 入参 (Request / Input)
请求类型：`WorkspaceArchiveSessionRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 待归档（从分组界面隐藏）的 Session 标识。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceArchiveValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `archivedSessionIds` | `readonly SessionId[]` | 变更后完整的已归档 Session 集合（Host 顺序）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/index.ts:123`（`archiveSession: async (sessionId) => uiWorkspace.archiveSession(sessionId)`）→ `packages/client/ui-workspace/src/client/navigation.ts:136`（`UiWorkspaceService.archiveSession` → `this.workspaces.archiveSession(sessionId)`）→ `packages/api/workspace-controller/src/client/service.ts:114`（`WorkspaceController.archiveSession`，返回 `Promise<void>`）→ `packages/api/workspace-controller/src/client/model.ts:178`（`ClientWorkspaceModel.archiveSession` → `this.remote.archiveSession({ sessionId })`）。
- 调用方式: `const result = await this.remote.archiveSession({ sessionId })`（返回 `RemoteResult<WorkspaceArchiveValue>`）。
- 入参构造: UI 行级操作 `archiveSession(sessionId)`；`UiWorkspaceService` 在归档后还会于 `clearArchivedCurrent()` 中若当前选中 Session 被归档则 `sessions.clear()` 清空选择。
- 响应/流处理: `result.ok` 时 `ClientWorkspaceModel.archiveSession` 立即 `installArchived(result.value.archivedSessionIds)` 安装完整归档集（与既有集合无差异则跳过）。UI 通过 `useWorkspaces` 快照的 `archivedSessionIds` 隐藏对应行；若当前选中项在归档集中，`watchNavigation` 的 `clearArchivedCurrent` 会清除选择。
- 错误处理: 失败封装 `{ ok: false, error }`，`WorkspaceController.archiveSession` 抛出 `commandError('session archive', ...)`。可能错误码：`session-not-found`(sessionId)、`bad-request`。
