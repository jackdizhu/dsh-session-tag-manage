// @vitest-environment happy-dom
/**
 * 每日提醒 DOM 侧集成测试（src/client/reminder.ts 的 setupDailyReminder）。
 *
 * 覆盖（spec 3.2.1 的 DOM 相关场景）：
 * - 开关关闭：不排程、不注册监听、不弹
 * - granted 权限 + 已过时刻 + 页面可见 → 立即弹并写当日去重标记；再触发不重复弹
 * - 权限拒绝：静默降级（不弹、不报错、不写标记）
 * - default 权限竞态：visibilitychange / focus 双触发 → in-flight 守卫只发起一次请求、只弹一次
 * - 卸载回收：清理后监听移除、定时器清除、异步权限回调不再弹
 *
 * 注意：happy-dom 在同一文件的所有测试共享同一个 window/document，因此每个测试
 * 结束时 MUST 调用 setupDailyReminder 返回的 effect 清理回调，避免 checkFocus 监听器
 * 跨测试泄漏（泄漏会导致后续测试 focus 分发触发多个独立 notify 实例，破坏断言）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupDailyReminder, todayKey } from '../src/client/reminder'
import type { Config } from '../src/config'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 完整配置基线（dailyReminderTime 固定 17:00，desktopReminderEnabled 可覆盖）。 */
const baseConfig: Config = {
  delayMs: 7 * 60 * 1000,
  analysisModel: 'deepseek-v4-flash',
  analysisProvider: 'deepseek',
  maxLastTurnMessages: 50,
  highlightTags: ['abnormal_end', 'waiting'],
  dailyReminderTime: '17:00',
  desktopReminderEnabled: true,
  manualTagUpdateEnabled: true,
}

/** 构造一条今日有活动且标签待关注的会话投影（供 notify 统计命中）。 */
function attentionSession(tag: 'waiting' | 'abnormal_end'): unknown {
  const d = new Date()
  d.setHours(10, 0, 0, 0) // 今日 10:00
  return {
    projectionValues: {
      'session-tag': { tag, lastActiveAt: d.getTime() },
    },
  }
}

/** Notification 桩：记录实例、可配置 permission / requestPermission。 */
class MockNotification {
  static instances: MockNotification[] = []
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
  title: string
  options: NotificationOptions
  constructor(title: string, options: NotificationOptions) {
    this.title = title
    this.options = options
    MockNotification.instances.push(this)
  }
}

/** 最近一次 setupDailyReminder 注册的 effect 清理回调（afterEach 统一调用，防监听器泄漏）。 */
let activeCleanup: (() => void) | undefined

/**
 * 构造最小 ClientContext 桩：sessions.list.getSnapshot + ctx.effect 捕获清理回调。
 * 必须在 setupDailyReminder 执行后再调用 setup()，从而把真实清理回调回填到 activeCleanup。
 */
function makeCtx(byId: Record<string, unknown>): {
  ctx: ClientContext
  getCleanup: () => (() => void) | undefined
  setup: (config: Config) => void
} {
  let cleanup: (() => void) | undefined
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ byId }),
      },
    },
    effect: (fn: () => () => void) => {
      cleanup = fn()
    },
  } as unknown as ClientContext
  return {
    ctx,
    getCleanup: () => cleanup,
    setup(config: Config): void {
      setupDailyReminder(ctx, config)
      activeCleanup = cleanup // setup 之后再回填，确保拿到真实清理回调
    },
  }
}

/** 固定系统时间为"已过 17:00"的某一天，保证聚焦补查路径命中。 */
function useSystemTimePastReminder(): void {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 7, 25, 17, 30))
}

/** 刷新微任务队列（让 requestPermission 的 .then 执行）。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  MockNotification.instances = []
  MockNotification.permission = 'granted'
  MockNotification.requestPermission = vi.fn(() => Promise.resolve<NotificationPermission>('granted'))
  localStorage.clear()
  vi.stubGlobal('Notification', MockNotification) // 让被测代码引用到桩
})

afterEach(() => {
  activeCleanup?.() // 卸载 effect：移除监听器与定时器，防止跨测试泄漏
  activeCleanup = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('setupDailyReminder 开关控制', () => {
  it('desktopReminderEnabled=false：不排程、不注册 effect、不弹', () => {
    useSystemTimePastReminder()
    const { getCleanup, setup } = makeCtx({ s1: attentionSession('waiting') })
    setup({ ...baseConfig, desktopReminderEnabled: false })
    expect(getCleanup()).toBeUndefined() // 未注册 effect → 未排程未监听
    expect(MockNotification.instances).toHaveLength(0)
  })
})

describe('setupDailyReminder 触发与去重', () => {
  it('granted + 已过时刻 + 页面可见：立即弹一次并写当日去重标记，再触发不重复', () => {
    useSystemTimePastReminder()
    const { setup } = makeCtx({ s1: attentionSession('waiting'), s2: attentionSession('abnormal_end') })
    setup(baseConfig)

    // 初始 checkFocus：已过 17:00 且可见 → 立即弹
    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0].options.body).toBe('有 1 个会话等待确认、1 个会话异常')
    // 当日去重标记已写入
    expect(localStorage.getItem('dsh-session-tag-manage:last-notified-date')).toBe(todayKey())

    // 再次 focus 补查：当日已提醒 → 不重复弹
    window.dispatchEvent(new Event('focus'))
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('权限拒绝：静默降级（不弹、不写标记）', () => {
    useSystemTimePastReminder()
    MockNotification.permission = 'denied'
    const { setup } = makeCtx({ s1: attentionSession('waiting') })
    setup(baseConfig)
    expect(MockNotification.instances).toHaveLength(0)
    expect(localStorage.getItem('dsh-session-tag-manage:last-notified-date')).toBeNull()
  })

  it('无待关注会话：双零不弹、不写标记', () => {
    useSystemTimePastReminder()
    const { setup } = makeCtx({ s1: {} })
    setup(baseConfig)
    expect(MockNotification.instances).toHaveLength(0)
    expect(localStorage.getItem('dsh-session-tag-manage:last-notified-date')).toBeNull()
  })
})

describe('setupDailyReminder 竞态防护', () => {
  it('default 权限：visibilitychange 与 focus 双触发只发起一次请求、只弹一次', async () => {
    useSystemTimePastReminder()
    MockNotification.permission = 'default'
    let resolvePermission!: (permission: NotificationPermission) => void
    MockNotification.requestPermission = vi.fn(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          resolvePermission = resolve
        }),
    )
    const { setup } = makeCtx({ s1: attentionSession('waiting') })

    setup(baseConfig) // 初始 checkFocus → notify #1，in-flight 置位
    window.dispatchEvent(new Event('focus')) // 双触发 → notify #2 被 in-flight 守卫拦截
    window.dispatchEvent(new Event('visibilitychange')) // 三触发 → notify #3 仍被拦截
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)

    resolvePermission('granted')
    await flushMicrotasks()
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('卸载后：监听移除、异步权限回调不再弹', async () => {
    useSystemTimePastReminder()
    MockNotification.permission = 'default'
    let resolvePermission!: (permission: NotificationPermission) => void
    MockNotification.requestPermission = vi.fn(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          resolvePermission = resolve
        }),
    )
    const { getCleanup, setup } = makeCtx({ s1: attentionSession('waiting') })
    setup(baseConfig)

    const cleanup = getCleanup()
    expect(cleanup).toBeDefined()
    cleanup!() // 模拟插件卸载：disposed=true、清定时器、移除监听

    resolvePermission('granted')
    await flushMicrotasks()
    expect(MockNotification.instances).toHaveLength(0) // disposed 守卫阻止

    // 监听已移除：focus / visibilitychange 不再触发任何统计/通知
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('visibilitychange'))
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
    expect(MockNotification.instances).toHaveLength(0)
  })
})
