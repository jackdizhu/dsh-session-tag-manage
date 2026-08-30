# credentials.describe

## 接口 (Interface)
- 命名空间 (Namespace): credentials
- 方法名 (Method): describe
- 调用模式 (Mode): 一元调用（批量）
- 来源文件: packages/api/settings-controller/src/credentials.ts
- 功能说明: 为一个配置界面描述多个引用；批量发起是因为配置页会一次性描述其行所命名的所有引用，一次往返避免各行分别落定。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| refs | `string[]` | 是 | 引用名数组，最多 64 个（`MAX_DESCRIBE_REFS = 64`）；单个名字不符合语法（正则 `^[A-Za-z_][A-Za-z0-9_]*$`）会使整次调用以 `bad-request` 拒绝。 |

## 出参 (Response / Output)
- 返回类型: `Promise<Record<string, CredentialInfo>>`

按引用名键控，每个请求名一个视图。

`CredentialInfo` 字段定义：

| 字段 | 类型 | 说明 |
|---|---|---|
| configured | `boolean` | 解析该引用当前是否会返回取值。 |
| source? | `string` | 当前供给取值的来源层；未配置时缺省。 |
| writable | `boolean` | 活动 provider 能否写入该引用。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）:
  - packages/client/ui-settings-plugins/src/client/web-search-card-controller.ts:130
  - packages/client/ui-settings-models/src/client/store.ts:258
  - packages/client/ui-settings-models/src/client/ProviderEditor.tsx:193
- 调用方式:
  - `await this.credentials.describe([ref])`（单个引用，web-search 卡片）
  - `const response = await this.api.credentials.describe(refs)`（批量，Models store，`refs` 去重后的引用名数组）
  - `void api.credentials.describe([keyRef]).then(...)`（React 副作用中读取 key 状态）
- 入参构造: 引用名来自当前 section（`refOf(this.scope.getSnapshot())`）或各行 `apiKeyEnv`/`deriveKeyRef(provider)` 去重集合。
- 响应处理: 结果带 `ok` 标志。`web-search-card-controller` 仅在 `ref === refOf(...)`（响应仍对应当前引用）且 `response.ok` 时发布 `response.value[ref]`（`configured`/`writable`，未知引用按 `false`/`true` 兜底），避免乱序响应污染状态；失败时静默返回，卡片仍可用。`store.ts` 把 `response.value` 作为各行 `credential` 富化（失败仅记 `credentialError`，不阻断页面加载）。`ProviderEditor` 在 `useEffect` 中读取 `response.value[keyRef]` 设置 key 提示态（`stale` 守卫防卸载后更新）。
- 错误处理: 作为“富化”数据，业务/传输失败均不阻断主流程：web-search 静默忽略，Models store 记 `credentialError`，ProviderEditor 忽略 reject。Host 可能返回 `bad-request`（引用语法/超限）、`internal`（provider 缺失）。
