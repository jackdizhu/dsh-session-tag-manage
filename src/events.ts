/**
 * 会话标签的事件与类型定义。
 *
 * 核心职责：
 * 1. 定义五分类标签枚举、品牌 ID 与来源类型。
 * 2. 通过声明合并扩展 `SessionEventMap`，新增 `session-tag/assigned` 自定义事件。
 *    该事件是 log-only（非 SurfaceEventType）审计事件：不参与派生历史、
 *    无需 SurfaceIntent，随会话日志持久化，重启 / 恢复 / Fork 可重放。
 */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** 会话标签五分类枚举。 */
export type SessionTag =
  | 'in_progress'
  | 'abnormal_end'
  | 'waiting'
  | 'completed'
  | 'invalid'

/** 标签 ID 品牌类型：区分于普通字符串。 */
export type TagId = Branded<'TagId'>

/** 标签来源：规则判定 / LLM 语义判定 / Web UI 手动覆盖。 */
export type SessionTagSource = 'rule' | 'llm' | 'user-override'

/** 合法标签闭集（用于 LLM 输出校验与手动更新服务校验）。 */
export const VALID_TAGS: readonly SessionTag[] = [
  'in_progress',
  'abnormal_end',
  'waiting',
  'completed',
  'invalid',
]

/** 类型守卫：判断字符串是否为合法标签枚举。 */
export function isSessionTag(value: string): value is SessionTag {
  return (VALID_TAGS as readonly string[]).includes(value)
}

/** `session-tag/assigned` 事件的数据载荷（whole-value 快照式，可 JSON 序列化）。 */
export interface SessionTagAssignedData {
  /** 标签实例 ID（按会话标识，whole-value 快照语义下同一会话恒为同一值）。 */
  tagId: TagId
  /** 五分类标签。 */
  tag: SessionTag
  /** 标签来源（rule / llm / user-override）。 */
  source: SessionTagSource
  /** 打标原因说明（可选）。 */
  reason?: string
  /** 指派时间（Unix 毫秒）。 */
  assignedAt: number
}

/** 声明合并扩展 `SessionEventMap`：注册自定义会话标签事件。 */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 会话标签写入事件。whole-value 快照式：每次携带完整标签状态。
     * 非 SurfaceEventType 的 log-only 事件：不参与派生历史，无需 SurfaceIntent。
     * @mode emit
     */
    'session-tag/assigned': SessionTagAssignedData
  }
}
