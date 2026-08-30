## 1. 类型契约变更（host contract.ts）

- [x] 1.1 为 `SessionEventTagItem` 新增 `assistantMessageTexts: string[]`（置于 `userMessageTexts` 之后，保留 `assistantMessages: number` 计数）
  变更文件：packages/dsh-session-host/src/contract.ts
  变更内容：
  ```diff
   /** 单个会话事件数据标签条目 */
   export interface SessionEventTagItem {
     /** 会话 ID */
     sessionId: string
     /** 会话标题 */
     title: string | null
     /** 轮次序号（1-based，取自 turn/start.data.turn；纯前导段为 0） */
     round: number
     /** 本轮结束/异常原因 */
     endReason: RoundEndReason
     /** 轮次数 */
     turns: number
     /** 用户消息数（仅 source.kind==='user'） */
     userMessages: number
     /** 助手消息数 */
     assistantMessages: number
     /** 工具调用统计（按调用次数降序） */
     toolCalls: Array<{ name: string; count: number }>
     /** 用户真实提问文本列表 */
     userMessageTexts: string[]
  +  /** LLM(助手)返回的可读文本列表（取 assistant/message 中 content.type==='text' 的片段） */
  +  assistantMessageTexts: string[]
     /** 写文件操作路径列表 */
     fileOperations: string[]
     /** 活动开始时间（epoch ms） */
     startedAt: number | null
     /** 活动结束时间（epoch ms） */
     updatedAt: number | null
     /** 事件总数 */
     totalEvents: number
   }
  ```

## 2. 抽取工具（session-history.ts + utils/index.ts）

- [x] 2.1 在 `session-history.ts` 新增 `extractAssistantMessages`，镜像 `extractUserMessages`（仅取 `assistant/message`、`content.type==='text'`）
  变更文件：packages/dsh-session-host/src/utils/session-history.ts
  变更内容（在 `extractUserMessages` 之后追加）：
  ```diff
   /** 提取用户真实提问文本（source.kind==='user' 的 user/message） */
   export function extractUserMessages(events: readonly SessionHistoryEvent[]): string[] {
     const messages: string[] = []
     for (const entry of events) {
       if (entry.event.type !== EventType.USER_MESSAGE) continue
       const data = entry.event.data as unknown as UserMessageData
       if (data.source?.kind !== 'user') continue
       const text = data.content
         ?.filter((c) => c.type === 'text')
         .map((c) => c.text)
         .join('\n')
       if (text) messages.push(text)
     }
     return messages
   }
  +
  +/** 提取 LLM(助手)返回的可读文本（assistant/message 中 content.type==='text' 的片段） */
  +export function extractAssistantMessages(events: readonly SessionHistoryEvent[]): string[] {
  +  const messages: string[] = []
  +  for (const entry of events) {
  +    if (entry.event.type !== EventType.ASSISTANT_MESSAGE) continue
  +    const data = entry.event.data as unknown as AssistantMessageData
  +    const text = data.content
  +      ?.filter((c) => c.type === 'text')
  +      .map((c) => c.text)
  +      .join('\n')
  +    if (text) messages.push(text)
  +  }
  +  return messages
  +}
  ```

- [x] 2.2 在 `utils/index.ts` 导出 `extractAssistantMessages`
  变更文件：packages/dsh-session-host/src/utils/index.ts
  变更内容：
  ```diff
   export {
     EventType,
     foldStats,
     fetchSessionHistory,
     fetchAllSessionEvents,
     extractUserMessages,
  +  extractAssistantMessages,
     extractFileOperations,
     extractSessionTitle,
     splitTurns,
     classifyRoundEndReason,
   } from './session-history.js'
  ```

## 3. Handler 改造（host index.ts）

- [x] 3.1 在 `index.ts` 引入 `extractAssistantMessages`，并在逐轮折叠循环内调用，写入 item 的 `assistantMessageTexts`
  变更文件：packages/dsh-session-host/src/index.ts
  变更内容（import 区）：
  ```diff
   import {
     readWorkspaceTags,
     writeWorkspaceTags,
     deleteWorkspaceFile,
     dshRpcCall,
     fetchAllSessionEvents,
     foldStats,
     extractUserMessages,
  +  extractAssistantMessages,
     extractFileOperations,
     extractSessionTitle,
     splitTurns,
     classifyRoundEndReason,
     EventType,
   } from './utils/index.js'
  ```
  变更内容（handler 折叠循环体，约 266-288 行）：
  ```diff
         const items: SessionEventTagItem[] = segments.map((seg) => {
           const stats = foldStats(seg)
           const userMessageTexts = extractUserMessages(seg)
  +        const assistantMessageTexts = extractAssistantMessages(seg)
           const fileOperations = extractFileOperations(seg)
           const title = extractSessionTitle(seg)
           const turnStart = seg.find(
             (e) => e.event.type === EventType.TURN_START,
           )?.event.data as unknown as TurnStartData | undefined
           return {
             sessionId,
             title: title ?? stats.title,
             round: turnStart?.turn ?? 0,
             endReason: classifyRoundEndReason(seg),
             turns: stats.turns,
             userMessages: stats.userMessages,
             assistantMessages: stats.assistantMessages,
             toolCalls: stats.toolCalls,
             userMessageTexts,
  +          assistantMessageTexts,
             fileOperations,
             startedAt: stats.startedAt,
             updatedAt: stats.updatedAt,
             totalEvents: stats.totalEvents,
           }
         })
  ```

## 4. 客户端类型同步（client tag-api.ts）

- [x] 4.1 客户端 `SessionEventTagItem` 同步新增 `assistantMessageTexts: string[]`
  变更文件：packages/dsh-session-client/src/utils/tag-api.ts
  变更内容（client `SessionEventTagItem` 接口）：
  ```diff
   export interface SessionEventTagItem {
     sessionId: string
     title: string | null
     round: number
     endReason: RoundEndReason
     turns: number
     userMessages: number
     assistantMessages: number
     toolCalls: ToolCallStat[]
     userMessageTexts: string[]
  +  assistantMessageTexts: string[]
     fileOperations: string[]
     startedAt: number | null
     updatedAt: number | null
     totalEvents: number
   }
  ```
  说明：客户端 `src/index.ts` 仅 `console.log` 结果，类型变更后无需改动访问逻辑。

## 5. API 文档同步

- [x] 5.1 更新 `apiDocs/plugin-api/workspace.session.tag.md` 出参表，新增 `value.items[].assistantMessageTexts`，并在功能说明补充「含 LLM 返回文本」
  变更文件：apiDocs/plugin-api/workspace.session.tag.md
  变更内容（出参表新增一行，置于 `userMessageTexts` 之后）：
  ```diff
   | `value.items[].userMessageTexts` | `string[]` | 用户真实提问文本列表。 |
  +| `value.items[].assistantMessageTexts` | `string[]` | LLM(助手)返回的可读文本列表（取 `assistant/message` 中 `content.type==='text'` 的片段，按事件顺序 join）。 |
   | `value.items[].fileOperations` | `string[]` | 写文件操作路径列表（`write_file`/`edit`/`write` 工具，去重）。 |
  ```

## 6. 测试同步与新增

- [x] 6.1 同步宿主测试 `workspace-session-tag.test.ts`：item 断言新增 `assistantMessageTexts`，并在 mock 中为该字段提供期望值
  变更文件：packages/dsh-session-host/__tests__/workspace-session-tag.test.ts
  变更内容（约 351-365 行 `body.value.items[0]` 断言块）：
  ```diff
       expect(body.value.items[0]).toMatchObject({
         sessionId: 'session-abc',
         title: '你好',
         round: 1,
         endReason: 'completed',
         turns: 1,
         userMessages: 1,
         assistantMessages: 1,
         toolCalls: [{ name: 'read_files', count: 1 }],
         userMessageTexts: ['你好'],
  +      assistantMessageTexts: ['你好，已为你创建文件'],
         fileOperations: [],
         startedAt: 1000,
         updatedAt: 1004,
         totalEvents: 5,
       })
  ```
  说明：mock 的 `mockExtractAssistantMessages` 需返回 `['你好，已为你创建文件']`，并在 `vi.mock` 的 `session-history.js` 工厂中导出。

- [x] 6.2 同步客户端测试 `tag-api.test.ts`：mock value.items[0] 新增 `assistantMessageTexts`
  变更文件：packages/dsh-session-client/__tests__/tag-api.test.ts
  变更内容（约 378-392 行 mock 的 items[0]）：
  ```diff
                 userMessageTexts: ['你好'],
  +              assistantMessageTexts: ['已为你创建文件'],
                 fileOperations: [],
  ```

- [x] 6.3 新增 `extractAssistantMessages` 单元测试（正文抽取 + tool_use 块排除）
  变更文件：packages/dsh-session-host/__tests__/session-turn-split.test.ts（沿用或新建 assistant-extract.test.ts）
  变更内容（新增 describe 块）：
  ```diff
  +import { extractAssistantMessages } from '../src/utils/session-history.js'
  +describe('extractAssistantMessages', () => {
  +  it('抽取 assistant/message 的 text 块', () => {
  +    const events = [
  +      ev(0, 'turn/start', { turn: 1 }),
  +      ev(1, 'assistant/message', { content: [{ type: 'text', text: '已创建文件' }] }),
  +      ev(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  +    ]
  +    expect(extractAssistantMessages(events)).toEqual(['已创建文件'])
  +  })
  +
  +  it('非 text 块（tool_use）不计入文本列表', () => {
  +    const events = [
  +      ev(0, 'assistant/message', { content: [{ type: 'tool_use', text: 'call read_files' }] }),
  +    ]
  +    expect(extractAssistantMessages(events)).toEqual([])
  +  })
  +
  +  it('忽略非 assistant/message 事件', () => {
  +    const events = [ev(0, 'user/message', { content: [{ type: 'text', text: '你好' }] })]
  +    expect(extractAssistantMessages(events)).toEqual([])
  +  })
  +})
  ```

## 7. 类型校验与验证

- [x] 7.1 运行 `pnpm typecheck` 与 `pnpm test` 确认通过
  变更文件：无（命令执行）
  验收标准：`typecheck` 0 错误；`workspace-session-tag.test.ts`、`tag-api.test.ts`、`session-turn-split.test.ts`（含新增用例）全部通过。

## 8. 子代理任务审计

- [x] 8.1 调用子代理对全部改动做审计：contract/client 字段一致、handler 逐轮调用 `extractAssistantMessages`、`tool_use` 块被排除、测试断言一致、文档与代码一致；发现问题即修复并重新审计，直至无阻断性问题
  审计重点清单：
  - [x] contract.ts 与 tag-api.ts 的 `assistantMessageTexts` 字段位置/类型一致。
  - [x] `extractAssistantMessages` 仅取 `assistant/message` 且过滤 `type==='text'`；`tool_use`/`reasoning` 被排除。
  - [x] handler 在 `segments.map` 内调用，每条 item 自带 `assistantMessageTexts`。
  - [x] 既有 `assistantMessages` 计数字段未被移除。
  - [x] host/client 测试已同步 `assistantMessageTexts`，断言正确。
  - [x] apiDocs 出参与 contract.ts 一致。
