/**
 * 宿主端插件测试用例
 *
 * 测试 /dsh-session-host-test HTTP 接口的路由注册和响应格式
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

// 模拟 ctx.webServer
const mockRegister = vi.fn()
const mockCtx = {
  webServer: {
    register: mockRegister,
  },
} as unknown as Context

describe('dsh-session-base-host 插件', () => {
  let apply: typeof import('../src/index.ts').apply

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-base-host')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('webServer')
  })

  it('apply 函数应以路由对象注册 /dsh-session-host-test', () => {
    apply(mockCtx)
    expect(mockRegister).toHaveBeenCalledOnce()
    const route = mockRegister.mock.calls[0][0]
    expect(route).toMatchObject({
      kind: 'exact',
      path: '/dsh-session-host-test',
    })
    expect(typeof route.handler).toBe('function')
  })

  it('路由处理器应返回包含 serverTime 的 JSON', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]

    const mockReq = {} as any
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as any

    route.handler(mockReq, mockRes)

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = JSON.parse(mockRes.end.mock.calls[0][0])
    expect(body).toHaveProperty('serverTime')
    expect(typeof body.serverTime).toBe('number')
    expect(body.serverTime).toBeGreaterThan(0)
  })

  it('路由路径应以 /dsh-session-host- 开头', () => {
    apply(mockCtx)
    const route = mockRegister.mock.calls[0][0]
    expect(route.path).toMatch(/^\/dsh-session-host-/)
  })
})
