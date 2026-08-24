# Capability Spec: session-tag-projection

模块归属：dsh-session-tag-manage / 宿主投影（src/projection.ts）+ 客户端渲染（src/client/index.ts）

## ADDED Requirements

### Requirement: 会话标签投影注册
系统 SHALL 通过 `ctx.sessionProjections.register` 注册 `session-tag` 投影单元，MUST 合并声明 `SessionProjectionMap`（客户端可见值：`tag` / `source` / `lastActiveAt`）与 `SessionProjectionStateMap`（宿主 fold 状态：另含 `assignedAt`）两个类型表。投影定义 MUST 使用 `stateSchema`（Zod 校验持久化 state）与可选 `wire:{viewSchema,view}`（客户端视图）；`apply` MUST 为纯同步 fold，对无关事件 MUST 返回同一状态引用（`Object.is` 相等），对 `session-tag/assigned` 事件后写覆盖整份状态，对活动事件集（`turn/start`、`user/message`、`assistant/message`、`tool/call`、`tool/result`、`approval/asked`）刷新 `lastActiveAt`。

#### Scenario: 投影随事件更新
- **GIVEN** 已注册 `session-tag` 投影且某会话收到 `session-tag/assigned` 事件
- **WHEN** 投影注册表对该事件执行 fold
- **THEN** 投影状态更新为事件携带的 `tag` / `source` / `assignedAt`，`lastActiveAt` 保持或刷新

#### Scenario: 无关事件零下游工作
- **GIVEN** 投影已处于某状态
- **WHEN** 收到与标签和活动无关的事件（如 `step/start`）
- **THEN** `apply` 返回与之前完全相同的状态引用，不产生下游更新

### Requirement: 客户端背景色渲染
客户端插件 SHALL 读取 `session-tag` 投影成品值（经 `useProjection('session-tag')`，由 `SessionStandardProps` 槽位 kit 注入），并按标签为会话行渲染不同背景色。不同标签 MUST 映射不同样式：`abnormal_end` 红系强调、`waiting` 橙系强调（两者用 `!important` 覆盖主题默认背景）、`completed` 绿系淡显、`invalid` 灰淡、`in_progress` 默认样式。渲染 MUST 采用 CSS 类名定位：遍历会话行 DOM（`data-session-id` 属性优先，缺失时稳定容器选择器 + 行序匹配）挂插件自有 `stag-*` class 并注入全局样式，不依赖 ui-workspace 内部 CSS-module 类名；MUST 用 `MutationObserver` 监听列表容器增删与投影更新后重新应用。

#### Scenario: 按标签显示对应背景色
- **GIVEN** 某会话投影标签为 `abnormal_end` 且其会话行已渲染
- **WHEN** 客户端应用样式
- **THEN** 该会话行挂载 `stag-abnormal` class 并显示红系强调背景

#### Scenario: 冷读恢复背景色
- **GIVEN** 页面刷新且投影缓存中包含历史标签
- **WHEN** 客户端初始化并读取投影
- **THEN** 各会话行按投影标签恢复对应背景色

#### Scenario: 列表增删兜底重应用
- **GIVEN** 会话列表容器发生行增删（MutationObserver 触发）
- **WHEN** 客户端检测到 DOM 变化
- **THEN** 系统重新定位会话行并应用最新投影标签样式
