# 会话上下文发布订阅 - 设计文档

## 一、设计说明

本次变更在既有双包插件的基础上，建立「会话/工作区上下文 → 接口参数」的通路：客户端订阅 DSH 运行时提供的 `ctx.sessions` / `ctx.workspaces` 数据，在 Canvas 点击接口时携带 `folderActive` / `sessionCurrent` 上下文参数；宿主端扩展 `/dsh-session-host-test` 解析并回显该上下文。

### 核心目标

1. 打通客户端 → 宿主的上下文感知调用（发布订阅数据 → 接口参数）
2. 建立客户端注入并订阅 DSH 客户端服务（`sessions` / `workspaces`）的标准模式
3. 在既有 `/dsh-session-host-test` 上向后兼容地扩展上下文参数

### 技术约束

- 客户端数据源：`ctx.sessions` / `ctx.workspaces`（`ObservableSnapshot`：`getSnapshot()` + `subscribe()`，退订返回 `() => void`）
- 宿主路由：沿用 `ctx.webServer.register({ kind, path, handler })`，`handler` 收到 `node:http` 的 `IncomingMessage` / `ServerResponse`（无 `res.json`，需手动 `writeHead + end`）
- 双包拆分：`packages/dsh-session-host`（宿主）/ `packages/dsh-session-client`（客户端）
- 参考实现：客户端订阅模式对齐 `docs/dsh-tidychat.md`；宿主路由对齐 `docs/dsh-session-manager.md` 与 `docs/dsh-tidychat.md`

### 关联能力

| 能力 | 归属包 | 说明 |
|------|--------|------|
| `host-http-interface`（修改） | host | `/dsh-session-host-test` 支持上下文参数 |
| `pubsub-data-subscription`（新增） | client | 订阅工作区/会话数据 |
| `context-aware-api-call`（新增） | client | 点击时带上下文调接口 |

## 二、宿主端设计（packages/dsh-session-host）

### 2.1 接口扩展（src/index.ts）

```typescript
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-session-tag-manage-host'
export const inject = ['webServer']

export function apply(ctx: Context) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-session-host-test',
    handler: (req, res) => {
      // node:http IncomingMessage，无 res.json，需手动解析 URL 查询参数
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const folderActive = url.searchParams.get('folderActive')
      const sessionCurrent = url.searchParams.get('sessionCurrent')

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        serverTime: Date.now(),
        folderActive,
        sessionCurrent,
      }))
    },
  })
}
```

- 无参访问时 `folderActive` / `sessionCurrent` 均为 `null`，兼容既有调用方
- 响应结构在 `serverTime` 基础上追加两个字段，字段名与入参一致，便于客户端回显

## 三、客户端设计（packages/dsh-session-client）

### 3.1 服务注入与订阅（src/index.ts）

```typescript
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'dsh-session-tag-manage-client'
export const inject = ['slots', 'sessions', 'workspaces'] as const

/** 从 ctx.sessions.selection 获取当前会话 ID（ObservableSnapshot） */
function getCurrentSessionId(ctx: ClientContext): string | null {
  try {
    if (!ctx.sessions?.selection) return null
    const snapshot = ctx.sessions.selection.getSnapshot()
    return snapshot?.sessionId ?? null
  } catch {
    return null
  }
}

/** 按会话 ID 匹配所属工作区，未命中降级返回第一个工作区 */
function getActiveWorkspaceId(
  workspaces: Array<{ workspaceId: string; sessionIds?: string[] }>,
  sessionId: string | null
): string | null {
  if (!sessionId || !workspaces?.length) return null
  try {
    const workspace = workspaces.find(w => w.sessionIds?.includes(sessionId))
    if (workspace) return workspace.workspaceId
    console.warn(`${TAG} 会话 ${sessionId} 未找到所属工作区，使用第一个工作区降级`)
    return workspaces[0]?.workspaceId ?? null
  } catch {
    return null
  }
}
```

在 `apply(ctx)` 中订阅三路数据：

```typescript
const unsubscribers: Array<() => void> = []
if (ctx.workspaces?.list) {
  // getSnapshot() + subscribe()，变化时用 JSON 哈希去重并打印差异日志
  const workspacesSnapshot = ctx.workspaces.list.getSnapshot()
  const unsub = ctx.workspaces.list.subscribe(() => { /* 去重打印 */ })
  unsubscribers.push(unsub)
}
if (ctx.sessions?.selection) { /* 订阅当前会话选择变化 */ }
if (ctx.sessions?.list) { /* 订阅会话列表变化 */ }
// 清理：unsubscribers.forEach(unsub => unsub())
```

### 3.2 点击调用接口（src/index.ts）

```typescript
canvas.addEventListener('click', async (event) => {
  console.log(`${TAG} Canvas clicked:`, { type, time, x, y })
  // 读取上下文
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
  const res = await fetch(url)
  console.log(`${TAG} 接口响应 /dsh-session-host-test:`, await res.json())
})
```

### 3.3 包配置（package.json）

`dsh.client` 增加 `inject` 注入客户端运行时与 API remotes：

```json
"dsh": {
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-api-remotes"
    ]
  }
}
```

### 3.4 类型定义（types/deepseek-ai.d.ts）

`ClientContext` 补充会话/工作区服务声明：

- `sessions.list`：`getSnapshot()` → `{ items: [{ sessionId, running, title? }] }`；`subscribe(cb) → unsub`
- `sessions.selection`：`getSnapshot()` → `{ sessionId: string | null }`；`subscribe(cb) → unsub`
- `workspaces.list`：`getSnapshot()` → `{ items: [{ workspaceId, title, path, sessionIds? }] }`；`subscribe(cb) → unsub`

> 说明：`@deepseek-ai/*` 由 DSH 宿主运行时提供，本地以 `types/deepseek-ai.d.ts` 类型 mock。

## 四、数据流设计

### 4.1 客户端上下文 → 接口

```
插件加载 → 注入 sessions/workspaces → 订阅三路数据（getSnapshot + subscribe）
        → 用户点击 Canvas
        → getCurrentSessionId(ctx) 读当前会话
        → getActiveWorkspaceId(workspaces, sessionId) 匹配工作区（降级兜底）
        → 构建 ?folderActive=...&sessionCurrent=...
        → fetch /dsh-session-host-test
        → 控制台打印接口响应
```

### 4.2 宿主接口解析

```
HTTP GET /dsh-session-host-test?folderActive=ws-123&sessionCurrent=sess-456
        → new URL 解析查询参数
        → 返回 { serverTime, folderActive: 'ws-123', sessionCurrent: 'sess-456' }
```

## 五、验证方案

### 5.1 接口验证

1. 启动开发服务器：`pnpm dsh web --patch cordis.yml`
2. 带参：`curl 'http://localhost:PORT/dsh-session-host-test?folderActive=ws-123&sessionCurrent=sess-456'` → 返回含对应字段的 JSON
3. 无参：`curl 'http://localhost:PORT/dsh-session-host-test'` → `folderActive`/`sessionCurrent` 为 `null`

### 5.2 客户端订阅验证

1. 在 DSH Web UI 中打开会话，确认控制台打印「初始工作区列表」「初始当前会话」「初始会话列表」日志
2. 切换当前会话/工作区，确认打印去重后的 `[变化]` 日志
3. 点击 Canvas，确认控制台打印含 `folderActive`/`sessionCurrent` 的接口响应

### 5.3 单测与类型

1. 执行 `pnpm typecheck` 无类型错误
2. 执行 `pnpm test`，宿主端参数解析/默认值、客户端订阅用例全通过

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 会话/工作区数据结构与官方变化不符 | 订阅数据为空或不更新 | 接入前比对 `docs/dsh-tidychat.md`，订阅中添加 `if` 存在性判断与 `catch` 兜底 |
| 会话未匹配到工作区 | `folderActive` 可能为空 | 降级返回第一个工作区并 `console.warn` |
| 接口并发/不存在 | 请求失败 | `try/catch` 捕获并打印错误日志，不阻断页面 |
| 脱离主线程泄漏 | 多次订阅占用资源 | 清理函数统一 `unsubscribers.forEach(unsub)` 退订 |

## 七、任务列表

见 `tasks.md`。

## 八、验证步骤

1. **类型检查**：执行 `pnpm typecheck` 无类型错误
2. **单测**：执行 `pnpm test`，宿主端参数解析/默认值、客户端订阅用例全通过
3. **接口验证**：启服后带参/无参 curl `/dsh-session-host-test`，核对返回字段与默认值
4. **客户端验证**：DSH Web UI 点击 Canvas，核对控制台接口响应含上下文
5. **订阅验证**：切换会话/工作区，核对 `[变化]` 差异日志与退订后不再输出