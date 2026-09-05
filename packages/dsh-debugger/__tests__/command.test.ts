import { describe, it, expect, vi } from 'vitest'

import { DebuggerState } from '../src/debug-state.js'
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

/** 构造最小 ConfigStore 桩 */
function makeStore(debugEnabled = false) {
  return { get: () => ({ debug: { enabled: debugEnabled, domain: 'd', reply: 'r' } }) } as never
}

describe('parseDebuggerInput', () => {
  it('空参数等同 on（用户确认的默认行为）', () => {
    expect(parseDebuggerInput('')).toEqual({ action: 'on' })
    expect(parseDebuggerInput('   ')).toEqual({ action: 'on' })
  })

  it('on | off | status 大小写不敏感', () => {
    expect(parseDebuggerInput('on')).toEqual({ action: 'on' })
    expect(parseDebuggerInput(' OFF ')).toEqual({ action: 'off' })
    expect(parseDebuggerInput('Status')).toEqual({ action: 'status' })
  })

  it('未知参数判为用法错误', () => {
    expect(parseDebuggerInput('xyz')).toEqual({ action: 'error' })
    expect(parseDebuggerInput('on off')).toEqual({ action: 'error' })
  })
})

describe('DebuggerState（会话级状态机）', () => {
  it('默认全部关闭', () => {
    const state = new DebuggerState()
    expect(state.isEnabled('s1')).toBe(false)
    expect(state.isEnabled(undefined)).toBe(false)
  })

  it('enable/disable/drop 按会话隔离', () => {
    const state = new DebuggerState()
    state.enable('s1')
    state.enable('s2')
    expect(state.isEnabled('s1')).toBe(true)
    state.disable('s1')
    expect(state.isEnabled('s1')).toBe(false)
    expect(state.isEnabled('s2')).toBe(true)
    state.drop('s2')
    expect(state.isEnabled('s2')).toBe(false)
  })
})

describe('executeDebuggerCommand', () => {
  it('无参 = 开启：置位状态并返回确认文本', () => {
    const state = new DebuggerState()
    const result = executeDebuggerCommand(makeInvocation(''), state, makeStore())
    expect(result.kind).toBe('success')
    expect(state.isEnabled('s1')).toBe(true)
    expect((result as { text?: string }).text).toContain('enabled for session s1')
  })

  it('off：复位状态并返回确认文本', () => {
    const state = new DebuggerState()
    state.enable('s1')
    const result = executeDebuggerCommand(makeInvocation('off'), state, makeStore())
    expect(result.kind).toBe('success')
    expect(state.isEnabled('s1')).toBe(false)
  })

  it('status：会话级关闭且配置兜底关闭 → OFF', () => {
    const state = new DebuggerState()
    const result = executeDebuggerCommand(makeInvocation('status'), state, makeStore(false))
    expect((result as { text?: string }).text).toContain('OFF')
  })

  it('status：配置兜底开启时显示 ON（同口径于拦截判定）', () => {
    const state = new DebuggerState()
    const result = executeDebuggerCommand(makeInvocation('status'), state, makeStore(true))
    expect((result as { text?: string }).text).toContain('ON')
  })

  it('未知参数返回 error 与用法提示，不改变状态', () => {
    const state = new DebuggerState()
    const result = executeDebuggerCommand(makeInvocation('nonsense'), state, makeStore())
    expect(result.kind).toBe('error')
    expect(state.isEnabled('s1')).toBe(false)
  })

  it('缺少会话上下文返回 error', () => {
    const state = new DebuggerState()
    const invocation = makeInvocation('on')
    ;(invocation.agent as unknown as { session: unknown }).session = undefined
    const result = executeDebuggerCommand(invocation, state, makeStore())
    expect(result.kind).toBe('error')
  })
})

describe('installDebuggerCommand', () => {
  it('以 name=debugger 注册，handler 正确分派', () => {
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      commands: { register: (cmd: Record<string, unknown>) => { registered.push(cmd); return () => {} } },
      logger: { warn: vi.fn() },
    }
    const state = new DebuggerState()
    installDebuggerCommand(ctx as never, state, makeStore())
    expect(registered).toHaveLength(1)
    expect(registered[0].name).toBe('debugger')
    expect(registered[0].input).toEqual({ hint: '[on|off|status]' })
    const result = (registered[0].handler as (inv: never) => { kind: string })(
      makeInvocation('on') as never,
    )
    expect(result.kind).toBe('success')
    expect(state.isEnabled('s1')).toBe(true)
  })

  it('注册失败（如重名）仅告警不抛出', () => {
    const warn = vi.fn()
    const ctx = {
      commands: { register: () => { throw new Error('duplicate') } },
      logger: { warn },
    }
    expect(() => installDebuggerCommand(ctx as never, new DebuggerState(), makeStore())).not.toThrow()
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

  it('/debugger off / status 正确解析', () => {
    expect(debuggerFallbackAction([userMsg('/debugger off')])).toBe('off')
    expect(debuggerFallbackAction([userMsg('/debugger status')])).toBe('status')
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
