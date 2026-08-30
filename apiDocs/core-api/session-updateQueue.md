# session.updateQueue

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `updateQueue`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('updateQueue')`）、`packages/api/session-controller/src/commands.ts`（`updateQueue()`）
- 功能说明: 对仍处于 pending 的队列项做一处变更（编辑/移除/插话），无需恢复冷 Agent；返回变更已应用的回执。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 目标会话标识（Agent 必须已挂载）。 |
| `itemId` | `MessageId`（品牌类型） | 是 | 待变更的待处理队列项标识。 |
| `action` | `QueueAction` | 是 | 变更类型：<br>`{ kind: 'edit'; content: readonly ContentBlock[] }`（仅文本）<br>`{ kind: 'remove' }`<br>`{ kind: 'steer' }`（将待处理项插入运行中的 turn）。 |

## 出参 (Response / Output)
- 返回类型: `SessionUpdateQueueValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `accepted` | `true` | 队列变更已提交的确认常量。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-conversation/src/client/service.ts:314`（`ConversationController.updateQueue(itemId, action)`）；`ui-conversation/src/client/input/hub.ts:202`（`steerQueue` 中对每个待处理项调用 `session.updateQueue(item.id, { kind: 'steer' })`）。
- 调用方式: `const result = await session.updateQueue(itemId, action);`（生成客户端 `SessionFace.updateQueue`，返回 `RemoteResult<SessionUpdateQueueValue>`）。
- 入参构造: `itemId` 来自快照 `queue` 中的 `SessionQueuedItem.id`；`action` 由队列 dock 的逐行按钮（edit/remove）或「插话全部」严格 steer 操作产生。`edit` 的 `content` 为文本 `ContentBlock[]`。
- 响应/流处理: 成功（`result.ok`）后队列状态由后续 `session.control` 流的 `queue` 帧增量刷新；严格 steer 在历史 turn 关闭（`steer-unavailable`）或行已被 Agent 认领（`queue-item-not-found`）时静默收敛（不抛错），其它失败经 `shell.notify('error', ...)` 提示。
- 错误处理: 常见失败码：`attachment-error`（`QUEUE_EDIT_NON_TEXT`）、`queue-item-not-found`、`steer-unavailable`、子 agent 所有权错误、`session-not-found`。以 `{ ok: false, error: { code, message } }` 返回。
