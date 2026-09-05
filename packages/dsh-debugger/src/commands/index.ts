/**
 * `/debugger` 自定义指令（宿主端插件 dsh-debugger）
 *
 * Web/CLI 指令平面的唯一入口：经 `ctx.commands.register` 注册后，Web composer
 * 与 CLI 交互式输入框即可发现并分派 `/debugger`（已注册指令**不产生模型消息**，
 * 宿主把 `command/run` / `command/done` 生命周期持久化为会话事件）。
 *
 * **开关模型（2026-09-05 重构）**：**全局开关**，非会话级。指令 on/off/status
 * 直接读写 `config.debug.enabled`（唯一写入口 `ConfigStore.setDebugEnabled`：
 * 更新内存 current → flush 落盘 → 跨重启保持），拦截判定只依赖该全局布尔。
 * 默认关闭（装上不拦截，需 `/debugger on` 显式开启）。
 *
 * **可见性（方案C 保留）**：宿主把 handler 结果持久化为 flow 节点，但部分运行时
 * 客户端不渲染该节点 → 指令执行在 Web 前端可能"无响应"。故 handler 在更新开关后
 * **同步向当前会话追加一条 `assistant/message` 确认气泡**（走普通消息通道，与拦截
 * 回复同构、全端 100% 可见）。已知副作用：该消息进入会话日志与后续模型上下文
 * （非空 content 属 surface 事件）——每次开关一条短消息，可接受性经用户确认。
 * 全局开关不依赖会话存在：无会话上下文时仍执行开关（仅跳过气泡追加）。
 *
 * headless 单发 prompt 无指令适配器，`/debugger ...` 以普通用户消息直达，
 * 由 index.ts 的 pre-step 文本扫描兜底；两条通路共享同一套动作解析
 * （resolveDebuggerAction，含中文别名）与同一个全局写入口 setDebugEnabled。
 *
 * 参考框架实现：git-source/deepseek-harness/packages/compaction/command-compact。
 *
 * @module dsh-debugger/commands
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ConfigStore } from '../config.js'

/** 用法提示（参数不合法时返回给前端展示） */
const USAGE = 'Usage: /debugger [on|off|status]（无参数等同 on；全局生效，默认开启）'

/** /debugger 的合法动作 */
export type DebuggerAction = 'on' | 'off' | 'status'

/** 参数文本 → 动作（英文 + 中文别名）；空串 = on；非法返回 undefined */
const ACTION_BY_ARG: Record<string, DebuggerAction> = {
  on: 'on',
  off: 'off',
  status: 'status',
  开: 'on',
  开启: 'on',
  打开: 'on',
  关: 'off',
  关闭: 'off',
  状态: 'status',
  当前状态: 'status',
}

/**
 * 解析 /debugger 参数文本 → 动作。
 * 空串返回 on（无参=开，用户确认的默认行为）；别名见 ACTION_BY_ARG；
 * 其余一律 undefined（指令平面判为用法错误；headless 兜底则视为普通消息不处理）。
 */
export function resolveDebuggerAction(argText: string): DebuggerAction | undefined {
  const arg = argText.trim().toLowerCase()
  if (arg === '') return 'on'
  return ACTION_BY_ARG[arg]
}

/** 指令平面参数解析：合法返回动作；非法返回 'error'（触发 USAGE 文案） */
export function parseDebuggerInput(rawInput: string): { action: DebuggerAction } | { action: 'error' } {
  const action = resolveDebuggerAction(rawInput)
  return action === undefined ? { action: 'error' } : { action }
}

/** 追加一条 assistant 确认气泡到会话（方案C：借道消息通道保证前端可见） */
function appendDebugNotice(
  session: unknown,
  text: string,
  logger: Context['logger'],
): void {
  try {
    const s = session as {
      events?: readonly SessionEvent[]
      append?: (type: string, data: unknown, opts?: unknown) => unknown
    }
    if (typeof s?.append !== 'function') return
    // 追加归属到日志中最后一个已存在 turn（无事件时为 0）。turn/step 仅为定位坐标：
    // 客户端 location-index 对 turn 内不存在 step 0 的消息会降级到 turn 级渲染（已实证）。
    let lastTurn = 0
    for (const ev of s.events ?? []) {
      const turn = (ev.data as { turn?: unknown } | undefined)?.turn
      if (ev.type === 'turn/start' && typeof turn === 'number') lastTurn = Math.max(lastTurn, turn)
    }
    s.append(
      'assistant/message',
      {
        turn: lastTurn,
        step: 0,
        message: {
          id: `dbg-${randomUUID()}`,
          role: 'assistant',
          content: [{ type: 'text', text }],
        },
      },
      { surfaceOp: 'append' },
    )
  } catch (error) {
    // 追加失败不影响开关状态与指令结果：仅告警
    logger?.warn('dsh-debugger: failed to append debug notice: %o', error)
  }
}

/**
 * 执行一次 /debugger 调用：读写**全局**调试开关（config.debug.enabled，落盘持久），
 * 返回面向用户的确认文本，并向当前会话追加 assistant 确认气泡（方案C 可见性兜底）。
 *
 * 全局开关不要求会话存在：`invocation.agent?.session` 缺失时仍执行开关并返回
 * success（仅跳过气泡追加）。
 */
export function executeDebuggerCommand(
  invocation: CommandInvocation,
  store: ConfigStore,
  logger?: Context['logger'],
): CommandResult {
  const session = invocation.agent?.session
  const parsed = parseDebuggerInput(invocation.rawInput)
  if (parsed.action === 'error') {
    if (session) appendDebugNotice(session, `[debugger] ${USAGE}`, logger)
    return { kind: 'error', text: USAGE }
  }
  let text: string
  if (parsed.action === 'on') {
    store.setDebugEnabled(true)
    text =
      `[debugger] 调试模式已全局开启。` +
      `接下来每轮 LLM 调用将被拦截：请求参数落盘临时文件，并在回复中显示文件路径。` +
      `关闭：/debugger off`
  } else if (parsed.action === 'off') {
    store.setDebugEnabled(false)
    text = `[debugger] 调试模式已全局关闭，LLM 调用将透传真实接口。`
  } else {
    // status：读取全局开关（与 debug.ts 拦截判定同口径）
    const on = store.get().debug.enabled
    text = `[debugger] 调试模式（全局）：${on ? '开启' : '关闭'}。`
  }
  if (session) appendDebugNotice(session, text, logger)
  return { kind: 'success', text }
}

/**
 * 安装 /debugger 指令注册。
 *
 * 注册失败（如与宿主既有指令重名）仅告警、不阻断插件启动：
 * 指令平面缺失时 headless 兜底路径仍可工作。
 *
 * @param ctx - 插件上下文（须可 inject `commands`）
 * @param store - 配置存储（on/off 写全局 enabled 并落盘；status 读取）
 */
export function installDebuggerCommand(ctx: Context, store: ConfigStore): void {
  try {
    ctx.commands.register({
      name: 'debugger',
      description: '开启/关闭 LLM 调试拦截（全局生效，默认开启；on|off|status 或 开启/关闭/状态，无参数等同 on）',
      input: { hint: '[on|off|status]' },
      handler: (invocation: CommandInvocation): CommandResult =>
        executeDebuggerCommand(invocation, store, ctx.logger),
    })
  } catch (error) {
    ctx.logger?.warn('dsh-debugger: failed to register /debugger command (name conflict?): %o', error)
  }
}
