# Tasks: dsh-session-tag-manage

按项目规范（openspec/config.yaml rules.tasks）：tasks 不拆分独立文件，只输出单个 tasks.md；使用 checkbox 格式；每个 spec 执行完成后立即执行 sub-agent 任务审计；文件最后一个任务为整体 sub-agent 任务审计。

## 执行顺序与依赖

1. **session-tag-analysis**（宿主核心：事件监听、计时、规则 + LLM 判定、标签持久化）——先行，其他 spec 依赖其 `session-tag/assigned` 事件与 `SessionTag` 类型。
2. **session-tag-projection**（投影注册 + 客户端背景色渲染）——依赖 1 的标签事件与 `config.ts`。
3. **daily-reminder**（每日 17:00 桌面提醒）——依赖 2 的投影（`lastActiveAt`）与 `config.ts`。
4. **manual-tag-update**（手动标签更新：Typert RPC + 宿主服务 + 客户端组件 + 锁定策略）——依赖 1 与 2，可与 3 并行。

## 1. session-tag-analysis（宿主核心）

### 1.1 插件脚手架与配置

- [x] 1.1.1 创建插件包骨架：`dsh-session-tag-manage/package.json`（`type: module`、`dsh.bundle.patch` / `dsh.client` 声明）、`dsh-session-tag-manage/cordis.yml`（`session-tagger` patch 注册，绝对路径指向 `src/index.ts`）、`dsh-session-tag-manage/README.md`
- [x] 1.1.2 定义配置 Schema：`dsh-session-tag-manage/src/config.ts` —— `Config` 接口与 `Schema.object`（`delayMs` 默认 `7*60*1000`、`analysisModel` 默认 `deepseek-v4-flash`、`analysisProvider` 默认 `deepseek`、`maxLastTurnMessages` 默认 50、`highlightTags` 默认 `['abnormal_end','waiting']`、`dailyReminderTime` 默认 `'17:00'`、`desktopReminderEnabled` 默认 true、`manualTagUpdateEnabled` 默认 true），`dailyReminderTime` 含 HH:mm 运行时校验
- [x] 1.1.3 安装依赖：`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-session/types`、`@deepseek-ai/dsh-session-projection/types`（写入 `package.json`）

### 1.2 事件与标签类型

- [x] 1.2.1 定义标签枚举与类型：`dsh-session-tag-manage/src/events.ts` —— `SessionTag`（`in_progress` / `abnormal_end` / `waiting` / `completed` / `invalid`）、`TagId` 品牌类型、`SessionTagSource`（含 `user-override`）
- [x] 1.2.2 声明合并扩展 `SessionEventMap`：`dsh-session-tag-manage/src/events.ts` —— 新增 `session-tag/assigned` 事件类型（`tagId`/`tag`/`source`/`reason?`/`assignedAt`），log-only 非 Surface 事件、`ignorable: true` 语义

### 1.3 规则判定器（纯函数）

- [x] 1.3.1 实现异常终止规则：`dsh-session-tag-manage/src/rules.ts` —— 取最后一个 `turn/end`，`reason` 非 `completed` 即返回 `abnormal_end`
- [x] 1.3.2 实现等待规则：`dsh-session-tag-manage/src/rules.ts` —— 扫日志按 `id` 配对 `approval/asked` 与 `approval/decided`，存在未决 `asked` 即返回 `waiting`
- [x] 1.3.3 实现待办 / 进行中规则：`dsh-session-tag-manage/src/rules.ts` —— 最新 `todo/write` 快照含 `pending`/`in_progress` → `in_progress`；全 `completed` 或空 → 候选 `completed`；不依赖 `agent/status`

### 1.4 标签分析器（计时 + 提取 + LLM 兜底）

- [x] 1.4.1 实现 7 分钟计时管理：`dsh-session-tag-manage/src/tagger.ts` —— `SessionTagger.schedule` 重置式 `setTimeout`（经 `ctx.effect()` 托管、返回取消函数）、`markImmediately`、`dispose`
- [x] 1.4.2 实现内容提取：`dsh-session-tag-manage/src/tagger.ts` —— `extractLastTurn` 定位最后一个 `turn/start` seq 边界，仅收 `user/message` / `assistant/message` 的 `text` 块，过滤文件附件、`reasoning` 块、`tool/*`、`assistant/chunk`，截断到 `maxLastTurnMessages`
- [x] 1.4.3 实现规则 + LLM 兜底分析：`dsh-session-tag-manage/src/tagger.ts` —— `analyze()` 先 `applyRules`，命中即写事件；未命中走 `ctx.llm.stream(GenerateOptions)`（含 provider 路由 + model + messages），经 BlockAssembler 组装文本，JSON 约束解析枚举；`parseTagResult` 解析输出
- [x] 1.4.4 实现标签事件写入：`dsh-session-tag-manage/src/tagger.ts` —— `appendTagEvent` 经 `session.append()` 写 `session-tag/assigned`（`ignorable: true`、payload 可 JSON 序列化）
- [x] 1.4.5 实现锁定手动标签前置检查：`dsh-session-tag-manage/src/tagger.ts` —— `analyze()` 写自动标签前读最近一次标签 `source`，为 `user-override` 则跳过写入

### 1.5 宿主入口编排

- [x] 1.5.1 实现入口：`dsh-session-tag-manage/src/index.ts` —— `apply(ctx, config)`，`inject: ['llm','sessionProjections','sessions']`，副作用导入 `./events`，注册 `session/event` 监听：`turn/end` 异常 reason 即时 `markImmediately`、`completed` 走 `schedule`；`turn/start` 取消旧计时并回 `in_progress`（`ignoreLock` 豁免）；`session/disposed` 回收会话计时；`ctx.effect` disposer 调 `tagger.dispose()`

### 1.6 单元测试与验证

- [x] 1.6.1 规则判定器单元测试：`dsh-session-tag-manage/test/rules.test.ts` —— abnormal / waiting（审批配对）/ todo 推断用例
- [x] 1.6.2 计时与提取单元测试：`dsh-session-tag-manage/test/tagger.test.ts` —— 计时重置、异常即时标记、内容提取排除文件/思考、LLM 兜底、异步竞态回归（logMoved）
- [ ] 1.6.3 开发联调验证：`cordis.yml` + `pnpm dsh web --patch <绝对路径>/cordis.yml`，按 docs/design.md 验证路径 1-4（waiting / abnormal_end / completed / invalid）观察标签事件写入（需 dsh CLI 环境，待用户启动）

### 1.7 sub-agent 任务审计（本 spec）

- [x] 1.7.1 启动 sub-agent 对 session-tag-analysis 全部变更执行代码审查（对照 specs/session-tag-analysis/spec.md 与 docs/design.md 契约：事件契约、计时生命周期、规则判定、LLM 兜底、事件持久化），修复审计问题并重新审计直至通过

## 2. session-tag-projection

### 2.1 投影注册

- [x] 2.1.1 声明合并类型表：`dsh-session-tag-manage/src/projection.ts` —— 合并声明 `SessionProjectionMap`（`tag` / `source` / `lastActiveAt`）与 `SessionProjectionStateMap`（另含 `assignedAt`）
- [x] 2.1.2 实现投影注册：`dsh-session-tag-manage/src/projection.ts` —— `registerTagProjection(ctx)` 调 `ctx.sessionProjections.register`：`key: 'session-tag'`、`stateSchema`（Zod：`tag`/`source`/`assignedAt`/`lastActiveAt` 均可空）、`stateVersion: 3`、`init`、纯同步 `apply`（`session-tag/assigned` 后写覆盖；`ACTIVITY_EVENTS` 刷新 `lastActiveAt` 单调不回退；无关事件返回同一引用）、`wire:{viewSchema,view}`
- [x] 2.1.3 接入入口：`dsh-session-tag-manage/src/index.ts` —— `apply` 内调用 `registerTagProjection(ctx)`

### 2.2 客户端背景色渲染

- [x] 2.2.1 注入全局样式：`dsh-session-tag-manage/src/client/index.ts` + `position.ts` —— 定义 `TAG_STYLES`（`abnormal_end` 红系 / `waiting` 橙系 `!important` 强调、`completed` 绿系、`invalid` 灰淡、`in_progress` 默认），创建 `<style>` 挂 `document.head`，选择器形如 `[data-session-id].stag-*`
- [x] 2.2.2 实现投影读取：`dsh-session-tag-manage/src/client/index.ts` —— 客户端插件 `inject: ['sessions','remote']`，经 `clientSessions(ctx).list.getSnapshot()` 读取列表快照的 `projectionValues`（投影成品值随列表快照下发）
- [x] 2.2.3 实现 CSS 类名定位渲染：`dsh-session-tag-manage/src/client/index.ts` + `position.ts` —— 遍历会话行 DOM（`data-session-id` 优先，缺失时稳定容器选择器 + 行序匹配）挂 `stag-*` class；`MutationObserver` 监听行 DOM 增删 + 订阅列表快照，经 rAF 合并重新 apply

### 2.3 单元测试与验证

- [x] 2.3.1 投影 fold 单元测试：`dsh-session-tag-manage/test/projection.test.ts` —— 后写覆盖、`lastActiveAt` 刷新（单调不回退）、无关事件返回同一引用
- [ ] 2.3.2 客户端渲染验证：本地 dev 运行，确认不同标签会话行显示对应背景色；刷新页面冷读恢复背景色（docs/design.md 验证路径 5，需 dsh CLI 环境，待用户启动）

### 2.4 sub-agent 任务审计（本 spec）

- [x] 2.4.1 启动 sub-agent 对 session-tag-projection 全部变更执行代码审查（对照 specs/session-tag-projection/spec.md 与 docs/design.md 契约：`stateSchema` + `wire` 契约、`apply` 纯同步、CSS 类名定位与 MutationObserver 兜底、`useProjection` 用法），修复审计问题并重新审计直至通过

## 3. daily-reminder

### 3.1 每日提醒客户端逻辑

- [x] 3.1.1 实现提醒排程：`dsh-session-tag-manage/src/client/reminder.ts` —— 计算距下一次 `HH:mm` 的毫秒数，`setTimeout` 循环排程，经客户端 `ctx.effect` 生命周期托管；受 `desktopReminderEnabled` 开关控制（关闭则不排程）
- [x] 3.1.2 实现桌面通知：`dsh-session-tag-manage/src/client/reminder.ts` —— `Notification.requestPermission()`（拒绝静默降级），用 `new Notification(title, { body })` 弹桌面通知，文案 `有 XX 个会话等待确认、XX 个会话异常`；两数皆 0 不发
- [x] 3.1.3 实现统计口径：`dsh-session-tag-manage/src/client/reminder.ts` —— 遍历会话投影，过滤 `lastActiveAt` 属本地时区今日且 `tag ∈ {abnormal_end, waiting}` 计数
- [x] 3.1.4 实现后台节流聚焦兜底：`dsh-session-tag-manage/src/client/reminder.ts` —— 监听 `visibilitychange` / `window.focus`，页面重新可见且已过提醒时刻、今日未提醒时立即补查触发
- [x] 3.1.5 实现当日去重：`dsh-session-tag-manage/src/client/reminder.ts` —— `localStorage['last-notified-date']` 记录今日已提醒，防重复
- [x] 3.1.6 接入客户端入口：`dsh-session-tag-manage/src/client/index.ts` —— `apply` 内调用 `setupDailyReminder(ctx, config)`

### 3.2 单元测试与验证

- [x] 3.2.1 统计与文案单元测试：`dsh-session-tag-manage/test/reminder.test.ts`（统计/文案）+ `test/reminder.dom.test.ts`（DOM 交互）—— 当日活动过滤、双计数文案、非今日不计入、双零不发
- [ ] 3.2.2 通知交互验证：本地 dev 运行，造今日 `waiting` + `abnormal_end` 数据，17:00 后聚焦页签弹出桌面通知且数字正确；关闭开关不弹；拒绝权限静默（docs/design.md 第十一章验证路径，需 dsh CLI 环境，待用户启动）

### 3.3 sub-agent 任务审计（本 spec）

- [x] 3.3.1 启动 sub-agent 对 daily-reminder 全部变更执行代码审查（对照 specs/daily-reminder/spec.md 与 docs/design.md 决策 7：排程、权限、统计口径、聚焦兜底、去重、开关），修复审计问题并重新审计直至通过

## 4. manual-tag-update

### 4.1 Typert RPC 契约与生成

- [x] 4.1.1 声明 Typert contract：`dsh-session-tag-manage/src/override.ts` —— `SessionTagOverrideService.set(sessionId: string, tag: SessionTag): Promise<TagOverrideResult>`（`{ ok: boolean; reason?: string }`）
- [x] 4.1.2 构建生成：本环境无 dsh CLI / Typert 编译器，采用 Typert **SRC（源码）模式**：宿主经 `TypertRemoteService` + `@Remote` 装饰器注册并绑定 Gateway；客户端经 `src/client/typert-stubs.ts` 手写类型合并桩 + `sessionTagOverrideRpc` 解析函数等价替代

### 4.2 宿主服务实现

- [x] 4.2.1 实现服务注册：`dsh-session-tag-manage/src/override.ts` —— `registerTagOverrideService(ctx, config)`（`new SessionTagOverrideService` 经 `TypertRemoteService` 注册）：校验 `manualTagUpdateEnabled` 开关 / `isSessionTag` 五枚举闭集 / `ctx.sessions.get(sessionId)` 存在，任一失败返回 `{ ok: false, reason }` 且不写入；通过后 `session.append('session-tag/assigned', source: 'user-override', reason: 'web ui manual')`
- [x] 4.2.2 接入入口：`dsh-session-tag-manage/src/index.ts` —— `apply` 内调用 `registerTagOverrideService(ctx, config)`

### 4.3 客户端编辑组件

- [x] 4.3.1 实现编辑组件：`dsh-session-tag-manage/src/client/tagEditor.ts` —— 随会话行 CSS 类名定位注入（同背景色定位，复用 `position.ts`），鼠标悬停显示下拉列出 5 个合法标签、当前标签高亮；`source === 'user-override'` 显示"手动"徽标（注：无 JSX，落地为 `.ts`，文件头已注释说明）
- [x] 4.3.2 实现 RPC 调用：`dsh-session-tag-manage/src/client/tagEditor.ts` —— 切换标签经 Typert RPC 桩调用 `sessionTagOverride.set(sessionId, next)`；失败（开关关闭 / 非法值 / 会话不存在 / RPC 缺省）保留原值并提示；`RemoteResult` 三级分支完备；`pending` 标志防重入
- [x] 4.3.3 开关控制渲染：`dsh-session-tag-manage/src/client/tagEditor.ts` —— `manualTagUpdateEnabled === false` 时不渲染编辑入口（`setupTagEditor` 提前返回）

### 4.4 单元测试与验证

- [x] 4.4.1 宿主服务单元测试：`dsh-session-tag-manage/test/override.test.ts` —— 开关关闭 / 非法标签 / 会话不存在均拒绝且不写入；合法写入生成 `source: 'user-override'` 事件
- [ ] 4.4.2 端到端验证：本地 dev 运行，Web UI 将 `abnormal_end` 手动改为 `invalid` → 事件写入、投影更新、背景色同步灰淡；7 分钟内再次触发分析标签不被覆盖；新发消息（`turn/start`）重置 `in_progress`；关闭开关编辑入口隐藏且服务拒绝（docs/design.md 第十二章验证路径 + 第十章验证路径 7，需 dsh CLI 环境，待用户启动）

### 4.5 sub-agent 任务审计（本 spec）

- [x] 4.5.1 启动 sub-agent 对 manual-tag-update 全部变更执行代码审查（对照 specs/manual-tag-update/spec.md 与 docs/design.md 决策 8：Typert RPC 通路、宿主校验、后写覆盖、锁定手动标签、开关双重生效），修复审计问题并重新审计直至通过（通过；修复防重入 + inject 补 remote）

## 5. 端到端验证与整体收尾

- [ ] 5.1 端到端验证：docs/design.md 第十章 7 步验证路径全部通过（waiting / abnormal_end / completed / invalid 打标、刷新恢复、17:00 提醒、手动改标签同步与锁定、开关关闭拒绝）（需 dsh CLI 环境 + 启动 dev 服务，待用户确认）
- [x] 5.2 最终 sub-agent 任务审计：对整体变更（4 个 spec 全部实现）执行全量代码审查，发现的问题修复后重新审计直至通过（通过：0 阻断；补 2 项重要测试缺口——宿主入口编排集成测试 test/index.test.ts（6 例）+ LLM 异步竞态 logMoved 回归测试（1 例）；当前 typecheck 通过、66 测试全绿）
