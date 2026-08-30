/**
 * DSH RPC 信封通信客户端
 *
 * 封装与 DSH 宿主进程的标准 RPC 通信协议：
 * - 请求格式：{ type: 'client-request', rpcId, method, payload }
 * - 成功响应：{ type: 'server-response', rpcId, result: { ok: true, value } }
 * - 业务失败：{ type: 'server-response', rpcId, result: { ok: false, error } }
 *
 * 使用方式：
 * ```typescript
 * const result = await dshRpcCall('http://127.0.0.1:3080', 'session.history', {
 *   sessionId: 'session-xxx',
 *   maxMessages: 50,
 * })
 * if (result.ok) {
 *   // result.value 包含响应数据
 * }
 * ```
 *
 * @module utils/rpc-client
 */

// ===== 唯一 ID 生成 =====

/** 生成 UUID v4（兼容 Node.js crypto） */
function generateUuid(): string {
  // Node.js >= 19 内置 crypto.randomUUID()
  try {
    return crypto.randomUUID()
  } catch {
    // fallback: 手动拼接
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}

// ===== 类型定义 =====

/** DSH RPC 请求信封 */
export interface DshRpcRequest<TPayload = unknown> {
  type: 'client-request'
  rpcId: string
  method: string
  payload: TPayload
}

/** DSH RPC 成功响应信封 */
export interface DshRpcSuccessResponse<TValue = unknown> {
  type: 'server-response'
  rpcId: string
  result: {
    ok: true
    value: TValue
  }
}

/** DSH RPC 业务失败响应信封 */
export interface DshRpcErrorResponse {
  type: 'server-response'
  rpcId: string
  result: {
    ok: false
    error: string | { code: string; message: string; details?: unknown }
  }
}

/** DSH RPC 响应信封（联合类型） */
export type DshRpcResponse<TValue = unknown> =
  | DshRpcSuccessResponse<TValue>
  | DshRpcErrorResponse

/** RPC 调用结果（解包 ok 分支） */
export type DshRpcResult<TValue = unknown> =
  | { ok: true; value: TValue; rpcId: string }
  | { ok: false; error: string | { code: string; message: string; details?: unknown }; rpcId: string }

/** RPC 调用配置 */
export interface DshRpcCallOptions {
  /** 请求超时时间（毫秒），默认 30000 */
  timeoutMs?: number
  /** 额外的 HTTP 头 */
  headers?: Record<string, string>
}

// ===== 核心 RPC 调用函数 =====

/**
 * 发送 DSH RPC 请求并返回解包后的结果
 *
 * @param baseUrl - DSH Web 服务基础 URL，如 'http://127.0.0.1:3080'
 * @param method - RPC 方法名，如 'session.history'、'workspace.list'
 * @param payload - 请求载荷
 * @param options - 可选配置（超时、自定义头）
 * @returns 解包后的 RPC 结果
 * @throws 当网络请求失败或 HTTP 层错误时抛出
 */
export async function dshRpcCall<TPayload = unknown, TValue = unknown>(
  baseUrl: string,
  method: string,
  payload: TPayload,
  options?: DshRpcCallOptions,
): Promise<DshRpcResult<TValue>> {
  const rpcId = generateUuid()
  const timeoutMs = options?.timeoutMs ?? 30_000

  const request: DshRpcRequest<TPayload> = {
    type: 'client-request',
    rpcId,
    method,
    payload,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/${method}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...options?.headers,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    // HTTP 传输层错误（404/415/400/500）
    if (!response.ok) {
      return {
        ok: false,
        error: `http-${response.status}: ${response.statusText}`,
        rpcId,
      }
    }

    const raw: DshRpcResponse<TValue> = await response.json()

    // 校验响应格式
    if (raw.type !== 'server-response' || raw.rpcId !== rpcId) {
      return {
        ok: false,
        error: 'invalid-response-format',
        rpcId,
      }
    }

    // 业务层成功
    if (raw.result.ok) {
      return {
        ok: true,
        value: raw.result.value,
        rpcId,
      }
    }

    // 业务层失败
    return {
      ok: false,
      error: raw.result.error,
      rpcId,
    }
  } catch (err) {
    // 网络错误 / 超时
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `network-error: ${message}`,
      rpcId,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ===== 常用 RPC 方法快捷调用 =====

/** workspace.list 请求参数 */
export interface WorkspaceListParams {}

/** workspace.list 单个工作区条目 */
export interface WorkspaceItem {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

/** workspace.list 响应值 */
export interface WorkspaceListValue {
  items: WorkspaceItem[]
  archivedSessionIds: string[]
}

/**
 * 获取工作区列表
 *
 * @param baseUrl - DSH Web 服务 URL
 * @param options - 可选配置
 */
export async function fetchWorkspaceList(
  baseUrl: string,
  options?: DshRpcCallOptions,
): Promise<DshRpcResult<WorkspaceListValue>> {
  return dshRpcCall<WorkspaceListParams, WorkspaceListValue>(
    baseUrl,
    'workspace.list',
    {},
    options,
  )
}


