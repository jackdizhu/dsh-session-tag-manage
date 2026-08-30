# Proposal: utils-llm-content-extract

## Summary

`packages/dsh-session-host/src/utils/session-history.ts` 中，`extractUserMessages` 与 `extractAssistantMessages` 各自 copy 了同一段「内容块过滤」逻辑（`content.filter(c => c.type === 'text').map(c => c.text).join('\n')`）。这种重复 + user/assistant 布局差异（`data.content` vs `data.message.content`）正是上一轮 `assistantMessageTexts` 返回空数组 bug 的根因。

本提案引入一个**通用内容块抽取器** `extractContentText`，将两个 extractor 统一收敛到同一实现，从根上消除重复带来的脆弱性；并提供可配置的 `include`/`exclude`（默认排除 `reasoning`），为后续「思考链可见性」等扩展预留能力。

**非破坏性**：接口契约、`workspace.session.tag` 出参、客户端类型均不变；仅为内部 util 通用化重构，输出语义保持不变（仍仅取 `type==='text'`）。

## Motivation

- **去重**：文本内容抽取逻辑重复实现，违反 DRY，且每新增一种消息布局就要改两处。
- **防回归**：user/assistant 文本嵌套位置不同（`data.content` / `data.message.content`），重复实现容易漏改一边（已发生一次线上空数组 bug）。
- **可扩展**：`reasoning` 目前硬编码排除，若未来需要「思考链」，可复用同一工具的 `include: ['reasoning']`，无需再写一份抽取逻辑。

## 影响范围

- 只改 `packages/dsh-session-host/src/utils/session-history.ts`（新增 + 重构）与 `utils/index.ts`（导出）。
- 不涉及 `contract.ts`、`index.ts` handler、`tag-api.ts`、API 文档出参结构。
- 行为等价：抽取结果与原实现完全一致（仅取 text 块，`\n` 连接）。

## 验证方式

- `tsc --noEmit` 0 错误。
- `vitest run` 全绿（既有 extractor 测试 + 新增 `extractContentText` 测试）。
- 只读子代理审计：去重正确性、行为等价、类型一致、测试覆盖。
