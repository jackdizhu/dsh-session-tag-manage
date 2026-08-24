/**
 * 宿主入口编排集成测试（src/index.ts）。
 *
 * 覆盖：
 * - apply 注册投影与手动标签更新服务（vi.mock 断言调用）
 * - turn/end 异常 reason → 即时打标 abnormal_end
 * - turn/end completed → 延迟分析（计时到期才写入）
 * - turn/start → 取消旧计时并回 in_progress（豁免手动标签锁定）
 * - session/disposed → 回收该会话挂起计时器
 * - 插件卸载 disposer → 回收全部计时器
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index'
import type { Config } from '../src/config'
import type { TagId } from '../src/events'
import { registerTagProjection } from '../src/projection'
import { registerTagOverrideService } from '../src/override'
import { resetSeq, turnEndAbnormal, turnEndCompleted, turnStart } from './helpers'

// 屏蔽投影注册与手动标签服务注册的真实副作用，专注编排行为
vi.mock('../src/projection', () => ({ registerTagProjection: vi.fn() }))
vi.mock('../src/override', () => ({ registerTagOverrideService: vi.fn() }))

const baseConfig: Config = {
  delayMs: 60_000,
  analysisModel: 'deepseek-v4-flash',
  analysisProvider: 'deepseek',
  maxLastTurnMessages: 50,
  highlightTags: ['abnormal_end', 'waiting'],
  dailyReminderTime: '17:00',
  desktopReminderEnabled: true,
  manualTagUpdateEnabled: true,
}

/** 事件监听器类型（与 ctx.on 签名对齐）。 */
type Listener = (...args: unknown[]) => void

/** 记录 ctx.on 注册的监听器，供测试按事件名触发。 */
const listeners = new Map<string, Listener[]>()
/** 记录 ctx.effect 注册的 disposer（按 effect 名）。 */
const disposers = new Map<string, () => void>()

/** 构造 mock Context：捕获 on / effect，logger 静默，llm 空流。 */
function setupCtx(): Context {
  listeners.clear()
  disposers.clear()
  const ctx = {
    on: (event: string, listener: Listener): void => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
    },
    effect: (fn: () => () => void, name?: string): (() => void) => {
      const disposer = fn()
      if (name !== undefined) disposers.set(name, disposer)
      return disposer
    },
    logger: () => ({ warn: () => {}, debug: () => {}, info: () => {} }),
    llm: { stream: async function* () {} },
  } as unknown as Context
  return ctx
}

/** 触发某事件名下的全部监听器。 */
function emit(_ctx: Context, event: string, ...args: unknown[]): void {
  for (const listener of listeners.get(event) ?? []) listener(...args)
}

/** 读取会话日志中的标签事件。 */
function tagEvents(session: Session): Array<{ tag: unknown; source: unknown }> {
  return session.events
    .filter((event) => event.type === 'session-tag/assigned')
    .map((event) => ({ tag: event.data.tag, source: event.data.source }))
}

describe('apply 注册', () => {
  beforeEach(() => {
    resetSeq()
    vi.clearAllMocks()
  })

  it('注册投影与手动标签更新服务', () => {
    const ctx = setupCtx()
    apply(ctx, baseConfig)
    expect(registerTagProjection).toHaveBeenCalledWith(ctx)
    expect(registerTagOverrideService).toHaveBeenCalledWith(ctx, baseConfig)
  })
})

describe('宿主事件编排', () => {
  beforeEach(() => {
    resetSeq()
    vi.clearAllMocks()
  })

  it('turn/end 异常 reason 即时打标 abnormal_end（source=rule）', () => {
    const ctx = setupCtx()
    apply(ctx, baseConfig)
    const session = Session.create(SessionId('s-abnormal'))

    emit(ctx, 'session/event', session, turnEndAbnormal())

    expect(tagEvents(session)).toEqual([{ tag: 'abnormal_end', source: 'rule' }])
  })

  it('turn/end completed 不即时打标，延迟到期才写入', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setupCtx()
      apply(ctx, baseConfig)
      const session = Session.create(SessionId('s-completed'))

      emit(ctx, 'session/event', session, turnEndCompleted())
      // 未到延迟：无标签事件
      expect(tagEvents(session)).toHaveLength(0)

      // 到期后 analyze：无待办/审批/异常，且无可读文本 → 写 in_progress（source=llm）
      await vi.advanceTimersByTimeAsync(baseConfig.delayMs)
      expect(tagEvents(session)).toHaveLength(1)
      expect(tagEvents(session)[0]).toEqual({ tag: 'in_progress', source: 'llm' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('turn/start 重置为 in_progress，豁免手动标签锁定', () => {
    const ctx = setupCtx()
    apply(ctx, baseConfig)
    const session = Session.create(SessionId('s-reset'))
    // 先手动锁定为 invalid
    session.append('session-tag/assigned', {
      tagId: 'tag-manual' as TagId,
      tag: 'invalid',
      source: 'user-override',
      reason: 'web ui manual',
      assignedAt: Date.now(),
    })

    emit(ctx, 'session/event', session, turnStart())

    // 新轮次重置豁免锁定：手动 + in_progress 两条
    expect(tagEvents(session)).toEqual([
      { tag: 'invalid', source: 'user-override' },
      { tag: 'in_progress', source: 'rule' },
    ])
  })

  it('session/disposed 回收该会话挂起计时器，不再延迟分析', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setupCtx()
      apply(ctx, baseConfig)
      const session = Session.create(SessionId('s-disposed'))

      emit(ctx, 'session/event', session, turnEndCompleted()) // 启动延迟计时
      emit(ctx, 'session/disposed', session) // 会话销毁回收

      await vi.advanceTimersByTimeAsync(baseConfig.delayMs)
      expect(tagEvents(session)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('插件卸载 disposer 回收全部计时器，不再延迟分析', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setupCtx()
      apply(ctx, baseConfig)
      const session = Session.create(SessionId('s-unload'))

      emit(ctx, 'session/event', session, turnEndCompleted()) // 启动延迟计时
      // 模拟插件卸载：执行注册的 disposer
      disposers.get('session-tagger.dispose')?.()

      await vi.advanceTimersByTimeAsync(baseConfig.delayMs)
      expect(tagEvents(session)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => vi.useRealTimers())
