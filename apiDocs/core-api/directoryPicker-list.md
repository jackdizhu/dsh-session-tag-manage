# directoryPicker.list

## 接口 (Interface)
- 命名空间 (Namespace): `directoryPicker`
- 方法名 (Method): `list`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/directory-picker.ts`（@Remote('list')，经由 DirectoryPickerController）
- 功能说明: 为远端调用方应用内浏览器列出某目录的单层内容，返回该层及其祖先链（面包屑）。

## 入参 (Request / Input)
无传统请求体；参数为位置参数。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string \| undefined` | 否 | 要列出的绝对目录路径；省略时列出主机 home 目录。 |
| `signal` | `AbortSignal` | 是（协议级） | 调用方生命周期；中止时停止后端扫描，而非让其超脱已断开的调用方。 |

## 出参 (Response / Output)
- 返回类型: `Promise<DirectoryListing>`

| 字段 | 类型 | 说明 |
|---|---|---|
| `path` | `string` | 被列出目录的绝对路径。 |
| `home` | `string` | 主机账户的 home 目录（面包屑 "Home" 根）。 |
| `crumbs` | `DirectoryEntry[]` | 从文件系统根到被列目录（含）的祖先链；每个 crumb 均为跳转目标（`hidden` 恒为 false）。 |
| `entries` | `DirectoryEntry[]` | 直接子目录，按名称排序；含指向目录的符号链接。 |
| `truncated` | `boolean` | 后端在完整结果上限处截断 `entries` 时为 `true`（缺失行为名称排序尾部，隐藏项也计入上限）。 |

`DirectoryEntry` 字段：`name: string`、`path: string`（绝对路径，客户端不自行拼接）、`hidden: boolean`。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/navigation.ts:147`（`UiWorkspaceService.listDirectory` → `this.directoryPicker.list(path, signal)`），`directoryPicker` 即 `ClientRemote['directoryPicker']`。
- 调用方式: `const result = await this.directoryPicker.list(path, signal)`（返回 `RemoteResult<DirectoryListing>`）。
- 入参构造: 业务侧 `listDirectory(path?, signal?)`；`path` 省略时后端列 home；`signal` 用于作废被取代的扫描（导航切换时传递）。
- 响应/流处理: `listDirectory()` 在 `!result.ok` 时 `throw new DirectoryBrowseError(result.error)`；否则返回 `result.value`（`DirectoryListing`），供目录浏览 UI 渲染 `crumbs` 面包屑与 `entries` 子目录列表，并按 `truncated` 提示结果被截断。
- 错误处理: 经 `cancellableFailure`/`browseFailure` 分类，错误码（`DirectoryPickerErrorDetailsMap`）：`directory-picker-unavailable`(capability，当组合后端非 `browse`)、`directory-unreadable`(path)、`cancelled`（调用方中止）、`internal`。`DirectoryBrowseError` 携带原始 `RemoteFailure`（`rpcError.code` / `rpcError.message`），供浏览 UI 区分展示。
