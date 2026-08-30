# Design: session-tag-assistant-think

## 新增思考过程抽取器

位于 `packages/dsh-session-host/src/utils/session-history.ts`：

```ts
/** 将工具输入压缩为可读摘要（用于思考过程展示），超长截断 */
export function summarizeToolInput(
  input: Record<string, unknown> | undefined,
  maxLen = 200,
): string {
  if (!input || typeof input !== 'object') return ''
  let s: string
  try {
    s = JSON.stringify(input)
  } catch {
    s = String(input)
  }
  if (s.length > maxLen) s = s.slice(0, maxLen) + '…'
  return s
}

/**
 * 抽取 LLM(助手)的完整思考过程（按事件顺序）：
 * - assistant/message 中 content.type==='reasoning' 的文本（每消息合并为 1 条）
 * - tool/call 事件 → 「调用工具 <name>（<input摘要>）」
 * 返回有序 string[]，即「思考链 + 工具决策」。
 */
export function extractAssistantThinking(
  events: readonly SessionHistoryEvent[],
): string[] {
  const steps: string[] = []
  for (const entry of events) {
    const { type, data } = entry.event
    if (type === EventType.ASSISTANT_MESSAGE) {
      const d = data as unknown as AssistantMessageData
      const reasoning = extractContentText(d.message?.content ?? d.content, {
        include: ['reasoning'],
      })
      if (reasoning) steps.push(reasoning)
    } else if (type === EventType.TOOL_CALL) {
      const d = data as unknown as ToolCallData
      const summary = summarizeToolInput(d.input)
      steps.push(`调用工具 ${d.name}${summary ? `（${summary}）` : ''}`)
    }
  }
  return steps
}
```

## 类型扩展

`contract.ts` 与 `tag-api.ts` 的 `SessionEventTagItem` 增加（紧邻 `assistantMessageTexts`）：

```ts
/** LLM(助手)思考过程（reasoning 思考文本 + tool/call 工具调用，按事件顺序；不含最终答案正文） */
assistantThinkTexts: string[]
```

## handler 改造

`packages/dsh-session-host/src/index.ts` 逐轮折叠内新增一行并写入 item：

```ts
const assistantThinkTexts = extractAssistantThinking(seg)
// ...
return {
  // ...既有字段
  userMessageTexts,
  assistantMessageTexts,
  assistantThinkTexts,   // 新增
  fileOperations,
  // ...
}
```

同时 `index.ts` 顶部 import 增加 `extractAssistantThinking`。

## 复用与一致性

- 复用既有 `extractContentText`（include: ['reasoning']），与 `utils-llm-content-extract` 提案一致，避免重复实现内容块过滤。
- `assistantMessageTexts`（仅 text）语义不变，与 `assistantThinkTexts`（reasoning + tool）形成双轨，互不重叠。

## 导出

`packages/dsh-session-host/src/utils/index.ts` 增加导出 `extractAssistantThinking`。
