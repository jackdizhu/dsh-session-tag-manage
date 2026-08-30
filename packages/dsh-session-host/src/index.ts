/**
 * 宿主端插件入口
 *
 * 通过 ctx.webServer 注册 HTTP 路由：
 * - /dsh-session-host-test：无参返回当前服务端时间戳
 * - /dsh-session-tag-manage/workspace.list.tag：按工作区查询会话标签
 * - /dsh-session-tag-manage/workspace.tag.set：按工作区写入会话标签
 * - /dsh-session-tag-manage/workspace.session.tag：按会话查询事件数据标签
 *
 * 存储结构：~/.dsh/storages/dsh_session_tag__{workspaceId}.json
 *
 * @module dsh-session-tag-manage-host
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  WORKSPACE_LIST_TAG_ROUTE,
  WORKSPACE_TAG_SET_ROUTE,
  WORKSPACE_SESSION_TAG_ROUTE,
  type SessionTagEntry,
  type SessionEventTagItem,
} from './contract.js'
import {
  readWorkspaceTags,
  writeWorkspaceTags,
  deleteWorkspaceFile,
  dshRpcCall,
  fetchAllSessionEvents,
  foldStats,
  extractUserMessages,
  extractFileOperations,
  extractSessionTitle,
  splitTurns,
  classifyRoundEndReason,
  EventType,
} from './utils/index.js'
import type { TurnStartData } from './utils/index.js'

/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-tag-manage-host'

/** 注入依赖列表 */
export const inject = ['webServer']

/**
 * 通用 JSON 响应辅助函数
 */
function jsonResponse(res: any, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

/**
 * 读取 POST 请求体
 */
async function readBody(req: any): Promise<string> {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

/**
 * 解析 RPC 信封：从请求体中提取 payload 和 rpcId
 *
 * 支持两种格式：
 * 1. DSH RPC 信封：{ type: 'client-request', rpcId, method, payload }
 * 2. 简单 JSON：{ workspaceId: '...' }（直接作为 payload 返回）
 */
async function parseRpcEnvelope<T>(req: any): Promise<{ payload: T; rpcId: string }> {
  const raw = await readBody(req)
  let parsed: any
  try { parsed = JSON.parse(raw) } catch { parsed = {} }

  // DSH RPC 信封格式
  if (parsed && typeof parsed === 'object' && parsed.type === 'client-request' && parsed.payload) {
    return { payload: parsed.payload as T, rpcId: parsed.rpcId ?? '' }
  }

  // 简单 JSON 格式（兼容旧客户端）
  return { payload: parsed as T, rpcId: '' }
}

/**
 * 用 RPC 信封包装响应
 *
 * 如果请求带了 rpcId，则返回标准信封格式；
 * 否则返回简单 JSON 格式（兼容旧客户端）。
 */
function rpcResponse(res: any, rpcId: string, data: unknown) {
  if (rpcId) {
    jsonResponse(res, 200, {
      type: 'server-response',
      rpcId,
      result: data,
    })
  } else {
    jsonResponse(res, 200, data)
  }
}

/**
 * 插件应用函数
 * @param ctx - Cordis 上下文
 */
export function apply(ctx: Context) {
  // dsh-host-webserver 的 register 接收路由对象 { kind, path, handler }，
  // handler 收到的是 node:http 的 IncomingMessage / ServerResponse（没有 res.json 方法），
  // 因此需要自行 writeHead + end 输出 JSON。
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-session-host-test',
    handler: async (req, res) => {
      // 解析 URL 查询参数
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const folderActive = url.searchParams.get('folderActive')
      const sessionCurrent = url.searchParams.get('sessionCurrent')
      const testWrite = url.searchParams.get('testWrite')

      const result: Record<string, unknown> = {
        serverTime: Date.now(),
        folderActive,
        sessionCurrent,
      }

      // 测试写入：创建示例文件验证存储路径
      if (testWrite) {
        const testWsId = testWrite
        const testSession: SessionTagEntry = {
          sessionId: `session-test-${Date.now()}`,
          title: '测试会话',
          sessionCurrentTag: '测试中',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        await writeWorkspaceTags(testWsId, [testSession])
        const items = await readWorkspaceTags(testWsId)
        result.testWrite = {
          workspaceId: testWsId,
          fileCreated: items.length > 0,
          itemsWritten: items.length,
          storagePath: `~/.dsh/storages/dsh_session_tag__${testWsId}.json`,
        }
        console.log(`[SessionTag] 测试写入完成: workspaceId=${testWsId}, items=${items.length}`)
      }

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(result))
    },
  })

  // 工作区会话标签查询路由
  ctx.webServer.register({
    kind: 'exact',
    path: WORKSPACE_LIST_TAG_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      const { payload, rpcId } = await parseRpcEnvelope<{ workspaceId?: string }>(req)
      const { workspaceId } = payload
      if (!workspaceId) {
        jsonResponse(res, 400, { ok: false, error: 'workspace-id-required' })
        return
      }

      try {
        let items = await readWorkspaceTags(workspaceId)
        // 文件不存在时自动创建空 JSON 文件
        if (items.length === 0) {
          await writeWorkspaceTags(workspaceId, [])
        }
        console.log(`[SessionTag] workspace.list.tag 查询成功: workspaceId=${workspaceId}, items=${items.length}`)
        rpcResponse(res, rpcId, { ok: true, value: { items } })
      } catch (err) {
        console.error(`[SessionTag] workspace.list.tag 读取失败:`, err)
        jsonResponse(res, 500, { ok: false, error: 'storage-read-failed' })
      }
    },
  })

  // 工作区会话标签写入路由
  ctx.webServer.register({
    kind: 'exact',
    path: WORKSPACE_TAG_SET_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      const { payload, rpcId } = await parseRpcEnvelope<{
        workspaceId?: string
        sessions?: SessionTagEntry[]
        deleteWorkspace?: boolean
      }>(req)

      const { workspaceId, sessions, deleteWorkspace } = payload
      if (!workspaceId) {
        jsonResponse(res, 400, { ok: false, error: 'workspace-id-required' })
        return
      }
      if (!Array.isArray(sessions)) {
        jsonResponse(res, 400, { ok: false, error: 'sessions-array-required' })
        return
      }

      try {
        // 仅当 deleteWorkspace=true 且 sessions 为空时删除文件
        if (deleteWorkspace === true && sessions.length === 0) {
          await deleteWorkspaceFile(workspaceId)
          console.log(`[SessionTag] 工作区 ${workspaceId} 已删除（deleteWorkspace=true, sessions=[]）`)
        } else {
          await writeWorkspaceTags(workspaceId, sessions)
          console.log(`[SessionTag] workspace.tag.set 写入成功: workspaceId=${workspaceId}, count=${sessions.length}`)
        }

        rpcResponse(res, rpcId, { ok: true, value: { count: sessions.length } })
      } catch (err) {
        console.error(`[SessionTag] workspace.tag.set 写入失败:`, err)
        jsonResponse(res, 500, { ok: false, error: 'storage-write-failed' })
      }
    },
  })

  // 会话事件数据标签查询路由
  // 调用内置 session.history 接口获取事件流，使用 utils 工具整理数据
  ctx.webServer.register({
    kind: 'exact',
    path: WORKSPACE_SESSION_TAG_ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      const { payload, rpcId } = await parseRpcEnvelope<{
        sessionId?: string
        maxMessages?: number
      }>(req)

      const { sessionId, maxMessages } = payload
      if (!sessionId) {
        jsonResponse(res, 400, { ok: false, error: 'session-id-required' })
        return
      }

      try {
        // 通过 dshRpcCall 调用内置 session.history 接口获取事件流
        const dshBaseUrl = `http://127.0.0.1:${process.env.DSH_WEB_PORT ?? 3080}`
        const { events, hasMore, error } = await fetchAllSessionEvents(
          dshBaseUrl,
          sessionId,
          { maxMessages: maxMessages ?? 200 },
        )

        if (error) {
          console.error(`[SessionTag] session.history 调用失败: sessionId=${sessionId}, error=${error}`)
          jsonResponse(res, 500, { ok: false, error: `history-fetch-failed: ${error}` })
          return
        }

        // 使用 utils 工具，按 turn 切分后逐轮整合
        const segments = splitTurns(events)
        const items: SessionEventTagItem[] = segments.map((seg) => {
          const stats = foldStats(seg)
          const userMessageTexts = extractUserMessages(seg)
          const fileOperations = extractFileOperations(seg)
          const title = extractSessionTitle(seg)
          const turnStart = seg.find(
            (e) => e.event.type === EventType.TURN_START,
          )?.event.data as unknown as TurnStartData | undefined
          return {
            sessionId,
            title: title ?? stats.title,
            round: turnStart?.turn ?? 0,
            endReason: classifyRoundEndReason(seg),
            turns: stats.turns,
            userMessages: stats.userMessages,
            assistantMessages: stats.assistantMessages,
            toolCalls: stats.toolCalls,
            userMessageTexts,
            fileOperations,
            startedAt: stats.startedAt,
            updatedAt: stats.updatedAt,
            totalEvents: stats.totalEvents,
          }
        })

        console.log(`[SessionTag] workspace.session.tag 查询成功: sessionId=${sessionId}, events=${events.length}, rounds=${items.length}`)
        rpcResponse(res, rpcId, { ok: true, value: { items, hasMore } })
      } catch (err) {
        console.error(`[SessionTag] workspace.session.tag 查询失败:`, err)
        jsonResponse(res, 500, { ok: false, error: 'session-tag-query-failed' })
      }
    },
  })
}
