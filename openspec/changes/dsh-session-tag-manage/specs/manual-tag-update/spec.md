# Capability Spec: manual-tag-update

模块归属：dsh-session-tag-manage / 宿主服务（src/override.ts）+ 客户端组件（src/client/tagEditor.tsx）+ 配置（src/config.ts）

## ADDED Requirements

### Requirement: Web UI 手动标签更新
系统 SHALL 允许用户在 Web UI 将会话标签手动修改为五分类之一（`in_progress` / `abnormal_end` / `waiting` / `completed` / `invalid`）。客户端编辑组件 MUST 经 **Typert RPC**（构建时生成的类型化桩）调用宿主 `sessionTagOverride.set(sessionId, tag)`；宿主服务 MUST 校验后追加一条 `source: 'user-override'` 的 `session-tag/assigned` 事件，经投影"后写覆盖"同步更新会话标签数据与 UI 背景色。

#### Scenario: 手动改标签同步数据与 UI
- **GIVEN** 某会话当前标签为 `abnormal_end`，用户将其改为 `invalid`
- **WHEN** 客户端调用 `sessionTagOverride.set(sessionId, 'invalid')` 且宿主校验通过
- **THEN** 会话日志追加 `source: 'user-override'` 的标签事件，投影更新为 `invalid`，该会话行背景色同步变为无效会话灰淡样式

#### Scenario: 编辑入口随开关隐藏
- **GIVEN** `manualTagUpdateEnabled` 为 `false`
- **WHEN** 客户端渲染会话行
- **THEN** 系统不渲染标签编辑入口

### Requirement: 宿主服务校验
宿主 `sessionTagOverride.set` MUST 依次校验：`manualTagUpdateEnabled` 开关开启、`tag` 属于合法五枚举闭集、会话存在；任一校验失败 MUST 返回失败结果（含原因）且不写入任何事件。

#### Scenario: 开关关闭拒绝写入
- **GIVEN** `manualTagUpdateEnabled` 为 `false`
- **WHEN** 客户端调用 `sessionTagOverride.set`
- **THEN** 宿主返回 `{ ok: false, reason: 'manual tag update disabled' }` 且不写入事件

#### Scenario: 非法标签拒绝写入
- **GIVEN** 客户端传入 `tag` 值不在五枚举闭集内
- **WHEN** 调用 `sessionTagOverride.set`
- **THEN** 宿主返回失败结果且不写入事件

#### Scenario: 会话不存在拒绝写入
- **GIVEN** 客户端传入不存在的 `sessionId`
- **WHEN** 调用 `sessionTagOverride.set`
- **THEN** 宿主返回 `{ ok: false, reason: 'session not found' }` 且不写入事件

### Requirement: 锁定手动标签冲突策略
当最近一次标签来源为 `user-override` 时，系统 SHALL 在自动分析时不覆盖该标签（不产生新事件、不覆盖投影）；当会话开始新的轮次（收到 `turn/start`）时，系统 MUST 将其重置为 `in_progress`。

#### Scenario: 自动分析不覆盖手动标签
- **GIVEN** 某会话最近一次标签 `source` 为 `user-override`（如手动改为 `invalid`）
- **WHEN** 该会话 7 分钟定时器触发自动分析且规则 / LLM 判出不同标签
- **THEN** 系统跳过写入，保持 `invalid` 标签不变

#### Scenario: 新轮次重置为进行中
- **GIVEN** 某会话标签为手动设置的 `invalid`（`source` 为 `user-override`）
- **WHEN** 会话收到新的 `turn/start` 事件
- **THEN** 系统将标签重置为 `in_progress`

### Requirement: 手动标签来源标识
客户端标签编辑组件 SHALL 展示当前标签并可列出 5 个合法标签供选择（当前标签高亮）；当标签 `source === 'user-override'` 时 SHALL 显示"手动"徽标以区别于自动分析标签。手动修改失败的场景 MUST 保留原值并提示。

#### Scenario: 显示手动徽标
- **GIVEN** 某会话标签 `source` 为 `user-override`
- **WHEN** 客户端渲染标签编辑组件
- **THEN** 组件显示"手动"徽标

#### Scenario: 修改失败保留原值
- **GIVEN** 用户尝试将标签改为某值但宿主返回失败（如开关已关闭）
- **WHEN** 客户端处理失败结果
- **THEN** 会话标签保持原值并提示用户修改失败
