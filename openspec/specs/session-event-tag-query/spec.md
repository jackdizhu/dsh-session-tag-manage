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

### Requirement: 每条 item 携带 LLM(助手)思考过程

系统 SHALL 为每条 `SessionEventTagItem` 提供 `assistantThinkTexts: string[]` 字段，包含该轮（turn 段）内 LLM 的**完整思考过程**：按事件顺序收集 (a) `assistant/message` 事件中 `content.type==='reasoning'` 的文本（每消息的 reasoning 合并为 1 条），以及 (b) `tool/call` 事件（形如 `调用工具 <name>（<input摘要>）`）。该字段 MUST 与 `assistantMessageTexts`（仅最终答案正文，`type==='text'`）形成「思考 vs 正文」双轨，二者互不重叠；既有的 `assistantMessageTexts`、`assistantMessages` 等字段 MUST 保留不移除。

**模块归属**：`packages/dsh-session-host/src/contract.ts`、`packages/dsh-session-host/src/utils/session-history.ts`（`extractAssistantThinking`、`summarizeToolInput`）、`packages/dsh-session-host/src/index.ts`、`packages/dsh-session-client/src/utils/tag-api.ts`

#### Scenario: 单轮含 reasoning 思考文本

- **GIVEN** 某轮 1 个 `assistant/message`，其 `content=[{type:'reasoning', text:'用户只是打招呼'},{type:'text', text:'你好！'}]`
- **WHEN** 系统折叠该轮
- **THEN** 该 item 的 `assistantThinkTexts` 含 `'用户只是打招呼'`，且 `assistantMessageTexts` 为 `['你好！']`（thinking 与正文分离）

#### Scenario: tool/call 作为思考过程的一部分

- **GIVEN** 某轮思维链为 reasoning → 调用 `write_file`（`input={file_path:'a.ts'}`）→ 继续 reasoning
- **WHEN** 系统抽取思考过程
- **THEN** `assistantThinkTexts` 按顺序含 reasoning 文本与 `调用工具 write_file（{"file_path":"a.ts"}）` 片段

#### Scenario: 仅 text 无思考的轮次

- **GIVEN** 某 `assistant/message` 仅有 `type==='text'` 块，且无任何 `tool/call`
- **WHEN** 系统抽取思考过程
- **THEN** `assistantThinkTexts` 为空数组，且 `assistantMessageTexts` 仍含该正文

### Requirement: 思考过程抽取工具按事件顺序聚合

系统 SHALL 提供 `extractAssistantThinking(events)`，仅遍历 `assistant/message` 与 `tool/call` 事件、按事件 seq 顺序生成思考片段数组；MUST NOT 混入 `user/message` 文本或 `tool/result` 内容。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`、`packages/dsh-session-host/src/utils/index.ts`（导出）

#### Scenario: 忽略非思考相关事件

- **GIVEN** 事件流含 `user/message`、`tool/result` 等事件
- **WHEN** 调用 `extractAssistantThinking`
- **THEN** 返回数组不包含上述事件内容

### Requirement: 每条 item 携带 LLM(助手)返回文本

系统 SHALL 为每条 `SessionEventTagItem` 提供 `assistantMessageTexts: string[]` 字段，包含该轮（turn 段）内所有 `assistant/message` 事件的可读文本（取 `content` 中 `type==='text'` 的片段，按事件顺序 `join('\n')`）。该字段 MUST 与既有 `userMessageTexts`（用户提问）同源异构——前者为 LLM 返回内容、后者为用户输入内容；既有的 `assistantMessages: number` 计数字段 MUST 保留不移除。

**模块归属**：`packages/dsh-session-host/src/contract.ts`、`packages/dsh-session-host/src/utils/session-history.ts`（`extractAssistantMessages`）、`packages/dsh-session-host/src/index.ts`、`packages/dsh-session-client/src/utils/tag-api.ts`

#### Scenario: 单轮返回助手正文

- **GIVEN** 某轮含 1 个 `assistant/message`，其 `content=[{type:'text', text:'已帮你创建文件'}]`
- **WHEN** 系统折叠该轮
- **THEN** 该 item 的 `assistantMessageTexts` 为 `['已帮你创建文件']`，且 `assistantMessages` 计数为 1

#### Scenario: 仅含 tool_use 块的助手消息不计入文本列表

- **GIVEN** 某 `assistant/message` 仅含 `tool_use` 块（`content=[{type:'tool_use', text:'call read_files'}]`）
- **WHEN** 系统抽取助手文本
- **THEN** `assistantMessageTexts` 为空数组（按 `type==='text'` 过滤排除非正文块）

#### Scenario: 多轮各自携带本轮回复

- **GIVEN** 会话含 2 个 turn，各自有独立 `assistant/message` 正文
- **WHEN** 系统逐轮折叠
- **THEN** 两条 item 的 `assistantMessageTexts` 仅包含各自段内的助手文本，互不包含

### Requirement: 抽取工具镜像用户消息抽取行为

系统 SHALL 提供 `extractAssistantMessages(events)` 工具，仅遍历 `assistant/message` 事件、取 `content.type==='text'` 片段并 `join('\n')`，其过滤与拼接行为与 `extractUserMessages` 镜像一致；MUST NOT 混入用户消息或 `tool/result` 文本。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`、`packages/dsh-session-host/src/utils/index.ts`（导出）

#### Scenario: 忽略非 assistant/message 事件

- **GIVEN** 事件流含 `user/message` 与 `tool/result` 等其它类型事件
- **WHEN** 调用 `extractAssistantMessages`
- **THEN** 返回数组不包含上述事件的内容

### Requirement: 通用内容块抽取工具

系统 SHALL 在 `packages/dsh-session-host/src/utils/session-history.ts` 提供通用内容块抽取器 `extractContentText(blocks, opts?)` 与共享类型 `ContentBlock`，用于按 `type` 过滤并抽取 LLM 消息文本块。`extractUserMessages` 与 `extractAssistantMessages` MUST 复用该工具，MUST NOT 各自重复实现内容块过滤逻辑。

**模块归属**：`packages/dsh-session-host/src/utils/session-history.ts`、`packages/dsh-session-host/src/utils/index.ts`

#### Scenario: 默认排除 reasoning 且仅取 text

- **GIVEN** 一段 content 含 `type: 'text'` 与 `type: 'reasoning'` 块
- **WHEN** 调用 `extractContentText(blocks, { include: ['text'] })`
- **THEN** 返回仅包含 text 块文本的字符串，reasoning 被排除

#### Scenario: 两个 extractor 行为等价且不重复实现

- **GIVEN** 既有 `extractUserMessages` / `extractAssistantMessages` 的测试用例
- **WHEN** 二者重构为复用 `extractContentText`
- **THEN** 所有既有测试仍通过，且 user/assistant 文本嵌套差异（data.content vs data.message.content）仍被正确兼容

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
