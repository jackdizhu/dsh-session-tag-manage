<!-- 模块归属：packages/dsh-skills-auto-enable（宿主端插件） -->

## ADDED Requirements

### Requirement: 会话发起时移除禁用技能

宿主插件 `dsh-skills-auto-enable` SHALL 在会话发起（`agent/session-start`，`agent/pre-step` 兜底）时，对 `rules.disabledSkills` 中的每一个技能名，通过插件自身已注入 `skills` 的 `ctx.skills` 注册同名的 runtime shadow 技能（落到**全局层**，rank 250 < bundled 600 胜出）并设 `invocation.modelInvocable=false`，使框架 `tool-skill` 基于 `ctx.skills.snapshot()` 自建的模型目录中不包含该技能。

#### Scenario: 禁用技能从目录消失

- **GIVEN** 配置文件 `rules.disabledSkills` 含 `["lark-calendar"]`
- **WHEN** 该会话进入首次 `agent/pre-step`
- **THEN** 插件在全局层注册名为 `lark-calendar`、`modelInvocable=false` 的 shadow 技能
- **AND** 本轮及后续轮次模型看到的 `<available_skills>` 中不包含 `lark-calendar`

#### Scenario: shadow 不影响用户直接调用

- **GIVEN** 某技能被 `disabledSkills` 移除模型可见性
- **WHEN** 用户以 `/技能名` 手势显式调用
- **THEN** 该技能仍可被用户调用（`userInvocable` 保持 `true`），仅从模型目录隐藏

### Requirement: 关键字规则前缀族默认隐藏、命中后加载

宿主插件 SHALL 把**命中任一 `keywordRules.skillPrefix` 的已注册技能**默认纳入有效禁用集（默认隐藏以省 token）；SHALL 在会话消息中扫描 `rules.keywordRules` 的关键字，命中后对应 `skillPrefix` 的全部技能 SHALL 从有效禁用集豁免（重新进入模型目录）。即实现"`lark-*` 默认不占上下文 → 存在关键字飞书/feishu/lark 时加载 `lark-*` 全部 SKILL"。

有效禁用集 = `rules.disabledSkills` ∪（已注册技能中匹配任一 `skillPrefix` 者）−（命中关键字的前缀族）。

#### Scenario: 前缀族默认隐藏（disabledSkills 为空亦生效）

- **GIVEN** `disabledSkills` 为 `[]`，`keywordRules` 含 `{ keywords:["飞书","feishu","lark"], skillPrefix:"lark-" }`，且已注册技能含 `lark-approval`、`lark-apps`
- **WHEN** 会话进入 `agent/session-start` 且用户消息**不含**任何关键字
- **THEN** `lark-approval`、`lark-apps` 均被注册为 `modelInvocable=false` 的 shadow
- **AND** 本轮及后续轮次模型看到的 `<available_skills>` 中不包含 `lark-approval`、`lark-apps`

#### Scenario: 关键字命中豁免前缀禁用

- **GIVEN** 同上配置
- **WHEN** 用户消息（含"飞书"）进入会话
- **THEN** 所有以 `lark-` 开头的技能不进入 shadow 注册集合，保持模型可见

#### Scenario: 关键字未命中维持禁用

- **GIVEN** 同上配置且用户消息不含任何关键字
- **WHEN** 会话进入 `agent/pre-step`
- **THEN** `lark-approval` 仍被注册为 `modelInvocable=false`，不在目录中

### Requirement: 配置热更新即时生效

宿主插件 SHALL 通过 `fs.watch` 监听 `dsh-skills-auto-enable-config.json`；`rules` 变更后 SHALL 在下一轮 `agent/pre-step` 重新计算有效禁用集并调整 shadow 注册。

#### Scenario: 运行时修改禁用列表

- **GIVEN** 会话正在进行，原 `disabledSkills` 为 `["a"]`
- **WHEN** 配置文件被改为 `disabledSkills:["a","b"]` 且 `fs.watch` 触发
- **THEN** 下一轮 pre-step 后 `b` 也被注册为 `modelInvocable=false` 并从目录移除

### Requirement: 配置落盘不得阻断会话或启动

`records.flush()` SHALL 保证**不抛异常**：优先原子写（写 `<file>.tmp` 后 `renameSync` 替换）；Windows 上 rename 覆写已存在文件常因目标被其他进程/观察器/杀毒软件占用而抛 `EPERM`，此时 SHALL 依次降级为 `copyFileSync`（原地覆盖内容，保留文件条目与既有 watcher）与直写目标文件；全部路径失败时 SHALL 返回 `false` 并静默放弃，仅影响审计记录。

`ConfigStore.watch()` SHALL 对 `fs.watch` 返回的 `FSWatcher` 调用 `unref()`：否则观察者会一直持有事件循环引用，导致 headless/CLI 场景会话结束后进程无法退出；而挂住的进程持续占用配置目录句柄，正是下一次 `flush` rename 报 `EPERM` 的诱因。

`skillsLog` SHALL 保留最近 500 条审计条目，超出时裁剪最早条目，避免流水无界增长导致配置文件膨胀。

#### Scenario: Windows EPERM 下不崩溃

- **GIVEN** 配置文件正被另一进程/观察器占用，`renameSync` 抛 `EPERM`
- **WHEN** `flush()` 被调用
- **THEN** 降级为 `copyFileSync` / 直写目标文件完成落盘，或返回 `false`
- **AND** 不向调用方抛出异常，`initSession` 与插件加载继续正常完成

#### Scenario: headless 会话结束后进程正常退出

- **GIVEN** 插件已调用 `store.watch()` 建立配置热更新观察者
- **WHEN** 一次 headless/CLI 会话正常结束
- **THEN** 进程在会话结束后随即退出（观察者已 `unref`，不持有事件循环）

### Requirement: 模块归属

技能可见性控制代码 SHALL 位于 `packages/dsh-skills-auto-enable/`（宿主端插件 `dsh-skills-auto-enable`），通过 Cordis 扩展点 `agent/session-start` / `agent/pre-step` / `agent/disposed` 与插件 `ctx.skills` 服务实现，不修改任何 `@deepseek-ai/*` 代码。

#### Scenario: 目录结构合规

- **WHEN** 查看宿主端插件目录
- **THEN** 包含 `package.json`、`src/index.ts`、`src/visibility.ts`、`cordis.patch.yml`，并已在根 `cordis.yml` 注册
