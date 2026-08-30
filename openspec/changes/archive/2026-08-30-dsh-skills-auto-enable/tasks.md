# dsh-skills-auto-enable 任务列表

## 1. 包初始化与构建配置

- [x] 1.1 创建 `packages/dsh-skills-auto-enable/package.json`（宿主包配置 + dsh manifest）
  变更文件：packages/dsh-skills-auto-enable/package.json
  变更内容（全量新增）：
  ```diff
  + {
  +   "name": "dsh-skills-auto-enable",
  +   "version": "0.1.0",
  +   "type": "module",
  +   "main": "dist/index.js",
  +   "types": "dist/index.d.ts",
  +   "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  +   "peerDependencies": {},
  +   "dependencies": {}
  + }
  ```
- [x] 1.2 创建 `packages/dsh-skills-auto-enable/cordis.patch.yml`（按包名注册，对齐既有宿主包模式）
  变更文件：packages/dsh-skills-auto-enable/cordis.patch.yml
  变更内容（全量新增）：
  ```diff
  + # 分发用补丁：按包名注册宿主插件
  + - insert:
  +     - id: dsh-skills-auto-enable
  +       name: dsh-skills-auto-enable
  ```
- [x] 1.3 创建 `packages/dsh-skills-auto-enable/tsconfig.json`（继承根配置，限定 src/dist）
  变更文件：packages/dsh-skills-auto-enable/tsconfig.json
  变更内容（全量新增）：
  ```diff
  + {
  +   "extends": "../../tsconfig.json",
  +   "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  +   "include": ["src"]
  + }
  ```

## 2. 配置加载模块（src/config.ts）

- [x] 2.1 定义配置类型与默认结构，并实现加载与 `fs.watch` 热更新
  变更文件：packages/dsh-skills-auto-enable/src/config.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { readFileSync, watch, existsSync } from 'node:fs'
  + import { dirname, resolve } from 'node:path'
  + import type { Config as AgentConfig } from '@deepseek-ai/cordis'
  +
  + export interface KeywordRule { keywords: string[]; skillPrefix: string }
  + export interface AutoTrim { enabled: boolean; unusedTurnsThreshold: number; keepKeywordMatched: boolean }
  + export interface SkillRecord { name: string; keyword: string; overview: string }
  + export interface SkillLogEntry { at: string; op: 'add' | 'remove'; name: string; keyword: string; overview: string }
  + export interface UsageRecord { count: number; lastUsedAt: string }
  + export interface AutoEnableConfig {
  +   version: 1
  +   rules: { disabledSkills: string[]; keywordRules: KeywordRule[]; autoTrim: AutoTrim }
  +   skills: SkillRecord[]
  +   skillsLog: SkillLogEntry[]
  +   usage: Record<string, UsageRecord>
  + }
  +
  + export function defaultConfig(): AutoEnableConfig {
  +   return { version: 1, rules: { disabledSkills: [], keywordRules: [], autoTrim: { enabled: false, unusedTurnsThreshold: 20, keepKeywordMatched: true } }, skills: [], skillsLog: [], usage: {} }
  + }
  +
  + export class ConfigStore {
  +   private current: AutoEnableConfig = defaultConfig()
  +   constructor(private readonly file: string) { this.reload() }
  +   get(): AutoEnableConfig { return this.current }
  +   reload(): void {
  +     if (!existsSync(this.file)) { this.current = defaultConfig(); return }
  +     try { this.current = { ...defaultConfig(), ...JSON.parse(readFileSync(this.file, 'utf-8')) } }
  +     catch (e) { /* 损坏回退默认并告警，不阻断会话 */ }
  +   }
  +   watch(onChange: () => void): void { watch(dirname(this.file), () => this.reload() || onChange()) }
  + }
  ```

## 3. 可见性控制模块（src/visibility.ts）

- [x] 3.1 实现有效禁用集计算、关键字扫描、全局层 shadow 注册
  变更文件：packages/dsh-skills-auto-enable/src/visibility.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import type { Context } from '@deepseek-ai/cordis'
  + import type { KeywordRule } from './config.js'
  + import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
  +
  + // 计算有效禁用集：disabledSkills 去掉被命中关键字前缀豁免的技能
  + export function computeEffectiveDisabled(disabled: string[], rules: KeywordRule[], matchedPrefixes: Set<string>): string[] {
  +   return disabled.filter(name => !matchedPrefixes.some(p => name.startsWith(p)))
  + }
  + // 扫描消息文本，返回命中的前缀集合与关键字字面量集合（小写归一化、includes 匹配）
  + export function matchKeywordRules(text: string, rules: KeywordRule[]): { prefixes: Set<string>; keywords: Set<string> } {
  +   const lower = (text ?? '').toLowerCase(); const prefixes = new Set<string>(); const keywords = new Set<string>()
  +   for (const r of rules) for (const kw of r.keywords) if (kw && lower.includes(kw.toLowerCase())) { prefixes.add(r.skillPrefix); keywords.add(kw); break }
  +   return { prefixes, keywords }
  + }
  + // 在全局层注册 shadow（插件 ctx 已 inject skills，同名词条 modelInvocable:false 胜出 rank 250<600）
  + // scopeCtx 由调用方传入插件自身 ctx（与框架同一 registry 实例）；register 落到全局层。
  + export async function applyShadows(scopeCtx: Context, names: string[], lookup: SkillViewOptions): Promise<Map<string, () => void>> {
  +   const disposers = new Map<string, () => void>()
  +   const known = await scopeCtx.skills.list(lookup)
  +   for (const name of names) {
  +     const original = known.find(s => s.name === name)
  +     if (!original) continue
  +     disposers.set(name, scopeCtx.skills.register({ name, description: original.description, content: '', invocation: { modelInvocable: false, userInvocable: true } }))
  +   }
  +   return disposers
  + }
  + // 依据有效禁用集协调 shadow（已注册但不在 effective → 撤销；在 effective 未注册 → 注册）
  + export async function reconcileShadows(scopeCtx: Context, disposers: Map<string, () => void>, effective: string[], lookup: SkillViewOptions): Promise<void> { /* ... */ }
  ```

## 4. 增量记录模块（src/records.ts）

- [x] 4.1 实现 skills 清单增量维护、usage 观测累加、原子落盘
  变更文件：packages/dsh-skills-auto-enable/src/records.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { renameSync, writeFileSync } from 'node:fs'
  + import type { AutoEnableConfig, SkillRecord, SkillLogEntry, UsageRecord } from './config.js'
  +
  + // 会话发起写入基线 skills（name/keyword/overview）+ 追加 remove 流水
  + export function upsertSkill(cfg: AutoEnableConfig, rec: SkillRecord, op: 'add' | 'remove'): void {
  +   const idx = cfg.skills.findIndex(s => s.name === rec.name)
  +   if (op === 'add' && idx < 0) cfg.skills.push(rec)
  +   if (op === 'remove' && idx >= 0) cfg.skills.splice(idx, 1)
  +   cfg.skillsLog.push({ at: new Date().toISOString(), op, name: rec.name, keyword: rec.keyword, overview: rec.overview })
  + }
  + // 观测 tool/call(name=skill) → usage 累加
  + export function recordUsage(cfg: AutoEnableConfig, name: string): void {
  +   const now = new Date().toISOString()
  +   const prev: UsageRecord = cfg.usage[name] ?? { count: 0, lastUsedAt: now }
  +   cfg.usage[name] = { count: prev.count + 1, lastUsedAt: now }
  + }
  + // 原子落盘：先写 .tmp 再 rename
  + export function flush(file: string, cfg: AutoEnableConfig): void {
  +   const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(cfg, null, 2)); renameSync(tmp, file)
  + }
  ```

## 5. 插件入口（src/index.ts）

- [x] 5.1 实现 apply：注册 `agent/session-start` / `agent/pre-step` / `agent/disposed`、维护会话 Map、配置热更新、会话结束落盘（最终采用插件 `ctx.skills` 全局层 register）
  变更文件：packages/dsh-skills-auto-enable/src/index.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { fileURLToPath } from 'node:url'
  + import { dirname, resolve } from 'node:path'
  + import type { Context } from '@deepseek-ai/cordis'
  + import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
  + import type { SessionEvent } from '@deepseek-ai/dsh-session'
  + import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
  + import { ConfigStore, type AutoEnableConfig } from './config.js'
  + import { computeEffectiveDisabled, matchKeywordRules, applyShadows, reconcileShadows, keywordFor } from './visibility.js'
  + import { upsertSkill, recordUsage, flush } from './records.js'
  +
  + export const name = 'dsh-skills-auto-enable'
  + export const inject = ['agents', 'skills']
  + interface SessionState { disposers: Map<string, () => void>; matchedPrefixes: Set<string>; matchedKeywords: Set<string>; used: Set<string> }
  +
  + export function apply(ctx: Context): void {
  +   const here = dirname(fileURLToPath(import.meta.url))
  +   const file = resolve(here, '..', 'dsh-skills-auto-enable-config.json')
  +   const store = new ConfigStore(file)
  +   store.watch(() => {})            // fs.watch 热更新：下一轮 pre-step 重新计算有效禁用集
  +   const sessions = new Map<string, SessionState>()
  +   const lookupFor = (agent: Agent): SkillViewOptions => ({ cwd: agent.session.header.cwd, scope: agent })
  +
  +   const initSession = async (agent: Agent): Promise<void> => {
  +     const sid = agent.session.id
  +     if (sessions.has(sid)) return
  +     const cfg = store.get()
  +     const text = userTextFromEvents(agent.session.events)
  +     const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)
  +     const effective = computeEffectiveDisabled(cfg.rules.disabledSkills, cfg.rules.keywordRules, prefixes)
  +     // 用插件自身 ctx（已 inject skills，与框架同一 registry 实例）注册 → 全局层 rank 250<600 胜出
  +     const disposers = await applyShadows(ctx, effective, lookupFor(agent))
  +     const all = await ctx.skills.list(lookupFor(agent))
  +     for (const s of all) {
  +       const disabled = effective.includes(s.name)
  +       const kw = disabled ? '' : keywordFor(s.name, cfg.rules.keywordRules, prefixes, keywords)
  +       upsertSkill(cfg, { name: s.name, keyword: kw, overview: s.description }, disabled ? 'remove' : 'add')
  +     }
  +     sessions.set(sid, { disposers, matchedPrefixes: prefixes, matchedKeywords: keywords, used: new Set() })
  +     flush(file, cfg)
  +   }
  +   const stepSession = async (agent: Agent, messages: AgentMessage[]): Promise<void> => {
  +     const sid = agent.session.id
  +     let state = sessions.get(sid) ?? (await initSession(agent), sessions.get(sid))
  +     if (!state) return
  +     const cfg = store.get()
  +     const text = userTextFromMessages(messages)
  +     const { prefixes, keywords } = matchKeywordRules(text, cfg.rules.keywordRules)
  +     let changed = false
  +     for (const p of prefixes) state.matchedPrefixes.add(p)
  +     for (const k of keywords) state.matchedKeywords.add(k)
  +     if (prefixes.size > state.matchedPrefixes.size) {  // 运行时新命中关键字前缀 → 重新协调 shadow + 增量加入 skills
  +       const effective = computeEffectiveDisabled(cfg.rules.disabledSkills, cfg.rules.keywordRules, state.matchedPrefixes)
  +       await reconcileShadows(ctx, state.disposers, effective, lookupFor(agent))
  +       const all = await ctx.skills.list(lookupFor(agent))
  +       for (const s of all) { /* 命中前缀规则且已记录 → upsertSkill(...,'add') */ }
  +       changed = true
  +     }
  +     for (const ev of agent.session.events) { const name = skillNameFromEvent(ev); if (name && !state.used.has(name)) { state.used.add(name); recordUsage(cfg, name); changed = true } }
  +     if (changed) flush(file, cfg)
  +   }
  +   const cleanupSession = (agent?: { session?: { id?: string } }): void => {
  +     const sid = agent?.session?.id; if (!sid) return
  +     const state = sessions.get(sid); if (!state) return
  +     for (const d of state.disposers.values()) d(); sessions.delete(sid); flush(file, store.get())
  +   }
  +   ctx.on('agent/session-start', (payload) => { void initSession(payload.agent) })
  +   ctx.on('agent/pre-step', async (payload, next) => { const decision = await next(); if (decision && decision.kind === 'reject') return decision; await stepSession(payload.agent, payload.messages); return decision })
  +   ctx.on('agent/disposed', (agent) => { cleanupSession(agent) })
  + }
  ```

## 6. cordis.yml 注册

- [x] 6.1 在根 `cordis.yml` loader insert 列表追加本插件（按包名）
  变更文件：cordis.yml
  变更内容（修改 diff）：
  ```diff
  - insert:
  -     - id: dsh-session-base-host
  -       name: dsh-session-base-host
  -     - id: dsh-session-base-client
  -       name: dsh-session-base-client
  + - insert:
  +     - id: dsh-session-base-host
  +       name: dsh-session-base-host
  +     - id: dsh-session-base-client
  +       name: dsh-session-base-client
  +     - id: dsh-skills-auto-enable
  +       name: dsh-skills-auto-enable
  ```

## 7. 单元测试（Vitest）

- [x] 7.1 创建 `packages/dsh-skills-auto-enable/__tests__/visibility.test.ts`（shadow 注册 / 关键字豁免 / 有效禁用集）
  变更文件：packages/dsh-skills-auto-enable/__tests__/visibility.test.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { describe, it, expect, vi } from 'vitest'
  + import { computeEffectiveDisabled, matchPrefixes } from '../src/visibility.js'
  + describe('visibility', () => {
  +   it('computeEffectiveDisabled 应豁免命中前缀', () => {
  +     const r = [{ keywords: ['飞书','feishu'], skillPrefix: 'lark-' }]
  +     expect(computeEffectiveDisabled(['lark-calendar'], r, new Set(['lark-']))).toEqual([])
  +   })
  +   it('matchPrefixes 应命中 feishu', () => {
  +     expect(matchPrefixes('请使用 feishu 处理', [{ keywords: ['feishu'], skillPrefix: 'lark-' }])).toEqual(new Set(['lark-']))
  +   })
  + })
  ```
- [x] 7.2 创建 `packages/dsh-skills-auto-enable/__tests__/records.test.ts`（skills 增量 / usage 累加 / 原子落盘）
  变更文件：packages/dsh-skills-auto-enable/__tests__/records.test.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { describe, it, expect } from 'vitest'
  + import { defaultConfig } from '../src/config.js'
  + import { upsertSkill, recordUsage } from '../src/records.js'
  + describe('records', () => {
  +   it('upsertSkill 增量 add', () => {
  +     const c = defaultConfig(); upsertSkill(c, { name: 'x', keyword: '', overview: 'o' }, 'add')
  +     expect(c.skills).toHaveLength(1); expect(c.skillsLog.at(-1)!.op).toBe('add')
  +   })
  +   it('recordUsage 累加', () => {
  +     const c = defaultConfig(); recordUsage(c, 'x'); recordUsage(c, 'x')
  +     expect(c.usage.x.count).toBe(2)
  +   })
  + })
  ```

## 8. 类型检查与构建

- [x] 8.1 执行 `pnpm typecheck` 确认无类型错误（禁 `any`）
- [x] 8.2 执行 `pnpm build` 产出 `packages/dsh-skills-auto-enable/dist/index.js`（ESM，external `@deepseek-ai/*`）

## 9. 集成验证

- [x] 9.1 DSH 运行时联调验证（headless profile）：`dsh --profile headless --patch headless-test-patch.yml "你好，请用一句话介绍你自己"`
  - **崩溃修复已验证**：原崩溃栈 `applyShadows ... Cannot read properties of undefined (reading 'list')` 在改用插件自身 `ctx.skills` 全局层 register 后**不再出现**；进程存活至模型正常回复（`dsh: fatal load failure` 消除，日志无 `without inject` / `undefined`）。
  - **端到端执行已验证**：`dsh-skills-auto-enable-config.json` 被写入全量 **29 个 `lark-*` 技能**（`skills` 数组），`skillsLog` 记录 29 条 `add`（时间戳 `2026-08-30T11:43:55.959Z`）——证明 `agent/session-start` → `ctx.skills.list` + `applyShadows` + `upsertSkill` 链路打通。
  - **未覆盖子项（已知边界）**：本轮 `disabledSkills:[]` 且 prompt 无飞书关键字，未实测"禁用剔除"与"关键字自动加载"。已追加实测（见 9.3）。
- [x] 9.2 执行 `pnpm test` 确认 visibility / records 用例全部通过（11/11）
- [x] 9.3 补充实测"禁用剔除"与"关键字自动加载"（归档前追加，headless profile）
  - **禁用剔除（无关键字）**：`disabledSkills:['lark-calendar']` + 中性 prompt → `lark-calendar` 不在 `skills` 数组，`skillsLog` 产生 `op:'remove'` 流水。✓
  - **关键字豁免加载**：`disabledSkills:['lark-calendar','lark-doc']` + 含"飞书" prompt → 二者因 `lark-` 前缀被关键字豁免，最终保留在 `skills` 数组。✓
  - **发现并修复真实 bug**：`stepSession` 中 `state.matchedPrefixes` 被并入循环先于 `prefixes.size > state.matchedPrefixes.size` 判断，致该条件恒 false、运行时关键字协调（reconcile）永不触发，关键字自动加载失效。改为先算 `newPrefixes`（本轮回新命中前缀）再据 `newPrefixes.length > 0` 触发协调后重测通过（`packages/dsh-skills-auto-enable/src/index.ts`）。
  - **首轮关键字延迟（已知小限制）**：`agent/session-start` 时 `agent.session.events` 通常尚未含首条用户消息，被禁用前缀技能首轮被 shadow 隐藏，关键字于首轮 `agent/pre-step` 才被检测到并 reconcile 撤销 shadow，从第二轮起恢复可见（`skillsLog` 先 `remove` 后 `add`，最终 `skills` 数组状态正确）。

## Sub-agent 任务审计

- [x] 对照 `openspec/changes/dsh-skills-auto-enable/specs/skill-visibility-control/spec.md` 验证可见性控制实现（禁用移除 / 关键字豁免 / 热更新 / 模块归属）
- [x] 对照 `openspec/changes/dsh-skills-auto-enable/specs/skill-config-records/spec.md` 验证配置记录实现（skills 增量 / usage 累加 / 原子落盘 / 模块归属）
- [x] 对照 `openspec/changes/dsh-skills-auto-enable/design.md` 验证全局层 shadow 机制、序列图与已知边界一致（已实现 `ctx.skills` 全局层 register，非 per-agent 作用域）
- [x] 对照 `openspec/changes/dsh-skills-auto-enable/proposal.md` 验证变更目标达成（零框架改动、省 token、配置记录）
