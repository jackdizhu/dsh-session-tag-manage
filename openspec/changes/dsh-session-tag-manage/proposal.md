## Why

DeepSeek Harness（DSH）采用"一切皆插件"架构，会话日志是一份仅追加的类型化 `SessionEvent` 流。当前 Web UI 对会话状态（进行中 / 异常终止 / 等待授权 / 完结 / 无效）没有任何可视区分，用户无法快速识别需要关注或清理的会话。本提案构建一个**会话管理插件**，在 AI 回复结束后自动为会话打标签，并在 Web UI 上以背景色区分不同标签，同时提供每日 17:00 桌面提醒与手动标签修正能力。

## What Changes

- 新增一个独立 TypeScript 插件包 `dsh-session-tag-manage`，遵循 DSH 插件体系（Cordis 生命周期 + `ctx.sessionProjections` + 客户端槽位 + Typert RPC）。
- 监听 `session/event` 的 `turn/end` 事件：对异常 reason（`error / max-tokens / aborted / blocked / interrupted`）即时标记 `abnormal_end`；对 `completed` 轮次启动/重置 **7 分钟**（可配置）打标定时器。
- 标签判定采用**规则前置 + LLM 兜底**：规则层判定 `abnormal_end`（turn/end reason）、`waiting`（`approval/asked` 无配对 `approval/decided`）、`in_progress` / `completed`（`todo/write` + `turn/start`）；LLM（`ctx.llm.stream` + BlockAssembler）只判规则判不了的 `completed` / `invalid` / `in_progress`，JSON 约束输出。
- 标签持久化为自定义 `session-tag/assigned` 事件（`SessionEventMap` 声明合并扩展，`ignorable: true`），随会话日志回放 / Fork / 恢复语义一致。
- 通过 `ctx.sessionProjections` 注册 `session-tag` 投影（`stateSchema` + `wire:{viewSchema,view}`，含 `lastActiveAt`），`session/projection` 推帧同步到浏览器。
- 客户端插件注入全局样式 + CSS 类名定位（`data-session-id` / 行序 + MutationObserver 兜底）为不同标签会话行渲染背景色：异常终止红系、等待橙系重点强调。
- 每日 `dailyReminderTime`（默认 **17:00**）桌面提醒：浏览器 **Web Notifications API**，统计当天有活动且标签 ∈ {`abnormal_end`, `waiting`} 的会话数，文案"有 XX 个会话等待确认、XX 个会话异常"；`desktopReminderEnabled` 开关（默认开）控制；聚焦/`visibilitychange` 兜底后台节流。
- Web UI 手动标签更新：客户端标签编辑组件（悬停下拉选 5 类合法标签）经 **Typert RPC** 调用宿主 `sessionTagOverride.set`，宿主校验（开关 / 合法标签 / 会话存在）后追加 `source: 'user-override'` 的标签事件，投影"后写覆盖"同步数据与 UI；`manualTagUpdateEnabled` 开关（默认开）在客户端隐藏入口 + 宿主拒绝写入双重生效。
- 冲突策略：**锁定手动标签**——当前标签 `source === 'user-override'` 时自动分析跳过不覆盖；新 `turn/start` 仍重置为 `in_progress`。

## Capabilities

### New Capabilities

- `session-tag-analysis`: 会话标签自动分析——`turn/end` 监听、7 分钟计时（`ctx.effect` 托管）、最后一轮内容提取（排除文件/编辑/思考）、规则前置 + LLM 兜底判定、`session-tag/assigned` 事件持久化。
- `session-tag-projection`: 标签投影与 Web UI 背景色渲染——`session-tag` 投影注册（`stateSchema` + `wire`）、客户端 `useProjection` 读取、CSS 类名定位 + MutationObserver 的背景色渲染。
- `daily-reminder`: 每日 17:00 会话梳理桌面提醒——`lastActiveAt` 当日活动统计、Web Notifications 桌面通知、后台节流聚焦兜底、`desktopReminderEnabled` 开关。
- `manual-tag-update`: Web UI 手动标签更新——Typert RPC 客户端→宿主写通路、宿主 `sessionTagOverride` 服务校验、投影后写覆盖、锁定手动标签冲突策略、`manualTagUpdateEnabled` 开关。

### Modified Capabilities

无（全新插件，无既有 spec 变更）。

## Impact

- 代码：新增 `dsh-session-tag-manage/` 插件包，宿主侧 `src/index.ts`、`src/config.ts`、`src/events.ts`、`src/tagger.ts`、`src/rules.ts`、`src/projection.ts`、`src/override.ts`；客户端 `src/client/index.ts`、`src/client/reminder.ts`、`src/client/tagEditor.tsx`。
- API：合并扩展 `SessionEventMap`（新增 `session-tag/assigned`）、`SessionProjectionMap` / `SessionProjectionStateMap`（新增 `session-tag` 键）；注册宿主服务 `sessionTagOverride.set`。
- 依赖：`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-session/types`、`@deepseek-ai/dsh-session-projection/types`、`@deepseek-ai/dsh-client-runtime/client`、Typert RPC 工具链（构建时生成）。
- 配置：新增 `delayMs`（默认 7 分钟）、`analysisModel`、`maxLastTurnMessages`、`highlightTags`、`dailyReminderTime`（默认 `17:00`）、`desktopReminderEnabled`（默认开）、`manualTagUpdateEnabled`（默认开）。
- 系统：不侵入 Agent Loop；宿主事件消费者 + 投影贡献者；客户端只读投影成品值 + 写入经 Typert RPC。
