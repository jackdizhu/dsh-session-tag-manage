# session.modelCatalog

## 接口 (Interface)
- 命名空间 (Namespace): `session`
- 方法名 (Method): `modelCatalog`
- 调用模式 (Mode): 一元调用 (unary)（无请求体）
- 来源文件: `packages/api/session-controller/src/index.ts`（`@Remote('modelCatalog')`）、`packages/api/session-controller/src/catalog.ts`（`buildModelCatalog()`）
- 功能说明: 无需会话即可描述当前可路由的所有模型，供 Host 端生成的模型选择器使用；返回按 provider 分组、部署默认选择以及隔离的 provider 失败。

## 入参 (Request / Input)
无（一元调用，无请求体）。

## 出参 (Response / Output)
- 返回类型: `ModelCatalog`
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `default` | `ModelSelection` | 部署默认选择（`provider`、`model`、`reasoningEffort?`）。 |
| `routableProviders` | `readonly string[]` | 当前能够服务请求的 provider 路由（含空目录）。 |
| `groups` | `readonly ModelProviderGroup[]` | 成功加载且非空的 provider 模型组。 |
| `groups[].id` | `string` | provider id。 |
| `groups[].name` | `string` | provider 显示名。 |
| `groups[].models` | `readonly ModelCatalogModel[]` | 该 provider 下的模型。 |
| `groups[].models[].id`/`name` | `string` | 模型 id / 显示名。 |
| `groups[].models[].description?` | `string` | 模型描述。 |
| `groups[].models[].reasoning?` | `ModelReasoning` | 可选推理强度（`efforts`、`defaultEffort?`）。 |
| `failures` | `readonly ModelCatalogFailure[]` | 加载失败的 provider（`id`、`name`、`message`）。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-model-selection/src/client/catalog.ts:41`（`ModelCatalogDirectory.load()`）；`ui-settings-plugins/src/client/subagent-model-selection-card-controller.ts:324`（`loadCatalog()`）。
- 调用方式: `const response = await this.session.modelCatalog();`（生成客户端 `ClientRemote['session'].modelCatalog`，返回 `RemoteResult<ModelCatalog>`）。
- 入参构造: 无请求体。
- 响应/流处理: 全局共享的 `ModelCatalogDirectory` 缓存单飞加载结果到 `SnapshotStore`（status: idle→loading→ready/error）；`ui-settings-plugins` 的卡片将其 `groups`/`failures` 写入本地状态渲染。`failures.length > 0` 时标记 `catalogPartial`（部分可用）。Host 模型输入变化时经连接重置触发 `refresh()`/`resetGeneration()` 重新加载。
- 错误处理: 失败以 `{ ok: false, error: { code, message } }` 返回（通常为 `internal`）；加载异常被捕获并置 `status='error'`、暴露 `error` 文案，不阻断选择器打开。传输层异常表现为 `TypertRemoteFailure`。
