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
// 落盘统一走 store.flush()（会记录"自己写出的内容"，供 watch 回调跳过自身写入），
// 不再直接调用 records.flush，避免 watch→reload 丢弃本轮内存变更。
import { upsertSkill, recordUsage } from './records.js'
import { filterSkillCatalog } from './catalog.js'
import { installDebugMode } from './debug.js'

export const name = 'dsh-skills-auto-enable'
// 仅注入宿主根插件可直达的服务：agents / skills。
// llm/stream 与 storage 不可在宿主根插件 inject（同 agent.ctx.skills 限制，二者均在嵌套
// ctx 上提供）；但 llm/stream 事件会冒泡到宿主根，故以 ctx.on 监听拦截；storage 则通过
// 受 try/catch 保护的 ctx.storage 访问走 KV 单元，不可达时回退 os.tmpdir 临时文件。
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
  /**
   * 正在初始化中的会话（sessionId → promise）。
   *
   * 必须防并发：框架 `register` 对同名词条是 **first-wins**，重复注册会被忽略并返回
   * **no-op disposer**，导致后续 dispose 撤销不掉第一次的注册（表现为"隐藏后恢复不了"）。
   * 用 promise 去重可保证同一会话只初始化一次，disposers 始终有效。
   */
  const initializing = new Map<string, Promise<void>>()

  /** hidden 登记表保留的最大会话数（按 at 时间裁剪最旧的，避免无界增长） */
  const MAX_HIDDEN_SESSIONS = 50

  /** 按 sessionId 登记当前被隐藏的技能名（落盘审计，并避免重复注册） */
  const recordHidden = (sid: string, names: string[]): void => {
    const cfg = store.get()
    if (names.length === 0) delete cfg.hidden[sid]
    else cfg.hidden[sid] = { skills: [...names], at: new Date().toISOString() }
    // headless/CLI 不一定触发 agent/disposed，陈旧会话记录需按容量裁剪
    const ids = Object.keys(cfg.hidden)
    if (ids.length > MAX_HIDDEN_SESSIONS) {
      ids
        .sort((a, b) => (cfg.hidden[a].at < cfg.hidden[b].at ? -1 : 1))
        .slice(0, ids.length - MAX_HIDDEN_SESSIONS)
        .forEach((id) => delete cfg.hidden[id])
    }
  }

  // 载荷级目录过滤（**best-effort**）：必须早于 installDebugMode 注册，使其成为最外层监听者。
  //
  // 兜底原因：shadow 落在全局层，而 web 场景的技能可能注册在更近的 agent 作用域层、
  // 或以 runtime 条目先于本插件注册（first-wins），都会让全局 shadow 失效。
  // ⚠️ 实测 `options` 是**深度不可变的**（options 不可写 / messages 被密封 / 文本块被冻结），
  // 故本过滤**当前无法生效**（filterSkillCatalog 会返回 0）。保留它是因为：
  // 一旦框架放宽不可变性，此路径即可立即兜底；且失败时零副作用、不影响会话。
  ctx.on('llm/stream', async function* (options: unknown, next: () => AsyncIterable<unknown>) {
    const src = (options ?? {}) as { sessionId?: unknown; messages?: unknown }
    const sid = typeof src.sessionId === 'string' ? src.sessionId : undefined
    const state = sid ? sessions.get(sid) : undefined
    const hidden = state
      ? [...state.disposers.keys()]
      : sid
        ? (store.get().hidden?.[sid]?.skills ?? [])
        : []
    if (hidden.length > 0) filterSkillCatalog(options, hidden)
    yield* next()
  })

  // 调试模式：拦截真实 LLM 调用，将请求参数写入 storageDomain（默认开启）
  installDebugMode(ctx, store)

  const lookupFor = (agent: Agent): SkillViewOptions => ({
    cwd: agent.session.header.cwd,
    scope: agent,
  })

  /**
   * 会话发起：注册 shadow + 写基线 skills（幂等，且防并发重复初始化）
   *
   * @param firstText 首轮用户文本（可选）。`agent.session.events` 在 session-start 时通常
   *   尚无首条用户消息，据此判定会把本应可见的技能误隐藏；故由 pre-step 调用方把首轮真实
   *   用户文本传入，一次性判定正确。
   */
  const initSession = async (agent: Agent, firstText?: string): Promise<void> => {
    const sid = agent.session.id
    if (sessions.has(sid)) return
    const pending = initializing.get(sid)
    if (pending) return pending // 防并发：重复初始化会拿到 no-op disposer
    const task = (async (): Promise<void> => {
      await initSessionOnce(agent, firstText)
    })()
      .finally(() => {
        initializing.delete(sid)
      })
    initializing.set(sid, task)
    return task
  }

  /** initSession 的实际实现（由防并发包装调用，不应直接调用） */
  const initSessionOnce = async (agent: Agent, firstText?: string): Promise<void> => {
    const sid = agent.session.id
    if (sessions.has(sid)) return
    const cfg = store.get()
    // 先列出当前会话已注册的全部技能（用于把"关键字规则前缀族"默认纳入禁用集）
    const all = await ctx.skills.list(lookupFor(agent))
    const text = firstText ?? userTextFromEvents(agent.session.events)
    const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)
    // 有效禁用集 = disabledSkills ∪（命中规则前缀的全部已注册技能），再去掉关键字命中的前缀。
    // 由此 lark-* 等前缀族默认隐藏，仅当用户消息含 飞书/feishu/lark 时才经 reconcile 加回。
    const effective = computeEffectiveDisabled(
      cfg.rules.disabledSkills,
      cfg.rules.keywordRules,
      prefixes,
      all.map((s) => s.name),
    )

    // 用插件自身 ctx（已 inject skills，与框架同一 registry 实例）读取/注册。
    // 注：register 落到全局层（scopeOf(pluginCtx)=undefined，rank 250 < 600 胜出），
    // 对"个人禁用清单"语义正确（持久配置跨会话于 session-start 重注册即可）；
    // 顺序单用户使用下关键字自动加载亦正确。并发多会话共享全局影子为已知边界。
    const disposers = await applyShadows(ctx, effective, lookupFor(agent))
    // 按 sessionId 登记"当前隐藏了哪些技能"，供后续命中关键字时精确恢复
    recordHidden(sid, [...disposers.keys()])

    // 基线 skills：非禁用 → add；禁用 → remove 流水（反映"已从上下文移除"）
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
    store.flush()
  }

  /**
   * 每轮 next() **之前**执行：确保初始化 + 关键字命中后撤销对应 shadow。
   *
   * 必须在 next() 之前：技能目录（`<system-reminder><available_skills>`，位于 messages 内）
   * 由框架在 next() 内部生成；若等到 next() 之后才注册/撤销 shadow，本轮目录已经定稿，
   * 禁用技能仍会出现在上下文里（首轮尤其明显）。
   */
  const reconcileForTurn = async (agent: Agent, messages: AgentMessage[]): Promise<void> => {
    const sid = agent.session.id
    let state = sessions.get(sid)
    if (!state) {
      // 兜底：若 session-start 未被等待，首轮 pre-step 内完成初始化。
      // 传入本轮用户文本，使首轮即可一次性判定正确（避免注册后再 dispose 的不可逆churn）。
      await initSession(agent, userTextFromMessages(messages))
      state = sessions.get(sid)
      if (!state) return
    }
    const cfg = store.get()
    const text = userTextFromMessages(messages)
    const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)

    // 先算出"本轮回新命中的前缀"（在并入 state.matchedPrefixes 之前判断），
    // 否则会被下面的 for 循环并入后使 `prefixes.size > state.matchedPrefixes.size` 恒为 false。
    const newPrefixes = [...prefixes].filter((p) => !state.matchedPrefixes.has(p))
    for (const p of prefixes) state.matchedPrefixes.add(p)
    for (const k of keywords) state.matchedKeywords.add(k)

    // 运行时新命中关键字前缀 → 重新计算有效禁用集、撤销对应 shadow，并将前缀技能增量加回 skills
    if (newPrefixes.length === 0) return

    const all = await ctx.skills.list(lookupFor(agent))
    const effective = computeEffectiveDisabled(
      cfg.rules.disabledSkills,
      cfg.rules.keywordRules,
      state.matchedPrefixes,
      all.map((s) => s.name),
    )
    await reconcileShadows(ctx, state.disposers, effective, lookupFor(agent))
    // reconcile 撤销了命中前缀的 shadow → 同步更新"仍被隐藏"的清单（供下一轮恢复）
    recordHidden(sid, [...state.disposers.keys()])
    for (const s of all) {
      const rule = cfg.rules.keywordRules.find((r) => s.name.startsWith(r.skillPrefix))
      if (rule && state.matchedPrefixes.has(rule.skillPrefix)) {
        const kw = keywordFor(s.name, cfg.rules.keywordRules, state.matchedPrefixes, state.matchedKeywords)
        upsertSkill(cfg, { name: s.name, keyword: kw, overview: s.description }, 'add')
      }
    }
    store.flush()
  }

  /** 每轮 next() 之后：观测实际调用并落盘 */
  const stepSession = async (agent: Agent, messages: AgentMessage[]): Promise<void> => {
    const state = sessions.get(agent.session.id)
    if (!state) return
    const cfg = store.get()
    let changed = false

    // 观测实际调用：tool/call(name=skill) 或 skill-invocation
    for (const ev of agent.session.events) {
      const name = skillNameFromEvent(ev)
      if (name && !state.used.has(name)) {
        state.used.add(name)
        recordUsage(cfg, name)
        changed = true
      }
    }

    if (changed) store.flush()
  }

  /** 会话销毁：撤销 shadow + 清理该会话的隐藏登记 + 落盘 */
  const cleanupSession = (agent?: { session?: { id?: string } }): void => {
    const sid = agent?.session?.id
    if (!sid) return
    const state = sessions.get(sid)
    if (!state) return
    for (const d of state.disposers.values()) d()
    sessions.delete(sid)
    initializing.delete(sid)
    recordHidden(sid, [])
    store.flush()
  }

  // 注意：**不在** session-start 初始化。此时 `agent.session.events` 通常尚无首条用户消息，
  // 据此判定会把本应可见的技能先隐藏；而实测 dispose 无法将其恢复到框架目录，
  // 造成"关键字命中也加载不回来"。故统一推迟到 pre-step（此时 messages 已含真实用户文本），
  // 在 next() 之前一次性判定正确。session-start 仅保留事件以便未来扩展。
  void (null as unknown as SessionStartPayload)

  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: NextFn) => {
    // 关键顺序：技能目录（<system-reminder><available_skills>，位于 messages 中）是在
    // next() 内部生成的。若在 next() 之后才注册 shadow，首轮目录就已定稿，禁用技能仍会
    // 出现在上下文中（实测首轮 messages 含全部 lark-* 45 处）。故先完成初始化/协调，
    // 再交回框架构建本轮。
    const sid = payload.agent?.session?.id
    if (sid && !sessions.has(sid)) {
      await initSession(payload.agent)
    }
    // 本轮新命中关键字 → 撤销对应 shadow，使技能在**本轮**目录即可见
    await reconcileForTurn(payload.agent, payload.messages)
    const decision = await next()
    if (decision && decision.kind === 'reject') return decision
    await stepSession(payload.agent, payload.messages)
    return decision
  })

  ctx.on('agent/disposed', (agent?: { session?: { id?: string } }) => {
    cleanupSession(agent)
  })
}
