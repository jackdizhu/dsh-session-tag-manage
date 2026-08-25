/**
 * 客户端会话行定位与标签样式共享工具（src/client/position.ts）。
 *
 * 供两块客户端功能复用：
 * - 背景色渲染（src/client/index.ts）：遍历会话行挂 `stag-*` class 注入样式
 * - 标签编辑组件（src/client/tagEditor.tsx）：悬停会话行注入下拉菜单
 *
 * 设计决策（docs/design.md 第八章 / 决策 4）：会话列表无逐会话行槽位（ui-workspace 渲染进
 * `sidebar.workspaces` 单槽），因此不注册槽位组件，统一用 **CSS 类名定位** —— 读投影成品值
 * → 遍历会话行 DOM（`data-session-id` 属性优先）→ 注入插件自有 `stag-*` class / 编辑器。
 * 样式与定位只依赖插件自挂 class 与会话行的 `data-session-id` 属性，不依赖 ui-workspace
 * 内部类名（生产 CSS-module 哈希化风险）。
 */
import type {
  ClientContext,
  ISessions,
  SessionId,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionTag } from '../events.ts'
import type { TagProjectionValue } from '../projection-types.ts'
import '../projection-types.ts' // 副作用导入：激活 SessionProjectionMap 声明合并（typecheck）

/** 标签 → 插件自有 CSS class 名（不依赖 ui-workspace 内部类名，规避生产 CSS-module 哈希化）。 */
export const TAG_CLASS: Record<SessionTag, string> = {
  in_progress: 'stag-running',
  abnormal_end: 'stag-abnormal',
  waiting: 'stag-waiting',
  completed: 'stag-done',
  invalid: 'stag-invalid',
}

/**
 * 标签 → 行内样式声明。
 * abnormal_end（红系）/ waiting（橙系）为重点强调色，用 `!important` 覆盖主题默认背景；
 * completed 绿系淡显；invalid 灰淡；in_progress 走默认样式。
 */
export const TAG_STYLES: Record<SessionTag, string> = {
  in_progress: '',
  abnormal_end: 'background: rgba(239, 68, 68, 0.12) !important; border-left: 3px solid #ef4444;',
  waiting: 'background: rgba(245, 158, 11, 0.12) !important; border-left: 3px solid #f59e0b;',
  completed: 'background: rgba(34, 197, 94, 0.08);',
  invalid: 'opacity: 0.55; background: rgba(107, 114, 128, 0.08);',
}

/** 全部标签 class 值集合：apply 时先清旧 class 再挂新 class，处理标签变更。 */
export const ALL_TAG_CLASSES = Object.values(TAG_CLASS)

/** 兜底定位的会话列表容器选择器（主路径 `[data-session-id]` 缺失时使用）。 */
const ROW_CONTAINER_SELECTOR = '[data-session-list], .dsh-session-list'

/**
 * 类型收窄：宿主 `@deepseek-ai/dsh-session` 与客户端 `@deepseek-ai/dsh-client-runtime/client`
 * 都对 `Context.sessions` 做了声明合并（skipLibCheck 下静默后覆盖，宿主类型胜出）。
 * 客户端运行时实际注入的是 `ISessions` 面（`list` 为 `ObservableSnapshot`），故显式收窄。
 */
export function clientSessions(ctx: ClientContext): ISessions {
  return ctx.sessions as unknown as ISessions
}

/** 读取会话投影成品值（无投影返回 null）。 */
export function readTagProjection(summary: SessionSummary | undefined): TagProjectionValue | null {
  return summary?.projectionValues?.['session-tag'] ?? null
}

/** 读取会话投影中的标签（无投影 / 标签为空返回 null）。 */
export function readTag(summary: SessionSummary | undefined): SessionTag | null {
  return readTagProjection(summary)?.tag ?? null
}

/**
 * 定位会话行 DOM。
 * - 主路径：`[data-session-id]` 属性定位会话行，并按 `list.ids` 过滤（排除非会话行的带 id 元素）。
 * - 兜底：主路径无命中时，用稳定容器选择器 + 行序匹配列表 `ids`。
 */
export function locateSessionRows(
  list: SessionListState,
): Array<{ row: HTMLElement; sessionId: string | null }> {
  const idSet = new Set(list.ids as string[])
  const withId = Array.from(document.querySelectorAll<HTMLElement>('[data-session-id]'))
    .filter((row) => {
      const id = row.getAttribute('data-session-id')
      return id !== null && idSet.has(id)
    })
    .map((row) => ({ row, sessionId: row.getAttribute('data-session-id') }))
  if (withId.length > 0) return withId
  const container = document.querySelector(ROW_CONTAINER_SELECTOR)
  if (!container) return []
  return Array.from(container.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map((row, index) => ({ row, sessionId: list.ids[index] ?? null }))
}
