# workspace.insertBefore

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `insertBefore`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('insertBefore')，委托至 WorkspaceCommands.insertBefore）
- 功能说明: 在注册表显示顺序中移动某个 Workspace（DOM insertBefore 语义），返回完整的 Workspace 顺序。

## 入参 (Request / Input)
请求类型：`WorkspaceInsertBeforeRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId` | `WorkspaceId` | 是 | 被移动的 Workspace 标识。 |
| `beforeWorkspaceId` | `WorkspaceId` | 否 | 锚点 Workspace；省略表示追加到末尾。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceOrderValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspaceIds` | `readonly WorkspaceId[]` | 变更后完整的 Workspace 注册顺序。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/index.ts:120`（`insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => workspaces.insertBefore(workspaceId, beforeWorkspaceId)`）→ `packages/api/workspace-controller/src/client/service.ts:109`（`WorkspaceController.insertBefore`，返回 `Promise<void>`）→ `packages/api/workspace-controller/src/client/model.ts:124`（`ClientWorkspaceModel.insertBefore` → `this.remote.insertBefore({ workspaceId, ...beforeWorkspaceId? })`）。
- 调用方式: `const result = await this.remote.insertBefore({ workspaceId, beforeWorkspaceId? })`（返回 `RemoteResult<WorkspaceOrderValue>`）。
- 入参构造: UI 行级拖拽排序 `insertWorkspaceBefore(workspaceId, beforeWorkspaceId)`，`beforeWorkspaceId` 省略则追加。
- 响应/流处理（流/一元竞态解析）: 调用前 `ClientWorkspaceModel` 先乐观 `installOrder(本地重排)` 并自增 `orderRequestGeneration`；随后发起一元调用。返回时**仅当本请求代次与当前流代次均未被更新的后续请求/流覆盖**时，才用 `result.ok ? result.value.workspaceIds : this.committedOrder` 安装顺序（`committed=true`）。若一元调用抛错且代次未过期，则回滚到 `committedOrder`。流侧 `replaceOrder`（基线或 `order` 增量）会自增 `orderFrameGeneration` 并安装 Host 确认的顺序，从而让更晚的 Host 提交胜过更旧的一元回显。
- 错误处理: 失败封装 `{ ok: false, error }`，`WorkspaceController.insertBefore` 抛出 `commandError('reorder', ...)`。可能错误码：`workspace-move-invalid`(workspaceId/sessionId/beforeSessionId)、`workspace-not-found`(workspaceId)、`bad-request`。
