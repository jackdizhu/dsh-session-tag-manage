# session.openWorkspacePath

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `openWorkspacePath`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('openWorkspacePath')`）
- 功能说明: 在 Host 桌面上打开由会话感知调用方准备好的某个路径（相对路径按会话 cwd 解析）；返回原生打开器接受路径后的确认。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | `string` | 是 | 经会话工作区尽力解析后的路径，使用 Host 文件系统语法。 |

## 出参 (Response / Output)
- 返回类型: `SessionOpenWorkspacePathValue`（生成客户端包装为 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `opened` | `true` | 原生打开器已接受路径的确认常量。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-chat/src/client/apply.ts:122`（`ChatViewInjected.openFile(path)`）。
- 调用方式: `const result = await ctx.remote.session.openWorkspacePath({ path: resolveWorkspacePath(cwd, path) });`。
- 入参构造: 由消息节点中点击的文件路径，结合 `ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd` 经 `resolveWorkspacePath(cwd, path)` 解析出绝对/Host 语法路径后传入 `path`。
- 响应/流处理: `result.ok` 为真表示已在桌面打开；失败抛 `new Error(\`path open failed: ${result.error.message}\`)`，由上层 UI 提示。仅在 `canOpenWorkspacePath()` 为 `true` 且 loopback 时该动作才可见可用（见 `ui-deliverables`）。
- 错误处理: Host 端可能抛 `TypertRemoteFailure`：`bad-request`（`path` 为空）、`cancelled`（signal 中止）、`internal`（打开器失败）；生成客户端归一为 `{ ok: false, error }`，业务层读 `result.error.message`。
