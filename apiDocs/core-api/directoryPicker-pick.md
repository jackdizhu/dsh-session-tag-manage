# directoryPicker.pick

## 接口 (Interface)
- 命名空间 (Namespace): `directoryPicker`
- 方法名 (Method): `pick`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/directory-picker.ts`（@Remote('pick')，经由 DirectoryPickerController）
- 功能说明: 为远端调用方打开主机操作系统的目录选择器，返回所选绝对路径；操作者取消时返回 `null`。

## 入参 (Request / Input)
无（一元调用，无请求体）。仅接收一个 `AbortSignal` 用于终止选择器（`signal.aborted` 视为调用方取消）。

## 出参 (Response / Output)
- 返回类型: `Promise<string | null>`

| 字段 | 类型 | 说明 |
|---|---|---|
| （直接返回值） | `string \| null` | 所选目录的绝对路径；用户取消时返回 `null`。 |

注意：客户端经生成的 Remote 代理调用时，返回值被包装为 `RemoteResult<string | null>`（`{ ok: true, value }` 或 `{ ok: false, error }`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/navigation.ts:141`（`UiWorkspaceService.pickDirectory` → `this.directoryPicker.pick()`），`directoryPicker` 即 `ClientRemote['directoryPicker']`（在 `index.ts:78` 注入 `ctx.remote.directoryPicker`）。
- 调用方式: `const result = await this.directoryPicker.pick()`（返回 `RemoteResult<string | null>`）。
- 入参构造: 无请求体；AbortSignal 由 Remote 代理在调用生命周期内管理。
- 响应/流处理: `pickDirectory()` 在 `!result.ok` 时 `throw new Error('directory picker failed: ...')`；否则返回 `result.value`（路径或 `null`，由 UI 判断取消）。结果为 `null` 时目录选择流程不推进。
- 错误处理: 能力缺失或失败抛 `TypertRemoteFailure`，经 `cancellableFailure` 分类。错误码（`DirectoryPickerErrorDetailsMap`）：`directory-picker-unavailable`(capability，当组合后端非 `native`)、`cancelled`（用户/调用方中止）、`internal`（无闭合码的底层失败）。`directory-picker-unavailable` 与 `internal` 经 `RemoteResult` 透传，由 UI 捕获提示。
