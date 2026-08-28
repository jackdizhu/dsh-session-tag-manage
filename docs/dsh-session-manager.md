# dsh-session-manager 项目完整说明文档

## 1. 项目概览

### 1.1 项目定位

`dsh-session-manager` 是一个 **DeepSeek Harness (DSH) 插件**，为 DSH Web UI 提供全面的会话管理能力。它在不修改 DSH 核心代码的前提下，通过宿主侧（Host）HTTP 路由 + 客户端侧（Client）UI 注入的方式，实现了会话的删除（含回收站）、恢复归档、统计、继续/暂停、fork、未读标记、工作区管理、上下文压缩阈值设置等功能。

当前版本适配 DSH `0.1.1-rc.1`。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **只通过官方 RPC / HTTP 路由操作** | 绝不直接修改 DSH 核心代码或存储文件 |
| **先归档再移动** | 删除会话先走官方归档通道（侧边栏立即隐藏），再移文件到回收站 |
| **可恢复优先** | 删除为软删除（移入回收站），保留最近 10 条，支持恢复 |
| **运行中保护** | 正在思考（running）的会话禁止删除 |
| **对模型行为零影响** | 无系统提示词改动、无模型工具新增 |

---

## 2. 项目架构

### 2.1 整体架构图

```mermaid
graph TB
    subgraph Browser["浏览器 (Client)"]
        UI["React UI 组件"]
        SETTINGS["设置页分栏<br/>Session Manager"]
        DRAWER["对话管理抽屉"]
        HEADER["对话顶部按钮"]
        UNREAD["未读标记系统"]
        SIDEBAR["侧边栏蓝色未读点<br/>MutationObserver 装饰"]
    end

    subgraph Host["DSH 宿主进程 (Node.js)"]
        ROUTES["7 条 HTTP 路由<br/>POST/GET /dsh-session-manager/*"]
        STORAGE["ctx.storageDomain<br/>回收站条目 + 压缩阈值"]
        PERSIST["ctx.sessionPersistence<br/>会话持久化"]
        WORKSPACE["ctx.workspaceRegistry<br/>归档 / 取消归档"]
        AGENTS["ctx.agents<br/>运行状态检测 + 暂停"]
        PRESETS["ctx.agentPresets<br/>Agent 预设 + 压缩引擎"]
    end

    subgraph DSH["DSH 官方 API 层"]
        WIRE["session.list / workspace.list<br/>ObservableSnapshot 订阅"]
        FORK["sessions.fork<br/>官方 fork API"]
        HISTORY["session.history<br/>统计折叠数据源"]
    end

    UI --> SETTINGS
    UI --> DRAWER
    UI --> HEADER
    UI --> UNREAD
    SIDEBAR -.->|"MutationObserver<br/>标题文本匹配"| UNREAD

    SETTINGS -->|"fetch POST/GET"| ROUTES
    DRAWER -->|"fetch POST/GET"| ROUTES
    HEADER -->|"fetch POST"| ROUTES

    ROUTES --> PERSIST
    ROUTES --> WORKSPACE
    ROUTES --> AGENTS
    ROUTES --> STORAGE
    ROUTES --> PRESETS

    WIRE -.->|"useSessions / useWorkspaces<br/>标准数据源"| UI
    FORK -.->|"api.sessions.fork"| DRAWER
    HISTORY -.->|"api.sessions.history"| UI
```

### 2.2 目录结构

```
dsh-session-manager/
├── package.json              # 包描述 + dsh.plugin manifest
├── cordis.patch.yml          # DSH 运行时 provider 注册补丁
├── tsconfig.json             # TypeScript 配置
├── tsdown.config.ts          # 构建配置（Host ESM + Client CJS 双产物）
├── src/
│   ├── index.ts              # 宿主侧入口：7 条路由 + 压缩阈值逻辑
│   ├── contract.ts           # Host ↔ Client 共享类型 + 路由常量
│   └── client/
│       └── index.ts          # 客户端入口：设置分栏 / 抽屉 / 按钮 / 未读 / 侧边栏装饰
├── lib/                      # 构建产物（提交到仓库）
│   ├── index.js              # Host 产物（ESM）
│   ├── client.js             # Client 产物（CJS，UMD wrapper）
│   └── types/                # TypeScript 类型声明
│       ├── index.d.ts
│       ├── contract.d.ts
│       └── client/
│           └── index.d.ts
├── tests/
│   └── index.test.ts         # openFolderCommand 跨平台测试
├── docs/
│   ├── design.md             # 设计文档
│   └── dsh-session-manager.md
├── assets/                   # 截图
├── README.md / README.en.md
├── CHANGELOG.md
└── LICENSE
```

### 2.3 构建产物说明

构建使用 `tsdown`，产出两个独立 bundle：

| 产物 | 格式 | 平台 | 目标 | 说明 |
|------|------|------|------|------|
| `lib/index.js` | ESM | Node.js | ES2024 | 宿主侧插件，所有 `@deepseek-ai` 包保持 external |
| `lib/client.js` | CJS | Browser | ES2022 | 客户端插件，通过 `window.__ModuleLoader__` UMD wrapper 加载 |

客户端构建通过 `banner` + `footer` 注入模块加载器：
```javascript
window.__ModuleLoader__.load({ id: "dsh-session-manager", factory: (require) => {
  // ... client code ...
  return module.exports; } });
```

---

## 3. 宿主侧（Host）详解

### 3.1 插件注册

```typescript
export const name = 'dsh-session-manager'
export const inject = [
  'webServer',           // HTTP 路由注册
  'sessionPersistence',  // 会话持久化查询
  'workspaceRegistry',   // 工作区归档/取消归档
  'agents',              // Agent 运行状态检测
  'storageDomain',       // 持久化存储域（回收站 + 阈值）
  'loader',              // 插件加载器
  'agentPresets',        // Agent 预设服务
]
```

### 3.2 路由注册总览

```mermaid
graph LR
    subgraph "POST /dsh-session-manager/*"
        DELETE["/delete<br/>软删除（移入回收站）"]
        RESTORE["/restore<br/>从回收站恢复"]
        PURGE["/purge<br/>彻底删除"]
        PAUSE["/pause<br/>暂停运行中会话"]
        OPEN_FOLDER["/open-folder<br/>打开日志目录"]
    end

    subgraph "GET|POST /dsh-session-manager/*"
        TRASH["GET /trash<br/>回收站列表"]
        THRESHOLD["GET|POST /compaction-threshold<br/>读写压缩阈值"]
    end

    style DELETE fill:#fee2e2,stroke:#ef4444
    style RESTORE fill:#dcfce7,stroke:#22c55e
    style PURGE fill:#fef3c7,stroke:#f59e0b
    style PAUSE fill:#e0e7ff,stroke:#6366f1
    style OPEN_FOLDER fill:#f3e8ff,stroke:#a855f7
```

### 3.3 数据存储架构

```mermaid
graph TB
    subgraph DSH_Safe["~/.dsh/ 目录（DSH 官方管理）"]
        STORAGES["storages/*.json<br/>DSH 官方存储"]
        SESSIONS_DIR["sessions/<session-id>/"]
    end

    subgraph Plugin_Safe["插件管理的存储"]
        DOMAIN_JSON["storages/dsh_delete_session.json<br/>ctx.storageDomain('dsh_delete_session')<br/>├── entries: TrashEntry[]（回收站条目）<br/>└── thresholdRatio: number（压缩阈值）"]
        TRASH_DIR["dsh-delete-session-trash/<session-id>/<br/>已删除会话的文件副本"]
    end

    subgraph Browser_Local["浏览器 localStorage"]
        REMOVED["dsh-delete-session.removed<br/>已彻底删除的 session id 集合"]
        TITLES["dsh-delete-session.titles<br/>删除时的会话标题快照"]
        UNREAD_STORE["dsh.session-unread.v1<br/>{version:1, ids:[]} 手动未读集合"]
    end

    DELETE_FLOW["删除操作"] -->|"1. archiveSession()"| STORAGES
    DELETE_FLOW -->|"2. rename()"| TRASH_DIR
    DELETE_FLOW -->|"3. setEntries()"| DOMAIN_JSON
    DELETE_FLOW -->|"4. add()"| REMOVED

    RESTORE_FLOW["恢复操作"] -->|"1. rename() 回原位"| SESSIONS_DIR
    RESTORE_FLOW -->|"2. unarchive()"| STORAGES
    RESTORE_FLOW -->|"3. drop entry"| DOMAIN_JSON
```

### 3.4 回收站条目结构（TrashEntry）

```typescript
interface TrashEntry {
  sessionId: string      // 会话 id（三种格式均支持）
  cwd?: string           // 删除时的工作目录
  originalPath?: string  // 原始磁盘路径（恢复时移回）
  deletedAt: number      // 删除时间戳 (epoch ms)
}
```

支持的会话 id 格式：
- `session-<uuid>` — Web UI 创建
- `session-<n>` — Store minted（如 fork 创建）
- `<uuid>` — 子代理（subagent）创建

### 3.5 串行化互斥锁（Mutation Lock）

所有修改操作（delete / restore / purge / compaction-threshold）共享一个 Promise 链式的互斥锁：

```typescript
let mutationTail: Promise<void> = Promise.resolve()
const withMutationLock = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}
```

这保证多浏览器页面同时操作时不会读到旧状态互相覆盖。

---

## 4. 客户端（Client）详解

### 4.1 插件入口与服务注入

```typescript
export const name = 'dsh-session-manager/client'
export const inject = ['slots', 'locale', 'connection', 'sessions', 'workspaces']
```

客户端通过 DSH 官方插槽系统注入 UI 组件：

### 4.2 插槽注册总览

```mermaid
graph TB
    subgraph Slots["DSH 官方插槽"]
        SETTINGS_SECTION["settings.section<br/>设置页独立分栏"]
        SETTINGS_GENERAL["settings.general.item<br/>通用设置项"]
        CONV_HEADER["conversation.session.header.utilities<br/>对话顶部工具栏"]
    end

    subgraph Plugin_Components["本插件组件"]
        SM["SessionManager<br/>会话管理面板"]
        COMPACT["CompactionThresholdRow<br/>压缩阈值设置"]
        DRAWER_HOST["SessionDrawerHost<br/>抽屉 Portal 宿主"]
        MANAGE_BTN["HeaderManageButton<br/>对话管理按钮"]
        DEL_BTN["DeleteCurrentButton<br/>删除本对话按钮"]
    end

    SETTINGS_SECTION -->|"id: dsh-delete-session<br/>order: 60"| SM
    SETTINGS_GENERAL -->|"id: dsh-delete-session-compaction-threshold<br/>order: 50"| COMPACT
    CONV_HEADER -->|"id: dsh-delete-session-drawer-host<br/>order: -40"| DRAWER_HOST
    CONV_HEADER -->|"id: dsh-delete-session-manage<br/>order: -30"| MANAGE_BTN
    CONV_HEADER -->|"id: dsh-delete-session<br/>order: -10"| DEL_BTN
```

### 4.3 会话管理面板（SessionManager）

设置页的核心组件，功能包括：

| 功能 | 说明 |
|------|------|
| 会话列表 | 按工作区分组，组内按最后使用时间排序（最新/最旧切换） |
| 已归档会话 | 底部折叠区，支持一键恢复 |
| 回收站 | 底部折叠区，保留最近 10 条，支持恢复 / 彻底删除 |
| 批量删除 | 复选框全选 / 工作区级全选 / 逐个选择 |
| 工作区管理 | 拖拽排序、置于顶部、重命名、删除（二次确认） |
| 行操作 | 继续 / 暂停 / fork / 统计 / 文件夹 / 删除 |
| 未读标记 | 蓝色（手动）/ 琥珀（官方等待）/ 绿色（官方完成）/ 转圈（运行中） |

### 4.4 抽屉（SessionDrawer）

对话顶部的右侧抽屉面板，通过 `createPortal` 渲染到 `document.body`：

- 通过 `sessions.list`（ObservableSnapshot）实时订阅官方会话列表
- 每 5 秒轮询一次工作区列表和回收站，保持 running/idle 状态同步
- 支持图钉固定（pinned 模式下点击外部不收起）
- 每行有「更多」悬浮菜单（统计 / 文件夹 / fork / 删除）

### 4.5 未读标记系统

```mermaid
stateDiagram-v2
    [*] --> 已读: 初始状态
    已读 --> 手动未读_蓝色: 点击空白位置
    手动未读_蓝色 --> 已读: 点击蓝色点
    已读 --> 自动未读_琥珀: 官方 pendingInteraction
    已读 --> 自动未读_绿色: 官方 completed
    自动未读_琥珀 --> 已读: 点击琥珀点（就地标记）
    自动未读_绿色 --> 已读: 点击绿色点（就地标记）
    运行中 --> 已读: 打开会话
    手动未读_蓝色 --> 已读: 打开会话（自动已读）

    state 运行中 {
        [*] --> 转圈: session.running === true
    }
```

**存储机制**：
- 手动未读集保存在浏览器 localStorage 共享 key `dsh.session-unread.v1`
- 格式：`{version: 1, ids: string[]}`（与其他会话管理插件互通）
- 侧边栏蓝色未读点通过 `MutationObserver` 装饰官方树节点（按标题文本匹配）

**状态优先级**（从高到低）：
1. `running === true` → 转圈（ongoing）
2. 手动未读（blue）
3. `pendingInteraction !== undefined` → 琥珀（warning）
4. `completed === true` → 绿色（done）

---

## 5. 核心交互流程

### 5.1 删除会话流程（软删除）

```mermaid
flowchart TD
    A["用户点击「删除」"] --> B{"确认删除?"}
    B -->|"取消"| Z["返回"]
    B -->|"确定"| C["POST /dsh-session-manager/delete<br/>{ sessionId }"]

    C --> D["withMutationLock 串行化"]
    D --> E{"agent.status === 'running'?"}
    E -->|"是"| F["返回 409 session-live<br/>（运行中不可删除）"]
    E -->|"否"| G["ctx.sessionPersistence.locate()<br/>获取原始磁盘路径"]

    G --> H["ctx.workspaceRegistry.archiveSession()<br/>归档（侧边栏立即隐藏）"]
    H --> I{"归档成功?"}
    I -->|"否"| J["返回 500 archive-failed"]
    I -->|"是"| K{"归档集合遗漏?<br/>（stale registry cache）"}
    K -->|"是"| L["补丁 archivedSessionIds"]
    K -->|"否"| M{"live 会话?<br/>（内存中有 agent）"}
    L --> M

    M -->|"是"| N["跳过文件移动<br/>（重启时 DSH 清理内存）"]
    M -->|"否"| O{"原始路径存在?"}
    O -->|"否"| P["记录条目<br/>（blank session）"]
    O -->|"是"| Q["mkdir -p trashRoot<br/>mv 原始路径 → trash路径"]

    Q --> R{"文件移动成功?"}
    R -->|"否"| S["回滚：unarchive + 返回 500"]
    R -->|"是"| P

    N --> P
    P --> T["setEntries()<br/>追加 TrashEntry"]
    T --> U{"超出 TRASH_LIMIT(10)?"}
    U -->|"是"| V["移除最早的条目<br/>rm 其 trash 目录"]
    U -->|"否"| W["返回 200 ok"]
    V --> W

    W --> X["Client: markRemoved()<br/>写入 localStorage<br/>防止刷新后复活"]
    X --> Y["loadTrash() 刷新回收站列表"]
```

### 5.2 恢复会话流程

```mermaid
flowchart TD
    A["用户点击「恢复」"] --> B{"确认恢复?"}
    B -->|"取消"| Z["返回"]
    B -->|"确定"| C["POST /dsh-session-manager/restore<br/>{ sessionId }"]

    C --> D["withMutationLock 串行化"]
    D --> E{"找到 trash entry?"}

    E -->|"否（仅归档状态）"| F{"会话元数据存在?"}
    F -->|"否"| G["返回 404"]
    F -->|"是"| H["unarchive 取消归档<br/>返回 200 ok"]

    E -->|"是（回收站中）"| I{"trash 中有文件?"}
    I -->|"否"| J["跳过文件移动<br/>（live/blank session）"]
    I -->|"是"| K{"原始路径已存在?<br/>（live session 继续写入）"}
    K -->|"是"| L["丢弃 trash 副本<br/>保留更新的原始文件"]
    K -->|"否"| M["mv trash → 原始路径"]

    J --> N["unarchive 取消归档"]
    L --> N
    M --> N

    N --> O["drop trash entry"]
    O --> P["返回 200 ok"]
    P --> Q["Client: sessions.refresh()<br/>重新拉取列表"]
```

### 5.3 彻底删除流程

```mermaid
flowchart TD
    A["用户点击「彻底删除」"] --> B{"确认?"}
    B -->|"取消"| Z["返回"]
    B -->|"确定"| C["POST /dsh-session-manager/purge<br/>{ sessionId }"]

    C --> D["withMutationLock 串行化"]
    D --> E{"找到 trash entry?"}
    E -->|"否"| F["返回 404"]
    E -->|"是"| G["rm trash 目录"]
    G --> H["rm 原始路径（如有）"]
    H --> I["drop trash entry"]
    I --> J["返回 200 ok"]
    J --> K["Client: markRemoved()<br/>+ loadTrash()"]
```

### 5.4 上下文压缩阈值流程

```mermaid
flowchart TD
    subgraph GET["GET /compaction-threshold"]
        G1["读取 configuredThreshold<br/>（内存变量）"]
        G2{"已配置?"}
        G3["返回 configuredThreshold"]
        G4["读取默认预设文件"]
        G5["解析 compaction-basic<br/>中的 thresholdRatio"]
        G6["返回文件值或默认 0.8"]

        G1 --> G2
        G2 -->|"是"| G3
        G2 -->|"否"| G4 --> G5 --> G6
    end

    subgraph POST["POST /compaction-threshold"]
        P1["校验 ratio ∈ [0.17, 0.9]"]
        P2["setConfiguredThreshold()<br/>持久化到 storageDomain"]
        P3{"预设为 user?"}
        P4["writePresetComposition()<br/>原子写入 agent.cordis.yml"]
        P5["跳过（系统预设只读）"]
        P6["applyThresholdToLiveAgents()<br/>热更新所有运行中 Agent"]
        P7["返回 200 ok"]

        P1 --> P2 --> P3
        P3 -->|"user"| P4 --> P6 --> P7
        P3 -->|"system"| P5 --> P6
    end
```

**全局生效机制**：宿主在每个 `agent/pre-step` 钩子中强制注入阈值：

```mermaid
sequenceDiagram
    participant Agent as Agent Loop
    participant Hook as agent/pre-step hook
    participant Engine as Compaction Engine

    loop 每个 step boundary
        Agent->>Hook: 触发 pre-step
        Hook->>Engine: engine.config.thresholdRatio = configuredThreshold
        Hook->>Agent: next()
    end
```

### 5.5 侧边栏未读标记装饰流程

```mermaid
flowchart TD
    A["MutationObserver<br/>监听 document.body"] --> B{"DOM 变化?"}
    B -->|"否"| A
    B -->|"是"| C["requestAnimationFrame 节流"]
    C --> D["遍历 sessions.list.getSnapshot()"]
    D --> E["建立 title → sessionId 映射"]
    E --> F["遍历所有 [role=treeitem] 元素"]
    F --> G["匹配 span.textContent ↔ 映射"]
    G --> H{"匹配到?"}
    H -->|"否"| F
    H -->|"是"| I{"unreadState.has(id)?"}
    I -->|"是"| J{"已有蓝点?"}
    J -->|"否"| K["创建蓝点 span<br/>插入 title 前"]
    J -->|"是"| L["保留"]
    I -->|"否"| M{"已有蓝点?"}
    M -->|"是"| N["remove()"]
    M -->|"否"| O["跳过"]

    K --> F
    L --> F
    N --> F
    O --> F
```

---

## 6. 数据流总览

### 6.1 删除操作的完整数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant C as Client (React)
    participant H as Host (Node.js)
    participant WS as ctx.webServer
    participant SP as ctx.sessionPersistence
    participant WR as ctx.workspaceRegistry
    participant SD as ctx.storageDomain
    participant FS as 文件系统

    U->>C: 点击「删除」
    C->>C: confirm() 确认
    C->>C: saveTitle(sessionId, title) → localStorage
    C->>WS: POST /delete { sessionId }
    WS->>H: readJsonBody → parseSessionId
    H->>H: withMutationLock 串行化
    H->>SP: list() → 找到 meta
    H->>H: agents.get(id) → 检查 running
    alt running
        H-->>C: 409 session-live
    else idle
        H->>SP: locate(meta) → 原始路径
        H->>WR: archiveSession(id) → 归档
        Note over WR: 侧边栏立即隐藏
        H->>SD: set({ archivedSessionIds: [..., id] })
        H->>FS: rename(originalPath → trashPath)
        H->>SD: setEntries([...entries, entry])
        H-->>C: 200 ok
        C->>C: markRemoved(id) → localStorage
        C->>C: loadTrash() → 刷新回收站
    end
```

### 6.2 统计数据折叠流

```mermaid
flowchart LR
    A["session.history RPC"] -->|"返回 HistoryEntry[]"| B["foldStats()"]
    B --> C{"event.type?"}
    C -->|"turn/start"| D["turns++"]
    C -->|"user/message"| E["userMessages++"]
    C -->|"assistant/message"| F["assistantMessages++"]
    C -->|"tool/call"| G["toolCounts.set(name)<br/>name: count++"]
    B --> H["SessionStats"]
    H --> I["turns / userMessages / assistantMessages"]
    H --> J["toolCalls: {name, count}[] 降序"]
    H --> K["startedAt ~ updatedAt 活动窗口"]
```

---

## 7. 功能模块详解

### 7.1 工作区管理

```mermaid
graph TB
    subgraph "工作区排序（拖拽）"
        DRAG["PointerDown 捕获"]
        MOVE["PointerMove 判断落点"]
        UP["PointerUp 执行"]
    end

    subgraph "落点判定"
        LABEL["工作区标题区域"]
        UPPER["标题上半部 → before:\<id\>"]
        LOWER["标题下半部 → swap:\<id\>"]
        BELOW["标题下方 → before:下一个"]
        END["列表末尾 → __end__"]
    end

    subgraph "API 调用"
        INSERT["api.workspace.insertBefore()<br/>workspaceId + beforeWorkspaceId"]
    end

    DRAG --> MOVE
    MOVE --> LABEL
    LABEL --> UPPER
    LABEL --> LOWER
    MOVE --> BELOW
    MOVE --> END
    UP --> INSERT
```

工作区操作通过 DSH 官方 API：
- **重排序**：`api.workspace.insertBefore({ workspaceId, beforeWorkspaceId })`
- **重命名**：`api.workspace.rename({ workspaceId, title })`
- **删除**：`api.workspace.delete({ workspaceId })`（仅移出列表，会话归入「未分组」）

### 7.2 Fork（新聊天中继续）

```mermaid
sequenceDiagram
    participant C as Client
    participant API as api.sessions.fork
    participant S as sessions.open

    C->>API: fork({ sessionId })
    alt fork-unavailable
        API-->>C: error: 当前回合未结束
    else 成功
        API-->>C: { sessionId: childId }
        C->>S: open(childId)
        C->>C: 关闭抽屉/面板
    end
```

### 7.3 暂停运行中会话

```mermaid
sequenceDiagram
    participant C as Client
    participant WS as Host Route
    participant A as ctx.agents

    C->>WS: POST /pause { sessionId }
    WS->>A: agents.get(id)
    alt agent 不存在
        WS-->>C: 404 agent-not-found
    else agent 存在
        WS->>A: agent.cancel({ kind: 'user' })
        WS-->>C: 200 ok
    end
```

### 7.4 打开日志目录

```mermaid
flowchart TD
    A["POST /open-folder"] --> B["优先查找 live 会话路径"]
    B --> C["ctx.sessionPersistence.locate()"]
    C --> D{"找到?"}
    D -->|"是"| E["dir = dirname(location.path)"]
    D -->|"否"| F["查找 trash entry.originalPath"]
    F --> G{"存在?"}
    G -->|"是"| E
    G -->|"否"| H["返回 404"]
    E --> I["openFolder(path)"]
    I --> J{"平台?"}
    J -->|"win32"| K["spawn('explorer', [path])"]
    J -->|"darwin"| L["spawn('open', [path])"]
    J -->|"其他"| M["spawn('xdg-open', [path])"]
```

---

## 8. 语言与国际化

插件使用 DSH 官方 `ctx.locale` 服务进行中英文切换：

```mermaid
graph LR
    LOCALE["ctx.locale.getLocale()"] -->|"active"| SYNC["setAppLocale()"]
    SYNC --> STRINGS["stringsOf()"]
    STRINGS -->|"zh"| ZH["中文字符串"]
    STRINGS -->|"en"| EN["英文字符串"]

    ctx.locale.subscribe -->|"运行时切换"| SYNC
```

- 导航标签通过 `ctx.locale.register(NS, { zh: NAV_ZH, en: NAV_EN })` 注册
- 所有 UI 文本通过 `useLocaleStrings()` hook 响应语言切换
- 语言跟随 DSH 设置，不受浏览器语言影响

---

## 9. 关键工程决策

### 9.1 串行化互斥锁

所有文件/归档修改操作（delete / restore / purge / compaction-threshold 保存）共享 `withMutationLock`，基于 Promise 链串行化。这解决了多浏览器标签页同时操作时的竞态条件：后发操作会等待前一操作完成后再读取最新状态。

### 9.2 侧边栏未读点：标题文本匹配

官方侧边栏行元素不携带 session id，因此通过 `MutationObserver` 装饰时按标题文本匹配。已知限制：重复标题的会话会共享同一个蓝点。

### 9.3 回滚机制

删除操作失败时自动回滚：
1. 文件已移动但归档失败 → 移回文件 + unarchive
2. 归档成功但后续失败 → unarchive 恢复

### 9.4 localStorage 防刷新复活

删除的 session id 存入 `dsh-delete-session.removed`，刷新页面后客户端会过滤掉这些 id，避免 live 会话在重启后因 DSH 清理内存状态前短暂"复活"。

### 9.5 抽屉与面板数据源差异

| 入口 | 数据源 | 特点 |
|------|--------|------|
| 设置页 SessionManager | `useSessions` / `useWorkspaces` 标准 hook | 由框架注入，自动订阅 |
| 抽屉 SessionDrawer | `sessions.list.getSnapshot()` + `api.workspace.list()` | 手动订阅 ObservableSnapshot，每 5 秒轮询刷新 |

---

## 10. 依赖关系

### 10.1 peerDependencies（DSH 官方包）

| 包名 | 用途 |
|------|------|
| `@deepseek-ai/cordis` | 插件运行时框架 |
| `@deepseek-ai/dsh-session` | 会话类型定义 |
| `@deepseek-ai/dsh-session-persistence` | 会话持久化查询 |
| `@deepseek-ai/dsh-workspace` | 工作区归档 |
| `@deepseek-ai/dsh-storage-domain` | 持久化存储域 |
| `@deepseek-ai/dsh-home-paths` | DSH 主目录路径 |
| `@deepseek-ai/dsh-host-webserver` | 宿主 HTTP 路由注册 |
| `@deepseek-ai/dsh-agent-presets` | Agent 预设服务 |
| `@deepseek-ai/dsh-client-runtime` | 客户端运行时 |
| `@deepseek-ai/dsh-client-ui-slots` | 插槽系统 |
| `@deepseek-ai/dsh-client-ui-settings` | 设置页插槽 |
| `@deepseek-ai/dsh-client-ui-primitives` | Button / StateDot 等 UI 原语 |
| `@deepseek-ai/dsh-client-ui-conversation` | 对话头部插槽 |
| `@deepseek-ai/dsh-client-locale` | 多语言服务 |
| `@deepseek-ai/dsh-api-remotes` | Wire 客户端 API |

### 10.2 package.json dsh manifest

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-conversation"
      ],
      "platform": "web"
    }
  }
}
```

---

## 11. 安装与开发

### 11.1 安装

```sh
# 从 GitHub
dsh plugin --profile web add 'github:dream12347/dsh-session-manager#v0.2.2'

# 从本地目录
dsh plugin --profile web add /absolute/path/to/dsh-session-manager

# 从 tarball
pnpm pack
dsh plugin --profile web add /absolute/path/to/dsh-session-manager-0.2.2.tgz
```

安装后需**重启** `dsh web`。

### 11.2 开发

```sh
pnpm install        # 安装依赖
pnpm run check      # typecheck + test + build
```

`lib/` 为提交的构建产物，修改源码后必须重新构建并提交 `lib/`。

### 11.3 cordis.patch.yml

```yaml
- insert:
    - id: dsh-session-manager
      name: dsh-session-manager
```

---

## 12. 限制与已知问题

| 限制 | 说明 |
|------|------|
| 运行中会话不可删除 | 按钮禁用且 host 拒绝，多标签页请先在别处停止 |
| 侧边栏蓝点按标题匹配 | 重复标题的会话共享同一个点（抽屉内按 session id 精确标记） |
| live 会话删除后内存状态由 DSH 重启清理 | 删除的 id 记录在 localStorage 防止刷新后短暂复活 |
| 彻底删除的 session id 无害残留 | 同时保留在 localStorage 和归档集合中 |
| 子代理会话可删除（非运行中） | 包括主会话已删除的「孤儿」子代理 |

---

## 13. 验证路径

1. 安装后重启 `dsh web`，确认设置页出现「会话管理」分栏
2. 创建多个会话（含一个运行中的），确认运行中的不可删除
3. 删除一个会话 → 确认侧边栏隐藏 + 出现在回收站
4. 恢复该会话 → 确认回到会话列表
5. 彻底删除 → 确认从回收站消失
6. 测试未读标记：标记未读 → 确认蓝点显示；打开会话 → 确认自动已读
7. 测试工作区拖拽排序、重命名、删除
8. 测试压缩阈值：修改 → 保存 → 确认生效
9. 测试 fork：点击「新聊天中继续」→ 确认创建并打开子会话
10. 测试统计弹窗：确认显示轮次、消息数、工具调用、活动窗口
11. 多标签页同时删除不同会话 → 确认无竞态
12. 刷新页面 → 确认回收站、未读、压缩阈值持久化
