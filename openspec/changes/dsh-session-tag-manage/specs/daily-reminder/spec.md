# Capability Spec: daily-reminder

模块归属：dsh-session-tag-manage / 客户端（src/client/reminder.ts）+ 配置（src/config.ts）

## ADDED Requirements

### Requirement: 每日会话梳理桌面提醒
系统 SHALL 在每天 `dailyReminderTime`（默认 `17:00`，HH:mm 格式）执行一次会话梳理提醒。统计口径 MUST 为：当天有活动（投影 `lastActiveAt` 落在本地时区今日）且标签 ∈ {`abnormal_end`, `waiting`} 的会话。两项计数均为 0 时 MUST 不弹出提醒。

#### Scenario: 当日存在待关注会话时提醒
- **GIVEN** 今日存在 1 个 `waiting` 会话和 2 个 `abnormal_end` 会话（`lastActiveAt` 均属今日）
- **WHEN** 到达提醒时刻且触发提醒逻辑
- **THEN** 系统弹出桌面通知，文案为"有 1 个会话等待确认、2 个会话异常"

#### Scenario: 无待关注会话时不打扰
- **GIVEN** 今日没有活动或今日活动会话标签均非 `abnormal_end` / `waiting`
- **WHEN** 到达提醒时刻
- **THEN** 系统不弹出任何提醒

#### Scenario: 非今日活动不计入
- **GIVEN** 某会话标签为 `abnormal_end` 但 `lastActiveAt` 属于历史日期
- **WHEN** 到达提醒时刻统计
- **THEN** 该会话不计入"异常"计数

### Requirement: 桌面通知载体与权限
提醒 MUST 通过浏览器 **Web Notifications API** 弹出（不占用页签内 UI，页签未激活也能展示）；MUST 先请求 `Notification.requestPermission()`，权限被拒绝时 MUST 静默降级（不打扰、不报错）。

#### Scenario: 权限拒绝时静默
- **GIVEN** 用户拒绝通知权限
- **WHEN** 到达提醒时刻
- **THEN** 系统不弹通知且不产生错误提示

### Requirement: 后台节流聚焦兜底
系统 MUST 以定时排程（`setTimeout` 循环，经客户端 `ctx.effect` 托管）触发提醒；鉴于浏览器对后台页签定时器节流，系统 MUST 额外监听 `visibilitychange` / `window.focus`——当页面重新可见且已过今日提醒时刻、今日尚未提醒过时，立即补查并触发。

#### Scenario: 聚焦补查
- **GIVEN** 页面在提醒时刻处于后台被节流，今日尚未提醒，此时页签被聚焦且已过提醒时刻
- **WHEN** 触发 `visibilitychange` / `focus`
- **THEN** 系统立即执行统计与提醒

#### Scenario: 当日去重
- **GIVEN** 今日已触发过一次提醒（`localStorage` 记录了 `last-notified-date` 为今日）
- **WHEN** 再次到达提醒时刻或聚焦补查
- **THEN** 系统不重复弹出提醒

### Requirement: 提醒开关控制
系统 SHALL 提供 `desktopReminderEnabled` 配置（默认 `true`）；关闭时 MUST 不排程、不弹任何提醒，且不影响标签分析与背景色渲染等其余功能。

#### Scenario: 关闭开关不提醒
- **GIVEN** `desktopReminderEnabled` 为 `false`
- **WHEN** 到达提醒时刻
- **THEN** 系统不弹出提醒，其余功能正常运行
