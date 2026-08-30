/**
 * session-history 工具单元测试
 *
 * 覆盖：
 * - EventType 常量
 * - foldStats：各类事件统计累加
 * - extractUserMessages：过滤用户真实提问
 * - extractFileOperations：提取写文件路径
 * - extractSessionTitle：提取最新标题
 * - fetchSessionHistory：单页 RPC 调用
 * - fetchAllSessionEvents：分页读取 + seq 去重
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionHistoryEvent } from '../src/utils/session-history.js'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })

import {
  EventType,
  foldStats,
  extractUserMessages,
  extractFileOperations,
  extractSessionTitle,
  fetchSessionHistory,
  fetchAllSessionEvents,
} from '../src/utils/session-history.js'

// ===== 测试用事件工厂 =====

function makeEvent(
  type: string,
  seq: number,
  time: number,
  data: Record<string, unknown>,
): SessionHistoryEvent {
  return { event: { type, seq, time, data } }
}

function makeUserMessage(seq: number, text: string, sourceKind: 'user' | 'plugin' = 'user'): SessionHistoryEvent {
  return makeEvent(EventType.USER_MESSAGE, seq, Date.now(), {
    content: [{ type: 'text', text }],
    source: { kind: sourceKind },
    role: 'user',
    id: `msg-${seq}`,
  })
}

function makeAssistantMessage(seq: number, text: string): SessionHistoryEvent {
  return makeEvent(EventType.ASSISTANT_MESSAGE, seq, Date.now(), {
    content: [{ type: 'text', text }],
    role: 'assistant',
    id: `msg-${seq}`,
  })
}

function makeToolCall(seq: number, name: string, input: Record<string, unknown> = {}): SessionHistoryEvent {
  return makeEvent(EventType.TOOL_CALL, seq, Date.now(), { name, input, callId: `call-${seq}` })
}

function makeTurnStart(seq: number, turn: number): SessionHistoryEvent {
  return makeEvent(EventType.TURN_START, seq, Date.now(), { turn })
}

function makeSessionTitle(seq: number, title: string, kind: 'user' | 'provider' | 'fallback' = 'provider'): SessionHistoryEvent {
  return makeEvent(EventType.SESSION_TITLE, seq, Date.now(), { title, source: { kind } })
}

// ===== Mock RPC 响应构造 =====

function mockRpcSuccess(value: unknown) {
  return {
    ok: true,
    json: async () => ({
      type: 'server-response',
      rpcId: 'test-uuid',
      result: { ok: true, value },
    }),
  }
}

describe('session-history 工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===== EventType =====

  describe('EventType', () => {
    it('应定义所有常用事件类型', () => {
      expect(EventType.USER_MESSAGE).toBe('user/message')
      expect(EventType.ASSISTANT_MESSAGE).toBe('assistant/message')
      expect(EventType.TOOL_CALL).toBe('tool/call')
      expect(EventType.SESSION_TITLE).toBe('session/title')
      expect(EventType.TURN_START).toBe('turn/start')
    })
  })

  // ===== foldStats =====

  describe('foldStats', () => {
    it('空事件列表应返回零值统计', () => {
      const stats = foldStats([])
      expect(stats.turns).toBe(0)
      expect(stats.userMessages).toBe(0)
      expect(stats.assistantMessages).toBe(0)
      expect(stats.toolCalls).toEqual([])
      expect(stats.totalEvents).toBe(0)
      expect(stats.title).toBeNull()
    })

    it('应正确统计轮次数', () => {
      const events = [
        makeTurnStart(0, 1),
        makeTurnStart(1, 2),
        makeTurnStart(2, 3),
      ]
      const stats = foldStats(events)
      expect(stats.turns).toBe(3)
    })

    it('应统计用户消息（仅 source.kind===user）', () => {
      const events = [
        makeUserMessage(0, 'hello', 'user'),
        makeUserMessage(1, 'plugin msg', 'plugin'),
        makeUserMessage(2, 'world', 'user'),
      ]
      const stats = foldStats(events)
      expect(stats.userMessages).toBe(2)
    })

    it('应统计助手消息', () => {
      const events = [
        makeAssistantMessage(0, 'hi'),
        makeAssistantMessage(1, 'bye'),
      ]
      const stats = foldStats(events)
      expect(stats.assistantMessages).toBe(2)
    })

    it('应按工具名累加调用次数并降序排列', () => {
      const events = [
        makeToolCall(0, 'read_files'),
        makeToolCall(1, 'write_file'),
        makeToolCall(2, 'read_files'),
        makeToolCall(3, 'read_files'),
        makeToolCall(4, 'code_search'),
        makeToolCall(5, 'code_search'),
      ]
      const stats = foldStats(events)
      expect(stats.toolCalls).toEqual([
        { name: 'read_files', count: 3 },
        { name: 'code_search', count: 2 },
        { name: 'write_file', count: 1 },
      ])
    })

    it('应取最新标题', () => {
      const events = [
        makeSessionTitle(0, '旧标题'),
        makeSessionTitle(1, '新标题'),
      ]
      const stats = foldStats(events)
      expect(stats.title).toBe('新标题')
    })

    it('应计算活动窗口时间', () => {
      const events = [
        makeEvent('turn/start', 0, 1000, { turn: 1 }),
        makeEvent('user/message', 1, 2000, { content: [], source: { kind: 'user' }, role: 'user', id: '1' }),
        makeEvent('turn/end', 2, 3000, { turn: 1 }),
      ]
      const stats = foldStats(events)
      expect(stats.startedAt).toBe(1000)
      expect(stats.updatedAt).toBe(3000)
    })
  })

  // ===== extractUserMessages =====

  describe('extractUserMessages', () => {
    it('应提取 source.kind===user 的文本内容', () => {
      const events = [
        makeUserMessage(0, '你好'),
        makeUserMessage(1, '系统消息', 'plugin'),
        makeUserMessage(2, '世界'),
      ]
      const msgs = extractUserMessages(events)
      expect(msgs).toEqual(['你好', '世界'])
    })

    it('空列表应返回空数组', () => {
      expect(extractUserMessages([])).toEqual([])
    })
  })

  // ===== extractFileOperations =====

  describe('extractFileOperations', () => {
    it('应提取 write/edit 工具的 file_path', () => {
      const events = [
        makeToolCall(0, 'write_file', { path: '/tmp/a.ts' }),
        makeToolCall(1, 'read_files', { paths: ['/tmp/b.ts'] }),
        makeToolCall(2, 'edit', { file_path: '/tmp/c.ts' }),
        makeToolCall(3, 'write_file', { path: '/tmp/a.ts' }), // 重复
      ]
      const files = extractFileOperations(events)
      expect(files).toContain('/tmp/a.ts')
      expect(files).toContain('/tmp/c.ts')
      expect(files).toHaveLength(2)
    })
  })

  // ===== extractSessionTitle =====

  describe('extractSessionTitle', () => {
    it('应返回最新的标题', () => {
      const events = [
        makeSessionTitle(0, '旧标题'),
        makeSessionTitle(1, '新标题'),
      ]
      expect(extractSessionTitle(events)).toBe('新标题')
    })

    it('无标题事件时返回 null', () => {
      expect(extractSessionTitle([])).toBeNull()
    })
  })

  // ===== fetchSessionHistory =====

  describe('fetchSessionHistory', () => {
    it('应调用 session.history 并返回结果', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [makeTurnStart(0, 1)],
        hasMore: false,
      }))

      const result = await fetchSessionHistory('http://127.0.0.1:3080', {
        sessionId: 'session-xxx',
        maxMessages: 50,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.events).toHaveLength(1)
        expect(result.value.hasMore).toBe(false)
      }
    })
  })

  // ===== fetchAllSessionEvents =====

  describe('fetchAllSessionEvents', () => {
    it('单页无翻页应返回所有事件', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [makeTurnStart(0, 1), makeUserMessage(1, 'hi')],
        hasMore: false,
      }))

      const { events, hasMore } = await fetchAllSessionEvents(
        'http://127.0.0.1:3080',
        'session-xxx',
      )

      expect(hasMore).toBe(false)
      expect(events).toHaveLength(2)
      expect(events[0].event.seq).toBe(0)
      expect(events[1].event.seq).toBe(1)
    })

    it('多页翻页应合并并去重', async () => {
      // 第一页：seq 3, 4, hasMore=true
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [
          makeTurnStart(4, 2),
          makeUserMessage(3, 'world'),
        ],
        hasMore: true,
      }))
      // 第二页：seq 0, 1, 2, hasMore=false
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [
          makeEvent('step/start', 2, 100, { turn: 1, step: 1 }),
          makeUserMessage(1, 'hello'),
          makeEvent('turn/start', 0, 99, { turn: 1 }),
        ],
        hasMore: false,
      }))

      const { events, hasMore } = await fetchAllSessionEvents(
        'http://127.0.0.1:3080',
        'session-xxx',
      )

      expect(hasMore).toBe(false)
      expect(events).toHaveLength(5)
      // 应按 seq 升序
      expect(events.map((e) => e.event.seq)).toEqual([0, 1, 2, 3, 4])
      // 应调用两次 fetch
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('seq 去重应跳过重复事件', async () => {
      // 两页都有 seq=2
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [makeEvent('step/start', 2, 100, { turn: 1, step: 1 }), makeTurnStart(3, 2)],
        hasMore: true,
      }))
      mockFetch.mockResolvedValueOnce(mockRpcSuccess({
        events: [makeEvent('step/start', 2, 100, { turn: 1, step: 1 }), makeTurnStart(1, 1)],
        hasMore: false,
      }))

      const { events } = await fetchAllSessionEvents(
        'http://127.0.0.1:3080',
        'session-xxx',
      )

      // seq=2 只出现一次
      const seqCounts = new Map<number, number>()
      for (const e of events) {
        seqCounts.set(e.event.seq, (seqCounts.get(e.event.seq) ?? 0) + 1)
      }
      expect(seqCounts.get(2)).toBe(1)
    })

    it('RPC 失败应返回 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid',
          result: { ok: false, error: 'corrupt session log' },
        }),
      })

      const { events, hasMore, error } = await fetchAllSessionEvents(
        'http://127.0.0.1:3080',
        'session-xxx',
      )

      expect(hasMore).toBe(false)
      expect(error).toContain('corrupt session log')
      expect(events).toEqual([]) // 第一页失败，无事件
    })
  })
})
