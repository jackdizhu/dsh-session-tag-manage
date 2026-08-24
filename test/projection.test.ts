/**
 * 会话标签投影 fold 单元测试（src/projection.ts）。
 *
 * 覆盖（spec 2.3.1）：
 * - init 返回全 null 初始状态
 * - 无关事件返回同一状态引用（Object.is 相等 → 零下游工作）
 * - 活动事件刷新 lastActiveAt
 * - session-tag/assigned 后写覆盖 tag/source/assignedAt（lastActiveAt 保持）
 */
import { describe, expect, it } from 'vitest'
import { apply, init, type TagProjectionState } from '../src/projection'
import type { SessionTag, SessionTagSource, TagId } from '../src/events'
import '../src/events' // 副作用导入：激活 SessionEventMap 声明合并（session-tag/assigned）
import { makeEvent, makeRawEvent, userMessage } from './helpers'

/** 构造一条 session-tag/assigned 事件（tag 覆盖全部五分类，source 覆盖全部来源）。 */
function tagAssigned(overrides: Partial<{ tag: SessionTag; source: SessionTagSource; assignedAt: number; time: number }> = {}): ReturnType<typeof makeEvent> {
  return makeEvent(
    'session-tag/assigned',
    {
      tagId: 'tag-s1' as TagId,
      tag: overrides.tag ?? 'abnormal_end',
      source: overrides.source ?? 'rule',
      reason: 'test',
      assignedAt: overrides.assignedAt ?? 1_700_000_001_000,
    },
    overrides.time,
  )
}

describe('session-tag 投影 fold', () => {
  it('init 返回全 null 初始状态', () => {
    expect(init()).toEqual({ tag: null, source: null, assignedAt: null, lastActiveAt: null })
  })

  it('无关事件（如 step/start）返回同一引用', () => {
    const state = { ...init(), lastActiveAt: 1_000 }
    const next = apply(state, makeEvent('step/start', { turn: 1, step: 1 }))
    expect(next).toBe(state) // Object.is 相等
  })

  it('活动事件刷新 lastActiveAt（引用变化）', () => {
    const state = { ...init(), lastActiveAt: 1_000 }
    const event = userMessage([], 2_000)
    const next = apply(state, event)
    // makeEvent 会对传入 time 叠加全局 seq，故断言以事件实际 time 为准
    expect(next.lastActiveAt).toBe(event.time)
    expect(next).not.toBe(state)
    // 其余字段保持不变
    expect(next.tag).toBeNull()
    expect(next.source).toBeNull()
  })

  it('外部审批活动事件 approval/asked 刷新 lastActiveAt', () => {
    const state = { ...init(), lastActiveAt: 1_000 }
    const next = apply(state, makeRawEvent('approval/asked', { id: 'a1' }))
    expect(next.lastActiveAt).toBeGreaterThan(1_000)
  })

  it('session-tag/assigned 后写覆盖 tag/source/assignedAt（lastActiveAt 保持）', () => {
    const state = {
      tag: 'waiting' as const,
      source: 'llm' as const,
      assignedAt: 500,
      lastActiveAt: 1_000,
    }
    const next = apply(state, tagAssigned({ tag: 'abnormal_end', source: 'rule', assignedAt: 2_500 }))
    expect(next).toEqual({
      tag: 'abnormal_end',
      source: 'rule',
      assignedAt: 2_500,
      lastActiveAt: 1_000, // 打标本身非活动事件，lastActiveAt 保持
    })
  })

  it('多次 assigned 后写覆盖（最后一次生效）', () => {
    let state: TagProjectionState = init()
    state = apply(state, tagAssigned({ tag: 'waiting', source: 'llm' }))
    state = apply(state, tagAssigned({ tag: 'invalid', source: 'user-override' }))
    expect(state.tag).toBe('invalid')
    expect(state.source).toBe('user-override')
  })

  it('较旧时间戳活动事件到达时 lastActiveAt 单调不回退', () => {
    // state.lastActiveAt 取足够大的值，确保任意 seq 叠加后的 event.time 都属"更旧"
    const state = { ...init(), tag: 'abnormal_end' as const, lastActiveAt: 2_000_000_000_000 }
    const event = userMessage([], 1_000)
    const next = apply(state, event)
    expect(next.lastActiveAt).toBe(state.lastActiveAt) // 不回退
    expect(next).toBe(state) // 无变化 → 同一引用
  })

  it('assigned 后活动事件：lastActiveAt 更新，tag/source/assignedAt 保留', () => {
    const assigned = apply(init(), tagAssigned({ tag: 'waiting', source: 'user-override', assignedAt: 8_000 }))
    const event = userMessage([], 9_000)
    const next = apply(assigned, event)
    expect(next.tag).toBe('waiting')
    expect(next.source).toBe('user-override')
    expect(next.assignedAt).toBe(8_000)
    expect(next.lastActiveAt).toBe(event.time)
  })
})
