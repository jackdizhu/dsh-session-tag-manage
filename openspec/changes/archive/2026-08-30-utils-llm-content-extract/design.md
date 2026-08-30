# Design: utils-llm-content-extract

## 通用内容块抽取器

新增共享类型与函数（位于 `session-history.ts`）：

```ts
/** LLM 消息内容块（user/assistant 的 content 元素统一形态） */
export type ContentBlock = { type: string; text: string }

/**
 * 从内容块数组中按 type 过滤抽取文本。
 * - include 给定时，仅保留 include 内的 type；
 * - 否则排除 exclude 内的 type（默认 ['reasoning']）；
 * - 命中的块的 text 以 \n 连接。
 */
export function extractContentText(
  blocks: readonly ContentBlock[] | undefined,
  opts?: { include?: string[]; exclude?: string[] },
): string {
  const include = opts?.include
  const exclude = opts?.exclude ?? ['reasoning']
  return (blocks ?? [])
    .filter((b) => (include ? include.includes(b.type) : !exclude.includes(b.type)))
    .map((b) => b.text)
    .join('\n')
}
```

## 两个 extractor 收敛复用

```ts
export function extractUserMessages(events) {
  const messages: string[] = []
  for (const entry of events) {
    if (entry.event.type !== EventType.USER_MESSAGE) continue
    const data = entry.event.data as unknown as UserMessageData
    if (data.source?.kind !== 'user') continue
    const text = extractContentText(data.content, { include: ['text'] })
    if (text) messages.push(text)
  }
  return messages
}

export function extractAssistantMessages(events) {
  const messages: string[] = []
  for (const entry of events) {
    if (entry.event.type !== EventType.ASSISTANT_MESSAGE) continue
    const data = entry.event.data as unknown as AssistantMessageData
    const text = extractContentText(data.message?.content ?? data.content, { include: ['text'] })
    if (text) messages.push(text)
  }
  return messages
}
```

## 行为等价性说明

- 原实现 user/assistant 均只取 `type==='text'`；新实现用 `include: ['text']` 精确等价。
- `assistant` 的 `data.message?.content ?? data.content` 回退分支保留，兼容旧结构。
- `reasoning` 在 `include: ['text']` 下自然被排除，无需额外处理；同时 `extractContentText` 默认 `exclude: ['reasoning']` 为未来「思考链」扩展预留。

## 导出

`utils/index.ts` 增加导出 `extractContentText` 与 `ContentBlock`。
