---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] 存储文件前缀扁平化：dsh_session_tag_manage/{workspaceId}.json → dsh_session_tag__{workspaceId}.json'
labels: ['bug']
assignees: ''
---

## 描述缺陷

存储工具 `file-storage.ts` 使用的目录前缀 `dsh_session_tag_manage` 不符合扁平化命名规范。需要将存储路径从目录嵌套结构改为扁平化前缀，文件直接平铺在 `~/.dsh/storages/` 下。

## 复现步骤

1. 启动 dsh，执行 `dsh web --patch ...`
2. 写入工作区标签（任意 workspaceId）
3. 观察 `~/.dsh/storages/` 下的存储文件路径

## 预期行为

存储路径为 `~/.dsh/storages/dsh_session_tag__{workspaceId}.json`

## 实际行为

存储路径为 `~/.dsh/storages/dsh_session_tag_manage/{workspaceId}.json`

## 环境信息

- dsh 版本：`dsh --version`（最新版）
- 插件版本：`dsh plugin list`
- 操作系统：Windows / macOS / Linux
- 浏览器（Web UI 相关）：Chrome / Edge

## 日志 / 报错

无运行时报错，属于存储路径规范问题。

## 根因分析

`file-storage.ts` 中使用子目录 `dsh_session_tag_manage/` 嵌套存储，需改为扁平化前缀 `dsh_session_tag__` 直接作为文件名前缀。

**路径对比：**
- 旧：`~/.dsh/storages/dsh_session_tag_manage/{workspaceId}.json`
- 新：`~/.dsh/storages/dsh_session_tag__{workspaceId}.json`

## 变更范围

- `packages/dsh-session-host/src/utils/file-storage.ts`：`STORAGE_DIR` → `FILE_PREFIX`，`getWorkspaceFilePath()` 返回扁平路径，`listWorkspaceIds()` 按前缀过滤
- `packages/dsh-session-host/src/index.ts`：注释及测试路由中的路径字符串
- `packages/dsh-session-host/__tests__/file-storage.test.ts`：所有路径引用适配扁平结构
- `openspec/changes/session-tag-storage/tasks.md`：文档引用

## 影响说明

- 此为存储层路径重构，**会影响已有数据**。升级后旧目录下的文件不会自动迁移。
- 建议在发布说明中提醒用户手动迁移：
  - `~/.dsh/storages/dsh_session_tag_manage/` 下各 `{workspaceId}.json` → 重命名为 `~/.dsh/storages/dsh_session_tag__{workspaceId}.json`

## 其他补充

- 已确认 `pnpm test` 全部用例通过
- 已确认 `pnpm typecheck` 无类型错误
