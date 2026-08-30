# workspace.create

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `create`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote('create')，委托至 WorkspaceCommands.create）
- 功能说明: 在已存在的目录上创建 Workspace，若该目录已注册则幂等返回既有 Workspace，并返回是否本次新建。

## 入参 (Request / Input)
请求类型：`WorkspaceCreateRequest`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 要注册为 Workspace 的已存在目录的规范主机路径。 |

## 出参 (Response / Output)
- 返回类型: `Promise<WorkspaceCreateValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace` | `WorkspaceView` | 创建或幂等解析得到的 Workspace 投影（含 workspaceId / path / title / sessionIds / createdAt / updatedAt）。 |
| `created` | `boolean` | `true` 表示本次调用新建了注册，`false` 表示命中既有目录注册。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/api/workspace-controller/src/client/model.ts:84`（`ClientWorkspaceModel.create`）→ `packages/api/workspace-controller/src/client/service.ts:92`（`WorkspaceController.create`，IWorkspaces 门面）→ 业务入口 `packages/client/ui-workspace/src/client/index.ts:127,131`（`createWorkspace` 注入到 WorkspaceBrowser / WorkspacePicker 行级操作）。
- 调用方式: `const result = await this.remote.create(input)`（`input` 即 `{ path }`），返回 `RemoteResult<WorkspaceCreateValue>`。
- 入参构造: 业务侧 `workspaces.create({ path })`；路径来自目录选择流程（`directoryPicker.pick`）。
- 响应/流处理: 一元结果解析后，`ClientWorkspaceModel.create` 在 `result.ok` 时立即 `upsert(result.value.workspace)` 合并到本地投影；UI 通过 `ctx.workspaces.list`（全局 `useWorkspaces` hook 与 `WorkspaceSource` 快照）读取更新。`create` 的结果不是 `follow` 流的替代品，流基线/增量仍由 `createWorkspaceStateStream` 持续推送。
- 错误处理: 解析/传输失败封装为 `{ ok: false, error }`（`WorkspaceCreateError` 包装 `RemoteFailure`）。可面错误码（`WorkspaceError`/`WorkspaceErrorDetailsMap`）：`bad-request`、`workspace-invalid-path`(path)、`workspace-name-conflict`(name) 等；失败时本地投影不更新，`WorkspaceController.create` 抛出 `WorkspaceCreateError` 交由 UI 捕获提示。
