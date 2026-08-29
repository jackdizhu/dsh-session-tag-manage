/**
 * 客户端插件入口
 *
 * 在 DOM 节点区域创建 Canvas 元素，绘制蓝色矩形块支持点击，
 * 点击后控制台打印点击事件与时间日志。
 *
 * @module dsh-session-tag-manage-client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 日志前缀，便于在浏览器控制台中过滤 */
const TAG = '[SessionTag]'/** 插件名称，符合 Cordis 插件规范 */
export const name = 'dsh-session-tag-manage-client'

/** 注入依赖列表 */
export const inject = ['slots', 'sessions', 'workspaces'] as const

/** 安全查询辅助函数：querySelectorAll 可能在某些环境下返回 undefined */
function safeQueryAll(selector: string): Element[] {
  try {
    const result = document.querySelectorAll(selector)
    return result ? Array.from(result) : []
  } catch {
    return []
  }
}

/** 安全查询辅助函数：querySelector 可能在某些环境下抛异常 */
function safeQuery(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

/**
 * 从 ctx.sessions.selection 获取当前会话 ID
 */
function getCurrentSessionId(ctx: ClientContext): string | null {
  try {
    if (!ctx.sessions?.selection) return null
    const snapshot = ctx.sessions.selection.getSnapshot()
    return snapshot?.sessionId ?? null
  } catch {
    return null
  }
}

/**
 * 获取当前活跃工作区 ID
 * 策略：根据当前会话 ID 在工作区列表中查找所属工作区
 */
function getActiveWorkspaceId(
  workspaces: Array<{ workspaceId: string; sessionIds?: string[] }>,
  sessionId: string | null
): string | null {
  if (!sessionId || !workspaces?.length) return null

  try {
    // 策略1：根据会话 ID 查找所属工作区
    const workspace = workspaces.find(w => w.sessionIds?.includes(sessionId))
    if (workspace) return workspace.workspaceId

    // 策略2：如果找不到，返回第一个工作区（降级）
    // 注意：这不准确，但比返回 null 好
    console.warn(`${TAG} 会话 ${sessionId} 未找到所属工作区，使用第一个工作区降级`)
    return workspaces[0]?.workspaceId ?? null
  } catch {
    return null
  }
}

/**
 * 扫描当前 DOM 中的会话节点信息，打印调试日志
 */
function logSessionNodes(): void {
  // 扫描会话相关 DOM 节点
  const sessionRows = safeQueryAll('[data-session-row]')
  const chatAnchors = safeQueryAll('[data-chat-anchor-key]')
  const conversationScroll = safeQuery('[data-conversation-scroll]')
  const sidebarWorkspaces = safeQuery('[data-sidebar-workspaces]')

  console.groupCollapsed(`${TAG} DOM 节点扫描报告`)
  console.log('session-row 节点数:', sessionRows.length)
  console.log('chat-anchor-key 节点数:', chatAnchors.length)
  console.log('conversation-scroll 容器:', conversationScroll ? '✅ 找到' : '❌ 未找到')
  console.log('sidebar-workspaces 容器:', sidebarWorkspaces ? '✅ 找到' : '❌ 未找到')

  if (sessionRows.length > 0) {
    console.log('session-row 节点详情:', sessionRows.map(el => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      childCount: el.children?.length ?? 0,
      innerHTML: el.innerHTML?.substring(0, 200) + '...',
    })))
  }

  if (chatAnchors.length > 0) {
    console.log('chat-anchor-key 节点详情:', chatAnchors.slice(0, 5).map(el => ({
      tagName: el.tagName,
      anchorKey: el.getAttribute('data-chat-anchor-key'),
      flowKind: el.getAttribute('data-chat-flow-kind'),
      variant: el.getAttribute('data-variant'),
    })))
  }

  // 扫描页面上所有带 data-* 属性的元素（仅列出属性名，避免日志过多）
  const allDataElements = safeQueryAll('*')
  const dataAttrs = new Set<string>()
  allDataElements.forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('data-')) dataAttrs.add(attr.name)
    })
  })
  console.log('页面上所有 data-* 属性:', Array.from(dataAttrs).sort())
  console.groupEnd()
}

/**
 * 插件应用函数
 * @param ctx - 客户端上下文
 */
export function apply(ctx: ClientContext) {
  console.log(`${TAG} 插件 apply 函数被调用`)  
  console.log(`${TAG} ctx 上下文:`, ctx)

  // 检查 ctx 上可用的服务
  console.log(`${TAG} ctx.slots 可用:`, !!ctx.slots)
  if (ctx.slots) {
    console.log(`${TAG} ctx.slots 类型:`, typeof ctx.slots)
    console.log(`${TAG} ctx.slots 的属性:`, Object.keys(ctx.slots))
  }

  // 订阅工作区数据（ObservableSnapshot）
  const unsubscribers: Array<() => void> = []
  if (ctx.workspaces?.list) {
    let lastWorkspacesHash = ''
    const workspacesSnapshot = ctx.workspaces.list.getSnapshot()
    console.log(`${TAG} 初始工作区列表:`, workspacesSnapshot.items)

    const unsubWorkspaces = ctx.workspaces.list.subscribe(() => {
      const snap = ctx.workspaces.list.getSnapshot()
      const currentHash = JSON.stringify(snap.items)
      if (currentHash !== lastWorkspacesHash) {
        console.log(`${TAG} [变化] 工作区列表更新:`, snap.items)
        lastWorkspacesHash = currentHash
      }
    })
    unsubscribers.push(unsubWorkspaces)
    lastWorkspacesHash = JSON.stringify(workspacesSnapshot.items)
  }

  // 订阅当前会话选择变化（ObservableSnapshot）
  if (ctx.sessions?.selection) {
    let lastSessionId: string | null = null
    const initialSelection = ctx.sessions.selection.getSnapshot()
    console.log(`${TAG} 初始当前会话:`, initialSelection?.sessionId)
    lastSessionId = initialSelection?.sessionId ?? null

    const unsubSelection = ctx.sessions.selection.subscribe(() => {
      const snap = ctx.sessions.selection.getSnapshot()
      const currentSessionId = snap?.sessionId ?? null
      if (currentSessionId !== lastSessionId) {
        console.log(`${TAG} [变化] 当前会话切换:`, { from: lastSessionId, to: currentSessionId })
        lastSessionId = currentSessionId
      }
    })
    unsubscribers.push(unsubSelection)
  }

  // 订阅会话列表数据（ObservableSnapshot）
  if (ctx.sessions?.list) {
    let lastSessionsHash = ''
    const sessionsSnapshot = ctx.sessions.list.getSnapshot()
    console.log(`${TAG} 初始会话列表:`, sessionsSnapshot.items)
    lastSessionsHash = JSON.stringify(sessionsSnapshot.items)

    const unsubSessions = ctx.sessions.list.subscribe(() => {
      const snap = ctx.sessions.list.getSnapshot()
      const currentHash = JSON.stringify(snap.items)
      if (currentHash !== lastSessionsHash) {
        console.log(`${TAG} [变化] 会话列表更新:`, snap.items)
        lastSessionsHash = currentHash
      }
    })
    unsubscribers.push(unsubSessions)
  }

  // 等待 DOM 就绪后执行
  const initPlugin = () => {
    console.log(`${TAG} initPlugin 开始执行，当前 URL:`, window.location.href)

    // 打印当前 DOM 快照
    logSessionNodes()

    // 创建 Canvas 元素（固定定位在右下角）
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 60
    canvas.style.cssText = 'cursor: pointer; position: fixed; right: 16px; bottom: 16px; z-index: 99999; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);'
    canvas.setAttribute('data-session-tag-canvas', 'true')

    // 绘制蓝色块
    const ctx2d = canvas.getContext('2d')
    if (ctx2d) {
      ctx2d.fillStyle = '#3b82f6'
      ctx2d.fillRect(0, 0, 100, 60)
      console.log(`${TAG} Canvas 2D 绘制完成`)
    } else {
      console.log(`${TAG} 无法获取 Canvas 2D 上下文`)
    }

    // 绑定点击事件：调用服务端接口并打印响应
    canvas.addEventListener('click', async (event) => {
      console.log(`${TAG} Canvas clicked:`, {
        type: event.type,
        time: new Date().toLocaleString(),
        x: event.offsetX,
        y: event.offsetY,
      })

      // 获取当前上下文
      const sessionCurrent = getCurrentSessionId(ctx)
      const workspacesSnapshot = ctx.workspaces?.list?.getSnapshot()
      const folderActive = workspacesSnapshot
        ? getActiveWorkspaceId(workspacesSnapshot.items, sessionCurrent)
        : null

      // 构建查询参数
      const params = new URLSearchParams()
      if (folderActive) params.set('folderActive', folderActive)
      if (sessionCurrent) params.set('sessionCurrent', sessionCurrent)
      const queryString = params.toString()
      const url = `/dsh-session-host-test${queryString ? `?${queryString}` : ''}`

      try {
        const res = await fetch(url)
        const data = await res.json()
        console.log(`${TAG} 接口响应 /dsh-session-host-test:`, data)
      } catch (err) {
        console.error(`${TAG} 接口调用失败 /dsh-session-host-test:`, err)
      }
    })

    // 挂载 Canvas 到 body（fixed 定位，无需依赖特定容器）
    document.body.appendChild(canvas)
    console.log(`${TAG} Canvas 已挂载到 body（右下角固定定位）`)

    // 使用 MutationObserver 监听会话节点变化
    const observerTarget = safeQuery('[data-conversation-scroll]') ?? document.body
    console.log(`${TAG} MutationObserver 监听目标:`, {
      tagName: observerTarget.tagName,
      id: observerTarget.id,
      className: observerTarget.className,
    })

    const observer = new MutationObserver((mutations) => {
      const addedNodes = mutations.flatMap(m => Array.from(m.addedNodes))
      const removedNodes = mutations.flatMap(m => Array.from(m.removedNodes))
      
      if (addedNodes.length > 0 || removedNodes.length > 0) {
        console.log(`${TAG} DOM 变化检测:`, {
          新增节点数: addedNodes.length,
          删除节点数: removedNodes.length,
          sessionRow数量: safeQueryAll('[data-session-row]').length,
          chatAnchor数量: safeQueryAll('[data-chat-anchor-key]').length,
        })
      }
    })

    observer.observe(observerTarget, {
      childList: true,
      subtree: true,
    })
    console.log(`${TAG} MutationObserver 已启动`)

    // 定时兜底：每 5 秒打印一次 DOM 状态
    const intervalId = setInterval(() => {
      const sessionRows = safeQueryAll('[data-session-row]').length
      const chatAnchors = safeQueryAll('[data-chat-anchor-key]').length
      if (sessionRows > 0 || chatAnchors > 0) {
        console.log(`${TAG} 定时检查 - session-row: ${sessionRows}, chat-anchor: ${chatAnchors}`)
      }
    }, 5000)

    // 清理函数（可通过 window.__sessionTagCleanup 调用）
    ;(window as any).__sessionTagCleanup = () => {
      unsubscribers.forEach(unsub => unsub())
      observer.disconnect()
      clearInterval(intervalId)
      canvas.remove()
      console.log(`${TAG} 插件已清理`)
    }
  }

  // DSH 客户端运行时在 DOM 就绪后才加载插件，直接同步执行
  // readyState 信息仅作日志输出，不阻塞执行
  console.log(`${TAG} 当前 readyState: ${document.readyState}`)
  initPlugin()
}
