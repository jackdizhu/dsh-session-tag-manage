import { describe, it, expect } from 'vitest'
import {
  splitTurns,
  classifyRoundEndReason,
  extractAssistantMessages,
  extractAssistantThinking,
  summarizeToolInput,
  extractContentText,
} from '../src/utils/session-history.js'
import type { SessionHistoryEvent, ContentBlock } from '../src/utils/session-history.js'

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

describe('extractAssistantMessages', () => {
  it('抽取 assistant/message（嵌套 message.content）的 text 块', () => {
    const events = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '已创建文件' }], id: 'm1' },
      }),
      ev(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(extractAssistantMessages(events)).toEqual(['已创建文件'])
  })

  it('多个 assistant/message 且无 tool/call → 仅最后一条（最终回答）被抽取', () => {
    const events = [
      ev(0, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '第一段' }], id: 'a' } }),
      ev(1, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '第二段' }], id: 'b' } }),
    ]
    // 无 tool/call 时，最后一条视为最终回答；其余 text 归入思考过程
    expect(extractAssistantMessages(events)).toEqual(['第二段'])
  })

  it('多步轮次（text 后跟 tool/call）→ 仅最后无 tool/call 的 text 为最终回答', () => {
    const events = [
      ev(0, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '让我先读文件' }], id: 'a' } }),
      ev(1, 'tool/call', { name: 'read_file', input: { path: 'b.ts' }, callId: 'c1' }),
      ev(2, 'tool/result', { name: 'read_file', callId: 'c1', result: 'ok' }),
      ev(3, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '最终结论' }], id: 'b' } }),
    ]
    expect(extractAssistantMessages(events)).toEqual(['最终结论'])
  })

  it('一轮以 tool/call 结束（无收尾回答）→ 最终回答为空，过程独白与调用工具归入思考', () => {
    const events = [
      ev(0, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '让我执行命令' }], id: 'a' } }),
      ev(1, 'tool/call', { name: 'pwsh', input: { command: 'ls' }, callId: 'c1' }),
    ]
    expect(extractAssistantMessages(events)).toEqual([])
    expect(extractAssistantThinking(events)).toEqual(['让我执行命令', '调用工具 pwsh（{"command":"ls"}）'])
  })

  it('段内多个 text 块以 \\n 连接为一条', () => {
    const events = [
      ev(0, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '前半句' },
            { type: 'text', text: '后半句' },
          ],
          id: 'm1',
        },
      }),
    ]
    expect(extractAssistantMessages(events)).toEqual(['前半句\n后半句'])
  })

  it('reasoning 块被排除，仅保留 text 正文（真实嵌套结构）', () => {
    const events = [
      ev(0, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '用户在打招呼' },
            { type: 'text', text: '你好！我能帮助你' },
          ],
          id: 'm1',
        },
      }),
    ]
    expect(extractAssistantMessages(events)).toEqual(['你好！我能帮助你'])
  })

  it('忽略非 assistant/message 事件', () => {
    const events = [ev(0, 'user/message', { content: [{ type: 'text', text: '你好' }] })]
    expect(extractAssistantMessages(events)).toEqual([])
  })

  it('兼容旧结构（data.content 直接）回退', () => {
    const events = [ev(0, 'assistant/message', { content: [{ type: 'text', text: '旧结构文本' }] })]
    expect(extractAssistantMessages(events)).toEqual(['旧结构文本'])
  })
})

describe('extractContentText（通用内容块抽取）', () => {
  const blocks: ContentBlock[] = [
    { type: 'text', text: '正文一' },
    { type: 'reasoning', text: '思考过程' },
    { type: 'text', text: '正文二' },
  ]

  it('include:["text"] 仅保留 text，排除 reasoning', () => {
    expect(extractContentText(blocks, { include: ['text'] })).toBe('正文一\n正文二')
  })

  it('默认排除 reasoning（未指定 include/exclude）', () => {
    expect(extractContentText(blocks)).toBe('正文一\n正文二')
  })

  it('include:["reasoning"] 仅保留 reasoning', () => {
    expect(extractContentText(blocks, { include: ['reasoning'] })).toBe('思考过程')
  })

  it('显式 exclude 覆盖默认（排除 text 仅留 reasoning）', () => {
    expect(extractContentText(blocks, { exclude: ['text'] })).toBe('思考过程')
  })

  it('空数组 / undefined 返回空串不抛错', () => {
    expect(extractContentText([])).toBe('')
    expect(extractContentText(undefined)).toBe('')
  })

  it('多个命中块以 \\n 连接', () => {
    const multi: ContentBlock[] = [
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
    ]
    expect(extractContentText(multi, { include: ['text'] })).toBe('A\nB')
  })
})

describe('extractAssistantThinking（思考过程抽取）', () => {
  it('抽取 assistant/message 的 reasoning 块，且不含 text 正文', () => {
    const events = [
      ev(0, 'turn/start', { turn: 1 }),
      ev(1, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '用户在打招呼' },
            { type: 'text', text: '你好！我能帮助你' },
          ],
          id: 'm1',
        },
      }),
      ev(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    // 思考过程仅含 reasoning 文本；正文由 assistantMessageTexts 承载（双轨）
    expect(extractAssistantThinking(events)).toEqual(['用户在打招呼'])
  })

  it('tool/call 事件生成为「调用工具 name（input摘要）」片段', () => {
    const events = [
      ev(0, 'tool/call', { name: 'write_file', input: { file_path: 'a.ts' }, callId: 'c1' }),
    ]
    expect(extractAssistantThinking(events)).toEqual(['调用工具 write_file（{"file_path":"a.ts"}）'])
  })

  it('reasoning 与 tool/call 按事件顺序合并为完整思考过程', () => {
    const events = [
      ev(0, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '需要读文件' },
            { type: 'text', text: '已读取' },
          ],
          id: 'm1',
        },
      }),
      ev(1, 'tool/call', { name: 'read_file', input: { path: 'b.ts' }, callId: 'c2' }),
      ev(2, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [{ type: 'reasoning', text: '文件为空，结束' }],
          id: 'm2',
        },
      }),
    ]
    expect(extractAssistantThinking(events)).toEqual([
      '需要读文件',
      '已读取',
      '调用工具 read_file（{"path":"b.ts"}）',
      '文件为空，结束',
    ])
  })

  it('纯 text 无 reasoning 且无 tool/call → 空数组', () => {
    const events = [
      ev(0, 'assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: '直接回答' }], id: 'm1' },
      }),
    ]
    expect(extractAssistantThinking(events)).toEqual([])
  })

  it('忽略非思考相关事件（user/message / tool/result）', () => {
    const events = [
      ev(0, 'user/message', { content: [{ type: 'text', text: '你好' }] }),
      ev(1, 'tool/result', { name: 'read_file', callId: 'c1', result: 'ok' }),
    ]
    expect(extractAssistantThinking(events)).toEqual([])
  })

  it('兼容旧结构（data.content 直接）的 reasoning 块', () => {
    const events = [
      ev(0, 'assistant/message', { content: [{ type: 'reasoning', text: '旧结构思考' }] }),
    ]
    expect(extractAssistantThinking(events)).toEqual(['旧结构思考'])
  })

  it('过程独白 text（紧跟 tool/call 前）归入思考过程，不进最终回答', () => {
    const events = [
      ev(0, 'assistant/message', {
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '测试通过了，下面做端到端验证' },
            { type: 'text', text: 'Now let me verify the composition boot-free, then do an end-to-end test:' },
          ],
          id: 'm1',
        },
      }),
      ev(1, 'tool/call', { name: 'pwsh', input: { command: 'dsh --help' }, callId: 'c1' }),
      ev(2, 'tool/result', { name: 'pwsh', callId: 'c1', result: 'ok' }),
      ev(3, 'assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: '验证完成，已就绪' }], id: 'm2' },
      }),
    ]
    // 思考过程：reasoning + 过程独白 + 调用工具；最终回答不混入
    expect(extractAssistantThinking(events)).toEqual([
      '测试通过了，下面做端到端验证',
      'Now let me verify the composition boot-free, then do an end-to-end test:',
      '调用工具 pwsh（{"command":"dsh --help"}）',
    ])
    // 最终回答独立成段
    expect(extractAssistantMessages(events)).toEqual(['验证完成，已就绪'])
  })
})

describe('summarizeToolInput（工具输入摘要）', () => {
  it('对象输入序列化为紧凑 JSON', () => {
    expect(summarizeToolInput({ file_path: 'a.ts', mode: 'write' })).toBe('{"file_path":"a.ts","mode":"write"}')
  })

  it('input 为 undefined / 非对象 → 空串', () => {
    expect(summarizeToolInput(undefined)).toBe('')
    expect(summarizeToolInput('plain' as unknown as Record<string, unknown>)).toBe('')
  })

  it('超长输入按 maxLen 截断并加省略号', () => {
    const long = { code: 'x'.repeat(500) }
    const out = summarizeToolInput(long, 20)
    expect(out.length).toBe(21)
    expect(out.endsWith('…')).toBe(true)
  })
})
