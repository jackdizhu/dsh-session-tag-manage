# settings.mutate

## 接口 (Interface)
- 命名空间 (Namespace): settings
- 方法名 (Method): mutate
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: packages/api/settings-controller/src/index.ts
- 功能说明: 对某一命名空间的 user 段施加路径寻址编辑，针对“已存储”的 section 解析（而非调用方上次所读），随后回答该命名空间的新脱敏视图。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| ns | `string` | 是 | 要写入的命名空间键（至少 1 个字符，经 `settingsNamespaceRequestSchema` 校验）。 |
| ops | `SettingsPathOpView[]` | 是 | 按顺序施加的编辑。 |
| expectedRevision | `number \| undefined` | 否 | 调用方读取到的修订号；`undefined` 表示无条件写入。 |

`SettingsPathOpView` 类型（路径寻址编辑的联合）：

| 变体 | 类型 | 说明 |
|---|---|---|
| set | `{ op: 'set'; path: string[]; value: JsonValue }` | 在 path 处写入 value，自动创建中间对象。 |
| unset | `{ op: 'unset'; path: string[] }` | 移除 path 处字段。 |

空 path 指向 section 根。

## 出参 (Response / Output)
- 返回类型: `Promise<SettingsNamespaceView>`

写入后该命名空间的脱敏视图（字段定义见 `settings.describe` 中的 `SettingsNamespaceView`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（主调用点，已验证）: packages/client/ui-settings/src/client/settings-scope.ts:133
- 其他调用点（已验证）:
  - packages/client/ui-settings-models/src/client/ProviderEditor.tsx:285
  - packages/client/ui-settings-models/src/client/ModelsSection.tsx:122
  - packages/client/ui-settings-models/src/client/CustomProviderCard.tsx:150
  - packages/client/ui-permission-presets/src/client/settings-store.ts:140
- 调用方式（主调用点）: `response = await this.api.settings.mutate(this.spec.namespace, ownedOps, revision)`
- 入参构造: `ns` 取本 scope 的 `namespace`；`ops` 由 `set`/`unset` 队列克隆（`structuredClone`）而来，形如 `[{ op: 'set', path: [field], value }, { op: 'unset', path: [field] }]`；`revision` 取 `expectedRevision ?? this.pendingRevision ?? 当前快照 revision`。
- 响应处理: 结果带 `ok` 标志。失败（`!response.ok` 或抛异常）时调用 `recover(generation)`：清空 pendingRevision 并重读镜像（`mirror.load()`），实现“最新写入恢复读”。成功且 generation 仍为当前写入代次时 `mirror.acceptView(response.value)` 接纳新视图；否则仅缓存 `response.value.revision` 供后续写复用。`settings-scope` 还以写代次（`writeGeneration`）串行化排队写入。
- 错误处理: `ProviderEditor.tsx` 显式区分 `response.error.code === 'settings-conflict'` 显示文案 `t('conflict')`，其余显示 `response.error.message`；传输异常与 `!ok` 统一走 `recover` 重读。Host 可能返回 `bad-request`、`settings-rejected`、`settings-conflict`（详情含 `ns`/`expected`/`actual`）、`internal`。
