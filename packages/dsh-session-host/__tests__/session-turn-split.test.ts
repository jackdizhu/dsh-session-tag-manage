import { describe, it, expect } from 'vitest'
import { splitTurns, classifyRoundEndReason } from '../src/utils/session-history.js'
import type { SessionHistoryEvent } from '../src/utils/session-history.js'

function ev(seq: number, type: string, data: Record<string, unknown> = {}): SessionHistoryEvent {
  return { event: { type, seq, time: seq * 1000, data } }
}

describe('splitTurns', () => {
  it('单 turn + 前导种子段 → 1 段且前导事件并入首段', () => {
    const events = [
      ev(0, 'session/end-seed'),
      ev(1, 'session/title', { title: '你好' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'user/message', { source: { kind: 'user' } }),
      ev(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const segs = splitTurns(events)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toHaveLength(5) // 前导 + turn 全部保留
  })

  it('多 turn → 按 turn 数量切分', () => {
    const events = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ev(2, 'turn/start', { turn: 2 }),
      ev(3, 'turn/end', { turn: 2, reason: { kind: 'aborted' } }),
    ]
    expect(splitTurns(events)).toHaveLength(2)
  })

  it('纯前导段（无 turn/start）→ 单条 seed 段', () => {
    const events = [ev(0, 'session/title', { title: 'x' }), ev(1, 'assistant/message', {})]
    const segs = splitTurns(events)
    expect(segs).toHaveLength(1)
    expect(classifyRoundEndReason(segs[0])).toBe('seed')
  })
})

describe('classifyRoundEndReason', () => {
  it('末条 turn/end.reason.kind 决定 endReason', () => {
    const seg = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
    ]
    expect(classifyRoundEndReason(seg)).toBe('error')
  })

  it('aborted 异常终止轮次标记 aborted', () => {
    const seg = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
    ]
    expect(classifyRoundEndReason(seg)).toBe('aborted')
  })

  it('末轮无 turn/end → ongoing', () => {
    const seg = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'assistant/chunk', {}),
    ]
    expect(classifyRoundEndReason(seg)).toBe('ongoing')
  })

  it('纯前导段无 turn/start → seed', () => {
    const seg = [ev(0, 'session/title', { title: 'x' }), ev(1, 'assistant/message', {})]
    expect(classifyRoundEndReason(seg)).toBe('seed')
  })

  it('覆盖 max-tokens / blocked / interrupted 三类结束原因', () => {
    const kinds = ['max-tokens', 'blocked', 'interrupted'] as const
    for (const kind of kinds) {
      const seg = [
        ev(0, 'turn/start', { turn: 1 }),
        ev(1, 'turn/end', { turn: 1, reason: { kind } }),
      ]
      expect(classifyRoundEndReason(seg)).toBe(kind)
    }
  })

  it('未知 reason.kind 回退 ongoing 不抛错', () => {
    const seg = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'turn/end', { turn: 1, reason: { kind: 'unknown-kind' as never } }),
    ]
    expect(classifyRoundEndReason(seg)).toBe('ongoing')
  })
})
