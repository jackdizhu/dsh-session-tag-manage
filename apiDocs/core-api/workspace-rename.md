# workspace.rename

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `rename`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('rename')，委托至 WorkspaceCommands.rename）
- 功能说明: 将某个 Workspace 重命名为唯一且非空的标题，返回更新后的 Workspace 投影。

## 入参 (Request / Input)
请求类型：`WorkspaceRenameRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `WorkspaceId` | 是 | 目标 Workspace 标识。 |
| `title` | `string` | 是 | 新的用户可见标题（需唯一、非空，前后空白会被规整）。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace` | `WorkspaceView` | 改名后完整的 Workspace 投影。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/index.ts:118`（`renameWorkspace: async (workspaceId, title) => workspaces.rename(workspaceId, title)`）→ `packages/api/workspace-controller/src/client/service.ts:98`（`WorkspaceController.rename`）→ `packages/api/workspace-controller/src/client/model.ts:101`（`ClientWorkspaceModel.rename` → `this.remote.rename({ workspaceId, title })`）。
- 调用方式: `const result = await this.remote.rename({ workspaceId, title })`（返回 `RemoteResult<WorkspaceValue>`）。
- 入参构造: UI 行级操作 `renameWorkspace(workspaceId, title)`；标题来自用户重命名对话框（`WorkspaceBrowser.tsx` 中 `t('rename.workspace.title')`）。
- 响应/流处理: `result.ok` 时 `ClientWorkspaceModel` 立即 `upsert(result.value.workspace)` 合并本地投影；`updatedAt` 较旧的增量会被忽略以避免乱序覆盖。UI 通过 `useWorkspaces` 快照刷新标题。
- 错误处理: 失败封装 `{ ok: false, error }`，`WorkspaceController.rename` 抛出 `commandError('rename', ...)`，UI 捕获后提示。可能错误码：`workspace-not-found`(workspaceId)、`workspace-name-conflict`(name)、`bad-request`。
