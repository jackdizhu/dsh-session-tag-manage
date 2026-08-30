/**
 * 客户端标签管理 API 调用工具
 *
 * 封装对 /dsh-session-tag-manage/* 路由的调用，
 * 自动生成 rpcId 并构造标准请求信封。
 *
 * 路由常量与 Host 端 contract.ts 保持一致。
 *
 * @module client/utils/tag-api
 */

import { generateRpcId } from './uuid.js'

// ===== 路由常量（与 host contract.ts 保持一致） =====

/** 工作区会话标签查询路由 */
export const WORKSPACE_LIST_TAG_ROUTE = '/dsh-session-tag-manage/workspace.list.tag'

/** 会话事件数据标签查询路由 */
export const WORKSPACE_SESSION_TAG_ROUTE = '/dsh-session-tag-manage/workspace.session.tag'

// ===== 通用请求类型 =====

/** 标准请求信封 */
interface TagRequestEnvelope<TPayload> {
  type: 'client-request'
  rpcId: string
  method: string
  payload: TPayload
}

/** 标准成功响应 */
interface TagSuccessResponse<TValue> {
  type: 'server-response'
  rpcId: string
  result: {
    ok: true
    value: TValue
  }
}

/** 标准失败响应 */
interface TagErrorResponse {
  type: 'server-response'
  rpcId: string
  result: {
    ok: false
    error: string
  }
}

/** 解包后的调用结果 */
export type TagApiResult<TValue> =
  | { ok: true; value: TValue; rpcId: string }
  | { ok: false; error: string; rpcId: string }

// ===== workspace.list.tag 类型 =====

/** 会话标签条目结构 */
export interface SessionTagEntry {
  sessionId: string
  title: string
  sessionCurrentTag: string
  createdAt: string
  updatedAt: string
}

/** workspace.list.tag 请求参数 */
export interface WorkspaceListTagParams {
  workspaceId: string
}

/** workspace.list.tag 响应值 */
export interface WorkspaceListTagValue {
  items: SessionTagEntry[]
}

// ===== workspace.session.tag 类型 =====

/** workspace.session.tag 请求参数 */
export interface WorkspaceSessionTagParams {
  sessionId: string
  maxMessages?: number
}

/** 工具调用统计 */
export interface ToolCallStat {
  name: string
  count: number
}

/** 轮次结束/异常原因（与宿主 contract.ts RoundEndReason 保持一致） */
export type RoundEndReason =
  | 'completed'
  | 'aborted'
  | 'error'
  | 'interrupted'
  | 'max-tokens'
  | 'blocked'
  | 'ongoing'
  | 'seed'

/** 单轮会话事件数据标签条目（与宿主 SessionEventTagItem 字段一致） */
export interface SessionEventTagItem {
  sessionId: string
  title: string | null
  round: number
  endReason: RoundEndReason
  turns: number
  userMessages: number
  assistantMessages: number
  toolCalls: ToolCallStat[]
  userMessageTexts: string[]
  fileOperations: string[]
  startedAt: number | null
  updatedAt: number | null
  totalEvents: number
}

/** workspace.session.tag 响应值 */
export interface WorkspaceSessionTagValue {
  items: SessionEventTagItem[]
  hasMore: boolean
}

// ===== 通用请求函数 =====

/**
 * 发送带 rpcId 信封的 POST 请求
 *
 * @param route - 路由路径
 * @param method - RPC 方法名
 * @param payload - 请求载荷
 * @returns 解包后的结果
 */
async function tagApiPost<TPayload, TValue>(
  route: string,
  method: string,
  payload: TPayload,
): Promise<TagApiResult<TValue>> {
  const rpcId = generateRpcId()

  const envelope: TagRequestEnvelope<TPayload> = {
    type: 'client-request',
    rpcId,
    method,
    payload,
  }

  try {
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })

    if (!res.ok) {
      return { ok: false, error: `http-${res.status}: ${res.statusText}`, rpcId }
    }

    const raw = await res.json()

    // 兼容两种响应格式：
    // 1. 标准信封 { type: 'server-response', rpcId, result: { ok, value/error } }
    // 2. 简单格式 { ok, value/error }（Host 端当前使用此格式）
    if (raw.type === 'server-response') {
      if (raw.rpcId !== rpcId) {
        return { ok: false, error: 'rpc-id-mismatch', rpcId }
      }
      if (raw.result.ok) {
        return { ok: true, value: raw.result.value, rpcId }
      }
      return { ok: false, error: raw.result.error, rpcId }
    }

    // 简单格式兼容
    if (raw.ok) {
      return { ok: true, value: raw.value, rpcId }
    }
    return { ok: false, error: raw.error ?? 'unknown-error', rpcId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `network-error: ${message}`, rpcId }
  }
}

// ===== 业务 API 函数 =====

/**
 * 查询工作区会话标签
 *
 * @param workspaceId - 工作区 ID
 * @returns 标签条目列表
 */
export async function fetchWorkspaceListTag(
  workspaceId: string,
): Promise<TagApiResult<WorkspaceListTagValue>> {
  return tagApiPost<WorkspaceListTagParams, WorkspaceListTagValue>(
    WORKSPACE_LIST_TAG_ROUTE,
    'workspace.list.tag',
    { workspaceId },
  )
}

/**
 * 查询单个会话的事件数据标签
 *
 * 调用内置 session.history 接口获取事件流，
 * 使用 utils 工具整理后返回统计信息。
 *
 * @param sessionId - 会话 ID
 * @param maxMessages - 单页最大消息数，默认 200
 * @returns 会话事件数据标签
 */
export async function fetchWorkspaceSessionTag(
  sessionId: string,
  maxMessages?: number,
): Promise<TagApiResult<WorkspaceSessionTagValue>> {
  return tagApiPost<WorkspaceSessionTagParams, WorkspaceSessionTagValue>(
    WORKSPACE_SESSION_TAG_ROUTE,
    'workspace.session.tag',
    { sessionId, maxMessages },
  )
}
