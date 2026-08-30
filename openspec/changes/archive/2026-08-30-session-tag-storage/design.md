# Design: Session Tag Storage

> 本文档基于最终落地代码编写，反映实现真实情况。
> 初稿曾设想基于 `ctx.storageDomain`（defineDomain）的存储域方案，落地时改为扁平化文件存储，特此记录设计决策与原因。

## 背景与目标

为 `dsh-session-tag-manage` 插件提供按工作区隔离的会话标签持久化能力，并暴露 HTTP 接口供客户端查询与写入，为标签自动分析、手动编辑等功能奠定数据基础。

## 设计决策

### 决策 1：存储方案选用扁平化文件存储（非 storageDomain）

**选择**：使用 Node.js 内置 `fs` 实现扁平化文件存储，每个工作区对应一个独立 JSON 文件。

**理由**：
- 实现简单，依赖少（仅 `node:fs/promises`、`node:path`、`node:os`）
- 按工作区隔离天然清晰，文件级调试直观
- 避免引入 storageDomain 的时序与并发复杂依赖，便于测试与长期维护

**存储结构**：

```
~/.dsh/storages/
  └── dsh_session_tag__{workspaceId}.json   # 内容为 SessionTagEntry[]
```

**文件内容格式**（写入时统一为数组；读取时兼容数组或 `{ sessions: [...] }` 包装两种格式）：

```json
[
  {
    "sessionId": "session-xxx",
    "title": "会话标题",
    "sessionCurrentTag": "任务进行中",
    "createdAt": "2026-08-16T07:51:06.460Z",
    "updatedAt": "2026-08-29T01:51:07.535Z"
  }
]
```

### 决策 2：Host/Client 共享契约集中管理

**选择**：新建 `packages/dsh-session-host/src/contract.ts` 集中定义路由常量与共享类型。

**内容**：
- 路由常量：`WORKSPACE_LIST_TAG_ROUTE`、`WORKSPACE_TAG_SET_ROUTE`
- 类型：`SessionTagEntry`、`WorkspaceTagQueryRequest/Response`、`WorkspaceTagSetRequest/Response`、`DshRpcRequest/DshRpcResponse`

### 决策 3：写入采用全量覆盖，支持显式删除

**选择**：`workspace.tag.set` 对指定工作区执行全量覆盖写入；当 `deleteWorkspace=true` 且 `sessions` 为空时删除工作区文件。

**理由**：全量覆盖语义清晰，避免增量合并的复杂性与脏数据；预留显式删除以便清理空文件。

### 决策 4：查询自动补建空文件

**选择**：`workspace.list.tag` 查询时，若工作区文件不存在则自动创建空文件（写入 `[]`）。

**理由**：保证后续写入有稳定落点，避免"文件尚不存在"的边界分支。

## 架构与模块划分

### Host 端 `packages/dsh-session-host/src/`

```
src/
  index.ts                    # 插件入口：注册路由
  contract.ts                 # 共享契约（路由常量 + 类型）
  utils/
    index.ts                  # 工具导出
    file-storage.ts           # 扁平化文件存储 API
```

**路由表**：

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/dsh-session-tag-manage/workspace.list.tag` | 查询指定工作区会话标签 |
| POST | `/dsh-session-tag-manage/workspace.tag.set` | 全量覆盖写入 / 显式删除 |
| GET  | `/dsh-session-host-test` | 既有测试接口（含 `testWrite` 测试写入） |

**file-storage.ts API**：

| 函数 | 说明 |
|------|------|
| `readWorkspaceTags(workspaceId)` | 读取，文件不存在返回 `[]`；JSON 解析容错 |
| `writeWorkspaceTags(workspaceId, entries)` | 全量覆盖写入，自动创建目录 |
| `deleteWorkspaceFile(workspaceId)` | 删除工作区文件 |
| `listWorkspaceIds()` | 从文件名提取所有工作区 ID |
| `workspaceFileExists(workspaceId)` | 检查文件是否存在 |

### 请求/响应约定

**查询 `workspace.list.tag`**：

- 请求体：`{ workspaceId: string }`
- 成功：`200 { ok: true, value: { items: SessionTagEntry[] } }`
- 缺少 workspaceId：`400 { ok: false, error: 'workspace-id-required' }`
- 非 POST：`405 { ok: false, error: 'method-not-allowed' }`
- 读取异常：`500 { ok: false, error: 'storage-read-failed' }`

**写入 `workspace.tag.set`**：

- 请求体：`{ workspaceId, sessions: SessionTagEntry[], deleteWorkspace? }`
- 成功：`200 { ok: true, value: { count: number } }`
- 缺少 workspaceId：`400 workspace-id-required`
- sessions 非数组：`400 sessions-array-required`
- 写入异常：`500 { ok: false, error: 'storage-write-failed' }`

### Client 端 `packages/dsh-session-client/src/index.ts`

- Canvas 点击 → 解析当前会话与工作区 → `POST workspace.list.tag` → 控制台打印响应
- 工作区解析策略：据当前 sessionId 在工作区列表中反查；缺失时降级到第一个工作区
- 订阅 `workspaces.list` / `sessions.selection` / `sessions.list` 并打印变化日志

### 类型声明 `types/deepseek-ai.d.ts`

- `@deepseek-ai/cordis`：`Context.webServer.register`（host 路由）
- `@deepseek-ai/dsh-client-runtime/client`：`ClientContext`（slots / sessions.list / sessions.selection / workspaces.list）

## 错误处理

- 文件读取/写入/删除均有 try/catch 兜底，失败时打印日志并返回安全默认值
- HTTP 层对 `JSON.parse` 失败、缺少参数、方法错误等返回明确的错误码
- 存储层返回空数组/布尔值，避免异常向上抛

## 测试覆盖

- Host：`packages/dsh-session-host/__tests__/index.test.ts`（19 tests，覆盖查询/写入/删除/自动清理/方法校验）
- 存储：`packages/dsh-session-host/__tests__/file-storage.test.ts`（12 tests，覆盖读写/删除/列出/存在性/JSON 容错）
- Client：`packages/dsh-session-client/__tests__/index.test.ts`（16 tests）
- 合计 47 项测试，`pnpm typecheck` / `pnpm test` / `pnpm build` 均通过

## 风险与权衡

- **并发一致性**：采用文件级全量覆盖，无锁并发写入可能丢失更新；当前体量下可接受，后续如需强一致可基于 storageDomain 迁移
- **API 响应格式**：当前 host 直接返回 `{ ok, value }`，未包裹 API 文档中的 DSH RPC 外层（`type`/`rpcId`）；`DshRpcRequest/Response` 类型已预留，客户端 fetch 时未包裹 RPC 外层，需在前端接入层做适配