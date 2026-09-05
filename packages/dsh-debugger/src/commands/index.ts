/**
 * `/debugger` 自定义指令（宿主端插件 dsh-debugger）
 *
 * Web/CLI 指令平面的唯一入口：经 `ctx.commands.register` 注册后，Web composer
 * 与 CLI 交互式输入框即可发现并分派 `/debugger`（已注册指令**不产生模型消息**，
 * 宿主把 `command/run` / `command/done` 生命周期持久化为会话事件，Web 端渲染为
 * 持久 flow 节点——即 handler 返回的 `text` 就是前端展示内容）。
 *
 * headless 单发 prompt 无指令适配器，`/debugger ...` 以普通用户消息直达，
 * 由 index.ts 的 pre-step 文本扫描兜底；两条通路共享同一个 DebuggerState。
 *
 * 参考框架实现：git-source/deepseek-harness/packages/compaction/command-compact。
 *
 * @module dsh-debugger/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { DebuggerState } from '../debug-state.js'
import type { ConfigStore } from '../config.js'

/** 用法提示（参数不合法时返回给前端展示） */
const USAGE = 'Usage: /debugger [on|off|status]（无参数等同 on；会话级生效，默认关闭）'

/** /debugger 的合法动作 */
export type DebuggerAction = 'on' | 'off' | 'status'

/**
 * 解析 /debugger 参数：空 = on（用户确认的默认行为）；支持 on | off | status；
 * 其余一律判为用法错误。
 */
export function parseDebuggerInput(rawInput: string): { action: DebuggerAction } | { action: 'error' } {
  const arg = rawInput.trim().toLowerCase()
  if (arg === '') return { action: 'on' }
  if (arg === 'on' || arg === 'off' || arg === 'status') return { action: arg }
  return { action: 'error' }
}

/**
 * 执行一次 /debugger 调用：更新会话级状态机并返回面向用户的确认文本。
 * 文本经指令平面回传：Web 端渲染为持久 flow 节点，CLI 打印到终端。
 */
export function executeDebuggerCommand(
  invocation: CommandInvocation,
  state: DebuggerState,
  store: ConfigStore,
): CommandResult {
  const sessionId: string | undefined = invocation.agent?.session?.id
  if (sessionId === undefined) {
    return { kind: 'error', text: 'debugger command requires a session context.' }
  }
  const parsed = parseDebuggerInput(invocation.rawInput)
  if (parsed.action === 'error') return { kind: 'error', text: USAGE }
  if (parsed.action === 'on') {
    state.enable(sessionId)
    return {
      kind: 'success',
      text: `Debugger enabled for session ${sessionId}. 下一轮起 LLM 调用将被拦截，请求参数落盘临时文件。`,
    }
  }
  if (parsed.action === 'off') {
    state.disable(sessionId)
    return { kind: 'success', text: `Debugger disabled for session ${sessionId}.` }
  }
  // status：有效状态 = 会话级开关 ∪ 配置文件手工兜底（与 debug.ts 拦截判定同口径）
  const on = state.isEnabled(sessionId) || store.get().debug.enabled
  return { kind: 'success', text: `Debugger is ${on ? 'ON' : 'OFF'} for session ${sessionId}.` }
}

/**
 * 安装 /debugger 指令注册。
 *
 * 注册失败（如与宿主既有指令重名）仅告警、不阻断插件启动：
 * 指令平面缺失时 headless 兜底路径仍可工作。
 *
 * @param ctx - 插件上下文（须可 inject `commands`）
 * @param state - 会话级开关状态机（与 pre-step 兜底共享）
 * @param store - 配置存储（status 展示需读取 debug.enabled 兜底值）
 */
export function installDebuggerCommand(ctx: Context, state: DebuggerState, store: ConfigStore): void {
  try {
    ctx.commands.register({
      name: 'debugger',
      description: '开启/关闭 LLM 调试拦截（会话级，默认关闭；on|off|status，无参数等同 on）',
      input: { hint: '[on|off|status]' },
      handler: (invocation: CommandInvocation): CommandResult =>
        executeDebuggerCommand(invocation, state, store),
    })
  } catch (error) {
    ctx.logger?.warn('dsh-debugger: failed to register /debugger command (name conflict?): %o', error)
  }
}
