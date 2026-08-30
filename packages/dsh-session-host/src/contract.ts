/**
 * Host ↔ Client 共享的路由常量和类型定义
 * 参考 dsh-session-manager-fork/src/contract.ts
 *
 * @module dsh-session-tag-manage-contract
 */

// ===== 路由常量 =====

/** 工作区会话标签查询路由 */
export const WORKSPACE_LIST_TAG_ROUTE = '/dsh-session-tag-manage/workspace.list.tag'

/** 工作区会话标签写入路由 */
export const WORKSPACE_TAG_SET_ROUTE = '/dsh-session-tag-manage/workspace.tag.set'

/** 会话事件数据标签查询路由 */
export const WORKSPACE_SESSION_TAG_ROUTE = '/dsh-session-tag-manage/workspace.session.tag'

// ===== 数据结构 =====

/** 会话标签条目结构 */
export interface SessionTagEntry {
  /** 会话 ID */
  sessionId: string
  /** 会话标题 */
  title: string
  /** 当前标签（状态枚举） */
  sessionCurrentTag: string
  /** 创建时间（ISO 8601） */
  createdAt: string
  /** 更新时间（ISO 8601） */
  updatedAt: string
}

/** 工作区会话标签查询请求体 */
export interface WorkspaceTagQueryRequest {
  /** 工作区 ID */
  workspaceId: string
}

/** 工作区会话标签查询响应体 */
export interface WorkspaceTagQueryResponse {
  /** 请求是否成功 */
  ok: boolean
  /** 成功时返回的数据 */
  value?: {
    /** 会话标签条目列表 */
    items: SessionTagEntry[]
  }
  /** 失败时返回的错误信息 */
  error?: string
}

/** 工作区会话标签写入请求体 */
export interface WorkspaceTagSetRequest {
  /** 工作区 ID */
  workspaceId: string
  /** 会话标签条目（全量覆盖） */
  sessions: SessionTagEntry[]
  /** 是否删除整个工作区文件（仅当 sessions 为空时生效） */
  deleteWorkspace?: boolean
}

/** 工作区会话标签写入响应体 */
export interface WorkspaceTagSetResponse {
  /** 请求是否成功 */
  ok: boolean
  /** 成功时返回写入的条目数 */
  value?: {
    /** 写入的条目数 */
    count: number
  }
  /** 失败时返回的错误信息 */
  error?: string
}

// ===== workspace.session.tag 路由类型 =====

/** 会话事件数据标签查询请求体 */
export interface WorkspaceSessionTagRequest {
  /** 会话 ID */
  sessionId: string
  /** 单页最大消息数，默认 200 */
  maxMessages?: number
}

/** 单个会话事件数据标签条目 */
export interface SessionEventTagItem {
  /** 会话 ID */
  sessionId: string
  /** 会话标题 */
  title: string | null
  /** 轮次数 */
  turns: number
  /** 用户消息数（仅 source.kind==='user'） */
  userMessages: number
  /** 助手消息数 */
  assistantMessages: number
  /** 工具调用统计（按调用次数降序） */
  toolCalls: Array<{ name: string; count: number }>
  /** 用户真实提问文本列表 */
  userMessageTexts: string[]
  /** 写文件操作路径列表 */
  fileOperations: string[]
  /** 活动开始时间（epoch ms） */
  startedAt: number | null
  /** 活动结束时间（epoch ms） */
  updatedAt: number | null
  /** 事件总数 */
  totalEvents: number
  /** 是否还有更早的事件未读完 */
  hasMore: boolean
}

/** 会话事件数据标签查询响应体 */
export interface WorkspaceSessionTagResponse {
  /** 请求是否成功 */
  ok: boolean
  /** 成功时返回的数据 */
  value?: {
    /** 会话事件数据标签条目 */
    item: SessionEventTagItem
  }
  /** 失败时返回的错误信息 */
  error?: string
}

// ===== DSH RPC 通用格式 =====

/** DSH RPC 请求格式（参考 API 文档） */
export interface DshRpcRequest {
  type: 'client-request'
  rpcId: string
  method: string
  payload: WorkspaceTagQueryRequest
}

/** DSH RPC 响应格式（参考 API 文档） */
export interface DshRpcResponse {
  type: 'server-response'
  rpcId: string
  result: WorkspaceTagQueryResponse
}
