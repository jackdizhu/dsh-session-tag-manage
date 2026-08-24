/**
 * 测试辅助：事件构造器。
 * 提供 seq 自动递增的事件工厂，以及规则 / 提取测试常用的组合事件。
 */
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session/types'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TodoItem } from '@deepseek-ai/dsh-session/types'

/** 全局 seq 计数器，保证构造事件 seq 连续。 */
let seqCounter = 0

/** 重置 seq 计数器（每个用例前调用）。 */
export function resetSeq(): void {
  seqCounter = 0
}

function nextSeq(): number {
  return seqCounter++
}

/** 构造已知类型事件（data 为 SessionEventMap 对应载荷）。 */
export function makeEvent<T extends SessionEventType>(
  type: T,
  data: SessionEventMap[T],
  time = 1_700_000_000_000,
): SessionEvent<T> {
  const seq = nextSeq()
  return { type, seq, time: time + seq, data } as SessionEvent<T>
}

/** 构造未知类型事件（如 approval/*，外部插件声明合并，本地按结构读取）。 */
export function makeRawEvent(type: string, data: unknown): SessionEvent {
  const seq = nextSeq()
  return { type, seq, time: 1_700_000_000_000 + seq, data } as unknown as SessionEvent
}

/** turn/start 事件。 */
export function turnStart(turn = 1): SessionEvent<'turn/start'> {
  return makeEvent('turn/start', { turn })
}

/** turn/end（正常完成）事件。 */
export function turnEndCompleted(turn = 1): SessionEvent<'turn/end'> {
  return makeEvent('turn/end', { turn, reason: { kind: 'completed' } })
}

/** turn/end（异常终止，max-tokens）事件。 */
export function turnEndAbnormal(turn = 1): SessionEvent<'turn/end'> {
  return makeEvent('turn/end', { turn, reason: { kind: 'max-tokens' } })
}

/** todo/write 全量快照事件。 */
export function todoWrite(todos: TodoItem[]): SessionEvent<'todo/write'> {
  return makeEvent('todo/write', { todos })
}

/** approval/asked 事件（未知类型，按结构构造）。 */
export function approvalAsked(id: string): SessionEvent {
  return makeRawEvent('approval/asked', { id })
}

/** approval/decided 事件（未知类型，按结构构造）。 */
export function approvalDecided(id: string): SessionEvent {
  return makeRawEvent('approval/decided', { id })
}

/** user/message 事件（内容块列表，surface 事件需带 surfaceOp marker；time 可选覆盖）。 */
export function userMessage(content: ContentBlock[], time?: number): SessionEvent<'user/message'> {
  const event = makeEvent('user/message', createUserMessage({ content, source: { kind: 'user' } }), time)
  return { ...event, surfaceOp: 'append' }
}

/** assistant/message 事件（内容块列表，surface 事件需带 surfaceOp marker）。 */
export function assistantMessage(content: ContentBlock[]): SessionEvent<'assistant/message'> {
  const event = makeEvent('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content,
      source: { provider: 'deepseek', model: 'test' },
    }),
  })
  return { ...event, surfaceOp: 'append' }
}
