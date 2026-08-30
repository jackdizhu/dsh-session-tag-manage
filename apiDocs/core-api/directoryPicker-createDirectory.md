# directoryPicker.createDirectory

## 接口 (Interface)
- 命名空间 (Namespace): `directoryPicker`
- 方法名 (Method): `createDirectory`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/workspace-controller/src/directory-picker.ts`（@Remote('createDirectory')，经由 DirectoryPickerController）
- 功能说明: 为远端调用方应用内浏览器在某个已存在父目录下创建一个子目录，返回所创建目录的绝对路径。

## 入参 (Request / Input)
无传统请求体；参数为位置参数（并在 host 侧以 zod schema 校验）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 已存在的父目录绝对路径。 |
| `name` | `string` | 是 | 单个非空白的路径段名称（不能含 `/` 或 `\`，不能是 `.` 或 `..`，前后空白被裁剪）。 |

入参语义校验（`createDirectoryRequestSchema`）：`name` 非空白、非 `.`/`..`、且不匹配 `/[/\\]/`，否则返回 `bad-request`。

## 出参 (Response / Output)
- 返回类型: `Promise<string>`

| 字段 | 类型 | 说明 |
|---|---|---|
| （直接返回值） | `string` | 所创建子目录的绝对路径。 |

注意：客户端经生成的 Remote 代理调用时，返回值被包装为 `RemoteResult<string>`。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: `packages/client/ui-workspace/src/client/navigation.ts:153`（`UiWorkspaceService.createDirectory` → `this.directoryPicker.createDirectory(path, name)`），`directoryPicker` 即 `ClientRemote['directoryPicker']`（在 `index.ts:78` 注入）。
- 调用方式: `const result = await this.directoryPicker.createDirectory(path, name)`（返回 `RemoteResult<string>`）。
- 入参构造: 业务侧 `createDirectory(path, name)`；`path` 为当前浏览目录，`name` 来自用户在新建目录对话框的输入。
- 响应/流处理: `createDirectory()` 在 `!result.ok` 时 `throw new DirectoryBrowseError(result.error)`；否则返回 `result.value`（新建绝对路径），UI 通常随后以该路径调用 `listDirectory` 刷新浏览视图。
- 错误处理: 经 zod 校验失败抛 `bad-request`(issues: ZodIssue[])；能力/后端失败经 `browseFailure`/`pickerFailureOf` 分类，错误码（`DirectoryPickerErrorDetailsMap`）：`directory-picker-unavailable`(capability，当组合后端非 `browse`)、`directory-exists`(path)、`directory-create-failed`(path)、`directory-unreadable`(path)、`cancelled`、`internal`。`DirectoryBrowseError` 携带原始 `RemoteFailure` 供浏览 UI 区分展示。
