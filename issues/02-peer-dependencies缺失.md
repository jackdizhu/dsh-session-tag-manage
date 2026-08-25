---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] linked 插件依赖树未安装，20+ 个 peer dependencies 缺失'
labels: ['bug']
assignees: ''
---

## 描述缺陷

插件通过 `dsh plugin add link:...` 链接到 profile 后，插件自身依赖（`@deepseek-ai/schemastery`）及其 peer dependencies（`@deepseek-ai/dsh-timeout`、`@deepseek-ai/dsh-invariants` 等 20+ 个）未被安装，启动时报找不到包。

## 复现步骤

1. 将插件以 `link:` 形式加入 profile 的 dependencies
2. 在插件目录执行 `pnpm install`
3. 启动 `dsh web`
4. 看到如下报错：`Cannot find package '@deepseek-ai/schemastery' imported from ...\src\config.ts`
5. 修正后连锁出现 20+ 个 peer deps 缺失

## 预期行为

插件依赖及其 peer dependencies 均被正确安装，插件可正常解析需要的内部包。

## 实际行为

```
Error: Cannot find package '@deepseek-ai/schemastery' imported from
...\dsh-session-tag-manage\src\config.ts
```

连锁缺失：`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-commands`、`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-invariants`、`@deepseek-ai/dsh-timeout`、`@deepseek-ai/dsh-attachment`、`react`、`zustand` 等。

## 环境信息

- dsh 版本：`dsh --version`（全局 dsh CLI + dsh-app-boot）
- 插件版本：`dsh-session-tag-manage` v0.1.0
- 包管理器：pnpm（`pnpm-lock.yaml`）

## 日志 / 报错

见「实际行为」中的错误信息。连锁缺包时按出现顺序逐个报 `Cannot find package '@deepseek-ai/xxx'`。

## 根因与解决

- **根因**：
  1. 插件的 `node_modules` 目录不存在，依赖未落盘；
  2. Profile 的 `pnpm-lock.yaml` 未包含这些依赖（linked 包不会被 profile 层递归解析依赖树）；
  3. `.npmrc` 中 `auto-install-peers=false` 阻止了 peer deps 自动安装。
- **解决**：

| 文件 | 变更 |
|---|---|
| [.npmrc](file:///c:/global-user-data/ai-workspace/dsh-session-tag-manage/.npmrc) | `auto-install-peers=false` → `auto-install-peers=true` |

```bash
# 随后在插件目录重新安装
pnpm install --no-frozen-lockfile
# 结果：+63 packages（含 20+ peer deps），-12 packages
```

## 其他补充

linked 插件在 profile 层不会被递归解析依赖树，需在插件自身目录单独执行安装以保证 `node_modules` 完整。