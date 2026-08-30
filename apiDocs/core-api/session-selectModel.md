# session.selectModel

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `selectModel`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('selectModel')`）、`packages/api/session-controller/src/commands.ts`（`selectModel()`）
- 功能说明: 在显式恢复会话后，选择并持久化一个会话级模型（provider/model/可选 reasoningEffort），返回规范化后的选中结果。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 目标会话标识。 |
| `provider` | `string` | 是 | 模型所属 provider id。 |
| `model` | `string` | 是 | provider 下的模型 id。 |
| `reasoningEffort?` | `string` | 否 | 该模型路由下可选的推理强度 id。 |

## 出参 (Response / Output)
- 返回类型: `SessionSelectModelValue`
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `selected` | `ModelSelection` | 规范化并安装后的选择。 |
| `selected.provider` | `string` | 解析后的 provider。 |
| `selected.model` | `string` | 解析后的模型。 |
| `selected.reasoningEffort?` | `string` | 解析后的推理强度（若提供）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-model-selection/src/client/directory.ts:92`（`ModelSelectionDirectory.select()`）。
- 调用方式: `const result = await this.sessions.selectModel({ sessionId, provider, model, ...(reasoningEffort) });`（生成客户端 `ISessions.selectModel` 或 `SessionFace.selectModel`，返回 `RemoteResult<SessionSelectModelValue>`）。
- 入参构造: 由模型选择卡片的 `ModelSelection`（`provider`/`model`/`reasoningEffort`）加上当前 `sessionId` 组装；选中项来自 `modelCatalog` 返回的目录。
- 响应/流处理: 成功后将 `store` 置为 `ready` 并 `syncInputs()` 同步输入控件；随后 Host 通过 `session/event`（`model/selection`）与投影帧 `projection`（`modelSelection`）把选择下发到共享当前态。
- 错误处理: 失败以 `{ ok: false }` 返回，常见码：`model-unavailable`（provider/model 解析失败或无可服务适配器）、`session-not-found`、`session-conflict`、以及 agent 恢复相关错误。UI 在 store 写入 `error` 状态并 `throw`，由各条目自身的重试入口处理。
