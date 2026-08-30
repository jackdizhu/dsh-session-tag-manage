# settings.update

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): update
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 将补丁合并进某一命名空间已存储的 user 段。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| ns | `string` | 是 | 要写入的命名空间键（至少 1 个字符，经 `settingsNamespaceRequestSchema` 校验）。 |
| patch | `Record<string, JsonValue>` | 是 | 合并进 user 段的字段。 |
| expectedRevision | `number \| undefined` | 否 | 调用方读取到的修订号；`undefined` 表示无条件写入。 |

## 出参 (Response / Output)
- 返回类型: `Promise<SettingsNamespaceView>`

写入后该命名空间的脱敏视图（字段定义见 `settings.describe` 中的 `SettingsNamespaceView`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: packages/client/ui-agent-preset/src/client/settings-store.ts:45 （已验证，`writeDefaultPreset`）
- 调用方式: `response = await api.settings.update(AGENT_PRESET_SETTINGS_NS, { default: id }, undefined)`
- 入参构造: `ns` 取 `AGENT_PRESET_SETTINGS_NS`，`patch` 为 `{ default: id }`，`expectedRevision` 传 `undefined`（默认 preset 直接无条件写）。
- 响应处理: 结果带 `ok` 标志——`response.ok` 为真返回 `undefined`（成功），否则返回 `response.error.message`。传输层被拒时（非应答）catch 后返回 `messageOf(error)`，使调用方得以提示而非静默回弹。
- 错误处理: 业务侧处理 `response.error.message` 及传输异常；Host 可能返回 `bad-request`（非法 ns）、`settings-rejected`（ns 未注册/只读/校验/存储）、`settings-conflict`（修订号陈旧）、`internal`（provider 缺失或写入后命名空间消失）。冲突时应由调用方重读后重试（本调用点未专门区分冲突码）。
