## Why

DSH 会话中模型每轮看到的技能目录（`<available_skills>` 系统提醒）由框架 `tool-skill` 插件基于 `ctx.skills.snapshot()` 全量渲染，技能越多 token 消耗越大。当前框架的技能注册表只支持"加"、不支持"减"，缺少按会话、按关键字动态裁剪技能可见性的能力。本变更新增宿主插件 `dsh-skills-auto-enable`，在**不修改任何 `@deepseek-ai/*` 代码**（AGENT.md 红线）的前提下，于会话发起时按本地配置剔除禁用技能、按关键字自动加载对应前缀技能族，并把会话中存在的全部 SKILL 与执行过程实际调用的 SKILL 增量记录到配置文件，用于持续"加/移除上下文中的 SKILL"以节省 token。

## What Changes

- **新增宿主端插件**（`packages/dsh-skills-auto-enable/`）：单包（宿主侧，无客户端 UI），导出 Cordis 插件 `name='dsh-skills-auto-enable'`、`inject=['agents','skills']`。
- **技能可见性控制（核心）**：利用 `ctx.skills` 分层注册表的作用域层 shadow 机制——在 agent 作用域通过 `agent.skills.register()` 注册与禁用技能同名的 runtime 技能（rank 250 < 全局 bundled 600，同名词条在 agent 层胜出），并设 `invocation.modelInvocable=false`，使 `tool-skill` 自建目录自动剔除该技能（无需改写 catalog 消息、天然跨轮生效）。
  - **禁用移除**：`rules.disabledSkills` 中的技能在会话上下文不可见。
  - **关键字自动加载**：扫描用户消息命中 `rules.keywordRules` 后，对应 `skillPrefix` 技能族保持可见（即从"有效禁用集"中豁免），实现"飞书/feishu → 加载 `lark-*` 全部技能"。
- **本地配置文件**（`packages/dsh-skills-auto-enable/dsh-skills-auto-enable-config.json`）：
  - `rules`：静态规则（disabledSkills / keywordRules / autoTrim）。
  - `skills`：**会话中存在的全部 SKILL 完整清单**，每条仅三字段 `{ name, keyword, overview }`，增量维护。
  - `skillsLog`：增量变更流水（op: add/remove + at + name/keyword/overview），审计依据。
  - `usage`：执行过程中**实际被调用**的 SKILL（count / lastUsedAt），从 `agent.session.events` 的 `tool/call(name=skill)` 与 `skill-invocation` 消息观测累加。
- **配置热更新**：通过 `fs.watch` 监听配置文件，`rules` 变更即时生效（会话发起或下一轮 pre-step 重新加载）。
- **可选 autoTrim**（默认关闭）：某技能连续 N 轮未使用且非关键字命中时，加入 agent 层 shadow 从目录移除，进一步省 token。
- **cordis.yml 注册**：在根 `cordis.yml` 的 loader `insert` 列表追加 `dsh-skills-auto-enable`（按包名，宿主半区走包 main）。

## Capabilities

### New Capabilities

- `skill-visibility-control`：会话发起时依据本地配置控制技能在模型上下文中的可见性——剔除禁用技能、按关键字自动加载前缀技能族，通过 agent 作用域层 shadow 实现，零框架改动。
- `skill-config-records`：维护 `dsh-skills-auto-enable-config.json`，增量记录会话中存在的全部 SKILL（名称/关键字/概述）与执行中实际调用的 SKILL（usage），支撑"加/移除上下文 SKILL"的省 token 决策。

### Modified Capabilities

（无既有 capability 的 spec 级行为变更）

## Impact

- **代码结构**：新增 `packages/dsh-skills-auto-enable/`（package.json、cordis.patch.yml、src/index.ts、src/config.ts、src/records.ts、__tests__/），修改根 `cordis.yml` 注册条目。
- **依赖**：仅依赖宿主运行时提供的 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-session`；不新增外部依赖（可选 `fs` 为 node 内置）。
- **构建**：作为宿主插件纳入现有 `tsdown` 构建（ESM，external `@deepseek-ai/*`）。
- **API 兼容性**：不改任何框架 API；仅消费 `agent/pre-step` 事件与 `ctx.skills` 服务，属框架公开扩展点。
- **风险点**：agent 作用域 shadow 注册须在会话首次 pre-step 幂等完成；多会话并发写同一配置文件需串行/去抖写（单宿主进程内 Memory 累计，会话结束原子落盘）。

## 验证步骤

1. **单元验证（Vitest）**：mock `agent`/`ctx.skills`，断言禁用技能被注册为 `modelInvocable:false` 的 shadow；关键字命中时前缀技能不入 shadow；`skills` 清单增量 add/remove 正确；`usage` 从 `tool/call` 事件正确累加。
2. **配置读写验证**：断言 `dsh-skills-auto-enable-config.json` 结构（rules/skills/skillsLog/usage）按 schema 生成与热更新加载。
3. **类型检查**：`pnpm typecheck` 无类型错误（禁 `any`）。
4. **本地联调**：`pnpm dsh web --patch cordis.yml` 启动，开会话，确认禁用技能不在 `<available_skills>` 中、含"飞书"消息时 `lark-*` 技能可见、会话结束后配置文件 `skills`/`usage` 已更新。
5. **构建验证**：`pnpm build` 产出 `packages/dsh-skills-auto-enable/dist/index.js`（ESM）。

## 单元测试设计（Vitest）

- 测试文件：`packages/dsh-skills-auto-enable/__tests__/visibility.test.ts`、`__tests__/records.test.ts`
- 框架配置：`vitest.config.ts`（node 环境，`@deepseek-ai/*` alias 指向 `types/deepseek-ai.d.ts`）
- 关键用例：
  - `apply` 导出 `name='dsh-skills-auto-enable'` 且 `inject` 含 `agents`/`skills`
  - 禁用技能 → `agent.skills.register` 收到 `invocation.modelInvocable=false` 的同名词条
  - 关键字"feishu"命中 → `lark-` 前缀技能不进入 shadow 注册集合
  - `skills` 列表增量：会话发起写入基线，禁用技能带 `op:remove` 流水
  - `usage` 累加：模拟 `agent.session.events` 含 `tool/call(name=skill,args.name='x')` → `usage.x.count++`
  - `fs.watch` 热更新：修改 `disabledSkills` 后下次 pre-step 重新计算 shadow
