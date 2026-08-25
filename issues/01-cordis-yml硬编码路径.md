---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] cordis.yml 的 name 被硬编码为 file:// 本地路径，导致 loader 无法导入模块'
labels: ['bug']
assignees: ''
---

## 描述缺陷

`cordis.yml`（`dsh.bundle.patch` 指向的补丁文件）中插件条目 `name` 被硬编码为开发者本机绝对路径 `file:///C:/global-user-data/ai-workspace/.../src/index.ts`，该路径在其他机器上不存在，导致 `dsh web` 启动时 loader 找不到模块。

## 复现步骤

1. 启动 dsh，执行 `dsh web`
2. 观察启动日志，loader 尝试加载 `session-tagger`
3. 看到如下报错：`Cannot find module 'C:\global-user-data\ai-workspace\dsh-session-tag-manage\src\index.ts'`
4. 插件树加载中断

## 预期行为

插件通过包名 `dsh-session-tag-manage` 由 loader 从 profile 的 `node_modules` 正常解析并加载。

## 实际行为

```
Error: failed to import loader entry session-tagger
(file:///C:/global-user-data/ai-workspace/dsh-session-tag-manage/src/index.ts):
Cannot find module 'C:\global-user-data\ai-workspace\dsh-session-tag-manage\src\index.ts'
```

## 环境信息

- dsh 版本：`dsh --version`（全局 dsh CLI + dsh-app-boot）
- 插件版本：`dsh-session-tag-manage` v0.1.0
- 操作系统：Windows
- 浏览器（Web UI 相关）：Chrome / Edge

## 日志 / 报错

见「实际行为」中的错误信息。

## 根因与解决

- **根因**：`file:///` URL 写法仅适用于 scratch 开发流（`--patch` 覆盖层）；bundle 型插件（经 `dsh.profile.bundles` 加载）应使用**包名**，由 loader 从 profile 的 `node_modules` 解析。两者不可混用。
- **解决**：将 `cordis.yml` 中 `name: 'file:///C:/...'` 改为 `name: 'dsh-session-tag-manage'`。

```yaml
# 修复前
- insert:
    - id: session-tagger
      name: 'file:///C:/global-user-data/ai-workspace/dsh-session-tag-manage/src/index.ts'

# 修复后
- insert:
    - id: session-tagger
      name: 'dsh-session-tag-manage'
```

## 其他补充

无。