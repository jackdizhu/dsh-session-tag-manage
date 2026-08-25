---
name: 缺陷报告
about: 创建缺陷报告帮助我们改进
title: '[缺陷] dsh.client 声明为非对象，且缺少 exports["./client"] 客户端 bundle 与服务端未见客户端产物'
labels: ['bug']
assignees: ''
---

## 描述缺陷

插件的 `dsh.client` 字段曾声明为字符串 `"./src/client/index.ts"`，而 `dsh-client-modules` 组合客户端包时要求其为**对象**（含字符串 `platform`），且必须通过 `exports["./client"]` 指向一个**已构建的 bundle（.js）**。同时构建链仅产出服务端（Babel 跳过 `src/client`），从未产出客户端 bundle。

## 复现步骤

1. 启动 `dsh web`
2. 观察 `@deepseek-ai/dsh-client-modules` 组合阶段
3. 看到如下报错：`dsh-session-tag-manage has a non-object dsh.client declaration`
4. 启动失败（插件树无法加载）

## 预期行为

客户端包声明以对象形式提供 `platform: "web"`，`exports["./client"]` 指向已构建的客户端 bundle，`dsh-client-modules` 成功组合并注册 client 行。

## 实际行为

```
Error: dsh: plugin tree failed to load: ... client-modules: 1 client package failed to compose:
  other failures:
    - client-modules: dsh-session-tag-manage has a non-object dsh.client declaration
```

（根源 `parseDshClient`：`typeof value !== "object" || value === null` 直接抛错。）

## 环境信息

- dsh 版本：`dsh --version`（含 `@deepseek-ai/dsh-client-modules`）
- 插件版本：`dsh-session-tag-manage` v0.1.0
- 操作系统：Windows

## 日志 / 报错

见「实际行为」中的错误信息（`ClientPackageCompositionError` / `parseDshClient`）。

## 根因与解决

- **根因**：`dsh-client-modules` 的 `resolveMeta` 要求 `dsh.client` 为对象且 `platform === "web"`，并通过 `exports["./client"]` 解析 bundle；字符串简写与「有 `.ts` 源码无构建产物」都不满足契约。
- **解决**：

| 文件 | 变更 |
|---|---|
| [package.json](file:///c:/global-user-data/ai-workspace/dsh-session-tag-manage/package.json) | `dsh.client: "./src/client/index.ts"`（字符串）→ `dsh.client: { "platform": "web" }`（对象）；新增 `exports["./client"]: "./dist/client.js"`；`build` 脚本增加 esbuild 客户端打包 |
| devDependencies | 新增 `esbuild` |

```json
"exports": {
  ".": "./dist/index.js",
  "./client": "./dist/client.js"
},
"dsh": {
  "bundle": { "patch": "./cordis.yml" },
  "client": { "platform": "web" }
}
```

```bash
# 构建：服务端走 Babel，客户端走 esbuild 打包为浏览器 bundle
esbuild src/client/index.ts --bundle --format=esm --platform=browser --outfile=dist/client.js
```

## 其他补充

- 客户端所有 `@deepseek-ai/*` 导入均为 `import type`（已擦除），运行时仅需内联打包 `@deepseek-ai/schemastery`（配置 Schema 需在浏览器端可用），产物 `dist/client.js` 约 44.9kb。
- 关联问题：见 [06-exports根入口缺失](file:///c:/global-user-data/ai-workspace/dsh-session-tag-manage/issues/06-exports根入口缺失.md)。