<!-- 模块归属：packages/dsh-skills-auto-enable（宿主端插件） -->

## ADDED Requirements

### Requirement: 调试模式默认开启并在真实 LLM 调用前拦截

宿主插件 `dsh-skills-auto-enable` SHALL 提供调试模式配置 `AutoEnableConfig.debug`，默认 `enabled:true`；SHALL 在 `llm/stream` 瀑布事件（绑定于 `ctx.llm`，由 `LlmRuntime` 发出，事件冒泡到宿主根）中于真实适配器流之前拦截：不调用 `next()`，先 `await record(rec)`，再 `yield*` 一条与真实适配器同构的 `block-start → text-delta → block-end → finish` 合成分块序列，使会话按正常助手消息结束、真实模型不产生调用与费用。

#### Scenario: 默认拦截真实调用

- **GIVEN** 配置文件 `debug.enabled` 为 `true`（缺省）
- **WHEN** 会话进入任一 `llm/stream`（含主回复生成与 `session-title` 等辅助调用）
- **THEN** 监听器不调用 `next()`，回复为 `debug.reply` 合成文本，真实模型不被请求

#### Scenario: 关闭后透传真实调用

- **GIVEN** 配置文件 `debug.enabled` 为 `false`
- **WHEN** 会话进入 `llm/stream`
- **THEN** 监听器调用 `next()` 透传真实适配器，行为等同不装此插件，不落盘

### Requirement: 拦截时将清洗后的请求参数写入临时文件

拦截发生时，插件 SHALL 将清洗后的 `GenerateOptions` 落盘：剔除不可序列化的 `signal`（`AbortSignal`）并深拷贝为可 JSON 化的副本，记录结构含 `id` / `sessionId?` / `purpose?` / `provider` / `model` / `time` / `request`。落盘 SHALL 优先走 `ctx.storage` 枢纽 json 后端 KV 单元（`dsh_llm_debug` / 表 `requests`，持久化到 `~/.dsh/storages/dsh_llm_debug.json`）；当 `storage`/`storageDomain` 在宿主根插件不可 inject 而不可达时，SHALL 回退写 `os.tmpdir()` 下 `${debug.domain}-<uuid>.json` 临时文件，保证"参数写入临时文件"这一核心诉求不被阻断。

#### Scenario: 回退临时文件生成

- **GIVEN** 宿主根插件无法 inject `storage`（确认的限制），`debug.domain` 为 `dsh-llm-debug`
- **WHEN** 调试模式拦截一次 `llm/stream`
- **THEN** `os.tmpdir()/dsh-llm-debug-<uuid>.json` 生成，内容为含完整 `messages`/`system`/`tools` 的 `LlmDebugRequest`，且 `request` 中**不含** `signal`

#### Scenario: 请求参数被清洗

- **GIVEN** 一次真实 `llm/stream` 的 `options` 含 `signal` 与 `messages`/`system`/`tools`
- **WHEN** `sanitize(options)` 处理
- **THEN** 落盘 `request` 含 `messages`/`system`/`tools` 等全部字段，但 `signal` 字段已被剔除且整体为深拷贝可序列化结构

### Requirement: 落盘时序先于合成回复

监听器 SHALL 为 `async function*`，并在 `yield* debugStream(...)` 之前 `await record(rec)` 完成，确保会话结束前参数文件已写入；不得采用 fire-and-forget（`void record(...)`）以免进程在落盘完成前退出导致文件丢失。

#### Scenario: 参数文件在会话结束前落盘

- **GIVEN** 调试模式开启且 `storage` 不可达（走 `os.tmpdir` 回退）
- **WHEN** 一次 `llm/stream` 被拦截
- **THEN** 监听器返回合成流之前，对应 `dsh-llm-debug-<uuid>.json` 已存在于临时目录

### Requirement: 配置项语义

`debug` 配置 SHALL 含：
- `enabled: boolean` —— 是否拦截真实 LLM，默认 `true`；
- `domain: string` —— 回退临时文件名前缀（呼应 storageDomain 命名），默认 `dsh-llm-debug`；
- `reply: string` —— 拦截后返回的合成助手消息文本，默认 `[DEBUG] LLM call blocked; request params recorded to storageDomain.`。
`reload()` SHALL 合并 `debug:{ ...defaultConfig().debug, ...parsed.debug }`，缺字段回退默认；`fs.watch` 热更新对 `debug.enabled` 即时生效。

#### Scenario: 缺字段回退默认

- **GIVEN** 配置文件 `debug` 字段缺失或部分缺失
- **WHEN** `ConfigStore` 加载/热重载
- **THEN** 缺失子字段以 `defaultConfig().debug` 补全（如 `enabled` 仍为 `true`）

### Requirement: 模块归属

调试模式代码 SHALL 位于 `packages/dsh-skills-auto-enable/`（宿主端插件 `dsh-skills-auto-enable`），由 `src/debug.ts` 的 `installDebugMode(ctx, store)` 实现，在 `src/index.ts` 的 `apply()` 中调用；`inject` 维持 `['agents','skills']`，`llm/stream` 经 `ctx.on` 冒泡监听、`storage` 经受 try/catch 保护的 `ctx.storage` 访问，不修改任何 `@deepseek-ai/*` 代码。

#### Scenario: 目录结构合规

- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `src/debug.ts`、`src/config.ts`（`DebugConfig`）、`__tests__/debug.test.ts`，并在 `src/index.ts` 装配 `installDebugMode`
