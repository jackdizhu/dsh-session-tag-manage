/**
 * 手动标签更新宿主服务单元测试（src/override.ts）。
 *
 * 覆盖（spec manual-tag-update → Requirement「宿主服务校验」+「手动标签来源标识」）：
 * - 开关关闭拒绝写入（reason: manual tag update disabled，不产生事件）
 * - 非法标签拒绝写入（reason: invalid tag，不产生事件）
 * - 会话不存在拒绝写入（reason: session not found，不产生事件）
 * - 合法写入生成 source: 'user-override' 标签事件（tagId/tag/reason/assignedAt 完整）
 *
 * 说明：`SessionTagOverrideService` 继承 `TypertRemoteService`，构造经 `ctx.reflect.provide`
 * 注册服务（真实 Context 提供该能力）；`set()` 内读取 `ctx.sessions`，测试注入桩存储。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { Config } from '../src/config'
import { SessionTagOverrideService } from '../src/override'

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

/** 构造注入桩存储（`ctx.sessions`）的真实 Cordis Context。 */
function makeContext(sessions: Map<string, Session>): Context {
  const ctx = new Context()
  ;(ctx as unknown as { sessions: { get: (id: SessionId) => Session | undefined } }).sessions = {
    get: (id: SessionId) => sessions.get(String(id)),
  }
  return ctx
}

/** 提取会话日志中的标签事件。 */
function tagEvents(session: Session): SessionEvent<'session-tag/assigned'>[] {
  return session.events.filter(
    (event): event is SessionEvent<'session-tag/assigned'> => event.type === 'session-tag/assigned',
  )
}

/** 构造已注册服务的测试环境。 */
function setup(options: { enabled?: boolean; session?: Session } = {}): {
  service: SessionTagOverrideService
  session?: Session
  store: Map<string, Session>
} {
  const store = new Map<string, Session>()
  if (options.session) store.set(String(options.session.id), options.session)
  const ctx = makeContext(store)
  const config: Config = { ...baseConfig, manualTagUpdateEnabled: options.enabled ?? true }
  const service = new SessionTagOverrideService(ctx, config)
  return { service, session: options.session, store }
}

describe('SessionTagOverrideService.set 宿主校验', () => {
  it('开关关闭拒绝写入且不产生事件', async () => {
    const session = Session.create(SessionId('s-disabled'))
    const { service } = setup({ enabled: false, session })

    const result = await service.set(String(session.id), 'invalid')

    expect(result).toEqual({ ok: false, reason: 'manual tag update disabled' })
    expect(tagEvents(session)).toHaveLength(0)
  })

  it('非法标签拒绝写入且不产生事件', async () => {
    const session = Session.create(SessionId('s-bad-tag'))
    const { service } = setup({ session })

    const result = await service.set(String(session.id), 'bogus' as never)

    expect(result).toEqual({ ok: false, reason: 'invalid tag' })
    expect(tagEvents(session)).toHaveLength(0)
  })

  it('会话不存在拒绝写入且不产生事件', async () => {
    const session = Session.create(SessionId('s-ghost'))
    const { service } = setup() // 无会话

    const result = await service.set(String(session.id), 'invalid')

    expect(result).toEqual({ ok: false, reason: 'session not found' })
    expect(session.events).toHaveLength(0)
  })

  it('合法写入生成 source=user-override 标签事件', async () => {
    const session = Session.create(SessionId('s-ok'), [])
    const { service } = setup({ session })

    const result = await service.set(String(session.id), 'invalid')

    expect(result).toEqual({ ok: true })
    const events = tagEvents(session)
    expect(events).toHaveLength(1)
    expect(events[0].data).toMatchObject({
      tagId: 'tag-s-ok',
      tag: 'invalid',
      source: 'user-override',
      reason: 'web ui manual',
    })
    expect(typeof events[0].data.assignedAt).toBe('number')
  })

  it('多次合法写入按序追加 user-override 事件', async () => {
    const session = Session.create(SessionId('s-multi'))
    const { service } = setup({ session })

    await service.set(String(session.id), 'invalid')
    await service.set(String(session.id), 'completed')

    const events = tagEvents(session)
    expect(events).toHaveLength(2)
    expect(events[0].data.tag).toBe('invalid')
    expect(events[1].data.tag).toBe('completed')
    expect(events.every((event) => event.data.source === 'user-override')).toBe(true)
  })
})
