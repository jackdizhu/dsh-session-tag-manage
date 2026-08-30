# session.prompt

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `prompt`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('prompt')`）、`packages/api/session-controller/src/commands.ts`（`prompt()`）
- 功能说明: 在显式恢复会话后接收一条 prompt，经图片校验/升级后提交给 Agent；返回 Agent 已接收该 prompt 的回执。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `requestId` | `SessionRequestId`（品牌类型） | 是 | 客户端生成的幂等身份，持久化到被接收的用户消息上，用于乐观/持久消息对账。 |
| `sessionId` | `SessionId` | 是 | 目标会话标识。 |
| `mode` | `'queue' \| 'steer'` | 是 | 投递模式：排队新 turn 或在运行 turn 中插话。 |
| `content` | `readonly PromptContentPart[]` | 是 | 提示内容，元素为 `{ type: 'text'; text }` 或 `{ type: 'image'; mediaType; data; name? }`（base64）。 |
| `clientTimeZone?` | `string` | 否 | 客户端时区（UTC 或 IANA `Area/Location`），用于 Host 校验的时间展示。 |

## 出参 (Response / Output)
- 返回类型: `SessionPromptValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `accepted` | `true` | Agent 已接收 prompt 的确认常量。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-conversation/src/client/service.ts:181`（`send(text)`）、`:213`、`:242`（`sendSession(...)`）；经 `ConversationController` 的 scope-addressed `SessionFace` 调用。
- 调用方式:
  - 纯文本：`session.prompt([{ type: 'text', text }], 'queue')`
  - 带图/草稿：`session.prompt(content, mode, signal, submission.requestId)`（content 为 text/image 混合数组，`requestId` 来自 `beginSubmission`）。
- 入参构造: `requestId` 由 `randomUUID()` 生成（或复用 `submission.requestId`）；图片先经 `serializeImages` 转 base64（`{ mediaType, data, name? }`）；`mode` 由 composer 策略（`queue`/`steer`）决定；`clientTimeZone` 来自浏览器。
- 响应/流处理: 成功（`result.ok`）后本地提交回声（submission echo）在 Host 确认对应 `rpcId` 时退役；失败置 `promptError` 快照并 `throw`，composer 据此恢复草稿。实际消息流由 `session.follow` 流推送，不在本调用中返回。
- 错误处理: 常见失败码：`invalid-time-zone`、`model-unavailable`（无适配器/模型不支持图片）、`attachment-error`（图片不被模型支持或附件错误）、`agent-busy`、以及会话恢复相关错误。以 `{ ok: false, error: { code, message } }` 返回；未 resume 的会话走 `session-not-found`。
