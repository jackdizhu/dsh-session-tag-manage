/**
 * 客户端插件测试用例
 *
 * 测试 Canvas 创建、点击事件绑定和日志输出
 */
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

// 模拟 DOM 环境
const mockAppendChild = vi.fn()
const mockContainer = {
  appendChild: mockAppendChild,
} as unknown as Element

// 模拟 querySelector
Object.defineProperty(document, 'querySelector', {
  value: vi.fn().mockReturnValue(mockContainer),
  writable: true,
})

describe('dsh-session-base-client 插件', () => {
  let apply: typeof import('../src/index.ts').apply
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const mod = await import('../src/index.ts')
    apply = mod.apply
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  it('应导出符合 Cordis 插件规范的 name', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.name).toBe('dsh-session-base-client')
  })

  it('应导出 inject 数组', async () => {
    const mod = await import('../src/index.ts')
    expect(mod.inject).toContain('slots')
  })

  it('apply 函数应创建 Canvas 元素并追加到容器', () => {
    apply({} as ClientContext)

    expect(mockAppendChild).toHaveBeenCalledOnce()
    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.tagName).toBe('CANVAS')
  })

  it('Canvas 应具有正确的尺寸（100x60）', () => {
    apply({} as ClientContext)

    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.width).toBe(100)
    expect(canvas.height).toBe(60)
  })

  it('Canvas 应设置 cursor: pointer 样式', () => {
    apply({} as ClientContext)

    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    expect(canvas.style.cursor).toBe('pointer')
  })

  it('Canvas 应绑定 click 事件监听器', () => {
    apply({} as ClientContext)

    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    const clickEvent = new MouseEvent('click', {
      offsetX: 50,
      offsetY: 30,
    })
    canvas.dispatchEvent(clickEvent)

    expect(consoleSpy).toHaveBeenCalledOnce()
    const logCall = consoleSpy.mock.calls[0]
    expect(logCall[0]).toContain('[SessionTag]')
  })

  it('点击事件日志应包含 type、time、x、y 属性', () => {
    apply({} as ClientContext)

    const canvas = mockAppendChild.mock.calls[0][0] as HTMLCanvasElement
    // 创建点击事件并手动设置 offsetX 和 offsetY（jsdom 不支持）
    const clickEvent = new MouseEvent('click', {
      clientX: 100,
      clientY: 100,
    })
    // jsdom 不支持 offsetX/offsetY，需要通过 Object.defineProperty 设置
    Object.defineProperty(clickEvent, 'offsetX', { value: 25, writable: false })
    Object.defineProperty(clickEvent, 'offsetY', { value: 15, writable: false })
    canvas.dispatchEvent(clickEvent)

    const logCall = consoleSpy.mock.calls[0]
    const logData = logCall[1]
    expect(logData).toHaveProperty('type', 'click')
    expect(logData).toHaveProperty('time')
    expect(logData).toHaveProperty('x', 25)
    expect(logData).toHaveProperty('y', 15)
  })
})
