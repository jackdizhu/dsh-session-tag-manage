# settings.replace

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): replace
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 整体替换某一命名空间已存储的 user 段。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| ns | `string` | 是 | 要写入的命名空间键（至少 1 个字符，经 `settingsNamespaceRequestSchema` 校验）。 |
| section | `Record<string, JsonValue>` | 是 | 完整的替换用 user 段。 |
| expectedRevision | `number \| undefined` | 否 | 调用方读取到的修订号；`undefined` 表示无条件写入。 |

## 出参 (Response / Output)
- 返回类型: `Promise<SettingsNamespaceView>`

写入后该命名空间的脱敏视图（字段定义见 `settings.describe` 中的 `SettingsNamespaceView`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 未在业务模块（ui-*/src/client、store、modules、web）中发现消费点。仅在测试夹具中出现：
  - packages/client/connection/tests/fixture.client.spec.ts:777 `await api.settingsRemote.replace('llm-deepseek', {}, undefined)`
  - packages/client/connection/src/client/fixture.ts:3520 `case 'settings/replace': return Promise.resolve(settingsRemotes.replace(args.ns as string))`
- 调用方式（推断，来自生成 Remote 代理）: `const response = await api.settings.replace(ns, section, expectedRevision)`
- 入参构造: 由调用方提供完整 `section` 与 `expectedRevision`。
- 响应处理: 经生成的 Remote 客户端代理下发，应答带 `ok` 标志（具体消费方式由各业务模块自行决定；当前仓库无业务模块调用，故列为暴露但未被业务页面使用）。
- 错误处理: 经连接层统一承载，可能错误码同 `settings.update`：`bad-request`、`settings-rejected`、`settings-conflict`、`internal`。**该端点 web 端逻辑在业务模块中未找到，仅由生成 Remote 代理暴露并在测试夹具中使用——标记为推断/未消费。**
