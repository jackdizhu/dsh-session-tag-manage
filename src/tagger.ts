/**
 * 会话标签分析器：7 分钟计时 + 最后一轮内容提取 + 规则 / LLM 兜底判定 + 事件持久化。
 *
 * 设计要点（决策 2 / 3 / 4 / 8）：
 * - 计时走 `ctx.effect()` 生命周期托管，插件卸载 / 会话销毁自动回收。
 * - 内容提取只取最后一个 `turn/start` 之后的 user/assistant 文本块，
 *   排除文件附件、reasoning 思考块、tool/* 与 assistant/chunk。
 * - 规则命中直接写事件；未命中走 `ctx.llm.stream` + BlockAssembler 组装，
 *   以 JSON 约束输出枚举。
 * - 写自动标签前检查最近一次标签 source，为 `user-override` 则跳过（锁定手动标签）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Config } from './config'
import { applyRules } from './rules'
import { isSessionTag } from './events'
import type { SessionTag, SessionTagSource, TagId } from './events'

/** 提取出的最后一轮可读文本内容。 */
export interface ExtractedContent {
  /** 按时间序排列的 user/assistant 文本消息。 */
  messages: { role: 'user' | 'assistant'; text: string }[]
}

/**
 * 提取最后一个 `turn/start` 之后的 user/assistant 可读文本。
 * @param events - 会话完整事件日志
 * @param maxMessages - 参与分析的最大消息条数（截断到最近 N 条）
 * @returns 提取结果（仅含 text 块拼接文本）
 */
export function extractLastTurn(
  events: readonly SessionEvent[],
  maxMessages: number,
): ExtractedContent {
  // 从后往前定位最后一个 turn/start 的 seq 作为边界
  let boundarySeq = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/start') {
      boundarySeq = events[i].seq
      break
    }
  }

  const messages: ExtractedContent['messages'] = []
  for (const event of events) {
    if (event.seq < boundarySeq) continue
    if (event.type === 'user/message') {
      // 只保留 text 块，过滤文件附件等其他类型 block
      const text = event.data.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
      if (text.trim()) messages.push({ role: 'user', text })
    } else if (event.type === 'assistant/message') {
      // 过滤 reasoning 思考块，只留可见 text
      const text = event.data.message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
      if (text.trim()) messages.push({ role: 'assistant', text })
    }
    // tool/call、tool/result、assistant/chunk 一律不进分析输入
  }

  return { messages: messages.slice(-maxMessages) }
}

/**
 * 解析 LLM 输出为标签枚举。
 * 优先按约束的 JSON 格式解析（{"tag": "枚举"}），失败则正则兜底，最终回退 `in_progress`。
 * @param text - LLM 返回的文本
 * @returns 合法标签枚举
 */
export function parseTagResult(text: string): SessionTag {
  // 去掉可能的 ```json 代码围栏
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()

  // 优先 JSON 解析
  try {
    const parsed: unknown = JSON.parse(cleaned)
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
    const value = record?.tag ?? record?.result ?? parsed
    if (typeof value === 'string' && isSessionTag(value)) return value
  } catch {
    // 非 JSON 输出，走正则兜底
  }

  // 正则兜底：直接输出枚举值（可能带引号）
  const match = cleaned.match(/("?)(in_progress|abnormal_end|waiting|completed|invalid)\1/)
  if (match) return match[2] as SessionTag
  return 'in_progress'
}

/** 会话标签分析器：管理计时器与标签写入。 */
export class SessionTagger {
  /** sessionId -> 取消函数（重置式计时器） */
  private readonly timers = new Map<string, () => void>()

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /**
   * 启动 / 重置某会话的延迟分析计时器。
   * 同一会话新轮次结束会先取消旧计时器，再注册新计时器。
   * @param session - 目标会话
   * @param delayMs - 延迟毫秒数（默认 7 分钟）
   */
  schedule(session: Session, delayMs: number): void {
    const sessionId = session.id
    // 同一会话已有时钟则重置（取消旧计时器）
    this.timers.get(sessionId)?.()

    // 记录计时注册时的日志长度：analyze 前比对，防止延迟期间新事件（新轮次）导致的竞态覆盖
    const baseSeq = session.seq

    // 计时器经 ctx.effect 托管：插件卸载时自动回收，不留幽灵回调
    const cancel = this.ctx.effect(() => {
      const timer = setTimeout(async () => {
        this.timers.delete(sessionId)
        try {
          await this.analyze(session, baseSeq)
        } catch (error) {
          this.ctx.logger('session-tagger').warn('会话标签分析失败: %o', error)
        }
      }, delayMs)
      return () => clearTimeout(timer)
    }, 'session-tagger.timer')

    this.timers.set(sessionId, cancel)
  }

  /**
   * 立即打标（不走计时），并取消该会话的挂起计时器。
   * 用于异常终止 reason 与新轮次开始（回 in_progress）。
   * @param session - 目标会话
   * @param tag - 标签枚举
   * @param reason - 打标原因说明
   * @param options - 可选：`ignoreLock` 为 true 时豁免手动标签锁定
   *   （仅 `turn/start` 重置为 `in_progress` 时使用，与冲突策略 B 一致）
   */
  markImmediately(
    session: Session,
    tag: SessionTag,
    reason: string,
    options: { ignoreLock?: boolean } = {},
  ): void {
    this.cancel(session.id)
    // 手动标签锁定：非豁免路径遇到 user-override 跳过，避免覆盖用户手动修正
    if (!options.ignoreLock && this.lastTagSource(session) === 'user-override') {
      this.ctx.logger('session-tagger').debug('会话 %s 标签被手动锁定，跳过即时打标', session.id)
      return
    }
    this.appendTagEvent(session, tag, 'rule', reason)
  }

  /** 取消某会话的挂起计时器（会话销毁 / 新轮次开始时调用）。 */
  cancel(sessionId: SessionId): void {
    this.timers.get(sessionId)?.()
    this.timers.delete(sessionId)
  }

  /** 回收全部计时器（插件卸载时调用）。 */
  dispose(): void {
    for (const cancel of this.timers.values()) cancel()
    this.timers.clear()
  }

  /**
   * 执行标签分析：规则前置 + LLM 兜底。
   * @param session - 目标会话
   * @param baseSeq - 计时注册时的日志长度快照；延迟期间日志已推进则放弃写入
   *   （防新轮次 / 新事件到达后，本次分析结果覆盖最新状态）
   */
  private async analyze(session: Session, baseSeq: number): Promise<void> {
    // 竞态检查：延迟期间日志已推进（新轮次等），本次分析结果已过时，放弃
    if (this.logMoved(session, baseSeq)) return

    // 锁定手动标签前置检查：最近一次标签 source 为 user-override 则跳过自动写入
    if (this.lastTagSource(session) === 'user-override') {
      this.ctx.logger('session-tagger').debug('会话 %s 标签被手动锁定，跳过自动分析', session.id)
      return
    }

    const extracted = extractLastTurn(session.events, this.config.maxLastTurnMessages)

    // 规则判定：命中直接写事件（不调用 LLM）
    const verdict = applyRules(session.events)
    if (verdict?.kind === 'hit') {
      if (this.logMoved(session, baseSeq)) return
      this.appendTagEvent(session, verdict.tag, 'rule', verdict.reason)
      return
    }

    // 候选标签（如待办全完结）作为 LLM 提示，语义确认
    const hint = verdict?.kind === 'candidate' ? `候选：${verdict.tag}` : undefined

    // 无可读文本且无候选时无需调 LLM
    if (extracted.messages.length === 0 && !hint) {
      if (this.logMoved(session, baseSeq)) return
      this.appendTagEvent(session, 'in_progress', 'llm', 'no readable content in last turn')
      return
    }

    // LLM 兜底：completed / invalid / in_progress 语义判定
    const tag = await this.llmAnalyze(extracted, hint)
    // LLM 调用期间新轮次到达（turn/start 已写 in_progress），放弃本次写入
    if (this.logMoved(session, baseSeq)) return
    this.appendTagEvent(session, tag, 'llm', 'llm-based semantic analysis')
  }

  /** 判断日志是否已推进（seq 与快照不一致）。 */
  private logMoved(session: Session, baseSeq: number): boolean {
    return session.seq !== baseSeq
  }

  /** 调用 LLM 进行语义判定，流式分片经 BlockAssembler 组装后解析枚举。 */
  private async llmAnalyze(extracted: ExtractedContent, hint?: string): Promise<SessionTag> {
    const prompt = this.buildPrompt(extracted, hint)
    const message = createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    })

    const assembler = new BlockAssembler()
    try {
      // provider 路由 + model + messages（JSON 约束输出枚举）
      for await (const chunk of this.ctx.llm.stream({
        provider: this.config.analysisProvider,
        model: this.config.analysisModel,
        messages: [message],
        temperature: 0,
        maxTokens: 64,
      })) {
        assembler.push(chunk)
      }
    } catch (error) {
      // LLM 调用失败时回退安全默认标签 in_progress
      this.ctx.logger('session-tagger').warn('LLM 标签分析失败，回退 in_progress: %o', error)
      return 'in_progress'
    }

    const text = assembler
      .blocks()
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
    return parseTagResult(text)
  }

  /** 构造 LLM 提示词：约束仅输出枚举并以严格 JSON 返回。 */
  private buildPrompt(extracted: ExtractedContent, hint?: string): string {
    const transcript = extracted.messages
      .map((message) => `${message.role}: ${message.text}`)
      .join('\n')
    const hintLine = hint ? `\n提示：${hint}` : ''
    return [
      '你是一个会话标签分类器。请根据最后一轮对话判断该会话的当前状态，',
      '只能输出以下枚举之一：',
      '- completed：主题任务已全部完成，无剩余事项',
      '- invalid：仅为打招呼、或输入与主题无关、无法确定意图的无效会话',
      '- in_progress：任务仍在进行中',
      hintLine,
      '',
      '必须严格以 JSON 格式输出：{"tag": "<枚举值>"}，不要输出任何其他内容。',
      '',
      '最后一轮对话内容：',
      '---',
      transcript || '（无文本内容）',
      '---',
    ].join('\n')
  }

  /**
   * 写标签事件到会话日志。
   * 经 `session.append()` 写入 `session-tag/assigned`（log-only，无需 SurfaceIntent），
   * payload 保证 JSON 可序列化。
   */
  private appendTagEvent(
    session: Session,
    tag: SessionTag,
    source: SessionTagSource,
    reason: string,
  ): void {
    session.append('session-tag/assigned', {
      tagId: `tag-${session.id}` as TagId,
      tag,
      source,
      reason,
      assignedAt: Date.now(),
    })
  }

  /** 读取最近一次标签事件的 source（用于手动标签锁定检查）。 */
  private lastTagSource(session: Session): SessionTagSource | null {
    const events = session.events
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.type === 'session-tag/assigned') return event.data.source
    }
    return null
  }
}
