/**
 * 宿主端插件入口
 *
 * 通过 ctx.webServer 注册 HTTP 路由：
 * - /dsh-session-host-test：无参返回当前服务端时间戳
 * - /dsh-session-tag-manage/workspace.list.tag：按工作区查询会话标签
 * - /dsh-session-tag-manage/workspace.tag.set：按工作区写入会话标签
 *
 * 存储结构：~/.dsh/storages/dsh_session_tag__{workspaceId}.json
 *
 * @module dsh-session-tag-manage-host
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  WORKSPACE_LIST_TAG_ROUTE,
  WORKSPACE_TAG_SET_ROUTE,
  type SessionTagEntry,
} from './contract.js'
import {
  readWorkspaceTags,
  writeWorkspaceTags,
  deleteWorkspaceFile,
} from './utils/index.js'

/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-tag-manage-host'

/** 注入依赖列表 */
export const inject = ['webServer']

/**
 * 读取 POST 请求体
 */
async function readBody(req: any): Promise<string> {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

/**
 * 通用 JSON 响应辅助函数
 */
function jsonResponse(res: any, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
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

      let parsed: { workspaceId?: string }
      try { parsed = JSON.parse(await readBody(req)) } catch { parsed = {} }

      const { workspaceId } = parsed
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
        jsonResponse(res, 200, { ok: true, value: { items } })
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

      let parsed: { workspaceId?: string; sessions?: SessionTagEntry[]; deleteWorkspace?: boolean }
      try { parsed = JSON.parse(await readBody(req)) } catch { parsed = {} }

      const { workspaceId, sessions, deleteWorkspace } = parsed
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

        jsonResponse(res, 200, { ok: true, value: { count: sessions.length } })
      } catch (err) {
        console.error(`[SessionTag] workspace.tag.set 写入失败:`, err)
        jsonResponse(res, 500, { ok: false, error: 'storage-write-failed' })
      }
    },
  })
}
