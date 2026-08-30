/**
 * Session History 事件处理工具
 *
 * 提供 session.history 接口响应数据的类型定义、分页读取、
 * 事件折叠（foldStats）等通用处理逻辑。
 *
 * 数据来源：DSH 宿主的 session.history RPC 接口
 * 接口文档：apiDocs/api_session.history.md
 *
 * @module utils/session-history
 */

import {
  dshRpcCall,
  type DshRpcCallOptions,
  type DshRpcResult,
} from './rpc-client.js'

// RoundEndReason 由 contract.ts（类型枢纽）定义，此处仅做类型引用
import type { RoundEndReason } from '../contract.js'

// ===== 事件类型定义 =====

/** 会话事件基础结构（session.history 返回的每个条目） */
export interface SessionHistoryEvent {
  event: {
    /** 事件类型 */
    type: string
    /** 事件序列号（单调递增，用于分页和去重） */
    seq: number
    /** 事件时间戳（epoch ms） */
    time: number
    /** 事件数据（类型由 type 决定） */
    data: Record<string, unknown>
  }
  /** 可选的视图快照 */
  view?: unknown
}

/** user/message 事件的 data 结构 */
export interface UserMessageData {
  content: Array<{ type: string; text: string }>
  source: {
    kind: 'user' | 'plugin' | 'skill-catalog'
    rpcId?: string
    clientTimeZone?: string
    plugin?: string
    form?: string
    sections?: Array<{ name: string; text: string }>
    entries?: Array<{ name: string; description: string }>
  }
  role: 'user'
  id: string
}

/** assistant/message 事件的 data 结构 */
export interface AssistantMessageData {
  content: Array<{ type: string; text: string }>
  role: 'assistant'
  id: string
}

/** tool/call 事件的 data 结构 */
export interface ToolCallData {
  name: string
  input: Record<string, unknown>
  callId: string
}

/** tool/result 事件的 data 结构 */
export interface ToolResultData {
  name: string
  callId: string
  result: unknown
  isError?: boolean
}

/** session/title 事件的 data 结构 */
export interface SessionTitleData {
  title: string
  messageSeqs?: number[]
  source: {
    kind: 'user' | 'provider' | 'fallback'
  }
}

/** turn/start 事件的 data 结构 */
export interface TurnStartData {
  turn: number
}

/** turn/end 事件的 data 结构 */
export interface TurnEndData {
  turn: number
  /** 结束原因（部分 DSH 版本可能缺失） */
  reason?: {
    kind: 'completed' | 'aborted' | 'error' | 'interrupted' | 'max-tokens' | 'blocked'
  }
}

/** step/start 事件的 data 结构 */
export interface StepStartData {
  turn: number
  step: number
}

// ===== 常用事件类型常量 =====

/** 事件类型枚举（常用子集） */
export const EventType = {
  /** 用户消息 */
  USER_MESSAGE: 'user/message',
  /** 助手消息 */
  ASSISTANT_MESSAGE: 'assistant/message',
  /** 工具调用 */
  TOOL_CALL: 'tool/call',
  /** 工具结果 */
  TOOL_RESULT: 'tool/result',
  /** 会话标题变更 */
  SESSION_TITLE: 'session/title',
  /** 轮次开始 */
  TURN_START: 'turn/start',
  /** 轮次结束 */
  TURN_END: 'turn/end',
  /** 步骤开始 */
  STEP_START: 'step/start',
  /** Agent 收件箱拼接 */
  AGENT_INBOX_SPLICED: 'agent/inbox/spliced',
  /** 权限预设 */
  PERMISSION_PRESET: 'permission/preset',
  /** 沙箱模式 */
  SANDBOX_MODE: 'sandbox/mode',
  /** 审批策略 */
  APPROVAL_POLICY: 'approval/policy',
  /** 请求头 */
  REQUEST_HEADER: 'request/header',
} as const

// ===== session.history 响应值类型 =====

/** session.history 接口的 value 结构 */
export interface SessionHistoryValue {
  /** 事件列表 */
  events: SessionHistoryEvent[]
  /** 是否还有更早的事件需要翻页 */
  hasMore: boolean
  /** 可选的投影数据 */
  projections?: Record<string, unknown>
}

/** session.history 请求参数 */
export interface SessionHistoryParams {
  sessionId: string
  /** 向前翻页的 seq 边界 */
  beforeSeq?: number
  /** 最大返回消息数（默认 50） */
  maxMessages?: number
}

// ===== session.history RPC 调用 =====

/**
 * 调用 session.history（单页）
 *
 * @param baseUrl - DSH Web 服务 URL
 * @param params - 请求参数
 * @param options - 可选配置
 */
export async function fetchSessionHistory(
  baseUrl: string,
  params: SessionHistoryParams,
  options?: DshRpcCallOptions,
): Promise<DshRpcResult<SessionHistoryValue>> {
  return dshRpcCall<SessionHistoryParams, SessionHistoryValue>(
    baseUrl,
    'session.history',
    params,
    options,
  )
}

// ===== 统计折叠（foldStats） =====

/** 单个工具的调用统计 */
export interface ToolCallStat {
  name: string
  count: number
}

/** 会话统计信息 */
export interface SessionStats {
  /** 轮次数 */
  turns: number
  /** 用户消息数（仅 source.kind==='user'） */
  userMessages: number
  /** 助手消息数 */
  assistantMessages: number
  /** 工具调用统计（按调用次数降序排列） */
  toolCalls: ToolCallStat[]
  /** 活动窗口 */
  startedAt: number | null
  updatedAt: number | null
  /** 事件总数 */
  totalEvents: number
  /** 会话标题（如果有） */
  title: string | null
}

/**
 * 从事件流中折叠统计信息
 *
 * 遍历 events 数组，按事件类型累加统计：
 * - turn/start → turns++
 * - user/message（source.kind==='user'）→ userMessages++
 * - assistant/message → assistantMessages++
 * - tool/call → 按工具名累加
 *
 * @param events - session.history 返回的事件列表
 * @returns 聚合后的会话统计
 */
export function foldStats(events: readonly SessionHistoryEvent[]): SessionStats {
  let turns = 0
  let userMessages = 0
  let assistantMessages = 0
  const toolMap = new Map<string, number>()
  let startedAt: number | null = null
  let updatedAt: number | null = null
  let title: string | null = null

  for (const entry of events) {
    const { type, time, data } = entry.event

    // 时间窗口
    if (startedAt === null || time < startedAt) startedAt = time
    if (updatedAt === null || time > updatedAt) updatedAt = time

    switch (type) {
      case EventType.TURN_START:
        turns++
        break

      case EventType.USER_MESSAGE: {
        const msgData = data as unknown as UserMessageData
        // 只统计用户真实提问，忽略 plugin/skill-catalog 注入
        if (msgData.source?.kind === 'user') {
          userMessages++
        }
        break
      }

      case EventType.ASSISTANT_MESSAGE:
        assistantMessages++
        break

      case EventType.TOOL_CALL: {
        const toolData = data as unknown as ToolCallData
        toolMap.set(toolData.name, (toolMap.get(toolData.name) ?? 0) + 1)
        break
      }

      case EventType.SESSION_TITLE: {
        const titleData = data as unknown as SessionTitleData
        // 取最新标题
        title = titleData.title
        break
      }
    }
  }

  // 工具调用按次数降序
  const toolCalls: ToolCallStat[] = [...toolMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return {
    turns,
    userMessages,
    assistantMessages,
    toolCalls,
    startedAt,
    updatedAt,
    totalEvents: events.length,
    title,
  }
}

// ===== 分页读取所有事件 =====

/**
 * 分页读取单个会话的全部历史事件
 *
 * 自动处理 hasMore 分页和 seq 去重，直到读完所有事件
 * 或达到 maxTotalEvents 上限。
 *
 * @param baseUrl - DSH Web 服务 URL
 * @param sessionId - 会话 ID
 * @param options - 可选配置
 * @returns 完整的事件列表（已按 seq 排序去重）
 */
export async function fetchAllSessionEvents(
  baseUrl: string,
  sessionId: string,
  options?: {
    /** 单页最大消息数，默认 200 */
    maxMessages?: number
    /** 总事件上限（防止无限翻页），默认 10000 */
    maxTotalEvents?: number
    /** 请求超时毫秒，默认 30000 */
    timeoutMs?: number
  },
): Promise<{
  events: SessionHistoryEvent[]
  hasMore: boolean
  error?: string
}> {
  const maxMessages = options?.maxMessages ?? 200
  const maxTotalEvents = options?.maxTotalEvents ?? 10_000
  const allEvents: SessionHistoryEvent[] = []
  const seenSeqs = new Set<number>()
  let hasMore = true
  let beforeSeq: number | undefined

  while (hasMore && allEvents.length < maxTotalEvents) {
    const result = await fetchSessionHistory(baseUrl, {
      sessionId,
      beforeSeq,
      maxMessages,
    }, { timeoutMs: options?.timeoutMs })

    if (!result.ok) {
      return {
        events: allEvents,
        hasMore: false,
        error: String(result.error),
      }
    }

    const page = result.value!
    const newEvents: SessionHistoryEvent[] = []

    for (const entry of page.events) {
      if (!seenSeqs.has(entry.event.seq)) {
        seenSeqs.add(entry.event.seq)
        newEvents.push(entry)
      }
    }

    allEvents.push(...newEvents)
    hasMore = page.hasMore

    if (hasMore && page.events.length > 0) {
      // beforeSeq 设为当前页最小 seq - 1，继续向前翻
      const minSeq = Math.min(...page.events.map((e) => e.event.seq))
      beforeSeq = minSeq - 1
      // 边界保护：seq 不会小于 0
      if (beforeSeq < 0) break
    }
  }

  // 按 seq 升序排序（最旧 → 最新）
  allEvents.sort((a, b) => a.event.seq - b.event.seq)

  return { events: allEvents, hasMore }
}

// ===== 事件过滤辅助 =====

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

/** 提取工具写文件操作的路径（tool/call 中 name 为 write/edit 的 file_path） */
export function extractFileOperations(events: readonly SessionHistoryEvent[]): string[] {
  const files = new Set<string>()
  for (const entry of events) {
    if (entry.event.type !== EventType.TOOL_CALL) continue
    const data = entry.event.data as unknown as ToolCallData
    if (data.name === 'write_file' || data.name === 'edit' || data.name === 'write') {
      const filePath = data.input?.file_path ?? data.input?.path
      if (typeof filePath === 'string') files.add(filePath)
    }
  }
  return [...files]
}

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

// ===== 轮次切分与结束原因分类 =====

/** endReason 合法取值（用于 classifyRoundEndReason 校验，未知 kind 回退 ongoing） */
const ROUND_END_REASONS: RoundEndReason[] = [
  'completed',
  'aborted',
  'error',
  'interrupted',
  'max-tokens',
  'blocked',
  'ongoing',
  'seed',
]

/**
 * 将事件流按 turn/start 边界切分为多个轮次段。
 * 首条 turn/start 之前的前导事件（session/end-seed、session/title、request/header 等）并入首个 turn 轮次，不丢失任何事件。
 *
 * @param events - 已按 seq 升序的事件列表
 * @returns 轮次段数组（顺序即轮次顺序），不含空段
 */
export function splitTurns(events: readonly SessionHistoryEvent[]): SessionHistoryEvent[][] {
  const segments: SessionHistoryEvent[][] = []
  let current: SessionHistoryEvent[] | null = null
  let leading: SessionHistoryEvent[] = []

  for (const entry of events) {
    if (entry.event.type === EventType.TURN_START) {
      // 开启新轮次：前导事件并入本段
      current = [...leading, entry]
      leading = []
      segments.push(current)
    } else if (current) {
      current.push(entry)
    } else {
      // 尚未遇到首个 turn/start：暂存为前导事件
      leading.push(entry)
    }
  }

  // 纯前导段（整段无 turn/start）：作为单条 seed 段
  if (segments.length === 0 && leading.length > 0) {
    segments.push(leading)
  }

  return segments
}

/**
 * 根据轮次段事件分类该轮的结束/异常原因。
 * - 取该轮最后一条 turn/end 的 reason.kind → 对应枚举值；
 * - 末轮且无 turn/end（中断/进行中）→ ongoing；
 * - 纯前导段（无 turn/start）→ seed。
 *
 * @param events - 单个轮次段事件
 * @returns 结束原因枚举
 */
export function classifyRoundEndReason(events: readonly SessionHistoryEvent[]): RoundEndReason {
  const hasTurnStart = events.some((e) => e.event.type === EventType.TURN_START)
  if (!hasTurnStart) return 'seed'

  let lastEndKind: string | undefined
  for (const entry of events) {
    if (entry.event.type === EventType.TURN_END) {
      const data = entry.event.data as unknown as TurnEndData
      lastEndKind = data.reason?.kind
    }
  }
  if (!lastEndKind || !ROUND_END_REASONS.includes(lastEndKind as RoundEndReason)) return 'ongoing'
  return lastEndKind as RoundEndReason
}
