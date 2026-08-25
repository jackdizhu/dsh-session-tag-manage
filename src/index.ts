/**
 * 宿主入口：事件监听与计时编排。
 *
 * 职责：
 * - 监听 `session/event`：`turn/end` 异常 reason 即时打标、completed 延迟打标；
 *   `turn/start` 取消旧计时并回 `in_progress`。
 * - 会话销毁时回收该会话计时器；插件卸载时回收全部计时器。
 *
 * 说明：
 * - 本版本 Cordis 无 `dispose` 事件，插件卸载清理改用 `ctx.effect` disposer。
 * - 投影注册（`registerTagProjection`）在 apply 内显式调用，随插件生命周期挂载。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Config } from './config.ts'
import { SessionTagger } from './tagger.ts'
import { registerTagProjection } from './projection.ts'
import { registerTagOverrideService } from './override.ts'
import './events.ts' // 副作用导入：激活 SessionEventMap 声明合并

export const name = 'session-tagger'
// sessions：手动标签更新服务（sessionTagOverride.set 需读 ctx.sessions）；由 dsh-session 提供
export const inject = ['llm', 'sessionProjections', 'sessions']

/** turn/end 中判定为异常终止的 reason 集合（其余为 completed 正常结束）。 */
const ABNORMAL_TURN_END_REASONS = new Set([
  'error',
  'max-tokens',
  'aborted',
  'blocked',
  'interrupted',
])

/** 插件 apply：注册事件监听与生命周期清理。 */
export function apply(ctx: Context, config: Config): void {
  // 注册会话标签投影（客户端背景色渲染的数据源）
  registerTagProjection(ctx)

  // 注册手动标签更新服务（Web UI 经 Typert RPC 调 sessionTagOverride.set）
  registerTagOverrideService(ctx, config)

  const tagger = new SessionTagger(ctx, config)

  ctx.on(
    'session/event',
    (session: Session, event: SessionEvent) => {
      if (event.type === 'turn/end') {
        const reasonKind = event.data.reason.kind
        if (ABNORMAL_TURN_END_REASONS.has(reasonKind)) {
          // 异常终止：即时打标，不等 7 分钟
          tagger.markImmediately(session, 'abnormal_end', `turn/end reason ${reasonKind}`)
        } else {
          // 正常完成：启动 / 重置延迟分析计时
          tagger.schedule(session, config.delayMs)
        }
        return
      }
      if (event.type === 'turn/start') {
        // 新轮次开始：取消旧计时并回 in_progress（豁免手动标签锁定，新轮次重置锁定）
        tagger.markImmediately(session, 'in_progress', 'new turn started', { ignoreLock: true })
      }
    },
  )

  // 会话销毁时回收该会话的计时器，不留幽灵回调
  ctx.on('session/disposed', (session: Session) => {
    tagger.cancel(session.id)
  })

  // 插件卸载：经 ctx.effect 注册 disposer 回收全部计时器
  ctx.effect(
    () => () => {
      tagger.dispose()
    },
    'session-tagger.dispose',
  )
}
