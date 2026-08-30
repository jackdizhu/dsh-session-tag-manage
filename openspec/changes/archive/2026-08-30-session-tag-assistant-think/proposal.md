# 提案：workspace.session.tag 新增 LLM(助手)思考过程字段

## Why

当前 `SessionEventTagItem` 已能返回每轮的用户原话 `userMessageTexts` 与助手正文 `assistantMessageTexts`（仅 `type==='text'`，已排除 `reasoning` 思考过程）。但对于带推理（reasoning）能力的模型与多步工具调用场景，调用方**无法拿到助手的「思考过程」**：

- `assistant/message` 的 `content` 中 `type==='reasoning'` 的块（真实样本见 `api_session.history.md` 第 4207 行：`{ type: 'reasoning', text: '...' }`）目前被整体丢弃；
- 助手在思考中**决定调用哪些工具**（`tool/call` 事件）也未纳入「思考」语义。

这让「这个助手到底怎么想的、为什么调这些工具」不可见。本提案把 Think 数据抽到一个**独立的思考过程字段** `assistantThinkTexts`，包含 reasoning 思考文本与 `tool/call` 工具调用，构成**完整的思考过程**。

## What Changes

- **非破坏性（字段新增）**：为 `SessionEventTagItem` 新增 `assistantThinkTexts: string[]`，与 `assistantMessageTexts`（最终答案正文）形成「正文 vs 思考」的双轨；已有字段全部保留。
- 新增抽取工具 `extractAssistantThinking(events)`：按事件顺序收集
  1. `assistant/message` 事件中 `content.type==='reasoning'` 的文本（用 `extractContentText(content, { include: ['reasoning'] })` 抽取，每个 assistant 消息的 reasoning 合并为 1 条片段）；
  2. `tool/call` 事件 → 形如 `调用工具 {name}（{input摘要}）` 的片段。
  两者按事件 seq 顺序合并为有序数组，即「完整思考过程」。
- 宿主 handler 逐轮折叠时调用 `extractAssistantThinking(seg)`，写入 item 的 `assistantThinkTexts`。
- 宿主（`contract.ts`）与客户端（`tag-api.ts`）共享类型两处同步。
- API 文档 `apiDocs/plugin-api/workspace.session.tag.md` 同步出参新增字段。
- 不改动 RPC 信封、`hasMore`、`items` 结构、错误码、分页逻辑，也**不改动** `assistantMessageTexts` 的既有语义（仍仅 `type==='text'`）。

## Capabilities

### Modified Capabilities

- `session-event-tag-query`：在每条 item 既有 `userMessageTexts` / `assistantMessageTexts` 基础上，**新增** `assistantThinkTexts`（思考过程：reasoning 文本 + tool/call 调用）。

### New Capabilities

- （无）

## Impact

- **代码**：
  - `packages/dsh-session-host/src/contract.ts` —— `SessionEventTagItem` 增加 `assistantThinkTexts: string[]`。
  - `packages/dsh-session-host/src/utils/session-history.ts` —— 新增 `extractAssistantThinking` 与 `summarizeToolInput` 辅助；复用 `extractContentText`。
  - `packages/dsh-session-host/src/utils/index.ts` —— 导出 `extractAssistantThinking`。
  - `packages/dsh-session-host/src/index.ts` —— handler 逐轮调用 `extractAssistantThinking(seg)`。
  - `packages/dsh-session-client/src/utils/tag-api.ts` —— 同步 `SessionEventTagItem.assistantThinkTexts`。
  - `apiDocs/plugin-api/workspace.session.tag.md` —— 同步出参字段。
- **API/契约**：`assistantThinkTexts` 为**新增可选友好字段**，不影响既有字段与解析；错误码与信封不变。
- **依赖**：无新增依赖。
- **客户端 UI**：当前客户端仅 `console.log`，无 UI 改动；类型同步以免 `typecheck` 失败。

## 设计说明

- **抽取规则 `extractAssistantThinking(events)`**：遍历事件，按 seq 顺序：
  - `assistant/message` → `extractContentText(message.content ?? content, { include: ['reasoning'] })`，非空则该消息 reasoning 作为 1 条思考片段；
  - `tool/call` → 生成 `调用工具 {name}（{摘要}）` 作为 1 条思考片段（工具调用是思考决策的一环）；
  - 返回有序 `string[]`。无 reasoning 也无 tool/call 时为空数组。
- **为什么独立字段**：`assistantMessageTexts` 维持「人类可读最终答案」语义（仅 text），思考过程单独成列，便于前端分别渲染「回答」与「思考链」，互不污染。
- **tool/call 纳入思考**：用户明确要求「包括 toolCalls 调用」——工具调用由助手在思考中决策，是完整思考过程的一部分。

## 任务列表

详细实现任务（含文件变更路径与 diff 片段）见 `tasks.md`，按以下顺序执行：

1. 更新 `contract.ts` 类型定义（item 增加 `assistantThinkTexts`）。
2. 新增 `extractAssistantThinking` / `summarizeToolInput` 工具并导出。
3. 改造 `index.ts` handler 逐轮写入 `assistantThinkTexts`。
4. 同步客户端 `tag-api.ts` 的 `SessionEventTagItem`。
5. 同步 API 文档 `workspace.session.tag.md`。
6. 同步与新增测试（`extractAssistantThinking` 单元 + host/client 断言）。
7. `tsc --noEmit` + `vitest run` 校验。
8. 子代理任务审计（末项，闭环）。

## 验证方案

- **单元验证**：构造「assistant reasoning 块 + assistant text 块 + 多个 tool/call」样例，断言 `extractAssistantThinking` 正确抽取 reasoning 文本、生成 tool/call 片段、且 `assistantMessageTexts` 不含 reasoning。
- **类型一致性**：运行 `tsc --noEmit`，确认 host 与 client `assistantThinkTexts` 字段一致、0 编译错误。
- **集成冒烟**：host handler 测试断言 `value.items[].assistantThinkTexts` 与 mock 数据一致。
- **文档一致性**：核对 `apiDocs/plugin-api/workspace.session.tag.md` 出参与 `contract.ts` 类型一致。
