/**
 * 宿主端插件入口
 *
 * 通过 ctx.webServer 注册 /dsh-session-host-test HTTP 路由，
 * 无参返回当前服务端时间戳。
 *
 * @module dsh-session-base-host
 */

import type { Context } from '@deepseek-ai/cordis'

/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-base-host'

/** 注入依赖列表 */
export const inject = ['webServer']

/**
 * 插件应用函数
 * @param ctx - Cordis 上下文
 */
export function apply(ctx: Context) {
  ctx.webServer.register('/dsh-session-host-test', (_req, res) => {
    res.json({ serverTime: Date.now() })
  })
}
