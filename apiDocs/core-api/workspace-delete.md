# workspace.delete

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `delete`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('delete')，委托至 WorkspaceCommands.delete）
- 功能说明: 删除一个 Workspace 注册，但保留其下的文件与 Session（仅移除注册行）。

## 入参 (Request / Input)
请求类型：`WorkspaceDeleteRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `WorkspaceId` | 是 | 待删除的 Workspace 标识。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceDeleteValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `deleted` | `true` | 删除确认常量（仅成功时返回，值为字面量 `true`）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/index.ts:119`（`deleteWorkspace: async (workspaceId) => workspaces.delete(workspaceId)`）→ `packages/api/workspace-controller/src/client/service.ts:104`（`WorkspaceController.delete`，返回 `Promise<void>`）→ `packages/api/workspace-controller/src/client/model.ts:112`（`ClientWorkspaceModel.delete` → `this.remote.delete({ workspaceId })`）。
- 调用方式: `const result = await this.remote.delete({ workspaceId })`（返回 `RemoteResult<WorkspaceDeleteValue>`）。
- 入参构造: UI 行级操作 `deleteWorkspace(workspaceId)` 直接传入标识。
- 响应/流处理: `result.ok` 时 `ClientWorkspaceModel.delete` 立即 `remove(workspaceId, true)` 从本地投影移除（`immediate=true` 强制同步失效），并登记到 `removedIds` 集合以防止后续延迟的流增量"复活"已删除行。UI 通过 `useWorkspaces` 快照消失该行。
- 错误处理: 失败封装 `{ ok: false, error }`，`WorkspaceController.delete` 抛出 `commandError('delete', ...)`。可能错误码：`workspace-not-found`(workspaceId)、`bad-request`。
