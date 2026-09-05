/**
 * 宿主端插件入口：dsh-debugger（纯调试插件）
 *
 * 职责单一：全局调试开关（config.debug.enabled）+ `/debugger [on|off|status]`
 * 指令 + llm/stream 拦截（sanitize → 记录参数 → 合成响应流）。
 *
 * 配置落盘仅保留与本插件相关的两项（dsh-debugger-config.json）：
 * - version：配置结构版本
 * - debug：调试模式配置（经 setDebugEnabled 唯一写入口改写并持久化）
 *
 * 旧版 dsh-skills-auto-enable 遗留的技能可见性子系统（shadow / 关键字规则 /
 * skills/skillsLog/usage/hidden 审计）已全部移除，不再写入任何内容。
 *
 * @module dsh-debugger
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { ConfigStore } from './config.js'
import { installDebugMode } from './debug.js'
import { installDebuggerCommand, resolveDebuggerAction, type DebuggerAction } from './commands/index.js'

export const name = 'dsh-debugger'
// 仅注入宿主根插件可直达的服务：agents / skills / commands。
// llm/stream 与 storage 不可在宿主根插件 inject（同 agent.ctx.skills 限制，二者均在嵌套
// ctx 上提供）；但 llm/stream 事件会冒泡到宿主根，故以 ctx.on 监听拦截；storage 则通过
// 受 try/catch 保护的 ctx.storage 访问走 KV 单元，不可达时回退 os.tmpdir 临时文件。
// commands 承载 /debugger 指令注册（Web/CLI 指令平面唯一入口，不产生模型消息）。
export const inject = ['agents', 'skills', 'commands']

/** agent/pre-step 载荷（框架以字符串键事件下发，此处结构化以便类型安全） */
interface PreStepPayload {
  agent: Agent
  messages: AgentMessage[]
  signal: unknown
}
type NextFn = () => Promise<PreStepDecision>
interface AgentMessage {
  role?: string
  source?: { kind?: string }
  content?: { type: string; text: string }[]
}

/**
 * 匹配"整条消息即 /debugger 指令"的用户文本（headless 兜底判定）。
 *
 * 仅当某条用户消息整体形如 `/debugger [on|off|status]` 时才视为指令，
 * 避免把"介绍一下 /debugger 指令"之类的普通提问误判为开关操作。
 * Web/CLI 场景指令已被指令平面消费、不会产生同文本模型消息，故此处
 * 天然只在 headless 生效，无需环境判断。
 */
const DEBUGGER_LINE_RE = /^\/debugger(?:\s+(\S+))?$/i

/** 判定本轮用户消息是否为 /debugger 兜底指令；返回动作或 undefined（非指令） */
export function debuggerFallbackAction(messages: AgentMessage[]): DebuggerAction | undefined {
  for (const m of messages) {
    const isUser = m.role === 'user' || m.source?.kind === 'user'
    if (!isUser) continue
    for (const b of m.content ?? []) {
      if (b.type !== 'text') continue
      const match = DEBUGGER_LINE_RE.exec(b.text.trim())
      if (!match) continue
      // 参数解析与指令平面共用（含中文别名）；无参/非法口径天然一致：
      // undefined = 不是合法动作 → 不当作指令处理，交由正常流程
      return resolveDebuggerAction(match[1] ?? '')
    }
  }
  return undefined
}

/** 插件应用函数 */
export function apply(ctx: Context): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = resolve(here, '..', 'dsh-debugger-config.json')
  const store = new ConfigStore(file)
  // fs.watch 热更新：文件变更后指令平面与拦截判定读取最新全局开关
  store.watch(() => {})

  // 调试模式：全局开关（config.debug.enabled，默认开启，与旧版一致）+ /debugger
  // 指令注册 + llm/stream 拦截。指令/兜底经 store.setDebugEnabled 改写并落盘。
  installDebuggerCommand(ctx, store)
  installDebugMode(ctx, store)

  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: NextFn) => {
    const sid = payload.agent?.session?.id
    // headless 兜底（方案 B）：单发 prompt 无指令适配器，`/debugger ...` 以普通
    // 用户消息直达。命中即改写**全局**开关（store.setDebugEnabled，内存+落盘）：
    //   on（含无参）→ 透传本轮：全局即时生效，本轮 llm/stream 拦截回复即"已开启"确认；
    //   off → 置 false 后 reject 静默吞掉，避免指令文本进模型（PreStepDecision reject
    //   无文本字段，无法回执，属框架已知限制）；
    //   status → reject 静默（全局状态可经 /debugger status 指令平面查询）。
    if (sid !== undefined) {
      const action = debuggerFallbackAction(payload.messages)
      if (action === 'on') store.setDebugEnabled(true)
      else if (action === 'off') {
        store.setDebugEnabled(false)
        return { kind: 'reject' }
      } else if (action === 'status') {
        return { kind: 'reject' }
      }
    }
    return next()
  })
}
