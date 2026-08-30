# Tasks: session-tag-assistant-think

- [x] 1. `contract.ts` 的 `SessionEventTagItem` 增加 `assistantThinkTexts: string[]`（紧邻 `assistantMessageTexts`）
- [x] 2. `session-history.ts` 新增 `summarizeToolInput` 与 `extractAssistantThinking`（复用 `extractContentText`），`utils/index.ts` 导出
- [x] 3. `index.ts` handler 逐轮调用 `extractAssistantThinking(seg)` 并写入 item（`assistantThinkTexts`）
- [x] 4. `tag-api.ts` 同步 `SessionEventTagItem.assistantThinkTexts`
- [x] 5. API 文档 `workspace.session.tag.md` 同步出参新增字段
- [x] 6. 新增/同步测试（`extractAssistantThinking` 单元 + host/client 断言 `assistantThinkTexts`）
- [x] 7. `tsc --noEmit` + `vitest run` 校验 0 错误、全绿（126 tests pass）
- [x] 8. 只读子代理审计：字段语义、抽取顺序、类型一致、测试覆盖（无阻断性问题）

## 审计清单

- [x] `assistantThinkTexts` 含 reasoning 文本与 tool/call 片段，按事件顺序；无思考内容时为空数组
- [x] `assistantMessageTexts` 仍仅 `type==='text'`，不含 reasoning（双轨互不重叠）
- [x] host / client 类型一致，`tsc --noEmit` 0 错误
- [x] 新增单元测试覆盖：reasoning 抽取、tool/call 片段、纯 text 无 think、reasoning+text+tool 混合顺序
- [x] API 文档与 `contract.ts` 一致
