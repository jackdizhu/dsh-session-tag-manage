# Spec Delta: Session Event Tag Query — utils-llm-content-extract

## Requirement: 通用内容块抽取工具

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
