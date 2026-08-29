## MODIFIED Requirements

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

### Requirement: 模块归属

宿主端代码 SHALL 位于 `packages/dsh-session-host/` 目录，入口文件为 `src/index.ts`，接入上下文参数不进其他包。

#### Scenario: 目录结构

- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `src/index.ts`，路由处理器通过 `new URL(req.url)` 解析查询参数，遵循双包拆分规范