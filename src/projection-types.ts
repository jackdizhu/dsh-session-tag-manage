/**
 * 会话标签投影的共享类型表（宿主 + 客户端共用）。
 *
 * 职责：
 * - 定义 `TagProjectionValue`（客户端可见值）与 `TagProjectionState`（宿主 fold 状态）。
 * - 通过声明合并扩展 `SessionProjectionMap` / `SessionProjectionStateMap` 两个类型表，
 *   使宿主投影注册（src/projection.ts）与客户端读取（src/client/index.ts）共享同一契约。
 *
 * 说明：本模块仅含类型与声明合并（零运行时逻辑），供宿主与客户端导入，
 * 避免两边重复声明导致类型漂移。
 */
import type { SessionTag, SessionTagSource } from './events.ts'

/** 客户端可见投影值（wire.view 输出，与 SessionProjectionMap 对齐）。 */
export interface TagProjectionValue {
  tag: SessionTag | null
  source: SessionTagSource | null
  lastActiveAt: number | null
}

/** 宿主 fold 状态（apply 维护的持久化 state，另含 assignedAt）。 */
export interface TagProjectionState extends TagProjectionValue {
  assignedAt: number | null
}

/** 声明合并两个投影类型表（SessionProjectionMap / SessionProjectionStateMap）。 */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    'session-tag': TagProjectionValue
  }
  interface SessionProjectionStateMap {
    'session-tag': TagProjectionState
  }
}
