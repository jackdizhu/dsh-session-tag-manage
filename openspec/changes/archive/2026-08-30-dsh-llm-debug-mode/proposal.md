## Why

在 `dsh-skills-auto-enable` 宿主插件开发与联调阶段，需要一种方式在不产生真实模型费用、也不触发真实模型副作用的前提下，观测**每一轮真实 LLM 请求参数**（provider / model / messages / system / tools / sessionId / purpose）。框架的 `llm/stream` 瀑布事件在真实适配器流之前发出，是"在真实 LLM 接口调用前拦截"的唯一正确扩展点。本变更新增**调试模式配置**（默认开启），在 `llm/stream` 拦截真实调用、将清洗后的请求参数落盘临时文件、并以一条合成助手消息让会话正常结束，从而把"真实模型调用"替换为"可审计的参数快照 + 占位回复"。

## What Changes

- **新增调试模式配置**：`AutoEnableConfig.debug` = `{ enabled, domain, reply }`，默认 `enabled:true`、`domain:'dsh-llm-debug'`、`reply:'[DEBUG] LLM call blocked; request params recorded to storageDomain.'`。
- **新增 `src/debug.ts`**：`installDebugMode(ctx, store)` 在插件 `apply()` 中调用，监听 `ctx.on('llm/stream', ...)`。
  - **拦截（默认开启）**：不调用 `next()`，先 `await record(rec)`（清洗 `GenerateOptions`、剔除不可序列化的 `signal`、深拷贝），再 `yield*` 一条合成的 `block-start → text-delta → block-end → finish` 分块序列（与真实适配器同构），使会话按正常助手消息结束。
  - **落盘**：优先走 `ctx.storage` 枢纽 json 后端 KV 单元（`dsh_llm_debug` / 表 `requests`，持久化到 `~/.dsh/storages/dsh_llm_debug.json`）；`storage`/`storageDomain` 在宿主根插件不可 inject（确认的限制），不可用时**回退 `os.tmpdir()` 下的 `${debug.domain}-<uuid>.json` 临时文件**，保证"参数写入临时文件"这一核心诉求不被阻断。
  - **关闭（默认路径相反）**：`debug.enabled=false` 时透传 `next()`，行为等同不装此插件（真实 LLM 正常执行、不落盘）。
- **`src/config.ts`**：新增 `DebugConfig` 接口与 `defaultConfig().debug`；`reload()` 合并 `debug:{ ...default, ...parsed.debug }`。
- **`src/index.ts`**：`apply()` 中 `installDebugMode(ctx, store)`；`inject` 维持 `['agents','skills']`（`llm/stream` 事件冒泡到宿主根，`ctx.on` 可用；`storage` 经受 try/catch 保护的 `ctx.storage` 访问，不可达转回退）。
- **`__tests__/debug.test.ts`**：覆盖"开启→拦截且不调 next、合成分块序列、剔除 signal、记录落盘"与"关闭→透传 next、不记录"两条路径。
- **类型声明 `types/deepseek-ai.d.ts`**：补充 `@deepseek-ai/dsh-llm`（`GenerateOptions`/`StreamChunk` 子集）与 `ctx.storage` 枢纽 json 后端 KV 形态，支撑类型安全。

## Capabilities

### New Capabilities

- `skill-llm-debug-mode`：`dsh-skills-auto-enable` 宿主插件内置的调试模式——默认开启，在真实 LLM 接口调用前拦截 `llm/stream`，将清洗后的请求参数写入临时文件并合成助手回复，使开发期可零成本观测每轮模型请求、且模型无真实副作用。

### Modified Capabilities

- `skill-visibility-control`：新增"调试模式"作为同插件的可选开关，不影响既有"技能可见性控制"行为；调试关闭时本插件对 LLM 链路完全透明。

## Impact

- **代码结构**：新增 `packages/dsh-skills-auto-enable/src/debug.ts`、`__tests__/debug.test.ts`；修改 `src/config.ts`（`DebugConfig` + `defaultConfig().debug`）、`src/index.ts`（`installDebugMode` 调用）、`types/deepseek-ai.d.ts`（`dsh-llm` / `ctx.storage` 声明）。
- **依赖**：仅依赖宿主运行时 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`（类型）与 node 内置 `node:crypto`/`node:fs`/`node:os`/`node:path`；不新增外部依赖。
- **构建**：纳入现有 `tsdown` 构建（ESM，external `@deepseek-ai/*`）。
- **API 兼容性**：仅消费 `llm/stream` 事件（框架公开瀑布事件）与 `ctx.storage`（受 try/catch 保护、不可达即回退），不改任何框架 API。
- **风险点**：① `llm/stream` 监听器必须是 `async function*`，且**先 `await record(rec)` 再 `yield* debugStream`**——否则 fire-and-forget 落盘会随会话结束前进程退出而丢失；② `storage`/`storageDomain` 在宿主根插件不可 inject（与早前 `agent.ctx.skills` 同源限制），故落盘以 `os.tmpdir()` 回退为保证路径，storage 枢纽为最佳努力；③ 回退临时文件名前缀取 `debug.domain`，保持与 storageDomain 命名语义一致。

## 验证步骤

1. **typecheck / build / test**：`tsc --noEmit` 0；`tsdown` 0；`vitest run packages/dsh-skills-auto-enable` 全绿（含 `debug.test.ts` 2 用例）。
2. **headless 拦截（默认开启）**：`dsh --profile headless --patch headless-test-patch.yml "<prompt>"` → 回复为 `[DEBUG] LLM call blocked; request params recorded to storageDomain.`，且 `os.tmpdir()/dsh-llm-debug-<uuid>.json` 生成，内容为清洗后的 `GenerateOptions`（`signal` 已剔除、`messages/system/tools` 完整）。
3. **headless 透传（关闭）**：将 `dsh-skills-auto-enable-config.json` 的 `debug.enabled` 改为 `false` 后重跑 → 回复为真实模型内容（如 "你好！我是运行在 DeepSeek Harness 框架中的 AI 编码助手…"），且不生成任何 `dsh-llm-debug-*.json`。
