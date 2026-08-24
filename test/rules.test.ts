/**
 * 规则判定器单元测试（src/rules.ts）。
 *
 * 覆盖：
 * - 异常终止：最后一个 turn/end reason 非 completed → abnormal_end
 * - 会话等待：approval/asked 无配对 decided → waiting；配对后解除
 * - 待办 / 进行中：pending/in_progress → in_progress；全 completed / 空 → 候选 completed
 * - 规则未命中 → null（走 LLM 兜底）
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { applyRules } from '../src/rules'
import {
  approvalAsked,
  approvalDecided,
  resetSeq,
  todoWrite,
  turnEndAbnormal,
  turnEndCompleted,
  turnStart,
} from './helpers'

describe('applyRules 异常终止规则', () => {
  beforeEach(() => resetSeq())

  it('最后一个 turn/end reason 非 completed → abnormal_end', () => {
    const verdict = applyRules([turnStart(), turnEndAbnormal()])
    expect(verdict).toEqual({ kind: 'hit', tag: 'abnormal_end', reason: 'turn/end reason max-tokens' })
  })

  it('turn/end reason 为 completed → 不判 abnormal_end', () => {
    const verdict = applyRules([turnStart(), turnEndCompleted()])
    expect(verdict).not.toEqual(expect.objectContaining({ tag: 'abnormal_end' }))
  })

  it('异常终止后有新 turn/start 打断 → 不判 abnormal_end（新轮次进行中）', () => {
    const verdict = applyRules([turnStart(1), turnEndAbnormal(1), turnStart(2)])
    expect(verdict).not.toEqual(expect.objectContaining({ tag: 'abnormal_end' }))
  })
})

describe('applyRules 会话等待规则', () => {
  beforeEach(() => resetSeq())

  it('存在未配对 approval/asked → waiting', () => {
    const verdict = applyRules([turnStart(), turnEndCompleted(), approvalAsked('a1')])
    expect(verdict).toEqual({ kind: 'hit', tag: 'waiting', reason: 'unresolved approval request(s)' })
  })

  it('approval/asked 有配对 decided → 等待解除，规则未命中', () => {
    const verdict = applyRules([
      turnStart(),
      turnEndCompleted(),
      approvalAsked('a1'),
      approvalDecided('a1'),
    ])
    expect(verdict).toBeNull()
  })

  it('多个审批中仅未决的算等待', () => {
    const verdict = applyRules([
      turnStart(),
      turnEndCompleted(),
      approvalAsked('a1'),
      approvalDecided('a1'),
      approvalAsked('a2'),
    ])
    expect(verdict).toEqual({ kind: 'hit', tag: 'waiting', reason: 'unresolved approval request(s)' })
  })
})

describe('applyRules 待办 / 进行中规则', () => {
  beforeEach(() => resetSeq())

  it('最新 todo/write 含 pending / in_progress → in_progress', () => {
    const verdict = applyRules([
      turnStart(),
      turnEndCompleted(),
      todoWrite([
        { content: '任务一', status: 'pending' },
        { content: '任务二', status: 'in_progress' },
      ]),
    ])
    expect(verdict).toEqual({
      kind: 'hit',
      tag: 'in_progress',
      reason: 'todo list has pending/in_progress items',
    })
  })

  it('todo 全 completed 且最后轮次已关闭 → 候选 completed', () => {
    const verdict = applyRules([
      turnStart(),
      turnEndCompleted(),
      todoWrite([{ content: '任务一', status: 'completed' }]),
    ])
    expect(verdict).toEqual({ kind: 'candidate', tag: 'completed' })
  })

  it('todo 空列表且最后轮次已关闭 → 候选 completed', () => {
    const verdict = applyRules([turnStart(), turnEndCompleted(), todoWrite([])])
    expect(verdict).toEqual({ kind: 'candidate', tag: 'completed' })
  })

  it('todo 全 completed 但最后轮次未关闭 → in_progress', () => {
    const verdict = applyRules([
      turnStart(),
      todoWrite([{ content: '任务一', status: 'completed' }]),
      turnStart(2),
    ])
    expect(verdict).toEqual({ kind: 'hit', tag: 'in_progress', reason: 'last turn not closed yet' })
  })
})

describe('applyRules 未命中', () => {
  beforeEach(() => resetSeq())

  it('无 todo / 无审批 / 无异常终止 → null（走 LLM 兜底）', () => {
    const verdict = applyRules([turnStart(), turnEndCompleted()])
    expect(verdict).toBeNull()
  })
})
