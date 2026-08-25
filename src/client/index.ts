/**
 * 客户端插件入口：会话标签背景色渲染（CSS 类名定位）+ 每日提醒 + 手动标签编辑。
 *
 * 设计决策（见 docs/design.md 第八章 / 决策 4）：
 * - 会话列表无逐会话行槽位（ui-workspace 渲染进 `sidebar.workspaces` 单槽），因此不注册
 *   槽位组件，改用 **CSS 类名定位**：读投影成品值 → 遍历会话行 DOM 挂插件自有 `stag-*` class
 *   → 注入全局样式（`[data-session-id].stag-*`）。样式选择器只依赖插件自挂 class 与会话行
 *   的 `data-session-id` 属性，不依赖 ui-workspace 内部类名（生产 CSS-module 哈希化风险）。
 * - 投影读取走 `ctx.sessions.list`（`SnapshotStore<SessionListState>`）：每个 `SessionSummary`
 *   携带 `projectionValues`（宿主投影 whole 值随列表快照下发；投影帧到达时列表快照自动更新，
 *   见 dsh-client-runtime `buildListSnapshot` 的 `projectionValues` 读取）。
 * - `MutationObserver` 监听行 DOM 增删（虚拟化懒渲染兜底）+ 订阅列表快照变化，变化后经 rAF
 *   合并重新 apply，规避渲染时序竞态并限制高频重扫。
 * - 定位 / 样式常量与读取工具抽到 position.ts（背景色渲染与标签编辑组件共用）。
 *
 * 附属能力（同挂本入口，受各自开关控制）：
 * - 每日 17:00 会话梳理桌面提醒 → setupDailyReminder（src/client/reminder.ts）
 * - Web UI 手动标签编辑（悬停下拉）→ setupTagEditor（src/client/tagEditor.tsx）
 */
import type { ClientContext, ISessions, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { Config } from '../config.ts'
import '../projection-types.ts' // 副作用导入：激活 SessionProjectionMap 声明合并（typecheck）
import { setupDailyReminder } from './reminder.ts'
import { setupTagEditor } from './tagEditor.ts'
import {
  ALL_TAG_CLASSES,
  TAG_CLASS,
  TAG_STYLES,
  clientSessions,
  locateSessionRows,
  readTag,
} from './position.ts'

export const name = 'session-tag-manage-client'
// sessions：会话列表快照（投影成品值经列表快照下发）
// remote：手动标签编辑经 Typert RPC 桩调用宿主（由 dsh-client-runtime 提供）
export const inject = ['sessions', 'remote']
export { Config } // 客户端插件声明配置 Schema，使 apply 第二个参数注入 config

/** 遍历会话行，按投影标签挂 `stag-*` class（先清后挂）。 */
function applyTagClasses(ctx: ClientContext): void {
  const list = clientSessions(ctx).list.getSnapshot() as SessionListState
  for (const { row, sessionId } of locateSessionRows(list)) {
    row.classList.remove(...ALL_TAG_CLASSES)
    if (!sessionId) continue
    const tag = readTag(list.byId[sessionId as SessionId])
    if (tag) row.classList.add(TAG_CLASS[tag])
  }
}

/** 客户端插件 apply：注入样式 + 订阅投影/列表变化 + MutationObserver 兜底 + 每日提醒 + 手动编辑 + 生命周期清理。 */
export function apply(ctx: ClientContext, config: Config): void {
  // 1. 注入插件自有全局样式（幂等：先清旧再挂新，防 HMR / 重复装载叠加）
  document.querySelectorAll('style[data-stag-manage]').forEach((el) => el.remove())
  const style = document.createElement('style')
  style.setAttribute('data-stag-manage', 'true')
  style.textContent = (Object.keys(TAG_STYLES) as (keyof typeof TAG_STYLES)[])
    .filter((tag) => TAG_STYLES[tag] !== '')
    .map((tag) => `[data-session-id].${TAG_CLASS[tag]} { ${TAG_STYLES[tag]} }`)
    .join('\n')
  document.head.appendChild(style)

  // 2. rAF 合并：订阅列表快照（含投影值）变化 + observer 回调，一帧内只重扫一次
  let raf = 0
  const scheduleApply = (): void => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      retargetObserver()
      applyTagClasses(ctx)
    })
  }

  // 3. MutationObserver：会话行 DOM 增删兜底（虚拟化懒渲染插入新行，列表快照未必变化）。
  //    观察范围随定位结果收窄到行父容器，避免全文档无关 DOM 变更（消息流 / 日志等）触发重扫。
  const observer = new MutationObserver(scheduleApply)
  let observedTarget: Node | null = null
  function retargetObserver(): void {
    const firstRow = document.querySelector<HTMLElement>('[data-session-id]')
    const target = firstRow?.parentElement ?? document.body
    if (target === observedTarget) return
    if (observedTarget !== null) observer.disconnect()
    observedTarget = target
    observer.observe(target, { childList: true, subtree: true })
  }

  // 4. 首次应用 + 订阅列表快照
  retargetObserver()
  applyTagClasses(ctx)
  const unsubscribe = clientSessions(ctx).list.subscribe(scheduleApply)

  // 5. 每日 17:00 会话梳理桌面提醒（开关关闭时内部直接返回）
  setupDailyReminder(ctx, config)

  // 6. Web UI 手动标签编辑（开关关闭时内部直接返回，不渲染入口）
  setupTagEditor(ctx, config)

  // 7. 插件卸载清理
  ctx.effect(
    () => () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      unsubscribe()
      observer.disconnect()
      style.remove()
    },
    'session-tag-manage.client.dispose',
  )
}
