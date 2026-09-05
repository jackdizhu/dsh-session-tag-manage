# Spec: Skill LLM Debug Mode (dsh-debugger)

## Overview

DSH 宿主端调试插件（`dsh-debugger`）。作用：拦截并审计每一轮 `llm/stream` 流式调用，便于调试与排障。代码位于 `packages/dsh-debugger/`（单包插件，无客户端半区）。

核心模型为**全局开关**，非会话级：拦截判定只依赖 `config.debug.enabled` 一个全局布尔；所有会话统一透传或统一拦截。`ConfigStore.setDebugEnabled(enabled)` 是改写该布尔的**唯一写入口**（更新内存 current → flush 落盘 → 跨重启保持）。`/debugger [on|off|status]` 指令（含中文别名）经该写入口读写全局开关，无会话上下文亦可执行。

## Requirements

### Requirement: 全局调试开关

插件 SHALL 暴露单一全局布尔 `debug.enabled`，默认值为 `false`。拦截判定 MUST 只依赖该全局布尔：为 `true` 时全部会话的 `llm/stream` 被拦截；为 `false` 时全部会话透传真实 LLM 接口。

#### Scenario: 默认不拦截
- **WHEN** 插件以默认配置加载
- **THEN** `debug.enabled` 为 `false`，全部会话的 `llm/stream` 调用透传真实接口，不产生拦截回执

#### Scenario: 开启后全局拦截
- **WHEN** `debug.enabled` 被置为 `true`
- **THEN** 后续每一轮 `llm/stream` 均被拦截，请求参数落盘并记录到调试日志

#### Scenario: 关闭后全局透传
- **WHEN** `debug.enabled` 被置为 `false`
- **THEN** 后续每一轮 `llm/stream` 透传真实接口，不再拦截

### Requirement: 配置唯一写入口

改写 `debug.enabled` 的**唯一入口** MUST 为 `ConfigStore.setDebugEnabled(enabled)`：更新内存 current → 原子 flush 落盘（`records.ts`：`renameSync → copyFileSync → 直写` 降级链，绝不抛异常）→ 跨重启保持。`fs.watch` 以 `lastWritten` 自跳跳过 reload；同进程即时生效。

#### Scenario: 改写即生效
- **WHEN** 调用 `ConfigStore.setDebugEnabled(true)`
- **THEN** 内存 current 立即更新，且落盘成功，下一次 `llm/stream` 起即按新值拦截

#### Scenario: 跨重启保持
- **WHEN** 进程重启并重新加载配置
- **THEN** 读取落盘后的 `debug.enabled` 值，开关状态与重启前一致

### Requirement: `/debugger` 指令平面

插件 SHALL 安装 `/debugger [on|off|status]` 斜杠指令（无参等同 `on`；中文别名 `开启`/`关闭`/`状态`）。指令 handler MUST 经 `store.setDebugEnabled` 读写**全局** `enabled`，无会话上下文亦可执行（仅跳过气泡）；`status` 返回当前全局状态。

#### Scenario: 开启拦截
- **WHEN** 用户输入 `/debugger` 或 `/debugger on` 或 `/debugger 开启`
- **THEN** `debug.enabled` 置 `true`，回复确认拦截已开启

#### Scenario: 关闭拦截
- **WHEN** 用户输入 `/debugger off` 或 `/debugger 关闭`
- **THEN** `debug.enabled` 置 `false`，后续 LLM 调用透传真实接口

#### Scenario: 查询状态
- **WHEN** 用户输入 `/debugger status` 或 `/debugger 状态`
- **THEN** 返回当前全局 `debug.enabled` 状态，不改变开关

### Requirement: LLM 流拦截与落盘

当 `debug.enabled` 为 `true` 时，插件 MUST 监听 `llm/stream`，对请求参数 `sanitize`（剔除 `signal` 等敏感/不可序列化字段）后落盘——优先写入 storage KV 单元，不可达时回退 `os.tmpdir()/dsh-llm-debug-<uuid>.json`——并合成响应流（`block-start → text-delta → block-end → finish`）作为调试回执返回。

#### Scenario: 拦截并落盘
- **WHEN** 某轮 `llm/stream` 触发且 `debug.enabled` 为 `true`
- **THEN** 请求参数被 sanitize 并落盘，合成响应流返回调试回执文案（含落盘路径）

#### Scenario: 合成响应流顺序
- **WHEN** 拦截命中并合成回执
- **THEN** 响应块严格按 `block-start → text-delta → block-end → finish` 顺序产出

### Requirement: 配置结构收敛

运行时配置文件（`dsh-debugger-config.json`）SHALL 仅含 `version` 与 `debug` 两个顶层字段。旧版 `dsh-skills-auto-enable` 遗留的 `rules`/`skills`/`skillsLog`/`usage`/`hidden` 字段及整个技能可见性子系统（`visibility.ts`、`catalog.ts`、关键字/usage 审计、对应测试）SHALL 已删除，仅保留 `AutoEnableConfig` 兼容别名。

#### Scenario: 配置 schema 收窄
- **WHEN** 检查 `dsh-debugger-config.json` 结构
- **THEN** 仅含 `version`（number）与 `debug`（含 `enabled`/`domain`/`reply`）字段，无 skills 可见性相关遗留字段

### Requirement: 模块归属

插件代码 MUST 位于 `packages/dsh-debugger/`（单包），入口 `src/index.ts` 注册 `/debugger` 指令与 `llm/stream` 拦截；`src/config.ts`（`DebuggerConfig`/`ConfigStore`）、`src/debug.ts`（拦截与合成）、`src/records.ts`（原子落盘）、`src/commands/index.ts`（指令 handler）。

#### Scenario: 目录结构
- **WHEN** 查看 dsh-debugger 插件目录
- **THEN** 含 `package.json`（name: dsh-debugger, main: dist/index.js）、`cordis.patch.yml`、`dsh-debugger-config.json`、`src/`、`__tests__/`、`dist/`
