/**
 * 技能可见性控制（宿主端插件 dsh-debugger）
 *
 * 核心思路（零框架改动）：注册同名 runtime shadow 技能并设
 * invocation.modelInvocable=false，使框架 tool-skill 基于 ctx.skills.snapshot()
 * 自建的模型目录自动剔除该技能（rank 250 < 600 → 同名词条胜出）。
 *
 * 注意：受 DSH 运行时约束，register 当前落到**全局层**（插件 ctx 的 scopeOf 为 undefined），
 * 而非 per-agent 作用域层。详见 design.md「已知边界」。对"个人禁用清单"语义正确，
 * 持久配置跨会话于 session-start 重注册即可；并发多会话共享全局影子为已知边界。
 *
 * @module dsh-debugger/visibility
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KeywordRule } from './config.js'
import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'

/**
 * 计算有效禁用集：disabledSkills ∪（所有命中关键字规则前缀的技能）去掉被命中关键字前缀豁免的技能。
 *
 * 关键字规则的前缀族（如 skillPrefix:"lark-"）默认隐藏——只有用户消息命中对应关键字
 * （飞书/feishu/lark）后，经 reconcile 把该前缀技能从有效禁用集移除，才重新进入模型目录。
 * 这正是"省 token"的核心：lark-* 等前缀技能族默认不占模型上下文，命中意图时才加载。
 *
 * @param knownSkillNames 当前已注册的技能名（用于把规则前缀族默认纳入禁用集）；不传则仅用 disabledSkills。
 *
 * @example computeEffectiveDisabled([], rules, new Set(), ['lark-approval','lark-apps'])
 *   // => ['lark-approval','lark-apps']（默认隐藏前缀族）
 * @example computeEffectiveDisabled([], rules, new Set(['lark-']), ['lark-approval','lark-apps'])
 *   // => []（关键字命中，前缀族豁免）
 */
export function computeEffectiveDisabled(
  disabled: string[],
  rules: KeywordRule[],
  matchedPrefixes: Set<string>,
  knownSkillNames?: string[],
): string[] {
  // 关键字规则前缀族默认隐藏（命中关键字后再豁免），实现"省 token"。
  const ruled = (knownSkillNames ?? []).filter((name) =>
    rules.some((r) => name.startsWith(r.skillPrefix)),
  )
  const base = Array.from(new Set([...disabled, ...ruled]))
  return base.filter((name) => ![...matchedPrefixes].some((p) => name.startsWith(p)))
}

/**
 * 扫描文本，返回命中的前缀集合与命中的关键字字面量集合。
 * 关键字统一小写归一化后做 includes 匹配（词边界可选，默认包含即命中）。
 */
export function matchKeywordRules(
  text: string,
  rules: KeywordRule[],
): { prefixes: Set<string>; keywords: Set<string> } {
  const lower = (text ?? '').toLowerCase()
  const prefixes = new Set<string>()
  const keywords = new Set<string>()
  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (kw && lower.includes(kw.toLowerCase())) {
        prefixes.add(rule.skillPrefix)
        keywords.add(kw)
        break
      }
    }
  }
  return { prefixes, keywords }
}

/** 返回某技能名命中的规则前缀（无则 undefined） */
export function prefixOf(name: string, rules: KeywordRule[]): string | undefined {
  return rules.find((r) => name.startsWith(r.skillPrefix))?.skillPrefix
}

/** 返回某技能名对应的命中关键字字面量（用于 skills 记录的 keyword 字段） */
export function keywordFor(
  name: string,
  rules: KeywordRule[],
  matchedPrefixes: Set<string>,
  matchedKeywords: Set<string>,
): string {
  const prefix = prefixOf(name, rules)
  if (prefix && matchedPrefixes.has(prefix)) {
    // 取该前缀规则对应的任一命中关键字字面量
    const rule = rules.find((r) => r.skillPrefix === prefix)
    const hit = rule?.keywords.find((k) => matchedKeywords.has(k))
    return hit ?? rule?.keywords[0] ?? ''
  }
  return ''
}

/**
 * 注册同名 runtime shadow 技能（modelInvocable:false），使同名词条在模型目录中胜出（rank 250<600）。
 * 返回 name → disposer 映射，便于后续按名撤销（运行时关键字豁免 / 热更新撤销单个 shadow）。
 *
 * scopeCtx 由调用方传入**插件自身已注入 `skills` 的 ctx**（与框架同一 registry 实例）；
 * register 落到全局层（scopeOf(pluginCtx)=undefined，rank 250 < bundled 600 胜出）。
 * 切勿传入 `agent.ctx.skills`——agent 作用域 Context 未必注入 `skills` 服务（实测 headless
 * 下报 "cannot get property skills without inject"），且 `@deepseek-ai/dsh-scope` 的
 * `createScope` 在插件运行时不解析，无法用来铸造 per-agent 作用域。
 */
export async function applyShadows(
  scopeCtx: Context,
  names: string[],
  lookup: SkillViewOptions,
): Promise<Map<string, () => void>> {
  const disposers = new Map<string, () => void>()
  const known = await scopeCtx.skills.list(lookup)
  for (const name of names) {
    const original = known.find((s) => s.name === name)
    if (!original) continue
    disposers.set(
      name,
      scopeCtx.skills.register({
        name,
        description: original.description,
        content: '',
        invocation: { modelInvocable: false, userInvocable: true },
      }) as () => void,
    )
  }
  return disposers
}

/**
 * 依据有效禁用集协调 shadow 注册：
 * - 已注册但不在 effective 中的 → 撤销（关键字命中或热更新移除禁用）
 * - 在 effective 中但未注册的 → 注册
 */
export async function reconcileShadows(
  scopeCtx: Context,
  disposers: Map<string, () => void>,
  effective: string[],
  lookup: SkillViewOptions,
): Promise<void> {
  for (const [name, dispose] of [...disposers]) {
    if (!effective.includes(name)) {
      dispose()
      disposers.delete(name)
    }
  }
  const known = await scopeCtx.skills.list(lookup)
  for (const name of effective) {
    if (disposers.has(name)) continue
    const original = known.find((s) => s.name === name)
    if (!original) continue
    disposers.set(
      name,
      scopeCtx.skills.register({
        name,
        description: original.description,
        content: '',
        invocation: { modelInvocable: false, userInvocable: true },
      }) as () => void,
    )
  }
}
