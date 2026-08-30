## ADDED Requirements

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
