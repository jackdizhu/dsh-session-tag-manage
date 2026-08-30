# session.attachment

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `attachment`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('attachment')`）、`packages/api/session-controller/src/commands.ts`（`attachment()`）
- 功能说明: 读取一张经证明「会话日志确实引用过」的持久化图片，返回其持久化附件引用与 base64 编码字节。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 用于鉴权的目标会话标识。 |
| `attachmentId` | `AttachmentIdType`（品牌类型） | 是 | 附件标识。 |

## 出参 (Response / Output)
- 返回类型: `SessionAttachmentValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `attachment` | `ImageAttachmentRef` | 持久化附件引用（含 `attachmentId` 等元信息）。 |
| `data` | `string` | 图片字节的 base64 编码。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: 经生成客户端 `SessionFace` / `ctx.sessions.attachment`（或 `ctx.remote.session.attachment`）消费；由会话图片加载管线使用（如 `ui-chat` 的 `loadImage`/`ctx.uiConversation.imageUrl(sessionId, attachment)`、`ui-attachment` 图像渲染）。**在业务模块源码中未定位到直接的 `.attachment(` 调用点**，推测由 `uiConversation.imageUrl` 内部封装调用。
- 调用方式（推断）: `const result = await session.attachment({ sessionId, attachmentId });`（生成客户端返回 `RemoteResult<SessionAttachmentValue>`）。
- 入参构造: 由渲染中的 `ImageAttachmentRef.attachmentId` 与当前 `sessionId` 组装。
- 响应/流处理: 返回的 `data`（base64）驱动 `<img>`/对象 URL 渲染，供消息节点与产出文件行显示；Host 端先校验日志是否真的引用过该附件。
- 错误处理: 常见失败码：`session-not-found`、`attachment-error`（`ATTACHMENT_NOT_REFERENCED` 或 `AttachmentError` 原因码）、`internal`。以 `{ ok: false, error }` 形式返回；传输异常表现为 `TypertRemoteFailure`。
