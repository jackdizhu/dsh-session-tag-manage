import { describe, it, expect } from 'vitest'
import { filterSkillCatalog } from '../src/catalog.js'

/** 构造一条含 <available_skills> 目录的消息（冻结，模拟真实不可变性） */
function catalogMessage(names: string[], freeze = true): { role: string; content: { type: string; text: string }[] } {
  const entries = names.map((n) => `- \`${n}\`: 描述-${n}`).join('\n')
  const msg = {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `<system-reminder>\nA skill is a reusable set of task-specific instructions.\n\n<available_skills>\n${entries}\n</available_skills>\n</system-reminder>`,
      },
    ],
  }
  return freeze ? Object.freeze({ ...msg, content: Object.freeze(msg.content.map((b) => Object.freeze(b))) }) : msg
}

function entriesOf(options: { messages?: unknown }): string[] {
  const out: string[] = []
  for (const m of (options.messages ?? []) as { content?: { type: string; text: string }[] }[]) {
    for (const b of m.content ?? []) {
      for (const line of b.text.split('\n')) {
        const mt = /^- `([^`]+)`:/.exec(line)
        if (mt) out.push(mt[1])
      }
    }
  }
  return out
}

describe('catalog filter (immutable payload)', () => {
  it('删除被隐藏的技能条目', () => {
    const opt = { messages: [catalogMessage(['lark-approval', 'lark-apps', 'other-skill'])] }
    const removed = filterSkillCatalog(opt, ['lark-approval'])
    expect(removed).toBe(1)
    expect(entriesOf(opt)).toEqual(['lark-apps', 'other-skill'])
  })

  it('目录被全部隐藏时丢弃该消息', () => {
    const opt = { messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }, catalogMessage(['lark-approval', 'lark-apps'])] }
    const removed = filterSkillCatalog(opt, ['lark-approval', 'lark-apps'])
    expect(removed).toBe(2)
    expect((opt.messages as unknown[]).length).toBe(1)
    expect(entriesOf(opt)).toEqual([])
  })

  it('对冻结的对象也能过滤（不抛异常）', () => {
    const opt = { messages: Object.seal([catalogMessage(['lark-approval', 'keep-me'])]) }
    expect(() => filterSkillCatalog(opt, ['lark-approval'])).not.toThrow()
    expect(entriesOf(opt)).toEqual(['keep-me'])
  })

  it('无隐藏技能或无目录块时不改动', () => {
    const opt = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
    expect(filterSkillCatalog(opt, ['lark-approval'])).toBe(0)
    expect(filterSkillCatalog(opt, [])).toBe(0)
    expect((opt.messages as unknown[]).length).toBe(1)
  })

  it('只处理目录块，不影响其他消息', () => {
    const opt = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: '你好' }] },
        catalogMessage(['lark-approval', 'keep-me']),
      ],
    }
    filterSkillCatalog(opt, ['lark-approval'])
    const first = (opt.messages as { content: { text: string }[] }[])[0]
    expect(first.content[0].text).toBe('你好')
    expect(entriesOf(opt)).toEqual(['keep-me'])
  })
})
