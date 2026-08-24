/**
 * 标签分析器单元测试（src/tagger.ts）。
 *
 * 覆盖：
 * - extractLastTurn：只取最后一个 turn/start 之后的 text 块，排除文件 / 思考 / 工具 / 分片
 * - parseTagResult：JSON 约束解析 / 正则兜底 / 回退
 * - 计时管理：schedule 重置、到期触发分析、cancel 取消
 * - 手动标签锁定：source 为 user-override 时跳过自动写入
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { CallId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Config } from '../src/config'
import { extractLastTurn, parseTagResult, SessionTagger } from '../src/tagger'
import type { TagId } from '../src/events'
import {
  approvalAsked,
  assistantMessage,
  makeRawEvent,
  resetSeq,
  turnEndCompleted,
  turnStart,
  userMessage,
} from './helpers'

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

/**
 * 构造 mock Context。
 * - effect：追踪 disposer 调用次数
 * - llm.stream：可配的流式分片 / 抛错，模拟 LLM 兜底判定
 * - logger：静默
 */
function createMockCtx(options: { llmStream?: StreamChunk[]; llmThrows?: boolean } = {}): {
  ctx: Context
  disposerCalls: number[]
} {
  const disposerCalls: number[] = []
  const ctx = {
    effect: (fn: () => () => void) => {
      const disposer = fn()
      return () => {
        disposerCalls.push(1)
        disposer()
      }
    },
    logger: () => ({ warn: () => {}, debug: () => {}, info: () => {} }),
    llm: {
      stream: async function* () {
        if (options.llmThrows) throw new Error('provider unavailable')
        for (const chunk of options.llmStream ?? []) yield chunk
      },
    },
  } as unknown as Context
  return { ctx, disposerCalls }
}

/** 构造一个输出指定 JSON 标签的 LLM 流分片序列。 */
function tagStream(tag: string): StreamChunk[] {
  const text = `{"tag": "${tag}"}`
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** 构造触发 waiting 规则命中的会话（含未决审批）。 */
function createWaitingSession(): Session {
  const seed: SessionEvent[] = [turnStart(), turnEndCompleted(), approvalAsked('a1')]
  return Session.create(SessionId('s-waiting'), seed)
}

describe('extractLastTurn 内容提取', () => {
  beforeEach(() => resetSeq())

  it('只取最后一个 turn/start 之后的 text 块，排除文件 / 思考 / 工具 / 分片', () => {
    const events: SessionEvent[] = [
      turnStart(1),
      userMessage([
        { type: 'text', text: '第一轮问题' },
        { type: 'tool-call', id: 'c1' as CallId, name: 'read_file', arguments: '{}' },
      ]),
      assistantMessage([
        { type: 'text', text: '第一轮回答' },
        { type: 'reasoning', text: '第一轮思考不应进入' },
      ]),
      turnStart(2),
      userMessage([
        { type: 'text', text: '第二轮问题' },
        { type: 'tool-call', id: 'c2' as CallId, name: 'edit_file', arguments: '{}' },
      ]),
      assistantMessage([
        { type: 'text', text: '第二轮回答' },
        { type: 'reasoning', text: '第二轮思考不应进入' },
      ]),
      makeRawEvent('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'x', arguments: '{}' }),
      makeRawEvent('tool/result', { turn: 2, step: 1, message: {} }),
      makeRawEvent('assistant/chunk', { turn: 2, step: 1, chunk: {} }),
    ]

    const result = extractLastTurn(events, 50)
    expect(result.messages).toEqual([
      { role: 'user', text: '第二轮问题' },
      { role: 'assistant', text: '第二轮回答' },
    ])
  })

  it('截断到 maxMessages 上限（保留最近 N 条）', () => {
    const events: SessionEvent[] = [
      turnStart(),
      ...Array.from({ length: 10 }, (_, i) => userMessage([{ type: 'text', text: `消息 ${i}` }])),
    ]
    const result = extractLastTurn(events, 3)
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0].text).toBe('消息 7')
  })

  it('无 turn/start 边界时视整段日志为一轮', () => {
    const events: SessionEvent[] = [userMessage([{ type: 'text', text: '孤立消息' }])]
    const result = extractLastTurn(events, 50)
    expect(result.messages).toEqual([{ role: 'user', text: '孤立消息' }])
  })
})

describe('parseTagResult 解析', () => {
  it('解析约束 JSON 输出', () => {
    expect(parseTagResult('{"tag": "completed"}')).toBe('completed')
  })

  it('解析带代码围栏的 JSON', () => {
    expect(parseTagResult('```json\n{"tag":"invalid"}\n```')).toBe('invalid')
  })

  it('正则兜底：直接输出枚举值', () => {
    expect(parseTagResult('completed')).toBe('completed')
  })

  it('无法解析时回退 in_progress', () => {
    expect(parseTagResult('也许任务还没做完')).toBe('in_progress')
  })

  it('非预期枚举回退 in_progress', () => {
    expect(parseTagResult('{"tag":"bogus"}')).toBe('in_progress')
  })
})

describe('SessionTagger 计时管理', () => {
  beforeEach(() => {
    resetSeq()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('schedule 对同一会话重置旧计时器', () => {
    const { ctx, disposerCalls } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = createWaitingSession()

    tagger.schedule(session, 60_000)
    tagger.schedule(session, 60_000)

    // 第二次 schedule 取消了第一个计时器
    expect(disposerCalls).toHaveLength(1)

    vi.advanceTimersByTime(60_000)
    // 新计时器触发 analyze → waiting 规则命中 → 仅写入一条标签事件
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.tag).toBe('waiting')
    expect(tags[0].data.source).toBe('rule')
  })

  it('计时器到期触发分析并写入标签事件', () => {
    const { ctx } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = createWaitingSession()

    tagger.schedule(session, 60_000)
    vi.advanceTimersByTime(59_999)
    expect(session.events.filter((event) => event.type === 'session-tag/assigned')).toHaveLength(0)

    vi.advanceTimersByTime(1)
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.tag).toBe('waiting')
  })

  it('cancel 取消挂起计时器，不再触发分析', () => {
    const { ctx, disposerCalls } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = createWaitingSession()

    tagger.schedule(session, 60_000)
    tagger.cancel(session.id)
    expect(disposerCalls).toHaveLength(1)

    vi.advanceTimersByTime(60_000)
    expect(session.events.filter((event) => event.type === 'session-tag/assigned')).toHaveLength(0)
  })
})

describe('SessionTagger 即时打标', () => {
  beforeEach(() => resetSeq())

  it('markImmediately 立即写入标签事件（source=rule）', () => {
    const { ctx } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = Session.create(SessionId('s-mark'))

    tagger.markImmediately(session, 'abnormal_end', 'turn/end reason error')
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.tag).toBe('abnormal_end')
    expect(tags[0].data.source).toBe('rule')
    expect(tags[0].data.reason).toBe('turn/end reason error')
  })
})

describe('SessionTagger 手动标签锁定', () => {
  beforeEach(() => {
    resetSeq()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('最近标签 source 为 user-override 时跳过自动写入', () => {
    const { ctx } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = createWaitingSession()

    // 先手动覆盖为 invalid（source: user-override）
    session.append('session-tag/assigned', {
      tagId: 'tag-manual' as TagId,
      tag: 'invalid',
      source: 'user-override',
      reason: 'web ui manual',
      assignedAt: Date.now(),
    })

    tagger.schedule(session, 60_000)
    vi.advanceTimersByTime(60_000)

    // 自动分析被跳过：只有手动那一条标签事件
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.source).toBe('user-override')
    expect(tags[0].data.tag).toBe('invalid')
  })

  it('markImmediately 遇到 user-override 时跳过（异常终止不覆盖手动标签）', () => {
    const { ctx } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = Session.create(SessionId('s-lock-immediate'))

    // 先手动覆盖为 invalid
    session.append('session-tag/assigned', {
      tagId: 'tag-manual' as TagId,
      tag: 'invalid',
      source: 'user-override',
      reason: 'web ui manual',
      assignedAt: Date.now(),
    })

    tagger.markImmediately(session, 'abnormal_end', 'turn/end reason error')

    // 异常终止即时打标被跳过：仅手动那一条
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.source).toBe('user-override')
    expect(tags[0].data.tag).toBe('invalid')
  })

  it('turn/start 的 in_progress 重置豁免锁定（ignoreLock）', () => {
    const { ctx } = createMockCtx()
    const tagger = new SessionTagger(ctx, baseConfig)
    const session = Session.create(SessionId('s-lock-ignore'))

    // 先手动覆盖为 invalid
    session.append('session-tag/assigned', {
      tagId: 'tag-manual' as TagId,
      tag: 'invalid',
      source: 'user-override',
      reason: 'web ui manual',
      assignedAt: Date.now(),
    })

    tagger.markImmediately(session, 'in_progress', 'new turn started', { ignoreLock: true })

    // 新轮次重置豁免锁定：手动 + in_progress 两条
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(2)
    expect(tags[1].data.tag).toBe('in_progress')
    expect(tags[1].data.source).toBe('rule')
  })
})

describe('SessionTagger LLM 兜底', () => {
  beforeEach(() => {
    resetSeq()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('规则未命中时经 ctx.llm.stream 判定并写入标签事件（source=llm）', async () => {
    const { ctx } = createMockCtx({ llmStream: tagStream('completed') })
    const tagger = new SessionTagger(ctx, baseConfig)

    // 会话：正常轮次 + user 文本，无 todo / 无审批 → 规则未命中走 LLM 兜底
    const session = Session.create(SessionId('s-llm'), [
      turnStart(),
      turnEndCompleted(),
      userMessage([{ type: 'text', text: '帮我总结一下今天的工作' }]),
    ])

    tagger.schedule(session, 60_000)
    await vi.advanceTimersByTimeAsync(60_000)

    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.tag).toBe('completed')
    expect(tags[0].data.source).toBe('llm')
  })

  it('LLM 流抛异常时回退 in_progress', async () => {
    const { ctx } = createMockCtx({ llmThrows: true })
    const tagger = new SessionTagger(ctx, baseConfig)

    const session = Session.create(SessionId('s-llm-fail'), [
      turnStart(),
      turnEndCompleted(),
      userMessage([{ type: 'text', text: '帮我总结一下' }]),
    ])

    tagger.schedule(session, 60_000)
    await vi.advanceTimersByTimeAsync(60_000)

    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(1)
    expect(tags[0].data.tag).toBe('in_progress')
    expect(tags[0].data.source).toBe('llm')
  })

  it('LLM 异步挂起期间新轮次到达（日志推进）放弃写入，不覆盖最新状态', async () => {
    // 可控 LLM 流：pending 未决时 analyze 挂起在 await 处，模拟慢速 LLM 调用
    let release!: (chunks: StreamChunk[]) => void
    const pending = new Promise<StreamChunk[]>((resolve) => {
      release = resolve
    })
    const ctx = {
      effect: (fn: () => () => void) => {
        const disposer = fn()
        return () => disposer()
      },
      logger: () => ({ warn: () => {}, debug: () => {}, info: () => {} }),
      llm: {
        stream: async function* () {
          const chunks = await pending
          for (const chunk of chunks) yield chunk
        },
      },
    } as unknown as Context
    const tagger = new SessionTagger(ctx, baseConfig)

    const session = Session.create(SessionId('s-race'), [
      turnStart(),
      turnEndCompleted(),
      userMessage([{ type: 'text', text: '帮我总结一下' }]),
    ])

    tagger.schedule(session, 60_000)
    // 触发计时器：analyze 运行至 await LLM 流处挂起（异步竞态窗口开启）
    await vi.advanceTimersByTimeAsync(60_000)
    // 竞态窗口内新轮次到达 → session.seq 推进
    session.append('turn/start', { turn: 2 })
    // 放行 LLM 流，让挂起的 analyze 完成
    release(tagStream('completed'))
    await vi.advanceTimersByTimeAsync(0)

    // 竞态防护：LLM 返回后日志已推进，本次分析结果过时 → 放弃写入，无标签事件
    const tags = session.events.filter((event) => event.type === 'session-tag/assigned')
    expect(tags).toHaveLength(0)
  })
})
