# session.rename

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `rename`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('rename')`）、`packages/api/session-controller/src/commands.ts`（`rename()`）
- 功能说明: 在显式恢复会话后，规范化并追加一条用户所有的会话标题，返回被接受的标题及其持久化事件序号。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 目标会话标识。 |
| `title` | `string` | 是 | 提议的会话标题（经规范化/trim 后写入）。 |

## 出参 (Response / Output)
- 返回类型: `SessionRenameValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `string` | 被接受的规范化标题。 |
| `seq` | `number` | 提交该标题的持久化事件序号。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-workspace/src/client/index.ts:108`（`renameSession(sessionId, title)` 注入项）。
- 调用方式: 行级操作先 `const session = sessions.binding(sessionId)?.session`，再 `const result = await session.rename(title);`（生成客户端 `SessionFace.rename`，返回 `RemoteResult<SessionRenameValue>`）。
- 入参构造: 由工作区浏览器重命名弹窗的输入框取得 `title`（原始字符串），连同 `sessionId` 经 `binding` 取到的 `SessionFace` 调用。
- 响应/流处理: 成功后在会话列表/树中通过 Host `session/event`（标题事件）及列表投影增量更新标题显示；失败抛 `new Error(result.error.message)`。
- 错误处理: 常见失败码：`title-invalid`（标题不合法，见 `SessionTitleInvalidError`）、`session-not-found`、`internal`（未挂载 session-title 服务）。以 `{ ok: false, error }` 形式返回。
