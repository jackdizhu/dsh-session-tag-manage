# 任务列表

## 阶段一：类型定义与配置

- [x] 1.1 在 `types/deepseek-ai.d.ts` 补充 `ClientContext` 的 `sessions.list`、`sessions.selection`、`workspaces.list` 类型声明
    变更文件：`types/deepseek-ai.d.ts`
    变更内容：
    ```diff
    declare module '@deepseek-ai/dsh-client-runtime/client' {
      export interface ClientContext {
        slots: any
    +   sessions: {
    +     list: {
    +       getSnapshot(): { items: Array<{ sessionId: string; running: boolean; title?: string }> }
    +       subscribe(callback: () => void): () => void
    +     }
    +     selection: {
    +       getSnapshot(): { sessionId: string | null }
    +       subscribe(callback: () => void): () => void
    +     }
    +   }
    +   workspaces: {
    +     list: {
    +       getSnapshot(): { items: Array<{ workspaceId: string; title: string; path: string; sessionIds?: string[] }> }
    +       subscribe(callback: () => void): () => void
    +     }
    +   }
      }
    }
    ```

- [x] 1.2 更新 `packages/dsh-session-client/package.json`，为 `dsh.client` 添加 `inject` 配置（不改动 peerDependencies）
    变更文件：`packages/dsh-session-client/package.json`
    变更内容：
    ```diff
      "dsh": {
    -   "client": { "platform": "web" }
    +   "client": {
    +     "platform": "web",
    +     "inject": [
    +       "@deepseek-ai/dsh-client-runtime",
    +       "@deepseek-ai/dsh-api-remotes"
    +     ]
    +   }
      },
      "peerDependencies": {},
    ```

## 阶段二：宿主端接口扩展

- [x] 2.1 扩展 `packages/dsh-session-host/src/index.ts` 的 `/dsh-session-host-test` 接口，解析并返回 `folderActive` 与 `sessionCurrent` 参数
    变更文件：`packages/dsh-session-host/src/index.ts`
    变更内容：
    ```diff
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-session-host-test',
    -   handler: (_req, res) => {
    +   handler: (req, res) => {
    +     // 解析 URL 查询参数（node:http IncomingMessage，需手动 new URL）
    +     const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    +     const folderActive = url.searchParams.get('folderActive')
    +     const sessionCurrent = url.searchParams.get('sessionCurrent')
    +
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    -     res.end(JSON.stringify({ serverTime: Date.now() }))
    +     res.end(JSON.stringify({
    +       serverTime: Date.now(),
    +       folderActive,
    +       sessionCurrent,
    +     }))
        },
      })
    ```

## 阶段三：客户端数据订阅与参数传递

- [x] 3.1 更新 `packages/dsh-session-client/src/index.ts` 的 `inject` 数组，注入 `sessions` 与 `workspaces`
    变更文件：`packages/dsh-session-client/src/index.ts`
    变更内容：
    ```diff
    - export const inject = ['slots'] as const
    + export const inject = ['slots', 'sessions', 'workspaces'] as const
    ```

- [x] 3.2 新增会话 ID 与工作区解析辅助函数
    变更文件：`packages/dsh-session-client/src/index.ts`
    变更内容：
    ```diff
    + /**
    +  * 从 ctx.sessions.selection 获取当前会话 ID
    +  * 数据源：ObservableSnapshot（getSnapshot/has/get）
    +  */
    + function getCurrentSessionId(ctx: ClientContext): string | null {
    +   try {
    +     if (!ctx.sessions?.selection) return null
    +     const snapshot = ctx.sessions.selection.getSnapshot()
    +     return snapshot?.sessionId ?? null
    +   } catch {
    +     return null
    +   }
    + }
    +
    + /**
    +  * 获取当前活跃工作区 ID
    +  * 策略：按当前会话 ID 在工作区列表中匹配所属工作区（sessionIds）
    +  */
    + function getActiveWorkspaceId(
    +   workspaces: Array<{ workspaceId: string; sessionIds?: string[] }>,
    +   sessionId: string | null
    + ): string | null {
    +   if (!sessionId || !workspaces?.length) return null
    +   try {
    +     const workspace = workspaces.find(w => w.sessionIds?.includes(sessionId))
    +     if (workspace) return workspace.workspaceId
    +     console.warn(`${TAG} 会话 ${sessionId} 未找到所属工作区，使用第一个工作区降级`)
    +     return workspaces[0]?.workspaceId ?? null
    +   } catch {
    +     return null
    +   }
    + }
    ```

- [x] 3.3 在 `apply` 中订阅工作区列表、会话列表与当前会话选择（ObservableSnapshot）
    变更文件：`packages/dsh-session-client/src/index.ts`
    变更内容：
    ```diff
    + const unsubscribers: Array<() => void> = []
    +
    + // 订阅工作区数据（ObservableSnapshot），变化时打印去重差异日志
    + if (ctx.workspaces?.list) {
    +   let lastWorkspacesHash = ''
    +   const workspacesSnapshot = ctx.workspaces.list.getSnapshot()
    +   console.log(`${TAG} 初始工作区列表:`, workspacesSnapshot.items)
    +   const unsubWorkspaces = ctx.workspaces.list.subscribe(() => {
    +     const snap = ctx.workspaces.list.getSnapshot()
    +     const currentHash = JSON.stringify(snap.items)
    +     if (currentHash !== lastWorkspacesHash) {
    +       console.log(`${TAG} [变化] 工作区列表更新:`, snap.items)
    +       lastWorkspacesHash = currentHash
    +     }
    +   })
    +   unsubscribers.push(unsubWorkspaces)
    +   lastWorkspacesHash = JSON.stringify(workspacesSnapshot.items)
    + }
    +
    + // 订阅当前会话选择变化（ObservableSnapshot）
    + if (ctx.sessions?.selection) {
    +   let lastSessionId: string | null = null
    +   const initialSelection = ctx.sessions.selection.getSnapshot()
    +   console.log(`${TAG} 初始当前会话:`, initialSelection?.sessionId)
    +   lastSessionId = initialSelection?.sessionId ?? null
    +   const unsubSelection = ctx.sessions.selection.subscribe(() => {
    +     const snap = ctx.sessions.selection.getSnapshot()
    +     const currentSessionId = snap?.sessionId ?? null
    +     if (currentSessionId !== lastSessionId) {
    +       console.log(`${TAG} [变化] 当前会话切换:`, { from: lastSessionId, to: currentSessionId })
    +       lastSessionId = currentSessionId
    +     }
    +   })
    +   unsubscribers.push(unsubSelection)
    + }
    +
    + // 订阅会话列表数据（ObservableSnapshot）
    + if (ctx.sessions?.list) {
    +   let lastSessionsHash = ''
    +   const sessionsSnapshot = ctx.sessions.list.getSnapshot()
    +   console.log(`${TAG} 初始会话列表:`, sessionsSnapshot.items)
    +   lastSessionsHash = JSON.stringify(sessionsSnapshot.items)
    +   const unsubSessions = ctx.sessions.list.subscribe(() => {
    +     const snap = ctx.sessions.list.getSnapshot()
    +     const currentHash = JSON.stringify(snap.items)
    +     if (currentHash !== lastSessionsHash) {
    +       console.log(`${TAG} [变化] 会话列表更新:`, snap.items)
    +       lastSessionsHash = currentHash
    +     }
    +   })
    +   unsubscribers.push(unsubSessions)
    + }
    ```

- [x] 3.4 修改 Canvas 点击事件，基于上下文构建查询串并调用接口
    变更文件：`packages/dsh-session-client/src/index.ts`
    变更内容：
    ```diff
      canvas.addEventListener('click', async (event) => {
        console.log(`${TAG} Canvas clicked:`, {
          type: event.type,
          time: new Date().toLocaleString(),
          x: event.offsetX,
          y: event.offsetY,
        })

    +   // 获取当前上下文（当前会话 + 所属工作区）
    +   const sessionCurrent = getCurrentSessionId(ctx)
    +   const workspacesSnapshot = ctx.workspaces?.list?.getSnapshot()
    +   const folderActive = workspacesSnapshot
    +     ? getActiveWorkspaceId(workspacesSnapshot.items, sessionCurrent)
    +     : null
    +
    +   // 构建查询参数
    +   const params = new URLSearchParams()
    +   if (folderActive) params.set('folderActive', folderActive)
    +   if (sessionCurrent) params.set('sessionCurrent', sessionCurrent)
    +   const queryString = params.toString()
    +   const url = `/dsh-session-host-test${queryString ? `?${queryString}` : ''}`
    +
        try {
    -     const res = await fetch('/dsh-session-host-test')
    +     const res = await fetch(url)
          const data = await res.json()
          console.log(`${TAG} 接口响应 /dsh-session-host-test:`, data)
        } catch (err) {
          console.error(`${TAG} 接口调用失败 /dsh-session-host-test:`, err)
        }
      })
    ```

- [x] 3.5 在清理函数中统一取消所有订阅
    变更文件：`packages/dsh-session-client/src/index.ts`
    变更内容：
    ```diff
      ;(window as any).__sessionTagCleanup = () => {
    +   unsubscribers.forEach(unsub => unsub())
        observer.disconnect()
        clearInterval(intervalId)
        canvas.remove()
        console.log(`${TAG} 插件已清理`)
      }
    ```

## 阶段四：测试与验证

- [x] 4.1 补充宿主端测试用例：参数解析与默认值处理
    变更文件：`packages/dsh-session-host/__tests__/index.test.ts`
    变更内容：新增「路由处理器应解析 folderActive 和 sessionCurrent 参数」「无参数时应返回默认值」两个用例（详见 proposal.md 测试设计）

- [x] 4.2 补充客户端测试用例：工作区与会话服务订阅
    变更文件：`packages/dsh-session-client/__tests__/index.test.ts`
    变更内容：新增「apply 应订阅工作区数据」「apply 应订阅会话数据」两个用例，注入 `ctx.workspaces.list` / `ctx.sessions.list` 并断言 `getSnapshot` + `subscribe` 被调用

- [x] 4.3 执行 `pnpm typecheck`，确认改造 `ClientContext` 后无类型错误

- [x] 4.4 执行 `pnpm test`，确认宿主端与客户端所有测试用例通过

- [x] 4.5 Sub-agent 任务审计
    - 对照 proposal.md 的 Capabilities 检查实现完整性
    - 验证所有文件变更符合 diff 规范
    - 核对接入的会话数据源（`ctx.sessions.selection` / `ctx.workspaces.list`）与官方 `docs/dsh-tidychat.md` 模式一致
    - 确认测试覆盖率达标