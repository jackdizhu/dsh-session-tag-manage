# settings.openSettingsDocument

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): openSettingsDocument
- 调用模式 (Mode): 一元调用 (unary，携带 AbortSignal)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 实体化 provider 拥有的 settings 文档，并在原生文本编辑器中打开它。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| signal | `AbortSignal` | 是 | 调用方生命周期；abort 会终止准备或原生命令。 |

## 出参 (Response / Output)
- 返回类型: `Promise<SettingsDocumentOpenValue>`

| 字段 | 类型 | 说明 |
|---|---|---|
| opened | `true` | 原生 opener 接受文档后的确认（字面量 `true`）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: packages/client/ui-settings-general/src/client/settings-document-store.ts:66 （已验证）
- 调用方式: `const result = await this.remote.settings.openSettingsDocument()`
- 入参构造: 无显式业务入参（Remote 代理自动携带 AbortSignal；当前调用点未显式传入 signal，由代理默认处理）。
- 响应处理: 结果带 `ok` 标志——`if (!result.ok) throw new Error(result.error.message)`；成功时 `opened: true` 即确认，store 仅翻转 `opening` 状态。`derive()` 依据镜像的 `hasDocument` 决定 store 状态为 `ready`（可打开）或 `unavailable`（无文档）。
- 错误处理: 失败（含传输异常）写入 `state.error = messageOf(error)` 并在 `finally` 中复位 `opening = false`，UI 据此展示错误而不崩溃。Host 可能返回 `internal`（无文档/准备失败/打开失败）、`cancelled`（被中止）。
