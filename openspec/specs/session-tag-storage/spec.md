# Spec: Session Tag Storage

## Overview

会话标签持久化存储能力。宿主插件通过 `ctx.storageDomain` 创建 `dsh-session-tag-manage` 存储域，按工作区隔离存储会话标签数据。数据持久化到 `~/.dsh/storages/dsh-session-tag-manage.json`，支持多浏览器标签页并发访问。模块归属：`packages/dsh-session-host/`。

## Requirements

### Requirement: 存储域创建与初始化

宿主插件 SHALL 使用 `defineDomain` 定义并注册 `dsh-session-tag-manage` 存储域，Schema 包含 `workspaces` 字段（按工作区 ID 分组的会话标签数据）。

#### Scenario: 存储域首次创建

- **WHEN** 宿主插件首次加载且存储域不存在
- **THEN** 自动创建 `~/.dsh/storages/dsh-session-tag-manage.json`，初始结构为 `{ workspaces: {} }`

#### Scenario: 存储域已存在

- **WHEN** 宿主插件加载且存储域文件已存在
- **THEN** 读取现有数据，保持原有结构不变

### Requirement: 按工作区隔离存储

存储域 SHALL 按 `workspaceId` 隔离存储会话标签数据，每个工作区独立存储，互不干扰。

#### Scenario: 写入工作区数据

- **WHEN** 向存储域写入 `workspaceId = "ws-aaa"` 的会话标签数据
- **THEN** 仅更新 `global.workspaces["ws-aaa"]`，其他工作区数据不受影响

#### Scenario: 读取工作区数据

- **WHEN** 从存储域读取 `workspaceId = "ws-aaa"` 的数据
- **THEN** 返回该工作区下的 `sessions` 数组（`SessionTagEntry[]`），若工作区不存在则返回空数组

### Requirement: 数据结构定义

存储域 SHALL 使用以下 Schema 结构：

```typescript
interface SessionTagEntry {
  sessionId: string       // 会话 ID
  title: string           // 会话标题
  sessionCurrentTag: string // 当前标签（状态枚举）
  createdAt: string       // 创建时间（ISO 8601）
  updatedAt: string       // 更新时间（ISO 8601）
}

interface WorkspaceTagData {
  sessions: SessionTagEntry[]
}

interface TagDomainGlobal {
  workspaces: Record<string, WorkspaceTagData>
}
```

#### Scenario: 标签状态枚举

- **WHEN** 存储会话标签
- **THEN** `sessionCurrentTag` 字段值为以下枚举之一：`任务进行中`、`任务暂停`、`任务等待确认`、`任务部分完成`、`任务已完结`、`无效会话`、`打招呼`、`聊天`、`咨询`

### Requirement: 并发安全

存储域 SHALL 支持多浏览器标签页并发读写，通过 `ctx.storageDomain` 的内置机制保证数据一致性。

#### Scenario: 并发写入

- **WHEN** 两个浏览器标签页同时写入不同工作区的数据
- **THEN** 两个工作区的数据均正确持久化，无数据丢失或覆盖

### Requirement: 插件生命周期管理

宿主插件 SHALL 在 `apply` 函数中打开存储域，在插件卸载时关闭存储域。

#### Scenario: 插件初始化

- **WHEN** 宿主插件通过 Cordis 框架加载
- **THEN** 调用 `ctx.storageDomain.open(tagDomainSpec)` 打开存储域

#### Scenario: 插件卸载清理

- **WHEN** 宿主插件被卸载
- **THEN** 调用 `tagDomain.close()` 关闭存储域连接
