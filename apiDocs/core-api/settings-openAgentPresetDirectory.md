# settings.openAgentPresetDirectory

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): openAgentPresetDirectory
- 调用模式 (Mode): 一元调用 (unary，携带 AbortSignal)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 打开某一用户编写的 Agent preset 目录；若无原生 opener 则返回其路径用于文本展示。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| agentPreset | `string` | 是 | 预设 id，针对 Host 拥有的根解析。 |
| signal | `AbortSignal` | 是 | 调用方生命周期；abort 会终止原生命令。 |

## 出参 (Response / Output)
- 返回类型: `Promise<AgentPresetDirectoryOpenValue>`（联合类型）

| 变体 | 字段 | 类型 | 说明 |
|---|---|---|---|
| 已打开 | `opened` | `true` | 原生 opener 已接受，字面量 `true`。 |
| 无 opener 时回退 | `opened` | `false` | 未能打开。 |
| 无 opener 时回退 | `path` | `string` | 解析出的目录路径，供文本展示。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: packages/client/ui-agent-preset/src/client/section-store.ts:297 （已验证，`openLocation(id)`）
- 调用方式: `const result = await this.remote.settings.openAgentPresetDirectory(id)`
- 入参构造: `agentPreset` 取当前行 `id`；`signal` 由 Remote 代理默认承载（调用点未显式传）。
- 响应处理: 结果带 `ok` 标志——`!result.ok` 时 `this.set({ error: result.error.message })`；成功且 `result.value.opened` 为真则直接返回（目录已在桌面打开）；否则取 `result.value.path` 并 `this.set({ revealedPaths: { ...revealedPaths, [id]: path } })`，在对应行上显示路径文本。
- 错误处理: 失败（含传输异常）写入 `error` 字段。Host 可能返回 `bad-request`（空 id）、`agent-preset-not-found`、`agent-preset-read-only`、`agent-preset-invalid`、`internal`、`cancelled`。
