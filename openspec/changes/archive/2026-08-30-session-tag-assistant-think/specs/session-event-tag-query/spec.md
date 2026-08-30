## ADDED Requirements

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
