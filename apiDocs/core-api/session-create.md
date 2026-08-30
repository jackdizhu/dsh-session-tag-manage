# session.create

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `create`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('create')`）、`packages/api/session-controller/src/commands.ts`（`create()`）
- 功能说明: 创建或幂等接管（显式指定 `sessionId` 时）一个普通会话，返回会话标识及解析后的 agent preset。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspaceId?` | `WorkspaceId`（`string` 品牌类型） | 否 | 目标工作区；与 `cwd` 互斥。 |
| `cwd?` | `string` | 否 | 显式项目目录；与 `workspaceId` 互斥。两者皆缺时使用默认 cwd。 |
| `sessionId?` | `SessionId` | 否 | 显式会话标识；提供则为幂等 adopt（若不存在则创建），否则随机生成。 |
| `agentPreset?` | `string` | 否 | 请求的 Agent preset 名称。 |

## 出参 (Response / Output)
- 返回类型: `SessionCreateValue`
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `SessionId` | 创建/接管的会话标识。 |
| `agentPreset?` | `string` | 实际解析到的 Agent preset（未配置时省略）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-workspace/src/client/navigation.ts:109`（`UiWorkspaceService.startSession(workspaceId)` 经 `sessions.create({ workspaceId })`）；`ui-chat/src/client/apply.ts:140`、`ui-workspace/src/client/index.ts:112` 走 `sessions.fork` 而非 create；测试见 `connection/tests/fixture.client.spec.ts`。
- 调用方式: `const childId = await sessions.create({ workspaceId });`（生成客户端 `ISessions.create`，返回 `RemoteResult<SessionCreateValue>`）。
- 入参构造: 通常仅传 `{ workspaceId }`（来自目录选择器）或 `{ cwd }`；`sessionId` 仅在幂等接管场景由上层传入。
- 响应/流处理: 成功后拿到 `sessionId`，随后调用 `sessions.open(sessionId)` 切换当前会话；新会话通过 Host `session/created` 事件进入 `api-session/added` 列表增量更新，无需手动刷新。
- 错误处理: 失败以 `{ ok: false }` 形式返回，常见码：`bad-request`（同时传 `workspaceId` 与 `cwd`）、`workspace-not-found`、`workspace-attach-failed`、`session-conflict`、`agent-preset-conflict`/`agent-preset-not-found`/`agent-preset-invalid`、`subagent-*`、`internal`。`ui-workspace` 在 catch 中保留当前选择、不切换视图。
