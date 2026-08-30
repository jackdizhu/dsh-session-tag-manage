# dsh-skills-auto-enable 任务列表

## 1. 包初始化与构建配置

- [ ] 1.1 创建 `packages/dsh-skills-auto-enable/package.json`（宿主包配置 + dsh manifest）
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
- [ ] 1.2 创建 `packages/dsh-skills-auto-enable/cordis.patch.yml`（按包名注册，对齐既有宿主包模式）
  变更文件：packages/dsh-skills-auto-enable/cordis.patch.yml
  变更内容（全量新增）：
  ```diff
  + # 分发用补丁：按包名注册宿主插件
  + - insert:
  +     - id: dsh-skills-auto-enable
  +       name: dsh-skills-auto-enable
  ```
- [ ] 1.3 创建 `packages/dsh-skills-auto-enable/tsconfig.json`（继承根配置，限定 src/dist）
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

- [ ] 2.1 定义配置类型与默认结构，并实现加载与 `fs.watch` 热更新
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

- [ ] 3.1 实现有效禁用集计算、关键字扫描、agent 作用域 shadow 注册
  变更文件：packages/dsh-skills-auto-enable/src/visibility.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import type { Context } from '@deepseek-ai/cordis'
  + import type { Agent } from '@deepseek-ai/dsh-agent'
  + import type { SkillViewOptions } from '@deepseek-ai/dsh-skill'
  +
  + // 计算有效禁用集：disabledSkills 去掉被命中关键字前缀豁免的技能
  + export function computeEffectiveDisabled(disabled: string[], rules: KeywordRule[], matchedPrefixes: Set<string>): string[] {
  +   return disabled.filter(name => !matchedPrefixes.some(p => name.startsWith(p)))
  + }
  + // 扫描消息文本，返回命中的前缀集合（关键字小写归一化、词边界匹配）
  + export function matchPrefixes(text: string, rules: KeywordRule[]): Set<string> {
  +   const lower = text.toLowerCase(); const hit = new Set<string>()
  +   for (const r of rules) if (r.keywords.some(k => lower.includes(k.toLowerCase()))) hit.add(r.skillPrefix)
  +   return hit
  + }
  + // 在 agent 作用域注册 shadow（同名词条 modelInvocable:false 胜出，rank 250<600）
  + export async function applyShadows(agent: Agent, names: string[], lookup: SkillViewOptions): Promise<() => void> {
  +   const disposers: (() => void)[] = []
  +   for (const name of names) {
  +     const original = (await agent.skills.list(lookup)).find(s => s.name === name)
  +     if (!original) continue
  +     disposers.push(agent.skills.register({ name, description: original.description, content: '', invocation: { modelInvocable: false, userInvocable: true } }))
  +   }
  +   return () => disposers.forEach(d => d())
  + }
  ```

## 4. 增量记录模块（src/records.ts）

- [ ] 4.1 实现 skills 清单增量维护、usage 观测累加、原子落盘
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

- [ ] 5.1 实现 apply：注册 `agent/pre-step`、维护会话 Map、配置热更新、会话结束落盘
  变更文件：packages/dsh-skills-auto-enable/src/index.ts
  变更内容（关键 diff，新增文件）：
  ```diff
  + import { fileURLToPath } from 'node:url'
  + import { dirname, resolve } from 'node:path'
  + import type { Context } from '@deepseek-ai/cordis'
  + import type { Agent } from '@deepseek-ai/dsh-agent'
  + import { ConfigStore, type AutoEnableConfig } from './config.js'
  + import { computeEffectiveDisabled, matchPrefixes, applyShadows } from './visibility.js'
  + import { upsertSkill, recordUsage, flush } from './records.js'
  +
  + export const name = 'dsh-skills-auto-enable'
  + export const inject = ['agents', 'skills']
  + interface SessionState { disposer: () => void; used: Set<string> }
  +
  + export function apply(ctx: Context): void {
  +   const here = dirname(fileURLToPath(import.meta.url))
  +   const file = resolve(here, '..', 'dsh-skills-auto-enable-config.json')
  +   const store = new ConfigStore(file)
  +   store.watch(() => {})
  +   const sessions = new Map<string, SessionState>()
  +   ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
  +     const decision = await next()
  +     if (decision.kind === 'reject') return decision
  +     const sessionId = (agent.session as { id?: string }).id ?? agent.session.header.cwd
  +     const cfg = store.get()
  +     const text = messages.map(m => m.content.map(b => b.type === 'text' ? b.text : '').join('')).join('\n')
  +     const matched = matchPrefixes(text, cfg.rules.keywordRules)
  +     const effective = computeEffectiveDisabled(cfg.rules.disabledSkills, cfg.rules.keywordRules, matched)
  +     const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
  +     let state = sessions.get(sessionId)
  +     if (!state) {
  +       state = { disposer: await applyShadows(agent, effective, lookup), used: new Set() }
  +       sessions.set(sessionId, state)
  +       for (const rec of (await agent.skills.list(lookup))) upsertSkill(cfg, { name: rec.name, keyword: '', overview: rec.description }, 'add')
  +     }
  +     // 观测实际调用：tool/call(name=skill) 或 skill-invocation
  +     for (const ev of agent.session.events) {
  +       const name = (ev.type === 'tool/call' && ev.data.name === 'skill') ? ev.data.args?.name
  +         : ev.type === 'user/message' && ev.data.source?.kind === 'skill-invocation' ? ev.data.source.name : undefined
  +       if (name && !state.used.has(name)) { state.used.add(name); recordUsage(cfg, name) }
  +     }
  +     return decision
  +   })
  +   ctx.on('dispose', () => { for (const s of sessions.values()) s.disposer(); sessions.clear() })
  + }
  ```

## 6. cordis.yml 注册

- [ ] 6.1 在根 `cordis.yml` loader insert 列表追加本插件（按包名）
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

- [ ] 7.1 创建 `packages/dsh-skills-auto-enable/__tests__/visibility.test.ts`（shadow 注册 / 关键字豁免 / 有效禁用集）
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
- [ ] 7.2 创建 `packages/dsh-skills-auto-enable/__tests__/records.test.ts`（skills 增量 / usage 累加 / 原子落盘）
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

- [ ] 8.1 执行 `pnpm typecheck` 确认无类型错误（禁 `any`）
- [ ] 8.2 执行 `pnpm build` 产出 `packages/dsh-skills-auto-enable/dist/index.js`（ESM，external `@deepseek-ai/*`）

## 9. 集成验证

- [ ] 9.1 `pnpm dsh web --patch cordis.yml` 启动，开新会话，验证：禁用技能不在 `<available_skills>`、消息含"飞书"时 `lark-*` 可见、结束后 `dsh-skills-auto-enable-config.json` 的 `skills`/`usage` 已增量更新
- [ ] 9.2 执行 `pnpm test` 确认 visibility / records 用例全部通过

## Sub-agent 任务审计

- [ ] 对照 `openspec/changes/dsh-skills-auto-enable/specs/skill-visibility-control/spec.md` 验证可见性控制实现（禁用移除 / 关键字豁免 / 热更新 / 模块归属）
- [ ] 对照 `openspec/changes/dsh-skills-auto-enable/specs/skill-config-records/spec.md` 验证配置记录实现（skills 增量 / usage 累加 / 原子落盘 / 模块归属）
- [ ] 对照 `openspec/changes/dsh-skills-auto-enable/design.md` 验证 agent 作用域 shadow 机制与序列图一致
- [ ] 对照 `openspec/changes/dsh-skills-auto-enable/proposal.md` 验证变更目标达成（零框架改动、省 token、配置记录）
