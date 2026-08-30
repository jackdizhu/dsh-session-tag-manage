# Spec: Session Event Tag Query

## Overview

会话事件标签查询能力。`workspace.session.tag` 将会话事件流按 turn（以 `turn/start` 为界）切分，返回 `value.items: SessionEventTagItem[]`，`hasMore` 上移到 `value` 级描述分页边界。前导种子段并入首轮且不丢弃事件；每条 item 携带 `round` 与 `endReason`；轮次统计复用现有折叠工具；RPC 信封与错误码保持向后兼容。模块归属：`packages/dsh-session-host/`、`packages/dsh-session-client/`。

## Requirements

### Requirement: 按 turn 切分返回 items 数组

系统 SHALL 将 `workspace.session.tag` 的响应 `value` 由单条 `item` 改为 `items: SessionEventTagItem[]`，其中每个 turn（以 `turn/start` 为界）对应一条 `SessionEventTagItem`；`hasMore` 字段 MUST 上移到 `value` 级，描述会话事件流的分页边界。

**模块归属**：`packages/dsh-session-host/src/contract.ts`、`packages/dsh-session-host/src/index.ts`、`packages/dsh-session-client/src/utils/tag-api.ts`

#### Scenario: 单 turn 会话返回单条 item

- **GIVEN** 某会话仅含 1 个 `turn/start` 与对应 `turn/end`
- **WHEN** 调用 `workspace.session.tag` 并成功拉取事件流
- **THEN** 响应 `value.items` 为长度为 1 的数组，且 `value.hasMore` 为布尔值，`value.item` 字段不存在

#### Scenario: 多 turn 会话返回多条 item

- **GIVEN** 某会话含 3 个 `turn/start` 与各自 `turn/end`
- **WHEN** 调用 `workspace.session.tag`
- **THEN** 响应 `value.items` 长度为 3，按事件 `seq` 升序排列，每条 item 的 `turns` 字段为 1

### Requirement: 前导种子段不排陻并入首轮

系统 SHALL 将首个 `turn/start` 之前的事件（`session/end-seed`、`session/title`、`request/header` 等前导事件）并入首个 turn 对应的 item，MUST NOT 丢弃任何事件数据。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`（`splitTurns`）

#### Scenario: 前导标题与文件操作被首轮计入

- **GIVEN** 事件流首部为 `session/title` 与一条 `write_file` 工具调用，其后才是第一个 `turn/start`
- **WHEN** 系统切分并折叠
- **THEN** 首个 item 的 `title` 取自该 `session/title`，且 `fileOperations` 包含该写入路径

#### Scenario: 纯种子段归为 round=0 的单条 item

- **GIVEN** 会话事件流在首个 `turn/start` 之前包含若干事件，且整段无 `turn/start`
- **WHEN** 系统切分
- **THEN** 返回单条 item，其 `round` 为 0、`endReason` 为 `seed`

### Requirement: 每条 item 携带轮次序号与结束原因

系统 SHALL 为每条 `SessionEventTagItem` 提供 `round: number` 与 `endReason: RoundEndReason` 字段。`round` MUST 取该轮 `turn/start.data.turn`（1-based），前导段为 0。`endReason` MUST 取该轮最后一条 `turn/end.reason.kind`（`completed`/`aborted`/`error`/`interrupted`/`max-tokens`/`blocked`）；末轮且无 `turn/end` 时为 `ongoing`；纯前导段为 `seed`。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`（`classifyRoundEndReason`）、`packages/dsh-session-host/src/contract.ts`（`RoundEndReason`）

#### Scenario: 正常结束轮次标记 completed

- **GIVEN** 某轮末条 `turn/end.reason.kind` 为 `completed`
- **WHEN** 系统分类结束原因
- **THEN** 该 item 的 `endReason` 为 `completed`

#### Scenario: 异常终止轮次标记 error/aborted

- **GIVEN** 某轮末条 `turn/end.reason.kind` 为 `error`
- **WHEN** 系统分类结束原因
- **THEN** 该 item 的 `endReason` 为 `error`

#### Scenario: 进行中且无 turn/end 标记 ongoing

- **GIVEN** 末轮事件停留在 `assistant/chunk` 中途且无 `turn/end`
- **WHEN** 系统分类结束原因
- **THEN** 该 item 的 `endReason` 为 `ongoing`

### Requirement: 轮次统计复用现有折叠工具

系统 SHALL 对每个 turn 段复用 `foldStats` / `extractUserMessages` / `extractFileOperations` / `extractSessionTitle` 计算 `turns`、`userMessages`、`assistantMessages`、`toolCalls`、`userMessageTexts`、`fileOperations`、`startedAt`、`updatedAt`、`totalEvents`、`title`，MUST NOT 重复实现统计逻辑。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`、`packages/dsh-session-host/src/index.ts`

#### Scenario: 各轮统计相互独立

- **GIVEN** 会话含 2 个 turn，各自有独立用户消息与工具调用
- **WHEN** 系统逐段折叠
- **THEN** 两条 item 的 `userMessages` / `toolCalls` 仅包含各自段内的事件，互不包含

### Requirement: 契约与错误码向后兼容

系统 MUST 保持 `workspace.session.tag` 的 RPC 信封（`type`/`rpcId`/`result.ok`/`error`）与错误码（`method-not-allowed`、`session-id-required`、`history-fetch-failed`、`session-tag-query-failed`）不变；宿主与客户端 `items` 结构 MUST 类型一致。

**模块归属**：`packages/dsh-session-host/src/index.ts`、`packages/dsh-session-client/src/utils/tag-api.ts`、`apiDocs/plugin-api/workspace.session.tag.md`

#### Scenario: 缺失 sessionId 返回既有错误码

- **GIVEN** 请求体不含 `sessionId`
- **WHEN** 调用 `workspace.session.tag`
- **THEN** 响应为 `{ ok: false, error: 'session-id-required' }`，状态码 400

#### Scenario: 客户端类型与宿主一致

- **GIVEN** 宿主 `contract.ts` 将 `WorkspaceSessionTagResponse.value` 改为 `{ items; hasMore }`
- **WHEN** 运行 `pnpm typecheck`
- **THEN** 客户端 `WorkspaceSessionTagValue` 的 `items` 结构与宿主 `SessionEventTagItem` 字段一致，0 编译错误
