# plugin-api 接口文档索引

> 来源：`packages/dsh-session-host`（宿主端，通过 `ctx.webServer.register` 注册 HTTP 路由并定义 RPC 信封协议）与 `packages/dsh-session-client`（web 端，通过 `tag-api.ts` 的 `fetch*` 函数消费）。

> 本目录共 **4** 个接口（插件自有接口），每个接口一个独立 Markdown 文件，统一包含四段：**接口 / 入参 / 出参 / web端处理逻辑**。

> 协议约定：除 `dsh-session-host-test`（GET 诊断端点）外，接口均为一元 HTTP POST，请求体支持「DSH RPC 信封 `{type:'client-request', rpcId, method, payload}`」与「简单 JSON `{...payload}`」两种格式；响应对应以「信封 `{type:'server-response', rpcId, result:{ok,value/error}}`」或「简单 JSON `{ok, value/error}`」回传，两端 (`rpcResponse` / `tagApiPost`) 均做格式兼容与 rpcId 校验。

## 总览

| 接口 | 方法 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|---|
| `workspace.list.tag` | POST | 一元 | 按工作区查询其下所有会话标签条目（SessionTagEntry 列表），文件不存在时自动建空文件。 | [workspace.list.tag.md](workspace.list.tag.md) |
| `workspace.tag.set` | POST | 一元 | 全量覆盖写入某工作区的会话标签；`deleteWorkspace=true` 且 sessions 为空时删除该工作区文件。 | [workspace.tag.set.md](workspace.tag.set.md) |
| `workspace.session.tag` | POST | 一元（内部翻页调 session.history） | 按会话查询事件数据标签统计（轮次/消息数/工具调用/用户提问/写文件/时间窗），服务端子链路调内置 `session.history`。 | [workspace.session.tag.md](workspace.session.tag.md) |
| `dsh-session-host-test` | GET | 一元（query string） | 宿主端诊断探针：返回服务端时间戳，可选 `testWrite` 触发示例文件写入以验证存储路径。 | [dsh-session-host-test.md](dsh-session-host-test.md) |

## 接口清单

### 数据查询 / 写入（命名空间 `dsh-session-tag-manage`）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `workspace.list.tag` | 一元 (POST) | 按工作区查询会话标签条目列表。 | [workspace.list.tag.md](workspace.list.tag.md) |
| `workspace.tag.set` | 一元 (POST) | 全量覆盖写入/删除工作区会话标签。 | [workspace.tag.set.md](workspace.tag.set.md) |
| `workspace.session.tag` | 一元 (POST) | 按会话查询事件数据标签统计。 | [workspace.session.tag.md](workspace.session.tag.md) |

### 诊断探针

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `dsh-session-host-test` | 一元 (GET) | 服务端时间戳与存储链路自检。 | [dsh-session-host-test.md](dsh-session-host-test.md) |

## 依赖的内置接口（非本插件定义，仅链路引用）

| 接口 | 方向 | 用途 |
|---|---|---|
| `session.history` | Host → 内置 DSH 宿主 | `workspace.session.tag` 服务端通过 `dshRpcCall('session.history')` 分页拉取会话事件流。 |
| `workspace.list` |（参考 `rpc-client.ts` 的 `fetchWorkspaceList`） | 客户端侧辅助定位当前会话所属工作区（见 client `getActiveWorkspaceId`）。 |

## web 端消费现状

- `workspace.list.tag` ✅ 已在客户端 canvas 点击逻辑中通过 `fetchWorkspaceListTag` 调用（仅 `console.log`，未渲染 UI）。
- `workspace.session.tag` ✅ 已在客户端 canvas 点击逻辑中通过 `fetchWorkspaceSessionTag` 调用（仅 `console.log`，未渲染 UI）。
- `workspace.tag.set` ⚠️ 服务端已完整实现，客户端暂无 `tag-api.ts` 封装与调用点（保留/待接入写入能力）。
- `dsh-session-host-test` ⚪ 纯宿主端诊断端点，web 端不消费。
