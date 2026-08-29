## Why

当前客户端 Canvas 点击调用 `/dsh-session-host-test` 接口时无参数，宿主端无法感知当前工作区与当前会话上下文，返回的数据缺乏业务意义。需要通过 DSH 客户端服务（`ctx.sessions` / `ctx.workspaces`）订阅实时的工作区列表与当前会话选择，并在点击接口时传入 `{ folderActive, sessionCurrent }`，使宿主端能基于上下文返回更有意义的数据。

参考实现对齐：客户端会话/工作区订阅沿用 `docs/dsh-tidychat.md` 的 `getSnapshot + subscribe` 模式（`ObservableSnapshot`），宿主处 HTTP 路由按 `docs/dsh-session-manager.md` 的 `ctx.webServer` 注册约定扩展。

## What Changes

- **宿主端**（`packages/dsh-session-host/src/index.ts`）：
  - 扩展 `/dsh-session-host-test` 路由处理器，从请求 URL 解析查询参数 `folderActive`（工作区 ID）和 `sessionCurrent`（会话 ID）
  - 返回 JSON 在原 `serverTime` 基础上追加 `folderActive`、`sessionCurrent` 字段；无参时二者为 `null`（向后兼容）

- **客户端**（`packages/dsh-session-client/src/index.ts`）：
  - 通过 `inject = ['slots', 'sessions', 'workspaces']` 注入 `sessions` 与 `workspaces` 服务
  - 使用 `ObservableSnapshot`（`getSnapshot()` + `subscribe()`）订阅工作区列表、会话列表与当前会话选择；数据变化时打印去重后的差异日志，并持有退订函数供清理
  - 新增 `getCurrentSessionId(ctx)`：从 `ctx.sessions.selection.getSnapshot().sessionId` 获取当前会话 ID
  - 新增 `getActiveWorkspaceId(workspaces, sessionId)`：按 `workspaces[].sessionIds.includes(sessionId)` 匹配当前会话所属工作区，未命中时降级返回第一个工作区
  - Canvas 点击时构建查询串 `?folderActive=<id>&sessionCurrent=<id>` 调取 `/dsh-session-host-test`，控制台打印接口响应
  - 清理函数统一调用退订函数取消所有订阅

- **配置**（`packages/dsh-session-client/package.json`）：`dsh.client` 由 `{ platform: "web" }` 扩展为 `{ platform: "web", inject: [...] }`，声明客户端运行时与 API remotes 注入

- **类型定义**（`types/deepseek-ai.d.ts`）：扩展 `ClientContext`，补充 `sessions.list`、`sessions.selection`、`workspaces.list` 的类型声明

## Capabilities

### New Capabilities

- `pubsub-data-subscription`: 客户端通过 ObservableSnapshot 订阅工作区列表、会话列表与当前会话选择，获取实时更新
- `context-aware-api-call`: Canvas 点击调用接口时，基于订阅状态解析并传入工作区与会话上下文参数

### Modified Capabilities

- `host-http-interface`: 扩展 `/dsh-session-host-test` 接口，支持解析并返回 `folderActive`、`sessionCurrent` 上下文参数

## Impact

- **代码结构**：客户端新增会话/工作区订阅逻辑与两个上下文解析辅助函数；宿主端路由处理器扩展参数解析
- **依赖**：客户端 `dsh.client.inject` 声明 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-api-remotes`（运行时由 DSH 宿主提供，不改动 peerDependencies）；`types/deepseek-ai.d.ts` 补充服务类型
- **API 兼容性**：接口路径与返回结构向下兼容——不传参时 `folderActive`/`sessionCurrent` 返回 `null`，不影响既有 `/dsh-session-host-test` 调用方
- **开发流程**：客户端包需通过 `dsh.client.inject` 注入新增服务；会话/工作区数据源改动需随后在任务审计中对照官方 `docs/` 核对文档复核

## 验证步骤

1. **类型检查**：执行 `pnpm typecheck`，确认无类型错误（改造 `ClientContext` 后必须执行）
2. **单元测试**：执行 `pnpm test`，确认宿主端参数解析/默认值测试、客户端订阅测试全部通过
3. **接口验证**：启动开发服务器，curl 带参访问 `/dsh-session-host-test?folderActive=ws-123&sessionCurrent=sess-456`，确认返回 JSON 含对应字段；不带参访问确认返回 `null` 默认值
4. **客户端验证**：在 DSH Web UI 中点击 Canvas，确认控制台打印包含工作区与会话信息的接口响应
5. **数据订阅验证**：切换当前会话或工作区，确认控制台打印去重后的 `[变化]` 日志

## 单元测试设计（Vitest）

### 测试框架配置

- 测试框架：Vitest（ESM 原生支持，与项目 TypeScript ESM 技术栈一致）
- 客户端测试环境：jsdom（`// @vitest-environment jsdom`）
- 类型别名：`@deepseek-ai/*` 指向 `types/deepseek-ai.d.ts`（运行时由宿主提供）

### 宿主端测试用例（packages/dsh-session-host/__tests__/index.test.ts）

- 导出符合 Cordis 规范的 `name`（`dsh-session-tag-manage-host`）与 `inject`（含 `webServer`）
- 以路由对象注册 `/dsh-session-host-test`（`kind: 'exact'`）
- 无参请求返回含 `serverTime` 的 JSON
- 带 `folderActive`/`sessionCurrent` 参数时正确解析并返回
- 无参时 `folderActive`/`sessionCurrent` 返回 `null`（默认值）
- 路由路径以 `/dsh-session-host-` 开头

### 客户端测试用例（packages/dsh-session-client/__tests__/index.test.ts）

- 导出符合 Cordis 规范的 `name`（`dsh-session-tag-manage-client`）与 `inject`（含 `slots`）
- `apply` 创建 Canvas 元素（100x60、fixed 右下角定位、`data-session-tag-canvas` 属性）
- `apply` 打印 ctx 上下文、slots 可用性、挂载、MutationObserver 启动日志，并暴露 `window.__sessionTagCleanup`
- `apply` 打印 DOM 节点扫描报告（`console.groupCollapsed('DOM 节点扫描报告')`）
- **注入 `ctx.workspaces.list` 时订阅并读取快照**（`getSnapshot` + `subscribe`）
- **注入 `ctx.sessions.list` 时订阅并读取快照**（`getSnapshot` + `subscribe`）

### 测试覆盖率目标

| 模块 | 覆盖率目标 | 说明 |
|------|-----------|------|
| 宿主端插件 | ≥ 90% | 路由注册、参数解析、默认值处理 |
| 客户端插件 | ≥ 85% | Canvas 交互、数据订阅、日志输出 |

### 测试执行命令

```bash
# 运行所有测试
pnpm test

# 运行宿主端测试
pnpm test --filter dsh-session-tag-manage-host

# 运行客户端测试
pnpm test --filter dsh-session-tag-manage-client

# 生成覆盖率报告
pnpm test:coverage
```