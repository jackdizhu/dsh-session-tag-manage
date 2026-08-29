# Spec: Host HTTP Interface

## Overview

宿主插件基础能力。宿主插件（`dsh-session-tag-manage-host`）通过 Cordis 框架加载，使用 `ctx.webServer` 注册 `/dsh-session-host-test` HTTP 路由，无参返回当前服务端时间戳；并遵循 Cordis 插件规范管理生命周期。宿主代码位于 `packages/dsh-session-host/`（双包拆分，与客户端端分离）。

## Requirements

### Requirement: 宿主 HTTP 接口注册
宿主插件 SHALL 通过 `ctx.webServer` 注册 `/dsh-session-host-test` HTTP 路由，无参返回当前服务端时间戳。

#### Scenario: 获取服务端时间
- **WHEN** 客户端向 `/dsh-session-host-test` 发起 GET 请求
- **THEN** 返回 JSON 格式响应 `{ "serverTime": <epoch_ms> }`，HTTP 状态码为 200

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

### Requirement: 模块归属
宿主端代码 SHALL 位于 `packages/dsh-session-host/` 目录，入口文件为 `src/index.ts`。

#### Scenario: 目录结构
- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `package.json`、`src/index.ts`，遵循双包拆分规范