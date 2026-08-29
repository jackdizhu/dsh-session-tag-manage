# Spec: PubSub Data Subscription

## Overview

客户端插件数据订阅能力。客户端插件（`dsh-session-tag-manage-client`）负责订阅宿主端暴露的会话与工作区实时数据，用于感知当前上下文变化。代码位于 `packages/dsh-session-client/`，服务类型声明位于根目录 `types/deepseek-ai.d.ts`（双包拆分，与宿主端分离）。

## Requirements

### Requirement: 工作区与会话数据订阅
客户端插件 SHALL 通过 `ctx.workspaces` / `ctx.sessions` 服务（`ObservableSnapshot`：`getSnapshot()` + `subscribe()`）订阅工作区列表、会话列表与当前会话选择，数据变化时输出去重后的差异日志。

#### Scenario: 订阅工作区列表
- **WHEN** 客户端插件各名称 `inject = ['slots', 'sessions', 'workspaces']` 注入 `workspaces` 服务且 `ctx.workspaces.list` 可用
- **THEN** 调用 `getSnapshot()` 读取初始工作区列表并打印，调用 `subscribe(callback)` 注册变更回调（JSON 哈希去重后打印 `[变化]` 日志）

#### Scenario: 订阅当前会话选择
- **WHEN** `ctx.sessions.selection` 可用
- **THEN** 读取快照打印初始当前会话 ID，注册订阅；会话切换时打印 `[变化] 当前会话切换` 日志

#### Scenario: 订阅会话列表
- **WHEN** `ctx.sessions.list` 可用
- **THEN** 读取快照打印初始会话列表，注册订阅；列表变化时打印去重后的 `[变化]` 日志

#### Scenario: 清理退订
- **WHEN** 插件清理函数 `window.__sessionTagCleanup` 被调用
- **THEN** 遍历所有退订函数并执行，不再有订阅与日志输出

### Requirement: 上下文解析
客户端插件 SHALL 从 `ctx.sessions.selection.getSnapshot().sessionId` 获取当前会话 ID，并按 `workspaces[].sessionIds` 匹配当前会话所属工作区。

#### Scenario: 获取当前会话 ID
- **WHEN** `ctx.sessions.selection` 可用且快照含 `sessionId`
- **THEN** 返回该 `sessionId`；快照为空或服务不可用时返回 `null`

#### Scenario: 匹配所属工作区
- **WHEN** 给定会话 ID 与工作区列表
- **THEN** 返回首个 `sessionIds` 包含该会话 ID 的工作区；未命中时降级返回第一个工作区并 `console.warn`

### Requirement: 模块归属
客户端端代码 SHALL 位于 `packages/dsh-session-client/` 目录，入口文件为 `src/index.ts`；服务类型声明位于根目录 `types/deepseek-ai.d.ts`。

#### Scenario: 目录结构
- **WHEN** 查看客户端端插件目录与类型文件
- **THEN** 包含 `src/index.ts`（订阅与解析逻辑）与 `types/deepseek-ai.d.ts`（`ClientContext` 补充 `sessions.list`/`selection`、`workspaces.list`），遵循双包拆分规范