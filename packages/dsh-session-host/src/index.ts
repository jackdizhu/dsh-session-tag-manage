/**
 * 宿主端插件入口
 *
 * 通过 ctx.webServer 注册 /dsh-session-host-test HTTP 路由，
 * 无参返回当前服务端时间戳。
 *
 * @module dsh-session-tag-manage-host
 */

import type { Context } from '@deepseek-ai/cordis'

/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-tag-manage-host'

/** 注入依赖列表 */
export const inject = ['webServer']

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
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ serverTime: Date.now() }))
    },
  })
}
