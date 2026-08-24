/**
 * 会话标签手动编辑组件（客户端，src/client/tagEditor.ts）。
 *
 * 说明：spec / 设计文档写为 `tagEditor.tsx`，此处落地为 `tagEditor.ts`（无 JSX）——
 * 设计决策 4 / 决策 8 弃用 React 槽位组件，改用 CSS 类名定位 + 原生 DOM 注入（与背景色
 * 渲染同源，共享 src/client/position.ts）；本插件无 React 依赖、tsconfig 未开 `--jsx`，
 * 故以纯 DOM 实现（SRC 模式适配，文件名从 .tsx 收敛为 .ts）。
 *
 * 需求（spec manual-tag-update）：
 * - 随会话行悬停注入下拉：列出 5 个合法标签、当前标签高亮；
 *   `source === 'user-override'` 时显示"手动"徽标。
 * - 切换经 Typert RPC 桩调用宿主 `sessionTagOverride.set(sessionId, tag)`；
 *   失败（开关关闭 / 非法值 / 会话不存在 / RPC 缺省）保留原值并提示。
 * - `manualTagUpdateEnabled === false` 时不渲染编辑入口（setupTagEditor 提前返回）。
 *
 * 实现：
 * - 单个悬浮菜单元素挂 `document.body`（fixed 定位），经文档级 mouseover/mouseout 事件委托
 *   跟踪会话行悬停；从行内移入菜单 / 行内移动不关闭，移出两者才关闭。
 * - 每次打开按最新列表快照填充菜单（RPC 成功后投影经宿主事件回传，背景色由 index.ts 的
 *   applyTagClasses 同步；菜单在下次打开时反映新标签）。
 * - 生命周期经 `ctx.effect` 托管：卸载移除菜单元素与监听器。
 */
import type {
  ClientContext,
  SessionId,
  SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { Config } from '../config'
import { VALID_TAGS } from '../events'
import type { SessionTag } from '../events'
import type { TagOverrideResult } from '../override'
import { clientSessions, readTagProjection } from './position'
import { sessionTagOverrideRpc } from './typert-stubs'

/** 标签 → 中文显示名（下拉选项与当前标签展示）。 */
const TAG_LABELS: Record<SessionTag, string> = {
  in_progress: '进行中',
  abnormal_end: '异常终止',
  waiting: '等待确认',
  completed: '已完成',
  invalid: '无效会话',
}

/** 宿主拒绝原因 → 中文提示（未命中时回退原文）。 */
function reasonText(result: TagOverrideResult): string {
  switch (result.reason) {
    case 'manual tag update disabled':
      return '手动标签更新已关闭'
    case 'invalid tag':
      return '标签值不合法'
    case 'session not found':
      return '会话不存在'
    default:
      return result.reason ?? '未知原因'
  }
}

/**
 * 注册 Web UI 手动标签编辑。
 * 开关 `manualTagUpdateEnabled` 关闭时直接返回（不构建菜单、不注册监听、不渲染入口）。
 * @param ctx - 客户端 Cordis Context（须已注入 sessions 服务）
 * @param config - 插件配置（manualTagUpdateEnabled 为入口总开关）
 */
export function setupTagEditor(ctx: ClientContext, config: Config): void {
  if (!config.manualTagUpdateEnabled) return

  // 幂等：先移除旧菜单与样式（防 HMR / 重复装载叠加）
  document.querySelectorAll('[data-stag-editor]').forEach((el) => el.remove())
  document.querySelectorAll('style[data-stag-editor-style]').forEach((el) => el.remove())

  // 1. 注入编辑器自有样式（不依赖 ui-workspace 内部类名）
  const style = document.createElement('style')
  style.setAttribute('data-stag-editor-style', 'true')
  style.textContent = `
    [data-stag-editor] {
      position: fixed;
      z-index: 2147483000;
      min-width: 132px;
      padding: 6px;
      border-radius: 8px;
      background: #1f2937;
      color: #e5e7eb;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      font-size: 12px;
      line-height: 1.5;
    }
    [data-stag-editor][hidden] { display: none; }
    .stag-editor-head {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 6px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      margin-bottom: 6px;
    }
    .stag-editor-badge {
      padding: 0 5px;
      border-radius: 4px;
      background: #6366f1;
      color: #fff;
      font-size: 11px;
    }
    .stag-opt {
      display: block;
      width: 100%;
      padding: 4px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .stag-opt:hover { background: rgba(255, 255, 255, 0.12); }
    .stag-opt[aria-current='true'] {
      background: rgba(99, 102, 241, 0.35);
      font-weight: 600;
    }
    .stag-editor-hint {
      margin-top: 6px;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.18);
      color: #fca5a5;
    }
    .stag-editor-hint[hidden] { display: none; }
  `
  document.head.appendChild(style)

  // 2. 构建悬浮菜单结构
  const editor = document.createElement('div')
  editor.setAttribute('data-stag-editor', 'true')
  editor.setAttribute('role', 'menu')
  editor.hidden = true

  const head = document.createElement('div')
  head.className = 'stag-editor-head'
  const currentLabel = document.createElement('span')
  currentLabel.className = 'stag-editor-current'
  const badge = document.createElement('span')
  badge.className = 'stag-editor-badge'
  badge.textContent = '手动'
  badge.hidden = true
  head.append(currentLabel, badge)
  editor.appendChild(head)

  const list = document.createElement('div')
  list.className = 'stag-editor-list'
  // 5 个合法标签选项一次建好，打开时切换高亮与禁用状态
  const optionByTag = new Map<SessionTag, HTMLButtonElement>()
  for (const tag of VALID_TAGS) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'stag-opt'
    option.setAttribute('data-tag', tag)
    option.setAttribute('role', 'menuitem')
    option.textContent = TAG_LABELS[tag]
    list.appendChild(option)
    optionByTag.set(tag, option)
  }
  editor.appendChild(list)

  const hint = document.createElement('div')
  hint.className = 'stag-editor-hint'
  hint.hidden = true
  editor.appendChild(hint)

  document.body.appendChild(editor)

  // 3. 打开 / 关闭 / 提示
  let current: { row: HTMLElement; sessionId: string; tag: SessionTag | null } | null = null
  // 防重入：RPC 在途期间置 true，拦截后续点击，避免并发多次 user-override 写入（事件冗余）
  let pending = false

  function openFor(row: HTMLElement, sessionId: string): void {
    if (current?.sessionId === sessionId && current.row === row) return

    // 按最新列表快照填充：当前标签高亮 + 手动徽标
    const list = clientSessions(ctx).list.getSnapshot() as SessionListState
    const projection = readTagProjection(list.byId[sessionId as SessionId])
    const tag = projection?.tag ?? null
    const source = projection?.source ?? null
    current = { row, sessionId, tag }

    currentLabel.textContent = tag ? `当前：${TAG_LABELS[tag]}` : '当前：未打标'
    badge.hidden = source !== 'user-override'
    for (const [candidate, option] of optionByTag) {
      option.setAttribute('aria-current', candidate === tag ? 'true' : 'false')
      option.disabled = candidate === tag // 当前标签不可重复点击
    }
    hint.hidden = true
    hint.textContent = ''

    // 定位到行下方（fixed 相对视口）
    const rect = row.getBoundingClientRect()
    editor.style.top = `${rect.bottom + 4}px`
    editor.style.left = `${rect.left}px`
    editor.hidden = false
  }

  function close(): void {
    current = null
    editor.hidden = true
  }

  function showHint(text: string): void {
    hint.textContent = text
    hint.hidden = false
  }

  // 4. RPC 调用：成功关闭（投影随宿主事件回传自动同步），失败保留原值并提示
  async function setTag(sessionId: string, tag: SessionTag): Promise<void> {
    if (pending) return // 防重入：RPC 在途
    pending = true
    // 在途禁用全部选项，防重复点击
    for (const [, option] of optionByTag) option.disabled = true
    try {
      const rpc = sessionTagOverrideRpc(ctx)
      if (!rpc) {
        showHint('标签服务不可用（RPC 未挂载）')
        return
      }
      let result: Awaited<ReturnType<typeof rpc.set>>
      try {
        result = await rpc.set(sessionId, tag)
      } catch (error) {
        showHint(`调用异常：${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (!result.ok) {
        // RPC 失败分支的 message 为协议保证字段；防御：缺失时回退原文（系统边界输入不可全信）
        showHint(`调用失败：${result.error?.message ?? '未知 RPC 错误'}`)
        return
      }
      if (!result.value.ok) {
        showHint(`拒绝：${reasonText(result.value)}`)
        return
      }
      close()
    } finally {
      // 恢复选项可用态：成功时菜单已隐藏，下次 openFor 重设；失败时恢复"当前标签禁用、其余可用"
      pending = false
      for (const [candidate, option] of optionByTag) {
        option.disabled = candidate === current?.tag
      }
    }
  }

  // 选项点击：切换标签
  for (const [tag, option] of optionByTag) {
    option.addEventListener('click', () => {
      if (!current) return
      void setTag(current.sessionId, tag)
    })
  }

  // 5. 文档级事件委托：跟踪会话行悬停（命名处理器，便于卸载移除）
  const onMouseOver = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (!(target instanceof Element)) return
    if (editor.contains(target)) return // 已在编辑器内：不重开
    const row = target.closest<HTMLElement>('[data-session-id]')
    if (!row) return
    const sessionId = row.getAttribute('data-session-id')
    if (!sessionId) return
    openFor(row, sessionId)
  }

  const onMouseOut = (event: MouseEvent): void => {
    if (!current) return
    const target = event.target as Node | null
    const next = event.relatedTarget as Node | null
    // 从当前行或编辑器移出，且未移入另一方 → 关闭（行内 / 行↔菜单互移保持打开）
    const stays = next !== null && (editor.contains(next) || current.row.contains(next))
    if (target && (current.row.contains(target) || editor.contains(target)) && !stays) {
      close()
    }
  }

  const onScroll = (): void => close() // 滚动时锚点位置变化，关闭避免停留在过期坐标

  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('mouseout', onMouseOut)
  window.addEventListener('scroll', onScroll, true)

  // 6. 插件卸载清理
  ctx.effect(
    () => () => {
      current = null
      document.removeEventListener('mouseover', onMouseOver)
      document.removeEventListener('mouseout', onMouseOut)
      window.removeEventListener('scroll', onScroll, true)
      editor.remove()
      style.remove()
    },
    'session-tag-manage.tag-editor.dispose',
  )
}
