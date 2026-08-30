# skills.list

## 接口 (Interface)
- 命名空间 (Namespace): `skills`
- 方法名 (Method): `list`
- 调用模式 (Mode): 一元调用 (unary)
- 来源文件: `packages/api/session-controller/src/skill-catalog.ts`（`SessionSkillCatalog`，`namespace: 'skills'`，`@Remote list`）
- 功能说明: 列出对某个会话组合可见、且用户可调用（user-invocable）的技能，无需加载技能体；返回技能元信息。

## 入参 (Request / Input)
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sessionId` | `SessionId` | 是 | 决定 cwd 与 preset 视图的会话标识。 |

## 出参 (Response / Output)
- 返回类型: `SkillListValue`（生成客户端 `ctx.remote.skills.list` 返回 `RemoteResult<...>`）
- 结构：
| 字段 | 类型 | 说明 |
|---|---|---|
| `skills` | `readonly SkillEntry[]` | 用户可调用技能数组。 |
| `skills[].name` | `string` | kebab-case 标识（以 `/name` 引用）。 |
| `skills[].description` | `string` | 简短路由描述。 |
| `skills[].whenToUse?` | `string` | 可选额外路由指引。 |
| `skills[].modelInvocable` | `boolean` | 该技能是否同时向模型暴露。 |

## web端处理逻辑 (Client / Web-side processing)
- 调用位置: `ui-skill/src/client/index.ts:101`（`fetchCatalog(sessionId)`）。
- 调用方式: `const result = await skills.list({ sessionId }, abort.signal);`（生成客户端 `ctx.remote.skills.list`，返回 `RemoteResult<SkillListValue>`）。
- 入参构造: 由当前 `sessionId` 与 `AbortController.signal` 组装；子 agent 地址（`sessions.subagentAddress(sessionId)`）直接返回空数组，不发起请求。
- 响应/流处理: 成功后将技能数组写入每会话缓存（`settled`），并通过 `notifyLexicon` 通知同步 lexical 读取方；请求做单飞（`fetches` 去重），失败时删除缓存项以便下次重试。`SkillEntry` 用于 composer 的 `/` 技能触发与路由。
- 错误处理: 失败以 `{ ok: false, error: { code, message } }` 返回，常见码：`session-not-found`、`internal`（无 cwd / 无技能注册表 / 列表失败）；失败被 catch 并清空缓存，不阻断输入。
