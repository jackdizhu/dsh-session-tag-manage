# Tasks — dsh-llm-debug-mode

## 1. 配置层

- [x] 1.1 `config.ts` 新增 `DebugConfig` 接口（`enabled` / `domain` / `reply`）
- [x] 1.2 `defaultConfig()` 默认 `debug:{ enabled:true, domain:'dsh-llm-debug', reply:'[DEBUG] LLM call blocked; request params recorded to storageDomain.' }`
- [x] 1.3 `reload()` 合并 `debug:{ ...default, ...parsed.debug }`（缺字段回退默认）

## 2. 拦截与落盘

- [x] 2.1 `debug.ts` `installDebugMode(ctx, store)` 监听 `ctx.on('llm/stream', async function* (options, next))`
- [x] 2.2 `sanitize(options)` 剔除 `signal` 并深拷贝为可序列化结构
- [x] 2.3 `debugStream(text)` 合成 `block-start → text-delta → block-end → finish` 同构分块序列
- [x] 2.4 `openUnit()` 走 `ctx.storage` 枢纽 json 后端 KV 单元 `dsh_llm_debug` / 表 `requests`，失败置 `useFallback`
- [x] 2.5 `record(rec)` 优先 `putRecord`，回退 `os.tmpdir()/${domain}-<uuid>.json`（`writeFileSync`）
- [x] 2.6 监听器**先 `await record(rec)` 再 `yield* debugStream`**（修复 fire-and-forget 丢文件）
- [x] 2.7 `debug.enabled=false` 时透传 `next()`（行为等同不装插件）

## 3. 插件装配

- [x] 3.1 `index.ts` `apply()` 在 `installDebugMode(ctx, store)` 调用；`inject` 维持 `['agents','skills']`
- [x] 3.2 `types/deepseek-ai.d.ts` 补充 `@deepseek-ai/dsh-llm`（`GenerateOptions`/`StreamChunk` 子集）与 `ctx.storage` 枢纽 json 后端 KV 形态

## 4. 测试与验证

- [x] 4.1 `__tests__/debug.test.ts`：开启（拦截/不调 next/合成序列/剔除 signal/记录）+ 关闭（透传/不记录）两条路径
- [x] 4.2 `tsc --noEmit` 0；`tsdown` 0；`vitest run packages/dsh-skills-auto-enable` 全绿（13/13）
- [x] 4.3 headless 默认开启：回复 `[DEBUG]...` 且 `os.tmpdir()/dsh-llm-debug-<uuid>.json` 生成、含清洗 `GenerateOptions`
- [x] 4.4 headless 关闭（`debug.enabled:false`）：回复为真实模型内容、不生成临时文件

## 5. 文档与归档

- [x] 5.1 创建 OpenSpec change `dsh-llm-debug-mode`（proposal/design/tasks/spec）
- [x] 5.2 同步 spec 到 `openspec/specs/skill-llm-debug-mode/spec.md`
- [x] 5.3 归档至 `openspec/changes/archive/2026-08-30-dsh-llm-debug-mode/`
- [x] 5.4 清理临时测试产物（`headless-test-patch.yml` 保留为集成测试入口；tmp 调试文件已删；恢复默认 config）
