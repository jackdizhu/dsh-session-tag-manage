# 提案：workspace.session.tag 补充 LLM(助手)返回文本字段

## Why

上一轮变更 `session-tag-turn-items` 已将 `workspace.session.tag` 出参改为按 `turn` 切分的 `items` 数组，并为每条 `SessionEventTagItem` 增加了 `round` / `endReason`。

但当前 `SessionEventTagItem` 仍**只暴露了用户的输入、不暴露 LLM 的产出**：
- `userMessageTexts: string[]` —— 用户真实提问文本（已抽取）；
- `assistantMessages: number` —— 仅**计数**，没有文本；
- 缺少 `assistant/message` 事件的实际返回内容。

这导致调用方（不管是前端逐轮跟进、还是后续做「LLM 到底回了什么」的检索/摘要）**无法拿到每轮助手到底返回了什么**。本次需要补齐「LLM 返回数据」，让每条 item 既含用户原话、也含助手原话，形成完整的「问—答」闭环。

## What Changes

- **非破坏性（字段新增）**：为 `SessionEventTagItem` 新增 `assistantMessageTexts: string[]`，与 `userMessageTexts` 同源异构（前者 LLM 返回、后者用户提问）；既有的 `assistantMessages: number` 计数字段 **保留不移除**（计数仍有统计价值）。
- 新增抽取工具 `extractAssistantMessages(events)`（镜像 `extractUserMessages`）：遍历 `assistant/message` 事件，取 `content` 中 `type==='text'` 的片段、按事件顺序 `join('\n')`，返回 `string[]`。
- 宿主 handler 逐轮折叠时调用 `extractAssistantMessages(seg)`，写入 item 的 `assistantMessageTexts`。
- 宿主（`contract.ts`）与客户端（`tag-api.ts`）共享类型两处同步。
- API 文档 `apiDocs/plugin-api/workspace.session.tag.md` 同步出参新增字段。
- 不改动 RPC 信封、`hasMore`、`items` 结构、错误码、分页逻辑。

## Capabilities

### Modified Capabilities

- `session-event-tag-query`：在既有「按 turn 切分返回 items 数组」能力上，**新增**每条 item 携带 `assistantMessageTexts` 的要求与场景。模块归属：`packages/dsh-session-host/`（契约 + 工具 + handler）、`packages/dsh-session-client/`（类型同步）。

### New Capabilities

- （无）

## Impact

- **代码**：
  - `packages/dsh-session-host/src/contract.ts` —— `SessionEventTagItem` 增加 `assistantMessageTexts: string[]`。
  - `packages/dsh-session-host/src/utils/session-history.ts` —— 新增 `extractAssistantMessages`。
  - `packages/dsh-session-host/src/utils/index.ts` —— 导出 `extractAssistantMessages`。
  - `packages/dsh-session-host/src/index.ts` —— handler 逐轮调用 `extractAssistantMessages(seg)`。
  - `packages/dsh-session-client/src/utils/tag-api.ts` —— 同步 `SessionEventTagItem.assistantMessageTexts`。
  - `apiDocs/plugin-api/workspace.session.tag.md` —— 同步出参字段。
- **API/契约**：`assistantMessageTexts` 为**新增可选友好字段**，不影响既有字段与解析；错误码与信封不变。
- **依赖**：无新增依赖。
- **客户端 UI**：当前客户端仅 `console.log`，无 UI 改动；类型同步以免 `typecheck` 失败。

---

## 设计说明

- **抽取规则 `extractAssistantMessages(events)`**：仅取 `event.type === EventType.ASSISTANT_MESSAGE`；对每个事件，`content?.filter(c => c.type === 'text').map(c => c.text).join('\n')`，非空则推入结果数组。与 `extractUserMessages` 完全镜像，保证 `userMessageTexts` / `assistantMessageTexts` 行为一致、便于对照。
- **为什么过滤 `type==='text'`**：`assistant/message` 的 `content` 可能含 `tool_use` 等结构块（其 `type` 不为 `text`），按 `text` 过滤可只保留人类可读的助手正文，避免把工具调用指令混入文本列表。推理/思考（reasoning/thinking）块同样按 `type` 过滤排除——若后续需要「思考过程」可单独加字段，不在本次范围。
- **逐轮而非全局**：因 `items` 已按 `turn` 切分，将 `assistantMessageTexts` 放在每条 item 内，天然实现「每轮 LLM 返回了什么」的细粒度呈现。

## 任务列表

详细实现任务（含文件变更路径与 diff 片段）见 `tasks.md`，按以下顺序执行：

1. 更新 `contract.ts` 类型定义（item 增加 `assistantMessageTexts`）。
2. 新增 `extractAssistantMessages` 工具并导出。
3. 改造 `index.ts` handler 逐轮写入 `assistantMessageTexts`。
4. 同步客户端 `tag-api.ts` 的 `SessionEventTagItem`。
5. 同步 API 文档 `workspace.session.tag.md`。
6. 同步与新增测试（`extractAssistantMessages` 单元 + host/client 断言）。
7. `pnpm typecheck` + `pnpm test` 校验。
8. 子代理任务审计（末项，闭环）。

## 验证方案

- **单元验证**：构造含「多轮 + 单条 assistant 正文 + 仅 tool_use 块」的样例事件，断言 `extractAssistantMessages` 正确抽取文本、`tool_use` 块被排除。
- **类型一致性**：运行 `pnpm typecheck`，确认 host 与 client `assistantMessageTexts` 字段一致、0 编译错误。
- **集成冒烟**：host handler 测试断言 `value.items[].assistantMessageTexts` 与 mock 数据一致。
- **文档一致性**：核对 `apiDocs/plugin-api/workspace.session.tag.md` 出参与 `contract.ts` 类型一致。
