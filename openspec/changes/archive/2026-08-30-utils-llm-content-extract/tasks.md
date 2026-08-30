# Tasks: utils-llm-content-extract

- [x] 1. 新增 `ContentBlock` 类型与 `extractContentText(blocks, opts?)` 通用抽取器（session-history.ts）
- [x] 2. 重构 `extractUserMessages` / `extractAssistantMessages` 复用 `extractContentText`，行为保持不变
- [x] 3. `utils/index.ts` 导出 `extractContentText` 与 `ContentBlock`
- [x] 4. 新增 `extractContentText` 单元测试（include / exclude 默认 / 空 / 多块 join）
- [x] 5. 运行 `tsc --noEmit` 与 `vitest run` 确认 0 错误、全绿
- [x] 6. 只读子代理审计：去重正确性、行为等价、类型一致、测试覆盖

## 审计清单

- [x] `extractContentText` 支持 include/exclude，默认排除 reasoning，空/undefined 安全
- [x] 两个 extractor 行为与原实现完全等价（仅取 text，assistant 保留 message.content 回退）
- [x] `utils/index.ts` 导出 `extractContentText` 与 `ContentBlock`
- [x] 新增单元测试覆盖 include/exclude/空/多块边界
- [x] 既有 extractor 测试无回归
- [x] `tsc --noEmit` 0 错误
