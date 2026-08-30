# dsh-session-host-test

## 接口 (Interface)
- 命名空间 (Namespace): `dsh-session-tag-manage`（诊断/探针路由，无 RPC 方法名）
- 方法名 (Method): `dsh-session-host-test`（GET，URL 查询参数驱动）
- 路由 (Route): `/dsh-session-host-test`
- 调用模式 (Mode): 一元调用 (unary) / HTTP GET（非 RPC 信封，纯 query string）
- 来源文件: `packages/dsh-session-host/src/index.ts`（注册 `/dsh-session-host-test` 处理器）、`packages/dsh-session-host/src/utils/file-storage.ts`（`writeWorkspaceTags` / `readWorkspaceTags`）
- 功能说明: 宿主端诊断/探针端点。无参时返回服务端时间戳与当前激活文件夹/会话的回声；提供 `testWrite` 参数时，以该值为 `workspaceId` 创建一条示例 `SessionTagEntry` 并写入存储，验证 `~/.dsh/storages/dsh_session_tag__{workspaceId}.json` 路径与读写链路是否可用。

## 入参 (Request / Input)
通过 URL 查询参数（query string）传递，均为可选：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `folderActive` | `string` | 否 | 回声参数，原样回显到响应。 |
| `sessionCurrent` | `string` | 否 | 回声参数，原样回显到响应。 |
| `testWrite` | `string` | 否 | 若提供，作为 `workspaceId` 写入一条测试会话标签，并返回写入结果。 |

## 出参 (Response / Output)
- 返回类型：JSON 对象（`res.writeHead(200, { 'content-type': 'application/json' })` 直接 `JSON.stringify`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `serverTime` | `number` | 服务端当前时间戳（`Date.now()`）。 |
| `folderActive` | `string \| null` | 回显的 `folderActive` 查询参数。 |
| `sessionCurrent` | `string \| null` | 回显的 `sessionCurrent` 查询参数。 |
| `testWrite` | `object` | 仅当 `testWrite` 参数存在时返回，含：`workspaceId`(string)、`fileCreated`(boolean，读回是否非空)、`itemsWritten`(number，读回条目数)、`storagePath`(string，`~/.dsh/storages/dsh_session_tag__{workspaceId}.json`)。 |

**说明**：该端点不返回 `{ ok, error }` 结构，始终 200。无独立错误码。

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: **当前客户端插件未消费此端点**。`packages/dsh-session-client/src/index.ts` 的 canvas 点击逻辑只调用 `fetchWorkspaceListTag` 与 `fetchWorkspaceSessionTag`，不发起对 `/dsh-session-host-test` 的请求。
- 用途定位: 纯宿主侧诊断工具，通常经浏览器地址栏、DevTools 或外部脚本以 GET 方式手动访问（例如 `GET /dsh-session-host-test?testWrite=ws-demo&folderActive=ws1`）。不属于 plugin-api 的正式 RPC 消费链路，故无 web 端处理逻辑可记录。
