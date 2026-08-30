/**
 * 宿主端插件入口：dsh-skills-auto-enable
 *
 * 在**不修改任何 @deepseek-ai/* 框架代码**的前提下，于会话生命周期中动态控制技能
 * 在模型上下文中的可见性，并把会话中存在的全部 SKILL 与执行过程实际调用的 SKILL
 * 增量记录到 dsh-skills-auto-enable-config.json，用于持续"加/移除上下文 SKILL"以节省 token。
 *
 * 扩展点：
 * - agent/session-start：会话发起，注册全局层 shadow（隐藏禁用技能）+ 写基线 skills
 * - agent/pre-step：每轮观测实际调用的 SKILL（usage）+ 可选运行时关键字豁免 + 落盘
 * - agent/disposed：会话销毁，撤销本会话的 shadow disposers 并落盘
 *
 * 会话身份：agent.session.id（与宿主会话包 session.history 的 sessionId 同源）。
 *
 * @module dsh-skills-auto-enable
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
import { ConfigStore, type AutoEnableConfig } from './config.js'
import {
  computeEffectiveDisabled,
  matchKeywordRules,
  applyShadows,
  reconcileShadows,
  keywordFor,
} from './visibility.js'
import { upsertSkill, recordUsage, flush } from './records.js'

export const name = 'dsh-skills-auto-enable'
export const inject = ['agents', 'skills']

/** 单会话运行状态 */
interface SessionState {
  disposers: Map<string, () => void>
  matchedPrefixes: Set<string>
  matchedKeywords: Set<string>
  used: Set<string>
}

/** agent/pre-step 载荷（框架以字符串键事件下发，此处结构化以便类型安全） */
interface PreStepPayload {
  agent: Agent
  messages: AgentMessage[]
  signal: unknown
}
type NextFn = () => Promise<PreStepDecision>
interface SessionStartPayload {
  agent: Agent
}
interface AgentMessage {
  role?: string
  source?: { kind?: string }
  content?: { type: string; text: string }[]
}

/** 单条用户消息内容块 */
interface ContentBlock {
  type: string
  text: string
}

/** 从 events 抽取用户真实提问文本（source.kind==='user'） */
function userTextFromEvents(events: SessionEvent[]): string {
  const parts: string[] = []
  for (const ev of events) {
    if (ev.type === 'user/message' && ev.data?.source?.kind === 'user') {
      const content = ev.data.content as ContentBlock[] | undefined
      for (const b of content ?? []) if (b.type === 'text') parts.push(b.text)
    }
  }
  return parts.join('\n')
}

/** 从 pre-step 的 messages 抽取用户文本（用于运行时关键字扫描） */
function userTextFromMessages(messages: AgentMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    const isUser = m.role === 'user' || m.source?.kind === 'user'
    if (!isUser) continue
    for (const b of m.content ?? []) if (b.type === 'text') parts.push(b.text)
  }
  return parts.join('\n')
}

/** 从事件抽取"实际被调用的技能名"（tool/call(name=skill, args.name) 或 skill-invocation） */
function skillNameFromEvent(ev: SessionEvent): string | undefined {
  if (ev.type === 'tool/call' && ev.data?.name === 'skill') {
    const args = ev.data.args as { name?: string } | undefined
    return args?.name
  }
  if (ev.type === 'user/message' && ev.data?.source?.kind === 'skill-invocation') {
    return ev.data.source.name as string | undefined
  }
  return undefined
}

/** 插件应用函数 */
export function apply(ctx: Context): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = resolve(here, '..', 'dsh-skills-auto-enable-config.json')
  const store = new ConfigStore(file)
  // fs.watch 热更新：文件变更后下一轮 pre-step 重新计算有效禁用集（reconcile）
  store.watch(() => {})

  const sessions = new Map<string, SessionState>()

  const lookupFor = (agent: Agent): SkillViewOptions => ({
    cwd: agent.session.header.cwd,
    scope: agent,
  })

  /** 会话发起：注册 shadow + 写基线 skills（幂等） */
  const initSession = async (agent: Agent): Promise<void> => {
    const sid = agent.session.id
    if (sessions.has(sid)) return
    const cfg = store.get()
    const text = userTextFromEvents(agent.session.events)
    const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)
    const effective = computeEffectiveDisabled(cfg.rules.disabledSkills, cfg.rules.keywordRules, prefixes)

    // 用插件自身 ctx（已 inject skills，与框架同一 registry 实例）读取/注册。
    // 注：register 落到全局层（scopeOf(pluginCtx)=undefined，rank 250 < 600 胜出），
    // 对"个人禁用清单"语义正确（持久配置跨会话于 session-start 重注册即可）；
    // 顺序单用户使用下关键字自动加载亦正确。并发多会话共享全局影子为已知边界。
    const disposers = await applyShadows(ctx, effective, lookupFor(agent))

    // 基线 skills：非禁用 → add；禁用 → remove 流水（反映"已从上下文移除"）
    const all = await ctx.skills.list(lookupFor(agent))
    for (const s of all) {
      const disabled = effective.includes(s.name)
      const kw = disabled
        ? ''
        : keywordFor(s.name, cfg.rules.keywordRules, prefixes, keywords)
      upsertSkill(cfg, { name: s.name, keyword: kw, overview: s.description }, disabled ? 'remove' : 'add')
    }

    sessions.set(sid, {
      disposers,
      matchedPrefixes: prefixes,
      matchedKeywords: keywords,
      used: new Set(),
    })
    flush(file, cfg)
  }

  /** 每轮：观测 usage + 运行时关键字豁免 + 落盘 */
  const stepSession = async (agent: Agent, messages: AgentMessage[]): Promise<void> => {
    const sid = agent.session.id
    let state = sessions.get(sid)
    if (!state) {
      // 兜底：若 session-start 未被等待，首轮 pre-step 内完成初始化
      await initSession(agent)
      state = sessions.get(sid)
      if (!state) return
    }
    const cfg = store.get()
    const text = userTextFromMessages(messages)
    const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)

    // 先算出"本轮回新命中的前缀"（在并入 state.matchedPrefixes 之前判断），
    // 否则会被上面的 for 循环并入后使 `prefixes.size > state.matchedPrefixes.size` 恒为 false。
    const newPrefixes = [...prefixes].filter((p) => !state.matchedPrefixes.has(p))
    for (const p of prefixes) state.matchedPrefixes.add(p)
    for (const k of keywords) state.matchedKeywords.add(k)

    let changed = false
    // 运行时新命中关键字前缀 → 重新计算有效禁用集、撤销对应 shadow，并将前缀技能增量加回 skills
    if (newPrefixes.length > 0) {
      const effective = computeEffectiveDisabled(cfg.rules.disabledSkills, cfg.rules.keywordRules, state.matchedPrefixes)
      await reconcileShadows(ctx, state.disposers, effective, lookupFor(agent))
      const all = await ctx.skills.list(lookupFor(agent))
      for (const s of all) {
        const rule = cfg.rules.keywordRules.find((r) => s.name.startsWith(r.skillPrefix))
        if (rule && state.matchedPrefixes.has(rule.skillPrefix)) {
          const kw = keywordFor(s.name, cfg.rules.keywordRules, state.matchedPrefixes, state.matchedKeywords)
          upsertSkill(cfg, { name: s.name, keyword: kw, overview: s.description }, 'add')
        }
      }
      changed = true
    }

    // 观测实际调用：tool/call(name=skill) 或 skill-invocation
    for (const ev of agent.session.events) {
      const name = skillNameFromEvent(ev)
      if (name && !state.used.has(name)) {
        state.used.add(name)
        recordUsage(cfg, name)
        changed = true
      }
    }

    if (changed) flush(file, cfg)
  }

  /** 会话销毁：撤销 shadow + 落盘 */
  const cleanupSession = (agent?: { session?: { id?: string } }): void => {
    const sid = agent?.session?.id
    if (!sid) return
    const state = sessions.get(sid)
    if (!state) return
    for (const d of state.disposers.values()) d()
    sessions.delete(sid)
    flush(file, store.get())
  }

  ctx.on('agent/session-start', (payload: SessionStartPayload) => {
    void initSession(payload.agent)
  })

  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: NextFn) => {
    const decision = await next()
    if (decision && decision.kind === 'reject') return decision
    await stepSession(payload.agent, payload.messages)
    return decision
  })

  ctx.on('agent/disposed', (agent?: { session?: { id?: string } }) => {
    cleanupSession(agent)
  })
}
