# Spec: Workspace Tag Query API

## Overview

工作区会话标签查询接口能力。宿主插件注册 `POST /dsh-session-tag-manage/workspace.list.tag` HTTP 路由，接收 `workspaceId` 参数，从存储域查询该工作区下所有会话的标签数据并返回。响应格式严格遵循 `apiDocs/dsh-session-tag-manage_workspace.list.tag.md` 文档。模块归属：`packages/dsh-session-host/`。

## Requirements

### Requirement: 路由注册

宿主插件 SHALL 通过 `ctx.webServer` 注册 `POST /dsh-session-tag-manage/workspace.list.tag` 路由。

#### Scenario: 路由路径规范

- **WHEN** 宿主插件注册 HTTP 路由
- **THEN** 路由路径为 `/dsh-session-tag-manage/workspace.list.tag`，遵循 DSH 宿主接口命名约定

#### Scenario: 仅接受 POST 方法

- **WHEN** 客户端向该路由发起 GET 请求
- **THEN** 返回 HTTP 405，响应体 `{ "ok": false, "error": "method-not-allowed" }`

### Requirement: 请求参数解析

路由 SHALL 从 POST 请求体中解析 `workspaceId` 参数。

#### Scenario: 正常请求

- **WHEN** 客户端发送 `POST /dsh-session-tag-manage/workspace.list.tag`，请求体为 `{ "workspaceId": "b0bbf7d6-2ea9-44d1-8741-4480c3f6ded0" }`
- **THEN** 路由成功解析 `workspaceId` 参数

#### Scenario: 缺少 workspaceId

- **WHEN** 客户端发送请求体中缺少 `workspaceId` 字段
- **THEN** 返回 HTTP 400，响应体 `{ "ok": false, "error": "workspace-id-required" }`

#### Scenario: 无效 JSON 请求体

- **WHEN** 客户端发送的请求体不是合法 JSON
- **THEN** 返回 HTTP 400，响应体 `{ "ok": false, "error": "invalid-json" }`

### Requirement: 数据查询与响应

路由 SHALL 从存储域查询指定工作区的会话标签数据，返回符合 API 文档格式的响应。

#### Scenario: 工作区存在且有数据

- **WHEN** 存储域中存在 `workspaceId` 对应的数据且 `sessions` 数组非空
- **THEN** 返回 HTTP 200，响应体格式：
  ```json
  {
    "type": "server-response",
    "rpcId": "<请求中的 rpcId>",
    "result": {
      "ok": true,
      "value": {
        "items": [
          {
            "sessionId": "session-xxx",
            "title": "会话标题",
            "sessionCurrentTag": "任务进行中",
            "createdAt": "2026-08-16T07:51:06.460Z",
            "updatedAt": "2026-08-29T01:51:07.535Z"
          }
        ]
      }
    }
  }
  ```

#### Scenario: 工作区不存在

- **WHEN** 存储域中不存在 `workspaceId` 对应的数据
- **THEN** 返回 HTTP 200，响应体中 `items` 为空数组 `[]`

### Requirement: 错误处理

路由 SHALL 对存储域读取失败进行兜底处理。

#### Scenario: 存储域读取异常

- **WHEN** 存储域打开或读取过程中抛出异常
- **THEN** 返回 HTTP 500，响应体 `{ "ok": false, "error": "storage-read-failed" }`

### Requirement: 模块归属

路由代码 SHALL 位于 `packages/dsh-session-host/src/index.ts`，共享类型位于 `packages/dsh-session-host/src/contract.ts`。

#### Scenario: 目录结构

- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `src/index.ts`（路由实现）和 `src/contract.ts`（共享类型）
