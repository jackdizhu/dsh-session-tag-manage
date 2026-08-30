# 任务列表

## 阶段一：类型定义与 Contract

- [x] 1.1 在 `types/deepseek-ai.d.ts` 补充 `storageDomain` 和 `defineDomain` 类型声明
    变更文件：`types/deepseek-ai.d.ts`

- [x] 1.2 创建 `packages/dsh-session-host/src/contract.ts` 共享类型
    变更文件：`packages/dsh-session-host/src/contract.ts`（新建）
    新增路由常量和类型：
    - `WORKSPACE_LIST_TAG_ROUTE` — 查询路由
    - `WORKSPACE_TAG_SET_ROUTE` — 写入路由
    - `SessionTagEntry` — 会话标签条目结构
    - `WorkspaceTagQueryRequest/Response` — 查询请求/响应
    - `WorkspaceTagSetRequest/Response` — 写入请求/响应

## 阶段二：宿主端存储与路由

- [x] 2.1 创建 `packages/dsh-session-host/src/utils/file-storage.ts` — 按目录结构的文件存储工具
    变更文件：`packages/dsh-session-host/src/utils/file-storage.ts`（新建）
    存储结构：`~/.dsh/storages/dsh_session_tag__{workspaceId}.json`
    API：
    - `readWorkspaceTags(workspaceId)` — 读取工作区标签
    - `writeWorkspaceTags(workspaceId, entries)` — 写入工作区标签（全量覆盖）
    - `deleteWorkspaceFile(workspaceId)` — 删除工作区文件
    - `listWorkspaceIds()` — 列出所有工作区 ID
    - `workspaceFileExists(workspaceId)` — 检查文件是否存在

- [x] 2.2 扩展 `packages/dsh-session-host/src/index.ts`，注册查询 + 写入路由
    变更文件：`packages/dsh-session-host/src/index.ts`
    路由：
    - `POST /dsh-session-tag-manage/workspace.list.tag` — 查询
    - `POST /dsh-session-tag-manage/workspace.tag.set` — 写入（全量覆盖）
    - 无会话时自动删除空 JSON 文件（清理策略）

## 阶段三：客户端接口调用

- [x] 3.1 修改 `packages/dsh-session-client/src/index.ts` 的 Canvas 点击事件，调用查询接口
    变更文件：`packages/dsh-session-client/src/index.ts`
    Canvas 点击 → `POST /workspace.list.tag { workspaceId }` → 打印响应

## 阶段四：测试与验证

- [x] 4.1 更新宿主端测试用例（19 tests）
    变更文件：`packages/dsh-session-host/__tests__/index.test.ts`
    覆盖：/dsh-session-host-test、workspace.list.tag、workspace.tag.set、自动清理

- [x] 4.2 编写 file-storage 独立单元测试（12 tests）
    变更文件：`packages/dsh-session-host/__tests__/file-storage.test.ts`（新建）
    覆盖：读写、删除、列出、存在性检查、JSON 容错

- [x] 4.3 更新客户端测试用例（16 tests）
    变更文件：`packages/dsh-session-client/__tests__/index.test.ts`

- [x] 4.4 执行 `pnpm typecheck`，确认无类型错误

- [x] 4.5 执行 `pnpm test`，确认 47/47 测试用例通过

- [x] 4.6 执行 `pnpm build`，确认构建成功（6.40 kB host bundle）

- [x] 4.7 Sub-agent 任务审计
    - 对照 proposal.md 中的 Capabilities 检查实现完整性
    - 验证所有文件变更符合 diff 规范
    - 确认测试覆盖率达标（47 tests）
