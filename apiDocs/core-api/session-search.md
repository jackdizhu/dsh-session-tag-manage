# session.search

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `search`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('search')`）、`packages/api/session-controller/src/list.ts`（`search()`）
- 功能说明: 在可见会话的当前消息内容中做字面量全文检索，无需恢复任何匹配会话，返回有界且不重复的会话搜索结果。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `query` | `string` | 是 | 字面量消息内容查询串；自动 `trim()`，长度上限 `SESSION_SEARCH_QUERY_MAX_CHARS`（500 UTF-16 单元），禁止包含 NUL。 |

## 出参 (Response / Output)
- 返回类型: `SessionSearchValue`
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | `readonly SessionSearchItem[]` | 命中会话数组，最多 `SESSION_SEARCH_RESULT_LIMIT`（20）条，跨会话去重。 |
| `hasMore` | `boolean` | 是否还有更多未返回结果（超出上限时为真）。 |

`SessionSearchItem` 字段：
| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `SessionId` | 命中会话标识。 |
| `snippet` | `string` | 命中内容片段，最多 `SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS`（240）码点。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-workspace/src/client/index.ts:83`（`searchSessions` 注入项），由 `WorkspaceBrowser` 的搜索框触发；同时 `sessions.searchResultLimit` 暴露为注入常量（`index.ts:102`）。
- 调用方式: `const result = await sessions.search(query, signal);`（生成客户端 `ISessions.search`，返回 `RemoteResult<SessionSearchValue>`）。
- 入参构造: 取搜索框输入 `query`（原始字符串）+ 传入的 `AbortSignal`；不额外包装。
- 响应/流处理: `searchSessions` 在 `result.ok` 为真时返回 `result.value`（一组 `{ sessionId, snippet }`），供工作区浏览器渲染搜索卡片；`hasMore` 可用于「更多结果」提示。`signal` 用于输入防抖/取消。
- 错误处理: `if (!result.ok) throw new Error(result.error.message)`；常见失败码 `bad-request`（空查询/超长/含 NUL）、`cancelled`、`internal`。传输失败归为 `TypertRemoteFailure`，由连接层处理。
