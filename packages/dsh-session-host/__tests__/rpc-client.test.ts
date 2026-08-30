/**
 * rpc-client 工具单元测试
 *
 * 覆盖：
 * - dshRpcCall：成功响应、业务失败、HTTP 错误、网络超时、格式校验
 * - fetchWorkspaceList：正常调用
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch 全局函数
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' })

import {
  dshRpcCall,
  fetchWorkspaceList,
} from '../src/utils/rpc-client.js'

describe('rpc-client 工具', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===== dshRpcCall =====

  describe('dshRpcCall', () => {
    it('应正确构造 RPC 请求信封', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: { ok: true, value: { items: [] } },
        }),
      })

      await dshRpcCall('http://127.0.0.1:3080', 'workspace.list', {})

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('http://127.0.0.1:3080/api/workspace.list')
      expect(init.method).toBe('POST')
      expect(init.headers['content-type']).toContain('application/json')

      const body = JSON.parse(init.body)
      expect(body).toMatchObject({
        type: 'client-request',
        rpcId: 'test-uuid-1234',
        method: 'workspace.list',
        payload: {},
      })
    })

    it('成功响应应返回 ok: true 和 value', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: { ok: true, value: { data: 'hello' } },
        }),
      })

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toEqual({ data: 'hello' })
        expect(result.rpcId).toBe('test-uuid-1234')
      }
    })

    it('业务失败应返回 ok: false 和 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: { ok: false, error: 'session-not-found' },
        }),
      })

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('session-not-found')
      }
    })

    it('业务失败（结构化 error）应正确返回', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: {
            ok: false,
            error: { code: 'CORRUPT_LOG', message: 'corrupt session log', details: {} },
          },
        }),
      })

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toEqual({ code: 'CORRUPT_LOG', message: 'corrupt session log', details: {} })
      }
    })

    it('HTTP 传输层错误应返回 ok: false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('http-404')
      }
    })

    it('网络错误应返回 ok: false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('network-error')
        expect(result.error).toContain('ECONNREFUSED')
      }
    })

    it('响应格式校验失败应返回 ok: false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: 'wrong', rpcId: 'wrong' }),
      })

      const result = await dshRpcCall('http://127.0.0.1:3080', 'test.method', {})

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('invalid-response-format')
      }
    })

    it('应去除 baseUrl 末尾斜杠', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: { ok: true, value: {} },
        }),
      })

      await dshRpcCall('http://127.0.0.1:3080///', 'test.method', {})

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('http://127.0.0.1:3080/api/test.method')
    })

    it('自定义 headers 应被合并', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: { ok: true, value: {} },
        }),
      })

      await dshRpcCall('http://127.0.0.1:3080', 'test.method', {}, {
        headers: { 'x-custom': 'value' },
      })

      const [, init] = mockFetch.mock.calls[0]
      expect(init.headers['x-custom']).toBe('value')
    })
  })

  // ===== fetchWorkspaceList =====

  describe('fetchWorkspaceList', () => {
    it('应调用 workspace.list 并返回结果', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: 'test-uuid-1234',
          result: {
            ok: true,
            value: {
              items: [
                { workspaceId: 'ws-1', path: '/tmp', title: 'test', sessionIds: [], createdAt: '', updatedAt: '' },
              ],
              archivedSessionIds: [],
            },
          },
        }),
      })

      const result = await fetchWorkspaceList('http://127.0.0.1:3080')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.items).toHaveLength(1)
        expect(result.value.items[0].workspaceId).toBe('ws-1')
      }
    })
  })
})
