# settings.canOpenAgentPresetDirectory

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): canOpenAgentPresetDirectory
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 报告本次部署能否以原生方式打开一个用户编写的 Agent preset 目录。

## 入参 (Request / Input)
无（一元调用，无请求体）。

## 出参 (Response / Output)
- 返回类型: `boolean`

| 字段 | 类型 | 说明 |
|---|---|---|
| (返回值) | `boolean` | 当匹配的 open 操作可用时为 `true`。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: packages/client/ui-agent-preset/src/client/section-store.ts:170 （已验证）
- 调用方式: `const opener = this.remote.settings.canOpenAgentPresetDirectory()` （返回 Promise）
- 入参构造: 无入参。
- 响应处理: 在 `load()` 中与花名册读取并发发起（一次往返决定页面），随后 `opener.catch(() => undefined)` 容错；若 `described?.ok === true && described.value` 为真则 `hasDocument = true`，否则为 `false`。该布尔位与 roster 一起决定 section 是否进入 `ready` 或 `unavailable`（无 preset 时渲染空内容）。注意：能否打开目录是 Host 的 opener 能力，而非花名册属性，故页面将两者合并呈现。
- 错误处理: 调用以 `.catch(() => undefined)` 吞掉失败，缺失 opener 时按“不可打开”处理（`hasDocument = false`），不再向上抛错。Host 侧一般不抛错，仅在 opener 检测异常时返回 `false` 语义。
