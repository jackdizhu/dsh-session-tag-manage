# credentials.set

## 接口 (Interface)
- 命名空间 (Namespace): credentials
- 方法名 (Method): set
- 调用模式 (Mode): 一元调用
- 来源文件: packages/api/settings-controller/src/credentials.ts
- 功能说明: 从配置界面存储一个值；值只朝这一个方向过线，没有任何读路径返回它。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| ref | `string` | 是 | 存储所用的引用名（正则 `^[A-Za-z_][A-Za-z0-9_]*$`）。 |
| value | `string` | 是 | 非空 secret 值（至少 1 个字符）。 |

## 出参 (Response / Output)
- 返回类型: `Promise<void>`

无返回体（`void`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）:
  - packages/client/ui-settings-plugins/src/client/web-search-card-controller.ts:178
  - packages/client/ui-settings-models/src/client/CustomProviderCard.tsx:163
  - packages/client/ui-settings-models/src/client/ProviderEditor.tsx:296
- 调用方式:
  - `await this.credentials.set(refOf(this.scope.getSnapshot()), value)`（web-search 卡片）
  - `const stored = await api.credentials.set(keyRef, keyValue)`（ProviderEditor / CustomProviderCard）
- 入参构造: `ref` 取当前引用（`refOf(...)` 或 `keyRef`），`value` 为已去除首尾空白的 key 文本（空字符串视为“未提供 key”）。
- 响应处理: 结果带 `ok` 标志。web-search 卡片写失败后不立即报错，而是随后 `readCredential()` 重读 Host 状态以判断 key 是否真的落地（`writeKey` 返回 `this.credential.configured`）。ProviderEditor/CustomProviderCard 在 `!stored.ok` 时返回 `stored.error.message` 作为失败文案。
- 错误处理: 业务侧处理 `stored.error.message`（ProviderEditor/CustomProviderCard）或静默重读（web-search）；传输异常由上层 try/catch 兜底。Host 可能返回 `bad-request`（ref 语法/空 value）、`credential-rejected`（provider 拒绝有效写，详情仅含 `ref`）、`internal`（provider 缺失）。**注意：值永不在应答或错误详情中回传。**
