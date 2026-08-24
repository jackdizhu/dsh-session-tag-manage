# Capability Spec: session-tag-analysis

模块归属：dsh-session-tag-manage / 宿主侧（src/index.ts, src/tagger.ts, src/rules.ts, src/events.ts）

## ADDED Requirements

### Requirement: 会话标签自动分析
系统 SHALL 监听 `session/event` 的 `turn/end` 事件，在 AI 回复结束后自动为会话分析并指派五分类标签之一（`in_progress` / `abnormal_end` / `waiting` / `completed` / `invalid`）。对 `turn/end.reason` 为非 `completed` 的枚举（`error` / `max-tokens` / `aborted` / `blocked` / `interrupted`）MUST 立即标记 `abnormal_end`；对 `completed` 轮次 MUST 启动或重置 `delayMs`（默认 7 分钟）延迟打标定时器，定时器 MUST 经 `ctx.effect()` 生命周期托管，插件卸载时自动回收。

#### Scenario: 异常 reason 即时标记
- **GIVEN** 会话日志收到一个 `turn/end` 事件且 `reason` 为 `error`
- **WHEN** 事件监听器处理该事件
- **THEN** 系统立即写入 `session-tag/assigned` 事件，标签为 `abnormal_end`，无需等待 7 分钟

#### Scenario: 正常轮次延迟打标
- **GIVEN** 会话日志收到一个 `turn/end` 事件且 `reason` 为 `completed`
- **WHEN** 距该事件 7 分钟（`delayMs`）内无新的会话活动
- **THEN** 系统执行标签分析并写入 `session-tag/assigned` 事件

#### Scenario: 新轮次重置计时并回到进行中
- **GIVEN** 已对一个 `completed` 轮次启动 7 分钟定时器
- **WHEN** 在定时器到期前收到新的 `turn/start` 事件
- **THEN** 系统取消旧定时器并标记会话为 `in_progress`

### Requirement: 最后一轮内容提取
系统 SHALL 在分析时提取会话日志中最后一个 `turn/start` 之后的用户与助手文本消息，MUST 排除文件附件块（非 `text` 类型 block）、`reasoning` 思考块、`tool/call`、`tool/result` 与 `assistant/chunk` 原始分片，MUST 截断到 `maxLastTurnMessages`（默认 50）条。

#### Scenario: 只取最后一轮可读文本
- **GIVEN** 会话日志包含多个轮次，最后一轮含 `user/message`（含 `text` 与文件 `block`）、`assistant/message`（含 `text` 与 `reasoning` 块）、若干 `tool/call` / `tool/result`
- **WHEN** 执行 `extractLastTurn`
- **THEN** 输出仅含最后一个 `turn/start` 之后的 `text` 块拼接文本，且不包含文件、思考、工具调用内容

### Requirement: 规则前置判定
系统 SHALL 优先以结构化信号通过纯函数规则判定标签，规则命中时 MUST 不调用 LLM。`abnormal_end` 由 `turn/end.reason` 非 `completed` 判定；`waiting` 由日志中存在未配对 `approval/asked`（无对应 `approval/decided`，按 `id` 配对追踪）判定；`in_progress` / `completed` 由 `todo/write` 全量快照（存在 `pending` / `in_progress` 项 → `in_progress`；全为 `completed` 或为空且最后轮次已 closed → 候选 `completed`）与 `turn/start` 判定；`agent/status` 不作为单轮次判定信号。

#### Scenario: 未决审批判定等待
- **GIVEN** 会话日志末尾存在 `approval/asked` 事件且无配对的 `approval/decided`
- **WHEN** 执行规则判定
- **THEN** 系统标记会话为 `waiting` 且不调用 LLM

#### Scenario: 待办快照判定进行中
- **GIVEN** 最新 `todo/write` 快照包含 `pending` 或 `in_progress` 状态的待办项
- **WHEN** 执行规则判定
- **THEN** 系统标记会话为 `in_progress` 且不调用 LLM

### Requirement: LLM 兜底语义判定
规则层无法判定的语义类（`completed` / `invalid` / 兜底 `in_progress`）系统 SHALL 通过 `ctx.llm.stream(GenerateOptions)` 调用配置的 `analysisModel` 判定，流式分片 MUST 经 BlockAssembler 组装为完整文本，提示词 MUST 约束模型仅输出枚举值并以 JSON 格式返回。

#### Scenario: 规则未命中时走 LLM
- **GIVEN** 规则层对某会话未命中任何结构化判定
- **WHEN** 执行标签分析
- **THEN** 系统调用 `ctx.llm.stream` 提交提取的最后一轮内容，解析返回的枚举作为标签写入事件

### Requirement: 标签事件持久化
系统 SHALL 将标签写入会话日志，作为 `session-tag/assigned` 自定义事件（经 `SessionEventMap` 声明合并扩展，`ignorable: true`、whole-value 快照式携带完整标签状态），payload MUST 可 JSON 序列化，随日志回放 / Fork / 恢复语义一致。

#### Scenario: 标签随日志持久化
- **GIVEN** 系统为一个会话写入了 `session-tag/assigned` 事件
- **WHEN** 会话日志被回放 / Fork / 恢复
- **THEN** 标签状态可从事件日志重建且与写入时一致
