# workspace.follow

## 接口 (Interface)
- 命名空间 (Namespace): `workspace`
- 方法名 (Method): `follow`
- 调用模式 (Mode): 流式调用 (stream)
- 来源文件: `packages/api/workspace-controller/src/index.ts`（@Remote({ mode: 'stream' })，委托至 WorkspaceFeed.follow）
- 功能说明: 流式推送完整的 Workspace 基线，其后跟随有序的增量（upsert / remove / order / archived），供浏览器断线重连安全地重建本地状态。

## 入参 (Request / Input)
无（流式调用，无请求体）。仅接收一个 `AbortSignal` 用于控制生成（generation）的取消。

## 出参 (Response / Output)
- 返回类型: `AsyncIterable<WorkspaceFollowFrame>`，首帧为完整基线，后续为增量：
  - 基线帧：`{ type: 'baseline'; value: WorkspaceBaseline }`
  - 增量帧（联合 `WorkspaceFollowIncrement`）：
    - `{ type: 'upsert'; workspace: WorkspaceView }`
    - `{ type: 'remove'; workspaceId: WorkspaceId }`
    - `{ type: 'order'; workspaceIds: readonly WorkspaceId[] }`
    - `{ type: 'archived'; archivedSessionIds: readonly SessionId[] }`

| 字段（按帧类型） | 类型 | 说明 |
|---|---|---|
| `baseline.value` | `WorkspaceBaseline` | `{ items: readonly WorkspaceView[]; archivedSessionIds: readonly SessionId[] }` —— 完整基线投影。 |
| `upsert.workspace` | `WorkspaceView` | 合并/更新一个 Workspace 行。 |
| `remove.workspaceId` | `WorkspaceId` | 移除一个 Workspace 行。 |
| `order.workspaceIds` | `readonly WorkspaceId[]` | 替换 Host 确认的完整顺序。 |
| `archived.archivedSessionIds` | `readonly SessionId[]` | 替换完整归档 Session 集合。 |

`WorkspaceView` 字段：`workspaceId: WorkspaceId`、`path: string`、`title: string`、`sessionIds: readonly SessionId[]`、`createdAt: string`(ISO-8601)、`updatedAt: string`(ISO-8601)。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/api/workspace-controller/src/client/index.ts:86`（`createWorkspaceStateStream` 中 `open: signal => remote.workspace.follow(signal)`），由 Gateway 的 `remote.$stream({ name: 'Workspace state stream', ... })` 驱动，`apply()` 内 `control.start()` 启动；每代 `open` 对应一次 `follow(signal)`。
- 调用方式: 由 `RemoteSnapshotStream` 经 Gateway `remote.$stream` 工厂封装；不业务侧直接调用，而是通过 `ctx.workspaces.list`（`WorkspaceSource`）消费解码后的快照。
- 入参构造: 无请求体；仅 `signal`（来自 `remote.$stream` 的代次取消信号）。
- 响应/流处理: `createWorkspaceStateStream` 用 `RemoteSnapshotStream` 解码帧：`isSnapshot` 判定 `type === 'baseline'`，`replace` 调 `model.replaceBaseline(frame.value)`（重置 `items`/`archivedSessionIds`，`phase='ready'`）；`update` 按增量类型分发到 `ClientWorkspaceModel` 的 `upsertView` / `removeView` / `replaceOrder` / `replaceArchived`。`ClientWorkspaceModel` 负责流/一元竞态：`orderFrameGeneration` 让更晚的 Host 提交胜过一元回显；`removedIds` 防止延迟增量复活已删行；`updatedAt` 比较忽略旧投影。链路丢失时 `carrierFailed` 调 `model.handleCarrierFailure()`（保留末次投影、`state='loading'`），重连后新基线重建；终态失败调 `model.handleStreamFailure(error)`（`state='error'`、`error` 暴露 `RemoteFailure`）。
- 错误处理: 业务失败经 `failed` 回调进入 `handleStreamFailure`；传输/协议失败经 `RemoteStreamCarrierError` 触发重连（`carrierFailed`）。UI 通过 `useWorkspaces` 快照的 `state`/`error`（`'idle' | 'loading' | 'error'`、`phase: 'pending' | 'ready'`、`error: RemoteFailure | null`）呈现加载/错误态。
