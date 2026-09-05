import { describe, it, expect, vi } from 'vitest'

import {
  parseDebuggerInput,
  executeDebuggerCommand,
  installDebuggerCommand,
} from '../src/commands/index.js'
import { debuggerFallbackAction } from '../src/index.js'

/** 构造指令调用载荷 */
function makeInvocation(rawInput: string, sessionId = 's1') {
  return {
    commandId: 'cmd-1',
    agent: { session: { id: sessionId, header: { cwd: '/tmp' }, events: [] } },
    rawInput,
    signal: new AbortController().signal,
  }
}

/**
 * 构造最小 ConfigStore 桩（全局开关模型）：get 读 / setDebugEnabled 写同一全局布尔。
 */
function makeStore(debugEnabled = true) {
  let enabled = debugEnabled
  const store = {
    get: () => ({ debug: { enabled, domain: 'd', reply: 'r' } }),
    setDebugEnabled: (v: boolean) => {
      enabled = v
    },
    isEnabled: () => enabled,
  }
  return store
}

describe('parseDebuggerInput', () => {
  it('空参数等同 on（用户确认的默认行为）', () => {
    expect(parseDebuggerInput('')).toEqual({ action: 'on' })
    expect(parseDebuggerInput('   ')).toEqual({ action: 'on' })
  })

  it('on | off | status 大小写不敏感，支持中文别名', () => {
    expect(parseDebuggerInput('on')).toEqual({ action: 'on' })
    expect(parseDebuggerInput(' OFF ')).toEqual({ action: 'off' })
    expect(parseDebuggerInput('Status')).toEqual({ action: 'status' })
    expect(parseDebuggerInput('开启')).toEqual({ action: 'on' })
    expect(parseDebuggerInput('关闭')).toEqual({ action: 'off' })
    expect(parseDebuggerInput('当前状态')).toEqual({ action: 'status' })
  })

  it('未知参数判为用法错误', () => {
    expect(parseDebuggerInput('xyz')).toEqual({ action: 'error' })
    expect(parseDebuggerInput('on off')).toEqual({ action: 'error' })
  })
})

describe('executeDebuggerCommand（全局开关）', () => {
  it('无参 = 开启：置全局 enabled 并返回确认文本', () => {
    const store = makeStore(false)
    const result = executeDebuggerCommand(makeInvocation(''), store as never)
    expect(result.kind).toBe('success')
    expect(store.isEnabled()).toBe(true) // 全局已开
    expect((result as { text?: string }).text).toContain('已全局开启')
  })

  it('on：同无参，置全局 enabled=true', () => {
    const store = makeStore(false)
    executeDebuggerCommand(makeInvocation('on'), store as never)
    expect(store.isEnabled()).toBe(true)
  })

  it('off：置全局 enabled=false', () => {
    const store = makeStore(true)
    const result = executeDebuggerCommand(makeInvocation('off'), store as never)
    expect(result.kind).toBe('success')
    expect(store.isEnabled()).toBe(false)
    expect((result as { text?: string }).text).toContain('已全局关闭')
  })

  it('status：全局关闭 → 返回"关闭"', () => {
    const store = makeStore(false)
    const result = executeDebuggerCommand(makeInvocation('status'), store as never)
    expect((result as { text?: string }).text).toContain('关闭')
  })

  it('status：全局开启 → 返回"开启"（同口径于拦截判定）', () => {
    const store = makeStore(true)
    const result = executeDebuggerCommand(makeInvocation('status'), store as never)
    expect((result as { text?: string }).text).toContain('开启')
  })

  it('未知参数返回 error 与用法提示，不改变开关', () => {
    const store = makeStore(true)
    const result = executeDebuggerCommand(makeInvocation('nonsense'), store as never)
    expect(result.kind).toBe('error')
    expect((result as { text?: string }).text).toContain('Usage: /debugger')
    expect(store.isEnabled()).toBe(true)
  })

  it('无会话上下文仍可执行全局开关（仅跳过气泡追加）', () => {
    const store = makeStore(false)
    const invocation = makeInvocation('on')
    ;(invocation.agent as unknown as { session: unknown }).session = undefined
    const result = executeDebuggerCommand(invocation, store as never)
    expect(result.kind).toBe('success')
    expect(store.isEnabled()).toBe(true)
  })
})

describe('installDebuggerCommand', () => {
  it('以 name=debugger 注册，handler 正确分派到全局开关', () => {
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      commands: { register: (cmd: Record<string, unknown>) => { registered.push(cmd); return () => {} } },
      logger: { warn: vi.fn() },
    }
    const store = makeStore(false)
    installDebuggerCommand(ctx as never, store as never)
    expect(registered).toHaveLength(1)
    expect(registered[0].name).toBe('debugger')
    expect(registered[0].input).toEqual({ hint: '[on|off|status]' })
    const result = (registered[0].handler as (inv: never) => { kind: string })(
      makeInvocation('on') as never,
    )
    expect(result.kind).toBe('success')
    expect(store.isEnabled()).toBe(true) // 全局 enabled 被置位
  })

  it('注册失败（如重名）仅告警不抛出', () => {
    const warn = vi.fn()
    const ctx = {
      commands: { register: () => { throw new Error('duplicate') } },
      logger: { warn },
    }
    expect(() => installDebuggerCommand(ctx as never, makeStore() as never)).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('debuggerFallbackAction（headless pre-step 兜底判定）', () => {
  /** 构造一条用户消息 */
  function userMsg(text: string) {
    return { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }
  }

  it('整条 /debugger 或 /debugger on → on', () => {
    expect(debuggerFallbackAction([userMsg('/debugger')])).toBe('on')
    expect(debuggerFallbackAction([userMsg('/debugger on')])).toBe('on')
    expect(debuggerFallbackAction([userMsg('/DEBUGGER ON')])).toBe('on')
  })

  it('/debugger off / status 正确解析（含中文别名）', () => {
    expect(debuggerFallbackAction([userMsg('/debugger off')])).toBe('off')
    expect(debuggerFallbackAction([userMsg('/debugger status')])).toBe('status')
    expect(debuggerFallbackAction([userMsg('/debugger 关闭')])).toBe('off')
  })

  it('含前后空白仍可命中；前后缀文字不命中（防误判普通提问）', () => {
    expect(debuggerFallbackAction([userMsg('  /debugger on  ')])).toBe('on')
    expect(debuggerFallbackAction([userMsg('介绍一下 /debugger 指令')])).toBeUndefined()
    expect(debuggerFallbackAction([userMsg('/debugger on please')])).toBeUndefined()
  })

  it('非法参数不当作指令', () => {
    expect(debuggerFallbackAction([userMsg('/debugger xyz')])).toBeUndefined()
  })

  it('非用户消息或非文本块不参与判定', () => {
    expect(debuggerFallbackAction([
      { role: 'assistant', content: [{ type: 'text', text: '/debugger on' }] },
    ])).toBeUndefined()
    expect(debuggerFallbackAction([
      { role: 'user', content: [{ type: 'reasoning', text: '/debugger on' }] },
    ])).toBeUndefined()
  })
})
