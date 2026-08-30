# core-api 接口文档索引

> 来源：`packages/api`（Typert RPC 服务端，由 `@Remote` 装饰方法定义接口）与 `packages/client`（web 端，通过生成的 Remote 代理消费）。

> 本目录共 **38** 个接口，每个接口一个独立 Markdown 文件，统一包含四段：**接口 / 入参 / 出参 / web端处理逻辑**。

## 总览

| 命名空间 | 接口数 |
|---|---:|
| `session` | 16 |
| `skills` | 1 |
| `fileReferences` | 1 |
| `settings` | 7 |
| `credentials` | 3 |
| `workspace` | 7 |
| `directoryPicker` | 3 |

## 接口清单（按命名空间）

### `session` （16 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `session.attachment` | 一元 | 读取一张经证明「会话日志确实引用过」的持久化图片，返回其持久化附件引用与 base64 编码字节。 | [session-attachment.md](session-attachment.md) |
| `session.canOpenWorkspacePath` | 一元 | 报告当前部署是否能够将会话工作区路径交给原生桌面打开器；`true` 表示匹配的原生打开操作可用。 | [session-canOpenWorkspacePath.md](session-canOpenWorkspacePath.md) |
| `session.cancel` | 一元 | 取消某个活跃 Agent 的当前 turn，但保留其待处理 inbox（队列）内容；返回取消请求已被受理的回执。 | [session-cancel.md](session-cancel.md) |
| `session.control` | 流式 | 流式推送一份完整的 Host 级实时控制基线，随后推送队列/任务/投影的增量替换帧，供客户端维持全局实时控制态。 | [session-control.md](session-control.md) |
| `session.create` | 一元 | 创建或幂等接管（显式指定 `sessionId` 时）一个普通会话，返回会话标识及解析后的 agent preset。 | [session-create.md](session-create.md) |
| `session.follow` | 流式 | 从开场（或恢复游标）开始跟随某个会话日志，先返回完整的开场快照，再推送无空洞的事件帧。 | [session-follow.md](session-follow.md) |
| `session.fork` | 一元 | 将某个已完成 turn 前缀（可锚定事件位置）派生为一个新会话，返回新会话标识。 | [session-fork.md](session-fork.md) |
| `session.list` | 一元 | 在不恢复任何 Agent 的前提下，读取所有可见（已挂载或已持久化）会话的摘要列表，按最近活动时间排序返回。 | [session-list.md](session-list.md) |
| `session.modelCatalog` | 一元 | 无需会话即可描述当前可路由的所有模型，供 Host 端生成的模型选择器使用；返回按 provider 分组、部署默认选择以及隔离的 provider 失败。 | [session-modelCatalog.md](session-modelCatalog.md) |
| `session.openWorkspacePath` | 一元 | 在 Host 桌面上打开由会话感知调用方准备好的某个路径（相对路径按会话 cwd 解析）；返回原生打开器接受路径后的确认。 | [session-openWorkspacePath.md](session-openWorkspacePath.md) |
| `session.page` | 一元 | 读取一个冷安全、按消息对齐的会话历史分页（向后翻页），无需恢复 Agent；返回一页按时间顺序的记录。 | [session-page.md](session-page.md) |
| `session.prompt` | 一元 | 在显式恢复会话后接收一条 prompt，经图片校验/升级后提交给 Agent；返回 Agent 已接收该 prompt 的回执。 | [session-prompt.md](session-prompt.md) |
| `session.rename` | 一元 | 在显式恢复会话后，规范化并追加一条用户所有的会话标题，返回被接受的标题及其持久化事件序号。 | [session-rename.md](session-rename.md) |
| `session.search` | 一元 | 在可见会话的当前消息内容中做字面量全文检索，无需恢复任何匹配会话，返回有界且不重复的会话搜索结果。 | [session-search.md](session-search.md) |
| `session.selectModel` | 一元 | 在显式恢复会话后，选择并持久化一个会话级模型（provider/model/可选 reasoningEffort），返回规范化后的选中结果。 | [session-selectModel.md](session-selectModel.md) |
| `session.updateQueue` | 一元 | 对仍处于 pending 的队列项做一处变更（编辑/移除/插话），无需恢复冷 Agent；返回变更已应用的回执。 | [session-updateQueue.md](session-updateQueue.md) |

### `skills` （1 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `skills.list` | 一元 | 列出对某个会话组合可见、且用户可调用（user-invocable）的技能，无需加载技能体；返回技能元信息。 | [skills-list.md](skills-list.md) |

### `fileReferences` （1 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `fileReferences.list` | 一元 | 列出某个 Agent 工作目录下、`@` 引用触发的文件与目录候选，返回确定性的纯路径候选（来自组合的 file-reference provider）。 | [fileReferences-list.md](fileReferences-list.md) |

### `settings` （7 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `settings.canOpenAgentPresetDirectory` | 一元 | 报告本次部署能否以原生方式打开一个用户编写的 Agent preset 目录。 | [settings-canOpenAgentPresetDirectory.md](settings-canOpenAgentPresetDirectory.md) |
| `settings.describe` | 一元 | 为配置页面描述每一个已注册命名空间：脱敏后的分层取值，以及页面据此渲染表单的序列化 schema。 | [settings-describe.md](settings-describe.md) |
| `settings.mutate` | 一元 | 对某一命名空间的 user 段施加路径寻址编辑，针对“已存储”的 section 解析（而非调用方上次所读），随后回答该命名空间的新脱敏视图。 | [settings-mutate.md](settings-mutate.md) |
| `settings.openAgentPresetDirectory` | 一元 | 打开某一用户编写的 Agent preset 目录；若无原生 opener 则返回其路径用于文本展示。 | [settings-openAgentPresetDirectory.md](settings-openAgentPresetDirectory.md) |
| `settings.openSettingsDocument` | 一元 | 实体化 provider 拥有的 settings 文档，并在原生文本编辑器中打开它。 | [settings-openSettingsDocument.md](settings-openSettingsDocument.md) |
| `settings.replace` | 一元 | 整体替换某一命名空间已存储的 user 段。 | [settings-replace.md](settings-replace.md) |
| `settings.update` | 一元 | 将补丁合并进某一命名空间已存储的 user 段。 | [settings-update.md](settings-update.md) |

### `credentials` （3 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `credentials.describe` | 一元 | 为一个配置界面描述多个引用；批量发起是因为配置页会一次性描述其行所命名的所有引用，一次往返避免各行分别落定。 | [credentials-describe.md](credentials-describe.md) |
| `credentials.set` | 一元 | 从配置界面存储一个值；值只朝这一个方向过线，没有任何读路径返回它。 | [credentials-set.md](credentials-set.md) |
| `credentials.unset` | 一元 | 从配置界面移除一个引用。 | [credentials-unset.md](credentials-unset.md) |

### `workspace` （7 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `workspace.archiveSession` | 一元 | 在某个 Workspace 分组界面中隐藏一个已知 Session，返回完整的归档 Session 集合。 | [workspace-archiveSession.md](workspace-archiveSession.md) |
| `workspace.create` | 一元 | 在已存在的目录上创建 Workspace，若该目录已注册则幂等返回既有 Workspace，并返回是否本次新建。 | [workspace-create.md](workspace-create.md) |
| `workspace.delete` | 一元 | 删除一个 Workspace 注册，但保留其下的文件与 Session（仅移除注册行）。 | [workspace-delete.md](workspace-delete.md) |
| `workspace.follow` | 流式 | 流式推送完整的 Workspace 基线，其后跟随有序的增量（upsert / remove / order / archived），供浏览器断线重连安全地重建本地状态。 | [workspace-follow.md](workspace-follow.md) |
| `workspace.insertBefore` | 一元 | 在注册表显示顺序中移动某个 Workspace（DOM insertBefore 语义），返回完整的 Workspace 顺序。 | [workspace-insertBefore.md](workspace-insertBefore.md) |
| `workspace.insertSessionBefore` | 一元 | 在某个 Workspace 的记账 Session 列表中移动一个 Session（DOM insertBefore 语义），返回更新后的 Workspace 投影。 | [workspace-insertSessionBefore.md](workspace-insertSessionBefore.md) |
| `workspace.rename` | 一元 | 将某个 Workspace 重命名为唯一且非空的标题，返回更新后的 Workspace 投影。 | [workspace-rename.md](workspace-rename.md) |

### `directoryPicker` （3 个）

| 接口 | 调用模式 | 功能说明 | 文档 |
|---|---|---|---|
| `directoryPicker.createDirectory` | 一元 | 为远端调用方应用内浏览器在某个已存在父目录下创建一个子目录，返回所创建目录的绝对路径。 | [directoryPicker-createDirectory.md](directoryPicker-createDirectory.md) |
| `directoryPicker.list` | 一元 | 为远端调用方应用内浏览器列出某目录的单层内容，返回该层及其祖先链（面包屑）。 | [directoryPicker-list.md](directoryPicker-list.md) |
| `directoryPicker.pick` | 一元 | 为远端调用方打开主机操作系统的目录选择器，返回所选绝对路径；操作者取消时返回 `null`。 | [directoryPicker-pick.md](directoryPicker-pick.md) |
