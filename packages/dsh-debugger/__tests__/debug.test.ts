import { describe, it, expect, vi, beforeEach } from 'vitest'

// 本地无真实 @deepseek-ai/dsh-storage-domain / zod（运行时由 DSH 宿主提供），
// 单元测试以 mock 替代，仅验证本插件拦截逻辑。
vi.mock('@deepseek-ai/dsh-storage-domain', () => ({
  defineDomain: vi.fn(() => ({})),
  domainTable: vi.fn(() => ({})),
}))
vi.mock('zod', () => ({
  z: {
    object: vi.fn(() => ({})),
    string: vi.fn(() => ({ optional: vi.fn(() => ({})) })),
    number: vi.fn(() => ({})),
    any: vi.fn(() => ({})),
  },
}))

import { installDebugMode } from '../src/debug.js'
import { DebuggerState } from '../src/debug-state.js'

/** 收集 async iterable 的全部分块 */
async function collect(gen: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const c of gen) out.push(c)
  return out
}

describe('debug mode (llm/stream interception)', () => {
  let open: ReturnType<typeof vi.fn>
  let put: ReturnType<typeof vi.fn>
  let listener: ((options: unknown, next: () => AsyncIterable<unknown>) => AsyncIterable<unknown>) | undefined
  let ctx: any
  let store: any

  beforeEach(() => {
    put = undefined as unknown as ReturnType<typeof vi.fn>
    open = vi.fn(async () => ({
      putRecord: (put = vi.fn()),
      deleteRecord: vi.fn(),
      loadAll: vi.fn(async () => ({ tables: {}, global: null })),
      close: vi.fn(),
    }))
    listener = undefined
    ctx = {
      storage: { backend: { get: (name: string) => (name === 'json' ? { kv: { open } } : undefined) } },
      on: (event: string, fn: any) => {
        if (event === 'llm/stream') listener = fn
      },
    }
  })

  it('调试开启（配置兜底）：拦截真实调用，记录参数，合成响应（不含 signal）', async () => {
    store = { get: () => ({ debug: { enabled: true, domain: 'dsh-llm-debug', reply: 'DEBUG_REPLY' } }) }
    installDebugMode(ctx, store, new DebuggerState())
    expect(listener).toBeDefined()

    const signal = new AbortController().signal
    const options = {
      provider: 'deepseek',
      model: 'dsh-model',
      messages: [{ role: 'user', content: 'hi' }],
      signal,
    }
    const next = vi.fn(() => (async function* () {})())

    const gen = listener!(options, next)
    const chunks = await collect(gen)

    // 1) 真实 LLM 未被调用
    expect(next).not.toHaveBeenCalled()
    // 2) 合成响应分块序列正确（reply 追加了参数落地位置）
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'text' })
    expect((chunks[1] as any).text).toContain('DEBUG_REPLY')
    expect((chunks[1] as any).text).toContain('params:')
    expect((chunks[2] as any).block.text).toContain('DEBUG_REPLY')
    expect(chunks[3]).toEqual({ type: 'finish', reason: { kind: 'stop' } })

    // 3) 参数被记录到 storageDomain（落盘在下一拍）
    await new Promise((r) => setTimeout(r, 10))
    expect(open).toHaveBeenCalled()
    expect(put).toHaveBeenCalled()
    const rec = put.mock.calls[0][2] as any
    expect(rec.provider).toBe('deepseek')
    expect(rec.model).toBe('dsh-model')
    expect(rec.request.provider).toBe('deepseek')
    expect(rec.request.signal).toBeUndefined() // signal 被清洗，不可序列化
  })

  it('调试关闭：透传 next()，不记录参数', async () => {
    store = { get: () => ({ debug: { enabled: false, domain: 'dsh-llm-debug', reply: 'x' } }) }
    installDebugMode(ctx, store, new DebuggerState())
    const next = vi.fn(() => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })())
    const gen = listener!({ provider: 'p', model: 'm', messages: [] }, next)
    await collect(gen)
    expect(next).toHaveBeenCalledOnce()
    await new Promise((r) => setTimeout(r, 10))
    expect(put).toBeUndefined() // 未记录（on 中未赋值 put 说明 table 未被调用）
  })

  it('会话级开关（/debugger on）：配置兜底关闭时，开启会话仍被拦截', async () => {
    store = { get: () => ({ debug: { enabled: false, domain: 'dsh-llm-debug', reply: 'DEBUG_REPLY' } }) }
    const state = new DebuggerState()
    state.enable('sess-1')
    installDebugMode(ctx, store, state)

    const next = vi.fn(() => (async function* () {})())
    const gen = listener!({ provider: 'p', model: 'm', sessionId: 'sess-1', messages: [] }, next)
    const chunks = await collect(gen)
    expect(next).not.toHaveBeenCalled()
    expect((chunks[1] as { text: string }).text).toContain('DEBUG_REPLY')

    // 其它会话不受影响：仍透传
    const next2 = vi.fn(() => (async function* () {})())
    await collect(listener!({ provider: 'p', model: 'm', sessionId: 'sess-2', messages: [] }, next2))
    expect(next2).toHaveBeenCalledOnce()
  })
})
