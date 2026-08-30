# settings.describe

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): describe
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 为配置页面描述每一个已注册命名空间：脱敏后的分层取值，以及页面据此渲染表单的序列化 schema。

## 入参 (Request / Input)
无（一元调用，无请求体）。

## 出参 (Response / Output)
- 返回类型: `SettingsDescribeValue`

| 字段 | 类型 | 说明 |
|---|---|---|
| writable | `boolean` | provider 是否接受写入；`false` 时禁用所有写控件。 |
| hasDocument | `boolean` | 文件型 provider 是否拥有本地文档（不暴露其 Host 路径）。 |
| namespaces | `SettingsNamespaceView[]` | 每个已注册命名空间一个视图。 |

`SettingsNamespaceView` 字段定义：

| 字段 | 类型 | 说明 |
|---|---|---|
| ns | `string` | 命名空间键（如 `llm-deepseek`、`llm-pi-ai`）。 |
| schema | `JsonValue` | 序列化后的 schemastery schema 信封（`schema.toJSON()`），用 `new Schema(json)` 还原。 |
| value | `JsonValue` | 脱敏后的解析取值（schema 默认值 → 组合 base → user 层）。 |
| base? | `JsonValue` | 脱敏后的组合 base 层，注册方声明了才有。 |
| user? | `JsonValue` | 脱敏后的原始 user 段，存在才有；某字段出现在此处即表示被用户覆盖。 |
| applies | `'live' \| 'restart'` | 拥有者应用变更的时机。 |
| secrets | `SettingsSecretView[]` | 每个 schema 声明过的 secret 槽及其配置状态。 |
| revision | `number` | 该视图所读原始 user 段的单调修订号；写回时作为 `expectedRevision` 传入，陈旧编辑会被拒绝而非静默覆盖。 |

`SettingsSecretView` 字段定义：

| 字段 | 类型 | 说明 |
|---|---|---|
| path | `string[]` | 从 section 根到被移除字段的路径。 |
| set | `boolean` | 该槽当前是否持有值（值本身永不下发）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: packages/client/ui-settings/src/client/settings-mirror.ts:197 （已验证）
- 调用方式: `const response = await this.api.settings.describe()`
- 入参构造: 无入参。
- 响应处理: 返回结果带 `ok` 标志：`response.ok` 为真时把 `response.value`（`SettingsDescribeValue`）写入 store（`status: 'ready'`、`view`、`error: null`）；失败（含传输层异常）时保留已有视图、仅把 `error` 字段置为错误信息（无视图时退化为 `idle` 以便 `ensure` 重试）。`settings-mirror` 还维护 generation 计数以丢弃过期读，并在写入应答使其失效时触发重读。
- 错误处理: 业务模块未显式分类错误码；统一作为 `response.error.message` 走入 `error` 字段。Host 侧可能抛 `internal`（未挂载 settings provider）等，经 Remote 边界以 `bad-request`/`internal` 等承载。
