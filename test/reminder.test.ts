/**
 * 每日提醒纯函数单元测试（src/client/reminder.ts）。
 *
 * 覆盖（spec 3.2.1）：
 * - 当日活动过滤：waiting / abnormal_end 双计数、非今日活动不计入、无投影 / 空标签不计入
 * - 双计数文案、双零返回 null（不打扰）
 * - 排程时间计算：msUntil（严格未来 / 跨天）、isPastReminderTime、todayKey
 */
import { describe, expect, it } from 'vitest'
import {
  countTodaySessions,
  formatReminderText,
  isPastReminderTime,
  isSameLocalDate,
  msUntil,
  todayKey,
  type TagSummaryLike,
} from '../src/client/reminder'

/** 构造一个带投影标签的会话摘要（tag / lastActiveAt 可空）。 */
function session(
  tag: 'waiting' | 'abnormal_end' | 'completed' | 'invalid' | null,
  lastActiveAt: number | null,
): TagSummaryLike {
  if (tag === null || lastActiveAt === null) return { projectionValues: {} }
  return { projectionValues: { 'session-tag': { tag, lastActiveAt } } }
}

/** 今日 15:00 的时间戳（本地时区）。 */
function todayAt(hour: number, minute = 0): number {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

describe('countTodaySessions 统计口径', () => {
  it('当日 waiting 与 abnormal_end 各自计数', () => {
    const now = new Date(todayAt(15))
    const byId: Record<string, TagSummaryLike> = {
      s1: session('waiting', todayAt(10)),
      s2: session('abnormal_end', todayAt(11)),
      s3: session('abnormal_end', todayAt(12)),
    }
    expect(countTodaySessions(byId, now)).toEqual({ waiting: 1, abnormal: 2 })
  })

  it('非今日活动不计入（昨日异常 / 昨日等待）', () => {
    const now = new Date(todayAt(15))
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const byId: Record<string, TagSummaryLike> = {
      s1: session('abnormal_end', yesterday.getTime()),
      s2: session('waiting', yesterday.getTime()),
    }
    expect(countTodaySessions(byId, now)).toEqual({ waiting: 0, abnormal: 0 })
  })

  it('无投影 / 空标签 / 空 lastActiveAt 不计入', () => {
    const now = new Date(todayAt(15))
    const byId: Record<string, TagSummaryLike> = {
      s1: {}, // 无投影
      s2: session(null, null), // 空标签
      s3: session('waiting', null), // 空时间
    }
    expect(countTodaySessions(byId, now)).toEqual({ waiting: 0, abnormal: 0 })
  })

  it('非待关注标签（completed / invalid / in_progress）不计入', () => {
    const now = new Date(todayAt(15))
    const byId: Record<string, TagSummaryLike> = {
      s1: session('completed', todayAt(10)),
      s2: session('invalid', todayAt(11)),
    }
    expect(countTodaySessions(byId, now)).toEqual({ waiting: 0, abnormal: 0 })
  })
})

describe('formatReminderText 文案', () => {
  it('双计数文案', () => {
    expect(formatReminderText({ waiting: 1, abnormal: 2 })).toBe('有 1 个会话等待确认、2 个会话异常')
  })

  it('单侧为 0 时仍出文案', () => {
    expect(formatReminderText({ waiting: 3, abnormal: 0 })).toBe('有 3 个会话等待确认、0 个会话异常')
  })

  it('双零返回 null（不打扰）', () => {
    expect(formatReminderText({ waiting: 0, abnormal: 0 })).toBeNull()
  })
})

describe('时间工具', () => {
  it('msUntil：未来同一时刻差值为正', () => {
    const now = new Date(2026, 7, 25, 16, 30) // 16:30
    expect(msUntil('17:00', now)).toBe(30 * 60 * 1000)
  })

  it('msUntil：今日已过则排到明天', () => {
    const now = new Date(2026, 7, 25, 18, 0) // 18:00
    expect(msUntil('17:00', now)).toBe(23 * 60 * 60 * 1000)
  })

  it('isPastReminderTime：已过 / 恰好等于 / 未到', () => {
    expect(isPastReminderTime('17:00', new Date(2026, 7, 25, 17, 1))).toBe(true)
    expect(isPastReminderTime('17:00', new Date(2026, 7, 25, 17, 0))).toBe(true)
    expect(isPastReminderTime('17:00', new Date(2026, 7, 25, 16, 59))).toBe(false)
  })

  it('todayKey：本地日期 YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 7, 5))).toBe('2026-08-05')
    expect(todayKey(new Date(2026, 10, 25))).toBe('2026-11-25')
  })

  it('isSameLocalDate：同日 true，跨日 false', () => {
    const a = new Date(2026, 7, 25, 10, 0)
    const b = new Date(2026, 7, 25, 23, 59)
    const c = new Date(2026, 7, 26, 0, 0)
    expect(isSameLocalDate(a, b)).toBe(true)
    expect(isSameLocalDate(a, c)).toBe(false)
  })
})
