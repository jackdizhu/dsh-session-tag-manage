# credentials.unset

## 接口 (Interface)
- 命名空间 (Namespace): credentials
- 方法名 (Method): unset
- 调用模式 (Mode): 一元调用
- 来源文件: packages/api/settings-controller/src/credentials.ts
- 功能说明: 从配置界面移除一个引用。

## 入参 (Request / Input)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| ref | `string` | 是 | 要移除的引用名（正则 `^[A-Za-z_][A-Za-z0-9_]*$`）。 |

## 出参 (Response / Output)
- 返回类型: `Promise<void>`

无返回体（`void`）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置（已验证）: packages/client/ui-settings-models/src/client/ModelsSection.tsx:119 （`removeProviderProfile`）
- 调用方式: `const credential = await api.credentials.unset(target.credentialRef)`
- 入参构造: `ref` 取目标 provider 档案的 `credentialRef`（仅当该引用存在时调用；`target.credentialRef !== undefined` 才进入）。
- 响应处理: 结果带 `ok` 标志——`!credential.ok` 时返回 `credential.error.message`；成功且 credential 已移除后，再发起 `api.settings.mutate(ns, [{ op: 'unset', path: [...settingsPath] }], undefined)` 移除对应 settings 段，最后 `await controller.load()` 刷新页面。该操作被设计为幂等，便于失败时由调用方重试。
- 错误处理: 业务侧返回 `credential.error.message`（unset 失败）或 `response.error.message`（mutate 失败）；传输异常（非应答）由外层 try/catch 捕获并返回 `messageOf(error)`，使调用方得以重试而非行静默保留。Host 可能返回 `bad-request`（ref 语法）、`credential-rejected`（provider 拒绝，详情仅含 `ref`）、`internal`（provider 缺失）。**注意：移除的是引用而非值本身回传。**
