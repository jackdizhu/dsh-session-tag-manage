## 1. 类型契约变更（host contract.ts）

- [x] 1.1 将 `WorkspaceSessionTagResponse.value` 由 `{ item }` 改为 `{ items; hasMore }`，新增 `RoundEndReason` 联合类型，并为 `SessionEventTagItem` 增加 `round` / `endReason` 字段、移除 `item.hasMore`
  变更文件：packages/dsh-session-host/src/contract.ts
  变更内容：
  ```diff
   // ===== workspace.session.tag 路由类型 =====

   /** 会话事件数据标签查询请求体 */
   export interface WorkspaceSessionTagRequest {
     /** 会话 ID */
     sessionId: string
     /** 单页最大消息数，默认 200 */
     maxMessages?: number
   }

  +/** 轮次结束/异常原因 */
  +export type RoundEndReason =
  +  | 'completed'
  +  | 'aborted'
  +  | 'error'
  +  | 'interrupted'
  +  | 'max-tokens'
  +  | 'blocked'
  +  | 'ongoing'
  +  | 'seed'
  +
   /** 单个会话事件数据标签条目 */
   export interface SessionEventTagItem {
     /** 会话 ID */
     sessionId: string
     /** 会话标题 */
     title: string | null
  +  /** 轮次序号（1-based，取自 turn/start.data.turn；纯前导段为 0） */
  +  round: number
  +  /** 本轮结束/异常原因 */
  +  endReason: RoundEndReason
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
     /** 写文件操作路径列表 */
     fileOperations: string[]
     /** 活动开始时间（epoch ms） */
     startedAt: number | null
     /** 活动结束时间（epoch ms） */
     updatedAt: number | null
     /** 事件总数 */
     totalEvents: number
  -  /** 是否还有更早的事件未读完 */
  -  hasMore: boolean
   }

   /** 会话事件数据标签查询响应体 */
   export interface WorkspaceSessionTagResponse {
     /** 请求是否成功 */
     ok: boolean
     /** 成功时返回的数据 */
     value?: {
  -    /** 会话事件数据标签条目 */
  -    item: SessionEventTagItem
  +    /** 按 turn 切分的会话事件数据标签条目数组 */
  +    items: SessionEventTagItem[]
  +    /** 会话事件流是否还有更早的分页未读完 */
  +    hasMore: boolean
     }
     /** 失败时返回的错误信息 */
     error?: string
   }
  ```

## 2. 轮次切分工具（session-history.ts + utils/index.ts）

- [x] 2.1 在 `session-history.ts` 新增 `splitTurns` / `classifyRoundEndReason`；扩展 `TurnEndData` 增加可选 `reason`；引入 `RoundEndReason` 类型引用
  变更文件：packages/dsh-session-host/src/utils/session-history.ts
  变更内容（顶部新增类型引用）：
  ```diff
   import {
     dshRpcCall,
     type DshRpcCallOptions,
     type DshRpcResult,
   } from './rpc-client.js'
  +
  +// RoundEndReason 由 contract.ts（类型枢纽）定义，此处仅做类型引用
  +import type { RoundEndReason } from '../contract.js'
  ```
  变更内容（扩展 TurnEndData）：
  ```diff
   /** turn/end 事件的 data 结构 */
   export interface TurnEndData {
     turn: number
  +  /** 结束原因（部分 DSH 版本可能缺失） */
  +  reason?: {
  +    kind: 'completed' | 'aborted' | 'error' | 'interrupted' | 'max-tokens' | 'blocked'
  +  }
   }
  ```
  变更内容（在文件末尾 `extractSessionTitle` 之后追加两个函数）：
  ```diff
   /** 提取会话标题（取最新的 session/title 事件） */
   export function extractSessionTitle(events: readonly SessionHistoryEvent[]): string | null {
     let title: string | null = null
     for (const entry of events) {
       if (entry.event.type !== EventType.SESSION_TITLE) continue
       const data = entry.event.data as unknown as SessionTitleData
       title = data.title
     }
     return title
   }
  +
  +// ===== 轮次切分与结束原因分类 =====
  +
  +/**
  + * 将事件流按 turn/start 边界切分为多个轮次段。
  + * 首条 turn/start 之前的前导事件（session/end-seed、session/title、request/header 等）并入首个 turn 轮次，不丢失任何事件。
  + *
  + * @param events - 已按 seq 升序的事件列表
  + * @returns 轮次段数组（顺序即轮次顺序），不含空段
  + */
  +export function splitTurns(events: readonly SessionHistoryEvent[]): SessionHistoryEvent[][] {
  +  const segments: SessionHistoryEvent[][] = []
  +  let current: SessionHistoryEvent[] | null = null
  +  let leading: SessionHistoryEvent[] = []
  +
  +  for (const entry of events) {
  +    if (entry.event.type === EventType.TURN_START) {
  +      // 开启新轮次：前导事件并入本段
  +      current = [...leading, entry]
  +      leading = []
  +      segments.push(current)
  +    } else if (current) {
  +      current.push(entry)
  +    } else {
  +      // 尚未遇到首个 turn/start：暂存为前导事件
  +      leading.push(entry)
  +    }
  +  }
  +
  +  // 纯前导段（整段无 turn/start）：作为单条 seed 段
  +  if (segments.length === 0 && leading.length > 0) {
  +    segments.push(leading)
  +  }
  +
  +  return segments
  +}
  +
  +/**
  + * 根据轮次段事件分类该轮的结束/异常原因。
  + * - 取该轮最后一条 turn/end 的 reason.kind → 对应枚举值；
  + * - 末轮且无 turn/end（中断/进行中）→ ongoing；
  + * - 纯前导段（无 turn/start）→ seed。
  + *
  + * @param events - 单个轮次段事件
  + * @returns 结束原因枚举
  + */
  +export function classifyRoundEndReason(events: readonly SessionHistoryEvent[]): RoundEndReason {
  +  const hasTurnStart = events.some((e) => e.event.type === EventType.TURN_START)
  +  if (!hasTurnStart) return 'seed'
  +
  +  let lastEndKind: string | undefined
  +  for (const entry of events) {
  +    if (entry.event.type === EventType.TURN_END) {
  +      const data = entry.event.data as unknown as TurnEndData
  +      lastEndKind = data.reason?.kind
  +    }
  +  }
  +  if (!lastEndKind) return 'ongoing'
  +  return lastEndKind as RoundEndReason
  +}
  ```

- [x] 2.2 在 `utils/index.ts` 导出新增的 `splitTurns` / `classifyRoundEndReason`
  变更文件：packages/dsh-session-host/src/utils/index.ts
  变更内容：
  ```diff
   export {
     EventType,
     foldStats,
     fetchSessionHistory,
     fetchAllSessionEvents,
     extractUserMessages,
     extractFileOperations,
     extractSessionTitle,
  +  splitTurns,
  +  classifyRoundEndReason,
   } from './session-history.js'
  ```

## 3. Handler 改造（host index.ts）

- [x] 3.1 在 `index.ts` 引入 `splitTurns` / `classifyRoundEndReason` / `EventType` / `TurnStartData`，并将 handler 改为按段循环生成 `items`、`hasMore` 上移
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
     extractFileOperations,
     extractSessionTitle,
  +  splitTurns,
  +  classifyRoundEndReason,
   } from './utils/index.js'
  +import { EventType } from './utils/index.js'
  +import type { TurnStartData } from './utils/index.js'
  ```
  变更内容（workspace.session.tag handler 体，替换原 `foldStats` 单段整理 + `item` 组装）：
  ```diff
  -        // 使用 utils 工具整理 events 数据
  -        const stats = foldStats(events)
  -        const userMessageTexts = extractUserMessages(events)
  -        const fileOperations = extractFileOperations(events)
  -        const title = extractSessionTitle(events)
  -
  -        const item: SessionEventTagItem = {
  -          sessionId,
  -          title: title ?? stats.title,
  -          turns: stats.turns,
  -          userMessages: stats.userMessages,
  -          assistantMessages: stats.assistantMessages,
  -          toolCalls: stats.toolCalls,
  -          userMessageTexts,
  -          fileOperations,
  -          startedAt: stats.startedAt,
  -          updatedAt: stats.updatedAt,
  -          totalEvents: stats.totalEvents,
  -          hasMore,
  -        }
  -
  -        console.log(`[SessionTag] workspace.session.tag 查询成功: sessionId=${sessionId}, events=${events.length}, turns=${stats.turns}`)
  -        rpcResponse(res, rpcId, { ok: true, value: { item } })
  +        // 使用 utils 工具，按 turn 切分后逐轮整合
  +        const segments = splitTurns(events)
  +        const items: SessionEventTagItem[] = segments.map((seg) => {
  +          const stats = foldStats(seg)
  +          const userMessageTexts = extractUserMessages(seg)
  +          const fileOperations = extractFileOperations(seg)
  +          const title = extractSessionTitle(seg)
  +          const turnStart = seg.find(
  +            (e) => e.event.type === EventType.TURN_START,
  +          )?.event.data as unknown as TurnStartData | undefined
  +          return {
  +            sessionId,
  +            title: title ?? stats.title,
  +            round: turnStart?.turn ?? 0,
  +            endReason: classifyRoundEndReason(seg),
  +            turns: stats.turns,
  +            userMessages: stats.userMessages,
  +            assistantMessages: stats.assistantMessages,
  +            toolCalls: stats.toolCalls,
  +            userMessageTexts,
  +            fileOperations,
  +            startedAt: stats.startedAt,
  +            updatedAt: stats.updatedAt,
  +            totalEvents: stats.totalEvents,
  +          }
  +        })
  +
  +        console.log(`[SessionTag] workspace.session.tag 查询成功: sessionId=${sessionId}, events=${events.length}, rounds=${items.length}`)
  +        rpcResponse(res, rpcId, { ok: true, value: { items, hasMore } })
  ```

## 4. 客户端类型同步（client tag-api.ts）

- [x] 4.1 将客户端 `WorkspaceSessionTagValue` 由 `{ item }` 改为 `{ items, hasMore }`，并新增与宿主一致的 `SessionEventTagItem` / `RoundEndReason`
  变更文件：packages/dsh-session-client/src/utils/tag-api.ts
  变更内容（替换 `WorkspaceSessionTagValue` 定义块）：
  ```diff
  +/** 轮次结束/异常原因（与宿主 contract.ts RoundEndReason 保持一致） */
  +export type RoundEndReason =
  +  | 'completed'
  +  | 'aborted'
  +  | 'error'
  +  | 'interrupted'
  +  | 'max-tokens'
  +  | 'blocked'
  +  | 'ongoing'
  +  | 'seed'
  +
  +/** 单轮会话事件数据标签条目（与宿主 SessionEventTagItem 字段一致） */
  +export interface SessionEventTagItem {
  +  sessionId: string
  +  title: string | null
  +  round: number
  +  endReason: RoundEndReason
  +  turns: number
  +  userMessages: number
  +  assistantMessages: number
  +  toolCalls: ToolCallStat[]
  +  userMessageTexts: string[]
  +  fileOperations: string[]
  +  startedAt: number | null
  +  updatedAt: number | null
  +  totalEvents: number
  +}
  +
   /** workspace.session.tag 响应值 */
   export interface WorkspaceSessionTagValue {
  -  item: {
  -    sessionId: string
  -    title: string | null
  -    turns: number
  -    userMessages: number
  -    assistantMessages: number
  -    toolCalls: ToolCallStat[]
  -    userMessageTexts: string[]
  -    fileOperations: string[]
  -    startedAt: number | null
  -    updatedAt: number | null
  -    totalEvents: number
  -    hasMore: boolean
  -  }
  +  items: SessionEventTagItem[]
  +  hasMore: boolean
   }
  ```
  说明：客户端 `src/index.ts` 仅 `console.log` 结果、未访问 `.value.item` 字段，类型变更后无需改动（如有访问需同步为 `.value.items[0]`）。

## 5. 测试同步与新增

- [x] 5.1 同步宿主测试 `workspace-session-tag.test.ts`：断言由 `body.value.item` 改为 `body.value.items[0]`，`hasMore` 上移到 `value` 级，并补充 `round` / `endReason`
  变更文件：packages/dsh-session-host/__tests__/workspace-session-tag.test.ts
  变更内容（替换原 `body.value.item` 断言块，约 179-192 行）：
  ```diff
  -    expect(body.value.item).toMatchObject({
  -      sessionId: 'session-abc',
  -      title: '你好',
  -      turns: 1,
  -      userMessages: 1,
  -      assistantMessages: 1,
  -      toolCalls: [{ name: 'read_files', count: 1 }],
  -      userMessageTexts: ['你好'],
  -      fileOperations: [],
  -      startedAt: 1000,
  -      updatedAt: 1004,
  -      totalEvents: 5,
  -      hasMore: false,
  -    })
  +    expect(body.value.hasMore).toBe(false)
  +    expect(body.value.items).toHaveLength(1)
  +    expect(body.value.items[0]).toMatchObject({
  +      sessionId: 'session-abc',
  +      title: '你好',
  +      round: 1,
  +      endReason: 'completed',
  +      turns: 1,
  +      userMessages: 1,
  +      assistantMessages: 1,
  +      toolCalls: [{ name: 'read_files', count: 1 }],
  +      userMessageTexts: ['你好'],
  +      fileOperations: [],
  +      startedAt: 1000,
  +      updatedAt: 1004,
  +      totalEvents: 5,
  +    })
  ```
  说明：若 `defaultEvents` 为多 turn 集合，`mockFoldStats` 的 `toHaveBeenCalledWith(defaultEvents)` 断言需改为 `expect(mockFoldStats).toHaveBeenCalled()`（按段调用）。

- [x] 5.2 同步客户端测试 `tag-api.test.ts`：mock 与断言由 `value.item` 改为 `value.items[0]`，`hasMore` 上移
  变更文件：packages/dsh-session-client/__tests__/tag-api.test.ts
  变更内容（约 173-216 行，三处）：
  ```diff
         json: async () => ({
           ok: true,
           value: {
  -          item: {
  +          items: [
               {
                 sessionId: 'session-abc',
                 title: '测试',
                 turns: 1,
                 userMessages: 1,
                 assistantMessages: 1,
                 toolCalls: [],
                 userMessageTexts: ['你好'],
                 fileOperations: [],
                 startedAt: 1000,
                 updatedAt: 2000,
                 totalEvents: 5,
                 hasMore: false,
               },
  -          },
  +          ],
  +          hasMore: false,
           },
         }),
  ```
  ```diff
         expect(result.ok).toBe(true)
         if (result.ok) {
  -        expect(result.value.item.sessionId).toBe('session-abc')
  -        expect(result.value.item.turns).toBe(1)
  +        expect(result.value.items[0].sessionId).toBe('session-abc')
  +        expect(result.value.items[0].turns).toBe(1)
         }
  ```
  ```diff
  -      json: async () => ({ ok: true, value: { item: {} } }),
  +      json: async () => ({ ok: true, value: { items: [{}], hasMore: false } }),
  ```

- [x] 5.3 新增 `splitTurns` / `classifyRoundEndReason` 单元测试（多 turn + 前导种子段 + 异常终止）
  变更文件：packages/dsh-session-host/__tests__/session-turn-split.test.ts（新建）
  变更内容（全量新增）：
  ```diff
  +import { describe, it, expect } from 'vitest'
  +import { splitTurns, classifyRoundEndReason } from '../src/utils/session-history.js'
  +import type { SessionHistoryEvent } from '../src/utils/session-history.js'
  +
  +function ev(seq: number, type: string, data: Record<string, unknown> = {}): SessionHistoryEvent {
  +  return { event: { type, seq, time: seq * 1000, data } }
  +}
  +
  +describe('splitTurns', () => {
  +  it('单 turn + 前导种子段 → 1 段且前导事件并入首段', () => {
  +    const events = [
  +      ev(0, 'session/end-seed'),
  +      ev(1, 'session/title', { title: '你好' }),
  +      ev(2, 'turn/start', { turn: 1 }),
  +      ev(3, 'user/message', { source: { kind: 'user' } }),
  +      ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  +    ]
  +    const segs = splitTurns(events)
  +    expect(segs).toHaveLength(1)
  +    expect(segs[0]).toHaveLength(5) // 前导 + turn 全部保留
  +  })
  +
  +  it('多 turn → 按 turn 数量切分', () => {
  +    const events = [
  +      ev(0, 'turn/start', { turn: 1 }),
  +      ev(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  +      ev(2, 'turn/start', { turn: 2 }),
  +      ev(3, 'turn/end', { turn: 2, reason: { kind: 'aborted' } }),
  +    ]
  +    expect(splitTurns(events)).toHaveLength(2)
  +  })
  +
  +  it('纯前导段（无 turn/start）→ 单条 seed 段', () => {
  +    const events = [ev(0, 'session/title', { title: 'x' }), ev(1, 'assistant/message', {})]
  +    const segs = splitTurns(events)
  +    expect(segs).toHaveLength(1)
  +    expect(classifyRoundEndReason(segs[0])).toBe('seed')
  +  })
  +})
  +
  +describe('classifyRoundEndReason', () => {
  +  it('末条 turn/end.reason.kind 决定 endReason', () => {
  +    const seg = [
  +      ev(0, 'turn/start', { turn: 1 }),
  +      ev(1, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
  +    ]
  +    expect(classifyRoundEndReason(seg)).toBe('error')
  +  })
  +
  +  it('末轮无 turn/end → ongoing', () => {
  +    const seg = [
  +      ev(0, 'turn/start', { turn: 1 }),
  +      ev(1, 'assistant/chunk', {}),
  +    ]
  +    expect(classifyRoundEndReason(seg)).toBe('ongoing')
  +  })
  +})
  ```

## 6. API 文档同步

- [x] 6.1 更新 `apiDocs/plugin-api/workspace.session.tag.md`：出参 `value.item` → `value.items` 数组，新增 `round` / `endReason` 字段说明，`hasMore` 上移，错误码与信封不变
  变更文件：apiDocs/plugin-api/workspace.session.tag.md
  变更内容（第 23-43 行「出参」段整体替换）：
  ```diff
  -## 出参 (Response / Output)
  -- 返回类型：`WorkspaceSessionTagResponse`，成功数据位于 `value.item`（`SessionEventTagItem`）。
  -
  -| 字段 | 类型 | 说明 |
  -|---|---|---|
  -| `ok` | `boolean` | 请求是否成功。 |
  -| `value.item.sessionId` | `string` | 会话 ID。 |
  -| `value.item.title` | `string \| null` | 会话标题（取最新 `session/title` 事件，回退到 `foldStats` 的 title）。 |
  -| `value.item.turns` | `number` | 轮次数（`turn/start` 计数）。 |
  -| `value.item.userMessages` | `number` | 用户真实提问数（仅 `source.kind==='user'` 的 `user/message`）。 |
  -| `value.item.assistantMessages` | `number` | 助手消息数（`assistant/message`）。 |
  -| `value.item.toolCalls` | `Array<{ name: string; count: number }>` | 工具调用统计，按调用次数降序。 |
  -| `value.item.userMessageTexts` | `string[]` | 用户真实提问文本列表（取 `content` 中 `type==='text'` 的片段）。 |
  -| `value.item.fileOperations` | `string[]` | 写文件操作路径列表（`write_file`/`edit`/`write` 工具的 `file_path`/`path`，去重）。 |
  -| `value.item.startedAt` | `number \| null` | 活动开始时间（epoch ms，取最早事件时间）。 |
  -| `value.item.updatedAt` | `number \| null` | 活动结束时间（epoch ms，取最晚事件时间）。 |
  -| `value.item.totalEvents` | `number` | 事件总数。 |
  -| `value.item.hasMore` | `boolean` | 是否还有更早的事件未读完（分页边界指示）。 |
  -| `error` | `string` | 失败时的错误码（见下）。 |
  +## 出参 (Response / Output)
  +- 返回类型：`WorkspaceSessionTagResponse`，成功数据位于 `value.items`（`SessionEventTagItem[]`，按 `turn/start` 切分，每 turn 一条）；`value.hasMore` 描述会话事件流分页边界。
  +
  +| 字段 | 类型 | 说明 |
  +|---|---|---|
  +| `ok` | `boolean` | 请求是否成功。 |
  +| `value.hasMore` | `boolean` | 会话事件流是否还有更早的分页未读完。 |
  +| `value.items[]` | `SessionEventTagItem[]` | 按 turn 切分的条目数组（顺序即轮次顺序）。 |
  +| `value.items[].sessionId` | `string` | 会话 ID。 |
  +| `value.items[].title` | `string \| null` | 会话标题（取最新 `session/title` 事件，回退到 `foldStats` 的 title）。 |
  +| `value.items[].round` | `number` | 轮次序号（1-based，取自 `turn/start.data.turn`；纯前导段为 0）。 |
  +| `value.items[].endReason` | `string` | 本轮结束/异常原因：`completed`/`aborted`/`error`/`interrupted`/`max-tokens`/`blocked`/`ongoing`/`seed`。 |
  +| `value.items[].turns` | `number` | 轮次数（方案 B 下该段内 `turn/start` 计数，恒为 1）。 |
  +| `value.items[].userMessages` | `number` | 用户真实提问数（仅 `source.kind==='user'` 的 `user/message`）。 |
  +| `value.items[].assistantMessages` | `number` | 助手消息数（`assistant/message`）。 |
  +| `value.items[].toolCalls` | `Array<{ name: string; count: number }>` | 工具调用统计，按调用次数降序。 |
  +| `value.items[].userMessageTexts` | `string[]` | 用户真实提问文本列表。 |
  +| `value.items[].fileOperations` | `string[]` | 写文件操作路径列表（`write_file`/`edit`/`write` 工具，去重）。 |
  +| `value.items[].startedAt` | `number \| null` | 活动开始时间（epoch ms，取该段最早事件时间）。 |
  +| `value.items[].updatedAt` | `number \| null` | 活动结束时间（epoch ms，取该段最晚事件时间）。 |
  +| `value.items[].totalEvents` | `number` | 该段事件总数。 |
  +| `error` | `string` | 失败时的错误码（见下）。 |
  ```
  说明：第 11 行功能说明、第 47/49/52 行「调用方式 / 内部链路」中 `value.item` 表述需同步改为 `value.items` / 逐轮折叠。

## 7. 类型校验与验证

- [x] 7.1 运行 `pnpm typecheck` 确认 host/client 类型一致、`pnpm test` 确认单元与 handler 测试通过
  变更文件：无（命令执行）
  变更内容：
  ```diff
  +# 仓库根目录执行
  +pnpm typecheck
  +pnpm test
  ```
  验收标准：`typecheck` 0 错误；`workspace-session-tag.test.ts`、`tag-api.test.ts`、`session-turn-split.test.ts` 全部通过。

## 8. 子代理任务审计

- [x] 8.1 调用子代理（code-reviewer / Explore）对本次全部改动做审计：类型一致性（host/client）、`splitTurns` 边界正确性、前导事件不丢失、`endReason` 分类覆盖、文档与代码一致；发现问题即修复并重新审计，直至无阻断性问题
  变更文件：无（审计动作）
  变更内容：
  ```diff
  +# 审计重点清单
  +- [x] contract.ts 与 tag-api.ts 的 items 字段集完全一致（含 round/endReason/hasMore 位置）
  +- [x] splitTurns 对「前导种子段」「多 turn」「空段」三种情形输出正确
  +- [x] classifyRoundEndReason 覆盖 completed/aborted/error/interrupted/ongoing/seed
  +- [x] handler 每轮复用 foldStats 等、未重复实现统计
  +- [x] 两个既有测试已同步为 items，无残留 value.item 引用
  +- [x] apiDocs 出参与 contract.ts 一致
  ```
