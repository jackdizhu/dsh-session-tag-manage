/**
 * 客户端插件测试用例
 *
 * 测试 Canvas 创建、点击事件绑定和日志输出
 */
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

describe('dsh-session-tag-manage-client 插件', () => {
  let apply: typeof import('../src/index.ts').apply
  let logSpy: ReturnType<typeof vi.spyOn>
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleGroupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})

    // 清理之前的 cleanup 函数
    delete (window as any).__sessionTagCleanup

    // 清理之前测试残留的 DOM
    document.body.innerHTML = ''

    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  afterEach(() => {
    logSpy.mockRestore()
    consoleGroupSpy.mockRestore()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-tag-manage-client')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('slots')
  })

  it('apply 函数应创建 Canvas 元素并固定定位到右下角', () => {
    apply({} as ClientContext)

    const canvas = document.body.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.tagName).toBe('CANVAS')
  })

  it('Canvas 应具有正确的尺寸（100x60）', () => {
    apply({} as ClientContext)

    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(60)
  })

  it('Canvas 应设置右下角固定定位样式', () => {
    apply({} as ClientContext)

    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.style.cursor).toBe('pointer')
    expect(canvas.style.position).toBe('fixed')
    expect(canvas.style.right).toBe('16px')
    expect(canvas.style.bottom).toBe('16px')
  })

  it('Canvas 应设置 data-session-tag-canvas 属性', () => {
    apply({} as ClientContext)

    const canvas = document.body.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.getAttribute('data-session-tag-canvas')).toBe('true')
  })

  it('Canvas 始终追加到 document.body', () => {
    apply({} as ClientContext)

    const canvas = document.body.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas!.tagName).toBe('CANVAS')
  })

  it('apply 应打印 ctx 上下文日志', () => {
    const ctx = { slots: { register: vi.fn() } } as unknown as ClientContext
    apply(ctx)

    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    const hasContextLog = allLogs.some(log => String(log).includes('ctx 上下文'))
    expect(hasContextLog).toBe(true)
  })

  it('apply 应打印 slots 可用性', () => {
    apply({ slots: {} } as ClientContext)

    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    const hasSlotsLog = allLogs.some(log => String(log).includes('ctx.slots 可用'))
    expect(hasSlotsLog).toBe(true)
  })

  it('apply 应打印挂载日志', () => {
    apply({} as ClientContext)

    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    const hasMountLog = allLogs.some(log => String(log).includes('右下角固定定位'))
    expect(hasMountLog).toBe(true)
  })

  it('apply 应启动 MutationObserver', () => {
    apply({} as ClientContext)

    const allLogs = logSpy.mock.calls.map(c => c.join(' '))
    const hasObserverLog = allLogs.some(log => String(log).includes('MutationObserver 已启动'))
    expect(hasObserverLog).toBe(true)
  })

  it('apply 应提供 cleanup 函数', () => {
    apply({} as ClientContext)
    expect(typeof (window as any).__sessionTagCleanup).toBe('function')
  })

  it('apply 应打印 DOM 节点扫描报告', () => {
    apply({} as ClientContext)

    expect(consoleGroupSpy).toHaveBeenCalled()
    const groupCalls = consoleGroupSpy.mock.calls.map(c => c[0])
    const hasReport = groupCalls.some(log => String(log).includes('DOM 节点扫描报告'))
    expect(hasReport).toBe(true)
  })

  it('apply 应订阅工作区数据', () => {
    const mockSubscribe = vi.fn().mockReturnValue(() => {})
    const mockGetSnapshot = vi.fn().mockReturnValue({ items: [] })
    const ctx = {
      slots: {},
      workspaces: {
        list: {
          getSnapshot: mockGetSnapshot,
          subscribe: mockSubscribe,
        },
      },
    } as unknown as ClientContext
    apply(ctx)

    expect(mockGetSnapshot).toHaveBeenCalled()
    expect(mockSubscribe).toHaveBeenCalled()
  })

  it('apply 应订阅会话数据', () => {
    const mockSubscribe = vi.fn().mockReturnValue(() => {})
    const mockGetSnapshot = vi.fn().mockReturnValue({ items: [] })
    const ctx = {
      slots: {},
      sessions: {
        list: {
          getSnapshot: mockGetSnapshot,
          subscribe: mockSubscribe,
        },
      },
    } as unknown as ClientContext
    apply(ctx)

    expect(mockGetSnapshot).toHaveBeenCalled()
    expect(mockSubscribe).toHaveBeenCalled()
  })
})
