/**
 * client/utils/tag-api 单元测试
 *
 * 覆盖：
 * - generateRpcId：UUID 格式校验、唯一性
 * - fetchWorkspaceListTag：正常调用、rpcId 信封、错误处理
 * - fetchWorkspaceSessionTag：正常调用、参数透传
 * - 信封格式兼容：标准信封 / 简单格式
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { generateRpcId } from '../src/utils/uuid.js'
import {
  fetchWorkspaceListTag,
  fetchWorkspaceSessionTag,
  WORKSPACE_LIST_TAG_ROUTE,
  WORKSPACE_SESSION_TAG_ROUTE,
} from '../src/utils/tag-api.js'

// ===== uuid 测试 =====

describe('generateRpcId', () => {
  it('应返回有效的 UUID v4 格式', () => {
    const id = generateRpcId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('多次调用应返回不同值', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRpcId()))
    expect(ids.size).toBe(100)
  })
})

// ===== tag-api 测试 =====

describe('tag-api', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ===== fetchWorkspaceListTag =====

  describe('fetchWorkspaceListTag', () => {
    it('应发送带 rpcId 信封的 POST 请求', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, value: { items: [] } }),
      })

      const result = await fetchWorkspaceListTag('ws-123')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(WORKSPACE_LIST_TAG_ROUTE)
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/json')

      // 验证信封格式
      const body = JSON.parse(init.body)
      expect(body).toMatchObject({
        type: 'client-request',
        method: 'workspace.list.tag',
        payload: { workspaceId: 'ws-123' },
      })
      expect(body.rpcId).toMatch(/^[0-9a-f-]{36}$/)

      // 验证返回值
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({ items: [] })
        expect(result.rpcId).toMatch(/^[0-9a-f-]{36}$/)
      }
    })

    it('应处理标准信封响应格式（rpcId 匹配）', async () => {
      // 拦截请求以获取生成的 rpcId
      let capturedRpcId = ''
      mockFetch.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string)
        capturedRpcId = body.rpcId
        return {
          ok: true,
          json: async () => ({
            type: 'server-response',
            rpcId: capturedRpcId,
            result: {
              ok: true,
              value: {
                items: [{ sessionId: 's1', title: 't', sessionCurrentTag: '', createdAt: '', updatedAt: '' }],
              },
            },
          }),
        }
      })

      const result = await fetchWorkspaceListTag('ws-abc')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items).toHaveLength(1)
      }
    })

    it('标准信封 rpcId 不匹配时应返回失败', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'wrong-rpc-id',
          result: { ok: true, value: { items: [] } },
        }),
      })

      const result = await fetchWorkspaceListTag('ws-abc')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('rpc-id-mismatch')
      }
    })

    it('业务失败应返回 ok: false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'workspace-id-required' }),
      })

      const result = await fetchWorkspaceListTag('')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('workspace-id-required')
      }
    })

    it('HTTP 错误应返回 ok: false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const result = await fetchWorkspaceListTag('ws-123')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('http-500')
      }
    })

    it('网络错误应返回 ok: false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = await fetchWorkspaceListTag('ws-123')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('network-error')
      }
    })
  })

  // ===== fetchWorkspaceSessionTag =====

  describe('fetchWorkspaceSessionTag', () => {
    it('应发送正确的请求信封', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          value: {
            items: [
              {
                sessionId: 'session-abc',
                title: '测试',
                round: 1,
                endReason: 'completed',
                turns: 1,
                userMessages: 1,
                assistantMessages: 1,
                toolCalls: [],
                userMessageTexts: ['你好'],
                fileOperations: [],
                startedAt: 1000,
                updatedAt: 2000,
                totalEvents: 5,
              },
            ],
            hasMore: false,
          },
        }),
      })

      const result = await fetchWorkspaceSessionTag('session-abc', 50)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(WORKSPACE_SESSION_TAG_ROUTE)

      const body = JSON.parse(init.body)
      expect(body).toMatchObject({
        type: 'client-request',
        method: 'workspace.session.tag',
        payload: { sessionId: 'session-abc', maxMessages: 50 },
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items[0].sessionId).toBe('session-abc')
        expect(result.value.items[0].turns).toBe(1)
      }
    })

    it('不传 maxMessages 时 payload 中不应包含该字段', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, value: { items: [{}], hasMore: false } }),
      })

      await fetchWorkspaceSessionTag('session-xyz')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.payload).toEqual({ sessionId: 'session-xyz' })
    })
  })
})
