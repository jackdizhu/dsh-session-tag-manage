## Why

当前 `dsh-session-tag-manage` 插件缺乏会话标签的持久化存储能力。需要：
1. 创建独立的存储空间，按工作区隔离存储会话标签数据
2. 提供 `/dsh-session-tag-manage/workspace.list.tag` 接口，供客户端查询指定工作区下所有会话的标签状态
3. 提供 `/dsh-session-tag-manage/workspace.tag.set` 接口，供客户端按工作区写入（全量覆盖）或删除会话标签
4. 为后续的标签自动分析、手动编辑、会话投影等功能奠定数据基础

## What Changes

> 注：本方案最初设想基于 `ctx.storageDomain`（defineDomain）统一管理存储域，但在落地时改用 **扁平化文件存储**（Node.js fs），每个工作区对应一个独立 JSON 文件，实现更简单、便于调试与隔离。以下描述均为最终落地实现。

### 存储架构（扁平化文件存储）

不使用 storageDomain，改为基于 `node:fs` 的扁平化文件存储工具：

- 存储目录：`~/.dsh/storages/`
- 每个工作区一个独立 JSON 文件：`~/.dsh/storages/dsh_session_tag__{workspaceId}.json`
- 文件内容为 `SessionTagEntry[]` 数组（写入时统一为数组格式）
- 读取时兼容两种格式：直接数组 或 `{ sessions: [...] }` 包装对象
- 每个工作区独立存储，互不干扰；删除、列出、存在性检查均有独立 API

```typescript
// SessionTagEntry（与 contract.ts 一致）
interface SessionTagEntry {
  sessionId: string
  title: string
  sessionCurrentTag: string // 状态枚举
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}
```

### Contract（`packages/dsh-session-host/src/contract.ts`）— 新建

Host/Client 共享的路由常量和类型定义：

- 路由常量：
  - `WORKSPACE_LIST_TAG_ROUTE = '/dsh-session-tag-manage/workspace.list.tag'` — 查询
  - `WORKSPACE_TAG_SET_ROUTE = '/dsh-session-tag-manage/workspace.tag.set'` — 写入/删除
- 类型：
  - `SessionTagEntry` — 会话标签条目结构
  - `WorkspaceTagQueryRequest/Response` — 查询请求/响应
  - `WorkspaceTagSetRequest/Response` — 写入请求/响应
  - `DshRpcRequest/DshRpcResponse` — DSH RPC 请求/响应通用格式（参考 API 文档）

### Host 端变更（`packages/dsh-session-host/src/index.ts`）

- 注入 `webServer` 服务
- 新增文件存储工具 `src/utils/file-storage.ts`，暴露：
  - `readWorkspaceTags(workspaceId)` — 读取（返回数组，文件不存在返回 `[]`）
  - `writeWorkspaceTags(workspaceId, entries)` — 全量覆盖写入
  - `deleteWorkspaceFile(workspaceId)` — 删除工作区文件
  - `listWorkspaceIds()` — 列出所有工作区 ID
  - `workspaceFileExists(workspaceId)` — 检查文件是否存在
- 注册两条路由：
  - `POST /dsh-session-tag-manage/workspace.list.tag` — 查询指定工作区会话标签；文件不存在时自动创建空 JSON 文件
  - `POST /dsh-session-tag-manage/workspace.tag.set` — 全量覆盖写入；当 `deleteWorkspace=true` 且 `sessions` 为空时删除工作区文件
- 路由签名与错误处理遵循 `apiDocs/dsh-session-tag-manage_workspace.list.tag.md`

### Client 端变更（`packages/dsh-session-client/src/index.ts`）

- Canvas 点击时调用 `POST /dsh-session-tag-manage/workspace.list.tag` 接口
- 传入当前 `workspaceId`（通过当前会话 ID 在工作区列表中反查，缺失时降级到第一个工作区）
- 控制台打印接口响应数据
- 订阅 `workspaces.list` / `sessions.selection` / `sessions.list` 数据源并打印变化日志

### 类型定义变更（`types/deepseek-ai.d.ts`）

- 声明 `@deepseek-ai/cordis` 的 `Context.webServer.register` 类型（运行时由 dsh-host-webserver 提供）
- 声明 `@deepseek-ai/dsh-client-runtime/client` 的 `ClientContext` 类型（含 `slots`、`sessions.list/selection`、`workspaces.list`）

## Capabilities

### New Capabilities

- `session-tag-storage`: 基于扁平化文件存储的会话标签持久化，按工作区隔离（`~/.dsh/storages/dsh_session_tag__{workspaceId}.json`）
- `workspace-tag-query-api`: `/dsh-session-tag-manage/workspace.list.tag` 接口，查询指定工作区的会话标签列表

### Modified Capabilities

- `host-http-interface`: 新增 `workspace.list.tag`（查询）与 `workspace.tag.set`（写入/删除）两条路由
- `client-canvas-interaction`: Canvas 点击调用查询接口

## Impact

- **代码结构**：Host 新增文件存储工具与两条路由；新增 `src/contract.ts` 共享类型；新增 `src/utils/file-storage.ts`
- **依赖**：使用 Node.js 内置模块（`node:fs/promises`、`node:path`、`node:os`），无新增第三方运行时依赖；类型声明补充 `@deepseek-ai/cordis` 的 `webServer`
- **数据持久化**：自动写入 `~/.dsh/storages/dsh_session_tag__{workspaceId}.json`（每工作区一文件）
- **API 兼容性**：新增两条路由，不影响现有 `/dsh-session-host-test` 接口

## 验证步骤

1. **类型检查**：执行 `pnpm typecheck`，确认无类型错误
2. **单元测试**：执行 `pnpm test`，确认所有测试用例通过（47 tests）
3. **构建验证**：执行 `pnpm build`，确认构建成功
4. **接口验证**：启动开发服务器，POST 请求 `/dsh-session-tag-manage/workspace.list.tag` 带 `workspaceId` 参数，确认返回格式符合 API 文档
5. **客户端验证**：在 DSH Web UI 中点击 Canvas，确认控制台打印包含会话标签数据的接口响应
6. **存储验证**：确认 `~/.dsh/storages/dsh_session_tag__{workspaceId}.json` 文件被正确创建和写入