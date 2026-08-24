/**
 * 会话标签投影注册（宿主侧，阶段 2）。
 *
 * 职责：
 * - 合并声明 `SessionProjectionMap`（客户端可见值：tag / source / lastActiveAt）
 *   与 `SessionProjectionStateMap`（宿主 fold 状态：另含 assignedAt）两个类型表。
 * - 注册 `session-tag` 投影单元：`stateSchema`（Zod 校验持久化 state）、
 *   `stateVersion: 3`、`init`、纯同步 `apply`、`wire:{viewSchema,view}`。
 *
 * 契约要点（ProjectionDefinition）：
 * - `apply` MUST 为纯同步 fold；对无关事件 MUST 返回同一状态引用（`Object.is` 相等 → 零下游工作）。
 * - 对 `session-tag/assigned` 事件后写覆盖整份状态。
 * - 对活动事件集（turn/start、user/message、assistant/message、tool/call、tool/result、approval/asked）
 *   刷新 `lastActiveAt`。
 * - `state` MUST 为 plain JSON（持久化缓存前置条件）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import '@deepseek-ai/dsh-session-projection' // 副作用导入：激活 Context.sessionProjections 声明合并（typecheck）
import type { TagProjectionState, TagProjectionValue } from './projection-types'
import './projection-types' // 副作用导入：激活 SessionProjectionMap 声明合并（typecheck）

/** 重新导出宿主 fold 状态类型，供测试与宿主侧使用。 */
export type { TagProjectionState } from './projection-types'

/**
 * 视为"会话活动"的事件类型：出现即刷新 lastActiveAt。
 * `approval/asked` 为外部审批插件声明合并事件，故集合按 string 存储。
 */
const ACTIVITY_EVENTS: ReadonlySet<string> = new Set([
  'turn/start',
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
  'approval/asked',
])

/** 五分类标签枚举的 Zod 校验（nullable，state 未初始化 / 清空时可为 null）。 */
const TAG_ENUM = z.enum(['in_progress', 'abnormal_end', 'waiting', 'completed', 'invalid'])
/** 标签来源枚举的 Zod 校验（rule / llm / user-override）。 */
const SOURCE_ENUM = z.enum(['rule', 'llm', 'user-override'])

/** 校验持久化 state（宿主 fold 状态），与 TagProjectionState 对齐。 */
const stateSchema = z.object({
  tag: TAG_ENUM.nullable(),
  source: SOURCE_ENUM.nullable(),
  assignedAt: z.number().nullable(),
  lastActiveAt: z.number().nullable(),
})

/** 校验 wire 输出（客户端可见值），与 TagProjectionValue 对齐。 */
const viewSchema = z.object({
  tag: TAG_ENUM.nullable(),
  source: SOURCE_ENUM.nullable(),
  lastActiveAt: z.number().nullable(),
})

/** 空日志的初始状态（导出供测试直接断言）。 */
export function init(): TagProjectionState {
  return { tag: null, source: null, assignedAt: null, lastActiveAt: null }
}

/**
 * 纯同步 fold：前一个状态 + 一个已提交事件 → 下一个状态。
 * - 无关事件返回同一引用（Object.is 相等 → 零下游工作）。
 * - `session-tag/assigned` 后写覆盖整份状态（whole-value 快照）。
 * - 活动事件刷新 lastActiveAt。
 */
export function apply(state: TagProjectionState, event: SessionEvent): TagProjectionState {
  // 活动事件按运行时 type 匹配（approval/asked 不在本仓库联合类型内）。
  // 取单调不减的最大值：日志回放 / 时钟回拨 / 乱序事件到达时 lastActiveAt 不回退
  //（daily-reminder 以 lastActiveAt 统计"当日活动"，回退会造成统计偏差）。
  const isActivity = ACTIVITY_EVENTS.has(event.type as string)
  const lastActiveAt = isActivity ? Math.max(state.lastActiveAt ?? 0, event.time) : state.lastActiveAt

  if (event.type === 'session-tag/assigned') {
    // 后写覆盖：直接返回新状态对象（引用变化 → 触发下游变更通知）
    return {
      tag: event.data.tag,
      source: event.data.source,
      assignedAt: event.data.assignedAt,
      lastActiveAt,
    }
  }

  // 无关事件：lastActiveAt 未刷新则返回同一引用，避免下游无谓工作
  if (lastActiveAt === state.lastActiveAt) return state
  return { ...state, lastActiveAt }
}

/**
 * 注册 `session-tag` 投影单元。
 * @param ctx - Cordis Context（须已注入 `sessionProjections` 服务）
 */
export function registerTagProjection(ctx: Context): void {
  ctx.sessionProjections.register({
    key: 'session-tag',
    stateSchema,
    stateVersion: 3, // view 含 source 等字段，升版本使旧持久化缓存失效
    init,
    apply,
    wire: {
      viewSchema,
      view(state: TagProjectionState): TagProjectionValue {
        return { tag: state.tag, source: state.source, lastActiveAt: state.lastActiveAt }
      },
    },
  })
}
