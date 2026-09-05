/**
 * 会话级调试开关状态机（宿主端插件 dsh-debugger）
 *
 * `/debugger` 指令（Web/CLI 指令平面）与 headless pre-step 文本兜底共用的
 * **唯一状态权威**：进程内 `Set<sessionId>`，空集 = 全部关闭（默认关闭）。
 *
 * 生命周期语义：进程重启即回到默认关闭，符合"调试默认关闭"的设计约定；
 * 如需跨重启强制开启，可手工将配置文件 `debug.enabled` 置为 true
 * （拦截判定 = 会话级开关 ∪ 配置兜底，见 debug.ts）。
 *
 * @module dsh-debugger/debug-state
 */

/** 单会话运行时的调试开关集合（按 sessionId 隔离） */
export class DebuggerState {
  private readonly enabled = new Set<string>()

  /** 指定会话是否处于调试开启状态；未知会话一律视为关闭 */
  isEnabled(sessionId: string | undefined): boolean {
    if (sessionId === undefined) return false
    return this.enabled.has(sessionId)
  }

  /** 开启指定会话的调试拦截 */
  enable(sessionId: string): void {
    this.enabled.add(sessionId)
  }

  /** 关闭指定会话的调试拦截 */
  disable(sessionId: string): void {
    this.enabled.delete(sessionId)
  }

  /** 会话销毁时清理登记，防止 Set 无界增长（长驻 Web 进程内存治理） */
  drop(sessionId: string): void {
    this.enabled.delete(sessionId)
  }
}
