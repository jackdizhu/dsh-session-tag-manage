# fileReferences.list

## 接口 (Interface)
- 命名空间 (Namespace): `fileReferences`
- 方法名 (Method): `list`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/file-references.ts`（`SessionFileReferences`，`namespace: 'fileReferences'`，`@Remote list`）
- 功能说明: 列出某个 Agent 工作目录下、`@` 引用触发的文件与目录候选，返回确定性的纯路径候选（来自组合的 file-reference provider）。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `agent` | `Agent` | 是 | 由 wire 上的 Session 标识解析出的目标 Agent（客户端不直接构造，由 Host 从 session 解析）。 |
| `query` | `string` | 是 | `@` 或 `@"` 之后的路径文本。 |
| `signal` | `AbortSignal` | 是 | 调用方取消信号。 |

> 注：生成客户端在浏览器侧以 `ctx.remote.fileReferences.list(sessionId, query, signal)` 暴露——`sessionId` 由客户端传入，Host 端 `list()` 首参 `agent` 由 `sessionId` 解析得到（见 `file-references.ts`）。

## 出参 (Response / Output)
- 返回类型: `Promise<FileReferenceCandidate[]>`（生成客户端 `ctx.remote.fileReferences.list` 返回 `RemoteResult<FileReferenceCandidate[]>`）
- 结构（`FileReferenceCandidate`，来自 `@deepseek-ai/dsh-file-reference/types`）：
| 字段 | 类型 | 说明 |
|---|---|---|
| `value` | `string` | 候选路径/引用值。 |
| `fileKind` | `'file' \| 'directory'` | 候选类型。 |
| （其它） | — | 由 `FileReferenceCandidate` 定义（路径元数据、展示名等）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-reference/src/client/index.ts:51`（`@` 触发源的 `candidates(...)`）。
- 调用方式: `const fileLookup = ctx.remote.fileReferences.list(session.sessionId, query, signal).then(result => result.ok ? result.value : [], () => []);`
- 入参构造: 由输入触发上下文的 `sessionId`、当前 `@` 查询 `query`、以及 `signal`（输入防抖/取消）传入。
- 响应/流处理: 与 `sessionReferenceResolver.candidates` 并行（`Promise.all`）；文件候选经 `fileCandidate(...)` 映射为提及候选项，连同会话候选一并渲染引用菜单；`signal.aborted` 时返回空。失败（reject）降级为空数组，不阻断会话引用候选。
- 错误处理: 失败由 `.then` 第二参数降级为 `[]`；底层 `TypertRemoteFailure`（如会话不可见/provider 错误）归一到 `{ ok: false }`。业务层对文件候选失败静默处理。
