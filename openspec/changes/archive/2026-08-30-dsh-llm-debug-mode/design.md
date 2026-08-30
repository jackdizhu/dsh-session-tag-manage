# 调试模式设计（dsh-llm-debug-mode）

## 1. 拦截点选型：`llm/stream` 瀑布事件

DSH 的真实模型调用经 `@deepseek-ai/dsh-llm` 的 `LlmRuntime` 发出瀑布事件 `llm/stream`。监听器签名：

```ts
ctx.on('llm/stream', async function* (options, next) {
  // options: GenerateOptions（provider/model/messages/system/tools/signal/sessionId/purpose…）
  // 调用 next() 可达真实适配器流；不调用 next() 而自行 yield* 分块即可短路
})
```

**为什么是它**：这是"真实 LLM 接口调用前"唯一可被宿主代码介入的扩展点，模式参考 `packages/test-support/llm-replay`。关键约束——该事件**冒泡到宿主根 ctx**，故宿主根插件可用 `ctx.on` 监听拦截，即便 `llm` 服务本身不可 inject。

## 2. 合成响应流（与真实适配器同构）

短路时不调 `next()`，自行产出一条与真实适配器同构的分块序列，让会话按正常助手消息结束（`@deepseek-ai/dsh-session` 才能正确落盘 `assistant/message`）：

```ts
async function* debugStream(text: string) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
```

## 3. 落盘：storage 枢纽 + `os.tmpdir()` 回退

### 3.1 期望路径（storageDomain 语义等价物）

`storageDomain`（`@deepseek-ai/dsh-storage-domain`）由框架在**嵌套 ctx** 上 provide，宿主根插件**无法 inject**（与早前 `agent.ctx.skills` 同源限制，注入会 `pending (waiting for service: storageDomain)`）。故直接走 `storage` 枢纽的 json 后端 KV 单元——同一份 `~/.dsh/storages/<unit>.json` 落盘文件，语义等价：

```ts
const backend = (ctx.storage as any).backend.get('json')
const unit = await backend.kv.open({ name: 'dsh_llm_debug', version: 1, tables: ['requests'], hasGlobal: false, layout: 'single' })
await unit.putRecord('requests', rec.id, rec)
```

> 单元名须匹配 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/`，故用 `dsh_llm_debug`（**不允许连字符**），与 config 的 `domain:'dsh-llm-debug'` 区分：`domain` 仅作临时文件名前缀，不进入 storage 单元名。

### 3.2 回退路径（保证"写入临时文件"）

`storage` 在宿主根插件同样不可 inject（`pending (waiting for service: storage)`）。故 `openUnit()` 任何失败都置 `useFallback`，转：

```ts
const prefix = store.get().debug.domain || 'dsh-llm-debug'
writeFileSync(join(tmpdir(), `${prefix}-${rec.id}.json`), JSON.stringify(rec, null, 2), 'utf-8')
```

headless/web 实测 storage 后端均不可达 → 当前稳定走此回退，文件落在 `os.tmpdir()`。

### 3.3 时序（关键坑）

`record` **必须 `await` 后再 `yield* debugStream`**。早期 `void record(rec)` 是 fire-and-forget，监听器在落盘完成前就结束、进程于会话结束前退出，导致参数文件丢失。`async function*` + `await record(rec)` 保证"会话结束前写入完成"。

## 4. 参数清洗

`GenerateOptions.signal` 为 `AbortSignal`，不可 `JSON.stringify`。`sanitize()` 剔除 `signal` 后深拷贝：

```ts
function sanitize(options) {
  const { signal, ...rest } = options            // 仅剔除 signal
  return JSON.parse(JSON.stringify(rest))        // 深拷贝 + 可序列化校验，失败退化为浅拷贝
}
```

记录结构 `LlmDebugRequest`：`{ id, sessionId?, purpose?, provider, model, time, request }`，其中 `request` 为清洗后的完整 `GenerateOptions`。

## 5. 配置与开关

`AutoEnableConfig.debug`：

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabled` | `true` | 是否拦截真实 LLM；`false` 时透传 `next()` |
| `domain` | `'dsh-llm-debug'` | 回退临时文件名前缀（呼应 storageDomain 命名） |
| `reply` | `'[DEBUG] LLM call blocked; request params recorded to storageDomain.'` | 合成助手回复文本 |

`reload()` 合并 `debug:{ ...defaultConfig().debug, ...parsed.debug }`，缺字段回退默认。`fs.watch` 热更新对 `debug.enabled` 即时生效（下一条 `llm/stream` 重新读取 `store.get()`）。

## 6. 注入范围

`inject = ['agents', 'skills']`（维持不变）。`llm/stream` 用 `ctx.on` 冒泡监听；`storage` 在 `openUnit()` 内 `try/catch` 受保护，不可达转回退。`llm`/`storage`/`storageDomain` 均不进 `inject`（框架限制）。

## 7. 测试策略

`__tests__/debug.test.ts` 用 `vi.mock` 隔离外部依赖，覆盖：
- **开启**：`next` 未被调用、合成序列顺序正确（block-start→text-delta→block-end→finish）、`putRecord` 第 3 参数为记录值、`signal` 已从 `request` 剔除。
- **关闭**：`next` 被调用一次、未记录。

headless 作为端到端验证（见 proposal 验证步骤 2/3）。
