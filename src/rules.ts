/**
 * 规则判定器（纯函数）：结构化信号优先判定，规则命中不调用 LLM。
 *
 * 判定顺序：
 * 1. 异常终止：最后一个 `turn/end` 的 reason 非 completed → `abnormal_end`
 * 2. 会话等待：日志中存在未配对 `approval/asked`（按 id 配对）→ `waiting`
 * 3. 待办 / 进行中：最新 `todo/write` 全量快照
 *    - 含 pending / in_progress → `in_progress`
 *    - 全 completed 或空列表且最后轮次已 closed → 候选 `completed`（交 LLM 语义确认）
 * `agent/status` 是 whole-agent 运行态、官方明示不可作单轮信号，不作为判定依据。
 */
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session/types'
import type { SessionTag } from './events'

/**
 * 规则判定结果：
 * - `{ kind: 'hit', tag, reason }`：规则命中，直接写标签事件（不调用 LLM）
 * - `{ kind: 'candidate', tag }`：候选标签，需 LLM 语义确认
 * - `null`：规则未命中，走 LLM 兜底
 */
export type RuleVerdict =
  | { kind: 'hit'; tag: SessionTag; reason: string }
  | { kind: 'candidate'; tag: SessionTag }
  | null

/**
 * 读取审批配对事件的请求 id。
 * `approval/asked` / `approval/decided` 不在本仓库 `SessionEventMap` 内
 * （由外部审批插件声明合并），无法用类型谓词收窄 `SessionEvent`，
 * 故按运行时 `type` 判断 + 结构读取（`as unknown` 中转避免交叉 cast 告警）。
 */
function approvalIdOf(event: SessionEvent): string | undefined {
  const type = event.type as string
  if (type !== 'approval/asked' && type !== 'approval/decided') return undefined
  const data = event.data as unknown as { id?: string }
  return data.id
}

/** 从后往前查找最后一个指定类型的事件（泛型收窄返回精确类型）。 */
function lastEventOf<T extends SessionEventType>(
  events: readonly SessionEvent[],
  type: T,
): SessionEvent<T> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) return events[i] as SessionEvent<T>
  }
  return undefined
}

/**
 * 判断最后一个轮次是否已关闭：
 * 遍历事件流，`turn/start` 置为打开、`turn/end` 置为关闭，最终态即最后轮次状态。
 */
function isLastTurnClosed(events: readonly SessionEvent[]): boolean {
  let open = false
  for (const event of events) {
    if (event.type === 'turn/start') open = true
    else if (event.type === 'turn/end') open = false
  }
  return !open
}

/**
 * 对完整事件日志执行规则判定。
 * @param events - 会话的完整事件日志（`session.events`）
 * @returns 规则判定结果，见 {@link RuleVerdict}
 */
export function applyRules(events: readonly SessionEvent[]): RuleVerdict {
  // 规则 1：异常终止 —— 最后一个 turn/end 的 reason 非 completed，
  // 且最后轮次已关闭（无更新的 turn/start 打断，避免覆盖新轮次的 in_progress）
  const lastTurnEnd = lastEventOf(events, 'turn/end')
  if (lastTurnEnd && isLastTurnClosed(events) && lastTurnEnd.data.reason.kind !== 'completed') {
    return {
      kind: 'hit',
      tag: 'abnormal_end',
      reason: `turn/end reason ${lastTurnEnd.data.reason.kind}`,
    }
  }

  // 规则 2：会话等待 —— 存在未配对的 approval/asked（按 id 配对追踪）
  const pendingApprovalIds = new Set<string>()
  for (const event of events) {
    const id = approvalIdOf(event)
    if (id === undefined) continue
    if ((event.type as string) === 'approval/asked') pendingApprovalIds.add(id)
    else pendingApprovalIds.delete(id)
  }
  if (pendingApprovalIds.size > 0) {
    return { kind: 'hit', tag: 'waiting', reason: 'unresolved approval request(s)' }
  }

  // 规则 3：待办 / 进行中 —— 最新 todo/write 全量快照
  const lastTodo = lastEventOf(events, 'todo/write')
  if (lastTodo) {
    const todos = lastTodo.data.todos
    const hasActive = todos.some(
      (item) => item.status === 'pending' || item.status === 'in_progress',
    )
    if (hasActive) {
      return { kind: 'hit', tag: 'in_progress', reason: 'todo list has pending/in_progress items' }
    }
    // 全 completed 或空列表：候选完结（需最后轮次已 closed）
    if (isLastTurnClosed(events)) {
      return { kind: 'candidate', tag: 'completed' }
    }
    return { kind: 'hit', tag: 'in_progress', reason: 'last turn not closed yet' }
  }

  // 无 todo 快照、无审批、无异常终止：规则未命中，交 LLM 兜底
  return null
}
