import { describe, it, expect, vi } from 'vitest'
import {
  computeEffectiveDisabled,
  matchKeywordRules,
  keywordFor,
  applyShadows,
} from '../src/visibility.js'

describe('visibility', () => {
  it('computeEffectiveDisabled 应豁免命中前缀', () => {
    const r = [{ keywords: ['飞书', 'feishu'], skillPrefix: 'lark-' }]
    expect(computeEffectiveDisabled(['lark-calendar'], r, new Set(['lark-']))).toEqual([])
  })

  it('computeEffectiveDisabled 未命中维持禁用', () => {
    const r = [{ keywords: ['feishu'], skillPrefix: 'lark-' }]
    expect(computeEffectiveDisabled(['lark-calendar'], r, new Set())).toEqual(['lark-calendar'])
  })

  it('matchKeywordRules 应命中 feishu（大小写不敏感）', () => {
    const res = matchKeywordRules('请使用 Feishu 处理', [{ keywords: ['feishu'], skillPrefix: 'lark-' }])
    expect(res.prefixes).toEqual(new Set(['lark-']))
    expect(res.keywords).toEqual(new Set(['feishu']))
  })

  it('matchKeywordRules 未命中返回空集', () => {
    const res = matchKeywordRules('hello world', [{ keywords: ['feishu'], skillPrefix: 'lark-' }])
    expect(res.prefixes.size).toBe(0)
    expect(res.keywords.size).toBe(0)
  })

  it('keywordFor 返回命中关键字字面量', () => {
    const r = [{ keywords: ['飞书', 'feishu'], skillPrefix: 'lark-' }]
    expect(keywordFor('lark-calendar', r, new Set(['lark-']), new Set(['feishu']))).toBe('feishu')
  })

  it('applyShadows 为禁用技能注册 modelInvocable:false 的 shadow', async () => {
    const register = vi.fn(() => () => {})
    const scopeCtx = {
      skills: { list: vi.fn(async () => [{ name: 'lark-calendar', description: 'cal' }]), register },
    } as unknown as import('@deepseek-ai/cordis').Context
    const disposers = await applyShadows(scopeCtx, ['lark-calendar'], { cwd: '/x', scope: {} })
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'lark-calendar',
        invocation: { modelInvocable: false, userInvocable: true },
      }),
    )
    expect(disposers.get('lark-calendar')).toBeTypeOf('function')
  })

  it('applyShadows 跳过不存在的技能', async () => {
    const register = vi.fn(() => () => {})
    const scopeCtx = {
      skills: { list: vi.fn(async () => []), register },
    } as unknown as import('@deepseek-ai/cordis').Context
    const disposers = await applyShadows(scopeCtx, ['nope'], { cwd: '/x', scope: {} })
    expect(register).not.toHaveBeenCalled()
    expect(disposers.size).toBe(0)
  })
})
