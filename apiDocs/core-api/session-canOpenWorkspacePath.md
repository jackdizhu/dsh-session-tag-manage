# session.canOpenWorkspacePath

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `canOpenWorkspacePath`
- 调用模式 (Mode): 一元调用 (unary)（无请求体）
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('canOpenWorkspacePath')`，方法名由 `@Remote` 推断）
- 功能说明: 报告当前部署是否能够将会话工作区路径交给原生桌面打开器；`true` 表示匹配的原生打开操作可用。

## 入参 (Request / Input)
无（一元调用，无请求体）。

## 出参 (Response / Output)
- 返回类型: `boolean`
- 说明：生成客户端将其包装为 `RemoteResult<boolean>`（`{ ok: true, value: boolean }`）。`true` 表示存在可用的原生桌面打开器（或配置了 `nativeOpen` 覆盖）。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-deliverables/src/client/index.ts:50`（`loadWorkspacePathOpen()`）。
- 调用方式: `ctx.remote.session.canOpenWorkspacePath().then((result) => workspacePathOpen.set(result.ok && result.value), () => workspacePathOpen.set(false))`。
- 入参构造: 无请求体。
- 响应/流处理: 结果写入 `workspacePathOpen` 快照 store（`true`/`false`/`undefined`）。仅当页面为 loopback（`connection.isLoopback`）且该能力为 `true` 时，产出文件行的「在文件夹中显示」动作才会真正打开会话工作区。连接重置（`connection/reset`）时 `revision++` 并使缓存失效、按需重新探测。
- 错误处理: 调用失败（reject）在 `.then` 第二参数中置为 `false`；传输层异常表现为 `TypertRemoteFailure`。业务层不向上抛错，仅隐藏「在文件夹中显示」入口。
