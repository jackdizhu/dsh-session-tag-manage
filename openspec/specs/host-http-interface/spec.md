# Spec: Host HTTP Interface

## Overview

宿主插件基础能力。宿主插件（`dsh-session-tag-manage-host`）通过 Cordis 框架加载，使用 `ctx.webServer` 注册 `/dsh-session-host-test` HTTP 路由，无参返回当前服务端时间戳；同时可解析 `folderActive`（工作区 ID）与 `sessionCurrent`（会话 ID）查询参数并在响应中原样回显；并遵循 Cordis 插件规范管理生命周期。宿主代码位于 `packages/dsh-session-host/`（双包拆分，与客户端端分离）。

## Requirements

### Requirement: 宿主 HTTP 接口注册
宿主插件 SHALL 通过 `ctx.webServer` 注册 `/dsh-session-host-test` HTTP 路由，无参返回当前服务端时间戳。

#### Scenario: 获取服务端时间
- **WHEN** 客户端向 `/dsh-session-host-test` 发起 GET 请求
- **THEN** 返回 JSON 格式响应 `{ "serverTime": <epoch_ms> }`，HTTP 状态码为 200

#### Scenario: 接口路径规范
- **WHEN** 宿主插件注册 HTTP 路由
- **THEN** 路由路径以 `/dsh-session-host-` 开头，遵循 DSH 宿主接口命名约定

### Requirement: 宿主 HTTP 接口上下文参数
宿主插件 SHALL 扩展 `/dsh-session-host-test` HTTP 路由，从请求解析查询参数 `folderActive`（工作区 ID）与 `sessionCurrent`（会话 ID），并在响应中原样回显。

#### Scenario: 带参请求返回上下文
- **WHEN** 客户端向 `/dsh-session-host-test?folderActive=ws-123&sessionCurrent=sess-456` 发起 GET 请求
- **THEN** 返回 HTTP 200，JSON 响应含 `serverTime`、`folderActive: "ws-123"`、`sessionCurrent: "sess-456"` 字段

#### Scenario: 无参请求返回默认值（向后兼容）
- **WHEN** 客户端向 `/dsh-session-host-test`（不带查询参数）发起 GET 请求
- **THEN** 返回 HTTP 200，JSON 响应中 `folderActive` 与 `sessionCurrent` 均为 `null`，不影响既有调用方

#### Scenario: 接口路径规范
- **WHEN** 宿主插件注册 HTTP 路由
- **THEN** 路由路径以 `/dsh-session-host-` 开头，遵循 DSH 宿主接口命名约定

### Requirement: 插件生命周期管理
宿主插件 SHALL 通过 Cordis 框架加载，插件导出 `name`、`inject`、`apply` 符合 Cordis 插件规范。

#### Scenario: 插件初始化
- **WHEN** 宿主插件通过 Cordis 框架加载
- **THEN** 调用 `ctx.webServer.register()` 注册路由，路由在插件生命周期内有效

#### Scenario: 插件卸载清理
- **WHEN** 宿主插件被卸载
- **THEN** 已注册的 HTTP 路由自动清理，不残留

### Requirement: 工作区会话标签查询接口
宿主插件 SHALL 注册 `POST /dsh-session-tag-manage/workspace.list.tag` 路由，接收 `workspaceId` 参数，返回该工作区下所有会话的标签数据。

#### Scenario: 正常查询
- **WHEN** 客户端发送 `POST /dsh-session-tag-manage/workspace.list.tag`，请求体为 `{ "workspaceId": "ws-xxx" }`
- **THEN** 返回 HTTP 200，响应体包含 `items` 数组（`SessionTagEntry[]`）

#### Scenario: 缺少参数
- **WHEN** 请求体中缺少 `workspaceId`
- **THEN** 返回 HTTP 400，响应体 `{ "ok": false, "error": "workspace-id-required" }`

### Requirement: 模块归属
宿主端代码 SHALL 位于 `packages/dsh-session-host/` 目录，入口文件为 `src/index.ts`，共享类型位于 `src/contract.ts`，接入上下文参数不进其他包。

#### Scenario: 目录结构
- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `package.json`、`src/index.ts`、`src/contract.ts`，遵循双包拆分规范

#### Scenario: 上下文参数解析实现
- **WHEN** 路由处理器解析上下文参数
- **THEN** 通过 `new URL(req.url)` 解析查询参数，遵循双包拆分规范，且上下文参数接入不进入其他包